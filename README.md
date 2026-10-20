# Muslim Athkar · أذكار المسلم

An ad-free, tracking-free, fully offline athkar app for Android, built with Ionic + Angular + Capacitor
and a native Kotlin plugin (`AthkarOverlay`) for what a WebView cannot do.
Arabic (default, RTL) and English.

- No ads, no analytics, no Firebase, no accounts. The merged manifest has **no INTERNET permission**.
- Every dhikr shows its source; Quran text is copied verbatim from Tanzil at build time.
- Athkar shown over other apps, reminders tied to prayer times, reorderable lists, tasbih, local stats.

## Stack (all versions pinned exactly)

| Part | Version |
| --- | --- |
| Angular (standalone, zoneless, signals) | 22.2.3 |
| Ionic Framework (`@ionic/angular`) | 9.0.8 |
| Capacitor core / android / cli | 8.5.3 |
| `@capacitor-community/sqlite` (sql.js pinned to 1.11.0 for the web dev build) | 8.1.1 |
| `@ngx-translate/core` + `http-loader` | 18.0.0 |
| `adhan` (prayer times, on-device) | 4.4.6 |
| Android: compileSdk / targetSdk / minSdk | 36 / 36 / 26 |
| AGP / Gradle / Kotlin / JDK | 8.13.0 / 8.14.3 / 2.3.21 / 21 |

## Requirements

- Node.js 22 and npm 10
- JDK 21. `scripts/gradle.mjs` (used by the npm scripts) picks `ATHKAR_JAVA_HOME` if set, otherwise
  `C:\Program Files\Android\openjdk\jdk-21.0.8`, so a machine-wide `JAVA_HOME` pointing at an older JDK is fine.
- Android SDK with Platform 36 and Build-Tools 36.0.0. Point `android/local.properties` at it:
  `sdk.dir=E\:/Android/Sdk` (forward slashes; the file is git-ignored).

## Run

```bash
npm ci
npm start                 # http://localhost:4200 — browser dev mode (SQLite via jeep-sqlite/IndexedDB)
```

The native plugin has a browser stand-in (`src/app/native/athkar-overlay.ts`) so every screen works in the browser;
the overlay itself and notifications only exist on Android.

### On a device or emulator

```bash
npm run apk:debug         # i18n + content + web build + cap sync + assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
npx cap open android      # or open in Android Studio and press Run
```

## Tests

```bash
npm test                  # content validation + Vitest unit tests (services, prayer times, counters, backup, stats)
npm run test:android      # JVM unit tests for the overlay rules (quiet hours, rotation, timing)
npm run e2e               # Playwright end-to-end tests against the browser build (uses installed Chrome)
```

## Release build and signing (Play App Signing)

1. **Create the upload key once** (you choose the password; never commit it):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\create-upload-key.ps1
   ```
   This writes `android/upload-keystore.jks` and `android/keystore.properties` (both git-ignored).
   **Back up both** (password manager + offline copy).
2. **Build the signed bundle:**
   ```bash
   npm run release
   # → android/app/build/outputs/bundle/release/app-release.aab
   ```
   Without `keystore.properties` the same command produces an unsigned bundle (useful for CI checks).
3. In Play Console create the app, keep **Play App Signing** enabled (Google holds the app-signing key; your key is
   only the *upload* key), and upload the AAB to Internal testing first.
4. Bump `versionCode` / `versionName` in `android/app/build.gradle` for every upload.

Release builds use R8 (`minifyEnabled`, `shrinkResources`); keep rules for Capacitor's reflective plugin calls are in
`android/app/proguard-rules.pro`.

## Content pipeline

```
content/categories.json          12 categories
content/athkar.source.json       items; Quran items reference {s, from, to, words?} only
content/tanzil/quran-uthmani.txt Tanzil Uthmani v1.1 (CC BY 3.0) — never edit
scripts/build-content.mjs        → public/assets/data/athkar.json + content/review.csv
```

- `npm run content` rebuilds; `npm run content:check` validates only (runs in `npm test`).
- Every item ships with `reviewed: false`. **Before release a qualified person must verify each row of
  `content/review.csv` against its source**, filling `reviewed`, `reviewer`, `review_date`, `corrections`.
  `reviewer_note` flags references whose numbering differs between editions. Apply corrections in
  `athkar.source.json` and bump `contentVersion` (user order/overlay choices are preserved on re-seed).
- Hadith text is never paraphrased; `virtue*` fields are short summaries labelled "Virtue (summary)".

## Translations

Strings live in `public/assets/i18n/{ar,en}.json`. To add strings without editing the same file in parallel, put
`i18n-fragments/<feature>.{ar,en}.json` and run `npm run i18n` (merges, deletes the fragments, and fails if the two
languages have different keys).

## Architecture

```
src/app/core/db/            SQLite connection + append-only migrations
src/app/core/services/      athkar repository, progress, tasbih, overlay, backup, stats, settings, lifecycle
src/app/core/prayer/        adhan wrapper, next prayer, 30-day reminder planner (pure, unit-tested)
src/app/native/             TypeScript API of the AthkarOverlay plugin (+ browser stand-in)
src/app/pages/              home, category (all athkar on one page with counters), tasbih, my-athkar,
                            overlay, reminders, stats, onboarding, settings, privacy
