/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2026 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "rc522.h"
#include "gps.h"
#include "mp3.h"
#include "uart_protocol.h"
#include <stdio.h>
#include <string.h>
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
IWDG_HandleTypeDef hiwdg;

SPI_HandleTypeDef hspi2;

UART_HandleTypeDef huart1;
UART_HandleTypeDef huart2;
UART_HandleTypeDef huart3;
DMA_HandleTypeDef hdma_usart2_rx;

/* USER CODE BEGIN PV */

RC522_Handle  rc522;
GPS_Handle    gps;
MP3_Handle    mp3;
Proto_Handle  proto;

/* ── State machine ── */
typedef enum {
    STM32_BOOTING,
    STM32_HANDSHAKING,
    STM32_RUNNING,
    STM32_PI_LOST,
    STM32_SHUTDOWN,
} STM32_State;

static volatile STM32_State stm32_state = STM32_BOOTING;

/* ── Timing ── */
static uint32_t last_ready_tick   = 0;   /* HANDSHAKING: gửi READY mỗi 2s */
static uint32_t last_hb_pi_tick   = 0;   /* RUNNING: lần cuối nhận HB_PI */
static uint32_t last_hb_send_tick = 0;   /* RUNNING: lần cuối gửi HB_STM32 chủ động */
static uint32_t last_gps_tick     = 0;   /* RUNNING: gửi GPS định kỳ 30s */
static uint32_t last_rfid_tick    = 0;   /* debounce RFID: không gửi UID trùng trong 2s */

/* ── RFID debounce ── */
static RC522_UID last_uid = {0};

/* ── Flags ── */
static volatile bool pi_ack_received  = false;   /* đã nhận ACK(0x09) từ Pi */
static volatile bool gps_reply_needed = false;   /* Pi h�?i GPS ngay */

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_USART1_UART_Init(void);
static void MX_USART2_UART_Init(void);
static void MX_SPI2_Init(void);
static void MX_USART3_UART_Init(void);
static void MX_IWDG_Init(void);
/* USER CODE BEGIN PFP */

static uint8_t  _build_flags(void);
static void     _send_gps_or_nofix(void);
static void     _check_rfid(void);

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?
   PROTO CALLBACKS (Pi → STM32)
   �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

void cb_play_audio(uint8_t track) {
    MP3_PlayTrack(&mp3, track);
    Proto_SendAck(&proto, CMD_PLAY_AUDIO);
}

void cb_set_volume(uint8_t vol) {
    MP3_SetVolume(&mp3, vol);
    Proto_SendAck(&proto, CMD_SET_VOLUME);
}

void cb_request_gps(void) {
    gps_reply_needed = true;
    Proto_SendAck(&proto, CMD_REQUEST_GPS);
}

void cb_hb_pi(void) {
    last_hb_pi_tick = HAL_GetTick();

    HAL_IWDG_Refresh(&hiwdg);   // ← bỏ comment

    uint8_t flags = _build_flags();
    Proto_SendHbStm32(&proto, flags);
    last_hb_send_tick = HAL_GetTick();

    if (stm32_state == STM32_HANDSHAKING) {
        stm32_state = STM32_RUNNING;
        last_hb_pi_tick = HAL_GetTick();
    }
}

void cb_shutdown(void) {
//    HAL_UART_Transmit(&huart1,
//        (uint8_t *)"[MAIN] SHUTDOWN received\r\n", 26, 50);
    stm32_state = STM32_SHUTDOWN;
}

void cb_ack(uint8_t cmd_acked) {
    if (cmd_acked == CMD_READY) {
        pi_ack_received = true;
//        HAL_UART_Transmit(&huart1,
//            (uint8_t *)"[MAIN] Pi ACK(READY) received\r\n", 31, 50);
    }
}

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?
   HAL CALLBACKS
   �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart == proto.huart) {
        Proto_RxISR(&proto);
    }
}

