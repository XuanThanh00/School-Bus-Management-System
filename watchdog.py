#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════
# watchdog.py — Chạy độc lập trên Pi 5 qua systemd
#
# Flow:
#   Pi boot → watchdog.py start → IDLE (chờ)
#   main.py start → gửi "START\n" → watchdog relay START → STM32 bắt đầu đếm
#   main.py gửi "HB\n" mỗi 3s → watchdog relay HB → STM32 reset timer
#   main.py tắt → gửi "SHUTDOWN\n" → watchdog relay SHUTDOWN → STM32 dừng đếm
#   main.py treo → timeout 15s → ngừng relay → STM32 timeout → gửi REBOOT
# ══════════════════════════════════════════════════════════

import socket
import serial
import threading
import subprocess
import time
import os
import sys

# ── Config ─────────────────────────────────────────────────
HB_SOCKET    = "/tmp/watchdog.sock"
UART_PORT    = "/dev/ttyAMA2"
UART_BAUD    = 9600
HB_TIMEOUT   = 15.0
HB_RELAY_INT = 3.0
LOG_FILE     = "/tmp/watchdog.log"

# ── Trạng thái ─────────────────────────────────────────────
STATE_IDLE    = "IDLE"
STATE_RUNNING = "RUNNING"
STATE_STOPPED = "STOPPED"

# ── Shared state ───────────────────────────────────────────
state             = STATE_IDLE
last_hb_from_main = 0.0
state_lock        = threading.Lock()
ser_global        = None   # UART handle dùng chung


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


def uart_write(msg: str):
    """Gửi message qua UART sang STM32."""
    global ser_global
    if ser_global:
        try:
            ser_global.write(msg.encode())
        except Exception as e:
            log(f"UART write error: {e}")


# ══════════════════════════════════════════════════════════
# THREAD 1: Unix socket server — nhận tín hiệu từ main.py
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
                    # Relay START sang STM32 để STM32 bắt đầu đếm
                    uart_write("START\n")

                elif data == "HB":
                    if state == STATE_RUNNING:
                        last_hb_from_main = time.time()
                        # HB được relay trong relay loop

                elif data == "SHUTDOWN":
                    state = STATE_STOPPED
                    log("✓ Nhận SHUTDOWN từ main.py → dừng giám sát")
                    # Relay SHUTDOWN sang STM32 để STM32 dừng đếm
                    uart_write("SHUTDOWN\n")

        except Exception as e:
            log(f"Socket error: {e}")
            time.sleep(1)


# ══════════════════════════════════════════════════════════
# THREAD 2: UART reader — nhận lệnh từ STM32
# ══════════════════════════════════════════════════════════
def uart_reader(ser: serial.Serial):
    buf = b""
    while True:
        try:
            byte = ser.read(1)
            if not byte:
                continue
            buf += byte
            if b"\n" in buf:
                line = buf.split(b"\n")[0].decode("utf-8", errors="replace").strip()
                buf  = b"".join(buf.split(b"\n")[1:])
                if line:
                    log(f"STM32 → '{line}'")
                    with state_lock:
                        current = state
                    if line == "REBOOT":
                        if current == STATE_RUNNING:
                            do_reboot()
                        else:
                            log(f"  Bỏ qua REBOOT — state={current}")
                    elif line == "START_ACK":
                        log("✓ STM32 xác nhận đã nhận START")
                    elif line == "SHUTDOWN_ACK":
                        log("✓ STM32 xác nhận đã nhận SHUTDOWN")
        except Exception as e:
            log(f"UART read error: {e}")
            time.sleep(1)


# ══════════════════════════════════════════════════════════
# REBOOT
# ══════════════════════════════════════════════════════════
def do_reboot():
    global state
    log("!!! REBOOT từ STM32 → reboot Pi...")
    # Gửi ACK cho STM32 biết Pi đã nhận lệnh
    uart_write("REBOOT_ACK\n")
    time.sleep(1)
    try:
        subprocess.run(["sudo", "reboot"], check=False)
    except Exception as e:
        log(f"Lỗi reboot: {e}")
        os.system("sudo reboot")


# ══════════════════════════════════════════════════════════
# MAIN — relay loop
# ══════════════════════════════════════════════════════════
def main():
    global ser_global

    log("=== Watchdog Pi khởi động ===")
    log(f"Socket   : {HB_SOCKET}")
    log(f"UART     : {UART_PORT} @ {UART_BAUD}")
    log(f"Timeout  : {HB_TIMEOUT}s")
    log(f"Trạng thái: IDLE — chờ START từ main.py")

    # Kết nối UART
    while ser_global is None:
        try:
            ser_global = serial.Serial(UART_PORT, UART_BAUD, timeout=1.0)
            log(f"✓ UART {UART_PORT} OK")
        except Exception as e:
            log(f"⚠ UART lỗi: {e} — thử lại 5s")
            time.sleep(5)

    # Khởi động threads
    t_sock = threading.Thread(target=socket_server, daemon=True)
    t_uart = threading.Thread(target=uart_reader, args=(ser_global,), daemon=True)
    t_sock.start()
    t_uart.start()

    # Relay loop
    last_relay    = 0.0
    prev_state    = STATE_IDLE
    main_was_alive = True

    while True:
        now = time.time()

        with state_lock:
            current_state = state
            elapsed       = now - last_hb_from_main if last_hb_from_main > 0 else 0

        # Log khi state thay đổi
        if current_state != prev_state:
            log(f"Trạng thái: {prev_state} → {current_state}")
            prev_state = current_state

        if current_state == STATE_RUNNING:
            alive = elapsed < HB_TIMEOUT

            if alive and not main_was_alive:
                log("✓ main.py khôi phục")
            elif not alive and main_was_alive:
                log(f"⚠ main.py timeout {elapsed:.0f}s — ngừng relay")
            main_was_alive = alive

            # Relay HB sang STM32
            if alive and (now - last_relay >= HB_RELAY_INT):
                uart_write("HB\n")
                last_relay = now

        elif current_state == STATE_STOPPED:
            main_was_alive = True

        time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Watchdog dừng")
        if os.path.exists(HB_SOCKET):
            os.remove(HB_SOCKET)
        sys.exit(0)