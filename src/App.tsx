import { useState, useEffect, useRef } from 'react';
import { useData, DataProvider } from './context/DataContext';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { TenantProvider, useTenant } from './context/TenantContext';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Dashboard } from './components/Dashboard';
import { EmployeeManagement } from './components/EmployeeManagement';
import { Department } from './components/Department';
import { BranchManagement } from './components/BranchManagement';
import { ShiftManagement } from './components/ShiftManagement';
import { RosterDuty } from './components/RosterDuty';
import { Attendance } from './components/Attendance';
import { LeaveManagement } from './components/LeaveManagement';
import { Payroll } from './components/Payroll';
import { Recruitment } from './components/Recruitment';
import { Reports } from './components/Reports';
import { Messaging } from './components/Messaging';
import { MyProfile } from './components/MyProfile';
import { Notifications } from './components/Notifications';
import { AccountSettings } from './components/AccountSettings';
import { ZKTecoIntegration } from './components/ZKTecoIntegration';
import { EmployeePanel } from './components/EmployeePanel';
import { SubscriptionExpiredScreen } from './components/SubscriptionExpiredScreen';
import { SuperAdminTenants } from './components/SuperAdminTenants';
import { AIReportAssistant } from './components/AIReportAssistant';
import { DocumentManagement } from './components/DocumentManagement';
import { ExpenseManagement } from './components/ExpenseManagement';
import { OnboardingManagement } from './components/OnboardingManagement';
import { WorkforcePlanning } from './components/WorkforcePlanning';
import { EmployeeEngagement } from './components/EmployeeEngagement';
import { HRAnalyticsDashboard } from './components/HRAnalyticsDashboard';
import { EnterpriseSecurityCenter } from './components/EnterpriseSecurityCenter';
import { IconDashboard, IconAttendance, IconUsers, IconWallet, IconMenu } from './components/Icons';

export type Page =
  | 'dashboard'
  | 'ai_assistant'
  | 'enterprise_security'
  | 'workforce_planning'
  | 'engagement'
  | 'analytics'
  | 'employee'
  | 'department'
  | 'branches'
  | 'shift'
  | 'roster'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'expenses'
  | 'onboarding'
  | 'recruitment'
  | 'documents'
  | 'reports'
  | 'messaging'
  | 'profile'
  | 'notifications'
  | 'settings'
  | 'zkteco'
  | 'tenants';

