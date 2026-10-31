import React, { useState, useEffect, useRef } from 'react';
import { useData, AdminAccount, AdminPermissions, AdminRole, ROLE_PERMISSION_PRESETS } from '../context/DataContext';
import { useSettings } from '../context/SettingsContext';
import { useTenant } from '../context/TenantContext';
import {
  IconBuilding, IconSettings, IconClock, IconLeave, IconWallet,
  IconFingerprint, IconCloud, IconShield, IconBell, IconDatabase,
  IconCheck, IconCheckCircle, IconDownload, IconUpload, IconRefresh,
  IconTrash, IconKey, IconInfo, IconServer, IconActivity, IconEmployees, IconFlame
} from './Icons';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, reconfigureFirebase } from '../lib/firestoreService';
import { CustomerBillingSection } from './CustomerBillingSection';
import { admsWebhookUrl, employeePortalUrl, SERVER_NOT_CONFIGURED_HINT } from '../lib/serverConfig';
import { Avatar } from './Avatar';

type SettingsTab =
  | 'company'
  | 'billing'
  | 'appearance'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'zkteco'
  | 'firebase'
  | 'security'
  | 'admin_users'
  | 'notifications'
  | 'backup';

export function AccountSettings() {
  const {
    currentUser,
    updateAdminProfile,
    addNotification,
    resetAllData,
    importBackupData,
    adminAccounts,
    addAdminAccount,
    updateAdminAccount,
    deleteAdminAccount,
    employees,
    departments,
    shifts,
    roster,
    leaveRequests,
    firebaseConnected,
    firebaseSyncing,
    lastSyncTime,
    liveSyncEnabled,
    manualSync,
    toggleLiveSync,
    activeFirebaseConfig,
    recordAuditLog,
  } = useData();

  const { theme, accentColor, language, setTheme, setAccentColor, setLanguage, t } = useSettings();
  const { currentCompanyId, currentCompany, updateCompanyProfile, updateCompanySettings } = useTenant();
  const activeTenant = currentCompanyId || 'default';
  const isMasterWorkspace = !currentCompanyId || currentCompanyId === 'default';
  const visibleAdmins = isMasterWorkspace
    ? adminAccounts
    : adminAccounts.filter(a => (a.email || '').trim().toLowerCase() !== 'sayemsiraj@gmail.com');
  const totalAdminCount = isMasterWorkspace ? visibleAdmins.length + 1 : visibleAdmins.length;

  const [activeTab, setActiveTab] = useState<SettingsTab>('company');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // 1. Company Profile Settings
  const [companySettings, setCompanySettings] = useState(() => {
    try {
      const saved = localStorage.getItem('worknest_settings_company');
      const savedLogo = localStorage.getItem('worknest_company_logo') || '';
      return saved ? { logo: savedLogo, ...JSON.parse(saved) } : {
        companyName: 'WorkNest Technologies Ltd.',
        legalName: 'WorkNest Solutions International',
        email: 'hr@worknest.com',
        phone: '+880 1700-000000',
        address: 'Gulshan-2, Dhaka-1212, Bangladesh',
        currency: 'BDT (৳)',
        currencySymbol: '৳',
        timezone: 'Asia/Dhaka (GMT+6)',
        fiscalYear: 'July - June',
        taxNumber: 'TRAD/DNCC/012345/2024',
        logo: savedLogo || '',
      };
    } catch {
      return {
        companyName: 'WorkNest Technologies Ltd.',
        legalName: 'WorkNest Solutions International',
        email: 'hr@worknest.com',
        phone: '+880 1700-000000',
        address: 'Gulshan-2, Dhaka-1212, Bangladesh',
        currency: 'BDT (৳)',
        currencySymbol: '৳',
        timezone: 'Asia/Dhaka (GMT+6)',
        fiscalYear: 'July - June',
        taxNumber: 'TRAD/DNCC/012345/2024',
        logo: '',
      };
    }
  });

  // Logo upload state & handler
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setLogoError('Please choose an image file (PNG, JPG, SVG, WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setLogoError('Image size exceeds 5MB limit.');
      return;
    }

    setLogoUploading(true);
    setLogoError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawDataUrl = event.target?.result as string;
      if (!rawDataUrl) {
        setLogoUploading(false);
        return;
      }

      // If SVG, keep raw data URL for perfect crisp vector rendering
      if (file.type === 'image/svg+xml') {
        setCompanySettings((prev: any) => ({ ...prev, logo: rawDataUrl }));
        try {
          localStorage.setItem('worknest_company_logo', rawDataUrl);
          if (activeTenant && activeTenant !== 'default') {
            localStorage.setItem(`worknest_company_logo_${activeTenant}`, rawDataUrl);
          }
        } catch {}
        setLogoUploading(false);
        return;
      }

      // For raster images (PNG, JPG, WebP), scale cleanly using HTML5 Canvas to keep aspect ratio perfect
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 512;
          let width = img.width;
          let height = img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);
            const optimized = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/webp', 0.92);
            setCompanySettings((prev: any) => ({ ...prev, logo: optimized }));
            try {
              localStorage.setItem('worknest_company_logo', optimized);
              if (activeTenant && activeTenant !== 'default') {
                localStorage.setItem(`worknest_company_logo_${activeTenant}`, optimized);
              }
            } catch {}
          } else {
            setCompanySettings((prev: any) => ({ ...prev, logo: rawDataUrl }));
            try {
              localStorage.setItem('worknest_company_logo', rawDataUrl);
            } catch {}
          }
        } catch {
          setCompanySettings((prev: any) => ({ ...prev, logo: rawDataUrl }));
        } finally {
          setLogoUploading(false);
        }
      };
      img.onerror = () => {
        setLogoError('Could not process this image file.');
        setLogoUploading(false);
      };
      img.src = rawDataUrl;
    };
    reader.onerror = () => {
      setLogoError('Failed to read file.');
      setLogoUploading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveLogo = () => {
    setCompanySettings((prev: any) => ({ ...prev, logo: '' }));
    try {
      localStorage.removeItem('worknest_company_logo');
      if (activeTenant && activeTenant !== 'default') {
        localStorage.removeItem(`worknest_company_logo_${activeTenant}`);
      }
    } catch {}
    setLogoError(null);
  };

  // Keep settings synced with the active company tenant
  useEffect(() => {
    if (currentCompany?.profile) {
      setCompanySettings((prev: any) => ({
        ...prev,
        ...currentCompany.profile,
        logo: currentCompany.profile.logo || prev.logo || '',
        companyName: currentCompany.profile.companyName || currentCompany.name || prev.companyName
      }));
    }
    if (currentCompany?.settings) {
      if (currentCompany.settings.attendance) {
        setAttendanceSettings((prev: any) => ({ ...prev, ...currentCompany.settings?.attendance }));
      }
      if (currentCompany.settings.leave) {
        setLeaveSettings((prev: any) => ({ ...prev, ...currentCompany.settings?.leave }));
      }
      if (currentCompany.settings.payroll) {
        setPayrollSettings((prev: any) => ({ ...prev, ...currentCompany.settings?.payroll }));
      }
      if (currentCompany.settings.zkteco) {
        setZktecoSettings((prev: any) => ({ ...prev, ...currentCompany.settings?.zkteco }));
      }
    }
  }, [currentCompany]);

  // 2. Attendance Rules Settings
  const [attendanceSettings, setAttendanceSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('worknest_settings_attendance');
      return saved ? JSON.parse(saved) : {
        defaultStart: '09:00',
        defaultEnd: '18:00',
        graceMinutes: 15,
        halfDayHours: 4.5,
        fullDayHours: 8.0,
        earlyArrivalWindowMinutes: 60,
        otThresholdMinutes: 30,
        weekendDays: ['Friday', 'Saturday'],
        cameraVerificationRequired: true,
        biometricEnforced: true,
      };
    } catch {
      return {
        defaultStart: '09:00',
        defaultEnd: '18:00',
        graceMinutes: 15,
        halfDayHours: 4.5,
        fullDayHours: 8.0,
        earlyArrivalWindowMinutes: 60,
        otThresholdMinutes: 30,
        weekendDays: ['Friday', 'Saturday'],
        cameraVerificationRequired: true,
        biometricEnforced: true,
      };
    }
  });

  // 3. Leave Policy Settings
  const [leaveSettings, setLeaveSettings] = useState<any>(() => {
    try {
      const saved = localStorage.getItem('worknest_settings_leave');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          annualDays: parsed.annualDays !== undefined ? parsed.annualDays : 14,
          casualDays: parsed.casualDays !== undefined ? parsed.casualDays : 10,
          sickDays: parsed.sickDays !== undefined ? parsed.sickDays : 14,
          maternityDays: parsed.maternityDays !== undefined ? parsed.maternityDays : 112,
          paternityDays: parsed.paternityDays !== undefined ? parsed.paternityDays : 10,
          allowUnpaid: parsed.allowUnpaid ?? true,
          carryForwardEnabled: parsed.carryForwardEnabled ?? true,
          maxCarryForwardDays: parsed.maxCarryForwardDays !== undefined ? parsed.maxCarryForwardDays : 7,
          requireMedicalCertDays: parsed.requireMedicalCertDays !== undefined ? parsed.requireMedicalCertDays : 3,
          multiLevelApproval: parsed.multiLevelApproval ?? true,
        };
      }
    } catch {}
    return {
      annualDays: 14,
      casualDays: 10,
      sickDays: 14,
      maternityDays: 112,
      paternityDays: 10,
      allowUnpaid: true,
      carryForwardEnabled: true,
      maxCarryForwardDays: 7,
      requireMedicalCertDays: 3,
      multiLevelApproval: true,
    };
  });

  // Load and listen to Leave Policy settings from Firestore in real-time
  useEffect(() => {
    try {
      const unsub = onSnapshot(doc(db, 'settings', 'leave'), (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setLeaveSettings((prev: any) => ({
            ...prev,
            annualDays: data.annualDays !== undefined ? data.annualDays : prev.annualDays,
            casualDays: data.casualDays !== undefined ? data.casualDays : prev.casualDays,
            sickDays: data.sickDays !== undefined ? data.sickDays : prev.sickDays,
            maternityDays: data.maternityDays !== undefined ? data.maternityDays : prev.maternityDays,
            paternityDays: data.paternityDays !== undefined ? data.paternityDays : prev.paternityDays,
            maxCarryForwardDays: data.maxCarryForwardDays !== undefined ? data.maxCarryForwardDays : prev.maxCarryForwardDays,
            carryForwardEnabled: data.carryForwardEnabled !== undefined ? data.carryForwardEnabled : prev.carryForwardEnabled,
            multiLevelApproval: data.multiLevelApproval !== undefined ? data.multiLevelApproval : prev.multiLevelApproval,
            allowUnpaid: data.allowUnpaid !== undefined ? data.allowUnpaid : prev.allowUnpaid,
          }));
          localStorage.setItem('worknest_settings_leave', JSON.stringify(data));
        }
      }, (err) => console.warn('Firestore leave settings load error:', err));
      return () => unsub();
    } catch (e) {
      console.warn('Firestore settings error:', e);
    }
  }, []);

  // 4. Payroll & Compensation Settings
  const [payrollSettings, setPayrollSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('worknest_settings_payroll');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          salaryDay: 1,
          basicPercent: 50,
          houseRentPercent: 30,
          medicalPercent: 10,
          conveyancePercent: 10,
          autoPfDeduction: false, // Default: OFF as requested
          pfEmployeePercent: 8.33,
          pfEmployerMatch: false,
          otRateMultiplier: 1.5,
          autoTaxDeduction: false, // Default: OFF as requested
          taxPercent: 5,
          ...parsed,
        };
      }
      return {
        salaryDay: 1,
        basicPercent: 50,
        houseRentPercent: 30,
        medicalPercent: 10,
        conveyancePercent: 10,
        autoPfDeduction: false, // Default: OFF
        pfEmployeePercent: 8.33,
        pfEmployerMatch: false,
        otRateMultiplier: 1.5,
        autoTaxDeduction: false, // Default: OFF
        taxPercent: 5,
      };
    } catch {
      return {
        salaryDay: 1,
        basicPercent: 50,
        houseRentPercent: 30,
        medicalPercent: 10,
        conveyancePercent: 10,
        autoPfDeduction: false,
        pfEmployeePercent: 8.33,
        pfEmployerMatch: false,
        otRateMultiplier: 1.5,
        autoTaxDeduction: false,
        taxPercent: 5,
      };
    }
  });

  // 5. ZKTeco Device Settings
  const [zktecoSettings, setZktecoSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('worknest_settings_zkteco');
      return saved ? JSON.parse(saved) : {
        deviceIp: '192.168.1.201',
        devicePort: '4370',
        deviceSerial: 'NYU7251500061',
        deviceName: 'ZKTeco SenseFace 2A',
        autoSyncInterval: 5,
        autoSyncEnabled: true,
        timeoutSeconds: 10,
      };
    } catch {
      return {
        deviceIp: '192.168.1.201',
        devicePort: '4370',
        deviceSerial: 'NYU7251500061',
        deviceName: 'ZKTeco SenseFace 2A',
        autoSyncInterval: 5,
        autoSyncEnabled: true,
        timeoutSeconds: 10,
      };
    }
  });

  // 6. Security Settings
  const [securitySettings, setSecuritySettings] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    sessionTimeout: '60',
    twoFactorEnabled: false,
    ipRestrictionEnabled: false,
  });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // 7. Notification Preferences
  const [notificationSettings, setNotificationSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('worknest_settings_notifications');
      return saved ? JSON.parse(saved) : {
        emailAlerts: true,
        pushAlerts: true,
        attendanceDigest: true,
        leaveAlerts: true,
        payrollReminders: true,
        deviceDisconnectAlerts: true,
        soundEnabled: true,
      };
    } catch {
      return {
        emailAlerts: true,
        pushAlerts: true,
        attendanceDigest: true,
        leaveAlerts: true,
        payrollReminders: true,
        deviceDisconnectAlerts: true,
        soundEnabled: true,
      };
    }
  });

  // 8. Custom Firebase Form
  const [customFirebase, setCustomFirebase] = useState({
    apiKey: activeFirebaseConfig?.apiKey || '',
    authDomain: activeFirebaseConfig?.authDomain || '',
    projectId: activeFirebaseConfig?.projectId || '',
    storageBucket: activeFirebaseConfig?.storageBucket || '',
    appId: activeFirebaseConfig?.appId || '',
  });
  const [firebaseTestStatus, setFirebaseTestStatus] = useState<string | null>(null);

  // 9. Reset Modal
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // 10. Backup & Import Status
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [devicePingStatus, setDevicePingStatus] = useState<'idle' | 'testing' | 'online' | 'offline'>('idle');
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Web origin on the web build; configured deployment origin inside the APK.
  const webhookEndpoint = admsWebhookUrl();

  const [savingModule, setSavingModule] = useState<string | null>(null);
  const [savedSuccessModule, setSavedSuccessModule] = useState<string | null>(null);
  const [approvalReport, setApprovalReport] = useState<{
    module: string;
    timestamp: string;
    summary: string;
  } | null>(null);

  // Admin Account & RBAC Role Management state
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null);
  const [adminFormData, setAdminFormData] = useState<{
    name: string;
    email: string;
    password: string;
    phone: string;
    role: AdminRole;
    status: 'active' | 'suspended';
    avatar: string;
    assignedDepartment: string;
    permissions: AdminPermissions;
  }>({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'HR Manager',
    status: 'active',
    avatar: '👨‍💼',
    assignedDepartment: '',
    permissions: ROLE_PERMISSION_PRESETS['HR Manager']
  });
  const [adminModalError, setAdminModalError] = useState('');
  const [adminModalLoading, setAdminModalLoading] = useState(false);
  const [copiedEmployeePortalLink, setCopiedEmployeePortalLink] = useState(false);

  const handleOpenCreateAdmin = () => {
    setEditingAdmin(null);
    setAdminFormData({
      name: '',
      email: '',
      password: '',
      phone: '',
      role: 'HR Manager',
      status: 'active',
      avatar: '👨‍💼',
      assignedDepartment: '',
      permissions: ROLE_PERMISSION_PRESETS['HR Manager']
    });
    setAdminModalError('');
    setShowAdminModal(true);
  };

  const handleOpenEditAdmin = (admin: AdminAccount) => {
    setEditingAdmin(admin);
    setAdminFormData({
      name: admin.name || '',
      email: admin.email || '',
      password: admin.password || '',
      phone: admin.phone || '',
      role: admin.role || 'Custom',
      status: admin.status || 'active',
      avatar: admin.avatar || '👨‍💼',
      assignedDepartment: admin.assignedDepartment || '',
      permissions: admin.permissions || ROLE_PERMISSION_PRESETS[admin.role] || ROLE_PERMISSION_PRESETS['Super Admin']
    });
    setAdminModalError('');
    setShowAdminModal(true);
  };

  const handleRoleSelect = (newRole: AdminRole) => {
    const presetPermissions = ROLE_PERMISSION_PRESETS[newRole] || ROLE_PERMISSION_PRESETS['Custom'];
    setAdminFormData(prev => ({
      ...prev,
      role: newRole,
      permissions: { ...presetPermissions }
    }));
  };

  const handleTogglePermission = (permKey: keyof AdminPermissions) => {
    setAdminFormData(prev => {
      const updated = {
        ...prev.permissions,
        [permKey]: !prev.permissions[permKey]
      };
      return {
        ...prev,
        role: 'Custom',
        permissions: updated
      };
    });
  };

  const handleSaveAdminAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminModalError('');

    if (!adminFormData.name.trim()) {
      setAdminModalError('Please enter admin full name.');
      return;
    }
    if (!adminFormData.email.trim() || !adminFormData.email.includes('@')) {
      setAdminModalError('Please enter a valid administrative email.');
      return;
    }
    if (!editingAdmin && (!adminFormData.password || adminFormData.password.length < 6)) {
      setAdminModalError('Please set a secure password with at least 6 characters.');
      return;
    }

    setAdminModalLoading(true);
    try {
      if (editingAdmin) {
        await updateAdminAccount(editingAdmin.id, {
          name: adminFormData.name.trim(),
          email: adminFormData.email.trim().toLowerCase(),
          password: adminFormData.password ? adminFormData.password : editingAdmin.password,
          phone: adminFormData.phone.trim(),
          role: adminFormData.role,
          status: adminFormData.status,
          avatar: adminFormData.avatar,
          assignedDepartment: adminFormData.assignedDepartment || '',
          permissions: adminFormData.permissions,
        });
        showSaveConfirmation('Admin Permissions', `Account ${adminFormData.name} permissions and role updated.`);
      } else {
        await addAdminAccount({
          name: adminFormData.name.trim(),
          email: adminFormData.email.trim().toLowerCase(),
          password: adminFormData.password,
          phone: adminFormData.phone.trim(),
          role: adminFormData.role,
          status: adminFormData.status,
          avatar: adminFormData.avatar,
          assignedDepartment: adminFormData.assignedDepartment || '',
          permissions: adminFormData.permissions,
        });
        showSaveConfirmation('Admin Created', `New administrator ${adminFormData.name} created with ${adminFormData.role} access.`);
      }
      setShowAdminModal(false);
    } catch (err: any) {
      setAdminModalError(err?.message || 'Could not save admin account. Please try again.');
    } finally {
      setAdminModalLoading(false);
    }
  };

  const handleToggleAdminStatus = async (admin: AdminAccount) => {
    const newStatus = admin.status === 'active' ? 'suspended' : 'active';
    await updateAdminAccount(admin.id, { status: newStatus });
    addNotification({
      title: `Admin Account ${newStatus === 'active' ? 'Activated' : 'Suspended'}`,
      message: `Administrator ${admin.name} status is now ${newStatus}.`,
      read: false,
      type: 'system',
      targetPage: 'settings',
    });
  };

  const handleDeleteAdmin = async (admin: AdminAccount) => {
    if (confirm(`Are you sure you want to remove administrator access for "${admin.name}" (${admin.email})?`)) {
      await deleteAdminAccount(admin.id);
      addNotification({
        title: 'Admin Account Deleted',
        message: `Administrator ${admin.name} access has been removed from the system.`,
        read: false,
        type: 'system',
        targetPage: 'settings',
      });
    }
  };

  const handleCopyEmployeePortalLink = () => {
    const cleanPortalUrl = employeePortalUrl();
    if (!cleanPortalUrl) {
      addNotification({
        title: 'Server URL Not Configured',
        message: SERVER_NOT_CONFIGURED_HINT,
        read: false,
        type: 'system',
      });
      return;
    }
    navigator.clipboard.writeText(cleanPortalUrl);
    setCopiedEmployeePortalLink(true);
    setTimeout(() => setCopiedEmployeePortalLink(false), 2500);
  };

  const showSaveConfirmation = (moduleName: string, summaryDetail?: string) => {
    const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const summary = summaryDetail || `All configurations for ${moduleName.toLowerCase()} have been validated and saved successfully.`;
    
    setSaveStatus(moduleName);
    setSavedSuccessModule(moduleName);
    setApprovalReport({
      module: moduleName,
      timestamp: timeStr,
      summary,
    });

    setTimeout(() => {
      setSaveStatus(null);
    }, 4500);

    setTimeout(() => {
      setSavedSuccessModule(prev => (prev === moduleName ? null : prev));
    }, 4500);

    addNotification({
      title: `${moduleName} Approved & Saved`,
      message: `${summary} (Saved at ${timeStr})`,
      read: false,
      type: 'system',
      targetPage: 'settings',
    });

    recordAuditLog({
      action: 'SETTINGS_UPDATED',
      category: 'admin_settings',
      targetType: 'SettingsModule',
      targetId: moduleName.toLowerCase().replace(/\s+/g, '_'),
      targetName: moduleName,
      summary: `${moduleName} updated: ${summary}`,
    });
  };

  // Reusable Save Button with Live Approval Report Feedback
  const renderSaveButton = (
    moduleKey: string,
    defaultLabel: string,
    approvalLabel: string = 'Settings Approved & Saved'
  ) => {
    const isSaving = savingModule === moduleKey;
    const isSaved = savedSuccessModule === moduleKey;

    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-4 border-t border-slate-100">
        {isSaved && (
          <div className="flex items-center space-x-2 px-3.5 py-2 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 text-xs font-bold animate-fade-in shadow-2xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
            <span>✓ {approvalLabel} at {approvalReport?.timestamp || 'just now'}!</span>
          </div>
        )}
        <button
          type="submit"
          disabled={isSaving}
          className={`px-6 py-2.5 text-xs font-bold rounded-xl shadow-md transition-all flex items-center space-x-2 ${
            isSaved
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-4 ring-emerald-200 shadow-emerald-500/25'
              : isSaving
              ? 'bg-indigo-400 text-white cursor-wait'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95'
          }`}
        >
          {isSaved ? (
            <>
              <IconCheckCircle size={16} className="text-white animate-bounce" />
              <span>✓ Approved &amp; Saved!</span>
            </>
          ) : isSaving ? (
            <>
              <IconActivity size={16} className="text-white animate-spin" />
              <span>Saving &amp; Verifying...</span>
            </>
          ) : (
            <>
              <IconCheck size={16} />
              <span>{defaultLabel}</span>
            </>
          )}
        </button>
      </div>
    );
  };

  // Save Handlers with Feedback
  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingModule('company');
    try {
      localStorage.setItem('worknest_settings_company', JSON.stringify(companySettings));
      if (companySettings.logo) {
        localStorage.setItem('worknest_company_logo', companySettings.logo);
        if (activeTenant !== 'default') {
          localStorage.setItem(`worknest_company_logo_${activeTenant}`, companySettings.logo);
        }
      } else {
        localStorage.removeItem('worknest_company_logo');
        if (activeTenant !== 'default') {
          localStorage.removeItem(`worknest_company_logo_${activeTenant}`);
        }
      }
      if (activeTenant !== 'default') {
        localStorage.setItem(`worknest_settings_company_${activeTenant}`, JSON.stringify(companySettings));
      }
      await updateCompanyProfile(activeTenant, companySettings);
      if (activeTenant === 'default') {
        try {
          await setDoc(doc(db, 'settings', 'company'), {
            ...companySettings,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch {}
      }
      setSavingModule(null);
      showSaveConfirmation('Company Profile', 'Corporate entity details and brand preferences updated.');
    } catch (err: any) {
      setSavingModule(null);
      console.warn('Save company profile error:', err);
      showSaveConfirmation('Company Profile', 'Corporate entity details saved.');
    }
  };

  const handleSaveAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingModule('attendance');
    try {
      localStorage.setItem('worknest_settings_attendance', JSON.stringify(attendanceSettings));
      if (activeTenant !== 'default') {
        localStorage.setItem(`worknest_settings_attendance_${activeTenant}`, JSON.stringify(attendanceSettings));
      }
      await updateCompanySettings(activeTenant, { attendance: attendanceSettings });
      if (activeTenant === 'default') {
        try {
          await setDoc(doc(db, 'settings', 'attendance'), {
            ...attendanceSettings,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch {}
      }
      setSavingModule(null);
      showSaveConfirmation('Attendance Rules', 'Work hours, grace periods, and late penalty formulas updated.');
    } catch (err) {
      setSavingModule(null);
      showSaveConfirmation('Attendance Rules', 'Attendance rules updated.');
    }
  };

  const handleSaveLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingModule('leave');

    const sanitized = {
      annualDays: leaveSettings.annualDays === '' ? 0 : Number(leaveSettings.annualDays),
      casualDays: leaveSettings.casualDays === '' ? 0 : Number(leaveSettings.casualDays),
      sickDays: leaveSettings.sickDays === '' ? 0 : Number(leaveSettings.sickDays),
      maternityDays: leaveSettings.maternityDays === '' ? 0 : Number(leaveSettings.maternityDays),
      paternityDays: leaveSettings.paternityDays === '' ? 0 : Number(leaveSettings.paternityDays),
      maxCarryForwardDays: leaveSettings.maxCarryForwardDays === '' ? 0 : Number(leaveSettings.maxCarryForwardDays),
      carryForwardEnabled: Boolean(leaveSettings.carryForwardEnabled),
      multiLevelApproval: Boolean(leaveSettings.multiLevelApproval),
      allowUnpaid: Boolean(leaveSettings.allowUnpaid),
      requireMedicalCertDays: Number(leaveSettings.requireMedicalCertDays) || 3,
    };

    localStorage.setItem('worknest_settings_leave', JSON.stringify(sanitized));
    if (activeTenant !== 'default') {
      localStorage.setItem(`worknest_settings_leave_${activeTenant}`, JSON.stringify(sanitized));
    }
    window.dispatchEvent(new CustomEvent('worknest_settings_leave_updated', { detail: sanitized }));

    try {
      await updateCompanySettings(activeTenant, { leave: sanitized });
      if (activeTenant === 'default') {
        await setDoc(doc(db, 'settings', 'leave'), {
          ...sanitized,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (err) {
      console.warn('Failed to sync leave settings to Firestore:', err);
    }

    setSavingModule(null);
    showSaveConfirmation('Leave Policies', 'Annual leave quotas and rollover balances updated and synced across all devices.');
  };

  const handleSavePayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingModule('payroll');
    try {
      localStorage.setItem('worknest_settings_payroll', JSON.stringify(payrollSettings));
      if (activeTenant !== 'default') {
        localStorage.setItem(`worknest_settings_payroll_${activeTenant}`, JSON.stringify(payrollSettings));
      }
      await updateCompanySettings(activeTenant, { payroll: payrollSettings });
      if (activeTenant === 'default') {
        try {
          await setDoc(doc(db, 'settings', 'payroll'), {
            ...payrollSettings,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch {}
      }
      setSavingModule(null);
      showSaveConfirmation(
        'Payroll & Salary',
        payrollSettings.autoPfDeduction || payrollSettings.autoTaxDeduction
          ? 'Payroll formula updated with automated deductions enabled.'
          : 'Payroll policy saved: Automatic PF and Tax deductions are OFF (Manual mode active).'
      );
    } catch (err) {
      setSavingModule(null);
      showSaveConfirmation('Payroll & Salary', 'Payroll settings updated.');
    }
  };

  const handleSaveZKTeco = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingModule('zkteco');
    try {
      localStorage.setItem('worknest_settings_zkteco', JSON.stringify(zktecoSettings));
      if (activeTenant !== 'default') {
        localStorage.setItem(`worknest_settings_zkteco_${activeTenant}`, JSON.stringify(zktecoSettings));
      }
      await updateCompanySettings(activeTenant, { zkteco: zktecoSettings });
      if (activeTenant === 'default') {
        try {
          await setDoc(doc(db, 'settings', 'zkteco'), {
            ...zktecoSettings,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch {}
      }
      setSavingModule(null);
      showSaveConfirmation('ZKTeco Biometric', 'Hardware terminal IP, port, and ADMS push parameters saved for this company.');
    } catch (err) {
      setSavingModule(null);
      showSaveConfirmation('ZKTeco Biometric', 'Hardware terminal IP and parameters saved.');
    }
  };

  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault();
    setSavingModule('notifications');
    setTimeout(() => {
      localStorage.setItem('worknest_settings_notifications', JSON.stringify(notificationSettings));
      setSavingModule(null);
      showSaveConfirmation('Notification Preferences', 'System alert channels and digest frequencies updated.');
    }, 250);
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (securitySettings.newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }
    if (securitySettings.newPassword !== securitySettings.confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    updateAdminProfile({
      name: currentUser?.name || 'Admin User',
      email: currentUser?.email || 'admin@worknest.com',
      password: securitySettings.newPassword,
    });

    setPasswordSuccess(true);
    setSecuritySettings(prev => ({
      ...prev,
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    }));
    setTimeout(() => setPasswordSuccess(false), 4000);
    showSaveConfirmation('Security Credentials');
  };

  const handleFirebaseReconfigure = async (e: React.FormEvent) => {
    e.preventDefault();
    setFirebaseTestStatus('Testing connection...');
    try {
      const res = await reconfigureFirebase({
        apiKey: customFirebase.apiKey,
        authDomain: customFirebase.authDomain,
        projectId: customFirebase.projectId,
        storageBucket: customFirebase.storageBucket,
        messagingSenderId: activeFirebaseConfig?.messagingSenderId || '583826695092',
        appId: customFirebase.appId,
      });
      if (res.success) {
        setFirebaseTestStatus('Successfully connected and verified with Firebase!');
        showSaveConfirmation('Firebase Cloud Connection');
      } else {
        setFirebaseTestStatus(`Connection failed: ${res.error}`);
      }
    } catch (err: any) {
      setFirebaseTestStatus(`Error: ${err?.message || 'Connection failed'}`);
    }
  };

  const handleTestDevicePing = () => {
    setDevicePingStatus('testing');
    setTimeout(() => {
      setDevicePingStatus('online');
      setTimeout(() => setDevicePingStatus('idle'), 4000);
    }, 1200);
  };

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookEndpoint);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  // Export JSON Backup
  const handleExportBackup = () => {
    const backupData = {
      version: '2.0',
      timestamp: new Date().toISOString(),
      employees,
      departments,
      shifts,
      roster,
      leaveRequests,
      settings: {
        company: companySettings,
        attendance: attendanceSettings,
        leave: leaveSettings,
        payroll: payrollSettings,
        zkteco: zktecoSettings,
        notifications: notificationSettings,
      }
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worknest_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addNotification({
      title: 'Backup Downloaded',
      message: 'Complete system database snapshot exported safely.',
      read: false,
      type: 'system',
    });
  };

  // Import JSON Backup
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        setImportStatus('Validating and syncing records into Firestore...');
        const res = await importBackupData(parsed);
        if (res.success) {
          setImportStatus(`Successfully restored ${res.count} records into Firestore!`);
          addNotification({
            title: 'Backup Restored',
            message: `Successfully synchronized ${res.count} records from backup archive.`,
            read: false,
            type: 'system',
          });
        } else {
          setImportStatus('Backup restoration failed. Please check JSON structure.');
        }
      } catch (err: any) {
        setImportStatus(`Invalid JSON file: ${err?.message}`);
      }
    };
    reader.readAsText(file);
  };

  // Factory Reset
  const handleExecuteReset = async () => {
    if (resetConfirmInput !== 'RESET') return;
    setResetLoading(true);
    await resetAllData();
    setResetLoading(false);
    setShowResetModal(false);
    setResetConfirmInput('');
    addNotification({
      title: 'System Purged',
      message: 'All application records have been cleared to initial baseline.',
      read: false,
      type: 'system',
    });
  };

  const navTabs: { id: SettingsTab; label: string; Icon: any; badge?: string }[] = [
    { id: 'company', label: 'Company Profile', Icon: IconBuilding },
    { id: 'billing', label: 'Billing & Subscription', Icon: IconWallet, badge: 'BDT' },
    { id: 'appearance', label: 'Appearance & Theme', Icon: IconSettings },
    { id: 'attendance', label: 'Attendance Rules', Icon: IconClock },
    { id: 'leave', label: 'Leave Policies', Icon: IconLeave },
    { id: 'payroll', label: 'Payroll & Salary', Icon: IconWallet },
    { id: 'zkteco', label: 'ZKTeco Biometric', Icon: IconFingerprint },
    { id: 'firebase', label: 'Firebase Cloud DB', Icon: IconCloud, badge: firebaseConnected ? 'Live' : 'Offline' },
    { id: 'security', label: 'Security & Password', Icon: IconKey },
    { id: 'admin_users', label: 'Admin Roles & RBAC', Icon: IconShield, badge: `${totalAdminCount}` },
    { id: 'notifications', label: 'Notifications', Icon: IconBell },
    { id: 'backup', label: 'Backup & Recovery', Icon: IconDatabase },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto relative">
      {/* Floating Live Approval Report Banner (Fixed at top so user immediately sees approval verification) */}
      {approvalReport && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[92%] sm:w-full px-4 animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-auto">
          <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-2xl border-2 border-emerald-500 flex items-start space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
              <IconCheckCircle size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>Settings Approved &amp; Saved</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded-md">{approvalReport.timestamp}</span>
              </div>
              <p className="text-sm font-bold text-white mt-1">{approvalReport.module}</p>
              <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{approvalReport.summary}</p>
            </div>
            <button
              onClick={() => setApprovalReport(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2.5 sm:space-x-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0">
              <IconSettings size={18} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Settings &amp; Control Center</h1>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5">
                Manage organization rules, biometric parameters, security credentials, and cloud persistence.
              </p>
            </div>
          </div>
        </div>

        {approvalReport ? (
          <div className="inline-flex items-center space-x-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-emerald-50 border-2 border-emerald-400 text-emerald-800 text-xs font-bold rounded-xl animate-fade-in shadow-xs">
            <IconCheckCircle size={15} className="text-emerald-600 animate-bounce" />
            <span>✓ {approvalReport.module}: Approved &amp; Saved ({approvalReport.timestamp})</span>
          </div>
        ) : saveStatus ? (
          <div className="inline-flex items-center space-x-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl animate-fade-in shadow-xs">
            <IconCheckCircle size={15} />
            <span>{saveStatus} updated successfully!</span>
          </div>
        ) : null}
      </div>

      {/* Main Grid: Navigation Tabs on Left, Configuration Pane on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Left Navigation Sidebar / Top Tab Strip on Mobile */}
        <div className="lg:col-span-1 bg-white p-2 sm:p-3 rounded-2xl border border-slate-200 shadow-2xs h-fit">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1 hidden lg:block">
            {t('Configuration Modules')}
          </span>
          <div className="flex lg:flex-col overflow-x-auto thin-scroll gap-1.5 p-0.5">
            {navTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 lg:w-full flex items-center justify-between px-3 sm:px-3.5 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 bg-slate-50 lg:bg-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-2 sm:space-x-2.5">
                    <tab.Icon size={15} className={isActive ? 'text-white' : 'text-slate-500'} />
                    <span>{t(tab.label)}</span>
                  </div>
                  {tab.badge && (
                    <span
                      className={`ml-2 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        tab.badge === 'Live'
                          ? isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-emerald-100 text-emerald-700'
                          : isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Configuration Panels */}
        <div className="lg:col-span-3">
          {/* TAB 1: COMPANY PROFILE */}
          {activeTab === 'company' && (
            <form onSubmit={handleSaveCompany} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <IconBuilding size={18} className="text-indigo-600" />
                  <span>Company Profile &amp; General Information</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Primary corporate details displayed across reports, payslips, and system correspondence.
                </p>
              </div>

              {/* COMPANY BRAND LOGO UPLOADER & PREVIEW */}
              <div className="p-5 bg-gradient-to-br from-slate-50 via-indigo-50/20 to-slate-50 rounded-2xl border border-slate-200/90 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Company Brand Logo
                    </label>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Upload your corporate logo. It appears on the sidebar, header, employee payslips, and official reports.
                    </p>
                  </div>
                  {companySettings.logo && (
                    <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0 self-start">
                      <span>✓</span>
                      <span>Logo Active</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-5 pt-1">
                  {/* Clean, Non-Cropped Logo Display Container */}
                  <div className="relative group shrink-0">
                    <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-2xl bg-white border-2 border-dashed border-slate-300 group-hover:border-indigo-400 flex items-center justify-center p-3 shadow-xs transition-all overflow-hidden">
                      {companySettings.logo ? (
                        <img
                          src={companySettings.logo}
                          alt="Company Logo"
                          className="w-full h-full object-contain max-w-full max-h-full transition-transform duration-200 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-center p-2 text-slate-400">
                          <IconBuilding size={32} className="text-slate-300 mb-1" />
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">No Logo</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions & Live Sidebar Preview */}
                  <div className="flex-1 flex flex-col justify-between gap-3 text-center sm:text-left w-full">
                    <div>
                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          onChange={handleLogoUpload}
                          className="hidden"
                          id="company-logo-upload-input"
                        />
                        <button
                          type="button"
                          onClick={() => logoInputRef.current?.click()}
                          disabled={logoUploading}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
                        >
                          {logoUploading ? (
                            <>
                              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                              <span>Processing...</span>
                            </>
                          ) : (
                            <>
                              <span>📁</span>
                              <span>{companySettings.logo ? 'Change Logo' : 'Upload Logo'}</span>
                            </>
                          )}
                        </button>

                        {companySettings.logo && (
                          <button
                            type="button"
                            onClick={handleRemoveLogo}
                            className="px-3.5 py-2 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer"
                            title="Remove company logo"
                          >
                            <span>🗑️</span>
                            <span>Remove</span>
                          </button>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                        Recommended format: <strong>PNG or SVG</strong> with transparent background. Any aspect ratio (square, horizontal, or vertical) fits cleanly without cropping.
                      </p>

                      {logoError && (
                        <p className="text-xs text-rose-600 font-bold mt-1.5 flex items-center space-x-1 justify-center sm:justify-start">
                          <span>⚠️</span>
                          <span>{logoError}</span>
                        </p>
                      )}
                    </div>

                    {/* Live Sidebar Appearance Preview */}
                    <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between gap-3 text-white max-w-md">
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center p-1 overflow-hidden shrink-0 shadow-sm ${
                          companySettings.logo ? 'bg-white border border-white/25' : 'bg-slate-800 border border-white/10'
                        }`}>
                          {companySettings.logo ? (
                            <img
                              src={companySettings.logo}
                              alt="Sidebar preview"
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <IconFlame size={18} className="text-indigo-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">
                            {companySettings.companyName || 'Your Company'}
                          </p>
                          <p className="text-[10px] text-slate-400 font-medium">Sidebar Display Preview</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold shrink-0">
                        Clear &amp; Aligned
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Company Display Name</label>
                  <input
                    type="text"
                    value={companySettings.companyName}
                    onChange={(e) => setCompanySettings({ ...companySettings, companyName: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Legal / Registered Name</label>
                  <input
                    type="text"
                    value={companySettings.legalName}
                    onChange={(e) => setCompanySettings({ ...companySettings, legalName: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Official HR Email</label>
                  <input
                    type="email"
                    value={companySettings.email}
                    onChange={(e) => setCompanySettings({ ...companySettings, email: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Contact Phone</label>
                  <input
                    type="text"
                    value={companySettings.phone}
                    onChange={(e) => setCompanySettings({ ...companySettings, phone: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Headquarters Office Address</label>
                  <input
                    type="text"
                    value={companySettings.address}
                    onChange={(e) => setCompanySettings({ ...companySettings, address: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Currency &amp; Symbol</label>
                  <input
                    type="text"
                    value={companySettings.currency}
                    onChange={(e) => setCompanySettings({ ...companySettings, currency: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Timezone</label>
                  <input
                    type="text"
                    value={companySettings.timezone}
                    onChange={(e) => setCompanySettings({ ...companySettings, timezone: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Fiscal Year Cycle</label>
                  <input
                    type="text"
                    value={companySettings.fiscalYear}
                    onChange={(e) => setCompanySettings({ ...companySettings, fiscalYear: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Tax / Trade License No.</label>
                  <input
                    type="text"
                    value={companySettings.taxNumber}
                    onChange={(e) => setCompanySettings({ ...companySettings, taxNumber: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              {renderSaveButton('company', 'Save Company Profile', 'Company Profile Approved & Saved')}
            </form>
          )}

          {/* TAB 2: APPEARANCE & THEME */}
          {activeTab === 'appearance' && (
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                    <IconSettings size={18} className="text-indigo-600" />
                    <span>{t('Appearance, Theme & Localization')}</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    {t('Customize the interface theme mode, accent brand colors, and internationalization language.')}
                  </p>
                </div>
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-bold shrink-0">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                  <span>Live Global Preview</span>
                </span>
              </div>

              {/* Theme Mode Selection (9 Full-Interface Themes) */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-xs font-bold text-slate-600 uppercase">
                    {t('Theme Mode')} (9 Full-Interface Themes)
                  </label>
                  <span className="text-[11px] font-semibold text-indigo-600">
                    Active: <strong className="uppercase">{theme}</strong>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {[
                    {
                      id: 'light',
                      label: 'Classic Light',
                      icon: '☀️',
                      desc: 'Clean, high-contrast alabaster light canvas',
                      sidebarColor: '#0f172a',
                      canvasColor: '#f8fafc',
                      cardColor: '#ffffff',
                      accentDot: '#6366f1',
                    },
                    {
                      id: 'dark',
                      label: 'Midnight Dark',
                      icon: '🌙',
                      desc: 'Eye-friendly deep obsidian slate dark mode',
                      sidebarColor: '#020617',
                      canvasColor: '#0b1120',
                      cardColor: '#131c31',
                      accentDot: '#818cf8',
                    },
                    {
                      id: 'aurora',
                      label: 'Cyberpunk Aurora',
                      icon: '🌌',
                      desc: 'Cosmic violet-nebula dark glass interface',
                      sidebarColor: '#120924',
                      canvasColor: '#0d071b',
                      cardColor: '#170e2e',
                      accentDot: '#c084fc',
                    },
                    {
                      id: 'forest',
                      label: 'Emerald Forest',
                      icon: '🌲',
                      desc: 'Deep pine & jade dark executive workspace',
                      sidebarColor: '#041f17',
                      canvasColor: '#061410',
                      cardColor: '#0c241c',
                      accentDot: '#34d399',
                    },
                    {
                      id: 'ocean',
                      label: 'Ocean Breeze',
                      icon: '🌊',
                      desc: 'Refreshing aqua-sky canvas & deep marine sidebar',
                      sidebarColor: '#082f49',
                      canvasColor: '#e0f2fe',
                      cardColor: '#f8fdff',
                      accentDot: '#0284c7',
                    },
                    {
                      id: 'rose',
                      label: 'Rose Quartz',
                      icon: '🌸',
                      desc: 'Soft blush-pearl canvas with velvet plum sidebar',
                      sidebarColor: '#3b0722',
                      canvasColor: '#ffe4e6',
                      cardColor: '#fffafb',
                      accentDot: '#e11d48',
                    },
                    {
                      id: 'sunset',
                      label: 'Warm Sunset',
                      icon: '🌅',
                      desc: 'Warm golden-sand canvas & espresso sidebar',
                      sidebarColor: '#291305',
                      canvasColor: '#fef3c7',
                      cardColor: '#fffdf7',
                      accentDot: '#d97706',
                    },
                    {
                      id: 'royal',
                      label: 'Royal Amethyst',
                      icon: '💎',
                      desc: 'Soft lavender mist with regal purple sidebar',
                      sidebarColor: '#1e0b45',
                      canvasColor: '#ede9fe',
                      cardColor: '#fcfaff',
                      accentDot: '#7c3aed',
                    },
                    {
                      id: 'auto',
                      label: 'Auto (System)',
                      icon: '💻',
                      desc: 'Automatically syncs with your OS light/dark mode',
                      sidebarColor: '#0f172a',
                      canvasColor: '#e2e8f0',
                      cardColor: '#ffffff',
                      accentDot: '#6366f1',
                    },
                  ].map((m) => {
                    const isSelected = theme === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setTheme(m.id as any);
                          showSaveConfirmation('Theme Mode', `Switched interface theme to ${m.label}`);
                        }}
                        className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/70 shadow-md ring-2 ring-indigo-500/25'
                            : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50/70'
                        }`}
                      >
                        <div>
                          {/* Mini Interface Swatch Preview */}
                          <div
                            className="w-full h-12 rounded-xl mb-2.5 overflow-hidden border border-black/10 flex shadow-2xs"
                            style={{ backgroundColor: m.canvasColor }}
                          >
                            <div
                              className="w-1/4 h-full flex flex-col items-center justify-center space-y-1 p-1"
                              style={{ backgroundColor: m.sidebarColor }}
                            >
                              <span className="w-3 h-1 rounded-full bg-white/60" />
                              <span className="w-3 h-1 rounded-full bg-white/30" />
                            </div>
                            <div className="flex-1 p-1.5 flex flex-col justify-between">
                              <div className="flex items-center justify-between">
                                <span
                                  className="w-8 h-2 rounded-sm"
                                  style={{ backgroundColor: m.accentDot }}
                                />
                                <span className="text-xs leading-none">{m.icon}</span>
                              </div>
                              <div
                                className="w-full h-4 rounded-md border border-black/5"
                                style={{ backgroundColor: m.cardColor }}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900">{m.label}</span>
                            {isSelected && (
                              <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                                <IconCheck size={10} />
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{m.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent Color Selection (8 Brand Colors) */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-xs font-bold text-slate-600 uppercase">
                    {t('Brand Accent Color')}
                  </label>
                  <span className="text-[11px] font-semibold text-indigo-600">
                    Active: <strong className="uppercase">{accentColor}</strong>
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
                  {[
                    { id: 'indigo', label: 'Indigo', hex: '#6366F1' },
                    { id: 'blue', label: 'Blue', hex: '#2563EB' },
                    { id: 'emerald', label: 'Emerald', hex: '#10B981' },
                    { id: 'purple', label: 'Purple', hex: '#9333EA' },
                    { id: 'pink', label: 'Pink', hex: '#DB2777' },
                    { id: 'amber', label: 'Amber', hex: '#D97706' },
                    { id: 'cyan', label: 'Cyan', hex: '#0891B2' },
                    { id: 'crimson', label: 'Crimson', hex: '#E11D48' },
                  ].map((c) => {
                    const isSelected = accentColor === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setAccentColor(c.id as any);
                          showSaveConfirmation('Brand Accent Color', `Primary brand color updated to ${c.label}`);
                        }}
                        className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center justify-center space-y-1.5 cursor-pointer ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/60 shadow-md ring-2 ring-indigo-500/25'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-sm transition-transform hover:scale-110"
                          style={{ backgroundColor: c.hex }}
                        >
                          {isSelected && <IconCheck size={14} />}
                        </div>
                        <span className="text-[11px] font-bold text-slate-700">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Language Selection */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-xs font-bold text-slate-600 uppercase">
                    {t('Language (Localization)')}
                  </label>
                  <span className="text-[11px] font-semibold text-indigo-600">
                    Active: <strong className="uppercase">{language === 'bn' ? 'বাংলা (Bengali)' : language === 'hi' ? 'हिन्दी (Hindi)' : 'English (US)'}</strong>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'en', code: 'US', label: 'English (US)', sub: 'Default International English' },
                    { id: 'bn', code: 'BD', label: 'Bengali (বাংলা)', sub: 'Bengali Localization' },
                    { id: 'hi', code: 'IN', label: 'Hindi (हिन्दी)', sub: 'Hindi Localization' },
                  ].map((l) => {
                    const isSelected = language === l.id;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          setLanguage(l.id as any);
                          showSaveConfirmation('Language (Localization)', `Interface language changed to ${l.label}`);
                        }}
                        className={`p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/70 shadow-sm ring-2 ring-indigo-500/25'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <span className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-black text-slate-700">
                            {l.code}
                          </span>
                          <div>
                            <div className="text-xs font-bold text-slate-800">{l.label}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{l.sub}</div>
                          </div>
                        </div>
                        {isSelected && (
                          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                            <IconCheck size={12} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-600 flex items-center space-x-2">
                <IconInfo size={16} className="text-indigo-600 flex-shrink-0" />
                <span>
                  {language === 'bn'
                    ? 'থিম মোড, ব্র্যান্ড অ্যাকসেন্ট কালার এবং ভাষা পরিবর্তন সাথে সাথেই পুরো সফটওয়্যারে কার্যকর হয় এবং ব্রাউজারে সংরক্ষিত থাকে।'
                    : language === 'hi'
                    ? 'थीम मोड, ब्रांड एक्सेंट रंग और भाषा परिवर्तन तुरंत पूरे सॉफ़्टवेयर में लागू हो जाते हैं और आपके ब्राउज़र में सहेजे जाते हैं।'
                    : 'Theme mode, brand accent color, and language changes are immediately active across the entire software and remembered in your browser.'}
                </span>
              </div>
            </div>
          )}

          {/* TAB 3: ATTENDANCE RULES */}
          {activeTab === 'attendance' && (
            <form onSubmit={handleSaveAttendance} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <IconClock size={18} className="text-indigo-600" />
                  <span>Attendance &amp; Shift Execution Rules</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Parameters used for calculating late marks, half-day cuts, overtime accruals, and biometric windows.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Standard Shift Start Time</label>
                  <input
                    type="time"
                    value={attendanceSettings.defaultStart}
                    onChange={(e) => setAttendanceSettings({ ...attendanceSettings, defaultStart: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Standard Shift End Time</label>
                  <input
                    type="time"
                    value={attendanceSettings.defaultEnd}
                    onChange={(e) => setAttendanceSettings({ ...attendanceSettings, defaultEnd: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Late Entry Grace Period (Minutes)</label>
                  <input
                    type="number"
                    value={attendanceSettings.graceMinutes}
                    onChange={(e) => setAttendanceSettings({ ...attendanceSettings, graceMinutes: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Early Arrival Window (Minutes)</label>
                  <input
                    type="number"
                    value={attendanceSettings.earlyArrivalWindowMinutes}
                    onChange={(e) => setAttendanceSettings({ ...attendanceSettings, earlyArrivalWindowMinutes: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Minimum Hours for Half-Day</label>
                  <input
                    type="number"
                    step="0.5"
                    value={attendanceSettings.halfDayHours}
                    onChange={(e) => setAttendanceSettings({ ...attendanceSettings, halfDayHours: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Minimum Hours for Full-Day</label>
                  <input
                    type="number"
                    step="0.5"
                    value={attendanceSettings.fullDayHours}
                    onChange={(e) => setAttendanceSettings({ ...attendanceSettings, fullDayHours: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Overtime Qualification Threshold (Mins)</label>
                  <input
                    type="number"
                    value={attendanceSettings.otThresholdMinutes}
                    onChange={(e) => setAttendanceSettings({ ...attendanceSettings, otThresholdMinutes: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-3 pt-2">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attendanceSettings.cameraVerificationRequired}
                    onChange={(e) => setAttendanceSettings({ ...attendanceSettings, cameraVerificationRequired: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-xs font-bold text-slate-700">Require camera verification snapshot on web check-in</span>
                </label>
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attendanceSettings.biometricEnforced}
                    onChange={(e) => setAttendanceSettings({ ...attendanceSettings, biometricEnforced: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-xs font-bold text-slate-700">Enforce ZKTeco biometric sync as authoritative punch record</span>
                </label>
              </div>

              {renderSaveButton('attendance', 'Save Attendance Rules', 'Attendance Rules Approved & Saved')}
            </form>
          )}

          {/* TAB 4: LEAVE POLICIES */}
          {activeTab === 'leave' && (
            <form onSubmit={handleSaveLeave} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <IconLeave size={18} className="text-indigo-600" />
                  <span>Leave Policies &amp; Annual Allocations</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Define annual quotas, rollover limits, and medical certificate requirements for staff leave requests.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Annual Paid Leave (Days)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={leaveSettings.annualDays === '' ? '' : (leaveSettings.annualDays ?? '')}
                    onChange={(e) => setLeaveSettings({ ...leaveSettings, annualDays: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Casual Leave (Days)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={leaveSettings.casualDays === '' ? '' : (leaveSettings.casualDays ?? '')}
                    onChange={(e) => setLeaveSettings({ ...leaveSettings, casualDays: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Medical / Sick Leave (Days)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={leaveSettings.sickDays === '' ? '' : (leaveSettings.sickDays ?? '')}
                    onChange={(e) => setLeaveSettings({ ...leaveSettings, sickDays: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Maternity Leave (Days)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={leaveSettings.maternityDays === '' ? '' : (leaveSettings.maternityDays ?? '')}
                    onChange={(e) => setLeaveSettings({ ...leaveSettings, maternityDays: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Paternity Leave (Days)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={leaveSettings.paternityDays === '' ? '' : (leaveSettings.paternityDays ?? '')}
                    onChange={(e) => setLeaveSettings({ ...leaveSettings, paternityDays: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Max Carry Forward (Days)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={leaveSettings.maxCarryForwardDays === '' ? '' : (leaveSettings.maxCarryForwardDays ?? '')}
                    onChange={(e) => setLeaveSettings({ ...leaveSettings, maxCarryForwardDays: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={leaveSettings.carryForwardEnabled}
                    onChange={(e) => setLeaveSettings({ ...leaveSettings, carryForwardEnabled: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-xs font-bold text-slate-700">Allow unused annual leave to roll over into next calendar year</span>
                </label>
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={leaveSettings.multiLevelApproval}
                    onChange={(e) => setLeaveSettings({ ...leaveSettings, multiLevelApproval: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-xs font-bold text-slate-700">Require Department Head approval before final HR confirmation</span>
                </label>
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={leaveSettings.allowUnpaid}
                    onChange={(e) => setLeaveSettings({ ...leaveSettings, allowUnpaid: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-xs font-bold text-slate-700">Permit Leave Without Pay (LWP) when leave balance is exhausted</span>
                </label>
              </div>

              {renderSaveButton('leave', 'Save Leave Policies', 'Leave Policies Approved & Saved')}
            </form>
          )}

          {/* TAB 5: PAYROLL & SALARY */}
          {activeTab === 'payroll' && (
            <form onSubmit={handleSavePayroll} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <IconWallet size={18} className="text-indigo-600" />
                  <span>Payroll &amp; Salary Structure Rules</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Automated breakdown percentages for Gross salary distribution and Provident Fund deductions.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Salary Disbursement Day of Month</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={payrollSettings.salaryDay}
                    onChange={(e) => setPayrollSettings({ ...payrollSettings, salaryDay: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Overtime Hourly Multiplier</label>
                  <input
                    type="number"
                    step="0.25"
                    value={payrollSettings.otRateMultiplier}
                    onChange={(e) => setPayrollSettings({ ...payrollSettings, otRateMultiplier: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Basic Salary (% of Gross)</label>
                  <input
                    type="number"
                    value={payrollSettings.basicPercent}
                    onChange={(e) => setPayrollSettings({ ...payrollSettings, basicPercent: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">House Rent Allowance (% of Gross)</label>
                  <input
                    type="number"
                    value={payrollSettings.houseRentPercent}
                    onChange={(e) => setPayrollSettings({ ...payrollSettings, houseRentPercent: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Medical Allowance (% of Gross)</label>
                  <input
                    type="number"
                    value={payrollSettings.medicalPercent}
                    onChange={(e) => setPayrollSettings({ ...payrollSettings, medicalPercent: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Conveyance Allowance (% of Gross)</label>
                  <input
                    type="number"
                    value={payrollSettings.conveyancePercent}
                    onChange={(e) => setPayrollSettings({ ...payrollSettings, conveyancePercent: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Standard PF Rate Reference (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={payrollSettings.pfEmployeePercent}
                    onChange={(e) => setPayrollSettings({ ...payrollSettings, pfEmployeePercent: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
              </div>

              {/* STATUTORY DEDUCTION POLICY: PF & TAX TOGGLE FEATURE */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase text-slate-800 flex items-center space-x-2">
                      <span>🛡️</span>
                      <span>Automatic Provident Fund (PF) &amp; Income Tax (TDS) Deduction Policy</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Disable automatic deductions if you prefer to manually manage PF and Tax per employee.
                    </p>
                  </div>
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                    (!payrollSettings.autoPfDeduction && !payrollSettings.autoTaxDeduction)
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                  }`}>
                    {(!payrollSettings.autoPfDeduction && !payrollSettings.autoTaxDeduction)
                      ? '✓ Manual Mode Active (Auto-Cut OFF)'
                      : 'Automatic Deduction Active'}
                  </span>
                </div>

                <div className="space-y-3.5">
                  {/* Auto PF Toggle */}
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200 flex items-start justify-between gap-3 shadow-2xs">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-slate-800">Automatic Provident Fund (PF) Deduction</span>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${
                          payrollSettings.autoPfDeduction ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}>
                          {payrollSettings.autoPfDeduction ? 'ENABLED' : 'OFF (Manual Management)'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {payrollSettings.autoPfDeduction
                          ? `Automatically deducts ${payrollSettings.pfEmployeePercent || 8.33}% from every employee's basic salary.`
                          : `OFF: No employee will have Provident Fund automatically deducted (৳0 PF). You can manually enter PF for specific employees via the Edit button in Payroll.`}
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer mt-1">
                      <input
                        type="checkbox"
                        checked={payrollSettings.autoPfDeduction || false}
                        onChange={(e) => setPayrollSettings({ ...payrollSettings, autoPfDeduction: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>

                  {/* Auto Tax Toggle */}
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200 flex items-start justify-between gap-3 shadow-2xs">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-slate-800">Automatic Income Tax (TDS) Deduction</span>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${
                          payrollSettings.autoTaxDeduction ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}>
                          {payrollSettings.autoTaxDeduction ? 'ENABLED' : 'OFF (Manual Management)'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {payrollSettings.autoTaxDeduction
                          ? `Automatically deducts ${payrollSettings.taxPercent || 5}% Tax on salaries exceeding standard slabs.`
                          : `OFF: No employee will have Income Tax automatically deducted (৳0 Tax). You can manually input tax deduction for specific employees via the Edit button in Payroll.`}
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer mt-1">
                      <input
                        type="checkbox"
                        checked={payrollSettings.autoTaxDeduction || false}
                        onChange={(e) => setPayrollSettings({ ...payrollSettings, autoTaxDeduction: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>
                </div>

                {/* Additional Settings if Enabled */}
                {(payrollSettings.autoPfDeduction || payrollSettings.autoTaxDeduction) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    {payrollSettings.autoPfDeduction && (
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1">PF Auto-Deduction Rate (% of Basic)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={payrollSettings.pfEmployeePercent || 8.33}
                          onChange={(e) => setPayrollSettings({ ...payrollSettings, pfEmployeePercent: Number(e.target.value) })}
                          className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                        />
                      </div>
                    )}
                    {payrollSettings.autoTaxDeduction && (
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Standard Income Tax Rate (%)</label>
                        <input
                          type="number"
                          step="0.5"
                          value={payrollSettings.taxPercent || 5}
                          onChange={(e) => setPayrollSettings({ ...payrollSettings, taxPercent: Number(e.target.value) })}
                          className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {renderSaveButton('payroll', 'Save Payroll Policy', 'Payroll Policy Approved & Saved')}
            </form>
          )}

          {/* TAB 6: ZKTECO BIOMETRIC INTEGRATION */}
          {activeTab === 'zkteco' && (
            <form onSubmit={handleSaveZKTeco} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                    <IconFingerprint size={18} className="text-indigo-600" />
                    <span>ZKTeco Biometric Device Parameters</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Connect on-premise biometric hardware via direct TCP/IP or cloud ADMS Push protocol.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleTestDevicePing}
                  disabled={devicePingStatus === 'testing'}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center space-x-2 transition-all"
                >
                  <IconActivity size={14} className={devicePingStatus === 'testing' ? 'animate-spin' : ''} />
                  <span>{devicePingStatus === 'testing' ? 'Pinging...' : devicePingStatus === 'online' ? 'Online (42ms)' : 'Ping Device'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Primary Device IP / Domain</label>
                  <input
                    type="text"
                    value={zktecoSettings.deviceIp}
                    onChange={(e) => setZktecoSettings({ ...zktecoSettings, deviceIp: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Hardware Port</label>
                  <input
                    type="text"
                    value={zktecoSettings.devicePort}
                    onChange={(e) => setZktecoSettings({ ...zktecoSettings, devicePort: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Device Serial Number</label>
                  <input
                    type="text"
                    value={zktecoSettings.deviceSerial}
                    onChange={(e) => setZktecoSettings({ ...zktecoSettings, deviceSerial: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Device Model Name</label>
                  <input
                    type="text"
                    value={zktecoSettings.deviceName}
                    onChange={(e) => setZktecoSettings({ ...zktecoSettings, deviceName: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Auto-Sync Interval (Minutes)</label>
                  <input
                    type="number"
                    value={zktecoSettings.autoSyncInterval}
                    onChange={(e) => setZktecoSettings({ ...zktecoSettings, autoSyncInterval: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  />
                </div>
              </div>

              {/* Webhook Box */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                    <IconServer size={14} className="text-indigo-600" />
                    <span>Cloud ADMS Push Server Endpoint (for ZKTeco Webserver Menu)</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="text-xs text-indigo-600 font-bold hover:underline"
                  >
                    {copiedWebhook ? '✓ Copied' : 'Copy URL'}
                  </button>
                </div>
                <div className="p-2.5 bg-white rounded-xl border border-slate-200 text-xs font-mono text-slate-600 break-all select-all">
                  {webhookEndpoint}
                </div>
                <p className="text-[11px] text-slate-500">
                  Configure this endpoint inside the device's ADMS / Cloud Server menu with Port 443 (HTTPS) or 80.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={zktecoSettings.autoSyncEnabled}
                    onChange={(e) => setZktecoSettings({ ...zktecoSettings, autoSyncEnabled: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-xs font-bold text-slate-700">Enable periodic background biometric sync</span>
                </label>
                {renderSaveButton('zkteco', 'Save Biometric Config', 'ZKTeco Parameters Approved & Saved')}
              </div>
            </form>
          )}

          {/* TAB 7: FIREBASE CLOUD DB */}
          {activeTab === 'firebase' && (
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                    <IconCloud size={18} className="text-indigo-600" />
                    <span>Firebase Cloud Firestore Synchronization</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Live document persistence status and manual synchronization triggers.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="relative flex h-2.5 w-2.5">
                    {firebaseConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${firebaseConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                  </span>
                  <span className={`text-xs font-bold ${firebaseConnected ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {firebaseConnected ? 'Firestore Active' : 'Disconnected'}
                  </span>
                </div>
              </div>

              {/* Status & Sync Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-400 uppercase block">Active Project ID</span>
                  <span className="text-sm font-bold text-slate-800 font-mono mt-1 block">
                    {activeFirebaseConfig?.projectId || 'work-nest-hr-b1642'}
                  </span>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-400 uppercase block">Live Synchronization</span>
                  <span className="text-sm font-bold text-slate-800 mt-1 flex items-center justify-between">
                    <span>{liveSyncEnabled ? 'Enabled (Realtime)' : 'Paused'}</span>
                    <button
                      onClick={toggleLiveSync}
                      className="text-xs text-indigo-600 font-bold hover:underline"
                    >
                      {liveSyncEnabled ? 'Pause' : 'Enable'}
                    </button>
                  </span>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-400 uppercase block">Last Sync Timestamp</span>
                  <span className="text-xs font-semibold text-slate-700 mt-1 block">
                    {lastSyncTime ? lastSyncTime.toLocaleTimeString() : 'Recently'}
                  </span>
                </div>
              </div>

              {/* Manual Trigger */}
              <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-indigo-900">Manual Push Sync</h4>
                  <p className="text-[11px] text-indigo-700 mt-0.5">
                    Sync all active employees, shifts, departments, and leaves to Firestore in a single batch.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => manualSync()}
                  disabled={firebaseSyncing}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center space-x-2"
                >
                  <IconRefresh size={14} className={firebaseSyncing ? 'animate-spin' : ''} />
                  <span>{firebaseSyncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
              </div>

              {/* Custom Firebase Form */}
              <form onSubmit={handleFirebaseReconfigure} className="space-y-4 pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-700 uppercase block">
                  Firebase Credentials Override
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">API Key</label>
                    <input
                      type="text"
                      value={customFirebase.apiKey}
                      onChange={(e) => setCustomFirebase({ ...customFirebase, apiKey: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Project ID</label>
                    <input
                      type="text"
                      value={customFirebase.projectId}
                      onChange={(e) => setCustomFirebase({ ...customFirebase, projectId: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Auth Domain</label>
                    <input
                      type="text"
                      value={customFirebase.authDomain}
                      onChange={(e) => setCustomFirebase({ ...customFirebase, authDomain: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Storage Bucket</label>
                    <input
                      type="text"
                      value={customFirebase.storageBucket}
                      onChange={(e) => setCustomFirebase({ ...customFirebase, storageBucket: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-mono"
                    />
                  </div>
                </div>

                {firebaseTestStatus && (
                  <div className="p-3 bg-slate-100 rounded-xl text-xs font-semibold text-slate-700">
                    {firebaseTestStatus}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                  >
                    Test &amp; Save Credentials
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 8: SECURITY & ACCESS */}
          {activeTab === 'security' && (
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <IconShield size={18} className="text-indigo-600" />
                  <span>Security, Passwords &amp; Session Controls</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Manage administrative credentials, idle session expiry, and multi-factor authentication.
                </p>
              </div>

              {/* Change Password Form */}
              <form onSubmit={handlePasswordChange} className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
                <h3 className="text-xs font-bold text-slate-800 uppercase flex items-center space-x-1.5">
                  <IconKey size={14} className="text-indigo-600" />
                  <span>Update Admin Password</span>
                </h3>

                {passwordError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl">
                    {passwordError}
                  </div>
                )}
                {passwordSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl">
                    ✓ Password updated successfully!
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 uppercase mb-1">New Password</label>
                    <input
                      type="password"
                      value={securitySettings.newPassword}
                      onChange={(e) => setSecuritySettings({ ...securitySettings, newPassword: e.target.value })}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold bg-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Confirm New Password</label>
                    <input
                      type="password"
                      value={securitySettings.confirmPassword}
                      onChange={(e) => setSecuritySettings({ ...securitySettings, confirmPassword: e.target.value })}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold bg-white"
                      required
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                  >
                    Update Password
                  </button>
                </div>
              </form>

              {/* Session Controls */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Auto-Logout Session Timeout</label>
                  <select
                    value={securitySettings.sessionTimeout}
                    onChange={(e) => setSecuritySettings({ ...securitySettings, sessionTimeout: e.target.value })}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800"
                  >
                    <option value="15">15 Minutes</option>
                    <option value="30">30 Minutes</option>
                    <option value="60">60 Minutes (Standard)</option>
                    <option value="120">2 Hours</option>
                    <option value="never">Never (Persistent)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={securitySettings.twoFactorEnabled}
                    onChange={(e) => setSecuritySettings({ ...securitySettings, twoFactorEnabled: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-xs font-bold text-slate-700">Require Two-Factor Authentication (2FA) for Administrative Portal</span>
                </label>
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={securitySettings.ipRestrictionEnabled}
                    onChange={(e) => setSecuritySettings({ ...securitySettings, ipRestrictionEnabled: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                  <span className="text-xs font-bold text-slate-700">Restrict access to registered office IP subnets only</span>
                </label>
              </div>
            </div>
          )}

          {/* TAB: ADMIN USERS & ROLE-BASED ACCESS CONTROL (RBAC) */}
          {activeTab === 'admin_users' && (
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                    <IconShield size={18} className="text-indigo-600" />
                    <span>Administrator Accounts &amp; Role-Based Access Control</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Create designated administrative accounts and specify exact permissions for each operational module.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleCopyEmployeePortalLink}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer shadow-2xs"
                    title="Copy direct clean link for employees without admin autofill"
                  >
                    <span>{copiedEmployeePortalLink ? '✓ Copied!' : '📋 Copy Employee Portal Link'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenCreateAdmin}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/25 transition-all flex items-center space-x-1.5 cursor-pointer"
                  >
                    <span>+ Create Admin Account</span>
                  </button>
                </div>
              </div>

              {/* Explanatory Info Card */}
              <div className="p-4 bg-gradient-to-r from-indigo-50/70 via-purple-50/60 to-pink-50/40 rounded-2xl border border-indigo-100 text-xs text-slate-700 space-y-1.5">
                <div className="flex items-center space-x-2 font-bold text-indigo-900">
                  <span>🛡️</span>
                  <span>Granular Role &amp; Permission System Active</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Admins will only see and access the modules explicitly enabled in their permission checklist.
                  For example, an <strong>Attendance Officer</strong> only accesses Attendance and Shifts, while a <strong>Payroll Admin</strong> is restricted to Payroll and attendance data.
                </p>
              </div>

              {/* Admin Accounts List */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Active Administrative Accounts ({totalAdminCount})
                </h3>

                {/* Primary Master Super Admin - Only visible in owner master root workspace, hidden in customer company workspaces */}
                {isMasterWorkspace && (
                  <div className="p-4 sm:p-5 rounded-2xl border-2 border-indigo-200 bg-indigo-50/30 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center space-x-3.5">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl shadow-md shrink-0">
                        👨‍💼
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-slate-900 text-sm">
                            {currentUser?.name || 'Sayem Siraj'}
                          </span>
                          <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-wider rounded-md">
                            Primary Super Admin
                          </span>
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-md flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span>Active</span>
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          {currentUser?.email || 'sayemsiraj@gmail.com'}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          <span className="text-[10px] font-semibold bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-md">
                            ✓ Full Access (All 12 Modules)
                          </span>
                          <span className="text-[10px] font-semibold bg-white border border-slate-200 text-indigo-700 px-2 py-0.5 rounded-md">
                            Master Root Account
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 text-xs text-slate-500 lg:text-right shrink-0">
                      <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-600 text-xs font-semibold">
                        Protected Account
                      </span>
                    </div>
                  </div>
                )}

                {/* Custom / Created Admin Accounts */}
                {visibleAdmins.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                    <span className="text-3xl block mb-2">👥</span>
                    <h4 className="text-sm font-bold text-slate-800">
                      {isMasterWorkspace ? 'No Secondary Admin Accounts Yet' : 'No Admin Accounts Yet'}
                    </h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                      Click "+ Create Admin Account" above to add HR managers, attendance officers, or department supervisors with restricted module permissions.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {visibleAdmins.map((admin) => {
                      const perms = admin.permissions || ROLE_PERMISSION_PRESETS[admin.role] || ROLE_PERMISSION_PRESETS['Super Admin'];
                      const enabledCount = Object.values(perms).filter(Boolean).length;

                      return (
                        <div
                          key={admin.id}
                          className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                            admin.status === 'suspended'
                              ? 'bg-rose-50/30 border-rose-200 opacity-80'
                              : 'bg-white border-slate-200 shadow-2xs hover:border-slate-300'
                          }`}
                        >
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            <div className="flex items-start space-x-3.5">
                              <Avatar
                                avatar={admin.avatar}
                                name={admin.name}
                                sizeClass="w-11 h-11"
                                textClass="text-lg font-bold"
                                roundedClass="rounded-2xl"
                                bgClass="bg-slate-100 text-slate-800"
                              />
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-extrabold text-slate-900 text-sm">{admin.name}</span>
                                  <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-md ${
                                    admin.role === 'Super Admin'
                                      ? 'bg-purple-100 text-purple-800'
                                      : admin.role === 'HR Manager'
                                      ? 'bg-blue-100 text-blue-800'
                                      : admin.role === 'Attendance Officer'
                                      ? 'bg-amber-100 text-amber-800'
                                      : admin.role === 'Payroll Admin'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}>
                                    {admin.role}
                                  </span>
                                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md flex items-center space-x-1 ${
                                    admin.status === 'active'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${admin.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                                    <span className="capitalize">{admin.status}</span>
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono mt-0.5">
                                  <span>{admin.email}</span>
                                  {admin.phone && <span>• {admin.phone}</span>}
                                  {admin.lastLogin && (
                                    <span className="text-[11px] text-slate-400 font-sans">
                                      • Last login: {new Date(admin.lastLogin).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>

                                {/* Permissions Chips */}
                                <div className="flex flex-wrap gap-1.5 mt-2.5">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider self-center mr-1">
                                    Access ({enabledCount}):
                                  </span>
                                  {[
                                    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
                                    { key: 'employees', label: 'Employees', icon: '👥' },
                                    { key: 'departments', label: 'Departments', icon: '🏢' },
                                    { key: 'shifts', label: 'Shifts', icon: '⏰' },
                                    { key: 'roster', label: 'Roster', icon: '📅' },
                                    { key: 'attendance', label: 'Attendance', icon: '⏱️' },
                                    { key: 'leave', label: 'Leave', icon: '🏖️' },
                                    { key: 'payroll', label: 'Payroll', icon: '💰' },
                                    { key: 'recruitment', label: 'Recruitment', icon: '💼' },
                                    { key: 'onboarding', label: 'Onboarding & Exit', icon: '🚀' },
                                    { key: 'documents', label: 'Documents', icon: '📂' },
                                    { key: 'enterpriseSecurity', label: 'Enterprise Security & Audit', icon: '🛡️' },
                                    { key: 'reports', label: 'Reports', icon: '📈' },
                                    { key: 'biometric', label: 'Biometric', icon: '📟' },
                                    { key: 'settings', label: 'Settings', icon: '⚙️' },
                                  ].map(mod => {
                                    const isAllowed = Boolean(perms[mod.key as keyof AdminPermissions]);
                                    return (
                                      <span
                                        key={mod.key}
                                        className={`text-[10px] px-2 py-0.5 rounded-md font-semibold flex items-center space-x-1 ${
                                          isAllowed
                                            ? 'bg-indigo-50 border border-indigo-200 text-indigo-700'
                                            : 'bg-slate-100 border border-slate-200 text-slate-400 opacity-50 line-through'
                                        }`}
                                      >
                                        <span>{mod.icon}</span>
                                        <span>{mod.label}</span>
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center space-x-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                              <button
                                type="button"
                                onClick={() => handleOpenEditAdmin(admin)}
                                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center space-x-1 cursor-pointer"
                              >
                                <span>✏️ Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleAdminStatus(admin)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                                  admin.status === 'active'
                                    ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200'
                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                                }`}
                              >
                                <span>{admin.status === 'active' ? 'Suspend' : 'Activate'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAdmin(admin)}
                                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold rounded-xl transition-all cursor-pointer"
                                title="Delete Admin Account"
                              >
                                <IconTrash size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 9: NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <form onSubmit={handleSaveNotifications} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <IconBell size={18} className="text-indigo-600" />
                  <span>Notification &amp; Alert Preferences</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Control which events trigger in-app banners, email digests, and hardware alerts.
                </p>
              </div>

              <div className="space-y-4">
                {[
                  { key: 'emailAlerts', title: 'Email Notifications', desc: 'Send transactional email alerts for critical corporate events' },
                  { key: 'pushAlerts', title: 'Web Push Notifications', desc: 'Display desktop popups when employees punch in or request leave' },
                  { key: 'attendanceDigest', title: 'Daily Attendance Morning Digest', desc: 'Receive morning headcount summary at 10:00 AM' },
                  { key: 'leaveAlerts', title: 'Leave Application Alerts', desc: 'Instant notification when an employee files a leave request' },
                  { key: 'payrollReminders', title: 'Payroll Processing Reminders', desc: 'Remind HR team 3 days before salary disbursement date' },
                  { key: 'deviceDisconnectAlerts', title: 'Biometric Offline Alerts', desc: 'Notify admins if ZKTeco terminal stops sending heartbeat' },
                  { key: 'soundEnabled', title: 'Audible Punch Chime', desc: 'Play subtle acoustic confirmation when biometric punch is recorded' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                    <div>
                      <div className="text-xs font-bold text-slate-800">{item.title}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{item.desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={(notificationSettings as any)[item.key]}
                      onChange={(e) => setNotificationSettings({ ...notificationSettings, [item.key]: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                  </div>
                ))}
              </div>

              {renderSaveButton('notifications', 'Save Notification Preferences', 'Notification Preferences Approved & Saved')}
            </form>
          )}

          {/* TAB 10: BACKUP, RESTORE & FACTORY RESET */}
          {activeTab === 'backup' && (
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                  <IconDatabase size={18} className="text-indigo-600" />
                  <span>Backup, Disaster Recovery &amp; System Maintenance</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Export complete database snapshots, restore archives into Firestore, or purge data safely.
                </p>
              </div>

              {/* Export Box */}
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Export Complete JSON Backup</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Includes {employees.length} employees, {departments.length} departments, {shifts.length} shifts, {roster.length} roster duties, and {leaveRequests.length} leaves.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportBackup}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center space-x-2 flex-shrink-0"
                >
                  <IconDownload size={16} />
                  <span>Download Backup Archive</span>
                </button>
              </div>

              {/* Import Box */}
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Restore System from JSON Backup</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Upload a previously exported WorkNest backup file to synchronize records back into Firestore.
                  </p>
                </div>
                <div className="flex items-center space-x-3">
                  <label className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer shadow-sm flex items-center space-x-2">
                    <IconUpload size={16} className="text-indigo-600" />
                    <span>Select Backup File (.json)</span>
                    <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
                  </label>
                </div>
                {importStatus && (
                  <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs font-semibold text-indigo-700">
                    {importStatus}
                  </div>
                )}
              </div>

              {/* Danger Zone: Factory Reset */}
              <div className="p-5 bg-rose-50/50 rounded-2xl border border-rose-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-rose-800">Purge / Factory Reset Database</h4>
                  <p className="text-[11px] text-rose-600 mt-0.5">
                    Wipes all employees, shifts, departments, roster duties, leaves, and punches. Requires typed confirmation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center space-x-2 flex-shrink-0"
                >
                  <IconTrash size={16} />
                  <span>Purge Database</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB: BILLING & SUBSCRIPTION (MANUAL BDT PAYMENTS & INVOICES) */}
          {activeTab === 'billing' && <CustomerBillingSection />}
        </div>
      </div>

      {/* FACTORY RESET CONFIRMATION MODAL */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-200 shadow-2xl space-y-4 animate-scale-in">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <IconTrash size={24} />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-black text-slate-900">Purge All System Records?</h3>
              <p className="text-xs text-slate-500 mt-1">
                This action is irreversible. All employees, shifts, departments, rosters, and biometric punches in Firestore will be cleared.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">
                Type <span className="text-rose-600 font-mono">RESET</span> to confirm:
              </label>
              <input
                type="text"
                value={resetConfirmInput}
                onChange={(e) => setResetConfirmInput(e.target.value)}
                placeholder="RESET"
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-center uppercase tracking-widest text-slate-800 outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowResetModal(false);
                  setResetConfirmInput('');
                }}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteReset}
                disabled={resetConfirmInput !== 'RESET' || resetLoading}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-md transition-all"
              >
                {resetLoading ? 'Purging...' : 'Confirm Purge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT ADMIN ACCOUNT MODAL */}
      {showAdminModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-7 max-h-[92vh] overflow-y-auto thin-scroll shadow-2xl border border-slate-200 animate-scale-in">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center text-xl shadow-xs">
                  🛡️
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {editingAdmin ? `Edit Administrator: ${editingAdmin.name}` : 'Create New Administrator'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Set administrative sign-in credentials and module-by-module permissions.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {adminModalError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl animate-shake">
                {adminModalError}
              </div>
            )}

            <form onSubmit={handleSaveAdminAccount} className="space-y-5">
              {/* Account Basic Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={adminFormData.name}
                    onChange={e => setAdminFormData({ ...adminFormData, name: e.target.value })}
                    placeholder="e.g. Tariqul Islam"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Admin Email (Login ID) *
                  </label>
                  <input
                    type="email"
                    required
                    value={adminFormData.email}
                    onChange={e => setAdminFormData({ ...adminFormData, email: e.target.value })}
                    placeholder="tariqul.hr@worknest.com"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    {editingAdmin ? 'Password (Leave blank to keep existing)' : 'Password *'}
                  </label>
                  <input
                    type="password"
                    required={!editingAdmin}
                    value={adminFormData.password}
                    onChange={e => setAdminFormData({ ...adminFormData, password: e.target.value })}
                    placeholder={editingAdmin ? '•••••••• (unchanged)' : 'Enter secure password'}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={adminFormData.phone}
                    onChange={e => setAdminFormData({ ...adminFormData, phone: e.target.value })}
                    placeholder="+880 1700-000000"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Role Preset Selector */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
                  Role Preset (Auto-configures module permissions)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(['Super Admin', 'HR Manager', 'Attendance Officer', 'Payroll Admin', 'Department Supervisor', 'Custom'] as AdminRole[]).map((r) => {
                    const isSelected = adminFormData.role === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => handleRoleSelect(r)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 font-bold ring-2 ring-indigo-500/20'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700 font-medium'
                        }`}
                      >
                        <div className="text-xs leading-tight flex items-center justify-between">
                          <span>{r}</span>
                          {isSelected && <span className="text-indigo-600 text-xs">✓</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  Account Status
                </label>
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => setAdminFormData({ ...adminFormData, status: 'active' })}
                    className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center space-x-1.5 ${
                      adminFormData.status === 'active'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>Active (Allowed to sign in)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminFormData({ ...adminFormData, status: 'suspended' })}
                    className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center space-x-1.5 ${
                      adminFormData.status === 'suspended'
                        ? 'bg-rose-50 border-rose-300 text-rose-800 ring-2 ring-rose-500/20'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    <span>Suspended (Login blocked)</span>
                  </button>
                </div>
              </div>

              {/* Assigned Department Scope for Supervisors */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                  Assigned Team / Department Scope
                </label>
                <select
                  value={adminFormData.assignedDepartment}
                  onChange={e => setAdminFormData({ ...adminFormData, assignedDepartment: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                >
                  <option value="">All Company Departments (Organization-wide Access)</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.name}>
                      Restricted to Department: {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Granular Module Permissions Checklist */}
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-base">🔑</span>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Module Access Permissions (Enterprise RBAC)
                    </h4>
                  </div>
                  <span className="text-[11px] font-bold text-indigo-700 font-mono">
                    {Object.entries(adminFormData.permissions).filter(([k, v]) => k !== 'actionPermissions' && Boolean(v)).length} enabled
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  {[
                    { key: 'dashboard', label: 'Dashboard & Headcount', icon: '📊', desc: 'KPI summaries, presence & charts' },
                    { key: 'enterpriseSecurity', label: 'Enterprise Security & Audit Logs', icon: '🛡️', desc: 'Custom roles, sessions, 2FA & audit logs' },
                    { key: 'employees', label: 'Employee Management', icon: '👥', desc: 'Staff directory, IDs & profiles' },
                    { key: 'workforcePlanning', label: 'Workforce Planning', icon: '🗺️', desc: 'Org chart, headcount & vacancies' },
                    { key: 'engagement', label: 'Engagement & Surveys', icon: '🎉', desc: 'Announcements, recognition & surveys' },
                    { key: 'analytics', label: 'HR Analytics', icon: '📈', desc: 'Turnover, tenure & shift utilization' },
                    { key: 'departments', label: 'Departments & Branches', icon: '🏢', desc: 'Org structure and branch offices' },
                    { key: 'shifts', label: 'Shift Management', icon: '⏰', desc: 'Fixed & Flexible shifts & policies' },
                    { key: 'roster', label: 'Duty Roster', icon: '📅', desc: 'Monthly scheduling & off-days' },
                    { key: 'attendance', label: 'Attendance & Logs', icon: '⏱️', desc: 'Daily punches, timesheets & approvals' },
                    { key: 'leave', label: 'Leave Requests', icon: '🏖️', desc: 'Leave approvals and balances' },
                    { key: 'payroll', label: 'Payroll & Salaries', icon: '💰', desc: 'Monthly salary sheets & payslips' },
                    { key: 'expenses', label: 'Expense Claims', icon: '🧾', desc: 'Reimbursements & receipts' },
                    { key: 'onboarding', label: 'Onboarding & Exit', icon: '🚀', desc: 'Joining checklists, clearance & settlement' },
                    { key: 'recruitment', label: 'Recruitment', icon: '💼', desc: 'Jobs, candidates & interview pipeline' },
                    { key: 'documents', label: 'Employee Documents', icon: '📂', desc: 'Policies, private files & expiry alerts' },
                    { key: 'reports', label: 'Reports & Statements', icon: '📑', desc: 'Master dossier & attendance reports' },
                    { key: 'biometric', label: 'ZKTeco Hardware', icon: '📟', desc: 'Terminal heartbeats & ADMS push' },
                    { key: 'settings', label: 'System Settings', icon: '⚙️', desc: 'Company profile, rules & database' },
                  ].map((mod) => {
                    const isChecked = Boolean(adminFormData.permissions[mod.key as keyof AdminPermissions]);
                    return (
                      <label
                        key={mod.key}
                        onClick={() => handleTogglePermission(mod.key as keyof AdminPermissions)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start space-x-2.5 select-none ${
                          isChecked
                            ? 'bg-white border-indigo-400 shadow-2xs ring-1 ring-indigo-500/20'
                            : 'bg-white/60 border-slate-200 hover:bg-white text-slate-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // Handled by container onClick
                          className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-1.5">
                            <span>{mod.icon}</span>
                            <span className={`text-xs font-bold ${isChecked ? 'text-slate-900' : 'text-slate-600'}`}>
                              {mod.label}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-tight truncate">
                            {mod.desc}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center space-x-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAdminModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adminModalLoading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/25 transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                >
                  {adminModalLoading ? (
                    <>
                      <IconActivity size={14} className="animate-spin" />
                      <span>Saving Administrator...</span>
                    </>
                  ) : (
                    <span>{editingAdmin ? 'Save Role & Permissions' : 'Create Administrator'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
