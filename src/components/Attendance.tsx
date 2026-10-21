import { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { collection, onSnapshot, query, where, orderBy, limit, doc, deleteDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firestoreService';
import { ZKTecoPunchTriggerModal } from './ZKTecoPunchTriggerModal';
import { BiometricCollectModal } from './BiometricCollectModal';
import { AttendanceImportModal } from './AttendanceImportModal';
import { formatTo12Hour } from '../utils/timeFormat';
import { Avatar } from './Avatar';
import {
  resolveEmployeeScheduleForDate,
  resolveEmployeeShiftNameForDate,
  findShiftByNameOrId,
  isShiftOvertimeEnabled,
  offsetDateStr,
  calculateDutyDuration,
  calculateOvertimeHours,
  isShiftOvernight,
  isEveningOrOvernight,
  normalizeTimeStr,
  getBangladeshTodayStr,
  isEmployeeEligibleForAttendance
} from '../utils/attendanceScheduleEngine';
import {
  IconFingerprint,
  IconClock,
  IconCheck,
  IconSearch,
  IconCalendar,
  IconUsers
} from './Icons';

export function Attendance() {
  const {
    employees, allEmployees, shifts, roster, devices, addNotification,
    attendanceRequests, updateAttendanceRequestStatus, branches, activeBranch, setActiveBranch, getEmployeeBranch,
    offboardingRecords
  } = useData();
  const { currentCompanyId } = useTenant();
  const activeTenant = currentCompanyId || 'default';
  const [todayStr, setTodayStr] = useState<string>(() => getBangladeshTodayStr());
  const [selectedDate, setSelectedDate] = useState<string>(() => getBangladeshTodayStr());
  const [showInactiveEmployees, setShowInactiveEmployees] = useState(false);
  const [search, setSearch] = useState<string>(() => {
    try {
      const q = sessionStorage.getItem('worknest_global_search_query');
      if (q) {
        sessionStorage.removeItem('worknest_global_search_query');
        return q;
      }
    } catch {}
    return '';
  });

  // Automatically roll over todayStr and selectedDate at 12:00 AM midnight (Asia/Dhaka)
  useEffect(() => {
    const checkMidnight = () => {
      const current = getBangladeshTodayStr();
      setTodayStr(prev => {
        if (prev !== current) {
          setSelectedDate(sel => (sel === prev ? current : sel));
          return current;
        }
        return prev;
      });
    };
    const timer = setInterval(checkMidnight, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleGlobalSearch = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.query !== undefined) {
        setSearch(String(detail.query));
      }
    };
    window.addEventListener('worknest-global-search', handleGlobalSearch);
    return () => window.removeEventListener('worknest-global-search', handleGlobalSearch);
  }, []);
  const [statusFilter, setStatusFilter] = useState<'all' | 'present' | 'late' | 'absent' | 'weekend_off'>('all');
  const [isPunchModalOpen, setIsPunchModalOpen] = useState(false);
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // View switch: Daily sheet vs Late & Early requests review
  const [attendanceView, setAttendanceView] = useState<'sheet' | 'requests'>('sheet');
  const [requestFilter, setRequestFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Edit Check-In / Check-Out Time Modal State
  const [editingAttendance, setEditingAttendance] = useState<{
    employee: any;
    date: string;
    checkIn: string;
    checkOut: string;
    status: 'auto' | 'present' | 'late' | 'absent' | 'weekend_off';
    isLateExcused: boolean;
    remarks: string;
    otHours: number;
    docId: string | null;
  } | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [selectedProofRow, setSelectedProofRow] = useState<any | null>(null);

  // Real-time Firestore records
  const [firestoreAttendance, setFirestoreAttendance] = useState<any[]>([]);
  const [firestorePunches, setFirestorePunches] = useState<any[]>([]);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // 1. Real-time Subscription to Firestore collection 'attendance' for selected date window (yesterday, today, tomorrow)
  useEffect(() => {
    try {
      const yesterdayDate = offsetDateStr(selectedDate, -1);
      const tomorrowDate = offsetDateStr(selectedDate, 1);
      const targetDates = [yesterdayDate, selectedDate, tomorrowDate];

      const q = query(collection(db, 'attendance'), where('date', 'in', targetDates));

      const unsub = onSnapshot(q, (snapshot) => {
        setIsLiveConnected(true);
        setConnectionError(null);
        const docs: any[] = [];
        snapshot.forEach(docSnap => {
          const d = docSnap.data();
          const docComp = d.companyId || 'default';
          const matchComp = activeTenant !== 'default'
            ? (!d.companyId || docComp === 'default' || docComp === activeTenant)
            : (!d.companyId || docComp === 'default');
          if (matchComp && targetDates.includes(d.date)) {
            docs.push({ id: docSnap.id, ...d });
          }
        });
        setFirestoreAttendance(docs);
      }, (err) => {
        console.warn('Firestore attendance onSnapshot error fallback:', err);
        const fallbackQ = query(collection(db, 'attendance'), where('date', '==', selectedDate));

        const singleUnsub = onSnapshot(fallbackQ, (snap) => {
          setIsLiveConnected(true);
          setConnectionError(null);
          const docs: any[] = [];
          snap.forEach(d => {
            const data = d.data();
            const docComp = data.companyId || 'default';
            const matchComp = activeTenant !== 'default'
              ? (!data.companyId || docComp === 'default' || docComp === activeTenant)
              : (!data.companyId || docComp === 'default');
            if (matchComp && (!data.date || targetDates.includes(data.date))) {
              docs.push({ id: d.id, ...data });
            }
          });
          setFirestoreAttendance(docs);
        }, (singleErr) => {
          console.warn('Firestore attendance fallback err:', singleErr);
          setIsLiveConnected(false);
          if (singleErr?.message?.includes('permission-denied') || singleErr?.code === 'permission-denied') {
            setConnectionError("Firestore Permission Denied. Please enable Read/Write in your Firebase Rules.");
          }
        });
        return () => singleUnsub();
      });
      return () => unsub();
    } catch (e: any) {
      console.warn('Could not connect to Firestore attendance:', e);
      setIsLiveConnected(false);
    }
  }, [selectedDate, activeTenant]);

  // 2. Real-time Subscription to Firestore collection 'punches' for selected date window (yesterday, today, tomorrow)
  useEffect(() => {
    const normalizeRawPunch = (docId: string, data: any) => {
      const rawTs = String(data.punchTimestamp || data.timestamp || data.createdAt || '').trim();
      let pDate = data.date || '';
      if (!pDate && rawTs) {
        if (rawTs.includes('T') && (rawTs.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(rawTs))) {
          const dt = new Date(rawTs);
          if (!isNaN(dt.getTime())) {
            pDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(dt);
          }
        }
        if (!pDate) {
          pDate = rawTs.includes('T') ? rawTs.split('T')[0] : rawTs.split(' ')[0];
        }
      }

      let pTime = data.punchTime || data.time || '';
      if (!pTime && rawTs) {
        if (rawTs.includes('T') && (rawTs.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(rawTs))) {
          const dt = new Date(rawTs);
          if (!isNaN(dt.getTime())) {
            pTime = new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Asia/Dhaka',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false
            }).format(dt);
          }
        } else if (rawTs.includes('T')) {
          pTime = rawTs.split('T')[1]?.slice(0, 8) || '';
        } else if (rawTs.includes(' ')) {
          const timePart = rawTs.split(' ').find((part: string) => part.includes(':'));
          if (timePart) pTime = timePart.slice(0, 8);
        }
      }

      const empCode = String(data.employeeId || data.employeeCode || data.pin || '').trim();
      const verifyLabel = data.verifyMode || (
        data.verify === 15 || data.verify === '15' ? 'Face' :
        data.verify === 1 || data.verify === '1' ? 'Fingerprint' :
        data.verify === 4 || data.verify === '4' ? 'Card' :
        data.verify === 3 || data.verify === '3' ? 'Password' : 'Biometric'
      );

      return {
        id: docId,
        ...data,
        employeeId: empCode || data.employeeId,
        verifyMode: verifyLabel,
        date: pDate,
        time: pTime,
        punchTime: pTime,
        sortKey: `${pDate || ''}_${pTime || rawTs || ''}`
      };
    };

    try {
      const yesterdayDate = offsetDateStr(selectedDate, -1);
      const tomorrowDate = offsetDateStr(selectedDate, 1);
      const targetDates = [yesterdayDate, selectedDate, tomorrowDate];

      const q = activeTenant !== 'default'
        ? query(collection(db, 'punches'), where('companyId', '==', activeTenant), limit(200))
        : query(collection(db, 'punches'), where('date', 'in', targetDates), limit(200));

      const unsub = onSnapshot(q, (snapshot) => {
        const rawPunches: any[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          const docComp = data.companyId || 'default';
          const matchComp = activeTenant !== 'default' ? docComp === activeTenant : (docComp === 'default');
          const normalized = normalizeRawPunch(docSnap.id, data);
          if (matchComp && (!selectedDate || targetDates.includes(normalized.date))) {
            rawPunches.push(normalized);
          }
        });
        rawPunches.sort((a, b) => (b.sortKey || '').localeCompare(a.sortKey || ''));
        setFirestorePunches(rawPunches);
      }, (err) => {
        console.warn('Firestore punches bounded query fallback:', err);
        const fallbackQ = activeTenant !== 'default'
          ? query(collection(db, 'punches'), where('companyId', '==', activeTenant), limit(100))
          : query(collection(db, 'punches'), orderBy('punchTimestamp', 'desc'), limit(100));

        const simpleUnsub = onSnapshot(fallbackQ, (snap) => {
          const raw: any[] = [];
          snap.forEach(d => {
            const data = d.data();
            const docComp = data.companyId || 'default';
            const matchComp = activeTenant !== 'default' ? docComp === activeTenant : (docComp === 'default');
            const normalized = normalizeRawPunch(d.id, data);
            if (matchComp && (!selectedDate || targetDates.includes(normalized.date))) {
              raw.push(normalized);
            }
          });
          raw.sort((a, b) => (b.sortKey || '').localeCompare(a.sortKey || ''));
          setFirestorePunches(raw);
        }, (fallbackErr) => {
          console.warn('Fallback punches error:', fallbackErr);
        });
        return () => simpleUnsub();
      });
      return () => unsub();
    } catch (e: any) {
      console.warn('Could not connect to Firestore punches:', e);
    }
  }, [selectedDate, activeTenant]);

  // Map each employee to attendance record for the selected date
  const processedAttendance = employees.map(emp => {
    const yesterdayDate = offsetDateStr(selectedDate, -1);
    const tomorrowDate = offsetDateStr(selectedDate, 1);

    // Helper to match employee in Firestore attendance
    const isEmpMatch = (att: any) => {
      const aId = String(att.employeeId || att.employeeCode || '').toLowerCase().trim();
      const eId = String(emp.employeeId || '').toLowerCase().trim();
      const eMainId = String(emp.id || '').toLowerCase().trim();
      if (!aId) return false;
      if (aId === eId || aId === eMainId) return true;
      const aDigits = aId.replace(/\D/g, '');
      const eDigits = eId.replace(/\D/g, '');
      if (aDigits && eDigits && aDigits === eDigits && aDigits.length >= 2) return true;
      return false;
    };

    const yesterdayMatch = firestoreAttendance.find(
      att => isEmpMatch(att) && (att.date === yesterdayDate || att.id?.includes(yesterdayDate) || att.punchTimestamp?.startsWith(yesterdayDate))
    );

    const match = firestoreAttendance.find(
      att => isEmpMatch(att) && (att.date === selectedDate || att.id?.includes(selectedDate) || att.punchTimestamp?.startsWith(selectedDate))
    );

    const tomorrowMatch = firestoreAttendance.find(
      att => isEmpMatch(att) && (att.date === tomorrowDate || att.id?.includes(tomorrowDate) || att.punchTimestamp?.startsWith(tomorrowDate))
    );

    // 1. Resolve authoritative date-wise schedule for this employee on selectedDate (Roster -> Date-Wise Shift History -> Record Shift -> Assigned Shift)
    const schedule = resolveEmployeeScheduleForDate(emp, selectedDate, roster, shifts, match?.shiftName);
    const yesterdaySchedule = resolveEmployeeScheduleForDate(emp, yesterdayDate, roster, shifts, yesterdayMatch?.shiftName);

    const dateShiftName = resolveEmployeeShiftNameForDate(emp, selectedDate, match?.shiftName).toLowerCase();
    const yesterdayShiftName = resolveEmployeeShiftNameForDate(emp, yesterdayDate, yesterdayMatch?.shiftName).toLowerCase();

    const isEmpFlexible = schedule.shift?.type === 'flexible' ||
      schedule.shiftName.toLowerCase().includes('flexible') ||
      schedule.shiftName.toLowerCase().includes('flexi') ||
      dateShiftName.includes('flexible') ||
      dateShiftName.includes('flexi');

    const isYesterdayEmpFlexible = yesterdaySchedule.shift?.type === 'flexible' ||
      yesterdaySchedule.shiftName.toLowerCase().includes('flexible') ||
      yesterdaySchedule.shiftName.toLowerCase().includes('flexi') ||
      yesterdayShiftName.includes('flexible') ||
      yesterdayShiftName.includes('flexi');

    const isTodayOvernightOrEvening = schedule.isOvernight || isEveningOrOvernight(schedule) || isEmpFlexible || (
      schedule.startTime && schedule.startTime !== '--:--' && schedule.startTime >= '12:00' && (schedule.endTime === '00:00' || schedule.endTime === '24:00' || schedule.endTime >= '21:00')
    );
    const isYesterdayOvernightOrEvening = yesterdaySchedule.isOvernight || isEveningOrOvernight(yesterdaySchedule) || isYesterdayEmpFlexible || (
      yesterdaySchedule.startTime && yesterdaySchedule.startTime !== '--:--' && yesterdaySchedule.startTime >= '12:00' && (yesterdaySchedule.endTime === '00:00' || yesterdaySchedule.endTime === '24:00' || yesterdaySchedule.endTime >= '21:00')
    );

    // 2. Filter raw punches from firestorePunches for this employee
    const allEmpPunches = firestorePunches.filter(p => {
      const pEmpId = String(p.employeeId || p.employeeCode || '').toLowerCase().trim();
      const eId = String(emp.employeeId || '').toLowerCase().trim();
      const eMainId = String(emp.id || '').toLowerCase().trim();
      if (!pEmpId) return false;
      if (pEmpId === eId || pEmpId === eMainId) return true;
      const pDigits = pEmpId.replace(/\D/g, '');
      const eDigits = eId.replace(/\D/g, '');
      return Boolean(pDigits && eDigits && pDigits === eDigits && pDigits.length >= 2);
    });

    // Helper to extract clean HH:mm from punch record
    const getCleanTime = (p: any): string | null => {
      const extractFromTs = (ts?: string) => {
        if (!ts) return null;
        if (ts.includes('T') && !ts.endsWith('Z')) return ts.split('T')[1]?.slice(0, 5);
        if (ts.includes(' ')) {
          const tPart = ts.split(' ').find((s: string) => s.includes(':'));
          return tPart ? tPart.slice(0, 5) : null;
        }
        return null;
      };
      const raw = p.time || p.punchTime || extractFromTs(p.punchTimestamp) || extractFromTs(p.timestamp);
      return raw ? normalizeTimeStr(raw) : null;
    };

    // Punches strictly on selectedDate
    const todayPunchObjects = allEmpPunches.filter(
      p => (p.date === selectedDate || (!p.date && (p.punchTimestamp?.startsWith(selectedDate) || p.timestamp?.startsWith(selectedDate))))
    );

    const todayRawPunches = todayPunchObjects
      .map(getCleanTime)
      .filter(Boolean) as string[];

    todayRawPunches.sort();

    // Punches on yesterdayDate
    const yesterdayRawPunches = allEmpPunches
      .filter(p => (p.date === yesterdayDate || (!p.date && (p.punchTimestamp?.startsWith(yesterdayDate) || p.timestamp?.startsWith(yesterdayDate)))))
      .map(getCleanTime)
      .filter(Boolean) as string[];

    yesterdayRawPunches.sort();

    const yesterdayFirstIn = yesterdayMatch?.firstPunchIn || yesterdayMatch?.checkIn;
    const yInNorm = yesterdayFirstIn && yesterdayFirstIn !== '-' ? normalizeTimeStr(yesterdayFirstIn) : null;

    const yesterdayHadWork = yesterdayRawPunches.length > 0 || Boolean(yInNorm);
    const yesterdayHadAfternoonEveningWork = yesterdayRawPunches.some(t => {
      const [h] = t.split(':').map(Number);
      return (h || 0) >= 12;
    }) || Boolean(yInNorm && yInNorm >= '12:00');

    // OVERNIGHT CRITICAL ENGINE:
    // Any after-midnight punch (00:00 - 06:30) belongs to yesterday's shift if:
    // 1) Yesterday had afternoon/evening work (e.g. In at 1:23 PM), or
    // 2) Yesterday was an overnight/evening/flexible shift and had work, or
    // 3) Employee has another punch today in daytime (>= 07:00 AM, e.g. 10:44 AM), or
    // 4) Punch is middle of the night (< 05:30 AM) on flexible shift
    const isEarlyPunchBelongingToYesterday = (punchTime: string) => {
      if (!punchTime || punchTime === '-') return false;
      const norm = normalizeTimeStr(punchTime);
      const [h, m] = norm.split(':').map(Number);
      const punchMins = (h || 0) * 60 + (m || 0);
      if (punchMins >= 6 * 60 + 30) return false; // Punches from 06:30 AM onwards belong to today

      if (yesterdayHadAfternoonEveningWork || isYesterdayOvernightOrEvening || yesterdayHadWork) {
        return true;
      }

      const hasLaterDaytimePunch = todayRawPunches.some(t => {
        const [lh, lm] = t.split(':').map(Number);
        return ((lh || 0) * 60 + (lm || 0)) >= 7 * 60;
      }) || Boolean(
        match && (
          (match.lastPunchOut && match.lastPunchOut !== '-' && normalizeTimeStr(match.lastPunchOut) >= '07:00') ||
          (match.checkOut && match.checkOut !== '-' && normalizeTimeStr(match.checkOut) >= '07:00')
        )
      );
      if (hasLaterDaytimePunch) return true;

      return false;
    };

    let validTodayPunches = todayRawPunches.filter(t => !isEarlyPunchBelongingToYesterday(t));

    // If today had afternoon/evening work, or today is overnight/evening/flexible, checkout occurs after midnight on tomorrowDate
    const todayHadWork = todayRawPunches.length > 0 || Boolean(
      match && ((match.checkIn && match.checkIn !== '-') || (match.firstPunchIn && match.firstPunchIn !== '-'))
    );
    let overnightNextDayCheckout: string | null = null;
    if (isTodayOvernightOrEvening || todayHadWork) {
      const nextDayEarlyPunches = allEmpPunches
        .filter(p => p.date === tomorrowDate || (!p.date && (p.punchTimestamp?.startsWith(tomorrowDate) || p.timestamp?.startsWith(tomorrowDate))))
        .map(getCleanTime)
        .filter(Boolean) as string[];

      if (tomorrowMatch) {
        const tIn = tomorrowMatch.firstPunchIn || tomorrowMatch.checkIn;
        if (tIn && tIn !== '-') {
          nextDayEarlyPunches.push(normalizeTimeStr(tIn));
        }
      }

      nextDayEarlyPunches.sort();
      const earlyPunches = nextDayEarlyPunches.filter(t => {
        const [h, m] = t.split(':').map(Number);
        const mins = (h || 0) * 60 + (m || 0);
        return mins < 6 * 60 + 30;
      });
      if (earlyPunches.length > 0) {
        overnightNextDayCheckout = earlyPunches[earlyPunches.length - 1];
      }
    }

    let firstIn = '-';
    let lastOut = '-';
    let allPunches: string[] = [];

    // Admin manual edit takes top precedence if source is admin_edit
    if (match?.source === 'admin_edit') {
      firstIn = match.checkIn && match.checkIn !== '-' ? normalizeTimeStr(match.checkIn) : (match.firstPunchIn && match.firstPunchIn !== '-' ? normalizeTimeStr(match.firstPunchIn) : '-');
      lastOut = match.checkOut && match.checkOut !== '-' ? normalizeTimeStr(match.checkOut) : (match.lastPunchOut && match.lastPunchOut !== '-' ? normalizeTimeStr(match.lastPunchOut) : '-');
      if (lastOut === firstIn) lastOut = '-';
      allPunches = match.allPunches || (firstIn !== '-' ? [firstIn, ...(lastOut !== '-' ? [lastOut] : [])] : []);
    } else if (validTodayPunches.length > 0) {
      allPunches = validTodayPunches;
      firstIn = validTodayPunches[0];
      if (overnightNextDayCheckout) {
        lastOut = overnightNextDayCheckout;
        allPunches = [...validTodayPunches, `${overnightNextDayCheckout} (+1d)`];
      } else if (validTodayPunches.length > 1) {
        const candOut = validTodayPunches[validTodayPunches.length - 1];
        lastOut = candOut !== firstIn ? candOut : '-';
      } else {
        lastOut = '-';
      }
    } else if (match) {
      let mIn = match.firstPunchIn || match.checkIn || match.firstPunch || '-';
      let mOut = (match.checkOut && match.checkOut !== '-' && match.checkOut !== mIn)
        ? match.checkOut
        : ((match.lastPunchOut && match.lastPunchOut !== '-' && match.lastPunchOut !== mIn) ? match.lastPunchOut : '-');
      if (mIn !== '-' && isEarlyPunchBelongingToYesterday(mIn)) {
        if (mOut !== '-' && mOut !== mIn && !isEarlyPunchBelongingToYesterday(mOut)) {
          mIn = mOut;
          mOut = '-';
        } else {
          mIn = '-';
          mOut = '-';
        }
      }
      firstIn = mIn !== '-' ? normalizeTimeStr(mIn) : '-';
      lastOut = mOut !== '-' ? normalizeTimeStr(mOut) : '-';
      if (lastOut === firstIn) {
        lastOut = '-';
      }
      if (overnightNextDayCheckout && (lastOut === '-' || lastOut === firstIn)) {
        lastOut = overnightNextDayCheckout;
      }
      allPunches = match.allPunches || (firstIn !== '-' ? [firstIn, ...(lastOut !== '-' && lastOut !== firstIn ? [lastOut] : [])] : []);
    } else if (overnightNextDayCheckout) {
      lastOut = overnightNextDayCheckout;
    }

    // Safety guard: if checkout time is identical to check-in time, the employee has only punched ONCE
    if (lastOut !== '-' && lastOut === firstIn) {
      lastOut = '-';
    }

    const hasPunch = firstIn !== '-' || lastOut !== '-';
    let autoStatus: 'present' | 'late' | 'absent' | 'weekend_off' = 'absent';
    const isFlexibleShift = schedule.shift?.type === 'flexible' ||
      schedule.shiftName.toLowerCase().includes('flexible') ||
      schedule.shiftName.toLowerCase().includes('flexi') ||
      isEmpFlexible ||
      !schedule.latePolicyEnabled;

    if (schedule.isWeekend || schedule.isOff) {
      // 100% ROSTER-DRIVEN WEEKEND / OFF DAY
      if (hasPunch) {
        autoStatus = 'present';
      } else {
        autoStatus = 'weekend_off';
      }
    } else if (hasPunch) {
      if (firstIn !== '-') {
        // Late evaluation applies ONLY if shift is NOT flexible, latePolicyEnabled is TRUE, and shift has a fixed startTime
        if (!isFlexibleShift && schedule.latePolicyEnabled && schedule.startTime && schedule.startTime !== '--:--') {
          const [inH, inM] = firstIn.split(':').map(Number);
          const [sH, sM] = schedule.startTime.split(':').map(Number);
          const inMins = (inH || 0) * 60 + (inM || 0);
          const graceAllowed = schedule.graceTime || 0;
          const shiftLimit = (sH || 0) * 60 + (sM || 0) + graceAllowed;
          autoStatus = inMins > shiftLimit ? 'late' : 'present';
        } else {
          autoStatus = 'present';
        }
      } else {
        autoStatus = 'present';
      }
    } else {
      autoStatus = 'absent';
    }

    // Final status respecting admin override
    const finalStatus: 'present' | 'late' | 'absent' | 'weekend_off' =
      (match?.source === 'admin_edit' && match?.status && match.status !== 'auto')
        ? match.status
        : autoStatus;

    // If late was waived or excused
    const isLateExcused = Boolean(match?.isLateExcused || match?.lateWaived);

    // Duty hours & OT calculation
    const effectiveIsOvernight = Boolean(schedule.isOvernight || isTodayOvernightOrEvening || overnightNextDayCheckout || match?.isOvernight);
    const dutyCalc = calculateDutyDuration(firstIn, lastOut, effectiveIsOvernight, schedule.breakTime);
    const rawSavedHours = match?.totalHours !== undefined && match?.totalHours !== null ? Number(match.totalHours) : (match?.workHours !== undefined ? Number(match.workHours) : null);
    const workHoursNum = (firstIn === '-' || lastOut === '-')
      ? 0
      : (dutyCalc.durationHours > 0 ? dutyCalc.durationHours : (rawSavedHours !== null && rawSavedHours > 0 && rawSavedHours < 24 ? rawSavedHours : dutyCalc.netHours));

    // Authoritative Shift Name: check roster -> date-wise shift history -> match.shiftName -> employee.shift
    const dateWiseShiftName = resolveEmployeeShiftNameForDate(emp, selectedDate, match?.shiftName);
    const resolvedShiftName = schedule.isWeekend
      ? 'Weekend / Off'
      : (schedule.shiftName !== 'Unassigned'
          ? schedule.shiftName
          : (dateWiseShiftName || 'Unassigned'));

    // Resolve authoritative Shift object and check if Overtime (OT) is enabled on this shift
    const effectiveShiftObj =
      schedule.shift ||
      findShiftByNameOrId(shifts, resolvedShiftName) ||
      findShiftByNameOrId(shifts, dateWiseShiftName);

    const isOtEnabledForShift =
      !schedule.isWeekend &&
      !schedule.isOff &&
      schedule.overtimePolicyEnabled !== false &&
      isShiftOvertimeEnabled(effectiveShiftObj);

    // OT calculation using shift working hours + break threshold (strictly 0 if shift OT policy is OFF)
    const calculatedOt = isOtEnabledForShift
      ? calculateOvertimeHours(firstIn, lastOut, {
          ...schedule,
          shift: effectiveShiftObj || schedule.shift,
          overtimePolicyEnabled: isOtEnabledForShift,
          isOvernight: effectiveIsOvernight,
        })
      : 0;
    const finalOtHours = !isOtEnabledForShift
      ? 0
      : (match?.source === 'admin_edit' && match?.otHours !== undefined ? Number(match.otHours) : calculatedOt);

    const isShiftNowFlexible = isFlexibleShift || resolvedShiftName.toLowerCase().includes('flexible') || resolvedShiftName.toLowerCase().includes('flexi');

    // Resolve Verification Method (Face vs RFID vs Fingerprint vs Employee Panel Picture Upload vs Admin Edit)
    const resolvedCheckInPhoto = match?.checkInPhoto || match?.photoProof || todayPunchObjects.find((p: any) => p.photoProof || p.checkInPhoto)?.photoProof || null;
    const resolvedCheckOutPhoto = match?.checkOutPhoto || null;
    const hasPhotoProof = Boolean(resolvedCheckInPhoto || resolvedCheckOutPhoto);

    const isEmployeePanelUpload =
      hasPhotoProof ||
      match?.source === 'browser_camera' ||
      match?.source === 'employee_panel' ||
      match?.deviceSerialNumber === 'BROWSER-CAM-01' ||
      String(match?.verifyMode || '').toLowerCase().includes('picture') ||
      String(match?.verifyMode || '').toLowerCase().includes('photo') ||
      todayPunchObjects.some(
        (p: any) =>
          p.deviceSerialNumber === 'BROWSER-CAM-01' ||
          p.deviceName === 'Web Browser Camera' ||
          p.source === 'browser_camera' ||
          Boolean(p.photoProof || p.checkInPhoto)
      );

    const rawVerifyTokens = [
      match?.verifyMode,
      match?.verify !== undefined ? String(match.verify) : '',
      ...todayPunchObjects.map((p: any) => p.verifyMode || (p.verify !== undefined ? String(p.verify) : '')),
    ]
      .filter(Boolean)
      .map(v => String(v).trim().toLowerCase());

    const rawDeviceName =
      todayPunchObjects[0]?.deviceName ||
      match?.deviceName ||
      (isEmployeePanelUpload ? 'Employee Panel Web Camera' : devices[0]?.name || 'ZKTeco Biometric Terminal');
    const rawDeviceSerial =
      todayPunchObjects[0]?.deviceSerialNumber ||
      todayPunchObjects[0]?.sn ||
      match?.deviceSerialNumber ||
      (isEmployeePanelUpload ? 'EMP-PANEL-CAM' : devices[0]?.serialNumber || devices[0]?.serial || 'ZK-BIO-01');

    let verificationType: 'face' | 'rfid' | 'fingerprint' | 'photo_upload' | 'admin_edit' = 'fingerprint';
    if (isEmployeePanelUpload) {
      verificationType = 'photo_upload';
    } else if (match?.source === 'admin_edit' && todayPunchObjects.length === 0) {
      verificationType = 'admin_edit';
    } else if (rawVerifyTokens.some(t => t.includes('card') || t.includes('rfid') || t.includes('badge') || t === '4' || t === '2')) {
      verificationType = 'rfid';
    } else if (rawVerifyTokens.some(t => t.includes('face') || t.includes('facial') || t === '15')) {
      verificationType = 'face';
    } else if (rawVerifyTokens.some(t => t.includes('finger') || t.includes('fp') || t === '1' || t === '0')) {
      verificationType = 'fingerprint';
    } else if (String(rawDeviceName).toLowerCase().includes('face')) {
      verificationType = 'face';
    } else {
      verificationType = 'fingerprint';
    }

    const verificationLabel =
      verificationType === 'photo_upload'
        ? 'Picture Upload (Employee Panel)'
        : verificationType === 'face'
        ? 'Face Recognition Punch'
        : verificationType === 'rfid'
        ? 'RFID Card Punch'
        : verificationType === 'admin_edit'
        ? 'Admin Manual Time Entry'
        : 'Fingerprint Scan Punch';

    const detailedPunches = todayPunchObjects.map((p: any) => {
      const pTime = getCleanTime(p) || p.time || p.punchTime || '-';
      const pHasPhoto = Boolean(p.photoProof || p.checkInPhoto || p.deviceSerialNumber === 'BROWSER-CAM-01');
      const vModeRaw = String(p.verifyMode || p.verify || '').toLowerCase();
      const pMethod = pHasPhoto
        ? 'Picture Upload (Employee Panel)'
        : vModeRaw.includes('card') || vModeRaw.includes('rfid') || vModeRaw === '4'
        ? 'RFID Card'
        : vModeRaw.includes('face') || vModeRaw === '15'
        ? 'Face Punch'
        : 'Fingerprint';
      return {
        id: p.id,
        time: pTime,
        method: pMethod,
        deviceName: p.deviceName || rawDeviceName,
        deviceSerial: p.deviceSerialNumber || p.sn || rawDeviceSerial,
      };
    });

    const hasActualRecord = Boolean(
      hasPunch ||
      (match && (match.status === 'present' || match.status === 'late' || (match.source && match.source !== 'none'))) ||
      validTodayPunches.length > 0 ||
      todayPunchObjects.length > 0
    );

    const offRecord = offboardingRecords?.find(
      r => (emp.id && r.employeeId === emp.id) || (emp.employeeId && (r.employeeCode === emp.employeeId || r.employeeId === emp.employeeId))
    );

    const isEligible = isEmployeeEligibleForAttendance(emp, selectedDate, hasActualRecord, offRecord);

    if (!isEligible) {
      if (!showInactiveEmployees) {
        return null;
      }
      return {
        ...emp,
        date: selectedDate,
        checkIn: '-',
        checkOut: '-',
        firstPunchIn: '-',
        lastPunchOut: '-',
        status: 'inactive' as any,
        isLateExcused: false,
        lateWaived: false,
        otHours: 0,
        overtimePolicyEnabled: false,
        totalHours: 0,
        workHours: 0,
        workDurationMinutes: 0,
        source: 'none',
        verificationType: 'none',
        verificationLabel: 'Inactive / Offboarded',
        deviceName: '-',
        deviceSerialNumber: '-',
        detailedPunches: [],
        shiftName: 'Inactive / Offboarded',
        shiftStart: '--:--',
        shiftEnd: '--:--',
        shift: null,
        isOvernight: false,
        isWeekend: false,
        isOff: true,
        totalRequiredHours: 0,
        allPunches: [],
        docId: `${emp.employeeId || emp.id}_${selectedDate}`,
        checkInPhoto: null,
        checkOutPhoto: null,
      };
    }

    return {
      ...emp,
      date: selectedDate,
      checkIn: firstIn,
      checkOut: lastOut,
      firstPunchIn: firstIn,
      lastPunchOut: lastOut,
      status: finalStatus,
      isLateExcused,
      lateWaived: isLateExcused,
      otHours: finalOtHours,
      overtimePolicyEnabled: isOtEnabledForShift,
      totalHours: workHoursNum,
      workHours: workHoursNum,
      workDurationMinutes: dutyCalc.durationMinutes,
      source: match?.source || (validTodayPunches.length > 0 ? 'machine_punches' : hasPunch ? 'firestore_live' : 'none'),
      verificationType,
      verificationLabel,
      deviceName: rawDeviceName,
      deviceSerialNumber: rawDeviceSerial,
      detailedPunches,
      shiftName: resolvedShiftName,
      shiftStart: schedule.isWeekend ? '--:--' : (isShiftNowFlexible ? '--:--' : (schedule.startTime && schedule.startTime !== '--:--' ? schedule.startTime : (effectiveShiftObj?.startTime || schedule.startTime))),
      shiftEnd: schedule.isWeekend ? '--:--' : (schedule.endTime && schedule.endTime !== '--:--' ? schedule.endTime : (effectiveShiftObj?.endTime || schedule.endTime)),
      shift: effectiveShiftObj || schedule.shift,
      isOvernight: effectiveIsOvernight,
      isWeekend: schedule.isWeekend,
      isOff: schedule.isOff,
      totalRequiredHours: schedule.totalRequiredHours || effectiveShiftObj?.totalHours || (isShiftNowFlexible ? 8 : 0),
      allPunches,
      docId: match?.id || `${emp.employeeId || emp.id}_${selectedDate}`,
      checkInPhoto: resolvedCheckInPhoto,
      checkOutPhoto: resolvedCheckOutPhoto
    };
  }).filter(Boolean) as any[];

  const filtered = processedAttendance.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
                          item.employeeId.toLowerCase().includes(search.toLowerCase()) ||
                          item.department.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const presentCount = processedAttendance.filter(a => a.status === 'present').length;
  const lateCount = processedAttendance.filter(a => a.status === 'late').length;
  const absentCount = processedAttendance.filter(a => a.status === 'absent').length;
  const weekendOffCount = processedAttendance.filter(a => a.status === 'weekend_off').length;

  const handleOpenEditModal = (row: any) => {
    const checkInVal = row.checkIn && row.checkIn !== '-' ? normalizeTimeStr(row.checkIn) : '';
    const checkOutVal = row.checkOut && row.checkOut !== '-' ? normalizeTimeStr(row.checkOut) : '';
    const otAllowed = row.overtimePolicyEnabled !== false && isShiftOvertimeEnabled(row.shift);
    setEditingAttendance({
      employee: row,
      date: selectedDate,
      checkIn: checkInVal,
      checkOut: checkOutVal,
      status: row.status === 'absent' && !checkInVal ? 'absent' : (row.status || 'present'),
      isLateExcused: Boolean(row.isLateExcused || row.lateWaived),
      remarks: row.remarks || '',
      otHours: otAllowed ? (Number(row.otHours) || 0) : 0,
      docId: row.docId || null,
    });
  };

  const handleSaveAttendanceEdit = async () => {
    if (!editingAttendance) return;
    setIsSavingEdit(true);
    try {
      const { employee, date, checkIn, checkOut, remarks, isLateExcused } = editingAttendance;
      const origEmp = employees.find(e => e.id === employee.id || e.employeeId === employee.employeeId) || employee;
      const sched = resolveEmployeeScheduleForDate(origEmp, date, roster, shifts, employee.shiftName);
      const effectiveShiftObj =
        sched.shift ||
        findShiftByNameOrId(shifts, sched.shiftName) ||
        findShiftByNameOrId(shifts, resolveEmployeeShiftNameForDate(origEmp, date, employee.shiftName));
      const isOtAllowed =
        !sched.isWeekend &&
        !sched.isOff &&
        sched.overtimePolicyEnabled !== false &&
        isShiftOvertimeEnabled(effectiveShiftObj);

      const shiftStart = sched.startTime !== '--:--' ? sched.startTime : '09:00';
      const shiftEnd = sched.endTime !== '--:--' ? sched.endTime : '18:00';
      const graceTime = sched.graceTime ?? 15;

      // Status determination
      let finalStatus = editingAttendance.status;
      if (finalStatus === 'auto' || !finalStatus || (finalStatus === 'weekend_off' && checkIn)) {
        if (!checkIn) {
          finalStatus = sched.isWeekend || sched.isOff ? 'weekend_off' : 'absent';
        } else {
          const [inH, inM] = checkIn.split(':').map(Number);
          const [sH, sM] = shiftStart.split(':').map(Number);
          const inMins = (inH || 0) * 60 + (inM || 0);
          const sMins = (sH || 0) * 60 + (sM || 0) + (sched.latePolicyEnabled ? graceTime : 0);
          finalStatus = inMins > sMins ? 'late' : 'present';
        }
      }

      // Calculate OT using standard threshold (strictly 0 if shift OT policy is OFF)
      const calculatedOt = isOtAllowed
        ? calculateOvertimeHours(checkIn || '-', checkOut || '-', {
            ...sched,
            shift: effectiveShiftObj || sched.shift,
            overtimePolicyEnabled: isOtAllowed,
          })
        : 0;
      const docId = editingAttendance.docId || (activeTenant !== 'default'
        ? `${activeTenant}_${employee.employeeId || employee.id}_${date}`
        : `${employee.employeeId || employee.id}_${date}`);
      const dutyCalc = calculateDutyDuration(checkIn || '-', checkOut || '-', sched.isOvernight, sched.breakTime);
      const totalHours = dutyCalc.durationHours || dutyCalc.netHours || 0;
      const userOtHours = !isOtAllowed
        ? 0
        : (editingAttendance.otHours !== undefined && !isNaN(Number(editingAttendance.otHours)) && Number(editingAttendance.otHours) > 0
            ? Number(editingAttendance.otHours)
            : (calculatedOt || 0));

      const empBranch = getEmployeeBranch(employee);
      const empBranchObj = branches.find(b => b.name === empBranch);

      const payload = {
        companyId: activeTenant,
        date,
        employeeId: employee.employeeId || employee.id,
        employeeName: employee.name,
        department: employee.department || '',
        branch: empBranch,
        branchId: employee.branchId || empBranchObj?.id || 'BR-001',
        shiftName: sched.isWeekend ? 'Weekend / Off' : (sched.shiftName || 'Standard'),
        shiftStartTime: shiftStart,
        shiftEndTime: shiftEnd,
        firstPunchIn: checkIn || '-',
        checkIn: checkIn || '-',
        lastPunchOut: checkOut || '-',
        checkOut: checkOut || '-',
        status: finalStatus,
        isLateExcused: isLateExcused || false,
        lateWaived: isLateExcused || false,
        otHours: userOtHours,
        totalHours,
        workHours: totalHours,
        remarks: remarks || 'Manually updated by Admin',
        source: 'admin_edit',
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'attendance', docId), payload, { merge: true });

      addNotification({
        title: 'Attendance Updated',
        message: `Updated In (${checkIn || '-'}) and Out (${checkOut || '-'}) for ${employee.name} on ${date}`,
        read: false,
        type: 'attendance',
        targetPage: 'attendance'
      });

      setEditingAttendance(null);
    } catch (err: any) {
      alert('Error updating attendance: ' + err.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteRecord = async (docId: string | null, empName: string) => {
    if (!docId) return;
    if (confirm(`Remove Firestore attendance entry for ${empName}?`)) {
      try {
        await deleteDoc(doc(db, 'attendance', docId));
        addNotification({
          title: 'Record Removed',
          message: `Attendance document ${docId} deleted from Firestore`,
          read: false,
          type: 'attendance',
          targetPage: 'attendance'
        });
      } catch (e: any) {
        alert('Could not delete from Firestore: ' + e.message);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto animate-fade-in">
      {/* Header & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Attendance Management</h2>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold border flex items-center space-x-1.5 bg-emerald-50 text-emerald-700 border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Firestore Active</span>
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Real-time biometric punch stream connected to Google Cloud Firestore (<code className="bg-slate-100 text-indigo-700 px-1 py-0.5 rounded font-mono text-xs">punches</code> &amp; <code className="bg-slate-100 text-indigo-700 px-1 py-0.5 rounded font-mono text-xs">attendance</code> collections)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setIsPunchModalOpen(true)}
            className="w-full sm:w-auto px-4 sm:px-5 py-2.5 bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 hover:from-indigo-700 hover:to-violet-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md flex items-center justify-center space-x-2 transition-all cursor-pointer"
            title="Biometric Punch Machine Emulator"
          >
            <IconFingerprint size={18} />
            <span>Biometric Punch Machine</span>
          </button>

          {/* User Requested: CSV / Excel Attendance Import Feature */}
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="w-full sm:w-auto px-4 sm:px-5 py-2.5 bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-emerald-500/20 flex items-center justify-center space-x-2 transition-all cursor-pointer active:scale-95"
            title="Import attendance logs from CSV or Excel file with automatic shift and time calculations"
          >
            <span className="text-base">📄</span>
            <span>Import CSV / Excel</span>
          </button>
        </div>
      </div>

      {/* Top View Selector: Attendance Sheet vs Late/Early Requests */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setAttendanceView('sheet')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center space-x-2 ${
              attendanceView === 'sheet'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <IconCalendar size={16} />
            <span>Daily Attendance Sheet</span>
          </button>
          <button
            onClick={() => setAttendanceView('requests')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center space-x-2 ${
              attendanceView === 'requests'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>🔔 Late &amp; Early Requests</span>
            {attendanceRequests.filter(r => r.status === 'pending').length > 0 && (
              <span className="px-2 py-0.5 bg-rose-500 text-white text-[11px] font-black rounded-full animate-pulse">
                {attendanceRequests.filter(r => r.status === 'pending').length}
              </span>
            )}
          </button>
        </div>

        {attendanceView === 'sheet' && (
          <div className="flex items-center space-x-2">
            <label className="text-xs font-bold text-slate-600">Select Date:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}
      </div>

      {/* Permission Warning if Firebase Rules block read */}
      {connectionError && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start space-x-3">
          <span className="text-xl">⚠️</span>
          <div>
            <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">Firebase Rules Attention:</h4>
            <p className="text-xs text-amber-800 mt-0.5">
              Please go to <a href="https://console.firebase.google.com/project/work-nest-hr-b1642/firestore/rules" target="_blank" rel="noreferrer" className="underline font-bold text-amber-950">Firebase Console &gt; Firestore &gt; Rules</a> and ensure rules are set to: <code className="bg-white px-1.5 py-0.5 rounded border border-amber-200 font-mono">allow read, write: if true;</code>
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 1: DAILY ATTENDANCE SHEET                                            */}
      {/* ========================================================================= */}
      {attendanceView === 'sheet' && (
        <>
          {/* KPI Cards (Clickable Filter Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4">
        <button
          onClick={() => setStatusFilter('all')}
          className={`p-3.5 sm:p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            statusFilter === 'all'
              ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-md border-transparent ring-2 ring-indigo-400'
              : 'bg-white border-slate-200/80 hover:border-indigo-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider ${statusFilter === 'all' ? 'text-indigo-100' : 'text-slate-500'}`}>Total Staff</span>
            <IconUsers size={18} className={statusFilter === 'all' ? 'text-white' : 'text-indigo-600'} />
          </div>
          <div className="text-2xl sm:text-3xl font-black mt-1.5">{processedAttendance.length}</div>
          <div className={`text-[10px] sm:text-xs mt-0.5 truncate ${statusFilter === 'all' ? 'text-indigo-100' : 'text-slate-400'}`}>
            Active Staff ({processedAttendance.length})
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('present')}
          className={`p-3.5 sm:p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            statusFilter === 'present'
              ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md border-transparent ring-2 ring-emerald-400'
              : 'bg-white border-slate-200/80 hover:border-emerald-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider ${statusFilter === 'present' ? 'text-emerald-100' : 'text-slate-500'}`}>Present</span>
            <IconCheck size={18} className={statusFilter === 'present' ? 'text-white' : 'text-emerald-600'} />
          </div>
          <div className="text-2xl sm:text-3xl font-black mt-1.5 text-emerald-600" style={{ color: statusFilter === 'present' ? '#fff' : undefined }}>{presentCount}</div>
          <div className={`text-[10px] sm:text-xs mt-0.5 truncate ${statusFilter === 'present' ? 'text-emerald-100' : 'text-slate-400'}`}>On time check-in</div>
        </button>

        <button
          onClick={() => setStatusFilter('late')}
          className={`p-3.5 sm:p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            statusFilter === 'late'
              ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md border-transparent ring-2 ring-amber-400'
              : 'bg-white border-slate-200/80 hover:border-amber-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider ${statusFilter === 'late' ? 'text-amber-100' : 'text-slate-500'}`}>Late Entry</span>
            <IconClock size={18} className={statusFilter === 'late' ? 'text-white' : 'text-amber-600'} />
          </div>
          <div className="text-2xl sm:text-3xl font-black mt-1.5" style={{ color: statusFilter === 'late' ? '#fff' : '#d97706' }}>{lateCount}</div>
          <div className={`text-[10px] sm:text-xs mt-0.5 truncate ${statusFilter === 'late' ? 'text-amber-100' : 'text-slate-400'}`}>Past grace period</div>
        </button>

        <button
          onClick={() => setStatusFilter('absent')}
          className={`p-3.5 sm:p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            statusFilter === 'absent'
              ? 'bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-md border-transparent ring-2 ring-rose-400'
              : 'bg-white border-slate-200/80 hover:border-rose-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider ${statusFilter === 'absent' ? 'text-rose-100' : 'text-slate-500'}`}>Absent</span>
            <span className="text-base">❌</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black mt-1.5" style={{ color: statusFilter === 'absent' ? '#fff' : '#e11d48' }}>{absentCount}</div>
          <div className={`text-[10px] sm:text-xs mt-0.5 truncate ${statusFilter === 'absent' ? 'text-rose-100' : 'text-slate-400'}`}>Unexcused absent</div>
        </button>

        <button
          onClick={() => setStatusFilter('weekend_off')}
          className={`p-3.5 sm:p-4 rounded-2xl border text-left transition-all cursor-pointer col-span-2 sm:col-span-1 ${
            statusFilter === 'weekend_off'
              ? 'bg-gradient-to-br from-slate-600 to-slate-700 text-white shadow-md border-transparent ring-2 ring-slate-400'
              : 'bg-white border-slate-200/80 hover:border-slate-300 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider ${statusFilter === 'weekend_off' ? 'text-slate-200' : 'text-slate-500'}`}>Weekend / Off</span>
            <span className="text-base">🏖️</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black mt-1.5" style={{ color: statusFilter === 'weekend_off' ? '#fff' : '#475569' }}>{weekendOffCount}</div>
          <div className={`text-[10px] sm:text-xs mt-0.5 truncate ${statusFilter === 'weekend_off' ? 'text-slate-200' : 'text-slate-400'}`}>Roster off days</div>
        </button>
      </div>

      {/* Date Filter & Search Filter Bar */}
      <div className="p-3.5 sm:p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl flex-1 sm:flex-initial">
            <IconCalendar size={17} className="text-slate-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none w-full"
            />
          </div>
          <div className="flex items-center space-x-1.5 bg-indigo-50/80 border border-indigo-200 px-3 py-2 rounded-xl">
            <span className="text-xs">🏢</span>
            <select
              value={activeBranch}
              onChange={(e) => setActiveBranch(e.target.value)}
              className="bg-transparent text-xs sm:text-sm font-bold text-indigo-900 focus:outline-none cursor-pointer"
            >
              <option value="All">All Offices ({allEmployees.length})</option>
              {branches.map((b) => {
                const count = allEmployees.filter((emp) => getEmployeeBranch(emp) === b.name).length;
                return (
                  <option key={b.id} value={b.name}>
                    {b.isHeadOffice ? '🏢 ' : '📍 '}{b.name} ({count})
                  </option>
                );
              })}
            </select>
          </div>
          {selectedDate === todayStr && (
            <span className="px-2.5 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold rounded-xl whitespace-nowrap">
              Today's Live View
            </span>
          )}
          {/* Include Inactive Staff Toggle */}
          <label className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 cursor-pointer select-none transition-colors">
            <input
              type="checkbox"
              checked={showInactiveEmployees}
              onChange={(e) => setShowInactiveEmployees(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
            />
            <span>Include Inactive / Offboarded</span>
          </label>
        </div>
        <div className="relative w-full md:w-80">
          <IconSearch size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search employee, ID, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
        </div>
      </div>

      {/* Attendance Data Table */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="sm:hidden px-4 py-2 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
          <span>Scroll horizontally for full attendance details</span>
          <span>👉</span>
        </div>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-tight">
                <th className="py-3 px-3 whitespace-nowrap">Employee</th>
                <th className="py-3 px-2.5 whitespace-nowrap">Shift &amp; Schedule</th>
                <th className="py-3 px-2 whitespace-nowrap">Check-In</th>
                <th className="py-3 px-2 whitespace-nowrap">Check-Out</th>
                <th className="py-3 px-2 whitespace-nowrap">Working Hours</th>
                <th className="py-3 px-2 text-center whitespace-nowrap">OT Hours</th>
                <th className="py-3 px-2 whitespace-nowrap">Calculated Status</th>
                <th className="py-3 px-2 text-center whitespace-nowrap">Source &amp; Proof</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                    No employees matching the current filter.
                  </td>
                </tr>
              ) : (
                filtered.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Employee Info */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center space-x-2.5">
                        <Avatar
                          avatar={row.avatar}
                          name={row.name}
                          sizeClass="w-9 h-9"
                          textClass="text-sm font-bold"
                          roundedClass="rounded-xl"
                        />
                        <div className="min-w-0 leading-tight">
                          <p className="font-bold text-slate-900 text-xs sm:text-[13px] whitespace-nowrap">
                            {row.name}
                          </p>
                          <div className="flex items-center space-x-1.5 mt-0.5">
                            <span className="font-mono text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded shrink-0">
                              {row.employeeId || row.id}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
                              {row.department}
                            </span>
                          </div>
                          <div className="text-[11px] mt-0.5 flex items-center space-x-1.5 whitespace-nowrap">
                            <span className="font-semibold text-indigo-700 inline-flex items-center space-x-0.5">
                              <span>🏢</span>
                              <span>{getEmployeeBranch(row as any)}</span>
                            </span>
                            {row.designation && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span className="font-semibold text-slate-600">{row.designation}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Shift & Schedule */}
                    <td className="py-2.5 px-2.5 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-0.5">
                        {row.isWeekend ? (
                          <>
                            <span className="inline-flex items-center space-x-1 whitespace-nowrap font-bold text-slate-700 text-[11px] px-2 py-0.5 bg-slate-100 rounded-lg border border-slate-300">
                              <span>🏖️</span>
                              <span>Weekend / Off</span>
                            </span>
                            <p className="text-[10px] text-slate-500 whitespace-nowrap leading-tight">
                              Roster Scheduled Off
                            </p>
                          </>
                        ) : row.shiftName === 'Unassigned' || !row.shiftName ? (
                          <>
                            <span className="inline-flex items-center whitespace-nowrap font-semibold text-slate-500 text-[11px] px-2 py-0.5 bg-slate-50 rounded-lg border border-dashed border-slate-300">
                              Unassigned
                            </span>
                            <p className="text-[10px] text-slate-400 whitespace-nowrap leading-tight">
                              No Fixed Shift
                            </p>
                          </>
                        ) : row.shiftStart === '--:--' || (row.shift?.type === 'flexible') || (row.shiftName && (row.shiftName.toLowerCase().includes('flexible') || row.shiftName.toLowerCase().includes('flexi'))) ? (
                          <>
                            <div className="flex items-center space-x-1">
                              <span className="inline-flex items-center whitespace-nowrap font-bold text-indigo-900 text-[11px] px-2 py-0.5 bg-indigo-50/80 rounded-lg border border-indigo-200/70">
                                {row.shiftName}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                ⚡ Flexible
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 whitespace-nowrap leading-tight">
                              Timing: <span className="font-semibold text-slate-700">Flexible</span> ({row.shift?.flexibleMinHours || row.totalRequiredHours || 8}h)
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center space-x-1">
                              <span className="inline-flex items-center whitespace-nowrap font-bold text-indigo-900 text-[11px] px-2 py-0.5 bg-indigo-50/80 rounded-lg border border-indigo-200/70">
                                {row.shiftName}
                              </span>
                              {row.isOvernight && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
                                  🌙 Overnight
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 whitespace-nowrap leading-tight">
                              <strong className="font-mono text-slate-700">{formatTo12Hour(row.shiftStart)}</strong> - <strong className="font-mono text-slate-700">{formatTo12Hour(row.shiftEnd)}</strong>
                            </p>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Check-In */}
                    <td className="py-2.5 px-2 whitespace-nowrap">
                      {row.checkIn !== '-' ? (
                        <div className="flex items-center">
                          <span className="font-mono font-bold text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                            {formatTo12Hour(row.checkIn)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300 font-bold text-sm font-mono">-</span>
                      )}
                    </td>

                    {/* Check-Out */}
                    <td className="py-2.5 px-2 whitespace-nowrap">
                      {row.checkOut !== '-' ? (
                        <div className="flex items-center">
                          <span className="font-mono font-bold text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100">
                            {formatTo12Hour(row.checkOut)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300 font-bold text-sm font-mono">-</span>
                      )}
                    </td>

                    {/* Working Hours */}
                    <td className="py-2.5 px-2 whitespace-nowrap">
                      {row.checkIn !== '-' && row.checkOut !== '-' ? (
                        (() => {
                          const mins = row.workDurationMinutes || Math.round((Number(row.totalHours) || 0) * 60);
                          const h = Math.floor(mins / 60);
                          const m = mins % 60;
                          const decHours = (Number(row.totalHours) || (mins / 60)).toFixed(1);
                          return (
                            <div className="flex flex-col items-start">
                              <span className="font-mono font-bold text-[11px] text-slate-800 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200 whitespace-nowrap">
                                {h}h {m > 0 ? `${m}m` : '00m'}
                              </span>
                              <span className="text-[9px] text-slate-400 font-mono mt-0.5 pl-0.5">
                                ({decHours} hrs)
                              </span>
                            </div>
                          );
                        })()
                      ) : row.checkIn !== '-' && row.checkOut === '-' ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                          <span>In Progress</span>
                        </span>
                      ) : (
                        <span className="text-slate-300 font-bold text-sm font-mono">-</span>
                      )}
                    </td>

                    {/* Overtime */}
                    <td className="py-2.5 px-2 text-center whitespace-nowrap">
                      {row.otHours > 0 ? (
                        <span className="px-1.5 py-0.5 bg-violet-50 text-violet-700 font-mono font-bold text-[11px] rounded-lg border border-violet-100 whitespace-nowrap">
                          +{row.otHours}h OT
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs font-mono">-</span>
                      )}
                    </td>

                    {/* Status with Shift Calculation */}
                    <td className="py-2.5 px-2 whitespace-nowrap">
                      {row.status === 'weekend_off' && (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          <span>🏖️ Weekend / Off</span>
                        </span>
                      )}
                      {row.status === 'present' && (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          <span>Present</span>
                        </span>
                      )}
                      {row.status === 'late' && (
                        <div className="flex flex-col gap-0.5">
                          <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            row.isLateExcused
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          } whitespace-nowrap`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${row.isLateExcused ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                            <span>{row.isLateExcused ? 'Late (Excused)' : `Late (${formatTo12Hour(row.checkIn)})`}</span>
                          </span>
                          {row.isLateExcused && (
                            <span className="text-[9px] text-emerald-700 font-bold">Deduction waived</span>
                          )}
                        </div>
                      )}
                      {row.status === 'absent' && (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          <span>Absent</span>
                        </span>
                      )}
                      {row.status === 'inactive' && (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-150 bg-slate-100 text-slate-600 border border-slate-300 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          <span>Inactive / Offboarded</span>
                        </span>
                      )}
                    </td>

                    {/* Source & Photo Proof */}
                    <td className="py-2.5 px-2 text-center whitespace-nowrap text-xs font-medium">
                      {row.checkIn !== '-' || row.checkOut !== '-' ? (
                        <div className="flex items-center justify-center">
                          {(() => {
                            const isUnexcusedLate = row.status === 'late' && !row.isLateExcused;
                            return (
                              <button
                                type="button"
                                onClick={() => setSelectedProofRow(row)}
                                title="Click to inspect punch verification method (Face / RFID / Fingerprint / Employee Panel Picture)"
                                className={`group relative inline-flex items-center justify-center w-8 h-8 rounded-xl border-2 transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 ${
                                  isUnexcusedLate
                                    ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-200/80 shadow-xs shadow-amber-500/20 hover:bg-amber-200/90 hover:border-amber-500'
                                    : 'bg-emerald-100 border-emerald-400 ring-2 ring-emerald-200/80 shadow-xs shadow-emerald-500/20 hover:bg-emerald-200/90 hover:border-emerald-500'
                                }`}
                              >
                                <IconFingerprint
                                  size={20}
                                  className={`transition-colors ${
                                    isUnexcusedLate
                                      ? 'text-amber-700 group-hover:text-amber-900'
                                      : 'text-emerald-700 group-hover:text-emerald-900'
                                  }`}
                                />
                                <span
                                  className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white shadow-2xs ${
                                    isUnexcusedLate ? 'bg-amber-500' : 'bg-emerald-500'
                                  }`}
                                />
                              </button>
                            );
                          })()}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px] whitespace-nowrap">Not Punched</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end space-x-1">
                        <button
                          onClick={() => handleOpenEditModal(row)}
                          className="text-[11px] text-indigo-700 bg-indigo-50 hover:bg-indigo-100 font-bold px-2 py-1 rounded-lg border border-indigo-200 transition-all cursor-pointer whitespace-nowrap flex items-center space-x-1"
                          title="Edit Check-In and Check-Out Time"
                        >
                          <span>✏️</span>
                          <span>Edit Time</span>
                        </button>
                        {row.docId && (
                          <button
                            onClick={() => handleDeleteRecord(row.docId, row.name)}
                            className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-all cursor-pointer"
                            title="Delete Punch"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw Firestore Stream Log Viewer */}
      {(() => {
        const selectedDatePunches = firestorePunches.filter((p: any) => !selectedDate || p.date === selectedDate);
        const displayPunches = selectedDatePunches.length > 0 ? selectedDatePunches : firestorePunches;
        return (
          <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 flex items-center space-x-2">
                  <span className="text-xl">📡</span>
                  <span>Raw Firestore <code className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-mono text-sm">punches</code> Stream ({selectedDate})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Device and camera punches streamed from Google Cloud Firestore (<code className="font-mono text-slate-700">work-nest-hr-b1642</code>)</p>
              </div>
              <span className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-mono font-bold rounded-xl">
                {displayPunches.length} punch logs for date
              </span>
            </div>

            {displayPunches.length === 0 ? (
              <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl text-sm">
                No punch events in Firestore for {selectedDate}. Tap <strong>"Biometric Punch Machine"</strong> above to write a live punch.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
                {displayPunches.slice(0, 12).map((p: any) => {
                  const empCode = p.employeeId || p.employeeCode || p.pin || '';
                  const matchedEmp = allEmployees.find(
                    e => String(e.employeeId || '').trim() === String(empCode).trim() || String(e.id || '').trim() === String(empCode).trim()
                  );
                  const resolvedName = p.employeeName || matchedEmp?.name || empCode;
                  const resolvedTimeStr = p.punchTime || p.time || p.punchTimestamp || p.timestamp || p.createdAt;
                  return (
                    <div key={p.id} className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-center justify-between text-xs hover:border-indigo-300 transition-all">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold">
                          <IconFingerprint size={16} />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{resolvedName}</p>
                          <p className="text-[11px] text-slate-500">ID: {empCode} • {p.verifyMode || 'Fingerprint'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-indigo-700 text-sm bg-white px-2 py-0.5 rounded-lg border border-slate-200">
                          {formatTo12Hour(resolvedTimeStr)}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-0.5">{p.date || selectedDate}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
      </>
    )}

      {/* ========================================================================= */}
      {/* VIEW 2: LATE ARRIVAL & EARLY CHECKOUT REQUESTS REVIEW                      */}
      {/* ========================================================================= */}
      {attendanceView === 'requests' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Header & Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">Attendance Regularization &amp; Waiver Requests</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Review employee late arrival explanations and early checkout requests. Approving a late arrival excuses the penalty and waives the 3-day late salary deduction rule.
              </p>
            </div>
            <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-xl">
              {(['all', 'pending', 'approved', 'rejected'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setRequestFilter(tab)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all cursor-pointer ${
                    requestFilter === tab
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Requests List */}
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
            {attendanceRequests.filter(r => requestFilter === 'all' || r.status === requestFilter).length === 0 ? (
              <div className="py-16 text-center text-slate-400 space-y-2">
                <span className="text-4xl block">📝</span>
                <p className="text-sm font-semibold text-slate-600">No {requestFilter !== 'all' ? requestFilter : ''} attendance requests found</p>
                <p className="text-xs text-slate-400">Employees submit late arrival explanations or early checkout requests from their portal</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {attendanceRequests
                  .filter(r => requestFilter === 'all' || r.status === requestFilter)
                  .sort((a, b) => (b.appliedOn || b.date).localeCompare(a.appliedOn || a.date))
                  .map(req => (
                    <div key={req.id} className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-2 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">{req.employeeName}</span>
                          <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                            {req.employeeId}
                          </span>
                          {req.department && (
                            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                              {req.department}
                            </span>
                          )}
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                            req.type === 'late_arrival' ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800'
                          }`}>
                            {req.type === 'late_arrival' ? 'Late Arrival Waiver' : 'Early Checkout'}
                          </span>
                          <span className="text-xs text-slate-400">
                            • For Date: <strong className="text-slate-700">{req.date}</strong>
                          </span>
                        </div>

                        <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 text-xs text-slate-700">
                          <p className="font-bold text-slate-900 mb-1 flex items-center space-x-1.5">
                            <span>💬</span>
                            <span>Reason given by employee:</span>
                          </p>
                          <p className="italic text-slate-600">"{req.reason}"</p>
                          {req.actualTime && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              Punch Time: <strong className="font-mono text-slate-800">{formatTo12Hour(req.actualTime)}</strong>
                            </p>
                          )}
                          {req.attachmentDataUrl && req.attachmentName && (
                            <div className="mt-2 pt-2 border-t border-slate-200/80 flex items-center gap-2">
                              <span className="text-[11px] font-bold text-slate-600">📎 Application File:</span>
                              <a
                                href={req.attachmentDataUrl}
                                download={req.attachmentName}
                                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[11px] font-bold inline-flex items-center space-x-1.5"
                              >
                                <span>⬇️ Download {req.attachmentName}</span>
                              </a>
                            </div>
                          )}
                        </div>

                        {req.reviewRemarks && (
                          <p className="text-xs text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">
                            <strong>Admin Note:</strong> {req.reviewRemarks}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 shrink-0">
                        {req.status === 'pending' ? (
                          <>
                            <button
                              onClick={() => updateAttendanceRequestStatus(req.id, 'approved', 'Late penalty waived by Admin')}
                              className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                            >
                              <span>✅</span>
                              <span>Approve (Waive Penalty)</span>
                            </button>
                            <button
                              onClick={() => updateAttendanceRequestStatus(req.id, 'rejected', 'Declined by Admin')}
                              className="w-full sm:w-auto px-4 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                            >
                              <span>❌</span>
                              <span>Reject</span>
                            </button>
                          </>
                        ) : req.status === 'approved' ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className="px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full text-xs font-bold">
                              ✅ Approved
                            </span>
                            {req.type === 'late_arrival' && (
                              <span className="text-[10px] text-emerald-700 font-bold">
                                Late salary deduction waived
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="px-3 py-1 bg-rose-100 text-rose-800 border border-rose-200 rounded-full text-xs font-bold">
                            ❌ Rejected
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADMIN EDIT CHECK-IN & CHECK-OUT TIME                               */}
      {/* ========================================================================= */}
      {editingAttendance && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center space-x-2">
                  <span>✏️</span>
                  <span>Edit Attendance Timing</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update check-in and check-out records for <strong className="text-slate-800">{editingAttendance.employee.name}</strong> ({editingAttendance.date})
                </p>
              </div>
              <button
                onClick={() => setEditingAttendance(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center cursor-pointer text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Check-In Time</label>
                  <input
                    type="time"
                    value={editingAttendance.checkIn}
                    onChange={e => {
                      const nextIn = e.target.value;
                      setEditingAttendance(prev => {
                        if (!prev) return null;
                        const sched = resolveEmployeeScheduleForDate(prev.employee, prev.date, roster, shifts);
                        const effShift = sched.shift || findShiftByNameOrId(shifts, prev.employee.shiftName || prev.employee.shift);
                        const otAllowed = !sched.isWeekend && !sched.isOff && sched.overtimePolicyEnabled !== false && isShiftOvertimeEnabled(effShift);
                        const autoOt = otAllowed
                          ? calculateOvertimeHours(nextIn || '-', prev.checkOut || '-', { ...sched, shift: effShift || sched.shift, overtimePolicyEnabled: otAllowed })
                          : 0;
                        return { ...prev, checkIn: nextIn, otHours: autoOt };
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-bold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">Leave empty if absent</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Check-Out Time</label>
                  <input
                    type="time"
                    value={editingAttendance.checkOut}
                    onChange={e => {
                      const nextOut = e.target.value;
                      setEditingAttendance(prev => {
                        if (!prev) return null;
                        const sched = resolveEmployeeScheduleForDate(prev.employee, prev.date, roster, shifts);
                        const effShift = sched.shift || findShiftByNameOrId(shifts, prev.employee.shiftName || prev.employee.shift);
                        const otAllowed = !sched.isWeekend && !sched.isOff && sched.overtimePolicyEnabled !== false && isShiftOvertimeEnabled(effShift);
                        const autoOt = otAllowed
                          ? calculateOvertimeHours(prev.checkIn || '-', nextOut || '-', { ...sched, shift: effShift || sched.shift, overtimePolicyEnabled: otAllowed })
                          : 0;
                        return { ...prev, checkOut: nextOut, otHours: autoOt };
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-bold text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">Last punch out</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Status Override</label>
                  <select
                    value={editingAttendance.status}
                    onChange={e => setEditingAttendance(prev => prev ? { ...prev, status: e.target.value as any } : null)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="auto">Auto (Shift rules)</option>
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Overtime (Hours)</label>
                  {(() => {
                    const sched = resolveEmployeeScheduleForDate(editingAttendance.employee, editingAttendance.date, roster, shifts);
                    const effShift = sched.shift || findShiftByNameOrId(shifts, editingAttendance.employee.shiftName || editingAttendance.employee.shift);
                    const otAllowed = !sched.isWeekend && !sched.isOff && sched.overtimePolicyEnabled !== false && isShiftOvertimeEnabled(effShift);
                    return (
                      <>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="12"
                          disabled={!otAllowed}
                          value={otAllowed ? editingAttendance.otHours : 0}
                          onChange={e => setEditingAttendance(prev => prev ? { ...prev, otHours: otAllowed ? (parseFloat(e.target.value) || 0) : 0 } : null)}
                          className={`w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                            otAllowed ? 'bg-slate-50 text-slate-800' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          }`}
                        />
                        {!otAllowed && (
                          <span className="text-[10px] text-rose-500 font-semibold mt-1 block">
                            OT is disabled for this shift (No OT)
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Waive Late Penalty Checkbox */}
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-2xl">
                <label className="flex items-start space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingAttendance.isLateExcused}
                    onChange={e => setEditingAttendance(prev => prev ? { ...prev, isLateExcused: e.target.checked } : null)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-amber-950 block">Waive Late Penalty (Excused Reason)</span>
                    <span className="text-amber-800 text-[11px] leading-tight block mt-0.5">
                      When checked, this late arrival will be marked as excused and will <strong>NOT</strong> count towards the 3-day late salary deduction rule.
                    </span>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Remarks / Reason for Manual Edit</label>
                <input
                  type="text"
                  placeholder="e.g. Valid traffic delay / Biometric device missed punch"
                  value={editingAttendance.remarks}
                  onChange={e => setEditingAttendance(prev => prev ? { ...prev, remarks: e.target.value } : null)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingAttendance(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingEdit}
                onClick={handleSaveAttendanceEdit}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer flex items-center space-x-2 disabled:opacity-50"
              >
                {isSavingEdit ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Attendance Time</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: BIOMETRIC & SOURCE PROOF INSPECTOR (CLICKING FINGERPRINT LOGO)     */}
      {/* ========================================================================= */}
      {selectedProofRow && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedProofRow(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 overflow-hidden animate-scale-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Corporate Header Banner */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-sky-950 px-6 py-5 text-white flex items-center justify-between">
              <div className="flex items-center space-x-3.5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-cyan-400/20 border border-cyan-300/40 flex items-center justify-center shadow-inner">
                  <IconFingerprint size={26} className="text-cyan-300" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
                      Source &amp; Proof Verified
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-black tracking-tight mt-1">
                    {selectedProofRow.name}
                  </h3>
                  <p className="text-xs text-slate-300 font-mono">
                    ID: {selectedProofRow.employeeId || selectedProofRow.id} • {selectedProofRow.date}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProofRow(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-bold cursor-pointer transition-all"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Primary Detected Verification Method Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50/90 via-slate-50 to-sky-50/90 border border-indigo-200/80 flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-900 to-sky-900 text-cyan-300 flex items-center justify-center text-2xl shadow-md">
                    {selectedProofRow.verificationType === 'face' && '😊'}
                    {selectedProofRow.verificationType === 'rfid' && '💳'}
                    {selectedProofRow.verificationType === 'fingerprint' && <IconFingerprint size={24} className="text-cyan-300" />}
                    {selectedProofRow.verificationType === 'photo_upload' && '📸'}
                    {selectedProofRow.verificationType === 'admin_edit' && '✏️'}
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                      Detected Punch Method
                    </p>
                    <p className="text-sm sm:text-base font-black text-slate-900 mt-0.5">
                      {selectedProofRow.verificationLabel}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {selectedProofRow.verificationType === 'photo_upload'
                        ? 'Submitted via Employee Panel with Photo Verification'
                        : selectedProofRow.verificationType === 'admin_edit'
                        ? 'Manually recorded / adjusted from Admin Panel'
                        : `Collected from ${selectedProofRow.deviceName}`}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0">
                  ✓ Verified
                </span>
              </div>

              {/* 4-Method Verification Breakdown Matrix */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">
                  Verification Channel Breakdown
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    {
                      key: 'face',
                      title: 'Face Punch',
                      subtitle: 'Biometric Facial Scan',
                      icon: '😊',
                    },
                    {
                      key: 'rfid',
                      title: 'RFID Card',
                      subtitle: 'Proximity ID Card',
                      icon: '💳',
                    },
                    {
                      key: 'fingerprint',
                      title: 'Fingerprint',
                      subtitle: 'Biometric Finger Sensor',
                      icon: '🫆',
                    },
                    {
                      key: 'photo_upload',
                      title: 'Picture Upload',
                      subtitle: 'Employee Panel Check-In',
                      icon: '📸',
                    },
                  ].map(method => {
                    const isUsed = selectedProofRow.verificationType === method.key;
                    return (
                      <div
                        key={method.key}
                        className={`p-3 rounded-2xl border transition-all flex items-start justify-between ${
                          isUsed
                            ? 'bg-gradient-to-br from-slate-900 via-indigo-950 to-sky-950 text-white border-indigo-500 shadow-md'
                            : 'bg-slate-50/80 text-slate-400 border-slate-200/70 opacity-70'
                        }`}
                      >
                        <div className="flex items-start space-x-2.5">
                          <span className="text-lg mt-0.5">{method.icon}</span>
                          <div>
                            <p className={`text-xs font-black ${isUsed ? 'text-white' : 'text-slate-600'}`}>
                              {method.title}
                            </p>
                            <p className={`text-[10px] mt-0.5 ${isUsed ? 'text-cyan-200' : 'text-slate-400'}`}>
                              {method.subtitle}
                            </p>
                          </div>
                        </div>
                        {isUsed ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950 text-[9px] font-black uppercase">
                            Active
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Check-In / Check-Out & Device Details */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Check-In Time</span>
                  <span className="font-mono font-black text-sm text-emerald-700 mt-0.5 block">
                    {selectedProofRow.checkIn !== '-' ? formatTo12Hour(selectedProofRow.checkIn) : 'Not Recorded'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Check-Out Time</span>
                  <span className="font-mono font-black text-sm text-indigo-700 mt-0.5 block">
                    {selectedProofRow.checkOut !== '-' ? formatTo12Hour(selectedProofRow.checkOut) : 'Not Recorded'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Source / Terminal</span>
                  <span className="font-bold text-slate-800 mt-0.5 block truncate">
                    {selectedProofRow.deviceName}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Device Serial / ID</span>
                  <span className="font-mono font-bold text-slate-700 mt-0.5 block truncate">
                    {selectedProofRow.deviceSerialNumber}
                  </span>
                </div>
              </div>

              {/* Employee Panel Uploaded Photo Proof (if present) */}
              {(selectedProofRow.checkInPhoto || selectedProofRow.checkOutPhoto) && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    📸 Employee Panel Uploaded Picture Proof
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedProofRow.checkInPhoto && (
                      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-900">
                        <div className="px-3 py-1.5 bg-slate-800 text-white text-[11px] font-bold flex items-center justify-between">
                          <span>Check-In Photo</span>
                          <span className="font-mono text-emerald-400">{formatTo12Hour(selectedProofRow.checkIn)}</span>
                        </div>
                        <img
                          src={selectedProofRow.checkInPhoto}
                          alt="Check-In Proof"
                          className="w-full h-44 object-cover"
                        />
                      </div>
                    )}
                    {selectedProofRow.checkOutPhoto && (
                      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-900">
                        <div className="px-3 py-1.5 bg-slate-800 text-white text-[11px] font-bold flex items-center justify-between">
                          <span>Check-Out Photo</span>
                          <span className="font-mono text-cyan-400">{formatTo12Hour(selectedProofRow.checkOut)}</span>
                        </div>
                        <img
                          src={selectedProofRow.checkOutPhoto}
                          alt="Check-Out Proof"
                          className="w-full h-44 object-cover"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Individual Punch Logs for this Date */}
              {selectedProofRow.detailedPunches && selectedProofRow.detailedPunches.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Recorded Punch Log Stream ({selectedProofRow.detailedPunches.length})
                  </p>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {selectedProofRow.detailedPunches.map((pItem: any, idx: number) => (
                      <div
                        key={pItem.id || idx}
                        className="px-3 py-2 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center space-x-2">
                          <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-800 font-mono text-[10px] font-black flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-slate-800">{pItem.method}</span>
                          <span className="text-[11px] text-slate-400">• {pItem.deviceName}</span>
                        </div>
                        <span className="font-mono font-bold text-indigo-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {formatTo12Hour(pItem.time)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedProofRow(null)}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
                >
                  Close Verification View
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hardware Punch Trigger Modal */}
      <ZKTecoPunchTriggerModal
        isOpen={isPunchModalOpen}
        onClose={() => setIsPunchModalOpen(false)}
      />

      {/* User Requested: Manual Punch Collection from Hardware Machine */}
      <BiometricCollectModal
        isOpen={isCollectModalOpen}
        onClose={() => setIsCollectModalOpen(false)}
        selectedDate={selectedDate}
        onSuccess={() => {
          // Trigger any needed local refresh if required
        }}
      />

      {/* User Requested: CSV / Excel Attendance Importer with Automatic Shift & Time Calculations */}
      <AttendanceImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        selectedDate={selectedDate}
        onSuccess={() => {
          // Trigger any needed local refresh if required
        }}
      />
    </div>
  );
}
