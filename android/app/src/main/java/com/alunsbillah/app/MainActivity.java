package com.alunsbillah.app;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.alunsbillah.app.overlay.AthkarOverlayPlugin;
import com.alunsbillah.app.audio.QuranAudioPlugin;
import com.alunsbillah.app.studio.MediaSaverPlugin;
import com.alunsbillah.app.tasmee.SpeechPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Switches from the launch theme to the app theme once the first frame is ready.
        SplashScreen.installSplashScreen(this);
        // Local plugins must be registered before the bridge is created.
        registerPlugin(AthkarOverlayPlugin.class);
        registerPlugin(QuranAudioPlugin.class);
        registerPlugin(MediaSaverPlugin.class);
        registerPlugin(SpeechPlugin.class);
        super.onCreate(savedInstanceState);
        // The WebView scales all text with the phone's font size (up to 200%); beyond 140% the toolbars and players no
        // longer fit and their arrows and buttons run into each other. Quran and athkar text have their own size (up to 2x).
        float fontScale = getResources().getConfiguration().fontScale;
        bridge.getWebView().getSettings().setTextZoom(Math.round(Math.min(fontScale, 1.4f) * 100));
    }
}
