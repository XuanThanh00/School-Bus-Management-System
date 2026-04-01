# ══════════════════════════════════════════════════════════
# attendance/config.py
# Toàn bộ hằng số cấu hình — chỉnh ở đây, không cần đụng code
# ══════════════════════════════════════════════════════════

# Đường dẫn
STUDENTS_DIR    = "students"
STUDENT_IMG_DIR = "student_img"
ATTENDANCE_FILE = "attendance.txt"      # file điểm danh (thay CSV)
DB_FILE         = "student_embeddings.npz"
UID_FILE        = "registered_uids.txt" # format: FullName,Class,UID

# Ngưỡng nhận diện khuôn mặt
THRESHOLD_HIGH  = 0.4
THRESHOLD_LOW   = 0.25
CONFIRM_FRAMES  = 2

# Xác nhận 2 yếu tố (face + RFID)
MATCH_WINDOW    = 30.0   # giây — face và RFID phải khớp trong khoảng này

# Camera
CAMERA_WIDTH    = 640
CAMERA_HEIGHT   = 480

# Model / inference
ONNX_NUM_THREADS = 4
DET_SIZE         = (320, 320)
PROCESS_EVERY_N  = 6
MODEL_NAME       = "buffalo_hybrid"
