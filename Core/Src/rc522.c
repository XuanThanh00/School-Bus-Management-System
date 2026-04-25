/*
 * rc522.c
 *
 *  Created on: Apr 7, 2026
 *      Author: Thanh
 */

#include "rc522.h"
#include <string.h>
#include <stdio.h>
#include <stdarg.h>

/* ════════════════════════════════════════════
   REGISTER MAP
   ════════════════════════════════════════════ */
#define REG_COMMAND       0x01
#define REG_COM_IEN       0x02
#define REG_DIV_IEN       0x03
#define REG_COM_IRQ       0x04
#define REG_DIV_IRQ       0x05
#define REG_ERROR         0x06
#define REG_FIFO_DATA     0x09
#define REG_FIFO_LEVEL    0x0A
#define REG_CONTROL       0x0C
#define REG_BIT_FRAMING   0x0D
#define REG_MODE          0x11
#define REG_TX_CONTROL    0x14
#define REG_TX_AUTO       0x15
#define REG_CRC_RESULT_H  0x21
#define REG_CRC_RESULT_L  0x22
#define REG_RF_CFG        0x26
#define REG_VERSION       0x37

#define CMD_IDLE          0x00
#define CMD_CALC_CRC      0x03
#define CMD_TRANSCEIVE    0x0C
#define CMD_SOFT_RESET    0x0F

#define PICC_REQA         0x26
#define PICC_SEL_CL1      0x93
#define PICC_ANTICOLL_1   0x20

/* ════════════════════════════════════════════
   DEBUG HELPER
   ════════════════════════════════════════════ */
static void _debug(RC522_Handle *h, const char *msg) {
    if (!h->huart_debug) return;
    HAL_UART_Transmit(h->huart_debug,
                      (uint8_t *)msg,
                      (uint16_t)strlen(msg),
                      50);
}

static void _debug_fmt(RC522_Handle *h, const char *fmt, ...) {
    if (!h->huart_debug) return;
    char buf[80];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    HAL_UART_Transmit(h->huart_debug,
                      (uint8_t *)buf,
                      (uint16_t)strlen(buf),
                      50);
}

/* ════════════════════════════════════════════
   LOW-LEVEL SPI
   ════════════════════════════════════════════ */
static inline void _cs_low(RC522_Handle *h) {
    HAL_GPIO_WritePin(h->cs_port, h->cs_pin, GPIO_PIN_RESET);
}

static inline void _cs_high(RC522_Handle *h) {
    HAL_GPIO_WritePin(h->cs_port, h->cs_pin, GPIO_PIN_SET);
}

static void _write_reg(RC522_Handle *h, uint8_t reg, uint8_t val) {
    // Byte đầu: bit7=0 (write), bit[6:1]=addr, bit0=0
    uint8_t tx[2] = { (reg << 1) & 0x7E, val };
    _cs_low(h);
    HAL_SPI_Transmit(h->hspi, tx, 2, 10);
    _cs_high(h);
}

static uint8_t _read_reg(RC522_Handle *h, uint8_t reg) {
    // Byte đầu: bit7=1 (read), bit[6:1]=addr, bit0=0
    uint8_t tx = ((reg << 1) & 0x7E) | 0x80;
    uint8_t rx = 0;
    _cs_low(h);
    HAL_SPI_Transmit(h->hspi, &tx, 1, 10);
    HAL_SPI_Receive(h->hspi, &rx, 1, 10);
    _cs_high(h);
    return rx;
}

static void _set_bits(RC522_Handle *h, uint8_t reg, uint8_t mask) {
    _write_reg(h, reg, _read_reg(h, reg) | mask);
}

static void _clr_bits(RC522_Handle *h, uint8_t reg, uint8_t mask) {
    _write_reg(h, reg, _read_reg(h, reg) & ~mask);
}

/* ════════════════════════════════════════════
   CORE HELPERS
   ════════════════════════════════════════════ */
static void _flush_fifo(RC522_Handle *h) {
    _set_bits(h, REG_FIFO_LEVEL, 0x80);
}

static RC522_Status _calc_crc(RC522_Handle *h,
                               uint8_t *data, uint8_t len,
                               uint8_t *crc_out) {
    _write_reg(h, REG_COMMAND, CMD_IDLE);
    _flush_fifo(h);
    _clr_bits(h, REG_DIV_IRQ, 0x04);

    for (uint8_t i = 0; i < len; i++)
        _write_reg(h, REG_FIFO_DATA, data[i]);

    _write_reg(h, REG_COMMAND, CMD_CALC_CRC);

    uint16_t timeout = 5000;
    while (--timeout)
        if (_read_reg(h, REG_DIV_IRQ) & 0x04) break;

    if (!timeout) {
        _debug(h, "[RC522] CRC timeout\r\n");
        return RC522_ERR_TIMEOUT;
    }

    _write_reg(h, REG_COMMAND, CMD_IDLE);
    crc_out[0] = _read_reg(h, REG_CRC_RESULT_L);
    crc_out[1] = _read_reg(h, REG_CRC_RESULT_H);
    return RC522_OK;
}

