import { useState, useMemo } from 'react';
import { useData, LeaveRequest } from '../context/DataContext';

export function LeaveManagement() {
  const { leaveRequests, employees, approveLeave, rejectLeave, addNotification } = useData();
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLeave, setSelectedLeave] = useState<LeaveRequest | null>(null);
  const [adminRemarks, setAdminRemarks] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  const filtered = useMemo(() => {
    return leaveRequests.filter(l => {
      const matchesStatus = filter === 'all' || l.status === filter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (l.employeeName || '').toLowerCase().includes(q) ||
        (l.employeeId || '').toLowerCase().includes(q) ||
        (l.department || '').toLowerCase().includes(q) ||
        (l.type || '').toLowerCase().includes(q) ||
        (l.reason || '').toLowerCase().includes(q) ||
        (l.attachmentName || '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [leaveRequests, filter, searchQuery]);

  // Summary counts
  const stats = useMemo(() => {
    const total = leaveRequests.length;
    const pending = leaveRequests.filter(l => l.status === 'pending').length;
    const approved = leaveRequests.filter(l => l.status === 'approved').length;
    const rejected = leaveRequests.filter(l => l.status === 'rejected').length;
    const withAttachment = leaveRequests.filter(l => Boolean(l.attachmentDataUrl && l.attachmentName)).length;
    return { total, pending, approved, rejected, withAttachment };
  }, [leaveRequests]);

  // Calculate employee's leave balance for Admin Justification Modal
  const selectedEmployeeBalance = useMemo(() => {
    if (!selectedLeave) return null;
    const empLeaves = leaveRequests.filter(
      l =>
        (l.employeeId === selectedLeave.employeeId || l.employeeName === selectedLeave.employeeName) &&
        l.status === 'approved'
    );
    const casualUsed = empLeaves.filter(l => l.type === 'Casual').reduce((s, l) => s + (Number(l.days) || 0), 0);
    const sickUsed = empLeaves.filter(l => l.type === 'Sick').reduce((s, l) => s + (Number(l.days) || 0), 0);
    const annualUsed = empLeaves.filter(l => l.type === 'Annual').reduce((s, l) => s + (Number(l.days) || 0), 0);

    let policy = { casualDays: 10, sickDays: 14, annualDays: 14 };
    try {
      const saved = localStorage.getItem('worknest_settings_leave');
      if (saved) {
        const parsed = JSON.parse(saved);
        policy = {
          casualDays: Number(parsed.casualDays) || 10,
          sickDays: Number(parsed.sickDays) || 14,
          annualDays: Number(parsed.annualDays) || 14,
        };
      }
    } catch {}

    const empObj = employees.find(
      e => e.id === selectedLeave.employeeId || e.employeeId === selectedLeave.employeeId || e.name === selectedLeave.employeeName
    );

    return {
      empObj,
      casual: { used: casualUsed, total: policy.casualDays, remaining: Math.max(0, policy.casualDays - casualUsed) },
      sick: { used: sickUsed, total: policy.sickDays, remaining: Math.max(0, policy.sickDays - sickUsed) },
      annual: { used: annualUsed, total: policy.annualDays, remaining: Math.max(0, policy.annualDays - annualUsed) },
    };
  }, [selectedLeave, leaveRequests, employees]);

  const openJustificationModal = (leave: LeaveRequest) => {
    setSelectedLeave(leave);
    setAdminRemarks(leave.adminRemarks || '');
  };

  const handleApprove = async (id: string, name: string, customRemarks?: string) => {
    setIsSubmittingReview(true);
    try {
      const finalRemarks = customRemarks !== undefined ? customRemarks.trim() : undefined;
      await approveLeave(id, finalRemarks || 'Application verified and justified by Admin — Approved.');
      addNotification({
        title: 'Leave Approved & Justified',
        message: `Leave application for ${name} has been verified and approved${finalRemarks ? ` (${finalRemarks})` : ''}.`,
        read: false,
        type: 'leave',
        targetPage: 'leave',
      });
      if (selectedLeave?.id === id) {
        setSelectedLeave(null);
      }
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleReject = async (id: string, name: string, customRemarks?: string) => {
    setIsSubmittingReview(true);
    try {
      const finalRemarks = customRemarks !== undefined ? customRemarks.trim() : undefined;
      await rejectLeave(id, finalRemarks || 'Leave application reviewed and declined by Admin.');
      addNotification({
        title: 'Leave Rejected',
        message: `Leave application for ${name} has been rejected${finalRemarks ? ` (${finalRemarks})` : ''}.`,
        read: false,
        type: 'leave',
        targetPage: 'leave',
      });
      if (selectedLeave?.id === id) {
        setSelectedLeave(null);
      }
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const getFileBadgeInfo = (fileName?: string) => {
    const lower = (fileName || '').toLowerCase();
    if (lower.endsWith('.pdf')) {
      return { icon: '📕', label: 'PDF', badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100' };
    }
    if (lower.endsWith('.doc') || lower.endsWith('.docx')) {
      return { icon: '📘', label: 'WORD', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' };
    }
    return { icon: '🖼️', label: 'FILE', badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' };
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header & Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Leave Management &amp; Document Justification</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Verify uploaded Word/PDF leave applications, check leave balances, and justify approval or rejection
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search employee, ID, reason, file..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"
          />
          <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl">
            {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg capitalize transition-all cursor-pointer ${
                  filter === f ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase text-slate-400 block">Total Requests</span>
          <span className="text-xl font-black text-slate-800 mt-0.5 block">{stats.total}</span>
        </div>
        <div className="bg-amber-50/60 p-3.5 rounded-2xl border border-amber-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase text-amber-700 block">Pending Review</span>
          <span className="text-xl font-black text-amber-700 mt-0.5 block">{stats.pending}</span>
        </div>
        <div className="bg-emerald-50/60 p-3.5 rounded-2xl border border-emerald-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase text-emerald-700 block">Approved</span>
          <span className="text-xl font-black text-emerald-700 mt-0.5 block">{stats.approved}</span>
        </div>
        <div className="bg-rose-50/60 p-3.5 rounded-2xl border border-rose-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase text-rose-700 block">Rejected</span>
          <span className="text-xl font-black text-rose-700 mt-0.5 block">{stats.rejected}</span>
        </div>
        <div className="bg-indigo-50/60 p-3.5 rounded-2xl border border-indigo-200 shadow-2xs col-span-2 sm:col-span-1">
          <span className="text-[11px] font-bold uppercase text-indigo-700 block">Word/PDF Attached</span>
          <span className="text-xl font-black text-indigo-700 mt-0.5 block">{stats.withAttachment} Files</span>
        </div>
      </div>

      {/* Leave Applications Table */}
      <div className="bg-white rounded-2xl shadow-2xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-xs sm:text-sm min-w-[900px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">EMPLOYEE</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">TYPE &amp; DATES</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">DAYS</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">REASON</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">APPLICATION FILE (WORD/PDF)</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">STATUS &amp; JUSTIFICATION</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => {
                const empObj = employees.find(
                  e => e.id === l.employeeId || e.employeeId === l.employeeId || e.name === l.employeeName
                );
                const badge = getFileBadgeInfo(l.attachmentName);
                return (
                  <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{l.employeeName}</div>
                      <div className="text-[11px] text-slate-500">
                        {empObj?.designation ? `${empObj.designation} • ` : ''}
                        {l.department || empObj?.department || 'General'}
                      </div>
                      <div className="text-[10px] font-mono text-indigo-600 font-semibold">
                        ID: {empObj?.employeeId || l.employeeId}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-[11px] font-bold">
                        {l.type} Leave
                      </span>
                      <div className="text-xs font-mono text-slate-700 mt-1 whitespace-nowrap">
                        {l.from} → {l.to}
                      </div>
                      {l.appliedOn && (
                        <div className="text-[10px] text-slate-400">Applied: {l.appliedOn}</div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className="px-2.5 py-1 bg-slate-100 rounded-lg font-black text-slate-800 text-xs">
                        {l.days}d
                      </span>
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-600 max-w-[220px]">
                      <p className="line-clamp-2" title={l.reason}>{l.reason}</p>
                    </td>

                    {/* Application File (Word / PDF / Image) */}
                    <td className="px-4 py-3">
                      {l.attachmentDataUrl && l.attachmentName ? (
                        <div className="flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => openJustificationModal(l)}
                            className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs ${badge.badgeClass}`}
                            title="Click to inspect & justify application document"
                          >
                            <span>{badge.icon}</span>
                            <span className="uppercase text-[10px] font-black px-1 bg-white/80 rounded">{badge.label}</span>
                            <span className="max-w-[115px] truncate">{l.attachmentName}</span>
                          </button>
                          <a
                            href={l.attachmentDataUrl}
                            download={l.attachmentName}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors"
                            title="Download original file"
                          >
                            ⬇️
                          </a>
                        </div>
                      ) : (
                        <span className="px-2 py-1 bg-slate-50 border border-slate-200 text-slate-400 rounded-lg text-[11px] italic">
                          No file uploaded
                        </span>
                      )}
                    </td>

                    {/* Status & Admin Justification Remarks */}
                    <td className="px-4 py-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold capitalize inline-block ${
                          l.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-700'
                            : l.status === 'rejected'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {l.status}
                      </span>
                      {l.adminRemarks && (
                        <p className="text-[11px] text-slate-600 mt-1 max-w-[190px] truncate" title={l.adminRemarks}>
                          💬 {l.adminRemarks}
                        </p>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => openJustificationModal(l)}
                        className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-all cursor-pointer inline-flex items-center space-x-1"
                      >
                        <span>🔍</span>
                        <span>{l.status === 'pending' ? 'Justify & Review' : 'View Details'}</span>
                      </button>
                      {l.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleApprove(l.id, l.employeeName)}
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(l.id, l.employeeName)}
                            className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400">
                    No leave requests found matching your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ADMIN LEAVE APPLICATION VERIFICATION & JUSTIFICATION MODAL               */}
      {/* ========================================================================= */}
      {selectedLeave && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">🔍</span>
                <div>
                  <h3 className="font-black text-sm sm:text-base">
                    Leave Application Verification &amp; Admin Justification
                  </h3>
                  <p className="text-[11px] text-indigo-200">
                    Applicant: <strong>{selectedLeave.employeeName}</strong> • {selectedLeave.type} Leave ({selectedLeave.days} Days)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLeave(null)}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 text-xs sm:text-sm">
              {/* 1. Employee Details & Remaining Leave Balance Check */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                    👤 Applicant &amp; Leave Request Summary
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-400 block">Employee Name</span>
                      <span className="font-bold text-slate-900">{selectedLeave.employeeName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Department &amp; Role</span>
                      <span className="font-bold text-slate-900">
                        {selectedEmployeeBalance?.empObj?.designation || 'Employee'} • {selectedLeave.department || 'General'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Leave Duration</span>
                      <span className="font-mono font-bold text-indigo-700">
                        {selectedLeave.from} → {selectedLeave.to} ({selectedLeave.days} Days)
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Current Status</span>
                      <span className="font-bold uppercase text-slate-800">{selectedLeave.status}</span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-200">
                    <span className="text-slate-400 text-[11px] block font-semibold">Stated Reason for Leave:</span>
                    <p className="text-slate-800 font-medium mt-0.5 bg-white p-2.5 rounded-xl border border-slate-200">
                      {selectedLeave.reason}
                    </p>
                  </div>
                </div>

                {/* Leave Balance Verification Card */}
                {selectedEmployeeBalance && (
                  <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-200/80 space-y-2.5">
                    <h4 className="font-bold text-indigo-950 text-xs uppercase tracking-wider flex items-center justify-between">
                      <span>📊 Leave Quota &amp; Balance Eligibility Check</span>
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px]">Auto-Verified</span>
                    </h4>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2.5 bg-white rounded-xl border border-indigo-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block">Casual Leave</span>
                        <span className="text-base font-black text-slate-900">
                          {selectedEmployeeBalance.casual.remaining}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          left of {selectedEmployeeBalance.casual.total}d
                        </span>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-indigo-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block">Sick Leave</span>
                        <span className="text-base font-black text-slate-900">
                          {selectedEmployeeBalance.sick.remaining}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          left of {selectedEmployeeBalance.sick.total}d
                        </span>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-indigo-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block">Annual Leave</span>
                        <span className="text-base font-black text-slate-900">
                          {selectedEmployeeBalance.annual.remaining}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          left of {selectedEmployeeBalance.annual.total}d
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-indigo-900 font-medium">
                      💡 As an administrator, you can review the employee leave balance and attached documents (Word/PDF) before approving or rejecting.
                    </p>
                  </div>
                )}
              </div>

              {/* 2. Uploaded Leave Application Document (Word / PDF / Image) Viewer */}
              <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-50">
                <div className="px-4 py-3 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span>📎</span>
                    <span className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                      Uploaded Leave Application Document (Word / PDF / Supporting Proof)
                    </span>
                  </div>
                  {selectedLeave.attachmentDataUrl && selectedLeave.attachmentName && (
                    <a
                      href={selectedLeave.attachmentDataUrl}
                      download={selectedLeave.attachmentName}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold inline-flex items-center space-x-1.5 shadow-2xs"
                    >
                      <span>⬇️</span>
                      <span>Download ({selectedLeave.attachmentName})</span>
                    </a>
                  )}
                </div>

                <div className="p-4 flex flex-col items-center justify-center min-h-[220px]">
                  {!selectedLeave.attachmentDataUrl || !selectedLeave.attachmentName ? (
                    <div className="text-center py-8 text-slate-400 space-y-1">
                      <span className="text-3xl block">📄</span>
                      <p className="font-semibold text-slate-600 text-xs">
                        No supporting Word or PDF application document was attached.
                      </p>
                      <p className="text-[11px] text-slate-400">
                        The employee submitted this request without an attachment.
                      </p>
                    </div>
                  ) : selectedLeave.attachmentDataUrl.startsWith('data:application/pdf') ||
                    selectedLeave.attachmentName.toLowerCase().endsWith('.pdf') ? (
                    <iframe
                      src={selectedLeave.attachmentDataUrl}
                      title="Uploaded Leave Application PDF"
                      className="w-full h-[420px] rounded-xl border border-slate-200 bg-white"
                    />
                  ) : selectedLeave.attachmentDataUrl.startsWith('data:image/') ? (
                    <img
                      src={selectedLeave.attachmentDataUrl}
                      alt={selectedLeave.attachmentName}
                      className="max-h-[420px] w-auto object-contain rounded-xl border border-slate-200 bg-white shadow-xs"
                    />
                  ) : (
                    <div className="text-center p-6 bg-white rounded-2xl border border-blue-200 max-w-md space-y-3 shadow-2xs">
                      <span className="text-5xl block">📘</span>
                      <div>
                        <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[10px] font-black uppercase">
                          Microsoft Word Application (.doc / .docx)
                        </span>
                        <h5 className="font-bold text-slate-900 text-sm mt-1.5 break-all">
                          {selectedLeave.attachmentName}
                        </h5>
                        {selectedLeave.attachmentSize && (
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            File Size: {(selectedLeave.attachmentSize / 1024).toFixed(1)} KB
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-slate-600">
                        The employee uploaded a <strong>Word Document</strong> (.doc/.docx). Click below to download and review the file:
                      </p>
                      <a
                        href={selectedLeave.attachmentDataUrl}
                        download={selectedLeave.attachmentName}
                        className="inline-flex items-center space-x-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs"
                      >
                        <span>⬇️</span>
                        <span>Download Word Application to Verify</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Admin Justification & Remarks Input */}
              <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                    ✍️ Admin Justification / Review Decision Remarks (Visible on Employee Portal)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Application & document verified — Approved',
                      'Medical document verified — Approved',
                      'Leave balance verified — Approved',
                      'Supporting document missing/invalid — Rejected',
                    ].map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAdminRemarks(preset)}
                        className="px-2 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={2}
                  value={adminRemarks}
                  onChange={e => setAdminRemarks(e.target.value)}
                  placeholder="Write official HR justification or remarks before approving/rejecting (e.g., Leave application PDF/Word verified and approved)..."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedLeave(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Close
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSubmittingReview}
                  onClick={() => handleReject(selectedLeave.id, selectedLeave.employeeName, adminRemarks)}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50 flex items-center space-x-1.5"
                >
                  <span>✕</span>
                  <span>Justify &amp; Reject Leave</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmittingReview}
                  onClick={() => handleApprove(selectedLeave.id, selectedLeave.employeeName, adminRemarks)}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50 flex items-center space-x-1.5"
                >
                  <span>✅</span>
                  <span>Justify &amp; Approve Leave</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
