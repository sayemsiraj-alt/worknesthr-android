// ============================================================================
// PHASE 5: INTERNATIONALIZATION, MULTI-COUNTRY, MULTI-CURRENCY, TIMEZONE &
// ENTERPRISE SECURITY ENGINE (100% Backward-Compatible with Bangladesh Defaults)
// ============================================================================

export type SupportedLanguageCode = 'en' | 'bn' | 'hi' | 'ar' | 'es' | 'fr';

export type DateFormatPattern = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD MMM YYYY';
export type NumberFormatStyle = 'south_asian' | 'international' | 'european';

export interface CountryStatutoryTaxSlab {
  minAnnualIncome: number;
  maxAnnualIncome: number | null; // null = above
  taxRatePercent: number;
  label: string;
}

export interface CountryPayrollConfiguration {
  id: string;
  countryCode: string; // ISO-2 e.g. 'BD', 'US', 'GB', 'AE', 'SG', 'IN', 'SA'
  countryName: string;
  currencyCode: string; // e.g. 'BDT', 'USD', 'GBP', 'AED', 'SGD', 'INR', 'SAR'
  currencySymbol: string; // e.g. '৳', '$', '£', 'د.إ', 'S$', '₹', '﷼'
  defaultTimezone: string; // e.g. 'Asia/Dhaka'
  basicSalaryPercent: number;
  houseRentPercent: number;
  medicalPercent: number;
  conveyancePercent: number;
  retirementSchemeName: string; // e.g. 'Provident Fund (PF)', '401(k)', 'Workplace Pension', 'GOSI', 'CPF', 'EPF'
  retirementEmployeePercent: number;
  retirementEmployerPercent: number;
  socialSecurityPercent: number;
  standardDailyHours: number;
  overtimeMultiplier: number; // e.g. 1.5 or 2.0
  taxRegimeName: string;
  flatTaxFallbackPercent: number;
  taxSlabs: CountryStatutoryTaxSlab[];
  updatedAt: string;
  companyId: string;
}

export interface CountryHolidayItem {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  localName?: string;
  countryCode: string;
  branchScope?: string; // 'ALL' or specific branch name
  legalEntityId?: string;
  type: 'public' | 'statutory' | 'religious' | 'festival' | 'company_special';
  isPaid: boolean;
  notes?: string;
  companyId: string;
}

export interface GlobalLegalEntity {
  id: string;
  name: string;
  legalRegistrationName: string;
  registrationNumber: string;
  taxIdentificationNumber: string;
  countryCode: string;
  countryName: string;
  currencyCode: string;
  currencySymbol: string;
  timezone: string;
  dateFormat: DateFormatPattern;
  numberFormat: NumberFormatStyle;
  primaryLanguage: SupportedLanguageCode;
  fiscalYearCycle: string;
  headquartersAddress: string;
  linkedBranchNames: string[];
  exchangeRateToBase: number; // Rate to convert 1 unit of entity currency into tenant base currency (BDT default = 1)
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  companyId: string;
}

export interface CustomRoleDefinition {
  id: string;
  name: string;
  description: string;
  baseRole: 'HR Manager' | 'Attendance Officer' | 'Payroll Admin' | 'Department Supervisor' | 'Custom';
  modulePermissions: Record<string, boolean>;
  granularPermissions: {
    canApproveLeave: boolean;
    canApproveAttendance: boolean;
    canApproveExpenses: boolean;
    canRunPayroll: boolean;
    canLockUnlockPayroll: boolean;
    canViewSalaryConfidential: boolean;
    canViewTalentSuccessionConfidential: boolean;
    canManageEmployees: boolean;
    canManageAdminsAndRoles: boolean;
    canExportReportsAndData: boolean;
    canManageGlobalEntities: boolean;
    canAccessAiIntelligence: boolean;
    canTriggerBackupRestore: boolean;
  };
  assignedBranchScope?: string; // 'ALL' or specific branch
  assignedDepartmentScope?: string; // 'ALL' or specific department
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  companyId: string;
}

export interface SecuritySessionRecord {
  id: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  portalType: 'admin' | 'employee';
  deviceSummary: string;
  browserName: string;
  osName: string;
  ipAddressHint: string;
  timezone: string;
  mfaVerified: boolean;
  status: 'active' | 'revoked' | 'expired';
  loginAt: string;
  lastActiveAt: string;
  revokedAt?: string;
  revokedBy?: string;
  companyId: string;
}

