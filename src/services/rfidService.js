/**
 * RFID Service
 *
 * Flow:
 *  1. Raspberry Pi / ESP32 quét thẻ → nhận UID → push lên RTDB tại path "rfid/pending"
 *     { uid: "A1B2C3D4", scannedAt: <serverTimestamp> }
 *  2. Web app lắng nghe path đó → hiển thị UID trong form đăng ký học sinh
 *  3. Admin điền thông tin học sinh + submit → UID lưu vào Firestore student.rfidCardId
 *  4. Web app xóa "rfid/pending" sau khi gán xong
 *
 *  Khi điểm danh (Raspberry Pi):
 *  Pi đọc thẻ → lấy UID → query Firestore: where("rfidCardId", "==", uid)
 *  → tìm thấy student → cập nhật trạng thái điểm danh
 */

import { rtdb, db } from '../firebase';
import { ref, onValue, set, get } from 'firebase/database';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

const PENDING_PATH = 'rfid/pending';

/**
 * Lắng nghe real-time khi Raspberry Pi push UID mới lên RTDB.
 * callback nhận { uid, scannedAt } hoặc null nếu chưa có.
 * Trả về hàm unsubscribe.
 */
export const listenToPendingRFID = (callback) => {
  const rfidRef = ref(rtdb, PENDING_PATH);
  return onValue(rfidRef, (snap) => {
    const data = snap.val();
    callback(data?.uid ? data : null);
  });
};

/**
 * Đọc một lần UID đang chờ (không real-time).
 */
export const getPendingRFIDUid = async () => {
  const snap = await get(ref(rtdb, PENDING_PATH));
  const data = snap.val();
  return data?.uid ? data : null;
};

/**
 * Xóa pending UID sau khi đã gán cho học sinh.
 * Gọi sau khi submit form thành công.
 */
export const clearPendingRFID = async () => {
  await set(ref(rtdb, PENDING_PATH), null);
};

/**
 * (Dev/test only) Giả lập Pi push một UID lên RTDB để test mà không cần phần cứng.
 */
export const simulateRFIDScan = async (uid) => {
  await set(ref(rtdb, PENDING_PATH), {
    uid: uid || `TEST_${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    scannedAt: Date.now(),
    source: 'simulator',
  });
};

/**
 * Kiểm tra xem UID đã được gán cho học sinh nào chưa.
 * Trả về { id, name, class, ... } nếu đã đăng ký, null nếu chưa.
 */
export const checkRfidRegistered = async (uid) => {
  if (!uid) return null;
  const q = query(
    collection(db, 'students'),
    where('rfidCardId', '==', uid),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
};