android/app/src/main/java/com/muslimathkar/app/overlay/
  AthkarOverlayPlugin.kt    Capacitor bridge (permissions, start/stop, pool, counters, reminders, location)
  OverlayService.kt         foreground service (specialUse): screen on/off/unlock receiver + coroutine timer
  OverlayWindow.kt          TYPE_APPLICATION_OVERLAY card (not focusable, not touch-modal), Amiri font, RTL
  OverlayController.kt      start rules + notification-only fallback (inexact alarms)
  ReminderScheduler.kt      next reminder as an inexact alarm (setAndAllowWhileIdle); re-sent on each app start
  Receivers.kt              boot / package-replaced restore, reminder + fallback receivers
  OverlayStore.kt           native storage so the service works without the WebView
```

### Android platform rules this follows (checked against developer.android.com, Oct 2026)

- Foreground service type `specialUse` + `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`; no FGS timeout applies to it.
- The service starts only from a user action in the foreground, or from `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED`
  (exempt from background-start limits; `specialUse` is not among the types Android 15 blocks from boot).
  On Android 15+ `SYSTEM_ALERT_WINDOW` no longer exempts a background start unless an overlay is visible, so any
  failed start (`ForegroundServiceStartNotAllowedException`) falls back to notification-only mode and the app tells
  the user on next open.
- Reminders use inexact alarms only — no `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`. Prayer times shift daily, so
  the app re-plans the next 30 days on every start/resume; the native side arms only the next alarm.
- Targeting API 36: edge-to-edge is mandatory (Capacitor SystemBars `insetsHandling: 'css'` + Ionic safe-area vars),
  predictive back is on (`enableOnBackInvokedCallback="true"`; Capacitor uses `OnBackPressedCallback`).

## Device test matrix (manual, before each release)

| Check | Android 10 | 13 | 14 | 15 | 16 | Xiaomi | Samsung | Oppo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Onboarding permissions one at a time | | | | | | | | |
| Overlay shows on unlock / interval, +1 counts sync | | | | | | | | |
| Pause 1 h / Stop from notification | | | | | | | | |
| Overlay restored after reboot | | | | | | | | |
| Fallback notice when FGS start is refused | | | | | | | | |
| Morning/evening reminders fire, tap opens the list | | | | | | | | |
| RTL/LTR switch, dark mode, large system font | | | | | | | | |
| TalkBack reads counters and controls | | | | | | | | |
| Cold start < 2 s (`adb shell am start -W`) | | | | | | | | |

## Store and policy material

- `store-assets/store-listing.md` — Arabic and English listing, feature list, screenshot plan
- `store-assets/icon-512.png`, `store-assets/feature-graphic-1024x500.png` (from `scripts/make-icon.mjs`)
- `store-assets/play-console-answers.md` — Data safety, content rating, target audience, ads, FGS declaration,
  demo-video script, release checklist
- `docs/privacy-policy.html` — publish with GitHub Pages

## Licences and credits

- Quran text: Tanzil Project — https://tanzil.net (CC BY 3.0, verbatim; notice in `public/assets/licenses/`)
- Font: Amiri — SIL Open Font License 1.1 (`public/assets/fonts/OFL.txt`)
