# ══════════════════════════════════════════════════════════
# attendance/logger.py
# ══════════════════════════════════════════════════════════

import os
import time
import cv2

from .config import ATTENDANCE_FILE, STUDENT_IMG_DIR, UID_FILE


class AttendanceLogger:
    """
    Quản lý file điểm danh .txt và lưu ảnh minh chứng.

    Format mỗi dòng:
      FullName,Class,UID,Status,Time,EvidencePath

    - Status  : 1 = có mặt, 0 = vắng
    - Time    : HH:MM:SS khi điểm danh, rỗng nếu vắng
    - Evidence: absolute path ảnh, rỗng nếu vắng

    Upsert theo FullName — chạy lại không tạo dòng trùng.
    """

    SEP = ","

    def __init__(self, txt_path: str = ATTENDANCE_FILE,
                 img_dir: str = STUDENT_IMG_DIR):
        self.txt_path = txt_path
        self.img_dir  = img_dir
        os.makedirs(img_dir, exist_ok=True)
        self._rows: list[dict] = []   # list of dict keys: FullName,Class,UID,Status,Time,Evidence
        self._load_or_init()

    # ── I/O ────────────────────────────────────────────────

    def _load_or_init(self):
        if os.path.exists(self.txt_path):
            with open(self.txt_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split(self.SEP, 5)
                    # pad đủ 6 cột nếu dòng cũ thiếu
                    while len(parts) < 6:
                        parts.append("")
                    self._rows.append({
                        "FullName": parts[0], "Class":    parts[1],
                        "UID":      parts[2], "Status":   parts[3],
                        "Time":     parts[4], "Evidence": parts[5],
                    })
        else:
            self._flush()

    def _flush(self):
        with open(self.txt_path, "w", encoding="utf-8") as f:
            for row in self._rows:
                f.write(self.SEP.join([
                    row["FullName"], row["Class"], row["UID"],
                    row["Status"],  row["Time"],  row["Evidence"],
                ]) + "\n")

    # ── Public API ─────────────────────────────────────────

    def ensure_students(self, uid_records: list[dict]):
        """
        Gọi lúc khởi động: đảm bảo mọi học sinh trong uid_records
        đều có dòng trong file (Status=0). Nếu đã có thì giữ nguyên.

        uid_records: list of {"full_name", "class_name", "uid"}
        """
        existing = {r["FullName"] for r in self._rows}
        changed  = False
        for rec in uid_records:
            if rec["full_name"] not in existing:
                self._rows.append({
                    "FullName": rec["full_name"],
                    "Class":    rec["class_name"],
                    "UID":      rec["uid"],
                    "Status":   "0",
                    "Time":     "",
                    "Evidence": "",
                })
                existing.add(rec["full_name"])
                changed = True
        if changed:
            self._flush()

    def mark_present(self, full_name: str, class_name: str,
                     uid: str, frame_rgb) -> str:
        """
        Lưu ảnh minh chứng + upsert dòng điểm danh.
        Tên ảnh: HoTenKhongDau_HH:MM:SS.jpg
        Trả về absolute path ảnh.
        """
        ts           = time.strftime("%H:%M:%S")
        img_filename = f"{full_name.replace(' ', '')}_{ts.replace(':', '')}.jpg"
        img_path     = os.path.abspath(os.path.join(self.img_dir, img_filename))
        cv2.imwrite(img_path, cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR))

        for row in self._rows:
            if row["FullName"] == full_name:
                row["Class"]    = class_name
                row["UID"]      = uid
                row["Status"]   = "1"
                row["Time"]     = ts
                row["Evidence"] = img_path
                self._flush()
                return img_path

        # chưa có dòng → thêm mới
        self._rows.append({
            "FullName": full_name, "Class":    class_name,
            "UID":      uid,       "Status":   "1",
            "Time":     ts,        "Evidence": img_path,
        })
        self._flush()
        return img_path

    def get_rows(self) -> list[dict]:
        return self._rows
