# ══════════════════════════════════════════════════════════
# attendance/core.py
# Face detection : YuNet (face_detection_yunet_2023mar.onnx)
# Face recognition: InsightFace buffalo_l W600K (512-d embedding)
# ══════════════════════════════════════════════════════════

import numpy as np
import cv2
import os
import time
import threading
import urllib.request
from collections import deque
from PIL import Image
from picamera2 import Picamera2
import onnxruntime as ort
from insightface.app import FaceAnalysis

from .config import (
    STUDENTS_DIR, DB_FILE,
    THRESHOLD_HIGH, THRESHOLD_LOW, CONFIRM_FRAMES, MATCH_WINDOW,
    CAMERA_WIDTH, CAMERA_HEIGHT,
    ONNX_NUM_THREADS, DET_SIZE, PROCESS_EVERY_N, MODEL_NAME,
)

# Master Key UID — đổi thành UID thẻ tài xế, để chuỗi rỗng để disable
MASTER_KEY_UID = "0353E326"   # vd: "0353E326"
from .logger import AttendanceLogger
from .rfid   import RFIDReader, load_uid_records, build_uid_map
from .display import BusDisplay
from .audio  import (MP3Player, TRACK_INVITE_SCAN, TRACK_SCAN_OK,
                     TRACK_SCAN_INVALID, TRACK_FACE_START,
                     TRACK_AUTH_OK, TRACK_FACE_MISMATCH)


# ── Model paths ────────────────────────────────────────────
YUNET_PATH   = "face_detection_yunet_2023mar.onnx"
YUNET_URL    = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
                "face_detection_yunet/face_detection_yunet_2023mar.onnx")
# Recognition: buffalo_l W600K — tự download qua InsightFace

# ── Inference config ───────────────────────────────────────
SCORE_THRESH  = 0.7    # YuNet detection confidence
NMS_THRESH    = 0.3
FACE_MARGIN   = 0.2    # crop margin around detected face
INPUT_SIZE    = (112, 112)


# ──────────────────────────────────────────────────────────
# HELPER
# ──────────────────────────────────────────────────────────

def parse_student_filename(filename: str) -> dict:
    """
    Nguyen_Van_Xuan_Thanh_1A2.jpg →
      full_key   = "Nguyen_Van_Xuan_Thanh_1A2"
      full_name  = "Nguyen Van Xuan Thanh"
      class_name = "1A2"
      display    = "Thanh"
    """
    stem  = os.path.splitext(filename)[0]
    parts = stem.split("_")
    if len(parts) < 2:
        return {"full_key": stem, "full_name": stem, "class_name": "", "display": stem}
    return {
        "full_key":   stem,
        "full_name":  " ".join(parts[:-1]),
        "class_name": parts[-1],
        "display":    parts[-2],
    }


def load_key_info() -> dict:
    """Đọc ảnh trong STUDENTS_DIR → dict[full_key → info]."""
    key_info = {}
    if not os.path.isdir(STUDENTS_DIR):
        return key_info
    for fname in os.listdir(STUDENTS_DIR):
        if fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            info = parse_student_filename(fname)
            key_info[info["full_key"]] = info
    return key_info




# ──────────────────────────────────────────────────────────
# CLASS: ImagePreprocessor
# ──────────────────────────────────────────────────────────

class ImagePreprocessor:
    """
    Tiền xử lý ảnh để thu hẹp khoảng cách chất lượng giữa
    ảnh thẻ (sắc nét, sáng) và ảnh live camera Pi (kém hơn).

    - process_id_photo : ảnh thẻ → làm mờ nhẹ + normalize brightness
                         (giả lập chất lượng camera để embedding gần hơn)
    - process_live_frame: ảnh camera → CLAHE + bilateral + normalize
                         (enhance lên để gần với ảnh thẻ hơn)
    """

    def __init__(self,
                 clip_limit:         float = 3.0,
                 tile_size:          tuple = (8, 8),
                 target_brightness:  float = 130.0):
        self._clahe              = cv2.createCLAHE(
            clipLimit=clip_limit, tileGridSize=tile_size)
        self._target_brightness  = target_brightness

    def _normalize_brightness(self, l_channel: np.ndarray) -> np.ndarray:
        mean = np.mean(l_channel)
        if mean > 0:
            l_channel = np.clip(
                l_channel * (self._target_brightness / mean), 0, 255
            ).astype(np.uint8)
        return l_channel

    def process_id_photo(self, img_bgr: np.ndarray) -> np.ndarray:
        """
        Ảnh thẻ BGR → normalize brightness + blur nhẹ.
        Mục đích: kéo embedding ảnh thẻ gần với embedding ảnh camera.
        """
        lab        = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
        l, a, b    = cv2.split(lab)
        l          = self._normalize_brightness(l)
        result_lab = cv2.merge([l, a, b])
        result_bgr = cv2.cvtColor(result_lab, cv2.COLOR_LAB2BGR)
        # Blur nhẹ để giảm sharpness gap với camera Pi
        return cv2.GaussianBlur(result_bgr, (3, 3), 0.5)

    def process_live_frame(self, frame_bgr: np.ndarray) -> np.ndarray:
        """
        Frame live BGR → bilateral filter + CLAHE + normalize brightness.
        Mục đích: enhance ảnh camera lên gần với chất lượng ảnh thẻ.
        """
        # Bilateral filter: giảm noise nhưng giữ cạnh
        filtered    = cv2.bilateralFilter(frame_bgr, d=5,
                                          sigmaColor=50, sigmaSpace=50)
        lab         = cv2.cvtColor(filtered, cv2.COLOR_BGR2LAB)
        l, a, b     = cv2.split(lab)
        l           = self._clahe.apply(l)
        l           = self._normalize_brightness(l)
        result_lab  = cv2.merge([l, a, b])
        return cv2.cvtColor(result_lab, cv2.COLOR_LAB2BGR)