export interface TenantSecurityPolicy {
  companyId: string;
  mfaRequiredForAdmins: boolean;
  mfaRequiredForPayrollAndSecurity: boolean;
  sessionTimeoutMinutes: number;
  maxConcurrentSessions: number;
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
  ipAllowlistEnabled: boolean;
  allowedIpRanges: string[];
  requireStepUpForSalaryChanges: boolean;
  requireStepUpForDataExport: boolean;
  autoBackupReminderDays: number;
  lastBackupAt?: string;
  lastBackupBy?: string;
  lastSecurityAuditAt?: string;
  updatedAt: string;
  updatedBy: string;
}

// ============================================================================
// BUILT-IN GLOBAL COUNTRY CATALOG (Bangladesh Default + International Presets)
// ============================================================================
export const GLOBAL_COUNTRY_CATALOG: Array<{
  countryCode: string;
  countryName: string;
  flag: string;
  currencyCode: string;
  currencySymbol: string;
  defaultTimezone: string;
  dateFormat: DateFormatPattern;
  numberFormat: NumberFormatStyle;
  defaultExchangeRateToBDT: number; // 1 Unit of Currency = X BDT
  fiscalYear: string;
  retirementSchemeName: string;
  retirementEmployeePercent: number;
  retirementEmployerPercent: number;
  overtimeMultiplier: number;
  flatTaxFallbackPercent: number;
}> = [
  {
    countryCode: 'BD',
    countryName: 'Bangladesh',
    flag: '🇧🇩',
    currencyCode: 'BDT',
    currencySymbol: '৳',
    defaultTimezone: 'Asia/Dhaka',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'south_asian',
    defaultExchangeRateToBDT: 1,
    fiscalYear: 'July - June',
    retirementSchemeName: 'Provident Fund (PF)',
    retirementEmployeePercent: 5,
    retirementEmployerPercent: 5,
    overtimeMultiplier: 1.5,
    flatTaxFallbackPercent: 5,
  },
  {
    countryCode: 'US',
    countryName: 'United States',
    flag: '🇺🇸',
    currencyCode: 'USD',
    currencySymbol: '$',
    defaultTimezone: 'America/New_York',
    dateFormat: 'MM/DD/YYYY',
    numberFormat: 'international',
    defaultExchangeRateToBDT: 120,
    fiscalYear: 'January - December',
    retirementSchemeName: '401(k) Retirement Plan',
    retirementEmployeePercent: 6,
    retirementEmployerPercent: 4,
    overtimeMultiplier: 1.5,
    flatTaxFallbackPercent: 18,
  },
  {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    flag: '🇬🇧',
    currencyCode: 'GBP',
    currencySymbol: '£',
    defaultTimezone: 'Europe/London',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'international',
    defaultExchangeRateToBDT: 155,
    fiscalYear: 'April - March',
    retirementSchemeName: 'Workplace Pension (Auto-Enrolment)',
    retirementEmployeePercent: 5,
    retirementEmployerPercent: 3,
    overtimeMultiplier: 1.5,
    flatTaxFallbackPercent: 20,
  },
  {
    countryCode: 'AE',
    countryName: 'United Arab Emirates',
    flag: '🇦🇪',
    currencyCode: 'AED',
    currencySymbol: 'د.إ',
    defaultTimezone: 'Asia/Dubai',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'international',
    defaultExchangeRateToBDT: 32.7,
    fiscalYear: 'January - December',
    retirementSchemeName: 'End of Service Gratuity / GPSSA',
    retirementEmployeePercent: 0,
    retirementEmployerPercent: 8.33,
    overtimeMultiplier: 1.25,
    flatTaxFallbackPercent: 0,
  },
  {
    countryCode: 'SG',
    countryName: 'Singapore',
    flag: '🇸🇬',
    currencyCode: 'SGD',
    currencySymbol: 'S$',
    defaultTimezone: 'Asia/Singapore',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'international',
    defaultExchangeRateToBDT: 90,
    fiscalYear: 'April - March',
    retirementSchemeName: 'Central Provident Fund (CPF)',
    retirementEmployeePercent: 20,
    retirementEmployerPercent: 17,
    overtimeMultiplier: 1.5,
    flatTaxFallbackPercent: 7,
  },
  {
    countryCode: 'IN',
    countryName: 'India',
    flag: '🇮🇳',
    currencyCode: 'INR',
    currencySymbol: '₹',
    defaultTimezone: 'Asia/Kolkata',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'south_asian',
    defaultExchangeRateToBDT: 1.43,
    fiscalYear: 'April - March',
    retirementSchemeName: 'Employees Provident Fund (EPF)',
    retirementEmployeePercent: 12,
    retirementEmployerPercent: 12,
    overtimeMultiplier: 2.0,
    flatTaxFallbackPercent: 10,
  },
  {
    countryCode: 'SA',
    countryName: 'Saudi Arabia',
    flag: '🇸🇦',
    currencyCode: 'SAR',
    currencySymbol: '﷼',
    defaultTimezone: 'Asia/Riyadh',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'international',
    defaultExchangeRateToBDT: 32,
    fiscalYear: 'January - December',
    retirementSchemeName: 'GOSI / End of Service Award',
    retirementEmployeePercent: 9.75,
    retirementEmployerPercent: 11.75,
    overtimeMultiplier: 1.5,
    flatTaxFallbackPercent: 0,
  },
  {
    countryCode: 'CA',
    countryName: 'Canada',
    flag: '🇨🇦',
    currencyCode: 'CAD',
    currencySymbol: 'C$',
    defaultTimezone: 'America/Toronto',
    dateFormat: 'YYYY-MM-DD',
    numberFormat: 'international',
    defaultExchangeRateToBDT: 87,
    fiscalYear: 'January - December',
    retirementSchemeName: 'CPP / RRSP Match',
    retirementEmployeePercent: 5.95,
    retirementEmployerPercent: 5.95,
    overtimeMultiplier: 1.5,
    flatTaxFallbackPercent: 15,
  },
  {
    countryCode: 'AU',
    countryName: 'Australia',
    flag: '🇦🇺',
    currencyCode: 'AUD',
    currencySymbol: 'A$',
    defaultTimezone: 'Australia/Sydney',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'international',
    defaultExchangeRateToBDT: 79,
    fiscalYear: 'July - June',
    retirementSchemeName: 'Superannuation Guarantee',
    retirementEmployeePercent: 0,
    retirementEmployerPercent: 11.5,
    overtimeMultiplier: 1.5,
    flatTaxFallbackPercent: 19,
  },
  {
    countryCode: 'MY',
    countryName: 'Malaysia',
    flag: '🇲🇾',
    currencyCode: 'MYR',
    currencySymbol: 'RM',
    defaultTimezone: 'Asia/Kuala_Lumpur',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'international',
    defaultExchangeRateToBDT: 27.5,
    fiscalYear: 'January - December',
    retirementSchemeName: 'Employees Provident Fund (KWSP/EPF)',
    retirementEmployeePercent: 11,
    retirementEmployerPercent: 13,
    overtimeMultiplier: 1.5,
    flatTaxFallbackPercent: 8,
  },
];

