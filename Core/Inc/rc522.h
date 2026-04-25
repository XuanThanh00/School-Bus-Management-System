/*
 * rc552.h
 *
 *  Created on: Apr 7, 2026
 *      Author: Thanh
 */

#ifndef INC_RC522_H_
#define INC_RC522_H_

#include "stm32f1xx_hal.h"
#include <stdint.h>
#include <stdbool.h>

typedef enum {
    RC522_OK          = 0,
    RC522_ERR_NOTAG   = 1,
    RC522_ERR_CRC     = 2,
    RC522_ERR_TIMEOUT = 3,
    RC522_ERR_COLL    = 4,
} RC522_Status;

typedef struct {
    uint8_t bytes[4];
    uint8_t size;
} RC522_UID;

typedef struct {
    SPI_HandleTypeDef  *hspi;
    UART_HandleTypeDef *huart_debug;   // UART1 để debug, NULL = tắt
    GPIO_TypeDef       *cs_port;
    uint16_t            cs_pin;
    GPIO_TypeDef       *rst_port;
    uint16_t            rst_pin;
} RC522_Handle;

void         RC522_Init(RC522_Handle *h,
                        SPI_HandleTypeDef  *hspi,
                        UART_HandleTypeDef *huart_debug,
                        GPIO_TypeDef *cs_port,  uint16_t cs_pin,
                        GPIO_TypeDef *rst_port, uint16_t rst_pin);

RC522_Status RC522_ReadUID(RC522_Handle *h, RC522_UID *uid);
void         RC522_UIDtoString(RC522_UID *uid, char *buf); // "FF8E4C1E"
bool         RC522_UIDEqual(RC522_UID *a, RC522_UID *b);


#endif /* INC_RC552_H_ */