# ──────────────────────────────────────────────────────────
# CLASS: YuNetDetector
# ──────────────────────────────────────────────────────────

class YuNetDetector:
    """
    Wrapper cho YuNet qua cv2.FaceDetectorYN.
    detect() trả về list of (x, y, w, h, confidence).
    """

    def __init__(self, model_path: str = YUNET_PATH,
                 input_size: tuple = (CAMERA_WIDTH, CAMERA_HEIGHT)):
        if not os.path.exists(model_path):
            print(f"  Downloading YuNet detector...")
            urllib.request.urlretrieve(YUNET_URL, model_path)
            print(f"  ✓ Saved {model_path} ({os.path.getsize(model_path)/1e3:.0f} KB)")

        self._detector = cv2.FaceDetectorYN.create(
            model_path, "", input_size,
            score_threshold=SCORE_THRESH,
            nms_threshold=NMS_THRESH,
            top_k=10,
        )
        print(f"  ✓ YuNet detector ready ({os.path.getsize(model_path)/1e3:.0f} KB)")

    def set_input_size(self, w: int, h: int):
        self._detector.setInputSize((w, h))

    def detect(self, frame_bgr) -> list:
        """
        frame_bgr: numpy BGR frame từ camera.
        Returns: list of (x, y, w, h, confidence)
        """
        h, w = frame_bgr.shape[:2]
        self._detector.setInputSize((w, h))
        _, faces = self._detector.detect(frame_bgr)
        if faces is None:
            return []
        results = []
        for face in faces:
            x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
            results.append((x, y, fw, fh, float(face[14])))
        return results


# ──────────────────────────────────────────────────────────
# CLASS: BuffaloRecognizer
# ──────────────────────────────────────────────────────────

class BuffaloRecognizer:
    """
    Face recognition dùng W600K (buffalo_l) qua ONNX trực tiếp.
    Không dùng FaceAnalysis — load thẳng w600k_r50.onnx.
    Output: 512-d embedding, L2-normalized.
    """

    MODEL_PATH = os.path.expanduser(
        "~/.insightface/models/buffalo_l/w600k_r50.onnx")

    def __init__(self):
        # Download buffalo_l nếu chưa có
        if not os.path.exists(self.MODEL_PATH):
            print("  Downloading buffalo_l W600K...")
            # Dùng FaceAnalysis tạm để trigger download rồi thoát
            _app = FaceAnalysis(name="buffalo_l",
                                providers=["CPUExecutionProvider"])
            _app.prepare(ctx_id=0, det_size=(320, 320))
            del _app

        if not os.path.exists(self.MODEL_PATH):
            raise FileNotFoundError(
                f"Không tìm thấy {self.MODEL_PATH}")

        opts = ort.SessionOptions()
        opts.intra_op_num_threads     = ONNX_NUM_THREADS
        opts.inter_op_num_threads     = ONNX_NUM_THREADS
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.execution_mode           = ort.ExecutionMode.ORT_PARALLEL

        self._session    = ort.InferenceSession(
            self.MODEL_PATH, opts,
            providers=["CPUExecutionProvider"])
        self._input_name = self._session.get_inputs()[0].name

        sz = os.path.getsize(self.MODEL_PATH) / 1e6
        print(f"  ✓ Buffalo_l W600K ready ({sz:.0f} MB) — 512-d embedding")

    def get_embedding(self, face_bgr: np.ndarray) -> np.ndarray:
        """
        BGR crop → L2-normalized 512-d embedding.
        Preprocessing: resize 112x112, BGR→RGB, normalize [-1,1].
        """
        img  = cv2.resize(face_bgr, (112, 112))
        img  = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32)
        img  = (img - 127.5) / 127.5
        inp  = img.transpose(2, 0, 1)[np.newaxis]          # (1,3,112,112)
        emb  = self._session.run(None, {self._input_name: inp})[0][0]
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        return emb.astype(np.float32)

    def extract_face_crop(self, frame_bgr: np.ndarray,
                          bbox: tuple, margin: float = FACE_MARGIN) -> np.ndarray:
        """Crop mặt từ frame với margin, trả về BGR crop."""
        h, w = frame_bgr.shape[:2]
        x, y, fw, fh = bbox[:4]
        mx, my = int(fw * margin), int(fh * margin)
        x1 = max(0, x - mx)
        y1 = max(0, y - my)
        x2 = min(w, x + fw + mx)
        y2 = min(h, y + fh + my)
        crop = frame_bgr[y1:y2, x1:x2]
        return crop if crop.size > 0 else frame_bgr[max(0,y):y+fh, max(0,x):x+fw]


# ──────────────────────────────────────────────────────────
# CLASS: FaceDatabase
# ──────────────────────────────────────────────────────────

