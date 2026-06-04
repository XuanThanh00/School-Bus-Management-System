# 🚌 Hệ Thống Điểm Danh Xe Buýt - Raspberry Pi 5

**Branch:** `Pi` - Phần mềm chạy trên Raspberry Pi 5 để quản lý điểm danh học sinh trên xe buýt.

## 📋 Mục Đích

Hệ thống này chạy trên Raspberry Pi 5 và thực hiện:
- 📸 **Nhận diện khuôn mặt** của học sinh
- ✅ **Ghi nhận điểm danh** tự động
- 💾 **Đồng bộ dữ liệu** với Firebase
- 🔄 **Giám sát sức khỏe** hệ thống qua watchdog

---

## 🏗️ Kiến Trúc Hệ Thống

```
┌─────────────────────────────────────────┐
│      Raspberry Pi 5 (Bullseye)         │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐   │
│  │  main.py (AttendanceSystem)    │   │
│  │  - Camera: PiCamera2           │   │
│  │  - Face Detection: YuNet       │   │
│  │  - Face Recognition: buffalo_l │   │
│  │  - Serial: STM32 MCU           │   │
│  │  - Database: Firebase          │   │
│  └─────────────────────────────────┘   │
│           ↓ HB Socket                   │
│  ┌─────────────────────────────────┐   │
│  │  watchdog.py (Watchdog Daemon)  │   │
│  │  - /dev/watchdog (15s timeout)  │   │
│  │  - Auto-reboot nếu main.py hang │   │
│  └─────────────────────────────────┘   │
│           ↓ systemd                     │
│  ┌─────────────────────────────────┐   │
│  │ bus_system.service              │   │
│  │ watchdog.service                │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## 📦 Yêu Cầu

### Hardware
- **Raspberry Pi 5** (8GB RAM khuyến nghị)
- **Raspberry Pi Camera Module 3** (Wide)
- **USB UART Adapter** (ST-Link hoặc CH340) - kết nối STM32
- **Raspberry Pi Official 27W Power Supply**

### Software
- **Raspberry Pi OS Bookworm** (64-bit) trở lên
- **Python 3.10+**
- **pip**, **venv**

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
- ✅ Cài gói hệ thống qua `apt-get`
- ✅ Tạo virtual environment `bus-venv/`
- ✅ Cài gói Python vào venv
- ✅ Tải model ONNX (YuNet + buffalo_l)

> ⏱️ Lần đầu có thể mất **15-20 phút**

### 3. Lấy Firebase Credentials
```bash
# Copy file credentials.json vào thư mục gốc
cp /path/to/credentials.json ./
```

### 4. Kiểm Tra Cài Đặt
```bash
make check
```

Output:
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

## ▶️ Chạy Hệ Thống

### Chế Độ Phát Triển (Development)
```bash
# Chạy trực tiếp - in log ra console
make run

# Hoặc chạy với debug:
make run-debug
```

### Chế Độ Production - Systemd Service
```bash
# Cài và khởi động service
make install-service

# Kiểm tra trạng thái
sudo systemctl status bus_system.service

