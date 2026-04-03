# ══════════════════════════════════════════════════════════
# attendance/vision/preprocessor.py
# Tiền xử lý ảnh để thu hẹp quality gap giữa ảnh thẻ và live camera.
# ══════════════════════════════════════════════════════════

import cv2
import numpy as np


class ImagePreprocessor:
    """
    Hai chiều xử lý bù trừ lẫn nhau:
      process_id_photo   : ảnh thẻ sắc nét → blur nhẹ + normalize brightness
                           (kéo embedding ảnh thẻ gần với embedding camera)
      process_live_frame : frame camera mờ → CLAHE + bilateral + normalize
                           (enhance lên gần với chất lượng ảnh thẻ)
    """

    def __init__(self,
                 clip_limit:        float = 3.0,
                 tile_size:         tuple = (8, 8),
                 target_brightness: float = 130.0):
        self._clahe             = cv2.createCLAHE(clipLimit=clip_limit,
                                                   tileGridSize=tile_size)
        self._target_brightness = target_brightness

    # ── Internal ───────────────────────────────────────────

    def _normalize_brightness(self, l_channel: np.ndarray) -> np.ndarray:
        mean = np.mean(l_channel)
        if mean > 0:
            l_channel = np.clip(
                l_channel * (self._target_brightness / mean), 0, 255
            ).astype(np.uint8)
        return l_channel

    # ── Public ─────────────────────────────────────────────

    def process_id_photo(self, img_bgr: np.ndarray) -> np.ndarray:
        """Ảnh thẻ BGR → normalize brightness + Gaussian blur nhẹ."""
        lab       = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
        l, a, b   = cv2.split(lab)
        l         = self._normalize_brightness(l)
        out       = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
        return cv2.GaussianBlur(out, (3, 3), 0.5)

    def process_live_frame(self, frame_bgr: np.ndarray) -> np.ndarray:
        """Frame live BGR → bilateral + CLAHE + normalize brightness."""
        filtered  = cv2.bilateralFilter(frame_bgr, d=5,
                                        sigmaColor=50, sigmaSpace=50)
        lab       = cv2.cvtColor(filtered, cv2.COLOR_BGR2LAB)
        l, a, b   = cv2.split(lab)
        l         = self._clahe.apply(l)
        l         = self._normalize_brightness(l)
        return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