class FaceDatabase:
    """
    Lưu trữ và tìm kiếm embedding 512d.
    Similarity = dot product (embeddings đã L2-normalized → tương đương cosine).
    Threshold dùng THRESHOLD_LOW / THRESHOLD_HIGH từ config.
    """

    def __init__(self, database_dict: dict):
        if database_dict:
            self.keys       = list(database_dict.keys())
            self.embeddings = np.array(list(database_dict.values()), dtype=np.float32)
        else:
            self.keys       = []
            self.embeddings = np.empty((0, 512), dtype=np.float32)

    @property
    def count(self) -> int:
        return len(self.keys)

    def identify(self, emb: np.ndarray) -> tuple:
        """
        Trả về (full_key, score).
        Score = dot product với embedding gần nhất.
        """
        if not self.keys:
            return (None, 0.0)
        scores   = self.embeddings @ emb          # (N,) dot products
        best_idx = int(np.argmax(scores))
        return (self.keys[best_idx], float(scores[best_idx]))

    def identify_batch(self, embeddings_list: list) -> list:
        """Batch identify — trả về list of (full_key, score)."""
        if not self.keys or not embeddings_list:
            return [(None, 0.0)] * len(embeddings_list)
        embs     = np.array(embeddings_list, dtype=np.float32)   # (M, 512)
        scores   = embs @ self.embeddings.T                       # (M, N)
        best_idx = np.argmax(scores, axis=1)
        return [(self.keys[i], float(scores[j, i]))
                for j, i in enumerate(best_idx)]

    @staticmethod
    def load(detector: YuNetDetector,
             recognizer: "BuffaloRecognizer",
             preprocessor: "ImagePreprocessor") -> "FaceDatabase":
        key_info     = load_key_info()
        current_keys = set(key_info.keys())
        db_dict      = _load_npz()

        if db_dict and set(db_dict.keys()) != current_keys:
            print("  ⚠ Cache lỗi thời → đăng ký lại...")
            os.remove(DB_FILE)
            db_dict = None

        if db_dict:
            print(f"  ✓ Load {len(db_dict)} học sinh từ cache.")
        else:
            db_dict = _register_students(detector, recognizer, preprocessor, key_info)
            if db_dict:
                _save_npz(db_dict)

        return FaceDatabase(db_dict or {})


# ──────────────────────────────────────────────────────────
# CLASS: CameraThread
# ──────────────────────────────────────────────────────────

