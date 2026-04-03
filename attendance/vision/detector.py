# ══════════════════════════════════════════════════════════
# attendance/vision/detector.py
# YuNet face detector wrapper.
# ══════════════════════════════════════════════════════════

import os
import urllib.request

import cv2

from ..config import (
    CAMERA_WIDTH, CAMERA_HEIGHT,
    YUNET_PATH, YUNET_URL,
    SCORE_THRESH, NMS_THRESH,
)


class YuNetDetector:
    """
    Wrapper cho cv2.FaceDetectorYN (YuNet).
    detect() → list of (x, y, w, h, confidence).
    """

    def __init__(self,
                 model_path: str = YUNET_PATH,
                 input_size: tuple = (CAMERA_WIDTH, CAMERA_HEIGHT)):
        if not os.path.exists(model_path):
            print("  Downloading YuNet detector...")
            urllib.request.urlretrieve(YUNET_URL, model_path)
            print(f"  ✓ Saved {model_path} "
                  f"({os.path.getsize(model_path) / 1e3:.0f} KB)")

        self._detector = cv2.FaceDetectorYN.create(
            model_path, "", input_size,
            score_threshold=SCORE_THRESH,
            nms_threshold=NMS_THRESH,
            top_k=10,
        )
        print(f"  ✓ YuNet ready "
              f"({os.path.getsize(model_path) / 1e3:.0f} KB)")

    def detect(self, frame_bgr) -> list[tuple]:
        """
        Nhận frame BGR, trả về list of (x, y, w, h, confidence).
        Input size tự điều chỉnh theo frame thực tế.
        """
        h, w = frame_bgr.shape[:2]
        self._detector.setInputSize((w, h))
        _, faces = self._detector.detect(frame_bgr)
        if faces is None:
            return []
        return [
            (int(f[0]), int(f[1]), int(f[2]), int(f[3]), float(f[14]))
            for f in faces
        ]
