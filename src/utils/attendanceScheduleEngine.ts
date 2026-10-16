import { Shift, RosterEntry, Employee, ShiftAssignmentRecord } from '../context/DataContext';

export type { ShiftAssignmentRecord };

export interface ResolvedSchedule {
  isOff: boolean;
  isWeekend: boolean; // explicitly assigned as Weekend/Off in roster
  shiftName: string;
  shift: Shift | null;
  startTime: string;
  endTime: string;
  graceTime: number;
  breakTime: number;
  isOvernight: boolean;
  totalRequiredHours: number;
  latePolicyEnabled: boolean;
  latePenaltyMode: 'none' | 'mark_only' | 'salary_deduction';
  earlyOutPolicyEnabled: boolean;
  earlyOutTolerance: number;
  overtimePolicyEnabled: boolean;
  minOvertimeMinutes: number;
  maxOvertimeHours?: number;
  halfDayMinHours: number;
  source: 'roster_exact' | 'roster_effective' | 'employee_shift' | 'default_shift';
}

/**
 * Normalizes a time string to HH:mm (24-hour).
 * Safely handles 12-hour AM/PM formats, 24:00, 00:00, etc.
 */
export function normalizeTimeStr(t?: any): string {
  if (t === null || t === undefined) return '09:00';
  const str = typeof t === 'string' ? t : String(t);
  if (!str || str === '-' || str === '--:--') return '09:00';
  const clean = str.trim().toLowerCase();
  if (clean === '24:00' || clean === '24:00:00' || clean === '00:00' || clean === '00:00:00' || clean === '12:00 am' || clean === '12:00am') {
    return '00:00';
  }
  const isPM = clean.includes('pm');
  const isAM = clean.includes('am');
  const match = clean.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '09:00';
  let h = parseInt(match[1], 10);
  const m = match[2];
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;
  if (h >= 24) h = 0;
  return `${String(h).padStart(2, '0')}:${m}`;
}

/**
 * Determines whether a shift crosses midnight (overnight shift).
 * Examples:
 * 14:00 -> 00:00 (ends at midnight = overnight)
 * 15:00 -> 12:00 AM (ends at midnight = overnight)
 * 20:00 -> 04:00 (ends next morning = overnight)
 * 22:00 -> 06:00 (ends next morning = overnight)
 */
export function isShiftOvernight(start: string, end: string): boolean {
  const normStart = normalizeTimeStr(start);
  const normEnd = normalizeTimeStr(end);
  if (normEnd === '00:00') return true;
  const [sH, sM] = normStart.split(':').map(Number);
  const [eH, eM] = normEnd.split(':').map(Number);
  const sMins = sH * 60 + sM;
  let eMins = eH * 60 + eM;
  if (eMins === 0) eMins = 24 * 60;
  return eMins <= sMins;
}

/**
 * Checks if a shift or schedule is an Evening, Night, or Overnight shift.
 * Shifts ending at midnight (00:00 / 12:00 AM / 24:00), ending in late evening (>= 21:00),
 * or named Evening / Night allow post-midnight punches (00:00 - 06:30)
 * to be correctly counted as check-out for that shift.
 */
export function isEveningOrOvernight(schedule?: ResolvedSchedule | {
  isOvernight?: boolean;
  shiftName?: string;
  startTime?: string;
  endTime?: string;
} | null): boolean {
  if (!schedule) return false;
  if (schedule.isOvernight) return true;
  const name = (schedule.shiftName || '').toLowerCase();
  if (name.includes('evening') || name.includes('night') || name.includes('overnight') || name.includes('closing')) {
    return true;
  }
  const end = normalizeTimeStr(schedule.endTime);
  if (end === '00:00') return true;
  const [eH] = end.split(':').map(Number);
  if (eH >= 21 || eH < 6) return true;
  const start = normalizeTimeStr(schedule.startTime);
  const [sH] = start.split(':').map(Number);
  if (sH >= 12 && (end === '00:00' || eH >= 21 || eH < 6)) return true;
  return false;
}

/**
 * Checks whether Overtime (OT) policy is enabled on a Shift object.
 */
export function isShiftOvertimeEnabled(shift?: Shift | null): boolean {
  if (!shift) return true;
  const raw = (shift as any).overtimePolicyEnabled;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  if ((shift as any).otEnabled === false || (shift as any).overtimeEnabled === false) return false;
  return true;
}

/**
 * Robust matching to find a Shift by ID or Name.
 * Handles whitespace, trailing spaces, case-insensitivity, abbreviations, and common shift aliases.
 * Prioritizes most recently updated shifts and respects disabled OT policies across duplicate records.
 */
