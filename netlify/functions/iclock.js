/**
 * ZKTeco ADMS / iClock Push SDK Webhook & Server-Side Auth Pipeline
 * Handles communication from ZKTeco biometric devices (SenseFace 2A, K40, MB20, uFace800, etc.)
 * and server-verified authentication for Admin & Employee Portal sessions.
 * Strictly tenant-isolated and integrated with WorkNest HR Firebase Firestore & Auth.
 */

import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  setLogLevel,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  limit
} from 'firebase/firestore';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';

try {
  setLogLevel('silent');
} catch {}

const FIREBASE_CONFIG = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyDHwo-1Kmo85g0cu2FItl7PUihZ_jTavIA",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "work-nest-hr-b1642.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "work-nest-hr-b1642",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "work-nest-hr-b1642.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "583826695092",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:583826695092:web:247157367639a1b90048e1"
};

const SERVER_MASTER_EMAIL = (process.env.WORKNEST_SERVER_ADMIN_EMAIL || 'sayemsiraj@gmail.com').toLowerCase();
const SERVER_MASTER_DEFAULT_PASSWORD = process.env.WORKNEST_SERVER_ADMIN_PASSWORD || 'Sayem@123';

const SERVER_APP_NAME = 'WorkNestServerApp';
let serverApp = null;
let db = null;
let serverAuth = null;

export function getDb() {
  if (!db) {
    const existing = getApps().find(a => a.name === SERVER_APP_NAME);
    serverApp = existing || initializeApp(FIREBASE_CONFIG, SERVER_APP_NAME);
    try {
      db = initializeFirestore(serverApp, { experimentalAutoDetectLongPolling: true });
    } catch {
      db = getFirestore(serverApp);
    }
    serverAuth = getAuth(serverApp);
  }
  return db;
}

/**
 * Ensures the server-side Firestore instance is authenticated as the platform Super Admin
 * so Firestore security rules remain strictly enforced (never publicly writable).
 */
export async function ensureServerAuthenticated() {
  const firestoreDb = getDb();
  if (serverAuth && serverAuth.currentUser && serverAuth.currentUser.email?.toLowerCase() === SERVER_MASTER_EMAIL) {
    return { db: firestoreDb, auth: serverAuth };
  }

  try {
    await signInWithEmailAndPassword(serverAuth, SERVER_MASTER_EMAIL, SERVER_MASTER_DEFAULT_PASSWORD);
  } catch (err) {
    // Check if master password was updated in settings/security
    try {
      const secSnap = await getDoc(doc(firestoreDb, 'settings', 'security'));
      if (secSnap.exists() && secSnap.data()?.masterPassword) {
        await signInWithEmailAndPassword(serverAuth, SERVER_MASTER_EMAIL, secSnap.data().masterPassword);
      }
    } catch (innerErr) {
      console.warn('[Server Auth] Could not sign in server principal:', innerErr?.message || err?.message);
    }
  }

  return { db: firestoreDb, auth: serverAuth };
}

function sanitizeData(obj) {
  return JSON.parse(JSON.stringify(obj, (_, val) => (val === undefined ? null : val)));
}

/**
 * Provisions or verifies a Firebase Auth account using an isolated ephemeral Firebase App
 * so the server's primary auth state is never clobbered.
 */
async function ensureIsolatedFirebaseAuthUser(email, password) {
  const appName = `WorkNestProv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tempApp = initializeApp(FIREBASE_CONFIG, appName);
  const tempAuth = getAuth(tempApp);
  try {
    try {
      const cred = await signInWithEmailAndPassword(tempAuth, email, password);
      const uid = cred.user.uid;
      await signOut(tempAuth);
      return { success: true, uid, email, password };
    } catch (signInErr) {
      if (
        signInErr?.code === 'auth/user-not-found' ||
        signInErr?.code === 'auth/invalid-credential' ||
        signInErr?.code === 'auth/wrong-password'
      ) {
        try {
          const created = await createUserWithEmailAndPassword(tempAuth, email, password);
          const uid = created.user.uid;
          await signOut(tempAuth);
          return { success: true, uid, email, password };
        } catch (createErr) {
          // If email already exists in Firebase Auth with a different password (e.g. after Super Admin reset password in Firestore),
          // create/sign-in a deterministic session principal tied to the updated credential hash.
          if (createErr?.code === 'auth/email-already-in-use' && email.toLowerCase() !== SERVER_MASTER_EMAIL) {
            const safeSlug = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const passHash = Buffer.from(String(password)).toString('hex').slice(0, 12);
            const aliasEmail = `adm_${safeSlug}_${passHash}@auth.worknest-hr.app`;
            const aliasPassword = `WnAdm#${passHash}_2026!`;
            try {
              const aliasSignIn = await signInWithEmailAndPassword(tempAuth, aliasEmail, aliasPassword);
              const uid = aliasSignIn.user.uid;
              await signOut(tempAuth);
              return { success: true, uid, email: aliasEmail, password: aliasPassword };
            } catch {
              const aliasCreated = await createUserWithEmailAndPassword(tempAuth, aliasEmail, aliasPassword);
              const uid = aliasCreated.user.uid;
              await signOut(tempAuth);
              return { success: true, uid, email: aliasEmail, password: aliasPassword };
            }
          }
          throw createErr;
        }
      }
      throw signInErr;
    }
  } finally {
    try {
      await deleteApp(tempApp);
    } catch {}
  }
}

