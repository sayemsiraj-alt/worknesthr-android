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
  } = useData();
  const { currentCompanyId, currentCompany } = useTenant();

  // Studio Mode Tabs
  const [activeStudioTab, setActiveStudioTab] = useState<'chat' | 'letters' | 'audit'>('chat');

  // Selected Month & Branch Filter for Reports
  const [todayStr] = useState(() => getBangladeshTodayStr());
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
  const buildTodayAttendanceReport = (): { text: string; report: ReportTableData } => {
    const presentList = employeeAnalytics.filter(a => a.todayStatus === 'present' || a.todayStatus === 'late');
    const lateToday = employeeAnalytics.filter(a => a.todayStatus === 'late');
    const leaveToday = employeeAnalytics.filter(a => a.todayStatus === 'on_leave');
    const absentToday = employeeAnalytics.filter(a => a.todayStatus === 'absent');

    return {
      text: `📅 আজকের (${todayStr}) লাইভ অ্যাটেনডেন্স রিপোর্ট তৈরি হয়েছে। মোট ${employeeAnalytics.length} জন কর্মচারীর মধ্যে উপস্থিত (Present) আছেন ${presentList.length} জন (যার মধ্যে আজ লেট করেছেন ${lateToday.length} জন), ছুটিতে আছেন ${leaveToday.length} জন এবং অনুপস্থিত (Absent/Not Punched) ${absentToday.length} জন।`,
      report: {
        title: `Today's Live Attendance Report (${todayStr})`,
        subtitle: `Branch: ${selectedBranchFilter === 'ALL' ? 'All Branches' : selectedBranchFilter} • Total Staff: ${employeeAnalytics.length}`,
        kpis: [
          { label: 'Total Staff', value: `${employeeAnalytics.length}`, color: 'indigo' },
          { label: 'Present Today', value: `${presentList.length}`, color: 'emerald' },
          { label: 'Late Today', value: `${lateToday.length}`, color: 'amber' },
          { label: 'Absent / Unpunched', value: `${absentToday.length}`, color: 'rose' },
        ],
        headers: ['Employee ID', 'Name', 'Designation', 'Department', 'Branch', 'First In', 'Last Out', 'Status'],
        rows: employeeAnalytics.map(a => [
          a.emp.employeeId,
          a.emp.name,
          a.emp.designation,
          a.emp.department,
          a.emp.branch || 'Head Office',
          a.todayIn !== '-' ? formatTo12Hour(a.todayIn) : '-',
          a.todayOut !== '-' ? formatTo12Hour(a.todayOut) : '-',
          a.todayStatus.toUpperCase(),
        ]),
      },
    };
  };

  const buildThreeDaysLateReport = (): { text: string; report: ReportTableData } => {
    const threePlusLate = employeeAnalytics.filter(a => a.totalLate >= 3);
    const anyLate = employeeAnalytics.filter(a => a.totalLate > 0).sort((a, b) => b.totalLate - a.totalLate);
    const totalDeduction = anyLate.reduce((s, a) => s + a.lateCut, 0);

    return {
      text: `🚨 ${formatMonthLabel(selectedMonth)} মাসের লেট উপস্থিতি ও ডিসিপ্লিনারি অডিট সম্পন্ন হয়েছে। মোট ${threePlusLate.length} জন কর্মচারী ৩ দিন বা তার বেশি লেট করেছেন (যাদের Employee Panel-এ অটোমেটিক অফিশিয়াল ওয়ার্নিং লেটার হাইলাইট হয়েছে) এবং মোট লেট ডিডাকশন দাঁড়িয়েছে ৳${totalDeduction.toLocaleString()}।`,
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
      text: `💰 ${formatMonthLabel(selectedMonth)} মাসের সম্পূর্ণ পেরোল ও স্যালারি শিট তৈরি হয়েছে। মোট ${employeeAnalytics.length} জন কর্মচারীর গ্রস স্যালারি ৳${totalGross.toLocaleString()}, ওভারটাইম পে ৳${totalOt.toLocaleString()}, মোট কর্তন (Deductions) ৳${totalDeductions.toLocaleString()} এবং নিট প্রদেয় বেতন (Net Payable) ৳${totalNet.toLocaleString()}।`,
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
      text: `🏆 ${formatMonthLabel(selectedMonth)} মাসের সেরা নিয়মানুবর্তী ও টপ পারফর্মার র‍্যাঙ্কিং তৈরি হয়েছে! মোট ${zeroLateStaff.length} জন কর্মচারী এই মাসে ০ দিন আন-এক্সকিউজড লেট রেখেছেন। র‍্যাঙ্কিংয়ে ১ নম্বরে আছেন ${ranked[0]?.emp.name || 'N/A'} (স্কোর: ${ranked[0]?.punctualityScore || 100}/100)।`,
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
      text: `⏱️ ${formatMonthLabel(selectedMonth)} মাসের ওভারটাইম ও উইকেন্ড ডিউটি রিপোর্ট তৈরি হয়েছে। মোট ওভারটাইম হয়েছে ${totalOtHours.toFixed(1)} ঘণ্টা (৳${totalOtPay.toLocaleString()}) এবং উইকেন্ড ডিউটি ভাতা ৳${totalWkPay.toLocaleString()}।`,
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
      text: `🏖️ ছুটি ও লেট ওয়েভার অডিট রিপোর্ট: মোট ${leaveRequests.length}টি ছুটির আবেদনের মধ্যে ${pendingLeaves.length}টি পেন্ডিং, ${approvedLeaves.length}টি অনুমোদিত এবং ${withFiles.length}টি আবেদনের সাথে Word/PDF দরখাস্ত সংযুক্ত রয়েছে। পাশাপাশি ${pendingWaivers.length}টি লেট ওয়েভার আবেদন পেন্ডিং আছে।`,
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
      text: `🏢 ব্রাঞ্চ ও ডিপার্টমেন্ট ভিত্তিক জনবল এবং মাসিক বেতন খরচের ব্রেকডাউন তৈরি হয়েছে। বর্তমানে মোট ${branches.length}টি ব্রাঞ্চ এবং ${departments.length}টি ডিপার্টমেন্ট সক্রিয় আছে।`,
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
      text: `⚠️ অ্যাটেনডেন্স মিসিং পাঞ্চ ও অনুপস্থিতি অডিট: ${formatMonthLabel(selectedMonth)} মাসে ${flagged.length} জন কর্মচারীর মিসিং চেক-আউট অথবা অনুপস্থিতি (Absent) রেকর্ড পাওয়া গেছে।`,
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
      text: `👤 কর্মচারী **${item.emp.name}** (${item.emp.employeeId} • ${item.emp.designation}, ${item.emp.department})-এর ${formatMonthLabel(selectedMonth)} মাসের ৩৬০° পূর্ণাঙ্গ রিপোর্ট তৈরি হয়েছে। উপস্থিত: ${item.presentDays} দিন, লেট: ${item.totalLate} দিন (আন-এক্সকিউজড: ${item.unexcusedLate} দিন), ওভারটাইম: ${item.overtimeHours} ঘণ্টা এবং নিট বেতন: ৳${item.netPayable.toLocaleString()}।`,
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
      text: `📊 **${currentCompany?.name || 'WorkNest HR'} — ৩৬০° এক্সিকিউটিভ এইচআর সামারি রিপোর্ট (${formatMonthLabel(selectedMonth)}):**\n• মোট কর্মচারী: ${employeeAnalytics.length} জন (আজ উপস্থিত: ${presentToday} জন)\n• ৩+ দিন লেট (Warning Issued): ${threeLateCount} জন\n• মাসিক নিট স্যালারি বাজেট: ৳${totalNet.toLocaleString()} (ওভারটাইম: ৳${totalOt.toLocaleString()}, লেট কর্তন সাশ্রয়: ৳${totalLateCut.toLocaleString()})`,
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

    // 1. Check if query mentions a specific employee by Name or Employee ID
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

    // 2. Check for 3+ Days Late / Warning / Late List
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

    // 3. Check for Today's Attendance / Present / Absent Today
    if (
      q.includes('today') ||
      q.includes('ajke') ||
      q.includes('ajker') ||
      q.includes('আজকে') ||
      q.includes('আজকের') ||
      q.includes('daily') ||
      (q.includes('present') && !q.includes('month'))
    ) {
      return buildTodayAttendanceReport();
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

    // Default: Full Executive 360° Report
    return buildExecutiveSummaryReport();
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

  // Live Default Report shown automatically when chatHistory is empty so there is NEVER any blank space
  const defaultLiveReportMsg = useMemo<ChatItem>(() => {
    const execReport = buildExecutiveSummaryReport();
    return {
      id: 'live_default_exec_report',
      sender: 'ai',
      time: 'Live Now',
      text: execReport.text,
      report: execReport.report,
    };
  }, [employeeAnalytics, selectedMonth, selectedBranchFilter]);

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
      setActionFeedbackMsg('আপনার ব্রাউজারে ভয়েস টাইপিং সাপোর্ট করছে না, অনুগ্রহ করে টেক্সট বক্সে টাইপ করুন।');
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
    <div class="subject">বিষয় / SUBJECT: ${generatedOfficialLetter.subject}</div>
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
        subject: `🚨 OFFICIAL WARNING LETTER: ${item.totalLate} Days Late in ${formatMonthLabel(selectedMonth)}`,
        content: `প্রিয় ${item.emp.name} (${item.emp.employeeId}), ${formatMonthLabel(selectedMonth)} মাসে আপনার মোট ${item.totalLate} দিন লেট (Late Arrival) রেকর্ড হয়েছে (${item.lateDates.map(d => d.date).join(', ')})। কোম্পানির নিয়ম অনুযায়ী ৩ দিন লেটের কারণে আপনার ${item.latePenaltyDays} দিনের বেতন কর্তন (৳${item.lateCut.toLocaleString()}) প্রযোজ্য হয়েছে। আগামী দিন থেকে নির্ধারিত সময়ে অফিসে উপস্থিত হওয়ার জন্য বিশেষভাবে সতর্ক করা হলো।`,
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
      `✅ মোট ${targets.length} জন (৩+ দিন লেট) কর্মচারীর প্যানেলে অফিশিয়াল ওয়ার্নিং মেসেজ ও নোটিফিকেশন পাঠানো হয়েছে!`
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
        content: `অভিনন্দন ${item.emp.name}! ${formatMonthLabel(selectedMonth)} মাসে আপনার সময়ানুবর্তিতা (০ আন-এক্সকিউজড লেট, স্কোর: ${item.punctualityScore}/100) অত্যন্ত প্রশংসনীয়। আপনার নিষ্ঠার জন্য ধন্যবাদ!`,
        unread: true,
      });
    }

    setActionFeedbackMsg(
      `🏆 মোট ${targets.length} জন নিয়মানুবর্তী কর্মচারীর প্যানেলে প্রশংসাপত্র মেসেজ পাঠানো হয়েছে!`
    );
    setTimeout(() => setActionFeedbackMsg(''), 6000);
  };

  // =========================================================================
  // TAB 2: AI HR LETTER & OFFICIAL NOTICE STUDIO STATE
  // =========================================================================
  const [selectedLetterType, setSelectedLetterType] = useState<LetterTemplateType>('late_warning');
  const [selectedLetterEmpId, setSelectedLetterEmpId] = useState<string>(() => employees[0]?.id || '');
  const [customNoticeSubject, setCustomNoticeSubject] = useState('অফিস সময়সূচি ও শৃঙ্খলা সংক্রান্ত বিশেষ বিজ্ঞপ্তি');
  const [customNoticeBody, setCustomNoticeBody] = useState(
    'সকল কর্মকর্তা ও কর্মচারীদের জানানো যাচ্ছে যে, আগামী কার্যদিবস থেকে নির্ধারিত শিফট টাইমের মধ্যে অফিসে উপস্থিত হয়ে বায়োমেট্রিক/ক্যামেরা পাঞ্চ সম্পন্ন করার জন্য অনুরোধ করা হলো।'
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
        subject: `${formatMonthLabel(selectedMonth)} মাসে ${lateCount} দিন বিলম্বে অফিসে উপস্থিত হওয়ার কারণে অফিশিয়াল সতর্কবার্তা (Official Warning Letter for Late Attendance)।`,
        bodyBangla: `জনাব/জনাবা ${emp.name},\n\nঅফিস অ্যাটেনডেন্স ডাটাবেস পর্যালোচনা করে দেখা গেছে যে, আপনি চলমান ${formatMonthLabel(selectedMonth)} মাসে মোট ${lateCount} দিন (${lateDatesList}) নির্ধারিত শিফট ও গ্রেস টাইমের পরে অফিসে প্রবেশ করেছেন।\n\nকোম্পানির মানবসম্পদ নীতিমালা অনুযায়ী প্রতি ৩ দিন আন-এক্সকিউজড লেটের জন্য ১ দিনের বেতন কর্তন (আনুমানিক ৳${cutAmt.toLocaleString()}) প্রযোজ্য। আপনাকে পরবর্তী কার্যদিবস থেকে সঠিক সময়ে অফিসে উপস্থিত থাকার জন্য কঠোরভাবে নির্দেশ প্রদান করা হলো।`,
        bodyEnglish: `Dear ${emp.name},\n\nThis letter serves as an official disciplinary warning regarding your repeated late arrivals during ${formatMonthLabel(selectedMonth)}. Our biometric/attendance records indicate ${lateCount} late check-in instance(s) (${lateDatesList}). In accordance with company policy (3 late arrivals = 1 day salary deduction), a deduction of BDT ${cutAmt.toLocaleString()} is applicable. You are strictly advised to maintain punctuality going forward.`,
      };
    }

    if (selectedLetterType === 'appreciation') {
      return {
        refNo: refPrefix,
        title: 'EMPLOYEE OF THE MONTH & PUNCTUALITY APPRECIATION LETTER',
        recipient: `${emp.name} (${emp.employeeId}) — ${emp.designation}, ${emp.department}`,
        subject: `${formatMonthLabel(selectedMonth)} মাসে অসাধারণ সময়ানুবর্তিতা ও কর্মদক্ষতার জন্য অফিশিয়াল প্রশংসাপত্র (Letter of Appreciation)।`,
        bodyBangla: `প্রিয় ${emp.name},\n\nঅত্যন্ত আনন্দের সাথে জানানো যাচ্ছে যে, ${formatMonthLabel(selectedMonth)} মাসে আপনার শতভাগ সময়ানুবর্তিতা (Punctuality Score: ${empItem?.punctualityScore || 100}/100), নিয়মিত উপস্থিতি (${empItem?.presentDays || 26} দিন) এবং কাজের প্রতি একনিষ্ঠতার জন্য আপনাকে ${companyName}-এর পক্ষ থেকে আন্তরিক অভিনন্দন ও প্রশংসাপত্র প্রদান করা হচ্ছে।\n\nআমরা আপনার উজ্জ্বল ভবিষ্যৎ ও উত্তরোত্তর সাফল্য কামনা করি।`,
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
        subject: `প্রত্যয়নপত্র ও স্যালারি সার্টিফিকেট (Official Employment & Monthly Salary Certificate for ${emp.name})।`,
        bodyBangla: `এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, জনাব/জনাবা ${emp.name} (Employee ID: ${emp.employeeId}), পদবি: ${emp.designation}, বিভাগ: ${emp.department}, গত ${emp.joinDate || 'N/A'} তারিখ থেকে আমাদের প্রতিষ্ঠান "${companyName}"-এ একজন স্থায়ী ও নিয়মিত কর্মচারী হিসেবে কর্মরত আছেন।\n\nতার বর্তমান মাসিক মোট বেতন (Gross Salary) ৳${gross.toLocaleString()} টাকা (মূল বেতন / Basic: ৳${basic.toLocaleString()} টাকা এবং অন্যান্য ভাতা ৳${(gross - basic).toLocaleString()} টাকা)। আমাদের জানামতে তিনি একজন সৎ ও দায়িত্বশীল ব্যক্তি।`,
        bodyEnglish: `This is to certify that ${emp.name} (Employee Code: ${emp.employeeId}) has been employed with ${companyName} since ${emp.joinDate || 'N/A'} as ${emp.designation} in the ${emp.department} Department.\n\nHis/Her current monthly Gross Salary is BDT ${gross.toLocaleString()} (Basic Salary: BDT ${basic.toLocaleString()} plus standard allowances of BDT ${(gross - basic).toLocaleString()}). This certificate is issued upon the employee's request for official/banking purposes.`,
      };
    }

    if (selectedLetterType === 'appointment') {
      const gross = empItem?.grossSalary || Number(emp.grossSalary) || 30000;
      return {
        refNo: refPrefix,
        title: 'LETTER OF APPOINTMENT (অফিশিয়াল নিয়োগপত্র)',
        recipient: `${emp.name} (${emp.employeeId}) — ${emp.designation}, ${emp.department}`,
        subject: `${companyName}-এ "${emp.designation}" পদে নিয়োগপত্র (Official Letter of Appointment)।`,
        bodyBangla: `প্রিয় ${emp.name},\n\nআনন্দের সাথে জানানো যাচ্ছে যে, কর্তৃপক্ষের সিদ্ধান্ত অনুযায়ী আপনাকে "${companyName}"-এর ${emp.department} বিভাগে "${emp.designation}" পদে নিয়োগ প্রদান করা হলো। আপনার যোগদানের তারিখ ${emp.joinDate || todayStr} এবং আপনার মাসিক সর্বসাকুল্যে বেতন (Gross Salary) হবে ৳${gross.toLocaleString()} টাকা।\n\nকোম্পানির নির্ধারিত শিফট, বায়োমেট্রিক উপস্থিতি এবং মানবসম্পদ নীতিমালা আপনার ক্ষেত্রে প্রযোজ্য হবে।`,
        bodyEnglish: `Dear ${emp.name},\n\nWe are pleased to appoint you as "${emp.designation}" in the ${emp.department} Department at ${companyName}, effective from ${emp.joinDate || todayStr}. Your monthly gross compensation will be BDT ${gross.toLocaleString()}, subject to company attendance and HR policies.`,
      };
    }

    if (selectedLetterType === 'increment') {
      const oldGross = empItem?.grossSalary || Number(emp.grossSalary) || 30000;
      const newGross = oldGross + (Number(incrementAmountInput) || 0);
      return {
        refNo: refPrefix,
        title: 'SALARY INCREMENT & PERFORMANCE LETTER (বেতন বৃদ্ধির চিঠি)',
        recipient: `${emp.name} (${emp.employeeId}) — ${emp.designation}, ${emp.department}`,
        subject: `বার্ষিক কর্মমূল্যায়ন ও মাসিক বেতন বৃদ্ধি প্রসঙ্গে (Official Salary Increment Notification)।`,
        bodyBangla: `প্রিয় ${emp.name},\n\nআপনার নিরলস পরিশ্রম, সময়ানুবর্তিতা এবং সন্তোষজনক পারফরম্যান্সের স্বীকৃতিস্বরূপ কর্তৃপক্ষ আপনার মাসিক বেতন ৳${(Number(incrementAmountInput) || 0).toLocaleString()} টাকা বৃদ্ধি করার সিদ্ধান্ত গ্রহণ করেছে।\n\nপূর্ববর্তী গ্রস স্যালারি: ৳${oldGross.toLocaleString()} টাকা\nবর্ধিত নতুন গ্রস স্যালারি: ৳${newGross.toLocaleString()} টাকা\n\nআপনার নিষ্ঠা ও অবদানের জন্য আন্তরিক ধন্যবাদ।`,
        bodyEnglish: `Dear ${emp.name},\n\nIn recognition of your dedicated performance and punctuality at ${companyName}, management is pleased to grant you a monthly salary increment of BDT ${(Number(incrementAmountInput) || 0).toLocaleString()}. Your revised monthly Gross Salary is now BDT ${newGross.toLocaleString()} (previously BDT ${oldGross.toLocaleString()}).`,
      };
    }

    return {
      refNo: `WN/HR/NOTICE/${todayStr.replace(/-/g, '')}`,
      title: 'OFFICIAL HR NOTICE & CIRCULAR (অফিস বিজ্ঞপ্তি)',
      recipient: 'সকল কর্মকর্তা ও কর্মচারীবৃন্দ (All Employees & Departments)',
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
        subject: `📢 অফিস নোটিশ: ${generatedOfficialLetter.subject}`,
        content: `${generatedOfficialLetter.bodyBangla}\n\n(Ref: ${generatedOfficialLetter.refNo})`,
        unread: true,
      });
      setActionFeedbackMsg('✅ অফিস নোটিশটি সকল কর্মচারীর Employee Panel-এ পাঠিয়ে দেওয়া হয়েছে!');
    } else if (selectedLetterEmpAnalytics) {
      await sendMessage({
        from: currentUser?.name || 'HR Administration',
        fromAvatar: '📜',
        to: selectedLetterEmpAnalytics.emp.name,
        toEmployeeId: selectedLetterEmpAnalytics.emp.id,
        subject: `📜 ${generatedOfficialLetter.title}`,
        content: `${generatedOfficialLetter.subject}\n\n${generatedOfficialLetter.bodyBangla}\n\n(Ref: ${generatedOfficialLetter.refNo})`,
        unread: true,
      });
      setActionFeedbackMsg(
        `✅ "${generatedOfficialLetter.title}" চিঠিটি ${selectedLetterEmpAnalytics.emp.name}-এর Employee Panel-এ সরাসরি পাঠানো হয়েছে!`
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
              চ্যাটবটকে বাংলা, বাংলিশ বা ইংরেজিতে বললেই মুহূর্তের মধ্যে লাইভ অ্যাটেনডেন্স, ৩ দিন লেট লিস্ট, পেরোল শিট, ওভারটাইম, কর্মচারীর ৩৬০° প্রোফাইল এবং অফিশিয়াল HR চিঠি তৈরি করে দেবে।
            </p>
          </div>

          {/* Month & Branch Selectors */}
          <div className="flex flex-wrap items-center gap-2 shrink-0 bg-white/10 p-2.5 rounded-2xl border border-white/15">
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
            <span>AI Report Chatbot (চ্যাট ও লাইভ রিপোর্ট)</span>
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
            <span>AI HR Letter &amp; Notice Generator (চিঠি ও নোটিশ মেকার)</span>
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
            <span>Smart Auto-Audit &amp; 1-Click Actions (অটো অডিট)</span>
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
                    label: 'আজকের প্রেজেন্ট, লেট ও অ্যাবসেন্ট রিপোর্ট',
                    prompt: 'আজকের প্রেজেন্ট, লেট ও অ্যাবসেন্ট রিপোর্ট দাও',
                  },
                  {
                    icon: '🚨',
                    label: '৩+ দিন লেট ও বেতন কর্তন (Warning) লিস্ট',
                    prompt: 'এই মাসে কারা কারা ৩ দিন বা তার বেশি লেট করেছে তাদের লিস্ট দাও',
                  },
                  {
                    icon: '💰',
                    label: 'এই মাসের ফুল স্যালারি ও পেরোল মাস্টার শিট',
                    prompt: 'এই মাসের ফুল স্যালারি ও ওভারটাইম পেরোল রিপোর্ট দাও',
                  },
                  {
                    icon: '🏆',
                    label: 'সেরা নিয়মানুবর্তী (Top Performer) র‍্যাঙ্কিং',
                    prompt: 'সেরা নিয়মানুবর্তী ও টপ পারফর্মার কর্মচারীদের তালিকা দাও',
                  },
                  {
                    icon: '⏱️',
                    label: 'ওভারটাইম ও উইকেন্ড ডিউটি রিপোর্ট',
                    prompt: 'এই মাসের ওভারটাইম এবং উইকেন্ড ডিউটি ভাতা রিপোর্ট দাও',
                  },
                  {
                    icon: '🏖️',
                    label: 'ছুটির আবেদন (Word/PDF) ও ওয়েভার অডিট',
                    prompt: 'সকল ছুটির আবেদন ও পেন্ডিং লিভ রিপোর্ট দাও',
                  },
                  {
                    icon: '🏢',
                    label: 'ব্রাঞ্চ ও ডিপার্টমেন্ট ভিত্তিক খরচ ও জনবল',
                    prompt: 'ব্রাঞ্চ ও ডিপার্টমেন্ট অনুযায়ী কর্মচারীদের রিপোর্ট দাও',
                  },
                  {
                    icon: '⚠️',
                    label: 'চেক-আউট মিসিং ও অনুপস্থিতি অডিট',
                    prompt: 'যাদের চেক-আউট মিসিং এবং অ্যাবসেন্ট আছে তাদের অডিট রিপোর্ট দাও',
                  },
                  {
                    icon: '📊',
                    label: 'কোম্পানির ৩৬০° এক্সিকিউটিভ এইচআর সামারি',
                    prompt: 'কোম্পানির সম্পূর্ণ ৩৬০ ডিগ্রি এক্সিকিউটিভ সামারি রিপোর্ট দাও',
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
                যেকোনো কর্মচারীর উপর ক্লিক করলে তার সম্পূর্ণ মাসের উপস্থিতি, লেট, ওভারটাইম ও স্যালারি রিপোর্ট তৈরি হবে:
              </p>
              <div className="space-y-1">
                {filteredEmployees.map(emp => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => handleSendQuery(`${emp.name} (${emp.employeeId}) এর ফুল রিপোর্ট দাও`)}
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
                    WorkNest AI Report Bot ({formatMonthLabel(selectedMonth)})
                  </h3>
                  <p className="text-[11px] text-emerald-600 font-semibold">
                    ● Connected to Live Database ({filteredEmployees.length} Staff) — Full Page Live Mode
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
                    <span>ভয়েস অফ করুন (Stop Voice)</span>
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
                  title="Voice Command (Speak in Bangla or English)"
                >
                  🎙️
                </button>
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="এখানে লিখুন (যেমন: আজকের প্রেজেন্ট, ৩ দিন লেট লিস্ট, স্যালারি রিপোর্ট, অথবা কর্মচারীর নাম)..."
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
                              <span>{speakingMsgId === msg.id ? 'ভয়েস অফ করুন (Stop)' : 'শুনুন'}</span>
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
                              🚨 ১-ক্লিকে ৩+ দিন লেট করা সকল কর্মচারীর Employee Panel-এ অফিশিয়াল ওয়ার্নিং মেসেজ পাঠাতে চান?
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
                              🏆 ১-ক্লিকে ০ লেট থাকা সেরা কর্মচারীদের প্যানেলে অভিনন্দন মেসেজ পাঠাতে চান?
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
                                    {row.map((cell, cIdx) => (
                                      <td
                                        key={cIdx}
                                        className={`px-3 py-2.5 whitespace-nowrap ${
                                          cIdx === 0 ? 'font-mono font-bold text-indigo-700' : 'text-slate-700'
                                        }`}
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
                বিষয় / SUBJECT: {generatedOfficialLetter.subject}
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
              এই কর্মচারীদের Employee Panel Dashboard-এ ইতিমধ্যে অফিশিয়াল ওয়ার্নিং লেটার হাইলাইট হয়েছে। আপনি ১ ক্লিকে তাদের সবাইকে এইচআর চ্যাট ও নোটিফিকেশনে সতর্কবার্তা পাঠাতে পারেন।
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1.5 thin-scroll">
              {employeeAnalytics.filter(a => a.totalLate >= 3).length === 0 ? (
                <p className="text-xs text-emerald-700 font-semibold py-4">
                  ✅ আলহামদুলিল্লাহ! এই মাসে কোনো কর্মচারীর ৩ দিন বা তার বেশি লেট হয়নি।
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
              যারা এই মাসে একদিনও আন-এক্সকিউজড লেট করেননি, তাদের উৎসাহিত করতে ১ ক্লিকে অফিশিয়াল প্রশংসাপত্র মেসেজ পাঠান।
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
              মোট {leaveRequests.filter(l => Boolean(l.attachmentDataUrl)).length}টি ছুটির আবেদনে Word/PDF দরখাস্ত সংযুক্ত করা হয়েছে।
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
              কর্মচারীদের জমা দেওয়া লেট ওয়েভার আবেদন যাচাই করে অনুমোদন করলে ৩ দিন লেটের বেতন কর্তন মওকুফ হবে।
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
                  বিষয় / SUBJECT: {generatedOfficialLetter.subject}
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
