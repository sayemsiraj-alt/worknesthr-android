// Shared colorful theme definitions for Department and Shift modules
import type { Department, Shift } from '../context/DataContext';

export type ThemeColorKey =
  | 'indigo'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'purple'
  | 'cyan'
  | 'blue'
  | 'orange'
  | 'teal'
  | 'fuchsia';

export interface ThemeConfig {
  key: ThemeColorKey;
  label: string;
  dotColor: string; // for color picker swatch
  gradient: string; // avatar & icon gradient
  shadow: string; // avatar drop shadow
  bgCard: string; // card background gradient
  accentBar: string; // top accent line
  borderColor: string; // card border
  borderHover: string;
  textTitle: string; // title / high contrast
  textAccent: string; // subtitle / accent text
  badgeBg: string; // status pill bg
  badgeText: string; // status pill text
  badgeBorder: string;
  statBoxBg: string; // stat boxes inside shifts/depts
  statBoxBorder: string;
  statBoxLabel: string;
  statBoxValue: string;
  ringColor: string;
}

export const THEME_PALETTES: Record<ThemeColorKey, ThemeConfig> = {
  indigo: {
    key: 'indigo',
    label: 'Indigo Violet',
    dotColor: '#6366f1',
    gradient: 'from-indigo-600 via-indigo-500 to-violet-600',
    shadow: 'shadow-indigo-500/25',
    bgCard: 'bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/30',
    accentBar: 'bg-gradient-to-r from-indigo-500 to-violet-600',
    borderColor: 'border-indigo-200/80',
    borderHover: 'hover:border-indigo-400 hover:shadow-indigo-500/10',
    textTitle: 'text-indigo-950',
    textAccent: 'text-indigo-600',
    badgeBg: 'bg-indigo-50',
    badgeText: 'text-indigo-700',
    badgeBorder: 'border-indigo-200/70',
    statBoxBg: 'bg-indigo-50/50',
    statBoxBorder: 'border-indigo-100',
    statBoxLabel: 'text-indigo-900/70',
    statBoxValue: 'text-indigo-950',
    ringColor: 'ring-indigo-400',
  },
  emerald: {
    key: 'emerald',
    label: 'Emerald Green',
    dotColor: '#10b981',
    gradient: 'from-emerald-600 via-emerald-500 to-teal-600',
    shadow: 'shadow-emerald-500/25',
    bgCard: 'bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/30',
    accentBar: 'bg-gradient-to-r from-emerald-500 to-teal-600',
    borderColor: 'border-emerald-200/80',
    borderHover: 'hover:border-emerald-400 hover:shadow-emerald-500/10',
    textTitle: 'text-emerald-950',
    textAccent: 'text-emerald-600',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    badgeBorder: 'border-emerald-200/70',
    statBoxBg: 'bg-emerald-50/50',
    statBoxBorder: 'border-emerald-100',
    statBoxLabel: 'text-emerald-900/70',
    statBoxValue: 'text-emerald-950',
    ringColor: 'ring-emerald-400',
  },
  amber: {
    key: 'amber',
    label: 'Amber Gold',
    dotColor: '#f59e0b',
    gradient: 'from-amber-500 via-amber-600 to-orange-600',
    shadow: 'shadow-amber-500/25',
    bgCard: 'bg-gradient-to-br from-amber-50/70 via-white to-orange-50/30',
    accentBar: 'bg-gradient-to-r from-amber-400 to-orange-500',
    borderColor: 'border-amber-200/80',
    borderHover: 'hover:border-amber-400 hover:shadow-amber-500/10',
    textTitle: 'text-amber-950',
    textAccent: 'text-amber-700',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-800',
    badgeBorder: 'border-amber-200/70',
    statBoxBg: 'bg-amber-50/50',
    statBoxBorder: 'border-amber-100',
    statBoxLabel: 'text-amber-950/70',
    statBoxValue: 'text-amber-950',
    ringColor: 'ring-amber-400',
  },
  rose: {
    key: 'rose',
    label: 'Rose Coral',
    dotColor: '#f43f5e',
    gradient: 'from-rose-500 via-rose-600 to-pink-600',
    shadow: 'shadow-rose-500/25',
    bgCard: 'bg-gradient-to-br from-rose-50/70 via-white to-pink-50/30',
    accentBar: 'bg-gradient-to-r from-rose-500 to-pink-500',
    borderColor: 'border-rose-200/80',
    borderHover: 'hover:border-rose-400 hover:shadow-rose-500/10',
    textTitle: 'text-rose-950',
    textAccent: 'text-rose-600',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-700',
    badgeBorder: 'border-rose-200/70',
    statBoxBg: 'bg-rose-50/50',
    statBoxBorder: 'border-rose-100',
    statBoxLabel: 'text-rose-950/70',
    statBoxValue: 'text-rose-950',
    ringColor: 'ring-rose-400',
  },
  purple: {
    key: 'purple',
    label: 'Royal Purple',
    dotColor: '#a855f7',
    gradient: 'from-purple-600 via-purple-500 to-fuchsia-600',
    shadow: 'shadow-purple-500/25',
    bgCard: 'bg-gradient-to-br from-purple-50/70 via-white to-fuchsia-50/30',
    accentBar: 'bg-gradient-to-r from-purple-500 to-fuchsia-500',
    borderColor: 'border-purple-200/80',
    borderHover: 'hover:border-purple-400 hover:shadow-purple-500/10',
    textTitle: 'text-purple-950',
    textAccent: 'text-purple-600',
    badgeBg: 'bg-purple-50',
    badgeText: 'text-purple-700',
    badgeBorder: 'border-purple-200/70',
    statBoxBg: 'bg-purple-50/50',
    statBoxBorder: 'border-purple-100',
    statBoxLabel: 'text-purple-950/70',
    statBoxValue: 'text-purple-950',
    ringColor: 'ring-purple-400',
  },
  cyan: {
    key: 'cyan',
    label: 'Cyan Ocean',
    dotColor: '#06b6d4',
    gradient: 'from-cyan-500 via-teal-500 to-blue-600',
    shadow: 'shadow-cyan-500/25',
    bgCard: 'bg-gradient-to-br from-cyan-50/70 via-white to-blue-50/30',
    accentBar: 'bg-gradient-to-r from-cyan-400 to-blue-500',
    borderColor: 'border-cyan-200/80',
    borderHover: 'hover:border-cyan-400 hover:shadow-cyan-500/10',
    textTitle: 'text-cyan-950',
    textAccent: 'text-cyan-700',
    badgeBg: 'bg-cyan-50',
    badgeText: 'text-cyan-800',
    badgeBorder: 'border-cyan-200/70',
    statBoxBg: 'bg-cyan-50/50',
    statBoxBorder: 'border-cyan-100',
    statBoxLabel: 'text-cyan-950/70',
    statBoxValue: 'text-cyan-950',
    ringColor: 'ring-cyan-400',
  },
  blue: {
    key: 'blue',
    label: 'Sky Blue',
    dotColor: '#3b82f6',
    gradient: 'from-blue-600 via-sky-500 to-indigo-600',
    shadow: 'shadow-blue-500/25',
    bgCard: 'bg-gradient-to-br from-blue-50/70 via-white to-sky-50/30',
    accentBar: 'bg-gradient-to-r from-sky-400 to-blue-600',
    borderColor: 'border-blue-200/80',
    borderHover: 'hover:border-blue-400 hover:shadow-blue-500/10',
    textTitle: 'text-blue-950',
    textAccent: 'text-blue-600',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    badgeBorder: 'border-blue-200/70',
    statBoxBg: 'bg-blue-50/50',
    statBoxBorder: 'border-blue-100',
    statBoxLabel: 'text-blue-950/70',
    statBoxValue: 'text-blue-950',
    ringColor: 'ring-blue-400',
  },
  orange: {
    key: 'orange',
    label: 'Tangerine Orange',
    dotColor: '#f97316',
    gradient: 'from-orange-500 via-amber-500 to-red-500',
    shadow: 'shadow-orange-500/25',
    bgCard: 'bg-gradient-to-br from-orange-50/70 via-white to-amber-50/30',
    accentBar: 'bg-gradient-to-r from-orange-400 to-red-500',
    borderColor: 'border-orange-200/80',
    borderHover: 'hover:border-orange-400 hover:shadow-orange-500/10',
    textTitle: 'text-orange-950',
    textAccent: 'text-orange-700',
    badgeBg: 'bg-orange-50',
    badgeText: 'text-orange-800',
    badgeBorder: 'border-orange-200/70',
    statBoxBg: 'bg-orange-50/50',
    statBoxBorder: 'border-orange-100',
    statBoxLabel: 'text-orange-950/70',
    statBoxValue: 'text-orange-950',
    ringColor: 'ring-orange-400',
  },
  teal: {
    key: 'teal',
    label: 'Mint Teal',
    dotColor: '#14b8a6',
    gradient: 'from-teal-500 via-emerald-500 to-cyan-600',
    shadow: 'shadow-teal-500/25',
    bgCard: 'bg-gradient-to-br from-teal-50/70 via-white to-emerald-50/30',
    accentBar: 'bg-gradient-to-r from-teal-400 to-emerald-500',
    borderColor: 'border-teal-200/80',
    borderHover: 'hover:border-teal-400 hover:shadow-teal-500/10',
    textTitle: 'text-teal-950',
    textAccent: 'text-teal-700',
    badgeBg: 'bg-teal-50',
    badgeText: 'text-teal-800',
    badgeBorder: 'border-teal-200/70',
    statBoxBg: 'bg-teal-50/50',
    statBoxBorder: 'border-teal-100',
    statBoxLabel: 'text-teal-950/70',
    statBoxValue: 'text-teal-950',
    ringColor: 'ring-teal-400',
  },
  fuchsia: {
    key: 'fuchsia',
    label: 'Berry Fuchsia',
    dotColor: '#d946ef',
    gradient: 'from-fuchsia-600 via-pink-500 to-rose-600',
    shadow: 'shadow-fuchsia-500/25',
    bgCard: 'bg-gradient-to-br from-fuchsia-50/70 via-white to-pink-50/30',
    accentBar: 'bg-gradient-to-r from-fuchsia-500 to-pink-500',
    borderColor: 'border-fuchsia-200/80',
    borderHover: 'hover:border-fuchsia-400 hover:shadow-fuchsia-500/10',
    textTitle: 'text-fuchsia-950',
    textAccent: 'text-fuchsia-600',
    badgeBg: 'bg-fuchsia-50',
    badgeText: 'text-fuchsia-800',
    badgeBorder: 'border-fuchsia-200/70',
    statBoxBg: 'bg-fuchsia-50/50',
    statBoxBorder: 'border-fuchsia-100',
    statBoxLabel: 'text-fuchsia-950/70',
    statBoxValue: 'text-fuchsia-950',
    ringColor: 'ring-fuchsia-400',
  },
};

