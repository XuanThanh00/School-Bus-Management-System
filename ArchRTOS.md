# FreeRTOS Architecture — School Bus Management System
**Target MCU:** STM32F103C8T6 · Cortex-M3 · 72 MHz · 64 KB Flash · 20 KB SRAM

---

## 1. Hardware Peripheral Map

| Peripheral | Resource | Role |
|------------|----------|------|
| SPI2 | PB13 CLK / PB15 MOSI / PB14 MISO | RC522 RFID reader |
| SPI2 CS | PB12 (software) | RC522 chip-select |
| SPI2 RST | PA8 (software) | RC522 reset |
| USART1 | 115200 baud | Debug UART |
| USART2 RX | 9600 baud + DMA1 Ch6 circular | GPS NMEA input |
| USART2 TX | 9600 baud | MP3 module (YX5200) commands |
| USART3 | 115200 baud | Raspberry Pi binary protocol |
| IWDG | PSC=256 reload=1562 | ~4 s hardware watchdog |

> **USART2 sharing:** GPS uses RX-only via DMA; MP3 uses TX-only. No mutex required on USART2 — the two data paths are physically separate wires. They can coexist safely with the same UART handle.

---

## 2. Guiding Constraints

| Constraint | Value | Impact |
|------------|-------|--------|
| SRAM total | 20 KB | Tight — static allocation mandatory |
| Flash total | 64 KB | Comfortable — FreeRTOS + HAL ~28 KB |
| Cortex-M3 | No FPU, no cache | No float trap risk; simple cache model |
| IWDG timeout | ~4 s | Watchdog feed task must be highest priority |
| GPS DMA buffer | 256 B circular | Zero-copy parse is essential |
| Pi heartbeat timeout | 10 s | Soft deadline for CommTask |

---

## 3. Memory Budget

### 3.1 SRAM Allocation

```
HAL handles (SPI, 3×UART, DMA, IWDG)         ~1 600 B
Driver structs (RC522_Handle, GPS_Handle,
  MP3_Handle, Proto_Handle)                    ~  400 B
GPS DMA circular buffer (static)               ~  256 B
GPS line accumulator buffer (static)           ~  128 B
Protocol RX circular buffer (static)           ~   64 B
─────────────────────────────────────────
Runtime data subtotal                          ~2 448 B

FreeRTOS kernel (TCBs × 7, ready lists,
  timer structs, queue structs)                ~1 400 B
─────────────────────────────────────────
Task stacks (static, see §4.2)                 ~4 352 B
IPC objects (queues storage, static)           ~  200 B
─────────────────────────────────────────
Grand total (static)                           ~8 400 B
Remaining headroom                            ~11 600 B  ✓
```

> **Full static allocation** (`configSUPPORT_STATIC_ALLOCATION 1`, `configSUPPORT_DYNAMIC_ALLOCATION 0`) removes every heap fragmentation risk. All objects are placed in `.bss` at link time — failures are compile-time linker errors, not runtime panics.

### 3.2 Flash Allocation (estimate)

| Component | ~Size |
|-----------|-------|
| STM32F1xx HAL (only used drivers) | ~18 KB |
| FreeRTOS kernel (heap_none / static) | ~5 KB |
| Application code (5 modules + tasks) | ~9 KB |
| Startup + vector table | ~2 KB |
| **Total** | **~34 KB / 64 KB** |

---

## 4. Task Architecture

### 4.1 Task Table

| # | Task | Priority | Stack (words) | Activation | Period / Deadline |
|---|------|----------|---------------|------------|-------------------|
| 1 | **TimerDaemon** (FreeRTOS) | 5 | 128 | Software timer expiry | Various |
| 2 | **CommTask** | 4 | 256 | `xTaskNotify` from USART3 ISR | Soft 100 ms drain |
| 3 | **GpsTask** | 3 | 192 | `xTaskNotify` from DMA ISR | Soft 100 ms max latency |
| 4 | **RfidTask** | 2 | 128 | `vTaskDelayUntil` 50 ms | 50 ms polling cycle |
| 5 | **AudioTask** | 1 | 128 | `xQueueReceive` blocking | On-demand |
| 6 | **Idle** (FreeRTOS) | 0 | 128 | Automatic | Tickless sleep |

> Priority 5 is occupied by the FreeRTOS Timer Daemon, which runs the IWDG software timer. This ensures the watchdog feed is never starved by application tasks.

### 4.2 Stack Sizes Justified