/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{

  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_DMA_Init();
  MX_USART1_UART_Init();
  MX_USART2_UART_Init();
  MX_SPI2_Init();
  MX_USART3_UART_Init();
  MX_IWDG_Init();
  /* USER CODE BEGIN 2 */

//  HAL_UART_Transmit(&huart1,
//         (uint8_t *)"[MAIN] Booting...\r\n", 19, 100);

     /* ── Init drivers ── */
     RC522_Init(&rc522,
                &hspi2, NULL,
				SPI2_CS_GPIO_Port, SPI2_CS_Pin,
				SPI2_RST_GPIO_Port, SPI2_RST_Pin);

     GPS_Init(&gps, &huart2);

     MP3_Init(&mp3, &huart2, 20);

     Proto_Init(&proto,
    		 &huart1, NULL,
                cb_play_audio,
                cb_set_volume,
                cb_request_gps,
                cb_hb_pi,
                cb_shutdown,
                cb_ack);

     stm32_state    = STM32_HANDSHAKING;
     last_ready_tick = HAL_GetTick();
     Proto_SendReady(&proto);   /* READY đầu tiên */

//     HAL_UART_Transmit(&huart1,
//         (uint8_t *)"[MAIN] HANDSHAKING — sending READY\r\n", 36, 50);

  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */

	  Proto_Update(&proto);

	          /* Luôn parse GPS */
	          GPS_Update(&gps);

	          uint32_t now = HAL_GetTick();

	          switch (stm32_state) {

	          /* ── HANDSHAKING: gửi READY mỗi 2s đến khi Pi ACK ── */
	          case STM32_HANDSHAKING:
	              /* Feed IWDG vô đi�?u kiện khi đang ch�? Pi boot */
	               HAL_IWDG_Refresh(&hiwdg);   /* TODO: b�? comment khi test IWDG */

	              if (!pi_ack_received && (now - last_ready_tick >= 2000)) {
	                  Proto_SendReady(&proto);
	                  last_ready_tick = now;
	              }
	              break;

	          /* ── RUNNING: hoạt động bình thư�?ng ── */
	          case STM32_RUNNING:
	              /* Check RFID */
	              _check_rfid();

	              /* Gửi GPS định kỳ 30s */
	              if (now - last_gps_tick >= 30000) {
	                  _send_gps_or_nofix();
	                  last_gps_tick = now;
	              }

	              /* Pi h�?i GPS ngay */
	              if (gps_reply_needed) {
	                  gps_reply_needed = false;
	                  _send_gps_or_nofix();
	              }

	              /* Phát hiện Pi mất kết nối */
	              if (now - last_hb_pi_tick > 10000) {
//	                  HAL_UART_Transmit(&huart1,
//	                      (uint8_t *)"[MAIN] Pi HB timeout — PI_LOST\r\n", 32, 50);
	                  stm32_state = STM32_PI_LOST;
	              }
	              break;

	          /* ── PI_LOST: không feed IWDG → IWDG tự reset STM32 sau ~4s ── */
	          case STM32_PI_LOST:
	              /* Không làm gì — IWDG timeout → STM32 reset → re-init → HANDSHAKING */
	              /* Khi chưa có IWDG: tự recovery sau 10s, thử handshake lại */
	              if (now - last_hb_pi_tick > 20000) {
//	                  HAL_UART_Transmit(&huart1,
//	                      (uint8_t *)"[MAIN] Retry handshake\r\n", 24, 50);
	                  pi_ack_received  = false;
	                  stm32_state      = STM32_HANDSHAKING;
	                  last_ready_tick  = now;
	                  last_hb_pi_tick  = now;   /* reset để tránh loop ngay */
	                  Proto_SendReady(&proto);
	              }
	              break;

	          /* ── SHUTDOWN: không feed IWDG, không gửi HB ── */
	          case STM32_SHUTDOWN:
	              /* Ch�? IWDG reset STM32 (~4s) */
	              /* Khi chưa có IWDG: không làm gì, ch�? Pi restart và handshake lại */
	              break;

	          default:
	              break;
	          }

  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_LSI|RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState = RCC_HSE_ON;
  RCC_OscInitStruct.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.LSIState = RCC_LSI_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief IWDG Initialization Function
  * @param None
  * @retval None
  */
static void MX_IWDG_Init(void)
{

  /* USER CODE BEGIN IWDG_Init 0 */

  /* USER CODE END IWDG_Init 0 */

  /* USER CODE BEGIN IWDG_Init 1 */

  /* USER CODE END IWDG_Init 1 */
  hiwdg.Instance = IWDG;
  hiwdg.Init.Prescaler = IWDG_PRESCALER_256;
  hiwdg.Init.Reload = 1562;
  if (HAL_IWDG_Init(&hiwdg) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN IWDG_Init 2 */

  /* USER CODE END IWDG_Init 2 */

}

/**
  * @brief SPI2 Initialization Function
  * @param None
  * @retval None
  */
static void MX_SPI2_Init(void)
{

  /* USER CODE BEGIN SPI2_Init 0 */

  /* USER CODE END SPI2_Init 0 */

  /* USER CODE BEGIN SPI2_Init 1 */

  /* USER CODE END SPI2_Init 1 */
  /* SPI2 parameter configuration*/
  hspi2.Instance = SPI2;
  hspi2.Init.Mode = SPI_MODE_MASTER;
  hspi2.Init.Direction = SPI_DIRECTION_2LINES;
  hspi2.Init.DataSize = SPI_DATASIZE_8BIT;
  hspi2.Init.CLKPolarity = SPI_POLARITY_LOW;
  hspi2.Init.CLKPhase = SPI_PHASE_1EDGE;
  hspi2.Init.NSS = SPI_NSS_SOFT;
  hspi2.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_16;
  hspi2.Init.FirstBit = SPI_FIRSTBIT_MSB;
  hspi2.Init.TIMode = SPI_TIMODE_DISABLE;
  hspi2.Init.CRCCalculation = SPI_CRCCALCULATION_DISABLE;
  hspi2.Init.CRCPolynomial = 10;
  if (HAL_SPI_Init(&hspi2) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN SPI2_Init 2 */

  /* USER CODE END SPI2_Init 2 */

}

/**
  * @brief USART1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART1_UART_Init(void)
{

  /* USER CODE BEGIN USART1_Init 0 */

  /* USER CODE END USART1_Init 0 */

  /* USER CODE BEGIN USART1_Init 1 */

  /* USER CODE END USART1_Init 1 */
  huart1.Instance = USART1;
  huart1.Init.BaudRate = 115200;
  huart1.Init.WordLength = UART_WORDLENGTH_8B;
  huart1.Init.StopBits = UART_STOPBITS_1;
  huart1.Init.Parity = UART_PARITY_NONE;
  huart1.Init.Mode = UART_MODE_TX_RX;
  huart1.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart1.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart1) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN USART1_Init 2 */

  /* USER CODE END USART1_Init 2 */

}

/**
  * @brief USART2 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART2_UART_Init(void)
{

  /* USER CODE BEGIN USART2_Init 0 */

  /* USER CODE END USART2_Init 0 */

  /* USER CODE BEGIN USART2_Init 1 */

  /* USER CODE END USART2_Init 1 */
  huart2.Instance = USART2;
  huart2.Init.BaudRate = 9600;
  huart2.Init.WordLength = UART_WORDLENGTH_8B;
  huart2.Init.StopBits = UART_STOPBITS_1;
  huart2.Init.Parity = UART_PARITY_NONE;
  huart2.Init.Mode = UART_MODE_TX_RX;
  huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart2.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart2) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN USART2_Init 2 */

  /* USER CODE END USART2_Init 2 */

}