export function findShiftByNameOrId(shifts: Shift[], shiftNameOrId?: any): Shift | null {
  if (!shiftNameOrId || !Array.isArray(shifts) || shifts.length === 0) return null;
  const clean = (typeof shiftNameOrId === 'string' ? shiftNameOrId : String(shiftNameOrId)).trim().toLowerCase();
  if (!clean || clean === 'off' || clean === 'weekend' || clean === 'none' || clean === 'unassigned' || clean === '-') {
    return null;
  }

  // Sort shifts so the most recently updated shift record comes first
  const sortedShifts = [...shifts].sort((a, b) => {
    const tA = a.updatedAt || '';
    const tB = b.updatedAt || '';
    if (tA !== tB) return tB.localeCompare(tA);
    // If timestamps are equal or missing, prefer the shift where overtimePolicyEnabled is explicitly false
    if (a.overtimePolicyEnabled === false && b.overtimePolicyEnabled !== false) return -1;
    if (b.overtimePolicyEnabled === false && a.overtimePolicyEnabled !== false) return 1;
    return 0;
  });

  const normTarget = clean.replace(/\s+/g, ' ');
  const baseTarget = clean.replace(/[^a-z0-9]/g, '');

  const finalizeMatch = (matched: Shift): Shift => {
    // If there are duplicate shift documents with the same normalized name, ensure that if the latest or any un-timestamped duplicate disabled OT, we preserve the latest policy
    const mBase = (matched.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!mBase) return matched;
    const sameNameShifts = sortedShifts.filter(
      s => (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === mBase
    );
    if (sameNameShifts.length > 1) {
      const latest = sameNameShifts[0];
      const anyExplicitOffWithoutTimestamp = sameNameShifts.some(
        s => !isShiftOvertimeEnabled(s) && (!latest.updatedAt || s.updatedAt === latest.updatedAt)
      );
      if (anyExplicitOffWithoutTimestamp) {
        return { ...latest, overtimePolicyEnabled: false };
      }
      return latest;
    }
    return matched;
  };

  // 1. Direct ID match
  const byId = sortedShifts.find(s => s.id && (s.id.toLowerCase().trim() === clean || s.id.toLowerCase().trim() === normTarget));
  if (byId) return finalizeMatch(byId);

  // 2. Exact Name match (trimmed, case-insensitive)
  const byName = sortedShifts.find(s => s.name && (s.name.trim().toLowerCase() === clean || s.name.trim().toLowerCase() === normTarget));
  if (byName) return finalizeMatch(byName);

  // 3. Compact alphanumeric match (ignores extra spaces/hyphens like "Evening Shift " vs "EVENING SHIFT" vs "evening-shift")
  const byBase = sortedShifts.find(s => {
    const sBase = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sIdBase = (s.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return Boolean(baseTarget && ((sBase && sBase === baseTarget) || (sIdBase && sIdBase === baseTarget)));
  });
  if (byBase) return finalizeMatch(byBase);

  // 4. Prefix / Substring match (only when neither name has a distinct trailing shift variant code like A/B/C/1/2)
  const hasVariantSuffix = (str: string) => /\b(shift\s+[a-z0-9]|\b[a-z0-9])$/i.test(str.trim());
  if (!hasVariantSuffix(clean)) {
    const byPrefix = sortedShifts.find(s => {
      const sName = (s.name || '').trim().toLowerCase();
      const sId = (s.id || '').trim().toLowerCase();
      if (hasVariantSuffix(sName)) return false;
      const nameMatch = sName.length >= 3 && clean.length >= 3 && (sName.startsWith(clean) || clean.startsWith(sName));
      const idMatch = sId.length >= 3 && clean.length >= 3 && (sId.startsWith(clean) || clean.startsWith(sId));
      return nameMatch || idMatch;
    });
    if (byPrefix) return finalizeMatch(byPrefix);
  }

  // 5. Keyword match (only when target has no variant suffix and only one shift matches the keyword)
  if (!hasVariantSuffix(clean)) {
    const keywords = ['morning', 'evening', 'night', 'day', 'flexible', 'general', 'split'];
    for (const kw of keywords) {
      if (clean.includes(kw)) {
        const matches = sortedShifts.filter(s => (s.name || '').toLowerCase().includes(kw) || (s.id || '').toLowerCase().includes(kw));
        if (matches.length === 1) return finalizeMatch(matches[0]);
      }
    }
  }

  return null;
}

/**
 * Calculates calendar date arithmetic (YYYY-MM-DD +/- days).
 */
export function offsetDateStr(dateStr: string, daysOffset: number): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + daysOffset);
    return date.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
}

/**
 * Formats a YYYY-MM-DD string into a human-friendly date (e.g. "01 Sep 2026") or "Present" if null/empty.
 */
