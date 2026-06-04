# 🚌 Hệ Thống Điểm Danh Xe Buýt - Raspberry Pi 5

**Branch:** `Pi` - Phần mềm chạy trên Raspberry Pi 5 để quản lý điểm danh học sinh trên xe buýt.

## 📋 Mục Đích

Hệ thống này chạy trên Raspberry Pi 5 và thực hiện:
- 📸 **Nhận diện khuôn mặt** của học sinh (YuNet detector + buffalo_l recognizer)
- 🔖 **Quét RFID card** 2-factor authentication
- ✅ **Ghi nhận điểm danh** tự động vào SQLite + Firebase
- 📡 **Đồng bộ dữ liệu** với Firebase Realtime Database
- 🗺️ **Theo dõi GPS** thực tế xe buýt
- 🔄 **Giám sát sức khỏe** hệ thống qua watchdog + STM32 heartbeat
- 🖥️ **Hiển thị realtime** trên pygame display

---

## 🏗️ Kiến Trúc Hệ Thống

```
┌──────────────────────────────────────────┐
│     Raspberry Pi 5 (Bullseye/Bookworm)  │
├──────────────────────────────────────────┤
│                                          │
│  ┌────────────────────────────────────┐ │
│  │  main.py (AttendanceSystem)       │ │
│  │  ├─ Camera: PiCamera2 (640x480)   │ │
│  │  ├─ Vision:                       │ │
│  │  │  ├─ YuNet face detector       │ │
│  │  │  ├─ buffalo_l recognizer      │ │
│  │  │  └─ Preprocessor & DB         │ │
│  │  ├─ Display: pygame (KMS/DRM)    │ │
│  │  ├─ Serial: STM32 via UART       │ │
│  │  │  ├─ RFID reader               │ │
│  │  │  ├─ GPIO control              │ │
│  │  │  └─ Audio (MP3-TF-16P)        │ │
│  │  ├─ Database: SQLite (local)     │ │
│  │  └─ Cloud: Firebase + GPS sync   │ │
│  └────────────────────────────────────┘ │
│                ↓ HB Socket               │
│  ┌────────────────────────────────────┐ │
│  │  watchdog.py (Watchdog Daemon)    │ │
│  │  ├─ /dev/watchdog (15s timeout)   │ │
│  │  ├─ Main.py liveness check        │ │
│  │  └─ Auto-reboot nếu hang          │ │
│  └────────────────────────────────────┘ │
│                ↓ systemd                 │
│  ┌────────────────────────────────────┐ │
│  │ bus_system.service                │ │
│  │ watchdog.service                  │ │
│  └────────────────────────────────────┘ │
│                                          │
└──────────────────────────────────────────┘
```

---

## 📦 Yêu Cầu

### Hardware
- **Raspberry Pi 5** (8GB RAM khuyến nghị)
- **Raspberry Pi Camera Module 3** (Wide, CSI port)
- **USB UART Adapter** (CH340 hoặc ST-Link v2) - kết nối STM32 MCU
- **Raspberry Pi Official 27W Power Supply** (hoặc 5V/5A)
- **HDMI Display** (optional - để xem realtime trên màn hình)

### Software
- **Raspberry Pi OS Bookworm** (64-bit) trở lên
- **Python 3.10+**
- **pip**, **venv**, **git**

### Kết Nối UART
```
Pi UART2 (GPIO 15,16) ←→ STM32 (UART1/2)
Cài đặt trong config.py:
  - UART_STM32_PORT = "/dev/ttyAMA2"
  - UART_STM32_BAUD = 115200
```

---

## 🚀 Cài Đặt

### 1. Clone Repository & Chuyển Branch
```bash
cd ~/
git clone https://github.com/XuanThanh00/School-Bus-Management-System.git
cd School-Bus-Management-System
git checkout Pi
```

### 2. Chạy Makefile - Cài Đặt Đầy Đủ
```bash
make install
```

Lệnh này sẽ:
- ✅ Cài gói hệ thống qua `apt-get` (picamera2, opencv, gpiod, pygame, etc.)
- ✅ Tạo virtual environment `bus-venv/` (--system-site-packages)
- ✅ Cài gói Python vào venv
- ✅ Tải model ONNX (YuNet + buffalo_l)

> ⏱️ Lần đầu có thể mất **20-30 phút** (tùy speed mạng & Pi)

