# ══════════════════════════════════════════════════════════
# attendance/audio.py
# Driver cho module MP3-TF-16P qua UART
# Pi chân 12 (GPIO18) = RX ← TX module
# Pi chân 16 (GPIO23) = TX → RX module
# ══════════════════════════════════════════════════════════

import serial
import time
import threading


# ── Track mapping ──────────────────────────────────────────
TRACK_INVITE_SCAN    = 1   # 0001.mp3 — Mời quét thẻ
TRACK_SCAN_OK        = 2   # 0002.mp3 — Quét thẻ thành công, mời xác thực mặt
TRACK_SCAN_INVALID   = 3   # 0003.mp3 — Thẻ không hợp lệ, báo tài xế
TRACK_FACE_START     = 4   # 0004.mp3 — Vui lòng đứng thẳng và nhìn vào màn hình
TRACK_AUTH_OK        = 5   # 0005.mp3 — Nhận diện thành công, điểm danh đã được ghi nhận
TRACK_FACE_MISMATCH  = 6   # 0006.mp3 — Không nhận diện được khuôn mặt, vui lòng thử lại

# ── UART config ────────────────────────────────────────────
UART_PORT    = "/dev/ttyAMA4"   # Pi 5: UART0 → chân 12/16
UART_BAUD    = 9600
DEFAULT_VOL  = 25               # 0–30


class MP3Player:
    """
    Driver đơn giản cho MP3-TF-16P qua UART.
    Mọi lệnh gửi trên thread riêng để không block main loop.
    """

    def __init__(self, port: str = UART_PORT, volume: int = DEFAULT_VOL):
        self._port   = port
        self._volume = volume
        self._serial = None
        self._lock   = threading.Lock()
        self._ready  = False
        self._connect()

    def _connect(self):
        try:
            self._serial = serial.Serial(
                port=self._port,
                baudrate=UART_BAUD,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=1,
            )
            time.sleep(0.5)   # chờ module khởi động
            self._send_cmd(0x06, self._volume)   # set volume
            time.sleep(0.2)
            self._ready = True
            print(f"  ✓ MP3 player sẵn sàng (volume={self._volume})")
        except Exception as e:
            print(f"  ⚠ Không kết nối được MP3 player: {e}")
            self._ready = False

    def _build_packet(self, cmd: int, param: int = 0) -> bytes:
        """
        Packet 10 bytes:
        7E FF 06 CMD 00 PAR_H PAR_L CHK_H CHK_L EF
        Checksum = -(0xFF + 0x06 + CMD + 0x00 + PAR_H + PAR_L)
        """
        par_h = (param >> 8) & 0xFF
        par_l = param & 0xFF
        chk   = (-(0xFF + 0x06 + cmd + 0x00 + par_h + par_l)) & 0xFFFF
        return bytes([
            0x7E, 0xFF, 0x06, cmd, 0x00,
            par_h, par_l,
            (chk >> 8) & 0xFF, chk & 0xFF,
            0xEF,
        ])

    def _send_cmd(self, cmd: int, param: int = 0):
        if self._serial and self._serial.is_open:
            with self._lock:
                self._serial.write(self._build_packet(cmd, param))

    def play(self, track: int):
        """Phát track theo số (1-based). Non-blocking."""
        if not self._ready:
            return
        threading.Thread(
            target=self._send_cmd,
            args=(0x03, track),
            daemon=True,
        ).start()

    def set_volume(self, volume: int):
        """Chỉnh âm lượng 0–30."""
        self._volume = max(0, min(30, volume))
        if self._ready:
            self._send_cmd(0x06, self._volume)

    def stop(self):
        if self._serial and self._serial.is_open:
            self._send_cmd(0x16)   # stop
            self._serial.close()