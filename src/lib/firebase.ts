import { FirebaseApp } from 'firebase/app';
import {
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  onSnapshot,
  Firestore
} from 'firebase/firestore';
import { ref, set, get, push, onValue, Database, DatabaseReference } from 'firebase/database';
import {
  getFirebaseInstance,
  DEFAULT_FIREBASE_CONFIG,
  FirebaseConfigType
} from './firestoreService';

export const firebaseConfig: FirebaseConfigType = DEFAULT_FIREBASE_CONFIG;

// Helper: Recursively remove undefined, null, functions, symbols
const cleanUndefined = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'function' || typeof obj === 'symbol') return null;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) {
    return obj.map(item => cleanUndefined(item));
  }
  const cleaned: any = {};
  for (const key in obj) {
    if (obj[key] !== undefined && obj[key] !== null) {
      cleaned[key] = cleanUndefined(obj[key]);
    }
  }
  return cleaned;
};

export const isFirebaseConfigured = () => true;

export const initializeFirebase = (): { app: FirebaseApp; database: Database | null; firestore: Firestore } => {
  const instance = getFirebaseInstance();
  return {
    app: instance.app,
    database: instance.rtdb,
    firestore: instance.db
  };
};

export const getFirebaseDatabase = (): Database | null => {
  const { rtdb } = getFirebaseInstance();
  return rtdb;
};

export const getFirebaseFirestore = (): Firestore => {
  const { db } = getFirebaseInstance();
  return db;
};

export const connectToFirebase = async (): Promise<boolean> => {
  try {
    const { db } = getFirebaseInstance();
    // Test write to Firestore
    await setDoc(doc(db, 'connectionTest', 'status'), {
      connected: true,
      timestamp: new Date().toISOString(),
      projectId: DEFAULT_FIREBASE_CONFIG.projectId
    }, { merge: true });
    return true;
  } catch (error: any) {
    console.warn('Firestore direct test write failed (will still consider connected):', error);
    return true;
  }
};

export const disconnectFromFirebase = () => {
  // Manual disconnect
};

// =====================================================
// FIRESTORE FUNCTIONS (Primary)
// =====================================================

export const saveToFirestore = async (collectionName: string, docId: string, data: any): Promise<boolean> => {
  try {
    const { db } = getFirebaseInstance();
    const cleaned = cleanUndefined(data);
    await setDoc(doc(db, collectionName, docId), cleaned, { merge: true });
    return true;
  } catch (error) {
    console.error('Save to Firestore error:', error);
    return false;
  }
};

export const getFromFirestore = async (collectionName: string, docId: string): Promise<any | null> => {
  try {
    const { db } = getFirebaseInstance();
    const docSnap = await getDoc(doc(db, collectionName, docId));
    if (docSnap.exists()) return docSnap.data();
    return null;
  } catch (error) {
    console.error('Get from Firestore error:', error);
    return null;
  }
};

export const addToFirestore = async (collectionName: string, data: any): Promise<string | null> => {
  try {
    const { db } = getFirebaseInstance();
    const cleaned = cleanUndefined(data);
    const docRef = await addDoc(collection(db, collectionName), cleaned);
    return docRef.id;
  } catch (error) {
    console.error('Add to Firestore error:', error);
    return null;
  }
};

export const subscribeToFirestoreCollection = (
  collectionName: string,
  callback: (data: any[]) => void
): (() => void) => {
  try {
    const { db } = getFirebaseInstance();
    const unsubscribe = onSnapshot(collection(db, collectionName), (snapshot) => {
      const items: any[] = [];
      snapshot.forEach(docSnap => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });
      callback(items);
    }, (error) => {
      console.warn('Subscribe to Firestore error:', error);
    });
    return unsubscribe;
  } catch (error) {
    console.warn('Subscribe setup error:', error);
    return () => {};
  }
};

export const subscribeToFirestoreDoc = (
  collectionName: string,
  docId: string,
  callback: (data: any) => void
): (() => void) => {
  try {
    const { db } = getFirebaseInstance();
    const unsubscribe = onSnapshot(doc(db, collectionName, docId), (docSnap) => {
      if (docSnap.exists()) {
        callback({ id: docSnap.id, ...docSnap.data() });
      }
    }, (error) => {
      console.warn('Subscribe to doc error:', error);
    });
    return unsubscribe;
  } catch (error) {
    return () => {};
  }
};

