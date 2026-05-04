# Report Task 2026-05-03

## Yeu cau da nhan

1. Giu nguyen logic `absent`.
2. Tang kich thuoc giao dien vi chu va khung hien tai con nho.
3. Sua bien dem "Vang co phep" de dem dung hoc sinh co phep ngay hom do.
4. Dam bao ban do bam theo GPS that khi co toa do gui ve, va tao file demo de test.

## Ket qua da hoan thanh

### 1. Giu logic `absent`

Trang thai approved van ghi ngay:

```js
students.attendanceStatus = "absent"
```

Khong them logic khung gio/ngay.

File lien quan:

- `src/services/leaveRequestService.js`

### 2. Phong to giao dien

Da tang scale cho cac thanh phan chinh:

- Font body va page title.
- Nut bam.
- Bang danh sach hoc sinh.
- Badge, status button.
- Stat cards.
- Form inputs.
- Modal.
- Map stats, map controls, GPS banner.

File da sua:

- `src/App.css`

### 3. Sua bo dem "Vang co phep"

Van de cu:

- Row co the hien "Vang co phep" vi `attendanceStatus = "absent"`.
- Nhung stat "Vang co phep" chi dem theo `leaveIds` / `leaveBuffer`.
- Ket qua la row hien vang co phep nhung so dem van bang 0.

Da sua:

- Hoc sinh duoc tinh la vang co phep neu co mot trong cac dieu kien:
  - `attendanceStatus === "absent"`
  - Co trong approved leave ids.
  - Co trong leave buffer ids.
- Reset ngay khong reset hoc sinh dang `absent`.
- Click doi status khong tac dong hoc sinh dang `absent`.

File da sua:

- `src/components/MainTable/MainTable.jsx`

### 4. Sua ban do bam theo GPS

Van de cu:

- Marker xe cap nhat theo GPS, nhung che do "Bam theo xe" chi pan map lan dau.

Da sua:

- `followBus` mac dinh la `true`.
- Moi lan `bus/gps` co toa do moi, map se `panTo` toa do moi neu dang bat follow.
- Them label `absent: "Vang co phep"`.
- Them icon/mau rieng cho hoc sinh `absent`.
- Them stat "Vang co phep" tren ban do.

File da sua:

- `src/components/MapView/MapView.jsx`

### 5. File demo GPS ghi truc tiep vao RTDB

Da tao trang React:

- `src/pages/GpsDemoPage.jsx`
- route: `/gps-demo`
- dashboard view: `/dashboard?view=gpsdemo`
- sidebar item: `Demo GPS`

Trang nay dung chung Firebase Auth/RTDB cua app, lay du lieu tram xe tu `busStops`,
lay truong tu `systemConfig/school`, cho chon:

- Di tu: mot tram xe da co GPS.
- Den: mot tram xe khac hoac Truong.

Sau do demo noi suy GPS theo tuyen da chon va ghi truc tiep vao:

```text
bus/gps
```

Payload demo:

```js
{
  lat,
  lng,
  speed,
  accuracy: 6,
  isActive: true,
  source: "web-gps-demo",
  deviceId: "demo-bus-01",
  routeFromId,
  routeFromName,
  routeToId,
  routeToName,
  updatedAt: Date.now()
}
```

File `public/gps-demo.html` hien chi redirect ve `/gps-demo` de tranh mo nham ban demo local cu.

Cap nhat them:

- Da sua loi interval bi dung sau lan ghi GPS dau tien do cleanup effect phu thuoc `lastPayload`.
- Trang demo chi con la bo phat GPS, khong nhung MapView ben trong.
- Xem xe di chuyen tren muc `Ban do` nhu cach van hanh that.
- Khi xe den diem cuoi, demo tu dung va ghi `isActive: false`.

Cach test:

1. Chay app:

```bash
npm start
```

2. Mo mot trong cac duong dan:

```text
http://localhost:3000/gps-demo
http://localhost:3000/dashboard?view=gpsdemo
http://localhost:3000/gps-demo.html
```

Neu cong 3000 dang ban, dung cong dev server hien tai, vi du:

```text
http://localhost:3001/gps-demo
http://localhost:3001/dashboard?view=gpsdemo
http://localhost:3001/gps-demo.html
```

3. Chon tuyen, vi du `Tram 1 -> Truong`.
4. Bam `Chay demo GPS`.
5. Chuyen sang muc `Ban do`.
6. Marker xe se di chuyen theo RTDB `bus/gps`.
7. Khi den diem cuoi, demo tu dung xe.

## Build/verify

Da chay:

```bash
npm run build
```

Ket qua:

- Build thanh cong.
- Build moi nhat sau cac thay doi da `Compiled successfully`.
- Neu Node bi out-of-memory luc build, chay voi:

```bash
$env:NODE_OPTIONS='--max_old_space_size=4096'; npm run build
```

## Ghi chu con lai

- Logic absent hien da duoc giu nhu ban yeu cau.
- Demo GPS moi ghi truc tiep vao RTDB path `bus/gps`, nen MapView trong app se nhan du lieu nay nhu GPS that tu RPi5.
- `arch.md` da duoc cap nhat checklist cac muc vua lam.
