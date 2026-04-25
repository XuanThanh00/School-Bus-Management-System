#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════
# watchdog.py — runs independently on Pi 5 via systemd
#
# Single purpose: feed /dev/watchdog while main.py is alive.
# UART/STM32 is managed entirely by main.py — watchdog does not touch it.
#
# Flow:
#   Pi boot → watchdog.py start → open /dev/watchdog
#   main.py start → send "START\n" → begin feeding
#   main.py sends "HB\n" every 3s → watchdog feeds /dev/watchdog every 5s
#   main.py exit → send "SHUTDOWN\n" → watchdog closes /dev/watchdog safely
#   main.py hangs → 15s timeout → /dev/watchdog not fed → Pi reboots
# ══════════════════════════════════════════════════════════

import socket
import threading
import time
import os
import sys

# ── Config ─────────────────────────────────────────────────
HB_SOCKET         = "/tmp/watchdog.sock"
HB_TIMEOUT        = 15.0      # seconds without HB from main.py → stop feeding
WDT_FEED_INTERVAL = 5.0       # seconds between /dev/watchdog feeds
LOG_FILE          = "/tmp/watchdog.log"
LINUX_WDT_PATH    = "/dev/watchdog"

# ── State ──────────────────────────────────────────────────
STATE_IDLE    = "IDLE"
STATE_RUNNING = "RUNNING"
STATE_STOPPED = "STOPPED"

state             = STATE_IDLE
last_hb_from_main = 0.0
state_lock        = threading.Lock()
wdt_fd            = None


# ── Logger ─────────────────────────────────────────────────
def log(msg: str):
    ts   = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ── Linux hardware watchdog ─────────────────────────────────
def _open_wdt():
    global wdt_fd
    try:
        wdt_fd = open(LINUX_WDT_PATH, 'w')
        log(f"✓ /dev/watchdog opened")
    except Exception as e:
        log(f"⚠ Không mở được /dev/watchdog: {e} (bỏ qua)")
        wdt_fd = None


def _feed_wdt():
    if wdt_fd:
        try:
            wdt_fd.write('1')
            wdt_fd.flush()
        except Exception:
            pass


def _close_wdt_safe():
    if wdt_fd:
        try:
            wdt_fd.write('V')
            wdt_fd.flush()
            wdt_fd.close()
            log("✓ /dev/watchdog closed safely")
        except Exception:
            pass


# ══════════════════════════════════════════════════════════
# THREAD: Unix socket — receive signals from main.py
# ══════════════════════════════════════════════════════════
def socket_server():
    global state, last_hb_from_main

    if os.path.exists(HB_SOCKET):
        os.remove(HB_SOCKET)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(HB_SOCKET)
    server.listen(5)
    os.chmod(HB_SOCKET, 0o666)
    log(f"✓ Socket sẵn sàng: {HB_SOCKET}")

    while True:
        try:
            conn, _ = server.accept()
            data    = conn.recv(64).decode("utf-8", errors="replace").strip()
            conn.close()
            if not data:
                continue

            with state_lock:
                if data == "START":
                    state             = STATE_RUNNING
                    last_hb_from_main = time.time()
                    log("✓ Nhận START từ main.py → bắt đầu giám sát")

                elif data == "HB":
                    if state == STATE_RUNNING:
                        last_hb_from_main = time.time()

                elif data == "SHUTDOWN":
                    state = STATE_STOPPED
                    log("✓ Nhận SHUTDOWN từ main.py")
                    _close_wdt_safe()

        except Exception as e:
            log(f"Socket error: {e}")
            time.sleep(1)


# ══════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════
def main():
    log("=== Watchdog Pi khởi động ===")
    log(f"Socket  : {HB_SOCKET}")
    log(f"Timeout : {HB_TIMEOUT}s")

    _open_wdt()

    threading.Thread(target=socket_server, daemon=True).start()

    log("Trạng thái: IDLE — chờ START từ main.py")

    last_wdt_feed  = time.time()
    prev_state     = STATE_IDLE
    main_was_alive = True

    while True:
        now = time.time()

        with state_lock:
            current = state
            elapsed = now - last_hb_from_main if last_hb_from_main > 0 else 0

        if current != prev_state:
            log(f"Trạng thái: {prev_state} → {current}")
            prev_state = current

        if current == STATE_RUNNING:
            alive = elapsed < HB_TIMEOUT

            if alive and not main_was_alive:
                log("✓ main.py khôi phục")
            elif not alive and main_was_alive:
                log(f"⚠ main.py timeout {elapsed:.0f}s — dừng feed watchdog")
            main_was_alive = alive

            # Feed /dev/watchdog only while main.py is alive
            if alive and (now - last_wdt_feed >= WDT_FEED_INTERVAL):
                _feed_wdt()
                last_wdt_feed = now

        elif current == STATE_STOPPED:
            main_was_alive = True

        time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Watchdog dừng")
        _close_wdt_safe()
        if os.path.exists(HB_SOCKET):
            os.remove(HB_SOCKET)
        sys.exit(0)