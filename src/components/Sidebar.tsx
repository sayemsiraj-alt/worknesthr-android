import { Page } from '../App';
import { useData } from '../context/DataContext';
import { useTenant } from '../context/TenantContext';
import { useSettings } from '../context/SettingsContext';
import {
  IconDashboard, IconUsers, IconBuilding, IconShift, IconRoster,
  IconAttendance, IconLeave, IconWallet, IconUserPlus, IconFingerprint,
  IconTrending, IconLogout, IconFlame, IconChevronLeft, IconSettings,
  IconSparkles, IconShield, IconCheckCircle, IconFileText, IconAward, IconActivity,
} from './Icons';

type Props = {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  isOpen: boolean;
  onToggle: () => void;
};

const menuItems: { id: Page; label: string; Icon: any; group: string; badge?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard, group: 'Overview' },
  { id: 'analytics', label: 'HR Analytics', Icon: IconActivity, group: 'Overview' },
  { id: 'ai_assistant', label: 'AI Report Bot', Icon: IconSparkles, group: 'Overview' },
  { id: 'branches', label: 'Branch Offices', Icon: IconBuilding, group: 'Overview' },
  { id: 'employee', label: 'Employees', Icon: IconUsers, group: 'People' },
  { id: 'workforce_planning', label: 'Workforce Planning', Icon: IconBuilding, group: 'People' },
  { id: 'engagement', label: 'Engagement & Surveys', Icon: IconAward, group: 'People' },
  { id: 'department', label: 'Departments', Icon: IconBuilding, group: 'People' },
  { id: 'shift', label: 'Shifts', Icon: IconShift, group: 'People' },
  { id: 'roster', label: 'Roster', Icon: IconRoster, group: 'People' },
  { id: 'recruitment', label: 'Recruitment', Icon: IconUserPlus, group: 'People' },
  { id: 'onboarding', label: 'Onboarding & Exit', Icon: IconUserPlus, group: 'People' },
  { id: 'attendance', label: 'Attendance', Icon: IconAttendance, group: 'Operations' },
  { id: 'leave', label: 'Leave', Icon: IconLeave, group: 'Operations' },
  { id: 'documents', label: 'HR Documents', Icon: IconFileText, group: 'Enterprise Governance' },
  { id: 'enterprise_security', label: 'Enterprise Security', Icon: IconShield, group: 'Enterprise Governance', badge: 'SEC' },
  { id: 'zkteco', label: 'Biometric', Icon: IconFingerprint, group: 'Integrations' },
  { id: 'payroll', label: 'Payroll', Icon: IconWallet, group: 'Finance' },
  { id: 'expenses', label: 'Expense Claims', Icon: IconWallet, group: 'Finance' },
  { id: 'reports', label: 'Reports', Icon: IconTrending, group: 'Finance' },
  { id: 'settings', label: 'Settings', Icon: IconSettings, group: 'System' },
];

