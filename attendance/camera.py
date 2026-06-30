# ══════════════════════════════════════════════════════════
# attendance/camera.py
# ══════════════════════════════════════════════════════════

import threading

import cv2
import numpy as np
from picamera2 import Picamera2


class CameraThread:
    """Continuously capture BGR frames from Picamera2 in a background thread."""

    def __init__(self, picam2: Picamera2):
        self._picam2    = picam2
        self._frame     = None
        self._lock      = threading.Lock()
        self._new_frame = threading.Event()
        self._running   = True
        self._thread    = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        while self._running:
            f = self._picam2.capture_array()
            with self._lock:
                self._frame = np.ascontiguousarray(f)
            self._new_frame.set()

    def get_frame(self, timeout: float = 0.1) -> np.ndarray | None:
        """Block until a new frame is available, then return it."""
        self._new_frame.wait(timeout=timeout)
        self._new_frame.clear()
        with self._lock:
            return self._frame.copy() if self._frame is not None else None

    def stop(self):
        self._running = False
        self._thread.join(timeout=2)
