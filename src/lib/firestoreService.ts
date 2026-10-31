import { initializeApp, getApps, deleteApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  setLogLevel,
  collection,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  query,
  where,
  limit,
  Firestore
} from 'firebase/firestore';
import { getDatabase, Database } from 'firebase/database';
import { getAuth, Auth } from 'firebase/auth';

try {
  setLogLevel('silent');
} catch {}

function initResilientFirestore(appInstance: FirebaseApp): Firestore {
  try {
    return initializeFirestore(appInstance, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    return getFirestore(appInstance);
  }
}

export interface FirebaseConfigType {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export const DEFAULT_FIREBASE_CONFIG: FirebaseConfigType = {
  apiKey: "AIzaSyDHwo-1Kmo85g0cu2FItl7PUihZ_jTavIA",
  authDomain: "work-nest-hr-b1642.firebaseapp.com",
  projectId: "work-nest-hr-b1642",
  storageBucket: "work-nest-hr-b1642.firebasestorage.app",
  messagingSenderId: "583826695092",
  appId: "1:583826695092:web:247157367639a1b90048e1"
};

export const FIREBASE_CONFIG = DEFAULT_FIREBASE_CONFIG;

export function getStoredFirebaseConfig(): FirebaseConfigType {
  try {
    const raw = localStorage.getItem('worknest_custom_firebase_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.apiKey && parsed.projectId) return parsed;
    }
  } catch {}
  return DEFAULT_FIREBASE_CONFIG;
}

export function saveStoredFirebaseConfig(config: FirebaseConfigType) {
  try {
    localStorage.setItem('worknest_custom_firebase_config', JSON.stringify(config));
  } catch {}
}

let activeApp: FirebaseApp | null = null;
let activeDb: Firestore | null = null;
let activeRtdb: Database | null = null;
let activeAuth: Auth | null = null;

export function getFirebaseInstance(): { app: FirebaseApp; db: Firestore; rtdb: Database | null; auth: Auth } {
  if (activeApp && activeDb && activeAuth) {
    return { app: activeApp, db: activeDb, rtdb: activeRtdb, auth: activeAuth };
  }
  const config = getStoredFirebaseConfig();
  const existingApps = getApps();
  if (existingApps.length > 0) {
    activeApp = existingApps[0];
  } else {
    activeApp = initializeApp(config);
  }
  activeDb = initResilientFirestore(activeApp);
  try {
    activeRtdb = getDatabase(activeApp);
  } catch (e) {
    console.warn("RTDB not configured or failed:", e);
    activeRtdb = null;
  }
  activeAuth = getAuth(activeApp);
  return { app: activeApp, db: activeDb, rtdb: activeRtdb, auth: activeAuth };
}

export async function reconfigureFirebase(newConfig: FirebaseConfigType): Promise<{ success: boolean; error?: string }> {
  try {
    saveStoredFirebaseConfig(newConfig);
    const existingApps = getApps();
    for (const ap of existingApps) {
      await deleteApp(ap);
    }
    activeApp = initializeApp(newConfig);
    activeDb = initResilientFirestore(activeApp);
    try {
      activeRtdb = getDatabase(activeApp);
    } catch {
      activeRtdb = null;
    }
    activeAuth = getAuth(activeApp);
    await setDoc(doc(activeDb, 'connectionTest', 'status'), {
      connected: true,
      projectId: newConfig.projectId,
      timestamp: new Date().toISOString()
    }, { merge: true });
    return { success: true };
  } catch (err: any) {
    console.error('Reconfigure Firebase error:', err);
    return { success: false, error: err?.message || 'Connection failed' };
  }
}

export const { app, db } = getFirebaseInstance();

export function sanitizeForFirestore<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_, val) => (val === undefined ? null : val)));
}

// 1. Sync any generic record to Firestore
export async function syncRecordToFirestore(collectionName: string, id: string, data: any, companyId?: string) {
  try {
    const { db: firestoreDb } = getFirebaseInstance();
    const resolvedCompanyId = companyId || data?.companyId || 'default';
    const clean = sanitizeForFirestore({
      ...data,
      companyId: resolvedCompanyId,
      id,
      updatedAt: new Date().toISOString()
    });
    await setDoc(doc(firestoreDb, collectionName, id), clean, { merge: true });
    return true;
  } catch (err) {
    console.error(`Failed to sync to ${collectionName}:`, err);
    return false;
  }
}

