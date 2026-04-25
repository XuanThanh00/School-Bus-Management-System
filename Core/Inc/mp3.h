/*
 * mp3.h
 *
 *  Created on: Apr 7, 2026
 *      Author: Thanh
 */

#ifndef INC_MP3_H_
#define INC_MP3_H_

#include "stm32f1xx_hal.h"
#include <stdint.h>

#define MP3_VOL_DEFAULT  20

typedef struct {
    UART_HandleTypeDef *huart;
    uint8_t volume;
} MP3_Handle;

void MP3_Init(MP3_Handle *h, UART_HandleTypeDef *huart, uint8_t volume);
void MP3_PlayTrack(MP3_Handle *h, uint16_t track);
void MP3_SetVolume(MP3_Handle *h, uint8_t vol);
void MP3_Stop(MP3_Handle *h);
void MP3_Pause(MP3_Handle *h);
void MP3_Resume(MP3_Handle *h);


#endif /* INC_MP3_H_ */
