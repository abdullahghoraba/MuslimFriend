package com.muslimathkar.app;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.muslimathkar.app.overlay.AthkarOverlayPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Switches from the launch theme to the app theme once the first frame is ready.
        SplashScreen.installSplashScreen(this);
        // Local plugins must be registered before the bridge is created.
        registerPlugin(AthkarOverlayPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
