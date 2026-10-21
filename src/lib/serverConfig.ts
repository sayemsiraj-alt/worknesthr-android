import { Capacitor } from '@capacitor/core';

/**
 * Server endpoint configuration.
 *
 * The web build is served from the deployment origin, so every server call is
 * naturally same-origin and relative (e.g. `/iclock/auth`).
 *
 * The Android app serves its interface from bundled assets on
 * `https://localhost`, so a relative `/iclock/auth` would resolve to the
 * device itself and could never reach the WorkNest HR server. This module
 * resolves that difference in one place:
 *
 *   - web            -> `''` base, meaning "relative to the current origin"
 *                       (behaviour is byte-for-byte unchanged)
 *   - Android        -> the deployment origin from `VITE_WORKNEST_SERVER_URL`
 *
 * Set `VITE_WORKNEST_SERVER_URL` (for example `https://your-site.netlify.app`)
 * when building the APK. See docs/ANDROID_AUDIT.md for how this is wired into CI.
 */

const configured = ((import.meta.env.VITE_WORKNEST_SERVER_URL as string | undefined) || '')
  .trim()
  .replace(/\/+$/, '');

/** Configured deployment origin (no trailing slash), or '' when unset. */
export const SERVER_BASE_URL = configured;

/** True when running inside the packaged Android/iOS app rather than a browser. */
export const isNativeApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** True when a deployment origin has been compiled into this build. */
export const hasConfiguredServer = (): boolean => SERVER_BASE_URL.length > 0;

/**
 * Absolute URL for a server endpoint.
 * When no origin is configured this returns the path unchanged, so the web
 * build keeps using its existing same-origin relative requests.
 */
export function serverEndpoint(path: string): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${SERVER_BASE_URL}${normalised}`;
}

/**
 * The origin that external clients (ZKTeco ADMS devices, employees opening the
 * portal link) must be able to reach.
 *
 * On the web this is the current origin — unchanged from the original app.
 * In the Android app the WebView origin is `https://localhost`, which no
 * external device can reach, so the configured deployment origin is used.
 * Returns '' when running natively without configuration, so callers can say so
 * instead of displaying a misleading localhost URL.
 */
export function publicServerOrigin(): string {
  if (SERVER_BASE_URL) return SERVER_BASE_URL;
  if (isNativeApp()) return '';
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/**
 * ZKTeco ADMS (iClock) webhook endpoint shown to administrators for device setup.
 * Empty string means this build has no deployment origin configured.
 */
export function admsWebhookUrl(): string {
  const origin = publicServerOrigin();
  return origin ? `${origin}/.netlify/functions/iclock` : '';
}

/**
 * Employee self-service portal link that can be shared with staff.
 * Empty string means this build has no deployment origin configured.
 */
export function employeePortalUrl(): string {
  const origin = publicServerOrigin();
  return origin ? `${origin}/?portal=employee` : '';
}

/** Message shown in place of a URL when this APK was built without a server origin. */
export const SERVER_NOT_CONFIGURED_HINT =
  'Not configured — build the APK with VITE_WORKNEST_SERVER_URL set to your WorkNest HR web address';
