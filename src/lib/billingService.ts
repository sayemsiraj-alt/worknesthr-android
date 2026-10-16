import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  runTransaction,
} from 'firebase/firestore';
import { getFirebaseInstance, sanitizeForFirestore } from './firestoreService';
import {
  BillingAuditLog,
  BillingCycle,
  Company,
  DEFAULT_OWNER_COMPANY,
  ManualPaymentInstructions,
  ManualPaymentMethod,
  SubscriptionInvoice,
  SubscriptionPayment,
  SubscriptionPlan,
} from '../types/tenant';

export const DEFAULT_PAYMENT_INSTRUCTIONS: ManualPaymentInstructions = {
  currency: 'BDT',
  bkash: {
    enabled: true,
    accountType: 'Merchant',
    number: '01700-000000',
    accountName: 'WorkNest Technologies Ltd.',
    instructions:
      'Dial *247# or open the bKash App -> Select "Make Payment" (or "Send Money" if Personal) -> Enter the number above -> Enter exact BDT invoice amount -> Enter Reference as your Company Name -> Copy the TrxID and submit below.',
  },
  nagad: {
    enabled: true,
    accountType: 'Merchant',
    number: '01800-000000',
    accountName: 'WorkNest Technologies Ltd.',
    instructions:
      'Open Nagad App or dial *167# -> Select "Merchant Pay" -> Enter our Nagad Merchant Number -> Enter the BDT amount -> Enter Reference -> Copy the Transaction ID (TrxID) and submit below.',
  },
  bankTransfer: {
    enabled: true,
    bankName: 'City Bank PLC',
    branchName: 'Gulshan Avenue Branch, Dhaka',
    accountName: 'WorkNest Technologies Ltd.',
    accountNumber: '1402938475001',
    routingNumber: '225261729',
    instructions:
      'Transfer the invoice amount in BDT via BEFTN, NPSB, RTGS, or Direct Branch Deposit to the corporate account above. Provide the Bank Reference / Deposit Slip Number and Depositor Name below.',
  },
  cash: {
    enabled: true,
    officeAddress: 'Level 7, Gulshan-2 Circle, Dhaka-1212, Bangladesh',
    authorizedReceivers: 'Accounts & Billing Desk (Sayem Siraj / Finance Officer)',
    instructions:
      'Pay in cash (BDT) at our corporate office billing desk and collect a signed Money Receipt. Enter the Money Receipt Number and Receiver Name in the form below.',
  },
  planPricingBDT: {
    starter: {
      monthly: 1000,
      yearly: 10000,
      maxEmployees: 50,
      label: 'Starter Plan (Up to 50 Employees)',
    },
    professional: {
      monthly: 1800,
      yearly: 18000,
      maxEmployees: 200,
      label: 'Professional Plan (Up to 200 Employees)',
    },
    enterprise: {
      monthly: 3000,
      yearly: 30000,
      maxEmployees: 10000,
      label: 'Enterprise Plan (Unlimited Employees)',
    },
    custom: {
      monthly: 5000,
      yearly: 50000,
      maxEmployees: 500,
      label: 'Custom Corporate Plan',
    },
  },
  billingSupportPhone: '+880 1700-000000',
  billingSupportEmail: 'sayemsiraj@gmail.com',
  updatedAt: '2026-10-01T00:00:00.000Z',
  updatedBy: 'sayemsiraj@gmail.com',
};

/**
 * Deep-merges partial Firestore billing instructions with DEFAULT_PAYMENT_INSTRUCTIONS
 * so Super Admin customized monthly and yearly BDT prices override defaults cleanly.
 */
export function mergeManualPaymentInstructions(
  data?: Partial<ManualPaymentInstructions> | null
): ManualPaymentInstructions {
  if (!data) return DEFAULT_PAYMENT_INSTRUCTIONS;
  const rawPricing = data.planPricingBDT || ({} as Partial<ManualPaymentInstructions['planPricingBDT']>);
  return {
    ...DEFAULT_PAYMENT_INSTRUCTIONS,
    ...data,
    currency: 'BDT',
    bkash: { ...DEFAULT_PAYMENT_INSTRUCTIONS.bkash, ...(data.bkash || {}) },
    nagad: { ...DEFAULT_PAYMENT_INSTRUCTIONS.nagad, ...(data.nagad || {}) },
    bankTransfer: { ...DEFAULT_PAYMENT_INSTRUCTIONS.bankTransfer, ...(data.bankTransfer || {}) },
    cash: { ...DEFAULT_PAYMENT_INSTRUCTIONS.cash, ...(data.cash || {}) },
    planPricingBDT: {
      starter: {
        ...DEFAULT_PAYMENT_INSTRUCTIONS.planPricingBDT.starter,
        ...(rawPricing.starter || {}),
      },
      professional: {
        ...DEFAULT_PAYMENT_INSTRUCTIONS.planPricingBDT.professional,
        ...(rawPricing.professional || {}),
      },
      enterprise: {
        ...DEFAULT_PAYMENT_INSTRUCTIONS.planPricingBDT.enterprise,
        ...(rawPricing.enterprise || {}),
      },
      custom: {
        ...DEFAULT_PAYMENT_INSTRUCTIONS.planPricingBDT.custom,
        ...(rawPricing.custom || {}),
      },
    },
  };
}

