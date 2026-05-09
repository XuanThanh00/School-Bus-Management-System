#include "rc522.h"
#include <string.h>
#include <stdio.h>
#include <stdarg.h>

/* ── Register addresses ─────────────────────────────────────────────────── */
#define REG_COMMAND      0x01
#define REG_COM_IEN      0x02
#define REG_DIV_IEN      0x03
#define REG_COM_IRQ      0x04
#define REG_DIV_IRQ      0x05
#define REG_ERROR        0x06
#define REG_FIFO_DATA    0x09
#define REG_FIFO_LEVEL   0x0A
#define REG_CONTROL      0x0C
#define REG_BIT_FRAMING  0x0D
#define REG_MODE         0x11
#define REG_TX_CONTROL   0x14
#define REG_TX_AUTO      0x15
#define REG_CRC_RESULT_H 0x21
#define REG_CRC_RESULT_L 0x22
#define REG_RF_CFG       0x26
#define REG_VERSION      0x37
#define REG_TMODE        0x2A
#define REG_TPRESCALER   0x2B
#define REG_TRELOAD_H    0x2C
#define REG_TRELOAD_L    0x2D

/* ── Internal commands ──────────────────────────────────────────────────── */
#define CMD_IDLE        0x00
#define CMD_CALC_CRC    0x03
#define CMD_TRANSCEIVE  0x0C
#define CMD_SOFT_RESET  0x0F

/* ── ISO14443A card commands ────────────────────────────────────────────── */
#define PICC_REQA       0x26
#define PICC_SEL_CL1    0x93
#define PICC_ANTICOLL_1 0x20

/* ── Debug helper ───────────────────────────────────────────────────────── */
static void _dbg(RC522_Handle *h, const char *fmt, ...) {
    if (!h->huart_dbg) return;
    char buf[80];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    HAL_UART_Transmit(h->huart_dbg, (uint8_t *)buf, (uint16_t)strlen(buf), 50);
}

/* ── SPI primitives ─────────────────────────────────────────────────────── */
static inline void _cs_low (RC522_Handle *h) { HAL_GPIO_WritePin(h->cs_port, h->cs_pin, GPIO_PIN_RESET); }
static inline void _cs_high(RC522_Handle *h) { HAL_GPIO_WritePin(h->cs_port, h->cs_pin, GPIO_PIN_SET);   }

static void _write_reg(RC522_Handle *h, uint8_t reg, uint8_t val) {
    uint8_t tx[2] = { (reg << 1) & 0x7E, val };
    _cs_low(h);
    HAL_SPI_Transmit(h->hspi, tx, 2, 10);
    _cs_high(h);
}

static uint8_t _read_reg(RC522_Handle *h, uint8_t reg) {
    uint8_t tx = ((reg << 1) & 0x7E) | 0x80;
    uint8_t rx = 0;
    _cs_low(h);
    HAL_SPI_Transmit(h->hspi, &tx, 1, 10);
    HAL_SPI_Receive (h->hspi, &rx, 1, 10);
    _cs_high(h);
    return rx;
}

static void _set_bits(RC522_Handle *h, uint8_t reg, uint8_t mask) { _write_reg(h, reg, _read_reg(h, reg) |  mask); }
static void _clr_bits(RC522_Handle *h, uint8_t reg, uint8_t mask) { _write_reg(h, reg, _read_reg(h, reg) & ~mask); }
static void _flush_fifo(RC522_Handle *h) { _set_bits(h, REG_FIFO_LEVEL, 0x80); }

/* ── Hardware CRC calculation ───────────────────────────────────────────── */
static RC522_Status _calc_crc(RC522_Handle *h, uint8_t *data, uint8_t len, uint8_t *out) {
    _write_reg(h, REG_COMMAND, CMD_IDLE);
    _flush_fifo(h);
    _clr_bits(h, REG_DIV_IRQ, 0x04);

    for (uint8_t i = 0; i < len; i++)
        _write_reg(h, REG_FIFO_DATA, data[i]);

    _write_reg(h, REG_COMMAND, CMD_CALC_CRC);

    uint16_t t = 5000;
    while (--t)
        if (_read_reg(h, REG_DIV_IRQ) & 0x04) break;

    if (!t) return RC522_ERR_TIMEOUT;

    _write_reg(h, REG_COMMAND, CMD_IDLE);
    out[0] = _read_reg(h, REG_CRC_RESULT_L);
    out[1] = _read_reg(h, REG_CRC_RESULT_H);
    return RC522_OK;
}