// Delete document from Firestore
export async function deleteRecordFromFirestore(collectionName: string, id: string) {
  try {
    const { db: firestoreDb } = getFirebaseInstance();
    await deleteDoc(doc(firestoreDb, collectionName, id));
    return true;
  } catch (err) {
    console.error(`Failed to delete from ${collectionName}:`, err);
    return false;
  }
}

/**
 * Dynamically computes the current running month boundaries in Bangladesh (Asia/Dhaka, UTC+6) timezone.
 */
export function getCurrentMonthRange() {
  const now = new Date();
  const bdNow = new Date(now.getTime() + 6 * 3600000);
  const curYear = bdNow.getUTCFullYear();
  const curMonth = bdNow.getUTCMonth();

  const currentMonthStart = `${curYear}-${String(curMonth + 1).padStart(2, '0')}-01`;
  const nextMonthYear = curMonth === 11 ? curYear + 1 : curYear;
  const nextMonthVal = curMonth === 11 ? 1 : curMonth + 2;
  const nextMonthStart = `${nextMonthYear}-${String(nextMonthVal).padStart(2, '0')}-01`;

  return { currentMonthStart, nextMonthStart };
}

export function isCurrentMonth(dateStr: string): boolean {
  if (!dateStr) return false;
  const { currentMonthStart, nextMonthStart } = getCurrentMonthRange();
  return dateStr >= currentMonthStart && dateStr < nextMonthStart;
}

function minTime(t1?: string, t2?: string): string {
  if (!t1 || t1 === '-') return t2 || '-';
  if (!t2 || t2 === '-') return t1 || '-';
  return t1 < t2 ? t1 : t2;
}

function maxTime(t1?: string, t2?: string): string {
  if (!t1 || t1 === '-') return t2 || '-';
  if (!t2 || t2 === '-') return t1 || '-';
  return t1 > t2 ? t1 : t2;
}

