"""
attendance/stm32_protocol.py

Giao tiếp UART giữa Raspberry Pi 5 và STM32F103C8T6.
Packet format: [0xAA][LEN][CMD][PAYLOAD 0..15B][CRC8]
CRC8 = XOR(LEN, CMD, payload bytes)

Chạy độc lập để test handshake:
    python -m attendance.stm32_protocol
"""

import serial
import threading
import time
import struct
import logging
import gpiod                          # gpiod thay RPi.GPIO trên Pi 5

logger = logging.getLogger(__name__)

# ── CMD constants ────────────────────────────────────────────
# STM32 → Pi
CMD_RFID_UID    = 0x01
CMD_GPS_DATA    = 0x02
CMD_HB_STM32    = 0x05
CMD_GPS_NO_FIX  = 0x06
CMD_READY       = 0x09

# Pi → STM32
CMD_PLAY_AUDIO  = 0x03
CMD_ACK         = 0x04
CMD_REQUEST_GPS = 0x07
CMD_SET_VOLUME  = 0x08
CMD_HB_PI       = 0x0A
CMD_SHUTDOWN    = 0x0B

# HB_STM32 status_flags bitmask
FLAG_RFID_OK      = 1 << 0
FLAG_GPS_FIX      = 1 << 1
FLAG_MP3_OK       = 1 << 2
FLAG_IWDG_RUNNING = 1 << 3

# Parse states
_S_STX     = 0
_S_LEN     = 1
_S_CMD     = 2
_S_PAYLOAD = 3
_S_CRC     = 4

_STX           = 0xAA
_MAX_PAYLOAD   = 15


