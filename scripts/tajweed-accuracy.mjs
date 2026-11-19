// Usage: node scripts/tajweed-accuracy.mjs [1:1,1:2,...]   (CHROME_PATH=... to use a given Chrome for decoding)
// Accuracy of the harakat / tajweed check: correct Hafs recitations (mistakes flagged = false alarms) and Warsh
// recitations of the same ayat (they differ from Hafs in known harakat and madd: these should be caught).
// Each ayah is decoded to 16 kHz mono (as the app sends it) and sent to the tajweed server as the app does.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const URL = 'https://abdullahghoraba-muslim-friend-tajweed.hf.space';
const WORDS = { '1:1': 4, '1:2': 4, '1:3': 2, '1:4': 3, '1:5': 4, '1:6': 3, '1:7': 9, '112:1': 4, '112:2': 2, '112:3': 4, '112:4': 5, '67:1': 9, '67:2': 12, '67:3': 20, '67:4': 10, '67:5': 13, '2:2': 9, '2:3': 8, '2:4': 12, '2:5': 9 };
const RECITERS = {
  'Husary (Hafs)': 'Husary_128kbps',
  'Minshawi (Hafs)': 'Minshawy_Murattal_128kbps',
  'Alafasy (Hafs)': 'Alafasy_128kbps',
  'Ibrahim al-Dosary (Warsh)': 'warsh/warsh_ibrahim_aldosary_128kbps',
};
const AYAT = process.argv[2] ? process.argv[2].split(',') : Object.keys(WORDS);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
await page.goto('about:blank');

async function decode(mp3) {
  const b64 = Buffer.from(mp3).toString('base64');
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(bytes.buffer);
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const out = await off.startRendering();
    const s = out.getChannelData(0);
    const pcm = new Int16Array(s.length);
    for (let i = 0; i < s.length; i++) pcm[i] = Math.max(-1, Math.min(1, s[i])) * 0x7fff;
    let bin = ''; const u8 = new Uint8Array(pcm.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }, b64);
}

function wav(pcmB64) {
  const data = Buffer.from(pcmB64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]).toString('base64');
}

async function check(phrases) {
  const request = JSON.stringify({ phrases, monfasel: 4, mottasel: 4, aared: 4 });
  const start = await fetch(URL + '/gradio_api/call/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [request] }) });
  const { event_id } = await start.json();
  const text = await (await fetch(URL + '/gradio_api/call/check/' + event_id)).text();
  let ev = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('event:')) ev = line.slice(6).trim();
    else if (line.startsWith('data:') && ev === 'complete') return JSON.parse(line.slice(5).trim())[0].results;
    else if (line.startsWith('data:') && ev === 'error') throw new Error(line.slice(5, 300));
  }
  throw new Error('no result');
}

