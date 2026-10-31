import { useState, useMemo } from 'react';
import { useData, Shift, Employee, ShiftAssignmentRecord } from '../context/DataContext';
import {
  isShiftOvertimeEnabled,
  offsetDateStr,
  formatEffectiveDateDisplay,
  sortShiftHistoryAsc,
  getShiftAssignmentStatus,
  validateShiftHistoryNoOverlap,
  resolveEmployeeShiftNameForDate,
  getBangladeshTodayStr,
} from '../utils/attendanceScheduleEngine';
import {
  COLOR_KEYS,
  THEME_PALETTES,
  SHIFT_ICONS,
  ThemeColorKey,
  getShiftTheme,
} from '../utils/themeColors';

export function ShiftManagement() {
  const { shifts, employees, updateEmployee, addShift, updateShift, deleteShift, addNotification } = useData();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const todayStr = useMemo(() => getBangladeshTodayStr(), []);

  // Date-Wise Shift Assignment & History states
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string>('');
  const [previousShiftName, setPreviousShiftName] = useState<string>('');
  const [previousEffectiveFrom, setPreviousEffectiveFrom] = useState<string>('');
  const [previousEffectiveTo, setPreviousEffectiveTo] = useState<string>('');
  const [newShiftName, setNewShiftName] = useState<string>('');
  const [newEffectiveFrom, setNewEffectiveFrom] = useState<string>(todayStr);
  const [newEffectiveTo, setNewEffectiveTo] = useState<string>('');
  const [assignmentNote, setAssignmentNote] = useState<string>('');
  const [assignError, setAssignError] = useState<string>('');
  const [isConfirmingPastChange, setIsConfirmingPastChange] = useState<boolean>(false);
  const [isSavingAssignment, setIsSavingAssignment] = useState<boolean>(false);

  // Department-Wise Shift Assignment states
  const [showDeptAssignModal, setShowDeptAssignModal] = useState<boolean>(false);
  const [deptAssignDepartment, setDeptAssignDepartment] = useState<string>('');
  const [deptAssignShiftName, setDeptAssignShiftName] = useState<string>('');
  const [deptAssignEffectiveFrom, setDeptAssignEffectiveFrom] = useState<string>(todayStr);
  const [deptAssignEffectiveTo, setDeptAssignEffectiveTo] = useState<string>('');
  const [deptAssignNote, setDeptAssignNote] = useState<string>('');
  const [deptAssignError, setDeptAssignError] = useState<string>('');
  const [isSavingDeptAssign, setIsSavingDeptAssign] = useState<boolean>(false);

  const handleOpenDeptAssignModal = (preselectedDept?: string) => {
    setDeptAssignError('');
    const allDepts = Array.from(new Set(employees.map(e => e.department).filter(Boolean)));
    const targetDept = preselectedDept || allDepts[0] || '';
    setDeptAssignDepartment(targetDept);
    setDeptAssignShiftName(shifts[0]?.name || '');
    setDeptAssignEffectiveFrom(todayStr);
    setDeptAssignEffectiveTo('');
    setDeptAssignNote('');
    setShowDeptAssignModal(true);
  };

  const handleSaveDeptShiftAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptAssignDepartment || !deptAssignShiftName) {
      setDeptAssignError('Please select both a Department and a Shift.');
      return;
    }
    const targetEmployees = employees.filter(
      e => e.department?.toLowerCase() === deptAssignDepartment.toLowerCase()
    );
    if (targetEmployees.length === 0) {
      setDeptAssignError(`No employees found in department "${deptAssignDepartment}".`);
      return;
    }

    setIsSavingDeptAssign(true);
    setDeptAssignError('');
    try {
      for (const emp of targetEmployees) {
        const history = getNormalizedEmployeeShiftHistory(emp);
        let updatedHistory = history.map(h => {
          if (!h.effectiveTo || h.effectiveTo >= deptAssignEffectiveFrom) {
            const closedTo = offsetDateStr(deptAssignEffectiveFrom, -1);
            return {
              ...h,
              effectiveTo: closedTo < h.effectiveFrom ? h.effectiveFrom : closedTo,
            };
          }
          return h;
        });

        const newRecord: ShiftAssignmentRecord = {
          id: `shift_${emp.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          employeeId: emp.employeeId || emp.id,
          employeeName: emp.name,
          shiftName: deptAssignShiftName.trim(),
          effectiveFrom: deptAssignEffectiveFrom,
          effectiveTo: deptAssignEffectiveTo.trim() ? deptAssignEffectiveTo.trim() : null,
          note: deptAssignNote.trim() || `Department shift change (${deptAssignDepartment})`,
        };

        updatedHistory.push(newRecord);
        updatedHistory = sortShiftHistoryAsc(updatedHistory);

        const effectiveShiftToday = resolveEmployeeShiftNameForDate(
          { ...emp, shiftHistory: updatedHistory },
          todayStr
        );

        await updateEmployee(emp.id, {
          shift: effectiveShiftToday || deptAssignShiftName.trim(),
          shiftHistory: updatedHistory,
        });
      }

      addNotification({
        title: '🏢 Department Shift Assigned',
        message: `Department "${deptAssignDepartment}" (${targetEmployees.length} staff): Shift updated to "${deptAssignShiftName}" effective from ${formatEffectiveDateDisplay(deptAssignEffectiveFrom)}.`,
        read: false,
        type: 'system',
        targetPage: 'shift',
      });

      setShowDeptAssignModal(false);
    } catch (err: any) {
      setDeptAssignError(err?.message || 'Failed to assign shift to department.');
    } finally {
      setIsSavingDeptAssign(false);
    }
  };

  // Shift History Filters & Date Lookup Inspector
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyEmployeeFilter, setHistoryEmployeeFilter] = useState<string>('all');
  const [historyShiftFilter, setHistoryShiftFilter] = useState<string>('all');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'all' | 'Active' | 'Scheduled' | 'Completed'>('all');
  const [lookupDate, setLookupDate] = useState<string>('');

  // Editing / Deleting a specific historical shift period (with confirmation warning per Req 10)
  const [editingHistoryTarget, setEditingHistoryTarget] = useState<{
    employee: Employee;
    entry: ShiftAssignmentRecord;
    pastWarningConfirmed: boolean;
    shiftName: string;
    effectiveFrom: string;
    effectiveTo: string;
    note: string;
    error: string;
  } | null>(null);
  const [deletingHistoryTarget, setDeletingHistoryTarget] = useState<{
    employee: Employee;
    entry: ShiftAssignmentRecord;
  } | null>(null);

  // Build normalized shift history for an employee (including fallback for employees who only have legacy emp.shift)
  const getNormalizedEmployeeShiftHistory = (emp: Employee): ShiftAssignmentRecord[] => {
    const sorted = sortShiftHistoryAsc(emp.shiftHistory);
    if (sorted.length > 0) return sorted;
    if (emp.shift && emp.shift.trim()) {
      const defaultFrom =
        emp.joinDate && /^\d{4}-\d{2}-\d{2}$/.test(emp.joinDate.trim())
          ? emp.joinDate.trim()
          : `${todayStr.slice(0, 7)}-01`;
      return [
        {
          id: `legacy_${emp.id}`,
          employeeId: emp.employeeId || emp.id,
          employeeName: emp.name,
          shiftName: emp.shift.trim(),
          effectiveFrom: defaultFrom,
          effectiveTo: null,
          note: 'Current assigned shift',
        },
      ];
    }
    return [];
  };

  // Initialize assignment form when an employee is selected
  const initializeAssignmentForEmployee = (empId: string, preselectedNewShift?: string) => {
    setAssignError('');
    setIsConfirmingPastChange(false);
    setSelectedEmpId(empId);
    const emp = employees.find(e => e.id === empId || e.employeeId === empId);
    if (!emp) {
      setPreviousShiftName('');
      setPreviousEffectiveFrom(`${todayStr.slice(0, 7)}-01`);
      setPreviousEffectiveTo(offsetDateStr(todayStr, -1));
      setNewShiftName(preselectedNewShift || shifts[0]?.name || '');
      setNewEffectiveFrom(todayStr);
      setNewEffectiveTo('');
      return;
    }

    const history = getNormalizedEmployeeShiftHistory(emp);
    const latestEntry = history.length > 0 ? history[history.length - 1] : null;
    const prevName = latestEntry?.shiftName || emp.shift || '';
    const defaultNewFrom = todayStr;
    const defaultPrevTo = offsetDateStr(defaultNewFrom, -1);
    const defaultPrevFrom =
      latestEntry?.effectiveFrom && latestEntry.effectiveFrom <= defaultPrevTo
        ? latestEntry.effectiveFrom
        : emp.joinDate && /^\d{4}-\d{2}-\d{2}$/.test(emp.joinDate.trim()) && emp.joinDate.trim() <= defaultPrevTo
        ? emp.joinDate.trim()
        : `${defaultNewFrom.slice(0, 7)}-01` <= defaultPrevTo
        ? `${defaultNewFrom.slice(0, 7)}-01`
        : defaultPrevTo;

    setPreviousShiftName(prevName);
    setPreviousEffectiveFrom(defaultPrevFrom);
    setPreviousEffectiveTo(defaultPrevTo);

    const alternateShift =
      preselectedNewShift ||
      shifts.find(s => s.name !== prevName)?.name ||
      shifts[0]?.name ||
      '';
    setNewShiftName(alternateShift);
    setNewEffectiveFrom(defaultNewFrom);
    setNewEffectiveTo('');
    setAssignmentNote('');
  };

  const handleOpenAssignModal = (empId?: string, preselectedShiftName?: string) => {
    const targetEmpId = empId || employees[0]?.id || '';
    initializeAssignmentForEmployee(targetEmpId, preselectedShiftName);
    setShowAssignModal(true);
  };

  // Keep previousEffectiveTo synced to (newEffectiveFrom - 1 day) when newEffectiveFrom changes
  const handleNewEffectiveFromChange = (nextDate: string) => {
    setNewEffectiveFrom(nextDate);
    setAssignError('');
    if (nextDate) {
      const autoPrevTo = offsetDateStr(nextDate, -1);
      setPreviousEffectiveTo(autoPrevTo);
      if (previousEffectiveFrom && previousEffectiveFrom > autoPrevTo) {
        const monthStart = `${nextDate.slice(0, 7)}-01`;
        setPreviousEffectiveFrom(monthStart <= autoPrevTo ? monthStart : autoPrevTo);
      }
    }
  };

  // Selected employee in Assign Modal
  const selectedAssignEmployee = useMemo(
    () => employees.find(e => e.id === selectedEmpId || e.employeeId === selectedEmpId) || null,
    [employees, selectedEmpId]
  );

  const selectedEmployeeHistory = useMemo(
    () => (selectedAssignEmployee ? getNormalizedEmployeeShiftHistory(selectedAssignEmployee) : []),
    [selectedAssignEmployee, todayStr]
  );

  // Confirm Date-Wise Shift Assignment
  const handleConfirmShiftAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setAssignError('');

    if (!selectedAssignEmployee) {
      setAssignError('Please select an employee.');
      return;
    }
    if (!newShiftName.trim()) {
      setAssignError('Please select the new shift to assign.');
      return;
    }
    if (!newEffectiveFrom) {
      setAssignError('Please select the Effective From date for the new shift.');
      return;
    }
    if (newEffectiveTo && newEffectiveTo < newEffectiveFrom) {
      setAssignError('New Shift Effective To date cannot be earlier than Effective From date.');
      return;
    }

    const rawHistory = sortShiftHistoryAsc(selectedAssignEmployee.shiftHistory);
    let updatedHistory: ShiftAssignmentRecord[] = [];

    if (rawHistory.length === 0) {
      // Employee had only a single legacy shift (`emp.shift`) without history records yet
      if (previousShiftName && previousShiftName.trim()) {
        if (!previousEffectiveFrom) {
          setAssignError('Please specify the start date (Effective From) of the previous shift.');
          return;
        }
        if (previousEffectiveTo < previousEffectiveFrom) {
          setAssignError(
            `Previous shift Effective To (${formatEffectiveDateDisplay(previousEffectiveTo)}) cannot be earlier than Effective From (${formatEffectiveDateDisplay(previousEffectiveFrom)}).`
          );
          return;
        }
        if (previousEffectiveTo >= newEffectiveFrom) {
          setAssignError(
            `Overlapping dates! Previous shift must end before the new shift starts on ${formatEffectiveDateDisplay(newEffectiveFrom)}.`
          );
          return;
        }
        const prevShiftObj = shifts.find(
          s => s.name.trim().toLowerCase() === previousShiftName.trim().toLowerCase()
        );
        updatedHistory.push({
          id: `sh_prev_${Date.now()}`,
          employeeId: selectedAssignEmployee.employeeId || selectedAssignEmployee.id,
          employeeName: selectedAssignEmployee.name,
          shiftId: prevShiftObj?.id,
          shiftName: prevShiftObj?.name || previousShiftName.trim(),
          effectiveFrom: previousEffectiveFrom,
          effectiveTo: previousEffectiveTo,
          assignedAt: new Date().toISOString(),
          note: 'Historical shift period preserved',
          ...(prevShiftObj
            ? {
                startTime: prevShiftObj.startTime,
                endTime: prevShiftObj.endTime,
                graceTime: prevShiftObj.graceTime,
                breakTime: prevShiftObj.breakTime,
                totalHours: prevShiftObj.totalHours,
                type: prevShiftObj.type,
                latePolicyEnabled: prevShiftObj.latePolicyEnabled,
                latePenaltyMode: prevShiftObj.latePenaltyMode,
                earlyOutPolicyEnabled: prevShiftObj.earlyOutPolicyEnabled,
                earlyOutTolerance: prevShiftObj.earlyOutTolerance,
                overtimePolicyEnabled: prevShiftObj.overtimePolicyEnabled,
                minOvertimeMinutes: prevShiftObj.minOvertimeMinutes,
                maxOvertimeHours: prevShiftObj.maxOvertimeHours,
                halfDayMinHours: prevShiftObj.halfDayMinHours,
              }
            : {}),
        });
      }
    } else {
      // Employee already has date-wise shift history
      const prevTo = previousEffectiveTo || offsetDateStr(newEffectiveFrom, -1);

      // Check if newEffectiveFrom is inside a past/closed period -> warn user before modifying past history (Req 10)
      const affectsPastClosedPeriod = rawHistory.some(
        h => h.effectiveTo && h.effectiveTo >= newEffectiveFrom
      );
      if ((affectsPastClosedPeriod || newEffectiveFrom < todayStr) && !isConfirmingPastChange) {
        setIsConfirmingPastChange(true);
        return;
      }

      for (const item of rawHistory) {
        if (!item.effectiveTo) {
          // Open-ended current/latest shift: close it on prevTo (the day before newEffectiveFrom)
          const effFrom = previousEffectiveFrom && item === rawHistory[rawHistory.length - 1]
            ? previousEffectiveFrom
            : item.effectiveFrom;
          if (effFrom < newEffectiveFrom) {
            const closedTo = prevTo >= effFrom ? prevTo : offsetDateStr(newEffectiveFrom, -1);
            const itemShiftObj = shifts.find(
              s => s.name.trim().toLowerCase() === (item.shiftName || '').trim().toLowerCase() || (item.shiftId && s.id === item.shiftId)
            );
            updatedHistory.push({
              ...item,
              effectiveFrom: effFrom,
              effectiveTo: closedTo,
              ...(itemShiftObj
                ? {
                    startTime: item.startTime || itemShiftObj.startTime,
                    endTime: item.endTime || itemShiftObj.endTime,
                    graceTime: item.graceTime ?? itemShiftObj.graceTime,
                    breakTime: item.breakTime ?? itemShiftObj.breakTime,
                    totalHours: item.totalHours ?? itemShiftObj.totalHours,
                    type: item.type || itemShiftObj.type,
                    latePolicyEnabled: item.latePolicyEnabled ?? itemShiftObj.latePolicyEnabled,
                    latePenaltyMode: item.latePenaltyMode || itemShiftObj.latePenaltyMode,
                    earlyOutPolicyEnabled: item.earlyOutPolicyEnabled ?? itemShiftObj.earlyOutPolicyEnabled,
                    earlyOutTolerance: item.earlyOutTolerance ?? itemShiftObj.earlyOutTolerance,
                    overtimePolicyEnabled: item.overtimePolicyEnabled ?? itemShiftObj.overtimePolicyEnabled,
                    minOvertimeMinutes: item.minOvertimeMinutes ?? itemShiftObj.minOvertimeMinutes,
                    maxOvertimeHours: item.maxOvertimeHours ?? itemShiftObj.maxOvertimeHours,
                    halfDayMinHours: item.halfDayMinHours ?? itemShiftObj.halfDayMinHours,
                  }
                : {}),
            });
          } else {
            // If the open shift had the exact same effectiveFrom as newEffectiveFrom, it is replaced for that start date
            if (effFrom > newEffectiveFrom) {
              updatedHistory.push(item);
            }
          }
        } else {
          updatedHistory.push(item);
        }
      }
    }

    const matchedNewShift = shifts.find(s => s.name.trim().toLowerCase() === newShiftName.trim().toLowerCase());
    const newRecord: ShiftAssignmentRecord = {
      id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      employeeId: selectedAssignEmployee.employeeId || selectedAssignEmployee.id,
      employeeName: selectedAssignEmployee.name,
      shiftId: matchedNewShift?.id,
      shiftName: matchedNewShift?.name || newShiftName.trim(),
      effectiveFrom: newEffectiveFrom,
      effectiveTo: newEffectiveTo ? newEffectiveTo.trim() : null,
      assignedAt: new Date().toISOString(),
      note: assignmentNote.trim() || (newEffectiveFrom > todayStr ? 'Scheduled future shift change' : 'Date-wise shift assignment'),
      ...(matchedNewShift
        ? {
            startTime: matchedNewShift.startTime,
            endTime: matchedNewShift.endTime,
            graceTime: matchedNewShift.graceTime,
            breakTime: matchedNewShift.breakTime,
            totalHours: matchedNewShift.totalHours,
            type: matchedNewShift.type,
            latePolicyEnabled: matchedNewShift.latePolicyEnabled,
            latePenaltyMode: matchedNewShift.latePenaltyMode,
            earlyOutPolicyEnabled: matchedNewShift.earlyOutPolicyEnabled,
            earlyOutTolerance: matchedNewShift.earlyOutTolerance,
            overtimePolicyEnabled: matchedNewShift.overtimePolicyEnabled,
            minOvertimeMinutes: matchedNewShift.minOvertimeMinutes,
            maxOvertimeHours: matchedNewShift.maxOvertimeHours,
            halfDayMinHours: matchedNewShift.halfDayMinHours,
          }
        : {}),
    };

    updatedHistory.push(newRecord);
    updatedHistory = sortShiftHistoryAsc(updatedHistory);

    // Prevent overlapping shift assignments (Requirement 9)
    const validation = validateShiftHistoryNoOverlap(updatedHistory);
    if (!validation.valid) {
      setAssignError(validation.error || 'Overlapping shift dates are not allowed.');
      return;
    }

    setIsSavingAssignment(true);
    try {
      // Determine effective shift for today so future scheduled shifts don't overwrite today's active shift prematurely
      const effectiveShiftToday = resolveEmployeeShiftNameForDate(
        { ...selectedAssignEmployee, shiftHistory: updatedHistory },
        todayStr
      );

      await updateEmployee(selectedAssignEmployee.id, {
        shift: effectiveShiftToday || newShiftName.trim(),
        shiftHistory: updatedHistory,
      });

      addNotification({
        title: newEffectiveFrom > todayStr ? '📅 Future Shift Change Scheduled' : '✅ Date-Wise Shift Assigned',
        message: `${selectedAssignEmployee.name}: Assigned to "${newShiftName}" effective from ${formatEffectiveDateDisplay(newEffectiveFrom)}. Previous attendance history remains untouched.`,
        read: false,
        type: 'system',
        targetPage: 'shift',
      });

      setShowAssignModal(false);
      setIsConfirmingPastChange(false);
    } catch (err: any) {
      setAssignError(err?.message || 'Failed to save shift assignment.');
    } finally {
      setIsSavingAssignment(false);
    }
  };

  // Save edited historical period (with overlap validation and past confirmation)
  const handleSaveEditedHistoryPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHistoryTarget) return;
    const { employee, entry, shiftName, effectiveFrom, effectiveTo, note } = editingHistoryTarget;
    if (!shiftName || !effectiveFrom) {
      setEditingHistoryTarget({ ...editingHistoryTarget, error: 'Shift and Effective From date are required.' });
      return;
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      setEditingHistoryTarget({
        ...editingHistoryTarget,
        error: 'Effective To date cannot be earlier than Effective From date.',
      });
      return;
    }

    const baseHistory = getNormalizedEmployeeShiftHistory(employee);
    const nextHistory = sortShiftHistoryAsc(
      baseHistory.map(item =>
        item.id === entry.id
          ? {
              ...item,
              shiftId: shifts.find(s => s.name === shiftName)?.id,
              shiftName,
              effectiveFrom,
              effectiveTo: effectiveTo ? effectiveTo.trim() : null,
              note: note.trim(),
            }
          : item
      )
    );

    const validation = validateShiftHistoryNoOverlap(nextHistory);
    if (!validation.valid) {
      setEditingHistoryTarget({
        ...editingHistoryTarget,
        error: validation.error || 'Overlapping shift dates detected.',
      });
      return;
    }

    const effectiveShiftToday = resolveEmployeeShiftNameForDate(
      { ...employee, shiftHistory: nextHistory },
      todayStr
    );

    await updateEmployee(employee.id, {
      shift: effectiveShiftToday || employee.shift,
      shiftHistory: nextHistory,
    });

    addNotification({
      title: 'Shift Assignment Period Updated',
      message: `Updated shift period for ${employee.name} (${shiftName}: ${formatEffectiveDateDisplay(effectiveFrom)} – ${formatEffectiveDateDisplay(effectiveTo || null)}).`,
      read: false,
      type: 'system',
      targetPage: 'shift',
    });

    setEditingHistoryTarget(null);
  };

  const handleConfirmDeleteHistoryPeriod = async () => {
    if (!deletingHistoryTarget) return;
    const { employee, entry } = deletingHistoryTarget;
    const baseHistory = getNormalizedEmployeeShiftHistory(employee);
    const nextHistory = sortShiftHistoryAsc(baseHistory.filter(item => item.id !== entry.id));
    const effectiveShiftToday = resolveEmployeeShiftNameForDate(
      { ...employee, shiftHistory: nextHistory },
      todayStr
    );

    await updateEmployee(employee.id, {
      shift: effectiveShiftToday || employee.shift,
      shiftHistory: nextHistory,
    });

    addNotification({
      title: 'Shift History Entry Removed',
      message: `Removed "${entry.shiftName}" (${formatEffectiveDateDisplay(entry.effectiveFrom)} – ${formatEffectiveDateDisplay(entry.effectiveTo)}) for ${employee.name}.`,
      read: false,
      type: 'system',
      targetPage: 'shift',
    });

    setDeletingHistoryTarget(null);
  };

  // Flatten all employees' shift assignment history for the Shift Assignment History table
  const allShiftHistoryRows = useMemo(() => {
    const rows: {
      employee: Employee;
      entry: ShiftAssignmentRecord;
      status: 'Active' | 'Scheduled' | 'Completed';
      shiftObj?: Shift;
      shiftOnLookupDate?: string;
    }[] = [];

    employees.forEach(emp => {
      const history = getNormalizedEmployeeShiftHistory(emp);
      const shiftOnLookup = lookupDate ? resolveEmployeeShiftNameForDate(emp, lookupDate) : undefined;
      history.forEach(entry => {
        // If lookupDate is active, only show the entry that covers lookupDate (or matches the resolved shift on lookupDate)
        if (lookupDate) {
          const coversLookup =
            lookupDate >= entry.effectiveFrom && (!entry.effectiveTo || lookupDate <= entry.effectiveTo);
          const isEarliestBeforeLookup =
            entry === history[0] && lookupDate < history[0].effectiveFrom;
          if (!coversLookup && !isEarliestBeforeLookup) return;
        }

        const status = getShiftAssignmentStatus(entry, todayStr);
        const shiftObj = shifts.find(
          s => s.name.toLowerCase() === entry.shiftName.toLowerCase() || (entry.shiftId && s.id === entry.shiftId)
        );
        rows.push({
          employee: emp,
          entry,
          status,
          shiftObj,
          shiftOnLookupDate: shiftOnLookup,
        });
      });
    });

    return rows
      .filter(r => {
        if (historyEmployeeFilter !== 'all' && r.employee.id !== historyEmployeeFilter && r.employee.employeeId !== historyEmployeeFilter) {
          return false;
        }
        if (historyShiftFilter !== 'all' && r.entry.shiftName.toLowerCase() !== historyShiftFilter.toLowerCase()) {
          return false;
        }
        if (historyStatusFilter !== 'all' && r.status !== historyStatusFilter) {
          return false;
        }
        if (historySearch.trim()) {
          const q = historySearch.toLowerCase();
          return (
            r.employee.name.toLowerCase().includes(q) ||
            r.employee.employeeId.toLowerCase().includes(q) ||
            r.employee.department?.toLowerCase().includes(q) ||
            r.entry.shiftName.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (a.employee.name !== b.employee.name) return a.employee.name.localeCompare(b.employee.name);
        return b.entry.effectiveFrom.localeCompare(a.entry.effectiveFrom);
      });
  }, [employees, shifts, todayStr, lookupDate, historyEmployeeFilter, historyShiftFilter, historyStatusFilter, historySearch]);

  // Quick Policy Editing state for existing shifts
  const [policyEditingShift, setPolicyEditingShift] = useState<Shift | null>(null);
  const [policyFormData, setPolicyFormData] = useState<{
    latePolicyEnabled: boolean;
    latePenaltyMode: 'none' | 'mark_only' | 'salary_deduction';
    graceTime: number;
    earlyOutPolicyEnabled: boolean;
    earlyOutTolerance: number;
    earlyOutPenaltyMode: 'none' | 'mark_only' | 'half_day';
    overtimePolicyEnabled: boolean;
    minOvertimeMinutes: number;
    maxOvertimeHours: number;
    halfDayMinHours: number;
  }>({
    latePolicyEnabled: true,
    latePenaltyMode: 'salary_deduction',
    graceTime: 15,
    earlyOutPolicyEnabled: true,
    earlyOutTolerance: 15,
    earlyOutPenaltyMode: 'mark_only',
    overtimePolicyEnabled: true,
    minOvertimeMinutes: 30,
    maxOvertimeHours: 4,
    halfDayMinHours: 4,
  });

  const handleOpenPolicyModal = (s: Shift) => {
    setPolicyEditingShift(s);
    setPolicyFormData({
      latePolicyEnabled: s.latePolicyEnabled !== false,
      latePenaltyMode: s.latePenaltyMode || 'salary_deduction',
      graceTime: s.graceTime ?? 15,
      earlyOutPolicyEnabled: s.earlyOutPolicyEnabled !== false,
      earlyOutTolerance: s.earlyOutTolerance ?? 15,
      earlyOutPenaltyMode: s.earlyOutPenaltyMode || 'mark_only',
      overtimePolicyEnabled: isShiftOvertimeEnabled(s),
      minOvertimeMinutes: s.minOvertimeMinutes ?? 30,
      maxOvertimeHours: s.maxOvertimeHours ?? 4,
      halfDayMinHours: s.halfDayMinHours ?? 4,
    });
  };

  const handleSavePolicyModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policyEditingShift) return;

    await updateShift(policyEditingShift.id, {
      ...policyFormData,
    });

    addNotification({
      title: 'Shift Policies Updated',
      message: `Policies for "${policyEditingShift.name}" saved: Late ${policyFormData.latePolicyEnabled ? `(${policyFormData.graceTime}m grace)` : 'Disabled'}, Early Out ${policyFormData.earlyOutPolicyEnabled ? `(${policyFormData.earlyOutTolerance}m)` : 'Disabled'}.`,
      read: false,
      type: 'system',
      targetPage: 'shift',
    });

    setPolicyEditingShift(null);
  };

  const [formData, setFormData] = useState<{
    name: string;
    type: 'fixed' | 'flexible' | 'remote';
    startTime: string;
    endTime: string;
    breakTime: number;
    graceTime: number;
    totalHours: number;
    description: string;
    status: 'active' | 'inactive';
    color: ThemeColorKey;
    icon: string;
    // Flexible shift parameters
    flexibleMinHours: number;
    flexibleCoreStart: string;
    flexibleCoreEnd: string;
    // Policies
    latePolicyEnabled: boolean;
    latePenaltyMode: 'none' | 'mark_only' | 'salary_deduction';
    lateGraceLimit: number;
    earlyOutPolicyEnabled: boolean;
    earlyOutTolerance: number;
    earlyOutPenaltyMode: 'none' | 'mark_only' | 'half_day';
    overtimePolicyEnabled: boolean;
    minOvertimeMinutes: number;
    maxOvertimeHours: number;
    halfDayMinHours: number;
  }>({
    name: '',
    type: 'fixed',
    startTime: '09:00',
    endTime: '18:00',
    breakTime: 60,
    graceTime: 15,
    totalHours: 8,
    description: '',
    status: 'active',
    color: 'amber',
    icon: '☀️',
    flexibleMinHours: 8,
    flexibleCoreStart: '10:00',
    flexibleCoreEnd: '16:00',
    latePolicyEnabled: true,
    latePenaltyMode: 'salary_deduction',
    lateGraceLimit: 45,
    earlyOutPolicyEnabled: true,
    earlyOutTolerance: 15,
    earlyOutPenaltyMode: 'mark_only',
    overtimePolicyEnabled: true,
    minOvertimeMinutes: 30,
    maxOvertimeHours: 4,
    halfDayMinHours: 4,
  });

  const [timingChangeMode, setTimingChangeMode] = useState<'effective_date' | 'direct'>('direct');
  const [timingEffectiveFrom, setTimingEffectiveFrom] = useState<string>(() => getBangladeshTodayStr());

  const calcHours = (start: string, end: string, breakMin: number, type: 'fixed' | 'flexible' | 'remote', flexHours: number) => {
    if (type === 'flexible') return flexHours || 8;
    const [sh, sm] = (start || '00:00').split(':').map(Number);
    const [eh, em] = (end || '00:00').split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60;
    return Math.max(0, (mins - breakMin) / 60);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = calcHours(formData.startTime, formData.endTime, formData.breakTime, formData.type, formData.flexibleMinHours);
    const data: Omit<Shift, 'id'> = {
      ...formData,
      totalHours: total,
    };

    if (editing) {
      const timingChanged =
        editing.startTime !== formData.startTime ||
        editing.endTime !== formData.endTime ||
        (editing.graceTime ?? 15) !== formData.graceTime;

      await updateShift(editing.id, data);

      // If timing changed and user chose to apply from an Effective Date (preserving past attendance with old timing):
      if (timingChanged && timingChangeMode === 'effective_date' && timingEffectiveFrom) {
        const prevEndDate = offsetDateStr(timingEffectiveFrom, -1);
        const oldNameLower = (editing.name || '').trim().toLowerCase();
        const newNameClean = (data.name || editing.name || '').trim();

        for (const emp of employees) {
          const hist = getNormalizedEmployeeShiftHistory(emp);
          const usesThisShift =
            (emp.shift || '').trim().toLowerCase() === oldNameLower ||
            hist.some(h => !h.effectiveTo && (h.shiftName || '').trim().toLowerCase() === oldNameLower);
          if (!usesThisShift) continue;

          const nextHist: ShiftAssignmentRecord[] = [];
          let splitApplied = false;

          for (const h of hist) {
            const isTargetOpen =
              !h.effectiveTo &&
              ((h.shiftName || '').trim().toLowerCase() === oldNameLower || h.shiftId === editing.id);

            if (isTargetOpen && h.effectiveFrom < timingEffectiveFrom) {
              splitApplied = true;
              // Close previous period with snapshot of OLD timing
              nextHist.push({
                ...h,
                shiftId: editing.id,
                shiftName: newNameClean,
                effectiveTo: prevEndDate >= h.effectiveFrom ? prevEndDate : h.effectiveFrom,
                startTime: h.startTime || editing.startTime,
                endTime: h.endTime || editing.endTime,
                graceTime: h.graceTime ?? editing.graceTime ?? 15,
                breakTime: h.breakTime ?? editing.breakTime ?? 60,
                totalHours: h.totalHours ?? editing.totalHours ?? 8,
                type: h.type || editing.type || 'fixed',
                latePolicyEnabled: h.latePolicyEnabled ?? editing.latePolicyEnabled ?? true,
                latePenaltyMode: h.latePenaltyMode || editing.latePenaltyMode || 'salary_deduction',
                earlyOutPolicyEnabled: h.earlyOutPolicyEnabled ?? editing.earlyOutPolicyEnabled ?? true,
                earlyOutTolerance: h.earlyOutTolerance ?? editing.earlyOutTolerance ?? 15,
                overtimePolicyEnabled: h.overtimePolicyEnabled ?? editing.overtimePolicyEnabled ?? true,
                minOvertimeMinutes: h.minOvertimeMinutes ?? editing.minOvertimeMinutes ?? 30,
                maxOvertimeHours: h.maxOvertimeHours ?? editing.maxOvertimeHours,
                halfDayMinHours: h.halfDayMinHours ?? editing.halfDayMinHours ?? 4,
                note: h.note || `Previous timing (${editing.startTime}-${editing.endTime}) preserved`,
              });
              // Open new period from timingEffectiveFrom with NEW timing
              nextHist.push({
                id: `sh_time_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                employeeId: emp.employeeId || emp.id,
                employeeName: emp.name,
                shiftId: editing.id,
                shiftName: newNameClean,
                effectiveFrom: timingEffectiveFrom,
                effectiveTo: null,
                assignedAt: new Date().toISOString(),
                startTime: data.startTime,
                endTime: data.endTime,
                graceTime: data.graceTime,
                breakTime: data.breakTime,
                totalHours: data.totalHours,
                type: data.type,
                latePolicyEnabled: data.latePolicyEnabled,
                latePenaltyMode: data.latePenaltyMode,
                earlyOutPolicyEnabled: data.earlyOutPolicyEnabled,
                earlyOutTolerance: data.earlyOutTolerance,
                overtimePolicyEnabled: data.overtimePolicyEnabled,
                minOvertimeMinutes: data.minOvertimeMinutes,
                maxOvertimeHours: data.maxOvertimeHours,
                halfDayMinHours: data.halfDayMinHours,
                note: `Updated timing (${data.startTime}-${data.endTime}) from ${formatEffectiveDateDisplay(timingEffectiveFrom)}`,
              });
            } else {
              nextHist.push(
                isTargetOpen
                  ? {
                      ...h,
                      shiftName: newNameClean,
                      startTime: data.startTime,
                      endTime: data.endTime,
                      graceTime: data.graceTime,
                      breakTime: data.breakTime,
                      totalHours: data.totalHours,
                    }
                  : h
              );
            }
          }

          if (splitApplied || emp.shift !== newNameClean) {
            await updateEmployee(emp.id, {
              shift: newNameClean,
              shiftHistory: sortShiftHistoryAsc(nextHist),
            });
          }
        }
      }

      addNotification({
        title: 'Shift & Policies Updated',
        message: `${data.name} (${data.type === 'flexible' ? 'Flexible Shift' : `${data.startTime} - ${data.endTime}`}) saved to Firestore.`,
        read: false,
        type: 'system',
        targetPage: 'shift',
      });
    } else {
      await addShift(data);
      addNotification({
        title: 'New Shift Created',
        message: `${data.name} (${data.type === 'flexible' ? 'Flexible Shift' : `${data.startTime}-${data.endTime}`}) added with configured attendance policies.`,
        read: false,
        type: 'system',
        targetPage: 'shift',
      });
    }
    setShowForm(false);
    setEditing(null);
  };

  const handleEdit = (s: Shift, index: number) => {
    setEditing(s);
    setTimingChangeMode('direct');
    setTimingEffectiveFrom(getBangladeshTodayStr());
    const { theme, icon } = getShiftTheme(s, index);

    setFormData({
      name: s.name,
      type: s.type || 'fixed',
      startTime: s.startTime || '09:00',
      endTime: s.endTime || '18:00',
      breakTime: s.breakTime ?? 60,
      graceTime: s.graceTime ?? 15,
      totalHours: s.totalHours ?? 8,
      description: s.description || '',
      status: s.status || 'active',
      color: (s.color && s.color in THEME_PALETTES) ? (s.color as ThemeColorKey) : theme.key,
      icon: s.icon || icon,
      flexibleMinHours: s.flexibleMinHours ?? 8,
      flexibleCoreStart: s.flexibleCoreStart || '10:00',
      flexibleCoreEnd: s.flexibleCoreEnd || '16:00',
      latePolicyEnabled: s.latePolicyEnabled ?? true,
      latePenaltyMode: s.latePenaltyMode || 'salary_deduction',
      lateGraceLimit: s.lateGraceLimit ?? 45,
      earlyOutPolicyEnabled: s.earlyOutPolicyEnabled !== false,
      earlyOutTolerance: s.earlyOutTolerance ?? 15,
      earlyOutPenaltyMode: s.earlyOutPenaltyMode || 'mark_only',
      overtimePolicyEnabled: isShiftOvertimeEnabled(s),
      minOvertimeMinutes: s.minOvertimeMinutes ?? 30,
      maxOvertimeHours: s.maxOvertimeHours ?? 4,
      halfDayMinHours: s.halfDayMinHours ?? 4,
    });
    setShowForm(true);
  };

  const currentTheme = THEME_PALETTES[formData.color] || THEME_PALETTES.amber;
  const calculatedLiveHours = calcHours(
    formData.startTime,
    formData.endTime,
    formData.breakTime,
    formData.type,
    formData.flexibleMinHours
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-2xl">⏰</span>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Shift &amp; Policy Management</h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Configure Standard Fixed Shifts, Flexible Shifts, Late Arrival &amp; Early Out deduction policies, and Overtime rules
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => handleOpenDeptAssignModal()}
            className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 flex items-center space-x-2 text-xs sm:text-sm font-semibold cursor-pointer shadow-md shadow-purple-500/20 active:scale-95 transition-all"
            title="Change shift for an entire department in one click"
          >
            <span>🏢</span>
            <span>Assign Shift by Department</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenAssignModal()}
            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:from-emerald-700 hover:to-teal-700 flex items-center space-x-2 text-xs sm:text-sm font-semibold cursor-pointer shadow-md shadow-emerald-500/20 active:scale-95 transition-all"
          >
            <span>📅</span>
            <span>Assign / Change Employee Shift</span>
          </button>
          <button
            onClick={() => {
              setShowForm(true);
              setEditing(null);
              const nextKey = COLOR_KEYS[shifts.length % COLOR_KEYS.length];
              setFormData({
                name: '',
                type: 'fixed',
                startTime: '09:00',
                endTime: '18:00',
                breakTime: 60,
                graceTime: 15,
                totalHours: 8,
                description: '',
                status: 'active',
                color: nextKey,
                icon: nextKey === 'amber' ? '☀️' : nextKey === 'indigo' ? '🌙' : '⏰',
                flexibleMinHours: 8,
                flexibleCoreStart: '10:00',
                flexibleCoreEnd: '16:00',
                latePolicyEnabled: true,
                latePenaltyMode: 'salary_deduction',
                lateGraceLimit: 45,
                earlyOutPolicyEnabled: true,
                earlyOutTolerance: 15,
                earlyOutPenaltyMode: 'mark_only',
                overtimePolicyEnabled: true,
                minOvertimeMinutes: 30,
                maxOvertimeHours: 4,
                halfDayMinHours: 4,
              });
            }}
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:from-indigo-700 hover:to-violet-700 flex items-center space-x-2 text-xs sm:text-sm font-semibold cursor-pointer shadow-md shadow-indigo-500/20 active:scale-95 transition-all"
          >
            <span>➕</span>
            <span>Add Shift</span>
          </button>
        </div>
      </div>

      {/* Helpful Tip Banner */}
      <div className="bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-emerald-500/10 border border-slate-200/80 rounded-2xl p-4 flex items-center space-x-3">
        <span className="text-xl shrink-0">💡</span>
        <div className="text-xs sm:text-sm text-slate-700">
          <strong className="text-slate-900">Shift Policies Active:</strong> Every shift supports individual Late arrival grace rules, Early Out departure penalties, Overtime qualification criteria, and Flexible punch hours.
        </div>
      </div>

      {/* Shifts Grid with Colorful Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {shifts.map((s, index) => {
          const { theme, icon } = getShiftTheme(s, index);
          const isFlexible = s.type === 'flexible';

          return (
            <div
              key={s.id}
              className={`relative bg-white rounded-2xl p-5 shadow-xs border ${theme.borderColor} ${theme.borderHover} ${theme.bgCard} hover:shadow-xl transition-all duration-200 flex flex-col justify-between overflow-hidden group`}
            >
              {/* Top Accent Gradient Bar */}
              <div className={`absolute top-0 left-0 right-0 h-1.5 ${theme.accentBar}`} />

              <div>
                {/* Header row: Shift Icon Badge + Shift Name + Time + Status */}
                <div className="flex items-start justify-between mb-3.5 pt-1">
                  <div className="flex items-center space-x-3.5 min-w-0">
                    <div
                      className={`w-13 h-13 rounded-2xl bg-gradient-to-br ${theme.gradient} flex items-center justify-center text-white text-2xl shadow-md ${theme.shadow} shrink-0 group-hover:scale-105 transition-transform`}
                    >
                      {icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5">
                        <h3 className={`font-bold text-[15px] sm:text-base ${theme.textTitle} truncate tracking-tight`} title={s.name}>
                          {s.name}
                        </h3>
                        {isFlexible && (
                          <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200">
                            Flexible
                          </span>
                        )}
                      </div>
                      <p className={`text-xs font-bold ${theme.textAccent} mt-0.5 flex items-center space-x-1`}>
                        <span>🕒</span>
                        <span>{isFlexible ? `${s.flexibleMinHours || 8}h Work Duration` : `${s.startTime} - ${s.endTime}`}</span>
                      </p>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <span
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full border flex items-center space-x-1.5 shrink-0 ${
                      s.status === 'active'
                        ? `${theme.badgeBg} ${theme.badgeText} ${theme.badgeBorder}`
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        s.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                      }`}
                    />
                    <span className="capitalize">{s.status}</span>
                  </span>
                </div>

                {/* Individual Colorful Fields: Total Hours, Break Time, Grace Time */}
                <div className="space-y-2 mb-3">
                  <div
                    className={`flex items-center justify-between p-2.5 rounded-xl border ${theme.statBoxBg} ${theme.statBoxBorder} transition-colors`}
                  >
                    <span className={`text-xs font-semibold ${theme.statBoxLabel}`}>Required Daily Hours</span>
                    <span className={`text-sm font-extrabold ${theme.statBoxValue}`}>
                      {(s.totalHours || s.flexibleMinHours || 8).toFixed(1)}h
                    </span>
                  </div>

                  <div
                    className={`flex items-center justify-between p-2.5 rounded-xl border ${theme.statBoxBg} ${theme.statBoxBorder} transition-colors`}
                  >
                    <span className={`text-xs font-semibold ${theme.statBoxLabel}`}>Break Allowance</span>
                    <span className={`text-sm font-extrabold ${theme.statBoxValue}`}>
                      {s.breakTime || 60} min
                    </span>
                  </div>

                  <div
                    className={`flex items-center justify-between p-2.5 rounded-xl border ${theme.statBoxBg} ${theme.statBoxBorder} transition-colors`}
                  >
                    <span className={`text-xs font-semibold ${theme.statBoxLabel}`}>Late Grace Period</span>
                    <span className={`text-sm font-extrabold ${theme.statBoxValue}`}>
                      {s.latePolicyEnabled === false ? 'Disabled' : `${s.graceTime || 15} min`}
                    </span>
                  </div>
                </div>

                {/* Active Policies Chips */}
                <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-200/60 mb-3 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-semibold flex items-center space-x-1">
                      <span>⏰</span>
                      <span>Late Policy:</span>
                    </span>
                    <span className="font-bold text-slate-800">
                      {s.latePolicyEnabled === false ? (
                        <span className="text-slate-400">Exempt (No late mark)</span>
                      ) : s.latePenaltyMode === 'salary_deduction' ? (
                        <span className="text-amber-700 font-bold">3-Day Cut Rule</span>
                      ) : (
                        <span className="text-slate-600">Mark Only</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-semibold flex items-center space-x-1">
                      <span>🚪</span>
                      <span>Early Out:</span>
                    </span>
                    <span className="font-bold text-slate-800">
                      {s.earlyOutPolicyEnabled === false ? (
                        <span className="text-slate-400">Allowed</span>
                      ) : (
                        <span className="text-indigo-700">{s.earlyOutTolerance || 15}m tolerance</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-semibold flex items-center space-x-1">
                      <span>⚡</span>
                      <span>Overtime:</span>
                    </span>
                    <span className="font-bold text-slate-800">
                      {s.overtimePolicyEnabled === false ? (
                        <span className="text-slate-400">No OT</span>
                      ) : (
                        <span className="text-emerald-700">Eligible (after {s.minOvertimeMinutes || 30}m)</span>
                      )}
                    </span>
                  </div>
                </div>

                {s.description && (
                  <p className="text-xs text-slate-500 mb-3.5 line-clamp-2 leading-relaxed">
                    {s.description}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2 pt-3 border-t border-slate-200/60 mt-auto">
                <button
                  type="button"
                  onClick={() => handleOpenAssignModal(undefined, s.name)}
                  className="px-2.5 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-all flex items-center justify-center space-x-1 shadow-2xs cursor-pointer"
                  title="Assign employee to this shift with an Effective Date"
                >
                  <span>📅</span>
                  <span>Assign</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenPolicyModal(s)}
                  className="px-3 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-all flex items-center justify-center space-x-1 shadow-2xs cursor-pointer"
                  title="Configure Attendance & Penalty Policies for this shift"
                >
                  <span>🛡️</span>
                  <span>Policies</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(s, index)}
                  className="flex-1 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl transition-all flex items-center justify-center space-x-1.5 shadow-2xs hover:shadow-xs cursor-pointer"
                >
                  <span>✏️</span>
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm(`Are you sure you want to delete "${s.name}"?`)) {
                      await deleteShift(s.id);
                    }
                  }}
                  className="px-3 py-2 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-all flex items-center justify-center space-x-1 cursor-pointer"
                  title="Delete shift"
                >
                  <span>🗑️</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* EMPLOYEE SHIFT ASSIGNMENT HISTORY (DATE-WISE EFFECTIVE SHIFT SYSTEM)       */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden mt-6">
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl">📅</span>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">
                Employee → Shift Assignment History (Date-Wise)
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Historical Attendance Protected
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Every shift assignment is tracked by Effective From &amp; Effective To dates. Changing an employee&apos;s shift applies only from the effective date onward and never alters past attendance, late, absent, or overtime calculations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleOpenAssignModal()}
            className="self-start lg:self-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 shadow-sm cursor-pointer transition-all shrink-0"
          >
            <span>🔄</span>
            <span>Assign / Schedule Shift Change</span>
          </button>
        </div>

        {/* Filters & Date Lookup Inspector */}
        <div className="p-4 bg-slate-50/70 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
              Search Employee / Shift
            </label>
            <input
              type="text"
              value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
              placeholder="Name, ID, or Shift..."
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
              Filter by Employee
            </label>
            <select
              value={historyEmployeeFilter}
              onChange={e => setHistoryEmployeeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
            >
              <option value="all">All Employees ({employees.length})</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeId})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
              Filter by Shift
            </label>
            <select
              value={historyShiftFilter}
              onChange={e => setHistoryShiftFilter(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
            >
              <option value="all">All Shifts</option>
              {shifts.map(s => (
                <option key={s.id} value={s.name}>
                  {s.name} ({s.startTime}-{s.endTime})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
              Assignment Status
            </label>
            <select
              value={historyStatusFilter}
              onChange={e => setHistoryStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
            >
              <option value="all">All Statuses</option>
              <option value="Active">Active (Current)</option>
              <option value="Scheduled">Scheduled (Future)</option>
              <option value="Completed">Historical (Past)</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-indigo-700 uppercase">
                🔍 Check Shift on Date
              </label>
              {lookupDate && (
                <button
                  type="button"
                  onClick={() => setLookupDate('')}
                  className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
            <input
              type="date"
              value={lookupDate}
              onChange={e => setLookupDate(e.target.value)}
              className="w-full px-3 py-2 bg-indigo-50/60 border border-indigo-200 rounded-xl text-xs font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              title="Select any past, present, or future date to see which shift each employee was assigned to on that date"
            />
          </div>
        </div>

        {lookupDate && (
          <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between text-xs text-indigo-900">
            <span>
              📌 Showing applicable shift assignments for date:{' '}
              <strong>{formatEffectiveDateDisplay(lookupDate)}</strong> ({lookupDate})
            </span>
            <button
              type="button"
              onClick={() => setLookupDate('')}
              className="text-xs font-bold text-indigo-700 hover:text-indigo-900 underline cursor-pointer"
            >
              Show Full History
            </button>
          </div>
        )}

        {/* Shift Assignment History Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Shift</th>
                <th className="py-3 px-4">Effective From</th>
                <th className="py-3 px-4">Effective To</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
              {allShiftHistoryRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400 text-xs">
                    No shift assignment records found matching the selected filters.
                  </td>
                </tr>
              ) : (
                allShiftHistoryRows.map(({ employee, entry, status, shiftObj }) => (
                  <tr key={`${employee.id}_${entry.id}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs shrink-0 overflow-hidden">
                          {employee.avatar && (employee.avatar.startsWith('data:image/') || employee.avatar.startsWith('http://') || employee.avatar.startsWith('https://')) ? (
                            <img src={employee.avatar} alt={employee.name} className="w-full h-full object-cover" />
                          ) : (
                            employee.avatar && employee.avatar.length <= 4 ? employee.avatar : (employee.name ? employee.name.slice(0, 2).toUpperCase() : '👤')
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">{employee.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {employee.employeeId} • {employee.department}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="inline-flex flex-col">
                        <span className="font-bold text-slate-800">{entry.shiftName}</span>
                        {shiftObj && (
                          <span className="text-[11px] text-slate-500 font-medium">
                            {shiftObj.type === 'flexible'
                              ? `Flexible (${shiftObj.flexibleMinHours || 8}h)`
                              : `${shiftObj.startTime} – ${shiftObj.endTime} (${shiftObj.graceTime ?? 15}m grace)`}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 text-xs">
                        {formatEffectiveDateDisplay(entry.effectiveFrom)}
                      </span>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{entry.effectiveFrom}</div>
                    </td>

                    <td className="py-3 px-4">
                      {entry.effectiveTo ? (
                        <div>
                          <span className="font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 text-xs">
                            {formatEffectiveDateDisplay(entry.effectiveTo)}
                          </span>
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{entry.effectiveTo}</div>
                        </div>
                      ) : (
                        <span className="font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 text-xs">
                          Present
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {status === 'Active' ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>Active</span>
                        </span>
                      ) : status === 'Scheduled' ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                          <span>🗓️</span>
                          <span>Scheduled</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          <span>🔒</span>
                          <span>Past History</span>
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenAssignModal(employee.id)}
                          className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                          title="Assign new shift from an effective date"
                        >
                          Change Shift
                        </button>
                        {!entry.id.startsWith('legacy_') && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const isPastRecord =
                                  status === 'Completed' || entry.effectiveFrom < todayStr;
                                setEditingHistoryTarget({
                                  employee,
                                  entry,
                                  pastWarningConfirmed: !isPastRecord,
                                  shiftName: entry.shiftName,
                                  effectiveFrom: entry.effectiveFrom,
                                  effectiveTo: entry.effectiveTo || '',
                                  note: entry.note || '',
                                  error: '',
                                });
                              }}
                              className="px-2 py-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                              title="Edit assignment period"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingHistoryTarget({ employee, entry })}
                              className="px-2 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-xs font-semibold cursor-pointer"
                              title="Remove history entry"
                            >
                              🗑️
                            </button>
                          </>
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

      {/* ========================================================================= */}
      {/* DEPARTMENT-WISE SHIFT ASSIGNMENT MODAL                                      */}
      {/* ========================================================================= */}
      {showDeptAssignModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-7 max-h-[92vh] overflow-y-auto thin-scroll shadow-2xl border border-slate-200 animate-scale-in">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-50 border border-purple-200 text-purple-600 flex items-center justify-center text-xl shadow-xs">
                  🏢
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Assign Shift by Department
                  </h3>
                  <p className="text-xs text-slate-500">
                    Update working shift for all active staff in a department simultaneously
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeptAssignModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {deptAssignError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold flex items-center space-x-2">
                <span>⚠️</span>
                <span>{deptAssignError}</span>
              </div>
            )}

            <form onSubmit={handleSaveDeptShiftAssignment} className="space-y-4">
              {/* Select Department */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  1. Select Department *
                </label>
                <select
                  value={deptAssignDepartment}
                  onChange={e => setDeptAssignDepartment(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
                  required
                >
                  <option value="">-- Choose Department --</option>
                  {Array.from(new Set(employees.map(e => e.department).filter(Boolean))).map(d => {
                    const count = employees.filter(e => e.department === d).length;
                    return (
                      <option key={d} value={d}>
                        {d} ({count} Employees)
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Department Employees Preview */}
              {(() => {
                const deptStaff = employees.filter(
                  e => e.department?.toLowerCase() === deptAssignDepartment.toLowerCase()
                );
                if (!deptAssignDepartment) return null;
                return (
                  <div className="p-3 bg-purple-50/60 border border-purple-200/80 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-purple-900">
                        Affected Employees ({deptStaff.length})
                      </span>
                      <span className="text-[11px] text-purple-700 font-medium">
                        Will be updated to the new shift
                      </span>
                    </div>
                    {deptStaff.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No employees found in this department.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                        {deptStaff.map(emp => (
                          <span
                            key={emp.id}
                            className="px-2 py-0.5 bg-white border border-purple-200 text-purple-900 rounded-lg text-[11px] font-medium"
                          >
                            {emp.name} ({emp.shift || 'No Shift'})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Select Shift to Assign */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  2. Select New Shift to Assign *
                </label>
                <select
                  value={deptAssignShiftName}
                  onChange={e => setDeptAssignShiftName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
                  required
                >
                  <option value="">-- Choose Shift --</option>
                  {shifts.map(s => (
                    <option key={s.id} value={s.name}>
                      {s.name} ({s.startTime} - {s.endTime}) {s.type === 'flexible' ? '[Flexible]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Effective Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    3. Effective From *
                  </label>
                  <input
                    type="date"
                    value={deptAssignEffectiveFrom}
                    onChange={e => setDeptAssignEffectiveFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
                    required
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Starting date of new shift</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    Effective To <span className="text-slate-400 font-normal lowercase">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={deptAssignEffectiveTo}
                    onChange={e => setDeptAssignEffectiveTo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Leave blank for ongoing</p>
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Assignment Note / Reason
                </label>
                <input
                  type="text"
                  value={deptAssignNote}
                  onChange={e => setDeptAssignNote(e.target.value)}
                  placeholder="e.g. Factory seasonal rotation, Ramadan timing..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDeptAssignModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingDeptAssign}
                  className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl text-xs font-bold shadow-md shadow-purple-500/20 hover:from-purple-700 hover:to-indigo-700 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSavingDeptAssign ? 'Applying to Department...' : '✓ Apply to Whole Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DATE-WISE EMPLOYEE SHIFT ASSIGNMENT MODAL (REQUIREMENTS 4, 5, 9, 15)       */}
      {/* ========================================================================= */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-7 max-h-[92vh] overflow-y-auto thin-scroll shadow-2xl border border-slate-200 animate-scale-in">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center text-xl shadow-xs">
                  📅
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Date-Wise Employee Shift Assignment
                  </h3>
                  <p className="text-xs text-slate-500">
                    Assign or schedule a new shift by Effective Date while preserving all historical attendance
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmShiftAssignment} className="space-y-5">
              {/* Step 1: Select Employee */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  1. Select Employee *
                </label>
                <select
                  value={selectedEmpId}
                  onChange={e => initializeAssignmentForEmployee(e.target.value, newShiftName)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                >
                  <option value="">-- Choose Employee --</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.employeeId}) — Current: {emp.shift || 'Unassigned'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Step 2: Current / Previous Shift History for Selected Employee */}
              {selectedAssignEmployee && (
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      2. Current / Previous Shift History ({selectedAssignEmployee.name})
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {selectedEmployeeHistory.length} Period(s)
                    </span>
                  </div>

                  {selectedEmployeeHistory.length > 0 && (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-100/80 text-slate-500 font-bold border-b border-slate-200">
                            <th className="py-2 px-3">Shift</th>
                            <th className="py-2 px-3">Effective From</th>
                            <th className="py-2 px-3">Effective To</th>
                            <th className="py-2 px-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedEmployeeHistory.map(h => {
                            const st = getShiftAssignmentStatus(h, todayStr);
                            return (
                              <tr key={h.id}>
                                <td className="py-2 px-3 font-bold text-slate-800">{h.shiftName}</td>
                                <td className="py-2 px-3 text-slate-600">{formatEffectiveDateDisplay(h.effectiveFrom)}</td>
                                <td className="py-2 px-3 text-slate-600">
                                  {h.effectiveTo ? formatEffectiveDateDisplay(h.effectiveTo) : 'Present'}
                                </td>
                                <td className="py-2 px-3">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                      st === 'Active'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : st === 'Scheduled'
                                        ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                        : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {st}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Previous Shift Period Bounds */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block mb-1">
                        Previous Shift
                      </label>
                      <select
                        value={previousShiftName}
                        onChange={e => setPreviousShiftName(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                      >
                        <option value="">None / Unassigned</option>
                        {shifts.map(s => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block mb-1">
                        Previous Shift From
                      </label>
                      <input
                        type="date"
                        value={previousEffectiveFrom}
                        onChange={e => setPreviousEffectiveFrom(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-600 block mb-1">
                        Previous Shift Until (Auto)
                      </label>
                      <input
                        type="date"
                        value={previousEffectiveTo}
                        onChange={e => setPreviousEffectiveTo(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: New Shift & Effective From Date */}
              <div className="p-4 rounded-2xl bg-indigo-50/40 border border-indigo-200/80 space-y-3">
                <span className="text-xs font-bold text-indigo-950 uppercase tracking-wider block">
                  3. Select New Shift &amp; Effective Date
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      New Shift *
                    </label>
                    <select
                      value={newShiftName}
                      onChange={e => {
                        setNewShiftName(e.target.value);
                        setAssignError('');
                      }}
                      required
                      className="w-full px-3 py-2.5 bg-white border border-indigo-200 rounded-xl text-xs sm:text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">-- Select Shift --</option>
                      {shifts.map(s => (
                        <option key={s.id} value={s.name}>
                          {s.name} ({s.type === 'flexible' ? `${s.flexibleMinHours || 8}h Flexible` : `${s.startTime} - ${s.endTime}`})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Effective From Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={newEffectiveFrom}
                      onChange={e => handleNewEffectiveFromChange(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs sm:text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-[10px] text-slate-500 mt-0.5 block">
                      {newEffectiveFrom > todayStr
                        ? '🗓️ Future date selected: Shift change will activate automatically on this date.'
                        : 'Attendance from this date onward will use the new shift.'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Effective To (Leave empty for &quot;Present / Ongoing&quot;)
                    </label>
                    <input
                      type="date"
                      value={newEffectiveTo}
                      min={newEffectiveFrom}
                      onChange={e => setNewEffectiveTo(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Reason / Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={assignmentNote}
                      onChange={e => setAssignmentNote(e.target.value)}
                      placeholder="e.g. Monthly rotation, department transfer..."
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700"
                    />
                  </div>
                </div>
              </div>

              {/* Step 4: Assignment Preview Card (Requirement 15) */}
              {selectedAssignEmployee && newShiftName && newEffectiveFrom && (
                <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-50/90 to-teal-50/60 border border-emerald-200 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-emerald-200/70 pb-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-900 flex items-center space-x-1.5">
                      <span>🔍</span>
                      <span>4. Shift Assignment Preview</span>
                    </span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white text-emerald-700 border border-emerald-200">
                      {newEffectiveFrom > todayStr ? 'Scheduled Future Change' : 'Effective Date-Wise'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 bg-white/90 rounded-xl border border-emerald-100">
                      <span className="text-slate-400 text-[10px] font-bold uppercase block">Employee</span>
                      <span className="font-extrabold text-slate-900 text-sm">
                        {selectedAssignEmployee.name} ({selectedAssignEmployee.employeeId})
                      </span>
                    </div>

                    <div className="p-2.5 bg-white/90 rounded-xl border border-emerald-100">
                      <span className="text-slate-400 text-[10px] font-bold uppercase block">New Shift</span>
                      <span className="font-extrabold text-indigo-700 text-sm">{newShiftName}</span>
                    </div>

                    <div className="p-2.5 bg-white/90 rounded-xl border border-emerald-100">
                      <span className="text-slate-400 text-[10px] font-bold uppercase block">Previous Shift &amp; Period</span>
                      <span className="font-bold text-slate-800">
                        {previousShiftName || 'Unassigned'} ({formatEffectiveDateDisplay(previousEffectiveFrom)} –{' '}
                        {formatEffectiveDateDisplay(previousEffectiveTo)})
                      </span>
                    </div>

                    <div className="p-2.5 bg-white/90 rounded-xl border border-emerald-100">
                      <span className="text-slate-400 text-[10px] font-bold uppercase block">New Effective Date</span>
                      <span className="font-extrabold text-emerald-700">
                        {formatEffectiveDateDisplay(newEffectiveFrom)} –{' '}
                        {newEffectiveTo ? formatEffectiveDateDisplay(newEffectiveTo) : 'Present'}
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] text-emerald-900 bg-emerald-100/70 px-3 py-2 rounded-xl font-medium flex items-start space-x-2">
                    <span className="shrink-0">🔒</span>
                    <span>
                      <strong>Historical Data Guarantee:</strong> Attendance records up to{' '}
                      <strong>{formatEffectiveDateDisplay(previousEffectiveTo)}</strong> will remain locked to{' '}
                      <strong>{previousShiftName || 'previous shift'}</strong> rules (Present, Late, Absent, Early Leave &amp; OT will NOT change). From{' '}
                      <strong>{formatEffectiveDateDisplay(newEffectiveFrom)}</strong> onward, attendance will be calculated using{' '}
                      <strong>{newShiftName}</strong>.
                    </span>
                  </div>
                </div>
              )}

              {/* Past Date Confirmation Prompt (Requirement 10) */}
              {isConfirmingPastChange && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-xs text-amber-900 space-y-2">
                  <div className="font-bold flex items-center space-x-1.5 text-amber-950">
                    <span>⚠️</span>
                    <span>Confirm Backdated / Historical Effective Date</span>
                  </div>
                  <p>
                    The selected Effective From date (<strong>{formatEffectiveDateDisplay(newEffectiveFrom)}</strong>) is in the past ({newEffectiveFrom}). Attendance from {formatEffectiveDateDisplay(newEffectiveFrom)} onward will use <strong>{newShiftName}</strong>, while dates up to {formatEffectiveDateDisplay(previousEffectiveTo)} will remain on <strong>{previousShiftName}</strong>. Do you want to proceed?
                  </p>
                </div>
              )}

              {assignError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                  ⚠️ {assignError}
                </div>
              )}

              <div className="flex space-x-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowAssignModal(false);
                    setIsConfirmingPastChange(false);
                  }}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingAssignment}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md cursor-pointer transition-all disabled:opacity-50"
                >
                  {isSavingAssignment
                    ? 'Saving Assignment...'
                    : isConfirmingPastChange
                    ? 'Yes, Confirm Past Effective Date Change'
                    : 'Confirm Shift Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* EDIT HISTORICAL SHIFT PERIOD MODAL (WITH PAST EDIT SAFETY CONFIRMATION)    */}
      {/* ========================================================================= */}
      {editingHistoryTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">
                Edit Shift History Period — {editingHistoryTarget.employee.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingHistoryTarget(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            {!editingHistoryTarget.pastWarningConfirmed ? (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
                  <div className="font-bold text-sm text-amber-950 flex items-center space-x-1.5">
                    <span>⚠️</span>
                    <span>Warning: Modifying Historical Shift Assignment</span>
                  </div>
                  <p>
                    You are about to edit a past/existing shift assignment period (
                    <strong>
                      {editingHistoryTarget.entry.shiftName}:{' '}
                      {formatEffectiveDateDisplay(editingHistoryTarget.entry.effectiveFrom)} –{' '}
                      {formatEffectiveDateDisplay(editingHistoryTarget.entry.effectiveTo)}
                    </strong>
                    ).
                  </p>
                  <p>
                    Changing past shift dates can affect historical attendance evaluations for those dates. Are you sure you want to unlock and edit this historical shift record?
                  </p>
                </div>
                <div className="flex space-x-2.5">
                  <button
                    type="button"
                    onClick={() => setEditingHistoryTarget(null)}
                    className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Cancel (Keep Safe)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingHistoryTarget({ ...editingHistoryTarget, pastWarningConfirmed: true })
                    }
                    className="flex-1 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                  >
                    I Understand, Proceed to Edit
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveEditedHistoryPeriod} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Shift *</label>
                  <select
                    value={editingHistoryTarget.shiftName}
                    onChange={e =>
                      setEditingHistoryTarget({ ...editingHistoryTarget, shiftName: e.target.value, error: '' })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    {shifts.map(s => (
                      <option key={s.id} value={s.name}>
                        {s.name} ({s.startTime} - {s.endTime})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Effective From *</label>
                    <input
                      type="date"
                      required
                      value={editingHistoryTarget.effectiveFrom}
                      onChange={e =>
                        setEditingHistoryTarget({
                          ...editingHistoryTarget,
                          effectiveFrom: e.target.value,
                          error: '',
                        })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Effective To (Blank = Present)
                    </label>
                    <input
                      type="date"
                      value={editingHistoryTarget.effectiveTo}
                      onChange={e =>
                        setEditingHistoryTarget({
                          ...editingHistoryTarget,
                          effectiveTo: e.target.value,
                          error: '',
                        })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Note</label>
                  <input
                    type="text"
                    value={editingHistoryTarget.note}
                    onChange={e =>
                      setEditingHistoryTarget({ ...editingHistoryTarget, note: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>

                {editingHistoryTarget.error && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                    ⚠️ {editingHistoryTarget.error}
                  </div>
                )}

                <div className="flex space-x-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingHistoryTarget(null)}
                    className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Save Period Changes
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* DELETE SHIFT HISTORY CONFIRMATION MODAL */}
      {deletingHistoryTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="font-bold text-base text-slate-900 flex items-center space-x-2">
              <span>⚠️</span>
              <span>Confirm Shift History Removal</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to remove the shift assignment{' '}
              <strong>{deletingHistoryTarget.entry.shiftName}</strong> (
              {formatEffectiveDateDisplay(deletingHistoryTarget.entry.effectiveFrom)} –{' '}
              {formatEffectiveDateDisplay(deletingHistoryTarget.entry.effectiveTo)}) for{' '}
              <strong>{deletingHistoryTarget.employee.name}</strong>? Removing a historical shift period may affect how past attendance dates resolve their shift.
            </p>
            <div className="flex space-x-2.5">
              <button
                type="button"
                onClick={() => setDeletingHistoryTarget(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteHistoryPeriod}
                className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Shift Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-7 max-h-[92vh] overflow-y-auto thin-scroll shadow-2xl border border-slate-200 animate-scale-in">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center space-x-2.5">
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${currentTheme.gradient} flex items-center justify-center text-white text-xl shadow-xs`}
                >
                  {formData.icon || '⏰'}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {editing ? `Edit "${editing.name}" Shift` : 'Create New Shift'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Define working hours, flexible schedule rules, and attendance policies
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Shift Mode: Standard Fixed vs Flexible */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
                  Shift Timing Model
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, type: 'fixed' })}
                    className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      formData.type === 'fixed'
                        ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20 shadow-xs'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">🕒</span>
                      <span className="font-bold text-slate-900 text-sm">Fixed Shift</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                      Office biometric terminal attendance (ZKTeco)
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, type: 'flexible' })}
                    className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      formData.type === 'flexible'
                        ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20 shadow-xs'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">🌊</span>
                      <span className="font-bold text-slate-900 text-sm">Flexible Shift</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                      Complete target duty hours within core window
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, type: 'remote' })}
                    className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      formData.type === 'remote'
                        ? 'border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-500/20 shadow-xs'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">🏠</span>
                      <span className="font-bold text-slate-900 text-sm">Remote Shift</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                      Work from home &amp; Camera selfie GPS punch enabled
                    </p>
                  </button>
                </div>
              </div>

              {/* Theme Color & Icon Pickers */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    🎨 Color Palette
                  </label>
                  <div className="grid grid-cols-5 gap-1.5 p-2 bg-slate-50/80 rounded-2xl border border-slate-200">
                    {COLOR_KEYS.map(k => {
                      const theme = THEME_PALETTES[k];
                      const isSelected = formData.color === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setFormData({ ...formData, color: k })}
                          className={`flex flex-col items-center justify-center p-1.5 rounded-xl border transition-all cursor-pointer ${
                            isSelected
                              ? `bg-white ${theme.borderColor} shadow-xs ring-2 ${theme.ringColor}`
                              : 'border-transparent hover:bg-white/60'
                          }`}
                          title={theme.label}
                        >
                          <span
                            className="w-5 h-5 rounded-full border border-white shadow-2xs flex items-center justify-center text-white text-[9px] font-bold"
                            style={{ backgroundColor: theme.dotColor }}
                          >
                            {isSelected ? '✓' : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    🌟 Shift Icon
                  </label>
                  <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50/80 rounded-2xl border border-slate-200">
                    {SHIFT_ICONS.slice(0, 10).map(item => {
                      const isSelected = formData.icon === item.icon;
                      return (
                        <button
                          key={item.icon}
                          type="button"
                          onClick={() => setFormData({ ...formData, icon: item.icon })}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-white shadow-xs ring-2 ring-indigo-500 scale-105 border border-slate-200'
                              : 'hover:bg-white/60 text-slate-600'
                          }`}
                          title={item.label}
                        >
                          {item.icon}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Basic Information */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Shift Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full mt-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Morning General Shift, R&amp;D Flexible, Night Support"
                />
              </div>

              {/* Fixed vs Flexible Timing Fields */}
              {formData.type === 'fixed' ? (
                <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50/80 border border-slate-200 rounded-2xl">
                  <div>
                    <label className="text-xs font-bold text-slate-700">Official Start Time *</label>
                    <input
                      type="time"
                      required
                      value={formData.startTime}
                      onChange={e => setFormData({ ...formData, startTime: e.target.value })}
                      className="w-full mt-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Official End Time *</label>
                    <input
                      type="time"
                      required
                      value={formData.endTime}
                      onChange={e => setFormData({ ...formData, endTime: e.target.value })}
                      className="w-full mt-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  {editing && (editing.startTime !== formData.startTime || editing.endTime !== formData.endTime) && (
                    <div className="col-span-2 mt-1 p-3 rounded-xl bg-amber-50/90 border border-amber-200 space-y-2">
                      <div className="text-xs font-extrabold text-amber-900 flex items-center space-x-1.5">
                        <span>🛡️</span>
                        <span>Shift Timing Changed ({editing.startTime}–{editing.endTime} → {formData.startTime}–{formData.endTime}):</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <label className={`flex items-start space-x-2 p-2 rounded-lg border cursor-pointer ${timingChangeMode === 'direct' ? 'bg-white border-indigo-400 font-bold text-slate-900' : 'bg-white/60 border-amber-200 text-slate-600'}`}>
                          <input
                            type="radio"
                            name="timingChangeMode"
                            checked={timingChangeMode === 'direct'}
                            onChange={() => setTimingChangeMode('direct')}
                            className="mt-0.5"
                          />
                          <span>Update Current Active Period Timing (Apply {formData.startTime}–{formData.endTime} to current open dates)</span>
                        </label>
                        <label className={`flex items-start space-x-2 p-2 rounded-lg border cursor-pointer ${timingChangeMode === 'effective_date' ? 'bg-white border-emerald-500 font-bold text-slate-900' : 'bg-white/60 border-amber-200 text-slate-600'}`}>
                          <input
                            type="radio"
                            name="timingChangeMode"
                            checked={timingChangeMode === 'effective_date'}
                            onChange={() => setTimingChangeMode('effective_date')}
                            className="mt-0.5"
                          />
                          <span>Apply From Effective Date Only (Lock {editing.startTime}–{editing.endTime} for prior dates)</span>
                        </label>
                      </div>
                      {timingChangeMode === 'effective_date' && (
                        <div className="flex items-center space-x-2 pt-1">
                          <span className="text-xs font-bold text-slate-700">New Timing Effective From:</span>
                          <input
                            type="date"
                            value={timingEffectiveFrom}
                            onChange={e => setTimingEffectiveFrom(e.target.value)}
                            className="px-2.5 py-1 bg-white border border-emerald-300 rounded-lg text-xs font-bold text-slate-900"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3 p-3.5 bg-sky-50/60 border border-sky-200 rounded-2xl">
                  <div>
                    <label className="text-xs font-bold text-sky-950">Required Work Duration (Hours / Day) *</label>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      max="16"
                      required
                      value={formData.flexibleMinHours}
                      onChange={e => setFormData({ ...formData, flexibleMinHours: parseFloat(e.target.value) || 8 })}
                      className="w-full mt-1 px-3 py-2 bg-white border border-sky-300 rounded-xl text-sm font-extrabold text-sky-900 focus:ring-2 focus:ring-sky-500"
                    />
                    <span className="text-[11px] text-sky-800 mt-1 block">
                      Employees must clock in at least this many hours to be counted as Present.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Core Hours Window Start</label>
                      <input
                        type="time"
                        value={formData.flexibleCoreStart}
                        onChange={e => setFormData({ ...formData, flexibleCoreStart: e.target.value })}
                        className="w-full mt-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Core Hours Window End</label>
                      <input
                        type="time"
                        value={formData.flexibleCoreEnd}
                        onChange={e => setFormData({ ...formData, flexibleCoreEnd: e.target.value })}
                        className="w-full mt-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Break Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Break Allowance (Minutes)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.breakTime}
                    onChange={e => setFormData({ ...formData, breakTime: parseInt(e.target.value, 10) || 0 })}
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Status</label>
                  <select
                    value={formData.status}
                    onChange={e => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              {/* ========================================================================= */}
              {/* SHIFT POLICIES CARD (User Request 2nd: Policy system for shifts)           */}
              {/* ========================================================================= */}
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-4">
                <div className="flex items-center space-x-2 border-b border-slate-200/80 pb-2">
                  <span className="text-base">🛡️</span>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Shift Attendance &amp; Penalty Policies
                  </h4>
                </div>

                {/* 1. Late Policy */}
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.latePolicyEnabled}
                        onChange={e => setFormData({ ...formData, latePolicyEnabled: e.target.checked })}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-900">Enforce Late Arrival Policy</span>
                    </label>
                    <span className="text-[11px] font-bold text-slate-500">
                      {formData.latePolicyEnabled ? 'Active' : 'Exempt'}
                    </span>
                  </div>

                  {formData.latePolicyEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block">Late Grace Time (Minutes)</label>
                        <input
                          type="number"
                          min="0"
                          max="120"
                          value={formData.graceTime}
                          onChange={e => setFormData({ ...formData, graceTime: parseInt(e.target.value, 10) || 0 })}
                          className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block">Late Penalty Mode</label>
                        <select
                          value={formData.latePenaltyMode}
                          onChange={e => setFormData({ ...formData, latePenaltyMode: e.target.value as any })}
                          className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium"
                        >
                          <option value="salary_deduction">3-Day Late 1-Day Salary Deduction</option>
                          <option value="mark_only">Mark as Late Only (No salary cut)</option>
                          <option value="none">No Penalty</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Early Out Policy */}
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.earlyOutPolicyEnabled}
                        onChange={e => setFormData({ ...formData, earlyOutPolicyEnabled: e.target.checked })}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-900">Enforce Early Departure (Early Out) Policy</span>
                    </label>
                    <span className="text-[11px] font-bold text-slate-500">
                      {formData.earlyOutPolicyEnabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>

                  {formData.earlyOutPolicyEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block">Early Departure Tolerance (Minutes)</label>
                        <input
                          type="number"
                          min="0"
                          max="120"
                          value={formData.earlyOutTolerance}
                          onChange={e => setFormData({ ...formData, earlyOutTolerance: parseInt(e.target.value, 10) || 0 })}
                          className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block">Early Out Action</label>
                        <select
                          value={formData.earlyOutPenaltyMode}
                          onChange={e => setFormData({ ...formData, earlyOutPenaltyMode: e.target.value as any })}
                          className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium"
                        >
                          <option value="mark_only">Mark as Early Departure</option>
                          <option value="half_day">Count as Half-Day if Left Too Early</option>
                          <option value="none">No Action</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Overtime Policy */}
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.overtimePolicyEnabled}
                        onChange={e => {
                          const checked = e.target.checked;
                          setFormData(prev => ({ ...prev, overtimePolicyEnabled: checked }));
                          if (editing) {
                            updateShift(editing.id, { overtimePolicyEnabled: checked });
                          }
                        }}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-900">Overtime (OT) Calculation</span>
                    </label>
                    <span className="text-[11px] font-bold text-slate-500">
                      {formData.overtimePolicyEnabled ? 'Eligible' : 'No OT'}
                    </span>
                  </div>

                  {formData.overtimePolicyEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block">Min. Extra Minutes to Count OT</label>
                        <input
                          type="number"
                          min="0"
                          value={formData.minOvertimeMinutes}
                          onChange={e => setFormData({ ...formData, minOvertimeMinutes: parseInt(e.target.value, 10) || 0 })}
                          className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block">Max OT Cap per Day (Hours)</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={formData.maxOvertimeHours}
                          onChange={e => setFormData({ ...formData, maxOvertimeHours: parseFloat(e.target.value) || 0 })}
                          className="w-full mt-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-semibold text-slate-700">Notes / Operational Instructions</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                  placeholder="Notes for employees assigned to this shift..."
                />
              </div>

              {/* Modal Buttons */}
              <div className="flex space-x-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-sm font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`flex-1 px-4 py-2.5 bg-gradient-to-r ${currentTheme.gradient} text-white rounded-xl font-bold text-sm shadow-md cursor-pointer hover:opacity-95 transition-opacity`}
                >
                  {editing ? 'Save Shift Policies' : 'Create Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK ATTENDANCE & PENALTY POLICIES MODAL FOR EXISTING SHIFT */}
      {policyEditingShift && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-7 max-h-[92vh] overflow-y-auto thin-scroll shadow-2xl border border-slate-200 animate-scale-in">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center text-xl shadow-xs">
                  🛡️
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Configure Policies: {policyEditingShift.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Late arrival grace, early departure penalty, and overtime rules for this shift.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPolicyEditingShift(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePolicyModal} className="space-y-4">
              {/* Shift Timing Summary Header */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-400 block font-semibold uppercase text-[10px]">Shift Timing Model</span>
                  <span className="font-bold text-slate-800">
                    {policyEditingShift.type === 'flexible'
                      ? `Flexible Shift (Req: ${policyEditingShift.flexibleMinHours || 8}h)`
                      : `Fixed Shift (${policyEditingShift.startTime} - ${policyEditingShift.endTime})`}
                  </span>
                </div>
                <span className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg font-bold text-xs">
                  {policyEditingShift.breakTime || 60}m break
                </span>
              </div>

              {/* 1. Late Policy */}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={policyFormData.latePolicyEnabled}
                      onChange={e => setPolicyFormData({ ...policyFormData, latePolicyEnabled: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-900">Enforce Late Arrival Policy</span>
                  </label>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    policyFormData.latePolicyEnabled ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {policyFormData.latePolicyEnabled ? 'Active' : 'Exempt (No Late Mark)'}
                  </span>
                </div>

                {policyFormData.latePolicyEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Late Grace Period (Minutes)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={policyFormData.graceTime}
                        onChange={e => setPolicyFormData({ ...policyFormData, graceTime: parseInt(e.target.value, 10) || 0 })}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                      />
                      <span className="text-[10px] text-slate-400 mt-0.5 block">
                        Allow arrival within this many minutes without late tag.
                      </span>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Late Penalty Rule
                      </label>
                      <select
                        value={policyFormData.latePenaltyMode}
                        onChange={e => setPolicyFormData({ ...policyFormData, latePenaltyMode: e.target.value as any })}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                      >
                        <option value="salary_deduction">3-Day Late = 1-Day Salary Cut</option>
                        <option value="mark_only">Mark as Late Only (No Cut)</option>
                        <option value="none">No Penalty</option>
                      </select>
                      <span className="text-[10px] text-slate-400 mt-0.5 block">
                        Action applied in monthly payroll ledger.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Early Out Policy */}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={policyFormData.earlyOutPolicyEnabled}
                      onChange={e => setPolicyFormData({ ...policyFormData, earlyOutPolicyEnabled: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-900">Enforce Early Out (Departure) Policy</span>
                  </label>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    policyFormData.earlyOutPolicyEnabled ? 'bg-indigo-50 text-indigo-800 border border-indigo-200' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {policyFormData.earlyOutPolicyEnabled ? 'Active' : 'Disabled'}
                  </span>
                </div>

                {policyFormData.earlyOutPolicyEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Early Out Tolerance (Minutes)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={policyFormData.earlyOutTolerance}
                        onChange={e => setPolicyFormData({ ...policyFormData, earlyOutTolerance: parseInt(e.target.value, 10) || 0 })}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                      />
                      <span className="text-[10px] text-slate-400 mt-0.5 block">
                        Leaving within this time before shift end is tolerated.
                      </span>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Early Out Action
                      </label>
                      <select
                        value={policyFormData.earlyOutPenaltyMode}
                        onChange={e => setPolicyFormData({ ...policyFormData, earlyOutPenaltyMode: e.target.value as any })}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
                      >
                        <option value="mark_only">Mark as Early Departure</option>
                        <option value="half_day">Count as Half-Day if Left Early</option>
                        <option value="none">No Action</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Overtime (OT) Policy */}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={policyFormData.overtimePolicyEnabled}
                      onChange={e => {
                        const checked = e.target.checked;
                        setPolicyFormData(prev => ({ ...prev, overtimePolicyEnabled: checked }));
                        if (policyEditingShift) {
                          updateShift(policyEditingShift.id, { overtimePolicyEnabled: checked });
                        }
                      }}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-900">Overtime (OT) Calculation</span>
                  </label>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    policyFormData.overtimePolicyEnabled ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {policyFormData.overtimePolicyEnabled ? 'Eligible' : 'No OT'}
                  </span>
                </div>

                {policyFormData.overtimePolicyEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Min. Extra Minutes to Count as OT
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={policyFormData.minOvertimeMinutes}
                        onChange={e => setPolicyFormData({ ...policyFormData, minOvertimeMinutes: parseInt(e.target.value, 10) || 0 })}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Max OT Cap per Day (Hours)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={policyFormData.maxOvertimeHours}
                        onChange={e => setPolicyFormData({ ...policyFormData, maxOvertimeHours: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Buttons */}
              <div className="flex space-x-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPolicyEditingShift(null)}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-md shadow-indigo-600/25 cursor-pointer transition-all"
                >
                  Save Shift Policies
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
