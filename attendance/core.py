# ══════════════════════════════════════════════════════════
# attendance/core.py
# Orchestrator chính — kết nối tất cả các module lại.
# Kiến trúc 2 tầng: RFID + Audio chuyển xuống STM32.
# ══════════════════════════════════════════════════════════

import os
import time
import threading
from collections import deque

import numpy as np
from picamera2 import Picamera2

from .config import (
    CAMERA_WIDTH, CAMERA_HEIGHT, PROCESS_EVERY_N,
    CONFIRM_FRAMES, MATCH_WINDOW, THRESHOLD,
    MASTER_KEY_UID, MASTER_KEY_TIMEOUT,
    YUNET_PATH,
    UART_STM32_PORT, UART_STM32_BAUD, STM32_RESET_PIN,
    TRACK_INVITE_SCAN, TRACK_SCAN_OK, TRACK_SCAN_INVALID,
    TRACK_FACE_START, TRACK_AUTH_OK, TRACK_FACE_MISMATCH,
    HB_PI_INTERVAL, STM32_HB_TIMEOUT,
    FACE_PROMPT_COOLDOWN, RFID_WAIT_TIMEOUT,
)
from .vision          import (ImagePreprocessor, YuNetDetector,
                               BuffaloRecognizer, FaceDatabase, load_key_info)
from .camera          import CameraThread
from .overlay         import draw_frame
from .db              import AttendanceDB
from .display         import BusDisplay
from .stm32_protocol  import STM32Protocol, FLAG_GPS_FIX


