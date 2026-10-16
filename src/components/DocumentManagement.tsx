import React, { useState, useMemo, useRef } from 'react';
import { useData, HRDocument, HRDocumentCategory } from '../context/DataContext';

const DOCUMENT_CATEGORIES: HRDocumentCategory[] = [
  'Company Policy',
  'Offer & Contract',
  'National ID / Passport',
  'Academic & Certificate',
  'Medical & Insurance',
  'Tax & Compliance',
  'NOC & Letters',
  'Other',
];

interface DocumentManagementProps {
  mode?: 'admin' | 'employee';
}

export function DocumentManagement({ mode = 'admin' }: DocumentManagementProps) {
  const {
    hrDocuments,
    uploadHRDocument,
    deleteHRDocument,
    sendDocumentExpiryReminder,
    employees,
    currentUser,
    currentEmployee,
    isAuthenticated,
    isEmployeeAuthenticated,
  } = useData();

  const isEmployeeMode = mode === 'employee' || (isEmployeeAuthenticated && !isAuthenticated);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'company_policy' | 'employee_private' | 'expiring'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployeeFilter, setSelectedEmployeeFilter] = useState<string>('all');

  // Upload Modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<HRDocumentCategory>(
    isEmployeeMode ? 'National ID / Passport' : 'Company Policy'
  );
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'company_policy' | 'employee_private'>(
    isEmployeeMode ? 'employee_private' : 'company_policy'
  );
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>(
    currentEmployee?.employeeId || currentEmployee?.id || ''
  );
  const [expiryDate, setExpiryDate] = useState('');
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    type: string;
    size: number;
    dataUrl: string;
  } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Preview Modal state
  const [previewDoc, setPreviewDoc] = useState<HRDocument | null>(null);

  const todayIso = new Date().toISOString().split('T')[0];

  // Calculate expiry status helper
  const getExpiryInfo = (expDate?: string) => {
    if (!expDate) return { status: 'none' as const, daysLeft: null, label: 'No Expiry' };
    const now = new Date(todayIso).getTime();
    const target = new Date(expDate).getTime();
    if (isNaN(target)) return { status: 'none' as const, daysLeft: null, label: expDate };
    const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      return { status: 'expired' as const, daysLeft: diffDays, label: `Expired (${Math.abs(diffDays)}d ago)` };
    }
    if (diffDays <= 30) {
      return { status: 'expiring_soon' as const, daysLeft: diffDays, label: `Expires in ${diffDays}d` };
    }
    return { status: 'valid' as const, daysLeft: diffDays, label: `Valid until ${expDate}` };
  };

  // Strict Permission-Controlled Document Filtering:
  // NEVER expose one employee's private documents to another employee.
  const accessibleDocuments = useMemo(() => {
    return hrDocuments.filter(doc => {
      if (isEmployeeMode) {
        if (!currentEmployee) return false;
        const isCompanyPolicy = doc.visibility === 'company_policy';
        const isMyPrivateDoc =
          doc.visibility === 'employee_private' &&
          (doc.employeeId === currentEmployee.employeeId || doc.employeeId === currentEmployee.id);
        return isCompanyPolicy || isMyPrivateDoc;
      }
      // Admin / HR with documents permission sees company policies and employee documents within their tenant
      return true;
    });
  }, [hrDocuments, isEmployeeMode, currentEmployee]);

  const filteredDocuments = useMemo(() => {
    return accessibleDocuments.filter(doc => {
      if (selectedCategory !== 'all' && doc.category !== selectedCategory) return false;
      if (visibilityFilter === 'company_policy' && doc.visibility !== 'company_policy') return false;
      if (visibilityFilter === 'employee_private' && doc.visibility !== 'employee_private') return false;
      if (visibilityFilter === 'expiring') {
        const exp = getExpiryInfo(doc.expiryDate);
        if (exp.status !== 'expired' && exp.status !== 'expiring_soon') return false;
      }
      if (!isEmployeeMode && selectedEmployeeFilter !== 'all') {
        if (doc.employeeId !== selectedEmployeeFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (doc.title || '').toLowerCase().includes(q);
        const matchCat = (doc.category || '').toLowerCase().includes(q);
        const matchEmp = (doc.employeeName || doc.employeeId || '').toLowerCase().includes(q);
        const matchFile = (doc.fileName || '').toLowerCase().includes(q);
        if (!matchTitle && !matchCat && !matchEmp && !matchFile) return false;
      }
      return true;
    });
  }, [accessibleDocuments, selectedCategory, visibilityFilter, selectedEmployeeFilter, searchQuery, isEmployeeMode]);

  const stats = useMemo(() => {
    let policyCount = 0;
    let personalCount = 0;
    let expiringSoonCount = 0;
    let expiredCount = 0;

    accessibleDocuments.forEach(d => {
      if (d.visibility === 'company_policy') policyCount++;
      else personalCount++;
      const exp = getExpiryInfo(d.expiryDate);
      if (exp.status === 'expiring_soon') expiringSoonCount++;
      if (exp.status === 'expired') expiredCount++;
    });

    return {
      total: accessibleDocuments.length,
      policyCount,
      personalCount,
      expiringSoonCount,
      expiredCount,
    };
  }, [accessibleDocuments]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 900 * 1024) {
      setUploadError('File size must be under 900 KB for cloud document storage.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedFile({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: String(reader.result || ''),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError('');
    setUploadSuccess('');

    if (!title.trim()) {
      setUploadError('Please enter a document title.');
      return;
    }
    if (!selectedFile) {
      setUploadError('Please attach a document file (PDF, Word, or Image).');
      return;
    }

    const effectiveVisibility = isEmployeeMode ? 'employee_private' : visibility;
    let resolvedEmpId: string | undefined = undefined;
    let resolvedEmpName: string | undefined = undefined;
    let resolvedDept: string | undefined = undefined;

    if (effectiveVisibility === 'employee_private') {
      if (isEmployeeMode && currentEmployee) {
        resolvedEmpId = currentEmployee.employeeId || currentEmployee.id;
        resolvedEmpName = currentEmployee.name;
        resolvedDept = currentEmployee.department;
      } else {
        const matchedEmp = employees.find(
          emp => emp.employeeId === targetEmployeeId || emp.id === targetEmployeeId
        );
        if (!matchedEmp) {
          setUploadError('Please select a target employee for an employee-specific document.');
          return;
        }
        resolvedEmpId = matchedEmp.employeeId || matchedEmp.id;
        resolvedEmpName = matchedEmp.name;
        resolvedDept = matchedEmp.department;
      }
    }

    setIsSubmitting(true);
    const res = await uploadHRDocument({
      title: title.trim(),
      category,
      description: description.trim() || undefined,
      visibility: effectiveVisibility,
      employeeId: resolvedEmpId,
      employeeName: resolvedEmpName,
      department: resolvedDept,
      expiryDate: expiryDate || undefined,
      fileName: selectedFile.name,
      fileType: selectedFile.type,
      fileSize: selectedFile.size,
      fileDataUrl: selectedFile.dataUrl,
    });
    setIsSubmitting(false);

    if (!res.success) {
      setUploadError(res.error || 'Failed to upload document.');
      return;
    }

    setUploadSuccess('Document uploaded and secured successfully.');
    setTitle('');
    setDescription('');
    setExpiryDate('');
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTimeout(() => {
      setShowUploadModal(false);
      setUploadSuccess('');
    }, 900);
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {isEmployeeMode ? 'My HR Documents & Company Policies' : 'Enterprise Document & Policy Vault'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isEmployeeMode
              ? 'Access official company policies and your strictly private employee documents with expiry tracking'
              : 'Manage permission-isolated employee files, company policies, expiry dates, and automated renewal reminders'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setUploadError('');
            setUploadSuccess('');
            if (isEmployeeMode) {
              setVisibility('employee_private');
              setCategory('National ID / Passport');
            }
            setShowUploadModal(true);
          }}
          className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer shrink-0"
        >
          + Upload {isEmployeeMode ? 'My Document' : 'HR Document / Policy'}
        </button>
      </div>

      {/* Expiry Reminder Alert Banner if any documents are expiring or expired */}
      {(stats.expiringSoonCount > 0 || stats.expiredCount > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-amber-900">
              Document Expiry Attention Required · {stats.expiredCount} Expired · {stats.expiringSoonCount} Expiring within 30 days
            </p>
            <p className="text-xs text-amber-700">
              {isEmployeeMode
                ? 'Please review your expiring personal compliance documents and upload renewed copies.'
                : 'Send automated renewal reminders to employees with expiring contracts, IDs, or compliance records.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVisibilityFilter(visibilityFilter === 'expiring' ? 'all' : 'expiring')}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shrink-0 cursor-pointer"
          >
            {visibilityFilter === 'expiring' ? 'Show All Documents' : 'Filter Expiring / Expired'}
          </button>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs text-slate-500 font-medium block">Accessible Documents</span>
          <span className="text-2xl font-black text-slate-900 mt-1 block">{stats.total}</span>
          <span className="text-[11px] text-slate-400">Tenant &amp; role isolated</span>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs text-slate-500 font-medium block">Company Policies</span>
          <span className="text-2xl font-black text-indigo-600 mt-1 block">{stats.policyCount}</span>
          <span className="text-[11px] text-slate-400">Organization-wide</span>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs text-slate-500 font-medium block">
            {isEmployeeMode ? 'My Personal Files' : 'Employee Private Files'}
          </span>
          <span className="text-2xl font-black text-purple-600 mt-1 block">{stats.personalCount}</span>
          <span className="text-[11px] text-slate-400">Strict private access</span>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs text-slate-500 font-medium block">Expiring / Expired</span>
          <span className="text-2xl font-black text-rose-600 mt-1 block">
            {stats.expiringSoonCount + stats.expiredCount}
          </span>
          <span className="text-[11px] text-slate-400">
            {stats.expiredCount} expired · {stats.expiringSoonCount} soon
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Segmented Control */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setVisibilityFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              visibilityFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({stats.total})
          </button>
          <button
            type="button"
            onClick={() => setVisibilityFilter('company_policy')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              visibilityFilter === 'company_policy'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Company Policies ({stats.policyCount})
          </button>
          <button
            type="button"
            onClick={() => setVisibilityFilter('employee_private')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              visibilityFilter === 'employee_private'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isEmployeeMode ? 'My Private Docs' : 'Employee Docs'} ({stats.personalCount})
          </button>
          <button
            type="button"
            onClick={() => setVisibilityFilter('expiring')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              visibilityFilter === 'expiring'
                ? 'bg-white text-rose-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Expiring ({stats.expiringSoonCount + stats.expiredCount})
          </button>
        </div>

        {/* Dropdowns & Search */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700"
          >
            <option value="all">All Categories</option>
            {DOCUMENT_CATEGORIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {!isEmployeeMode && (
            <select
              value={selectedEmployeeFilter}
              onChange={e => setSelectedEmployeeFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700"
            >
              <option value="all">All Employees</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employeeId || emp.id}>
                  {emp.name} ({emp.employeeId})
                </option>
              ))}
            </select>
          )}

          <input
            type="text"
            placeholder="Search title, category, file..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 w-48 sm:w-56"
          />
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm min-w-[780px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-xs">
              <tr>
                <th className="px-4 py-3">Document Title &amp; File</th>
                <th className="px-4 py-3">Category &amp; Scope</th>
                <th className="px-4 py-3">Owner / Target</th>
                <th className="px-4 py-3">Expiry Status</th>
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    No documents found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredDocuments.map(doc => {
                  const exp = getExpiryInfo(doc.expiryDate);
                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{doc.title}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span className="truncate max-w-[200px]">{doc.fileName}</span>
                          <span>·</span>
                          <span>{(doc.fileSize / 1024).toFixed(1)} KB</span>
                        </div>
                        {doc.description && (
                          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{doc.description}</p>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800 text-xs">{doc.category}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {doc.visibility === 'company_policy' ? 'Company Policy · All Staff' : 'Employee Private · Restricted'}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {doc.visibility === 'company_policy' ? (
                          <span className="text-xs font-medium text-indigo-700">All Company Employees</span>
                        ) : (
                          <div>
                            <div className="font-semibold text-slate-800 text-xs">
                              {doc.employeeName || doc.employeeId}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {doc.employeeId} {doc.department ? `· ${doc.department}` : ''}
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div
                          className={`text-xs font-semibold ${
                            exp.status === 'expired'
                              ? 'text-rose-600'
                              : exp.status === 'expiring_soon'
                              ? 'text-amber-600'
                              : exp.status === 'valid'
                              ? 'text-emerald-700'
                              : 'text-slate-400'
                          }`}
                        >
                          {exp.label}
                        </div>
                        {doc.lastReminderSentAt && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Reminder sent {new Date(doc.lastReminderSentAt).toLocaleDateString()}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-500">
                        <div>{new Date(doc.createdAt).toLocaleDateString()}</div>
                        <div className="text-[11px] text-slate-400">by {doc.uploadedBy}</div>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewDoc(doc)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            View
                          </button>
                          <a
                            href={doc.fileDataUrl}
                            download={doc.fileName}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold"
                          >
                            Download
                          </a>
                          {!isEmployeeMode &&
                            doc.visibility === 'employee_private' &&
                            (exp.status === 'expiring_soon' || exp.status === 'expired') && (
                              <button
                                type="button"
                                onClick={() => sendDocumentExpiryReminder(doc.id)}
                                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg text-xs font-semibold cursor-pointer"
                                title="Send expiry renewal reminder to employee"
                              >
                                Remind
                              </button>
                            )}
                          {!isEmployeeMode && (
                            <button
                              type="button"
                              onClick={() => deleteHRDocument(doc.id)}
                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-semibold cursor-pointer"
                            >
                              Delete
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

      {/* Upload Document Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isEmployeeMode ? 'Upload Personal HR Document' : 'Upload HR Document or Company Policy'}
                </h3>
                <p className="text-xs text-slate-500">
                  {isEmployeeMode
                    ? 'Uploaded files are strictly private to you and HR Administration'
                    : 'Choose visibility scope and optional expiry tracking'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {uploadError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
                {uploadError}
              </div>
            )}
            {uploadSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-semibold">
                {uploadSuccess}
              </div>
            )}

            <form onSubmit={handleUploadSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Document Title *</label>
                <input
                  type="text"
                  placeholder="e.g., Employee Handbook 2026, National ID Card, Employment Contract"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Category *</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as HRDocumentCategory)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                  >
                    {DOCUMENT_CATEGORIES.map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Expiry Date (Optional)</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={e => setExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                  />
                </div>
              </div>

              {!isEmployeeMode && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Access &amp; Visibility Scope *</label>
                    <select
                      value={visibility}
                      onChange={e => setVisibility(e.target.value as 'company_policy' | 'employee_private')}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                    >
                      <option value="company_policy">Company Policy (Accessible by all company employees)</option>
                      <option value="employee_private">
                        Employee-Specific Private Document (Isolated to selected employee + HR)
                      </option>
                    </select>
                  </div>

                  {visibility === 'employee_private' && (
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Target Employee *</label>
                      <select
                        value={targetEmployeeId}
                        onChange={e => setTargetEmployeeId(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                        required
                      >
                        <option value="">-- Select Employee --</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.employeeId || emp.id}>
                            {emp.name} ({emp.employeeId}) · {emp.department}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">Notes / Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Optional compliance reference or document version notes..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Attach File (PDF / Image / Word) *</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,application/pdf,image/*"
                  onChange={handleFileSelect}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3.5 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                />
                {selectedFile && (
                  <p className="text-[11px] text-emerald-700 font-medium mt-1">
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl font-bold cursor-pointer"
                >
                  {isSubmitting ? 'Uploading...' : 'Upload Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Document Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-xl border border-slate-200 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">{previewDoc.title}</h3>
                <p className="text-xs text-slate-500">
                  {previewDoc.category} · {previewDoc.fileName} · Uploaded by {previewDoc.uploadedBy}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewDoc.fileDataUrl}
                  download={previewDoc.fileName}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50 rounded-2xl p-4 flex items-center justify-center min-h-[340px]">
              {previewDoc.fileType.startsWith('image/') ? (
                <img
                  src={previewDoc.fileDataUrl}
                  alt={previewDoc.title}
                  className="max-h-[60vh] w-auto object-contain rounded-xl"
                />
              ) : previewDoc.fileType === 'application/pdf' || previewDoc.fileName.toLowerCase().endsWith('.pdf') ? (
                <iframe
                  src={previewDoc.fileDataUrl}
                  title={previewDoc.title}
                  className="w-full h-[60vh] rounded-xl border border-slate-200"
                />
              ) : (
                <div className="text-center space-y-2 py-12">
                  <p className="text-sm font-bold text-slate-800">{previewDoc.fileName}</p>
                  <p className="text-xs text-slate-500">
                    Click Download above to view this document in your native viewer.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
