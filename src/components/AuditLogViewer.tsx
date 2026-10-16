import React, { useState, useMemo } from 'react';
import { useData, AuditLogEntry, AuditLogCategory } from '../context/DataContext';

const CATEGORY_LABELS: Record<AuditLogCategory, string> = {
  security: 'Login & Security',
  employee: 'Employee Lifecycle',
  role_permission: 'Role & Permissions',
  attendance: 'Attendance Changes',
  roster_shift: 'Roster & Shift',
  leave_workflow: 'Leave & Approvals',
  payroll: 'Payroll & Salary',
  document: 'Document Vault',
  settings: 'Admin & Settings',
  admin_settings: 'Admin & Settings',
  performance: 'Performance & KPIs',
  expense: 'Expense Claims',
  onboarding_offboarding: 'Onboarding & Exit',
  workforce_planning: 'Workforce Planning',
  engagement: 'Employee Engagement',
  learning_skills: 'Learning & Skills',
  talent_succession: 'Career, Talent & Succession',
  global_i18n: 'Global & Multi-Entity',
  ai_intelligence: 'AI HR Intelligence',
};

export function AuditLogViewer() {
  const { auditLogs, currentUser } = useData();

  const [categoryFilter, setCategoryFilter] = useState<'all' | AuditLogCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  const filteredLogs = useMemo(() => {
    return auditLogs.filter(entry => {
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mActor = (entry.actorName || '').toLowerCase().includes(q);
        const mAction = (entry.action || '').toLowerCase().includes(q);
        const mTarget = (entry.targetName || entry.targetId || '').toLowerCase().includes(q);
        const mSummary = (entry.summary || '').toLowerCase().includes(q);
        if (!mActor && !mAction && !mTarget && !mSummary) return false;
      }
      return true;
    });
  }, [auditLogs, categoryFilter, searchQuery]);

  const counts = useMemo(() => {
    const byCat: Record<string, number> = { all: auditLogs.length };
    auditLogs.forEach(l => {
      byCat[l.category] = (byCat[l.category] || 0) + 1;
    });
    return byCat;
  }, [auditLogs]);

  const handleExportCsv = () => {
    const headers = ['Timestamp', 'Category', 'Action', 'Actor Name', 'Actor Role', 'Target Type', 'Target', 'Summary'];
    const rows = filteredLogs.map(l => [
      l.timestamp,
      l.category,
      l.action,
      `"${(l.actorName || '').replace(/"/g, '""')}"`,
      `"${(l.actorRole || '').replace(/"/g, '""')}"`,
      l.targetType,
      `"${(l.targetName || l.targetId || '').replace(/"/g, '""')}"`,
      `"${(l.summary || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `worknest_audit_logs_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (currentUser && !currentUser.permissions?.auditLogs && currentUser.role !== 'Super Admin') {
    return (
      <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-2">
        <h3 className="text-base font-bold text-slate-900">Audit Log Access Restricted</h3>
        <p className="text-xs text-slate-500">
          Only authorized administrators with Audit Log permission can inspect system security and compliance trails.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Enterprise Security &amp; Compliance Audit Log</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable trail of authentication events, employee changes, permission updates, attendance regularizations, approvals, payroll, and documents
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer shrink-0"
        >
          Export Audit CSV ({filteredLogs.length})
        </button>
      </div>

      {/* Category Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              categoryFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Events ({counts.all || 0})
          </button>
          {(Object.keys(CATEGORY_LABELS) as AuditLogCategory[]).map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                categoryFilter === cat ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {CATEGORY_LABELS[cat]} ({counts[cat] || 0})
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search actor, action, target, summary..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 w-full lg:w-64"
        />
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm min-w-[860px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-xs">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Actor &amp; Role</th>
                <th className="px-4 py-3">Category &amp; Action</th>
                <th className="px-4 py-3">Target Entity</th>
                <th className="px-4 py-3">Event Summary</th>
                <th className="px-4 py-3 text-right">Diff / Values</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    No audit log events match your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 text-xs">{log.actorName}</div>
                      <div className="text-[11px] text-slate-500">
                        {log.actorRole} · <span className="font-mono">{log.actorId}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-purple-700 text-xs">{log.action}</div>
                      <div className="text-[11px] text-slate-500">
                        {CATEGORY_LABELS[log.category] || log.category}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 text-xs">
                        {log.targetName || log.targetId}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {log.targetType} · {log.targetId}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-700 max-w-sm">{log.summary}</td>

                    <td className="px-4 py-3 text-right">
                      {log.beforeValue !== undefined || log.afterValue !== undefined ? (
                        <button
                          type="button"
                          onClick={() => setSelectedEntry(log)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                        >
                          Inspect Values
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">Recorded</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Before / After Diff Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-mono">{selectedEntry.action}</h3>
                <p className="text-xs text-slate-500">
                  {selectedEntry.actorName} ({selectedEntry.actorRole}) ·{' '}
                  {new Date(selectedEntry.timestamp).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-700">{selectedEntry.summary}</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 bg-rose-50/50 border border-rose-200 rounded-2xl">
                <div className="font-bold text-rose-900 mb-2">Before Value</div>
                <pre className="font-mono text-[11px] text-slate-700 whitespace-pre-wrap break-all">
                  {selectedEntry.beforeValue !== undefined
                    ? JSON.stringify(selectedEntry.beforeValue, null, 2)
                    : 'None (New Record / Event)'}
                </pre>
              </div>

              <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-2xl">
                <div className="font-bold text-emerald-900 mb-2">After Value</div>
                <pre className="font-mono text-[11px] text-slate-700 whitespace-pre-wrap break-all">
                  {selectedEntry.afterValue !== undefined
                    ? JSON.stringify(selectedEntry.afterValue, null, 2)
                    : 'None (Deleted / Action Completed)'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