# ──────────────────────────────────────────────────────────
class AttendanceSystem:
    """
    Hệ thống điểm danh 2 yếu tố: khuôn mặt + RFID.
      setup() → khởi tạo model, DB, STM32, camera, display
      run()   → vòng lặp chính
    """

    def __init__(self):
        # AI components
        self.preprocessor = ImagePreprocessor()
        self.detector:    YuNetDetector    = None
        self.recognizer:  BuffaloRecognizer = None
        self.face_db:     FaceDatabase      = None
        self.key_info:    dict              = {}

        # Hardware
        self.stm32:       STM32Protocol  = None
        self.cam_thread:  CameraThread   = None
        self._picam2:     Picamera2      = None
        self._display:    BusDisplay     = None

        # DB
        self.att_db = AttendanceDB()
        self.uid_map: dict = {}

        # ── STM32 / system state ────────────────────────────
        self._handshake_done    = False
        self._last_stm32_hb     = time.time()
        self._last_hb_pi_sent   = 0.0
        self._gps_lat:  float | None = None
        self._gps_lon:  float | None = None
        self._gps_str           = "GPS: --"
        self._running           = False

        # ── Face recognition state ──────────────────────────
        self._frame_counter   = 0
        self._last_results: list = []
        self._inference_times = deque(maxlen=30)
        self._fps_counter     = 0
        self._fps_timer       = time.time()
        self._current_fps     = 0.0

        # ── 2-factor confirm state ──────────────────────────
        self._confirm_tracker: dict = {}
        self._confirmed_set:   set  = set()
        self._attendance_log:  list = []
        self._last_log:        list = []
        self._face_pending:    dict = {}    # (name, cls) → timestamp
        self._rfid_pending:    dict = {}    # (name, cls) → timestamp
        self._face_announced:  set  = set()
        self._face_prompt_cooldown = 0.0   # giây còn lại trước khi phát lại invite

        # ── Master key state ────────────────────────────────
        self._master_mode  = False
        self._master_until = 0.0

        # ── Display state ───────────────────────────────────
        self._display_status  = "WAITING"
        self._display_student: dict = {}
        self._disp_rfid_name  = ""
        self._disp_rfid_class = ""
        self._disp_rfid_uid   = ""
        self._disp_rfid_ts    = 0.0
        self._rfid_display_name  = ""
        self._rfid_display_until = 0.0

    # ══════════════════════════════════════════════════════
    # SETUP
    # ══════════════════════════════════════════════════════

    def setup(self):
        self._load_models()
        self._load_database()
        self._init_stm32()
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
        uid_records  = self.att_db.get_all_students()
        self.uid_map = self._build_uid_map(uid_records)
        self.att_db.ensure_students(uid_records)
        self._check_data_mismatch(uid_records)
        present, total = self.att_db.get_attendance_count()
        print(f"  ✓ Database: {self.face_db.count} học sinh "
              f"| {len(self.uid_map)} thẻ RFID "
              f"| Đã điểm danh: {present}/{total}")

    def _build_uid_map(self, uid_records: list) -> dict:
        """uid_hex → {"full_name", "class_name", "uid"}"""
        m = {}
        for rec in uid_records:
            uid = rec.get("uid", "").strip().upper()
            if uid:
                m[uid] = rec
        return m

    def _check_data_mismatch(self, uid_records: list):
        face_map = {info["full_name"]: info["class_name"]
                    for info in self.key_info.values()}
        rfid_map = {rec["full_name"]: rec["class_name"]
                    for rec in uid_records if rec.get("uid")}
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

    def _init_stm32(self):
        """Khởi tạo STM32Protocol, đợi handshake xong mới return."""
        self.stm32 = STM32Protocol(
            port       = UART_STM32_PORT,
            baud       = UART_STM32_BAUD,
            reset_gpio = STM32_RESET_PIN,
            on_rfid        = self._on_rfid,
            on_gps         = self._on_gps,
            on_gps_no_fix  = self._on_gps_no_fix,
            on_hb_stm32    = self._on_hb_stm32,
            on_ready       = self._on_stm32_ready,
            on_ack         = self._on_ack,
        )
        self.stm32.open()

        # Chờ handshake tối đa 30s
        print("  Chờ STM32 READY...", end="", flush=True)
        deadline = time.time() + 30
        while not self._handshake_done and time.time() < deadline:
            time.sleep(0.1)

        if self._handshake_done:
            print(" ✓ STM32 sẵn sàng")
        else:
            print(" ⚠ Timeout — tiếp tục không có STM32")

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
    # STM32 CALLBACKS  (chạy trong RX thread của STM32Protocol)
    # ══════════════════════════════════════════════════════

    def _on_stm32_ready(self):
        # ACK đã được STM32Protocol gửi tự động trong _dispatch
        # Gửi HB_PI ngay để STM32 chuyển sang RUNNING
        self.stm32.send_hb_pi()
        self._last_hb_pi_sent = time.time()

    def _on_hb_stm32(self, flags: int):
        self._last_stm32_hb = time.time()
        if not self._handshake_done:
            self._handshake_done = True
        if not (flags & FLAG_GPS_FIX):
            # GPS chưa fix: giữ nguyên GPS string nếu đã có
            pass

    def _on_rfid(self, uid_hex: str):
        """Callback khi STM32 gửi RFID_UID — chạy trong RX thread."""
        # Dùng threading để không block RX thread
        threading.Thread(
            target=self._handle_rfid,
            args=(uid_hex,),
            daemon=True
        ).start()

    def _on_gps(self, lat: float, lon: float):
        self._gps_lat = lat
        self._gps_lon = lon
        self._gps_str = f"GPS: {lat:.5f}, {lon:.5f}"

    def _on_gps_no_fix(self, sat_count: int):
        self._gps_str = f"GPS: no fix (sat={sat_count})"

    def _on_ack(self, cmd_acked: int):
        pass   # log nếu cần debug

    # ══════════════════════════════════════════════════════
    # MAIN LOOP
    # ══════════════════════════════════════════════════════

    def run(self):
        print("\nNhấn Q hoặc ESC để thoát.\n")
        self._running        = True
        self._display_student = {}

        try:
            while self._running:
                frame = self.cam_thread.get_frame()
                if frame is None:
                    time.sleep(0.01)
                    continue

                now = time.time()

                # ── Gửi HB_PI định kỳ ──────────────────────
                if now - self._last_hb_pi_sent >= HB_PI_INTERVAL:
                    self.stm32.send_hb_pi()
                    self._last_hb_pi_sent = now

                # ── Cảnh báo / reset nếu STM32 im lặng ─────
                stm32_silent = now - self._last_stm32_hb
                if stm32_silent > STM32_HB_TIMEOUT:
                    print(f"  ⚠ STM32 im lặng {stm32_silent:.0f}s → hard reset")
                    self.stm32.reset_stm32()
                    self._last_stm32_hb = now   # reset timer tránh loop

                # ── Face inference ──────────────────────────
                self._frame_counter += 1
                if self._frame_counter % PROCESS_EVERY_N == 0:
                    self._run_inference(frame, now)

                # ── 2-factor confirm ────────────────────────
                self._try_master_confirm(frame)
                self._try_confirm(frame)
                self._update_display_status(now)
                self._update_fps()

                # ── Render ──────────────────────────────────
                avg_inf   = (int(np.mean(self._inference_times) * 1000)
                             if self._inference_times else 0)
                master_sec = (max(0, int(self._master_until - now))
                              if self._master_mode else 0)
                frame_out = draw_frame(
                    frame,
                    last_results       = self._last_results,
                    key_info           = self.key_info,
                    confirmed_set      = self._confirmed_set,
                    master_mode        = self._master_mode,
                    master_until       = self._master_until,
                    rfid_display_name  = self._rfid_display_name,
                    rfid_display_until = self._rfid_display_until,
                )

                present, total = self.att_db.get_attendance_count()
                still_running = self._display.update(
                    frame_bgr    = frame_out,
                    face_status  = self._display_status,
                    face_name    = self._display_student.get("name", ""),
                    face_class   = self._display_student.get("class", ""),
                    face_score   = self._display_student.get("score", 0.0),
                    face_ts      = self._display_student.get("ts", ""),
                    rfid_name    = self._disp_rfid_name,
                    rfid_class   = self._disp_rfid_class,
                    rfid_uid     = self._disp_rfid_uid,
                    rfid_ts      = self._disp_rfid_ts,
                    attendance   = present,
                    total        = total,
                    fps          = self._current_fps,
                    inf_ms       = avg_inf,
                    gps_str      = self._gps_str,
                    master_sec   = master_sec,
                    last_log     = self._last_log,
                )
                if not still_running:
                    break

        finally:
            self._cleanup()
            self._print_summary()

    def stop(self):
        """Gọi từ signal handler để dừng gracefully."""
        self._running = False
        self._cleanup()

    # ══════════════════════════════════════════════════════
    # INFERENCE
    # ══════════════════════════════════════════════════════

    def _run_inference(self, frame_bgr: np.ndarray, now: float):
        t0        = time.time()
        processed = self.preprocessor.process_live_frame(frame_bgr)
        faces     = self.detector.detect(processed)
        results   = []

        has_face = bool(faces)

        if faces:
            crops = [self.recognizer.extract_face_crop(processed, f) for f in faces]
            embs  = [self.recognizer.get_embedding(c) for c in crops]
            hits  = self.face_db.identify_batch(embs)
            for face, (full_key, score) in zip(faces, hits):
                results.append({
                    "bbox":     face[:4],
                    "conf":     face[4],
                    "full_key": full_key,
                    "score":    score,
                })

        self._last_results = results
        self._inference_times.append(time.time() - t0)

        # ── Phát "mời quét thẻ" khi detect được mặt ────────
        if has_face:
            if now >= self._face_prompt_cooldown:
                waiting_rfid = any(
                    (now - ts) <= RFID_WAIT_TIMEOUT
                    for ts in self._face_pending.values()
                )
                if not waiting_rfid:
                    self.stm32.send_play_audio(TRACK_INVITE_SCAN)
                    self._face_prompt_cooldown = now + FACE_PROMPT_COOLDOWN
        else:
            self._face_prompt_cooldown = 0.0

    # ══════════════════════════════════════════════════════
    # RFID HANDLER
    # ══════════════════════════════════════════════════════

    def _handle_rfid(self, uid_hex: str):
        """Xử lý UID nhận từ STM32 (chạy trong thread riêng)."""
        now = time.time()

        # ── Master Key ──────────────────────────────────────
        if uid_hex == MASTER_KEY_UID:
            self._master_mode       = True
            self._master_until      = now + MASTER_KEY_TIMEOUT
            self._rfid_display_name  = "[MASTER KEY]"
            self._rfid_display_until = self._master_until
            print(f"  [MASTER] Kích hoạt {MASTER_KEY_TIMEOUT}s")
            return

        # ── Lookup DB ───────────────────────────────────────
        rec = self.uid_map.get(uid_hex)
        if rec is None:
            print(f"  [RFID] UID không đăng ký: {uid_hex}")
            self.stm32.send_play_audio(TRACK_SCAN_INVALID)
            return

        full_name  = rec["full_name"]
        class_name = rec["class_name"]

        # ── Cập nhật display ────────────────────────────────
        self._rfid_display_name  = f"ID: {full_name}"
        self._rfid_display_until = now + 5
        self._disp_rfid_name     = full_name
        self._disp_rfid_class    = class_name
        self._disp_rfid_uid      = uid_hex
        self._disp_rfid_ts       = now

        self.stm32.send_play_audio(TRACK_SCAN_OK)

        # ── Đưa vào rfid_pending để 2-factor ghép với face ──
        self._rfid_pending[(full_name, class_name)] = now
        print(f"  [RFID] {full_name} ({class_name}) — chờ xác thực mặt")

    # ══════════════════════════════════════════════════════
    # 2-FACTOR CONFIRM
    # ══════════════════════════════════════════════════════

    def _try_confirm(self, frame_bgr: np.ndarray):
        now = time.time()

        rfid_expired = {k for k, v in self._rfid_pending.items()
                        if now - v > MATCH_WINDOW}
        self._face_pending = {k: v for k, v in self._face_pending.items()
                              if now - v <= MATCH_WINDOW}
        self._rfid_pending = {k: v for k, v in self._rfid_pending.items()
                              if now - v <= MATCH_WINDOW}

        for key in rfid_expired:
            if key not in self._confirmed_set:
                self.stm32.send_play_audio(TRACK_FACE_MISMATCH)

        for key in list(self._face_pending):
            if key in self._rfid_pending and key not in self._confirmed_set:
                self._confirmed_set.add(key)
                self._face_announced.discard(key)
                del self._face_pending[key]
                del self._rfid_pending[key]
                self._record_attendance(key, frame_bgr, is_master=False)

    def _try_master_confirm(self, frame_bgr: np.ndarray):
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
        full_name, class_name = face_key
        uid      = self._get_uid_by_name(full_name, class_name)
        ts       = time.strftime("%H:%M:%S")
        img_path = self.att_db.mark_present(
            full_name, class_name, uid, frame_bgr,
            gps_lat=self._gps_lat,
            gps_lon=self._gps_lon,
        )

        tag = " [MASTER KEY]" if is_master else ""
        self._attendance_log.append((f"{full_name}{tag}", ts))
        self._last_log.append((full_name, ts, is_master))
        print(f"  ✓ ĐIỂM DANH{tag}: {full_name} | lớp {class_name} | {ts}")
        print(f"    → {img_path}")

        self.stm32.send_play_audio(TRACK_AUTH_OK)

    # ══════════════════════════════════════════════════════
    # DISPLAY STATE
    # ══════════════════════════════════════════════════════

    def _update_display_status(self, now: float):
        if self._master_mode:
            self._display_status = "MASTER"
            return

        best = None
        for r in self._last_results:
            if r.get("score", 0) >= THRESHOLD:
                if best is None or r["score"] > best["score"]:
                    best = r

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
            self._face_pending[face_key] = now
            if face_key not in self._face_announced:
                self._face_announced.add(face_key)
                self.stm32.send_play_audio(TRACK_FACE_START)
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
        if self.stm32:
            self.stm32.send_shutdown()
            time.sleep(0.3)
            self.stm32.close()
        if self.cam_thread: self.cam_thread.stop()
        if self._picam2:    self._picam2.stop()
        if self._display:   self._display.quit()
        # att_db.close() KHÔNG gọi ở đây — gọi ở cuối _print_summary

    def _print_summary(self):
        print("\n" + "=" * 55)
        print("  KẾT QUẢ ĐIỂM DANH")
        print("=" * 55)
        try:
            for row in self.att_db.get_rows():
                status = "✓ Có mặt" if row["Status"] == "1" else "✗ Vắng"
                print(f"  {status}  {row['FullName']}  (lớp {row['Class']})")
            if self._attendance_log:
                print("\nChi tiết:")
                for name, ts in self._attendance_log:
                    print(f"  {ts}  {name}")
            present, total = self.att_db.get_attendance_count()
            print(f"\nTổng    : {present}/{total}")
        except Exception as e:
            print(f"  (lỗi đọc DB: {e})")
        if self._inference_times:
            print(f"Inf avg : {np.mean(self._inference_times) * 1000:.0f}ms")
        print(f"DB      : {os.path.abspath(self.att_db.db_path)}")
        if self.stm32:
            print(f"STM32   : rx_ok={self.stm32.pkts_rx_ok} "
                  f"rx_err={self.stm32.pkts_rx_err} "
                  f"tx={self.stm32.pkts_tx}")
        # Đóng DB sau khi đọc xong
        if self.att_db:
            self.att_db.close()