// 2. Machine -> Firebase Attendance Sync Engine:
// Syncs ONLY the current running month.
// Reduces punches to exactly ONE record per Employee ID + Date (First Punch In + Last Punch Out)
export async function recordZKTecoPunchToFirestore({
  employeeId,
  deviceSerialNumber = "NYU7251500061",
  deviceName = "ZKTeco SenseFace 2A",
  verifyMode = "Fingerprint",
  punchTimestamp = new Date().toISOString(),
  shiftStartTime = "09:00",
  shiftEndTime = "18:00",
  shiftGraceMinutes = 15,
  earlyWindowMinutes = 60, // Permitted to punch up to 1 hour (60 min) before shift start
  otThresholdMinutes = 30,
  employeeName = "Staff Member",
  department = "General",
  shiftName = "General Shift",
  photoProof = null,
  skipMonthFilter = false,
  latePolicyEnabled = true,
  overtimePolicyEnabled = true,
  maxOvertimeHours = 0,
  isFlexible = false,
  branch = 'Main Head Office (Dhaka)',
  branchId = 'BR-001',
  companyId = 'default'
}: {
  employeeId: string;
  deviceSerialNumber?: string;
  deviceName?: string;
  verifyMode?: string;
  punchTimestamp?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  shiftGraceMinutes?: number;
  earlyWindowMinutes?: number;
  otThresholdMinutes?: number;
  employeeName?: string;
  department?: string;
  shiftName?: string;
  photoProof?: string | null;
  skipMonthFilter?: boolean;
  latePolicyEnabled?: boolean;
  overtimePolicyEnabled?: boolean;
  maxOvertimeHours?: number;
  isFlexible?: boolean;
  branch?: string;
  branchId?: string;
  companyId?: string;
}) {
  try {
    const { db: firestoreDb } = getFirebaseInstance();

    // Parse date and time in Bangladesh (Asia/Dhaka) format without browser UTC drift
    let dateStr = '';
    let timeStr = '';
    if (punchTimestamp.includes('T')) {
      dateStr = punchTimestamp.split('T')[0];
      timeStr = punchTimestamp.split('T')[1].slice(0, 5);
    } else if (punchTimestamp.includes(' ')) {
      dateStr = punchTimestamp.split(' ')[0];
      timeStr = punchTimestamp.split(' ')[1].slice(0, 5);
    } else {
      const d = new Date(punchTimestamp);
      dateStr = d.toISOString().split('T')[0];
      timeStr = d.toTimeString().slice(0, 5);
    }

    const resolvedCompanyId = (companyId && String(companyId).trim() !== '') ? String(companyId).trim() : 'default';
    const cleanEmpId = String(employeeId || '').trim();
    const cleanTimeKey = timeStr.replace(/[^0-9]/g, '');

    // Write raw punch event to 'punches' collection immediately so every physical, face, or emulator punch is securely preserved
    try {
      const punchDocId = (resolvedCompanyId !== 'default')
        ? `${resolvedCompanyId}_${cleanEmpId}_${dateStr}_${cleanTimeKey}_${Date.now()}`
        : `${cleanEmpId}_${dateStr}_${cleanTimeKey}_${Date.now()}`;

      await setDoc(doc(firestoreDb, 'punches', punchDocId), sanitizeForFirestore({
        id: punchDocId,
        companyId: resolvedCompanyId,
        employeeId: cleanEmpId,
        employeeCode: cleanEmpId,
        employeeName: employeeName || 'Staff Member',
        department: department || 'General',
        branch: branch || 'Main Head Office (Dhaka)',
        branchId: branchId || 'BR-001',
        date: dateStr,
        time: timeStr,
        punchTime: timeStr,
        timestamp: `${dateStr}T${timeStr}:00`,
        punchTimestamp: punchTimestamp.includes('T') ? punchTimestamp : `${dateStr}T${timeStr}:00`,
        deviceSerialNumber: deviceSerialNumber || 'ZKTeco-Machine',
        deviceName: deviceName || 'Biometric Punch Machine',
        verifyMode: verifyMode || 'Fingerprint',
        source: photoProof ? 'browser_camera' : (verifyMode === 'Face' ? 'face_recognition' : 'zkteco_biometric'),
        photoProof: photoProof || null,
        createdAt: new Date().toISOString()
      }), { merge: true });
    } catch (pErr) {
      console.warn('Could not write raw punch to punches collection at top:', pErr);
    }

    // CURRENT MONTH CHECK: Only sync running current month to Firebase unless skipMonthFilter is set
    if (!skipMonthFilter && !isCurrentMonth(dateStr)) {
      console.warn(`[Attendance Sync] Ignored daily attendance calculation for ${dateStr} - outside running current month (raw punch preserved in punches collection).`);
      return {
        success: true,
        reason: 'Outside current running month (raw punch saved to punches)',
        status: 'recorded_punch_only',
        isFirstPunchToday: false,
        checkIn: timeStr,
        checkOut: null,
        otHours: 0
      };
    }

    // Check if this punch is an after-midnight checkout for yesterday's overnight/evening shift
    const [pH, pM] = timeStr.split(':').map(Number);
    const punchMins = (pH || 0) * 60 + (pM || 0);

    if (punchMins < 6 * 60 + 30) {
      try {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() - 1);
        const yesterdayDate = dt.toISOString().split('T')[0];

        const yesterdayDocId = (companyId && companyId !== 'default')
          ? `${companyId}_${employeeId.trim()}_${yesterdayDate}`
          : `${employeeId.trim()}_${yesterdayDate}`;
        const yesterdayRef = doc(firestoreDb, 'attendance', yesterdayDocId);
        let yesterdaySnap = await getDoc(yesterdayRef);
        let targetYesterdayRef = yesterdayRef;

        if (!yesterdaySnap.exists()) {
          const altId = (companyId && companyId !== 'default')
            ? `${companyId}_${yesterdayDate}_${employeeId.trim()}`
            : `${yesterdayDate}_${employeeId.trim()}`;
          const altRef = doc(firestoreDb, 'attendance', altId);
          const altSnap = await getDoc(altRef);
          if (altSnap.exists()) {
            yesterdaySnap = altSnap;
            targetYesterdayRef = altRef;
          }
        }

        if (yesterdaySnap.exists()) {
          const yData = yesterdaySnap.data();
          const yStart = yData.shiftStartTime || '09:00';
          const yEnd = yData.shiftEndTime || '18:00';
          const [yStartH, yStartM] = yStart.split(':').map(Number);
          const [yEndH, yEndM] = (yEnd === '00:00' ? [24, 0] : yEnd.split(':').map(Number));
          const yStartMins = (yStartH || 0) * 60 + (yStartM || 0);
          const yEndMins = (yEndH || 0) * 60 + (yEndM || 0);
          const isOvernight = yEnd === '00:00' ||
            yEnd === '24:00' ||
            yEndMins <= yStartMins ||
            yStartMins >= 12 * 60 ||
            (yData.shiftName && (yData.shiftName.toLowerCase().includes('evening') || yData.shiftName.toLowerCase().includes('night') || yData.shiftName.toLowerCase().includes('flexible') || yData.shiftName.toLowerCase().includes('flexi'))) ||
            (yData.firstPunchIn && yData.firstPunchIn !== '-' && yData.firstPunchIn >= '12:00') ||
            (yData.checkIn && yData.checkIn !== '-' && yData.checkIn >= '12:00');

          if (isOvernight) {
            // Punch belongs to yesterday's overnight/evening shift as checkOut!
            const yFirst = yData.firstPunchIn || yData.checkIn;
            const [yInH, yInM] = (yFirst && yFirst !== '-') ? yFirst.split(':').map(Number) : [yStartH, yStartM];
            const inMins = (yInH || 0) * 60 + (yInM || 0);
            const outMins = 24 * 60 + punchMins;
            const diffMins = Math.max(0, outMins - inMins);
            const netMins = Math.max(0, diffMins - 60); // 1h standard break
            const workedHours = Math.round((netMins / 60) * 10) / 10;

            let otHours = 0;
            const yOtEnabled =
              overtimePolicyEnabled !== false &&
              yData.overtimePolicyEnabled !== false &&
              yData.overtimePolicyEnabled !== 'false';
            const targetEndMins = (yEnd === '00:00' || yEnd === '24:00') ? 24 * 60 : yEndMins;
            const yScheduledSpan = Math.max(0, targetEndMins - yStartMins);
            const yRequiredSpan = Math.max(600, yScheduledSpan); // 10h (600m) threshold: 9h work + 1h break
            if (yOtEnabled && diffMins > yRequiredSpan && outMins > targetEndMins) {
              const excessMinutes = Math.min(diffMins - yRequiredSpan, outMins - targetEndMins);
              if (excessMinutes >= (otThresholdMinutes || 30)) {
                otHours = Math.round((excessMinutes / 60) * 10) / 10;
                if (maxOvertimeHours && maxOvertimeHours > 0 && otHours > maxOvertimeHours) {
                  otHours = maxOvertimeHours;
                }
              }
            }

            await setDoc(targetYesterdayRef, {
              lastPunchOut: timeStr,
              checkOut: timeStr,
              lastPunch: timeStr,
              isOvernight: true,
              totalHours: workedHours,
              otHours,
              updatedAt: new Date().toISOString()
            }, { merge: true });

            return {
              success: true,
              status: 'overnight_checkout',
              isFirstPunchToday: false,
              checkIn: yFirst,
              checkOut: timeStr,
              otHours
            };
          }
        }
      } catch (e) {
        console.warn("Overnight checkout check failed:", e);
      }
    }

    const attendanceDocId = (companyId && companyId !== 'default')
      ? `${companyId}_${employeeId.trim()}_${dateStr}`
      : `${employeeId.trim()}_${dateStr}`;
    const attendanceRef = doc(firestoreDb, 'attendance', attendanceDocId);

    // Fetch existing attendance record to maintain min(firstPunchIn) and max(lastPunchOut)
    let existingRecord: any = null;
    try {
      const existingSnap = await getDoc(attendanceRef);
      if (existingSnap.exists()) {
        existingRecord = existingSnap.data();
      }
    } catch (e) {
      console.warn("Could not query existing attendance record:", e);
    }

    const existingFirst = existingRecord?.firstPunchIn || existingRecord?.firstPunch || existingRecord?.checkIn;
    const existingLast = existingRecord?.lastPunchOut || existingRecord?.lastPunch || existingRecord?.checkOut;

    const finalFirstPunch = minTime(existingFirst, timeStr);
    const finalLastPunch = maxTime(existingLast, timeStr);

    // Calculate shift status: Present vs Late vs Early punch
    const [shiftHour, shiftMin] = shiftStartTime.split(':').map(Number);
    const shiftTotalMinutes = (shiftHour || 9) * 60 + (shiftMin || 0);

    const [endH, endM] = (shiftEndTime || "18:00").split(':').map(Number);
    const isOvernightShift = shiftEndTime === '00:00' || ((endH * 60 + (endM || 0)) <= shiftTotalMinutes);
    const shiftEndTotalMinutes = shiftEndTime === '00:00' ? 24 * 60 : (endH * 60 + (endM || 0));

    const graceAllowedMinutes = shiftTotalMinutes + (shiftGraceMinutes || 15);

    const [firstH, firstM] = finalFirstPunch.split(':').map(Number);
    const firstPunchMinutes = (firstH || 0) * 60 + (firstM || 0);

    const isFlexibleShift = isFlexible || !latePolicyEnabled || shiftName.toLowerCase().includes('flexible');
    const isLate = isFlexibleShift ? false : (firstPunchMinutes > graceAllowedMinutes);
    const lateMinutes = isLate ? firstPunchMinutes - shiftTotalMinutes : 0;
    const finalStatus = isLate ? 'late' : 'present';

    // Distinct check-out if multiple punches recorded
    const hasCheckOut = finalFirstPunch !== finalLastPunch && finalLastPunch !== '-';
    const checkOut = hasCheckOut ? finalLastPunch : (existingRecord?.checkOut && existingRecord.checkOut !== '-' && existingRecord.checkOut !== finalFirstPunch ? existingRecord.checkOut : "-");

    // Early Leave calculation
    let isEarlyLeave = false;
    let earlyLeaveMinutes = 0;
    let effectiveCheckOutMins = 0;
    if (checkOut !== "-") {
      const [outH, outM] = checkOut.split(':').map(Number);
      effectiveCheckOutMins = (outH || 0) * 60 + (outM || 0);
      if (isOvernightShift && effectiveCheckOutMins < shiftTotalMinutes) {
        effectiveCheckOutMins += 24 * 60;
      }
      if (!isFlexibleShift && effectiveCheckOutMins < shiftEndTotalMinutes) {
        isEarlyLeave = true;
        earlyLeaveMinutes = shiftEndTotalMinutes - effectiveCheckOutMins;
      }
    }

    // Overtime & Total Work Hours calculation
    // Shift rule: Working Hours (9h) + Break (60m) = 10 Hours total (600 mins).
    // Overtime only starts AFTER passing these 10 hours AND after crossing the OT qualification threshold (e.g. 30 mins).
    let otHours = 0;
    let totalHours = 0;
    if (finalFirstPunch !== "-" && checkOut !== "-") {
      const [inH, inM] = finalFirstPunch.split(':').map(Number);
      const startMinutes = (inH || 0) * 60 + (inM || 0);
      const endMinutes = effectiveCheckOutMins;
      const totalWorkMinutes = Math.max(0, endMinutes - startMinutes);
      totalHours = Math.round((totalWorkMinutes / 60) * 10) / 10;

      const scheduledShiftMinutes = Math.max(0, shiftEndTotalMinutes - shiftTotalMinutes);
      const requiredDurationMinutes = Math.max(600, scheduledShiftMinutes); // 10 Hours (600 mins)

      const otAllowed =
        overtimePolicyEnabled !== false &&
        existingRecord?.overtimePolicyEnabled !== false;

      if (otAllowed && totalWorkMinutes > requiredDurationMinutes) {
        const excessPast10Hours = totalWorkMinutes - requiredDurationMinutes;
        const excessPastEnd = (!isFlexibleShift && effectiveCheckOutMins > shiftEndTotalMinutes)
          ? effectiveCheckOutMins - shiftEndTotalMinutes
          : excessPast10Hours;
        const eligibleExcess = isFlexibleShift ? excessPast10Hours : Math.min(excessPast10Hours, excessPastEnd);

        if (eligibleExcess >= (otThresholdMinutes || 30)) {
          otHours = Math.round((eligibleExcess / 60) * 10) / 10;
          if (maxOvertimeHours && maxOvertimeHours > 0 && otHours > maxOvertimeHours) {
            otHours = maxOvertimeHours;
          }
        }
      }
    }

    const attendanceRecord = sanitizeForFirestore({
      id: attendanceDocId,
      companyId: companyId || 'default',
      employeeId: employeeId.trim(),
      employeeCode: employeeId.trim(),
      employeeName,
      department,
      branch,
      branchId,
      date: dateStr,
      // Core requested fields:
      firstPunchIn: finalFirstPunch,
      lastPunchOut: checkOut,
      // Application compatibility fields:
      checkIn: finalFirstPunch,
      checkOut,
      firstPunch: finalFirstPunch,
      lastPunch: hasCheckOut ? finalLastPunch : finalFirstPunch,
      status: finalStatus,
      isLate,
      lateMinutes,
      isEarlyLeave,
      earlyLeaveMinutes,
      otHours,
      overtimePolicyEnabled: overtimePolicyEnabled !== false,
      totalHours,
      workHours: totalHours,
      checkInPhoto: (!existingRecord || finalFirstPunch === timeStr) ? photoProof : (existingRecord.checkInPhoto || null),
      checkOutPhoto: (hasCheckOut && finalLastPunch === timeStr) ? photoProof : (existingRecord?.checkOutPhoto || null),
      totalPunches: (existingRecord?.totalPunches || 0) + 1,
      shiftName,
      shiftStartTime,
      shiftEndTime,
      verifyMode: photoProof ? 'Picture Upload (Employee Panel)' : (verifyMode || existingRecord?.verifyMode || 'Fingerprint'),
      deviceName: deviceName || existingRecord?.deviceName || 'ZKTeco Biometric Device',
      deviceSerialNumber: deviceSerialNumber || existingRecord?.deviceSerialNumber || 'ZKTeco-Machine',
      source: photoProof ? 'browser_camera' : 'zkteco_biometric',
      lastUpdated: new Date().toISOString()
    });

    // Write ONLY ONE attendance record to Firebase per Employee ID + Date
    await setDoc(attendanceRef, attendanceRecord, { merge: true });

    // Also write raw punch event to 'punches' collection so live machine punch count and stream update instantly
    try {
      const punchDocId = (companyId && companyId !== 'default')
        ? `${companyId}_${employeeId.trim()}_${dateStr}_${timeStr.replace(':', '')}_${Date.now()}`
        : `${employeeId.trim()}_${dateStr}_${timeStr.replace(':', '')}_${Date.now()}`;

      await setDoc(doc(firestoreDb, 'punches', punchDocId), sanitizeForFirestore({
        id: punchDocId,
        companyId: companyId || 'default',
        employeeId: employeeId.trim(),
        employeeCode: employeeId.trim(),
        employeeName,
        department,
        branch,
        branchId,
        date: dateStr,
        time: timeStr,
        punchTime: timeStr,
        timestamp: `${dateStr}T${timeStr}:00`,
        punchTimestamp: `${dateStr}T${timeStr}:00`,
        deviceSerialNumber: deviceSerialNumber || 'ZKTeco-Machine',
        deviceName: deviceName || 'Biometric Punch Machine',
        verifyMode: verifyMode || 'Fingerprint',
        source: 'zkteco_biometric',
        createdAt: new Date().toISOString()
      }), { merge: true });
    } catch (pErr) {
      console.warn('Could not write raw punch to punches collection:', pErr);
    }

    return {
      success: true,
      status: finalStatus,
      checkIn: finalFirstPunch,
      checkOut,
      firstPunchIn: finalFirstPunch,
      lastPunchOut: checkOut,
      isLate,
      lateMinutes,
      isEarlyLeave,
      earlyLeaveMinutes,
      otHours,
      isFirstPunchToday: !existingRecord
    };
  } catch (err) {
    console.error('Failed to record punch to Firestore:', err);
    return { success: false, status: 'error', error: err, isFirstPunchToday: false, checkIn: null, checkOut: null, otHours: 0 };
  }
}

