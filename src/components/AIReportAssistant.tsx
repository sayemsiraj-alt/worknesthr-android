import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../lib/firestoreService';
import { useData, Employee } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { formatTo12Hour } from '../utils/timeFormat';
import {
  generateReportHtml,
  printViaIframe,
  downloadReportHtml,
  PrintReportConfig,
} from '../utils/reportPrinter';
import {
  resolveEmployeeScheduleForDate,
  resolveEmployeeShiftNameForDate,
  evaluateAttendanceForSchedule,
  calculateDutyDuration,
  calculateOvertimeHours,
  findShiftByNameOrId,
  isShiftOvertimeEnabled,
  isEveningOrOvernight,
  getBangladeshTodayStr,
  getEmployeeShiftWorkingHours,
  isEmployeeEligibleForAttendance,
} from '../utils/attendanceScheduleEngine';
import { Page } from '../App';

type Props = {
  onNavigate?: (page: Page) => void;
};

type ReportTableData = {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  kpis?: { label: string; value: string; color?: string }[];
  actionType?: 'send_late_warnings' | 'send_punctual_appreciation';
  targetEmployeeIds?: string[];
};

type ChatItem = {
  id: string;
  sender: 'user' | 'ai';
  time: string;
  text: string;
  report?: ReportTableData;
};

type LetterTemplateType =
  | 'late_warning'
  | 'appreciation'
  | 'salary_certificate'
  | 'appointment'
  | 'increment'
  | 'office_notice';

