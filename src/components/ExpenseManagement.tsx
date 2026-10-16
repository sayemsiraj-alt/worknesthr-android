import React, { useState, useMemo, useRef } from 'react';
import {
  useData,
  ExpenseClaim,
  ExpenseCategory,
  Employee,
} from '../context/DataContext';

interface ExpenseManagementProps {
  mode?: 'admin' | 'manager' | 'employee';
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Travel & Transport',
  'Client Entertainment & Meals',
  'Office Supplies & Equipment',
  'Training & Certification',
  'Medical & Wellness',
  'Internet & Utility',
  'Accommodation & Per Diem',
  'Other',
];

export function ExpenseManagement({ mode = 'admin' }: ExpenseManagementProps) {
  const {
    employees,
    allEmployees,
    departments,
    currentUser,
    currentEmployee,
    isAuthenticated,
    isEmployeeAuthenticated,
    authorizedTeamEmployees,
    canManageEmployee,
    getEmployeeBranch,
    expenseClaims,
    submitExpenseClaim,
    decideExpenseClaim,
    reimburseExpenseClaim,
  } = useData();

  const isEmployeeMode = mode === 'employee' || (isEmployeeAuthenticated && !isAuthenticated && mode !== 'manager');
  const isManagerMode = mode === 'manager';
  const canReimburse = Boolean(
    isAuthenticated &&
    (currentUser?.role === 'Super Admin' || currentUser?.role === 'Payroll Admin' || currentUser?.role === 'HR Manager' || currentUser?.permissions?.payroll || currentUser?.permissions?.expenses)
  );

  // Scoped employees for RBAC
  const scopedEmployees: Employee[] = useMemo(() => {
    if (isEmployeeMode && currentEmployee) return [currentEmployee];
    if (isManagerMode) return authorizedTeamEmployees;
    if (currentUser && ((currentUser as any).assignedDepartment || currentUser.role === 'Department Supervisor')) {
      return authorizedTeamEmployees;
    }
    return employees.length > 0 ? employees : allEmployees;
  }, [isEmployeeMode, isManagerMode, currentEmployee, authorizedTeamEmployees, currentUser, employees, allEmployees]);

  const scopedEmpIds = useMemo(() => {
    const s = new Set<string>();
    scopedEmployees.forEach(e => {
      if (e.id) s.add(e.id);
      if (e.employeeId) s.add(e.employeeId);
    });
    return s;
  }, [scopedEmployees]);

  // Active sub-tab
  const [activeTab, setActiveTab] = useState<'claims' | 'reports'>('claims');

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'reimbursed' | 'rejected'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Feedback banner
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showBanner = (type: 'success' | 'error', text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 4000);
  };

  // New Claim Modal
  const [showClaimModal, setShowClaimModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [claimForm, setClaimForm] = useState({
    employeeId: '',
    title: '',
    category: 'Travel & Transport' as ExpenseCategory,
    amount: 0,
    expenseDate: new Date().toISOString().split('T')[0],
    merchant: '',
    paymentMode: 'Cash' as NonNullable<ExpenseClaim['paymentMode']>,
    description: '',
    receiptName: '',
    receiptType: '',
    receiptSize: 0,
    receiptDataUrl: '',
  });

  // Decision Modal
  const [decisionTarget, setDecisionTarget] = useState<{ claim: ExpenseClaim; decision: 'approved' | 'rejected' } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');

  // Reimbursement Modal
  const [reimburseTarget, setReimburseTarget] = useState<ExpenseClaim | null>(null);
  const [reimburseMethod, setReimburseMethod] = useState<NonNullable<ExpenseClaim['reimbursementMethod']>>('Bank Transfer');
  const [reimburseRef, setReimburseRef] = useState('');
  const [reimburseMonth, setReimburseMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // Receipt Preview Modal
  const [previewClaim, setPreviewClaim] = useState<ExpenseClaim | null>(null);

  // Filtered claims
  const visibleClaims = useMemo(() => {
    return expenseClaims.filter(c => {
      if (!scopedEmpIds.has(c.employeeId)) return false;
      if (statusFilter === 'pending' && c.status !== 'pending') return false;
      if (statusFilter === 'approved' && c.reimbursementStatus !== 'awaiting_reimbursement') return false;
      if (statusFilter === 'reimbursed' && c.reimbursementStatus !== 'reimbursed' && c.reimbursementStatus !== 'settled_in_payroll') return false;
      if (statusFilter === 'rejected' && c.status !== 'rejected') return false;
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (deptFilter !== 'all' && c.department !== deptFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          c.title.toLowerCase().includes(q) ||
          c.employeeName.toLowerCase().includes(q) ||
          (c.merchant || '').toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [expenseClaims, scopedEmpIds, statusFilter, categoryFilter, deptFilter, searchQuery]);

  // Analytics & Report Summary
  const reportStats = useMemo(() => {
    const allScoped = expenseClaims.filter(c => scopedEmpIds.has(c.employeeId));
    const totalClaimed = allScoped.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const pendingAmount = allScoped.filter(c => c.status === 'pending').reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const awaitingReimbAmount = allScoped
      .filter(c => c.reimbursementStatus === 'awaiting_reimbursement')
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const reimbursedAmount = allScoped
      .filter(c => c.reimbursementStatus === 'reimbursed' || c.reimbursementStatus === 'settled_in_payroll')
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);

    const byCategory: Record<string, { count: number; total: number }> = {};
    const byDept: Record<string, { count: number; total: number }> = {};

    allScoped.forEach(c => {
      if (c.status === 'rejected') return;
      if (!byCategory[c.category]) byCategory[c.category] = { count: 0, total: 0 };
      byCategory[c.category].count += 1;
      byCategory[c.category].total += Number(c.amount) || 0;

      const dept = c.department || 'General';
      if (!byDept[dept]) byDept[dept] = { count: 0, total: 0 };
      byDept[dept].count += 1;
      byDept[dept].total += Number(c.amount) || 0;
    });

    return {
      totalCount: allScoped.length,
      pendingCount: allScoped.filter(c => c.status === 'pending').length,
      totalClaimed,
      pendingAmount,
      awaitingReimbAmount,
      reimbursedAmount,
      byCategory,
      byDept,
    };
  }, [expenseClaims, scopedEmpIds]);

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showBanner('error', 'Receipt file must be under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setClaimForm(prev => ({
        ...prev,
        receiptName: file.name,
        receiptType: file.type || 'application/octet-stream',
        receiptSize: file.size,
        receiptDataUrl: String(reader.result || ''),
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    const empObj = isEmployeeMode
      ? currentEmployee
      : scopedEmployees.find(emp => emp.id === claimForm.employeeId || emp.employeeId === claimForm.employeeId) || currentEmployee;

    if (!empObj) {
      showBanner('error', 'Please select an employee.');
      return;
    }
    if (!claimForm.title.trim() || claimForm.amount <= 0) {
      showBanner('error', 'Please enter a valid expense title and amount greater than ৳0.');
      return;
    }

    const res = await submitExpenseClaim({
      employeeId: empObj.id,
      employeeName: empObj.name,
      department: empObj.department || 'General',
      branch: getEmployeeBranch(empObj),
      title: claimForm.title.trim(),
      category: claimForm.category,
      amount: Number(claimForm.amount),
      expenseDate: claimForm.expenseDate,
      merchant: claimForm.merchant.trim(),
      paymentMode: claimForm.paymentMode,
      description: claimForm.description.trim(),
      ...(claimForm.receiptName
        ? {
            receiptName: claimForm.receiptName,
            receiptType: claimForm.receiptType,
            receiptSize: claimForm.receiptSize,
            receiptDataUrl: claimForm.receiptDataUrl,
          }
        : {}),
    });

    if (res.success) {
      setShowClaimModal(false);
      showBanner('success', `Expense claim "${claimForm.title}" (৳${Number(claimForm.amount).toLocaleString()}) submitted for approval.`);
    } else {
      showBanner('error', res.error || 'Could not submit expense claim.');
    }
  };

  const handleConfirmDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionTarget) return;
    const res = await decideExpenseClaim(
      decisionTarget.claim.id,
      decisionTarget.decision,
      decisionReason
    );
    if (res.success) {
      setDecisionTarget(null);
      setDecisionReason('');
      showBanner('success', `Expense claim ${decisionTarget.decision}.`);
    } else {
      showBanner('error', res.error || 'Unauthorized to decide this claim.');
    }
  };

  const handleConfirmReimburse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reimburseTarget) return;
    const res = await reimburseExpenseClaim(
      reimburseTarget.id,
      reimburseMethod,
      reimburseRef,
      reimburseMethod === 'Added to Monthly Payroll' ? reimburseMonth : undefined
    );
    if (res.success) {
      // If added to monthly payroll, also credit the employee's monthly payroll otherAllowance
      if (reimburseMethod === 'Added to Monthly Payroll' && reimburseMonth) {
        try {
          const saved = localStorage.getItem('worknest_payroll_monthly_records');
          const map = saved ? JSON.parse(saved) : {};
          const key = `${reimburseMonth}_${reimburseTarget.employeeId}`;
          const existing = map[key] || {};
          const prevOther = Number(existing.otherAllowance) || 0;
          map[key] = {
            ...existing,
            employeeId: reimburseTarget.employeeId,
            month: reimburseMonth,
            customEarningName: existing.customEarningName
              ? `${existing.customEarningName} + Expense Reimb.`
              : `Approved Expense Reimbursement (${reimburseTarget.category})`,
            otherAllowance: prevOther + Number(reimburseTarget.amount),
          };
          localStorage.setItem('worknest_payroll_monthly_records', JSON.stringify(map));
          window.dispatchEvent(new Event('worknest_payroll_updated'));
        } catch {}
      }
      setReimburseTarget(null);
      setReimburseRef('');
      showBanner('success', `Reimbursed ৳${reimburseTarget.amount.toLocaleString()} to ${reimburseTarget.employeeName}.`);
    } else {
      showBanner('error', res.error || 'Could not process reimbursement.');
    }
  };

  const handleExportExpensesCsv = () => {
    const headers = [
      'Claim ID',
      'Date',
      'Employee Name',
      'Department',
      'Category',
      'Title',
      'Merchant',
      'Amount (BDT)',
      'Approval Status',
      'Reimbursement Status',
      'Approved By',
      'Payment Ref',
    ];
    const rows = visibleClaims.map(c => [
      c.id,
      c.expenseDate,
      `"${c.employeeName}"`,
      `"${c.department}"`,
      `"${c.category}"`,
      `"${c.title}"`,
      `"${c.merchant || '-'}"`,
      c.amount,
      c.status,
      c.reimbursementStatus,
      `"${c.approverName || '-'}"`,
      `"${c.paymentReference || '-'}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Expense_Claims_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-5">
      {banner && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>Corporate Expense &amp; Reimbursement Ledger</span>
            <span aria-hidden="true">·</span>
            <span>{isEmployeeMode ? 'My Expense Claims' : isManagerMode ? 'Team Expense Approvals' : 'Company Expense Governance'}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">Expense Claims &amp; Reimbursements</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Submit itemized expense claims with receipts, route through manager/HR approval, and track reimbursement or payroll settlement
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportExpensesCsv}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
          >
            Export CSV
          </button>
          <button
            onClick={() => {
              setClaimForm({
                employeeId: (isEmployeeMode ? currentEmployee?.id : scopedEmployees[0]?.id) || '',
                title: '',
                category: 'Travel & Transport',
                amount: 0,
                expenseDate: new Date().toISOString().split('T')[0],
                merchant: '',
                paymentMode: 'Cash',
                description: '',
                receiptName: '',
                receiptType: '',
                receiptSize: 0,
                receiptDataUrl: '',
              });
              setShowClaimModal(true);
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-2xs cursor-pointer"
          >
            + Submit Expense Claim
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Claimed</p>
          <p className="text-2xl font-extrabold text-slate-900 font-mono mt-1">
            ৳ {reportStats.totalClaimed.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{reportStats.totalCount} total claims</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Pending Approval</p>
          <p className="text-2xl font-extrabold text-amber-600 font-mono mt-1">
            ৳ {reportStats.pendingAmount.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{reportStats.pendingCount} awaiting review</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Approved (Unpaid)</p>
          <p className="text-2xl font-extrabold text-indigo-600 font-mono mt-1">
            ৳ {reportStats.awaitingReimbAmount.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Ready for reimbursement</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Reimbursed &amp; Settled</p>
          <p className="text-2xl font-extrabold text-emerald-600 font-mono mt-1">
            ৳ {reportStats.reimbursedAmount.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Disbursed or added to payroll</p>
        </div>
      </div>

      {/* Sub-Tabs & Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              onClick={() => setActiveTab('claims')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'claims' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
              }`}
            >
              Expense Claims ({visibleClaims.length})
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'reports' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
              }`}
            >
              Category &amp; Spend Reports
            </button>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {(['all', 'pending', 'approved', 'reimbursed', 'rejected'] as const).map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize cursor-pointer ${
                  statusFilter === st ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search title, merchant, employee..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
          />
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
          >
            <option value="all">All Categories</option>
            {EXPENSE_CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {!isEmployeeMode && (
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
            >
              <option value="all">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* TAB 1: CLAIMS LIST */}
      {activeTab === 'claims' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date &amp; Employee</th>
                  <th className="px-4 py-3 font-semibold">Expense Details</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Receipt</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Approval &amp; Reimbursement</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleClaims.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      No expense claims match your current filter.
                    </td>
                  </tr>
                ) : (
                  visibleClaims.map(claim => {
                    const canApproveThis = claim.status === 'pending' && canManageEmployee(claim.employeeId);
                    const canReimburseThis =
                      claim.status === 'approved' &&
                      claim.reimbursementStatus === 'awaiting_reimbursement' &&
                      canReimburse;

                    return (
                      <tr key={claim.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900">{claim.employeeName}</div>
                          <div className="text-[11px] text-slate-500">
                            {claim.expenseDate} · {claim.department}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900">{claim.title}</div>
                          <div className="text-[11px] text-slate-500">
                            {claim.merchant ? `${claim.merchant} · ` : ''}{claim.description}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700 font-medium">{claim.category}</td>
                        <td className="px-4 py-3">
                          {claim.receiptDataUrl ? (
                            <button
                              onClick={() => setPreviewClaim(claim)}
                              className="text-indigo-600 hover:underline font-semibold cursor-pointer"
                            >
                              📎 View Receipt
                            </button>
                          ) : (
                            <span className="text-slate-400">No Receipt</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono font-extrabold text-slate-900 text-sm">
                          ৳ {Number(claim.amount).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold capitalize text-slate-800">
                            {claim.status === 'approved'
                              ? '✓ Approved'
                              : claim.status === 'rejected'
                              ? '✕ Rejected'
                              : '⏳ Pending Approval'}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {claim.reimbursementStatus === 'reimbursed'
                              ? `Paid via ${claim.reimbursementMethod} (${claim.paymentReference})`
                              : claim.reimbursementStatus === 'settled_in_payroll'
                              ? `Settled in Payroll (${claim.reimbursementMonth})`
                              : claim.reimbursementStatus === 'awaiting_reimbursement'
                              ? `Approved by ${claim.approverName || 'Manager'} · Awaiting Payout`
                              : claim.decisionReason || 'Awaiting manager/HR review'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {canApproveThis && (
                              <>
                                <button
                                  onClick={() => {
                                    setDecisionTarget({ claim, decision: 'approved' });
                                    setDecisionReason('Verified receipt and approved for reimbursement.');
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => {
                                    setDecisionTarget({ claim, decision: 'rejected' });
                                    setDecisionReason('');
                                  }}
                                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-bold cursor-pointer"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {canReimburseThis && (
                              <button
                                onClick={() => {
                                  setReimburseTarget(claim);
                                  setReimburseRef(`EXP-${claim.id.slice(-5).toUpperCase()}`);
                                }}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold cursor-pointer"
                              >
                                Reimburse / Settle
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: CATEGORY & DEPARTMENT SPEND REPORTS */}
      {activeTab === 'reports' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Spend Breakdown by Expense Category</h3>
            <div className="divide-y divide-slate-100 text-xs">
              {Object.entries(reportStats.byCategory).length === 0 ? (
                <p className="text-slate-400 py-4">No active expense data available.</p>
              ) : (
                Object.entries(reportStats.byCategory).map(([cat, info]) => (
                  <div key={cat} className="py-2.5 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-800">{cat}</span>
                      <span className="text-slate-400 ml-2">({info.count} claims)</span>
                    </div>
                    <span className="font-mono font-bold text-slate-900">৳ {info.total.toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Spend Breakdown by Department</h3>
            <div className="divide-y divide-slate-100 text-xs">
              {Object.entries(reportStats.byDept).length === 0 ? (
                <p className="text-slate-400 py-4">No department expense data available.</p>
              ) : (
                Object.entries(reportStats.byDept).map(([dept, info]) => (
                  <div key={dept} className="py-2.5 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-800">{dept}</span>
                      <span className="text-slate-400 ml-2">({info.count} claims)</span>
                    </div>
                    <span className="font-mono font-bold text-indigo-700">৳ {info.total.toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SUBMIT EXPENSE CLAIM */}
      {showClaimModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmitClaim} className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base">Submit Employee Expense Claim</h3>
              <button type="button" onClick={() => setShowClaimModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              {!isEmployeeMode && (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Employee</label>
                  <select
                    required
                    value={claimForm.employeeId}
                    onChange={e => setClaimForm({ ...claimForm, employeeId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                  >
                    <option value="">-- Select Employee --</option>
                    {scopedEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeId} · {emp.department})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Expense Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Client Site Visit Conveyance & Fuel"
                  value={claimForm.title}
                  onChange={e => setClaimForm({ ...claimForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Category</label>
                  <select
                    value={claimForm.category}
                    onChange={e => setClaimForm({ ...claimForm, category: e.target.value as ExpenseCategory })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                  >
                    {EXPENSE_CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Amount (BDT ৳)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={claimForm.amount || ''}
                    onChange={e => setClaimForm({ ...claimForm, amount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Expense Date</label>
                  <input
                    type="date"
                    required
                    value={claimForm.expenseDate}
                    onChange={e => setClaimForm({ ...claimForm, expenseDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Merchant / Vendor</label>
                  <input
                    type="text"
                    placeholder="e.g. Uber / Pathao / Hotel"
                    value={claimForm.merchant}
                    onChange={e => setClaimForm({ ...claimForm, merchant: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Description &amp; Business Purpose</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Provide details of the business expense..."
                  value={claimForm.description}
                  onChange={e => setClaimForm({ ...claimForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Upload Receipt / Invoice (Image or PDF)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleReceiptUpload}
                  className="w-full text-xs file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-semibold"
                />
                {claimForm.receiptName && (
                  <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                    ✓ Attached: {claimForm.receiptName} ({Math.round(claimForm.receiptSize / 1024)} KB)
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button type="button" onClick={() => setShowClaimModal(false)} className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">
                Submit Claim
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: APPROVE / REJECT DECISION */}
      {decisionTarget && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleConfirmDecision} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              {decisionTarget.decision === 'approved' ? 'Approve Expense Claim' : 'Reject Expense Claim'}
            </h3>
            <p className="text-xs text-slate-600">
              {decisionTarget.claim.employeeName} — <strong>{decisionTarget.claim.title}</strong> (৳{decisionTarget.claim.amount.toLocaleString()})
            </p>
            <div className="text-xs">
              <label className="font-semibold text-slate-700 block mb-1">Decision Remarks / Reason</label>
              <textarea
                required
                rows={3}
                value={decisionReason}
                onChange={e => setDecisionReason(e.target.value)}
                placeholder="Write approval or rejection reason..."
                className="w-full px-3 py-2 border border-slate-200 rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDecisionTarget(null)} className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold">
                Cancel
              </button>
              <button
                type="submit"
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold ${
                  decisionTarget.decision === 'approved' ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
              >
                Confirm {decisionTarget.decision === 'approved' ? 'Approval' : 'Rejection'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: REIMBURSE / SETTLE IN PAYROLL */}
      {reimburseTarget && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleConfirmReimburse} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Reimburse Approved Expense Claim</h3>
            <p className="text-xs text-slate-600">
              Reimbursing <strong>৳{reimburseTarget.amount.toLocaleString()}</strong> to <strong>{reimburseTarget.employeeName}</strong>
            </p>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Reimbursement Method</label>
                <select
                  value={reimburseMethod}
                  onChange={e => setReimburseMethod(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cash">Cash Payout</option>
                  <option value="bKash/Mobile Banking">bKash / Mobile Banking</option>
                  <option value="Added to Monthly Payroll">Add to Monthly Payroll Allowance</option>
                </select>
              </div>
              {reimburseMethod === 'Added to Monthly Payroll' && (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Target Payroll Month</label>
                  <input
                    type="month"
                    value={reimburseMonth}
                    onChange={e => setReimburseMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
              )}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Payment / Voucher Reference</label>
                <input
                  type="text"
                  required
                  value={reimburseRef}
                  onChange={e => setReimburseRef(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReimburseTarget(null)} className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">
                Confirm Reimbursement
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: RECEIPT PREVIEW */}
      {previewClaim && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 shadow-2xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">{previewClaim.receiptName || 'Expense Receipt'}</h4>
                <p className="text-xs text-slate-500">{previewClaim.title} · ৳{previewClaim.amount.toLocaleString()}</p>
              </div>
              <button onClick={() => setPreviewClaim(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            {previewClaim.receiptDataUrl && (
              <div className="max-h-[65vh] overflow-auto bg-slate-50 p-3 rounded-xl flex justify-center">
                {previewClaim.receiptType?.includes('pdf') ? (
                  <iframe src={previewClaim.receiptDataUrl} className="w-full h-96 border-0" title="Receipt PDF" />
                ) : (
                  <img src={previewClaim.receiptDataUrl} alt="Receipt" className="max-h-96 object-contain rounded-lg" />
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              {previewClaim.receiptDataUrl && (
                <a
                  href={previewClaim.receiptDataUrl}
                  download={previewClaim.receiptName || 'receipt'}
                  className="px-3.5 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold"
                >
                  Download Receipt
                </a>
              )}
              <button onClick={() => setPreviewClaim(null)} className="px-3.5 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
