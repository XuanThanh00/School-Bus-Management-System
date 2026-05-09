#ifndef MP3_H
#define MP3_H

#include "stm32f1xx_hal.h"
#include <stdint.h>

#define MP3_VOL_MAX     30U
#define MP3_VOL_DEFAULT 20U

typedef struct {
    UART_HandleTypeDef *huart;
    uint8_t             volume;
} MP3_Handle;

/* MP3_Init triggers a module reset and sets the initial volume.
   Call before the FreeRTOS scheduler starts — the reset delay blocks for 600 ms. */
void MP3_Init     (MP3_Handle *h, UART_HandleTypeDef *huart, uint8_t volume);
void MP3_PlayTrack(MP3_Handle *h, uint16_t track);
void MP3_SetVolume(MP3_Handle *h, uint8_t volume);
void MP3_Stop     (MP3_Handle *h);
void MP3_Pause    (MP3_Handle *h);
void MP3_Resume   (MP3_Handle *h);

#endif /* MP3_H */
