#ifndef UART_PROTOCOL_H
#define UART_PROTOCOL_H

#include "stm32f1xx_hal.h"
#include <stdint.h>
#include <stdbool.h>

/* Packet format: [0xAA][LEN][CMD][PAYLOAD 0..15 B][CRC8]
   CRC8 = LEN ^ CMD ^ payload[0] ^ ... ^ payload[n-1]       */

#define PROTO_STX          0xAAU
#define PROTO_MAX_PAYLOAD  15U
#define PROTO_RX_BUF_SIZE  64U

/* ── Command IDs ────────────────────────────────────────────────────────── */

/* STM32 → Pi */
#define CMD_RFID_UID     0x01U  /* 4 B UID                                 */
#define CMD_GPS_DATA     0x02U  /* 12 B: lat(f32) lon(f32) speed_kmh(f32)  */
#define CMD_HB_STM32     0x05U  /* 1 B flags bitmask                       */
#define CMD_GPS_NO_FIX   0x06U  /* 1 B satellite count                     */
#define CMD_READY        0x09U  /* 0 B                                     */

/* Pi → STM32 */
#define CMD_PLAY_AUDIO   0x03U  /* 1 B track number                        */
#define CMD_ACK          0x04U  /* 1 B cmd_acked                           */
#define CMD_REQUEST_GPS  0x07U  /* 0 B                                     */
#define CMD_SET_VOLUME   0x08U  /* 1 B volume (0–30)                       */
#define CMD_HB_PI        0x0AU  /* 0 B                                     */
#define CMD_SHUTDOWN     0x0BU  /* 0 B                                     */

/* ── HB_STM32 flag bits ─────────────────────────────────────────────────── */
#define FLAG_RFID_OK      (1U << 0)
#define FLAG_GPS_FIX      (1U << 1)
#define FLAG_MP3_OK       (1U << 2)
#define FLAG_IWDG_RUNNING (1U << 3)

/* ── Callbacks ──────────────────────────────────────────────────────────── */

/* Invoked from Proto_Update() — always in task context, never in ISR. */
typedef struct {
    void (*on_play_audio) (uint8_t track);
    void (*on_set_volume) (uint8_t volume);
    void (*on_request_gps)(void);
    void (*on_hb_pi)      (void);
    void (*on_shutdown)   (void);
    void (*on_ack)        (uint8_t cmd_acked);
} Proto_Callbacks;

/* ── Parser state ───────────────────────────────────────────────────────── */
typedef enum {
    PSTATE_STX = 0,
    PSTATE_LEN,
    PSTATE_CMD,
    PSTATE_PAYLOAD,
    PSTATE_CRC,
} Proto_ParseState;

/* ── Handle ─────────────────────────────────────────────────────────────── */
typedef struct {
    UART_HandleTypeDef *huart;

    /* Circular RX buffer — written from ISR, drained in Proto_Update() */
    uint8_t          rx_buf[PROTO_RX_BUF_SIZE];
    volatile uint8_t rx_head;
    uint8_t          rx_tail;
    uint8_t          it_byte;  /* Staging byte for HAL_UART_Receive_IT */

    /* Parser state machine */
    Proto_ParseState parse_state;
    uint8_t          pkt_len;
    uint8_t          pkt_cmd;
    uint8_t          pkt_payload[PROTO_MAX_PAYLOAD];
    uint8_t          pkt_payload_idx;
    uint8_t          pkt_crc_calc;

    Proto_Callbacks  cb;

    uint32_t pkts_rx_ok;
    uint32_t pkts_rx_err;
    uint32_t pkts_tx;
} Proto_Handle;

/* ── API ────────────────────────────────────────────────────────────────── */

void Proto_Init  (Proto_Handle *h, UART_HandleTypeDef *huart,
                  const Proto_Callbacks *cb);
void Proto_RxISR (Proto_Handle *h);   /* Call from HAL_UART_RxCpltCallback  */
void Proto_Update(Proto_Handle *h);   /* Call from CommTask loop             */

void Proto_SendReady   (Proto_Handle *h);
void Proto_SendRfidUID (Proto_Handle *h, const uint8_t uid[4]);
void Proto_SendGpsData (Proto_Handle *h, float lat, float lon, float speed_kmh);
void Proto_SendGpsNoFix(Proto_Handle *h, uint8_t sat_count);
void Proto_SendHbStm32 (Proto_Handle *h, uint8_t flags);
void Proto_SendAck     (Proto_Handle *h, uint8_t cmd_acked);

#endif /* UART_PROTOCOL_H */