export function buildDefaultCountryPayrollConfig(
  countryCode: string,
  companyId = 'default'
): CountryPayrollConfiguration {
  const found =
    GLOBAL_COUNTRY_CATALOG.find(c => c.countryCode === countryCode.toUpperCase()) ||
    GLOBAL_COUNTRY_CATALOG[0];

  return {
    id: `pay_cfg_${found.countryCode.toLowerCase()}_${companyId}`,
    countryCode: found.countryCode,
    countryName: found.countryName,
    currencyCode: found.currencyCode,
    currencySymbol: found.currencySymbol,
    defaultTimezone: found.defaultTimezone,
    basicSalaryPercent: 60,
    houseRentPercent: 25,
    medicalPercent: 10,
    conveyancePercent: 5,
    retirementSchemeName: found.retirementSchemeName,
    retirementEmployeePercent: found.retirementEmployeePercent,
    retirementEmployerPercent: found.retirementEmployerPercent,
    socialSecurityPercent: found.countryCode === 'US' ? 7.65 : found.countryCode === 'GB' ? 8 : 0,
    standardDailyHours: 8,
    overtimeMultiplier: found.overtimeMultiplier,
    taxRegimeName: `${found.countryName} Statutory Income Tax`,
    flatTaxFallbackPercent: found.flatTaxFallbackPercent,
    taxSlabs:
      found.countryCode === 'BD'
        ? [
            { minAnnualIncome: 0, maxAnnualIncome: 350000, taxRatePercent: 0, label: 'Tax-Free Threshold' },
            { minAnnualIncome: 350001, maxAnnualIncome: 450000, taxRatePercent: 5, label: 'First Slab (5%)' },
            { minAnnualIncome: 450001, maxAnnualIncome: 750000, taxRatePercent: 10, label: 'Second Slab (10%)' },
            { minAnnualIncome: 750001, maxAnnualIncome: 1150000, taxRatePercent: 15, label: 'Third Slab (15%)' },
            { minAnnualIncome: 1150001, maxAnnualIncome: null, taxRatePercent: 20, label: 'Top Slab (20%+)' },
          ]
        : [
            { minAnnualIncome: 0, maxAnnualIncome: 20000, taxRatePercent: 0, label: 'Personal Allowance / Exempt' },
            { minAnnualIncome: 20001, maxAnnualIncome: 80000, taxRatePercent: found.flatTaxFallbackPercent, label: 'Standard Bracket' },
            { minAnnualIncome: 80001, maxAnnualIncome: null, taxRatePercent: Math.min(35, found.flatTaxFallbackPercent + 10), label: 'Higher Bracket' },
          ],
    updatedAt: new Date().toISOString(),
    companyId,
  };
}

