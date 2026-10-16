# WorkNest HR — Android Packaging: Audit, Plan & Verification

**Status:** implementation complete on `arena/bbda70e6-worknesthr-android`; APK built and inspected by GitHub Actions.
**Date:** 2026-10-16
**Branch:** `arena/bbda70e-worknesthr-android`

> **Previous revision of this document** reported a blocker because the repository contained
> only a 21-byte README. The source has since been uploaded (commits `60253c3`, `29aec60`)
> and the audit below is based on the real tree.

---

## 1. What was actually uploaded

There is **no ZIP** in the repository (verified with `git rev-list --objects --all | grep -i zip`
→ no matches). The project was uploaded as loose files across two commits:

| Commit | Author | Content |
|---|---|---|
| `60253c3` | Sayem Siraj | Full application source (79 files) |
| `29aec60` | Sayem Siraj | *(no diff — duplicates `60253c3`)* |

**Version reconciliation:** `git diff --name-status 60253c3 29aec60` is **empty**, so the two
upload commits carry identical content. `29aec60` (the tip of `main`) is therefore the
authoritative version — there was no competing or newer tree to reconcile, and nothing was
overwritten blindly.

### Confirmed present

| Item | Status |
|---|---|
| `package.json` (React 19 + Vite 8 + TypeScript 7) | ✅ |
| `bun.lock` (Bun lockfile, `lockfileVersion: 2`) | ✅ |
| Original logo — `Worknest Logo.png.png`, 1254×1254 RGBA PNG | ✅ |
| Firebase configuration — `src/lib/firestoreService.ts` (`worknest-hr-b1642`) | ✅ |
| `firestore.rules` (813 lines), `firebase-blueprint.json` | ✅ |
| ZKTeco ADMS server — `netlify/functions/iclock.js` (1335 lines) | ✅ |
| Existing Android files | ⚠️ **None existed** — this work adds them |

---

## 2. Phase 1 — Audit findings

### 2.1 Application shape

- **Framework:** React 19 SPA, Vite 8 (rolldown), Tailwind CSS 4, TypeScript 7.
- **Entry point:** `index.html` → `src/main.tsx` → `src/App.tsx`.
- **Package manager:** **Bun** (only `bun.lock` exists — no `package-lock.json`/`yarn.lock`).
- **Build:** `vite build` → `dist/`. **Lint/type-check:** `tsc --noEmit`. **No test suite exists.**
- **Routing:** none. Screens are React state (`Page` union in `App.tsx`), so there is no URL routing
  to preserve — important for Back-button design (§4.2).
- **Modules found (all preserved):** authentication (admin + employee portals), employees,
  departments, branches, shifts, roster/duty, attendance, leave, payroll, expenses, onboarding &
  offboarding, recruitment, documents, reports, AI report assistant, HR analytics, workforce
  planning, engagement, messaging, notifications, profile, account/company settings,
  enterprise security/RBAC/audit logs, ZKTeco biometrics, tenant & subscription management,
  super-admin tenant switching, billing.

### 2.2 Baseline health (before any change)

| Check | Result |
|---|---|
| Local import resolution across all 79 files | ✅ every import resolves |
| `tsc --noEmit` | ✅ 0 errors |
| `vite build` | ✅ 3.24 MB JS + 214 KB CSS, `dist/` produced |
| npm dependency upgrades | **none** — `bun install --frozen-lockfile` |
| Firebase project | `work-nest-hr-b1642` — **untouched** |
| Production data / security rules | **untouched** |

### 2.3 The application was already APK-aware

The original author had clearly designed for mobile packaging — this materially reduced the
required work, and per the brief nothing was redesigned:

- A **permanent mobile bottom navigation bar** already exists (`App.tsx`, `lg:hidden fixed bottom-0`,
  explicitly commented *"PERMANENTLY FIXED MOBILE/APK BOTTOM NAVIGATION BAR"*).
- It already uses `pb-[max(0.375rem,env(safe-area-inset-bottom))]`; the same pattern appears in
  `Sidebar.tsx` and twice in `EmployeePanel.tsx`.
- `index.html` already declares the mobile viewport, `viewport-fit=cover`, and theme colour.
- The main shell is already `h-screen h-[100dvh]` with an isolated scroll container.

---

## 3. Phase 2 — Android architecture decision

**Chosen: Capacitor 8.5.3**, packaging **the existing web build unchanged**. No Kotlin/Compose
rewrite, no second backend, no mock data.

- `webDir: 'dist'` → the interface ships **inside** the APK; the app never downloads its UI.
- `server.androidScheme: 'https'` → the WebView runs on `https://localhost`, a secure context, so
  Firebase Auth persistence (localStorage/IndexedDB) behaves exactly as in a browser.
- Only Firebase and the ADMS endpoints remain online, exactly as for the web build.
- **Plugins added (all official Capacitor):** `@capacitor/android`, `@capacitor/app`,
  `@capacitor/status-bar`, `@capacitor/keyboard`, `@capacitor/splash-screen`, plus `@capacitor/cli`
  as a devDependency.

