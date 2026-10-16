import React, { useState, useMemo, useRef } from 'react';
import {
  useData,
  OnboardingRecord,
  OnboardingTaskItem,
  Employee,
  HRDocumentCategory,
} from '../context/DataContext';
import { OffboardingManagement } from './OffboardingManagement';

interface OnboardingManagementProps {
  mode?: 'admin' | 'manager' | 'employee';
}

export function OnboardingManagement({ mode = 'admin' }: OnboardingManagementProps) {
  const [lifecycleTab, setLifecycleTab] = useState<'onboarding' | 'offboarding'>('onboarding');
  const {
    employees,
    allEmployees,
    currentUser,
    currentEmployee,
    isAuthenticated,
    isEmployeeAuthenticated,
    authorizedTeamEmployees,
    onboardingRecords,
    initiateOnboarding,
    toggleOnboardingTask,
    addOnboardingTask,
    acknowledgeOnboardingPolicy,
    uploadHRDocument,
  } = useData();

  const isEmployeeMode = mode === 'employee' || (isEmployeeAuthenticated && !isAuthenticated && mode !== 'manager');
  const isManagerMode = mode === 'manager';

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

  const visibleRecords = useMemo(() => {
    return onboardingRecords.filter(r => scopedEmpIds.has(r.employeeId) || scopedEmpIds.has(r.employeeCode));
  }, [onboardingRecords, scopedEmpIds]);

  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const activeRecord: OnboardingRecord | undefined = useMemo(() => {
    if (selectedRecordId) {
      const f = visibleRecords.find(r => r.id === selectedRecordId);
      if (f) return f;
    }
    return visibleRecords[0];
  }, [visibleRecords, selectedRecordId]);

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showBanner = (type: 'success' | 'error', text: string) => {
    setBanner({ type, text });
    setTimeout(() => setBanner(null), 4000);
  };

  // Initiate Modal
  const [showInitiateModal, setShowInitiateModal] = useState(false);
  const [initEmpId, setInitEmpId] = useState('');
  const [mentorName, setMentorName] = useState('');
  const [probationDate, setProbationDate] = useState('');

  // Custom Task Modal
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [newTaskForm, setNewTaskForm] = useState({
    title: '',
    category: 'Joining Task' as OnboardingTaskItem['category'],
    assignedToRole: 'Employee' as OnboardingTaskItem['assignedToRole'],
  });

  // Policy Acknowledgement Signature state
  const [signatureInput, setSignatureInput] = useState('');

  // Document quick-upload ref for Required Document tasks
  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingForTask, setUploadingForTask] = useState<OnboardingTaskItem | null>(null);

  const stats = useMemo(() => {
    const total = visibleRecords.length;
    const completed = visibleRecords.filter(r => r.status === 'completed' || r.progress === 100).length;
    const inProgress = total - completed;
    const avgProgress = total > 0
      ? Math.round(visibleRecords.reduce((s, r) => s + (Number(r.progress) || 0), 0) / total)
      : 0;
    return { total, completed, inProgress, avgProgress };
  }, [visibleRecords]);

  const handleInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    const emp = scopedEmployees.find(x => x.id === initEmpId || x.employeeId === initEmpId) || currentEmployee;
    if (!emp) {
      showBanner('error', 'Please select an employee.');
      return;
    }
    const created = await initiateOnboarding(emp, mentorName || undefined, probationDate || undefined);
    setSelectedRecordId(created.id);
    setShowInitiateModal(false);
    showBanner('success', `Onboarding checklist initialized for ${emp.name}.`);
  };

  const handleQuickUploadDoc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingForTask || !activeRecord) return;
    if (file.size > 2 * 1024 * 1024) {
      showBanner('error', 'Document must be under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const cat = (uploadingForTask.linkedDocumentCategory || 'Other') as HRDocumentCategory;
      const upRes = await uploadHRDocument({
        title: `${uploadingForTask.title} - ${activeRecord.employeeName}`,
        category: cat,
        visibility: 'employee_private',
        employeeId: activeRecord.employeeId,
        employeeName: activeRecord.employeeName,
        department: activeRecord.department,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        fileDataUrl: String(reader.result || ''),
        notes: 'Uploaded via Onboarding Required Documents checklist',
      });
      if (upRes.success) {
        if (!uploadingForTask.completed) {
          await toggleOnboardingTask(activeRecord.id, uploadingForTask.id, `Uploaded ${file.name}`);
        }
        showBanner('success', `Uploaded "${file.name}" and marked document requirement complete.`);
      } else {
        showBanner('error', upRes.error || 'Document upload failed.');
      }
      setUploadingForTask(null);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-5">
      {/* Unified Onboarding & Offboarding Lifecycle Switcher */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-2 shadow-2xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLifecycleTab('onboarding')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              lifecycleTab === 'onboarding'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>🚀</span>
            <span>Onboarding &amp; Joining</span>
          </button>
          <button
            type="button"
            onClick={() => setLifecycleTab('offboarding')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              lifecycleTab === 'offboarding'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>🚪</span>
            <span>Offboarding &amp; Exit</span>
          </button>
        </div>
        <span className="text-[11px] font-semibold text-slate-400 px-2 hidden sm:inline">
          Unified Employee Lifecycle Management
        </span>
      </div>

      {lifecycleTab === 'offboarding' ? (
        <OffboardingManagement mode={mode} />
      ) : (
        <>
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

      <input
        ref={docFileInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx"
        className="hidden"
        onChange={handleQuickUploadDoc}
      />

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>Structured Employee Joining &amp; Orientation</span>
            <span aria-hidden="true">·</span>
            <span>{isEmployeeMode ? 'My Joining Checklist' : isManagerMode ? 'Team Onboarding' : 'Company Onboarding Hub'}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">Employee Onboarding &amp; Joining Readiness</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Track required documents, joining tasks, HR/Manager/IT setup, policy acknowledgement, and completion progress
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEmployeeMode && visibleRecords.length === 0 && currentEmployee ? (
            <button
              onClick={() => initiateOnboarding(currentEmployee)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer"
            >
              Initialize My Onboarding Checklist
            </button>
          ) : !isEmployeeMode ? (
            <button
              onClick={() => {
                setInitEmpId(scopedEmployees[0]?.id || '');
                setMentorName('');
                setProbationDate('');
                setShowInitiateModal(true);
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer"
            >
              + Initiate Employee Onboarding
            </button>
          ) : null}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Active Onboardings</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">{stats.total}</p>
          <p className="text-xs text-slate-500 mt-0.5">{stats.inProgress} in progress</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Completed Checklists</p>
          <p className="text-2xl font-extrabold text-emerald-600 mt-1">{stats.completed}</p>
          <p className="text-xs text-slate-500 mt-0.5">100% joining verified</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Average Readiness</p>
          <p className="text-2xl font-extrabold text-indigo-600 mt-1">{stats.avgProgress}%</p>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${stats.avgProgress}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Policy Sign-Offs</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">
            {visibleRecords.filter(r => r.policyAcknowledged).length} / {stats.total}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Code of Conduct signed</p>
        </div>
      </div>

      {/* Main Split View: Employee List + Detailed Checklist */}
      {visibleRecords.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center space-y-2">
          <p className="text-sm font-bold text-slate-800">No onboarding checklists initialized yet</p>
          <p className="text-xs text-slate-500">
            Click "+ Initiate Employee Onboarding" to create a structured joining &amp; document checklist.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: Onboarding Employees List */}
          <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-2xs">
            <div className="p-3.5 border-b border-slate-100 font-bold text-xs text-slate-800 uppercase tracking-wider">
              Onboarding Employees ({visibleRecords.length})
            </div>
            <div className="divide-y divide-slate-100">
              {visibleRecords.map(rec => {
                const isSelected = activeRecord?.id === rec.id;
                return (
                  <button
                    key={rec.id}
                    onClick={() => setSelectedRecordId(rec.id)}
                    className={`w-full p-4 text-left transition-colors cursor-pointer ${
                      isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-sm">{rec.employeeName}</span>
                      <span className="font-mono text-xs font-extrabold text-indigo-700">{rec.progress}%</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {rec.employeeCode} · {rec.department} · Joined {rec.joinDate}
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${rec.progress === 100 ? 'bg-emerald-500' : 'bg-indigo-600'}`}
                        style={{ width: `${rec.progress}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Active Onboarding Checklist Detail */}
          {activeRecord && (
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>{activeRecord.employeeCode}</span>
                      <span aria-hidden="true">·</span>
                      <span>{activeRecord.department}</span>
                      <span aria-hidden="true">·</span>
                      <span>Mentor: {activeRecord.mentorName || 'Assigned Manager'}</span>
                      <span aria-hidden="true">·</span>
                      <span>Probation Ends: {activeRecord.probationEndDate || 'N/A'}</span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">
                      {activeRecord.employeeName} — Onboarding Checklist ({activeRecord.progress}% Complete)
                    </h3>
                  </div>
                  {!isEmployeeMode && (
                    <button
                      onClick={() => setShowAddTaskModal(true)}
                      className="px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
                    >
                      + Add Task
                    </button>
                  )}
                </div>

                {/* Grouped Checklist Tasks */}
                <div className="space-y-2.5">
                  {activeRecord.tasks.map(task => (
                    <div
                      key={task.id}
                      className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                        task.completed
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : 'bg-slate-50/70 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={task.completed}
                          onChange={async () => {
                            const res = await toggleOnboardingTask(activeRecord.id, task.id);
                            if (!res.success && res.error) {
                              showBanner('error', res.error);
                            }
                          }}
                          className="mt-0.5 w-4 h-4 rounded text-indigo-600 cursor-pointer"
                        />
                        <div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500">
                            <span className="font-semibold text-indigo-600">{task.category}</span>
                            <span aria-hidden="true">·</span>
                            <span>Owner: {task.assignedToRole}</span>
                            {task.completedBy && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-700 font-medium">
                                  Verified by {task.completedBy}
                                </span>
                              </>
                            )}
                          </div>
                          <p className={`text-xs font-bold mt-0.5 ${task.completed ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                            {task.title}
                          </p>
                        </div>
                      </div>

                      {task.category === 'Required Document' && (
                        <button
                          type="button"
                          onClick={() => {
                            setUploadingForTask(task);
                            docFileInputRef.current?.click();
                          }}
                          className="px-3 py-1.5 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 rounded-lg text-xs font-semibold shrink-0 cursor-pointer"
                        >
                          📤 Upload Document
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Policy Acknowledgement Box */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase text-slate-800">
                      Company Policy &amp; Code of Conduct Digital Acknowledgement
                    </h4>
                    <span className="text-xs font-bold text-emerald-700">
                      {activeRecord.policyAcknowledged ? '✓ Digitally Signed' : 'Pending Sign-Off'}
                    </span>
                  </div>
                  {activeRecord.policyAcknowledged ? (
                    <p className="text-xs text-slate-600">
                      Signed by <strong>{activeRecord.policySignature}</strong> on{' '}
                      {activeRecord.policyAcknowledgedAt?.slice(0, 16).replace('T', ' ')}
                    </p>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                      <input
                        type="text"
                        placeholder={`Type full name (${activeRecord.employeeName}) to digitally sign...`}
                        value={signatureInput}
                        onChange={e => setSignatureInput(e.target.value)}
                        className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await acknowledgeOnboardingPolicy(
                            activeRecord.id,
                            signatureInput || activeRecord.employeeName
                          );
                          if (res.success) {
                            setSignatureInput('');
                            showBanner('success', 'Company policies digitally acknowledged.');
                          }
                        }}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                      >
                        Acknowledge &amp; Sign Policies
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL: INITIATE ONBOARDING */}
      {showInitiateModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleInitiate} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Initiate Employee Onboarding Checklist</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Select Employee</label>
                <select
                  required
                  value={initEmpId}
                  onChange={e => setInitEmpId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  <option value="">-- Choose Employee --</option>
                  {scopedEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.employeeId} · {emp.department})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Assigned Buddy / Mentor Name</label>
                <input
                  type="text"
                  placeholder="e.g. Department Lead / Senior Engineer"
                  value={mentorName}
                  onChange={e => setMentorName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Probation Completion Date</label>
                <input
                  type="date"
                  value={probationDate}
                  onChange={e => setProbationDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowInitiateModal(false)} className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">
                Create Checklist
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADD CUSTOM ONBOARDING TASK */}
      {showAddTaskModal && activeRecord && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={async e => {
              e.preventDefault();
              if (!newTaskForm.title.trim()) return;
              await addOnboardingTask(activeRecord.id, newTaskForm);
              setShowAddTaskModal(false);
              setNewTaskForm({ title: '', category: 'Joining Task', assignedToRole: 'Employee' });
              showBanner('success', 'Added custom onboarding task.');
            }}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4"
          >
            <h3 className="font-bold text-slate-900 text-base">Add Onboarding Task</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Task Title</label>
                <input
                  type="text"
                  required
                  value={newTaskForm.title}
                  onChange={e => setNewTaskForm({ ...newTaskForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Category</label>
                  <select
                    value={newTaskForm.category}
                    onChange={e => setNewTaskForm({ ...newTaskForm, category: e.target.value as any })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                  >
                    <option value="Joining Task">Joining Task</option>
                    <option value="Required Document">Required Document</option>
                    <option value="HR Task">HR Task</option>
                    <option value="Manager Task">Manager Task</option>
                    <option value="IT & Access">IT &amp; Access</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Assigned Role</label>
                  <select
                    value={newTaskForm.assignedToRole}
                    onChange={e => setNewTaskForm({ ...newTaskForm, assignedToRole: e.target.value as any })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                  >
                    <option value="Employee">Employee</option>
                    <option value="HR">HR</option>
                    <option value="Manager">Manager</option>
                    <option value="IT">IT</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddTaskModal(false)} className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">
                Add Task
              </button>
            </div>
          </form>
        </div>
      )}
        </>
      )}
    </div>
  );
}