static RC522_Status _transceive(RC522_Handle *h,
                                 uint8_t *tx_buf, uint8_t tx_len,
                                 uint8_t *rx_buf, uint8_t *rx_len) {
    _write_reg(h, REG_COM_IEN, 0x77);
    _clr_bits(h, REG_COM_IRQ, 0x80);
    _write_reg(h, REG_COMMAND, CMD_IDLE);
    _flush_fifo(h);

    for (uint8_t i = 0; i < tx_len; i++)
        _write_reg(h, REG_FIFO_DATA, tx_buf[i]);

    _write_reg(h, REG_COMMAND, CMD_TRANSCEIVE);
    _set_bits(h, REG_BIT_FRAMING, 0x80);  // StartSend

    uint16_t timeout = 2000;
    uint8_t  irq;
    do {
        irq = _read_reg(h, REG_COM_IRQ);
        if (!--timeout) return RC522_ERR_TIMEOUT;
    } while (!(irq & 0x31));

    _clr_bits(h, REG_BIT_FRAMING, 0x80);

    if (_read_reg(h, REG_ERROR) & 0x1B) return RC522_ERR_CRC;
    if (!(irq & 0x01) && (irq & 0x10))  return RC522_ERR_NOTAG;

    uint8_t n = _read_reg(h, REG_FIFO_LEVEL);
    if (rx_len) *rx_len = n;
    for (uint8_t i = 0; i < n && i < 16; i++)
        rx_buf[i] = _read_reg(h, REG_FIFO_DATA);

    return RC522_OK;
}

/* ════════════════════════════════════════════
   PUBLIC API
   ════════════════════════════════════════════ */
void RC522_Init(RC522_Handle *h,
                SPI_HandleTypeDef  *hspi,
                UART_HandleTypeDef *huart_debug,
                GPIO_TypeDef *cs_port,  uint16_t cs_pin,
                GPIO_TypeDef *rst_port, uint16_t rst_pin)
{
    h->hspi        = hspi;
    h->huart_debug = huart_debug;
    h->cs_port     = cs_port;
    h->cs_pin      = cs_pin;
    h->rst_port    = rst_port;
    h->rst_pin     = rst_pin;

    /* Hard reset */
//    HAL_GPIO_WritePin(rst_port, rst_pin, GPIO_PIN_RESET);
//    HAL_Delay(10);
//    HAL_GPIO_WritePin(rst_port, rst_pin, GPIO_PIN_SET);
//    HAL_Delay(50);

    /* Soft reset */
    _write_reg(h, REG_COMMAND, CMD_SOFT_RESET);
    HAL_Delay(10);

    /* Đọc version — xác nhận SPI đang hoạt động */
    uint8_t ver = _read_reg(h, REG_VERSION);
    _debug_fmt(h, "[RC522] Init — Chip version: 0x%02X", ver);
    if (ver == 0x91 || ver == 0x92)
        _debug(h, " (OK)\r\n");
    else
        _debug(h, " (WARNING: unexpected, check wiring)\r\n");

    /* Config */
    _write_reg(h, REG_TX_AUTO,  0x40);
    _write_reg(h, REG_MODE,     0x3D);
    _write_reg(h, REG_RF_CFG,   0x70);

    /* Bật antenna */
    uint8_t tx = _read_reg(h, REG_TX_CONTROL);
    if (!(tx & 0x03)) _set_bits(h, REG_TX_CONTROL, 0x03);

    _debug(h, "[RC522] Antenna ON — Ready\r\n");
}

RC522_Status RC522_ReadUID(RC522_Handle *h, RC522_UID *uid) {
    RC522_Status status;
    uint8_t rx[16];
    uint8_t rx_len;

    /* ── Bước 1: REQA ── */
    _write_reg(h, REG_BIT_FRAMING, 0x07);
    uint8_t reqa = PICC_REQA;
    status = _transceive(h, &reqa, 1, rx, &rx_len);
    if (status != RC522_OK) return RC522_ERR_NOTAG;

    /* ── Bước 2: Anti-collision ── */
    _write_reg(h, REG_BIT_FRAMING, 0x00);
    uint8_t anticoll[2] = { PICC_SEL_CL1, PICC_ANTICOLL_1 };
    status = _transceive(h, anticoll, 2, rx, &rx_len);
    if (status != RC522_OK || rx_len < 5) return status;

    /* Kiểm tra BCC */
    uint8_t bcc = rx[0] ^ rx[1] ^ rx[2] ^ rx[3];
    if (bcc != rx[4]) {
        _debug(h, "[RC522] BCC error\r\n");
        return RC522_ERR_CRC;
    }

    /* ── Bước 3: Select ── */
    uint8_t sel[9];
    sel[0] = PICC_SEL_CL1;
    sel[1] = 0x70;
    memcpy(&sel[2], rx, 4);
    sel[6] = bcc;
    uint8_t crc[2];
    _calc_crc(h, sel, 7, crc);
    sel[7] = crc[0];
    sel[8] = crc[1];

    _write_reg(h, REG_BIT_FRAMING, 0x00);
    status = _transceive(h, sel, 9, rx, &rx_len);
    if (status != RC522_OK) return status;

    uid->size = 4;
    memcpy(uid->bytes, &sel[2], 4);

    /* ── Debug: in raw hex + string ── */
    _debug_fmt(h,
        "[RC522] UID raw : %02X %02X %02X %02X\r\n",
        uid->bytes[0], uid->bytes[1],
        uid->bytes[2], uid->bytes[3]);

    char uid_str[9];
    RC522_UIDtoString(uid, uid_str);
    _debug_fmt(h, "[RC522] UID str : %s\r\n", uid_str);

    /* HALT */
    uint8_t halt[4] = { 0x50, 0x00, 0, 0 };
    _calc_crc(h, halt, 2, &halt[2]);
    _transceive(h, halt, 4, rx, &rx_len);

    return RC522_OK;
}

void RC522_UIDtoString(RC522_UID *uid, char *buf) {
    sprintf(buf, "%02X%02X%02X%02X",
            uid->bytes[0], uid->bytes[1],
            uid->bytes[2], uid->bytes[3]);
}

bool RC522_UIDEqual(RC522_UID *a, RC522_UID *b) {
    return memcmp(a->bytes, b->bytes, 4) == 0;
}
