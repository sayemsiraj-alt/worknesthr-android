import React, { useState, useMemo } from 'react';
import {
  useData,
  CompanyAnnouncement,
  RecognitionBadgeType,
  EmployeeFeedbackItem,
  PulseSurveyQuestion,
} from '../context/DataContext';

type EngagementTab =
  | 'announcements'
  | 'celebrations'
  | 'recognition'
  | 'surveys'
  | 'feedback';

interface Props {
  mode?: 'admin' | 'manager' | 'employee';
}

const BADGE_META: Record<RecognitionBadgeType, { icon: string; color: string }> = {
  'Star Performer': { icon: '🌟', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  'Team Player': { icon: '🤝', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  'Innovation Champion': { icon: '💡', color: 'bg-violet-50 text-violet-800 border-violet-200' },
  'Customer Hero': { icon: '💎', color: 'bg-teal-50 text-teal-800 border-teal-200' },
  'Leadership Excellence': { icon: '👑', color: 'bg-rose-50 text-rose-800 border-rose-200' },
  'Punctuality Star': { icon: '⏱️', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  'Work Anniversary': { icon: '🎉', color: 'bg-purple-50 text-purple-800 border-purple-200' },
  'Birthday Wish': { icon: '🎂', color: 'bg-pink-50 text-pink-800 border-pink-200' },
};

export function EmployeeEngagement({ mode = 'admin' }: Props) {
  const {
    employees,
    allEmployees,
    departments,
    branches,
    getEmployeeBranch,
    currentUser,
    currentEmployee,
    isCurrentUserManager,
    companyAnnouncements,
    publishAnnouncement,
    acknowledgeAnnouncement,
    deleteAnnouncement,
    employeeRecognitions,
    giveRecognition,
    toggleRecognitionLike,
    deleteRecognition,
    employeeFeedbackList,
    submitEmployeeFeedback,
    respondToEmployeeFeedback,
    pulseSurveys,
    createPulseSurvey,
    submitPulseSurveyResponse,
    closePulseSurvey,
    deletePulseSurvey,
  } = useData();

  const isEmployeeMode = mode === 'employee' || Boolean(currentEmployee && !currentUser);
  const isManagerMode =
    mode === 'manager' ||
    currentUser?.role === 'Department Supervisor' ||
    Boolean(currentEmployee && isCurrentUserManager);
  const isAdminOrHR = Boolean(
    currentUser &&
      (currentUser.role === 'Super Admin' ||
        currentUser.role === 'HR Manager' ||
        currentUser.permissions?.engagement ||
        currentUser.permissions?.employees)
  );
  const canPublish = isAdminOrHR || isManagerMode;

  const actorKey =
    currentEmployee?.employeeId ||
    currentEmployee?.id ||
    currentUser?.id ||
    currentUser?.email ||
    'user';

  const rosterPool = allEmployees.length > 0 ? allEmployees : employees;

  const [activeTab, setActiveTab] = useState<EngagementTab>('announcements');
  const [toast, setToast] = useState<string | null>(null);
  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // Modals state
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [annForm, setAnnForm] = useState<{
    title: string;
    content: string;
    category: CompanyAnnouncement['category'];
    priority: CompanyAnnouncement['priority'];
    targetDepartment: string;
    targetBranch: string;
    isPinned: boolean;
  }>({
    title: '',
    content: '',
    category: 'General',
    priority: 'normal',
    targetDepartment: 'All',
    targetBranch: 'All',
    isPinned: false,
  });

  const [showRecognitionModal, setShowRecognitionModal] = useState(false);
  const [recogForm, setRecogForm] = useState<{
    recipientEmployeeId: string;
    badge: RecognitionBadgeType;
    coreValue: string;
    message: string;
  }>({
    recipientEmployeeId: rosterPool[0]?.employeeId || rosterPool[0]?.id || '',
    badge: 'Star Performer',
    coreValue: 'Operational Excellence',
    message: '',
  });

  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [surveyForm, setSurveyForm] = useState<{
    title: string;
    description: string;
    targetDepartment: string;
    targetBranch: string;
    isAnonymous: boolean;
    expiresAt: string;
    questions: PulseSurveyQuestion[];
  }>({
    title: '',
    description: '',
    targetDepartment: 'All',
    targetBranch: 'All',
    isAnonymous: true,
    expiresAt: '',
    questions: [
      {
        id: 'q1',
        questionText: 'How satisfied are you with team collaboration and work environment this month?',
        type: 'rating_1_5',
      },
      {
        id: 'q2',
        questionText: 'Do you feel you have the tools and support needed to succeed in your role?',
        type: 'yes_no',
      },
      {
        id: 'q3',
        questionText: 'What is one area we should improve across the organization?',
        type: 'open_text',
      },
    ],
  });

  // Survey response answers state: surveyId -> { questionId: answer }
  const [surveyDraftAnswers, setSurveyDraftAnswers] = useState<
    Record<string, Record<string, string | number>>
  >({});

  // Feedback form state
  const [feedbackForm, setFeedbackForm] = useState<{
    category: EmployeeFeedbackItem['category'];
    subject: string;
    message: string;
    isAnonymous: boolean;
    visibility: EmployeeFeedbackItem['visibility'];
  }>({
    category: 'Suggestion',
    subject: '',
    message: '',
    isAnonymous: false,
    visibility: 'hr_only',
  });
  const [adminReplyMap, setAdminReplyMap] = useState<Record<string, string>>({});

  // =========================================================================
  // 1. SCOPED ANNOUNCEMENTS
  // =========================================================================
  const visibleAnnouncements = useMemo(() => {
    return companyAnnouncements.filter((a) => {
      if (isEmployeeMode && currentEmployee) {
        const matchDept =
          !a.targetDepartment ||
          a.targetDepartment === 'All' ||
          a.targetDepartment.toLowerCase() === (currentEmployee.department || '').toLowerCase();
        const empBranch = getEmployeeBranch(currentEmployee);
        const matchBranch =
          !a.targetBranch ||
          a.targetBranch === 'All' ||
          a.targetBranch.toLowerCase() === empBranch.toLowerCase();
        return matchDept && matchBranch;
      }
      return true;
    });
  }, [companyAnnouncements, isEmployeeMode, currentEmployee, getEmployeeBranch]);

  // =========================================================================
  // 2. BIRTHDAYS & WORK ANNIVERSARIES ENGINE
  // =========================================================================
  const milestonesData = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const currentYear = now.getFullYear();

    const workAnniversaries: {
      emp: typeof rosterPool[0];
      years: number;
      joinDate: string;
      monthDay: string;
      isToday: boolean;
      isThisMonth: boolean;
    }[] = [];

    const birthdays: {
      emp: typeof rosterPool[0];
      dob: string;
      monthDay: string;
      isToday: boolean;
      isThisMonth: boolean;
    }[] = [];

    rosterPool
      .filter((e) => e.status !== 'inactive' && !e.accessTerminated)
      .forEach((emp) => {
        if (emp.joinDate && /^\d{4}-\d{2}-\d{2}$/.test(emp.joinDate.trim())) {
          const [jy, jm, jd] = emp.joinDate.trim().split('-').map(Number);
          const years = Math.max(0, currentYear - jy);
          const isToday = jm === currentMonth && jd === currentDay;
          const isThisMonth = jm === currentMonth;
          workAnniversaries.push({
            emp,
            years,
            joinDate: emp.joinDate,
            monthDay: `${String(jm).padStart(2, '0')}-${String(jd).padStart(2, '0')}`,
            isToday,
            isThisMonth,
          });
        }

        if (emp.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(emp.dateOfBirth.trim())) {
          const [, bm, bd] = emp.dateOfBirth.trim().split('-').map(Number);
          const isToday = bm === currentMonth && bd === currentDay;
          const isThisMonth = bm === currentMonth;
          birthdays.push({
            emp,
            dob: emp.dateOfBirth,
            monthDay: `${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}`,
            isToday,
            isThisMonth,
          });
        }
      });

    workAnniversaries.sort((a, b) => {
      if (a.isToday !== b.isToday) return a.isToday ? -1 : 1;
      if (a.isThisMonth !== b.isThisMonth) return a.isThisMonth ? -1 : 1;
      return b.years - a.years;
    });

    birthdays.sort((a, b) => {
      if (a.isToday !== b.isToday) return a.isToday ? -1 : 1;
      if (a.isThisMonth !== b.isThisMonth) return a.isThisMonth ? -1 : 1;
      return a.monthDay.localeCompare(b.monthDay);
    });

    return { workAnniversaries, birthdays };
  }, [rosterPool]);

  // =========================================================================
  // 3. VISIBLE PULSE SURVEYS
  // =========================================================================
  const visibleSurveys = useMemo(() => {
    return pulseSurveys.filter((s) => {
      if (isEmployeeMode && currentEmployee) {
        const matchDept =
          !s.targetDepartment ||
          s.targetDepartment === 'All' ||
          s.targetDepartment.toLowerCase() === (currentEmployee.department || '').toLowerCase();
        const empBranch = getEmployeeBranch(currentEmployee);
        const matchBranch =
          !s.targetBranch ||
          s.targetBranch === 'All' ||
          s.targetBranch.toLowerCase() === empBranch.toLowerCase();
        return matchDept && matchBranch;
      }
      return true;
    });
  }, [pulseSurveys, isEmployeeMode, currentEmployee, getEmployeeBranch]);

  // Handlers
  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annForm.title.trim() || !annForm.content.trim()) return;
    await publishAnnouncement(annForm);
    setShowAnnouncementModal(false);
    setAnnForm({
      title: '',
      content: '',
      category: 'General',
      priority: 'normal',
      targetDepartment: 'All',
      targetBranch: 'All',
      isPinned: false,
    });
    notify('Company announcement published & notifications dispatched!');
  };

  const handleGiveRecognition = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmp = rosterPool.find(
      (emp) => emp.employeeId === recogForm.recipientEmployeeId || emp.id === recogForm.recipientEmployeeId
    );
    if (!targetEmp || !recogForm.message.trim()) return;

    await giveRecognition({
      recipientEmployeeId: targetEmp.employeeId || targetEmp.id,
      recipientName: targetEmp.name,
      recipientDepartment: targetEmp.department || 'General',
      recipientDesignation: targetEmp.designation,
      badge: recogForm.badge,
      coreValue: recogForm.coreValue,
      message: recogForm.message.trim(),
    });
    setShowRecognitionModal(false);
    setRecogForm({
      recipientEmployeeId: rosterPool[0]?.employeeId || rosterPool[0]?.id || '',
      badge: 'Star Performer',
      coreValue: 'Operational Excellence',
      message: '',
    });
    notify(`Awarded ${recogForm.badge} recognition to ${targetEmp.name}!`);
  };

  const handleQuickMilestoneWish = async (
    emp: typeof rosterPool[0],
    badge: 'Work Anniversary' | 'Birthday Wish',
    defaultMsg: string
  ) => {
    await giveRecognition({
      recipientEmployeeId: emp.employeeId || emp.id,
      recipientName: emp.name,
      recipientDepartment: emp.department || 'General',
      recipientDesignation: emp.designation,
      badge,
      coreValue: 'People & Culture',
      message: defaultMsg,
    });
    notify(`Sent ${badge} celebration & notification to ${emp.name}!`);
  };

  const handleCreateSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!surveyForm.title.trim() || surveyForm.questions.length === 0) return;
    await createPulseSurvey({
      title: surveyForm.title.trim(),
      description: surveyForm.description.trim(),
      targetDepartment: surveyForm.targetDepartment,
      targetBranch: surveyForm.targetBranch,
      isAnonymous: surveyForm.isAnonymous,
      status: 'active',
      expiresAt: surveyForm.expiresAt || undefined,
      questions: surveyForm.questions.filter((q) => q.questionText.trim()),
    });
    setShowSurveyModal(false);
    notify(`Launched Pulse Survey "${surveyForm.title}"!`);
  };

  const handleSubmitSurveyAnswers = async (surveyId: string) => {
    const answers = surveyDraftAnswers[surveyId] || {};
    const res = await submitPulseSurveyResponse(surveyId, answers);
    if (res.success) {
      notify('Thank you! Your pulse survey response has been recorded.');
    } else if (res.error) {
      notify(res.error);
    }
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    const empId = currentEmployee?.employeeId || currentEmployee?.id || currentUser?.id || 'staff';
    const empName = currentEmployee?.name || currentUser?.name || 'Employee';
    const dept = currentEmployee?.department || 'General';

    const res = await submitEmployeeFeedback({
      employeeId: empId,
      employeeName: empName,
      department: dept,
      category: feedbackForm.category,
      subject: feedbackForm.subject,
      message: feedbackForm.message,
      isAnonymous: feedbackForm.isAnonymous,
      visibility: feedbackForm.visibility,
    });
    if (res.success) {
      setFeedbackForm({
        category: 'Suggestion',
        subject: '',
        message: '',
        isAnonymous: false,
        visibility: 'hr_only',
      });
      notify('Your feedback has been securely submitted.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center text-xl shadow-sm">
            🎉
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Employee Engagement, Culture &amp; Pulse Hub
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Company Announcements, Work Anniversaries &amp; Birthdays, Peer Recognition, Pulse Surveys &amp; Voice of Employee
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setRecogForm({
                recipientEmployeeId: rosterPool[0]?.employeeId || rosterPool[0]?.id || '',
                badge: 'Star Performer',
                coreValue: 'Operational Excellence',
                message: '',
              });
              setShowRecognitionModal(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
          >
            <span>🏆</span>
            <span>Give Recognition / Kudos</span>
          </button>

          {canPublish && (
            <>
              <button
                onClick={() => setShowAnnouncementModal(true)}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                <span>📢</span>
                <span>Post Announcement</span>
              </button>
              <button
                onClick={() => setShowSurveyModal(true)}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                <span>📊</span>
                <span>New Pulse Survey</span>
              </button>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="px-4 py-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-950 text-xs font-bold flex items-center justify-between">
          <span>✨ {toast}</span>
          <button onClick={() => setToast(null)} className="text-indigo-700 font-black">
            ✕
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Announcements
          </span>
          <span className="text-2xl font-black text-slate-900 mt-1 block">
            {visibleAnnouncements.length}
          </span>
          <span className="text-[11px] text-slate-500">Official notices</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
            Kudos &amp; Awards
          </span>
          <span className="text-2xl font-black text-amber-600 mt-1 block">
            {employeeRecognitions.length}
          </span>
          <span className="text-[11px] text-slate-500">Peer &amp; manager recognitions</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider block">
            Anniversaries &amp; Birthdays
          </span>
          <span className="text-2xl font-black text-purple-700 mt-1 block">
            {milestonesData.workAnniversaries.filter((x) => x.isThisMonth).length +
              milestonesData.birthdays.filter((x) => x.isThisMonth).length}
          </span>
          <span className="text-[11px] text-slate-500">Celebrations this month</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
            Active Pulse Surveys
          </span>
          <span className="text-2xl font-black text-indigo-700 mt-1 block">
            {visibleSurveys.filter((s) => s.status === 'active').length}
          </span>
          <span className="text-[11px] text-slate-500">
            {visibleSurveys.reduce((acc, s) => acc + s.responses.length, 0)} total responses
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] font-bold text-teal-600 uppercase tracking-wider block">
            Employee Feedback
          </span>
          <span className="text-2xl font-black text-teal-700 mt-1 block">
            {employeeFeedbackList.length}
          </span>
          <span className="text-[11px] text-slate-500">Permission-isolated</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white p-2 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-wrap gap-1.5">
        {[
          { id: 'announcements', label: 'Company Announcements', icon: '📢', count: visibleAnnouncements.length },
          {
            id: 'celebrations',
            label: 'Birthdays & Work Anniversaries',
            icon: '🎂',
            count: milestonesData.workAnniversaries.length,
          },
          { id: 'recognition', label: 'Recognition & Kudos Wall', icon: '🏆', count: employeeRecognitions.length },
          { id: 'surveys', label: 'Pulse Surveys & Results', icon: '📊', count: visibleSurveys.length },
          { id: 'feedback', label: 'Employee Feedback', icon: '💬', count: employeeFeedbackList.length },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as EngagementTab)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
              activeTab === t.id
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono ${
                activeTab === t.id ? 'bg-indigo-800 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: COMPANY ANNOUNCEMENTS                                              */}
      {/* ========================================================================= */}
      {activeTab === 'announcements' && (
        <div className="space-y-4">
          {visibleAnnouncements.length === 0 ? (
            <div className="bg-white rounded-3xl p-10 border border-slate-200 text-center space-y-2">
              <span className="text-3xl block">📢</span>
              <h3 className="text-sm font-black text-slate-800">No Company Announcements Yet</h3>
              <p className="text-xs text-slate-500">
                Official HR notices, policy updates, and holiday broadcasts will appear here.
              </p>
            </div>
          ) : (
            visibleAnnouncements.map((ann) => {
              const isAck = ann.acknowledgedBy.includes(actorKey);
              return (
                <div
                  key={ann.id}
                  className={`bg-white rounded-3xl p-5 sm:p-6 border shadow-xs space-y-3 ${
                    ann.priority === 'urgent'
                      ? 'border-rose-300 bg-rose-50/10'
                      : ann.isPinned
                      ? 'border-indigo-300'
                      : 'border-slate-200/80'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {ann.isPinned && (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-black uppercase">
                            📌 Pinned
                          </span>
                        )}
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            ann.priority === 'urgent'
                              ? 'bg-rose-100 text-rose-800'
                              : ann.priority === 'important'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {ann.category} • {ann.priority}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Target: {ann.targetDepartment} / {ann.targetBranch}
                        </span>
                      </div>
                      <h3 className="text-base font-black text-slate-900">{ann.title}</h3>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => acknowledgeAnnouncement(ann.id)}
                        disabled={isAck}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          isAck
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                      >
                        {isAck
                          ? `✓ Acknowledged (${ann.acknowledgedBy.length})`
                          : `Acknowledge Read (${ann.acknowledgedBy.length})`}
                      </button>
                      {isAdminOrHR && (
                        <button
                          onClick={() => deleteAnnouncement(ann.id)}
                          className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                    {ann.content}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100">
                    <span>
                      Posted by <strong className="text-slate-600">{ann.authorName}</strong> ({ann.authorRole})
                    </span>
                    <span>{new Date(ann.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: BIRTHDAYS & WORK ANNIVERSARIES                                     */}
      {/* ========================================================================= */}
      {activeTab === 'celebrations' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Work Anniversaries & Service Milestones */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4">
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center space-x-2">
                <span>🎉</span>
                <span>Work Anniversaries &amp; Service Tenure Milestones</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatically computed from employee joining dates
              </p>
            </div>

            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {milestonesData.workAnniversaries.map((item) => (
                <div
                  key={item.emp.id}
                  className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
                    item.isToday
                      ? 'bg-purple-50/70 border-purple-300'
                      : item.isThisMonth
                      ? 'bg-indigo-50/40 border-indigo-200'
                      : 'bg-slate-50/60 border-slate-200/80'
                  }`}
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-xs text-slate-900">{item.emp.name}</span>
                      {item.isToday && (
                        <span className="px-2 py-0.5 rounded-full bg-purple-600 text-white text-[9px] font-black uppercase">
                          🎉 Today!
                        </span>
                      )}
                      {!item.isToday && item.isThisMonth && (
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[9px] font-bold uppercase">
                          This Month
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {item.emp.designation} • {item.emp.department}
                    </p>
                    <p className="text-[10px] font-mono text-indigo-700 mt-0.5">
                      Joined: {item.joinDate} ({item.years > 0 ? `${item.years} Year${item.years > 1 ? 's' : ''} Tenure` : 'New Joiner Milestone'})
                    </p>
                  </div>

                  <button
                    onClick={() =>
                      handleQuickMilestoneWish(
                        item.emp,
                        'Work Anniversary',
                        item.years > 0
                          ? `Happy ${item.years}-Year Work Anniversary at WorkNest! Thank you for your dedication and impact.`
                          : `Welcome & congratulations on your milestone with ${item.emp.department}!`
                      )
                    }
                    className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold shrink-0 cursor-pointer"
                  >
                    🎉 Send Wish
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Birthdays & Team Celebrations */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4">
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center space-x-2">
                <span>🎂</span>
                <span>Employee Birthdays &amp; Celebrations</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Send birthday wishes and celebratory kudos to team members
              </p>
            </div>

            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {(milestonesData.birthdays.length > 0
                ? milestonesData.birthdays
                : rosterPool
                    .filter((e) => e.status !== 'inactive' && !e.accessTerminated)
                    .map((emp) => ({
                      emp,
                      dob: emp.dateOfBirth || 'Celebration Ready',
                      monthDay: '',
                      isToday: false,
                      isThisMonth: false,
                    }))
              ).map((item) => (
                <div
                  key={item.emp.id}
                  className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-bold text-xs text-slate-900">{item.emp.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {item.emp.designation} • {item.emp.department}
                    </p>
                    {item.emp.dateOfBirth && (
                      <p className="text-[10px] font-mono text-pink-600 mt-0.5">
                        DOB: {item.emp.dateOfBirth}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      handleQuickMilestoneWish(
                        item.emp,
                        'Birthday Wish',
                        `Wishing you a very Happy Birthday, ${item.emp.name}! Have a wonderful year ahead!`
                      )
                    }
                    className="px-3 py-1.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-[11px] font-bold shrink-0 cursor-pointer"
                  >
                    🎂 Send Birthday Wish
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: RECOGNITION & KUDOS WALL                                           */}
      {/* ========================================================================= */}
      {activeTab === 'recognition' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {employeeRecognitions.length === 0 ? (
            <div className="md:col-span-2 bg-white rounded-3xl p-10 border border-slate-200 text-center space-y-2">
              <span className="text-3xl block">🏆</span>
              <h3 className="text-sm font-black text-slate-800">No Recognitions Awarded Yet</h3>
              <p className="text-xs text-slate-500">
                Click &ldquo;Give Recognition / Kudos&rdquo; above to celebrate a colleague or team member!
              </p>
            </div>
          ) : (
            employeeRecognitions.map((rec) => {
              const meta = BADGE_META[rec.badge] || BADGE_META['Star Performer'];
              const hasLiked = rec.likes.includes(actorKey);
              return (
                <div
                  key={rec.id}
                  className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-3">
                        <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-2xl">
                          {meta.icon}
                        </div>
                        <div>
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${meta.color}`}
                          >
                            {rec.badge}
                          </span>
                          <h4 className="text-sm font-black text-slate-900 mt-1">{rec.recipientName}</h4>
                          <p className="text-[11px] text-slate-500">
                            {rec.recipientDesignation || 'Staff'} • {rec.recipientDepartment}
                          </p>
                        </div>
                      </div>
                      {isAdminOrHR && (
                        <button
                          onClick={() => deleteRecognition(rec.id)}
                          className="text-slate-300 hover:text-rose-600 text-xs font-bold cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-2xl border border-slate-100 italic">
                      &ldquo;{rec.message}&rdquo;
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                    <span>
                      Awarded by <strong className="text-slate-700">{rec.awardedByName}</strong> ({rec.awardedByRole})
                    </span>
                    <button
                      onClick={() => toggleRecognitionLike(rec.id)}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        hasLiked
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-slate-100 hover:bg-amber-50 text-slate-700'
                      }`}
                    >
                      👏 Applaud ({rec.likes.length})
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: PULSE SURVEYS & SURVEY RESULTS                                     */}
      {/* ========================================================================= */}
      {activeTab === 'surveys' && (
        <div className="space-y-5">
          {visibleSurveys.length === 0 ? (
            <div className="bg-white rounded-3xl p-10 border border-slate-200 text-center space-y-3">
              <span className="text-3xl block">📊</span>
              <h3 className="text-sm font-black text-slate-800">No Active Pulse Surveys</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Launch quick pulse surveys to measure employee satisfaction, workplace culture, and engagement.
              </p>
              {canPublish && (
                <button
                  onClick={() => setShowSurveyModal(true)}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer"
                >
                  + Launch Pulse Survey
                </button>
              )}
            </div>
          ) : (
            visibleSurveys.map((srv) => {
              const myResponse = srv.responses.find((r) => r.employeeId === actorKey);
              const draft = surveyDraftAnswers[srv.id] || {};

              return (
                <div
                  key={srv.id}
                  className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            srv.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {srv.status}
                        </span>
                        {srv.isAnonymous && (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                            🔒 Anonymous Responses
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400">
                          {srv.responses.length} Responses Recorded
                        </span>
                      </div>
                      <h3 className="text-base font-black text-slate-900 mt-1">{srv.title}</h3>
                      <p className="text-xs text-slate-500">{srv.description}</p>
                    </div>

                    {isAdminOrHR && (
                      <div className="flex items-center space-x-2">
                        {srv.status === 'active' && (
                          <button
                            onClick={() => closePulseSurvey(srv.id)}
                            className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold cursor-pointer"
                          >
                            Close Survey
                          </button>
                        )}
                        <button
                          onClick={() => deletePulseSurvey(srv.id)}
                          className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Participate Form (if not yet responded and survey is active) */}
                  {!myResponse && srv.status === 'active' && (
                    <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80 space-y-4">
                      <h4 className="text-xs font-black uppercase tracking-wider text-indigo-700">
                        Submit Your Response
                      </h4>
                      {srv.questions.map((q, idx) => (
                        <div key={q.id} className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-800 block">
                            {idx + 1}. {q.questionText}
                          </label>
                          {q.type === 'rating_1_5' ? (
                            <div className="flex items-center space-x-2">
                              {[1, 2, 3, 4, 5].map((num) => (
                                <button
                                  key={num}
                                  type="button"
                                  onClick={() =>
                                    setSurveyDraftAnswers({
                                      ...surveyDraftAnswers,
                                      [srv.id]: { ...draft, [q.id]: num },
                                    })
                                  }
                                  className={`w-9 h-9 rounded-xl font-black text-xs cursor-pointer transition-all ${
                                    draft[q.id] === num
                                      ? 'bg-indigo-600 text-white shadow-xs'
                                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-indigo-50'
                                  }`}
                                >
                                  {num}★
                                </button>
                              ))}
                            </div>
                          ) : q.type === 'yes_no' ? (
                            <div className="flex items-center space-x-2">
                              {['Yes', 'No'].map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() =>
                                    setSurveyDraftAnswers({
                                      ...surveyDraftAnswers,
                                      [srv.id]: { ...draft, [q.id]: opt },
                                    })
                                  }
                                  className={`px-4 py-1.5 rounded-xl font-bold text-xs cursor-pointer ${
                                    draft[q.id] === opt
                                      ? 'bg-indigo-600 text-white'
                                      : 'bg-white border border-slate-200 text-slate-700'
                                  }`}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={String(draft[q.id] || '')}
                              onChange={(e) =>
                                setSurveyDraftAnswers({
                                  ...surveyDraftAnswers,
                                  [srv.id]: { ...draft, [q.id]: e.target.value },
                                })
                              }
                              placeholder="Type your response..."
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                            />
                          )}
                        </div>
                      ))}

                      <button
                        onClick={() => handleSubmitSurveyAnswers(srv.id)}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                      >
                        Submit Survey Response
                      </button>
                    </div>
                  )}

                  {myResponse && (
                    <div className="px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                      ✓ You have completed this survey on {new Date(myResponse.submittedAt).toLocaleDateString()}.
                    </div>
                  )}

                  {/* Survey Results Summary */}
                  {srv.responses.length > 0 && (
                    <div className="space-y-3 pt-2">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">
                        Aggregated Survey Results ({srv.responses.length} Participants)
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {srv.questions.map((q) => {
                          const answers = srv.responses
                            .map((r) => r.answers?.[q.id])
                            .filter((v) => v !== undefined && v !== '');
                          if (q.type === 'rating_1_5') {
                            const nums = answers.map(Number).filter((n) => !isNaN(n));
                            const avg =
                              nums.length > 0
                                ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)
                                : '0.0';
                            return (
                              <div key={q.id} className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50">
                                <p className="text-xs font-bold text-slate-800">{q.questionText}</p>
                                <div className="flex items-center space-x-2 mt-2">
                                  <span className="text-lg font-black text-indigo-700">{avg} / 5.0 ★</span>
                                  <span className="text-[11px] text-slate-400">({nums.length} ratings)</span>
                                </div>
                              </div>
                            );
                          }
                          if (q.type === 'yes_no') {
                            const yesCount = answers.filter((a) => String(a).toLowerCase() === 'yes').length;
                            const pct = answers.length > 0 ? Math.round((yesCount / answers.length) * 100) : 0;
                            return (
                              <div key={q.id} className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50">
                                <p className="text-xs font-bold text-slate-800">{q.questionText}</p>
                                <div className="flex items-center space-x-2 mt-2">
                                  <span className="text-sm font-black text-emerald-700">{pct}% Yes</span>
                                  <span className="text-[11px] text-slate-400">
                                    ({yesCount} of {answers.length})
                                  </span>
                                </div>
                              </div>
                            );
                          }
                          // Open text responses: strictly visible to HR/Admin/Managers
                          if (!canPublish) {
                            return (
                              <div key={q.id} className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50">
                                <p className="text-xs font-bold text-slate-800">{q.questionText}</p>
                                <p className="text-[11px] text-slate-500 mt-1">
                                  🔒 {answers.length} text responses collected (visible to HR/Management)
                                </p>
                              </div>
                            );
                          }
                          return (
                            <div key={q.id} className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                              <p className="text-xs font-bold text-slate-800">{q.questionText}</p>
                              <div className="space-y-1 max-h-28 overflow-y-auto">
                                {answers.map((ans, i) => (
                                  <p key={i} className="text-[11px] text-slate-600 bg-white px-2.5 py-1 rounded-lg border border-slate-100">
                                    &ldquo;{String(ans)}&rdquo;
                                  </p>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: EMPLOYEE FEEDBACK (PERMISSION-CONTROLLED VOICE OF EMPLOYEE)        */}
      {/* ========================================================================= */}
      {activeTab === 'feedback' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Submit Feedback Form */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4 h-fit">
            <div>
              <h3 className="text-base font-black text-slate-900">Submit Employee Feedback</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Share suggestions, workplace improvements, or confidential concerns directly with HR
              </p>
            </div>
            <form onSubmit={handleSubmitFeedback} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Category</label>
                <select
                  value={feedbackForm.category}
                  onChange={(e) =>
                    setFeedbackForm({
                      ...feedbackForm,
                      category: e.target.value as EmployeeFeedbackItem['category'],
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                >
                  <option value="Suggestion">Suggestion</option>
                  <option value="Workplace Improvement">Workplace Improvement</option>
                  <option value="Management & Culture">Management &amp; Culture</option>
                  <option value="Wellbeing & Benefits">Wellbeing &amp; Benefits</option>
                  <option value="Grievance / Concern">Grievance / Concern</option>
                  <option value="Appreciation">Appreciation</option>
                </select>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Visibility Level</label>
                <select
                  value={feedbackForm.visibility}
                  onChange={(e) =>
                    setFeedbackForm({
                      ...feedbackForm,
                      visibility: e.target.value as EmployeeFeedbackItem['visibility'],
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                >
                  <option value="hr_only">Strictly HR Confidential (HR &amp; Super Admin Only)</option>
                  <option value="management">HR &amp; Department Management</option>
                </select>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Subject *</label>
                <input
                  type="text"
                  required
                  value={feedbackForm.subject}
                  onChange={(e) => setFeedbackForm({ ...feedbackForm, subject: e.target.value })}
                  placeholder="Brief summary..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Feedback Details *</label>
                <textarea
                  rows={4}
                  required
                  value={feedbackForm.message}
                  onChange={(e) => setFeedbackForm({ ...feedbackForm, message: e.target.value })}
                  placeholder="Describe your suggestion or feedback..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={feedbackForm.isAnonymous}
                  onChange={(e) => setFeedbackForm({ ...feedbackForm, isAnonymous: e.target.checked })}
                  className="rounded text-indigo-600"
                />
                <span className="font-semibold text-slate-700">
                  Submit Anonymously (Mask my name from reviewers)
                </span>
              </label>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
              >
                Submit Feedback
              </button>
            </form>
          </div>

          {/* Feedback List (Scoped by RBAC) */}
          <div className="lg:col-span-2 bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">
                {isEmployeeMode ? 'My Submitted Feedback & HR Responses' : 'Employee Feedback & Resolution Queue'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isEmployeeMode
                  ? 'Only you and authorized HR can view your private feedback submissions.'
                  : 'Review and respond to employee feedback. Anonymous submissions hide the employee identity.'}
              </p>
            </div>

            {employeeFeedbackList.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                No feedback records found for your permission scope.
              </div>
            ) : (
              <div className="space-y-3">
                {employeeFeedbackList.map((fb) => {
                  const displayAuthor = fb.isAnonymous ? '🔒 Anonymous Employee' : fb.employeeName;
                  return (
                    <div key={fb.id} className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                            {fb.category}
                          </span>
                          <span className="text-[11px] font-bold text-slate-700">
                            {displayAuthor} ({fb.department})
                          </span>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            fb.status === 'actioned'
                              ? 'bg-emerald-100 text-emerald-800'
                              : fb.status === 'under_review'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {fb.status.replace('_', ' ')}
                        </span>
                      </div>

                      <h4 className="text-sm font-black text-slate-900">{fb.subject}</h4>
                      <p className="text-xs text-slate-700 whitespace-pre-line">{fb.message}</p>

                      {fb.adminResponse && (
                        <div className="bg-emerald-50/80 border border-emerald-200 p-3 rounded-xl text-xs text-emerald-950">
                          <strong>HR Response ({fb.respondedBy}):</strong> {fb.adminResponse}
                        </div>
                      )}

                      {isAdminOrHR && (
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/60">
                          <input
                            type="text"
                            value={adminReplyMap[fb.id] ?? fb.adminResponse ?? ''}
                            onChange={(e) =>
                              setAdminReplyMap({ ...adminReplyMap, [fb.id]: e.target.value })
                            }
                            placeholder="Write official HR response..."
                            className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs"
                          />
                          <button
                            onClick={() =>
                              respondToEmployeeFeedback(
                                fb.id,
                                'under_review',
                                adminReplyMap[fb.id] ?? fb.adminResponse ?? ''
                              )
                            }
                            className="px-2.5 py-1.5 rounded-xl bg-amber-100 text-amber-800 text-[11px] font-bold cursor-pointer"
                          >
                            Under Review
                          </button>
                          <button
                            onClick={() =>
                              respondToEmployeeFeedback(
                                fb.id,
                                'actioned',
                                adminReplyMap[fb.id] ?? fb.adminResponse ?? ''
                              )
                            }
                            className="px-2.5 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                          >
                            Save &amp; Mark Actioned
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PUBLISH ANNOUNCEMENT                                               */}
      {/* ========================================================================= */}
      {showAnnouncementModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">Publish Company Announcement</h3>
              <button
                onClick={() => setShowAnnouncementModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handlePublishAnnouncement} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={annForm.title}
                  onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })}
                  placeholder="e.g. Quarterly Townhall & Updated Leave Guidelines"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Category</label>
                  <select
                    value={annForm.category}
                    onChange={(e) =>
                      setAnnForm({ ...annForm, category: e.target.value as CompanyAnnouncement['category'] })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    <option value="General">General</option>
                    <option value="Policy Update">Policy Update</option>
                    <option value="Holiday / Event">Holiday / Event</option>
                    <option value="HR Notice">HR Notice</option>
                    <option value="Celebration">Celebration</option>
                    <option value="Urgent Alert">Urgent Alert</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Priority</label>
                  <select
                    value={annForm.priority}
                    onChange={(e) =>
                      setAnnForm({ ...annForm, priority: e.target.value as CompanyAnnouncement['priority'] })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    <option value="normal">Normal</option>
                    <option value="important">Important</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Target Department</label>
                  <select
                    value={annForm.targetDepartment}
                    onChange={(e) => setAnnForm({ ...annForm, targetDepartment: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    <option value="All">All Departments</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Target Branch</label>
                  <select
                    value={annForm.targetBranch}
                    onChange={(e) => setAnnForm({ ...annForm, targetBranch: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    <option value="All">All Branches</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Announcement Content *</label>
                <textarea
                  rows={4}
                  required
                  value={annForm.content}
                  onChange={(e) => setAnnForm({ ...annForm, content: e.target.value })}
                  placeholder="Write full announcement details..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={annForm.isPinned}
                  onChange={(e) => setAnnForm({ ...annForm, isPinned: e.target.checked })}
                  className="rounded text-indigo-600"
                />
                <span className="font-semibold text-slate-700">Pin to top of Announcements</span>
              </label>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAnnouncementModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold cursor-pointer"
                >
                  Publish &amp; Notify Staff
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: GIVE RECOGNITION / KUDOS                                           */}
      {/* ========================================================================= */}
      {showRecognitionModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">Award Employee Recognition &amp; Kudos</h3>
              <button
                onClick={() => setShowRecognitionModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleGiveRecognition} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Select Colleague / Employee *</label>
                <select
                  value={recogForm.recipientEmployeeId}
                  onChange={(e) => setRecogForm({ ...recogForm, recipientEmployeeId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                >
                  {rosterPool.map((emp) => (
                    <option key={emp.id} value={emp.employeeId || emp.id}>
                      {emp.name} ({emp.designation} - {emp.department})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Recognition Badge *</label>
                  <select
                    value={recogForm.badge}
                    onChange={(e) =>
                      setRecogForm({ ...recogForm, badge: e.target.value as RecognitionBadgeType })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  >
                    {Object.keys(BADGE_META).map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Core Value</label>
                  <input
                    type="text"
                    value={recogForm.coreValue}
                    onChange={(e) => setRecogForm({ ...recogForm, coreValue: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Appreciation Message *</label>
                <textarea
                  rows={3}
                  required
                  value={recogForm.message}
                  onChange={(e) => setRecogForm({ ...recogForm, message: e.target.value })}
                  placeholder="Share why this team member deserves recognition..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRecognitionModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold cursor-pointer"
                >
                  🏆 Publish Recognition
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREATE PULSE SURVEY                                                */}
      {/* ========================================================================= */}
      {showSurveyModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">Launch New Pulse Survey</h3>
              <button
                onClick={() => setShowSurveyModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateSurvey} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Survey Title *</label>
                <input
                  type="text"
                  required
                  value={surveyForm.title}
                  onChange={(e) => setSurveyForm({ ...surveyForm, title: e.target.value })}
                  placeholder="e.g. Monthly Employee Pulse & Workplace Satisfaction"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Description</label>
                <input
                  type="text"
                  value={surveyForm.description}
                  onChange={(e) => setSurveyForm({ ...surveyForm, description: e.target.value })}
                  placeholder="Quick 3-question check-in on team morale and resources"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-700">Questions ({surveyForm.questions.length})</label>
                  <button
                    type="button"
                    onClick={() =>
                      setSurveyForm({
                        ...surveyForm,
                        questions: [
                          ...surveyForm.questions,
                          {
                            id: `q_${Date.now()}`,
                            questionText: '',
                            type: 'rating_1_5',
                          },
                        ],
                      })
                    }
                    className="text-indigo-600 font-bold cursor-pointer"
                  >
                    + Add Question
                  </button>
                </div>
                {surveyForm.questions.map((q, idx) => (
                  <div key={q.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      required
                      value={q.questionText}
                      onChange={(e) => {
                        const next = [...surveyForm.questions];
                        next[idx] = { ...q, questionText: e.target.value };
                        setSurveyForm({ ...surveyForm, questions: next });
                      }}
                      placeholder={`Question ${idx + 1}`}
                      className="flex-1 px-3 py-1.5 border border-slate-200 rounded-xl"
                    />
                    <select
                      value={q.type}
                      onChange={(e) => {
                        const next = [...surveyForm.questions];
                        next[idx] = { ...q, type: e.target.value as PulseSurveyQuestion['type'] };
                        setSurveyForm({ ...surveyForm, questions: next });
                      }}
                      className="px-2.5 py-1.5 border border-slate-200 rounded-xl"
                    >
                      <option value="rating_1_5">1-5 Rating</option>
                      <option value="yes_no">Yes / No</option>
                      <option value="open_text">Open Text</option>
                    </select>
                  </div>
                ))}
              </div>
              <label className="flex items-center space-x-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={surveyForm.isAnonymous}
                  onChange={(e) => setSurveyForm({ ...surveyForm, isAnonymous: e.target.checked })}
                  className="rounded text-indigo-600"
                />
                <span className="font-semibold text-slate-700">Keep survey responses anonymous</span>
              </label>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSurveyModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold cursor-pointer"
                >
                  Launch Pulse Survey
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
