#include "mp3.h"

/* ── YX5200 / DFRobot MP3 serial protocol ───────────────────────────────── */
#define MP3_CMD_PLAY_TRACK 0x03
#define MP3_CMD_SET_VOL    0x06
#define MP3_CMD_RESET      0x0C
#define MP3_CMD_PLAY       0x0D
#define MP3_CMD_PAUSE      0x0E
#define MP3_CMD_STOP       0x16

static void _send(MP3_Handle *h, uint8_t cmd, uint8_t p1, uint8_t p2) {
    uint8_t pkt[10];
    pkt[0] = 0x7E;
    pkt[1] = 0xFF;
    pkt[2] = 0x06;
    pkt[3] = cmd;
    pkt[4] = 0x00;  /* No feedback byte requested */
    pkt[5] = p1;
    pkt[6] = p2;

    /* Checksum = two's complement of sum of bytes 1..6 */
    int16_t chk = 0;
    for (uint8_t i = 1; i <= 6; i++) chk -= (int16_t)pkt[i];
    pkt[7] = (uint8_t)(chk >> 8);
    pkt[8] = (uint8_t)(chk & 0xFF);
    pkt[9] = 0xEF;

    HAL_UART_Transmit(h->huart, pkt, 10, 50);
    HAL_Delay(20);  /* Module needs time between commands */
}

/* ── Public API ─────────────────────────────────────────────────────────── */

void MP3_Init(MP3_Handle *h, UART_HandleTypeDef *huart, uint8_t volume) {
    h->huart  = huart;
    h->volume = (volume > MP3_VOL_MAX) ? MP3_VOL_MAX : volume;

    _send(h, MP3_CMD_RESET, 0x00, 0x00);
    HAL_Delay(600);  /* Module reset takes ~500 ms; call before scheduler start */
    _send(h, MP3_CMD_SET_VOL, 0x00, h->volume);
}

void MP3_PlayTrack(MP3_Handle *h, uint16_t track) {
    _send(h, MP3_CMD_PLAY_TRACK, (uint8_t)(track >> 8), (uint8_t)(track & 0xFF));
}

void MP3_SetVolume(MP3_Handle *h, uint8_t volume) {
    h->volume = (volume > MP3_VOL_MAX) ? MP3_VOL_MAX : volume;
    _send(h, MP3_CMD_SET_VOL, 0x00, h->volume);
}

void MP3_Stop  (MP3_Handle *h) { _send(h, MP3_CMD_STOP,  0x00, 0x00); }
void MP3_Pause (MP3_Handle *h) { _send(h, MP3_CMD_PAUSE, 0x00, 0x00); }
void MP3_Resume(MP3_Handle *h) { _send(h, MP3_CMD_PLAY,  0x00, 0x00); }