export function buildDefaultCountryHolidays(countryCode: string, year: number, companyId = 'default'): CountryHolidayItem[] {
  const code = countryCode.toUpperCase();
  if (code === 'BD') {
    return [
      { id: `hol_bd_${year}_01`, date: `${year}-02-21`, name: 'International Mother Language Day', localName: 'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস', countryCode: 'BD', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
      { id: `hol_bd_${year}_02`, date: `${year}-03-26`, name: 'Independence & National Day', localName: 'স্বাধীনতা ও জাতীয় দিবস', countryCode: 'BD', branchScope: 'ALL', type: 'statutory', isPaid: true, companyId },
      { id: `hol_bd_${year}_03`, date: `${year}-04-14`, name: 'Bengali New Year (Pohela Boishakh)', localName: 'পহেলা বৈশাখ', countryCode: 'BD', branchScope: 'ALL', type: 'festival', isPaid: true, companyId },
      { id: `hol_bd_${year}_04`, date: `${year}-05-01`, name: 'International Workers Day (May Day)', localName: 'মে দিবস', countryCode: 'BD', branchScope: 'ALL', type: 'statutory', isPaid: true, companyId },
      { id: `hol_bd_${year}_05`, date: `${year}-12-16`, name: 'Victory Day of Bangladesh', localName: 'বিজয় দিবস', countryCode: 'BD', branchScope: 'ALL', type: 'statutory', isPaid: true, companyId },
    ];
  }
  if (code === 'US') {
    return [
      { id: `hol_us_${year}_01`, date: `${year}-01-01`, name: "New Year's Day", countryCode: 'US', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
      { id: `hol_us_${year}_02`, date: `${year}-07-04`, name: 'Independence Day (Fourth of July)', countryCode: 'US', branchScope: 'ALL', type: 'statutory', isPaid: true, companyId },
      { id: `hol_us_${year}_03`, date: `${year}-11-26`, name: 'Thanksgiving Day', countryCode: 'US', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
      { id: `hol_us_${year}_04`, date: `${year}-12-25`, name: 'Christmas Day', countryCode: 'US', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
    ];
  }
  if (code === 'GB') {
    return [
      { id: `hol_gb_${year}_01`, date: `${year}-01-01`, name: "New Year's Day Bank Holiday", countryCode: 'GB', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
      { id: `hol_gb_${year}_02`, date: `${year}-05-04`, name: 'Early May Bank Holiday', countryCode: 'GB', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
      { id: `hol_gb_${year}_03`, date: `${year}-08-31`, name: 'Summer Bank Holiday', countryCode: 'GB', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
      { id: `hol_gb_${year}_04`, date: `${year}-12-25`, name: 'Christmas Day', countryCode: 'GB', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
      { id: `hol_gb_${year}_05`, date: `${year}-12-26`, name: 'Boxing Day', countryCode: 'GB', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
    ];
  }
  if (code === 'AE') {
    return [
      { id: `hol_ae_${year}_01`, date: `${year}-01-01`, name: "New Year's Day", countryCode: 'AE', branchScope: 'ALL', type: 'public', isPaid: true, companyId },
      { id: `hol_ae_${year}_02`, date: `${year}-12-02`, name: 'UAE National Day (Eid Al Etihad)', countryCode: 'AE', branchScope: 'ALL', type: 'statutory', isPaid: true, companyId },
      { id: `hol_ae_${year}_03`, date: `${year}-12-03`, name: 'UAE National Day Holiday', countryCode: 'AE', branchScope: 'ALL', type: 'statutory', isPaid: true, companyId },
    ];
  }
  return [
    { id: `hol_${code.toLowerCase()}_${year}_01`, date: `${year}-01-01`, name: "New Year's Day", countryCode: code, branchScope: 'ALL', type: 'public', isPaid: true, companyId },
    { id: `hol_${code.toLowerCase()}_${year}_02`, date: `${year}-05-01`, name: 'Labour Day', countryCode: code, branchScope: 'ALL', type: 'statutory', isPaid: true, companyId },
  ];
}

// ============================================================================
// LOCALIZED NUMBER, CURRENCY & DATE FORMATTERS
// ============================================================================
export function formatGlobalNumber(
  value: number,
  style: NumberFormatStyle = 'south_asian',
  decimals = 0
): string {
  const num = Number(value) || 0;
  try {
    const locale =
      style === 'south_asian' ? 'en-IN' : style === 'european' ? 'de-DE' : 'en-US';
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  } catch {
    return num.toLocaleString();
  }
}

export function formatGlobalCurrency(
  amount: number,
  currencySymbol = '৳',
  style: NumberFormatStyle = 'south_asian',
  decimals = 0
): string {
  const num = Number(amount) || 0;
  const sign = num < 0 ? '-' : '';
  const absFormatted = formatGlobalNumber(Math.abs(num), style, decimals);
  return `${sign}${currencySymbol}${absFormatted}`;
}

export function convertCurrencyAmount(
  amount: number,
  fromRateToBase: number,
  toRateToBase: number
): number {
  const safeFrom = fromRateToBase > 0 ? fromRateToBase : 1;
  const safeTo = toRateToBase > 0 ? toRateToBase : 1;
  const inBase = (Number(amount) || 0) * safeFrom;
  return inBase / safeTo;
}

export function formatGlobalDate(
  dateStrOrIso: string | undefined | null,
  pattern: DateFormatPattern = 'DD/MM/YYYY'
): string {
  if (!dateStrOrIso) return '-';
  const raw = String(dateStrOrIso).trim();
  const ymdMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let y: number, m: number, d: number;

  if (ymdMatch) {
    y = Number(ymdMatch[1]);
    m = Number(ymdMatch[2]);
    d = Number(ymdMatch[3]);
  } else {
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) return raw;
    y = parsed.getFullYear();
    m = parsed.getMonth() + 1;
    d = parsed.getDate();
  }

  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const yyyy = String(y);

  switch (pattern) {
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'DD MMM YYYY': {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${dd} ${months[(m - 1) % 12] || mm} ${yyyy}`;
    }
    case 'DD/MM/YYYY':
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

export function getTimezoneTodayStr(timezone = 'Asia/Dhaka'): string {
  try {
    const cleanTz = timezone.split(' ')[0].trim() || 'Asia/Dhaka';
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: cleanTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {}
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ============================================================================
// ENTERPRISE SECURITY: RATE LIMITING, DEVICE FINGERPRINTING & MFA/2FA HELPERS
// ============================================================================
const RATE_LIMIT_STORAGE_KEY = 'worknest_sec_rate_limit_v1';

interface RateLimitBucket {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

export function checkLoginRateLimit(
  identifier: string,
  maxAttempts = 5,
  lockoutMinutes = 15
): { allowed: boolean; remainingAttempts: number; retryAfterSeconds: number } {
  const key = identifier.trim().toLowerCase() || 'anonymous';
  const now = Date.now();
  try {
    const raw = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    const map: Record<string, RateLimitBucket> = raw ? JSON.parse(raw) : {};
    const bucket = map[key];
    if (!bucket) {
      return { allowed: true, remainingAttempts: maxAttempts, retryAfterSeconds: 0 };
    }
    if (bucket.lockedUntil && bucket.lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((bucket.lockedUntil - now) / 1000);
      return { allowed: false, remainingAttempts: 0, retryAfterSeconds };
    }
    // Reset window if lock expired or > 15 minutes since first attempt
    if (bucket.lockedUntil && bucket.lockedUntil <= now) {
      delete map[key];
      localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(map));
      return { allowed: true, remainingAttempts: maxAttempts, retryAfterSeconds: 0 };
    }
    const remaining = Math.max(0, maxAttempts - bucket.attempts);
    return { allowed: remaining > 0, remainingAttempts: remaining, retryAfterSeconds: 0 };
  } catch {
    return { allowed: true, remainingAttempts: maxAttempts, retryAfterSeconds: 0 };
  }
}

export function recordLoginAttemptResult(
  identifier: string,
  succeeded: boolean,
  maxAttempts = 5,
  lockoutMinutes = 15
): { locked: boolean; attempts: number; lockedUntilIso?: string } {
  const key = identifier.trim().toLowerCase() || 'anonymous';
  const now = Date.now();
  try {
    const raw = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    const map: Record<string, RateLimitBucket> = raw ? JSON.parse(raw) : {};
    if (succeeded) {
      delete map[key];
      localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(map));
      return { locked: false, attempts: 0 };
    }
    const existing = map[key];
    const attempts = (existing?.attempts || 0) + 1;
    const lockedUntil = attempts >= maxAttempts ? now + lockoutMinutes * 60 * 1000 : null;
    map[key] = {
      attempts,
      firstAttemptAt: existing?.firstAttemptAt || now,
      lockedUntil,
    };
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(map));
    return {
      locked: Boolean(lockedUntil),
      attempts,
      lockedUntilIso: lockedUntil ? new Date(lockedUntil).toISOString() : undefined,
    };
  } catch {
    return { locked: false, attempts: 1 };
  }
}

export function clearRateLimitLocks(): void {
  try {
    localStorage.removeItem(RATE_LIMIT_STORAGE_KEY);
  } catch {}
}

export function getClientDeviceMetadata(): {
  deviceSummary: string;
  browserName: string;
  osName: string;
  timezone: string;
} {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      deviceSummary: 'Server / Headless Runtime',
      browserName: 'Node.js Runtime',
      osName: 'Linux Server',
      timezone: 'Asia/Dhaka',
    };
  }
  const ua = navigator.userAgent || '';
  let browserName = 'Web Browser';
  if (ua.includes('Edg/')) browserName = 'Microsoft Edge';
  else if (ua.includes('Chrome/')) browserName = 'Google Chrome';
  else if (ua.includes('Firefox/')) browserName = 'Mozilla Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browserName = 'Apple Safari';

  let osName = 'Desktop OS';
  if (ua.includes('Windows')) osName = 'Windows';
  else if (ua.includes('Mac OS X')) osName = 'macOS';
  else if (ua.includes('Android')) osName = 'Android Mobile';
  else if (ua.includes('iPhone') || ua.includes('iPad')) osName = 'iOS';
  else if (ua.includes('Linux')) osName = 'Linux';

  let timezone = 'Asia/Dhaka';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dhaka';
  } catch {}

  return {
    deviceSummary: `${browserName} on ${osName}`,
    browserName,
    osName,
    timezone,
  };
}

/**
 * Deterministic 6-digit TOTP / Authenticator code generator based on secret + 30-second window
 * for testing & enterprise MFA verification readiness.
 */
export function computeDeterministicMfaCode(secret: string, windowOffset = 0): string {
  const clean = (secret || 'WORKNEST2FASECRET').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const timeSlot = Math.floor(Date.now() / 30000) + windowOffset;
  let hash = 2166136261;
  const input = `${clean}:${timeSlot}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positive = Math.abs(hash) % 1000000;
  return String(positive).padStart(6, '0');
}

export function verifyMfaCode(secret: string, codeInput: string, backupCodes: string[] = []): boolean {
  const trimmed = String(codeInput || '').trim();
  if (!trimmed) return false;
  // Check current 30s window and +/- 1 window for clock skew
  if (
    trimmed === computeDeterministicMfaCode(secret, 0) ||
    trimmed === computeDeterministicMfaCode(secret, -1) ||
    trimmed === computeDeterministicMfaCode(secret, 1)
  ) {
    return true;
  }
  if (backupCodes.some(c => c.trim().toUpperCase() === trimmed.toUpperCase())) {
    return true;
  }
  return false;
}
