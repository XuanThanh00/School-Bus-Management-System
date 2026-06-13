import { db } from '../firebase';
import {
  collection, onSnapshot, deleteDoc, doc,
  query, orderBy, getDocs, writeBatch,
} from 'firebase/firestore';

const COLLECTION = 'attendanceRecords';

// Doc ID format: {YYYY-MM-DD}_{shift}_{studentId}
const parseDocId = (id) => {
  const parts = id.split('_');
  return { shift: parts[1] || '' };
};

export const listenToAttendanceRecords = (callback) => {
  const q = query(collection(db, COLLECTION), orderBy('date', 'desc'));
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({
      id: d.id,
      ...parseDocId(d.id),
      ...d.data(),
    })))
  );
};

export const deleteAttendanceRecord = (docId) =>
  deleteDoc(doc(db, COLLECTION, docId));

export const deleteAllAttendanceRecords = async () => {
  const snap = await getDocs(collection(db, COLLECTION));
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
};
