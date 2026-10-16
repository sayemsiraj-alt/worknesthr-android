import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import {
  doc,
  collection,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy
} from 'firebase/firestore';
import {
  Company,
  CompanySubscription,
  CompanyProfile,
  CompanySettings,
  DEFAULT_OWNER_COMPANY,
  SubscriptionStatus
} from '../types/tenant';
import { getFirebaseInstance, sanitizeForFirestore } from '../lib/firestoreService';
import { AdminAccount, ROLE_PERMISSION_PRESETS, provisionAdminAuthAccount } from '../lib/authService';

export interface CreateCompanyPayload {
  companyName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword?: string;
  plan: 'starter' | 'professional' | 'enterprise' | 'custom';
  startDate: string;
  expiryDate: string;
  status: SubscriptionStatus;
  maxEmployees?: number;
  phone?: string;
  currency?: string;
  currencySymbol?: string;
  notes?: string;
}

export interface TenantContextType {
  currentCompanyId: string;
  currentCompany: Company | null;
  subscription: CompanySubscription | null;
  isSubscriptionActive: boolean;
  subscriptionCheckFinished: boolean;
  isSuperAdmin: boolean;
  isViewingCustomerTenant: boolean;
  viewingOriginalTenantId: string | null;
  allCompanies: Company[];
  loadingCompanies: boolean;
  switchCompany: (companyId: string) => void;
  resetToOwnerCompany: () => void;
  createCompany: (payload: CreateCompanyPayload) => Promise<{ success: boolean; company?: Company; error?: string }>;
  updateCompanySubscription: (companyId: string, subscription: Partial<CompanySubscription>) => Promise<{ success: boolean; error?: string }>;
  updateCompanyStatus: (companyId: string, status: 'active' | 'suspended') => Promise<{ success: boolean; error?: string }>;
  updateCompanyProfile: (companyId: string, profile: Partial<CompanyProfile>) => Promise<{ success: boolean; error?: string }>;
  updateCompanySettings: (companyId: string, settings: Partial<CompanySettings>) => Promise<{ success: boolean; error?: string }>;
  refreshCompanies: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | null>(null);

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return ctx;
}