export function formatEffectiveDateDisplay(dateStr?: string | null): string {
  if (!dateStr) return 'Present';
  const parts = String(dateStr).trim().split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return String(dateStr);
  const [y, m, d] = parts;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d).padStart(2, '0')} ${months[m - 1] || ''} ${y}`;
}

/**
 * Sorts an employee's shift assignment history chronologically by effectiveFrom ascending.
 */
export function sortShiftHistoryAsc(history?: ShiftAssignmentRecord[] | null): ShiftAssignmentRecord[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  return [...history]
    .filter(item => Boolean(item && item.shiftName && item.effectiveFrom))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/**
 * Determines the status of a shift assignment history entry relative to today's date.
 */
export function getShiftAssignmentStatus(
  entry: ShiftAssignmentRecord,
  todayStr?: string
): 'Active' | 'Scheduled' | 'Completed' {
  const refToday = todayStr || getBangladeshTodayStr();
  if (entry.effectiveFrom > refToday) return 'Scheduled';
  if (entry.effectiveTo && entry.effectiveTo < refToday) return 'Completed';
  return 'Active';
}

/**
 * Validates that a list of shift assignment history records has no overlapping date ranges
 * and no invalid start/end dates.
 */
export function validateShiftHistoryNoOverlap(
  history: ShiftAssignmentRecord[]
): { valid: boolean; error?: string } {
  const sorted = sortShiftHistoryAsc(history);
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr.effectiveTo && curr.effectiveTo < curr.effectiveFrom) {
      return {
        valid: false,
        error: `Shift "${curr.shiftName}" has Effective To (${formatEffectiveDateDisplay(curr.effectiveTo)}) earlier than Effective From (${formatEffectiveDateDisplay(curr.effectiveFrom)}).`,
      };
    }
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      if (!curr.effectiveTo) {
        return {
          valid: false,
          error: `Open-ended shift "${curr.shiftName}" (from ${formatEffectiveDateDisplay(curr.effectiveFrom)}) overlaps with "${next.shiftName}" (from ${formatEffectiveDateDisplay(next.effectiveFrom)}).`,
        };
      }
      if (curr.effectiveTo >= next.effectiveFrom) {
        return {
          valid: false,
          error: `Overlapping shift assignment dates: "${curr.shiftName}" (${formatEffectiveDateDisplay(curr.effectiveFrom)} – ${formatEffectiveDateDisplay(curr.effectiveTo)}) overlaps with "${next.shiftName}" (from ${formatEffectiveDateDisplay(next.effectiveFrom)}).`,
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Resolves the applicable shift name/ID for an employee on a specific YYYY-MM-DD date.
 * - Uses date-wise `emp.shiftHistory` when available so past attendance is NEVER recalculated with a newer shift.
 * - Preserves historical record shift snapshot (`fallbackRecordShiftName`) if no explicit history covers the date.
 * - Preserves existing default fallback (`emp.shift`) if no explicit assignment or history exists.
 */
export function resolveEmployeeShiftNameForDate(
  emp: Employee | undefined | null,
  dateStr: string,
  fallbackRecordShiftName?: string
): string {
  const cleanFallback =
    fallbackRecordShiftName &&
    !['unassigned', 'weekend / off', 'off', 'weekend', '-', 'none'].includes(fallbackRecordShiftName.trim().toLowerCase())
      ? fallbackRecordShiftName.trim()
      : '';

  if (!emp) return cleanFallback;

  const history = sortShiftHistoryAsc(emp.shiftHistory);
  if (history.length > 0 && dateStr) {
    // 1. Exact effective period match: effectiveFrom <= dateStr <= (effectiveTo || Infinity)
    const exactMatch = history.find(
      entry => dateStr >= entry.effectiveFrom && (!entry.effectiveTo || dateStr <= entry.effectiveTo)
    );
    if (exactMatch) {
      return exactMatch.shiftName || exactMatch.shiftId || '';
    }

    // 2. Date is earlier than the first recorded effectiveFrom in history:
    // If history has multiple entries (meaning shift was changed) and the attendance record has a specific non-default shiftName, preserve it;
    // otherwise use the earliest recorded shift in history so past dates never flip to a newly assigned shift.
    if (dateStr < history[0].effectiveFrom) {
      const isGenericFallback = !cleanFallback || cleanFallback.toLowerCase() === 'general shift';
      if (history.length > 1 && !isGenericFallback) {
        return cleanFallback;
      }
      return history[0].shiftName || history[0].shiftId || cleanFallback || emp.shift || '';
    }

    // 3. Date falls in a gap between closed entries or after a closed entry:
    const latestPrior = [...history].reverse().find(entry => entry.effectiveFrom <= dateStr);
    if (latestPrior) {
      return latestPrior.shiftName || latestPrior.shiftId || cleanFallback || '';
    }
    if (cleanFallback) return cleanFallback;
  }

  return (
    emp.shift ||
    (emp as any).shiftName ||
    (emp as any).assignedShift ||
    (emp as any).shiftId ||
    cleanFallback ||
    ''
  );
}

export const ROSTER_AUTO_CONTINUE_KEY = 'worknest_auto_continue_roster';

/**
 * Checks whether automatic monthly roster continuation is enabled (defaults to true).
 */
export function isRosterAutoContinueEnabled(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true;
    return window.localStorage.getItem(ROSTER_AUTO_CONTINUE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Sets whether automatic monthly roster continuation is enabled.
 */
export function setRosterAutoContinueEnabled(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ROSTER_AUTO_CONTINUE_KEY, enabled ? 'true' : 'false');
      window.dispatchEvent(new Event('worknest_roster_auto_continue_changed'));
    }
  } catch {}
}

/**
 * Safely computes day of week (0 = Sun .. 6 = Sat) from YYYY-MM-DD without local timezone shift.
 */
export function getSafeDayOfWeekFromDateStr(dateStr: string): number {
  const parts = String(dateStr || '').split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return -1;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
}

/**
 * Resolves an auto-continued (recurring weekly pattern) roster entry for an employee on `dateStr`
 * when `dateStr` is in a month that has NO explicit roster entries for that employee,
 * by inheriting the employee's weekday pattern (Sun..Sat) from their most recent prior rostered month.
 *
 * CRITICAL:
 * - Never projects backward into historical months prior to the employee's first rostered month.
 * - Never overrides a month that already has explicit roster entries for this employee.
 * - Never copies one-time `isExtraDay` flags into future months.
 */
export function findAutoContinuedRosterEntryForDate(
  emp: Employee | undefined | null,
  dateStr: string,
  roster: RosterEntry[],
  forceEnable?: boolean
): (RosterEntry & { sourceMonth?: string }) | null {
  if (!emp || !dateStr || dateStr.length < 10 || !Array.isArray(roster) || roster.length === 0) {
    return null;
  }
  if (!forceEnable && !isRosterAutoContinueEnabled()) {
    return null;
  }

  const empId = String(emp.employeeId || emp.id || '').toLowerCase().trim();
  const empMainId = String(emp.id || '').toLowerCase().trim();
  const empDigits = empId.replace(/\D/g, '');
  const empNameLower = String(emp.name || '').trim().toLowerCase();

  const empRosters = roster.filter(r => {
    if (!r.date || r.date.length < 7) return false;
    const rEmpId = String(r.employeeId || '').toLowerCase().trim();
    if (!rEmpId && !r.employeeName) return false;
    if (rEmpId === empId || rEmpId === empMainId) return true;
    const rDigits = rEmpId.replace(/\D/g, '');
    if (rDigits && empDigits && rDigits === empDigits && rDigits.length >= 2) return true;
    if (r.employeeName && empNameLower && r.employeeName.trim().toLowerCase() === empNameLower) return true;
    return false;
  });

  if (empRosters.length === 0) return null;

  const targetMonth = dateStr.slice(0, 7);

  // If this employee ALREADY has explicit roster entries in `targetMonth`, do NOT auto-project from prior months
  const hasExplicitEntriesInTargetMonth = empRosters.some(r => r.date.startsWith(targetMonth));
  if (hasExplicitEntriesInTargetMonth) {
    return null;
  }

  // Find all roster entries for this employee from months strictly BEFORE `targetMonth`
  const priorEntries = empRosters.filter(r => r.date.slice(0, 7) < targetMonth);
  if (priorEntries.length === 0) {
    return null;
  }

  // Identify the most recent prior month that had roster entries for this employee
  let latestPriorMonth = '';
  for (const r of priorEntries) {
    const m = r.date.slice(0, 7);
    if (m > latestPriorMonth) {
      latestPriorMonth = m;
    }
  }
  if (!latestPriorMonth) return null;

  const latestMonthEntries = priorEntries.filter(r => r.date.startsWith(latestPriorMonth));
  const targetDow = getSafeDayOfWeekFromDateStr(dateStr);
  if (targetDow < 0) return null;

  const sameDowEntries = latestMonthEntries
    .filter(r => getSafeDayOfWeekFromDateStr(r.date) === targetDow)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (sameDowEntries.length === 0) return null;

  const latestMatch = sameDowEntries[0];
  return {
    ...latestMatch,
    isExtraDay: false, // Never carry forward one-time overtime/extra day flags automatically
    sourceMonth: latestPriorMonth,
  };
}

/**
 * Authority Precedence Engine for Employee Schedule on a Specific Date:
 *
 * CRITICAL RULES:
 * 1. Roster is the ONLY authority for Weekend/Off. There is NO automatic Saturday/Sunday/Friday weekend!
 * 2. Explicit roster entry for date -> auto-continued weekly roster pattern from latest prior month -> active effective roster -> date-wise assigned employee shift -> default shift.
 * 3. Exact shift times, grace, break and policies are preserved without hardcoding.
 * 4. Changing an employee's current shift never alters historical dates because shift resolution is strictly date-wise.
 */
export function resolveEmployeeScheduleForDate(
  emp: Employee,
  dateStr: string,
  roster: RosterEntry[],
  shifts: Shift[],
  fallbackRecordShiftName?: string
): ResolvedSchedule {
  const empId = String(emp.employeeId || emp.id || '').toLowerCase().trim();
  const empMainId = String(emp.id || '').toLowerCase().trim();
  const empDigits = empId.replace(/\D/g, '');
  const empNameLower = String(emp.name || '').trim().toLowerCase();

  // Resolve the employee's applicable shift for THIS specific `dateStr` (never blindly using current emp.shift for past dates)
  const empAssignedShiftRaw = resolveEmployeeShiftNameForDate(emp, dateStr, fallbackRecordShiftName);
  const empAssignedShiftObj = findShiftByNameOrId(shifts, empAssignedShiftRaw);

  // Check if there is an explicit Shift Assignment History entry covering this date (or earliest entry for prior dates)
  const sortedHistory = sortShiftHistoryAsc(emp.shiftHistory);
  const explicitHistoryEntry = dateStr
    ? sortedHistory.find(
        entry => dateStr >= entry.effectiveFrom && (!entry.effectiveTo || dateStr <= entry.effectiveTo)
      ) || (sortedHistory.length > 0 && dateStr < sortedHistory[0].effectiveFrom ? sortedHistory[0] : undefined)
    : undefined;

  // If the matched shift history entry is a CLOSED historical period (effectiveTo != null) and has a saved timing snapshot,
  // merge that snapshot over the shift object so later edits to the Shift's master timing do not corrupt closed past periods.
  const applyHistorySnapshot = (baseShift: Shift | null, histEntry?: ShiftAssignmentRecord): Shift | null => {
    if (!histEntry || !histEntry.startTime || !histEntry.endTime) return baseShift;
    const isClosedPeriod = Boolean(histEntry.effectiveTo);
    if (!isClosedPeriod && baseShift) {
      // For the currently open/active assignment, use the live shift definition so timing fixes apply immediately
      return baseShift;
    }
    return {
      ...(baseShift || {
        id: histEntry.shiftId || histEntry.id,
        name: histEntry.shiftName,
        description: histEntry.note || 'Historical Shift Snapshot',
        status: 'active' as const,
      }),
      name: histEntry.shiftName || baseShift?.name || 'Assigned Shift',
      startTime: histEntry.startTime,
      endTime: histEntry.endTime,
      graceTime: histEntry.graceTime ?? baseShift?.graceTime ?? 15,
      breakTime: histEntry.breakTime ?? baseShift?.breakTime ?? 60,
      totalHours: histEntry.totalHours ?? baseShift?.totalHours ?? 8,
      type: histEntry.type || baseShift?.type || 'fixed',
      latePolicyEnabled: histEntry.latePolicyEnabled ?? baseShift?.latePolicyEnabled ?? true,
      latePenaltyMode: histEntry.latePenaltyMode || baseShift?.latePenaltyMode || 'salary_deduction',
      earlyOutPolicyEnabled: histEntry.earlyOutPolicyEnabled ?? baseShift?.earlyOutPolicyEnabled ?? true,
      earlyOutTolerance: histEntry.earlyOutTolerance ?? baseShift?.earlyOutTolerance ?? 15,
      overtimePolicyEnabled: histEntry.overtimePolicyEnabled ?? baseShift?.overtimePolicyEnabled ?? true,
      minOvertimeMinutes: histEntry.minOvertimeMinutes ?? baseShift?.minOvertimeMinutes ?? 30,
      maxOvertimeHours: histEntry.maxOvertimeHours ?? baseShift?.maxOvertimeHours,
      halfDayMinHours: histEntry.halfDayMinHours ?? baseShift?.halfDayMinHours ?? 4,
    };
  };

  const effectiveEmpShiftObj = applyHistorySnapshot(empAssignedShiftObj, explicitHistoryEntry);

  // Helper to match roster employee ID
  const isEmpRoster = (r: RosterEntry) => {
    const rEmpId = String(r.employeeId || '').toLowerCase().trim();
    if (!rEmpId && !r.employeeName) return false;
    if (rEmpId === empId || rEmpId === empMainId) return true;
    const rDigits = rEmpId.replace(/\D/g, '');
    if (rDigits && empDigits && rDigits === empDigits && rDigits.length >= 2) return true;
    if (r.employeeName && empNameLower && r.employeeName.trim().toLowerCase() === empNameLower) return true;
    return false;
  };

  // 1. Check explicit roster entry on this exact date, OR auto-continued recurring weekly pattern from latest prior rostered month
  const exactRoster = roster.find(r => isEmpRoster(r) && r.date === dateStr);
  const autoContinuedRoster = !exactRoster ? findAutoContinuedRosterEntryForDate(emp, dateStr, roster) : null;
  const matchedRosterEntry = exactRoster || autoContinuedRoster;

  if (matchedRosterEntry) {
    const isOff = Boolean(
      matchedRosterEntry.isOffDay ||
      matchedRosterEntry.shift?.toLowerCase() === 'off' ||
      matchedRosterEntry.shift?.toLowerCase() === 'weekend'
    );

    if (isOff) {
      return {
        isOff: true,
        isWeekend: true,
        shiftName: 'Weekend / Off',
        shift: null,
        startTime: '09:00',
        endTime: '18:00',
        graceTime: 15,
        breakTime: 60,
        isOvernight: false,
        totalRequiredHours: 0,
        latePolicyEnabled: false,
        latePenaltyMode: 'none',
        earlyOutPolicyEnabled: false,
        earlyOutTolerance: 0,
        overtimePolicyEnabled: false,
        minOvertimeMinutes: 0,
        halfDayMinHours: 0,
        source: exactRoster ? 'roster_exact' : 'roster_effective',
      };
    }

    // Working shift in roster (fallback to employee's date-wise assigned shift if roster shift name isn't found in shifts)
    // If an explicit date-wise shift assignment was created MORE RECENTLY than this roster entry (or has a newer effectiveFrom than an auto-continued prior month entry), prioritize the date-wise shift assignment
    const preferHistoryOverRoster = Boolean(
      explicitHistoryEntry &&
      (
        (explicitHistoryEntry.assignedAt && (!matchedRosterEntry.updatedAt || explicitHistoryEntry.assignedAt > matchedRosterEntry.updatedAt)) ||
        (!exactRoster && explicitHistoryEntry.effectiveFrom && matchedRosterEntry.date && explicitHistoryEntry.effectiveFrom > matchedRosterEntry.date)
      )
    );

    const matchedShift = preferHistoryOverRoster
      ? (effectiveEmpShiftObj || findShiftByNameOrId(shifts, matchedRosterEntry.shift || matchedRosterEntry.shiftId))
      : (findShiftByNameOrId(shifts, matchedRosterEntry.shift || matchedRosterEntry.shiftId) || effectiveEmpShiftObj);
    const rShiftName = matchedShift?.name || (preferHistoryOverRoster ? empAssignedShiftRaw : matchedRosterEntry.shift) || 'General Shift';
    const isFlexible = matchedShift?.type === 'flexible' || rShiftName.toLowerCase().includes('flexible');
    const isEvening = rShiftName.toLowerCase().includes('evening');
    const startTime = matchedShift?.startTime || (isEvening ? '14:00' : '09:00');
    const endTime = matchedShift?.endTime || (isEvening ? '00:00' : '18:00');
    const overnight = isShiftOvernight(startTime, endTime);

    return {
      isOff: false,
      isWeekend: false,
      shiftName: matchedShift?.name || rShiftName,
      shift: matchedShift,
      startTime: isFlexible ? '--:--' : startTime,
      endTime,
      graceTime: matchedShift?.graceTime ?? 15,
      breakTime: matchedShift?.breakTime ?? 60,
      isOvernight: overnight,
      totalRequiredHours: matchedShift?.totalHours ?? (isFlexible ? (matchedShift?.flexibleMinHours || 8) : 8),
      latePolicyEnabled: isFlexible ? false : (matchedShift?.latePolicyEnabled ?? true),
      latePenaltyMode: isFlexible ? 'none' : (matchedShift?.latePenaltyMode || 'salary_deduction'),
      earlyOutPolicyEnabled: isFlexible ? false : (matchedShift?.earlyOutPolicyEnabled ?? true),
      earlyOutTolerance: matchedShift?.earlyOutTolerance ?? 15,
      overtimePolicyEnabled: matchedShift ? isShiftOvertimeEnabled(matchedShift) : isShiftOvertimeEnabled(empAssignedShiftObj),
      minOvertimeMinutes: matchedShift?.minOvertimeMinutes ?? 30,
      maxOvertimeHours: matchedShift?.maxOvertimeHours,
      halfDayMinHours: matchedShift?.halfDayMinHours ?? 4,
      source: exactRoster ? 'roster_exact' : 'roster_effective',
    };
  }

  // 2. Check active effective roster assignment covering this date (only range-based roster entries, not single-day entries for other dates)
  const effectiveRosters = roster.filter(
    r =>
      isEmpRoster(r) &&
      (!r.date || r.date === dateStr || Boolean(r.effectiveTo)) &&
      r.effectiveFrom &&
      r.effectiveFrom <= dateStr &&
      (!r.effectiveTo || r.effectiveTo >= dateStr)
  );
  if (effectiveRosters.length > 0 && !explicitHistoryEntry) {
    // Sort descending by effectiveFrom
    effectiveRosters.sort((a, b) => (b.effectiveFrom || '').localeCompare(a.effectiveFrom || ''));
    const latestRoster = effectiveRosters[0];
    const isOff = Boolean(
      latestRoster.isOffDay ||
      latestRoster.shift?.toLowerCase() === 'off' ||
      latestRoster.shift?.toLowerCase() === 'weekend'
    );

    if (isOff) {
      return {
        isOff: true,
        isWeekend: true,
        shiftName: 'Weekend / Off',
        shift: null,
        startTime: '09:00',
        endTime: '18:00',
        graceTime: 15,
        breakTime: 60,
        isOvernight: false,
        totalRequiredHours: 0,
        latePolicyEnabled: false,
        latePenaltyMode: 'none',
        earlyOutPolicyEnabled: false,
        earlyOutTolerance: 0,
        overtimePolicyEnabled: false,
        minOvertimeMinutes: 0,
        halfDayMinHours: 0,
        source: 'roster_effective',
      };
    }

    const matchedShift =
      findShiftByNameOrId(shifts, latestRoster.shift || latestRoster.shiftId) ||
      effectiveEmpShiftObj;
    const effShiftName = matchedShift?.name || latestRoster.shift || 'General Shift';
    const isFlexible = matchedShift?.type === 'flexible' || effShiftName.toLowerCase().includes('flexible');
    const isEvening = effShiftName.toLowerCase().includes('evening');
    const startTime = matchedShift?.startTime || (isEvening ? '14:00' : '09:00');
    const endTime = matchedShift?.endTime || (isEvening ? '00:00' : '18:00');
    const overnight = isShiftOvernight(startTime, endTime);

    return {
      isOff: false,
      isWeekend: false,
      shiftName: matchedShift?.name || effShiftName,
      shift: matchedShift,
      startTime: isFlexible ? '--:--' : startTime,
      endTime,
      graceTime: matchedShift?.graceTime ?? 15,
      breakTime: matchedShift?.breakTime ?? 60,
      isOvernight: overnight,
      totalRequiredHours: matchedShift?.totalHours ?? (isFlexible ? (matchedShift?.flexibleMinHours || 8) : 8),
      latePolicyEnabled: isFlexible ? false : (matchedShift?.latePolicyEnabled ?? true),
      latePenaltyMode: isFlexible ? 'none' : (matchedShift?.latePenaltyMode || 'salary_deduction'),
      earlyOutPolicyEnabled: isFlexible ? false : (matchedShift?.earlyOutPolicyEnabled ?? true),
      earlyOutTolerance: matchedShift?.earlyOutTolerance ?? 15,
      overtimePolicyEnabled: matchedShift ? isShiftOvertimeEnabled(matchedShift) : isShiftOvertimeEnabled(empAssignedShiftObj),
      minOvertimeMinutes: matchedShift?.minOvertimeMinutes ?? 30,
      maxOvertimeHours: matchedShift?.maxOvertimeHours,
      halfDayMinHours: matchedShift?.halfDayMinHours ?? 4,
      source: 'roster_effective',
    };
  }

  // 3. Fallback to Employee's Assigned Shift
  const empShift = empAssignedShiftRaw;
  if (empShift && String(empShift).trim()) {
    const cleanShift = String(empShift).trim();
    const matchedShift = effectiveEmpShiftObj || findShiftByNameOrId(shifts, cleanShift);
    if (matchedShift) {
      const isFlexible = matchedShift.type === 'flexible' || matchedShift.name?.toLowerCase().includes('flexible') || cleanShift.toLowerCase().includes('flexible');
      const startTime = matchedShift.startTime || '09:00';
      const endTime = matchedShift.endTime || '18:00';
      const overnight = isShiftOvernight(startTime, endTime);

      return {
        isOff: false,
        isWeekend: false,
        shiftName: matchedShift.name,
        shift: matchedShift,
        startTime: isFlexible ? '--:--' : startTime,
        endTime,
        graceTime: matchedShift.graceTime ?? 15,
        breakTime: matchedShift.breakTime ?? 60,
        isOvernight: overnight,
        totalRequiredHours: matchedShift.totalHours ?? (isFlexible ? (matchedShift.flexibleMinHours || 8) : 8),
        latePolicyEnabled: isFlexible ? false : (matchedShift.latePolicyEnabled ?? true),
        latePenaltyMode: isFlexible ? 'none' : (matchedShift.latePenaltyMode || 'salary_deduction'),
        earlyOutPolicyEnabled: isFlexible ? false : (matchedShift.earlyOutPolicyEnabled ?? true),
        earlyOutTolerance: matchedShift.earlyOutTolerance ?? 15,
        overtimePolicyEnabled: isShiftOvertimeEnabled(matchedShift),
        minOvertimeMinutes: matchedShift.minOvertimeMinutes ?? 30,
        maxOvertimeHours: matchedShift.maxOvertimeHours,
        halfDayMinHours: matchedShift.halfDayMinHours ?? 4,
        source: 'employee_shift',
      };
    } else {
      const isFlexible = cleanShift.toLowerCase().includes('flexible') || cleanShift.toLowerCase().includes('flexi');
      const isEvening = cleanShift.toLowerCase().includes('evening');
      const startTime = isEvening ? '14:00' : '09:00';
      const endTime = isEvening ? '00:00' : '18:00';
      const overnight = isShiftOvernight(startTime, endTime);

      return {
        isOff: false,
        isWeekend: false,
        shiftName: cleanShift,
        shift: null,
        startTime: isFlexible ? '--:--' : startTime,
        endTime,
        graceTime: 15,
        breakTime: 60,
        isOvernight: overnight,
        totalRequiredHours: 8,
        latePolicyEnabled: isFlexible ? false : true,
        latePenaltyMode: isFlexible ? 'none' : 'salary_deduction',
        earlyOutPolicyEnabled: isFlexible ? false : true,
        earlyOutTolerance: 15,
        overtimePolicyEnabled: true,
        minOvertimeMinutes: 30,
        halfDayMinHours: 4,
        source: 'employee_shift',
      };
    }
  }

  // 4. Default: User requested default shift to be blank / unassigned (NOT hardcoded to Day Shift)
  return {
    isOff: false,
    isWeekend: false,
    shiftName: 'Unassigned',
    shift: null,
    startTime: '--:--',
    endTime: '--:--',
    graceTime: 15,
    breakTime: 60,
    isOvernight: false,
    totalRequiredHours: 0,
    latePolicyEnabled: false,
    latePenaltyMode: 'none',
    earlyOutPolicyEnabled: false,
    earlyOutTolerance: 0,
    overtimePolicyEnabled: false,
    minOvertimeMinutes: 0,
    halfDayMinHours: 0,
    source: 'default_shift',
  };
}

/**
 * Calculates work duration in hours and minutes.
 * Correctly supports overnight shifts crossing midnight!
 *
 * Example:
 * in: "14:15", out: "00:20" on overnight shift
 * duration = (24 * 60 + 20) - (14 * 60 + 15) = 1460 - 855 = 605 minutes = 10.08 hours!
 */
export function calculateDutyDuration(
  checkIn: string,
  checkOut: string,
  isOvernight: boolean,
  breakMinutes: number = 0
): { durationHours: number; durationMinutes: number; netHours: number } {
  if (!checkIn || checkIn === '-' || !checkOut || checkOut === '-' || checkIn === checkOut) {
    return { durationHours: 0, durationMinutes: 0, netHours: 0 };
  }

  const normIn = normalizeTimeStr(checkIn);
  const normOut = normalizeTimeStr(checkOut);
  if (normIn === normOut) {
    return { durationHours: 0, durationMinutes: 0, netHours: 0 };
  }

  const [inH, inM] = normIn.split(':').map(Number);
  const [outH, outM] = normOut.split(':').map(Number);

  const inMins = (inH || 0) * 60 + (inM || 0);
  let outMins = (outH || 0) * 60 + (outM || 0);

  // If overnight shift or post-midnight checkout, add 24 hours
  if (outMins <= inMins && (isOvernight || (inMins >= 10 * 60 && outMins <= 8 * 60))) {
    outMins += 24 * 60;
  }

  const diffMins = Math.max(0, outMins - inMins);
  const netMins = Math.max(0, diffMins - breakMinutes);

  return {
    durationHours: Math.round((diffMins / 60) * 100) / 100,
    durationMinutes: diffMins,
    netHours: Math.round((netMins / 60) * 100) / 100,
  };
}

/**
 * Determines whether a punch at `punchTime` on `punchDate`
 * belongs to the previous day's overnight shift as a Check-Out punch.
 */
export function isOvernightCheckoutForPreviousDay(
  punchTime: string,
  punchDate: string,
  emp: Employee,
  roster: RosterEntry[],
  shifts: Shift[]
): boolean {
  const [pH, pM] = punchTime.split(':').map(Number);
  const punchMins = (pH || 0) * 60 + (pM || 0);

  // An after-midnight checkout punch occurs between 00:00 and 06:30
  if (punchMins > 6 * 60 + 30) return false;

  const yesterdayDate = offsetDateStr(punchDate, -1);
  const yesterdaySchedule = resolveEmployeeScheduleForDate(emp, yesterdayDate, roster, shifts);

  const isEmpFlexible = yesterdaySchedule.shift?.type === 'flexible' ||
    yesterdaySchedule.shiftName.toLowerCase().includes('flexible') ||
    Boolean(emp.shift && emp.shift.toLowerCase().includes('flexible'));

  if (!yesterdaySchedule.isOff && (isEveningOrOvernight(yesterdaySchedule) || isEmpFlexible)) {
    // Yesterday had an overnight, evening, or flexible shift
    return true;
  }

  return false;
}

/**
 * Calculates overtime hours based on:
 * 1. Required shift duration (Working Hours + Break Time = Total Span, e.g. 9h + 60m = 10 Hours / 600 mins).
 * 2. Overtime Qualification Threshold (e.g. minOvertimeMinutes = 30 mins).
 * 3. Employee must cross the 10 hours required shift duration AND the 30-minute threshold before OT starts counting.
 */
export function calculateOvertimeHours(
  checkIn: string,
  checkOut: string,
  schedule?: ResolvedSchedule | {
    isOvernight?: boolean;
    startTime?: string;
    endTime?: string;
    breakTime?: number;
    totalRequiredHours?: number;
    minOvertimeMinutes?: number;
    overtimePolicyEnabled?: boolean;
    maxOvertimeHours?: number;
    shift?: Shift | null;
  } | null
): number {
  if (!checkIn || checkIn === '-' || !checkOut || checkOut === '-' || checkIn === checkOut) {
    return 0;
  }

  // 1. If overtime policy is disabled, no overtime
  const rawSchedOt = (schedule as any)?.overtimePolicyEnabled;
  const otEnabled =
    rawSchedOt !== false &&
    rawSchedOt !== 'false' &&
    rawSchedOt !== 0 &&
    isShiftOvertimeEnabled(schedule?.shift);
  if (!otEnabled) {
    return 0;
  }

  const normIn = normalizeTimeStr(checkIn);
  const normOut = normalizeTimeStr(checkOut);
  if (normIn === normOut) {
    return 0;
  }

  const [inH, inM] = normIn.split(':').map(Number);
  const [outH, outM] = normOut.split(':').map(Number);
  if (isNaN(inH) || isNaN(inM) || isNaN(outH) || isNaN(outM)) {
    return 0;
  }

  const inMins = inH * 60 + inM;
  let outMins = outH * 60 + outM;

  const isOvernight = Boolean(schedule?.isOvernight);
  if (outMins <= inMins && (isOvernight || (inMins >= 10 * 60 && outMins <= 8 * 60))) {
    outMins += 24 * 60;
  }

  // Total time spent between check-in and check-out
  const totalDurationMinutes = Math.max(0, outMins - inMins);

  // Standard shift requirement:
  // Shift has Working Hour (e.g. 9h) + Break Time (e.g. 60m) = Total Required Hours (e.g. 10h = 600m)
  const breakMinutes = schedule?.breakTime ?? (schedule?.shift?.breakTime ?? 60);
  const workingHours = schedule?.totalRequiredHours ?? (schedule?.shift?.totalHours ?? 9);
  let requiredShiftSpanMinutes = Math.round(workingHours * 60) + breakMinutes;

  const startTimeStr = schedule?.startTime && schedule.startTime !== '--:--' ? schedule.startTime : null;
  const endTimeStr = schedule?.endTime && schedule.endTime !== '--:--' ? schedule.endTime : null;

  let isFixedShift = false;
  let scheduledEndMins = 0;
  if (startTimeStr && endTimeStr) {
    isFixedShift = true;
    const [sH, sM] = startTimeStr.split(':').map(Number);
    const [eH, eM] = (endTimeStr === '00:00' ? [24, 0] : endTimeStr.split(':').map(Number));
    const sMins = (sH || 0) * 60 + (sM || 0);
    let eMins = (eH || 0) * 60 + (eM || 0);
    if (isOvernight && eMins <= sMins) {
      eMins += 24 * 60;
    }
    scheduledEndMins = eMins;
    const scheduledSpan = Math.max(0, eMins - sMins);
    if (scheduledSpan > 0) {
      requiredShiftSpanMinutes = Math.max(requiredShiftSpanMinutes, scheduledSpan);
    }
  }

  // Qualification threshold (default 30 mins)
  const thresholdMinutes = schedule?.minOvertimeMinutes ?? (schedule?.shift?.minOvertimeMinutes ?? 30);

  // Must have worked more than the 10 hours required duration
  if (totalDurationMinutes <= requiredShiftSpanMinutes) {
    return 0;
  }

  // Excess past 10 hours
  const excessPastRequiredMinutes = totalDurationMinutes - requiredShiftSpanMinutes;

  let excessMinutes = excessPastRequiredMinutes;
  if (isFixedShift && scheduledEndMins > 0) {
    const excessPastEnd = Math.max(0, outMins - scheduledEndMins);
    excessMinutes = Math.min(excessPastRequiredMinutes, excessPastEnd);
  }

  // Must cross the qualification threshold (e.g. 30 minutes)
  if (excessMinutes < thresholdMinutes) {
    return 0;
  }

  let otHours = Math.round((excessMinutes / 60) * 10) / 10;

  const maxOt = schedule?.maxOvertimeHours ?? schedule?.shift?.maxOvertimeHours;
  if (maxOt && maxOt > 0 && otHours > maxOt) {
    otHours = maxOt;
  }

  return otHours;
}

/**
 * Returns the current calendar date string (YYYY-MM-DD) in Bangladesh Standard Time (Asia/Dhaka, UTC+6)
 * so that right after 12:00 AM midnight local time, today's date immediately rolls over to the new day
 * instead of staying on yesterday's UTC date until 6:00 AM.
 */
export function getBangladeshTodayStr(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) {
      return `${y}-${m}-${d}`;
    }
  } catch {}
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Resolves the required daily working hours for a given Shift object.
 * - For Flexible shifts: uses `flexibleMinHours` or `totalHours` (fallback 8).
 * - For Fixed shifts: uses `totalHours` (which is `(endTime - startTime) - breakTime`), or computes it from `startTime`, `endTime`, and `breakTime`.
 */
export function getShiftWorkingHours(shift?: Shift | null): number {
  if (!shift) return 8;
  if (shift.type === 'flexible') {
    const flexH = Number(shift.flexibleMinHours) || Number(shift.totalHours);
    return flexH > 0 ? flexH : 8;
  }
  if (Number(shift.totalHours) > 0) {
    return Number(shift.totalHours);
  }
  if (shift.startTime && shift.endTime && shift.startTime !== '--:--' && shift.endTime !== '--:--') {
    const [sh, sm] = normalizeTimeStr(shift.startTime).split(':').map(Number);
    const [eh, em] = normalizeTimeStr(shift.endTime).split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    const breakMin = shift.breakTime !== undefined && shift.breakTime !== null ? Number(shift.breakTime) : 60;
    const calc = (mins - breakMin) / 60;
    if (calc > 0) return Number(calc.toFixed(2));
  }
  return 8;
}

/**
 * Resolves the employee's Shift Working Hours from their assigned shift, active roster, or attendance records.
 */
export function getEmployeeShiftWorkingHours(
  emp: Employee,
  shifts: Shift[],
  roster?: RosterEntry[],
  selectedMonth?: string,
  attendanceRecords?: any[]
): number {
  // 1. Date-wise shift for the target month (if selectedMonth is provided) or current effective shift
  const targetDateForMonth = selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)
    ? `${selectedMonth}-15`
    : getBangladeshTodayStr();
  const empAssignedRaw = resolveEmployeeShiftNameForDate(emp, targetDateForMonth);
  const directShift = findShiftByNameOrId(shifts, empAssignedRaw);
  if (directShift) {
    return getShiftWorkingHours(directShift);
  }

  const empId = String(emp.employeeId || emp.id || '').toLowerCase().trim();
  const empMainId = String(emp.id || '').toLowerCase().trim();
  const empDigits = empId.replace(/\D/g, '');
  const empNameLower = String(emp.name || '').trim().toLowerCase();

  // 2. Check roster entries for this employee (preferring selectedMonth)
  if (Array.isArray(roster) && roster.length > 0) {
    const empRosters = roster.filter(r => {
      if (r.isOffDay) return false;
      const sName = String(r.shift || '').trim().toLowerCase();
      if (!sName || sName === 'off' || sName === 'weekend') return false;
      const rEmpId = String(r.employeeId || '').toLowerCase().trim();
      const rDigits = rEmpId.replace(/\D/g, '');
      const rName = String(r.employeeName || '').trim().toLowerCase();
      return (
        (empId && rEmpId === empId) ||
        (empMainId && rEmpId === empMainId) ||
        (empDigits && rDigits && empDigits === rDigits && rDigits.length >= 2) ||
        (empNameLower && rName === empNameLower)
      );
    });
    const monthRosters = selectedMonth
      ? empRosters.filter(r => (r.date && r.date.startsWith(selectedMonth)) || (r.effectiveFrom && r.effectiveFrom <= `${selectedMonth}-31`))
      : empRosters;
    const targetList = monthRosters.length > 0 ? monthRosters : empRosters;
    for (const r of targetList) {
      const mShift = findShiftByNameOrId(shifts, r.shift || r.shiftId);
      if (mShift) return getShiftWorkingHours(mShift);
    }
  }

  // 3. Check attendance records if provided
  if (Array.isArray(attendanceRecords) && attendanceRecords.length > 0) {
    for (const a of attendanceRecords) {
      if (a?.shiftName) {
        const mShift = findShiftByNameOrId(shifts, a.shiftName);
        if (mShift) return getShiftWorkingHours(mShift);
      }
    }
  }

  // 4. Fallback to first active shift if available
  const activeShift = shifts.find(s => s.status === 'active') || shifts[0];
  if (activeShift) {
    return getShiftWorkingHours(activeShift);
  }

  return 8;
}

/**
 * Calculates Hourly Overtime Rate according to user rule:
 * 1. Divide Basic Salary by 30 (Monthly 30 days): `oneDayBasic = basicSalary / 30`
 * 2. Divide that 1-day Basic by Shift Working Hours: `hourlyBasic = oneDayBasic / shiftWorkingHours`
 * 3. Multiply that hourly amount by 1.5: `otRate = hourlyBasic * 1.5`
 */
export function calculateHourlyOtRate(basicSalary: number, shiftWorkingHours: number): number {
  const safeBasic = Number(basicSalary) || 0;
  const safeHours = Number(shiftWorkingHours) > 0 ? Number(shiftWorkingHours) : 8;
  const oneDayBasic = safeBasic / 30;
  const hourlyBasic = oneDayBasic / safeHours;
  const otRate = hourlyBasic * 1.5;
  return Number(otRate.toFixed(2));
}

/**
 * Authoritative evaluator for a single day's attendance status, late minutes, and early-out status
 * against the date-wise ResolvedSchedule.
 *
 * CRITICAL:
 * - Always evaluates check-in time (`rawIn`) against the date's effective `sched.startTime` + `sched.graceTime`
 *   (unless the record was explicitly manually overridden by an admin with `source === 'admin_edit'` and a non-late status).
 * - Prevents stale Firestore `status: 'late'` or `lateMinutes` (e.g. calculated against a 09:00 fallback when the
 *   actual shift starts at 10:00 AM) from falsely marking on-time punches as Late.
 */
export function evaluateAttendanceForSchedule(
  rawIn: string,
  rawOut: string,
  sched: ResolvedSchedule | null | undefined,
  attRecord?: any,
  dateShiftName?: string
): {
  status: string;
  lateMinutes: number;
  isEarlyOut: boolean;
  earlyOutMinutes: number;
  isFlexibleShift: boolean;
} {
  const cleanIn = rawIn && rawIn !== '--:--' ? String(rawIn).trim() : '-';
  const cleanOut = rawOut && rawOut !== '--:--' ? String(rawOut).trim() : '-';
  const hasPunch = cleanIn !== '-' || cleanOut !== '-';

  const isWeekend = Boolean(sched?.isWeekend || sched?.isOff);
  const isFlexibleShift = Boolean(
    sched?.shift?.type === 'flexible' ||
    (sched?.shiftName || '').toLowerCase().includes('flexible') ||
    (sched?.shiftName || '').toLowerCase().includes('flexi') ||
    (dateShiftName || '').toLowerCase().includes('flexible') ||
    sched?.latePolicyEnabled === false
  );

  let status = 'absent';
  let lateMinutes = 0;
  let isEarlyOut = false;
  let earlyOutMinutes = 0;

  const isAdminEdit = attRecord?.source === 'admin_edit';

  if (hasPunch) {
    if (isAdminEdit && attRecord?.status && ['half_day', 'on_leave', 'leave', 'absent'].includes(attRecord.status)) {
      status = attRecord.status;
    } else if (
      !isFlexibleShift &&
      !isWeekend &&
      sched &&
      sched.latePolicyEnabled !== false &&
      cleanIn !== '-' &&
      sched.startTime &&
      sched.startTime !== '--:--'
    ) {
      const [inH, inM] = normalizeTimeStr(cleanIn).split(':').map(Number);
      const [sH, sM] = normalizeTimeStr(sched.startTime).split(':').map(Number);
      const inMins = (inH || 0) * 60 + (inM || 0);
      const startMins = (sH || 0) * 60 + (sM || 0);
      const graceAllowed = Number(sched.graceTime ?? 0);
      const shiftLimit = startMins + graceAllowed;

      // Handle overnight shift where start time is evening (e.g. 22:00) and check-in is after midnight (00:15)
      let adjustedInMins = inMins;
      if (sched.isOvernight && startMins >= 18 * 60 && inMins <= 6 * 60) {
        adjustedInMins += 24 * 60;
      }

      if (adjustedInMins > shiftLimit) {
        if (isAdminEdit && attRecord?.status === 'present') {
          status = 'present';
          lateMinutes = 0;
        } else {
          status = 'late';
          lateMinutes = Math.max(1, adjustedInMins - startMins);
        }
      } else {
        // Employee punched in on or before shift start + grace time -> strictly Present (On Time)
        status = 'present';
        lateMinutes = 0;
      }
    } else {
      status = 'present';
      lateMinutes = 0;
    }

    // Evaluate Early Out against the date's effective schedule endTime
    if (
      !isFlexibleShift &&
      !isWeekend &&
      sched &&
      sched.earlyOutPolicyEnabled !== false &&
      cleanIn !== '-' &&
      cleanOut !== '-' &&
      sched.endTime &&
      sched.endTime !== '--:--'
    ) {
      const [inH, inM] = normalizeTimeStr(cleanIn).split(':').map(Number);
      const [outH, outM] = normalizeTimeStr(cleanOut).split(':').map(Number);
      const [sH, sM] = normalizeTimeStr(sched.startTime && sched.startTime !== '--:--' ? sched.startTime : '09:00').split(':').map(Number);
      const [eH, eM] = (sched.endTime === '00:00' ? [24, 0] : normalizeTimeStr(sched.endTime).split(':').map(Number));

      const inMins = (inH || 0) * 60 + (inM || 0);
      let outMins = (outH || 0) * 60 + (outM || 0);
      const sMins = (sH || 0) * 60 + (sM || 0);
      let eMins = (eH || 0) * 60 + (eM || 0);

      const isOvernight = Boolean(sched.isOvernight || isEveningOrOvernight(sched));
      if (isOvernight && eMins <= sMins) {
        eMins += 24 * 60;
      }
      if (outMins <= inMins && (isOvernight || (inMins >= 10 * 60 && outMins <= 8 * 60))) {
        outMins += 24 * 60;
      }

      const tolerance = Number(sched.earlyOutTolerance ?? 0);
      if (outMins < eMins - tolerance) {
        isEarlyOut = true;
        earlyOutMinutes = Math.max(1, eMins - outMins);
      }
    }
  } else {
    // No punch
    if (attRecord?.status && ['on_leave', 'leave', 'half_day'].includes(attRecord.status)) {
      status = attRecord.status;
    } else if (isAdminEdit && attRecord?.status === 'present') {
      status = 'present';
    } else if (isWeekend) {
      status = 'weekend_off';
    } else {
      status = 'absent';
    }
  }

  return {
    status,
    lateMinutes,
    isEarlyOut,
    earlyOutMinutes,
    isFlexibleShift,
  };
}


