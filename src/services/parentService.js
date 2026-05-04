import {
  collection, query, where, getDocs,
  addDoc, updateDoc, doc, arrayUnion,
} from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Upsert parent record from student data.
 * Called automatically when admin adds a student.
 * Does NOT create Firebase Auth – that stays in ParentAccounts page.
 */
export const upsertParentFromStudent = async ({ parentName, parentPhone, studentId }) => {
  if (!parentPhone?.trim()) return;

  const phone = parentPhone.trim();
  const q = query(collection(db, 'parents'), where('phone', '==', phone));
  const snap = await getDocs(q);

  if (!snap.empty) {
    // Already exists → just link the new studentId
    const ref = doc(db, 'parents', snap.docs[0].id);
    await updateDoc(ref, {
      studentIds: arrayUnion(studentId),
      ...(parentName && { displayName: parentName.trim() }),
    });
  } else {
    // First time → create Firestore doc (auth account created later in ParentAccounts)
    await addDoc(collection(db, 'parents'), {
      phone,
      email: `${phone}@busattend.app`,
      displayName: parentName?.trim() || phone,
      studentIds: studentId ? [studentId] : [],
      isActive: true,
      hasAuth: false,   // auth account not yet created
      createdAt: new Date(),
    });
  }
};
