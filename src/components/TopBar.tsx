import { useState, useRef, useEffect, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { Page } from '../App';
import { IconSearch, IconBell, IconMessages, IconMenu, IconChevronDown, IconLogout, IconUser, IconSettings, IconCloud, IconBuilding } from './Icons';

type Props = {
  onMenuClick: () => void;
  currentPageTitle: string;
  onNavigate: (page: Page) => void;
};

const SEARCH_MODULES = [
  { id: 'dashboard' as Page, title: 'Dashboard & KPI Overview', description: 'Real-time metrics, operational stats & summaries', icon: '📊', group: 'Navigation' },
  { id: 'enterprise_security' as Page, title: 'Enterprise Security, RBAC, MFA & Sessions', description: 'Custom roles, 2FA/MFA readiness, session tracking, rate limits & audit logs', icon: '🛡️', group: 'System' },
  { id: 'branches' as Page, title: 'Head Office & Branch Offices', description: 'Manage Dhaka Head Office, branch offices & remote biometric terminals', icon: '🏢', group: 'Navigation' },
  { id: 'attendance' as Page, title: 'Attendance Register & Logs', description: 'Clock-in/out records, punctuality & regularization', icon: '⏱️', group: 'Operations' },
  { id: 'reports' as Page, title: 'HR Analytics & Reports Center', description: 'Printable audit reports, payroll sheets & rosters', icon: '📈', group: 'Finance' },
  { id: 'payroll' as Page, title: 'Payroll & Salary Management', description: 'Compensation disbursements, payslips & tax calculations', icon: '💵', group: 'Finance' },
  { id: 'employee' as Page, title: 'Employees Master Directory', description: 'Staff records, designation assignments & profiles', icon: '👥', group: 'People' },
  { id: 'department' as Page, title: 'Departments & Org Hierarchy', description: 'Business units, departmental heads & budgets', icon: '🏢', group: 'People' },
  { id: 'shift' as Page, title: 'Shift Management & Grace Times', description: 'Work shifts, late cut rules & half-day quotas', icon: '⏰', group: 'People' },
  { id: 'roster' as Page, title: 'Duty Roster & Scheduling', description: 'Monthly employee duty planner & shift assignments', icon: '📅', group: 'People' },
  { id: 'zkteco' as Page, title: 'Biometric Hardware & Devices', description: 'ZKTeco terminals, TCP/ADMS sync & network status', icon: '📟', group: 'Integrations' },
  { id: 'leave' as Page, title: 'Leave Management & Ledger', description: 'Leave requests, approval workflow & balance', icon: '🏖️', group: 'Operations' },
  { id: 'recruitment' as Page, title: 'Recruitment & Job Candidates', description: 'Talent hiring pipelines, applicants & interview scoring', icon: '🎯', group: 'People' },
  { id: 'messaging' as Page, title: 'Internal Messaging & Inbox', description: 'Direct staff communication & announcements', icon: '💬', group: 'Communication' },
  { id: 'settings' as Page, title: 'System & Account Settings', description: 'Company profile, shift defaults & cloud sync', icon: '⚙️', group: 'System' },
  { id: 'profile' as Page, title: 'My Profile & Security', description: 'Admin credentials, password & role management', icon: '👤', group: 'System' },
];

export function TopBar({ onMenuClick, currentPageTitle, onNavigate }: Props) {
  const {
    unreadNotificationCount, notifications, markNotificationRead, markAllNotificationsRead,
    unreadMessageCount, messages, markMessageRead,
    currentUser, logout, firebaseConnected, liveSyncEnabled, lastSyncTime, firebaseSyncing,
    employees, allEmployees, departments, branches, activeBranch, setActiveBranch, getEmployeeBranch,
  } = useData();
  const [showNotif, setShowNotif] = useState(false);
  const [showMsg, setShowMsg] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [search, setSearch] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  const query = search.trim().toLowerCase();

  const matchedModules = useMemo(() => {
    if (!query) return SEARCH_MODULES.slice(0, 5);
    return SEARCH_MODULES.filter(
      (m) =>
        m.title.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query) ||
        m.id.toLowerCase().includes(query)
    );
  }, [query]);

  const matchedEmployees = useMemo(() => {
    if (!query) return [];
    return employees.filter(
      (e) =>
        (e.name && e.name.toLowerCase().includes(query)) ||
        (e.employeeId && e.employeeId.toLowerCase().includes(query)) ||
        (e.department && e.department.toLowerCase().includes(query)) ||
        (e.designation && e.designation.toLowerCase().includes(query)) ||
        (e.email && e.email.toLowerCase().includes(query)) ||
        (e.phone && e.phone.includes(query))
    ).slice(0, 6);
  }, [query, employees]);

  const matchedDepartments = useMemo(() => {
    if (!query) return [];
    return departments.filter(
      (d) =>
        (d.name && d.name.toLowerCase().includes(query)) ||
        (d.code && d.code.toLowerCase().includes(query)) ||
        (d.head && d.head.toLowerCase().includes(query))
    ).slice(0, 4);
  }, [query, departments]);

  const totalResultsCount = (query ? matchedModules.length : 0) + matchedEmployees.length + matchedDepartments.length;

  const handleSelectResult = (page: Page, filterQuery?: string) => {
    const qToPass = (filterQuery ?? search).trim();
    try {
      if (qToPass && (page === 'employee' || page === 'department' || page === 'attendance')) {
        sessionStorage.setItem('worknest_global_search_query', qToPass);
      } else {
        sessionStorage.removeItem('worknest_global_search_query');
      }
      window.dispatchEvent(
        new CustomEvent('worknest-global-search', {
          detail: { query: qToPass, targetPage: page }
        })
      );
    } catch {}
    onNavigate(page);
    setIsSearchOpen(false);
    setIsMobileSearchOpen(false);
    setSearch('');
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false);
      if (msgRef.current && !msgRef.current.contains(e.target as Node)) setShowMsg(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false);
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
        setIsMobileSearchOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (isMobileSearchOpen) {
      setTimeout(() => mobileInputRef.current?.focus(), 100);
    }
  }, [isMobileSearchOpen]);

  const handleNotificationClick = (id: string, targetPage?: string) => {
    markNotificationRead(id);
    setShowNotif(false);
    if (targetPage) onNavigate(targetPage as Page);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'leave': return '🏖️';
      case 'attendance': return '⏱️';
      case 'payroll': return '💵';
      case 'recruitment': return '👥';
      default: return '🔔';
    }
  };

  return (
    <>
    <header className="sticky top-0 z-30 glass border-b border-slate-200/70 bg-white/95">
      <div className="px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
        {/* Left: Mobile hamburger & title */}
        <div className="flex items-center space-x-2.5 sm:space-x-4 min-w-0 flex-1 sm:flex-initial">
          <button
            onClick={onMenuClick}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 flex items-center justify-center text-slate-700 transition-colors shrink-0 cursor-pointer"
            aria-label="Toggle Navigation Menu"
          >
            <IconMenu size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] sm:text-[16px] font-bold tracking-tight text-slate-900 truncate leading-tight font-display">
              {currentPageTitle}
            </h2>
            <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium hidden sm:block leading-tight mt-0.5">
              WorkNest HR • Smart Cloud Workforce
            </p>
          </div>
        </div>

        {/* Center (Desktop/Tablet >= 640px): Global Office / Branch Switcher + Live sync indicator */}
        <div className="hidden sm:flex items-center space-x-2 shrink-0">
          <div className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-indigo-50/90 hover:bg-indigo-100/80 border border-indigo-200 rounded-xl transition-all">
            <IconBuilding size={14} className="text-indigo-600 shrink-0" />
            <select
              value={activeBranch}
              onChange={(e) => setActiveBranch(e.target.value)}
              title="Switch Active Office / Branch Workspace"
              className="bg-transparent text-xs font-bold text-indigo-900 focus:outline-none cursor-pointer max-w-[180px] md:max-w-[220px] truncate"
            >
              <option value="All">🏢 All Offices ({branches.length})</option>
              {branches.map((b) => {
                const count = allEmployees.filter((emp) => getEmployeeBranch(emp) === b.name).length;
                return (
                  <option key={b.id} value={b.name}>
                    {b.isHeadOffice ? '🏢 ' : '📍 '}{b.name} ({count})
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={() => onNavigate('branches')}
              title="Manage Head Office & Branch Offices"
              className="px-1.5 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[10px] font-bold transition-colors cursor-pointer"
            >
              Branches
            </button>
          </div>

          {firebaseConnected && (
            <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/80 rounded-lg text-emerald-800 shrink-0">
              <div className="relative flex items-center justify-center">
                <span className={`w-2 h-2 rounded-full ${firebaseSyncing ? 'bg-amber-500' : 'bg-emerald-500'} block`}></span>
                {!firebaseSyncing && <span className="absolute inset-0 w-2 h-2 bg-emerald-500 rounded-full animate-ping"></span>}
              </div>
              <IconCloud size={13} className="text-emerald-600 hidden md:inline" />
              <span className="text-[11px] font-bold">
                {firebaseSyncing ? 'SYNCING' : liveSyncEnabled ? 'LIVE' : 'SYNCED'}
              </span>
              {lastSyncTime && !firebaseSyncing && (
                <span className="text-[10px] text-emerald-600 font-medium hidden md:inline">
                  • {lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Global Search (Desktop with Live Dropdown) */}
        <div className="flex-1 max-w-xs lg:max-w-md mx-4 hidden lg:block relative" ref={searchContainerRef}>
          <div className="relative">
            <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              id="global-search"
              type="text"
              placeholder="Search employees, ID, departments, modules..."
              value={search}
              onFocus={() => setIsSearchOpen(true)}
              onChange={(e) => {
                const val = e.target.value;
                setSearch(val);
                if (!isSearchOpen) setIsSearchOpen(true);
                try {
                  window.dispatchEvent(
                    new CustomEvent('worknest-global-search', {
                      detail: { query: val.trim() }
                    })
                  );
                } catch {}
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (matchedEmployees.length > 0) handleSelectResult('employee', matchedEmployees[0].employeeId || matchedEmployees[0].name);
                  else if (matchedDepartments.length > 0) handleSelectResult('department', matchedDepartments[0].name);
                  else if (matchedModules.length > 0) handleSelectResult(matchedModules[0].id, '');
                }
              }}
              className="w-full pl-9 pr-14 py-2 text-xs bg-slate-100/90 hover:bg-slate-100 border border-transparent rounded-xl focus:bg-white focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100 placeholder-slate-400 text-slate-800 transition-all font-medium"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-[10px] font-bold transition-all cursor-pointer"
                title="Clear search"
              >
                ✕
              </button>
            ) : (
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono font-semibold text-slate-500 shadow-2xs pointer-events-none">
                ⌘K
              </kbd>
            )}
          </div>

          {/* Desktop Search Results Dropdown */}
          {isSearchOpen && (
            <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden z-50 animate-fade-in max-h-[480px] flex flex-col">
              <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                <span>{query ? `Search results for "${search}"` : 'Quick Jump & Navigation'}</span>
                {query && <span className="text-indigo-600 font-bold">{totalResultsCount} found</span>}
              </div>

              <div className="overflow-y-auto thin-scroll p-2 divide-y divide-slate-100/80">
                {/* 1. MATCHED EMPLOYEES */}
                {matchedEmployees.length > 0 && (
                  <div className="py-2 first:pt-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5 flex items-center justify-between">
                      <span>Employees ({matchedEmployees.length})</span>
                      <span className="text-indigo-600 text-[10px] lowercase">Click to open staff directory</span>
                    </p>
                    <div className="space-y-1">
                      {matchedEmployees.map((emp) => (
                        <button
                          key={emp.id}
                          onClick={() => handleSelectResult('employee', emp.employeeId || emp.name)}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-indigo-50/70 transition-colors flex items-center space-x-3 cursor-pointer group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0 border border-indigo-200/50 overflow-hidden">
                            {emp.avatar && (emp.avatar.startsWith('data:image/') || emp.avatar.startsWith('http')) ? (
                              <img src={emp.avatar} alt={emp.name} className="w-full h-full object-cover" />
                            ) : (
                              emp.avatar || emp.name.charAt(0)
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-700 truncate">{emp.name}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200/60 font-semibold">{emp.employeeId}</span>
                              {emp.status === 'on_leave' ? (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-amber-100 text-amber-800 font-bold">On Leave</span>
                              ) : emp.status === 'active' ? (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold">Active</span>
                              ) : null}
                            </div>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                              {emp.designation || 'Staff'} • <span className="text-slate-700 font-medium">{emp.department || 'General'}</span>
                            </p>
                          </div>
                          <span className="text-[11px] text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity font-bold">
                            View →
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. MATCHED DEPARTMENTS */}
                {matchedDepartments.length > 0 && (
                  <div className="py-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
                      Departments ({matchedDepartments.length})
                    </p>
                    <div className="space-y-1">
                      {matchedDepartments.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => handleSelectResult('department', d.name)}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-indigo-50/70 transition-colors flex items-center space-x-3 cursor-pointer group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 font-bold text-sm flex items-center justify-center shrink-0 border border-emerald-200/60">
                            🏢
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-700 truncate">{d.name}</span>
                              {d.code && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold">{d.code}</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                              Head: <span className="font-medium text-slate-700">{d.head || 'Unassigned'}</span>
                            </p>
                          </div>
                          <span className="text-[11px] text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity font-bold">
                            Open →
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. SYSTEM MODULES & QUICK JUMP */}
                {matchedModules.length > 0 && (
                  <div className="py-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
                      {query ? 'Matching Modules' : 'Popular Modules'}
                    </p>
                    <div className="space-y-1">
                      {matchedModules.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => handleSelectResult(m.id)}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-indigo-50/70 transition-colors flex items-center space-x-3 cursor-pointer group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-indigo-100 text-base flex items-center justify-center shrink-0 transition-colors">
                            {m.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-900 group-hover:text-indigo-700 truncate">{m.title}</p>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">{m.description}</p>
                          </div>
                          <span className="text-[11px] text-indigo-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                            Jump →
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* NO RESULTS FOUND */}
                {query && totalResultsCount === 0 && (
                  <div className="py-8 text-center px-4">
                    <div className="text-2xl mb-2">🔍</div>
                    <p className="text-xs font-bold text-slate-700">No records found for "{search}"</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                      Try searching with staff name, ID (e.g. EMP-001), department, or keywords like "attendance", "payroll", "reports".
                    </p>
                  </div>
                )}
              </div>

              <div className="px-3.5 py-2 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                <span>Press <kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded font-mono text-slate-600">↵</kbd> to select</span>
                <span>Press <kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded font-mono text-slate-600">Esc</kbd> to close</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Actions: Search (Mobile), Notifications, Messages, User Profile */}
        <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
          {/* Mobile Search Pill/Button */}
          <button
            onClick={() => setIsMobileSearchOpen(true)}
            className="lg:hidden px-2.5 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center space-x-1.5 text-slate-600 transition-colors cursor-pointer"
            title="Search"
            aria-label="Search"
          >
            <IconSearch size={16} className="text-slate-500 shrink-0" />
            <span className="text-[11px] font-semibold text-slate-500 hidden xs:inline">Search...</span>
          </button>

          {/* Notifications Dropdown */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => { setShowNotif(!showNotif); setShowMsg(false); setShowProfile(false); }}
              className="relative w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors cursor-pointer"
              title="Notifications"
            >
              <IconBell size={18} />
              {unreadNotificationCount > 0 && (
                <>
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full"></span>
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full animate-ping"></span>
                </>
              )}
            </button>
            {showNotif && (
              <div className="fixed sm:absolute right-2 sm:right-0 top-16 sm:top-12 w-[calc(100vw-16px)] sm:w-96 max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 animate-fade-in overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
                  <h3 className="font-bold text-xs text-slate-900 uppercase tracking-wider">Notifications</h3>
                  <button onClick={markAllNotificationsRead} className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold cursor-pointer">
                    Mark all read
                  </button>
                </div>
                <div className="max-h-80 sm:max-h-96 overflow-y-auto thin-scroll">
                  {notifications.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs font-medium">No notifications</div>
                  ) : (
                    notifications.map(n => (
                      <button
                        key={n.id}
                        onClick={() => handleNotificationClick(n.id, n.targetPage)}
                        className={`w-full text-left p-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${!n.read ? 'bg-indigo-50/40' : ''}`}
                      >
                        <div className="flex items-start space-x-3">
                          <div className="text-xl shrink-0">{getTypeIcon(n.type)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <p className="text-[12.5px] font-semibold text-slate-900 truncate">{n.title}</p>
                              {!n.read && <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full ml-1.5 shrink-0"></span>}
                            </div>
                            <p className="text-[11.5px] text-slate-600 mt-0.5 line-clamp-2">{n.message}</p>
                            <p className="text-[10px] text-slate-400 mt-1">{n.time}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Messages Dropdown */}
          <div className="relative" ref={msgRef}>
            <button
              onClick={() => { setShowMsg(!showMsg); setShowNotif(false); setShowProfile(false); }}
              className="relative w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors cursor-pointer"
              title="Messages"
            >
              <IconMessages size={18} />
              {unreadMessageCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full"></span>
              )}
            </button>
            {showMsg && (
              <div className="fixed sm:absolute right-2 sm:right-0 top-16 sm:top-12 w-[calc(100vw-16px)] sm:w-96 max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 animate-fade-in overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
                  <h3 className="font-bold text-xs text-slate-900 uppercase tracking-wider">Messages</h3>
                  <span className="text-[11px] text-slate-500 font-medium">{unreadMessageCount} unread</span>
                </div>
                <div className="max-h-72 sm:max-h-80 overflow-y-auto thin-scroll">
                  {messages.slice(0, 6).map(m => (
                    <button
                      key={m.id}
                      onClick={() => { markMessageRead(m.id); setShowMsg(false); onNavigate('messaging'); }}
                      className={`w-full text-left p-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${m.unread ? 'bg-emerald-50/30' : ''}`}
                    >
                      <div className="flex items-start space-x-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-sm shrink-0">
                          {m.fromAvatar}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-[12px] font-semibold text-slate-900">{m.from}</p>
                            <span className="text-[10px] text-slate-400">{m.time}</span>
                          </div>
                          <p className="text-[12px] font-medium text-slate-700 truncate">{m.subject}</p>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">{m.preview}</p>
                        </div>
                        {m.unread && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mt-1.5 shrink-0"></span>}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="p-2 border-t border-slate-100 bg-slate-50/50">
                  <button
                    onClick={() => { setShowMsg(false); onNavigate('messaging'); }}
                    className="w-full text-center text-[12px] text-indigo-600 hover:text-indigo-700 font-semibold py-1.5 cursor-pointer"
                  >
                    Open messaging →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User Profile Dropdown */}
          <div className="relative ml-1 pl-1.5 sm:pl-2.5 border-l border-slate-200" ref={profileRef}>
            <button
              onClick={() => { setShowProfile(!showProfile); setShowNotif(false); setShowMsg(false); }}
              className="flex items-center space-x-2 p-1 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <div className="relative">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-semibold text-white shadow-xs overflow-hidden">
                  {currentUser?.avatar && (currentUser.avatar.startsWith('data:image/') || currentUser.avatar.startsWith('http')) ? (
                    <img src={currentUser.avatar} alt={currentUser.name} className="w-full h-full object-cover" />
                  ) : (
                    currentUser?.avatar || '👨‍💼'
                  )}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-white"></span>
              </div>
              <div className="hidden md:block text-left">
                <p className="text-[12px] font-bold text-slate-900 leading-tight truncate max-w-[120px]">{currentUser?.name || 'User'}</p>
                <p className="text-[10px] text-slate-500 font-medium leading-tight truncate">Super Admin</p>
              </div>
              <IconChevronDown size={14} className="text-slate-400 hidden sm:block" />
            </button>

            {showProfile && (
              <div className="fixed sm:absolute right-2 sm:right-0 top-16 sm:top-12 w-60 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 py-1.5 animate-fade-in">
                <div className="px-4 py-3 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900 truncate">{currentUser?.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{currentUser?.email || 'admin@worknest.hr'}</p>
                  <span className="mt-1 inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md text-[9px] font-bold uppercase tracking-wider">
                    {currentUser?.role || 'Super Admin'}
                  </span>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => { setShowProfile(false); onNavigate('profile'); }}
                    className="w-full flex items-center space-x-2.5 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 text-left cursor-pointer"
                  >
                    <IconUser size={15} className="text-slate-400" />
                    <span>My Profile</span>
                  </button>
                  <button
                    onClick={() => { setShowProfile(false); onNavigate('settings'); }}
                    className="w-full flex items-center space-x-2.5 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 text-left cursor-pointer"
                  >
                    <IconSettings size={15} className="text-slate-400" />
                    <span>System Settings</span>
                  </button>
                </div>
                <div className="border-t border-slate-100 pt-1">
                  <button
                    onClick={logout}
                    className="w-full flex items-center space-x-2.5 px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 text-left cursor-pointer"
                  >
                    <IconLogout size={15} />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slim Mobile-Only Office / Branch Switcher Strip (< 640px) */}
      <div className="sm:hidden px-3 py-1.5 bg-slate-50/95 border-t border-slate-200/70 flex items-center justify-between gap-2">
        <div className="flex items-center space-x-1.5 min-w-0 flex-1 bg-white px-2.5 py-1 rounded-lg border border-indigo-200/80">
          <IconBuilding size={13} className="text-indigo-600 shrink-0" />
          <select
            value={activeBranch}
            onChange={(e) => setActiveBranch(e.target.value)}
            aria-label="Select Office or Branch"
            className="bg-transparent text-[11px] font-bold text-indigo-950 focus:outline-none w-full truncate"
          >
            <option value="All">🏢 All Offices ({branches.length} Offices • {allEmployees.length} Staff)</option>
            {branches.map((b) => {
              const count = allEmployees.filter((emp) => getEmployeeBranch(emp) === b.name).length;
              return (
                <option key={b.id} value={b.name}>
                  {b.isHeadOffice ? '🏢 ' : '📍 '}{b.name} ({count} Staff)
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('branches')}
            className="px-2 py-1 bg-indigo-600 active:bg-indigo-700 text-white rounded-lg text-[10px] font-bold whitespace-nowrap"
          >
            Branches
          </button>
          {firebaseConnected && (
            <span className="inline-flex items-center space-x-1 px-1.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200/80 text-[10px] font-bold text-emerald-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>LIVE</span>
            </span>
          )}
        </div>
      </div>
    </header>

      {/* ========================================================================= */}
      {/* MOBILE SEARCH MODAL OVERLAY (Outside header so fixed inset-0 covers full screen in APK/WebView) */}
      {/* ========================================================================= */}
      {isMobileSearchOpen && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-xs flex flex-col lg:hidden p-3 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileSearchOpen(false);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl flex flex-col max-h-[82vh] overflow-hidden border border-slate-200">
            {/* Header & Input */}
            <div className="p-3 border-b border-slate-100 flex items-center space-x-2 bg-slate-50/70">
              <IconSearch size={17} className="text-slate-400 shrink-0" />
              <input
                ref={mobileInputRef}
                type="search"
                enterKeyHint="search"
                placeholder="Search staff, ID, department, module..."
                value={search}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearch(val);
                  try {
                    window.dispatchEvent(
                      new CustomEvent('worknest-global-search', {
                        detail: { query: val.trim() }
                      })
                    );
                  } catch {}
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (matchedEmployees.length > 0) handleSelectResult('employee', matchedEmployees[0].employeeId || matchedEmployees[0].name);
                    else if (matchedDepartments.length > 0) handleSelectResult('department', matchedDepartments[0].name);
                    else if (matchedModules.length > 0) handleSelectResult(matchedModules[0].id, '');
                  }
                }}
                className="flex-1 bg-transparent text-sm font-semibold text-slate-800 placeholder-slate-400 outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0 cursor-pointer"
                >
                  ✕
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsMobileSearchOpen(false)}
                className="px-2.5 py-1 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-200/70 hover:bg-slate-200 rounded-lg shrink-0 cursor-pointer"
              >
                Cancel
              </button>
            </div>

            {/* Results list */}
            <div className="flex-1 overflow-y-auto p-2 divide-y divide-slate-100 thin-scroll">
              {matchedEmployees.length > 0 && (
                <div className="py-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
                    Employees ({matchedEmployees.length})
                  </p>
                  <div className="space-y-1">
                    {matchedEmployees.map((emp) => (
                      <button
                        key={emp.id}
                        onClick={() => handleSelectResult('employee', emp.employeeId || emp.name)}
                        className="w-full text-left p-2 rounded-xl hover:bg-indigo-50 flex items-center space-x-3 active:bg-indigo-100 cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0 overflow-hidden">
                          {emp.avatar && (emp.avatar.startsWith('data:image/') || emp.avatar.startsWith('http')) ? (
                            <img src={emp.avatar} alt={emp.name} className="w-full h-full object-cover" />
                          ) : (
                            emp.avatar || emp.name.charAt(0)
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{emp.name}</p>
                          <p className="text-[11px] text-slate-500 truncate">{emp.employeeId} • {emp.department}</p>
                        </div>
                        <span className="text-xs text-indigo-600 font-bold">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {matchedDepartments.length > 0 && (
                <div className="py-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
                    Departments ({matchedDepartments.length})
                  </p>
                  <div className="space-y-1">
                    {matchedDepartments.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => handleSelectResult('department', d.name)}
                        className="w-full text-left p-2 rounded-xl hover:bg-emerald-50 flex items-center space-x-3 active:bg-emerald-100 cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 font-bold text-sm flex items-center justify-center shrink-0">
                          🏢
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{d.name}</p>
                          <p className="text-[11px] text-slate-500 truncate">Head: {d.head || 'Unassigned'}</p>
                        </div>
                        <span className="text-xs text-emerald-600 font-bold">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {matchedModules.length > 0 && (
                <div className="py-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
                    Modules & Pages
                  </p>
                  <div className="space-y-1">
                    {matchedModules.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => handleSelectResult(m.id, '')}
                        className="w-full text-left p-2 rounded-xl hover:bg-indigo-50 flex items-center space-x-3 active:bg-indigo-100 cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-100 text-base flex items-center justify-center shrink-0">
                          {m.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{m.title}</p>
                          <p className="text-[11px] text-slate-500 truncate">{m.description}</p>
                        </div>
                        <span className="text-xs text-indigo-600 font-bold">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {query && totalResultsCount === 0 && (
                <div className="py-8 text-center px-4">
                  <div className="text-2xl mb-2">🔍</div>
                  <p className="text-xs font-bold text-slate-700">No records found for "{search}"</p>
                  <p className="text-[11px] text-slate-400 mt-1">Try employee name, ID or department</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
