// ZKTeco Webhook Handler - Writes to BOTH Firestore and Realtime DB
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { ref, set } from 'firebase/database';
import { initializeFirebase } from './firebase';
import { findShiftByNameOrId, isShiftOvernight, offsetDateStr, resolveEmployeeShiftNameForDate } from '../utils/attendanceScheduleEngine';

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

// ZKTeco device punch format
export type ZktecoPunch = {
  id?: string;
  employeeCode: string;
  punchTime: string;
  punchType?: 'in' | 'out' | 'auto';
  deviceId?: string;
  deviceName?: string;
  verifyMode?: 'fingerprint' | 'face' | 'card' | 'password' | 'Fingerprint' | 'Face' | 'Card' | 'PIN' | 'UNKNOWN';
  status?: 'success' | 'failed' | 'unmatched';
  rfidCard?: string;
};

// Process incoming punch from ZKTeco device
// Grouped by Employee ID + Date: updates ONLY one attendance record for the current month
export const processZktecoPunch = async (
  punch: ZktecoPunch,
  employees: any[]
): Promise<boolean> => {
  try {
    const { firestore: fs, database: db } = initializeFirebase();

    // Parse date and time in Bangladesh (Asia/Dhaka) timezone format
    let punchDate = '';
    let timeStr = '';
    if (punch.punchTime.includes('T')) {
      punchDate = punch.punchTime.split('T')[0];
      timeStr = punch.punchTime.split('T')[1].slice(0, 5);
    } else if (punch.punchTime.includes(' ')) {
      punchDate = punch.punchTime.split(' ')[0];
      timeStr = punch.punchTime.split(' ')[1].slice(0, 5);
    } else {
      const d = new Date(punch.punchTime);
      punchDate = d.toISOString().split('T')[0];
      timeStr = d.toTimeString().slice(0, 5);
    }

    // CURRENT MONTH CHECK: Only sync running current month to Firebase
    if (!isCurrentMonth(punchDate)) {
      // Machine retains historical punches, but Firebase ignores older/future months
      return false;
    }

    const deviceId = punch.deviceId || 'NYU7251500061';

    // Find employee by code or RFID
    const employee = employees.find(
      (e: any) =>
        e.employeeId?.toLowerCase() === punch.employeeCode?.toLowerCase() ||
        e.id?.toLowerCase() === punch.employeeCode?.toLowerCase() ||
        e.rfidCard === punch.employeeCode ||
        (punch.employeeCode && String(e.employeeId || '').replace(/\D/g, '') === String(punch.employeeCode || '').replace(/\D/g, '') && String(punch.employeeCode).replace(/\D/g, '').length >= 2)
    );

    // CRITICAL: If this punch does NOT match any registered employee in the system (e.g. Boss / owner
    // who punches to enter the building but is NOT registered as an employee),
    // do NOT create or process an employee attendance record!
    if (!employee) {
      console.log(`[ZKTeco] Ignored punch for employee attendance: code '${punch.employeeCode}' is not a registered employee.`);
      return false;
    }

    const empId = employee.employeeId || employee.id;
    let resolvedCompanyId = employee?.companyId || (punch as any).companyId;
    if (!resolvedCompanyId && deviceId) {
      try {
        const devSnap = await getDoc(doc(fs, 'zkteco_devices', deviceId));
        if (devSnap.exists()) {
          resolvedCompanyId = devSnap.data()?.companyId;
        }
      } catch {}
    }
    if (!resolvedCompanyId) {
      resolvedCompanyId = 'default';
    }
    const [punchH, punchM] = timeStr.split(':').map(Number);
    const punchTotalMins = (punchH || 0) * 60 + (punchM || 0);
    const yesterdayDate = offsetDateStr(punchDate, -1);
    let handledAsYesterdayCheckout = false;

    const empShiftName = (employee?.shift || '').toLowerCase();
    const isEmpShiftEveningOrNight = empShiftName.includes('evening') || empShiftName.includes('night') || empShiftName.includes('overnight');
    const isEmpShiftFlexible = empShiftName.includes('flexible');

    // Check if yesterday had an evening, overnight, or flexible shift and this punch is early morning (00:00 - 06:30)
    if (punchTotalMins < 6 * 60 + 30) {
      const yesterdayDocId = (resolvedCompanyId && resolvedCompanyId !== 'default')
        ? `${resolvedCompanyId}_${empId}_${yesterdayDate}`
        : `${empId}_${yesterdayDate}`;
      const yesterdayRef = doc(fs, 'attendance', yesterdayDocId);
      try {
        let ySnap = await getDoc(yesterdayRef);
        let targetYesterdayRef = yesterdayRef;
        if (!ySnap.exists()) {
          const altDocId = (resolvedCompanyId && resolvedCompanyId !== 'default')
            ? `${resolvedCompanyId}_${yesterdayDate}_${empId}`
            : `${yesterdayDate}_${empId}`;
          const altRef = doc(fs, 'attendance', altDocId);
          const altSnap = await getDoc(altRef);
          if (altSnap.exists()) {
            ySnap = altSnap;
            targetYesterdayRef = altRef;
          }
        }
        const yData = ySnap.exists() ? ySnap.data() : null;

        const yHasEveningIn = yData && (
          (yData.firstPunchIn && yData.firstPunchIn !== '-' && yData.firstPunchIn >= '12:00') ||
          (yData.checkIn && yData.checkIn !== '-' && yData.checkIn >= '12:00')
        );
        const yIsOvernight = Boolean(
          yData?.isOvernight ||
          isEmpShiftEveningOrNight ||
          isEmpShiftFlexible ||
          yHasEveningIn ||
          (yData?.shiftStartTime && yData?.shiftEndTime && isShiftOvernight(yData.shiftStartTime, yData.shiftEndTime)) ||
          (yData?.shiftEndTime === '00:00') ||
          (yData?.shiftEndTime === '24:00') ||
          (yData?.shiftStartTime && yData.shiftStartTime >= '12:00')
        );

        if (yIsOvernight && (ySnap.exists() || isEmpShiftEveningOrNight || isEmpShiftFlexible)) {
          const prevCheckout = yData?.lastPunchOut || yData?.checkOut || '-';
          const updatedOut = maxTime(prevCheckout !== '-' ? prevCheckout : timeStr, timeStr);

          const [sH, sM] = (yData?.shiftStartTime || '14:00').split(':').map(Number);
          const shiftStartMins = (sH || 0) * 60 + (sM || 0);
          const [eH, eM] = (yData?.shiftEndTime === '00:00' ? [24, 0] : (yData?.shiftEndTime || '00:00').split(':').map(Number));
          let shiftEndMins = (eH || 24) * 60 + (eM || 0);
          if (shiftEndMins <= shiftStartMins) shiftEndMins += 24 * 60;

          const [outH, outM] = updatedOut.split(':').map(Number);
          const actualOutMins = (outH || 0) * 60 + (outM || 0) + 24 * 60;

          let otHours = yData?.otHours || 0;
          if (actualOutMins > shiftEndMins + 30) {
            otHours = Math.round(((actualOutMins - shiftEndMins) / 60) * 10) / 10;
          }

          const [inH, inM] = (yData?.firstPunchIn || yData?.checkIn || '14:00').split(':').map(Number);
          const actualInMins = (inH || 14) * 60 + (inM || 0);
          const workedHours = Math.round(Math.max(0, (actualOutMins - actualInMins - 60) / 60) * 10) / 10;

          await setDoc(targetYesterdayRef, {
            companyId: resolvedCompanyId,
            employeeId: empId,
            employeeName: employee?.name || 'Staff Member',
            date: yesterdayDate,
            lastPunchOut: updatedOut,
            checkOut: updatedOut,
            lastPunch: updatedOut,
            isOvernight: true,
            totalHours: workedHours > 0 ? workedHours : (yData?.totalHours || 8),
            otHours,
            isEarlyLeave: actualOutMins < shiftEndMins,
            lastUpdated: new Date().toISOString(),
          }, { merge: true });

          handledAsYesterdayCheckout = true;
        }
      } catch (e) {
        console.warn('Error checking yesterday overnight record:', e);
      }
    }

    if (handledAsYesterdayCheckout) {
      return true;
    }

    const attendanceDocId = (resolvedCompanyId && resolvedCompanyId !== 'default')
      ? `${resolvedCompanyId}_${empId}_${punchDate}`
      : `${empId}_${punchDate}`;
    const attendanceDocRef = doc(fs, 'attendance', attendanceDocId);

    // Read existing record to apply MIN(firstPunchIn) & MAX(lastPunchOut)
    let existingRecord: any = null;
    try {
      const snap = await getDoc(attendanceDocRef);
      if (snap.exists()) {
        existingRecord = snap.data();
      }
    } catch (e) {
      console.warn('Query existing attendance error:', e);
    }

    const existingFirst = existingRecord?.firstPunchIn || existingRecord?.firstPunch || existingRecord?.checkIn;
    const existingLast = existingRecord?.lastPunchOut || existingRecord?.lastPunch || existingRecord?.checkOut;

    const finalFirstPunch = minTime(existingFirst, timeStr);
    const finalLastPunch = maxTime(existingLast, timeStr);

    // Query shifts & roster for today to respect Roster precedence & exact shift rules
    let allShifts: any[] = [];
    try {
      const shiftSnap = await getDocs(collection(fs, 'shifts'));
      allShifts = shiftSnap.docs.map(d => ({ ...d.data(), id: d.id, name: (d.data().name || '').trim() }));
    } catch (e) {}

    let rosterShift: string | null = null;
    let isRosterOff = false;
    try {
      const rosterSnap = await getDocs(
        query(
          collection(fs, 'roster'),
          where('date', '==', punchDate)
        )
      );
      rosterSnap.forEach(rDoc => {
        const rData = rDoc.data();
        const rEmpId = String(rData.employeeId || '').toLowerCase().trim();
        if (rEmpId === String(empId).toLowerCase().trim() || (employee && rEmpId === String(employee.id).toLowerCase().trim())) {
          if (rData.isOffDay || String(rData.shift).toLowerCase() === 'off' || String(rData.shift).toLowerCase() === 'weekend') {
            isRosterOff = true;
          } else if (rData.shift) {
            rosterShift = rData.shift;
          }
        }
      });
    } catch (e) {
      console.warn('Roster lookup err:', e);
    }

    const assignedShiftName = rosterShift || resolveEmployeeShiftNameForDate(employee, punchDate) || employee?.shift || '';
    const matchedShift = findShiftByNameOrId(allShifts, assignedShiftName);

    const shiftStartTime = matchedShift?.startTime || '09:00';
    const shiftEndTime = matchedShift?.endTime || '18:00';
    const shiftGraceMinutes = matchedShift?.graceTime ?? 15;
    const otThresholdMinutes = matchedShift?.minOvertimeMinutes ?? 30;
    const isOvernight = isShiftOvernight(shiftStartTime, shiftEndTime);

    const [startH, startM] = shiftStartTime.split(':').map(Number);
    const shiftStartMinutes = (startH || 9) * 60 + (startM || 0);

    const [inH, inM] = finalFirstPunch.split(':').map(Number);
    const checkInMinutes = (inH || 0) * 60 + (inM || 0);

    const graceLimit = shiftStartMinutes + shiftGraceMinutes;
    const isFlexible = isRosterOff || matchedShift?.type === 'flexible' || (matchedShift?.latePolicyEnabled === false) || assignedShiftName.toLowerCase().includes('flexible');
    const isLate = isFlexible ? false : (checkInMinutes > graceLimit);
    const lateMinutes = isLate ? checkInMinutes - shiftStartMinutes : 0;
    const status = isRosterOff ? 'present' : (isLate ? 'late' : 'present');

    // Check Out Time - only present if there is a distinct second punch
    const hasCheckOut = finalFirstPunch !== finalLastPunch && finalLastPunch !== '-';
    const checkOutTime = hasCheckOut ? finalLastPunch : (existingRecord?.checkOut && existingRecord.checkOut !== '-' && existingRecord.checkOut !== finalFirstPunch ? existingRecord.checkOut : '-');

    let [endH, endM] = (shiftEndTime === '00:00' ? [24, 0] : shiftEndTime.split(':').map(Number));
    let shiftEndMinutes = (endH || 18) * 60 + (endM || 0);
    if (isOvernight && shiftEndMinutes <= shiftStartMinutes) {
      shiftEndMinutes += 24 * 60;
    }

    // Early Leave & Overtime
    let isEarlyLeave = false;
    let earlyLeaveMinutes = 0;
    let otHours = 0;

    if (checkOutTime !== '-') {
      const [outH, outM] = checkOutTime.split(':').map(Number);
      let checkOutMinutes = (outH || 0) * 60 + (outM || 0);
      if (isOvernight && checkOutMinutes <= shiftStartMinutes) {
        checkOutMinutes += 24 * 60;
      }

      if (checkOutMinutes < shiftEndMinutes) {
        isEarlyLeave = true;
        earlyLeaveMinutes = shiftEndMinutes - checkOutMinutes;
      }

      // Overtime: Must pass 10 hours required duration (600 mins = 9h work + 60m break)
      // and meet overtime qualification threshold (otThresholdMinutes)
      const totalDutyMinutes = Math.max(0, checkOutMinutes - checkInMinutes);
      const scheduledSpan = Math.max(0, shiftEndMinutes - shiftStartMinutes);
      const requiredDurationMinutes = Math.max(600, scheduledSpan); // 10 Hours

      if (totalDutyMinutes > requiredDurationMinutes) {
        const excessPast10Hours = totalDutyMinutes - requiredDurationMinutes;
        const excessPastEnd = (!isFlexible && checkOutMinutes > shiftEndMinutes)
          ? checkOutMinutes - shiftEndMinutes
          : excessPast10Hours;
        const eligibleExcess = isFlexible ? excessPast10Hours : Math.min(excessPast10Hours, excessPastEnd);

        if (eligibleExcess >= otThresholdMinutes) {
          otHours = Math.round((eligibleExcess / 60) * 10) / 10;
        }
      }
    }

    const attendanceData = {
      id: attendanceDocId,
      companyId: resolvedCompanyId,
      employeeId: empId,
      employeeCode: empId,
      employeeName: employee?.name || existingRecord?.employeeName || `Employee ${empId}`,
      department: employee?.department || existingRecord?.department || 'General',
      designation: employee?.designation || existingRecord?.designation || 'Staff',
      rfidCard: employee?.rfidCard || existingRecord?.rfidCard || '',
      date: punchDate,
      // Specified minimum aggregation fields:
      firstPunchIn: finalFirstPunch,
      lastPunchOut: checkOutTime,
      // Application compatibility:
      checkIn: finalFirstPunch,
      checkOut: checkOutTime,
      firstPunch: finalFirstPunch,
      lastPunch: hasCheckOut ? finalLastPunch : finalFirstPunch,
      status,
      isLate: isRosterOff ? false : isLate,
      lateMinutes: isRosterOff ? 0 : lateMinutes,
      isEarlyLeave,
      earlyLeaveMinutes,
      otHours,
      shiftName: isRosterOff ? 'Weekend / Off' : (matchedShift?.name || assignedShiftName || 'General Shift'),
      shiftStartTime: isRosterOff ? '--:--' : shiftStartTime,
      shiftEndTime: isRosterOff ? '--:--' : shiftEndTime,
      isOvernight,
      isWeekend: isRosterOff,
      isOff: isRosterOff,
      source: 'zkteco',
      totalPunches: (existingRecord?.totalPunches || 0) + 1,
      lastUpdated: new Date().toISOString(),
    };

    // Save processed attendance to Firestore (ONE record per Employee ID + Date)
    try {
      await setDoc(attendanceDocRef, attendanceData, { merge: true });
      // Also record to 'punches' collection so live punch machine streams and counts update immediately
      const punchDocId = (resolvedCompanyId && resolvedCompanyId !== 'default')
        ? `${resolvedCompanyId}_${empId.trim()}_${punchDate}_${timeStr.replace(':', '')}_${Date.now()}`
        : `${empId.trim()}_${punchDate}_${timeStr.replace(':', '')}_${Date.now()}`;

      await setDoc(doc(fs, 'punches', punchDocId), {
        id: punchDocId,
        companyId: resolvedCompanyId,
        employeeId: empId.trim(),
        employeeCode: empId.trim(),
        employeeName: employee?.name || 'Staff Member',
        department: employee?.department || 'General',
        date: punchDate,
        time: timeStr,
        timestamp: `${punchDate}T${timeStr}:00`,
        punchTimestamp: `${punchDate}T${timeStr}:00`,
        deviceSerialNumber: deviceId || 'ZKTeco-Machine',
        deviceName: 'Biometric Punch Machine',
        verifyMode: 'Fingerprint',
        source: 'zkteco_biometric',
        createdAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.warn('Firestore attendance / punches save failed:', e);
    }

    // Save to RTDB if available
    if (db) {
      try {
        await set(ref(db, `attendance/${empId}/${punchDate}`), attendanceData);
      } catch (e) {}
    }

    return true;
  } catch (error) {
    console.error('Process ZKTeco punch error:', error);
    return false;
  }
};

// Subscribe to ZKTeco punches from Firestore (ES module syntax, no require())
export const subscribeToZktecoPunches = (date: string, callback: (punches: any[]) => void) => {
  try {
    const { firestore: fs } = initializeFirebase();
    const unsubscribe = onSnapshot(
      collection(fs, 'punches'),
      (snapshot) => {
        const punches: any[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.date === date || (data.punchTimestamp && data.punchTimestamp.startsWith(date))) {
            punches.push({ id: docSnap.id, ...data });
          }
        });
        punches.sort((a, b) => (a.punchTimestamp || '').localeCompare(b.punchTimestamp || ''));
        callback(punches);
      },
      (error) => {
        console.error('Subscribe to Firestore punches error:', error);
      }
    );
    return unsubscribe;
  } catch (error) {
    return () => {};
  }
};

// Push test punch
export const simulateZktecoPunch = async (
  employeeCode: string,
  punchType: 'in' | 'out' | 'auto',
  employees: any[]
): Promise<boolean> => {
  const employee = employees.find(
    (e: any) =>
      e.employeeId?.toLowerCase() === employeeCode?.toLowerCase() ||
      e.rfidCard === employeeCode
  );

  if (!employee) {
    console.error('Employee not found:', employeeCode);
    return false;
  }

  return processZktecoPunch(
    {
      employeeCode: employee.employeeId,
      punchTime: new Date().toISOString(),
      punchType,
      deviceId: 'NYU7251500061',
      deviceName: 'ZKTeco SenseFace 2A',
      verifyMode: 'fingerprint',
      status: 'success',
    },
    employees
  );
};

// Configurable via environment variable; defaults to empty until user deploys webhook
export const WEBHOOK_URL: string = (import.meta.env?.VITE_ZKTECO_WEBHOOK_URL as string) || '';
