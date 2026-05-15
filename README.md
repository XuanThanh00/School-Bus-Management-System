# School Bus Management System — STM32 Firmware

Embedded firmware for **STM32F103C8T6** that manages RFID card reading, GPS tracking, and audio playback on a school bus, communicating with a Raspberry Pi host over a binary UART protocol.

---

## Hardware

| MCU | STM32F103C8T6 — Cortex-M3, 72 MHz, 64 KB Flash, 20 KB SRAM |
|-----|-------------------------------------------------------------|
| RFID | RC522 module via SPI2 |
| GPS | NMEA module on USART2 RX (DMA circular, 9600 baud) |
| MP3 | YX5200-compatible module on USART2 TX (9600 baud) |
| Host | Raspberry Pi via USART1, 115200 baud (binary protocol) |
| Watchdog | IWDG ~4 s timeout |

### Pin Assignments

| Signal | Pin | Notes |
|--------|-----|-------|
| SPI2 CLK | PB13 | RC522 |
| SPI2 MOSI | PB15 | RC522 |
| SPI2 MISO | PB14 | RC522 |
| SPI2 CS | PB12 | Software-controlled |
| RC522 RST | PA8 | Software-controlled |
| USART1 TX/RX | PA9/PA10 | Raspberry Pi |
| USART2 TX/RX | PA2/PA3 | MP3 TX / GPS RX |

---

## Software Architecture

The firmware runs **FreeRTOS** with fully static memory allocation (no heap). All SRAM is reserved at link time, eliminating runtime allocation failures.

### Task Map

```
Priority 5 ─── Timer Daemon  (FreeRTOS)
               ├─ iwdg_timer  8 s    feeds IWDG when state = RUNNING or HANDSHAKING
               ├─ hb_timer    5 s    triggers CommTask to send proactive HB_STM32
               └─ gps_timer  30 s    triggers CommTask to send periodic GPS data

Priority 4 ─── CommTask      256 W stack
               Owns the Pi UART and state machine.
               Wakes on: USART1 ISR notify, HB timer, GPS timer, 100 ms timeout.

Priority 3 ─── GpsTask       192 W stack
               Wakes on: DMA half-transfer or transfer-complete from USART2 RX.
               Parses NMEA and updates shared GPS snapshot under mutex.

Priority 2 ─── RfidTask      128 W stack
               Polls RC522 every 50 ms (vTaskDelayUntil).
               Posts new UIDs to rfid_queue (non-blocking).

Priority 1 ─── AudioTask     128 W stack
               Blocks on audio_queue; executes MP3 module commands.

Priority 0 ─── Idle          128 W stack
               Enters WFI (Wait-For-Interrupt) sleep via tickless idle.
```

### System State Machine

```
BOOTING ──────────────────► HANDSHAKING
                                │
                    STM32 sends READY every 2 s
                                │ Pi sends HB_PI
                                ▼
                            RUNNING ◄─────────────────┐
                                │                      │
                    Pi HB timeout > 10 s               │
                                ▼                      │
                            PI_LOST                    │
                                │                      │
                    Wait 20 s, retry ──────────────────┘
                                │
                    cb_shutdown received
                                ▼
                            SHUTDOWN (no IWDG feed → MCU resets ≤ 4 s)
```

### Inter-Task Communication

| Object | Type | Direction | Purpose |
|--------|------|-----------|---------|
| `g_queue_rfid` | Queue ×4 | RfidTask → CommTask | UID of newly read card |
| `g_queue_audio` | Queue ×8 | CommTask → AudioTask | MP3 commands |
| `g_mutex_gps` | Mutex | GpsTask ↔ CommTask | Protect `g_gps_snapshot` |
| Task notification (CommTask) | 32-bit flags | ISR / timers → CommTask | RX data, HB, GPS events |
| Task notification (GpsTask) | 32-bit flags | DMA ISR → GpsTask | HT / TC events |

### Memory Budget

| Region | Size |
|--------|------|
| Task stacks (all 6 tasks) | ~4.4 KB |
| FreeRTOS kernel objects (TCBs, queues, timers) | ~1.4 KB |
| HAL handles + driver structs | ~2.0 KB |
| GPS DMA buffer | 256 B |
| **Total** | **~8.1 KB / 20 KB** |

---

## Wire Protocol (STM32 ↔ Raspberry Pi)

```
Frame: [0xAA] [LEN] [CMD] [PAYLOAD…] [CRC8]
CRC8  = LEN ^ CMD ^ payload[0] ^ … ^ payload[n-1]
```

