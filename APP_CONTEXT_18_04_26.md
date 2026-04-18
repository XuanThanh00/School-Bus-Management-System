# HỆ THỐNG ĐIỂM DANH XE BUÝT THÔNG MINH
## App Context — Flutter + Firebase
### Cập nhật: 18/04/2026

---

## 1. TỔNG QUAN APP

App dành cho **phụ huynh học sinh** — xem trạng thái điểm danh, theo dõi xe buýt GPS realtime, khai báo nghỉ học, nhận hình ảnh minh chứng đón trả.

**Stack:**
- Flutter (Dành cho Mobile, có thể build Web App)
- Firebase Auth — đăng nhập bằng mật khẩu (hoặc SĐT)
- Firebase Realtime Database — lưu data Node phân ca 2 chuyến/ngày (Sáng/Chiều)
- Phân luồng Stream: Lắng nghe song song Lên (`boarded`) và Xuống (`alighted`).

---

## 2. CẤU TRÚC APP & TÍNH NĂNG (GẦN ĐÂY)

```
school_bus_app/
├── lib/
│   ├── screens/
│   │   ├── home_screen.dart        — ✅ Chuyển sang Stream động (auto AM/PM)
│   │   ├── leave_screen.dart       — ✅ Firebase realtime stream
│   │   ├── map_screen.dart         — ✅ Firebase realtime stream + tính ETA
...
```

**Tính năng nổi bật mới bổ sung:**
- Cửa sổ Hoạt Động Hôm Nay tự động rẽ nhánh Stream dựa vào giờ điện thoại (Trước 12h nghe ca AM, sau 12h nghe ca PM).
- Lịch sử gần đây (7 ngày) lặp vòng lặp quét qua cả mảng `_AM` và `_PM` mỗi ngày, dán thêm Tag (`Sáng`/`Chiều`) ở UI giúp phụ huynh tường minh chuyến đi.

---

## 3. FIREBASE REALTIME DATABASE SCHEMA (HIỆN TẠI)

```json
{
  "users": {
    "{sdt}": {
      "parentName": "string",
      "studentName": "string",
      "studentId": "hs002",         ← Rất quan trọng (Định danh trên Pi và App)
      "className": "string",
      "password": "string",         
      "avatarUrl": "string"         ← Bổ sung: Chứa URL hình ảnh Profile
    }
  },

  "attendance": {
    "{YYYY-MM-DD_AM}": {            ← Có Hậu tố _AM hoặc _PM 
      "{studentId}": {
        "status": 1,                
        "boardedAt": "HH:MM:SS",    
        "boardedLat": 10.773,
        "boardedLng": 106.698,
        "alightedAt": "HH:MM:SS",   ← Được Pi đẩy lên nếu quẹt RFID lúc xuống
        "alightedLat": 10.850,
        "alightedLng": 106.771,
        "evidencePath": "http..."   ← Sẽ là WebViewLink từ Google Drive cấp sang
      }
    }
  },

  "gps": {
    "route01": {
      "lat": 10.7769,
      "lng": 106.7009,
      "speed": 35.5,                ← km/h (Pi đã bắt đầu đẩy data tốc độ)
      "nextStop": "Trạm B – ..."
    }
  }
}
```

---

## 4. FIREBASE CLOUD MESSAGING (FCM) - CHUẨN BỊ LÀM

**Tính năng dự kiến:** 
Mỗi phiên bản App Release sau khi Phụ Huynh cài đặt và đăng nhập, App sẽ bắt bộ sinh `FCM Token` độc nhất của nền tảng (Android/iOS) và lưu lên Firebase Node Database của Users. Khi có báo cáo điểm danh từ Xe buýt (đẩy lên Drive và ghi Firebase xong), mạch Pi (thông qua Service Account) sẽ tự động trigger 1 RestAPI gửi thông báo Rung Điện Thoại vào đúng cái `FCM Token` của phụ huynh đó.

*Đây sẽ là chốt chặn cuối cùng hoàn thiện đồ án ở mức độ thương mại hóa!*