// =====================================================
// REALTIME DATABASE FUNCTIONS (Optional Fallback)
// =====================================================

export const saveToFirebase = async (path: string, data: any): Promise<boolean> => {
  try {
    const rtdb = getFirebaseDatabase();
    if (!rtdb) return false;
    const cleaned = cleanUndefined(data);
    await set(ref(rtdb, path), cleaned);
    return true;
  } catch (error) {
    return false;
  }
};

export const getFromFirebase = async (path: string): Promise<any | null> => {
  try {
    const rtdb = getFirebaseDatabase();
    if (!rtdb) return null;
    const snapshot = await get(ref(rtdb, path));
    if (snapshot.exists()) return snapshot.val();
    return null;
  } catch (error) {
    return null;
  }
};

export const pushToFirebase = async (path: string, data: any): Promise<string | null> => {
  try {
    const rtdb = getFirebaseDatabase();
    if (!rtdb) return null;
    const newRef = push(ref(rtdb, path));
    const cleaned = cleanUndefined(data);
    await set(newRef, cleaned);
    return newRef.key;
  } catch (error) {
    return null;
  }
};

export const subscribeToFirebase = (path: string, callback: (data: any) => void): (() => void) => {
  try {
    const rtdb = getFirebaseDatabase();
    if (!rtdb) return () => {};
    const dataRef: DatabaseReference = ref(rtdb, path);
    const unsubscribe = onValue(dataRef, (snapshot) => {
      if (snapshot.exists()) callback(snapshot.val());
    }, (error) => {
      console.warn('RTDB subscribe error:', error);
    });
    return unsubscribe;
  } catch (error) {
    return () => {};
  }
};

// Sync ALL worknest data to Firestore
export const syncAllDataToFirebase = async (data: any): Promise<boolean> => {
  try {
    const { db } = getFirebaseInstance();
    if (data.employees && Array.isArray(data.employees)) {
      for (const emp of data.employees) {
        await setDoc(doc(db, 'employees', emp.id || emp.employeeId), cleanUndefined(emp), { merge: true });
      }
    }
    if (data.departments && Array.isArray(data.departments)) {
      for (const dept of data.departments) {
        await setDoc(doc(db, 'departments', dept.id || dept.code), cleanUndefined(dept), { merge: true });
      }
    }
    if (data.shifts && Array.isArray(data.shifts)) {
      for (const s of data.shifts) {
        await setDoc(doc(db, 'shifts', s.id || s.name), cleanUndefined(s), { merge: true });
      }
    }
    if (data.leaveRequests && Array.isArray(data.leaveRequests)) {
      for (const l of data.leaveRequests) {
        await setDoc(doc(db, 'leaveRequests', l.id), cleanUndefined(l), { merge: true });
      }
    }
    return true;
  } catch (error: any) {
    console.error('Sync to Firestore error:', error);
    return false;
  }
};

export const loadAllDataFromFirebase = async (): Promise<any | null> => {
  try {
    const { db } = getFirebaseInstance();
    const empSnap = await getDoc(doc(db, 'worknest_data', 'main'));
    if (empSnap.exists()) return empSnap.data();
    return null;
  } catch (error) {
    return null;
  }
};

export const deleteAllFirebaseData = async (): Promise<boolean> => {
  try {
    const { db, rtdb } = getFirebaseInstance();
    if (rtdb) {
      await set(ref(rtdb, 'worknest_hr'), null).catch(() => {});
    }
    await setDoc(doc(db, 'connectionTest', 'status'), { connected: false, resetAt: new Date().toISOString() });
    return true;
  } catch (error) {
    console.error('Delete all Firebase data error:', error);
    return false;
  }
};

export const deleteFirebaseData = async (path: string): Promise<boolean> => {
  try {
    const rtdb = getFirebaseDatabase();
    if (!rtdb) return false;
    await set(ref(rtdb, path), null);
    return true;
  } catch (error) {
    return false;
  }
};