### Command Reference

#### STM32 → Pi

| CMD | Hex | Payload | Description |
|-----|-----|---------|-------------|
| `CMD_READY` | `0x09` | — | STM32 boot complete, waiting for Pi |
| `CMD_RFID_UID` | `0x01` | 4 B UID | Card detected |
| `CMD_GPS_DATA` | `0x02` | `f32 lat, f32 lon, f32 speed_kmh` (LE) | Valid GPS fix |
| `CMD_GPS_NO_FIX` | `0x06` | `u8 sat_count` | No valid fix |
| `CMD_HB_STM32` | `0x05` | `u8 flags` | Heartbeat (see flags below) |
| `CMD_ACK` | `0x04` | `u8 cmd_acked` | Acknowledge a Pi command |

#### Pi → STM32

| CMD | Hex | Payload | Description |
|-----|-----|---------|-------------|
| `CMD_HB_PI` | `0x0A` | — | Pi heartbeat (must arrive every < 10 s) |
| `CMD_PLAY_AUDIO` | `0x03` | `u8 track` | Play track number |
| `CMD_SET_VOLUME` | `0x08` | `u8 vol` (0–30) | Set MP3 volume |
| `CMD_REQUEST_GPS` | `0x07` | — | Request immediate GPS reading |
| `CMD_ACK` | `0x04` | `u8 cmd_acked` | Acknowledge an STM32 command |
| `CMD_SHUTDOWN` | `0x0B` | — | Graceful shutdown (stops IWDG feed) |

#### HB_STM32 Flag Bits

| Bit | Constant | Meaning |
|-----|----------|---------|
| 0 | `FLAG_RFID_OK` | RC522 initialised |
| 1 | `FLAG_GPS_FIX` | Valid GPS fix with fresh data |
| 2 | `FLAG_MP3_OK` | MP3 module initialised |
| 3 | `FLAG_IWDG_RUNNING` | Watchdog is active |

---

## Driver API

### RC522 RFID

```c
void         RC522_Init      (RC522_Handle *h, SPI_HandleTypeDef *hspi,
                               UART_HandleTypeDef *huart_dbg,
                               GPIO_TypeDef *cs_port, uint16_t cs_pin,
                               GPIO_TypeDef *rst_port, uint16_t rst_pin);
RC522_Status RC522_ReadUID   (RC522_Handle *h, RC522_UID *uid);
void         RC522_UIDtoString(const RC522_UID *uid, char *out); /* "FF8E4C1E\0" */
bool         RC522_UIDEqual  (const RC522_UID *a, const RC522_UID *b);
```

`RC522_Status` values: `RC522_OK`, `RC522_ERR_NOTAG`, `RC522_ERR_CRC`, `RC522_ERR_TIMEOUT`, `RC522_ERR_COLL`.

### GPS

```c
void GPS_Init   (GPS_Handle *h, UART_HandleTypeDef *huart);
bool GPS_Update (GPS_Handle *h);        /* Returns true when a sentence is parsed */
bool GPS_IsValid(const GPS_Handle *h);  /* fix_valid AND age < 3 s               */
```

`GPS_Data` fields: `latitude`, `longitude`, `altitude`, `speed_kmh`, `hdop`, `satellites`, `hour`, `minute`, `second`, `fix_valid`, `last_update_tick`.

### MP3 (YX5200 / DFRobot)

```c
void MP3_Init     (MP3_Handle *h, UART_HandleTypeDef *huart, uint8_t volume);
void MP3_PlayTrack(MP3_Handle *h, uint16_t track);
void MP3_SetVolume(MP3_Handle *h, uint8_t volume);  /* Clamps to 0–30 */
void MP3_Stop     (MP3_Handle *h);
void MP3_Pause    (MP3_Handle *h);
void MP3_Resume   (MP3_Handle *h);
```

> **Note:** `MP3_Init` blocks for ~600 ms during module reset. Call it before `vTaskStartScheduler()`.

### UART Protocol

```c
void Proto_Init  (Proto_Handle *h, UART_HandleTypeDef *huart,
                  const Proto_Callbacks *cb);
void Proto_RxISR (Proto_Handle *h);   /* Call from HAL_UART_RxCpltCallback */
void Proto_Update(Proto_Handle *h);   /* Call inside CommTask loop          */

void Proto_SendReady   (Proto_Handle *h);
void Proto_SendRfidUID (Proto_Handle *h, const uint8_t uid[4]);
void Proto_SendGpsData (Proto_Handle *h, float lat, float lon, float speed_kmh);
void Proto_SendGpsNoFix(Proto_Handle *h, uint8_t sat_count);
void Proto_SendHbStm32 (Proto_Handle *h, uint8_t flags);
void Proto_SendAck     (Proto_Handle *h, uint8_t cmd_acked);
```

