import { collection, addDoc, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

// Add log entry
export const addLog = async (userId, action) => {
  try {
    await addDoc(collection(db, 'logs'), {
      userId,
      action,
      timestamp: new Date(),
    });
  } catch (error) {
    throw error;
  }
};

// Get logs for specific user
export const getUserLogs = async (userId) => {
  try {
    const q = query(
      collection(db, 'logs'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc')
    );
    const querySnapshot = await getDocs(q);
    const logs = [];
    querySnapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    return logs;
  } catch (error) {
    throw error;
  }
};

// Get all logs (admin only)
export const getAllLogs = async () => {
  try {
    const q = query(collection(db, 'logs'), orderBy('timestamp', 'desc'));
    const querySnapshot = await getDocs(q);
    const logs = [];
    querySnapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    return logs;
  } catch (error) {
    throw error;
  }
};
