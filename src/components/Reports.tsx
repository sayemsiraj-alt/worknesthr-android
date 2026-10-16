import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useData, Employee } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firestoreService';
import {
  generateReportHtml,
  printViaIframe,
  downloadReportHtml,
  copyReportAsTsv,
  PrintReportConfig,
} from '../utils/reportPrinter';
import { formatTo12Hour } from '../utils/timeFormat';
import {
  resolveEmployeeScheduleForDate,
  resolveEmployeeShiftNameForDate,
  findShiftByNameOrId,
  isShiftOvertimeEnabled,
  calculateDutyDuration,
  calculateOvertimeHours,
  isEveningOrOvernight,
  normalizeTimeStr,
  getEmployeeShiftWorkingHours,
  calculateHourlyOtRate,
  evaluateAttendanceForSchedule,
} from '../utils/attendanceScheduleEngine';

type ReportModule =
  | 'attendance'
  | 'payroll'
  | 'employee'
  | 'individual_dossier'
  | 'leave'
  | 'department'
  | 'shift_roster'
  | 'recruitment'
  | 'biometric'
  | 'regularization';

export function Reports() {
  const {
    employees: rawEmployees,
    authorizedTeamEmployees,
    isCurrentUserManager,
    currentUser,
    departments,
    branches,
    getEmployeeBranch,
    shifts,
    roster,
    leaveRequests,
    attendanceRequests,
    monthlyPayrollRuns,
    recruitmentJobs,
    candidates,
    devices,
  } = useData();
  const { currentCompanyId, currentCompany } = useTenant();
  const activeTenant = currentCompanyId || 'default';

  // Active module
  const [activeModule, setActiveModule] = useState<ReportModule>('attendance');

  // Phase 3: Branch & Employee & Historical Comparison Filters
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [selectedEmployeeFilter, setSelectedEmployeeFilter] = useState<string>('all');
  const [showHistoricalCompare, setShowHistoricalCompare] = useState<boolean>(false);

  const baseAuthorizedEmployees = useMemo<Employee[]>(() => {
    if (currentUser?.role === 'Department Supervisor' && authorizedTeamEmployees.length > 0) {
      return authorizedTeamEmployees;
    }
    if (isCurrentUserManager && !currentUser && authorizedTeamEmployees.length > 0) {
      return authorizedTeamEmployees;
    }
    return rawEmployees;
  }, [currentUser, isCurrentUserManager, authorizedTeamEmployees, rawEmployees]);

  const employees = useMemo<Employee[]>(() => {
    return baseAuthorizedEmployees.filter((emp: Employee) => {
      if (selectedBranch !== 'all') {
        const brName = getEmployeeBranch(emp);
        if (
          brName.toLowerCase() !== selectedBranch.toLowerCase() &&
          emp.branchId !== selectedBranch &&
          emp.branch !== selectedBranch
        ) {
          return false;
        }
      }
      if (selectedEmployeeFilter !== 'all') {
        if (emp.id !== selectedEmployeeFilter && emp.employeeId !== selectedEmployeeFilter) return false;
      }
      return true;
    });
  }, [baseAuthorizedEmployees, selectedBranch, selectedEmployeeFilter, getEmployeeBranch]);

  // Shared Filters
  const currentMonthStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const getMonthBounds = useCallback((monthStr: string) => {
    const [y, m] = (monthStr || '').split('-').map(Number);
    const year = y || new Date().getFullYear();
    const month = m || new Date().getMonth() + 1;
    const lastDay = new Date(year, month, 0).getDate();
    return {
      start: `${year}-${String(month).padStart(2, '0')}-01`,
      end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      daysInMonth: lastDay,
    };
  }, []);

  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dateMode, setDateMode] = useState<'month' | 'day'>('month');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Individual Dossier Employee Selection & Date Filtering
  const [selectedDossierEmpId, setSelectedDossierEmpId] = useState<string>('');
  const [dossierDateFilterType, setDossierDateFilterType] = useState<'month' | 'range' | 'day'>('month');
  const [dossierStartDate, setDossierStartDate] = useState<string>(() => getMonthBounds(currentMonthStr).start);
  const [dossierEndDate, setDossierEndDate] = useState<string>(() => getMonthBounds(currentMonthStr).end);
  const [dossierSingleDate, setDossierSingleDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dossierTableStatusFilter, setDossierTableStatusFilter] = useState<string>('all');

  const handleMonthChange = useCallback((newMonth: string) => {
    if (!newMonth) return;
    setSelectedMonth(newMonth);
    const bounds = getMonthBounds(newMonth);
    setDossierStartDate(bounds.start);
    setDossierEndDate(bounds.end);
  }, [getMonthBounds]);

  const effectiveDossierRange = useMemo(() => {
    if (dossierDateFilterType === 'day') {
      const d = dossierSingleDate || new Date().toISOString().split('T')[0];
      return { start: d, end: d, label: `Date: ${d}` };
    }
    if (dossierDateFilterType === 'range') {
      const s = dossierStartDate || getMonthBounds(selectedMonth).start;
      const e = dossierEndDate || getMonthBounds(selectedMonth).end;
      const start = s <= e ? s : e;
      const end = s <= e ? e : s;
      return { start, end, label: `${start} to ${end}` };
    }
    const bounds = getMonthBounds(selectedMonth);
    return { start: bounds.start, end: bounds.end, label: `Month: ${selectedMonth}` };
  }, [dossierDateFilterType, dossierSingleDate, dossierStartDate, dossierEndDate, selectedMonth, getMonthBounds]);

  useEffect(() => {
    if (employees.length > 0 && !selectedDossierEmpId) {
      setSelectedDossierEmpId(employees[0].employeeId || employees[0].id);
    }
  }, [employees, selectedDossierEmpId]);

  // Module-specific filters
  const [attStatusFilter, setAttStatusFilter] = useState<string>('all');
  const [payrollStatusFilter, setPayrollStatusFilter] = useState<string>('all');
  const [empStatusFilter, setEmpStatusFilter] = useState<string>('all');
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<string>('all');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState<string>('all');
  const [recStageFilter, setRecStageFilter] = useState<string>('all');
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  const [regTypeFilter, setRegTypeFilter] = useState<string>('all');
  const [regStatusFilter, setRegStatusFilter] = useState<string>('all');

  // Print Preview & Execution state
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printNotice, setPrintNotice] = useState<{ text: string; type: 'success' | 'info' | 'warn' } | null>(null);

  // Module Tabs Navigation & Scroll State
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isTabsWrapMode, setIsTabsWrapMode] = useState(false);

  const checkScroll = useCallback(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll, isTabsWrapMode]);

  const scrollTabs = (direction: 'left' | 'right') => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const offset = direction === 'left' ? -260 : 260;
    el.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const handleTabsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = tabsScrollRef.current;
    if (!el || isTabsWrapMode) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  };

  // Center active module into view smoothly
  useEffect(() => {
    if (isTabsWrapMode) return;
    const timer = setTimeout(() => {
      const activeBtn = tabsScrollRef.current?.querySelector(`[data-module-id="${activeModule}"]`);
      if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [activeModule, isTabsWrapMode]);

  const showPrintNotice = (text: string, type: 'success' | 'info' | 'warn' = 'info') => {
    setPrintNotice({ text, type });
    setTimeout(() => setPrintNotice(null), 4500);
  };

  // Firestore real-time Attendance records
  const [firestoreAttendance, setFirestoreAttendance] = useState<any[]>([]);
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(false);

  useEffect(() => {
    try {
      setIsAttendanceLoading(true);
      const monthBounds = getMonthBounds(selectedMonth);
      const candidatesStart = [monthBounds.start, selectedDate, effectiveDossierRange.start].filter(Boolean).sort();
      const candidatesEnd = [monthBounds.end, selectedDate, effectiveDossierRange.end].filter(Boolean).sort();
      const queryStart = candidatesStart[0] || `${selectedMonth}-01`;
      const queryEnd = candidatesEnd[candidatesEnd.length - 1] || `${selectedMonth}-31`;

      const q = query(
        collection(db, 'attendance'),
        where('date', '>=', queryStart),
        where('date', '<=', queryEnd)
      );

      const unsub = onSnapshot(
        q,
        (snap) => {
          const docs: any[] = [];
          snap.forEach((d) => {
            const data = d.data();
            const docComp = data.companyId || 'default';
            const matches = activeTenant !== 'default'
              ? (!data.companyId || docComp === 'default' || docComp === activeTenant)
              : (!data.companyId || docComp === 'default');
            if (matches) {
              docs.push({ id: d.id, ...data });
            }
          });
          setFirestoreAttendance(docs);
          setIsAttendanceLoading(false);
        },
        (err) => {
          console.warn('Firestore attendance report query error:', err);
          setIsAttendanceLoading(false);
        }
      );
      return () => unsub();
    } catch (e) {
      console.warn('Error subscribing to attendance report data:', e);
      setIsAttendanceLoading(false);
    }
  }, [selectedMonth, selectedDate, dateMode, activeTenant, effectiveDossierRange.start, effectiveDossierRange.end, getMonthBounds]);

  // Read saved payroll records from localStorage
  const [savedPayrollRecords, setSavedPayrollRecords] = useState<Record<string, any>>(() => {
    try {
      const saved = localStorage.getItem('worknest_payroll_monthly_records');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  useEffect(() => {
    const syncPayroll = () => {
      try {
        const saved = localStorage.getItem('worknest_payroll_monthly_records');
        if (saved) setSavedPayrollRecords(JSON.parse(saved));
      } catch {}
    };
    window.addEventListener('worknest_payroll_updated', syncPayroll);
    window.addEventListener('storage', syncPayroll);
    return () => {
      window.removeEventListener('worknest_payroll_updated', syncPayroll);
      window.removeEventListener('storage', syncPayroll);
    };
  }, []);

  const [isEditingDossierPayslip, setIsEditingDossierPayslip] = useState(false);
  const [dossierPayslipForm, setDossierPayslipForm] = useState<any>(null);

  // Reusable CSV Exporter
  const handleExportCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const processRow = (row: (string | number)[]) => {
      return row
        .map((val) => {
          let v = val === null || val === undefined ? '' : String(val);
          v = v.replace(/"/g, '""');
          if (v.search(/("|,|\n)/g) >= 0) {
            v = `"${v}"`;
          }
          return v;
        })
        .join(',');
    };

    const csvContent = '\uFEFF' + [headers, ...rows].map(processRow).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper to cleanly extract check-in and check-out times from any attendance document
  const extractCleanPunches = useCallback((rec: any): { checkIn: string; checkOut: string } => {
    if (!rec) return { checkIn: '-', checkOut: '-' };
    const rawIn = rec.firstPunchIn || rec.checkIn || rec.firstPunch || '-';
    const checkIn = rawIn && rawIn !== '--:--' ? String(rawIn).trim() : '-';
    let rawOut = '-';
    if (rec.checkOut && rec.checkOut !== '-' && rec.checkOut !== '--:--' && String(rec.checkOut).trim() !== checkIn) {
      rawOut = String(rec.checkOut).trim();
    } else if (rec.lastPunchOut && rec.lastPunchOut !== '-' && rec.lastPunchOut !== '--:--' && String(rec.lastPunchOut).trim() !== checkIn) {
      rawOut = String(rec.lastPunchOut).trim();
    } else if (rec.lastPunch && rec.lastPunch !== '-' && rec.lastPunch !== '--:--' && String(rec.lastPunch).trim() !== checkIn) {
      rawOut = String(rec.lastPunch).trim();
    }
    if (rawOut === checkIn || rec.totalPunches === 1) {
      rawOut = '-';
    }
    return { checkIn, checkOut: rawOut };
  }, []);

  // =========================================================================
  // 1. ATTENDANCE REPORT DATA & STATS
  // =========================================================================
  const attendanceReportData = useMemo(() => {
    let records: any[] = [];

    if (dateMode === 'day') {
      // Comprehensive Daily Audit Register for all staff on selectedDate
      records = employees.map((emp) => {
        const empId = String(emp.employeeId || emp.id || '').toLowerCase().trim();
        const empMainId = String(emp.id || '').toLowerCase().trim();
        const rec = firestoreAttendance.find((r) => {
          if (r.date !== selectedDate) return false;
          const rEmpId = String(r.employeeId || r.employeeCode || '').toLowerCase().trim();
          return rEmpId === empId || rEmpId === empMainId || (r.employeeName && r.employeeName.trim().toLowerCase() === emp.name.trim().toLowerCase());
        });

        const sched = resolveEmployeeScheduleForDate(emp, selectedDate, roster, shifts, rec?.shiftName);
        const dateShiftName = resolveEmployeeShiftNameForDate(emp, selectedDate, rec?.shiftName);
        const { checkIn, checkOut } = extractCleanPunches(rec);
        const hasPunch = checkIn !== '-' || checkOut !== '-';

        const evalRes = evaluateAttendanceForSchedule(checkIn, checkOut, sched, rec, dateShiftName);
        const autoStatus = evalRes.status;

        const isOvernight = Boolean(
          rec?.isOvernight ||
          sched.isOvernight ||
          isEveningOrOvernight(sched) ||
          (checkIn !== '-' && checkOut !== '-' && normalizeTimeStr(checkOut) < normalizeTimeStr(checkIn))
        );
        const duty = calculateDutyDuration(checkIn, checkOut, isOvernight, sched.breakTime);
        const rawSavedHours = rec?.totalHours !== undefined && rec?.totalHours !== null ? Number(rec.totalHours) : (rec?.workHours !== undefined ? Number(rec.workHours) : null);
        const totalHours = checkIn !== '-' && checkOut !== '-'
          ? (duty.durationHours > 0 ? duty.durationHours : (rawSavedHours !== null && rawSavedHours > 0 ? rawSavedHours : 0))
          : (rawSavedHours !== null && rawSavedHours > 0 ? rawSavedHours : 0);
        const durationMinutes = checkIn !== '-' && checkOut !== '-' && duty.durationMinutes > 0
          ? duty.durationMinutes
          : Math.round(totalHours * 60);
        const effShift =
          sched.shift ||
          findShiftByNameOrId(shifts, sched.shiftName) ||
          findShiftByNameOrId(shifts, dateShiftName);
        const isOtAllowed =
          !sched.isWeekend &&
          !sched.isOff &&
          sched.overtimePolicyEnabled !== false &&
          isShiftOvertimeEnabled(effShift);

        const calcOt = isOtAllowed
          ? calculateOvertimeHours(checkIn, checkOut, { ...sched, shift: effShift || sched.shift, overtimePolicyEnabled: isOtAllowed, isOvernight })
          : 0;
        const savedOt = rec?.otHours !== undefined && rec?.otHours !== null ? Number(rec.otHours) : (rec?.overtimeHours !== undefined ? Number(rec.overtimeHours) : null);
        const otHours = !isOtAllowed
          ? 0
          : (rec?.source === 'admin_edit' && savedOt !== null
              ? savedOt
              : (checkIn !== '-' && checkOut !== '-' ? calcOt : (savedOt !== null && savedOt > 0 ? savedOt : 0)));

        return {
          id: rec?.id || `${emp.employeeId || emp.id}_${selectedDate}`,
          date: selectedDate,
          employeeId: emp.employeeId || emp.id,
          employeeName: emp.name,
          department: emp.department || 'General',
          designation: emp.designation || 'Staff',
          checkIn,
          checkOut,
          status: autoStatus,
          totalHours,
          workHours: totalHours,
          durationMinutes,
          overtimeHours: otHours,
          otHours,
          source: rec?.source || rec?.method || (hasPunch ? 'Biometric terminal' : 'Roster assigned'),
        };
      });
    } else {
      // Monthly Attendance Audit Register - strictly registered employees only within selectedMonth
      const monthBounds = getMonthBounds(selectedMonth);
      records = firestoreAttendance
        .filter((rec) => {
          if (rec.date && (rec.date < monthBounds.start || rec.date > monthBounds.end)) {
            return false;
          }
          const recId = String(rec.employeeId || rec.employeeCode || '').toLowerCase().trim();
          return employees.some((e) => {
            const eId = String(e.employeeId || '').toLowerCase().trim();
            const eMainId = String(e.id || '').toLowerCase().trim();
            return eId === recId || eMainId === recId;
          });
        })
        .map((rec) => {
          const recId = String(rec.employeeId || rec.employeeCode || '').toLowerCase().trim();
          const emp = employees.find(
            (e) =>
              String(e.employeeId || '').toLowerCase().trim() === recId ||
              String(e.id || '').toLowerCase().trim() === recId
          );
          const { checkIn, checkOut } = extractCleanPunches(rec);
          const recDate = rec.date || `${selectedMonth}-01`;
          const sched = emp ? resolveEmployeeScheduleForDate(emp, recDate, roster, shifts, rec?.shiftName) : null;
          const dateShiftName = emp ? resolveEmployeeShiftNameForDate(emp, recDate, rec?.shiftName) : (rec?.shiftName || '');
          const isOvernight = Boolean(
            rec.isOvernight ||
            sched?.isOvernight ||
            (sched && isEveningOrOvernight(sched)) ||
            (checkIn !== '-' && checkOut !== '-' && normalizeTimeStr(checkOut) < normalizeTimeStr(checkIn))
          );
          const duty = calculateDutyDuration(checkIn, checkOut, isOvernight, sched?.breakTime ?? 0);
          const rawSavedHours = rec.totalHours !== undefined && rec.totalHours !== null ? Number(rec.totalHours) : (rec.workHours !== undefined ? Number(rec.workHours) : null);
          const totalHours = checkIn !== '-' && checkOut !== '-'
            ? (duty.durationHours > 0 ? duty.durationHours : (rawSavedHours !== null && rawSavedHours > 0 ? rawSavedHours : 0))
            : (rawSavedHours !== null && rawSavedHours > 0 ? rawSavedHours : 0);
          const durationMinutes = checkIn !== '-' && checkOut !== '-' && duty.durationMinutes > 0
            ? duty.durationMinutes
            : Math.round(totalHours * 60);
          const effShift =
            sched?.shift ||
            findShiftByNameOrId(shifts, sched?.shiftName) ||
            findShiftByNameOrId(shifts, dateShiftName);
          const isOtAllowed =
            !sched?.isWeekend &&
            !sched?.isOff &&
            sched?.overtimePolicyEnabled !== false &&
            isShiftOvertimeEnabled(effShift);

          const calcOt = isOtAllowed
            ? calculateOvertimeHours(checkIn, checkOut, sched ? { ...sched, shift: effShift || sched.shift, overtimePolicyEnabled: isOtAllowed, isOvernight } : { isOvernight, overtimePolicyEnabled: isOtAllowed })
            : 0;
          const savedOt = rec?.otHours !== undefined && rec?.otHours !== null ? Number(rec.otHours) : (rec?.overtimeHours !== undefined ? Number(rec.overtimeHours) : null);
          const otHours = !isOtAllowed
            ? 0
            : (rec?.source === 'admin_edit' && savedOt !== null
                ? savedOt
                : (checkIn !== '-' && checkOut !== '-' ? calcOt : (savedOt !== null && savedOt > 0 ? savedOt : 0)));

          const evalRes = evaluateAttendanceForSchedule(checkIn, checkOut, sched, rec, dateShiftName);
          const status = evalRes.status;

          return {
            ...rec,
            status,
            lateMinutes: evalRes.lateMinutes,
            isLate: status === 'late',
            isEarlyLeave: evalRes.isEarlyOut,
            earlyLeaveMinutes: evalRes.earlyOutMinutes,
            employeeName: emp?.name || rec.employeeName || rec.employeeId || 'Unknown',
            department: emp?.department || rec.department || 'General',
            designation: emp?.designation || 'Staff',
            checkIn,
            checkOut,
            totalHours,
            workHours: totalHours,
            durationMinutes,
            overtimeHours: otHours,
            otHours,
          };
        });
    }

    if (selectedDept !== 'all') {
      records = records.filter(
        (r) => r.department?.trim().toLowerCase() === selectedDept.trim().toLowerCase()
      );
    }
    if (attStatusFilter !== 'all') {
      records = records.filter(
        (r) => (r.status || 'present').toLowerCase() === attStatusFilter.toLowerCase()
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      records = records.filter(
        (r) =>
          r.employeeName?.toLowerCase().includes(q) ||
          r.employeeId?.toLowerCase().includes(q) ||
          r.department?.toLowerCase().includes(q)
      );
    }

    // Sort by date desc, then employeeId
    return records.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [firestoreAttendance, employees, roster, shifts, dateMode, selectedDate, selectedMonth, selectedDept, attStatusFilter, searchQuery, extractCleanPunches, getMonthBounds]);

  const attendanceStats = useMemo(() => {
    const total = attendanceReportData.length;
    const present = attendanceReportData.filter((r) => r.status === 'present').length;
    const late = attendanceReportData.filter((r) => r.status === 'late').length;
    const absent = attendanceReportData.filter((r) => r.status === 'absent').length;
    const halfDay = attendanceReportData.filter((r) => r.status === 'half_day').length;
    const totalOvertime = attendanceReportData.reduce(
      (acc, r) => acc + (Number(r.overtimeHours || r.otHours) || 0),
      0
    );
    const totalWorkMinutes = attendanceReportData.reduce(
      (acc, r) => acc + (Number(r.durationMinutes) || Math.round((Number(r.totalHours) || 0) * 60)),
      0
    );
    const totalWorkHours = Math.round((totalWorkMinutes / 60) * 10) / 10;
    const presentRate = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
    return { total, present, late, absent, halfDay, totalOvertime, totalWorkHours, totalWorkMinutes, presentRate };
  }, [attendanceReportData]);

  // =========================================================================
  // 2. PAYROLL REPORT DATA & STATS
  // =========================================================================
  const payrollReportData = useMemo(() => {
    return employees
      .filter((emp) => {
        if (selectedDept !== 'all' && emp.department?.toLowerCase() !== selectedDept.toLowerCase()) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const match =
            emp.name.toLowerCase().includes(q) ||
            emp.employeeId.toLowerCase().includes(q) ||
            emp.department.toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .map((emp) => {
        const explicitGross = Number(emp.grossSalary);
        const compSum =
          (Number(emp.basicSalary ?? emp.basic) || 0) +
          (Number(emp.houseRent) || 0) +
          (Number(emp.medical) || 0) +
          (Number(emp.conveyance ?? emp.transport) || 0) +
          (Number(emp.food) || 0);
        const gross = (!isNaN(explicitGross) && explicitGross > 0)
          ? explicitGross
          : (compSum > 0 ? compSum : ((Number(emp.basicSalary ?? emp.basic) || 0) * 2));
        const basic = Number(emp.basicSalary ?? emp.basic) || Math.round(gross * 0.5);
        const houseRent = Number(emp.houseRent) || Math.round(gross * 0.3);
        const medical = Number(emp.medical) || Math.round(gross * 0.1);
        const conveyance = Number(emp.conveyance ?? emp.transport) || Math.round(gross * 0.1);
        const food = Number(emp.food) || 0;

        // Check local saved record
        const recKey = `${selectedMonth}_${emp.id}`;
        const altKey = `${selectedMonth}_${emp.employeeId}`;
        const savedRec = savedPayrollRecords[recKey] || savedPayrollRecords[altKey];
        const isV2Edited = Boolean(savedRec?.manualOverrideV2);

        const effBasic = savedRec?.manuallyEdited && savedRec?.basicSalary ? Number(savedRec.basicSalary) : basic;
        const effHouseRent = savedRec?.manuallyEdited && savedRec?.houseRent !== undefined ? Number(savedRec.houseRent) : houseRent;
        const effMedical = savedRec?.manuallyEdited && savedRec?.medical !== undefined ? Number(savedRec.medical) : medical;
        const effConveyance = savedRec?.manuallyEdited && savedRec?.conveyance !== undefined ? Number(savedRec.conveyance) : conveyance;
        const effFood = savedRec?.manuallyEdited && savedRec?.food !== undefined ? Number(savedRec.food) : food;
        const effBaseGross = effBasic + effHouseRent + effMedical + effConveyance + effFood;

        // Deductions
        const pf = savedRec ? Number(savedRec.pfDeduction) || 0 : 0;
        const tax = savedRec ? Number(savedRec.taxDeduction) || 0 : 0;

        // Match employee attendance records for selectedMonth
        const empCode = String(emp.employeeId || '').trim().toLowerCase();
        const empDocId = String(emp.id || '').trim().toLowerCase();
        const empDigits = empCode.replace(/\D/g, '');
        const empNameLower = String(emp.name || '').trim().toLowerCase();

        const isEmpMatchRecord = (rec: any) => {
          if (!rec) return false;
          const rId = String(rec.employeeId || '').trim().toLowerCase();
          const rCode = String(rec.employeeCode || '').trim().toLowerCase();
          const rDigits = (rId || rCode).replace(/\D/g, '');
          const rName = String(rec.employeeName || '').trim().toLowerCase();
          return (
            (empCode && (rId === empCode || rCode === empCode)) ||
            (empDocId && (rId === empDocId || rCode === empDocId)) ||
            (empDigits && rDigits && empDigits === rDigits) ||
            (empNameLower && rName === empNameLower)
          );
        };

        const [selY, selM] = selectedMonth.split('-').map(Number);
        const totalMonthDays = new Date(selY || 2026, selM || 1, 0).getDate();
        const todayStr = new Date().toISOString().split('T')[0];

        let autoPresentDays = 0;
        let autoRosterWeekendDays = 0;
        let autoWeekendPresentDays = 0;
        let autoAbsentDays = 0;
        let unexcusedLateCount = 0;
        let autoOvertimeMinutes = 0;

        for (let d = 1; d <= totalMonthDays; d++) {
          const dateStr = `${selY}-${String(selM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const attRecord = firestoreAttendance.find(
            (a) => a.date === dateStr && isEmpMatchRecord(a)
          );
          const sched = resolveEmployeeScheduleForDate(emp, dateStr, roster, shifts, attRecord?.shiftName);
          const dateShiftName = resolveEmployeeShiftNameForDate(emp, dateStr, attRecord?.shiftName);
          const isWeekend = Boolean(sched.isWeekend || sched.isOff);
          if (isWeekend) {
            autoRosterWeekendDays++;
          }
          const isFlexibleShift = Boolean(
            sched.shift?.type === 'flexible' ||
            sched.shiftName.toLowerCase().includes('flexible') ||
            sched.shiftName.toLowerCase().includes('flexi') ||
            dateShiftName.toLowerCase().includes('flexible') ||
            !sched.latePolicyEnabled
          );

          const activeLeave = leaveRequests.find(
            (l) =>
              l.status === 'approved' &&
              isEmpMatchRecord(l) &&
              dateStr >= (l.from || (l as any).startDate) &&
              dateStr <= (l.to || (l as any).endDate)
          );

          const { checkIn: rawIn, checkOut: rawOut } = extractCleanPunches(attRecord);
          const hasPunch = rawIn !== '-' || rawOut !== '-';

          if (attRecord && (hasPunch || attRecord.status)) {
            const evalRes = evaluateAttendanceForSchedule(rawIn, rawOut, sched, attRecord, dateShiftName);
            const resolvedStatus = evalRes.status;

            if (['present', 'late', 'half_day'].includes(resolvedStatus)) {
              autoPresentDays++;
              if (isWeekend) autoWeekendPresentDays++;
              if (resolvedStatus === 'late') {
                const isWaived = attendanceRequests.some(
                  (r) =>
                    isEmpMatchRecord(r) &&
                    r.date === dateStr &&
                    r.type === 'late_arrival' &&
                    r.status === 'approved'
                );
                if (!attRecord.isLateExcused && !attRecord.lateWaived && !isWaived) {
                  unexcusedLateCount++;
                }
              }

              const isOvernight = Boolean(
                attRecord.isOvernight ||
                sched.isOvernight ||
                isEveningOrOvernight(sched) ||
                (rawIn !== '-' && rawOut !== '-' && normalizeTimeStr(rawOut) < normalizeTimeStr(rawIn))
              );
              const effShift =
                sched.shift ||
                findShiftByNameOrId(shifts, sched.shiftName) ||
                findShiftByNameOrId(shifts, dateShiftName);
              const isOtAllowed =
                !isWeekend &&
                sched.overtimePolicyEnabled !== false &&
                isShiftOvertimeEnabled(effShift);
              const calcOt = isOtAllowed
                ? calculateOvertimeHours(rawIn, rawOut, { ...sched, shift: effShift || sched.shift, overtimePolicyEnabled: isOtAllowed, isOvernight })
                : 0;
              const savedOt =
                attRecord.otHours !== undefined && attRecord.otHours !== null
                  ? Number(attRecord.otHours)
                  : attRecord.overtimeHours !== undefined && attRecord.overtimeHours !== null
                  ? Number(attRecord.overtimeHours)
                  : null;
              const dayOt = !isOtAllowed
                ? 0
                : attRecord.source === 'admin_edit' && savedOt !== null
                ? savedOt
                : rawIn !== '-' && rawOut !== '-'
                ? calcOt
                : savedOt !== null && savedOt > 0
                ? savedOt
                : 0;
              if (dayOt > 0) autoOvertimeMinutes += Math.round(dayOt * 60);
            } else if (resolvedStatus === 'absent') {
              autoAbsentDays++;
            }
          } else if (activeLeave) {
            // Approved leave
          } else if (!isWeekend && dateStr <= todayStr) {
            autoAbsentDays++;
          }
        }

        const workingDays =
          savedRec?.workingDaysCustomOverride && savedRec?.workingDays
            ? Number(savedRec.workingDays)
            : Math.max(0, totalMonthDays - autoRosterWeekendDays);
        const presentDays = isV2Edited && savedRec?.presentDays !== undefined ? Number(savedRec.presentDays) : autoPresentDays;
        const absentDays = isV2Edited && savedRec?.absentDays !== undefined ? Number(savedRec.absentDays) : autoAbsentDays;
        const weekendDays = isV2Edited && savedRec?.weekendDays !== undefined ? Number(savedRec.weekendDays) : autoWeekendPresentDays;

        // User Rule: 1 day salary = Gross / 30 (for both 30-day and 31-day months)
        const oneDayGross30 = effBaseGross / 30;
        const latePenaltyDays = Math.floor(unexcusedLateCount / 3);
        const lateCut =
          isV2Edited && savedRec?.lateDeduction !== undefined && Number(savedRec.lateDeduction) > 0
            ? Number(savedRec.lateDeduction)
            : Math.round(latePenaltyDays * oneDayGross30);

        const absentDeduction = savedRec?.absentDeductionManualZeroV2
          ? 0
          : isV2Edited && Number(savedRec?.absentDeduction) > 0
          ? Number(savedRec.absentDeduction)
          : Math.round(absentDays * oneDayGross30);

        const weekendAllowance =
          savedRec?.weekendAllowanceCustomOverride && savedRec?.weekendAllowanceManualZero
            ? 0
            : savedRec?.weekendAllowanceCustomOverride && Number(savedRec?.weekendAllowance) > 0
            ? Number(savedRec.weekendAllowance)
            : Math.round(weekendDays * oneDayGross30);

        const shiftWorkingHours = getEmployeeShiftWorkingHours(emp, shifts, roster, selectedMonth);
        const effShiftHours = savedRec?.shiftWorkingHours && Number(savedRec.shiftWorkingHours) > 0
          ? Number(savedRec.shiftWorkingHours)
          : shiftWorkingHours;
        const otRate =
          savedRec?.overtimeRateCustomOverride && Number(savedRec?.overtimeRate) > 0
            ? Number(savedRec.overtimeRate)
            : calculateHourlyOtRate(effBasic, effShiftHours);
        const exactOtRate =
          savedRec?.overtimeRateCustomOverride && Number(savedRec?.overtimeRate) > 0
            ? Number(savedRec.overtimeRate)
            : (((effBasic / 30) / (effShiftHours || 8)) * 1.5);
        const otHours =
          isV2Edited && savedRec?.overtimeHours !== undefined
            ? Number(savedRec.overtimeHours)
            : Number((autoOvertimeMinutes / 60).toFixed(1));
        const overtimeAmount = Math.round(otHours * exactOtRate);

        const attendanceBonus = savedRec && savedRec.attendanceBonus !== undefined ? Number(savedRec.attendanceBonus) || 0 : Number(emp.attendanceBonus) || 0;
        const festivalBonus = savedRec ? Number(savedRec.festivalBonus) || 0 : 0;
        const otherAllowance = savedRec ? Number(savedRec.otherAllowance) || 0 : 0;
        const advanceDeduction = savedRec ? Number(savedRec.advanceDeduction) || 0 : 0;
        const loanDeduction = savedRec ? Number(savedRec.loanDeduction) || 0 : 0;
        const otherDeduction = savedRec ? Number(savedRec.otherDeduction) || 0 : 0;

        const totalGross = effBaseGross + weekendAllowance + overtimeAmount + attendanceBonus + festivalBonus + otherAllowance;
        const totalDeductions = pf + tax + absentDeduction + lateCut + advanceDeduction + loanDeduction + otherDeduction;
        const netSalary = Math.max(0, totalGross - totalDeductions);
        const status = savedRec?.status || (monthlyPayrollRuns[selectedMonth] ? 'paid' : 'pending');

        return {
          employeeId: emp.employeeId,
          name: emp.name,
          department: emp.department,
          designation: emp.designation,
          totalMonthDays,
          workingDays,
          presentDays,
          absentDays,
          basic: effBasic,
          houseRent: effHouseRent,
          medical: effMedical,
          conveyance: effConveyance,
          food: effFood,
          gross: totalGross,
          pf,
          tax,
          absentDeduction,
          lateCut,
          unexcusedLateCount,
          totalDeductions,
          netSalary,
          status,
          bankName: emp.bankName || 'City Bank Ltd',
          accountNumber: emp.accountNumber || `AC-${emp.employeeId}`,
        };
      })
      .filter((rec) => {
        if (payrollStatusFilter !== 'all' && rec.status !== payrollStatusFilter) {
          return false;
        }
        return true;
      });
  }, [
    employees,
    selectedDept,
    searchQuery,
    selectedMonth,
    savedPayrollRecords,
    firestoreAttendance,
    attendanceRequests,
    leaveRequests,
    roster,
    shifts,
    extractCleanPunches,
    monthlyPayrollRuns,
    payrollStatusFilter,
  ]);

  const payrollStats = useMemo(() => {
    const totalStaff = payrollReportData.length;
    const totalGross = payrollReportData.reduce((acc, r) => acc + r.gross, 0);
    const totalNet = payrollReportData.reduce((acc, r) => acc + r.netSalary, 0);
    const totalPF = payrollReportData.reduce((acc, r) => acc + r.pf, 0);
    const totalTax = payrollReportData.reduce((acc, r) => acc + r.tax, 0);
    const totalAbsentDeductions = payrollReportData.reduce((acc, r) => acc + (r.absentDeduction || 0), 0);
    const totalLatePenalties = payrollReportData.reduce((acc, r) => acc + r.lateCut, 0);
    const paidCount = payrollReportData.filter((r) => r.status === 'paid').length;
    const avgSalary = totalStaff > 0 ? Math.round(totalNet / totalStaff) : 0;
    return {
      totalStaff,
      totalGross,
      totalNet,
      totalPF,
      totalTax,
      totalAbsentDeductions,
      totalLatePenalties,
      paidCount,
      avgSalary,
    };
  }, [payrollReportData]);

  // =========================================================================
  // 3. EMPLOYEE MASTER REPORT DATA & STATS
  // =========================================================================
  const employeeReportData = useMemo(() => {
    return employees.filter((emp) => {
      if (selectedDept !== 'all' && emp.department?.toLowerCase() !== selectedDept.toLowerCase()) {
        return false;
      }
      if (empStatusFilter !== 'all' && (emp.status || 'active') !== empStatusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          emp.name.toLowerCase().includes(q) ||
          emp.employeeId.toLowerCase().includes(q) ||
          emp.designation.toLowerCase().includes(q) ||
          emp.email?.toLowerCase().includes(q) ||
          emp.phone?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [employees, selectedDept, empStatusFilter, searchQuery]);

  // =========================================================================
  // 4. LEAVE REPORT DATA & STATS
  // =========================================================================
  const leaveReportData = useMemo(() => {
    return leaveRequests.filter((l) => {
      const emp = employees.find((e) => e.employeeId === l.employeeId || e.id === l.employeeId);
      const dept = emp?.department || 'General';
      if (selectedDept !== 'all' && dept.toLowerCase() !== selectedDept.toLowerCase()) {
        return false;
      }
      if (leaveStatusFilter !== 'all' && l.status !== leaveStatusFilter) {
        return false;
      }
      if (leaveTypeFilter !== 'all' && l.type.toLowerCase() !== leaveTypeFilter.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          l.employeeName?.toLowerCase().includes(q) ||
          l.employeeId?.toLowerCase().includes(q) ||
          l.reason?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [leaveRequests, employees, selectedDept, leaveStatusFilter, leaveTypeFilter, searchQuery]);

  const leaveStats = useMemo(() => {
    const total = leaveReportData.length;
    const approved = leaveReportData.filter((l) => l.status === 'approved').length;
    const pending = leaveReportData.filter((l) => l.status === 'pending').length;
    const rejected = leaveReportData.filter((l) => l.status === 'rejected').length;
    const totalDaysApproved = leaveReportData
      .filter((l) => l.status === 'approved')
      .reduce((acc, l) => acc + (Number(l.days) || 1), 0);
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;
    return { total, approved, pending, rejected, totalDaysApproved, approvalRate };
  }, [leaveReportData]);

  // =========================================================================
  // 5. DEPARTMENT REPORT DATA & STATS
  // =========================================================================
  const departmentReportData = useMemo(() => {
    const getEmpGross = (e: any): number => {
      const explicitGross = Number(e.grossSalary);
      if (!isNaN(explicitGross) && explicitGross > 0) return explicitGross;
      const compSum =
        (Number(e.basicSalary ?? e.basic) || 0) +
        (Number(e.houseRent) || 0) +
        (Number(e.medical) || 0) +
        (Number(e.conveyance ?? e.transport) || 0) +
        (Number(e.food) || 0);
      if (compSum > 0) return compSum;
      const b = Number(e.basicSalary ?? e.basic) || 0;
      return b > 0 ? b * 2 : 0;
    };

    const totalCompanyGross = employees.reduce((acc, e) => acc + getEmpGross(e), 0);

    return departments
      .filter((d) => {
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            d.name.toLowerCase().includes(q) ||
            d.code?.toLowerCase().includes(q) ||
            d.head?.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .map((d) => {
        const deptEmps = employees.filter(
          (e) => e.department?.toLowerCase() === d.name?.toLowerCase()
        );
        const deptPayroll = deptEmps.reduce((acc, e) => acc + getEmpGross(e), 0);
        const headcountPct =
          employees.length > 0 ? Math.round((deptEmps.length / employees.length) * 100) : 0;
        const payrollPct =
          totalCompanyGross > 0 ? Math.round((deptPayroll / totalCompanyGross) * 100) : 0;

        return {
          id: d.id,
          name: d.name,
          code: d.code,
          head: d.head,
          employeeCount: deptEmps.length,
          deptPayroll,
          headcountPct,
          payrollPct,
          status: d.status || 'active',
        };
      });
  }, [departments, employees, searchQuery]);

  // =========================================================================
  // 6. SHIFT & ROSTER REPORT DATA & STATS
  // =========================================================================
  const shiftRosterReportData = useMemo(() => {
    return employees
      .filter((e) => {
        if (selectedDept !== 'all' && e.department?.toLowerCase() !== selectedDept.toLowerCase()) {
          return false;
        }
        if (shiftFilter !== 'all' && (e.shift || 'General Shift') !== shiftFilter) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            e.name.toLowerCase().includes(q) ||
            e.employeeId.toLowerCase().includes(q) ||
            e.department.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .map((emp) => {
        const empShift = findShiftByNameOrId(shifts, emp.shift) || {
          name: emp.shift ? emp.shift.trim() : 'Unassigned',
          startTime: emp.shift?.toLowerCase().includes('evening') ? '14:00' : '09:00',
          endTime: emp.shift?.toLowerCase().includes('evening') ? '00:00' : '18:00',
          graceTime: 15,
          totalHours: 8,
        };
        const sAny = empShift as any;
        const grace = sAny.graceTime ?? sAny.gracePeriod ?? 15;
        const fullHrs = sAny.totalHours ?? sAny.fullDayHours ?? 8;
        const halfHrs = Math.round(fullHrs / 2);

        return {
          employeeId: emp.employeeId,
          name: emp.name,
          department: emp.department,
          designation: emp.designation,
          shiftName: empShift.name,
          startTime: empShift.startTime,
          endTime: empShift.endTime,
          gracePeriod: grace,
          fullDayHours: fullHrs,
          halfDayHours: halfHrs,
        };
      });
  }, [employees, shifts, selectedDept, shiftFilter, searchQuery]);

  // =========================================================================
  // 7. RECRUITMENT REPORT DATA & STATS
  // =========================================================================
  const recruitmentReportData = useMemo(() => {
    return candidates.filter((c) => {
      if (recStageFilter !== 'all' && c.stage !== recStageFilter) {
        return false;
      }
      if (selectedDept !== 'all' && c.department?.toLowerCase() !== selectedDept.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.jobTitle.toLowerCase().includes(q) ||
          c.experience?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [candidates, recStageFilter, selectedDept, searchQuery]);

  const recruitmentStats = useMemo(() => {
    const totalCandidates = candidates.length;
    const hired = candidates.filter((c) => c.stage === 'hired').length;
    const inInterview = candidates.filter((c) => c.stage === 'interview').length;
    const offers = candidates.filter((c) => c.stage === 'offer').length;
    const openJobs = recruitmentJobs.filter((j) => (j as any).status !== 'closed').length;
    const totalVacancies = recruitmentJobs.reduce((acc, j) => acc + (j.vacancies || 1), 0);
    const hireRate = totalCandidates > 0 ? Math.round((hired / totalCandidates) * 100) : 0;
    return { totalCandidates, hired, inInterview, offers, openJobs, totalVacancies, hireRate };
  }, [candidates, recruitmentJobs]);

  // =========================================================================
  // 8. BIOMETRIC HARDWARE REPORT DATA & STATS
  // =========================================================================
  const biometricReportData = useMemo(() => {
    return devices.filter((d) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          d.name.toLowerCase().includes(q) ||
          d.model.toLowerCase().includes(q) ||
          d.serialNumber.toLowerCase().includes(q) ||
          d.ipAddress?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [devices, searchQuery]);

  // =========================================================================
  // 9. ATTENDANCE REGULARIZATION (LATE WAIVER & CHECKOUT) REPORT DATA & STATS
  // =========================================================================
  const regularizationReportData = useMemo(() => {
    return attendanceRequests.filter((r) => {
      if (selectedDept !== 'all' && r.department?.toLowerCase() !== selectedDept.toLowerCase()) {
        return false;
      }
      if (regTypeFilter !== 'all' && r.type !== regTypeFilter) {
        return false;
      }
      if (regStatusFilter !== 'all' && r.status !== regStatusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          r.employeeName?.toLowerCase().includes(q) ||
          r.employeeId?.toLowerCase().includes(q) ||
          r.reason?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [attendanceRequests, selectedDept, regTypeFilter, regStatusFilter, searchQuery]);

  const regularizationStats = useMemo(() => {
    const total = regularizationReportData.length;
    const lateRequests = regularizationReportData.filter((r) => r.type === 'late_arrival');
    const earlyRequests = regularizationReportData.filter((r) => r.type === 'early_checkout');
    const approved = regularizationReportData.filter((r) => r.status === 'approved').length;
    const pending = regularizationReportData.filter((r) => r.status === 'pending').length;
    const rejected = regularizationReportData.filter((r) => r.status === 'rejected').length;
    const lateApproved = lateRequests.filter((r) => r.status === 'approved').length;
    return {
      total,
      lateCount: lateRequests.length,
      earlyCount: earlyRequests.length,
      approved,
      pending,
      rejected,
      lateApproved,
    };
  }, [regularizationReportData]);

  // =========================================================================
  // 10. INDIVIDUAL EMPLOYEE 360° MASTER DOSSIER DATA & CALCULATIONS
  // =========================================================================
  const filteredDossierEmployees = useMemo(() => {
    return employees.filter((e) => {
      if (selectedDept !== 'all' && e.department?.trim().toLowerCase() !== selectedDept.trim().toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          e.name.toLowerCase().includes(q) ||
          e.employeeId.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [employees, selectedDept, searchQuery]);

  const dossierEmployee = useMemo(() => {
    const list = filteredDossierEmployees.length > 0 ? filteredDossierEmployees : employees;
    return (
      list.find(
        (e) => e.employeeId === selectedDossierEmpId || e.id === selectedDossierEmpId
      ) || list[0] || null
    );
  }, [filteredDossierEmployees, employees, selectedDossierEmpId]);

  const individualDossierData = useMemo(() => {
    if (!dossierEmployee) return null;

    const startStr = effectiveDossierRange.start;
    const endStr = effectiveDossierRange.end;

    // Generate all calendar dates in [startStr, endStr]
    const dateList: string[] = [];
    const [sy, sm, sd] = startStr.split('-').map(Number);
    const [ey, em, ed] = endStr.split('-').map(Number);
    const curDate = new Date(Date.UTC(sy || 2026, (sm || 1) - 1, sd || 1));
    const lastDate = new Date(Date.UTC(ey || 2026, (em || 1) - 1, ed || 1));
    let safety = 0;
    while (curDate <= lastDate && safety < 366) {
      dateList.push(curDate.toISOString().split('T')[0]);
      curDate.setUTCDate(curDate.getUTCDate() + 1);
      safety++;
    }
    const daysInPeriod = dateList.length || 1;

    // Read leave policy quotas
    let leaveQuotas = { annual: 14, casual: 10, sick: 14 };
    try {
      const savedPolicy = localStorage.getItem('worknest_settings_leave');
      if (savedPolicy) {
        const p = JSON.parse(savedPolicy);
        leaveQuotas = {
          annual: p.annualDays !== undefined ? Number(p.annualDays) : 14,
          casual: p.casualDays !== undefined ? Number(p.casualDays) : 10,
          sick: p.sickDays !== undefined ? Number(p.sickDays) : 14,
        };
      }
    } catch {}

    const empCode = String(dossierEmployee.employeeId || '').trim().toLowerCase();
    const empDocId = String(dossierEmployee.id || '').trim().toLowerCase();
    const empNameLower = String(dossierEmployee.name || '').trim().toLowerCase();

    const isEmpMatchRecord = (rec: any) => {
      if (!rec) return false;
      const rId = String(rec.employeeId || '').trim().toLowerCase();
      const rCode = String(rec.employeeCode || '').trim().toLowerCase();
      const rName = String(rec.employeeName || '').trim().toLowerCase();
      return (
        (empCode && (rId === empCode || rCode === empCode)) ||
        (empDocId && (rId === empDocId || rCode === empDocId)) ||
        (empNameLower && rName === empNameLower)
      );
    };

    const empLeaves = leaveRequests.filter(
      (l) => isEmpMatchRecord(l) && l.status === 'approved'
    );
    const usedCasual = empLeaves.filter((l) => l.type.toLowerCase().includes('casual')).reduce((s, l) => s + (l.days || 1), 0);
    const usedSick = empLeaves.filter((l) => l.type.toLowerCase().includes('sick')).reduce((s, l) => s + (l.days || 1), 0);
    const usedAnnual = empLeaves.filter((l) => l.type.toLowerCase().includes('annual')).reduce((s, l) => s + (l.days || 1), 0);
    const usedUnpaid = empLeaves.filter((l) => l.type.toLowerCase().includes('unpaid')).reduce((s, l) => s + (l.days || 1), 0);

    const empAttRequests = attendanceRequests.filter((r) => isEmpMatchRecord(r));

    // Build day-by-day punch timesheet for the selected date range
    const dailyRecords: any[] = [];
    let presentCount = 0;
    let weekendPresentCount = 0;
    let lateCount = 0;
    let unexcusedLateCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    let halfDayCount = 0;
    let totalWorkedMinutes = 0;
    let totalOvertimeMinutes = 0;
    let earlyOutCount = 0;
    let rosterOffDayCount = 0;
    const todayStr = new Date().toISOString().split('T')[0];

    for (const dateStr of dateList) {
      const [yNum, mNum, dNum] = dateStr.split('-').map(Number);
      const dObj = new Date(yNum, (mNum || 1) - 1, dNum || 1);
      const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' });
      // Find attendance document for this date
      const attRecord = firestoreAttendance.find(
        (a) => a.date === dateStr && isEmpMatchRecord(a)
      );
      const sched = resolveEmployeeScheduleForDate(dossierEmployee, dateStr, roster, shifts, attRecord?.shiftName);
      const dateShiftName = resolveEmployeeShiftNameForDate(dossierEmployee, dateStr, attRecord?.shiftName);
      const isWeekend = Boolean(sched.isWeekend || sched.isOff);
      if (isWeekend) {
        rosterOffDayCount++;
      }
      const isFlexibleShift = Boolean(
        sched.shift?.type === 'flexible' ||
        sched.shiftName.toLowerCase().includes('flexible') ||
        sched.shiftName.toLowerCase().includes('flexi') ||
        dateShiftName.toLowerCase().includes('flexible') ||
        !sched.latePolicyEnabled
      );

      // Find approved leave covering date
      const activeLeave = empLeaves.find((l) => l.from <= dateStr && dateStr <= l.to);

      const { checkIn: rawIn, checkOut: rawOut } = extractCleanPunches(attRecord);
      const hasPunch = rawIn !== '-' || rawOut !== '-';

      let status = 'absent';
      let workedHoursNum = 0;
      let workedMinutes = 0;
      let dayOtHours = 0;
      let lateMinutes = 0;
      let isEarlyOut = false;
      let isLateWaived = false;

      if (attRecord && (hasPunch || attRecord.status)) {
        const isOvernight = Boolean(
          attRecord.isOvernight ||
          sched.isOvernight ||
          isEveningOrOvernight(sched) ||
          (rawIn !== '-' && rawOut !== '-' && normalizeTimeStr(rawOut) < normalizeTimeStr(rawIn))
        );
        const duty = calculateDutyDuration(rawIn, rawOut, isOvernight, sched.breakTime);
        const rawSavedHours =
          attRecord.totalHours !== undefined && attRecord.totalHours !== null
            ? Number(attRecord.totalHours)
            : attRecord.workHours !== undefined && attRecord.workHours !== null
            ? Number(attRecord.workHours)
            : null;

        workedHoursNum =
          rawIn !== '-' && rawOut !== '-'
            ? (duty.durationHours > 0
                ? duty.durationHours
                : rawSavedHours !== null && rawSavedHours > 0
                ? rawSavedHours
                : 0)
            : (rawSavedHours !== null && rawSavedHours > 0 ? rawSavedHours : 0);

        workedMinutes =
          rawIn !== '-' && rawOut !== '-' && duty.durationMinutes > 0
            ? duty.durationMinutes
            : Math.round(workedHoursNum * 60);

        const effShift =
          sched.shift ||
          findShiftByNameOrId(shifts, sched.shiftName) ||
          findShiftByNameOrId(shifts, dateShiftName);
        const isOtAllowed =
          !sched.isWeekend &&
          !sched.isOff &&
          sched.overtimePolicyEnabled !== false &&
          isShiftOvertimeEnabled(effShift);

        const calcOt = isOtAllowed
          ? calculateOvertimeHours(rawIn, rawOut, { ...sched, shift: effShift || sched.shift, overtimePolicyEnabled: isOtAllowed, isOvernight })
          : 0;
        const savedOt =
          attRecord.otHours !== undefined && attRecord.otHours !== null
            ? Number(attRecord.otHours)
            : attRecord.overtimeHours !== undefined && attRecord.overtimeHours !== null
            ? Number(attRecord.overtimeHours)
            : null;
        dayOtHours = !isOtAllowed
          ? 0
          : attRecord.source === 'admin_edit' && savedOt !== null
          ? savedOt
          : rawIn !== '-' && rawOut !== '-'
          ? calcOt
          : savedOt !== null && savedOt > 0
          ? savedOt
          : 0;

        // Resolve status, late minutes, and early-out strictly against the date's effective shift schedule
        const evalRes = evaluateAttendanceForSchedule(rawIn, rawOut, sched, attRecord, dateShiftName);
        status = evalRes.status;

        isLateWaived = Boolean(
          attRecord.isLateExcused ||
          attRecord.lateWaived ||
          empAttRequests.some(
            (r) => r.date === dateStr && r.type === 'late_arrival' && r.status === 'approved'
          )
        );

        if (status === 'present') {
          presentCount++;
          if (isWeekend) weekendPresentCount++;
        } else if (status === 'late') {
          presentCount++;
          if (isWeekend) weekendPresentCount++;
          lateCount++;
          if (!isLateWaived) {
            unexcusedLateCount++;
          }
          lateMinutes = evalRes.lateMinutes > 0 ? evalRes.lateMinutes : 15;
        } else if (status === 'half_day') {
          presentCount++;
          if (isWeekend) weekendPresentCount++;
          halfDayCount++;
        } else if (status === 'absent') {
          absentCount++;
        }

        totalWorkedMinutes += workedMinutes;
        if (dayOtHours > 0) {
          totalOvertimeMinutes += Math.round(dayOtHours * 60);
        }

        // Check Early Out against the date's effective shift schedule
        isEarlyOut = evalRes.isEarlyOut;
        if (isEarlyOut) earlyOutCount++;
      } else if (activeLeave) {
        status = 'leave';
        leaveCount++;
      } else if (isWeekend) {
        status = 'off_day';
      } else {
        if (dateStr <= todayStr) {
          status = 'absent';
          absentCount++;
        } else {
          status = 'scheduled';
        }
      }

      const hFloor = Math.floor(workedMinutes / 60);
      const mRem = workedMinutes % 60;
      const workedHoursFormatted =
        workedMinutes > 0
          ? `${hFloor}h ${String(mRem).padStart(2, '0')}m (${workedHoursNum.toFixed(1)}h)`
          : rawIn !== '-' && rawOut === '-'
          ? 'In Progress'
          : '—';

      const resolvedShiftDisplay = isWeekend
        ? 'Weekend / Off'
        : sched.shiftName && sched.shiftName !== 'Unassigned'
        ? sched.shiftName
        : attRecord?.shiftName || dossierEmployee.shift || 'General Shift';

      dailyRecords.push({
        date: dateStr,
        dayName,
        isWeekend,
        shift: resolvedShiftDisplay,
        checkIn: rawIn !== '-' ? formatTo12Hour(rawIn) : '—',
        checkOut: rawOut !== '-' ? formatTo12Hour(rawOut) : '—',
        rawIn,
        rawOut,
        workedHours: workedHoursFormatted,
        workedHoursNum,
        workedMinutes,
        otHours: dayOtHours,
        otDisplay: dayOtHours > 0 ? `+${dayOtHours.toFixed(1)}h` : '—',
        status,
        lateMinutes,
        isLateWaived,
        isEarlyOut,
        rawAtt: attRecord,
        leaveReason: activeLeave?.reason,
      });
    }

    // Payroll breakdown for this employee (aligned 100% with Employee Profile & Payroll module)
    const explicitGross = Number(dossierEmployee.grossSalary);
    const compSum =
      (Number(dossierEmployee.basicSalary ?? dossierEmployee.basic) || 0) +
      (Number(dossierEmployee.houseRent) || 0) +
      (Number(dossierEmployee.medical) || 0) +
      (Number(dossierEmployee.conveyance ?? dossierEmployee.transport) || 0) +
      (Number(dossierEmployee.food) || 0);
    const gross =
      !isNaN(explicitGross) && explicitGross > 0
        ? explicitGross
        : compSum > 0
        ? compSum
        : (Number(dossierEmployee.basicSalary ?? dossierEmployee.basic) || 0) * 2;
    const basic = Number(dossierEmployee.basicSalary ?? dossierEmployee.basic) || Math.round(gross * 0.5);
    const houseRent = Number(dossierEmployee.houseRent) || Math.round(gross * 0.3);
    const medical = Number(dossierEmployee.medical) || Math.round(gross * 0.1);
    const conveyance = Number(dossierEmployee.conveyance ?? dossierEmployee.transport) || Math.round(gross * 0.1);
    const food = Number(dossierEmployee.food) || 0;

    const recKey = `${selectedMonth}_${dossierEmployee.id}`;
    const altKey = `${selectedMonth}_${dossierEmployee.employeeId}`;
    const savedRec = savedPayrollRecords[recKey] || savedPayrollRecords[altKey];

    const workingDays =
      savedRec?.workingDaysCustomOverride && savedRec?.workingDays
        ? Number(savedRec.workingDays)
        : Math.max(0, daysInPeriod - rosterOffDayCount);
    const isV2Edited = Boolean(savedRec?.manualOverrideV2);
    const effBasic = savedRec?.manuallyEdited && savedRec?.basicSalary ? Number(savedRec.basicSalary) : basic;
    const effHouseRent = savedRec?.manuallyEdited && savedRec?.houseRent !== undefined ? Number(savedRec.houseRent) : houseRent;
    const effMedical = savedRec?.manuallyEdited && savedRec?.medical !== undefined ? Number(savedRec.medical) : medical;
    const effConveyance = savedRec?.manuallyEdited && savedRec?.conveyance !== undefined ? Number(savedRec.conveyance) : conveyance;
    const effFood = savedRec?.manuallyEdited && savedRec?.food !== undefined ? Number(savedRec.food) : food;

    // User Rule: Whether 30-day or 31-day month, 1 day salary for Late (3 days = 1 day cut) & Absent Deduction is ALWAYS Gross Salary / 30
    const effBaseGross = effBasic + effHouseRent + effMedical + effConveyance + effFood;
    const oneDayGross30 = effBaseGross / 30;
    const oneDaySalary = Math.round(oneDayGross30);
    const latePenaltyDeduction =
      isV2Edited && savedRec?.lateDeduction !== undefined && Number(savedRec.lateDeduction) > 0
        ? Number(savedRec.lateDeduction)
        : Math.round(Math.floor(unexcusedLateCount / 3) * oneDayGross30);

    // Automatic Absent Deduction based on Gross Salary / 30 per absent day
    const effectiveAbsentDays =
      isV2Edited && savedRec?.absentDays !== undefined
        ? Number(savedRec.absentDays)
        : absentCount;
    const gross30AbsentCut = Math.round(effectiveAbsentDays * oneDayGross30);
    const absentDeduction = savedRec?.absentDeductionManualZeroV2
      ? 0
      : isV2Edited && Number(savedRec?.absentDeduction) > 0
      ? Number(savedRec.absentDeduction)
      : gross30AbsentCut;

    // Weekend Duty Earning & Allowances (when employee does not take Weekend off and is Present)
    const weekendDays =
      isV2Edited && savedRec?.weekendDays !== undefined
        ? Number(savedRec.weekendDays)
        : weekendPresentCount;
    const weekendAllowance =
      savedRec?.weekendAllowanceCustomOverride && savedRec?.weekendAllowanceManualZero
        ? 0
        : savedRec?.weekendAllowanceCustomOverride && Number(savedRec?.weekendAllowance) > 0
        ? Number(savedRec.weekendAllowance)
        : Math.round(weekendDays * oneDayGross30);

    // Overtime Rule: ((Basic Salary / 30) / Shift Working Hours) * 1.5
    const shiftWorkingHours = getEmployeeShiftWorkingHours(
      dossierEmployee,
      shifts,
      roster,
      selectedMonth,
      firestoreAttendance.filter(isEmpMatchRecord)
    );
    const effShiftHours =
      savedRec?.shiftWorkingHours && Number(savedRec.shiftWorkingHours) > 0
        ? Number(savedRec.shiftWorkingHours)
        : shiftWorkingHours;
    const otRate =
      savedRec?.overtimeRateCustomOverride && Number(savedRec?.overtimeRate) > 0
        ? Number(savedRec.overtimeRate)
        : calculateHourlyOtRate(effBasic, effShiftHours);
    const exactOtRate =
      savedRec?.overtimeRateCustomOverride && Number(savedRec?.overtimeRate) > 0
        ? Number(savedRec.overtimeRate)
        : (((effBasic / 30) / (effShiftHours || 8)) * 1.5);
    const otHours =
      isV2Edited && savedRec?.overtimeHours !== undefined
        ? Number(savedRec.overtimeHours)
        : Number((totalOvertimeMinutes / 60).toFixed(1));
    const overtimeAmount = Math.round(otHours * exactOtRate);

    const attendanceBonus =
      savedRec && savedRec.attendanceBonus !== undefined
        ? Number(savedRec.attendanceBonus) || 0
        : Number(dossierEmployee.attendanceBonus) || 0;
    const festivalBonus = savedRec ? Number(savedRec.festivalBonus) || 0 : 0;
    const customEarningName = savedRec?.customEarningName || '';
    const otherAllowance = savedRec ? Number(savedRec.otherAllowance) || 0 : 0;

    const pf = savedRec ? Number(savedRec.pfDeduction) || 0 : 0;
    const tax = savedRec ? Number(savedRec.taxDeduction) || 0 : 0;
    const advanceDeduction = savedRec ? Number(savedRec.advanceDeduction) || 0 : 0;
    const loanDeduction = savedRec ? Number(savedRec.loanDeduction) || 0 : 0;
    const customDeductionName = savedRec?.customDeductionName || '';
    const otherDeduction = savedRec ? Number(savedRec.otherDeduction) || 0 : 0;

    const totalEarnings =
      effBasic +
      effHouseRent +
      effMedical +
      effConveyance +
      effFood +
      weekendAllowance +
      overtimeAmount +
      attendanceBonus +
      festivalBonus +
      otherAllowance;

    const totalDeductions =
      latePenaltyDeduction +
      absentDeduction +
      pf +
      tax +
      advanceDeduction +
      loanDeduction +
      otherDeduction;
    const netSalary = Math.max(0, totalEarnings - totalDeductions);
    const paymentStatus = savedRec?.status || (monthlyPayrollRuns[selectedMonth] ? 'paid' : 'pending');

    const totalHoursFloat = totalWorkedMinutes / 60;
    const totalHoursH = Math.floor(totalWorkedMinutes / 60);
    const totalHoursM = totalWorkedMinutes % 60;
    const totalWorkedFormatted = `${totalHoursH}h ${String(totalHoursM).padStart(2, '0')}m`;
    const avgDailyHours = presentCount > 0 ? (totalHoursFloat / presentCount).toFixed(1) : '0.0';
    const totalOtHours = (totalOvertimeMinutes / 60).toFixed(1);

    const filteredDailyRecords =
      dossierTableStatusFilter === 'all'
        ? dailyRecords
        : dailyRecords.filter((r) => {
            if (dossierTableStatusFilter === 'present_all') return r.status === 'present' || r.status === 'late' || r.status === 'half_day';
            return r.status === dossierTableStatusFilter;
          });

    return {
      employee: dossierEmployee,
      daysInMonth: daysInPeriod,
      workingDays,
      periodLabel: effectiveDossierRange.label,
      startStr,
      endStr,
      dailyRecords,
      filteredDailyRecords,
      stats: {
        presentCount,
        weekendPresentCount,
        lateCount,
        unexcusedLateCount,
        absentCount: effectiveAbsentDays,
        leaveCount,
        halfDayCount,
        earlyOutCount,
        totalHours: totalHoursFloat.toFixed(1),
        totalWorkedMinutes,
        totalWorkedFormatted,
        avgDailyHours,
        totalOtHours,
      },
      leaveLedger: {
        annual: { total: leaveQuotas.annual, used: usedAnnual, remaining: Math.max(0, leaveQuotas.annual - usedAnnual) },
        casual: { total: leaveQuotas.casual, used: usedCasual, remaining: Math.max(0, leaveQuotas.casual - usedCasual) },
        sick: { total: leaveQuotas.sick, used: usedSick, remaining: Math.max(0, leaveQuotas.sick - usedSick) },
        unpaid: { total: 0, used: usedUnpaid, remaining: 0 },
        requests: empLeaves,
      },
      regularizations: empAttRequests,
      payroll: {
        basic: effBasic,
        houseRent: effHouseRent,
        medical: effMedical,
        conveyance: effConveyance,
        food: effFood,
        gross: totalEarnings,
        oneDaySalary,
        weekendDays,
        weekendAllowance,
        otHours,
        otRate,
        overtimeAmount,
        attendanceBonus,
        festivalBonus,
        customEarningName,
        otherAllowance,
        latePenaltyDeduction,
        absentDeduction,
        pf,
        tax,
        advanceDeduction,
        loanDeduction,
        customDeductionName,
        otherDeduction,
        totalDeductions,
        netSalary,
        paymentStatus,
        bankName: dossierEmployee.bankName || 'Dutch Bangla Bank / City Bank',
        accountNumber: dossierEmployee.accountNumber || `AC-${dossierEmployee.employeeId}`,
      }
    };
  }, [
    dossierEmployee,
    selectedMonth,
    effectiveDossierRange,
    dossierTableStatusFilter,
    firestoreAttendance,
    leaveRequests,
    attendanceRequests,
    roster,
    shifts,
    savedPayrollRecords,
    monthlyPayrollRuns,
    extractCleanPunches
  ]);

  // Module Tabs Configuration
  const modulesList: { id: ReportModule; label: string; icon: string; count: number }[] = [
    { id: 'attendance', label: 'Attendance', icon: '📅', count: attendanceReportData.length },
    { id: 'payroll', label: 'Payroll & Salary', icon: '💰', count: payrollReportData.length },
    { id: 'individual_dossier', label: 'Employee 360° Dossier', icon: '👤', count: employees.length },
    { id: 'employee', label: 'Employee Master', icon: '👥', count: employeeReportData.length },
    { id: 'leave', label: 'Leave Analytics', icon: '🏖️', count: leaveReportData.length },
    { id: 'department', label: 'Departments & Cost', icon: '🏢', count: departmentReportData.length },
    { id: 'shift_roster', label: 'Shifts & Roster', icon: '⏱️', count: shiftRosterReportData.length },
    { id: 'recruitment', label: 'Recruitment & Jobs', icon: '🎯', count: recruitmentReportData.length },
    { id: 'biometric', label: 'Biometric Devices', icon: '📟', count: biometricReportData.length },
    { id: 'regularization', label: 'Late Waivers & Regs', icon: '📝', count: regularizationReportData.length },
  ];

  // Dynamic audit-grade printable configuration for all 9 modules
  const currentReportConfig: PrintReportConfig = useMemo(() => {
    const deptName = selectedDept === 'all' ? 'All Departments' : selectedDept;
    const nowStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    switch (activeModule) {
      case 'attendance': {
        const periodStr = dateMode === 'day' ? `Date: ${selectedDate}` : `Month: ${selectedMonth}`;
        return {
          title: 'Personnel Attendance & Biometric Audit Register',
          subtitle: 'Daily & monthly staff presence, punch source, worked duration and overtime records',
          period: periodStr,
          orientation: 'landscape',
          filters: [
            { label: 'Mode', value: dateMode === 'day' ? 'Single Date' : 'Full Month' },
            { label: 'Department', value: deptName },
            { label: 'Status Filter', value: attStatusFilter.toUpperCase() },
            ...(searchQuery ? [{ label: 'Search', value: searchQuery }] : []),
          ],
          metrics: [
            { label: 'Total Logs', value: attendanceStats.total },
            { label: 'Present / On-Time', value: attendanceStats.present, highlight: true },
            { label: 'Late Arrivals', value: attendanceStats.late },
            { label: 'Absents', value: attendanceStats.absent },
            { label: 'Total Work Hours', value: `${attendanceStats.totalWorkHours.toFixed(1)} hrs`, highlight: true },
            { label: 'Total Overtime', value: `${attendanceStats.totalOvertime.toFixed(1)} hrs` },
          ],
          headers: [
            'Date',
            'Employee ID',
            'Name',
            'Department',
            'Designation',
            'Check-In',
            'Check-Out',
            'Work Hrs',
            'Overtime',
            'Status',
          ],
          rows: attendanceReportData.map((r) => [
            r.date || selectedDate,
            r.employeeId || '',
            r.employeeName || '',
            r.department || '',
            r.designation || 'Staff',
            formatTo12Hour(r.checkIn),
            formatTo12Hour(r.checkOut),
            r.totalHours && Number(r.totalHours) > 0 ? `${Number(r.totalHours).toFixed(1)}h` : (r.checkIn && r.checkIn !== '-' && (!r.checkOut || r.checkOut === '-') ? 'In Progress' : '—'),
            r.overtimeHours && Number(r.overtimeHours) > 0 ? `+${Number(r.overtimeHours).toFixed(1)}h` : '0h',
            r.status === 'weekend_off' ? 'Weekend / Off' : (r.status || 'present'),
          ]),
        };
      }

      case 'payroll': {
        return {
          title: 'Monthly Compensation & Payroll Disbursement Register',
          subtitle: 'Official breakdown of basic earnings, allowances, statutory PF, late penalties and net payable salary',
          period: `Month: ${selectedMonth}`,
          orientation: 'landscape',
          filters: [
            { label: 'Reporting Month', value: selectedMonth },
            { label: 'Department', value: deptName },
            { label: 'Payment Status', value: payrollStatusFilter.toUpperCase() },
            ...(searchQuery ? [{ label: 'Search', value: searchQuery }] : []),
          ],
          metrics: [
            { label: 'Headcount', value: payrollStats.totalStaff },
            { label: 'Gross Payroll', value: `৳${payrollStats.totalGross.toLocaleString()}`, highlight: true },
            { label: 'PF Deductions', value: `৳${payrollStats.totalPF.toLocaleString()}` },
            { label: 'Late Cuts (3-Day)', value: `৳${payrollStats.totalLatePenalties.toLocaleString()}` },
            { label: 'Net Take-Home', value: `৳${payrollStats.totalNet.toLocaleString()}`, highlight: true },
            { label: 'Disbursement Status', value: monthlyPayrollRuns[selectedMonth] ? 'Disbursed (Paid)' : 'Pending Review' },
          ],
          headers: [
            'Employee ID',
            'Name',
            'Department',
            'Attendance (P/A)',
            'Basic (৳)',
            'Gross (৳)',
            'Absent Cut (৳)',
            'Late Cut (৳)',
            'PF & Tax (৳)',
            'Total Deductions (৳)',
            'Net Payable (৳)',
            'Status',
            'Bank Account',
          ],
          rows: payrollReportData.map((r) => [
            r.employeeId,
            r.name,
            r.department,
            `${r.presentDays}P / ${r.absentDays}A (${r.totalMonthDays}d)`,
            `৳${r.basic.toLocaleString()}`,
            `৳${r.gross.toLocaleString()}`,
            `৳${(r.absentDeduction || 0).toLocaleString()}`,
            `৳${r.lateCut.toLocaleString()}`,
            `৳${(r.pf + r.tax).toLocaleString()}`,
            `৳${r.totalDeductions.toLocaleString()}`,
            `৳${r.netSalary.toLocaleString()}`,
            r.status,
            r.accountNumber || 'Cash/Direct',
          ]),
        };
      }

      case 'individual_dossier': {
        const emp = individualDossierData?.employee;
        const stats = individualDossierData?.stats;
        const pay = individualDossierData?.payroll;
        return {
          title: `Employee Comprehensive 360° Dossier & Statement — ${emp?.name || 'Staff'}`,
          subtitle: `ID: ${emp?.employeeId || 'N/A'} • ${emp?.designation || 'Staff'} • ${emp?.department || 'Operations'} • Joining: ${emp?.joinDate || 'N/A'}`,
          period: individualDossierData?.periodLabel || `Month: ${selectedMonth}`,
          orientation: 'landscape',
          filters: [
            { label: 'Employee', value: `${emp?.name} (${emp?.employeeId})` },
            { label: 'Department', value: emp?.department || 'N/A' },
            { label: 'Period', value: individualDossierData?.periodLabel || selectedMonth },
          ],
          metrics: [
            { label: 'Present Days', value: stats?.presentCount ?? 0, highlight: true },
            { label: 'Late Arrivals', value: stats?.lateCount ?? 0 },
            { label: 'Absent Days', value: stats?.absentCount ?? 0 },
            { label: 'Leave Days', value: stats?.leaveCount ?? 0 },
            { label: 'Total Work Hours', value: `${stats?.totalHours ?? 0} hrs (${stats?.totalWorkedFormatted || '0h 00m'})`, highlight: true },
            { label: 'Net Payable Salary', value: `৳${(pay?.netSalary ?? 0).toLocaleString()}`, highlight: true },
          ],
          headers: [
            'Date',
            'Day',
            'Shift',
            'Check-In (AM/PM)',
            'Check-Out (AM/PM)',
            'Work Hours',
            'Overtime',
            'Status',
            'Daily Remarks',
          ],
          rows: (individualDossierData?.filteredDailyRecords || individualDossierData?.dailyRecords || []).map((r: any) => [
            r.date,
            r.dayName,
            r.shift,
            r.checkIn || '—',
            r.checkOut || '—',
            r.workedHours,
            r.otDisplay || '—',
            r.status.toUpperCase(),
            r.leaveReason || (r.lateMinutes > 0 ? `Late by ${r.lateMinutes}m` : r.isWeekend ? 'Weekend Off' : r.rawIn !== '-' ? 'Biometric Punch Verified' : 'No Punch'),
          ]),
        };
      }

      case 'employee': {
        const empActive = employeeReportData.filter((e) => e.status === 'active' || !e.status).length;
        const empOnLeave = employeeReportData.filter((e) => e.status === 'on_leave').length;
        const empInactive = employeeReportData.filter((e) => (e.status as string) === 'inactive' || (e.status as string) === 'terminated').length;

        return {
          title: 'Employee Master Record & Staff Directory',
          subtitle: 'Comprehensive personnel profile listing, designations, shift allocations and active employment status',
          period: `Active Roster as of ${nowStr}`,
          orientation: 'landscape',
          filters: [
            { label: 'Department', value: deptName },
            { label: 'Employment Status', value: empStatusFilter.toUpperCase() },
            ...(searchQuery ? [{ label: 'Search', value: searchQuery }] : []),
          ],
          metrics: [
            { label: 'Total Headcount', value: employeeReportData.length, highlight: true },
            { label: 'Active Staff', value: empActive },
            { label: 'On Leave', value: empOnLeave },
            { label: 'Inactive / Terminated', value: empInactive },
            { label: 'Total Departments', value: departments.length },
          ],
          headers: [
            'Employee ID',
            'Full Name',
            'Department',
            'Designation',
            'Official Email',
            'Contact Phone',
            'Assigned Shift',
            'Status',
            'Gross Salary (৳)',
          ],
          rows: employeeReportData.map((e) => [
            e.employeeId,
            e.name,
            e.department,
            e.designation,
            e.email || '—',
            e.phone || '—',
            e.shift || 'General Shift',
            e.status || 'active',
            `৳${(e.grossSalary || 0).toLocaleString()}`,
          ]),
        };
      }

      case 'leave': {
        return {
          title: 'Employee Leave Ledger & Absence Utilization Report',
          subtitle: 'Audit trail of paid, casual, sick, annual and unexcused leaves with supervisor approval status',
          period: `Period: ${selectedMonth}`,
          orientation: 'landscape',
          filters: [
            { label: 'Department', value: deptName },
            { label: 'Leave Type', value: leaveTypeFilter.toUpperCase() },
            { label: 'Approval Status', value: leaveStatusFilter.toUpperCase() },
            ...(searchQuery ? [{ label: 'Search', value: searchQuery }] : []),
          ],
          metrics: [
            { label: 'Total Applications', value: leaveStats.total },
            { label: 'Approved Days', value: leaveStats.totalDaysApproved, highlight: true },
            { label: 'Approved Requests', value: leaveStats.approved },
            { label: 'Pending Review', value: leaveStats.pending },
            { label: 'Rejected', value: leaveStats.rejected },
          ],
          headers: [
            'Request ID',
            'Employee ID',
            'Employee Name',
            'Department',
            'Leave Type',
            'From Date',
            'To Date',
            'Duration (Days)',
            'Status',
            'Reason / Justification',
          ],
          rows: leaveReportData.map((l) => [
            l.id ? l.id.slice(-6).toUpperCase() : 'REQ',
            l.employeeId,
            l.employeeName,
            l.department || '—',
            (l.type || 'casual').toUpperCase(),
            l.from || (l as any).startDate || '—',
            l.to || (l as any).endDate || '—',
            l.days || 1,
            l.status,
            l.reason || 'Personal reasons',
          ]),
        };
      }

      case 'department': {
        const totalDeptStaff = departmentReportData.reduce((acc, d) => acc + d.employeeCount, 0);
        const totalDeptCost = departmentReportData.reduce((acc, d) => acc + d.deptPayroll, 0);

        return {
          title: 'Departmental Structure & Payroll Cost Allocation Report',
          subtitle: 'Organizational hierarchy, staff distribution per business unit, and department monthly compensation',
          period: `Period: ${selectedMonth}`,
          orientation: 'portrait',
          filters: [
            ...(searchQuery ? [{ label: 'Search', value: searchQuery }] : []),
          ],
          metrics: [
            { label: 'Total Departments', value: departmentReportData.length, highlight: true },
            { label: 'Total Employees', value: totalDeptStaff },
            { label: 'Monthly Payroll Allocation', value: `৳${totalDeptCost.toLocaleString()}` },
          ],
          headers: [
            'Department Name',
            'Dept Code',
            'Department Head',
            'Total Staff',
            'Workforce Ratio (%)',
            'Monthly Payroll Cost (৳)',
          ],
          rows: departmentReportData.map((d) => [
            d.name,
            d.code,
            d.head,
            d.employeeCount,
            `${d.headcountPct}%`,
            `৳${d.deptPayroll.toLocaleString()}`,
          ]),
        };
      }

      case 'shift_roster': {
        const genCount = shiftRosterReportData.filter((s) => (s.shiftName || '').toLowerCase().includes('general')).length;
        const mornCount = shiftRosterReportData.filter((s) => (s.shiftName || '').toLowerCase().includes('morning')).length;
        const nightCount = shiftRosterReportData.filter((s) => (s.shiftName || '').toLowerCase().includes('night') || (s.shiftName || '').toLowerCase().includes('evening')).length;

        return {
          title: 'Duty Roster & Shift Scheduling Matrix',
          subtitle: 'Active shifts, grace periods, full-day duration, and half-day absence rules',
          period: `Active Operations Roster`,
          orientation: 'landscape',
          filters: [
            { label: 'Department', value: deptName },
            { label: 'Shift Filter', value: shiftFilter.toUpperCase() },
            ...(searchQuery ? [{ label: 'Search', value: searchQuery }] : []),
          ],
          metrics: [
            { label: 'Assigned Personnel', value: shiftRosterReportData.length, highlight: true },
            { label: 'General Shifts', value: genCount },
            { label: 'Morning Shifts', value: mornCount },
            { label: 'Evening/Night Shifts', value: nightCount },
          ],
          headers: [
            'Employee ID',
            'Name',
            'Department',
            'Shift Title',
            'Start Time',
            'End Time',
            'Grace Period',
            'Full Day Quota',
            'Half Day Limit',
          ],
          rows: shiftRosterReportData.map((s) => [
            s.employeeId,
            s.name,
            s.department,
            s.shiftName,
            s.startTime,
            s.endTime,
            `${s.gracePeriod} mins`,
            `${s.fullDayHours} hrs`,
            `${s.halfDayHours} hrs`,
          ]),
        };
      }

      case 'recruitment': {
        return {
          title: 'Talent Acquisition & Candidate Recruitment Report',
          subtitle: 'Pipeline conversion, open job requisitions, candidate evaluation ratings and hiring status',
          period: `Active Recruitment Pipeline`,
          orientation: 'landscape',
          filters: [
            { label: 'Department', value: deptName },
            { label: 'Hiring Stage', value: recStageFilter.toUpperCase() },
            ...(searchQuery ? [{ label: 'Search', value: searchQuery }] : []),
          ],
          metrics: [
            { label: 'Active Candidates', value: recruitmentStats.totalCandidates },
            { label: 'Hired Candidates', value: recruitmentStats.hired, highlight: true },
            { label: 'In Interview', value: recruitmentStats.inInterview },
            { label: 'Offer Stage', value: recruitmentStats.offers },
            { label: 'Open Positions', value: recruitmentStats.openJobs },
            { label: 'Total Vacancies', value: recruitmentStats.totalVacancies },
          ],
          headers: [
            'Candidate Name',
            'Applied Position',
            'Department',
            'Current Stage',
            'Interview Rating',
            'Expected Salary (৳)',
            'Experience',
            'Application Date',
          ],
          rows: recruitmentReportData.map((c) => [
            c.name,
            c.jobTitle,
            c.department || '—',
            c.stage,
            c.rating ? `${c.rating}/5` : 'N/A',
            `৳${(c.expectedSalary || 0).toLocaleString()}`,
            c.experience || '—',
            c.appliedDate ? new Date(c.appliedDate).toLocaleDateString() : '—',
          ]),
        };
      }

      case 'biometric': {
        const bioOnline = biometricReportData.filter((d) => d.status === 'online' || d.status === 'connected').length;
        const bioOffline = biometricReportData.filter((d) => d.status === 'offline' || d.status === 'error').length;
        const bioAdms = biometricReportData.filter((d) => (d.connectionType || '').toLowerCase().includes('adms')).length;
        const bioTcp = biometricReportData.filter((d) => (d.connectionType || '').toLowerCase().includes('tcp') || (d.connectionType || '').toLowerCase().includes('ethernet')).length;

        return {
          title: 'Biometric Attendance Hardware & Network Sync Audit',
          subtitle: 'Hardware devices, terminal IP configurations, connection protocols and automated sync health',
          period: `Hardware Health Audit as of ${nowStr}`,
          orientation: 'landscape',
          filters: [
            ...(searchQuery ? [{ label: 'Search Query', value: searchQuery }] : []),
          ],
          metrics: [
            { label: 'Total Devices', value: biometricReportData.length, highlight: true },
            { label: 'Online & Active', value: bioOnline },
            { label: 'Offline / Warning', value: bioOffline },
            { label: 'ADMS Cloud Sync', value: bioAdms },
            { label: 'Direct TCP/IP', value: bioTcp },
          ],
          headers: [
            'Terminal Name',
            'Hardware Model',
            'Serial Number',
            'IP Address',
            'Port',
            'Protocol',
            'Connection Status',
            'Last Data Sync',
          ],
          rows: biometricReportData.map((d) => [
            d.name,
            d.model,
            d.serialNumber,
            d.ipAddress || 'DHCP Dynamic',
            d.port || 4370,
            d.connectionType,
            d.status,
            d.syncedAt || d.lastSync || 'Never',
          ]),
        };
      }

      case 'regularization': {
        return {
          title: 'Attendance Regularization & Late Penalty Waiver Register',
          subtitle: 'Employee requests for unexcused late waiver and early departure adjustments with admin approvals',
          period: `Period: ${selectedMonth}`,
          orientation: 'landscape',
          filters: [
            { label: 'Department', value: deptName },
            { label: 'Request Type', value: regTypeFilter.toUpperCase() },
            { label: 'Approval Status', value: regStatusFilter.toUpperCase() },
            ...(searchQuery ? [{ label: 'Search', value: searchQuery }] : []),
          ],
          metrics: [
            { label: 'Total Requests', value: regularizationStats.total },
            { label: 'Late Arrival Waivers', value: regularizationStats.lateCount },
            { label: 'Early Checkouts', value: regularizationStats.earlyCount },
            { label: 'Approved (Penalty Waived)', value: regularizationStats.approved, highlight: true },
            { label: 'Pending Review', value: regularizationStats.pending },
            { label: 'Rejected', value: regularizationStats.rejected },
          ],
          headers: [
            'Incident Date',
            'Employee ID',
            'Name',
            'Department',
            'Request Category',
            'Actual Time',
            'Reason Provided',
            'Status',
            'Approved By',
            'Submission Date',
          ],
          rows: regularizationReportData.map((r) => [
            r.date,
            r.employeeId,
            r.employeeName,
            r.department || '—',
            r.type === 'late_arrival' ? 'Late Arrival Waiver' : 'Early Departure',
            r.actualTime || '—',
            r.reason,
            r.status,
            r.reviewedBy || 'Pending',
            r.appliedOn ? new Date(r.appliedOn).toLocaleDateString() : '—',
          ]),
        };
      }

      default:
        return {
          title: 'WorkNest HR Report',
          subtitle: 'Standard Audit Document',
          period: selectedMonth,
          filters: [],
          metrics: [],
          headers: ['Item', 'Details'],
          rows: [['Report', 'Generated']],
        };
    }
  }, [
    activeModule,
    dateMode,
    selectedDate,
    selectedMonth,
    selectedDept,
    attStatusFilter,
    payrollStatusFilter,
    empStatusFilter,
    leaveStatusFilter,
    leaveTypeFilter,
    recStageFilter,
    shiftFilter,
    regTypeFilter,
    regStatusFilter,
    searchQuery,
    attendanceStats,
    attendanceReportData,
    payrollStats,
    payrollReportData,
    employeeReportData,
    leaveStats,
    leaveReportData,
    departmentReportData,
    shiftRosterReportData,
    recruitmentStats,
    recruitmentReportData,
    biometricReportData,
    regularizationStats,
    regularizationReportData,
    individualDossierData,
    departments.length,
    monthlyPayrollRuns,
  ]);

  // Robust multi-engine print launcher
  const handleTriggerPrint = async () => {
    setIsPrinting(true);
    showPrintNotice('Preparing high-resolution print document...', 'info');

    const html = generateReportHtml(currentReportConfig);

    // 1. Try iframe printing first (cleanest, prints only the report document)
    const iframeSuccess = await printViaIframe(html);
    setIsPrinting(false);

    if (iframeSuccess) {
      showPrintNotice('Print dialog dispatched successfully!', 'success');
      return;
    }

    // 2. If iframe failed (e.g. browser restricted sandbox), try native window.print()
    try {
      window.print();
      showPrintNotice('Print initiated via native browser dialog.', 'success');
    } catch (e) {
      console.warn('Native window.print was also blocked:', e);
      showPrintNotice('Print dialog blocked by browser iframe. Click "Download HTML" below to print or save as PDF.', 'warn');
    }
  };

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & EXPORT ACTIONS                                            */}
      {/* ========================================================================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs print:hidden">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="text-2xl">📊</span>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                HR Analytics &amp; Reports Center
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Comprehensive, audit-ready operational &amp; financial reports for all HR modules
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Print / Export PDF */}
          <button
            onClick={() => {
              setIsPrintModalOpen(true);
              handleTriggerPrint();
            }}
            disabled={isPrinting}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-md hover:shadow-lg disabled:opacity-60"
            title="Open Print Preview & Print Official Report"
          >
            <span>🖨️</span>
            <span>{isPrinting ? 'Preparing Print...' : 'Print Report / PDF'}</span>
          </button>

          {/* Module-Specific CSV Export Button */}
          {activeModule === 'attendance' && (
            <button
              onClick={() =>
                handleExportCSV(
                  `WorkNest_Attendance_Report`,
                  ['Date', 'Employee ID', 'Name', 'Department', 'Check-In', 'Check-Out', 'Status', 'Overtime (Hrs)', 'Work Hours'],
                  attendanceReportData.map((r) => [
                    r.date || '',
                    r.employeeId || '',
                    r.employeeName || '',
                    r.department || '',
                    r.checkIn || 'N/A',
                    r.checkOut || 'N/A',
                    r.status === 'weekend_off' ? 'Weekend / Off' : (r.status || 'present'),
                    r.overtimeHours || r.otHours || 0,
                    r.totalHours || r.workHours || 0,
                  ])
                )
              }
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
            >
              <span>📥</span>
              <span>Export CSV</span>
            </button>
          )}

          {activeModule === 'payroll' && (
            <button
              onClick={() =>
                handleExportCSV(
                  `WorkNest_Payroll_Report_${selectedMonth}`,
                  [
                    'Employee ID',
                    'Name',
                    'Department',
                    'Basic Salary',
                    'Gross Salary',
                    'PF Deduction',
                    'Tax Deduction',
                    'Late Deduction',
                    'Total Deductions',
                    'Net Salary',
                    'Payment Status',
                    'Bank Account',
                  ],
                  payrollReportData.map((r) => [
                    r.employeeId,
                    r.name,
                    r.department,
                    r.basic,
                    r.gross,
                    r.pf,
                    r.tax,
                    r.lateCut,
                    r.totalDeductions,
                    r.netSalary,
                    r.status,
                    r.accountNumber,
                  ])
                )
              }
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
            >
              <span>📥</span>
              <span>Export Payroll CSV</span>
            </button>
          )}

          {activeModule === 'employee' && (
            <button
              onClick={() =>
                handleExportCSV(
                  `WorkNest_Employee_Directory`,
                  ['Employee ID', 'Full Name', 'Department', 'Designation', 'Email', 'Phone', 'Shift', 'Status', 'Gross Salary'],
                  employeeReportData.map((e) => [
                    e.employeeId,
                    e.name,
                    e.department,
                    e.designation,
                    e.email || 'N/A',
                    e.phone || 'N/A',
                    e.shift || 'General Shift',
                    e.status || 'active',
                    e.grossSalary || 0,
                  ])
                )
              }
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
            >
              <span>📥</span>
              <span>Export Staff CSV</span>
            </button>
          )}

          {activeModule === 'leave' && (
            <button
              onClick={() =>
                handleExportCSV(
                  `WorkNest_Leave_Report`,
                  ['Employee ID', 'Name', 'Department', 'Category', 'From Date', 'To Date', 'Days', 'Status', 'Reason', 'Applied On'],
                  leaveReportData.map((l) => [
                    l.employeeId,
                    l.employeeName,
                    (employees.find((e) => e.employeeId === l.employeeId)?.department) || 'N/A',
                    l.type,
                    l.from,
                    l.to,
                    l.days,
                    l.status,
                    l.reason,
                    l.appliedOn || 'N/A',
                  ])
                )
              }
              className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
            >
              <span>📥</span>
              <span>Export Leave CSV</span>
            </button>
          )}

          {activeModule === 'department' && (
            <button
              onClick={() =>
                handleExportCSV(
                  `WorkNest_Department_Report`,
                  ['Department Name', 'Code', 'Head', 'Employee Count', 'Total Payroll (BDT)', 'Workforce Share %', 'Payroll Share %'],
                  departmentReportData.map((d) => [
                    d.name,
                    d.code || '',
                    d.head || '',
                    d.employeeCount,
                    d.deptPayroll,
                    `${d.headcountPct}%`,
                    `${d.payrollPct}%`,
                  ])
                )
              }
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
            >
              <span>📥</span>
              <span>Export Dept CSV</span>
            </button>
          )}

          {activeModule === 'shift_roster' && (
            <button
              onClick={() =>
                handleExportCSV(
                  `WorkNest_Shift_Roster_Report`,
                  ['Employee ID', 'Name', 'Department', 'Shift Name', 'Start Time', 'End Time', 'Grace Period (Mins)', 'Full Day (Hrs)'],
                  shiftRosterReportData.map((s) => [
                    s.employeeId,
                    s.name,
                    s.department,
                    s.shiftName,
                    s.startTime,
                    s.endTime,
                    s.gracePeriod,
                    s.fullDayHours,
                  ])
                )
              }
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
            >
              <span>📥</span>
              <span>Export Shift CSV</span>
            </button>
          )}

          {activeModule === 'recruitment' && (
            <button
              onClick={() =>
                handleExportCSV(
                  `WorkNest_Recruitment_Report`,
                  ['Candidate Name', 'Job Title', 'Department', 'Stage', 'Rating', 'Expected Salary', 'Experience', 'Applied Date'],
                  recruitmentReportData.map((c) => [
                    c.name,
                    c.jobTitle,
                    c.department || 'N/A',
                    c.stage,
                    c.rating || 0,
                    c.expectedSalary || 0,
                    c.experience || 'N/A',
                    c.appliedDate || 'N/A',
                  ])
                )
              }
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
            >
              <span>📥</span>
              <span>Export Hiring CSV</span>
            </button>
          )}

          {activeModule === 'biometric' && (
            <button
              onClick={() =>
                handleExportCSV(
                  `WorkNest_Biometric_Devices_Report`,
                  ['Device Name', 'Hardware Model', 'Serial Number', 'IP Address', 'Port', 'Connection Type', 'Status', 'Last Synced'],
                  biometricReportData.map((b) => [
                    b.name,
                    b.model,
                    b.serialNumber,
                    b.ipAddress || 'N/A',
                    b.port,
                    b.connectionType,
                    b.status,
                    b.syncedAt || b.lastSync || 'N/A',
                  ])
                )
              }
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
            >
              <span>📥</span>
              <span>Export Device CSV</span>
            </button>
          )}

          {activeModule === 'regularization' && (
            <button
              onClick={() =>
                handleExportCSV(
                  `WorkNest_Attendance_Regularization_Report`,
                  ['Incident Date', 'Employee ID', 'Name', 'Department', 'Request Type', 'Actual Time', 'Reason', 'Status', 'Reviewed By', 'Applied Date'],
                  regularizationReportData.map((r) => [
                    r.date,
                    r.employeeId,
                    r.employeeName,
                    r.department || 'N/A',
                    r.type === 'late_arrival' ? 'Late Arrival Waiver' : 'Early Checkout Permission',
                    r.actualTime || 'N/A',
                    r.reason,
                    r.status,
                    r.reviewedBy || 'Pending',
                    r.appliedOn || 'N/A',
                  ])
                )
              }
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs transition-all flex items-center space-x-2 cursor-pointer shadow-xs"
            >
              <span>📥</span>
              <span>Export Waiver CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Realtime Print Notification Banner */}
      {printNotice && (
        <div
          className={`px-4 py-3 rounded-2xl text-xs font-semibold flex items-center justify-between border shadow-xs animate-fade-in print:hidden ${
            printNotice.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : printNotice.type === 'warn'
              ? 'bg-amber-50 text-amber-900 border-amber-200'
              : 'bg-indigo-50 text-indigo-900 border-indigo-200'
          }`}
        >
          <div className="flex items-center space-x-2">
            <span>{printNotice.type === 'success' ? '✅' : printNotice.type === 'warn' ? '⚠️' : 'ℹ️'}</span>
            <span>{printNotice.text}</span>
          </div>
          <button
            onClick={() => setPrintNotice(null)}
            className="text-slate-400 hover:text-slate-700 cursor-pointer font-bold px-1.5 py-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. HORIZONTAL MODULE SELECTOR WITH BIDIRECTIONAL CONTROLS & WRAP TOGGLE   */}
      {/* ========================================================================= */}
      <div className="bg-white p-2 rounded-2xl border border-slate-200/90 shadow-xs print:hidden relative group">
        <div className="flex items-center gap-1.5">
          {/* Left Arrow Button (Visible on screens when scrollable or in scroll mode) */}
          {!isTabsWrapMode && (
            <button
              type="button"
              onClick={() => scrollTabs('left')}
              disabled={!canScrollLeft}
              aria-label="Scroll modules left"
              title="Scroll modules left (or use mouse wheel)"
              className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                canScrollLeft
                  ? 'bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 cursor-pointer shadow-2xs hover:scale-105 active:scale-95'
                  : 'bg-slate-50 text-slate-300 cursor-not-allowed opacity-40'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Scrollable / Wrappable Tabs Container */}
          <div className="relative flex-1 min-w-0">
            {/* Left subtle shadow gradient when scrollable left */}
            {!isTabsWrapMode && canScrollLeft && (
              <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white via-white/80 to-transparent pointer-events-none z-10" />
            )}

            <div
              ref={tabsScrollRef}
              onWheel={handleTabsWheel}
              className={`scroll-smooth ${
                isTabsWrapMode
                  ? 'flex flex-wrap gap-1.5 py-1'
                  : 'flex items-center space-x-1.5 overflow-x-auto thin-scroll py-1 px-1'
              }`}
            >
              {modulesList.map((m) => {
                const isActive = activeModule === m.id;
                return (
                  <button
                    key={m.id}
                    data-module-id={m.id}
                    onClick={() => setActiveModule(m.id)}
                    className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer whitespace-nowrap select-none ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-600/25 scale-[1.01]'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span>{m.icon}</span>
                    <span>{m.label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                        isActive ? 'bg-indigo-800/80 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {m.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Right subtle shadow gradient when scrollable right */}
            {!isTabsWrapMode && canScrollRight && (
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white via-white/80 to-transparent pointer-events-none z-10" />
            )}
          </div>

          {/* Right Arrow Button */}
          {!isTabsWrapMode && (
            <button
              type="button"
              onClick={() => scrollTabs('right')}
              disabled={!canScrollRight}
              aria-label="Scroll modules right"
              title="Scroll modules right (or use mouse wheel)"
              className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                canScrollRight
                  ? 'bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 cursor-pointer shadow-2xs hover:scale-105 active:scale-95'
                  : 'bg-slate-50 text-slate-300 cursor-not-allowed opacity-40'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* Divider */}
          <div className="h-5 w-px bg-slate-200 mx-0.5 shrink-0" />

          {/* Wrap / All 9 Modules Toggle Button */}
          <button
            type="button"
            onClick={() => setIsTabsWrapMode(!isTabsWrapMode)}
            aria-label={isTabsWrapMode ? 'Switch to horizontal scroll view' : 'Show all 9 modules'}
            title={isTabsWrapMode ? 'Switch to horizontal scroll view' : 'Show all 9 modules'}
            className={`shrink-0 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all flex items-center space-x-1.5 cursor-pointer border ${
              isTabsWrapMode
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-2xs'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
            }`}
          >
            <span>{isTabsWrapMode ? '⇄' : '⊞'}</span>
            <span className="hidden sm:inline">{isTabsWrapMode ? 'Scroll View' : 'All 9 Modules'}</span>
            <span className="sm:hidden">{isTabsWrapMode ? 'Scroll' : 'All 9'}</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. DYNAMIC REPORT FILTER BAR (Contextual per active module)                */}
      {/* ========================================================================= */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs print:hidden space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Attendance & Payroll Month or Day Mode */}
            {activeModule === 'attendance' && (
              <div className="flex items-center space-x-2 bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setDateMode('month')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                    dateMode === 'month' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Monthly View
                </button>
                <button
                  onClick={() => setDateMode('day')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                    dateMode === 'day' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Single Day
                </button>
              </div>
            )}

            {(activeModule === 'attendance' && dateMode === 'month') ||
            activeModule === 'payroll' ||
            activeModule === 'individual_dossier' ? (
              <div className="flex items-center space-x-1.5">
                <label className="text-xs font-bold text-slate-600">Month:</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => handleMonthChange(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                />
              </div>
            ) : null}

            {activeModule === 'attendance' && dateMode === 'day' && (
              <div className="flex items-center space-x-1.5">
                <label className="text-xs font-bold text-slate-600">Date:</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                />
              </div>
            )}

            {/* Department Filter (Applicable across most modules) */}
            {activeModule !== 'department' && activeModule !== 'biometric' && (
              <div className="flex items-center space-x-1.5">
                <label className="text-xs font-bold text-slate-600">Department:</label>
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="all">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Branch / Company Location Filter */}
            {activeModule !== 'biometric' && (
              <div className="flex items-center space-x-1.5">
                <label className="text-xs font-bold text-slate-600">Branch:</label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="all">All Branches ({currentCompany?.name || 'Company'})</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name} {b.isHeadOffice ? '(HQ)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Specific Employee Filter */}
            {activeModule !== 'individual_dossier' && activeModule !== 'department' && activeModule !== 'recruitment' && activeModule !== 'biometric' && (
              <div className="flex items-center space-x-1.5">
                <label className="text-xs font-bold text-slate-600">Employee:</label>
                <select
                  value={selectedEmployeeFilter}
                  onChange={(e) => setSelectedEmployeeFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer max-w-[180px]"
                >
                  <option value="all">All Employees ({baseAuthorizedEmployees.length})</option>
                  {baseAuthorizedEmployees.map((e) => (
                    <option key={e.id} value={e.employeeId || e.id}>
                      {e.name} ({e.employeeId})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Historical Period Comparison Toggle */}
            <button
              type="button"
              onClick={() => setShowHistoricalCompare(!showHistoricalCompare)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center space-x-1 ${
                showHistoricalCompare
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
              title="Toggle month-over-month historical comparison"
            >
              <span>📈</span>
              <span>Historical Compare</span>
            </button>

            {/* Attendance Status Filter */}
            {activeModule === 'attendance' && (
              <div className="flex items-center space-x-1.5">
                <label className="text-xs font-bold text-slate-600">Status:</label>
                <select
                  value={attStatusFilter}
                  onChange={(e) => setAttStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="present">Present Only</option>
                  <option value="late">Late Only</option>
                  <option value="absent">Absent Only</option>
                  <option value="half_day">Half Day</option>
                </select>
              </div>
            )}

            {/* Payroll Status Filter */}
            {activeModule === 'payroll' && (
              <div className="flex items-center space-x-1.5">
                <label className="text-xs font-bold text-slate-600">Payout Status:</label>
                <select
                  value={payrollStatusFilter}
                  onChange={(e) => setPayrollStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="all">All Employees</option>
                  <option value="paid">Paid &amp; Disbursed</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            )}

            {/* Employee Status Filter */}
            {activeModule === 'employee' && (
              <div className="flex items-center space-x-1.5">
                <label className="text-xs font-bold text-slate-600">Status:</label>
                <select
                  value={empStatusFilter}
                  onChange={(e) => setEmpStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active Staff</option>
                  <option value="on_leave">On Leave</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}

            {/* Leave Type & Status Filter */}
            {activeModule === 'leave' && (
              <>
                <div className="flex items-center space-x-1.5">
                  <label className="text-xs font-bold text-slate-600">Category:</label>
                  <select
                    value={leaveTypeFilter}
                    onChange={(e) => setLeaveTypeFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <option value="all">All Categories</option>
                    <option value="casual">Casual Leave</option>
                    <option value="sick">Sick Leave</option>
                    <option value="annual">Annual Leave</option>
                    <option value="unpaid">Unpaid Leave</option>
                  </select>
                </div>
                <div className="flex items-center space-x-1.5">
                  <label className="text-xs font-bold text-slate-600">Status:</label>
                  <select
                    value={leaveStatusFilter}
                    onChange={(e) => setLeaveStatusFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <option value="all">All Statuses</option>
                    <option value="approved">Approved</option>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </>
            )}

            {/* Recruitment Stage Filter */}
            {activeModule === 'recruitment' && (
              <div className="flex items-center space-x-1.5">
                <label className="text-xs font-bold text-slate-600">Pipeline Stage:</label>
                <select
                  value={recStageFilter}
                  onChange={(e) => setRecStageFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  <option value="all">All Candidates</option>
                  <option value="applied">Applied</option>
                  <option value="screening">Screening</option>
                  <option value="interview">Interview</option>
                  <option value="offer">Offer Extended</option>
                  <option value="hired">Hired</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            )}

            {/* Regularization Type & Status */}
            {activeModule === 'regularization' && (
              <>
                <div className="flex items-center space-x-1.5">
                  <label className="text-xs font-bold text-slate-600">Category:</label>
                  <select
                    value={regTypeFilter}
                    onChange={(e) => setRegTypeFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <option value="all">All Requests</option>
                    <option value="late_arrival">Late Arrival Waiver</option>
                    <option value="early_checkout">Early Checkout</option>
                  </select>
                </div>
                <div className="flex items-center space-x-1.5">
                  <label className="text-xs font-bold text-slate-600">Decision:</label>
                  <select
                    value={regStatusFilter}
                    onChange={(e) => setRegStatusFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <option value="all">All Statuses</option>
                    <option value="approved">Approved &amp; Waived</option>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 text-xs pointer-events-none">
              🔍
            </span>
            <input
              type="text"
              placeholder="Search records..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-2.5 flex items-center text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Historical Period Comparison Panel */}
        {showHistoricalCompare && (
          <div className="pt-3 border-t border-slate-100">
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center space-x-2">
                  <span className="text-sm">📊</span>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Historical Period Comparison — {selectedMonth} vs Prior Runs
                  </h4>
                </div>
                <span className="text-[11px] text-slate-500">
                  Scoped to {selectedBranch === 'all' ? 'All Branches' : 'Selected Branch'} • {selectedDept === 'all' ? 'All Departments' : selectedDept} • {employees.length} Staff
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Active Period Attendance</span>
                  <span className="text-base font-black text-emerald-700 mt-0.5 block">
                    {attendanceStats.present + attendanceStats.late} Present ({attendanceStats.presentRate}%)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Late: {attendanceStats.late} • OT: {attendanceStats.totalOvertime.toFixed(1)}h
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Active Period Net Payroll</span>
                  <span className="text-base font-black text-indigo-700 mt-0.5 block">
                    ৳{payrollReportData.reduce((s: number, r: any) => s + r.netSalary, 0).toLocaleString()}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    OT Pay: ৳{payrollReportData.reduce((s: number, r: any) => s + r.overtimePay, 0).toLocaleString()}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Saved Historical Payroll Runs</span>
                  <span className="text-base font-black text-slate-900 mt-0.5 block">
                    {Object.keys(monthlyPayrollRuns || {}).length} Archived Months
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {Object.values(monthlyPayrollRuns || {})
                      .slice(0, 2)
                      .map((r) => `${r.month}: ৳${(r.totalNetAmount || 0).toLocaleString()}`)
                      .join(' | ') || 'Current live computation'}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Leave &amp; Regularization Volume</span>
                  <span className="text-base font-black text-amber-700 mt-0.5 block">
                    {leaveRequests.filter((l) => l.from?.startsWith(selectedMonth)).length} Leaves / {attendanceRequests.filter((r) => r.date?.startsWith(selectedMonth)).length} Waivers
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Approved Leaves: {leaveRequests.filter((l) => l.from?.startsWith(selectedMonth) && l.status === 'approved').length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 4. PRINT CORPORATE HEADER (Visible only when printing)                     */}
      {/* ========================================================================= */}
      <div className="hidden print:block border-b-2 border-slate-900 pb-4 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">WorkNest HR</h1>
            <p className="text-xs text-slate-600 font-semibold uppercase tracking-wider">
              Corporate Intelligence &amp; Audit Report • {modulesList.find((m) => m.id === activeModule)?.label}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Generated: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>
            <p>Reporting Period: {selectedMonth}</p>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODULE 1: ATTENDANCE REPORT                                               */}
      {/* ========================================================================= */}
      {activeModule === 'attendance' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Logs
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {attendanceStats.total}
              </span>
              <span className="text-[11px] text-slate-500">Audit entries recorded</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                On-Time Present
              </span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">
                {attendanceStats.present}
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">
                {attendanceStats.presentRate}% Attendance rate
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
                Late Arrivals
              </span>
              <span className="text-2xl font-black text-amber-600 mt-1 block">
                {attendanceStats.late}
              </span>
              <span className="text-[11px] text-slate-500">Exceeding shift grace</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider block">
                Absentees
              </span>
              <span className="text-2xl font-black text-rose-600 mt-1 block">
                {attendanceStats.absent}
              </span>
              <span className="text-[11px] text-slate-500">Unexcused missing</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-indigo-200 shadow-xs bg-indigo-50/20">
              <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">
                Total Working Hours
              </span>
              <span className="text-2xl font-black text-indigo-700 mt-1 block font-mono">
                {attendanceStats.totalWorkHours.toFixed(1)} hrs
              </span>
              <span className="text-[11px] text-indigo-600 font-semibold font-mono">
                {Math.floor(attendanceStats.totalWorkMinutes / 60)}h {String(attendanceStats.totalWorkMinutes % 60).padStart(2, '0')}m logged
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider block">
                Total Overtime
              </span>
              <span className="text-2xl font-black text-purple-600 mt-1 block font-mono">
                {attendanceStats.totalOvertime.toFixed(1)} hrs
              </span>
              <span className="text-[11px] text-slate-500">Approved extra hours</span>
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>📅</span>
                  <span>Daily &amp; Monthly Attendance Audit Register</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real-time synchronization from cloud biometric terminals &amp; mobile attendance
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                Showing {attendanceReportData.length} records
              </span>
            </div>

            {isAttendanceLoading ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                <span className="inline-block w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-2"></span>
                <p>Loading attendance data from Firestore...</p>
              </div>
            ) : attendanceReportData.length === 0 ? (
              <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <span className="text-3xl block mb-2">📅</span>
                <p className="text-xs font-bold text-slate-700">No attendance records found</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Try adjusting the month, department, or status filters above.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                      <th className="pb-3">Date</th>
                      <th className="pb-3">Employee</th>
                      <th className="pb-3">Department</th>
                      <th className="pb-3">Check-In</th>
                      <th className="pb-3">Check-Out</th>
                      <th className="pb-3">Work Hours</th>
                      <th className="pb-3">Overtime</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3 text-right">Punch Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {attendanceReportData.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                          {rec.date}
                        </td>
                        <td className="py-3 whitespace-nowrap">
                          <div className="font-bold text-slate-900">{rec.employeeName}</div>
                          <span className="text-[10px] text-indigo-700 font-mono">
                            {rec.employeeId}
                          </span>
                        </td>
                        <td className="py-3 text-slate-600 whitespace-nowrap">{rec.department}</td>
                        <td className="py-3 font-mono text-slate-800 whitespace-nowrap">
                          {formatTo12Hour(rec.checkIn)}
                        </td>
                        <td className="py-3 font-mono text-slate-800 whitespace-nowrap">
                          {formatTo12Hour(rec.checkOut)}
                        </td>
                        <td className="py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                          {rec.totalHours && Number(rec.totalHours) > 0 ? (
                            <span className="bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 inline-flex items-center space-x-1">
                              <span>
                                {Math.floor((rec.durationMinutes || Math.round(Number(rec.totalHours) * 60)) / 60)}h{' '}
                                {String((rec.durationMinutes || Math.round(Number(rec.totalHours) * 60)) % 60).padStart(2, '0')}m
                              </span>
                              <span className="text-[10px] text-indigo-600">
                                ({Number(rec.totalHours).toFixed(1)}h)
                              </span>
                            </span>
                          ) : rec.checkIn && rec.checkIn !== '-' && (!rec.checkOut || rec.checkOut === '-') ? (
                            <span className="text-amber-600 font-semibold text-[11px] bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
                              In Progress
                            </span>
                          ) : (
                            <span className="text-slate-300 font-bold">—</span>
                          )}
                        </td>
                        <td className="py-3 font-mono text-indigo-700 font-bold whitespace-nowrap">
                          {rec.overtimeHours && Number(rec.overtimeHours) > 0 ? `+${Number(rec.overtimeHours).toFixed(1)}h` : '0h'}
                        </td>
                        <td className="py-3 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              rec.status === 'present'
                                ? 'bg-emerald-100 text-emerald-800'
                                : rec.status === 'late'
                                ? 'bg-amber-100 text-amber-800'
                                : rec.status === 'half_day'
                                ? 'bg-blue-100 text-blue-800'
                                : rec.status === 'weekend_off'
                                ? 'bg-slate-100 text-slate-700 border border-slate-300'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {rec.status === 'weekend_off' ? 'Weekend / Off' : (rec.status || 'present')}
                          </span>
                        </td>
                        <td className="py-3 text-right text-slate-400 text-[11px] whitespace-nowrap">
                          {rec.source || rec.method || 'Biometric terminal'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODULE 2: PAYROLL & SALARY REPORT                                         */}
      {/* ========================================================================= */}
      {activeModule === 'payroll' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Gross Payroll
              </span>
              <span className="text-xl sm:text-2xl font-black text-slate-900 mt-1 block">
                ৳ {payrollStats.totalGross.toLocaleString()}
              </span>
              <span className="text-[11px] text-slate-500">Gross monthly commitments</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Total Net Payout
              </span>
              <span className="text-xl sm:text-2xl font-black text-emerald-700 mt-1 block">
                ৳ {payrollStats.totalNet.toLocaleString()}
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">
                After statutory &amp; late cuts
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                PF Deductions
              </span>
              <span className="text-xl sm:text-2xl font-black text-slate-800 mt-1 block">
                ৳ {payrollStats.totalPF.toLocaleString()}
              </span>
              <span className="text-[11px] text-slate-400">Provident fund pool</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider block">
                Absent &amp; Late Cuts
              </span>
              <span className="text-xl sm:text-2xl font-black text-rose-600 mt-1 block">
                ৳ {(payrollStats.totalAbsentDeductions + payrollStats.totalLatePenalties).toLocaleString()}
              </span>
              <span className="text-[11px] text-rose-600 font-semibold">
                Gross ÷ 30 per day cut
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                Average Net Salary
              </span>
              <span className="text-xl sm:text-2xl font-black text-indigo-700 mt-1 block">
                ৳ {payrollStats.avgSalary.toLocaleString()}
              </span>
              <span className="text-[11px] text-slate-500">Per employee take-home</span>
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>💰</span>
                  <span>Monthly Payroll Register &amp; Compensation Audit ({selectedMonth})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Comprehensive wage audit covering base pay, allowances, statutory PF/Tax, and attendance deductions
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {payrollReportData.length} Employees in Register
              </span>
            </div>

            {payrollReportData.length === 0 ? (
              <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <span className="text-3xl block mb-2">💰</span>
                <p className="text-xs font-bold text-slate-700">No payroll entries found</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Ensure employees exist and match the selected department filters.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                      <th className="pb-3">Employee</th>
                      <th className="pb-3">Attendance</th>
                      <th className="pb-3 text-right">Basic</th>
                      <th className="pb-3 text-right">HRA &amp; Allow.</th>
                      <th className="pb-3 text-right">Gross Salary</th>
                      <th className="pb-3 text-right">Absent Cut</th>
                      <th className="pb-3 text-right">Late Penalty</th>
                      <th className="pb-3 text-right">PF &amp; Tax</th>
                      <th className="pb-3 text-right">Net Take-Home</th>
                      <th className="pb-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payrollReportData.map((rec) => (
                      <tr key={rec.employeeId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 whitespace-nowrap">
                          <div className="font-bold text-slate-900">{rec.name}</div>
                          <span className="text-[10px] text-indigo-700 font-mono">
                            {rec.employeeId} • {rec.department}
                          </span>
                        </td>
                        <td className="py-3 whitespace-nowrap font-mono text-[11px]">
                          <div>
                            <span className="text-emerald-700 font-bold">{rec.presentDays}d P</span>
                            {' / '}
                            <span className="text-rose-600 font-bold">{rec.absentDays}d A</span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {rec.totalMonthDays}d Month ({rec.workingDays}d Work)
                          </div>
                        </td>
                        <td className="py-3 text-right font-mono text-slate-700 whitespace-nowrap">
                          ৳ {rec.basic.toLocaleString()}
                        </td>
                        <td className="py-3 text-right font-mono text-slate-700 whitespace-nowrap">
                          ৳ {(rec.gross - rec.basic).toLocaleString()}
                        </td>
                        <td className="py-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                          ৳ {rec.gross.toLocaleString()}
                        </td>
                        <td className="py-3 text-right font-mono text-rose-600 font-bold whitespace-nowrap">
                          {(rec.absentDeduction || 0) > 0 ? `-৳ ${(rec.absentDeduction || 0).toLocaleString()}` : '৳ 0'}
                        </td>
                        <td className="py-3 text-right font-mono text-rose-600 font-bold whitespace-nowrap">
                          {rec.lateCut > 0 ? `-৳ ${rec.lateCut.toLocaleString()}` : '৳ 0'}
                        </td>
                        <td className="py-3 text-right font-mono text-slate-500 whitespace-nowrap">
                          ৳ {(rec.pf + rec.tax).toLocaleString()}
                        </td>
                        <td className="py-3 text-right font-mono font-black text-emerald-700 text-sm whitespace-nowrap">
                          ৳ {rec.netSalary.toLocaleString()}
                        </td>
                        <td className="py-3 text-center whitespace-nowrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              rec.status === 'paid'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {rec.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODULE 3: EMPLOYEE MASTER REPORT                                          */}
      {/* ========================================================================= */}
      {activeModule === 'employee' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Headcount
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {employees.length}
              </span>
              <span className="text-[11px] text-slate-500">Corporate personnel</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Active Staff
              </span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">
                {employees.filter((e) => (e.status || 'active') === 'active').length}
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">
                Available for duty
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
                On Leave
              </span>
              <span className="text-2xl font-black text-amber-600 mt-1 block">
                {employees.filter((e) => e.status === 'on_leave').length}
              </span>
              <span className="text-[11px] text-slate-500">Approved absence</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                Departments
              </span>
              <span className="text-2xl font-black text-indigo-600 mt-1 block">
                {departments.length}
              </span>
              <span className="text-[11px] text-slate-500">Active divisions</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>👥</span>
                  <span>Employee Master Directory &amp; Demographic Roster</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Complete official staff profiles, employment status, department allocations, and compensation
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {employeeReportData.length} Filtered Staff
              </span>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                    <th className="pb-3">Staff Code</th>
                    <th className="pb-3">Full Name</th>
                    <th className="pb-3">Designation</th>
                    <th className="pb-3">Department</th>
                    <th className="pb-3">Contact</th>
                    <th className="pb-3">Shift</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 text-right">Gross Salary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {employeeReportData.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 font-mono font-bold text-indigo-700 whitespace-nowrap">
                        {emp.employeeId}
                      </td>
                      <td className="py-3 whitespace-nowrap">
                        <div className="font-bold text-slate-900 flex items-center space-x-2">
                          {emp.avatar && (emp.avatar.startsWith('data:image/') || emp.avatar.startsWith('http://') || emp.avatar.startsWith('https://')) ? (
                            <img src={emp.avatar} alt={emp.name} className="w-6 h-6 rounded-lg object-cover shrink-0" />
                          ) : (
                            <span className="text-base">{emp.avatar || '👤'}</span>
                          )}
                          <span>{emp.name}</span>
                        </div>
                      </td>
                      <td className="py-3 text-slate-700 font-medium whitespace-nowrap">
                        {emp.designation}
                      </td>
                      <td className="py-3 text-slate-600 whitespace-nowrap">{emp.department}</td>
                      <td className="py-3 text-slate-500 whitespace-nowrap text-[11px]">
                        <div>{emp.email || 'N/A'}</div>
                        <div className="font-mono">{emp.phone || ''}</div>
                      </td>
                      <td className="py-3 text-slate-600 whitespace-nowrap">
                        {emp.shift || 'General Shift'}
                      </td>
                      <td className="py-3 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            (emp.status || 'active') === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : emp.status === 'on_leave'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {emp.status || 'active'}
                        </span>
                      </td>
                      <td className="py-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        ৳ {(Number(emp.grossSalary) || ((Number(emp.basicSalary ?? emp.basic) || 0) * 2) || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODULE 4: LEAVE MANAGEMENT REPORT                                         */}
      {/* ========================================================================= */}
      {activeModule === 'leave' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Requests
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {leaveStats.total}
              </span>
              <span className="text-[11px] text-slate-500">Applications submitted</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Approved
              </span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">
                {leaveStats.approved}
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">
                {leaveStats.totalDaysApproved} days sanctioned
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
                Pending Review
              </span>
              <span className="text-2xl font-black text-amber-600 mt-1 block">
                {leaveStats.pending}
              </span>
              <span className="text-[11px] text-slate-500">Awaiting HR decision</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider block">
                Rejected
              </span>
              <span className="text-2xl font-black text-rose-600 mt-1 block">
                {leaveStats.rejected}
              </span>
              <span className="text-[11px] text-slate-500">Declined requests</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                Approval Rate
              </span>
              <span className="text-2xl font-black text-indigo-600 mt-1 block">
                {leaveStats.approvalRate}%
              </span>
              <span className="text-[11px] text-slate-500">Sanction velocity</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>🏖️</span>
                  <span>Leave Utilization &amp; Absence Audit Log</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Casual, sick, annual, and unpaid leave audit records across all corporate departments
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {leaveReportData.length} Filtered Applications
              </span>
            </div>

            {leaveReportData.length === 0 ? (
              <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <span className="text-3xl block mb-2">🏖️</span>
                <p className="text-xs font-bold text-slate-700">No leave applications found</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  No leave requests match the selected filters.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                      <th className="pb-3">Employee</th>
                      <th className="pb-3">Category</th>
                      <th className="pb-3">Date Range</th>
                      <th className="pb-3 text-center">Days</th>
                      <th className="pb-3">Reason</th>
                      <th className="pb-3">Emergency Contact</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3 text-right">Applied On</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leaveReportData.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 whitespace-nowrap">
                          <div className="font-bold text-slate-900">{l.employeeName}</div>
                          <span className="text-[10px] text-indigo-700 font-mono">{l.employeeId}</span>
                        </td>
                        <td className="py-3 whitespace-nowrap">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            {l.type} Leave
                          </span>
                        </td>
                        <td className="py-3 text-slate-700 font-mono text-[11px] whitespace-nowrap">
                          {l.from} to {l.to}
                        </td>
                        <td className="py-3 text-center font-bold text-slate-900 font-mono whitespace-nowrap">
                          {l.days}
                        </td>
                        <td className="py-3 text-slate-600 max-w-xs truncate">{l.reason}</td>
                        <td className="py-3 font-mono text-slate-500 whitespace-nowrap">
                          {(employees.find((e) => e.employeeId === l.employeeId || e.id === l.employeeId)?.emergencyContact) ||
                           (employees.find((e) => e.employeeId === l.employeeId || e.id === l.employeeId)?.phone) ||
                           '—'}
                        </td>
                        <td className="py-3 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              l.status === 'approved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : l.status === 'rejected'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {l.status}
                          </span>
                        </td>
                        <td className="py-3 text-right text-slate-400 font-mono text-[11px] whitespace-nowrap">
                          {l.appliedOn || 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODULE 5: DEPARTMENT & COST ALLOCATION REPORT                             */}
      {/* ========================================================================= */}
      {activeModule === 'department' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Departments
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {departments.length}
              </span>
              <span className="text-[11px] text-slate-500">Corporate units</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Avg Staff / Dept
              </span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">
                {departments.length > 0 ? (employees.length / departments.length).toFixed(1) : 0}
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">
                Staff distribution
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                Monthly Wage Pool
              </span>
              <span className="text-xl sm:text-2xl font-black text-indigo-700 mt-1 block">
                ৳ {payrollStats.totalGross.toLocaleString()}
              </span>
              <span className="text-[11px] text-slate-500">Total company payroll</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Active Staffing
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {employees.length}
              </span>
              <span className="text-[11px] text-slate-500">Employees deployed</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>🏢</span>
                  <span>Departmental Cost Center &amp; Workforce Share Audit</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cost allocation, leadership supervision, and headcounts across functional business units
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {departmentReportData.length} Departments Audited
              </span>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                    <th className="pb-3">Department</th>
                    <th className="pb-3">Code</th>
                    <th className="pb-3">Department Head</th>
                    <th className="pb-3 text-center">Headcount</th>
                    <th className="pb-3 text-right">Monthly Payroll Cost</th>
                    <th className="pb-3 text-center">Staff Share</th>
                    <th className="pb-3 text-center">Budget Share</th>
                    <th className="pb-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {departmentReportData.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 font-bold text-slate-900 whitespace-nowrap">{d.name}</td>
                      <td className="py-3 font-mono text-indigo-700 font-bold whitespace-nowrap">
                        {d.code}
                      </td>
                      <td className="py-3 text-slate-700 whitespace-nowrap">{d.head || 'Unassigned'}</td>
                      <td className="py-3 text-center font-bold text-slate-900 font-mono whitespace-nowrap">
                        {d.employeeCount}
                      </td>
                      <td className="py-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                        ৳ {d.deptPayroll.toLocaleString()}
                      </td>
                      <td className="py-3 text-center whitespace-nowrap">
                        <div className="inline-flex items-center space-x-1.5">
                          <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-indigo-600 h-2 rounded-full"
                              style={{ width: `${d.headcountPct}%` }}
                            ></div>
                          </div>
                          <span className="font-mono text-slate-600">{d.headcountPct}%</span>
                        </div>
                      </td>
                      <td className="py-3 text-center whitespace-nowrap">
                        <div className="inline-flex items-center space-x-1.5">
                          <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-emerald-600 h-2 rounded-full"
                              style={{ width: `${d.payrollPct}%` }}
                            ></div>
                          </div>
                          <span className="font-mono text-slate-600">{d.payrollPct}%</span>
                        </div>
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold uppercase">
                          {d.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODULE 6: SHIFT COVERAGE & ROSTER REPORT                                  */}
      {/* ========================================================================= */}
      {activeModule === 'shift_roster' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Configured Shifts
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {shifts.length}
              </span>
              <span className="text-[11px] text-slate-500">Operational slots</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Roster Allocations
              </span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">
                {roster.length}
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">Scheduled shifts</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                Standard Grace
              </span>
              <span className="text-2xl font-black text-indigo-600 mt-1 block">15 min</span>
              <span className="text-[11px] text-slate-500">Late threshold</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Full-Day Standard
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">8.0 hrs</span>
              <span className="text-[11px] text-slate-500">Required work quota</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>⏱️</span>
                  <span>Shift Scheduling &amp; Duty Allocation Audit</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Shift assignments, start and end windows, grace period policies, and mandatory hours
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {shiftRosterReportData.length} Assigned Staff
              </span>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                    <th className="pb-3">Employee</th>
                    <th className="pb-3">Department</th>
                    <th className="pb-3">Designation</th>
                    <th className="pb-3">Assigned Shift</th>
                    <th className="pb-3">Shift Hours</th>
                    <th className="pb-3 text-center">Grace Period</th>
                    <th className="pb-3 text-center">Full Day Quota</th>
                    <th className="pb-3 text-right">Half Day Threshold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shiftRosterReportData.map((s) => (
                    <tr key={s.employeeId} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{s.name}</div>
                        <span className="text-[10px] text-indigo-700 font-mono">{s.employeeId}</span>
                      </td>
                      <td className="py-3 text-slate-600 whitespace-nowrap">{s.department}</td>
                      <td className="py-3 text-slate-700 whitespace-nowrap">{s.designation}</td>
                      <td className="py-3 whitespace-nowrap">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {s.shiftName}
                        </span>
                      </td>
                      <td className="py-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                        {s.startTime} - {s.endTime}
                      </td>
                      <td className="py-3 text-center font-mono text-slate-700 whitespace-nowrap">
                        {s.gracePeriod} mins
                      </td>
                      <td className="py-3 text-center font-mono font-bold text-slate-800 whitespace-nowrap">
                        {s.fullDayHours} hrs
                      </td>
                      <td className="py-3 text-right font-mono text-slate-600 whitespace-nowrap">
                        {s.halfDayHours} hrs
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODULE 7: RECRUITMENT & HIRING PIPELINE REPORT                            */}
      {/* ========================================================================= */}
      {activeModule === 'recruitment' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Candidates
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {recruitmentStats.totalCandidates}
              </span>
              <span className="text-[11px] text-slate-500">Pipeline applicants</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Hired Staff
              </span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">
                {recruitmentStats.hired}
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">
                {recruitmentStats.hireRate}% Conversion
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                In Interview
              </span>
              <span className="text-2xl font-black text-indigo-600 mt-1 block">
                {recruitmentStats.inInterview}
              </span>
              <span className="text-[11px] text-slate-500">Technical / HR rounds</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
                Offers Extended
              </span>
              <span className="text-2xl font-black text-amber-600 mt-1 block">
                {recruitmentStats.offers}
              </span>
              <span className="text-[11px] text-slate-500">Pending candidate reply</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider block">
                Job Openings
              </span>
              <span className="text-2xl font-black text-purple-600 mt-1 block">
                {recruitmentStats.openJobs}
              </span>
              <span className="text-[11px] text-slate-500">
                {recruitmentStats.totalVacancies} Vacancies
              </span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>🎯</span>
                  <span>Talent Acquisition Funnel &amp; Applicant Status Report</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Recruitment candidate funnel tracking from application to interview, offer, and hire
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {recruitmentReportData.length} Candidates Logged
              </span>
            </div>

            {recruitmentReportData.length === 0 ? (
              <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <span className="text-3xl block mb-2">🎯</span>
                <p className="text-xs font-bold text-slate-700">No candidate records found</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Try adjusting the stage or department filters above.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                      <th className="pb-3">Candidate</th>
                      <th className="pb-3">Job Applied For</th>
                      <th className="pb-3">Department</th>
                      <th className="pb-3">Pipeline Stage</th>
                      <th className="pb-3 text-center">Interview Rating</th>
                      <th className="pb-3 text-right">Expected Salary</th>
                      <th className="pb-3">Experience</th>
                      <th className="pb-3 text-right">Applied Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recruitmentReportData.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 whitespace-nowrap">
                          <div className="font-bold text-slate-900">{c.name}</div>
                          <span className="text-[10px] text-slate-400 font-mono">{c.phone}</span>
                        </td>
                        <td className="py-3 font-semibold text-slate-800 whitespace-nowrap">
                          {c.jobTitle}
                        </td>
                        <td className="py-3 text-slate-600 whitespace-nowrap">
                          {c.department || 'General'}
                        </td>
                        <td className="py-3 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              c.stage === 'hired'
                                ? 'bg-emerald-100 text-emerald-800'
                                : c.stage === 'offer'
                                ? 'bg-purple-100 text-purple-800'
                                : c.stage === 'interview'
                                ? 'bg-blue-100 text-blue-800'
                                : c.stage === 'screening'
                                ? 'bg-amber-100 text-amber-800'
                                : c.stage === 'rejected'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {c.stage}
                          </span>
                        </td>
                        <td className="py-3 text-center font-bold text-amber-500 whitespace-nowrap">
                          {c.rating ? '★'.repeat(c.rating) + '☆'.repeat(5 - c.rating) : '—'}
                        </td>
                        <td className="py-3 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                          {c.expectedSalary ? `৳ ${c.expectedSalary.toLocaleString()}` : '—'}
                        </td>
                        <td className="py-3 text-slate-600 whitespace-nowrap">
                          {c.experience || 'Fresher'}
                        </td>
                        <td className="py-3 text-right font-mono text-slate-400 text-[11px] whitespace-nowrap">
                          {c.appliedDate || 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODULE 8: BIOMETRIC HARDWARE & CLOUD SYNC REPORT                          */}
      {/* ========================================================================= */}
      {activeModule === 'biometric' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Devices
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {devices.length}
              </span>
              <span className="text-[11px] text-slate-500">Hardware terminals</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Connected / Online
              </span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">
                {devices.filter((d) => d.status === 'connected' || d.status === 'online').length}
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">Active &amp; streaming</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                Cloud ADMS Devices
              </span>
              <span className="text-2xl font-black text-indigo-600 mt-1 block">
                {devices.filter((d) => d.connectionType === 'adms').length}
              </span>
              <span className="text-[11px] text-slate-500">Real-time HTTP push</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
                Direct TCP Sockets
              </span>
              <span className="text-2xl font-black text-amber-600 mt-1 block">
                {devices.filter((d) => d.connectionType === 'tcp').length}
              </span>
              <span className="text-[11px] text-slate-500">Port 4370 listeners</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>📟</span>
                  <span>Biometric Hardware Terminals &amp; Synchronization Audit</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Audit logs of physical fingerprint/facial recognition terminals, serial numbers, IP ports, and health status
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {biometricReportData.length} Terminals Registered
              </span>
            </div>

            {biometricReportData.length === 0 ? (
              <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <span className="text-3xl block mb-2">📟</span>
                <p className="text-xs font-bold text-slate-700">No biometric terminals found</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Add devices in the Biometric Integration module to view hardware audits here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                      <th className="pb-3">Terminal Name</th>
                      <th className="pb-3">Hardware Model</th>
                      <th className="pb-3">Serial Number</th>
                      <th className="pb-3">IP Address : Port</th>
                      <th className="pb-3 text-center">Protocol</th>
                      <th className="pb-3 text-center">Status</th>
                      <th className="pb-3 text-right">Last Sync Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {biometricReportData.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 font-bold text-slate-900 whitespace-nowrap">{d.name}</td>
                        <td className="py-3 text-slate-700 font-medium whitespace-nowrap">{d.model}</td>
                        <td className="py-3 font-mono font-bold text-indigo-700 whitespace-nowrap">
                          {d.serialNumber}
                        </td>
                        <td className="py-3 font-mono text-slate-600 whitespace-nowrap">
                          {d.ipAddress || 'Dynamic'} : {d.port}
                        </td>
                        <td className="py-3 text-center whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-slate-100 text-slate-700 uppercase">
                            {d.connectionType}
                          </span>
                        </td>
                        <td className="py-3 text-center whitespace-nowrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              d.status === 'connected' || d.status === 'online'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {d.status}
                          </span>
                        </td>
                        <td className="py-3 text-right font-mono text-slate-400 text-[11px] whitespace-nowrap">
                          {d.syncedAt || d.lastSync || d.connectedAt || 'Never synced'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODULE 9: ATTENDANCE REGULARIZATION & LATE WAIVER REPORT                  */}
      {/* ========================================================================= */}
      {activeModule === 'regularization' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Requests
              </span>
              <span className="text-2xl font-black text-slate-900 mt-1 block">
                {regularizationStats.total}
              </span>
              <span className="text-[11px] text-slate-500">Regularization filings</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                Approved Waivers
              </span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">
                {regularizationStats.approved}
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">
                Penalty deduction waived
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
                Pending Decisions
              </span>
              <span className="text-2xl font-black text-amber-600 mt-1 block">
                {regularizationStats.pending}
              </span>
              <span className="text-[11px] text-slate-500">Awaiting HR evaluation</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider block">
                Rejected
              </span>
              <span className="text-2xl font-black text-rose-600 mt-1 block">
                {regularizationStats.rejected}
              </span>
              <span className="text-[11px] text-slate-500">Penalties retained</span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                Late Waivers Active
              </span>
              <span className="text-2xl font-black text-indigo-600 mt-1 block">
                {regularizationStats.lateApproved}
              </span>
              <span className="text-[11px] text-indigo-700 font-semibold">
                3-Day rule exempted
              </span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>📝</span>
                  <span>Attendance Regularization &amp; Late Salary Waiver Log</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Detailed justifications, check-in timestamps, and administrative approvals that waive 3-day late attendance deductions
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {regularizationReportData.length} Filings Audited
              </span>
            </div>

            {regularizationReportData.length === 0 ? (
              <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <span className="text-3xl block mb-2">📝</span>
                <p className="text-xs font-bold text-slate-700">No regularization records found</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  When employees submit late arrival waivers or early checkout permissions, they appear here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider font-bold">
                      <th className="pb-3">Date</th>
                      <th className="pb-3">Employee</th>
                      <th className="pb-3">Department</th>
                      <th className="pb-3">Request Type</th>
                      <th className="pb-3">Recorded Time</th>
                      <th className="pb-3">Provided Reason</th>
                      <th className="pb-3">Approval Status &amp; Impact</th>
                      <th className="pb-3 text-right">Filing Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {regularizationReportData.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                          {r.date}
                        </td>
                        <td className="py-3 whitespace-nowrap">
                          <div className="font-bold text-slate-900">{r.employeeName}</div>
                          <span className="text-[10px] text-indigo-700 font-mono">{r.employeeId}</span>
                        </td>
                        <td className="py-3 text-slate-600 whitespace-nowrap">{r.department || 'General'}</td>
                        <td className="py-3 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              r.type === 'late_arrival'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            {r.type === 'late_arrival' ? 'Late Arrival Waiver' : 'Early Checkout'}
                          </span>
                        </td>
                        <td className="py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                          {r.actualTime || 'N/A'}
                        </td>
                        <td className="py-3 text-slate-600 max-w-xs break-words">{r.reason}</td>
                        <td className="py-3 whitespace-nowrap">
                          {r.status === 'approved' ? (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-[10px] font-bold">
                              <span>✅ Approved</span>
                              {r.type === 'late_arrival' && (
                                <span className="text-emerald-700 font-semibold">• 3-Day Cut Waived</span>
                              )}
                            </span>
                          ) : r.status === 'rejected' ? (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-rose-100 text-rose-800 rounded-lg text-[10px] font-bold">
                              <span>❌ Rejected</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-lg text-[10px] font-bold">
                              <span>⏳ Pending Review</span>
                            </span>
                          )}
                          {r.reviewedBy && (
                            <p className="text-[10px] text-slate-400 mt-0.5">by {r.reviewedBy}</p>
                          )}
                        </td>
                        <td className="py-3 text-right font-mono text-slate-400 text-[11px] whitespace-nowrap">
                          {r.appliedOn ? new Date(r.appliedOn).toLocaleDateString() : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODULE 10: INDIVIDUAL EMPLOYEE 360° MASTER DOSSIER & STATEMENT            */}
      {/* ========================================================================= */}
      {activeModule === 'individual_dossier' && (
        <div className="space-y-6 animate-fade-in">
          {/* Employee Selector, Date Filtering & Action Control Bar */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              {/* 1. Individual Employee Selector */}
              <div className="flex-1 min-w-[240px]">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                  Select Individual Employee for Master Dossier
                </label>
                <div className="relative">
                  <select
                    value={dossierEmployee?.employeeId || dossierEmployee?.id || selectedDossierEmpId}
                    onChange={(e) => setSelectedDossierEmpId(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    {(filteredDossierEmployees.length > 0 ? filteredDossierEmployees : employees).map((emp) => (
                      <option key={emp.id} value={emp.employeeId || emp.id}>
                        {emp.name} — ID: {emp.employeeId} ({emp.designation || 'Staff'} • {emp.department || 'Operations'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 2. Comprehensive Date Filtering (Month / Date Range / Single Date) */}
              <div className="flex flex-wrap items-end gap-2.5 bg-slate-50/90 p-2.5 rounded-2xl border border-slate-200/90">
                {/* Filter Mode Selector */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    Date Filter Mode
                  </label>
                  <div className="flex items-center bg-white p-0.5 rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        setDossierDateFilterType('month');
                        const b = getMonthBounds(selectedMonth);
                        setDossierStartDate(b.start);
                        setDossierEndDate(b.end);
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        dossierDateFilterType === 'month'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Month
                    </button>
                    <button
                      type="button"
                      onClick={() => setDossierDateFilterType('range')}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        dossierDateFilterType === 'range'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Date Range
                    </button>
                    <button
                      type="button"
                      onClick={() => setDossierDateFilterType('day')}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        dossierDateFilterType === 'day'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Single Date
                    </button>
                  </div>
                </div>

                {/* Month Input */}
                {dossierDateFilterType === 'month' && (
                  <div>
                    <label className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block mb-1">
                      Select Month
                    </label>
                    <input
                      type="month"
                      value={selectedMonth}
                      onChange={(e) => handleMonthChange(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    />
                  </div>
                )}

                {/* From Date & To Date Inputs */}
                {dossierDateFilterType === 'range' && (
                  <>
                    <div>
                      <label className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block mb-1">
                        From Date
                      </label>
                      <input
                        type="date"
                        value={dossierStartDate}
                        onChange={(e) => {
                          setDossierStartDate(e.target.value);
                          if (e.target.value && e.target.value.slice(0, 7) !== selectedMonth) {
                            setSelectedMonth(e.target.value.slice(0, 7));
                          }
                        }}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block mb-1">
                        To Date
                      </label>
                      <input
                        type="date"
                        value={dossierEndDate}
                        onChange={(e) => setDossierEndDate(e.target.value)}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>
                  </>
                )}

                {/* Single Date Input */}
                {dossierDateFilterType === 'day' && (
                  <div>
                    <label className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block mb-1">
                      Select Date
                    </label>
                    <input
                      type="date"
                      value={dossierSingleDate}
                      onChange={(e) => {
                        setDossierSingleDate(e.target.value);
                        if (e.target.value) {
                          setSelectedMonth(e.target.value.slice(0, 7));
                        }
                      }}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    />
                  </div>
                )}

                {/* Quick Presets */}
                <div className="flex items-center gap-1 pb-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      const today = new Date().toISOString().split('T')[0];
                      setDossierDateFilterType('day');
                      setDossierSingleDate(today);
                      setSelectedMonth(today.slice(0, 7));
                    }}
                    className="px-2.5 py-1.5 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-xl text-[11px] font-bold transition-all cursor-pointer"
                    title="Filter for Today only"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const today = new Date();
                      const end = today.toISOString().split('T')[0];
                      const startObj = new Date(today);
                      startObj.setDate(today.getDate() - 6);
                      const start = startObj.toISOString().split('T')[0];
                      setDossierDateFilterType('range');
                      setDossierStartDate(start);
                      setDossierEndDate(end);
                    }}
                    className="px-2.5 py-1.5 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-xl text-[11px] font-bold transition-all cursor-pointer"
                    title="Filter Last 7 Days"
                  >
                    Last 7D
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDossierDateFilterType('month');
                      const b = getMonthBounds(selectedMonth);
                      setDossierStartDate(b.start);
                      setDossierEndDate(b.end);
                    }}
                    className="px-2.5 py-1.5 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-xl text-[11px] font-bold transition-all cursor-pointer"
                    title="Reset to Full Month"
                  >
                    Full Month
                  </button>
                </div>
              </div>

              {/* 3. Print & CSV Export Actions */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(true)}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/25 transition-all flex items-center space-x-2 cursor-pointer"
                >
                  <span>🖨️</span>
                  <span>Print Master Dossier</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!individualDossierData) return;
                    const headers = ['Date', 'Day', 'Shift', 'Check-In', 'Check-Out', 'Work Duration', 'Overtime', 'Status', 'Remarks'];
                    const rows = individualDossierData.filteredDailyRecords.map((r: any) => [
                      r.date,
                      r.dayName,
                      r.shift,
                      r.checkIn,
                      r.checkOut,
                      r.workedHours,
                      r.otDisplay || '—',
                      r.status,
                      r.leaveReason || (r.lateMinutes > 0 ? `Late +${r.lateMinutes}m` : ''),
                    ]);
                    handleExportCSV(`dossier_${individualDossierData.employee.employeeId}_${individualDossierData.startStr}_to_${individualDossierData.endStr}.csv`, headers, rows);
                  }}
                  className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  <span>📊</span>
                  <span>Export CSV</span>
                </button>
              </div>
            </div>
          </div>

          {!individualDossierData ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-slate-200">
              <span className="text-4xl block mb-2">👤</span>
              <h3 className="text-base font-bold text-slate-800">No Employee Selected</h3>
              <p className="text-xs text-slate-500 mt-1">Please select an employee above to load their comprehensive report.</p>
            </div>
          ) : (
            <>
              {/* 1. Master Identity Profile Card */}
              <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div className="flex items-start sm:items-center space-x-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-2xl font-black shadow-md shrink-0 overflow-hidden">
                      {individualDossierData.employee.avatar && (individualDossierData.employee.avatar.startsWith('data:image/') || individualDossierData.employee.avatar.startsWith('http://') || individualDossierData.employee.avatar.startsWith('https://')) ? (
                        <img src={individualDossierData.employee.avatar} alt={individualDossierData.employee.name} className="w-full h-full object-cover" />
                      ) : (
                        individualDossierData.employee.avatar || '👨‍💼'
                      )}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">
                          {individualDossierData.employee.name}
                        </h2>
                        <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 text-xs font-mono font-bold rounded-lg">
                          ID: {individualDossierData.employee.employeeId}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          individualDossierData.employee.status === 'active' || !individualDossierData.employee.status
                            ? 'bg-emerald-100 text-emerald-800'
                            : individualDossierData.employee.status === 'on_leave'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {individualDossierData.employee.status || 'Active'}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-600 mt-1">
                        {individualDossierData.employee.designation || 'Staff'} • <strong className="text-slate-800">{individualDossierData.employee.department || 'Operations'}</strong>
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Assigned Shift: <strong className="text-indigo-700">{individualDossierData.employee.shift || 'General Shift'}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="text-left sm:text-right text-xs text-slate-500 font-mono space-y-1">
                    <p>Report Period: <strong className="text-indigo-700 font-sans font-bold">{individualDossierData.periodLabel}</strong></p>
                    <p>Joining Date: <strong className="text-slate-800 font-sans">{individualDossierData.employee.joinDate || 'N/A'}</strong></p>
                    <p>RFID / Punch Card: <strong className="text-indigo-700">{individualDossierData.employee.rfidCard || `PIN-${individualDossierData.employee.employeeId}`}</strong></p>
                  </div>
                </div>

                {/* Contact & Banking Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Work Phone</span>
                    <span className="font-semibold text-slate-800 mt-0.5 block">{individualDossierData.employee.phone || 'N/A'}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Corporate Email</span>
                    <span className="font-semibold text-slate-800 mt-0.5 block truncate">{individualDossierData.employee.email || 'N/A'}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Disbursement Bank</span>
                    <span className="font-semibold text-slate-800 mt-0.5 block">{individualDossierData.payroll.bankName}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Account Number</span>
                    <span className="font-mono font-bold text-indigo-700 mt-0.5 block">{individualDossierData.payroll.accountNumber}</span>
                  </div>
                </div>
              </div>

              {/* 2. Monthly Executive Presence KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    {dossierDateFilterType === 'month' ? 'Month Days' : 'Period Days'}
                  </span>
                  <span className="text-xl font-black text-slate-900 mt-1 block font-mono">{individualDossierData.daysInMonth}</span>
                  <span className="text-[10px] text-slate-500">
                    {dossierDateFilterType === 'month' ? 'Calendar days' : 'Filtered days'}
                  </span>
                </div>

                <div className="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-2xs bg-emerald-50/20">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Present Days</span>
                  <span className="text-xl font-black text-emerald-600 mt-1 block font-mono">{individualDossierData.stats.presentCount}</span>
                  <span className="text-[10px] text-emerald-700 font-semibold">Attended</span>
                </div>

                <div className="bg-white p-3.5 rounded-2xl border border-amber-200 shadow-2xs bg-amber-50/20">
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Late Arrivals</span>
                  <span className="text-xl font-black text-amber-600 mt-1 block font-mono">{individualDossierData.stats.lateCount}</span>
                  <span className="text-[10px] text-amber-700">
                    {individualDossierData.stats.unexcusedLateCount >= 3 ? '⚠️ Cut triggered' : 'Within limit'}
                  </span>
                </div>

                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Early Out</span>
                  <span className="text-xl font-black text-blue-600 mt-1 block font-mono">{individualDossierData.stats.earlyOutCount}</span>
                  <span className="text-[10px] text-slate-500">Departures</span>
                </div>

                <div className="bg-white p-3.5 rounded-2xl border border-rose-200 shadow-2xs bg-rose-50/20">
                  <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">Absent Days</span>
                  <span className="text-xl font-black text-rose-600 mt-1 block font-mono">{individualDossierData.stats.absentCount}</span>
                  <span className="text-[10px] text-rose-700 font-semibold">Unexcused</span>
                </div>

                <div className="bg-white p-3.5 rounded-2xl border border-purple-200 shadow-2xs bg-purple-50/20">
                  <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider block">Leaves Taken</span>
                  <span className="text-xl font-black text-purple-600 mt-1 block font-mono">{individualDossierData.stats.leaveCount}</span>
                  <span className="text-[10px] text-purple-700">Approved</span>
                </div>

                <div className="bg-white p-3.5 rounded-2xl border border-indigo-200 shadow-2xs bg-indigo-50/20">
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">Total Work Hrs</span>
                  <span className="text-xl font-black text-indigo-700 mt-1 block font-mono">{individualDossierData.stats.totalHours}h</span>
                  <span className="text-[10px] text-indigo-600 font-semibold font-mono">
                    {individualDossierData.stats.totalWorkedFormatted} • Avg {individualDossierData.stats.avgDailyHours}h/d
                  </span>
                </div>

                <div className="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Overtime</span>
                  <span className="text-xl font-black text-emerald-700 mt-1 block font-mono">{individualDossierData.stats.totalOtHours}h</span>
                  <span className="text-[10px] text-emerald-700 font-semibold">Extra OT</span>
                </div>
              </div>

              {/* 3. Monthly Payslip & Compensation Statement */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-2xl">💰</span>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Monthly Payslip &amp; Compensation Statement
                      </h3>
                      <p className="text-xs text-slate-500">
                        Detailed earnings, attendance penalties, and net disbursement for {selectedMonth}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                      individualDossierData.payroll.paymentStatus === 'paid'
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-amber-100 text-amber-800 border border-amber-300'
                    }`}>
                      {individualDossierData.payroll.paymentStatus === 'paid' ? '✓ Salary Disbursed' : '⏳ Pending Approval'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Earnings Column */}
                  <div className="space-y-3 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between border-b border-slate-200 pb-2">
                      <span>Earnings &amp; Allowances</span>
                      <span className="text-emerald-700 font-mono font-black">Gross: ৳{individualDossierData.payroll.gross.toLocaleString()}</span>
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between text-slate-600">
                        <span>Basic Salary (50%)</span>
                        <strong className="font-mono text-slate-900">৳{individualDossierData.payroll.basic.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>House Rent Allowance (30%)</span>
                        <strong className="font-mono text-slate-900">৳{individualDossierData.payroll.houseRent.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Medical Allowance (10%)</span>
                        <strong className="font-mono text-slate-900">৳{individualDossierData.payroll.medical.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Conveyance Allowance</span>
                        <strong className="font-mono text-slate-900">৳{individualDossierData.payroll.conveyance.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Food / Transport Subsidy</span>
                        <strong className="font-mono text-slate-900">৳{individualDossierData.payroll.food.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-emerald-700 font-semibold">
                        <span>
                          Weekend Earning &amp; Allowances ({individualDossierData.payroll.weekendDays}d Present)
                        </span>
                        <strong className="font-mono text-emerald-700">+৳{individualDossierData.payroll.weekendAllowance.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-purple-700 font-semibold">
                        <span>
                          Overtime Pay (1.5x Basic • {individualDossierData.payroll.otHours}h @ ৳{individualDossierData.payroll.otRate})
                        </span>
                        <strong className="font-mono text-purple-700">+৳{individualDossierData.payroll.overtimeAmount.toLocaleString()}</strong>
                      </div>
                      {(individualDossierData.payroll.attendanceBonus > 0 || individualDossierData.payroll.festivalBonus > 0) && (
                        <div className="flex justify-between text-slate-600">
                          <span>Attendance &amp; Festival Bonus</span>
                          <strong className="font-mono text-slate-900">
                            +৳{(individualDossierData.payroll.attendanceBonus + individualDossierData.payroll.festivalBonus).toLocaleString()}
                          </strong>
                        </div>
                      )}
                      {(individualDossierData.payroll.otherAllowance > 0 || Boolean(individualDossierData.payroll.customEarningName)) && (
                        <div className="flex justify-between text-indigo-700 font-semibold">
                          <span>{individualDossierData.payroll.customEarningName || 'Other Allowance / Earning'}</span>
                          <strong className="font-mono text-indigo-700">+৳{individualDossierData.payroll.otherAllowance.toLocaleString()}</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Deductions Column */}
                  <div className="space-y-3 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between border-b border-slate-200 pb-2">
                      <span>Deductions &amp; Penalties</span>
                      <span className="text-rose-700 font-mono font-black">Total: -৳{individualDossierData.payroll.totalDeductions.toLocaleString()}</span>
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between text-slate-600">
                        <span>Unexcused Absences ({individualDossierData.stats.absentCount} days)</span>
                        <strong className="font-mono text-rose-600">-৳{individualDossierData.payroll.absentDeduction.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Late Arrival Penalties ({Math.floor(individualDossierData.stats.unexcusedLateCount / 3)} cut days)</span>
                        <strong className="font-mono text-amber-700">-৳{individualDossierData.payroll.latePenaltyDeduction.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Provident Fund (PF) Employee</span>
                        <strong className="font-mono text-slate-900">-৳{individualDossierData.payroll.pf.toLocaleString()}</strong>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Income Tax Deduction</span>
                        <strong className="font-mono text-slate-900">-৳{individualDossierData.payroll.tax.toLocaleString()}</strong>
                      </div>
                      {(individualDossierData.payroll.advanceDeduction > 0 || individualDossierData.payroll.loanDeduction > 0) && (
                        <div className="flex justify-between text-slate-600">
                          <span>Advance / Loan Deduction</span>
                          <strong className="font-mono text-rose-600">
                            -৳{(individualDossierData.payroll.advanceDeduction + individualDossierData.payroll.loanDeduction).toLocaleString()}
                          </strong>
                        </div>
                      )}
                      {(individualDossierData.payroll.otherDeduction > 0 || Boolean(individualDossierData.payroll.customDeductionName)) && (
                        <div className="flex justify-between text-rose-700 font-semibold">
                          <span>{individualDossierData.payroll.customDeductionName || 'Other Deduction'}</span>
                          <strong className="font-mono text-rose-600">-৳{individualDossierData.payroll.otherDeduction.toLocaleString()}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Net Salary Highlight Box */}
                <div className="p-4 bg-gradient-to-r from-emerald-500/10 via-indigo-500/10 to-purple-500/10 rounded-2xl border border-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Net Payable Salary for {selectedMonth}</span>
                    <div className="text-3xl font-black text-emerald-800 font-mono mt-0.5">
                      ৳{individualDossierData.payroll.netSalary.toLocaleString()}
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Gross (৳{individualDossierData.payroll.gross.toLocaleString()}) - Deductions (৳{individualDossierData.payroll.totalDeductions.toLocaleString()})
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const p = individualDossierData.payroll;
                        setDossierPayslipForm({
                          basicSalary: p.basic,
                          houseRent: p.houseRent,
                          medical: p.medical,
                          conveyance: p.conveyance,
                          food: p.food,
                          totalMonthDays: individualDossierData.daysInMonth,
                          workingDays: individualDossierData.workingDays,
                          presentDays: individualDossierData.stats.presentCount,
                          absentDays: individualDossierData.stats.absentCount,
                          weekendDays: p.weekendDays,
                          weekendAllowance: p.weekendAllowance,
                          shiftWorkingHours: getEmployeeShiftWorkingHours(individualDossierData.employee, shifts, roster, selectedMonth),
                          overtimeHours: p.otHours,
                          overtimeRate: p.otRate,
                          attendanceBonus: p.attendanceBonus,
                          festivalBonus: p.festivalBonus,
                          customEarningName: p.customEarningName || '',
                          otherAllowance: p.otherAllowance || 0,
                          absentDeduction: p.absentDeduction,
                          lateDeduction: p.latePenaltyDeduction,
                          pfDeduction: p.pf,
                          taxDeduction: p.tax,
                          advanceDeduction: p.advanceDeduction || 0,
                          loanDeduction: p.loanDeduction || 0,
                          customDeductionName: p.customDeductionName || '',
                          otherDeduction: p.otherDeduction || 0,
                          status: p.paymentStatus === 'paid' ? 'paid' : 'unpaid',
                        });
                        setIsEditingDossierPayslip(true);
                      }}
                      className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center space-x-1.5 cursor-pointer"
                    >
                      <span>✏️</span>
                      <span>Edit Payslip</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPrintModalOpen(true)}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/25 transition-all flex items-center space-x-1.5 cursor-pointer"
                    >
                      <span>📑</span>
                      <span>Print Certified Payslip</span>
                    </button>
                  </div>
                </div>

                {/* Inline Edit Payslip Modal inside Dossier */}
                {isEditingDossierPayslip && dossierPayslipForm && (
                  <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200">
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
                        <div>
                          <h3 className="text-base font-bold text-slate-900">
                            ✏️ Edit Payslip: {individualDossierData.employee.name} ({selectedMonth})
                          </h3>
                          <p className="text-xs text-slate-500">
                            Adjust earnings, weekend allowance, 1.5x OT, absent deduction, or add custom earning/deduction
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsEditingDossierPayslip(false)}
                          className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-lg"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="p-5 space-y-5 text-xs">
                        {/* Attendance & Absent Deduction */}
                        <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="font-bold text-slate-700 block mb-1">Working Days</label>
                            <input
                              type="number"
                              value={dossierPayslipForm.workingDays}
                              onChange={e => {
                                const wDays = Number(e.target.value) || 26;
                                const baseGross =
                                  (dossierPayslipForm.basicSalary || 0) +
                                  (dossierPayslipForm.houseRent || 0) +
                                  (dossierPayslipForm.medical || 0) +
                                  (dossierPayslipForm.conveyance || 0) +
                                  (dossierPayslipForm.food || 0);
                                const oneDayGross30 = baseGross / 30;
                                setDossierPayslipForm({
                                  ...dossierPayslipForm,
                                  workingDays: wDays,
                                  absentDeduction: Math.round((dossierPayslipForm.absentDays || 0) * oneDayGross30),
                                  weekendAllowance: Math.round((dossierPayslipForm.weekendDays || 0) * oneDayGross30),
                                  overtimeRate: calculateHourlyOtRate(dossierPayslipForm.basicSalary || 0, dossierPayslipForm.shiftWorkingHours || 8),
                                  overtimeRateCustomOverride: false,
                                });
                              }}
                              className="w-full px-2.5 py-1.5 border border-slate-200 bg-white rounded-lg font-mono font-bold"
                            />
                          </div>
                          <div>
                            <label className="font-bold text-emerald-700 block mb-1">Present Days</label>
                            <input
                              type="number"
                              value={dossierPayslipForm.presentDays}
                              onChange={e => {
                                const pDays = Number(e.target.value) || 0;
                                const wDays = dossierPayslipForm.workingDays || 26;
                                const aDays = Math.max(0, wDays - pDays);
                                const baseGross =
                                  (dossierPayslipForm.basicSalary || 0) +
                                  (dossierPayslipForm.houseRent || 0) +
                                  (dossierPayslipForm.medical || 0) +
                                  (dossierPayslipForm.conveyance || 0) +
                                  (dossierPayslipForm.food || 0);
                                const oneDayGross30 = baseGross / 30;
                                setDossierPayslipForm({
                                  ...dossierPayslipForm,
                                  presentDays: pDays,
                                  absentDays: aDays,
                                  absentDeduction: Math.round(aDays * oneDayGross30),
                                });
                              }}
                              className="w-full px-2.5 py-1.5 border border-emerald-300 bg-white rounded-lg font-mono font-bold text-emerald-700"
                            />
                          </div>
                          <div>
                            <label className="font-bold text-rose-700 block mb-1">Absent Days</label>
                            <input
                              type="number"
                              value={dossierPayslipForm.absentDays}
                              onChange={e => {
                                const aDays = Number(e.target.value) || 0;
                                const baseGross =
                                  (dossierPayslipForm.basicSalary || 0) +
                                  (dossierPayslipForm.houseRent || 0) +
                                  (dossierPayslipForm.medical || 0) +
                                  (dossierPayslipForm.conveyance || 0) +
                                  (dossierPayslipForm.food || 0);
                                const oneDayGross30 = baseGross / 30;
                                setDossierPayslipForm({
                                  ...dossierPayslipForm,
                                  absentDays: aDays,
                                  absentDeduction: Math.round(aDays * oneDayGross30),
                                });
                              }}
                              className="w-full px-2.5 py-1.5 border border-rose-300 bg-white rounded-lg font-mono font-bold text-rose-600"
                            />
                          </div>
                          <div>
                            <label className="font-bold text-rose-700 block mb-1">Absent Deduction (৳)</label>
                            <input
                              type="number"
                              value={dossierPayslipForm.absentDeduction}
                              onChange={e => setDossierPayslipForm({ ...dossierPayslipForm, absentDeduction: Number(e.target.value) })}
                              className="w-full px-2.5 py-1.5 border border-rose-300 bg-white rounded-lg font-mono font-bold text-rose-600"
                            />
                          </div>
                        </div>

                        {/* Weekend Earning & Overtime (1.5x Basic) */}
                        <div className="p-3.5 bg-emerald-50/40 border border-emerald-200 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="font-bold text-emerald-800 block mb-1">Weekend Present Days</label>
                            <input
                              type="number"
                              value={dossierPayslipForm.weekendDays}
                              onChange={e => {
                                const wkDays = Number(e.target.value) || 0;
                                const baseGross =
                                  (dossierPayslipForm.basicSalary || 0) +
                                  (dossierPayslipForm.houseRent || 0) +
                                  (dossierPayslipForm.medical || 0) +
                                  (dossierPayslipForm.conveyance || 0) +
                                  (dossierPayslipForm.food || 0);
                                const oneDayGross30 = baseGross / 30;
                                setDossierPayslipForm({
                                  ...dossierPayslipForm,
                                  weekendDays: wkDays,
                                  weekendAllowance: Math.round(wkDays * oneDayGross30),
                                  weekendAllowanceCustomOverride: false,
                                });
                              }}
                              className="w-full px-2.5 py-1.5 border border-emerald-300 bg-white rounded-lg font-mono font-bold text-emerald-700"
                            />
                          </div>
                          <div>
                            <label className="font-bold text-emerald-800 block mb-1">Weekend Earning (৳)</label>
                            <input
                              type="number"
                              value={dossierPayslipForm.weekendAllowance}
                              onChange={e => setDossierPayslipForm({ ...dossierPayslipForm, weekendAllowance: Number(e.target.value), weekendAllowanceCustomOverride: true })}
                              className="w-full px-2.5 py-1.5 border border-emerald-300 bg-white rounded-lg font-mono font-bold text-emerald-700"
                            />
                          </div>
                          <div>
                            <label className="font-bold text-purple-800 block mb-1">Overtime Hours</label>
                            <input
                              type="number"
                              step="0.5"
                              value={dossierPayslipForm.overtimeHours}
                              onChange={e => setDossierPayslipForm({ ...dossierPayslipForm, overtimeHours: Number(e.target.value) })}
                              className="w-full px-2.5 py-1.5 border border-purple-300 bg-white rounded-lg font-mono font-bold text-purple-700"
                            />
                          </div>
                          <div>
                            <label className="font-bold text-purple-800 block mb-1">OT Rate (1.5x Basic ৳)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={dossierPayslipForm.overtimeRate}
                              onChange={e => setDossierPayslipForm({ ...dossierPayslipForm, overtimeRate: Number(e.target.value), overtimeRateCustomOverride: true })}
                              className="w-full px-2.5 py-1.5 border border-purple-300 bg-white rounded-lg font-mono font-bold text-purple-700"
                            />
                          </div>
                        </div>

                        {/* Custom Manual Earning & Deduction (Write Name & Amount) */}
                        <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl space-y-3">
                          <h4 className="font-bold uppercase text-amber-900 tracking-wider">
                            ✍️ Custom Earning &amp; Deduction (Write Name &amp; Amount)
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="p-3 bg-white rounded-xl border border-emerald-200 space-y-2">
                              <span className="font-bold text-emerald-800 block">+ Custom Earning / Allowance</span>
                              <input
                                type="text"
                                placeholder="Earning Name (e.g. Special Allowance)"
                                value={dossierPayslipForm.customEarningName || ''}
                                onChange={e => setDossierPayslipForm({ ...dossierPayslipForm, customEarningName: e.target.value })}
                                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg"
                              />
                              <input
                                type="number"
                                placeholder="Amount (৳)"
                                value={dossierPayslipForm.otherAllowance || 0}
                                onChange={e => setDossierPayslipForm({ ...dossierPayslipForm, otherAllowance: Number(e.target.value) })}
                                className="w-full px-2.5 py-1.5 border border-emerald-300 rounded-lg font-mono font-bold text-emerald-700"
                              />
                            </div>
                            <div className="p-3 bg-white rounded-xl border border-rose-200 space-y-2">
                              <span className="font-bold text-rose-800 block">- Custom Deduction / Fine</span>
                              <input
                                type="text"
                                placeholder="Deduction Name (e.g. Fine / Canteen)"
                                value={dossierPayslipForm.customDeductionName || ''}
                                onChange={e => setDossierPayslipForm({ ...dossierPayslipForm, customDeductionName: e.target.value })}
                                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg"
                              />
                              <input
                                type="number"
                                placeholder="Amount (৳)"
                                value={dossierPayslipForm.otherDeduction || 0}
                                onChange={e => setDossierPayslipForm({ ...dossierPayslipForm, otherDeduction: Number(e.target.value) })}
                                className="w-full px-2.5 py-1.5 border border-rose-300 rounded-lg font-mono font-bold text-rose-600"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 border-t border-slate-100 flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => setIsEditingDossierPayslip(false)}
                          className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const emp = individualDossierData.employee;
                            const key = `${selectedMonth}_${emp.id}`;
                            const updatedRecord = {
                              ...dossierPayslipForm,
                              employeeId: emp.id,
                              month: selectedMonth,
                              manuallyEdited: true,
                              manualOverrideV2: true,
                              overtimeRateCustomOverride: Boolean(dossierPayslipForm.overtimeRateCustomOverride),
                              overtimeAmount: Math.round((dossierPayslipForm.overtimeHours || 0) * (dossierPayslipForm.overtimeRate || 0)),
                              absentDeductionManualZero: (dossierPayslipForm.absentDays || 0) > 0 && Number(dossierPayslipForm.absentDeduction) === 0,
                              absentDeductionManualZeroV2: (dossierPayslipForm.absentDays || 0) > 0 && Number(dossierPayslipForm.absentDeduction) === 0,
                              weekendAllowanceManualZero: Boolean(dossierPayslipForm.weekendAllowanceCustomOverride && (dossierPayslipForm.weekendDays || 0) > 0 && Number(dossierPayslipForm.weekendAllowance) === 0),
                              weekendAllowanceCustomOverride: Boolean(dossierPayslipForm.weekendAllowanceCustomOverride),
                              paymentMethod: 'Bank Transfer',
                            };
                            const nextAll = { ...savedPayrollRecords, [key]: updatedRecord };
                            setSavedPayrollRecords(nextAll);
                            try {
                              localStorage.setItem('worknest_payroll_monthly_records', JSON.stringify(nextAll));
                              window.dispatchEvent(new Event('worknest_payroll_updated'));
                            } catch {}
                            setIsEditingDossierPayslip(false);
                          }}
                          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs"
                        >
                          Save Payslip Changes
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Complete Daily Timesheet Punch Log Table */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-2xl">📅</span>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Daily Attendance &amp; Punch Log (12-Hour AM/PM)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Detailed check-in, check-out, working hours, overtime, and status for {individualDossierData.periodLabel}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={dossierTableStatusFilter}
                      onChange={(e) => setDossierTableStatusFilter(e.target.value)}
                      className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer"
                    >
                      <option value="all">All Days ({individualDossierData.dailyRecords.length})</option>
                      <option value="present_all">Attended Days ({individualDossierData.stats.presentCount})</option>
                      <option value="present">On-Time Present</option>
                      <option value="late">Late Arrivals ({individualDossierData.stats.lateCount})</option>
                      <option value="absent">Absent Days ({individualDossierData.stats.absentCount})</option>
                      <option value="off_day">Weekend / Off</option>
                    </select>
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-xl border border-indigo-200 font-mono">
                      Total Work: {individualDossierData.stats.totalWorkedFormatted} ({individualDossierData.stats.totalHours}h)
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-3">Day</th>
                        <th className="py-3 px-3">Shift</th>
                        <th className="py-3 px-3 font-mono text-emerald-800">Check-In</th>
                        <th className="py-3 px-3 font-mono text-indigo-800">Check-Out</th>
                        <th className="py-3 px-3 font-mono">Work Hrs</th>
                        <th className="py-3 px-3 font-mono">Overtime</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-4">Punch Notes / Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {individualDossierData.filteredDailyRecords.map((rec: any, idx: number) => {
                        return (
                          <tr
                            key={idx}
                            className={`hover:bg-slate-50/80 transition-colors ${
                              rec.isWeekend ? 'bg-slate-50/40 text-slate-500' : 'bg-white'
                            }`}
                          >
                            <td className="py-2.5 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                              {rec.date}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-600 whitespace-nowrap">
                              {rec.dayName}
                            </td>
                            <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                              {rec.shift}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-emerald-700 whitespace-nowrap">
                              {rec.checkIn || '—'}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-indigo-700 whitespace-nowrap">
                              {rec.checkOut || '—'}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                              {rec.workedMinutes > 0 ? (
                                <span className="bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded-lg border border-indigo-200 inline-block">
                                  {rec.workedHours}
                                </span>
                              ) : rec.workedHours === 'In Progress' ? (
                                <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-lg border border-amber-200 text-[10px] font-bold inline-block">
                                  ⏳ In Progress
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-emerald-700 whitespace-nowrap">
                              {rec.otHours > 0 ? (
                                <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg border border-emerald-200 text-[10px]">
                                  +{rec.otHours.toFixed(1)}h
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {rec.status === 'present' ? (
                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-md">
                                  ✓ Present
                                </span>
                              ) : rec.status === 'late' ? (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-md">
                                  ⏰ Late (+{rec.lateMinutes || 15}m){rec.isLateWaived ? ' • Waived' : ''}
                                </span>
                              ) : rec.status === 'half_day' ? (
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-md">
                                  🌓 Half-Day
                                </span>
                              ) : rec.status === 'leave' ? (
                                <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-[10px] font-bold rounded-md">
                                  🏖️ On Leave
                                </span>
                              ) : rec.status === 'off_day' ? (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-semibold rounded-md">
                                  Weekend Off
                                </span>
                              ) : rec.status === 'scheduled' ? (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-medium rounded-md">
                                  Upcoming
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-bold rounded-md">
                                  ❌ Absent
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-slate-500 text-[11px] truncate max-w-xs">
                              {rec.leaveReason ? (
                                <span className="text-purple-700 font-medium">Leave: {rec.leaveReason}</span>
                              ) : rec.lateMinutes > 0 ? (
                                <span className="text-amber-700 font-medium">
                                  Arrived late by {rec.lateMinutes} min{rec.isLateWaived ? ' (Waived)' : ''}
                                </span>
                              ) : rec.isEarlyOut ? (
                                <span className="text-blue-700 font-medium">Early departure recorded</span>
                              ) : rec.isWeekend ? (
                                'Weekly Rest Day'
                              ) : rec.rawIn && rec.rawIn !== '-' ? (
                                'Biometric punch verified'
                              ) : (
                                'No attendance recorded'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 5. Leave Ledger & Quotas Card */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center space-x-2.5 pb-3 border-b border-slate-100">
                  <span className="text-2xl">🏖️</span>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Leave Balance &amp; History Ledger</h3>
                    <p className="text-xs text-slate-500">Official leave quotas, consumed balances, and request history</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Annual Leave</span>
                    <div className="flex items-baseline space-x-1.5 mt-1">
                      <span className="text-xl font-black text-indigo-700 font-mono">
                        {individualDossierData.leaveLedger.annual.remaining}
                      </span>
                      <span className="text-xs text-slate-400">/ {individualDossierData.leaveLedger.annual.total} days</span>
                    </div>
                    <span className="text-[10px] text-slate-500">Used: {individualDossierData.leaveLedger.annual.used} days</span>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Casual Leave</span>
                    <div className="flex items-baseline space-x-1.5 mt-1">
                      <span className="text-xl font-black text-emerald-700 font-mono">
                        {individualDossierData.leaveLedger.casual.remaining}
                      </span>
                      <span className="text-xs text-slate-400">/ {individualDossierData.leaveLedger.casual.total} days</span>
                    </div>
                    <span className="text-[10px] text-slate-500">Used: {individualDossierData.leaveLedger.casual.used} days</span>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Sick Leave</span>
                    <div className="flex items-baseline space-x-1.5 mt-1">
                      <span className="text-xl font-black text-blue-700 font-mono">
                        {individualDossierData.leaveLedger.sick.remaining}
                      </span>
                      <span className="text-xs text-slate-400">/ {individualDossierData.leaveLedger.sick.total} days</span>
                    </div>
                    <span className="text-[10px] text-slate-500">Used: {individualDossierData.leaveLedger.sick.used} days</span>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Unpaid Leave</span>
                    <div className="flex items-baseline space-x-1.5 mt-1">
                      <span className="text-xl font-black text-rose-700 font-mono">
                        {individualDossierData.leaveLedger.unpaid.used}
                      </span>
                      <span className="text-xs text-slate-400">days taken</span>
                    </div>
                    <span className="text-[10px] text-rose-600 font-semibold">Salary deducted</span>
                  </div>
                </div>

                {/* Leave Requests History */}
                {individualDossierData.leaveLedger.requests.length > 0 && (
                  <div className="pt-2">
                    <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                      Approved Leave Applications
                    </h5>
                    <div className="space-y-2">
                      {individualDossierData.leaveLedger.requests.map((l: any) => (
                        <div key={l.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-slate-900 capitalize">{l.type} Leave ({l.days} days)</span>
                            <span className="text-slate-500 ml-2 font-mono">{l.from} to {l.to}</span>
                            {l.reason && <p className="text-[11px] text-slate-500 mt-0.5">{l.reason}</p>}
                          </div>
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-lg">
                            ✓ Approved
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. AUDIT-READY PRINT PREVIEW & PDF EXPORT MODAL                           */}
      {/* ========================================================================= */}
      {isPrintModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 no-print animate-fade-in"
        >
          <div className="bg-white rounded-3xl w-full max-w-6xl max-h-[95vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Modal Control Toolbar */}
            <div className="px-5 py-4 bg-slate-950 text-white flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/10 shrink-0">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-xl shrink-0 shadow-lg shadow-indigo-600/30">
                  🖨️
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-sm sm:text-base text-white truncate font-display">
                      Print &amp; PDF Document Preview
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/25 text-indigo-300 border border-indigo-400/30 shrink-0">
                      Audit Ready
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {currentReportConfig.title} • {currentReportConfig.period} • {currentReportConfig.rows.length} Records
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleTriggerPrint}
                  disabled={isPrinting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
                  title="Send to physical printer or save as PDF"
                >
                  <span>🖨️</span>
                  <span>{isPrinting ? 'Preparing Print...' : 'Print / Save as PDF'}</span>
                </button>

                <button
                  onClick={() => {
                    const html = generateReportHtml(currentReportConfig);
                    const safeName = currentReportConfig.title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                    downloadReportHtml(safeName, html);
                    showPrintNotice('Printable standalone HTML document downloaded!', 'success');
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all border border-slate-700 cursor-pointer"
                  title="Download offline HTML document that you can print anytime"
                >
                  <span>💾</span>
                  <span>Download HTML</span>
                </button>

                <button
                  onClick={async () => {
                    const ok = await copyReportAsTsv(currentReportConfig.headers, currentReportConfig.rows);
                    if (ok) {
                      showPrintNotice('Report table copied to clipboard in Excel/TSV format!', 'success');
                    } else {
                      showPrintNotice('Failed to copy table to clipboard.', 'warn');
                    }
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all border border-slate-700 cursor-pointer"
                  title="Copy table formatted for Excel or Google Sheets"
                >
                  <span>📋</span>
                  <span>Copy Table</span>
                </button>

                <button
                  onClick={() => setIsPrintModalOpen(false)}
                  className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-rose-600 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer font-bold text-base ml-1"
                  aria-label="Close modal"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* In-Modal Feedback Toast */}
            {printNotice && (
              <div
                className={`px-4 py-2.5 text-xs font-semibold flex items-center justify-between border-b ${
                  printNotice.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                    : printNotice.type === 'warn'
                    ? 'bg-amber-50 text-amber-900 border-amber-200'
                    : 'bg-indigo-50 text-indigo-900 border-indigo-200'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span>{printNotice.type === 'success' ? '✅' : printNotice.type === 'warn' ? '⚠️' : 'ℹ️'}</span>
                  <span>{printNotice.text}</span>
                </div>
                <button
                  onClick={() => setPrintNotice(null)}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer font-bold px-1"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Document Sheet Canvas */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-100 flex justify-center">
              <div className="bg-white rounded-xl shadow-md border border-slate-300/80 p-6 sm:p-8 w-full max-w-5xl text-slate-900 font-sans">
                {/* Document Header */}
                <div className="border-b-2 border-slate-900 pb-4 mb-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xl">🏛️</span>
                      <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight font-display">
                        WorkNest HRMS — Enterprise Workforce Operations
                      </h2>
                    </div>
                    <h3 className="text-base font-bold text-indigo-950 mt-1">
                      {currentReportConfig.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {currentReportConfig.subtitle}
                    </p>
                  </div>
                  <div className="text-left sm:text-right text-xs text-slate-600 space-y-0.5">
                    <p><strong className="text-slate-900">Period:</strong> {currentReportConfig.period}</p>
                    <p><strong className="text-slate-900">Entries:</strong> {currentReportConfig.rows.length} records</p>
                    <p><strong className="text-slate-900">Generated:</strong> {new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    <p><strong className="text-slate-900">Status:</strong> Certified Management Audit</p>
                  </div>
                </div>

                {/* Filter Badges */}
                {currentReportConfig.filters.length > 0 && (
                  <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap gap-2 items-center">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mr-1">
                      Applied Filters:
                    </span>
                    {currentReportConfig.filters.map((f, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-700 shadow-2xs"
                      >
                        <strong className="text-slate-500 font-medium">{f.label}:</strong> {f.value}
                      </span>
                    ))}
                  </div>
                )}

                {/* Executive Metrics Grid */}
                {currentReportConfig.metrics.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5 mb-6">
                    {currentReportConfig.metrics.map((m, i) => (
                      <div
                        key={i}
                        className={`p-3 rounded-xl border ${
                          m.highlight
                            ? 'bg-indigo-50/70 border-indigo-200'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block truncate">
                          {m.label}
                        </span>
                        <span className="text-sm sm:text-base font-black text-slate-900 font-mono mt-1 block truncate">
                          {m.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Printable Table */}
                <div className="overflow-x-auto border border-slate-300 rounded-xl mb-8">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-white">
                        {currentReportConfig.headers.map((h, i) => (
                          <th
                            key={i}
                            className="px-3 py-2.5 font-bold text-[10px] tracking-wider uppercase border border-slate-800 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-800">
                      {currentReportConfig.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={currentReportConfig.headers.length}
                            className="px-4 py-8 text-center text-slate-400 italic"
                          >
                            No records found matching the active criteria.
                          </td>
                        </tr>
                      ) : (
                        currentReportConfig.rows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className={rIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}
                          >
                            {row.map((cell, cIdx) => (
                              <td
                                key={cIdx}
                                className="px-3 py-2 border border-slate-200 text-[11px] whitespace-nowrap"
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Corporate Signatures */}
                <div className="pt-6 border-t border-slate-300 mt-6 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="border-t border-dashed border-slate-400 pt-2 mb-1"></div>
                    <p className="text-xs font-bold text-slate-900">Prepared By</p>
                    <p className="text-[10px] text-slate-500">HR Operations Executive</p>
                  </div>
                  <div>
                    <div className="border-t border-dashed border-slate-400 pt-2 mb-1"></div>
                    <p className="text-xs font-bold text-slate-900">Verified &amp; Audited By</p>
                    <p className="text-[10px] text-slate-500">Head of Human Resources</p>
                  </div>
                  <div>
                    <div className="border-t border-dashed border-slate-400 pt-2 mb-1"></div>
                    <p className="text-xs font-bold text-slate-900">Approved By</p>
                    <p className="text-[10px] text-slate-500">Managing Director / CFO</p>
                  </div>
                </div>

                {/* Document Footer & PDF Instruction Tip */}
                <div className="mt-8 pt-3 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center text-[10px] text-slate-400 gap-2">
                  <span>CONFIDENTIAL • WorkNest HRMS Internal Audit Report</span>
                  <span className="text-indigo-600 font-medium">💡 Tip: In print dialog, choose &quot;Save as PDF&quot; to export a high-res PDF file</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