**Dependency discipline:** `bun add` added **24 lines and removed 0** from `bun.lock`
(`git diff --numstat` → `18 0 bun.lock`, `6 0 package.json`). React, Vite, Firebase, Tailwind and
TypeScript versions are untouched.

> `@capacitor/assets` was evaluated for icon generation but its `sharp` binary could not be fetched
> in the build sandbox. Launcher icons were generated directly from the original PNG instead, so the
> dependency was **not** added to the project.

---

## 4. Phase 3–7 — What was implemented

### 4.1 Branding (all derived from the original logo)

Measured content bands of `Worknest Logo.png.png` to split the mark from the wordmark rather than
guessing: symbol = `y206–713`, full lockup = `(0,188,1139,1158)`.

Generated with Pillow, preserving appearance (no recolouring, no substitution):

- **Adaptive icon foreground** — symbol at 62 % of the 108 dp canvas, inside the 66 dp safe zone,
  5 densities (108→432 px). Pairs with the template's existing white
  `@color/ic_launcher_background`, which matches the logo's own white background.
- **Legacy square + round icons** — symbol on the logo's white background, 48 dp, 5 densities.
- **Splashes** — full original lockup centred on white, all 11 drawable variants.
- App name `WorkNest HR`, `applicationId app.worknesthr`, `versionCode 1`, `versionName "1.0"`,
  `minSdk 24`, `compileSdk/targetSdk 36`.

### 4.2 Android lifecycle & shell integration (new, additive files)

| File | Purpose |
|---|---|
| `src/utils/androidShell.ts` | Back-button dispatch + status-bar theme sync |
| `src/utils/nativePrint.ts` | Print bridge + `window.print` shim |
| `src/lib/serverConfig.ts` | Server-origin resolution for web vs APK |
| `android/.../WorkNestPrintPlugin.java` | Native print (Java, ~110 lines) |

- **Back button** — the app has no URL routes, so Back needs explicit meaning. Screens register
  handlers via `onAndroidBack()`; `App.tsx` closes the mobile drawer then returns to the dashboard;
  `EmployeePanel.tsx` closes its drawer/modal then returns to Overview. If nothing consumes the
  press, the shell exits the app (conventional root-screen behaviour) rather than calling
  `history.back()`, which could bounce between internal WebView navigations.
- **Status bar** — Capacitor 8 always draws edge-to-edge on Android 15+ and exposes system-bar
  sizes as `env(safe-area-inset-*)` (`SystemBars.insetsHandling: 'css'`). The app handled **bottom**
  insets but not **top**, so `pt-[env(safe-area-inset-top)]` was added to the app shell and the
  employee panel root — otherwise the top bar renders under the status bar. `Status.Light`
  (dark icons) is used, and `installStatusBarThemeSync()` re-applies it from the app's **existing**
  `data-theme` attribute and `worknest-theme-change` event, so no theme logic is duplicated.
- **Keyboard** — `resize: 'native'` so focused inputs are never hidden behind the IME.

### 4.3 Genuine Android regressions found and fixed

These were real defects, not stylistic changes:

1. **Printing was completely broken in the APK.** The app prints via `window.print()`,
   iframe `contentWindow.print()`, and `window.open(blobUrl)`. Android's WebView implements
   **none** of these, so payslips, printable reports and the AI report studio would have silently
   done nothing. Verified against Capacitor's own source that `blob:`/`data:` URLs load *in place*
   (`Bridge.launchIntent` returns `false` for them), so the Payroll popup would additionally have
   **navigated the app away** from its UI.
   → Added a small Java plugin routing those documents to Android's print framework (which also
   provides *Save as PDF*), wired through `printHtmlDocument()`, `printCurrentView()` and a
   `window.print` shim. Browser behaviour is untouched. This is a genuine Android capability, which
   is why a native plugin is justified here.
2. **Server endpoints could not resolve from the APK.** `fetch('/iclock/auth')` is the *primary*
   admin **and** employee login path, and `window.location.origin` was used for the ZKTeco ADMS
   webhook URL and the ADMS device test. Inside the APK the origin is `https://localhost`, so the
   login request could never reach the server and the UI would have displayed a **wrong, copyable
   `https://localhost/...` webhook URL** to administrators configuring real devices.
   → Centralised in `src/lib/serverConfig.ts`. On the web the base is `''`, so requests stay
   relative — **byte-for-byte identical behaviour**. Inside the APK the deployment origin comes from
   `VITE_WORKNEST_SERVER_URL`. When that is unset, the webhook field and device test show an
   explicit "not configured" message instead of a misleading localhost URL.
3. **External links** — verified in Capacitor's `BridgeWebViewClient.shouldOverrideUrlLoading` that
   off-origin `http(s)` links open in the system browser, so the Firebase Console link works. **No
   change needed.**

### 4.4 What was deliberately *not* changed

No module, route, context, service, calculation, permission, tenant rule or business rule was
modified. No dependency was upgraded. `firestore.rules` and `firebase-blueprint.json` are
untouched. Production Firebase data was never written to.

---

## 5. Phase 8 — Build & verification

### 5.1 Local (this sandbox)

