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

  const clean = rawTimeStr.trim().replace(/\//g, '-');
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

  // Normalize date format (handle YYYY-MM-DD vs DD-MM-YYYY)
  const dParts = dateStr.split('-');
  if (dParts.length === 3) {
    if (dParts[0].length === 4) {
      dateStr = `${dParts[0]}-${dParts[1].padStart(2, '0')}-${dParts[2].padStart(2, '0')}`;
    } else if (dParts[2].length === 4) {
      dateStr = `${dParts[2]}-${dParts[1].padStart(2, '0')}-${dParts[0].padStart(2, '0')}`;
    }
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
 * Handles tabs, multiple spaces, commas, separate Date and Time columns, and slash/hyphen dates.
 */
export function parseAttlogLine(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('table=') ||
    lower.startsWith('cmd=') ||
    lower.startsWith('stamp=') ||
    lower.startsWith('user=') ||
    lower.startsWith('oplog') ||
    lower.includes('oplog') ||
    lower.includes('table=oplog')
  ) {
    return null;
  }

  let parts = trimmed.split(/[\t,]+/);
  if (parts.length === 1) {
    parts = trimmed.split(/\s{2,}|\t/);
  }
  if (parts.length === 1) {
    parts = trimmed.split(/\s+/);
  }

  parts = parts.map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const pin = parts[0];

  let rawDate = '';
  let rawTimeOnly = '';
  let status = '0';
  let verifyType = '1';

  // Case 1: parts[1] contains both date and time (e.g. "2026-10-29 16:30:00")
  if (parts[1].includes(' ') || parts[1].includes('T')) {
    const sub = parts[1].split(/[ T]/);
    rawDate = sub[0];
    rawTimeOnly = sub[1];
    status = parts[2] || '0';
    verifyType = parts[3] || '1';
  } else if (parts.length >= 3 && (parts[1].includes('-') || parts[1].includes('/')) && parts[2].includes(':')) {
    // Case 2: parts[1] is Date and parts[2] is Time (ZKTeco uFace800 ATTLOG standard format)
    rawDate = parts[1];
    rawTimeOnly = parts[2];
    status = parts[3] || '0';
    verifyType = parts[4] || '1';
  } else {
    // Scan all parts for date and time
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (!rawDate && (p.includes('-') || p.includes('/')) && /\d{2}/.test(p)) {
        if (p.includes(' ') || p.includes('T')) {
          const sub = p.split(/[ T]/);
          rawDate = sub[0];
          rawTimeOnly = sub[1];
        } else {
          rawDate = p;
        }
      } else if (!rawTimeOnly && p.includes(':') && /\d{2}:\d{2}/.test(p)) {
        rawTimeOnly = p;
      } else if (i === parts.length - 1 || i === parts.length - 2) {
        if (!verifyType || verifyType === '1') {
          verifyType = p;
        }
      }
    }
  }

  if (!pin || !rawDate || pin.toLowerCase().includes('oplog')) return null;
  if (!rawTimeOnly) rawTimeOnly = '00:00:00';

  // Normalize date format to YYYY-MM-DD
  const normalizedDate = rawDate.replace(/\//g, '-');
  const dParts = normalizedDate.split('-');
  let cleanDateStr = normalizedDate;
  if (dParts.length === 3) {
    if (dParts[0].length === 4) {
      cleanDateStr = `${dParts[0]}-${dParts[1].padStart(2, '0')}-${dParts[2].padStart(2, '0')}`;
    } else if (dParts[2].length === 4) {
      cleanDateStr = `${dParts[2]}-${dParts[1].padStart(2, '0')}-${dParts[0].padStart(2, '0')}`;
    }
  }

  const rawTime = `${cleanDateStr} ${rawTimeOnly}`;
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
 * Resolves the tenant (companyId) that owns a physical ZKTeco device Serial Number (SN).
 * Checks registered devices in `zkteco_devices` (by serial field, serialNumber, or docId containing SN)
 * and company-level `settings.zkteco.deviceSerial`.
 */
export async function resolveDeviceTenant(firestoreDb, rawSn) {
  const cleanSn = String(rawSn || '').trim();
  if (!cleanSn) {
    return { valid: true, companyId: null, isPendingDevice: true, serialNumber: '' };
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
      const docId = String(d.id || '').trim().toLowerCase();

      // Check serial fields OR docId containing the SN (e.g. dev_comp_waqif_metal_ind_mvrp6k3j_RKQ4253700372)
      if ((sn1 && sn1 === cleanSnLower) || (sn2 && sn2 === cleanSnLower) || (docId && docId.includes(cleanSnLower))) {
        let comp = data.companyId;
        if (!comp || comp === 'default') {
          if (d.id.startsWith('dev_comp_')) {
            const withoutDev = d.id.slice(4);
            const lastUnd = withoutDev.lastIndexOf('_');
            if (lastUnd > 0) {
              comp = withoutDev.slice(0, lastUnd);
            }
          }
        }
        if (comp) {
          matchedTenants.add(String(comp).trim());
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

  // Load currently existing companies from companies collection to ensure deleted companies are never selected
  const activeCompanyIds = new Set(['default']);
  try {
    const compSnap = await getDocs(collection(firestoreDb, 'companies'));
    compSnap.forEach(c => {
      const cData = c.data();
      if (cData.status !== 'suspended' && cData.subscription?.status !== 'suspended') {
        activeCompanyIds.add(c.id);
      }
    });
  } catch (err) {
    console.error('[ZKTeco ADMS] Error loading active companies:', err?.message);
  }

  // Filter matched tenants to ONLY active, existing companies
  let companyId = null;
  const validMatchedTenants = Array.from(matchedTenants).filter(t => activeCompanyIds.has(t));
  if (validMatchedTenants.length > 0) {
    const nonDefault = validMatchedTenants.filter(t => t !== 'default');
    companyId = nonDefault.length > 0 ? nonDefault[0] : validMatchedTenants[0];
  } else if (matchedTenants.size > 0) {
    const nonDefault = Array.from(matchedTenants).filter(t => t !== 'default');
    companyId = nonDefault.length > 0 ? nonDefault[0] : Array.from(matchedTenants)[0];
  }

  return {
    valid: true,
    companyId,
    isPendingDevice: !companyId,
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
    let rawSn = String(queryParams.SN || queryParams.sn || queryParams.DeviceSN || '').trim();

    // Check headers for SN
    if (!rawSn && event.headers) {
      rawSn = String(
        event.headers['sn'] ||
        event.headers['SN'] ||
        event.headers['device-sn'] ||
        event.headers['Device-SN'] ||
        event.headers['x-device-sn'] ||
        ''
      ).trim();
    }

    // Check rawUrl for SN if Netlify query parsing dropped casing
    if (!rawSn && rawUrl) {
      const matchSn = rawUrl.match(/[?&](?:SN|sn|DeviceSN)=([^&]+)/i);
      if (matchSn) {
        rawSn = decodeURIComponent(matchSn[1]).trim();
      }
    }

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

      // Check if SN is sent in POST body
      if (!rawSn && rawBody) {
        const bodySnMatch = rawBody.match(/(?:^|\n|\r|&)(?:SN|sn)=([^\r\n&]+)/);
        if (bodySnMatch) {
          rawSn = bodySnMatch[1].trim();
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

      // Check if table is OPLOG (Operator Log) - safely acknowledge without recording as employee punch
      const rawTable = String(queryParams.table || queryParams.tablename || '').toUpperCase();
      if (rawTable === 'OPLOG' || rawBody.toUpperCase().includes('TABLE=OPLOG')) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Server': 'WorkNest-ZKTeco-ADMS',
            'Access-Control-Allow-Origin': '*'
          },
          body: `OK: 1\n`
        };
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

      // Resolve which tenant owns this physical device SN
      const tenantResolution = await resolveDeviceTenant(firestoreDb, rawSn);
      if (!tenantResolution.valid) {
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

      let syncedRecordsCount = 0;

      try {
        // Load all employees across tenants into a fast lookup map
        const allEmployeesMap = new Map();
        const allEmployeesList = [];
        try {
          const empSnap = await getDocs(collection(firestoreDb, 'employees'));
          empSnap.forEach(d => {
            const data = d.data();
            let empComp = data.companyId;
            // If companyId is missing or default, extract from doc ID if structured as comp_<tenant>_<empId>
            if (!empComp || empComp === 'default') {
              if (d.id.startsWith('comp_')) {
                const lastUnd = d.id.lastIndexOf('_');
                if (lastUnd > 0) {
                  empComp = d.id.slice(0, lastUnd);
                }
              }
            }
            if (!empComp) empComp = 'default';
            const emp = { id: d.id, ...data, companyId: empComp };
            allEmployeesList.push(emp);

            const keys = [
              emp.employeeId,
              emp.employeeCode,
              emp.id,
              emp.rfidCard,
              emp.biometricPin,
              emp.pin
            ];
            for (const k of keys) {
              if (k !== undefined && k !== null) {
                const strK = String(k).trim().toLowerCase();
                if (strK) {
                  // Index under tenant
                  allEmployeesMap.set(`${empComp}_${strK}`, emp);
                  // Index globally if non-default or unassigned
                  if (!allEmployeesMap.has(strK) || empComp !== 'default') {
                    allEmployeesMap.set(strK, emp);
                  }
                  // Digits-only version
                  const digits = strK.replace(/\D/g, '');
                  if (digits && digits !== strK) {
                    allEmployeesMap.set(`${empComp}_${digits}`, emp);
                    if (!allEmployeesMap.has(digits) || empComp !== 'default') {
                      allEmployeesMap.set(digits, emp);
                    }
                  }
                  // Leading zero stripped version
                  const noZero = strK.replace(/^0+/, '');
                  if (noZero && noZero !== strK) {
                    allEmployeesMap.set(`${empComp}_${noZero}`, emp);
                    if (!allEmployeesMap.has(noZero) || empComp !== 'default') {
                      allEmployeesMap.set(noZero, emp);
                    }
                  }
                }
              }
            }
          });
        } catch (err) {
          console.error('[ZKTeco ADMS] Failed to fetch employees:', err.message);
        }

        // Load all shifts across tenants
        const shiftsMap = new Map();
        try {
          const shiftSnap = await getDocs(collection(firestoreDb, 'shifts'));
          shiftSnap.forEach(sDoc => {
            const s = sDoc.data();
            const sComp = s.companyId || 'default';
            const docIdLower = String(sDoc.id || '').trim().toLowerCase();
            if (docIdLower) shiftsMap.set(`${sComp}_${docIdLower}`, s);
            if (s.id) shiftsMap.set(`${sComp}_${String(s.id).trim().toLowerCase()}`, s);
            if (s.name) {
              shiftsMap.set(`${sComp}_${String(s.name).trim().toLowerCase()}`, s);
              shiftsMap.set(`${sComp}_${String(s.name).toLowerCase().replace(/[^a-z0-9]/g, '')}`, s);
              shiftsMap.set(String(s.name).trim().toLowerCase(), s);
              shiftsMap.set(String(s.name).toLowerCase().replace(/[^a-z0-9]/g, ''), s);
            }
          });
        } catch (e) {
          console.warn('[ZKTeco ADMS] Failed to fetch shifts:', e.message);
        }

        // STEP 1: Process every punch, write raw punch to Firestore 'punches', and group for attendance
        const groupedBatch = new Map();

        for (const parsed of parsedLines) {
          const { pin, rawTime, verifyType } = parsed;
          const cleanPin = String(pin || '').trim().toLowerCase();
          if (cleanPin.includes('oplog')) continue;

          const { dateStr, timeStr } = parseBangladeshTimestamp(rawTime);
          const cleanPinDigits = cleanPin.replace(/\D/g, '');
          const cleanPinNoZero = cleanPin.replace(/^0+/, '');

          // Match employee across tenant boundaries using their PIN / employee ID
          let employee = null;
          const devComp = tenantResolution.companyId;
          if (devComp && devComp !== 'default') {
            employee = allEmployeesMap.get(`${devComp}_${cleanPin}`) ||
                       (cleanPinNoZero ? allEmployeesMap.get(`${devComp}_${cleanPinNoZero}`) : null) ||
                       (cleanPinDigits ? allEmployeesMap.get(`${devComp}_${cleanPinDigits}`) : null);
          }
          if (!employee) {
            employee = allEmployeesMap.get(cleanPin) ||
                       (cleanPinNoZero ? allEmployeesMap.get(cleanPinNoZero) : null) ||
                       (cleanPinDigits ? allEmployeesMap.get(cleanPinDigits) : null);
          }
          if (!employee && devComp) {
            employee = allEmployeesList.find(e => {
              if (e.companyId !== devComp) return false;
              const eId = String(e.employeeId || '').trim().toLowerCase();
              const eCode = String(e.employeeCode || '').trim().toLowerCase();
              const eDocId = String(e.id || '').trim().toLowerCase();
              return eId === cleanPin || eCode === cleanPin || eDocId === cleanPin || eDocId.endsWith(`_${cleanPin}`) ||
                     (cleanPinDigits && (eId.replace(/\D/g, '') === cleanPinDigits || eDocId.replace(/\D/g, '') === cleanPinDigits));
            });
          }
          if (!employee) {
            employee = allEmployeesList.find(e => {
              const eId = String(e.employeeId || '').trim().toLowerCase();
              const eCode = String(e.employeeCode || '').trim().toLowerCase();
              const eDocId = String(e.id || '').trim().toLowerCase();
              return eId === cleanPin || eCode === cleanPin || eDocId === cleanPin || eDocId.endsWith(`_${cleanPin}`) ||
                     (cleanPinDigits && (eId.replace(/\D/g, '') === cleanPinDigits || eDocId.replace(/\D/g, '') === cleanPinDigits));
            });
          }

          // Resolve tenant: employee's own companyId takes precedence, then device's tenant, then 'default'
          const punchCompanyId = (employee?.companyId && employee.companyId !== 'default')
            ? employee.companyId
            : (tenantResolution.companyId && tenantResolution.companyId !== 'default'
                ? tenantResolution.companyId
                : (employee?.companyId || 'default'));

          const empId = employee ? String(employee.employeeId || employee.id).trim() : String(pin).trim();
          const verifyMode = mapVerifyMode(verifyType);
          const rawDigits = rawTime.replace(/[^0-9]/g, '');

          const resolvedDeviceName = tenantResolution.deviceName || 'ZKTeco Terminal';
          const resolvedDeviceBranch = employee?.branch || tenantResolution.branch || 'Main Head Office (Dhaka)';
          const resolvedDeviceBranchId = employee?.branchId || tenantResolution.branchId || 'BR-001';

          // 1. ALWAYS write raw punch event to Firestore 'punches' collection so no biometric punch is ever lost
          const punchDocId = punchCompanyId !== 'default'
            ? `zk_${punchCompanyId}_${rawSn}_${empId}_${rawDigits}`
            : `zk_${rawSn}_${empId}_${rawDigits}`;

          try {
            await setDoc(doc(firestoreDb, 'punches', punchDocId), sanitizeData({
              id: punchDocId,
              companyId: punchCompanyId,
              employeeId: empId,
              employeeCode: empId,
              employeeName: employee?.name || `Biometric Staff (${empId})`,
              department: employee?.department || 'General',
              branch: resolvedDeviceBranch,
              branchId: resolvedDeviceBranchId,
              date: dateStr,
              time: timeStr,
              punchTime: timeStr,
              timestamp: `${dateStr}T${timeStr}:00`,
              punchTimestamp: `${dateStr}T${timeStr}:00`,
              deviceSerialNumber: rawSn,
              deviceName: resolvedDeviceName,
              verifyMode,
              source: 'zkteco_biometric',
              createdAt: new Date().toISOString()
            }), { merge: true });
          } catch (pErr) {
            console.warn('[ZKTeco ADMS] Raw punch write warning:', pErr?.message);
          }

          // Ensure employee doc has companyId populated if it was missing in the document
          if (employee && employee.id && employee.companyId && !employee.data?.companyId) {
            try {
              setDoc(doc(firestoreDb, 'employees', employee.id), { companyId: employee.companyId }, { merge: true }).catch(() => {});
            } catch {}
          }

          // Auto-register pending device to tenant's device list
          if (punchCompanyId && punchCompanyId !== 'default' && tenantResolution.isPendingDevice) {
            try {
              await setDoc(doc(firestoreDb, 'zkteco_devices', `dev_${rawSn}`), sanitizeData({
                id: `dev_${rawSn}`,
                serialNumber: rawSn,
                serial: rawSn,
                companyId: punchCompanyId,
                name: resolvedDeviceName,
                status: 'online',
                lastHeartbeat: new Date().toISOString(),
                lastSync: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                enabled: true
              }), { merge: true });
              tenantResolution.isPendingDevice = false;
              tenantResolution.companyId = punchCompanyId;
            } catch (dErr) {
              console.warn('[ZKTeco ADMS] Device auto-register warning:', dErr?.message);
            }
          }

          // 2. Group for daily attendance aggregation - accept ANY valid YYYY-MM-DD date format
          const isValidDate = Boolean(dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr));
          if (isValidDate) {
            const attendanceDocId = punchCompanyId !== 'default'
              ? `${punchCompanyId}_${empId}_${dateStr}`
              : `${empId}_${dateStr}`;

            if (!groupedBatch.has(attendanceDocId)) {
              groupedBatch.set(attendanceDocId, {
                attendanceDocId,
                companyId: punchCompanyId,
                employeeId: empId,
                employee,
                dateStr,
                minPunch: timeStr,
                maxPunch: timeStr,
                punchesCount: 1,
                verifyMode,
                deviceId: rawSn,
                branch: resolvedDeviceBranch,
                branchId: resolvedDeviceBranchId
              });
            } else {
              const entry = groupedBatch.get(attendanceDocId);
              entry.minPunch = minTime(entry.minPunch, timeStr);
              entry.maxPunch = maxTime(entry.maxPunch, timeStr);
              entry.punchesCount += 1;
            }
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
              if (exComp !== entry.companyId) {
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
          const sComp = entry.companyId;
          const matchedShift =
            shiftsMap.get(`${sComp}_${normShiftKey}`) ||
            shiftsMap.get(`${sComp}_${compactShiftKey}`) ||
            shiftsMap.get(`${sComp}_${normEmpShiftKey}`) ||
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

          // Approved leave check strictly scoped to entry.companyId
          let isOnLeave = false;
          try {
            const leaveQ = entry.companyId !== 'default'
              ? query(
                  collection(firestoreDb, 'leaveRequests'),
                  where('companyId', '==', entry.companyId),
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
              if (lComp === entry.companyId && lData.from <= entry.dateStr && lData.to >= entry.dateStr) {
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
            existingRecord.companyId === entry.companyId &&
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
            companyId: entry.companyId,
            employeeId: entry.employeeId,
            employeeCode: entry.employeeId,
            employeeName: employee?.name || existingRecord?.employeeName || 'Staff Member',
            department: employee?.department || existingRecord?.department || 'General',
            designation: employee?.designation || existingRecord?.designation || 'Staff',
            branch: employee?.branch || existingRecord?.branch || entry.branch,
            branchId: employee?.branchId || existingRecord?.branchId || entry.branchId,
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