| Task | Reasoning |
|------|-----------|
| CommTask 256W | Packet builder (19-byte frame on stack), state machine locals, `sprintf` for debug |
| GpsTask 192W | `sscanf`/manual field parsing, `_to_decimal()` FP math, line buffer pointer arithmetic |
| RfidTask 128W | SPI polling, simple UID comparison, queue send |
| AudioTask 128W | Single UART transmit call, arithmetic for CRC |
| TimerDaemon 128W | Callback is minimal: flag check + `HAL_IWDG_Refresh` |
| Idle 128W | `configMINIMAL_STACK_SIZE` default |

---

## 5. IPC & Synchronization

### 5.1 Object Map

```
┌─────────────┐  rfid_queue (×4 RC522_UID_t)  ┌──────────────┐
│  RfidTask   │ ──────────────────────────────► │  CommTask    │
└─────────────┘                                 │              │
                                                │  State Mach  │
┌─────────────┐  xTaskNotify (bit 0)            │  Pi Protocol │
│  DMA ISR    │ ──────────────────────────────► │  GPS sender  │
│  (HT + TC)  │     GpsTask wakes, parses       │  RFID sender │
└─────────────┘                                 │  HB sender   │
                                                └──────┬───────┘
┌─────────────┐  xTaskNotify (bit 0)                   │
│ USART3 ISR  │ ──────────────────────────────►        │ audio_queue
└─────────────┘   CommTask drains circular buf         │ (×8 AudioCmd_t)
                                                       ▼
┌─────────────┐                                 ┌──────────────┐
│ GpsTask     │ ── gps_mutex ─────────────────► │  CommTask    │
│ (writer)    │    GPS_Data shared struct        │  (reader)    │
└─────────────┘                                 └──────────────┘

Software Timers (run in TimerDaemon, priority 5):
  iwdg_timer   2 000 ms auto-reload  → HAL_IWDG_Refresh if g_state ∈ {RUNNING, HANDSHAKING}
  hb_timer     5 000 ms auto-reload  → Proto_SendHbStm32(_build_flags())
  gps_timer   30 000 ms auto-reload  → set g_gps_send_flag (CommTask reads next cycle)
```

### 5.2 IPC Object Inventory

| Object | Type | Size | Producer | Consumer |
|--------|------|------|----------|----------|
| `rfid_queue` | Queue | 4 × `RC522_UID_t` (20 B) | RfidTask | CommTask |
| `audio_queue` | Queue | 8 × `AudioCmd_t` (16 B) | CommTask | AudioTask |
| `gps_mutex` | Mutex | 1 struct (~80 B) | GpsTask | CommTask |
| `comm_task_notify` | Task Notification | 32-bit | USART3 ISR | CommTask |
| `gps_task_notify` | Task Notification | 32-bit | DMA ISR | GpsTask |

> **Why Task Notifications instead of binary semaphores?** Each notification uses 0 extra RAM (stored in the TCB itself). Binary semaphores cost ~80 B each. For simple 1:1 signaling from ISR to task, notifications are strictly better.

---

## 6. FreeRTOSConfig.h — Recommended Settings