/**
 * Returns the currently configured BDT price for a plan and billing cycle
 * (uses Super Admin's manual monthly or yearly price without auto-calculating yearly from monthly).
 */
export function getConfiguredPlanPriceBDT(
  plan: SubscriptionPlan,
  billingCycle: BillingCycle,
  instructions: ManualPaymentInstructions = DEFAULT_PAYMENT_INSTRUCTIONS
): number {
  const planConfig =
    instructions?.planPricingBDT?.[plan] ||
    DEFAULT_PAYMENT_INSTRUCTIONS.planPricingBDT[plan] ||
    DEFAULT_PAYMENT_INSTRUCTIONS.planPricingBDT.professional;
  return Number(billingCycle === 'yearly' ? planConfig.yearly : planConfig.monthly) || 0;
}

/**
 * Formats a number as BDT currency string (e.g., ৳ 5,000)
 */
export function formatBDT(amount: number | undefined | null): string {
  const num = Number(amount) || 0;
  return `৳ ${num.toLocaleString('en-BD', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Normalizes a transaction/reference number for strict duplicate detection
 */
export function normalizeTransactionReference(rawRef: string): string {
  return String(rawRef || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Calculates renewal period start and end dates in YYYY-MM-DD format.
 * Anchors to max(today, currentExpiryDate) so early renewals never lose days.
 */
export function calculateRenewalPeriodDates(
  currentExpiryDate: string | undefined,
  billingCycle: BillingCycle
): { periodStart: string; periodEnd: string; monthsCount: number } {
  const todayStr = new Date().toISOString().split('T')[0];
  const baseDateStr =
    currentExpiryDate && currentExpiryDate >= todayStr ? currentExpiryDate : todayStr;

  const monthsCount = billingCycle === 'yearly' ? 12 : 1;
  const [y, m, d] = baseDateStr.split('-').map(Number);

  // Add months with safe end-of-month clamping in UTC
  const targetYear = y + Math.floor((m - 1 + monthsCount) / 12);
  const targetMonthIndex = (m - 1 + monthsCount) % 12; // 0-indexed
  const maxDayInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d || 1, maxDayInTargetMonth);

  const endDate = new Date(Date.UTC(targetYear, targetMonthIndex, clampedDay));
  const periodEnd = endDate.toISOString().split('T')[0];

  return {
    periodStart: baseDateStr,
    periodEnd,
    monthsCount,
  };
}

/**
 * Calculates temporary extension date (YYYY-MM-DD) from today or currentExpiryDate
 */
export function calculateTemporaryExtensionDate(
  currentExpiryDate: string | undefined,
  daysToAdd: number
): string {
  const todayStr = new Date().toISOString().split('T')[0];
  const baseDateStr =
    currentExpiryDate && currentExpiryDate >= todayStr ? currentExpiryDate : todayStr;
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Math.max(1, Math.floor(daysToAdd)));
  return dt.toISOString().split('T')[0];
}

/**
 * Generates a unique human-readable Invoice Number (e.g. WN-INV-202610-4829)
 */
export function generateInvoiceNumber(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `WN-INV-${ym}-${rand}`;
}

/**
 * Loads Super Admin configured manual payment instructions from Firestore
 */
export async function fetchManualPaymentInstructions(): Promise<ManualPaymentInstructions> {
  try {
    const { db } = getFirebaseInstance();
    const snap = await getDoc(doc(db, 'settings', 'billing_instructions'));
    if (snap.exists()) {
      const data = snap.data() as Partial<ManualPaymentInstructions>;
      return mergeManualPaymentInstructions(data);
    }
  } catch (err) {
    console.warn('Could not load billing_instructions from Firestore, using defaults:', err);
  }
  return DEFAULT_PAYMENT_INSTRUCTIONS;
}

/**
 * Saves Super Admin configured manual payment instructions to Firestore
 */
export async function saveManualPaymentInstructions(
  instructions: ManualPaymentInstructions,
  actorEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { db } = getFirebaseInstance();
    const now = new Date().toISOString();
    const payload: ManualPaymentInstructions = {
      ...instructions,
      currency: 'BDT',
      updatedAt: now,
      updatedBy: actorEmail,
    };

    await setDoc(doc(db, 'settings', 'billing_instructions'), sanitizeForFirestore(payload), {
      merge: true,
    });

    // Write audit log
    const logId = `b_log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const auditLog: BillingAuditLog = {
      id: logId,
      companyId: 'default',
      companyName: 'Platform Master Configuration',
      action: 'INSTRUCTIONS_UPDATED',
      actorEmail,
      actorRole: 'Super Admin',
      summary: 'Updated manual payment instructions (bKash, Nagad, Bank Transfer, Cash) & BDT plan pricing.',
      createdAt: now,
    };
    await setDoc(doc(db, 'subscription_audit_logs', logId), sanitizeForFirestore(auditLog));

    return { success: true };
  } catch (err: any) {
    console.error('Failed to save manual payment instructions:', err);
    return {
      success: false,
      error: err?.message || 'Failed to save manual payment instructions.',
    };
  }
}

