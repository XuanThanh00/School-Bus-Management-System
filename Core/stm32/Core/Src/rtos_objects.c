#include "rtos_objects.h"
#include "app_tasks.h"
#include "app_state.h"
#include "uart_protocol.h"
#include "main.h"
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"
#include "timers.h"

/* ── Global system state ────────────────────────────────────────────────── */
volatile SystemState_t g_sys_state       = SYS_BOOTING;
volatile uint32_t      g_pi_last_hb_tick = 0;

/* ── Shared GPS snapshot — written by GpsTask, read by CommTask ─────────── */
GPS_Data g_gps_snapshot;

/* ── Task stacks and TCBs (zero-initialised at startup) ─────────────────── */
static StackType_t  s_stack_comm [STACK_COMM];   static StaticTask_t s_tcb_comm;
static StackType_t  s_stack_gps  [STACK_GPS];    static StaticTask_t s_tcb_gps;
static StackType_t  s_stack_rfid [STACK_RFID];   static StaticTask_t s_tcb_rfid;
static StackType_t  s_stack_audio[STACK_AUDIO];  static StaticTask_t s_tcb_audio;
/* Idle and Timer task memory is provided by freertos.c (CubeMX-managed). */

/* ── Task handles ───────────────────────────────────────────────────────── */
TaskHandle_t g_task_comm;
TaskHandle_t g_task_gps;

/* ── RFID queue ─────────────────────────────────────────────────────────── */
static StaticQueue_t s_rfid_q_cb;
static uint8_t       s_rfid_q_storage[4 * sizeof(RC522_UID)];
QueueHandle_t g_queue_rfid;

/* ── Audio command queue ────────────────────────────────────────────────── */
static StaticQueue_t s_audio_q_cb;
static uint8_t       s_audio_q_storage[8 * sizeof(AudioCmd)];
QueueHandle_t g_queue_audio;

/* ── GPS data mutex ─────────────────────────────────────────────────────── */
static StaticSemaphore_t s_gps_mutex_cb;
SemaphoreHandle_t g_mutex_gps;

/* ── Software timer control blocks ─────────────────────────────────────── */
static StaticTimer_t s_timer_iwdg_cb;
static StaticTimer_t s_timer_hb_cb;
static StaticTimer_t s_timer_gps_cb;
TimerHandle_t g_timer_iwdg;
TimerHandle_t g_timer_hb;
TimerHandle_t g_timer_gps;

/* ── Timer callbacks ────────────────────────────────────────────────────── */

static void _cb_iwdg(TimerHandle_t t) {
    (void)t;
    /* Only feed the watchdog while the system is operational.
       In PI_LOST or SHUTDOWN states the feed is withheld so the IWDG
       fires ~4 s later and resets the MCU. */
    if (g_sys_state == SYS_RUNNING || g_sys_state == SYS_HANDSHAKING)
        HAL_IWDG_Refresh(&hiwdg);
}

static void _cb_hb(TimerHandle_t t) {
    (void)t;
    /* Notify CommTask to send a proactive HB_STM32 packet. All TX goes
       through CommTask to serialise access to the Pi UART. */
    xTaskNotify(g_task_comm, NOTIFY_COMM_HB, eSetBits);
}

static void _cb_gps(TimerHandle_t t) {
    (void)t;
    xTaskNotify(g_task_comm, NOTIFY_COMM_GPS, eSetBits);
}

/* ── Stack overflow hook ────────────────────────────────────────────────── */
void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcName) {
    (void)xTask;
    (void)pcName;
    /* Force a hardware reset; the IWDG will then restart the MCU cleanly. */
    NVIC_SystemReset();
}

/* ── RTOS_ObjectsInit ───────────────────────────────────────────────────── */
void RTOS_ObjectsInit(void) {
    /* Queues */
    g_queue_rfid  = xQueueCreateStatic(4, sizeof(RC522_UID),
                                        s_rfid_q_storage,  &s_rfid_q_cb);
    g_queue_audio = xQueueCreateStatic(8, sizeof(AudioCmd),
                                        s_audio_q_storage, &s_audio_q_cb);

    /* Mutex */
    g_mutex_gps = xSemaphoreCreateMutexStatic(&s_gps_mutex_cb);

    /* Tasks */
    g_task_comm = xTaskCreateStatic(Task_Comm,  "Comm",  STACK_COMM,
                                     NULL, PRIO_COMM,  s_stack_comm,  &s_tcb_comm);
    g_task_gps  = xTaskCreateStatic(Task_Gps,   "GPS",   STACK_GPS,
                                     NULL, PRIO_GPS,   s_stack_gps,   &s_tcb_gps);
                  xTaskCreateStatic(Task_Rfid,  "RFID",  STACK_RFID,
                                     NULL, PRIO_RFID,  s_stack_rfid,  &s_tcb_rfid);
                  xTaskCreateStatic(Task_Audio, "Audio", STACK_AUDIO,
                                     NULL, PRIO_AUDIO, s_stack_audio, &s_tcb_audio);

    /* Software timers */
    g_timer_iwdg = xTimerCreateStatic("IWDG", pdMS_TO_TICKS(2000),  pdTRUE,
                                       NULL, _cb_iwdg, &s_timer_iwdg_cb);
    g_timer_hb   = xTimerCreateStatic("HB",   pdMS_TO_TICKS(5000),  pdTRUE,
                                       NULL, _cb_hb,   &s_timer_hb_cb);
    g_timer_gps  = xTimerCreateStatic("GPS",  pdMS_TO_TICKS(30000), pdTRUE,
                                       NULL, _cb_gps,  &s_timer_gps_cb);

    xTimerStart(g_timer_iwdg, 0);
    xTimerStart(g_timer_hb,   0);
    xTimerStart(g_timer_gps,  0);
}
