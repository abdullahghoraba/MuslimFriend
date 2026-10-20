import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Permanent once published on Google Play — change it before the first upload if needed.
  appId: 'com.muslimathkar.app',
  appName: 'Muslim Athkar',
  webDir: 'dist/muslim-athkar/browser',
  android: {
    // No remote content is ever loaded. WebView debugging stays at Capacitor's default (debug builds only).
    allowMixedContent: false,
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
    // Edge-to-edge (mandatory when targeting API 36): Capacitor injects --safe-area-inset-* CSS vars.
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
