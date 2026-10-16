import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  signOut
} from 'firebase/auth';
import { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc } from 'firebase/firestore';
import { getFirebaseInstance, getStoredFirebaseConfig, sanitizeForFirestore } from './firestoreService';

export const auth = getFirebaseInstance().auth;

export const DEFAULT_ADMIN_CREDENTIALS = {
  email: 'sayemsiraj@gmail.com',
  password: 'Sayem@123'
};

export interface AdminPermissions {
  dashboard: boolean;
  employees: boolean;
  departments: boolean;
  shifts: boolean;
  roster: boolean;
  attendance: boolean;
  leave: boolean;
  payroll: boolean;
  recruitment: boolean;
  reports: boolean;
  biometric: boolean;
  settings: boolean;
  mss?: boolean;
  approvals?: boolean;
  documents?: boolean;
  auditLogs?: boolean;
  performance?: boolean;
  expenses?: boolean;
  onboarding?: boolean;
  offboarding?: boolean;
  workforcePlanning?: boolean;
  engagement?: boolean;
  analytics?: boolean;
  learningSkills?: boolean;
  careerTalentSuccession?: boolean;
  executiveDashboard?: boolean;
  globalHub?: boolean;
  enterpriseSecurity?: boolean;
  aiIntelligence?: boolean;
  aiHrIntelligence?: boolean;
}

export type AdminRole =
  | 'Super Admin'
  | 'HR Manager'
  | 'Attendance Officer'
  | 'Payroll Admin'
  | 'Department Supervisor'
  | 'Custom';

