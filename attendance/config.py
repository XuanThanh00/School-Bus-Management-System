# ══════════════════════════════════════════════════════════
# attendance/config.py
# Toàn bộ hằng số cấu hình — chỉnh ở đây, không cần đụng code
# ══════════════════════════════════════════════════════════

# ── Đường dẫn ──────────────────────────────────────────────
STUDENTS_DIR    = "students"
STUDENT_IMG_DIR = "student_img"
ATTENDANCE_FILE = "attendance.txt"       # file điểm danh
DB_FILE         = "student_embeddings.npz"
UID_FILE        = "registered_uids.txt"  # format: FullName,Class,UID

# ── Nhận diện khuôn mặt ────────────────────────────────────
THRESHOLD_HIGH  = 0.4
THRESHOLD_LOW   = 0.25
CONFIRM_FRAMES  = 2

# Ngưỡng thực dùng = (LOW + HIGH) / 2
THRESHOLD       = (THRESHOLD_LOW + THRESHOLD_HIGH) / 2   # 0.325

# ── 2-factor (face + RFID) ─────────────────────────────────
MATCH_WINDOW    = 30.0    # giây — face và RFID phải khớp trong khoảng này

# ── Master Key ─────────────────────────────────────────────
# Đổi thành UID thẻ tài xế. Để chuỗi rỗng "" để disable hoàn toàn.
MASTER_KEY_UID      = "0353E326"
MASTER_KEY_TIMEOUT  = 30    # giây master mode còn hiệu lực sau khi quẹt thẻ

# ── Camera ─────────────────────────────────────────────────
CAMERA_WIDTH    = 640
CAMERA_HEIGHT   = 480
PROCESS_EVERY_N = 6         # chỉ inference mỗi N frame

# ── Model / inference ──────────────────────────────────────
ONNX_NUM_THREADS = 4
DET_SIZE         = (320, 320)
MODEL_NAME       = "buffalo_hybrid"

# ── Vision: YuNet detector ─────────────────────────────────
YUNET_PATH  = "face_detection_yunet_2023mar.onnx"
YUNET_URL   = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
               "face_detection_yunet/face_detection_yunet_2023mar.onnx")
SCORE_THRESH = 0.7    # YuNet detection confidence
NMS_THRESH   = 0.3

# ── Vision: face crop ──────────────────────────────────────
FACE_MARGIN = 0.2     # tỉ lệ margin xung quanh bbox khi crop mặt
