import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { getFirebaseFirestore } from './firebase';
import { processZktecoPunch } from './zktecoWebhook';

export type UnifiedPunch = {
  id: string;
  employeeCode: string;
  employeeId?: string;
  employeeName?: string;
  punchTime: string;
  time?: string;
  date?: string;
  deviceId?: string;
  deviceName?: string;
  source?: string;
  raw?: any;
};

export type UnifiedAttendance = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department?: string;
  date: string;
  checkIn: string;
  checkOut: string;
  status: 'present' | 'late' | 'absent';
  otHours: number;
  allPunches: any[];
  source: 'zkteco' | 'worknest' | 'both';
  lastUpdate: string;
};

export const subscribeToAllAttendance = (
  employees: any[],
  callback: (records: UnifiedAttendance[]) => void
): (() => void) => {
  try {
    const fs = getFirebaseFirestore();
    const todayStr = new Date().toISOString().split('T')[0];

    // Primary: Read from Firestore 'attendance' collection directly (constrained to current date)
    const qAtt = query(collection(fs, 'attendance'), where('date', '==', todayStr));
    const unsubAttendance = onSnapshot(qAtt, (snapshot) => {
      const records: UnifiedAttendance[] = [];
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        records.push({
          employeeId: d.employeeId || docSnap.id,
          employeeCode: d.employeeId || '',
          employeeName: d.employeeName || 'Staff Member',
          department: d.department || 'General',
          date: d.date || todayStr,
          checkIn: d.checkIn || '-',
          checkOut: d.checkOut || '-',
          status: d.status || 'present',
          otHours: d.otHours || 0,
          allPunches: d.allPunches || [],
          source: 'zkteco',
          lastUpdate: d.lastUpdated || new Date().toISOString()
        });
      });
      if (records.length > 0) {
        callback(records);
      }
    }, (err) => {
      console.warn('Firestore attendance subscription error:', err);
    });

    // Secondary: Read from Firestore 'punches' collection directly (constrained to current date)
    const qPunches = query(collection(fs, 'punches'), where('date', '==', todayStr), limit(100));
    const unsubPunches = onSnapshot(qPunches, (snapshot) => {
      snapshot.forEach(async docSnap => {
        const p = docSnap.data();
        if (p.employeeId && p.punchTimestamp) {
          await processZktecoPunch({
            id: docSnap.id,
            employeeCode: p.employeeId,
            punchTime: p.punchTimestamp,
            deviceId: p.deviceId || 'NYU7251500061',
            deviceName: p.deviceName || 'ZKTeco SenseFace 2A',
            verifyMode: p.verifyMode || 'Fingerprint'
          }, employees);
        }
      });
    }, (err) => {
      console.warn('Firestore punches subscription error:', err);
    });

    return () => {
      unsubAttendance();
      unsubPunches();
    };
  } catch (error) {
    console.warn('Subscribe all attendance error:', error);
    return () => {};
  }
};
