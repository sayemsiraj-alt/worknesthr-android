import { createContext, useContext, useState, ReactNode, useEffect, useMemo } from 'react';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useTenant } from './TenantContext';
import {
  getFirebaseInstance,
  syncRecordToFirestore,
  deleteRecordFromFirestore,
  clearFirestoreAllData,
  reconfigureFirebase,
  getStoredFirebaseConfig,
  saveStoredFirebaseConfig,
  FirebaseConfigType,
  DEFAULT_FIREBASE_CONFIG
} from '../lib/firestoreService';
import {
  AdminAccount,
  AdminPermissions,
  AdminRole,
  ROLE_PERMISSION_PRESETS,
  changeAdminPassword,
  authenticateEmployeeUser,
  provisionAdminAuthAccount,
  provisionEmployeeAuthAccount,
} from '../lib/authService';
import {
  GlobalLegalEntity,
  CountryHolidayItem,
  CountryPayrollConfiguration,
  CustomRoleDefinition,
  SecuritySessionRecord,
  TenantSecurityPolicy,
  GLOBAL_COUNTRY_CATALOG,
  buildDefaultCountryPayrollConfig,
  buildDefaultCountryHolidays,
  getClientDeviceMetadata,
  checkLoginRateLimit,
  recordLoginAttemptResult,
} from '../utils/i18nAndGlobalEngine';

export type {
  AdminAccount,
  AdminPermissions,
  AdminRole,
  GlobalLegalEntity,
  CountryHolidayItem,
  CountryPayrollConfiguration,
  CustomRoleDefinition,
  SecuritySessionRecord,
  TenantSecurityPolicy,
};
export { ROLE_PERMISSION_PRESETS, GLOBAL_COUNTRY_CATALOG };

export type Notification = {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'leave' | 'attendance' | 'payroll' | 'recruitment' | 'system';
  targetPage?: string;
  forEmployeeId?: string;
};

export type Message = {
  id: string;
  from: string;
  fromAvatar: string;
  to: string;
  toEmployeeId?: string;
  fromEmployeeId?: string;
  subject: string;
  preview: string;
  content: string;
  time: string;
  unread: boolean;
  companyId?: string;
  createdAt?: string;
};

export type ShiftAssignmentRecord = {
  id: string;
  employeeId: string;
  employeeName?: string;
  shiftId?: string;
  shiftName: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD or null for 'Present'
  assignedAt?: string;
  note?: string;
  // Snapshot of shift timing & policies so future shift timing changes never alter closed historical periods
  startTime?: string;
  endTime?: string;
  graceTime?: number;
  breakTime?: number;
  totalHours?: number;
  type?: 'fixed' | 'flexible' | 'remote';
  latePolicyEnabled?: boolean;
  latePenaltyMode?: 'none' | 'mark_only' | 'salary_deduction';
  earlyOutPolicyEnabled?: boolean;
  earlyOutTolerance?: number;
  overtimePolicyEnabled?: boolean;
  minOvertimeMinutes?: number;
  maxOvertimeHours?: number;
  halfDayMinHours?: number;
};

export type Employee = {
  id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  shift: string;
  shiftHistory?: ShiftAssignmentRecord[];
  joinDate: string;
  status: 'active' | 'inactive' | 'on_leave';
  avatar: string;
  employeeId: string;
  password?: string;
  rfidCard?: string;
  basicSalary?: number;
  grossSalary?: number;
  basic?: number;
  houseRent?: number;
  medical?: number;
  transport?: number;
  food?: number;
  conveyance?: number;
  attendanceBonus?: number;
  bankName?: string;
  accountNumber?: string;
  address?: string;
  emergencyContact?: string;
  paymentBasis?: 'monthly' | 'weekly' | 'daily';
  weeklyWage?: number;
  dailyRate?: number;
  branch?: string;
  branchId?: string;
  companyId?: string;
  legalEntityId?: string;
  countryCode?: string;
  currencyCode?: string;
  currencySymbol?: string;
  timezone?: string;
  managerId?: string;
  managerName?: string;
  isManager?: boolean;
  dateOfBirth?: string;
  accessTerminated?: boolean;
  accessTerminatedAt?: string;
};

export type Branch = {
  id: string;
  name: string;
  code: string;
  type: 'head_office' | 'branch' | 'factory' | 'warehouse';
  city: string;
  address: string;
  managerName: string;
  phone: string;
  email?: string;
  status: 'active' | 'inactive';
  isHeadOffice?: boolean;
  companyId?: string;
  legalEntityId?: string;
  countryCode?: string;
  countryName?: string;
  currencyCode?: string;
  currencySymbol?: string;
  timezone?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const DEFAULT_HEAD_OFFICE_BRANCH: Branch = {
  id: 'BR-HQ',
  name: 'Main Head Office (Dhaka)',
  code: 'HQ-DHK',
  type: 'head_office',
  city: 'Dhaka',
  address: 'Dhaka, Bangladesh',
  managerName: 'Head Office Administration',
  phone: '',
  status: 'active',
  isHeadOffice: true,
};

export type Department = {
  id: string;
  name: string;
  code: string;
  head: string;
  employeeCount: number;
  description: string;
  status: 'active' | 'inactive';
  color?: string;
  icon?: string;
  companyId?: string;
};

export type Shift = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakTime: number;
  graceTime: number;
  totalHours: number;
  description: string;
  status: 'active' | 'inactive';
  color?: string;
  icon?: string;
  companyId?: string;
  // Flexible and Policies
  type?: 'fixed' | 'flexible' | 'remote';
  flexibleMinHours?: number; // minimum required working hours, e.g. 8
  flexibleCoreStart?: string; // e.g. "10:00"
  flexibleCoreEnd?: string; // e.g. "16:00"
  latePolicyEnabled?: boolean;
  latePenaltyMode?: 'none' | 'mark_only' | 'salary_deduction';
  lateGraceLimit?: number; // max minutes before marked absent/half-day
  earlyOutPolicyEnabled?: boolean;
  earlyOutTolerance?: number; // minutes before shift end allowed, e.g. 15
  earlyOutPenaltyMode?: 'none' | 'mark_only' | 'half_day';
  overtimePolicyEnabled?: boolean;
  minOvertimeMinutes?: number;
  maxOvertimeHours?: number;
  halfDayMinHours?: number;
  updatedAt?: string;
};

export type RosterEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  shift: string;
  isOffDay: boolean;
  isExtraDay: boolean;
  status?: string;
  shiftId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  customStartTime?: string;
  customEndTime?: string;
  companyId?: string;
  updatedAt?: string;
};

export type HolidayType =
  | 'government'
  | 'religious'
  | 'special_off'
  | 'festival'
  | 'executive';

export type HolidayScope = 'all' | 'departments' | 'branches' | 'custom_employees';

export type CompanyHoliday = {
  id: string;
  title: string;
  type: HolidayType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  daysCount: number;
  scope: HolidayScope;
  departments?: string[];
  branches?: string[];
  employeeIds?: string[];
  dutyEmployeeIds?: string[]; // Employees who STILL work during this holiday (exceptions)
  dutyShiftName?: string; // Shift name assigned to duty exceptions
  description?: string;
  notes?: string;
  syncToRoster: boolean;
  createdAt: string;
  updatedAt?: string;
  companyId: string;
};

export type LeaveRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  department?: string;
  type: string;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedOn?: string;
  companyId?: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentSize?: number;
  attachmentDataUrl?: string;
  adminRemarks?: string;
  reviewedBy?: string;
  reviewedAt?: string;
};

export type AttendanceRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  department?: string;
  date: string;
  type: 'late_arrival' | 'early_checkout' | 'missing_punch' | 'overtime';
  requestedTime?: string;
  actualTime?: string;
  checkInTime?: string;
  checkOutTime?: string;
  otHours?: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedOn?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewRemarks?: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentSize?: number;
  attachmentDataUrl?: string;
  companyId?: string;
};

export type WorkflowRequestType =
  | 'leave'
  | 'attendance_correction'
  | 'overtime'
  | 'expense'
  | 'other_hr';

export type WorkflowStepHistory = {
  status: 'pending' | 'approved' | 'rejected';
  actorId: string;
  actorName: string;
  actorRole: string;
  timestamp: string;
  reason: string;
};

export type WorkflowRequest = {
  id: string;
  requestType: WorkflowRequestType;
  subType?: string;
  employeeId: string;
  employeeName: string;
  department?: string;
  branch?: string;
  title: string;
  date?: string;
  fromDate?: string;
  toDate?: string;
  daysOrHours?: number;
  amountBDT?: number;
  amount?: number;
  currency?: string;
  actualTime?: string;
  requestedTime?: string;
  reason: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentSize?: number;
  attachmentDataUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  requesterId: string;
  requesterName: string;
  approverId?: string;
  approverName?: string;
  approverRole?: string;
  decisionReason?: string;
  createdAt: string;
  updatedAt?: string;
  reviewedAt?: string;
  history: WorkflowStepHistory[];
  linkedRecordId?: string;
  companyId: string;
};

export type HRDocumentCategory =
  | 'ID / NID / Passport'
  | 'Employment Contract'
  | 'Offer / Appointment Letter'
  | 'Academic / Certificate'
  | 'Medical / Fitness'
  | 'Tax / Bank Document'
  | 'Company Policy / Handbook'
  | 'Disciplinary / Warning'
  | 'Company Policy'
  | 'Offer & Contract'
  | 'National ID / Passport'
  | 'Academic & Certificate'
  | 'Medical & Insurance'
  | 'Tax & Compliance'
  | 'NOC & Letters'
  | 'Other';

export type HRDocument = {
  id: string;
  title: string;
  category: HRDocumentCategory;
  visibility: 'employee_private' | 'company_policy';
  employeeId?: string;
  employeeName?: string;
  department?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileDataUrl: string;
  expiryDate?: string;
  reminderDaysBefore?: number;
  lastReminderSentAt?: string;
  notes?: string;
  description?: string;
  uploadedBy: string;
  uploadedByRole: string;
  createdAt: string;
  updatedAt?: string;
  companyId: string;
};

export type AuditLogCategory =
  | 'security'
  | 'employee'
  | 'role_permission'
  | 'attendance'
  | 'roster_shift'
  | 'leave_workflow'
  | 'payroll'
  | 'document'
  | 'settings'
  | 'admin_settings'
  | 'performance'
  | 'expense'
  | 'onboarding_offboarding'
  | 'workforce_planning'
  | 'engagement'
  | 'learning_skills'
  | 'talent_succession'
  | 'global_i18n'
  | 'ai_intelligence';

export type AuditLogEntry = {
  id: string;
  action: string;
  category: AuditLogCategory;
  severity?: 'info' | 'warning' | 'critical';
  actorId: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  targetName: string;
  summary: string;
  deviceSummary?: string;
  ipAddressHint?: string;
  beforeValue?: any;
  afterValue?: any;
  timestamp: string;
  companyId: string;
};

export type MonthlyPayrollRun = {
  month: string; // 'YYYY-MM'
  status: 'draft' | 'generated' | 'published';
  approvalStatus?: 'draft' | 'pending_approval' | 'approved' | 'locked';
  isLocked?: boolean;
  lockedAt?: string;
  lockedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  lockedSnapshots?: Record<string, any>;
  totalGrossAmount?: number;
  totalDeductionsAmount?: number;
  totalNetAmount?: number;
  generatedAt: string;
  totalEmployees: number;
  publishedBy?: string;
  notes?: string;
  companyId?: string;
};

export type SalaryAdvanceLoan = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  type: 'advance' | 'loan';
  principalAmount: number;
  monthlyInstallment: number;
  totalInstallments: number;
  paidInstallments: number;
  remainingBalance: number;
  startMonth: string; // 'YYYY-MM'
  reason: string;
  status: 'active' | 'completed' | 'waived';
  issuedBy: string;
  createdAt: string;
  companyId: string;
};

// Phase 2: Performance Management Types
export type PerformanceCycle = {
  id: string;
  title: string;
  periodType: 'annual' | 'half_yearly' | 'quarterly' | 'probation';
  startDate: string;
  endDate: string;
  selfEvalDeadline: string;
  managerEvalDeadline: string;
  status: 'draft' | 'active' | 'closed';
  description?: string;
  createdAt: string;
  companyId: string;
};

export type PerformanceGoal = {
  id: string;
  cycleId: string;
  cycleTitle: string;
  employeeId: string;
  employeeName: string;
  department: string;
  title: string;
  category: 'KPI / Metric' | 'Project Delivery' | 'Quality & Compliance' | 'Leadership & Growth';
  targetMetric: string;
  weightage: number; // 1-100
  progress: number; // 0-100
  status: 'not_started' | 'in_progress' | 'completed' | 'at_risk';
  selfRating?: number; // 1-5
  managerRating?: number; // 1-5
  notes?: string;
  updatedAt: string;
  companyId: string;
};

export type PerformanceReviewComment = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  comment: string;
  timestamp: string;
};

export type PerformanceAppraisal = {
  id: string;
  cycleId: string;
  cycleTitle: string;
  employeeId: string;
  employeeName: string;
  department: string;
  designation: string;
  selfRating?: number;
  selfAchievements?: string;
  selfChallenges?: string;
  selfGrowthPlan?: string;
  selfSubmittedAt?: string;
  competencyRatings?: {
    technical: number;
    delivery: number;
    teamwork: number;
    ownership: number;
    punctuality: number;
  };
  managerRating?: number;
  kpiWeightedScore?: number;
  finalRating?: number;
  finalGrade?: string;
  managerFeedback?: string;
  promotionRecommended?: boolean;
  recommendedIncrementPercent?: number;
  evaluatedById?: string;
  evaluatedByName?: string;
  evaluatedAt?: string;
  status: 'pending_self' | 'pending_manager' | 'completed' | 'acknowledged';
  comments: PerformanceReviewComment[];
  updatedAt: string;
  companyId: string;
};

// Phase 2: Expense Management Types
export type ExpenseCategory =
  | 'Travel & Transport'
  | 'Client Entertainment & Meals'
  | 'Office Supplies & Equipment'
  | 'Training & Certification'
  | 'Medical & Wellness'
  | 'Internet & Utility'
  | 'Accommodation & Per Diem'
  | 'Other';

export type ExpenseClaim = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  branch?: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  expenseDate: string;
  merchant?: string;
  paymentMode?: 'Cash' | 'Personal Card' | 'bKash / Mobile Wallet' | 'Bank Transfer';
  description: string;
  receiptName?: string;
  receiptType?: string;
  receiptSize?: number;
  receiptDataUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  reimbursementStatus: 'pending_approval' | 'awaiting_reimbursement' | 'reimbursed' | 'settled_in_payroll' | 'rejected';
  reimbursedAt?: string;
  reimbursedBy?: string;
  reimbursementMethod?: 'Bank Transfer' | 'Cash' | 'bKash/Mobile Banking' | 'Added to Monthly Payroll';
  reimbursementMonth?: string;
  paymentReference?: string;
  approverId?: string;
  approverName?: string;
  approverRole?: string;
  decisionReason?: string;
  reviewedAt?: string;
  workflowRequestId?: string;
  createdAt: string;
  companyId: string;
};

// Phase 2: Onboarding Types
export type OnboardingTaskItem = {
  id: string;
  title: string;
  category: 'Required Document' | 'Joining Task' | 'HR Task' | 'Manager Task' | 'IT & Access' | 'Policy Acknowledgement';
  assignedToRole: 'Employee' | 'HR' | 'Manager' | 'IT';
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
  linkedDocumentCategory?: string;
  notes?: string;
};

export type OnboardingRecord = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  designation: string;
  branch?: string;
  joinDate: string;
  mentorName?: string;
  probationEndDate?: string;
  policyAcknowledged: boolean;
  policyAcknowledgedAt?: string;
  policySignature?: string;
  tasks: OnboardingTaskItem[];
  progress: number;
  status: 'in_progress' | 'completed';
  createdAt: string;
  updatedAt: string;
  companyId: string;
};

// Phase 2: Offboarding Types
export type OffboardingClearanceItem = {
  id: string;
  department: 'Reporting Manager' | 'IT & Systems' | 'Finance & Accounts' | 'HR & Administration';
  title: string;
  cleared: boolean;
  clearedBy?: string;
  clearedAt?: string;
  remarks?: string;
};

export type OffboardingAssetItem = {
  id: string;
  assetName: string;
  assetTag: string;
  category: 'Laptop / PC' | 'ID Card / RFID Badge' | 'Mobile / SIM' | 'Keys / Access Card' | 'Other Equipment';
  status: 'pending_return' | 'returned' | 'damaged_deduct';
  deductionAmount?: number;
  returnedAt?: string;
  verifiedBy?: string;
};

export type ExitInterviewData = {
  completed: boolean;
  completedAt?: string;
  conductedBy?: string;
  primaryReasonForLeaving: string;
  workEnvironmentRating: number;
  managementSupportRating: number;
  wouldRecommendCompany: boolean;
  keyFeedback: string;
};

export type FinalSettlementData = {
  settlementMonth: string; // 'YYYY-MM'
  unpaidSalaryDays: number;
  unpaidSalaryAmount: number;
  earnedLeaveDays: number;
  leaveEncashmentAmount: number;
  gratuityOrServiceBenefit: number;
  noticeShortfallDays: number;
  noticePayRecovery: number;
  assetDamageDeduction: number;
  loanOrAdvanceRecovery: number;
  netSettlementAmount: number;
  status: 'draft' | 'approved' | 'synced_to_payroll' | 'settled';
  syncedAt?: string;
  settledAt?: string;
  paymentReference?: string;
};

export type OffboardingRecord = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  designation: string;
  branch?: string;
  exitType: 'resignation' | 'termination' | 'retirement' | 'end_of_contract';
  reason: string;
  initiatedBy: string;
  initiatedDate: string;
  noticePeriodDaysRequired: number;
  noticePeriodDaysServed: number;
  lastWorkingDay: string;
  clearances: OffboardingClearanceItem[];
  assets: OffboardingAssetItem[];
  documentsStatus: {
    experienceCertificate: boolean;
    releaseLetter: boolean;
    nocIssued: boolean;
  };
  exitInterview: ExitInterviewData;
  finalSettlement: FinalSettlementData;
  accessTerminated: boolean;
  accessTerminatedAt?: string;
  accessTerminatedBy?: string;
  status: 'initiated' | 'in_clearance' | 'ready_for_settlement' | 'completed' | 'rejected';
  createdAt: string;
  updatedAt: string;
  companyId: string;
};

// Phase 3: Workforce Planning & Employee Movement History Types
export type WorkforcePositionPlan = {
  id: string;
  title: string;
  department: string;
  branch: string;
  approvedHeadcount: number;
  budgetedAvgSalary: number;
  priority: 'critical' | 'high' | 'standard' | 'growth';
  notes?: string;
  updatedBy?: string;
  updatedAt: string;
  companyId: string;
};

export type EmployeeMovementType =
  | 'promotion'
  | 'department_transfer'
  | 'branch_transfer'
  | 'designation_change'
  | 'salary_revision'
  | 'manager_reassignment'
  | 'new_hire'
  | 'exit';

export type EmployeeMovementRecord = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  movementType: EmployeeMovementType;
  effectiveDate: string;
  fromDepartment?: string;
  toDepartment?: string;
  fromDesignation?: string;
  toDesignation?: string;
  fromBranch?: string;
  toBranch?: string;
  fromSalary?: number;
  toSalary?: number;
  fromManagerName?: string;
  toManagerName?: string;
  reason: string;
  recordedBy: string;
  createdAt: string;
  companyId: string;
};

// Phase 3: Employee Engagement Types
export type CompanyAnnouncement = {
  id: string;
  title: string;
  content: string;
  category: 'General' | 'Policy Update' | 'Holiday / Event' | 'HR Notice' | 'Celebration' | 'Urgent Alert';
  priority: 'normal' | 'important' | 'urgent';
  targetDepartment: string; // 'All' or department name
  targetBranch: string; // 'All' or branch name
  isPinned?: boolean;
  authorName: string;
  authorRole: string;
  acknowledgedBy: string[]; // employeeIds
  createdAt: string;
  companyId: string;
};

export type RecognitionBadgeType =
  | 'Star Performer'
  | 'Team Player'
  | 'Innovation Champion'
  | 'Customer Hero'
  | 'Leadership Excellence'
  | 'Punctuality Star'
  | 'Work Anniversary'
  | 'Birthday Wish';

export type EmployeeRecognition = {
  id: string;
  recipientEmployeeId: string;
  recipientName: string;
  recipientDepartment: string;
  recipientDesignation?: string;
  badge: RecognitionBadgeType;
  message: string;
  coreValue?: string;
  awardedById: string;
  awardedByName: string;
  awardedByRole: string;
  likes: string[];
  createdAt: string;
  companyId: string;
};

export type EmployeeFeedbackItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  category: 'Suggestion' | 'Workplace Improvement' | 'Management & Culture' | 'Wellbeing & Benefits' | 'Grievance / Concern' | 'Appreciation';
  subject: string;
  message: string;
  isAnonymous: boolean;
  visibility: 'hr_only' | 'management';
  status: 'submitted' | 'under_review' | 'actioned' | 'closed';
  adminResponse?: string;
  respondedBy?: string;
  respondedAt?: string;
  createdAt: string;
  companyId: string;
};

export type PulseSurveyQuestion = {
  id: string;
  questionText: string;
  type: 'rating_1_5' | 'yes_no' | 'multiple_choice' | 'open_text';
  options?: string[];
};

export type PulseSurveyResponse = {
  id: string;
  employeeId: string;
  employeeName?: string;
  department?: string;
  isAnonymous?: boolean;
  answers: Record<string, string | number>;
  submittedAt: string;
};

export type PulseSurvey = {
  id: string;
  title: string;
  description: string;
  targetDepartment: string; // 'All' or department
  targetBranch: string; // 'All' or branch
  isAnonymous: boolean;
  status: 'active' | 'closed';
  expiresAt?: string;
  questions: PulseSurveyQuestion[];
  responses: PulseSurveyResponse[];
  createdBy: string;
  createdAt: string;
  companyId: string;
};

// ============================================================================
// PHASE 4: LEARNING & DEVELOPMENT, SKILLS, CAREER, TALENT & SUCCESSION TYPES
// ============================================================================

export type TrainingCourseCategory =
  | 'Technical & Engineering'
  | 'Leadership & Management'
  | 'Compliance & Safety'
  | 'Soft Skills & Communication'
  | 'Operations & Quality'
  | 'Onboarding & Product';

export type TrainingCourseFormat =
  | 'Instructor-Led (Classroom)'
  | 'Virtual Live Webinar'
  | 'Self-Paced E-Learning'
  | 'External Workshop / Certification';

export type TrainingCourse = {
  id: string;
  code: string;
  title: string;
  category: TrainingCourseCategory;
  format: TrainingCourseFormat;
  instructor: string;
  provider: string;
  durationHours: number;
  costPerEmployee: number;
  targetDepartment: string; // 'All' or specific department
  targetSkills: string[];
  scheduledStartDate: string;
  scheduledEndDate: string;
  locationOrLink: string;
  maxSeats: number;
  status: 'upcoming' | 'ongoing' | 'completed' | 'archived';
  description: string;
  createdBy: string;
  createdAt: string;
  companyId: string;
};

export type TrainingEnrollment = {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  courseCategory: TrainingCourseCategory;
  durationHours: number;
  trainingCost: number;
  employeeId: string;
  employeeName: string;
  department: string;
  designation: string;
  enrolledBy: string;
  enrolledAt: string;
  status: 'enrolled' | 'in_progress' | 'completed' | 'dropped';
  attendancePercent: number;
  progressPercent: number;
  assessmentScore?: number; // 0-100
  completedAt?: string;
  certificateIssued: boolean;
  certificateNumber?: string;
  certificateIssuedAt?: string;
  certificateExpiryDate?: string;
  linkedHrDocumentId?: string;
  effectivenessRating?: number; // 1-5 learner feedback
  effectivenessFeedback?: string;
  managerEffectivenessScore?: number; // 1-5 post-training job impact
  companyId: string;
};

export type SkillCategory =
  | 'Technical'
  | 'Domain / Functional'
  | 'Leadership'
  | 'Tools & Systems'
  | 'Language & Communication'
  | 'Compliance';

export type EmployeeSkillRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  designation: string;
  skillName: string;
  category: SkillCategory;
  proficiencyLevel: number; // 1 (Novice) to 5 (Expert)
  selfAssessedLevel: number;
  managerVerifiedLevel?: number;
  verifiedBy?: string;
  verifiedAt?: string;
  yearsExperience?: number;
  isCertified: boolean;
  certificationName?: string;
  certificationIssuer?: string;
  certificationIssueDate?: string;
  certificationExpiryDate?: string;
  lastReminderSentAt?: string;
  linkedHrDocumentId?: string;
  updatedAt: string;
  companyId: string;
};

export type PositionRequiredSkillItem = {
  skillName: string;
  category: SkillCategory;
  requiredLevel: number; // 1 to 5
  isMandatory: boolean;
};

export type PositionSkillRequirement = {
  id: string;
  designation: string;
  department: string;
  requiredSkills: PositionRequiredSkillItem[];
  updatedBy: string;
  updatedAt: string;
  companyId: string;
};

export type CareerPathStep = {
  levelOrder: number;
  designation: string;
  minTenureMonths: number;
  minPerformanceScore: number; // e.g. 3.5
  requiredSkills: string[];
  typicalSalaryBand?: string;
};

export type CareerPathway = {
  id: string;
  trackName: string;
  department: string;
  steps: CareerPathStep[];
  updatedBy: string;
  updatedAt: string;
  companyId: string;
};

export type CareerDevelopmentAction = {
  id: string;
  title: string;
  type: 'Training' | 'Project / Stretch Assignment' | 'Mentorship' | 'Certification';
  status: 'pending' | 'in_progress' | 'completed';
  linkedCourseId?: string;
  targetDate?: string;
};

export type CareerDevelopmentPlan = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  currentDesignation: string;
  targetDesignation: string;
  targetTimeline: '6 Months' | '1 Year' | '2 Years' | '3+ Years';
  readinessStatus: 'ready_now' | 'ready_6_12_months' | 'developing' | 'exploring';
  careerGoals: string;
  developmentActions: CareerDevelopmentAction[];
  recommendedCourseIds: string[];
  mentorName?: string;
  managerConfidentialNotes?: string; // Confidential: stripped for employee session
  updatedBy: string;
  updatedAt: string;
  companyId: string;
};

export type TalentProfile = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  designation: string;
  branch?: string;
  performanceScore: number; // 1-5
  potentialLevel: 'low' | 'moderate' | 'high';
  nineBoxCategory: string;
  isHighPotential: boolean;
  isCriticalTalent: boolean;
  retentionRisk: 'low' | 'medium' | 'high'; // Confidential
  mobility: 'local_only' | 'branch_relocatable' | 'global';
  competencyScores: {
    leadership: number;
    strategicThinking: number;
    execution: number;
    collaboration: number;
    adaptability: number;
    technicalMastery: number;
  };
  confidentialAssessmentNotes?: string; // Confidential
  shareWithEmployee: boolean;
  assessedBy: string;
  updatedAt: string;
  companyId: string;
};

export type SuccessorCandidateEntry = {
  employeeId: string;
  employeeName: string;
  currentDesignation: string;
  department: string;
  readinessLevel: 'ready_now' | 'ready_1_2_years' | 'ready_3_plus_years' | 'emergency_backup';
  performanceRating: number;
  skillMatchPercent: number;
  developmentRequirements: string;
  addedBy: string;
  addedAt: string;
};

export type SuccessionHistoryLog = {
  id: string;
  action: string;
  actorName: string;
  timestamp: string;
  details: string;
};

export type SuccessionPlan = {
  id: string;
  positionTitle: string;
  department: string;
  branch: string;
  incumbentEmployeeId?: string;
  incumbentName?: string;
  criticality: 'mission_critical' | 'high_impact' | 'specialized';
  vacancyRisk: 'low' | 'medium' | 'high';
  targetFillTimeframe: 'Immediate' | '3-6 Months' | '6-12 Months' | '1-2 Years';
  successors: SuccessorCandidateEntry[];
  history: SuccessionHistoryLog[];
  confidentialNotes?: string;
  updatedBy: string;
  updatedAt: string;
  companyId: string;
};

export type CandidateStage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';

export type Candidate = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  jobId?: string;
  jobTitle: string;
  department?: string;
  stage: CandidateStage;
  appliedDate: string;
  interviewDate?: string;
  expectedSalary?: number;
  rating?: number;
  experience?: string;
  notes?: string;
  resumeUrl?: string;
  companyId?: string;
};

export type RecruitmentJob = {
  id: string;
  title: string;
  department: string;
  vacancies: number;
  type: string;
  experience: string;
  status: 'open' | 'closed';
  postedDate: string;
  applicantsCount: number;
  companyId?: string;
};

