package app.worknesthr;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * WorkNestPrint — minimal native bridge that restores WorkNest HR's existing
 * "Print / Save as PDF" features inside the Android WebView.
 *
 * Android's WebView does not implement {@code window.print()}, iframe printing
 * or {@code window.open()} popups, so the web implementation of those features
 * is a silent no-op when the app runs from the APK. Rather than removing those
 * features from the application, this plugin routes them to Android's own print
 * framework, which also supplies the system "Save as PDF" target.
 *
 * This plugin intentionally exposes only what the existing application needs.
 * It requests no Android permissions.
 */
@CapacitorPlugin(name = "WorkNestPrint")
public class WorkNestPrintPlugin extends Plugin {

    /** Strong reference retained while a print job is being prepared. */
    private WebView printWebView;

    /**
     * Renders a standalone HTML document and hands it to the Android print framework.
     * Used for payslips, printable reports and generated print documents.
     */
    @PluginMethod
    public void printHtml(PluginCall call) {
        final String html = call.getString("html");
        final String jobName = call.getString("jobName", "WorkNest HR Document");

        if (html == null || html.trim().isEmpty()) {
            call.reject("html is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                final WebView webView = new WebView(getActivity());
                webView.getSettings().setJavaScriptEnabled(false);
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        print(call, view, jobName);
                    }
                });

                // Give the off-screen WebView a real layout width so the print
                // adapter can paginate the document properly.
                int width = getActivity().getResources().getDisplayMetrics().widthPixels;
                webView.measure(
                    View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
                );
                webView.layout(0, 0, width, webView.getMeasuredHeight());

                // Keep the instance alive until the platform has taken the job.
                this.printWebView = webView;
                webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                call.reject("Unable to prepare print document: " + e.getMessage());
            }
        });
    }

    /**
     * Prints the currently visible application screen.
     * Used where the web build relied on {@code window.print()}.
     */
    @PluginMethod
    public void printPage(PluginCall call) {
        final String jobName = call.getString("jobName", "WorkNest HR Document");
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            if (webView == null) {
                call.reject("WebView is not available");
                return;
            }
            print(call, webView, jobName);
        });
    }

    private void print(PluginCall call, WebView webView, String jobName) {
        try {
            PrintManager printManager =
                (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            if (printManager == null) {
                call.reject("Printing is not available on this device");
                return;
            }
            PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
            printManager.print(jobName, adapter, new PrintAttributes.Builder().build());
            call.resolve();
        } catch (Exception e) {
            call.reject("Print failed: " + e.getMessage());
        }
    }
}