```c
/* ── Scheduler ── */
#define configUSE_PREEMPTION                    1
#define configUSE_TIME_SLICING                  0   // No equal-priority round-robin needed
#define configUSE_TICKLESS_IDLE                 1   // Enter WFI when all tasks blocked → saves power
#define configCPU_CLOCK_HZ                      72000000UL
#define configTICK_RATE_HZ                      1000U  // 1 ms resolution
#define configMAX_PRIORITIES                    6      // 0..5 (Idle..TimerDaemon)
#define configMINIMAL_STACK_SIZE                128U   // words (512 B)

/* ── Memory model ── */
#define configSUPPORT_STATIC_ALLOCATION         1
#define configSUPPORT_DYNAMIC_ALLOCATION        0   // All objects declared statically
// No heap_x.c needed — include heap_none.c to catch accidental pvPortMalloc calls

/* ── Features (only enable what is used) ── */
#define configUSE_MUTEXES                       1
#define configUSE_RECURSIVE_MUTEXES             0
#define configUSE_COUNTING_SEMAPHORES           0
#define configUSE_TASK_NOTIFICATIONS            1
#define configTASK_NOTIFICATION_ARRAY_ENTRIES   1
#define configNUM_THREAD_LOCAL_STORAGE_POINTERS 0

/* ── Software timers ── */
#define configUSE_TIMERS                        1
#define configTIMER_TASK_PRIORITY               5   // Highest — IWDG must not be starved
#define configTIMER_QUEUE_LENGTH                6   // 3 timers + margin
#define configTIMER_TASK_STACK_DEPTH            128U

/* ── Diagnostics (enable in Debug build, disable in Release) ── */
#define configCHECK_FOR_STACK_OVERFLOW          2   // Method 2: paint + check pattern
#define configUSE_TRACE_FACILITY                0
#define configGENERATE_RUN_TIME_STATS           0
#define configUSE_STATS_FORMATTING_FUNCTIONS    0

/* ── API includes (minimal set) ── */
#define INCLUDE_vTaskDelay                      1
#define INCLUDE_vTaskDelayUntil                 1
#define INCLUDE_xTaskGetCurrentTaskHandle       1
#define INCLUDE_uxTaskGetStackHighWaterMark     1   // For watermark checks during development
#define INCLUDE_vTaskDelete                     0
#define INCLUDE_vTaskSuspend                    0
#define INCLUDE_xTimerPendFunctionCall          0

/* ── Cortex-M3 port ── */
#define configPRIO_BITS                         4   // STM32F1 has 4 NVIC priority bits
// Set all ISRs that call FromISR() functions to priority >= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY
#define configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY  5
#define configLIBRARY_LOWEST_INTERRUPT_PRIORITY       15
#define configKERNEL_INTERRUPT_PRIORITY         ( configLIBRARY_LOWEST_INTERRUPT_PRIORITY << (8 - configPRIO_BITS) )
#define configMAX_SYSCALL_INTERRUPT_PRIORITY    ( configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY << (8 - configPRIO_BITS) )
```

> **Critical NVIC rule:** Any ISR that calls a `...FromISR()` API (USART3, DMA1_Ch6) **must** have its NVIC priority set to a value numerically ≥ `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY` (i.e., lower urgency than the kernel). IWDG and SysTick are exempt — they do not call FreeRTOS APIs.

---

## 7. ISR Design

### 7.1 USART3 (Pi Protocol RX)

```c
// stm32f1xx_it.c — keep ISR extremely short
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART3) {
        Proto_RxISR(&g_proto);                      // write byte to circular buf (existing logic)
        BaseType_t woke = pdFALSE;
        vTaskNotifyGiveFromISR(g_comm_task, &woke); // signal CommTask
        portYIELD_FROM_ISR(woke);                   // context switch if CommTask is higher priority
        HAL_UART_Receive_IT(&huart3, &proto_rx_byte, 1); // re-arm
    }
}
```

### 7.2 DMA1 Channel 6 (GPS USART2 RX)

```c
void HAL_UART_RxHalfCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART2) {
        BaseType_t woke = pdFALSE;
        xTaskNotifyFromISR(g_gps_task, 0x01, eSetBits, &woke);
        portYIELD_FROM_ISR(woke);
    }
}

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART2) {
        BaseType_t woke = pdFALSE;
        xTaskNotifyFromISR(g_gps_task, 0x02, eSetBits, &woke);
        portYIELD_FROM_ISR(woke);
    }
}
```

> Both HT and TC trigger the GPS task. The GPS parser reads from wherever the DMA head currently is — no copy needed.

### 7.3 ISR Priority Table

| ISR | NVIC Priority (logical) | Calls FromISR? |
|-----|------------------------|----------------|
| SysTick (FreeRTOS tick) | 15 (lowest) | No (kernel internal) |
| DMA1_Channel6 (GPS) | 6 | Yes |
| USART3 (Pi RX) | 6 | Yes |
| SPI2 (RC522) | Not used — polled | — |
| IWDG | Hardware, no ISR | — |

---

## 8. Task Implementations

### 8.1 CommTask

