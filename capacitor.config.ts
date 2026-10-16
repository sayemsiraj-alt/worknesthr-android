import type { CapacitorConfig } from '@capacitor/cli';

/**
 * WorkNest HR — Android packaging configuration.
 *
 * The web application is **bundled locally** inside the APK (`webDir: dist`).
 * The app never downloads its interface from a remote website; only the
 * backend services (Firebase Auth / Firestore / Realtime Database and the
 * ZKTeco ADMS endpoints) are online, exactly as they are for the web build.
 *
 * `androidScheme: 'https'` gives the WebView the secure origin
 * `https://localhost`, which is required for Firebase Auth to keep its
 * persistence (localStorage / IndexedDB) working the same way as in a browser.
 */
const config: CapacitorConfig = {
  appId: 'app.worknesthr',
  appName: 'WorkNest HR',
  webDir: 'dist',

  android: {
    // Never allow insecure content inside the HTTPS WebView.
    allowMixedContent: false,
  },

  server: {
    androidScheme: 'https',
    // No `url` is set on purpose: the UI is served from bundled assets,
    // never from a deployed website.
  },

  plugins: {
    /**
     * Capacitor 8 always draws edge-to-edge on Android 15+. `insetsHandling: 'css'`
     * exposes the system bar sizes to the WebView as `env(safe-area-inset-*)`,
     * which is what the application already uses for its bottom navigation bar;
     * the status-bar area is offset by the app shell's top inset padding.
     */
    SystemBars: {
      insetsHandling: 'css',
      // Dark (black) icons for the light application chrome. The app shell
      // re-applies this whenever the in-app Light/Dark theme changes.
      style: 'LIGHT',
    },
    StatusBar: {
      // Dark icons on the light default theme; kept in sync with the app's own
      // theme switch by installStatusBarThemeSync().
      style: 'LIGHT',
    },
    Keyboard: {
      // Resize the WebView so focused inputs are never hidden behind the IME.
      resize: 'native',
      resizeOnFullScreen: false,
    },
    SplashScreen: {
      // Brief brand splash, then hand over to the app.
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
  },
};

export default config;
