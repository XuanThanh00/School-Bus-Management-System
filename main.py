#!/usr/bin/env python3
"""
Hệ thống điểm danh học sinh — Raspberry Pi 5
Chạy: python main.py

Watchdog protocol:
  Khi start  → gửi "START\n"    → watchdog bắt đầu đếm
  Mỗi 3s     → gửi "HB\n"      → watchdog reset timer
  Khi thoát  → gửi "SHUTDOWN\n" → watchdog dừng, không trigger reboot
"""
import threading
import socket
import time

HB_SOCKET   = "/tmp/watchdog.sock"
HB_INTERVAL = 3.0


def send_to_watchdog(msg: str):
    """Gửi message đến watchdog.py qua Unix socket."""
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(2.0)
        sock.connect(HB_SOCKET)
        sock.sendall(msg.encode())
        sock.close()
    except (ConnectionRefusedError, FileNotFoundError):
        pass   # watchdog chưa chạy — bỏ qua
    except Exception as e:
        print(f"[WD] {e}")


def heartbeat_loop():
    """Gửi HB mỗi HB_INTERVAL giây. Daemon thread."""
    while True:
        send_to_watchdog("HB\n")
        time.sleep(HB_INTERVAL)


if __name__ == "__main__":
    # Khởi động heartbeat thread
    hb_thread = threading.Thread(target=heartbeat_loop, daemon=True)
    hb_thread.start()

    # Báo watchdog bắt đầu đếm
    send_to_watchdog("START\n")
    print(f"  ✓ Watchdog START → {HB_SOCKET}")

    from attendance import AttendanceSystem
    system = AttendanceSystem()
    system.setup()
    system.run()

    # Thoát bình thường → báo watchdog dừng
    send_to_watchdog("SHUTDOWN\n")
    print("  ✓ Watchdog SHUTDOWN")
