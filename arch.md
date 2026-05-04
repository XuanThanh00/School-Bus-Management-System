# BusAttend Architecture & Cleanup Checklist

Cap nhat: 2026-05-03

Tai lieu nay thay the cac file `.md` cu trong repo. Muc tieu la gom lai kien truc hien tai, cac diem chua clean trong `src`, cac rui ro khi tich hop phan cung, va checklist de hoan thien project.

## Quyet dinh hien tai

- Don xin nghi khi duoc `approved` se ghi ngay `students.attendanceStatus = "absent"`.
- Chua set khung gio/ngay cho luong approved vi don duoc duyet tay.
- Field diem danh chinh la `attendanceStatus`; field `status` trong `students` chi la legacy boolean va nen duoc loai bo dan.
- RTDB dung cho du lieu realtime ngan han: `rfid/pending`, `bus/gps`.
- Firestore dung cho du lieu chinh: hoc sinh, phu huynh, tram xe, don nghi, log, cau hinh truong, lich su diem danh.

## Kien truc phan cung theo mo ta

Anh phan cung ban cung cap mo ta 4 khoi chinh:

```text
ESP32 + RFID
  - Muc dich: dang ky the moi
  - Doc UID va day UID len Realtime Database

Realtime Database
  - Nhan UID dang cho gan the
  - Nhan GPS realtime tu xe
  - Web lang nghe de map UID/GPS len giao dien

Raspberry Pi 5
  - Chay tren xe
  - Doc GPS va gui len RTDB `bus/gps`
  - Doc UID RFID khi hoc sinh len xe
  - Xac thuc UID voi Firestore
  - Ghi trang thai diem danh vao Firestore `students`

Web Admin
  - Quan ly hoc sinh, tram xe, phu huynh, don nghi
  - Lang nghe RTDB `rfid/pending` de gan the
  - Lang nghe RTDB `bus/gps` de hien thi ban do va auto-arrival
  - Doc/ghi Firestore
```

Luong du kien:

```text
Dang ky the:
ESP32 quet RFID -> RTDB rfid/pending -> Web Admin hien UID -> Admin luu hoc sinh -> Firestore students.rfidCardId

Diem danh len xe:
RPi5 doc UID -> query Firestore students.rfidCardId -> neu hop le -> ghi students.attendanceStatus = "boarded"

GPS xe:
RPi5 doc GPS -> RTDB bus/gps -> Web/MapView hien marker xe

Den truong:
Web Admin thay bus/gps cach school <= 150m -> doi hoc sinh "boarded" sang "arrived"

Don nghi:
Parent/mobile tao leaveRequests -> Admin approved -> Web/service ghi leaveBuffer va students.attendanceStatus = "absent"
```

## Firebase hien tai theo anh console

Firestore dang co cac collection:

- `attendanceRecords`
- `busStops`
- `leaveBuffer`
- `leaveRequests`
- `logs`
- `parents`
- `students`
- `systemConfig`
- `users`

RTDB dang duoc code su dung:

- `rfid/pending`
- `bus/gps`

## Schema Firestore hien tai

### `students/{firestoreDocId}`

Theo anh console va code:

```js
{
  studentId: "hs71597",
  name: "Nguyen Van A",
  class: "1A2",
  dateOfBirth: "01/01/2001",
  parentName: "Nguyen Thi B",
  parentPhone: "098765432",
  rfidCardId: "UID...",
  attendanceStatus: "not_boarded" | "boarded" | "arrived" | "not_arrived" | "absent",
  attendanceUpdatedAt: Timestamp,
  status: false, // legacy, dang gay nhieu nham lan
  busStopId: "W3PX...",
  busStopName: "1",
  location: {
    lat: 10.8490941,
    lng: 106.7740779,
    accuracy: 0,
    timestamp: Timestamp
  },
  imageData: "data:image/..." | "",
  createdAt: Timestamp
}
```

Van de:

- Co 2 ID: Firestore doc id va `studentId`. Nhieu code dung lan ca hai.
- `status` boolean va `attendanceStatus` string ton tai song song.
- `location` cua hoc sinh hien dang la vi tri tram xe, ten field de gay hieu nham voi GPS realtime cua hoc sinh.
- `imageData` base64 trong Firestore de cham va de cham gioi han 1MB/document.

Huong clean:

- Chon `students/{firestoreDocId}` lam primary document id, giu `studentId` la ma hien thi.
- Tat ca diem danh chi ghi `attendanceStatus`.
- Doi `location` thanh `busStopLocation` neu do la vi tri tram.
- Ve sau nen chuyen anh sang Firebase Storage/Cloudinary, Firestore chi luu `photoUrl`.