export const COLOR_KEYS = Object.keys(THEME_PALETTES) as ThemeColorKey[];

export const SHIFT_ICONS = [
  { icon: '☀️', label: 'Day / Sun' },
  { icon: '🌅', label: 'Morning / Dawn' },
  { icon: '🌇', label: 'Evening / Sunset' },
  { icon: '🌙', label: 'Night / Moon' },
  { icon: '⏰', label: 'Standard Clock' },
  { icon: '⚡', label: 'Fast / Overtime' },
  { icon: '☕', label: 'Coffee / Early' },
  { icon: '💼', label: 'Office / Core' },
  { icon: '🕒', label: 'Flexible' },
  { icon: '✨', label: 'Special / VIP' },
];

export const DEPARTMENT_ICONS = [
  { icon: '🏢', label: 'Corporate Office' },
  { icon: '📝', label: 'Content / Creative' },
  { icon: '🚀', label: 'Marketing / Growth' },
  { icon: '👥', label: 'HR / People' },
  { icon: '🚚', label: 'Logistics / Courier' },
  { icon: '📦', label: 'Packaging / Warehouse' },
  { icon: '📞', label: 'Support / Call Center' },
  { icon: '💼', label: 'Sales / Commerce' },
  { icon: '💻', label: 'Engineering / IT' },
  { icon: '💰', label: 'Finance / Accounts' },
];

