import { useState, useEffect, useMemo, useRef } from 'react';
import { useData, LeaveRequest, Message } from '../context/DataContext';
import { useSettings } from '../context/SettingsContext';
import { useTenant } from '../context/TenantContext';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../lib/firestoreService';
import { EmployeeCheckIn } from './EmployeeCheckIn';
import { DocumentManagement } from './DocumentManagement';
import { ExpenseManagement } from './ExpenseManagement';
import { OnboardingManagement } from './OnboardingManagement';
import { EmployeeEngagement } from './EmployeeEngagement';
import { formatTo12Hour } from '../utils/timeFormat';
import { onAndroidBack } from '../utils/androidShell';
import { isNativeAndroid } from '../utils/nativePrint';
import {
  findShiftByNameOrId,
  isShiftOvertimeEnabled,
  resolveEmployeeScheduleForDate,
  resolveEmployeeShiftNameForDate,
  calculateDutyDuration,
  calculateOvertimeHours,
  isEveningOrOvernight,
  getBangladeshTodayStr,
  getEmployeeShiftWorkingHours,
  evaluateAttendanceForSchedule,
} from '../utils/attendanceScheduleEngine';
import {
  IconCheckCircle,
  IconClock,
  IconCalendar,
  IconTrending,
  IconUsers,
  IconWallet,
  IconLeave,
  IconAttendance,
  IconShift,
  IconChevronRight,
  IconSparkles,
  IconAward,
  IconBuilding,
  IconActivity,
  IconFingerprint,
  IconMenu,
  IconLogout,
  IconDashboard,
  IconSettings,
  IconFlame,
  IconCheck,
} from './Icons';

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeDonutArc(x: number, y: number, innerR: number, outerR: number, startAngle: number, endAngle: number) {
  const clampedEnd = endAngle - startAngle >= 359.99 ? startAngle + 359.99 : endAngle;
  const startOuter = polarToCartesian(x, y, outerR, clampedEnd);
  const endOuter = polarToCartesian(x, y, outerR, startAngle);
  const startInner = polarToCartesian(x, y, innerR, startAngle);
  const endInner = polarToCartesian(x, y, innerR, clampedEnd);
  const arcSweep = clampedEnd - startAngle <= 180 ? '0' : '1';

  return [
    'M', startOuter.x, startOuter.y,
    'A', outerR, outerR, 0, arcSweep, 0, endOuter.x, endOuter.y,
    'L', startInner.x, startInner.y,
    'A', innerR, innerR, 0, arcSweep, 1, endInner.x, endInner.y,
    'Z',
  ].join(' ');
}

