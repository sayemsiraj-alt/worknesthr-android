import { useState, useMemo, useEffect } from 'react';
import { useData, Employee } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db, syncRecordToFirestore } from '../lib/firestoreService';
import {
  resolveEmployeeScheduleForDate,
  resolveEmployeeShiftNameForDate,
  findShiftByNameOrId,
  isShiftOvertimeEnabled,
  calculateOvertimeHours,
  isEveningOrOvernight,
  normalizeTimeStr,
  getBangladeshTodayStr,
  getEmployeeShiftWorkingHours,
  calculateHourlyOtRate,
  evaluateAttendanceForSchedule,
} from '../utils/attendanceScheduleEngine';
import { printHtmlDocument } from '../utils/nativePrint';

export type MonthlyPayrollRecord = {
  employeeId: string;
  month: string; // 'YYYY-MM'
  totalMonthDays: number; // Total calendar days (30, 31, 28, 29)
  workingDays: number;    // Roster-based working days (totalMonthDays - rosterWeekendDays)
  workingDaysCustomOverride?: boolean;
  presentDays: number;    // Total present days
  weekendDays?: number;   // Days employee was present on Weekend / Off day
  weekendAllowance?: number; // Earning added for working on Weekend
  basicSalary: number;
  houseRent: number;
  medical: number;
  conveyance: number;
  food: number;
  overtimeHours: number;
  overtimeRate: number;
  overtimeAmount: number;
  shiftWorkingHours?: number;
  overtimeRateCustomOverride?: boolean;
  attendanceBonus: number;
  festivalBonus: number;
  customEarningName?: string; // Custom manual earning name written by admin
  otherAllowance: number;     // Custom manual earning amount
  absentDays: number;
  absentDeduction: number;
  absentDeductionManualZero?: boolean;
  absentDeductionManualZeroV2?: boolean;
  weekendAllowanceManualZero?: boolean;
  weekendAllowanceCustomOverride?: boolean;
  manualOverrideV2?: boolean;
  lateDeduction: number;
  advanceDeduction: number;
  loanDeduction: number;
  customDeductionName?: string; // Custom manual deduction name written by admin
  otherDeduction?: number;      // Custom manual deduction amount
  pfDeduction: number;
  taxDeduction: number;
  manuallyEdited?: boolean; // True if admin explicitly set custom amounts for this employee
  status: 'paid' | 'unpaid' | 'on_hold';
  paymentDate?: string;
  paymentMethod: 'Bank Transfer' | 'Cash' | 'bKash/Mobile Banking' | 'Cheque';
  transactionRef?: string;
  notes?: string;
};

export type PayrollPolicy = {
  autoPfDeduction: boolean;
  autoTaxDeduction: boolean;
  pfEmployeePercent: number;
  taxPercent: number;
};

// Convert number to Bangladeshi/English words (Taka)
function numberToWords(num: number): string {
  if (!num || num === 0) return 'Zero Taka Only';
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' and ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + convert(n % 10000000) : '');
  }

  const rounded = Math.abs(Math.round(num));
  return `${convert(rounded)} Taka Only`;
}

// Calculate total calendar days and standard working days:
// Rule:
// - 30-day month -> 26 Working Days (4 days off)
// - 31-day month -> 27 Working Days (4 days off)
// - 28-day month (Feb) -> 24 Working Days
// - 29-day month (Leap Feb) -> 25 Working Days
export function getMonthDaysInfo(monthStr: string) {
  const [y, m] = monthStr.split('-').map(Number);
  const totalMonthDays = new Date(y, m, 0).getDate();

  let defaultWorkingDays: number;
  if (totalMonthDays === 31) {
    defaultWorkingDays = 27;
  } else if (totalMonthDays === 30) {
    defaultWorkingDays = 26;
  } else if (totalMonthDays === 29) {
    defaultWorkingDays = 25;
  } else if (totalMonthDays === 28) {
    defaultWorkingDays = 24;
  } else {
    defaultWorkingDays = Math.max(1, totalMonthDays - 4);
  }

  const defaultOffDays = Math.max(0, totalMonthDays - defaultWorkingDays);
  return { totalMonthDays, defaultWorkingDays, defaultOffDays };
}

