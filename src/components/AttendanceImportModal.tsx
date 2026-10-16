import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useData } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firestoreService';
import { IconUpload, IconFileText, IconDownload } from './Icons';
import { formatTo12Hour } from '../utils/timeFormat';
import {
  calculateOvertimeHours,
  calculateDutyDuration,
  offsetDateStr,
  isShiftOvernight,
  findShiftByNameOrId,
  isShiftOvertimeEnabled,
  resolveEmployeeScheduleForDate
} from '../utils/attendanceScheduleEngine';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  onSuccess?: () => void;
}

interface ParsedAttendanceRow {
  employeeId: string;
  employeeName: string;
  department: string;
  date: string;
  checkIn: string;
  checkOut: string;
  allPunches: string[];
  totalPunchesCount: number;
  shiftName: string;
  shiftStartTime: string;
  shiftEndTime: string;
  status: 'present' | 'late' | 'absent';
  otHours: number;
  totalHours: number;
  matched: boolean;
  docId: string;
}

// Parse combined DateTime like "09/23/2026 10:40" or "2026-09-23 10:40:00"
function parseDateTimeStr(val: any): { date: string; time: string } | null {
  if (!val && val !== 0) return null;

  // Excel serial number with time (e.g. 46288.4444)
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) {
      const date = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      const time = `${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}`;
      return { date, time };
    }
  }

  const str = String(val).trim();
  if (!str) return null;

  // Format: "09/23/2026 10:40" or "09/23/2026 10:40:00" (MM/DD/YYYY or DD/MM/YYYY)
  const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?/i);
  if (dmyMatch && dmyMatch[4]) {
    const mOrD1 = parseInt(dmyMatch[1]);
    const mOrD2 = parseInt(dmyMatch[2]);
    const y = dmyMatch[3];
    let h = parseInt(dmyMatch[4]);
    const min = dmyMatch[5];
    const ampm = dmyMatch[7];
    if (ampm && ampm.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ampm && ampm.toUpperCase() === 'AM' && h === 12) h = 0;

    let month = mOrD1;
    let day = mOrD2;
    // Standard ZKTeco export uses MM/DD/YYYY
    if (mOrD1 > 12 && mOrD2 <= 12) {
      day = mOrD1;
      month = mOrD2;
    }
    const date = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const time = `${String(h).padStart(2, '0')}:${min}`;
    return { date, time };
  }

  // Format: "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS"
  const ymdMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = parseInt(ymdMatch[2]);
    const d = parseInt(ymdMatch[3]);
    const h = parseInt(ymdMatch[4]);
    const min = ymdMatch[5];
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const time = `${String(h).padStart(2, '0')}:${min}`;
    return { date, time };
  }

  return null;
}