class STM32Protocol:
    """
    Quản lý toàn bộ giao tiếp UART với STM32.

    Callbacks (set sau khi khởi tạo hoặc truyền vào constructor):
        on_rfid(uid_hex: str)                        — nhận UID thẻ, vd "FF8E4C1E"
        on_gps(lat: float, lon: float, speed: float)  — nhận tọa độ + tốc độ GPS
        on_gps_no_fix(sat_count: int)                 — GPS chưa có fix
        on_hb_stm32(flags: int)                       — heartbeat STM32
        on_ready()                                    — STM32 init xong, gửi ACK
        on_ack(cmd_acked: int)                        — STM32 ACK lệnh của Pi

    Thread: RX chạy trong daemon thread riêng, TX dùng lock.
    """

    def __init__(self,
                 port: str,
                 baud: int = 115200,
                 reset_gpio: int | None = None,
                 on_rfid=None,
                 on_gps=None,
                 on_gps_no_fix=None,
                 on_hb_stm32=None,
                 on_ready=None,
                 on_ack=None):

        self._port       = port
        self._baud       = baud
        self._reset_gpio = reset_gpio   # GPIO Pi → NRST STM32 (None = chưa nối)

        # Callbacks
        self.on_rfid       = on_rfid
        self.on_gps        = on_gps
        self.on_gps_no_fix = on_gps_no_fix
        self.on_hb_stm32   = on_hb_stm32
        self.on_ready      = on_ready
        self.on_ack        = on_ack

        # Serial + thread
        self._ser      = None
        self._running  = False
        self._rx_thread = None
        self._tx_lock  = threading.Lock()

        # Parse state machine
        self._state       = _S_STX
        self._pkt_len     = 0
        self._pkt_cmd     = 0
        self._pkt_payload = bytearray()
        self._pkt_crc     = 0

        # Stats
        self.pkts_rx_ok  = 0
        self.pkts_rx_err = 0
        self.pkts_tx     = 0

        # GPIO cho reset STM32
        self._gpio_chip = None
        self._gpio_line = None
        self._last_reset_time = 0.0

    # ── PUBLIC: open / close ──────────────────────────────────

    def open(self):
        """Mở serial port và bắt đầu RX thread."""
        self._ser = serial.Serial(
            port=self._port,
            baudrate=self._baud,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=1.0,
        )
        # Setup GPIO reset nếu có
        if self._reset_gpio is not None:
            try:
                self._gpio_chip = gpiod.Chip('gpiochip4')   # Pi 5 dùng gpiochip4
                self._gpio_line = self._gpio_chip.get_line(self._reset_gpio)
                self._gpio_line.request(
                    consumer='stm32_reset',
                    type=gpiod.LINE_REQ_DIR_OUT,
                    default_vals=[1]   # HIGH = không reset
                )
                logger.info(f"GPIO{self._reset_gpio} ready for STM32 reset")
            except Exception as e:
                logger.warning(f"GPIO reset setup failed: {e} — reset disabled")
                self._gpio_line = None

        self._running = True
        self._rx_thread = threading.Thread(
            target=self._rx_loop,
            name="stm32-rx",
            daemon=True
        )
        self._rx_thread.start()
        logger.info(f"STM32Protocol opened on {self._port} @ {self._baud}")

    def close(self):
        """Dừng RX thread và đóng serial."""
        self._running = False
        if self._rx_thread:
            self._rx_thread.join(timeout=2.0)
        if self._ser and self._ser.is_open:
            self._ser.close()
        if self._gpio_line:
            self._gpio_line.release()
        if self._gpio_chip:
            self._gpio_chip.close()
        logger.info("STM32Protocol closed")

    # ── PUBLIC: Pi → STM32 send commands ─────────────────────

    def send_ack(self, cmd_acked: int):
        self._send(CMD_ACK, bytes([cmd_acked]))

    def send_hb_pi(self):
        self._send(CMD_HB_PI, b'')

    def send_play_audio(self, track: int):
        self._send(CMD_PLAY_AUDIO, bytes([track]))
        logger.debug(f"→ PLAY_AUDIO track={track}")

    def send_set_volume(self, vol: int):
        vol = max(0, min(30, vol))
        self._send(CMD_SET_VOLUME, bytes([vol]))

    def send_request_gps(self):
        self._send(CMD_REQUEST_GPS, b'')

    def send_shutdown(self):
        self._send(CMD_SHUTDOWN, b'')
        logger.info("→ SHUTDOWN sent to STM32")

    def reset_stm32(self):
        """Kéo NRST STM32 xuống GND 100ms để hard reset."""
        if self._gpio_line is None:
            logger.warning("reset_stm32: GPIO not configured")
            return
        now = time.time()
        if now - self._last_reset_time < 10.0:    # cooldown 10s
            logger.warning("reset_stm32: cooldown active, skipped")
            return
        self._last_reset_time = now
        logger.warning("STM32 hard reset triggered via GPIO")
        self._gpio_line.set_value(0)
        time.sleep(0.1)
        self._gpio_line.set_value(1)

    # ── INTERNAL: build & send packet ────────────────────────

    @staticmethod
    def _crc8(plen: int, cmd: int, payload: bytes) -> int:
        crc = plen ^ cmd
        for b in payload:
            crc ^= b
        return crc & 0xFF

    def _send(self, cmd: int, payload: bytes):
        plen = len(payload)
        if plen > _MAX_PAYLOAD:
            logger.error(f"_send: payload too long ({plen})")
            return
        crc = self._crc8(plen, cmd, payload)
        frame = bytes([_STX, plen, cmd]) + payload + bytes([crc])
        with self._tx_lock:
            try:
                self._ser.write(frame)
                self.pkts_tx += 1
            except serial.SerialException as e:
                logger.error(f"UART write error: {e}")

    # ── INTERNAL: RX thread ───────────────────────────────────

    def _rx_loop(self):
        logger.debug("RX thread started")
        while self._running:
            try:
                data = self._ser.read(64)   # non-blocking với timeout=1s
                for b in data:
                    self._process_byte(b)
            except serial.SerialException as e:
                logger.error(f"UART read error: {e}")
                time.sleep(0.5)
        logger.debug("RX thread stopped")

    def _process_byte(self, b: int):
        if self._state == _S_STX:
            if b == _STX:
                self._state       = _S_LEN
                self._pkt_crc     = 0
                self._pkt_payload = bytearray()

        elif self._state == _S_LEN:
            if b > _MAX_PAYLOAD:
                logger.debug(f"Bad LEN={b}, reset parser")
                self._state = _S_STX
                self.pkts_rx_err += 1
                return
            self._pkt_len = b
            self._pkt_crc = b           # CRC bắt đầu với LEN
            self._state   = _S_CMD

        elif self._state == _S_CMD:
            self._pkt_cmd  = b
            self._pkt_crc ^= b
            if self._pkt_len == 0:
                self._state = _S_CRC
            else:
                self._state = _S_PAYLOAD

        elif self._state == _S_PAYLOAD:
            self._pkt_payload.append(b)
            self._pkt_crc ^= b
            if len(self._pkt_payload) >= self._pkt_len:
                self._state = _S_CRC

        elif self._state == _S_CRC:
            if b == self._pkt_crc:
                self.pkts_rx_ok += 1
                self._dispatch(self._pkt_cmd, bytes(self._pkt_payload))
            else:
                logger.warning(
                    f"CRC error cmd=0x{self._pkt_cmd:02X} "
                    f"got=0x{b:02X} expected=0x{self._pkt_crc:02X}"
                )
                self.pkts_rx_err += 1
            self._state = _S_STX

    def _dispatch(self, cmd: int, payload: bytes):
        try:
            if cmd == CMD_RFID_UID:
                if len(payload) >= 4 and self.on_rfid:
                    uid_hex = payload[:4].hex().upper()
                    logger.info(f"← RFID_UID: {uid_hex}")
                    self.on_rfid(uid_hex)
                    self.send_ack(CMD_RFID_UID)

            elif cmd == CMD_GPS_DATA:
                if len(payload) >= 12:
                    # Format mới: lat + lon + speed_kmh (3 floats LE)
                    lat, lon, speed = struct.unpack_from('<fff', payload, 0)
                    logger.info(f"← GPS_DATA: {lat:.6f}, {lon:.6f}, {speed:.1f} km/h")
                    if self.on_gps:
                        self.on_gps(lat, lon, speed)
                elif len(payload) >= 8:
                    # Legacy 8B (firmware cũ, backward compat)
                    lat, lon = struct.unpack_from('<ff', payload, 0)
                    logger.info(f"← GPS_DATA (legacy): {lat:.6f}, {lon:.6f}")
                    if self.on_gps:
                        self.on_gps(lat, lon, 0.0)
                self.send_ack(CMD_GPS_DATA)

            elif cmd == CMD_GPS_NO_FIX:
                sat = payload[0] if payload else 0
                logger.info(f"← GPS_NO_FIX: sat={sat}")
                if self.on_gps_no_fix:
                    self.on_gps_no_fix(sat)
                self.send_ack(CMD_GPS_NO_FIX)

            elif cmd == CMD_HB_STM32:
                flags = payload[0] if payload else 0
                logger.debug(f"← HB_STM32: flags=0b{flags:08b}")
                if self.on_hb_stm32:
                    self.on_hb_stm32(flags)
                # Không ACK HB để tránh spam

            elif cmd == CMD_READY:
                logger.info("← READY from STM32")
                self.send_ack(CMD_READY)
                if self.on_ready:
                    self.on_ready()

            elif cmd == CMD_ACK:
                cmd_acked = payload[0] if payload else 0
                logger.debug(f"← ACK for 0x{cmd_acked:02X}")
                if self.on_ack:
                    self.on_ack(cmd_acked)

            else:
                logger.warning(f"← Unknown CMD: 0x{cmd:02X}")

        except Exception as e:
            logger.error(f"Dispatch error cmd=0x{cmd:02X}: {e}", exc_info=True)