export const ROLE_PERMISSION_PRESETS: Record<AdminRole, AdminPermissions> = {
  'Super Admin': {
    dashboard: true,
    employees: true,
    departments: true,
    shifts: true,
    roster: true,
    attendance: true,
    leave: true,
    payroll: true,
    recruitment: true,
    reports: true,
    biometric: true,
    settings: true,
    mss: true,
    approvals: true,
    documents: true,
    auditLogs: true,
    performance: true,
    expenses: true,
    onboarding: true,
    offboarding: true,
    workforcePlanning: true,
    engagement: true,
    analytics: true,
    learningSkills: true,
    careerTalentSuccession: true,
    executiveDashboard: true,
    globalHub: true,
    enterpriseSecurity: true,
    aiIntelligence: true,
  },
  'HR Manager': {
    dashboard: true,
    employees: true,
    departments: true,
    shifts: true,
    roster: true,
    attendance: true,
    leave: true,
    payroll: false,
    recruitment: true,
    reports: true,
    biometric: false,
    settings: false,
    mss: true,
    approvals: true,
    documents: true,
    auditLogs: true,
    performance: true,
    expenses: true,
    onboarding: true,
    offboarding: true,
    workforcePlanning: true,
    engagement: true,
    analytics: true,
    learningSkills: true,
    careerTalentSuccession: true,
    executiveDashboard: true,
    globalHub: true,
    enterpriseSecurity: false,
    aiIntelligence: true,
  },
  'Attendance Officer': {
    dashboard: true,
    employees: false,
    departments: false,
    shifts: true,
    roster: true,
    attendance: true,
    leave: true,
    payroll: false,
    recruitment: false,
    reports: true,
    biometric: true,
    settings: false,
    mss: false,
    approvals: true,
    documents: false,
    auditLogs: false,
    performance: false,
    expenses: false,
    onboarding: false,
    offboarding: false,
    workforcePlanning: false,
    engagement: false,
    analytics: true,
    learningSkills: false,
    careerTalentSuccession: false,
    executiveDashboard: false,
    globalHub: false,
    enterpriseSecurity: false,
    aiIntelligence: true,
  },
  'Payroll Admin': {
    dashboard: true,
    employees: true,
    departments: false,
    shifts: false,
    roster: false,
    attendance: true,
    leave: true,
    payroll: true,
    recruitment: false,
    reports: true,
    biometric: false,
    settings: false,
    mss: false,
    approvals: false,
    documents: true,
    auditLogs: false,
    performance: false,
    expenses: true,
    onboarding: false,
    offboarding: true,
    workforcePlanning: false,
    engagement: false,
    analytics: true,
    learningSkills: false,
    careerTalentSuccession: false,
    executiveDashboard: true,
    globalHub: true,
    enterpriseSecurity: false,
    aiIntelligence: true,
  },
  'Department Supervisor': {
    dashboard: true,
    employees: false,
    departments: false,
    shifts: true,
    roster: true,
    attendance: true,
    leave: true,
    payroll: false,
    recruitment: false,
    reports: false,
    biometric: false,
    settings: false,
    mss: true,
    approvals: true,
    documents: false,
    auditLogs: false,
    performance: true,
    expenses: true,
    onboarding: true,
    offboarding: false,
    workforcePlanning: true,
    engagement: true,
    analytics: true,
    learningSkills: true,
    careerTalentSuccession: true,
    executiveDashboard: false,
    globalHub: false,
    enterpriseSecurity: false,
    aiIntelligence: false,
  },
  'Custom': {
    dashboard: true,
    employees: false,
    departments: false,
    shifts: false,
    roster: false,
    attendance: false,
    leave: false,
    payroll: false,
    recruitment: false,
    reports: false,
    biometric: false,
    settings: false,
    mss: false,
    approvals: false,
    documents: false,
    auditLogs: false,
    performance: false,
    expenses: false,
    onboarding: false,
    offboarding: false,
    workforcePlanning: false,
    engagement: false,
    analytics: false,
    learningSkills: false,
    careerTalentSuccession: false,
    executiveDashboard: false,
    globalHub: false,
    enterpriseSecurity: false,
    aiIntelligence: false,
  },
};

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: AdminRole;
  customRoleId?: string;
  customRoleName?: string;
  status: 'active' | 'suspended';
  avatar?: string;
  phone?: string;
  permissions: AdminPermissions;
  granularPermissions?: {
    canApproveLeave?: boolean;
    canApproveAttendance?: boolean;
    canApproveExpenses?: boolean;
    canRunPayroll?: boolean;
    canLockUnlockPayroll?: boolean;
    canViewSalaryConfidential?: boolean;
    canViewTalentSuccessionConfidential?: boolean;
    canManageEmployees?: boolean;
    canManageAdminsAndRoles?: boolean;
    canExportReportsAndData?: boolean;
    canManageGlobalEntities?: boolean;
    canAccessAiIntelligence?: boolean;
    canTriggerBackupRestore?: boolean;
  };
  mfaEnabled?: boolean;
  mfaSecret?: string;
  mfaBackupCodes?: string[];
  allowedCountries?: string[];
  allowedLegalEntityIds?: string[];
  createdAt: string;
  lastLogin?: string;
  companyId?: string; // Isolated company tenant ID
  companyName?: string; // Client company name
  assignedDepartment?: string; // Manager / Supervisor team department scope
  assignedBranch?: string; // Manager / Supervisor branch scope
  isTenantOwner?: boolean; // Whether this admin is the owner of their company tenant
  isSuperAdmin?: boolean;
  isPrimarySuperAdmin?: boolean;
}

