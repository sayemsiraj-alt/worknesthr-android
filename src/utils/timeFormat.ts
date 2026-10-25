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

/**
 * Safely parse a Message's date from createdAt ISO string or ID timestamp.
 */
export function parseMessageDate(createdAt?: string, id?: string): Date | null {
  if (createdAt) {
    const d = new Date(createdAt);
    if (!isNaN(d.getTime())) return d;
  }
  if (id && id.startsWith('msg_')) {
    const parts = id.split('_');
    const epoch = parseInt(parts[1], 10);
    if (!isNaN(epoch) && epoch > 1500000000000) {
      const d = new Date(epoch);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/**
 * Returns YYYY-MM-DD grouping key for a message
 */
export function getMessageDateKey(msg: { createdAt?: string; id?: string; time?: string }): string {
  const d = parseMessageDate(msg.createdAt, msg.id);
  if (d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return 'unknown';
}

/**
 * Formats a date group divider header (e.g., "Today • আজকের বার্তা (25 Oct 2026)")
 */
export function formatDateGroupHeader(dateKey: string): string {
  if (!dateKey || dateKey === 'unknown') return 'Earlier Messages • পূর্ববর্তী বার্তা';
  try {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const yesterday = new Date(today.getTime() - 86400000);
    const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const formattedDate = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const weekday = dateObj.toLocaleDateString('en-GB', { weekday: 'long' });

    if (dateKey === todayKey) {
      return `Today • আজকের বার্তা (${formattedDate})`;
    }
    if (dateKey === yesterdayKey) {
      return `Yesterday • গতকালের বার্তা (${formattedDate})`;
    }
    return `${formattedDate} (${weekday})`;
  } catch {
    return dateKey;
  }
}

/**
 * Formats both Date and Time for chat message headers
 * e.g., "24 Oct 2026, 08:37 PM" or "Today, 01:38 PM"
 */
export function formatMessageDateTime(msg: { createdAt?: string; time?: string; id?: string }): {
  dateStr: string;
  timeStr: string;
  displayStr: string;
  fullTooltip: string;
  dateKey: string;
} {
  const d = parseMessageDate(msg.createdAt, msg.id);
  const timeFormatted = formatTo12Hour(msg.time) || (d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

  if (!d) {
    return {
      dateStr: '',
      timeStr: timeFormatted,
      displayStr: timeFormatted || 'Recently',
      fullTooltip: `Time: ${timeFormatted || 'N/A'}`,
      dateKey: 'unknown',
    };
  }

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateKey = `${y}-${m}-${day}`;

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today.getTime() - 86400000);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const formattedDate = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });

  let datePrefix = formattedDate;
  if (dateKey === todayKey) {
    datePrefix = 'Today';
  } else if (dateKey === yesterdayKey) {
    datePrefix = 'Yesterday';
  }

  const displayStr = timeFormatted ? `${datePrefix}, ${timeFormatted}` : datePrefix;
  const fullTooltip = `${weekday}, ${formattedDate} at ${timeFormatted || 'N/A'}`;

  return {
    dateStr: formattedDate,
    timeStr: timeFormatted,
    displayStr,
    fullTooltip,
    dateKey,
  };
}

/**
 * Formats time/date for the left sidebar thread list
 * e.g., "01:38 PM" if today, "Yesterday, 08:37 PM", or "24 Oct, 08:37 PM"
 */
export function formatMessageListTime(msg: { createdAt?: string; time?: string; id?: string }): string {
  const d = parseMessageDate(msg.createdAt, msg.id);
  const timeFormatted = formatTo12Hour(msg.time);
  if (!d) return timeFormatted;

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today.getTime() - 86400000);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const msgKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (msgKey === todayKey) {
    return timeFormatted || 'Today';
  }
  if (msgKey === yesterdayKey) {
    return `Yesterday${timeFormatted ? `, ${timeFormatted}` : ''}`;
  }
  const dateShort = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${dateShort}${timeFormatted ? `, ${timeFormatted}` : ''}`;
}
