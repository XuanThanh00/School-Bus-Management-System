import { db, firebaseConfig } from '../firebase';
import {
  collection, addDoc, deleteDoc, doc, onSnapshot,
  serverTimestamp, getDoc, query, orderBy,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  deleteUser,
  signOut,
  getAuth,
} from 'firebase/auth';
import { initializeApp, getApps } from 'firebase/app';

const COLLECTION = 'drivers';

// Reuses the same secondary Firebase app used by authService (no duplicate initialisation)
const getSecondaryAuth = () => {
  const existing = getApps().find((a) => a.name === 'secondary');
  const app = existing ?? initializeApp(firebaseConfig, 'secondary');
  return getAuth(app);
};

// driver_<phone>@busattend.app — distinct from parent accounts (<phone>@busattend.app)
export const driverPhoneToEmail = (phone) => `driver_${phone.trim()}@busattend.app`;

export const listenToDrivers = (callback) => {
  const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
};

export const addDriver = async (driverData) => {
  const { phone } = driverData;
  const email = driverPhoneToEmail(phone);
  const defaultPassword = '123456';
  const secondaryAuth = getSecondaryAuth();
  let hasAuth = false;

  try {
    await createUserWithEmailAndPassword(secondaryAuth, email, defaultPassword);
    await signOut(secondaryAuth);
    hasAuth = true;
  } catch (err) {
    await signOut(secondaryAuth).catch(() => {});
    if (err.code !== 'auth/email-already-in-use') throw err;
  }

  return addDoc(collection(db, COLLECTION), {
    ...driverData,
    email,
    defaultPassword,
    hasAuth,
    createdAt: serverTimestamp(),
  });
};

export const deleteDriverRecord = async (driverId) => {
  const snap = await getDoc(doc(db, COLLECTION, driverId));
  if (snap.exists()) {
    const { phone, defaultPassword } = snap.data();
    if (phone) {
      const email = driverPhoneToEmail(phone);
      const secondaryAuth = getSecondaryAuth();
      try {
        const cred = await signInWithEmailAndPassword(
          secondaryAuth, email, defaultPassword || '123456',
        );
        await deleteUser(cred.user);
      } catch {
        await signOut(secondaryAuth).catch(() => {});
      }
    }
  }
  await deleteDoc(doc(db, COLLECTION, driverId));
};
