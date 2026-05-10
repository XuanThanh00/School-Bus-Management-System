import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  deleteUser,
  getAuth,
} from 'firebase/auth';
import { initializeApp, getApps } from 'firebase/app';
import { auth, db, firebaseConfig } from '../firebase';
import {
  doc, getDoc, setDoc, addDoc, collection, getDocs,
  query, where, deleteDoc, updateDoc, onSnapshot,
} from 'firebase/firestore';

// Secondary app to create auth accounts without signing out admin
const getSecondaryAuth = () => {
  const existing = getApps().find((a) => a.name === 'secondary');
  const app = existing ?? initializeApp(firebaseConfig, 'secondary');
  return getAuth(app);
};

// Register admin user
export const registerUser = async (email, password) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    email: cred.user.email,
    role: 'admin',
    createdAt: new Date(),
  });
  return cred.user;
};

// Login
export const loginUser = async (email, password) => {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
};

// Logout
export const logoutUser = async () => {
  await signOut(auth);
};

// Get current user
export const getCurrentUser = () => auth.currentUser;

// ── Parent Account Management ─────────────────────────────────────────────────

// Convert phone → Firebase email
const phoneToEmail = (phone) => `${phone.trim()}@busattend.app`;

// Register parent account — creates Firebase Auth + Firestore doc
// Called from StudentForm (when adding a student) and ParentAccounts
// If Auth account already exists, gracefully skips auth creation and only upserts Firestore
export const registerParent = async (parentData) => {
  const { phone, displayName, password = '123456', studentId = null } = parentData;
  const email = phoneToEmail(phone);
  const adminUser = auth.currentUser;

  // Try creating Auth account on secondary app (won't affect admin session)
  const secondaryAuth = getSecondaryAuth();
  let parentUid = null;
  let authAlreadyExists = false;

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    parentUid = cred.user.uid;
    await signOut(secondaryAuth);
  } catch (err) {
    if (err.code !== 'auth/email-already-in-use') throw err;
    authAlreadyExists = true;
  }

  // Upsert Firestore doc
  const existingQuery = query(collection(db, 'parents'), where('phone', '==', phone));
  const existingSnap = await getDocs(existingQuery);

  if (!existingSnap.empty) {
    const existingRef = existingSnap.docs[0].ref;
    const existingData = existingSnap.docs[0].data();
    const updates = {
      displayName,
      hasAuth: true,
      isActive: true,
      defaultPassword: password,
    };
    if (parentUid) {
      updates.uid = parentUid;
      updates.email = email;
      updates.authCreatedAt = new Date();
      updates.createdBy = adminUser?.uid || 'admin';
    }
    if (studentId) {
      const ids = existingData.studentIds || [];
      if (!ids.includes(studentId)) updates.studentIds = [...ids, studentId];
    }
    await updateDoc(existingRef, updates);
    parentUid = parentUid || existingData.uid || null;
  } else {
    // No existing doc — create new one
    const newDoc = {
      phone,
      email,
      displayName,
      studentIds: studentId ? [studentId] : [],
      hasAuth: !authAlreadyExists,
      isActive: true,
      defaultPassword: password,
      createdAt: new Date(),
      createdBy: adminUser?.uid || 'admin',
    };
    if (parentUid) {
      newDoc.uid = parentUid;
      newDoc.authCreatedAt = new Date();
      await setDoc(doc(db, 'parents', parentUid), newDoc);
    } else {
      await addDoc(collection(db, 'parents'), newDoc);
    }
  }

  return { uid: parentUid, email, phone, displayName, authAlreadyExists };
};

// Get all parent accounts (one-time)
export const getAllParents = async () => {
  const snap = await getDocs(query(collection(db, 'parents')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// Real-time parents listener
export const listenToParents = (callback) =>
  onSnapshot(collection(db, 'parents'), (s) =>
    callback(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

// Reset parent password — updates Firebase Auth (if stored password still valid) + Firestore
// Returns { authUpdated: boolean }
export const resetParentPassword = async (phone, storedPassword, newPassword) => {
  const email = phoneToEmail(phone);
  const secondaryAuth = getSecondaryAuth();
  let authUpdated = false;

  try {
    const cred = await signInWithEmailAndPassword(secondaryAuth, email, storedPassword);
    await updatePassword(cred.user, newPassword);
    await signOut(secondaryAuth);
    authUpdated = true;
  } catch (err) {
    await signOut(secondaryAuth).catch(() => {});
    const ignorable = ['auth/wrong-password', 'auth/invalid-credential', 'auth/user-not-found'];
    if (!ignorable.includes(err.code)) throw err;
  }

  // Always persist new password to Firestore
  const snap = await getDocs(query(collection(db, 'parents'), where('phone', '==', phone)));
  if (!snap.empty) {
    await updateDoc(snap.docs[0].ref, { defaultPassword: newPassword });
  }

  return { authUpdated };
};

// Delete parent account — removes Firebase Auth account then Firestore doc.
// Auth deletion signs in via secondary app using the stored defaultPassword.
// If the parent changed their password, Auth deletion is skipped but Firestore is still removed.
export const deleteParentRecord = async (parentId) => {
  const parentSnap = await getDoc(doc(db, 'parents', parentId));
  if (parentSnap.exists()) {
    const { phone, defaultPassword } = parentSnap.data();
    if (phone) {
      const email = phoneToEmail(phone);
      const secondaryAuth = getSecondaryAuth();
      try {
        const cred = await signInWithEmailAndPassword(
          secondaryAuth,
          email,
          defaultPassword || '123456',
        );
        await deleteUser(cred.user);
      } catch {
        await signOut(secondaryAuth).catch(() => {});
      }
    }
  }
  await deleteDoc(doc(db, 'parents', parentId));
};
