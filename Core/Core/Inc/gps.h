#ifndef GPS_H
#define GPS_H

#include "stm32f1xx_hal.h"
#include <stdint.h>
#include <stdbool.h>

#define GPS_DMA_BUF_SIZE  256U
#define GPS_LINE_BUF_SIZE 128U
#define GPS_STALE_MS      3000U  /* Data older than this is treated as invalid */

typedef struct {
    float    latitude;        /* Decimal degrees, positive = North */
    float    longitude;       /* Decimal degrees, positive = East  */
    float    altitude;        /* Metres above sea level            */
    float    speed_kmh;
    float    hdop;
    uint8_t  satellites;
    uint8_t  hour;
    uint8_t  minute;
    uint8_t  second;
    bool     fix_valid;
    uint32_t last_update_tick;
} GPS_Data;

typedef struct {
    UART_HandleTypeDef *huart;
    uint8_t  dma_buf[GPS_DMA_BUF_SIZE];
    uint16_t parse_pos;
    char     line_buf[GPS_LINE_BUF_SIZE];
    uint8_t  line_len;
    GPS_Data data;
} GPS_Handle;

void GPS_Init   (GPS_Handle *h, UART_HandleTypeDef *huart);
bool GPS_Update (GPS_Handle *h);            /* Returns true when a new sentence is parsed */
bool GPS_IsValid(const GPS_Handle *h);      /* fix_valid AND data age < GPS_STALE_MS      */

#endif /* GPS_H */