function AppContent() {
  const { currentUser, currentEmployee } = useData();
  const { t } = useSettings();
  const {
    isSubscriptionActive,
    isSuperAdmin,
    isViewingCustomerTenant,
    currentCompany,
    resetToOwnerCompany
  } = useTenant();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return true;
  });

  // Automatically handle viewport resize for sidebar
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024 && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarOpen]);

  const isPageAuthorized = (page: Page): boolean => {
    if (!currentUser) return false;
    const isMasterOwner = currentUser?.email?.toLowerCase().trim() === 'sayemsiraj@gmail.com';
    if (page === 'tenants') {
      return isMasterOwner;
    }
    if (currentUser.role === 'Super Admin' || isSuperAdmin) return true;
    const p = currentUser.permissions;
    if (!p) return false;
    switch (page) {
      case 'dashboard': return p.dashboard !== false;
      case 'enterprise_security': return Boolean(p.enterpriseSecurity) || Boolean(p.auditLogs) || Boolean(p.settings);
      case 'workforce_planning': return p.workforcePlanning !== false && (Boolean(p.workforcePlanning) || Boolean(p.departments) || Boolean(p.employees) || Boolean(p.recruitment));
      case 'engagement': return p.engagement !== false && (Boolean(p.engagement) || Boolean(p.employees) || Boolean(p.mss) || Boolean(p.dashboard));
      case 'analytics': return p.analytics !== false && (Boolean(p.analytics) || Boolean(p.reports) || Boolean(p.dashboard));
      case 'employee': return Boolean(p.employees);
      case 'department':
      case 'branches': return Boolean(p.departments);
      case 'shift': return Boolean(p.shifts);
      case 'roster': return Boolean(p.roster);
      case 'attendance': return Boolean(p.attendance);
      case 'leave': return Boolean(p.leave);
      case 'payroll': return Boolean(p.payroll);
      case 'expenses': return p.expenses !== false && (Boolean(p.expenses) || Boolean(p.payroll));
      case 'onboarding': return (p.onboarding !== false && p.offboarding !== false) && (Boolean(p.onboarding) || Boolean(p.offboarding) || Boolean(p.employees));
      case 'recruitment': return Boolean(p.recruitment);
      case 'documents': return p.documents !== false && (Boolean(p.documents) || Boolean(p.employees));
      case 'reports':
      case 'ai_assistant': return Boolean(p.reports);
      case 'zkteco': return Boolean(p.biometric);
      case 'settings': return Boolean(p.settings);
      default: return true;
    }
  };

  const handleNavigate = (page: Page) => {
    if (!isPageAuthorized(page)) {
      setCurrentPage('dashboard');
      return;
    }
    setCurrentPage(page);
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  // Check if an employee link was opened (?portal=employee, ?mode=employee, or #employee)
  const isEmployeeLink = typeof window !== 'undefined' && (
    window.location.search.toLowerCase().includes('portal=employee') ||
    window.location.search.toLowerCase().includes('mode=employee') ||
    window.location.hash.toLowerCase().includes('employee')
  );

  // If an employee is logged in, show Employee Portal directly (blocks any direct URL attempt to access Admin routes)
  if (currentEmployee) {
    return <EmployeePanel />;
  }

  // If an employee link was accessed and no employee is logged in, show Employee login directly
  if (isEmployeeLink) {
    return <Login initialMode="employee" />;
  }

  // If neither admin nor employee is logged in, show Login
  if (!currentUser) {
    return <Login />;
  }

  // If customer company subscription is inactive/expired/suspended, block access to main HR and display status screen
  if (!isSubscriptionActive && !isSuperAdmin) {
    return <SubscriptionExpiredScreen />;
  }

  const pageTitles: Record<Page, string> = {
    dashboard: 'Dashboard',
    ai_assistant: 'Smart AI HR Assistant & Report Studio',
    enterprise_security: 'Enterprise Security, RBAC, MFA & Audit Logs',
    workforce_planning: 'Workforce Planning & Org Chart',
    engagement: 'Employee Engagement & Pulse Surveys',
    analytics: 'Advanced HR Analytics & Executive Intelligence',
    employee: 'Employee Management',
    department: 'Departments',
    branches: 'Head Office & Branch Offices',
    shift: 'Shift Management',
    roster: 'Roster & Duty',
    attendance: 'Attendance & Timesheets',
    leave: 'Leave Requests',
    payroll: 'Payroll & Salaries',
    expenses: 'Expense & Reimbursement Management',
    onboarding: 'Onboarding & Offboarding Management',
    recruitment: 'Recruitment',
    documents: 'Employee Document & Policy Management',
    reports: 'Reports & Analytics',
    messaging: 'Team Messaging',
    profile: 'My Profile',
    notifications: 'Notifications',
    settings: 'System Settings',
    zkteco: 'Biometric Integration',
    tenants: 'Tenant & Subscription Management',
  };

  const renderPage = () => {
    if (!isPageAuthorized(currentPage)) {
      return <Dashboard onNavigate={handleNavigate} />;
    }
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={handleNavigate} />;
      case 'ai_assistant':
        return <AIReportAssistant onNavigate={handleNavigate} />;
      case 'enterprise_security':
        return <EnterpriseSecurityCenter />;
      case 'workforce_planning':
        return <WorkforcePlanning />;
      case 'engagement':
        return <EmployeeEngagement mode={currentUser.role === 'Department Supervisor' ? 'manager' : 'admin'} />;
      case 'analytics':
        return <HRAnalyticsDashboard />;
      case 'employee':
        return <EmployeeManagement />;
      case 'department':
        return <Department />;
      case 'branches':
        return <BranchManagement onNavigate={handleNavigate} />;
      case 'shift':
        return <ShiftManagement />;
      case 'roster':
        return <RosterDuty />;
      case 'attendance':
        return <Attendance />;
      case 'leave':
        return <LeaveManagement />;
      case 'payroll':
        return <Payroll />;
      case 'expenses':
        return <ExpenseManagement mode={currentUser.role === 'Department Supervisor' ? 'manager' : 'admin'} />;
      case 'onboarding':
        return <OnboardingManagement mode={currentUser.role === 'Department Supervisor' ? 'manager' : 'admin'} />;
      case 'recruitment':
        return <Recruitment />;
      case 'documents':
        return <DocumentManagement mode="admin" />;
      case 'reports':
        return <Reports />;
      case 'messaging':
        return <Messaging />;
      case 'profile':
        return <MyProfile />;
      case 'notifications':
        return <Notifications />;
      case 'settings':
        return <AccountSettings />;
      case 'zkteco':
        return <ZKTecoIntegration />;
      case 'tenants':
        return currentUser?.email?.toLowerCase().trim() === 'sayemsiraj@gmail.com' ? <SuperAdminTenants /> : <Dashboard onNavigate={handleNavigate} />;
      default:
        return <Dashboard onNavigate={handleNavigate} />;
    }
  };

  return (
    <div className="h-screen h-[100dvh] w-full max-w-[100vw] overflow-hidden bg-mesh-light flex flex-row text-slate-800 antialiased selection:bg-indigo-500 selection:text-white relative">
      {/* Exclusive subtle ambient glow layer */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden print:hidden">
        <div className="absolute -top-40 right-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl"></div>
        <div className="absolute top-1/3 -right-20 w-80 h-80 bg-violet-500/4 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 left-1/3 w-80 h-80 bg-teal-500/4 rounded-full blur-3xl"></div>
      </div>

      {/* Responsive Sidebar (Slide-out drawer on mobile, fixed full-height with isolated scroll on desktop) */}
      <div className="print:hidden lg:h-screen lg:sticky lg:top-0 lg:flex-shrink-0">
        <Sidebar
          currentPage={currentPage}
          onNavigate={handleNavigate}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>

      {/* Main Right Area - Isolated vertical scroll container on both mobile APK and desktop */}
      <div
        ref={mainScrollRef}
        className="flex-1 min-w-0 max-w-full h-full overflow-y-auto overflow-x-hidden relative print:min-h-0 print:h-auto print:p-0 print:m-0 print:block overscroll-y-contain"
      >
        {/* Super Admin viewing customer tenant banner */}
        {isViewingCustomerTenant && (
          <div className="bg-amber-500 text-slate-950 px-3 sm:px-4 py-2 text-xs font-bold flex flex-wrap items-center justify-between gap-2 shadow-xs sticky top-0 z-30 print:hidden">
            <div className="flex items-center space-x-2 min-w-0">
              <span className="px-1.5 py-0.5 rounded bg-slate-950 text-amber-300 uppercase text-[10px] font-black shrink-0">
                SUPER ADMIN
              </span>
              <span className="truncate">
                Viewing: <strong>{currentCompany?.name}</strong> ({currentCompany?.id})
              </span>
            </div>
            <button
              onClick={resetToOwnerCompany}
              className="px-2.5 py-1 rounded bg-slate-950 text-white hover:bg-slate-900 text-xs font-semibold cursor-pointer transition-all shrink-0"
            >
              Return to Master
            </button>
          </div>
        )}

        <div className="print:hidden sticky top-0 z-30 shrink-0">
          <TopBar
            onMenuClick={() => setSidebarOpen(!sidebarOpen)}
            currentPageTitle={t(pageTitles[currentPage] || 'WorkNest HR')}
            onNavigate={handleNavigate}
          />
        </div>

        {/* Main Content Area - Full-page natural flow without inner clipping */}
        <main className="w-full max-w-[1600px] mx-auto p-3 sm:p-5 md:p-6 pb-24 lg:pb-6 print:p-0 print:m-0 print:max-w-none print:w-full print:pb-0">
          {renderPage()}
        </main>

        {/* Floating Messaging-Style Quick Launcher to AI Report Bot */}
        {currentPage !== 'ai_assistant' && (
          <button
            type="button"
            onClick={() => handleNavigate('ai_assistant')}
            className="fixed bottom-20 lg:bottom-6 right-5 sm:right-6 z-40 w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-500 hover:from-indigo-700 hover:to-purple-600 text-white shadow-lg shadow-indigo-600/35 border border-white/25 flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer print:hidden"
            title="AI Report Bot"
            aria-label="Open AI Report Bot"
          >
            <svg
              className="w-5 h-5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <line x1="8" y1="9" x2="16" y2="9" />
              <line x1="8" y1="13" x2="13" y2="13" />
            </svg>
            <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 bg-emerald-400 border-2 border-white rounded-full"></span>
          </button>
        )}
      </div>

      {/* ========================================================================= */}
      {/* PERMANENTLY FIXED MOBILE/APK BOTTOM NAVIGATION BAR (Sits below z-50 modals) */}
      {/* ========================================================================= */}
      <nav
        aria-label="Mobile Navigation"
        style={{ transform: 'translate3d(0, 0, 0)' }}
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] flex items-center justify-around print:hidden select-none"
      >
        <button
          onClick={() => handleNavigate('dashboard')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
            currentPage === 'dashboard' ? 'text-indigo-600 font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className={`p-1 rounded-lg ${currentPage === 'dashboard' ? 'bg-indigo-50' : ''}`}>
            <IconDashboard size={19} />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Home</span>
        </button>

        <button
          onClick={() => handleNavigate('attendance')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
            currentPage === 'attendance' ? 'text-indigo-600 font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className={`p-1 rounded-lg ${currentPage === 'attendance' ? 'bg-indigo-50' : ''}`}>
            <IconAttendance size={19} />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Attendance</span>
        </button>

        <button
          onClick={() => handleNavigate('employee')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
            currentPage === 'employee' ? 'text-indigo-600 font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className={`p-1 rounded-lg ${currentPage === 'employee' ? 'bg-indigo-50' : ''}`}>
            <IconUsers size={19} />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Staff</span>
        </button>

        <button
          onClick={() => handleNavigate('payroll')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
            currentPage === 'payroll' ? 'text-indigo-600 font-bold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className={`p-1 rounded-lg ${currentPage === 'payroll' ? 'bg-indigo-50' : ''}`}>
            <IconWallet size={19} />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Payroll</span>
        </button>

        <button
          onClick={() => setSidebarOpen(true)}
          className="flex flex-col items-center justify-center py-1 px-2.5 rounded-xl text-slate-500 hover:text-slate-800 transition-all cursor-pointer"
        >
          <div className="p-1 rounded-lg hover:bg-slate-100">
            <IconMenu size={19} />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Menu</span>
        </button>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <TenantProvider>
        <DataProvider>
          <AppContent />
        </DataProvider>
      </TenantProvider>
    </SettingsProvider>
  );
}