### 3. Lấy Firebase Credentials
```bash
# Copy file credentials.json vào thư mục gốc
# Lấy từ Firebase Console > Project Settings > Service Account
cp /path/to/credentials.json ./
```

### 4. Cấu Hình (Optional)
Chỉnh sửa `attendance/config.py` nếu cần:
```python
# UART port (default: /dev/ttyAMA2 = Pi UART2)
UART_STM32_PORT = "/dev/ttyAMA2"

# Face recognition threshold
THRESHOLD = 0.325

# Display width/height
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 480
```

### 5. Kiểm Tra Cài Đặt
```bash
make check
```

Expected output:
```
==> Kiểm tra các thư viện...
  cv2            OK  - 4.8.0
  numpy          OK  - 1.26.4
  pygame         OK  - 2.4.0
  pyserial       OK  - 3.5
  gpiod          OK  - 2.1.0
  firebase-admin OK
  onnxruntime    OK  - 1.16.0
  insightface    OK  - 0.7.3
  picamera2      OK

  credentials.json      OK
  YuNet model           OK
  buffalo_l model       OK
```

---

## 📁 Cấu Trúc Thư Mục

```
Pi/
├── README.md                       ← This file
├── Makefile                        ← Build automation
├── main.py                         ← Entry point (AttendanceSystem)
├── watchdog.py                     ← Watchdog daemon
│
├── bus_system.service              ← Systemd service (main.py)
├── watchdog.service                ← Systemd service (watchdog.py)
│
├── attendance/                     ← Main package
│   ├── __init__.py                ← Exports AttendanceSystem
│   ├── core.py                    ← AttendanceSystem class (main logic)
│   ├── config.py                  ← Configuration constants
│   ├── camera.py                  ← PiCamera2 wrapper
│   ├── display.py                 ← Pygame display rendering
│   ├── overlay.py                 ← UI overlay helpers
│   ├── stm32_protocol.py           ← STM32 UART protocol
│   ├── cloud_sync.py              ← Firebase synchronization
│   ├── db.py                      ← SQLite database layer
│   │
│   └── vision/                    ← Face detection & recognition
│       ├── __init__.py
│       ├── detector.py            ← YuNet face detector
│       ├── recognizer.py          ← buffalo_l recognizer
│       ├── preprocessor.py        ← Image preprocessing
│       └── database.py            ← Face embedding DB management
│
├── face_detection_yunet_2023mar.onnx  ← YuNet model (~350 KB)
├── credentials.json                   ← Firebase config (add manually)
├── bus_system.db                      ← SQLite DB (created at runtime)
├── attendance.txt                     ← Local attendance log
├── student_embeddings.npz             ← Face embeddings cache
│
└── bus-venv/                       ← Python virtual environment
    └── bin/python3                ← Interpreter to use

```

---

## ▶️ Chạy Hệ Thống

### Chế Độ Phát Triển (Development)
```bash
# Chạy trực tiếp - in log ra console + Pygame display
make run

# Hoặc chạy với debug (ghi log vào run.log):
make run-debug

# Log sẽ ở: run.log
tail -f run.log
```

### Chế Độ Production - Systemd Service (Auto-start on Boot)

#### Cài đặt & khởi động:
```bash
make install-service
```

Lệnh này sẽ:
- ✅ Copy `bus_system.service` vào `/etc/systemd/system/`
- ✅ Reload systemd daemon
- ✅ Enable service (auto-start trên boot)
- ✅ Start service

> ⚠️ **Note:** Service file được cấu hình cho user `pi5` tại `/home/pi5/Bus_system`
> 
> Nếu path khác, edit `bus_system.service` trước khi chạy `make install-service`

#### Kiểm tra & quản lý service:
```bash
# Xem trạng thái
sudo systemctl status bus_system.service
sudo systemctl status watchdog.service

# Xem log (realtime)
sudo journalctl -u bus_system.service -f
sudo journalctl -u watchdog.service -f

# Dừng
sudo systemctl stop bus_system.service

# Restart
sudo systemctl restart bus_system.service

# Xem log lịch sử (last 50 lines)
sudo journalctl -u bus_system.service -n 50
```

#### Gỡ cài đặt:
```bash
make uninstall-service
```

---

## 🔧 Các Lệnh Makefile Chính

