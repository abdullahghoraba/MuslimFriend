import { defineConfig } from '@playwright/test';

// Store screenshots: npx playwright test -c scripts/store-shots   (captures into store-assets/screenshots/raw, then frames)
export default defineConfig({
  testDir: '.',
  timeout: 600_000,
  workers: 1,
  use: { channel: 'chrome', baseURL: 'http://localhost:4321' },
  webServer: { command: 'npx ng serve --port 4321', url: 'http://localhost:4321', reuseExistingServer: true, timeout: 180_000 },
});