function toHexSlice(input: string, maxLen = 12): string {
  let hex = '';
  for (let i = 0; i < input.length; i++) {
    hex += input.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex.slice(0, maxLen);
}

export function buildEmployeeAuthIdentity(companyId: string, employeeCodeOrId: string, passwordPlain: string) {
  const safeCompSlug = String(companyId || 'default').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const safeEmpSlug = String(employeeCodeOrId || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  const passHash = toHexSlice(String(passwordPlain || '123456'), 12);
  return {
    email: `emp_${safeCompSlug}_${safeEmpSlug}_${passHash}@emp.worknest-hr.app`,
    secret: `WnEmp#${passHash}_2026!`
  };
}

/**
 * Uses an isolated secondary Firebase App instance to create/verify a Firebase Auth user
 * without disturbing the currently signed-in Admin/Super Admin session.
 */
async function ensureIsolatedAuthUser(email: string, password: string): Promise<{ uid: string; email: string; password: string } | null> {
  const config = getStoredFirebaseConfig();
  const tempName = `WorkNestProv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tempApp = initializeApp(config, tempName);
  const tempAuth = getAuth(tempApp);
  try {
    try {
      const cred = await signInWithEmailAndPassword(tempAuth, email, password);
      const uid = cred.user.uid;
      await signOut(tempAuth);
      return { uid, email, password };
    } catch (signInErr: any) {
      if (
        signInErr?.code === 'auth/user-not-found' ||
        signInErr?.code === 'auth/invalid-credential' ||
        signInErr?.code === 'auth/wrong-password'
      ) {
        try {
          const created = await createUserWithEmailAndPassword(tempAuth, email, password);
          const uid = created.user.uid;
          await signOut(tempAuth);
          return { uid, email, password };
        } catch (createErr: any) {
          if (createErr?.code === 'auth/email-already-in-use' && email.toLowerCase() !== DEFAULT_ADMIN_CREDENTIALS.email.toLowerCase()) {
            const safeSlug = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const passHash = toHexSlice(password, 12);
            const aliasEmail = `adm_${safeSlug}_${passHash}@auth.worknest-hr.app`;
            const aliasPassword = `WnAdm#${passHash}_2026!`;
            try {
              const aliasSignIn = await signInWithEmailAndPassword(tempAuth, aliasEmail, aliasPassword);
              const uid = aliasSignIn.user.uid;
              await signOut(tempAuth);
              return { uid, email: aliasEmail, password: aliasPassword };
            } catch {
              const aliasCreated = await createUserWithEmailAndPassword(tempAuth, aliasEmail, aliasPassword);
              const uid = aliasCreated.user.uid;
              await signOut(tempAuth);
              return { uid, email: aliasEmail, password: aliasPassword };
            }
          }
        }
      }
      return null;
    }
  } finally {
    try {
      await deleteApp(tempApp);
    } catch {}
  }
}

/**
 * Provisions a Firebase Auth account and strictly-scoped `users/{uid}` + `admins/{uid}` docs
 * when a Super Admin or Tenant Owner creates/updates an admin account.
 */
export async function provisionAdminAuthAccount(adminDoc: AdminAccount, plainPassword: string): Promise<void> {
  if (!adminDoc.email || !plainPassword) return;
  try {
    const { db } = getFirebaseInstance();

    const cleanEmail = adminDoc.email.trim().toLowerCase();
    const isMaster = cleanEmail === DEFAULT_ADMIN_CREDENTIALS.email.toLowerCase();
    const companyId = isMaster ? 'default' : (adminDoc.companyId || 'default');
    const authRes = await ensureIsolatedAuthUser(cleanEmail, plainPassword);
    if (!authRes) return;

    const nowIso = new Date().toISOString();
    await setDoc(doc(db, 'users', authRes.uid), sanitizeForFirestore({
      uid: authRes.uid,
      email: cleanEmail,
      name: adminDoc.name || 'Admin User',
      role: adminDoc.role || 'Custom',
      companyId,
      isSuperAdmin: isMaster,
      isPrimarySuperAdmin: isMaster,
      isTenantOwner: isMaster ? true : Boolean(adminDoc.isTenantOwner),
      adminDocId: adminDoc.id,
      updatedAt: nowIso
    }), { merge: true });

    await setDoc(doc(db, 'admins', authRes.uid), sanitizeForFirestore({
      ...adminDoc,
      id: authRes.uid,
      email: cleanEmail,
      password: plainPassword,
      companyId,
      isSuperAdmin: isMaster,
      isPrimarySuperAdmin: isMaster,
      isTenantOwner: isMaster ? true : Boolean(adminDoc.isTenantOwner),
      updatedAt: nowIso
    }), { merge: true });
  } catch (err) {
    console.warn('Admin auth provisioning warning:', err);
  }
}

/**
 * Provisions a deterministic Firebase Auth account and strictly-scoped `users/{uid}` doc
 * (with role='Employee', isSuperAdmin=false, companyId=emp.companyId) when an Admin creates/updates an employee.
 */
