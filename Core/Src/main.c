#include "main.h"
#include "rtos_objects.h"
#include "app_state.h"
#include "FreeRTOS.h"
#include "task.h"

/* ── HAL peripheral handles ─────────────────────────────────────────────── */
SPI_HandleTypeDef  hspi2;
UART_HandleTypeDef huart1;
UART_HandleTypeDef huart2;
UART_HandleTypeDef huart3;
DMA_HandleTypeDef  hdma_usart2_rx;
IWDG_HandleTypeDef hiwdg;

/* ── Driver instances ───────────────────────────────────────────────────── */
RC522_Handle g_rfid;
GPS_Handle   g_gps;
MP3_Handle   g_mp3;
Proto_Handle g_proto;

/* ── Forward declarations ───────────────────────────────────────────────── */
static void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_SPI2_Init(void);
static void MX_USART1_UART_Init(void);
static void MX_USART2_UART_Init(void);
static void MX_USART3_UART_Init(void);
static void MX_IWDG_Init(void);

/* ════════════════════════════════════════════════════════════════════════════
   main
   ══════════════════════════════════════════════════════════════════════════ */
int main(void) {
    HAL_Init();
    SystemClock_Config();

    MX_GPIO_Init();
    MX_DMA_Init();
    MX_USART1_UART_Init();
    MX_USART2_UART_Init();
    MX_USART3_UART_Init();
    MX_SPI2_Init();
    MX_IWDG_Init();

    /* Driver init — MP3_Init blocks 600 ms for module reset;
       safe here because the scheduler has not started yet.        */
    RC522_Init(&g_rfid, &hspi2, NULL,
               SPI2_CS_GPIO_Port, SPI2_CS_Pin,
               SPI2_RST_GPIO_Port, SPI2_RST_Pin);
    GPS_Init(&g_gps, &huart2);
    MP3_Init(&g_mp3, &huart2, MP3_VOL_DEFAULT);

    /* Proto_Init is called from CommTask after the scheduler starts,
       because it registers FreeRTOS-aware callbacks. g_proto fields
       are zeroed by BSS initialisation. */

    RTOS_ObjectsInit();       /* Create all tasks, queues, timers */
    vTaskStartScheduler();    /* Never returns */

    for (;;);
}

/* ════════════════════════════════════════════════════════════════════════════
   HAL callbacks — keep ISRs minimal: store data, notify task, yield.
   ══════════════════════════════════════════════════════════════════════════ */

/* USART1 (Pi protocol) — interrupt-driven, 1 byte at a time. */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    BaseType_t woke = pdFALSE;

    if (huart->Instance == USART1) {
        Proto_RxISR(&g_proto);
        vTaskNotifyGiveFromISR(g_task_comm, &woke);

    } else if (huart->Instance == USART2) {
        /* DMA circular TC: buffer has wrapped — notify GPS parser */
        xTaskNotifyFromISR(g_task_gps, NOTIFY_GPS_TC, eSetBits, &woke);
    }

    portYIELD_FROM_ISR(woke);
}

/* USART2 DMA half-transfer: first 128 bytes of the circular buffer are ready. */
void HAL_UART_RxHalfCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance != USART2) return;
    BaseType_t woke = pdFALSE;
    xTaskNotifyFromISR(g_task_gps, NOTIFY_GPS_HT, eSetBits, &woke);
    portYIELD_FROM_ISR(woke);
}

/* ════════════════════════════════════════════════════════════════════════════
   Peripheral initialisation (CubeMX-generated, do not edit manually)
   ══════════════════════════════════════════════════════════════════════════ */

static void SystemClock_Config(void) {
    RCC_OscInitTypeDef RCC_OscInitStruct = {0};
    RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

    RCC_OscInitStruct.OscillatorType      = RCC_OSCILLATORTYPE_LSI | RCC_OSCILLATORTYPE_HSE;
    RCC_OscInitStruct.HSEState            = RCC_HSE_ON;
    RCC_OscInitStruct.HSEPredivValue      = RCC_HSE_PREDIV_DIV1;
    RCC_OscInitStruct.LSIState            = RCC_LSI_ON;
    RCC_OscInitStruct.PLL.PLLState        = RCC_PLL_ON;
    RCC_OscInitStruct.PLL.PLLSource       = RCC_PLLSOURCE_HSE;
    RCC_OscInitStruct.PLL.PLLMUL          = RCC_PLL_MUL9;
    if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK) Error_Handler();

    RCC_ClkInitStruct.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                                     | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    RCC_ClkInitStruct.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
    RCC_ClkInitStruct.AHBCLKDivider  = RCC_SYSCLK_DIV1;
    RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
    RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;
    if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK) Error_Handler();
}

static void MX_IWDG_Init(void) {
    hiwdg.Instance       = IWDG;
    hiwdg.Init.Prescaler = IWDG_PRESCALER_256;
    hiwdg.Init.Reload    = 1562;  /* ~4 s timeout at 40 kHz LSI / 256 */
    if (HAL_IWDG_Init(&hiwdg) != HAL_OK) Error_Handler();
}