function parseTimeOnly(val: any): string {
  if (!val && val !== 0) return '-';
  if (typeof val === 'number') {
    const totalSeconds = Math.round(val * 86400);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const str = String(val).trim();
  if (!str || str === '-' || str.toLowerCase() === 'null') return '-';
  if (str.includes('T')) {
    return str.split('T')[1].slice(0, 5);
  }
  const match = str.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    let h = parseInt(match[1]);
    const m = match[2];
    if (str.toLowerCase().includes('pm') && h < 12) h += 12;
    if (str.toLowerCase().includes('am') && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  return str.slice(0, 5);
}

function formatDateOnly(val: any, fallbackDate: string): string {
  if (!val) return fallbackDate;
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    let m = parseInt(dmy[1]);
    let d = parseInt(dmy[2]);
    if (m > 12 && d <= 12) {
      const temp = m;
      m = d;
      d = temp;
    }
    return `${dmy[3]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return fallbackDate;
}

export function AttendanceImportModal({ isOpen, onClose, selectedDate, onSuccess }: Props) {
  const { employees, shifts, addNotification } = useData();
  const { currentCompanyId } = useTenant();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedAttendanceRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  if (!isOpen) return null;

  const defaultDate = selectedDate || new Date().toISOString().split('T')[0];

  // Helper to find column in raw JSON
  const findVal = (row: any, candidates: string[]): any => {
    const keys = Object.keys(row);
    for (const cand of candidates) {
      const matchedKey = keys.find(k => k.trim().toLowerCase() === cand.toLowerCase());
      if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
        return row[matchedKey];
      }
    }
    for (const cand of candidates) {
      const matchedKey = keys.find(k => k.trim().toLowerCase().includes(cand.toLowerCase()));
      if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
        return row[matchedKey];
      }
    }
    return '';
  };

  // Process rows whether from ZKTeco multi-punch export OR summarized In/Out table
  const processAttendanceData = (rawJson: any[]) => {
    if (!rawJson || rawJson.length === 0) {
      setErrorMsg('No data found to process.');
      setIsProcessing(false);
      return;
    }

    // Step 1: Check if the file is ZKTeco multi-punch format (e.g. Emp ID + Punch Time)
    // In ZKTeco export, each row is ONE punch (like Image 1: 108 -> 10:40, 108 -> 11:08, 108 -> 15:09)
    type PunchLog = {
      empId: string;
      name?: string;
      date: string;
      time: string;
    };

    const isMultiPunch = rawJson.some(row => {
      const hasPunchTime = Boolean(findVal(row, ['punch time', 'punchtime', 'date time', 'datetime', 'log time', 'punch_time']));
      return hasPunchTime;
    });

    if (isMultiPunch) {
      // Collect raw punch entries first
      const rawPunchesList: Array<{
        empId: string;
        name: string;
        date: string;
        time: string;
      }> = [];

      rawJson.forEach(row => {
        const empIdRaw = findVal(row, [
          'emp id', 'empid', 'employee id', 'employeeid', 'id', 'ac-no.', 'enroll id', 'badgenumber', 'badge number', 'user id'
        ]);
        if (!empIdRaw) return;

        const empId = String(empIdRaw).trim();
        const punchTimeRaw = findVal(row, ['punch time', 'punchtime', 'date time', 'datetime', 'log time', 'punch_time']);
        const nameRaw = findVal(row, ['name', 'employee name', 'staff name']) || '';

        const dt = parseDateTimeStr(punchTimeRaw);
        const pDate = dt ? dt.date : defaultDate;
        const pTime = dt ? dt.time : parseTimeOnly(punchTimeRaw);

        if (!pTime || pTime === '-') return;
        rawPunchesList.push({ empId, name: nameRaw, date: pDate, time: pTime });
      });

      // Sort chronologically by date and time
      rawPunchesList.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

      // Group punches by employee and date, correctly handling after-midnight checkouts
      const groupedPunches: Record<string, { empId: string; name: string; date: string; punches: string[] }> = {};

      rawPunchesList.forEach(item => {
        const [pH, pM] = item.time.split(':').map(Number);
        const punchMins = (pH || 0) * 60 + (pM || 0);

        // Check if this punch is an after-midnight punch (00:00 - 06:30) belonging to yesterday's evening/overnight shift
        let targetDate = item.date;
        if (punchMins < 6 * 60 + 30) {
          const yesterdayDate = offsetDateStr(item.date, -1);
          const yesterdayKey = `${item.empId}_${yesterdayDate}`;
          const yesterdayGroup = groupedPunches[yesterdayKey];

          // Check if yesterday had an afternoon/evening punch (>= 12:00)
          const yesterdayHasEveningPunch = yesterdayGroup && yesterdayGroup.punches.some(t => {
            const [h] = t.split(':').map(Number);
            return (h || 0) >= 12;
          });

          // Check employee assigned shift
          const emp = employees.find(
            e => e.employeeId?.toString().toLowerCase() === item.empId.toLowerCase() ||
                 e.id?.toString().toLowerCase() === item.empId.toLowerCase() ||
                 String(e.employeeId).replace(/\D/g, '') === item.empId.replace(/\D/g, '')
          );
          const empShiftName = (emp?.shift || '').toLowerCase();
          const isEveningShift = empShiftName.includes('evening') || empShiftName.includes('night') || empShiftName.includes('overnight');
          const isFlexibleShift = empShiftName.includes('flexible') || empShiftName.includes('flexi');

          if (yesterdayHasEveningPunch || (yesterdayGroup && (isEveningShift || isFlexibleShift))) {
            // This early punch is yesterday's checkout punch!
            targetDate = yesterdayDate;
          }
        }

        const groupKey = `${item.empId}_${targetDate}`;
        if (!groupedPunches[groupKey]) {
          groupedPunches[groupKey] = {
            empId: item.empId,
            name: item.name,
            date: targetDate,
            punches: []
          };
        }
        if (!groupedPunches[groupKey].punches.includes(item.time)) {
          groupedPunches[groupKey].punches.push(item.time);
        }
      });

      const processed: ParsedAttendanceRow[] = [];

      Object.values(groupedPunches).forEach(group => {
        // Sort punches chronologically, accurately supporting after-midnight checkouts for overnight/flexible shifts
        const hasAfternoon = group.punches.some(t => {
          const [h] = t.split(':').map(Number);
          return (h || 0) >= 12;
        });

        group.punches.sort((a, b) => {
          const [ah, am] = a.split(':').map(Number);
          const [bh, bm] = b.split(':').map(Number);
          let aMins = (ah || 0) * 60 + (am || 0);
          let bMins = (bh || 0) * 60 + (bm || 0);
          if (hasAfternoon) {
            if (aMins < 7 * 60) aMins += 24 * 60;
            if (bMins < 7 * 60) bMins += 24 * 60;
          }
          return aMins - bMins;
        });

        // FIRST PUNCH OF THE DAY = CHECK IN!
        const checkIn = group.punches[0] || '-';
        // LAST PUNCH OF THE DAY = CHECK OUT! (if more than 1 punch, otherwise '-')
        const checkOut = group.punches.length > 1 ? group.punches[group.punches.length - 1] : '-';

        // Match with employee in software
        const emp = employees.find(
          e => e.employeeId?.toString().toLowerCase() === group.empId.toLowerCase() ||
               e.id?.toString().toLowerCase() === group.empId.toLowerCase() ||
               String(e.employeeId).replace(/\D/g, '') === group.empId.replace(/\D/g, '') ||
               (group.name && e.name.toLowerCase().includes(group.name.toLowerCase().trim()))
        );

        const empName = emp ? emp.name : (group.name || `Staff ${group.empId}`);
        const department = emp ? emp.department : 'General';

        // Shift matching
        const empShift = findShiftByNameOrId(shifts, emp?.shift) || shifts[0] || {
          name: 'Day Shift',
          startTime: '10:00',
          endTime: '20:00',
          graceTime: 15,
          overtimePolicyEnabled: true
        };

        const shiftStart = empShift.startTime || '10:00';
        const shiftEnd = empShift.endTime || '20:00';
        const grace = empShift.graceTime ?? 15;
        const isOvernight = checkOut !== '-' && (isShiftOvernight(shiftStart, shiftEnd) || checkOut < checkIn || shiftEnd === '00:00' || shiftEnd === '24:00');

        // Determine Status based on FIRST PUNCH
        let status: 'present' | 'late' | 'absent' = 'present';
        if (checkIn === '-') {
          status = 'absent';
        } else {
          const [inH, inM] = checkIn.split(':').map(Number);
          const [sH, sM] = shiftStart.split(':').map(Number);
          const inMins = inH * 60 + inM;
          const shiftLimit = sH * 60 + sM + grace;
          if (inMins > shiftLimit) {
            status = 'late';
          } else {
            status = 'present';
          }
        }

        // Calculate OT and Total Hours
        let otHours = 0;
        let totalHours = 0;
        const otEnabled = isShiftOvertimeEnabled(empShift as any);
        if (checkOut !== '-' && checkIn !== '-') {
          otHours = otEnabled ? calculateOvertimeHours(checkIn, checkOut, {
            startTime: shiftStart,
            endTime: shiftEnd,
            isOvernight,
            totalRequiredHours: empShift?.totalHours ?? 9,
            breakTime: empShift?.breakTime ?? 60,
            minOvertimeMinutes: empShift?.minOvertimeMinutes ?? 30,
            overtimePolicyEnabled: otEnabled,
            shift: empShift as any,
          }) : 0;
          const dutyCalc = calculateDutyDuration(checkIn, checkOut, isOvernight, empShift?.breakTime ?? 60);
          totalHours = dutyCalc.durationHours;
        }

        processed.push({
          employeeId: emp ? emp.employeeId : group.empId,
          employeeName: empName,
          department,
          date: group.date,
          checkIn,
          checkOut,
          allPunches: group.punches,
          totalPunchesCount: group.punches.length,
          shiftName: empShift.name,
          shiftStartTime: shiftStart,
          shiftEndTime: shiftEnd,
          status,
          otHours,
          totalHours,
          matched: Boolean(emp),
          docId: `${emp ? emp.employeeId : group.empId}_${group.date}`
        });
      });

      if (processed.length === 0) {
        setErrorMsg('Could not find valid punch records in the file.');
      } else {
        setParsedRows(processed);
      }
      setIsProcessing(false);
      return;
    }

    // Step 2: Handle Summarized In/Out Format (one row per employee with CheckIn and CheckOut)
    const processed: ParsedAttendanceRow[] = [];

    rawJson.forEach(row => {
      const empIdRaw = findVal(row, [
        'employee id', 'employeeid', 'empid', 'emp id', 'id', 'user id', 'userid',
        'badge number', 'badgenumber', 'employee code', 'employeecode', 'ac-no.', 'enroll id'
      ]);
      if (!empIdRaw) return;

      const empId = String(empIdRaw).trim();
      const rawDate = findVal(row, ['date', 'punch date', 'att date', 'attendance date', 'log date', 'day']);
      const targetDate = formatDateOnly(rawDate, defaultDate);

      const inTimeRaw = findVal(row, [
        'in time', 'intime', 'check in', 'checkin', 'time in', 'timein', 'in', 'first in', 'punch in', 'clock in'
      ]);
      const outTimeRaw = findVal(row, [
        'out time', 'outtime', 'check out', 'checkout', 'time out', 'timeout', 'out', 'last out', 'punch out', 'clock out'
      ]);

      const checkIn = parseTimeOnly(inTimeRaw);
      const checkOut = parseTimeOnly(outTimeRaw);

      const emp = employees.find(
        e => e.employeeId?.toString().toLowerCase() === empId.toLowerCase() ||
             e.id?.toString().toLowerCase() === empId.toLowerCase() ||
             String(e.employeeId).replace(/\D/g, '') === empId.replace(/\D/g, '')
      );

      const empName = emp ? emp.name : (findVal(row, ['name', 'employee name', 'staff name']) || `Staff (${empId})`);
      const department = emp ? emp.department : (findVal(row, ['department', 'dept']) || 'General');

      const empShift = findShiftByNameOrId(shifts, emp?.shift) || shifts[0] || {
        name: 'Day Shift',
        startTime: '10:00',
        endTime: '20:00',
        graceTime: 15,
        overtimePolicyEnabled: true
      };

      const shiftStart = empShift.startTime || '10:00';
      const shiftEnd = empShift.endTime || '20:00';
      const grace = empShift.graceTime ?? 15;

      let status: 'present' | 'late' | 'absent' = 'present';
      let otHours = 0;
      let totalHours = 0;

      if (checkIn === '-' && checkOut === '-') {
        status = 'absent';
      } else if (checkIn !== '-') {
        const [inH, inM] = checkIn.split(':').map(Number);
        const [sH, sM] = shiftStart.split(':').map(Number);
        const inMins = inH * 60 + inM;
        const sLimit = sH * 60 + sM + grace;
        if (inMins > sLimit) {
          status = 'late';
        } else {
          status = 'present';
        }
      }

      const otEnabled = isShiftOvertimeEnabled(empShift as any);
      if (checkOut !== '-' && checkIn !== '-') {
        otHours = otEnabled ? calculateOvertimeHours(checkIn, checkOut, {
          startTime: shiftStart,
          endTime: shiftEnd,
          totalRequiredHours: empShift?.totalHours ?? 9,
          breakTime: empShift?.breakTime ?? 60,
          minOvertimeMinutes: empShift?.minOvertimeMinutes ?? 30,
          overtimePolicyEnabled: otEnabled,
          shift: empShift as any,
        }) : 0;
        const [outH, outM] = checkOut.split(':').map(Number);
        const [inH, inM] = checkIn.split(':').map(Number);
        const outMins = outH * 60 + outM;
        const inMins = inH * 60 + inM;
        if (outMins > inMins) {
          totalHours = Math.round(((outMins - inMins) / 60) * 10) / 10;
        }
      }

      processed.push({
        employeeId: emp ? emp.employeeId : empId,
        employeeName: empName,
        department,
        date: targetDate,
        checkIn,
        checkOut,
        allPunches: checkIn !== '-' ? (checkOut !== '-' ? [checkIn, checkOut] : [checkIn]) : [],
        totalPunchesCount: (checkIn !== '-' ? 1 : 0) + (checkOut !== '-' ? 1 : 0),
        shiftName: empShift.name,
        shiftStartTime: shiftStart,
        shiftEndTime: shiftEnd,
        status,
        otHours,
        totalHours,
        matched: Boolean(emp),
        docId: `${emp ? emp.employeeId : empId}_${targetDate}`
      });
    });

    if (processed.length === 0) {
      setErrorMsg('No valid attendance rows found.');
    } else {
      setParsedRows(processed);
    }
    setIsProcessing(false);
  };

  const processFile = (file: File) => {
    setSelectedFile(file);
    setIsProcessing(true);
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        processAttendanceData(rawJson);
      } catch (err: any) {
        setErrorMsg('Error parsing spreadsheet: ' + err.message);
        setIsProcessing(false);
      }
    };
    reader.onerror = () => {
      setErrorMsg('Failed to read file.');
      setIsProcessing(false);
    };
    reader.readAsArrayBuffer(file);
  };

  // Quick Parse Pasted Text (copy-pasted from ZK software table like Image 1)
  const handleParsePastedText = () => {
    if (!pastedText.trim()) {
      setErrorMsg('Please paste machine attendance logs first.');
      return;
    }
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const lines = pastedText.trim().split('\n');
      const rows: any[] = [];

      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        // Split by tabs or multiple spaces
        const parts = trimmed.split(/\t+|\s{2,}/);
        if (parts.length >= 2) {
          // If first column looks like header
          if (parts[0].toLowerCase().includes('emp') || parts[0].toLowerCase().includes('id')) {
            return;
          }
          const empId = parts[0].trim();
          let name = '';
          let punchTime = '';

          // Look for DateTime part (e.g. 09/23/2026 10:40)
          const dtIndex = parts.findIndex(p => p.match(/\d{1,2}[/-]\d{1,2}[/-]\d{4}/));
          if (dtIndex !== -1) {
            punchTime = parts[dtIndex].trim();
            if (dtIndex > 1) {
              name = parts.slice(1, dtIndex).join(' ');
            }
          } else if (parts.length >= 3) {
            name = parts[1].trim();
            punchTime = parts[2].trim();
          } else {
            punchTime = parts[1].trim();
          }

          rows.push({
            'Emp ID': empId,
            'Name': name,
            'Punch Time': punchTime
          });
        }
      });

      if (rows.length === 0) {
        setErrorMsg('Could not detect tab or space separated columns in pasted text.');
        setIsProcessing(false);
        return;
      }

      processAttendanceData(rows);
    } catch (err: any) {
      setErrorMsg('Error parsing pasted text: ' + err.message);
      setIsProcessing(false);
    }
  };

  // Sample Template Download based on real ZKTeco structure
  const handleDownloadTemplate = (format: 'zkteco' | 'summary') => {
    const today = selectedDate || new Date().toISOString().split('T')[0];

    if (format === 'zkteco') {
      // Exactly like Image 1 from ZKTeco software
      const sampleZkData = [
        { 'Emp ID': '108', 'Name': 'Abu Bakkar Siddique', 'Punch Time': `${today} 10:40`, 'Work Code': 0, 'Attendance State': 'Check-In', 'Device': 'Attendance M1', 'Record Source': 'Normal' },
        { 'Emp ID': '108', 'Name': 'Abu Bakkar Siddique', 'Punch Time': `${today} 11:08`, 'Work Code': 0, 'Attendance State': 'Break-Out', 'Device': 'Attendance M1', 'Record Source': 'Normal' },
        { 'Emp ID': '108', 'Name': 'Abu Bakkar Siddique', 'Punch Time': `${today} 14:04`, 'Work Code': 0, 'Attendance State': 'Break-In', 'Device': 'Attendance M1', 'Record Source': 'Normal' },
        { 'Emp ID': '108', 'Name': 'Abu Bakkar Siddique', 'Punch Time': `${today} 15:09`, 'Work Code': 0, 'Attendance State': 'Check-Out', 'Device': 'Attendance M1', 'Record Source': 'Normal' },
        { 'Emp ID': '126', 'Name': 'Sagorika Bain', 'Punch Time': `${today} 09:32`, 'Work Code': 0, 'Attendance State': 'Check-In', 'Device': 'Attendance M1', 'Record Source': 'Normal' },
        { 'Emp ID': '126', 'Name': 'Sagorika Bain', 'Punch Time': `${today} 09:32`, 'Work Code': 0, 'Attendance State': 'Repeat', 'Device': 'Attendance M1', 'Record Source': 'Normal' },
        { 'Emp ID': '126', 'Name': 'Sagorika Bain', 'Punch Time': `${today} 13:29`, 'Work Code': 0, 'Attendance State': 'Check-Out', 'Device': 'Attendance M1', 'Record Source': 'Normal' },
        { 'Emp ID': '101', 'Name': 'Md. Sirajul Islam', 'Punch Time': `${today} 09:50`, 'Work Code': 0, 'Attendance State': 'Check-In', 'Device': 'Attendance M1', 'Record Source': 'Normal' },
        { 'Emp ID': '101', 'Name': 'Md. Sirajul Islam', 'Punch Time': `${today} 20:05`, 'Work Code': 0, 'Attendance State': 'Check-Out', 'Device': 'Attendance M1', 'Record Source': 'Normal' },
      ];
      const ws = XLSX.utils.json_to_sheet(sampleZkData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'ZKTeco_Punch_Log');
      XLSX.writeFile(wb, `ZKTeco_Punch_Log_${today}.xlsx`);
    } else {
      const sampleSummary = [
        { 'Employee ID': '108', 'Employee Name': 'Abu Bakkar Siddique', 'Department': 'Sales Executive', 'Date': today, 'In Time': '10:40', 'Out Time': '15:09' },
        { 'Employee ID': '126', 'Employee Name': 'Sagorika Bain', 'Department': 'Re-Call Department', 'Date': today, 'In Time': '09:32', 'Out Time': '13:29' },
        { 'Employee ID': '101', 'Employee Name': 'Md. Sirajul Islam', 'Department': 'HR & Admin', 'Date': today, 'In Time': '09:50', 'Out Time': '20:05' },
      ];
      const ws = XLSX.utils.json_to_sheet(sampleSummary);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance_Summary');
      XLSX.writeFile(wb, `Attendance_Summary_${today}.xlsx`);
    }
  };

  const handleConfirmImport = async () => {
    if (parsedRows.length === 0) return;
    setIsSaving(true);

    try {
      let savedCount = 0;

      for (const item of parsedRows) {
        // Write/Overwrite accurately to Firestore attendance collection
        const payload = {
          id: item.docId,
          companyId: currentCompanyId || 'default',
          employeeId: item.employeeId,
          employeeCode: item.employeeId,
          employeeName: item.employeeName,
          department: item.department,
          date: item.date,
          checkIn: item.checkIn,
          checkOut: item.checkOut,
          firstPunchIn: item.checkIn,
          lastPunchOut: item.checkOut,
          firstPunch: item.checkIn,
          lastPunch: item.checkOut,
          allPunches: item.allPunches,
          status: item.status,
          isLate: item.status === 'late',
          otHours: item.otHours,
          totalHours: item.totalHours,
          shiftName: item.shiftName,
          shiftStartTime: item.shiftStartTime,
          shiftEndTime: item.shiftEndTime,
          source: 'zkteco_machine_import',
          lastUpdated: new Date().toISOString()
        };

        await setDoc(doc(db, 'attendance', item.docId), payload, { merge: true });

        // Also record corresponding raw punches to Firestore collection 'punches'
        if (item.allPunches.length > 0) {
          for (const pTime of item.allPunches) {
            const punchId = `PUNCH_${item.employeeId}_${item.date.replace(/-/g, '')}_${pTime.replace(':', '')}`;
            await setDoc(doc(db, 'punches', punchId), {
              id: punchId,
              companyId: currentCompanyId || 'default',
              employeeId: item.employeeId,
              employeeName: item.employeeName,
              department: item.department,
              date: item.date,
              time: pTime,
              timestamp: `${item.date}T${pTime}:00`,
              punchTimestamp: `${item.date}T${pTime}:00`,
              deviceName: 'ZKTeco Machine Import',
              verifyMode: 'Fingerprint/Face',
              source: 'machine_sync'
            }, { merge: true });
          }
        }

        savedCount++;
      }

      addNotification({
        title: '✅ Machine Attendance Synced',
        message: `Saved ${savedCount} staff attendance records with true First Punch (Check-In) and Last Punch (Check-Out) into Firestore.`,
        read: false,
        type: 'attendance',
        targetPage: 'attendance'
      });

      setIsSaving(false);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      setIsSaving(false);
      alert('Error saving records to Firestore: ' + err.message);
    }
  };

  const presentCount = parsedRows.filter(r => r.status === 'present').length;
  const lateCount = parsedRows.filter(r => r.status === 'late').length;
  const otCount = parsedRows.filter(r => r.otHours > 0).length;

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-3xl p-6 sm:p-7 shadow-2xl border border-slate-100 animate-slide-down my-6 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <IconFileText size={22} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                  Import Machine Attendance (CSV / Excel / Paste)
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                  ZKTeco Compatible
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatically matches 1st Punch = Check-In, Last Punch = Check-Out from ZKTeco raw machine logs!
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 text-sm font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="py-4 space-y-4 overflow-y-auto thin-scroll flex-1 pr-1">
          {/* Tabs: Upload File vs Direct Paste */}
          {!parsedRows.length && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    activeTab === 'upload' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📁 Upload Excel / CSV File
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('paste')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    activeTab === 'paste' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📋 Paste Machine Rows Direct
                </button>
              </div>

              {activeTab === 'upload' ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      processFile(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-3xl p-8 text-center cursor-pointer transition-all ${
                    isDragging
                      ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01]'
                      : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50/60'
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
                    accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                    className="hidden"
                  />

                  <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-2xl shadow-2xs mb-3">
                    <IconUpload size={28} />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">
                    {selectedFile ? selectedFile.name : 'Click to upload or drag & drop ZKTeco Export File'}
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Supports .xlsx, .xls, .csv with columns: <strong>Emp ID</strong>, <strong>Name</strong>, <strong>Punch Time</strong> (Exact like your machine export)
                  </p>
                  <div className="mt-4 inline-flex items-center space-x-2 text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-xl">
                    <span>Browse Device Files</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 font-medium">
                    💡 <strong>Quick Paste:</strong> Select rows in your ZKTeco software table (like Image 1), press <kbd className="bg-white px-1.5 py-0.5 rounded border border-amber-300 font-bold">Ctrl+C</kbd>, then paste below!
                  </div>
                  <textarea
                    rows={6}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={"108\tAbu Bakkar Siddique\t09/23/2026 10:40\n108\tAbu Bakkar Siddique\t09/23/2026 15:09\n126\tSagorika Bain\t09/23/2026 09:32\n126\tSagorika Bain\t09/23/2026 13:29\n101\tMd. Sirajul Islam\t09/23/2026 09:50"}
                    className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed"
                  />
                  <button
                    type="button"
                    onClick={handleParsePastedText}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
                  >
                    ⚡ Process Pasted Logs
                  </button>
                </div>
              )}

              {/* Template Downloads */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-800">Download Ready Templates</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Matches your ZKTeco Machine columns (Emp ID, Punch Time)
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadTemplate('zkteco')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer shadow-xs"
                  >
                    <IconDownload size={14} />
                    <span>ZKTeco Multi-Punch Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadTemplate('summary')}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer shadow-2xs"
                  >
                    <IconDownload size={14} />
                    <span>Summary Template</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 font-medium flex items-center justify-between">
              <span>⚠️ {errorMsg}</span>
              <button onClick={() => setErrorMsg(null)} className="text-rose-500 font-bold ml-2">✕</button>
            </div>
          )}

          {/* Processing Spinner */}
          {isProcessing && (
            <div className="p-8 text-center space-y-2">
              <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-bold text-slate-700">Grouping punches &amp; calculating 1st In and Last Out...</p>
            </div>
          )}

          {/* Parsed Preview Table */}
          {parsedRows.length > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Total Employees</p>
                  <p className="text-lg font-extrabold text-slate-800 mt-0.5">{parsedRows.length}</p>
                </div>
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase">On-Time (Present)</p>
                  <p className="text-lg font-extrabold text-emerald-800 mt-0.5">{presentCount}</p>
                </div>
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-[10px] font-bold text-amber-600 uppercase">Late Entry</p>
                  <p className="text-lg font-extrabold text-amber-800 mt-0.5">{lateCount}</p>
                </div>
                <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <p className="text-[10px] font-bold text-indigo-600 uppercase">Overtime (OT)</p>
                  <p className="text-lg font-extrabold text-indigo-800 mt-0.5">{otCount}</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-slate-600 font-semibold">
                  Parsed Records for Date: <strong className="text-slate-900">{parsedRows[0]?.date}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => { setParsedRows([]); setSelectedFile(null); setPastedText(''); }}
                  className="text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                >
                  Upload / Paste Again
                </button>
              </div>

              {/* Records Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="max-h-64 overflow-y-auto thin-scroll">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px] sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-3.5 py-2.5">Staff &amp; ID</th>
                        <th className="px-3.5 py-2.5">1st Punch (IN)</th>
                        <th className="px-3.5 py-2.5">Last Punch (OUT)</th>
                        <th className="px-3.5 py-2.5">Punches Log</th>
                        <th className="px-3.5 py-2.5">Shift Start</th>
                        <th className="px-3.5 py-2.5">Status</th>
                        <th className="px-3.5 py-2.5">OT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-3.5 py-2">
                            <p className="font-bold text-slate-800">{row.employeeName}</p>
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded">
                              {row.employeeId}
                            </span>
                          </td>
                          <td className="px-3.5 py-2 font-mono font-extrabold text-emerald-700 text-sm">
                            {formatTo12Hour(row.checkIn)}
                          </td>
                          <td className="px-3.5 py-2 font-mono font-extrabold text-indigo-700 text-sm">
                            {formatTo12Hour(row.checkOut)}
                          </td>
                          <td className="px-3.5 py-2 text-[10px] text-slate-500 font-mono">
                            {row.allPunches.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {row.allPunches.map((p, pi) => (
                                  <span key={pi} className={`px-1 rounded border ${pi === 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold' : pi === row.allPunches.length - 1 ? 'bg-indigo-50 text-indigo-800 border-indigo-300 font-bold' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                    {p}
                                  </span>
                                ))}
                              </div>
                            ) : '-'}
                          </td>
                          <td className="px-3.5 py-2 text-slate-500 font-medium">
                            {row.shiftStartTime}
                          </td>
                          <td className="px-3.5 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
                              row.status === 'present'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : row.status === 'late'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-3.5 py-2 font-semibold text-slate-700">
                            {row.otHours > 0 ? `${row.otHours}h` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs sm:text-sm font-semibold cursor-pointer"
          >
            Cancel
          </button>

          {parsedRows.length > 0 && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleConfirmImport}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-emerald-500/20 active:scale-95 transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <span>📥</span>
              <span>{isSaving ? 'Saving to Firestore...' : `Confirm & Save Exact Machine Punches (${parsedRows.length})`}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