| Step | Command | Result |
|---|---|---|
| Install | `bun install --frozen-lockfile` | ✅ 268 packages, lockfile honoured |
| Type check | `bun run lint` (`tsc --noEmit`) | ✅ 0 errors |
| Production build | `bun run build` | ✅ `dist/` produced |
| Android sync | `bunx cap sync android` | ✅ assets copied, 4 plugins registered |

**The APK cannot be compiled in this sandbox.** Verified: no JDK/Gradle/Android SDK, and
`dl.google.com`, `services.gradle.org`, `repo.maven.apache.org` and `plugins.gradle.org` are all
network-blocked (only npm and GitHub are reachable). `apt-get install openjdk-17-jdk-headless`
→ *"Unable to locate package"*. Per the brief, compilation therefore runs on **GitHub Actions**,
whose runners provide JDK 21, the Android SDK and open network access.

### 5.2 CI (`.github/workflows/android-apk.yml`)

Runs the repository's own scripts in order — `bun install --frozen-lockfile` → `bun run lint` →
`bun run build` (with `VITE_WORKNEST_SERVER_URL`) → `bunx cap sync android` → `assembleDebug` — then
inspects the APK with `aapt2 dump badging` (package, label, SDK levels, launchable activity) and
uploads the artifact. A signed release APK builds only when keystore secrets are configured; the
keystore is decoded into `$RUNNER_TEMP` and never enters the repository. `android/.gitignore` had
its keystore rules **enabled** (the template ships them commented out) so signing material cannot
be committed.

No existing workflow was replaced — the repository had none.

### 5.3 Device QA (Phase 9) — **NOT TESTED**

No Android emulator or physical device is available in this sandbox, and none can be provisioned
without the Android SDK. **Compilation success is not functional verification.** Every Phase 9
scenario (fresh install, login/logout/session restore, dashboard, forms and keyboard, attendance and
leave flows, role-based access, tenant isolation, network loss and recovery, Back button,
backgrounding, duplicate-submit, empty/error states, theme switching, relaunch after force-close)
remains **NOT TESTED** and is listed as such in the final report. Installing the APK on a real
device is required to close this out.

---

## 6. Required configuration

### `VITE_WORKNEST_SERVER_URL`

The only value this integration needs from you. It is the **public origin of your deployed WorkNest
HR web app** — the same site that serves `/.netlify/functions/iclock` today.

- **Web build:** not used at all; requests stay same-origin.
- **APK build:** used for server-verified login (`/iclock/auth`), the ADMS device-connection test
  (`/iclock/cdata`) and the ADMS webhook / employee-portal URLs shown to administrators.

Set it as a GitHub Actions **repository variable** (Settings → Secrets and variables → Actions →
Variables) named `VITE_WORKNEST_SERVER_URL`, e.g. `https://your-worknest-site.netlify.app`.

It was **not guessed**: no deployed origin is recorded anywhere in the repository
(`worknest-hr.app` appears only as a synthetic Firebase Auth email domain for
`@auth.worknest-hr.app` / `@emp.worknest-hr.app`, never as a URL).

**If it is not set**, the APK still works: login falls back to the app's existing direct-Firebase
Auth path (the same one already documented in the code as the static-preview fallback), while the
ADMS webhook field and device test clearly report that no server address is configured.

---

## 7. Files added or changed

**Added**

```
capacitor.config.ts
.github/workflows/android-apk.yml
.gitignore
android/                                  (Capacitor 8 Android project + brand assets)
  app/src/main/java/app/worknesthr/WorkNestPrintPlugin.java
src/lib/serverConfig.ts
src/utils/androidShell.ts
src/utils/nativePrint.ts
docs/ANDROID_AUDIT.md                     (this file)
```

**Modified** (smallest safe change at each site)

```
package.json                  + @capacitor deps, + android:sync / android:apk scripts
bun.lock                      additive only (24 insertions, 0 deletions)
src/main.tsx                  install shell integrations (no-op on the web)
src/App.tsx                   back handler, safe-area top inset
src/components/EmployeePanel.tsx   back handler, safe-area top inset
src/components/Payroll.tsx    payslip print via native bridge
src/utils/reportPrinter.ts    report print via native bridge
src/lib/authService.ts        /iclock/auth resolves via serverConfig
src/context/DataContext.tsx   ADMS device test resolves via serverConfig
src/components/ZKTecoIntegration.tsx, BranchManagement.tsx, AccountSettings.tsx
                              ADMS webhook / portal URLs via serverConfig
android/.gitignore            keystore rules enabled
```

---

## 8. Preservation guarantees

- Every existing module, route, context, service and setting is intact.
- No existing feature was removed, disabled, simplified or mocked.
- Firebase project ID, collection names, auth configuration, tenant architecture and
  `firestore.rules` are **unchanged and were never loosened**.
- No production employee, attendance, payroll or subscription record was read, written or deleted.
- No credential, service-account key, keystore or password is present in the repository.
- The original logo PNG is preserved unmodified; only derived Android icon resources were generated.
- ZKTeco device communication remains **server-side** (Netlify `iclock.js`). No direct
  device-to-phone ADMS connection was introduced.
