#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════
# save_uid.py — chạy trên Pi 5
# Nhận MQTT từ ESP32, lưu vào SQLite (bus_system.db)
#
# Chạy: python3 save_uid.py
# Cài:  pip install paho-mqtt
# ══════════════════════════════════════════════════════════

import paho.mqtt.client as mqtt
import os
import signal
import sys
from datetime import datetime

# ── Config ─────────────────────────────────────────────────
MQTT_BROKER  = "localhost"
MQTT_PORT    = 1883
MQTT_TOPIC   = "rfid/register"

# Import DB trực tiếp từ package attendance
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from attendance.db import AttendanceDB

# Singleton DB — mở 1 lần, dùng suốt
_db: AttendanceDB | None = None


def get_db() -> AttendanceDB:
    global _db
    if _db is None:
        _db = AttendanceDB()
    return _db


# ══════════════════════════════════════════════════════════
# VALIDATION
# ══════════════════════════════════════════════════════════

def validate_payload(payload: str) -> tuple:
    """
    Kiểm tra format payload: FullName,Class,UID
    Trả về (full_name, class_name, uid) hoặc raise ValueError
    """
    parts = payload.strip().split(",", 2)
    if len(parts) != 3:
        raise ValueError(f"Format sai — cần 3 trường, nhận được: '{payload}'")

    full_name, class_name, uid = [p.strip() for p in parts]

    if not full_name:
        raise ValueError("Tên không được để trống")
    if not class_name:
        raise ValueError("Lớp không được để trống")
    if len(uid) != 8 or not all(c in "0123456789ABCDEFabcdef" for c in uid):
        raise ValueError(f"UID không hợp lệ: '{uid}' (cần 8 ký tự HEX)")

    return full_name, class_name, uid.upper()


# ══════════════════════════════════════════════════════════
# MQTT CALLBACKS
# ══════════════════════════════════════════════════════════

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("✓ Kết nối MQTT broker thành công")
        client.subscribe(MQTT_TOPIC)
        print(f"  Đang lắng nghe topic: {MQTT_TOPIC}")
        print(f"  Lưu vào DB: {os.path.abspath(get_db().db_path)}")
        print("\nChờ dữ liệu từ ESP32... (Ctrl+C để dừng)\n")
    else:
        print(f"✗ Kết nối thất bại, rc={rc}")


def on_message(client, userdata, msg):
    payload = msg.payload.decode("utf-8", errors="replace").strip()
    ts      = datetime.now().strftime("%H:%M:%S")

    print(f"\n[{ts}] Nhận từ ESP32: '{payload}'")

    try:
        full_name, class_name, uid = validate_payload(payload)
        get_db().register_uid(full_name, class_name, uid)
    except ValueError as e:
        print(f"  ✗ Lỗi: {e}")


def on_disconnect(client, userdata, rc):
    if rc != 0:
        print(f"⚠ Mất kết nối MQTT (rc={rc}), đang kết nối lại...")


# ══════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════

def main():
    print("=" * 50)
    print("  Pi 5 — RFID Register Receiver (SQLite)")
    print("=" * 50)

    if os.system("systemctl is-active --quiet mosquitto") != 0:
        print("⚠ Mosquitto chưa chạy! Khởi động:")
        print("  sudo systemctl start mosquitto")
        sys.exit(1)

    client = mqtt.Client(client_id="pi5_uid_saver")
    client.on_connect    = on_connect
    client.on_message    = on_message
    client.on_disconnect = on_disconnect

    def shutdown(sig, frame):
        print("\n\nĐang dừng...")
        if _db:
            _db.close()
        client.disconnect()
        client.loop_stop()
        sys.exit(0)

    signal.signal(signal.SIGINT,  shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        client.loop_forever()
    except ConnectionRefusedError:
        print(f"✗ Không kết nối được MQTT tại {MQTT_BROKER}:{MQTT_PORT}")
        print("  Kiểm tra: sudo systemctl status mosquitto")
        sys.exit(1)


if __name__ == "__main__":
    main()