static void MX_SPI2_Init(void) {
    hspi2.Instance               = SPI2;
    hspi2.Init.Mode              = SPI_MODE_MASTER;
    hspi2.Init.Direction         = SPI_DIRECTION_2LINES;
    hspi2.Init.DataSize          = SPI_DATASIZE_8BIT;
    hspi2.Init.CLKPolarity       = SPI_POLARITY_LOW;
    hspi2.Init.CLKPhase          = SPI_PHASE_1EDGE;
    hspi2.Init.NSS               = SPI_NSS_SOFT;
    hspi2.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_16;
    hspi2.Init.FirstBit          = SPI_FIRSTBIT_MSB;
    hspi2.Init.TIMode            = SPI_TIMODE_DISABLE;
    hspi2.Init.CRCCalculation    = SPI_CRCCALCULATION_DISABLE;
    hspi2.Init.CRCPolynomial     = 10;
    if (HAL_SPI_Init(&hspi2) != HAL_OK) Error_Handler();
}

static void MX_USART1_UART_Init(void) {
    huart1.Instance          = USART1;
    huart1.Init.BaudRate     = 115200;
    huart1.Init.WordLength   = UART_WORDLENGTH_8B;
    huart1.Init.StopBits     = UART_STOPBITS_1;
    huart1.Init.Parity       = UART_PARITY_NONE;
    huart1.Init.Mode         = UART_MODE_TX_RX;
    huart1.Init.HwFlowCtl    = UART_HWCONTROL_NONE;
    huart1.Init.OverSampling = UART_OVERSAMPLING_16;
    if (HAL_UART_Init(&huart1) != HAL_OK) Error_Handler();
}

static void MX_USART2_UART_Init(void) {
    huart2.Instance          = USART2;
    huart2.Init.BaudRate     = 9600;
    huart2.Init.WordLength   = UART_WORDLENGTH_8B;
    huart2.Init.StopBits     = UART_STOPBITS_1;
    huart2.Init.Parity       = UART_PARITY_NONE;
    huart2.Init.Mode         = UART_MODE_TX_RX;
    huart2.Init.HwFlowCtl    = UART_HWCONTROL_NONE;
    huart2.Init.OverSampling = UART_OVERSAMPLING_16;
    if (HAL_UART_Init(&huart2) != HAL_OK) Error_Handler();
}

static void MX_USART3_UART_Init(void) {
    huart3.Instance          = USART3;
    huart3.Init.BaudRate     = 115200;
    huart3.Init.WordLength   = UART_WORDLENGTH_8B;
    huart3.Init.StopBits     = UART_STOPBITS_1;
    huart3.Init.Parity       = UART_PARITY_NONE;
    huart3.Init.Mode         = UART_MODE_TX_RX;
    huart3.Init.HwFlowCtl    = UART_HWCONTROL_NONE;
    huart3.Init.OverSampling = UART_OVERSAMPLING_16;
    if (HAL_UART_Init(&huart3) != HAL_OK) Error_Handler();
}

static void MX_DMA_Init(void) {
    __HAL_RCC_DMA1_CLK_ENABLE();

    /* DMA1_Channel6 = USART2_RX (GPS).
       Priority must be >= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY (5)
       so that xTaskNotifyFromISR is callable from this handler.            */
    HAL_NVIC_SetPriority(DMA1_Channel6_IRQn, 6, 0);
    HAL_NVIC_EnableIRQ(DMA1_Channel6_IRQn);
}

static void MX_GPIO_Init(void) {
    GPIO_InitTypeDef GPIO_InitStruct = {0};

    __HAL_RCC_GPIOD_CLK_ENABLE();
    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_GPIOB_CLK_ENABLE();

    /* CS and RST start de-asserted (HIGH is de-asserted for CS, HIGH = released for RST) */
    HAL_GPIO_WritePin(SPI2_CS_GPIO_Port,  SPI2_CS_Pin,  GPIO_PIN_SET);
    HAL_GPIO_WritePin(SPI2_RST_GPIO_Port, SPI2_RST_Pin, GPIO_PIN_SET);

    GPIO_InitStruct.Mode  = GPIO_MODE_OUTPUT_PP;
    GPIO_InitStruct.Pull  = GPIO_NOPULL;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;

    GPIO_InitStruct.Pin = SPI2_CS_Pin;
    HAL_GPIO_Init(SPI2_CS_GPIO_Port, &GPIO_InitStruct);

    GPIO_InitStruct.Pin = SPI2_RST_Pin;
    HAL_GPIO_Init(SPI2_RST_GPIO_Port, &GPIO_InitStruct);
}

/* ── Error handler ──────────────────────────────────────────────────────── */
void Error_Handler(void) {
    __disable_irq();
    for (;;);
}

#ifdef USE_FULL_ASSERT
void assert_failed(uint8_t *file, uint32_t line) {
    (void)file;
    (void)line;
}
#endif
