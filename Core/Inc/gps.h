/*
 * gps.h
 *
 *  Created on: Apr 7, 2026
 *      Author: Thanh
 */

#ifndef INC_GPS_H_
#define INC_GPS_H_

#include "stm32f1xx_hal.h"
#include <stdint.h>
#include <stdbool.h>

#define GPS_DMA_BUF_SIZE  256

typedef struct {
    /* Vị trí */
    float    latitude;       // + = Bắc, - = Nam
    float    longitude;      // + = Đông, - = Tây
    float    altitude;       // mét

    /* Tín hiệu */
    uint8_t  satellites;
    float    hdop;
    bool     fix_valid;

    /* Thời gian UTC */
    uint8_t  hour;
    uint8_t  minute;
    uint8_t  second;

    /* Tốc độ */
    float    speed_kmh;

    uint32_t last_update_tick;
} GPS_Data;

typedef struct {
    UART_HandleTypeDef *huart;
    uint8_t  dma_buf[GPS_DMA_BUF_SIZE];
    uint16_t parse_pos;
    char     line_buf[128];
    uint8_t  line_len;
    GPS_Data data;
} GPS_Handle;

/* ── Init: gọi 1 lần trong main ── */
void GPS_Init(GPS_Handle *h, UART_HandleTypeDef *huart);

/* ── Update: gọi trong while(1), trả về true nếu có data mới ── */
bool GPS_Update(GPS_Handle *h);

/* ── Helpers ── */
bool GPS_IsValid(GPS_Handle *h);   // có fix + data < 3s

#endif /* INC_GPS_H_ */
