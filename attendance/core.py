# ══════════════════════════════════════════════════════════
# attendance/core.py
# Orchestrator chính — kết nối tất cả các module lại.
# Không chứa logic AI hay hardware cụ thể.
# ══════════════════════════════════════════════════════════

import os
import time
from collections import deque

import numpy as np
from picamera2 import Picamera2

from .config import (
    CAMERA_WIDTH, CAMERA_HEIGHT, PROCESS_EVERY_N,
    CONFIRM_FRAMES, MATCH_WINDOW, THRESHOLD,
    MASTER_KEY_UID, MASTER_KEY_TIMEOUT,
    YUNET_PATH,
)
from .vision     import (ImagePreprocessor, YuNetDetector,
                         BuffaloRecognizer, FaceDatabase, load_key_info)
from .camera     import CameraThread
from .overlay    import draw_frame
from .logger     import AttendanceLogger
from .rfid       import RFIDReader, load_uid_records, build_uid_map
from .display    import BusDisplay
from .audio      import (MP3Player, TRACK_INVITE_SCAN, TRACK_SCAN_OK,
                         TRACK_SCAN_INVALID, TRACK_FACE_START,
                         TRACK_AUTH_OK, TRACK_FACE_MISMATCH)


# ──────────────────────────────────────────────────────────
# CLASS: AttendanceSystem
# ──────────────────────────────────────────────────────────