### `parents/{parentDocId}`

Theo anh console va code:

```js
{
  uid: "firebaseAuthUid",
  phone: "098765432",
  email: "098765432@busattend.app",
  displayName: "Nguyen Thi B",
  studentIds: ["hs71597"],
  hasAuth: true,
  isActive: true,
  defaultPassword: "123456",
  fcmToken: "...",
  createdAt: Timestamp,
  authCreatedAt: Timestamp,
  createdBy: "adminUid"
}
```

Van de:

- `defaultPassword` dang luu plaintext trong Firestore va UI co the hien ra. Day la rui ro bao mat lon.
- `studentIds` dang luu custom `studentId`, khong phai Firestore doc id. Khi doi ma hoc sinh se vo lien ket.
- Xoa parent trong UI chi xoa Firestore, khong xoa Firebase Auth.

Huong clean:

- Xoa `defaultPassword` khoi schema. Admin chi tao/reset password qua Firebase Auth hoac flow "send password reset".
- Them `studentDocIds` hoac doi `studentIds` thanh Firestore doc ids.
- Neu can mobile app, parent doc nen co `role: "parent"` va mapping ro rang voi Auth user.

### `leaveRequests/{requestId}`

Theo anh console va code:

```js
{
  studentId: "hs71597",
  studentName: "Nguyen Van A",
  studentClass: "1A2",
  parentId: "6y102...",
  parentName: "...",
  parentPhone: "...",
  reason: "bi om",
  startDate: "2026-05-04",
  endDate: "2026-05-04",
  status: "pending" | "approved" | "rejected",
  adminNote: "",
  createdAt: Timestamp,
  reviewedAt: Timestamp,
  reviewedBy: "adminUid" | "auto"
}
```

Quyet dinh hien tai:

- Khi status thanh `approved`, ghi ngay `students.attendanceStatus = "absent"`.

Van de:

- Code `submitLeaveRequest()` hien van auto-approve, trong khi quy trinh moi ban noi la duyet tay.
- `listenToApprovedLeavesForDate()` van filter theo ngay, con luong approved ghi absent ngay. Hai logic nay chua cung mot chinh sach.
- Don nghi dang copy `studentName`, `studentClass`, `parentName`; tien cho lich su, nhung can chap nhan la co the stale neu hoc sinh doi thong tin.

Huong clean:

- Doi submit tu mobile/parent ve `status: "pending"`.
- Chi `approveLeaveRequest()` moi set `approved`, ghi `leaveBuffer`, va ghi `absent`.
- Neu giu logic "duyet la absent ngay", `leaveBuffer` co the thanh cache hoac bo han, tranh hai nguon su that.

### `leaveBuffer/{studentId}`

Theo anh console:

```js
{
  studentId: "hs71597",
  status: true,
  startDate: "2026-05-04",
  endDate: "2026-05-04",
  updatedAt: Timestamp
}
```

Van de:

- `leaveBuffer` la duplicate state cua `leaveRequests`.
- `studentService` van check buffer theo ngay UTC, nhung luong approved vua doi absent ngay.
- Neu buffer bi mat/loi, guard leave co the sai.

Huong clean:

- Lua chon A: giu `leaveBuffer` nhu cache nhanh, duoc tao/xoa duy nhat trong approve/reject/delete.
- Lua chon B: bo `leaveBuffer`, moi thu dua vao `leaveRequests.status = approved`.
- Neu can RPi5 doc nhanh, A tot hon, nhung can Cloud Function/transaction de dong bo chac chan.

### `busStops/{stopId}`

Theo anh console va code:

```js
{
  name: "1",
  address: "17 Duong so 6, Binh Duong 2, Di An",
  order: 2,
  isActive: true,
  location: {
    lat: 10.8712022,
    lng: 106.7596499
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Van de:

- `listenToBusStops()` lay tat ca, khong filter `isActive`.
- Xoa tram dang hard delete, co the lam hoc sinh dang tham chieu `busStopId` bi mo coi.
- Geocoding dung Nominatim truc tiep tu browser, can can nhac rate limit va user-agent dung chuan.

Huong clean:

- Dung soft delete `isActive: false`.
- Khi xoa/sua tram, can check hoc sinh dang lien ket.
- Them `routeId` neu ve sau co nhieu tuyen xe.

### `systemConfig/school`

Theo anh console:

```js
{
  name: "Dai hoc Su Pham Ky Thuat",
  address: "So 1, Vo Van Ngan",
  lat: 10.8493795,
  lng: 106.7736075
}
```

Van de:

- Ban kinh den truong `150m` dang hard-code trong `MainTable`.
- Reset trigger khi xe ra xa `300m` cung hard-code.

Huong clean:

- Dua `arrivalRadiusMeters` va `resetArrivalRadiusMeters` vao `systemConfig/school` hoac `systemConfig/attendance`.

### `logs/{logId}`

```js
{
  userId: "adminUid",
  action: "text",
  timestamp: Timestamp
}
```

Van de:

- Log chi la text, kho query theo entity/action.
- Khong co `actorRole`, `entityType`, `entityId`.

Huong clean:

- Schema nen la `{ actorId, actorRole, actionType, entityType, entityId, message, createdAt }`.

### `attendanceRecords/{recordId}`

Collection co ton tai theo anh console, nhung code hien tai hau nhu chua ghi lich su vao day.

Van de:

- Trang thai hien tai chi nam tren `students`. Mat lich su diem danh theo ngay.
- Khi reset ngay, du lieu cu co the mat y nghia.

Huong clean de xuat:

```js
attendanceRecords/{yyyyMMdd_studentDocId}
{
  date: "2026-05-03",
  studentDocId: "...",
  studentId: "hs71597",
  status: "boarded" | "arrived" | "not_boarded" | "not_arrived" | "absent",
  events: [
    { type: "boarded", at: Timestamp, source: "rpi5", deviceId: "bus-01", uid: "..." },
    { type: "arrived", at: Timestamp, source: "web", gps: { lat, lng } }
  ],
  isOnLeave: true,
  leaveRequestId: "...",
  updatedAt: Timestamp
}
```

## RTDB schema hien tai/de xuat

### `rfid/pending`

Code hien tai:

```js
{
  uid: "A1B2C3D4",
  scannedAt: 1713456789000,
  source: "esp32"
}
```

Rui ro:

- Chi co mot slot `pending`, quet nhieu the lien tiep se ghi de.
- Khong co `deviceId`.
- Khong co TTL/expiry.
- Neu web khong mo, UID co the bi treo.

De xuat:

```js
rfid/pending/{scanId}
{
  uid: "A1B2C3D4",
  deviceId: "esp32-reg-01",
  source: "esp32",
  scannedAt: 1713456789000,
  expiresAt: 1713456819000,
  claimedBy: null,
  claimedAt: null
}
```

Cho demo hien tai co the giu `rfid/pending`, nhung truoc khi dung that nen chuyen sang queue.

### `bus/gps`

Code hien tai dang doc:

```js
{
  lat: 10.8493795,
  lng: 106.7736075,
  speed: 25.5,
  isActive: true,
  updatedAt: 1713456789000
}
```

Rui ro:

- Chi ho tro 1 xe.
- Khong co heading, accuracy, deviceId.
- Khong co heartbeat/offline threshold ro rang.

De xuat neu co nhieu xe:

```js
bus/gps/{busId}
{
  lat: 10.8493795,
  lng: 106.7736075,
  speedKmh: 25.5,
  heading: 180,
  accuracy: 8,
  isActive: true,
  deviceId: "rpi5-bus-01",
  updatedAt: 1713456789000
}
```

## Checklist van de chua clean trong `src`

### P0 - Can xu ly truoc khi chay that

- [ ] Doi luong don nghi neu dung duyet tay: `submitLeaveRequest()` tao `pending`, chi `approveLeaveRequest()` moi ghi `approved` va `absent`.
- [ ] Viet Firebase Security Rules cho Firestore va RTDB. Repo hien chua co file rules.
- [ ] Khong luu `parents.defaultPassword` plaintext trong Firestore.
- [ ] Chot primary id cho hoc sinh: nen dung Firestore doc id cho lien ket noi bo, `studentId` chi la ma hien thi.
- [ ] Bo hoac migrate field legacy `students.status`; UI ParentAccounts hien van doc `s.status`.
- [ ] Tao luong RPi5 chinh thuc: xac thuc UID, check leave, ghi `attendanceStatus`, ghi `attendanceRecords`.
- [ ] Chuyen RFID pending tu single-slot sang queue neu co kha nang quet nhieu the.
- [ ] Them co che offline/heartbeat cho `bus/gps`; UI hien "offline" khi `updatedAt` qua cu.

### P1 - Nen lam som

- [ ] Chuyen `imageData` base64 sang Storage/URL de tranh gioi han Firestore document.
- [ ] Doi `students.location` thanh `busStopLocation` hoac `homeLocation` de tranh nham voi GPS realtime.
- [ ] Dung `serverTimestamp()` cho `createdAt`, `updatedAt`, `attendanceUpdatedAt`, `reviewedAt`.
- [ ] Them `deviceId`, `source`, `updatedBy` vao cac write quan trong.
- [ ] Them `attendanceRecords` theo ngay de khong mat lich su khi reset.
- [ ] Chuyen hard-code `150m/300m` sang `systemConfig`.
- [ ] Soft delete bus stops thay vi hard delete.
- [ ] Validate duplicate `studentId`, duplicate `parentPhone`, duplicate `rfidCardId` bang transaction/rules.
- [ ] Them error UI thay vi chi `console.error` o nhieu component.
- [ ] Dung consistent field name: `createdAt`, `updatedAt`, `reviewedAt`, khong tron `timestamp`.

### P2 - Dep va de bao tri hon

- [ ] Tach attendance domain logic khoi `MainTable`; auto-arrival nen nam trong service hoac Cloud Function.
- [ ] Gom status constants vao mot file chung thay vi lap lai trong MainTable/MapView.
- [ ] Doi geocoding sang backend/proxy neu dung nhieu de tranh rate limit.
- [ ] Them test cho `leaveRequestService`, `studentService`, `rfidService`.
- [ ] Them ESLint cleanup: unused `getStudentsByIds` trong MainTable, unused `presentIcon` trong MapView.
- [ ] Chuan hoa tieng Viet trong UI va comments; bo comment cu khong con dung.

## Checklist tich hop ESP32 RFID

- [ ] ESP32 ghi UID len RTDB dung path web dang nghe.
- [ ] Payload toi thieu: `{ uid, scannedAt, source: "esp32", deviceId }`.
- [ ] Neu giu single-slot `rfid/pending`, web phai clear sau khi gan thanh cong.
- [ ] Them timeout: UID qua 30-60 giay thi web coi la het han.
- [ ] Rules RTDB cho `rfid/pending`: chi cho device ghi dung shape, admin authenticated doc.
- [ ] Test duplicate UID: the da gan cho hoc sinh khac thi UI phai chan submit.
- [ ] Test race: quet the A roi B lien tuc, UI co nhan dung the cuoi khong.
- [ ] Chot UID format: uppercase/lowercase, co/khong dau cach, normalize truoc khi luu.

## Checklist tich hop Raspberry Pi 5

- [ ] RPi5 co credential an toan: service account o thiet bi hoac custom token qua backend, khong dung key web.
- [ ] RPi5 doc RFID UID va normalize cung cach voi web.
- [ ] RPi5 query Firestore `students where rfidCardId == uid limit 1`.
- [ ] Neu co face recognition, model label nen map ve Firestore doc id hoac custom `studentId` nhung phai thong nhat.
- [ ] Truoc khi ghi `boarded`, RPi5 check hoc sinh co `attendanceStatus == "absent"` hay co `leaveBuffer` khong de khong override don nghi.
- [ ] Khi xac thuc thanh cong, ghi `students.attendanceStatus = "boarded"` va `attendanceUpdatedAt`.
- [ ] Ghi them event vao `attendanceRecords`.
- [ ] RPi5 day GPS len RTDB `bus/gps` moi 1-3 giay voi `{ lat, lng, speed, accuracy, updatedAt, isActive }`.
- [ ] Khi mat GPS/Wi-Fi, set `isActive: false` hoac de web offline theo `updatedAt`.
- [ ] Co retry/backoff khi Firestore/RTDB fail.
- [ ] Co local log tren Pi de debug khi mat mang.

## Checklist Web Admin

- [x] MainTable hien dung `attendanceStatus` va disable hoc sinh `absent`.
- [x] Reset ngay khong duoc reset hoc sinh dang nghi phep neu con approved/absent.
- [ ] Auto-arrival chi doi `boarded -> arrived`, khong doi `absent`.
- [x] MapView them label/icon cho `absent`.
- [ ] ParentAccounts khong hien `status` legacy nua; doi sang `attendanceStatus`.
- [ ] LeaveRequests text can khop voi quy trinh moi: duyet tay hay auto-approve.
- [ ] Co man hinh/thong bao trang thai phan cung: ESP32 online, RPi5 online, GPS last update.

## Cap nhat thuc hien 2026-05-03

- [x] Giu logic approved -> `students.attendanceStatus = "absent"` ngay.
- [x] Tang scale UI: chu, bang, nut, stat cards, form controls va map controls lon hon.
- [x] Sua bo dem "Vang co phep" de tinh ca hoc sinh co `attendanceStatus = "absent"`, khong chi dua vao `leaveIds/leaveBuffer`.
- [x] Reset ngay va status cycle khong tac dong hoc sinh dang `absent`.
- [x] MapView mac dinh bat "Bam theo xe" va pan theo moi lan GPS cap nhat.
- [x] Tao route demo `/gps-demo` va dashboard view `?view=gpsdemo` cho chon tram goc/noi toi, noi suy GPS theo tuyen, va ghi truc tiep vao RTDB `bus/gps`.
- [x] Demo GPS chi phat RTDB `bus/gps`; xem xe tren MapView that. Khi den diem cuoi, demo tu dung va ghi `isActive: false`.

## Huong to chuc du lieu tot nhat

De project on dinh khi co phan cung, nen chot cac nguon su that:

```text
students
  Nguon su that cho ho so hoc sinh va trang thai diem danh hien tai.

