import os
import time
import base64
import cv2
import threading
import firebase_admin
from firebase_admin import credentials, firestore, db as rt_db_module

class CloudSync:
    def __init__(self, service_account_path: str, database_url: str):
        self.service_account_path = service_account_path
        self.database_url = database_url
        self.fs_db = None
        self.rt_db = None
        self.initialized = False

        self._init_firebase()

    def _init_firebase(self):
        try:
            if not os.path.exists(self.service_account_path):
                print(f"  [CLOUD] ERROR: {self.service_account_path} not found!")
                print("  => Download the Private Key from Firebase Console > Service Accounts")
                return

            cred = credentials.Certificate(self.service_account_path)
            # Only initialize once per process
            if not firebase_admin._apps:
                firebase_admin.initialize_app(cred, {'databaseURL': self.database_url})

            self.fs_db = firestore.client()
            self.rt_db = rt_db_module
            self.initialized = True
            print("  [CLOUD] ✓ Firebase Admin SDK connected (Firestore + RealtimeDB)")
        except Exception as e:
            print(f"  [CLOUD] Firebase init failed: {e}")

    # ── Firestore ──────────────────────────────────────────

    def sync_students_to_pi(self, reference_dir: str,
                            existing_students: list = None) -> tuple[list, bool]:
        """
        Pull student data from Firestore.
        Step 1: fetch lightweight metadata (no imageData), compare with SQLite.
        Step 2: download images only when metadata changed or images are missing.
        Returns (synced_records, images_changed).
        images_changed=True → caller should delete embedding cache and rebuild.
        """
        if not self.initialized:
            return [], False

        print("  [CLOUD] Checking student list from Firestore...")
        os.makedirs(reference_dir, exist_ok=True)

        try:
            # Step 1: fetch metadata without imageData
            meta_docs = list(
                self.fs_db.collection("students")
                .select(["name", "class", "rfidCardId", "studentId"])
                .stream()
            )

            synced_records = []
            for doc in meta_docs:
                data = doc.to_dict()
                student_id = data.get("studentId", "")
                name       = data.get("name", "Unknown")
                class_name = data.get("class", "Unknown")
                rfid       = data.get("rfidCardId", "")
                uid_hex    = rfid.replace("RFID_", "").strip().upper() if rfid else ""

                if student_id and uid_hex:
                    synced_records.append({
                        "uid":        uid_hex,
                        "student_id": student_id,
                        "full_name":  name,
                        "class_name": class_name,
                    })

            # Step 2: compare with SQLite
            def _key_set(records):
                return {(r.get("uid", "").upper(),
                         r.get("student_id") or "",
                         r.get("full_name", ""),
                         r.get("class_name", ""))
                        for r in records if r.get("uid")}

            firebase_set = _key_set(synced_records)
            sqlite_set   = _key_set(existing_students or [])

            images_present = all(
                os.path.exists(os.path.join(
                    reference_dir,
                    f"{r['full_name'].replace(' ', '_')}_{r['class_name']}.jpg"
                ))
                for r in synced_records
            )

            if firebase_set == sqlite_set and images_present:
                print(f"  [CLOUD] ✓ No changes ({len(synced_records)} students) — skip image download")
                return synced_records, False

            # Step 3: download full docs with images
            reason = "metadata changed" if firebase_set != sqlite_set else "images missing"
            print(f"  [CLOUD] {reason} → downloading images...")

            full_docs = self.fs_db.collection("students").stream()
            count = 0
            for doc in full_docs:
                data       = doc.to_dict()
                name       = data.get("name", "Unknown")
                class_name = data.get("class", "Unknown")
                b64_data   = data.get("imageData", "")

                if b64_data and b64_data.startswith("data:image"):
                    try:
                        _, encoded = b64_data.split(",", 1)
                        img_bytes  = base64.b64decode(encoded)
                        safe_name  = name.replace(" ", "_")
                        filename   = f"{safe_name}_{class_name}.jpg"
                        filepath   = os.path.join(reference_dir, filename)

                        # Remove stale files for the same person with a different class
                        for old_f in os.listdir(reference_dir):
                            stem  = os.path.splitext(old_f)[0]
                            parts = stem.split("_")
                            if (len(parts) >= 2
                                    and "_".join(parts[:-1]) == safe_name
                                    and old_f != filename):
                                os.remove(os.path.join(reference_dir, old_f))

                        with open(filepath, "wb") as f:
                            f.write(img_bytes)
                    except Exception as e:
                        print(f"    - Image decode error for {name}: {e}")
                count += 1

            print(f"  [CLOUD] ✓ Synced {count} students and reference images")
            return synced_records, True

        except Exception as e:
            print(f"  [CLOUD] Error pulling students: {e}")
            return [], False

    def reset_all_attendance_status(self):
        """Reset attendanceStatus → 'not_boarded' for all students (called on trip start)."""
        if not self.initialized:
            return
        try:
            docs  = list(self.fs_db.collection("students").stream())
            count = 0
            # Firestore batch limit: 500 ops per commit
            batch = self.fs_db.batch()
            for doc in docs:
                batch.update(doc.reference, {"attendanceStatus": "not_boarded"})
                count += 1
                if count % 500 == 0:
                    batch.commit()
                    batch = self.fs_db.batch()
            if count % 500 != 0:
                batch.commit()
            print(f"  [CLOUD] ✓ Reset attendanceStatus → not_boarded ({count} students)")
        except Exception as e:
            print(f"  [CLOUD] Error resetting attendanceStatus: {e}")

    def _update_student_status(self, student_id: str, status: str):
        """Update attendanceStatus field in the students collection."""
        try:
            docs = (self.fs_db.collection("students")
                    .where("studentId", "==", student_id)
                    .limit(1)
                    .stream())
            for doc in docs:
                doc.reference.update({"attendanceStatus": status})
                print(f"  [CLOUD] ✓ attendanceStatus={status} for {student_id}")
                return
            print(f"  [CLOUD] ⚠ Student {student_id} not found")
        except Exception as e:
            print(f"  [CLOUD] Error updating attendanceStatus: {e}")

    def push_attendance(self, doc_id: str, student_id: str, student_name: str,
                        date_str: str, ts: str, is_boarded: bool,
                        gps_lat: float, gps_lon: float, img_path: str = None):
        """
        Write to Firestore attendanceRecords collection.
        is_boarded=True  → boarding: create document, set status='boarded'.
        is_boarded=False → alighting: patch alightedAt fields, set status='arrived'.
        """
        if not self.initialized: return

        try:
            doc_ref = self.fs_db.collection("attendanceRecords").document(doc_id)

            if is_boarded:
                b64_str = ""
                if img_path and os.path.exists(img_path):
                    img = cv2.imread(img_path)
                    if img is not None:
                        img_resized = cv2.resize(img, (320, 240))
                        _, buffer = cv2.imencode('.jpg', img_resized,
                                                 [cv2.IMWRITE_JPEG_QUALITY, 50])
                        encoded = base64.b64encode(buffer).decode('utf-8')
                        b64_str = f"data:image/jpeg;base64,{encoded}"

                doc_ref.set({
                    "studentId":   student_id,
                    "studentName": student_name,
                    "date":        date_str,
                    "status":      "present",
                    "boardedAt":   ts,
                    "boardedLat":  gps_lat,
                    "boardedLng":  gps_lon,
                    "isOnLeave":   False,
                    "imageData":   b64_str,
                }, merge=True)
                print(f"  [CLOUD] ☁ Boarded → attendanceRecords/{doc_id}")
                self._update_student_status(student_id, "boarded")
            else:
                doc_ref.set({
                    "alightedAt":  ts,
                    "alightedLat": gps_lat,
                    "alightedLng": gps_lon,
                }, merge=True)
                print(f"  [CLOUD] ☁ Alighted → attendanceRecords/{doc_id}")
                self._update_student_status(student_id, "arrived")

        except Exception as e:
            print(f"  [CLOUD] Error pushing attendance: {e}")

    def send_fcm(self, student_id: str, title: str, body: str):
        """Send FCM push notification to the parent(s) of the given student."""
        if not self.initialized:
            return
        try:
            from firebase_admin import messaging
            parents = list(
                self.fs_db.collection("parents")
                .where("studentIds", "array_contains", student_id)
                .stream()
            )
            if not parents:
                print(f"  [FCM] ⚠ No parent found for student {student_id}")
                return
            for parent_doc in parents:
                token = parent_doc.to_dict().get("fcmToken", "")
                if not token:
                    print(f"  [FCM] ⚠ Parent {parent_doc.id} has no fcmToken")
                    continue
                msg = messaging.Message(
                    notification=messaging.Notification(title=title, body=body),
                    token=token,
                )
                messaging.send(msg)
                print(f"  [FCM] ✓ {title} → {parent_doc.id}")
        except Exception as e:
            print(f"  [FCM] Error sending notification: {e}")

    # ── Realtime Database ──────────────────────────────────

    def push_gps(self, lat: float, lon: float, speed: float):
        if not self.initialized: return
        try:
            ref = self.rt_db.reference("bus/gps")
            ref.update({
                "lat":       lat,
                "lng":       lon,
                "speed":     round(speed, 1),
                "isActive":  True,
                "updatedAt": int(time.time() * 1000),
            })
        except Exception as e:
            print(f"  [CLOUD] Error pushing GPS: {e}")