export type BiometricDevice = {
  id: string;
  name: string;
  model: string;
  deviceType?: string;
  type?: string;
  serialNumber: string;
  serial?: string;
  deviceId?: string;
  ipAddress?: string;
  ip?: string;
  port: number | string;
  connectionType: 'adms' | 'tcp' | 'standalone';
  status: 'connected' | 'online' | 'offline' | 'untested' | 'error';
  enabled: boolean;
  biometricEnabled?: boolean;
  faceRecognition?: boolean;
  rfidEnabled?: boolean;
  autoSync?: boolean;
  location?: string;
  branch?: string;
  branchId?: string;
  notes?: string;
  lastSeen?: string | null;
  lastSync?: string | null;
  connectedAt?: string | null;
  syncedAt?: string | null;
  lastTested?: string | null;
  testLatency?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export function normalizeBiometricDevice(data: any): BiometricDevice {
  const serial = data.serialNumber || data.serial || '';
  const ip = data.ipAddress || data.ip || '';
  const model = data.model || data.type || 'ZKTeco SenseFace 2A';
  const connectionType = data.connectionType || (String(data.port) === '4370' ? 'tcp' : 'adms');

  return {
    id: data.id || `dev_${serial || Date.now()}`,
    name: data.name || 'ZKTeco Terminal',
    model,
    deviceType: data.deviceType || (data.faceRecognition ? 'facial' : data.biometricEnabled ? 'fingerprint' : 'hybrid'),
    type: data.type || model,
    serialNumber: serial,
    serial,
    deviceId: data.deviceId || '1',
    ipAddress: ip,
    ip,
    port: data.port || (connectionType === 'tcp' ? 4370 : 443),
    connectionType,
    status: data.status || 'untested',
    enabled: data.enabled !== false,
    biometricEnabled: data.biometricEnabled ?? true,
    faceRecognition: data.faceRecognition ?? (model.toLowerCase().includes('face') || model.toLowerCase().includes('sense')),
    rfidEnabled: data.rfidEnabled ?? false,
    autoSync: data.autoSync ?? true,
    location: data.location || '',
    branch: data.branch || data.branchName || '',
    branchId: data.branchId || '',
    notes: data.notes || '',
    lastSeen: data.lastSeen || data.connectedAt || null,
    lastSync: data.lastSync || data.syncedAt || null,
    connectedAt: data.connectedAt || null,
    syncedAt: data.syncedAt || null,
    lastTested: data.lastTested || null,
    testLatency: data.testLatency || null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

type DataContextType = {
  // Auth - Admin
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  currentUser: { name: string; email: string; role: string; avatar: string; username?: string; password?: string; id?: string; permissions?: AdminPermissions } | null;
  updateAdminProfile: (data: { name: string; email: string; username?: string; password?: string; avatar?: string }) => Promise<void>;
  resetAllData: () => Promise<void>;

  // Admin Accounts & Role Permissions
  adminAccounts: AdminAccount[];
  addAdminAccount: (acc: Omit<AdminAccount, 'id' | 'createdAt'>) => Promise<string>;
  updateAdminAccount: (id: string, updates: Partial<AdminAccount>) => Promise<void>;
  deleteAdminAccount: (id: string) => Promise<void>;

  // Auth - Employee
  isEmployeeAuthenticated: boolean;
  loginEmployee: (employeeId: string, password: string) => Promise<boolean>;
  logoutEmployee: () => void;
  currentEmployee: Employee | null;
  updateEmployeeCredentials: (id: string, data: { password?: string; email?: string; phone?: string }) => void;

  // Attendance records (with photos)
  getEmployeeAttendance: (employeeId: string) => any[];

  // Firestore Live State
  firebaseConnected: boolean;
  firebaseSyncing: boolean;
  lastSyncTime: Date | null;
  liveSyncEnabled: boolean;
  activeFirebaseConfig: FirebaseConfigType;
  connectFirebase: (config?: FirebaseConfigType) => Promise<boolean>;
  disconnectFirebase: () => void;
  manualSync: () => Promise<boolean>;
  toggleLiveSync: () => void;
  unmarkDataWiped: () => void;

  // Notifications
  notifications: Notification[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  addNotification: (n: Omit<Notification, 'id' | 'time'>) => void;

  // Messages
  messages: Message[];
  unreadMessageCount: number;
  markMessageRead: (id: string) => void;
  sendMessage: (toOrMsg: string | Partial<Message>, subject?: string, content?: string) => void;
  deleteMessage: (id: string) => void;

  // Employees - Purely User Driven
  employees: Employee[];
  allEmployees: Employee[];
  addEmployee: (e: Omit<Employee, 'id'>) => Promise<void>;
  updateEmployee: (id: string, e: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;

  // Branches (Head Office + Multiple Branch Offices)
  branches: Branch[];
  activeBranch: string; // 'ALL' or specific branch name
  setActiveBranch: (branchName: string) => void;
  addBranch: (b: Omit<Branch, 'id'>) => Promise<Branch>;
  updateBranch: (id: string, b: Partial<Branch>) => Promise<void>;
  deleteBranch: (id: string) => Promise<void>;
  getEmployeeBranch: (emp: Partial<Employee> | null | undefined) => string;
  getDeviceBranch: (dev: Partial<BiometricDevice> | null | undefined) => string;

  // Departments - Purely User Driven
  departments: Department[];
  addDepartment: (d: Omit<Department, 'id'>) => Promise<void>;
  updateDepartment: (id: string, d: Partial<Department>) => Promise<void>;
  deleteDepartment: (id: string) => Promise<void>;

  // Shifts - Purely User Driven
  shifts: Shift[];
  addShift: (s: Omit<Shift, 'id'>) => Promise<void>;
  updateShift: (id: string, s: Partial<Shift>) => Promise<void>;
  deleteShift: (id: string) => Promise<void>;

  // Roster - Purely User Driven
  roster: RosterEntry[];
  setRoster: (r: RosterEntry[]) => void;
  addRosterEntry: (e: Omit<RosterEntry, 'id'>) => Promise<void>;
  updateRosterEntry: (id: string, e: Partial<RosterEntry>) => Promise<void>;
  saveRosterEntries: (entries: RosterEntry[]) => Promise<void>;
  deleteRosterEntries: (targets: { employeeId: string; date: string }[]) => Promise<void>;

  // Company Holidays & Special Off-Days
  companyHolidays: CompanyHoliday[];
  saveCompanyHoliday: (h: Omit<CompanyHoliday, 'id' | 'createdAt' | 'companyId'> & { id?: string; companyId?: string }) => Promise<CompanyHoliday>;
  deleteCompanyHoliday: (id: string, revertRoster?: boolean) => Promise<void>;

  // Leave Requests - Purely User Driven
  leaveRequests: LeaveRequest[];
  addLeaveRequest: (l: Omit<LeaveRequest, 'id'>) => Promise<void>;
  updateLeaveRequest: (id: string, l: Partial<LeaveRequest>) => Promise<void>;
  requestLeave: (l: Omit<LeaveRequest, 'id' | 'appliedOn'>) => Promise<void>;
  approveLeave: (id: string, remarks?: string) => Promise<void>;
  rejectLeave: (id: string, remarks?: string) => Promise<void>;

  // Attendance Regularization & Late / Early Requests
  attendanceRequests: AttendanceRequest[];
  addAttendanceRequest: (req: Omit<AttendanceRequest, 'id'>) => Promise<void>;
  updateAttendanceRequestStatus: (id: string, status: 'approved' | 'rejected', remarks?: string) => Promise<void>;

  // Month-End Payroll Runs & Payslip Publishing + Phase 2 Advanced Payroll
  monthlyPayrollRuns: Record<string, MonthlyPayrollRun>;
  generateMonthEndPayroll: (month: string, notes?: string) => Promise<void>;
  approveMonthlyPayrollRun: (month: string, notes?: string) => Promise<void>;
  lockMonthlyPayrollRun: (month: string, snapshots: Record<string, any>, totals: { gross: number; deductions: number; net: number }, notes?: string) => Promise<void>;
  unlockMonthlyPayrollRun: (month: string, reason: string) => Promise<void>;
  salaryAdvancesLoans: SalaryAdvanceLoan[];
  saveSalaryAdvanceLoan: (payload: Omit<SalaryAdvanceLoan, 'id' | 'createdAt' | 'companyId' | 'issuedBy'>) => Promise<SalaryAdvanceLoan>;
  updateSalaryAdvanceLoan: (id: string, updates: Partial<SalaryAdvanceLoan>) => Promise<void>;
  deleteSalaryAdvanceLoan: (id: string) => Promise<void>;

  // Phase 2: Performance Management
  performanceCycles: PerformanceCycle[];
  performanceGoals: PerformanceGoal[];
  performanceAppraisals: PerformanceAppraisal[];
  savePerformanceCycle: (cycle: Omit<PerformanceCycle, 'id' | 'createdAt' | 'companyId'> & { id?: string }) => Promise<PerformanceCycle>;
  deletePerformanceCycle: (id: string) => Promise<void>;
  savePerformanceGoal: (goal: Omit<PerformanceGoal, 'id' | 'updatedAt' | 'companyId'> & { id?: string }) => Promise<{ success: boolean; error?: string }>;
  updateGoalProgress: (goalId: string, progress: number, status?: PerformanceGoal['status'], notes?: string) => Promise<{ success: boolean; error?: string }>;
  deletePerformanceGoal: (id: string) => Promise<void>;
  submitSelfEvaluation: (payload: {
    cycleId: string;
    cycleTitle: string;
    employeeId: string;
    employeeName: string;
    department: string;
    designation: string;
    selfRating: number;
    selfAchievements: string;
    selfChallenges: string;
    selfGrowthPlan: string;
  }) => Promise<{ success: boolean; error?: string }>;
  submitManagerEvaluation: (payload: {
    cycleId: string;
    cycleTitle: string;
    employeeId: string;
    employeeName: string;
    department: string;
    designation: string;
    competencyRatings: NonNullable<PerformanceAppraisal['competencyRatings']>;
    managerRating: number;
    kpiWeightedScore: number;
    finalRating: number;
    finalGrade: string;
    managerFeedback: string;
    promotionRecommended: boolean;
    recommendedIncrementPercent: number;
  }) => Promise<{ success: boolean; error?: string }>;
  addPerformanceComment: (appraisalId: string, comment: string) => Promise<void>;

  // Phase 2: Expense Management
  expenseClaims: ExpenseClaim[];
  submitExpenseClaim: (payload: Omit<ExpenseClaim, 'id' | 'status' | 'reimbursementStatus' | 'createdAt' | 'companyId'>) => Promise<{ success: boolean; error?: string }>;
  decideExpenseClaim: (id: string, decision: 'approved' | 'rejected', reason: string) => Promise<{ success: boolean; error?: string }>;
  reimburseExpenseClaim: (id: string, method: NonNullable<ExpenseClaim['reimbursementMethod']>, reference: string, payrollMonth?: string) => Promise<{ success: boolean; error?: string }>;

  // Phase 2: Onboarding & Offboarding
  onboardingRecords: OnboardingRecord[];
  initiateOnboarding: (emp: Employee, mentorName?: string, probationEndDate?: string) => Promise<OnboardingRecord>;
  toggleOnboardingTask: (recordId: string, taskId: string, notes?: string) => Promise<{ success: boolean; error?: string }>;
  addOnboardingTask: (recordId: string, task: Omit<OnboardingTaskItem, 'id' | 'completed'>) => Promise<void>;
  acknowledgeOnboardingPolicy: (recordId: string, signature: string) => Promise<{ success: boolean; error?: string }>;

  offboardingRecords: OffboardingRecord[];
  initiateOffboarding: (payload: {
    employeeId: string;
    exitType: OffboardingRecord['exitType'];
    reason: string;
    initiatedDate: string;
    noticePeriodDaysRequired: number;
    noticePeriodDaysServed: number;
    lastWorkingDay: string;
  }) => Promise<{ success: boolean; record?: OffboardingRecord; error?: string }>;
  updateOffboardingClearance: (recordId: string, clearanceId: string, cleared: boolean, remarks?: string) => Promise<void>;
  addOffboardingAsset: (recordId: string, asset: Omit<OffboardingAssetItem, 'id'>) => Promise<void>;
  updateOffboardingAsset: (recordId: string, assetId: string, status: OffboardingAssetItem['status'], deductionAmount?: number) => Promise<void>;
  updateOffboardingDocuments: (recordId: string, docs: Partial<OffboardingRecord['documentsStatus']>) => Promise<void>;
  submitExitInterview: (recordId: string, interview: Omit<ExitInterviewData, 'completed' | 'completedAt' | 'conductedBy'>) => Promise<void>;
  updateFinalSettlement: (recordId: string, settlement: FinalSettlementData) => Promise<void>;
  terminateEmployeeAccess: (recordId: string) => Promise<{ success: boolean; error?: string }>;

  // Phase 3: Workforce Planning & Employee Movement History
  workforcePlans: WorkforcePositionPlan[];
  saveWorkforcePlan: (plan: Omit<WorkforcePositionPlan, 'id' | 'updatedAt' | 'companyId'> & { id?: string }) => Promise<WorkforcePositionPlan>;
  deleteWorkforcePlan: (id: string) => Promise<void>;
  employeeMovements: EmployeeMovementRecord[];
  recordEmployeeMovement: (payload: Omit<EmployeeMovementRecord, 'id' | 'createdAt' | 'companyId' | 'recordedBy'> & { applyToEmployeeProfile?: boolean }) => Promise<EmployeeMovementRecord>;

  // Phase 3: Employee Engagement
  companyAnnouncements: CompanyAnnouncement[];
  publishAnnouncement: (payload: Omit<CompanyAnnouncement, 'id' | 'createdAt' | 'companyId' | 'authorName' | 'authorRole' | 'acknowledgedBy'>) => Promise<CompanyAnnouncement>;
  acknowledgeAnnouncement: (announcementId: string) => Promise<void>;
  deleteAnnouncement: (id: string) => Promise<void>;

  employeeRecognitions: EmployeeRecognition[];
  giveRecognition: (payload: Omit<EmployeeRecognition, 'id' | 'createdAt' | 'companyId' | 'awardedById' | 'awardedByName' | 'awardedByRole' | 'likes'>) => Promise<EmployeeRecognition>;
  toggleRecognitionLike: (recognitionId: string) => Promise<void>;
  deleteRecognition: (id: string) => Promise<void>;

  employeeFeedbackList: EmployeeFeedbackItem[];
  submitEmployeeFeedback: (payload: Omit<EmployeeFeedbackItem, 'id' | 'status' | 'createdAt' | 'companyId'>) => Promise<{ success: boolean; error?: string }>;
  respondToEmployeeFeedback: (id: string, status: EmployeeFeedbackItem['status'], adminResponse: string) => Promise<void>;

  pulseSurveys: PulseSurvey[];
  createPulseSurvey: (payload: Omit<PulseSurvey, 'id' | 'responses' | 'createdAt' | 'companyId' | 'createdBy'>) => Promise<PulseSurvey>;
  submitPulseSurveyResponse: (surveyId: string, answers: Record<string, string | number>) => Promise<{ success: boolean; error?: string }>;
  closePulseSurvey: (surveyId: string) => Promise<void>;
  deletePulseSurvey: (surveyId: string) => Promise<void>;

  // Phase 4: Learning & Development (L&D)
  trainingCourses: TrainingCourse[];
  saveTrainingCourse: (payload: Omit<TrainingCourse, 'id' | 'createdAt' | 'companyId' | 'createdBy'> & { id?: string }) => Promise<TrainingCourse>;
  deleteTrainingCourse: (id: string) => Promise<void>;
  trainingEnrollments: TrainingEnrollment[];
  enrollInTrainingCourse: (courseId: string, employeeId: string) => Promise<{ success: boolean; error?: string; enrollment?: TrainingEnrollment }>;
  updateTrainingEnrollment: (
    enrollmentId: string,
    updates: Partial<Pick<TrainingEnrollment, 'status' | 'attendancePercent' | 'progressPercent' | 'assessmentScore' | 'effectivenessRating' | 'effectivenessFeedback' | 'managerEffectivenessScore'>>
  ) => Promise<{ success: boolean; error?: string }>;
  issueTrainingCertificate: (enrollmentId: string, expiryDate?: string) => Promise<{ success: boolean; error?: string; certificateNumber?: string }>;

  // Phase 4: Skill Management
  employeeSkills: EmployeeSkillRecord[];
  saveEmployeeSkill: (payload: Omit<EmployeeSkillRecord, 'id' | 'updatedAt' | 'companyId'> & { id?: string }) => Promise<{ success: boolean; error?: string }>;
  verifyEmployeeSkill: (skillId: string, verifiedLevel: number) => Promise<{ success: boolean; error?: string }>;
  deleteEmployeeSkill: (skillId: string) => Promise<void>;
  sendCertificationExpiryReminder: (skillId: string) => Promise<void>;
  positionSkillRequirements: PositionSkillRequirement[];
  savePositionSkillRequirement: (payload: Omit<PositionSkillRequirement, 'id' | 'updatedAt' | 'updatedBy' | 'companyId'> & { id?: string }) => Promise<PositionSkillRequirement>;
  deletePositionSkillRequirement: (id: string) => Promise<void>;

  // Phase 4: Career Management
  careerPathways: CareerPathway[];
  saveCareerPathway: (payload: Omit<CareerPathway, 'id' | 'updatedAt' | 'updatedBy' | 'companyId'> & { id?: string }) => Promise<CareerPathway>;
  deleteCareerPathway: (id: string) => Promise<void>;
  careerDevelopmentPlans: CareerDevelopmentPlan[];
  saveCareerDevelopmentPlan: (payload: Omit<CareerDevelopmentPlan, 'id' | 'updatedAt' | 'updatedBy' | 'companyId'> & { id?: string }) => Promise<{ success: boolean; error?: string }>;

  // Phase 4: Talent Management & Succession Planning
  talentProfiles: TalentProfile[];
  saveTalentProfile: (payload: Omit<TalentProfile, 'id' | 'updatedAt' | 'assessedBy' | 'companyId'> & { id?: string }) => Promise<{ success: boolean; error?: string }>;
  successionPlans: SuccessionPlan[];
  saveSuccessionPlan: (payload: Omit<SuccessionPlan, 'id' | 'updatedAt' | 'updatedBy' | 'companyId' | 'history'> & { id?: string; historyAction?: string }) => Promise<{ success: boolean; error?: string }>;
  deleteSuccessionPlan: (id: string) => Promise<void>;
  promoteSuccessorToPosition: (planId: string, successorEmployeeId: string, newSalary?: number) => Promise<{ success: boolean; error?: string }>;

  // Phase 5: Global Internationalization & Multi-Entity Architecture
  globalLegalEntities: GlobalLegalEntity[];
  saveGlobalLegalEntity: (payload: Omit<GlobalLegalEntity, 'id' | 'createdAt' | 'updatedAt' | 'companyId'> & { id?: string }) => Promise<GlobalLegalEntity>;
  deleteGlobalLegalEntity: (id: string) => Promise<void>;
  countryHolidays: CountryHolidayItem[];
  saveCountryHoliday: (payload: Omit<CountryHolidayItem, 'id' | 'companyId'> & { id?: string }) => Promise<CountryHolidayItem>;
  deleteCountryHoliday: (id: string) => Promise<void>;
  loadDefaultCountryHolidays: (countryCode: string, year: number) => Promise<number>;
  countryPayrollConfigs: CountryPayrollConfiguration[];
  saveCountryPayrollConfig: (payload: Omit<CountryPayrollConfiguration, 'id' | 'updatedAt' | 'companyId'> & { id?: string }) => Promise<CountryPayrollConfiguration>;
  deleteCountryPayrollConfig: (id: string) => Promise<void>;

  // Phase 5: Enterprise Security, Custom Roles, Sessions & Policies
  customRoles: CustomRoleDefinition[];
  saveCustomRole: (payload: Omit<CustomRoleDefinition, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'companyId'> & { id?: string }) => Promise<CustomRoleDefinition>;
  deleteCustomRole: (id: string) => Promise<void>;
  securitySessions: SecuritySessionRecord[];
  revokeSecuritySession: (sessionId: string) => Promise<void>;
  revokeAllOtherSessions: () => Promise<number>;
  tenantSecurityPolicy: TenantSecurityPolicy;
  updateTenantSecurityPolicy: (updates: Partial<TenantSecurityPolicy>) => Promise<void>;

  // Recruitment & Candidates
  recruitmentJobs: RecruitmentJob[];
  addRecruitmentJob: (job: Omit<RecruitmentJob, 'id'>) => void;
  updateRecruitmentJobStatus: (id: string, status: 'open' | 'closed') => void;
  candidates: Candidate[];
  addCandidate: (c: Omit<Candidate, 'id'>) => Promise<Candidate>;
  addCandidatesBatch: (list: Omit<Candidate, 'id'>[]) => Promise<number>;
  updateCandidateStage: (id: string, stage: CandidateStage) => Promise<void>;
  updateCandidate: (id: string, updates: Partial<Candidate>) => Promise<void>;
  deleteCandidate: (id: string) => Promise<void>;
  hireCandidate: (candidate: Candidate, initialSalary?: number) => Promise<void>;

  // Biometric Devices - Purely User & Hardware Driven
  devices: BiometricDevice[];
  allDevices: BiometricDevice[];
  addDevice: (d: Omit<BiometricDevice, 'id'>) => Promise<BiometricDevice>;
  updateDevice: (id: string, updates: Partial<BiometricDevice>) => Promise<void>;
  deleteDevice: (id: string) => Promise<void>;
  testDeviceConnection: (device: BiometricDevice) => Promise<{ success: boolean; status: BiometricDevice['status']; message: string; latency?: number }>;

  // Phase 1: Workflow & Approval Engine
  workflowRequests: WorkflowRequest[];
  submitWorkflowRequest: (payload: Omit<WorkflowRequest, 'id' | 'status' | 'createdAt' | 'history' | 'companyId'>) => Promise<{ success: boolean; id?: string; error?: string }>;
  decideWorkflowRequest: (id: string, decision: 'approved' | 'rejected', reason: string) => Promise<{ success: boolean; error?: string }>;

  // Phase 1: Employee Document Management
  hrDocuments: HRDocument[];
  uploadHRDocument: (payload: Omit<HRDocument, 'id' | 'createdAt' | 'companyId' | 'uploadedBy' | 'uploadedByRole'>) => Promise<{ success: boolean; error?: string }>;
  deleteHRDocument: (id: string) => Promise<{ success: boolean; error?: string }>;
  sendDocumentExpiryReminder: (docId: string) => Promise<void>;

  // Phase 1: Enterprise Audit Log
  auditLogs: AuditLogEntry[];
  recordAuditLog: (entry: {
    action: string;
    category: AuditLogCategory;
    targetType: string;
    targetId: string;
    targetName: string;
    summary: string;
    beforeValue?: any;
    afterValue?: any;
  }) => Promise<void>;

  // Phase 1: Manager Self-Service (MSS) & Authorization Helpers
  isCurrentUserManager: boolean;
  authorizedTeamEmployees: Employee[];
  canManageEmployee: (empOrId: Employee | string | undefined) => boolean;

  importBackupData: (backupObj: any) => Promise<{ success: boolean; count: number }>;
};

const DataContext = createContext<DataContextType | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { currentCompanyId } = useTenant();

  // Admin auth state from localStorage
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    try { return localStorage.getItem('worknest_admin_logged_in') === 'true'; } catch { return false; }
  });
  const [currentUser, setCurrentUser] = useState<DataContextType['currentUser']>(() => {
    try {
      const isLoggedIn = localStorage.getItem('worknest_admin_logged_in') === 'true';
      if (!isLoggedIn) return null;
      const stored = localStorage.getItem('worknest_admin_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const [isEmployeeAuthenticated, setIsEmployeeAuthenticated] = useState(() => {
    try { return localStorage.getItem('worknest_employee_logged_in') === 'true'; } catch { return false; }
  });
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(() => {
    try {
      const stored = localStorage.getItem('worknest_employee_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  // ALL DATA ARRAYS START COMPLETELY EMPTY (NO DUMMY / MOCK DATA)
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allEmployees, setEmployeesRaw] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [branches, setBranches] = useState<Branch[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_branches_${currentCompanyId || 'default'}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [{ ...DEFAULT_HEAD_OFFICE_BRANCH, companyId: currentCompanyId || 'default' }];
  });
  const [activeBranch, setActiveBranchState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('worknest_active_branch');
      if (!saved || saved.trim().toLowerCase() === 'all') return 'All';
      return saved;
    } catch {
      return 'All';
    }
  });
  const setActiveBranch = (branchName: string) => {
    const isAll = !branchName || branchName.trim().toLowerCase() === 'all';
    const val = isAll ? 'All' : branchName.trim();
    setActiveBranchState(val);
    try {
      localStorage.setItem('worknest_active_branch', val);
    } catch {}
  };
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [companyHolidays, setCompanyHolidays] = useState<CompanyHoliday[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_holidays_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [attendanceRequests, setAttendanceRequests] = useState<AttendanceRequest[]>(() => {
    try {
      const saved = localStorage.getItem('worknest_attendance_requests');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [monthlyPayrollRuns, setMonthlyPayrollRuns] = useState<Record<string, MonthlyPayrollRun>>(() => {
    try {
      const saved = localStorage.getItem('worknest_payroll_runs');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>(() => {
    try {
      const saved = localStorage.getItem('worknest_admin_accounts');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [rawWorkflowRequests, setRawWorkflowRequests] = useState<WorkflowRequest[]>([]);
  const [hrDocuments, setHrDocuments] = useState<HRDocument[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [salaryAdvancesLoans, setSalaryAdvancesLoans] = useState<SalaryAdvanceLoan[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_advances_loans_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [performanceCycles, setPerformanceCycles] = useState<PerformanceCycle[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_perf_cycles_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [performanceGoals, setPerformanceGoals] = useState<PerformanceGoal[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_perf_goals_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [performanceAppraisals, setPerformanceAppraisals] = useState<PerformanceAppraisal[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_perf_appraisals_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [expenseClaims, setExpenseClaims] = useState<ExpenseClaim[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_expense_claims_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [onboardingRecords, setOnboardingRecords] = useState<OnboardingRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_onboarding_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [offboardingRecords, setOffboardingRecords] = useState<OffboardingRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_offboarding_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [workforcePlans, setWorkforcePlans] = useState<WorkforcePositionPlan[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_workforce_plans_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [employeeMovements, setEmployeeMovements] = useState<EmployeeMovementRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_employee_movements_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [companyAnnouncements, setCompanyAnnouncements] = useState<CompanyAnnouncement[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_announcements_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [employeeRecognitions, setEmployeeRecognitions] = useState<EmployeeRecognition[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_recognitions_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [employeeFeedbackList, setEmployeeFeedbackList] = useState<EmployeeFeedbackItem[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_feedback_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [pulseSurveys, setPulseSurveys] = useState<PulseSurvey[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_pulse_surveys_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [trainingCourses, setTrainingCourses] = useState<TrainingCourse[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_training_courses_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [trainingEnrollments, setTrainingEnrollments] = useState<TrainingEnrollment[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_training_enrollments_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [employeeSkills, setEmployeeSkills] = useState<EmployeeSkillRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_employee_skills_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [positionSkillRequirements, setPositionSkillRequirements] = useState<PositionSkillRequirement[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_position_skills_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [careerPathways, setCareerPathways] = useState<CareerPathway[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_career_pathways_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [careerDevelopmentPlans, setCareerDevelopmentPlans] = useState<CareerDevelopmentPlan[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_career_plans_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [talentProfiles, setTalentProfiles] = useState<TalentProfile[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_talent_profiles_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [successionPlans, setSuccessionPlans] = useState<SuccessionPlan[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_succession_plans_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [globalLegalEntities, setGlobalLegalEntities] = useState<GlobalLegalEntity[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_global_entities_${currentCompanyId || 'default'}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      {
        id: `entity_bd_${currentCompanyId || 'default'}`,
        name: 'WorkNest Technologies Bangladesh (Primary Entity)',
        legalRegistrationName: 'WorkNest Solutions International Ltd.',
        registrationNumber: 'RJSC-C-184920/2024',
        taxIdentificationNumber: 'TIN-849201948201',
        countryCode: 'BD',
        countryName: 'Bangladesh',
        currencyCode: 'BDT',
        currencySymbol: '৳',
        timezone: 'Asia/Dhaka',
        dateFormat: 'DD/MM/YYYY',
        numberFormat: 'south_asian',
        primaryLanguage: 'en',
        fiscalYearCycle: 'July - June',
        headquartersAddress: 'Gulshan-2, Dhaka-1212, Bangladesh',
        linkedBranchNames: ['Main Head Office (Dhaka)'],
        exchangeRateToBase: 1,
        status: 'active',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        companyId: currentCompanyId || 'default',
      },
    ];
  });
  const [countryHolidays, setCountryHolidays] = useState<CountryHolidayItem[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_country_holidays_${currentCompanyId || 'default'}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return buildDefaultCountryHolidays('BD', new Date().getFullYear(), currentCompanyId || 'default');
  });
  const [countryPayrollConfigs, setCountryPayrollConfigs] = useState<CountryPayrollConfiguration[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_country_payroll_configs_${currentCompanyId || 'default'}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [buildDefaultCountryPayrollConfig('BD', currentCompanyId || 'default')];
  });
  const [customRoles, setCustomRoles] = useState<CustomRoleDefinition[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_custom_roles_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [securitySessions, setSecuritySessions] = useState<SecuritySessionRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`worknest_security_sessions_${currentCompanyId || 'default'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [tenantSecurityPolicy, setTenantSecurityPolicy] = useState<TenantSecurityPolicy>(() => {
    try {
      const saved = localStorage.getItem(`worknest_security_policy_${currentCompanyId || 'default'}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      companyId: currentCompanyId || 'default',
      mfaRequiredForAdmins: false,
      mfaRequiredForPayrollAndSecurity: false,
      sessionTimeoutMinutes: 120,
      maxConcurrentSessions: 5,
      maxFailedLoginAttempts: 5,
      lockoutDurationMinutes: 15,
      ipAllowlistEnabled: false,
      allowedIpRanges: [],
      requireStepUpForSalaryChanges: false,
      requireStepUpForDataExport: false,
      autoBackupReminderDays: 7,
      updatedAt: new Date().toISOString(),
      updatedBy: 'System Default',
    };
  });
  const [allDevices, setDevicesRaw] = useState<BiometricDevice[]>([]);
  const setEmployees = setEmployeesRaw;
  const setDevices = setDevicesRaw;

  const headOfficeBranchName = (
    branches.find(b => b.isHeadOffice || b.type === 'head_office')?.name ||
    branches[0]?.name ||
    DEFAULT_HEAD_OFFICE_BRANCH.name
  );

  const getEmployeeBranch = (emp: Partial<Employee> | null | undefined): string => {
    if (!emp) return headOfficeBranchName;
    if (emp.branchId) {
      const matchedById = branches.find(b => b.id === emp.branchId);
      if (matchedById) return matchedById.name;
      if (emp.branchId === 'BR-001' || emp.branchId === 'BR-HQ' || emp.branchId.endsWith('_BR-HQ')) {
        return headOfficeBranchName;
      }
    }
    const rawBranch = (emp.branch || (emp as any).branchName || '').trim();
    if (rawBranch) {
      const matched = branches.find(
        b => b.name.toLowerCase() === rawBranch.toLowerCase() || b.id.toLowerCase() === rawBranch.toLowerCase() || b.code.toLowerCase() === rawBranch.toLowerCase()
      );
      if (matched) return matched.name;
      if (rawBranch.toLowerCase().includes('head office') || rawBranch.toLowerCase() === 'main head office (dhaka)') {
        return headOfficeBranchName;
      }
      return rawBranch;
    }
    return headOfficeBranchName;
  };

  const getDeviceBranch = (dev: Partial<BiometricDevice> | null | undefined): string => {
    if (!dev) return headOfficeBranchName;
    if (dev.branchId) {
      const matchedById = branches.find(b => b.id === dev.branchId);
      if (matchedById) return matchedById.name;
      if (dev.branchId === 'BR-001' || dev.branchId === 'BR-HQ' || dev.branchId.endsWith('_BR-HQ')) {
        return headOfficeBranchName;
      }
    }
    const rawBranch = (dev.branch || (dev as any).branchName || '').trim();
    if (rawBranch) {
      const matched = branches.find(
        b => b.name.toLowerCase() === rawBranch.toLowerCase() || b.id.toLowerCase() === rawBranch.toLowerCase() || b.code.toLowerCase() === rawBranch.toLowerCase()
      );
      if (matched) return matched.name;
      if (rawBranch.toLowerCase().includes('head office') || rawBranch.toLowerCase() === 'main head office (dhaka)') {
        return headOfficeBranchName;
      }
      return rawBranch;
    }
    if (dev.location) {
      const matchedByLoc = branches.find(
        b => dev.location!.toLowerCase().includes(b.name.toLowerCase()) || (b.city && dev.location!.toLowerCase().includes(b.city.toLowerCase()))
      );
      if (matchedByLoc) return matchedByLoc.name;
    }
    return headOfficeBranchName;
  };

  const matchedActiveBranchObj = (activeBranch && activeBranch.trim().toLowerCase() !== 'all')
    ? branches.find(b => b.name.trim().toLowerCase() === activeBranch.trim().toLowerCase())
    : undefined;

  const isKnownActiveBranch = Boolean(matchedActiveBranchObj);
  const normalizedActiveBranch = matchedActiveBranchObj ? matchedActiveBranchObj.name : 'All';

  const employees = !isKnownActiveBranch
    ? allEmployees
    : allEmployees.filter(emp => getEmployeeBranch(emp).toLowerCase() === normalizedActiveBranch.toLowerCase());

  const devices = !isKnownActiveBranch
    ? allDevices
    : allDevices.filter(dev => getDeviceBranch(dev).toLowerCase() === normalizedActiveBranch.toLowerCase());
  const [recruitmentJobs, setRecruitmentJobs] = useState<RecruitmentJob[]>([
    {
      id: 'job-1',
      title: 'Senior Full Stack Engineer',
      department: 'Engineering',
      vacancies: 2,
      type: 'Full-time',
      experience: '3-5 years',
      status: 'open',
      postedDate: '2026-09-01',
      applicantsCount: 14,
    },
    {
      id: 'job-2',
      title: 'HR Operations Specialist',
      department: 'Human Resources',
      vacancies: 1,
      type: 'Full-time',
      experience: '1-3 years',
      status: 'open',
      postedDate: '2026-09-10',
      applicantsCount: 8,
    }
  ]);
  const [candidates, setCandidates] = useState<Candidate[]>([
    {
      id: 'cand-1',
      name: 'Rashedul Karim',
      phone: '+880 1711-234567',
      email: 'rashed.karim@example.com',
      jobId: 'job-1',
      jobTitle: 'Senior Full Stack Engineer',
      department: 'Engineering',
      stage: 'interview',
      appliedDate: '2026-09-12',
      interviewDate: '2026-09-22',
      expectedSalary: 65000,
      rating: 4,
      experience: '4 years (React, Node.js)',
      notes: 'Strong technical knowledge in TypeScript & Cloud databases.',
    },
    {
      id: 'cand-2',
      name: 'Nusrat Jahan',
      phone: '+880 1819-987654',
      email: 'nusrat.jahan@example.com',
      jobId: 'job-2',
      jobTitle: 'HR Operations Specialist',
      department: 'Human Resources',
      stage: 'screening',
      appliedDate: '2026-09-15',
      expectedSalary: 35000,
      rating: 5,
      experience: '2 years (Payroll & Attendance Management)',
      notes: 'Good communication skills, proficient in MS Excel & HRIS.',
    }
  ]);

  // Firebase Config & Status
  const [activeFirebaseConfig, setActiveFirebaseConfig] = useState<FirebaseConfigType>(getStoredFirebaseConfig());
  const [firebaseConnected, setFirebaseConnected] = useState(true);
  const [firebaseSyncing, setFirebaseSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(new Date());
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(true);

  // Real-time Firestore Listeners: when connected, automatically pull real collections scoped by tenant
  useEffect(() => {
    // Reset tenant-specific state when switching companies
    setEmployees([]);
    setDepartments([]);
    setShifts([]);
    setRoster([]);
    setLeaveRequests([]);
    setMessages([]);
    setDevices([]);
    setCandidates([]);
    setAttendanceRequests([]);
    setMonthlyPayrollRuns({});
    setAdminAccounts([]);
    setRawWorkflowRequests([]);
    setHrDocuments([]);
    setAuditLogs([]);
    setSalaryAdvancesLoans([]);
    setPerformanceCycles([]);
    setPerformanceGoals([]);
    setPerformanceAppraisals([]);
    setExpenseClaims([]);
    setOnboardingRecords([]);
    setOffboardingRecords([]);
    setWorkforcePlans([]);
    setEmployeeMovements([]);
    setCompanyAnnouncements([]);
    setEmployeeRecognitions([]);
    setEmployeeFeedbackList([]);
    setPulseSurveys([]);
    setTrainingCourses([]);
    setTrainingEnrollments([]);
    setEmployeeSkills([]);
    setPositionSkillRequirements([]);
    setCareerPathways([]);
    setCareerDevelopmentPlans([]);
    setTalentProfiles([]);
    setSuccessionPlans([]);

    if (!firebaseConnected || (!isAuthenticated && !isEmployeeAuthenticated)) return;
    try {
      const { db } = getFirebaseInstance();
      const activeTenant = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
        ? currentEmployee.companyId
        : (currentCompanyId || 'default');

      const getTenantRef = (colName: string) => {
        if (activeTenant !== 'default') {
          return query(collection(db, colName), where('companyId', '==', activeTenant));
        }
        return collection(db, colName);
      };

      const belongsToTenant = (data: any) => {
        if (activeTenant !== 'default') {
          return data.companyId === activeTenant;
        }
        return !data.companyId || data.companyId === 'default';
      };

      // 1. Employees stream (For regular Employee sessions, listen ONLY to own doc; for Manager Employee sessions, listen to team/department docs in same tenant)
      const isEmpManagerSession = Boolean(isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.isManager);
      const unsubEmp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.id && !isEmpManagerSession)
        ? onSnapshot(doc(db, 'employees', currentEmployee.id), (dSnap) => {
            if (dSnap.exists()) {
              const data = dSnap.data();
              if (belongsToTenant(data)) {
                if (data.status === 'inactive' || data.accessTerminated) {
                  logoutEmployee();
                  return;
                }
                const { password: _omitted, ...safeEmp } = data;
                const empObj = { ...safeEmp, id: dSnap.id, companyId: data.companyId || activeTenant } as Employee;
                setEmployees([empObj]);
                setCurrentEmployee(empObj);
                setLastSyncTime(new Date());
              }
            }
          }, (err) => console.warn('Employee own doc listener err:', err))
        : onSnapshot(getTenantRef('employees'), (snap) => {
            const list: Employee[] = [];
            snap.forEach(d => {
              const data = d.data();
              if (belongsToTenant(data)) {
                const { password: _omitted, ...safeData } = data;
                const empItem = (isEmployeeAuthenticated && !isAuthenticated)
                  ? ({ ...safeData, id: d.id, companyId: data.companyId || activeTenant } as Employee)
                  : ({ ...data, id: d.id, companyId: data.companyId || activeTenant } as Employee);
                if (isEmpManagerSession && currentEmployee) {
                  const isSelf = empItem.id === currentEmployee.id || empItem.employeeId === currentEmployee.employeeId;
                  const isDirectReport = empItem.managerId === currentEmployee.employeeId || empItem.managerId === currentEmployee.id;
                  const isSameDept = Boolean(currentEmployee.department && (empItem.department || '').trim().toLowerCase() === currentEmployee.department.trim().toLowerCase());
                  if (isSelf || isDirectReport || isSameDept) {
                    list.push(empItem);
                  }
                  if (isSelf) {
                    setCurrentEmployee(empItem);
                  }
                } else {
                  list.push(empItem);
                }
              }
            });
            setEmployees(list);
            setLastSyncTime(new Date());
          }, (err) => console.warn('Employees listener err:', err));

      // 2. Departments stream
      const unsubDept = onSnapshot(getTenantRef('departments'), (snap) => {
        const list: Department[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id, companyId: data.companyId || activeTenant } as Department);
          }
        });
        setDepartments(list);
      }, (err) => console.warn('Departments listener err:', err));

      // 2b. Branches stream (Head Office + Branch Offices) with dual Firestore persistence (/branches + /settings/branches_*)
      const getDeletedBranchIds = (): Set<string> => {
        try {
          const raw = localStorage.getItem(`worknest_deleted_branches_${activeTenant}`);
          if (raw) return new Set(JSON.parse(raw));
        } catch {}
        return new Set();
      };

      const unsubBranchesSettings = onSnapshot(doc(db, 'settings', `branches_${activeTenant}`), (dSnap) => {
        if (dSnap.exists()) {
          const data = dSnap.data();
          if (Array.isArray(data.deletedIds)) {
            try {
              localStorage.setItem(`worknest_deleted_branches_${activeTenant}`, JSON.stringify(data.deletedIds));
            } catch {}
          }
          if (Array.isArray(data.items) && data.items.length > 0) {
            const delSet = new Set<string>(Array.isArray(data.deletedIds) ? data.deletedIds : Array.from(getDeletedBranchIds()));
            const validList = (data.items as Branch[]).filter(b => b && b.id && !delSet.has(b.id));
            if (validList.length > 0) {
              validList.sort((a, b) => (b.isHeadOffice || b.type === 'head_office' ? 1 : 0) - (a.isHeadOffice || a.type === 'head_office' ? 1 : 0));
              setBranches(validList);
              try { localStorage.setItem(`worknest_branches_${activeTenant}`, JSON.stringify(validList)); } catch {}
            }
          }
        }
      }, () => {});

      const unsubBranches = onSnapshot(getTenantRef('branches'), (snap) => {
        const delSet = getDeletedBranchIds();
        const list: Branch[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (belongsToTenant(data) && !delSet.has(d.id) && !data.deleted) {
            list.push({ ...data, id: d.id, companyId: data.companyId || activeTenant } as Branch);
          }
        });
        if (list.length > 0) {
          // Ensure Head Office exists and appears first
          const hasHq = list.some(b => b.isHeadOffice || b.type === 'head_office');
          if (!hasHq) {
            try {
              const savedLocal = localStorage.getItem(`worknest_branches_${activeTenant}`);
              const localArr: Branch[] = savedLocal ? JSON.parse(savedLocal) : [];
              const localHq = localArr.find(b => b.isHeadOffice || b.type === 'head_office');
              list.unshift(localHq || { ...DEFAULT_HEAD_OFFICE_BRANCH, companyId: activeTenant });
            } catch {
              list.unshift({ ...DEFAULT_HEAD_OFFICE_BRANCH, companyId: activeTenant });
            }
          }
          list.sort((a, b) => (b.isHeadOffice || b.type === 'head_office' ? 1 : 0) - (a.isHeadOffice || a.type === 'head_office' ? 1 : 0));
          setBranches(list);
          try { localStorage.setItem(`worknest_branches_${activeTenant}`, JSON.stringify(list)); } catch {}
        } else {
          try {
            const savedLocal = localStorage.getItem(`worknest_branches_${activeTenant}`);
            if (savedLocal) {
              const parsed = JSON.parse(savedLocal);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const filteredLocal = parsed.filter((b: Branch) => b && b.id && !delSet.has(b.id));
                if (filteredLocal.length > 0) {
                  setBranches(filteredLocal);
                  return;
                }
              }
            }
          } catch {}
          const defaultHq: Branch = { ...DEFAULT_HEAD_OFFICE_BRANCH, companyId: activeTenant };
          setBranches([defaultHq]);
        }
      }, (err) => {
        console.warn('Branches listener err (using settings/localStorage fallback):', err);
      });

      // 3. Shifts stream
      const unsubShifts = onSnapshot(getTenantRef('shifts'), (snap) => {
        const list: Shift[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id, name: (data.name || '').trim(), companyId: data.companyId || activeTenant } as Shift);
          }
        });
        setShifts(list);
      }, (err) => console.warn('Shifts listener err:', err));

      // 4. Roster stream
      const unsubRoster = onSnapshot(getTenantRef('roster'), (snap) => {
        const list: RosterEntry[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id } as RosterEntry);
          }
        });
        setRoster(list);
      }, (err) => console.warn('Roster listener err:', err));

      // 5. Leave Requests stream
      const unsubLeaves = onSnapshot(getTenantRef('leaveRequests'), (snap) => {
        const list: LeaveRequest[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id } as LeaveRequest);
          }
        });
        setLeaveRequests(list);
      }, (err) => console.warn('Leaves listener err:', err));

      // 6. Messages stream
      const unsubMsg = onSnapshot(getTenantRef('messages'), (snap) => {
        const list: Message[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id } as Message);
          }
        });
        setMessages(list);
      }, (err) => console.warn('Messages listener err:', err));

      // 7. Biometric Devices stream (Admin only)
      const unsubDevices = isAuthenticated
        ? onSnapshot(getTenantRef('zkteco_devices'), (snap) => {
            const list: BiometricDevice[] = [];
            snap.forEach(d => {
              const data = d.data();
              if (belongsToTenant(data)) {
                list.push(normalizeBiometricDevice({ ...data, id: d.id, companyId: data.companyId || activeTenant }));
              }
            });
            setDevices(list);
          }, (err) => console.warn('Biometric devices listener err:', err))
        : () => {};

      // 8. Candidates stream (Admin only)
      const unsubCandidates = isAuthenticated
        ? onSnapshot(getTenantRef('candidates'), (snap) => {
            const list: Candidate[] = [];
            snap.forEach(d => {
              const data = d.data();
              if (belongsToTenant(data)) {
                list.push({ ...data, id: d.id } as Candidate);
              }
            });
            setCandidates(list);
          }, (err) => console.warn('Candidates listener err:', err))
        : () => {};

      // 9. Attendance Requests stream
      const unsubAttReqs = onSnapshot(getTenantRef('attendance_requests'), (snap) => {
        const list: AttendanceRequest[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id } as AttendanceRequest);
          }
        });
        setAttendanceRequests(list);
        try { localStorage.setItem('worknest_attendance_requests', JSON.stringify(list)); } catch {}
      }, (err) => console.warn('Attendance requests listener err:', err));

      // 10. Monthly Payroll runs stream
      const unsubRuns = onSnapshot(getTenantRef('payroll_runs'), (snap) => {
        const runs: Record<string, MonthlyPayrollRun> = {};
        snap.forEach(d => {
          const data = d.data();
          if (belongsToTenant(data)) {
            runs[d.id] = { ...data, month: d.id } as MonthlyPayrollRun;
          }
        });
        setMonthlyPayrollRuns(runs);
        try { localStorage.setItem('worknest_payroll_runs', JSON.stringify(runs)); } catch {}
      }, (err) => console.warn('Payroll runs listener err:', err));

      // 11. Admin Accounts stream (Admin only) - Deduplicated by email
      const unsubAdmins = isAuthenticated
        ? onSnapshot(getTenantRef('admins'), (snap) => {
            const byEmail = new Map<string, AdminAccount>();
            snap.forEach(d => {
              const data = d.data();
              if (belongsToTenant(data)) {
                const item = { id: d.id, ...data } as AdminAccount;
                const emailKey = (item.email || d.id).trim().toLowerCase();
                const existing = byEmail.get(emailKey);
                if (
                  !existing ||
                  d.id.startsWith('admin_') ||
                  (!existing.id.startsWith('admin_') && String(data.updatedAt || '') >= String((existing as any).updatedAt || ''))
                ) {
                  byEmail.set(emailKey, item);
                }
              }
            });
            const list = Array.from(byEmail.values());
            setAdminAccounts(list);
            try { localStorage.setItem('worknest_admin_accounts', JSON.stringify(list)); } catch {}
          }, (err) => console.warn('Admins listener err:', err))
        : () => {};

      // 12. Workflow Requests stream (Phase 1 Approval Engine)
      const unsubWorkflows = onSnapshot(getTenantRef('workflow_requests'), (snap) => {
        const list: WorkflowRequest[] = [];
        snap.forEach(d => {
          const data = d.data();
          if (belongsToTenant(data)) {
            if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
              const isOwn = data.employeeId === currentEmployee.id || data.employeeId === currentEmployee.employeeId || data.requesterId === currentEmployee.id;
              const isMgrTeam = Boolean(
                currentEmployee.isManager &&
                currentEmployee.department &&
                (data.department || '').trim().toLowerCase() === currentEmployee.department.trim().toLowerCase()
              );
              if (isOwn || isMgrTeam) {
                list.push({ ...data, id: d.id } as WorkflowRequest);
              }
            } else {
              list.push({ ...data, id: d.id } as WorkflowRequest);
            }
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setRawWorkflowRequests(list);
      }, (err) => console.warn('Workflow requests listener err:', err));

      // 13. HR Documents stream (Phase 1 Document Management — strictly isolated so one employee never sees another employee's private docs)
      const unsubDocs = onSnapshot(getTenantRef('hr_documents'), (snap) => {
        const list: HRDocument[] = [];
        snap.forEach(d => {
          const data = d.data() as HRDocument;
          if (belongsToTenant(data)) {
            if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
              const isCompanyPolicy = data.visibility === 'company_policy';
              const isOwnDoc =
                data.employeeId === currentEmployee.id ||
                data.employeeId === currentEmployee.employeeId;
              if (isCompanyPolicy || isOwnDoc) {
                list.push({ ...data, id: d.id });
              }
            } else {
              list.push({ ...data, id: d.id });
            }
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setHrDocuments(list);
      }, (err) => console.warn('HR Documents listener err:', err));

      // 14. Audit Logs stream (Phase 1 Enterprise Audit Log — Admin only)
      const unsubAudits = isAuthenticated
        ? onSnapshot(getTenantRef('audit_logs'), (snap) => {
            const list: AuditLogEntry[] = [];
            snap.forEach(d => {
              const data = d.data() as AuditLogEntry;
              if (belongsToTenant(data)) {
                list.push({ ...data, id: d.id });
              }
            });
            list.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
            setAuditLogs(list.slice(0, 500));
          }, (err) => console.warn('Audit logs listener err:', err))
        : () => {};

      // Helper for employee/manager RBAC record scoping in real-time listeners
      const canSessionSeeEmployeeRecord = (recordEmpId?: string, recordDept?: string) => {
        if (isAuthenticated && currentUser) {
          const assignedDept = ((currentUser as any).assignedDepartment || '').trim().toLowerCase();
          if (assignedDept && recordDept && recordDept.trim().toLowerCase() !== assignedDept) {
            return false;
          }
          return true;
        }
        if (isEmployeeAuthenticated && currentEmployee) {
          const isOwn =
            recordEmpId === currentEmployee.id ||
            recordEmpId === currentEmployee.employeeId;
          if (isOwn) return true;
          if (currentEmployee.isManager) {
            const isSameDept =
              Boolean(currentEmployee.department) &&
              Boolean(recordDept) &&
              recordDept!.trim().toLowerCase() === currentEmployee.department.trim().toLowerCase();
            return isSameDept;
          }
          return false;
        }
        return false;
      };

      // 15. Phase 2: Salary Advances & Loans stream
      const unsubAdvances = onSnapshot(getTenantRef('salary_advances_loans'), (snap) => {
        const list: SalaryAdvanceLoan[] = [];
        snap.forEach(d => {
          const data = d.data() as SalaryAdvanceLoan;
          if (belongsToTenant(data) && canSessionSeeEmployeeRecord(data.employeeId, data.department)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setSalaryAdvancesLoans(list);
        try { localStorage.setItem(`worknest_advances_loans_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 16. Phase 2: Performance Cycles stream
      const unsubPerfCycles = onSnapshot(getTenantRef('performance_cycles'), (snap) => {
        const list: PerformanceCycle[] = [];
        snap.forEach(d => {
          const data = d.data() as PerformanceCycle;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setPerformanceCycles(list);
        try { localStorage.setItem(`worknest_perf_cycles_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 17. Phase 2: Performance Goals stream (RBAC isolated)
      const unsubPerfGoals = onSnapshot(getTenantRef('performance_goals'), (snap) => {
        const list: PerformanceGoal[] = [];
        snap.forEach(d => {
          const data = d.data() as PerformanceGoal;
          if (belongsToTenant(data) && canSessionSeeEmployeeRecord(data.employeeId, data.department)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setPerformanceGoals(list);
        try { localStorage.setItem(`worknest_perf_goals_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 18. Phase 2: Performance Appraisals stream (RBAC isolated)
      const unsubPerfAppraisals = onSnapshot(getTenantRef('performance_appraisals'), (snap) => {
        const list: PerformanceAppraisal[] = [];
        snap.forEach(d => {
          const data = d.data() as PerformanceAppraisal;
          if (belongsToTenant(data) && canSessionSeeEmployeeRecord(data.employeeId, data.department)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setPerformanceAppraisals(list);
        try { localStorage.setItem(`worknest_perf_appraisals_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 19. Phase 2: Expense Claims stream (RBAC isolated)
      const unsubExpenses = onSnapshot(getTenantRef('expense_claims'), (snap) => {
        const list: ExpenseClaim[] = [];
        snap.forEach(d => {
          const data = d.data() as ExpenseClaim;
          if (belongsToTenant(data) && canSessionSeeEmployeeRecord(data.employeeId, data.department)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setExpenseClaims(list);
        try { localStorage.setItem(`worknest_expense_claims_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 20. Phase 2: Onboarding Records stream (RBAC isolated)
      const unsubOnboarding = onSnapshot(getTenantRef('onboarding_records'), (snap) => {
        const list: OnboardingRecord[] = [];
        snap.forEach(d => {
          const data = d.data() as OnboardingRecord;
          if (belongsToTenant(data) && canSessionSeeEmployeeRecord(data.employeeId, data.department)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setOnboardingRecords(list);
        try { localStorage.setItem(`worknest_onboarding_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 21. Phase 2: Offboarding Records stream (RBAC isolated)
      const unsubOffboarding = onSnapshot(getTenantRef('offboarding_records'), (snap) => {
        const list: OffboardingRecord[] = [];
        snap.forEach(d => {
          const data = d.data() as OffboardingRecord;
          if (belongsToTenant(data) && canSessionSeeEmployeeRecord(data.employeeId, data.department)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setOffboardingRecords(list);
        try { localStorage.setItem(`worknest_offboarding_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 22. Phase 3: Workforce Position Plans stream
      const unsubWorkforcePlans = onSnapshot(getTenantRef('workforce_plans'), (snap) => {
        const list: WorkforcePositionPlan[] = [];
        snap.forEach(d => {
          const data = d.data() as WorkforcePositionPlan;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setWorkforcePlans(list);
        try { localStorage.setItem(`worknest_workforce_plans_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 23. Phase 3: Employee Movement History stream (RBAC isolated)
      const unsubMovements = onSnapshot(getTenantRef('employee_movements'), (snap) => {
        const list: EmployeeMovementRecord[] = [];
        snap.forEach(d => {
          const data = d.data() as EmployeeMovementRecord;
          if (
            belongsToTenant(data) &&
            canSessionSeeEmployeeRecord(data.employeeId, data.toDepartment || data.fromDepartment)
          ) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.effectiveDate || b.createdAt || '').localeCompare(String(a.effectiveDate || a.createdAt || '')));
        setEmployeeMovements(list);
        try { localStorage.setItem(`worknest_employee_movements_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 24. Phase 3: Company Announcements stream
      const unsubAnnouncements = onSnapshot(getTenantRef('company_announcements'), (snap) => {
        const list: CompanyAnnouncement[] = [];
        snap.forEach(d => {
          const data = d.data() as CompanyAnnouncement;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id, acknowledgedBy: Array.isArray(data.acknowledgedBy) ? data.acknowledgedBy : [] });
          }
        });
        list.sort((a, b) => {
          if (Boolean(b.isPinned) !== Boolean(a.isPinned)) return b.isPinned ? 1 : -1;
          return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        });
        setCompanyAnnouncements(list);
        try { localStorage.setItem(`worknest_announcements_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 25. Phase 3: Employee Recognitions stream
      const unsubRecognitions = onSnapshot(getTenantRef('employee_recognitions'), (snap) => {
        const list: EmployeeRecognition[] = [];
        snap.forEach(d => {
          const data = d.data() as EmployeeRecognition;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id, likes: Array.isArray(data.likes) ? data.likes : [] });
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setEmployeeRecognitions(list);
        try { localStorage.setItem(`worknest_recognitions_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 26. Phase 3: Employee Feedback stream (Strictly permission-controlled: Employee sees ONLY own feedback; Manager sees department 'management' feedback; HR/Admin sees tenant feedback)
      const unsubFeedback = onSnapshot(getTenantRef('employee_feedback'), (snap) => {
        const list: EmployeeFeedbackItem[] = [];
        snap.forEach(d => {
          const data = d.data() as EmployeeFeedbackItem;
          if (!belongsToTenant(data)) return;
          if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
            const isOwn =
              data.employeeId === currentEmployee.id ||
              data.employeeId === currentEmployee.employeeId;
            const isMgrAllowed =
              Boolean(currentEmployee.isManager) &&
              data.visibility === 'management' &&
              Boolean(currentEmployee.department) &&
              (data.department || '').trim().toLowerCase() === currentEmployee.department.trim().toLowerCase();
            if (isOwn || isMgrAllowed) {
              list.push({ ...data, id: d.id });
            }
          } else if (isAuthenticated && currentUser) {
            const isSupervisor = currentUser.role === 'Department Supervisor';
            const assignedDept = ((currentUser as any).assignedDepartment || '').trim().toLowerCase();
            if (isSupervisor && data.visibility === 'hr_only') {
              return;
            }
            if (assignedDept && (data.department || '').trim().toLowerCase() !== assignedDept) {
              return;
            }
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setEmployeeFeedbackList(list);
        try { localStorage.setItem(`worknest_feedback_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 27. Phase 3: Pulse Surveys stream
      const unsubSurveys = onSnapshot(getTenantRef('pulse_surveys'), (snap) => {
        const list: PulseSurvey[] = [];
        snap.forEach(d => {
          const data = d.data() as PulseSurvey;
          if (belongsToTenant(data)) {
            list.push({
              ...data,
              id: d.id,
              questions: Array.isArray(data.questions) ? data.questions : [],
              responses: Array.isArray(data.responses) ? data.responses : [],
            });
          }
        });
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setPulseSurveys(list);
        try { localStorage.setItem(`worknest_pulse_surveys_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 28. Phase 4: Training Courses stream
      const unsubTrainingCourses = onSnapshot(getTenantRef('training_courses'), (snap) => {
        const list: TrainingCourse[] = [];
        snap.forEach(d => {
          const data = d.data() as TrainingCourse;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id, targetSkills: Array.isArray(data.targetSkills) ? data.targetSkills : [] });
          }
        });
        list.sort((a, b) => String(b.scheduledStartDate || b.createdAt || '').localeCompare(String(a.scheduledStartDate || a.createdAt || '')));
        setTrainingCourses(list);
        try { localStorage.setItem(`worknest_training_courses_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 29. Phase 4: Training Enrollments stream (RBAC isolated)
      const unsubTrainingEnrollments = onSnapshot(getTenantRef('training_enrollments'), (snap) => {
        const list: TrainingEnrollment[] = [];
        snap.forEach(d => {
          const data = d.data() as TrainingEnrollment;
          if (belongsToTenant(data) && canSessionSeeEmployeeRecord(data.employeeId, data.department)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.enrolledAt || '').localeCompare(String(a.enrolledAt || '')));
        setTrainingEnrollments(list);
        try { localStorage.setItem(`worknest_training_enrollments_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 30. Phase 4: Employee Skills stream (RBAC isolated)
      const unsubEmployeeSkills = onSnapshot(getTenantRef('employee_skills'), (snap) => {
        const list: EmployeeSkillRecord[] = [];
        snap.forEach(d => {
          const data = d.data() as EmployeeSkillRecord;
          if (belongsToTenant(data) && canSessionSeeEmployeeRecord(data.employeeId, data.department)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setEmployeeSkills(list);
        try { localStorage.setItem(`worknest_employee_skills_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 31. Phase 4: Position Skill Requirements stream
      const unsubPositionSkills = onSnapshot(getTenantRef('position_skill_requirements'), (snap) => {
        const list: PositionSkillRequirement[] = [];
        snap.forEach(d => {
          const data = d.data() as PositionSkillRequirement;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id, requiredSkills: Array.isArray(data.requiredSkills) ? data.requiredSkills : [] });
          }
        });
        setPositionSkillRequirements(list);
        try { localStorage.setItem(`worknest_position_skills_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 32. Phase 4: Career Pathways stream
      const unsubCareerPathways = onSnapshot(getTenantRef('career_pathways'), (snap) => {
        const list: CareerPathway[] = [];
        snap.forEach(d => {
          const data = d.data() as CareerPathway;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id, steps: Array.isArray(data.steps) ? data.steps : [] });
          }
        });
        setCareerPathways(list);
        try { localStorage.setItem(`worknest_career_pathways_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 33. Phase 4: Career Development Plans stream (RBAC isolated + strip managerConfidentialNotes for regular employees)
      const unsubCareerPlans = onSnapshot(getTenantRef('career_development_plans'), (snap) => {
        const list: CareerDevelopmentPlan[] = [];
        const isRegularEmpSession = Boolean(isEmployeeAuthenticated && !isAuthenticated && currentEmployee && !currentEmployee.isManager);
        snap.forEach(d => {
          const data = d.data() as CareerDevelopmentPlan;
          if (belongsToTenant(data) && canSessionSeeEmployeeRecord(data.employeeId, data.department)) {
            const sanitized: CareerDevelopmentPlan = {
              ...data,
              id: d.id,
              developmentActions: Array.isArray(data.developmentActions) ? data.developmentActions : [],
              recommendedCourseIds: Array.isArray(data.recommendedCourseIds) ? data.recommendedCourseIds : [],
              managerConfidentialNotes: isRegularEmpSession ? undefined : data.managerConfidentialNotes,
            };
            list.push(sanitized);
          }
        });
        setCareerDevelopmentPlans(list);
        try { localStorage.setItem(`worknest_career_plans_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 34. Phase 4: Talent Profiles stream (Strictly permission-controlled: Employees ONLY see own profile if shareWithEmployee=true, and NEVER see confidentialAssessmentNotes)
      const unsubTalentProfiles = onSnapshot(getTenantRef('talent_profiles'), (snap) => {
        const list: TalentProfile[] = [];
        snap.forEach(d => {
          const data = d.data() as TalentProfile;
          if (!belongsToTenant(data)) return;
          if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
            const isOwn = data.employeeId === currentEmployee.id || data.employeeId === currentEmployee.employeeId;
            if (isOwn && data.shareWithEmployee) {
              list.push({
                ...data,
                id: d.id,
                confidentialAssessmentNotes: undefined,
                retentionRisk: 'low',
              });
            } else if (
              currentEmployee.isManager &&
              !isOwn &&
              currentEmployee.department &&
              (data.department || '').trim().toLowerCase() === currentEmployee.department.trim().toLowerCase()
            ) {
              list.push({ ...data, id: d.id });
            }
          } else if (isAuthenticated && currentUser) {
            const assignedDept = ((currentUser as any).assignedDepartment || '').trim().toLowerCase();
            if (assignedDept && (data.department || '').trim().toLowerCase() !== assignedDept) return;
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setTalentProfiles(list);
        try { localStorage.setItem(`worknest_talent_profiles_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 35. Phase 4: Succession Plans stream (Strictly Confidential: Never exposed to regular employees)
      const unsubSuccessionPlans = (isAuthenticated || Boolean(currentEmployee?.isManager))
        ? onSnapshot(getTenantRef('succession_plans'), (snap) => {
            const list: SuccessionPlan[] = [];
            snap.forEach(d => {
              const data = d.data() as SuccessionPlan;
              if (!belongsToTenant(data)) return;
              if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.isManager) {
                if (
                  currentEmployee.department &&
                  (data.department || '').trim().toLowerCase() !== currentEmployee.department.trim().toLowerCase()
                ) {
                  return;
                }
              } else if (isAuthenticated && currentUser) {
                const assignedDept = ((currentUser as any).assignedDepartment || '').trim().toLowerCase();
                if (assignedDept && (data.department || '').trim().toLowerCase() !== assignedDept) return;
              }
              list.push({
                ...data,
                id: d.id,
                successors: Array.isArray(data.successors) ? data.successors : [],
                history: Array.isArray(data.history) ? data.history : [],
              });
            });
            list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
            setSuccessionPlans(list);
            try { localStorage.setItem(`worknest_succession_plans_${activeTenant}`, JSON.stringify(list)); } catch {}
          }, () => {})
        : () => {};

      // 36. Phase 5: Global Legal Entities stream
      const unsubGlobalEntities = onSnapshot(getTenantRef('global_legal_entities'), (snap) => {
        const list: GlobalLegalEntity[] = [];
        snap.forEach(d => {
          const data = d.data() as GlobalLegalEntity;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id, linkedBranchNames: Array.isArray(data.linkedBranchNames) ? data.linkedBranchNames : [] });
          }
        });
        if (list.length > 0) {
          setGlobalLegalEntities(list);
          try { localStorage.setItem(`worknest_global_entities_${activeTenant}`, JSON.stringify(list)); } catch {}
        }
      }, () => {});

      // 37. Phase 5: Country Holidays stream
      const unsubCountryHolidays = onSnapshot(getTenantRef('country_holidays'), (snap) => {
        const list: CountryHolidayItem[] = [];
        snap.forEach(d => {
          const data = d.data() as CountryHolidayItem;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id });
          }
        });
        if (list.length > 0) {
          list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
          setCountryHolidays(list);
          try { localStorage.setItem(`worknest_country_holidays_${activeTenant}`, JSON.stringify(list)); } catch {}
        }
      }, () => {});

      // 38. Phase 5: Country Payroll Configurations stream
      const unsubCountryPayroll = onSnapshot(getTenantRef('country_payroll_configs'), (snap) => {
        const list: CountryPayrollConfiguration[] = [];
        snap.forEach(d => {
          const data = d.data() as CountryPayrollConfiguration;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id, taxSlabs: Array.isArray(data.taxSlabs) ? data.taxSlabs : [] });
          }
        });
        if (list.length > 0) {
          setCountryPayrollConfigs(list);
          try { localStorage.setItem(`worknest_country_payroll_configs_${activeTenant}`, JSON.stringify(list)); } catch {}
        }
      }, () => {});

      // 39. Phase 5: Custom Roles stream (Admin only)
      const unsubCustomRoles = isAuthenticated
        ? onSnapshot(getTenantRef('custom_roles'), (snap) => {
            const list: CustomRoleDefinition[] = [];
            snap.forEach(d => {
              const data = d.data() as CustomRoleDefinition;
              if (belongsToTenant(data)) {
                list.push({ ...data, id: d.id });
              }
            });
            setCustomRoles(list);
            try { localStorage.setItem(`worknest_custom_roles_${activeTenant}`, JSON.stringify(list)); } catch {}
          }, () => {})
        : () => {};

      // 40. Phase 5: Security Sessions stream
      const unsubSecSessions = onSnapshot(getTenantRef('security_sessions'), (snap) => {
        const list: SecuritySessionRecord[] = [];
        snap.forEach(d => {
          const data = d.data() as SecuritySessionRecord;
          if (!belongsToTenant(data)) return;
          if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
            const isOwn = data.actorId === currentEmployee.id || data.actorId === currentEmployee.employeeId;
            if (isOwn) list.push({ ...data, id: d.id });
          } else if (isAuthenticated) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.loginAt || '').localeCompare(String(a.loginAt || '')));
        setSecuritySessions(list);
        try { localStorage.setItem(`worknest_security_sessions_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      // 41. Phase 5: Tenant Security Policy listener
      const unsubSecPolicy = onSnapshot(doc(db, 'settings', `security_policy_${activeTenant}`), (snap) => {
        if (snap.exists()) {
          const data = snap.data() as TenantSecurityPolicy;
          setTenantSecurityPolicy(prev => {
            const next = { ...prev, ...data, companyId: activeTenant };
            try { localStorage.setItem(`worknest_security_policy_${activeTenant}`, JSON.stringify(next)); } catch {}
            return next;
          });
        }
      }, () => {});

      // 42. Company Holidays stream
      const unsubCompanyHolidays = onSnapshot(getTenantRef('company_holidays'), (snap) => {
        const list: CompanyHoliday[] = [];
        snap.forEach(d => {
          const data = d.data() as CompanyHoliday;
          if (belongsToTenant(data)) {
            list.push({ ...data, id: d.id });
          }
        });
        list.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
        setCompanyHolidays(list);
        try { localStorage.setItem(`worknest_holidays_${activeTenant}`, JSON.stringify(list)); } catch {}
      }, () => {});

      return () => {
        unsubEmp();
        unsubDept();
        unsubBranches();
        unsubBranchesSettings();
        unsubShifts();
        unsubRoster();
        unsubLeaves();
        unsubMsg();
        unsubDevices();
        unsubCandidates();
        unsubAttReqs();
        unsubRuns();
        unsubAdmins();
        unsubWorkflows();
        unsubDocs();
        unsubAudits();
        unsubAdvances();
        unsubPerfCycles();
        unsubPerfGoals();
        unsubPerfAppraisals();
        unsubExpenses();
        unsubOnboarding();
        unsubOffboarding();
        unsubWorkforcePlans();
        unsubMovements();
        unsubAnnouncements();
        unsubRecognitions();
        unsubFeedback();
        unsubSurveys();
        unsubTrainingCourses();
        unsubTrainingEnrollments();
        unsubEmployeeSkills();
        unsubPositionSkills();
        unsubCareerPathways();
        unsubCareerPlans();
        unsubTalentProfiles();
        unsubSuccessionPlans();
        unsubGlobalEntities();
        unsubCountryHolidays();
        unsubCountryPayroll();
        unsubCustomRoles();
        unsubSecSessions();
        unsubSecPolicy();
        unsubCompanyHolidays();
      };
    } catch (err) {
      console.warn('Firestore real-time subscriptions setup error:', err);
    }
  }, [firebaseConnected, currentCompanyId, isAuthenticated, isEmployeeAuthenticated, currentEmployee?.id, currentEmployee?.companyId, currentEmployee?.isManager]);

  // =========================================================================
  // PHASE 1: ENTERPRISE AUDIT LOG ENGINE
  // =========================================================================
  const recordAuditLog = async (entry: {
    action: string;
    category: AuditLogCategory;
    targetType: string;
    targetId: string;
    targetName: string;
    summary: string;
    beforeValue?: any;
    afterValue?: any;
  }) => {
    try {
      const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
        ? currentEmployee.companyId
        : (currentCompanyId || 'default');
      const actorId = currentUser?.id || currentEmployee?.employeeId || currentEmployee?.id || 'system';
      const actorName = currentUser?.name || currentEmployee?.name || 'System';
      const actorEmail = currentUser?.email || currentEmployee?.email || 'employee@worknest.com';
      const actorRole = currentUser?.role || (currentEmployee?.isManager ? 'Manager (Employee)' : currentEmployee ? 'Employee' : 'Admin');
      const nowIso = new Date().toISOString();
      const logId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const fullEntry: AuditLogEntry = {
        id: logId,
        action: entry.action,
        category: entry.category,
        actorId,
        actorName,
        actorEmail,
        actorRole,
        targetType: entry.targetType,
        targetId: entry.targetId,
        targetName: entry.targetName,
        summary: entry.summary,
        ...(entry.beforeValue !== undefined ? { beforeValue: entry.beforeValue } : {}),
        ...(entry.afterValue !== undefined ? { afterValue: entry.afterValue } : {}),
        timestamp: nowIso,
        companyId: activeComp,
      };

      setAuditLogs(prev => [fullEntry, ...prev].slice(0, 500));
      await syncRecordToFirestore('audit_logs', logId, fullEntry, activeComp);
    } catch (err) {
      console.warn('Audit log write warning:', err);
    }
  };

  // Auth functions with Firebase Authentication integration + Phase 5 Rate Limiting & Device Session Tracking
  const login = async (email: string, _password: string): Promise<boolean> => {
    const cleanId = email.trim().toLowerCase();
    const maxAttempts = tenantSecurityPolicy?.maxFailedLoginAttempts || 5;
    const lockoutMins = tenantSecurityPolicy?.lockoutDurationMinutes || 15;
    const rateCheck = checkLoginRateLimit(`admin:${cleanId}`, maxAttempts, lockoutMins);
    if (!rateCheck.allowed) {
      await recordAuditLog({
        action: 'ADMIN_LOGIN_RATE_LIMITED',
        category: 'security',
        targetType: 'SecurityRateLimiter',
        targetId: cleanId,
        targetName: cleanId,
        summary: `Blocked admin sign-in attempt for ${cleanId} due to rate limit lockout (${rateCheck.retryAfterSeconds}s remaining).`,
      });
      return false;
    }

    try {
      const { authenticateAdminUser } = await import('../lib/authService');
      const res = await authenticateAdminUser(email, _password);
      if (res.success && res.user) {
        recordLoginAttemptResult(`admin:${cleanId}`, true, maxAttempts, lockoutMins);
        const { password: _omitted, ...safeUser } = res.user;
        const resolvedComp = safeUser.companyId || currentCompanyId || 'default';
        const devMeta = getClientDeviceMetadata();
        const sessionId = `sess_adm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const nowIso = new Date().toISOString();

        const sessionRec: SecuritySessionRecord = {
          id: sessionId,
          actorId: safeUser.id || safeUser.email,
          actorName: safeUser.name,
          actorEmail: safeUser.email,
          actorRole: safeUser.role || 'Admin',
          portalType: 'admin',
          deviceSummary: devMeta.deviceSummary,
          browserName: devMeta.browserName,
          osName: devMeta.osName,
          ipAddressHint: 'Verified Client Session',
          timezone: devMeta.timezone,
          mfaVerified: Boolean(safeUser.mfaEnabled),
          status: 'active',
          loginAt: nowIso,
          lastActiveAt: nowIso,
          companyId: resolvedComp,
        };

        setIsAuthenticated(true);
        setIsEmployeeAuthenticated(false);
        setCurrentEmployee(null);
        setCurrentUser(safeUser);
        setSecuritySessions(prev => [sessionRec, ...prev].slice(0, 200));

        try {
          localStorage.removeItem('worknest_employee_logged_in');
          localStorage.removeItem('worknest_employee_user');
          localStorage.setItem('worknest_admin_logged_in', 'true');
          localStorage.setItem('worknest_admin_user', JSON.stringify(safeUser));
          localStorage.setItem('worknest_active_session_id', sessionId);
          window.dispatchEvent(new Event('storage'));
        } catch {}

        await syncRecordToFirestore('security_sessions', sessionId, sessionRec, resolvedComp);
        await syncRecordToFirestore('audit_logs', `audit_login_${Date.now()}`, {
          id: `audit_login_${Date.now()}`,
          action: 'ADMIN_LOGIN',
          category: 'security',
          severity: 'info',
          actorId: safeUser.id || safeUser.email,
          actorName: safeUser.name,
          actorEmail: safeUser.email,
          actorRole: safeUser.role || 'Admin',
          targetType: 'Session',
          targetId: sessionId,
          targetName: `${safeUser.name} (${devMeta.deviceSummary})`,
          summary: `Admin ${safeUser.name} (${safeUser.role}) signed in from ${devMeta.deviceSummary} (${devMeta.timezone}).`,
          deviceSummary: devMeta.deviceSummary,
          timestamp: nowIso,
          companyId: resolvedComp,
        }, resolvedComp);
        return true;
      }

      const failState = recordLoginAttemptResult(`admin:${cleanId}`, false, maxAttempts, lockoutMins);
      await syncRecordToFirestore('audit_logs', `audit_login_fail_${Date.now()}`, {
        id: `audit_login_fail_${Date.now()}`,
        action: failState.locked ? 'ADMIN_LOGIN_LOCKOUT_TRIGGERED' : 'ADMIN_LOGIN_FAILED',
        category: 'security',
        severity: failState.locked ? 'critical' : 'warning',
        actorId: cleanId,
        actorName: cleanId,
        actorEmail: cleanId,
        actorRole: 'Unverified',
        targetType: 'Session',
        targetId: cleanId,
        targetName: cleanId,
        summary: `Failed admin sign-in attempt #${failState.attempts} for ${cleanId}${failState.locked ? ' (Account temporarily rate-limited)' : ''}.`,
        timestamp: new Date().toISOString(),
        companyId: currentCompanyId || 'default',
      }, currentCompanyId || 'default');
      return false;
    } catch (e) {
      console.error('Login auth error:', e);
      return false;
    }
  };

  const logout = () => {
    if (currentUser) {
      recordAuditLog({
        action: 'ADMIN_LOGOUT',
        category: 'security',
        targetType: 'Session',
        targetId: currentUser.id || currentUser.email,
        targetName: currentUser.name,
        summary: `Admin ${currentUser.name} signed out.`,
      }).catch(() => {});
    }
    setIsAuthenticated(false);
    setIsEmployeeAuthenticated(false);
    setCurrentUser(null);
    setCurrentEmployee(null);
    setEmployees([]);
    setDepartments([]);
    setShifts([]);
    setRoster([]);
    setLeaveRequests([]);
    setMessages([]);
    setDevices([]);
    setCandidates([]);
    setAttendanceRequests([]);
    setMonthlyPayrollRuns({});
    setAdminAccounts([]);
    try {
      signOut(getFirebaseInstance().auth).catch(() => {});
      localStorage.removeItem('worknest_admin_logged_in');
      localStorage.removeItem('worknest_admin_user');
      localStorage.removeItem('worknest_employee_logged_in');
      localStorage.removeItem('worknest_employee_user');
      localStorage.removeItem('worknest_active_company_id');
      localStorage.removeItem('worknest_current_company');
      window.dispatchEvent(new Event('storage'));
    } catch {}
  };

  const loginEmployee = async (employeeId: string, password: string): Promise<boolean> => {
    try {
      const res = await authenticateEmployeeUser(employeeId, password, currentCompanyId);
      if (res.success && res.employee) {
        const { password: _omitted, ...safeEmp } = res.employee;
        const verifiedEmployee: Employee = {
          ...safeEmp,
          companyId: safeEmp.companyId || currentCompanyId || 'default'
        };
        setIsEmployeeAuthenticated(true);
        setIsAuthenticated(false);
        setCurrentUser(null);
        setCurrentEmployee(verifiedEmployee);
        try {
          localStorage.removeItem('worknest_admin_logged_in');
          localStorage.removeItem('worknest_admin_user');
          localStorage.setItem('worknest_employee_logged_in', 'true');
          localStorage.setItem('worknest_employee_user', JSON.stringify(verifiedEmployee));
          window.dispatchEvent(new Event('storage'));
        } catch {}
        await syncRecordToFirestore('audit_logs', `audit_emplogin_${Date.now()}`, {
          id: `audit_emplogin_${Date.now()}`,
          action: 'EMPLOYEE_LOGIN',
          category: 'security',
          actorId: verifiedEmployee.employeeId || verifiedEmployee.id,
          actorName: verifiedEmployee.name,
          actorEmail: verifiedEmployee.email || `${verifiedEmployee.employeeId}@emp`,
          actorRole: verifiedEmployee.isManager ? 'Manager (Employee)' : 'Employee',
          targetType: 'EmployeeSession',
          targetId: verifiedEmployee.employeeId || verifiedEmployee.id,
          targetName: verifiedEmployee.name,
          summary: `Employee ${verifiedEmployee.name} (${verifiedEmployee.employeeId}) signed into Employee Self-Service Portal.`,
          timestamp: new Date().toISOString(),
          companyId: verifiedEmployee.companyId || 'default',
        }, verifiedEmployee.companyId || 'default');
        return true;
      }
      return false;
    } catch (err) {
      console.error('Employee login error:', err);
      return false;
    }
  };

  const logoutEmployee = () => {
    setIsEmployeeAuthenticated(false);
    setCurrentEmployee(null);
    try {
      signOut(getFirebaseInstance().auth).catch(() => {});
      localStorage.removeItem('worknest_employee_logged_in');
      localStorage.removeItem('worknest_employee_user');
      window.dispatchEvent(new Event('storage'));
    } catch {}
  };

  const updateAdminProfile = async (data: { name: string; email: string; username?: string; password?: string; avatar?: string }) => {
    if (data.password) {
      await changeAdminPassword(data.password, data.email || currentUser?.email);
    }
    const { password: _omitted, ...safeProfileUpdates } = data;
    setCurrentUser(prev => {
      const updated = prev ? { ...prev, ...safeProfileUpdates } : null;
      if (updated) {
        try { localStorage.setItem('worknest_admin_user', JSON.stringify(updated)); } catch {}
      }
      return updated;
    });
  };

  const addAdminAccount = async (acc: Omit<AdminAccount, 'id' | 'createdAt'>): Promise<string> => {
    const cleanEmail = acc.email.trim().toLowerCase();
    const id = `admin_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
    const newAdmin: AdminAccount = {
      ...acc,
      id,
      email: cleanEmail,
      companyId: acc.companyId || currentCompanyId || 'default',
      isSuperAdmin: false,
      isPrimarySuperAdmin: false,
      isTenantOwner: false,
      createdAt: new Date().toISOString()
    };
    setAdminAccounts(prev => [...prev.filter(a => a.id !== id && a.email?.toLowerCase() !== cleanEmail), newAdmin]);
    await syncRecordToFirestore('admins', id, newAdmin, currentCompanyId);
    if (acc.password) {
      await provisionAdminAuthAccount(newAdmin, acc.password);
    }
    await recordAuditLog({
      action: 'ADMIN_ROLE_CREATED',
      category: 'role_permission',
      targetType: 'AdminAccount',
      targetId: id,
      targetName: newAdmin.name,
      summary: `Created admin/supervisor account ${newAdmin.name} (${newAdmin.email}) with role ${newAdmin.role}`,
      afterValue: { role: newAdmin.role, assignedDepartment: newAdmin.assignedDepartment, permissions: newAdmin.permissions },
    });
    return id;
  };

  const updateAdminAccount = async (id: string, updates: Partial<AdminAccount>) => {
    const targetAdmin = adminAccounts.find(a => a.id === id);
    const safeUpdates = { ...updates, isSuperAdmin: false, isPrimarySuperAdmin: false };
    setAdminAccounts(prev => prev.map(a => a.id === id ? { ...a, ...safeUpdates } : a));
    await syncRecordToFirestore('admins', id, safeUpdates, currentCompanyId);
    if (targetAdmin?.email) {
      try {
        const { db } = getFirebaseInstance();
        const q = query(collection(db, 'admins'), where('email', '==', targetAdmin.email.trim().toLowerCase()));
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          if (d.id !== id) {
            await syncRecordToFirestore('admins', d.id, safeUpdates, currentCompanyId);
          }
        }
      } catch {}
    }
    if (updates.password && targetAdmin) {
      await provisionAdminAuthAccount({ ...targetAdmin, ...safeUpdates }, updates.password);
    }
    await recordAuditLog({
      action: 'ADMIN_ROLE_UPDATED',
      category: 'role_permission',
      targetType: 'AdminAccount',
      targetId: id,
      targetName: targetAdmin?.name || id,
      summary: `Updated role/permissions for ${targetAdmin?.name || id}`,
      beforeValue: targetAdmin ? { role: targetAdmin.role, status: targetAdmin.status, assignedDepartment: targetAdmin.assignedDepartment, permissions: targetAdmin.permissions } : undefined,
      afterValue: { role: updates.role || targetAdmin?.role, status: updates.status || targetAdmin?.status, assignedDepartment: updates.assignedDepartment ?? targetAdmin?.assignedDepartment, permissions: updates.permissions || targetAdmin?.permissions },
    });
  };

  const deleteAdminAccount = async (id: string) => {
    const targetAdmin = adminAccounts.find(a => a.id === id);
    const targetEmail = targetAdmin?.email?.trim().toLowerCase();
    setAdminAccounts(prev => prev.filter(a => a.id !== id && (!targetEmail || a.email?.toLowerCase() !== targetEmail)));
    await deleteRecordFromFirestore('admins', id);
    if (targetEmail) {
      try {
        const { db } = getFirebaseInstance();
        const q = query(collection(db, 'admins'), where('email', '==', targetEmail));
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          await deleteRecordFromFirestore('admins', d.id);
        }
      } catch {}
    }
    await recordAuditLog({
      action: 'ADMIN_ROLE_DELETED',
      category: 'role_permission',
      targetType: 'AdminAccount',
      targetId: id,
      targetName: targetAdmin?.name || id,
      summary: `Deleted admin account ${targetAdmin?.name || id} (${targetEmail || ''})`,
      beforeValue: targetAdmin ? { email: targetAdmin.email, role: targetAdmin.role } : undefined,
    });
  };

  const updateEmployeeCredentials = async (id: string, data: { password?: string; email?: string; phone?: string }) => {
    const targetCompId = currentEmployee?.companyId || currentCompanyId || 'default';
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, ...data } : e));
    if (currentEmployee?.id === id) {
      const { password: _omitted, ...safeCredUpdates } = data;
      setCurrentEmployee(prev => {
        const next = prev ? { ...prev, ...safeCredUpdates } : null;
        if (next) {
          try { localStorage.setItem('worknest_employee_user', JSON.stringify(next)); } catch {}
        }
        return next;
      });
    }
    await syncRecordToFirestore('employees', id, data, targetCompId);
    if (data.password) {
      const empObj = employees.find(e => e.id === id) || currentEmployee;
      if (empObj) {
        await provisionEmployeeAuthAccount(
          { id: empObj.id, employeeId: empObj.employeeId || empObj.id, name: empObj.name, companyId: empObj.companyId || targetCompId },
          data.password
        );
      }
    }
  };

  // Connect / Disconnect Firebase dynamically
  const connectFirebase = async (newConfig?: FirebaseConfigType): Promise<boolean> => {
    const configToUse = newConfig || activeFirebaseConfig || DEFAULT_FIREBASE_CONFIG;
    setFirebaseSyncing(true);
    const res = await reconfigureFirebase(configToUse);
    setFirebaseSyncing(false);
    if (res.success) {
      setActiveFirebaseConfig(configToUse);
      saveStoredFirebaseConfig(configToUse);
      setFirebaseConnected(true);
      setLastSyncTime(new Date());
      return true;
    }
    return false;
  };

  const disconnectFirebase = () => {
    setFirebaseConnected(false);
    setLastSyncTime(null);
  };

  const manualSync = async (): Promise<boolean> => {
    setFirebaseSyncing(true);
    try {
      // Sync all current in-memory items to Firestore
      for (const e of employees) await syncRecordToFirestore('employees', e.id, e);
      for (const d of departments) await syncRecordToFirestore('departments', d.id, d);
      for (const s of shifts) await syncRecordToFirestore('shifts', s.id, s);
      for (const r of roster) await syncRecordToFirestore('roster', r.id, r);
      for (const l of leaveRequests) await syncRecordToFirestore('leaveRequests', l.id, l);
      setLastSyncTime(new Date());
      setFirebaseSyncing(false);
      return true;
    } catch {
      setFirebaseSyncing(false);
      return false;
    }
  };

  const toggleLiveSync = () => {
    setLiveSyncEnabled(prev => !prev);
  };

  const unmarkDataWiped = () => {
    // nothing needed
  };

  // Reset / Purge all data
  const resetAllData = async () => {
    // 1. Wipe Firestore for this tenant
    await clearFirestoreAllData(currentCompanyId || 'default');
    // 2. Wipe React state to zero
    setEmployees([]);
    setDepartments([]);
    setShifts([]);
    setRoster([]);
    setLeaveRequests([]);
    setMessages([]);
    setNotifications([]);
  };

  const importBackupData = async (backupObj: any): Promise<{ success: boolean; count: number }> => {
    try {
      let count = 0;
      if (backupObj.employees && Array.isArray(backupObj.employees)) {
        for (const emp of backupObj.employees) {
          const empId = emp.id || emp.employeeId || `WNH-${Date.now().toString().slice(-4)}`;
          const fullEmp = { ...emp, id: empId, employeeId: empId };
          await syncRecordToFirestore('employees', empId, fullEmp);
          count++;
        }
        setEmployees(backupObj.employees);
      }
      if (backupObj.departments && Array.isArray(backupObj.departments)) {
        for (const dept of backupObj.departments) {
          const deptId = dept.id || dept.code || `DEPT-${Date.now().toString().slice(-4)}`;
          await syncRecordToFirestore('departments', deptId, dept);
          count++;
        }
        setDepartments(backupObj.departments);
      }
      if (backupObj.shifts && Array.isArray(backupObj.shifts)) {
        for (const s of backupObj.shifts) {
          const sId = s.id || s.name || `shift-${Date.now().toString().slice(-4)}`;
          await syncRecordToFirestore('shifts', sId, s);
          count++;
        }
        setShifts(backupObj.shifts);
      }
      if (backupObj.leaveRequests && Array.isArray(backupObj.leaveRequests)) {
        for (const l of backupObj.leaveRequests) {
          const lId = l.id || `leave_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          await syncRecordToFirestore('leaveRequests', lId, l);
          count++;
        }
        setLeaveRequests(backupObj.leaveRequests);
      }
      setLastSyncTime(new Date());
      return { success: true, count };
    } catch (err) {
      console.error('Import backup data error:', err);
      return { success: false, count: 0 };
    }
  };

  // Notifications
  const unreadNotificationCount = notifications.filter(n => !n.read).length;
  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };
  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };
  const addNotification = (n: Omit<Notification, 'id' | 'time'>) => {
    const newNotif: Notification = {
      ...n,
      id: Date.now().toString(),
      time: 'Just now'
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  // Messages
  const unreadMessageCount = messages.filter(m => m.unread).length;
  const markMessageRead = async (id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, unread: false } : m));
    await syncRecordToFirestore('messages', id, { unread: false });
  };
  const sendMessage = async (toOrMsg: string | Partial<Message>, subject?: string, content?: string) => {
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let newMsg: Message;
    if (typeof toOrMsg === 'object') {
      const bodyText = toOrMsg.content || toOrMsg.preview || '';
      newMsg = {
        ...toOrMsg,
        id: msgId,
        companyId: toOrMsg.companyId || currentCompanyId || 'default',
        from: toOrMsg.from || (currentEmployee ? currentEmployee.name : (currentUser?.name || 'HR Admin')),
        fromAvatar: toOrMsg.fromAvatar || (currentEmployee ? (currentEmployee.avatar || '👤') : (currentUser?.avatar || '👨‍💼')),
        fromEmployeeId: toOrMsg.fromEmployeeId || (currentEmployee ? currentEmployee.id : 'admin'),
        to: toOrMsg.to || 'General',
        toEmployeeId: toOrMsg.toEmployeeId,
        subject: toOrMsg.subject || 'Message',
        preview: toOrMsg.preview || (bodyText.length > 50 ? bodyText.slice(0, 50) + '...' : bodyText),
        content: bodyText,
        time: toOrMsg.time || nowTimeStr,
        unread: toOrMsg.unread ?? true,
        createdAt: toOrMsg.createdAt || nowIso,
      };
    } else {
      const bodyText = content || '';
      newMsg = {
        id: msgId,
        companyId: currentCompanyId || 'default',
        from: currentEmployee ? currentEmployee.name : (currentUser?.name || 'HR Admin'),
        fromAvatar: currentEmployee ? (currentEmployee.avatar || '👤') : (currentUser?.avatar || '👨‍💼'),
        fromEmployeeId: currentEmployee ? currentEmployee.id : 'admin',
        to: toOrMsg,
        subject: subject || 'General Query',
        preview: bodyText.length > 50 ? bodyText.substring(0, 50) + '...' : bodyText,
        content: bodyText,
        time: nowTimeStr,
        unread: true,
        createdAt: nowIso,
      };
    }
    setMessages(prev => [newMsg, ...prev]);
    await syncRecordToFirestore('messages', msgId, newMsg, currentCompanyId);

    // In-app notification for the message
    if (currentEmployee) {
      addNotification({
        title: `Message from ${newMsg.from}`,
        message: `${newMsg.subject}: ${newMsg.preview}`,
        read: false,
        type: 'system',
        targetPage: 'messaging',
      });
    } else {
      addNotification({
        title: `Message from HR`,
        message: `${newMsg.subject}: ${newMsg.preview}`,
        read: false,
        type: 'system',
        targetPage: 'messaging',
        forEmployeeId: newMsg.toEmployeeId,
      });
    }
  };
  const deleteMessage = async (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
    await deleteRecordFromFirestore('messages', id);
  };

  // Employees: Add, Update, Delete with instant Firestore Sync
  const addEmployee = async (e: Omit<Employee, 'id'>) => {
    const cleanCode = e.employeeId ? e.employeeId.trim() : `WNH-${Date.now().toString().slice(-4)}`;
    const activeComp = currentCompanyId || 'default';
    const docId = (activeComp !== 'default' && !cleanCode.startsWith(`${activeComp}_`))
      ? `${activeComp}_${cleanCode}`
      : cleanCode;
    const resolvedBranch = (e.branch || '').trim() || (activeBranch && activeBranch.toLowerCase() !== 'all' ? activeBranch : headOfficeBranchName);
    const matchedBranchObj = branches.find(b => b.name.toLowerCase() === resolvedBranch.toLowerCase());
    const todayIso = new Date().toISOString().split('T')[0];
    const currentMonthStart = `${todayIso.slice(0, 7)}-01`;
    const initialEffectiveFrom = (e.joinDate && /^\d{4}-\d{2}-\d{2}$/.test(e.joinDate.trim()))
      ? (e.joinDate.trim() <= currentMonthStart ? e.joinDate.trim() : currentMonthStart)
      : currentMonthStart;
    const matchedInitialShift = e.shift
      ? shifts.find(s => (s.name || '').trim().toLowerCase() === e.shift.trim().toLowerCase() || s.id === e.shift.trim())
      : undefined;
    const initialShiftHistory: ShiftAssignmentRecord[] =
      Array.isArray(e.shiftHistory) && e.shiftHistory.length > 0
        ? e.shiftHistory
        : e.shift && e.shift.trim()
        ? [
            {
              id: `sh_${Date.now()}`,
              employeeId: cleanCode,
              employeeName: e.name,
              shiftId: matchedInitialShift?.id,
              shiftName: matchedInitialShift?.name || e.shift.trim(),
              effectiveFrom: initialEffectiveFrom,
              effectiveTo: null,
              assignedAt: new Date().toISOString(),
              note: 'Initial shift assignment',
              ...(matchedInitialShift
                ? {
                    startTime: matchedInitialShift.startTime,
                    endTime: matchedInitialShift.endTime,
                    graceTime: matchedInitialShift.graceTime,
                    breakTime: matchedInitialShift.breakTime,
                    totalHours: matchedInitialShift.totalHours,
                    type: matchedInitialShift.type,
                    latePolicyEnabled: matchedInitialShift.latePolicyEnabled,
                    latePenaltyMode: matchedInitialShift.latePenaltyMode,
                    earlyOutPolicyEnabled: matchedInitialShift.earlyOutPolicyEnabled,
                    earlyOutTolerance: matchedInitialShift.earlyOutTolerance,
                    overtimePolicyEnabled: matchedInitialShift.overtimePolicyEnabled,
                    minOvertimeMinutes: matchedInitialShift.minOvertimeMinutes,
                    maxOvertimeHours: matchedInitialShift.maxOvertimeHours,
                    halfDayMinHours: matchedInitialShift.halfDayMinHours,
                  }
                : {}),
            },
          ]
        : [];
    const newEmp: Employee = {
      ...e,
      id: docId,
      employeeId: cleanCode,
      shiftHistory: initialShiftHistory,
      branch: resolvedBranch,
      branchId: e.branchId || matchedBranchObj?.id || 'BR-HQ',
      companyId: activeComp
    };
    setEmployees(prev => [...prev, newEmp]);
    await syncRecordToFirestore('employees', docId, newEmp, activeComp);
    await provisionEmployeeAuthAccount(
      { id: docId, employeeId: cleanCode, name: newEmp.name, companyId: activeComp, isManager: newEmp.isManager, department: newEmp.department },
      newEmp.password || '123456'
    );
    await recordAuditLog({
      action: 'EMPLOYEE_CREATED',
      category: 'employee',
      targetType: 'Employee',
      targetId: cleanCode,
      targetName: newEmp.name,
      summary: `Created employee ${newEmp.name} (${cleanCode}) in ${newEmp.department}`,
      afterValue: { employeeId: cleanCode, name: newEmp.name, department: newEmp.department, designation: newEmp.designation, shift: newEmp.shift, grossSalary: newEmp.grossSalary, isManager: newEmp.isManager, managerId: newEmp.managerId },
    });
  };
  const updateEmployee = async (id: string, e: Partial<Employee>) => {
    const targetEmp = allEmployees.find(emp => emp.id === id) || employees.find(emp => emp.id === id);
    const finalUpdates: Partial<Employee> = { ...e };

    // Safety guard: if shift is being changed without an explicit shiftHistory update,
    // automatically preserve the previous shift period up to yesterday and start the new shift from today
    // so historical attendance is never altered by a direct profile shift edit.
    if (
      targetEmp &&
      e.shift !== undefined &&
      e.shift.trim() !== (targetEmp.shift || '').trim() &&
      e.shiftHistory === undefined
    ) {
      const todayIso = new Date().toISOString().split('T')[0];
      const yesterdayDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const existingHistory = Array.isArray(targetEmp.shiftHistory) ? [...targetEmp.shiftHistory] : [];
      const newShiftName = e.shift.trim();
      const prevShiftObj = targetEmp.shift
        ? shifts.find(s => (s.name || '').trim().toLowerCase() === targetEmp.shift.trim().toLowerCase() || s.id === targetEmp.shift.trim())
        : undefined;
      const nextShiftObj = newShiftName
        ? shifts.find(s => (s.name || '').trim().toLowerCase() === newShiftName.toLowerCase() || s.id === newShiftName)
        : undefined;

      if (existingHistory.length === 0 && targetEmp.shift && targetEmp.shift.trim()) {
        const prevStart =
          targetEmp.joinDate && /^\d{4}-\d{2}-\d{2}$/.test(targetEmp.joinDate.trim()) && targetEmp.joinDate.trim() < todayIso
            ? targetEmp.joinDate.trim()
            : `${todayIso.slice(0, 7)}-01` < todayIso
            ? `${todayIso.slice(0, 7)}-01`
            : yesterdayDate;
        existingHistory.push({
          id: `sh_prev_${Date.now()}`,
          employeeId: targetEmp.employeeId || targetEmp.id,
          employeeName: targetEmp.name,
          shiftId: prevShiftObj?.id,
          shiftName: prevShiftObj?.name || targetEmp.shift.trim(),
          effectiveFrom: prevStart,
          effectiveTo: yesterdayDate >= prevStart ? yesterdayDate : prevStart,
          assignedAt: new Date().toISOString(),
          note: 'Auto-preserved previous shift',
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
      } else if (existingHistory.length > 0) {
        // Close any currently open assignment that started before today and lock in its shift timing snapshot
        for (let i = 0; i < existingHistory.length; i++) {
          const item = existingHistory[i];
          if (!item.effectiveTo && item.effectiveFrom < todayIso) {
            const itemShiftObj = shifts.find(
              s => (s.name || '').trim().toLowerCase() === (item.shiftName || '').trim().toLowerCase() || (item.shiftId && s.id === item.shiftId)
            );
            existingHistory[i] = {
              ...item,
              effectiveTo: yesterdayDate >= item.effectiveFrom ? yesterdayDate : item.effectiveFrom,
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
            };
          }
        }
      }

      if (newShiftName) {
        const sameDayIdx = existingHistory.findIndex(h => h.effectiveFrom === todayIso);
        const newEntry: ShiftAssignmentRecord = {
          id: `sh_${Date.now()}`,
          employeeId: targetEmp.employeeId || targetEmp.id,
          employeeName: e.name || targetEmp.name,
          shiftId: nextShiftObj?.id,
          shiftName: nextShiftObj?.name || newShiftName,
          effectiveFrom: todayIso,
          effectiveTo: null,
          assignedAt: new Date().toISOString(),
          note: 'Updated from employee profile',
          ...(nextShiftObj
            ? {
                startTime: nextShiftObj.startTime,
                endTime: nextShiftObj.endTime,
                graceTime: nextShiftObj.graceTime,
                breakTime: nextShiftObj.breakTime,
                totalHours: nextShiftObj.totalHours,
                type: nextShiftObj.type,
                latePolicyEnabled: nextShiftObj.latePolicyEnabled,
                latePenaltyMode: nextShiftObj.latePenaltyMode,
                earlyOutPolicyEnabled: nextShiftObj.earlyOutPolicyEnabled,
                earlyOutTolerance: nextShiftObj.earlyOutTolerance,
                overtimePolicyEnabled: nextShiftObj.overtimePolicyEnabled,
                minOvertimeMinutes: nextShiftObj.minOvertimeMinutes,
                maxOvertimeHours: nextShiftObj.maxOvertimeHours,
                halfDayMinHours: nextShiftObj.halfDayMinHours,
              }
            : {}),
        };
        if (sameDayIdx >= 0) {
          existingHistory[sameDayIdx] = newEntry;
        } else {
          existingHistory.push(newEntry);
        }
      }
      finalUpdates.shiftHistory = existingHistory;
    }

    setEmployees(prev => prev.map(emp => emp.id === id ? { ...emp, ...finalUpdates } : emp));
    if (currentEmployee && (currentEmployee.id === id || currentEmployee.employeeId === id)) {
      const updatedCurr = { ...currentEmployee, ...finalUpdates };
      setCurrentEmployee(updatedCurr);
      try {
        localStorage.setItem('worknest_employee_user', JSON.stringify(updatedCurr));
      } catch {}
    }
    await syncRecordToFirestore('employees', id, finalUpdates, currentCompanyId);
    if ((e.password || e.isManager !== undefined || e.department !== undefined) && targetEmp) {
      await provisionEmployeeAuthAccount(
        {
          id: targetEmp.id,
          employeeId: e.employeeId || targetEmp.employeeId || targetEmp.id,
          name: e.name || targetEmp.name,
          companyId: targetEmp.companyId || currentCompanyId || 'default',
          isManager: e.isManager ?? targetEmp.isManager,
          department: e.department ?? targetEmp.department,
        },
        e.password || targetEmp.password || '123456'
      );
    }
    await recordAuditLog({
      action: 'EMPLOYEE_UPDATED',
      category: 'employee',
      targetType: 'Employee',
      targetId: targetEmp?.employeeId || id,
      targetName: e.name || targetEmp?.name || id,
      summary: `Updated employee profile for ${e.name || targetEmp?.name || id}`,
      beforeValue: targetEmp ? { department: targetEmp.department, designation: targetEmp.designation, shift: targetEmp.shift, status: targetEmp.status, grossSalary: targetEmp.grossSalary, isManager: targetEmp.isManager, managerId: targetEmp.managerId } : undefined,
      afterValue: { department: finalUpdates.department ?? targetEmp?.department, designation: finalUpdates.designation ?? targetEmp?.designation, shift: finalUpdates.shift ?? targetEmp?.shift, status: finalUpdates.status ?? targetEmp?.status, grossSalary: finalUpdates.grossSalary ?? targetEmp?.grossSalary, isManager: finalUpdates.isManager ?? targetEmp?.isManager, managerId: finalUpdates.managerId ?? targetEmp?.managerId },
    });

    // Phase 3: Automatically log Employee Movement History if department, designation, branch, salary, or manager changed
    if (targetEmp) {
      const deptChanged = e.department !== undefined && e.department.trim() !== (targetEmp.department || '').trim();
      const desigChanged = e.designation !== undefined && e.designation.trim() !== (targetEmp.designation || '').trim();
      const branchChanged = e.branch !== undefined && e.branch.trim() !== (targetEmp.branch || '').trim();
      const salaryChanged = e.grossSalary !== undefined && Number(e.grossSalary) !== Number(targetEmp.grossSalary || 0);
      const mgrChanged = e.managerId !== undefined && (e.managerId || '') !== (targetEmp.managerId || '');

      if (deptChanged || desigChanged || branchChanged || salaryChanged || mgrChanged) {
        const activeComp = targetEmp.companyId || currentCompanyId || 'default';
        const movId = `mov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const movementType: EmployeeMovementType =
          desigChanged && salaryChanged && Number(e.grossSalary) > Number(targetEmp.grossSalary || 0)
            ? 'promotion'
            : deptChanged
            ? 'department_transfer'
            : branchChanged
            ? 'branch_transfer'
            : desigChanged
            ? 'designation_change'
            : salaryChanged
            ? 'salary_revision'
            : 'manager_reassignment';

        const movRecord: EmployeeMovementRecord = {
          id: movId,
          employeeId: targetEmp.id,
          employeeCode: targetEmp.employeeId || targetEmp.id,
          employeeName: e.name || targetEmp.name,
          movementType,
          effectiveDate: new Date().toISOString().split('T')[0],
          fromDepartment: targetEmp.department,
          toDepartment: e.department ?? targetEmp.department,
          fromDesignation: targetEmp.designation,
          toDesignation: e.designation ?? targetEmp.designation,
          fromBranch: getEmployeeBranch(targetEmp),
          toBranch: e.branch ?? getEmployeeBranch(targetEmp),
          fromSalary: Number(targetEmp.grossSalary || 0),
          toSalary: Number(e.grossSalary ?? targetEmp.grossSalary ?? 0),
          fromManagerName: targetEmp.managerName || '—',
          toManagerName: e.managerName ?? targetEmp.managerName ?? '—',
          reason: 'Updated via Employee Profile / HR Action',
          recordedBy: currentUser?.name || 'HR Admin',
          createdAt: new Date().toISOString(),
          companyId: activeComp,
        };
        setEmployeeMovements(prev => {
          const next = [movRecord, ...prev];
          try { localStorage.setItem(`worknest_employee_movements_${activeComp}`, JSON.stringify(next)); } catch {}
          return next;
        });
        await syncRecordToFirestore('employee_movements', movId, movRecord, activeComp);
      }
    }
  };
  const deleteEmployee = async (id: string) => {
    const targetEmp = allEmployees.find(emp => emp.id === id) || employees.find(emp => emp.id === id);
    setEmployees(prev => prev.filter(emp => emp.id !== id));
    await deleteRecordFromFirestore('employees', id);
    await recordAuditLog({
      action: 'EMPLOYEE_DELETED',
      category: 'employee',
      targetType: 'Employee',
      targetId: targetEmp?.employeeId || id,
      targetName: targetEmp?.name || id,
      summary: `Deleted employee ${targetEmp?.name || id} (${targetEmp?.employeeId || id})`,
      beforeValue: targetEmp ? { employeeId: targetEmp.employeeId, name: targetEmp.name, department: targetEmp.department } : undefined,
    });
  };

  // Departments: Add, Update, Delete with instant Firestore Sync
  const addDepartment = async (d: Omit<Department, 'id'>) => {
    const newId = d.code ? d.code.trim().toUpperCase() : `DEPT-${Date.now().toString().slice(-4)}`;
    const newDept: Department = { ...d, id: newId, companyId: currentCompanyId || 'default' };
    setDepartments(prev => [...prev, newDept]);
    await syncRecordToFirestore('departments', newId, newDept, currentCompanyId);
  };
  const updateDepartment = async (id: string, d: Partial<Department>) => {
    const oldDept = departments.find(dep => dep.id === id);
    const cleanUpdates = { ...d, ...(d.name ? { name: d.name.trim() } : {}) };
    setDepartments(prev => prev.map(dep => dep.id === id ? { ...dep, ...cleanUpdates } : dep));
    await syncRecordToFirestore('departments', id, cleanUpdates, currentCompanyId);

    // If department name was changed, cascade the new name to all employees in that department
    if (oldDept && cleanUpdates.name && oldDept.name.trim().toLowerCase() !== cleanUpdates.name.toLowerCase()) {
      const oldNameLower = oldDept.name.trim().toLowerCase();
      const oldCodeLower = (oldDept.code || '').trim().toLowerCase();
      const affectedEmployees = employees.filter(emp => {
        const empDeptLower = (emp.department || '').trim().toLowerCase();
        return empDeptLower === oldNameLower || (oldCodeLower && empDeptLower === oldCodeLower);
      });
      if (affectedEmployees.length > 0) {
        setEmployees(prev =>
          prev.map(emp =>
            affectedEmployees.some(a => a.id === emp.id)
              ? { ...emp, department: cleanUpdates.name! }
              : emp
          )
        );
        for (const emp of affectedEmployees) {
          await syncRecordToFirestore('employees', emp.id, { department: cleanUpdates.name }, currentCompanyId);
        }
      }
    }
  };
  const deleteDepartment = async (id: string) => {
    setDepartments(prev => prev.filter(dep => dep.id !== id));
    await deleteRecordFromFirestore('departments', id);
  };

  // Branches: Add, Update, Delete with instant Firestore + Settings + localStorage Sync
  const persistBranchesToCloudAndLocal = async (activeComp: string, branchList: Branch[], deletedIds?: string[]) => {
    try {
      localStorage.setItem(`worknest_branches_${activeComp}`, JSON.stringify(branchList));
      let delArr = deletedIds;
      if (!delArr) {
        const raw = localStorage.getItem(`worknest_deleted_branches_${activeComp}`);
        delArr = raw ? JSON.parse(raw) : [];
      } else {
        localStorage.setItem(`worknest_deleted_branches_${activeComp}`, JSON.stringify(delArr));
      }
      await syncRecordToFirestore('settings', `branches_${activeComp}`, {
        items: branchList,
        deletedIds: delArr,
        companyId: activeComp,
        updatedAt: new Date().toISOString(),
      }, activeComp);
    } catch (e) {
      console.warn('persistBranchesToCloudAndLocal warning:', e);
    }
  };

  const addBranch = async (b: Omit<Branch, 'id'>): Promise<Branch> => {
    const activeComp = currentCompanyId || 'default';
    const cleanCode = b.code ? b.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '-') : `BR-${Date.now().toString().slice(-4)}`;
    const newId = activeComp !== 'default' ? `${activeComp}_${cleanCode}` : cleanCode;
    const newBranch: Branch = {
      ...b,
      id: newId,
      code: cleanCode,
      name: b.name.trim(),
      companyId: activeComp,
      isHeadOffice: b.type === 'head_office' || Boolean(b.isHeadOffice),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // If this ID was previously deleted, un-mark it from deletedIds
    let delArr: string[] = [];
    try {
      const raw = localStorage.getItem(`worknest_deleted_branches_${activeComp}`);
      if (raw) delArr = JSON.parse(raw).filter((x: string) => x !== newId && x !== cleanCode);
    } catch {}

    const nextList = [...branches.filter(x => x.id !== newId), newBranch];
    setBranches(nextList);
    await syncRecordToFirestore('branches', newId, { ...newBranch, deleted: false }, activeComp);
    await persistBranchesToCloudAndLocal(activeComp, nextList, delArr);
    return newBranch;
  };

  const updateBranch = async (id: string, updates: Partial<Branch>) => {
    const activeComp = currentCompanyId || 'default';
    const oldBranch = branches.find(b => b.id === id);
    const cleanUpdates: Partial<Branch> = {
      ...updates,
      ...(updates.name ? { name: updates.name.trim() } : {}),
      updatedAt: new Date().toISOString(),
    };
    const nextList = branches.map(b => b.id === id ? { ...b, ...cleanUpdates } : b);
    setBranches(nextList);
    const updatedBranchObj = nextList.find(b => b.id === id);
    await syncRecordToFirestore('branches', id, updatedBranchObj || cleanUpdates, activeComp);
    await persistBranchesToCloudAndLocal(activeComp, nextList);

    // Cascade branch name update to employees and biometric devices assigned to this branch
    if (oldBranch && cleanUpdates.name && oldBranch.name.trim().toLowerCase() !== cleanUpdates.name.toLowerCase()) {
      const oldNameLower = oldBranch.name.trim().toLowerCase();
      if (activeBranch.toLowerCase() === oldNameLower) {
        setActiveBranch(cleanUpdates.name);
      }
      const affectedEmps = allEmployees.filter(emp => (emp.branch || '').trim().toLowerCase() === oldNameLower || emp.branchId === id);
      if (affectedEmps.length > 0) {
        setEmployees(prev => prev.map(emp => affectedEmps.some(a => a.id === emp.id) ? { ...emp, branch: cleanUpdates.name! } : emp));
        for (const emp of affectedEmps) {
          await syncRecordToFirestore('employees', emp.id, { branch: cleanUpdates.name }, activeComp);
        }
      }
      const affectedDevs = allDevices.filter(dev => (dev.branch || '').trim().toLowerCase() === oldNameLower || dev.branchId === id);
      if (affectedDevs.length > 0) {
        setDevices(prev => prev.map(dev => affectedDevs.some(a => a.id === dev.id) ? { ...dev, branch: cleanUpdates.name! } : dev));
        for (const dev of affectedDevs) {
          await syncRecordToFirestore('zkteco_devices', dev.id, { branch: cleanUpdates.name }, activeComp);
        }
      }
    }
  };

  const deleteBranch = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    const target = branches.find(b => b.id === id);
    if (target && activeBranch.trim().toLowerCase() === target.name.trim().toLowerCase()) {
      setActiveBranch('All');
    }

    // Record deleted ID so stale snapshots never resurrect it
    let delArr: string[] = [];
    try {
      const raw = localStorage.getItem(`worknest_deleted_branches_${activeComp}`);
      if (raw) delArr = JSON.parse(raw);
    } catch {}
    if (!delArr.includes(id)) delArr.push(id);
    if (target?.code && !delArr.includes(target.code)) delArr.push(target.code);

    const remaining = branches.filter(b => b.id !== id && (!target || b.name.toLowerCase() !== target.name.toLowerCase()));
    const finalBranches = remaining.length > 0 ? remaining : [{ ...DEFAULT_HEAD_OFFICE_BRANCH, companyId: activeComp }];
    setBranches(finalBranches);

    // 1. Delete from Firestore 'branches' collection (both id and raw code if different)
    await deleteRecordFromFirestore('branches', id);
    if (target?.code && target.code !== id) {
      await deleteRecordFromFirestore('branches', target.code);
      if (activeComp !== 'default') {
        await deleteRecordFromFirestore('branches', `${activeComp}_${target.code}`);
      }
    }

    // 2. Persist updated branch list & deletedIds to Firestore 'settings/branches_*' and localStorage
    await persistBranchesToCloudAndLocal(activeComp, finalBranches, delArr);

    // 3. Reassign any employees or devices from the deleted branch back to Head Office so nothing is orphaned
    const hqBranch = finalBranches.find(b => b.isHeadOffice || b.type === 'head_office') || finalBranches[0];
    if (target && hqBranch) {
      const targetNameLower = target.name.trim().toLowerCase();
      const affectedEmps = allEmployees.filter(
        emp => (emp.branch || '').trim().toLowerCase() === targetNameLower || emp.branchId === id
      );
      if (affectedEmps.length > 0) {
        setEmployees(prev =>
          prev.map(emp =>
            affectedEmps.some(a => a.id === emp.id)
              ? { ...emp, branch: hqBranch.name, branchId: hqBranch.id }
              : emp
          )
        );
        for (const emp of affectedEmps) {
          await syncRecordToFirestore('employees', emp.id, { branch: hqBranch.name, branchId: hqBranch.id }, activeComp);
        }
      }

      const affectedDevs = allDevices.filter(
        dev => (dev.branch || '').trim().toLowerCase() === targetNameLower || dev.branchId === id
      );
      if (affectedDevs.length > 0) {
        setDevices(prev =>
          prev.map(dev =>
            affectedDevs.some(a => a.id === dev.id)
              ? { ...dev, branch: hqBranch.name, branchId: hqBranch.id }
              : dev
          )
        );
        for (const dev of affectedDevs) {
          await syncRecordToFirestore('zkteco_devices', dev.id, { branch: hqBranch.name, branchId: hqBranch.id }, activeComp);
        }
      }
    }
  };

  // Shifts: Add, Update, Delete with instant Firestore Sync
  const addShift = async (s: Omit<Shift, 'id'>) => {
    const cleanName = s.name ? s.name.trim() : '';
    const newId = cleanName ? cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : `shift-${Date.now().toString().slice(-4)}`;
    const newShift: Shift = { ...s, name: cleanName, id: newId, companyId: currentCompanyId || 'default', updatedAt: new Date().toISOString() };
    setShifts(prev => [...prev.filter(sh => sh.id !== newId), newShift]);
    await syncRecordToFirestore('shifts', newId, newShift, currentCompanyId);
    await recordAuditLog({
      action: 'SHIFT_CREATED',
      category: 'roster_shift',
      targetType: 'Shift',
      targetId: newId,
      targetName: cleanName,
      summary: `Created shift "${cleanName}" (${s.startTime} - ${s.endTime})`,
      afterValue: { name: cleanName, startTime: s.startTime, endTime: s.endTime, graceTime: s.graceTime },
    });
  };
  const updateShift = async (id: string, s: Partial<Shift>) => {
    const cleanId = id.trim();
    const targetShift = shifts.find(sh => sh.id === id || sh.id === cleanId);
    const targetNameLower = (s.name || targetShift?.name || '').trim().toLowerCase();
    const nowIso = new Date().toISOString();
    const cleanUpdates = {
      ...s,
      ...(s.name ? { name: s.name.trim() } : {}),
      updatedAt: nowIso,
    };

    // Find all shift docs that match this ID or the exact same shift name so stale duplicates in Firestore never override updated policies
    const matchingShiftIds = new Set<string>([id]);
    if (cleanId) matchingShiftIds.add(cleanId);
    shifts.forEach(sh => {
      if (sh.id === id || sh.id === cleanId) {
        matchingShiftIds.add(sh.id);
      } else if (targetNameLower && (sh.name || '').trim().toLowerCase() === targetNameLower) {
        matchingShiftIds.add(sh.id);
      }
    });

    setShifts(prev =>
      prev.map(sh =>
        matchingShiftIds.has(sh.id)
          ? { ...sh, ...cleanUpdates, id: sh.id }
          : sh
      )
    );

    for (const docId of matchingShiftIds) {
      await syncRecordToFirestore('shifts', docId, { ...cleanUpdates, id: docId }, currentCompanyId);
    }
    await recordAuditLog({
      action: 'SHIFT_UPDATED',
      category: 'roster_shift',
      targetType: 'Shift',
      targetId: cleanId,
      targetName: s.name || targetShift?.name || cleanId,
      summary: `Updated shift "${s.name || targetShift?.name || cleanId}"`,
      beforeValue: targetShift ? { startTime: targetShift.startTime, endTime: targetShift.endTime, graceTime: targetShift.graceTime } : undefined,
      afterValue: cleanUpdates,
    });
  };
  const deleteShift = async (id: string) => {
    const cleanId = id.trim();
    const targetShift = shifts.find(sh => sh.id === cleanId);
    setShifts(prev => prev.filter(sh => sh.id !== cleanId));
    await deleteRecordFromFirestore('shifts', cleanId);
    await recordAuditLog({
      action: 'SHIFT_DELETED',
      category: 'roster_shift',
      targetType: 'Shift',
      targetId: cleanId,
      targetName: targetShift?.name || cleanId,
      summary: `Deleted shift "${targetShift?.name || cleanId}"`,
      beforeValue: targetShift ? { name: targetShift.name, startTime: targetShift.startTime, endTime: targetShift.endTime } : undefined,
    });
  };

  // Roster: Add, Update with instant Firestore Sync
  const addRosterEntry = async (e: Omit<RosterEntry, 'id'>) => {
    const cleanEmpId = String(e.employeeId || '').trim();
    const newId = `${cleanEmpId}_${e.date}`;
    const newEntry: RosterEntry = { ...e, employeeId: cleanEmpId, id: newId, companyId: currentCompanyId || 'default', updatedAt: new Date().toISOString() };
    setRoster(prev => [...prev.filter(r => r.id !== newId && !(r.employeeId === cleanEmpId && r.date === e.date)), newEntry]);
    await syncRecordToFirestore('roster', newId, newEntry, currentCompanyId);
    await recordAuditLog({
      action: 'ROSTER_ASSIGNED',
      category: 'roster_shift',
      targetType: 'Roster',
      targetId: newId,
      targetName: `${e.employeeName || cleanEmpId} (${e.date})`,
      summary: `Assigned roster "${e.shift}" on ${e.date} for ${e.employeeName || cleanEmpId}`,
      afterValue: { employeeId: cleanEmpId, date: e.date, shift: e.shift, status: e.status },
    });
  };
  const updateRosterEntry = async (id: string, e: Partial<RosterEntry>) => {
    const cleanId = id.trim();
    const existing = roster.find(r => r.id === cleanId);
    const cleanUpdates = { ...e, id: cleanId, updatedAt: new Date().toISOString() };
    setRoster(prev => prev.map(r => r.id === cleanId ? { ...r, ...cleanUpdates } : r));
    await syncRecordToFirestore('roster', cleanId, cleanUpdates, currentCompanyId);
    await recordAuditLog({
      action: 'ROSTER_UPDATED',
      category: 'roster_shift',
      targetType: 'Roster',
      targetId: cleanId,
      targetName: existing?.employeeName || cleanId,
      summary: `Updated roster entry ${cleanId} to shift "${e.shift || existing?.shift || ''}"`,
      beforeValue: existing ? { shift: existing.shift, status: existing.status } : undefined,
      afterValue: cleanUpdates,
    });
  };
  const saveRosterEntries = async (entries: RosterEntry[]) => {
    if (!entries || entries.length === 0) return;
    setRoster(prev => {
      const entryMap = new Map<string, RosterEntry>();
      prev.forEach(r => entryMap.set(`${String(r.employeeId || '').trim()}_${r.date}`, r));
      entries.forEach(e => {
        const cleanEmpId = String(e.employeeId || '').trim();
        const docId = e.id || `${cleanEmpId}_${e.date}`;
        entryMap.set(`${cleanEmpId}_${e.date}`, { ...e, employeeId: cleanEmpId, id: docId });
      });
      return Array.from(entryMap.values());
    });
    for (const e of entries) {
      const cleanEmpId = String(e.employeeId || '').trim();
      const docId = e.id || `${cleanEmpId}_${e.date}`;
      await syncRecordToFirestore('roster', docId, { ...e, employeeId: cleanEmpId, id: docId, companyId: currentCompanyId || 'default', updatedAt: new Date().toISOString() }, currentCompanyId);
    }
    await recordAuditLog({
      action: 'ROSTER_BULK_SAVED',
      category: 'roster_shift',
      targetType: 'Roster',
      targetId: `batch_${entries.length}`,
      targetName: `${entries.length} Roster Entries`,
      summary: `Saved ${entries.length} roster schedule assignments`,
      afterValue: { count: entries.length, sampleDate: entries[0]?.date },
    });
  };
  const deleteRosterEntries = async (targets: { employeeId: string; date: string }[]) => {
    if (!targets || targets.length === 0) return;
    const keySet = new Set(targets.map(x => `${String(x.employeeId || '').trim()}_${x.date}`));
    setRoster(prev => prev.filter(r => !keySet.has(`${String(r.employeeId || '').trim()}_${r.date}`)));
    for (const item of targets) {
      const cleanEmpId = String(item.employeeId || '').trim();
      await deleteRecordFromFirestore('roster', `${cleanEmpId}_${item.date}`);
    }
    await recordAuditLog({
      action: 'ROSTER_ENTRIES_CLEARED',
      category: 'roster_shift',
      targetType: 'Roster',
      targetId: `clear_${targets.length}`,
      targetName: `${targets.length} Roster Entries`,
      summary: `Cleared ${targets.length} custom roster override entries`,
      beforeValue: { count: targets.length },
    });
  };

  // Company Holidays & Special Off-Days
  const saveCompanyHoliday = async (
    h: Omit<CompanyHoliday, 'id' | 'createdAt' | 'companyId'> & { id?: string; companyId?: string }
  ): Promise<CompanyHoliday> => {
    const activeComp = currentCompanyId || 'default';
    const cleanId = h.id || `hol_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Build dates list between startDate and endDate
    const startDateStr = h.startDate;
    const endDateStr = h.endDate || h.startDate;
    const dates: string[] = [];
    try {
      const [sy, sm, sd] = startDateStr.split('-').map(Number);
      const [ey, em, ed] = endDateStr.split('-').map(Number);
      const cur = new Date(Date.UTC(sy, sm - 1, sd));
      const end = new Date(Date.UTC(ey, em - 1, ed));
      while (cur <= end) {
        dates.push(cur.toISOString().split('T')[0]);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    } catch {
      dates.push(startDateStr);
    }
    const daysCount = dates.length || 1;

    const newHoliday: CompanyHoliday = {
      ...h,
      id: cleanId,
      daysCount,
      startDate: startDateStr,
      endDate: endDateStr,
      departments: Array.isArray(h.departments) ? h.departments : [],
      branches: Array.isArray(h.branches) ? h.branches : [],
      employeeIds: Array.isArray(h.employeeIds) ? h.employeeIds : [],
      dutyEmployeeIds: Array.isArray(h.dutyEmployeeIds) ? h.dutyEmployeeIds : [],
      dutyShiftName: h.dutyShiftName || '',
      syncToRoster: h.syncToRoster !== false,
      companyId: activeComp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setCompanyHolidays(prev => {
      const filtered = prev.filter(item => item.id !== cleanId);
      const next = [...filtered, newHoliday].sort((a, b) => b.startDate.localeCompare(a.startDate));
      try {
        localStorage.setItem(`worknest_holidays_${activeComp}`, JSON.stringify(next));
      } catch {}
      return next;
    });

    await syncRecordToFirestore('company_holidays', cleanId, newHoliday, activeComp);

    // Apply directly into Roster for all days in date range if syncToRoster is true
    if (newHoliday.syncToRoster) {
      const targetEmployees = allEmployees.length > 0 ? allEmployees : employees;
      const dutySet = new Set((newHoliday.dutyEmployeeIds || []).map(id => String(id).toLowerCase().trim()));

      const coveredEmployees = targetEmployees.filter(empItem => {
        if (newHoliday.scope === 'all') return true;
        if (newHoliday.scope === 'departments') {
          return (newHoliday.departments || []).some(
            d => d.toLowerCase() === (empItem.department || '').toLowerCase()
          );
        }
        if (newHoliday.scope === 'branches') {
          const empBranch = getEmployeeBranch(empItem);
          return (newHoliday.branches || []).some(
            b => b.toLowerCase() === empBranch.toLowerCase()
          );
        }
        if (newHoliday.scope === 'custom_employees') {
          return (newHoliday.employeeIds || []).some(
            id => id === empItem.id || id === empItem.employeeId
          );
        }
        return true;
      });

      const rosterEntriesToSave: RosterEntry[] = [];

      for (const coveredEmp of coveredEmployees) {
        const empIdNorm = String(coveredEmp.id).toLowerCase().trim();
        const empCodeNorm = String(coveredEmp.employeeId || '').toLowerCase().trim();
        const isOnDuty = dutySet.has(empIdNorm) || dutySet.has(empCodeNorm);

        for (const dateStr of dates) {
          const docId = `${coveredEmp.employeeId || coveredEmp.id}_${dateStr}`;
          if (isOnDuty) {
            // Employee is on duty exception: working during holiday
            const targetShift = newHoliday.dutyShiftName || coveredEmp.shift || (shifts[0]?.name || 'General Shift');
            rosterEntriesToSave.push({
              id: docId,
              employeeId: coveredEmp.employeeId || coveredEmp.id,
              employeeName: coveredEmp.name,
              date: dateStr,
              shift: targetShift,
              isOffDay: false,
              isExtraDay: true,
              status: `Duty Exception (${newHoliday.title})`,
              effectiveFrom: dateStr,
              companyId: activeComp,
            });
          } else {
            // Employee gets holiday off
            rosterEntriesToSave.push({
              id: docId,
              employeeId: coveredEmp.employeeId || coveredEmp.id,
              employeeName: coveredEmp.name,
              date: dateStr,
              shift: 'Off',
              isOffDay: true,
              isExtraDay: false,
              status: `Holiday: ${newHoliday.title}`,
              effectiveFrom: dateStr,
              companyId: activeComp,
            });
          }
        }
      }

      if (rosterEntriesToSave.length > 0) {
        await saveRosterEntries(rosterEntriesToSave);
      }
    }

    await recordAuditLog({
      action: 'HOLIDAY_DECLARED',
      category: 'roster_shift',
      targetType: 'Holiday',
      targetId: cleanId,
      targetName: newHoliday.title,
      summary: `Declared ${newHoliday.type} holiday "${newHoliday.title}" from ${newHoliday.startDate} to ${newHoliday.endDate} (${newHoliday.daysCount} days, scope: ${newHoliday.scope})`,
      afterValue: {
        title: newHoliday.title,
        startDate: newHoliday.startDate,
        endDate: newHoliday.endDate,
        scope: newHoliday.scope,
        dutyExceptions: (newHoliday.dutyEmployeeIds || []).length,
      },
    });

    addNotification({
      title: '🎉 Holiday & Special Off-Day Saved',
      message: `"${newHoliday.title}" (${newHoliday.startDate}${newHoliday.endDate !== newHoliday.startDate ? ` to ${newHoliday.endDate}` : ''}) scheduled successfully.`,
      read: false,
      type: 'system',
      targetPage: 'roster',
    });

    return newHoliday;
  };

  const deleteCompanyHoliday = async (id: string, revertRoster = true) => {
    const activeComp = currentCompanyId || 'default';
    const target = companyHolidays.find(h => h.id === id);
    if (!target) return;

    setCompanyHolidays(prev => {
      const next = prev.filter(h => h.id !== id);
      try {
        localStorage.setItem(`worknest_holidays_${activeComp}`, JSON.stringify(next));
      } catch {}
      return next;
    });

    await deleteRecordFromFirestore('company_holidays', id);

    if (revertRoster) {
      const startDateStr = target.startDate;
      const endDateStr = target.endDate || target.startDate;
      const dates: string[] = [];
      try {
        const [sy, sm, sd] = startDateStr.split('-').map(Number);
        const [ey, em, ed] = endDateStr.split('-').map(Number);
        const cur = new Date(Date.UTC(sy, sm - 1, sd));
        const end = new Date(Date.UTC(ey, em - 1, ed));
        while (cur <= end) {
          dates.push(cur.toISOString().split('T')[0]);
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      } catch {
        dates.push(startDateStr);
      }

      const targetEmployees = allEmployees.length > 0 ? allEmployees : employees;
      const coveredEmployees = targetEmployees.filter(empItem => {
        if (target.scope === 'all') return true;
        if (target.scope === 'departments') {
          return (target.departments || []).some(
            d => d.toLowerCase() === (empItem.department || '').toLowerCase()
          );
        }
        if (target.scope === 'branches') {
          const empBranch = getEmployeeBranch(empItem);
          return (target.branches || []).some(
            b => b.toLowerCase() === empBranch.toLowerCase()
          );
        }
        if (target.scope === 'custom_employees') {
          return (target.employeeIds || []).some(
            eid => eid === empItem.id || eid === empItem.employeeId
          );
        }
        return true;
      });

      const targetsToDelete: { employeeId: string; date: string }[] = [];
      for (const coveredEmp of coveredEmployees) {
        const empCode = coveredEmp.employeeId || coveredEmp.id;
        for (const dateStr of dates) {
          targetsToDelete.push({ employeeId: empCode, date: dateStr });
        }
      }

      if (targetsToDelete.length > 0) {
        await deleteRosterEntries(targetsToDelete);
      }
    }

    await recordAuditLog({
      action: 'HOLIDAY_DELETED',
      category: 'roster_shift',
      targetType: 'Holiday',
      targetId: id,
      targetName: target.title,
      summary: `Deleted holiday "${target.title}" (${target.startDate} to ${target.endDate})`,
      beforeValue: { title: target.title, startDate: target.startDate, endDate: target.endDate },
    });
  };

  // Leave Requests: Add, Update with instant Firestore Sync
  const addLeaveRequest = async (l: Omit<LeaveRequest, 'id'>) => {
    const newId = `leave_${Date.now()}`;
    const newReq: LeaveRequest = { ...l, id: newId, companyId: currentCompanyId || 'default' };
    setLeaveRequests(prev => [newReq, ...prev]);
    await syncRecordToFirestore('leaveRequests', newId, newReq, currentCompanyId);
  };
  const updateLeaveRequest = async (id: string, l: Partial<LeaveRequest>) => {
    setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, ...l } : r));
    await syncRecordToFirestore('leaveRequests', id, l, currentCompanyId);
  };
  const requestLeave = async (l: Omit<LeaveRequest, 'id' | 'appliedOn'>) => {
    const newId = `leave_${Date.now()}`;
    const newReq: LeaveRequest = {
      ...l,
      id: newId,
      appliedOn: new Date().toISOString().split('T')[0],
      status: 'pending',
      companyId: currentCompanyId || 'default'
    };
    setLeaveRequests(prev => [newReq, ...prev]);
    await syncRecordToFirestore('leaveRequests', newId, newReq, currentCompanyId);
  };
  const approveLeave = async (id: string, remarks?: string) => {
    await updateLeaveRequest(id, {
      status: 'approved',
      ...(remarks !== undefined ? { adminRemarks: remarks } : {}),
      reviewedBy: currentUser?.name || currentEmployee?.name || 'HR Administration',
      reviewedAt: new Date().toISOString(),
    });
    const targetLeave = leaveRequests.find(l => l.id === id);
    await recordAuditLog({
      action: 'LEAVE_APPROVED',
      category: 'leave_workflow',
      targetType: 'LeaveRequest',
      targetId: id,
      targetName: targetLeave?.employeeName || id,
      summary: `Approved ${targetLeave?.type || ''} leave (${targetLeave?.days || 1}d: ${targetLeave?.from} to ${targetLeave?.to}) for ${targetLeave?.employeeName || id}`,
      beforeValue: { status: targetLeave?.status || 'pending' },
      afterValue: { status: 'approved', remarks: remarks || '' },
    });
  };
  const rejectLeave = async (id: string, remarks?: string) => {
    await updateLeaveRequest(id, {
      status: 'rejected',
      ...(remarks !== undefined ? { adminRemarks: remarks } : {}),
      reviewedBy: currentUser?.name || currentEmployee?.name || 'HR Administration',
      reviewedAt: new Date().toISOString(),
    });
    const targetLeave = leaveRequests.find(l => l.id === id);
    await recordAuditLog({
      action: 'LEAVE_REJECTED',
      category: 'leave_workflow',
      targetType: 'LeaveRequest',
      targetId: id,
      targetName: targetLeave?.employeeName || id,
      summary: `Rejected ${targetLeave?.type || ''} leave for ${targetLeave?.employeeName || id}`,
      beforeValue: { status: targetLeave?.status || 'pending' },
      afterValue: { status: 'rejected', remarks: remarks || '' },
    });
  };

  // Attendance Regularization & Late / Early Requests
  const addAttendanceRequest = async (req: Omit<AttendanceRequest, 'id'>) => {
    const newId = `att_req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newReq: AttendanceRequest = {
      ...req,
      id: newId,
      companyId: currentCompanyId || 'default',
      appliedOn: req.appliedOn || new Date().toISOString().split('T')[0],
      status: req.status || 'pending',
    };
    setAttendanceRequests(prev => {
      const updated = [newReq, ...prev];
      try { localStorage.setItem('worknest_attendance_requests', JSON.stringify(updated)); } catch {}
      return updated;
    });
    await syncRecordToFirestore('attendance_requests', newId, newReq, currentCompanyId);
    addNotification({
      title: 'New Attendance Request',
      message: `${req.employeeName} submitted a ${req.type === 'late_arrival' ? 'Late Arrival Waiver' : 'Early Checkout'} request for ${req.date}`,
      read: false,
      type: 'attendance',
      targetPage: 'attendance',
    });
  };

  const updateAttendanceRequestStatus = async (id: string, status: 'approved' | 'rejected', remarks?: string) => {
    const req = attendanceRequests.find(r => r.id === id);
    const reviewerName = currentUser?.name || currentEmployee?.name || 'HR Administration';
    const reviewedAt = new Date().toISOString();
    setAttendanceRequests(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, status, reviewRemarks: remarks || r.reviewRemarks, reviewedBy: reviewerName, reviewedAt } : r);
      try { localStorage.setItem('worknest_attendance_requests', JSON.stringify(updated)); } catch {}
      return updated;
    });
    await syncRecordToFirestore('attendance_requests', id, { status, reviewRemarks: remarks || '', reviewedBy: reviewerName, reviewedAt }, currentCompanyId);

    // If approved, apply corresponding attendance regularization or overtime update
    if (status === 'approved' && req) {
      try {
        const docKey = (currentCompanyId && currentCompanyId !== 'default')
          ? `${currentCompanyId}_${req.employeeId}_${req.date}`
          : `${req.employeeId}_${req.date}`;
        if (req.type === 'late_arrival') {
          await syncRecordToFirestore('attendance', docKey, {
            companyId: currentCompanyId || 'default',
            date: req.date,
            employeeId: req.employeeId,
            isLateExcused: true,
            lateWaived: true,
            waiverReason: req.reason,
          }, currentCompanyId);
        } else if (req.type === 'missing_punch') {
          await syncRecordToFirestore('attendance', docKey, {
            companyId: currentCompanyId || 'default',
            date: req.date,
            employeeId: req.employeeId,
            employeeName: req.employeeName,
            department: req.department || 'General',
            ...(req.checkInTime ? { checkIn: req.checkInTime, firstPunchIn: req.checkInTime } : {}),
            ...(req.checkOutTime ? { checkOut: req.checkOutTime, lastPunchOut: req.checkOutTime } : {}),
            status: 'present',
            regularizedBy: reviewerName,
            regularizationReason: req.reason,
          }, currentCompanyId);
        } else if (req.type === 'overtime' && req.otHours !== undefined) {
          await syncRecordToFirestore('attendance', docKey, {
            companyId: currentCompanyId || 'default',
            date: req.date,
            employeeId: req.employeeId,
            otHours: Number(req.otHours) || 0,
            source: 'admin_edit',
          }, currentCompanyId);
        }
      } catch (e) {
        console.warn('Could not auto-update attendance record for regularization:', e);
      }
    }

    await recordAuditLog({
      action: status === 'approved' ? 'ATTENDANCE_REGULARIZATION_APPROVED' : 'ATTENDANCE_REGULARIZATION_REJECTED',
      category: 'attendance',
      targetType: 'AttendanceRequest',
      targetId: id,
      targetName: req?.employeeName || id,
      summary: `${status === 'approved' ? 'Approved' : 'Rejected'} ${req?.type || 'attendance'} request for ${req?.employeeName || id} on ${req?.date || ''}`,
      beforeValue: { status: req?.status || 'pending' },
      afterValue: { status, remarks: remarks || '' },
    });

    if (req) {
      addNotification({
        title: `Attendance Request ${status === 'approved' ? 'Approved' : 'Rejected'}`,
        message: `${req.type === 'late_arrival' ? 'Late Arrival Waiver' : 'Early Checkout'} request for ${req.date} was ${status}${status === 'approved' ? ' (Late penalty waived)' : ''}`,
        read: false,
        type: 'attendance',
        targetPage: 'attendance',
      });
    }
  };

  const generateMonthEndPayroll = async (month: string, notes?: string) => {
    const existingRun = monthlyPayrollRuns[month];
    if (existingRun?.isLocked) {
      throw new Error(`Payroll for ${month} is finalized and locked. Locked historical payroll cannot be recalculated unless unlocked by an authorized administrator.`);
    }
    const run: MonthlyPayrollRun = {
      ...(existingRun || {}),
      month,
      status: 'published',
      approvalStatus: existingRun?.approvalStatus === 'locked' ? 'locked' : (existingRun?.approvalStatus || 'approved'),
      companyId: currentCompanyId || 'default',
      generatedAt: new Date().toISOString(),
      totalEmployees: employees.length,
      publishedBy: currentUser?.name || 'HR Administration',
      notes: notes || 'Month-end payroll generated and payslips published for employee viewing'
    };
    setMonthlyPayrollRuns(prev => {
      const next = { ...prev, [month]: run };
      try { localStorage.setItem('worknest_payroll_runs', JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('payroll_runs', month, run, currentCompanyId);
    await recordAuditLog({
      action: 'PAYROLL_MONTH_PUBLISHED',
      category: 'payroll',
      targetType: 'MonthlyPayrollRun',
      targetId: month,
      targetName: `Payroll Run (${month})`,
      summary: `Generated and published month-end payroll for ${month} (${employees.length} employees)`,
      afterValue: { month, status: 'published', totalEmployees: employees.length, notes: run.notes },
    });
    addNotification({
      title: 'Month-End Payslips Published',
      message: `Official payslips for ${month} have been generated and published for all employees.`,
      read: false,
      type: 'payroll',
      targetPage: 'payroll'
    });
  };

  const approveMonthlyPayrollRun = async (month: string, notes?: string) => {
    const existingRun = monthlyPayrollRuns[month];
    if (existingRun?.isLocked) return;
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || 'Payroll Approver';
    const run: MonthlyPayrollRun = {
      ...(existingRun || {
        month,
        status: 'generated',
        generatedAt: nowIso,
        totalEmployees: employees.length,
      }),
      month,
      approvalStatus: 'approved',
      approvedAt: nowIso,
      approvedBy: actorName,
      notes: notes || existingRun?.notes || `Approved by ${actorName}`,
      companyId: currentCompanyId || 'default',
    };
    setMonthlyPayrollRuns(prev => {
      const next = { ...prev, [month]: run };
      try { localStorage.setItem('worknest_payroll_runs', JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('payroll_runs', month, run, currentCompanyId);
    await recordAuditLog({
      action: 'PAYROLL_RUN_APPROVED',
      category: 'payroll',
      targetType: 'MonthlyPayrollRun',
      targetId: month,
      targetName: `Payroll Run (${month})`,
      summary: `${actorName} approved monthly payroll run for ${month}`,
      afterValue: { month, approvalStatus: 'approved', approvedBy: actorName },
    });
  };

  const lockMonthlyPayrollRun = async (
    month: string,
    snapshots: Record<string, any>,
    totals: { gross: number; deductions: number; net: number },
    notes?: string
  ) => {
    const existingRun = monthlyPayrollRuns[month];
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || 'Payroll Administrator';
    const run: MonthlyPayrollRun = {
      ...(existingRun || {}),
      month,
      status: 'published',
      approvalStatus: 'locked',
      isLocked: true,
      lockedAt: nowIso,
      lockedBy: actorName,
      approvedAt: existingRun?.approvedAt || nowIso,
      approvedBy: existingRun?.approvedBy || actorName,
      generatedAt: existingRun?.generatedAt || nowIso,
      totalEmployees: Object.keys(snapshots).length || employees.length,
      publishedBy: existingRun?.publishedBy || actorName,
      lockedSnapshots: snapshots,
      totalGrossAmount: totals.gross,
      totalDeductionsAmount: totals.deductions,
      totalNetAmount: totals.net,
      notes: notes || `Finalized & locked by ${actorName}. Historical figures frozen.`,
      companyId: currentCompanyId || 'default',
    };
    setMonthlyPayrollRuns(prev => {
      const next = { ...prev, [month]: run };
      try { localStorage.setItem('worknest_payroll_runs', JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('payroll_runs', month, run, currentCompanyId);
    await recordAuditLog({
      action: 'PAYROLL_RUN_LOCKED_FINALIZED',
      category: 'payroll',
      targetType: 'MonthlyPayrollRun',
      targetId: month,
      targetName: `Payroll Run (${month})`,
      summary: `${actorName} locked & finalized payroll for ${month} (Net: ৳${totals.net.toLocaleString()}). Historical records frozen.`,
      afterValue: { month, isLocked: true, lockedBy: actorName, totalGross: totals.gross, totalNet: totals.net },
    });
    addNotification({
      title: `🔒 Payroll Finalized & Locked (${month})`,
      message: `Payroll for ${month} has been locked with immutable snapshots. Future salary or policy changes will never alter this historical period.`,
      read: false,
      type: 'payroll',
      targetPage: 'payroll',
    });
  };

  const unlockMonthlyPayrollRun = async (month: string, reason: string) => {
    const existingRun = monthlyPayrollRuns[month];
    if (!existingRun) return;
    const actorName = currentUser?.name || 'Super Admin';
    const updatedRun: MonthlyPayrollRun = {
      ...existingRun,
      isLocked: false,
      approvalStatus: 'approved',
      notes: `Unlocked by ${actorName}: ${reason}`,
    };
    setMonthlyPayrollRuns(prev => {
      const next = { ...prev, [month]: updatedRun };
      try { localStorage.setItem('worknest_payroll_runs', JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('payroll_runs', month, updatedRun, currentCompanyId);
    await recordAuditLog({
      action: 'PAYROLL_RUN_UNLOCKED',
      category: 'payroll',
      targetType: 'MonthlyPayrollRun',
      targetId: month,
      targetName: `Payroll Run (${month})`,
      summary: `${actorName} unlocked payroll run for ${month}. Reason: ${reason}`,
      beforeValue: { isLocked: true },
      afterValue: { isLocked: false, reason },
    });
  };

  const saveSalaryAdvanceLoan = async (
    payload: Omit<SalaryAdvanceLoan, 'id' | 'createdAt' | 'companyId' | 'issuedBy'>
  ): Promise<SalaryAdvanceLoan> => {
    const activeComp = currentCompanyId || 'default';
    const id = `advloan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const record: SalaryAdvanceLoan = {
      ...payload,
      id,
      issuedBy: currentUser?.name || 'Payroll Admin',
      createdAt: nowIso,
      companyId: activeComp,
    };
    setSalaryAdvancesLoans(prev => {
      const next = [record, ...prev];
      try { localStorage.setItem(`worknest_advances_loans_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('salary_advances_loans', id, record, activeComp);
    await recordAuditLog({
      action: payload.type === 'advance' ? 'SALARY_ADVANCE_ISSUED' : 'EMPLOYEE_LOAN_ISSUED',
      category: 'payroll',
      targetType: 'SalaryAdvanceLoan',
      targetId: id,
      targetName: `${payload.employeeName} (${payload.type.toUpperCase()})`,
      summary: `Issued ৳${payload.principalAmount.toLocaleString()} ${payload.type} to ${payload.employeeName} (৳${payload.monthlyInstallment.toLocaleString()}/mo from ${payload.startMonth})`,
      afterValue: record,
    });
    return record;
  };

  const updateSalaryAdvanceLoan = async (id: string, updates: Partial<SalaryAdvanceLoan>) => {
    const activeComp = currentCompanyId || 'default';
    const existing = salaryAdvancesLoans.find(a => a.id === id);
    setSalaryAdvancesLoans(prev => {
      const next = prev.map(a => a.id === id ? { ...a, ...updates } : a);
      try { localStorage.setItem(`worknest_advances_loans_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('salary_advances_loans', id, updates, activeComp);
    await recordAuditLog({
      action: 'SALARY_ADVANCE_LOAN_UPDATED',
      category: 'payroll',
      targetType: 'SalaryAdvanceLoan',
      targetId: id,
      targetName: existing?.employeeName || id,
      summary: `Updated ${existing?.type || 'advance/loan'} record for ${existing?.employeeName || id}`,
      beforeValue: existing ? { status: existing.status, remainingBalance: existing.remainingBalance } : undefined,
      afterValue: updates,
    });
  };

  const deleteSalaryAdvanceLoan = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    const existing = salaryAdvancesLoans.find(a => a.id === id);
    setSalaryAdvancesLoans(prev => {
      const next = prev.filter(a => a.id !== id);
      try { localStorage.setItem(`worknest_advances_loans_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('salary_advances_loans', id);
    await recordAuditLog({
      action: 'SALARY_ADVANCE_LOAN_DELETED',
      category: 'payroll',
      targetType: 'SalaryAdvanceLoan',
      targetId: id,
      targetName: existing?.employeeName || id,
      summary: `Deleted ${existing?.type || 'advance/loan'} record for ${existing?.employeeName || id}`,
    });
  };

  // Recruitment & Candidates Pipeline
  const addRecruitmentJob = (job: Omit<RecruitmentJob, 'id'>) => {
    const id = `job_${Date.now()}`;
    const newJob: RecruitmentJob = { ...job, id, companyId: currentCompanyId || 'default' };
    setRecruitmentJobs(prev => [newJob, ...prev]);
    syncRecordToFirestore('recruitment', id, newJob, currentCompanyId);
  };
  const updateRecruitmentJobStatus = (id: string, status: 'open' | 'closed') => {
    setRecruitmentJobs(prev => prev.map(j => j.id === id ? { ...j, status } : j));
    syncRecordToFirestore('recruitment', id, { status }, currentCompanyId);
  };

  const addCandidate = async (c: Omit<Candidate, 'id'>): Promise<Candidate> => {
    const id = `cand_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newCand: Candidate = { ...c, id, companyId: currentCompanyId || 'default' };
    setCandidates(prev => [newCand, ...prev]);
    // update job applicant count if associated with a job
    if (c.jobId) {
      setRecruitmentJobs(prev => prev.map(j => {
        if (j.id === c.jobId) {
          const updated = { ...j, applicantsCount: (j.applicantsCount || 0) + 1 };
          syncRecordToFirestore('recruitment', j.id, { applicantsCount: updated.applicantsCount }, currentCompanyId);
          return updated;
        }
        return j;
      }));
    }
    await syncRecordToFirestore('candidates', id, newCand, currentCompanyId);
    return newCand;
  };

  const addCandidatesBatch = async (list: Omit<Candidate, 'id'>[]): Promise<number> => {
    if (!list || list.length === 0) return 0;
    const now = Date.now();
    const created: Candidate[] = list.map((item, idx) => ({
      ...item,
      id: `cand_${now}_${idx}_${Math.random().toString(36).substring(2, 5)}`,
      companyId: currentCompanyId || 'default'
    }));

    setCandidates(prev => [...created, ...prev]);
    for (const cand of created) {
      await syncRecordToFirestore('candidates', cand.id, cand, currentCompanyId);
    }
    return created.length;
  };

  const updateCandidateStage = async (id: string, stage: CandidateStage) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, stage } : c));
    await syncRecordToFirestore('candidates', id, { stage }, currentCompanyId);
  };

  const updateCandidate = async (id: string, updates: Partial<Candidate>) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
    await syncRecordToFirestore('candidates', id, updates, currentCompanyId);
  };

  const deleteCandidate = async (id: string) => {
    setCandidates(prev => prev.filter(c => c.id !== id));
    await deleteRecordFromFirestore('candidates', id);
  };

  const hireCandidate = async (candidate: Candidate, initialSalary?: number) => {
    // 1. Update candidate stage to 'hired'
    await updateCandidateStage(candidate.id, 'hired');

    // 2. Add as official Employee into Employee Management
    const salary = initialSalary || candidate.expectedSalary || 30000;
    const basic = Math.round(salary * 0.5);
    const houseRent = Math.round(salary * 0.3);
    const medical = Math.round(salary * 0.1);
    const transport = Math.round(salary * 0.1);

    const empCode = `WNH-${1000 + employees.length + 1}`;
    await addEmployee({
      name: candidate.name,
      employeeId: empCode,
      email: candidate.email || `${candidate.name.toLowerCase().replace(/\s+/g, '.')}@worknest.com`,
      phone: candidate.phone,
      department: candidate.department || 'Engineering',
      designation: candidate.jobTitle || 'Officer',
      shift: shifts[0]?.name || 'General Shift',
      grossSalary: salary,
      basicSalary: basic,
      basic: basic,
      houseRent: houseRent,
      medical: medical,
      transport: transport,
      conveyance: transport,
      food: 0,
      attendanceBonus: 0,
      bankName: '',
      accountNumber: '',
      rfidCard: '',
      password: 'password123',
      joinDate: new Date().toISOString().split('T')[0],
      status: 'active',
      avatar: '👨‍💼',
      address: '',
      emergencyContact: '',
      companyId: currentCompanyId || 'default',
    });
  };

  // Biometric Devices - Full Hardware & Cloud Integration
  const addDevice = async (d: Omit<BiometricDevice, 'id'>): Promise<BiometricDevice> => {
    const rawSerial = (d.serialNumber || d.serial || '').trim();
    const cleanSerial = rawSerial.replace(/[^a-zA-Z0-9_-]/g, '_');
    const activeComp = currentCompanyId || 'default';
    const docId = cleanSerial
      ? (activeComp !== 'default' ? `dev_${activeComp}_${cleanSerial}` : `dev_${cleanSerial}`)
      : `dev_${Date.now()}`;
    const resolvedBranch = (d.branch || '').trim() || (activeBranch && activeBranch.toLowerCase() !== 'all' ? activeBranch : headOfficeBranchName);
    const matchedBranchObj = branches.find(b => b.name.toLowerCase() === resolvedBranch.toLowerCase());
    const newDevice: BiometricDevice = normalizeBiometricDevice({
      ...d,
      id: docId,
      branch: resolvedBranch,
      branchId: d.branchId || matchedBranchObj?.id || 'BR-HQ',
      companyId: activeComp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    setDevices(prev => [...prev.filter(x => x.id !== docId), newDevice]);
    await syncRecordToFirestore('zkteco_devices', docId, newDevice, activeComp);
    return newDevice;
  };

  const updateDevice = async (id: string, updates: Partial<BiometricDevice>): Promise<void> => {
    const cleanUpdates = {
      ...updates,
      updatedAt: new Date().toISOString()
    };
    setDevices(prev => prev.map(dev => dev.id === id ? normalizeBiometricDevice({ ...dev, ...cleanUpdates }) : dev));
    await syncRecordToFirestore('zkteco_devices', id, cleanUpdates, currentCompanyId);
  };

  const deleteDevice = async (id: string): Promise<void> => {
    setDevices(prev => prev.filter(dev => dev.id !== id));
    await deleteRecordFromFirestore('zkteco_devices', id);
  };

  const testDeviceConnection = async (device: BiometricDevice): Promise<{ success: boolean; status: BiometricDevice['status']; message: string; latency?: number }> => {
    const isAdms = device.connectionType === 'adms' || !device.connectionType || String(device.port) === '443' || String(device.port) === '80';
    const sn = device.serialNumber || device.serial || '';

    if (isAdms) {
      const startTime = performance.now();
      try {
        const testUrl = `${window.location.origin}/iclock/cdata?SN=${encodeURIComponent(sn)}`;
        const response = await fetch(testUrl, {
          method: 'GET',
          headers: { 'Accept': 'text/plain' }
        });
        const latency = Math.round(performance.now() - startTime);
        if (response.ok) {
          const bodyText = await response.text();
          const isAck = bodyText.includes('GET OPTION FROM:') || bodyText.includes('Stamp') || response.status === 200;
          if (isAck) {
            const now = new Date();
            const timeFormatted = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            await updateDevice(device.id, {
              status: 'connected',
              lastSeen: now.toISOString(),
              lastSync: `Verified: ${timeFormatted}`,
              lastTested: now.toISOString(),
              testLatency: latency
            });
            return {
              success: true,
              status: 'connected',
              latency,
              message: `ADMS Cloud handshake confirmed (${latency}ms). Ingestion pipeline verified for serial ${sn || 'N/A'}.`
            };
          }
        }
        await updateDevice(device.id, { status: 'error', lastTested: new Date().toISOString() });
        return {
          success: false,
          status: 'error',
          message: `ADMS endpoint responded with status ${response.status}. Please check server settings.`
        };
      } catch (err: any) {
        await updateDevice(device.id, { status: 'error', lastTested: new Date().toISOString() });
        return {
          success: false,
          status: 'error',
          message: `Connection test error: ${err.message || 'Network request failed'}`
        };
      }
    } else {
      // Local TCP/IP probe
      // Note: Browsers cannot establish raw TCP sockets to private LAN addresses (e.g. 192.168.x.x:4370)
      // We must accurately inform the user without faking results.
      const ip = device.ipAddress || device.ip || '';
      const port = device.port || 4370;
      await updateDevice(device.id, {
        status: 'untested',
        lastTested: new Date().toISOString()
      });
      return {
        success: false,
        status: 'untested',
        message: `Direct TCP socket connection to ${ip}:${port} is restricted by browser security sandbox. For real-time cloud attendance, configure the physical machine's Comm. > Cloud Server / ADMS setting to push via HTTP/HTTPS.`
      };
    }
  };

  const getEmployeeAttendance = (employeeId: string) => {
    try {
      const saved = localStorage.getItem(`attendance_${employeeId}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  };

  // =========================================================================
  // PHASE 1: MANAGER SELF-SERVICE (MSS) & TEAM SCOPING ENGINE
  // =========================================================================
  const isCurrentUserManager = useMemo(() => {
    if (currentUser) {
      if (currentUser.role === 'Super Admin' || currentUser.role === 'HR Manager' || currentUser.role === 'Department Supervisor') {
        return true;
      }
      if (currentUser.permissions?.mss || currentUser.permissions?.approvals) {
        return true;
      }
    }
    if (currentEmployee) {
      if (currentEmployee.isManager) return true;
      const hasDirectReports = allEmployees.some(
        e => e.managerId && (e.managerId === currentEmployee.employeeId || e.managerId === currentEmployee.id)
      );
      if (hasDirectReports) return true;
    }
    return false;
  }, [currentUser, currentEmployee, allEmployees]);

  const authorizedTeamEmployees = useMemo(() => {
    const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
      ? currentEmployee.companyId
      : (currentCompanyId || 'default');

    const tenantEmployees = allEmployees.filter(e => (e.companyId || 'default') === activeComp);

    // 1. If logged in as Admin / Supervisor
    if (currentUser) {
      const assignedDept = ((currentUser as any).assignedDepartment || '').trim().toLowerCase();
      const assignedBranch = ((currentUser as any).assignedBranch || '').trim().toLowerCase();

      // Super Admin or HR Manager without department restriction sees company employees
      if ((currentUser.role === 'Super Admin' || currentUser.role === 'HR Manager') && !assignedDept && !assignedBranch) {
        return tenantEmployees;
      }

      // Department Supervisor or scoped Manager sees ONLY their assigned department / branch / direct reports
      return tenantEmployees.filter(emp => {
        if (assignedDept && (emp.department || '').trim().toLowerCase() !== assignedDept) {
          return false;
        }
        if (assignedBranch && getEmployeeBranch(emp).trim().toLowerCase() !== assignedBranch) {
          return false;
        }
        if (!assignedDept && !assignedBranch && currentUser.role === 'Department Supervisor') {
          // Match departments where head == currentUser.name
          const managedDepts = departments
            .filter(d => (d.head || '').trim().toLowerCase() === (currentUser.name || '').trim().toLowerCase())
            .map(d => d.name.trim().toLowerCase());
          if (managedDepts.length > 0) {
            return managedDepts.includes((emp.department || '').trim().toLowerCase());
          }
        }
        return true;
      });
    }

    // 2. If logged in as Employee Manager (ESS + MSS)
    if (currentEmployee && (currentEmployee.isManager || isCurrentUserManager)) {
      return tenantEmployees.filter(emp => {
        const isDirectReport =
          emp.managerId === currentEmployee.employeeId ||
          emp.managerId === currentEmployee.id;
        const isSameDept =
          Boolean(currentEmployee.department) &&
          (emp.department || '').trim().toLowerCase() === currentEmployee.department.trim().toLowerCase();
        return isDirectReport || isSameDept;
      });
    }

    return [];
  }, [allEmployees, currentUser, currentEmployee, isAuthenticated, isEmployeeAuthenticated, currentCompanyId, departments, isCurrentUserManager]);

  const canManageEmployee = (empOrId: Employee | string | undefined): boolean => {
    if (!empOrId) return false;
    const empObj = typeof empOrId === 'string'
      ? allEmployees.find(e => e.id === empOrId || e.employeeId === empOrId)
      : empOrId;
    const targetEmpId = typeof empOrId === 'string' ? empOrId : (empObj?.employeeId || empObj?.id || '');

    // Prevent self-approval by an employee/manager on their own employee record
    if (currentEmployee && (targetEmpId === currentEmployee.id || targetEmpId === currentEmployee.employeeId)) {
      return false;
    }

    if (currentUser) {
      if (currentUser.role === 'Super Admin' && !((currentUser as any).assignedDepartment)) {
        return true;
      }
      if (!isCurrentUserManager && !currentUser.permissions?.leave && !currentUser.permissions?.attendance && !currentUser.permissions?.approvals) {
        return false;
      }
    } else if (!isCurrentUserManager) {
      return false;
    }

    return authorizedTeamEmployees.some(
      e => e.id === targetEmpId || e.employeeId === targetEmpId || (empObj && (e.id === empObj.id || e.employeeId === empObj.employeeId))
    );
  };

  // =========================================================================
  // PHASE 1: UNIFIED REUSABLE WORKFLOW & APPROVAL ENGINE
  // Combines standalone workflow_requests (overtime, expense, other_hr) with
  // leaveRequests & attendanceRequests without duplicating records!
  // =========================================================================
  const workflowRequests = useMemo(() => {
    const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
      ? currentEmployee.companyId
      : (currentCompanyId || 'default');

    const map = new Map<string, WorkflowRequest>();

    // 1. Add native workflow_requests first
    rawWorkflowRequests.forEach(w => {
      map.set(w.id, w);
    });

    // 2. Synthesize any LeaveRequests that aren't already linked
    leaveRequests.forEach(l => {
      const wfId = `wf_leave_${l.id}`;
      const alreadyLinked = Array.from(map.values()).some(w => w.linkedRecordId === l.id || w.id === wfId);
      if (!alreadyLinked) {
        const history: WorkflowStepHistory[] = [
          {
            status: 'pending',
            actorId: l.employeeId,
            actorName: l.employeeName,
            actorRole: 'Employee',
            timestamp: l.appliedOn || new Date().toISOString().split('T')[0],
            reason: l.reason,
          },
        ];
        if (l.status !== 'pending') {
          history.push({
            status: l.status,
            actorId: l.reviewedBy || 'admin',
            actorName: l.reviewedBy || 'Approver',
            actorRole: 'Manager / HR',
            timestamp: l.reviewedAt || new Date().toISOString(),
            reason: l.adminRemarks || (l.status === 'approved' ? 'Approved' : 'Rejected'),
          });
        }
        map.set(wfId, {
          id: wfId,
          requestType: 'leave',
          subType: l.type,
          employeeId: l.employeeId,
          employeeName: l.employeeName,
          department: l.department || 'General',
          title: `${l.type} Leave (${l.days}d)`,
          fromDate: l.from,
          toDate: l.to,
          daysOrHours: l.days,
          reason: l.reason,
          attachmentName: l.attachmentName,
          attachmentType: l.attachmentType,
          attachmentSize: l.attachmentSize,
          attachmentDataUrl: l.attachmentDataUrl,
          status: l.status,
          requesterId: l.employeeId,
          requesterName: l.employeeName,
          approverName: l.reviewedBy,
          decisionReason: l.adminRemarks,
          createdAt: l.appliedOn || new Date().toISOString(),
          reviewedAt: l.reviewedAt,
          history,
          linkedRecordId: l.id,
          companyId: l.companyId || activeComp,
        });
      }
    });

    // 3. Synthesize any AttendanceRequests that aren't already linked
    attendanceRequests.forEach(r => {
      const wfId = `wf_att_${r.id}`;
      const alreadyLinked = Array.from(map.values()).some(w => w.linkedRecordId === r.id || w.id === wfId);
      if (!alreadyLinked) {
        const typeLabel =
          r.type === 'late_arrival'
            ? 'Late Arrival Waiver'
            : r.type === 'early_checkout'
            ? 'Early Checkout Regularization'
            : r.type === 'missing_punch'
            ? 'Missing Punch Correction'
            : 'Overtime Approval Request';
        const history: WorkflowStepHistory[] = [
          {
            status: 'pending',
            actorId: r.employeeId,
            actorName: r.employeeName,
            actorRole: 'Employee',
            timestamp: r.appliedOn || r.date,
            reason: r.reason,
          },
        ];
        if (r.status !== 'pending') {
          history.push({
            status: r.status,
            actorId: r.reviewedBy || 'admin',
            actorName: r.reviewedBy || 'Approver',
            actorRole: 'Manager / HR',
            timestamp: r.reviewedAt || new Date().toISOString(),
            reason: r.reviewRemarks || (r.status === 'approved' ? 'Approved' : 'Rejected'),
          });
        }
        map.set(wfId, {
          id: wfId,
          requestType: r.type === 'overtime' ? 'overtime' : 'attendance_correction',
          subType: r.type,
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          department: r.department || 'General',
          title: `${typeLabel} (${r.date})`,
          date: r.date,
          actualTime: r.actualTime || r.checkInTime,
          requestedTime: r.requestedTime || r.checkOutTime,
          daysOrHours: r.otHours,
          reason: r.reason,
          attachmentName: r.attachmentName,
          attachmentType: r.attachmentType,
          attachmentSize: r.attachmentSize,
          attachmentDataUrl: r.attachmentDataUrl,
          status: r.status,
          requesterId: r.employeeId,
          requesterName: r.employeeName,
          approverName: r.reviewedBy,
          decisionReason: r.reviewRemarks,
          createdAt: r.appliedOn || r.date,
          reviewedAt: r.reviewedAt,
          history,
          linkedRecordId: r.id,
          companyId: r.companyId || activeComp,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [rawWorkflowRequests, leaveRequests, attendanceRequests, isEmployeeAuthenticated, isAuthenticated, currentEmployee, currentCompanyId]);

  const submitWorkflowRequest = async (
    payload: Omit<WorkflowRequest, 'id' | 'status' | 'createdAt' | 'history' | 'companyId'>
  ): Promise<{ success: boolean; id?: string; error?: string }> => {
    try {
      const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
        ? currentEmployee.companyId
        : (currentCompanyId || 'default');
      const nowIso = new Date().toISOString();
      const wfId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      // If it's a leave or attendance_correction request, also create in underlying collection so existing tabs stay in sync
      let linkedId = payload.linkedRecordId;
      if (payload.requestType === 'leave' && !linkedId) {
        const leaveId = `leave_${Date.now()}`;
        linkedId = leaveId;
        const newLeave: LeaveRequest = {
          id: leaveId,
          employeeId: payload.employeeId,
          employeeName: payload.employeeName,
          department: payload.department,
          type: payload.subType || 'Casual',
          from: payload.fromDate || payload.date || nowIso.split('T')[0],
          to: payload.toDate || payload.fromDate || payload.date || nowIso.split('T')[0],
          days: Number(payload.daysOrHours) || 1,
          reason: payload.reason,
          status: 'pending',
          appliedOn: nowIso.split('T')[0],
          companyId: activeComp,
          ...(payload.attachmentName ? {
            attachmentName: payload.attachmentName,
            attachmentType: payload.attachmentType,
            attachmentSize: payload.attachmentSize,
            attachmentDataUrl: payload.attachmentDataUrl,
          } : {}),
        };
        setLeaveRequests(prev => [newLeave, ...prev]);
        await syncRecordToFirestore('leaveRequests', leaveId, newLeave, activeComp);
      } else if ((payload.requestType === 'attendance_correction' || payload.requestType === 'overtime') && !linkedId) {
        const attReqId = `att_req_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        linkedId = attReqId;
        const attType = (payload.subType as any) || (payload.requestType === 'overtime' ? 'overtime' : 'late_arrival');
        const newAttReq: AttendanceRequest = {
          id: attReqId,
          employeeId: payload.employeeId,
          employeeName: payload.employeeName,
          department: payload.department,
          date: payload.date || nowIso.split('T')[0],
          type: attType,
          actualTime: payload.actualTime,
          requestedTime: payload.requestedTime,
          checkInTime: payload.actualTime,
          checkOutTime: payload.requestedTime,
          otHours: payload.requestType === 'overtime' ? (Number(payload.daysOrHours) || 0) : undefined,
          reason: payload.reason,
          status: 'pending',
          appliedOn: nowIso.split('T')[0],
          companyId: activeComp,
          ...(payload.attachmentName ? {
            attachmentName: payload.attachmentName,
            attachmentType: payload.attachmentType,
            attachmentSize: payload.attachmentSize,
            attachmentDataUrl: payload.attachmentDataUrl,
          } : {}),
        };
        setAttendanceRequests(prev => [newAttReq, ...prev]);
        await syncRecordToFirestore('attendance_requests', attReqId, newAttReq, activeComp);
      }

      const fullWf: WorkflowRequest = {
        ...payload,
        id: wfId,
        status: 'pending',
        createdAt: nowIso,
        updatedAt: nowIso,
        linkedRecordId: linkedId,
        companyId: activeComp,
        history: [
          {
            status: 'pending',
            actorId: payload.requesterId,
            actorName: payload.requesterName,
            actorRole: currentEmployee ? 'Employee' : (currentUser?.role || 'Requester'),
            timestamp: nowIso,
            reason: payload.reason,
          },
        ],
      };

      setRawWorkflowRequests(prev => [fullWf, ...prev]);
      await syncRecordToFirestore('workflow_requests', wfId, fullWf, activeComp);

      await recordAuditLog({
        action: 'WORKFLOW_REQUEST_SUBMITTED',
        category: 'leave_workflow',
        targetType: 'WorkflowRequest',
        targetId: wfId,
        targetName: `${payload.title} - ${payload.employeeName}`,
        summary: `${payload.requesterName} submitted ${payload.requestType} request: ${payload.title}`,
        afterValue: { requestType: payload.requestType, status: 'pending', reason: payload.reason },
      });

      return { success: true, id: wfId };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to submit workflow request.' };
    }
  };

  const decideWorkflowRequest = async (
    id: string,
    decision: 'approved' | 'rejected',
    reason: string
  ): Promise<{ success: boolean; error?: string }> => {
    const target = workflowRequests.find(w => w.id === id);
    if (!target) {
      return { success: false, error: 'Workflow request not found.' };
    }
    if (target.status !== 'pending') {
      return { success: false, error: `Request is already ${target.status} and locked.` };
    }

    // Strict Authorization Check: Prevent unauthorized or self-approval
    if (!canManageEmployee(target.employeeId)) {
      return {
        success: false,
        error: 'Unauthorized: You can only approve/reject requests for your authorized team/company and cannot approve your own requests.',
      };
    }

    const activeComp = target.companyId || currentCompanyId || 'default';
    const actorId = currentUser?.id || currentEmployee?.employeeId || currentEmployee?.id || 'approver';
    const actorName = currentUser?.name || currentEmployee?.name || 'Authorized Approver';
    const actorRole = currentUser?.role || (currentEmployee?.isManager ? 'Team Manager' : 'Approver');
    const nowIso = new Date().toISOString();
    const cleanReason = reason.trim() || (decision === 'approved' ? 'Verified and approved.' : 'Reviewed and declined.');

    const nextHistory: WorkflowStepHistory[] = [
      ...(Array.isArray(target.history) ? target.history : []),
      {
        status: decision,
        actorId,
        actorName,
        actorRole,
        timestamp: nowIso,
        reason: cleanReason,
      },
    ];

      // Update underlying linked LeaveRequest, AttendanceRequest, or ExpenseClaim if present
      if (target.requestType === 'leave' && (target.linkedRecordId || id.startsWith('wf_leave_'))) {
        const leaveId = target.linkedRecordId || id.replace('wf_leave_', '');
        if (decision === 'approved') {
          await approveLeave(leaveId, cleanReason);
        } else {
          await rejectLeave(leaveId, cleanReason);
        }
      } else if ((target.requestType === 'attendance_correction' || target.requestType === 'overtime') && (target.linkedRecordId || id.startsWith('wf_att_'))) {
        const attId = target.linkedRecordId || id.replace('wf_att_', '');
        await updateAttendanceRequestStatus(attId, decision, cleanReason);
      } else if (target.requestType === 'expense' && target.linkedRecordId) {
        const expId = target.linkedRecordId;
        const nextReimbStatus = decision === 'approved' ? 'awaiting_reimbursement' : 'rejected';
        setExpenseClaims(prev => prev.map(c => c.id === expId ? {
          ...c,
          status: decision,
          reimbursementStatus: nextReimbStatus,
          approverId: actorId,
          approverName: actorName,
          approverRole: actorRole,
          decisionReason: cleanReason,
          reviewedAt: nowIso,
        } : c));
        await syncRecordToFirestore('expense_claims', expId, {
          status: decision,
          reimbursementStatus: nextReimbStatus,
          approverId: actorId,
          approverName: actorName,
          approverRole: actorRole,
          decisionReason: cleanReason,
          reviewedAt: nowIso,
        }, activeComp);
      }

    // Persist workflow_requests document
    const updatedWf: WorkflowRequest = {
      ...target,
      status: decision,
      approverId: actorId,
      approverName: actorName,
      approverRole: actorRole,
      decisionReason: cleanReason,
      reviewedAt: nowIso,
      updatedAt: nowIso,
      history: nextHistory,
    };

    setRawWorkflowRequests(prev => {
      const exists = prev.some(w => w.id === id);
      return exists ? prev.map(w => w.id === id ? updatedWf : w) : [updatedWf, ...prev];
    });
    await syncRecordToFirestore('workflow_requests', id, updatedWf, activeComp);

    // Notify employee
    addNotification({
      title: `Request ${decision === 'approved' ? 'Approved' : 'Rejected'}: ${target.title}`,
      message: `Your ${target.title} request was ${decision} by ${actorName} (${actorRole}). Remarks: ${cleanReason}`,
      read: false,
      type: target.requestType === 'leave' ? 'leave' : 'attendance',
      forEmployeeId: target.employeeId,
    });

    await recordAuditLog({
      action: decision === 'approved' ? 'WORKFLOW_APPROVED' : 'WORKFLOW_REJECTED',
      category: 'leave_workflow',
      targetType: 'WorkflowRequest',
      targetId: id,
      targetName: `${target.title} (${target.employeeName})`,
      summary: `${actorName} (${actorRole}) ${decision} ${target.requestType} request for ${target.employeeName}: ${cleanReason}`,
      beforeValue: { status: 'pending' },
      afterValue: { status: decision, approverName: actorName, decisionReason: cleanReason },
    });

    return { success: true };
  };

  // =========================================================================
  // PHASE 1: EMPLOYEE DOCUMENT MANAGEMENT ENGINE
  // =========================================================================
  const uploadHRDocument = async (
    payload: Omit<HRDocument, 'id' | 'createdAt' | 'companyId' | 'uploadedBy' | 'uploadedByRole'>
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
        ? currentEmployee.companyId
        : (currentCompanyId || 'default');

      // Security check: if an employee uploads a document, it MUST be employee_private and scoped to their own employeeId
      if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
        if (payload.visibility !== 'employee_private' || (payload.employeeId !== currentEmployee.id && payload.employeeId !== currentEmployee.employeeId)) {
          return { success: false, error: 'Unauthorized: Employees can only upload personal documents to their own profile.' };
        }
      }

      const docId = `hrdoc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const nowIso = new Date().toISOString();
      const uploaderName = currentUser?.name || currentEmployee?.name || 'HR Admin';
      const uploaderRole = currentUser?.role || (currentEmployee ? 'Employee' : 'Admin');

      const newDoc: HRDocument = {
        ...payload,
        id: docId,
        uploadedBy: uploaderName,
        uploadedByRole: uploaderRole,
        createdAt: nowIso,
        updatedAt: nowIso,
        companyId: activeComp,
      };

      setHrDocuments(prev => [newDoc, ...prev]);
      await syncRecordToFirestore('hr_documents', docId, newDoc, activeComp);

      if (payload.visibility === 'employee_private' && payload.employeeId) {
        addNotification({
          title: 'New HR Document Added',
          message: `Document "${payload.title}" (${payload.category}) has been uploaded to your profile.`,
          read: false,
          type: 'system',
          forEmployeeId: payload.employeeId,
        });
      }

      await recordAuditLog({
        action: 'DOCUMENT_UPLOADED',
        category: 'document',
        targetType: 'HRDocument',
        targetId: docId,
        targetName: payload.title,
        summary: `${uploaderName} uploaded ${payload.visibility === 'company_policy' ? 'company policy' : `employee document for ${payload.employeeName || payload.employeeId}`}: "${payload.title}" (${payload.category})`,
        afterValue: { title: payload.title, category: payload.category, visibility: payload.visibility, employeeId: payload.employeeId, expiryDate: payload.expiryDate },
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to upload document.' };
    }
  };

  const deleteHRDocument = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const target = hrDocuments.find(d => d.id === id);
    if (!target) return { success: false, error: 'Document not found.' };
    if (isEmployeeAuthenticated && !isAuthenticated) {
      return { success: false, error: 'Only HR/Admin can delete official HR documents.' };
    }
    setHrDocuments(prev => prev.filter(d => d.id !== id));
    await deleteRecordFromFirestore('hr_documents', id);
    await recordAuditLog({
      action: 'DOCUMENT_DELETED',
      category: 'document',
      targetType: 'HRDocument',
      targetId: id,
      targetName: target.title,
      summary: `Deleted HR document "${target.title}" (${target.category})`,
      beforeValue: { title: target.title, category: target.category, employeeId: target.employeeId },
    });
    return { success: true };
  };

  const sendDocumentExpiryReminder = async (docId: string) => {
    const target = hrDocuments.find(d => d.id === docId);
    if (!target) return;
    const nowIso = new Date().toISOString();
    setHrDocuments(prev => prev.map(d => d.id === docId ? { ...d, lastReminderSentAt: nowIso } : d));
    await syncRecordToFirestore('hr_documents', docId, { lastReminderSentAt: nowIso }, target.companyId);

    addNotification({
      title: `⚠️ Document Expiry Reminder: ${target.title}`,
      message: `Your document "${target.title}" (${target.category}) expires on ${target.expiryDate || 'soon'}. Please upload a renewed copy.`,
      read: false,
      type: 'system',
      forEmployeeId: target.employeeId,
    });

    if (target.employeeId) {
      await sendMessage({
        to: target.employeeName || target.employeeId,
        toEmployeeId: target.employeeId,
        subject: `Document Expiry Alert: ${target.title}`,
        content: `Dear ${target.employeeName || 'Team Member'}, your document "${target.title}" (${target.category}) has an expiry date of ${target.expiryDate}. Please submit an updated copy via Employee Self-Service > Documents.`,
      });
    }

    await recordAuditLog({
      action: 'DOCUMENT_EXPIRY_REMINDER_SENT',
      category: 'document',
      targetType: 'HRDocument',
      targetId: docId,
      targetName: target.title,
      summary: `Sent expiry reminder for "${target.title}" to ${target.employeeName || target.employeeId || 'employee'}`,
    });
  };

  // =========================================================================
  // PHASE 2: PERFORMANCE MANAGEMENT ENGINE
  // =========================================================================
  const savePerformanceCycle = async (
    payload: Omit<PerformanceCycle, 'id' | 'createdAt' | 'companyId'> & { id?: string }
  ): Promise<PerformanceCycle> => {
    const activeComp = currentCompanyId || 'default';
    const id = payload.id || `pcycle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const cycle: PerformanceCycle = {
      ...payload,
      id,
      createdAt: nowIso,
      companyId: activeComp,
    };
    setPerformanceCycles(prev => {
      const exists = prev.some(c => c.id === id);
      const next = exists ? prev.map(c => c.id === id ? cycle : c) : [cycle, ...prev];
      try { localStorage.setItem(`worknest_perf_cycles_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('performance_cycles', id, cycle, activeComp);
    await recordAuditLog({
      action: payload.id ? 'PERFORMANCE_CYCLE_UPDATED' : 'PERFORMANCE_CYCLE_CREATED',
      category: 'performance',
      targetType: 'PerformanceCycle',
      targetId: id,
      targetName: cycle.title,
      summary: `${payload.id ? 'Updated' : 'Created'} appraisal cycle "${cycle.title}" (${cycle.startDate} to ${cycle.endDate})`,
      afterValue: cycle,
    });
    return cycle;
  };

  const deletePerformanceCycle = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    const target = performanceCycles.find(c => c.id === id);
    setPerformanceCycles(prev => {
      const next = prev.filter(c => c.id !== id);
      try { localStorage.setItem(`worknest_perf_cycles_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('performance_cycles', id);
    await recordAuditLog({
      action: 'PERFORMANCE_CYCLE_DELETED',
      category: 'performance',
      targetType: 'PerformanceCycle',
      targetId: id,
      targetName: target?.title || id,
      summary: `Deleted appraisal cycle "${target?.title || id}"`,
    });
  };

  const savePerformanceGoal = async (
    payload: Omit<PerformanceGoal, 'id' | 'updatedAt' | 'companyId'> & { id?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
      ? currentEmployee.companyId
      : (currentCompanyId || 'default');

    // RBAC check: Employee can create/update own goals; Manager can create/update authorized team goals; HR/Admin can manage company goals
    const isOwnGoal = Boolean(
      currentEmployee &&
      (payload.employeeId === currentEmployee.id || payload.employeeId === currentEmployee.employeeId)
    );
    if (!isOwnGoal && !canManageEmployee(payload.employeeId) && !(isAuthenticated && (currentUser?.role === 'Super Admin' || currentUser?.role === 'HR Manager' || currentUser?.permissions?.performance))) {
      return { success: false, error: 'Unauthorized: You do not have permission to assign or edit goals for this employee.' };
    }

    const id = payload.id || `pgoal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const goal: PerformanceGoal = {
      ...payload,
      id,
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setPerformanceGoals(prev => {
      const exists = prev.some(g => g.id === id);
      const next = exists ? prev.map(g => g.id === id ? goal : g) : [goal, ...prev];
      try { localStorage.setItem(`worknest_perf_goals_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('performance_goals', id, goal, activeComp);
    await recordAuditLog({
      action: payload.id ? 'PERFORMANCE_GOAL_UPDATED' : 'PERFORMANCE_GOAL_CREATED',
      category: 'performance',
      targetType: 'PerformanceGoal',
      targetId: id,
      targetName: `${goal.title} (${goal.employeeName})`,
      summary: `${payload.id ? 'Updated' : 'Assigned'} KPI/Goal "${goal.title}" (Weight: ${goal.weightage}%, Progress: ${goal.progress}%) for ${goal.employeeName}`,
      afterValue: { title: goal.title, weightage: goal.weightage, progress: goal.progress, status: goal.status },
    });
    return { success: true };
  };

  const updateGoalProgress = async (
    goalId: string,
    progress: number,
    status?: PerformanceGoal['status'],
    notes?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const goal = performanceGoals.find(g => g.id === goalId);
    if (!goal) return { success: false, error: 'Goal not found.' };

    const isOwn = Boolean(
      currentEmployee &&
      (goal.employeeId === currentEmployee.id || goal.employeeId === currentEmployee.employeeId)
    );
    if (!isOwn && !canManageEmployee(goal.employeeId) && !(isAuthenticated && currentUser)) {
      return { success: false, error: 'Unauthorized to update this goal.' };
    }

    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    const nextStatus: PerformanceGoal['status'] =
      status || (clamped >= 100 ? 'completed' : clamped > 0 ? 'in_progress' : 'not_started');
    const nowIso = new Date().toISOString();
    const updatedGoal: PerformanceGoal = {
      ...goal,
      progress: clamped,
      status: nextStatus,
      notes: notes !== undefined ? notes : goal.notes,
      updatedAt: nowIso,
    };

    setPerformanceGoals(prev => {
      const next = prev.map(g => g.id === goalId ? updatedGoal : g);
      try { localStorage.setItem(`worknest_perf_goals_${goal.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('performance_goals', goalId, updatedGoal, goal.companyId);
    return { success: true };
  };

  const deletePerformanceGoal = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    setPerformanceGoals(prev => {
      const next = prev.filter(g => g.id !== id);
      try { localStorage.setItem(`worknest_perf_goals_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('performance_goals', id);
  };

  const submitSelfEvaluation = async (payload: {
    cycleId: string;
    cycleTitle: string;
    employeeId: string;
    employeeName: string;
    department: string;
    designation: string;
    selfRating: number;
    selfAchievements: string;
    selfChallenges: string;
    selfGrowthPlan: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
      ? currentEmployee.companyId
      : (currentCompanyId || 'default');

    if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
      if (payload.employeeId !== currentEmployee.id && payload.employeeId !== currentEmployee.employeeId) {
        return { success: false, error: 'Unauthorized: You can only submit your own self-evaluation.' };
      }
    }

    const nowIso = new Date().toISOString();
    const existing = performanceAppraisals.find(
      a => a.cycleId === payload.cycleId && a.employeeId === payload.employeeId
    );
    const id = existing?.id || `appr_${payload.cycleId}_${payload.employeeId}`;

    const appraisal: PerformanceAppraisal = {
      ...(existing || {
        comments: [],
      }),
      id,
      cycleId: payload.cycleId,
      cycleTitle: payload.cycleTitle,
      employeeId: payload.employeeId,
      employeeName: payload.employeeName,
      department: payload.department,
      designation: payload.designation,
      selfRating: payload.selfRating,
      selfAchievements: payload.selfAchievements,
      selfChallenges: payload.selfChallenges,
      selfGrowthPlan: payload.selfGrowthPlan,
      selfSubmittedAt: nowIso,
      status: existing?.status === 'completed' ? 'completed' : 'pending_manager',
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setPerformanceAppraisals(prev => {
      const exists = prev.some(a => a.id === id);
      const next = exists ? prev.map(a => a.id === id ? appraisal : a) : [appraisal, ...prev];
      try { localStorage.setItem(`worknest_perf_appraisals_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('performance_appraisals', id, appraisal, activeComp);
    await recordAuditLog({
      action: 'PERFORMANCE_SELF_EVAL_SUBMITTED',
      category: 'performance',
      targetType: 'PerformanceAppraisal',
      targetId: id,
      targetName: `${payload.employeeName} - ${payload.cycleTitle}`,
      summary: `${payload.employeeName} submitted self-evaluation (${payload.selfRating}/5) for ${payload.cycleTitle}`,
    });
    return { success: true };
  };

  const submitManagerEvaluation = async (payload: {
    cycleId: string;
    cycleTitle: string;
    employeeId: string;
    employeeName: string;
    department: string;
    designation: string;
    competencyRatings: NonNullable<PerformanceAppraisal['competencyRatings']>;
    managerRating: number;
    kpiWeightedScore: number;
    finalRating: number;
    finalGrade: string;
    managerFeedback: string;
    promotionRecommended: boolean;
    recommendedIncrementPercent: number;
  }): Promise<{ success: boolean; error?: string }> => {
    if (!canManageEmployee(payload.employeeId)) {
      return {
        success: false,
        error: 'Unauthorized: You can only evaluate employees within your authorized team/company and cannot evaluate yourself as manager.',
      };
    }

    const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
      ? currentEmployee.companyId
      : (currentCompanyId || 'default');
    const nowIso = new Date().toISOString();
    const actorId = currentUser?.id || currentEmployee?.employeeId || currentEmployee?.id || 'manager';
    const actorName = currentUser?.name || currentEmployee?.name || 'Manager';

    const existing = performanceAppraisals.find(
      a => a.cycleId === payload.cycleId && a.employeeId === payload.employeeId
    );
    const id = existing?.id || `appr_${payload.cycleId}_${payload.employeeId}`;

    const appraisal: PerformanceAppraisal = {
      ...(existing || {
        comments: [],
      }),
      id,
      cycleId: payload.cycleId,
      cycleTitle: payload.cycleTitle,
      employeeId: payload.employeeId,
      employeeName: payload.employeeName,
      department: payload.department,
      designation: payload.designation,
      competencyRatings: payload.competencyRatings,
      managerRating: payload.managerRating,
      kpiWeightedScore: payload.kpiWeightedScore,
      finalRating: payload.finalRating,
      finalGrade: payload.finalGrade,
      managerFeedback: payload.managerFeedback,
      promotionRecommended: payload.promotionRecommended,
      recommendedIncrementPercent: payload.recommendedIncrementPercent,
      evaluatedById: actorId,
      evaluatedByName: actorName,
      evaluatedAt: nowIso,
      status: 'completed',
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setPerformanceAppraisals(prev => {
      const exists = prev.some(a => a.id === id);
      const next = exists ? prev.map(a => a.id === id ? appraisal : a) : [appraisal, ...prev];
      try { localStorage.setItem(`worknest_perf_appraisals_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('performance_appraisals', id, appraisal, activeComp);

    addNotification({
      title: `Performance Appraisal Completed: ${payload.cycleTitle}`,
      message: `${actorName} finalized your performance evaluation for ${payload.cycleTitle}. Final Rating: ${payload.finalRating}/5 (${payload.finalGrade}).`,
      read: false,
      type: 'system',
      forEmployeeId: payload.employeeId,
    });

    await recordAuditLog({
      action: 'PERFORMANCE_MANAGER_EVAL_COMPLETED',
      category: 'performance',
      targetType: 'PerformanceAppraisal',
      targetId: id,
      targetName: `${payload.employeeName} - ${payload.cycleTitle}`,
      summary: `${actorName} completed manager appraisal for ${payload.employeeName}: Final Rating ${payload.finalRating}/5 (${payload.finalGrade})`,
      afterValue: { finalRating: payload.finalRating, finalGrade: payload.finalGrade, promotionRecommended: payload.promotionRecommended, recommendedIncrementPercent: payload.recommendedIncrementPercent },
    });
    return { success: true };
  };

  const addPerformanceComment = async (appraisalId: string, comment: string) => {
    const target = performanceAppraisals.find(a => a.id === appraisalId);
    if (!target || !comment.trim()) return;
    const nowIso = new Date().toISOString();
    const authorId = currentUser?.id || currentEmployee?.employeeId || currentEmployee?.id || 'user';
    const authorName = currentUser?.name || currentEmployee?.name || 'User';
    const authorRole = currentUser?.role || (currentEmployee?.isManager ? 'Team Manager' : 'Employee');

    const newComment: PerformanceReviewComment = {
      id: `pcomm_${Date.now()}`,
      authorId,
      authorName,
      authorRole,
      comment: comment.trim(),
      timestamp: nowIso,
    };

    const nextComments = [...(target.comments || []), newComment];
    setPerformanceAppraisals(prev => {
      const next = prev.map(a => a.id === appraisalId ? { ...a, comments: nextComments, updatedAt: nowIso } : a);
      try { localStorage.setItem(`worknest_perf_appraisals_${target.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('performance_appraisals', appraisalId, { comments: nextComments, updatedAt: nowIso }, target.companyId);
  };

  // =========================================================================
  // PHASE 2: EXPENSE MANAGEMENT ENGINE (Bidirectionally synced with Workflow Engine)
  // =========================================================================
  const submitExpenseClaim = async (
    payload: Omit<ExpenseClaim, 'id' | 'status' | 'reimbursementStatus' | 'createdAt' | 'companyId'>
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
        ? currentEmployee.companyId
        : (currentCompanyId || 'default');

      if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
        if (payload.employeeId !== currentEmployee.id && payload.employeeId !== currentEmployee.employeeId) {
          return { success: false, error: 'Unauthorized: You can only submit expense claims for yourself.' };
        }
      }

      const expId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const nowIso = new Date().toISOString();

      // Create linked WorkflowRequest so it appears in Unified Approval Engine & Manager Self-Service
      const wfRes = await submitWorkflowRequest({
        requestType: 'expense',
        subType: payload.category,
        employeeId: payload.employeeId,
        employeeName: payload.employeeName,
        department: payload.department,
        branch: payload.branch,
        title: `${payload.category}: ${payload.title} (৳${payload.amount.toLocaleString()})`,
        date: payload.expenseDate,
        amountBDT: payload.amount,
        reason: payload.description,
        attachmentName: payload.receiptName,
        attachmentType: payload.receiptType,
        attachmentSize: payload.receiptSize,
        attachmentDataUrl: payload.receiptDataUrl,
        requesterId: payload.employeeId,
        requesterName: payload.employeeName,
        linkedRecordId: expId,
      });

      const claim: ExpenseClaim = {
        ...payload,
        id: expId,
        status: 'pending',
        reimbursementStatus: 'pending_approval',
        workflowRequestId: wfRes.id,
        createdAt: nowIso,
        companyId: activeComp,
      };

      setExpenseClaims(prev => {
        const next = [claim, ...prev];
        try { localStorage.setItem(`worknest_expense_claims_${activeComp}`, JSON.stringify(next)); } catch {}
        return next;
      });
      await syncRecordToFirestore('expense_claims', expId, claim, activeComp);

      await recordAuditLog({
        action: 'EXPENSE_CLAIM_SUBMITTED',
        category: 'expense',
        targetType: 'ExpenseClaim',
        targetId: expId,
        targetName: `${payload.title} (${payload.employeeName})`,
        summary: `${payload.employeeName} submitted expense claim "${payload.title}" (${payload.category}) for ৳${payload.amount.toLocaleString()}`,
        afterValue: { category: payload.category, amount: payload.amount, expenseDate: payload.expenseDate },
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to submit expense claim.' };
    }
  };

  const decideExpenseClaim = async (
    id: string,
    decision: 'approved' | 'rejected',
    reason: string
  ): Promise<{ success: boolean; error?: string }> => {
    const claim = expenseClaims.find(c => c.id === id);
    if (!claim) return { success: false, error: 'Expense claim not found.' };
    if (claim.status !== 'pending') return { success: false, error: `Claim is already ${claim.status}.` };

    if (!canManageEmployee(claim.employeeId)) {
      return {
        success: false,
        error: 'Unauthorized: You can only approve/reject expense claims for your authorized team/company and cannot approve your own claims.',
      };
    }

    const nowIso = new Date().toISOString();
    const actorId = currentUser?.id || currentEmployee?.employeeId || currentEmployee?.id || 'approver';
    const actorName = currentUser?.name || currentEmployee?.name || 'Approver';
    const actorRole = currentUser?.role || (currentEmployee?.isManager ? 'Team Manager' : 'Approver');
    const cleanReason = reason.trim() || (decision === 'approved' ? 'Verified and approved for reimbursement.' : 'Declined.');
    const nextReimbStatus: ExpenseClaim['reimbursementStatus'] =
      decision === 'approved' ? 'awaiting_reimbursement' : 'rejected';

    const updatedClaim: ExpenseClaim = {
      ...claim,
      status: decision,
      reimbursementStatus: nextReimbStatus,
      approverId: actorId,
      approverName: actorName,
      approverRole: actorRole,
      decisionReason: cleanReason,
      reviewedAt: nowIso,
    };

    setExpenseClaims(prev => {
      const next = prev.map(c => c.id === id ? updatedClaim : c);
      try { localStorage.setItem(`worknest_expense_claims_${claim.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('expense_claims', id, updatedClaim, claim.companyId);

    // Sync linked WorkflowRequest if present
    if (claim.workflowRequestId) {
      const wf = rawWorkflowRequests.find(w => w.id === claim.workflowRequestId);
      if (wf && wf.status === 'pending') {
        const updatedWf: WorkflowRequest = {
          ...wf,
          status: decision,
          approverId: actorId,
          approverName: actorName,
          approverRole: actorRole,
          decisionReason: cleanReason,
          reviewedAt: nowIso,
          updatedAt: nowIso,
          history: [
            ...(wf.history || []),
            {
              status: decision,
              actorId,
              actorName,
              actorRole,
              timestamp: nowIso,
              reason: cleanReason,
            },
          ],
        };
        setRawWorkflowRequests(prev => prev.map(w => w.id === wf.id ? updatedWf : w));
        await syncRecordToFirestore('workflow_requests', wf.id, updatedWf, claim.companyId);
      }
    }

    addNotification({
      title: `Expense Claim ${decision === 'approved' ? 'Approved' : 'Rejected'}: ${claim.title}`,
      message: `Your expense claim for ৳${claim.amount.toLocaleString()} (${claim.category}) was ${decision} by ${actorName}. Remarks: ${cleanReason}`,
      read: false,
      type: 'payroll',
      forEmployeeId: claim.employeeId,
    });

    await recordAuditLog({
      action: decision === 'approved' ? 'EXPENSE_CLAIM_APPROVED' : 'EXPENSE_CLAIM_REJECTED',
      category: 'expense',
      targetType: 'ExpenseClaim',
      targetId: id,
      targetName: `${claim.title} (${claim.employeeName})`,
      summary: `${actorName} (${actorRole}) ${decision} expense claim of ৳${claim.amount.toLocaleString()} for ${claim.employeeName}: ${cleanReason}`,
      beforeValue: { status: 'pending' },
      afterValue: { status: decision, reimbursementStatus: nextReimbStatus, decisionReason: cleanReason },
    });

    return { success: true };
  };

  const reimburseExpenseClaim = async (
    id: string,
    method: NonNullable<ExpenseClaim['reimbursementMethod']>,
    reference: string,
    payrollMonth?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const claim = expenseClaims.find(c => c.id === id);
    if (!claim) return { success: false, error: 'Expense claim not found.' };
    if (claim.status !== 'approved') return { success: false, error: 'Only approved expense claims can be reimbursed.' };

    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || 'Finance / Payroll Admin';
    const nextStatus: ExpenseClaim['reimbursementStatus'] =
      method === 'Added to Monthly Payroll' ? 'settled_in_payroll' : 'reimbursed';

    const updatedClaim: ExpenseClaim = {
      ...claim,
      reimbursementStatus: nextStatus,
      reimbursedAt: nowIso,
      reimbursedBy: actorName,
      reimbursementMethod: method,
      reimbursementMonth: payrollMonth,
      paymentReference: reference || `REIMB-${Date.now().toString().slice(-6)}`,
    };

    setExpenseClaims(prev => {
      const next = prev.map(c => c.id === id ? updatedClaim : c);
      try { localStorage.setItem(`worknest_expense_claims_${claim.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('expense_claims', id, updatedClaim, claim.companyId);

    addNotification({
      title: `💳 Expense Reimbursed: ${claim.title}`,
      message: `Your approved expense claim of ৳${claim.amount.toLocaleString()} has been ${method === 'Added to Monthly Payroll' ? `added to your ${payrollMonth || 'monthly'} payroll` : `reimbursed via ${method}`} (Ref: ${updatedClaim.paymentReference}).`,
      read: false,
      type: 'payroll',
      forEmployeeId: claim.employeeId,
    });

    await recordAuditLog({
      action: 'EXPENSE_CLAIM_REIMBURSED',
      category: 'expense',
      targetType: 'ExpenseClaim',
      targetId: id,
      targetName: `${claim.title} (${claim.employeeName})`,
      summary: `${actorName} reimbursed ৳${claim.amount.toLocaleString()} to ${claim.employeeName} via ${method}`,
      afterValue: { reimbursementStatus: nextStatus, method, reference: updatedClaim.paymentReference },
    });

    return { success: true };
  };

  // =========================================================================
  // PHASE 2: ONBOARDING ENGINE
  // =========================================================================
  const initiateOnboarding = async (
    emp: Employee,
    mentorName?: string,
    probationEndDate?: string
  ): Promise<OnboardingRecord> => {
    const activeComp = emp.companyId || currentCompanyId || 'default';
    const existing = onboardingRecords.find(
      o => o.employeeId === emp.id || o.employeeCode === emp.employeeId
    );
    if (existing) return existing;

    const nowIso = new Date().toISOString();
    const joinD = emp.joinDate || nowIso.split('T')[0];
    const defaultProbation = probationEndDate || (() => {
      const d = new Date(joinD);
      d.setMonth(d.getMonth() + 3);
      return d.toISOString().split('T')[0];
    })();

    const defaultTasks: OnboardingTaskItem[] = [
      {
        id: 'ob_doc_nid',
        title: 'Submit National ID (NID) / Passport Copy',
        category: 'Required Document',
        assignedToRole: 'Employee',
        completed: false,
        linkedDocumentCategory: 'ID / NID / Passport',
      },
      {
        id: 'ob_doc_contract',
        title: 'Upload Signed Offer & Employment Contract',
        category: 'Required Document',
        assignedToRole: 'Employee',
        completed: false,
        linkedDocumentCategory: 'Employment Contract',
      },
      {
        id: 'ob_doc_academic',
        title: 'Submit Academic & Experience Certificates',
        category: 'Required Document',
        assignedToRole: 'Employee',
        completed: false,
        linkedDocumentCategory: 'Academic / Certificate',
      },
      {
        id: 'ob_join_profile',
        title: 'Complete Personal Address, Emergency Contact & Bank Account Details',
        category: 'Joining Task',
        assignedToRole: 'Employee',
        completed: Boolean(emp.address && emp.emergencyContact && emp.accountNumber),
      },
      {
        id: 'ob_policy_ack',
        title: 'Read & Digitally Acknowledge Employee Handbook & Code of Conduct',
        category: 'Policy Acknowledgement',
        assignedToRole: 'Employee',
        completed: false,
      },
      {
        id: 'ob_hr_biometric',
        title: 'Enroll Biometric Face/Fingerprint on ZKTeco Terminal & Issue RFID Badge',
        category: 'HR Task',
        assignedToRole: 'HR',
        completed: Boolean(emp.rfidCard),
      },
      {
        id: 'ob_hr_payroll',
        title: 'Verify Salary Breakdown (Basic, HRA, Medical, Conveyance) & Shift Assignment',
        category: 'HR Task',
        assignedToRole: 'HR',
        completed: Boolean((emp.grossSalary || emp.basicSalary) && emp.shift),
      },
      {
        id: 'ob_mgr_orientation',
        title: 'Conduct Department Orientation & Assign 30-60-90 Day KPIs',
        category: 'Manager Task',
        assignedToRole: 'Manager',
        completed: false,
      },
      {
        id: 'ob_it_workstation',
        title: 'Provision Official Workstation, Email & System Access Credentials',
        category: 'IT & Access',
        assignedToRole: 'IT',
        completed: true,
        completedBy: 'System Provisioner',
        completedAt: nowIso,
      },
    ];

    const completedCount = defaultTasks.filter(t => t.completed).length;
    const progress = Math.round((completedCount / defaultTasks.length) * 100);
    const id = `onb_${emp.id}`;

    const record: OnboardingRecord = {
      id,
      employeeId: emp.id,
      employeeCode: emp.employeeId,
      employeeName: emp.name,
      department: emp.department,
      designation: emp.designation,
      branch: getEmployeeBranch(emp),
      joinDate: joinD,
      mentorName: mentorName || emp.managerName || 'Department Lead',
      probationEndDate: defaultProbation,
      policyAcknowledged: false,
      tasks: defaultTasks,
      progress,
      status: progress === 100 ? 'completed' : 'in_progress',
      createdAt: nowIso,
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setOnboardingRecords(prev => {
      const next = [record, ...prev.filter(r => r.id !== id)];
      try { localStorage.setItem(`worknest_onboarding_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('onboarding_records', id, record, activeComp);

    await recordAuditLog({
      action: 'ONBOARDING_INITIATED',
      category: 'onboarding_offboarding',
      targetType: 'OnboardingRecord',
      targetId: id,
      targetName: emp.name,
      summary: `Initiated structured onboarding checklist for ${emp.name} (${emp.employeeId})`,
      afterValue: { joinDate: joinD, mentorName: record.mentorName, progress },
    });

    return record;
  };

  const toggleOnboardingTask = async (
    recordId: string,
    taskId: string,
    notes?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const rec = onboardingRecords.find(r => r.id === recordId);
    if (!rec) return { success: false, error: 'Onboarding record not found.' };

    const targetTask = rec.tasks.find(t => t.id === taskId);
    if (!targetTask) return { success: false, error: 'Task not found.' };

    // Permission check: Employee can toggle only own 'Employee' role tasks; Manager/HR/Admin can toggle tasks for authorized employees
    if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
      const isOwn = rec.employeeId === currentEmployee.id || rec.employeeCode === currentEmployee.employeeId;
      if (isOwn && targetTask.assignedToRole !== 'Employee' && !currentEmployee.isManager) {
        return { success: false, error: `Only ${targetTask.assignedToRole} / HR can verify and sign off this task.` };
      }
      if (!isOwn && !canManageEmployee(rec.employeeId)) {
        return { success: false, error: 'Unauthorized to modify onboarding tasks for this employee.' };
      }
    }

    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || currentEmployee?.name || 'User';

    const nextTasks = rec.tasks.map(t => {
      if (t.id !== taskId) return t;
      const nextCompleted = !t.completed;
      return {
        ...t,
        completed: nextCompleted,
        completedBy: nextCompleted ? actorName : undefined,
        completedAt: nextCompleted ? nowIso : undefined,
        notes: notes !== undefined ? notes : t.notes,
      };
    });

    const completedCount = nextTasks.filter(t => t.completed).length;
    const progress = nextTasks.length > 0 ? Math.round((completedCount / nextTasks.length) * 100) : 0;
    const nextStatus: OnboardingRecord['status'] = progress === 100 ? 'completed' : 'in_progress';

    const updated: OnboardingRecord = {
      ...rec,
      tasks: nextTasks,
      progress,
      status: nextStatus,
      updatedAt: nowIso,
    };

    setOnboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_onboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('onboarding_records', recordId, updated, rec.companyId);

    if (nextStatus === 'completed' && rec.status !== 'completed') {
      await recordAuditLog({
        action: 'ONBOARDING_COMPLETED',
        category: 'onboarding_offboarding',
        targetType: 'OnboardingRecord',
        targetId: recordId,
        targetName: rec.employeeName,
        summary: `${rec.employeeName} (${rec.employeeCode}) completed 100% of onboarding checklist.`,
      });
    }

    return { success: true };
  };

  const addOnboardingTask = async (
    recordId: string,
    task: Omit<OnboardingTaskItem, 'id' | 'completed'>
  ) => {
    const rec = onboardingRecords.find(r => r.id === recordId);
    if (!rec) return;
    const nowIso = new Date().toISOString();
    const newTask: OnboardingTaskItem = {
      ...task,
      id: `ob_custom_${Date.now()}`,
      completed: false,
    };
    const nextTasks = [...rec.tasks, newTask];
    const completedCount = nextTasks.filter(t => t.completed).length;
    const progress = Math.round((completedCount / nextTasks.length) * 100);
    const updated: OnboardingRecord = {
      ...rec,
      tasks: nextTasks,
      progress,
      status: progress === 100 ? 'completed' : 'in_progress',
      updatedAt: nowIso,
    };
    setOnboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_onboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('onboarding_records', recordId, updated, rec.companyId);
  };

  const acknowledgeOnboardingPolicy = async (
    recordId: string,
    signature: string
  ): Promise<{ success: boolean; error?: string }> => {
    const rec = onboardingRecords.find(r => r.id === recordId);
    if (!rec) return { success: false, error: 'Onboarding record not found.' };
    const nowIso = new Date().toISOString();
    const actorName = currentEmployee?.name || currentUser?.name || rec.employeeName;

    const nextTasks = rec.tasks.map(t =>
      t.category === 'Policy Acknowledgement'
        ? { ...t, completed: true, completedBy: actorName, completedAt: nowIso }
        : t
    );
    const completedCount = nextTasks.filter(t => t.completed).length;
    const progress = nextTasks.length > 0 ? Math.round((completedCount / nextTasks.length) * 100) : 100;

    const updated: OnboardingRecord = {
      ...rec,
      policyAcknowledged: true,
      policyAcknowledgedAt: nowIso,
      policySignature: signature.trim() || actorName,
      tasks: nextTasks,
      progress,
      status: progress === 100 ? 'completed' : 'in_progress',
      updatedAt: nowIso,
    };

    setOnboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_onboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('onboarding_records', recordId, updated, rec.companyId);

    await recordAuditLog({
      action: 'ONBOARDING_POLICY_ACKNOWLEDGED',
      category: 'onboarding_offboarding',
      targetType: 'OnboardingRecord',
      targetId: recordId,
      targetName: rec.employeeName,
      summary: `${rec.employeeName} digitally signed and acknowledged Company Policies & Code of Conduct`,
      afterValue: { policySignature: updated.policySignature, policyAcknowledgedAt: nowIso },
    });

    return { success: true };
  };

  // =========================================================================
  // PHASE 2: OFFBOARDING & FINAL SETTLEMENT ENGINE
  // =========================================================================
  const initiateOffboarding = async (payload: {
    employeeId: string;
    exitType: OffboardingRecord['exitType'];
    reason: string;
    initiatedDate: string;
    noticePeriodDaysRequired: number;
    noticePeriodDaysServed: number;
    lastWorkingDay: string;
  }): Promise<{ success: boolean; record?: OffboardingRecord; error?: string }> => {
    const emp = allEmployees.find(e => e.id === payload.employeeId || e.employeeId === payload.employeeId) || currentEmployee;
    if (!emp) return { success: false, error: 'Employee not found.' };

    // Security check: Employee can only initiate resignation for themselves
    if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
      if (emp.id !== currentEmployee.id && emp.employeeId !== currentEmployee.employeeId) {
        return { success: false, error: 'Unauthorized: You can only submit a resignation request for yourself.' };
      }
    }

    const activeComp = emp.companyId || currentCompanyId || 'default';
    const nowIso = new Date().toISOString();
    const id = `offb_${emp.id}`;
    const actorName = currentUser?.name || currentEmployee?.name || emp.name;

    const gross = Number(emp.grossSalary) || ((Number(emp.basicSalary ?? emp.basic) || 15000) * 2);
    const oneDayGross = Math.round(gross / 30);
    const shortfallDays = Math.max(0, payload.noticePeriodDaysRequired - payload.noticePeriodDaysServed);
    const noticePayRecovery = shortfallDays * oneDayGross;

    // Calculate active advance/loan balance for this employee
    const activeLoansBalance = salaryAdvancesLoans
      .filter(a => (a.employeeId === emp.id || a.employeeId === emp.employeeId) && a.status === 'active')
      .reduce((sum, a) => sum + (Number(a.remainingBalance) || 0), 0);

    const unpaidDays = 15;
    const unpaidSalaryAmount = unpaidDays * oneDayGross;
    const earnedLeaveDays = 5;
    const leaveEncashmentAmount = earnedLeaveDays * oneDayGross;
    const settlementMonth = payload.lastWorkingDay ? payload.lastWorkingDay.slice(0, 7) : nowIso.slice(0, 7);

    const defaultClearances: OffboardingClearanceItem[] = [
      {
        id: 'clr_mgr_handover',
        department: 'Reporting Manager',
        title: 'Knowledge Transfer (KT) & Project Handover Completed',
        cleared: false,
      },
      {
        id: 'clr_it_revoke',
        department: 'IT & Systems',
        title: 'Corporate Email, Cloud Workspace & VPN Access Audit',
        cleared: false,
      },
      {
        id: 'clr_fin_dues',
        department: 'Finance & Accounts',
        title: 'Salary Advance, Loan & Expense Claim Reconciliation',
        cleared: activeLoansBalance === 0,
      },
      {
        id: 'clr_hr_biometric',
        department: 'HR & Administration',
        title: 'ID Card, RFID Badge Return & Exit File Verification',
        cleared: false,
      },
    ];

    const defaultAssets: OffboardingAssetItem[] = [
      {
        id: 'ast_idcard',
        assetName: 'Employee ID Card & RFID Access Badge',
        assetTag: emp.rfidCard || `RFID-${emp.employeeId}`,
        category: 'ID Card / RFID Badge',
        status: 'pending_return',
        deductionAmount: 0,
      },
      {
        id: 'ast_laptop',
        assetName: 'Corporate Workstation / Laptop',
        assetTag: `WS-${emp.employeeId}`,
        category: 'Laptop / PC',
        status: 'pending_return',
        deductionAmount: 0,
      },
    ];

    const netSettlement = Math.max(
      0,
      unpaidSalaryAmount + leaveEncashmentAmount - noticePayRecovery - activeLoansBalance
    );

    const record: OffboardingRecord = {
      id,
      employeeId: emp.id,
      employeeCode: emp.employeeId,
      employeeName: emp.name,
      department: emp.department,
      designation: emp.designation,
      branch: getEmployeeBranch(emp),
      exitType: payload.exitType,
      reason: payload.reason,
      initiatedBy: actorName,
      initiatedDate: payload.initiatedDate,
      noticePeriodDaysRequired: payload.noticePeriodDaysRequired,
      noticePeriodDaysServed: payload.noticePeriodDaysServed,
      lastWorkingDay: payload.lastWorkingDay,
      clearances: defaultClearances,
      assets: defaultAssets,
      documentsStatus: {
        experienceCertificate: false,
        releaseLetter: false,
        nocIssued: false,
      },
      exitInterview: {
        completed: false,
        primaryReasonForLeaving: payload.reason,
        workEnvironmentRating: 4,
        managementSupportRating: 4,
        wouldRecommendCompany: true,
        keyFeedback: '',
      },
      finalSettlement: {
        settlementMonth,
        unpaidSalaryDays: unpaidDays,
        unpaidSalaryAmount,
        earnedLeaveDays,
        leaveEncashmentAmount,
        gratuityOrServiceBenefit: 0,
        noticeShortfallDays: shortfallDays,
        noticePayRecovery,
        assetDamageDeduction: 0,
        loanOrAdvanceRecovery: activeLoansBalance,
        netSettlementAmount: netSettlement,
        status: 'draft',
      },
      accessTerminated: false,
      status: 'in_clearance',
      createdAt: nowIso,
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setOffboardingRecords(prev => {
      const next = [record, ...prev.filter(r => r.id !== id)];
      try { localStorage.setItem(`worknest_offboarding_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('offboarding_records', id, record, activeComp);

    await recordAuditLog({
      action: 'OFFBOARDING_INITIATED',
      category: 'onboarding_offboarding',
      targetType: 'OffboardingRecord',
      targetId: id,
      targetName: `${emp.name} (${emp.employeeId})`,
      summary: `${actorName} initiated ${payload.exitType} workflow for ${emp.name}. Last working day: ${payload.lastWorkingDay}`,
      afterValue: { exitType: payload.exitType, lastWorkingDay: payload.lastWorkingDay, reason: payload.reason },
    });

    return { success: true, record };
  };

  const updateOffboardingClearance = async (
    recordId: string,
    clearanceId: string,
    cleared: boolean,
    remarks?: string
  ) => {
    const rec = offboardingRecords.find(r => r.id === recordId);
    if (!rec) return;
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || currentEmployee?.name || 'Approver';
    const nextClearances = rec.clearances.map(c =>
      c.id === clearanceId
        ? {
            ...c,
            cleared,
            clearedBy: cleared ? actorName : undefined,
            clearedAt: cleared ? nowIso : undefined,
            remarks: remarks !== undefined ? remarks : c.remarks,
          }
        : c
    );
    const allCleared = nextClearances.every(c => c.cleared);
    const allAssetsReturned = rec.assets.every(a => a.status !== 'pending_return');
    const nextStatus: OffboardingRecord['status'] =
      rec.status === 'completed'
        ? 'completed'
        : allCleared && allAssetsReturned
        ? 'ready_for_settlement'
        : 'in_clearance';

    const updated: OffboardingRecord = {
      ...rec,
      clearances: nextClearances,
      status: nextStatus,
      updatedAt: nowIso,
    };
    setOffboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_offboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('offboarding_records', recordId, updated, rec.companyId);
  };

  const addOffboardingAsset = async (recordId: string, asset: Omit<OffboardingAssetItem, 'id'>) => {
    const rec = offboardingRecords.find(r => r.id === recordId);
    if (!rec) return;
    const nowIso = new Date().toISOString();
    const nextAssets = [...rec.assets, { ...asset, id: `ast_${Date.now()}` }];
    const updated: OffboardingRecord = { ...rec, assets: nextAssets, updatedAt: nowIso };
    setOffboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_offboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('offboarding_records', recordId, updated, rec.companyId);
  };

  const updateOffboardingAsset = async (
    recordId: string,
    assetId: string,
    status: OffboardingAssetItem['status'],
    deductionAmount?: number
  ) => {
    const rec = offboardingRecords.find(r => r.id === recordId);
    if (!rec) return;
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || currentEmployee?.name || 'Admin';
    const nextAssets = rec.assets.map(a =>
      a.id === assetId
        ? {
            ...a,
            status,
            deductionAmount: status === 'damaged_deduct' ? (deductionAmount ?? a.deductionAmount ?? 0) : 0,
            returnedAt: status !== 'pending_return' ? nowIso : undefined,
            verifiedBy: status !== 'pending_return' ? actorName : undefined,
          }
        : a
    );
    const totalAssetDamage = nextAssets.reduce((sum, a) => sum + (Number(a.deductionAmount) || 0), 0);
    const fs = rec.finalSettlement;
    const netSettlementAmount = Math.max(
      0,
      fs.unpaidSalaryAmount + fs.leaveEncashmentAmount + fs.gratuityOrServiceBenefit -
      fs.noticePayRecovery - totalAssetDamage - fs.loanOrAdvanceRecovery
    );

    const allCleared = rec.clearances.every(c => c.cleared);
    const allAssetsHandled = nextAssets.every(a => a.status !== 'pending_return');
    const nextStatus: OffboardingRecord['status'] =
      rec.status === 'completed'
        ? 'completed'
        : allCleared && allAssetsHandled
        ? 'ready_for_settlement'
        : 'in_clearance';

    const updated: OffboardingRecord = {
      ...rec,
      assets: nextAssets,
      finalSettlement: {
        ...fs,
        assetDamageDeduction: totalAssetDamage,
        netSettlementAmount,
      },
      status: nextStatus,
      updatedAt: nowIso,
    };

    setOffboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_offboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('offboarding_records', recordId, updated, rec.companyId);
  };

  const updateOffboardingDocuments = async (
    recordId: string,
    docs: Partial<OffboardingRecord['documentsStatus']>
  ) => {
    const rec = offboardingRecords.find(r => r.id === recordId);
    if (!rec) return;
    const nowIso = new Date().toISOString();
    const updated: OffboardingRecord = {
      ...rec,
      documentsStatus: { ...rec.documentsStatus, ...docs },
      updatedAt: nowIso,
    };
    setOffboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_offboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('offboarding_records', recordId, updated, rec.companyId);
  };

  const submitExitInterview = async (
    recordId: string,
    interview: Omit<ExitInterviewData, 'completed' | 'completedAt' | 'conductedBy'>
  ) => {
    const rec = offboardingRecords.find(r => r.id === recordId);
    if (!rec) return;
    const nowIso = new Date().toISOString();
    const actorName = currentEmployee?.name || currentUser?.name || rec.employeeName;
    const updated: OffboardingRecord = {
      ...rec,
      exitInterview: {
        ...interview,
        completed: true,
        completedAt: nowIso,
        conductedBy: actorName,
      },
      updatedAt: nowIso,
    };
    setOffboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_offboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('offboarding_records', recordId, updated, rec.companyId);
    await recordAuditLog({
      action: 'EXIT_INTERVIEW_COMPLETED',
      category: 'onboarding_offboarding',
      targetType: 'OffboardingRecord',
      targetId: recordId,
      targetName: rec.employeeName,
      summary: `Exit interview recorded for ${rec.employeeName} (Rating: ${interview.workEnvironmentRating}/5)`,
    });
  };

  const updateFinalSettlement = async (
    recordId: string,
    settlement: FinalSettlementData
  ) => {
    const rec = offboardingRecords.find(r => r.id === recordId);
    if (!rec) return;
    const nowIso = new Date().toISOString();

    // If synced_to_payroll or settled, also push final settlement earnings/deductions into worknest_payroll_monthly_records for that month (unless locked!)
    const targetMonth = settlement.settlementMonth || nowIso.slice(0, 7);
    const isMonthLocked = Boolean(monthlyPayrollRuns[targetMonth]?.isLocked);

    if ((settlement.status === 'synced_to_payroll' || settlement.status === 'settled') && !isMonthLocked) {
      try {
        const savedPayroll = localStorage.getItem('worknest_payroll_monthly_records');
        const map = savedPayroll ? JSON.parse(savedPayroll) : {};
        const key = `${targetMonth}_${rec.employeeId}`;
        const existingRec = map[key] || {};
        const addition = (Number(settlement.leaveEncashmentAmount) || 0) + (Number(settlement.gratuityOrServiceBenefit) || 0);
        const deduction = (Number(settlement.noticePayRecovery) || 0) + (Number(settlement.assetDamageDeduction) || 0);
        map[key] = {
          ...existingRec,
          employeeId: rec.employeeId,
          month: targetMonth,
          customEarningName: 'Final Settlement (Leave Encashment & Service Benefit)',
          otherAllowance: addition,
          customDeductionName: 'Final Settlement Recovery (Notice / Asset)',
          otherDeduction: deduction,
          advanceDeduction: Number(settlement.loanOrAdvanceRecovery) || existingRec.advanceDeduction || 0,
          status: settlement.status === 'settled' ? 'paid' : (existingRec.status || 'unpaid'),
          notes: `Final Settlement (${rec.exitType}) synced on ${nowIso.split('T')[0]}`,
        };
        localStorage.setItem('worknest_payroll_monthly_records', JSON.stringify(map));
        window.dispatchEvent(new Event('worknest_payroll_updated'));
        await syncRecordToFirestore('settings', `payroll_records_${rec.companyId}`, {
          records: map,
          companyId: rec.companyId,
          updatedAt: nowIso,
        }, rec.companyId);
      } catch (e) {
        console.warn('Could not sync final settlement to monthly payroll records:', e);
      }
    }

    const updated: OffboardingRecord = {
      ...rec,
      finalSettlement: settlement,
      status: settlement.status === 'settled' && rec.accessTerminated ? 'completed' : rec.status,
      updatedAt: nowIso,
    };

    setOffboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_offboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('offboarding_records', recordId, updated, rec.companyId);

    await recordAuditLog({
      action: 'FINAL_SETTLEMENT_UPDATED',
      category: 'payroll',
      targetType: 'OffboardingRecord',
      targetId: recordId,
      targetName: `${rec.employeeName} (${targetMonth})`,
      summary: `Updated final settlement for ${rec.employeeName}: Net Payable ৳${settlement.netSettlementAmount.toLocaleString()} (${settlement.status})`,
      afterValue: settlement,
    });
  };

  const terminateEmployeeAccess = async (
    recordId: string
  ): Promise<{ success: boolean; error?: string }> => {
    const rec = offboardingRecords.find(r => r.id === recordId);
    if (!rec) return { success: false, error: 'Offboarding record not found.' };
    if (!isAuthenticated || !currentUser) {
      return { success: false, error: 'Only authorized HR / Admin can terminate employee access.' };
    }

    const nowIso = new Date().toISOString();
    const actorName = currentUser.name || 'HR Admin';

    // 1. Mark employee status as 'inactive' and accessTerminated = true (NEVER deleting historical data!)
    await updateEmployee(rec.employeeId, {
      status: 'inactive',
      accessTerminated: true,
      accessTerminatedAt: nowIso,
    });

    // 2. Update OffboardingRecord
    const updated: OffboardingRecord = {
      ...rec,
      accessTerminated: true,
      accessTerminatedAt: nowIso,
      accessTerminatedBy: actorName,
      status: 'completed',
      updatedAt: nowIso,
    };

    setOffboardingRecords(prev => {
      const next = prev.map(r => r.id === recordId ? updated : r);
      try { localStorage.setItem(`worknest_offboarding_${rec.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('offboarding_records', recordId, updated, rec.companyId);

    await recordAuditLog({
      action: 'EMPLOYEE_ACCESS_TERMINATED',
      category: 'security',
      targetType: 'Employee',
      targetId: rec.employeeCode || rec.employeeId,
      targetName: rec.employeeName,
      summary: `${actorName} terminated portal access and completed offboarding for ${rec.employeeName} (${rec.employeeCode}). Historical attendance, payroll, and HR records preserved.`,
      beforeValue: { status: 'active', accessTerminated: false },
      afterValue: { status: 'inactive', accessTerminated: true, accessTerminatedAt: nowIso },
    });

    return { success: true };
  };

  // =========================================================================
  // PHASE 3: WORKFORCE PLANNING & EMPLOYEE MOVEMENT ENGINE
  // =========================================================================
  const saveWorkforcePlan = async (
    plan: Omit<WorkforcePositionPlan, 'id' | 'updatedAt' | 'companyId'> & { id?: string }
  ): Promise<WorkforcePositionPlan> => {
    const activeComp = currentCompanyId || 'default';
    const id = plan.id || `wfp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || 'HR Admin';
    const record: WorkforcePositionPlan = {
      ...plan,
      id,
      title: plan.title.trim(),
      department: plan.department.trim(),
      branch: plan.branch || 'All',
      approvedHeadcount: Math.max(0, Number(plan.approvedHeadcount) || 0),
      budgetedAvgSalary: Math.max(0, Number(plan.budgetedAvgSalary) || 0),
      updatedBy: actorName,
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setWorkforcePlans(prev => {
      const exists = prev.some(p => p.id === id);
      const next = exists ? prev.map(p => p.id === id ? record : p) : [record, ...prev];
      try { localStorage.setItem(`worknest_workforce_plans_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('workforce_plans', id, record, activeComp);
    await recordAuditLog({
      action: plan.id ? 'WORKFORCE_PLAN_UPDATED' : 'WORKFORCE_PLAN_CREATED',
      category: 'workforce_planning',
      targetType: 'WorkforcePositionPlan',
      targetId: id,
      targetName: `${record.title} (${record.department})`,
      summary: `${actorName} set approved headcount for ${record.title} (${record.department}) to ${record.approvedHeadcount} seats`,
      afterValue: record,
    });
    return record;
  };

  const deleteWorkforcePlan = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    const target = workforcePlans.find(p => p.id === id);
    setWorkforcePlans(prev => {
      const next = prev.filter(p => p.id !== id);
      try { localStorage.setItem(`worknest_workforce_plans_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('workforce_plans', id);
    if (target) {
      await recordAuditLog({
        action: 'WORKFORCE_PLAN_DELETED',
        category: 'workforce_planning',
        targetType: 'WorkforcePositionPlan',
        targetId: id,
        targetName: target.title,
        summary: `Removed workforce position plan for ${target.title} (${target.department})`,
      });
    }
  };

  const recordEmployeeMovement = async (
    payload: Omit<EmployeeMovementRecord, 'id' | 'createdAt' | 'companyId' | 'recordedBy'> & { applyToEmployeeProfile?: boolean }
  ): Promise<EmployeeMovementRecord> => {
    const activeComp = currentCompanyId || 'default';
    const id = `mov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || currentEmployee?.name || 'HR Admin';
    const { applyToEmployeeProfile, ...rest } = payload;

    const record: EmployeeMovementRecord = {
      ...rest,
      id,
      recordedBy: actorName,
      createdAt: nowIso,
      companyId: activeComp,
    };

    setEmployeeMovements(prev => {
      const next = [record, ...prev];
      try { localStorage.setItem(`worknest_employee_movements_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('employee_movements', id, record, activeComp);

    if (applyToEmployeeProfile) {
      const targetEmp = allEmployees.find(
        e => e.id === payload.employeeId || e.employeeId === payload.employeeId || e.employeeId === payload.employeeCode
      );
      if (targetEmp) {
        const profileUpdates: Partial<Employee> = {};
        if (payload.toDepartment && payload.toDepartment !== targetEmp.department) {
          profileUpdates.department = payload.toDepartment;
        }
        if (payload.toDesignation && payload.toDesignation !== targetEmp.designation) {
          profileUpdates.designation = payload.toDesignation;
        }
        if (payload.toBranch && payload.toBranch !== targetEmp.branch) {
          profileUpdates.branch = payload.toBranch;
          const bObj = branches.find(b => b.name.toLowerCase() === payload.toBranch!.toLowerCase());
          if (bObj) profileUpdates.branchId = bObj.id;
        }
        if (payload.toSalary && payload.toSalary > 0 && payload.toSalary !== targetEmp.grossSalary) {
          profileUpdates.grossSalary = payload.toSalary;
          profileUpdates.basicSalary = Math.round(payload.toSalary * 0.5);
          profileUpdates.houseRent = Math.round(payload.toSalary * 0.3);
          profileUpdates.medical = Math.round(payload.toSalary * 0.1);
          profileUpdates.conveyance = Math.round(payload.toSalary * 0.1);
        }
        if (payload.toManagerName !== undefined) {
          profileUpdates.managerName = payload.toManagerName;
          const mgrObj = allEmployees.find(m => m.name.toLowerCase() === payload.toManagerName!.toLowerCase());
          if (mgrObj) profileUpdates.managerId = mgrObj.employeeId || mgrObj.id;
        }
        if (Object.keys(profileUpdates).length > 0) {
          setEmployees(prev => prev.map(emp => emp.id === targetEmp.id ? { ...emp, ...profileUpdates } : emp));
          await syncRecordToFirestore('employees', targetEmp.id, profileUpdates, activeComp);
        }
      }
    }

    await recordAuditLog({
      action: 'EMPLOYEE_MOVEMENT_RECORDED',
      category: 'workforce_planning',
      targetType: 'EmployeeMovement',
      targetId: record.employeeCode,
      targetName: record.employeeName,
      summary: `${actorName} recorded ${record.movementType.replace(/_/g, ' ')} for ${record.employeeName} effective ${record.effectiveDate}`,
      afterValue: record,
    });

    return record;
  };

  // =========================================================================
  // PHASE 3: EMPLOYEE ENGAGEMENT ENGINE
  // =========================================================================
  const publishAnnouncement = async (
    payload: Omit<CompanyAnnouncement, 'id' | 'createdAt' | 'companyId' | 'authorName' | 'authorRole' | 'acknowledgedBy'>
  ): Promise<CompanyAnnouncement> => {
    const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
      ? currentEmployee.companyId
      : (currentCompanyId || 'default');
    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const authorName = currentUser?.name || currentEmployee?.name || 'HR Communications';
    const authorRole = currentUser?.role || (currentEmployee?.isManager ? 'Department Manager' : 'HR Admin');

    const record: CompanyAnnouncement = {
      ...payload,
      id,
      authorName,
      authorRole,
      acknowledgedBy: [],
      createdAt: nowIso,
      companyId: activeComp,
    };

    setCompanyAnnouncements(prev => {
      const next = [record, ...prev];
      try { localStorage.setItem(`worknest_announcements_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('company_announcements', id, record, activeComp);

    addNotification({
      title: `📢 ${record.category}: ${record.title}`,
      message: record.content.length > 90 ? `${record.content.slice(0, 90)}...` : record.content,
      read: false,
      type: 'system',
      targetPage: 'engagement',
    });

    await recordAuditLog({
      action: 'ANNOUNCEMENT_PUBLISHED',
      category: 'engagement',
      targetType: 'CompanyAnnouncement',
      targetId: id,
      targetName: record.title,
      summary: `${authorName} published company announcement "${record.title}" (${record.priority.toUpperCase()})`,
      afterValue: { title: record.title, category: record.category, targetDepartment: record.targetDepartment, targetBranch: record.targetBranch },
    });

    return record;
  };

  const acknowledgeAnnouncement = async (announcementId: string) => {
    const target = companyAnnouncements.find(a => a.id === announcementId);
    if (!target) return;
    const actorKey = currentEmployee?.employeeId || currentEmployee?.id || currentUser?.id || currentUser?.email || 'user';
    if (target.acknowledgedBy.includes(actorKey)) return;
    const nextAck = [...target.acknowledgedBy, actorKey];
    const updated: CompanyAnnouncement = { ...target, acknowledgedBy: nextAck };
    setCompanyAnnouncements(prev => {
      const next = prev.map(a => a.id === announcementId ? updated : a);
      try { localStorage.setItem(`worknest_announcements_${target.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('company_announcements', announcementId, { acknowledgedBy: nextAck }, target.companyId);
  };

  const deleteAnnouncement = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    setCompanyAnnouncements(prev => {
      const next = prev.filter(a => a.id !== id);
      try { localStorage.setItem(`worknest_announcements_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('company_announcements', id);
  };

  const giveRecognition = async (
    payload: Omit<EmployeeRecognition, 'id' | 'createdAt' | 'companyId' | 'awardedById' | 'awardedByName' | 'awardedByRole' | 'likes'>
  ): Promise<EmployeeRecognition> => {
    const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
      ? currentEmployee.companyId
      : (currentCompanyId || 'default');
    const id = `recog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const awardedById = currentEmployee?.employeeId || currentEmployee?.id || currentUser?.id || 'admin';
    const awardedByName = currentEmployee?.name || currentUser?.name || 'HR Team';
    const awardedByRole = currentUser?.role || (currentEmployee?.isManager ? 'Team Manager' : currentEmployee?.designation || 'Colleague');

    const record: EmployeeRecognition = {
      ...payload,
      id,
      awardedById,
      awardedByName,
      awardedByRole,
      likes: [],
      createdAt: nowIso,
      companyId: activeComp,
    };

    setEmployeeRecognitions(prev => {
      const next = [record, ...prev];
      try { localStorage.setItem(`worknest_recognitions_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('employee_recognitions', id, record, activeComp);

    addNotification({
      title: `🏆 Recognition Awarded to ${record.recipientName}!`,
      message: `${awardedByName} awarded "${record.badge}" to ${record.recipientName}: "${record.message}"`,
      read: false,
      type: 'system',
      targetPage: 'engagement',
      forEmployeeId: record.recipientEmployeeId,
    });

    await recordAuditLog({
      action: 'EMPLOYEE_RECOGNITION_AWARDED',
      category: 'engagement',
      targetType: 'EmployeeRecognition',
      targetId: record.recipientEmployeeId,
      targetName: record.recipientName,
      summary: `${awardedByName} awarded "${record.badge}" recognition to ${record.recipientName}`,
    });

    return record;
  };

  const toggleRecognitionLike = async (recognitionId: string) => {
    const target = employeeRecognitions.find(r => r.id === recognitionId);
    if (!target) return;
    const actorKey = currentEmployee?.employeeId || currentEmployee?.id || currentUser?.id || currentUser?.email || 'user';
    const hasLiked = target.likes.includes(actorKey);
    const nextLikes = hasLiked ? target.likes.filter(k => k !== actorKey) : [...target.likes, actorKey];
    const updated = { ...target, likes: nextLikes };
    setEmployeeRecognitions(prev => {
      const next = prev.map(r => r.id === recognitionId ? updated : r);
      try { localStorage.setItem(`worknest_recognitions_${target.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('employee_recognitions', recognitionId, { likes: nextLikes }, target.companyId);
  };

  const deleteRecognition = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    setEmployeeRecognitions(prev => {
      const next = prev.filter(r => r.id !== id);
      try { localStorage.setItem(`worknest_recognitions_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('employee_recognitions', id);
  };

  const submitEmployeeFeedback = async (
    payload: Omit<EmployeeFeedbackItem, 'id' | 'status' | 'createdAt' | 'companyId'>
  ): Promise<{ success: boolean; error?: string }> => {
    if (!payload.subject.trim() || !payload.message.trim()) {
      return { success: false, error: 'Subject and feedback message are required.' };
    }
    const activeComp = (isEmployeeAuthenticated && !isAuthenticated && currentEmployee?.companyId)
      ? currentEmployee.companyId
      : (currentCompanyId || 'default');
    const id = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    const record: EmployeeFeedbackItem = {
      ...payload,
      id,
      status: 'submitted',
      createdAt: nowIso,
      companyId: activeComp,
    };

    setEmployeeFeedbackList(prev => {
      const next = [record, ...prev];
      try { localStorage.setItem(`worknest_feedback_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('employee_feedback', id, record, activeComp);

    await recordAuditLog({
      action: 'EMPLOYEE_FEEDBACK_SUBMITTED',
      category: 'engagement',
      targetType: 'EmployeeFeedback',
      targetId: id,
      targetName: payload.isAnonymous ? 'Anonymous Feedback' : payload.employeeName,
      summary: `Feedback submitted under category "${payload.category}": ${payload.subject}`,
    });

    return { success: true };
  };

  const respondToEmployeeFeedback = async (
    id: string,
    status: EmployeeFeedbackItem['status'],
    adminResponse: string
  ) => {
    const target = employeeFeedbackList.find(f => f.id === id);
    if (!target) return;
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || currentEmployee?.name || 'HR Management';
    const updated: EmployeeFeedbackItem = {
      ...target,
      status,
      adminResponse: adminResponse.trim() || target.adminResponse,
      respondedBy: actorName,
      respondedAt: nowIso,
    };

    setEmployeeFeedbackList(prev => {
      const next = prev.map(f => f.id === id ? updated : f);
      try { localStorage.setItem(`worknest_feedback_${target.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('employee_feedback', id, updated, target.companyId);

    await recordAuditLog({
      action: 'EMPLOYEE_FEEDBACK_RESPONDED',
      category: 'engagement',
      targetType: 'EmployeeFeedback',
      targetId: id,
      targetName: target.subject,
      summary: `${actorName} updated feedback "${target.subject}" to ${status.toUpperCase()}`,
    });
  };

  const createPulseSurvey = async (
    payload: Omit<PulseSurvey, 'id' | 'responses' | 'createdAt' | 'companyId' | 'createdBy'>
  ): Promise<PulseSurvey> => {
    const activeComp = currentCompanyId || 'default';
    const id = `srv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const createdBy = currentUser?.name || currentEmployee?.name || 'HR Admin';

    const record: PulseSurvey = {
      ...payload,
      id,
      responses: [],
      createdBy,
      createdAt: nowIso,
      companyId: activeComp,
    };

    setPulseSurveys(prev => {
      const next = [record, ...prev];
      try { localStorage.setItem(`worknest_pulse_surveys_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('pulse_surveys', id, record, activeComp);

    addNotification({
      title: `📊 New Pulse Survey: ${record.title}`,
      message: `Share your voice! Complete the "${record.title}" survey in Employee Engagement.`,
      read: false,
      type: 'system',
      targetPage: 'engagement',
    });

    await recordAuditLog({
      action: 'PULSE_SURVEY_CREATED',
      category: 'engagement',
      targetType: 'PulseSurvey',
      targetId: id,
      targetName: record.title,
      summary: `${createdBy} launched pulse survey "${record.title}" (${record.questions.length} questions)`,
    });

    return record;
  };

  const submitPulseSurveyResponse = async (
    surveyId: string,
    answers: Record<string, string | number>
  ): Promise<{ success: boolean; error?: string }> => {
    const survey = pulseSurveys.find(s => s.id === surveyId);
    if (!survey) return { success: false, error: 'Survey not found.' };
    if (survey.status !== 'active') return { success: false, error: 'This survey is closed.' };

    const respondentId = currentEmployee?.employeeId || currentEmployee?.id || currentUser?.id || currentUser?.email || 'anonymous';
    const respondentName = currentEmployee?.name || currentUser?.name || 'Staff Member';
    const respondentDept = currentEmployee?.department || 'General';

    if (survey.responses.some(r => r.employeeId === respondentId)) {
      return { success: false, error: 'You have already submitted a response for this survey.' };
    }

    const newResponse: PulseSurveyResponse = {
      id: `resp_${Date.now()}`,
      employeeId: respondentId,
      employeeName: survey.isAnonymous ? 'Anonymous Respondent' : respondentName,
      department: respondentDept,
      isAnonymous: survey.isAnonymous,
      answers,
      submittedAt: new Date().toISOString(),
    };

    const nextResponses = [...survey.responses, newResponse];
    const updated: PulseSurvey = { ...survey, responses: nextResponses };

    setPulseSurveys(prev => {
      const next = prev.map(s => s.id === surveyId ? updated : s);
      try { localStorage.setItem(`worknest_pulse_surveys_${survey.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('pulse_surveys', surveyId, { responses: nextResponses }, survey.companyId);

    return { success: true };
  };

  const closePulseSurvey = async (surveyId: string) => {
    const survey = pulseSurveys.find(s => s.id === surveyId);
    if (!survey) return;
    const updated: PulseSurvey = { ...survey, status: 'closed' };
    setPulseSurveys(prev => {
      const next = prev.map(s => s.id === surveyId ? updated : s);
      try { localStorage.setItem(`worknest_pulse_surveys_${survey.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('pulse_surveys', surveyId, { status: 'closed' }, survey.companyId);
  };

  const deletePulseSurvey = async (surveyId: string) => {
    const activeComp = currentCompanyId || 'default';
    setPulseSurveys(prev => {
      const next = prev.filter(s => s.id !== surveyId);
      try { localStorage.setItem(`worknest_pulse_surveys_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('pulse_surveys', surveyId);
  };

  // =========================================================================
  // PHASE 4: LEARNING & DEVELOPMENT (L&D)
  // =========================================================================
  const saveTrainingCourse = async (
    payload: Omit<TrainingCourse, 'id' | 'createdAt' | 'companyId' | 'createdBy'> & { id?: string }
  ): Promise<TrainingCourse> => {
    const activeComp = currentCompanyId || 'default';
    const id = payload.id || `crs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || currentEmployee?.name || 'HR Admin';

    const record: TrainingCourse = {
      ...payload,
      id,
      targetSkills: Array.isArray(payload.targetSkills) ? payload.targetSkills : [],
      createdBy: actorName,
      createdAt: nowIso,
      companyId: activeComp,
    };

    setTrainingCourses(prev => {
      const exists = prev.some(c => c.id === id);
      const next = exists ? prev.map(c => (c.id === id ? record : c)) : [record, ...prev];
      try { localStorage.setItem(`worknest_training_courses_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('training_courses', id, record, activeComp);

    await recordAuditLog({
      action: payload.id ? 'TRAINING_COURSE_UPDATED' : 'TRAINING_COURSE_CREATED',
      category: 'learning_skills',
      targetType: 'TrainingCourse',
      targetId: id,
      targetName: record.title,
      summary: `${actorName} ${payload.id ? 'updated' : 'published'} training course "${record.title}" (${record.code}) — ৳${record.costPerEmployee.toLocaleString()}/head`,
      afterValue: record,
    });

    return record;
  };

  const deleteTrainingCourse = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    const existing = trainingCourses.find(c => c.id === id);
    setTrainingCourses(prev => {
      const next = prev.filter(c => c.id !== id);
      try { localStorage.setItem(`worknest_training_courses_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('training_courses', id);
    if (existing) {
      await recordAuditLog({
        action: 'TRAINING_COURSE_DELETED',
        category: 'learning_skills',
        targetType: 'TrainingCourse',
        targetId: id,
        targetName: existing.title,
        summary: `Deleted training course "${existing.title}" (${existing.code})`,
      });
    }
  };

  const enrollInTrainingCourse = async (
    courseId: string,
    employeeId: string
  ): Promise<{ success: boolean; error?: string; enrollment?: TrainingEnrollment }> => {
    const course = trainingCourses.find(c => c.id === courseId);
    if (!course) return { success: false, error: 'Training course not found.' };

    const emp = allEmployees.find(e => e.id === employeeId || e.employeeId === employeeId) ||
      (currentEmployee && (currentEmployee.id === employeeId || currentEmployee.employeeId === employeeId) ? currentEmployee : undefined);
    if (!emp) return { success: false, error: 'Employee record not found.' };

    const canonicalEmpId = emp.employeeId || emp.id;
    const duplicate = trainingEnrollments.find(
      en => en.courseId === courseId && (en.employeeId === canonicalEmpId || en.employeeId === emp.id) && en.status !== 'dropped'
    );
    if (duplicate) {
      return { success: false, error: `${emp.name} is already enrolled in "${course.title}".` };
    }

    const activeEnrolledCount = trainingEnrollments.filter(
      en => en.courseId === courseId && en.status !== 'dropped'
    ).length;
    if (course.maxSeats > 0 && activeEnrolledCount >= course.maxSeats) {
      return { success: false, error: `Maximum seat capacity (${course.maxSeats}) reached for "${course.title}".` };
    }

    const activeComp = emp.companyId || currentCompanyId || 'default';
    const id = `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const actorName = currentUser?.name || currentEmployee?.name || emp.name;

    const record: TrainingEnrollment = {
      id,
      courseId: course.id,
      courseCode: course.code,
      courseTitle: course.title,
      courseCategory: course.category,
      durationHours: course.durationHours,
      trainingCost: Number(course.costPerEmployee) || 0,
      employeeId: canonicalEmpId,
      employeeName: emp.name,
      department: emp.department || 'General',
      designation: emp.designation || 'Staff',
      enrolledBy: actorName,
      enrolledAt: new Date().toISOString(),
      status: 'enrolled',
      attendancePercent: 0,
      progressPercent: 0,
      certificateIssued: false,
      companyId: activeComp,
    };

    setTrainingEnrollments(prev => {
      const next = [record, ...prev];
      try { localStorage.setItem(`worknest_training_enrollments_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('training_enrollments', id, record, activeComp);

    addNotification({
      title: `🎓 Training Enrollment: ${course.title}`,
      message: `${emp.name} has been enrolled in "${course.title}" (${course.scheduledStartDate}).`,
      read: false,
      type: 'system',
      forEmployeeId: canonicalEmpId,
    });

    await recordAuditLog({
      action: 'TRAINING_ENROLLED',
      category: 'learning_skills',
      targetType: 'TrainingEnrollment',
      targetId: id,
      targetName: `${emp.name} - ${course.title}`,
      summary: `${actorName} enrolled ${emp.name} (${canonicalEmpId}) in "${course.title}"`,
    });

    return { success: true, enrollment: record };
  };

  const updateTrainingEnrollment = async (
    enrollmentId: string,
    updates: Partial<Pick<TrainingEnrollment, 'status' | 'attendancePercent' | 'progressPercent' | 'assessmentScore' | 'effectivenessRating' | 'effectivenessFeedback' | 'managerEffectivenessScore'>>
  ): Promise<{ success: boolean; error?: string }> => {
    const existing = trainingEnrollments.find(e => e.id === enrollmentId);
    if (!existing) return { success: false, error: 'Enrollment not found.' };

    const isCompletedNow = updates.status === 'completed' || updates.progressPercent === 100;
    const updated: TrainingEnrollment = {
      ...existing,
      ...updates,
      status: isCompletedNow ? 'completed' : (updates.status || existing.status),
      progressPercent: isCompletedNow ? 100 : (updates.progressPercent ?? existing.progressPercent),
      attendancePercent: isCompletedNow && (updates.attendancePercent ?? existing.attendancePercent) === 0
        ? 100
        : (updates.attendancePercent ?? existing.attendancePercent),
      completedAt: isCompletedNow ? (existing.completedAt || new Date().toISOString().split('T')[0]) : existing.completedAt,
    };

    setTrainingEnrollments(prev => {
      const next = prev.map(e => (e.id === enrollmentId ? updated : e));
      try { localStorage.setItem(`worknest_training_enrollments_${existing.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('training_enrollments', enrollmentId, updated, existing.companyId);

    await recordAuditLog({
      action: 'TRAINING_PROGRESS_UPDATED',
      category: 'learning_skills',
      targetType: 'TrainingEnrollment',
      targetId: enrollmentId,
      targetName: `${existing.employeeName} - ${existing.courseTitle}`,
      summary: `Updated training status/progress for ${existing.employeeName} on "${existing.courseTitle}" (${updated.status}, ${updated.progressPercent}%)`,
      beforeValue: { status: existing.status, progressPercent: existing.progressPercent },
      afterValue: { status: updated.status, progressPercent: updated.progressPercent, effectivenessRating: updated.effectivenessRating },
    });

    return { success: true };
  };

  const issueTrainingCertificate = async (
    enrollmentId: string,
    expiryDate?: string
  ): Promise<{ success: boolean; error?: string; certificateNumber?: string }> => {
    const existing = trainingEnrollments.find(e => e.id === enrollmentId);
    if (!existing) return { success: false, error: 'Enrollment record not found.' };

    const nowDate = new Date().toISOString().split('T')[0];
    const certNumber = existing.certificateNumber || `CERT-WN-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    // 1. Sync certificate into HR Documents (DocumentManagement integration without duplicating employee records)
    const certHtmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Certificate ${certNumber}</title></head><body style="font-family:sans-serif;text-align:center;padding:40px;border:8px double #4f46e5;"><h1>CERTIFICATE OF COMPLETION</h1><p>This certifies that</p><h2>${existing.employeeName} (${existing.employeeId})</h2><p>has successfully completed the training program</p><h3>${existing.courseTitle} (${existing.durationHours} Hours)</h3><p>Certificate No: <strong>${certNumber}</strong> • Issued: ${nowDate}${expiryDate ? ` • Valid Until: ${expiryDate}` : ''}</p></body></html>`;
    const certDataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(certHtmlContent)}`;

    const docRes = await uploadHRDocument({
      title: `Training Certificate: ${existing.courseTitle} (${certNumber})`,
      category: 'Academic & Certificate',
      visibility: 'employee_private',
      employeeId: existing.employeeId,
      employeeName: existing.employeeName,
      department: existing.department,
      fileName: `${certNumber}_${existing.courseCode || 'LND'}.html`,
      fileType: 'text/html',
      fileSize: certHtmlContent.length,
      fileDataUrl: certDataUrl,
      expiryDate: expiryDate || undefined,
      description: `Official WorkNest L&D Certificate for completing ${existing.courseTitle} (${existing.durationHours}h).`,
    });

    const updated: TrainingEnrollment = {
      ...existing,
      status: 'completed',
      progressPercent: 100,
      attendancePercent: Math.max(existing.attendancePercent, 100),
      completedAt: existing.completedAt || nowDate,
      certificateIssued: true,
      certificateNumber: certNumber,
      certificateIssuedAt: nowDate,
      certificateExpiryDate: expiryDate || undefined,
    };

    setTrainingEnrollments(prev => {
      const next = prev.map(e => (e.id === enrollmentId ? updated : e));
      try { localStorage.setItem(`worknest_training_enrollments_${existing.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('training_enrollments', enrollmentId, updated, existing.companyId);

    // 2. Automatically sync targetSkills of the completed course into Employee Skills
    const course = trainingCourses.find(c => c.id === existing.courseId);
    if (course && Array.isArray(course.targetSkills) && course.targetSkills.length > 0) {
      for (const skillName of course.targetSkills) {
        const existingSkill = employeeSkills.find(
          s =>
            (s.employeeId === existing.employeeId) &&
            s.skillName.trim().toLowerCase() === skillName.trim().toLowerCase()
        );
        const nextLevel = existingSkill ? Math.min(5, Math.max(existingSkill.proficiencyLevel + 1, 3)) : 3;
        await saveEmployeeSkill({
          id: existingSkill?.id,
          employeeId: existing.employeeId,
          employeeName: existing.employeeName,
          department: existing.department,
          designation: existing.designation,
          skillName: skillName.trim(),
          category: 'Technical',
          proficiencyLevel: nextLevel,
          selfAssessedLevel: existingSkill?.selfAssessedLevel || nextLevel,
          managerVerifiedLevel: nextLevel,
          verifiedBy: currentUser?.name || 'L&D Certification Engine',
          verifiedAt: nowDate,
          isCertified: true,
          certificationName: `${course.title} (${certNumber})`,
          certificationIssuer: course.provider || 'WorkNest Academy',
          certificationIssueDate: nowDate,
          certificationExpiryDate: expiryDate || undefined,
        });
      }
    }

    addNotification({
      title: `🏅 Certificate Issued: ${existing.courseTitle}`,
      message: `Congratulations ${existing.employeeName}! Certificate ${certNumber} has been issued and saved to your HR Documents.`,
      read: false,
      type: 'system',
      forEmployeeId: existing.employeeId,
    });

    await recordAuditLog({
      action: 'TRAINING_CERTIFICATE_ISSUED',
      category: 'learning_skills',
      targetType: 'TrainingEnrollment',
      targetId: enrollmentId,
      targetName: `${existing.employeeName} - ${certNumber}`,
      summary: `Issued training certificate ${certNumber} to ${existing.employeeName} for "${existing.courseTitle}"${docRes.success ? ' (linked to HR Documents)' : ''}`,
    });

    return { success: true, certificateNumber: certNumber };
  };

  // =========================================================================
  // PHASE 4: SKILL MANAGEMENT & CERTIFICATIONS
  // =========================================================================
  const saveEmployeeSkill = async (
    payload: Omit<EmployeeSkillRecord, 'id' | 'updatedAt' | 'companyId'> & { id?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    const activeComp = currentEmployee?.companyId || currentCompanyId || 'default';
    const existing = payload.id
      ? employeeSkills.find(s => s.id === payload.id)
      : employeeSkills.find(
          s =>
            s.employeeId === payload.employeeId &&
            s.skillName.trim().toLowerCase() === payload.skillName.trim().toLowerCase()
        );
    const id = existing?.id || payload.id || `skl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    const record: EmployeeSkillRecord = {
      ...payload,
      id,
      proficiencyLevel: Math.min(5, Math.max(1, Number(payload.proficiencyLevel) || 1)),
      selfAssessedLevel: Math.min(5, Math.max(1, Number(payload.selfAssessedLevel) || Number(payload.proficiencyLevel) || 1)),
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setEmployeeSkills(prev => {
      const exists = prev.some(s => s.id === id);
      const next = exists ? prev.map(s => (s.id === id ? record : s)) : [record, ...prev];
      try { localStorage.setItem(`worknest_employee_skills_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('employee_skills', id, record, activeComp);

    await recordAuditLog({
      action: existing ? 'EMPLOYEE_SKILL_UPDATED' : 'EMPLOYEE_SKILL_ADDED',
      category: 'learning_skills',
      targetType: 'EmployeeSkill',
      targetId: id,
      targetName: `${record.employeeName} - ${record.skillName}`,
      summary: `Saved skill "${record.skillName}" (Level ${record.proficiencyLevel}/5) for ${record.employeeName}`,
    });

    return { success: true };
  };

  const verifyEmployeeSkill = async (
    skillId: string,
    verifiedLevel: number
  ): Promise<{ success: boolean; error?: string }> => {
    const existing = employeeSkills.find(s => s.id === skillId);
    if (!existing) return { success: false, error: 'Skill record not found.' };

    // Prevent self-verification by regular employee
    if (isEmployeeAuthenticated && !isAuthenticated && currentEmployee) {
      if (existing.employeeId === currentEmployee.id || existing.employeeId === currentEmployee.employeeId) {
        return { success: false, error: 'Employees cannot verify their own skill ratings.' };
      }
      if (!canManageEmployee(existing.employeeId)) {
        return { success: false, error: 'You are not authorized to verify skills for this employee.' };
      }
    }

    const verifierName = currentUser?.name || currentEmployee?.name || 'Manager';
    const clamped = Math.min(5, Math.max(1, Number(verifiedLevel) || existing.proficiencyLevel));
    const updated: EmployeeSkillRecord = {
      ...existing,
      proficiencyLevel: clamped,
      managerVerifiedLevel: clamped,
      verifiedBy: verifierName,
      verifiedAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString(),
    };

    setEmployeeSkills(prev => {
      const next = prev.map(s => (s.id === skillId ? updated : s));
      try { localStorage.setItem(`worknest_employee_skills_${existing.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('employee_skills', skillId, updated, existing.companyId);

    await recordAuditLog({
      action: 'EMPLOYEE_SKILL_VERIFIED',
      category: 'learning_skills',
      targetType: 'EmployeeSkill',
      targetId: skillId,
      targetName: `${existing.employeeName} - ${existing.skillName}`,
      summary: `${verifierName} verified "${existing.skillName}" at Level ${clamped}/5 for ${existing.employeeName}`,
    });

    return { success: true };
  };

  const deleteEmployeeSkill = async (skillId: string) => {
    const activeComp = currentCompanyId || 'default';
    setEmployeeSkills(prev => {
      const next = prev.filter(s => s.id !== skillId);
      try { localStorage.setItem(`worknest_employee_skills_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('employee_skills', skillId);
  };

  const sendCertificationExpiryReminder = async (skillId: string) => {
    const skill = employeeSkills.find(s => s.id === skillId);
    if (!skill) return;
    const nowIso = new Date().toISOString();
    const updated: EmployeeSkillRecord = { ...skill, lastReminderSentAt: nowIso };

    setEmployeeSkills(prev => {
      const next = prev.map(s => (s.id === skillId ? updated : s));
      try { localStorage.setItem(`worknest_employee_skills_${skill.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('employee_skills', skillId, { lastReminderSentAt: nowIso }, skill.companyId);

    addNotification({
      title: `⚠️ Certification Expiry Reminder: ${skill.certificationName || skill.skillName}`,
      message: `Your certification "${skill.certificationName || skill.skillName}" expires on ${skill.certificationExpiryDate || 'soon'}. Please schedule renewal training.`,
      read: false,
      type: 'system',
      forEmployeeId: skill.employeeId,
    });

    await recordAuditLog({
      action: 'CERTIFICATION_EXPIRY_REMINDER_SENT',
      category: 'learning_skills',
      targetType: 'EmployeeSkill',
      targetId: skillId,
      targetName: `${skill.employeeName} - ${skill.certificationName || skill.skillName}`,
      summary: `Sent certification expiry reminder to ${skill.employeeName} for "${skill.certificationName || skill.skillName}" (Expires: ${skill.certificationExpiryDate})`,
    });
  };

  const savePositionSkillRequirement = async (
    payload: Omit<PositionSkillRequirement, 'id' | 'updatedAt' | 'updatedBy' | 'companyId'> & { id?: string }
  ): Promise<PositionSkillRequirement> => {
    const activeComp = currentCompanyId || 'default';
    const existing = payload.id
      ? positionSkillRequirements.find(p => p.id === payload.id)
      : positionSkillRequirements.find(
          p =>
            p.designation.trim().toLowerCase() === payload.designation.trim().toLowerCase() &&
            p.department.trim().toLowerCase() === payload.department.trim().toLowerCase()
        );
    const id = existing?.id || payload.id || `pos_skl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const actorName = currentUser?.name || currentEmployee?.name || 'HR Admin';

    const record: PositionSkillRequirement = {
      ...payload,
      id,
      updatedBy: actorName,
      updatedAt: new Date().toISOString(),
      companyId: activeComp,
    };

    setPositionSkillRequirements(prev => {
      const exists = prev.some(p => p.id === id);
      const next = exists ? prev.map(p => (p.id === id ? record : p)) : [record, ...prev];
      try { localStorage.setItem(`worknest_position_skills_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('position_skill_requirements', id, record, activeComp);

    await recordAuditLog({
      action: 'POSITION_SKILL_REQUIREMENT_SAVED',
      category: 'learning_skills',
      targetType: 'PositionSkillRequirement',
      targetId: id,
      targetName: `${record.designation} (${record.department})`,
      summary: `${actorName} defined ${record.requiredSkills.length} required skills for ${record.designation} (${record.department})`,
    });

    return record;
  };

  const deletePositionSkillRequirement = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    setPositionSkillRequirements(prev => {
      const next = prev.filter(p => p.id !== id);
      try { localStorage.setItem(`worknest_position_skills_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('position_skill_requirements', id);
  };

  // =========================================================================
  // PHASE 4: CAREER MANAGEMENT, TALENT POOL & SUCCESSION PLANNING
  // =========================================================================
  const saveCareerPathway = async (
    payload: Omit<CareerPathway, 'id' | 'updatedAt' | 'updatedBy' | 'companyId'> & { id?: string }
  ): Promise<CareerPathway> => {
    const activeComp = currentCompanyId || 'default';
    const id = payload.id || `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const actorName = currentUser?.name || 'HR Admin';

    const record: CareerPathway = {
      ...payload,
      id,
      updatedBy: actorName,
      updatedAt: new Date().toISOString(),
      companyId: activeComp,
    };

    setCareerPathways(prev => {
      const exists = prev.some(c => c.id === id);
      const next = exists ? prev.map(c => (c.id === id ? record : c)) : [record, ...prev];
      try { localStorage.setItem(`worknest_career_pathways_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('career_pathways', id, record, activeComp);

    await recordAuditLog({
      action: 'CAREER_PATHWAY_SAVED',
      category: 'talent_succession',
      targetType: 'CareerPathway',
      targetId: id,
      targetName: `${record.trackName} (${record.department})`,
      summary: `${actorName} saved career pathway "${record.trackName}" with ${record.steps.length} progression steps`,
    });

    return record;
  };

  const deleteCareerPathway = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    setCareerPathways(prev => {
      const next = prev.filter(c => c.id !== id);
      try { localStorage.setItem(`worknest_career_pathways_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('career_pathways', id);
  };

  const saveCareerDevelopmentPlan = async (
    payload: Omit<CareerDevelopmentPlan, 'id' | 'updatedAt' | 'updatedBy' | 'companyId'> & { id?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    const activeComp = currentEmployee?.companyId || currentCompanyId || 'default';
    const existing = payload.id
      ? careerDevelopmentPlans.find(p => p.id === payload.id)
      : careerDevelopmentPlans.find(p => p.employeeId === payload.employeeId);
    const id = existing?.id || payload.id || `idp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const actorName = currentUser?.name || currentEmployee?.name || 'Employee';

    const isRegularEmpSession = Boolean(isEmployeeAuthenticated && !isAuthenticated && currentEmployee && !currentEmployee.isManager);

    const record: CareerDevelopmentPlan = {
      ...payload,
      id,
      // Preserve existing confidential manager notes if edited by employee
      managerConfidentialNotes: isRegularEmpSession
        ? existing?.managerConfidentialNotes
        : payload.managerConfidentialNotes,
      updatedBy: actorName,
      updatedAt: new Date().toISOString(),
      companyId: activeComp,
    };

    setCareerDevelopmentPlans(prev => {
      const exists = prev.some(p => p.id === id);
      const next = exists ? prev.map(p => (p.id === id ? record : p)) : [record, ...prev];
      try { localStorage.setItem(`worknest_career_plans_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('career_development_plans', id, record, activeComp);

    await recordAuditLog({
      action: 'CAREER_DEVELOPMENT_PLAN_SAVED',
      category: 'talent_succession',
      targetType: 'CareerDevelopmentPlan',
      targetId: id,
      targetName: `${record.employeeName} -> ${record.targetDesignation}`,
      summary: `${actorName} updated career development plan for ${record.employeeName} (Target: ${record.targetDesignation}, Readiness: ${record.readinessStatus})`,
    });

    return { success: true };
  };

  const saveTalentProfile = async (
    payload: Omit<TalentProfile, 'id' | 'updatedAt' | 'assessedBy' | 'companyId'> & { id?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    // Security: regular employees can never create or modify Talent Pool / 9-Box evaluations
    if (isEmployeeAuthenticated && !isAuthenticated && !currentEmployee?.isManager) {
      return { success: false, error: 'Unauthorized: Only HR/Admins and authorized Managers can assess Talent Profiles.' };
    }

    const activeComp = currentCompanyId || currentEmployee?.companyId || 'default';
    const existing = payload.id
      ? talentProfiles.find(t => t.id === payload.id)
      : talentProfiles.find(t => t.employeeId === payload.employeeId);
    const id = existing?.id || payload.id || `tal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const actorName = currentUser?.name || currentEmployee?.name || 'HR Admin';

    const record: TalentProfile = {
      ...payload,
      id,
      assessedBy: actorName,
      updatedAt: new Date().toISOString(),
      companyId: activeComp,
    };

    setTalentProfiles(prev => {
      const exists = prev.some(t => t.id === id);
      const next = exists ? prev.map(t => (t.id === id ? record : t)) : [record, ...prev];
      try { localStorage.setItem(`worknest_talent_profiles_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('talent_profiles', id, record, activeComp);

    await recordAuditLog({
      action: 'TALENT_PROFILE_ASSESSED',
      category: 'talent_succession',
      targetType: 'TalentProfile',
      targetId: id,
      targetName: record.employeeName,
      summary: `${actorName} assessed talent profile for ${record.employeeName}: ${record.nineBoxCategory} (HiPo: ${record.isHighPotential ? 'Yes' : 'No'}, Shared with employee: ${record.shareWithEmployee ? 'Yes' : 'No'})`,
    });

    return { success: true };
  };

  const saveSuccessionPlan = async (
    payload: Omit<SuccessionPlan, 'id' | 'updatedAt' | 'updatedBy' | 'companyId' | 'history'> & { id?: string; historyAction?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    if (isEmployeeAuthenticated && !isAuthenticated && !currentEmployee?.isManager) {
      return { success: false, error: 'Unauthorized: Employees cannot access or modify Succession Plans.' };
    }

    const activeComp = currentCompanyId || currentEmployee?.companyId || 'default';
    const existing = payload.id
      ? successionPlans.find(s => s.id === payload.id)
      : successionPlans.find(
          s =>
            s.positionTitle.trim().toLowerCase() === payload.positionTitle.trim().toLowerCase() &&
            s.department.trim().toLowerCase() === payload.department.trim().toLowerCase()
        );
    const id = existing?.id || payload.id || `suc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const actorName = currentUser?.name || currentEmployee?.name || 'HR Admin';
    const nowIso = new Date().toISOString();

    const newHistoryEntry: SuccessionHistoryLog = {
      id: `sh_${Date.now()}`,
      action: payload.historyAction || (existing ? 'Updated Succession Plan & Candidates' : 'Created Critical Position Succession Plan'),
      actorName,
      timestamp: nowIso,
      details: `${payload.positionTitle} (${payload.department}) — ${payload.successors.length} successor candidate(s) mapped.`,
    };

    const { historyAction: _unused, ...cleanPayload } = payload;

    const record: SuccessionPlan = {
      ...cleanPayload,
      id,
      history: [newHistoryEntry, ...(existing?.history || [])],
      updatedBy: actorName,
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setSuccessionPlans(prev => {
      const exists = prev.some(s => s.id === id);
      const next = exists ? prev.map(s => (s.id === id ? record : s)) : [record, ...prev];
      try { localStorage.setItem(`worknest_succession_plans_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('succession_plans', id, record, activeComp);

    await recordAuditLog({
      action: 'SUCCESSION_PLAN_SAVED',
      category: 'talent_succession',
      targetType: 'SuccessionPlan',
      targetId: id,
      targetName: `${record.positionTitle} (${record.department})`,
      summary: `${actorName} updated succession plan for critical position "${record.positionTitle}" (${record.successors.length} candidates)`,
    });

    return { success: true };
  };

  const deleteSuccessionPlan = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    setSuccessionPlans(prev => {
      const next = prev.filter(s => s.id !== id);
      try { localStorage.setItem(`worknest_succession_plans_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('succession_plans', id);
  };

  const promoteSuccessorToPosition = async (
    planId: string,
    successorEmployeeId: string,
    newSalary?: number
  ): Promise<{ success: boolean; error?: string }> => {
    const plan = successionPlans.find(s => s.id === planId);
    if (!plan) return { success: false, error: 'Succession plan not found.' };

    const emp = allEmployees.find(e => e.id === successorEmployeeId || e.employeeId === successorEmployeeId);
    if (!emp) return { success: false, error: 'Successor employee record not found.' };

    const actorName = currentUser?.name || 'HR Admin';
    const nowIso = new Date().toISOString();

    // 1. Reuse Phase 3 recordEmployeeMovement + Employee profile update
    await recordEmployeeMovement({
      employeeId: emp.id,
      employeeCode: emp.employeeId || emp.id,
      employeeName: emp.name,
      movementType: 'promotion',
      effectiveDate: nowIso.split('T')[0],
      fromDepartment: emp.department,
      toDepartment: plan.department || emp.department,
      fromDesignation: emp.designation,
      toDesignation: plan.positionTitle,
      fromBranch: getEmployeeBranch(emp),
      toBranch: plan.branch || getEmployeeBranch(emp),
      fromSalary: emp.grossSalary || emp.basicSalary,
      toSalary: newSalary && newSalary > 0 ? newSalary : (emp.grossSalary || emp.basicSalary),
      reason: `Promoted via Succession Plan for Critical Position: ${plan.positionTitle}`,
      applyToEmployeeProfile: true,
    });

    // 2. Record promotion in SuccessionPlan history & update incumbent
    const historyEntry: SuccessionHistoryLog = {
      id: `sh_${Date.now()}`,
      action: 'Successor Promoted to Critical Position',
      actorName,
      timestamp: nowIso,
      details: `${emp.name} (${emp.employeeId}) promoted from ${emp.designation} to ${plan.positionTitle} (Previously held by ${plan.incumbentName || 'Vacant'}).`,
    };

    const updatedPlan: SuccessionPlan = {
      ...plan,
      incumbentEmployeeId: emp.employeeId || emp.id,
      incumbentName: emp.name,
      vacancyRisk: 'low',
      history: [historyEntry, ...(plan.history || [])],
      updatedBy: actorName,
      updatedAt: nowIso,
    };

    setSuccessionPlans(prev => {
      const next = prev.map(s => (s.id === planId ? updatedPlan : s));
      try { localStorage.setItem(`worknest_succession_plans_${plan.companyId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('succession_plans', planId, updatedPlan, plan.companyId);

    return { success: true };
  };

  // =========================================================================
  // PHASE 5: INTERNATIONALIZATION, GLOBAL ENTITIES, HOLIDAYS, PAYROLL CONFIGS
  // & ENTERPRISE SECURITY (CUSTOM ROLES, SESSIONS, SECURITY POLICY)
  // =========================================================================
  const saveGlobalLegalEntity = async (
    payload: Omit<GlobalLegalEntity, 'id' | 'createdAt' | 'updatedAt' | 'companyId'> & { id?: string }
  ): Promise<GlobalLegalEntity> => {
    const activeComp = currentCompanyId || 'default';
    const existing = payload.id ? globalLegalEntities.find(e => e.id === payload.id) : undefined;
    const id = existing?.id || payload.id || `entity_${payload.countryCode.toLowerCase()}_${Date.now()}`;
    const nowIso = new Date().toISOString();

    const record: GlobalLegalEntity = {
      ...payload,
      id,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setGlobalLegalEntities(prev => {
      const exists = prev.some(e => e.id === id);
      const next = exists ? prev.map(e => (e.id === id ? record : e)) : [...prev, record];
      try { localStorage.setItem(`worknest_global_entities_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('global_legal_entities', id, record, activeComp);

    await recordAuditLog({
      action: existing ? 'GLOBAL_LEGAL_ENTITY_UPDATED' : 'GLOBAL_LEGAL_ENTITY_CREATED',
      category: 'global_i18n',
      targetType: 'GlobalLegalEntity',
      targetId: id,
      targetName: `${record.name} (${record.countryName})`,
      summary: `Saved legal entity "${record.name}" in ${record.countryName} (${record.currencyCode} · ${record.timezone})`,
    });

    return record;
  };

  const deleteGlobalLegalEntity = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    const target = globalLegalEntities.find(e => e.id === id);
    setGlobalLegalEntities(prev => {
      const next = prev.filter(e => e.id !== id);
      try { localStorage.setItem(`worknest_global_entities_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('global_legal_entities', id);

    if (target) {
      await recordAuditLog({
        action: 'GLOBAL_LEGAL_ENTITY_DELETED',
        category: 'global_i18n',
        targetType: 'GlobalLegalEntity',
        targetId: id,
        targetName: target.name,
        summary: `Deleted legal entity "${target.name}" (${target.countryName})`,
      });
    }
  };

  const saveCountryHoliday = async (
    payload: Omit<CountryHolidayItem, 'id' | 'companyId'> & { id?: string }
  ): Promise<CountryHolidayItem> => {
    const activeComp = currentCompanyId || 'default';
    const id = payload.id || `hol_${payload.countryCode.toLowerCase()}_${payload.date}_${Math.random().toString(36).slice(2, 6)}`;
    const record: CountryHolidayItem = {
      ...payload,
      id,
      companyId: activeComp,
    };

    setCountryHolidays(prev => {
      const exists = prev.some(h => h.id === id);
      const next = (exists ? prev.map(h => (h.id === id ? record : h)) : [...prev, record]).sort((a, b) =>
        String(a.date || '').localeCompare(String(b.date || ''))
      );
      try { localStorage.setItem(`worknest_country_holidays_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('country_holidays', id, record, activeComp);

    await recordAuditLog({
      action: 'COUNTRY_HOLIDAY_SAVED',
      category: 'global_i18n',
      targetType: 'CountryHoliday',
      targetId: id,
      targetName: `${record.name} (${record.date})`,
      summary: `Configured ${record.type} holiday "${record.name}" on ${record.date} for ${record.countryCode}`,
    });

    return record;
  };

  const deleteCountryHoliday = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    setCountryHolidays(prev => {
      const next = prev.filter(h => h.id !== id);
      try { localStorage.setItem(`worknest_country_holidays_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('country_holidays', id);
  };

  const loadDefaultCountryHolidays = async (countryCode: string, year: number): Promise<number> => {
    const activeComp = currentCompanyId || 'default';
    const defaults = buildDefaultCountryHolidays(countryCode, year, activeComp);
    let addedCount = 0;

    for (const item of defaults) {
      const exists = countryHolidays.some(
        h => h.countryCode === item.countryCode && h.date === item.date && h.name === item.name
      );
      if (!exists) {
        await saveCountryHoliday(item);
        addedCount++;
      }
    }
    return addedCount;
  };

  const saveCountryPayrollConfig = async (
    payload: Omit<CountryPayrollConfiguration, 'id' | 'updatedAt' | 'companyId'> & { id?: string }
  ): Promise<CountryPayrollConfiguration> => {
    const activeComp = currentCompanyId || 'default';
    const existing = payload.id
      ? countryPayrollConfigs.find(c => c.id === payload.id)
      : countryPayrollConfigs.find(c => c.countryCode.toUpperCase() === payload.countryCode.toUpperCase());
    const id = existing?.id || payload.id || `pay_cfg_${payload.countryCode.toLowerCase()}_${activeComp}`;
    const record: CountryPayrollConfiguration = {
      ...payload,
      id,
      updatedAt: new Date().toISOString(),
      companyId: activeComp,
    };

    setCountryPayrollConfigs(prev => {
      const exists = prev.some(c => c.id === id);
      const next = exists ? prev.map(c => (c.id === id ? record : c)) : [...prev, record];
      try { localStorage.setItem(`worknest_country_payroll_configs_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('country_payroll_configs', id, record, activeComp);

    await recordAuditLog({
      action: 'COUNTRY_PAYROLL_CONFIG_SAVED',
      category: 'global_i18n',
      targetType: 'CountryPayrollConfig',
      targetId: id,
      targetName: `${record.countryName} (${record.currencyCode})`,
      summary: `Updated statutory payroll & tax rules for ${record.countryName} (${record.currencyCode}, ${record.retirementSchemeName})`,
    });

    return record;
  };

  const deleteCountryPayrollConfig = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    setCountryPayrollConfigs(prev => {
      const next = prev.filter(c => c.id !== id);
      try { localStorage.setItem(`worknest_country_payroll_configs_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('country_payroll_configs', id);
  };

  const saveCustomRole = async (
    payload: Omit<CustomRoleDefinition, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'companyId'> & { id?: string }
  ): Promise<CustomRoleDefinition> => {
    const activeComp = currentCompanyId || 'default';
    const existing = payload.id ? customRoles.find(r => r.id === payload.id) : undefined;
    const id = existing?.id || payload.id || `crole_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || 'Super Admin';

    const record: CustomRoleDefinition = {
      ...payload,
      id,
      createdBy: existing?.createdBy || actorName,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      companyId: activeComp,
    };

    setCustomRoles(prev => {
      const exists = prev.some(r => r.id === id);
      const next = exists ? prev.map(r => (r.id === id ? record : r)) : [...prev, record];
      try { localStorage.setItem(`worknest_custom_roles_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('custom_roles', id, record, activeComp);

    await recordAuditLog({
      action: existing ? 'CUSTOM_ROLE_UPDATED' : 'CUSTOM_ROLE_CREATED',
      category: 'role_permission',
      targetType: 'CustomRole',
      targetId: id,
      targetName: record.name,
      summary: `${actorName} configured custom RBAC role "${record.name}" (Base: ${record.baseRole})`,
      afterValue: record.granularPermissions,
    });

    return record;
  };

  const deleteCustomRole = async (id: string) => {
    const activeComp = currentCompanyId || 'default';
    const target = customRoles.find(r => r.id === id);
    setCustomRoles(prev => {
      const next = prev.filter(r => r.id !== id);
      try { localStorage.setItem(`worknest_custom_roles_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await deleteRecordFromFirestore('custom_roles', id);

    if (target) {
      await recordAuditLog({
        action: 'CUSTOM_ROLE_DELETED',
        category: 'role_permission',
        targetType: 'CustomRole',
        targetId: id,
        targetName: target.name,
        summary: `Deleted custom RBAC role "${target.name}"`,
      });
    }
  };

  const revokeSecuritySession = async (sessionId: string) => {
    const activeComp = currentCompanyId || 'default';
    const target = securitySessions.find(s => s.id === sessionId);
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || 'Security Admin';

    setSecuritySessions(prev => {
      const next = prev.map(s =>
        s.id === sessionId ? { ...s, status: 'revoked' as const, revokedAt: nowIso, revokedBy: actorName } : s
      );
      try { localStorage.setItem(`worknest_security_sessions_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });
    await syncRecordToFirestore('security_sessions', sessionId, {
      status: 'revoked',
      revokedAt: nowIso,
      revokedBy: actorName,
    }, activeComp);

    await recordAuditLog({
      action: 'SECURITY_SESSION_REVOKED',
      category: 'security',
      targetType: 'SecuritySession',
      targetId: sessionId,
      targetName: target ? `${target.actorName} (${target.deviceSummary})` : sessionId,
      summary: `${actorName} remotely revoked session for ${target?.actorName || sessionId} (${target?.deviceSummary || ''})`,
    });
  };

  const revokeAllOtherSessions = async (): Promise<number> => {
    const activeComp = currentCompanyId || 'default';
    const currentSessId = (() => {
      try { return localStorage.getItem('worknest_active_session_id') || ''; } catch { return ''; }
    })();
    const nowIso = new Date().toISOString();
    const actorName = currentUser?.name || 'Security Admin';
    const toRevoke = securitySessions.filter(s => s.status === 'active' && s.id !== currentSessId);

    for (const sess of toRevoke) {
      await syncRecordToFirestore('security_sessions', sess.id, {
        status: 'revoked',
        revokedAt: nowIso,
        revokedBy: actorName,
      }, activeComp);
    }

    setSecuritySessions(prev => {
      const next = prev.map(s =>
        s.status === 'active' && s.id !== currentSessId
          ? { ...s, status: 'revoked' as const, revokedAt: nowIso, revokedBy: actorName }
          : s
      );
      try { localStorage.setItem(`worknest_security_sessions_${activeComp}`, JSON.stringify(next)); } catch {}
      return next;
    });

    if (toRevoke.length > 0) {
      await recordAuditLog({
        action: 'BULK_SECURITY_SESSIONS_REVOKED',
        category: 'security',
        targetType: 'SecuritySession',
        targetId: activeComp,
        targetName: `${toRevoke.length} Active Sessions`,
        summary: `${actorName} terminated ${toRevoke.length} concurrent sessions across tenant workspace.`,
      });
    }

    return toRevoke.length;
  };

  const updateTenantSecurityPolicy = async (updates: Partial<TenantSecurityPolicy>) => {
    const activeComp = currentCompanyId || 'default';
    const actorName = currentUser?.name || 'Super Admin';
    const nowIso = new Date().toISOString();
    const nextPolicy: TenantSecurityPolicy = {
      ...tenantSecurityPolicy,
      ...updates,
      companyId: activeComp,
      updatedAt: nowIso,
      updatedBy: actorName,
    };

    setTenantSecurityPolicy(nextPolicy);
    try { localStorage.setItem(`worknest_security_policy_${activeComp}`, JSON.stringify(nextPolicy)); } catch {}
    await syncRecordToFirestore('settings', `security_policy_${activeComp}`, nextPolicy, activeComp);

    await recordAuditLog({
      action: 'TENANT_SECURITY_POLICY_UPDATED',
      category: 'security',
      targetType: 'TenantSecurityPolicy',
      targetId: `security_policy_${activeComp}`,
      targetName: 'Enterprise Security Policy',
      summary: `${actorName} updated tenant security policy (MFA Required: ${nextPolicy.mfaRequiredForAdmins ? 'Yes' : 'No'}, Max Failed Logins: ${nextPolicy.maxFailedLoginAttempts}, Session Timeout: ${nextPolicy.sessionTimeoutMinutes}m)`,
      afterValue: updates,
    });
  };

  return (
    <DataContext.Provider value={{
      isAuthenticated, login, logout, currentUser, updateAdminProfile, resetAllData,
      adminAccounts, addAdminAccount, updateAdminAccount, deleteAdminAccount,
      isEmployeeAuthenticated, loginEmployee, logoutEmployee, currentEmployee, updateEmployeeCredentials,
      getEmployeeAttendance,
      firebaseConnected, firebaseSyncing, lastSyncTime, liveSyncEnabled, activeFirebaseConfig,
      connectFirebase, disconnectFirebase, manualSync, toggleLiveSync, unmarkDataWiped,
      notifications, unreadNotificationCount, markNotificationRead, markAllNotificationsRead, addNotification,
      messages, unreadMessageCount, markMessageRead, sendMessage, deleteMessage,
      employees, allEmployees, addEmployee, updateEmployee, deleteEmployee,
      branches, activeBranch: normalizedActiveBranch, setActiveBranch, addBranch, updateBranch, deleteBranch, getEmployeeBranch, getDeviceBranch,
      departments, addDepartment, updateDepartment, deleteDepartment,
      shifts, addShift, updateShift, deleteShift,
      roster, setRoster, addRosterEntry, updateRosterEntry, saveRosterEntries, deleteRosterEntries,
      companyHolidays, saveCompanyHoliday, deleteCompanyHoliday,
      leaveRequests, addLeaveRequest, updateLeaveRequest, requestLeave, approveLeave, rejectLeave,
      attendanceRequests, addAttendanceRequest, updateAttendanceRequestStatus,
      monthlyPayrollRuns, generateMonthEndPayroll, approveMonthlyPayrollRun, lockMonthlyPayrollRun, unlockMonthlyPayrollRun,
      salaryAdvancesLoans, saveSalaryAdvanceLoan, updateSalaryAdvanceLoan, deleteSalaryAdvanceLoan,
      recruitmentJobs, addRecruitmentJob, updateRecruitmentJobStatus,
      candidates, addCandidate, addCandidatesBatch, updateCandidateStage, updateCandidate, deleteCandidate, hireCandidate,
      devices, allDevices, addDevice, updateDevice, deleteDevice, testDeviceConnection,
      workflowRequests, submitWorkflowRequest, decideWorkflowRequest,
      hrDocuments, uploadHRDocument, deleteHRDocument, sendDocumentExpiryReminder,
      auditLogs, recordAuditLog,
      performanceCycles, performanceGoals, performanceAppraisals,
      savePerformanceCycle, deletePerformanceCycle, savePerformanceGoal, updateGoalProgress, deletePerformanceGoal,
      submitSelfEvaluation, submitManagerEvaluation, addPerformanceComment,
      expenseClaims, submitExpenseClaim, decideExpenseClaim, reimburseExpenseClaim,
      onboardingRecords, initiateOnboarding, toggleOnboardingTask, addOnboardingTask, acknowledgeOnboardingPolicy,
      offboardingRecords, initiateOffboarding, updateOffboardingClearance, addOffboardingAsset, updateOffboardingAsset,
      updateOffboardingDocuments, submitExitInterview, updateFinalSettlement, terminateEmployeeAccess,
      workforcePlans, saveWorkforcePlan, deleteWorkforcePlan,
      employeeMovements, recordEmployeeMovement,
      companyAnnouncements, publishAnnouncement, acknowledgeAnnouncement, deleteAnnouncement,
      employeeRecognitions, giveRecognition, toggleRecognitionLike, deleteRecognition,
      employeeFeedbackList, submitEmployeeFeedback, respondToEmployeeFeedback,
      pulseSurveys, createPulseSurvey, submitPulseSurveyResponse, closePulseSurvey, deletePulseSurvey,
      trainingCourses, saveTrainingCourse, deleteTrainingCourse,
      trainingEnrollments, enrollInTrainingCourse, updateTrainingEnrollment, issueTrainingCertificate,
      employeeSkills, saveEmployeeSkill, verifyEmployeeSkill, deleteEmployeeSkill, sendCertificationExpiryReminder,
      positionSkillRequirements, savePositionSkillRequirement, deletePositionSkillRequirement,
      careerPathways, saveCareerPathway, deleteCareerPathway,
      careerDevelopmentPlans, saveCareerDevelopmentPlan,
      talentProfiles, saveTalentProfile,
      successionPlans, saveSuccessionPlan, deleteSuccessionPlan, promoteSuccessorToPosition,
      globalLegalEntities, saveGlobalLegalEntity, deleteGlobalLegalEntity,
      countryHolidays, saveCountryHoliday, deleteCountryHoliday, loadDefaultCountryHolidays,
      countryPayrollConfigs, saveCountryPayrollConfig, deleteCountryPayrollConfig,
      customRoles, saveCustomRole, deleteCustomRole,
      securitySessions, revokeSecuritySession, revokeAllOtherSessions,
      tenantSecurityPolicy, updateTenantSecurityPolicy,
      isCurrentUserManager, authorizedTeamEmployees, canManageEmployee,
      importBackupData
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
