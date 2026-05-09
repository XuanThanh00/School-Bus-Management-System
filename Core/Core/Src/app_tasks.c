#include "app_tasks.h"
#include "app_state.h"
#include "rtos_objects.h"
#include "rc522.h"
#include "gps.h"
#include "mp3.h"
#include "uart_protocol.h"
#include "main.h"
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"

/* ── Timing constants ───────────────────────────────────────────────────── */
#define HB_TIMEOUT_MS       10000U  /* Pi heartbeat deadline                */
#define READY_RESEND_MS      2000U  /* READY retransmit period in handshake */
#define PI_LOST_RETRY_MS    20000U  /* Idle period before re-handshaking    */

/* ── Build status flags for HB_STM32 ───────────────────────────────────── */
static uint8_t _build_flags(void) {
    uint8_t flags = FLAG_RFID_OK | FLAG_MP3_OK | FLAG_IWDG_RUNNING;

    xSemaphoreTake(g_mutex_gps, portMAX_DELAY);
    bool fix = g_gps_snapshot.fix_valid &&
               (HAL_GetTick() - g_gps_snapshot.last_update_tick < GPS_STALE_MS);
    xSemaphoreGive(g_mutex_gps);

    if (fix) flags |= FLAG_GPS_FIX;
    return flags;
}

/* ── Read GPS snapshot under mutex and send to Pi ───────────────────────── */
static void _send_gps_or_nofix(void) {
    GPS_Data snap;
    xSemaphoreTake(g_mutex_gps, portMAX_DELAY);
    snap = g_gps_snapshot;
    xSemaphoreGive(g_mutex_gps);

    bool valid = snap.fix_valid &&
                 (HAL_GetTick() - snap.last_update_tick < GPS_STALE_MS);

    if (valid)
        Proto_SendGpsData(&g_proto, snap.latitude, snap.longitude, snap.speed_kmh);
    else
        Proto_SendGpsNoFix(&g_proto, snap.satellites);
}

/* ── Protocol callbacks (run in CommTask context via Proto_Update) ───────── */

static void cb_play_audio(uint8_t track) {
    AudioCmd cmd = { .type = AUDIO_PLAY, .param = track };
    xQueueSend(g_queue_audio, &cmd, 0);
    Proto_SendAck(&g_proto, CMD_PLAY_AUDIO);
}

static void cb_set_volume(uint8_t vol) {
    AudioCmd cmd = { .type = AUDIO_SET_VOL, .param = vol };
    xQueueSend(g_queue_audio, &cmd, 0);
    Proto_SendAck(&g_proto, CMD_SET_VOLUME);
}

static void cb_request_gps(void) {
    Proto_SendAck(&g_proto, CMD_REQUEST_GPS);
    _send_gps_or_nofix();  /* Immediate on-demand send (CommTask context) */
}

static void cb_hb_pi(void) {
    g_pi_last_hb_tick = HAL_GetTick();
    Proto_SendHbStm32(&g_proto, _build_flags());
    if (g_sys_state == SYS_HANDSHAKING)
        g_sys_state = SYS_RUNNING;
}

static void cb_shutdown(void) {
    g_sys_state = SYS_SHUTDOWN;
}

static void cb_ack(uint8_t cmd_acked) {
    (void)cmd_acked;
}

/* ════════════════════════════════════════════════════════════════════════════
   CommTask — Priority 4
   Owns: Pi UART (g_proto), system state machine, outbound packet queue.
   Activated by: USART1 ISR (new byte), HB timer, GPS timer, 100 ms timeout.
   ══════════════════════════════════════════════════════════════════════════ */
