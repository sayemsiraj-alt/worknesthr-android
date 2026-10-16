import React, { useState, useEffect, useMemo } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { useTenant } from '../context/TenantContext';
import { useData } from '../context/DataContext';
import { getFirebaseInstance } from '../lib/firestoreService';
import {
  BillingAuditLog,
  BillingCycle,
  Company,
  InvoicePaymentStatus,
  ManualPaymentInstructions,
  ManualPaymentMethod,
  PaymentApprovalStatus,
  SubscriptionInvoice,
  SubscriptionPayment,
  SubscriptionPlan,
} from '../types/tenant';
import {
  calculateRenewalPeriodDates,
  calculateTemporaryExtensionDate,
  createSubscriptionInvoice,
  DEFAULT_PAYMENT_INSTRUCTIONS,
  formatBDT,
  getConfiguredPlanPriceBDT,
  mergeManualPaymentInstructions,
  printSubscriptionInvoice,
  reviewManualPayment,
  saveManualPaymentInstructions,
} from '../lib/billingService';
import {
  IconCalendar,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconDownload,
  IconFileText,
  IconFilter,
  IconPlus,
  IconSearch,
  IconSettings,
  IconWallet,
  IconXCircle,
} from './Icons';

type BillingSubTab = 'payments' | 'invoices' | 'instructions' | 'history';