// 3. Purge function to clean Firestore cleanly scoped strictly to the specified tenant
export async function clearFirestoreAllData(companyId: string = 'default') {
  try {
    const { db: firestoreDb } = getFirebaseInstance();
    const collectionsToClear = [
      'punches',
      'attendance',
      'employees',
      'departments',
      'shifts',
      'roster',
      'leaveRequests',
      'leaves',
      'candidates',
      'zkteco_devices',
      'messages',
      'notifications',
      'payroll_runs',
      'attendance_requests'
    ];

    for (const colName of collectionsToClear) {
      try {
        const snap = await getDocs(collection(firestoreDb, colName));
        if (snap.size > 0) {
          const batch = writeBatch(firestoreDb);
          let matchCount = 0;
          snap.forEach(d => {
            const data = d.data();
            const docComp = data.companyId || 'default';
            const matches = companyId !== 'default' ? docComp === companyId : (!data.companyId || docComp === 'default');
            if (matches) {
              batch.delete(d.ref);
              matchCount++;
            }
          });
          if (matchCount > 0) {
            await batch.commit();
          }
        }
      } catch (errCol) {
        console.warn(`Could not clear collection ${colName}:`, errCol);
      }
    }
    return true;
  } catch (err) {
    console.error('Error wiping Firestore collections:', err);
    return false;
  }
}
