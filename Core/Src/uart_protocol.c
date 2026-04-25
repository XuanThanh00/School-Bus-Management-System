/*
 * uart_protocol.c
 *
 * Giao thức UART giữa STM32 và Raspberry Pi 5
 *
 * Packet format:
 *   [0xAA] [LEN] [CMD] [PAYLOAD...] [CRC8]
 *   CRC8 = LEN ^ CMD ^ payload[0] ^ ... ^ payload[n-1]
 *
 *  Created on: Apr 8, 2026
 *      Author: Thanh
 */

#include "uart_protocol.h"
#include <string.h>
#include <stdio.h>
#include <stdarg.h>

/* ════════════════════════════════════════════
   INTERNAL — PARSE STATES
   ════════════════════════════════════════════ */
#define STATE_STX     0
#define STATE_LEN     1
#define STATE_CMD     2
#define STATE_PAYLOAD 3
#define STATE_CRC     4

/* ════════════════════════════════════════════
   INTERNAL — DEBUG
   ════════════════════════════════════════════ */
static void _dbg(Proto_Handle *h, const char *fmt, ...) {
    if (!h->huart_debug) return;
    char buf[80];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    HAL_UART_Transmit(h->huart_debug, (uint8_t *)buf, (uint16_t)strlen(buf), 30);
}

/* ════════════════════════════════════════════
   INTERNAL — CRC8
   ════════════════════════════════════════════ */
static uint8_t _crc8(uint8_t len, uint8_t cmd,
                     uint8_t *payload, uint8_t plen) {
    uint8_t crc = len ^ cmd;
    for (uint8_t i = 0; i < plen; i++) crc ^= payload[i];
    return crc;
}

/* ════════════════════════════════════════════
   INTERNAL — RAW SEND
   ════════════════════════════════════════════ */
static void _send_packet(Proto_Handle *h,
                         uint8_t cmd,
                         uint8_t *payload,
                         uint8_t plen) {
    /* Max frame = 1(STX) + 1(LEN) + 1(CMD) + 15(PAYLOAD) + 1(CRC) = 19 */
    uint8_t frame[19];
    uint8_t idx = 0;

    frame[idx++] = PROTO_STX;
    frame[idx++] = plen;          /* LEN */
    frame[idx++] = cmd;           /* CMD */
    for (uint8_t i = 0; i < plen; i++)
        frame[idx++] = payload[i];
    frame[idx++] = _crc8(plen, cmd, payload, plen);

    HAL_UART_Transmit(h->huart, frame, idx, 50);
    h->pkts_tx++;
}

/* ════════════════════════════════════════════
   INTERNAL — DISPATCH PARSED PACKET
   ════════════════════════════════════════════ */
static void _dispatch(Proto_Handle *h) {
    switch (h->pkt_cmd) {

    case CMD_ACK:
        /* Pi xác nhận packet nào đó */
        if (h->pkt_len >= 1 && h->cb_ack)
            h->cb_ack(h->pkt_payload[0]);
        break;

    case CMD_PLAY_AUDIO:
        if (h->pkt_len >= 1 && h->cb_play_audio)
            h->cb_play_audio(h->pkt_payload[0]);
        break;

    case CMD_SET_VOLUME:
        if (h->pkt_len >= 1 && h->cb_set_volume)
            h->cb_set_volume(h->pkt_payload[0]);
        break;

    case CMD_REQUEST_GPS:
        if (h->cb_request_gps)
            h->cb_request_gps();
        break;

    case CMD_HB_PI:
        if (h->cb_hb_pi)
            h->cb_hb_pi();
        break;

    case CMD_SHUTDOWN:
        if (h->cb_shutdown)
            h->cb_shutdown();
        break;

    default:
        _dbg(h, "[PROTO] Unknown CMD: 0x%02X\r\n", h->pkt_cmd);
        break;
    }
}

/* ════════════════════════════════════════════
   INTERNAL — PROCESS 1 BYTE (state machine)
   ════════════════════════════════════════════ */
static void _process_byte(Proto_Handle *h, uint8_t b) {
    switch (h->parse_state) {

    case STATE_STX:
        if (b == PROTO_STX) {
            h->parse_state   = STATE_LEN;
            h->pkt_crc_calc  = 0;
        }
        /* else: bỏ qua byte rác */
        break;

    case STATE_LEN:
        if (b > PROTO_MAX_PAYLOAD) {
            /* LEN vô lý → reset */
            _dbg(h, "[PROTO] Bad LEN=%u, reset\r\n", b);
            h->parse_state = STATE_STX;
            h->pkts_rx_err++;
            break;
        }
        h->pkt_len         = b;
        h->pkt_crc_calc    = b;        /* CRC bắt đầu với LEN */
        h->parse_state     = STATE_CMD;
        break;

    case STATE_CMD:
        h->pkt_cmd          = b;
        h->pkt_crc_calc    ^= b;       /* XOR với CMD */
        h->pkt_payload_idx  = 0;
        if (h->pkt_len == 0)
            h->parse_state = STATE_CRC;
        else
            h->parse_state = STATE_PAYLOAD;
        break;

    case STATE_PAYLOAD:
        h->pkt_payload[h->pkt_payload_idx++] = b;
        h->pkt_crc_calc ^= b;
        if (h->pkt_payload_idx >= h->pkt_len)
            h->parse_state = STATE_CRC;
        break;

    case STATE_CRC: {
        uint8_t crc_recv = b;
        if (crc_recv == h->pkt_crc_calc) {
            h->pkts_rx_ok++;
            _dispatch(h);
        } else {
            _dbg(h, "[PROTO] CRC err: got 0x%02X expect 0x%02X\r\n",
                 crc_recv, h->pkt_crc_calc);
            h->pkts_rx_err++;
        }
        h->parse_state = STATE_STX;   /* luôn reset sau CRC */
        break;
    }

    default:
        h->parse_state = STATE_STX;
        break;
    }
}

