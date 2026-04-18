# 🚀 Hướng Dẫn Setup ReactJS - Student Management Web

## ✅ Bước 1: Project đã được tạo

React project đã được tạo tại: `c:\Users\PC\Desktop\src\student-management`

## 📦 Bước 2: Dependencies đã cài đặt

Các package chính đã được cài:
- `react` (v18+)
- `react-dom` (v18+)
- `react-scripts`
- `firebase` - Backend/Authentication
- `react-router-dom` - Routing

## 📂 Bước 3: Cấu trúc Thư Mục

```
student-management/
├── node_modules/
├── public/
│   ├── index.html
│   └── favicon.ico
├── src/
│   ├── components/
│   │   ├── Sidebar/
│   │   │   └── Sidebar.jsx (trống)
│   │   ├── MainTable/
│   │   │   └── MainTable.jsx (trống)
│   │   ├── StudentForm/
│   │   │   └── StudentForm.jsx (trống)
│   │   └── MapView/
│   │       └── MapView.jsx (trống)
│   ├── pages/
│   │   ├── LoginPage.jsx (trống)
│   │   ├── RegisterPage.jsx (trống)
│   │   └── Dashboard.jsx (trống)
│   ├── services/
│   │   ├── authService.js (trống)
│   │   ├── studentService.js (trống)
│   │   └── logService.js (trống)
│   ├── hooks/
│   │   └── useAuth.js (trống)
│   ├── context/
│   │   └── AuthContext.jsx (trống)
│   ├── App.jsx (sẵn có)
│   ├── index.js (sẵn có)
│   └── index.css (sẵn có)
├── package.json
├── package-lock.json
└── .gitignore

```

## 🎯 Bước 4: Chạy Development Server

```bash
cd c:\Users\PC\Desktop\src\student-management
npm start
```

Ứng dụng sẽ mở tại: `http://localhost:3000`

## 🔧 Bước 5: Firebase Setup

### 5.1 Tạo Firebase Project

