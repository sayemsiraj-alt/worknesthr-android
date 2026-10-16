import { useState, useEffect, useMemo } from 'react';
import { Page } from '../App';
import { useData } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { useSettings } from '../context/SettingsContext';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firestoreService';
import { ZKTecoPunchTriggerModal } from './ZKTecoPunchTriggerModal';
import {
  offsetDateStr,
  getBangladeshTodayStr,
  normalizeTimeStr,
  resolveEmployeeScheduleForDate,
  isEveningOrOvernight
} from '../utils/attendanceScheduleEngine';
import {
  IconUsers,
  IconCheckCircle,
  IconLeave,
  IconWallet,
  IconBuilding,
  IconUserPlus,
  IconShift,
  IconRoster,
  IconFingerprint,
  IconMessages,
  IconActivity,
  IconChevronRight,
  IconX,
  IconAttendance,
  IconTrending,
} from './Icons';

type Props = { onNavigate: (p: Page) => void };

type HiddenPanelsState = {
  cloudBar: boolean;
  welcomeCard: boolean;
  branchHub: boolean;
  quickHub: boolean;
};

const HIDDEN_PANELS_STORAGE_KEY = 'hr_dashboard_hidden_panels_v1';

export function Dashboard({ onNavigate }: Props) {
  const {
    employees, allEmployees, departments, leaveRequests, roster, shifts,
    branches, activeBranch, setActiveBranch, allDevices, getEmployeeBranch, getDeviceBranch
  } = useData();
  const { currentCompanyId } = useTenant();
  const { t } = useSettings();
  const activeTenant = currentCompanyId || 'default';
  const [isPunchModalOpen, setIsPunchModalOpen] = useState(false);
  const [firestoreTodayAttendance, setFirestoreTodayAttendance] = useState<any[]>([]);
  const [firestoreWeeklyAttendance, setFirestoreWeeklyAttendance] = useState<any[]>([]);
  const [weeklyFilter, setWeeklyFilter] = useState<'last7days' | 'this_week' | 'last_week'>('last7days');
  const [_firestorePunchesCount, setFirestorePunchesCount] = useState<number>(0);
  const [todayStr, setTodayStr] = useState<string>(() => getBangladeshTodayStr());

  // Donut chart state
  const [donutMode, setDonutMode] = useState<'attendance' | 'department' | 'branch'>('attendance');
  const [activeDonutIndex, setActiveDonutIndex] = useState<number | null>(null);

  // Persisted Hide/Show state for top banners & panels
  const [hiddenPanels, setHiddenPanels] = useState<HiddenPanelsState>(() => {
    try {
      const saved = localStorage.getItem(HIDDEN_PANELS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          cloudBar: Boolean(parsed.cloudBar),
          welcomeCard: Boolean(parsed.welcomeCard),
          branchHub: Boolean(parsed.branchHub),
          quickHub: Boolean(parsed.quickHub),
        };
      }
    } catch {
      // ignore storage errors
    }
    return {
      cloudBar: false,
      welcomeCard: false,
      branchHub: false,
      quickHub: false,
    };
  });

  const updatePanelVisibility = (key: keyof HiddenPanelsState, hide: boolean) => {
    setHiddenPanels(prev => {
      const next = { ...prev, [key]: hide };
      try {
        localStorage.setItem(HIDDEN_PANELS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const toggleAllTopBanners = (hide: boolean) => {
    setHiddenPanels(prev => {
      const next = {
        ...prev,
        cloudBar: hide,
        welcomeCard: hide,
        branchHub: hide,
      };
      try {
        localStorage.setItem(HIDDEN_PANELS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Automatically roll over todayStr at 12:00 AM midnight (Asia/Dhaka) without requiring page reload
  useEffect(() => {
    const checkMidnightRollover = () => {
      const current = getBangladeshTodayStr();
      setTodayStr(prev => (prev !== current ? current : prev));
    };
    checkMidnightRollover();
    const timer = setInterval(checkMidnightRollover, 15000);
    return () => clearInterval(timer);
  }, []);

  // Reset active donut slice when switching mode
  useEffect(() => {
    setActiveDonutIndex(null);
  }, [donutMode, activeBranch]);

  // Real-time bounded Firestore stream for Dashboard (covers today + past/current week)
  useEffect(() => {
    try {
      // 1. Live punches subscription for today
      const qPunches = activeTenant !== 'default'
        ? query(collection(db, 'punches'), where('companyId', '==', activeTenant), limit(200))
        : query(collection(db, 'punches'), where('date', '==', todayStr), limit(200));

      const unsubPunches = onSnapshot(qPunches, (snap) => {
        let count = 0;
        snap.forEach(d => {
          const data = d.data();
          const docComp = data.companyId || 'default';
          const matchComp = activeTenant !== 'default' ? docComp === activeTenant : (docComp === 'default');
          if (matchComp && (data.date === todayStr || data.punchTimestamp?.startsWith(todayStr))) {
            count++;
          }
        });
        setFirestorePunchesCount(count);
      }, (err) => {
        console.warn('Dashboard punches query fallback:', err);
      });

      // 2. Live attendance subscription covering running range
      const startDate = offsetDateStr(todayStr, -21);
      const endDate = offsetDateStr(todayStr, 7);
      const qAtt = activeTenant !== 'default'
        ? query(collection(db, 'attendance'), where('companyId', '==', activeTenant))
        : query(
            collection(db, 'attendance'),
            where('date', '>=', startDate),
            where('date', '<=', endDate)
          );

      const unsubAtt = onSnapshot(qAtt, (snap) => {
        const allDocs: any[] = [];
        const todayDocs: any[] = [];
        snap.forEach(d => {
          const data: any = { id: d.id, ...(d.data() as any) };
          const docComp = data.companyId || 'default';
          const matchComp = activeTenant !== 'default' ? docComp === activeTenant : (docComp === 'default');
          if (matchComp) {
            allDocs.push(data);
            if (data.date === todayStr || (!data.date && data.id?.endsWith(`_${todayStr}`))) {
              todayDocs.push(data);
            }
          }
        });
        setFirestoreWeeklyAttendance(allDocs);
        setFirestoreTodayAttendance(todayDocs);
      }, (err) => {
        console.warn('Dashboard attendance query fallback:', err);
      });

      return () => {
        unsubAtt();
        unsubPunches();
      };
    } catch (e) {
      console.warn('Dashboard firestore err:', e);
    }
  }, [todayStr, activeTenant]);

  const totalEmployees = employees.length;
  const activeEmployees = employees.filter(e => e.status === 'active').length;
  const pendingLeaves = leaveRequests.filter(l => l.status === 'pending').length;
  const onLeave = leaveRequests.filter(l => l.status === 'approved' && l.from <= todayStr && l.to >= todayStr).length;

  // Helper to verify if an employee has a genuine punch for a given targetDateStr
  const hasGenuinePunchForDate = (emp: any, targetDateStr: string, sourceList: any[]) => {
    const eId = String(emp.employeeId || '').toLowerCase().trim();
    const eMainId = String(emp.id || '').toLowerCase().trim();
    const eNum = eId.replace(/\D/g, '');

    const matchEmp = (a: any) => {
      const aEmpId = String(a.employeeId || '').toLowerCase().trim();
      const aEmpCode = String(a.employeeCode || '').toLowerCase().trim();
      const aNum = aEmpId.replace(/\D/g, '');
      return aEmpId === eId || aEmpId === eMainId || aEmpCode === eId || (eNum && aNum && eNum === aNum && eNum.length >= 2);
    };

    const att = sourceList.find(a => {
      const aDate = a.date || (a.id && a.id.slice(-10));
      return aDate === targetDateStr && matchEmp(a);
    });
    if (!att) return false;

    if (att.source === 'admin_edit') {
      const adminHasPunch = (att.firstPunchIn && att.firstPunchIn !== '-') ||
                            (att.checkIn && att.checkIn !== '-') ||
                            (att.lastPunchOut && att.lastPunchOut !== '-') ||
                            (att.checkOut && att.checkOut !== '-');
      return Boolean(adminHasPunch || att.status === 'present' || att.status === 'late');
    }

    let mIn = att.firstPunchIn || att.checkIn || att.firstPunch || '-';
    let mOut = (att.checkOut && att.checkOut !== '-' && att.checkOut !== mIn)
      ? att.checkOut
      : ((att.lastPunchOut && att.lastPunchOut !== '-' && att.lastPunchOut !== mIn) ? att.lastPunchOut : '-');

    const prevDateStr = offsetDateStr(targetDateStr, -1);
    const yesterdayAtt = firestoreWeeklyAttendance.find(a => {
      const aDate = a.date || (a.id && a.id.slice(-10));
      return aDate === prevDateStr && matchEmp(a);
    });
    const yesterdaySchedule = resolveEmployeeScheduleForDate(emp, prevDateStr, roster, shifts);
    const yesterdayHadWork = Boolean(
      yesterdayAtt && (
        (yesterdayAtt.firstPunchIn && yesterdayAtt.firstPunchIn !== '-') ||
        (yesterdayAtt.checkIn && yesterdayAtt.checkIn !== '-')
      )
    );
    const yesterdayWasOvernightOrFlex = yesterdaySchedule.isOvernight ||
      isEveningOrOvernight(yesterdaySchedule) ||
      yesterdaySchedule.shift?.type === 'flexible' ||
      yesterdaySchedule.shiftName.toLowerCase().includes('flexible');

    const isEarlyYesterdayCheckout = (tStr: string) => {
      if (!tStr || tStr === '-') return false;
      const norm = normalizeTimeStr(tStr);
      const [h, m] = norm.split(':').map(Number);
      const mins = (h || 0) * 60 + (m || 0);
      if (mins >= 6 * 60 + 30) return false;
      return yesterdayHadWork || yesterdayWasOvernightOrFlex;
    };

    if (mIn !== '-' && isEarlyYesterdayCheckout(mIn)) {
      if (mOut !== '-' && mOut !== mIn && !isEarlyYesterdayCheckout(mOut)) {
        mIn = mOut;
        mOut = '-';
      } else {
        mIn = '-';
        mOut = '-';
      }
    }

    return mIn !== '-' || mOut !== '-';
  };

  // Verified Present Employees Today
  const verifiedPresentEmployees = useMemo(() => {
    return employees.filter(emp => {
      if (emp.status && emp.status !== 'active') return false;
      return hasGenuinePunchForDate(emp, todayStr, firestoreTodayAttendance);
    });
  }, [employees, todayStr, firestoreTodayAttendance, firestoreWeeklyAttendance, roster, shifts]);

  const totalMachinePunchesToday = verifiedPresentEmployees.length;
  const realPresentCount = verifiedPresentEmployees.length;
  const attendanceRate = totalEmployees > 0 ? Math.round((realPresentCount / totalEmployees) * 100) : 0;

  // Detailed Today Attendance Breakdown for Donut Chart (mutually exclusive buckets summing to totalEmployees)
  const todayAttendanceBreakdown = useMemo(() => {
    const presentIds = new Set(verifiedPresentEmployees.map(e => e.id));
    let leaveCount = 0;
    let weeklyOffCount = 0;
    let absentOrPendingCount = 0;

    employees.forEach(emp => {
      if (presentIds.has(emp.id)) return;

      const empCode = String(emp.employeeId || '').toLowerCase().trim();
      const empId = String(emp.id || '').toLowerCase().trim();
      const empName = String(emp.name || '').toLowerCase().trim();

      const hasApprovedLeaveToday = leaveRequests.some(l => {
        if (l.status !== 'approved') return false;
        if (!(l.from <= todayStr && l.to >= todayStr)) return false;
        const lEmpId = String(l.employeeId || '').toLowerCase().trim();
        const lEmpName = String(l.employeeName || '').toLowerCase().trim();
        return lEmpId === empCode || lEmpId === empId || (empName && lEmpName === empName);
      });

      if (hasApprovedLeaveToday || emp.status === 'on_leave') {
        leaveCount++;
        return;
      }

      const sched = resolveEmployeeScheduleForDate(emp, todayStr, roster, shifts);
      if (sched.isOff || sched.isWeekend) {
        weeklyOffCount++;
        return;
      }

      absentOrPendingCount++;
    });

    return [
      { id: 'present', label: 'Present Today', bangla: 'উপস্থিত', count: realPresentCount, color: '#10B981', bg: 'bg-emerald-500', text: 'text-emerald-700', lightBg: 'bg-emerald-50', page: 'attendance' as Page },
      { id: 'absent', label: 'Absent / Pending', bangla: 'অনুপস্থিত', count: absentOrPendingCount, color: '#F43F5E', bg: 'bg-rose-500', text: 'text-rose-700', lightBg: 'bg-rose-50', page: 'attendance' as Page },
      { id: 'offday', label: 'Weekly Off', bangla: 'সাপ্তাহিক ছুটি', count: weeklyOffCount, color: '#8B5CF6', bg: 'bg-violet-500', text: 'text-violet-700', lightBg: 'bg-violet-50', page: 'roster' as Page },
      { id: 'leave', label: 'On Leave', bangla: 'ছুটিতে', count: leaveCount, color: '#F59E0B', bg: 'bg-amber-500', text: 'text-amber-700', lightBg: 'bg-amber-50', page: 'leave' as Page },
    ];
  }, [employees, verifiedPresentEmployees, realPresentCount, leaveRequests, todayStr, roster, shifts]);

  // Department Breakdown for both Donut Chart & Department List
  const departmentBreakdown = useMemo(() => {
    const palette = [
      { hex: '#6366F1', bg: 'bg-indigo-500', text: 'text-indigo-700', lightBg: 'bg-indigo-50' },
      { hex: '#10B981', bg: 'bg-emerald-500', text: 'text-emerald-700', lightBg: 'bg-emerald-50' },
      { hex: '#EC4899', bg: 'bg-pink-500', text: 'text-pink-700', lightBg: 'bg-pink-50' },
      { hex: '#F59E0B', bg: 'bg-amber-500', text: 'text-amber-700', lightBg: 'bg-amber-50' },
      { hex: '#8B5CF6', bg: 'bg-violet-500', text: 'text-violet-700', lightBg: 'bg-violet-50' },
      { hex: '#06B6D4', bg: 'bg-cyan-500', text: 'text-cyan-700', lightBg: 'bg-cyan-50' },
      { hex: '#3B82F6', bg: 'bg-blue-500', text: 'text-blue-700', lightBg: 'bg-blue-50' },
    ];
    const matchedEmpIds = new Set<string>();

    const rows = departments.map((dept) => {
      const dName = (dept.name || '').trim().toLowerCase();
      const dCode = (dept.code || '').trim().toLowerCase();
      const prefix = dName.slice(0, 8);

      const matched = employees.filter((e) => {
        if (matchedEmpIds.has(e.id)) return false;
        const eDept = (e.department || '').trim().toLowerCase();
        if (!eDept) return false;
        const isMatch =
          eDept === dName ||
          (dCode && eDept === dCode) ||
          (prefix.length >= 5 && eDept.startsWith(prefix));
        if (isMatch) {
          matchedEmpIds.add(e.id);
          return true;
        }
        return false;
      });

      return {
        id: dept.id || dept.name,
        label: dept.name,
        count: matched.length,
      };
    });

    const unmappedMap = new Map<string, number>();
    employees.forEach((e) => {
      if (!matchedEmpIds.has(e.id)) {
        const label = (e.department || 'General').trim() || 'General';
        unmappedMap.set(label, (unmappedMap.get(label) || 0) + 1);
      }
    });
    unmappedMap.forEach((count, label) => {
      rows.push({ id: `extra_${label}`, label, count });
    });

    return rows.map((r, i) => {
      const c = palette[i % palette.length];
      return {
        id: r.id,
        label: r.label,
        bangla: 'Department',
        count: r.count,
        color: c.hex,
        bg: c.bg,
        text: c.text,
        lightBg: c.lightBg,
        page: 'department' as Page,
      };
    });
  }, [departments, employees]);

  // Branch Office Breakdown for Donut Chart
  const branchBreakdown = useMemo(() => {
    const palette = [
      { hex: '#4F46E5', bg: 'bg-indigo-600', text: 'text-indigo-700', lightBg: 'bg-indigo-50' },
      { hex: '#059669', bg: 'bg-emerald-600', text: 'text-emerald-700', lightBg: 'bg-emerald-50' },
      { hex: '#D97706', bg: 'bg-amber-600', text: 'text-amber-700', lightBg: 'bg-amber-50' },
      { hex: '#7C3AED', bg: 'bg-violet-600', text: 'text-violet-700', lightBg: 'bg-violet-50' },
      { hex: '#DB2777', bg: 'bg-pink-600', text: 'text-pink-700', lightBg: 'bg-pink-50' },
      { hex: '#0891B2', bg: 'bg-cyan-600', text: 'text-cyan-700', lightBg: 'bg-cyan-50' },
    ];
    return branches.map((b, idx) => {
      const c = palette[idx % palette.length];
      const count = allEmployees.filter(e => getEmployeeBranch(e) === b.name).length;
      return {
        id: b.id,
        label: b.name,
        bangla: b.isHeadOffice ? 'Head Office' : (b.city || 'Branch Office'),
        count,
        color: c.hex,
        bg: c.bg,
        text: c.text,
        lightBg: c.lightBg,
        page: 'branches' as Page,
      };
    });
  }, [branches, allEmployees, getEmployeeBranch]);

  // Active Donut Dataset based on selected tab
  const activeDonutData = useMemo(() => {
    if (donutMode === 'department') return departmentBreakdown;
    if (donutMode === 'branch') return branchBreakdown;
    return todayAttendanceBreakdown;
  }, [donutMode, todayAttendanceBreakdown, departmentBreakdown, branchBreakdown]);

  const donutTotal = useMemo(() => {
    return activeDonutData.reduce((sum, item) => sum + item.count, 0);
  }, [activeDonutData]);

  // Dynamically sum the Gross Salary of every registered staff member
  const totalMonthlyPayroll = useMemo(() => {
    return employees.reduce((sum, emp) => {
      const explicitGross = Number(emp.grossSalary);
      if (!isNaN(explicitGross) && explicitGross > 0) {
        return sum + explicitGross;
      }
      const compSum =
        (Number(emp.basicSalary ?? emp.basic) || 0) +
        (Number(emp.houseRent) || 0) +
        (Number(emp.medical) || 0) +
        (Number(emp.transport ?? emp.conveyance) || 0) +
        (Number(emp.food) || 0);
      if (compSum > 0) {
        return sum + compSum;
      }
      const basicOnly = Number(emp.basicSalary ?? emp.basic) || 0;
      return sum + (basicOnly > 0 ? basicOnly * 2 : 0);
    }, 0);
  }, [employees]);

  const stats = [
    {
      label: 'Total Staff',
      value: totalEmployees.toLocaleString(),
      sub: `${activeEmployees} active in workspace`,
      change: activeBranch === 'All' ? 'All Offices' : 'Branch Staff',
      positive: true,
      progress: totalEmployees > 0 ? Math.min(100, Math.round((activeEmployees / totalEmployees) * 100)) : 100,
      accentBorder: 'hover:border-indigo-300',
      iconBg: 'bg-indigo-600 text-white shadow-indigo-500/20',
      barColor: 'bg-indigo-600',
      Icon: IconUsers,
      page: 'employee' as Page
    },
    {
      label: 'Present Today',
      value: realPresentCount.toLocaleString(),
      sub: `${attendanceRate}% verified (${todayStr})`,
      change: `${attendanceRate}% Rate`,
      positive: true,
      progress: attendanceRate,
      accentBorder: 'hover:border-emerald-300',
      iconBg: 'bg-emerald-600 text-white shadow-emerald-500/20',
      barColor: 'bg-emerald-600',
      Icon: IconCheckCircle,
      page: 'attendance' as Page
    },
    {
      label: 'On Leave',
      value: onLeave.toLocaleString(),
      sub: `${pendingLeaves} pending approval${pendingLeaves === 1 ? '' : 's'}`,
      change: pendingLeaves > 0 ? `${pendingLeaves} Pending` : 'Clear',
      positive: pendingLeaves === 0,
      progress: totalEmployees > 0 ? Math.min(100, Math.round((onLeave / totalEmployees) * 100)) : 0,
      accentBorder: 'hover:border-amber-300',
      iconBg: 'bg-amber-500 text-white shadow-amber-500/20',
      barColor: 'bg-amber-500',
      Icon: IconLeave,
      page: 'leave' as Page
    },
    {
      label: 'Monthly Payroll',
      value: `৳ ${totalMonthlyPayroll.toLocaleString()}`,
      sub: `Gross total (${totalEmployees} staff)`,
      change: 'Gross Salary',
      positive: true,
      progress: totalEmployees > 0 ? 100 : 0,
      accentBorder: 'hover:border-rose-300',
      iconBg: 'bg-rose-600 text-white shadow-rose-500/20',
      barColor: 'bg-rose-600',
      Icon: IconWallet,
      page: 'payroll' as Page
    },
  ];

  const getVerifiedPresentCountForDate = (dateStr: string) => {
    return employees.filter(emp => {
      if (emp.status && emp.status !== 'active') return false;
      return hasGenuinePunchForDate(emp, dateStr, firestoreWeeklyAttendance);
    }).length;
  };

  const trendDays = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number);
    const todayObj = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = (todayObj.getUTCDay() + 6) % 7; // 0=Mon .. 6=Sun

    const list: Array<{
      dateStr: string;
      dayName: string;
      count: number;
      isToday: boolean;
      isFuture: boolean;
    }> = [];

    if (weeklyFilter === 'last7days') {
      for (let i = 6; i >= 0; i--) {
        const dateStr = offsetDateStr(todayStr, -i);
        const dtObj = new Date(dateStr + 'T00:00:00Z');
        const dayName = dtObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
        const isToday = dateStr === todayStr;
        const count = isToday ? realPresentCount : getVerifiedPresentCountForDate(dateStr);
        list.push({ dateStr, dayName, count, isToday, isFuture: false });
      }
    } else if (weeklyFilter === 'this_week') {
      for (let i = 0; i < 7; i++) {
        const dateStr = offsetDateStr(todayStr, i - dayOfWeek);
        const dtObj = new Date(dateStr + 'T00:00:00Z');
        const dayName = dtObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
        const isToday = dateStr === todayStr;
        const isFuture = dateStr > todayStr;
        const count = isFuture ? 0 : (isToday ? realPresentCount : getVerifiedPresentCountForDate(dateStr));
        list.push({ dateStr, dayName, count, isToday, isFuture });
      }
    } else {
      for (let i = 0; i < 7; i++) {
        const dateStr = offsetDateStr(todayStr, i - dayOfWeek - 7);
        const dtObj = new Date(dateStr + 'T00:00:00Z');
        const dayName = dtObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
        const count = getVerifiedPresentCountForDate(dateStr);
        list.push({ dateStr, dayName, count, isToday: false, isFuture: false });
      }
    }

    return list;
  }, [todayStr, weeklyFilter, firestoreWeeklyAttendance, realPresentCount, employees]);

  const hiddenTopCount =
    (hiddenPanels.cloudBar ? 1 : 0) +
    (hiddenPanels.welcomeCard ? 1 : 0) +
    (hiddenPanels.branchHub ? 1 : 0) +
    (hiddenPanels.quickHub ? 1 : 0);

  const allTopHidden = hiddenPanels.cloudBar && hiddenPanels.welcomeCard && hiddenPanels.branchHub;

  return (
    <div className="space-y-4 sm:space-y-5 max-w-[1600px] mx-auto animate-fade-in pb-6">
      {/* Executive Top Utility Bar: Date, Live Status, Biometric Trigger & Panel Show/Hide Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 bg-white px-4 py-2.5 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-extrabold text-slate-900 tracking-tight">
              Executive HR Command Center
            </span>
          </div>
          <span className="text-slate-300 hidden sm:inline">•</span>
          <span className="text-[11px] font-semibold text-slate-500">
            {new Date(todayStr + 'T00:00:00Z').toLocaleDateString('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </span>
          <span className="text-slate-300 hidden sm:inline">•</span>
          <span className="text-[11px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-2 py-0.5 rounded-md tabular-nums">
            {totalMachinePunchesToday} Machine Punches Today
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1.5 sm:gap-2 w-full md:w-auto">
          {/* Restore individual hidden panels */}
          {hiddenPanels.cloudBar && (
            <button
              type="button"
              onClick={() => updatePanelVisibility('cloudBar', false)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80 transition-colors cursor-pointer"
              title="Show Cloud Sync Bar"
            >
              + Cloud Bar
            </button>
          )}
          {hiddenPanels.welcomeCard && (
            <button
              type="button"
              onClick={() => updatePanelVisibility('welcomeCard', false)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/80 transition-colors cursor-pointer"
              title="Show Admin Welcome Card"
            >
              + Welcome Banner
            </button>
          )}
          {hiddenPanels.branchHub && (
            <button
              type="button"
              onClick={() => updatePanelVisibility('branchHub', false)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300/80 transition-colors cursor-pointer"
              title="Show Multi-Branch Control Hub"
            >
              + Branch Hub
            </button>
          )}
          {hiddenPanels.quickHub && (
            <button
              type="button"
              onClick={() => updatePanelVisibility('quickHub', false)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200/80 transition-colors cursor-pointer"
              title="Show Quick Module Hub"
            >
              + Quick Hub
            </button>
          )}

          {/* Master Hide/Show Top Banners button */}
          <button
            type="button"
            onClick={() => toggleAllTopBanners(!allTopHidden)}
            className="flex-1 sm:flex-initial justify-center px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/90 transition-colors flex items-center space-x-1 cursor-pointer whitespace-nowrap"
            title={allTopHidden ? 'Show All Top Banners' : 'Hide Top Banners for Compact View'}
          >
            <span>{allTopHidden ? '👁️ Show Banners' : '🙈 Hide Top Banners'}</span>
            {hiddenTopCount > 0 && !allTopHidden && (
              <span className="ml-1 px-1.5 py-0.2 bg-slate-200 text-slate-800 rounded text-[10px] tabular-nums">
                {hiddenTopCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsPunchModalOpen(true)}
            className="flex-1 sm:flex-initial justify-center px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer whitespace-nowrap"
          >
            <IconFingerprint size={14} />
            <span>Biometric Machine</span>
          </button>
        </div>
      </div>

      {/* Compact Slim Cloud Status Strip (Hideable) */}
      {!hiddenPanels.cloudBar && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-emerald-50/90 via-teal-50/70 to-indigo-50/80 border border-emerald-200/80 rounded-xl gap-2">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <IconFingerprint size={15} />
            </div>
            <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-bold text-slate-900">
                Firestore Cloud: <span className="text-emerald-700 font-mono">LIVE CONNECTED</span>
              </span>
              <span className="text-slate-400 hidden md:inline">•</span>
              <span className="text-[11px] text-slate-600 truncate">
                Auto-syncing device punches in <code className="bg-white/90 px-1 py-0.2 rounded font-mono text-emerald-800">/punches</code> &amp; <code className="bg-white/90 px-1 py-0.2 rounded font-mono text-emerald-800">/attendance</code>
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsPunchModalOpen(true)}
              className="px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
            >
              Test Punch
            </button>
            <button
              type="button"
              onClick={() => updatePanelVisibility('cloudBar', true)}
              className="px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-white/80 rounded-lg transition-colors flex items-center space-x-1 cursor-pointer"
              title="Hide Cloud Sync Bar"
            >
              <IconX size={12} />
              <span>Hide</span>
            </button>
          </div>
        </div>
      )}

      {/* Compact Desktop 2-Column Top Cards: Welcome Banner & Multi-Branch Hub (Each Hideable & Sleek) */}
      {(!hiddenPanels.welcomeCard || !hiddenPanels.branchHub) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
          {/* Card 1: Sleek Compact Welcome Admin Card */}
          {!hiddenPanels.welcomeCard && (
            <div
              className={`${
                !hiddenPanels.branchHub ? 'lg:col-span-5' : 'lg:col-span-12'
              } relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 p-4 text-white shadow-sm border border-indigo-500/30 flex flex-col justify-between`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="inline-flex items-center space-x-1.5 text-[10px] uppercase tracking-wider font-bold text-indigo-100 bg-white/10 px-2 py-0.5 rounded-md">
                    <span>⚡ Real-Time HR &amp; Payroll</span>
                  </span>
                  <h1 className="text-lg sm:text-xl font-black mt-1.5 tracking-tight">
                    স্বাগতম, Admin! 👋
                  </h1>
                  <p className="text-[11px] sm:text-xs text-indigo-100/90 mt-0.5 leading-relaxed">
                    আপনার পুরো HR Team এবং ZKTeco Biometric Machine এখন Google Firestore-এর সাথে সিঙ্কড।
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => updatePanelVisibility('welcomeCard', true)}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/90 text-[11px] font-bold flex items-center space-x-1 transition-colors shrink-0 cursor-pointer"
                  title="Hide Welcome Card"
                >
                  <IconX size={12} />
                  <span>Hide</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3 pt-2.5 border-t border-white/15">
                <button
                  type="button"
                  onClick={() => onNavigate('employee')}
                  className="px-3 py-1.5 bg-white/15 hover:bg-white/25 border border-white/20 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <IconUsers size={14} />
                  <span>Employees ({totalEmployees})</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('attendance')}
                  className="px-3 py-1.5 bg-white text-indigo-700 hover:bg-indigo-50 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-2xs cursor-pointer"
                >
                  <IconCheckCircle size={14} />
                  <span>Live Attendance ({realPresentCount} Present)</span>
                </button>
              </div>
            </div>
          )}

          {/* Card 2: Sleek Compact Multi-Branch Office & Biometric Control Hub */}
          {!hiddenPanels.branchHub && (
            <div
              className={`${
                !hiddenPanels.welcomeCard ? 'lg:col-span-7' : 'lg:col-span-12'
              } bg-slate-900 rounded-2xl p-4 text-white shadow-sm border border-slate-800 flex flex-col justify-between`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                      Multi-Branch Hub
                    </span>
                    <span className="text-[11px] text-slate-300 font-semibold tabular-nums">
                      • {branches.length} {branches.length === 1 ? 'Office' : 'Offices'} • {allDevices.length} {allDevices.length === 1 ? 'Machine' : 'Machines'}
                    </span>
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-white tracking-tight mt-1 truncate">
                    {activeBranch === 'All'
                      ? '🏢 Viewing All Offices (Main HQ & All Branches)'
                      : `📍 Active Workspace: ${activeBranch}`}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    ঢাকার মেইন হেড অফিস এবং সকল ব্রাঞ্চ অফিসের হাজিরা ও এইচআর একসাথে নিয়ন্ত্রণ করুন।
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigate('branches')}
                    className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[11px] font-bold transition-colors flex items-center space-x-1 cursor-pointer whitespace-nowrap"
                  >
                    <IconBuilding size={13} />
                    <span>Branches ({branches.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('zkteco')}
                    className="px-2.5 py-1.5 bg-white/10 hover:bg-white/15 border border-white/10 text-white rounded-lg text-[11px] font-semibold transition-colors flex items-center space-x-1 cursor-pointer whitespace-nowrap"
                  >
                    <IconFingerprint size={13} />
                    <span>Machines ({allDevices.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePanelVisibility('branchHub', true)}
                    className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white text-[11px] font-bold flex items-center space-x-1 transition-colors cursor-pointer"
                    title="Hide Multi-Branch Hub"
                  >
                    <IconX size={12} />
                    <span>Hide</span>
                  </button>
                </div>
              </div>

              {/* Compact Quick Branch Switcher Bar */}
              <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1">
                  Office:
                </span>
                <button
                  type="button"
                  onClick={() => setActiveBranch('All')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                    activeBranch === 'All'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  }`}
                >
                  All Offices ({allEmployees.length})
                </button>
                {branches.map((b) => {
                  const empCount = allEmployees.filter((e) => getEmployeeBranch(e) === b.name).length;
                  const devCount = allDevices.filter((d) => getDeviceBranch(d) === b.name).length;
                  const isSelected = activeBranch === b.name;
                  return (
                    <button
                      type="button"
                      key={b.id}
                      onClick={() => setActiveBranch(b.name)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors flex items-center space-x-1 cursor-pointer tabular-nums ${
                        isSelected
                          ? 'bg-emerald-400 text-slate-950 shadow-2xs'
                          : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      }`}
                    >
                      <span>{b.isHeadOffice ? '🏢' : '📍'}</span>
                      <span>{b.name}</span>
                      <span className={`text-[10px] px-1 py-0.2 rounded ${isSelected ? 'bg-slate-950/15 text-slate-950' : 'bg-white/10 text-slate-300'}`}>
                        {empCount}👤 {devCount}📟
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Executive KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((s, i) => (
          <button
            type="button"
            key={i}
            onClick={() => onNavigate(s.page)}
            className={`group p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-md ${s.accentBorder} transition-all text-left cursor-pointer flex flex-col justify-between`}
          >
            <div>
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl ${s.iconBg} flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform shrink-0`}>
                  <s.Icon size={18} />
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider tabular-nums ${
                  s.positive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-amber-50 text-amber-700 border border-amber-200/60'
                }`}>
                  {s.change}
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 leading-none font-mono tabular-nums">
                {s.value}
              </div>
              <div className="text-xs sm:text-sm font-bold text-slate-700 mt-1.5 truncate">
                {t(s.label)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate tabular-nums">
                {s.sub}
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-100">
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${s.barColor} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.max(4, s.progress)}%` }}
                />
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 3-Column Executive Analytics Grid: Weekly Trend + Interactive Live Donut Chart + Departments */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        {/* 1. Weekly Attendance Trend (5 cols on Desktop) */}
        <div className="lg:col-span-5 p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2.5">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center space-x-2">
                  <span>📈</span>
                  <span>{t('Weekly Attendance Trend')}</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Real-time Firestore-verified check-ins across shifts
                </p>
              </div>
              <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl text-[11px] font-bold self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setWeeklyFilter('last7days')}
                  className={`px-2 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    weeklyFilter === 'last7days' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  7 Days
                </button>
                <button
                  type="button"
                  onClick={() => setWeeklyFilter('this_week')}
                  className={`px-2 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    weeklyFilter === 'this_week' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  This Week
                </button>
                <button
                  type="button"
                  onClick={() => setWeeklyFilter('last_week')}
                  className={`px-2 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    weeklyFilter === 'last_week' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Last Week
                </button>
              </div>
            </div>

            {/* Summary KPI mini strip inside Weekly Trend */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/60">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Today Present</div>
                <div className="text-sm font-black text-indigo-700 font-mono tabular-nums mt-0.5">
                  {realPresentCount} / {totalEmployees}
                </div>
              </div>
              <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/60">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Period Peak</div>
                <div className="text-sm font-black text-emerald-700 font-mono tabular-nums mt-0.5">
                  {Math.max(...trendDays.map(d => d.count), 0)} Staff
                </div>
              </div>
              <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/60">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Attendance Rate</div>
                <div className="text-sm font-black text-slate-900 font-mono tabular-nums mt-0.5">
                  {attendanceRate}%
                </div>
              </div>
            </div>

            <div className="overflow-x-auto -mx-1 px-1 thin-scroll">
              <div className="min-w-[380px] relative mt-1">
                <div className="h-40 w-full">
                  <svg className="w-full h-full overflow-visible" viewBox="0 0 700 170" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#6366F1" stopOpacity="0.32" />
                        <stop offset="100%" stopColor="#6366F1" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    {(() => {
                      const maxCount = Math.max(...trendDays.map(d => d.count), 1);
                      const max = Math.max(maxCount + 2, 10);
                      const padX = 35;
                      const innerWidth = 700 - padX * 2;
                      const xStep = innerWidth / Math.max(trendDays.length - 1, 1);
                      const bottomY = 145;
                      const points = trendDays.map((d, i) => ({
                        x: padX + i * xStep,
                        y: d.count === 0 ? bottomY : bottomY - (d.count / max) * 115,
                        count: d.count,
                        isFuture: d.isFuture,
                        isToday: d.isToday,
                        day: d
                      }));

                      const pathStr = `M ${points[0].x},${bottomY + 15} L ${points[0].x},${points[0].y} ` +
                        points.slice(1).map((p, idx) => {
                          const prev = points[idx];
                          const cx = prev.x + (p.x - prev.x) / 2;
                          return `C ${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
                        }).join(' ') +
                        ` L ${points[points.length - 1].x},${bottomY + 15} Z`;

                      const strokePath = `M ${points[0].x},${points[0].y} ` +
                        points.slice(1).map((p, idx) => {
                          const prev = points[idx];
                          const cx = prev.x + (p.x - prev.x) / 2;
                          return `C ${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
                        }).join(' ');

                      return (
                        <>
                          <path d={pathStr} fill="url(#lineGrad)" />
                          <path d={strokePath} fill="none" stroke="#6366F1" strokeWidth="3" strokeLinecap="round" />
                          {points.map((p, i) => (
                            <g key={i}>
                              {p.isToday && (
                                <circle cx={p.x} cy={p.y} r="10" fill="#6366F1" fillOpacity="0.25" className="animate-ping" />
                              )}
                              <circle
                                cx={p.x}
                                cy={p.y}
                                r={p.isToday ? 6 : 5}
                                fill={p.isFuture ? '#cbd5e1' : '#6366F1'}
                                stroke="#ffffff"
                                strokeWidth={p.isToday ? 3 : 2}
                              />
                              {!p.isFuture && p.count > 0 ? (
                                <text
                                  x={p.x}
                                  y={p.y - 12}
                                  textAnchor="middle"
                                  fill="#3730a3"
                                  fontSize="13"
                                  fontWeight="800"
                                  fontFamily="monospace"
                                >
                                  {p.count}
                                </text>
                              ) : p.isFuture ? (
                                <text
                                  x={p.x}
                                  y={p.y - 10}
                                  textAnchor="middle"
                                  fill="#94a3b8"
                                  fontSize="11"
                                  fontWeight="600"
                                >
                                  —
                                </text>
                              ) : (
                                <text
                                  x={p.x}
                                  y={p.y - 10}
                                  textAnchor="middle"
                                  fill="#64748b"
                                  fontSize="11"
                                  fontWeight="700"
                                >
                                  0
                                </text>
                              )}
                              <title>{`${p.day.dayName} (${p.day.dateStr}): ${p.isFuture ? 'Upcoming' : `${p.count} Staff Present`}`}</title>
                            </g>
                          ))}
                        </>
                      );
                    })()}
                  </svg>
                </div>

                {/* Day Labels & Dates */}
                <div
                  className="flex justify-between mt-2 pt-2 border-t border-slate-100 text-xs"
                  style={{ paddingLeft: '4%', paddingRight: '4%' }}
                >
                  {trendDays.map((d, idx) => (
                    <div key={idx} className="flex flex-col items-center">
                      <span className={d.isToday ? 'text-indigo-700 font-black text-[11px]' : 'text-slate-800 font-bold text-[11px]'}>
                        {d.isToday ? 'Today' : d.dayName}
                      </span>
                      <span className={`text-[10px] font-mono tabular-nums mt-0.5 ${d.isToday ? 'text-indigo-600 font-bold' : 'text-slate-500 font-semibold'}`}>
                        {d.dateStr.slice(5)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Interactive Live Donut Chart Card (4 cols on Desktop) */}
        <div className="lg:col-span-4 p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center space-x-1.5">
                  <span>🍩</span>
                  <span>Live Workforce Analytics</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Interactive distribution • Tap or hover slice
                </p>
              </div>

              {/* Donut Mode Switcher */}
              <div className="flex items-center bg-slate-100 p-1 rounded-xl text-[11px] font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => setDonutMode('attendance')}
                  className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                    donutMode === 'attendance'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Attendance
                </button>
                <button
                  type="button"
                  onClick={() => setDonutMode('department')}
                  className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                    donutMode === 'department'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Dept
                </button>
                <button
                  type="button"
                  onClick={() => setDonutMode('branch')}
                  className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                    donutMode === 'branch'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Branch
                </button>
              </div>
            </div>

            {/* Interactive SVG Donut Chart */}
            <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center justify-center gap-4 my-2">
              <div className="relative w-44 h-44 shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90 overflow-visible">
                  {/* Base Background Track Ring */}
                  <circle
                    cx="100"
                    cy="100"
                    r="72"
                    fill="transparent"
                    stroke="#F1F5F9"
                    strokeWidth="24"
                  />
                  {(() => {
                    const radius = 72;
                    const circumference = 2 * Math.PI * radius;
                    const nonZeroCount = activeDonutData.filter(d => d.count > 0).length;
                    let accumulatedLength = 0;

                    if (donutTotal <= 0) {
                      return (
                        <circle
                          cx="100"
                          cy="100"
                          r={radius}
                          fill="transparent"
                          stroke="#CBD5E1"
                          strokeWidth="24"
                          strokeDasharray={`${circumference} ${circumference}`}
                        />
                      );
                    }

                    return activeDonutData.map((slice, idx) => {
                      if (slice.count <= 0) return null;
                      const fraction = slice.count / donutTotal;
                      const rawArcLength = fraction * circumference;
                      const gap = nonZeroCount > 1 ? 3 : 0;
                      const visibleArcLength = Math.max(2, rawArcLength - gap);
                      const strokeDashoffset = -accumulatedLength;
                      accumulatedLength += rawArcLength;

                      const isHovered = activeDonutIndex === idx;

                      return (
                        <circle
                          key={slice.id || idx}
                          cx="100"
                          cy="100"
                          r={radius}
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth={isHovered ? 30 : 24}
                          strokeDasharray={`${visibleArcLength} ${circumference}`}
                          strokeDashoffset={strokeDashoffset}
                          strokeLinecap="butt"
                          className="transition-all duration-200 cursor-pointer"
                          style={{
                            opacity: activeDonutIndex !== null && !isHovered ? 0.55 : 1,
                          }}
                          onMouseEnter={() => setActiveDonutIndex(idx)}
                          onMouseLeave={() => setActiveDonutIndex(null)}
                          onClick={() => {
                            setActiveDonutIndex(prev => (prev === idx ? null : idx));
                          }}
                        >
                          <title>{`${slice.label}: ${slice.count} Staff (${Math.round(fraction * 100)}%)`}</title>
                        </circle>
                      );
                    });
                  })()}
                </svg>

                {/* Dynamic Center Readout inside Donut */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
                  {activeDonutIndex !== null && activeDonutData[activeDonutIndex] ? (
                    <>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate max-w-[110px]">
                        {activeDonutData[activeDonutIndex].label}
                      </span>
                      <span className="text-2xl font-black text-slate-900 font-mono tabular-nums leading-tight mt-0.5">
                        {activeDonutData[activeDonutIndex].count}
                      </span>
                      <span
                        className="text-[11px] font-extrabold font-mono tabular-nums px-1.5 py-0.2 rounded mt-0.5"
                        style={{ color: activeDonutData[activeDonutIndex].color }}
                      >
                        {donutTotal > 0
                          ? `${Math.round((activeDonutData[activeDonutIndex].count / donutTotal) * 100)}%`
                          : '0%'}
                      </span>
                    </>
                  ) : donutMode === 'attendance' ? (
                    <>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Present Rate
                      </span>
                      <span className="text-2xl font-black text-emerald-600 font-mono tabular-nums leading-tight mt-0.5">
                        {attendanceRate}%
                      </span>
                      <span className="text-[11px] font-bold text-slate-600 font-mono tabular-nums">
                        {realPresentCount}/{totalEmployees} Staff
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {donutMode === 'department' ? 'Total Staff' : 'All Offices'}
                      </span>
                      <span className="text-2xl font-black text-indigo-600 font-mono tabular-nums leading-tight mt-0.5">
                        {donutTotal}
                      </span>
                      <span className="text-[11px] font-bold text-slate-500 font-mono tabular-nums">
                        {activeDonutData.length} {donutMode === 'department' ? 'Depts' : 'Offices'}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Interactive Donut Legend List */}
              <div className="w-full space-y-1.5 max-h-44 overflow-y-auto thin-scroll pr-1">
                {activeDonutData.map((item, idx) => {
                  const pct = donutTotal > 0 ? Math.round((item.count / donutTotal) * 100) : 0;
                  const isActive = activeDonutIndex === idx;
                  return (
                    <button
                      type="button"
                      key={item.id || idx}
                      onMouseEnter={() => setActiveDonutIndex(idx)}
                      onMouseLeave={() => setActiveDonutIndex(null)}
                      onClick={() => onNavigate(item.page)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left transition-all cursor-pointer border ${
                        isActive
                          ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                          : 'bg-slate-50/80 hover:bg-slate-100 text-slate-800 border-slate-200/60'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <div className="min-w-0">
                          <div className={`text-xs font-bold truncate ${isActive ? 'text-white' : 'text-slate-800'}`}>
                            {item.label}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0 font-mono tabular-nums text-xs">
                        <span className={`font-extrabold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                          {item.count}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                          isActive ? 'bg-white/20 text-white' : 'bg-white text-slate-600 border border-slate-200/80'
                        }`}>
                          {pct}%
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Donut Footer Quick Action */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <span className="text-slate-500 font-medium">
              {donutMode === 'attendance'
                ? `Synced for ${todayStr}`
                : donutMode === 'department'
                ? `${departmentBreakdown.length} Active Departments`
                : `${branches.length} Connected Offices`}
            </span>
            <button
              type="button"
              onClick={() =>
                onNavigate(
                  donutMode === 'attendance'
                    ? 'attendance'
                    : donutMode === 'department'
                    ? 'department'
                    : 'branches'
                )
              }
              className="font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-0.5 cursor-pointer"
            >
              <span>Open Details</span>
              <IconChevronRight size={13} />
            </button>
          </div>
        </div>

        {/* 3. Department Distribution Card (3 cols on Desktop) */}
        <div className="lg:col-span-3 p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center space-x-2">
                <IconBuilding size={17} className="text-indigo-600" />
                <span>{t('Departments')}</span>
              </h3>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 tabular-nums">
                {totalEmployees} Staff
              </span>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto thin-scroll pr-1">
              {departmentBreakdown.map((row, i) => {
                const pct = totalEmployees > 0 ? Math.round((row.count / totalEmployees) * 100) : 0;
                return (
                  <div key={row.id || i} className="space-y-1">
                    <div className="flex justify-between text-xs font-bold text-slate-800">
                      <span className="truncate pr-2">{row.label}</span>
                      <span className="text-slate-500 shrink-0 font-mono tabular-nums text-[11px]">
                        {row.count} • {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: row.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <span className="text-slate-500 font-medium">Workforce allocation</span>
            <button
              type="button"
              onClick={() => onNavigate('department')}
              className="font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-0.5 cursor-pointer"
            >
              <span>Manage</span>
              <IconChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Quick Module Hub (Hideable) */}
      {!hiddenPanels.quickHub && (
        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between mb-3.5">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center space-x-2">
              <IconActivity size={17} className="text-indigo-600" />
              <span>{t('Quick Module Hub')}</span>
            </h3>
            <button
              type="button"
              onClick={() => updatePanelVisibility('quickHub', true)}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors flex items-center space-x-1 cursor-pointer"
              title="Hide Quick Module Hub"
            >
              <IconX size={12} />
              <span>Hide</span>
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {[
              { label: 'Attendance', Icon: IconAttendance, page: 'attendance' as Page, color: 'bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/20 border-emerald-200' },
              { label: 'Leave', Icon: IconLeave, page: 'leave' as Page, color: 'bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 border-amber-200' },
              { label: 'Payroll', Icon: IconWallet, page: 'payroll' as Page, color: 'bg-rose-500/10 text-rose-800 hover:bg-rose-500/20 border-rose-200' },
              { label: 'Reports', Icon: IconTrending, page: 'reports' as Page, color: 'bg-blue-500/10 text-blue-800 hover:bg-blue-500/20 border-blue-200' },
              { label: 'Roster', Icon: IconRoster, page: 'roster' as Page, color: 'bg-violet-500/10 text-violet-800 hover:bg-violet-500/20 border-violet-200' },
              { label: 'Add Employee', Icon: IconUserPlus, page: 'employee' as Page, color: 'bg-indigo-50/80 text-indigo-700 hover:bg-indigo-100 border-indigo-200/60' },
              { label: 'Biometric Devices', Icon: IconFingerprint, page: 'zkteco' as Page, color: 'bg-cyan-50/80 text-cyan-700 hover:bg-cyan-100 border-cyan-200/60' },
              { label: 'Shifts', Icon: IconShift, page: 'shift' as Page, color: 'bg-amber-50/80 text-amber-700 hover:bg-amber-100 border-amber-200/60' },
              { label: 'Branch Offices', Icon: IconBuilding, page: 'branches' as Page, color: 'bg-emerald-50/80 text-emerald-700 hover:bg-emerald-100 border-emerald-200/60' },
              { label: 'Departments', Icon: IconBuilding, page: 'department' as Page, color: 'bg-pink-50/80 text-pink-700 hover:bg-pink-100 border-pink-200/60' },
            ].map((a, i) => (
              <button
                type="button"
                key={i}
                onClick={() => onNavigate(a.page)}
                className={`p-3 rounded-xl border ${a.color} transition-all active:scale-95 hover:shadow-2xs flex items-center space-x-2.5 cursor-pointer`}
              >
                <div className="w-8 h-8 rounded-lg bg-white/80 flex items-center justify-center shrink-0 shadow-2xs">
                  <a.Icon size={17} />
                </div>
                <span className="text-xs font-bold text-left leading-tight truncate">{t(a.label)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hardware Punch Trigger Modal */}
      <ZKTecoPunchTriggerModal
        isOpen={isPunchModalOpen}
        onClose={() => setIsPunchModalOpen(false)}
      />
    </div>
  );
}