export function Sidebar({ currentPage, onNavigate, isOpen, onToggle }: Props) {
  const { currentUser, logout } = useData();
  const { isSuperAdmin, currentCompany, isViewingCustomerTenant, resetToOwnerCompany } = useTenant();
  const { t } = useSettings();
  const companyLogo = currentCompany?.profile?.logo || (typeof window !== 'undefined' ? localStorage.getItem('worknest_company_logo') : null);

  const handleMobileNavigate = (page: Page) => {
    onNavigate(page);
    if (onToggle) {
      onToggle();
    }
  };

  const allowedMenuItems = menuItems.filter(item => {
    if (!currentUser?.permissions || currentUser.role === 'Super Admin') return true;
    const p = currentUser.permissions;
    switch (item.id) {
      case 'dashboard': return p.dashboard !== false;
      case 'enterprise_security': return Boolean(p.enterpriseSecurity) || Boolean(p.auditLogs) || Boolean(p.settings);
      case 'analytics': return p.analytics !== false && (Boolean(p.analytics) || Boolean(p.reports) || Boolean(p.dashboard));
      case 'workforce_planning': return p.workforcePlanning !== false && (Boolean(p.workforcePlanning) || Boolean(p.departments) || Boolean(p.employees) || Boolean(p.recruitment));
      case 'engagement': return p.engagement !== false && (Boolean(p.engagement) || Boolean(p.employees) || Boolean(p.dashboard));
      case 'branches': return p.departments !== false;
      case 'employee': return p.employees;
      case 'department': return p.departments;
      case 'shift': return p.shifts;
      case 'roster': return p.roster;
      case 'recruitment': return p.recruitment;
      case 'onboarding': return (p.onboarding !== false && p.offboarding !== false) && (Boolean(p.onboarding) || Boolean(p.offboarding) || Boolean(p.employees));
      case 'attendance': return p.attendance;
      case 'leave': return p.leave;
      case 'documents': return p.documents !== false && (Boolean(p.documents) || Boolean(p.employees));
      case 'zkteco': return p.biometric;
      case 'payroll': return p.payroll;
      case 'expenses': return p.expenses !== false && (Boolean(p.expenses) || Boolean(p.payroll));
      case 'reports':
      case 'ai_assistant': return Boolean(p.reports);
      case 'settings': return p.settings;
      default: return true;
    }
  });

  const fullMenuItems = isSuperAdmin
    ? [...allowedMenuItems, { id: 'tenants' as Page, label: 'Tenants & SaaS', Icon: IconBuilding, group: 'System' }]
    : allowedMenuItems;

  const grouped = fullMenuItems.reduce<Record<string, typeof menuItems>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <>
      {/* ========================================================================= */}
      {/* MOBILE DRAWER BACKDROP (Shown only on small screens when drawer is open)   */}
      {/* ========================================================================= */}
      <div
        className={`fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-[65] transition-opacity duration-300 lg:hidden ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onToggle}
        aria-hidden="true"
      />

      {/* ========================================================================= */}
      {/* MOBILE SLIDE-OUT DRAWER (Full height, high z-index, sleek touch navigation) */}
      {/* ========================================================================= */}
      <aside
        className={`fixed inset-y-0 left-0 z-[70] w-[285px] max-w-[85vw] bg-gradient-to-b from-slate-950 via-[#0b0f19] to-slate-950 text-slate-200 flex flex-col border-r border-white/[0.08] shadow-2xl transform transition-transform duration-300 ease-in-out lg:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Mobile Header */}
        <div className="relative px-4 pt-5 pb-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="relative shrink-0">
              {companyLogo ? (
                <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shadow-md ring-1 ring-white/25 p-1 overflow-hidden">
                  <img
                    src={companyLogo}
                    alt={currentCompany?.name || 'Company Logo'}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-indigo-500/35 ring-1 ring-white/20">
                  <IconFlame size={20} className="text-white drop-shadow-sm" />
                </div>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950 ring-1 ring-emerald-400/50"></span>
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h1 className="font-bold text-[15px] tracking-tight text-white leading-tight font-display truncate max-w-[140px]">
                  {currentCompany?.name || 'WorkNest HR'}
                </h1>
              </div>
              <div className="flex items-center space-x-1.5 mt-0.5">
                <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.2 rounded bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-2xs">
                  {currentCompany?.subscription?.plan || 'PRO'}
                </span>
                <span className="text-[10px] text-slate-400 font-medium tracking-wide">Workspace</span>
              </div>
            </div>
          </div>
          <button
            onClick={onToggle}
            className="w-9 h-9 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            title="Close navigation"
          >
            <span className="text-lg leading-none">✕</span>
          </button>
        </div>

        {/* Mobile Navigation List */}
        <nav className="relative flex-1 overflow-y-auto px-3 py-4 thin-scroll">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="mb-4 last:mb-0">
              <div className="px-3 mb-1.5 text-[10px] font-bold text-slate-400/80 uppercase tracking-[0.14em] flex items-center justify-between">
                <span>{t(group)}</span>
                <span className="w-8 h-[1px] bg-white/[0.08]"></span>
              </div>
              <div className="space-y-1">
                {items.map(item => {
                  const isActive = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleMobileNavigate(item.id)}
                      className={`relative w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-left text-[14px] font-medium transition-all duration-200 cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-indigo-500/25 via-violet-500/20 to-transparent text-white font-semibold ring-1 ring-indigo-500/40'
                          : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-gradient-to-b from-indigo-400 via-violet-400 to-fuchsia-400 rounded-r-full shadow-sm shadow-indigo-500"></span>
                      )}
                      <span className={`${isActive ? 'text-indigo-300 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'text-slate-400'}`}>
                        <item.Icon size={18} />
                      </span>
                      <span className="flex-1 tracking-tight">{t(item.label)}</span>
                      {item.badge && (
                        <span className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-2xs">
                          {item.badge}
                        </span>
                      )}
                      {isActive && <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Mobile Footer */}
        <div className="relative px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2.5 border-t border-white/[0.07] bg-slate-950/90 shrink-0">
          {currentUser && (
            <div className="flex items-center space-x-2.5 px-2.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <div className="relative">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-semibold text-white shadow-md overflow-hidden">
                  {currentUser.avatar && (currentUser.avatar.startsWith('data:image/') || currentUser.avatar.startsWith('http')) ? (
                    <img src={currentUser.avatar} alt={currentUser.name} className="w-full h-full object-cover" />
                  ) : (
                    currentUser.avatar || '👨‍💼'
                  )}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950"></span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-white truncate">{currentUser.name}</p>
                <p className="text-[10px] text-indigo-300 font-medium truncate">{currentUser.role || 'Super Admin'}</p>
              </div>
              <button
                onClick={logout}
                className="w-8 h-8 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center transition-all cursor-pointer"
                title="Logout"
              >
                <IconLogout size={15} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* DESKTOP SIDEBAR (Visible only on lg and above screens)                     */}
      {/* ========================================================================= */}
      {isOpen ? (
        <aside className="hidden lg:flex w-[268px] h-screen flex-shrink-0 bg-gradient-to-b from-slate-950 via-[#0b0f19] to-slate-950 text-slate-200 flex-col border-r border-white/[0.07] relative z-20 shadow-2xl select-none">
          {/* Exclusive ambient glow accents */}
          <div className="absolute -top-32 -left-32 w-64 h-64 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-violet-600/15 rounded-full blur-3xl pointer-events-none"></div>

          {/* Brand Header */}
          <div className="relative shrink-0 px-5 pt-6 pb-5 border-b border-white/[0.08]">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="relative shrink-0">
                  {companyLogo ? (
                    <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-md ring-1 ring-white/25 p-1 overflow-hidden">
                      <img
                        src={companyLogo}
                        alt={currentCompany?.name || 'Company Logo'}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-indigo-500/35 ring-1 ring-white/20">
                      <IconFlame size={21} className="text-white drop-shadow-sm" />
                    </div>
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-slate-950 ring-1 ring-emerald-400/50"></span>
                </div>
                <div>
                  <div className="flex items-center space-x-1.5">
                    <h1 className="font-bold text-[16px] tracking-tight text-white leading-tight font-display truncate max-w-[150px]">
                      {currentCompany?.name || 'WorkNest HR'}
                    </h1>
                  </div>
                  <div className="flex items-center space-x-1.5 mt-0.5">
                    <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.2 rounded bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-2xs">
                      {currentCompany?.subscription?.plan || 'PRO'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium tracking-wide">Workspace</span>
                  </div>
                </div>
              </div>
              <button
                onClick={onToggle}
                className="w-8 h-8 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                title="Collapse sidebar"
              >
                <IconChevronLeft size={14} />
              </button>
            </div>
          </div>

          {/* Navigation list */}
          <nav className="relative flex-1 overflow-y-auto px-3 py-5 sidebar-scroll thin-scroll overscroll-contain">
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-5 last:mb-0">
                <div className="px-3 mb-2 text-[10px] font-bold text-slate-400/80 uppercase tracking-[0.14em] flex items-center justify-between">
                  <span>{t(group)}</span>
                  <span className="w-8 h-[1px] bg-white/[0.08]"></span>
                </div>
                <div className="space-y-1">
                  {items.map(item => {
                    const isActive = currentPage === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onNavigate(item.id)}
                        className={`relative w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-left text-[13.5px] font-medium transition-all duration-200 cursor-pointer ${
                          isActive
                            ? 'bg-gradient-to-r from-indigo-500/20 via-violet-500/15 to-transparent text-white font-semibold shadow-[inset_1px_0_0_rgba(99,102,241,0.6)] ring-1 ring-white/5'
                            : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100 hover:translate-x-0.5'
                        }`}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-gradient-to-b from-indigo-400 via-violet-400 to-fuchsia-400 rounded-r-full shadow-sm shadow-indigo-500"></span>
                        )}
                        <span className={`${isActive ? 'text-indigo-300 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'text-slate-400'} transition-colors`}>
                          <item.Icon size={17} />
                        </span>
                        <span className="flex-1 tracking-tight">{t(item.label)}</span>
                        {item.badge && (
                          <span className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-2xs">
                            {item.badge}
                          </span>
                        )}
                        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-400 animate-pulse"></span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer User Profile */}
          <div className="relative shrink-0 px-3 pb-3 pt-2 border-t border-white/[0.07] bg-slate-950/40">
            {currentUser && (
              <div className="flex items-center space-x-2.5 px-2.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-all group">
                <div className="relative">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-semibold text-white shadow-md ring-1 ring-white/20 overflow-hidden">
                    {currentUser.avatar && (currentUser.avatar.startsWith('data:image/') || currentUser.avatar.startsWith('http')) ? (
                      <img src={currentUser.avatar} alt={currentUser.name} className="w-full h-full object-cover" />
                    ) : (
                      currentUser.avatar || '👨‍💼'
                    )}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950 shadow-xs"></span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-bold text-white truncate">{currentUser.name}</p>
                  <div className="flex items-center space-x-1 mt-0.5">
                    <span className="text-[10px] text-indigo-300 font-medium truncate">{currentUser.role || 'Super Admin'}</span>
                    <span className="text-[9px] text-slate-500">• Online</span>
                  </div>
                </div>
                <button onClick={logout} className="w-7 h-7 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 flex items-center justify-center transition-all cursor-pointer" title="Logout">
                  <IconLogout size={14} />
                </button>
              </div>
            )}
          </div>
        </aside>
      ) : (
        <aside className="hidden lg:flex w-[74px] h-screen flex-shrink-0 bg-gradient-to-b from-slate-950 via-[#0b0f19] to-slate-950 flex-col items-center py-5 border-r border-white/[0.07] z-20 shadow-xl select-none">
          <button
            onClick={onToggle}
            className="w-10 h-10 mb-5 hover:bg-white/10 rounded-xl flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer shrink-0"
            title="Expand sidebar"
          >
            <IconChevronLeft size={18} className="rotate-180" />
          </button>
          <div className="relative mb-6 shrink-0">
            {companyLogo ? (
              <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shadow-md ring-1 ring-white/25 p-1 overflow-hidden">
                <img
                  src={companyLogo}
                  alt={currentCompany?.name || 'Company Logo'}
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 ring-1 ring-white/20">
                <IconFlame size={20} className="text-white" />
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-slate-950 shadow-sm"></span>
          </div>
          <nav className="flex-1 flex flex-col items-center space-y-1.5 w-full px-2.5 overflow-y-auto thin-scroll overscroll-contain">
            {menuItems.map(item => {
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-gradient-to-br from-indigo-500/25 to-violet-500/25 text-white shadow-inner ring-1 ring-indigo-500/40'
                      : 'text-slate-400 hover:bg-white/[0.08] hover:text-white'
                  }`}
                  title={item.label}
                >
                  {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-to-b from-indigo-400 via-violet-400 to-fuchsia-400 rounded-r-full shadow-sm shadow-indigo-500"></span>}
                  <item.Icon size={18} className={isActive ? 'text-indigo-300 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]' : ''} />
                </button>
              );
            })}
          </nav>
          <button onClick={logout} className="w-10 h-10 mt-4 rounded-xl hover:bg-white/10 text-slate-400 hover:text-rose-400 flex items-center justify-center transition-all cursor-pointer shrink-0" title="Logout">
            <IconLogout size={16} />
          </button>
        </aside>
      )}
    </>
  );
}