/**
 * Returns a rich colorful theme for a Department.
 * If the department already has a color assigned, it uses it.
 * Otherwise, it uses keyword matching or deterministic hashing based on name/index.
 */
export function getDepartmentTheme(dept: Partial<Department>, index: number = 0): ThemeConfig {
  if (dept.color && dept.color in THEME_PALETTES) {
    return THEME_PALETTES[dept.color as ThemeColorKey];
  }

  const name = (dept.name || '').toLowerCase();
  const code = (dept.code || '').toLowerCase();

  // Smart keyword matching for the user's specific departments shown in screenshot:
  if (name.includes('content') || code === 'cd') return THEME_PALETTES.indigo;
  if (name.includes('digital') || name.includes('market') || code === 'dm') return THEME_PALETTES.fuchsia;
  if (name.includes('hr') || name.includes('admin') || code === 'hrd') return THEME_PALETTES.emerald;
  if (name.includes('logest') || name.includes('curior') || name.includes('courier') || code === 'lc') return THEME_PALETTES.amber;
  if (name.includes('pack') || code === 'pkg') return THEME_PALETTES.cyan;
  if (name.includes('call') || name.includes('support') || code === 'rdnt') return THEME_PALETTES.rose;
  if (name.includes('sale') || code === 'se') return THEME_PALETTES.blue;
  if (name.includes('tech') || name.includes('eng') || name.includes('it')) return THEME_PALETTES.purple;
  if (name.includes('finance') || name.includes('account')) return THEME_PALETTES.teal;
  if (name.includes('operat') || name.includes('supply')) return THEME_PALETTES.orange;

  // Fallback to cycling through the vibrant palette
  const key = COLOR_KEYS[Math.abs(index) % COLOR_KEYS.length];
  return THEME_PALETTES[key];
}

