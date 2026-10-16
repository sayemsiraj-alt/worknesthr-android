import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useTenant } from '../context/TenantContext';
import { useData } from '../context/DataContext';
import { getFirebaseInstance } from '../lib/firestoreService';
import {
  BillingCycle,
  DEFAULT_OWNER_COMPANY,
  ManualPaymentInstructions,
  ManualPaymentMethod,
  SubscriptionInvoice,
  SubscriptionPayment,
  SubscriptionPlan,
} from '../types/tenant';
import {
  DEFAULT_PAYMENT_INSTRUCTIONS,
  formatBDT,
  getConfiguredPlanPriceBDT,
  mergeManualPaymentInstructions,
  printSubscriptionInvoice,
  submitManualPaymentRequest,
} from '../lib/billingService';
import {
  IconCalendar,
  IconCheckCircle,
  IconClock,
  IconDownload,
  IconFileText,
  IconInfo,
  IconPlus,
  IconPrinter,
  IconUpload,
  IconWallet,
  IconXCircle,
} from './Icons';

interface CustomerBillingSectionProps {
  compactMode?: boolean;
}

export function CustomerBillingSection({ compactMode = false }: CustomerBillingSectionProps) {
  const { currentCompanyId, currentCompany, subscription, isSubscriptionActive } = useTenant();
  const { currentUser } = useData();

  const effectiveCompany = currentCompany || DEFAULT_OWNER_COMPANY;
  const effectiveSub = subscription || DEFAULT_OWNER_COMPANY.subscription;
  const tenantId = currentCompanyId || effectiveCompany.id || 'default';

  const [instructions, setInstructions] = useState<ManualPaymentInstructions>(
    DEFAULT_PAYMENT_INSTRUCTIONS
  );
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Payment Form State
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('new');
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>(
    effectiveSub.plan || 'professional'
  );
  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>(
    effectiveSub.billingCycle || 'monthly'
  );
  const [method, setMethod] = useState<ManualPaymentMethod>('bkash');
  const [amountBDT, setAmountBDT] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );

  // Method-specific fields
  const [senderNumber, setSenderNumber] = useState('');
  const [transactionReference, setTransactionReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountInfo, setAccountInfo] = useState('');
  const [depositorName, setDepositorName] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [receiverInfo, setReceiverInfo] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [proofDataUrl, setProofDataUrl] = useState<string>('');
  const [proofFileName, setProofFileName] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<SubscriptionInvoice | null>(null);
  const [viewingProofUrl, setViewingProofUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Listen to Super Admin's dynamic payment instructions
  useEffect(() => {
    const { db } = getFirebaseInstance();
    const unsub = onSnapshot(
      doc(db, 'settings', 'billing_instructions'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<ManualPaymentInstructions>;
          setInstructions(mergeManualPaymentInstructions(data));
        }
      },
      (err) => {
        console.warn('Billing instructions listener warning:', err);
      }
    );
    return () => unsub();
  }, []);

  // 2. Listen to ONLY this tenant's invoices and payments (Strict Tenant Isolation)
  useEffect(() => {
    if (!tenantId) return;
    setLoadingData(true);
    const { db } = getFirebaseInstance();

    const invQuery = query(
      collection(db, 'subscription_invoices'),
      where('companyId', '==', tenantId)
    );
    const payQuery = query(
      collection(db, 'subscription_payments'),
      where('companyId', '==', tenantId)
    );

    const unsubInv = onSnapshot(
      invQuery,
      (snap) => {
        const list: SubscriptionInvoice[] = [];
        snap.forEach((d) => list.push({ ...(d.data() as SubscriptionInvoice), id: d.id }));
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setInvoices(list);
        setLoadingData(false);
      },
      (err) => {
        console.warn('Tenant invoices listener warning:', err);
        setLoadingData(false);
      }
    );

    const unsubPay = onSnapshot(
      payQuery,
      (snap) => {
        const list: SubscriptionPayment[] = [];
        snap.forEach((d) => list.push({ ...(d.data() as SubscriptionPayment), id: d.id }));
        list.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
        setPayments(list);
      },
      (err) => {
        console.warn('Tenant payments listener warning:', err);
      }
    );

    return () => {
      unsubInv();
      unsubPay();
    };
  }, [tenantId]);

  // Open/unpaid invoices for this customer
  const openInvoices = useMemo(
    () => invoices.filter((inv) => inv.status === 'unpaid' || inv.status === 'partially_paid'),
    [invoices]
  );

  // Calculate expected BDT price based on selected plan & billing cycle, or selected open invoice
  const expectedAmountBDT = useMemo(() => {
    if (selectedInvoiceId !== 'new') {
      const found = invoices.find((i) => i.id === selectedInvoiceId);
      if (found) return found.dueAmount;
    }
    return getConfiguredPlanPriceBDT(selectedPlan, selectedCycle, instructions);
  }, [selectedInvoiceId, invoices, instructions, selectedPlan, selectedCycle]);

  // Keep amountBDT synced when plan/cycle/invoice selection changes
  useEffect(() => {
    setAmountBDT(String(expectedAmountBDT));
  }, [expectedAmountBDT]);

  // Days remaining calculation
  const daysRemaining = useMemo(() => {
    if (!effectiveSub.expiryDate) return null;
    const diff = new Date(effectiveSub.expiryDate).getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 3600 * 24));
  }, [effectiveSub.expiryDate]);

  // Total outstanding balance across unpaid/partially paid invoices
  const totalDueBalanceBDT = useMemo(
    () => openInvoices.reduce((sum, inv) => sum + (Number(inv.dueAmount) || 0), 0),
    [openInvoices]
  );

  const pendingPaymentsCount = useMemo(
    () => payments.filter((p) => p.status === 'pending').length,
    [payments]
  );

  // Proof image compression handler
  const handleProofUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setFormError('Please upload an image file (JPG, PNG, WebP) for payment proof.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError('Proof image must be smaller than 5MB.');
      return;
    }

    setFormError(null);
    setProofFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawUrl = event.target?.result as string;
      if (!rawUrl) return;

      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 900;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const compressed = canvas.toDataURL('image/jpeg', 0.78);
            setProofDataUrl(compressed);
          } else {
            setProofDataUrl(rawUrl);
          }
        } catch {
          setProofDataUrl(rawUrl);
        }
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const existingInv =
      selectedInvoiceId !== 'new'
        ? invoices.find((inv) => inv.id === selectedInvoiceId) || null
        : null;

    setSubmitting(true);
    const res = await submitManualPaymentRequest({
      company: effectiveCompany,
      existingInvoice: existingInv,
      plan: existingInv ? existingInv.plan : selectedPlan,
      billingCycle: existingInv ? existingInv.billingCycle : selectedCycle,
      expectedPlanAmountBDT: expectedAmountBDT,
      method,
      requestedAmountBDT: Number(amountBDT),
      paymentDate,
      transactionReference:
        method === 'cash' ? receiptNumber || transactionReference : transactionReference,
      senderNumber,
      bankName,
      accountInfo,
      depositorName,
      receiptNumber,
      receiverInfo,
      proofDataUrl,
      customerNotes,
      submittedByEmail: currentUser?.email || effectiveCompany.ownerEmail,
      submittedByName: currentUser?.name || effectiveCompany.ownerName || effectiveCompany.name,
    });
    setSubmitting(false);

    if (!res.success) {
      setFormError(res.error || 'Failed to submit manual payment request.');
      return;
    }

    setFormSuccess(
      `Manual payment request (${formatBDT(Number(amountBDT))}) submitted under Invoice ${res.invoice?.invoiceNumber}! Status is now Pending Super Admin verification.`
    );
    setTransactionReference('');
    setReceiptNumber('');
    setCustomerNotes('');
    setProofDataUrl('');
    setProofFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const renderPaymentStatusBadge = (status: SubscriptionPayment['status']) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span>Approved</span>
          </span>
        );
      case 'partially_approved':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <span>Partially Approved</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <span>Rejected</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <span>Pending Verification</span>
          </span>
        );
    }
  };

  const renderInvoiceStatusBadge = (status: SubscriptionInvoice['status']) => {
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
            Unpaid / Due
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 text-slate-800">
      {/* 1. CURRENT SUBSCRIPTION & BILLING SUMMARY */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center space-x-2">
              <IconWallet size={19} className="text-indigo-600" />
              <h2 className="text-lg font-bold text-slate-900">
                Subscription Plan &amp; Manual Billing (BDT ৳)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Workspace: <strong className="text-slate-700">{effectiveCompany.name}</strong> ·{' '}
              <span className="font-mono">{effectiveCompany.ownerEmail}</span> · Currency:{' '}
              <strong className="text-slate-800">BDT (৳) Only</strong>
            </p>
          </div>

          <div className="flex items-center space-x-2">
            {isSubscriptionActive ? (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <IconCheckCircle size={15} />
                <span>Subscription Active</span>
              </span>
            ) : effectiveSub.status === 'suspended' ? (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                <IconXCircle size={15} />
                <span>Suspended</span>
              </span>
            ) : (
              <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                <IconClock size={15} />
                <span>Expired — Renewal Required</span>
              </span>
            )}
          </div>
        </div>

        {/* Summary Metric Boxes */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Current Plan Tier
            </span>
            <p className="text-xl font-black text-slate-900 capitalize mt-1">
              {effectiveSub.plan || 'Professional'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Up to {effectiveSub.maxEmployees || 100} employees ·{' '}
              <span className="capitalize">{effectiveSub.billingCycle || 'Monthly'}</span>
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Subscription Expiry Date
            </span>
            <p className="text-xl font-black text-slate-900 font-mono mt-1">
              {tenantId === 'default' ? 'Lifetime' : effectiveSub.expiryDate || 'N/A'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {tenantId === 'default'
                ? 'Master Workspace'
                : daysRemaining !== null
                ? daysRemaining > 0
                  ? `${daysRemaining} days remaining`
                  : `Expired ${Math.abs(daysRemaining)} days ago`
                : 'Start date: ' + (effectiveSub.startDate || 'N/A')}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Outstanding Balance (BDT)
            </span>
            <p
              className={`text-xl font-black font-mono mt-1 ${
                totalDueBalanceBDT > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              {formatBDT(totalDueBalanceBDT)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {openInvoices.length === 0
                ? 'All issued invoices settled'
                : `${openInvoices.length} open invoice(s) due`}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Pending Verification
            </span>
            <p className="text-xl font-black text-indigo-600 font-mono mt-1">
              {pendingPaymentsCount}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {pendingPaymentsCount > 0
                ? 'Awaiting Super Admin approval'
                : 'No pending payment submissions'}
            </p>
          </div>
        </div>

        {effectiveSub.temporaryExtensionUntil && (
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
            <div>
              <strong>Temporary Extension Active:</strong> Your workspace has been granted a
              temporary extension until{' '}
              <span className="font-mono font-bold">{effectiveSub.temporaryExtensionUntil}</span>{' '}
              following a partial payment. Please settle the remaining invoice balance in BDT to
              complete full subscription renewal.
            </div>
          </div>
        )}
      </div>

      {/* 2. SUBMIT MANUAL PAYMENT REQUEST FORM + SUPER ADMIN INSTRUCTIONS */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
        <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Submit Manual Subscription Payment (BDT Only)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Follow the payment instructions below for bKash, Nagad, Bank Transfer, or Cash, then
              submit your transaction details for Super Admin approval.
            </p>
          </div>
          <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-200 self-start sm:self-center">
            Currency: BDT (৳)
          </span>
        </div>

        {formError && (
          <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
            {formError}
          </div>
        )}

        {formSuccess && (
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800">
            {formSuccess}
          </div>
        )}

        <form onSubmit={handleSubmitPayment} className="space-y-5">
          {/* Step 1: Invoice or Renewal Period Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Target Invoice / Billing Type
              </label>
              <select
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="new">Create New Renewal Invoice</option>
                {openInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — Due: {formatBDT(inv.dueAmount)} ({inv.plan.toUpperCase()}{' '}
                    {inv.billingCycle})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Subscription Plan
              </label>
              <select
                value={
                  selectedInvoiceId !== 'new'
                    ? invoices.find((i) => i.id === selectedInvoiceId)?.plan || selectedPlan
                    : selectedPlan
                }
                disabled={selectedInvoiceId !== 'new'}
                onChange={(e) => setSelectedPlan(e.target.value as SubscriptionPlan)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
              >
                <option value="starter">
                  Starter — {formatBDT(instructions.planPricingBDT.starter.monthly)}/mo ·{' '}
                  {formatBDT(instructions.planPricingBDT.starter.yearly)}/yr
                </option>
                <option value="professional">
                  Professional — {formatBDT(instructions.planPricingBDT.professional.monthly)}/mo ·{' '}
                  {formatBDT(instructions.planPricingBDT.professional.yearly)}/yr
                </option>
                <option value="enterprise">
                  Enterprise — {formatBDT(instructions.planPricingBDT.enterprise.monthly)}/mo ·{' '}
                  {formatBDT(instructions.planPricingBDT.enterprise.yearly)}/yr
                </option>
                <option value="custom">
                  Custom Corporate — {formatBDT(instructions.planPricingBDT.custom.monthly)}/mo ·{' '}
                  {formatBDT(instructions.planPricingBDT.custom.yearly)}/yr
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Billing Period
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['monthly', 'yearly'] as BillingCycle[]).map((cyc) => {
                  const activeCycle =
                    selectedInvoiceId !== 'new'
                      ? invoices.find((i) => i.id === selectedInvoiceId)?.billingCycle ||
                        selectedCycle
                      : selectedCycle;
                  const isSelected = activeCycle === cyc;
                  return (
                    <button
                      key={cyc}
                      type="button"
                      disabled={selectedInvoiceId !== 'new'}
                      onClick={() => setSelectedCycle(cyc)}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold capitalize border transition-all cursor-pointer disabled:opacity-60 ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {cyc === 'monthly' ? 'Monthly (1 Mo)' : 'Yearly (12 Mo)'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Step 2: Select Manual Payment Method */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Select Manual Payment Method *
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { id: 'bkash' as ManualPaymentMethod, label: 'bKash', sub: 'Mobile Money (BDT)' },
                { id: 'nagad' as ManualPaymentMethod, label: 'Nagad', sub: 'Mobile Money (BDT)' },
                {
                  id: 'bank_transfer' as ManualPaymentMethod,
                  label: 'Bank Transfer',
                  sub: 'BEFTN / NPSB / Deposit',
                },
                { id: 'cash' as ManualPaymentMethod, label: 'Cash', sub: 'Direct Office Receipt' },
              ].map((m) => {
                const isSelected = method === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50/80 border-indigo-600 ring-2 ring-indigo-500/20'
                        : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-black text-slate-900">{m.label}</span>
                      {isSelected && (
                        <span className="text-xs font-bold text-indigo-600">Selected</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">{m.sub}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 3: Dynamic Super Admin Payment Instructions Box */}
          <div className="p-4 rounded-2xl bg-slate-900 text-slate-100 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                {method === 'bkash' && 'bKash Payment Instructions'}
                {method === 'nagad' && 'Nagad Payment Instructions'}
                {method === 'bank_transfer' && 'Bank Transfer Account Details'}
                {method === 'cash' && 'Cash Payment Instructions'}
              </span>
              <span className="text-xs font-mono font-bold text-emerald-400">
                Payable: {formatBDT(expectedAmountBDT)}
              </span>
            </div>

            {method === 'bkash' && (
              <div className="text-xs space-y-1 text-slate-300">
                <p>
                  <strong>bKash {instructions.bkash.accountType} Number:</strong>{' '}
                  <span className="font-mono text-sm font-bold text-white">
                    {instructions.bkash.number}
                  </span>{' '}
                  {instructions.bkash.accountName ? `(${instructions.bkash.accountName})` : ''}
                </p>
                <p className="leading-relaxed text-slate-300">{instructions.bkash.instructions}</p>
              </div>
            )}

            {method === 'nagad' && (
              <div className="text-xs space-y-1 text-slate-300">
                <p>
                  <strong>Nagad {instructions.nagad.accountType} Number:</strong>{' '}
                  <span className="font-mono text-sm font-bold text-white">
                    {instructions.nagad.number}
                  </span>{' '}
                  {instructions.nagad.accountName ? `(${instructions.nagad.accountName})` : ''}
                </p>
                <p className="leading-relaxed text-slate-300">{instructions.nagad.instructions}</p>
              </div>
            )}

            {method === 'bank_transfer' && (
              <div className="text-xs space-y-1 text-slate-300">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 pb-1">
                  <div>
                    <strong>Bank Name:</strong> {instructions.bankTransfer.bankName}
                  </div>
                  <div>
                    <strong>Branch:</strong> {instructions.bankTransfer.branchName}
                  </div>
                  <div>
                    <strong>Account Title:</strong> {instructions.bankTransfer.accountName}
                  </div>
                  <div>
                    <strong>Account Number:</strong>{' '}
                    <span className="font-mono font-bold text-white">
                      {instructions.bankTransfer.accountNumber}
                    </span>
                  </div>
                  {instructions.bankTransfer.routingNumber && (
                    <div>
                      <strong>Routing Number:</strong>{' '}
                      <span className="font-mono">{instructions.bankTransfer.routingNumber}</span>
                    </div>
                  )}
                </div>
                <p className="leading-relaxed text-slate-300">
                  {instructions.bankTransfer.instructions}
                </p>
              </div>
            )}

            {method === 'cash' && (
              <div className="text-xs space-y-1 text-slate-300">
                <p>
                  <strong>Office Location:</strong> {instructions.cash.officeAddress}
                </p>
                <p>
                  <strong>Authorized Receiver(s):</strong> {instructions.cash.authorizedReceivers}
                </p>
                <p className="leading-relaxed text-slate-300">{instructions.cash.instructions}</p>
              </div>
            )}
          </div>

          {/* Step 4: Method-Specific Input Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(method === 'bkash' || method === 'nagad') && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {method === 'bkash' ? 'bKash' : 'Nagad'} Sender Number *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="01XXXXXXXXX"
                    value={senderNumber}
                    onChange={(e) => setSenderNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Transaction ID (TrxID) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BKA98234XYZ"
                    value={transactionReference}
                    onChange={(e) => setTransactionReference(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-900 uppercase focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </>
            )}

            {method === 'bank_transfer' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Sender Bank &amp; Account Info *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BRAC Bank - A/C #1501..."
                    value={bankName}
                    onChange={(e) => {
                      setBankName(e.target.value);
                      setAccountInfo(e.target.value);
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Depositor Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Tanvir Ahmed / Apex Ltd."
                    value={depositorName}
                    onChange={(e) => setDepositorName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Reference / Transaction Number *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="BEFTN / Slip / UTR Reference"
                    value={transactionReference}
                    onChange={(e) => setTransactionReference(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-900 uppercase focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </>
            )}

            {method === 'cash' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Receipt / Reference Number *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MR-2026-0045"
                    value={receiptNumber}
                    onChange={(e) => {
                      setReceiptNumber(e.target.value);
                      setTransactionReference(e.target.value);
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-900 uppercase focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Receiver Name / Information *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Name of official who received cash"
                    value={receiverInfo}
                    onChange={(e) => setReceiverInfo(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Amount Paid (BDT ৳) *
              </label>
              <input
                type="number"
                min={1}
                required
                value={amountBDT}
                onChange={(e) => setAmountBDT(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Payment Date *
              </label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Screenshot / Payment Proof (Optional)
              </label>
              <label className="w-full px-3.5 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 flex items-center justify-between cursor-pointer">
                <span className="truncate">
                  {proofFileName ? `Attached: ${proofFileName}` : 'Upload Screenshot / Slip'}
                </span>
                <IconUpload size={15} className="text-indigo-600 shrink-0 ml-2" />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleProofUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Additional Billing Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="Any remarks for the billing verification team..."
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] text-slate-500">
              Full payments automatically renew your workspace subscription upon Super Admin
              approval.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/20 transition-all cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Submitting Payment...' : 'Submit Manual Payment Request'}
            </button>
          </div>
        </form>
      </div>

      {/* 3. CUSTOMER INVOICES TABLE */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">My Subscription Invoices</h3>
            <p className="text-xs text-slate-500">
              Historical and current BDT subscription invoices for {effectiveCompany.name}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Plan &amp; Cycle</th>
                <th className="py-3 px-4">Billing Period</th>
                <th className="py-3 px-4 text-right">Amount (BDT)</th>
                <th className="py-3 px-4 text-right">Paid (BDT)</th>
                <th className="py-3 px-4 text-right">Due Balance</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingData ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    Loading invoices...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No subscription invoices generated yet. Submit a manual payment above to
                    generate your first invoice.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      {inv.invoiceNumber}
                      <div className="text-[10px] font-normal text-slate-400">
                        Issued: {inv.issueDate}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-bold uppercase text-slate-800">{inv.plan}</span>
                      <span className="text-slate-400"> · </span>
                      <span className="capitalize text-slate-600">{inv.billingCycle}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {inv.periodStart} → {inv.periodEnd}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900">
                      {formatBDT(inv.totalAmount)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">
                      {formatBDT(inv.paidAmount)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-600">
                      {formatBDT(inv.dueAmount)}
                    </td>
                    <td className="py-3 px-4">{renderInvoiceStatusBadge(inv.status)}</td>
                    <td className="py-3 px-4 text-right">
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
                          title="Download Invoice"
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

      {/* 4. CUSTOMER PAYMENT & RENEWAL HISTORY TABLE */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">My Payment &amp; Renewal History</h3>
          <p className="text-xs text-slate-500">
            Track verification status, transaction references, and subscription renewal dates
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Transaction / Ref ID</th>
                <th className="py-3 px-4 text-right">Submitted (BDT)</th>
                <th className="py-3 px-4 text-right">Approved (BDT)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Renewal / Admin Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No manual payment submissions yet.
                  </td>
                </tr>
              ) : (
                payments.map((pay) => (
                  <tr key={pay.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-mono text-slate-700">{pay.paymentDate}</td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                      {pay.invoiceNumber}
                    </td>
                    <td className="py-3 px-4 uppercase font-bold text-slate-700">
                      {pay.method.replace('_', ' ')}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-900">
                      <div>{pay.transactionReference}</div>
                      {pay.senderNumber && (
                        <div className="text-[10px] text-slate-400">Sender: {pay.senderNumber}</div>
                      )}
                      {pay.depositorName && (
                        <div className="text-[10px] text-slate-400">
                          Depositor: {pay.depositorName}
                        </div>
                      )}
                      {pay.receiverInfo && (
                        <div className="text-[10px] text-slate-400">
                          Receiver: {pay.receiverInfo}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900">
                      {formatBDT(pay.requestedAmount)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                      {formatBDT(pay.approvedAmount)}
                    </td>
                    <td className="py-3 px-4">{renderPaymentStatusBadge(pay.status)}</td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs">
                      {pay.status === 'approved' && pay.newExpiryDate && (
                        <div className="text-emerald-700 font-semibold">
                          Renewed until {pay.newExpiryDate}
                        </div>
                      )}
                      {pay.status === 'partially_approved' && (
                        <div className="text-amber-800 font-semibold">
                          {pay.temporaryExtensionUntil
                            ? `Temp extension until ${pay.temporaryExtensionUntil}`
                            : 'Partial payment credited (No auto-renewal)'}
                        </div>
                      )}
                      {pay.status === 'rejected' && pay.rejectionReason && (
                        <div className="text-rose-600 font-semibold">
                          Reason: {pay.rejectionReason}
                        </div>
                      )}
                      {pay.adminNotes && (
                        <div className="text-[11px] text-slate-500">{pay.adminNotes}</div>
                      )}
                      {pay.proofDataUrl && (
                        <button
                          type="button"
                          onClick={() => setViewingProofUrl(pay.proofDataUrl || null)}
                          className="text-[11px] text-indigo-600 hover:underline font-semibold mt-0.5 cursor-pointer"
                        >
                          View Attached Proof
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* INVOICE DETAILS MODAL */}
      {viewingInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                  WorkNest HR Subscription Invoice
                </span>
                <h3 className="text-xl font-black text-slate-900 font-mono mt-0.5">
                  {viewingInvoice.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  Issued: {viewingInvoice.issueDate} · Due: {viewingInvoice.dueDate}
                </p>
              </div>
              <div className="flex items-center space-x-2">
                {renderInvoiceStatusBadge(viewingInvoice.status)}
                <button
                  type="button"
                  onClick={() => setViewingInvoice(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
              <div>
                <div className="font-bold text-slate-400 uppercase text-[10px]">Billed To</div>
                <div className="font-bold text-slate-900 text-sm mt-0.5">
                  {viewingInvoice.companyName}
                </div>
                <div className="font-mono text-slate-600">{viewingInvoice.ownerEmail}</div>
                <div className="font-mono text-[11px] text-slate-400">
                  Tenant ID: {viewingInvoice.companyId}
                </div>
              </div>
              <div>
                <div className="font-bold text-slate-400 uppercase text-[10px]">
                  Subscription Period
                </div>
                <div className="font-bold text-slate-900 text-sm uppercase mt-0.5">
                  {viewingInvoice.plan} Plan ({viewingInvoice.billingCycle})
                </div>
                <div className="font-mono text-slate-600">
                  {viewingInvoice.periodStart} → {viewingInvoice.periodEnd}
                </div>
                <div className="text-slate-500">Currency: BDT (৳) Only</div>
              </div>
            </div>

            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase">
                    <th className="py-2.5 px-4">Description</th>
                    <th className="py-2.5 px-4 text-right">Total (BDT)</th>
                    <th className="py-2.5 px-4 text-right">Paid (BDT)</th>
                    <th className="py-2.5 px-4 text-right">Balance Due (BDT)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      WorkNest HR {viewingInvoice.plan.toUpperCase()} Subscription (
                      {viewingInvoice.monthsCount}{' '}
                      {viewingInvoice.monthsCount === 1 ? 'Month' : 'Months'})
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold">
                      {formatBDT(viewingInvoice.totalAmount)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                      {formatBDT(viewingInvoice.paidAmount)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-600">
                      {formatBDT(viewingInvoice.dueAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>
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
      {viewingProofUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setViewingProofUrl(null)}
        >
          <div
            className="bg-white rounded-3xl p-4 max-w-lg w-full shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="text-sm font-bold text-slate-900">Payment Proof Attachment</h4>
              <button
                type="button"
                onClick={() => setViewingProofUrl(null)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
            <img
              src={viewingProofUrl}
              alt="Payment Proof"
              className="w-full max-h-[70vh] object-contain rounded-xl bg-slate-950"
            />
          </div>
        </div>
      )}
    </div>
  );
}
