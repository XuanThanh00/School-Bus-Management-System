import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export const DEFAULT_SCHOOL = {
  name: 'Trường THPT',
  address: 'Số 1 Đường Nguyễn Trãi, Quận 1, TP.HCM',
  lat: 10.7769,
  lng: 106.7009,
};

export const updateSchoolConfig = async (data) => {
  await setDoc(doc(db, 'systemConfig', 'school'), data, { merge: true });
};

export const listenToSchoolConfig = (callback) => {
  return onSnapshot(doc(db, 'systemConfig', 'school'), (snap) => {
    callback(snap.exists() ? { ...DEFAULT_SCHOOL, ...snap.data() } : { ...DEFAULT_SCHOOL });
  });
};