void Task_Comm(void *arg) {
    (void)arg;

    static const Proto_Callbacks cbs = {
        .on_play_audio  = cb_play_audio,
        .on_set_volume  = cb_set_volume,
        .on_request_gps = cb_request_gps,
        .on_hb_pi       = cb_hb_pi,
        .on_shutdown    = cb_shutdown,
        .on_ack         = cb_ack,
    };
    Proto_Init(&g_proto, &huart1, &cbs);

    g_sys_state         = SYS_HANDSHAKING;
    g_pi_last_hb_tick   = HAL_GetTick();
    uint32_t last_ready = HAL_GetTick();
    uint32_t pi_lost_t  = 0;

    Proto_SendReady(&g_proto);

    for (;;) {
        uint32_t bits = 0;
        xTaskNotifyWait(0, 0xFFFFFFFFUL, &bits, pdMS_TO_TICKS(100));

        Proto_Update(&g_proto);  /* Always drain RX buffer */

        /* Forward any new RFID reads to Pi */
        RC522_UID uid;
        if (xQueueReceive(g_queue_rfid, &uid, 0) == pdTRUE)
            Proto_SendRfidUID(&g_proto, uid.bytes);

        /* Proactive HB_STM32 (timer fires every 5 s) */
        if ((bits & NOTIFY_COMM_HB) && g_sys_state == SYS_RUNNING)
            Proto_SendHbStm32(&g_proto, _build_flags());

        /* Periodic GPS send (timer fires every 30 s) */
        if ((bits & NOTIFY_COMM_GPS) && g_sys_state == SYS_RUNNING)
            _send_gps_or_nofix();

        uint32_t now = HAL_GetTick();

        switch (g_sys_state) {

        case SYS_HANDSHAKING:
            if (now - last_ready >= READY_RESEND_MS) {
                Proto_SendReady(&g_proto);
                last_ready = now;
            }
            break;

        case SYS_RUNNING:
            if (now - g_pi_last_hb_tick > HB_TIMEOUT_MS) {
                g_sys_state = SYS_PI_LOST;
                pi_lost_t   = now;
            }
            break;

        case SYS_PI_LOST:
            if (now - pi_lost_t >= PI_LOST_RETRY_MS) {
                g_sys_state = SYS_HANDSHAKING;
                last_ready  = now;
                Proto_SendReady(&g_proto);
            }
            break;

        case SYS_SHUTDOWN:
            /* IWDG timer stops feeding → MCU resets within ~4 s */
            for (;;) vTaskDelay(pdMS_TO_TICKS(1000));
            break;

        default:
            break;
        }
    }
}

/* ════════════════════════════════════════════════════════════════════════════
   GpsTask — Priority 3
   Activated by DMA half-transfer or transfer-complete events (USART2 RX).
   Parses NMEA sentences and updates the shared GPS snapshot under mutex.
   ══════════════════════════════════════════════════════════════════════════ */
void Task_Gps(void *arg) {
    (void)arg;

    for (;;) {
        /* Block until DMA signals data or 100 ms elapses (stale detection) */
        xTaskNotifyWait(0, NOTIFY_GPS_HT | NOTIFY_GPS_TC, NULL, pdMS_TO_TICKS(100));

        bool updated = GPS_Update(&g_gps);

        if (updated) {
            xSemaphoreTake(g_mutex_gps, portMAX_DELAY);
            g_gps_snapshot = g_gps.data;
            xSemaphoreGive(g_mutex_gps);
        }
    }
}

/* ════════════════════════════════════════════════════════════════════════════
   RfidTask — Priority 2
   Polls the RC522 every 50 ms using a drift-free periodic delay.
   Sends new UIDs to CommTask via rfid_queue (non-blocking — drops if full).
   A 2 s debounce prevents repeated sends for the same card.
   ══════════════════════════════════════════════════════════════════════════ */
void Task_Rfid(void *arg) {
    (void)arg;

    RC522_UID    last_uid      = { .size = 0 };
    uint32_t     last_send_ms  = 0;
    TickType_t   wake_time     = xTaskGetTickCount();

    for (;;) {
        vTaskDelayUntil(&wake_time, pdMS_TO_TICKS(50));

        if (g_sys_state != SYS_RUNNING) continue;

        RC522_UID uid;
        if (RC522_ReadUID(&g_rfid, &uid) != RC522_OK) continue;

        uint32_t now      = HAL_GetTick();
        bool     new_card = !RC522_UIDEqual(&uid, &last_uid);
        bool     debounce = (now - last_send_ms) >= 2000U;

        if (new_card || debounce) {
            /* Non-blocking: if CommTask is slow we drop rather than stall */
            if (xQueueSend(g_queue_rfid, &uid, 0) == pdTRUE) {
                last_uid     = uid;
                last_send_ms = now;
            }
        }
    }
}

/* ════════════════════════════════════════════════════════════════════════════
   AudioTask — Priority 1
   Sleeps until an audio command arrives in the queue; executes it on the
   MP3 module via USART2 TX (no conflict with GPS DMA which uses USART2 RX).
   ══════════════════════════════════════════════════════════════════════════ */
void Task_Audio(void *arg) {
    (void)arg;

    AudioCmd cmd;
    for (;;) {
        xQueueReceive(g_queue_audio, &cmd, portMAX_DELAY);

        switch (cmd.type) {
        case AUDIO_PLAY:    MP3_PlayTrack(&g_mp3, cmd.param); break;
        case AUDIO_SET_VOL: MP3_SetVolume(&g_mp3, cmd.param); break;
        case AUDIO_STOP:    MP3_Stop     (&g_mp3);            break;
        case AUDIO_PAUSE:   MP3_Pause    (&g_mp3);            break;
        case AUDIO_RESUME:  MP3_Resume   (&g_mp3);            break;
        default: break;
        }
    }
}
