#!/usr/bin/env python3
"""
Student attendance system — Raspberry Pi 5
Run: python main.py
"""
import signal
import socket
import sys
import threading
import time

# ── Watchdog config ────────────────────────────────────────
HB_SOCKET   = "/tmp/watchdog.sock"
HB_INTERVAL = 3.0          # seconds between heartbeats


# ══════════════════════════════════════════════════════════
# Watchdog client
# ══════════════════════════════════════════════════════════

def _wd_send(msg: str):
    """Send a message to watchdog.py via Unix socket (fire-and-forget)."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            s.connect(HB_SOCKET)
            s.sendall(msg.encode())
    except (ConnectionRefusedError, FileNotFoundError):
        pass    # watchdog not running yet — ignore
    except Exception as e:
        print(f"[WD] {e}")


def _heartbeat_loop():
    """Daemon thread: send HB every HB_INTERVAL seconds."""
    while True:
        _wd_send("HB\n")
        time.sleep(HB_INTERVAL)


def _start_watchdog_client():
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    _wd_send("START\n")
    print(f"  ✓ Watchdog START → {HB_SOCKET}")


def _stop_watchdog_client():
    _wd_send("SHUTDOWN\n")
    print("  ✓ Watchdog SHUTDOWN")


# ══════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════

def main():
    _start_watchdog_client()

    from attendance import AttendanceSystem
    system = AttendanceSystem()

    # Graceful shutdown on SIGTERM (systemd) or SIGINT (Ctrl+C)
    def _on_signal(sig, frame):
        print(f"\n[main] Nhận signal {sig} → dừng hệ thống...")
        system.stop()

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT,  _on_signal)

    try:
        system.setup()
        system.run()
    finally:
        _stop_watchdog_client()


if __name__ == "__main__":
    main()