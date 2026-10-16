/**
 * Utility to format time into 12-hour AM/PM format (e.g., 09:06 AM, 06:45 PM).
 * Safely preserves dashes, handles 24h times, datetime strings, and empty values.
 */
export function formatTo12Hour(timeStr?: string | null): string {
  if (!timeStr || timeStr === '-' || timeStr === '—' || timeStr === 'N/A' || timeStr === 'null' || timeStr === 'undefined') {
    return '-';
  }

  const trimmed = timeStr.trim();
  if (!trimmed || trimmed === '-' || trimmed === '--:--') return '-';

  // If already formatted with AM or PM, return as is
  if (/am|pm/i.test(trimmed)) {
    return trimmed;
  }

  // Handle UTC ISO strings (ending in Z or +/-HH:mm offset) in Asia/Dhaka timezone
  if (trimmed.includes('T') && (trimmed.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(trimmed))) {
    const dt = new Date(trimmed);
    if (!isNaN(dt.getTime())) {
      const dhaka24 = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dhaka',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(dt);
      const m = dhaka24.match(/^(\d{1,2}):(\d{2})/);
      if (m) {
        let h = parseInt(m[1], 10);
        const min = m[2];
        const p = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        if (h === 0) h = 12;
        return `${h.toString().padStart(2, '0')}:${min} ${p}`;
      }
    }
  }

  // Handle ISO string or date-time strings (e.g. "2026-09-24 14:30:00" or "2026-09-24T14:30:00")
  let cleanTime = trimmed;
  if (cleanTime.includes('T')) {
    cleanTime = cleanTime.split('T')[1];
  } else if (cleanTime.includes(' ')) {
    const parts = cleanTime.split(' ');
    const timePart = parts.find(p => p.includes(':'));
    if (timePart) cleanTime = timePart;
  }

  // Match HH:mm or HH:mm:ss
  const match = cleanTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return trimmed;

  let hour = parseInt(match[1], 10);
  const minute = match[2];

  if (isNaN(hour)) return trimmed;

  const period = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;

  const paddedHour = hour.toString().padStart(2, '0');
  return `${paddedHour}:${minute} ${period}`;
}