```
State machine: BOOTING → HANDSHAKING → RUNNING ⇄ PI_LOST → SHUTDOWN

Activation: xTaskNotifyWait(0, ULONG_MAX, NULL, pdMS_TO_TICKS(100))
  - Returns on USART3 ISR notification OR after 100 ms timeout
  - 100 ms timeout handles periodic checks without a dedicated timer

Each wakeup cycle:
  1. Proto_Update()               drain circular RX buf, fire callbacks
  2. xQueueReceive(rfid_queue)    if new UID → Proto_SendRfidUID()
  3. State-dependent logic:
       HANDSHAKING: resend READY every 2 s (track with local tick)
       RUNNING:     check Pi HB timeout (> 10 s → PI_LOST)
                    check g_gps_send_flag → _send_gps_or_nofix()
  4. PI_LOST: wait 20 s, retransition to HANDSHAKING

Callbacks (called from Proto_Update inside CommTask context, NOT from ISR):
  cb_play_audio  → xQueueSend(audio_queue, {CMD_PLAY, track}, 0)
                   Proto_SendAck(CMD_PLAY_AUDIO)
  cb_set_volume  → xQueueSend(audio_queue, {CMD_VOL, vol}, 0)
                   Proto_SendAck(CMD_SET_VOLUME)
  cb_request_gps → g_gps_send_flag = 1
                   Proto_SendAck(CMD_REQUEST_GPS)
  cb_hb_pi       → last_hb_pi_tick = xTaskGetTickCount()
                   Proto_SendHbStm32(_build_flags())
                   if (HANDSHAKING) → g_state = RUNNING
  cb_shutdown    → g_state = SHUTDOWN
  cb_ack         → if cmd==CMD_READY → pi_ack_received = true
```

### 8.2 GpsTask

```
Activation: xTaskNotifyWait(0, 0x03, &bits, pdMS_TO_TICKS(100))
  - DMA HT (bit 0) or TC (bit 1) fires, or 100 ms timeout for stale detection

Each wakeup:
  1. GPS_Update()           parse NMEA from DMA circular buffer (existing logic, unchanged)
  2. if new data parsed:
       xSemaphoreTake(gps_mutex, portMAX_DELAY)
       copy updated fields into shared g_gps_data
       xSemaphoreGive(gps_mutex)
  3. Return to wait

Stack note: GPS_Update internally uses a 128-byte line accumulator (GPS_Handle.line_buf)
which lives in the GPS_Handle struct (global), NOT on this task's stack. 192W is comfortable.
```

### 8.3 RfidTask

```
Period: 50 ms (vTaskDelayUntil pattern for drift-free timing)

Each cycle:
  1. RC522_ReadUID(&rc522, &uid)
  2. if OK:
       if !RC522_UIDEqual(&uid, &last_uid) OR (now - last_send_tick > 2000):
           xQueueSend(rfid_queue, &uid, 0)   // drop if queue full, do NOT block
           last_uid = uid
           last_send_tick = now
  3. vTaskDelayUntil(&wake_time, pdMS_TO_TICKS(50))

Design note: xQueueSend with 0 timeout (non-blocking) is intentional.
If CommTask is temporarily slow, we drop the duplicate RFID read rather than
blocking RfidTask and missing the next 50 ms poll window.
```

### 8.4 AudioTask

```
Activation: xQueueReceive(audio_queue, &cmd, portMAX_DELAY)  // sleeps when idle

Each command:
  switch(cmd.type):
    CMD_PLAY:   MP3_PlayTrack(&mp3, cmd.param)
    CMD_VOL:    MP3_SetVolume(&mp3, cmd.param)
    CMD_STOP:   MP3_Stop(&mp3)
    CMD_PAUSE:  MP3_Pause(&mp3)
    CMD_RESUME: MP3_Resume(&mp3)

Design note: MP3_Init() sends a soft reset with a 600 ms blocking delay (HAL_Delay).
Replace HAL_Delay with vTaskDelay BEFORE the scheduler starts OR call MP3_Init()
from AudioTask's initialization block (before entering the receive loop), so
the 600 ms blocks AudioTask only — not the entire system.
```

### 8.5 IWDG Software Timer (in TimerDaemon)

```c
void iwdg_timer_cb(TimerHandle_t xTimer) {
    // Runs at priority 5 — cannot be preempted by any application task
    if (g_state == STM32_RUNNING || g_state == STM32_HANDSHAKING) {
        HAL_IWDG_Refresh(&hiwdg);
    }
    // STM32_PI_LOST or STM32_SHUTDOWN → do NOT refresh → MCU resets in ≤4 s
}
```

---

## 9. Global State Machine

