import React, { useState, useMemo } from 'react';
import { useTenant } from '../context/TenantContext';
import { Company, SubscriptionPlan, SubscriptionStatus } from '../types/tenant';
import {
  IconBuilding,
  IconUsers,
  IconCheckCircle,
  IconXCircle,
  IconSearch,
  IconPlus,
  IconCalendar,
  IconSettings,
  IconLock,
  IconRefresh,
  IconWallet,
} from './Icons';
import { getFirebaseInstance } from '../lib/firestoreService';
import { doc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { provisionAdminAuthAccount, ROLE_PERMISSION_PRESETS } from '../lib/authService';
import { SuperAdminBillingManager } from './SuperAdminBillingManager';

export function SuperAdminTenants() {
  const {
    allCompanies,
    loadingCompanies,
    createCompany,
    updateCompanySubscription,
    updateCompanyStatus,
    switchCompany,
    currentCompanyId,
    resetToOwnerCompany,
  } = useTenant();

  const [consoleTab, setConsoleTab] = useState<'workspaces' | 'billing'>('workspaces');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SubscriptionStatus>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCompanyForSub, setSelectedCompanyForSub] = useState<Company | null>(null);
  const [selectedCompanyForPass, setSelectedCompanyForPass] = useState<Company | null>(null);

  // New Company Form state
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [newOwnerPassword, setNewOwnerPassword] = useState('WorkNest@2026');
  const [newPlan, setNewPlan] = useState<SubscriptionPlan>('professional');
  const [newStartDate, setNewStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [newExpiryDate, setNewExpiryDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split('T')[0];
  });
  const [newMaxEmployees, setNewMaxEmployees] = useState(100);
  const [newNotes, setNewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Subscription Edit state
  const [editStatus, setEditStatus] = useState<SubscriptionStatus>('active');
  const [editPlan, setEditPlan] = useState<SubscriptionPlan>('professional');
  const [editExpiryDate, setEditExpiryDate] = useState('');
  const [editMaxEmployees, setEditMaxEmployees] = useState<number>(100);
  const [editNotes, setEditNotes] = useState('');
  const [isUpdatingSub, setIsUpdatingSub] = useState(false);

  // Password reset state
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [isResettingPass, setIsResettingPass] = useState(false);
  const [passMessage, setPassMessage] = useState('');

  // Deduplicated companies list ensuring unique workspace records
  const uniqueCompanies = useMemo(() => {
    const map = new Map<string, Company>();
    for (const comp of allCompanies) {
      if (comp && comp.id && !map.has(comp.id)) {
        map.set(comp.id, comp);
      }
    }
    return Array.from(map.values());
  }, [allCompanies]);

  // Filtering companies with strictly unique IDs
  const filteredCompanies = useMemo(() => {
    return uniqueCompanies.filter(comp => {
      const matchesSearch =
        comp.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        comp.ownerEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        comp.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && comp.subscription?.status === 'active') ||
        (statusFilter === 'suspended' && comp.subscription?.status === 'suspended') ||
        (statusFilter === 'expired' && comp.subscription?.status === 'expired');
      return Boolean(matchesSearch && matchesStatus);
    });
  }, [uniqueCompanies, searchTerm, statusFilter]);

  // Stats calculation based on unique companies
  const totalTenants = uniqueCompanies.length;
  const activeTenants = uniqueCompanies.filter(c => c.subscription?.status === 'active' && (!c.subscription?.expiryDate || c.subscription.expiryDate >= new Date().toISOString().split('T')[0])).length;
  const suspendedTenants = uniqueCompanies.filter(c => c.subscription?.status === 'suspended').length;
  const expiredTenants = uniqueCompanies.filter(c => c.subscription?.status === 'expired' || (c.subscription?.expiryDate && c.subscription.expiryDate < new Date().toISOString().split('T')[0])).length;

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!newCompanyName.trim()) {
      setFormError('Please enter a Company Name');
      return;
    }
    if (!newOwnerEmail.trim()) {
      setFormError('Please enter the Customer Owner Email');
      return;
    }

    setIsSubmitting(true);
    const res = await createCompany({
      companyName: newCompanyName,
      ownerName: newOwnerName || newCompanyName,
      ownerEmail: newOwnerEmail,
      ownerPassword: newOwnerPassword,
      plan: newPlan,
      startDate: newStartDate,
      expiryDate: newExpiryDate,
      status: 'active',
      maxEmployees: newMaxEmployees,
      notes: newNotes,
    });
    setIsSubmitting(false);

    if (res.success) {
      setFormSuccess(`Company "${newCompanyName}" and customer account created successfully!`);
      setTimeout(() => {
        setShowCreateModal(false);
        setNewCompanyName('');
        setNewOwnerName('');
        setNewOwnerEmail('');
        setNewNotes('');
        setFormSuccess('');
      }, 1200);
    } else {
      setFormError(res.error || 'Failed to create company');
    }
  };

  const handleOpenEditSub = (comp: Company) => {
    setSelectedCompanyForSub(comp);
    setEditStatus(comp.subscription?.status || 'active');
    setEditPlan(comp.subscription?.plan || 'professional');
    setEditExpiryDate(comp.subscription?.expiryDate || new Date().toISOString().split('T')[0]);
    setEditMaxEmployees(comp.subscription?.maxEmployees || 100);
    setEditNotes(comp.subscription?.notes || '');
  };

  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyForSub) return;

    setIsUpdatingSub(true);
    const res = await updateCompanySubscription(selectedCompanyForSub.id, {
      status: editStatus,
      plan: editPlan,
      expiryDate: editExpiryDate,
      maxEmployees: Number(editMaxEmployees) || 50,
      notes: editNotes,
    });
    setIsUpdatingSub(false);

    if (res.success) {
      setSelectedCompanyForSub(null);
    } else {
      alert(res.error || 'Failed to update subscription');
    }
  };

  const handleQuickExtend = (months: number) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const baseStr = editExpiryDate && editExpiryDate >= todayStr ? editExpiryDate : todayStr;
    const cur = new Date(baseStr);
    cur.setMonth(cur.getMonth() + months);
    setEditExpiryDate(cur.toISOString().split('T')[0]);
    setEditStatus('active');
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyForPass || !newPasswordValue.trim()) return;

    setIsResettingPass(true);
    try {
      const { db } = getFirebaseInstance();
      const cleanEmail = selectedCompanyForPass.ownerEmail.toLowerCase();
      const adminId = `admin_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
      const newPass = newPasswordValue.trim();

      await updateDoc(doc(db, 'admins', adminId), {
        password: newPass,
        updatedAt: new Date().toISOString(),
      });

      const q = query(collection(db, 'admins'), where('email', '==', cleanEmail));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        if (d.id !== adminId) {
          await updateDoc(doc(db, 'admins', d.id), {
            password: newPass,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      await provisionAdminAuthAccount({
        id: adminId,
        name: selectedCompanyForPass.ownerName || selectedCompanyForPass.name,
        email: cleanEmail,
        password: newPass,
        role: 'Super Admin',
        companyId: selectedCompanyForPass.id,
        companyName: selectedCompanyForPass.name,
        isTenantOwner: true,
        isSuperAdmin: false,
        isPrimarySuperAdmin: false,
        status: 'active',
        permissions: ROLE_PERMISSION_PRESETS['Super Admin'],
        createdAt: new Date().toISOString()
      }, newPass);

      setPassMessage('Password updated successfully!');
      setTimeout(() => {
        setSelectedCompanyForPass(null);
        setNewPasswordValue('');
        setPassMessage('');
      }, 1000);
    } catch (err: any) {
      setPassMessage('Failed to reset password: ' + err.message);
    } finally {
      setIsResettingPass(false);
    }
  };

  const getDaysRemaining = (expiryDate?: string) => {
    if (!expiryDate) return null;
    const diff = new Date(expiryDate).getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 3600 * 24));
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 rounded-3xl border border-indigo-500/20 shadow-xl text-white">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-300 font-extrabold text-[11px] tracking-wider uppercase border border-indigo-400/30">
              Super Admin SaaS Console
            </span>
            <span className="text-slate-400 text-xs">Platform Multi-Tenancy</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white mt-1 font-display">
            Tenant &amp; Subscription Management
          </h1>
          <p className="text-xs text-slate-300 mt-0.5">
            Create customer workspaces, activate accounts, control subscription lifecycle, and isolate company data.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {currentCompanyId !== 'default' && (
            <button
              onClick={resetToOwnerCompany}
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition-all shadow-md flex items-center space-x-2 cursor-pointer"
            >
              <span>Return to Master Workspace</span>
            </button>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-all shadow-lg shadow-indigo-600/30 flex items-center space-x-2 cursor-pointer"
          >
            <IconPlus size={16} />
            <span>Create Customer Workspace</span>
          </button>
        </div>
      </div>

      {/* Console Primary Section Switcher */}
      <div className="bg-white rounded-2xl p-2 border border-slate-200/80 shadow-xs flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setConsoleTab('workspaces')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-2 ${
            consoleTab === 'workspaces'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <IconBuilding size={15} />
          <span>Customer Workspaces ({totalTenants})</span>
        </button>

        <button
          type="button"
          onClick={() => setConsoleTab('billing')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-2 ${
            consoleTab === 'billing'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <IconWallet size={15} />
          <span>Billing, Manual Payments &amp; Invoices (BDT ৳)</span>
        </button>
      </div>

      {consoleTab === 'billing' ? (
        <SuperAdminBillingManager />
      ) : (
        <>
      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Workspaces</span>
            <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <IconBuilding size={18} />
            </span>
          </div>
          <p className="text-3xl font-black text-slate-900 mt-2">{totalTenants}</p>
          <p className="text-[11px] text-slate-500 mt-1">Including owner master workspace</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Subscriptions</span>
            <span className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <IconCheckCircle size={18} />
            </span>
          </div>
          <p className="text-3xl font-black text-emerald-600 mt-2">{activeTenants}</p>
          <p className="text-[11px] text-emerald-700 font-medium mt-1">Full access permitted</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Suspended</span>
            <span className="p-2 rounded-xl bg-rose-50 text-rose-600">
              <IconXCircle size={18} />
            </span>
          </div>
          <p className="text-3xl font-black text-rose-600 mt-2">{suspendedTenants}</p>
          <p className="text-[11px] text-slate-500 mt-1">Access blocked by admin</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Expired</span>
            <span className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <IconCalendar size={18} />
            </span>
          </div>
          <p className="text-3xl font-black text-amber-600 mt-2">{expiredTenants}</p>
          <p className="text-[11px] text-slate-500 mt-1">Renewal required</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <IconSearch size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search company or owner email..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          {(['all', 'active', 'suspended', 'expired'] as const).map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Companies Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-5">Workspace / Company</th>
                <th className="py-3.5 px-5">Customer Account</th>
                <th className="py-3.5 px-4">Plan</th>
                <th className="py-3.5 px-4">Subscription Status</th>
                <th className="py-3.5 px-4">Expiry Date</th>
                <th className="py-3.5 px-4">Remaining</th>
                <th className="py-3.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No customer companies found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredCompanies.map(comp => {
                  const isCurrent = currentCompanyId === comp.id;
                  const isOwner = comp.id === 'default';
                  const daysLeft = getDaysRemaining(comp.subscription?.expiryDate);
                  const isExpired = daysLeft !== null && daysLeft <= 0;
                  const isSuspended = comp.subscription?.status === 'suspended';

                  let statusBadge = (
                    <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      <span>Active</span>
                    </span>
                  );

                  if (isSuspended) {
                    statusBadge = (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-rose-50 text-rose-700 border border-rose-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                        <span>Suspended</span>
                      </span>
                    );
                  } else if (isExpired || comp.subscription?.status === 'expired') {
                    statusBadge = (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        <span>Expired</span>
                      </span>
                    );
                  }

                  return (
                    <tr
                      key={comp.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        isCurrent ? 'bg-indigo-50/40 font-semibold' : ''
                      }`}
                    >
                      <td className="py-3.5 px-5">
                        <div className="flex items-center space-x-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-xs ${
                            isOwner ? 'bg-gradient-to-br from-indigo-500 to-violet-600' : 'bg-gradient-to-br from-slate-700 to-slate-900'
                          }`}>
                            {comp.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-slate-900 text-sm">{comp.name}</span>
                              {isOwner && (
                                <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-extrabold text-[9px] uppercase tracking-wider">
                                  OWNER MASTER
                                </span>
                              )}
                              {isCurrent && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold text-[9px] uppercase">
                                  CURRENT
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">{comp.id}</span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-5">
                        <p className="font-mono text-slate-800 font-medium">{comp.ownerEmail || 'sayemsiraj@gmail.com'}</p>
                        {comp.ownerName && <p className="text-[11px] text-slate-500">{comp.ownerName}</p>}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="uppercase text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          {comp.subscription?.plan || 'Professional'}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">{statusBadge}</td>

                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        {isOwner ? 'Lifetime' : comp.subscription?.expiryDate || 'N/A'}
                      </td>

                      <td className="py-3.5 px-4">
                        {isOwner ? (
                          <span className="text-slate-400 text-xs font-medium">Permanent</span>
                        ) : daysLeft !== null ? (
                          daysLeft > 0 ? (
                            <span className={`font-bold ${daysLeft < 15 ? 'text-amber-600' : 'text-slate-700'}`}>
                              {daysLeft} days
                            </span>
                          ) : (
                            <span className="font-bold text-rose-600">Expired</span>
                          )
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      <td className="py-3.5 px-5 text-right">
                        <div className="inline-flex items-center space-x-1.5">
                          {/* Workspace Switcher */}
                          {!isCurrent ? (
                            <button
                              onClick={() => switchCompany(comp.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] transition-all cursor-pointer"
                              title="Switch into this company's workspace"
                            >
                              Enter Workspace
                            </button>
                          ) : (
                            <span className="px-2.5 py-1.5 text-[11px] font-bold text-emerald-600">Viewing</span>
                          )}

                          {/* Quick Toggle Suspend */}
                          {!isOwner && (
                            <button
                              onClick={() => updateCompanyStatus(comp.id, isSuspended ? 'active' : 'suspended')}
                              className={`p-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                isSuspended
                                  ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                                  : 'bg-rose-50 hover:bg-rose-100 text-rose-700'
                              }`}
                              title={isSuspended ? 'Reactivate customer access' : 'Suspend customer access'}
                            >
                              {isSuspended ? 'Activate' : 'Suspend'}
                            </button>
                          )}

                          {/* Edit Subscription */}
                          {!isOwner && (
                            <button
                              onClick={() => handleOpenEditSub(comp)}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer"
                              title="Edit subscription & expiry"
                            >
                              <IconSettings size={15} />
                            </button>
                          )}

                          {/* Reset Customer Password */}
                          {!isOwner && (
                            <button
                              onClick={() => {
                                setSelectedCompanyForPass(comp);
                                setNewPasswordValue('');
                              }}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer"
                              title="Reset customer account password"
                            >
                              <IconLock size={15} />
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
        </>
      )}

      {/* CREATE NEW COMPANY MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div>
                <h3 className="text-lg font-black text-slate-900 tracking-tight">Create Customer Workspace</h3>
                <p className="text-xs text-slate-500">Provision a separate isolated company &amp; admin account</p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="p-3 mb-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-700">
                {formSuccess}
              </div>
            )}

            <form onSubmit={handleCreateCompany} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Company / Organization Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Apparel Ltd."
                  value={newCompanyName}
                  onChange={e => setNewCompanyName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Owner Contact Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Tanvir Ahmed"
                    value={newOwnerName}
                    onChange={e => setNewOwnerName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Owner Login Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="customer@apex.com"
                    value={newOwnerEmail}
                    onChange={e => setNewOwnerEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Initial Account Password *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. WorkNest@2026"
                  value={newOwnerPassword}
                  onChange={e => setNewOwnerPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Subscription Plan</label>
                  <select
                    value={newPlan}
                    onChange={e => setNewPlan(e.target.value as SubscriptionPlan)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="starter">Starter (Up to 50 staff)</option>
                    <option value="professional">Professional (Up to 200 staff)</option>
                    <option value="enterprise">Enterprise (Unlimited)</option>
                    <option value="custom">Custom Corporate</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Max Staff Capacity</label>
                  <input
                    type="number"
                    value={newMaxEmployees}
                    onChange={e => setNewMaxEmployees(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={newStartDate}
                    onChange={e => setNewStartDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Expiry Date *</label>
                  <input
                    type="date"
                    required
                    value={newExpiryDate}
                    onChange={e => setNewExpiryDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Subscription Notes</label>
                <textarea
                  rows={2}
                  placeholder="Notes, billing references, or custom contract details..."
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all cursor-pointer flex items-center space-x-2"
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create &amp; Provision Workspace</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT SUBSCRIPTION MODAL */}
      {selectedCompanyForSub && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 tracking-tight">Manage Subscription</h3>
                <p className="text-xs text-slate-500">{selectedCompanyForSub.name}</p>
              </div>
              <button
                onClick={() => setSelectedCompanyForSub(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSubscription} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Status</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['active', 'suspended', 'expired'] as const).map(st => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setEditStatus(st)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-bold capitalize transition-all border cursor-pointer ${
                        editStatus === st
                          ? st === 'active'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : st === 'suspended'
                            ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                            : 'bg-amber-600 text-white border-amber-600 shadow-sm'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Subscription Plan</label>
                <select
                  value={editPlan}
                  onChange={e => setEditPlan(e.target.value as SubscriptionPlan)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Expiration Date</label>
                <input
                  type="date"
                  required
                  value={editExpiryDate}
                  onChange={e => setEditExpiryDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                />
                <div className="flex items-center space-x-1.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Quick Extend:</span>
                  <button
                    type="button"
                    onClick={() => handleQuickExtend(1)}
                    className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] cursor-pointer"
                  >
                    +1 Month
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickExtend(3)}
                    className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] cursor-pointer"
                  >
                    +3 Months
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickExtend(12)}
                    className="px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] cursor-pointer"
                  >
                    +1 Year
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Max Staff Count</label>
                <input
                  type="number"
                  value={editMaxEmployees}
                  onChange={e => setEditMaxEmployees(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setSelectedCompanyForSub(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingSub}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md cursor-pointer"
                >
                  {isUpdatingSub ? 'Saving...' : 'Update Subscription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {selectedCompanyForPass && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-sm w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-base font-black text-slate-900">Reset Customer Password</h3>
                <p className="text-xs text-slate-500">{selectedCompanyForPass.ownerEmail}</p>
              </div>
              <button
                onClick={() => setSelectedCompanyForPass(null)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>

            {passMessage && (
              <div className="p-3 mb-3 rounded-xl bg-slate-100 text-xs font-semibold text-slate-800">
                {passMessage}
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">New Password</label>
                <input
                  type="text"
                  required
                  placeholder="Enter new password"
                  value={newPasswordValue}
                  onChange={e => setNewPasswordValue(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setSelectedCompanyForPass(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResettingPass}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md cursor-pointer"
                >
                  {isResettingPass ? 'Updating...' : 'Set New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