attendanceRecords
  Nguon su that cho lich su theo ngay.

leaveRequests
  Nguon su that cho don nghi.

leaveBuffer
  Cache nhanh cho approved leave neu RPi5 can check nhanh. Neu khong can, bo.

parents
  Nguon su that cho profile phu huynh, khong luu password plaintext.

busStops
  Nguon su that cho tram xe.

systemConfig
  Cau hinh truong, ban kinh den truong, cau hinh attendance.

RTDB rfid/pending
  Hang doi UID dang cho gan the.

RTDB bus/gps
  Stream GPS realtime cua xe.
```

Trang thai diem danh nen chot:

```text
not_boarded  - Chua len xe
boarded      - Da len xe
arrived      - Da den truong
not_arrived  - Vang khong phep
absent       - Vang co phep
```

Khong nen dung `moving` lam data trong Firestore. `moving` chi nen la trang thai hien thi cua UI khi `boarded` va `bus/gps` con moi.

## Checklist hoan thien theo thu tu de lam

### Dot 1 - Dong bo data va luong don nghi

- [ ] Chot duyet tay hay auto-approve.
- [x] Neu duyet tay: sua `submitLeaveRequest()` ve `pending`.
- [x] Giu logic approved -> absent ngay nhu hien tai.
- [ ] ParentAccounts doi sang doc `attendanceStatus`.
- [ ] MapView them label/icon cho `absent`.
- [x] Viet script migrate: neu student co `status`, convert sang `attendanceStatus` roi bo dung `status`.

### Dot 2 - Chuan bi phan cung

- [ ] Chot RTDB payload cho ESP32 va RPi5.
- [ ] Viet rules RTDB/Firestore.
- [ ] Viet script RPi5 mau: scan UID -> query student -> update attendance -> write record.
- [ ] Test ESP32 push `rfid/pending` voi web dang mo.
- [ ] Test RPi5 push `bus/gps` voi MapView/MainTable.

### Dot 3 - Lich su va bao cao

- [x] Implement `attendanceRecords`.
- [x] Khi RPi5 ghi `boarded`, append event vao record ngay.
- [x ] Khi web auto-arrival ghi `arrived`, append event vao record ngay.
- [x] Khi approve leave ghi `absent`, append event vao record ngay.
- [x] Tao man hinh xem lich su theo ngay/lop.

### Dot 4 - Bao mat va san sang demo that

- [ ] Xoa plaintext password.
- [ ] Chuyen anh qua Storage/URL.
- [ ] Doi RFID pending thanh queue.
- [ ] Them heartbeat cho thiet bi.
- [ ] Them backup/debug logs cho RPi5.
- [ ] Chay full build va test voi Firebase project that.

## Ghi chu code hien tai

- `src/services/leaveRequestService.js`: da duoc sua de approved ghi `absent` ngay.
- `src/services/studentService.js`: write attendance vao `attendanceStatus`, day la dung huong.
- `src/services/leaveBufferService.js`: van check ngay bang UTC; neu giu buffer cho san pham that thi can xu ly timezone/local date sau.
- `src/components/MainTable/MainTable.jsx`: dang la noi lam qua nhieu viec: render, listen students, listen leave, listen GPS, auto-arrival, RFID edit. Ve sau nen tach bot logic.
- `src/components/MapView/MapView.jsx`: doc GPS tot, nhung chua hien `absent` nhu mot status rieng.
- `src/components/ParentAccounts/ParentAccounts.jsx`: dang dung `s.status` legacy va hien password, can sua.
- `src/firebase.js`: `getAnalytics(app)` co the can guard neu env thieu `measurementId` hoac chay moi truong khong ho tro analytics.

## Build status gan nhat

Lenh da chay:

```bash
npm run build
```

Ket qua:

- Build thanh cong.
- Con warning:
  - `MainTable.jsx`: `getStudentsByIds` imported but unused.
  - `MapView.jsx`: `presentIcon` assigned but unused.