```
g_state is declared: volatile STM32_State_t g_state;
Cortex-M3 word-aligned read/write is atomic — no mutex needed for the state variable.
Only CommTask writes g_state. TimerDaemon reads it (atomic read).

          ┌──────────┐
          │ BOOTING  │  (set before scheduler start)
          └────┬─────┘
               │ scheduler starts
               ▼
          ┌──────────────┐
          │ HANDSHAKING  │◄──────────────────────────────────────┐
          │ send READY   │                                        │
          │ every 2 s    │                                        │
          └──────┬───────┘                                        │
                 │ cb_hb_pi() received (Pi ACKed READY)           │
                 ▼                                                 │
          ┌──────────────┐   Pi HB timeout > 10 s   ┌──────────────────┐
          │   RUNNING    │ ─────────────────────────► │    PI_LOST       │
          │              │                            │ stop IWDG feed   │
          └──────┬───────┘                            │ wait 20 s, retry │
                 │                                    └──────────────────┘
                 │ cb_shutdown()
                 ▼
          ┌──────────────┐
          │  SHUTDOWN    │  stop IWDG feed → MCU resets in ≤4 s
          └──────────────┘
```

---

## 10. Static Allocation Boilerplate

All objects must be declared in a dedicated `rtos_objects.c` / `rtos_objects.h`:

```c
/* ── Task stacks & TCBs ── */
static StackType_t  comm_stack[256];   static StaticTask_t  comm_tcb;
static StackType_t  gps_stack[192];    static StaticTask_t  gps_tcb;
static StackType_t  rfid_stack[128];   static StaticTask_t  rfid_tcb;
static StackType_t  audio_stack[128];  static StaticTask_t  audio_tcb;
static StackType_t  idle_stack[128];   static StaticTask_t  idle_tcb;
static StackType_t  timer_stack[128];  static StaticTask_t  timer_tcb;

/* ── Task handles (extern in .h) ── */
TaskHandle_t g_comm_task;
TaskHandle_t g_gps_task;

/* ── Queues ── */
static StaticQueue_t rfid_q_struct;
static uint8_t       rfid_q_storage[4 * sizeof(RC522_UID_t)];
QueueHandle_t rfid_queue;

static StaticQueue_t audio_q_struct;
static uint8_t       audio_q_storage[8 * sizeof(AudioCmd_t)];
QueueHandle_t audio_queue;

/* ── Mutex ── */
static StaticSemaphore_t gps_mutex_struct;
SemaphoreHandle_t gps_mutex;

/* ── Software timers ── */
static StaticTimer_t iwdg_timer_struct, hb_timer_struct, gps_timer_struct;
TimerHandle_t iwdg_timer, hb_timer, gps_timer;

/* ── Required by FreeRTOS when configSUPPORT_STATIC_ALLOCATION = 1 ── */
void vApplicationGetIdleTaskMemory(StaticTask_t **ppTCB,
                                   StackType_t **ppStack, uint32_t *pSize) {
    *ppTCB   = &idle_tcb;
    *ppStack = idle_stack;
    *pSize   = 128;
}

void vApplicationGetTimerTaskMemory(StaticTask_t **ppTCB,
                                    StackType_t **ppStack, uint32_t *pSize) {
    *ppTCB   = &timer_tcb;
    *ppStack = timer_stack;
    *pSize   = 128;
}
```

---

## 11. main() Initialization Sequence

```c
int main(void) {
    // 1. HAL + clock init (generated by CubeMX)
    HAL_Init();
    SystemClock_Config();
    MX_GPIO_Init();
    MX_DMA_Init();
    MX_SPI2_Init();
    MX_USART1_UART_Init();
    MX_USART2_UART_Init();
    MX_USART3_UART_Init();
    MX_IWDG_Init();

    // 2. Driver init (order matters: MP3 has 600 ms delay)
    RC522_Init(&rc522, &hspi2, NULL, GPIOB, GPIO_PIN_12, GPIOA, GPIO_PIN_8);
    GPS_Init(&gps, &huart2);
    MP3_Init(&mp3, &huart2, MP3_VOL_DEFAULT);   // 600 ms delay here — OK before scheduler
    Proto_Init(&proto, &huart3, callbacks...);
    HAL_UART_Receive_IT(&huart3, &proto_rx_byte, 1);

    // 3. Global state
    g_state = STM32_BOOTING;

    // 4. Create IPC objects
    rfid_queue  = xQueueCreateStatic(4, sizeof(RC522_UID_t), rfid_q_storage,  &rfid_q_struct);
    audio_queue = xQueueCreateStatic(8, sizeof(AudioCmd_t),  audio_q_storage, &audio_q_struct);
    gps_mutex   = xSemaphoreCreateMutexStatic(&gps_mutex_struct);

    // 5. Create tasks
    g_comm_task = xTaskCreateStatic(CommTask,  "Comm",  256, NULL, 4, comm_stack,  &comm_tcb);
    g_gps_task  = xTaskCreateStatic(GpsTask,   "GPS",   192, NULL, 3, gps_stack,   &gps_tcb);
                  xTaskCreateStatic(RfidTask,  "RFID",  128, NULL, 2, rfid_stack,  &rfid_tcb);
                  xTaskCreateStatic(AudioTask, "Audio", 128, NULL, 1, audio_stack, &audio_tcb);

    // 6. Create software timers
    iwdg_timer = xTimerCreateStatic("IWDG", pdMS_TO_TICKS(2000), pdTRUE,
                                     NULL, iwdg_timer_cb, &iwdg_timer_struct);
    hb_timer   = xTimerCreateStatic("HB",   pdMS_TO_TICKS(5000), pdTRUE,
                                     NULL, hb_timer_cb,   &hb_timer_struct);
    gps_timer  = xTimerCreateStatic("GPS",  pdMS_TO_TICKS(30000), pdTRUE,
                                     NULL, gps_timer_cb,  &gps_timer_struct);

    xTimerStart(iwdg_timer, 0);
    xTimerStart(hb_timer,   0);
    xTimerStart(gps_timer,  0);

    // 7. Start scheduler — never returns
    g_state = STM32_HANDSHAKING;
    vTaskStartScheduler();
}
```

