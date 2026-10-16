import { useState, useEffect, useMemo, useCallback } from 'react';
import { useData, Employee } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firestoreService';
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
  evaluateAttendanceForSchedule,
} from '../utils/attendanceScheduleEngine';
import {
  generateReportHtml,
  printViaIframe,
  PrintReportConfig,
} from '../utils/reportPrinter';

export function HRAnalyticsDashboard() {
  const {
    employees,
    allEmployees,
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
    offboardingRecords,
    expenseClaims,
    currentUser,
    currentEmployee,
    isCurrentUserManager,
    authorizedTeamEmployees,
  } = useData();
  const { currentCompanyId, currentCompany } = useTenant();
  const activeTenant = currentCompanyId || 'default';

  const isManagerOnly =
    currentUser?.role === 'Department Supervisor' ||
    Boolean(currentEmployee && isCurrentUserManager);

  const canViewPayrollCost = Boolean(
    currentUser &&
      (currentUser.role === 'Super Admin' ||
        currentUser.role === 'HR Manager' ||
        currentUser.role === 'Payroll Admin' ||
        currentUser.permissions?.payroll ||
        currentUser.permissions?.analytics ||
        currentUser.permissions?.reports)
  );

  // Scoped employees based on RBAC
  const baseEmployees = useMemo(() => {
    if (isManagerOnly && authorizedTeamEmployees.length > 0) {
      return authorizedTeamEmployees;
    }
    return allEmployees.length > 0 ? allEmployees : employees;
  }, [isManagerOnly, authorizedTeamEmployees, allEmployees, employees]);

  // Default current & previous month
  const currentMonthStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const getPreviousMonthStr = (monthStr: string) => {
    const [y, m] = (monthStr || '').split('-').map(Number);
    if (!y || !m) return currentMonthStr;
    const prevDate = new Date(y, m - 2, 1);
    return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  };

  // Filters
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [compareMonth, setCompareMonth] = useState<string>(() => getPreviousMonthStr(currentMonthStr));
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedEmpId, setSelectedEmpId] = useState<string>('all');

  const handleMonthChange = (newMonth: string) => {
    setSelectedMonth(newMonth);
    setCompareMonth(getPreviousMonthStr(newMonth));
  };

  const getMonthBounds = useCallback((monthStr: string) => {
    const [y, m] = (monthStr || '').split('-').map(Number);
    const year = y || new Date().getFullYear();
    const month = m || new Date().getMonth() + 1;
    const lastDay = new Date(year, month, 0).getDate();
    return {
      year,
      month,
      start: `${year}-${String(month).padStart(2, '0')}-01`,
      end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      daysInMonth: lastDay,
    };
  }, []);

  // Saved payroll records from localStorage
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
    return () => window.removeEventListener('worknest_payroll_updated', syncPayroll);
  }, []);

  // Bounded Firestore attendance query covering selectedMonth and compareMonth
  const [firestoreAttendance, setFirestoreAttendance] = useState<any[]>([]);
  useEffect(() => {
    try {
      const b1 = getMonthBounds(selectedMonth);
      const b2 = getMonthBounds(compareMonth);
      const queryStart = b1.start < b2.start ? b1.start : b2.start;
      const queryEnd = b1.end > b2.end ? b1.end : b2.end;

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
            const matches =
              activeTenant !== 'default'
                ? !data.companyId || docComp === 'default' || docComp === activeTenant
                : !data.companyId || docComp === 'default';
            if (matches) {
              docs.push({ id: d.id, ...data });
            }
          });
          setFirestoreAttendance(docs);
        },
        () => {}
      );
      return () => unsub();
    } catch {}
  }, [selectedMonth, compareMonth, activeTenant, getMonthBounds]);

  // Filter employees by Branch, Department, and Employee selector
  const filteredEmployees = useMemo(() => {
    return baseEmployees.filter((emp) => {
      if (selectedBranch !== 'all' && getEmployeeBranch(emp).toLowerCase() !== selectedBranch.toLowerCase()) {
        return false;
      }
      if (selectedDept !== 'all' && (emp.department || '').toLowerCase() !== selectedDept.toLowerCase()) {
        return false;
      }
      if (selectedEmpId !== 'all' && emp.id !== selectedEmpId && emp.employeeId !== selectedEmpId) {
        return false;
      }
      return true;
    });
  }, [baseEmployees, selectedBranch, selectedDept, selectedEmpId, getEmployeeBranch]);

  const extractCleanPunches = useCallback((rec: any): { checkIn: string; checkOut: string } => {
    if (!rec) return { checkIn: '-', checkOut: '-' };
    const rawIn = rec.firstPunchIn || rec.checkIn || rec.firstPunch || '-';
    const checkIn = rawIn && rawIn !== '--:--' ? String(rawIn).trim() : '-';
    let rawOut = '-';
    if (rec.checkOut && rec.checkOut !== '-' && rec.checkOut !== '--:--' && String(rec.checkOut).trim() !== checkIn) {
      rawOut = String(rec.checkOut).trim();
    } else if (rec.lastPunchOut && rec.lastPunchOut !== '-' && rec.lastPunchOut !== '--:--' && String(rec.lastPunchOut).trim() !== checkIn) {
      rawOut = String(rec.lastPunchOut).trim();
    }
    if (rawOut === checkIn || rec.totalPunches === 1) rawOut = '-';
    return { checkIn, checkOut: rawOut };
  }, []);

  // =========================================================================
  // AUTHORITATIVE PERIOD ANALYTICS ENGINE (REUSING ROSTER->SHIFT & PAYROLL LOGIC)
  // =========================================================================
  const computePeriodMetrics = useCallback(
    (monthStr: string, empList: Employee[]) => {
      const bounds = getMonthBounds(monthStr);
      const todayStr = new Date().toISOString().split('T')[0];

      let totalPresent = 0;
      let totalLate = 0;
      let totalEarlyOut = 0;
      let totalAbsent = 0;
      let totalLeaveDays = 0;
      let totalOvertimeHours = 0;
      let totalWorkedHours = 0;
      let totalGrossPayroll = 0;
      let totalNetPayroll = 0;
      let totalDeductions = 0;

      const shiftUsageMap = new Map<
        string,
        { shiftName: string; assignedStaff: number; presentCount: number; lateCount: number; otHours: number; workHours: number }
      >();

      const deptPerfMap = new Map<
        string,
        {
          dept: string;
          headcount: number;
          presentDays: number;
          absentDays: number;
          lateDays: number;
          otHours: number;
          grossPayroll: number;
        }
      >();

      const activeEmps = empList.filter((e) => e.status !== 'inactive' && !e.accessTerminated);

      activeEmps.forEach((emp) => {
        const empCode = String(emp.employeeId || '').trim().toLowerCase();
        const empDocId = String(emp.id || '').trim().toLowerCase();
        const empNameLower = String(emp.name || '').trim().toLowerCase();

        const isEmpMatch = (rec: any) => {
          if (!rec) return false;
          const rId = String(rec.employeeId || rec.employeeCode || '').trim().toLowerCase();
          const rName = String(rec.employeeName || '').trim().toLowerCase();
          return (
            (empCode && rId === empCode) ||
            (empDocId && rId === empDocId) ||
            (empNameLower && rName === empNameLower)
          );
        };

        const deptName = emp.department || 'General';
        if (!deptPerfMap.has(deptName)) {
          deptPerfMap.set(deptName, {
            dept: deptName,
            headcount: 0,
            presentDays: 0,
            absentDays: 0,
            lateDays: 0,
            otHours: 0,
            grossPayroll: 0,
          });
        }
        const deptEntry = deptPerfMap.get(deptName)!;
        deptEntry.headcount += 1;

        const primaryShift = findShiftByNameOrId(shifts, emp.shift)?.name || emp.shift || 'General Shift';
        if (!shiftUsageMap.has(primaryShift)) {
          shiftUsageMap.set(primaryShift, {
            shiftName: primaryShift,
            assignedStaff: 0,
            presentCount: 0,
            lateCount: 0,
            otHours: 0,
            workHours: 0,
          });
        }
        shiftUsageMap.get(primaryShift)!.assignedStaff += 1;

        let empPresentDays = 0;
        let empWeekendPresentDays = 0;
        let empAbsentDays = 0;
        let empUnexcusedLate = 0;
        let empOtMinutes = 0;

        for (let d = 1; d <= bounds.daysInMonth; d++) {
          const dateStr = `${bounds.year}-${String(bounds.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const attRec = firestoreAttendance.find((a) => a.date === dateStr && isEmpMatch(a));
          const sched = resolveEmployeeScheduleForDate(emp, dateStr, roster, shifts, attRec?.shiftName);
          const dateShiftName = resolveEmployeeShiftNameForDate(emp, dateStr, attRec?.shiftName);
          const isWeekend = Boolean(sched.isWeekend || sched.isOff);

          const activeLeave = leaveRequests.find(
            (l) =>
              l.status === 'approved' &&
              isEmpMatch(l) &&
              dateStr >= (l.from || '') &&
              dateStr <= (l.to || '')
          );

          const { checkIn, checkOut } = extractCleanPunches(attRec);
          const hasPunch = checkIn !== '-' || checkOut !== '-';

          if (attRec && (hasPunch || attRec.status)) {
            const evalRes = evaluateAttendanceForSchedule(checkIn, checkOut, sched, attRec, dateShiftName);
            const status = evalRes.status;

            if (['present', 'late', 'half_day'].includes(status)) {
              empPresentDays++;
              totalPresent++;
              deptEntry.presentDays++;
              if (isWeekend) empWeekendPresentDays++;

              if (status === 'late') {
                totalLate++;
                deptEntry.lateDays++;
                shiftUsageMap.get(primaryShift)!.lateCount += 1;
                const isWaived = attendanceRequests.some(
                  (r) => isEmpMatch(r) && r.date === dateStr && r.type === 'late_arrival' && r.status === 'approved'
                );
                if (!attRec.isLateExcused && !attRec.lateWaived && !isWaived) {
                  empUnexcusedLate++;
                }
              }

              if (evalRes.isEarlyOut) {
                totalEarlyOut++;
              }

              const isOvernight = Boolean(
                attRec.isOvernight ||
                  sched.isOvernight ||
                  isEveningOrOvernight(sched) ||
                  (checkIn !== '-' && checkOut !== '-' && normalizeTimeStr(checkOut) < normalizeTimeStr(checkIn))
              );
              const duty = calculateDutyDuration(checkIn, checkOut, isOvernight, sched.breakTime);
              const workedHrs =
                checkIn !== '-' && checkOut !== '-' && duty.durationHours > 0
                  ? duty.durationHours
                  : Number(attRec.totalHours || attRec.workHours || 0);
              totalWorkedHours += workedHrs;
              shiftUsageMap.get(primaryShift)!.presentCount += 1;
              shiftUsageMap.get(primaryShift)!.workHours += workedHrs;

              const effShift =
                sched.shift ||
                findShiftByNameOrId(shifts, sched.shiftName) ||
                findShiftByNameOrId(shifts, dateShiftName);
              const isOtAllowed =
                !isWeekend &&
                sched.overtimePolicyEnabled !== false &&
                isShiftOvertimeEnabled(effShift);
              const calcOt = isOtAllowed
                ? calculateOvertimeHours(checkIn, checkOut, {
                    ...sched,
                    shift: effShift || sched.shift,
                    overtimePolicyEnabled: isOtAllowed,
                    isOvernight,
                  })
                : 0;
              const savedOt =
                attRec.otHours !== undefined && attRec.otHours !== null
                  ? Number(attRec.otHours)
                  : attRec.overtimeHours !== undefined && attRec.overtimeHours !== null
                  ? Number(attRec.overtimeHours)
                  : null;
              const dayOt = !isOtAllowed
                ? 0
                : attRec.source === 'admin_edit' && savedOt !== null
                ? savedOt
                : checkIn !== '-' && checkOut !== '-'
                ? calcOt
                : savedOt !== null && savedOt > 0
                ? savedOt
                : 0;

              if (dayOt > 0) {
                empOtMinutes += Math.round(dayOt * 60);
                totalOvertimeHours += dayOt;
                deptEntry.otHours += dayOt;
                shiftUsageMap.get(primaryShift)!.otHours += dayOt;
              }
            } else if (status === 'absent') {
              empAbsentDays++;
              totalAbsent++;
              deptEntry.absentDays++;
            }
          } else if (activeLeave) {
            totalLeaveDays++;
          } else if (!isWeekend && dateStr <= todayStr) {
            empAbsentDays++;
            totalAbsent++;
            deptEntry.absentDays++;
          }
        }

        // Authoritative Payroll calculation for this employee in monthStr
        const explicitGross = Number(emp.grossSalary);
        const compSum =
          (Number(emp.basicSalary ?? emp.basic) || 0) +
          (Number(emp.houseRent) || 0) +
          (Number(emp.medical) || 0) +
          (Number(emp.conveyance ?? emp.transport) || 0) +
          (Number(emp.food) || 0);
        const baseGross =
          !isNaN(explicitGross) && explicitGross > 0
            ? explicitGross
            : compSum > 0
            ? compSum
            : (Number(emp.basicSalary ?? emp.basic) || 0) * 2;
        const basic = Number(emp.basicSalary ?? emp.basic) || Math.round(baseGross * 0.5);

        const recKey = `${monthStr}_${emp.id}`;
        const altKey = `${monthStr}_${emp.employeeId}`;
        const lockedSnap =
          monthlyPayrollRuns[monthStr]?.isLocked && monthlyPayrollRuns[monthStr]?.lockedSnapshots
            ? monthlyPayrollRuns[monthStr].lockedSnapshots![emp.id] ||
              monthlyPayrollRuns[monthStr].lockedSnapshots![emp.employeeId]
            : null;
        const savedRec = lockedSnap || savedPayrollRecords[recKey] || savedPayrollRecords[altKey];

        const oneDayGross30 = baseGross / 30;
        const lateCut = Math.round(Math.floor(empUnexcusedLate / 3) * oneDayGross30);
        const absentCut = savedRec?.absentDeductionManualZeroV2
          ? 0
          : Math.round(empAbsentDays * oneDayGross30);
        const weekendAllowance = Math.round(empWeekendPresentDays * oneDayGross30);
        const shiftHrs = getEmployeeShiftWorkingHours(emp, shifts, roster, monthStr);
        const exactOtRate = ((basic / 30) / (shiftHrs || 8)) * 1.5;
        const otAmount = Math.round((empOtMinutes / 60) * exactOtRate);
        const bonus =
          (Number(savedRec?.attendanceBonus ?? emp.attendanceBonus) || 0) +
          (Number(savedRec?.festivalBonus) || 0) +
          (Number(savedRec?.otherAllowance) || 0);
        const pfTaxOther =
          (Number(savedRec?.pfDeduction) || 0) +
          (Number(savedRec?.taxDeduction) || 0) +
          (Number(savedRec?.advanceDeduction) || 0) +
          (Number(savedRec?.loanDeduction) || 0) +
          (Number(savedRec?.otherDeduction) || 0);

        const empGrossTotal = baseGross + weekendAllowance + otAmount + bonus;
        const empDedTotal = lateCut + absentCut + pfTaxOther;
        const empNet = Math.max(0, empGrossTotal - empDedTotal);

        totalGrossPayroll += empGrossTotal;
        totalDeductions += empDedTotal;
        totalNetPayroll += empNet;
        deptEntry.grossPayroll += empGrossTotal;
      });

      const totalScheduledChecks = totalPresent + totalAbsent;
      const attendanceRate =
        totalScheduledChecks > 0 ? Math.round((totalPresent / totalScheduledChecks) * 100) : 0;

      return {
        totalPresent,
        totalLate,
        totalEarlyOut,
        totalAbsent,
        totalLeaveDays,
        totalOvertimeHours: Math.round(totalOvertimeHours * 10) / 10,
        totalWorkedHours: Math.round(totalWorkedHours * 10) / 10,
        attendanceRate,
        totalGrossPayroll: Math.round(totalGrossPayroll),
        totalNetPayroll: Math.round(totalNetPayroll),
        totalDeductions: Math.round(totalDeductions),
        shiftUsage: Array.from(shiftUsageMap.values()),
        deptPerf: Array.from(deptPerfMap.values()),
      };
    },
    [
      getMonthBounds,
      firestoreAttendance,
      roster,
      shifts,
      leaveRequests,
      attendanceRequests,
      extractCleanPunches,
      monthlyPayrollRuns,
      savedPayrollRecords,
    ]
  );

  const currentMetrics = useMemo(
    () => computePeriodMetrics(selectedMonth, filteredEmployees),
    [computePeriodMetrics, selectedMonth, filteredEmployees]
  );

  const comparisonMetrics = useMemo(
    () => computePeriodMetrics(compareMonth, filteredEmployees),
    [computePeriodMetrics, compareMonth, filteredEmployees]
  );

  // =========================================================================
  // HEADCOUNT, TENURE, ATTRITION, HIRING FUNNEL & LEAVE UTILIZATION
  // =========================================================================
  const workforceAnalytics = useMemo(() => {
    const total = filteredEmployees.length;
    const active = filteredEmployees.filter((e) => e.status === 'active').length;
    const onLeave = filteredEmployees.filter((e) => e.status === 'on_leave').length;
    const inactive = filteredEmployees.filter(
      (e) => e.status === 'inactive' || Boolean(e.accessTerminated)
    ).length;

    // Tenure distribution from joinDate
    const now = Date.now();
    let under6m = 0;
    let m6to12 = 0;
    let y1to3 = 0;
    let y3plus = 0;
    let totalTenureMonths = 0;

    filteredEmployees.forEach((e) => {
      if (e.joinDate && /^\d{4}-\d{2}-\d{2}$/.test(e.joinDate.trim())) {
        const jTime = new Date(e.joinDate.trim()).getTime();
        const months = Math.max(0, (now - jTime) / (1000 * 60 * 60 * 24 * 30.4375));
        totalTenureMonths += months;
        if (months < 6) under6m++;
        else if (months < 12) m6to12++;
        else if (months < 36) y1to3++;
        else y3plus++;
      } else {
        m6to12++;
        totalTenureMonths += 10;
      }
    });

    const avgTenureYears =
      total > 0 ? (totalTenureMonths / total / 12).toFixed(1) : '0.0';

    // Turnover / Attrition
    const exitsCount = offboardingRecords.length + inactive;
    const attritionRate =
      total > 0 ? Math.min(100, Math.round((inactive / total) * 100)) : 0;
    const retentionRate = Math.max(0, 100 - attritionRate);

    // Hiring Funnel
    const funnel = {
      applied: candidates.filter((c) => c.stage === 'applied').length,
      screening: candidates.filter((c) => c.stage === 'screening').length,
      interview: candidates.filter((c) => c.stage === 'interview').length,
      offer: candidates.filter((c) => c.stage === 'offer').length,
      hired: candidates.filter((c) => c.stage === 'hired').length,
      rejected: candidates.filter((c) => c.stage === 'rejected').length,
      totalCandidates: candidates.length,
      openJobs: recruitmentJobs.filter((j) => j.status === 'open').length,
      openVacancies: recruitmentJobs
        .filter((j) => j.status === 'open')
        .reduce((s, j) => s + (Number(j.vacancies) || 1), 0),
    };

    // Leave Utilization
    const approvedLeaves = leaveRequests.filter((l) => l.status === 'approved');
    const leaveByType = {
      casual: approvedLeaves
        .filter((l) => (l.type || '').toLowerCase().includes('casual'))
        .reduce((s, l) => s + (Number(l.days) || 1), 0),
      sick: approvedLeaves
        .filter((l) => (l.type || '').toLowerCase().includes('sick'))
        .reduce((s, l) => s + (Number(l.days) || 1), 0),
      annual: approvedLeaves
        .filter((l) => (l.type || '').toLowerCase().includes('annual'))
        .reduce((s, l) => s + (Number(l.days) || 1), 0),
      unpaid: approvedLeaves
        .filter((l) => (l.type || '').toLowerCase().includes('unpaid'))
        .reduce((s, l) => s + (Number(l.days) || 1), 0),
    };

    // Expense Reimbursement Cost in selectedMonth
    const monthExpensesCost = expenseClaims
      .filter((c) => c.status === 'approved' && c.expenseDate?.startsWith(selectedMonth))
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);

    return {
      total,
      active,
      onLeave,
      inactive,
      exitsCount,
      attritionRate,
      retentionRate,
      avgTenureYears,
      tenureBuckets: [
        { label: '< 6 Months', count: under6m },
        { label: '6 – 12 Months', count: m6to12 },
        { label: '1 – 3 Years', count: y1to3 },
        { label: '3+ Years', count: y3plus },
      ],
      funnel,
      leaveByType,
      monthExpensesCost,
    };
  }, [filteredEmployees, offboardingRecords, candidates, recruitmentJobs, leaveRequests, expenseClaims, selectedMonth]);

  // Department Performance rows
  const departmentPerformanceRows = useMemo(() => {
    return currentMetrics.deptPerf.map((d) => {
      const totalChecks = d.presentDays + d.absentDays;
      const attPct = totalChecks > 0 ? Math.round((d.presentDays / totalChecks) * 100) : 0;

      return {
        ...d,
        attPct,
      };
    });
  }, [currentMetrics.deptPerf]);

  // Print & Export
  const handlePrintAnalytics = async () => {
    const config: PrintReportConfig = {
      title: 'Executive HR Analytics & Historical Comparison Report',
      subtitle: `${currentCompany?.name || 'WorkNest HR'} • Authoritative Attendance, Payroll Cost, Hiring Funnel, Attrition & Shift Utilization`,
      period: `Primary Month: ${selectedMonth} (Compared vs ${compareMonth})`,
      orientation: 'landscape',
      filters: [
        { label: 'Branch', value: selectedBranch === 'all' ? 'All Branches' : selectedBranch },
        { label: 'Department', value: selectedDept === 'all' ? 'All Departments' : selectedDept },
        { label: 'Comparison Period', value: `${selectedMonth} vs ${compareMonth}` },
      ],
      metrics: [
        { label: 'Total Headcount', value: `${workforceAnalytics.total} (${workforceAnalytics.active} Active)`, highlight: true },
        { label: 'Attendance Rate', value: `${currentMetrics.attendanceRate}% (Prev: ${comparisonMetrics.attendanceRate}%)`, highlight: true },
        { label: 'Overtime Hours', value: `${currentMetrics.totalOvertimeHours}h (Prev: ${comparisonMetrics.totalOvertimeHours}h)` },
        { label: 'Retention Rate', value: `${workforceAnalytics.retentionRate}% (Avg Tenure: ${workforceAnalytics.avgTenureYears}y)` },
        ...(canViewPayrollCost
          ? [
              {
                label: 'Net Payroll Cost',
                value: `৳${currentMetrics.totalNetPayroll.toLocaleString()} (Prev: ৳${comparisonMetrics.totalNetPayroll.toLocaleString()})`,
                highlight: true,
              },
            ]
          : []),
      ],
      headers: [
        'Department',
        'Headcount',
        'Present Days',
        'Absent Days',
        'Late Count',
        'Attendance %',
        'Overtime (Hrs)',
        ...(canViewPayrollCost ? ['Gross Cost (৳)'] : []),
      ],
      rows: departmentPerformanceRows.map((r) => [
        r.dept,
        r.headcount,
        r.presentDays,
        r.absentDays,
        r.lateDays,
        `${r.attPct}%`,
        `${r.otHours.toFixed(1)}h`,
        ...(canViewPayrollCost ? [`৳${Math.round(r.grossPayroll).toLocaleString()}`] : []),
      ]),
    };
    const html = generateReportHtml(config);
    await printViaIframe(html);
  };

  const handleExportAnalyticsCsv = () => {
    const headers = [
      'Department',
      'Headcount',
      'Present Days',
      'Absent Days',
      'Late Arrivals',
      'Attendance Rate %',
      'Overtime Hours',
      ...(canViewPayrollCost ? ['Monthly Gross Payroll BDT'] : []),
    ];
    const rows = departmentPerformanceRows.map((r) => [
      r.dept,
      r.headcount,
      r.presentDays,
      r.absentDays,
      r.lateDays,
      `${r.attPct}%`,
      r.otHours.toFixed(1),
      ...(canViewPayrollCost ? [Math.round(r.grossPayroll)] : []),
    ]);
    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `WorkNest_HR_Analytics_${selectedMonth}_vs_${compareMonth}.csv`;
    a.click();
  };

  const formatDelta = (curr: number, prev: number, suffix = '') => {
    const diff = curr - prev;
    if (diff === 0) return `No change vs ${compareMonth}`;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toLocaleString()}${suffix} vs ${compareMonth}`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Print/Export Controls */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl shadow-sm">
            📈
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Advanced HR Intelligence &amp; Executive Analytics
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Authoritative Workforce, Attendance, Overtime, Leave, Payroll Cost, Hiring Funnel, Attrition &amp; Shift Utilization
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handlePrintAnalytics}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
          >
            <span>🖨️</span>
            <span>Print Executive Report</span>
          </button>
          <button
            onClick={handleExportAnalyticsCsv}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
          >
            <span>📥</span>
            <span>Export Analytics CSV</span>
          </button>
        </div>
      </div>

      {/* Multi-Dimensional Filter Bar (Date, Historical Comparison Month, Branch, Department, Employee) */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1.5">
            <label className="text-xs font-bold text-slate-600">Target Month:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
            />
          </div>

          <div className="flex items-center space-x-1.5">
            <label className="text-xs font-bold text-indigo-600">Compare vs:</label>
            <input
              type="month"
              value={compareMonth}
              onChange={(e) => setCompareMonth(e.target.value)}
              className="px-2.5 py-1.5 bg-indigo-50/50 border border-indigo-200 rounded-xl text-xs font-semibold text-indigo-900"
            />
          </div>

          <div className="flex items-center space-x-1.5">
            <label className="text-xs font-bold text-slate-600">Branch:</label>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
            >
              <option value="all">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-1.5">
            <label className="text-xs font-bold text-slate-600">Department:</label>
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-1.5">
            <label className="text-xs font-bold text-slate-600">Employee:</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 max-w-[200px]"
            >
              <option value="all">All Employees ({baseEmployees.length})</option>
              {baseEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeId})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Primary KPI Grid with Historical Comparison Deltas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Headcount (Active/Total)
          </span>
          <span className="text-2xl font-black text-slate-900 mt-1 block">
            {workforceAnalytics.active} / {workforceAnalytics.total}
          </span>
          <span className="text-[11px] text-slate-500">
            {workforceAnalytics.inactive} Inactive • {workforceAnalytics.onLeave} On Leave
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
            Attendance &amp; Absence
          </span>
          <span className="text-2xl font-black text-emerald-600 mt-1 block">
            {currentMetrics.attendanceRate}%
          </span>
          <span className="text-[11px] text-emerald-700 font-semibold">
            {currentMetrics.totalPresent}P / {currentMetrics.totalAbsent}A ({formatDelta(currentMetrics.attendanceRate, comparisonMetrics.attendanceRate, '%')})
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
            Late &amp; Early Out
          </span>
          <span className="text-2xl font-black text-amber-600 mt-1 block">
            {currentMetrics.totalLate} / {currentMetrics.totalEarlyOut}
          </span>
          <span className="text-[11px] text-slate-500">
            {formatDelta(currentMetrics.totalLate, comparisonMetrics.totalLate, ' lates')}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
            Overtime Utilization
          </span>
          <span className="text-2xl font-black text-indigo-700 mt-1 block font-mono">
            {currentMetrics.totalOvertimeHours}h
          </span>
          <span className="text-[11px] text-indigo-600 font-semibold">
            {formatDelta(currentMetrics.totalOvertimeHours, comparisonMetrics.totalOvertimeHours, 'h')}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider block">
            Net Payroll Cost
          </span>
          <span className="text-xl font-black text-violet-700 mt-1 block font-mono">
            {canViewPayrollCost ? `৳${currentMetrics.totalNetPayroll.toLocaleString()}` : 'Restricted'}
          </span>
          <span className="text-[11px] text-slate-500">
            {canViewPayrollCost
              ? `Gross: ৳${currentMetrics.totalGrossPayroll.toLocaleString()}`
              : 'Authorized HR/Payroll only'}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-teal-600 uppercase tracking-wider block">
            Retention &amp; Tenure
          </span>
          <span className="text-2xl font-black text-teal-700 mt-1 block">
            {workforceAnalytics.retentionRate}%
          </span>
          <span className="text-[11px] text-slate-500">
            Avg Tenure: {workforceAnalytics.avgTenureYears} yrs ({workforceAnalytics.attritionRate}% Attrition)
          </span>
        </div>
      </div>

      {/* Historical Period Comparison Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3 mb-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-indigo-300">
              Historical Period-over-Period Comparison ({selectedMonth} vs {compareMonth})
            </h3>
            <p className="text-xs text-slate-300">
              Direct side-by-side comparison computed from authoritative attendance, roster, and payroll ledgers
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
          <div className="bg-white/5 rounded-2xl p-3.5 border border-white/10">
            <span className="text-slate-400 block">Present Man-Days</span>
            <div className="text-lg font-black mt-1">
              {currentMetrics.totalPresent} <span className="text-xs font-normal text-slate-300">vs {comparisonMetrics.totalPresent}</span>
            </div>
          </div>
          <div className="bg-white/5 rounded-2xl p-3.5 border border-white/10">
            <span className="text-slate-400 block">Absent Man-Days</span>
            <div className="text-lg font-black mt-1">
              {currentMetrics.totalAbsent} <span className="text-xs font-normal text-slate-300">vs {comparisonMetrics.totalAbsent}</span>
            </div>
          </div>
          <div className="bg-white/5 rounded-2xl p-3.5 border border-white/10">
            <span className="text-slate-400 block">Total Worked Hours</span>
            <div className="text-lg font-black mt-1 font-mono">
              {currentMetrics.totalWorkedHours}h <span className="text-xs font-normal text-slate-300">vs {comparisonMetrics.totalWorkedHours}h</span>
            </div>
          </div>
          <div className="bg-white/5 rounded-2xl p-3.5 border border-white/10">
            <span className="text-slate-400 block">Overtime Hours</span>
            <div className="text-lg font-black mt-1 font-mono">
              {currentMetrics.totalOvertimeHours}h <span className="text-xs font-normal text-slate-300">vs {comparisonMetrics.totalOvertimeHours}h</span>
            </div>
          </div>
          <div className="bg-white/5 rounded-2xl p-3.5 border border-white/10">
            <span className="text-slate-400 block">Net Payroll Cost</span>
            <div className="text-lg font-black mt-1 font-mono">
              {canViewPayrollCost ? (
                <>
                  ৳{currentMetrics.totalNetPayroll.toLocaleString()}{' '}
                  <span className="text-xs font-normal text-slate-300">
                    vs ৳{comparisonMetrics.totalNetPayroll.toLocaleString()}
                  </span>
                </>
              ) : (
                'Restricted'
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Middle Row: Hiring Funnel + Leave Utilization + Tenure & Shift Utilization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hiring Funnel */}
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div>
            <h3 className="text-base font-black text-slate-900">Recruitment &amp; Hiring Funnel</h3>
            <p className="text-xs text-slate-500">
              {workforceAnalytics.funnel.openJobs} Open Requisitions ({workforceAnalytics.funnel.openVacancies} Vacancies)
            </p>
          </div>
          <div className="space-y-2.5 text-xs">
            {[
              { label: 'Applied', count: workforceAnalytics.funnel.applied, color: 'bg-slate-600' },
              { label: 'Screening', count: workforceAnalytics.funnel.screening, color: 'bg-indigo-500' },
              { label: 'Interview', count: workforceAnalytics.funnel.interview, color: 'bg-violet-500' },
              { label: 'Offer Extended', count: workforceAnalytics.funnel.offer, color: 'bg-amber-500' },
              { label: 'Hired', count: workforceAnalytics.funnel.hired, color: 'bg-emerald-500' },
              { label: 'Rejected', count: workforceAnalytics.funnel.rejected, color: 'bg-rose-500' },
            ].map((st) => {
              const pct =
                workforceAnalytics.funnel.totalCandidates > 0
                  ? Math.round((st.count / workforceAnalytics.funnel.totalCandidates) * 100)
                  : 0;
              return (
                <div key={st.label} className="space-y-1">
                  <div className="flex justify-between font-bold text-slate-700">
                    <span>{st.label}</span>
                    <span className="font-mono">
                      {st.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${st.color}`} style={{ width: `${Math.max(4, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Leave Utilization & Employee Tenure */}
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-5">
          <div>
            <h3 className="text-base font-black text-slate-900">Leave Utilization &amp; Staff Tenure</h3>
            <p className="text-xs text-slate-500">Approved leave days by category &amp; service length</p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 rounded-2xl bg-indigo-50/60 border border-indigo-100">
              <span className="text-[10px] font-bold text-indigo-600 uppercase">Casual Leave</span>
              <p className="text-lg font-black text-indigo-900 mt-0.5">{workforceAnalytics.leaveByType.casual} Days</p>
            </div>
            <div className="p-3 rounded-2xl bg-rose-50/60 border border-rose-100">
              <span className="text-[10px] font-bold text-rose-600 uppercase">Sick Leave</span>
              <p className="text-lg font-black text-rose-900 mt-0.5">{workforceAnalytics.leaveByType.sick} Days</p>
            </div>
            <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-100">
              <span className="text-[10px] font-bold text-emerald-600 uppercase">Annual Leave</span>
              <p className="text-lg font-black text-emerald-900 mt-0.5">{workforceAnalytics.leaveByType.annual} Days</p>
            </div>
            <div className="p-3 rounded-2xl bg-amber-50/60 border border-amber-100">
              <span className="text-[10px] font-bold text-amber-600 uppercase">Unpaid Leave</span>
              <p className="text-lg font-black text-amber-900 mt-0.5">{workforceAnalytics.leaveByType.unpaid} Days</p>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Employee Tenure Distribution (Avg {workforceAnalytics.avgTenureYears} Yrs)
            </span>
            {workforceAnalytics.tenureBuckets.map((b) => (
              <div key={b.label} className="flex items-center justify-between text-slate-700 font-semibold">
                <span>{b.label}</span>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 font-mono font-bold">{b.count} Staff</span>
              </div>
            ))}
          </div>
        </div>

        {/* Shift Utilization */}
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div>
            <h3 className="text-base font-black text-slate-900">Shift Utilization &amp; Roster Efficiency</h3>
            <p className="text-xs text-slate-500">
              Authoritative shift assignment, worked hours, and overtime breakdown
            </p>
          </div>
          <div className="space-y-3">
            {currentMetrics.shiftUsage.map((sh) => (
              <div key={sh.shiftName} className="p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-black text-slate-900">{sh.shiftName}</span>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-black">
                    {sh.assignedStaff} Assigned
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>Present Logs: <strong>{sh.presentCount}</strong></span>
                  <span>Late: <strong>{sh.lateCount}</strong></span>
                  <span>OT: <strong className="font-mono text-indigo-700">{sh.otHours.toFixed(1)}h</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Department Attendance & Workforce Cost Matrix */}
      <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-black text-slate-900">
              Department Attendance, Overtime &amp; Workforce Cost Matrix ({selectedMonth})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Unified cross-module analytics combining Attendance, Overtime, and Payroll Cost
            </p>
          </div>
        </div>

        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
                <th className="pb-3">Department</th>
                <th className="pb-3 text-center">Headcount</th>
                <th className="pb-3 text-center">Present / Absent</th>
                <th className="pb-3 text-center">Late Arrivals</th>
                <th className="pb-3 text-center">Attendance Rate</th>
                <th className="pb-3 text-center">Overtime</th>
                {canViewPayrollCost && <th className="pb-3 text-right">Monthly Payroll Cost</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {departmentPerformanceRows.map((row) => (
                <tr key={row.dept} className="hover:bg-slate-50/70">
                  <td className="py-3.5 font-black text-slate-900">{row.dept}</td>
                  <td className="py-3.5 text-center font-mono font-bold">{row.headcount}</td>
                  <td className="py-3.5 text-center font-mono">
                    <span className="text-emerald-700 font-bold">{row.presentDays}P</span> /{' '}
                    <span className="text-rose-600 font-bold">{row.absentDays}A</span>
                  </td>
                  <td className="py-3.5 text-center font-mono text-amber-700 font-bold">{row.lateDays}</td>
                  <td className="py-3.5 text-center">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                        row.attPct >= 85
                          ? 'bg-emerald-100 text-emerald-800'
                          : row.attPct >= 65
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {row.attPct}%
                    </span>
                  </td>
                  <td className="py-3.5 text-center font-mono font-bold text-indigo-700">
                    {row.otHours.toFixed(1)}h
                  </td>
                  {canViewPayrollCost && (
                    <td className="py-3.5 text-right font-mono font-black text-slate-900">
                      ৳{Math.round(row.grossPayroll).toLocaleString()}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