# ── STANDALONE TEST ───────────────────────────────────────────
# Chạy: python -m attendance.stm32_protocol
# Mục đích: test handshake + HB 2 chiều, không cần camera/core.py

if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    PORT = "/dev/ttyAMA2"
    if len(sys.argv) > 1:
        PORT = sys.argv[1]

    # Tracking state
    handshake_done = threading.Event()
    last_hb_stm32  = [0.0]   # dùng list để mutate trong closure

    def on_ready():
        print("✓ STM32 READY — handshake starting")

    def on_hb_stm32(flags):
        last_hb_stm32[0] = time.time()
        rfid_ok = bool(flags & FLAG_RFID_OK)
        gps_fix = bool(flags & FLAG_GPS_FIX)
        mp3_ok  = bool(flags & FLAG_MP3_OK)
        iwdg    = bool(flags & FLAG_IWDG_RUNNING)
        print(f"  HB_STM32: RFID={'OK' if rfid_ok else '--'} "
              f"GPS={'FIX' if gps_fix else 'NO'} "
              f"MP3={'OK' if mp3_ok else '--'} "
              f"IWDG={'ON' if iwdg else 'off'}")
        if not handshake_done.is_set():
            handshake_done.set()
            print("✓ Handshake COMPLETE — system RUNNING")

    def on_rfid(uid_hex):
        print(f"  RFID: {uid_hex}")

    def on_gps(lat, lon):
        print(f"  GPS: {lat:.6f}, {lon:.6f}")

    def on_gps_no_fix(sat):
        print(f"  GPS_NO_FIX: sat={sat}")

    proto = STM32Protocol(
        port=PORT,
        baud=115200,
        on_ready=on_ready,
        on_hb_stm32=on_hb_stm32,
        on_rfid=on_rfid,
        on_gps=on_gps,
        on_gps_no_fix=on_gps_no_fix,
    )

    print(f"Opening {PORT} ...")
    proto.open()
    print("Waiting for STM32 READY (up to 30s)...")

    # Gửi HB_PI định kỳ
    def hb_loop():
        while True:
            time.sleep(5)
            proto.send_hb_pi()
            logger.debug("→ HB_PI sent")

    threading.Thread(target=hb_loop, daemon=True).start()

    try:
        while True:
            time.sleep(1)
            # Cảnh báo nếu STM32 im lặng quá 15s
            if handshake_done.is_set():
                silent = time.time() - last_hb_stm32[0]
                if silent > 15:
                    print(f"  WARNING: STM32 silent for {silent:.0f}s")
    except KeyboardInterrupt:
        print("\nShutting down...")
        proto.send_shutdown()
        time.sleep(0.5)
        proto.close()
        print(f"Stats: rx_ok={proto.pkts_rx_ok} rx_err={proto.pkts_rx_err} tx={proto.pkts_tx}")