export function Payroll() {
  const {
    employees,
    allEmployees,
    updateEmployee,
    departments,
    branches,
    activeBranch,
    setActiveBranch,
    getEmployeeBranch,
    addNotification,
    monthlyPayrollRuns,
    generateMonthEndPayroll,
    attendanceRequests,
    shifts,
    roster,
    leaveRequests,
    approveMonthlyPayrollRun,
    lockMonthlyPayrollRun,
    unlockMonthlyPayrollRun,
    salaryAdvancesLoans,
    saveSalaryAdvanceLoan,
    updateSalaryAdvanceLoan,
  } = useData();

  const { currentCompanyId, currentCompany } = useTenant();
  const activeTenant = currentCompanyId || 'default';

  // Firestore attendance records for automatic late & absence deduction
  const [firestoreAttendance, setFirestoreAttendance] = useState<any[]>([]);
  useEffect(() => {
    try {
      const q = collection(db, 'attendance');

      const unsubscribe = onSnapshot(q, (snap) => {
        const list: any[] = [];
        snap.forEach(d => {
          const data = d.data();
          const docComp = data.companyId || 'default';
          const matches = activeTenant !== 'default'
            ? (!data.companyId || docComp === 'default' || docComp === activeTenant)
            : (!data.companyId || docComp === 'default');
          if (matches) {
            list.push({ id: d.id, ...data });
          }
        });
        setFirestoreAttendance(list);
      }, (err) => console.warn('Attendance in Payroll err:', err));
      return () => unsubscribe();
    } catch {}
  }, [activeTenant]);

  // Month-end generation loading state
  const [isGeneratingMonthEnd, setIsGeneratingMonthEnd] = useState(false);

  // Current selected month
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${month}`;
  });

  // Company settings from localStorage or current company
  const companyInfo = useMemo(() => {
    if (currentCompany?.profile) {
      return {
        companyName: currentCompany.profile.companyName || currentCompany.name || 'WorkNest Workspace',
        legalName: currentCompany.name || 'WorkNest Workspace',
        email: currentCompany.profile.email || currentCompany.ownerEmail || 'hr@worknest.com',
        phone: currentCompany.profile.phone || '+880 1700-000000',
        address: currentCompany.profile.address || 'Gulshan-2, Dhaka-1212, Bangladesh',
        currency: currentCompany.profile.currency || 'BDT (৳)',
      };
    }
    try {
      const saved = localStorage.getItem('worknest_settings_company');
      return saved ? JSON.parse(saved) : {
        companyName: 'WorkNest Technologies Ltd.',
        legalName: 'WorkNest Solutions International',
        email: 'hr@worknest.com',
        phone: '+880 1700-000000',
        address: 'Gulshan-2, Dhaka-1212, Bangladesh',
        currency: 'BDT (৳)',
      };
    } catch {
      return {
        companyName: 'WorkNest Technologies Ltd.',
        legalName: 'WorkNest Solutions International',
        email: 'hr@worknest.com',
        phone: '+880 1700-000000',
        address: 'Gulshan-2, Dhaka-1212, Bangladesh',
        currency: 'BDT (৳)',
      };
    }
  }, [currentCompany]);

  // Search and Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'unpaid' | 'on_hold'>('all');

  // Stored monthly payroll overrides keyed by `${month}_${employeeId}`
  const [monthlyRecords, setMonthlyRecords] = useState<Record<string, MonthlyPayrollRecord>>(() => {
    try {
      const saved = localStorage.getItem('worknest_payroll_monthly_records');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Save to localStorage and Firestore when monthlyRecords changes
  useEffect(() => {
    try {
      localStorage.setItem('worknest_payroll_monthly_records', JSON.stringify(monthlyRecords));
      window.dispatchEvent(new Event('worknest_payroll_updated'));
      if (Object.keys(monthlyRecords).length > 0) {
        syncRecordToFirestore('settings', `payroll_records_${activeTenant}`, {
          records: monthlyRecords,
          companyId: activeTenant,
          updatedAt: new Date().toISOString(),
        }, activeTenant).catch(() => {});
      }
    } catch {}
  }, [monthlyRecords, activeTenant]);

  // Real-time Firestore listener for monthlyRecords across devices
  useEffect(() => {
    try {
      const unsub = onSnapshot(doc(db, 'settings', `payroll_records_${activeTenant}`), (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data?.records && typeof data.records === 'object') {
            setMonthlyRecords(prev => {
              const merged = { ...prev, ...data.records };
              if (JSON.stringify(prev) === JSON.stringify(merged)) return prev;
              try {
                localStorage.setItem('worknest_payroll_monthly_records', JSON.stringify(merged));
              } catch {}
              return merged;
            });
          }
        }
      }, () => {});
      return () => unsub();
    } catch {}
  }, [activeTenant]);

  // Listen for payroll updates triggered from Reports or other tabs
  useEffect(() => {
    const handlePayrollSync = () => {
      try {
        const saved = localStorage.getItem('worknest_payroll_monthly_records');
        if (saved) {
          const parsed = JSON.parse(saved);
          setMonthlyRecords(prev => (JSON.stringify(prev) === saved ? prev : parsed));
        }
      } catch {}
    };
    window.addEventListener('worknest_payroll_updated', handlePayrollSync);
    window.addEventListener('storage', handlePayrollSync);
    return () => {
      window.removeEventListener('worknest_payroll_updated', handlePayrollSync);
      window.removeEventListener('storage', handlePayrollSync);
    };
  }, []);

  // Statutory Deduction Policy (Auto PF & Auto Tax Toggle)
  const [payrollPolicy, setPayrollPolicy] = useState<PayrollPolicy>(() => {
    try {
      const saved = localStorage.getItem('worknest_settings_payroll');
      if (saved) {
        const p = JSON.parse(saved);
        return {
          autoPfDeduction: Boolean(p.autoPfDeduction),
          autoTaxDeduction: Boolean(p.autoTaxDeduction),
          pfEmployeePercent: Number(p.pfEmployeePercent) || 8.33,
          taxPercent: Number(p.taxPercent) || 5,
        };
      }
    } catch {}
    return {
      autoPfDeduction: false, // Default is OFF as user requested
      autoTaxDeduction: false, // Default is OFF as user requested
      pfEmployeePercent: 8.33,
      taxPercent: 5,
    };
  });

  // Modal to toggle statutory deduction rules directly in Payroll
  const [showDeductionPolicyModal, setShowDeductionPolicyModal] = useState(false);

  // Sync settings when modified in AccountSettings
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'worknest_settings_payroll' && e.newValue) {
        try {
          const p = JSON.parse(e.newValue);
          setPayrollPolicy({
            autoPfDeduction: Boolean(p.autoPfDeduction),
            autoTaxDeduction: Boolean(p.autoTaxDeduction),
            pfEmployeePercent: Number(p.pfEmployeePercent) || 8.33,
            taxPercent: Number(p.taxPercent) || 5,
          });
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Modals state
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editFormData, setEditFormData] = useState<MonthlyPayrollRecord | null>(null);
  const [updateMasterProfile, setUpdateMasterProfile] = useState(false);

  const [payslipEmployee, setPayslipEmployee] = useState<Employee | null>(null);
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [bonusAmountType, setBonusAmountType] = useState<'percent' | 'fixed'>('percent');
  const [bonusValue, setBonusValue] = useState<number>(50); // 50% of basic
  const [bonusDept, setBonusDept] = useState<string>('all');
  const [showDisburseAllModal, setShowDisburseAllModal] = useState(false);
  const [batchPaymentMethod, setBatchPaymentMethod] = useState<'Bank Transfer' | 'Cash' | 'bKash/Mobile Banking' | 'Cheque'>('Bank Transfer');

  // Phase 2: Advanced Payroll Modals (Advances/Loans, Payroll History, Lock/Unlock)
  const [showAdvancesModal, setShowAdvancesModal] = useState(false);
  const [showPayrollHistoryModal, setShowPayrollHistoryModal] = useState(false);
  const [isFinalizingRun, setIsFinalizingRun] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({
    employeeId: '',
    type: 'advance' as 'advance' | 'loan',
    principalAmount: 10000,
    monthlyInstallment: 2500,
    totalInstallments: 4,
    startMonth: selectedMonth,
    reason: '',
  });

  // Active Payroll Run for selectedMonth (from Firestore payroll_runs)
  const activePayrollRun = useMemo(() => {
    return monthlyPayrollRuns[selectedMonth] || null;
  }, [monthlyPayrollRuns, selectedMonth]);

  const payrollRunsList = useMemo(() => {
    return Object.values(monthlyPayrollRuns).sort((a, b) => b.month.localeCompare(a.month));
  }, [monthlyPayrollRuns]);

  const isMonthLocked = Boolean(
    activePayrollRun && (activePayrollRun.isLocked || activePayrollRun.approvalStatus === 'locked')
  );

  // Active salary advances / loans for employees in or before selectedMonth
  const getActiveEmployeeAdvanceInstallments = (emp: Employee) => {
    let autoAdvanceCut = 0;
    let autoLoanCut = 0;
    salaryAdvancesLoans.forEach(adv => {
      const matchEmp =
        adv.employeeId === emp.id ||
        adv.employeeId === emp.employeeId;
      if (
        matchEmp &&
        adv.status === 'active' &&
        adv.remainingBalance > 0 &&
        adv.startMonth <= selectedMonth
      ) {
        const cut = Math.min(adv.remainingBalance, adv.monthlyInstallment || adv.remainingBalance);
        if (adv.type === 'loan') {
          autoLoanCut += cut;
        } else {
          autoAdvanceCut += cut;
        }
      }
    });
    return { autoAdvanceCut, autoLoanCut };
  };

  // Helper to get or build payroll record for an employee for selectedMonth
  const getPayrollRecord = (emp: Employee): MonthlyPayrollRecord => {
    const key = `${selectedMonth}_${emp.id}`;
    const { totalMonthDays, defaultWorkingDays } = getMonthDaysInfo(selectedMonth);

    // CRITICAL PHASE 2 DATA SAFETY:
    // If this month's payroll run is LOCKED / FINALIZED, return the immutable historical snapshot
    // so that live recalculation, attendance edits, or salary structure updates NEVER corrupt finalized historical payroll!
    if (isMonthLocked && activePayrollRun?.lockedSnapshots) {
      const snap =
        activePayrollRun.lockedSnapshots[emp.id] ||
        activePayrollRun.lockedSnapshots[emp.employeeId];
      if (snap) {
        const storedRec = monthlyRecords[key];
        return {
          ...snap,
          employeeId: emp.id,
          month: selectedMonth,
          totalMonthDays: snap.totalMonthDays || totalMonthDays,
          workingDays: snap.workingDays || defaultWorkingDays,
          status: storedRec?.status || snap.status || 'unpaid',
          paymentDate: storedRec?.paymentDate || snap.paymentDate,
          paymentMethod: storedRec?.paymentMethod || snap.paymentMethod || 'Bank Transfer',
          transactionRef: storedRec?.transactionRef || snap.transactionRef,
          notes: storedRec?.notes || snap.notes,
        };
      }
    }

    // Default calculations based on Bangladesh salary structure (50% basic, 30% house rent, 10% medical, 10% conveyance)
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

    // Robust employee matching across ID, code, numeric badge ID, and name
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

    const empAtt = firestoreAttendance.filter((a: any) =>
      a.date && String(a.date).startsWith(selectedMonth) && isEmpMatchRecord(a)
    );

    const todayStr = getBangladeshTodayStr();
    const [selY, selM] = selectedMonth.split('-').map(Number);

    let autoPresentDays = 0;
    let autoRosterWeekendDays = 0;
    let autoWeekendPresentDays = 0;
    let autoExplicitAbsentDays = 0;
    let autoUnpunchedPastWorkingDays = 0;
    let autoOvertimeMinutes = 0;
    let unexcusedLateDays = 0;

    for (let d = 1; d <= totalMonthDays; d++) {
      const dateStr = `${selY}-${String(selM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const attRecord = empAtt.find((a: any) => a.date === dateStr);
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
        (l: any) =>
          l.status === 'approved' &&
          isEmpMatchRecord(l) &&
          dateStr >= (l.from || (l as any).startDate) &&
          dateStr <= (l.to || (l as any).endDate)
      );

      let rawIn = '-';
      let rawOut = '-';
      if (attRecord) {
        const logs = Array.isArray(attRecord.punchLogs)
          ? attRecord.punchLogs
          : Array.isArray(attRecord.allPunches)
          ? attRecord.allPunches
          : [];
        const pIn =
          attRecord.firstPunchIn ||
          attRecord.checkIn ||
          attRecord.firstPunch ||
          attRecord.inTime ||
          (logs.length > 0 ? logs[0] : '-') ||
          '-';
        let pOut =
          attRecord.checkOut ||
          attRecord.lastPunchOut ||
          attRecord.lastPunch ||
          attRecord.outTime ||
          (logs.length > 1 ? logs[logs.length - 1] : '-') ||
          '-';
        if (pIn && pIn !== '--:--') rawIn = String(pIn).trim();
        if (pOut && pOut !== '--:--') rawOut = String(pOut).trim();
        if (rawIn !== '-' && rawOut !== '-' && (rawIn === rawOut || normalizeTimeStr(rawIn) === normalizeTimeStr(rawOut) || attRecord.totalPunches === 1)) {
          rawOut = '-';
        }
      }
      const hasPunch = rawIn !== '-' || rawOut !== '-';

      let resolvedStatus = '';
      if (attRecord && (hasPunch || attRecord.status)) {
        const evalRes = evaluateAttendanceForSchedule(rawIn, rawOut, sched, attRecord, dateShiftName);
        resolvedStatus = evalRes.status;
      }

      const isPresentStatus = Boolean(
        attRecord && (hasPunch || ['present', 'late', 'half_day'].includes(resolvedStatus)) && resolvedStatus !== 'absent' && resolvedStatus !== 'weekend_off'
      );

      if (isPresentStatus) {
        autoPresentDays++;
        if (isWeekend) {
          autoWeekendPresentDays++;
        }

        if (resolvedStatus === 'late') {
          const isApprovedReq = attendanceRequests.some(r =>
            isEmpMatchRecord(r) &&
            r.date === dateStr &&
            r.type === 'late_arrival' &&
            r.status === 'approved'
          );
          if (!attRecord.isLateExcused && !attRecord.lateWaived && !isApprovedReq) {
            unexcusedLateDays++;
          }
        }

        // Daily Overtime calculation (respecting Shift OT toggle & 1.5x Basic rule)
        const isOvernight = Boolean(
          attRecord.isOvernight ||
          sched.isOvernight ||
          isEveningOrOvernight(sched) ||
          (rawIn !== '-' && rawOut !== '-' && normalizeTimeStr(rawOut) < normalizeTimeStr(rawIn))
        );

        const matchedShift =
          sched.shift ||
          findShiftByNameOrId(shifts, sched.shiftName) ||
          findShiftByNameOrId(shifts, dateShiftName);
        const otEnabled =
          !isWeekend &&
          sched.overtimePolicyEnabled !== false &&
          isShiftOvertimeEnabled(matchedShift);

        const calcOt = otEnabled
          ? calculateOvertimeHours(rawIn, rawOut, {
              ...sched,
              shift: matchedShift || sched.shift,
              overtimePolicyEnabled: otEnabled,
              isOvernight,
            })
          : 0;
        const savedOt =
          attRecord.otHours !== undefined && attRecord.otHours !== null
            ? Number(attRecord.otHours)
            : attRecord.overtimeHours !== undefined && attRecord.overtimeHours !== null
            ? Number(attRecord.overtimeHours)
            : null;

        let dayOtHours = 0;
        if (!otEnabled) {
          dayOtHours = 0;
        } else if (attRecord.source === 'admin_edit' && savedOt !== null) {
          dayOtHours = savedOt;
        } else if (rawIn !== '-' && rawOut !== '-') {
          dayOtHours = calcOt;
        } else if (savedOt !== null && savedOt > 0) {
          dayOtHours = savedOt;
        }

        if (dayOtHours > 0) {
          autoOvertimeMinutes += Math.round(dayOtHours * 60);
        }
      } else if (attRecord && resolvedStatus === 'absent') {
        autoExplicitAbsentDays++;
      } else if (activeLeave) {
        // Approved leave - no absent penalty
      } else if (!isWeekend && dateStr <= todayStr) {
        autoUnpunchedPastWorkingDays++;
      }
    }

    const computedWorkingDays = Math.max(0, totalMonthDays - autoRosterWeekendDays);
    const workingDays = computedWorkingDays;
    const computedPresentDays = autoPresentDays;
    const computedAbsentDays = autoExplicitAbsentDays + autoUnpunchedPastWorkingDays;
    const computedWeekendDays = autoWeekendPresentDays;
    const computedOvertimeHours = Number((autoOvertimeMinutes / 60).toFixed(1));

    // User Rule: Whether 30-day or 31-day month, 1 day salary for Late (3 days = 1 day cut) & Absent Deduction is ALWAYS Gross Salary / 30
    const penaltyDays = Math.floor(unexcusedLateDays / 3);
    const oneDayGross30 = gross / 30;
    const autoLateDeduction = Math.round(penaltyDays * oneDayGross30);
    // Overtime Rule: ((Basic Salary / 30) / Shift Working Hours) * 1.5
    const shiftWorkingHours = getEmployeeShiftWorkingHours(emp, shifts, roster, selectedMonth, empAtt);
    const defaultOtRate = calculateHourlyOtRate(basic, shiftWorkingHours);
    const autoOvertimeAmount = Math.round(computedOvertimeHours * (((basic / 30) / (shiftWorkingHours || 8)) * 1.5));
    const autoWeekendAllowance = Math.round(computedWeekendDays * oneDayGross30);
    // Absent Deduction is based on Gross Salary / 30 per absent day
    const autoAbsentDeduction = Math.round(computedAbsentDays * oneDayGross30);

    if (monthlyRecords[key]) {
      const rec = monthlyRecords[key];
      const isV2Edited = Boolean(rec.manualOverrideV2);
      const mDays = isV2Edited && rec.totalMonthDays ? rec.totalMonthDays : totalMonthDays;
      const wDays = rec.workingDaysCustomOverride && rec.workingDays ? rec.workingDays : Math.max(0, mDays - autoRosterWeekendDays);
      const aDays = isV2Edited && rec.absentDays !== undefined ? rec.absentDays : computedAbsentDays;
      const pDays = isV2Edited && rec.presentDays !== undefined ? rec.presentDays : computedPresentDays;
      const wkDays = isV2Edited && rec.weekendDays !== undefined ? rec.weekendDays : computedWeekendDays;

      const effBasic = rec.manuallyEdited ? rec.basicSalary : basic;
      const effHouseRent = rec.manuallyEdited ? rec.houseRent : houseRent;
      const effMedical = rec.manuallyEdited ? rec.medical : medical;
      const effConveyance = rec.manuallyEdited ? rec.conveyance : conveyance;
      const effFood = rec.manuallyEdited ? rec.food : food;
      const effBaseGross = effBasic + effHouseRent + effMedical + effConveyance + effFood;

      const effOneDayGross30 = effBaseGross / 30;
      const effShiftHours = rec.shiftWorkingHours && rec.shiftWorkingHours > 0 ? rec.shiftWorkingHours : shiftWorkingHours;
      const effOtRate = (rec.overtimeRateCustomOverride && rec.overtimeRate > 0)
        ? rec.overtimeRate
        : calculateHourlyOtRate(effBasic, effShiftHours);
      const effOtHours = isV2Edited && rec.overtimeHours !== undefined
        ? rec.overtimeHours
        : computedOvertimeHours;
      const exactEffOtRate = rec.overtimeRateCustomOverride && rec.overtimeRate > 0
        ? rec.overtimeRate
        : (((effBasic / 30) / (effShiftHours || 8)) * 1.5);
      const effOtAmount = Math.round(effOtHours * exactEffOtRate);

      // Absent deduction based on Gross Salary / 30
      const gross30AbsentCut = Math.round(aDays * effOneDayGross30);
      const effAbsentDeduction = rec.absentDeductionManualZeroV2
        ? 0
        : (isV2Edited && rec.absentDeduction && rec.absentDeduction > 0)
        ? rec.absentDeduction
        : gross30AbsentCut;

      // Weekend allowance: 1 day = Gross Salary / 30 (for both 30-day and 31-day months)
      const effWeekendAllowance = (isV2Edited && rec.weekendAllowanceManualZero && rec.weekendAllowanceCustomOverride)
        ? 0
        : (rec.weekendAllowanceCustomOverride && rec.weekendAllowance !== undefined && rec.weekendAllowance > 0)
        ? rec.weekendAllowance
        : Math.round(wkDays * effOneDayGross30);

      const currentPf = (rec.manuallyEdited || payrollPolicy.autoPfDeduction) ? (rec.pfDeduction ?? 0) : 0;
      const currentTax = (rec.manuallyEdited || payrollPolicy.autoTaxDeduction) ? (rec.taxDeduction ?? 0) : 0;
      const currentLate = (isV2Edited && rec.lateDeduction !== undefined && rec.lateDeduction > 0)
        ? rec.lateDeduction
        : Math.round(penaltyDays * effOneDayGross30);
      const { autoAdvanceCut, autoLoanCut } = getActiveEmployeeAdvanceInstallments(emp);

      return {
        ...rec,
        basicSalary: effBasic,
        houseRent: effHouseRent,
        medical: effMedical,
        conveyance: effConveyance,
        food: effFood,
        totalMonthDays: mDays,
        workingDays: wDays,
        presentDays: pDays,
        absentDays: aDays,
        weekendDays: wkDays,
        weekendAllowance: effWeekendAllowance,
        overtimeHours: effOtHours,
        overtimeRate: effOtRate,
        overtimeAmount: effOtAmount,
        shiftWorkingHours: effShiftHours,
        absentDeduction: effAbsentDeduction,
        lateDeduction: currentLate,
        advanceDeduction: rec.manuallyEdited ? (rec.advanceDeduction ?? 0) : (rec.advanceDeduction || autoAdvanceCut),
        loanDeduction: rec.manuallyEdited ? (rec.loanDeduction ?? 0) : (rec.loanDeduction || autoLoanCut),
        pfDeduction: currentPf,
        taxDeduction: currentTax,
        customEarningName: rec.customEarningName || '',
        otherAllowance: Number(rec.otherAllowance) || 0,
        customDeductionName: rec.customDeductionName || '',
        otherDeduction: Number(rec.otherDeduction) || 0,
      };
    }

    const overtimeHours = computedOvertimeHours;
    const overtimeRate = defaultOtRate;
    const overtimeAmount = autoOvertimeAmount;
    const weekendDays = computedWeekendDays;
    const weekendAllowance = autoWeekendAllowance;
    const attendanceBonus = emp.attendanceBonus || 0;
    const festivalBonus = 0;
    const otherAllowance = 0;
    const otherDeduction = 0;

    // Corporate Working Days & Attendance
    const absentDays = computedAbsentDays;
    const presentDays = computedPresentDays;

    const absentDeduction = autoAbsentDeduction;
    const lateDeduction = autoLateDeduction;
    const { autoAdvanceCut, autoLoanCut } = getActiveEmployeeAdvanceInstallments(emp);
    const advanceDeduction = autoAdvanceCut;
    const loanDeduction = autoLoanCut;

    // STATUTORY DEDUCTIONS: OFF BY DEFAULT AS REQUESTED
    const pfDeduction = payrollPolicy.autoPfDeduction
      ? Math.round(basic * ((payrollPolicy.pfEmployeePercent || 8.33) / 100))
      : 0;
    const taxDeduction = (payrollPolicy.autoTaxDeduction && basic > 30000)
      ? Math.round(basic * ((payrollPolicy.taxPercent || 5) / 100))
      : 0;

    return {
      employeeId: emp.id,
      month: selectedMonth,
      totalMonthDays,
      workingDays,
      presentDays,
      absentDays,
      weekendDays,
      weekendAllowance,
      basicSalary: basic,
      houseRent,
      medical,
      conveyance,
      food,
      overtimeHours,
      overtimeRate,
      overtimeAmount,
      shiftWorkingHours,
      attendanceBonus,
      festivalBonus,
      customEarningName: '',
      otherAllowance,
      absentDeduction,
      lateDeduction,
      advanceDeduction,
      loanDeduction,
      customDeductionName: '',
      otherDeduction,
      pfDeduction,
      taxDeduction,
      status: 'unpaid',
      paymentMethod: 'Bank Transfer',
    };
  };

  // Full itemized payroll list for all employees
  const processedPayroll = useMemo(() => {
    return employees.map(emp => {
      const record = getPayrollRecord(emp);
      const totalEarnings =
        record.basicSalary +
        record.houseRent +
        record.medical +
        record.conveyance +
        record.food +
        (record.weekendAllowance || 0) +
        record.overtimeAmount +
        record.attendanceBonus +
        record.festivalBonus +
        (record.otherAllowance || 0);

      const totalDeductions =
        record.pfDeduction +
        record.taxDeduction +
        record.absentDeduction +
        record.lateDeduction +
        record.advanceDeduction +
        record.loanDeduction +
        (record.otherDeduction || 0);

      const netSalary = Math.max(0, totalEarnings - totalDeductions);

      return {
        emp,
        record,
        totalEarnings,
        totalDeductions,
        netSalary,
      };
    });
  }, [employees, selectedMonth, monthlyRecords, firestoreAttendance, attendanceRequests, shifts, roster, leaveRequests, payrollPolicy, isMonthLocked, activePayrollRun, salaryAdvancesLoans]);

  // Filtered list based on search and filters
  const filteredPayroll = useMemo(() => {
    return processedPayroll.filter(item => {
      const matchSearch =
        item.emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.emp.employeeId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.emp.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.emp.accountNumber || '').includes(searchQuery);

      const matchDept = deptFilter === 'all' || item.emp.department === deptFilter;
      const matchStatus = statusFilter === 'all' || item.record.status === statusFilter;

      return matchSearch && matchDept && matchStatus;
    });
  }, [processedPayroll, searchQuery, deptFilter, statusFilter]);

  // Overall Statistics
  const stats = useMemo(() => {
    const totalGross = processedPayroll.reduce((sum, p) => sum + p.totalEarnings, 0);
    const totalNet = processedPayroll.reduce((sum, p) => sum + p.netSalary, 0);
    const totalDeductions = processedPayroll.reduce((sum, p) => sum + p.totalDeductions, 0);
    const paidCount = processedPayroll.filter(p => p.record.status === 'paid').length;
    const unpaidCount = processedPayroll.filter(p => p.record.status === 'unpaid').length;
    const onHoldCount = processedPayroll.filter(p => p.record.status === 'on_hold').length;
    const averageNet = employees.length ? Math.round(totalNet / employees.length) : 0;

    return {
      totalGross,
      totalNet,
      totalDeductions,
      paidCount,
      unpaidCount,
      onHoldCount,
      averageNet,
    };
  }, [processedPayroll, employees.length]);

  // Navigate month
  const changeMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const date = new Date(y, m - 1 + delta, 1);
    const nextY = date.getFullYear();
    const nextM = String(date.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${nextY}-${nextM}`);
  };

  // Open Edit Modal for an Employee
  const handleOpenEdit = (emp: Employee) => {
    if (isMonthLocked) {
      showBanner(`Payroll for ${monthLabel} is Finalized & Locked. Unlock the payroll run first if modifications are required.`, 'warn');
      return;
    }
    const record = getPayrollRecord(emp);
    setEditingEmployee(emp);
    setEditFormData({ ...record });
    setUpdateMasterProfile(false);
  };

  // Save Edit Modal
  const handleSaveEdit = async () => {
    if (!editingEmployee || !editFormData) return;

    const workingDays = editFormData.workingDays || 26;
    const absentDays = editFormData.absentDays || 0;
    const presentDays = editFormData.presentDays !== undefined ? editFormData.presentDays : Math.max(0, workingDays - absentDays);
    const weekendDays = editFormData.weekendDays || 0;
    const baseGross =
      (editFormData.basicSalary || 0) +
      (editFormData.houseRent || 0) +
      (editFormData.medical || 0) +
      (editFormData.conveyance || 0) +
      (editFormData.food || 0);
    // 1 day salary = Gross / 30 (for both 30-day and 31-day months)
    const oneDayGross30 = baseGross / 30;

    const computedAbsentDeduction = editFormData.absentDeduction !== undefined
      ? Math.round(Number(editFormData.absentDeduction) || 0)
      : Math.round(oneDayGross30 * absentDays);

    const computedWeekendAllowance = editFormData.weekendAllowanceCustomOverride && editFormData.weekendAllowance !== undefined
      ? Math.round(Number(editFormData.weekendAllowance) || 0)
      : Math.round(oneDayGross30 * weekendDays);

    const effShiftHours = editFormData.shiftWorkingHours || getEmployeeShiftWorkingHours(editingEmployee, shifts, roster, selectedMonth);
    const effOtRate = editFormData.overtimeRateCustomOverride && editFormData.overtimeRate > 0
      ? editFormData.overtimeRate
      : calculateHourlyOtRate(editFormData.basicSalary || 0, effShiftHours);
    const exactOtRate = editFormData.overtimeRateCustomOverride && editFormData.overtimeRate > 0
      ? editFormData.overtimeRate
      : (((editFormData.basicSalary || 0) / 30) / (effShiftHours || 8)) * 1.5;

    const finalRecord: MonthlyPayrollRecord = {
      ...editFormData,
      workingDays,
      workingDaysCustomOverride: Boolean(editFormData.workingDaysCustomOverride),
      absentDays,
      presentDays,
      weekendDays,
      weekendAllowance: computedWeekendAllowance,
      weekendAllowanceManualZero: Boolean(editFormData.weekendAllowanceCustomOverride && weekendDays > 0 && computedWeekendAllowance === 0),
      weekendAllowanceCustomOverride: Boolean(editFormData.weekendAllowanceCustomOverride),
      manuallyEdited: true,
      manualOverrideV2: true,
      shiftWorkingHours: effShiftHours,
      overtimeRate: effOtRate,
      overtimeRateCustomOverride: Boolean(editFormData.overtimeRateCustomOverride),
      overtimeAmount: Math.round((editFormData.overtimeHours || 0) * exactOtRate),
      absentDeduction: computedAbsentDeduction,
      absentDeductionManualZero: absentDays > 0 && computedAbsentDeduction === 0,
      absentDeductionManualZeroV2: absentDays > 0 && computedAbsentDeduction === 0,
      customEarningName: (editFormData.customEarningName || '').trim(),
      otherAllowance: Math.round(Number(editFormData.otherAllowance) || 0),
      customDeductionName: (editFormData.customDeductionName || '').trim(),
      otherDeduction: Math.round(Number(editFormData.otherDeduction) || 0),
    };

    const key = `${selectedMonth}_${editingEmployee.id}`;
    setMonthlyRecords(prev => ({
      ...prev,
      [key]: finalRecord,
    }));

    // Optionally update master employee profile
    if (updateMasterProfile) {
      const newGross =
        finalRecord.basicSalary +
        finalRecord.houseRent +
        finalRecord.medical +
        finalRecord.conveyance +
        finalRecord.food;

      await updateEmployee(editingEmployee.id, {
        basicSalary: finalRecord.basicSalary,
        basic: finalRecord.basicSalary,
        houseRent: finalRecord.houseRent,
        medical: finalRecord.medical,
        transport: finalRecord.conveyance,
        conveyance: finalRecord.conveyance,
        food: finalRecord.food,
        grossSalary: newGross,
        attendanceBonus: finalRecord.attendanceBonus,
      });
    }

    addNotification({
      title: 'Salary Record Updated',
      message: `Updated payroll details for ${editingEmployee.name} (${selectedMonth})`,
      read: false,
      type: 'payroll',
      targetPage: 'payroll',
    });

    setEditingEmployee(null);
    setEditFormData(null);
  };

  // Quick toggle status for single employee
  const handleToggleStatus = (empId: string, currentStatus: 'paid' | 'unpaid' | 'on_hold') => {
    const key = `${selectedMonth}_${empId}`;
    const current = monthlyRecords[key] || getPayrollRecord(employees.find(e => e.id === empId)!);
    const nextStatus = currentStatus === 'paid' ? 'unpaid' : 'paid';

    setMonthlyRecords(prev => ({
      ...prev,
      [key]: {
        ...current,
        status: nextStatus,
        paymentDate: nextStatus === 'paid' ? new Date().toISOString().split('T')[0] : undefined,
      },
    }));
  };

  // Disburse All Action
  const handleDisburseAll = () => {
    const today = new Date().toISOString().split('T')[0];
    const updated = { ...monthlyRecords };

    employees.forEach(emp => {
      const key = `${selectedMonth}_${emp.id}`;
      const existing = updated[key] || getPayrollRecord(emp);
      if (existing.status !== 'paid') {
        updated[key] = {
          ...existing,
          status: 'paid',
          paymentDate: today,
          paymentMethod: batchPaymentMethod,
          transactionRef: `BATCH-SAL-${selectedMonth.replace('-', '')}-${emp.employeeId}`,
        };
      }
    });

    setMonthlyRecords(updated);
    setShowDisburseAllModal(false);

    addNotification({
      title: 'Salaries Disbursed',
      message: `Disbursed salaries for all eligible employees for month ${selectedMonth}`,
      read: false,
      type: 'payroll',
      targetPage: 'payroll',
    });
  };

  // Festival Bonus Quick Tool
  const handleApplyFestivalBonus = () => {
    const updated = { ...monthlyRecords };
    let count = 0;

    employees.forEach(emp => {
      if (bonusDept === 'all' || emp.department === bonusDept) {
        const key = `${selectedMonth}_${emp.id}`;
        const existing = updated[key] || getPayrollRecord(emp);
        const bonusAmount =
          bonusAmountType === 'percent'
            ? Math.round(existing.basicSalary * (bonusValue / 100))
            : bonusValue;

        updated[key] = {
          ...existing,
          festivalBonus: bonusAmount,
        };
        count++;
      }
    });

    setMonthlyRecords(updated);
    setShowBonusModal(false);

    addNotification({
      title: 'Festival Bonus Applied',
      message: `Applied ${bonusAmountType === 'percent' ? `${bonusValue}% of Basic` : `৳${bonusValue}`} bonus to ${count} employees`,
      read: false,
      type: 'payroll',
      targetPage: 'payroll',
    });
  };

  // Export CSV Sheet for Bank Transfer
  const exportSalarySheetCSV = () => {
    const headers = [
      'SL',
      'Employee ID',
      'Employee Name',
      'Department',
      'Designation',
      'Bank Name',
      'Account Number',
      'Total Monthly Days',
      'Total Working Days',
      'Total Present Days',
      'Total Absent Days',
      'Basic Salary',
      'House Rent',
      'Medical',
      'Conveyance',
      'Food Allowance',
      'Overtime Pay',
      'Attendance Bonus',
      'Festival Bonus',
      'Gross Earnings',
      'Provident Fund',
      'Tax (TDS)',
      'Absent Deduction',
      'Other Deductions',
      'Total Deductions',
      'Net Payable (BDT)',
      'Payment Status',
      'Payment Method',
      'Payment Date',
      'Reference ID'
    ];

    const rows = filteredPayroll.map((item, index) => {
      const r = item.record;
      return [
        index + 1,
        `"${item.emp.employeeId}"`,
        `"${item.emp.name}"`,
        `"${item.emp.department}"`,
        `"${item.emp.designation}"`,
        `"${item.emp.bankName || 'N/A'}"`,
        `"${item.emp.accountNumber || 'N/A'}"`,
        r.totalMonthDays,
        r.workingDays,
        r.presentDays,
        r.absentDays,
        r.basicSalary,
        r.houseRent,
        r.medical,
        r.conveyance,
        r.food,
        r.overtimeAmount,
        r.attendanceBonus,
        r.festivalBonus,
        item.totalEarnings,
        r.pfDeduction,
        r.taxDeduction,
        r.absentDeduction,
        r.lateDeduction + r.advanceDeduction + r.loanDeduction,
        item.totalDeductions,
        item.netSalary,
        r.status.toUpperCase(),
        `"${r.paymentMethod}"`,
        `"${r.paymentDate || '-'}"`,
        `"${r.transactionRef || '-'}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Salary_Sheet_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Notification banner for instant feedback
  const [bannerNotice, setBannerNotice] = useState<{ text: string; type: 'success' | 'info' | 'warn' } | null>(null);

  const showBanner = (text: string, type: 'success' | 'info' | 'warn' = 'success') => {
    setBannerNotice({ text, type });
    setTimeout(() => {
      setBannerNotice(null);
    }, 4500);
  };

  // Month formatted nicely (e.g. September 2026)
  const monthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [selectedMonth]);

  // Generate self-contained, high-fidelity printable HTML for payslips
  const generatePayslipPrintHtml = (emp: Employee, rec: MonthlyPayrollRecord) => {
    const modalEl = document.getElementById('payslip-modal-content');
    const content = modalEl ? modalEl.innerHTML : '<p>Payslip document content unavailable.</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payslip - ${emp.name} - ${monthLabel}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      font-size: 12px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .print-banner-bar {
      margin-bottom: 20px;
      padding: 12px 18px;
      background: #0f172a;
      color: #ffffff;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .btn-print-doc {
      background: #4f46e5;
      color: #ffffff;
      border: none;
      padding: 8px 18px;
      font-weight: 700;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-print-doc:hover {
      background: #4338ca;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    .font-mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    @media print {
      .no-print, .print-banner-bar {
        display: none !important;
      }
      body {
        padding: 0 !important;
        margin: 0 !important;
      }
    }
  </style>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div class="print-banner-bar no-print">
    <div>
      <span style="font-weight: 800; font-size: 14px;">WorkNest HRMS — Official Payslip</span>
      <span style="opacity: 0.8; margin-left: 10px; font-size: 12px;">${emp.name} (${emp.employeeId}) • ${monthLabel}</span>
    </div>
    <button class="btn-print-doc" onclick="window.print()">
      🖨️ Print / Save as PDF
    </button>
  </div>
  <div class="payslip-wrapper">
    ${content}
  </div>
  <script>
    // Auto-focus window for convenience
    window.onload = function() {
      window.focus();
    };
  </script>
</body>
</html>`;
  };

  // Robust print handling: attempts the native (APK) print dialog first, then
  // iframe, then popup.
  const handlePrintPayslip = async () => {
    if (!payslipEmployee) return;
    const record = getPayrollRecord(payslipEmployee);
    const html = generatePayslipPrintHtml(payslipEmployee, record);

    // Inside the APK the WebView implements neither iframe printing nor
    // window.open(), so hand the payslip to Android's print framework.
    if (await printHtmlDocument(html, `Payslip - ${payslipEmployee.name}`)) {
      return;
    }

    try {
      const existing = document.getElementById('worknest-print-iframe');
      if (existing) existing.remove();

      const iframe = document.createElement('iframe');
      iframe.id = 'worknest-print-iframe';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      iframe.style.zIndex = '-9999';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();

        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch (e) {
            console.warn('Iframe print failed, falling back to clean popup window', e);
            handleOpenCleanPrintWindow();
          }
        }, 400);
        return;
      }
    } catch (err) {
      console.warn('Iframe print setup error', err);
    }

    // Fallback: Open popup print window
    handleOpenCleanPrintWindow();
  };

  // Open clean standalone print window
  const handleOpenCleanPrintWindow = async () => {
    if (!payslipEmployee) return;
    const record = getPayrollRecord(payslipEmployee);
    const html = generatePayslipPrintHtml(payslipEmployee, record);

    // On Android a popup cannot be opened; go straight to the native print dialog.
    if (await printHtmlDocument(html, `Payslip - ${payslipEmployee.name}`)) {
      return;
    }

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank', 'width=880,height=960,toolbar=0,scrollbars=1,status=0');
    if (!printWindow) {
      // Popups may be blocked by iframe, trigger direct window print
      window.print();
    }
  };

  // Download payslip as standalone HTML file (opens in any browser and prints/saves PDF)
  const handleDownloadPayslipHtml = () => {
    if (!payslipEmployee) return;
    const record = getPayrollRecord(payslipEmployee);
    const html = generatePayslipPrintHtml(payslipEmployee, record);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Payslip_${payslipEmployee.employeeId}_${monthLabel.replace(/\s+/g, '_')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showBanner(`Downloaded Payslip for ${payslipEmployee.name} (${monthLabel})`, 'success');
  };

  // Reset uncustomized automatic PF & Tax to ৳0 for the current month
  const handleResetUncustomizedDeductions = () => {
    let resetCount = 0;
    const updated = { ...monthlyRecords };
    employees.forEach(emp => {
      const key = `${selectedMonth}_${emp.id}`;
      const existing = updated[key];
      if (!existing || !existing.manuallyEdited) {
        const base = existing || getPayrollRecord(emp);
        updated[key] = {
          ...base,
          pfDeduction: 0,
          taxDeduction: 0,
        };
        resetCount++;
      }
    });
    setMonthlyRecords(updated);
    showBanner(`Reset automatic PF & Tax to ৳0 for ${resetCount} employees in ${monthLabel}. Custom manual deductions preserved.`, 'success');
  };

  // Generate Month-End Payroll and publish payslips
  const handleGenerateMonthEndPayroll = async () => {
    if (isMonthLocked) {
      showBanner(`Payroll for ${monthLabel} is Locked & Finalized. Historical finalized payroll cannot be overwritten by recalculation.`, 'warn');
      return;
    }
    setIsGeneratingMonthEnd(true);
    try {
      await generateMonthEndPayroll(selectedMonth, `Generated on ${monthLabel} final day`);
      showBanner(`Month-End Payroll for ${monthLabel} generated and payslips published successfully!`, 'success');
    } catch (e: any) {
      showBanner(`Failed to generate payroll: ${e?.message || 'Error'}`, 'warn');
    } finally {
      setIsGeneratingMonthEnd(false);
    }
  };

  // Phase 2: Approve Payroll Run
  const handleApprovePayrollRun = async () => {
    await approveMonthlyPayrollRun(selectedMonth, `Approved on ${new Date().toISOString().split('T')[0]}`);
    showBanner(`Payroll Run for ${monthLabel} has been formally Approved!`, 'success');
  };

  // Phase 2: Finalize & Lock Payroll Run (Immutable Snapshot)
  const handleFinalizeAndLockPayroll = async () => {
    setIsFinalizingRun(true);
    try {
      const snapshotsMap: Record<string, any> = {};
      processedPayroll.forEach(({ emp, record, totalEarnings, totalDeductions, netSalary }) => {
        snapshotsMap[emp.id] = {
          ...record,
          totalEarnings,
          totalDeductions,
          netSalary,
        };
        if (emp.employeeId) {
          snapshotsMap[emp.employeeId] = snapshotsMap[emp.id];
        }
      });

      await lockMonthlyPayrollRun(
        selectedMonth,
        snapshotsMap,
        {
          gross: stats.totalGross,
          deductions: stats.totalDeductions,
          net: stats.totalNet,
        },
        `Finalized & Locked on ${new Date().toISOString().split('T')[0]}`
      );

      showBanner(`Payroll for ${monthLabel} is now Finalized & Locked! Historical snapshot is protected against recalculation.`, 'success');
    } catch (e: any) {
      showBanner(`Error finalizing payroll: ${e?.message || 'Error'}`, 'warn');
    } finally {
      setIsFinalizingRun(false);
    }
  };

  // Phase 2: Unlock Payroll Run (Admin override with audit log)
  const handleUnlockPayroll = async () => {
    if (!activePayrollRun) return;
    await unlockMonthlyPayrollRun(selectedMonth, `Admin unlocked ${selectedMonth} payroll for authorized adjustment`);
    showBanner(`Payroll Run for ${monthLabel} unlocked for adjustments. Action recorded in Audit Log.`, 'info');
  };

  // Phase 2: Create New Salary Advance / Loan
  const handleCreateAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find(x => x.id === advanceForm.employeeId || x.employeeId === advanceForm.employeeId);
    if (!emp || advanceForm.principalAmount <= 0) return;

    const installments = Math.max(1, Number(advanceForm.totalInstallments) || 1);
    const monthlyEmi = Math.round(Number(advanceForm.principalAmount) / installments);

    await saveSalaryAdvanceLoan({
      employeeId: emp.id,
      employeeName: emp.name,
      department: emp.department,
      type: advanceForm.type,
      principalAmount: Number(advanceForm.principalAmount),
      monthlyInstallment: monthlyEmi,
      totalInstallments: installments,
      paidInstallments: 0,
      remainingBalance: Number(advanceForm.principalAmount),
      startMonth: advanceForm.startMonth || selectedMonth,
      reason: advanceForm.reason.trim() || `${advanceForm.type.toUpperCase()} issued via Payroll`,
      status: 'active',
    });

    showBanner(`Issued ৳${Number(advanceForm.principalAmount).toLocaleString()} ${advanceForm.type} to ${emp.name} (EMI: ৳${monthlyEmi.toLocaleString()}/mo)`, 'success');
    setAdvanceForm({
      employeeId: '',
      type: 'advance',
      principalAmount: 10000,
      monthlyInstallment: 2500,
      totalInstallments: 4,
      startMonth: selectedMonth,
      reason: '',
    });
  };

  return (
    <div className="space-y-6">
      {/* Dynamic Feedback Toast Banner */}
      {bannerNotice && (
        <div className={`p-4 rounded-xl shadow-md border flex items-center justify-between text-xs font-semibold ${
          bannerNotice.type === 'success'
            ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
            : bannerNotice.type === 'warn'
            ? 'bg-amber-50 text-amber-900 border-amber-300'
            : 'bg-indigo-50 text-indigo-900 border-indigo-300'
        }`}>
          <div className="flex items-center space-x-2">
            <span>{bannerNotice.type === 'success' ? '✅' : bannerNotice.type === 'warn' ? '⚠️' : 'ℹ️'}</span>
            <span>{bannerNotice.text}</span>
          </div>
          <button
            onClick={() => setBannerNotice(null)}
            className="text-slate-400 hover:text-slate-700 text-sm ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Print Styles for Payslip fallback */}
      <style>{`
        @media print {
          html, body {
            overflow: visible !important;
            height: auto !important;
            background: white !important;
          }
          body * {
            visibility: hidden;
          }
          #payslip-modal-content, #payslip-modal-content * {
            visibility: visible;
          }
          #payslip-modal-content {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 10px !important;
            background: white !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Payroll &amp; Salary Management</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Process monthly payroll, generate payslips, configure earnings &amp; deductions, and export bank transfer sheets
          </p>
        </div>

        {/* Month selector & Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Month Navigation */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
            <button
              onClick={() => changeMonth(-1)}
              title="Previous Month"
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-xs font-bold cursor-pointer"
            >
              ◀
            </button>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="px-2 py-1 text-xs font-bold text-slate-800 bg-transparent border-none focus:outline-none cursor-pointer"
            />
            <button
              onClick={() => changeMonth(1)}
              title="Next Month"
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-xs font-bold cursor-pointer"
            >
              ▶
            </button>
          </div>

          {/* Month Working Days Policy Badge */}
          {(() => {
            const { totalMonthDays, defaultWorkingDays, defaultOffDays } = getMonthDaysInfo(selectedMonth);
            return (
              <div
                className="hidden lg:flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50/80 border border-indigo-200/80 rounded-xl text-xs text-indigo-950 shadow-2xs"
                title={`Company Policy: 30-day month = 26 Working Days, 31-day month = 27 Working Days`}
              >
                <span className="font-extrabold text-indigo-700">{totalMonthDays}d Month</span>
                <span className="text-indigo-300">|</span>
                <span className="font-bold text-indigo-900">{defaultWorkingDays} Working Days</span>
                <span className="text-indigo-300">|</span>
                <span className="text-slate-500 font-medium">{defaultOffDays}d Off</span>
              </div>
            );
          })()}

          {/* Statutory PF & Tax Deduction Control Button */}
          <button
            id="btn-payroll-deductions-settings"
            onClick={() => setShowDeductionPolicyModal(true)}
            className={`px-3 py-2 border rounded-xl shadow-2xs font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer ${
              !payrollPolicy.autoPfDeduction && !payrollPolicy.autoTaxDeduction
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
            }`}
            title="Configure whether PF and Income Tax are deducted automatically or handled manually"
          >
            <span>⚖️</span>
            <span>
              PF/Tax: {!payrollPolicy.autoPfDeduction && !payrollPolicy.autoTaxDeduction ? 'Manual (Off)' : 'Auto Deduct'}
            </span>
          </button>

          {/* Festival Bonus Quick Button */}
          <button
            id="btn-payroll-bonus"
            onClick={() => {
              if (isMonthLocked) {
                showBanner(`Cannot apply bonus: ${monthLabel} payroll is Locked & Finalized.`, 'warn');
                return;
              }
              setShowBonusModal(true);
            }}
            className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-2xs font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <span>🎁</span>
            <span>Add Bonus</span>
          </button>

          {/* Salary Advances & Loans Button */}
          <button
            id="btn-payroll-advances"
            onClick={() => setShowAdvancesModal(true)}
            className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-2xs font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <span>🏦</span>
            <span>Advances &amp; Loans ({salaryAdvancesLoans.filter(a => a.status === 'active').length})</span>
          </button>

          {/* Payroll History & Runs Button */}
          <button
            id="btn-payroll-history"
            onClick={() => setShowPayrollHistoryModal(true)}
            className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl shadow-2xs font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <span>📜</span>
            <span>Payroll History ({payrollRunsList.length})</span>
          </button>

          {/* Export CSV Button */}
          <button
            id="btn-payroll-export"
            onClick={exportSalarySheetCSV}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl shadow-2xs font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <span>📊</span>
            <span>Export CSV</span>
          </button>

          {/* Disburse All Button */}
          <button
            id="btn-payroll-disburse-all"
            onClick={() => setShowDisburseAllModal(true)}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-2xs font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <span>💳</span>
            <span>Disburse All</span>
          </button>
        </div>
      </div>

      {/* Month-End Payroll Generation & Payslip Publishing Banner */}
      <div className={`p-4 sm:p-5 rounded-2xl border transition-all ${
        monthlyPayrollRuns[selectedMonth]?.status === 'published'
          ? 'bg-gradient-to-r from-emerald-50 to-teal-50/50 border-emerald-200/80 shadow-xs'
          : 'bg-gradient-to-r from-indigo-50/80 to-blue-50/40 border-indigo-200/80 shadow-xs'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-900">
                Month-End Payroll &amp; Official Payslip Status ({monthLabel})
              </span>
              {monthlyPayrollRuns[selectedMonth]?.status === 'published' ? (
                <span className="px-3 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center space-x-1">
                  <span>✅</span>
                  <span>Generated &amp; Published to Employees</span>
                </span>
              ) : (
                <span className="px-3 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center space-x-1">
                  <span>⏳</span>
                  <span>Pending Month-End Generation</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600">
              {monthlyPayrollRuns[selectedMonth]?.status === 'published'
                ? `Published by ${monthlyPayrollRuns[selectedMonth]?.publishedBy || 'HR Admin'}. Employees can now view and print their official monthly salary payslip in their employee portal.`
                : 'Generates finalized month-end payroll and releases official payslips for employees to view on the last day of the month. Includes 3-day late attendance salary waiver calculations.'}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-slate-500">
              <span>
                • <strong>Late &amp; Absent Rule:</strong> 3 unexcused late days = 1 day Gross Salary cut (Gross ÷ 30); Absent deduction = Gross ÷ 30 per day.
              </span>
              <span className="text-emerald-700 font-semibold">
                • Approved late requests waive penalty.
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isMonthLocked ? (
              <>
                <span className="px-3 py-2 rounded-xl text-xs font-extrabold bg-slate-900 text-amber-300 border border-slate-700 flex items-center space-x-1.5 shadow-xs">
                  <span>🔒</span>
                  <span>Finalized &amp; Locked (Protected Snapshot)</span>
                </span>
                <button
                  type="button"
                  onClick={handleUnlockPayroll}
                  className="px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 transition-all cursor-pointer"
                  title="Unlock payroll run for authorized admin adjustment (logged in Audit Trail)"
                >
                  🔓 Unlock Run
                </button>
              </>
            ) : (
              <>
                {activePayrollRun?.approvalStatus !== 'approved' && (
                  <button
                    type="button"
                    onClick={handleApprovePayrollRun}
                    className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer flex items-center space-x-1.5"
                  >
                    <span>✓</span>
                    <span>Approve Payroll</span>
                  </button>
                )}
                {activePayrollRun?.approvalStatus === 'approved' && (
                  <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    ✓ Approved by {activePayrollRun.approvedBy || 'Admin'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleFinalizeAndLockPayroll}
                  disabled={isFinalizingRun}
                  className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition-all cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
                  title="Lock and finalize this month's payroll so future recalculations never alter historical numbers"
                >
                  <span>🔒</span>
                  <span>{isFinalizingRun ? 'Locking...' : 'Finalize & Lock Payroll'}</span>
                </button>
                <button
                  onClick={handleGenerateMonthEndPayroll}
                  disabled={isGeneratingMonthEnd}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-all cursor-pointer flex items-center space-x-2 ${
                    monthlyPayrollRuns[selectedMonth]?.status === 'published'
                      ? 'bg-slate-700 hover:bg-slate-800'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  } disabled:opacity-50`}
                >
                  {isGeneratingMonthEnd ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <span>⚡</span>
                      <span>
                        {monthlyPayrollRuns[selectedMonth]?.status === 'published'
                          ? 'Re-generate Payslips'
                          : 'Publish Payslips'}
                      </span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
        <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Gross Payroll</p>
          <p className="text-lg sm:text-xl font-extrabold text-indigo-700 mt-1">৳ {stats.totalGross.toLocaleString()}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">Base + Allowances</p>
        </div>

        <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Deductions</p>
          <p className="text-lg sm:text-xl font-extrabold text-rose-600 mt-1">৳ {stats.totalDeductions.toLocaleString()}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">PF, Tax &amp; Penalties</p>
        </div>

        <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider">Net Disbursable</p>
          <p className="text-lg sm:text-xl font-extrabold text-emerald-600 mt-1">৳ {stats.totalNet.toLocaleString()}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">Take-home total</p>
        </div>

        <div className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider">Disbursement Progress</p>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-lg sm:text-xl font-extrabold text-slate-800">
              {stats.paidCount} / {employees.length}
            </span>
            <span className="text-xs font-bold text-emerald-600">
              {employees.length ? Math.round((stats.paidCount / employees.length) * 100) : 0}% Paid
            </span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all"
              style={{ width: `${employees.length ? (stats.paidCount / employees.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        <div className="col-span-2 lg:col-span-1 p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider">Average Net Salary</p>
          <p className="text-lg sm:text-xl font-extrabold text-slate-800 mt-1">৳ {stats.averageNet.toLocaleString()}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">Per Employee Average</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-2xs border border-slate-200 grid grid-cols-1 md:grid-cols-5 gap-2.5 sm:gap-3">
        <div className="md:col-span-2">
          <input
            type="text"
            placeholder="🔍 Search by name, ID, branch, department..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm"
          />
        </div>
        <div>
          <select
            value={activeBranch}
            onChange={e => setActiveBranch(e.target.value)}
            className="w-full px-3.5 py-2 bg-indigo-50/70 border border-indigo-200 rounded-xl font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm"
          >
            <option value="All">🏢 All Offices ({allEmployees.length})</option>
            {branches.map(b => {
              const count = allEmployees.filter(emp => getEmployeeBranch(emp) === b.name).length;
              return (
                <option key={b.id} value={b.name}>
                  {b.isHeadOffice ? '🏢 ' : '📍 '}{b.name} ({count})
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm"
          >
            <option value="all">All Departments ({departments.length})</option>
            {departments.map(d => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm"
          >
            <option value="all">All Statuses ({employees.length})</option>
            <option value="paid">Paid ({stats.paidCount})</option>
            <option value="unpaid">Unpaid / Pending ({stats.unpaidCount})</option>
            <option value="on_hold">On Hold ({stats.onHoldCount})</option>
          </select>
        </div>
      </div>

      {/* Main Payroll Table */}
      <div className="bg-white rounded-2xl shadow-2xs border border-slate-200 overflow-hidden">
        <div className="p-3.5 sm:p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <h3 className="font-bold text-slate-800 text-sm sm:text-base">
              Salary Sheet for {monthLabel}
            </h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold">
              {filteredPayroll.length} Employees
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            Click <strong>"Payslip"</strong> or <strong>"Edit"</strong> to view
          </span>
        </div>

        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-xs sm:text-sm min-w-[860px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">EMPLOYEE</th>
                <th className="px-4 py-3 text-left font-semibold">ATTENDANCE</th>
                <th className="px-4 py-3 text-left font-semibold">BASIC</th>
                <th className="px-4 py-3 text-left font-semibold">ALLOWANCES</th>
                <th className="px-4 py-3 text-left font-semibold">OT / BONUS</th>
                <th className="px-4 py-3 text-left font-semibold">GROSS</th>
                <th className="px-4 py-3 text-left font-semibold">DEDUCTIONS</th>
                <th className="px-4 py-3 text-left font-semibold">NET PAYABLE</th>
                <th className="px-4 py-3 text-center font-semibold">STATUS</th>
                <th className="px-4 py-3 text-right font-semibold">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPayroll.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-slate-400">
                    <div className="text-4xl mb-2">📋</div>
                    <p className="font-semibold text-slate-600">No payroll records found</p>
                    <p className="text-xs text-slate-400 mt-1">Try changing search keyword or filters</p>
                  </td>
                </tr>
              ) : (
                filteredPayroll.map(item => {
                  const { emp, record, totalEarnings, totalDeductions, netSalary } = item;
                  const allowancesTotal = record.houseRent + record.medical + record.conveyance + record.food;
                  const otAndBonusTotal =
                    (record.weekendAllowance || 0) +
                    record.overtimeAmount +
                    record.attendanceBonus +
                    record.festivalBonus +
                    (record.otherAllowance || 0);

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Employee Info */}
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-sm shadow-xs overflow-hidden shrink-0">
                            {emp.avatar && (emp.avatar.startsWith('data:image/') || emp.avatar.startsWith('http://') || emp.avatar.startsWith('https://')) ? (
                              <img src={emp.avatar} alt={emp.name} className="w-full h-full object-cover" />
                            ) : (
                              emp.avatar && emp.avatar.length <= 4 ? emp.avatar : (emp.name ? emp.name.charAt(0).toUpperCase() : '👤')
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-slate-800">{emp.name}</div>
                            <div className="text-xs text-slate-400">
                              {emp.employeeId} • {emp.department}
                            </div>
                            <div className="text-[11px] font-semibold text-indigo-600 mt-0.5">
                              🏢 {getEmployeeBranch(emp)}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Attendance / Days */}
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs font-bold text-slate-800">
                          <span className="text-emerald-700">{record.presentDays}</span> / {record.workingDays}d Present
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {record.totalMonthDays}d Month {record.absentDays > 0 ? (
                            <span className="text-rose-600 font-semibold">• {record.absentDays}d Absent</span>
                          ) : (
                            <span className="text-emerald-600 font-medium">• Full</span>
                          )}
                        </div>
                      </td>

                      {/* Basic */}
                      <td className="px-4 py-3 font-mono font-medium text-slate-700">
                        ৳ {record.basicSalary.toLocaleString()}
                      </td>

                      {/* Allowances */}
                      <td className="px-4 py-3 font-mono text-slate-600" title={`House: ${record.houseRent}, Med: ${record.medical}, Conv: ${record.conveyance}`}>
                        ৳ {allowancesTotal.toLocaleString()}
                      </td>

                      {/* OT & Bonus */}
                      <td className="px-4 py-3 font-mono">
                        {otAndBonusTotal > 0 ? (
                          <span className="text-purple-700 font-semibold">
                            +৳ {otAndBonusTotal.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* Gross */}
                      <td className="px-4 py-3 font-mono font-bold text-indigo-700">
                        ৳ {totalEarnings.toLocaleString()}
                      </td>

                      {/* Deductions */}
                      <td className="px-4 py-3 font-mono font-medium text-rose-600">
                        <div>-৳ {totalDeductions.toLocaleString()}</div>
                        {(record.absentDeduction > 0 || record.lateDeduction > 0) && (
                          <div className="text-[10px] text-rose-500 font-sans mt-0.5 space-x-1">
                            {record.absentDeduction > 0 && (
                              <span>Abs({record.absentDays}d): -৳{record.absentDeduction.toLocaleString()}</span>
                            )}
                            {record.lateDeduction > 0 && (
                              <span>• Late: -৳{record.lateDeduction.toLocaleString()}</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Net Payable */}
                      <td className="px-4 py-3 font-mono font-extrabold text-emerald-700 text-base">
                        ৳ {netSalary.toLocaleString()}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggleStatus(emp.id, record.status)}
                          className={`text-xs px-2.5 py-1 rounded-full font-bold transition-all ${
                            record.status === 'paid'
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                              : record.status === 'on_hold'
                              ? 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                              : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                          }`}
                          title="Click to toggle Paid / Unpaid"
                        >
                          {record.status === 'paid' ? '✓ Paid' : record.status === 'on_hold' ? 'On Hold' : 'Pending'}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          {/* Payslip View Button */}
                          <button
                            id={`btn-payslip-${emp.id}`}
                            onClick={() => setPayslipEmployee(emp)}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition-all flex items-center space-x-1"
                            title="Generate Official Payslip"
                          >
                            <span>📄</span>
                            <span>Payslip</span>
                          </button>

                          {/* Edit Payroll Components Button */}
                          <button
                            id={`btn-edit-payroll-${emp.id}`}
                            onClick={() => handleOpenEdit(emp)}
                            className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1"
                            title="Edit components for this employee"
                          >
                            <span>✏️</span>
                            <span>Edit</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: OFFICIAL PRINTABLE & DOWNLOADABLE PAYSLIP                        */}
      {/* ========================================================================= */}
      {payslipEmployee && (() => {
        const record = getPayrollRecord(payslipEmployee);
        const totalEarnings =
          record.basicSalary +
          record.houseRent +
          record.medical +
          record.conveyance +
          record.food +
          (record.weekendAllowance || 0) +
          record.overtimeAmount +
          record.attendanceBonus +
          record.festivalBonus +
          (record.otherAllowance || 0);

        const totalDeductions =
          record.pfDeduction +
          record.taxDeduction +
          record.absentDeduction +
          record.lateDeduction +
          record.advanceDeduction +
          record.loanDeduction +
          (record.otherDeduction || 0);

        const netSalary = Math.max(0, totalEarnings - totalDeductions);
        const salaryInWords = numberToWords(netSalary);

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200 flex flex-col">
              {/* Modal Top Actions (Hidden in Print) */}
              <div className="p-4 border-b border-slate-200 flex items-center justify-between no-print bg-slate-50 rounded-t-2xl">
                <div className="flex items-center space-x-2">
                  <span className="text-xl">📄</span>
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">Official Employee Payslip</h3>
                    <p className="text-xs text-slate-500">Period: {monthLabel}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Primary Print Button */}
                  <button
                    id="btn-print-payslip-primary"
                    onClick={handlePrintPayslip}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center space-x-1.5 transition-all cursor-pointer"
                    title="Print Payslip directly"
                  >
                    <span>🖨️</span>
                    <span>Print Payslip</span>
                  </button>

                  {/* Clean Tab/Window Print Fallback */}
                  <button
                    id="btn-print-clean-window"
                    onClick={handleOpenCleanPrintWindow}
                    className="px-3 py-2 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 rounded-xl text-xs font-semibold flex items-center space-x-1 transition-all cursor-pointer"
                    title="Open in a dedicated print window / tab"
                  >
                    <span>↗️</span>
                    <span>Print Window</span>
                  </button>

                  {/* Download HTML/PDF File */}
                  <button
                    id="btn-download-payslip-file"
                    onClick={handleDownloadPayslipHtml}
                    className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-1 transition-all cursor-pointer"
                    title="Download standalone payslip HTML document (opens in any browser and prints/saves PDF)"
                  >
                    <span>📥</span>
                    <span>Download</span>
                  </button>

                  {/* Edit Individual Amounts */}
                  <button
                    onClick={() => {
                      handleOpenEdit(payslipEmployee);
                      setPayslipEmployee(null);
                    }}
                    className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                    title="Manually adjust salary, PF, Tax, or deductions for this employee"
                  >
                    <span>✏️ Edit Amounts</span>
                  </button>

                  {/* Close Modal */}
                  <button
                    onClick={() => setPayslipEmployee(null)}
                    className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 text-lg cursor-pointer ml-1"
                    title="Close Payslip"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* PAYSLIP DOCUMENT CONTAINER (This gets printed) */}
              <div id="payslip-modal-content" className="p-8 bg-white space-y-6 text-slate-800">
                {/* Header with Company Logo & Name */}
                <div className="flex items-start justify-between border-b-2 border-slate-800 pb-5">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white font-black text-2xl flex items-center justify-center shadow-xs">
                      W
                    </div>
                    <div>
                      <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                        {companyInfo.companyName || 'WorkNest Technologies Ltd.'}
                      </h1>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {companyInfo.address || 'Gulshan-2, Dhaka-1212, Bangladesh'}
                      </p>
                      <p className="text-xs text-slate-500">
                        Email: {companyInfo.email || 'hr@worknest.com'} • Phone: {companyInfo.phone || '+880 1700-000000'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-block px-3 py-1 bg-slate-100 border border-slate-300 rounded-md font-bold text-xs uppercase tracking-wider text-slate-800">
                      Payslip
                    </span>
                    <p className="text-xs font-semibold text-slate-700 mt-2">
                      Pay Period: <span className="font-bold text-indigo-700">{monthLabel}</span>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Ref: PS-{selectedMonth.replace('-', '')}-{payslipEmployee.employeeId}
                    </p>
                  </div>
                </div>

                {/* Employee Meta Details Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Employee Name</span>
                    <span className="font-bold text-slate-900 text-sm">{payslipEmployee.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Employee ID</span>
                    <span className="font-mono font-bold text-indigo-700">{payslipEmployee.employeeId}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Department</span>
                    <span className="font-semibold text-slate-800">{payslipEmployee.department}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Designation</span>
                    <span className="font-semibold text-slate-800">{payslipEmployee.designation}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Date of Joining</span>
                    <span className="text-slate-700">{payslipEmployee.joinDate || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Bank Name</span>
                    <span className="text-slate-700">{payslipEmployee.bankName || 'Standard Bank Ltd.'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Account No.</span>
                    <span className="font-mono text-slate-700">{payslipEmployee.accountNumber || '•••••••• 4921'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Payment Mode</span>
                    <span className="font-bold text-indigo-700">{record.paymentMethod}</span>
                  </div>
                </div>

                {/* Attendance & Monthly Working Days Summary Banner */}
                <div className="p-4 bg-indigo-50/60 border border-indigo-100 rounded-xl">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-950 flex items-center space-x-1.5">
                      <span>📅</span>
                      <span>Attendance &amp; Monthly Working Summary</span>
                    </span>
                    <span className="text-[11px] font-semibold text-indigo-700 bg-white px-2.5 py-0.5 rounded-md border border-indigo-200 shadow-2xs">
                      Off / Weekend Days: {Math.max(0, record.totalMonthDays - record.workingDays)} Days
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Monthly Days</span>
                      <span className="text-base font-extrabold font-mono text-slate-800">
                        {record.totalMonthDays} Days
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Calendar Days</span>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-indigo-200 shadow-2xs bg-indigo-50/30">
                      <span className="text-[10px] uppercase font-bold text-indigo-600 block">Total Working Days</span>
                      <span className="text-base font-extrabold font-mono text-indigo-700">
                        {record.workingDays} Days
                      </span>
                      <span className="text-[10px] text-indigo-500 font-medium block mt-0.5">
                        Roster Based ({Math.max(0, record.totalMonthDays - record.workingDays)} Off Days)
                      </span>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-emerald-200 shadow-2xs bg-emerald-50/30">
                      <span className="text-[10px] uppercase font-bold text-emerald-600 block">Total Present Days</span>
                      <span className="text-base font-black font-mono text-emerald-700">
                        {record.presentDays} Days
                      </span>
                      <span className="text-[10px] text-emerald-600 font-medium block mt-0.5">
                        {record.workingDays > 0 ? `${Math.round((record.presentDays / record.workingDays) * 100)}% Attendance` : '100%'}
                      </span>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-rose-200 shadow-2xs bg-rose-50/30">
                      <span className="text-[10px] uppercase font-bold text-rose-600 block">Total Absent Days</span>
                      <span className="text-base font-black font-mono text-rose-700">
                        {record.absentDays} Days
                      </span>
                      <span className="text-[10px] text-rose-500 font-medium block mt-0.5">
                        {record.absentDeduction > 0 ? `-৳${record.absentDeduction.toLocaleString()} Fine` : 'No Penalty'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Side-by-Side Breakdown: Earnings vs Deductions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Earnings Table */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-emerald-50/80 px-4 py-2.5 border-b border-slate-200 flex justify-between items-center">
                      <span className="font-bold text-xs uppercase text-emerald-900">Earnings &amp; Additions</span>
                      <span className="font-bold text-xs text-emerald-700">Amount (BDT)</span>
                    </div>
                    <table className="w-full text-xs divide-y divide-slate-100">
                      <tbody>
                        <tr>
                          <td className="px-4 py-2 text-slate-600">Basic Salary</td>
                          <td className="px-4 py-2 text-right font-mono font-medium">৳ {record.basicSalary.toLocaleString()}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 text-slate-600">House Rent Allowance (HRA)</td>
                          <td className="px-4 py-2 text-right font-mono font-medium">৳ {record.houseRent.toLocaleString()}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 text-slate-600">Medical Allowance</td>
                          <td className="px-4 py-2 text-right font-mono font-medium">৳ {record.medical.toLocaleString()}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 text-slate-600">Conveyance / Transport Allowance</td>
                          <td className="px-4 py-2 text-right font-mono font-medium">৳ {record.conveyance.toLocaleString()}</td>
                        </tr>
                        {record.food > 0 && (
                          <tr>
                            <td className="px-4 py-2 text-slate-600">Food Allowance</td>
                            <td className="px-4 py-2 text-right font-mono font-medium">৳ {record.food.toLocaleString()}</td>
                          </tr>
                        )}
                        <tr>
                          <td className={`px-4 py-2 ${(record.weekendAllowance || 0) > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-600'}`}>
                            Weekend Earning &amp; Allowances
                            {(record.weekendDays || 0) > 0 && (
                              <span className="ml-1 text-[10px] font-bold text-emerald-600">
                                ({record.weekendDays}d Present)
                              </span>
                            )}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono ${(record.weekendAllowance || 0) > 0 ? 'font-semibold text-emerald-700' : 'font-medium text-slate-600'}`}>
                            ৳ {(record.weekendAllowance || 0).toLocaleString()}
                          </td>
                        </tr>
                        <tr>
                          <td className={`px-4 py-2 ${record.overtimeAmount > 0 ? 'text-purple-700 font-semibold' : 'text-slate-600'}`}>
                            Overtime Pay (1.5x Basic • {record.shiftWorkingHours || 8}h Shift • {record.overtimeHours} hrs @ ৳{record.overtimeRate})
                          </td>
                          <td className={`px-4 py-2 text-right font-mono ${record.overtimeAmount > 0 ? 'font-semibold text-purple-700' : 'font-medium text-slate-600'}`}>
                            ৳ {record.overtimeAmount.toLocaleString()}
                          </td>
                        </tr>
                        {record.attendanceBonus > 0 && (
                          <tr>
                            <td className="px-4 py-2 text-slate-600">Attendance Bonus</td>
                            <td className="px-4 py-2 text-right font-mono font-medium">৳ {record.attendanceBonus.toLocaleString()}</td>
                          </tr>
                        )}
                        {record.festivalBonus > 0 && (
                          <tr>
                            <td className="px-4 py-2 text-purple-700 font-semibold">Festival / Eid Bonus</td>
                            <td className="px-4 py-2 text-right font-mono font-semibold text-purple-700">
                              ৳ {record.festivalBonus.toLocaleString()}
                            </td>
                          </tr>
                        )}
                        {((record.otherAllowance || 0) > 0 || Boolean(record.customEarningName)) && (
                          <tr>
                            <td className="px-4 py-2 text-indigo-700 font-semibold">
                              {record.customEarningName || 'Other Allowance / Earning'}
                            </td>
                            <td className="px-4 py-2 text-right font-mono font-semibold text-indigo-700">
                              ৳ {(record.otherAllowance || 0).toLocaleString()}
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 font-bold text-slate-900 border-t border-slate-200">
                          <td className="px-4 py-2.5 uppercase">Total Earnings (Gross)</td>
                          <td className="px-4 py-2.5 text-right font-mono text-indigo-700 font-extrabold">
                            ৳ {totalEarnings.toLocaleString()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Deductions Table */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-rose-50/80 px-4 py-2.5 border-b border-slate-200 flex justify-between items-center">
                      <span className="font-bold text-xs uppercase text-rose-900">Deductions</span>
                      <span className="font-bold text-xs text-rose-700">Amount (BDT)</span>
                    </div>
                    <table className="w-full text-xs divide-y divide-slate-100">
                      <tbody>
                        <tr>
                          <td className="px-4 py-2 text-slate-600">
                            Provident Fund (PF)
                            {record.pfDeduction === 0 && (
                              <span className="ml-1.5 text-[10px] text-slate-400 italic">(None / Manual ৳0)</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-medium text-rose-600">
                            ৳ {record.pfDeduction.toLocaleString()}
                          </td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 text-slate-600">
                            Income Tax (TDS)
                            {record.taxDeduction === 0 && (
                              <span className="ml-1.5 text-[10px] text-slate-400 italic">(None / Manual ৳0)</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-medium text-rose-600">
                            ৳ {record.taxDeduction.toLocaleString()}
                          </td>
                        </tr>
                        <tr>
                          <td className={`px-4 py-2 ${record.absentDeduction > 0 ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>
                            Absent Days Deduction ({record.absentDays} days)
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-rose-600">
                            ৳ {record.absentDeduction.toLocaleString()}
                          </td>
                        </tr>
                        {record.lateDeduction > 0 && (
                          <tr>
                            <td className="px-4 py-2 text-slate-600">Late Attendance Penalty</td>
                            <td className="px-4 py-2 text-right font-mono font-medium text-rose-600">
                              ৳ {record.lateDeduction.toLocaleString()}
                            </td>
                          </tr>
                        )}
                        {record.advanceDeduction > 0 && (
                          <tr>
                            <td className="px-4 py-2 text-slate-600">Advance Salary Deduction</td>
                            <td className="px-4 py-2 text-right font-mono font-medium text-rose-600">
                              ৳ {record.advanceDeduction.toLocaleString()}
                            </td>
                          </tr>
                        )}
                        {record.loanDeduction > 0 && (
                          <tr>
                            <td className="px-4 py-2 text-slate-600">Loan / EMI Repayment</td>
                            <td className="px-4 py-2 text-right font-mono font-medium text-rose-600">
                              ৳ {record.loanDeduction.toLocaleString()}
                            </td>
                          </tr>
                        )}
                        {((record.otherDeduction || 0) > 0 || Boolean(record.customDeductionName)) && (
                          <tr>
                            <td className="px-4 py-2 text-rose-700 font-semibold">
                              {record.customDeductionName || 'Other Deduction'}
                            </td>
                            <td className="px-4 py-2 text-right font-mono font-semibold text-rose-600">
                              ৳ {(record.otherDeduction || 0).toLocaleString()}
                            </td>
                          </tr>
                        )}
                        {totalDeductions === 0 && (
                          <tr>
                            <td colSpan={2} className="px-4 py-6 text-center text-slate-400 italic">
                              No deductions recorded for this month
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 font-bold text-slate-900 border-t border-slate-200">
                          <td className="px-4 py-2.5 uppercase">Total Deductions</td>
                          <td className="px-4 py-2.5 text-right font-mono text-rose-600 font-extrabold">
                            ৳ {totalDeductions.toLocaleString()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Net Salary Payable Box */}
                <div className="p-4 bg-emerald-50/70 border-2 border-emerald-500/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block">
                      Net Salary Payable (Take-Home Pay)
                    </span>
                    <p className="text-xs text-slate-600 mt-0.5 italic">
                      Amount in words: <strong className="text-slate-800 font-semibold">{salaryInWords}</strong>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-black text-emerald-700 font-mono">
                      ৳ {netSalary.toLocaleString()}
                    </span>
                    <div className="mt-1">
                      <span className={`text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                        record.status === 'paid' ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800'
                      }`}>
                        {record.status === 'paid' ? 'Paid & Disbursed' : 'Payment Pending'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Signatures Section */}
                <div className="pt-12 grid grid-cols-3 gap-8 text-center text-xs text-slate-500">
                  <div>
                    <div className="border-t border-slate-300 pt-2 font-medium">
                      Employee Signature
                    </div>
                  </div>
                  <div>
                    <div className="border-t border-slate-300 pt-2 font-medium">
                      Prepared By (HR Department)
                    </div>
                  </div>
                  <div>
                    <div className="border-t border-slate-300 pt-2 font-medium">
                      Authorized Signature (Management)
                    </div>
                  </div>
                </div>

                {/* Legal & System Note */}
                <div className="pt-3 border-t border-slate-100 text-[10px] text-slate-400 text-center space-y-0.5">
                  <div>
                    Calculation Basis: {record.workingDays} Working Days ({record.totalMonthDays} Days in {monthLabel}) • Attendance: {record.presentDays} Present, {record.absentDays} Absent.
                  </div>
                  <div>
                    This is a computer-generated salary slip generated via WorkNest HRMS on {new Date().toLocaleDateString('en-GB')}.
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT SALARY & PAYROLL COMPONENTS (FULL SUITE)                     */}
      {/* ========================================================================= */}
      {editingEmployee && editFormData && (() => {
        // Realtime calculated preview
        const currentOTAmount = Math.round((editFormData.overtimeHours || 0) * (editFormData.overtimeRate || 0));
        const currentGross =
          (editFormData.basicSalary || 0) +
          (editFormData.houseRent || 0) +
          (editFormData.medical || 0) +
          (editFormData.conveyance || 0) +
          (editFormData.food || 0) +
          (editFormData.weekendAllowance || 0) +
          currentOTAmount +
          (editFormData.attendanceBonus || 0) +
          (editFormData.festivalBonus || 0) +
          (editFormData.otherAllowance || 0);

        const currentDeductions =
          (editFormData.pfDeduction || 0) +
          (editFormData.taxDeduction || 0) +
          (editFormData.absentDeduction || 0) +
          (editFormData.lateDeduction || 0) +
          (editFormData.advanceDeduction || 0) +
          (editFormData.loanDeduction || 0) +
          (editFormData.otherDeduction || 0);

        const currentNet = Math.max(0, currentGross - currentDeductions);

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
                <div className="flex items-center space-x-2">
                  <span className="text-xl">✏️</span>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Edit Salary &amp; Payroll: {editingEmployee.name}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Adjust month components for <strong>{monthLabel}</strong> ({editingEmployee.employeeId})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingEmployee(null);
                    setEditFormData(null);
                  }}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-lg"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Real-time Calculation Summary Bar */}
                <div className="p-4 bg-slate-900 text-white rounded-2xl grid grid-cols-3 gap-3 text-center">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Gross</span>
                    <span className="text-base font-bold font-mono text-indigo-300">৳ {currentGross.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Deductions</span>
                    <span className="text-base font-bold font-mono text-rose-300">-৳ {currentDeductions.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Net Payable</span>
                    <span className="text-lg font-black font-mono text-emerald-400">৳ {currentNet.toLocaleString()}</span>
                  </div>
                </div>

                {/* Section 0: Attendance & Monthly Working Days Configuration */}
                <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase text-indigo-900 tracking-wider flex items-center space-x-1.5">
                      <span>📅</span>
                      <span>Attendance &amp; Monthly Working Days</span>
                    </h4>
                    <span className="text-[11px] font-semibold text-indigo-700 bg-white px-2 py-0.5 rounded-md border border-indigo-200">
                      Off Days: {Math.max(0, (editFormData.totalMonthDays || 30) - (editFormData.workingDays || 26))} Days
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Total Monthly Days
                      </label>
                      <input
                        type="number"
                        min="28"
                        max="31"
                        value={editFormData.totalMonthDays || 30}
                        onChange={e => {
                          const mDays = Number(e.target.value);
                          const currentOffDays = Math.max(0, (editFormData.totalMonthDays || 30) - (editFormData.workingDays ?? (editFormData.totalMonthDays || 30)));
                          const wDays = Math.max(0, mDays - currentOffDays);
                          const absDays = editFormData.absentDays || 0;
                          const presDays = Math.max(0, wDays - absDays);
                          const baseGross =
                            (editFormData.basicSalary || 0) +
                            (editFormData.houseRent || 0) +
                            (editFormData.medical || 0) +
                            (editFormData.conveyance || 0) +
                            (editFormData.food || 0);
                          const perDayGross = baseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            totalMonthDays: mDays,
                            workingDays: wDays,
                            presentDays: presDays,
                            absentDeduction: Math.round(perDayGross * absDays),
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-slate-200 bg-white rounded-xl text-sm font-mono font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="text-[10px] text-slate-400 block mt-0.5">e.g. 30 or 31</span>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-indigo-900 block mb-1">
                        Total Working Days
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={editFormData.totalMonthDays || 31}
                        value={editFormData.workingDays !== undefined ? editFormData.workingDays : (editFormData.totalMonthDays || 30)}
                        onChange={e => {
                          const wDays = Number(e.target.value);
                          const absDays = editFormData.absentDays || 0;
                          const presDays = Math.max(0, wDays - absDays);
                          const baseGross =
                            (editFormData.basicSalary || 0) +
                            (editFormData.houseRent || 0) +
                            (editFormData.medical || 0) +
                            (editFormData.conveyance || 0) +
                            (editFormData.food || 0);
                          const perDayGross = baseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            workingDays: wDays,
                            workingDaysCustomOverride: true,
                            presentDays: presDays,
                            absentDeduction: Math.round(perDayGross * absDays),
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-indigo-300 bg-white rounded-xl text-sm font-mono font-extrabold text-indigo-700 focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="text-[10px] text-indigo-500 block mt-0.5">
                        Roster Based ({Math.max(0, (editFormData.totalMonthDays || 30) - (editFormData.workingDays ?? (editFormData.totalMonthDays || 30)))} Off)
                      </span>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-emerald-800 block mb-1">
                        Total Present Days
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={editFormData.workingDays || 31}
                        value={editFormData.presentDays !== undefined ? editFormData.presentDays : Math.max(0, (editFormData.workingDays || 26) - (editFormData.absentDays || 0))}
                        onChange={e => {
                          const presDays = Number(e.target.value);
                          const wDays = editFormData.workingDays || 26;
                          const absDays = Math.max(0, wDays - presDays);
                          const baseGross =
                            (editFormData.basicSalary || 0) +
                            (editFormData.houseRent || 0) +
                            (editFormData.medical || 0) +
                            (editFormData.conveyance || 0) +
                            (editFormData.food || 0);
                          const perDayGross = baseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            presentDays: presDays,
                            absentDays: absDays,
                            absentDeduction: Math.round(perDayGross * absDays),
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-emerald-300 bg-white rounded-xl text-sm font-mono font-extrabold text-emerald-700 focus:ring-2 focus:ring-emerald-500"
                      />
                      <span className="text-[10px] text-emerald-600 block mt-0.5">Days Attended</span>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-rose-800 block mb-1">
                        Total Absent Days
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={editFormData.workingDays || 31}
                        value={editFormData.absentDays || 0}
                        onChange={e => {
                          const absDays = Number(e.target.value);
                          const wDays = editFormData.workingDays || 26;
                          const presDays = Math.max(0, wDays - absDays);
                          const baseGross =
                            (editFormData.basicSalary || 0) +
                            (editFormData.houseRent || 0) +
                            (editFormData.medical || 0) +
                            (editFormData.conveyance || 0) +
                            (editFormData.food || 0);
                          const perDayGross = baseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            absentDays: absDays,
                            presentDays: presDays,
                            absentDeduction: Math.round(perDayGross * absDays),
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-rose-300 bg-white rounded-xl text-sm font-mono font-extrabold text-rose-600 focus:ring-2 focus:ring-rose-500"
                      />
                      <span className="text-[10px] text-rose-500 block mt-0.5">Auto-deducts fine</span>
                    </div>
                  </div>
                </div>

                {/* Section 1: Base Salary Structure */}
                <div>
                  <h4 className="text-xs font-bold uppercase text-indigo-700 tracking-wider mb-2 flex items-center space-x-1.5">
                    <span>1. Base Salary Components</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Basic Salary (৳)</label>
                      <input
                        type="number"
                        value={editFormData.basicSalary}
                        onChange={e => {
                          const val = Number(e.target.value);
                          const shiftHrs = editFormData.shiftWorkingHours || 8;
                          const newHouseRent = Math.round(val * 0.6);
                          const newMedical = Math.round(val * 0.2);
                          const newConveyance = Math.round(val * 0.2);
                          const newBaseGross = val + newHouseRent + newMedical + newConveyance + (editFormData.food || 0);
                          const oneDayGross30 = newBaseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            basicSalary: val,
                            houseRent: newHouseRent,
                            medical: newMedical,
                            conveyance: newConveyance,
                            pfDeduction: payrollPolicy.autoPfDeduction ? Math.round(val * ((payrollPolicy.pfEmployeePercent || 8.33) / 100)) : (editFormData.pfDeduction || 0),
                            overtimeRate: calculateHourlyOtRate(val, shiftHrs),
                            overtimeRateCustomOverride: false,
                            absentDeduction: Math.round(oneDayGross30 * (editFormData.absentDays || 0)),
                            weekendAllowance: Math.round(oneDayGross30 * (editFormData.weekendDays || 0)),
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">House Rent (50%)</label>
                      <input
                        type="number"
                        value={editFormData.houseRent}
                        onChange={e => {
                          const val = Number(e.target.value);
                          const newBaseGross = (editFormData.basicSalary || 0) + val + (editFormData.medical || 0) + (editFormData.conveyance || 0) + (editFormData.food || 0);
                          const oneDayGross30 = newBaseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            houseRent: val,
                            absentDeduction: Math.round(oneDayGross30 * (editFormData.absentDays || 0)),
                            weekendAllowance: editFormData.weekendAllowanceCustomOverride
                              ? editFormData.weekendAllowance
                              : Math.round(oneDayGross30 * (editFormData.weekendDays || 0)),
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Medical Allowance (10%)</label>
                      <input
                        type="number"
                        value={editFormData.medical}
                        onChange={e => {
                          const val = Number(e.target.value);
                          const newBaseGross = (editFormData.basicSalary || 0) + (editFormData.houseRent || 0) + val + (editFormData.conveyance || 0) + (editFormData.food || 0);
                          const oneDayGross30 = newBaseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            medical: val,
                            absentDeduction: Math.round(oneDayGross30 * (editFormData.absentDays || 0)),
                            weekendAllowance: editFormData.weekendAllowanceCustomOverride
                              ? editFormData.weekendAllowance
                              : Math.round(oneDayGross30 * (editFormData.weekendDays || 0)),
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Conveyance / Transport</label>
                      <input
                        type="number"
                        value={editFormData.conveyance}
                        onChange={e => {
                          const val = Number(e.target.value);
                          const newBaseGross = (editFormData.basicSalary || 0) + (editFormData.houseRent || 0) + (editFormData.medical || 0) + val + (editFormData.food || 0);
                          const oneDayGross30 = newBaseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            conveyance: val,
                            absentDeduction: Math.round(oneDayGross30 * (editFormData.absentDays || 0)),
                            weekendAllowance: editFormData.weekendAllowanceCustomOverride
                              ? editFormData.weekendAllowance
                              : Math.round(oneDayGross30 * (editFormData.weekendDays || 0)),
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Food Allowance (৳)</label>
                      <input
                        type="number"
                        value={editFormData.food}
                        onChange={e => {
                          const val = Number(e.target.value);
                          const newBaseGross = (editFormData.basicSalary || 0) + (editFormData.houseRent || 0) + (editFormData.medical || 0) + (editFormData.conveyance || 0) + val;
                          const oneDayGross30 = newBaseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            food: val,
                            absentDeduction: Math.round(oneDayGross30 * (editFormData.absentDays || 0)),
                            weekendAllowance: editFormData.weekendAllowanceCustomOverride
                              ? editFormData.weekendAllowance
                              : Math.round(oneDayGross30 * (editFormData.weekendDays || 0)),
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Overtime, Weekend Earning & Special Allowances */}
                <div>
                  <h4 className="text-xs font-bold uppercase text-purple-700 tracking-wider mb-2 flex items-center justify-between">
                    <span>2. Overtime (1.5x Basic), Weekend Earning &amp; Bonuses</span>
                    <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                      OT Rule: ((Basic ÷ 30) ÷ {editFormData.shiftWorkingHours || 8}h Shift) × 1.5
                    </span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-purple-800 block mb-1">Shift Working Hours</label>
                      <input
                        type="number"
                        step="0.5"
                        min="1"
                        max="24"
                        value={editFormData.shiftWorkingHours || 8}
                        onChange={e => {
                          const sHours = Number(e.target.value) || 8;
                          setEditFormData({
                            ...editFormData,
                            shiftWorkingHours: sHours,
                            overtimeRate: calculateHourlyOtRate(editFormData.basicSalary || 0, sHours),
                            overtimeRateCustomOverride: false,
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-purple-200 bg-purple-50/30 rounded-xl text-sm font-mono font-bold text-purple-700 focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Overtime Hours</label>
                      <input
                        type="number"
                        step="0.5"
                        value={editFormData.overtimeHours}
                        onChange={e => setEditFormData({ ...editFormData, overtimeHours: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Hourly OT Rate (1.5x Basic ৳)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFormData.overtimeRate}
                        onChange={e => setEditFormData({ ...editFormData, overtimeRate: Number(e.target.value), overtimeRateCustomOverride: true })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-emerald-800 block mb-1">Weekend Present Days</label>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={editFormData.weekendDays || 0}
                        onChange={e => {
                          const wkDays = Number(e.target.value);
                          const baseGross =
                            (editFormData.basicSalary || 0) +
                            (editFormData.houseRent || 0) +
                            (editFormData.medical || 0) +
                            (editFormData.conveyance || 0) +
                            (editFormData.food || 0);
                          const oneDayGross30 = baseGross / 30;
                          setEditFormData({
                            ...editFormData,
                            weekendDays: wkDays,
                            weekendAllowance: Math.round(wkDays * oneDayGross30),
                            weekendAllowanceCustomOverride: false,
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-emerald-200 bg-emerald-50/30 rounded-xl text-sm font-mono font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-emerald-800 block mb-1">Weekend Earning &amp; Allowances (৳)</label>
                      <input
                        type="number"
                        value={editFormData.weekendAllowance || 0}
                        onChange={e => setEditFormData({ ...editFormData, weekendAllowance: Number(e.target.value), weekendAllowanceCustomOverride: true })}
                        className="w-full px-3 py-1.5 border border-emerald-200 bg-emerald-50/30 rounded-xl text-sm font-mono font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Attendance Bonus (৳)</label>
                      <input
                        type="number"
                        value={editFormData.attendanceBonus}
                        onChange={e => setEditFormData({ ...editFormData, attendanceBonus: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Festival / Eid Bonus (৳)</label>
                      <input
                        type="number"
                        value={editFormData.festivalBonus}
                        onChange={e => setEditFormData({ ...editFormData, festivalBonus: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2B: Manual Custom Earning & Deduction (Write Name & Amount) */}
                <div className="p-4 bg-amber-50/60 border border-amber-200/80 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase text-amber-900 tracking-wider flex items-center space-x-1.5">
                      <span>✍️</span>
                      <span>Custom Earning &amp; Deduction (Manual Entry)</span>
                    </h4>
                    <span className="text-[10px] font-semibold text-amber-800 bg-white px-2 py-0.5 rounded border border-amber-200">
                      Write Name &amp; Set Amount
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Custom Earning Box */}
                    <div className="p-3 bg-white rounded-xl border border-emerald-200 space-y-2">
                      <span className="text-[11px] font-bold text-emerald-800 uppercase block">
                        + Manual Earning / Allowance
                      </span>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                          Earning Name (Write Description)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Special Allowance / Night Duty / Arrears"
                          value={editFormData.customEarningName || ''}
                          onChange={e => setEditFormData({ ...editFormData, customEarningName: e.target.value })}
                          className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                          Earning Amount (৳)
                        </label>
                        <input
                          type="number"
                          placeholder="0"
                          value={editFormData.otherAllowance || 0}
                          onChange={e => setEditFormData({ ...editFormData, otherAllowance: Number(e.target.value) })}
                          className="w-full px-3 py-1.5 border border-emerald-300 rounded-xl text-sm font-mono font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Custom Deduction Box */}
                    <div className="p-3 bg-white rounded-xl border border-rose-200 space-y-2">
                      <span className="text-[11px] font-bold text-rose-800 uppercase block">
                        - Manual Deduction / Penalty
                      </span>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                          Deduction Name (Write Description)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Canteen / Damage Fine / Adjustment"
                          value={editFormData.customDeductionName || ''}
                          onChange={e => setEditFormData({ ...editFormData, customDeductionName: e.target.value })}
                          className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                          Deduction Amount (৳)
                        </label>
                        <input
                          type="number"
                          placeholder="0"
                          value={editFormData.otherDeduction || 0}
                          onChange={e => setEditFormData({ ...editFormData, otherDeduction: Number(e.target.value) })}
                          className="w-full px-3 py-1.5 border border-rose-300 rounded-xl text-sm font-mono font-bold text-rose-600 focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 3: Deductions */}
                <div>
                  <h4 className="text-xs font-bold uppercase text-rose-700 tracking-wider mb-2 flex items-center space-x-1.5">
                    <span>3. Statutory &amp; Monthly Deductions</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700 block">Provident Fund (PF)</label>
                        {!payrollPolicy.autoPfDeduction && (
                          <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.2 rounded">Manual</span>
                        )}
                      </div>
                      <input
                        type="number"
                        value={editFormData.pfDeduction}
                        onChange={e => setEditFormData({ ...editFormData, pfDeduction: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono text-rose-600 focus:ring-2 focus:ring-rose-500"
                      />
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <button
                          type="button"
                          onClick={() => setEditFormData({ ...editFormData, pfDeduction: 0 })}
                          className="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-md"
                        >
                          ৳0 (No PF)
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditFormData({
                            ...editFormData,
                            pfDeduction: Math.round(editFormData.basicSalary * ((payrollPolicy.pfEmployeePercent || 8.33) / 100))
                          })}
                          className="text-[10px] px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-md"
                        >
                          8.33% (৳{Math.round(editFormData.basicSalary * ((payrollPolicy.pfEmployeePercent || 8.33) / 100))})
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700 block">Income Tax (TDS)</label>
                        {!payrollPolicy.autoTaxDeduction && (
                          <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.2 rounded">Manual</span>
                        )}
                      </div>
                      <input
                        type="number"
                        value={editFormData.taxDeduction}
                        onChange={e => setEditFormData({ ...editFormData, taxDeduction: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono text-rose-600 focus:ring-2 focus:ring-rose-500"
                      />
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <button
                          type="button"
                          onClick={() => setEditFormData({ ...editFormData, taxDeduction: 0 })}
                          className="text-[10px] px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-md"
                        >
                          ৳0 (No Tax)
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditFormData({
                            ...editFormData,
                            taxDeduction: Math.round(editFormData.basicSalary * ((payrollPolicy.taxPercent || 5) / 100))
                          })}
                          className="text-[10px] px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-md"
                        >
                          5% (৳{Math.round(editFormData.basicSalary * ((payrollPolicy.taxPercent || 5) / 100))})
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700 block">Absent Days Penalty (৳)</label>
                        {editFormData.absentDays > 0 && (
                          <span className="text-[10px] text-rose-500 font-semibold">
                            {editFormData.absentDays}d Absent
                          </span>
                        )}
                      </div>
                      <input
                        type="number"
                        value={editFormData.absentDeduction}
                        onChange={e => setEditFormData({ ...editFormData, absentDeduction: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono text-rose-600 focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Late Attendance Fine (৳)</label>
                      <input
                        type="number"
                        value={editFormData.lateDeduction}
                        onChange={e => setEditFormData({ ...editFormData, lateDeduction: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono text-rose-600 focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Advance Salary (৳)</label>
                      <input
                        type="number"
                        value={editFormData.advanceDeduction}
                        onChange={e => setEditFormData({ ...editFormData, advanceDeduction: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono text-rose-600 focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Loan / EMI Repayment (৳)</label>
                      <input
                        type="number"
                        value={editFormData.loanDeduction}
                        onChange={e => setEditFormData({ ...editFormData, loanDeduction: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-mono text-rose-600 focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: Payment Details */}
                <div>
                  <h4 className="text-xs font-bold uppercase text-slate-700 tracking-wider mb-2">
                    4. Disbursement &amp; Payment Status
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Payment Status</label>
                      <select
                        value={editFormData.status}
                        onChange={e => setEditFormData({ ...editFormData, status: e.target.value as any })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="unpaid">Unpaid / Pending</option>
                        <option value="paid">Paid &amp; Disbursed</option>
                        <option value="on_hold">On Hold</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Payment Method</label>
                      <select
                        value={editFormData.paymentMethod}
                        onChange={e => setEditFormData({ ...editFormData, paymentMethod: e.target.value as any })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Cash">Cash</option>
                        <option value="bKash/Mobile Banking">bKash / Mobile Banking</option>
                        <option value="Cheque">Cheque</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Transaction Ref / Cheque No</label>
                      <input
                        type="text"
                        value={editFormData.transactionRef || ''}
                        onChange={e => setEditFormData({ ...editFormData, transactionRef: e.target.value })}
                        placeholder="e.g. TXN-893821"
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Profile sync checkbox */}
                <div className="p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="chk-update-profile"
                    checked={updateMasterProfile}
                    onChange={e => setUpdateMasterProfile(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded-sm focus:ring-indigo-500 cursor-pointer"
                  />
                  <label htmlFor="chk-update-profile" className="text-xs text-indigo-950 font-medium cursor-pointer">
                    Also update this employee's default salary structure permanently in their Employee Profile
                  </label>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 flex items-center justify-end space-x-3 sticky bottom-0 bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setEditingEmployee(null);
                    setEditFormData(null);
                  }}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
                >
                  Save Salary Changes
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL 3: BATCH DISBURSE ALL MODAL                                         */}
      {/* ========================================================================= */}
      {showDisburseAllModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center space-x-3 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-xl">
                💳
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Disburse All Pending Salaries</h3>
                <p className="text-xs text-slate-500">Period: {monthLabel}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <p className="text-slate-600 text-xs">
                This will mark all <strong>{stats.unpaidCount}</strong> pending employees as <strong>PAID</strong> for the month of {monthLabel}.
              </p>

              <div className="p-3 bg-slate-50 rounded-xl space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Total Employees:</span>
                  <span className="font-bold">{employees.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Disbursable Amount:</span>
                  <span className="font-bold text-emerald-600">৳ {stats.totalNet.toLocaleString()}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Disbursement Payment Method</label>
                <select
                  value={batchPaymentMethod}
                  onChange={e => setBatchPaymentMethod(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white"
                >
                  <option value="Bank Transfer">Bank Transfer (BEFTN / NPSB / RTGS)</option>
                  <option value="Cash">Cash Disbursement</option>
                  <option value="bKash/Mobile Banking">bKash / Mobile Financial Services</option>
                  <option value="Cheque">Corporate Account Cheque</option>
                </select>
              </div>
            </div>

            <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowDisburseAllModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisburseAll}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
              >
                Confirm &amp; Disburse
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: FESTIVAL / EID BONUS QUICK GENERATOR TOOL                        */}
      {/* ========================================================================= */}
      {showBonusModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center space-x-3 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 font-bold flex items-center justify-center text-xl">
                🎁
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Festival / Special Bonus</h3>
                <p className="text-xs text-slate-500">Apply bonus for {monthLabel}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Target Department</label>
                <select
                  value={bonusDept}
                  onChange={e => setBonusDept(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  <option value="all">All Departments ({employees.length} Employees)</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Bonus Calculation Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBonusAmountType('percent');
                      setBonusValue(50);
                    }}
                    className={`py-2 rounded-xl font-bold border transition-all ${
                      bonusAmountType === 'percent'
                        ? 'border-purple-600 bg-purple-50 text-purple-700 ring-1 ring-purple-500'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    % of Basic Salary
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBonusAmountType('fixed');
                      setBonusValue(5000);
                    }}
                    className={`py-2 rounded-xl font-bold border transition-all ${
                      bonusAmountType === 'fixed'
                        ? 'border-purple-600 bg-purple-50 text-purple-700 ring-1 ring-purple-500'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Fixed Amount (BDT)
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {bonusAmountType === 'percent' ? 'Bonus Percentage (%)' : 'Fixed Bonus Amount (৳)'}
                </label>
                <input
                  type="number"
                  value={bonusValue}
                  onChange={e => setBonusValue(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-sm font-bold focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  {bonusAmountType === 'percent'
                    ? 'e.g. 50% or 100% of Basic salary for Eid-ul-Fitr / Eid-ul-Adha'
                    : 'Fixed bonus amount credited to selected employees'}
                </p>
              </div>
            </div>

            <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowBonusModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyFestivalBonus}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all"
              >
                Apply Bonus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: STATUTORY DEDUCTION POLICY (AUTO PF & TAX TOGGLES)               */}
      {/* ========================================================================= */}
      {showDeductionPolicyModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2.5">
                <span className="text-2xl">⚖️</span>
                <div>
                  <h3 className="text-base font-bold text-slate-800">
                    Statutory Deductions Policy (PF &amp; Tax)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Control automatic vs. manual Provident Fund and Income Tax deductions
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeductionPolicyModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-400 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Info Note */}
              <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs text-indigo-900 leading-relaxed">
                <p className="font-bold mb-1">📌 Policy Notice / নির্দেশিকা:</p>
                <p>
                  Turn OFF automatic deductions below if you prefer to deduct Provident Fund and Tax manually for specific employees only. When turned off, standard payroll runs will not auto-cut PF or Tax.
                </p>
              </div>

              {/* Toggle 1: Auto PF Deduction */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Automatic Provident Fund (PF)</span>
                    <span className="text-[11px] text-slate-500 block mt-0.5">
                      {payrollPolicy.autoPfDeduction
                        ? `Auto-cuts ${payrollPolicy.pfEmployeePercent || 8.33}% from Basic salary`
                        : 'OFF (Manual) — No PF deducted automatically'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = { ...payrollPolicy, autoPfDeduction: !payrollPolicy.autoPfDeduction };
                      setPayrollPolicy(updated);
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                      payrollPolicy.autoPfDeduction ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        payrollPolicy.autoPfDeduction ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {payrollPolicy.autoPfDeduction && (
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                    <label className="text-slate-600 font-medium">Employee PF Contribution Rate (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={payrollPolicy.pfEmployeePercent}
                      onChange={e => setPayrollPolicy({ ...payrollPolicy, pfEmployeePercent: Number(e.target.value) })}
                      className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-right font-mono font-bold"
                    />
                  </div>
                )}
              </div>

              {/* Toggle 2: Auto Income Tax (TDS) */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Automatic Income Tax (TDS)</span>
                    <span className="text-[11px] text-slate-500 block mt-0.5">
                      {payrollPolicy.autoTaxDeduction
                        ? `Auto-cuts ${payrollPolicy.taxPercent || 5}% from Basic salary above ৳30,000`
                        : 'OFF (Manual) — No Tax deducted automatically'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = { ...payrollPolicy, autoTaxDeduction: !payrollPolicy.autoTaxDeduction };
                      setPayrollPolicy(updated);
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                      payrollPolicy.autoTaxDeduction ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        payrollPolicy.autoTaxDeduction ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {payrollPolicy.autoTaxDeduction && (
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                    <label className="text-slate-600 font-medium">Tax TDS Rate (%)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={payrollPolicy.taxPercent}
                      onChange={e => setPayrollPolicy({ ...payrollPolicy, taxPercent: Number(e.target.value) })}
                      className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-right font-mono font-bold"
                    />
                  </div>
                )}
              </div>

              {/* Quick Action: Reset uncustomized deductions for current month */}
              <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-rose-900 block">Clear Auto PF &amp; Tax for {monthLabel}</span>
                  <span className="text-[10px] text-rose-600 block mt-0.5">
                    Zeroes out non-customized PF and Tax for all employees this month
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleResetUncustomizedDeductions();
                  }}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-all cursor-pointer whitespace-nowrap"
                >
                  Clear to ৳0
                </button>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowDeductionPolicyModal(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-white transition-all"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem('worknest_settings_payroll', JSON.stringify(payrollPolicy));
                    window.dispatchEvent(new StorageEvent('storage', {
                      key: 'worknest_settings_payroll',
                      newValue: JSON.stringify(payrollPolicy),
                    }));
                  } catch {}
                  setShowDeductionPolicyModal(false);
                  showBanner('Statutory Deduction settings updated successfully!', 'success');
                }}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
              >
                Save Policy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: SALARY ADVANCES & EMPLOYEE LOANS MANAGEMENT (PHASE 2)            */}
      {/* ========================================================================= */}
      {showAdvancesModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Salary Advances &amp; Employee Loans</h3>
                <p className="text-xs text-slate-500">
                  Active advances and loans automatically deduct monthly EMI installments during payroll calculation unless manually overridden.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvancesModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Issue New Advance / Loan Form */}
            <form onSubmit={handleCreateAdvance} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Issue New Advance or Loan</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Employee *</label>
                  <select
                    required
                    value={advanceForm.employeeId}
                    onChange={e => setAdvanceForm({ ...advanceForm, employeeId: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
                  >
                    <option value="">-- Select Employee --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.employeeId})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Type</label>
                  <select
                    value={advanceForm.type}
                    onChange={e => setAdvanceForm({ ...advanceForm, type: e.target.value as 'advance' | 'loan' })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
                  >
                    <option value="advance">Salary Advance</option>
                    <option value="loan">Employee Loan</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Principal Amount (৳)</label>
                  <input
                    type="number"
                    min={100}
                    required
                    value={advanceForm.principalAmount}
                    onChange={e => setAdvanceForm({ ...advanceForm, principalAmount: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white font-bold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Installments (Months)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    required
                    value={advanceForm.totalInstallments}
                    onChange={e => setAdvanceForm({ ...advanceForm, totalInstallments: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white font-bold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Start Month</label>
                  <input
                    type="month"
                    required
                    value={advanceForm.startMonth}
                    onChange={e => setAdvanceForm({ ...advanceForm, startMonth: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
                  />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <input
                  type="text"
                  value={advanceForm.reason}
                  onChange={e => setAdvanceForm({ ...advanceForm, reason: e.target.value })}
                  placeholder="Reason / approval reference note..."
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white"
                />
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-600">
                    Monthly EMI:{' '}
                    <strong className="text-indigo-700">
                      ৳{Math.round((advanceForm.principalAmount || 0) / Math.max(1, advanceForm.totalInstallments || 1)).toLocaleString()}/mo
                    </strong>
                  </span>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl cursor-pointer"
                  >
                    + Issue Advance / Loan
                  </button>
                </div>
              </div>
            </form>

            {/* Active & Historical Advances Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase border-b border-slate-200">
                    <th className="py-2.5 px-3">Employee</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Principal</th>
                    <th className="py-2.5 px-3">Monthly EMI</th>
                    <th className="py-2.5 px-3">Remaining Balance</th>
                    <th className="py-2.5 px-3">Installments</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {salaryAdvancesLoans.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        No salary advances or employee loans recorded yet.
                      </td>
                    </tr>
                  ) : (
                    salaryAdvancesLoans.map(adv => (
                      <tr key={adv.id} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{adv.employeeName}</div>
                          <div className="text-[11px] text-slate-400">{adv.department} · Start: {adv.startMonth}</div>
                        </td>
                        <td className="py-2.5 px-3 uppercase font-bold text-[11px] text-amber-800">{adv.type}</td>
                        <td className="py-2.5 px-3 font-mono font-bold">৳{adv.principalAmount.toLocaleString()}</td>
                        <td className="py-2.5 px-3 font-mono text-indigo-700 font-semibold">৳{adv.monthlyInstallment.toLocaleString()}/mo</td>
                        <td className="py-2.5 px-3 font-mono font-black text-rose-600">৳{adv.remainingBalance.toLocaleString()}</td>
                        <td className="py-2.5 px-3">{adv.paidInstallments} / {adv.totalInstallments}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                            adv.status === 'active'
                              ? 'bg-amber-100 text-amber-800'
                              : adv.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {adv.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {adv.status === 'active' && (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  const nextPaid = adv.paidInstallments + 1;
                                  const nextRem = Math.max(0, adv.remainingBalance - adv.monthlyInstallment);
                                  updateSalaryAdvanceLoan(adv.id, {
                                    paidInstallments: nextPaid,
                                    remainingBalance: nextRem,
                                    status: nextRem <= 0 ? 'completed' : 'active',
                                  });
                                }}
                                className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[11px] font-semibold cursor-pointer"
                                title="Record 1 monthly EMI installment paid"
                              >
                                Record EMI
                              </button>
                              <button
                                type="button"
                                onClick={() => updateSalaryAdvanceLoan(adv.id, { status: 'completed', remainingBalance: 0 })}
                                className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-[11px] font-semibold cursor-pointer"
                              >
                                Mark Settled
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: PAYROLL HISTORY & IMMUTABLE RUN SNAPSHOTS (PHASE 2)              */}
      {/* ========================================================================= */}
      {showPayrollHistoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Historical Payroll Runs &amp; Finalized Snapshots</h3>
                <p className="text-xs text-slate-500">
                  Finalized &amp; locked payroll runs preserve exact historical calculations so future policy or salary changes never corrupt past records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPayrollHistoryModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase border-b border-slate-200">
                    <th className="py-2.5 px-3">Payroll Month</th>
                    <th className="py-2.5 px-3">Employees</th>
                    <th className="py-2.5 px-3">Total Gross</th>
                    <th className="py-2.5 px-3">Total Deductions</th>
                    <th className="py-2.5 px-3">Net Disbursable</th>
                    <th className="py-2.5 px-3">Status &amp; Lock</th>
                    <th className="py-2.5 px-3">Approved / Finalized By</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {payrollRunsList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        No formal payroll runs have been approved or finalized yet. Use "Approve Payroll" or "Finalize &amp; Lock Payroll" on the main screen.
                      </td>
                    </tr>
                  ) : (
                    payrollRunsList.map(run => (
                      <tr key={run.month} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3 font-bold text-slate-900">{run.month}</td>
                        <td className="py-2.5 px-3">{run.totalEmployees}</td>
                        <td className="py-2.5 px-3 font-mono font-semibold text-indigo-700">৳{(run.totalGrossAmount || 0).toLocaleString()}</td>
                        <td className="py-2.5 px-3 font-mono text-rose-600">-৳{(run.totalDeductionsAmount || 0).toLocaleString()}</td>
                        <td className="py-2.5 px-3 font-mono font-black text-emerald-700">৳{(run.totalNetAmount || 0).toLocaleString()}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                            run.isLocked
                              ? 'bg-slate-900 text-amber-300'
                              : run.approvalStatus === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}>
                            {run.isLocked ? '🔒 Finalized & Locked' : (run.approvalStatus || run.status)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-500">
                          {run.lockedBy || run.approvedBy || run.publishedBy || 'Admin'}
                          {(run.lockedAt || run.approvedAt || run.generatedAt) && (
                            <span className="block text-[10px] text-slate-400">
                              {new Date(run.lockedAt || run.approvedAt || run.generatedAt || '').toLocaleDateString()}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedMonth(run.month);
                              setShowPayrollHistoryModal(false);
                            }}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            Load Month
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
