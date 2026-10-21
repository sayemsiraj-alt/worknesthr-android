import { isNativeAndroid } from './nativePrint';

/**
 * WorkNest HR Android shell integration.
 *
 * The application is a single-page app whose screens are React state, not URL
 * routes, so the WebView has no history to step back through. Android's system
 * Back button therefore needs explicit meaning:
 *
 *   1. A screen that can close something (open drawer, modal, sub-tab) marks the
 *      back press as handled by calling `preventDefault()` on the event below.
 *   2. If nothing handles it, the system Back button exits the app — the
 *      conventional Android behaviour for a root screen.
 *
 * Screens opt in with `onAndroidBack(handler)`; on the web these listeners never
 * fire, so browser behaviour is unchanged.
 */

export const ANDROID_BACK_EVENT = 'worknest:android-back';

type BackHandler = () => boolean;

const handlers = new Set<BackHandler>();

let installed = false;

/**
 * Register a back handler. Handlers run most-recently-registered first, so an
 * inner screen (e.g. a modal) can consume the press before its parent.
 * @returns an unsubscribe function.
 */
export function onAndroidBack(handler: BackHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** Runs the registered handlers; true when one consumed the back press. */
function dispatchBack(): boolean {
  const ordered = Array.from(handlers).reverse();
  for (const handler of ordered) {
    try {
      if (handler()) return true;
    } catch (err) {
      console.warn('[Android back] handler failed:', err);
    }
  }
  return false;
}

/**
 * Keeps the Android status-bar icon colour in sync with the application's own
 * Light/Dark theme. The app already publishes the resolved theme on
 * `<html data-theme>` and via a `worknest-theme-change` event (see
 * SettingsContext), so no theme logic is duplicated here.
 *
 * `Style.Light` means "dark icons for light backgrounds"; `Style.Dark` means
 * "light icons for dark backgrounds".
 */
export function installStatusBarThemeSync(): void {
  if (!isNativeAndroid()) return;

  const apply = () => {
    void (async () => {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        const root = document.documentElement;
        const isDarkTheme =
          root.getAttribute('data-theme') === 'dark' || root.classList.contains('dark');
        await StatusBar.setStyle({ style: isDarkTheme ? Style.Dark : Style.Light });
      } catch (err) {
        console.warn('[Android shell] Unable to update status bar style:', err);
      }
    })();
  };

  apply();
  window.addEventListener('worknest-theme-change', apply);
}

/** Wires the Android hardware/gesture Back button to the handlers above. */
export function installAndroidBackHandler(): void {
  if (!isNativeAndroid() || installed) return;
  installed = true;

  void (async () => {
    try {
      const { App } = await import('@capacitor/app');
      await App.addListener('backButton', () => {
        if (dispatchBack()) return;
        // Nothing consumed the press: leave the app, as Android users expect
        // from a root screen. (Avoids history.back(), which would bounce
        // between internal WebView navigations.)
        void App.exitApp();
      });
    } catch (err) {
      console.warn('[Android back] Unable to register Back button listener:', err);
    }
  })();
}
