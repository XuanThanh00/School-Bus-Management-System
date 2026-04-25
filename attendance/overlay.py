# ══════════════════════════════════════════════════════════
# attendance/overlay.py
# Draw annotations on camera feed: bounding boxes, score bar,
# master key banner, RFID toast.
# ══════════════════════════════════════════════════════════

import time

import cv2
import numpy as np

from .config import CAMERA_WIDTH, THRESHOLD


def draw_frame(
    frame_bgr:          np.ndarray,
    last_results:       list,
    key_info:           dict,
    confirmed_set:      set,
    master_mode:        bool    = False,
    master_until:       float   = 0.0,
    rfid_display_name:  str     = "",
    rfid_display_until: float   = 0.0,
) -> np.ndarray:
    """
    Draw annotations on a BGR frame and return a new frame (not in-place).

    Bounding box colors:
      green (0, 220, 80)   — checked in
      blue  (55, 138, 221) — recognized, waiting for RFID
      dark  (60, 60, 200)  — not recognized

    Parameters
    ----------
    last_results       : list of {bbox, conf, full_key, score}
    key_info           : dict[full_key → {full_name, class_name, display}]
    confirmed_set      : set of (full_name, class_name) already checked in
    master_mode        : whether master key mode is active
    master_until       : expiry timestamp for master mode
    rfid_display_name  : RFID toast text shown in the frame corner
    rfid_display_until : expiry timestamp for the toast
    """
    out = frame_bgr.copy()

    # ── Bounding boxes ─────────────────────────────────────
    for result in last_results:
        x, y, w, h = result["bbox"]
        full_key   = result.get("full_key")
        score      = result.get("score", 0.0)
        info       = key_info.get(full_key) if full_key else None
        name       = info["display"] if info else "?"

        face_key = (info["full_name"], info["class_name"]) if info else None
        if face_key and face_key in confirmed_set:
            color = (0, 220, 80)
            label = f"{name} OK"
        elif score >= THRESHOLD:
            color = (55, 138, 221)
            label = f"{name} {score:.2f}"
        else:
            color = (60, 60, 200)
            label = f"? {score:.2f}"

        # Box
        cv2.rectangle(out, (x, y), (x + w, y + h), color, 2)

        # Label with background fill
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(out, (x, y - th - 8), (x + tw + 6, y), color, -1)
        cv2.putText(out, label, (x + 3, y - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        # Score bar
        fill = int(w * min(score, 1.0))
        cv2.rectangle(out, (x, y + h + 2), (x + w, y + h + 6), (40, 40, 40), -1)
        cv2.rectangle(out, (x, y + h + 2), (x + fill, y + h + 6), color, -1)

    # ── Master key banner ──────────────────────────────────
    if master_mode:
        sec = max(0, int(master_until - time.time()))
        cv2.rectangle(out, (0, 0), (out.shape[1], 34), (0, 140, 60), -1)
        cv2.putText(out, f"[MASTER KEY] NHIN VAO CAMERA... {sec}s",
                    (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    # ── RFID toast ─────────────────────────────────────────
    if rfid_display_name and time.time() < rfid_display_until:
        text = rfid_display_name
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        tx = CAMERA_WIDTH - tw - 10
        ty = 80
        cv2.rectangle(out, (tx - 6, ty - th - 6), (tx + tw + 6, ty + 6),
                      (0, 0, 0), -1)
        cv2.putText(out, text, (tx, ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 200), 2)

    return out