| Lệnh | Mô Tả |
|------|-------|
| `make install` | Cài đầy đủ (apt + venv + pip + models) |
| `make install-system` | Chỉ cài gói apt |
| `make install-python` | Tạo venv + cài pip |
| `make download-models` | Tải model ONNX (YuNet + buffalo_l) |
| `make check` | Kiểm tra thư viện & file cần thiết |
| `make run` | Chạy hệ thống (display realtime) |
| `make run-debug` | Chạy + ghi log vào `run.log` |
| `make install-service` | Cài systemd service (auto-start boot) |
| `make uninstall-service` | Gỡ systemd service |
| `make help` | Hiển thị trợ giúp |

---

## 🔄 Watchdog & Auto-Recovery

### Cơ Chế Hoạt Động

```
main.py ─(HB Socket)─> watchdog.py ─> /dev/watchdog
   ↓
Send "START"     Send "HB" every 3s     Feed every 5s
   │                  │                      │
   ↓                  ↓                      ↓
startup        heartbeat monitor      hardware watchdog
   │                  │                      │
   └──────────────────┴──────────────────────┘
                      │
           No HB for 15s → timeout
                      ↓
           Stop feeding /dev/watchdog
                      ↓
           Watchdog timeout → Pi reboot (kernel)
```

### Tham Số Watchdog
```python
# attendance/config.py
HB_PI_INTERVAL       = 5.0    # STM32 heartbeat interval
STM32_HB_TIMEOUT     = 30.0   # STM32 timeout before reset
```

### Log Watchdog
```bash
# Xem log watchdog realtime
tail -f /tmp/watchdog.log

# Output mẫu:
[14:23:45] === Watchdog Pi khởi động ===
[14:23:45] Socket  : /tmp/watchdog.sock
[14:23:45] Timeout : 15.0s
[14:23:45] ✓ /dev/watchdog opened
[14:23:46] ✓ Socket sẵn sàng: /tmp/watchdog.sock
[14:23:46] Trạng thái: IDLE — chờ START từ main.py
[14:23:47] ✓ Nhận START từ main.py → bắt đầu giám sát
```

---

## 📊 Các Modul Chính

### `core.py` - AttendanceSystem
- ⚙️ **Chủ chốt hệ thống** - điều phối toàn bộ luồng
- 📸 Quản lý camera & frame capture
- 🎯 Nhận diện khuôn mặt (face detection + recognition)
- 🔖 2-factor auth (face + RFID card matching)
- 📝 Ghi attendance vào SQLite & Firebase
- 📊 Quản lý bus stop arrivals & alightings

### `stm32_protocol.py` - STM32 UART
- 🔌 Giao tiếp với STM32 qua UART
- 🎵 Điều khiển MP3 player (audio prompts)
- 🔖 Nhận RFID card scans
- 🗺️ Nhận GPS location
- 💪 Relay heartbeat từ Pi đến STM32

### `vision/` - Face Recognition
- **`detector.py`** - YuNet face detector
- **`recognizer.py`** - buffalo_l face recognizer
- **`preprocessor.py`** - Image preprocessing
- **`database.py`** - Embedding caching & management

### `cloud_sync.py` - Firebase
- ☁️ Push attendance records
- 🗺️ Sync GPS locations
- 📨 Receive FCM notifications
- 🔄 Handle network failures

### `db.py` - SQLite
- 💾 Local attendance storage
- 🎓 Student master data
- 📊 Route & stop management
- ⏰ Timestamp logging

### `display.py` - Pygame UI
- 🖥️ Display camera feed + face recognition results
- 🎨 Show real-time status (boarding/alighting)
- 📱 Show audio prompts & countdown

---

## 🐛 Troubleshooting

### 1. **Import Error: `ModuleNotFoundError: No module named 'attendance'`**
```bash
# Đảm bảo bạn đang trong thư mục gốc
pwd  # Should output: /home/pi5/Bus_system (or your path)

# Chạy qua venv đúng path
./bus-venv/bin/python3 main.py

# Hoặc activate venv
source bus-venv/bin/activate
python3 main.py
```

### 2. **PiCamera2 Error on Non-Pi Hardware**
```bash
# Lỗi này là bình thường trên máy dev
# Chỉ chạy được trên Pi thật
# Camera code sẽ skip gracefully nếu không tìm được
```