# Xem log
sudo journalctl -u bus_system.service -f
```

---

## 📁 Cấu Trúc Thư Mục

```
Pi/
├── main.py                      ← Entry point chính
├── watchdog.py                  ← Daemon giám sát sức khỏe
├── bus_system.service           ← Service file cho main.py
├── watchdog.service             ← Service file cho watchdog.py
├── Makefile                     ← Build & setup
├── attendance/                  ← Mã nguồn điểm danh
│   ├── __init__.py
│   ├── system.py                ← AttendanceSystem class
│   ├── camera.py                ← Camera & face detection
│   ├── recognition.py           ← Face recognition
│   ├── serial_handler.py         ← Giao tiếp STM32
│   └── database.py              ← Firebase operations
├── face_detection_yunet_2023mar.onnx  ← Model YuNet (đã tải)
├── credentials.json             ← Firebase config (tự copy)
└── bus-venv/                    ← Python virtual environment
```

---

## 🔧 Các Lệnh Makefile Chính

| Lệnh | Mô Tả |
|------|-------|
| `make install` | Cài đầy đủ (apt + venv + pip + models) |
| `make install-system` | Chỉ cài gói apt |
| `make install-python` | Tạo venv + cài pip |
| `make download-models` | Tải model ONNX |
| `make check` | Kiểm tra thư viện & file cần thiết |
| `make run` | Chạy hệ thống |
| `make run-debug` | Chạy + ghi log vào `run.log` |
| `make install-service` | Cài systemd service (auto-start boot) |
| `make uninstall-service` | Gỡ systemd service |
| `make help` | Hiển thị trợ giúp |

---

## 🔄 Watchdog & Auto-Recovery

### Cơ Chế Hoạt Động

```
main.py ─(HB Socket)─> watchdog.py ─> /dev/watchdog ─> Pi hardware
```

1. **main.py** gửi heartbeat (`HB`) qua Unix socket mỗi **3 giây**
2. **watchdog.py** nhận HB và feed `/dev/watchdog` mỗi **5 giây**
3. Nếu main.py không gửi HB trong **15 giây** → watchdog ngừng feed
4. /dev/watchdog timeout → **Pi tự động khởi động lại**

### Log Watchdog
```bash
# Xem log watchdog
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

## 🐛 Troubleshooting

### 1. **Import Error: `ModuleNotFoundError: No module named 'attendance'`**
```bash
# Đảm bảo bạn đang trong thư mục gốc
cd ~/School-Bus-Management-System
# Chạy qua venv
./bus-venv/bin/python3 main.py
```

### 2. **PiCamera2 Not Found**
```bash
# Chỉ chạy được trên Pi thật
# Trên máy dev, có thể comment code camera
# Lỗi này không ảnh hưởng trên Pi thật
```

### 3. **Firebase Connection Error**
```bash
# Kiểm tra credentials.json tồn tại
ls -la credentials.json

# Kiểm tra kết nối mạng
ping firebase.google.com
```

### 4. **Watchdog Timeout → Pi Reboot Liên Tục**
```bash
# Ngắn dịch vụ watchdog tạm thời
sudo systemctl stop watchdog.service

# Debug main.py
make run-debug

# Xem lỗi trong run.log
cat run.log
```

### 5. **Serial Port Error - Không Kết Nối STM32**
```bash
# Kiểm tra port
ls -la /dev/ttyUSB*
ls -la /dev/ttyACM*

# Kiểm tra permission
sudo usermod -a -G dialout $USER
# (logout & login lại)
```

---

## 📊 Monitoring & Status

### Kiểm Tra Service
```bash
# Status main service
sudo systemctl status bus_system.service

# Status watchdog service
sudo systemctl status watchdog.service

# Xem log chi tiết
sudo journalctl -u bus_system.service -n 50
sudo journalctl -u watchdog.service -n 50
```

### Performance Monitoring
```bash
# Xem CPU, Memory, Temperature
top
htop
vcgencmd measure_temp
```

---

## 🔐 Security Notes

- ✅ Credentials.json: **KHÔNG commit vào Git** (đã trong `.gitignore`)
- ✅ Unix socket `/tmp/watchdog.sock`: Chỉ accessible trên local
- ✅ Service chạy dưới user chính (không root recommended)

---

## 🤝 Contribution & Support

Nếu có vấn đề:
1. Kiểm tra logs: `make run-debug` hoặc `journalctl`
2. Report issue với chi tiết error message
3. Ghi lại environment (Pi model, OS version, etc.)

---

## 📄 License

[Your License Here]

---

## 🎯 Next Steps

- [ ] Cài đặt cơ bản (`make install`)
- [ ] Lấy Firebase credentials
- [ ] Chạy test: `make run-debug`
- [ ] Cài systemd service: `make install-service`
- [ ] Monitor logs: `journalctl -u bus_system.service -f`

---

**Phiên bản:** 1.0  
**Cập nhật lần cuối:** 2026-06-04  
**Branch:** Pi  
**Hỗ trợ:** Raspberry Pi 5 / Bullseye

