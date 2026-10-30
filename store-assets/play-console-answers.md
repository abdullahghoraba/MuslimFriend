# Play Console answers — Muslim Friend

Copy these into **Play Console → Policy → App content**. Everything below matches the code as shipped:
INTERNET is used only to fetch public content over HTTPS (recitations, radio, hadith, mushafs, tafsirs), no SDKs that send data,
`allowBackup="false"`.

---

## 1. Privacy policy

URL: `https://<your-github-user>.github.io/<repo>/privacy-policy.html`
(publish `docs/` with GitHub Pages → Settings → Pages → Branch `main`, folder `/docs`, and replace `CONTACT_EMAIL` in the file first).

## 2. Ads

**Does your app contain ads?** → **No**.

## 3. App access

**All functionality is available without special access** (no login, no accounts).

## 4. Data safety

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** — one type, below |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (all network traffic is HTTPS) |
| Do you provide a way for users to request that their data is deleted? | **No** (the developer receives and keeps nothing; local data: Settings → Reset all data) |

Data type to declare — **App activity → In-app search history**:
- Collected: **Yes** · Shared: **No** (sent only when the user taps “Search all hadith books (online)”, directly to
  dorar.net to get results — a user-initiated transfer the user expects).
- Processed ephemerally: **No** (we cannot vouch for dorar.net's logs) · Required or optional: **Optional**.
- Purpose: **App functionality**.

Everything else is not collection (Google: data transmitted off the device *about the user*):
- Fetching public content: recitation MP3s (everyayah.com, mp3quran.net), Quran radio streams (backup.qurango.net),
  reciter names (mp3quran.net, weekly while the Listen page is open), hadith (hadeethenc.com for the topics and the
  hadith of the day, cdn.jsdelivr.net for the hadith collections, dorar.net for a hadith's rulings — the request holds
  the hadith text, not user data), tafsirs, translations and tajweed rules (api.quran.com, jsDelivr / GitHub), riwayat
  mushafs (jsDelivr), Shamarly mushaf pages (archive.org) and athan recordings (Wikimedia Commons, archive.org). The
  requests carry only the file or hadith asked for; servers see the IP like any web request (disclosed in the policy).
- Searches in saved hadith and downloaded books, saved hadith, bookmarks and notes stay on the device.
- Approximate location (optional) is used **on-device only** for prayer times; never transmitted.
- Backup export is a **user-initiated** share of a file the user sends where they choose.
- No analytics, crash reporting, ads or Firebase SDKs (verify: `cd android && gradlew.bat app:dependencies`).

Resulting label: **“Data collected: App activity (in-app search history, optional)” · “No data shared with third parties”**.

## 5. Content rating (IARC questionnaire)

- Category: **Reference, News, or Educational** (or "All Other App Types" if that category is not offered).
- Violence: No · Sexuality: No · Language: No · Controlled substances: No · Gambling: No.
- User-generated content shared with other users: **No** (custom athkar stay on the device).
- Users can interact or exchange content: **No**.
- Shares user location with other users: **No**.
- Digital purchases: **No**.
- Unrestricted internet access / web browser: **No** (the app only fetches content from fixed hosts; it has no browser).

Expected rating: **Everyone / PEGI 3 / 3+**.

## 6. Target audience and content

- Target age groups: **18 and over** is the safest choice to avoid the Families policy requirements; the app is suitable for all ages but is not designed for children. (If you select under-13 age groups, the Families policy applies; the app already complies — no ads, no data collection — but you will need to complete the extra declarations.)
- Appeals to children: **No** (no characters, games or child-directed design).

## 7. News app

**No**.

## 8. Government app

**No**.

## 9. Financial features

**None**.

## 10. Health

**No** health features.

## 11. Permissions declarations

- `SYSTEM_ALERT_WINDOW` — no Play declaration form; explained in the store listing and in-app before requesting.
- `ACCESS_COARSE_LOCATION` — foreground only, requested on tap; no background location.
- `SCHEDULE_EXACT_ALARM` (user-granted, **not** `USE_EXACT_ALARM`): used only so the athan fires at the exact prayer
  time; athkar reminders stay inexact. If the user doesn't grant it, the athan falls back to inexact alarms. No Play
  declaration form is required for SCHEDULE_EXACT_ALARM.
- `ACCESS_NOTIFICATION_POLICY`: optional "silent during prayer"; the user grants Do Not Disturb access in system settings.
- No `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; the app only opens the system battery settings page.

---

## 12b. Foreground service declaration — `mediaPlayback` (athan and Quran recitation)

**Type:** `mediaPlayback` (services `AthanService` and `PlaybackService`).
**Describe the feature:** (1) Athan: at each prayer time the user enabled, the app plays the athan sound the user chose
(a muezzin recording downloaded in the app, their own audio file, a built-in tone or the system alarm sound) for up to a
few minutes, with a notification that has a Stop button. The service starts from the user's exact alarm and stops when
the sound ends or the user taps Stop. (2) Quran recitation: when the user presses play on a sura, a Quran radio station
or the verse-by-verse recitation in the mushaf, the audio keeps playing with the screen off or in another app, with a
media notification and lock-screen controls (play/pause, next, previous). It runs only while the user's playback is
playing and stops when the user pauses and dismisses it, taps stop, or the optional sleep timer ends.
**Why a foreground service:** audio must keep playing while the screen is off or another app is open; only a
foreground service with type mediaPlayback can do that reliably.
**Demo video:** open Athan settings → enable → set Fajr to "Athan" → tap ▶ preview (sound + notification with Stop) →
tap Stop. Then open Listen → pick a reciter → play a sura → lock the phone: the recitation continues and the lock screen
shows its controls → pause from the lock screen.

## 12. Foreground service declaration (Android 14+)

**Foreground service type:** `specialUse`

**Subtype (declared in the manifest as `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`):**
> User-enabled overlays over other apps: (1) a reminder card that periodically (at a user-chosen interval, or on unlock) shows a short Islamic remembrance (dhikr) for a few seconds, and (2) a small floating tasbih counter the user taps to count while using other apps. The service only listens for screen on/off/unlock, runs a timer and hosts these windows; it does no networking and collects no data. The user can pause or stop it from the persistent notification.

**Describe the feature (Play Console text box):**
> "Athkar over other apps" is an optional feature the user turns on in the app's Overlay settings. While it is on, a small card with a short Islamic remembrance (dhikr) appears over whatever app the user is using, every 5–60 minutes (user's choice) or each time the phone is unlocked, and disappears after a few seconds. It never blocks touches outside the card, can be dismissed with a tap or swipe, and respects quiet hours set by the user. A persistent notification lets the user pause it for an hour or stop it. The same service also hosts the optional "floating tasbih counter": a small round counter the user drags anywhere and taps to count dhikr while using other apps (it hides while our app is open). The service does no networking and collects no data.

**Why a foreground service is needed and why no other type fits:**
> The feature must keep running while the app is in the background so it can react to unlock events (USER_PRESENT/SCREEN_ON broadcasts are only delivered to a registered, running component) and show an overlay window at user-chosen intervals. WorkManager/JobScheduler cannot run at short, user-chosen intervals or react to unlock immediately, and exact alarms are not appropriate for this use. None of the predefined types (dataSync, mediaPlayback, location, etc.) describe a user-visible reminder overlay, so `specialUse` is used. The service is started only by an explicit user action in the app (or restored after reboot if the user left it on), shows a persistent notification with Pause and Stop actions, and stops when the user turns the feature off.

**What happens if the system defers the task:**
> If the system defers or prevents the service, the reminder is not shown at that moment and the user simply misses one reminder. If the service cannot start (e.g. Android 15+ background-start restrictions), the app falls back to showing athkar as regular notifications and tells the user the next time they open the app.

**User impact if interrupted:** Low — reminders are skipped until the service is running again.

### Demo video script (≤ 60 s, screen recording; upload unlisted to YouTube and paste the link)

1. **0–5 s** Open Muslim Friend → Settings → "Athkar over other apps". Caption: "The overlay is off by default."
2. **5–15 s** Turn on "Show athkar over other apps". Android opens "Display over other apps" → allow → return. Allow notifications when asked.
3. **15–22 s** Show the settings: frequency (choose "Every unlock" for the demo), display duration, position, quiet hours.
4. **22–28 s** Pull down the notification shade: show the persistent "Athkar overlay is on" notification with **Pause 1 hour** and **Stop**.
5. **28–40 s** Lock the phone, unlock it, open another app (e.g. Settings). The dhikr card appears at the top for a few seconds; tap **+1**, then swipe it away. Show that the app underneath stays usable while the card is visible.
6. **40–50 s** In the notification tap **Pause 1 hour** → lock/unlock → no card. Then tap **Stop** → the notification disappears.
7. **50–60 s** Back in the app: the toggle is off. Caption: "The user can stop the service at any time."

---

## 13. Release checklist

1. `content/review.csv` reviewed by a qualified person; corrections applied to `content/athkar.source.json`; set `reviewed: true` handling as needed and bump `contentVersion`.
2. Replace `CONTACT_EMAIL` in `docs/privacy-policy.html`; publish GitHub Pages.
3. Confirm the final `appId` in `capacitor.config.ts` and `android/app/build.gradle` (`applicationId`) — permanent after the first upload.
4. Create the upload key: `powershell -ExecutionPolicy Bypass -File scripts\create-upload-key.ps1` and back it up.
5. `npm run release` → `android/app/build/outputs/bundle/release/app-release.aab`.
6. Play Console → create app → enrol in **Play App Signing** (default) → upload the AAB to **Internal testing** first.
7. Test on Android 10, 13, 14, 15, 16 and on Xiaomi, Samsung, Oppo devices (see README "Device test matrix").
8. Fill the store listing (`store-assets/store-listing.md`), graphics, and this App content page; submit for review.
