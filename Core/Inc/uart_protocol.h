/*
 * uart_protocol.h
 *
 * Giao thức UART giữa STM32 và Raspberry Pi 5
 * Packet format: [0xAA][LEN][CMD][PAYLOAD 0..15B][CRC8]
 * CRC8 = XOR của (LEN ^ CMD ^ tất cả PAYLOAD bytes)
 *
 *  Created on: Apr 8, 2026
 *      Author: Thanh
 */

#ifndef INC_UART_PROTOCOL_H_
#define INC_UART_PROTOCOL_H_

#include "stm32f1xx_hal.h"
#include <stdint.h>
#include <stdbool.h>

/* ════════════════════════════════════════════
   CONSTANTS
   ════════════════════════════════════════════ */

#define PROTO_STX           0xAA
#define PROTO_MAX_PAYLOAD   15
#define PROTO_RX_BUF_SIZE   64   /* circular buffer cho IT receive */

/* ════════════════════════════════════════════
   COMMAND TABLE
   ════════════════════════════════════════════ */

/* STM32 → Pi */
#define CMD_RFID_UID        0x01  /* payload: 4B uid (hex bytes) */
#define CMD_GPS_DATA        0x02  /* payload: 12B = 4B lat + 4B lon + 4B speed_kmh (float LE) */
                                  /* (legacy: 8B = lat+lon only, backwards-compat) */
#define CMD_HB_STM32        0x05  /* payload: 1B flags (bitmask) */
#define CMD_GPS_NO_FIX      0x06  /* payload: 1B sat_count */
#define CMD_READY           0x09  /* payload: none */

/* Pi → STM32 */
#define CMD_PLAY_AUDIO      0x03  /* payload: 1B track number */
#define CMD_ACK             0x04  /* payload: 1B cmd_acked */
#define CMD_REQUEST_GPS     0x07  /* payload: none */
#define CMD_SET_VOLUME      0x08  /* payload: 1B volume (0-30) */
#define CMD_HB_PI           0x0A  /* payload: none */
#define CMD_SHUTDOWN        0x0B  /* payload: none */

/* HB_STM32 status_flags bitmask */
#define FLAG_RFID_OK        (1 << 0)
#define FLAG_GPS_FIX        (1 << 1)
#define FLAG_MP3_OK         (1 << 2)
#define FLAG_IWDG_RUNNING   (1 << 3)

/* ════════════════════════════════════════════
   CALLBACK TYPEDEFS
   ════════════════════════════════════════════ */

/*
 * Các callback này được gọi từ Proto_Update() khi parse xong packet hợp lệ.
 * Implement trong main.c và truyền vào Proto_Init().
 */
typedef void (*Proto_CB_PlayAudio)  (uint8_t track);
typedef void (*Proto_CB_SetVolume)  (uint8_t vol);
typedef void (*Proto_CB_RequestGPS) (void);
typedef void (*Proto_CB_HbPi)       (void);
typedef void (*Proto_CB_Shutdown)   (void);
typedef void (*Proto_CB_Ack)        (uint8_t cmd_acked);

/* ════════════════════════════════════════════
   HANDLE
   ════════════════════════════════════════════ */

typedef struct {
    /* UART hardware */
    UART_HandleTypeDef *huart;          /* USART3 */
    UART_HandleTypeDef *huart_debug;    /* USART1, NULL = tắt debug */

    /* Circular RX buffer (nạp bởi HAL IT) */
    volatile uint8_t rx_buf[PROTO_RX_BUF_SIZE];
    volatile uint16_t rx_head;          /* ISR ghi vào đây */
    volatile uint16_t rx_tail;          /* Proto_Update() đọc từ đây */

    /* Parse state machine */
    uint8_t  parse_state;              /* 0=STX, 1=LEN, 2=CMD, 3=PAYLOAD, 4=CRC */
    uint8_t  pkt_len;
    uint8_t  pkt_cmd;
    uint8_t  pkt_payload[PROTO_MAX_PAYLOAD];
    uint8_t  pkt_payload_idx;
    uint8_t  pkt_crc_calc;

    /* Callbacks */
    Proto_CB_PlayAudio  cb_play_audio;
    Proto_CB_SetVolume  cb_set_volume;
    Proto_CB_RequestGPS cb_request_gps;
    Proto_CB_HbPi       cb_hb_pi;
    Proto_CB_Shutdown   cb_shutdown;
    Proto_CB_Ack        cb_ack;

    /* Stats (debug) */
    uint32_t pkts_rx_ok;
    uint32_t pkts_rx_err;
    uint32_t pkts_tx;

    /* Byte đơn cho HAL_UART_Receive_IT */
    uint8_t it_byte;
} Proto_Handle;

/* ════════════════════════════════════════════
   PUBLIC API
   ════════════════════════════════════════════ */

/**
 * @brief Khởi tạo protocol handle, bắt đầu receive IT.
 *        Gọi 1 lần trong main() sau MX_USART3_UART_Init().
 */
void Proto_Init(Proto_Handle *h,
                UART_HandleTypeDef *huart,
                UART_HandleTypeDef *huart_debug,
                Proto_CB_PlayAudio  cb_play,
                Proto_CB_SetVolume  cb_vol,
                Proto_CB_RequestGPS cb_gps,
                Proto_CB_HbPi       cb_hb,
                Proto_CB_Shutdown   cb_shutdown,
                Proto_CB_Ack        cb_ack);

/**
 * @brief Gọi trong while(1). Drain RX buffer và dispatch callbacks.
 */
void Proto_Update(Proto_Handle *h);

/**
 * @brief Gọi từ HAL_UART_RxCpltCallback() để nạp byte vào circular buffer.
 *        Chỉ gọi nếu huart == h->huart.
 */
void Proto_RxISR(Proto_Handle *h);

/* ── STM32 → Pi: send commands ── */

/** Gửi 0x09 READY (STM32 init xong, chờ ACK từ Pi) */
void Proto_SendReady(Proto_Handle *h);

/** Gửi 0x01 RFID_UID — uid: 4 bytes raw */
void Proto_SendRfidUID(Proto_Handle *h, uint8_t uid[4]);

/** Gửi 0x02 GPS_DATA — lat/lon/speed_kmh float little-endian (12B payload) */
void Proto_SendGpsDataFull(Proto_Handle *h, float lat, float lon, float speed_kmh);

/** Gửi 0x02 GPS_DATA — legacy 8B (lat/lon), giữ để tương thích */
void Proto_SendGpsData(Proto_Handle *h, float lat, float lon);

/** Gửi 0x06 GPS_NO_FIX — sat_count: số vệ tinh đang thấy */
void Proto_SendGpsNoFix(Proto_Handle *h, uint8_t sat_count);

/**
 * @brief Gửi 0x05 HB_STM32.
 * @param flags  Tổ hợp FLAG_RFID_OK | FLAG_GPS_FIX | FLAG_MP3_OK | FLAG_IWDG_RUNNING
 */
void Proto_SendHbStm32(Proto_Handle *h, uint8_t flags);

/** Gửi 0x04 ACK cho một CMD nào đó */
void Proto_SendAck(Proto_Handle *h, uint8_t cmd_acked);

#endif /* INC_UART_PROTOCOL_H_ */
