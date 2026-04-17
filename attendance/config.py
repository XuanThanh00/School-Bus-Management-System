# ══════════════════════════════════════════════════════════
# attendance/config.py
# Toàn bộ hằng số cấu hình — chỉnh ở đây, không cần đụng code
# ══════════════════════════════════════════════════════════

# ── Đường dẫn ──────────────────────────────────────────────
STUDENTS_DIR    = "students"
STUDENT_IMG_DIR = "student_img"
ATTENDANCE_FILE = "attendance.txt"
DB_FILE         = "student_embeddings.npz"
UID_FILE        = "registered_uids.txt"
DB_SQLITE       = "bus_system.db"

# ── Nhận diện khuôn mặt ────────────────────────────────────
THRESHOLD_HIGH  = 0.4
THRESHOLD_LOW   = 0.25
CONFIRM_FRAMES  = 2
THRESHOLD       = (THRESHOLD_LOW + THRESHOLD_HIGH) / 2   # 0.325

# ── 2-factor (face + RFID) ─────────────────────────────────
MATCH_WINDOW    = 30.0

# ── Master Key ─────────────────────────────────────────────
MASTER_KEY_UID      = "0353E326"
MASTER_KEY_TIMEOUT  = 30

# ── Camera ─────────────────────────────────────────────────
CAMERA_WIDTH    = 640
CAMERA_HEIGHT   = 480
PROCESS_EVERY_N = 6

# ── Model / inference ──────────────────────────────────────
ONNX_NUM_THREADS = 4
DET_SIZE         = (320, 320)
MODEL_NAME       = "buffalo_hybrid"

# ── Vision: YuNet detector ─────────────────────────────────
YUNET_PATH   = "face_detection_yunet_2023mar.onnx"
YUNET_URL    = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
                "face_detection_yunet/face_detection_yunet_2023mar.onnx")
SCORE_THRESH = 0.7
NMS_THRESH   = 0.3

# ── Vision: face crop ──────────────────────────────────────
FACE_MARGIN  = 0.2

# ══════════════════════════════════════════════════════════
# UART STM32  (kiến trúc 2 tầng — MỚI)
# ══════════════════════════════════════════════════════════
UART_STM32_PORT  = "/dev/ttyAMA2"
UART_STM32_BAUD  = 115200

# GPIO Pi → NRST STM32 để hard reset (None = chưa nối, bỏ qua)
STM32_RESET_PIN  = None   # đặt thành 17 khi đã nối dây

# ── Audio tracks (phát qua STM32 → MP3-TF-16P) ────────────
TRACK_INVITE_SCAN   = 1   # "Mời quét thẻ"
TRACK_SCAN_OK       = 2   # "Quét thẻ thành công, mời xác thực mặt"
TRACK_SCAN_INVALID  = 3   # "Thẻ không hợp lệ, báo tài xế"
TRACK_FACE_START    = 4   # "Vui lòng đứng thẳng nhìn vào màn hình"
TRACK_AUTH_OK       = 5   # "Nhận diện thành công, điểm danh đã ghi nhận"
TRACK_FACE_MISMATCH = 6   # "Không nhận diện được, vui lòng thử lại"

# ── Timing ─────────────────────────────────────────────────
HB_PI_INTERVAL       = 5.0    # giây giữa 2 lần gửi HB_PI lên STM32
STM32_HB_TIMEOUT     = 30.0   # giây im lặng → cảnh báo + reset STM32
FACE_PROMPT_COOLDOWN = 30.0  # giây giữa 2 lần phát "mời quét thẻ"
RFID_WAIT_TIMEOUT    = 30.0   # giây chờ RFID sau khi face confirmed