function letters(s) {
  return s
    .replace(/[ً-ٰٟۖ-ۭـۦۥڇ]/g, '')
    .replace(/[ٱأإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ں/g, 'ن')
    .replace(/\s+/g, '');
}

/** Has a vowel (haraka or tanween) on it. */
const voweled = (s) => /[ً-ِ]/.test(s);

/**
 * A finding that is only how a reciter pauses (waqf) in the middle of a phrase, which the server, reading the
 * phrase as one breath, counts as a mistake: the last letter said with sukun (or qalqalah) instead of its vowel,
 * a madd lengthened at the stop ('arid), a ghunnah or idgham with the next word not made across the pause, or the
 * next word's first letter heard at the end of this one. Real mistakes are kept: a different vowel, an added vowel,
 * a missing madd. Checked on recitations by Husary, Minshawi and Alafasy (no false mistakes left) and a Warsh
 * recitation (its differences from Hafs still found).
 */
function pauseArtifact(e, word, next) {
  const w = letters(word);
  const n = next ? letters(next) : '';
  const exp = letters(e.expected ?? '');
  const heard = letters(e.heard ?? '');
  if (e.type === 'tashkeel') {
    // The last letter: its vowel dropped (sukun, or qalqalah on a qalqalah letter) at a stop.
    if (exp.length === 1 && exp === heard && exp === w.slice(-1) && voweled(e.expected) && !voweled(e.heard)) return true;
    // A doubled letter (idgham / ghunnah into the next word) said once: the reciter stopped before that word.
    if (exp.length >= 2 && new Set(exp).size === 1 && heard === exp[0] && (exp[0] === w[0] || exp[0] === n[0])) return true;
    // The next word's first letter heard as part of this word's ending.
    if (e.kind === 'insert' && n && heard.length === exp.length + 1 && heard.startsWith(exp) && heard.slice(-1) === n[0]) return true;
  }
  if (e.type === 'tajweed') {
    const madd = (s) => (s.match(/[ۦۥا]/g) ?? []).length;
    const natural = e.rules?.some((r) => /المد الطبيعي/.test(r.ar)) ?? false;
    // A natural madd made longer on the word's last syllable: madd 'arid at a stop (2, 4 or 6 counts are all right).
    if (natural && madd(e.heard ?? '') > madd(e.expected ?? '') && /[اوي][^اوي]$/.test(w)) return true;
  }
  return false;
}


const QURAN = Object.fromEntries(fs.readFileSync('content/tanzil/quran-uthmani.txt', 'utf8').split(/\r?\n/).filter((l) => /^\d+\|/.test(l)).map((l) => { const [s, a, x] = l.split('|'); let w = []; for (const tok of x.trim().split(/\s+/)) { if (/^[ۖ-ۭ]+$/.test(tok) && w.length) w[w.length - 1] += ' ' + tok; else w.push(tok); } if (a === '1' && s !== '1' && s !== '9') w = w.slice(4); return [s + ':' + a, w]; }));
for (const k of Object.keys(WORDS)) if (QURAN[k]) WORDS[k] = QURAN[k].length;
const summary = {}; const shown = {};
for (const [name, dir] of Object.entries(RECITERS)) {
  const phrases = [];
  for (const a of AYAT) {
    const [s, v] = a.split(':').map(Number);
    const file = String(s).padStart(3, '0') + String(v).padStart(3, '0') + '.mp3';
    const mp3 = await (await fetch(`https://everyayah.com/data/${dir}/${file}`)).arrayBuffer();
    phrases.push({ audio: wav(await decode(mp3)), parts: [[s, v, 0, WORDS[a] - 1]], a });
  }
  const results = [];
  for (let i = 0; i < phrases.length; i += 4) results.push(...(await check(phrases.slice(i, i + 4).map(({ audio, parts }) => ({ audio, parts })))));
  const by = { tashkeel: [], tajweed: [], normal: [] };
  results.forEach((r, i) => {
    if (!r || !Array.isArray(r.errors)) { (by.failed ??= []).push(phrases[i].a); return; }
    for (const e of r.errors) { const ws = QURAN[phrases[i].a]; if (e.type !== 'normal' && !pauseArtifact(e, ws[e.word] ?? '', ws[e.word + 1])) (shown[name] ??= []).push(e.type + ' ' + phrases[i].a + ' w' + e.word + ' «' + (e.wordText ?? '') + '» ' + e.kind + ' 「' + e.expected + '」→「' + e.heard + '」'); }
    for (const e of r.errors) by[e.type]?.push(`${phrases[i].a} w${e.word} «${e.wordText ?? ''}» ${e.kind} expected「${e.expected}」heard「${e.heard}」${e.rules?.map((x) => x.ar).join('، ') ?? ''}`);
  });
  summary[name] = { tashkeel: by.tashkeel.length, tajweed: by.tajweed.length, normal: by.normal.length, failed: by.failed?.length ?? 0 };
  console.log(`\n=== ${name}: ${AYAT.length} ayat, ${AYAT.reduce((n, a) => n + WORDS[a], 0)} words`);
  for (const t of ['tashkeel', 'tajweed', 'normal', 'failed']) if (by[t]?.length) console.log(`  [${t}] ${by[t].length}\n    ` + by[t].join('\n    '));
}
console.log('\nSUMMARY', JSON.stringify(summary, null, 1));
console.log('\nSHOWN TO THE USER (after the pause filter; letter-only findings hidden as in the app):');
for (const n of Object.keys(RECITERS)) console.log(' ' + n + ': ' + (shown[n]?.length ?? 0) + (shown[n] ? '\n   ' + shown[n].join('\n   ') : ''));
await browser.close();
