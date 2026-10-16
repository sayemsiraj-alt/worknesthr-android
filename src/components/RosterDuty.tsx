import { useState, useMemo, useEffect } from 'react';
import { useData, RosterEntry } from '../context/DataContext';
import {
  resolveEmployeeShiftNameForDate,
  findAutoContinuedRosterEntryForDate,
  isRosterAutoContinueEnabled,
  setRosterAutoContinueEnabled,
  getSafeDayOfWeekFromDateStr,
} from '../utils/attendanceScheduleEngine';
import { HolidayOffDayManager } from './HolidayOffDayManager';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function RosterDuty() {
  const {
    employees,
    shifts,
    roster,
    saveRosterEntries,
    deleteRosterEntries,
    addNotification,
    companyHolidays,
  } = useData();
  const today = new Date().toISOString().split('T')[0];
  const [view, setView] = useState<'monthly' | 'holidays' | 'custom'>('monthly');
  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(employees[0]?.id || '');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());

  // Auto-Continue Roster across months state (default: true)
  const [autoContinueRoster, setAutoContinueRoster] = useState<boolean>(() => isRosterAutoContinueEnabled());

  useEffect(() => {
    const syncAutoContinue = () => setAutoContinueRoster(isRosterAutoContinueEnabled());
    window.addEventListener('worknest_roster_auto_continue_changed', syncAutoContinue);
    window.addEventListener('storage', syncAutoContinue);
    return () => {
      window.removeEventListener('worknest_roster_auto_continue_changed', syncAutoContinue);
      window.removeEventListener('storage', syncAutoContinue);
    };
  }, []);

  const handleToggleAutoContinue = () => {
    const next = !autoContinueRoster;
    setAutoContinueRoster(next);
    setRosterAutoContinueEnabled(next);
    addNotification({
      title: next ? '🔁 Auto-Continue Roster Enabled' : '⏸️ Auto-Continue Roster Paused',
      message: next
        ? 'Previous month roster & weekly off-day patterns will automatically stay active in future months.'
        : 'Future months will only use explicitly saved roster entries.',
      read: false,
      type: 'system',
      targetPage: 'roster',
    });
  };

  // Copy / Repeat Previous Month Roster Modal state
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
  const [copySourceYear, setCopySourceYear] = useState<number>(() => {
    const d = new Date();
    return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  });
  const [copySourceMonth, setCopySourceMonth] = useState<number>(() => {
    const d = new Date();
    return d.getMonth() === 0 ? 11 : d.getMonth() - 1;
  });
  const [copyDurationMonths, setCopyDurationMonths] = useState<number>(1); // 1, 3, 6, 12
  const [copyMode, setCopyMode] = useState<'weekly_pattern' | 'exact_date'>('weekly_pattern');
  const [copyScope, setCopyScope] = useState<'all' | 'selected'>('all');
  const [copyConflictMode, setCopyConflictMode] = useState<'overwrite' | 'fill_empty'>('overwrite');
  const [isCopySaving, setIsCopySaving] = useState(false);

  // Advanced Bulk Assigner Modal state
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<'shift' | 'weekend'>('shift');
  const [bulkTargetEmployees, setBulkTargetEmployees] = useState<string[]>([]);
  const [bulkSelectedShift, setBulkSelectedShift] = useState<string>('');
  const [bulkStartDate, setBulkStartDate] = useState(today);
  const [bulkEndDate, setBulkEndDate] = useState(today);
  const [bulkDaysOfWeek, setBulkDaysOfWeek] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]); // 0=Sun .. 6=Sat
  const [bulkDepartmentFilter, setBulkDepartmentFilter] = useState<string>('all');
  const [bulkSearchTerm, setBulkSearchTerm] = useState('');
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  useEffect(() => {
    if (!selectedEmployee && employees.length > 0) {
      setSelectedEmployee(employees[0].id);
    }
  }, [employees, selectedEmployee]);

  useEffect(() => {
    if (shifts.length > 0 && !bulkSelectedShift) {
      setBulkSelectedShift(shifts[0].name);
    }
  }, [shifts, bulkSelectedShift]);

  // Keep default copy source month set to the month immediately before the currently selected calendar month
  useEffect(() => {
    if (month === 0) {
      setCopySourceMonth(11);
      setCopySourceYear(year - 1);
    } else {
      setCopySourceMonth(month - 1);
      setCopySourceYear(year);
    }
  }, [month, year]);

  // Custom Roster Builder state
  const [customEmployees, setCustomEmployees] = useState<string[]>([]);
  const [customStartDate, setCustomStartDate] = useState(today);
  const [customEndDate, setCustomEndDate] = useState(today);
  const [customShiftSelection, setCustomShiftSelection] = useState<string>(shifts[0]?.name || '');
  const [customOffDays, setCustomOffDays] = useState<number[]>([]); // 100% user-chosen!
  const [customGenerated, setCustomGenerated] = useState<RosterEntry[]>([]);

  useEffect(() => {
    if (employees.length > 0 && customEmployees.length === 0) {
      setCustomEmployees(employees.slice(0, 3).map(e => e.id));
    }
  }, [employees, customEmployees]);

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });

  // Helper to apply quick multi-month date ranges
  const computePresetDateRange = (monthsCount: number, startFromNextMonth = false): { start: string; end: string } => {
    const startM = startFromNextMonth ? month + 1 : month;
    const startDt = new Date(Date.UTC(year, startM, 1));
    const endDt = new Date(Date.UTC(year, startM + monthsCount, 0));
    return {
      start: startDt.toISOString().split('T')[0],
      end: endDt.toISOString().split('T')[0],
    };
  };

  // Filtered employees for bulk modal
  const filteredBulkEmployees = useMemo(() => {
    return employees.filter(e => {
      const matchDept = bulkDepartmentFilter === 'all' || e.department?.toLowerCase() === bulkDepartmentFilter.toLowerCase();
      const matchSearch = !bulkSearchTerm || e.name.toLowerCase().includes(bulkSearchTerm.toLowerCase()) ||
                          e.employeeId.toLowerCase().includes(bulkSearchTerm.toLowerCase());
      return matchDept && matchSearch;
    });
  }, [employees, bulkDepartmentFilter, bulkSearchTerm]);

  // Employee's explicit calendar roster map for currently selected month
  const employeeRoster = useMemo(() => {
    const map: Record<number, { shift: string; isOff: boolean; isExtra: boolean; id: string }> = {};
    const targetEmp = employees.find(e => e.id === selectedEmployee);
    const empCodeLower = String(targetEmp?.employeeId || '').toLowerCase().trim();
    const empIdLower = String(selectedEmployee || '').toLowerCase().trim();
    const empDigits = empCodeLower.replace(/\D/g, '');
    const empNameLower = String(targetEmp?.name || '').toLowerCase().trim();

    roster.forEach(r => {
      const rId = String(r.employeeId || '').toLowerCase().trim();
      const rDigits = rId.replace(/\D/g, '');
      const rName = String(r.employeeName || '').toLowerCase().trim();
      const matchesEmp =
        (empIdLower && rId === empIdLower) ||
        (empCodeLower && rId === empCodeLower) ||
        (empDigits && rDigits && empDigits === rDigits && rDigits.length >= 2) ||
        (empNameLower && rName === empNameLower);

      if (matchesEmp && r.date && r.date.startsWith(monthPrefix)) {
        const day = parseInt(r.date.split('-')[2], 10);
        map[day] = {
          shift: r.shift,
          isOff: Boolean(r.isOffDay || r.shift?.toLowerCase() === 'off' || r.shift?.toLowerCase() === 'weekend'),
          isExtra: Boolean(r.isExtraDay),
          id: r.id || `${r.employeeId}_${r.date}`,
        };
      }
    });
    return map;
  }, [roster, selectedEmployee, monthPrefix, employees]);

  const emp = employees.find(e => e.id === selectedEmployee);

  /**
   * Resolves calendar cell data.
   * CRITICAL RULE 3: There is NO default JavaScript weekend!
   * Off/Weekend is 100% roster-driven (either explicit for this month or auto-continued from latest prior rostered month).
   */
  const ensureEntry = (day: number): {
    shift: string;
    isOff: boolean;
    isExtra: boolean;
    isAutoContinued?: boolean;
    sourceMonth?: string;
  } => {
    if (employeeRoster[day]) {
      return { ...employeeRoster[day], isAutoContinued: false };
    }
    const dateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`;
    const effShift = resolveEmployeeShiftNameForDate(emp, dateStr);

    if (autoContinueRoster && emp) {
      const inherited = findAutoContinuedRosterEntryForDate(emp, dateStr, roster, true);
      if (inherited) {
        const inheritedIsOff = Boolean(
          inherited.isOffDay ||
          inherited.shift?.toLowerCase() === 'off' ||
          inherited.shift?.toLowerCase() === 'weekend'
        );
        if (inheritedIsOff) {
          return {
            shift: 'Off',
            isOff: true,
            isExtra: false,
            isAutoContinued: true,
            sourceMonth: inherited.sourceMonth,
          };
        }
        return {
          shift: inherited.shift || effShift || emp.shift || (shifts[0]?.name || 'General Shift'),
          isOff: false,
          isExtra: false,
          isAutoContinued: true,
          sourceMonth: inherited.sourceMonth,
        };
      }
    }

    return {
      shift: effShift || emp?.shift || (shifts[0]?.name || 'General Shift'),
      isOff: false, // NEVER mark as weekend automatically!
      isExtra: false,
      isAutoContinued: false,
    };
  };

  const resolvedMonthDays = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      ...ensureEntry(i + 1),
    }));
  }, [daysInMonth, employeeRoster, autoContinueRoster, emp, roster, monthPrefix, shifts]);

  const autoContinuedSourceMonth = useMemo(() => {
    const found = resolvedMonthDays.find(d => d.isAutoContinued && d.sourceMonth);
    return found?.sourceMonth || null;
  }, [resolvedMonthDays]);

  /**
   * Lock/Save the currently displayed auto-continued month into Firestore for the selected employee.
   */
  const handleLockAutoContinuedMonthForEmployee = async () => {
    if (!emp) return;
    const finalEmpId = String(emp.employeeId || emp.id).trim();
    const entries: RosterEntry[] = resolvedMonthDays.map(d => {
      const dateStr = `${monthPrefix}-${String(d.day).padStart(2, '0')}`;
      const targetShift = d.isOff ? 'Off' : (d.shift || emp.shift || (shifts[0]?.name || 'Unassigned'));
      return {
        id: `${finalEmpId}_${dateStr}`,
        employeeId: finalEmpId,
        employeeName: emp.name,
        date: dateStr,
        shift: targetShift,
        isOffDay: Boolean(d.isOff),
        isExtraDay: Boolean(d.isExtra),
        effectiveFrom: `${monthPrefix}-01`,
      };
    });
    await saveRosterEntries(entries);
    addNotification({
      title: '💾 Auto-Continued Roster Locked',
      message: `Saved ${entries.length} entries for ${emp.name} in ${monthName} ${year} to Firestore.`,
      read: false,
      type: 'system',
      targetPage: 'roster',
    });
  };

  /**
   * Save a single day's change immediately to Firestore!
   * If this month was previously auto-continued (0 explicit entries in Firestore),
   * materialize the entire month's carried-forward schedule alongside this edit so other days don't lose their pattern.
   */
  const saveDay = async (day: number, updates: Partial<{ shift: string; isOff: boolean; isExtra: boolean }>) => {
    if (!selectedEmployee || !emp) return;
    const finalEmpId = String(emp.employeeId || selectedEmployee).trim();

    if (Object.keys(employeeRoster).length === 0 && autoContinuedSourceMonth) {
      const allMonthEntries: RosterEntry[] = resolvedMonthDays.map(d => {
        const isTargetDay = d.day === day;
        const merged = isTargetDay ? { ...d, ...updates } : d;
        const dateStr = `${monthPrefix}-${String(d.day).padStart(2, '0')}`;
        const targetShift = merged.isOff ? 'Off' : (merged.shift || emp.shift || (shifts[0]?.name || 'Unassigned'));
        return {
          id: `${finalEmpId}_${dateStr}`,
          employeeId: finalEmpId,
          employeeName: emp.name,
          date: dateStr,
          shift: targetShift,
          isOffDay: Boolean(merged.isOff),
          isExtraDay: Boolean(merged.isExtra),
          effectiveFrom: `${monthPrefix}-01`,
        };
      });
      await saveRosterEntries(allMonthEntries);
      return;
    }

    const current = ensureEntry(day);
    const dateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`;
    const merged = { ...current, ...updates };

    const targetShift = merged.isOff ? 'Off' : (merged.shift || emp.shift || (shifts[0]?.name || 'Unassigned'));
    const docId = `${finalEmpId}_${dateStr}`;

    const newEntry: RosterEntry = {
      id: docId,
      employeeId: finalEmpId,
      employeeName: emp.name,
      date: dateStr,
      shift: targetShift,
      isOffDay: Boolean(merged.isOff),
      isExtraDay: Boolean(merged.isExtra),
      effectiveFrom: dateStr,
    };

    await saveRosterEntries([newEntry]);
  };

  const handleShiftChange = async (day: number, newShift: string) => {
    await saveDay(day, { shift: newShift, isOff: false });
  };

  const toggleOffDay = async (day: number) => {
    const current = ensureEntry(day);
    const willBeOff = !current.isOff;
    await saveDay(day, {
      isOff: willBeOff,
      shift: willBeOff ? 'Off' : (current.shift === 'Off' ? (emp?.shift || (shifts[0]?.name || 'Unassigned')) : current.shift),
      isExtra: willBeOff ? false : current.isExtra,
    });
    addNotification({
      title: willBeOff ? '🏖️ Roster: Weekend / Off Marked' : '💼 Roster: Working Shift Restored',
      message: `${emp?.name}: Day ${day} ${monthName} marked as ${willBeOff ? 'OFF DAY' : 'WORK DAY'} (Synced to Firestore).`,
      read: false,
      type: 'system',
      targetPage: 'roster',
    });
  };

  const toggleExtraDay = async (day: number) => {
    const current = ensureEntry(day);
    const willBeExtra = !current.isExtra;
    await saveDay(day, {
      isExtra: willBeExtra,
      isOff: willBeExtra ? false : current.isOff,
    });
    addNotification({
      title: willBeExtra ? '⭐ Extra/OT Day Assigned' : '📋 Normal Day Restored',
      message: `${emp?.name}: Day ${day} ${monthName} marked as ${willBeExtra ? 'EXTRA (OT)' : 'NORMAL'}.`,
      read: false,
      type: 'system',
      targetPage: 'roster',
    });
  };

  /**
   * Clear all roster entries for current employee and month.
   */
  const handleClearMonth = async () => {
    if (!emp) return;
    if (!confirm(`Clear all custom roster & off-day entries for ${emp.name} for ${monthName} ${year}?`)) return;

    const targets: { employeeId: string; date: string }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
      targets.push({ employeeId: emp.employeeId || emp.id, date: dateStr });
      if (emp.id !== emp.employeeId) {
        targets.push({ employeeId: emp.id, date: dateStr });
      }
    }

    await deleteRosterEntries(targets);
    addNotification({
      title: '🗑️ Roster Cleared',
      message: `Roster entries for ${emp.name} cleared for ${monthName} ${year}.`,
      read: false,
      type: 'system',
      targetPage: 'roster',
    });
  };

  /**
   * Apply Bulk Shift / Weekend assignment tool.
   * CRITICAL RULE 6:
   * - Only selected employees receive assignment.
   * - Exact dates saved.
   * - Conflict-free deterministic ID (${empId}_${date}).
   * - Weekend/Off assignments only apply to exact selected dates/days.
   */
  const handleExecuteBulkAssignment = async () => {
    if (bulkTargetEmployees.length === 0) {
      alert('Please select at least one employee.');
      return;
    }
    if (!bulkStartDate || !bulkEndDate || bulkEndDate < bulkStartDate) {
      alert('Please select a valid date range.');
      return;
    }

    setIsBulkSaving(true);
    try {
      const entriesToSave: RosterEntry[] = [];
      const start = new Date(bulkStartDate);
      const end = new Date(bulkEndDate);
      const curr = new Date(start);

      while (curr <= end) {
        const dateStr = curr.toISOString().split('T')[0];
        const dayOfWeek = curr.getDay(); // 0..6

        if (bulkDaysOfWeek.includes(dayOfWeek)) {
          bulkTargetEmployees.forEach(empId => {
            const employee = employees.find(e => e.id === empId || e.employeeId === empId);
            if (!employee) return;
            const finalEmpId = employee.employeeId || employee.id;
            const docId = `${finalEmpId}_${dateStr}`;

            if (bulkMode === 'weekend') {
              entriesToSave.push({
                id: docId,
                employeeId: finalEmpId,
                employeeName: employee.name,
                date: dateStr,
                shift: 'Off',
                isOffDay: true,
                isExtraDay: false,
                effectiveFrom: bulkStartDate,
              });
            } else {
              entriesToSave.push({
                id: docId,
                employeeId: finalEmpId,
                employeeName: employee.name,
                date: dateStr,
                shift: bulkSelectedShift,
                isOffDay: false,
                isExtraDay: false,
                effectiveFrom: bulkStartDate,
              });
            }
          });
        }
        curr.setDate(curr.getDate() + 1);
      }

      await saveRosterEntries(entriesToSave);

      addNotification({
        title: bulkMode === 'weekend' ? '🏖️ Bulk Weekend/Off Days Assigned' : '⚡ Bulk Shift Assigned',
        message: `Successfully updated ${entriesToSave.length} roster entries across ${bulkTargetEmployees.length} employee(s) from ${bulkStartDate} to ${bulkEndDate}.`,
        read: false,
        type: 'system',
        targetPage: 'roster',
      });

      setIsBulkModalOpen(false);
    } catch (err: any) {
      console.error('Bulk roster assign error:', err);
      alert('Could not save roster entries. Please try again.');
    } finally {
      setIsBulkSaving(false);
    }
  };

  /**
   * Custom Roster Generator
   */
  const generateCustomRoster = () => {
    if (customEmployees.length === 0) {
      alert('Please select at least one employee');
      return;
    }
    const start = new Date(customStartDate);
    const end = new Date(customEndDate);
    if (end < start) {
      alert('End date must be on or after start date');
      return;
    }

    const newEntries: RosterEntry[] = [];
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayOfWeek = current.getDay();
      const isOffDay = customOffDays.includes(dayOfWeek);

      customEmployees.forEach(empId => {
        const employee = employees.find(e => e.id === empId || e.employeeId === empId);
        if (!employee) return;
        const finalEmpId = employee.employeeId || employee.id;
        const docId = `${finalEmpId}_${dateStr}`;

        newEntries.push({
          id: docId,
          employeeId: finalEmpId,
          employeeName: employee.name,
          date: dateStr,
          shift: isOffDay ? 'Off' : customShiftSelection,
          isOffDay,
          isExtraDay: false,
          effectiveFrom: customStartDate,
        });
      });

      current.setDate(current.getDate() + 1);
    }

    setCustomGenerated(newEntries);
  };

  const applyCustomRoster = async () => {
    if (customGenerated.length === 0) return;
    await saveRosterEntries(customGenerated);
    addNotification({
      title: '✅ Custom Roster Applied to Firestore',
      message: `${customGenerated.length} roster records saved successfully!`,
      read: false,
      type: 'system',
      targetPage: 'roster',
    });
    setCustomGenerated([]);
  };

  /**
   * Helper to match roster entries for a given employee object
   */
  const getEmployeeRosterEntriesForMonth = (empObj: typeof employees[0], targetMonthPrefix: string): RosterEntry[] => {
    const empCodeLower = String(empObj.employeeId || '').toLowerCase().trim();
    const empIdLower = String(empObj.id || '').toLowerCase().trim();
    const empDigits = empCodeLower.replace(/\D/g, '');
    const empNameLower = String(empObj.name || '').toLowerCase().trim();

    return roster.filter(r => {
      if (!r.date || !r.date.startsWith(targetMonthPrefix)) return false;
      const rId = String(r.employeeId || '').toLowerCase().trim();
      const rDigits = rId.replace(/\D/g, '');
      const rName = String(r.employeeName || '').toLowerCase().trim();
      return (
        (empIdLower && rId === empIdLower) ||
        (empCodeLower && rId === empCodeLower) ||
        (empDigits && rDigits && empDigits === rDigits && rDigits.length >= 2) ||
        (empNameLower && rName === empNameLower)
      );
    });
  };

  const copySourceMonthPrefix = `${copySourceYear}-${String(copySourceMonth + 1).padStart(2, '0')}`;
  const copySourceMonthLabel = new Date(copySourceYear, copySourceMonth, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  /**
   * Compute preview entries for Copy / Repeat Previous Month Roster modal
   */
  const copyPreviewSummary = useMemo(() => {
    const targetEmps = copyScope === 'selected' && emp ? [emp] : employees;
    let matchedEmployeesCount = 0;
    let totalEntriesToSave = 0;

    for (const targetEmp of targetEmps) {
      const sourceEntries = getEmployeeRosterEntriesForMonth(targetEmp, copySourceMonthPrefix);
      if (sourceEntries.length > 0) {
        matchedEmployeesCount++;
      }
      for (let mOffset = 0; mOffset < copyDurationMonths; mOffset++) {
        const tDate = new Date(year, month + mOffset, 1);
        const tY = tDate.getFullYear();
        const tM = tDate.getMonth();
        const tDays = new Date(tY, tM + 1, 0).getDate();
        const tPrefix = `${tY}-${String(tM + 1).padStart(2, '0')}`;
        const existingInTarget = getEmployeeRosterEntriesForMonth(targetEmp, tPrefix);
        const existingDatesSet = new Set(existingInTarget.map(x => x.date));

        for (let d = 1; d <= tDays; d++) {
          const dStr = `${tPrefix}-${String(d).padStart(2, '0')}`;
          if (copyConflictMode === 'fill_empty' && existingDatesSet.has(dStr)) {
            continue;
          }
          if (sourceEntries.length > 0) {
            totalEntriesToSave++;
          }
        }
      }
    }

    return {
      targetEmployeesCount: targetEmps.length,
      matchedEmployeesCount,
      totalEntriesToSave,
    };
  }, [copyScope, emp, employees, roster, copySourceMonthPrefix, copyDurationMonths, year, month, copyConflictMode]);

  /**
   * Execute Copy / Repeat Previous Month Roster to 1, 3, 6, or 12 months
   */
  const handleExecuteCopyPreviousMonth = async () => {
    const targetEmps = copyScope === 'selected' && emp ? [emp] : employees;
    if (targetEmps.length === 0) return;

    setIsCopySaving(true);
    try {
      const entriesToSave: RosterEntry[] = [];
      let employeesCopied = 0;

      for (const targetEmp of targetEmps) {
        const sourceEntries = getEmployeeRosterEntriesForMonth(targetEmp, copySourceMonthPrefix);
        if (sourceEntries.length === 0) continue;
        employeesCopied++;

        const finalEmpId = String(targetEmp.employeeId || targetEmp.id).trim();

        for (let mOffset = 0; mOffset < copyDurationMonths; mOffset++) {
          const tDate = new Date(year, month + mOffset, 1);
          const tY = tDate.getFullYear();
          const tM = tDate.getMonth();
          const tDays = new Date(tY, tM + 1, 0).getDate();
          const tPrefix = `${tY}-${String(tM + 1).padStart(2, '0')}`;
          const existingInTarget = getEmployeeRosterEntriesForMonth(targetEmp, tPrefix);
          const existingDatesSet = new Set(existingInTarget.map(x => x.date));

          for (let d = 1; d <= tDays; d++) {
            const dStr = `${tPrefix}-${String(d).padStart(2, '0')}`;
            if (copyConflictMode === 'fill_empty' && existingDatesSet.has(dStr)) {
              continue;
            }

            let matchedSource: RosterEntry | undefined;

            if (copyMode === 'weekly_pattern') {
              const targetDow = getSafeDayOfWeekFromDateStr(dStr);
              const sameDowList = sourceEntries
                .filter(s => getSafeDayOfWeekFromDateStr(s.date) === targetDow)
                .sort((a, b) => b.date.localeCompare(a.date));
              matchedSource = sameDowList[0];
            } else {
              const dayStrPadded = String(d).padStart(2, '0');
              matchedSource =
                sourceEntries.find(s => s.date.endsWith(`-${dayStrPadded}`)) ||
                sourceEntries[sourceEntries.length - 1];
            }

            const effShift = resolveEmployeeShiftNameForDate(targetEmp, dStr);
            const fallbackShift = effShift || targetEmp.shift || (shifts[0]?.name || 'General Shift');

            const isOff = matchedSource
              ? Boolean(
                  matchedSource.isOffDay ||
                  matchedSource.shift?.toLowerCase() === 'off' ||
                  matchedSource.shift?.toLowerCase() === 'weekend'
                )
              : false;

            const shiftName = isOff
              ? 'Off'
              : (matchedSource?.shift && matchedSource.shift !== 'Off' ? matchedSource.shift : fallbackShift);

            entriesToSave.push({
              id: `${finalEmpId}_${dStr}`,
              employeeId: finalEmpId,
              employeeName: targetEmp.name,
              date: dStr,
              shift: shiftName,
              isOffDay: isOff,
              isExtraDay: false,
              effectiveFrom: `${tPrefix}-01`,
            });
          }
        }
      }

      if (entriesToSave.length === 0) {
        addNotification({
          title: 'ℹ️ No Source Roster Found',
          message: `No roster entries found in ${copySourceMonthLabel} to copy.`,
          read: false,
          type: 'system',
          targetPage: 'roster',
        });
        setIsCopySaving(false);
        return;
      }

      await saveRosterEntries(entriesToSave);

      addNotification({
        title: '🔄 Roster Copied & Repeated Successfully',
        message: `Copied ${entriesToSave.length} roster entries from ${copySourceMonthLabel} across ${employeesCopied} employee(s) for ${copyDurationMonths} month(s).`,
        read: false,
        type: 'system',
        targetPage: 'roster',
      });

      setIsCopyModalOpen(false);
    } catch (err) {
      console.error('Copy roster error:', err);
    } finally {
      setIsCopySaving(false);
    }
  };

  const totalExtraDays = resolvedMonthDays.filter(r => r.isExtra).length;
  const totalOffDays = resolvedMonthDays.filter(r => r.isOff).length;
  const totalWorkingDays = resolvedMonthDays.filter(r => !r.isOff).length;

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-2xl">📅</span>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Roster &amp; Shift Authority</h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Configure employee shifts, flexible duties, and 100% roster-governed weekend/off days
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Auto-Continue Next Month Toggle */}
          <button
            type="button"
            onClick={handleToggleAutoContinue}
            title="When enabled, an employee's previous month roster & weekly off-day pattern stays active automatically in future months"
            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center space-x-1.5 cursor-pointer ${
              autoContinueRoster
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 shadow-2xs hover:bg-emerald-100'
                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
            }`}
          >
            <span>🔁</span>
            <span>Auto-Active Next Month:</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                autoContinueRoster ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-700'
              }`}
            >
              {autoContinueRoster ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Declare Holiday / Off-Day Button */}
          <button
            type="button"
            onClick={() => setView('holidays')}
            className="px-3.5 py-2 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <span>🎉</span>
            <span>Declare Holiday / Off-Day</span>
          </button>

          {/* Copy / Repeat Previous Month Roster Button */}
          <button
            type="button"
            onClick={() => setIsCopyModalOpen(true)}
            className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <span>🔄</span>
            <span>Copy / Repeat Roster</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setBulkTargetEmployees(employees.map(e => e.id));
              setIsBulkModalOpen(true);
            }}
            className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <span>⚡</span>
            <span>Bulk Shift &amp; Weekend Assigner</span>
          </button>

          <div className="flex bg-slate-100 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setView('monthly')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                view === 'monthly' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📅 Monthly Calendar
            </button>
            <button
              type="button"
              onClick={() => setView('holidays')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                view === 'holidays' ? 'bg-white text-amber-800 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🎉 Holidays &amp; Special Off-Days</span>
              {companyHolidays.length > 0 && (
                <span className="px-1.5 py-0.2 bg-amber-500 text-white rounded-full text-[10px] font-black">
                  {companyHolidays.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setView('custom')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                view === 'custom' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⚙️ Custom Builder
            </button>
          </div>
        </div>
      </div>

      {/* VIEW 1: MONTHLY CALENDAR */}
      {view === 'monthly' && (
        <>
          <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Select Employee</label>
                <select
                  value={selectedEmployee}
                  onChange={e => setSelectedEmployee(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-semibold bg-white cursor-pointer"
                >
                  {employees.length === 0 ? (
                    <option value="">No employees</option>
                  ) : (
                    employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.employeeId})</option>)
                  )}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Month</label>
                <select
                  value={month}
                  onChange={e => setMonth(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-semibold bg-white cursor-pointer"
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i}>{new Date(2000, i, 1).toLocaleString('en-US', { month: 'long' })}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Year</label>
                <select
                  value={year}
                  onChange={e => setYear(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-semibold bg-white cursor-pointer"
                >
                  {[2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Assigned Profile Shift</label>
                <div className="px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 text-sm font-bold text-indigo-700">
                  {emp?.shift || 'Roster Governed (No fixed shift)'}
                </div>
              </div>
            </div>

            {/* Quick Shift Appliers */}
            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-700">Quick Apply to Month:</span>
                {shifts.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={async () => {
                      if (!emp) return;
                      const entries: RosterEntry[] = [];
                      for (let d = 1; d <= daysInMonth; d++) {
                        const dateStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
                        const docId = `${emp.employeeId || emp.id}_${dateStr}`;
                        entries.push({
                          id: docId,
                          employeeId: emp.employeeId || emp.id,
                          employeeName: emp.name,
                          date: dateStr,
                          shift: s.name,
                          isOffDay: false,
                          isExtraDay: false,
                          effectiveFrom: `${monthPrefix}-01`,
                        });
                      }
                      await saveRosterEntries(entries);
                      addNotification({
                        title: '📅 Roster Updated',
                        message: `All days of ${monthName} set to ${s.name} for ${emp.name}.`,
                        read: false,
                        type: 'system',
                        targetPage: 'roster',
                      });
                    }}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-200/60 transition-all cursor-pointer"
                  >
                    All → {s.name}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCopyScope('selected');
                    setCopyDurationMonths(1);
                    setIsCopyModalOpen(true);
                  }}
                  className="text-xs px-3 py-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg font-bold border border-emerald-200 transition-all cursor-pointer"
                >
                  🔄 Copy Prev Month ({emp?.name || 'Employee'})
                </button>
                <button
                  type="button"
                  onClick={handleClearMonth}
                  className="text-xs px-3 py-1 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg font-bold border border-rose-200 transition-all cursor-pointer"
                >
                  Clear Month Entries
                </button>
              </div>
            </div>
          </div>

          {/* Auto-Continued Roster Banner when viewing a future month without explicit Firestore entries */}
          {Object.keys(employeeRoster).length === 0 && autoContinuedSourceMonth && (
            <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 border border-emerald-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-start space-x-3">
                <span className="text-xl mt-0.5">🔁</span>
                <div>
                  <h4 className="text-xs sm:text-sm font-black text-emerald-950">
                    Auto-Active Next Month Pattern (Continued from {autoContinuedSourceMonth})
                  </h4>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    {emp?.name}&apos;s weekly shift &amp; weekend/off-day schedule from <span className="font-bold">{autoContinuedSourceMonth}</span> is automatically active for <span className="font-bold">{monthName} {year}</span>. Attendance, Reports, and Payroll will follow this schedule automatically, or you can lock/save it to Firestore now.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleLockAutoContinuedMonthForEmployee}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                >
                  💾 Save {monthName} for {emp?.name}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCopyScope('all');
                    setCopyDurationMonths(1);
                    setIsCopyModalOpen(true);
                  }}
                  className="px-3.5 py-2 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  🔄 Copy for All Employees
                </button>
              </div>
            </div>
          )}

          {/* Month Stats */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl p-4 shadow-xs">
              <p className="text-[10px] sm:text-xs opacity-90 font-bold uppercase tracking-wider">Scheduled Work Days</p>
              <p className="text-2xl sm:text-3xl font-black mt-1 font-mono">{totalWorkingDays}</p>
            </div>
            <div className="bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-2xl p-4 shadow-xs">
              <p className="text-[10px] sm:text-xs opacity-90 font-bold uppercase tracking-wider">Roster Weekend / Off Days</p>
              <p className="text-2xl sm:text-3xl font-black mt-1 font-mono">{totalOffDays}</p>
            </div>
            <div className="bg-gradient-to-br from-purple-500 to-violet-600 text-white rounded-2xl p-4 shadow-xs">
              <p className="text-[10px] sm:text-xs opacity-90 font-bold uppercase tracking-wider">Extra / OT Days</p>
              <p className="text-2xl sm:text-3xl font-black mt-1 font-mono">{totalExtraDays}</p>
            </div>
          </div>

          {/* Monthly Calendar Grid */}
          <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-base sm:text-lg font-black text-slate-900">{monthName} {year}</h3>
                  {Object.keys(employeeRoster).length === 0 && autoContinuedSourceMonth && (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-full text-[10px] font-bold">
                      🔁 Auto-Active Pattern
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Click any day to change shift or mark Weekend/Off. All changes sync immediately.</p>
              </div>
              {emp && (
                <div className="text-left sm:text-right">
                  <p className="text-xs font-bold text-slate-900">{emp.name}</p>
                  <p className="text-[11px] text-slate-500 font-mono">ID: {emp.employeeId} • {emp.department}</p>
                </div>
              )}
            </div>

            <div className="overflow-x-auto thin-scroll">
              <div className="min-w-[680px]">
                <div className="grid grid-cols-7 gap-2 mb-3">
                  {DAYS.map((d) => (
                    <div key={d} className="text-center text-[11px] font-bold uppercase tracking-wider py-2 text-slate-600 bg-slate-50 rounded-xl border border-slate-100">
                      {d}
                    </div>
                  ))}
                  {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`}></div>)}
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                    const data = employeeRoster[day] || ensureEntry(day);
                    const isOff = data.isOff;
                    const isExtra = data.isExtra;
                    const shift = data.shift;
                    const isAuto = Boolean((data as any).isAutoContinued);
                    const dayDateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`;
                    const matchedHoliday = companyHolidays.find(h => {
                      const s = h.startDate;
                      const e = h.endDate || h.startDate;
                      return dayDateStr >= s && dayDateStr <= e;
                    });
                    const isDutyException = Boolean(
                      matchedHoliday &&
                      (matchedHoliday.dutyEmployeeIds || []).some(
                        id => id === emp?.id || id === emp?.employeeId
                      )
                    );

                    return (
                      <div
                        key={day}
                        className={`min-h-[115px] border-2 rounded-2xl p-2.5 text-xs transition-all flex flex-col justify-between ${
                          matchedHoliday && !isDutyException
                            ? 'bg-gradient-to-br from-amber-50 via-orange-50/80 to-yellow-50 border-amber-400 shadow-xs'
                            : isDutyException
                            ? 'bg-gradient-to-br from-rose-50 via-orange-50/60 to-amber-50 border-rose-400 shadow-xs'
                            : isOff
                            ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-300 shadow-xs'
                            : isExtra
                            ? 'bg-gradient-to-br from-purple-50 via-fuchsia-50 to-pink-50 border-purple-300 shadow-xs'
                            : 'bg-gradient-to-br from-indigo-50/50 to-blue-50/50 border-indigo-200/80 hover:border-indigo-400'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`font-black text-sm font-mono ${matchedHoliday ? 'text-amber-950 font-black' : isOff ? 'text-amber-800' : isExtra ? 'text-purple-800' : 'text-slate-900'}`}>
                            {day}
                          </span>
                          <div className="flex items-center space-x-1">
                            {isAuto && (
                              <span
                                title="Auto-continued from previous month roster pattern"
                                className="text-[9px] px-1 py-0.5 rounded font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"
                              >
                                Auto
                              </span>
                            )}
                            {isDutyException ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-black bg-rose-600 text-white" title="Scheduled on duty exception during official holiday">
                                ⚡ Duty
                              </span>
                            ) : matchedHoliday ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-black bg-amber-500 text-white" title={matchedHoliday.title}>
                                Holiday
                              </span>
                            ) : isOff ? (
                              <span className="text-xs px-1.5 py-0.5 rounded font-bold bg-amber-200 text-amber-900">Off</span>
                            ) : isExtra ? (
                              <span className="text-xs px-1.5 py-0.5 rounded font-bold bg-purple-200 text-purple-900">OT</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 bg-indigo-600 text-white rounded font-bold uppercase">Work</span>
                            )}
                          </div>
                        </div>

                        {matchedHoliday && (
                          <div
                            title={`Official Holiday: ${matchedHoliday.title}`}
                            className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold mb-1.5 truncate border ${
                              isDutyException
                                ? 'bg-rose-100 text-rose-900 border-rose-300'
                                : 'bg-amber-100 text-amber-950 border-amber-300'
                            }`}
                          >
                            {isDutyException ? '⚡ On-Duty Crew' : `🎉 ${matchedHoliday.title}`}
                          </div>
                        )}

                        {!isOff ? (
                          <select
                            value={shift}
                            onChange={e => handleShiftChange(day, e.target.value)}
                            className="w-full text-[11px] px-1.5 py-1 border border-slate-200 rounded-lg font-bold bg-white mb-2 cursor-pointer focus:ring-1 focus:ring-indigo-500"
                          >
                            {shifts.map(s => (
                              <option key={s.id} value={s.name}>
                                {s.name} ({s.startTime}-{s.endTime})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="text-[11px] text-amber-800 font-bold mb-2 text-center py-1 bg-amber-100/80 rounded-lg">
                            🏖️ Weekend / Off
                          </div>
                        )}

                        <div className="flex space-x-1 pt-1 border-t border-slate-200/50">
                          <button
                            type="button"
                            onClick={() => toggleOffDay(day)}
                            className={`flex-1 text-[10px] px-1 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                              isOff ? 'bg-amber-200 hover:bg-amber-300 text-amber-900' : 'bg-white hover:bg-amber-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {isOff ? 'Make Work' : 'Set Off'}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExtraDay(day)}
                            className={`flex-1 text-[10px] px-1 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                              isExtra ? 'bg-purple-200 hover:bg-purple-300 text-purple-900' : 'bg-white hover:bg-purple-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {isExtra ? 'Normal' : 'Extra OT'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex flex-wrap gap-4 text-xs font-semibold">
              <div className="flex items-center space-x-2"><span className="w-3.5 h-3.5 bg-amber-400 rounded border border-amber-500"></span><span className="text-slate-700">Official Declared Holiday (Eid / Puja / Govt)</span></div>
              <div className="flex items-center space-x-2"><span className="w-3.5 h-3.5 bg-rose-500 rounded border border-rose-600"></span><span className="text-slate-700">Holiday On-Duty Exception</span></div>
              <div className="flex items-center space-x-2"><span className="w-3.5 h-3.5 bg-amber-200 rounded border border-amber-300"></span><span className="text-slate-700">Roster Weekend / Regular Off Day</span></div>
              <div className="flex items-center space-x-2"><span className="w-3.5 h-3.5 bg-purple-300 rounded border border-purple-400"></span><span className="text-slate-700">Extra / OT Day</span></div>
              <div className="flex items-center space-x-2"><span className="w-3.5 h-3.5 bg-indigo-200 rounded border border-indigo-300"></span><span className="text-slate-700">Working Shift Day</span></div>
              <div className="flex items-center space-x-2"><span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded text-[10px] font-bold">Auto</span><span className="text-slate-700">Auto-Continued from Previous Month</span></div>
            </div>
          </div>
        </>
      )}

      {/* VIEW 2: SPECIAL OFF-DAYS & HOLIDAYS MANAGEMENT */}
      {view === 'holidays' && (
        <HolidayOffDayManager onClose={() => setView('monthly')} />
      )}

      {/* VIEW 3: CUSTOM ROSTER BUILDER */}
      {view === 'custom' && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
          <div>
            <h3 className="text-lg font-black text-slate-900">Custom Roster Builder</h3>
            <p className="text-xs text-slate-500 mt-0.5">Generate shift patterns and specific off days for selected staff members across 1 or multiple months</p>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">1. Select Employees</label>
            <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200 max-h-48 overflow-y-auto">
              {employees.map(empItem => (
                <button
                  key={empItem.id}
                  type="button"
                  onClick={() => {
                    setCustomEmployees(prev => prev.includes(empItem.id) ? prev.filter(x => x !== empItem.id) : [...prev, empItem.id]);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                    customEmployees.includes(empItem.id)
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-700 hover:border-indigo-300'
                  }`}
                >
                  {empItem.avatar && (empItem.avatar.startsWith('data:image/') || empItem.avatar.startsWith('http://') || empItem.avatar.startsWith('https://')) ? (
                    <img src={empItem.avatar} alt={empItem.name} className="w-4 h-4 rounded-full object-cover shrink-0" />
                  ) : (
                    <span>{empItem.avatar || '👤'}</span>
                  )}
                  <span>{empItem.name}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1">{customEmployees.length} employee(s) selected</p>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">2. Date Range &amp; Multi-Month Quick Presets</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: `This Month (${monthName})`, months: 1, next: false },
                  { label: 'Next Month', months: 1, next: true },
                  { label: 'Next 3 Months', months: 3, next: false },
                  { label: 'Next 6 Months', months: 6, next: false },
                  { label: 'Full Year (12M)', months: 12, next: false },
                ].map(p => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      const r = computePresetDateRange(p.months, p.next);
                      setCustomStartDate(r.start);
                      setCustomEndDate(r.end);
                    }}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Start Date</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">End Date</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Working Shift</label>
                <select
                  value={customShiftSelection}
                  onChange={e => setCustomShiftSelection(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  {shifts.map(s => (
                    <option key={s.id} value={s.name}>
                      {s.name} ({s.startTime}-{s.endTime})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">3. Select Off Days (Optional)</label>
            <div className="flex gap-2 flex-wrap">
              {DAYS.map((dayName, idx) => (
                <button
                  key={dayName}
                  type="button"
                  onClick={() => {
                    setCustomOffDays(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx]);
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    customOffDays.includes(idx) ? 'bg-amber-500 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {dayName} {customOffDays.includes(idx) ? '✓' : ''}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={generateCustomRoster}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
            >
              Generate Preview
            </button>
            {customGenerated.length > 0 && (
              <button
                type="button"
                onClick={applyCustomRoster}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              >
                Save {customGenerated.length} Entries to Firestore
              </button>
            )}
          </div>

          {customGenerated.length > 0 && (
            <div className="pt-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Preview ({customGenerated.length} records ready to save):</h4>
              <div className="border border-slate-200 rounded-2xl max-h-56 overflow-y-auto thin-scroll">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0 font-bold text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Employee</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Shift Assignment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {customGenerated.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5">{item.employeeName}</td>
                        <td className="px-3 py-1.5 font-mono">{item.date}</td>
                        <td className="px-3 py-1.5 font-bold">
                          <span className={`px-2 py-0.5 rounded text-[11px] ${item.isOffDay ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'}`}>
                            {item.shift}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* COPY / REPEAT PREVIOUS MONTH ROSTER MODAL */}
      {isCopyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-slate-200 animate-scale-in space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">🔄 Copy &amp; Auto-Repeat Roster Pattern</h3>
                <p className="text-xs text-slate-500">
                  Carry forward a previous month&apos;s shift &amp; weekend/off-day schedule into upcoming month(s)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCopyModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* 1. Source Month Selection */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                1. Copy From Source Month
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 block mb-1">Source Month</label>
                  <select
                    value={copySourceMonth}
                    onChange={e => setCopySourceMonth(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-white cursor-pointer"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={i}>
                        {new Date(2000, i, 1).toLocaleString('en-US', { month: 'long' })}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 block mb-1">Source Year</label>
                  <select
                    value={copySourceYear}
                    onChange={e => setCopySourceYear(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-white cursor-pointer"
                  >
                    {[2025, 2026, 2027, 2028].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 2. Target Scope (All Employees vs Selected Employee) */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                2. Target Employee Scope
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setCopyScope('all')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    copyScope === 'all'
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-950 shadow-2xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-black">👥 All Employees ({employees.length})</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Copy everyone&apos;s roster in bulk</p>
                </button>
                <button
                  type="button"
                  onClick={() => setCopyScope('selected')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    copyScope === 'selected'
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-950 shadow-2xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-black truncate">👤 {emp?.name || 'Selected Employee'}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Copy only for selected employee</p>
                </button>
              </div>
            </div>

            {/* 3. Repeat Duration (1, 3, 6, 12 Months starting from currently viewed month) */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                3. Apply Starting From {monthName} {year} For:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { months: 1, label: `1 Month (${monthName})` },
                  { months: 3, label: '3 Months' },
                  { months: 6, label: '6 Months' },
                  { months: 12, label: 'Full Year (12M)' },
                ].map(item => (
                  <button
                    key={item.months}
                    type="button"
                    onClick={() => setCopyDurationMonths(item.months)}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      copyDurationMonths === item.months
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Pattern Matching Mode */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                4. Pattern Matching Rule
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setCopyMode('weekly_pattern')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    copyMode === 'weekly_pattern'
                      ? 'bg-indigo-50 border-indigo-400 text-indigo-950'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-black">📅 Weekly Day-of-Week Pattern (Recommended)</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Matches Fri→Fri, Sat→Sat so weekly off days and shifts stay on the right weekday
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setCopyMode('exact_date')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    copyMode === 'exact_date'
                      ? 'bg-indigo-50 border-indigo-400 text-indigo-950'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-black">🔢 Exact Date Number (Day 1 → Day 1)</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Copies Day 1 to Day 1, Day 2 to Day 2 regardless of weekday
                  </p>
                </button>
              </div>
            </div>

            {/* 5. Existing Entries Conflict Option */}
            <div className="flex items-center justify-between bg-slate-50 px-4 py-3 rounded-2xl border border-slate-200">
              <span className="text-xs font-bold text-slate-700">If target month already has entries:</span>
              <select
                value={copyConflictMode}
                onChange={e => setCopyConflictMode(e.target.value as 'overwrite' | 'fill_empty')}
                className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold bg-white cursor-pointer"
              >
                <option value="overwrite">Overwrite all days</option>
                <option value="fill_empty">Only fill unassigned days</option>
              </select>
            </div>

            {/* Preview Summary Box */}
            <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-2xl space-y-1 text-xs text-emerald-950">
              <p className="font-black">📋 Copy &amp; Repeat Preview:</p>
              <p>
                • Source Month: <span className="font-bold">{copySourceMonthLabel}</span> ({copyPreviewSummary.matchedEmployeesCount} of {copyPreviewSummary.targetEmployeesCount} employee(s) have saved roster in source month)
              </p>
              <p>
                • Target Period: <span className="font-bold">{monthName} {year}</span> ({copyDurationMonths} month{copyDurationMonths > 1 ? 's' : ''})
              </p>
              <p>
                • Total Entries to Save: <span className="font-black text-emerald-700">{copyPreviewSummary.totalEntriesToSave}</span> roster records
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsCopyModalOpen(false)}
                className="px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isCopySaving || copyPreviewSummary.totalEntriesToSave === 0}
                onClick={handleExecuteCopyPreviousMonth}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
              >
                {isCopySaving ? 'Copying to Firestore...' : `Confirm & Save (${copyPreviewSummary.totalEntriesToSave} Entries)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADVANCED BULK SHIFT & WEEKEND ASSIGNMENT MODAL */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-slate-200 animate-scale-in space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">⚡ Bulk Shift &amp; Weekend Assigner</h3>
                <p className="text-xs text-slate-500">Apply shifts or custom weekend days across multiple employees cleanly</p>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="flex bg-slate-100 p-1 rounded-2xl">
              <button
                type="button"
                onClick={() => setBulkMode('shift')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  bulkMode === 'shift' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                💼 Assign Working Shift
              </button>
              <button
                type="button"
                onClick={() => setBulkMode('weekend')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  bulkMode === 'weekend' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🏖️ Assign Weekend / Off Days
              </button>
            </div>

            {/* Target Employees Filter and Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Target Employees ({bulkTargetEmployees.length} of {employees.length} selected)
                </label>
                <div className="space-x-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setBulkTargetEmployees(filteredBulkEmployees.map(e => e.id))}
                    className="text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    type="button"
                    onClick={() => setBulkTargetEmployees([])}
                    className="text-slate-500 hover:text-slate-700 font-bold cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Search employee..."
                  value={bulkSearchTerm}
                  onChange={e => setBulkSearchTerm(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs"
                />
                <select
                  value={bulkDepartmentFilter}
                  onChange={e => setBulkDepartmentFilter(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs bg-white"
                >
                  <option value="all">All Departments</option>
                  {Array.from(new Set(employees.map(e => e.department).filter(Boolean))).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-2xl">
                {filteredBulkEmployees.map(empItem => {
                  const isChecked = bulkTargetEmployees.includes(empItem.id);
                  return (
                    <label
                      key={empItem.id}
                      className={`flex items-center space-x-2 p-1.5 rounded-xl border text-xs cursor-pointer select-none transition-all ${
                        isChecked ? 'bg-indigo-50 border-indigo-300 font-bold text-indigo-900' : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setBulkTargetEmployees(prev =>
                            prev.includes(empItem.id) ? prev.filter(x => x !== empItem.id) : [...prev, empItem.id]
                          );
                        }}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span className="truncate">{empItem.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Shift or Weekend Assignment Config */}
            {bulkMode === 'shift' ? (
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Select Working Shift to Assign
                </label>
                <select
                  value={bulkSelectedShift}
                  onChange={e => setBulkSelectedShift(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  {shifts.map(s => (
                    <option key={s.id} value={s.name}>
                      {s.name} ({s.startTime} - {s.endTime}) {s.type === 'flexible' ? '[Flexible]' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800">
                <span className="font-bold">🏖️ Weekend / Off Day Policy:</span> Selected dates will be explicitly assigned as Weekend/Off. WorkNest HR calculates attendance strictly based on this.
              </div>
            )}

            {/* Date Range & Multi-Month Quick Presets */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Quick Duration Presets:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: `This Month (${monthName})`, months: 1, next: false },
                    { label: 'Next Month', months: 1, next: true },
                    { label: 'Next 3 Months', months: 3, next: false },
                    { label: 'Next 6 Months', months: 6, next: false },
                    { label: 'Full Year (12M)', months: 12, next: false },
                  ].map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        const r = computePresetDateRange(p.months, p.next);
                        setBulkStartDate(r.start);
                        setBulkEndDate(r.end);
                      }}
                      className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Effective Start Date</label>
                  <input
                    type="date"
                    value={bulkStartDate}
                    onChange={e => setBulkStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Effective End Date</label>
                  <input
                    type="date"
                    value={bulkEndDate}
                    onChange={e => setBulkEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Day of Week Filter */}
            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                Apply On Days of the Week:
              </label>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((dName, idx) => {
                  const isDaySelected = bulkDaysOfWeek.includes(idx);
                  return (
                    <button
                      key={dName}
                      type="button"
                      onClick={() => {
                        setBulkDaysOfWeek(prev =>
                          prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx]
                        );
                      }}
                      className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        isDaySelected
                          ? (bulkMode === 'weekend' ? 'bg-amber-500 text-white shadow-xs' : 'bg-indigo-600 text-white shadow-xs')
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {dName}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(false)}
                className="px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBulkSaving || bulkTargetEmployees.length === 0}
                onClick={handleExecuteBulkAssignment}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
              >
                {isBulkSaving ? 'Saving to Firestore...' : 'Confirm & Save Roster'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HOLIDAY & SPECIAL OFF-DAY MODAL */}
      {isHolidayModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-y-auto p-4 sm:p-6 shadow-2xl border border-slate-200">
            <HolidayOffDayManager isModal={true} onClose={() => setIsHolidayModalOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
