import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Native printing bridge.
 *
 * The original application prints through browser APIs:
 *   - `window.print()`
 *   - a hidden iframe whose `contentWindow.print()` is called
 *   - `window.open(blobUrl)` popups
 *
 * Android's WebView implements none of these, so inside the APK those code
 * paths would silently do nothing. These helpers route the same documents to
 * Android's print framework (which provides "Save as PDF" as well as printers),
 * while leaving browser behaviour untouched.
 */

interface WorkNestPrintPlugin {
  printHtml(options: { html: string; jobName?: string }): Promise<void>;
  printPage(options?: { jobName?: string }): Promise<void>;
}

const WorkNestPrint = registerPlugin<WorkNestPrintPlugin>('WorkNestPrint');

/** True only inside the packaged Android app. */
export const isNativeAndroid = (): boolean => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
};

/**
 * Print a complete standalone HTML document through the native print dialog.
 * @returns true when the native path handled it, false when the caller should
 *          fall back to the existing browser implementation.
 */
export async function printHtmlDocument(
  html: string,
  jobName = 'WorkNest HR Document'
): Promise<boolean> {
  if (!isNativeAndroid() || !html || !html.trim()) return false;
  try {
    await WorkNestPrint.printHtml({ html, jobName });
    return true;
  } catch (err) {
    console.warn('[WorkNestPrint] Native document print failed, falling back to web printing:', err);
    return false;
  }
}

/**
 * Print the screen that is currently visible.
 * @returns true when the native path handled it.
 */
export async function printCurrentView(jobName = 'WorkNest HR Document'): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  try {
    await WorkNestPrint.printPage({ jobName });
    return true;
  } catch (err) {
    console.warn('[WorkNestPrint] Native page print failed, falling back to window.print():', err);
    return false;
  }
}

/**
 * On Android, redirect `window.print()` to the native print dialog so existing
 * call sites keep working without modification. No-op in browsers.
 */
export function installNativePrintShim(): void {
  if (!isNativeAndroid()) return;
  const w = window as unknown as { __worknestPrintShim?: boolean };
  if (w.__worknestPrintShim) return;
  w.__worknestPrintShim = true;

  const browserPrint = window.print ? window.print.bind(window) : null;
  window.print = () => {
    void printCurrentView().then((handled) => {
      if (!handled && browserPrint) {
        try {
          browserPrint();
        } catch {
          /* WebView has no print implementation; nothing further to try. */
        }
      }
    });
  };
}
