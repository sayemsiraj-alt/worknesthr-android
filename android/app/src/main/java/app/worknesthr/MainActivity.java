package app.worknesthr;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registers the local WorkNestPrint plugin (restores the app's existing
        // print / save-as-PDF features that the WebView does not implement).
        // Must be called before super.onCreate() so the plugin is available to the bridge.
        registerPlugin(WorkNestPrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
