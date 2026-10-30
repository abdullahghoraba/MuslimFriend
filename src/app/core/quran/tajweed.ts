// Colour tajweed: quran.com's tajweed markup, moved onto the app's own (Tanzil) text.

/** One run of tajweed text: [rule] is a quran.com tajweed class (e.g. 'ghunnah', 'madda_necessary') or none. */
export interface TajweedPart {
  text: string;
  rule?: string;
}

export const TAJWEED_RULES = [
  'ham_wasl', 'laam_shamsiyah', 'slnt', 'madda_normal', 'madda_permissible', 'madda_obligatory', 'madda_necessary', 'qalaqah',
  'ikhafa', 'ikhafa_shafawi', 'iqlab', 'idgham_ghunnah', 'idgham_wo_ghunnah', 'idgham_shafawi', 'idgham_mutajanisayn',
  'idgham_mutaqaribayn', 'ghunnah',
] as const;

/**
 * Splits quran.com's tajweed markup (`<tajweed class=ghunnah>نّ</tajweed>`) into plain runs. Only the text is kept
 * (rendered as text, never as HTML) and only known rule names become classes.
 */
export function tajweedParts(markup: string): TajweedPart[] {
  const parts: TajweedPart[] = [];
  const re = /<tajweed class=([a-z_]+)>([^<]*)<\/tajweed>|<span class=end>[^<]*<\/span>|<[^>]*>|([^<]+)/g;
  for (const m of markup.matchAll(re)) {
    if (m[2] !== undefined) {
      const rule = (TAJWEED_RULES as readonly string[]).includes(m[1]) ? m[1] : undefined;
      parts.push(rule ? { text: m[2], rule } : { text: m[2] });
    } else if (m[3] !== undefined) {
      parts.push({ text: m[3] });
    }
  }
  // Drop the trailing space before the removed ayah number.
  const last = parts[parts.length - 1];
  if (last && !last.rule) last.text = last.text.replace(/\s+$/, '');
  return parts.filter((p) => p.text);
}

const isMark = (c: string) => /\p{M}/u.test(c);
const TATWEEL = 'ـ';
/** One letter class per spelling variant, to line up two encodings of the same word (hamza seats, alef forms...). */
const letterClass = (c: string): string =>
  /[اأإآٱٲ]/.test(c) ? 'ا' : /[ىيئٮ]/.test(c) ? 'ي' : /[وؤ]/.test(c) ? 'و' : /[ةه]/.test(c) ? 'ه' : c;

/** A letter with its marks (one grapheme), and the tajweed rule that colours it. */
interface Cluster {
  text: string;
  rule?: string;
}

/** Splits a word into letter clusters; a tatweel and its marks join the letter before it. */
function clusters(runs: TajweedPart[]): Cluster[] {
  const out: Cluster[] = [];
  for (const run of runs) {
    for (const ch of run.text) {
      const c = ch === 'ٲ' ? 'ٰ' : ch; // this encoding writes the dagger alef as a letter
      const prev = out[out.length - 1];
      if (prev && (isMark(c) || c === TATWEEL || c === '‌')) {
        prev.text += c;
        prev.rule ??= run.rule;
      } else {
        out.push({ text: c, rule: run.rule });
      }
    }
  }
  return out;
}

/** Words of runs, split on spaces; words without a letter (pause marks between words) are dropped. */
function words(runs: TajweedPart[]): TajweedPart[][] {
  const result: TajweedPart[][] = [[]];
  for (const run of runs) {
    run.text.split(/(\s+)/).forEach((piece, i) => {
      if (i % 2 === 1) result.push([]);
      else if (piece) result[result.length - 1].push({ text: piece, rule: run.rule });
    });
  }
  return result.filter((w) => w.some((r) => [...r.text].some((c) => !isMark(c) && c !== TATWEEL && c !== '‌')));
}

/**
 * Colours [text] (the app's Tanzil text, shown verbatim) with the tajweed rules of quran.com's markup for the same
 * ayah. The two use different encodings, so rules move over word by word, letter by letter, by letter class; a word
 * whose letters do not line up stays uncoloured rather than risk a wrong colour. Returns null if the words differ.
 */
export function alignTajweed(text: string, markup: string): TajweedPart[] | null {
  const tj = words(tajweedParts(markup));
  const own = words([{ text }]);
  if (tj.length !== own.length) return null;
  // Rule of each Tanzil letter cluster, in reading order.
  const rules: (string | undefined)[] = [];
  own.forEach((w, i) => {
    const a = clusters(tj[i]);
    const b = clusters(w);
    const same = a.length === b.length && a.every((c, k) => letterClass(c.text[0]) === letterClass(b[k].text[0]));
    for (let k = 0; k < b.length; k++) rules.push(same ? a[k].rule : undefined);
  });
  // Walk the text again, attaching each cluster's rule (spaces and pause marks between words stay plain).
  const parts: TajweedPart[] = [];
  const push = (s: string, rule?: string) => {
    const last = parts[parts.length - 1];
    if (last && last.rule === rule) last.text += s;
    else parts.push(rule ? { text: s, rule } : { text: s });
  };
  let next = 0;
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    const wordClusters = /\s/.test(word[0]) ? null : clusters([{ text: word }]);
    const hasLetter = wordClusters?.some((c) => !isMark(c.text[0]) && c.text[0] !== TATWEEL);
    if (!wordClusters || !hasLetter) {
      push(word);
      continue;
    }
    for (const c of wordClusters) push(c.text, rules[next++]);
  }
  return parts;
}