const ROLE_PERMISSION_PRESETS = {
  'Super Admin': {
    dashboard: true, employees: true, departments: true, shifts: true, roster: true,
    attendance: true, leave: true, payroll: true, recruitment: true, reports: true,
    biometric: true, settings: true,
  },
  'HR Manager': {
    dashboard: true, employees: true, departments: true, shifts: true, roster: true,
    attendance: true, leave: true, payroll: false, recruitment: true, reports: true,
    biometric: false, settings: false,
  },
  'Attendance Officer': {
    dashboard: true, employees: false, departments: false, shifts: true, roster: true,
    attendance: true, leave: true, payroll: false, recruitment: false, reports: true,
    biometric: true, settings: false,
  },
  'Payroll Admin': {
    dashboard: true, employees: true, departments: false, shifts: false, roster: false,
    attendance: true, leave: true, payroll: true, recruitment: false, reports: true,
    biometric: false, settings: false,
  },
  'Department Supervisor': {
    dashboard: true, employees: false, departments: false, shifts: true, roster: true,
    attendance: true, leave: true, payroll: false, recruitment: false, reports: false,
    biometric: false, settings: false,
  },
  'Custom': {
    dashboard: true, employees: false, departments: false, shifts: false, roster: false,
    attendance: false, leave: false, payroll: false, recruitment: false, reports: false,
    biometric: false, settings: false,
  },
};

/**
 * Server-Side Authentication Handler for Admin & Employee Portal Logins
 * Prevents:
 * - Unknown credentials creating fallback Super Admin accounts (Blocker 2)
 * - Unauthenticated fresh-browser Employee Portal login failures (Blocker 3)
 * - Client-side privilege escalation on users/{uid} and admins/{uid} (Blocker 1)
 */
