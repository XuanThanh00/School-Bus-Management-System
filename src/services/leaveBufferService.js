import {
  collection, doc, setDoc, deleteDoc, getDoc, getDocs,
  query, where, updateDoc, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

const toISOStr = (d) => {
  if (!d) return '';
  if (d?.toDate) return d.toDate().toISOString().split('T')[0];
  if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [day, mon, yr] = d.split('/');
    return `${yr}-${mon}-${day}`;
  }
  if (d instanceof Date) return d.toISOString().split('T')[0];
  return String(d);
};

// Write or update a student's leave buffer entry.
// Document ID = studentId (custom student ID) for fast lookup.
export const setLeaveBuffer = async (studentId, status, startDate, endDate) => {
  if (!studentId) return;
  await setDoc(doc(db, 'leaveBuffer', studentId), {
    studentId,
    status: status === true, // force boolean
    startDate: toISOStr(startDate),
    endDate: toISOStr(endDate || startDate),
    updatedAt: new Date(),
  });
};

// Remove buffer entry entirely (cleaner than keeping status:false).
export const clearLeaveBuffer = async (studentId) => {
  if (!studentId) return;
  try {
    await deleteDoc(doc(db, 'leaveBuffer', studentId));
  } catch {
    // ignore if doc doesn't exist
  }
};

// Direct check: returns true if student has an active approved leave covering today.
// This is the SINGLE source of truth used by studentService.
export const isOnApprovedLeaveToday = async (studentId) => {
  if (!studentId) return false;
  try {
    const snap = await getDoc(doc(db, 'leaveBuffer', studentId));
    if (!snap.exists()) return false;
    const { status, startDate, endDate } = snap.data();
    const today = new Date().toISOString().split('T')[0];
    return (
      status === true &&
      !!startDate &&
      startDate <= today &&
      today <= (endDate || startDate)
    );
  } catch {
    return false;
  }
};

// In-memory de-dup so we don't try to force-absent the same studentId
// repeatedly across snapshots. Cleared on unsubscribe.
// Module-level (not per-listener) so multiple components subscribing
// can't double-force the same student.
const _forcedAbsentToday = new Set(); // values: `${studentId}:${YYYY-MM-DD}`

// Force a single student to 'absent' if they currently are not.
// Reads first, writes only if needed → avoids redundant writes and listener loops.
const forceAbsentByStudentId = async (studentId, today) => {
  const key = `${studentId}:${today}`;
  if (_forcedAbsentToday.has(key)) return;
  _forcedAbsentToday.add(key);

  try {
    const snap = await getDocs(
      query(collection(db, 'students'), where('studentId', '==', studentId)),
    );
    if (snap.empty) return;

    const studentDoc = snap.docs[0];
    const current = studentDoc.data().attendanceStatus;

    // Only write if it would actually change something.
    if (current === 'absent') return;

    await updateDoc(studentDoc.ref, {
      attendanceStatus: 'absent',
      attendanceUpdatedAt: new Date(),
    });
  } catch {
    // Failure here shouldn't break the listener — un-mark so a later
    // snapshot can retry.
    _forcedAbsentToday.delete(key);
  }
};

// Listen to leaveBuffer collection.
// Returns a Set of custom studentIds whose leave is approved AND covers today,
// AND auto-forces those students' attendanceStatus to 'absent' in the background.
export const listenToLeaveBuffer = (callback) => {
  return onSnapshot(collection(db, 'leaveBuffer'), (snap) => {
    const today = new Date().toISOString().split('T')[0];
    const activeIds = new Set();

    snap.docs.forEach((d) => {
      const { studentId, status, startDate, endDate } = d.data();
      if (
        status === true &&
        studentId &&
        startDate &&
        startDate <= today &&
        today <= (endDate || startDate)
      ) {
        activeIds.add(studentId);
      }
    });

    // Notify subscribers immediately — UI doesn't have to wait for writes.
    callback(activeIds);

    // Background auto-force: fire-and-forget, errors are swallowed inside.
    activeIds.forEach((sid) => {
      forceAbsentByStudentId(sid, today);
    });
  });
};