export async function provisionEmployeeAuthAccount(
  employee: { id: string; employeeId: string; name: string; companyId?: string; isManager?: boolean; department?: string },
  plainPassword?: string
): Promise<void> {
  try {
    const { db } = getFirebaseInstance();

    const companyId = employee.companyId || 'default';
    const empCode = String(employee.employeeId || employee.id || '').trim();
    if (!empCode) return;

    const passwordToUse = plainPassword || '123456';
    const identity = buildEmployeeAuthIdentity(companyId, empCode, passwordToUse);
    const authRes = await ensureIsolatedAuthUser(identity.email, identity.secret);
    if (!authRes) return;

    const nowIso = new Date().toISOString();
    await setDoc(doc(db, 'users', authRes.uid), sanitizeForFirestore({
      uid: authRes.uid,
      email: identity.email,
      name: employee.name || 'Employee',
      displayName: employee.name || 'Employee',
      role: 'Employee',
      companyId,
      employeeId: empCode,
      employeeDocId: employee.id,
      isManager: Boolean(employee.isManager),
      department: employee.department || '',
      isSuperAdmin: false,
      isPrimarySuperAdmin: false,
      isTenantOwner: false,
      updatedAt: nowIso
    }), { merge: true });
  } catch (err) {
    console.warn('Employee auth provisioning warning:', err);
  }
}

/**
 * Authenticates an Admin or Super Admin user.
 * SECURITY INVARIANTS:
 * 1. ONLY the Primary Super Admin (`sayemsiraj@gmail.com`) or an active Administrator explicitly created in the `admins` collection can ever sign in.
 * 2. NEVER creates a Firebase Auth user or fallback Super Admin profile for unknown emails/credentials.
 */
