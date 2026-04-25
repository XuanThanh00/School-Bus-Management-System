# ══════════════════════════════════════════════════════════
# attendance/db.py
# SQLite layer — thay thế AttendanceLogger + registered_uids.txt
# WAL mode: an toàn khi mất điện, concurrent read OK
# ══════════════════════════════════════════════════════════

import os
import sqlite3
import time
import cv2

from .config import DB_SQLITE, STUDENT_IMG_DIR


# ══════════════════════════════════════════════════════════
# CLASS: AttendanceDB
# ══════════════════════════════════════════════════════════

class AttendanceDB:
    """
    Quản lý toàn bộ dữ liệu qua SQLite (WAL mode).

    Bảng:
      students            — danh sách học sinh + UID thẻ
      attendance_sessions — 1 session/ngày
      attendance_records  — bản ghi điểm danh (upsert-safe)

    Public API:
      ensure_students(records)     — sync danh sách học sinh
      get_uid_map()                → dict uid_hex → record
      get_today_session_id()       → session_id (tạo nếu chưa có)
      mark_present(...)            → evidence_path
      get_rows()                   → list[dict] để _print_summary
      get_attendance_count()       → (present, total)
      register_uid(full_name, class_name, uid)
      get_all_students()           → list[dict]
    """

    def __init__(self, db_path: str = DB_SQLITE,
                 img_dir: str = STUDENT_IMG_DIR,
                 route: str = "TUYEN 01"):
        self.db_path  = db_path
        self.img_dir  = img_dir
        self.route    = route
        os.makedirs(img_dir, exist_ok=True)
        self._conn = self._connect()
        self._create_tables()
        self._session_id: int | None = None   # cache session hiện tại

    # ── Connection ─────────────────────────────────────────

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            self.db_path,
            check_same_thread=False,
            isolation_level=None,     # autocommit — dùng BEGIN explicit
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous  = NORMAL")
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    # ── Schema ─────────────────────────────────────────────

    def _create_tables(self):
        self._conn.executescript("""
            BEGIN;

            CREATE TABLE IF NOT EXISTS students (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name  TEXT NOT NULL,
                class_name TEXT NOT NULL,
                uid        TEXT UNIQUE,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS attendance_sessions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                date       TEXT UNIQUE NOT NULL,
                route      TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS attendance_records (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id    INTEGER NOT NULL REFERENCES attendance_sessions(id),
                student_id    INTEGER NOT NULL REFERENCES students(id),
                status        INTEGER NOT NULL DEFAULT 0,
                checked_at    TEXT,
                evidence_path TEXT,
                UNIQUE(session_id, student_id)
            );

            COMMIT;
        """)
        # ── Migrate students: student_id (Firebase key) ─────────
        s_cols = {row[1] for row in self._conn.execute(
            "PRAGMA table_info(students)"
        ).fetchall()}
        if "student_id" not in s_cols:
            self._conn.execute(
                "ALTER TABLE students ADD COLUMN student_id TEXT"
            )
            print("  ✓ Migrate: student_id column added (sẽ được sync từ Firebase)")

        # ── Migrate attendance_records: GPS boarded + alighted ───
        existing = {row[1] for row in self._conn.execute(
            "PRAGMA table_info(attendance_records)"
        ).fetchall()}
        if "gps_lat" not in existing:
            self._conn.execute(
                "ALTER TABLE attendance_records ADD COLUMN gps_lat REAL"
            )
        if "gps_lon" not in existing:
            self._conn.execute(
                "ALTER TABLE attendance_records ADD COLUMN gps_lon REAL"
            )
        if "alighted_at" not in existing:
            self._conn.execute(
                "ALTER TABLE attendance_records ADD COLUMN alighted_at TEXT"
            )
        if "alighted_lat" not in existing:
            self._conn.execute(
                "ALTER TABLE attendance_records ADD COLUMN alighted_lat REAL"
            )
        if "alighted_lon" not in existing:
            self._conn.execute(
                "ALTER TABLE attendance_records ADD COLUMN alighted_lon REAL"
            )

    # ══════════════════════════════════════════════════════
    # SESSION
    # ══════════════════════════════════════════════════════

    def get_today_session_id(self) -> int:
        """Lấy session hôm nay, tạo mới nếu chưa có. Kết quả được cache."""
        if self._session_id is not None:
            return self._session_id

        today = self.get_today_date_str()
        row   = self._conn.execute(
            "SELECT id FROM attendance_sessions WHERE date = ?", (today,)
        ).fetchone()

        if row:
            self._session_id = row["id"]
        else:
            cur = self._conn.execute(
                "INSERT INTO attendance_sessions (date, route) VALUES (?, ?)",
                (today, self.route),
            )
            self._session_id = cur.lastrowid
            print(f"  ✓ Tạo session mới: {today} | {self.route}")

        return self._session_id

    def get_today_date_str(self) -> str:
        """Trả về chuỗi format YYYY-MM-DD_AM hoặc YYYY-MM-DD_PM (dùng cho SQLite session)."""
        suffix = "AM" if time.localtime().tm_hour < 12 else "PM"
        return f"{time.strftime('%Y-%m-%d')}_{suffix}"

    def get_today_date_only(self) -> str:
        """Trả về chuỗi format YYYY-MM-DD (dùng làm doc_id prefix trong Firestore)."""
        return time.strftime('%Y-%m-%d')

    # ══════════════════════════════════════════════════════
    # STUDENTS
    # ══════════════════════════════════════════════════════

    def ensure_students(self, uid_records: list[dict]):
        """
        Gọi lúc khởi động: đảm bảo mọi học sinh trong uid_records
        đều có dòng trong bảng students.

        uid_records: list of {"full_name", "class_name", "uid"}
        """
        session_id = self.get_today_session_id()

        for rec in uid_records:
            full_name  = rec["full_name"]
            class_name = rec["class_name"]
            uid        = rec["uid"].upper()
            student_id = rec.get("student_id")

            # Upsert student — COALESCE giữ student_id cũ nếu giá trị mới là NULL
            self._conn.execute("""
                INSERT INTO students (full_name, class_name, uid, student_id)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(uid) DO UPDATE SET
                    full_name  = excluded.full_name,
                    class_name = excluded.class_name,
                    student_id = COALESCE(excluded.student_id, student_id)
            """, (full_name, class_name, uid, student_id))

            # Lấy internal sid của SQLite
            sid = self._conn.execute(
                "SELECT id FROM students WHERE uid = ?", (uid,)
            ).fetchone()["id"]

            # Tạo attendance_record trạng thái vắng nếu chưa có
            self._conn.execute("""
                INSERT OR IGNORE INTO attendance_records (session_id, student_id, status)
                VALUES (?, ?, 0)
            """, (session_id, sid))

        print(f"  ✓ Đồng bộ {len(uid_records)} học sinh vào DB")

    def get_all_students(self) -> list[dict]:
        """Trả về tất cả học sinh."""
        rows = self._conn.execute(
            "SELECT id, full_name, class_name, uid, student_id FROM students ORDER BY full_name"
        ).fetchall()
        return [dict(r) for r in rows]

    def register_uid(self, full_name: str, class_name: str, uid: str):
        """
        Upsert từ save_uid.py — thêm hoặc cập nhật học sinh theo UID.
        """
        uid = uid.strip().upper()
        existing = self._conn.execute(
            "SELECT full_name, class_name FROM students WHERE uid = ?", (uid,)
        ).fetchone()

        if existing:
            if existing["full_name"] == full_name and existing["class_name"] == class_name:
                print(f"  ℹ Đã tồn tại: {full_name},{class_name},{uid} — bỏ qua")
                return
            print(f"  ⚠ UID {uid} đã đăng ký cho {existing['full_name']} "
                  f"({existing['class_name']})")
            print(f"    → Cập nhật thành: {full_name} ({class_name})")
            self._conn.execute(
                "UPDATE students SET full_name=?, class_name=? WHERE uid=?",
                (full_name, class_name, uid)
            )
        else:
            self._conn.execute(
                "INSERT INTO students (full_name, class_name, uid) VALUES (?, ?, ?)",
                (full_name, class_name, uid)
            )
            print(f"  ✓ Đã thêm: {full_name},{class_name},{uid}")

        count = self._conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        print(f"  → Tổng: {count} học sinh")

    # ══════════════════════════════════════════════════════
    # UID MAP
    # ══════════════════════════════════════════════════════

    def get_uid_map(self) -> dict:
        """uid_hex → {"full_name", "class_name", "uid"}"""
        rows = self._conn.execute(
            "SELECT full_name, class_name, uid FROM students WHERE uid IS NOT NULL"
        ).fetchall()
        return {
            r["uid"]: {
                "full_name":  r["full_name"],
                "class_name": r["class_name"],
                "uid":        r["uid"],
            }
            for r in rows
        }

    # ══════════════════════════════════════════════════════
    # ĐIỂM DANH
    # ══════════════════════════════════════════════════════

    def mark_present(self, full_name: str, class_name: str,
                     uid: str, frame_bgr,
                     gps_lat: float = None,
                     gps_lon: float = None) -> str:
        """
        Lưu ảnh minh chứng + upsert attendance_record → status=1.
        Trả về absolute path ảnh.
        frame_bgr: BGR frame — cv2.imwrite nhận BGR sẵn.
        gps_lat/lon: tọa độ GPS lúc điểm danh (None nếu chưa có fix).
        """
        session_id = self.get_today_session_id()
        ts         = time.strftime("%H:%M:%S")

        # Lưu ảnh
        img_filename = f"{full_name.replace(' ', '')}_{ts.replace(':', '')}.jpg"
        img_path     = os.path.abspath(os.path.join(self.img_dir, img_filename))
        cv2.imwrite(img_path, frame_bgr)

        # Tìm student_id
        uid = uid.upper() if uid else ""
        row = self._conn.execute(
            "SELECT id FROM students WHERE uid = ?", (uid,)
        ).fetchone() if uid else None

        if row is None:
            row = self._conn.execute(
                "SELECT id FROM students WHERE full_name=? AND class_name=?",
                (full_name, class_name)
            ).fetchone()

        if row is None:
            # Edge case: học sinh chưa tồn tại → tạo mới
            cur = self._conn.execute(
                "INSERT INTO students (full_name, class_name, uid) VALUES (?, ?, ?)",
                (full_name, class_name, uid or None)
            )
            student_id = cur.lastrowid
            self._conn.execute("""
                INSERT OR IGNORE INTO attendance_records (session_id, student_id, status)
                VALUES (?, ?, 0)
            """, (session_id, student_id))
        else:
            student_id = row["id"]

        # Upsert → status=1, ghi GPS nếu có
        self._conn.execute("""
            INSERT INTO attendance_records
                (session_id, student_id, status, checked_at, evidence_path, gps_lat, gps_lon)
            VALUES (?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(session_id, student_id) DO UPDATE SET
                status        = 1,
                checked_at    = excluded.checked_at,
                evidence_path = excluded.evidence_path,
                gps_lat       = excluded.gps_lat,
                gps_lon       = excluded.gps_lon,
                alighted_at   = NULL,
                alighted_lat  = NULL,
                alighted_lon  = NULL
        """, (session_id, student_id, ts, img_path, gps_lat, gps_lon))

        return img_path

    def mark_alighted(self, uid: str,
                      min_board_seconds: int = 0,
                      gps_lat: float = None,
                      gps_lon: float = None) -> int:
        """
        Ghi giờ xuống xe vào attendance_record đã boarded hôm nay.
        Trả về:
           1  → xuống xe thành công
           0  → chưa lên xe (hoặc đã xuống rồi)
          -1  → vừa lên xe, chưa đủ min_board_seconds
        """
        uid = uid.upper() if uid else ""
        if not uid:
            return 0

        session_id = self.get_today_session_id()
        ts = time.strftime("%H:%M:%S")

        row = self._conn.execute("""
            SELECT ar.id, ar.checked_at
            FROM attendance_records ar
            JOIN students s ON s.id = ar.student_id
            WHERE s.uid = ?
              AND ar.session_id = ?
              AND ar.status = 1
              AND ar.alighted_at IS NULL
        """, (uid, session_id)).fetchone()

        if row is None:
            return 0   # chưa boarded hoặc đã alighted rồi

        # Kiểm tra thời gian tối thiểu kể từ lúc lên xe
        if min_board_seconds > 0 and row["checked_at"]:
            def _to_sec(t: str) -> int:
                h, m, s = t.split(":")
                return int(h) * 3600 + int(m) * 60 + int(s)
            elapsed = _to_sec(ts) - _to_sec(row["checked_at"])
            if elapsed < min_board_seconds:
                remaining = min_board_seconds - elapsed
                print(f"    [DB] Vừa lên xe {elapsed//60:.0f}p{elapsed%60:.0f}s trước "
                      f"— còn {remaining//60:.0f}p{remaining%60:.0f}s nữa mới được xuống")
                return -1

        self._conn.execute("""
            UPDATE attendance_records
            SET alighted_at  = ?,
                alighted_lat = ?,
                alighted_lon = ?
            WHERE id = ?
        """, (ts, gps_lat, gps_lon, row[0]))

        return 1

    def get_student_firebase_id(self, uid: str) -> str | None:
        """
        Trả về student_id Firebase (vd 'hs001') theo uid thẻ.
        Trả về None nếu không tìm thấy hoặc chưa sync.
        """
        uid = uid.upper() if uid else ""
        row = self._conn.execute(
            "SELECT student_id FROM students WHERE uid = ?", (uid,)
        ).fetchone()
        return row[0] if row else None

    def update_student_id(self, uid: str, student_id: str) -> bool:
        """
        Cập nhật student_id Firebase cho học sinh theo uid thẻ.
        Gọi sau khi fetch danh sách users từ Firebase.
        Trả về True nếu cập nhật thành công.
        """
        uid = uid.upper() if uid else ""
        cur = self._conn.execute(
            "UPDATE students SET student_id=? WHERE uid=?",
            (student_id, uid)
        )
        return cur.rowcount > 0

    def update_student_id_by_name(self, full_name: str, student_id: str) -> bool:
        """
        Cập nhật student_id Firebase theo tên học sinh.
        Dùng khi Firebase users dùng studentName để match.
        """
        cur = self._conn.execute(
            "UPDATE students SET student_id=? WHERE full_name=?",
            (student_id, full_name)
        )
        return cur.rowcount > 0

    def get_students_missing_firebase_id(self) -> list[dict]:
        """Trả về học sinh chưa có student_id (chưa sync từ Firebase)."""
        rows = self._conn.execute(
            "SELECT uid, full_name, class_name FROM students "
            "WHERE student_id IS NULL OR student_id = '' "
            "ORDER BY full_name"
        ).fetchall()
        return [dict(r) for r in rows]

    def get_boarded_students_today(self) -> list[dict]:
        """
        Trả về list học sinh đã lên xe hôm nay (status=1).
        Keys: uid, student_id, full_name, class_name,
              checked_at, gps_lat, gps_lon,
              alighted_at, alighted_lat, alighted_lon
        """
        session_id = self.get_today_session_id()
        rows = self._conn.execute("""
            SELECT s.uid, s.student_id, s.full_name, s.class_name,
                   ar.checked_at, ar.gps_lat, ar.gps_lon,
                   ar.alighted_at, ar.alighted_lat, ar.alighted_lon
            FROM attendance_records ar
            JOIN students s ON s.id = ar.student_id
            WHERE ar.session_id = ? AND ar.status = 1
        """, (session_id,)).fetchall()
        return [dict(r) for r in rows]

    # ══════════════════════════════════════════════════════
    # QUERY
    # ══════════════════════════════════════════════════════

    def get_rows(self) -> list[dict]:
        """
        Trả về list[dict] để _print_summary dùng.
        Keys: FullName, Class, UID, Status, Time, Evidence, GpsLat, GpsLon
        """
        session_id = self.get_today_session_id()
        rows = self._conn.execute("""
            SELECT
                s.full_name  AS FullName,
                s.class_name AS Class,
                COALESCE(s.uid, '') AS UID,
                COALESCE(ar.status, 0) AS Status,
                COALESCE(ar.checked_at, '') AS Time,
                COALESCE(ar.evidence_path, '') AS Evidence,
                ar.gps_lat AS GpsLat,
                ar.gps_lon AS GpsLon
            FROM students s
            LEFT JOIN attendance_records ar
                ON ar.student_id = s.id AND ar.session_id = ?
            ORDER BY s.full_name
        """, (session_id,)).fetchall()
        return [
            {
                "FullName": r["FullName"],
                "Class":    r["Class"],
                "UID":      r["UID"],
                "Status":   str(r["Status"]),
                "Time":     r["Time"],
                "Evidence": r["Evidence"],
                "GpsLat":   r["GpsLat"],
                "GpsLon":   r["GpsLon"],
            }
            for r in rows
        ]

    def get_attendance_count(self) -> tuple[int, int]:
        """Trả về (present, total) cho session hôm nay."""
        session_id = self.get_today_session_id()
        total   = self._conn.execute(
            "SELECT COUNT(*) FROM students WHERE uid IS NOT NULL"
        ).fetchone()[0]
        present = self._conn.execute(
            "SELECT COUNT(*) FROM attendance_records WHERE session_id=? AND status=1",
            (session_id,)
        ).fetchone()[0]
        return present, total

    # ══════════════════════════════════════════════════════
    # CLEANUP
    # ══════════════════════════════════════════════════════

    def close(self):
        try:
            self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            self._conn.close()
        except Exception:
            pass