---

## 12. Stack Overflow Hook

```c
// Enabled when configCHECK_FOR_STACK_OVERFLOW = 2
void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName) {
    (void)xTask;
    (void)pcTaskName;
    // Force an immediate system reset — IWDG will fire, or trigger manual reset
    NVIC_SystemReset();
}
```

---

## 13. Migration Checklist from Bare-Metal

| Step | Change | File |
|------|--------|------|
| 1 | Replace `HAL_Delay(600)` in `MP3_Init` with `vTaskDelay(pdMS_TO_TICKS(600))` | `mp3.c` |
| 2 | Add `portYIELD_FROM_ISR` to `HAL_UART_RxCpltCallback` for USART3 and USART2 | `stm32f1xx_it.c` |
| 3 | Add DMA HT callback `HAL_UART_RxHalfCpltCallback` for USART2 | `stm32f1xx_it.c` |
| 4 | Wrap `GPS_Data` reads in CommTask with `gps_mutex` take/give | `comm_task.c` |
| 5 | Remove `while(1)` main loop; distribute logic into 4 task functions | `main.c` |
| 6 | Set NVIC priority for USART3 and DMA1_Ch6 ISRs ≥ `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY` | `main.c` / CubeMX |
| 7 | Add `FreeRTOSConfig.h` with settings from §6 | new file |
| 8 | Add FreeRTOS source tree to build system | CMakeLists / Makefile |
| 9 | All `rc522.c`, `gps.c`, `mp3.c`, `uart_protocol.c` driver logic — **no changes required** | drivers |

> All five existing driver modules (`rc522.c`, `gps.c`, `mp3.c`, `uart_protocol.c`, and the state/callback logic in `main.c`) require **zero internal modification**. Only the top-level orchestration layer (`main.c` loop) and the ISR wiring change.

---

## 14. Design Rationale Summary

| Decision | Reason |
|----------|--------|
| Full static allocation | 20 KB SRAM — heap fragmentation over time would cause non-deterministic OOM failures |
| Task Notifications over semaphores | Each notification uses 0 extra RAM (stored in TCB); binary semaphores cost ~80 B each |
| IWDG in Timer Daemon (priority 5) | Daemon cannot be preempted by any application task, guaranteeing watchdog feed even under high load |
| USART2 shared GPS+MP3 without mutex | GPS uses RX-only (DMA) and MP3 uses TX-only — physically separate signal paths |
| Non-blocking queue send in RfidTask | Prevents 50 ms polling window from being missed if CommTask is temporarily busy |
| `configUSE_TIME_SLICING 0` | No two tasks share a priority level; round-robin slicing adds overhead with no benefit |
| `configUSE_TICKLESS_IDLE 1` | Between GPS polls, RFID polls, and Pi heartbeats the system is idle 90%+ of the time; WFI entry saves significant power |
| Callbacks dispatched inside CommTask | Protocol callbacks execute in CommTask context (from `Proto_Update()`), never in ISR context — eliminates `FromISR` variant complexity in callback functions |
