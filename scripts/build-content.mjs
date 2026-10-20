// Builds the bundled athkar dataset from content/athkar.source.json.
//
// - Quran items are composed verbatim from the Tanzil Uthmani text
//   (content/tanzil/quran-uthmani.txt, CC BY 3.0, must not be altered).
// - Every item is emitted with reviewed=false; the review CSV lists each item
//   so a qualified reviewer can check text and source before release.
//
// Usage: node scripts/build-content.mjs [--check]
//   --check  validate only, do not write output files (used in CI / tests)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  source: resolve(root, 'content/athkar.source.json'),
  categories: resolve(root, 'content/categories.json'),
  tanzil: resolve(root, 'content/tanzil/quran-uthmani.txt'),
  outJson: resolve(root, 'public/assets/data/athkar.json'),
  outCsv: resolve(root, 'content/review.csv'),
};
const checkOnly = process.argv.includes('--check');

const REQUIRED_STRING_FIELDS = [
  'transliteration', 'meaningEn', 'virtueAr', 'virtueEn', 'sourceRef', 'grade',
];
const ARABIC_DIACRITICS = /[ً-ْ]/;

function loadTanzil() {
  const verses = new Map();
  for (const line of readFileSync(paths.tanzil, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [s, a, text] = line.split('|');
    verses.set(`${s}:${a}`, text);
  }
  if (verses.size !== 6236) {
    throw new Error(`Tanzil text has ${verses.size} verses, expected 6236`);
  }
  return verses;
}

function composeQuran(refs, verses, id) {
  const parts = [];
  for (const ref of refs) {
    if (ref.words && ref.from !== ref.to) {
      throw new Error(`${id}: a word range is only allowed on a single verse`);
    }
    for (let a = ref.from; a <= ref.to; a++) {
      let text = verses.get(`${ref.s}:${a}`);
      if (!text) throw new Error(`${id}: verse ${ref.s}:${a} not found`);
      if (ref.words) {
        const words = text.split(' ');
        const [first, last] = ref.words;
        if (first < 1 || last > words.length || first > last) {
          throw new Error(`${id}: word range ${first}-${last} out of bounds for ${ref.s}:${a}`);
        }
        text = words.slice(first - 1, last).join(' ');
      }
      // Verse-end marker uses Arabic-Indic digits so readers can follow along.
      parts.push(`${text} ﴿${toArabicDigits(a)}﴾`);
    }
  }
  return parts.join(' ');
}

function toArabicDigits(n) {
  return String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

function quranRefLabel(refs) {
  return refs
    .map((r) => `${r.s}:${r.from}${r.to !== r.from ? `-${r.to}` : ''}${r.words ? ` (words ${r.words[0]}-${r.words[1]})` : ''}`)
    .join('; ');
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function build() {
  const source = JSON.parse(readFileSync(paths.source, 'utf8'));
  const categories = JSON.parse(readFileSync(paths.categories, 'utf8'));
  const categoryIds = new Set(categories.map((c) => c.id));
  const verses = loadTanzil();

  const byId = new Map(source.items.map((i) => [i.id, i]));
  const seen = new Set();
  const errors = [];
  const items = [];

  for (const raw of source.items) {
    // copyOf reuses another item's text and metadata under a new id/category.
    const base = raw.copyOf ? byId.get(raw.copyOf) : undefined;
    if (raw.copyOf && !base) { errors.push(`${raw.id}: copyOf "${raw.copyOf}" not found`); continue; }
    if (base?.copyOf) { errors.push(`${raw.id}: copyOf must point at a non-copy item`); continue; }
    const src = { ...base, ...raw };
    delete src.copyOf;

    if (seen.has(src.id)) errors.push(`${src.id}: duplicate id`);
    seen.add(src.id);
    if (!/^[a-z0-9-]+$/.test(src.id)) errors.push(`${src.id}: id must be kebab-case`);
    if (!categoryIds.has(src.categoryId)) errors.push(`${src.id}: unknown category ${src.categoryId}`);
    if (!Number.isInteger(src.repeatCount) || src.repeatCount < 1) errors.push(`${src.id}: repeatCount must be a positive integer`);
    for (const f of REQUIRED_STRING_FIELDS) {
      if (typeof src[f] !== 'string') errors.push(`${src.id}: ${f} must be a string`);
    }
    if (!src.sourceRef?.trim()) errors.push(`${src.id}: sourceRef is required`);
    if (!!src.quran === !!src.textAr) errors.push(`${src.id}: exactly one of quran / textAr is required`);

    let textAr;
    try {
      textAr = src.quran ? composeQuran(src.quran, verses, src.id) : src.textAr;
    } catch (e) {
      errors.push(e.message);
      continue;
    }
    if (!ARABIC_DIACRITICS.test(textAr)) errors.push(`${src.id}: textAr has no tashkeel`);

    items.push({
      id: src.id,
      categoryId: src.categoryId,
      textAr,
      transliteration: src.transliteration,
      meaningEn: src.meaningEn,
      repeatCount: src.repeatCount,
      virtueAr: src.virtueAr,
      virtueEn: src.virtueEn,
      sourceRef: src.sourceRef,
      grade: src.grade,
      reviewed: false,
      isQuran: !!src.quran,
      quranRef: src.quran ? quranRefLabel(src.quran) : undefined,
      reviewNote: src.reviewNote,
    });
  }

  for (const c of categories) {
    if (!items.some((i) => i.categoryId === c.id)) errors.push(`category ${c.id} has no items`);
  }

  if (errors.length) {
    console.error(`Content validation failed:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }

  const dataset = {
    contentVersion: source.contentVersion,
    quranAttribution: 'Quran text: Tanzil Quran Text (Uthmani, Version 1.1), Copyright (C) 2007-2026 Tanzil Project, CC BY 3.0 — https://tanzil.net',
    categories,
    items: items.map(({ reviewNote, ...rest }) => rest),
  };

  const header = ['id', 'category', 'text', 'source', 'grade', 'quran_ref', 'reviewer_note', 'reviewed', 'reviewer', 'review_date', 'corrections'];
  const rows = items.map((i) => [i.id, i.categoryId, i.textAr, i.sourceRef, i.grade, i.quranRef ?? '', i.reviewNote ?? '', 'false', '', '', '']);
  // UTF-8 BOM so Excel opens the Arabic text correctly.
  const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

  if (checkOnly) {
    console.log(`OK: ${items.length} items in ${categories.length} categories (check only)`);
    return;
  }
  mkdirSync(dirname(paths.outJson), { recursive: true });
  writeFileSync(paths.outJson, JSON.stringify(dataset));
  writeFileSync(paths.outCsv, csv);
  console.log(`Wrote ${items.length} items in ${categories.length} categories`);
  console.log(`  ${paths.outJson}\n  ${paths.outCsv}`);
}

build();