1. Truy cập [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Nhập tên project: `student-management`
4. Skip Google Analytics (tuỳ chọn)
5. Create project

### 5.2 Enable Firebase Services

#### 5.2.1 Authentication
- Vào **Authentication** → **Sign-in method**
- Enable: **Email/Password**

#### 5.2.2 Firestore Database
- Vào **Firestore Database**
- Click "Create database"
- Chọn **Start in test mode** (cho development)
- Chọn region gần bạn

### 🖼️ Storage - Image Upload

### Cách Lưu Ảnh: Base64 Encoding (Firestore)

Vì không có Firebase Storage, ảnh sẽ được lưu dưới dạng **Base64** trực tiếp vào Firestore:

**Ưu điểm:**
- ✅ Không cần setup Storage
- ✅ Đơn giản, không cần API thêm
- ✅ Ảnh lưu cùng document

**Nhược điểm:**
- ⚠️ Firestore có limit size (1MB per document)
- ⚠️ Không tối ưu cho ảnh lớn

### ⚡ Alternative: Cloudinary (Free Tier)

Nếu ảnh quá to, có thể dùng **Cloudinary**:
1. Đăng ký free: [cloudinary.com](https://cloudinary.com)
2. Cài: `npm install cloudinary react-native-cloudinary`
3. Config API key vào `.env.local`
4. Upload lên Cloudinary, lưu URL vào Firestore

### 📋 Hiện Tại: Base64 Encoding

Hệ thống hiện tại sẽ:
1. Người dùng upload ảnh
2. Convert ảnh → Base64 string
3. Lưu Base64 vào Firestore (field `imageData`)
4. Display trực tiếp từ Base64

Không cần setup Storage trong Firebase!

### 5.3 Lấy Firebase Config

1. Vào **Project Settings** (⚙️ ở trên cùng bên trái)
2. Click tab **Your apps**
3. Tạo app (hoặc dùng web app nếu đã có)
4. Copy toàn bộ config object

### 5.4 Setup .env.local

1. Copy file `.env.local.example` thành `.env.local`:
```bash
copy .env.local.example .env.local
```

2. Mở `.env.local` và paste config từ Firebase:
```
REACT_APP_FIREBASE_API_KEY=AIzaSy...
REACT_APP_FIREBASE_AUTH_DOMAIN=student-management...firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=student-management-abc123
REACT_APP_FIREBASE_STORAGE_BUCKET=student-management-abc123.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=123456789
REACT_APP_FIREBASE_APP_ID=1:123456789:web:abc123def456
```

3. **QUAN TRỌNG:** Restart dev server sau khi thêm `.env.local`

### 5.5 Tạo Firestore Collections (Optional - sẽ được tạo tự động khi thêm dữ liệu)

Firestore collections cần có:
- `students` - Lưu dữ liệu học sinh
- `users` - Lưu dữ liệu người dùng  
- `logs` - Ghi log hoạt động

### 5.6 Firebase Security Rules (Development)

**Firestore Rules** - để cho phép read/write trong mode development:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

**Note:** Storage rules không cần vì ảnh lưu trực tiếp trong Firestore dưới dạng Base64.

---

## 🗺️ Bước 6: Maps Setup - Leaflet + OpenStreetMap (Miễn phí!)

Ứng dụng sử dụng **Leaflet** + **OpenStreetMap** - hoàn toàn miễn phí, không cần API key, không cần credit card! 🎉

### 6.1 Packages đã cài đặt
```bash
npm install leaflet react-leaflet
```

### 6.2 Tính năng Maps
- ✅ Hiển thị bản đồ thế giới từ OpenStreetMap (miễn phí)
- ✅ Zoom, pan, fullscreen support
- ✅ Markers tùy chỉnh với SVG icons
- ✅ Popups hiển thị thông tin học sinh
- ✅ Không cần authentication hay API key

### 6.3 Dữ liệu Bản Đồ
- **Nguồn:** [OpenStreetMap](https://www.openstreetmap.org/) (Community-driven)
- **Tile Server:** openstreetmap.org
- **License:** ODbL (Open Database License) - sử dụng miễn phí

### 6.4 So sánh với Google Maps
| Tính năng | Leaflet + OSM | Google Maps |
|----------|--------|-------|
| Cost | Miễn phí | Cần API Key + Credit Card |
| Setup | Không cần API key | Phức tạp, cần Google Cloud |
| License | Open source | Proprietary |
| Feature | Đủ cho tracking | Tính năng nhiều hơn |
| Dung lượng | Nhẹ hơn | Nặng hơn |

---

## 📍 Bước 7: Geolocation Setup

### 7.1 Browser Permission

Khi chạy ứng dụng, trình duyệt sẽ yêu cầu **cho phép truy cập vị trí**.

**Để cấp phép:**
- Chrome/Firefox: 
  - Click biểu tượng khóa 🔒 / thông tin 🛈
  - Chọn **Manage permissions** → **Allow Location**
  
- Test trên điểm: [http://localhost:3000](http://localhost:3000)

### 7.2 Cách Hoạt Động

**Thêm học sinh:**
1. Khi thêm học sinh, click **📍 Lấy Vị Trí Hiện Tại**
2. Browser sẽ yêu cầu permission
3. Vị trí được lưu vào Firestore field `location`

**Xem trên bản đồ:**
1. Tab **Xem Bản Đồ**
2. Hiển thị:
   - 🔵 Vị trí thiết bị hiện tại
   - 🟢 Học sinh đã đến (có GPS)
   - 🔴 Học sinh chưa đến (có GPS)

### 7.3 Real-time Location (GPS từ điện thoại)

Sau này khi sử dụng GPS thật từ điện thoại:
1. Cập nhật vị trí trong StudentForm
2. Firestore sẽ lưu tọa độ mới
3. Map tự động update real-time

---

## 📝 Bước 8: NPM Commands

```bash
# Start dev server (tại cổng 3000)
npm start

# Build cho production
npm run build

# Run tests
npm test

# Eject config (KHÔNG KHUYẾN NGHỊ - không thể undo)
npm run eject
```

## 🎯 Bước 9: Chạy Ứng Dụng

1. **Copy .env.local.example thành .env.local:**
```bash
cd c:\Users\PC\Desktop\src\student-management
copy .env.local.example .env.local
```

2. **Paste Firebase config vào `.env.local`:**
```env
REACT_APP_FIREBASE_API_KEY=...
REACT_APP_FIREBASE_AUTH_DOMAIN=...
REACT_APP_FIREBASE_PROJECT_ID=...
REACT_APP_FIREBASE_STORAGE_BUCKET=...
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=...
REACT_APP_FIREBASE_APP_ID=...
```

3. **Start dev server:**
```bash
npm start
```

4. **Truy cập:** `http://localhost:3000`

5. **Cấu hình Browser Permission:**
   - Khi popup hiện, click **Allow** để cấp phép Geolocation
   - Map sẽ tự động load không cần API key

## 📚 Bước 10: Packages Đã Cài

Ứng dụng đã cài các package chính:
```bash
# Firebase + Auth + Firestore
npm install firebase react-router-dom

# UI Components
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material

# Maps (Leaflet - miễn phí)
npm install leaflet react-leaflet

# HTTP Client
npm install axios
```
npm install @mui/icons-material
```

### Form validation nâng cao:
```bash
npm install react-hook-form
```

## 🎨 Bước 11: UI & Styling Improvements

File `src/App.css` đã được **cải thiện hoàn toàn** với:
- ✅ **Material Design** - Modern, clean UI
- ✅ **Color Palette**: 
  - Primary: #0052CC (Xanh dương)
  - Success: #10B981 (Xanh lá - Đã đến)
  - Danger: #EF4444 (Đỏ - Chưa đến)
- ✅ **Smooth Animations**: Slide, shake, hover effects
- ✅ **Responsive Design**: Mobile-tablet-desktop
- ✅ **Gradients & Shadows**: Modern depth effect

### Tùy chỉnh Styling:
1. Thay đổi CSS variables trong `:root`
2. Chỉnh font, padding, border-radius
3. Thêm theme sáng/tối (optional)

## 🗺️ Bước 12: Leaflet Map Features

### Tính Năng Bản Đồ (OpenStreetMap):
- 📍 **Current Location Marker**: Vị trí thiết bị hiện tại (🔵 xanh dương)
- 🟢 **Present Students**: Học sinh đã đến (xanh lá)
- 🔴 **Absent Students**: Học sinh chưa đến (đỏ)
- 💬 **Popups**: Click marker để xem chi tiết học sinh
- 🎯 **Zoom & Pan**: Phóng to/thu nhỏ bản đồ tự do
- 🌍 **OpenStreetMap Tiles**: Dữ liệu bản đồ từ cộng đồng (miễn phí)

### Dữ Liệu Hiển Thị Trên Popup:
```
Tên học sinh
Lớp
Trạng thái (Đã đến / Chưa đến)
Tọa độ GPS (latitude, longitude)
```

### Statistics Cards:
- ✅ Đã đến (có GPS) - số học sinh
- ❌ Chưa đến (có GPS) - số học sinh
- 📍 Có GPS - tổng số

## 📁 Bước 13: Cấu Trúc File (Updated)

### Service Layer (Firebase Integration)
- `src/services/authService.js` - Quản lý đăng nhập/đăng ký
- `src/services/studentService.js` - CRUD học sinh + location
- `src/services/logService.js` - Ghi log hoạt động
- `src/services/geolocationService.js` - **NEW** Lấy vị trí device

### Context & Hooks
- `src/context/AuthContext.jsx` - Quản lý state authentication
- `src/hooks/useAuth.js` - Custom hook để dùng auth context

### Pages
- `src/pages/LoginPage.jsx` - Trang đăng nhập
- `src/pages/RegisterPage.jsx` - Trang đăng ký
- `src/pages/Dashboard.jsx` - Trang chính

### Components
- `src/components/Sidebar/Sidebar.jsx` - Sidebar navigation
- `src/components/MainTable/MainTable.jsx` - Bảng danh sách học sinh
- `src/components/StudentForm/StudentForm.jsx` - Form thêm + GPS
- `src/components/MapView/MapView.jsx` - **UPDATED** Google Map realtime

## 🔐 Bước 14: Security Best Practices

⚠️ **Trước khi deploy lên production:**

1. **Cập nhật Firestore Security Rules:**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /students/{document=**} {
      allow read, write: if request.auth != null;
    }
    match /users/{document=**} {
      allow read, write: if request.auth.uid == resource.id;
    }
    match /logs/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

2. **Restrict Google Maps API Key** (Bước 6.5)
3. **Tắt Firestore Test Mode**
4. **Setup SSL/HTTPS**

## 🚀 Bước 15: Deploy (Optional)

### Deploy lên Firebase Hosting:
```bash
# Cài Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Build production
npm run build

# Deploy
firebase deploy
```

### Deploy lên Vercel:
```bash
npm install -g vercel
vercel
```

### Deploy lên Netlify:
1. Kết nối GitHub repo
2. Build command: `npm run build`
3. Publish directory: `build`

## 📞 Troubleshooting

### 1. Bản đồ Leaflet không hiển thị
- ✅ Kiểm tra `src/App.js` import MapView component
- ✅ Kiểm tra network không bị block OpenStreetMap tiles
- ✅ Mở browser DevTools → Console xem lỗi gì
- ✅ Leaflet CSS đã được import? (`import 'leaflet/dist/leaflet.css'`)

### 2. Geolocation không hoạt động
- ✅ Cấp phép **Allow** khi browser yêu cầu
- ✅ Chỉ hoạt động trên `localhost` hoặc **HTTPS**
- ✅ Kiểm tra GPS/Location đã bật trên device
- ✅ Browser phải hỗ trợ Geolocation API (Chrome, Firefox, Safari)

### 3. Port 3000 đã được sử dụng
```bash
PORT=3001 npm start
```

### 4. Module not found errors
```bash
# Xóa node_modules và cài lại
rm -r node_modules package-lock.json
npm install
```

### 5. .env không nhận giá trị
- ✅ Restart dev server
- ✅ Biến phải bắt đầu với `REACT_APP_`
- ✅ Không có space xung quanh `=`

### 6. Firebase Authentication không hoạt động
- Kiểm tra `.env.local` có đúng không
- Kiểm tra Email/Password đã enable trong Firebase
- Check Firestore Security Rules

### 7. Markers không hiển thị trên bản đồ
- Kiểm tra học sinh có location data chưa
- Location phải có format: `{ lat: number, lng: number, accuracy: number, timestamp: date }`
- Xem browser console có error không

## 📖 Tài Liệu Tham Khảo

- [React Documentation](https://react.dev)
- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Guide](https://firebase.google.com/docs/firestore)
- [React Router](https://reactrouter.com/)

## ✨ Tiếp Theo

1. ✅ Setup Firebase config
2. ✅ Chạy `npm start`
3. ✅ Đăng ký và test toàn bộ chức năng
4. ✅ Tùy chỉnh styling theo ý thích
5. ✅ Thêm chức năng mở rộng (Map, ML, etc.)

---

**Good luck! 🎉**
