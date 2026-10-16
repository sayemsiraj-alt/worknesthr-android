import React, { useState, useMemo } from 'react';
import {
  useData,
  OffboardingRecord,
  OffboardingAssetItem,
  FinalSettlementData,
  Employee,
} from '../context/DataContext';

interface OffboardingManagementProps {
  mode?: 'admin' | 'manager' | 'employee';
}

export function OffboardingManagement({ mode = 'admin' }: OffboardingManagementProps) {
  const {
    employees,
    allEmployees,
    currentUser,
    currentEmployee,
    isAuthenticated,
    isEmployeeAuthenticated,
    authorizedTeamEmployees,
    offboardingRecords,
    initiateOffboarding,
    updateOffboardingClearance,
    addOffboardingAsset,
    updateOffboardingAsset,
    updateOffboardingDocuments,
    submitExitInterview,
    updateFinalSettlement,
    terminateEmployeeAccess,
  } = useData();

  const isEmployeeMode = mode === 'employee' || (isEmployeeAuthenticated && !isAuthenticated && mode !== 'manager');
  const isManagerMode = mode === 'manager';
  const isAdminOrHR = Boolean(isAuthenticated && currentUser);

  const scopedEmployees: Employee[] = useMemo(() => {
    if (isEmployeeMode && currentEmployee) return [currentEmployee];
    if (isManagerMode) return authorizedTeamEmployees;
    if (currentUser && ((currentUser as any).assignedDepartment || currentUser.role === 'Department Supervisor')) {
      return authorizedTeamEmployees;
    }
    return allEmployees.length > 0 ? allEmployees : employees;
  }, [isEmployeeMode, isManagerMode, currentEmployee, authorizedTeamEmployees, currentUser, allEmployees, employees]);

  const scopedEmpIds = useMemo(() => {
    const s = new Set<string>();
    scopedEmployees.forEach(e => {
      if (e.id) s.add(e.id);
      if (e.employeeId) s.add(e.employeeId);
    });
    return s;
  }, [scopedEmployees]);

  const visibleRecords = useMemo(() => {
    return offboardingRecords.filter(r => scopedEmpIds.has(r.employeeId) || scopedEmpIds.has(r.employeeCode));
  }, [offboardingRecords, scopedEmpIds]);

  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const activeRecord: OffboardingRecord | undefined = useMemo(() => {
    if (selectedRecordId) {
      const f = visibleRecords.find(r => r.id === selectedRecordId);
      if (f) return f;
    }
    return visibleRecords[0];
  }, [visibleRecords, selectedRecordId]);

  const [activeSubTab, setActiveSubTab] = useState<'clearance' | 'assets' | 'interview' | 'settlement'>('clearance');

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showBanner = (type: 'success' | 'error', text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 4000);
  };

  // Initiate Offboarding / Resignation Modal
  const [showInitiateModal, setShowInitiateModal] = useState(false);
  const [initForm, setInitForm] = useState({
    employeeId: '',
    exitType: 'resignation' as OffboardingRecord['exitType'],
    reason: '',
    initiatedDate: new Date().toISOString().split('T')[0],
    noticePeriodDaysRequired: 30,
    noticePeriodDaysServed: 30,
    lastWorkingDay: (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().split('T')[0];
    })(),
  });

  // Add Asset Modal
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetForm, setAssetForm] = useState({
    assetName: '',
    assetTag: '',
    category: 'Laptop / PC' as OffboardingAssetItem['category'],
    status: 'pending_return' as OffboardingAssetItem['status'],
    deductionAmount: 0,
  });

  const handleInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmpId = isEmployeeMode ? (currentEmployee?.id || '') : initForm.employeeId;
    if (!targetEmpId || !initForm.reason.trim()) {
      showBanner('error', 'Please select an employee and provide a reason.');
      return;
    }
    const res = await initiateOffboarding({
      ...initForm,
      employeeId: targetEmpId,
      exitType: isEmployeeMode ? 'resignation' : initForm.exitType,
    });
    if (res.success && res.record) {
      setSelectedRecordId(res.record.id);
      setShowInitiateModal(false);
      showBanner('success', `Offboarding & exit workflow initiated for ${res.record.employeeName}.`);
    } else {
      showBanner('error', res.error || 'Could not initiate offboarding.');
    }
  };

  const handleSettlementFieldChange = (field: keyof FinalSettlementData, value: any) => {
    if (!activeRecord) return;
    const fs = { ...activeRecord.finalSettlement, [field]: value };
    const net = Math.max(
      0,
      (Number(fs.unpaidSalaryAmount) || 0) +
        (Number(fs.leaveEncashmentAmount) || 0) +
        (Number(fs.gratuityOrServiceBenefit) || 0) -
        (Number(fs.noticePayRecovery) || 0) -
        (Number(fs.assetDamageDeduction) || 0) -
        (Number(fs.loanOrAdvanceRecovery) || 0)
    );
    fs.netSettlementAmount = net;
    updateFinalSettlement(activeRecord.id, fs);
  };

  const handleSyncToPayroll = async () => {
    if (!activeRecord) return;
    const nextSettlement: FinalSettlementData = {
      ...activeRecord.finalSettlement,
      status: 'synced_to_payroll',
      syncedAt: new Date().toISOString(),
    };
    await updateFinalSettlement(activeRecord.id, nextSettlement);
    showBanner(
      'success',
      `Final settlement (Net ৳${nextSettlement.netSettlementAmount.toLocaleString()}) synced to ${nextSettlement.settlementMonth} Payroll!`
    );
  };

  const handleTerminateAccess = async () => {
    if (!activeRecord) return;
    const res = await terminateEmployeeAccess(activeRecord.id);
    if (res.success) {
      showBanner(
        'success',
        `Portal access terminated for ${activeRecord.employeeName}. All historical attendance, payroll & HR records remain preserved.`
      );
    } else {
      showBanner('error', res.error || 'Failed to terminate access.');
    }
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
            <span>Employee Separation, Clearance &amp; Final Settlement</span>
            <span aria-hidden="true">·</span>
            <span>{isEmployeeMode ? 'Resignation & Exit Status' : 'Offboarding Governance'}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">Offboarding, Asset Recovery &amp; Final Settlement</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage resignation/termination notice periods, departmental clearance, asset return, exit interviews, payroll settlement, and access revocation
          </p>
        </div>
        <div>
          <button
            onClick={() => {
              setInitForm(prev => ({
                ...prev,
                employeeId: (isEmployeeMode ? currentEmployee?.id : scopedEmployees[0]?.id) || '',
              }));
              setShowInitiateModal(true);
            }}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-2xs cursor-pointer"
          >
            {isEmployeeMode ? 'Submit Resignation Request' : '+ Initiate Offboarding / Exit'}
          </button>
        </div>
      </div>

      {visibleRecords.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center space-y-2">
          <p className="text-sm font-bold text-slate-800">No active offboarding or resignation workflows</p>
          <p className="text-xs text-slate-500">
            {isEmployeeMode
              ? 'You have no active resignation or exit clearance requests.'
              : 'Click "+ Initiate Offboarding / Exit" when an employee resigns, retires, or completes their contract.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: Offboarding Records List */}
          <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-2xs">
            <div className="p-3.5 border-b border-slate-100 font-bold text-xs text-slate-800 uppercase tracking-wider">
              Exit Workflows ({visibleRecords.length})
            </div>
            <div className="divide-y divide-slate-100">
              {visibleRecords.map(rec => {
                const isSelected = activeRecord?.id === rec.id;
                const clearedCount = rec.clearances.filter(c => c.cleared).length;
                return (
                  <button
                    key={rec.id}
                    onClick={() => setSelectedRecordId(rec.id)}
                    className={`w-full p-4 text-left transition-colors cursor-pointer ${
                      isSelected ? 'bg-rose-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-sm">{rec.employeeName}</span>
                      <span className="text-xs font-bold capitalize text-rose-700">{rec.exitType.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {rec.employeeCode} · {rec.department} · Last Day: {rec.lastWorkingDay}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                      <span>Clearance: {clearedCount}/{rec.clearances.length}</span>
                      <span>
                        {rec.accessTerminated ? '🔒 Access Terminated' : '🟢 Access Active'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Active Offboarding Detail */}
          {activeRecord && (
            <div className="lg:col-span-2 space-y-4">
              {/* Top Summary Banner */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="uppercase font-bold text-rose-600">{activeRecord.exitType.replace(/_/g, ' ')}</span>
                      <span aria-hidden="true">·</span>
                      <span>Initiated: {activeRecord.initiatedDate}</span>
                      <span aria-hidden="true">·</span>
                      <span>Last Working Day: <strong>{activeRecord.lastWorkingDay}</strong></span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">
                      {activeRecord.employeeName} ({activeRecord.employeeCode} · {activeRecord.department})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Notice Period: {activeRecord.noticePeriodDaysServed}d served of {activeRecord.noticePeriodDaysRequired}d required · Reason: {activeRecord.reason}
                    </p>
                  </div>

                  {isAdminOrHR && (
                    <div>
                      {activeRecord.accessTerminated ? (
                        <span className="text-xs font-bold text-rose-700">
                          🔒 Portal Access Revoked ({activeRecord.accessTerminatedAt?.slice(0, 10)})
                        </span>
                      ) : (
                        <button
                          onClick={handleTerminateAccess}
                          className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                          title="Marks employee inactive and revokes ESS login while preserving all historical data"
                        >
                          Terminate Employee Access
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Sub-tabs */}
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
                  {[
                    { id: 'clearance', label: '1. Clearance & Docs' },
                    { id: 'assets', label: `2. Asset Return (${activeRecord.assets.length})` },
                    { id: 'interview', label: '3. Exit Interview' },
                    { id: 'settlement', label: '4. Final Payroll Settlement' },
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => setActiveSubTab(t.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        activeSubTab === t.id ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* SUB-TAB 1: DEPARTMENTAL CLEARANCE & EXIT DOCUMENTS */}
                {activeSubTab === 'clearance' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold uppercase text-slate-700">Departmental Clearance Checklist</h4>
                      {activeRecord.clearances.map(clr => (
                        <div
                          key={clr.id}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                            clr.cleared ? 'bg-emerald-50/40 border-emerald-200' : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              disabled={isEmployeeMode}
                              checked={clr.cleared}
                              onChange={e => updateOffboardingClearance(activeRecord.id, clr.id, e.target.checked)}
                              className="w-4 h-4 rounded text-emerald-600 cursor-pointer"
                            />
                            <div>
                              <span className="text-[11px] font-bold text-indigo-600 uppercase block">{clr.department}</span>
                              <span className="text-xs font-bold text-slate-900">{clr.title}</span>
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-slate-500">
                            {clr.cleared ? `✓ Cleared by ${clr.clearedBy || 'Admin'}` : 'Pending'}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Exit Documents Completion */}
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                      <h4 className="text-xs font-bold uppercase text-slate-700">Exit Document Completion</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                        {[
                          { key: 'experienceCertificate', label: 'Experience Certificate' },
                          { key: 'releaseLetter', label: 'Service Release Letter' },
                          { key: 'nocIssued', label: 'No Objection Certificate (NOC)' },
                        ].map(docItem => (
                          <label
                            key={docItem.key}
                            className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between cursor-pointer"
                          >
                            <span className="font-semibold text-slate-800">{docItem.label}</span>
                            <input
                              type="checkbox"
                              disabled={isEmployeeMode}
                              checked={(activeRecord.documentsStatus as any)[docItem.key]}
                              onChange={e =>
                                updateOffboardingDocuments(activeRecord.id, {
                                  [docItem.key]: e.target.checked,
                                })
                              }
                              className="w-4 h-4"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* SUB-TAB 2: ASSET RETURN */}
                {activeSubTab === 'assets' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase text-slate-700">Company Assets Assigned to Employee</h4>
                      {!isEmployeeMode && (
                        <button
                          onClick={() => setShowAssetModal(true)}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
                        >
                          + Add Asset Item
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {activeRecord.assets.map(ast => (
                        <div key={ast.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                          <div>
                            <div className="text-[11px] text-slate-500">
                              {ast.category} · Tag: <span className="font-mono font-bold">{ast.assetTag}</span>
                            </div>
                            <div className="font-bold text-slate-900 mt-0.5">{ast.assetName}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              disabled={isEmployeeMode}
                              value={ast.status}
                              onChange={e => updateOffboardingAsset(activeRecord.id, ast.id, e.target.value as any, ast.deductionAmount)}
                              className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-semibold"
                            >
                              <option value="pending_return">Pending Return</option>
                              <option value="returned">✓ Returned in Good Condition</option>
                              <option value="damaged_deduct">⚠️ Damaged / Unreturned (Deduct)</option>
                            </select>
                            {ast.status === 'damaged_deduct' && (
                              <input
                                type="number"
                                disabled={isEmployeeMode}
                                placeholder="Deduction ৳"
                                value={ast.deductionAmount || 0}
                                onChange={e =>
                                  updateOffboardingAsset(activeRecord.id, ast.id, 'damaged_deduct', Number(e.target.value))
                                }
                                className="w-28 px-2 py-1.5 border border-rose-300 rounded-lg font-mono font-bold text-rose-700 bg-white"
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SUB-TAB 3: EXIT INTERVIEW */}
                {activeSubTab === 'interview' && (
                  <form
                    onSubmit={async e => {
                      e.preventDefault();
                      await submitExitInterview(activeRecord.id, {
                        primaryReasonForLeaving: activeRecord.exitInterview.primaryReasonForLeaving,
                        workEnvironmentRating: activeRecord.exitInterview.workEnvironmentRating,
                        managementSupportRating: activeRecord.exitInterview.managementSupportRating,
                        wouldRecommendCompany: activeRecord.exitInterview.wouldRecommendCompany,
                        keyFeedback: activeRecord.exitInterview.keyFeedback,
                      });
                      showBanner('success', 'Exit interview feedback recorded.');
                    }}
                    className="space-y-3 text-xs"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Work Environment Rating (1-5)</label>
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={activeRecord.exitInterview.workEnvironmentRating}
                          onChange={e =>
                            submitExitInterview(activeRecord.id, {
                              ...activeRecord.exitInterview,
                              workEnvironmentRating: Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Management Support Rating (1-5)</label>
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={activeRecord.exitInterview.managementSupportRating}
                          onChange={e =>
                            submitExitInterview(activeRecord.id, {
                              ...activeRecord.exitInterview,
                              managementSupportRating: Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Exit Interview Feedback &amp; Suggestions</label>
                      <textarea
                        rows={3}
                        placeholder="Record employee's candid exit interview feedback..."
                        defaultValue={activeRecord.exitInterview.keyFeedback}
                        onBlur={e =>
                          submitExitInterview(activeRecord.id, {
                            ...activeRecord.exitInterview,
                            keyFeedback: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-slate-500">
                        {activeRecord.exitInterview.completed
                          ? `✓ Completed on ${activeRecord.exitInterview.completedAt?.slice(0, 10)}`
                          : 'Fill out and click Save to complete exit interview'}
                      </span>
                      <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold cursor-pointer">
                        Save Exit Interview
                      </button>
                    </div>
                  </form>
                )}

                {/* SUB-TAB 4: FINAL SETTLEMENT INTEGRATION WITH PAYROLL */}
                {activeSubTab === 'settlement' && (
                  <div className="space-y-4 text-xs">
                    <div className="p-3.5 bg-indigo-50/60 border border-indigo-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-indigo-950 block">Final Settlement &amp; Payroll Integration</span>
                        <span className="text-[11px] text-indigo-700">
                          Status: <strong className="uppercase">{activeRecord.finalSettlement.status.replace(/_/g, ' ')}</strong> · Target Payroll Month: {activeRecord.finalSettlement.settlementMonth}
                        </span>
                      </div>
                      {!isEmployeeMode && (
                        <button
                          type="button"
                          onClick={handleSyncToPayroll}
                          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold cursor-pointer"
                        >
                          ⚡ Sync Settlement to Monthly Payroll
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Additions */}
                      <div className="p-4 bg-emerald-50/40 border border-emerald-200 rounded-xl space-y-2.5">
                        <h5 className="font-bold text-emerald-900 uppercase"> Final Settlement Earnings (+)</h5>
                        <div>
                          <label className="text-slate-600 block mb-1">Settlement Payroll Month</label>
                          <input
                            type="month"
                            disabled={isEmployeeMode}
                            value={activeRecord.finalSettlement.settlementMonth}
                            onChange={e => handleSettlementFieldChange('settlementMonth', e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-slate-600 block mb-1">Unpaid Salary for Worked Days (৳)</label>
                          <input
                            type="number"
                            disabled={isEmployeeMode}
                            value={activeRecord.finalSettlement.unpaidSalaryAmount}
                            onChange={e => handleSettlementFieldChange('unpaidSalaryAmount', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-slate-600 block mb-1">Earned Leave Encashment (৳)</label>
                          <input
                            type="number"
                            disabled={isEmployeeMode}
                            value={activeRecord.finalSettlement.leaveEncashmentAmount}
                            onChange={e => handleSettlementFieldChange('leaveEncashmentAmount', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-slate-600 block mb-1">Gratuity / Service Benefit (৳)</label>
                          <input
                            type="number"
                            disabled={isEmployeeMode}
                            value={activeRecord.finalSettlement.gratuityOrServiceBenefit}
                            onChange={e => handleSettlementFieldChange('gratuityOrServiceBenefit', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono font-bold"
                          />
                        </div>
                      </div>

                      {/* Recoveries / Deductions */}
                      <div className="p-4 bg-rose-50/40 border border-rose-200 rounded-xl space-y-2.5">
                        <h5 className="font-bold text-rose-900 uppercase">Recoveries &amp; Deductions (-)</h5>
                        <div>
                          <label className="text-slate-600 block mb-1">Notice Period Shortfall Recovery (৳)</label>
                          <input
                            type="number"
                            disabled={isEmployeeMode}
                            value={activeRecord.finalSettlement.noticePayRecovery}
                            onChange={e => handleSettlementFieldChange('noticePayRecovery', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono font-bold text-rose-700"
                          />
                        </div>
                        <div>
                          <label className="text-slate-600 block mb-1">Unreturned / Damaged Asset Deduction (৳)</label>
                          <input
                            type="number"
                            disabled={isEmployeeMode}
                            value={activeRecord.finalSettlement.assetDamageDeduction}
                            onChange={e => handleSettlementFieldChange('assetDamageDeduction', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono font-bold text-rose-700"
                          />
                        </div>
                        <div>
                          <label className="text-slate-600 block mb-1">Outstanding Advance / Loan Recovery (৳)</label>
                          <input
                            type="number"
                            disabled={isEmployeeMode}
                            value={activeRecord.finalSettlement.loanOrAdvanceRecovery}
                            onChange={e => handleSettlementFieldChange('loanOrAdvanceRecovery', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono font-bold text-rose-700"
                          />
                        </div>
                        <div className="pt-2 border-t border-rose-200 flex items-center justify-between">
                          <span className="font-extrabold text-slate-900 text-sm">Net Final Settlement:</span>
                          <span className="font-mono font-black text-emerald-700 text-base">
                            ৳ {activeRecord.finalSettlement.netSettlementAmount.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL: INITIATE OFFBOARDING / RESIGNATION */}
      {showInitiateModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleInitiate} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              {isEmployeeMode ? 'Submit Formal Resignation' : 'Initiate Employee Offboarding'}
            </h3>
            <div className="space-y-3 text-xs">
              {!isEmployeeMode && (
                <>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Employee</label>
                    <select
                      required
                      value={initForm.employeeId}
                      onChange={e => setInitForm({ ...initForm, employeeId: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                    >
                      <option value="">-- Select Employee --</option>
                      {scopedEmployees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.employeeId} · {emp.department})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Separation Type</label>
                    <select
                      value={initForm.exitType}
                      onChange={e => setInitForm({ ...initForm, exitType: e.target.value as any })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                    >
                      <option value="resignation">Resignation</option>
                      <option value="termination">Termination</option>
                      <option value="retirement">Retirement</option>
                      <option value="end_of_contract">End of Contract</option>
                    </select>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Notice Required (Days)</label>
                  <input
                    type="number"
                    min={0}
                    value={initForm.noticePeriodDaysRequired}
                    onChange={e => setInitForm({ ...initForm, noticePeriodDaysRequired: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Notice Served (Days)</label>
                  <input
                    type="number"
                    min={0}
                    value={initForm.noticePeriodDaysServed}
                    onChange={e => setInitForm({ ...initForm, noticePeriodDaysServed: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Last Working Day</label>
                <input
                  type="date"
                  required
                  value={initForm.lastWorkingDay}
                  onChange={e => setInitForm({ ...initForm, lastWorkingDay: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Reason for Leaving / Remarks</label>
                <textarea
                  required
                  rows={3}
                  value={initForm.reason}
                  onChange={e => setInitForm({ ...initForm, reason: e.target.value })}
                  placeholder="Provide reason for resignation or separation..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowInitiateModal(false)} className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold">
                Initiate Offboarding
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADD ASSET ITEM */}
      {showAssetModal && activeRecord && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={async e => {
              e.preventDefault();
              if (!assetForm.assetName.trim()) return;
              await addOffboardingAsset(activeRecord.id, assetForm);
              setShowAssetModal(false);
              setAssetForm({
                assetName: '',
                assetTag: '',
                category: 'Laptop / PC',
                status: 'pending_return',
                deductionAmount: 0,
              });
            }}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4"
          >
            <h3 className="font-bold text-slate-900 text-base">Add Assigned Company Asset</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Asset Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MacBook Pro 14 / Corporate SIM"
                  value={assetForm.assetName}
                  onChange={e => setAssetForm({ ...assetForm, assetName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Asset Tag / Serial</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AST-2026-09"
                  value={assetForm.assetTag}
                  onChange={e => setAssetForm({ ...assetForm, assetTag: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAssetModal(false)} className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold">
                Add Asset
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