/**
 * Checks if a transaction reference / receipt number has already been used in a non-rejected payment.
 */
export async function checkDuplicateTransactionReference(
  rawReference: string,
  excludePaymentId?: string
): Promise<{ isDuplicate: boolean; conflictingPayment?: SubscriptionPayment }> {
  const normalized = normalizeTransactionReference(rawReference);
  if (!normalized || normalized.length < 3) {
    return { isDuplicate: false };
  }

  const { db } = getFirebaseInstance();
  const q = query(
    collection(db, 'subscription_payments'),
    where('normalizedReferenceKey', '==', normalized)
  );
  const snap = await getDocs(q);

  for (const docSnap of snap.docs) {
    if (excludePaymentId && docSnap.id === excludePaymentId) continue;
    const p = docSnap.data() as SubscriptionPayment;
    if (p.status !== 'rejected') {
      return { isDuplicate: true, conflictingPayment: p };
    }
  }

  return { isDuplicate: false };
}

/**
 * Creates a Subscription Invoice (in BDT) for a company
 */
export async function createSubscriptionInvoice(params: {
  company: Company;
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  totalAmountBDT?: number;
  issueDate?: string;
  dueDate?: string;
  notes?: string;
  actorEmail: string;
  actorRole: 'Super Admin' | 'Customer Admin';
}): Promise<{ success: boolean; invoice?: SubscriptionInvoice; error?: string }> {
  try {
    const { db } = getFirebaseInstance();
    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];

    let resolvedAmount = Math.round(Number(params.totalAmountBDT) || 0);
    if (resolvedAmount <= 0) {
      const liveInstructions = await fetchManualPaymentInstructions();
      resolvedAmount = getConfiguredPlanPriceBDT(
        params.plan,
        params.billingCycle,
        liveInstructions
      );
    }

    const totalAmount = Math.max(0, resolvedAmount);
    if (totalAmount <= 0) {
      return { success: false, error: 'Invoice amount in BDT must be greater than 0.' };
    }

    const { periodStart, periodEnd, monthsCount } = calculateRenewalPeriodDates(
      params.company.subscription?.expiryDate,
      params.billingCycle
    );

    const invoiceId = `inv_${params.company.id}_${Date.now().toString(36)}`;
    const invoiceNumber = generateInvoiceNumber();

    const dueDt = new Date();
    dueDt.setDate(dueDt.getDate() + 7);
    const defaultDueDate = dueDt.toISOString().split('T')[0];

    const newInvoice: SubscriptionInvoice = {
      id: invoiceId,
      invoiceNumber,
      companyId: params.company.id,
      companyName: params.company.name,
      ownerEmail: params.company.ownerEmail,
      ownerName: params.company.ownerName || params.company.name,
      plan: params.plan,
      billingCycle: params.billingCycle,
      periodStart,
      periodEnd,
      monthsCount,
      currency: 'BDT',
      totalAmount,
      paidAmount: 0,
      dueAmount: totalAmount,
      status: 'unpaid',
      issueDate: params.issueDate || todayStr,
      dueDate: params.dueDate || defaultDueDate,
      renewalApplied: false,
      notes: params.notes || '',
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(doc(db, 'subscription_invoices', invoiceId), sanitizeForFirestore(newInvoice));

    // Audit log
    const logId = `b_log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const auditLog: BillingAuditLog = {
      id: logId,
      companyId: params.company.id,
      companyName: params.company.name,
      invoiceId,
      invoiceNumber,
      action: 'INVOICE_CREATED',
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      amountBDT: totalAmount,
      summary: `Created ${params.billingCycle.toUpperCase()} invoice ${invoiceNumber} for ${formatBDT(totalAmount)} (${params.plan.toUpperCase()} plan).`,
      createdAt: now,
    };
    await setDoc(doc(db, 'subscription_audit_logs', logId), sanitizeForFirestore(auditLog));

    return { success: true, invoice: newInvoice };
  } catch (err: any) {
    console.error('Create subscription invoice error:', err);
    return { success: false, error: err?.message || 'Failed to create subscription invoice.' };
  }
}

export interface SubmitManualPaymentPayload {
  company: Company;
  existingInvoice?: SubscriptionInvoice | null;
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  expectedPlanAmountBDT: number;
  method: ManualPaymentMethod;
  requestedAmountBDT: number;
  paymentDate: string;
  transactionReference: string;
  senderNumber?: string;
  bankName?: string;
  accountInfo?: string;
  depositorName?: string;
  receiptNumber?: string;
  receiverInfo?: string;
  proofDataUrl?: string;
  customerNotes?: string;
  submittedByEmail: string;
  submittedByName?: string;
}

/**
 * Customer submits a manual payment request (bKash, Nagad, Bank Transfer, Cash)
 */
export async function submitManualPaymentRequest(
  payload: SubmitManualPaymentPayload
): Promise<{
  success: boolean;
  payment?: SubscriptionPayment;
  invoice?: SubscriptionInvoice;
  error?: string;
}> {
  try {
    const amount = Math.round(Number(payload.requestedAmountBDT) || 0);
    if (amount <= 0) {
      return { success: false, error: 'Please enter a valid payment amount in BDT.' };
    }

    const rawReference = (
      payload.method === 'cash'
        ? payload.receiptNumber || payload.transactionReference
        : payload.transactionReference
    )?.trim();

    if (!rawReference || rawReference.length < 3) {
      return {
        success: false,
        error:
          payload.method === 'cash'
            ? 'Please enter a valid Cash Receipt / Reference Number.'
            : payload.method === 'bank_transfer'
            ? 'Please enter the Bank Reference / Deposit Slip Number.'
            : `Please enter a valid ${payload.method === 'bkash' ? 'bKash' : 'Nagad'} Transaction ID (TrxID).`,
      };
    }

    // Method-specific validation
    if (payload.method === 'bkash' || payload.method === 'nagad') {
      if (!payload.senderNumber || payload.senderNumber.trim().length < 8) {
        return {
          success: false,
          error: `Please enter the ${payload.method === 'bkash' ? 'bKash' : 'Nagad'} Sender Mobile Number.`,
        };
      }
    } else if (payload.method === 'bank_transfer') {
      if (!payload.bankName?.trim() || !payload.depositorName?.trim()) {
        return {
          success: false,
          error: 'Please enter both the Bank/Account Information and Depositor Name.',
        };
      }
    } else if (payload.method === 'cash') {
      if (!payload.receiverInfo?.trim()) {
        return {
          success: false,
          error: 'Please enter the Receiver Name / Information for the Cash payment.',
        };
      }
    }

    // Check duplicate transaction/reference number across non-rejected payments
    const dupCheck = await checkDuplicateTransactionReference(rawReference);
    if (dupCheck.isDuplicate) {
      return {
        success: false,
        error: `Duplicate Transaction/Reference Number ("${rawReference}") detected. This reference has already been submitted under Invoice ${dupCheck.conflictingPayment?.invoiceNumber || ''}.`,
      };
    }

    const { db } = getFirebaseInstance();
    const now = new Date().toISOString();
    const normalizedKey = normalizeTransactionReference(rawReference);

    // Resolve or create target invoice (existing invoices keep their original historical amount)
    let targetInvoice = payload.existingInvoice || null;
    if (!targetInvoice) {
      const liveInstructions = await fetchManualPaymentInstructions();
      const configuredPrice = getConfiguredPlanPriceBDT(
        payload.plan,
        payload.billingCycle,
        liveInstructions
      );
      const baseExpected =
        configuredPrice > 0
          ? configuredPrice
          : Math.round(Number(payload.expectedPlanAmountBDT) || amount);
      const invoiceTotal = Math.max(amount, baseExpected);
      const invRes = await createSubscriptionInvoice({
        company: payload.company,
        plan: payload.plan,
        billingCycle: payload.billingCycle,
        totalAmountBDT: invoiceTotal,
        notes: `Generated automatically upon customer manual payment submission (${payload.method.toUpperCase()}).`,
        actorEmail: payload.submittedByEmail,
        actorRole: 'Customer Admin',
      });
      if (!invRes.success || !invRes.invoice) {
        return { success: false, error: invRes.error || 'Could not generate invoice for payment.' };
      }
      targetInvoice = invRes.invoice;
    }

    const paymentId = `pay_${payload.company.id}_${Date.now().toString(36)}`;
    const newPayment: SubscriptionPayment = {
      id: paymentId,
      invoiceId: targetInvoice.id,
      invoiceNumber: targetInvoice.invoiceNumber,
      companyId: payload.company.id,
      companyName: payload.company.name,
      ownerEmail: payload.company.ownerEmail,
      plan: targetInvoice.plan,
      billingCycle: targetInvoice.billingCycle,
      monthsCount: targetInvoice.monthsCount,
      method: payload.method,
      currency: 'BDT',
      requestedAmount: amount,
      approvedAmount: 0,
      status: 'pending',
      paymentDate: payload.paymentDate || now.split('T')[0],
      transactionReference: rawReference,
      normalizedReferenceKey: normalizedKey,
      senderNumber: payload.senderNumber?.trim() || '',
      bankName: payload.bankName?.trim() || '',
      accountInfo: payload.accountInfo?.trim() || '',
      depositorName: payload.depositorName?.trim() || '',
      receiptNumber:
        payload.method === 'cash' ? rawReference : payload.receiptNumber?.trim() || '',
      receiverInfo: payload.receiverInfo?.trim() || '',
      proofDataUrl: payload.proofDataUrl || '',
      customerNotes: payload.customerNotes?.trim() || '',
      renewalApplied: false,
      submittedByEmail: payload.submittedByEmail,
      submittedByName: payload.submittedByName || payload.company.ownerName || payload.company.name,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(doc(db, 'subscription_payments', paymentId), sanitizeForFirestore(newPayment));

    // Write audit log
    const logId = `b_log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const auditLog: BillingAuditLog = {
      id: logId,
      companyId: payload.company.id,
      companyName: payload.company.name,
      invoiceId: targetInvoice.id,
      invoiceNumber: targetInvoice.invoiceNumber,
      paymentId,
      action: 'PAYMENT_SUBMITTED',
      actorEmail: payload.submittedByEmail,
      actorRole: 'Customer Admin',
      amountBDT: amount,
      method: payload.method,
      transactionReference: rawReference,
      summary: `Submitted ${payload.method.toUpperCase()} manual payment of ${formatBDT(amount)} (Ref: ${rawReference}) for Invoice ${targetInvoice.invoiceNumber}.`,
      createdAt: now,
    };
    await setDoc(doc(db, 'subscription_audit_logs', logId), sanitizeForFirestore(auditLog));

    return {
      success: true,
      payment: newPayment,
      invoice: targetInvoice,
    };
  } catch (err: any) {
    console.error('Submit manual payment error:', err);
    return {
      success: false,
      error: err?.message || 'Failed to submit manual payment request.',
    };
  }
}

