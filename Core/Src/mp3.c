/*
 * mp3.c
 *
 *  Created on: Apr 7, 2026
 *      Author: Thanh
 */

#include "mp3.h"
#include <string.h>

#define CMD_PLAY_TRACK  0x03
#define CMD_SET_VOLUME  0x06
#define CMD_PAUSE       0x0E
#define CMD_STOP        0x16
#define CMD_PLAY        0x0D
#define CMD_RESET       0x0C

static void _send(MP3_Handle *h, uint8_t cmd, uint8_t p1, uint8_t p2) {
    uint8_t pkt[10];
    pkt[0] = 0x7E;
    pkt[1] = 0xFF;
    pkt[2] = 0x06;
    pkt[3] = cmd;
    pkt[4] = 0x00;   // no feedback
    pkt[5] = p1;
    pkt[6] = p2;

    int16_t chk = 0;
    for (uint8_t i = 1; i <= 6; i++) chk -= pkt[i];
    pkt[7] = (uint8_t)(chk >> 8);
    pkt[8] = (uint8_t)(chk & 0xFF);
    pkt[9] = 0xEF;

    HAL_UART_Transmit(h->huart, pkt, 10, 50);
    HAL_Delay(20);
}

void MP3_Init(MP3_Handle *h, UART_HandleTypeDef *huart, uint8_t volume) {
    h->huart  = huart;
    h->volume = volume;

    _send(h, CMD_RESET, 0x00, 0x00);
    HAL_Delay(600);
    _send(h, CMD_SET_VOLUME, 0x00, volume);
}

void MP3_PlayTrack(MP3_Handle *h, uint16_t track) {
    _send(h, CMD_PLAY_TRACK,
          (uint8_t)(track >> 8),
          (uint8_t)(track & 0xFF));
}

void MP3_SetVolume(MP3_Handle *h, uint8_t vol) {
    if (vol > 30) vol = 30;
    h->volume = vol;
    _send(h, CMD_SET_VOLUME, 0x00, vol);
}

void MP3_Stop(MP3_Handle *h)   { _send(h, CMD_STOP,  0x00, 0x00); }
void MP3_Pause(MP3_Handle *h)  { _send(h, CMD_PAUSE, 0x00, 0x00); }
void MP3_Resume(MP3_Handle *h) { _send(h, CMD_PLAY,  0x00, 0x00); }
