import {
  collection, addDoc, getDocs, updateDoc, deleteDoc,
  doc, query, orderBy, where, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

export const addBusStop = async (stopData) => {
  const ref = await addDoc(collection(db, 'busStops'), {
    ...stopData,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return ref.id;
};

export const listenToBusStops = (callback) => {
  const q = query(collection(db, 'busStops'), orderBy('order', 'asc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
};

export const getAllBusStops = async () => {
  const q = query(
    collection(db, 'busStops'),
    where('isActive', '==', true),
    orderBy('order', 'asc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const updateBusStop = async (stopId, data) => {
  await updateDoc(doc(db, 'busStops', stopId), { ...data, updatedAt: new Date() });
};

export const deleteBusStop = async (stopId) => {
  await deleteDoc(doc(db, 'busStops', stopId));
};