class CameraThread:
    """Capture frame BGR liên tục từ Picamera2 trên thread riêng."""

    def __init__(self, picam2: Picamera2):
        self.picam2  = picam2
        self.frame   = None
        self.lock    = threading.Lock()
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        while self.running:
            # Picamera2 trả về RGB888 theo config → convert sang BGR cho OpenCV
            f = self.picam2.capture_array()
            bgr = cv2.cvtColor(f, cv2.COLOR_RGB2BGR)
            with self.lock:
                self.frame = bgr

    def get_frame(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    def stop(self):
        self.running = False
        self._thread.join(timeout=2)


# ──────────────────────────────────────────────────────────
# CLASS: AttendanceSystem
# ──────────────────────────────────────────────────────────

class AttendanceSystem:
    """
    Hệ thống điểm danh 2 yếu tố: khuôn mặt + RFID.
    Face detection : YuNet
    Face recognition: buffalo_l W600K (512-d)
    Workflow:
      setup() → load model, database, RFID, camera
      run()   → vòng lặp chính, nhấn Q để thoát
    """

    def __init__(self):
        self.detector     = None   # YuNetDetector
        self.recognizer   = None   # BuffaloRecognizer
        self.face_db      = None   # FaceDatabase
        self.preprocessor = ImagePreprocessor()
        self.key_info   = {}
        self.uid_map    = {}
        self.rfid       = None
        self.mp3        = None
        self.cam_thread = None
        self._picam2    = None

        # face runtime state
        self._confirm_tracker: dict  = {}   # full_key → frame count
        self._confirmed_set:   set   = set()
        self._attendance_log:  list  = []
        self._frame_counter          = 0
        self._last_detections: list  = []   # list of (x,y,w,h,conf)
        self._last_results:    list  = []   # list of {bbox, full_key, score}
        self._fps_counter            = 0
        self._fps_timer              = time.time()
        self._current_fps            = 0.0
        self._inference_times        = deque(maxlen=30)

        # 2-factor pending buffers
        self._face_pending:   dict = {}   # (full_name, class_name) → timestamp
        self._rfid_pending:   dict = {}
        self._face_announced: set  = set()

        # RFID display
        self._rfid_display_name  = ""
        self._rfid_display_until = 0.0
        self.att_logger          = AttendanceLogger()

        # Master Key mode
        self._master_mode      = False
        self._master_until     = 0.0

        # Display
        self._display: BusDisplay = None
        self._display_status      = "WAITING"
        self._last_log: list      = []

        # RFID display riêng (cho card RFID)
        self._disp_rfid_name  = ""
        self._disp_rfid_class = ""
        self._disp_rfid_uid   = ""
        self._disp_rfid_ts    = 0.0

    # ── Setup ──────────────────────────────────────────────

    def setup(self):
        """Khởi tạo tất cả. Gọi trước run()."""
        self._load_models()
        self._load_database()
        self._load_audio()
        self._load_rfid()
        self._start_camera()
        self._init_display()

    def _init_display(self):
        self._display = BusDisplay(route="TUYEN 01", fullscreen=False)
        print("  ✓ Pygame display sẵn sàng")

    def _load_models(self):
        print("Đang load models...")
        self.detector   = YuNetDetector(YUNET_PATH)
        self.recognizer = BuffaloRecognizer()

    def _load_database(self):
        self.key_info = load_key_info()
        self.face_db  = FaceDatabase.load(self.detector, self.recognizer, self.preprocessor)
        uid_records   = load_uid_records()
        self.uid_map  = build_uid_map(uid_records)
        self.att_logger.ensure_students(uid_records)
        self._check_data_mismatch(uid_records)
        print(f"  ✓ Database: {self.face_db.count} học sinh | {len(self.uid_map)} thẻ RFID")

    def _check_data_mismatch(self, uid_records: list):
        face_map = {info["full_name"]: info["class_name"]
                    for info in self.key_info.values()}
        rfid_map = {rec["full_name"]: rec["class_name"]
                    for rec in uid_records}
        warned = False
        for name in set(face_map) & set(rfid_map):
            if face_map[name] != rfid_map[name]:
                if not warned:
                    print("\n  ⚠ CẢNH BÁO DỮ LIỆU KHÔNG KHỚP:")
                    warned = True
                print(f"    Tên  : {name}")
                print(f"    Ảnh  : lớp {face_map[name]}")
                print(f"    RFID : lớp {rfid_map[name]}")
                print(f"    → Người này sẽ KHÔNG điểm danh được!")
        if warned:
            print()

    def _load_rfid(self):
        self.rfid = RFIDReader(self.uid_map)
        print("  ✓ RFID reader đang chạy")

    def _load_audio(self):
        self.mp3 = MP3Player()
        time.sleep(1.5)
        self.mp3.play(TRACK_INVITE_SCAN)

    def _start_camera(self):
        from libcamera import controls
        print("Đang mở camera...")
        self._picam2 = Picamera2()
        self._picam2.configure(self._picam2.create_preview_configuration(
            main={"size": (CAMERA_WIDTH, CAMERA_HEIGHT), "format": "RGB888"}
        ))
        self._picam2.start()
        self._picam2.set_controls({
            "AwbEnable": True, "AwbMode": controls.AwbModeEnum.Indoor,
            "Brightness": 0.1, "Contrast": 1.1,
        })
        time.sleep(2)
        self.cam_thread = CameraThread(self._picam2)
        print(f"  ✓ Camera {CAMERA_WIDTH}×{CAMERA_HEIGHT} sẵn sàng")

    # ── Main loop ──────────────────────────────────────────

    def run(self):
        """Vòng lặp chính. Nhấn Q/ESC để thoát."""
        print("\nNhấn Q hoặc ESC để thoát.\n")
        self._display_student = {}
        self._gps_str         = "GPS: --"
        try:
            while True:
                frame = self.cam_thread.get_frame()
                if frame is None:
                    time.sleep(0.01)
                    continue

                self._frame_counter += 1
                if self._frame_counter % PROCESS_EVERY_N == 0:
                    self._run_inference(frame)

                self._check_rfid()
                self._try_master_confirm(frame)
                self._try_confirm(frame)
                self._update_display_status()
                self._update_fps()

                avg_inf    = int(np.mean(self._inference_times)*1000) if self._inference_times else 0
                master_sec = max(0, int(self._master_until - time.time())) if self._master_mode else 0

                # Vẽ bbox + score lên frame trước khi đưa vào display
                frame_overlay = self._draw_frame_overlay(frame)

                alive = self._display.update(
                    frame_bgr     = frame_overlay,
                    face_status   = self._display_status,
                    face_name     = self._display_student.get("name", ""),
                    face_class    = self._display_student.get("class", ""),
                    face_score    = self._display_student.get("score", 0.0),
                    face_ts       = self._display_student.get("ts", ""),
                    rfid_name     = self._disp_rfid_name,
                    rfid_class    = self._disp_rfid_class,
                    rfid_uid      = self._disp_rfid_uid,
                    rfid_ts       = self._disp_rfid_ts,
                    attendance    = len(self._confirmed_set),
                    total         = self.face_db.count,
                    fps           = self._current_fps,
                    inf_ms        = avg_inf,
                    gps_str       = self._gps_str,
                    master_sec    = master_sec,
                    rfid_ok       = self.rfid is not None,
                    cam_ok        = self.cam_thread is not None,
                    last_log      = self._last_log,
                )
                if not alive:
                    break

        except KeyboardInterrupt:
            print("\n⚠ Đã dừng bằng Ctrl+C")
        finally:
            self._cleanup()
            self._print_summary()

    # ── Inference ──────────────────────────────────────────

    def _run_inference(self, frame_bgr: np.ndarray):
        """
        Chạy YuNet detect + buffalo_l W600K recognize trên frame BGR.
        Preprocess frame live trước để thu hẹp gap với ảnh thẻ.
        Kết quả lưu vào self._last_results.
        """
        t = time.perf_counter()

        # Preprocess frame live: CLAHE + bilateral + normalize brightness
        frame_proc = self.preprocessor.process_live_frame(frame_bgr)

        detections = self.detector.detect(frame_proc)
        results    = []

        if detections:
            embeddings = []
            for det in detections:
                crop = self.recognizer.extract_face_crop(frame_proc, det)
                emb  = self.recognizer.get_embedding(crop)
                embeddings.append(emb)

            identities = self.face_db.identify_batch(embeddings)

            for det, (full_key, score) in zip(detections, identities):
                x, y, w, h, conf = det
                results.append({
                    'bbox':     (x, y, w, h),
                    'conf':     conf,
                    'full_key': full_key,
                    'score':    score,
                })

        self._last_results = results
        self._inference_times.append(time.perf_counter() - t)

    # ── RFID check ─────────────────────────────────────────

    def _check_rfid(self):
        result = self.rfid.get_and_clear()
        if result is None:
            return

        uid = result.get("uid", "")

        # ── Master Key ─────────────────────────────────────
        if uid == MASTER_KEY_UID.upper():
            self._master_mode              = True
            self._master_until             = time.time() + 30   # 30s master mode
            self._rfid_display_name        = "[MASTER KEY] Nhin vao camera"
            self._rfid_display_until       = time.time() + 30
            self._confirm_tracker          = {}   # reset confirm để sẵn sàng scan mới
            print(f"  [MASTER] Tai xe quet Master Key — cho hoc sinh nhin vao camera")
            if self.mp3:
                self.mp3.play(TRACK_SCAN_OK)
            return

        # ── Thẻ thường ─────────────────────────────────────
        full_name = result.get("full_name")
        if not full_name:
            self._rfid_display_name  = f"UNKNOWN UID: {uid}"
            self._rfid_display_until = time.time() + 4
            if self.mp3:
                self.mp3.play(TRACK_SCAN_INVALID)
            return
        class_name = result.get("class_name", "")
        self._rfid_pending[(full_name, class_name)] = result["timestamp"]
        self._rfid_display_name  = f"ID: {full_name}"
        self._rfid_display_until = time.time() + 5
        # Cập nhật card RFID trên display
        self._disp_rfid_name  = full_name
        self._disp_rfid_class = class_name
        self._disp_rfid_uid   = result.get("uid", "")
        self._disp_rfid_ts    = time.time()
        if self.mp3:
            self.mp3.play(TRACK_SCAN_OK)

    # ── 2-factor confirm ───────────────────────────────────

    def _try_confirm(self, frame_bgr: np.ndarray):
        now = time.time()

        rfid_expired = {k for k, v in self._rfid_pending.items()
                        if now - v > MATCH_WINDOW}
        self._face_pending = {k: v for k, v in self._face_pending.items()
                              if now - v <= MATCH_WINDOW}
        self._rfid_pending = {k: v for k, v in self._rfid_pending.items()
                              if now - v <= MATCH_WINDOW}

        for key in rfid_expired:
            if key not in self._confirmed_set and self.mp3:
                self.mp3.play(TRACK_FACE_MISMATCH)

        for key in list(self._face_pending):
            if key in self._rfid_pending and key not in self._confirmed_set:
                self._confirmed_set.add(key)
                self._face_announced.discard(key)
                del self._face_pending[key]
                del self._rfid_pending[key]

                full_name, class_name = key
                uid      = self._get_uid_by_name(full_name, class_name)
                ts       = time.strftime("%H:%M:%S")
                img_path = self.att_logger.mark_present(
                    full_name, class_name, uid, frame_bgr)
                self._attendance_log.append((full_name, ts))
                self._last_log.append((full_name, ts, False))
                print(f"  ✓ ĐIỂM DANH: {full_name} | lớp {class_name} | {ts}")
                print(f"    → {img_path}")
                if self.mp3:
                    self.mp3.play(TRACK_AUTH_OK)

    # ── Master Key confirm (face only, no RFID) ───────────

    def _try_master_confirm(self, frame_bgr: np.ndarray):
        """
        Khi master mode active: face đủ CONFIRM_FRAMES → điểm danh ngay
        mà không cần RFID. Ghi log kèm [MASTER KEY].
        """
        if not self._master_mode:
            return

        # Hết timeout → tắt master mode
        if time.time() > self._master_until:
            print("  [MASTER] Hết thời gian (30s)")
            self._master_mode        = False
            self._rfid_display_name  = ""
            return

        for result in self._last_results:
            full_key = result.get("full_key")
            score    = result.get("score", 0)
            if not full_key:
                continue

            threshold = THRESHOLD_LOW + (THRESHOLD_HIGH - THRESHOLD_LOW) * 0.5
            if score < threshold:
                continue

            info = self.key_info.get(full_key)
            if not info:
                continue

            full_name  = info["full_name"]
            class_name = info["class_name"]
            face_key   = (full_name, class_name)

            if face_key in self._confirmed_set:
                continue

            # Đếm confirm frames
            self._confirm_tracker[full_key] = self._confirm_tracker.get(full_key, 0) + 1
            if self._confirm_tracker[full_key] < CONFIRM_FRAMES:
                continue

            # Đủ confirm → điểm danh thủ công
            self._confirmed_set.add(face_key)
            self._master_mode = False   # tắt master mode sau khi điểm danh xong

            uid      = self._get_uid_by_name(full_name, class_name)
            ts       = time.strftime("%H:%M:%S")
            img_path = self.att_logger.mark_present(
                full_name, class_name, uid, frame_bgr)

            # Ghi log kèm ghi chú MASTER KEY
            self._attendance_log.append((f"{full_name} [MASTER KEY]", ts))
            self._last_log.append((full_name, ts, True))
            print(f"  ✓ ĐIỂM DANH [MASTER KEY]: {full_name} | lớp {class_name} | {ts}")
            print(f"    → {img_path}")

            self._rfid_display_name  = f"{info['display']} OK [MASTER]"
            self._rfid_display_until = time.time() + 4
            if self.mp3:
                self.mp3.play(TRACK_AUTH_OK)
            break

    # ── Process face display + pending ─────────────────────

    def _process_face(self, result: dict) -> tuple:
        """
        Xử lý 1 face result → (label, sub_label, color, bbox).
        Cập nhật _face_pending nếu đủ confirm frames.
        """
        full_key = result['full_key']
        score    = result['score']
        conf     = result['conf']
        bbox     = result['bbox']

        info = self.key_info.get(full_key)
        if info:
            display_name = info["display"]
            full_name    = info["full_name"]
            class_name   = info["class_name"]
        else:
            display_name = full_name = full_key or "?"
            class_name   = ""

        # Ngưỡng: dùng THRESHOLD_HIGH khi score > 0 (model đã L2-normalized)
        threshold = THRESHOLD_LOW + (THRESHOLD_HIGH - THRESHOLD_LOW) * 0.5

        if full_key and score >= threshold:
            self._confirm_tracker[full_key] = self._confirm_tracker.get(full_key, 0) + 1
            count    = self._confirm_tracker[full_key]
            face_key = (full_name, class_name)

            if face_key in self._confirmed_set:
                return (f"{display_name} OK",
                        f"{score:.2f} det:{conf:.0%}", (0, 160, 0), bbox)

            if count >= CONFIRM_FRAMES:
                if self._master_mode:
                    # Master mode: không cần quẹt thẻ, chờ _try_master_confirm xử lý
                    return (f"{display_name} - MASTER OK",
                            f"{score:.2f} det:{conf:.0%}", (0, 200, 100), bbox)
                if face_key not in self._face_announced:
                    self._face_announced.add(face_key)
                    if self.mp3:
                        self.mp3.play(TRACK_FACE_START)
                self._face_pending[face_key] = time.time()
                return (f"{display_name} - Cho quet the",
                        f"{score:.2f} det:{conf:.0%}", (0, 220, 255), bbox)

            return (f"{display_name} ({count}/{CONFIRM_FRAMES})",
                    f"{score:.2f} t:{threshold:.2f}", (0, 220, 255), bbox)

        label = f"? {display_name}" if full_key else "Khong xac dinh"
        return (label, f"{score:.2f} < {threshold:.2f}", (0, 60, 220), bbox)

    # ── Draw ───────────────────────────────────────────────

    def _draw(self, frame_bgr: np.ndarray) -> np.ndarray:
        bgr  = frame_bgr.copy()
        seen: set = set()

        for result in self._last_results:
            label, sub_label, color, (x, y, w, h) = self._process_face(result)
            if result['full_key']:
                seen.add(result['full_key'])
            cv2.rectangle(bgr, (x, y), (x + w, y + h), color, 2)
            cv2.putText(bgr, label,     (x, max(y - 25, 15)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
            cv2.putText(bgr, sub_label, (x, max(y - 5, 30)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.40, color, 1)

        # Reset confirm nếu mặt rời khung
        for k in list(self._confirm_tracker):
            if k not in seen:
                self._confirm_tracker[k] = 0

        # HUD
        avg_inf = np.mean(self._inference_times) * 1000 if self._inference_times else 0
        self._update_fps()
        cv2.putText(bgr, f"FPS: {self._current_fps:.1f}",
                    (CAMERA_WIDTH - 120, 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)
        cv2.putText(bgr, f"Inf: {avg_inf:.0f}ms",
                    (CAMERA_WIDTH - 140, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)
        cv2.putText(bgr, f"Diem danh: {len(self._confirmed_set)}/{self.face_db.count}",
                    (10, CAMERA_HEIGHT - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)

        # Master mode banner
        if self._master_mode:
            remaining = max(0, int(self._master_until - time.time()))
            banner    = f"[MASTER KEY] Nhin vao camera... {remaining}s"
            cv2.rectangle(bgr, (0, 0), (CAMERA_WIDTH, 36), (0, 140, 0), -1)
            cv2.putText(bgr, banner, (10, 24),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)

        # RFID display
        if time.time() < self._rfid_display_until and self._rfid_display_name:
            text  = self._rfid_display_name
            scale, thick = 0.55, 2
            (tw, th), _ = cv2.getTextSize(
                text, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
            tx = CAMERA_WIDTH - tw - 10
            ty = 80
            cv2.rectangle(bgr, (tx - 6, ty - th - 6),
                          (tx + tw + 6, ty + 6), (0, 0, 0), -1)
            cv2.putText(bgr, text, (tx, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 255, 200), thick)

        return bgr



    # ── Draw bbox + score lên camera frame ────────────────

    def _draw_frame_overlay(self, frame_bgr: np.ndarray) -> np.ndarray:
        """
        Vẽ bounding box và score lên frame BGR.
        Màu box:
          xanh lá  = đã điểm danh
          xanh dương = đang scan / chờ RFID
          đỏ       = không nhận ra
        """
        out       = frame_bgr.copy()
        threshold = THRESHOLD_LOW + (THRESHOLD_HIGH - THRESHOLD_LOW) * 0.5

        for result in self._last_results:
            x, y, w, h = result["bbox"]
            full_key   = result.get("full_key")
            score      = result.get("score", 0)
            conf       = result.get("conf", 0)

            info = self.key_info.get(full_key) if full_key else None
            name = info["display"] if info else "?"

            if info and (info["full_name"], info["class_name"]) in self._confirmed_set:
                color = (0, 220, 80)    # xanh lá — đã điểm danh
                label = f"{name} OK"
            elif score >= threshold:
                color = (55, 138, 221)  # xanh dương — nhận ra, chờ RFID
                label = f"{name} {score:.2f}"
            else:
                color = (60, 60, 200)   # đỏ/xanh tối — không nhận ra
                label = f"? {score:.2f}"

            # Vẽ box
            cv2.rectangle(out, (x, y), (x+w, y+h), color, 2)

            # Nền label
            (tw, th), _ = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(out, (x, y - th - 8), (x + tw + 6, y), color, -1)
            cv2.putText(out, label, (x+3, y-4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255), 1)

            # Score bar nhỏ dưới box
            bar_w = w
            fill  = int(bar_w * min(score, 1.0))
            cv2.rectangle(out, (x, y+h+2), (x+bar_w, y+h+6), (40,40,40), -1)
            cv2.rectangle(out, (x, y+h+2), (x+fill,  y+h+6), color, -1)

        # Master mode overlay
        if self._master_mode:
            sec = max(0, int(self._master_until - time.time()))
            cv2.rectangle(out, (0,0), (out.shape[1], 34), (0,140,60), -1)
            cv2.putText(out, f"[MASTER KEY] NHIN VAO CAMERA... {sec}s",
                        (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,255,255), 2)

        return out

    # ── Display state management ───────────────────────────

    def _update_display_status(self):
        """
        Cập nhật _display_status, _display_student và _face_pending.
        Đây là nơi duy nhất tạo face_pending — thay thế _process_face() trong _draw() cũ.
        """
        if self._master_mode:
            self._display_status = "MASTER"
            return

        threshold = THRESHOLD_LOW + (THRESHOLD_HIGH - THRESHOLD_LOW) * 0.5

        # Tìm face result tốt nhất hiện tại
        best = None
        for result in self._last_results:
            if result.get("score", 0) >= threshold:
                if best is None or result["score"] > best["score"]:
                    best = result

        # Reset confirm_tracker cho những mặt không còn trong frame
        seen = {r["full_key"] for r in self._last_results if r.get("full_key")}
        for k in list(self._confirm_tracker):
            if k not in seen:
                self._confirm_tracker[k] = 0

        if best:
            full_key   = best["full_key"]
            score      = best["score"]
            info       = self.key_info.get(full_key)
            full_name  = info["full_name"]  if info else full_key
            class_name = info["class_name"] if info else ""
            face_key   = (full_name, class_name)

            if face_key in self._confirmed_set:
                # Đã điểm danh xong
                uid = self._get_uid_by_name(full_name, class_name)
                self._display_status  = "OK"
                self._display_student = {
                    "name": full_name, "class": class_name,
                    "uid": uid, "score": score,
                    "ts": self._get_confirmed_ts(face_key),
                }
                return

            # Đếm confirm frames — KEY: đây là chỗ tạo face_pending
            self._confirm_tracker[full_key] = self._confirm_tracker.get(full_key, 0) + 1
            count = self._confirm_tracker[full_key]

            if count >= CONFIRM_FRAMES:
                # Đủ confirm → đưa vào face_pending để _try_confirm() xử lý
                self._face_pending[face_key] = time.time()

                if face_key not in self._face_announced:
                    self._face_announced.add(face_key)
                    if self.mp3:
                        self.mp3.play(TRACK_FACE_START)

                self._display_status  = "WAIT_RFID"
                self._display_student = {
                    "name": full_name, "class": class_name,
                    "score": score, "uid": "", "ts": "",
                }
            else:
                # Chưa đủ confirm frames
                self._display_status  = "SCANNING"
                self._display_student = {
                    "name": full_name, "class": class_name,
                    "score": score, "uid": "", "ts": "",
                }
        else:
            self._display_status  = "WAITING"
            self._display_student = {}

    def _get_confirmed_ts(self, face_key: tuple) -> str:
        """Lấy timestamp điểm danh từ log."""
        full_name = face_key[0]
        for name, ts in self._attendance_log:
            if name.startswith(full_name):
                return ts
        return ""

    def _update_fps(self):
        self._fps_counter += 1
        elapsed = time.time() - self._fps_timer
        if elapsed >= 1.0:
            self._current_fps = self._fps_counter / elapsed
            self._fps_counter = 0
            self._fps_timer   = time.time()

    # ── Helpers ────────────────────────────────────────────

    def _get_uid_by_name(self, full_name: str, class_name: str) -> str:
        for uid_hex, rec in self.uid_map.items():
            if rec["full_name"] == full_name and rec["class_name"] == class_name:
                return uid_hex
        return ""

    # ── Cleanup & summary ──────────────────────────────────

    def _cleanup(self):
        if self.mp3:        self.mp3.stop()
        if self.rfid:       self.rfid.stop()
        if self.cam_thread: self.cam_thread.stop()
        if self._picam2:    self._picam2.stop()
        if self._display:   self._display.quit()

    def _print_summary(self):
        print("\n" + "=" * 55)
        print("  KẾT QUẢ ĐIỂM DANH")
        print("=" * 55)
        for row in self.att_logger.get_rows():
            status = "✓ Có mặt" if row["Status"] == "1" else "✗ Vắng"
            print(f"  {status}  {row['FullName']}  (lớp {row['Class']})")
        if self._attendance_log:
            print("\nChi tiết:")
            for name, ts in self._attendance_log:
                print(f"  {ts}  {name}")
        print(f"\nTổng    : {len(self._confirmed_set)}/{self.face_db.count}")
        if self._inference_times:
            print(f"Inf avg : {np.mean(self._inference_times)*1000:.0f}ms")
        print(f"File    : {os.path.abspath(self.att_logger.txt_path)}")


# ──────────────────────────────────────────────────────────
# PRIVATE helpers (database I/O)
# ──────────────────────────────────────────────────────────

def _load_npz() -> dict | None:
    if not os.path.exists(DB_FILE):
        return None
    data = np.load(DB_FILE, allow_pickle=True)
    return {name: emb for name, emb in zip(data['names'], data['embeddings'])}


def _save_npz(database: dict):
    np.savez(DB_FILE,
             names=list(database.keys()),
             embeddings=np.array(list(database.values())))
    print(f"  ✓ Đã cache → {DB_FILE}")


def _register_students(detector: YuNetDetector,
                       recognizer: "BuffaloRecognizer",
                       preprocessor: ImagePreprocessor,
                       key_info: dict) -> dict:
    """
    Đọc ảnh trong STUDENTS_DIR, detect face bằng YuNet,
    lấy embedding bằng buffalo_l W600K, lưu vào dict.

    Hỗ trợ nhiều ảnh mỗi người — gom theo full_key chuẩn
    (Nguyen_Van_A_1A2) rồi average embedding.
    Tên file ảnh phụ: Nguyen_Van_A_1A2_2.jpg, _3.jpg, ...
    """
    if not key_info:
        print(f"  ⚠ Không có ảnh trong '{STUDENTS_DIR}/'")
        return {}

    # Gom tất cả ảnh theo full_key chuẩn
    # full_key chuẩn = phần tên không có suffix _2, _3, ...
    # key_info chứa các full_key chuẩn (từ ảnh chính)
    groups: dict = {fk: [] for fk in key_info}   # full_key → list of embeddings

    all_files = sorted(os.listdir(STUDENTS_DIR))
    for photo_file in all_files:
        if not photo_file.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue

        stem  = os.path.splitext(photo_file)[0]
        parts = stem.split("_")

        # Tìm full_key khớp — bỏ suffix số cuối nếu có (_2, _3, ...)
        matched_key = None
        if stem in groups:
            # Ảnh chính: tên khớp hoàn toàn
            matched_key = stem
        else:
            # Ảnh phụ: thử bỏ phần cuối (_2, _3, ...)
            if parts[-1].isdigit():
                candidate = "_".join(parts[:-1])
                if candidate in groups:
                    matched_key = candidate

        if matched_key is None:
            continue

        photo_path = os.path.join(STUDENTS_DIR, photo_file)
        img_bgr    = cv2.imread(photo_path)
        if img_bgr is None:
            print(f"    ✗ Không đọc được: {photo_file}")
            continue

        # Preprocess ảnh thẻ: normalize brightness + blur nhẹ
        img_proc = preprocessor.process_id_photo(img_bgr)

        faces = detector.detect(img_proc)
        if not faces:
            # Fallback: thử ảnh gốc nếu preprocess làm mất mặt
            faces = detector.detect(img_bgr)
            if not faces:
                print(f"    ✗ {photo_file} — không tìm thấy mặt, bỏ qua")
                continue
            img_proc = img_bgr

        best = max(faces, key=lambda f: f[2] * f[3])
        crop = recognizer.extract_face_crop(img_proc, best)
        emb  = recognizer.get_embedding(crop)
        groups[matched_key].append((emb, best[4], photo_file))

    # Tính average embedding cho từng người
    database = {}
    n_students = len([g for g in groups.values() if g])
    print(f"  Đăng ký {n_students} học sinh...")

    for full_key, emb_list in groups.items():
        info = key_info[full_key]
        if not emb_list:
            print(f"    ✗ {info['full_name']} — không có ảnh hợp lệ!")
            continue

        # Average tất cả embedding rồi L2-normalize lại
        embs    = np.array([e for e, _, _ in emb_list], dtype=np.float32)
        avg_emb = embs.mean(axis=0)
        norm    = np.linalg.norm(avg_emb)
        if norm > 0:
            avg_emb = avg_emb / norm

        database[full_key] = avg_emb

        files_str = ", ".join(f[2] for f in emb_list)
        avg_det   = np.mean([f[1] for f in emb_list])
        print(f"    ✓ {info['full_name']} | lớp {info['class_name']} "
              f"| {len(emb_list)} ảnh (det avg:{avg_det:.2f})")
        if len(emb_list) > 1:
            print(f"      → {files_str}")

    return database
