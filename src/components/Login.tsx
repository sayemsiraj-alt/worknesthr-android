import React, { useState } from 'react';
import { useData } from '../context/DataContext';

interface LoginProps {
  initialMode?: 'admin' | 'employee';
}

export function Login({ initialMode }: LoginProps = {}) {
  const { login, loginEmployee } = useData();

  // Check URL parameters: if ?portal=employee or ?mode=employee or #employee, switch to employee mode
  const [mode, setMode] = useState<'admin' | 'employee'>(() => {
    if (initialMode) return initialMode;
    try {
      if (typeof window !== 'undefined') {
        const search = window.location.search.toLowerCase();
        const hash = window.location.hash.toLowerCase();
        if (search.includes('employee') || search.includes('portal=emp') || hash.includes('employee')) {
          return 'employee';
        }
      }
    } catch {}
    return 'admin';
  });

  // ONLY load remembered credentials if user explicitly checked "Remember me" previously AND not in employee mode
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem('worknest_remember_admin'));
    } catch {
      return false;
    }
  });

  const [email, setEmail] = useState<string>(() => {
    try {
      // Don't prefill if accessed as employee
      if (typeof window !== 'undefined') {
        const s = window.location.search.toLowerCase();
        if (s.includes('portal=employee') || s.includes('mode=employee')) return '';
      }
      const saved = localStorage.getItem('worknest_remember_admin');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.email || '';
      }
    } catch {}
    return '';
  });

  const [password, setPassword] = useState<string>(() => {
    try {
      // Don't prefill if accessed as employee
      if (typeof window !== 'undefined') {
        const s = window.location.search.toLowerCase();
        if (s.includes('portal=employee') || s.includes('mode=employee')) return '';
      }
      const saved = localStorage.getItem('worknest_remember_admin');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.password || '';
      }
    } catch {}
    return '';
  });

  const [employeeId, setEmployeeId] = useState('');
  const [employeePassword, setEmployeePassword] = useState('');
  const [error, setError] = useState('');
  const [authPhase, setAuthPhase] = useState<'idle' | 'verifying' | 'success'>('idle');
  const [successInfo, setSuccessInfo] = useState<{ title: string; subtitle: string }>({
    title: 'Login Successful! 🎉',
    subtitle: 'Redirecting to workspace...',
  });

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authPhase !== 'idle') return;
    setError('');
    setAuthPhase('verifying');

    try {
      // 1. Verify admin credentials
      const { authenticateAdminUser } = await import('../lib/authService');
      const res = await authenticateAdminUser(email, password);

      if (!res.success || !res.user) {
        setAuthPhase('idle');
        setError('Invalid Email or Password. Please check your credentials or contact Super Admin.');
        return;
      }

      // 2. Play smooth success animation
      setSuccessInfo({
        title: 'Login Successfully! 🎉',
        subtitle: `Welcome back, ${res.user.name || 'Administrator'}! Redirecting to Dashboard...`,
      });
      setAuthPhase('success');

      // 3. Animation pause so user sees the success state and progress bar
      await new Promise(resolve => setTimeout(resolve, 1400));

      // 4. Complete login
      const ok = await login(email, password);
      if (ok) {
        if (rememberMe) {
          try {
            localStorage.setItem('worknest_remember_admin', JSON.stringify({ email, password }));
          } catch {}
        } else {
          try {
            localStorage.removeItem('worknest_remember_admin');
          } catch {}
        }
      } else {
        setAuthPhase('idle');
        setError('Session initialization failed. Please try again.');
      }
    } catch (err: any) {
      setAuthPhase('idle');
      setError(err?.message || 'Login failed. Please try again.');
    }
  };

  const handleEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authPhase !== 'idle') return;
    setError('');
    setAuthPhase('verifying');

    try {
      // 1. Verify employee credentials
      const { authenticateEmployeeUser } = await import('../lib/authService');
      const res = await authenticateEmployeeUser(employeeId.trim(), employeePassword.trim());

      if (!res.success || !res.employee) {
        setAuthPhase('idle');
        setError('Invalid Employee ID or Password');
        return;
      }

      // 2. Play smooth success animation
      setSuccessInfo({
        title: 'Login Successfully! 🎉',
        subtitle: `Welcome, ${res.employee.name}! Opening Employee Portal...`,
      });
      setAuthPhase('success');

      // 3. Animation pause so user sees the success state and progress bar
      await new Promise(resolve => setTimeout(resolve, 1400));

      // 4. Complete employee login
      const ok = await loginEmployee(employeeId.trim(), employeePassword.trim());
      if (!ok) {
        setAuthPhase('idle');
        setError('Invalid Employee ID or Password');
      }
    } catch (err: any) {
      setAuthPhase('idle');
      setError(err?.message || 'Employee login failed. Please try again.');
    }
  };

  const handleRememberToggle = (checked: boolean) => {
    setRememberMe(checked);
    if (!checked) {
      try {
        localStorage.removeItem('worknest_remember_admin');
      } catch {}
      setEmail('');
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-scale-in">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-2xl mb-4">
            <span className="text-2xl font-bold bg-gradient-to-br from-indigo-600 to-purple-600 bg-clip-text text-transparent">WN</span>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">Worknest HR</h1>
          <p className="text-white/80 mt-1 text-sm">Complete HR &amp; Payroll Management</p>
        </div>

        {/* Mode switcher */}
        <div className="bg-white/10 backdrop-blur rounded-2xl p-1 mb-4 flex border border-white/20">
          <button
            onClick={() => { setMode('admin'); setError(''); }}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer ${
              mode === 'admin' ? 'bg-white text-indigo-700 shadow-md' : 'text-white/80 hover:text-white'
            }`}
          >
            <span>👨‍💼</span>
            <span>Admin</span>
          </button>
          <button
            onClick={() => { setMode('employee'); setError(''); setEmployeeId(''); setEmployeePassword(''); }}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer ${
              mode === 'employee' ? 'bg-white text-indigo-700 shadow-md' : 'text-white/80 hover:text-white'
            }`}
          >
            <span>👤</span>
            <span>Employee</span>
          </button>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-7 border border-white/20 relative overflow-hidden">
          {/* Animated Success Overlay */}
          {authPhase === 'success' && (
            <div className="absolute inset-0 bg-white/95 backdrop-blur-md rounded-3xl z-30 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
              {/* Pulsing glow background effect */}
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white flex items-center justify-center mb-3 shadow-xl shadow-emerald-500/30 ring-8 ring-emerald-500/15 animate-pop-success">
                <svg className="w-10 h-10 animate-checkmark-draw" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <h3 className="text-2xl font-black text-slate-900 tracking-tight flex items-center justify-center space-x-2 mt-1">
                <span>{successInfo.title}</span>
              </h3>

              <p className="text-xs font-semibold text-slate-600 mt-1 max-w-xs leading-relaxed">
                {successInfo.subtitle}
              </p>

              {/* Smooth progress bar filling up */}
              <div className="w-64 mt-5">
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner">
                  <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500 rounded-full animate-progress-fill" />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mt-2">
                  <span className="flex items-center space-x-1.5 text-emerald-600 font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <span>Access Granted</span>
                  </span>
                  <span className="text-slate-500 font-medium">Redirecting...</span>
                </div>
              </div>
            </div>
          )}

          {mode === 'admin' ? (
            <>
              <h2 className="text-2xl font-black text-slate-900 mb-1 tracking-tight">Admin Sign in</h2>
              <p className="text-xs text-slate-500 mb-5">Enter your administrator credentials to access portal</p>

              <form onSubmit={handleAdminSubmit} className="space-y-4" autoComplete="off" name="worknest_admin_auth_form">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Email / Username</label>
                  <input
                    type="email"
                    name="wn_admin_usr"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Enter admin email"
                    autoComplete={rememberMe ? "username" : "new-password"}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Password</label>
                  <input
                    type="password"
                    name="wn_admin_pwd"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete={rememberMe ? "current-password" : "new-password"}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all font-mono"
                    required
                  />
                </div>

                {error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-medium text-rose-700 animate-fade-in">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center space-x-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      checked={rememberMe}
                      onChange={e => handleRememberToggle(e.target.checked)}
                    />
                    <span className="text-slate-600 font-medium">Remember me on this device</span>
                  </label>
                  {rememberMe && (
                    <button
                      type="button"
                      onClick={() => handleRememberToggle(false)}
                      className="text-[11px] text-rose-500 hover:text-rose-700 font-semibold cursor-pointer"
                      title="Clear saved login info"
                    >
                      Clear Saved Info
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={authPhase !== 'idle'}
                  className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center space-x-2 disabled:opacity-75 cursor-pointer relative overflow-hidden active:scale-[0.99]"
                >
                  {authPhase === 'verifying' ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      <span>Verifying Credentials...</span>
                    </>
                  ) : authPhase === 'success' ? (
                    <span className="flex items-center space-x-1.5">
                      <span>✓</span>
                      <span>Login Successfully!</span>
                    </span>
                  ) : (
                    <span>Sign in as Admin</span>
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-black text-slate-900 mb-1 tracking-tight">Employee Sign in</h2>
              <p className="text-xs text-slate-500 mb-5">Apply for leave, check in &amp; view attendance</p>

              <form onSubmit={handleEmployeeSubmit} className="space-y-4" autoComplete="off" name="worknest_emp_login_form" data-lpignore="true">
                {/* Anti-autofill dummy inputs to stop browser password managers from injecting demo credentials */}
                <input type="text" className="sr-only" tabIndex={-1} aria-hidden="true" autoComplete="off" />
                <input type="password" className="sr-only" tabIndex={-1} aria-hidden="true" autoComplete="off" />

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Employee ID</label>
                  <input
                    type="text"
                    name="worknest_emp_id_field"
                    value={employeeId}
                    onChange={e => setEmployeeId(e.target.value)}
                    placeholder="Enter Employee ID"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Password</label>
                  <input
                    type="password"
                    name="worknest_emp_pin_field"
                    value={employeePassword}
                    onChange={e => setEmployeePassword(e.target.value)}
                    placeholder="Enter Password"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all font-mono"
                    required
                  />
                </div>

                {error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-medium text-rose-700 animate-fade-in">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authPhase !== 'idle'}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-600/30 transition-all flex items-center justify-center space-x-2 disabled:opacity-75 cursor-pointer relative overflow-hidden active:scale-[0.99]"
                >
                  {authPhase === 'verifying' ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      <span>Authenticating Employee...</span>
                    </>
                  ) : authPhase === 'success' ? (
                    <span className="flex items-center space-x-1.5">
                      <span>✓</span>
                      <span>Login Successfully!</span>
                    </span>
                  ) : (
                    <span>Sign in as Employee</span>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