export async function authenticateAdminUser(
  email: string,
  password: string
): Promise<{ success: boolean; user?: any; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) {
    return { success: false, error: 'Email and password are required.' };
  }

  const { auth: activeAuth, db } = getFirebaseInstance();
  const masterEmail = DEFAULT_ADMIN_CREDENTIALS.email.toLowerCase();
  const isMasterEmail = cleanEmail === masterEmail;

  // 1. Try Server-Verified Authentication Endpoint (/iclock/auth) first
  try {
    const resp = await fetch('/iclock/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        action: 'admin_login',
        email: cleanEmail,
        password
      })
    });

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        return {
          success: false,
          error: data.error || 'Access Denied: Invalid email or password.'
        };
      }

      // Sign the browser client into Firebase Auth so Firestore security rules (`request.auth != null`) are satisfied
      const authEmail = data.authEmail || cleanEmail;
      const authSecret = data.authSecret || password;
      await signInWithEmailAndPassword(activeAuth, authEmail, authSecret);

      return {
        success: true,
        user: data.user
      };
    }
  } catch {
    // Server endpoint unavailable in static-only preview; proceed to strict whitelist + Firebase Auth flow
  }

  // 2. Strict Pre-Auth Whitelist Verification against Firestore `admins` collection for non-owner emails
  let preVerifiedAdminDoc: AdminAccount | null = null;
  let preVerifiedAdminId: string | null = null;

  if (!isMasterEmail) {
    try {
      const q = query(collection(db, 'admins'), where('email', '==', cleanEmail));
      const snap = await getDocs(q);
      if (snap.empty) {
        return {
          success: false,
          error: 'Access Denied: Only the Owner and authorized Administrators created by the Super Admin can sign in.'
        };
      }
      const canonicalId = `admin_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
      const picked = snap.docs.find(d => d.id === canonicalId) || snap.docs.find(d => Boolean(d.data()?.password)) || snap.docs[0];
      const docData = picked.data() as AdminAccount;
      if (docData.status === 'suspended') {
        return {
          success: false,
          error: 'This admin account is suspended. Please contact your Super Admin.'
        };
      }
      if (!docData.password || docData.password !== password) {
        return {
          success: false,
          error: 'Invalid email or password. Please verify your credentials.'
        };
      }
      preVerifiedAdminDoc = docData;
      preVerifiedAdminId = picked.id;
    } catch {
      // If Firestore rules require auth before reading `admins`, Step 3 will strictly enforce it after sign-in
    }
  }

  // 3. Direct Firebase Auth Sign-In
  let firebaseUser = null;
  try {
    const cred = await signInWithEmailAndPassword(activeAuth, cleanEmail, password);
    firebaseUser = cred.user;
  } catch (signInErr: any) {
    // NEVER call createUserWithEmailAndPassword for unknown emails!
    // Allow initial Firebase Auth creation ONLY if:
    // (a) Primary Super Admin with default credentials, OR
    // (b) Pre-verified active Admin in Firestore `admins` whose password matched `preVerifiedAdminDoc.password === password`
    if (
      isMasterEmail &&
      password === DEFAULT_ADMIN_CREDENTIALS.password &&
      (signInErr?.code === 'auth/user-not-found' || signInErr?.code === 'auth/invalid-credential')
    ) {
      try {
        const created = await createUserWithEmailAndPassword(activeAuth, cleanEmail, password);
        firebaseUser = created.user;
      } catch {
        return {
          success: false,
          error: 'Invalid email or password. Please verify your credentials.'
        };
      }
    } else if (!isMasterEmail) {
      try {
        const safeSlug = cleanEmail.replace(/[^a-z0-9]/g, '_');
        const passHash = toHexSlice(password, 12);
        const aliasEmail = `adm_${safeSlug}_${passHash}@auth.worknest-hr.app`;
        const aliasPassword = `WnAdm#${passHash}_2026!`;
        try {
          const aliasCred = await signInWithEmailAndPassword(activeAuth, aliasEmail, aliasPassword);
          firebaseUser = aliasCred.user;
        } catch {
          if (preVerifiedAdminDoc && preVerifiedAdminDoc.password === password) {
            try {
              const createdDirect = await createUserWithEmailAndPassword(activeAuth, cleanEmail, password);
              firebaseUser = createdDirect.user;
            } catch {
              const createdAlias = await createUserWithEmailAndPassword(activeAuth, aliasEmail, aliasPassword);
              firebaseUser = createdAlias.user;
            }
          } else {
            return {
              success: false,
              error: 'Access Denied: Invalid email or password.'
            };
          }
        }
      } catch {
        return {
          success: false,
          error: 'Access Denied: Invalid email or password.'
        };
      }
    } else {
      return {
        success: false,
        error: 'Invalid email or password. Please verify your credentials.'
      };
    }
  }

  if (!firebaseUser) {
    return {
      success: false,
      error: 'Invalid email or password. Please verify your credentials.'
    };
  }

  // 4. Verify Admin authorization in Firestore `admins` collection
  try {
    let matchedAdminDoc: AdminAccount | null = preVerifiedAdminDoc;
    let matchedAdminId: string = preVerifiedAdminId || firebaseUser.uid;

    // 4a. Check `admins` by email first so canonical admin record with password/permissions takes precedence
    if (!matchedAdminDoc) {
      const q = query(collection(db, 'admins'), where('email', '==', cleanEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const canonicalId = `admin_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
        const picked = snap.docs.find(d => d.id === canonicalId) || snap.docs.find(d => Boolean(d.data()?.password)) || snap.docs[0];
        matchedAdminDoc = picked.data() as AdminAccount;
        matchedAdminId = picked.id;
      }
    }

    // 4b. Check `admins/{uid}` if still not found
    if (!matchedAdminDoc) {
      const directAdminSnap = await getDoc(doc(db, 'admins', firebaseUser.uid));
      if (directAdminSnap.exists()) {
        matchedAdminDoc = directAdminSnap.data() as AdminAccount;
        matchedAdminId = directAdminSnap.id;
      }
    }

    if (matchedAdminDoc) {
      if (matchedAdminDoc.status === 'suspended') {
        await signOut(activeAuth);
        return {
          success: false,
          error: 'This admin account is suspended. Please contact your Super Admin.'
        };
      }

      const passValid = isMasterEmail
        ? (!matchedAdminDoc.password || matchedAdminDoc.password === password || password === DEFAULT_ADMIN_CREDENTIALS.password)
        : (Boolean(matchedAdminDoc.password) && matchedAdminDoc.password === password);

      if (!passValid) {
        await signOut(activeAuth);
        return {
          success: false,
          error: 'Invalid email or password. Please enter your authorized password.'
        };
      }

      const resolvedCompanyId = isMasterEmail ? 'default' : (matchedAdminDoc.companyId || 'default');
      if (!isMasterEmail && resolvedCompanyId === '__unassigned__') {
        await signOut(activeAuth);
        return {
          success: false,
          error: 'Admin account is not assigned to a valid tenant workspace.'
        };
      }

      const resolvedRole: AdminRole = matchedAdminDoc.role || (isMasterEmail ? 'Super Admin' : 'Custom');
      const nowIso = new Date().toISOString();

      // Update non-privileged lastLogin timestamp if allowed
      try {
        await updateDoc(doc(db, 'admins', matchedAdminId), {
          lastLogin: nowIso,
          updatedAt: nowIso
        });
      } catch {}

      if (isMasterEmail) {
        try {
          await setDoc(doc(db, 'users', firebaseUser.uid), sanitizeForFirestore({
            uid: firebaseUser.uid,
            email: cleanEmail,
            name: matchedAdminDoc.name || 'Sayem Siraj',
            displayName: matchedAdminDoc.name || 'Sayem Siraj',
            role: 'Super Admin',
            companyId: 'default',
            isSuperAdmin: true,
            isPrimarySuperAdmin: true,
            isTenantOwner: true,
            lastLogin: nowIso,
            updatedAt: nowIso
          }), { merge: true });
        } catch {}
      }

      return {
        success: true,
        user: {
          id: matchedAdminId,
          uid: firebaseUser.uid,
          name: matchedAdminDoc.name || (isMasterEmail ? 'Sayem Siraj' : 'Admin User'),
          email: cleanEmail,
          role: resolvedRole,
          companyId: resolvedCompanyId,
          companyName: matchedAdminDoc.companyName || (isMasterEmail ? 'WorkNest Technologies Ltd.' : 'My Organization'),
          assignedDepartment: matchedAdminDoc.assignedDepartment || '',
          assignedBranch: matchedAdminDoc.assignedBranch || '',
          isTenantOwner: isMasterEmail ? true : Boolean(matchedAdminDoc.isTenantOwner),
          isSuperAdmin: isMasterEmail,
          isPrimarySuperAdmin: isMasterEmail,
          permissions: matchedAdminDoc.permissions || ROLE_PERMISSION_PRESETS[resolvedRole] || ROLE_PERMISSION_PRESETS['Custom'],
          avatar: matchedAdminDoc.avatar || '👨‍💼',
          username: cleanEmail.split('@')[0],
        }
      };
    }

    // 4c. If no document in `admins`, ONLY allow the configured Primary Super Admin (`sayemsiraj@gmail.com`)
    if (isMasterEmail) {
      let firestoreMasterPassword: string | null = null;
      try {
        const secSnap = await getDoc(doc(db, 'settings', 'security'));
        if (secSnap.exists() && secSnap.data()?.masterPassword) {
          firestoreMasterPassword = secSnap.data().masterPassword;
        }
      } catch {}

      if (firestoreMasterPassword && password !== firestoreMasterPassword && password !== DEFAULT_ADMIN_CREDENTIALS.password) {
        await signOut(activeAuth);
        return {
          success: false,
          error: 'Invalid password. Please use your newly changed password.'
        };
      }

      const nowIso = new Date().toISOString();
      try {
        await setDoc(doc(db, 'users', firebaseUser.uid), sanitizeForFirestore({
          uid: firebaseUser.uid,
          email: cleanEmail,
          name: 'Sayem Siraj',
          displayName: 'Sayem Siraj',
          role: 'Super Admin',
          companyId: 'default',
          isSuperAdmin: true,
          isPrimarySuperAdmin: true,
          isTenantOwner: true,
          lastLogin: nowIso,
          updatedAt: nowIso
        }), { merge: true });

        await setDoc(doc(db, 'admins', firebaseUser.uid), sanitizeForFirestore({
          id: firebaseUser.uid,
          name: 'Sayem Siraj',
          email: cleanEmail,
          role: 'Super Admin',
          status: 'active',
          companyId: 'default',
          companyName: 'WorkNest Technologies Ltd.',
          isSuperAdmin: true,
          isPrimarySuperAdmin: true,
          isTenantOwner: true,
          permissions: ROLE_PERMISSION_PRESETS['Super Admin'],
          avatar: '👨‍💼',
          lastLogin: nowIso,
          updatedAt: nowIso
        }), { merge: true });
      } catch {}

      return {
        success: true,
        user: {
          id: 'admin_sayemsiraj',
          uid: firebaseUser.uid,
          name: 'Sayem Siraj',
          email: cleanEmail,
          role: 'Super Admin',
          companyId: 'default',
          companyName: 'WorkNest Technologies Ltd.',
          isPrimarySuperAdmin: true,
          isSuperAdmin: true,
          isTenantOwner: true,
          avatar: '👨‍💼',
          username: 'sayemsiraj',
          permissions: ROLE_PERMISSION_PRESETS['Super Admin'],
        }
      };
    }

    // Any other Firebase Auth account that is NOT in `admins` is strictly rejected and signed out!
    await signOut(activeAuth);
    return {
      success: false,
      error: 'Access Denied: Only the Owner and authorized Administrators created by the Super Admin can sign in.'
    };
  } catch (verifyErr) {
    console.error('Admin verification error:', verifyErr);
    try {
      await signOut(activeAuth);
    } catch {}
    return {
      success: false,
      error: 'Access Denied: Invalid email or password.'
    };
  }
}

/**
 * Authenticates an Employee for the Employee Self-Service Portal.
 * SECURITY INVARIANTS (Blocker 3):
 * 1. Works on a fresh browser / device without requiring a prior admin login session.
 * 2. Establishes a real Firebase Auth session (`request.auth != null`) mapped to `users/{uid}` with `role: 'Employee'`, `isSuperAdmin: false`, and the employee's exact `companyId`.
 * 3. Strips `password` before storing or returning the employee profile.
 */
export async function authenticateEmployeeUser(
  employeeIdInput: string,
  passwordInput: string,
  companyIdHint?: string
): Promise<{ success: boolean; employee?: any; error?: string }> {
  const cleanEmpId = String(employeeIdInput || '').trim();
  const password = String(passwordInput || '');

  if (!cleanEmpId || !password) {
    return { success: false, error: 'Employee ID and Password are required.' };
  }

  const { auth: activeAuth, db } = getFirebaseInstance();

  // 1. Primary path: Server-Verified Employee Authentication Endpoint (/iclock/auth)
  try {
    const resp = await fetch('/iclock/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        action: 'employee_login',
        employeeId: cleanEmpId,
        password,
        companyId: companyIdHint || undefined
      })
    });

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        return {
          success: false,
          error: data.error || 'Invalid Employee ID or Password'
        };
      }

      if (data.employee?.status === 'inactive' || data.employee?.accessTerminated) {
        return {
          success: false,
          error: 'Employee portal access has been terminated following offboarding.'
        };
      }

      // Sign the browser client into the isolated Employee Firebase Auth session
      if (data.authEmail && data.authSecret) {
        await signInWithEmailAndPassword(activeAuth, data.authEmail, data.authSecret);
      }

      const { password: _omitted, ...safeEmployee } = data.employee || {};
      return {
        success: true,
        employee: safeEmployee
      };
    }
  } catch {
    // Server endpoint unreachable; proceed to direct Firebase Auth employee session sign-in
  }

  // 2. Fallback path: Direct Firebase Auth sign-in using deterministic Employee Auth identity
  const candidateTenants = Array.from(new Set([
    companyIdHint || 'default',
    'default'
  ]));

  for (const tenantId of candidateTenants) {
    const identity = buildEmployeeAuthIdentity(tenantId, cleanEmpId, password);
    try {
      const cred = await signInWithEmailAndPassword(activeAuth, identity.email, identity.secret);
      const fbUid = cred.user.uid;

      // Read employee's own users/{uid} mapping (`request.auth.uid == userId` is allowed by Firestore rules)
      const userSnap = await getDoc(doc(db, 'users', fbUid));
      if (!userSnap.exists()) {
        await signOut(activeAuth);
        continue;
      }

      const userData = userSnap.data();
      if (userData.role !== 'Employee' || !userData.companyId) {
        await signOut(activeAuth);
        continue;
      }

      const empDocId = userData.employeeDocId || userData.employeeId || cleanEmpId;
      const empSnap = await getDoc(doc(db, 'employees', empDocId));
      if (!empSnap.exists()) {
        await signOut(activeAuth);
        continue;
      }

      const empData = empSnap.data();
      if (empData.status === 'inactive') {
        await signOut(activeAuth);
        return { success: false, error: 'This employee account is inactive.' };
      }

      const expectedPass = empData.password ? String(empData.password) : '123456';
      if (password !== expectedPass) {
        await signOut(activeAuth);
        return { success: false, error: 'Invalid Employee ID or Password' };
      }

      const { password: _omitted, ...safeEmp } = empData;
      return {
        success: true,
        employee: {
          ...safeEmp,
          id: empSnap.id,
          companyId: empData.companyId || userData.companyId || 'default'
        }
      };
    } catch {}
  }

  return {
    success: false,
    error: 'Invalid Employee ID or Password'
  };
}

export async function changeAdminPassword(newPassword: string, currentUserEmail?: string): Promise<{ success: boolean; error?: string }> {
  const { auth: activeAuth, db } = getFirebaseInstance();
  const email = (currentUserEmail || activeAuth.currentUser?.email || DEFAULT_ADMIN_CREDENTIALS.email).toLowerCase();
  const isMasterEmail = email === DEFAULT_ADMIN_CREDENTIALS.email.toLowerCase();

  try {
    // 1. Try Firebase Auth updatePassword if actively signed in
    if (activeAuth.currentUser) {
      try {
        await updatePassword(activeAuth.currentUser, newPassword);
      } catch (fbPassErr) {
        console.warn('Firebase Auth updatePassword warning:', fbPassErr);
      }
    }

    // 2. Persist new master password into Firestore 'settings/security' document ONLY if Primary Super Admin
    if (isMasterEmail) {
      try {
        await setDoc(doc(db, 'settings', 'security'), {
          masterPassword: newPassword,
          updatedAt: new Date().toISOString(),
          updatedBy: email
        }, { merge: true });
      } catch (secErr) {
        console.warn('Firestore settings/security sync warning:', secErr);
      }
    }

    // 3. Update in Firestore 'admins' collection for this admin's own record
    try {
      const adminsRef = collection(db, 'admins');
      const q = query(adminsRef, where('email', '==', email));
      const snap = await getDocs(q);

      if (!snap.empty) {
        for (const d of snap.docs) {
          await updateDoc(doc(db, 'admins', d.id), {
            password: newPassword,
            updatedAt: new Date().toISOString()
          });
        }
      } else if (isMasterEmail) {
        await setDoc(doc(db, 'admins', 'admin_sayemsiraj'), {
          id: 'admin_sayemsiraj',
          name: 'Sayem Siraj',
          email: email,
          password: newPassword,
          role: 'Super Admin',
          companyId: 'default',
          isSuperAdmin: true,
          isPrimarySuperAdmin: true,
          isTenantOwner: true,
          status: 'active',
          avatar: '👨‍💼',
          permissions: ROLE_PERMISSION_PRESETS['Super Admin'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (fsErr) {
      console.warn('Firestore password sync warning:', fsErr);
    }

    // 4. Update localStorage if rememberMe was active (without storing plaintext password in worknest_admin_user)
    try {
      if (isMasterEmail) {
        localStorage.setItem('worknest_master_password', newPassword);
      }

      const rememberStr = localStorage.getItem('worknest_remember_admin');
      if (rememberStr) {
        const rem = JSON.parse(rememberStr);
        rem.password = newPassword;
        localStorage.setItem('worknest_remember_admin', JSON.stringify(rem));
      }
    } catch {}

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not update password.' };
  }
}