export function TenantProvider({ children }: { children: ReactNode }) {
  // Current authenticated admin / user from localStorage
  const [currentUser, setCurrentUser] = useState<AdminAccount | null>(() => {
    try {
      if (localStorage.getItem('worknest_admin_logged_in') !== 'true') return null;
      const stored = localStorage.getItem('worknest_admin_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [currentEmployeeCompanyId, setCurrentEmployeeCompanyId] = useState<string | null>(() => {
    try {
      if (localStorage.getItem('worknest_employee_logged_in') !== 'true') return null;
      const stored = localStorage.getItem('worknest_employee_user');
      if (!stored) return null;
      const emp = JSON.parse(stored);
      return emp?.companyId || 'default';
    } catch {
      return null;
    }
  });

  // Check if current user is software owner / Super Admin
  const isSuperAdmin = Boolean(
    currentUser?.email?.toLowerCase() === 'sayemsiraj@gmail.com' ||
    (currentUser as any)?.isPrimarySuperAdmin ||
    ((currentUser as any)?.isSuperAdmin && currentUser?.role === 'Super Admin')
  );

  // Active workspace / tenant ID:
  // For ordinary customers and employees, it is strictly their assigned companyId (they cannot switch).
  // For Super Admin, they can switch between 'default' and customer companies.
  const [activeCompanyId, setActiveCompanyId] = useState<string>(() => {
    try {
      if (localStorage.getItem('worknest_admin_logged_in') === 'true') {
        const stored = localStorage.getItem('worknest_admin_user');
        if (stored) {
          const u = JSON.parse(stored);
          const isSuper = u.email?.toLowerCase() === 'sayemsiraj@gmail.com' || Boolean(u.isPrimarySuperAdmin);
          if (isSuper) {
            const switched = localStorage.getItem('worknest_active_company_id');
            if (switched) return switched;
          }
          if (u.companyId) return u.companyId;
        }
      }
      if (localStorage.getItem('worknest_employee_logged_in') === 'true') {
        const storedEmp = localStorage.getItem('worknest_employee_user');
        if (storedEmp) {
          const emp = JSON.parse(storedEmp);
          if (emp?.companyId) return emp.companyId;
        }
      }
    } catch {}
    return 'default';
  });

  const [currentCompany, setCurrentCompany] = useState<Company | null>(() => {
    try {
      const saved = localStorage.getItem('worknest_current_company');
      return saved ? JSON.parse(saved) : DEFAULT_OWNER_COMPANY;
    } catch {
      return DEFAULT_OWNER_COMPANY;
    }
  });

  const [allCompanies, setAllCompanies] = useState<Company[]>([DEFAULT_OWNER_COMPANY]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [subscriptionCheckFinished, setSubscriptionCheckFinished] = useState(false);

  // Listen to admin/employee user login/logout events across tabs or same-tab dispatches
  useEffect(() => {
    const handleStorage = () => {
      try {
        const isAdminLogged = localStorage.getItem('worknest_admin_logged_in') === 'true';
        const stored = isAdminLogged ? localStorage.getItem('worknest_admin_user') : null;
        const user = stored ? JSON.parse(stored) : null;
        setCurrentUser(user);

        const isEmpLogged = localStorage.getItem('worknest_employee_logged_in') === 'true';
        const storedEmp = isEmpLogged ? localStorage.getItem('worknest_employee_user') : null;
        const emp = storedEmp ? JSON.parse(storedEmp) : null;
        const empComp = emp ? (emp.companyId || 'default') : null;
        setCurrentEmployeeCompanyId(empComp);

        if (user?.companyId) {
          if (user.email?.toLowerCase() !== 'sayemsiraj@gmail.com' && !user.isPrimarySuperAdmin) {
            setActiveCompanyId(user.companyId);
          } else {
            const switched = localStorage.getItem('worknest_active_company_id');
            setActiveCompanyId(switched || 'default');
          }
        } else if (empComp) {
          setActiveCompanyId(empComp);
        } else {
          setActiveCompanyId('default');
        }
      } catch {}
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Sync activeCompanyId when currentUser or currentEmployeeCompanyId changes
  useEffect(() => {
    if (!currentUser) {
      if (currentEmployeeCompanyId) {
        setActiveCompanyId(currentEmployeeCompanyId);
      } else {
        setActiveCompanyId('default');
      }
      return;
    }
    // If not super admin, strictly enforce their assigned companyId
    if (!isSuperAdmin && currentUser.companyId) {
      setActiveCompanyId(currentUser.companyId);
    }
  }, [currentUser, currentEmployeeCompanyId, isSuperAdmin]);

  // Ensure default owner company exists in Firestore (only when authenticated as Super Admin)
  useEffect(() => {
    if (!isSuperAdmin) return;
    const ensureDefaultCompany = async () => {
      try {
        const { db } = getFirebaseInstance();
        const defDocRef = doc(db, 'companies', 'default');
        const snap = await getDoc(defDocRef);
        if (!snap.exists()) {
          await setDoc(defDocRef, sanitizeForFirestore(DEFAULT_OWNER_COMPANY), { merge: true });
        }
      } catch (err) {
        console.warn('Could not verify default company in Firestore:', err);
      }
    };
    ensureDefaultCompany();
  }, [isSuperAdmin]);

  // Real-time listener for the active company document (only when authenticated)
  useEffect(() => {
    if (!currentUser && !currentEmployeeCompanyId) {
      setSubscriptionCheckFinished(true);
      return;
    }

    const { db } = getFirebaseInstance();
    const compRef = doc(db, 'companies', activeCompanyId);

    const unsub = onSnapshot(compRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Company;
        const resolved: Company = {
          ...data,
          id: snap.id,
          subscription: data.subscription || DEFAULT_OWNER_COMPANY.subscription,
          profile: data.profile || {
            companyName: data.name || 'WorkNest Workspace',
            email: data.ownerEmail || 'admin@worknest.com',
            currency: 'BDT (৳)',
            currencySymbol: '৳',
            timezone: 'Asia/Dhaka (GMT+6)',
            fiscalYear: 'July - June',
          }
        };
        setCurrentCompany(resolved);
        try {
          localStorage.setItem('worknest_current_company', JSON.stringify(resolved));
        } catch {}
      } else if (activeCompanyId === 'default') {
        setCurrentCompany(DEFAULT_OWNER_COMPANY);
      }
      setSubscriptionCheckFinished(true);
    }, (err) => {
      console.warn('Tenant listener warning:', err);
      if (activeCompanyId === 'default') {
        setCurrentCompany(DEFAULT_OWNER_COMPANY);
      }
      setSubscriptionCheckFinished(true);
    });

    return () => unsub();
  }, [activeCompanyId, currentUser, currentEmployeeCompanyId]);

  // If not Super Admin, keep allCompanies synced to currentCompany
  useEffect(() => {
    if (!isSuperAdmin) {
      setAllCompanies(currentCompany ? [currentCompany] : [DEFAULT_OWNER_COMPANY]);
    }
  }, [isSuperAdmin, currentCompany]);

  // If Super Admin, listen to all companies in real-time
  useEffect(() => {
    if (!isSuperAdmin) return;

    setLoadingCompanies(true);
    try {
      const { db } = getFirebaseInstance();
      const compQuery = query(collection(db, 'companies'), orderBy('createdAt', 'desc'));
      const unsub = onSnapshot(compQuery, (snap) => {
        const companyMap = new Map<string, Company>();
        // Ensure default owner company is always present
        companyMap.set('default', DEFAULT_OWNER_COMPANY);

        snap.forEach(d => {
          companyMap.set(d.id, { ...d.data(), id: d.id } as Company);
        });

        const list = Array.from(companyMap.values());
        list.sort((a, b) => {
          if (a.id === 'default') return -1;
          if (b.id === 'default') return 1;
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        });

        setAllCompanies(list);
        setLoadingCompanies(false);
      }, (err) => {
        console.warn('All companies stream warning:', err);
        setLoadingCompanies(false);
      });

      return () => unsub();
    } catch (e) {
      console.warn('Failed to listen to companies:', e);
      setLoadingCompanies(false);
    }
  }, [isSuperAdmin]);

  // Calculate Subscription Active status
  const subscription = currentCompany?.subscription || DEFAULT_OWNER_COMPANY.subscription;
  const isSubscriptionActive = (() => {
    // Super admin viewing their own default workspace is always active
    if (activeCompanyId === 'default' && isSuperAdmin) return true;
    if (!subscription) return true;

    // Check status flag
    if (subscription.status === 'suspended') return false;
    if (subscription.status === 'expired') return false;

    // Check expiry date
    if (subscription.expiryDate) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (todayStr > subscription.expiryDate) {
        return false;
      }
    }
    return true;
  })();

  // Super Admin Workspace Switcher
  const switchCompany = useCallback((companyId: string) => {
    if (!isSuperAdmin) {
      console.warn('Only Super Admin can switch workspaces.');
      return;
    }
    setActiveCompanyId(companyId);
    try {
      localStorage.setItem('worknest_active_company_id', companyId);
    } catch {}
  }, [isSuperAdmin]);

  const resetToOwnerCompany = useCallback(() => {
    if (!isSuperAdmin) {
      console.warn('Only Super Admin can reset to master workspace.');
      return;
    }
    setActiveCompanyId('default');
    try {
      localStorage.setItem('worknest_active_company_id', 'default');
    } catch {}
  }, [isSuperAdmin]);

  // Create new customer account and company workspace
  const createCompany = async (payload: CreateCompanyPayload): Promise<{ success: boolean; company?: Company; error?: string }> => {
    if (!isSuperAdmin) {
      return { success: false, error: 'Only Super Admin can create client companies.' };
    }

    try {
      const { db } = getFirebaseInstance();
      const sanitizedName = payload.companyName.trim();
      const cleanEmail = payload.ownerEmail.trim().toLowerCase();

      // Check if company or admin already exists with this email
      const existing = allCompanies.find(c => c.ownerEmail?.toLowerCase() === cleanEmail);
      if (existing) {
        return { success: false, error: `A company already exists with email: ${cleanEmail} (${existing.name})` };
      }

      // Generate unique companyId
      const slug = sanitizedName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15);
      const companyId = `comp_${slug}_${Date.now().toString(36)}`;

      const newCompany: Company = {
        id: companyId,
        name: sanitizedName,
        slug,
        ownerEmail: cleanEmail,
        ownerName: payload.ownerName.trim(),
        status: payload.status === 'suspended' ? 'suspended' : 'active',
        subscription: {
          status: payload.status || 'active',
          plan: payload.plan || 'starter',
          startDate: payload.startDate || new Date().toISOString().split('T')[0],
          expiryDate: payload.expiryDate,
          maxEmployees: payload.maxEmployees || 50,
          currency: payload.currency || 'BDT (৳)',
          notes: payload.notes || '',
          autoRenew: false,
        },
        profile: {
          companyName: sanitizedName,
          email: cleanEmail,
          phone: payload.phone || '',
          currency: payload.currency || 'BDT (৳)',
          currencySymbol: payload.currencySymbol || '৳',
          timezone: 'Asia/Dhaka (GMT+6)',
          fiscalYear: 'July - June',
        },
        settings: {
          attendance: {
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
          },
          leave: {
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
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 1. Write Company doc to Firestore
      await setDoc(doc(db, 'companies', companyId), sanitizeForFirestore(newCompany), { merge: true });

      // 2. Create customer admin account in 'admins' collection
      const adminId = `admin_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
      const defaultPassword = payload.ownerPassword || 'WorkNest@2026';

      const customerAdmin: AdminAccount = {
        id: adminId,
        name: payload.ownerName.trim(),
        email: cleanEmail,
        password: defaultPassword,
        role: 'Super Admin', // Within their own company, they are the main admin
        companyId,
        companyName: sanitizedName,
        isTenantOwner: true,
        status: payload.status === 'suspended' ? 'suspended' : 'active',
        permissions: ROLE_PERMISSION_PRESETS['Super Admin'],
        createdAt: new Date().toISOString(),
      };

      // Save admin in Firestore
      await setDoc(doc(db, 'admins', adminId), sanitizeForFirestore({
        ...customerAdmin,
        isSuperAdmin: false // Ordinary customers NEVER have SaaS-level Super Admin privileges!
      }), { merge: true });

      // Provision isolated Firebase Auth account & users/{uid} + admins/{uid} identity records
      await provisionAdminAuthAccount(
        { ...customerAdmin, isSuperAdmin: false, isPrimarySuperAdmin: false },
        defaultPassword
      );

      // Update local state (deduplicated)
      setAllCompanies(prev => [newCompany, ...prev.filter(c => c.id !== newCompany.id)]);

      return { success: true, company: newCompany };
    } catch (err: any) {
      console.error('Create company error:', err);
      return { success: false, error: err?.message || 'Failed to create company.' };
    }
  };

  // Update subscription details for any company
  const updateCompanySubscription = async (
    companyId: string,
    subUpdates: Partial<CompanySubscription>
  ): Promise<{ success: boolean; error?: string }> => {
    if (!isSuperAdmin) {
      return { success: false, error: 'Only Super Admin can modify subscription details.' };
    }

    try {
      const { db } = getFirebaseInstance();
      const compRef = doc(db, 'companies', companyId);
      const snap = await getDoc(compRef);

      const existingData = snap.exists() ? (snap.data() as Company) : null;
      const currentSub = existingData?.subscription || DEFAULT_OWNER_COMPANY.subscription;

      const mergedSub: CompanySubscription = {
        ...currentSub,
        ...subUpdates,
      };

      await updateDoc(compRef, {
        subscription: sanitizeForFirestore(mergedSub),
        status: mergedSub.status === 'suspended' ? 'suspended' : 'active',
        updatedAt: new Date().toISOString(),
      });

      // Also update admin account status if suspended/active
      if (existingData?.ownerEmail) {
        const cleanEmail = existingData.ownerEmail.toLowerCase();
        const adminId = `admin_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
        try {
          await updateDoc(doc(db, 'admins', adminId), {
            status: mergedSub.status === 'suspended' ? 'suspended' : 'active',
            updatedAt: new Date().toISOString()
          });
        } catch {}
      }

      return { success: true };
    } catch (err: any) {
      console.error('Update subscription error:', err);
      return { success: false, error: err?.message || 'Failed to update subscription.' };
    }
  };

  // Toggle company active / suspended status
  const updateCompanyStatus = async (
    companyId: string,
    status: 'active' | 'suspended'
  ): Promise<{ success: boolean; error?: string }> => {
    return updateCompanySubscription(companyId, { status });
  };

  // Update company profile
  const updateCompanyProfile = async (
    companyId: string,
    profileUpdates: Partial<CompanyProfile>
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { db } = getFirebaseInstance();
      const compRef = doc(db, 'companies', companyId);
      const snap = await getDoc(compRef);

      const existingData = snap.exists() ? (snap.data() as Company) : null;
      const currentProfile = existingData?.profile || DEFAULT_OWNER_COMPANY.profile;

      const mergedProfile: CompanyProfile = {
        ...currentProfile,
        ...profileUpdates,
      };

      await updateDoc(compRef, {
        profile: sanitizeForFirestore(mergedProfile),
        name: mergedProfile.companyName || existingData?.name || 'Company',
        updatedAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update profile.' };
    }
  };

  // Update company settings (attendance, leave, payroll)
  const updateCompanySettings = async (
    companyId: string,
    settingsUpdates: Partial<CompanySettings>
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { db } = getFirebaseInstance();
      const compRef = doc(db, 'companies', companyId);
      const snap = await getDoc(compRef);

      const existingData = snap.exists() ? (snap.data() as Company) : null;
      const currentSettings = existingData?.settings || {};

      const mergedSettings: CompanySettings = {
        ...currentSettings,
        ...settingsUpdates,
      };

      await updateDoc(compRef, {
        settings: sanitizeForFirestore(mergedSettings),
        updatedAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update company settings.' };
    }
  };

  const refreshCompanies = async () => {
    // Triggers refresh via snapshot
  };

  const isViewingCustomerTenant = activeCompanyId !== 'default' && isSuperAdmin;
  const viewingOriginalTenantId = isSuperAdmin ? 'default' : activeCompanyId;

  return (
    <TenantContext.Provider
      value={{
        currentCompanyId: activeCompanyId,
        currentCompany,
        subscription,
        isSubscriptionActive,
        subscriptionCheckFinished,
        isSuperAdmin,
        isViewingCustomerTenant,
        viewingOriginalTenantId,
        allCompanies,
        loadingCompanies,
        switchCompany,
        resetToOwnerCompany,
        createCompany,
        updateCompanySubscription,
        updateCompanyStatus,
        updateCompanyProfile,
        updateCompanySettings,
        refreshCompanies,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}