/* ════════════════════════════════════════════
   PUBLIC API — INIT
   ════════════════════════════════════════════ */
void Proto_Init(Proto_Handle *h,
                UART_HandleTypeDef *huart,
                UART_HandleTypeDef *huart_debug,
                Proto_CB_PlayAudio  cb_play,
                Proto_CB_SetVolume  cb_vol,
                Proto_CB_RequestGPS cb_gps,
                Proto_CB_HbPi       cb_hb,
                Proto_CB_Shutdown   cb_shutdown,
                Proto_CB_Ack        cb_ack)
{
    memset(h, 0, sizeof(Proto_Handle));

    h->huart        = huart;
    h->huart_debug  = huart_debug;

    h->cb_play_audio  = cb_play;
    h->cb_set_volume  = cb_vol;
    h->cb_request_gps = cb_gps;
    h->cb_hb_pi       = cb_hb;
    h->cb_shutdown    = cb_shutdown;
    h->cb_ack         = cb_ack;

    h->parse_state = STATE_STX;

    /* Bắt đầu nhận interrupt-driven, 1 byte mỗi lần */
    HAL_UART_Receive_IT(huart, &h->it_byte, 1);

    _dbg(h, "[PROTO] Init OK — waiting for Pi\r\n");
}

/* ════════════════════════════════════════════
   PUBLIC API — ISR (gọi từ HAL_UART_RxCpltCallback)
   ════════════════════════════════════════════ */
void Proto_RxISR(Proto_Handle *h) {
    /* Nạp byte vào circular buffer */
    uint16_t next = (h->rx_head + 1) % PROTO_RX_BUF_SIZE;
    if (next != h->rx_tail) {          /* buffer chưa đầy */
        h->rx_buf[h->rx_head] = h->it_byte;
        h->rx_head = next;
    }
    /* Tiếp tục nhận byte kế */
    HAL_UART_Receive_IT(h->huart, &h->it_byte, 1);
}

/* ════════════════════════════════════════════
   PUBLIC API — UPDATE (gọi trong while(1))
   ════════════════════════════════════════════ */
void Proto_Update(Proto_Handle *h) {
    while (h->rx_tail != h->rx_head) {
        uint8_t b = h->rx_buf[h->rx_tail];
        h->rx_tail = (h->rx_tail + 1) % PROTO_RX_BUF_SIZE;
        _process_byte(h, b);
    }
}

/* ════════════════════════════════════════════
   PUBLIC API — SEND COMMANDS (STM32 → Pi)
   ════════════════════════════════════════════ */

void Proto_SendReady(Proto_Handle *h) {
    _send_packet(h, CMD_READY, NULL, 0);
    _dbg(h, "[PROTO] Sent READY\r\n");
}

void Proto_SendRfidUID(Proto_Handle *h, uint8_t uid[4]) {
    _send_packet(h, CMD_RFID_UID, uid, 4);
    _dbg(h, "[PROTO] Sent RFID_UID: %02X%02X%02X%02X\r\n",
         uid[0], uid[1], uid[2], uid[3]);
}

void Proto_SendGpsData(Proto_Handle *h, float lat, float lon) {
    uint8_t payload[8];
    memcpy(&payload[0], &lat, 4);   /* float little-endian */
    memcpy(&payload[4], &lon, 4);
    _send_packet(h, CMD_GPS_DATA, payload, 8);
    _dbg(h, "[PROTO] Sent GPS_DATA (legacy): %.6f, %.6f\r\n", lat, lon);
}

void Proto_SendGpsDataFull(Proto_Handle *h, float lat, float lon, float speed_kmh) {
    uint8_t payload[12];
    memcpy(&payload[0], &lat,       4);   /* float little-endian */
    memcpy(&payload[4], &lon,       4);
    memcpy(&payload[8], &speed_kmh, 4);
    _send_packet(h, CMD_GPS_DATA, payload, 12);
    _dbg(h, "[PROTO] Sent GPS_DATA: %.6f, %.6f, %.1f km/h\r\n", lat, lon, speed_kmh);
}

void Proto_SendGpsNoFix(Proto_Handle *h, uint8_t sat_count) {
    _send_packet(h, CMD_GPS_NO_FIX, &sat_count, 1);
    _dbg(h, "[PROTO] Sent GPS_NO_FIX: sat=%u\r\n", sat_count);
}

void Proto_SendHbStm32(Proto_Handle *h, uint8_t flags) {
    _send_packet(h, CMD_HB_STM32, &flags, 1);
    /* Không debug HB để tránh spam */
}

void Proto_SendAck(Proto_Handle *h, uint8_t cmd_acked) {
    _send_packet(h, CMD_ACK, &cmd_acked, 1);
    _dbg(h, "[PROTO] Sent ACK for 0x%02X\r\n", cmd_acked);
}
