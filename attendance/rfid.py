# ══════════════════════════════════════════════════════════
# attendance/rfid.py
# ══════════════════════════════════════════════════════════

import time
import threading

from .config import UID_FILE


def load_uid_records() -> list[dict]:
    """
    Đọc registered_uids.txt → list of dict.
    Format mỗi dòng: FullName,Class,UID
    Ví dụ: Vo Minh Thai,1A3,7C9FE000
    """
    records = []
    try:
        with open(UID_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split(",", 2)
                if len(parts) == 3:
                    records.append({
                        "full_name":  parts[0].strip(),
                        "class_name": parts[1].strip(),
                        "uid":        parts[2].strip().upper(),
                    })
    except FileNotFoundError:
        print(f"  ⚠ Không tìm thấy '{UID_FILE}'")
    return records


def build_uid_map(records: list[dict]) -> dict:
    """uid_hex → {"full_name", "class_name", "uid"}"""
    return {r["uid"]: r for r in records}


def uid_to_hex(uid_int: int) -> str:
    """Chuyển UID integer sang HEX 4 bytes: A0B1C2D3"""
    uid_bytes = uid_int.to_bytes((uid_int.bit_length() + 7) // 8, byteorder='big')
    uid_bytes = uid_bytes[:4]
    return "".join(f"{b:02X}" for b in uid_bytes)


class RFIDReader:
    """
    Đọc thẻ RFID trên thread riêng dùng read_id() (blocking).
    Kết quả mới nhất truy cập qua get_and_clear() hoặc peek().

    last_result = {
        "full_name":  "Vo Minh Thai",
        "class_name": "1A3",
        "uid":        "7C9FE000",
        "timestamp":  1234567890.123,
    }
    """

    def __init__(self, uid_map: dict):
        self._uid_map    = uid_map
        self._last_result = None
        self._lock        = threading.Lock()
        self._running     = True
        self._thread      = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        from mfrc522 import SimpleMFRC522
        reader    = SimpleMFRC522()
        last_uid  = None
        last_time = 0
        try:
            while self._running:
                try:
                    uid_int = reader.read_id()
                    if uid_int:
                        uid_hex = uid_to_hex(uid_int)
                        now     = time.time()

                        # debounce: cùng thẻ không xử lý lại trong 3s
                        if uid_hex != last_uid or (now - last_time) > 3:
                            last_uid  = uid_hex
                            last_time = now

                            rec    = self._uid_map.get(uid_hex)
                            result = {
                                "full_name":  rec["full_name"]  if rec else None,
                                "class_name": rec["class_name"] if rec else "",
                                "uid":        uid_hex,
                                "timestamp":  now,
                            }
                            with self._lock:
                                self._last_result = result

                            if rec:
                                print(f"  [RFID] ✓ {rec['full_name']} ({uid_hex})")
                            else:
                                print(f"  [RFID] ✗ UID không đăng ký: {uid_hex}")
                except Exception as e:
                    print(f"  [RFID] Lỗi đọc thẻ: {e}")
                    time.sleep(0.5)
        finally:
            try:
                reader.close()
                import RPi.GPIO as GPIO
                GPIO.cleanup()
            except Exception:
                pass

    def get_and_clear(self) -> dict | None:
        """Lấy kết quả mới nhất và xóa luôn (dùng 1 lần)."""
        with self._lock:
            r = self._last_result
            self._last_result = None
            return r

    def peek(self) -> dict | None:
        """Xem kết quả mới nhất mà không xóa."""
        with self._lock:
            return self._last_result

    def stop(self):
        self._running = False
        self._thread.join(timeout=2)