export interface ReviewManualPaymentInput {
  paymentId: string;
  decision: 'approved' | 'partially_approved' | 'rejected';
  approvedAmountBDT?: number;
  adminNotes?: string;
  rejectionReason?: string;
  grantTemporaryExtension?: boolean;
  temporaryExtensionDays?: number;
  reviewerEmail: string;
}

/**
 * Super Admin approves, partially approves, or rejects a manual payment submission.
 * Uses a Firestore transaction to guarantee idempotency so a payment can never renew a subscription twice.
 */
export async function reviewManualPayment(
  input: ReviewManualPaymentInput
): Promise<{
  success: boolean;
  alreadyProcessed?: boolean;
  newExpiryDate?: string;
  error?: string;
}> {
  try {
    const { db } = getFirebaseInstance();
    const paymentRef = doc(db, 'subscription_payments', input.paymentId);
    const preSnap = await getDoc(paymentRef);

    if (!preSnap.exists()) {
      return { success: false, error: 'Payment record not found.' };
    }

    const prePayment = preSnap.data() as SubscriptionPayment;

    // Duplicate reference check before approving or partially approving
    if (input.decision === 'approved' || input.decision === 'partially_approved') {
      const dupCheck = await checkDuplicateTransactionReference(
        prePayment.transactionReference,
        prePayment.id
      );
      if (dupCheck.isDuplicate && dupCheck.conflictingPayment?.status !== 'pending') {
        return {
          success: false,
          error: `Cannot approve: Transaction Reference "${prePayment.transactionReference}" is already approved on another payment (${dupCheck.conflictingPayment?.invoiceNumber}).`,
        };
      }
    }

    if (input.decision === 'rejected' && !input.rejectionReason?.trim()) {
      return { success: false, error: 'Please provide a rejection reason.' };
    }

    let finalNewExpiryDate: string | undefined;
    let wasAlreadyProcessed = false;
    let ownerEmailToActivate: string | undefined;

    await runTransaction(db, async (transaction) => {
      const payDoc = await transaction.get(paymentRef);
      if (!payDoc.exists()) {
        throw new Error('Payment document does not exist.');
      }
      const payment = payDoc.data() as SubscriptionPayment;

      // Idempotency check: prevent approving an already approved & renewed payment twice
      if (payment.status === 'approved' && payment.renewalApplied && input.decision === 'approved') {
        wasAlreadyProcessed = true;
        finalNewExpiryDate = payment.newExpiryDate;
        return;
      }

      if (payment.status !== 'pending' && payment.status !== 'partially_approved') {
        throw new Error(`This payment was already finalized with status "${payment.status}".`);
      }

      const invoiceRef = doc(db, 'subscription_invoices', payment.invoiceId);
      const companyRef = doc(db, 'companies', payment.companyId);

      const [invDoc, compDoc] = await Promise.all([
        transaction.get(invoiceRef),
        transaction.get(companyRef),
      ]);

      const invoice = invDoc.exists() ? (invDoc.data() as SubscriptionInvoice) : null;
      const company = compDoc.exists() ? (compDoc.data() as Company) : null;
      const currentSub = company?.subscription || DEFAULT_OWNER_COMPANY.subscription;
      const prevExpiryDate = currentSub.expiryDate || new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();
      const todayStr = now.split('T')[0];

      // 1. REJECTED FLOW
      if (input.decision === 'rejected') {
        transaction.update(paymentRef, sanitizeForFirestore({
          status: 'rejected',
          approvedAmount: 0,
          rejectionReason: input.rejectionReason?.trim() || 'Rejected by Super Admin',
          adminNotes: input.adminNotes?.trim() || '',
          reviewedByEmail: input.reviewerEmail,
          reviewedAt: now,
          updatedAt: now,
        }));

        const logId = `b_log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const auditLog: BillingAuditLog = {
          id: logId,
          companyId: payment.companyId,
          companyName: payment.companyName,
          invoiceId: payment.invoiceId,
          invoiceNumber: payment.invoiceNumber,
          paymentId: payment.id,
          action: 'PAYMENT_REJECTED',
          actorEmail: input.reviewerEmail,
          actorRole: 'Super Admin',
          amountBDT: payment.requestedAmount,
          method: payment.method,
          transactionReference: payment.transactionReference,
          summary: `Rejected ${payment.method.toUpperCase()} payment of ${formatBDT(payment.requestedAmount)} (Ref: ${payment.transactionReference}). Reason: ${input.rejectionReason}`,
          createdAt: now,
        };
        transaction.set(doc(db, 'subscription_audit_logs', logId), sanitizeForFirestore(auditLog));
        return;
      }

      // 2. PARTIALLY APPROVED FLOW
      // Partial payment MUST NOT automatically renew the full subscription period.
      // Super Admin may optionally grant a temporary extension.
      if (input.decision === 'partially_approved') {
        const verifiedAmt = Math.round(
          Number(input.approvedAmountBDT) > 0
            ? Number(input.approvedAmountBDT)
            : payment.requestedAmount
        );
        if (verifiedAmt <= 0) {
          throw new Error('Approved partial amount must be greater than 0 BDT.');
        }

        const priorPaidOnThisPayment =
          payment.status === 'partially_approved' ? Number(payment.approvedAmount) || 0 : 0;
        const deltaPaid = Math.max(0, verifiedAmt - priorPaidOnThisPayment);

        let tempExtUntil: string | undefined;
        if (input.grantTemporaryExtension && Number(input.temporaryExtensionDays) > 0) {
          tempExtUntil = calculateTemporaryExtensionDate(
            prevExpiryDate,
            Number(input.temporaryExtensionDays)
          );
          finalNewExpiryDate = tempExtUntil;
        }

        transaction.update(paymentRef, sanitizeForFirestore({
          status: 'partially_approved',
          approvedAmount: verifiedAmt,
          adminNotes: input.adminNotes?.trim() || '',
          temporaryExtensionDays:
            input.grantTemporaryExtension && Number(input.temporaryExtensionDays) > 0
              ? Number(input.temporaryExtensionDays)
              : null,
          temporaryExtensionUntil: tempExtUntil || null,
          renewalApplied: false, // Partial payment never triggers full period auto-renewal
          previousExpiryDate: prevExpiryDate,
          newExpiryDate: tempExtUntil || prevExpiryDate,
          reviewedByEmail: input.reviewerEmail,
          reviewedAt: now,
          updatedAt: now,
        }));

        if (invoice) {
          const newInvoicePaid = (Number(invoice.paidAmount) || 0) + deltaPaid;
          const newInvoiceDue = Math.max(0, (Number(invoice.totalAmount) || 0) - newInvoicePaid);
          transaction.update(invoiceRef, sanitizeForFirestore({
            paidAmount: newInvoicePaid,
            dueAmount: newInvoiceDue,
            status: newInvoiceDue === 0 ? 'paid' : 'partially_paid',
            updatedAt: now,
          }));
        }

        if (company && tempExtUntil) {
          ownerEmailToActivate = company.ownerEmail;
          transaction.update(companyRef, sanitizeForFirestore({
            status: 'active',
            subscription: {
              ...currentSub,
              status: 'active',
              expiryDate: tempExtUntil,
              temporaryExtensionUntil: tempExtUntil,
              currency: 'BDT (৳)',
              notes: `Temporary extension granted until ${tempExtUntil} after partial payment (${formatBDT(verifiedAmt)}). Remaining balance due: ${invoice ? formatBDT(Math.max(0, invoice.totalAmount - ((invoice.paidAmount || 0) + deltaPaid))) : 'Pending'}.`,
            },
            updatedAt: now,
          }));
        }

        const logId = `b_log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const auditLog: BillingAuditLog = {
          id: logId,
          companyId: payment.companyId,
          companyName: payment.companyName,
          invoiceId: payment.invoiceId,
          invoiceNumber: payment.invoiceNumber,
          paymentId: payment.id,
          action: tempExtUntil ? 'TEMPORARY_EXTENSION_GRANTED' : 'PAYMENT_PARTIALLY_APPROVED',
          actorEmail: input.reviewerEmail,
          actorRole: 'Super Admin',
          amountBDT: verifiedAmt,
          method: payment.method,
          transactionReference: payment.transactionReference,
          previousExpiryDate: prevExpiryDate,
          newExpiryDate: tempExtUntil || prevExpiryDate,
          summary: tempExtUntil
            ? `Partially approved ${formatBDT(verifiedAmt)} (${payment.method.toUpperCase()}) for Invoice ${payment.invoiceNumber} and granted temporary extension until ${tempExtUntil}.`
            : `Partially approved ${formatBDT(verifiedAmt)} (${payment.method.toUpperCase()}) for Invoice ${payment.invoiceNumber}. Subscription not renewed until balance is settled.`,
          createdAt: now,
        };
        transaction.set(doc(db, 'subscription_audit_logs', logId), sanitizeForFirestore(auditLog));
        return;
      }

      // 3. FULL APPROVAL FLOW ('approved')
      const verifiedAmt = Math.round(
        Number(input.approvedAmountBDT) > 0
          ? Number(input.approvedAmountBDT)
          : payment.requestedAmount
      );
      const priorPaidOnThisPayment =
        payment.status === 'partially_approved' ? Number(payment.approvedAmount) || 0 : 0;
      const deltaPaid = Math.max(0, verifiedAmt - priorPaidOnThisPayment);

      // Calculate idempotent renewal dates
      const alreadyRenewedForInvoice = Boolean(invoice?.renewalApplied || payment.renewalApplied);
      const { periodEnd } = calculateRenewalPeriodDates(prevExpiryDate, payment.billingCycle);
      const targetExpiryDate = alreadyRenewedForInvoice ? prevExpiryDate : periodEnd;
      finalNewExpiryDate = targetExpiryDate;

      transaction.update(paymentRef, sanitizeForFirestore({
        status: 'approved',
        approvedAmount: verifiedAmt,
        adminNotes: input.adminNotes?.trim() || '',
        renewalApplied: true,
        previousExpiryDate: prevExpiryDate,
        newExpiryDate: targetExpiryDate,
        reviewedByEmail: input.reviewerEmail,
        reviewedAt: now,
        updatedAt: now,
      }));

      if (invoice) {
        const newInvoicePaid = (Number(invoice.paidAmount) || 0) + deltaPaid;
        const newInvoiceDue = Math.max(0, (Number(invoice.totalAmount) || 0) - newInvoicePaid);
        transaction.update(invoiceRef, sanitizeForFirestore({
          paidAmount: newInvoicePaid,
          dueAmount: newInvoiceDue,
          status: 'paid',
          paidAt: now,
          renewalApplied: true,
          renewalPaymentId: payment.id,
          updatedAt: now,
        }));
      }

      if (company && !alreadyRenewedForInvoice) {
        ownerEmailToActivate = company.ownerEmail;
        const planCapacity =
          DEFAULT_PAYMENT_INSTRUCTIONS.planPricingBDT[payment.plan]?.maxEmployees ||
          currentSub.maxEmployees ||
          100;

        transaction.update(companyRef, sanitizeForFirestore({
          status: 'active',
          subscription: {
            ...currentSub,
            status: 'active',
            plan: payment.plan,
            billingCycle: payment.billingCycle,
            expiryDate: targetExpiryDate,
            maxEmployees: Math.max(currentSub.maxEmployees || 0, planCapacity),
            currency: 'BDT (৳)',
            lastInvoiceId: payment.invoiceId,
            lastRenewalDate: todayStr,
            temporaryExtensionUntil: null,
            notes: `Renewed (${payment.billingCycle.toUpperCase()}) via verified ${payment.method.toUpperCase()} payment (${formatBDT(verifiedAmt)}, Ref: ${payment.transactionReference}) on ${todayStr}.`,
          },
          updatedAt: now,
        }));
      }

      const logId = `b_log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const auditLog: BillingAuditLog = {
        id: logId,
        companyId: payment.companyId,
        companyName: payment.companyName,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoiceNumber,
        paymentId: payment.id,
        action: 'PAYMENT_APPROVED',
        actorEmail: input.reviewerEmail,
        actorRole: 'Super Admin',
        amountBDT: verifiedAmt,
        method: payment.method,
        transactionReference: payment.transactionReference,
        previousExpiryDate: prevExpiryDate,
        newExpiryDate: targetExpiryDate,
        summary: `Approved ${payment.method.toUpperCase()} payment of ${formatBDT(verifiedAmt)} (Ref: ${payment.transactionReference}) for Invoice ${payment.invoiceNumber}. Subscription renewed until ${targetExpiryDate}.`,
        createdAt: now,
      };
      transaction.set(doc(db, 'subscription_audit_logs', logId), sanitizeForFirestore(auditLog));
    });

    // If company was reactivated/renewed, also ensure the customer's admin account is active
    if (ownerEmailToActivate) {
      try {
        const cleanEmail = ownerEmailToActivate.toLowerCase();
        const adminId = `admin_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
        await updateDoc(doc(db, 'admins', adminId), {
          status: 'active',
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // Non-fatal if admin doc uses custom ID
      }
    }

    return {
      success: true,
      alreadyProcessed: wasAlreadyProcessed,
      newExpiryDate: finalNewExpiryDate,
    };
  } catch (err: any) {
    console.error('Review manual payment error:', err);
    return {
      success: false,
      error: err?.message || 'Failed to process manual payment review.',
    };
  }
}

/**
 * Generates a clean, printable/downloadable HTML window for any Subscription Invoice (BDT)
 */
export function printSubscriptionInvoice(
  invoice: SubscriptionInvoice,
  relatedPayments: SubscriptionPayment[] = [],
  instructions: ManualPaymentInstructions = DEFAULT_PAYMENT_INSTRUCTIONS
) {
  const statusColor =
    invoice.status === 'paid'
      ? '#059669'
      : invoice.status === 'partially_paid'
      ? '#d97706'
      : '#e11d48';

  const statusLabel =
    invoice.status === 'paid'
      ? 'PAID IN FULL'
      : invoice.status === 'partially_paid'
      ? 'PARTIALLY PAID'
      : 'UNPAID / DUE';

  const paymentsRows =
    relatedPayments.length > 0
      ? relatedPayments
          .map(
            (p) => `
        <tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">${p.paymentDate}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-transform: uppercase; font-weight: 600;">${p.method.replace('_', ' ')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${p.transactionReference}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-transform: uppercase;">${p.status.replace('_', ' ')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600;">${formatBDT(p.requestedAmount)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700; color: #059669;">${formatBDT(p.approvedAmount)}</td>
        </tr>`
          )
          .join('')
      : `<tr><td colspan="6" style="padding: 12px; text-align: center; color: #64748b;">No manual payment submissions recorded for this invoice yet.</td></tr>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${invoice.invoiceNumber} - WorkNest HR</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; margin: 0; padding: 32px; background: #f8fafc; }
    .sheet { max-width: 820px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 36px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f1f5f9; padding-bottom: 24px; margin-bottom: 24px; }
    .brand { font-size: 24px; font-weight: 800; color: #1e1b4b; }
    .sub { font-size: 12px; color: #64748b; margin-top: 4px; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 999px; font-size: 12px; font-weight: 800; color: #fff; background: ${statusColor}; letter-spacing: 0.05em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
    .box-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
    th { background: #f1f5f9; color: #475569; text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    .totals { width: 320px; margin-left: auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; background: #f8fafc; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
    .totals-row.final { border-top: 2px solid #cbd5e1; margin-top: 8px; padding-top: 10px; font-weight: 800; font-size: 15px; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { border: none; box-shadow: none; padding: 16px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="no-print" style="display:flex; justify-content:flex-end; gap:10px; margin-bottom:16px;">
      <button onclick="window.print()" style="background:#4f46e5; color:#fff; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">Print / Save as PDF</button>
    </div>
    <div class="header">
      <div>
        <div class="brand">WorkNest HR</div>
        <div class="sub">WorkNest Technologies Ltd. · Enterprise Multi-Tenant HRM SaaS</div>
        <div class="sub">Support: ${instructions.billingSupportEmail || 'sayemsiraj@gmail.com'} | ${instructions.billingSupportPhone || '+880 1700-000000'}</div>
      </div>
      <div style="text-align: right;">
        <div class="badge">${statusLabel}</div>
        <div style="font-size: 18px; font-weight: 800; margin-top: 10px; font-family: monospace;">${invoice.invoiceNumber}</div>
        <div class="sub">Issue Date: ${invoice.issueDate} · Due Date: ${invoice.dueDate}</div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <div class="box-title">Billed To (Customer Tenant)</div>
        <div style="font-size: 15px; font-weight: 700;">${invoice.companyName}</div>
        <div class="sub">Workspace ID: <span style="font-family: monospace;">${invoice.companyId}</span></div>
        <div class="sub">Owner Email: ${invoice.ownerEmail}</div>
      </div>
      <div class="box">
        <div class="box-title">Subscription Billing Details</div>
        <div style="font-size: 14px; font-weight: 700; text-transform: uppercase;">${invoice.plan} Plan (${invoice.billingCycle})</div>
        <div class="sub">Billing Period: ${invoice.periodStart} to ${invoice.periodEnd} (${invoice.monthsCount} ${invoice.monthsCount === 1 ? 'Month' : 'Months'})</div>
        <div class="sub">Currency: <strong>BDT (৳) Only</strong></div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Plan</th>
          <th>Billing Cycle</th>
          <th>Period</th>
          <th style="text-align: right;">Amount (BDT)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">WorkNest HR SaaS Subscription License</td>
          <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-transform: uppercase;">${invoice.plan}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-transform: capitalize;">${invoice.billingCycle}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${invoice.periodStart} → ${invoice.periodEnd}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700;">${formatBDT(invoice.totalAmount)}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Invoice Total (BDT):</span>
        <strong>${formatBDT(invoice.totalAmount)}</strong>
      </div>
      <div class="totals-row" style="color: #059669;">
        <span>Approved Paid Amount:</span>
        <strong>${formatBDT(invoice.paidAmount)}</strong>
      </div>
      <div class="totals-row final" style="color: ${invoice.dueAmount > 0 ? '#e11d48' : '#059669'};">
        <span>Balance Due (BDT):</span>
        <span>${formatBDT(invoice.dueAmount)}</span>
      </div>
    </div>

    <div style="margin-top: 28px;">
      <div class="box-title">Payment Submissions &amp; Verification Ledger</div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Method</th>
            <th>Reference / TrxID</th>
            <th>Status</th>
            <th style="text-align: right;">Submitted (BDT)</th>
            <th style="text-align: right;">Approved (BDT)</th>
          </tr>
        </thead>
        <tbody>
          ${paymentsRows}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${invoice.invoiceNumber}_${invoice.companyId}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
