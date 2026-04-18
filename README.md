# 📚 Student Management Web Application

Ứng dụng web quản lý học sinh được xây dựng bằng **React** + **Firebase**.

## 🎯 Tính Năng

- ✅ **Đăng nhập / Đăng ký** - Authentication với Firebase
- ✅ **Quản lý danh sách học sinh** - CRUD operations
- ✅ **Check trạng thái đến trường** - Toggle attendance status
- ✅ **Upload hình ảnh** - Lưu vào Firebase Storage
- ✅ **Thống kê & Bản đồ** - Xem tổng quan
- ✅ **Ghi log hoạt động** - Track user actions
- ✅ **Responsive Design** - Mobile-friendly UI

## 🛠️ Tech Stack

- **Frontend:** React 18+
- **Backend (BaaS):** Firebase
- **Database:** Firestore
- **Image Storage:** Base64 encoding (Firestore)
- **Authentication:** Firebase Auth
- **Routing:** React Router v6
- **Styling:** CSS3

## 📦 Installation

### Prerequisites
- Node.js 14+
- npm hoặc yarn
- Firebase account

### Setup

1. **Clone repository:**
```bash
git clone <repo-url>
cd student-management
```

2. **Cài dependencies:**
```bash
npm install
```

3. **Setup Firebase config:**
```bash
# Copy template
copy .env.local.example .env.local

# Paste Firebase config từ Firebase Console
# Xem chi tiết tại SETUP.md
```

4. **Chạy dev server:**
```bash
npm start
```

5. **Mở browser:**
```
http://localhost:3000
```

## 📂 Project Structure

```
src/
├── components/          # Reusable components
│   ├── Sidebar/        # Navigation sidebar
│   ├── MainTable/      # Students table
│   ├── StudentForm/    # Add student form
│   └── MapView/        # Statistics & map
├── pages/              # Page components
│   ├── LoginPage/
│   ├── RegisterPage/
│   └── Dashboard/
├── services/           # Firebase operations
│   ├── authService.js
│   ├── studentService.js
│   └── logService.js
├── hooks/              # Custom hooks
│   └── useAuth.js
├── context/            # React context
│   └── AuthContext.jsx
├── firebase.js         # Firebase config
├── App.js              # Main app with routing
└── App.css             # Global styles
```

## 🚀 Available Scripts

```bash
# Start development server
npm start

# Build for production
npm run build

# Run tests
npm test

# Eject configuration (⚠️ cannot undo)
npm run eject
```

## 🔐 Firebase Setup

Xem [SETUP.md](./SETUP.md) để hướng dẫn chi tiết.

### Quick Setup:
1. Tạo Firebase project
2. Enable Auth & Firestore (NOT Storage - ảnh lưu dạng Base64)
3. Copy config vào `.env.local`
4. Restart dev server

### 📸 Image Storage
- Ảnh được lưu dưới dạng **Base64** trong Firestore
- Không cần Firebase Storage
- Alternative: Cloudinary (nếu ảnh quá to)

## 📊 Database Schema

### Collection: `students`
```javascript
{
  name: string,
  class: string,
  imageData: string,      // Base64 encoded image
  status: boolean,        // true = present, false = absent
  createdAt: timestamp
}
```

### Collection: `users`
```javascript
{
  email: string,
  role: string,
  createdAt: timestamp
}
```

### Collection: `logs`
```javascript
{
  userId: string,
  action: string,
  timestamp: timestamp
}
```

## 🎨 Styling & Theme

- **Primary Color:** #0052CC (Blue)
- **Secondary Colors:** #1E3A8A (Dark Blue)
- **Status Colors:** 
  - Present: #28a745 (Green)
  - Absent: #dc3545 (Red)

Toàn bộ styles được định nghĩa trong `src/App.css`.

## 📱 Responsive Design

- ✅ Desktop (1024px+)
- ✅ Tablet (768px - 1023px)
- ✅ Mobile (< 768px)

## 🔒 Security Features

- ✅ Email/Password authentication
- ✅ Protected routes
- ✅ Firestore security rules
- ✅ Storage access control
- ✅ User-specific data

## 🐛 Troubleshooting

Xem [SETUP.md](./SETUP.md) phần "Troubleshooting".

## 🚀 Deployment

### Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
npm run build
firebase deploy
```

### Vercel
```bash
npm install -g vercel
vercel
```

### Netlify
1. Connect GitHub
2. Build: `npm run build`
3. Publish: `build`

## 📚 Additional Features

Có thể thêm:
- 🔍 Search & Filter
- 📊 Advanced Statistics
- 📧 Email Notifications
- 🗺️ Google Maps Integration
- 👥 Role-based Access
- 🎓 Grade Management

## 💬 Support

- Gặp lỗi? Xem [SETUP.md](./SETUP.md)
- Có câu hỏi? Tạo issue

## 📄 License

MIT License

---

**Happy coding! 🎉**
