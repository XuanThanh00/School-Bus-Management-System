#ifndef RC522_H
#define RC522_H

#include "stm32f1xx_hal.h"
#include <stdint.h>
#include <stdbool.h>

typedef enum {
    RC522_OK = 0,
    RC522_ERR_NOTAG,
    RC522_ERR_CRC,
    RC522_ERR_TIMEOUT,
    RC522_ERR_COLL,
} RC522_Status;

typedef struct {
    uint8_t bytes[4];
    uint8_t size;
} RC522_UID;

typedef struct {
    SPI_HandleTypeDef  *hspi;
    UART_HandleTypeDef *huart_dbg;  /* NULL disables debug output */
    GPIO_TypeDef       *cs_port;
    uint16_t            cs_pin;
    GPIO_TypeDef       *rst_port;
    uint16_t            rst_pin;
} RC522_Handle;

void         RC522_Init      (RC522_Handle *h,
                               SPI_HandleTypeDef  *hspi,
                               UART_HandleTypeDef *huart_dbg,
                               GPIO_TypeDef *cs_port, uint16_t cs_pin,
                               GPIO_TypeDef *rst_port, uint16_t rst_pin);
RC522_Status RC522_ReadUID   (RC522_Handle *h, RC522_UID *uid);
void         RC522_UIDtoString(const RC522_UID *uid, char *out); /* writes 8 chars + NUL */
bool         RC522_UIDEqual  (const RC522_UID *a, const RC522_UID *b);

#endif /* RC522_H */