### 3. **Firebase Connection Error**
```bash
# Kiểm tra credentials.json tồn tại
ls -la credentials.json

# Kiểm tra kết nối mạng
ping firebase.google.com

# Test Firebase manually
./bus-venv/bin/python3 -c "import firebase_admin; print('OK')"
```

### 4. **Watchdog Timeout → Pi Reboot Liên Tục**
```bash
# Ngắn dịch vụ watchdog tạm thời
sudo systemctl stop watchdog.service

# Debug main.py với output chi tiết
make run-debug

# Xem lỗi
cat run.log | tail -100

# Kiểm tra UART connection
ls -la /dev/ttyAMA2
```

### 5. **Serial Port Error - Không Kết Nối STM32**
```bash
# Kiểm tra port
ls -la /dev/ttyUSB*  # USB adapter
ls -la /dev/ttyAMA*  # Pi UART

# Test serial connection
stty -f /dev/ttyAMA2 115200 raw
echo "TEST" > /dev/ttyAMA2

# Kiểm tra permission
sudo usermod -a -G dialout $USER
# (logout & login lại sau)
```

### 6. **Display/Pygame Error**
```bash
# Nếu HDMI không kết nối, set dummy display driver
export SDL_VIDEODRIVER=dummy
make run

# Hoặc disable display hoàn toàn trong config.py
# (nếu chỉ dùng RFID/face backend)
```

### 7. **High CPU/Memory Usage**
```bash
# Monitor realtime
top
htop

# Kiểm tra temperature
vcgencmd measure_temp

# Nếu quá nóng, check model loading
# Giảm ONNX_NUM_THREADS trong config.py
ONNX_NUM_THREADS = 2  # từ 4 xuống 2
```

---

## 📊 Monitoring & Status

### Kiểm Tra Service Status
```bash
# Toàn bộ system status
sudo systemctl status bus_system.service watchdog.service

# Xem log chi tiết
sudo journalctl -u bus_system.service -n 100 -e

# Real-time streaming
sudo journalctl -u bus_system.service -f
```

### Performance Monitoring
```bash
# CPU, Memory, Process list
top

# Process search
ps aux | grep python3

# Temperature
vcgencmd measure_temp

# GPU memory
vcgencmd get_mem gpu

# System uptime
uptime
```

### Log Files
```bash
# Watchdog log
tail -f /tmp/watchdog.log

# Main service log (via systemd)
sudo journalctl -u bus_system.service -f

# Debug log (if run with make run-debug)
tail -f run.log

# Attendance log (local)
cat attendance.txt
```

---

## 🔐 Security Notes

- ✅ `credentials.json` - **KHÔNG commit vào Git** (đã trong `.gitignore`)
- ✅ Unix socket `/tmp/watchdog.sock` - Chỉ local access
- ✅ Service chạy dưới user `pi5` (không root)
- ✅ SQLite file `bus_system.db` - Local only
- ⚠️ Firebase API key trong `credentials.json` - Keep safe!
- ⚠️ Serial port access - cần user permission (dialout group)

---

## 🎯 Quick Start Checklist

- [ ] Clone repository & checkout Pi branch
- [ ] Run `make install` (cài đầy đủ)
- [ ] Thêm `credentials.json` vào thư mục gốc
- [ ] Kết nối STM32 qua UART (hoặc set `UART_STM32_PORT = None` để skip)
- [ ] Chạy `make check` (kiểm tra toàn bộ)
- [ ] Test chế độ dev: `make run-debug`
- [ ] Xem log: `tail -f run.log`
- [ ] Cài service: `make install-service`
- [ ] Reboot Pi và kiểm tra service tự-start: `sudo systemctl status bus_system.service`

---

## 📄 Phiên Bản & Support

**Phiên bản:** 1.0  
**Cập nhật:** 2026-06-04  
**Branch:** `Pi`  
**Tương thích:** Raspberry Pi 5 / Bookworm+  

**Issues & Support:**  
Nếu gặp vấn đề:
1. ✅ Chạy `make check` để xác nhận dependencies
2. ✅ Xem logs: `journalctl` hoặc `run.log`
3. ✅ Kiểm tra serial port & Firebase connection
4. ✅ Report issue với environment details (Pi model, OS version, etc.)

---

**Happy coding! 🚀**

