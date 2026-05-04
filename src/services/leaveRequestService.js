import {
  collection, addDoc, getDocs, getDoc, updateDoc, deleteDoc,
  doc, query, orderBy, where, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { updateAttendanceStatusByStudentId, updateAttendanceStatus } from './studentService';
import { setLeaveBuffer, clearLeaveBuffer } from './leaveBufferService';

const toISO = (d) => {
  if (!d) return '';
  if (d?.toDate) return d.toDate().toISOString().split('T')[0];
  if (d instanceof Date) return d.toISOString().split('T')[0];
  if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [day, mon, yr] = d.split('/');
    return `${yr}-${mon}-${day}`;
  }
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return String(d);
};

// Pick the best identifier and call the matching attendance updater ONCE.
// Prefer studentId (custom) because that's what the buffer is keyed on.
const applyAttendance = async ({ studentId, studentDocId }, status) => {
  if (studentId) {
    return updateAttendanceStatusByStudentId(studentId, status);
  }
  if (studentDocId) {
    return updateAttendanceStatus(studentDocId, status);
  }
  return { success: false, reason: 'no_identifier' };
};

export const listenToLeaveRequests = (callback, statusFilter = null) => {
  const q = query(collection(db, 'leaveRequests'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    let data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (statusFilter) data = data.filter((r) => r.status === statusFilter);
    callback(data);
  });
};

export const getAllLeaveRequests = async () => {
  const q = query(collection(db, 'leaveRequests'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// Listen to all approved leave requests, filter by date client-side.
// Returns a Set of both Firestore doc IDs and custom studentIds on leave on the given date.
export const listenToApprovedLeavesForDate = (date, callback) => {
  const q = query(
    collection(db, 'leaveRequests'),
    where('status', '==', 'approved'),
  );
  return onSnapshot(q, (snap) => {
    const idSet = new Set();
    snap.docs
      .map((d) => ({ docId: d.id, ...d.data() }))
      .filter((r) => {
        const start = toISO(r.startDate);
        const end   = toISO(r.endDate || r.startDate);
        return start <= date && end >= date;
      })
      .forEach((r) => {
        if (r.studentId)    idSet.add(r.studentId);
        if (r.studentDocId) idSet.add(r.studentDocId);
      });
    callback(idSet);
  });
};

// Auto-approve: submit immediately sets status = 'approved'.
// Order matters: write buffer FIRST so the attendance guard sees it.
export const submitLeaveRequest = async (requestData) => {
  const ref = await addDoc(collection(db, 'leaveRequests'), {
    ...requestData,
    status: 'approved',
    createdAt: new Date(),
    reviewedAt: new Date(),
    reviewedBy: 'auto',
    adminNote: 'Đã duyệt',
  });

  // 1. Buffer first — so any concurrent reader / the attendance write below
  //    will correctly see the student as on-leave.
  if (requestData.studentId) {
    await setLeaveBuffer(
      requestData.studentId,
      true,
      requestData.startDate,
      requestData.endDate,
    );
  }

  // 2. For now, mark absent immediately once the request is approved.
  //    Date/window handling will be tightened later.
  await applyAttendance(requestData, 'absent');

  return ref.id;
};

// Admin can manually reject an approved request.
// Order: clear buffer FIRST, then reset attendance — so guard no longer forces 'absent'.
export const rejectLeaveRequest = async (requestId, adminNote, reviewedBy) => {
  const snap = await getDoc(doc(db, 'leaveRequests', requestId));
  const data = snap.data();
  if (!data) return;

  await updateDoc(doc(db, 'leaveRequests', requestId), {
    status: 'rejected',
    adminNote: adminNote || '',
    reviewedAt: new Date(),
    reviewedBy,
  });

  // 1. Remove buffer first — otherwise the guard inside updateAttendance*
  //    will refuse to leave 'absent' and silently re-force it.
  if (data.studentId) {
    await clearLeaveBuffer(data.studentId);
  }

  // 2. Now safe to reset attendance back to 'not_boarded'.
  await applyAttendance(data, 'not_boarded');
};

export const deleteLeaveRequest = async (requestId) => {
  const snap = await getDoc(doc(db, 'leaveRequests', requestId));
  const data = snap.data();

  await deleteDoc(doc(db, 'leaveRequests', requestId));

  // If the deleted request was an active approved leave, clean buffer + attendance too.
  if (data?.status === 'approved' && data?.studentId) {
    await clearLeaveBuffer(data.studentId);
    await applyAttendance(data, 'not_boarded');
  }
};

// Admin can re-approve if needed
export const approveLeaveRequest = async (requestId, adminNote, reviewedBy) => {
  const snap = await getDoc(doc(db, 'leaveRequests', requestId));
  const data = snap.data();
  if (!data) return;

  await updateDoc(doc(db, 'leaveRequests', requestId), {
    status: 'approved',
    adminNote: adminNote || '',
    reviewedAt: new Date(),
    reviewedBy,
  });

  if (data.studentId) {
    await setLeaveBuffer(data.studentId, true, data.startDate, data.endDate);
  }
  await applyAttendance(data, 'absent');
};
