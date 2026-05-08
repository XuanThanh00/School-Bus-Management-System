#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32f1xx_hal.h"
#include "rc522.h"
#include "gps.h"
#include "mp3.h"
#include "uart_protocol.h"

/* ── HAL peripheral handles (defined in main.c) ─────────────────────────── */
extern SPI_HandleTypeDef    hspi2;
extern UART_HandleTypeDef   huart1;
extern UART_HandleTypeDef   huart2;
extern UART_HandleTypeDef   huart3;
extern DMA_HandleTypeDef    hdma_usart2_rx;
extern IWDG_HandleTypeDef   hiwdg;

/* ── Driver instances (defined in main.c) ───────────────────────────────── */
extern RC522_Handle g_rfid;
extern GPS_Handle   g_gps;
extern MP3_Handle   g_mp3;
extern Proto_Handle g_proto;

/* ── GPIO pin aliases ────────────────────────────────────────────────────── */
#define SPI2_CS_Pin        GPIO_PIN_12
#define SPI2_CS_GPIO_Port  GPIOB
#define SPI2_RST_Pin       GPIO_PIN_8
#define SPI2_RST_GPIO_Port GPIOA

void Error_Handler(void);

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
