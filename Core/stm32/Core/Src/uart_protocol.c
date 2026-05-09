#include "uart_protocol.h"
#include <string.h>

/* ── Frame builder ──────────────────────────────────────────────────────── */
static uint8_t _crc8(uint8_t len, uint8_t cmd, const uint8_t *payload, uint8_t plen) {
    uint8_t crc = len ^ cmd;
    for (uint8_t i = 0; i < plen; i++) crc ^= payload[i];
    return crc;
}

static void _send_packet(Proto_Handle *h, uint8_t cmd,
                          const uint8_t *payload, uint8_t plen) {
    /* Max frame size: 1(STX)+1(LEN)+1(CMD)+15(PAYLOAD)+1(CRC) = 19 bytes */
    uint8_t frame[19];
    uint8_t idx = 0;

    frame[idx++] = PROTO_STX;
    frame[idx++] = plen;
    frame[idx++] = cmd;
    for (uint8_t i = 0; i < plen; i++) frame[idx++] = payload[i];
    frame[idx++] = _crc8(plen, cmd, payload, plen);

    HAL_UART_Transmit(h->huart, frame, idx, 50);
    h->pkts_tx++;
}

/* ── Callback dispatch ──────────────────────────────────────────────────── */
static void _dispatch(Proto_Handle *h) {
    switch (h->pkt_cmd) {
    case CMD_PLAY_AUDIO:
        if (h->pkt_len >= 1 && h->cb.on_play_audio)
            h->cb.on_play_audio(h->pkt_payload[0]);
        break;
    case CMD_SET_VOLUME:
        if (h->pkt_len >= 1 && h->cb.on_set_volume)
            h->cb.on_set_volume(h->pkt_payload[0]);
        break;
    case CMD_REQUEST_GPS:
        if (h->cb.on_request_gps)
            h->cb.on_request_gps();
        break;
    case CMD_HB_PI:
        if (h->cb.on_hb_pi)
            h->cb.on_hb_pi();
        break;
    case CMD_SHUTDOWN:
        if (h->cb.on_shutdown)
            h->cb.on_shutdown();
        break;
    case CMD_ACK:
        if (h->pkt_len >= 1 && h->cb.on_ack)
            h->cb.on_ack(h->pkt_payload[0]);
        break;
    default:
        break;
    }
}

/* ── Parser state machine — one byte at a time ──────────────────────────── */
static void _process_byte(Proto_Handle *h, uint8_t b) {
    switch (h->parse_state) {

    case PSTATE_STX:
        if (b == PROTO_STX) {
            h->parse_state  = PSTATE_LEN;
            h->pkt_crc_calc = 0;
        }
        break;

    case PSTATE_LEN:
        if (b > PROTO_MAX_PAYLOAD) {
            h->parse_state = PSTATE_STX;
            h->pkts_rx_err++;
            break;
        }
        h->pkt_len      = b;
        h->pkt_crc_calc = b;
        h->parse_state  = PSTATE_CMD;
        break;

    case PSTATE_CMD:
        h->pkt_cmd         = b;
        h->pkt_crc_calc   ^= b;
        h->pkt_payload_idx = 0;
        h->parse_state     = (h->pkt_len == 0) ? PSTATE_CRC : PSTATE_PAYLOAD;
        break;

    case PSTATE_PAYLOAD:
        h->pkt_payload[h->pkt_payload_idx++] = b;
        h->pkt_crc_calc ^= b;
        if (h->pkt_payload_idx >= h->pkt_len)
            h->parse_state = PSTATE_CRC;
        break;

    case PSTATE_CRC:
        if (b == h->pkt_crc_calc) {
            h->pkts_rx_ok++;
            _dispatch(h);
        } else {
            h->pkts_rx_err++;
        }
        h->parse_state = PSTATE_STX;
        break;

    default:
        h->parse_state = PSTATE_STX;
        break;
    }
}

/* ── Public API ─────────────────────────────────────────────────────────── */

void Proto_Init(Proto_Handle *h, UART_HandleTypeDef *huart,
                const Proto_Callbacks *cb) {
    memset(h, 0, sizeof(Proto_Handle));
    h->huart = huart;
    h->cb    = *cb;
    HAL_UART_Receive_IT(huart, &h->it_byte, 1);
}

void Proto_RxISR(Proto_Handle *h) {
    /* Store byte in circular buffer; called from HAL_UART_RxCpltCallback (ISR). */
    uint8_t next = (uint8_t)((h->rx_head + 1U) % PROTO_RX_BUF_SIZE);
    if (next != h->rx_tail) {
        h->rx_buf[h->rx_head] = h->it_byte;
        h->rx_head = next;
    }
    HAL_UART_Receive_IT(h->huart, &h->it_byte, 1);
}

void Proto_Update(Proto_Handle *h) {
    while (h->rx_tail != h->rx_head) {
        uint8_t b  = h->rx_buf[h->rx_tail];
        h->rx_tail = (uint8_t)((h->rx_tail + 1U) % PROTO_RX_BUF_SIZE);
        _process_byte(h, b);
    }
}

/* ── TX helpers ─────────────────────────────────────────────────────────── */

void Proto_SendReady(Proto_Handle *h) {
    _send_packet(h, CMD_READY, NULL, 0);
}

void Proto_SendRfidUID(Proto_Handle *h, const uint8_t uid[4]) {
    _send_packet(h, CMD_RFID_UID, uid, 4);
}

void Proto_SendGpsData(Proto_Handle *h, float lat, float lon, float speed_kmh) {
    uint8_t payload[12];
    memcpy(&payload[0], &lat,       4);
    memcpy(&payload[4], &lon,       4);
    memcpy(&payload[8], &speed_kmh, 4);
    _send_packet(h, CMD_GPS_DATA, payload, 12);
}

void Proto_SendGpsNoFix(Proto_Handle *h, uint8_t sat_count) {
    _send_packet(h, CMD_GPS_NO_FIX, &sat_count, 1);
}

void Proto_SendHbStm32(Proto_Handle *h, uint8_t flags) {
    _send_packet(h, CMD_HB_STM32, &flags, 1);
}

void Proto_SendAck(Proto_Handle *h, uint8_t cmd_acked) {
    _send_packet(h, CMD_ACK, &cmd_acked, 1);
}