export function SuperAdminBillingManager() {
  const { allCompanies, isSuperAdmin } = useTenant();
  const { currentUser } = useData();

  const [activeSubTab, setActiveSubTab] = useState<BillingSubTab>('payments');
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [auditLogs, setAuditLogs] = useState<BillingAuditLog[]>([]);
  const [instructions, setInstructions] = useState<ManualPaymentInstructions>(
    DEFAULT_PAYMENT_INSTRUCTIONS
  );
  const [loading, setLoading] = useState(true);

  // Filters for Manual Payment Submissions
  const [filterCompanyId, setFilterCompanyId] = useState<string>('all');
  const [filterMethod, setFilterMethod] = useState<'all' | ManualPaymentMethod>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | PaymentApprovalStatus>('all');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Filters for Invoices
  const [invCompanyFilter, setInvCompanyFilter] = useState<string>('all');
  const [invStatusFilter, setInvStatusFilter] = useState<'all' | InvoicePaymentStatus>('all');
  const [invSearch, setInvSearch] = useState<string>('');

  // Review Payment Modal State
  const [reviewingPayment, setReviewingPayment] = useState<SubscriptionPayment | null>(null);
  const [reviewDecision, setReviewDecision] = useState<
    'approved' | 'partially_approved' | 'rejected'
  >('approved');
  const [reviewApprovedAmount, setReviewApprovedAmount] = useState<string>('');
  const [reviewAdminNotes, setReviewAdminNotes] = useState<string>('');
  const [reviewRejectionReason, setReviewRejectionReason] = useState<string>('');
  const [grantTempExtension, setGrantTempExtension] = useState<boolean>(false);
  const [tempExtensionDays, setTempExtensionDays] = useState<number>(7);
  const [isProcessingReview, setIsProcessingReview] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Create Manual Invoice Modal State
  const [showCreateInvoiceModal, setShowCreateInvoiceModal] = useState<boolean>(false);
  const [newInvCompanyId, setNewInvCompanyId] = useState<string>('');
  const [newInvPlan, setNewInvPlan] = useState<SubscriptionPlan>('professional');
  const [newInvCycle, setNewInvCycle] = useState<BillingCycle>('monthly');
  const [newInvAmountBDT, setNewInvAmountBDT] = useState<string>(
    String(DEFAULT_PAYMENT_INSTRUCTIONS.planPricingBDT.professional.monthly)
  );
  const [newInvDueDate, setNewInvDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [newInvNotes, setNewInvNotes] = useState<string>('');
  const [creatingInvoice, setCreatingInvoice] = useState<boolean>(false);
  const [createInvError, setCreateInvError] = useState<string | null>(null);

  // Instructions Editor State
  const [savingInstructions, setSavingInstructions] = useState<boolean>(false);
  const [instructionsMsg, setInstructionsMsg] = useState<string | null>(null);

  // Proof & Invoice Preview Modals
  const [previewProofUrl, setPreviewProofUrl] = useState<string | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<SubscriptionInvoice | null>(null);

  // Customer companies (excluding default master if needed, or all)
  const customerCompanies = useMemo(() => {
    const map = new Map<string, Company>();
    for (const c of allCompanies) {
      if (c && c.id && !map.has(c.id)) {
        map.set(c.id, c);
      }
    }
    return Array.from(map.values());
  }, [allCompanies]);

  // Real-time listeners for Super Admin
  useEffect(() => {
    if (!isSuperAdmin) return;
    setLoading(true);
    const { db } = getFirebaseInstance();

    const unsubPay = onSnapshot(
      collection(db, 'subscription_payments'),
      (snap) => {
        const list: SubscriptionPayment[] = [];
        snap.forEach((d) => list.push({ ...(d.data() as SubscriptionPayment), id: d.id }));
        list.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
        setPayments(list);
        setLoading(false);
      },
      (err) => {
        console.warn('SuperAdmin payments listener warning:', err);
        setLoading(false);
      }
    );

    const unsubInv = onSnapshot(
      collection(db, 'subscription_invoices'),
      (snap) => {
        const list: SubscriptionInvoice[] = [];
        snap.forEach((d) => list.push({ ...(d.data() as SubscriptionInvoice), id: d.id }));
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setInvoices(list);
      },
      (err) => {
        console.warn('SuperAdmin invoices listener warning:', err);
      }
    );

    const unsubLogs = onSnapshot(
      collection(db, 'subscription_audit_logs'),
      (snap) => {
        const list: BillingAuditLog[] = [];
        snap.forEach((d) => list.push({ ...(d.data() as BillingAuditLog), id: d.id }));
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setAuditLogs(list);
      },
      (err) => {
        console.warn('SuperAdmin billing audit logs listener warning:', err);
      }
    );

    const unsubInst = onSnapshot(
      doc(db, 'settings', 'billing_instructions'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<ManualPaymentInstructions>;
          setInstructions(mergeManualPaymentInstructions(data));
        }
      },
      (err) => {
        console.warn('SuperAdmin instructions listener warning:', err);
      }
    );

    return () => {
      unsubPay();
      unsubInv();
      unsubLogs();
      unsubInst();
    };
  }, [isSuperAdmin]);

  // Sync default invoice amount when plan/cycle changes in Create Invoice modal
  useEffect(() => {
    setNewInvAmountBDT(String(getConfiguredPlanPriceBDT(newInvPlan, newInvCycle, instructions)));
  }, [newInvPlan, newInvCycle, instructions]);

  // Filtered payments list
  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      if (filterCompanyId !== 'all' && p.companyId !== filterCompanyId) return false;
      if (filterMethod !== 'all' && p.method !== filterMethod) return false;
      if (filterStatus !== 'all' && p.status !== filterStatus) return false;
      if (filterDateFrom && p.paymentDate < filterDateFrom) return false;
      if (filterDateTo && p.paymentDate > filterDateTo) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          p.companyName?.toLowerCase().includes(q) ||
          p.ownerEmail?.toLowerCase().includes(q) ||
          p.invoiceNumber?.toLowerCase().includes(q) ||
          p.transactionReference?.toLowerCase().includes(q) ||
          p.senderNumber?.toLowerCase().includes(q) ||
          p.depositorName?.toLowerCase().includes(q) ||
          p.receiverInfo?.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [
    payments,
    filterCompanyId,
    filterMethod,
    filterStatus,
    filterDateFrom,
    filterDateTo,
    searchQuery,
  ]);

  // Filtered invoices list
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (invCompanyFilter !== 'all' && inv.companyId !== invCompanyFilter) return false;
      if (invStatusFilter !== 'all' && inv.status !== invStatusFilter) return false;
      if (invSearch.trim()) {
        const q = invSearch.toLowerCase();
        const match =
          inv.invoiceNumber?.toLowerCase().includes(q) ||
          inv.companyName?.toLowerCase().includes(q) ||
          inv.ownerEmail?.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [invoices, invCompanyFilter, invStatusFilter, invSearch]);

  // Top KPI Metrics (BDT Only)
  const kpiStats = useMemo(() => {
    const totalCollectedBDT = payments
      .filter((p) => p.status === 'approved' || p.status === 'partially_approved')
      .reduce((sum, p) => sum + (Number(p.approvedAmount) || 0), 0);

    const pendingList = payments.filter((p) => p.status === 'pending');
    const pendingAmountBDT = pendingList.reduce(
      (sum, p) => sum + (Number(p.requestedAmount) || 0),
      0
    );

    const totalOutstandingDueBDT = invoices
      .filter((i) => i.status === 'unpaid' || i.status === 'partially_paid')
      .reduce((sum, i) => sum + (Number(i.dueAmount) || 0), 0);

    const renewalsCount = payments.filter((p) => p.status === 'approved' && p.renewalApplied).length;

    return {
      totalCollectedBDT,
      pendingCount: pendingList.length,
      pendingAmountBDT,
      totalOutstandingDueBDT,
      renewalsCount,
    };
  }, [payments, invoices]);

  // Open review modal for a payment
  const handleOpenReviewModal = (pay: SubscriptionPayment) => {
    setReviewingPayment(pay);
    setReviewDecision(pay.status === 'partially_approved' ? 'partially_approved' : 'approved');
    setReviewApprovedAmount(String(pay.requestedAmount));
    setReviewAdminNotes(pay.adminNotes || '');
    setReviewRejectionReason(pay.rejectionReason || '');
    setGrantTempExtension(false);
    setTempExtensionDays(7);
    setReviewError(null);
  };

  const handleConfirmReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingPayment) return;
    setReviewError(null);
    setIsProcessingReview(true);

    const res = await reviewManualPayment({
      paymentId: reviewingPayment.id,
      decision: reviewDecision,
      approvedAmountBDT: Number(reviewApprovedAmount),
      adminNotes: reviewAdminNotes,
      rejectionReason: reviewRejectionReason,
      grantTemporaryExtension: reviewDecision === 'partially_approved' && grantTempExtension,
      temporaryExtensionDays: tempExtensionDays,
      reviewerEmail: currentUser?.email || 'sayemsiraj@gmail.com',
    });

    setIsProcessingReview(false);
    if (!res.success) {
      setReviewError(res.error || 'Failed to review payment.');
      return;
    }

    setReviewingPayment(null);
  };

  const handleCreateManualInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateInvError(null);

    const targetComp = customerCompanies.find((c) => c.id === newInvCompanyId);
    if (!targetComp) {
      setCreateInvError('Please select a customer company.');
      return;
    }

    setCreatingInvoice(true);
    const res = await createSubscriptionInvoice({
      company: targetComp,
      plan: newInvPlan,
      billingCycle: newInvCycle,
      totalAmountBDT: Number(newInvAmountBDT),
      dueDate: newInvDueDate,
      notes: newInvNotes,
      actorEmail: currentUser?.email || 'sayemsiraj@gmail.com',
      actorRole: 'Super Admin',
    });
    setCreatingInvoice(false);

    if (!res.success) {
      setCreateInvError(res.error || 'Failed to create invoice.');
      return;
    }

    setShowCreateInvoiceModal(false);
    setNewInvNotes('');
  };

  const handleSaveInstructions = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingInstructions(true);
    setInstructionsMsg(null);
    const res = await saveManualPaymentInstructions(
      instructions,
      currentUser?.email || 'sayemsiraj@gmail.com'
    );
    setSavingInstructions(false);
    if (res.success) {
      setInstructionsMsg(
        'Manual payment instructions and BDT pricing saved! Customers will immediately see these updated details.'
      );
      setTimeout(() => setInstructionsMsg(null), 4000);
    } else {
      setInstructionsMsg(`Error: ${res.error}`);
    }
  };

  const renderPaymentBadge = (status: PaymentApprovalStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Approved
          </span>
        );
      case 'partially_approved':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            Partially Approved
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            Rejected
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            Pending
          </span>
        );
    }
  };

  const renderInvoiceBadge = (status: InvoicePaymentStatus) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Paid
          </span>
        );
      case 'partially_paid':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            Partially Paid
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            Unpaid
          </span>
        );
    }
  };

  // Preview target company & invoice inside Review Modal
  const reviewTargetCompany = useMemo(() => {
    if (!reviewingPayment) return null;
    return customerCompanies.find((c) => c.id === reviewingPayment.companyId) || null;
  }, [reviewingPayment, customerCompanies]);

  const reviewTargetInvoice = useMemo(() => {
    if (!reviewingPayment) return null;
    return invoices.find((i) => i.id === reviewingPayment.invoiceId) || null;
  }, [reviewingPayment, invoices]);

  const previewRenewalDates = useMemo(() => {
    if (!reviewingPayment) return null;
    const curExp = reviewTargetCompany?.subscription?.expiryDate;
    return calculateRenewalPeriodDates(curExp, reviewingPayment.billingCycle);
  }, [reviewingPayment, reviewTargetCompany]);

  const previewTempExtensionDate = useMemo(() => {
    if (!reviewingPayment) return null;
    const curExp = reviewTargetCompany?.subscription?.expiryDate;
    return calculateTemporaryExtensionDate(curExp, tempExtensionDays || 7);
  }, [reviewingPayment, reviewTargetCompany, tempExtensionDays]);

  return (
    <div className="space-y-6">
      {/* KPI CARDS (BDT ONLY) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Total Collected (BDT)
          </span>
          <p className="text-2xl sm:text-3xl font-black text-emerald-600 font-mono mt-2">
            {formatBDT(kpiStats.totalCollectedBDT)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Verified manual payments across tenants
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Pending Approvals
          </span>
          <p className="text-2xl sm:text-3xl font-black text-indigo-600 font-mono mt-2">
            {kpiStats.pendingCount}{' '}
            <span className="text-sm font-bold text-slate-500">
              ({formatBDT(kpiStats.pendingAmountBDT)})
            </span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Awaiting Super Admin verification</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Outstanding Due (BDT)
          </span>
          <p className="text-2xl sm:text-3xl font-black text-rose-600 font-mono mt-2">
            {formatBDT(kpiStats.totalOutstandingDueBDT)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Unpaid &amp; partial invoice balances</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Subscriptions Renewed
          </span>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 font-mono mt-2">
            {kpiStats.renewalsCount}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Idempotent full-period renewals</p>
        </div>
      </div>

      {/* SUB-NAVIGATION BAR */}
      <div className="bg-white rounded-2xl p-2 border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveSubTab('payments')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-2 ${
              activeSubTab === 'payments'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>Manual Payment Submissions</span>
            {kpiStats.pendingCount > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-amber-400 text-slate-950 font-black text-[10px]">
                {kpiStats.pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('invoices')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'invoices'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All Customer Invoices ({invoices.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('instructions')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'instructions'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Payment Instructions &amp; BDT Pricing
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('history')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'history'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Payment &amp; Renewal Audit Log
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!newInvCompanyId && customerCompanies.length > 0) {
              const firstClient =
                customerCompanies.find((c) => c.id !== 'default') || customerCompanies[0];
              setNewInvCompanyId(firstClient.id);
            }
            setShowCreateInvoiceModal(true);
          }}
          className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center space-x-1.5 cursor-pointer shadow-xs"
        >
          <IconPlus size={14} />
          <span>Issue Customer Invoice (BDT)</span>
        </button>
      </div>

      {/* =================================================================== */}
      {/* SUB-TAB 1: MANUAL PAYMENT SUBMISSIONS & VERIFICATION                */}
      {/* =================================================================== */}
      {activeSubTab === 'payments' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2 relative">
              <IconSearch
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Search company, TrxID, ref, sender, invoice #..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <select
                value={filterCompanyId}
                onChange={(e) => setFilterCompanyId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Companies</option>
                {customerCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={filterMethod}
                onChange={(e) => setFilterMethod(e.target.value as 'all' | ManualPaymentMethod)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Payment Methods</option>
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
              </select>
            </div>

            <div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | PaymentApprovalStatus)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="partially_approved">Partially Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            <div className="flex items-center space-x-1.5">
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                title="From Date"
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {filterDateFrom && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterDateFrom('');
                    setFilterDateTo('');
                  }}
                  className="px-2 py-2 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                  title="Clear Date Filter"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Payments Table */}
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Company / Tenant</th>
                    <th className="py-3.5 px-4">Invoice &amp; Plan</th>
                    <th className="py-3.5 px-4">Method &amp; Reference</th>
                    <th className="py-3.5 px-4 text-right">Submitted (BDT)</th>
                    <th className="py-3.5 px-4 text-right">Approved (BDT)</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-400">
                        Loading customer payment submissions...
                      </td>
                    </tr>
                  ) : filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-400">
                        No manual payment submissions match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredPayments.map((pay) => (
                      <tr key={pay.id} className="hover:bg-slate-50/70">
                        <td className="py-3.5 px-4 font-mono text-slate-700">
                          <div>{pay.paymentDate}</div>
                          <div className="text-[10px] text-slate-400">
                            {pay.submittedAt ? pay.submittedAt.slice(0, 16).replace('T', ' ') : ''}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900">{pay.companyName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {pay.ownerEmail}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-bold text-slate-800">
                            {pay.invoiceNumber}
                          </div>
                          <div className="text-[11px] text-slate-500 uppercase">
                            {pay.plan} · {pay.billingCycle}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold uppercase text-indigo-700">
                            {pay.method.replace('_', ' ')}
                          </div>
                          <div className="font-mono text-slate-900 font-semibold">
                            Ref: {pay.transactionReference}
                          </div>
                          {pay.senderNumber && (
                            <div className="text-[11px] text-slate-500">
                              Sender: {pay.senderNumber}
                            </div>
                          )}
                          {pay.bankName && (
                            <div className="text-[11px] text-slate-500">
                              Bank: {pay.bankName} ({pay.depositorName})
                            </div>
                          )}
                          {pay.receiverInfo && (
                            <div className="text-[11px] text-slate-500">
                              Receiver: {pay.receiverInfo}
                            </div>
                          )}
                          {pay.proofDataUrl && (
                            <button
                              type="button"
                              onClick={() => setPreviewProofUrl(pay.proofDataUrl || null)}
                              className="text-[11px] font-bold text-indigo-600 hover:underline mt-0.5 cursor-pointer"
                            >
                              View Screenshot / Proof
                            </button>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                          {formatBDT(pay.requestedAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-700">
                          {formatBDT(pay.approvedAmount)}
                        </td>
                        <td className="py-3.5 px-4">
                          {renderPaymentBadge(pay.status)}
                          {pay.newExpiryDate && pay.status === 'approved' && (
                            <div className="text-[10px] text-emerald-700 font-mono mt-0.5">
                              Exp → {pay.newExpiryDate}
                            </div>
                          )}
                          {pay.temporaryExtensionUntil && pay.status === 'partially_approved' && (
                            <div className="text-[10px] text-amber-700 font-mono mt-0.5">
                              Temp → {pay.temporaryExtensionUntil}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {pay.status === 'pending' || pay.status === 'partially_approved' ? (
                            <button
                              type="button"
                              onClick={() => handleOpenReviewModal(pay)}
                              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-xs cursor-pointer"
                            >
                              Verify / Review
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">
                              Reviewed by {pay.reviewedByEmail?.split('@')[0] || 'Admin'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 2: ALL CUSTOMER INVOICES                                    */}
      {/* =================================================================== */}
      {activeSubTab === 'invoices' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <IconSearch
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Search invoice #, company, email..."
                value={invSearch}
                onChange={(e) => setInvSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={invCompanyFilter}
                onChange={(e) => setInvCompanyFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
              >
                <option value="all">All Companies</option>
                {customerCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={invStatusFilter}
                onChange={(e) =>
                  setInvStatusFilter(e.target.value as 'all' | InvoicePaymentStatus)
                }
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
              >
                <option value="all">All Invoice Statuses</option>
                <option value="unpaid">Unpaid</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3.5 px-4">Invoice #</th>
                    <th className="py-3.5 px-4">Company</th>
                    <th className="py-3.5 px-4">Plan &amp; Period</th>
                    <th className="py-3.5 px-4 text-right">Amount (BDT)</th>
                    <th className="py-3.5 px-4 text-right">Paid (BDT)</th>
                    <th className="py-3.5 px-4 text-right">Balance Due (BDT)</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-400">
                        No invoices found matching your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/70">
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                          {inv.invoiceNumber}
                          <div className="text-[10px] font-normal text-slate-400">
                            Issued: {inv.issueDate} · Due: {inv.dueDate}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900">{inv.companyName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {inv.ownerEmail}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold uppercase text-slate-800">
                            {inv.plan} ({inv.billingCycle})
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {inv.periodStart} → {inv.periodEnd}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900">
                          {formatBDT(inv.totalAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-semibold text-emerald-700">
                          {formatBDT(inv.paidAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-rose-600">
                          {formatBDT(inv.dueAmount)}
                        </td>
                        <td className="py-3.5 px-4">{renderInvoiceBadge(inv.status)}</td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center space-x-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingInvoice(inv)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] cursor-pointer"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                printSubscriptionInvoice(
                                  inv,
                                  payments.filter((p) => p.invoiceId === inv.id),
                                  instructions
                                )
                              }
                              className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-[11px] flex items-center space-x-1 cursor-pointer"
                            >
                              <IconDownload size={13} />
                              <span>Download</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 3: SUPER ADMIN PAYMENT INSTRUCTIONS & BDT PRICING SETTINGS  */}
      {/* =================================================================== */}
      {activeSubTab === 'instructions' && (
        <form
          onSubmit={handleSaveInstructions}
          className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-6"
        >
          <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Configure Manual Payment Instructions &amp; BDT Plan Pricing
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                These details are dynamically displayed to customers when they submit a bKash,
                Nagad, Bank Transfer, or Cash payment.
              </p>
            </div>
            <button
              type="submit"
              disabled={savingInstructions}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md cursor-pointer self-start sm:self-center"
            >
              {savingInstructions ? 'Saving...' : 'Save Payment Settings'}
            </button>
          </div>

          {instructionsMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800">
              {instructionsMsg}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 1. bKash Settings */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900">1. bKash Configuration</h4>
                <span className="text-[11px] font-bold text-indigo-600">BDT Mobile Money</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    bKash Number
                  </label>
                  <input
                    type="text"
                    value={instructions.bkash.number}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        bkash: { ...instructions.bkash, number: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Account Type
                  </label>
                  <select
                    value={instructions.bkash.accountType}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        bkash: {
                          ...instructions.bkash,
                          accountType: e.target.value as 'Merchant' | 'Personal' | 'Agent',
                        },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  >
                    <option value="Merchant">Merchant</option>
                    <option value="Personal">Personal</option>
                    <option value="Agent">Agent</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  bKash Instructions Shown to Customer
                </label>
                <textarea
                  rows={2}
                  value={instructions.bkash.instructions}
                  onChange={(e) =>
                    setInstructions({
                      ...instructions,
                      bkash: { ...instructions.bkash, instructions: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900"
                />
              </div>
            </div>

            {/* 2. Nagad Settings */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900">2. Nagad Configuration</h4>
                <span className="text-[11px] font-bold text-indigo-600">BDT Mobile Money</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Nagad Number
                  </label>
                  <input
                    type="text"
                    value={instructions.nagad.number}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        nagad: { ...instructions.nagad, number: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Account Type
                  </label>
                  <select
                    value={instructions.nagad.accountType}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        nagad: {
                          ...instructions.nagad,
                          accountType: e.target.value as 'Merchant' | 'Personal' | 'Agent',
                        },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  >
                    <option value="Merchant">Merchant</option>
                    <option value="Personal">Personal</option>
                    <option value="Agent">Agent</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Nagad Instructions Shown to Customer
                </label>
                <textarea
                  rows={2}
                  value={instructions.nagad.instructions}
                  onChange={(e) =>
                    setInstructions({
                      ...instructions,
                      nagad: { ...instructions.nagad, instructions: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900"
                />
              </div>
            </div>

            {/* 3. Bank Transfer Settings */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900">
                  3. Bank Transfer Account Details
                </h4>
                <span className="text-[11px] font-bold text-indigo-600">BEFTN / NPSB / Deposit</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Bank Name
                  </label>
                  <input
                    type="text"
                    value={instructions.bankTransfer.bankName}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        bankTransfer: {
                          ...instructions.bankTransfer,
                          bankName: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    value={instructions.bankTransfer.branchName}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        bankTransfer: {
                          ...instructions.bankTransfer,
                          branchName: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Account Name
                  </label>
                  <input
                    type="text"
                    value={instructions.bankTransfer.accountName}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        bankTransfer: {
                          ...instructions.bankTransfer,
                          accountName: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Account Number
                  </label>
                  <input
                    type="text"
                    value={instructions.bankTransfer.accountNumber}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        bankTransfer: {
                          ...instructions.bankTransfer,
                          accountNumber: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Bank Transfer Instructions
                </label>
                <textarea
                  rows={2}
                  value={instructions.bankTransfer.instructions}
                  onChange={(e) =>
                    setInstructions({
                      ...instructions,
                      bankTransfer: {
                        ...instructions.bankTransfer,
                        instructions: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900"
                />
              </div>
            </div>

            {/* 4. Cash Payment Settings */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900">4. Cash Payment Instructions</h4>
                <span className="text-[11px] font-bold text-indigo-600">Direct Receipt</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Office Address
                  </label>
                  <input
                    type="text"
                    value={instructions.cash.officeAddress}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        cash: { ...instructions.cash, officeAddress: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Authorized Receiver(s)
                  </label>
                  <input
                    type="text"
                    value={instructions.cash.authorizedReceivers}
                    onChange={(e) =>
                      setInstructions({
                        ...instructions,
                        cash: { ...instructions.cash, authorizedReceivers: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Cash Instructions Shown to Customer
                </label>
                <textarea
                  rows={2}
                  value={instructions.cash.instructions}
                  onChange={(e) =>
                    setInstructions({
                      ...instructions,
                      cash: { ...instructions.cash, instructions: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Standard Plan Pricing in BDT */}
          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
            <h4 className="text-sm font-black text-slate-900">
              Standard Subscription Plan Pricing (BDT ৳ Only)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(['starter', 'professional', 'enterprise', 'custom'] as SubscriptionPlan[]).map(
                (planKey) => (
                  <div
                    key={planKey}
                    className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-2"
                  >
                    <div className="font-black text-xs uppercase text-indigo-700">
                      {planKey} Plan
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">
                        Monthly Price (BDT ৳)
                      </label>
                      <input
                        type="number"
                        value={instructions.planPricingBDT[planKey]?.monthly || 0}
                        onChange={(e) =>
                          setInstructions({
                            ...instructions,
                            planPricingBDT: {
                              ...instructions.planPricingBDT,
                              [planKey]: {
                                ...instructions.planPricingBDT[planKey],
                                monthly: Number(e.target.value) || 0,
                              },
                            },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 mt-0.5"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">
                        Yearly Price (BDT ৳)
                      </label>
                      <input
                        type="number"
                        value={instructions.planPricingBDT[planKey]?.yearly || 0}
                        onChange={(e) =>
                          setInstructions({
                            ...instructions,
                            planPricingBDT: {
                              ...instructions.planPricingBDT,
                              [planKey]: {
                                ...instructions.planPricingBDT[planKey],
                                yearly: Number(e.target.value) || 0,
                              },
                            },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 mt-0.5"
                      />
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </form>
      )}

      {/* =================================================================== */}
      {/* SUB-TAB 4: PAYMENT & RENEWAL AUDIT HISTORY                          */}
      {/* =================================================================== */}
      {activeSubTab === 'history' && (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-base font-black text-slate-900">
              Immutable Billing &amp; Subscription Renewal Audit Trail
            </h3>
            <p className="text-xs text-slate-500">
              Chronological record of all manual payment submissions, approvals, partial extensions,
              rejections, and subscription renewals.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Company</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Details &amp; Expiry Transition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-400">
                      No billing audit history recorded yet.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {log.createdAt ? log.createdAt.slice(0, 19).replace('T', ' ') : ''}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">{log.companyName}</td>
                      <td className="py-3 px-4">
                        <span className="font-mono font-bold text-[11px] text-indigo-700">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {log.actorEmail}{' '}
                        <span className="text-[10px] text-slate-400">({log.actorRole})</span>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        <div>{log.summary}</div>
                        {log.previousExpiryDate && log.newExpiryDate && (
                          <div className="text-[11px] font-mono text-emerald-700 font-semibold mt-0.5">
                            Expiry: {log.previousExpiryDate} → {log.newExpiryDate}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: SUPER ADMIN REVIEW / APPROVE / PARTIAL / REJECT PAYMENT      */}
      {/* =================================================================== */}
      {reviewingPayment && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-xl w-full shadow-2xl border border-slate-200 space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                  Super Admin Manual Payment Verification
                </span>
                <h3 className="text-lg font-black text-slate-900 mt-0.5">
                  {reviewingPayment.companyName} — {reviewingPayment.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  Submitted by {reviewingPayment.submittedByEmail} on {reviewingPayment.paymentDate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewingPayment(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            {reviewError && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                {reviewError}
              </div>
            )}

            {/* Payment Details Summary Box */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-400 font-bold uppercase text-[10px]">
                    Payment Method
                  </span>
                  <div className="font-black text-slate-900 uppercase">
                    {reviewingPayment.method.replace('_', ' ')}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 font-bold uppercase text-[10px]">
                    Transaction / Ref ID
                  </span>
                  <div className="font-mono font-bold text-indigo-700">
                    {reviewingPayment.transactionReference}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 font-bold uppercase text-[10px]">
                    Submitted Amount (BDT)
                  </span>
                  <div className="font-mono font-black text-slate-900 text-sm">
                    {formatBDT(reviewingPayment.requestedAmount)}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 font-bold uppercase text-[10px]">
                    Invoice Balance Due
                  </span>
                  <div className="font-mono font-bold text-rose-600 text-sm">
                    {reviewTargetInvoice
                      ? `${formatBDT(reviewTargetInvoice.dueAmount)} (of ${formatBDT(
                          reviewTargetInvoice.totalAmount
                        )})`
                      : formatBDT(reviewingPayment.requestedAmount)}
                  </div>
                </div>
              </div>

              {reviewingPayment.senderNumber && (
                <div>
                  <strong>Sender Number:</strong>{' '}
                  <span className="font-mono">{reviewingPayment.senderNumber}</span>
                </div>
              )}
              {reviewingPayment.bankName && (
                <div>
                  <strong>Bank / Account:</strong> {reviewingPayment.bankName} ·{' '}
                  <strong>Depositor:</strong> {reviewingPayment.depositorName}
                </div>
              )}
              {reviewingPayment.receiverInfo && (
                <div>
                  <strong>Cash Receiver:</strong> {reviewingPayment.receiverInfo} ·{' '}
                  <strong>Receipt #:</strong> {reviewingPayment.receiptNumber}
                </div>
              )}
              {reviewingPayment.customerNotes && (
                <div>
                  <strong>Customer Notes:</strong> {reviewingPayment.customerNotes}
                </div>
              )}
              {reviewingPayment.proofDataUrl && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setPreviewProofUrl(reviewingPayment.proofDataUrl || null)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs cursor-pointer"
                  >
                    Inspect Attached Screenshot / Proof
                  </button>
                </div>
              )}
            </div>

            <form onSubmit={handleConfirmReview} className="space-y-4">
              {/* Decision Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Verification Decision *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setReviewDecision('approved')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      reviewDecision === 'approved'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Approve &amp; Renew
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewDecision('partially_approved')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      reviewDecision === 'partially_approved'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Partially Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewDecision('rejected')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      reviewDecision === 'rejected'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Reject
                  </button>
                </div>
              </div>

              {(reviewDecision === 'approved' || reviewDecision === 'partially_approved') && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Verified Approved Amount (BDT ৳) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={reviewApprovedAmount}
                    onChange={(e) => setReviewApprovedAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-bold text-slate-900"
                  />
                </div>
              )}

              {/* Full Approval Renewal Preview */}
              {reviewDecision === 'approved' && previewRenewalDates && (
                <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
                  <div className="font-bold">
                    Automatic Idempotent Subscription Renewal ({reviewingPayment.billingCycle}):
                  </div>
                  <div>
                    Current Expiry:{' '}
                    <span className="font-mono font-semibold">
                      {reviewTargetCompany?.subscription?.expiryDate || 'N/A'}
                    </span>{' '}
                    → New Expiry:{' '}
                    <span className="font-mono font-black text-emerald-700">
                      {previewRenewalDates.periodEnd}
                    </span>{' '}
                    (+{previewRenewalDates.monthsCount}{' '}
                    {previewRenewalDates.monthsCount === 1 ? 'Month' : 'Months'})
                  </div>
                </div>
              )}

              {/* Partial Approval Options (No Automatic Full Renewal + Optional Temporary Extension) */}
              {reviewDecision === 'partially_approved' && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-3">
                  <div className="font-bold">
                    Partial Payment Policy: Does NOT automatically renew the full subscription
                    period.
                  </div>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={grantTempExtension}
                      onChange={(e) => setGrantTempExtension(e.target.checked)}
                      className="rounded text-amber-600 w-4 h-4"
                    />
                    <span className="font-semibold">
                      Optionally grant a Temporary Subscription Extension
                    </span>
                  </label>

                  {grantTempExtension && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-1">
                          Extension Days
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={tempExtensionDays}
                          onChange={(e) => setTempExtensionDays(Number(e.target.value) || 7)}
                          className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-1">
                          New Temporary Expiry
                        </label>
                        <div className="px-3 py-1.5 bg-white border border-amber-200 rounded-lg font-mono font-bold text-amber-900">
                          {previewTempExtensionDate}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Rejection Reason */}
              {reviewDecision === 'rejected' && (
                <div>
                  <label className="block text-xs font-bold text-rose-700 uppercase tracking-wider mb-1">
                    Rejection Reason (Shown to Customer) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Invalid TrxID, amount mismatch, or unclear deposit slip"
                    value={reviewRejectionReason}
                    onChange={(e) => setReviewRejectionReason(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-rose-50/40 border border-rose-200 rounded-xl text-xs font-semibold text-slate-900"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Admin Verification Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Internal or customer-visible verification remarks..."
                  value={reviewAdminNotes}
                  onChange={(e) => setReviewAdminNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReviewingPayment(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessingReview}
                  className={`px-5 py-2.5 rounded-xl text-white font-bold text-xs shadow-md cursor-pointer disabled:opacity-50 ${
                    reviewDecision === 'approved'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : reviewDecision === 'partially_approved'
                      ? 'bg-amber-600 hover:bg-amber-500'
                      : 'bg-rose-600 hover:bg-rose-500'
                  }`}
                >
                  {isProcessingReview
                    ? 'Processing...'
                    : reviewDecision === 'approved'
                    ? 'Confirm Approval & Renew'
                    : reviewDecision === 'partially_approved'
                    ? 'Confirm Partial Approval'
                    : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CREATE MANUAL SUBSCRIPTION INVOICE (BDT)                     */}
      {/* =================================================================== */}
      {showCreateInvoiceModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Issue Subscription Invoice (BDT)
                </h3>
                <p className="text-xs text-slate-500">
                  Create an official BDT billing invoice for a customer tenant
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateInvoiceModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            {createInvError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                {createInvError}
              </div>
            )}

            <form onSubmit={handleCreateManualInvoice} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Customer Company *
                </label>
                <select
                  required
                  value={newInvCompanyId}
                  onChange={(e) => setNewInvCompanyId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                >
                  <option value="">Select Company...</option>
                  {customerCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.ownerEmail})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Plan
                  </label>
                  <select
                    value={newInvPlan}
                    onChange={(e) => setNewInvPlan(e.target.value as SubscriptionPlan)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  >
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Billing Period
                  </label>
                  <select
                    value={newInvCycle}
                    onChange={(e) => setNewInvCycle(e.target.value as BillingCycle)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  >
                    <option value="monthly">Monthly (1 Month)</option>
                    <option value="yearly">Yearly (12 Months)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Invoice Amount (BDT ৳) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={newInvAmountBDT}
                    onChange={(e) => setNewInvAmountBDT(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Due Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={newInvDueDate}
                    onChange={(e) => setNewInvDueDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Invoice Notes
                </label>
                <input
                  type="text"
                  placeholder="Optional billing remarks..."
                  value={newInvNotes}
                  onChange={(e) => setNewInvNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateInvoiceModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingInvoice}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md cursor-pointer"
                >
                  {creatingInvoice ? 'Creating...' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INVOICE VIEW MODAL */}
      {viewingInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                  Subscription Invoice Record
                </span>
                <h3 className="text-xl font-black text-slate-900 font-mono mt-0.5">
                  {viewingInvoice.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {viewingInvoice.companyName} ({viewingInvoice.ownerEmail})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingInvoice(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div>
                <div className="text-slate-400 font-bold uppercase text-[10px]">Plan &amp; Cycle</div>
                <div className="font-bold text-slate-900 uppercase mt-0.5">
                  {viewingInvoice.plan} ({viewingInvoice.billingCycle})
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-bold uppercase text-[10px]">Total (BDT)</div>
                <div className="font-mono font-bold text-slate-900 mt-0.5">
                  {formatBDT(viewingInvoice.totalAmount)}
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-bold uppercase text-[10px]">Paid (BDT)</div>
                <div className="font-mono font-bold text-emerald-700 mt-0.5">
                  {formatBDT(viewingInvoice.paidAmount)}
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-bold uppercase text-[10px]">Balance Due</div>
                <div className="font-mono font-bold text-rose-600 mt-0.5">
                  {formatBDT(viewingInvoice.dueAmount)}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setViewingInvoice(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() =>
                  printSubscriptionInvoice(
                    viewingInvoice,
                    payments.filter((p) => p.invoiceId === viewingInvoice.id),
                    instructions
                  )
                }
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center space-x-2 cursor-pointer"
              >
                <IconDownload size={15} />
                <span>Download / Print Invoice</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROOF IMAGE PREVIEW MODAL */}
      {previewProofUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewProofUrl(null)}
        >
          <div
            className="bg-white rounded-3xl p-4 max-w-lg w-full shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="text-sm font-bold text-slate-900">Customer Payment Proof</h4>
              <button
                type="button"
                onClick={() => setPreviewProofUrl(null)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
            <img
              src={previewProofUrl}
              alt="Customer Payment Proof"
              className="w-full max-h-[70vh] object-contain rounded-xl bg-slate-950"
            />
          </div>
        </div>
      )}
    </div>
  );
}
