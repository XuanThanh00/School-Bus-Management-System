# BusAttend – Firebase Architecture Guide

> Tài liệu này mô tả kiến trúc Firebase cho hệ thống **BusAttend** – điểm danh xe buýt trường học.  
> Sử dụng tài liệu này để tích hợp Mobile App (Flutter/React Native) với cùng Firebase project.

---

## 1. Tổng Quan Hệ Thống

```
┌─────────────────┐        ┌──────────────────┐        ┌─────────────────┐
│  Web Admin      │        │   Firebase        │        │  Mobile App     │
│  (React)        │◄──────►│  Auth + Firestore │◄──────►│  (Flutter/RN)   │
└─────────────────┘        └──────────────────┘        └─────────────────┘
                                    ▲
                                    │
                           ┌────────┴────────┐
                           │  ESP32 + RFID   │
                           │  (IoT Device)   │
                           └─────────────────┘
```

| Thành phần     | Vai trò                                              |
|----------------|------------------------------------------------------|
| Web Admin      | Quản lý học sinh, trạm xe, phụ huynh, đơn nghỉ phép |
| Mobile App     | Phụ huynh theo dõi, gửi đơn xin nghỉ, xem bản đồ   |
| ESP32 + RFID   | Đọc thẻ RFID học sinh, ghi lên Firebase              |

---

## 2. Firebase Project Setup

### Khởi tạo Firebase
```javascript
// src/firebase.js
const firebaseConfig = {
  apiKey:            process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain:        process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.REACT_APP_FIREBASE_APP_ID,
};
```

### Services sử dụng
- ✅ **Firebase Authentication** – Email/Password
- ✅ **Cloud Firestore** – Database chính
- ✅ **Firebase Hosting** – Deploy web admin (tùy chọn)

---

## 3. Authentication

### 3.1 Admin (Web Dashboard)
- Đăng nhập bằng **email + password** thông thường
- Role lưu trong Firestore collection `users`

### 3.2 Phụ Huynh (Mobile App)

> **Quy ước quan trọng:** Số điện thoại được chuyển thành email ảo để dùng Firebase Auth.

```
SĐT nhập vào: 0901234567
Firebase email: 0901234567@busattend.app
Mật khẩu mặc định: 123456
```

**Luồng đăng ký (Admin tạo trên web):**
1. Admin nhập tên phụ huynh + SĐT + mật khẩu
2. Web tạo Firebase Auth account: `email = {phone}@busattend.app`
3. Lưu thông tin vào Firestore collection `parents`

**Code Mobile App – Đăng nhập:**
```dart
// Flutter
Future<void> loginWithPhone(String phone, String password) async {
  final email = '${phone}@busattend.app';
  await FirebaseAuth.instance.signInWithEmailAndPassword(
    email: email,
    password: password,
  );
}
```

```javascript
// React Native / JavaScript
async function loginWithPhone(phone, password) {
  const email = `${phone}@busattend.app`;
  await signInWithEmailAndPassword(auth, email, password);
}
```

---

## 4. Firestore Collections

### 4.1 `users` – Tài Khoản Admin
```json
{
  "email": "admin@truong.edu.vn",
  "role": "admin",
  "displayName": "Nguyễn Văn Admin",
  "createdAt": "Timestamp"
}
```

### 4.2 `parents` – Tài Khoản Phụ Huynh
```json
{
  "uid": "firebase-auth-uid",
  "phone": "0901234567",
  "email": "0901234567@busattend.app",
  "displayName": "Nguyễn Thị Lan",
  "studentIds": ["hs001", "hs002"],
  "isActive": true,
  "createdAt": "Timestamp",
  "createdBy": "admin-uid"
}
```
**Query Mobile App:**
```javascript
// Lấy thông tin phụ huynh sau khi login
const parentDoc = await getDocs(query(
  collection(db, 'parents'),
  where('phone', '==', phoneNumber)
));
```

### 4.3 `students` – Học Sinh
```json
{
  "studentId": "hs001",
  "name": "Nguyễn Văn An",
  "class": "10A1",
  "dateOfBirth": "2010-05-15",
  "parentName": "Nguyễn Thị Lan",
  "parentPhone": "0901234567",
  "imageData": "data:image/jpeg;base64,...",
  "rfidCardId": "RFID_001A2B3C",
  "status": false,
  "location": {
    "lat": 10.7769,
    "lng": 106.7009,
    "accuracy": 5,
    "timestamp": "Timestamp"
  },
  "createdAt": "Timestamp"
}
```