/**
  * @brief USART3 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART3_UART_Init(void)
{

  /* USER CODE BEGIN USART3_Init 0 */

  /* USER CODE END USART3_Init 0 */

  /* USER CODE BEGIN USART3_Init 1 */

  /* USER CODE END USART3_Init 1 */
  huart3.Instance = USART3;
  huart3.Init.BaudRate = 115200;
  huart3.Init.WordLength = UART_WORDLENGTH_8B;
  huart3.Init.StopBits = UART_STOPBITS_1;
  huart3.Init.Parity = UART_PARITY_NONE;
  huart3.Init.Mode = UART_MODE_TX_RX;
  huart3.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart3.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart3) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN USART3_Init 2 */

  /* USER CODE END USART3_Init 2 */

}

/**
  * Enable DMA controller clock
  */
static void MX_DMA_Init(void)
{

  /* DMA controller clock enable */
  __HAL_RCC_DMA1_CLK_ENABLE();

  /* DMA interrupt init */
  /* DMA1_Channel6_IRQn interrupt configuration */
  HAL_NVIC_SetPriority(DMA1_Channel6_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(DMA1_Channel6_IRQn);

}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};
/* USER CODE BEGIN MX_GPIO_Init_1 */
/* USER CODE END MX_GPIO_Init_1 */

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(SPI2_CS_GPIO_Port, SPI2_CS_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(SPI2_RST_GPIO_Port, SPI2_RST_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin : SPI2_CS_Pin */
  GPIO_InitStruct.Pin = SPI2_CS_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(SPI2_CS_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : SPI2_RST_Pin */
  GPIO_InitStruct.Pin = SPI2_RST_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(SPI2_RST_GPIO_Port, &GPIO_InitStruct);

/* USER CODE BEGIN MX_GPIO_Init_2 */
/* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?
   INTERNAL HELPERS
   �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

/**
 * Build status flags cho HB_STM32.
 * Thêm check thực tế sau khi có cơ chế detect lỗi driver.
 */
static uint8_t _build_flags(void) {
    uint8_t flags = 0;
    flags |= FLAG_RFID_OK;
    if (GPS_IsValid(&gps))
        flags |= FLAG_GPS_FIX;
    flags |= FLAG_MP3_OK;
    flags |= FLAG_IWDG_RUNNING;   // ← bỏ comment
    return flags;
}

/**
 * Gửi GPS_DATA hoặc GPS_NO_FIX tùy trạng thái.
 */
static void _send_gps_or_nofix(void) {
    if (GPS_IsValid(&gps)) {
        Proto_SendGpsDataFull(&proto,
                              gps.data.latitude,
                              gps.data.longitude,
                              gps.data.speed_kmh);
    } else {
        Proto_SendGpsNoFix(&proto, gps.data.satellites);
    }
}

/**
 * Poll RC522, nếu có thẻ mới → gửi RFID_UID lên Pi.
 * Debounce 2s để không gửi UID trùng liên tục.
 */
static void _check_rfid(void) {
    RC522_UID uid;
    RC522_Status st = RC522_ReadUID(&rc522, &uid);

    if (st != RC522_OK) return;

    uint32_t now = HAL_GetTick();

    /* Debounce: b�? qua nếu cùng UID trong vòng 2s */
    if (RC522_UIDEqual(&uid, &last_uid) &&
        (now - last_rfid_tick < 2000)) {
        return;
    }

    memcpy(&last_uid, &uid, sizeof(RC522_UID));
    last_rfid_tick = now;

    Proto_SendRfidUID(&proto, uid.bytes);
}

/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