`Proto_Callbacks` struct fields: `on_play_audio`, `on_set_volume`, `on_request_gps`, `on_hb_pi`, `on_shutdown`, `on_ack`.

---

## Project Structure

```
Core/
├── Inc/
│   ├── FreeRTOSConfig.h    FreeRTOS tuning (static alloc, tick rate, priorities)
│   ├── app_state.h         System state enum and shared volatile variables
│   ├── app_tasks.h         Task entry points and stack/priority constants
│   ├── rtos_objects.h      RTOS handles, IPC types, AudioCmd
│   ├── main.h              HAL handle externs, driver instance externs, pin aliases
│   ├── rc522.h             RC522 RFID driver API
│   ├── gps.h               GPS NMEA driver API
│   ├── mp3.h               MP3 module driver API
│   └── uart_protocol.h     Pi binary protocol API
└── Src/
    ├── main.c              Peripheral init, HAL callbacks, scheduler start
    ├── rc522.c             RC522 SPI driver
    ├── gps.c               NMEA parser (DMA circular buffer)
    ├── mp3.c               YX5200 UART driver
    ├── uart_protocol.c     Frame parser and TX helpers
    ├── rtos_objects.c      Static RTOS object storage and timer callbacks
    └── app_tasks.c         CommTask, GpsTask, RfidTask, AudioTask
```

---

## Build Instructions

> The project targets the STM32F103C8T6. A complete build requires the STM32CubeMX-generated HAL and FreeRTOS source trees, a linker script for the C8T6 (64 KB Flash / 20 KB SRAM), and an ARM GCC toolchain.

1. Open the project in **STM32CubeIDE** (or your preferred IDE).
2. Add FreeRTOS source files to the build (kernel + `portable/GCC/ARM_CM3` + `portable/MemMang/heap_none.c`).
3. Add all files under `Core/Src/` and `Core/Inc/` to the build.
4. Ensure `Core/Inc/` is on the include path.
5. Build and flash using ST-Link or any compatible programmer.

### Critical NVIC Priority Rule

Any ISR that calls a `FromISR()` FreeRTOS API **must** have its NVIC priority set to a value `>= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY` (defined as **5** in `FreeRTOSConfig.h`).

The following ISRs are affected and are already configured in `main.c`:

| Interrupt | Priority Set |
|-----------|-------------|
| `DMA1_Channel6_IRQn` (GPS) | 6 |
| `USART1_IRQn` (Pi protocol) | Set by HAL default or CubeMX — verify ≥ 5 |

---

## Startup Sequence

```
Power on
  │
  ├─ HAL + clock init (72 MHz PLL)
  ├─ Peripheral init (SPI2, USART1/2/3, DMA, IWDG)
  ├─ RC522_Init — soft reset, antenna on
  ├─ GPS_Init   — start DMA circular RX
  ├─ MP3_Init   — module reset + volume (blocks 600 ms)
  ├─ RTOS_ObjectsInit — create queues, mutex, tasks, start timers
  └─ vTaskStartScheduler
       │
       ├─ CommTask starts: Proto_Init, state → HANDSHAKING, sends READY
       ├─ GpsTask starts:  blocks on DMA notification
       ├─ RfidTask starts: 50 ms periodic polling
       ├─ AudioTask starts: blocks on queue
       │
       ├─ Pi receives READY, sends HB_PI
       ├─ CommTask cb_hb_pi: state → RUNNING, IWDG timer begins feeding
       │
       └─ Normal operation loop (see state machine above)
```

---

## Watchdog Behaviour

The IWDG is refreshed every **2 seconds** by the Timer Daemon task (priority 5, the highest in the system). The feed is **conditional on system state**:

| State | IWDG fed? | Result if state persists |
|-------|-----------|--------------------------|
| `HANDSHAKING` | Yes | System stays alive while waiting for Pi |
| `RUNNING` | Yes | Normal operation |
| `PI_LOST` | **No** | MCU resets ~4 s after Pi heartbeat timeout |
| `SHUTDOWN` | **No** | MCU resets ~4 s after shutdown command |

This design means the system is guaranteed to restart if the Raspberry Pi stops responding, even if the STM32 firmware itself is stuck.
