#ifndef RTOS_OBJECTS_H
#define RTOS_OBJECTS_H

#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"
#include "timers.h"
#include "gps.h"     /* GPS_Data */
#include "rc522.h"   /* RC522_UID */

/* ── Task Handles ───────────────────────────────────────────────────────── */
/* Only comm and gps tasks need external handles (target of xTaskNotify). */
extern TaskHandle_t g_task_comm;
extern TaskHandle_t g_task_gps;

/* ── IPC Objects ────────────────────────────────────────────────────────── */
extern QueueHandle_t     g_queue_rfid;   /* RC522_UID × 4 items  */
extern QueueHandle_t     g_queue_audio;  /* AudioCmd  × 8 items  */
extern SemaphoreHandle_t g_mutex_gps;    /* Protects g_gps_snapshot */

/* ── Software Timers ────────────────────────────────────────────────────── */
extern TimerHandle_t g_timer_iwdg;  /* 2 s auto-reload: feeds IWDG        */
extern TimerHandle_t g_timer_hb;    /* 5 s auto-reload: proactive HB send */
extern TimerHandle_t g_timer_gps;   /* 30 s auto-reload: periodic GPS send */

/* ── Shared GPS snapshot ────────────────────────────────────────────────── */
/* Written by GpsTask, read by CommTask. Always access under g_mutex_gps.  */
extern GPS_Data g_gps_snapshot;

/* ── Task Notification Bit Masks ────────────────────────────────────────── */
#define NOTIFY_COMM_RX   (1UL << 0)  /* New byte in proto RX buffer (from ISR)   */
#define NOTIFY_COMM_HB   (1UL << 1)  /* HB timer: send HB_STM32 to Pi           */
#define NOTIFY_COMM_GPS  (1UL << 2)  /* GPS timer: send periodic GPS reading     */

#define NOTIFY_GPS_HT    (1UL << 0)  /* DMA half-transfer: first 128 B ready     */
#define NOTIFY_GPS_TC    (1UL << 1)  /* DMA transfer-complete: wrap-around       */

/* ── Audio Command ──────────────────────────────────────────────────────── */
typedef enum { AUDIO_PLAY = 0, AUDIO_SET_VOL, AUDIO_STOP, AUDIO_PAUSE, AUDIO_RESUME } AudioCmdType;
typedef struct { AudioCmdType type; uint8_t param; } AudioCmd;

/* ── Initialise all static RTOS objects and create all tasks ────────────── */
void RTOS_ObjectsInit(void);

#endif /* RTOS_OBJECTS_H */
