# ══════════════════════════════════════════════════════════
# attendance/vision/database.py
# FaceDatabase: stores embeddings and searches by cosine similarity.
# Helpers: parse image filenames, load/save .npz, register ID photos.
# ══════════════════════════════════════════════════════════

import os

import cv2
import numpy as np

from ..config import STUDENTS_DIR, DB_FILE


# ──────────────────────────────────────────────────────────
# Helpers: parse filename & load ID photo info
# ──────────────────────────────────────────────────────────

def parse_student_filename(filename: str) -> dict:
    """
    "Nguyen_Van_Xuan_Thanh_1A2.jpg" →
      full_key   = "Nguyen_Van_Xuan_Thanh_1A2"
      full_name  = "Nguyen Van Xuan Thanh"
      class_name = "1A2"
      display    = "Thanh"   ← second-to-last part (short call name)
    """
    stem  = os.path.splitext(filename)[0]
    parts = stem.split("_")
    if len(parts) < 2:
        return {"full_key": stem, "full_name": stem,
                "class_name": "", "display": stem}
    return {
        "full_key":   stem,
        "full_name":  " ".join(parts[:-1]),
        "class_name": parts[-1],
        "display":    parts[-2],
    }


def load_key_info() -> dict:
    """Scan STUDENTS_DIR → dict[full_key → info_dict]."""
    key_info = {}
    if not os.path.isdir(STUDENTS_DIR):
        return key_info
    for fname in os.listdir(STUDENTS_DIR):
        if fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            info = parse_student_filename(fname)
            key_info[info["full_key"]] = info
    return key_info


# ──────────────────────────────────────────────────────────
# Helpers: cache .npz
# ──────────────────────────────────────────────────────────

def _load_npz() -> dict | None:
    if not os.path.exists(DB_FILE):
        return None
    data = np.load(DB_FILE, allow_pickle=True)
    return {name: emb for name, emb in zip(data["names"], data["embeddings"])}


def _save_npz(database: dict):
    np.savez(DB_FILE,
             names=list(database.keys()),
             embeddings=np.array(list(database.values())))
    print(f"  ✓ Đã cache embedding → {DB_FILE}")


# ──────────────────────────────────────────────────────────
# Helpers: register ID photos → embeddings
# ──────────────────────────────────────────────────────────

def _register_students(detector, recognizer, preprocessor,
                       key_info: dict) -> dict:
    """
    Read images in STUDENTS_DIR, detect + embed each one,
    average embeddings when a student has multiple photos (_2.jpg, _3.jpg...).
    Returns dict[full_key → avg_embedding].
    """
    if not key_info:
        print(f"  ⚠ Không có ảnh trong '{STUDENTS_DIR}/'")
        return {}

    groups: dict = {fk: [] for fk in key_info}

    for photo_file in sorted(os.listdir(STUDENTS_DIR)):
        if not photo_file.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue

        stem  = os.path.splitext(photo_file)[0]
        parts = stem.split("_")

        # Find matching full_key (primary photo or extra _2, _3, ...)
        if stem in groups:
            matched_key = stem
        elif parts[-1].isdigit():
            candidate = "_".join(parts[:-1])
            matched_key = candidate if candidate in groups else None
        else:
            matched_key = None

        if matched_key is None:
            continue

        photo_path = os.path.join(STUDENTS_DIR, photo_file)
        img_bgr    = cv2.imread(photo_path)
        if img_bgr is None:
            print(f"    ✗ Không đọc được: {photo_file}")
            continue

        img_proc = preprocessor.process_id_photo(img_bgr)
        faces    = detector.detect(img_proc)
        if not faces:
            faces    = detector.detect(img_bgr)     # fallback ảnh gốc
            img_proc = img_bgr
        if not faces:
            print(f"    ✗ {photo_file} — không tìm thấy mặt, bỏ qua")
            continue

        best = max(faces, key=lambda f: f[2] * f[3])
        crop = recognizer.extract_face_crop(img_proc, best)
        emb  = recognizer.get_embedding(crop)
        groups[matched_key].append((emb, best[4], photo_file))

    # Compute average embedding
    database   = {}
    n_students = sum(1 for g in groups.values() if g)
    print(f"  Đăng ký {n_students} học sinh...")

    for full_key, emb_list in groups.items():
        info = key_info[full_key]
        if not emb_list:
            print(f"    ✗ {info['full_name']} — không có ảnh hợp lệ!")
            continue

        embs    = np.array([e for e, _, _ in emb_list], dtype=np.float32)
        avg_emb = embs.mean(axis=0)
        norm    = np.linalg.norm(avg_emb)
        if norm > 0:
            avg_emb /= norm

        database[full_key] = avg_emb

        avg_det   = np.mean([s for _, s, _ in emb_list])
        files_str = ", ".join(f for _, _, f in emb_list)
        print(f"    ✓ {info['full_name']} | lớp {info['class_name']} "
              f"| {len(emb_list)} ảnh (det avg:{avg_det:.2f})")
        if len(emb_list) > 1:
            print(f"      → {files_str}")

    return database


# ──────────────────────────────────────────────────────────
# CLASS: FaceDatabase
# ──────────────────────────────────────────────────────────

class FaceDatabase:
    """
    Stores 512-d embeddings and searches by dot product
    (equivalent to cosine since embeddings are L2-normalised).

    identify(emb)        → (full_key, score)
    identify_batch(embs) → list of (full_key, score)
    """

    def __init__(self, database_dict: dict):
        if database_dict:
            self.keys       = list(database_dict.keys())
            self.embeddings = np.array(list(database_dict.values()),
                                       dtype=np.float32)
        else:
            self.keys       = []
            self.embeddings = np.empty((0, 512), dtype=np.float32)

    @property
    def count(self) -> int:
        return len(self.keys)

    def identify(self, emb: np.ndarray) -> tuple:
        """Return (full_key, score) of the nearest embedding."""
        if not self.keys:
            return (None, 0.0)
        scores   = self.embeddings @ emb
        best_idx = int(np.argmax(scores))
        return (self.keys[best_idx], float(scores[best_idx]))

    def identify_batch(self, embeddings_list: list) -> list:
        """Batch identify — return list of (full_key, score)."""
        if not self.keys or not embeddings_list:
            return [(None, 0.0)] * len(embeddings_list)
        embs     = np.array(embeddings_list, dtype=np.float32)   # (M, 512)
        scores   = embs @ self.embeddings.T                       # (M, N)
        best_idx = np.argmax(scores, axis=1)
        return [(self.keys[i], float(scores[j, i]))
                for j, i in enumerate(best_idx)]

    @staticmethod
    def load(detector, recognizer, preprocessor) -> "FaceDatabase":
        """
        Load from .npz cache if present and still in sync with current ID photos.
        Otherwise re-register from images and save a fresh cache.
        """
        key_info     = load_key_info()
        current_keys = set(key_info.keys())
        db_dict      = _load_npz()

        if db_dict is not None and set(db_dict.keys()) != current_keys:
            print("  ⚠ Cache lỗi thời → đăng ký lại...")
            os.remove(DB_FILE)
            db_dict = None

        if db_dict is not None:
            print(f"  ✓ Load {len(db_dict)} học sinh từ cache.")
        else:
            db_dict = _register_students(detector, recognizer,
                                         preprocessor, key_info)
            if db_dict:
                _save_npz(db_dict)

        return FaceDatabase(db_dict or {})
