# ══════════════════════════════════════════════════════════
# attendance/vision/recognizer.py
# Buffalo_l W600K face recognizer — ONNX trực tiếp, không qua FaceAnalysis.
# Output: 512-d L2-normalized embedding.
# ══════════════════════════════════════════════════════════

import os

import cv2
import numpy as np
import onnxruntime as ort

from ..config import ONNX_NUM_THREADS, FACE_MARGIN


class BuffaloRecognizer:
    """
    Face recognition dùng W600K (buffalo_l) qua ONNX.
    Load trực tiếp w600k_r50.onnx, không dùng FaceAnalysis ở runtime.

    get_embedding(face_bgr)      → 512-d ndarray (L2-normalized)
    extract_face_crop(frame, bbox) → BGR crop với margin
    """

    MODEL_PATH = os.path.expanduser(
        "~/.insightface/models/buffalo_l/w600k_r50.onnx")

    def __init__(self):
        self._ensure_model()

        opts = ort.SessionOptions()
        opts.intra_op_num_threads     = ONNX_NUM_THREADS
        opts.inter_op_num_threads     = ONNX_NUM_THREADS
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.execution_mode           = ort.ExecutionMode.ORT_PARALLEL

        self._session    = ort.InferenceSession(
            self.MODEL_PATH, opts,
            providers=["CPUExecutionProvider"])
        self._input_name = self._session.get_inputs()[0].name

        sz = os.path.getsize(self.MODEL_PATH) / 1e6
        print(f"  ✓ Buffalo_l W600K ready ({sz:.0f} MB) — 512-d embedding")

    def _ensure_model(self):
        """Download buffalo_l nếu chưa có bằng cách trigger FaceAnalysis một lần."""
        if os.path.exists(self.MODEL_PATH):
            return
        print("  Downloading buffalo_l W600K (174 MB)...")
        from insightface.app import FaceAnalysis
        _app = FaceAnalysis(name="buffalo_l",
                            providers=["CPUExecutionProvider"])
        _app.prepare(ctx_id=0, det_size=(320, 320))
        del _app
        if not os.path.exists(self.MODEL_PATH):
            raise FileNotFoundError(
                f"Không tìm thấy model sau khi download: {self.MODEL_PATH}")

    # ── Public ─────────────────────────────────────────────

    def get_embedding(self, face_bgr: np.ndarray) -> np.ndarray:
        """BGR crop (bất kỳ kích thước) → 512-d float32, L2-normalized."""
        img  = cv2.resize(face_bgr, (112, 112))
        img  = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32)
        img  = (img - 127.5) / 127.5
        inp  = img.transpose(2, 0, 1)[np.newaxis]          # (1, 3, 112, 112)
        emb  = self._session.run(None, {self._input_name: inp})[0][0]
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        return emb.astype(np.float32)

    def extract_face_crop(self, frame_bgr: np.ndarray,
                          bbox: tuple,
                          margin: float = FACE_MARGIN) -> np.ndarray:
        """
        Crop mặt từ frame với margin mở rộng.
        bbox = (x, y, w, h, ...) — chỉ dùng 4 phần tử đầu.
        """
        h, w   = frame_bgr.shape[:2]
        x, y, fw, fh = bbox[:4]
        mx, my = int(fw * margin), int(fh * margin)
        x1, y1 = max(0, x - mx),      max(0, y - my)
        x2, y2 = min(w, x + fw + mx), min(h, y + fh + my)
        crop   = frame_bgr[y1:y2, x1:x2]
        # Fallback nếu crop rỗng (bbox sát mép frame)
        if crop.size == 0:
            crop = frame_bgr[max(0, y):y + fh, max(0, x):x + fw]
        return crop
