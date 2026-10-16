import React, { useState } from 'react';
import { useTenant } from '../context/TenantContext';
import { useData } from '../context/DataContext';
import { IconFlame, IconLogout, IconWallet } from './Icons';
import { CustomerBillingSection } from './CustomerBillingSection';

export function SubscriptionExpiredScreen() {
  const { currentCompany, subscription, isSuperAdmin, resetToOwnerCompany, updateCompanyStatus } = useTenant();
  const { logout, currentUser } = useData();
  const [rechecking, setRechecking] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [showBillingPanel, setShowBillingPanel] = useState(false);

  const status = subscription?.status || 'expired';
  const isSuspended = status === 'suspended';

  const handleRecheck = () => {
    setRechecking(true);
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

  const handleQuickReactivate = async () => {
    if (!isSuperAdmin || !currentCompany) return;
    setReactivating(true);
    await updateCompanyStatus(currentCompany.id, 'active');
    setReactivating(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden text-slate-100 selection:bg-indigo-500 selection:text-white">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-xl relative z-10 animate-scale-in">
        {/* Super Admin Notice if super admin is viewing this client company */}
        {isSuperAdmin && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-amber-300 uppercase tracking-wider">Super Admin View</p>
              <p className="text-sm text-slate-200">
                You are viewing <strong>{currentCompany?.name}</strong> which is currently {status}.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleQuickReactivate}
                disabled={reactivating}
                className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
              >
                {reactivating ? 'Reactivating...' : 'Reactivate Now'}
              </button>
              <button
                onClick={resetToOwnerCompany}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-semibold transition-all cursor-pointer"
              >
                Return to My Workspace
              </button>
            </div>
          </div>
        )}

        <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl p-8 sm:p-10 shadow-2xl relative">
          {/* WorkNest Logo Header */}
          <div className="flex items-center justify-center space-x-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <IconFlame size={24} className="text-white" />
            </div>
            <div>
              <h1 className="font-extrabold text-2xl tracking-tight text-white font-display">WorkNest HR</h1>
              <p className="text-xs text-indigo-300 font-medium">Enterprise Multi-Tenant SaaS</p>
            </div>
          </div>

          {/* Status Badge & Headline */}
          <div className="text-center mb-6">
            <div className={`inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-4 border ${
              isSuspended
                ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            }`}>
              <span className={`w-2 h-2 rounded-full animate-ping ${isSuspended ? 'bg-rose-400' : 'bg-amber-400'}`}></span>
              <span>{isSuspended ? 'Workspace Suspended' : 'Subscription Expired'}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {isSuspended ? 'Access Temporarily Suspended' : 'Subscription Plan Expired'}
            </h2>
            <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">
              {isSuspended
                ? `The workspace for ${currentCompany?.name || 'your company'} has been temporarily placed on hold by the software administrator.`
                : `The active subscription period for ${currentCompany?.name || 'your company'} has expired on ${subscription?.expiryDate || 'recently'}.`}
            </p>
          </div>

          {/* Company Details Card */}
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 mb-6 space-y-3">
            <div className="flex justify-between items-center text-sm border-b border-white/[0.06] pb-2.5">
              <span className="text-slate-400">Workspace / Company</span>
              <span className="font-bold text-white">{currentCompany?.name || 'Client Company'}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-white/[0.06] pb-2.5">
              <span className="text-slate-400">Customer Account</span>
              <span className="font-mono text-xs font-medium text-slate-300">{currentUser?.email || currentCompany?.ownerEmail}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-white/[0.06] pb-2.5">
              <span className="text-slate-400">Plan Tier</span>
              <span className="uppercase text-xs font-extrabold tracking-wider px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {subscription?.plan || 'Professional'}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Expiration Date</span>
              <span className="font-semibold text-rose-300">{subscription?.expiryDate || 'N/A'}</span>
            </div>
          </div>

          {/* Data Preservation Guarantee Box */}
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 mb-6 flex items-start space-x-3">
            <span className="text-xl">🛡️</span>
            <div>
              <h4 className="text-xs font-bold text-emerald-300 uppercase tracking-wider">Your Data is 100% Safe</h4>
              <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                All employee profiles, rosters, attendance logs, and biometric punch data are completely preserved and safe in the cloud database. Nothing has been deleted. Once your subscription is renewed or reactivated, you will instantly regain full access to all your records.
              </p>
            </div>
          </div>

          {/* Contact Admin to Renew */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-8 text-center">
            <p className="text-xs text-slate-400 font-medium">To renew your subscription or restore workspace access, please contact the software administrator:</p>
            <div className="mt-2.5 inline-flex flex-col items-center">
              <span className="font-bold text-white text-sm">Sayem Siraj</span>
              <span className="text-xs text-indigo-400 font-mono mt-0.5">sayemsiraj@gmail.com</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={() => setShowBillingPanel(!showBillingPanel)}
              className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              <IconWallet size={17} />
              <span>{showBillingPanel ? 'Hide Billing & Payment Form' : 'Renew / Submit Manual Payment (BDT)'}</span>
            </button>
            <button
              onClick={handleRecheck}
              disabled={rechecking}
              className="w-full sm:w-auto py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              {rechecking ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Check Status</span>
              )}
            </button>
            <button
              onClick={logout}
              className="w-full sm:w-auto py-3 px-5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white font-semibold text-sm transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              <IconLogout size={16} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Expandable Customer Manual Billing & Invoice Section */}
      {showBillingPanel && (
        <div className="w-full max-w-5xl mt-6 relative z-10 animate-fade-in">
          <CustomerBillingSection compactMode />
        </div>
      )}
    </div>
  );
}