**Query Mobile App – Lấy học sinh theo SĐT phụ huynh:**
```javascript
const q = query(
  collection(db, 'students'),
  where('parentPhone', '==', parentPhone)
);
const students = await getDocs(q);
```

### 4.4 `busStops` – Trạm Xe Buýt
```json
{
  "name": "Trạm 1 – Cổng Trường",
  "address": "123 Đường Lê Lợi, Quận 1, TP.HCM",
  "location": {
    "lat": 10.7769,
    "lng": 106.7009
  },
  "order": 1,
  "isActive": true,
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

**Query Mobile App – Lấy danh sách trạm (real-time):**
```javascript
const unsubscribe = onSnapshot(
  query(collection(db, 'busStops'), where('isActive', '==', true), orderBy('order')),
  (snapshot) => {
    const stops = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    setBusStops(stops);
  }
);
```

### 4.5 `leaveRequests` – Đơn Xin Nghỉ Học
```json
{
  "studentId": "hs001",
  "studentName": "Nguyễn Văn An",
  "studentClass": "10A1",
  "parentName": "Nguyễn Thị Lan",
  "parentPhone": "0901234567",
  "startDate": "2024-01-15",
  "endDate": "2024-01-16",
  "reason": "Bị bệnh, có đơn của bác sĩ",
  "status": "pending",
  "submittedAt": "Timestamp",
  "reviewedAt": null,
  "reviewedBy": null,
  "adminNote": ""
}
```
> **Status values:** `pending` | `approved` | `rejected`

**Mobile App – Gửi đơn xin nghỉ:**
```javascript
await addDoc(collection(db, 'leaveRequests'), {
  studentId, studentName, studentClass,
  parentName, parentPhone,
  startDate, endDate, reason,
  status: 'pending',
  submittedAt: serverTimestamp(),
  reviewedAt: null,
  reviewedBy: null,
  adminNote: '',
});
```

**Mobile App – Lắng nghe trạng thái đơn:**
```javascript
const unsubscribe = onSnapshot(
  query(
    collection(db, 'leaveRequests'),
    where('parentPhone', '==', parentPhone),
    orderBy('submittedAt', 'desc')
  ),
  (snapshot) => { /* update UI */ }
);
```

### 4.6 `attendance` – Điểm Danh Hàng Ngày
```json
{
  "studentId": "hs001",
  "studentName": "Nguyễn Văn An",
  "date": "2024-01-15",
  "status": "present",
  "boardedAt": "Timestamp",
  "alightedAt": "Timestamp",
  "busStopId": "stopDocId",
  "rfidCardId": "RFID_001A2B3C",
  "routeId": "routeDocId"
}
```
> **Status values:** `present` | `absent` | `leave`

### 4.7 `rfid_scans` – Quét RFID (từ ESP32)
```json
{
  "rfidCardId": "RFID_001A2B3C",
  "studentId": "hs001",
  "studentName": "Nguyễn Văn An",
  "studentClass": "10A1",
  "studentPhone": "0123456789",
  "busStopId": "stopDocId",
  "timestamp": "Timestamp",
  "registered": false
}
```

### 4.8 `logs` – Nhật Ký Hoạt Động
```json
{
  "userId": "admin-uid",
  "action": "Thêm học sinh: Nguyễn Văn An",
  "timestamp": "Timestamp"
}
```

---

## 5. Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    function isAuthUser() {
      return request.auth != null;
    }

    // Admin accounts
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }

    // Parent accounts – admin ghi, parent đọc của mình
    match /parents/{parentId} {
      allow read: if isAuthUser();
      allow write: if isAdmin();
    }

    // Students – admin quản lý, parents đọc
    match /students/{studentId} {
      allow read: if isAuthUser();
      allow write: if isAdmin();
    }

    // Bus stops – admin quản lý, tất cả đọc
    match /busStops/{stopId} {
      allow read: if isAuthUser();
      allow write: if isAdmin();
    }

    // Leave requests – parents tạo, admin duyệt
    match /leaveRequests/{reqId} {
      allow read: if isAuthUser();
      allow create: if isAuthUser();
      allow update: if isAdmin();
      allow delete: if isAdmin();
    }

    // Attendance – admin quản lý, tất cả đọc
    match /attendance/{attId} {
      allow read: if isAuthUser();
      allow write: if isAdmin();
    }

    // RFID scans – ESP32 ghi (không có auth), admin đọc
    match /rfid_scans/{scanId} {
      allow read: if isAuthUser();
      allow write: if true; // ESP32 REST API không có Firebase Auth
    }

    // Logs
    match /logs/{logId} {
      allow read: if isAdmin();
      allow create: if isAuthUser();
    }
  }
}
```

