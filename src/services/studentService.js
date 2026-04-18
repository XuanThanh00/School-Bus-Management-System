import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

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
  try {
    let imageData = '';

    // Convert image to Base64 if provided
    if (imageFile) {
      imageData = await fileToBase64(imageFile);
    }

    // Add student to Firestore
    const docRef = await addDoc(collection(db, 'students'), {
      ...studentData,
      imageData, // Base64 encoded image
      createdAt: new Date(),
    });

    return docRef.id;
  } catch (error) {
    throw error;
  }
};

// Get all students
export const getAllStudents = async () => {
  try {
    const querySnapshot = await getDocs(collection(db, 'students'));
    const students = [];
    querySnapshot.forEach((doc) => {
      students.push({ id: doc.id, ...doc.data() });
    });
    return students;
  } catch (error) {
    throw error;
  }
};

// Real-time students listener
export const listenToStudents = (callback) => {
  try {
    const q = query(collection(db, 'students'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const students = [];
      querySnapshot.forEach((doc) => {
        students.push({ id: doc.id, ...doc.data() });
      });
      callback(students);
    });
    return unsubscribe;
  } catch (error) {
    throw error;
  }
};

// Update student attendance status
export const updateStudentStatus = async (studentId, status) => {
  try {
    const studentRef = doc(db, 'students', studentId);
    await updateDoc(studentRef, {
      status: status,
      updatedAt: new Date(),
    });
  } catch (error) {
    throw error;
  }
};

// Delete student
export const deleteStudent = async (studentId) => {
  try {
    await deleteDoc(doc(db, 'students', studentId));
  } catch (error) {
    throw error;
  }
};

// Get students by class
export const getStudentsByClass = async (className) => {
  try {
    const q = query(
      collection(db, 'students'),
      where('class', '==', className),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    const students = [];
    querySnapshot.forEach((doc) => {
      students.push({ id: doc.id, ...doc.data() });
    });
    return students;
  } catch (error) {
    throw error;
  }
};

// Update student location
export const updateStudentLocation = async (studentId, lat, lng, accuracy) => {
  try {
    const studentRef = doc(db, 'students', studentId);
    await updateDoc(studentRef, {
      location: {
        lat,
        lng,
        accuracy,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    throw error;
  }
};