async function handleAuthRequest(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '{}' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  let payload = {};
  try {
    let rawBody = event.body || '{}';
    if (event.isBase64Encoded) {
      rawBody = Buffer.from(rawBody, 'base64').toString('utf-8');
    }
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON payload' }) };
  }

  const { db: firestoreDb } = await ensureServerAuthenticated();
  const action = payload.action;

  // =========================================================================
  // 1. ADMIN LOGIN VERIFICATION (Blocker 1 & Blocker 2)
  // =========================================================================
  if (action === 'admin_login') {
    const cleanEmail = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '');

    if (!cleanEmail || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Email and password are required.' })
      };
    }

    const isMasterEmail = cleanEmail === SERVER_MASTER_EMAIL;

    // 1a. Check Firestore 'admins' collection for explicitly configured Admin Account
    let matchedAdminDoc = null;
    let matchedAdminId = null;

    try {
      const q = query(collection(firestoreDb, 'admins'), where('email', '==', cleanEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        // Prefer canonical admin_<email> document or one with password set if multiple exist
        const canonicalId = `admin_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
        const canonicalMatch = snap.docs.find(d => d.id === canonicalId) || snap.docs.find(d => Boolean(d.data()?.password)) || snap.docs[0];
        matchedAdminDoc = canonicalMatch.data();
        matchedAdminId = canonicalMatch.id;
      }
    } catch (e) {
      console.warn('[Server Auth] Error querying admins:', e?.message);
    }

    // 1b. Check Firestore 'settings/security' for updated master password (only applicable to Master Super Admin)
    let firestoreMasterPassword = null;
    if (isMasterEmail) {
      try {
        const secSnap = await getDoc(doc(firestoreDb, 'settings', 'security'));
        if (secSnap.exists() && secSnap.data()?.masterPassword) {
          firestoreMasterPassword = secSnap.data().masterPassword;
        }
      } catch {}
    }

    if (matchedAdminDoc) {
      if (matchedAdminDoc.status === 'suspended') {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'This admin account is suspended. Please contact your Super Admin.'
          })
        };
      }

      const expectedPassword = matchedAdminDoc.password;
      const passwordMatches = isMasterEmail
        ? (password === expectedPassword ||
           (firestoreMasterPassword && password === firestoreMasterPassword) ||
           (!expectedPassword && !firestoreMasterPassword && password === SERVER_MASTER_DEFAULT_PASSWORD))
        : (Boolean(expectedPassword) && password === expectedPassword);

      if (!passwordMatches) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Invalid email or password. Please verify your credentials.'
          })
        };
      }

      const resolvedCompanyId = isMasterEmail ? 'default' : (matchedAdminDoc.companyId || '__unassigned__');
      if (!isMasterEmail && (!resolvedCompanyId || resolvedCompanyId === '__unassigned__')) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Admin account is not assigned to a valid tenant workspace.'
          })
        };
      }

      // Provision / verify Firebase Auth session for this verified admin
      const authRes = await ensureIsolatedFirebaseAuthUser(cleanEmail, password);
      const fbUid = authRes.uid;
      const resolvedRole = matchedAdminDoc.role || (isMasterEmail ? 'Super Admin' : 'Custom');
      const nowIso = new Date().toISOString();

      // Write authoritative users/{uid} and admins/{uid} documents from server (Super Admin authority)
      await setDoc(doc(firestoreDb, 'users', fbUid), sanitizeData({
        uid: fbUid,
        email: cleanEmail,
        name: matchedAdminDoc.name || (isMasterEmail ? 'Sayem Siraj' : 'Admin User'),
        role: resolvedRole,
        companyId: resolvedCompanyId,
        isSuperAdmin: isMasterEmail,
        isPrimarySuperAdmin: isMasterEmail,
        isTenantOwner: isMasterEmail ? true : Boolean(matchedAdminDoc.isTenantOwner),
        adminDocId: matchedAdminId,
        lastLogin: nowIso,
        updatedAt: nowIso
      }), { merge: true });

      await setDoc(doc(firestoreDb, 'admins', fbUid), sanitizeData({
        id: fbUid,
        name: matchedAdminDoc.name || (isMasterEmail ? 'Sayem Siraj' : 'Admin User'),
        email: cleanEmail,
        password: matchedAdminDoc.password || password,
        role: resolvedRole,
        status: 'active',
        companyId: resolvedCompanyId,
        companyName: matchedAdminDoc.companyName || (isMasterEmail ? 'WorkNest Technologies Ltd.' : 'My Organization'),
        isTenantOwner: isMasterEmail ? true : Boolean(matchedAdminDoc.isTenantOwner),
        isSuperAdmin: isMasterEmail,
        isPrimarySuperAdmin: isMasterEmail,
        permissions: matchedAdminDoc.permissions || ROLE_PERMISSION_PRESETS[resolvedRole] || ROLE_PERMISSION_PRESETS['Custom'],
        avatar: matchedAdminDoc.avatar || '👨‍💼',
        lastLogin: nowIso,
        updatedAt: nowIso
      }), { merge: true });

      try {
        await updateDoc(doc(firestoreDb, 'admins', matchedAdminId), { lastLogin: nowIso });
      } catch {}

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          authEmail: authRes.email,
          authSecret: authRes.password,
          user: {
            id: matchedAdminId,
            uid: fbUid,
            name: matchedAdminDoc.name || (isMasterEmail ? 'Sayem Siraj' : 'Admin User'),
            email: cleanEmail,
            role: resolvedRole,
            companyId: resolvedCompanyId,
            companyName: matchedAdminDoc.companyName || (isMasterEmail ? 'WorkNest Technologies Ltd.' : 'My Organization'),
            isTenantOwner: isMasterEmail ? true : Boolean(matchedAdminDoc.isTenantOwner),
            isSuperAdmin: isMasterEmail,
            isPrimarySuperAdmin: isMasterEmail,
            permissions: matchedAdminDoc.permissions || ROLE_PERMISSION_PRESETS[resolvedRole] || ROLE_PERMISSION_PRESETS['Custom'],
            avatar: matchedAdminDoc.avatar || '👨‍💼',
            username: cleanEmail.split('@')[0],
          }
        })
      };
    }

    // 1c. If NO adminDoc in 'admins', ONLY allow legitimate Primary Super Admin (sayemsiraj@gmail.com)
    if (isMasterEmail) {
      const validMasterPass = firestoreMasterPassword
        ? (password === firestoreMasterPassword || password === SERVER_MASTER_DEFAULT_PASSWORD)
        : (password === SERVER_MASTER_DEFAULT_PASSWORD);

      if (!validMasterPass) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Invalid email or password. Please verify your credentials.'
          })
        };
      }

      const authRes = await ensureIsolatedFirebaseAuthUser(cleanEmail, password);
      const fbUid = authRes.uid;
      const nowIso = new Date().toISOString();

      await setDoc(doc(firestoreDb, 'users', fbUid), sanitizeData({
        uid: fbUid,
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

      await setDoc(doc(firestoreDb, 'admins', fbUid), sanitizeData({
        id: fbUid,
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

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          authEmail: authRes.email,
          authSecret: authRes.password,
          user: {
            id: 'admin_sayemsiraj',
            uid: fbUid,
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
        })
      };
    }

    // Unknown email: NEVER create an account and NEVER grant fallback Super Admin!
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Invalid email or password. Please verify your credentials.'
      })
    };
  }

  // =========================================================================
  // 2. EMPLOYEE PORTAL LOGIN VERIFICATION (Blocker 3)
  // =========================================================================
  if (action === 'employee_login') {
    const rawEmployeeId = String(payload.employeeId || '').trim();
    const password = String(payload.password || '');
    const companyIdHint = payload.companyId ? String(payload.companyId).trim() : '';

    if (!rawEmployeeId || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Employee ID and Password are required.' })
      };
    }

    const cleanEmpIdLower = rawEmployeeId.toLowerCase();
    let matchedEmployee = null;

    try {
      const empSnap = await getDocs(collection(firestoreDb, 'employees'));
      const candidates = [];
      empSnap.forEach(d => {
        const data = d.data();
        const docIdLower = String(d.id || '').trim().toLowerCase();
        const empCodeLower = String(data.employeeId || '').trim().toLowerCase();
        const empComp = data.companyId || 'default';

        if (companyIdHint && empComp !== companyIdHint) {
          return;
        }

        if (empCodeLower === cleanEmpIdLower || docIdLower === cleanEmpIdLower) {
          candidates.push({ ...data, id: d.id, companyId: empComp });
        }
      });

      // Find candidate matching password
      for (const cand of candidates) {
        if (cand.status === 'inactive') continue;
        const expectedPass = cand.password ? String(cand.password) : '123456';
        if (password === expectedPass) {
          matchedEmployee = cand;
          break;
        }
      }
    } catch (err) {
      console.error('[Server Auth] Employee lookup error:', err?.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Authentication service error.' })
      };
    }

    if (!matchedEmployee) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid Employee ID or Password' })
      };
    }

    const empCompanyId = matchedEmployee.companyId || 'default';
    // Verify tenant subscription/status is not suspended if non-default company
    if (empCompanyId !== 'default') {
      try {
        const compSnap = await getDoc(doc(firestoreDb, 'companies', empCompanyId));
        if (compSnap.exists()) {
          const compData = compSnap.data();
          if (compData.status === 'suspended' || compData.subscription?.status === 'suspended') {
            return {
              statusCode: 403,
              headers,
              body: JSON.stringify({
                success: false,
                error: 'Your organization workspace is currently suspended. Please contact your HR Administrator.'
              })
            };
          }
        }
      } catch {}
    }

    const safeCompSlug = empCompanyId.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const safeEmpSlug = String(matchedEmployee.employeeId || matchedEmployee.id).toLowerCase().replace(/[^a-z0-9]/g, '_');
    const passHash = Buffer.from(String(password)).toString('hex').slice(0, 12);
    const empAuthEmail = `emp_${safeCompSlug}_${safeEmpSlug}_${passHash}@emp.worknest-hr.app`;
    const empAuthSecret = `WnEmp#${passHash}_2026!`;

    const authRes = await ensureIsolatedFirebaseAuthUser(empAuthEmail, empAuthSecret);
    const empAuthUid = authRes.uid;
    const nowIso = new Date().toISOString();

    // Write strictly scoped Employee identity mapping in users/{uid}
    // role is locked to 'Employee', isSuperAdmin is false, and companyId is locked to empCompanyId
    await setDoc(doc(firestoreDb, 'users', empAuthUid), sanitizeData({
      uid: empAuthUid,
      email: empAuthEmail,
      name: matchedEmployee.name || 'Employee',
      displayName: matchedEmployee.name || 'Employee',
      role: 'Employee',
      companyId: empCompanyId,
      employeeId: matchedEmployee.employeeId || matchedEmployee.id,
      employeeDocId: matchedEmployee.id,
      isSuperAdmin: false,
      isPrimarySuperAdmin: false,
      isTenantOwner: false,
      lastLogin: nowIso,
      updatedAt: nowIso
    }), { merge: true });

    // Strip password before returning employee profile to client!
    const { password: _omittedPassword, ...safeEmployee } = matchedEmployee;
    safeEmployee.companyId = empCompanyId;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        authEmail: authRes.email,
        authSecret: authRes.password,
        employee: safeEmployee
      })
    };
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ success: false, error: 'Unsupported auth action' })
  };
}