---

## 6. Firestore Composite Indexes

Tạo trong Firebase Console → Firestore → Indexes:

| Collection      | Field 1          | Field 2              |
|-----------------|------------------|----------------------|
| leaveRequests   | status ASC       | submittedAt DESC     |
| leaveRequests   | parentPhone ASC  | submittedAt DESC     |
| rfid_scans      | registered ASC   | timestamp DESC       |
| attendance      | date ASC         | studentId ASC        |
| busStops        | isActive ASC     | order ASC            |
| students        | parentPhone ASC  | createdAt DESC       |

---

## 7. Environment Variables

### Web Admin (.env.local)
```bash
REACT_APP_FIREBASE_API_KEY=AIzaSy...
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=123456789
REACT_APP_FIREBASE_APP_ID=1:123456789:web:abc123
```

### Mobile App
- **Android:** Tải `google-services.json` từ Firebase Console → Project Settings → Your Apps
- **iOS:** Tải `GoogleService-Info.plist` từ Firebase Console → Project Settings → Your Apps

---

## 8. ESP32 RFID Integration

### Thư viện cần dùng
```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <MFRC522.h>
```

### Ghi RFID scan lên Firestore (REST API)
```cpp
void sendRFIDScan(String rfidCardId) {
  HTTPClient http;
  String url = "https://firestore.googleapis.com/v1/projects/YOUR_PROJECT_ID"
               "/databases/(default)/documents/rfid_scans";

  StaticJsonDocument<512> doc;
  doc["fields"]["rfidCardId"]["stringValue"]  = rfidCardId;
  doc["fields"]["registered"]["booleanValue"] = false;
  // timestamp sẽ do server tự điền nếu dùng serverTimestamp

  String body;
  serializeJson(doc, body);

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
}
```

---

## 9. Mobile App – Tích Hợp Nhanh

### Flutter pubspec.yaml
```yaml
dependencies:
  firebase_core: ^2.24.0
  firebase_auth: ^4.15.0
  cloud_firestore: ^4.13.0
```

### Khởi tạo
```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  runApp(const MyApp());
}
```

### Login phụ huynh
```dart
Future<UserCredential> loginParent(String phone, String password) {
  return FirebaseAuth.instance.signInWithEmailAndPassword(
    email: '$phone@busattend.app',
    password: password,
  );
}
```

### Stream đơn xin nghỉ của phụ huynh
```dart
Stream<QuerySnapshot> myLeaveRequests(String phone) =>
  FirebaseFirestore.instance
    .collection('leaveRequests')
    .where('parentPhone', isEqualTo: phone)
    .orderBy('submittedAt', descending: true)
    .snapshots();
```

### Stream danh sách trạm xe (real-time)
```dart
Stream<QuerySnapshot> busStopsStream() =>
  FirebaseFirestore.instance
    .collection('busStops')
    .where('isActive', isEqualTo: true)
    .orderBy('order')
    .snapshots();
```

---

## 10. Ghi Chú Quan Trọng

1. **Ảnh học sinh** lưu dạng Base64 trong Firestore (không dùng Firebase Storage).  
   Nếu cần tối ưu, chuyển sang Firebase Storage và lưu URL.

2. **RFID scans** cho phép ghi không cần auth (ESP32 không có Firebase SDK).  
   Cân nhắc thêm API key hoặc custom token nếu cần bảo mật.

3. **Password mặc định** của tài khoản phụ huynh là `123456`.  
   Khuyến nghị phụ huynh đổi mật khẩu sau lần đăng nhập đầu tiên.

4. **studentId** format: `hs001`, `hs002`, ...  
   Tạo tự động dựa trên số thứ tự hoặc nhập thủ công.
