# attendance/config.py — all configuration constants

# ── Paths ──────────────────────────────────────────────────
STUDENTS_DIR    = "students"
STUDENT_IMG_DIR = "student_img"
ATTENDANCE_FILE = "attendance.txt"
DB_FILE         = "student_embeddings.npz"
UID_FILE        = "registered_uids.txt"
DB_SQLITE       = "bus_system.db"

# ── Face recognition ───────────────────────────────────────
THRESHOLD_HIGH  = 0.4
THRESHOLD_LOW   = 0.25
CONFIRM_FRAMES  = 2
THRESHOLD       = (THRESHOLD_LOW + THRESHOLD_HIGH) / 2   # 0.325

# ── 2-factor (face + RFID) ─────────────────────────────────
MATCH_WINDOW    = 30.0

# ── Master key ─────────────────────────────────────────────
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

# ── YuNet face detector ────────────────────────────────────
YUNET_PATH   = "face_detection_yunet_2023mar.onnx"
YUNET_URL    = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
                "face_detection_yunet/face_detection_yunet_2023mar.onnx")
SCORE_THRESH = 0.7
NMS_THRESH   = 0.3

# ── Face crop ──────────────────────────────────────────────
FACE_MARGIN  = 0.2

# ── STM32 UART (two-tier architecture) ─────────────────────
UART_STM32_PORT  = "/dev/ttyAMA2"
UART_STM32_BAUD  = 115200

# Set to a GPIO pin number (e.g. 17) when NRST wire is connected
STM32_RESET_PIN  = None

# ── Audio tracks played via STM32 → MP3-TF-16P ────────────
TRACK_INVITE_SCAN   = 1   # "Please scan your card"
TRACK_SCAN_OK       = 2   # "Card OK, please verify face"
TRACK_SCAN_INVALID  = 3   # "Invalid card, notify driver"
TRACK_FACE_START    = 4   # "Look straight at the camera"
TRACK_AUTH_OK       = 5   # "Recognized, attendance recorded"
TRACK_FACE_MISMATCH = 6   # "Not recognized, please try again"

# ── Timing ─────────────────────────────────────────────────
HB_PI_INTERVAL       = 5.0    # seconds between HB_PI heartbeats to STM32
STM32_HB_TIMEOUT     = 30.0   # seconds of silence before warning + STM32 reset
FACE_PROMPT_COOLDOWN = 30.0   # seconds between "invite scan" audio prompts
RFID_WAIT_TIMEOUT    = 30.0   # seconds to wait for RFID after face confirmed
MIN_BOARD_SECONDS    = 300    # min seconds between boarding and alighting (5 min)

# hour < MORNING_END_HOUR → "morning" session; >= → "afternoon"
MORNING_END_HOUR     = 12
# attendance/config.py — all configuration constants

# ── Paths ──────────────────────────────────────────────────
STUDENTS_DIR    = "students"
STUDENT_IMG_DIR = "student_img"
ATTENDANCE_FILE = "attendance.txt"
DB_FILE         = "student_embeddings.npz"
UID_FILE        = "registered_uids.txt"
DB_SQLITE       = "bus_system.db"

# ── Face recognition ───────────────────────────────────────
THRESHOLD_HIGH  = 0.4
THRESHOLD_LOW   = 0.25
CONFIRM_FRAMES  = 2
THRESHOLD       = (THRESHOLD_LOW + THRESHOLD_HIGH) / 2   # 0.325

# ── 2-factor (face + RFID) ─────────────────────────────────
MATCH_WINDOW    = 30.0

# ── Master key ─────────────────────────────────────────────
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

# ── YuNet face detector ────────────────────────────────────
YUNET_PATH   = "face_detection_yunet_2023mar.onnx"
YUNET_URL    = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
                "face_detection_yunet/face_detection_yunet_2023mar.onnx")
SCORE_THRESH = 0.7
NMS_THRESH   = 0.3

# ── Face crop ──────────────────────────────────────────────
FACE_MARGIN  = 0.2

# ── STM32 UART (two-tier architecture) ─────────────────────
UART_STM32_PORT  = "/dev/ttyAMA2"
UART_STM32_BAUD  = 115200

# Set to a GPIO pin number (e.g. 17) when NRST wire is connected
STM32_RESET_PIN  = None

# ── Audio tracks played via STM32 → MP3-TF-16P ────────────
TRACK_INVITE_SCAN   = 1   # "Please scan your card"
TRACK_SCAN_OK       = 2   # "Card OK, please verify face"
TRACK_SCAN_INVALID  = 3   # "Invalid card, notify driver"
TRACK_FACE_START    = 4   # "Look straight at the camera"
TRACK_AUTH_OK       = 5   # "Recognized, attendance recorded"
TRACK_FACE_MISMATCH = 6   # "Not recognized, please try again"

# ── Timing ─────────────────────────────────────────────────
HB_PI_INTERVAL       = 5.0    # seconds between HB_PI heartbeats to STM32
STM32_HB_TIMEOUT     = 30.0   # seconds of silence before warning + STM32 reset
FACE_PROMPT_COOLDOWN = 30.0   # seconds between "invite scan" audio prompts
RFID_WAIT_TIMEOUT    = 30.0   # seconds to wait for RFID after face confirmed
MIN_BOARD_SECONDS    = 300    # min seconds between boarding and alighting (5 min)

# hour < MORNING_END_HOUR → "morning" session; >= → "afternoon"
MORNING_END_HOUR     = 12

# ── Firebase (Admin SDK — Firestore + Realtime Database) ───
FIREBASE_URL         = "your-project-link"
SERVICE_ACCOUNT_PATH = "credentials.json"

# Interval for pushing GPS to Firebase (seconds)
GPS_PUSH_INTERVAL = 10.0

# ══════════════════════════════════════════════════════════
# FIREBASE  (Admin SDK — Firestore + Realtime Database)
# ══════════════════════════════════════════════════════════
FIREBASE_URL      = "your-project-link"

# Interval for pushing GPS to Firebase (seconds)
GPS_PUSH_INTERVAL = 10.00