export function EmployeePanel() {
  const {
    currentEmployee,
    logoutEmployee,
    leaveRequests,
    requestLeave,
    addNotification,
    shifts,
    roster,
    messages,
    sendMessage,
    markMessageRead,
    updateEmployeeCredentials,
    updateEmployee,
    attendanceRequests,
    addAttendanceRequest,
    monthlyPayrollRuns,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    companyHolidays = [],
  } = useData();

  // Tenant / Company Info & Logo
  const { currentCompany } = useTenant();
  const companyLogo =
    currentCompany?.profile?.logo ||
    (typeof window !== 'undefined'
      ? localStorage.getItem('worknest_company_logo') ||
        localStorage.getItem(`worknest_company_logo_${currentCompany?.id || 'default'}`) ||
        (() => {
          try {
            const cs = localStorage.getItem('company_settings');
            return cs ? JSON.parse(cs).logo : null;
          } catch {
            return null;
          }
        })()
      : null);

  const companyName =
    currentCompany?.name ||
    (typeof window !== 'undefined'
      ? (() => {
          try {
            const cs = localStorage.getItem('company_settings');
            return cs ? JSON.parse(cs).companyName : null;
          } catch {
            return null;
          }
        })()
      : null) ||
    'WorkNest HR';

  // Settings Context (Themes, Accents & Display Preferences)
  const { theme, setTheme, accentColor, setAccentColor, language, setLanguage, dateFormat, setDateFormat } = useSettings();
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);

  const triggerSettingsNotice = (title: string, msg: string) => {
    setSettingsNotice(`${title}: ${msg}`);
    setTimeout(() => setSettingsNotice(null), 3500);
  };

  // Active Tab
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'checkin'
    | 'attendance'
    | 'requests'
    | 'leave'
    | 'payslips'
    | 'roster'
    | 'expenses'
    | 'onboarding'
    | 'engagement'
    | 'documents'
    | 'notifications'
    | 'messages'
    | 'profile'
    | 'settings'
  >('overview');

  // Sidebar Navigation & Hub States
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [navCategoryFilter, setNavCategoryFilter] = useState<'all' | 'daily' | 'leave_pay' | 'company' | 'support'>('all');
  const [isAllFeaturesModalOpen, setIsAllFeaturesModalOpen] = useState(false);
  const [featuresSearchQuery, setFeaturesSearchQuery] = useState('');
  const [isMoreFeaturesDropdownOpen, setIsMoreFeaturesDropdownOpen] = useState(false);
  const navTabsRef = useRef<HTMLDivElement | null>(null);

  const scrollNavTabs = (direction: 'left' | 'right') => {
    if (navTabsRef.current) {
      const scrollAmount = direction === 'left' ? -260 : 260;
      navTabsRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleSelectTab = (tabId: any) => {
    setActiveTab(tabId);
    setIsMobileSidebarOpen(false);
    setIsAllFeaturesModalOpen(false);
    setIsMoreFeaturesDropdownOpen(false);
    if (tabId === 'messages') {
      myMessages.forEach(m => {
        if (m.unread && m.toEmployeeId === currentEmployee?.id) {
          markMessageRead(m.id);
        }
      });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Keyboard shortcut listener for Esc key to close sidebar/modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileSidebarOpen(false);
        setIsAllFeaturesModalOpen(false);
        setIsMoreFeaturesDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Remote shift detection:
  // Only employees whose assigned shift or today's roster schedule is Remote can mark attendance / see remote punch options
  const isRemoteEmployee = useMemo(() => {
    if (!currentEmployee) return false;
    // 1. Check assigned shift object in shifts list
    const assignedShift = findShiftByNameOrId(shifts, currentEmployee.shift);
    if (assignedShift?.type === 'remote') return true;
    if (assignedShift?.name && /remote/i.test(assignedShift.name)) return true;

    // 2. Check currentEmployee.shift string directly
    if (currentEmployee.shift && /remote/i.test(currentEmployee.shift)) return true;

    // 3. Check today's schedule from roster
    const todayStr = getBangladeshTodayStr();
    const todaySched = resolveEmployeeScheduleForDate(currentEmployee, todayStr, roster, shifts);
    if (todaySched?.shift?.type === 'remote') return true;
    if (todaySched?.shift?.name && /remote/i.test(todaySched.shift.name)) return true;
    if (todaySched?.shiftName && /remote/i.test(todaySched.shiftName)) return true;

    return false;
  }, [currentEmployee, shifts, roster]);

  // If a fixed-shift employee attempts to open checkin tab, gracefully redirect to overview
  useEffect(() => {
    if (!isRemoteEmployee && activeTab === 'checkin') {
      setActiveTab('overview');
    }
  }, [isRemoteEmployee, activeTab]);

  // Android system Back button: close the employee drawer / feature modal first,
  // then return to the overview tab. Returning false lets the shell exit the app.
  useEffect(() => {
    if (!isNativeAndroid()) return;
    return onAndroidBack(() => {
      if (isAllFeaturesModalOpen) {
        setIsAllFeaturesModalOpen(false);
        return true;
      }
      if (isMobileSidebarOpen) {
        setIsMobileSidebarOpen(false);
        return true;
      }
      if (isMoreFeaturesDropdownOpen) {
        setIsMoreFeaturesDropdownOpen(false);
        return true;
      }
      if (activeTab !== 'overview') {
        handleSelectTab('overview');
        return true;
      }
      return false;
    });
  }, [activeTab, isAllFeaturesModalOpen, isMobileSidebarOpen, isMoreFeaturesDropdownOpen]);

  // Real-time Firestore Attendance records for this employee
  const [firestoreAttendance, setFirestoreAttendance] = useState<any[]>([]);

  // Attendance Regularization (Late Waiver / Early Checkout / Missing Punch / Overtime) form
  const [attRequestForm, setAttRequestForm] = useState({
    type: 'late_arrival' as 'late_arrival' | 'early_checkout' | 'missing_punch' | 'overtime',
    date: new Date().toISOString().split('T')[0],
    actualTime: '09:30',
    checkOutTime: '18:00',
    otHours: 2,
    reason: '',
  });
  const [attRequestSuccessMsg, setAttRequestSuccessMsg] = useState('');
  const [isSubmittingAttRequest, setIsSubmittingAttRequest] = useState(false);
  const [attAttachment, setAttAttachment] = useState<{
    name: string;
    type: string;
    size: number;
    dataUrl: string;
  } | null>(null);
  const [attAttachmentError, setAttAttachmentError] = useState('');
  const attFileInputRef = useRef<HTMLInputElement | null>(null);

  // Leave Form
  const [leaveForm, setLeaveForm] = useState({
    type: 'Casual',
    from: new Date().toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0],
    isHalfDay: false,
    reason: '',
    emergencyContact: '',
  });
  const [leaveSuccessMsg, setLeaveSuccessMsg] = useState('');
  const [leaveAttachment, setLeaveAttachment] = useState<{
    name: string;
    type: string;
    size: number;
    dataUrl: string;
  } | null>(null);
  const [leaveAttachmentError, setLeaveAttachmentError] = useState('');
  const [previewLeaveAttachment, setPreviewLeaveAttachment] = useState<LeaveRequest | null>(null);
  const leaveFileInputRef = useRef<HTMLInputElement | null>(null);

  // Official 3-Days Late Warning Letter Modal & Acknowledgment State
  const [showWarningLetterModal, setShowWarningLetterModal] = useState(false);
  const [warningAcknowledgedMap, setWarningAcknowledgedMap] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('worknest_late_warning_ack');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Messaging state (Chat with HR)
  const [employeeMessageText, setEmployeeMessageText] = useState('');
  const [employeeMessageSubject, setEmployeeMessageSubject] = useState('General Query');
  const [isComposingNewChat, setIsComposingNewChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Profile Edit / Avatar / Password Change state
  const [profileForm, setProfileForm] = useState({
    email: currentEmployee?.email || '',
    phone: currentEmployee?.phone || '',
    address: currentEmployee?.address || '',
    emergencyContact: currentEmployee?.emergencyContact || '',
    newPassword: '',
    confirmPassword: '',
  });
  const [avatarPreview, setAvatarPreview] = useState<string>(currentEmployee?.avatar || '');
  const [avatarFitMode, setAvatarFitMode] = useState<'cover' | 'contain'>('cover');
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (currentEmployee?.avatar) {
      setAvatarPreview(currentEmployee.avatar);
    }
  }, [currentEmployee?.avatar]);

  const [profileSuccessMsg, setProfileSuccessMsg] = useState('');
  const [profileErrorMsg, setProfileErrorMsg] = useState('');

  // Selected month for attendance & payslip
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = getBangladeshTodayStr();
    return today.slice(0, 7);
  });
  const [userManuallyChangedSalaryMonth, setUserManuallyChangedSalaryMonth] = useState(false);

  // Real-time cloud payroll records synced from Admin Panel
  const [cloudPayrollRecords, setCloudPayrollRecords] = useState<Record<string, any>>(() => {
    try {
      const saved = localStorage.getItem('worknest_payroll_monthly_records');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (!currentEmployee) return;
    const empComp = currentEmployee.companyId || 'default';
    try {
      const unsub = onSnapshot(doc(db, 'settings', `payroll_records_${empComp}`), (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data?.records && typeof data.records === 'object') {
            setCloudPayrollRecords(prev => {
              const merged = { ...prev, ...data.records };
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
  }, [currentEmployee]);

  // Current Shift info
  const assignedShift = useMemo(() => {
    if (!currentEmployee?.shift) return null;
    return shifts.find(
      s => s.name.toLowerCase() === currentEmployee.shift.toLowerCase() || s.id === currentEmployee.shift
    );
  }, [currentEmployee, shifts]);

  // Real-time subscription to Attendance in Firestore
  useEffect(() => {
    if (!currentEmployee) return;
    try {
      const empIds = [currentEmployee.id, currentEmployee.employeeId].filter(Boolean);
      const empComp = currentEmployee.companyId || 'default';
      const q = empComp !== 'default'
        ? query(
            collection(db, 'attendance'),
            where('companyId', '==', empComp),
            where('employeeId', 'in', empIds.slice(0, 10))
          )
        : query(
            collection(db, 'attendance'),
            where('employeeId', 'in', empIds.slice(0, 10))
          );
      const unsub = onSnapshot(q, (snap) => {
        const docs: any[] = [];
        snap.forEach(d => {
          const data = d.data();
          const docComp = data.companyId || 'default';
          const matches = empComp !== 'default' ? docComp === empComp : (!data.companyId || docComp === 'default');
          if (matches) {
            docs.push({ id: d.id, ...data });
          }
        });
        setFirestoreAttendance(docs);
      }, (err) => {
        console.warn('Firestore employee attendance sync error:', err);
      });
      return () => unsub();
    } catch (e) {
      console.warn('Firestore query error:', e);
    }
  }, [currentEmployee]);

  // Combine local records with Firestore attendance
  const allAttendanceRecords = useMemo(() => {
    if (!currentEmployee) return [];
    const localKey = `attendance_${currentEmployee.id}`;
    let localRecs: any[] = [];
    try {
      const saved = localStorage.getItem(localKey);
      if (saved) localRecs = JSON.parse(saved);
    } catch {}

    const map = new Map<string, any>();
    // Add local records first
    localRecs.forEach(r => {
      if (r.date) map.set(r.date, { ...r, checkIn: r.checkIn || '-', checkOut: r.checkOut || '-' });
    });
    // Add / overwrite with Firestore cloud records
    firestoreAttendance.forEach(r => {
      if (r.date) {
        const existing = map.get(r.date) || {};
        const checkIn = r.firstPunchIn || r.checkIn || existing.checkIn || '-';
        let checkOut = '-';
        if (r.checkOut && r.checkOut !== '-' && r.checkOut !== checkIn) {
          checkOut = r.checkOut;
        } else if (r.lastPunchOut && r.lastPunchOut !== '-' && r.lastPunchOut !== checkIn) {
          checkOut = r.lastPunchOut;
        } else if (existing.checkOut && existing.checkOut !== '-' && existing.checkOut !== checkIn) {
          checkOut = existing.checkOut;
        }
        if (checkOut === checkIn || r.totalPunches === 1) {
          checkOut = '-';
        }
        const sched = currentEmployee ? resolveEmployeeScheduleForDate(currentEmployee, r.date, roster, shifts, r.shiftName) : null;
        const dateShiftName = currentEmployee ? resolveEmployeeShiftNameForDate(currentEmployee, r.date, r.shiftName) : (r.shiftName || '');
        const isOvernight = Boolean(r.isOvernight || sched?.isOvernight || (sched && isEveningOrOvernight(sched)));
        const duty = calculateDutyDuration(checkIn, checkOut, isOvernight, sched?.breakTime ?? 0);
        const rawHours = r.totalHours !== undefined && r.totalHours !== null ? Number(r.totalHours) : (r.workHours !== undefined ? Number(r.workHours) : null);
        const totalHours = checkIn !== '-' && checkOut !== '-'
          ? (duty.durationHours > 0 ? duty.durationHours : (rawHours !== null && rawHours > 0 ? rawHours : 0))
          : (rawHours !== null && rawHours > 0 ? rawHours : 0);

        const evalRes = evaluateAttendanceForSchedule(checkIn, checkOut, sched, r, dateShiftName);
        const status = evalRes.status;

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
          ? calculateOvertimeHours(checkIn, checkOut, { ...sched, shift: effShift || sched?.shift, overtimePolicyEnabled: isOtAllowed, isOvernight })
          : 0;
        const otHours = !isOtAllowed
          ? 0
          : (r.source === 'admin_edit' && r.otHours !== undefined ? Number(r.otHours) : calcOt);

        map.set(r.date, {
          ...existing,
          ...r,
          checkIn,
          checkOut,
          status,
          otHours,
          totalHours,
          workHours: totalHours,
          workDurationMinutes: duty.durationMinutes,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [currentEmployee, firestoreAttendance, roster, shifts]);

  // Filtered attendance for selected month
  const monthlyAttendanceRecords = useMemo(() => {
    return allAttendanceRecords.filter(r => r.date.startsWith(selectedMonth));
  }, [allAttendanceRecords, selectedMonth]);

  // Monthly stats
  const monthlyStats = useMemo(() => {
    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;
    let otTotal = 0;

    monthlyAttendanceRecords.forEach(r => {
      if (r.status === 'present') presentCount++;
      else if (r.status === 'late') {
        presentCount++;
        lateCount++;
      } else if (r.status === 'absent') absentCount++;
      if (r.otHours) otTotal += Number(r.otHours) || 0;
    });

    return { presentCount, lateCount, absentCount, otTotal };
  }, [monthlyAttendanceRecords]);

  // Leave records for this employee
  const myLeaves = useMemo(() => {
    if (!currentEmployee) return [];
    return leaveRequests.filter(
      l => l.employeeId === currentEmployee.id || l.employeeId === currentEmployee.employeeId
    );
  }, [leaveRequests, currentEmployee]);

  // Real-time Leave Policy configuration from Settings
  const [leavePolicy, setLeavePolicy] = useState(() => {
    try {
      const saved = localStorage.getItem('worknest_settings_leave');
      if (saved) {
        const p = JSON.parse(saved);
        return {
          annualDays: p.annualDays !== undefined && p.annualDays !== '' ? Number(p.annualDays) : 14,
          casualDays: p.casualDays !== undefined && p.casualDays !== '' ? Number(p.casualDays) : 10,
          sickDays: p.sickDays !== undefined && p.sickDays !== '' ? Number(p.sickDays) : 14,
          maternityDays: p.maternityDays !== undefined && p.maternityDays !== '' ? Number(p.maternityDays) : 112,
          paternityDays: p.paternityDays !== undefined && p.paternityDays !== '' ? Number(p.paternityDays) : 10,
          allowUnpaid: p.allowUnpaid ?? true,
        };
      }
    } catch {}
    return {
      annualDays: 14,
      casualDays: 10,
      sickDays: 14,
      maternityDays: 112,
      paternityDays: 10,
      allowUnpaid: true,
    };
  });

  // Listen to Firestore real-time settings and local updates
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'worknest_settings_leave' && e.newValue) {
        try {
          const p = JSON.parse(e.newValue);
          setLeavePolicy({
            annualDays: p.annualDays !== undefined && p.annualDays !== '' ? Number(p.annualDays) : 0,
            casualDays: p.casualDays !== undefined && p.casualDays !== '' ? Number(p.casualDays) : 0,
            sickDays: p.sickDays !== undefined && p.sickDays !== '' ? Number(p.sickDays) : 0,
            maternityDays: p.maternityDays !== undefined && p.maternityDays !== '' ? Number(p.maternityDays) : 0,
            paternityDays: p.paternityDays !== undefined && p.paternityDays !== '' ? Number(p.paternityDays) : 0,
            allowUnpaid: p.allowUnpaid ?? true,
          });
        } catch {}
      }
    };

    const handleCustom = (e: any) => {
      if (e.detail) {
        const p = e.detail;
        setLeavePolicy({
          annualDays: p.annualDays !== undefined && p.annualDays !== '' ? Number(p.annualDays) : 0,
          casualDays: p.casualDays !== undefined && p.casualDays !== '' ? Number(p.casualDays) : 0,
          sickDays: p.sickDays !== undefined && p.sickDays !== '' ? Number(p.sickDays) : 0,
          maternityDays: p.maternityDays !== undefined && p.maternityDays !== '' ? Number(p.maternityDays) : 0,
          paternityDays: p.paternityDays !== undefined && p.paternityDays !== '' ? Number(p.paternityDays) : 0,
          allowUnpaid: p.allowUnpaid ?? true,
        });
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('worknest_settings_leave_updated', handleCustom);

    try {
      const unsub = onSnapshot(doc(db, 'settings', 'leave'), (snap) => {
        if (snap.exists()) {
          const p = snap.data();
          setLeavePolicy({
            annualDays: p.annualDays !== undefined && p.annualDays !== '' ? Number(p.annualDays) : 0,
            casualDays: p.casualDays !== undefined && p.casualDays !== '' ? Number(p.casualDays) : 0,
            sickDays: p.sickDays !== undefined && p.sickDays !== '' ? Number(p.sickDays) : 0,
            maternityDays: p.maternityDays !== undefined && p.maternityDays !== '' ? Number(p.maternityDays) : 0,
            paternityDays: p.paternityDays !== undefined && p.paternityDays !== '' ? Number(p.paternityDays) : 0,
            allowUnpaid: p.allowUnpaid ?? true,
          });
          localStorage.setItem('worknest_settings_leave', JSON.stringify(p));
        }
      }, (err) => console.warn('Leave settings listen err:', err));

      return () => {
        window.removeEventListener('storage', handleStorage);
        window.removeEventListener('worknest_settings_leave_updated', handleCustom);
        unsub();
      };
    } catch {
      return () => {
        window.removeEventListener('storage', handleStorage);
        window.removeEventListener('worknest_settings_leave_updated', handleCustom);
      };
    }
  }, []);

  // Leave Balances calculation driven directly by Leave Policy
  const leaveBalances = useMemo(() => {
    const casualUsed = myLeaves.filter(l => l.type === 'Casual' && l.status === 'approved').reduce((s, l) => s + (l.days || 1), 0);
    const sickUsed = myLeaves.filter(l => l.type === 'Sick' && l.status === 'approved').reduce((s, l) => s + (l.days || 1), 0);
    const annualUsed = myLeaves.filter(l => l.type === 'Annual' && l.status === 'approved').reduce((s, l) => s + (l.days || 1), 0);

    const casualTotal = typeof leavePolicy.casualDays === 'number' ? leavePolicy.casualDays : 0;
    const sickTotal = typeof leavePolicy.sickDays === 'number' ? leavePolicy.sickDays : 0;
    const annualTotal = typeof leavePolicy.annualDays === 'number' ? leavePolicy.annualDays : 0;

    return {
      casual: { total: casualTotal, used: casualUsed, remaining: Math.max(0, casualTotal - casualUsed) },
      sick: { total: sickTotal, used: sickUsed, remaining: Math.max(0, sickTotal - sickUsed) },
      annual: { total: annualTotal, used: annualUsed, remaining: Math.max(0, annualTotal - annualUsed) },
    };
  }, [myLeaves, leavePolicy]);

  // Duty roster for this employee
  const myRoster = useMemo(() => {
    if (!currentEmployee) return [];
    return roster.filter(
      r => r.employeeId === currentEmployee.id || r.employeeId === currentEmployee.employeeId
    );
  }, [roster, currentEmployee]);

  // Messages between this Employee and HR/Admin
  const myMessages = useMemo(() => {
    if (!currentEmployee) return [];
    return messages.filter(m => {
      // Sent to this employee specifically
      if (m.toEmployeeId === currentEmployee.id || m.toEmployeeId === currentEmployee.employeeId) return true;
      if (m.to?.toLowerCase() === currentEmployee.name.toLowerCase()) return true;
      // Announcements for all employees
      if (m.to === 'All Employees' || m.to === 'General') return true;
      // Sent by this employee
      if (m.fromEmployeeId === currentEmployee.id || m.fromEmployeeId === currentEmployee.employeeId) return true;
      if (m.from?.toLowerCase() === currentEmployee.name.toLowerCase()) return true;
      return false;
    }).sort((a, b) => (a.createdAt || a.id).localeCompare(b.createdAt || b.id));
  }, [messages, currentEmployee]);

  // Unread messages count for badge
  const unreadMessagesCount = useMemo(() => {
    if (!currentEmployee) return 0;
    return myMessages.filter(
      m => m.unread && (m.toEmployeeId === currentEmployee.id || m.to === 'All Employees' || m.to === 'General' || m.to === currentEmployee.name)
    ).length;
  }, [myMessages, currentEmployee]);

  // Scroll to bottom of chat when new messages appear
  useEffect(() => {
    if (activeTab === 'messages' && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [myMessages, activeTab]);

  // Today's attendance record (Asia/Dhaka timezone with automatic 12:00 AM midnight rollover)
  const [todayStr, setTodayStr] = useState<string>(() => getBangladeshTodayStr());
  useEffect(() => {
    const timer = setInterval(() => {
      const cur = getBangladeshTodayStr();
      setTodayStr(prev => (prev !== cur ? cur : prev));
    }, 15000);
    return () => clearInterval(timer);
  }, []);
  const todayRecord = allAttendanceRecords.find(r => r.date === todayStr);

  if (!currentEmployee) return null;

  // Helper to read & optionally compress image or keep Word/PDF as base64 DataURL
  const processApplicationAttachment = (
    file: File,
    onSuccess: (att: { name: string; type: string; size: number; dataUrl: string }) => void,
    onError: (msg: string) => void,
    resetInput: () => void
  ) => {
    const allowedExts = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
    const lowerName = file.name.toLowerCase();
    const hasValidExt = allowedExts.some(ext => lowerName.endsWith(ext));
    if (!hasValidExt) {
      onError('Please upload only PDF (.pdf), Word (.doc, .docx), or Image (.jpg, .png) files.');
      resetInput();
      return;
    }

    const isImg = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png') || file.type.startsWith('image/');
    if (!isImg && file.size > 900 * 1024) {
      onError('Word / PDF file size must be within 900 KB for optimal cloud sync.');
      resetInput();
      return;
    }
    if (isImg && file.size > 5 * 1024 * 1024) {
      onError('Image size must be within 5 MB.');
      resetInput();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      if (isImg && file.size > 400 * 1024) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1000;
          let w = img.width;
          let h = img.height;
          if (w > h && w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else if (h > maxDim) {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const compressed = canvas.toDataURL('image/jpeg', 0.82);
            onSuccess({
              name: file.name,
              type: 'image/jpeg',
              size: Math.round((compressed.length * 3) / 4),
              dataUrl: compressed,
            });
            return;
          }
          onSuccess({
            name: file.name,
            type: file.type || 'image/jpeg',
            size: file.size,
            dataUrl: reader.result as string,
          });
        };
        img.onerror = () => {
          onSuccess({
            name: file.name,
            type: file.type || 'image/jpeg',
            size: file.size,
            dataUrl: reader.result as string,
          });
        };
        img.src = reader.result;
      } else {
        onSuccess({
          name: file.name,
          type:
            file.type ||
            (lowerName.endsWith('.pdf')
              ? 'application/pdf'
              : lowerName.endsWith('.docx')
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : 'application/msword'),
          size: file.size,
          dataUrl: reader.result,
        });
      }
    };
    reader.onerror = () => {
      onError('Failed to read file, please try again.');
    };
    reader.readAsDataURL(file);
  };

  // Handle Leave Application File Selection (PDF / Word .doc .docx / Image)
  const handleLeaveFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLeaveAttachmentError('');
    const file = e.target.files?.[0];
    if (!file) return;
    processApplicationAttachment(
      file,
      att => setLeaveAttachment(att),
      err => setLeaveAttachmentError(err),
      () => {
        if (leaveFileInputRef.current) leaveFileInputRef.current.value = '';
      }
    );
  };

  // Handle Attendance Request Application File Selection (PDF / Word .doc .docx / Image)
  const handleAttFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttAttachmentError('');
    const file = e.target.files?.[0];
    if (!file) return;
    processApplicationAttachment(
      file,
      att => setAttAttachment(att),
      err => setAttAttachmentError(err),
      () => {
        if (attFileInputRef.current) attFileInputRef.current.value = '';
      }
    );
  };

  // Handle Leave Submission
  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fromD = new Date(leaveForm.from);
    const toD = new Date(leaveForm.to);
    let days = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / (1000 * 3600 * 24)) + 1);
    if (leaveForm.isHalfDay) days = 0.5;

    await requestLeave({
      employeeId: currentEmployee.id,
      employeeName: currentEmployee.name,
      department: currentEmployee.department,
      type: leaveForm.type,
      from: leaveForm.from,
      to: leaveForm.to,
      days,
      reason: `${leaveForm.reason}${leaveForm.isHalfDay ? ' (Half-day)' : ''}${leaveForm.emergencyContact ? ` | Emg: ${leaveForm.emergencyContact}` : ''}`,
      status: 'pending',
      ...(leaveAttachment
        ? {
            attachmentName: leaveAttachment.name,
            attachmentType: leaveAttachment.type,
            attachmentSize: leaveAttachment.size,
            attachmentDataUrl: leaveAttachment.dataUrl,
          }
        : {}),
    });

    addNotification({
      title: 'Leave Request Submitted',
      message: `Your leave request for ${days} days (${leaveForm.from} to ${leaveForm.to})${leaveAttachment ? ` with attached file (${leaveAttachment.name})` : ''} is pending admin approval`,
      read: false,
      type: 'leave',
      targetPage: 'leave',
    });

    setLeaveSuccessMsg(
      leaveAttachment
        ? `Your leave request with attachment (${leaveAttachment.name}) has been submitted successfully and is awaiting HR approval.`
        : 'Your leave request has been submitted successfully and is awaiting HR approval.'
    );
    setTimeout(() => setLeaveSuccessMsg(''), 6000);
    setLeaveForm({
      type: 'Casual',
      from: new Date().toISOString().split('T')[0],
      to: new Date().toISOString().split('T')[0],
      isHalfDay: false,
      reason: '',
      emergencyContact: '',
    });
    setLeaveAttachment(null);
    setLeaveAttachmentError('');
    if (leaveFileInputRef.current) leaveFileInputRef.current.value = '';
  };

  // Filter attendance requests submitted by this employee
  const myAttendanceRequests = useMemo(() => {
    if (!currentEmployee) return [];
    return attendanceRequests.filter(r =>
      r.employeeId === currentEmployee.employeeId || r.employeeId === currentEmployee.id
    );
  }, [attendanceRequests, currentEmployee]);

  // Comprehensive metadata for all Employee features (grouped, compact & accessible)
  const ALL_MODULES_LIST = useMemo(() => {
    const list = [
      {
        id: 'overview' as const,
        title: 'Overview',
        shortTitle: 'Overview',
        subtitle: 'Live dashboard & KPI trends',
        icon: '📊',
        category: 'daily' as const,
        categoryLabel: 'Daily & Attendance',
        desc: 'Attendance stats, live clock & KPI charts',
        color: 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100',
        badge: null,
        badgeColor: '',
      },
      {
        id: 'checkin' as const,
        title: 'Camera Punch',
        shortTitle: 'Punch',
        subtitle: 'Biometric selfie & GPS check-in',
        icon: '📷',
        category: 'daily' as const,
        categoryLabel: 'Daily & Attendance',
        desc: 'Selfie biometric check-in & GPS punch',
        color: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100',
        badge: todayRecord?.checkIn && todayRecord.checkIn !== '-' ? 'Checked In' : 'Punch Now',
        badgeColor: todayRecord?.checkIn && todayRecord.checkIn !== '-' ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-800',
      },
      {
        id: 'attendance' as const,
        title: 'Attendance',
        shortTitle: 'Attendance',
        subtitle: 'Punch logs & timesheets',
        icon: '📅',
        category: 'daily' as const,
        categoryLabel: 'Daily & Attendance',
        desc: 'Punch logs, duty hours & OT history',
        color: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100',
        badge: null,
        badgeColor: '',
      },
      {
        id: 'requests' as const,
        title: 'Requests & Waiver',
        shortTitle: 'Requests',
        subtitle: 'Late arrival & checkout waiver',
        icon: '📝',
        category: 'daily' as const,
        categoryLabel: 'Daily & Attendance',
        desc: 'Late arrival waiver, missing punch & checkout',
        color: 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100',
        badge: myAttendanceRequests.filter(r => r.status === 'pending').length > 0 ? `${myAttendanceRequests.filter(r => r.status === 'pending').length} Pending` : null,
        badgeColor: 'bg-amber-400 text-amber-950 font-black',
      },
      {
        id: 'roster' as const,
        title: 'Shift & Roster',
        shortTitle: 'Roster',
        subtitle: 'Shift timing & weekly roster',
        icon: '⏱️',
        category: 'daily' as const,
        categoryLabel: 'Daily & Attendance',
        desc: 'Shift hours, break time, grace period & roster',
        color: 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100',
        badge: assignedShift?.name || currentEmployee?.shift || 'General Shift',
        badgeColor: 'bg-sky-100 text-sky-800 font-semibold',
      },
      {
        id: 'leave' as const,
        title: 'Apply Leave',
        shortTitle: 'Leave',
        subtitle: 'Leave requests & balance',
        icon: '🏖️',
        category: 'leave_pay' as const,
        categoryLabel: 'Leave & Pay',
        desc: 'Apply casual, sick & annual leave',
        color: 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100',
        badge: myLeaves.filter(l => l.status === 'pending').length > 0 ? `${myLeaves.filter(l => l.status === 'pending').length} Pending` : null,
        badgeColor: 'bg-amber-400 text-amber-950 font-black',
      },
      {
        id: 'payslips' as const,
        title: 'Payslips & Salary',
        shortTitle: 'Payslips',
        subtitle: 'Monthly salary breakdown',
        icon: '💰',
        category: 'leave_pay' as const,
        categoryLabel: 'Leave & Pay',
        desc: 'Monthly salary breakdown, slips & earnings',
        color: 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100',
        badge: null,
        badgeColor: '',
      },
      {
        id: 'expenses' as const,
        title: 'Expense Claims',
        shortTitle: 'Expenses',
        subtitle: 'Travel, food & bill claims',
        icon: '🧾',
        category: 'leave_pay' as const,
        categoryLabel: 'Leave & Pay',
        desc: 'Submit official travel, food & conveyance bills',
        color: 'bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100',
        badge: null,
        badgeColor: '',
      },
      {
        id: 'onboarding' as const,
        title: 'Onboarding & Exit',
        shortTitle: 'Onboarding',
        subtitle: 'Joining tasks & handbook',
        icon: '🚀',
        category: 'company' as const,
        categoryLabel: 'Company & Work',
        desc: 'Joining tasks, handbook, asset clearance & exit',
        color: 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100',
        badge: null,
        badgeColor: '',
      },
      {
        id: 'engagement' as const,
        title: 'Engagement & Surveys',
        shortTitle: 'Engagement',
        subtitle: 'Pulse surveys & recognition',
        icon: '🏆',
        category: 'company' as const,
        categoryLabel: 'Company & Work',
        desc: 'Company pulse surveys, kudos & recognition',
        color: 'bg-pink-50 border-pink-200 text-pink-700 hover:bg-pink-100',
        badge: null,
        badgeColor: '',
      },
      {
        id: 'documents' as const,
        title: 'Documents & Policies',
        shortTitle: 'Documents',
        subtitle: 'HR policies & certificates',
        icon: '📂',
        category: 'company' as const,
        categoryLabel: 'Company & Work',
        desc: 'HR handbook, holiday calendar, forms & letters',
        color: 'bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100',
        badge: null,
        badgeColor: '',
      },
      {
        id: 'notifications' as const,
        title: 'Notifications',
        shortTitle: 'Notices',
        subtitle: 'Notices & announcements',
        icon: '🔔',
        category: 'support' as const,
        categoryLabel: 'Account & Settings',
        desc: 'Company announcements & instant status updates',
        color: 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100',
        badge: notifications.filter(n => !n.read && (!n.forEmployeeId || n.forEmployeeId === currentEmployee?.id || n.forEmployeeId === currentEmployee?.employeeId)).length > 0
          ? `${notifications.filter(n => !n.read && (!n.forEmployeeId || n.forEmployeeId === currentEmployee?.id || n.forEmployeeId === currentEmployee?.employeeId)).length}`
          : null,
        badgeColor: 'bg-rose-500 text-white font-black',
      },
      {
        id: 'messages' as const,
        title: 'Chat with HR',
        shortTitle: 'HR Chat',
        subtitle: 'Direct message HR admin',
        icon: '💬',
        category: 'support' as const,
        categoryLabel: 'Account & Settings',
        desc: 'Direct live chat with HR administration',
        color: 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100',
        badge: unreadMessagesCount > 0 ? `${unreadMessagesCount} Unread` : null,
        badgeColor: 'bg-rose-500 text-white font-black animate-pulse',
      },
      {
        id: 'profile' as const,
        title: 'My Profile',
        shortTitle: 'Profile',
        subtitle: 'Personal details & security',
        icon: '👤',
        category: 'support' as const,
        categoryLabel: 'Account & Settings',
        desc: 'Personal info, emergency contacts & password',
        color: 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200',
        badge: null,
        badgeColor: '',
      },
      {
        id: 'settings' as const,
        title: 'Settings & Theme',
        shortTitle: 'Settings',
        subtitle: 'Theme modes, accents & formatting',
        icon: '⚙️',
        category: 'support' as const,
        categoryLabel: 'Account & Settings',
        desc: 'Personalize themes, accent colors & display options',
        color: 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100',
        badge: null,
        badgeColor: '',
      },
    ];

    // Mark attendance / Camera Punch is strictly reserved for Remote shift staff
    // Fixed shift employees mark attendance using physical biometric devices
    if (!isRemoteEmployee) {
      return list.filter(m => m.id !== 'checkin');
    }
    return list;
  }, [isRemoteEmployee, todayRecord, myAttendanceRequests, myLeaves, assignedShift, currentEmployee, notifications, unreadMessagesCount]);

  // Current active module metadata for topbar breadcrumb and titles
  const currentActiveModule = useMemo(() => {
    return ALL_MODULES_LIST.find(m => m.id === activeTab) || ALL_MODULES_LIST[0];
  }, [ALL_MODULES_LIST, activeTab]);

  // Submit Late Arrival Waiver or Early Checkout Request
  const handleAttendanceRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEmployee) return;
    if (!attRequestForm.reason.trim()) {
      alert('Please provide a valid explanation or reason for your request.');
      return;
    }

    setIsSubmittingAttRequest(true);
    try {
      await addAttendanceRequest({
        employeeId: currentEmployee.employeeId,
        employeeName: currentEmployee.name,
        department: currentEmployee.department,
        date: attRequestForm.date,
        type: attRequestForm.type,
        actualTime: attRequestForm.actualTime,
        checkInTime: attRequestForm.actualTime,
        checkOutTime: attRequestForm.checkOutTime,
        otHours: attRequestForm.type === 'overtime' ? Number(attRequestForm.otHours) || 1 : undefined,
        reason: attRequestForm.reason.trim(),
        status: 'pending',
        appliedOn: new Date().toISOString(),
        ...(attAttachment
          ? {
              attachmentName: attAttachment.name,
              attachmentType: attAttachment.type,
              attachmentSize: attAttachment.size,
              attachmentDataUrl: attAttachment.dataUrl,
            }
          : {}),
      });

      setAttRequestSuccessMsg(
        attRequestForm.type === 'late_arrival'
          ? `Late attendance waiver request${attAttachment ? ` with attached file (${attAttachment.name})` : ''} submitted! If approved by Admin/Manager, the 3-day late salary deduction penalty will be waived.`
          : attRequestForm.type === 'missing_punch'
          ? `Missing punch regularization request${attAttachment ? ` with attached file (${attAttachment.name})` : ''} submitted for approval!`
          : attRequestForm.type === 'overtime'
          ? `Overtime request${attAttachment ? ` with attached file (${attAttachment.name})` : ''} submitted for approval!`
          : `Early checkout request${attAttachment ? ` with attached file (${attAttachment.name})` : ''} submitted successfully!`
      );
      setAttRequestForm({
        type: 'late_arrival',
        date: new Date().toISOString().split('T')[0],
        actualTime: '09:30',
        checkOutTime: '18:00',
        otHours: 2,
        reason: '',
      });
      setAttAttachment(null);
      setAttAttachmentError('');
      if (attFileInputRef.current) attFileInputRef.current.value = '';
      setTimeout(() => setAttRequestSuccessMsg(''), 6000);
    } catch (err: any) {
      alert('Error submitting request: ' + (err?.message || 'Failed'));
    } finally {
      setIsSubmittingAttRequest(false);
    }
  };

  // Handle Send Message to HR
  const handleSendMessageToHR = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeMessageText.trim()) return;

    await sendMessage({
      from: currentEmployee.name,
      fromAvatar: currentEmployee.avatar || '👤',
      fromEmployeeId: currentEmployee.id,
      to: 'HR Admin',
      toEmployeeId: 'admin',
      subject: employeeMessageSubject || 'Support Query',
      content: employeeMessageText.trim(),
      unread: true,
    });

    setEmployeeMessageText('');
    setIsComposingNewChat(false);
  };

  // Handle Avatar Selection and Canvas Center-Crop Optimization
  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setProfileErrorMsg('Selected image size exceeds 8MB. Please choose a smaller image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const targetDim = 480;
        canvas.width = targetDim;
        canvas.height = targetDim;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetDim, targetDim);

          // Center crop to preserve full facial framing without squashing
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetDim, targetDim);

          const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
          setAvatarPreview(optimizedDataUrl);
          setProfileSuccessMsg('Photo loaded! Click "Save Photo Now" or save below to apply.');
          setTimeout(() => setProfileSuccessMsg(''), 4000);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAvatarOnly = async () => {
    if (!currentEmployee) return;
    setIsSavingAvatar(true);
    setProfileErrorMsg('');
    try {
      if (updateEmployee) {
        await updateEmployee(currentEmployee.id, { avatar: avatarPreview });
      }
      await updateEmployeeCredentials(currentEmployee.id, { avatar: avatarPreview } as any);
      setProfileSuccessMsg('Profile picture updated successfully across your entire portal!');
      setTimeout(() => setProfileSuccessMsg(''), 4000);
    } catch (err: any) {
      setProfileErrorMsg(err?.message || 'Failed to update profile picture.');
    } finally {
      setIsSavingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!currentEmployee) return;
    setAvatarPreview('');
    setIsSavingAvatar(true);
    try {
      if (updateEmployee) {
        await updateEmployee(currentEmployee.id, { avatar: '' });
      }
      await updateEmployeeCredentials(currentEmployee.id, { avatar: '' } as any);
      setProfileSuccessMsg('Profile picture removed.');
      setTimeout(() => setProfileSuccessMsg(''), 4000);
    } catch (err: any) {
      setProfileErrorMsg('Failed to remove photo.');
    } finally {
      setIsSavingAvatar(false);
    }
  };

  // Handle Profile / Password / Photo Change
  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccessMsg('');
    setProfileErrorMsg('');

    if (profileForm.newPassword) {
      if (profileForm.newPassword.length < 6) {
        setProfileErrorMsg('Password must be at least 6 characters long.');
        return;
      }
      if (profileForm.newPassword !== profileForm.confirmPassword) {
        setProfileErrorMsg('New password and confirm password do not match.');
        return;
      }
    }

    const updates: any = {
      email: profileForm.email.trim(),
      phone: profileForm.phone.trim(),
      address: profileForm.address.trim(),
      emergencyContact: profileForm.emergencyContact.trim(),
    };
    if (avatarPreview !== undefined) {
      updates.avatar = avatarPreview;
    }
    if (profileForm.newPassword) {
      updates.password = profileForm.newPassword;
    }

    if (updateEmployee) {
      await updateEmployee(currentEmployee.id, { ...updates });
    }
    await updateEmployeeCredentials(currentEmployee.id, updates);
    setProfileSuccessMsg('Profile information and picture updated successfully!');
    setProfileForm(p => ({ ...p, newPassword: '', confirmPassword: '' }));
    setTimeout(() => setProfileSuccessMsg(''), 5000);
  };

  // =========================================================================
  // MONTHLY SALARY GENERATION RULE (STRICTLY ON 1ST OF NEXT MONTH)
  // Example: Employee works all through October (2026-10) -> Salary generates
  // and becomes viewable ONLY on or after 1st November (2026-11-01).
  // =========================================================================
  const currentRunningMonth = useMemo(() => todayStr.slice(0, 7), [todayStr]);

  const prevCompletedMonth = useMemo(() => {
    const [cy, cm] = currentRunningMonth.split('-').map(Number);
    const prevD = new Date(cy, cm - 2, 1);
    return `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
  }, [currentRunningMonth]);

  // Check if employee has attendance or payroll activity in the previous completed month
  const hasPrevCompletedMonthActivity = useMemo(() => {
    if (!currentEmployee) return false;
    const hasAtt = allAttendanceRecords.some(r => r.date && String(r.date).startsWith(prevCompletedMonth));
    const hasRec = Boolean(
      cloudPayrollRecords[`${prevCompletedMonth}_${currentEmployee.id}`] ||
      cloudPayrollRecords[`${prevCompletedMonth}_${currentEmployee.employeeId}`] ||
      monthlyPayrollRuns[prevCompletedMonth]
    );
    return hasAtt || hasRec;
  }, [allAttendanceRecords, prevCompletedMonth, cloudPayrollRecords, currentEmployee, monthlyPayrollRuns]);

  // When switching to Payslips tab, if user hasn't manually chosen a month yet and
  // they have a completed previous month's salary ready (e.g., on Nov 1st after working in Oct),
  // automatically select that completed month so they can view their generated salary immediately.
  useEffect(() => {
    if (activeTab === 'payslips' && !userManuallyChangedSalaryMonth && hasPrevCompletedMonthActivity) {
      setSelectedMonth(prevCompletedMonth);
    }
  }, [activeTab, userManuallyChangedSalaryMonth, hasPrevCompletedMonthActivity, prevCompletedMonth]);

  const formatMonthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) return ym;
    const dateObj = new Date(y, m - 1, 1);
    return dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const getNextMonthFirstDateInfo = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) {
      return { unlockDateStr: '9999-12-01', unlockLabel: '1st of Next Month', nextMonthName: 'Next Month' };
    }
    const nextD = new Date(y, m, 1);
    const ny = nextD.getFullYear();
    const nm = String(nextD.getMonth() + 1).padStart(2, '0');
    const unlockDateStr = `${ny}-${nm}-01`;
    const nextMonthLong = nextD.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const nextMonthShort = nextD.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return {
      unlockDateStr,
      unlockLabel: `1st ${nextMonthLong}`,
      unlockShortLabel: `1st ${nextMonthShort}`,
      nextMonthName: nextD.toLocaleDateString('en-US', { month: 'long' }),
    };
  };

  const selectedMonthUnlockInfo = useMemo(
    () => getNextMonthFirstDateInfo(selectedMonth),
    [selectedMonth]
  );

  const currentRunningMonthUnlockInfo = useMemo(
    () => getNextMonthFirstDateInfo(currentRunningMonth),
    [currentRunningMonth]
  );

  // Rule: A month's salary is generated and viewable ONLY on or after the 1st of the following month!
  // (e.g., 2026-10 salary unlocks when todayStr >= '2026-11-01', i.e., selectedMonth < currentRunningMonth)
  const isMonthEndPayrollPublished = useMemo(() => {
    return todayStr >= selectedMonthUnlockInfo.unlockDateStr && selectedMonth < currentRunningMonth;
  }, [todayStr, selectedMonthUnlockInfo.unlockDateStr, selectedMonth, currentRunningMonth]);

  // Read admin monthly record for this employee (from real-time Firestore or localStorage)
  const monthlyRecord = useMemo(() => {
    if (!currentEmployee) return null;
    const recFromCloud =
      cloudPayrollRecords[`${selectedMonth}_${currentEmployee.id}`] ||
      cloudPayrollRecords[`${selectedMonth}_${currentEmployee.employeeId}`];
    if (recFromCloud) return recFromCloud;
    try {
      const saved = localStorage.getItem('worknest_payroll_monthly_records');
      if (saved) {
        const records = JSON.parse(saved);
        return records[`${selectedMonth}_${currentEmployee.id}`] || records[`${selectedMonth}_${currentEmployee.employeeId}`] || null;
      }
    } catch {}
    return null;
  }, [selectedMonth, currentEmployee, cloudPayrollRecords]);

  // Salary Calculations for Payslip (respecting Admin manual edits if present)
  const rawBasic = Number(currentEmployee.basicSalary ?? currentEmployee.basic) || (currentEmployee.grossSalary ? Math.round(Number(currentEmployee.grossSalary) * 0.5) : 25000);
  const rawHouseRent = Number(currentEmployee.houseRent) || Math.round(rawBasic * 0.6);
  const rawMedical = Number(currentEmployee.medical) || Math.round(rawBasic * 0.2);
  const rawConveyance = Number(currentEmployee.conveyance ?? currentEmployee.transport) || Math.round(rawBasic * 0.2);
  const rawFood = Number(currentEmployee.food) || 0;

  const basicSalary = monthlyRecord?.manuallyEdited && monthlyRecord?.basicSalary !== undefined ? Number(monthlyRecord.basicSalary) : rawBasic;
  const houseRent = monthlyRecord?.manuallyEdited && monthlyRecord?.houseRent !== undefined ? Number(monthlyRecord.houseRent) : rawHouseRent;
  const medical = monthlyRecord?.manuallyEdited && monthlyRecord?.medical !== undefined ? Number(monthlyRecord.medical) : rawMedical;
  const conveyance = monthlyRecord?.manuallyEdited && monthlyRecord?.conveyance !== undefined ? Number(monthlyRecord.conveyance) : rawConveyance;
  const foodAllowance = monthlyRecord?.manuallyEdited && monthlyRecord?.food !== undefined ? Number(monthlyRecord.food) : rawFood;
  const grossSalary = monthlyRecord?.manuallyEdited
    ? (basicSalary + houseRent + medical + conveyance + foodAllowance)
    : (Number(currentEmployee.grossSalary) || (basicSalary + houseRent + medical + conveyance + foodAllowance));

  // STATUTORY DEDUCTIONS: STRICTLY CONTROLLED BY ADMIN PANEL POLICY & ADMIN PAYROLL RECORDS
  const { providentFund, taxDeduction } = useMemo(() => {
    try {
      if (monthlyRecord) {
        return {
          providentFund: Number(monthlyRecord.pfDeduction) || 0,
          taxDeduction: Number(monthlyRecord.taxDeduction) || 0,
        };
      }
      const savedPolicy = localStorage.getItem('worknest_settings_payroll');
      if (savedPolicy) {
        const policy = JSON.parse(savedPolicy);
        const pf = policy.autoPfDeduction
          ? Math.round(basicSalary * ((Number(policy.pfEmployeePercent) || 8.33) / 100))
          : 0;
        const tax = policy.autoTaxDeduction && basicSalary > 30000
          ? Math.round(basicSalary * ((Number(policy.taxPercent) || 5) / 100))
          : 0;
        return { providentFund: pf, taxDeduction: tax };
      }
    } catch {}
    return { providentFund: 0, taxDeduction: 0 };
  }, [monthlyRecord, basicSalary]);

  // Full Monthly Schedule, Overtime, Weekend Allowance, Late & Absent Evaluation for Selected Month
  const monthAttendanceStats = useMemo(() => {
    if (!currentEmployee) {
      return {
        totalLate: 0,
        excusedLate: 0,
        unexcusedLate: 0,
        latePenaltyDays: 0,
        lateCut: 0,
        absentDays: 0,
        absentCut: 0,
        autoWeekendPresentDays: 0,
        autoOvertimeHours: 0,
        presentDays: 0,
      };
    }
    const empAtt = allAttendanceRecords.filter(a => a.date && String(a.date).startsWith(selectedMonth));
    const [selY, selM] = selectedMonth.split('-').map(Number);
    const totalMonthDays = selY && selM ? new Date(selY, selM, 0).getDate() : 30;

    let excusedCount = 0;
    let unexcusedCount = 0;
    let autoWeekendPresentDays = 0;
    let autoOvertimeMinutes = 0;
    let autoExplicitAbsentDays = 0;
    let autoUnpunchedPastWorkingDays = 0;
    let autoPresentDays = 0;

    for (let d = 1; d <= totalMonthDays; d++) {
      const dateStr = `${selY}-${String(selM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const attRecord = empAtt.find(a => a.date === dateStr);
      const sched = resolveEmployeeScheduleForDate(currentEmployee, dateStr, roster, shifts, attRecord?.shiftName);
      const dateShiftName = resolveEmployeeShiftNameForDate(currentEmployee, dateStr, attRecord?.shiftName);
      const isWeekend = Boolean(sched?.isWeekend || sched?.isOff);

      const activeLeave = myLeaves.find(
        l => l.status === 'approved' && dateStr >= l.from && dateStr <= l.to
      );

      const rawIn = attRecord?.checkIn && attRecord.checkIn !== '-' ? String(attRecord.checkIn) : '-';
      const rawOut = attRecord?.checkOut && attRecord.checkOut !== '-' ? String(attRecord.checkOut) : '-';
      const hasPunch = rawIn !== '-' || rawOut !== '-';

      let resolvedStatus = '';
      if (attRecord && (hasPunch || attRecord.status)) {
        const evalRes = evaluateAttendanceForSchedule(rawIn, rawOut, sched, attRecord, dateShiftName);
        resolvedStatus = evalRes.status;
      }

      const isPresentStatus = Boolean(
        attRecord &&
        (hasPunch || ['present', 'late', 'half_day'].includes(resolvedStatus)) &&
        resolvedStatus !== 'absent' &&
        resolvedStatus !== 'weekend_off'
      );

      if (isPresentStatus) {
        autoPresentDays++;
        if (isWeekend) {
          autoWeekendPresentDays++;
        }
        if (resolvedStatus === 'late') {
          const isApprovedWaiver = attendanceRequests.some(r =>
            (r.employeeId === currentEmployee.employeeId || r.employeeId === currentEmployee.id) &&
            r.date === dateStr &&
            r.type === 'late_arrival' &&
            r.status === 'approved'
          );
          if (attRecord.isLateExcused || attRecord.lateWaived || isApprovedWaiver) {
            excusedCount++;
          } else {
            unexcusedCount++;
          }
        }
        if (attRecord.otHours && Number(attRecord.otHours) > 0) {
          autoOvertimeMinutes += Math.round(Number(attRecord.otHours) * 60);
        }
      } else if (attRecord && resolvedStatus === 'absent') {
        autoExplicitAbsentDays++;
      } else if (activeLeave) {
        // Approved leave - no absent penalty
      } else if (!isWeekend && dateStr <= todayStr && empAtt.length > 0) {
        // Count unpunched working days when employee has active attendance in that month
        autoUnpunchedPastWorkingDays++;
      }
    }

    const totalLate = excusedCount + unexcusedCount;
    const latePenaltyDays = Math.floor(unexcusedCount / 3);
    const isV2Edited = Boolean(monthlyRecord?.manualOverrideV2);
    const oneDayGross30 = grossSalary / 30;
    const lateCut =
      isV2Edited && monthlyRecord?.lateDeduction !== undefined && Number(monthlyRecord.lateDeduction) > 0
        ? Number(monthlyRecord.lateDeduction)
        : Math.round(latePenaltyDays * oneDayGross30);

    const computedAbsentDays = autoExplicitAbsentDays + autoUnpunchedPastWorkingDays;
    const absentDays =
      isV2Edited && monthlyRecord?.absentDays !== undefined
        ? Number(monthlyRecord.absentDays)
        : Math.max(Number(monthlyRecord?.absentDays) || 0, computedAbsentDays);
    const grossAbsentCut = Math.round(absentDays * oneDayGross30);
    const absentCut = monthlyRecord?.absentDeductionManualZeroV2
      ? 0
      : isV2Edited && Number(monthlyRecord?.absentDeduction) > 0
      ? Number(monthlyRecord.absentDeduction)
      : grossAbsentCut;

    return {
      totalLate,
      excusedLate: excusedCount,
      unexcusedLate: unexcusedCount,
      latePenaltyDays,
      lateCut,
      absentDays,
      absentCut,
      autoWeekendPresentDays,
      autoOvertimeHours: Number((autoOvertimeMinutes / 60).toFixed(1)),
      presentDays: autoPresentDays,
    };
  }, [allAttendanceRecords, selectedMonth, currentEmployee, attendanceRequests, roster, shifts, myLeaves, todayStr, grossSalary, monthlyRecord]);

  const isV2Edited = Boolean(monthlyRecord?.manualOverrideV2);
  const weekendDaysCount = isV2Edited && monthlyRecord?.weekendDays !== undefined
    ? Number(monthlyRecord.weekendDays)
    : monthAttendanceStats.autoWeekendPresentDays;
  const weekendAllowance = (isV2Edited && monthlyRecord?.weekendAllowanceManualZero && monthlyRecord?.weekendAllowanceCustomOverride)
    ? 0
    : (monthlyRecord?.weekendAllowanceCustomOverride && monthlyRecord?.weekendAllowance !== undefined && Number(monthlyRecord.weekendAllowance) > 0)
    ? Number(monthlyRecord.weekendAllowance)
    : Math.round(weekendDaysCount * (grossSalary / 30));

  const empShiftWorkingHours = getEmployeeShiftWorkingHours(currentEmployee, shifts, roster, selectedMonth, allAttendanceRecords);
  const exactOtHourlyRate = monthlyRecord?.overtimeRateCustomOverride && Number(monthlyRecord?.overtimeRate) > 0
    ? Number(monthlyRecord.overtimeRate)
    : (((basicSalary / 30) / (monthlyRecord?.shiftWorkingHours || empShiftWorkingHours || 8)) * 1.5);
  const overtimeHoursCount = isV2Edited && monthlyRecord?.overtimeHours !== undefined
    ? Number(monthlyRecord.overtimeHours)
    : monthAttendanceStats.autoOvertimeHours;
  const overtimeAmount = Math.round(overtimeHoursCount * exactOtHourlyRate);
  const attendanceBonus = Number(monthlyRecord?.attendanceBonus ?? currentEmployee.attendanceBonus) || 0;
  const festivalBonus = Number(monthlyRecord?.festivalBonus) || 0;
  const customEarningName = monthlyRecord?.customEarningName || '';
  const otherAllowance = Number(monthlyRecord?.otherAllowance) || 0;

  const advanceDeduction = Number(monthlyRecord?.advanceDeduction) || 0;
  const loanDeduction = Number(monthlyRecord?.loanDeduction) || 0;
  const customDeductionName = monthlyRecord?.customDeductionName || '';
  const otherDeduction = Number(monthlyRecord?.otherDeduction) || 0;

  const totalGrossEarnings =
    grossSalary +
    weekendAllowance +
    overtimeAmount +
    attendanceBonus +
    festivalBonus +
    otherAllowance;

  const totalDeductions =
    providentFund +
    taxDeduction +
    monthAttendanceStats.lateCut +
    (monthAttendanceStats.absentCut || 0) +
    advanceDeduction +
    loanDeduction +
    otherDeduction;
  const netSalary = Math.max(0, totalGrossEarnings - totalDeductions);

  // =========================================================================
  // 3-DAYS LATE WARNING LETTER EVALUATION FOR EMPLOYEE DASHBOARD / OVERVIEW
  // Evaluates exact late dates, check-in times, shift start times, and waiver
  // status for the current running month (and selected month fallback)
  // =========================================================================
  const overviewLateWarningData = useMemo(() => {
    if (!currentEmployee) {
      return {
        targetMonth: currentRunningMonth,
        totalLate: 0,
        excusedLate: 0,
        unexcusedLate: 0,
        penaltyDays: 0,
        estimatedLateCut: 0,
        lateDetails: [] as {
          date: string;
          checkIn: string;
          shiftName: string;
          shiftStart: string;
          graceTime: number;
          isWaived: boolean;
        }[],
      };
    }

    const evaluateMonthLate = (ym: string) => {
      const empAtt = allAttendanceRecords.filter(a => a.date && String(a.date).startsWith(ym));
      const [y, m] = ym.split('-').map(Number);
      const totalDays = y && m ? new Date(y, m, 0).getDate() : 30;
      const details: {
        date: string;
        checkIn: string;
        shiftName: string;
        shiftStart: string;
        graceTime: number;
        isWaived: boolean;
      }[] = [];
      let excused = 0;
      let unexcused = 0;

      for (let d = 1; d <= totalDays; d++) {
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const attRecord = empAtt.find(a => a.date === dateStr);
        if (!attRecord) continue;

        const sched = resolveEmployeeScheduleForDate(currentEmployee, dateStr, roster, shifts, attRecord?.shiftName);
        const dateShiftName = resolveEmployeeShiftNameForDate(currentEmployee, dateStr, attRecord?.shiftName);
        const rawIn = attRecord?.checkIn && attRecord.checkIn !== '-' ? String(attRecord.checkIn) : '-';
        const rawOut = attRecord?.checkOut && attRecord.checkOut !== '-' ? String(attRecord.checkOut) : '-';
        const hasPunch = rawIn !== '-' || rawOut !== '-';

        if (hasPunch || attRecord.status) {
          const evalRes = evaluateAttendanceForSchedule(rawIn, rawOut, sched, attRecord, dateShiftName);
          if (evalRes.status === 'late') {
            const isApprovedWaiver = attendanceRequests.some(r =>
              (r.employeeId === currentEmployee.employeeId || r.employeeId === currentEmployee.id) &&
              r.date === dateStr &&
              r.type === 'late_arrival' &&
              r.status === 'approved'
            );
            const waived = Boolean(attRecord.isLateExcused || attRecord.lateWaived || isApprovedWaiver);
            if (waived) excused++;
            else unexcused++;

            details.push({
              date: dateStr,
              checkIn: rawIn,
              shiftName: dateShiftName || currentEmployee.shift || 'General Shift',
              shiftStart: sched?.startTime || assignedShift?.startTime || '09:00',
              graceTime: sched?.graceTime ?? assignedShift?.graceTime ?? 15,
              isWaived: waived,
            });
          }
        }
      }

      const penaltyDays = Math.floor(unexcused / 3);
      const estimatedLateCut = Math.round(penaltyDays * (grossSalary / 30));
      return {
        targetMonth: ym,
        totalLate: excused + unexcused,
        excusedLate: excused,
        unexcusedLate: unexcused,
        penaltyDays,
        estimatedLateCut,
        lateDetails: details,
      };
    };

    const runningData = evaluateMonthLate(currentRunningMonth);
    if (runningData.unexcusedLate >= 3 || runningData.totalLate >= 3) {
      return runningData;
    }
    if (selectedMonth !== currentRunningMonth) {
      const selectedData = evaluateMonthLate(selectedMonth);
      if (selectedData.unexcusedLate >= 3 || selectedData.totalLate >= 3) {
        return selectedData;
      }
    }
    return runningData;
  }, [currentEmployee, allAttendanceRecords, currentRunningMonth, selectedMonth, roster, shifts, attendanceRequests, assignedShift, grossSalary]);

  const warningAckKey = `${currentEmployee.id}_${overviewLateWarningData.targetMonth}_${overviewLateWarningData.unexcusedLate}`;
  const isWarningAcknowledged = Boolean(warningAcknowledgedMap[warningAckKey]);

  const handleAcknowledgeWarningLetter = () => {
    const nowStr = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    setWarningAcknowledgedMap(prev => {
      const updated = { ...prev, [warningAckKey]: nowStr };
      try {
        localStorage.setItem('worknest_late_warning_ack', JSON.stringify(updated));
      } catch {}
      return updated;
    });
    addNotification({
      title: 'Late Warning Letter Acknowledged',
      message: `${currentEmployee.name} (${currentEmployee.employeeId}) acknowledged the Official 3-Days Late Attendance Warning Letter for ${formatMonthLabel(overviewLateWarningData.targetMonth)}.`,
      read: false,
      type: 'attendance',
      targetPage: 'attendance',
    });
  };

  // Real-time live clock for Employee Command Center
  const [liveClockTime, setLiveClockTime] = useState<string>(() => {
    return new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveClockTime(new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Dashboard Chart Controls & Interactions
  const [dashboardChartPeriod, setDashboardChartPeriod] = useState<'this_month' | 'last_month' | 'last_14_days'>('this_month');
  const [hoveredDonutIdx, setHoveredDonutIdx] = useState<number | null>(null);
  const [hoveredBarIdx, setHoveredBarIdx] = useState<number | null>(null);
  const [barChartMetric, setBarChartMetric] = useState<'work_hours' | 'overtime'>('work_hours');

  // Chart computations
  const dashboardChartData = useMemo(() => {
    if (!currentEmployee) return null;

    let targetDates: string[] = [];
    const [curY, curM] = currentRunningMonth.split('-').map(Number);
    const [prevY, prevM] = prevCompletedMonth.split('-').map(Number);

    if (dashboardChartPeriod === 'this_month') {
      const daysInMonth = new Date(curY, curM, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        targetDates.push(`${curY}-${String(curM).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    } else if (dashboardChartPeriod === 'last_month') {
      const daysInMonth = new Date(prevY, prevM, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        targetDates.push(`${prevY}-${String(prevM).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    } else {
      // last 14 days
      for (let i = 13; i >= 0; i--) {
        const dObj = new Date();
        dObj.setDate(dObj.getDate() - i);
        const y = dObj.getFullYear();
        const m = String(dObj.getMonth() + 1).padStart(2, '0');
        const d = String(dObj.getDate()).padStart(2, '0');
        targetDates.push(`${y}-${m}-${d}`);
      }
    }

    const standardHours = currentEmployee ? getEmployeeShiftWorkingHours(currentEmployee, shifts, roster, selectedMonth) : 8.0;

    let presentCount = 0;
    let onTimeCount = 0;
    let lateCount = 0;
    let leaveCount = 0;
    let absentCount = 0;
    let offDaysCount = 0;
    let totalWorkHoursLogged = 0;
    let totalOtHoursLogged = 0;

    const dailyPoints = targetDates.map(dateStr => {
      const rec = allAttendanceRecords.find(r => r.date === dateStr);
      const isFuture = dateStr > todayStr;
      const isToday = dateStr === todayStr;

      const sched = resolveEmployeeScheduleForDate(currentEmployee, dateStr, roster, shifts);
      const isWeekend = Boolean(sched?.isWeekend || sched?.isOff);

      const leave = leaveRequests.find(
        l => (l.employeeId === currentEmployee.id || l.employeeId === currentEmployee.employeeId) &&
             l.status === 'approved' &&
             l.from <= dateStr && l.to >= dateStr
      );

      const holiday = (companyHolidays || []).find(
        h => h.startDate <= dateStr && h.endDate >= dateStr
      );

      const isOff = isWeekend || (Boolean(holiday) && !rec?.checkIn);
      const hasPunch = Boolean(rec?.checkIn && rec.checkIn !== '-');
      const workHours = hasPunch && rec?.totalHours !== undefined ? Number(rec.totalHours) : 0;
      const otHours = hasPunch && rec?.otHours !== undefined ? Number(rec.otHours) : 0;
      const status = rec?.status || (leave ? 'leave' : isOff ? 'off' : isFuture ? 'upcoming' : 'absent');

      if (!isFuture) {
        if (leave) {
          leaveCount++;
        } else if (hasPunch) {
          presentCount++;
          if (rec?.status === 'late') {
            lateCount++;
          } else {
            onTimeCount++;
          }
          totalWorkHoursLogged += workHours;
          totalOtHoursLogged += otHours;
        } else if (isOff) {
          offDaysCount++;
        } else {
          absentCount++;
        }
      }

      const dObj = new Date(dateStr + 'T00:00:00Z');
      const dayShort = dObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
      const dayNum = dObj.getUTCDate();

      return {
        dateStr,
        dayNum,
        dayShort,
        workHours,
        otHours,
        standardHours,
        checkIn: rec?.checkIn && rec.checkIn !== '-' ? rec.checkIn : null,
        checkOut: rec?.checkOut && rec.checkOut !== '-' ? rec.checkOut : null,
        status,
        isFuture,
        isToday,
        isOff,
        holidayName: holiday?.title,
        leaveType: leave?.type,
      };
    });

    const elapsedDays = dailyPoints.filter(p => !p.isFuture);
    const workingDaysCount = elapsedDays.filter(p => !p.isOff).length;
    const attendanceRate = workingDaysCount > 0 ? Math.min(100, Math.round((presentCount / workingDaysCount) * 100)) : 100;
    const punctualityScore = presentCount > 0 ? Math.min(100, Math.round((onTimeCount / presentCount) * 100)) : 100;
    const avgDailyHours = presentCount > 0 ? Number((totalWorkHoursLogged / presentCount).toFixed(1)) : 0;

    const pieSlices = [
      { id: 'ontime', label: 'On-Time Present', count: onTimeCount, color: '#10B981', textColor: 'text-emerald-700', bg: 'bg-emerald-500' },
      { id: 'late', label: 'Late Arrival', count: lateCount, color: '#F59E0B', textColor: 'text-amber-700', bg: 'bg-amber-500' },
      { id: 'leave', label: 'Approved Leave', count: leaveCount, color: '#8B5CF6', textColor: 'text-purple-700', bg: 'bg-purple-500' },
      { id: 'absent', label: 'Absent', count: absentCount, color: '#EF4444', textColor: 'text-rose-700', bg: 'bg-rose-500' },
      { id: 'off', label: 'Weekends & Holidays', count: offDaysCount, color: '#0EA5E9', textColor: 'text-sky-700', bg: 'bg-sky-500' },
    ].filter(s => s.count > 0 || elapsedDays.length === 0);

    const pieTotal = pieSlices.reduce((acc, s) => acc + s.count, 0);

    let accumulatedAngle = 0;
    const donutPaths = pieSlices.map(slice => {
      const fraction = pieTotal > 0 ? slice.count / pieTotal : 0;
      const angle = fraction * 360;
      const startAngle = accumulatedAngle;
      const endAngle = accumulatedAngle + angle;
      accumulatedAngle = endAngle;

      return {
        ...slice,
        fraction,
        percentage: Math.round(fraction * 100),
        startAngle,
        endAngle,
      };
    });

    return {
      targetDates,
      dailyPoints,
      presentCount,
      onTimeCount,
      lateCount,
      leaveCount,
      absentCount,
      offDaysCount,
      totalWorkHoursLogged: Number(totalWorkHoursLogged.toFixed(1)),
      totalOtHoursLogged: Number(totalOtHoursLogged.toFixed(1)),
      workingDaysCount,
      attendanceRate,
      punctualityScore,
      avgDailyHours,
      standardHours,
      pieSlices,
      pieTotal,
      donutPaths,
    };
  }, [
    currentEmployee,
    dashboardChartPeriod,
    currentRunningMonth,
    prevCompletedMonth,
    todayStr,
    allAttendanceRecords,
    assignedShift,
    shifts,
    roster,
    leaveRequests,
    companyHolidays,
  ]);

  const upcomingHolidays = useMemo(() => {
    return (companyHolidays || [])
      .filter(h => h.endDate >= todayStr)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 4);
  }, [companyHolidays, todayStr]);

  return (
    <div className="min-h-screen bg-mesh-light flex font-sans pt-[env(safe-area-inset-top)]">
      {/* ========================================================================= */}
      {/* MOBILE DRAWER BACKDROP                                                    */}
      {/* ========================================================================= */}
      <div
        className={`fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-[65] transition-opacity duration-300 lg:hidden ${
          isMobileSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsMobileSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* ========================================================================= */}
      {/* MOBILE SLIDE-OUT DRAWER (ADMIN-STYLE DARK GRADIENT & LUXURY AESTHETIC)     */}
      {/* ========================================================================= */}
      <aside
        className={`fixed inset-y-0 left-0 z-[70] w-[285px] max-w-[85vw] bg-gradient-to-b from-slate-950 via-[#0b0f19] to-slate-950 text-slate-200 flex flex-col border-r border-white/[0.08] shadow-2xl transform transition-transform duration-300 ease-in-out lg:hidden ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Mobile Header */}
        <div className="relative px-4 pt-5 pb-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="relative shrink-0">
              {companyLogo ? (
                <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shadow-md ring-1 ring-white/25 p-1 overflow-hidden">
                  <img
                    src={companyLogo}
                    alt={companyName}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-indigo-500/35 ring-1 ring-white/20">
                  <IconFlame size={20} className="text-white drop-shadow-sm" />
                </div>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950 ring-1 ring-emerald-400/50"></span>
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h1 className="font-bold text-[15px] tracking-tight text-white leading-tight font-display truncate max-w-[140px]" title={companyName}>
                  {companyName}
                </h1>
              </div>
              <div className="flex items-center space-x-1.5 mt-0.5">
                <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.2 rounded bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-2xs">
                  EMPLOYEE
                </span>
                <span className="text-[10px] text-slate-400 font-medium tracking-wide">Workspace</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsMobileSidebarOpen(false)}
            className="w-9 h-9 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            title="Close navigation"
          >
            <span className="text-lg leading-none">✕</span>
          </button>
        </div>

        {/* Mobile Employee Profile Pill */}
        <div className="relative px-3 pt-3 pb-1 shrink-0">
          <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center space-x-2.5">
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-semibold text-white shadow-md overflow-hidden">
                {currentEmployee.avatar && (currentEmployee.avatar.startsWith('data:image/') || currentEmployee.avatar.startsWith('http')) ? (
                  <img src={currentEmployee.avatar} alt={currentEmployee.name} className="w-full h-full object-cover" />
                ) : (
                  currentEmployee.avatar || '👨‍💼'
                )}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950"></span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-white truncate leading-tight">{currentEmployee.name}</p>
              <div className="flex items-center space-x-1 mt-0.5">
                <span className="text-[10px] text-indigo-300 font-medium truncate">{currentEmployee.designation || 'Staff'}</span>
              </div>
              <div className="flex items-center space-x-1 mt-1">
                <span className="text-[9px] font-mono px-1.5 py-0.2 bg-white/10 text-white/90 rounded">
                  {currentEmployee.employeeId}
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${isRemoteEmployee ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'}`}>
                  {isRemoteEmployee ? 'Remote Shift' : 'Fixed Shift'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Navigation List */}
        <nav className="relative flex-1 overflow-y-auto px-3 py-3 space-y-4 thin-scroll">
          {[
            { catKey: 'daily', title: 'Daily & Attendance' },
            { catKey: 'leave_pay', title: 'Leave & Payroll' },
            { catKey: 'company', title: 'Company & Work' },
            { catKey: 'support', title: 'Account & Settings' },
          ].map(group => {
            const groupItems = ALL_MODULES_LIST.filter(item => item.category === group.catKey);
            if (groupItems.length === 0) return null;

            return (
              <div key={group.catKey} className="space-y-1">
                <div className="px-3 mb-1.5 text-[10px] font-bold text-slate-400/80 uppercase tracking-[0.14em] flex items-center justify-between">
                  <span>{group.title}</span>
                  <span className="w-8 h-[1px] bg-white/[0.08]"></span>
                </div>
                <div className="space-y-1">
                  {groupItems.map(item => {
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectTab(item.id)}
                        className={`relative w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-left text-[13px] font-medium transition-all duration-200 cursor-pointer ${
                          isActive
                            ? 'bg-gradient-to-r from-indigo-500/25 via-violet-500/20 to-transparent text-white font-semibold ring-1 ring-indigo-500/40'
                            : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
                        }`}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-gradient-to-b from-indigo-400 via-violet-400 to-fuchsia-400 rounded-r-full shadow-sm shadow-indigo-500"></span>
                        )}
                        <span className="text-base shrink-0">{item.icon}</span>
                        <span className="flex-1 tracking-tight truncate">{item.title}</span>
                        {item.badge && (
                          <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase rounded ${isActive ? 'bg-white text-indigo-900 shadow-2xs' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}`}>
                            {item.badge}
                          </span>
                        )}
                        {isActive && <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Mobile Footer */}
        <div className="relative px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2.5 border-t border-white/[0.07] bg-slate-950/90 shrink-0 space-y-2">
          <div className="flex items-center justify-between px-2 text-[10px] text-slate-400">
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-slate-300 font-medium">Employee Active</span>
            </span>
            <button
              type="button"
              onClick={() => handleSelectTab('settings')}
              className="text-indigo-300 hover:text-white flex items-center space-x-1 cursor-pointer transition-colors"
              title="Theme & Settings"
            >
              <span>⚙️ Settings</span>
            </button>
          </div>
          <button
            type="button"
            onClick={logoutEmployee}
            className="w-full px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 hover:text-rose-200 text-xs font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer"
          >
            <IconLogout size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* DESKTOP SIDEBAR (MATCHING ADMIN PANEL UI, SLEEK DARK GRADIENT & ACCENTS)   */}
      {/* ========================================================================= */}
      <aside className="hidden lg:flex w-[268px] h-screen flex-shrink-0 bg-gradient-to-b from-slate-950 via-[#0b0f19] to-slate-950 text-slate-200 flex-col border-r border-white/[0.07] relative z-20 shadow-2xl select-none sticky top-0">
        {/* Ambient glow accents */}
        <div className="absolute -top-32 -left-32 w-64 h-64 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-violet-600/15 rounded-full blur-3xl pointer-events-none"></div>

        {/* 1. Brand Header */}
        <div className="relative shrink-0 px-4 pt-5 pb-4 border-b border-white/[0.08]">
          <div className="flex items-center space-x-3">
            <div className="relative shrink-0">
              {companyLogo ? (
                <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shadow-md ring-1 ring-white/25 p-1 overflow-hidden">
                  <img
                    src={companyLogo}
                    alt={companyName}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-indigo-500/35 ring-1 ring-white/20">
                  <IconFlame size={20} className="text-white drop-shadow-sm" />
                </div>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950 ring-1 ring-emerald-400/50"></span>
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h1 className="font-bold text-[15px] tracking-tight text-white leading-tight font-display truncate max-w-[140px]" title={companyName}>
                  {companyName}
                </h1>
              </div>
              <div className="flex items-center space-x-1.5 mt-0.5">
                <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.2 rounded bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-2xs">
                  EMPLOYEE
                </span>
                <span className="text-[10px] text-slate-400 font-medium tracking-wide">Workspace</span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Employee Profile Card */}
        <div className="relative px-3 pt-3 pb-1 shrink-0">
          <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center space-x-2.5">
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-semibold text-white shadow-md overflow-hidden">
                {currentEmployee.avatar && (currentEmployee.avatar.startsWith('data:image/') || currentEmployee.avatar.startsWith('http')) ? (
                  <img src={currentEmployee.avatar} alt={currentEmployee.name} className="w-full h-full object-cover" />
                ) : (
                  currentEmployee.avatar || '👨‍💼'
                )}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950"></span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-white truncate leading-tight">{currentEmployee.name}</p>
              <div className="flex items-center space-x-1 mt-0.5">
                <span className="text-[10px] text-indigo-300 font-medium truncate">{currentEmployee.designation || 'Staff'}</span>
              </div>
              <div className="flex items-center space-x-1 mt-1">
                <span className="text-[9px] font-mono px-1.5 py-0.2 bg-white/10 text-white/90 rounded">
                  {currentEmployee.employeeId}
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${isRemoteEmployee ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'}`}>
                  {isRemoteEmployee ? 'Remote Shift' : 'Fixed Shift'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Categorized Feature Navigation List */}
        <div className="relative flex-1 overflow-y-auto px-3 py-3 space-y-4 thin-scroll">
          {[
            { catKey: 'daily', title: 'Daily & Attendance' },
            { catKey: 'leave_pay', title: 'Leave & Payroll' },
            { catKey: 'company', title: 'Company & Work' },
            { catKey: 'support', title: 'Account & Settings' },
          ].map(group => {
            const groupItems = ALL_MODULES_LIST.filter(item => item.category === group.catKey);
            if (groupItems.length === 0) return null;

            return (
              <div key={group.catKey} className="space-y-1">
                <div className="px-3 mb-1.5 text-[10px] font-bold text-slate-400/80 uppercase tracking-[0.14em] flex items-center justify-between">
                  <span>{group.title}</span>
                  <span className="w-8 h-[1px] bg-white/[0.08]"></span>
                </div>
                <div className="space-y-1">
                  {groupItems.map(item => {
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectTab(item.id)}
                        className={`relative w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-left text-[13px] font-medium transition-all duration-200 cursor-pointer ${
                          isActive
                            ? 'bg-gradient-to-r from-indigo-500/25 via-violet-500/20 to-transparent text-white font-semibold ring-1 ring-indigo-500/40'
                            : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
                        }`}
                        title={`${item.title} - ${item.subtitle}`}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-gradient-to-b from-indigo-400 via-violet-400 to-fuchsia-400 rounded-r-full shadow-sm shadow-indigo-500"></span>
                        )}
                        <span className="text-base shrink-0">{item.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="truncate leading-tight">{item.title}</div>
                        </div>
                        {item.badge && (
                          <span
                            className={`ml-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase shrink-0 ${
                              isActive
                                ? 'bg-white text-indigo-900 shadow-2xs'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                        {isActive && <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* 4. Sidebar Footer with Sign Out & Settings Shortcut */}
        <div className="relative px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2.5 border-t border-white/[0.07] bg-slate-950/90 shrink-0 space-y-2">
          <div className="flex items-center justify-between px-2 text-[10px] text-slate-400">
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-slate-300 font-medium">Employee Active</span>
            </span>
            <button
              type="button"
              onClick={() => handleSelectTab('settings')}
              className="text-indigo-300 hover:text-white flex items-center space-x-1 cursor-pointer transition-colors"
              title="Theme & Settings"
            >
              <span>⚙️ Settings</span>
            </button>
          </div>

          <button
            type="button"
            onClick={logoutEmployee}
            className="w-full px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 hover:text-rose-200 text-xs font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer"
          >
            <IconLogout size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* MAIN RIGHT WORKSPACE AREA                                                 */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Clean Sticky TopBar */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs h-16 shrink-0">
          <div className="px-3 sm:px-6 h-full flex items-center justify-between gap-3">
            {/* Left: Hamburger toggle button for mobile & page breadcrumbs */}
            <div className="flex items-center space-x-3 min-w-0">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
                title="Open Navigation Menu"
              >
                <IconMenu className="w-5 h-5" />
              </button>

              <div className="min-w-0">
                <div className="flex items-center space-x-1.5">
                  {companyLogo && (
                    <div className="w-5 h-5 rounded bg-white flex items-center justify-center p-0.5 shadow-2xs overflow-hidden shrink-0 hidden sm:inline-flex">
                      <img src={companyLogo} alt={companyName} className="w-full h-full object-contain" />
                    </div>
                  )}
                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider hidden sm:inline truncate max-w-[150px]">
                    {companyName}
                  </span>
                  <span className="text-xs text-slate-300 hidden sm:inline">/</span>
                  <h2 className="font-black text-slate-900 text-sm sm:text-base truncate flex items-center space-x-1.5">
                    <span>{currentActiveModule.icon}</span>
                    <span>{currentActiveModule.title}</span>
                    <span className="text-xs font-medium text-slate-400 hidden md:inline">
                      ({currentActiveModule.subtitle})
                    </span>
                  </h2>
                </div>
                <p className="text-[11px] text-slate-500 truncate hidden xs:block mt-0.5">
                  Welcome back, <span className="font-bold text-slate-700">{currentEmployee.name}</span> • {currentEmployee.designation}
                </p>
              </div>
            </div>

            {/* Right: Live Shift pill, Theme Shortcut, notifications, quick actions */}
            <div className="flex items-center space-x-2 shrink-0">
              <div className="hidden sm:flex items-center space-x-1.5 px-3 py-1 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-xl text-xs font-bold">
                <span>⏱️</span>
                <span>{assignedShift?.name || currentEmployee.shift || 'General Shift'}</span>
              </div>

              {/* Theme & Settings Quick Shortcut */}
              <button
                type="button"
                onClick={() => handleSelectTab('settings')}
                className="p-2 sm:px-3 sm:py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer"
                title="Appearance & Theme Settings"
              >
                <span>🎨</span>
                <span className="hidden md:inline">Theme</span>
              </button>

              {/* Notification Button */}
              <button
                type="button"
                onClick={() => handleSelectTab('notifications')}
                className="p-2 sm:px-3 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer relative"
                title="My Notifications"
              >
                <span>🔔</span>
                <span className="hidden md:inline">Notices</span>
                {notifications.filter(
                  n =>
                    !n.read &&
                    (!n.forEmployeeId ||
                      n.forEmployeeId === currentEmployee.id ||
                      n.forEmployeeId === currentEmployee.employeeId)
                ).length > 0 && (
                  <span className="px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[10px] font-black">
                    {
                      notifications.filter(
                        n =>
                          !n.read &&
                          (!n.forEmployeeId ||
                            n.forEmployeeId === currentEmployee.id ||
                            n.forEmployeeId === currentEmployee.employeeId)
                      ).length
                    }
                  </span>
                )}
              </button>

                {/* Quick Profile Avatar Shortcut */}
                <button
                  type="button"
                  onClick={() => handleSelectTab('profile')}
                  className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white overflow-hidden flex items-center justify-center shrink-0 cursor-pointer shadow-2xs hover:ring-2 hover:ring-indigo-400 transition-all"
                  title="View / Edit Profile Photo & Details"
                >
                  {currentEmployee.avatar && (currentEmployee.avatar.startsWith('data:image/') || currentEmployee.avatar.startsWith('http')) ? (
                    <img src={currentEmployee.avatar} alt={currentEmployee.name} className="w-full h-full object-cover object-center" />
                  ) : (
                    <span className="text-xs font-bold">{currentEmployee.name.charAt(0)}</span>
                  )}
                </button>

                {/* Quick Sign Out (Mobile / Topbar) */}
              <button
                onClick={logoutEmployee}
                className="lg:hidden px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer"
                title="Sign Out"
              >
                <IconLogout className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </header>

        {/* Workspace Main Content Container */}
        <main className="p-3 sm:p-6 lg:p-8 flex-1 w-full max-w-7xl mx-auto pb-16 sm:pb-8">
        {/* ======================================================================= */}
        {/* TAB 1: OVERVIEW / DASHBOARD                                             */}
        {/* ======================================================================= */}
        {activeTab === 'overview' && (
          <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* =================================================================== */}
            {/* OFFICIAL 3-DAYS LATE ATTENDANCE WARNING LETTER HIGHLIGHT BANNER     */}
            {/* Automatically triggers when employee has >= 3 Late Days in month    */}
            {/* =================================================================== */}
            {overviewLateWarningData.totalLate >= 3 && (
              <div className="rounded-3xl border-2 border-rose-500 bg-gradient-to-r from-rose-50 via-red-50/90 to-amber-50 p-4 sm:p-6 shadow-md relative overflow-hidden">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-2.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center space-x-1.5 px-3 py-1 bg-rose-600 text-white text-[11px] font-black uppercase tracking-wider rounded-full shadow-xs animate-pulse">
                        <span>🚨</span>
                        <span>OFFICIAL HR WARNING LETTER • {overviewLateWarningData.totalLate} DAYS LATE</span>
                      </span>
                      <span className="px-2.5 py-0.5 bg-white border border-rose-200 text-rose-800 font-mono text-[11px] font-bold rounded-lg">
                        Ref: WN/HR/LW/{overviewLateWarningData.targetMonth.replace('-', '')}/{currentEmployee.employeeId}
                      </span>
                      <span className="px-2.5 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 text-[11px] font-bold rounded-lg">
                        Month: {formatMonthLabel(overviewLateWarningData.targetMonth)}
                      </span>
                      {isWarningAcknowledged && (
                        <span className="px-2.5 py-0.5 bg-emerald-100 border border-emerald-300 text-emerald-800 text-[11px] font-bold rounded-lg">
                          ✅ Acknowledged ({warningAcknowledgedMap[warningAckKey]})
                        </span>
                      )}
                    </div>

                    <h3 className="text-base sm:text-xl font-black text-rose-950 leading-snug">
                      ⚠️ Official Attendance Warning Notice (Punctuality Policy Violation)
                    </h3>

                    <p className="text-xs sm:text-sm text-rose-900 leading-relaxed">
                      Dear <strong>{currentEmployee.name}</strong>, you have accumulated{' '}
                      <strong className="underline decoration-rose-500">{overviewLateWarningData.totalLate} late check-in days</strong> after scheduled shift times in <strong>{formatMonthLabel(overviewLateWarningData.targetMonth)}</strong>
                      {overviewLateWarningData.excusedLate > 0 ? ` (${overviewLateWarningData.unexcusedLate} unexcused, ${overviewLateWarningData.excusedLate} waived)` : ''}.
                      Under company HR punctuality policy, every <strong>3 late arrivals result in 1 day salary deduction</strong>{' '}
                      {overviewLateWarningData.unexcusedLate >= 3 ? (
                        <strong className="text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded">
                          ({overviewLateWarningData.penaltyDays} Day Salary Deduction = ৳{overviewLateWarningData.estimatedLateCut.toLocaleString()})
                        </strong>
                      ) : (
                        <span>applies</span>
                      )}{' '}
                      to this pay period. An official warning letter has been issued. Please ensure prompt attendance to avoid further disciplinary action.
                    </p>

                    {/* Exact Late Dates & Check-in Time Chips */}
                    <div className="pt-1">
                      <span className="text-[11px] font-bold text-rose-800 uppercase tracking-wider block mb-1.5">
                        📅 Recorded Late Arrival Dates &amp; Punch-In Times:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {overviewLateWarningData.lateDetails.map((item, idx) => (
                          <span
                            key={item.date + idx}
                            className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border shadow-2xs ${
                              item.isWaived
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-white border-rose-300 text-rose-900'
                            }`}
                          >
                            <span>#{idx + 1}</span>
                            <span className="font-mono">{item.date}</span>
                            <span className="text-rose-600 font-mono">In: {formatTo12Hour(item.checkIn)}</span>
                            <span className="text-[10px] text-slate-500">(Shift: {formatTo12Hour(item.shiftStart)})</span>
                            {item.isWaived && <span className="text-[10px] text-emerald-700 font-extrabold">[Waived]</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons on Warning Highlight */}
                  <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowWarningLetterModal(true)}
                      className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs sm:text-sm font-extrabold shadow-sm transition-all flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <span>📜</span>
                      <span>View Official Warning Letter</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const latestUnwaived = [...overviewLateWarningData.lateDetails].reverse().find(d => !d.isWaived);
                        if (latestUnwaived) {
                          setAttRequestForm({
                            type: 'late_arrival',
                            date: latestUnwaived.date,
                            actualTime: latestUnwaived.checkIn !== '-' ? latestUnwaived.checkIn.slice(0, 5) : '09:30',
                            checkOutTime: '18:00',
                            otHours: 2,
                            reason: '',
                          });
                        }
                        setActiveTab('requests');
                      }}
                      className="px-4 py-2 bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
                    >
                      <span>📝</span>
                      <span>Submit Late Waiver Request</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Early Punctuality Alert when Employee has 2 Late Days (1 away from Warning Letter) */}
            {overviewLateWarningData.totalLate === 2 && (
              <div className="rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-orange-50 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-0.5 bg-amber-500 text-white text-[10px] font-black uppercase rounded-full">
                      ⚠️ Punctuality Alert • 2/3 Late Days
                    </span>
                    <span className="text-xs font-bold text-amber-900">
                      {formatMonthLabel(overviewLateWarningData.targetMonth)}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-amber-950">
                    Alert: You have recorded 2 late arrivals ({overviewLateWarningData.lateDetails.map(d => d.date).join(', ')}) in {formatMonthLabel(overviewLateWarningData.targetMonth)}. One more late arrival will trigger an official warning letter and 1 day salary deduction!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('requests')}
                  className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shrink-0 cursor-pointer"
                >
                  Request Late Waiver →
                </button>
              </div>
            )}

            {/* =================================================================== */}
            {/* EXECUTIVE HERO BANNER: Identity, Real-time Clock, & Fast Action Hub */}
            {/* =================================================================== */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 p-5 sm:p-7 text-white shadow-xl border border-indigo-500/20">
              {/* Decorative Ambient Glow Orbs */}
              <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-purple-500/15 blur-3xl pointer-events-none" />

              <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                {/* Employee Profile Header & Clock */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-xs font-bold text-indigo-200">
                      <IconSparkles size={13} className="text-indigo-400" />
                      <span>Employee Command Center</span>
                    </span>
                    <span className="text-white/30 hidden sm:inline">•</span>
                    <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-mono font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{liveClockTime} (BD Time)</span>
                    </div>
                    <span className="text-white/30 hidden sm:inline">•</span>
                    <span className="text-xs text-slate-300 font-medium">
                      {new Date(todayStr + 'T00:00:00Z').toLocaleDateString('en-GB', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </span>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-black text-2xl shadow-lg ring-4 ring-white/10 overflow-hidden shrink-0">
                      {currentEmployee.avatar && (currentEmployee.avatar.startsWith('data:image/') || currentEmployee.avatar.startsWith('http://') || currentEmployee.avatar.startsWith('https://')) ? (
                        <img src={currentEmployee.avatar} alt={currentEmployee.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>{currentEmployee.name.charAt(0)}</span>
                      )}
                    </div>
                    <div>
                      <h1 className="text-xl sm:text-3xl font-black text-white tracking-tight flex items-center space-x-2">
                        <span>{currentEmployee.name}</span>
                        <span className="text-base sm:text-xl">👋</span>
                      </h1>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-indigo-200/90 mt-1">
                        <span className="font-semibold text-white">{currentEmployee.designation || 'Staff'}</span>
                        <span className="text-white/30">·</span>
                        <span>{currentEmployee.department}</span>
                        <span className="text-white/30">·</span>
                        <span className="font-mono bg-white/10 px-2 py-0.5 rounded text-[11px] text-white">
                          ID: {currentEmployee.employeeId}
                        </span>
                        {currentEmployee.branch && (
                          <>
                            <span className="text-white/30">·</span>
                            <span>📍 {currentEmployee.branch}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Fast Action Buttons Grid */}
                <div className="flex flex-wrap items-center gap-2 lg:max-w-md shrink-0">
                  {/* Camera Check-in is ONLY rendered if the employee has a Remote shift */}
                  {isRemoteEmployee && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('checkin')}
                      className="flex-1 sm:flex-initial px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-extrabold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer active:scale-95 whitespace-nowrap"
                    >
                      <IconFingerprint size={16} />
                      <span>Camera Check-in</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveTab('leave')}
                    className="flex-1 sm:flex-initial px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white font-bold rounded-xl text-xs sm:text-sm transition-all flex items-center justify-center space-x-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <IconLeave size={15} />
                    <span>Apply Leave</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('requests')}
                    className="flex-1 sm:flex-initial px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white font-bold rounded-xl text-xs sm:text-sm transition-all flex items-center justify-center space-x-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <IconClock size={15} />
                    <span>Late Waiver / Regularize</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('payslips')}
                    className="flex-1 sm:flex-initial px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white font-bold rounded-xl text-xs sm:text-sm transition-all flex items-center justify-center space-x-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <IconWallet size={15} />
                    <span>Payslip</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('messages')}
                    className="flex-1 sm:flex-initial px-3.5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white font-bold rounded-xl text-xs sm:text-sm transition-all flex items-center justify-center space-x-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <span>💬</span>
                    <span>HR Chat</span>
                  </button>
                </div>
              </div>
            </div>

            {/* =================================================================== */}
            {/* TODAY'S SHIFT TIMELINE & LIVE PRESENCE TRACKER                      */}
            {/* =================================================================== */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Left: Today's Status summary */}
                <div className="flex items-center space-x-3.5">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs shrink-0 ${
                      todayRecord?.checkIn && todayRecord.checkIn !== '-'
                        ? todayRecord?.checkOut && todayRecord.checkOut !== '-'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-emerald-600 text-white animate-pulse'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <IconClock size={22} />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Today's Attendance Status
                      </span>
                      <span
                        className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          todayRecord?.checkIn && todayRecord.checkIn !== '-'
                            ? todayRecord?.checkOut && todayRecord.checkOut !== '-'
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {todayRecord?.checkIn && todayRecord.checkIn !== '-'
                          ? todayRecord?.checkOut && todayRecord.checkOut !== '-'
                            ? 'Checked Out'
                            : 'Active On Duty'
                          : 'Not Checked In'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 mt-1 font-mono text-xs sm:text-sm">
                      <div>
                        <span className="text-slate-400 text-[10px] block font-sans">FIRST IN</span>
                        <span className="font-bold text-emerald-700">
                          {todayRecord?.checkIn && todayRecord.checkIn !== '-'
                            ? formatTo12Hour(todayRecord.checkIn)
                            : todayRecord?.firstPunchIn
                            ? formatTo12Hour(todayRecord.firstPunchIn)
                            : '--:--'}
                        </span>
                      </div>
                      <span className="text-slate-300">→</span>
                      <div>
                        <span className="text-slate-400 text-[10px] block font-sans">LAST OUT</span>
                        <span className="font-bold text-indigo-700">
                          {todayRecord?.checkOut && todayRecord.checkOut !== '-'
                            ? formatTo12Hour(todayRecord.checkOut)
                            : todayRecord?.lastPunchOut
                            ? formatTo12Hour(todayRecord.lastPunchOut)
                            : '--:--'}
                        </span>
                      </div>
                      <span className="text-slate-300">|</span>
                      <div>
                        <span className="text-slate-400 text-[10px] block font-sans">WORK DURATION</span>
                        <span className="font-bold text-slate-900">
                          {todayRecord?.totalHours ? `${Number(todayRecord.totalHours).toFixed(1)} hrs` : 'In Progress'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Assigned Shift Timing & Visual Timeline */}
                <div className="lg:w-1/2 bg-slate-50 border border-slate-200/70 rounded-xl p-3 sm:p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700 flex items-center space-x-1.5">
                      <IconShift size={14} className="text-indigo-600" />
                      <span>{assignedShift?.name || currentEmployee.shift || 'General Shift'}</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 font-semibold">
                      {assignedShift?.startTime || '09:00'} - {assignedShift?.endTime || '18:00'} ({assignedShift?.breakTime || 60}m break)
                    </span>
                  </div>

                  {/* Horizontal Progress Timeline */}
                  <div className="relative pt-1 pb-1">
                    <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex">
                      <div className="h-full bg-emerald-500 w-[15%]" title="Grace Period" />
                      <div className="h-full bg-indigo-500 w-[40%]" title="Morning Working Hours" />
                      <div className="h-full bg-amber-400 w-[10%]" title="Lunch Break" />
                      <div className="h-full bg-indigo-500 w-[35%]" title="Afternoon Working Hours" />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                      <span>In: {formatTo12Hour(assignedShift?.startTime || '09:00')}</span>
                      <span>Grace: +{assignedShift?.graceTime || 15}m</span>
                      <span>Lunch</span>
                      <span>Out: {formatTo12Hour(assignedShift?.endTime || '18:00')}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* =================================================================== */}
            {/* EXECUTIVE KPI STAT METRICS GRID (5 CARDS)                           */}
            {/* =================================================================== */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              {/* Card 1: Attendance Rate */}
              <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Attendance Rate</span>
                    <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <IconCheckCircle size={15} />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-slate-900 font-mono tabular-nums">
                    {dashboardChartData?.attendanceRate || 0}%
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {dashboardChartData?.presentCount || 0} of {dashboardChartData?.workingDaysCount || 0} working days
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, dashboardChartData?.attendanceRate || 0)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Card 2: Punctuality Index */}
              <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Punctuality Score</span>
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <IconAward size={15} />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-indigo-700 font-mono tabular-nums">
                    {dashboardChartData?.punctualityScore || 0}%
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {dashboardChartData?.onTimeCount || 0} On-time • {dashboardChartData?.lateCount || 0} Late
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, dashboardChartData?.punctualityScore || 0)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Card 3: Total Logged Work Hours */}
              <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Work Hours</span>
                    <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                      <IconTrending size={15} />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-purple-700 font-mono tabular-nums">
                    {dashboardChartData?.totalWorkHoursLogged || 0}h
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Avg {dashboardChartData?.avgDailyHours || 0}h/day • {dashboardChartData?.totalOtHoursLogged || 0}h OT
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, ((dashboardChartData?.totalWorkHoursLogged || 0) / 180) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Card 4: Leave Balance */}
              <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Leave Balance</span>
                    <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                      <IconLeave size={15} />
                    </div>
                  </div>
                  <div className="text-2xl font-black text-amber-600 font-mono tabular-nums">
                    {leaveBalances.casual.remaining + leaveBalances.sick.remaining + leaveBalances.annual.remaining}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    C: {leaveBalances.casual.remaining} · S: {leaveBalances.sick.remaining} · A: {leaveBalances.annual.remaining}
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setActiveTab('leave')}
                    className="text-[11px] font-bold text-amber-600 hover:text-amber-800 flex items-center space-x-1 cursor-pointer"
                  >
                    <span>Apply Leave</span>
                    <IconChevronRight size={12} />
                  </button>
                </div>
              </div>

              {/* Card 5: Monthly Net Salary Status */}
              <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between col-span-2 lg:col-span-1">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Monthly Salary</span>
                    <div className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                      <IconWallet size={15} />
                    </div>
                  </div>
                  {isMonthEndPayrollPublished ? (
                    <>
                      <div className="text-2xl font-black text-indigo-700 font-mono tabular-nums">
                        ৳ {netSalary.toLocaleString()}
                      </div>
                      <div className="text-[11px] font-bold text-emerald-600 mt-0.5">
                        ✅ Generated ({formatMonthLabel(selectedMonth)})
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-lg font-black text-slate-800 font-mono tabular-nums">
                        ৳ {netSalary.toLocaleString()}
                      </div>
                      <div className="text-[11px] font-bold text-amber-600 mt-0.5">
                        🔒 On {currentRunningMonthUnlockInfo.unlockShortLabel}
                      </div>
                    </>
                  )}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setActiveTab('payslips')}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1 cursor-pointer"
                  >
                    <span>Payslip Details</span>
                    <IconChevronRight size={12} />
                  </button>
                </div>
              </div>
            </div>

            {/* =================================================================== */}
            {/* INTERACTIVE CHARTS & VISUAL ANALYTICS HUB                           */}
            {/* Features: 1. Pie/Donut Chart, 2. Line Chart, 3. Bar Chart            */}
            {/* =================================================================== */}
            <div className="space-y-4">
              {/* Header with Period Switcher */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white px-4 py-3 rounded-2xl border border-slate-200/90 shadow-2xs">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center space-x-2">
                    <IconActivity size={17} className="text-indigo-600" />
                    <span>Attendance &amp; Performance Visual Analytics</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Interactive Pie Chart, Line Trend Chart, and Working Hours Bar Chart
                  </p>
                </div>

                {/* Period Selector Tabs */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setDashboardChartPeriod('this_month')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      dashboardChartPeriod === 'this_month'
                        ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    This Month ({formatMonthLabel(currentRunningMonth)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDashboardChartPeriod('last_month')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      dashboardChartPeriod === 'last_month'
                        ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Last Month
                  </button>
                  <button
                    type="button"
                    onClick={() => setDashboardChartPeriod('last_14_days')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                      dashboardChartPeriod === 'last_14_days'
                        ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Last 14 Days
                  </button>
                </div>
              </div>

              {/* 1. INTERACTIVE PIE / DONUT CHART: Attendance Composition */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-6 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center space-x-1.5">
                      <span>🥧</span>
                      <span>Attendance Composition (Pie Chart)</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Breakdown across presence, leave, and off-days
                    </p>
                  </div>
                  <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100 self-start sm:self-auto">
                    {dashboardChartData?.pieTotal || 0} Total Days Tracked
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                  {/* Left: Donut Chart SVG Container */}
                  <div className="md:col-span-5 flex flex-col items-center justify-center">
                    <div className="w-56 h-56 sm:w-64 sm:h-64 relative flex items-center justify-center">
                      <svg className="w-full h-full transform -rotate-90 overflow-visible" viewBox="0 0 300 300">
                        {dashboardChartData?.donutPaths.map((slice, idx) => {
                          const isHovered = hoveredDonutIdx === idx;
                          return (
                            <path
                              key={slice.id}
                              d={describeDonutArc(150, 150, 80, isHovered ? 126 : 118, slice.startAngle, slice.endAngle)}
                              fill={slice.color}
                              className="transition-all duration-300 cursor-pointer"
                              style={{
                                filter: isHovered ? 'drop-shadow(0 4px 10px rgba(0,0,0,0.25))' : 'none',
                                opacity: hoveredDonutIdx === null || isHovered ? 1 : 0.45,
                              }}
                              onMouseEnter={() => setHoveredDonutIdx(idx)}
                              onMouseLeave={() => setHoveredDonutIdx(null)}
                            />
                          );
                        })}
                      </svg>

                      {/* Interactive Center Badge */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-3">
                        {hoveredDonutIdx !== null && dashboardChartData?.donutPaths[hoveredDonutIdx] ? (
                          <div className="max-w-[130px] flex flex-col items-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate w-full" title={dashboardChartData.donutPaths[hoveredDonutIdx].label}>
                              {dashboardChartData.donutPaths[hoveredDonutIdx].label}
                            </span>
                            <span
                              className="text-2xl font-black font-mono leading-tight my-0.5"
                              style={{ color: dashboardChartData.donutPaths[hoveredDonutIdx].color }}
                            >
                              {dashboardChartData.donutPaths[hoveredDonutIdx].count} Days
                            </span>
                            <span className="text-xs font-bold text-slate-500 font-mono">
                              {dashboardChartData.donutPaths[hoveredDonutIdx].percentage}% of total
                            </span>
                          </div>
                        ) : (
                          <div className="max-w-[130px] flex flex-col items-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Attendance Score
                            </span>
                            <span className="text-3xl font-black text-slate-900 font-mono leading-tight my-0.5">
                              {dashboardChartData?.attendanceRate || 0}%
                            </span>
                            <span className="text-[11px] font-semibold text-emerald-600">
                              {dashboardChartData?.presentCount || 0} Present Days
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-400 mt-2">
                      Hover over any slice for details
                    </span>
                  </div>

                  {/* Right: Detailed Composition Breakdown */}
                  <div className="md:col-span-7 space-y-2">
                    {dashboardChartData?.donutPaths.map((slice, idx) => {
                      const isHovered = hoveredDonutIdx === idx;
                      return (
                        <div
                          key={slice.id}
                          onMouseEnter={() => setHoveredDonutIdx(idx)}
                          onMouseLeave={() => setHoveredDonutIdx(null)}
                          title={slice.label}
                          className={`flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer border ${
                            isHovered
                              ? 'bg-slate-900 text-white border-slate-900 shadow-md scale-[1.01]'
                              : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200/70'
                          }`}
                        >
                          <div className="flex items-center space-x-3 min-w-0 mr-2">
                            <span className="w-3.5 h-3.5 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: slice.color }} />
                            <span className={`text-xs sm:text-sm font-bold truncate ${isHovered ? 'text-white' : 'text-slate-800'}`}>
                              {slice.label}
                            </span>
                          </div>
                          <div className="flex items-center space-x-3 font-mono text-xs tabular-nums shrink-0">
                            <span className={`font-black text-sm ${isHovered ? 'text-white' : 'text-slate-900'}`}>
                              {slice.count} <span className="text-[11px] font-normal opacity-75">days</span>
                            </span>
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-md font-bold min-w-[50px] text-center ${
                                isHovered ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200'
                              }`}
                            >
                              {slice.percentage}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ------------------------------------------------------------- */}
              {/* 3. INTERACTIVE BAR CHART: Working Hours & Overtime Breakdown  */}
              {/* ------------------------------------------------------------- */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 tracking-tight flex items-center space-x-1.5">
                      <span>📊</span>
                      <span>Daily Work &amp; Overtime Log (Bar Chart)</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Comparative view of daily logged duty hours and overtime earnings
                    </p>
                  </div>

                  {/* Bar Chart Header Metric Switcher */}
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold self-start sm:self-auto shrink-0">
                    <button
                      type="button"
                      onClick={() => setBarChartMetric('work_hours')}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        barChartMetric === 'work_hours'
                          ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Working Hours (Daily)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBarChartMetric('overtime')}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        barChartMetric === 'overtime'
                          ? 'bg-white text-emerald-700 shadow-2xs font-extrabold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Overtime (OT Hours: {dashboardChartData?.totalOtHoursLogged || 0}h)
                    </button>
                  </div>
                </div>

                {/* SVG Bar Chart Render */}
                {(() => {
                  const points = dashboardChartData?.dailyPoints || [];
                  const maxVal = Math.max(
                    barChartMetric === 'work_hours' ? 10 : 4,
                    ...points.map(p => (barChartMetric === 'work_hours' ? p.workHours : p.otHours))
                  ) + 1;
                  const barPadLeft = 48;
                  const barPadRight = 24;
                  const barPadBottom = 42;
                  const barPadTop = 32;
                  const barSvgW = 760;
                  const barSvgH = 250;
                  const barInnerW = barSvgW - barPadLeft - barPadRight;
                  const barInnerH = barSvgH - barPadTop - barPadBottom;
                  const slotW = points.length > 0 ? barInnerW / points.length : barInnerW;
                  const barW = Math.max(8, Math.min(24, slotW * 0.65));

                  return (
                    <div className="relative overflow-x-auto thin-scroll pt-2">
                      <div className="min-w-[550px] relative pt-2">
                        {/* Stably Anchored Tooltip (Never Jumps or Vibrates) */}
                        {hoveredBarIdx !== null && points[hoveredBarIdx] && (
                          <div
                            className="absolute pointer-events-none z-30 px-3 py-2 bg-slate-900/95 backdrop-blur-md text-white rounded-xl shadow-2xl border border-slate-700/80 text-[11px] font-sans whitespace-nowrap transition-none"
                            style={{
                              left: `${((barPadLeft + hoveredBarIdx * slotW + slotW / 2) / barSvgW) * 100}%`,
                              top: '8px',
                              transform:
                                barPadLeft + hoveredBarIdx * slotW > barSvgW - 140
                                  ? 'translateX(-95%)'
                                  : barPadLeft + hoveredBarIdx * slotW < 140
                                  ? 'translateX(-5%)'
                                  : 'translateX(-50%)',
                            }}
                          >
                            <div className="font-bold border-b border-slate-700/60 pb-1 flex items-center space-x-1.5">
                              <span className="text-white">{points[hoveredBarIdx].dateStr}</span>
                              <span className="text-indigo-300">({points[hoveredBarIdx].dayShort})</span>
                            </div>
                            <div className="font-mono text-emerald-400 font-bold mt-1">
                              {barChartMetric === 'work_hours'
                                ? `Work Hours: ${points[hoveredBarIdx].workHours.toFixed(1)} hrs`
                                : `OT Hours: ${points[hoveredBarIdx].otHours.toFixed(1)} hrs`}
                            </div>
                            {points[hoveredBarIdx].checkIn && (
                              <div className="text-slate-300 text-[10px] font-mono mt-0.5">
                                In: {formatTo12Hour(points[hoveredBarIdx].checkIn)} · Out: {formatTo12Hour(points[hoveredBarIdx].checkOut || '-')}
                              </div>
                            )}
                          </div>
                        )}

                        <svg
                          className="w-full h-50 sm:h-58 overflow-visible"
                          viewBox={`0 0 ${barSvgW} ${barSvgH}`}
                          onMouseLeave={() => setHoveredBarIdx(null)}
                        >
                          <defs>
                            <linearGradient id="workBarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stopColor="#6366F1" />
                              <stop offset="100%" stopColor="#4338CA" />
                            </linearGradient>
                            <linearGradient id="otBarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stopColor="#10B981" />
                              <stop offset="100%" stopColor="#047857" />
                            </linearGradient>
                            <linearGradient id="highWorkGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stopColor="#06B6D4" />
                              <stop offset="100%" stopColor="#0891B2" />
                            </linearGradient>
                          </defs>

                          {/* Horizontal Grid lines with Y-axis text */}
                          {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
                            const y = barSvgH - barPadBottom - f * barInnerH;
                            const valLabel = Math.round(f * maxVal);
                            return (
                              <g key={i}>
                                <line
                                  x1={barPadLeft}
                                  y1={y}
                                  x2={barSvgW - barPadRight}
                                  y2={y}
                                  stroke="#F1F5F9"
                                  strokeWidth="1"
                                  strokeDasharray={f === 0 ? 'none' : '3,3'}
                                />
                                <text
                                  x={barPadLeft - 8}
                                  y={y + 4}
                                  textAnchor="end"
                                  fill="#94A3B8"
                                  fontSize="10"
                                  fontFamily="monospace"
                                >
                                  {valLabel}h
                                </text>
                              </g>
                            );
                          })}

                          {/* Active column background highlight */}
                          {hoveredBarIdx !== null && (
                            <rect
                              x={barPadLeft + hoveredBarIdx * slotW}
                              y={barPadTop}
                              width={slotW}
                              height={barInnerH}
                              fill="#6366F1"
                              fillOpacity="0.07"
                              rx="6"
                              className="pointer-events-none"
                            />
                          )}

                          {/* Bars */}
                          {points.map((p, idx) => {
                            const val = barChartMetric === 'work_hours' ? p.workHours : p.otHours;
                            const h = (val / maxVal) * barInnerH;
                            const x = barPadLeft + idx * slotW + (slotW - barW) / 2;
                            const y = barSvgH - barPadBottom - h;
                            const isHovered = hoveredBarIdx === idx;
                            const shouldShowLabel =
                              points.length <= 15 ||
                              idx % 2 === 0 ||
                              idx === points.length - 1;

                            const fillGrad =
                              barChartMetric === 'overtime'
                                ? 'url(#otBarGrad)'
                                : val >= (dashboardChartData?.standardHours || 8)
                                ? 'url(#workBarGrad)'
                                : 'url(#highWorkGrad)';

                            return (
                              <g key={idx} className="pointer-events-none">
                                {val > 0 ? (
                                  <>
                                    <rect
                                      x={x}
                                      y={y}
                                      width={barW}
                                      height={Math.max(3, h)}
                                      rx="4"
                                      ry="4"
                                      fill={fillGrad}
                                      opacity={hoveredBarIdx === null || isHovered ? 1 : 0.45}
                                      className="transition-all duration-200"
                                    />
                                    {isHovered && (
                                      <text
                                        x={x + barW / 2}
                                        y={Math.max(16, y - 6)}
                                        textAnchor="middle"
                                        fill="#1E293B"
                                        fontSize="10"
                                        fontWeight="bold"
                                        fontFamily="monospace"
                                      >
                                        {val.toFixed(1)}h
                                      </text>
                                    )}
                                  </>
                                ) : (
                                  <circle
                                    cx={x + barW / 2}
                                    cy={barSvgH - barPadBottom - 2}
                                    r="2.5"
                                    fill={p.isOff ? '#CBD5E1' : '#E2E8F0'}
                                  />
                                )}

                                {/* X-axis Day number and day name labels */}
                                {shouldShowLabel && (
                                  <g>
                                    <text
                                      x={x + barW / 2}
                                      y={barSvgH - 22}
                                      textAnchor="middle"
                                      fill={isHovered ? '#4F46E5' : p.isToday ? '#4338CA' : '#475569'}
                                      fontSize="10"
                                      fontFamily="monospace"
                                      fontWeight={isHovered || p.isToday ? 'bold' : '600'}
                                    >
                                      {p.dayNum}
                                    </text>
                                    <text
                                      x={x + barW / 2}
                                      y={barSvgH - 9}
                                      textAnchor="middle"
                                      fill={isHovered ? '#6366F1' : p.isToday ? '#6366F1' : '#94A3B8'}
                                      fontSize="9"
                                      fontFamily="sans-serif"
                                    >
                                      {p.dayShort}
                                    </text>
                                  </g>
                                )}
                              </g>
                            );
                          })}

                          {/* Continuous full-height hit zones across all bar columns */}
                          {points.map((p, idx) => (
                            <rect
                              key={`bar-hit-${idx}`}
                              x={barPadLeft + idx * slotW}
                              y={0}
                              width={slotW}
                              height={barSvgH}
                              fill="transparent"
                              className="cursor-pointer"
                              onMouseEnter={() => setHoveredBarIdx(idx)}
                            />
                          ))}
                        </svg>
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between text-[11px] text-slate-500">
                  <span>
                    Hover over bars to view exact timestamps and status breakdown for each day
                  </span>
                  <span className="font-bold text-slate-700">
                    {barChartMetric === 'work_hours'
                      ? `Monthly Total: ${dashboardChartData?.totalWorkHoursLogged || 0} Hours`
                      : `Total Approved Overtime: ${dashboardChartData?.totalOtHoursLogged || 0} Hours`}
                  </span>
                </div>
              </div>
            </div>

            {/* =================================================================== */}
            {/* UPCOMING COMPANY HOLIDAYS & HR MESSAGES DUAL WIDGET                 */}
            {/* =================================================================== */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Widget 1: Upcoming Holidays & Special Off-Days */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-900 tracking-tight flex items-center space-x-1.5">
                    <span>🎉</span>
                    <span>Upcoming Company Holidays &amp; Off-Days</span>
                  </h4>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100">
                    {upcomingHolidays.length} Ahead
                  </span>
                </div>

                {upcomingHolidays.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-xs">
                    <span className="text-2xl block mb-1">🏖️</span>
                    No upcoming declared company holidays in the active calendar.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {upcomingHolidays.map(h => {
                      const isSkeletonDuty =
                        Array.isArray(h.dutyEmployeeIds) &&
                        (h.dutyEmployeeIds.includes(currentEmployee.id) || h.dutyEmployeeIds.includes(currentEmployee.employeeId));
                      return (
                        <div
                          key={h.id}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/70 hover:bg-slate-100/70 transition-colors"
                        >
                          <div className="flex items-center space-x-2.5 min-w-0">
                            <span className="text-xl shrink-0">
                              {h.type === 'religious' ? '🌙' : h.type === 'festival' ? '🎊' : '🏛️'}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-800 truncate">{h.title}</div>
                              <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                                {h.startDate} {h.endDate !== h.startDate ? `to ${h.endDate}` : ''}
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            {isSkeletonDuty ? (
                              <span className="px-2 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold">
                                ⚠️ Duty Scheduled
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-900 text-[10px] font-bold">
                                🏖️ Full Office Off
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Widget 2: Recent HR Announcements & Chat Preview */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-900 tracking-tight flex items-center space-x-1.5">
                    <span>📢</span>
                    <span>HR Announcements &amp; Messages</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => setActiveTab('messages')}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-0.5 cursor-pointer"
                  >
                    <span>View All</span>
                    <IconChevronRight size={13} />
                  </button>
                </div>

                {myMessages.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-xs">
                    <span className="text-2xl block mb-1">💬</span>
                    No recent messages from HR administration.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto thin-scroll">
                    {myMessages.slice(-3).reverse().map(m => (
                      <div
                        key={m.id}
                        onClick={() => setActiveTab('messages')}
                        className="p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-bold text-slate-800 truncate">{m.subject}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{m.time}</span>
                        </div>
                        <p className="text-xs text-slate-500 truncate">{m.content || m.preview}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 2: CAMERA ATTENDANCE CHECK-IN                                       */}
        {/* ======================================================================= */}
        {activeTab === 'checkin' && (
          <div className="space-y-4 animate-fade-in">
            <EmployeeCheckIn />
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 3: MY ATTENDANCE LOG                                                */}
        {/* ======================================================================= */}
        {activeTab === 'attendance' && (
          <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* Header & Month Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">My Attendance History</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Daily biometric and web check-in logs, working hours, and overtime records
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <label className="text-xs font-bold text-slate-600">Month:</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800"
                />
              </div>
            </div>

            {/* Monthly KPI Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-center shadow-xs">
                <span className="text-[11px] text-slate-400 block uppercase font-bold">Present</span>
                <span className="text-xl sm:text-2xl font-black text-emerald-600">{monthlyStats.presentCount}</span>
              </div>
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-center shadow-xs">
                <span className="text-[11px] text-slate-400 block uppercase font-bold">Late</span>
                <span className="text-xl sm:text-2xl font-black text-amber-600">{monthlyStats.lateCount}</span>
              </div>
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-center shadow-xs">
                <span className="text-[11px] text-slate-400 block uppercase font-bold">Absent</span>
                <span className="text-xl sm:text-2xl font-black text-rose-600">{monthlyStats.absentCount}</span>
              </div>
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-center shadow-xs">
                <span className="text-[11px] text-slate-400 block uppercase font-bold">Overtime</span>
                <span className="text-xl sm:text-2xl font-black text-indigo-600">{monthlyStats.otTotal}h</span>
              </div>
            </div>

            {/* Attendance Table */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-xs sm:text-sm min-w-[650px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">First In</th>
                      <th className="px-4 py-3 text-left">Last Out</th>
                      <th className="px-4 py-3 text-left">Work Hours</th>
                      <th className="px-4 py-3 text-left">Overtime</th>
                      <th className="px-4 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthlyAttendanceRecords.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-400">
                          <span className="text-3xl block mb-1">📅</span>
                          No attendance records found for {selectedMonth}
                        </td>
                      </tr>
                    ) : (
                      monthlyAttendanceRecords.map((rec, i) => (
                        <tr key={rec.id || i} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-semibold text-slate-900">{rec.date}</td>
                          <td className="px-4 py-3 font-mono text-emerald-700 font-bold">{formatTo12Hour(rec.checkIn)}</td>
                          <td className="px-4 py-3 font-mono text-indigo-700 font-bold">{formatTo12Hour(rec.checkOut)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-700">
                            {rec.totalHours && Number(rec.totalHours) > 0 ? (
                              <span className="font-mono font-bold bg-slate-100 text-slate-800 px-2 py-0.5 rounded-lg border border-slate-200">
                                {Number(rec.totalHours).toFixed(1)}h
                              </span>
                            ) : rec.checkIn && rec.checkIn !== '-' && (!rec.checkOut || rec.checkOut === '-') ? (
                              <span className="text-amber-600 font-semibold text-[11px]">In Progress</span>
                            ) : (
                              <span className="text-slate-300 font-mono">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-600">
                            {rec.otHours ? `${rec.otHours} hrs` : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                                rec.status === 'present'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : rec.status === 'late'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {rec.status || 'present'}
                            </span>
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

        {/* ======================================================================= */}
        {/* TAB: LATE ATTENDANCE & EARLY CHECKOUT REQUESTS                         */}
        {/* ======================================================================= */}
        {activeTab === 'requests' && (
          <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* Header & Policy Explanation */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center space-x-2">
                    <span>📝</span>
                    <span>Late Attendance Waiver &amp; Early Checkout Requests</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Submit a formal request with a valid explanation. If Admin approves your late arrival waiver, the 3-day late attendance salary deduction penalty is waived!
                  </p>
                </div>
              </div>

              {/* Policy Callout Banner */}
              <div className="p-3.5 bg-purple-50/70 border border-purple-200/80 rounded-xl text-xs space-y-1 text-purple-950">
                <p className="font-bold flex items-center space-x-1.5">
                  <span>ℹ️</span>
                  <span>Company Attendance Penalty &amp; Salary Waiver Rule:</span>
                </p>
                <p className="text-slate-600 pl-5">
                  • 3 unexcused late arrivals in a month automatically result in a 1-day basic salary deduction.
                </p>
                <p className="text-emerald-700 font-semibold pl-5">
                  • By submitting this request with a valid reason (e.g., severe traffic, transit failure, medical emergency), an approved request waives the penalty and prevents your salary from being cut.
                </p>
              </div>
            </div>

            {/* Request Submission Form */}
            <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-xs border border-slate-200">
              <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center space-x-2">
                <span>➕</span>
                <span>Submit New Attendance Waiver / Checkout Request</span>
              </h3>

              {attRequestSuccessMsg && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold">
                  ✅ {attRequestSuccessMsg}
                </div>
              )}

              <form onSubmit={handleAttendanceRequestSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Request Category</label>
                    <select
                      value={attRequestForm.type}
                      onChange={e => setAttRequestForm({ ...attRequestForm, type: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
                    >
                      <option value="late_arrival">Late Arrival Waiver (Waive 3-Day Penalty)</option>
                      <option value="early_checkout">Early Checkout Permission</option>
                      <option value="missing_punch">Missing Punch Correction / Regularization</option>
                      <option value="overtime">Overtime Approval Request</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Date of Occurrence</label>
                    <input
                      type="date"
                      value={attRequestForm.date}
                      onChange={e => setAttRequestForm({ ...attRequestForm, date: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {attRequestForm.type === 'late_arrival'
                        ? 'Arrival / Check-in Time'
                        : attRequestForm.type === 'missing_punch'
                        ? 'Actual Check-in Time'
                        : attRequestForm.type === 'overtime'
                        ? 'Overtime Hours Claimed'
                        : 'Checkout Departure Time'}
                    </label>
                    {attRequestForm.type === 'overtime' ? (
                      <input
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={attRequestForm.otHours}
                        onChange={e => setAttRequestForm({ ...attRequestForm, otHours: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        required
                      />
                    ) : (
                      <input
                        type="time"
                        value={attRequestForm.actualTime}
                        onChange={e => setAttRequestForm({ ...attRequestForm, actualTime: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        required
                      />
                    )}
                  </div>
                </div>

                {attRequestForm.type === 'missing_punch' && (
                  <div className="max-w-xs">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Actual Check-out Time
                    </label>
                    <input
                      type="time"
                      value={attRequestForm.checkOutTime}
                      onChange={e => setAttRequestForm({ ...attRequestForm, checkOutTime: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Valid Explanation / Reason for Delay or Early Exit <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={attRequestForm.reason}
                    onChange={e => setAttRequestForm({ ...attRequestForm, reason: e.target.value })}
                    placeholder="Provide a specific and genuine explanation (e.g., Heavy rainstorm and traffic congestion, client site visit, metro rail mechanical failure, family emergency)..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    HR &amp; Management will review this justification before approving waiver status.
                  </p>
                </div>

                {/* Upload Supporting Application Document (Word .doc/.docx, PDF .pdf, or Image) */}
                <div className="p-4 bg-purple-50/50 border-2 border-dashed border-purple-200 rounded-2xl space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="block text-xs sm:text-sm font-extrabold text-purple-950 flex items-center space-x-1.5">
                        <span>📎</span>
                        <span>Upload Application / Supporting File (Word / PDF / Image)</span>
                      </label>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Upload formal application letter (Word .doc, .docx, or PDF) or supporting proof document here.
                      </p>
                    </div>
                    <label className="px-4 py-2 bg-white hover:bg-purple-100 text-purple-700 border border-purple-300 rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center space-x-1.5 shrink-0">
                      <span>📤 Choose Word / PDF File</span>
                      <input
                        ref={attFileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                        onChange={handleAttFileChange}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {attAttachmentError && (
                    <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
                      ⚠️ {attAttachmentError}
                    </div>
                  )}

                  {attAttachment && (
                    <div className="flex items-center justify-between p-3 bg-white border border-purple-200 rounded-xl shadow-2xs">
                      <div className="flex items-center space-x-3 min-w-0">
                        <span className="text-2xl shrink-0">
                          {attAttachment.name.toLowerCase().endsWith('.pdf')
                            ? '📕'
                            : attAttachment.name.toLowerCase().endsWith('.doc') || attAttachment.name.toLowerCase().endsWith('.docx')
                            ? '📘'
                            : '🖼️'}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{attAttachment.name}</p>
                          <p className="text-[10px] text-emerald-700 font-semibold">
                            ✅ Ready to upload • {(attAttachment.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAttAttachment(null);
                          if (attFileInputRef.current) attFileInputRef.current.value = '';
                        }}
                        className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-xs font-bold cursor-pointer shrink-0"
                      >
                        ✕ Remove
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmittingAttRequest}
                    className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
                  >
                    {isSubmittingAttRequest ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        <span>Submitting...</span>
                      </>
                    ) : (
                      <>
                        <span>🚀</span>
                        <span>Submit Attendance Request</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* My Request History Table */}
            <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-xs border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>📋</span>
                  <span>My Request History &amp; Approval Status</span>
                </h3>
                <span className="text-xs text-slate-400 font-medium">
                  {myAttendanceRequests.length} Total Requests
                </span>
              </div>

              {myAttendanceRequests.length === 0 ? (
                <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <span className="text-3xl block mb-2">📋</span>
                  <p className="text-xs font-bold text-slate-600">No attendance requests submitted yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    If you arrive late or depart early, submit a waiver request above.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px] tracking-wider">
                        <th className="pb-3 font-bold">Date</th>
                        <th className="pb-3 font-bold">Category</th>
                        <th className="pb-3 font-bold">Recorded Time</th>
                        <th className="pb-3 font-bold">Reason Provided</th>
                        <th className="pb-3 font-bold">Application File</th>
                        <th className="pb-3 font-bold">Status &amp; Salary Impact</th>
                        <th className="pb-3 font-bold text-right">Submitted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {myAttendanceRequests.map((req) => (
                        <tr key={req.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 font-bold text-slate-800 whitespace-nowrap">{req.date}</td>
                          <td className="py-3 whitespace-nowrap">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                req.type === 'late_arrival'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-indigo-100 text-indigo-800'
                              }`}
                            >
                              {req.type === 'late_arrival'
                                ? 'Late Arrival'
                                : req.type === 'missing_punch'
                                ? 'Missing Punch'
                                : req.type === 'overtime'
                                ? 'Overtime'
                                : 'Early Checkout'}
                            </span>
                          </td>
                          <td className="py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                            {req.actualTime || 'N/A'}
                          </td>
                          <td className="py-3 text-slate-600 max-w-xs break-words">{req.reason}</td>
                          <td className="py-3 whitespace-nowrap">
                            {req.attachmentDataUrl && req.attachmentName ? (
                              <a
                                href={req.attachmentDataUrl}
                                download={req.attachmentName}
                                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[11px] font-bold inline-flex items-center space-x-1"
                              >
                                <span>📎</span>
                                <span className="max-w-[110px] truncate">{req.attachmentName}</span>
                              </a>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">No file</span>
                            )}
                          </td>
                          <td className="py-3 whitespace-nowrap">
                            {req.status === 'approved' ? (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-[11px] font-bold">
                                <span>✅ Approved</span>
                                {req.type === 'late_arrival' && (
                                  <span className="text-[10px] text-emerald-700 font-semibold">• Waived</span>
                                )}
                              </span>
                            ) : req.status === 'rejected' ? (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-rose-100 text-rose-800 rounded-lg text-[11px] font-bold">
                                <span>❌ Rejected</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-lg text-[11px] font-bold">
                                <span>⏳ Pending Review</span>
                              </span>
                            )}
                            {req.reviewedBy && (
                              <p className="text-[10px] text-slate-400 mt-0.5">by {req.reviewedBy}</p>
                            )}
                          </td>
                          <td className="py-3 text-right text-slate-400 text-[11px] whitespace-nowrap">
                            {req.appliedOn ? new Date(req.appliedOn).toLocaleDateString() : 'N/A'}
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

        {/* ======================================================================= */}
        {/* TAB 4: LEAVE MANAGEMENT                                                 */}
        {/* ======================================================================= */}
        {activeTab === 'leave' && (
          <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* Leave Balance Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span className="font-bold">Casual Leave</span>
                  <span>🏖️</span>
                </div>
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-2xl font-black text-slate-900">{leaveBalances.casual.remaining}</span>
                  <span className="text-xs text-slate-400">of {leaveBalances.casual.total} days</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{leaveBalances.casual.used} days used</p>
              </div>

              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span className="font-bold">Sick Leave</span>
                  <span>🏥</span>
                </div>
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-2xl font-black text-slate-900">{leaveBalances.sick.remaining}</span>
                  <span className="text-xs text-slate-400">of {leaveBalances.sick.total} days</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{leaveBalances.sick.used} days used</p>
              </div>

              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span className="font-bold">Annual Leave</span>
                  <span>✈️</span>
                </div>
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-2xl font-black text-slate-900">{leaveBalances.annual.remaining}</span>
                  <span className="text-xs text-slate-400">of {leaveBalances.annual.total} days</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{leaveBalances.annual.used} days used</p>
              </div>
            </div>

            {/* Leave Request Form */}
            <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-xs border border-slate-200">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-4 flex items-center space-x-2">
                <span>📝</span>
                <span>Submit Leave of Absence Request</span>
              </h3>

              {leaveSuccessMsg && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold">
                  ✅ {leaveSuccessMsg}
                </div>
              )}

              <form onSubmit={handleLeaveSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Leave Category</label>
                    <select
                      value={leaveForm.type}
                      onChange={e => setLeaveForm({ ...leaveForm, type: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="Casual">Casual Leave ({leaveBalances.casual.remaining} left)</option>
                      <option value="Sick">Sick Leave ({leaveBalances.sick.remaining} left)</option>
                      <option value="Annual">Annual Leave ({leaveBalances.annual.remaining} left)</option>
                      <option value="Unpaid">Unpaid Leave</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">From Date</label>
                    <input
                      type="date"
                      value={leaveForm.from}
                      onChange={e => setLeaveForm({ ...leaveForm, from: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">To Date</label>
                    <input
                      type="date"
                      value={leaveForm.to}
                      onChange={e => setLeaveForm({ ...leaveForm, to: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="halfDay"
                    checked={leaveForm.isHalfDay}
                    onChange={e => setLeaveForm({ ...leaveForm, isHalfDay: e.target.checked })}
                    className="w-4 h-4 text-purple-600 rounded"
                  />
                  <label htmlFor="halfDay" className="text-xs font-semibold text-slate-700">
                    Apply for Half Day (0.5 day)
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Leave</label>
                  <textarea
                    rows={3}
                    placeholder="Provide detailed reason for your leave request..."
                    value={leaveForm.reason}
                    onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Emergency Contact Number (Optional)</label>
                  <input
                    type="tel"
                    placeholder="e.g. +880 1700-000000"
                    value={leaveForm.emergencyContact}
                    onChange={e => setLeaveForm({ ...leaveForm, emergencyContact: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                {/* Upload Leave Application Document (Word .doc/.docx, PDF .pdf, or Image) */}
                <div className="p-4 bg-purple-50/50 border-2 border-dashed border-purple-200 rounded-2xl space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="block text-xs sm:text-sm font-extrabold text-purple-950 flex items-center space-x-1.5">
                        <span>📎</span>
                        <span>Upload Leave Application / Medical / Supporting File (Word / PDF / Image)</span>
                      </label>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Upload leave application letter (Word .doc, .docx, or PDF) or medical paper here. HR Admin will review and verify before approval.
                      </p>
                    </div>
                    <label className="px-4 py-2 bg-white hover:bg-purple-100 text-purple-700 border border-purple-300 rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center space-x-1.5 shrink-0">
                      <span>📤 Choose Word / PDF File</span>
                      <input
                        ref={leaveFileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                        onChange={handleLeaveFileChange}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {leaveAttachmentError && (
                    <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
                      ⚠️ {leaveAttachmentError}
                    </div>
                  )}

                  {leaveAttachment && (
                    <div className="flex items-center justify-between p-3 bg-white border border-purple-200 rounded-xl shadow-2xs">
                      <div className="flex items-center space-x-3 min-w-0">
                        <span className="text-2xl shrink-0">
                          {leaveAttachment.name.toLowerCase().endsWith('.pdf')
                            ? '📕'
                            : leaveAttachment.name.toLowerCase().endsWith('.doc') || leaveAttachment.name.toLowerCase().endsWith('.docx')
                            ? '📘'
                            : '🖼️'}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{leaveAttachment.name}</p>
                          <p className="text-[10px] text-emerald-700 font-semibold">
                            ✅ Ready to upload • {(leaveAttachment.size / 1024).toFixed(1)} KB •{' '}
                            {leaveAttachment.name.toLowerCase().endsWith('.pdf')
                              ? 'PDF Document'
                              : leaveAttachment.name.toLowerCase().endsWith('.doc') || leaveAttachment.name.toLowerCase().endsWith('.docx')
                              ? 'Microsoft Word Document'
                              : 'Image Attachment'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLeaveAttachment(null);
                          if (leaveFileInputRef.current) leaveFileInputRef.current.value = '';
                        }}
                        className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-xs font-bold cursor-pointer shrink-0"
                      >
                        ✕ Remove
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all cursor-pointer"
                >
                  Submit Leave Application 🚀
                </button>
              </form>
            </div>

            {/* Leave History Table */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-sm">My Past Leave Requests &amp; HR Verification</h3>
                <span className="text-xs text-slate-400 font-medium">{myLeaves.length} Applications</span>
              </div>
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-xs sm:text-sm min-w-[700px]">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left">Category</th>
                      <th className="px-4 py-3 text-left">Duration</th>
                      <th className="px-4 py-3 text-left">Days</th>
                      <th className="px-4 py-3 text-left">Reason</th>
                      <th className="px-4 py-3 text-left">Uploaded Application</th>
                      <th className="px-4 py-3 text-left">HR Justification / Remarks</th>
                      <th className="px-4 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {myLeaves.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          No leave requests recorded.
                        </td>
                      </tr>
                    ) : (
                      myLeaves.map(l => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-semibold text-slate-800">{l.type} Leave</td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{l.from} to {l.to}</td>
                          <td className="px-4 py-3 font-bold text-slate-800">{l.days}</td>
                          <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={l.reason}>{l.reason}</td>
                          <td className="px-4 py-3">
                            {l.attachmentDataUrl && l.attachmentName ? (
                              <div className="flex items-center space-x-1.5">
                                <button
                                  type="button"
                                  onClick={() => setPreviewLeaveAttachment(l)}
                                  className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[11px] font-bold inline-flex items-center space-x-1 cursor-pointer"
                                >
                                  <span>
                                    {l.attachmentName.toLowerCase().endsWith('.pdf')
                                      ? '📕'
                                      : l.attachmentName.toLowerCase().endsWith('.doc') || l.attachmentName.toLowerCase().endsWith('.docx')
                                      ? '📘'
                                      : '📎'}
                                  </span>
                                  <span className="max-w-[110px] truncate">{l.attachmentName}</span>
                                </button>
                                <a
                                  href={l.attachmentDataUrl}
                                  download={l.attachmentName}
                                  className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold"
                                  title="Download attached file"
                                >
                                  ⬇️
                                </a>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">No file</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {l.adminRemarks ? (
                              <div>
                                <p className="font-semibold text-slate-800">{l.adminRemarks}</p>
                                {l.reviewedBy && (
                                  <span className="text-[10px] text-slate-400">By {l.reviewedBy}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">
                                {l.status === 'pending' ? 'Awaiting HR justification' : 'Verified by HR'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
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
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 5: PAYSLIPS & SALARY SLIP                                           */}
        {/* ======================================================================= */}
        {activeTab === 'payslips' && (
          <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* Header & Controls */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">My Salary &amp; Payslips</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Monthly salary is automatically calculated and unlocked on the <strong>1st day of the following month</strong>.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Quick Switch: Previous Completed Month vs Current Running Month */}
                <button
                  type="button"
                  onClick={() => {
                    setUserManuallyChangedSalaryMonth(true);
                    setSelectedMonth(prevCompletedMonth);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    selectedMonth === prevCompletedMonth
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  ✅ {formatMonthLabel(prevCompletedMonth)} (Unlocked)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserManuallyChangedSalaryMonth(true);
                    setSelectedMonth(currentRunningMonth);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    selectedMonth === currentRunningMonth
                      ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  ⏳ {formatMonthLabel(currentRunningMonth)} (Running)
                </button>

                <div className="flex items-center space-x-1.5">
                  <label className="text-xs font-bold text-slate-600">Month:</label>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={e => {
                      setUserManuallyChangedSalaryMonth(true);
                      setSelectedMonth(e.target.value);
                    }}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                  />
                </div>
                {isMonthEndPayrollPublished && (
                  <button
                    onClick={() => window.print()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer"
                  >
                    <span>🖨️</span>
                    <span>Print Payslip</span>
                  </button>
                )}
              </div>
            </div>

            {/* Check if Selected Month's 1st-of-Next-Month Generation Date Has Arrived */}
            {!isMonthEndPayrollPublished ? (
              <div className="bg-white rounded-3xl p-6 sm:p-10 border border-slate-200 shadow-xs text-center space-y-5">
                <div className="w-16 h-16 bg-amber-50 border border-amber-200 text-amber-600 rounded-3xl flex items-center justify-center text-3xl mx-auto shadow-xs">
                  🗓️
                </div>
                <div className="max-w-lg mx-auto space-y-2">
                  <span className="px-3.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold uppercase tracking-wider">
                    🔒 Generates on {selectedMonthUnlockInfo.unlockLabel}
                  </span>
                  <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 mt-2">
                    {formatMonthLabel(selectedMonth)} Salary Will Generate on {selectedMonthUnlockInfo.unlockLabel}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    <strong>{formatMonthLabel(selectedMonth)}</strong> is currently in progress. Upon completion of the working month, salary will be automatically generated and unlocked on <strong>{selectedMonthUnlockInfo.unlockLabel}</strong>.
                  </p>
                </div>

                {/* Running Month Work Progress Tracker (Does NOT reveal salary before 1st of next month) */}
                <div className="max-w-lg mx-auto grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Present So Far</span>
                    <span className="text-base font-black text-emerald-600">{monthAttendanceStats.presentDays} Days</span>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Late Arrivals</span>
                    <span className="text-base font-black text-amber-600">{monthAttendanceStats.totalLate} Days</span>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Late Waived</span>
                    <span className="text-base font-black text-indigo-600">{monthAttendanceStats.excusedLate} Days</span>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Overtime So Far</span>
                    <span className="text-base font-black text-purple-600">{monthAttendanceStats.autoOvertimeHours}h</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl max-w-lg mx-auto text-left text-xs space-y-2">
                  <p className="font-bold text-slate-700 flex items-center space-x-1.5">
                    <span>📌</span>
                    <span>Monthly Salary Generation &amp; Attendance Rules:</span>
                  </p>
                  <p className="text-slate-600 pl-5">
                    • <strong>1st of Month Rule:</strong> Whole month&apos;s salary (e.g., {formatMonthLabel(selectedMonth)}) automatically generates on <strong>{selectedMonthUnlockInfo.unlockLabel}</strong>.
                  </p>
                  <p className="text-slate-600 pl-5">
                    • <strong>Late Penalty:</strong> 3 unexcused late arrivals = 1 day salary cut.
                  </p>
                  <p className="text-emerald-700 font-medium pl-5">
                    • <strong>Waiver Requests:</strong> Submit any late arrival waiver request before <strong>{selectedMonthUnlockInfo.unlockLabel}</strong> so Admin approval waives your deduction!
                  </p>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUserManuallyChangedSalaryMonth(true);
                      setSelectedMonth(prevCompletedMonth);
                    }}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer inline-flex items-center space-x-2"
                  >
                    <span>📄</span>
                    <span>View Previous Completed Month Payslip ({formatMonthLabel(prevCompletedMonth)})</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Official Payslip Card */
              <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200 space-y-6 print:border-none print:shadow-none">
                {/* Payslip Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-200 gap-4">
                  <div className="flex items-center space-x-3">
                    {companyLogo && (
                      <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 p-1 flex items-center justify-center shrink-0 shadow-2xs">
                        <img src={companyLogo} alt={companyName} className="w-full h-full object-contain" />
                      </div>
                    )}
                    <div>
                      <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">{companyName}</h1>
                      <p className="text-xs text-slate-500">Official Monthly Employee Payslip</p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 font-mono text-xs font-bold rounded-full border border-emerald-200">
                      ✅ Generated on {selectedMonthUnlockInfo.unlockLabel}
                    </span>
                    <p className="text-xs font-semibold text-slate-600 mt-1">
                      Salary Month: {formatMonthLabel(selectedMonth)} ({selectedMonth})
                    </p>
                  </div>
                </div>

                {/* Employee Information in Payslip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-2xl text-xs">
                  <div>
                    <span className="text-slate-400 block font-semibold">Employee Name</span>
                    <span className="font-bold text-slate-900">{currentEmployee.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Employee Code</span>
                    <span className="font-bold font-mono text-purple-700">{currentEmployee.employeeId}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Department</span>
                    <span className="font-bold text-slate-900">{currentEmployee.department}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Designation</span>
                    <span className="font-bold text-slate-900">{currentEmployee.designation}</span>
                  </div>
                </div>

                {/* Attendance Summary Callout */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-purple-50/50 border border-purple-100 rounded-2xl text-xs">
                  <div>
                    <span className="text-slate-500 block">Total Late Days:</span>
                    <span className="font-bold text-slate-800">{monthAttendanceStats.totalLate} days</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Late Waived / Excused:</span>
                    <span className="font-bold text-emerald-700">{monthAttendanceStats.excusedLate} approved</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Unexcused Late:</span>
                    <span className="font-bold text-amber-700">{monthAttendanceStats.unexcusedLate} days</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Late Salary Penalty:</span>
                    <span className="font-bold text-rose-600">
                      {monthAttendanceStats.lateCut > 0 ? `৳ ${monthAttendanceStats.lateCut.toLocaleString()}` : '৳ 0 (Waived)'}
                    </span>
                  </div>
                </div>

                {/* Salary Breakdown Table */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Earnings */}
                  <div className="border border-slate-100 rounded-2xl p-4 space-y-3 bg-slate-50/40">
                    <h4 className="font-bold text-slate-900 text-xs sm:text-sm uppercase tracking-wider text-emerald-700">
                      (+) Earnings &amp; Allowances
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-600">Basic Salary</span>
                        <span className="font-bold text-slate-800">৳ {basicSalary.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-600">House Rent Allowance (HRA)</span>
                        <span className="font-bold text-slate-800">৳ {houseRent.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-600">Medical Allowance</span>
                        <span className="font-bold text-slate-800">৳ {medical.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-600">Conveyance Allowance</span>
                        <span className="font-bold text-slate-800">৳ {conveyance.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-600">Food Allowance</span>
                        <span className="font-bold text-slate-800">৳ {foodAllowance.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-emerald-700 font-semibold">Weekend Earning &amp; Allowances</span>
                        <span className="font-bold text-emerald-700">৳ {weekendAllowance.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-purple-700 font-semibold">Overtime Pay (1.5x Basic)</span>
                        <span className="font-bold text-purple-700">৳ {overtimeAmount.toLocaleString()}</span>
                      </div>
                      {(attendanceBonus > 0 || festivalBonus > 0) && (
                        <div className="flex justify-between py-1 border-b border-slate-100">
                          <span className="text-slate-600">Attendance &amp; Festival Bonus</span>
                          <span className="font-bold text-slate-800">৳ {(attendanceBonus + festivalBonus).toLocaleString()}</span>
                        </div>
                      )}
                      {(otherAllowance > 0 || Boolean(customEarningName)) && (
                        <div className="flex justify-between py-1 border-b border-slate-100">
                          <span className="text-indigo-700 font-semibold">{customEarningName || 'Other Allowance / Earning'}</span>
                          <span className="font-bold text-indigo-700">৳ {otherAllowance.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between pt-2 text-sm font-black text-slate-900 border-t border-slate-200">
                        <span>Total Gross Earnings</span>
                        <span className="text-emerald-700">৳ {totalGrossEarnings.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div className="border border-slate-100 rounded-2xl p-4 space-y-3 bg-slate-50/40">
                    <h4 className="font-bold text-slate-900 text-xs sm:text-sm uppercase tracking-wider text-rose-700">
                      (-) Deductions &amp; Penalties
                    </h4>
                    {totalDeductions > 0 ? (
                      <div className="space-y-2 text-xs">
                        {providentFund > 0 && (
                          <div className="flex justify-between py-1 border-b border-slate-100">
                            <span className="text-slate-600">Provident Fund (PF)</span>
                            <span className="font-bold text-slate-800">৳ {providentFund.toLocaleString()}</span>
                          </div>
                        )}
                        {taxDeduction > 0 && (
                          <div className="flex justify-between py-1 border-b border-slate-100">
                            <span className="text-slate-600">Tax Deducted (TDS)</span>
                            <span className="font-bold text-slate-800">৳ {taxDeduction.toLocaleString()}</span>
                          </div>
                        )}
                        {(monthAttendanceStats.absentCut || 0) > 0 && (
                          <div className="flex justify-between py-1 border-b border-slate-100">
                            <span className="text-slate-600">
                              Absent Days Deduction ({monthAttendanceStats.absentDays} days)
                            </span>
                            <span className="font-bold text-rose-600">৳ {(monthAttendanceStats.absentCut || 0).toLocaleString()}</span>
                          </div>
                        )}
                        {monthAttendanceStats.lateCut > 0 && (
                          <div className="flex justify-between py-1 border-b border-slate-100">
                            <span className="text-slate-600">
                              Late Attendance Penalty ({monthAttendanceStats.latePenaltyDays} day basic cut)
                            </span>
                            <span className="font-bold text-rose-600">৳ {monthAttendanceStats.lateCut.toLocaleString()}</span>
                          </div>
                        )}
                        {monthAttendanceStats.excusedLate > 0 && monthAttendanceStats.lateCut === 0 && (
                          <div className="flex justify-between py-1 border-b border-slate-100">
                            <span className="text-slate-600">Late Attendance Penalty</span>
                            <span className="font-bold text-emerald-700">৳ 0 (Excused by Admin)</span>
                          </div>
                        )}
                        {(advanceDeduction > 0 || loanDeduction > 0) && (
                          <div className="flex justify-between py-1 border-b border-slate-100">
                            <span className="text-slate-600">Advance / Loan Deduction</span>
                            <span className="font-bold text-rose-600">৳ {(advanceDeduction + loanDeduction).toLocaleString()}</span>
                          </div>
                        )}
                        {(otherDeduction > 0 || Boolean(customDeductionName)) && (
                          <div className="flex justify-between py-1 border-b border-slate-100">
                            <span className="text-rose-700 font-semibold">{customDeductionName || 'Other Deduction'}</span>
                            <span className="font-bold text-rose-600">৳ {otherDeduction.toLocaleString()}</span>
                          </div>
                        )}
                        <div className="flex justify-between pt-2 text-sm font-black text-slate-900 border-t border-slate-200">
                          <span>Total Deductions</span>
                          <span className="text-rose-600">৳ {totalDeductions.toLocaleString()}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-2 space-y-2 text-xs">
                        <p className="text-xs text-slate-400 italic">
                          No deductions or attendance penalties applied for this month.
                        </p>
                        <div className="flex justify-between pt-2 text-sm font-black text-slate-900 border-t border-slate-200">
                          <span>Total Deductions</span>
                          <span className="text-slate-500 font-mono">৳ 0</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Net Pay Box */}
                <div className="p-5 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs uppercase font-bold text-purple-900 block">Net Payable Amount</span>
                    <span className="text-xs text-purple-700">Official verified take-home salary</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-purple-900">
                    ৳ {netSalary.toLocaleString()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 6: SHIFT & DUTY ROSTER                                              */}
        {/* ======================================================================= */}
        {activeTab === 'roster' && (
          <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* Shift Specification */}
            <div className="bg-white rounded-3xl p-6 shadow-xs border border-slate-200 space-y-4">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center space-x-2">
                <span>⏱️</span>
                <span>My Standard Shift Schedule</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block font-semibold">Shift Name</span>
                  <span className="font-bold text-slate-900">{assignedShift?.name || currentEmployee.shift || 'General Shift'}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block font-semibold">Timing</span>
                  <span className="font-bold text-slate-900">{assignedShift?.startTime || '09:00'} - {assignedShift?.endTime || '18:00'}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block font-semibold">Break Allowance</span>
                  <span className="font-bold text-slate-900">{assignedShift?.breakTime || 60} minutes</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block font-semibold">Late Grace Time</span>
                  <span className="font-bold text-slate-900">{assignedShift?.graceTime || 15} minutes</span>
                </div>
              </div>
            </div>

            {/* Duty Roster List */}
            <div className="bg-white rounded-3xl shadow-xs border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h3 className="font-bold text-slate-900 text-sm">Monthly Scheduled Duty Calendar</h3>
              </div>
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-xs sm:text-sm min-w-[500px]">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Assigned Shift</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {myRoster.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400">
                          Standard weekly schedule (Monday - Friday on duty, Saturday - Sunday off).
                        </td>
                      </tr>
                    ) : (
                      myRoster.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-semibold text-slate-900">{r.date}</td>
                          <td className="px-4 py-3 text-slate-700">{r.shift}</td>
                          <td className="px-4 py-3">
                            {r.isOffDay ? (
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">
                                Weekly Off
                              </span>
                            ) : r.isExtraDay ? (
                              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold">
                                Overtime Shift
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">
                                Regular Duty
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-600">Active</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 7: MESSAGES & CHAT WITH HR                                          */}
        {/* ======================================================================= */}
        {activeTab === 'messages' && (
          <div className="space-y-4 animate-fade-in">
            {/* Top Bar with Compose toggle */}
            <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Chat with HR &amp; Announcements</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Direct two-way real-time communication with HR administration
                </p>
              </div>
              <button
                onClick={() => setIsComposingNewChat(!isComposingNewChat)}
                className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs"
              >
                <span>{isComposingNewChat ? '✕ Close' : '✉️ + New Message'}</span>
              </button>
            </div>

            {/* Compose New Message Form */}
            {isComposingNewChat && (
              <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-purple-200 animate-scale-in">
                <h3 className="text-sm font-bold text-slate-900 mb-3">Send Direct Query to HR Department</h3>
                <form onSubmit={handleSendMessageToHR} className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Subject / Topic</label>
                    <input
                      type="text"
                      placeholder="e.g. Leave Query, Salary Clarification, Attendance Punch Adjustment"
                      value={employeeMessageSubject}
                      onChange={e => setEmployeeMessageSubject(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Message</label>
                    <textarea
                      rows={3}
                      placeholder="Explain your inquiry or issue to HR..."
                      value={employeeMessageText}
                      onChange={e => setEmployeeMessageText(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setIsComposingNewChat(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs shadow-xs cursor-pointer"
                    >
                      Send to HR 🚀
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Message Thread Window */}
            <div className="bg-white rounded-3xl shadow-xs border border-slate-200 flex flex-col h-[520px] overflow-hidden">
              {/* Thread Header */}
              <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-sm">
                    👨‍💼
                  </div>
                  <div>
                    <span className="font-bold text-xs sm:text-sm text-slate-900 block">HR Support Desk</span>
                    <span className="text-[10px] text-emerald-600 font-semibold">● Online &amp; Connected</span>
                  </div>
                </div>
                <span className="text-xs text-slate-400">{myMessages.length} messages</span>
              </div>

              {/* Chat Bubble Scroll Area */}
              <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-3 thin-scroll bg-slate-50/30">
                {myMessages.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <span className="text-4xl block mb-2">💬</span>
                    <p className="font-bold text-slate-700 text-sm">No messages yet</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                      Have a question about your attendance, salary, or leave? Type a message below to chat with HR.
                    </p>
                  </div>
                ) : (
                  myMessages.map(msg => {
                    const isFromMe =
                      msg.fromEmployeeId === currentEmployee.id ||
                      msg.fromEmployeeId === currentEmployee.employeeId ||
                      msg.from?.toLowerCase() === currentEmployee.name.toLowerCase();

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isFromMe ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center space-x-1.5 mb-1 px-1">
                          <span className="text-[11px] font-bold text-slate-700">
                            {isFromMe ? 'You' : msg.from}
                          </span>
                          <span className="text-[10px] text-slate-400">{msg.time}</span>
                        </div>
                        <div
                          className={`max-w-[85%] sm:max-w-[70%] rounded-2xl p-3 sm:p-4 text-xs sm:text-sm leading-relaxed shadow-xs ${
                            isFromMe
                              ? 'bg-purple-600 text-white rounded-tr-none'
                              : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
                          }`}
                        >
                          {msg.subject && (
                            <p
                              className={`font-bold mb-1 text-xs ${
                                isFromMe ? 'text-purple-100' : 'text-purple-900'
                              }`}
                            >
                              {msg.subject}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap">{msg.content || msg.preview}</p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Bottom Quick Reply Input */}
              <div className="p-3 sm:p-4 bg-white border-t border-slate-100">
                <form onSubmit={handleSendMessageToHR} className="flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder="Type your message to HR..."
                    value={employeeMessageText}
                    onChange={e => setEmployeeMessageText(e.target.value)}
                    className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button
                    type="submit"
                    disabled={!employeeMessageText.trim()}
                    className="px-4 sm:px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs sm:text-sm shadow-xs cursor-pointer shrink-0 transition-all"
                  >
                    Send 🚀
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 8: PROFILE, PHOTO & CREDENTIALS                                     */}
        {/* ======================================================================= */}
        {activeTab === 'profile' && (
          <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* Profile Photo & Avatar Management Card */}
            <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xs border border-slate-200">
              <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                {/* Photo Preview Container with perfect alignment */}
                <div className="flex flex-col items-center shrink-0">
                  <div className="relative group">
                    <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-3xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 p-1 shadow-lg ring-4 ring-indigo-50">
                      <div className="w-full h-full rounded-[22px] bg-slate-900 overflow-hidden flex items-center justify-center relative">
                        {avatarPreview && (avatarPreview.startsWith('data:image/') || avatarPreview.startsWith('http://') || avatarPreview.startsWith('https://')) ? (
                          <img
                            src={avatarPreview}
                            alt={currentEmployee.name}
                            className={`w-full h-full transition-all duration-200 ${
                              avatarFitMode === 'contain' ? 'object-contain bg-slate-950 p-1' : 'object-cover object-center'
                            }`}
                          />
                        ) : (
                          <div className="text-4xl sm:text-5xl font-black text-white select-none">
                            {currentEmployee.name.charAt(0)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Change Photo Overlay Button */}
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="absolute -bottom-2 -right-2 p-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg transition-all cursor-pointer flex items-center justify-center border-2 border-white ring-2 ring-indigo-100"
                      title="Upload / Change Photo"
                    >
                      <span className="text-base">📷</span>
                    </button>
                  </div>

                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/jpg"
                    onChange={handleAvatarFileChange}
                    className="hidden"
                  />
                </div>

                {/* Photo Upload Controls & Alignment Options */}
                <div className="flex-1 text-center md:text-left space-y-3">
                  <div>
                    <h4 className="font-bold text-slate-900 text-base sm:text-lg flex items-center justify-center md:justify-start space-x-2">
                      <span>📸</span>
                      <span>Profile Picture &amp; Avatar</span>
                    </h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Upload your official picture. It will appear on your employee profile, dashboard welcome banner, and sidebar.
                    </p>
                  </div>

                  {/* Alignment / Fit mode toggle */}
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-1">
                    <span className="text-xs font-semibold text-slate-500 mr-1">Display Fit:</span>
                    <button
                      type="button"
                      onClick={() => setAvatarFitMode('cover')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                        avatarFitMode === 'cover'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                      title="Fills the square frame centered nicely without distortion"
                    >
                      Cover (Centered)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAvatarFitMode('contain')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                        avatarFitMode === 'contain'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                      title="Shows the full uncropped image inside frame"
                    >
                      Contain (Full Picture)
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold rounded-xl text-xs transition-all cursor-pointer flex items-center space-x-1.5 shadow-2xs"
                    >
                      <span>📁</span>
                      <span>Choose New Photo</span>
                    </button>

                    {avatarPreview !== currentEmployee.avatar && (
                      <button
                        type="button"
                        onClick={handleSaveAvatarOnly}
                        disabled={isSavingAvatar}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-all shadow-xs cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
                      >
                        <span>{isSavingAvatar ? 'Saving...' : '💾 Save Photo Now'}</span>
                      </button>
                    )}

                    {avatarPreview && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold rounded-xl text-xs transition-all cursor-pointer"
                      >
                        Remove Photo
                      </button>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-400">
                    Smart auto-centering ensures your headshot is clearly visible without being clipped or distorted.
                  </div>
                </div>
              </div>
            </div>

            {/* Employee Information Card */}
            <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xs border border-slate-200 space-y-4">
              <h3 className="font-bold text-slate-900 text-base sm:text-lg flex items-center space-x-2">
                <span>👤</span>
                <span>Official Employee Details</span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs sm:text-sm">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[11px] font-semibold">Full Name</span>
                  <span className="font-bold text-slate-900">{currentEmployee.name}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[11px] font-semibold">Employee ID</span>
                  <span className="font-mono font-bold text-purple-700">{currentEmployee.employeeId}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[11px] font-semibold">Department</span>
                  <span className="font-bold text-slate-900">{currentEmployee.department}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[11px] font-semibold">Designation</span>
                  <span className="font-bold text-slate-900">{currentEmployee.designation}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[11px] font-semibold">Assigned Shift</span>
                  <span className="font-bold text-slate-900">{currentEmployee.shift || 'General Shift'}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[11px] font-semibold">Joining Date</span>
                  <span className="font-bold text-slate-900">{currentEmployee.joinDate || 'N/A'}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[11px] font-semibold">Bank Name</span>
                  <span className="font-bold text-slate-900">{currentEmployee.bankName || 'Dutch Bangla Bank'}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[11px] font-semibold">Account Number</span>
                  <span className="font-mono font-bold text-slate-900">{currentEmployee.accountNumber || '154-120-xxxx'}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 block text-[11px] font-semibold">Gross Salary</span>
                  <span className="font-bold text-emerald-700">৳ {grossSalary.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Editable Contact Information & Password Change */}
            <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xs border border-slate-200 space-y-4">
              <h3 className="font-bold text-slate-900 text-base sm:text-lg flex items-center space-x-2">
                <span>🔐</span>
                <span>Update Contact &amp; Change Password</span>
              </h3>

              {profileSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold">
                  ✅ {profileSuccessMsg}
                </div>
              )}

              {profileErrorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
                  ⚠️ {profileErrorMsg}
                </div>
              )}

              <form onSubmit={handleProfileUpdate} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={e => setProfileForm({ ...profileForm, email: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      value={profileForm.phone}
                      onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Residential Address</label>
                    <input
                      type="text"
                      placeholder="Current residential address"
                      value={profileForm.address}
                      onChange={e => setProfileForm({ ...profileForm, address: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Emergency Contact</label>
                    <input
                      type="text"
                      placeholder="Name & Emergency Phone"
                      value={profileForm.emergencyContact}
                      onChange={e => setProfileForm({ ...profileForm, emergencyContact: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100">
                  <p className="text-xs font-bold text-slate-800 mb-2">Change Portal Password (Leave blank to keep unchanged)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">New Password</label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={profileForm.newPassword}
                        onChange={e => setProfileForm({ ...profileForm, newPassword: e.target.value })}
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={profileForm.confirmPassword}
                        onChange={e => setProfileForm({ ...profileForm, confirmPassword: e.target.value })}
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all cursor-pointer"
                >
                  Save Profile Changes
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 9: COMPANY DOCUMENTS / POLICIES & PERSONAL FILES                    */}
        {/* ======================================================================= */}
        {activeTab === 'documents' && (
          <div className="animate-fade-in">
            <DocumentManagement mode="employee" />
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 11: EMPLOYEE NOTIFICATIONS CENTER                                   */}
        {/* ======================================================================= */}
        {activeTab === 'notifications' && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900">My Notifications &amp; Alerts</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real-time updates on leave approvals, attendance regularizations, payslips, and HR policies
                </p>
              </div>
              <button
                type="button"
                onClick={markAllNotificationsRead}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Mark All Read
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs divide-y divide-slate-100 overflow-hidden">
              {notifications.filter(
                n =>
                  !n.forEmployeeId ||
                  n.forEmployeeId === currentEmployee.id ||
                  n.forEmployeeId === currentEmployee.employeeId
              ).length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No notifications right now.
                </div>
              ) : (
                notifications
                  .filter(
                    n =>
                      !n.forEmployeeId ||
                      n.forEmployeeId === currentEmployee.id ||
                      n.forEmployeeId === currentEmployee.employeeId
                  )
                  .map(n => (
                    <div
                      key={n.id}
                      onClick={() => markNotificationRead(n.id)}
                      className={`p-4 flex items-start justify-between gap-4 cursor-pointer transition-colors ${
                        n.read ? 'bg-white' : 'bg-purple-50/40'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">{n.title}</span>
                          {!n.read && (
                            <span className="text-[10px] font-bold text-purple-700 uppercase">New</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600">{n.message}</p>
                      </div>
                      <span className="text-[11px] text-slate-400 shrink-0">{n.time}</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* PHASE 2 TABS: EXPENSES, ONBOARDING & EXIT, ENGAGEMENT                   */}
        {/* ======================================================================= */}
        {activeTab === 'expenses' && (
          <div className="animate-fade-in">
            <ExpenseManagement mode="employee" />
          </div>
        )}

        {activeTab === 'onboarding' && (
          <div className="animate-fade-in">
            <OnboardingManagement mode="employee" />
          </div>
        )}

        {activeTab === 'engagement' && (
          <div className="animate-fade-in">
            <EmployeeEngagement mode="employee" />
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 12: SETTINGS & THEME CUSTOMIZATION                                  */}
        {/* ======================================================================= */}
        {activeTab === 'settings' && (
          <div className="space-y-6 animate-fade-in">
            {/* Settings Header */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2.5">
                  <span className="p-2.5 rounded-2xl bg-indigo-50 text-indigo-600 text-lg shadow-2xs">⚙️</span>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900">Settings &amp; Theme Customization</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Personalize your interface themes, brand accent colors, date formatting, and view your shift policies.
                    </p>
                  </div>
                </div>
              </div>
              {settingsNotice && (
                <div className="px-3.5 py-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl animate-fade-in flex items-center space-x-2 shrink-0 shadow-2xs">
                  <span>✅</span>
                  <span>{settingsNotice}</span>
                </div>
              )}
            </div>

            {/* Current Shift & Work Mode Summary Card */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-2.5">
                  <span className="p-2 rounded-xl bg-purple-50 text-purple-600">⏱️</span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Assigned Shift &amp; Attendance Policy</h3>
                    <p className="text-[11px] text-slate-500">Your current work mode dictates attendance marking permissions</p>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wider self-start sm:self-auto ${
                  isRemoteEmployee 
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                    : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                }`}>
                  {isRemoteEmployee ? '🌐 Remote Shift (Web Punch Enabled)' : '🏢 Fixed Office Shift (Biometric Machine)'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Shift Schedule</span>
                  <span className="font-bold text-slate-800 text-sm mt-0.5 block">{assignedShift?.name || currentEmployee.shift || 'General Shift'}</span>
                  <span className="text-[11px] text-slate-500 font-mono">{assignedShift?.startTime || '09:00'} - {assignedShift?.endTime || '18:00'}</span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Attendance Method</span>
                  <span className="font-bold text-slate-800 text-sm mt-0.5 block">
                    {isRemoteEmployee ? 'Web & Camera Punch' : 'Office Biometric Terminal'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {isRemoteEmployee ? 'Selfie check-in with GPS verification' : 'Physical device fingerprint / RFID'}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Grace Period &amp; Break</span>
                  <span className="font-bold text-slate-800 text-sm mt-0.5 block">+{assignedShift?.graceTime || 15} mins Grace</span>
                  <span className="text-[11px] text-slate-500">{assignedShift?.breakTime || 60} mins daily break</span>
                </div>
              </div>

              <div className={`p-3.5 rounded-xl text-xs flex items-start space-x-2.5 ${
                isRemoteEmployee ? 'bg-emerald-50/70 border border-emerald-200 text-emerald-900' : 'bg-slate-50 border border-slate-200 text-slate-700'
              }`}>
                <span className="text-base shrink-0">{isRemoteEmployee ? '💡' : 'ℹ️'}</span>
                <div className="leading-relaxed">
                  {isRemoteEmployee ? (
                    <span>You are assigned to a <strong>Remote Shift</strong>. You can mark daily attendance directly from the portal via the <strong>Camera Punch</strong> feature in your sidebar or quick actions.</span>
                  ) : (
                    <span>You are assigned to a <strong>Fixed Office Shift</strong>. In accordance with company policy, your attendance is logged automatically via the office physical biometric terminal (ZKTeco device). Web punch is hidden and disabled for fixed shift staff.</span>
                  )}
                </div>
              </div>
            </div>

            {/* 9 Full-Interface Themes Grid (Mirroring Admin Panel) */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Interface Themes (9 Distinct Visual Styles)</h3>
                  <p className="text-[11px] text-slate-500">Select any theme to immediately transform the entire employee workspace</p>
                </div>
                <span className="text-xs font-bold text-indigo-600 uppercase bg-indigo-50 px-2 py-0.5 rounded-md">
                  Active: {theme}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {[
                  {
                    id: 'light',
                    label: 'Classic Light',
                    icon: '☀️',
                    desc: 'Clean, crisp alabaster light canvas',
                    sidebarColor: '#0f172a',
                    canvasColor: '#f8fafc',
                    cardColor: '#ffffff',
                    accentDot: '#6366f1',
                  },
                  {
                    id: 'dark',
                    label: 'Midnight Dark',
                    icon: '🌙',
                    desc: 'Eye-friendly deep obsidian slate dark mode',
                    sidebarColor: '#020617',
                    canvasColor: '#0b1120',
                    cardColor: '#131c31',
                    accentDot: '#818cf8',
                  },
                  {
                    id: 'aurora',
                    label: 'Cyberpunk Aurora',
                    icon: '🌌',
                    desc: 'Cosmic violet-nebula dark glass interface',
                    sidebarColor: '#120924',
                    canvasColor: '#0d071b',
                    cardColor: '#170e2e',
                    accentDot: '#c084fc',
                  },
                  {
                    id: 'forest',
                    label: 'Emerald Forest',
                    icon: '🌲',
                    desc: 'Deep pine & jade dark executive workspace',
                    sidebarColor: '#041f17',
                    canvasColor: '#061410',
                    cardColor: '#0c241c',
                    accentDot: '#34d399',
                  },
                  {
                    id: 'ocean',
                    label: 'Ocean Breeze',
                    icon: '🌊',
                    desc: 'Refreshing aqua-sky canvas & marine sidebar',
                    sidebarColor: '#082f49',
                    canvasColor: '#e0f2fe',
                    cardColor: '#f8fdff',
                    accentDot: '#0284c7',
                  },
                  {
                    id: 'rose',
                    label: 'Rose Quartz',
                    icon: '🌸',
                    desc: 'Soft blush-pearl canvas with plum sidebar',
                    sidebarColor: '#3b0722',
                    canvasColor: '#ffe4e6',
                    cardColor: '#fffafb',
                    accentDot: '#e11d48',
                  },
                  {
                    id: 'sunset',
                    label: 'Warm Sunset',
                    icon: '🌅',
                    desc: 'Warm golden-sand canvas & espresso sidebar',
                    sidebarColor: '#291305',
                    canvasColor: '#fef3c7',
                    cardColor: '#fffdf7',
                    accentDot: '#d97706',
                  },
                  {
                    id: 'royal',
                    label: 'Royal Amethyst',
                    icon: '💎',
                    desc: 'Soft lavender mist with regal purple sidebar',
                    sidebarColor: '#1e0b45',
                    canvasColor: '#ede9fe',
                    cardColor: '#fcfaff',
                    accentDot: '#7c3aed',
                  },
                  {
                    id: 'auto',
                    label: 'Auto (System)',
                    icon: '💻',
                    desc: 'Automatically syncs with your operating system',
                    sidebarColor: '#0f172a',
                    canvasColor: '#e2e8f0',
                    cardColor: '#ffffff',
                    accentDot: '#6366f1',
                  },
                ].map((m) => {
                  const isSelected = theme === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setTheme(m.id as any);
                        triggerSettingsNotice('Theme Mode', `Switched interface theme to ${m.label}`);
                      }}
                      className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/70 shadow-md ring-2 ring-indigo-500/25'
                          : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50/70'
                      }`}
                    >
                      <div>
                        {/* Mini Interface Swatch Preview */}
                        <div
                          className="w-full h-12 rounded-xl mb-2.5 overflow-hidden border border-black/10 flex shadow-2xs"
                          style={{ backgroundColor: m.canvasColor }}
                        >
                          <div
                            className="w-1/4 h-full flex flex-col items-center justify-center space-y-1 p-1"
                            style={{ backgroundColor: m.sidebarColor }}
                          >
                            <span className="w-3 h-1 rounded-full bg-white/60" />
                            <span className="w-3 h-1 rounded-full bg-white/30" />
                          </div>
                          <div className="flex-1 p-1.5 flex flex-col justify-between">
                            <div className="flex items-center justify-between">
                              <span className="w-8 h-2 rounded-sm" style={{ backgroundColor: m.accentDot }} />
                              <span className="text-xs leading-none">{m.icon}</span>
                            </div>
                            <div className="w-full h-4 rounded-md border border-black/5" style={{ backgroundColor: m.cardColor }} />
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-900">{m.label}</span>
                          {isSelected && (
                            <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">
                              ✓
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{m.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 8 Brand Accent Colors Grid */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Brand Accent Color (8 Vibrant Palettes)</h3>
                  <p className="text-[11px] text-slate-500">Changes the primary button, active highlight, and ring colors</p>
                </div>
                <span className="text-xs font-bold text-indigo-600 uppercase bg-indigo-50 px-2 py-0.5 rounded-md">
                  Active: {accentColor}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: 'indigo', label: 'Indigo Core', hex: '#6366F1' },
                  { id: 'blue', label: 'Sky Blue', hex: '#2563EB' },
                  { id: 'emerald', label: 'Emerald Mint', hex: '#10B981' },
                  { id: 'purple', label: 'Purple Gem', hex: '#8B5CF6' },
                  { id: 'pink', label: 'Neon Pink', hex: '#EC4899' },
                  { id: 'amber', label: 'Warm Amber', hex: '#D97706' },
                  { id: 'cyan', label: 'Deep Cyan', hex: '#0891B2' },
                  { id: 'crimson', label: 'Crimson Rose', hex: '#E11D48' },
                ].map((c) => {
                  const isSelected = accentColor === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setAccentColor(c.id as any);
                        triggerSettingsNotice('Accent Color', `Switched brand accent to ${c.label}`);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center space-x-2.5 ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/70 shadow-xs ring-2 ring-indigo-500/25'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className="w-5 h-5 rounded-full shrink-0 shadow-2xs border border-white flex items-center justify-center text-white text-[10px]"
                        style={{ backgroundColor: c.hex }}
                      >
                        {isSelected && '✓'}
                      </span>
                      <span className="text-xs font-bold text-slate-800">{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date & Number Display Preferences */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">Display &amp; Localization Preferences</h3>
                <p className="text-[11px] text-slate-500">Configure how dates and calendar entries appear across your portal</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Date Format</label>
                  <select
                    value={dateFormat}
                    onChange={(e) => {
                      setDateFormat(e.target.value as any);
                      triggerSettingsNotice('Date Format', `Saved format ${e.target.value}`);
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 15/10/2026)</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY (e.g. 10/15/2026)</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD (e.g. 2026-10-15)</option>
                    <option value="DD MMM YYYY">DD MMM YYYY (e.g. 15 Oct 2026)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Language</label>
                  <select
                    value={language}
                    onChange={(e) => {
                      setLanguage(e.target.value as any);
                      triggerSettingsNotice('Language', `Switched language to ${e.target.value.toUpperCase()}`);
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="en">English (US/UK)</option>
                    <option value="bn">বাংলা (Bengali)</option>
                    <option value="hi">हिंदी (Hindi)</option>
                    <option value="ar">العربية (Arabic)</option>
                    <option value="es">Español (Spanish)</option>
                    <option value="fr">Français (French)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: OFFICIAL 3-DAYS LATE HR WARNING LETTER MODAL                     */}
      {/* ========================================================================= */}
      {showWarningLetterModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border-2 border-rose-500 overflow-hidden my-auto max-h-[92vh] flex flex-col">
            {/* Top Bar */}
            <div className="bg-gradient-to-r from-rose-700 via-red-700 to-rose-800 text-white px-5 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2.5">
                <span className="text-2xl">📜</span>
                <div>
                  <h3 className="font-black text-sm sm:text-base uppercase tracking-wider">
                    Official HR Attendance Warning Letter
                  </h3>
                  <p className="text-[11px] text-rose-100">
                    Ref: WN/HR/LW/{overviewLateWarningData.targetMonth.replace('-', '')}/{currentEmployee.employeeId} • Issued by Human Resources
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWarningLetterModal(false)}
                className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Printable Warning Letter Body */}
            <div className="p-5 sm:p-8 overflow-y-auto space-y-5 text-xs sm:text-sm text-slate-800 leading-relaxed">
              {/* Letterhead */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b-2 border-slate-200 gap-3">
                <div>
                  <h2 className="text-lg sm:text-xl font-black text-slate-900">WORKNEST HR MANAGEMENT</h2>
                  <p className="text-xs text-slate-500">Human Resources &amp; Administration Department</p>
                </div>
                <div className="text-left sm:text-right text-xs font-mono text-slate-600">
                  <p><strong>Date:</strong> {todayStr}</p>
                  <p><strong>Month:</strong> {formatMonthLabel(overviewLateWarningData.targetMonth)}</p>
                  <p className="text-rose-700 font-bold">STATUS: DISCIPLINARY WARNING</p>
                </div>
              </div>

              {/* Recipient Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
                <div>
                  <p><span className="text-slate-400 font-semibold">To Employee:</span> <strong className="text-slate-900">{currentEmployee.name}</strong></p>
                  <p className="mt-1"><span className="text-slate-400 font-semibold">Employee ID:</span> <strong className="font-mono text-purple-700">{currentEmployee.employeeId}</strong></p>
                </div>
                <div>
                  <p><span className="text-slate-400 font-semibold">Designation:</span> <strong className="text-slate-900">{currentEmployee.designation}</strong></p>
                  <p className="mt-1"><span className="text-slate-400 font-semibold">Department:</span> <strong className="text-slate-900">{currentEmployee.department}</strong></p>
                </div>
              </div>

              {/* Subject Line */}
              <div className="p-3.5 bg-rose-50 border-l-4 border-rose-600 rounded-r-xl">
                <p className="font-black text-rose-950 text-xs sm:text-sm">
                  SUBJECT: Official Warning Notice - Excessive Late Arrivals ({overviewLateWarningData.totalLate} Days) in {formatMonthLabel(overviewLateWarningData.targetMonth)}
                </p>
              </div>

              {/* Formal Notice Text (English) */}
              <div className="space-y-3 text-slate-700">
                <p>
                  Dear <strong>{currentEmployee.name}</strong>,
                </p>
                <p>
                  According to our official attendance tracking system records, you have accumulated a total of{' '}
                  <strong className="text-rose-700">{overviewLateWarningData.totalLate} late check-in instances</strong> beyond your scheduled shift time and grace window during the month of <strong>{formatMonthLabel(overviewLateWarningData.targetMonth)}</strong>.
                </p>
                <p>
                  Pursuant to Company HR Punctuality &amp; Discipline Policy, <strong>1 day salary deduction applies for every 3 unexcused late arrivals</strong>. Consequently, based on your current record, a penalty of{' '}
                  <strong className="text-rose-700">
                    {overviewLateWarningData.penaltyDays} day(s) salary deduction (estimated ৳{overviewLateWarningData.estimatedLateCut.toLocaleString()})
                  </strong>{' '}
                  is applicable for this payroll cycle.
                </p>
                <p className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 font-semibold text-xs">
                  📌 Directives: You are hereby instructed to adhere strictly to your assigned shift schedule and arrive on time. If any delay occurred due to an emergency or unavoidable circumstances, please submit a formal waiver request with supporting documents via the &quot;Late &amp; Checkout Requests&quot; module.
                </p>
              </div>

              {/* Detailed Table of Late Arrivals */}
              <div>
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-2">
                  📋 Verified Late Arrival Log ({formatMonthLabel(overviewLateWarningData.targetMonth)})
                </h4>
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Assigned Shift</th>
                        <th className="px-3 py-2 text-left">Shift Start</th>
                        <th className="px-3 py-2 text-left">Actual Check-In</th>
                        <th className="px-3 py-2 text-left">Waiver Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {overviewLateWarningData.lateDetails.map((d, i) => (
                        <tr key={d.date + i} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-bold text-slate-500">{i + 1}</td>
                          <td className="px-3 py-2 font-mono font-bold text-slate-900">{d.date}</td>
                          <td className="px-3 py-2 text-slate-700">{d.shiftName}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{formatTo12Hour(d.shiftStart)} (+{d.graceTime}m grace)</td>
                          <td className="px-3 py-2 font-mono font-bold text-rose-600">{formatTo12Hour(d.checkIn)}</td>
                          <td className="px-3 py-2">
                            {d.isWaived ? (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold">
                                Approved Waiver
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded-full text-[10px] font-bold">
                                Unexcused Late
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-200 text-xs">
                <div>
                  <p className="font-bold text-slate-900">Human Resources &amp; Administration</p>
                  <p className="text-slate-500">Automated HR Compliance &amp; Attendance System</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900">Employee Acknowledgment</p>
                  <p className="text-slate-500">
                    {isWarningAcknowledged
                      ? `✅ Acknowledged on ${warningAcknowledgedMap[warningAckKey]}`
                      : 'Pending Employee Acknowledgment'}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex flex-wrap gap-2">
                {!isWarningAcknowledged ? (
                  <button
                    type="button"
                    onClick={handleAcknowledgeWarningLetter}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer flex items-center space-x-1.5"
                  >
                    <span>✅</span>
                    <span>I Have Read &amp; Acknowledge This Warning</span>
                  </button>
                ) : (
                  <span className="px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold">
                    ✅ Acknowledged by {currentEmployee.name}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer flex items-center space-x-1.5"
                >
                  <span>🖨️</span>
                  <span>Print Letter</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowWarningLetterModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EMPLOYEE LEAVE APPLICATION ATTACHMENT PREVIEW MODAL              */}
      {/* ========================================================================= */}
      {previewLeaveAttachment && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2 min-w-0">
                <span className="text-xl">📎</span>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm truncate">{previewLeaveAttachment.attachmentName}</h3>
                  <p className="text-[11px] text-slate-300">
                    {previewLeaveAttachment.type} Leave ({previewLeaveAttachment.from} to {previewLeaveAttachment.to})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewLeaveAttachment(null)}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 bg-slate-50 flex flex-col items-center justify-center min-h-[320px]">
              {previewLeaveAttachment.attachmentDataUrl?.startsWith('data:application/pdf') ||
              previewLeaveAttachment.attachmentName?.toLowerCase().endsWith('.pdf') ? (
                <iframe
                  src={previewLeaveAttachment.attachmentDataUrl}
                  title="Leave Application PDF"
                  className="w-full h-[60vh] rounded-xl border border-slate-200 bg-white"
                />
              ) : previewLeaveAttachment.attachmentDataUrl?.startsWith('data:image/') ? (
                <img
                  src={previewLeaveAttachment.attachmentDataUrl}
                  alt={previewLeaveAttachment.attachmentName}
                  className="max-h-[60vh] w-auto object-contain rounded-xl border border-slate-200 bg-white shadow-sm"
                />
              ) : (
                <div className="text-center p-8 bg-white rounded-2xl border border-slate-200 max-w-md space-y-3">
                  <span className="text-5xl block">📘</span>
                  <h4 className="font-bold text-slate-900 text-base">{previewLeaveAttachment.attachmentName}</h4>
                  <p className="text-xs text-slate-500">
                    Microsoft Word Document ({previewLeaveAttachment.attachmentSize ? `${(previewLeaveAttachment.attachmentSize / 1024).toFixed(1)} KB` : 'Attached'}). Click below to download and open the Word application file.
                  </p>
                  <a
                    href={previewLeaveAttachment.attachmentDataUrl}
                    download={previewLeaveAttachment.attachmentName}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs"
                  >
                    <span>⬇️</span>
                    <span>Download Word File (.doc / .docx)</span>
                  </a>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 bg-white border-t border-slate-200 flex items-center justify-between shrink-0">
              <a
                href={previewLeaveAttachment.attachmentDataUrl}
                download={previewLeaveAttachment.attachmentName}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold inline-flex items-center space-x-1.5"
              >
                <span>⬇️</span>
                <span>Download File</span>
              </a>
              <button
                type="button"
                onClick={() => setPreviewLeaveAttachment(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