/**
 * Maps ZKTeco VerifyType codes to human-readable verification modes
 * 0: Password / PIN
 * 1: Fingerprint
 * 2: Card / RFID
 * 3: Password / PIN
 * 4 / 15: Face (SenseFace 2A Visible Light Facial Recognition uses 15)
 * 25: Palm
 */
export function mapVerifyMode(verifyTypeRaw) {
  if (!verifyTypeRaw && verifyTypeRaw !== 0) return 'UNKNOWN';
  const str = String(verifyTypeRaw).trim().toLowerCase();
  if (str === '1' || str === 'fingerprint' || str === 'finger') return 'Fingerprint';
  if (str === '4' || str === '15' || str === 'face' || str === 'facial') return 'Face';
  if (str === '2' || str === 'card' || str === 'rfid') return 'Card';
  if (str === '0' || str === '3' || str === 'password' || str === 'pin') return 'PIN';
  if (str === '25' || str === 'palm') return 'Palm';
  return 'UNKNOWN';
}

/**
 * Parses timestamp and ensures Bangladesh (Asia/Dhaka, UTC+6) representation
 */
export function parseBangladeshTimestamp(rawTimeStr) {
  if (!rawTimeStr) {
    const now = new Date();
    const bdTime = new Date(now.getTime() + 6 * 3600000);
    const dateStr = bdTime.toISOString().slice(0, 10);
    const timeStr = bdTime.toISOString().slice(11, 16);
    return {
      originalTimestamp: `${dateStr} ${timeStr}:00`,
      dateStr,
      timeStr,
      isoTimestamp: `${dateStr}T${timeStr}:00+06:00`
    };
  }

  const clean = rawTimeStr.trim();
  let dateStr = '';
  let timeStr = '';
  let secondsStr = '00';

  if (clean.includes('T')) {
    const parts = clean.split('T');
    dateStr = parts[0];
    const timeParts = parts[1].replace(/Z|[+-].*$/, '').split(':');
    timeStr = `${timeParts[0] || '00'}:${timeParts[1] || '00'}`;
    secondsStr = timeParts[2] ? timeParts[2].slice(0, 2) : '00';
  } else if (clean.includes(' ')) {
    const parts = clean.split(' ');
    dateStr = parts[0];
    const timeParts = (parts[1] || '00:00:00').split(':');
    timeStr = `${timeParts[0] || '00'}:${timeParts[1] || '00'}`;
    secondsStr = timeParts[2] ? timeParts[2].slice(0, 2) : '00';
  } else {
    dateStr = clean.slice(0, 10);
    timeStr = '00:00';
  }

  return {
    originalTimestamp: clean,
    dateStr,
    timeStr,
    isoTimestamp: `${dateStr}T${timeStr}:${secondsStr}+06:00`
  };
}

/**
 * Parses a single ADMS ATTLOG line
 * Format: PIN\tTime\tStatus\tVerifyType\tWorkCode\tReserved1\tReserved2
 */
export function parseAttlogLine(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.includes('\t') ? trimmed.split('\t') : trimmed.split(/\s{2,}|\t/);
  if (parts.length < 2) {
    const altParts = trimmed.split(/\s+/);
    if (altParts.length >= 3 && altParts[1].includes('-') && altParts[2].includes(':')) {
      return {
        pin: altParts[0].trim(),
        rawTime: `${altParts[1]} ${altParts[2]}`,
        status: altParts[3] || '0',
        verifyType: altParts[4] || ''
      };
    }
    return null;
  }

  const pin = parts[0].trim();
  const rawTime = parts[1].trim();
  const status = parts[2] ? parts[2].trim() : '0';
  const verifyType = parts[3] ? parts[3].trim() : '';

  if (!pin || !rawTime || !rawTime.includes('-')) return null;

  return { pin, rawTime, status, verifyType };
}

/**
 * Dynamically computes the current running month boundaries in Bangladesh (Asia/Dhaka, UTC+6) timezone.
 */
export function getCurrentMonthRange() {
  const now = new Date();
  const bdNow = new Date(now.getTime() + 6 * 3600000);
  const curYear = bdNow.getUTCFullYear();
  const curMonth = bdNow.getUTCMonth();

  const currentMonthStart = `${curYear}-${String(curMonth + 1).padStart(2, '0')}-01`;
  const nextMonthYear = curMonth === 11 ? curYear + 1 : curYear;
  const nextMonthVal = curMonth === 11 ? 1 : curMonth + 2;
  const nextMonthStart = `${nextMonthYear}-${String(nextMonthVal).padStart(2, '0')}-01`;

  return { currentMonthStart, nextMonthStart };
}

export function isCurrentMonth(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const { currentMonthStart, nextMonthStart } = getCurrentMonthRange();
  return dateStr >= currentMonthStart && dateStr < nextMonthStart;
}

export function minTime(t1, t2) {
  if (!t1 || t1 === '-') return t2 || '-';
  if (!t2 || t2 === '-') return t1 || '-';
  return t1 < t2 ? t1 : t2;
}