export function AIReportAssistant({ onNavigate }: Props) {
  const {
    employees,
    departments,
    branches,
    shifts,
    roster,
    leaveRequests,
    attendanceRequests,
    sendMessage,
    addNotification,
    currentUser,
    offboardingRecords,
  } = useData();
  const { currentCompanyId, currentCompany } = useTenant();

  // Studio Mode Tabs
  const [activeStudioTab, setActiveStudioTab] = useState<'chat' | 'letters' | 'audit'>('chat');

  // Selected Date, Month & Branch Filter for Reports
  const [todayStr] = useState(() => getBangladeshTodayStr());
  const [selectedDate, setSelectedDate] = useState<string>(() => getBangladeshTodayStr());
  const [selectedMonth, setSelectedMonth] = useState(() => getBangladeshTodayStr().slice(0, 7));
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>('ALL');

  // Real-time Firestore Attendance & Payroll Records
  const [cloudAttendance, setCloudAttendance] = useState<any[]>([]);
  const [cloudPayrollRecords, setCloudPayrollRecords] = useState<Record<string, any>>(() => {
    try {
      const saved = localStorage.getItem('worknest_payroll_monthly_records');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Subscribe to Firestore attendance & payroll records
  useEffect(() => {
    const activeComp = currentCompanyId || 'default';
    try {
      const unsubAtt = onSnapshot(
        collection(db, 'attendance'),
        snap => {
          const list: any[] = [];
          snap.forEach(d => {
            const data = d.data();
            const docComp = data.companyId || 'default';
            const matches = activeComp !== 'default' ? docComp === activeComp : !data.companyId || docComp === 'default';
            if (matches) {
              list.push({ id: d.id, ...data });
            }
          });
          setCloudAttendance(list);
        },
        () => {}
      );

      const unsubPay = onSnapshot(
        doc(db, 'settings', `payroll_records_${activeComp}`),
        snap => {
          if (snap.exists()) {
            const data = snap.data();
            if (data?.records && typeof data.records === 'object') {
              setCloudPayrollRecords(prev => ({ ...prev, ...data.records }));
            }
          }
        },
        () => {}
      );

      return () => {
        unsubAtt();
        unsubPay();
      };
    } catch {}
  }, [currentCompanyId]);

  const formatMonthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) return ym;
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Filtered employees by branch
  const filteredEmployees = useMemo(() => {
    if (selectedBranchFilter === 'ALL') return employees;
    return employees.filter(
      e => (e.branch || 'Main Head Office (Dhaka)').toLowerCase() === selectedBranchFilter.toLowerCase()
    );
  }, [employees, selectedBranchFilter]);

  // =========================================================================
  // COMPREHENSIVE REAL-TIME EMPLOYEE ANALYTICS ENGINE
  // Computes exact attendance, late dates, overtime, leave & salary per employee
  // =========================================================================
  const employeeAnalytics = useMemo(() => {
    const [selY, selM] = selectedMonth.split('-').map(Number);
    const totalDaysInMonth = selY && selM ? new Date(selY, selM, 0).getDate() : 30;

    return filteredEmployees.map(emp => {
      const empAttList = cloudAttendance.filter(
        a =>
          (a.employeeId === emp.id || a.employeeId === emp.employeeId) &&
          a.date &&
          String(a.date).startsWith(selectedMonth)
      );

      // Today's record
      const todayRec = cloudAttendance.find(
        a => (a.employeeId === emp.id || a.employeeId === emp.employeeId) && a.date === todayStr
      );
      const todaySched = resolveEmployeeScheduleForDate(emp, todayStr, roster, shifts, todayRec?.shiftName);
      const todayShiftName = resolveEmployeeShiftNameForDate(emp, todayStr, todayRec?.shiftName);
      const todayIn = todayRec?.firstPunchIn || todayRec?.checkIn || '-';
      const todayOut =
        todayRec?.checkOut && todayRec.checkOut !== '-' && todayRec.checkOut !== todayIn
          ? todayRec.checkOut
          : todayRec?.lastPunchOut && todayRec.lastPunchOut !== '-' && todayRec.lastPunchOut !== todayIn
          ? todayRec.lastPunchOut
          : '-';
      const todayEval =
        todayRec && (todayIn !== '-' || todayOut !== '-' || todayRec.status)
          ? evaluateAttendanceForSchedule(todayIn, todayOut, todaySched, todayRec, todayShiftName)
          : { status: 'absent' };
      const isTodayOnLeave = leaveRequests.some(
        l =>
          (l.employeeId === emp.id || l.employeeId === emp.employeeId) &&
          l.status === 'approved' &&
          todayStr >= l.from &&
          todayStr <= l.to
      );

      let presentDays = 0;
      let totalLate = 0;
      let excusedLate = 0;
      let unexcusedLate = 0;
      let weekendPresentDays = 0;
      let overtimeMinutes = 0;
      let explicitAbsentDays = 0;
      let unpunchedPastDays = 0;
      let missingCheckoutDays = 0;
      const lateDates: { date: string; checkIn: string; waived: boolean }[] = [];

      for (let d = 1; d <= totalDaysInMonth; d++) {
        const dateStr = `${selY}-${String(selM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const attRecord = empAttList.find(a => a.date === dateStr);
        const sched = resolveEmployeeScheduleForDate(emp, dateStr, roster, shifts, attRecord?.shiftName);
        const dateShiftName = resolveEmployeeShiftNameForDate(emp, dateStr, attRecord?.shiftName);
        const isWeekend = Boolean(sched?.isWeekend || sched?.isOff);

        const activeLeave = leaveRequests.find(
          l =>
            (l.employeeId === emp.id || l.employeeId === emp.employeeId) &&
            l.status === 'approved' &&
            dateStr >= l.from &&
            dateStr <= l.to
        );

        const rawIn = attRecord?.firstPunchIn || attRecord?.checkIn || '-';
        let rawOut =
          attRecord?.checkOut && attRecord.checkOut !== '-' && attRecord.checkOut !== rawIn
            ? String(attRecord.checkOut)
            : attRecord?.lastPunchOut && attRecord.lastPunchOut !== '-' && attRecord.lastPunchOut !== rawIn
            ? String(attRecord.lastPunchOut)
            : '-';
        if (rawOut === rawIn || attRecord?.totalPunches === 1) rawOut = '-';

        const hasPunch = rawIn !== '-' || rawOut !== '-';
        let resolvedStatus = '';
        if (attRecord && (hasPunch || attRecord.status)) {
          const evalRes = evaluateAttendanceForSchedule(rawIn, rawOut, sched, attRecord, dateShiftName);
          resolvedStatus = evalRes.status;
        }

        const isPresent = Boolean(
          attRecord &&
            (hasPunch || ['present', 'late', 'half_day'].includes(resolvedStatus)) &&
            resolvedStatus !== 'absent' &&
            resolvedStatus !== 'weekend_off'
        );

        if (isPresent) {
          presentDays++;
          if (isWeekend) weekendPresentDays++;
          if (rawIn !== '-' && rawOut === '-' && dateStr < todayStr) {
            missingCheckoutDays++;
          }
          if (resolvedStatus === 'late') {
            const isWaived =
              Boolean(attRecord.isLateExcused || attRecord.lateWaived) ||
              attendanceRequests.some(
                r =>
                  (r.employeeId === emp.id || r.employeeId === emp.employeeId) &&
                  r.date === dateStr &&
                  r.type === 'late_arrival' &&
                  r.status === 'approved'
              );
            totalLate++;
            if (isWaived) excusedLate++;
            else unexcusedLate++;
            lateDates.push({ date: dateStr, checkIn: String(rawIn), waived: isWaived });
          }

          const effShift =
            sched?.shift ||
            findShiftByNameOrId(shifts, sched?.shiftName) ||
            findShiftByNameOrId(shifts, dateShiftName);
          const isOtAllowed =
            !sched?.isWeekend &&
            !sched?.isOff &&
            sched?.overtimePolicyEnabled !== false &&
            isShiftOvertimeEnabled(effShift);
          const isOvernight = Boolean(
            attRecord.isOvernight || sched?.isOvernight || (sched && isEveningOrOvernight(sched))
          );
          const calcOt = isOtAllowed
            ? calculateOvertimeHours(String(rawIn), String(rawOut), {
                ...sched,
                shift: effShift || sched?.shift,
                overtimePolicyEnabled: isOtAllowed,
                isOvernight,
              })
            : 0;
          const otHours = !isOtAllowed
            ? 0
            : attRecord.source === 'admin_edit' && attRecord.otHours !== undefined
            ? Number(attRecord.otHours)
            : calcOt;

          if (otHours > 0) {
            overtimeMinutes += Math.round(otHours * 60);
          }
        } else if (attRecord && resolvedStatus === 'absent') {
          explicitAbsentDays++;
        } else if (!activeLeave && !isWeekend && dateStr <= todayStr && empAttList.length > 0) {
          unpunchedPastDays++;
        }
      }

      // Salary Calculation
      const monthlyRec =
        cloudPayrollRecords[`${selectedMonth}_${emp.id}`] ||
        cloudPayrollRecords[`${selectedMonth}_${emp.employeeId}`] ||
        null;
      const isV2 = Boolean(monthlyRec?.manualOverrideV2);

      const rawBasic =
        Number(emp.basicSalary ?? emp.basic) ||
        (emp.grossSalary ? Math.round(Number(emp.grossSalary) * 0.5) : 25000);
      const rawHra = Number(emp.houseRent) || Math.round(rawBasic * 0.6);
      const rawMed = Number(emp.medical) || Math.round(rawBasic * 0.2);
      const rawConv = Number(emp.conveyance ?? emp.transport) || Math.round(rawBasic * 0.2);
      const rawFood = Number(emp.food) || 0;

      const basicSalary =
        monthlyRec?.manuallyEdited && monthlyRec?.basicSalary !== undefined
          ? Number(monthlyRec.basicSalary)
          : rawBasic;
      const grossSalary = monthlyRec?.manuallyEdited
        ? basicSalary +
          (Number(monthlyRec.houseRent) || rawHra) +
          (Number(monthlyRec.medical) || rawMed) +
          (Number(monthlyRec.conveyance) || rawConv) +
          (Number(monthlyRec.food) || rawFood)
        : Number(emp.grossSalary) || basicSalary + rawHra + rawMed + rawConv + rawFood;

      const oneDayGross = grossSalary / 30;
      const latePenaltyDays = Math.floor(unexcusedLate / 3);
      const lateCut =
        isV2 && monthlyRec?.lateDeduction !== undefined && Number(monthlyRec.lateDeduction) > 0
          ? Number(monthlyRec.lateDeduction)
          : Math.round(latePenaltyDays * oneDayGross);

      const computedAbsent = explicitAbsentDays + unpunchedPastDays;
      const absentDays =
        isV2 && monthlyRec?.absentDays !== undefined
          ? Number(monthlyRec.absentDays)
          : Math.max(Number(monthlyRec?.absentDays) || 0, computedAbsent);
      const absentCut = monthlyRec?.absentDeductionManualZeroV2
        ? 0
        : isV2 && Number(monthlyRec?.absentDeduction) > 0
        ? Number(monthlyRec.absentDeduction)
        : Math.round(absentDays * oneDayGross);

      const overtimeHours =
        isV2 && monthlyRec?.overtimeHours !== undefined
          ? Number(monthlyRec.overtimeHours)
          : Number((overtimeMinutes / 60).toFixed(1));
      const shiftHours = getEmployeeShiftWorkingHours(emp, shifts, roster, selectedMonth, empAttList);
      const otRate =
        monthlyRec?.overtimeRateCustomOverride && Number(monthlyRec?.overtimeRate) > 0
          ? Number(monthlyRec.overtimeRate)
          : (basicSalary / 30 / (monthlyRec?.shiftWorkingHours || shiftHours || 8)) * 1.5;
      const overtimePay = Math.round(overtimeHours * otRate);

      const wkDays =
        isV2 && monthlyRec?.weekendDays !== undefined ? Number(monthlyRec.weekendDays) : weekendPresentDays;
      const weekendAllowance =
        isV2 && monthlyRec?.weekendAllowanceManualZero && monthlyRec?.weekendAllowanceCustomOverride
          ? 0
          : monthlyRec?.weekendAllowanceCustomOverride && Number(monthlyRec?.weekendAllowance) > 0
          ? Number(monthlyRec.weekendAllowance)
          : Math.round(wkDays * oneDayGross);

      const bonus =
        (Number(monthlyRec?.attendanceBonus ?? emp.attendanceBonus) || 0) +
        (Number(monthlyRec?.festivalBonus) || 0) +
        (Number(monthlyRec?.otherAllowance) || 0);

      const pfTaxAdvance =
        (Number(monthlyRec?.pfDeduction) || 0) +
        (Number(monthlyRec?.taxDeduction) || 0) +
        (Number(monthlyRec?.advanceDeduction) || 0) +
        (Number(monthlyRec?.loanDeduction) || 0) +
        (Number(monthlyRec?.otherDeduction) || 0);

      const totalEarnings = grossSalary + weekendAllowance + overtimePay + bonus;
      const totalDeductions = lateCut + absentCut + pfTaxAdvance;
      const netPayable = Math.max(0, totalEarnings - totalDeductions);

      // Punctuality & Performance Score (out of 100)
      const punctualityScore = Math.max(
        0,
        Math.min(100, 100 - unexcusedLate * 8 - absentDays * 12 + Math.min(10, Math.round(overtimeHours)))
      );

      // Approved Leaves Used
      const empApprovedLeaves = leaveRequests.filter(
        l => (l.employeeId === emp.id || l.employeeId === emp.employeeId) && l.status === 'approved'
      );
      const totalLeaveDaysUsed = empApprovedLeaves.reduce((s, l) => s + (Number(l.days) || 0), 0);

      return {
        emp,
        todayIn,
        todayOut,
        todayStatus: isTodayOnLeave
          ? 'on_leave'
          : todayIn !== '-' || todayOut !== '-'
          ? todayEval.status || 'present'
          : 'absent',
        presentDays,
        totalLate,
        excusedLate,
        unexcusedLate,
        latePenaltyDays,
        lateCut,
        lateDates,
        absentDays,
        absentCut,
        missingCheckoutDays,
        overtimeHours,
        overtimePay,
        weekendDays: wkDays,
        weekendAllowance,
        grossSalary,
        basicSalary,
        totalEarnings,
        totalDeductions,
        netPayable,
        punctualityScore,
        totalLeaveDaysUsed,
      };
    });
  }, [
    filteredEmployees,
    cloudAttendance,
    selectedMonth,
    todayStr,
    roster,
    shifts,
    leaveRequests,
    attendanceRequests,
    cloudPayrollRecords,
  ]);

  // =========================================================================
  // REPORT GENERATOR FUNCTIONS (100% Free & Instant)
  // =========================================================================
  const buildDailyAttendanceReport = (targetDate?: string): { text: string; report: ReportTableData } => {
    const theDate = targetDate || selectedDate || todayStr;
    const isToday = theDate === todayStr;

    let presentCount = 0;
    let lateCount = 0;
    let leaveCount = 0;
    let absentCount = 0;
    let weekendOffCount = 0;

    const eligibleEmployees = filteredEmployees.filter(emp => {
      const attRecord = cloudAttendance.find(
        a => (a.employeeId === emp.id || a.employeeId === emp.employeeId) && a.date === theDate
      );
      const rawIn = attRecord?.firstPunchIn || attRecord?.checkIn || '-';
      const rawOut = attRecord?.checkOut && attRecord.checkOut !== '-' ? attRecord.checkOut : attRecord?.lastPunchOut || '-';
      const hasActualPunch = (rawIn !== '-' || (rawOut !== '-' && rawOut !== rawIn));
      const offRecord = offboardingRecords?.find(
        r => (emp.id && r.employeeId === emp.id) || (emp.employeeId && (r.employeeCode === emp.employeeId || r.employeeId === emp.employeeId))
      );
      return isEmployeeEligibleForAttendance(emp, theDate, hasActualPunch, offRecord);
    });

    const rows: (string | number)[][] = eligibleEmployees.map(emp => {
      const attRecord = cloudAttendance.find(
        a => (a.employeeId === emp.id || a.employeeId === emp.employeeId) && a.date === theDate
      );
      const sched = resolveEmployeeScheduleForDate(emp, theDate, roster, shifts, attRecord?.shiftName);
      const dateShiftName = resolveEmployeeShiftNameForDate(emp, theDate, attRecord?.shiftName);
      const isWeekend = Boolean(sched?.isWeekend || sched?.isOff);

      const activeLeave = leaveRequests.find(
        l =>
          (l.employeeId === emp.id || l.employeeId === emp.employeeId) &&
          l.status === 'approved' &&
          theDate >= l.from &&
          theDate <= l.to
      );

      const rawIn = attRecord?.firstPunchIn || attRecord?.checkIn || '-';
      let rawOut =
        attRecord?.checkOut && attRecord.checkOut !== '-' && attRecord.checkOut !== rawIn
          ? String(attRecord.checkOut)
          : attRecord?.lastPunchOut && attRecord.lastPunchOut !== '-' && attRecord.lastPunchOut !== rawIn
          ? String(attRecord.lastPunchOut)
          : '-';
      if (rawOut === rawIn || attRecord?.totalPunches === 1) rawOut = '-';

      const hasPunch = rawIn !== '-' || rawOut !== '-';
      let resolvedStatus = '';
      if (attRecord && (hasPunch || attRecord.status)) {
        const evalRes = evaluateAttendanceForSchedule(rawIn, rawOut, sched, attRecord, dateShiftName);
        resolvedStatus = evalRes.status;
      }

      let finalStatus = 'ABSENT';
      if (activeLeave) {
        finalStatus = 'ON LEAVE';
        leaveCount++;
      } else if (hasPunch || ['present', 'late', 'half_day'].includes(resolvedStatus)) {
        if (resolvedStatus === 'late') {
          finalStatus = 'LATE';
          lateCount++;
          presentCount++;
        } else if (resolvedStatus === 'half_day') {
          finalStatus = 'HALF DAY';
          presentCount++;
        } else {
          finalStatus = 'PRESENT';
          presentCount++;
        }
      } else if (isWeekend) {
        finalStatus = 'WEEKEND OFF';
        weekendOffCount++;
      } else if (theDate > todayStr) {
        finalStatus = 'SCHEDULED';
      } else {
        finalStatus = 'ABSENT';
        absentCount++;
      }

      // Calculate duty duration
      let durationText = '-';
      if (rawIn !== '-' && rawOut !== '-') {
        const isOvernight = Boolean(
          attRecord?.isOvernight || sched?.isOvernight || (sched && isEveningOrOvernight(sched))
        );
        const { durationHours, durationMinutes } = calculateDutyDuration(rawIn, rawOut, isOvernight);
        if (durationHours > 0 || durationMinutes > 0) {
          durationText = `${durationHours}h ${durationMinutes}m`;
        }
      }

      // Calculate daily OT
      let otText = '-';
      if (rawIn !== '-' && rawOut !== '-') {
        const effShift =
          sched?.shift ||
          findShiftByNameOrId(shifts, sched?.shiftName) ||
          findShiftByNameOrId(shifts, dateShiftName);
        const isOtAllowed =
          !sched?.isWeekend &&
          !sched?.isOff &&
          sched?.overtimePolicyEnabled !== false &&
          isShiftOvertimeEnabled(effShift);
        const isOvernight = Boolean(
          attRecord?.isOvernight || sched?.isOvernight || (sched && isEveningOrOvernight(sched))
        );
        const calcOt = isOtAllowed
          ? calculateOvertimeHours(String(rawIn), String(rawOut), {
              ...sched,
              shift: effShift || sched?.shift,
              overtimePolicyEnabled: isOtAllowed,
              isOvernight,
            })
          : 0;
        const otHours = !isOtAllowed
          ? 0
          : attRecord?.source === 'admin_edit' && attRecord?.otHours !== undefined
          ? Number(attRecord.otHours)
          : calcOt;
        if (otHours > 0) {
          otText = `${otHours.toFixed(1)}h`;
        }
      }

      return [
        emp.employeeId,
        emp.name,
        emp.designation || 'Staff',
        emp.department || 'General',
        emp.branch || 'Head Office',
        dateShiftName || sched?.shiftName || emp.shift || 'General',
        rawIn !== '-' ? formatTo12Hour(rawIn) : '-',
        rawOut !== '-' ? formatTo12Hour(rawOut) : '-',
        durationText,
        otText,
        finalStatus,
      ];
    });

    const [tY, tM, tD] = theDate.split('-').map(Number);
    const dateObj = tY && tM && tD ? new Date(tY, tM - 1, tD) : new Date();
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    const summaryText = `📅 **Daily Attendance Report for ${formattedDate} (${theDate})**:\n` +
      `• Total Employees: ${filteredEmployees.length} | Present: ${presentCount}\n` +
      `• On-Time Present: ${Math.max(0, presentCount - lateCount)} | Late Arrivals: ${lateCount}\n` +
      `• Approved Leave: ${leaveCount} | Weekend Off: ${weekendOffCount}\n` +
      `• Absent / Pending Check-In: ${absentCount}`;

    return {
      text: summaryText,
      report: {
        title: `Daily Attendance Report — ${theDate} ${isToday ? "(Today's Live Report)" : ''}`,
        subtitle: `Date: ${formattedDate} (${theDate}) • Branch: ${selectedBranchFilter === 'ALL' ? 'All Branches' : selectedBranchFilter} • Total: ${filteredEmployees.length} Staff`,
        kpis: [
          { label: 'Total Staff', value: `${filteredEmployees.length}`, color: 'indigo' },
          { label: isToday ? 'Present Today' : 'Present Staff', value: `${presentCount} / ${filteredEmployees.length}`, color: 'emerald' },
          { label: 'Late Arrival', value: `${lateCount} Staff`, color: 'amber' },
          { label: 'On Approved Leave', value: `${leaveCount} Staff`, color: 'purple' },
          { label: 'Absent / Unpunched', value: `${absentCount} Staff`, color: 'rose' },
        ],
        headers: [
          'Employee ID',
          'Name',
          'Designation',
          'Department',
          'Branch',
          'Shift',
          'First In',
          'Last Out',
          'Duration',
          'OT',
          'Status',
        ],
        rows,
      },
    };
  };

  const buildTodayAttendanceReport = (): { text: string; report: ReportTableData } => {
    return buildDailyAttendanceReport(todayStr);
  };

  const buildThreeDaysLateReport = (): { text: string; report: ReportTableData } => {
    const threePlusLate = employeeAnalytics.filter(a => a.totalLate >= 3);
    const anyLate = employeeAnalytics.filter(a => a.totalLate > 0).sort((a, b) => b.totalLate - a.totalLate);
    const totalDeduction = anyLate.reduce((s, a) => s + a.lateCut, 0);

    return {
      text: `🚨 Disciplinary & Late Attendance Audit completed for ${formatMonthLabel(selectedMonth)}. Total ${threePlusLate.length} employees have 3 or more late arrivals (with official warning letters on their portal), and total penalty deduction is ৳${totalDeduction.toLocaleString()}.`,
      report: {
        title: `3+ Days Late Disciplinary & Salary Penalty Report — ${formatMonthLabel(selectedMonth)}`,
        subtitle: `Rule: Every 3 Unexcused Late Days = 1 Day Salary Deduction • Total Late Penalty: ৳${totalDeduction.toLocaleString()}`,
        kpis: [
          { label: '3+ Days Late (Warning)', value: `${threePlusLate.length} Staff`, color: 'rose' },
          { label: 'Total Late Staff', value: `${anyLate.length} Staff`, color: 'amber' },
          { label: 'Total Late Salary Cut', value: `৳ ${totalDeduction.toLocaleString()}`, color: 'rose' },
          {
            label: '100% On-Time Staff',
            value: `${employeeAnalytics.length - anyLate.length} Staff`,
            color: 'emerald',
          },
        ],
        headers: [
          'Employee ID',
          'Name',
          'Department',
          'Total Late',
          'Waived',
          'Unexcused Late',
          'Penalty Days',
          'Salary Cut (৳)',
          'Late Dates',
        ],
        rows: (anyLate.length > 0 ? anyLate : employeeAnalytics).map(a => [
          a.emp.employeeId,
          a.emp.name,
          a.emp.department,
          `${a.totalLate} Days`,
          `${a.excusedLate} Days`,
          `${a.unexcusedLate} Days`,
          `${a.latePenaltyDays} Day(s)`,
          `৳ ${a.lateCut.toLocaleString()}`,
          a.lateDates.map(d => `${d.date} (${formatTo12Hour(d.checkIn)})`).join(', ') || 'None',
        ]),
        actionType: threePlusLate.length > 0 ? 'send_late_warnings' : undefined,
        targetEmployeeIds: threePlusLate.map(a => a.emp.id),
      },
    };
  };

  const buildPayrollReport = (): { text: string; report: ReportTableData } => {
    const totalGross = employeeAnalytics.reduce((s, a) => s + a.grossSalary, 0);
    const totalOt = employeeAnalytics.reduce((s, a) => s + a.overtimePay, 0);
    const totalDeductions = employeeAnalytics.reduce((s, a) => s + a.totalDeductions, 0);
    const totalNet = employeeAnalytics.reduce((s, a) => s + a.netPayable, 0);

    return {
      text: `💰 Master Payroll & Salary Sheet generated for ${formatMonthLabel(selectedMonth)}. Total ${employeeAnalytics.length} staff: Gross ৳${totalGross.toLocaleString()}, Overtime Pay ৳${totalOt.toLocaleString()}, Deductions ৳${totalDeductions.toLocaleString()}, and Net Payable ৳${totalNet.toLocaleString()}.`,
      report: {
        title: `Monthly Payroll, Overtime & Deduction Master Sheet — ${formatMonthLabel(selectedMonth)}`,
        subtitle: `Branch: ${selectedBranchFilter === 'ALL' ? 'All Branches' : selectedBranchFilter} • Net Payable: ৳${totalNet.toLocaleString()}`,
        kpis: [
          { label: 'Total Gross Salary', value: `৳ ${totalGross.toLocaleString()}`, color: 'indigo' },
          { label: 'Total Overtime Pay', value: `৳ ${totalOt.toLocaleString()}`, color: 'emerald' },
          { label: 'Total Deductions', value: `৳ ${totalDeductions.toLocaleString()}`, color: 'rose' },
          { label: 'Total Net Payable', value: `৳ ${totalNet.toLocaleString()}`, color: 'emerald' },
        ],
        headers: [
          'Employee ID',
          'Name',
          'Designation',
          'Gross Salary',
          'Present',
          'OT Hours',
          'OT Pay (৳)',
          'Weekend Pay (৳)',
          'Late/Absent Cut (৳)',
          'Net Salary (৳)',
        ],
        rows: employeeAnalytics.map(a => [
          a.emp.employeeId,
          a.emp.name,
          a.emp.designation,
          `৳ ${a.grossSalary.toLocaleString()}`,
          `${a.presentDays}d`,
          `${a.overtimeHours}h`,
          `৳ ${a.overtimePay.toLocaleString()}`,
          `৳ ${a.weekendAllowance.toLocaleString()}`,
          `৳ ${(a.lateCut + a.absentCut).toLocaleString()}`,
          `৳ ${a.netPayable.toLocaleString()}`,
        ]),
      },
    };
  };

  const buildTopPerformersReport = (): { text: string; report: ReportTableData } => {
    const ranked = [...employeeAnalytics].sort((a, b) => {
      if (b.punctualityScore !== a.punctualityScore) return b.punctualityScore - a.punctualityScore;
      if (b.presentDays !== a.presentDays) return b.presentDays - a.presentDays;
      return b.overtimeHours - a.overtimeHours;
    });
    const zeroLateStaff = ranked.filter(a => a.unexcusedLate === 0);

    return {
      text: `🏆 Top Punctual & Best Performer Ranking generated for ${formatMonthLabel(selectedMonth)}! Total ${zeroLateStaff.length} employees had zero unexcused late arrivals this month. #1 Ranked is ${ranked[0]?.emp.name || 'N/A'} (Score: ${ranked[0]?.punctualityScore || 100}/100).`,
      report: {
        title: `Top Punctual & Best Performer Ranking — ${formatMonthLabel(selectedMonth)}`,
        subtitle: `Evaluated by Punctuality (0 Late), Attendance Regularity, and Overtime Contribution`,
        kpis: [
          { label: '#1 Top Performer', value: ranked[0]?.emp.name || 'N/A', color: 'emerald' },
          { label: 'Zero-Late Employees', value: `${zeroLateStaff.length} Staff`, color: 'indigo' },
          {
            label: 'Avg Punctuality Score',
            value: `${
              ranked.length > 0
                ? Math.round(ranked.reduce((s, a) => s + a.punctualityScore, 0) / ranked.length)
                : 100
            }%`,
            color: 'emerald',
          },
        ],
        headers: [
          'Rank',
          'Employee ID',
          'Name',
          'Department',
          'Present Days',
          'Unexcused Late',
          'Absent Days',
          'OT Hours',
          'Punctuality Score',
        ],
        rows: ranked.map((a, idx) => [
          `#${idx + 1}`,
          a.emp.employeeId,
          a.emp.name,
          a.emp.department,
          `${a.presentDays} Days`,
          `${a.unexcusedLate} Days`,
          `${a.absentDays} Days`,
          `${a.overtimeHours} hrs`,
          `${a.punctualityScore} / 100`,
        ]),
        actionType: zeroLateStaff.length > 0 ? 'send_punctual_appreciation' : undefined,
        targetEmployeeIds: zeroLateStaff.slice(0, 5).map(a => a.emp.id),
      },
    };
  };

  const buildOvertimeReport = (): { text: string; report: ReportTableData } => {
    const otStaff = [...employeeAnalytics].sort((a, b) => b.overtimeHours - a.overtimeHours);
    const totalOtHours = otStaff.reduce((s, a) => s + a.overtimeHours, 0);
    const totalOtPay = otStaff.reduce((s, a) => s + a.overtimePay, 0);
    const totalWkPay = otStaff.reduce((s, a) => s + a.weekendAllowance, 0);

    return {
      text: `⏱️ Overtime & Weekend Duty Report generated for ${formatMonthLabel(selectedMonth)}. Total overtime: ${totalOtHours.toFixed(1)} hours (৳${totalOtPay.toLocaleString()}) and weekend duty allowance: ৳${totalWkPay.toLocaleString()}.`,
      report: {
        title: `Overtime & Weekend Duty Financial Report — ${formatMonthLabel(selectedMonth)}`,
        subtitle: `Total Overtime: ${totalOtHours.toFixed(1)} Hours • Total OT + Weekend Cost: ৳${(totalOtPay + totalWkPay).toLocaleString()}`,
        kpis: [
          { label: 'Total OT Hours', value: `${totalOtHours.toFixed(1)} hrs`, color: 'indigo' },
          { label: 'Total OT Amount', value: `৳ ${totalOtPay.toLocaleString()}`, color: 'emerald' },
          { label: 'Weekend Duty Pay', value: `৳ ${totalWkPay.toLocaleString()}`, color: 'amber' },
        ],
        headers: [
          'Employee ID',
          'Name',
          'Department',
          'Shift',
          'OT Hours',
          'OT Pay (৳)',
          'Weekend Duty Days',
          'Weekend Allowance (৳)',
        ],
        rows: otStaff.map(a => [
          a.emp.employeeId,
          a.emp.name,
          a.emp.department,
          a.emp.shift || 'General',
          `${a.overtimeHours} hrs`,
          `৳ ${a.overtimePay.toLocaleString()}`,
          `${a.weekendDays} Days`,
          `৳ ${a.weekendAllowance.toLocaleString()}`,
        ]),
      },
    };
  };

  const buildLeaveAndWaiverReport = (): { text: string; report: ReportTableData } => {
    const pendingLeaves = leaveRequests.filter(l => l.status === 'pending');
    const approvedLeaves = leaveRequests.filter(l => l.status === 'approved');
    const withFiles = leaveRequests.filter(l => Boolean(l.attachmentDataUrl && l.attachmentName));
    const pendingWaivers = attendanceRequests.filter(r => r.status === 'pending');

    return {
      text: `🏖️ Leave & Waiver Audit Report: ${leaveRequests.length} total leave requests (${pendingLeaves.length} pending, ${approvedLeaves.length} approved, ${withFiles.length} with Word/PDF documents), and ${pendingWaivers.length} pending late waivers.`,
      report: {
        title: `Leave Applications & Supporting Document Audit Report`,
        subtitle: `Total Leave Requests: ${leaveRequests.length} • Pending Approval: ${pendingLeaves.length} • Word/PDF Attached: ${withFiles.length}`,
        kpis: [
          { label: 'Pending Leaves', value: `${pendingLeaves.length}`, color: 'amber' },
          { label: 'Approved Leaves', value: `${approvedLeaves.length}`, color: 'emerald' },
          { label: 'Word/PDF Attached', value: `${withFiles.length} Files`, color: 'indigo' },
          { label: 'Pending Late Waivers', value: `${pendingWaivers.length}`, color: 'rose' },
        ],
        headers: [
          'Applicant Name',
          'Department',
          'Leave Type',
          'Duration',
          'Days',
          'Attached File (Word/PDF)',
          'Admin Justification',
          'Status',
        ],
        rows: leaveRequests.map(l => [
          l.employeeName,
          l.department || 'General',
          l.type,
          `${l.from} to ${l.to}`,
          l.days,
          l.attachmentName ? `📎 ${l.attachmentName}` : 'No File',
          l.adminRemarks || 'Pending Review',
          l.status.toUpperCase(),
        ]),
      },
    };
  };

  const buildBranchAndDeptReport = (): { text: string; report: ReportTableData } => {
    const deptRows = departments.map(dept => {
      const deptStaff = employeeAnalytics.filter(
        a => (a.emp.department || '').toLowerCase() === dept.name.toLowerCase()
      );
      const deptSalary = deptStaff.reduce((s, a) => s + a.netPayable, 0);
      const deptLate = deptStaff.reduce((s, a) => s + a.totalLate, 0);
      const deptOt = deptStaff.reduce((s, a) => s + a.overtimeHours, 0);
      return [
        dept.name,
        dept.head || 'N/A',
        `${deptStaff.length} Staff`,
        `${deptLate} Days`,
        `${deptOt.toFixed(1)} hrs`,
        `৳ ${deptSalary.toLocaleString()}`,
      ];
    });

    return {
      text: `🏢 Branch & Department Headcount and Monthly Payroll Breakdown generated. Currently ${branches.length} branches and ${departments.length} departments are active.`,
      report: {
        title: `Department & Branch Workforce & Financial Breakdown — ${formatMonthLabel(selectedMonth)}`,
        subtitle: `Total Active Branches: ${branches.length} • Total Active Departments: ${departments.length}`,
        kpis: [
          { label: 'Total Branches', value: `${branches.length}`, color: 'indigo' },
          { label: 'Total Departments', value: `${departments.length}`, color: 'emerald' },
          { label: 'Active Workforce', value: `${employeeAnalytics.length} Staff`, color: 'indigo' },
        ],
        headers: ['Department Name', 'Department Head', 'Headcount', 'Total Late Days', 'Total OT Hours', 'Monthly Net Payroll (৳)'],
        rows: deptRows,
      },
    };
  };

  const buildMissingCheckoutAuditReport = (): { text: string; report: ReportTableData } => {
    const flagged = employeeAnalytics.filter(a => a.missingCheckoutDays > 0 || a.absentDays > 0);
    return {
      text: `⚠️ Missing Checkout & Absenteeism Audit: Found ${flagged.length} employees with missing checkout punches or recorded absences in ${formatMonthLabel(selectedMonth)}.`,
      report: {
        title: `Missing Check-Out & Absenteeism Audit — ${formatMonthLabel(selectedMonth)}`,
        subtitle: `Identifies incomplete biometric/camera punches and unexcused absences`,
        kpis: [
          { label: 'Flagged Employees', value: `${flagged.length} Staff`, color: 'amber' },
          {
            label: 'Total Absent Days',
            value: `${employeeAnalytics.reduce((s, a) => s + a.absentDays, 0)} Days`,
            color: 'rose',
          },
          {
            label: 'Missing Check-Outs',
            value: `${employeeAnalytics.reduce((s, a) => s + a.missingCheckoutDays, 0)} Days`,
            color: 'amber',
          },
        ],
        headers: [
          'Employee ID',
          'Name',
          'Department',
          'Present Days',
          'Missing Check-Out Days',
          'Absent Days',
          'Absent Salary Cut (৳)',
        ],
        rows: (flagged.length > 0 ? flagged : employeeAnalytics).map(a => [
          a.emp.employeeId,
          a.emp.name,
          a.emp.department,
          `${a.presentDays} Days`,
          `${a.missingCheckoutDays} Days`,
          `${a.absentDays} Days`,
          `৳ ${a.absentCut.toLocaleString()}`,
        ]),
      },
    };
  };

  const buildSingleEmployeeDossier = (item: (typeof employeeAnalytics)[0]): { text: string; report: ReportTableData } => {
    return {
      text: `👤 Comprehensive 360° Profile & Audit Report for **${item.emp.name}** (${item.emp.employeeId} • ${item.emp.designation}, ${item.emp.department}) in ${formatMonthLabel(selectedMonth)}. Present: ${item.presentDays} days, Late: ${item.totalLate} days, OT: ${item.overtimeHours} hrs, Net Salary: ৳${item.netPayable.toLocaleString()}.`,
      report: {
        title: `360° Employee Dossier: ${item.emp.name} (${item.emp.employeeId})`,
        subtitle: `${item.emp.designation} • ${item.emp.department} • Branch: ${item.emp.branch || 'Head Office'} • Month: ${formatMonthLabel(selectedMonth)}`,
        kpis: [
          { label: 'Present Days', value: `${item.presentDays} Days`, color: 'emerald' },
          { label: 'Late Arrivals', value: `${item.totalLate} Days`, color: item.unexcusedLate >= 3 ? 'rose' : 'amber' },
          { label: 'Overtime', value: `${item.overtimeHours} hrs (৳${item.overtimePay.toLocaleString()})`, color: 'indigo' },
          { label: 'Net Payable Salary', value: `৳ ${item.netPayable.toLocaleString()}`, color: 'emerald' },
        ],
        headers: ['Metric / Field', 'Verified Value', 'Policy / Remarks'],
        rows: [
          ['Employee Name & ID', `${item.emp.name} (${item.emp.employeeId})`, `Joined: ${item.emp.joinDate || 'N/A'}`],
          ['Department & Designation', `${item.emp.department} — ${item.emp.designation}`, `Shift: ${item.emp.shift || 'General'}`],
          ['Today Presence Status', `${item.todayStatus.toUpperCase()}`, `In: ${item.todayIn} | Out: ${item.todayOut}`],
          ['Monthly Present Days', `${item.presentDays} Days`, `Weekend Duty: ${item.weekendDays} Days`],
          [
            'Monthly Late Arrivals',
            `${item.totalLate} Days (${item.unexcusedLate} Unexcused, ${item.excusedLate} Waived)`,
            item.lateDates.map(d => `${d.date} (${formatTo12Hour(d.checkIn)})`).join(', ') || 'No late arrivals',
          ],
          ['Late Salary Deduction', `৳ ${item.lateCut.toLocaleString()}`, `${item.latePenaltyDays} Day(s) Penalty (3 Late = 1 Day Cut)`],
          ['Absent Days & Cut', `${item.absentDays} Days (৳ ${item.absentCut.toLocaleString()})`, 'Based on working schedule'],
          ['Overtime Hours & Pay', `${item.overtimeHours} hrs (৳ ${item.overtimePay.toLocaleString()})`, '1.5x Basic Hourly Rate'],
          ['Gross Monthly Salary', `৳ ${item.grossSalary.toLocaleString()}`, `Basic: ৳ ${item.basicSalary.toLocaleString()}`],
          ['Net Take-Home Salary', `৳ ${item.netPayable.toLocaleString()}`, `Punctuality Score: ${item.punctualityScore}/100`],
        ],
      },
    };
  };

  const buildExecutiveSummaryReport = (): { text: string; report: ReportTableData } => {
    const presentToday = employeeAnalytics.filter(a => a.todayStatus === 'present' || a.todayStatus === 'late').length;
    const threeLateCount = employeeAnalytics.filter(a => a.totalLate >= 3).length;
    const totalNet = employeeAnalytics.reduce((s, a) => s + a.netPayable, 0);
    const totalOt = employeeAnalytics.reduce((s, a) => s + a.overtimePay, 0);
    const totalLateCut = employeeAnalytics.reduce((s, a) => s + a.lateCut, 0);

    return {
      text: `📊 **${currentCompany?.name || 'WorkNest HR'} — 360° Executive HR Summary Report (${formatMonthLabel(selectedMonth)}):**\n• Total Employees: ${employeeAnalytics.length} (Present Today: ${presentToday})\n• 3+ Days Late Warning Issued: ${threeLateCount} Staff\n• Net Payroll Budget: ৳${totalNet.toLocaleString()} (OT: ৳${totalOt.toLocaleString()}, Late Penalty Savings: ৳${totalLateCut.toLocaleString()})`,
      report: {
        title: `Executive 360° Company HR & Payroll Summary — ${formatMonthLabel(selectedMonth)}`,
        subtitle: `Comprehensive overview of Attendance, Punctuality, Leaves, and Payroll for ${currentCompany?.name || 'WorkNest HR'}`,
        kpis: [
          { label: 'Total Employees', value: `${employeeAnalytics.length}`, color: 'indigo' },
          { label: 'Today Present', value: `${presentToday} / ${employeeAnalytics.length}`, color: 'emerald' },
          { label: '3+ Late Warning Staff', value: `${threeLateCount} Staff`, color: 'rose' },
          { label: 'Net Payroll Budget', value: `৳ ${totalNet.toLocaleString()}`, color: 'emerald' },
        ],
        headers: [
          'Employee ID',
          'Name',
          'Department',
          'Present',
          'Late',
          'Absent',
          'OT Hours',
          'Net Payable (৳)',
          'Score',
        ],
        rows: employeeAnalytics.map(a => [
          a.emp.employeeId,
          a.emp.name,
          a.emp.department,
          `${a.presentDays}d`,
          `${a.totalLate}d`,
          `${a.absentDays}d`,
          `${a.overtimeHours}h`,
          `৳ ${a.netPayable.toLocaleString()}`,
          `${a.punctualityScore}%`,
        ]),
      },
    };
  };

  // =========================================================================
  // NATURAL LANGUAGE INTENT MATCHER (Understands Bangla, Banglish & English)
  // =========================================================================
  const processNaturalLanguageQuery = (rawInput: string): { text: string; report?: ReportTableData } => {
    const q = rawInput.trim().toLowerCase();

    // 0. Extract explicit date if mentioned in query (e.g. 2026-10-15 or 15-10-2026 or 15/10/2026 or yesterday)
    const isoDateMatch = q.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const dmyDateMatch = q.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
    let explicitDate: string | null = null;
    if (isoDateMatch) {
      explicitDate = isoDateMatch[1];
    } else if (dmyDateMatch) {
      const d = String(dmyDateMatch[1]).padStart(2, '0');
      const m = String(dmyDateMatch[2]).padStart(2, '0');
      const y = dmyDateMatch[3];
      explicitDate = `${y}-${m}-${d}`;
    } else if (q.includes('yesterday') || q.includes('gotokal') || q.includes('গতকাল')) {
      const yDate = new Date(`${todayStr}T00:00:00`);
      yDate.setDate(yDate.getDate() - 1);
      const yStr = `${yDate.getFullYear()}-${String(yDate.getMonth() + 1).padStart(2, '0')}-${String(yDate.getDate()).padStart(2, '0')}`;
      explicitDate = yStr;
    }

    if (explicitDate) {
      setSelectedDate(explicitDate);
      if (explicitDate.slice(0, 7) !== selectedMonth) {
        setSelectedMonth(explicitDate.slice(0, 7));
      }
      return buildDailyAttendanceReport(explicitDate);
    }

    // 1. Check for Today's Attendance / Date Report / Daily attendance
    // Matches "ajker date er report", "আজকের রিপোর্ট", "আজকের তারিখ", "ajker date", "today's report", etc.
    const isDailyQuery =
      q.includes('today') ||
      q.includes('ajke') ||
      q.includes('ajker') ||
      q.includes('ajk') ||
      q.includes('আজকে') ||
      q.includes('আজকের') ||
      q.includes('আজকের ডেট') ||
      q.includes('আজকের তারিখ') ||
      q.includes('আজ') ||
      q.includes('দৈনিক') ||
      q.includes('daily') ||
      q.includes('date er report') ||
      q.includes('date report') ||
      q.includes('tarikh') ||
      q.includes('তারিখ') ||
      (q.includes('attendance') && !q.includes('month') && !q.includes('মাসিক') && !q.includes('payroll') && !q.includes('salary') && !q.includes('বেতন')) ||
      (q.includes('হাজিরা') && !q.includes('মাসিক') && !q.includes('বেতন')) ||
      (q.includes('উপস্থিতি') && !q.includes('মাসিক') && !q.includes('বেতন')) ||
      (q.includes('present') && !q.includes('month') && !q.includes('মাসিক') && !q.includes('top') && !q.includes('best'));

    if (isDailyQuery) {
      return buildDailyAttendanceReport(selectedDate || todayStr);
    }

    // 2. Check if query mentions a specific employee by Name or Employee ID
    const matchedEmpAnalytics = employeeAnalytics.find(
      a =>
        q.includes(a.emp.employeeId.toLowerCase()) ||
        (a.emp.name.trim().length >= 3 && q.includes(a.emp.name.trim().toLowerCase())) ||
        a.emp.name
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .some(part => part.length >= 4 && q.includes(part))
    );
    if (matchedEmpAnalytics) {
      return buildSingleEmployeeDossier(matchedEmpAnalytics);
    }

    // 3. Check for 3+ Days Late / Warning / Late List
    if (
      q.includes('late') ||
      q.includes('lete') ||
      q.includes('লেট') ||
      q.includes('দেরি') ||
      q.includes('warning') ||
      q.includes('ওয়ারনিং') ||
      q.includes('সতর্ক') ||
      q.includes('3 day') ||
      q.includes('৩ দিন')
    ) {
      return buildThreeDaysLateReport();
    }

    // 4. Check for Salary / Payroll / Deduction / Net Pay
    if (
      q.includes('salary') ||
      q.includes('payroll') ||
      q.includes('beton') ||
      q.includes('স্যালারি') ||
      q.includes('বেতন') ||
      q.includes('পেরোল') ||
      q.includes('deduction') ||
      q.includes('payslip')
    ) {
      return buildPayrollReport();
    }

    // 5. Check for Overtime / Weekend Duty
    if (
      q.includes('overtime') ||
      q.includes('ot ') ||
      q.includes('ওভারটাইম') ||
      q.includes('weekend') ||
      q.includes('উইকেন্ড') ||
      q.includes('extra duty')
    ) {
      return buildOvertimeReport();
    }

    // 6. Check for Leave / Application / Waiver
    if (
      q.includes('leave') ||
      q.includes('chuti') ||
      q.includes('ছুটি') ||
      q.includes('ছুটির') ||
      q.includes('waiver') ||
      q.includes('application')
    ) {
      return buildLeaveAndWaiverReport();
    }

    // 7. Check for Top Performer / Best / Punctual / Award
    if (
      q.includes('top') ||
      q.includes('best') ||
      q.includes('punctual') ||
      q.includes('সেরা') ||
      q.includes('পারফর্মার') ||
      q.includes('rank') ||
      q.includes('award')
    ) {
      return buildTopPerformersReport();
    }

    // 8. Check for Branch / Department
    if (
      q.includes('branch') ||
      q.includes('department') ||
      q.includes('dept') ||
      q.includes('ব্রাঞ্চ') ||
      q.includes('ডিপার্টমেন্ট') ||
      q.includes('শাখা')
    ) {
      return buildBranchAndDeptReport();
    }

    // 9. Check for Absent / Missing Checkout
    if (
      q.includes('absent') ||
      q.includes('missing') ||
      q.includes('অ্যাবসেন্ট') ||
      q.includes('অনুপস্থিত') ||
      q.includes('checkout')
    ) {
      return buildMissingCheckoutAuditReport();
    }

    // 10. If query explicitly mentions month / executive / 360 summary
    if (
      q.includes('month') ||
      q.includes('মাস') ||
      q.includes('মাসিক') ||
      q.includes('executive') ||
      q.includes('৩৬০') ||
      q.includes('summary') ||
      q.includes('সামারি')
    ) {
      return buildExecutiveSummaryReport();
    }

    // Default: Always return Daily Attendance Report for selectedDate / todayStr (not month!)
    return buildDailyAttendanceReport(selectedDate || todayStr);
  };

  // =========================================================================
  // CHAT STATE & HANDLERS (Full-Page Zero-Empty-Space Mode)
  // =========================================================================
  const [chatHistory, setChatHistory] = useState<ChatItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isListeningVoice, setIsListeningVoice] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [actionFeedbackMsg, setActionFeedbackMsg] = useState('');
  const [previewPrintReport, setPreviewPrintReport] = useState<{
    report: ReportTableData;
    summaryText: string;
  } | null>(null);
  const [isLetterPrintModalOpen, setIsLetterPrintModalOpen] = useState(false);

  // Stop any active speech synthesis when unmounting or switching studio tabs
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Live Default Report shown automatically when chatHistory is empty: Defaults to TODAY's Live Attendance Report
  const defaultLiveReportMsg = useMemo<ChatItem>(() => {
    const dailyReport = buildDailyAttendanceReport(selectedDate || todayStr);
    return {
      id: 'live_default_daily_report',
      sender: 'ai',
      time: selectedDate === todayStr ? 'Live Today' : selectedDate,
      text: dailyReport.text,
      report: dailyReport.report,
    };
  }, [cloudAttendance, filteredEmployees, selectedDate, todayStr, roster, shifts, leaveRequests, selectedBranchFilter]);

  // Date Filter Change Handler: Updates selected date, syncs month and prepends date report to chat
  const handleDateFilterChange = (newDateStr: string) => {
    if (!newDateStr) return;
    setSelectedDate(newDateStr);
    const monthPart = newDateStr.slice(0, 7);
    if (monthPart !== selectedMonth) {
      setSelectedMonth(monthPart);
    }
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isToday = newDateStr === todayStr;
    const userMsg: ChatItem = {
      id: `u_${Date.now()}`,
      sender: 'user',
      time: nowTime,
      text: isToday ? "Show today's daily attendance report" : `Show daily attendance report for ${newDateStr}`,
    };
    const res = buildDailyAttendanceReport(newDateStr);
    const aiMsg: ChatItem = {
      id: `ai_${Date.now() + 1}`,
      sender: 'ai',
      time: nowTime,
      text: res.text,
      report: res.report,
    };
    setChatHistory(prev => [userMsg, aiMsg, ...prev]);
  };

  // Step Date: Navigate previous / next day easily
  const handleStepDate = (deltaDays: number) => {
    const curDateStr = selectedDate || todayStr;
    const [y, m, d] = curDateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaDays);
    const nextY = dt.getFullYear();
    const nextM = String(dt.getMonth() + 1).padStart(2, '0');
    const nextD = String(dt.getDate()).padStart(2, '0');
    const nextDateStr = `${nextY}-${nextM}-${nextD}`;
    handleDateFilterChange(nextDateStr);
  };

  const displayedMessages = useMemo<ChatItem[]>(() => {
    if (chatHistory.length === 0) {
      return [defaultLiveReportMsg];
    }
    return chatHistory;
  }, [chatHistory, defaultLiveReportMsg]);

  const handleSendQuery = (customPrompt?: string) => {
    const queryText = (customPrompt ?? chatInput).trim();
    if (!queryText) return;

    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatItem = {
      id: `u_${Date.now()}`,
      sender: 'user',
      time: nowTime,
      text: queryText,
    };

    const result = processNaturalLanguageQuery(queryText);
    const aiMsg: ChatItem = {
      id: `ai_${Date.now() + 1}`,
      sender: 'ai',
      time: nowTime,
      text: result.text,
      report: result.report,
    };

    // Place the newest query & generated report at the top so user sees it immediately without scrolling
    setChatHistory(prev => [userMsg, aiMsg, ...prev]);
    if (!customPrompt) setChatInput('');
  };

  // Voice Command (Web Speech API)
  const handleStartVoiceInput = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setActionFeedbackMsg('Voice typing is not supported in this browser, please type in the query input box.');
      setTimeout(() => setActionFeedbackMsg(''), 4000);
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'bn-BD';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      setIsListeningVoice(true);

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        setIsListeningVoice(false);
        if (transcript) {
          setChatInput(transcript);
          handleSendQuery(transcript);
        }
      };
      recognition.onerror = () => setIsListeningVoice(false);
      recognition.onend = () => setIsListeningVoice(false);
      recognition.start();
    } catch {
      setIsListeningVoice(false);
    }
  };

  // Stop Voice Immediately
  const handleStopVoice = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMsgId(null);
  };

  // Text-to-Speech Toggle (Read Report Aloud OR Stop if already speaking)
  const handleToggleSpeakReport = (msgId: string, text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    // If this message is already speaking, turn it OFF immediately
    if (speakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*#_`]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'bn-BD';
    utterance.rate = 1.0;
    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  // Convert AI ReportTableData into PrintReportConfig for high-res printing & HTML/PDF export
  const buildPrintConfigForAIReport = (report: ReportTableData): PrintReportConfig => {
    return {
      title: report.title,
      subtitle: report.subtitle || 'AI Generated Official HR & Payroll Audit Report',
      period: formatMonthLabel(selectedMonth),
      orientation: report.headers.length > 6 ? 'landscape' : 'portrait',
      companyName: currentCompany?.name || 'WorkNest HRMS — Enterprise Workforce Operations',
      filters: [
        { label: 'Month', value: formatMonthLabel(selectedMonth) },
        { label: 'Branch Scope', value: selectedBranchFilter === 'ALL' ? 'All Branches' : selectedBranchFilter },
      ],
      metrics: (report.kpis || []).map((k, idx) => ({
        label: k.label,
        value: k.value,
        highlight: idx === 0,
      })),
      headers: report.headers,
      rows: report.rows,
    };
  };

  // Trigger Print & Open Print Preview Modal for any AI Report
  const handlePrintAIReport = async (report: ReportTableData, summaryText: string) => {
    setPreviewPrintReport({ report, summaryText });
    const config = buildPrintConfigForAIReport(report);
    const html = generateReportHtml(config);
    const ok = await printViaIframe(html);
    if (!ok) {
      try {
        window.print();
      } catch {}
    }
  };

  // Generate standalone HTML for Official HR Letter & trigger print
  const generateOfficialLetterHtml = () => {
    const companyName = currentCompany?.name || 'WORKNEST HR MANAGEMENT';
    return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <title>${generatedOfficialLetter.title} - ${generatedOfficialLetter.refNo}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm 18mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 24px;
      line-height: 1.6;
      font-size: 13px;
    }
    .sheet { max-width: 780px; margin: 0 auto; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 14px;
      margin-bottom: 20px;
    }
    .company { font-size: 20px; font-weight: 900; text-transform: uppercase; }
    .sub { font-size: 11px; color: #64748b; }
    .meta { text-align: right; font-size: 12px; font-family: monospace; }
    .recipient {
      padding: 12px 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    .subject {
      padding: 12px 16px;
      background: #eef2ff;
      border-left: 4px solid #4f46e5;
      font-weight: 800;
      margin-bottom: 20px;
    }
    .body-box {
      white-space: pre-line;
      margin-bottom: 18px;
      padding: 14px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }
    .sig-row {
      display: flex;
      justify-content: space-between;
      margin-top: 60px;
      padding-top: 16px;
      border-top: 1px solid #cbd5e1;
    }
    .no-print-bar {
      max-width: 780px;
      margin: 0 auto 20px auto;
      padding: 10px 16px;
      background: #0f172a;
      color: #fff;
      border-radius: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn {
      background: #4f46e5;
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 700;
      cursor: pointer;
    }
    @media print {
      .no-print-bar { display: none !important; }
      body { padding: 0 !important; }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <span>📜 ${generatedOfficialLetter.title}</span>
    <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
  </div>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="company">${companyName}</div>
        <div class="sub">Official Human Resources &amp; Administration Correspondence</div>
      </div>
      <div class="meta">
        <div><strong>Ref:</strong> ${generatedOfficialLetter.refNo}</div>
        <div><strong>Date:</strong> ${todayStr}</div>
      </div>
    </div>
    <div class="recipient">
      <div style="font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;">Recipient / To:</div>
      <div style="font-weight:800;font-size:14px;">${generatedOfficialLetter.recipient}</div>
    </div>
    <div class="subject">SUBJECT: ${generatedOfficialLetter.subject}</div>
    <div class="body-box">${generatedOfficialLetter.bodyBangla}</div>
    <div class="body-box" style="background:#f8fafc;color:#334155;">${generatedOfficialLetter.bodyEnglish}</div>
    <div class="sig-row">
      <div>
        <strong>${currentUser?.name || 'HR Administration'}</strong><br/>
        <span style="font-size:11px;color:#64748b;">Authorized Signatory • ${companyName}</span>
      </div>
      <div style="text-align:right;">
        <strong>Recipient Signature</strong><br/>
        <span style="font-size:11px;color:#64748b;">Date &amp; Acknowledgment</span>
      </div>
    </div>
  </div>
</body>
</html>`;
  };

  const handlePrintOfficialLetter = async () => {
    setIsLetterPrintModalOpen(true);
    const html = generateOfficialLetterHtml();
    const ok = await printViaIframe(html);
    if (!ok) {
      try {
        window.print();
      } catch {}
    }
  };

  // Export any AI Report Table to CSV / Excel
  const handleExportReportCSV = (report: ReportTableData) => {
    const escapeCell = (val: string | number) => {
      const s = String(val ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };
    const csvLines = [
      report.headers.map(escapeCell).join(','),
      ...report.rows.map(row => row.map(escapeCell).join(',')),
    ];
    const csvContent = '\uFEFF' + csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title.replace(/[^a-zA-Z0-9_-]+/g, '_')}_${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 1-Click Automated HR Action: Send Official Warning to all 3+ Late Employees
  const handleSendBulkLateWarnings = async (targetEmpIds?: string[]) => {
    const targets = employeeAnalytics.filter(
      a => a.totalLate >= 3 && (!targetEmpIds || targetEmpIds.includes(a.emp.id))
    );
    if (targets.length === 0) return;

    for (const item of targets) {
      await sendMessage({
        from: currentUser?.name || 'HR Administration',
        fromAvatar: '🚨',
        to: item.emp.name,
        toEmployeeId: item.emp.id,
        subject: `🚨 OFFICIAL WARNING NOTICE: ${item.totalLate} Days Late in ${formatMonthLabel(selectedMonth)}`,
        content: `Dear ${item.emp.name} (${item.emp.employeeId}), our attendance records indicate ${item.totalLate} late check-in instances during ${formatMonthLabel(selectedMonth)} (${item.lateDates.map(d => d.date).join(', ')}). Under company policy (3 late days = 1 day salary deduction), a penalty deduction of ৳${item.lateCut.toLocaleString()} applies. Please ensure strict punctuality going forward.`,
        unread: true,
      });
    }

    addNotification({
      title: 'Official Late Warnings Dispatched by AI',
      message: `Sent official 3-days late warning notices to ${targets.length} employee(s) for ${formatMonthLabel(selectedMonth)}.`,
      read: false,
      type: 'attendance',
      targetPage: 'attendance',
    });

    setActionFeedbackMsg(
      `✅ Official warning notices sent to all ${targets.length} employee portals successfully!`
    );
    setTimeout(() => setActionFeedbackMsg(''), 6000);
  };

  // 1-Click Automated HR Action: Send Appreciation to Top Punctual Employees
  const handleSendBulkAppreciation = async (targetEmpIds?: string[]) => {
    const targets = employeeAnalytics.filter(
      a => a.unexcusedLate === 0 && (!targetEmpIds || targetEmpIds.includes(a.emp.id))
    );
    if (targets.length === 0) return;

    for (const item of targets) {
      await sendMessage({
        from: currentUser?.name || 'HR Administration',
        fromAvatar: '🏆',
        to: item.emp.name,
        toEmployeeId: item.emp.id,
        subject: `🏆 Punctuality Appreciation — ${formatMonthLabel(selectedMonth)}`,
        content: `Congratulations ${item.emp.name}! You achieved 100% punctuality (zero unexcused late arrivals, Score: ${item.punctualityScore}/100) during ${formatMonthLabel(selectedMonth)}. Management commends your commitment and professionalism!`,
        unread: true,
      });
    }

    setActionFeedbackMsg(
      `🏆 Appreciation message sent to all ${targets.length} punctual staff successfully!`
    );
    setTimeout(() => setActionFeedbackMsg(''), 6000);
  };

  // =========================================================================
  // TAB 2: AI HR LETTER & OFFICIAL NOTICE STUDIO STATE
  // =========================================================================
  const [selectedLetterType, setSelectedLetterType] = useState<LetterTemplateType>('late_warning');
  const [selectedLetterEmpId, setSelectedLetterEmpId] = useState<string>(() => employees[0]?.id || '');
  const [customNoticeSubject, setCustomNoticeSubject] = useState('Official Notice: Office Timings & Punctuality Policy');
  const [customNoticeBody, setCustomNoticeBody] = useState(
    'All employees and staff are requested to ensure timely arrival and complete biometric check-in within designated shift timings.'
  );
  const [incrementAmountInput, setIncrementAmountInput] = useState<number>(3000);

  const selectedLetterEmpAnalytics = useMemo(() => {
    return (
      employeeAnalytics.find(a => a.emp.id === selectedLetterEmpId || a.emp.employeeId === selectedLetterEmpId) ||
      employeeAnalytics[0] ||
      null
    );
  }, [employeeAnalytics, selectedLetterEmpId]);

  const generatedOfficialLetter = useMemo(() => {
    const companyName = currentCompany?.name || 'WorkNest HR';
    const empItem = selectedLetterEmpAnalytics;
    const emp: Partial<Employee> = empItem?.emp || {
      name: 'Employee Name',
      employeeId: 'WNH-1001',
      designation: 'Executive',
      department: 'General',
      grossSalary: 30000,
      basicSalary: 15000,
      joinDate: todayStr,
    };

    const refPrefix = `WN/HR/${selectedLetterType.toUpperCase()}/${selectedMonth.replace('-', '')}/${emp.employeeId || 'ALL'}`;

    if (selectedLetterType === 'late_warning') {
      const lateCount = empItem?.totalLate || 3;
      const lateDatesList =
        empItem && empItem.lateDates.length > 0
          ? empItem.lateDates.map(d => `${d.date} (In: ${formatTo12Hour(d.checkIn)})`).join(', ')
          : 'Multiple working days this month';
      const cutAmt = empItem?.lateCut || Math.round((Number(emp.grossSalary) || 30000) / 30);

      return {
        refNo: refPrefix,
        title: 'OFFICIAL LATE ATTENDANCE WARNING & SHOW-CAUSE NOTICE',
        recipient: `${emp.name} (${emp.employeeId}) — ${emp.designation}, ${emp.department}`,
        subject: `Official Warning Notice for Repeated Late Attendance (${formatMonthLabel(selectedMonth)})`,
        bodyBangla: `Dear ${emp.name},\n\nOur attendance records indicate that you have arrived after the scheduled grace time on ${lateCount} working days (${lateDatesList}) during ${formatMonthLabel(selectedMonth)}.\n\nUnder company HR policy, each 3 unexcused late arrivals incur a 1-day salary deduction (approx. BDT ${cutAmt.toLocaleString()}). You are strictly advised to maintain regular punctuality.`,
        bodyEnglish: `Dear ${emp.name},\n\nThis letter serves as an official disciplinary warning regarding your repeated late arrivals during ${formatMonthLabel(selectedMonth)}. Our biometric/attendance records indicate ${lateCount} late check-in instance(s) (${lateDatesList}). In accordance with company policy (3 late arrivals = 1 day salary deduction), a deduction of BDT ${cutAmt.toLocaleString()} is applicable. You are strictly advised to maintain punctuality going forward.`,
      };
    }

    if (selectedLetterType === 'appreciation') {
      return {
        refNo: refPrefix,
        title: 'EMPLOYEE OF THE MONTH & PUNCTUALITY APPRECIATION LETTER',
        recipient: `${emp.name} (${emp.employeeId}) — ${emp.designation}, ${emp.department}`,
        subject: `Letter of Appreciation for Exceptional Punctuality & Performance (${formatMonthLabel(selectedMonth)})`,
        bodyBangla: `Dear ${emp.name},\n\nManagement is pleased to present you with this Certificate of Appreciation for your 100% punctuality (Score: ${empItem?.punctualityScore || 100}/100) and dedicated attendance (${empItem?.presentDays || 26} days) in ${formatMonthLabel(selectedMonth)}.\n\nWe commend your professional excellence and wish you continued success with ${companyName}.`,
        bodyEnglish: `Dear ${emp.name},\n\nOn behalf of the management of ${companyName}, we are delighted to present you with this Letter of Appreciation for your outstanding punctuality (${empItem?.punctualityScore || 100}% score) and dedication during ${formatMonthLabel(selectedMonth)}. Thank you for being a role model for the team!`,
      };
    }

    if (selectedLetterType === 'salary_certificate') {
      const gross = empItem?.grossSalary || Number(emp.grossSalary) || 30000;
      const basic = empItem?.basicSalary || Number(emp.basicSalary) || Math.round(gross * 0.5);
      return {
        refNo: refPrefix,
        title: 'OFFICIAL SALARY CERTIFICATE & EMPLOYMENT NOC',
        recipient: `To Whom It May Concern (Re: ${emp.name}, ID: ${emp.employeeId})`,
        subject: `Official Employment & Monthly Salary Certificate for ${emp.name}`,
        bodyBangla: `This is to certify that ${emp.name} (Employee Code: ${emp.employeeId}), Designation: ${emp.designation}, Department: ${emp.department}, has been employed with ${companyName} since ${emp.joinDate || 'N/A'}.\n\nCurrent monthly Gross Salary: BDT ${gross.toLocaleString()} (Basic Salary: BDT ${basic.toLocaleString()} and allowances: BDT ${(gross - basic).toLocaleString()}).`,
        bodyEnglish: `This is to certify that ${emp.name} (Employee Code: ${emp.employeeId}) has been employed with ${companyName} since ${emp.joinDate || 'N/A'} as ${emp.designation} in the ${emp.department} Department.\n\nHis/Her current monthly Gross Salary is BDT ${gross.toLocaleString()} (Basic Salary: BDT ${basic.toLocaleString()} plus standard allowances of BDT ${(gross - basic).toLocaleString()}). This certificate is issued upon the employee's request for official/banking purposes.`,
      };
    }

    if (selectedLetterType === 'appointment') {
      const gross = empItem?.grossSalary || Number(emp.grossSalary) || 30000;
      return {
        refNo: refPrefix,
        title: 'LETTER OF APPOINTMENT',
        recipient: `${emp.name} (${emp.employeeId}) — ${emp.designation}, ${emp.department}`,
        subject: `Appointment Letter for the position of "${emp.designation}" at ${companyName}`,
        bodyBangla: `Dear ${emp.name},\n\nWe are pleased to appoint you as "${emp.designation}" in the ${emp.department} Department at ${companyName}, effective from ${emp.joinDate || todayStr}. Your monthly gross compensation will be BDT ${gross.toLocaleString()}, subject to company attendance and HR policies.`,
        bodyEnglish: `Dear ${emp.name},\n\nWe are pleased to appoint you as "${emp.designation}" in the ${emp.department} Department at ${companyName}, effective from ${emp.joinDate || todayStr}. Your monthly gross compensation will be BDT ${gross.toLocaleString()}, subject to company attendance and HR policies.`,
      };
    }

    if (selectedLetterType === 'increment') {
      const oldGross = empItem?.grossSalary || Number(emp.grossSalary) || 30000;
      const newGross = oldGross + (Number(incrementAmountInput) || 0);
      return {
        refNo: refPrefix,
        title: 'SALARY INCREMENT & PERFORMANCE LETTER',
        recipient: `${emp.name} (${emp.employeeId}) — ${emp.designation}, ${emp.department}`,
        subject: `Official Salary Increment Notification for ${emp.name}`,
        bodyBangla: `Dear ${emp.name},\n\nIn recognition of your performance and punctuality at ${companyName}, management is pleased to award you a monthly salary increment of BDT ${(Number(incrementAmountInput) || 0).toLocaleString()}.\n\nPrevious Gross Salary: BDT ${oldGross.toLocaleString()}\nRevised Gross Salary: BDT ${newGross.toLocaleString()}\n\nThank you for your continued dedication.`,
        bodyEnglish: `Dear ${emp.name},\n\nIn recognition of your dedicated performance and punctuality at ${companyName}, management is pleased to grant you a monthly salary increment of BDT ${(Number(incrementAmountInput) || 0).toLocaleString()}. Your revised monthly Gross Salary is now BDT ${newGross.toLocaleString()} (previously BDT ${oldGross.toLocaleString()}).`,
      };
    }

    return {
      refNo: `WN/HR/NOTICE/${todayStr.replace(/-/g, '')}`,
      title: 'OFFICIAL HR NOTICE & CIRCULAR',
      recipient: 'All Employees & Departments',
      subject: customNoticeSubject,
      bodyBangla: customNoticeBody,
      bodyEnglish: `All employees are requested to take note of the above official circular issued by Human Resources & Administration, ${companyName}.`,
    };
  }, [
    selectedLetterType,
    selectedLetterEmpAnalytics,
    currentCompany,
    selectedMonth,
    todayStr,
    incrementAmountInput,
    customNoticeSubject,
    customNoticeBody,
  ]);

  const handleDispatchLetterToEmployee = async () => {
    if (selectedLetterType === 'office_notice') {
      await sendMessage({
        from: currentUser?.name || 'HR Administration',
        fromAvatar: '📢',
        to: 'All Employees',
        subject: `📢 Office Notice: ${generatedOfficialLetter.subject}`,
        content: `${generatedOfficialLetter.bodyEnglish || generatedOfficialLetter.bodyBangla}\n\n(Ref: ${generatedOfficialLetter.refNo})`,
        unread: true,
      });
      setActionFeedbackMsg('✅ Office notice broadcasted to all employees successfully!');
    } else if (selectedLetterEmpAnalytics) {
      await sendMessage({
        from: currentUser?.name || 'HR Administration',
        fromAvatar: '📜',
        to: selectedLetterEmpAnalytics.emp.name,
        toEmployeeId: selectedLetterEmpAnalytics.emp.id,
        subject: `📜 ${generatedOfficialLetter.title}`,
        content: `${generatedOfficialLetter.subject}\n\n${generatedOfficialLetter.bodyEnglish || generatedOfficialLetter.bodyBangla}\n\n(Ref: ${generatedOfficialLetter.refNo})`,
        unread: true,
      });
      setActionFeedbackMsg(
        `✅ "${generatedOfficialLetter.title}" sent directly to ${selectedLetterEmpAnalytics.emp.name}'s Employee Portal!`
      );
    }
    setTimeout(() => setActionFeedbackMsg(''), 6000);
  };

  return (
    <div className="space-y-5">
      {/* ========================================================================= */}
      {/* TOP HEADER                                                                */}
      {/* ========================================================================= */}
      <div className="bg-gradient-to-r from-indigo-950 via-violet-950 to-slate-900 rounded-3xl p-5 sm:p-6 text-white shadow-lg border border-indigo-500/20 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 bg-indigo-500/20 border border-indigo-400/40 text-indigo-200 rounded-full text-[11px] font-black uppercase tracking-wider">
                ✨ Smart HR Analytics &amp; Report Engine
              </span>
              <span className="px-2.5 py-0.5 bg-white/10 text-indigo-200 rounded-lg text-[11px] font-semibold">
                Bangla • Banglish • English • Voice Enabled
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight flex items-center space-x-2">
              <span>🤖</span>
              <span>WorkNest Smart AI HR Assistant &amp; Report Studio</span>
            </h1>
            <p className="text-xs sm:text-sm text-indigo-200 max-w-3xl">
              Ask questions or generate reports for live attendance, late lists, payroll sheets, overtime analysis, 360° employee audits, and official HR letters.
            </p>
          </div>

          {/* Date, Month & Branch Selectors */}
          <div className="flex flex-wrap items-center gap-2 shrink-0 bg-white/10 p-2.5 rounded-2xl border border-white/15">
            <div>
              <label className="text-[10px] font-bold uppercase text-indigo-200 block">Report Date</label>
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => {
                    const newD = e.target.value;
                    if (newD) handleDateFilterChange(newD);
                  }}
                  className="px-2.5 py-1.5 bg-slate-900/90 border border-white/20 rounded-xl text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <button
                  type="button"
                  onClick={() => handleDateFilterChange(todayStr)}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer transition-all ${
                    selectedDate === todayStr ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white/10 text-indigo-200 hover:bg-white/20'
                  }`}
                  title="View Today's Report"
                >
                  Today
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-indigo-200 block">Report Month</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="mt-0.5 px-2.5 py-1.5 bg-slate-900/90 border border-white/20 rounded-xl text-xs font-bold text-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-indigo-200 block">Branch Scope</label>
              <select
                value={selectedBranchFilter}
                onChange={e => setSelectedBranchFilter(e.target.value)}
                className="mt-0.5 px-2.5 py-1.5 bg-slate-900/90 border border-white/20 rounded-xl text-xs font-bold text-white"
              >
                <option value="ALL">All Branches ({employees.length})</option>
                {branches.map(b => (
                  <option key={b.id} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Studio Mode Switcher Tabs */}
        <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveStudioTab('chat')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center space-x-2 ${
              activeStudioTab === 'chat'
                ? 'bg-white text-indigo-950 shadow-md'
                : 'bg-white/10 text-indigo-100 hover:bg-white/20'
            }`}
          >
            <span>💬</span>
            <span>AI Report Chatbot</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveStudioTab('letters')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center space-x-2 ${
              activeStudioTab === 'letters'
                ? 'bg-white text-indigo-950 shadow-md'
                : 'bg-white/10 text-indigo-100 hover:bg-white/20'
            }`}
          >
            <span>📜</span>
            <span>AI HR Letter &amp; Notice Generator</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveStudioTab('audit')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center space-x-2 ${
              activeStudioTab === 'audit'
                ? 'bg-white text-indigo-950 shadow-md'
                : 'bg-white/10 text-indigo-100 hover:bg-white/20'
            }`}
          >
            <span>⚡</span>
            <span>Smart Auto-Audit &amp; 1-Click Actions</span>
          </button>
        </div>
      </div>

      {actionFeedbackMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-2xl text-xs sm:text-sm font-bold shadow-xs flex items-center justify-between">
          <span>{actionFeedbackMsg}</span>
          <button
            type="button"
            onClick={() => setActionFeedbackMsg('')}
            className="text-emerald-700 hover:text-emerald-950 font-black px-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STUDIO TAB 1: AI REPORT CHATBOT                                           */}
      {/* ========================================================================= */}
      {activeStudioTab === 'chat' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Quick Report Prompts Panel */}
          <div className="lg:col-span-4 space-y-4 print:hidden">
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-800 text-xs sm:text-sm uppercase tracking-wider flex items-center space-x-1.5">
                  <span>⚡</span>
                  <span>1-Click Instant AI Reports</span>
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full">
                  Live Data
                </span>
              </div>

              <div className="space-y-1.5">
                {[
                  {
                    icon: '📅',
                    label: "Today's Daily Attendance Report",
                    prompt: 'Show today daily attendance report',
                  },
                  {
                    icon: '📆',
                    label: "Yesterday's Daily Attendance Report",
                    prompt: 'Show yesterday attendance report',
                  },
                  {
                    icon: '🚨',
                    label: '3+ Days Late & Deduction Warning List',
                    prompt: 'List all employees with 3 or more late days this month',
                  },
                  {
                    icon: '💰',
                    label: 'Monthly Master Payroll & Salary Sheet',
                    prompt: 'Generate this month master payroll and salary report',
                  },
                  {
                    icon: '🏆',
                    label: 'Top Performers & Punctuality Ranking',
                    prompt: 'Show punctuality and top performer ranking',
                  },
                  {
                    icon: '⏱️',
                    label: 'Overtime & Weekend Duty Report',
                    prompt: 'Show monthly overtime hours and payout report',
                  },
                  {
                    icon: '🏖️',
                    label: 'Leave Requests & Waiver Audit',
                    prompt: 'Show all leave requests and pending applications audit',
                  },
                  {
                    icon: '🏢',
                    label: 'Branch & Department Headcount Summary',
                    prompt: 'Breakdown staff and payroll by branch and department',
                  },
                  {
                    icon: '⚠️',
                    label: 'Missing Checkout & Absenteeism Audit',
                    prompt: 'Show missing punch checkout and absenteeism list',
                  },
                  {
                    icon: '📊',
                    label: '360° Executive HR Summary',
                    prompt: 'Provide executive summary report for all HR operations',
                  },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendQuery(item.prompt)}
                    className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-100 bg-slate-50/70 hover:bg-indigo-50 hover:border-indigo-200 text-xs font-bold text-slate-700 hover:text-indigo-800 transition-all flex items-center space-x-2.5 cursor-pointer"
                  >
                    <span className="text-base shrink-0">{item.icon}</span>
                    <span className="line-clamp-1">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Individual Employee Quick Dossier Lookup */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider flex items-center space-x-1.5">
                  <span>👤</span>
                  <span>Single Employee 360° AI Dossier</span>
                </h4>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full">
                  {filteredEmployees.length} Staff
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Click on any employee to generate their full monthly attendance, late, overtime, and salary profile report:
              </p>
              <div className="space-y-1">
                {filteredEmployees.map(emp => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => handleSendQuery(`Show full audit report for ${emp.name} (${emp.employeeId})`)}
                    className="w-full text-left px-3 py-2 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-purple-50 hover:border-purple-200 text-xs flex items-center justify-between group cursor-pointer transition-all"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="font-bold text-slate-700 group-hover:text-purple-800 block truncate">
                        {emp.name}
                      </span>
                      <span className="text-[10px] text-slate-400 block truncate">{emp.designation}</span>
                    </div>
                    <span className="font-mono text-[10px] font-bold text-indigo-600 group-hover:text-purple-700 shrink-0">
                      {emp.employeeId} →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Chat & Interactive Report Viewer — Full-Page Flow without Fixed Height or Empty Space */}
          <div className="lg:col-span-8 bg-white rounded-3xl border border-slate-200 shadow-xs flex flex-col print:border-0 print:shadow-none">
            {/* Chat Window Header */}
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 rounded-t-3xl flex flex-wrap items-center justify-between gap-2 print:hidden">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center text-lg shadow-xs">
                  🤖
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-xs sm:text-sm">
                    WorkNest AI Report Bot ({selectedDate === todayStr ? `Today: ${todayStr}` : `Date: ${selectedDate}`})
                  </h3>
                  <p className="text-[11px] text-emerald-600 font-semibold">
                    ● Connected to Live Database ({filteredEmployees.length} Staff) — Daily &amp; Custom Date Filtering
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {speakingMsgId && (
                  <button
                    type="button"
                    onClick={handleStopVoice}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold cursor-pointer flex items-center space-x-1.5 shadow-xs animate-pulse"
                  >
                    <span>🔇</span>
                    <span>Stop Voice</span>
                  </button>
                )}
                {chatHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      handleStopVoice();
                      setChatHistory([]);
                    }}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    🔄 Reset to Default Report
                  </button>
                )}
              </div>
            </div>

            {/* Prominent AI Chatbot Date Filter & Navigation Toolbar */}
            <div className="px-4 py-2.5 bg-gradient-to-r from-indigo-50/90 via-violet-50/70 to-slate-50 border-b border-indigo-100/80 flex flex-wrap items-center justify-between gap-2.5 print:hidden">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                  <span className="text-sm">📅</span>
                  <span>Date Filter:</span>
                </span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => {
                    if (e.target.value) handleDateFilterChange(e.target.value);
                  }}
                  className="px-2.5 py-1 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-slate-800 shadow-2xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
                <span className="text-[11px] font-semibold text-slate-500">
                  {selectedDate === todayStr ? "(Today's Live Data)" : `(${selectedDate})`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleStepDate(-1)}
                  className="px-2.5 py-1 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-lg text-xs font-bold text-slate-700 hover:text-indigo-800 cursor-pointer shadow-2xs transition-all"
                  title="Previous Day"
                >
                  ◄ Previous Day
                </button>
                <button
                  type="button"
                  onClick={() => handleDateFilterChange(todayStr)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    selectedDate === todayStr
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white hover:bg-indigo-50 border border-slate-200 text-slate-700'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => handleStepDate(1)}
                  className="px-2.5 py-1 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-lg text-xs font-bold text-slate-700 hover:text-indigo-800 cursor-pointer shadow-2xs transition-all"
                  title="Next Day"
                >
                  Next Day ►
                </button>
              </div>
            </div>

            {/* Top AI Command & Voice Input Bar — Immediately Visible Without Scrolling */}
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSendQuery();
              }}
              className="p-3.5 sm:p-4 bg-indigo-50/50 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 print:hidden"
            >
              <div className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  onClick={handleStartVoiceInput}
                  className={`p-2.5 rounded-xl border text-sm font-bold transition-all cursor-pointer shrink-0 ${
                    isListeningVoice
                      ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                      : 'bg-white hover:bg-indigo-50 text-slate-700 border-slate-200 shadow-2xs'
                  }`}
                  title="Voice Command"
                >
                  🎙️
                </button>
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Ask anything (e.g. today attendance, 3-day late list, salary sheet, or employee name)..."
                  className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                />
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs sm:text-sm shadow-xs cursor-pointer shrink-0"
              >
                Generate Report 🚀
              </button>
            </form>

            {/* Full-Page Report & Chat Feed — Expands Naturally with Zero Empty Gap */}
            <div className="p-4 sm:p-5 space-y-4 bg-slate-50/30 rounded-b-3xl">
              {displayedMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.sender === 'user' ? 'items-end print:hidden' : 'items-start'}`}
                >
                  <div className="flex items-center space-x-1.5 mb-1 px-1 print:hidden">
                    <span className="text-[11px] font-bold text-slate-600">
                      {msg.sender === 'user' ? currentUser?.name || 'Admin Query' : '🤖 WorkNest AI Report Engine'}
                    </span>
                    <span className="text-[10px] text-slate-400">{msg.time}</span>
                  </div>

                  <div
                    className={`rounded-2xl p-4 text-xs sm:text-sm leading-relaxed shadow-2xs print:p-0 print:border-0 print:shadow-none ${
                      msg.sender === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-xs max-w-full sm:max-w-[90%]'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-bl-xs w-full'
                    }`}
                  >
                    <p className="whitespace-pre-line print:hidden">{msg.text}</p>

                    {/* Structured Report Card & Table inside AI Message */}
                    {msg.report && (
                      <div className="mt-4 pt-4 border-t border-slate-200 space-y-4 print:mt-0 print:pt-0 print:border-0">
                        {/* Report Header & Export Buttons */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                          <div>
                            <h4 className="font-black text-slate-900 text-xs sm:text-sm">
                              📊 {msg.report.title}
                            </h4>
                            {msg.report.subtitle && (
                              <p className="text-[11px] text-slate-500 mt-0.5">{msg.report.subtitle}</p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0 print:hidden">
                            <button
                              type="button"
                              onClick={() => handleToggleSpeakReport(msg.id, msg.text)}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer inline-flex items-center space-x-1 transition-all ${
                                speakingMsgId === msg.id
                                  ? 'bg-rose-600 hover:bg-rose-700 text-white border border-rose-600 shadow-xs animate-pulse'
                                  : 'bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200'
                              }`}
                              title={speakingMsgId === msg.id ? 'Stop voice reading' : 'Read summary aloud'}
                            >
                              <span>{speakingMsgId === msg.id ? '🔇' : '🔊'}</span>
                              <span>{speakingMsgId === msg.id ? 'Stop Voice' : 'Listen'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportReportCSV(msg.report!)}
                              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold cursor-pointer inline-flex items-center space-x-1"
                            >
                              <span>📥</span>
                              <span>Excel / CSV</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePrintAIReport(msg.report!, msg.text)}
                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold cursor-pointer inline-flex items-center space-x-1 shadow-2xs"
                            >
                              <span>🖨️</span>
                              <span>Print Report</span>
                            </button>
                          </div>
                        </div>

                        {/* Interactive Date Switcher directly inside Daily Report */}
                        {(msg.report.title.includes('Daily Attendance') || msg.report.title.includes("Today's")) && (
                          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-indigo-50/80 border border-indigo-200/80 rounded-xl print:hidden">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-indigo-950 flex items-center space-x-1">
                                <span>📅</span>
                                <span>Select Date for Report:</span>
                              </span>
                              <input
                                type="date"
                                value={selectedDate}
                                onChange={e => {
                                  if (e.target.value) handleDateFilterChange(e.target.value);
                                }}
                                className="px-2.5 py-1 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleStepDate(-1)}
                                className="px-2.5 py-1 bg-white hover:bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-bold text-indigo-800 cursor-pointer shadow-2xs transition-all"
                                title="Previous Day"
                              >
                                ◄ Previous Day
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDateFilterChange(todayStr)}
                                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                                  selectedDate === todayStr
                                    ? 'bg-indigo-600 text-white shadow-xs'
                                    : 'bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-800'
                                }`}
                              >
                                Today
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStepDate(1)}
                                className="px-2.5 py-1 bg-white hover:bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-bold text-indigo-800 cursor-pointer shadow-2xs transition-all"
                                title="Next Day"
                              >
                                Next Day ►
                              </button>
                            </div>
                          </div>
                        )}

                        {/* KPI Mini Cards */}
                        {msg.report.kpis && msg.report.kpis.length > 0 && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {msg.report.kpis.map((kpi, kIdx) => (
                              <div
                                key={kIdx}
                                className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-center"
                              >
                                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                  {kpi.label}
                                </span>
                                <span
                                  className={`text-sm font-black mt-0.5 block ${
                                    kpi.color === 'emerald'
                                      ? 'text-emerald-700'
                                      : kpi.color === 'rose'
                                      ? 'text-rose-600'
                                      : kpi.color === 'amber'
                                      ? 'text-amber-700'
                                      : 'text-indigo-700'
                                  }`}
                                >
                                  {kpi.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Smart 1-Click Action Button if applicable */}
                        {msg.report.actionType === 'send_late_warnings' && (
                          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <span className="text-xs font-bold text-rose-900">
                              🚨 Send official warning notice to all employees with 3+ late arrivals?
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSendBulkLateWarnings(msg.report?.targetEmployeeIds)}
                              className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shrink-0 cursor-pointer"
                            >
                              🚀 Send Official Warning to All
                            </button>
                          </div>
                        )}

                        {msg.report.actionType === 'send_punctual_appreciation' && (
                          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <span className="text-xs font-bold text-emerald-900">
                              🏆 Send official appreciation note to all employees with 100% punctuality?
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSendBulkAppreciation(msg.report?.targetEmployeeIds)}
                              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shrink-0 cursor-pointer"
                            >
                              🎉 Send Appreciation Message
                            </button>
                          </div>
                        )}

                        {/* Full-Height Report Table (No max-h cutoff) */}
                        <div className="overflow-x-auto thin-scroll border border-slate-200 rounded-xl">
                          <table className="w-full text-[11px] sm:text-xs">
                            <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                              <tr>
                                {msg.report.headers.map((h, hIdx) => (
                                  <th key={hIdx} className="px-3 py-2.5 text-left whitespace-nowrap">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                              {msg.report.rows.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={msg.report.headers.length}
                                    className="py-6 text-center text-slate-400"
                                  >
                                    No records found.
                                  </td>
                                </tr>
                              ) : (
                                msg.report.rows.map((row, rIdx) => (
                                  <tr key={rIdx} className="hover:bg-slate-50">
                                    {row.map((cell, cIdx) => {
                                      const isStatusCol = cIdx === row.length - 1;
                                      const cellStr = String(cell);
                                      return (
                                        <td
                                          key={cIdx}
                                          className={`px-3 py-2.5 whitespace-nowrap ${
                                            cIdx === 0 ? 'font-mono font-bold text-indigo-700' : 'text-slate-700'
                                          }`}
                                        >
                                          {isStatusCol && ['PRESENT', 'LATE', 'ABSENT', 'ON LEAVE', 'WEEKEND OFF', 'HALF DAY', 'SCHEDULED'].includes(cellStr) ? (
                                            <span
                                              className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${
                                                cellStr === 'PRESENT'
                                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                                  : cellStr === 'LATE'
                                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                                  : cellStr === 'ON LEAVE'
                                                  ? 'bg-purple-100 text-purple-800 border border-purple-300'
                                                  : cellStr === 'WEEKEND OFF'
                                                  ? 'bg-slate-100 text-slate-600 border border-slate-300'
                                                  : cellStr === 'HALF DAY'
                                                  ? 'bg-orange-100 text-orange-800 border border-orange-300'
                                                  : 'bg-rose-100 text-rose-800 border border-rose-300'
                                              }`}
                                            >
                                              {cellStr}
                                            </span>
                                          ) : (
                                            cell
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STUDIO TAB 2: AI HR LETTER & OFFICIAL NOTICE GENERATOR                    */}
      {/* ========================================================================= */}
      {activeStudioTab === 'letters' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Controls */}
          <div className="lg:col-span-4 bg-white rounded-3xl p-5 border border-slate-200 shadow-2xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-2">
              <span>📜</span>
              <span>Select HR Document Template</span>
            </h3>

            <div className="space-y-2">
              {[
                { id: 'late_warning', icon: '🚨', label: '3-Days Late Warning / Show-Cause Letter' },
                { id: 'appreciation', icon: '🏆', label: 'Employee of the Month Appreciation Letter' },
                { id: 'salary_certificate', icon: '💵', label: 'Official Salary Certificate / Bank NOC' },
                { id: 'appointment', icon: '💼', label: 'Official Appointment / Offer Letter' },
                { id: 'increment', icon: '📈', label: 'Salary Increment Notification Letter' },
                { id: 'office_notice', icon: '📢', label: 'Official Office Circular / Holiday Notice' },
              ].map(tItem => (
                <button
                  key={tItem.id}
                  type="button"
                  onClick={() => setSelectedLetterType(tItem.id as LetterTemplateType)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center space-x-2.5 cursor-pointer ${
                    selectedLetterType === tItem.id
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  <span className="text-base">{tItem.icon}</span>
                  <span>{tItem.label}</span>
                </button>
              ))}
            </div>

            {selectedLetterType !== 'office_notice' ? (
              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Select Target Employee</label>
                  <select
                    value={selectedLetterEmpId}
                    onChange={e => setSelectedLetterEmpId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                  >
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.employeeId}) — {e.designation}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedLetterType === 'increment' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Monthly Increment Amount (৳)
                    </label>
                    <input
                      type="number"
                      value={incrementAmountInput}
                      onChange={e => setIncrementAmountInput(Number(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Notice Subject</label>
                  <input
                    type="text"
                    value={customNoticeSubject}
                    onChange={e => setCustomNoticeSubject(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Notice Body (Bangla / English)</label>
                  <textarea
                    rows={4}
                    value={customNoticeBody}
                    onChange={e => setCustomNoticeBody(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
                  />
                </div>
              </div>
            )}

            <div className="pt-2 space-y-2 print:hidden">
              <button
                type="button"
                onClick={handleDispatchLetterToEmployee}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer flex items-center justify-center space-x-2"
              >
                <span>🚀</span>
                <span>Send Directly to Employee Panel</span>
              </button>
              <button
                type="button"
                onClick={handlePrintOfficialLetter}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer flex items-center justify-center space-x-2"
              >
                <span>🖨️</span>
                <span>Print Official Letterhead</span>
              </button>
            </div>
          </div>

          {/* Right Live Printable Letter Preview */}
          <div className="lg:col-span-8 bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 border-b-2 border-slate-200 gap-3">
              <div>
                <h2 className="text-xl font-black text-slate-900 uppercase">
                  {currentCompany?.name || 'WORKNEST HR MANAGEMENT'}
                </h2>
                <p className="text-xs text-slate-500">
                  Official Human Resources &amp; Administration Correspondence
                </p>
              </div>
              <div className="text-left sm:text-right text-xs font-mono text-slate-600">
                <p>
                  <strong>Ref:</strong> {generatedOfficialLetter.refNo}
                </p>
                <p>
                  <strong>Date:</strong> {todayStr}
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
              <span className="text-slate-400 font-bold uppercase block text-[10px]">Recipient / To:</span>
              <span className="font-bold text-slate-900 text-sm">{generatedOfficialLetter.recipient}</span>
            </div>

            <div className="p-3.5 bg-indigo-50/70 border-l-4 border-indigo-600 rounded-r-xl">
              <p className="font-black text-indigo-950 text-xs sm:text-sm">
                SUBJECT: {generatedOfficialLetter.subject}
              </p>
            </div>

            <div className="space-y-4 text-xs sm:text-sm text-slate-800 leading-relaxed">
              <div className="p-4 bg-white rounded-2xl border border-slate-100 whitespace-pre-line">
                {generatedOfficialLetter.bodyBangla}
              </div>

              <div className="p-4 bg-slate-50/70 rounded-2xl border border-slate-100 whitespace-pre-line text-slate-700">
                {generatedOfficialLetter.bodyEnglish}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-8 border-t border-slate-200 text-xs">
              <div>
                <p className="font-bold text-slate-900">{currentUser?.name || 'HR Administration'}</p>
                <p className="text-slate-500">Authorized Signatory • {currentCompany?.name || 'WorkNest HR'}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-slate-900">Recipient Signature</p>
                <p className="text-slate-400">Date &amp; Acknowledgment</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STUDIO TAB 3: SMART AUTO-AUDIT & 1-CLICK ACTION CENTER                    */}
      {/* ========================================================================= */}
      {activeStudioTab === 'audit' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Card 1: 3+ Days Late Disciplinary Audit */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-rose-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 bg-rose-100 text-rose-800 rounded-full text-xs font-black uppercase">
                🚨 3+ Days Late Audit
              </span>
              <span className="text-xl font-black text-rose-600">
                {employeeAnalytics.filter(a => a.totalLate >= 3).length} Staff
              </span>
            </div>
            <h3 className="font-bold text-slate-900 text-base">
              Employees with 3 or More Late Arrivals ({formatMonthLabel(selectedMonth)})
            </h3>
            <p className="text-xs text-slate-600">
              Official warning notices can be dispatched to these employees in one click.
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1.5 thin-scroll">
              {employeeAnalytics.filter(a => a.totalLate >= 3).length === 0 ? (
                <p className="text-xs text-emerald-700 font-semibold py-4">
                  ✅ Excellent! No employees have 3 or more late arrivals this month.
                </p>
              ) : (
                employeeAnalytics
                  .filter(a => a.totalLate >= 3)
                  .map(a => (
                    <div
                      key={a.emp.id}
                      className="p-2.5 bg-rose-50/60 border border-rose-200/70 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-bold text-slate-900">{a.emp.name}</span>{' '}
                        <span className="font-mono text-[10px] text-rose-700">({a.emp.employeeId})</span>
                        <p className="text-[11px] text-slate-500">
                          {a.totalLate} Late Days • Penalty Cut: ৳{a.lateCut.toLocaleString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSendBulkLateWarnings([a.emp.id])}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                      >
                        Send Warning
                      </button>
                    </div>
                  ))
              )}
            </div>
            {employeeAnalytics.filter(a => a.totalLate >= 3).length > 0 && (
              <button
                type="button"
                onClick={() => handleSendBulkLateWarnings()}
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                🚀 Send Warning Letter to All ({employeeAnalytics.filter(a => a.totalLate >= 3).length}) Staff
              </button>
            )}
          </div>

          {/* Card 2: Top Punctual Champions */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-emerald-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-black uppercase">
                🏆 100% Punctual Staff
              </span>
              <span className="text-xl font-black text-emerald-600">
                {employeeAnalytics.filter(a => a.unexcusedLate === 0).length} Staff
              </span>
            </div>
            <h3 className="font-bold text-slate-900 text-base">
              Zero Unexcused Late Arrivals ({formatMonthLabel(selectedMonth)})
            </h3>
            <p className="text-xs text-slate-600">
              Employees with zero unexcused late arrivals this month. Send an official appreciation note in one click.
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1.5 thin-scroll">
              {employeeAnalytics
                .filter(a => a.unexcusedLate === 0)
                .slice(0, 8)
                .map(a => (
                  <div
                    key={a.emp.id}
                    className="p-2.5 bg-emerald-50/60 border border-emerald-200/70 rounded-xl flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-900">{a.emp.name}</span>{' '}
                      <span className="font-mono text-[10px] text-emerald-700">({a.emp.employeeId})</span>
                      <p className="text-[11px] text-slate-500">
                        Present: {a.presentDays}d • OT: {a.overtimeHours}h • Score: {a.punctualityScore}/100
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSendBulkAppreciation([a.emp.id])}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                    >
                      Appreciate
                    </button>
                  </div>
                ))}
            </div>
            <button
              type="button"
              onClick={() => handleSendBulkAppreciation()}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
            >
              🎉 Send Appreciation to All Punctual Staff
            </button>
          </div>

          {/* Card 3: Pending Leave & Word/PDF Document Verification */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-indigo-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-black uppercase">
                📎 Leave &amp; Document Verification
              </span>
              <span className="text-xl font-black text-indigo-600">
                {leaveRequests.filter(l => l.status === 'pending').length} Pending
              </span>
            </div>
            <h3 className="font-bold text-slate-900 text-base">
              Pending Leave Applications &amp; Uploaded Word/PDF Files
            </h3>
            <p className="text-xs text-slate-600">
              Total {leaveRequests.filter(l => Boolean(l.attachmentDataUrl)).length} leave requests submitted with supporting Word/PDF documents.
            </p>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('leave')}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                🔍 Go to Leave Justification &amp; Approval Module →
              </button>
            )}
          </div>

          {/* Card 4: Pending Late Arrival Waivers */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-amber-200 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-black uppercase">
                📝 Late Waiver Requests
              </span>
              <span className="text-xl font-black text-amber-600">
                {attendanceRequests.filter(r => r.status === 'pending').length} Pending
              </span>
            </div>
            <h3 className="font-bold text-slate-900 text-base">
              Pending Late Arrival Waiver &amp; Early Checkout Requests
            </h3>
            <p className="text-xs text-slate-600">
              Review and approve employee late arrival waiver applications to waive salary penalty cuts.
            </p>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('attendance')}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                📅 Review in Attendance Module →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* AI REPORT DEDICATED PRINT PREVIEW & EXECUTION MODAL                       */}
      {/* ========================================================================= */}
      {previewPrintReport && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Control Bar */}
            <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className="flex items-center space-x-2.5">
                <span className="text-xl">🖨️</span>
                <div>
                  <h3 className="font-black text-sm">{previewPrintReport.report.title}</h3>
                  <p className="text-[11px] text-slate-300">
                    Official A4 Print &amp; PDF Document Preview ({previewPrintReport.report.rows.length} Records)
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const config = buildPrintConfigForAIReport(previewPrintReport.report);
                    const html = generateReportHtml(config);
                    const ok = await printViaIframe(html);
                    if (!ok) {
                      window.print();
                    }
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer flex items-center space-x-1.5 shadow-sm"
                >
                  <span>🖨️</span>
                  <span>Print Now / Save PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const config = buildPrintConfigForAIReport(previewPrintReport.report);
                    const html = generateReportHtml(config);
                    const safeName = previewPrintReport.report.title.replace(/[^a-zA-Z0-9_-]+/g, '_');
                    downloadReportHtml(safeName, html);
                  }}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold cursor-pointer flex items-center space-x-1.5"
                >
                  <span>📄</span>
                  <span>Download Printable Sheet</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportReportCSV(previewPrintReport.report)}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold cursor-pointer flex items-center space-x-1.5 border border-slate-700"
                >
                  <span>📥</span>
                  <span>Excel / CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewPrintReport(null)}
                  className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white font-bold cursor-pointer flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Printable A4 Sheet Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-100 print:p-0 print:bg-white">
              <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-300 shadow-xs max-w-4xl mx-auto space-y-5 print:border-0 print:shadow-none print:p-0">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between border-b-2 border-slate-900 pb-4 gap-3">
                  <div>
                    <h2 className="text-lg sm:text-xl font-black text-slate-900 uppercase">
                      {currentCompany?.name || 'WorkNest HRMS — Enterprise Workforce Operations'}
                    </h2>
                    <h3 className="text-sm sm:text-base font-bold text-indigo-950 mt-0.5">
                      {previewPrintReport.report.title}
                    </h3>
                    {previewPrintReport.report.subtitle && (
                      <p className="text-xs text-slate-500 mt-0.5">{previewPrintReport.report.subtitle}</p>
                    )}
                  </div>
                  <div className="text-left sm:text-right text-xs text-slate-600 font-mono">
                    <p>
                      <strong>Period:</strong> {formatMonthLabel(selectedMonth)}
                    </p>
                    <p>
                      <strong>Records:</strong> {previewPrintReport.report.rows.length}
                    </p>
                    <p>
                      <strong>Date:</strong> {todayStr}
                    </p>
                  </div>
                </div>

                {previewPrintReport.report.kpis && previewPrintReport.report.kpis.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {previewPrintReport.report.kpis.map((kpi, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-center">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">{kpi.label}</span>
                        <span className="text-sm font-black text-slate-900 mt-0.5 block">{kpi.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="overflow-x-auto border border-slate-300 rounded-xl">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-white">
                        {previewPrintReport.report.headers.map((h, i) => (
                          <th key={i} className="px-3 py-2 font-bold text-[10px] uppercase border border-slate-800">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {previewPrintReport.report.rows.map((row, rIdx) => (
                        <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-3 py-2 border border-slate-200 text-[11px] text-slate-800">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="pt-8 mt-6 border-t border-slate-300 grid grid-cols-3 gap-4 text-center text-xs">
                  <div>
                    <div className="border-t border-dashed border-slate-400 pt-1.5 font-bold text-slate-900">
                      Prepared By
                    </div>
                    <span className="text-[10px] text-slate-500">HR Operations</span>
                  </div>
                  <div>
                    <div className="border-t border-dashed border-slate-400 pt-1.5 font-bold text-slate-900">
                      Verified By
                    </div>
                    <span className="text-[10px] text-slate-500">Head of HR</span>
                  </div>
                  <div>
                    <div className="border-t border-dashed border-slate-400 pt-1.5 font-bold text-slate-900">
                      Approved By
                    </div>
                    <span className="text-[10px] text-slate-500">Managing Director</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* OFFICIAL HR LETTER PRINT PREVIEW MODAL                                    */}
      {/* ========================================================================= */}
      {isLetterPrintModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className="flex items-center space-x-2">
                <span className="text-xl">📜</span>
                <div>
                  <h3 className="font-black text-sm">{generatedOfficialLetter.title}</h3>
                  <p className="text-[11px] text-slate-300">Ref: {generatedOfficialLetter.refNo}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const html = generateOfficialLetterHtml();
                    const ok = await printViaIframe(html);
                    if (!ok) window.print();
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer flex items-center space-x-1.5"
                >
                  <span>🖨️</span>
                  <span>Print Now / Save PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const html = generateOfficialLetterHtml();
                    downloadReportHtml(generatedOfficialLetter.refNo.replace(/[^a-zA-Z0-9_-]+/g, '_'), html);
                  }}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold cursor-pointer flex items-center space-x-1.5"
                >
                  <span>📄</span>
                  <span>Download Printable Letter</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsLetterPrintModalOpen(false)}
                  className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white font-bold cursor-pointer flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-100">
              <div className="bg-white rounded-2xl p-6 sm:p-10 border border-slate-300 max-w-3xl mx-auto space-y-5">
                <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 uppercase">
                      {currentCompany?.name || 'WORKNEST HR MANAGEMENT'}
                    </h2>
                    <p className="text-xs text-slate-500">Official Human Resources Correspondence</p>
                  </div>
                  <div className="text-right text-xs font-mono text-slate-600">
                    <p>
                      <strong>Ref:</strong> {generatedOfficialLetter.refNo}
                    </p>
                    <p>
                      <strong>Date:</strong> {todayStr}
                    </p>
                  </div>
                </div>
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <span className="text-slate-400 font-bold uppercase block text-[10px]">Recipient / To:</span>
                  <span className="font-bold text-slate-900 text-sm">{generatedOfficialLetter.recipient}</span>
                </div>
                <div className="p-3.5 bg-indigo-50/70 border-l-4 border-indigo-600 rounded-r-xl font-black text-indigo-950 text-xs sm:text-sm">
                  SUBJECT: {generatedOfficialLetter.subject}
                </div>
                <div className="p-4 bg-white rounded-xl border border-slate-200 whitespace-pre-line text-xs sm:text-sm text-slate-800 leading-relaxed">
                  {generatedOfficialLetter.bodyBangla}
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 whitespace-pre-line text-xs sm:text-sm text-slate-700 leading-relaxed">
                  {generatedOfficialLetter.bodyEnglish}
                </div>
                <div className="grid grid-cols-2 gap-4 pt-10 border-t border-slate-300 text-xs">
                  <div>
                    <p className="font-bold text-slate-900">{currentUser?.name || 'HR Administration'}</p>
                    <p className="text-slate-500">Authorized Signatory</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-900">Recipient Signature</p>
                    <p className="text-slate-400">Date &amp; Acknowledgment</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