class AttendanceSystem:
    """
    Hệ thống điểm danh 2 yếu tố: khuôn mặt + RFID.
      setup() → khởi tạo model, DB, camera, audio, display
      run()   → vòng lặp chính, nhấn Q/ESC để thoát
    """

    def __init__(self):
        # AI components
        self.preprocessor = ImagePreprocessor()
        self.detector:    YuNetDetector    = None
        self.recognizer:  BuffaloRecognizer = None
        self.face_db:     FaceDatabase      = None
        self.key_info:    dict              = {}

        # Hardware / IO
        self.uid_map:     dict       = {}
        self.rfid:        RFIDReader = None
        self.mp3:         MP3Player  = None
        self.cam_thread:  CameraThread = None
        self._picam2:     Picamera2   = None
        self._display:    BusDisplay  = None

        # Logger
        self.att_logger = AttendanceLogger()

        # ── Face recognition state ──────────────────────────
        self._frame_counter   = 0
        self._last_results: list = []       # list of {bbox, conf, full_key, score}
        self._inference_times = deque(maxlen=30)
        self._fps_counter     = 0
        self._fps_timer       = time.time()
        self._current_fps     = 0.0

        # ── 2-factor confirm state ──────────────────────────
        self._confirm_tracker: dict = {}    # full_key → frame count
        self._confirmed_set:   set  = set() # (full_name, class_name)
        self._attendance_log:  list = []    # [(name, ts), ...]
        self._last_log:        list = []    # [(name, ts, is_master), ...]
        self._face_pending:    dict = {}    # face_key → timestamp
        self._rfid_pending:    dict = {}    # face_key → timestamp
        self._face_announced:  set  = set()

        # ── Master key state ────────────────────────────────
        self._master_mode  = False
        self._master_until = 0.0

        # ── Display state ───────────────────────────────────
        self._display_status  = "WAITING"
        self._display_student: dict = {}
        self._gps_str         = "GPS: --"

        # RFID card display
        self._disp_rfid_name  = ""
        self._disp_rfid_class = ""
        self._disp_rfid_uid   = ""
        self._disp_rfid_ts    = 0.0
        # Overlay RFID text trên camera feed
        self._rfid_display_name  = ""
        self._rfid_display_until = 0.0

    # ══════════════════════════════════════════════════════
    # SETUP
    # ══════════════════════════════════════════════════════

    def setup(self):
        """Khởi tạo tất cả. Gọi trước run()."""
        self._load_models()
        self._load_database()
        self._load_audio()
        self._load_rfid()
        self._start_camera()
        self._init_display()

    def _load_models(self):
        print("Đang load models...")
        self.detector   = YuNetDetector(YUNET_PATH)
        self.recognizer = BuffaloRecognizer()

    def _load_database(self):
        self.key_info = load_key_info()
        self.face_db  = FaceDatabase.load(self.detector, self.recognizer,
                                           self.preprocessor)
        uid_records        = load_uid_records()
        self.uid_map       = build_uid_map(uid_records)
        self.att_logger.ensure_students(uid_records)
        self._check_data_mismatch(uid_records)
        print(f"  ✓ Database: {self.face_db.count} học sinh "
              f"| {len(self.uid_map)} thẻ RFID")

    def _check_data_mismatch(self, uid_records: list):
        """Cảnh báo nếu tên khớp nhưng lớp khác nhau giữa ảnh và RFID."""
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

    def _init_display(self):
        self._display = BusDisplay(route="TUYEN 01", fullscreen=False)
        print("  ✓ Pygame display sẵn sàng")

    # ══════════════════════════════════════════════════════
    # MAIN LOOP
    # ══════════════════════════════════════════════════════

    def run(self):
        """Vòng lặp chính. Nhấn Q/ESC để thoát."""
        print("\nNhấn Q hoặc ESC để thoát.\n")
        self._display_student = {}
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

                avg_inf    = (int(np.mean(self._inference_times) * 1000)
                              if self._inference_times else 0)
                master_sec = (max(0, int(self._master_until - time.time()))
                              if self._master_mode else 0)
                frame_out  = draw_frame(
                    frame,
                    last_results       = self._last_results,
                    key_info           = self.key_info,
                    confirmed_set      = self._confirmed_set,
                    master_mode        = self._master_mode,
                    master_until       = self._master_until,
                    rfid_display_name  = self._rfid_display_name,
                    rfid_display_until = self._rfid_display_until,
                )

                alive = self._display.update(
                    frame_bgr   = frame_out,
                    face_status = self._display_status,
                    face_name   = self._display_student.get("name", ""),
                    face_class  = self._display_student.get("class", ""),
                    face_score  = self._display_student.get("score", 0.0),
                    face_ts     = self._display_student.get("ts", ""),
                    rfid_name   = self._disp_rfid_name,
                    rfid_class  = self._disp_rfid_class,
                    rfid_uid    = self._disp_rfid_uid,
                    rfid_ts     = self._disp_rfid_ts,
                    attendance  = len(self._confirmed_set),
                    total       = self.face_db.count,
                    fps         = self._current_fps,
                    inf_ms      = avg_inf,
                    gps_str     = self._gps_str,
                    master_sec  = master_sec,
                    rfid_ok     = self.rfid is not None,
                    cam_ok      = self.cam_thread is not None,
                    last_log    = self._last_log,
                )
                if not alive:
                    break

        except KeyboardInterrupt:
            print("\n⚠ Đã dừng bằng Ctrl+C")
        finally:
            self._cleanup()
            self._print_summary()

    # ══════════════════════════════════════════════════════
    # INFERENCE
    # ══════════════════════════════════════════════════════

    def _run_inference(self, frame_bgr: np.ndarray):
        """YuNet detect + W600K recognize. Kết quả → self._last_results."""
        t          = time.perf_counter()
        frame_proc = self.preprocessor.process_live_frame(frame_bgr)
        detections = self.detector.detect(frame_proc)
        results    = []

        if detections:
            embeddings = [
                self.recognizer.get_embedding(
                    self.recognizer.extract_face_crop(frame_proc, det))
                for det in detections
            ]
            identities = self.face_db.identify_batch(embeddings)
            for det, (full_key, score) in zip(detections, identities):
                x, y, w, h, conf = det
                results.append({
                    "bbox":     (x, y, w, h),
                    "conf":     conf,
                    "full_key": full_key,
                    "score":    score,
                })

        self._last_results = results
        self._inference_times.append(time.perf_counter() - t)

    # ══════════════════════════════════════════════════════
    # RFID
    # ══════════════════════════════════════════════════════

    def _check_rfid(self):
        result = self.rfid.get_and_clear()
        if result is None:
            return

        uid = result.get("uid", "")

        # Master Key
        if MASTER_KEY_UID and uid == MASTER_KEY_UID.upper():
            self._master_mode        = True
            self._master_until       = time.time() + MASTER_KEY_TIMEOUT
            self._rfid_display_name  = "[MASTER KEY] Nhin vao camera"
            self._rfid_display_until = self._master_until
            self._confirm_tracker    = {}
            print("  [MASTER] Tai xe quet Master Key")
            if self.mp3:
                self.mp3.play(TRACK_SCAN_OK)
            return

        # Thẻ thường
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
        self._disp_rfid_name     = full_name
        self._disp_rfid_class    = class_name
        self._disp_rfid_uid      = uid
        self._disp_rfid_ts       = time.time()
        if self.mp3:
            self.mp3.play(TRACK_SCAN_OK)

    # ══════════════════════════════════════════════════════
    # 2-FACTOR CONFIRM
    # ══════════════════════════════════════════════════════

    def _try_confirm(self, frame_bgr: np.ndarray):
        """Ghép face_pending ∩ rfid_pending → điểm danh."""
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
                self._record_attendance(key, frame_bgr, is_master=False)

    def _try_master_confirm(self, frame_bgr: np.ndarray):
        """Master mode: face đủ confirm → điểm danh ngay, không cần RFID."""
        if not self._master_mode:
            return
        if time.time() > self._master_until:
            print("  [MASTER] Hết thời gian")
            self._master_mode       = False
            self._rfid_display_name = ""
            return

        for result in self._last_results:
            full_key = result.get("full_key")
            score    = result.get("score", 0)
            if not full_key or score < THRESHOLD:
                continue
            info = self.key_info.get(full_key)
            if not info:
                continue

            face_key = (info["full_name"], info["class_name"])
            if face_key in self._confirmed_set:
                continue

            self._confirm_tracker[full_key] = (
                self._confirm_tracker.get(full_key, 0) + 1)
            if self._confirm_tracker[full_key] < CONFIRM_FRAMES:
                continue

            self._confirmed_set.add(face_key)
            self._master_mode = False
            self._record_attendance(face_key, frame_bgr, is_master=True)
            break

    def _record_attendance(self, face_key: tuple,
                           frame_bgr: np.ndarray, is_master: bool):
        """Ghi file, log, âm thanh cho một lần điểm danh thành công."""
        full_name, class_name = face_key
        uid      = self._get_uid_by_name(full_name, class_name)
        ts       = time.strftime("%H:%M:%S")
        img_path = self.att_logger.mark_present(
            full_name, class_name, uid, frame_bgr)

        tag = " [MASTER KEY]" if is_master else ""
        self._attendance_log.append((f"{full_name}{tag}", ts))
        self._last_log.append((full_name, ts, is_master))
        print(f"  ✓ ĐIỂM DANH{tag}: {full_name} | lớp {class_name} | {ts}")
        print(f"    → {img_path}")

        if self.mp3:
            self.mp3.play(TRACK_AUTH_OK)

    # ══════════════════════════════════════════════════════
    # DISPLAY STATE
    # ══════════════════════════════════════════════════════

    def _update_display_status(self):
        """Cập nhật trạng thái cho Pygame card FACE."""
        if self._master_mode:
            self._display_status = "MASTER"
            return

        best = None
        for r in self._last_results:
            if r.get("score", 0) >= THRESHOLD:
                if best is None or r["score"] > best["score"]:
                    best = r

        # Reset confirm_tracker cho mặt không còn trong frame
        seen = {r["full_key"] for r in self._last_results if r.get("full_key")}
        for k in list(self._confirm_tracker):
            if k not in seen:
                self._confirm_tracker[k] = 0

        if not best:
            self._display_status  = "WAITING"
            self._display_student = {}
            return

        full_key   = best["full_key"]
        score      = best["score"]
        info       = self.key_info.get(full_key)
        full_name  = info["full_name"]  if info else full_key
        class_name = info["class_name"] if info else ""
        face_key   = (full_name, class_name)

        if face_key in self._confirmed_set:
            uid = self._get_uid_by_name(full_name, class_name)
            self._display_status  = "OK"
            self._display_student = {
                "name": full_name, "class": class_name,
                "uid": uid, "score": score,
                "ts": self._get_confirmed_ts(face_key),
            }
            return

        self._confirm_tracker[full_key] = (
            self._confirm_tracker.get(full_key, 0) + 1)
        count = self._confirm_tracker[full_key]

        if count >= CONFIRM_FRAMES:
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
            self._display_status  = "SCANNING"
            self._display_student = {
                "name": full_name, "class": class_name,
                "score": score, "uid": "", "ts": "",
            }

    # ══════════════════════════════════════════════════════
    # HELPERS
    # ══════════════════════════════════════════════════════

    def _update_fps(self):
        self._fps_counter += 1
        elapsed = time.time() - self._fps_timer
        if elapsed >= 1.0:
            self._current_fps = self._fps_counter / elapsed
            self._fps_counter = 0
            self._fps_timer   = time.time()

    def _get_uid_by_name(self, full_name: str, class_name: str) -> str:
        for uid_hex, rec in self.uid_map.items():
            if rec["full_name"] == full_name and rec["class_name"] == class_name:
                return uid_hex
        return ""

    def _get_confirmed_ts(self, face_key: tuple) -> str:
        full_name = face_key[0]
        for name, ts in self._attendance_log:
            if name.startswith(full_name):
                return ts
        return ""

    # ══════════════════════════════════════════════════════
    # CLEANUP & SUMMARY
    # ══════════════════════════════════════════════════════

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
            print(f"Inf avg : {np.mean(self._inference_times) * 1000:.0f}ms")
        print(f"File    : {os.path.abspath(self.att_logger.txt_path)}")
