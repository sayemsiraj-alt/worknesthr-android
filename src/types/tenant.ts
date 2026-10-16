export type SubscriptionStatus = 'active' | 'expired' | 'suspended';
export type SubscriptionPlan = 'starter' | 'professional' | 'enterprise' | 'custom';
export type BillingCycle = 'monthly' | 'yearly';
export type ManualPaymentMethod = 'bkash' | 'nagad' | 'bank_transfer' | 'cash';
export type PaymentApprovalStatus = 'pending' | 'approved' | 'partially_approved' | 'rejected';
export type InvoicePaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'void';

export interface CompanySubscription {
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  startDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  billingCycle?: BillingCycle;
  maxEmployees?: number;
  pricePerMonth?: number;
  currency?: string;
  notes?: string;
  autoRenew?: boolean;
  lastInvoiceId?: string;
  lastRenewalDate?: string;
  temporaryExtensionUntil?: string;
}

export interface PlanPricingBDT {
  monthly: number;
  yearly: number;
  maxEmployees: number;
  label: string;
}

export interface ManualPaymentInstructions {
  currency: 'BDT';
  bkash: {
    enabled: boolean;
    accountType: 'Merchant' | 'Personal' | 'Agent';
    number: string;
    accountName?: string;
    instructions: string;
  };
  nagad: {
    enabled: boolean;
    accountType: 'Merchant' | 'Personal' | 'Agent';
    number: string;
    accountName?: string;
    instructions: string;
  };
  bankTransfer: {
    enabled: boolean;
    bankName: string;
    branchName: string;
    accountName: string;
    accountNumber: string;
    routingNumber?: string;
    instructions: string;
  };
  cash: {
    enabled: boolean;
    officeAddress: string;
    authorizedReceivers: string;
    instructions: string;
  };
  planPricingBDT: Record<SubscriptionPlan, PlanPricingBDT>;
  billingSupportPhone?: string;
  billingSupportEmail?: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface SubscriptionInvoice {
  id: string;
  invoiceNumber: string; // e.g., WN-INV-2026-1001
  companyId: string;
  companyName: string;
  ownerEmail: string;
  ownerName?: string;
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  monthsCount: number; // 1 for monthly, 12 for yearly
  currency: 'BDT';
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  status: InvoicePaymentStatus;
  issueDate: string; // YYYY-MM-DD
  dueDate: string;   // YYYY-MM-DD
  paidAt?: string;
  renewalApplied: boolean;
  renewalPaymentId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionPayment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  companyId: string;
  companyName: string;
  ownerEmail: string;
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  monthsCount: number;
  method: ManualPaymentMethod;
  currency: 'BDT';
  requestedAmount: number; // Amount submitted by customer in BDT
  approvedAmount: number;  // Amount verified/approved by Super Admin in BDT
  status: PaymentApprovalStatus;
  paymentDate: string;     // YYYY-MM-DD
  transactionReference: string; // TrxID / Reference / Receipt Number
  normalizedReferenceKey: string; // Uppercase normalized key for duplicate prevention
  // bKash / Nagad specific
  senderNumber?: string;
  // Bank Transfer specific
  bankName?: string;
  accountInfo?: string;
  depositorName?: string;
  // Cash specific
  receiptNumber?: string;
  receiverInfo?: string;
  // Common optional proof & notes
  proofDataUrl?: string;
  customerNotes?: string;
  // Super Admin review fields
  adminNotes?: string;
  rejectionReason?: string;
  temporaryExtensionDays?: number;
  temporaryExtensionUntil?: string;
  renewalApplied: boolean;
  previousExpiryDate?: string;
  newExpiryDate?: string;
  submittedByEmail: string;
  submittedByName?: string;
  submittedAt: string;
  reviewedByEmail?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillingAuditLog {
  id: string;
  companyId: string;
  companyName: string;
  invoiceId?: string;
  invoiceNumber?: string;
  paymentId?: string;
  action:
    | 'INVOICE_CREATED'
    | 'PAYMENT_SUBMITTED'
    | 'PAYMENT_APPROVED'
    | 'PAYMENT_PARTIALLY_APPROVED'
    | 'PAYMENT_REJECTED'
    | 'SUBSCRIPTION_RENEWED'
    | 'TEMPORARY_EXTENSION_GRANTED'
    | 'INSTRUCTIONS_UPDATED';
  actorEmail: string;
  actorRole: 'Super Admin' | 'Customer Admin';
  amountBDT?: number;
  method?: ManualPaymentMethod;
  transactionReference?: string;
  previousExpiryDate?: string;
  newExpiryDate?: string;
  summary: string;
  createdAt: string;
}

export interface CompanyProfile {
  companyName: string;
  legalName?: string;
  email: string;
  phone?: string;
  address?: string;
  logo?: string;
  currency: string;
  currencySymbol: string;
  timezone: string;
  fiscalYear: string;
  taxNumber?: string;
}

export interface CompanySettings {
  attendance?: {
    defaultStart?: string;
    defaultEnd?: string;
    graceMinutes?: number;
    halfDayHours?: number;
    fullDayHours?: number;
    earlyArrivalWindowMinutes?: number;
    otThresholdMinutes?: number;
    weekendDays?: string[];
    cameraVerificationRequired?: boolean;
    biometricEnforced?: boolean;
  };
  leave?: {
    annualDays?: number;
    casualDays?: number;
    sickDays?: number;
    maternityDays?: number;
    paternityDays?: number;
    allowUnpaid?: boolean;
    carryForwardEnabled?: boolean;
    maxCarryForwardDays?: number;
    requireMedicalCertDays?: number;
    multiLevelApproval?: boolean;
  };
  payroll?: {
    salaryDay?: number;
    basicPercent?: number;
    houseRentPercent?: number;
    medicalPercent?: number;
    conveyancePercent?: number;
    autoPfDeduction?: boolean;
    pfEmployeePercent?: number;
    pfEmployerMatch?: boolean;
    otRateMultiplier?: number;
    autoTaxDeduction?: boolean;
    taxPercent?: number;
  };
  zkteco?: {
    deviceIp?: string;
    devicePort?: string;
    deviceSerial?: string;
    deviceName?: string;
    autoSyncInterval?: number;
    autoSyncEnabled?: boolean;
    [key: string]: any;
  };
}

export interface Company {
  id: string; // tenantId (e.g. 'default' for current owner, 'comp_xyz' for clients)
  name: string;
  slug?: string;
  ownerEmail: string;
  ownerName?: string;
  ownerUid?: string;
  status: 'active' | 'suspended' | 'inactive';
  subscription: CompanySubscription;
  profile: CompanyProfile;
  settings?: CompanySettings;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_OWNER_COMPANY: Company = {
  id: 'default',
  name: 'WorkNest Technologies Ltd.',
  slug: 'worknest-main',
  ownerEmail: 'sayemsiraj@gmail.com',
  ownerName: 'Sayem Siraj',
  status: 'active',
  subscription: {
    status: 'active',
    plan: 'enterprise',
    startDate: '2024-01-01',
    expiryDate: '2099-12-31',
    maxEmployees: 10000,
    notes: 'Primary Software Owner & Super Admin Master Workspace',
  },
  profile: {
    companyName: 'WorkNest Technologies Ltd.',
    legalName: 'WorkNest Solutions International',
    email: 'hr@worknest.com',
    phone: '+880 1700-000000',
    address: 'Gulshan-2, Dhaka-1212, Bangladesh',
    currency: 'BDT (৳)',
    currencySymbol: '৳',
    timezone: 'Asia/Dhaka (GMT+6)',
    fiscalYear: 'July - June',
    taxNumber: 'TRAD/DNCC/012345/2024',
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
};