export function maxTime(t1, t2) {
  if (!t1 || t1 === '-') return t2 || '-';
  if (!t2 || t2 === '-') return t1 || '-';
  return t1 > t2 ? t1 : t2;
}

/**
 * Strictly resolves the tenant (companyId) that owns a physical ZKTeco device Serial Number (SN).
 * NEVER guesses or defaults to 'default'.
 * Checks registered devices in `zkteco_devices` and company-level `settings.zkteco.deviceSerial`.
 */
export async function resolveDeviceTenant(firestoreDb, rawSn) {
  const cleanSn = String(rawSn || '').trim();
  if (!cleanSn) {
    return { valid: false, error: 'Missing device Serial Number (SN)' };
  }

  const cleanSnLower = cleanSn.toLowerCase();
  const matchedTenants = new Set();
  let matchedDeviceName = 'ZKTeco Terminal';
  let matchedBranch = 'Main Head Office (Dhaka)';
  let matchedBranchId = 'BR-001';

  try {
    const devSnap = await getDocs(collection(firestoreDb, 'zkteco_devices'));
    devSnap.forEach(d => {
      const data = d.data();
      if (data.enabled === false) return;
      const sn1 = String(data.serialNumber || '').trim().toLowerCase();
      const sn2 = String(data.serial || '').trim().toLowerCase();
      if ((sn1 && sn1 === cleanSnLower) || (sn2 && sn2 === cleanSnLower)) {
        if (data.companyId) {
          matchedTenants.add(String(data.companyId).trim());
          if (data.name) matchedDeviceName = data.name;
          if (data.branch) matchedBranch = data.branch;
          if (data.branchId) matchedBranchId = data.branchId;
        }
      }
    });
  } catch (err) {
    console.error('[ZKTeco ADMS] Error reading zkteco_devices:', err?.message);
  }

  if (matchedTenants.size === 0) {
    try {
      const compSnap = await getDocs(collection(firestoreDb, 'companies'));
      compSnap.forEach(c => {
        const cData = c.data();
        if (cData.status === 'suspended' || cData.subscription?.status === 'suspended') return;
        const compSn = String(cData.settings?.zkteco?.deviceSerial || '').trim().toLowerCase();
        if (compSn && compSn === cleanSnLower) {
          matchedTenants.add(c.id);
          if (cData.settings?.zkteco?.deviceName) {
            matchedDeviceName = cData.settings.zkteco.deviceName;
          }
        }
      });
    } catch (err) {
      console.error('[ZKTeco ADMS] Error reading companies for device SN:', err?.message);
    }
  }

  if (matchedTenants.size === 0) {
    return {
      valid: false,
      error: `Device SN '${cleanSn}' is not registered to any active tenant in zkteco_devices.`
    };
  }

  if (matchedTenants.size > 1) {
    return {
      valid: false,
      error: `Device SN '${cleanSn}' has conflicting registrations across multiple tenants.`
    };
  }

  const companyId = Array.from(matchedTenants)[0];
  return {
    valid: true,
    companyId,
    deviceName: matchedDeviceName,
    branch: matchedBranch,
    branchId: matchedBranchId,
    serialNumber: cleanSn
  };
}

/**
 * Netlify Function Handler - ZKTeco ADMS Webhook & Server Auth Endpoint
 */
