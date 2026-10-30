# Hadith source snapshots

Fetched 2026-10-29 from `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/`.
The repository's `LICENSE` is the Unlicense (public-domain dedication), copied verbatim here
and attributed in `public/assets/licenses/hadith-api-Unlicense.txt`.

- `editions.json` is the upstream edition registry, unchanged.
- `ara/eng/ben/fra/tur-nawawi.json` and `ara/eng/fra-qudsi.json` are unchanged full edition files.
  These are all available translations for the app's 18 languages. Diacritic-stripped duplicates
  (`ara-…1`) are unnecessary: search normalizes the displayed original locally.
- `catalog.json` records the name, nonempty Arabic hadith count, section names and actual section
  counts from each Arabic edition. Each record contains the upstream URL and SHA-256 of that edition.
  Large source editions were inspected to derive these counts but are not bundled or committed.
- `daily.json` selects nine short Nawawi narrations whose own source attribution cites Bukhari
  and/or Muslim. Texts and translations are copied in full, not paraphrased. Companion names and
  authenticity provenance are explicit metadata; they do not invent a grade absent from `grades`.

`node scripts/build-hadith.mjs` is network-free and deterministic; `--check` verifies generated assets.
Update source snapshots deliberately, review their differences, then rebuild. Runtime downloads use
the upstream `@1` edition URLs only after the user requests them. Empty Arabic entries are not counted
or displayed. Decimal hadith IDs are preserved; translation joins never assume array alignment.
Book 0 is an upstream reference value for entries without a normal book mapping; it is retained
rather than silently reassigned. Source chapter titles are English where the dataset provides only English.

Design references reviewed: Sunnah.com (collection/book references and search), Dorar.net (narrator,
scholar, source and exact ruling), Greentech's Hadith Collection (daily reading and offline access),
Muslim Pro's daily inspiration/saved-reading patterns, and the Nawawi 40 app at
https://github.com/mahmoodhamdi/nawawi_40_hadith_app (last-read, bookmarks, notes, font controls).

Dorar's endpoint returned a Cloudflare 403 from the development network on this date. Parser and native
transport selection have fixture tests; live Android retrieval still needs device verification. A failed
lookup never changes offline grades or erases a successful cached answer. General grade definitions
are UI explanations, not claims about the specific cause of a scholar's ruling.
