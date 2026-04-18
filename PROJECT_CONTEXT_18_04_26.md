# HỆ THỐNG ĐIỂM DANH XE BUÝT THÔNG MINH
## Project Context — Tích hợp Google Drive, Firebase & Chia Ca Sáng/Chiều
*Cập nhật: 18/04/2026*

---

## 1. TỔNG QUAN

Đồ án tốt nghiệp: Hệ thống điểm danh học sinh trên xe buýt, nhận diện khuôn mặt + thẻ RFID (2 yếu tố) đồng bộ hóa đám mây theo thời gian thực (Real-time).

**Kiến trúc Đám mây (Mới):**
```
┌─────────────────────────────────────────────────────────┐
│                   Raspberry Pi 5                        │
│                                                         │
│  Camera OV5647 → YuNet detect → Buffalo recognize      │
│  Tự động quét & tải tham chiếu từ Drive (drive_api.py)  │
│  Điểm danh/Xuống xe (core.py + rfid)                    │
│  Upload hình ảnh minh chứng → Google Drive              │
│  Đẩy data Realtime & GPS liên tục → Firebase           │
└─────────────────────────┬───────────────────────────────┘
                          │ USART1 115200 baud
┌─────────────────────────▼───────────────────────────────┐
│              STM32F103C8T6 (Blue Pill)                  │
│                                                         │
│  RC522 RFID (Điểm danh lên, quét xuống)                 │
│  GPS NEO-6M (Cập nhật Protocol: Truyền Tốc Độ 12 Bytes)│
│  MP3-TF-16P (Loa báo động, chặn delay tự giới hạn)     │
└─────────────────────────────────────────────────────────┘
```

---

## 2. THAY ĐỔI KIẾN TRÚC GẦN ĐÂY NHẤT (14/04 - 18/04)

| Thành phần | Cũ | Mới (18/04/2026) |
|------------|----|------------------|
| Cấu trúc Ca | 1 session/ngày (`YYYY-MM-DD`) | **2 session/ngày** (`_AM` và `_PM` chia lúc 12h00) |
| Trạng thái xuống xe | Bị ghi đè dữ liệu hoặc kẹt 1 lần | Cơ chế Reset DB `alighted_at` cho phép Lên-Xuống nhiều lần |
| Lưu ảnh minh chứng | Chỉ lưu trên Local thẻ nhớ Pi | Upload public lên **Google Drive**, lấy HTTP link gửi Firebase |
| Fetch dữ liệu khuôn mặt | Chép USB thủ công | Auto-sync từ **Google Drive (Reference)** khi nổ máy Pi |
| STM32 Gps Protocol | 8-byte (chỉ có Tọa độ) | **12-byte** (Tọa độ + `gps_speed_kmh` float) |

---

## 3. CẤU TRÚC FILE HIỆN TẠI (Python Pi)

```
Bus_system/
├── main.py                  
├── bus_system.db            
└── attendance/
    ├── config.py            — Lưu khóa Firebase + Google Drive [MỚI CẬP NHẬT]
    ├── core.py              — Tích hợp Drive Upload Threading [MỚI CẬP NHẬT]
    ├── db.py                — Chia ca AM/PM, reset Alighted fields [MỚI CẬP NHẬT]
    ├── stm32_protocol.py    — Decode 12 Bytes GPS (Speed) [MỚI CẬP NHẬT]
    ├── firebase_sync.py     — Giao tiếp Firebase REST API (Sáng/Chiều) [Viết Mới]
    ├── drive_api.py         — Google Drive Service API [Viết Mới]
    ...
```

---

## 4. SQLITE SCHEMA (bus_system.db)

*Lưu ý: Schema đã tự động Migrate*
```sql
students (
    id, full_name, class_name,
    uid UNIQUE, 
    student_id TEXT,    -- Tính năng mới: đồng bộ ID của Firebase
    created_at
)

attendance_sessions (
    id,
    date UNIQUE,        -- [THAY ĐỔI] YYYY-MM-DD_AM hoặc _PM (2 chuyến/ngày)
    route,
    created_at
)

attendance_records (
    id, session_id FK, student_id FK,
    status,             -- 0=vắng, 1=có mặt
    checked_at,         -- Giờ điểm danh lên (boardedAt)
    evidence_path,      -- Link Google Drive (WebViewLink)
    gps_lat, gps_lon,   -- Trạng thái Boarded
    alighted_at TEXT,   -- [THAY ĐỔI] Giờ quẹt thẻ xuống xe
    alighted_lat REAL,  
    alighted_lon REAL
)
```

---

## 5. CẤU TẠO CONFIG.PY MỚI

```python
# ══════════════════════════════════════════════════════════
# FIREBASE & GOOGLE DRIVE
# ══════════════════════════════════════════════════════════
FIREBASE_URL      = "https://bus-attend-3b40c-default-rtdb.firebaseio.com"
FIREBASE_SECRET   = "-OK83Pym_T3S_R1MhR2R"
FIREBASE_ROUTE_ID = "route01"
GPS_PUSH_INTERVAL = 10.0

GDRIVE_CREDENTIALS   = "credentials.json"
GDRIVE_EVIDENCE_ID   = "ID_evidence_images"
GDRIVE_REFERENCE_ID  = "ID_reference_faces"
```

---

## 6. TODO CÒN LẠI (Tới chặng cuối cùng)

### Sắp triển khai:
- [ ] Tính năng Push Notification (FCM): Bắn thông báo về điện thoại cài App mỗi khi con lên/xuống xe.

### Vận hành:
- Xoá rác Firebase test ngày cũ trước khi demo.
- Setup cho `main.py` tự chạy lúc khởi động mạch (Systemd / Crontab).
