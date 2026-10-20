# Muslim Athkar

An ad-free, tracking-free, fully offline athkar app for Android, built with Ionic + Angular + Capacitor.
Arabic (default, RTL) and English.

> Status: **Phase 1** — content pipeline, reader, tasbih, My Athkar, i18n and themes.
> Phase 2 adds the native `AthkarOverlay` plugin, Phase 3 prayer times and reminders,
> Phase 4 statistics, backup, onboarding and the release build.

## Stack (pinned)

| Package | Version |
| --- | --- |
| Angular (standalone, zoneless, signals) | 22.2.3 |
| Ionic Framework (`@ionic/angular`) | 9.0.8 |
| Capacitor (core / android / cli) | 8.5.3 |
| `@capacitor-community/sqlite` | 8.1.1 |
| `@ngx-translate/core` + `http-loader` | 18.0.0 |
| `adhan` (Phase 3) | 4.4.6 |

All dependency versions in `package.json` are exact. No ad SDKs, no analytics, no Firebase.

## Requirements

- Node.js 22 LTS and npm 10
- JDK 21 (bundled with current Android Studio) for Android builds
- Android Studio with SDK Platform 36 and Build-Tools 36

## Setup and run

```bash
npm ci
npm start              # builds the content dataset, then serves on http://localhost:4200
```

In the browser, SQLite runs through `jeep-sqlite` (IndexedDB). This is for development only.

### Android

```bash
npm run cap:sync       # content + production web build + cap sync
npm run cap:open       # opens Android Studio; run on a device or emulator from there
```

## Tests

```bash
npm test               # validates the content dataset, then runs the Vitest unit tests
```

## Content

Content lives in `content/` and is compiled by `scripts/build-content.mjs` into
`public/assets/data/athkar.json`. Do not edit the generated JSON by hand.

- `content/categories.json` — the 12 categories.
- `content/athkar.source.json` — the items. Quran items only *reference* verses
  (`{ "s": 2, "from": 255, "to": 255, "words": [a, b]? }`). The build copies their text
  verbatim from `content/tanzil/quran-uthmani.txt`, so Quran text is never typed by hand.
- `content/tanzil/quran-uthmani.txt` — Tanzil Quran Text (Uthmani, v1.1), CC BY 3.0.
  It must not be modified, and its copyright notice must be kept.
- `content/review.csv` — generated review sheet (UTF-8 with BOM, opens in Excel).

Every item ships with `reviewed: false`. **Before release, a qualified person must check each
row of `content/review.csv` against its source**, fill in `reviewed`, `reviewer`,
`review_date` and `corrections`, and any correction must be applied in
`content/athkar.source.json`. `reviewer_note` flags references whose numbering should be
double-checked against the edition used.

Hadith text is never paraphrased. The `virtue*` fields are short summaries of meaning, and the
app labels them "Virtue (summary)".

## Project layout

```
content/                 source dataset, Tanzil text, review CSV
scripts/build-content.mjs
public/assets/           fonts (Amiri, OFL), i18n, generated data, licences
src/app/core/            models, SQLite (migrations), services
src/app/pages/           home, category, reader, tasbih, my-athkar, settings, tabs
```

## Licences and credits

- Quran text: Tanzil Project — https://tanzil.net (CC BY 3.0, verbatim)
- Font: Amiri — SIL Open Font License 1.1 (`public/assets/fonts/OFL.txt`)
