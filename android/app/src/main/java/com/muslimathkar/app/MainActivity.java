package com.muslimathkar.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.muslimathkar.app.overlay.AthkarOverlayPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is created.
        registerPlugin(AthkarOverlayPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
