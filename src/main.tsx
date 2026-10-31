import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installNativePrintShim } from './utils/nativePrint';
import { installAndroidBackHandler, installStatusBarThemeSync } from './utils/androidShell';

// Android shell integration. Both are no-ops in a normal browser, so the web
// application is unaffected.
//  - print: the WebView has no window.print(), so those features are routed to
//    Android's print framework instead of silently doing nothing.
//  - back: gives Android's system Back button well-defined in-app behaviour.
//  - status bar: matches the icon colour to the app's own Light/Dark theme.
installNativePrintShim();
installAndroidBackHandler();
installStatusBarThemeSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