/* ── ISO14443A transceive ───────────────────────────────────────────────── */
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
    _set_bits(h, REG_BIT_FRAMING, 0x80);

    uint16_t t = 2000;
    uint8_t  irq;
    do {
        irq = _read_reg(h, REG_COM_IRQ);
        if (!--t) return RC522_ERR_TIMEOUT;
    } while (!(irq & 0x31));

    _clr_bits(h, REG_BIT_FRAMING, 0x80);

    if (irq & 0x01)                      return RC522_ERR_NOTAG; /* timer expired = no card */
    if (_read_reg(h, REG_ERROR) & 0x1B)  return RC522_ERR_CRC;

    uint8_t n = _read_reg(h, REG_FIFO_LEVEL);
    if (rx_len) *rx_len = n;
    for (uint8_t i = 0; i < n && i < 16; i++)
        rx_buf[i] = _read_reg(h, REG_FIFO_DATA);

    return RC522_OK;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

void RC522_Init(RC522_Handle *h,
                SPI_HandleTypeDef  *hspi,
                UART_HandleTypeDef *huart_dbg,
                GPIO_TypeDef *cs_port, uint16_t cs_pin,
                GPIO_TypeDef *rst_port, uint16_t rst_pin)
{
    h->hspi      = hspi;
    h->huart_dbg = huart_dbg;
    h->cs_port   = cs_port;
    h->cs_pin    = cs_pin;
    h->rst_port  = rst_port;
    h->rst_pin   = rst_pin;

    /* Hardware reset: RST low → delay → high → stabilise before SPI access */
    HAL_GPIO_WritePin(h->rst_port, h->rst_pin, GPIO_PIN_RESET);
    HAL_Delay(1);
    HAL_GPIO_WritePin(h->rst_port, h->rst_pin, GPIO_PIN_SET);
    HAL_Delay(50);

    _write_reg(h, REG_COMMAND, CMD_SOFT_RESET);
    HAL_Delay(10);

    uint8_t ver = _read_reg(h, REG_VERSION);
    _dbg(h, "[RC522] Chip ver 0x%02X%s\r\n", ver,
         (ver == 0x91 || ver == 0x92) ? " OK" : " WARN:check wiring");

    _write_reg(h, REG_TX_AUTO, 0x40);
    _write_reg(h, REG_MODE,    0x3D);
    _write_reg(h, REG_RF_CFG,  0x70);

    /* Timer: auto-start after TX, prescaler → ~2 kHz, reload=30 → ~15 ms timeout */
    _write_reg(h, REG_TMODE,      0x8D);
    _write_reg(h, REG_TPRESCALER, 0x3E);
    _write_reg(h, REG_TRELOAD_H,  0x00);
    _write_reg(h, REG_TRELOAD_L,  0x1E);

    uint8_t tx = _read_reg(h, REG_TX_CONTROL);
    if (!(tx & 0x03)) _set_bits(h, REG_TX_CONTROL, 0x03);
}

RC522_Status RC522_ReadUID(RC522_Handle *h, RC522_UID *uid) {
    uint8_t rx[16];
    uint8_t rx_len;
    RC522_Status st;

    /* REQA — wake all cards in field */
    _write_reg(h, REG_BIT_FRAMING, 0x07);
    uint8_t reqa = PICC_REQA;
    if (_transceive(h, &reqa, 1, rx, &rx_len) != RC522_OK)
        return RC522_ERR_NOTAG;

    /* Anti-collision — receive 4-byte UID + BCC */
    _write_reg(h, REG_BIT_FRAMING, 0x00);
    uint8_t anticoll[2] = { PICC_SEL_CL1, PICC_ANTICOLL_1 };
    st = _transceive(h, anticoll, 2, rx, &rx_len);
    if (st != RC522_OK || rx_len < 5) return RC522_ERR_NOTAG;

    uint8_t bcc = rx[0] ^ rx[1] ^ rx[2] ^ rx[3];
    if (bcc != rx[4]) return RC522_ERR_CRC;

    /* SELECT — confirm UID, card replies with SAK */
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
    st = _transceive(h, sel, 9, rx, &rx_len);
    if (st != RC522_OK) return st;

    uid->size = 4;
    memcpy(uid->bytes, &sel[2], 4);

    /* HALT — put card to sleep so next poll starts fresh */
    uint8_t halt[4] = { 0x50, 0x00, 0, 0 };
    _calc_crc(h, halt, 2, &halt[2]);
    _transceive(h, halt, 4, rx, &rx_len);

    return RC522_OK;
}

void RC522_UIDtoString(const RC522_UID *uid, char *out) {
    sprintf(out, "%02X%02X%02X%02X",
            uid->bytes[0], uid->bytes[1],
            uid->bytes[2], uid->bytes[3]);
}

bool RC522_UIDEqual(const RC522_UID *a, const RC522_UID *b) {
    return memcmp(a->bytes, b->bytes, 4) == 0;
}
