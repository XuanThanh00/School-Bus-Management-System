import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  limit,
  arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase';
import { isOnApprovedLeaveToday } from './leaveBufferService';
import { deleteParentRecord } from './authService';

// Convert image file to Base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
};

// Add new student
export const addStudent = async (studentData, imageFile) => {
  let imageData = '';
  if (imageFile) {
    imageData = await fileToBase64(imageFile);
  }
  const docRef = await addDoc(collection(db, 'students'), {
    ...studentData,
    imageData,
    createdAt: new Date(),
  });
  return docRef.id;
};

// Get all students
export const getAllStudents = async () => {
  const querySnapshot = await getDocs(collection(db, 'students'));
  return querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// Get students by their studentId field values
export const getStudentsByIds = async (studentIds) => {
  if (!studentIds?.length) return [];
  const snap = await getDocs(
    query(collection(db, 'students'), where('studentId', 'in', studentIds)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// Real-time students listener
export const listenToStudents = (callback) => {
  const q = query(collection(db, 'students'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (querySnapshot) => {
    const students = querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(students);
  });
};

// Update student attendance status (legacy field `status`)
export const updateStudentStatus = async (studentId, status) => {
  await updateDoc(doc(db, 'students', studentId), {
    status,
    updatedAt: new Date(),
  });
};

// Delete student — also removes studentId from parent, deletes parent if no children left
export const deleteStudent = async (firestoreDocId) => {
  const studentSnap = await getDoc(doc(db, 'students', firestoreDocId));
  const student = studentSnap.data();

  if (student?.parentPhone) {
    const parentSnap = await getDocs(
      query(collection(db, 'parents'), where('phone', '==', student.parentPhone)),
    );
    if (!parentSnap.empty) {
      const parentDoc = parentSnap.docs[0];
      const remaining = (parentDoc.data().studentIds || []).filter(
        (id) => id !== student.studentId,
      );
      if (remaining.length === 0) {
        await deleteParentRecord(parentDoc.id);
      } else {
        await updateDoc(parentDoc.ref, { studentIds: arrayRemove(student.studentId) });
      }
    }
  }

  await deleteDoc(doc(db, 'students', firestoreDocId));
};

// Update student RFID card
export const updateStudentRfid = async (firestoreDocId, rfidCardId) => {
  await updateDoc(doc(db, 'students', firestoreDocId), { rfidCardId });
};

// Get students by class
export const getStudentsByClass = async (className) => {
  const q = query(
    collection(db, 'students'),
    where('class', '==', className),
    orderBy('createdAt', 'desc'),
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// Update student location
export const updateStudentLocation = async (studentId, lat, lng, accuracy) => {
  await updateDoc(doc(db, 'students', studentId), {
    location: { lat, lng, accuracy, timestamp: new Date() },
  });
};

// ---------------------------------------------------------------------------
// CORE ATTENDANCE WRITER
// ---------------------------------------------------------------------------
// Internal helper: actually writes the attendance status to a student doc.
// Does NOT do any leave-buffer checking — caller is responsible for that.
const writeAttendance = async (studentRef, status) => {
  await updateDoc(studentRef, {
    attendanceStatus: status,
    attendanceUpdatedAt: new Date(),
  });
};

// ---------------------------------------------------------------------------
// PUBLIC API — both functions follow the SAME priority rule:
//
//   1. Check leaveBuffer FIRST.
//   2. If buffer says "on leave today" → write 'absent' and STOP (break).
//      The caller's requested status is ignored.
//   3. Otherwise → write the requested status (boarded / arrived / etc.).
//
// This is the single guard. No silent blocks, no double writes.
// ---------------------------------------------------------------------------

// Update attendance by Firestore doc ID
// status: 'not_boarded' | 'boarded' | 'arrived' | 'not_arrived' | 'absent'
export const updateAttendanceStatus = async (firestoreDocId, status) => {
  const studentRef = doc(db, 'students', firestoreDocId);
  const studentSnap = await getDoc(studentRef);

  if (!studentSnap.exists()) {
    throw new Error('Student not found');
  }

  const customStudentId = studentSnap.data().studentId;

  // STEP 1: buffer is the gate.
  const onLeave = await isOnApprovedLeaveToday(customStudentId);

  // STEP 2: if on leave → force absent and break.
  if (onLeave) {
    await writeAttendance(studentRef, 'absent');
    return { success: true, finalStatus: 'absent', forcedByLeave: true };
  }

  // STEP 3: not on leave → write whatever was requested.
  await writeAttendance(studentRef, status);
  return { success: true, finalStatus: status, forcedByLeave: false };
};

// Update attendance by custom studentId field
export const updateAttendanceStatusByStudentId = async (studentId, status) => {
  if (!studentId) return { success: false, reason: 'no_student_id' };

  // STEP 1: buffer is the gate.
  const onLeave = await isOnApprovedLeaveToday(studentId);
  const finalStatus = onLeave ? 'absent' : status;

  // STEP 2 & 3 combined: look up the doc and write.
  const snap = await getDocs(
    query(collection(db, 'students'), where('studentId', '==', studentId)),
  );
  if (snap.empty) return { success: false, reason: 'not_found' };

  await writeAttendance(snap.docs[0].ref, finalStatus);
  return { success: true, finalStatus, forcedByLeave: onLeave };
};

// Update student info fields (name, class, dateOfBirth, parentName, parentPhone, busStop, etc.)
export const updateStudent = async (firestoreDocId, data) => {
  await updateDoc(doc(db, 'students', firestoreDocId), {
    ...data,
    updatedAt: new Date(),
  });
};

// Find student by RFID UID — used for duplicate check in StudentForm
export const getStudentByRfidCardId = async (uid) => {
  const q = query(
    collection(db, 'students'),
    where('rfidCardId', '==', uid),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

// Batch reset attendance for a new day.
// `skipDocIds` = Firestore doc IDs to skip (e.g. students currently on approved leave —
// caller should resolve studentId → docId before passing).
export const resetDailyAttendance = async (skipDocIds = []) => {
  const snap = await getDocs(collection(db, 'students'));
  const skipSet = new Set(skipDocIds);
  await Promise.all(
    snap.docs
      .filter((d) => !skipSet.has(d.id))
      .map((d) =>
        updateDoc(d.ref, {
          attendanceStatus: 'not_boarded',
          attendanceUpdatedAt: null,
        }),
      ),
  );
};