export const handler = async (event) => {
  try {
    const method = event.httpMethod || 'GET';
    const path = event.path || '';
    const rawUrl = event.rawUrl || '';

    // Route server-side authentication requests (/iclock/auth)
    if (path.endsWith('/auth') || path.includes('/iclock/auth') || rawUrl.includes('/auth')) {
      return await handleAuthRequest(event);
    }

    const queryParams = event.queryStringParameters || {};
    const rawSn = String(queryParams.SN || queryParams.sn || queryParams.DeviceSN || '').trim();

    console.log(`[ZKTeco ADMS] ${method} ${path} - Device SN: ${rawSn || 'NONE'}`);

    // 1. Device Handshake / Heartbeat (GET request)
    if (method === 'GET') {
      if (path.includes('getrequest')) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          },
          body: 'OK\n'
        };
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Server': 'WorkNest-ZKTeco-ADMS',
          'Access-Control-Allow-Origin': '*'
        },
        body: `GET OPTION FROM: ${rawSn || 'UNKNOWN'}\nStamp=0\nOpStamp=0\nPhotoStamp=0\nErrorDelay=3600\nDelay=3600\nTransInterval=720\nTransFlag=1111000000\nTimeZone=6\nRealtime=1\nEncrypt=0\n`
      };
    }

    // 2. Attendance Punch Log (POST request)
    if (method === 'POST') {
      let rawBody = event.body || '';
      if (event.isBase64Encoded) {
        try {
          rawBody = Buffer.from(rawBody, 'base64').toString('utf-8');
        } catch (e) {
          console.warn('[ZKTeco ADMS] Base64 decode failed, using raw body');
        }
      }

      // If Netlify redirected /iclock/auth to /.netlify/functions/iclock without preserving path, detect JSON auth payload
      if (rawBody.trim().startsWith('{')) {
        try {
          const maybeJson = JSON.parse(rawBody);
          if (maybeJson && (maybeJson.action === 'admin_login' || maybeJson.action === 'employee_login')) {
            return await handleAuthRequest(event);
          }
        } catch {}
      }

      const lines = rawBody.split(/\r?\n/).filter(line => line.trim().length > 0);
      const parsedLines = lines.map(l => parseAttlogLine(l)).filter(Boolean);

      // If payload contains no valid ATTLOG lines (e.g. malformed garbage or status ping),
      // safely acknowledge without touching Firestore.
      if (parsedLines.length === 0) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Server': 'WorkNest-ZKTeco-ADMS',
            'Access-Control-Allow-Origin': '*'
          },
          body: `OK: ${lines.length || 1}\n`
        };
      }

      // Authenticate server connection before querying/writing Firestore
      const { db: firestoreDb } = await ensureServerAuthenticated();

      // Strictly resolve which tenant owns this physical device SN (NEVER guess 'default')
      const tenantResolution = await resolveDeviceTenant(firestoreDb, rawSn);
      if (!tenantResolution.valid || !tenantResolution.companyId) {
        console.warn(`[ZKTeco ADMS] DENIED punch ingestion: ${tenantResolution.error}`);
        return {
          statusCode: 403,
          headers: {
            'Content-Type': 'text/plain',
            'Server': 'WorkNest-ZKTeco-ADMS',
            'Access-Control-Allow-Origin': '*'
          },
          body: `ERROR: ${tenantResolution.error}\n`
        };
      }

      const resolvedCompanyId = tenantResolution.companyId;
      const resolvedDeviceName = tenantResolution.deviceName;
      const resolvedDeviceBranch = tenantResolution.branch || 'Main Head Office (Dhaka)';
      const resolvedDeviceBranchId = tenantResolution.branchId || 'BR-001';
      let syncedRecordsCount = 0;

      try {
        // Load ONLY employees belonging to resolvedCompanyId
        const employeesMap = new Map();
        try {
          const empQuery = resolvedCompanyId !== 'default'
            ? query(collection(firestoreDb, 'employees'), where('companyId', '==', resolvedCompanyId))
            : collection(firestoreDb, 'employees');
          const empSnap = await getDocs(empQuery);
          empSnap.forEach(d => {
            const data = d.data();
            const empComp = data.companyId || 'default';
            const belongs = resolvedCompanyId !== 'default'
              ? empComp === resolvedCompanyId
              : (!data.companyId || empComp === 'default');
            if (!belongs) return;

            const emp = { id: d.id, ...data, companyId: empComp };
            if (emp.employeeId) employeesMap.set(String(emp.employeeId).trim().toLowerCase(), emp);
            if (emp.id) employeesMap.set(String(emp.id).trim().toLowerCase(), emp);
            if (emp.rfidCard) employeesMap.set(String(emp.rfidCard).trim().toLowerCase(), emp);
          });
        } catch (err) {
          console.error('[ZKTeco ADMS] Failed to fetch tenant employees:', err.message);
        }

        // Load ONLY shifts belonging to resolvedCompanyId
        const shiftsMap = new Map();
        try {
          const shiftQuery = resolvedCompanyId !== 'default'
            ? query(collection(firestoreDb, 'shifts'), where('companyId', '==', resolvedCompanyId))
            : collection(firestoreDb, 'shifts');
          const shiftSnap = await getDocs(shiftQuery);
          shiftSnap.forEach(sDoc => {
            const s = sDoc.data();
            const sComp = s.companyId || 'default';
            const belongs = resolvedCompanyId !== 'default'
              ? sComp === resolvedCompanyId
              : (!s.companyId || sComp === 'default');
            if (!belongs) return;

            const docIdLower = String(sDoc.id || '').trim().toLowerCase();
            if (docIdLower) shiftsMap.set(docIdLower, s);
            if (s.id) shiftsMap.set(String(s.id).trim().toLowerCase(), s);
            if (s.name) {
              shiftsMap.set(String(s.name).trim().toLowerCase(), s);
              shiftsMap.set(String(s.name).toLowerCase().replace(/[^a-z0-9]/g, ''), s);
            }
          });
        } catch (e) {
          console.warn('[ZKTeco ADMS] Failed to fetch tenant shifts:', e.message);
        }

        // STEP 1: In-Memory Filtering (Current Month Only & Strict Tenant Employee Ownership)
        const groupedBatch = new Map();
        const rawPunchEvents = [];

        for (const parsed of parsedLines) {
          const { pin, rawTime, verifyType } = parsed;
          const { dateStr, timeStr } = parseBangladeshTimestamp(rawTime);

          // Current Month Check: Reject older or future month punches before any Firebase operation
          if (!isCurrentMonth(dateStr)) {
            continue;
          }

          // Strict Tenant Employee Validation:
          // A device belonging to Tenant A must NEVER write attendance for an employee in Tenant B or default.
          const employee = employeesMap.get(String(pin).trim().toLowerCase());
          if (!employee) {
            console.warn(`[ZKTeco ADMS] Denied punch for PIN '${pin}' on device '${rawSn}': employee does not belong to tenant '${resolvedCompanyId}'.`);
            continue;
          }

          const empId = String(employee.employeeId || employee.id).trim();
          const attendanceDocId = resolvedCompanyId !== 'default'
            ? `${resolvedCompanyId}_${empId}_${dateStr}`
            : `${empId}_${dateStr}`;
          const verifyMode = mapVerifyMode(verifyType);

          rawPunchEvents.push({
            empId,
            employee,
            dateStr,
            timeStr,
            rawTime,
            verifyMode
          });

          if (!groupedBatch.has(attendanceDocId)) {
            groupedBatch.set(attendanceDocId, {
              attendanceDocId,
              companyId: resolvedCompanyId,
              employeeId: empId,
              employee,
              dateStr,
              minPunch: timeStr,
              maxPunch: timeStr,
              punchesCount: 1,
              verifyMode,
              deviceId: rawSn
            });
          } else {
            const entry = groupedBatch.get(attendanceDocId);
            entry.minPunch = minTime(entry.minPunch, timeStr);
            entry.maxPunch = maxTime(entry.maxPunch, timeStr);
            entry.punchesCount += 1;
          }
        }

        // Write tenant-scoped raw punches with deterministic duplicate-safe IDs
        for (const ev of rawPunchEvents) {
          try {
            const rawDigits = ev.rawTime.replace(/[^0-9]/g, '');
            const punchDocId = resolvedCompanyId !== 'default'
              ? `zk_${resolvedCompanyId}_${rawSn}_${ev.empId}_${rawDigits}`
              : `zk_${rawSn}_${ev.empId}_${rawDigits}`;

            await setDoc(doc(firestoreDb, 'punches', punchDocId), sanitizeData({
              id: punchDocId,
              companyId: resolvedCompanyId,
              employeeId: ev.empId,
              employeeCode: ev.empId,
              employeeName: ev.employee.name || 'Staff Member',
              department: ev.employee.department || 'General',
              branch: ev.employee.branch || resolvedDeviceBranch,
              branchId: ev.employee.branchId || resolvedDeviceBranchId,
              date: ev.dateStr,
              time: ev.timeStr,
              punchTime: ev.timeStr,
              timestamp: `${ev.dateStr}T${ev.timeStr}:00`,
              punchTimestamp: `${ev.dateStr}T${ev.timeStr}:00`,
              deviceSerialNumber: rawSn,
              deviceName: resolvedDeviceName,
              verifyMode: ev.verifyMode,
              source: 'zkteco_biometric',
              createdAt: new Date().toISOString()
            }), { merge: true });
          } catch (pErr) {
            console.warn('[ZKTeco ADMS] Raw punch write warning:', pErr?.message);
          }
        }

        // STEP 2: Upsert EXACTLY ONE tenant-scoped Firebase attendance record per Employee ID + Date
        for (const [attendanceDocId, entry] of groupedBatch.entries()) {
          const attendanceDocRef = doc(firestoreDb, 'attendance', attendanceDocId);
          let existingRecord = null;

          try {
            const existingSnap = await getDoc(attendanceDocRef);
            if (existingSnap.exists()) {
              const exData = existingSnap.data();
              const exComp = exData.companyId || 'default';
              if (exComp !== resolvedCompanyId) {
                console.error(`[ZKTeco ADMS] Cross-tenant collision blocked on ${attendanceDocId}`);
                continue;
              }
              existingRecord = exData;
            }
          } catch (readErr) {
            console.warn(`[ZKTeco ADMS] Existing record read error for ${attendanceDocId}:`, readErr.message);
          }

          let finalFirstPunch = entry.minPunch;
          let finalLastPunch = entry.maxPunch;

          if (existingRecord) {
            const existingFirst = existingRecord.firstPunchIn || existingRecord.firstPunch || existingRecord.checkIn;
            const existingLast = existingRecord.lastPunchOut || existingRecord.lastPunch || existingRecord.checkOut;

            finalFirstPunch = minTime(existingFirst, entry.minPunch);
            finalLastPunch = maxTime(existingLast, entry.maxPunch);
          }

          const employee = entry.employee;
          let histEntry = null;
          if (employee && Array.isArray(employee.shiftHistory) && employee.shiftHistory.length > 0 && entry.dateStr) {
            const sortedHist = [...employee.shiftHistory]
              .filter(h => h && h.shiftName && h.effectiveFrom)
              .sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));
            histEntry = sortedHist.find(
              h => entry.dateStr >= h.effectiveFrom && (!h.effectiveTo || entry.dateStr <= h.effectiveTo)
            ) || (entry.dateStr < sortedHist[0].effectiveFrom ? sortedHist[0] : null);
          }

          let shiftName = histEntry?.shiftName || employee?.shift || existingRecord?.shiftName || 'Day Shift';
          let shiftStartTime = '09:00';
          let shiftEndTime = '18:00';
          let shiftGraceMinutes = 15;
          let otThresholdMinutes = 30;
          let overtimePolicyEnabled = true;
          let maxOvertimeHours = 0;

          const normShiftKey = String(shiftName || '').trim().toLowerCase();
          const compactShiftKey = normShiftKey.replace(/[^a-z0-9]/g, '');
          const normEmpShiftKey = String(employee?.shift || '').trim().toLowerCase();
          const matchedShift =
            shiftsMap.get(normShiftKey) ||
            shiftsMap.get(compactShiftKey) ||
            shiftsMap.get(normEmpShiftKey);
          if (matchedShift) {
            shiftName = matchedShift.name || shiftName;
            shiftStartTime = matchedShift.startTime || shiftStartTime;
            shiftEndTime = matchedShift.endTime || shiftEndTime;
            if (matchedShift.graceTime !== undefined) shiftGraceMinutes = Number(matchedShift.graceTime);
            if (matchedShift.minOvertimeMinutes !== undefined) otThresholdMinutes = Number(matchedShift.minOvertimeMinutes);
            else if (matchedShift.otThreshold !== undefined) otThresholdMinutes = Number(matchedShift.otThreshold);
            if (matchedShift.overtimePolicyEnabled === false || matchedShift.overtimePolicyEnabled === 'false' || matchedShift.overtimePolicyEnabled === 0) {
              overtimePolicyEnabled = false;
            }
            if (matchedShift.maxOvertimeHours !== undefined) {
              maxOvertimeHours = Number(matchedShift.maxOvertimeHours) || 0;
            }
          }
          // If historical period is closed and has a timing snapshot, preserve that snapshot
          if (histEntry && histEntry.effectiveTo && histEntry.startTime && histEntry.endTime) {
            shiftStartTime = histEntry.startTime;
            shiftEndTime = histEntry.endTime;
            if (histEntry.graceTime !== undefined) shiftGraceMinutes = Number(histEntry.graceTime);
          }

          // Approved leave check strictly scoped to resolvedCompanyId
          let isOnLeave = false;
          try {
            const leaveQ = resolvedCompanyId !== 'default'
              ? query(
                  collection(firestoreDb, 'leaveRequests'),
                  where('companyId', '==', resolvedCompanyId),
                  where('employeeId', '==', entry.employeeId),
                  where('status', '==', 'approved'),
                  limit(10)
                )
              : query(
                  collection(firestoreDb, 'leaveRequests'),
                  where('employeeId', '==', entry.employeeId),
                  where('status', '==', 'approved'),
                  limit(10)
                );
            const lSnap = await getDocs(leaveQ);
            lSnap.forEach(ld => {
              const lData = ld.data();
              const lComp = lData.companyId || 'default';
              if (lComp === resolvedCompanyId && lData.from <= entry.dateStr && lData.to >= entry.dateStr) {
                isOnLeave = true;
              }
            });
          } catch {}

          const [startH, startM] = shiftStartTime.split(':').map(Number);
          const shiftStartTotalMinutes = (startH || 9) * 60 + (startM || 0);

          const [endH, endM] = shiftEndTime.split(':').map(Number);
          const shiftEndTotalMinutes = (endH || 18) * 60 + (endM || 0);

          const [inH, inM] = finalFirstPunch !== '-' ? finalFirstPunch.split(':').map(Number) : [startH, startM];
          const checkInMinutes = (inH || 0) * 60 + (inM || 0);
          const graceAllowedMinutes = shiftStartTotalMinutes + shiftGraceMinutes;

          let isLate = false;
          let lateMinutes = 0;
          let status = 'present';

          if (isOnLeave) {
            status = 'leave';
          } else if (checkInMinutes > graceAllowedMinutes) {
            isLate = true;
            lateMinutes = checkInMinutes - shiftStartTotalMinutes;
            status = 'late';
          } else {
            status = 'present';
          }

          const hasDistinctOut = finalFirstPunch !== finalLastPunch;
          const checkOutTime = hasDistinctOut
            ? finalLastPunch
            : (existingRecord?.checkOut && existingRecord.checkOut !== '-' ? existingRecord.checkOut : '-');

          let isEarlyLeave = false;
          let earlyLeaveMinutes = 0;
          if (checkOutTime !== '-') {
            const [outH, outM] = checkOutTime.split(':').map(Number);
            const checkOutMinutes = (outH || 0) * 60 + (outM || 0);
            if (checkOutMinutes < shiftEndTotalMinutes) {
              isEarlyLeave = true;
              earlyLeaveMinutes = shiftEndTotalMinutes - checkOutMinutes;
            }
          }

          let otHours = 0;
          let totalHours = 0;
          if (finalFirstPunch !== '-' && checkOutTime !== '-') {
            const [outH, outM] = checkOutTime.split(':').map(Number);
            let checkOutMinutes = (outH || 0) * 60 + (outM || 0);
            if (checkOutMinutes <= checkInMinutes && (shiftEndTime === '00:00' || shiftEndTotalMinutes <= shiftStartTotalMinutes || checkInMinutes >= 10 * 60)) {
              checkOutMinutes += 24 * 60;
            }
            const totalWorkedMinutes = Math.max(0, checkOutMinutes - checkInMinutes);
            totalHours = Math.round((totalWorkedMinutes / 60) * 10) / 10;
            const effEndMins = shiftEndTime === '00:00' ? 24 * 60 : (shiftEndTotalMinutes <= shiftStartTotalMinutes ? shiftEndTotalMinutes + 24 * 60 : shiftEndTotalMinutes);
            const standardShiftMinutes = Math.max(600, effEndMins - shiftStartTotalMinutes);

            if (overtimePolicyEnabled && totalWorkedMinutes > standardShiftMinutes) {
              const excessMinutes = totalWorkedMinutes - standardShiftMinutes;
              if (excessMinutes >= otThresholdMinutes) {
                otHours = Math.round((excessMinutes / 60) * 10) / 10;
                if (maxOvertimeHours > 0 && otHours > maxOvertimeHours) {
                  otHours = maxOvertimeHours;
                }
              }
            }
          }

          const totalPunchesCount = (existingRecord?.totalPunches || 0) + entry.punchesCount;

          if (
            existingRecord &&
            existingRecord.companyId === resolvedCompanyId &&
            existingRecord.firstPunchIn === finalFirstPunch &&
            existingRecord.lastPunchOut === finalLastPunch &&
            existingRecord.checkIn === finalFirstPunch &&
            existingRecord.checkOut === checkOutTime &&
            existingRecord.status === status
          ) {
            continue;
          }

          const attendanceRecord = sanitizeData({
            id: attendanceDocId,
            companyId: resolvedCompanyId,
            employeeId: entry.employeeId,
            employeeCode: entry.employeeId,
            employeeName: employee?.name || existingRecord?.employeeName || 'Staff Member',
            department: employee?.department || existingRecord?.department || 'General',
            designation: employee?.designation || existingRecord?.designation || 'Staff',
            branch: employee?.branch || existingRecord?.branch || resolvedDeviceBranch,
            branchId: employee?.branchId || existingRecord?.branchId || resolvedDeviceBranchId,
            date: entry.dateStr,
            firstPunchIn: finalFirstPunch,
            lastPunchOut: finalLastPunch,
            checkIn: finalFirstPunch,
            checkOut: checkOutTime,
            firstPunch: finalFirstPunch,
            lastPunch: finalLastPunch,
            status,
            isLate,
            lateMinutes,
            isEarlyLeave,
            earlyLeaveMinutes,
            otHours,
            totalHours,
            workHours: totalHours,
            shiftName,
            shiftStartTime,
            shiftEndTime,
            source: 'zkteco',
            totalPunches: totalPunchesCount,
            deviceId: entry.deviceId,
            lastUpdated: new Date().toISOString()
          });

          await setDoc(attendanceDocRef, attendanceRecord, { merge: true });
          syncedRecordsCount++;
        }
      } catch (err) {
        console.error('[ZKTeco ADMS] Processing error:', err);
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Server': 'WorkNest-ZKTeco-ADMS',
          'Access-Control-Allow-Origin': '*'
        },
        body: `OK: ${syncedRecordsCount}\n`
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      },
      body: 'OK\n'
    };
  } catch (globalErr) {
    console.error('[ZKTeco ADMS] Fatal handler error caught:', globalErr);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      },
      body: 'OK\n'
    };
  }
};

export default {
  handler,
  mapVerifyMode,
  parseBangladeshTimestamp,
  parseAttlogLine,
  getCurrentMonthRange,
  isCurrentMonth,
  minTime,
  maxTime,
  getDb,
  ensureServerAuthenticated,
  resolveDeviceTenant
};