/**
 * Returns a rich colorful theme and icon for a Shift.
 */
export function getShiftTheme(shift: Partial<Shift>, index: number = 0): { theme: ThemeConfig; icon: string } {
  const name = (shift.name || '').toLowerCase();

  let matchedIcon = shift.icon || '';
  let themeKey: ThemeColorKey | null = null;

  if (shift.color && shift.color in THEME_PALETTES) {
    themeKey = shift.color as ThemeColorKey;
  }

  // Keyword matching for Shifts shown in screenshot:
  if (!themeKey) {
    if (name.includes('day') || name.includes('shakal') || name.includes('dupur')) {
      themeKey = 'amber';
      if (!matchedIcon) matchedIcon = '☀️';
    } else if (name.includes('morning') || name.includes('bhor') || name.includes('dawn')) {
      themeKey = 'emerald';
      if (!matchedIcon) matchedIcon = '🌅';
    } else if (name.includes('evening') || name.includes('bikal') || name.includes('sunset')) {
      themeKey = 'rose';
      if (!matchedIcon) matchedIcon = '🌇';
    } else if (name.includes('night') || name.includes('rat') || name.includes('moon')) {
      themeKey = 'indigo';
      if (!matchedIcon) matchedIcon = '🌙';
    } else if (name.includes('overtime') || name.includes('ot') || name.includes('extra')) {
      themeKey = 'purple';
      if (!matchedIcon) matchedIcon = '⚡';
    } else {
      // Rotate by index
      themeKey = COLOR_KEYS[Math.abs(index) % COLOR_KEYS.length];
    }
  }

  if (!matchedIcon) {
    if (themeKey === 'amber') matchedIcon = '☀️';
    else if (themeKey === 'emerald') matchedIcon = '🌅';
    else if (themeKey === 'rose') matchedIcon = '🌇';
    else if (themeKey === 'indigo') matchedIcon = '🌙';
    else if (themeKey === 'purple') matchedIcon = '⚡';
    else if (themeKey === 'cyan') matchedIcon = '⏰';
    else if (themeKey === 'blue') matchedIcon = '💼';
    else matchedIcon = '⏱️';
  }

  return {
    theme: THEME_PALETTES[themeKey],
    icon: matchedIcon,
  };
}
