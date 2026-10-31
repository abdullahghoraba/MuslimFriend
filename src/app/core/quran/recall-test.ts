/**
 * "Test yourself" for memorisation: the text is hidden and revealed one piece at a time as the reader recites it,
 * and every piece they got wrong is marked. Pure state, used for ayat (hifz) and for hadith.
 */

/** 'words': every word hidden; 'first': each word's first letter shown as a hint; 'whole': each ayah hidden at once. */
export type RecallMode = 'words' | 'first' | 'whole';

/** A passage to recite: an ayah or a hadith. */
export interface RecallSegment {
  /** Shown beside the passage, e.g. the ayah number. */
  label: string;
  text: string;
}

/** One piece the reader reveals: a word, or a whole segment in 'whole' mode. */
export interface RecallUnit {
  segment: number;
  text: string;
  /** The visible hint in 'first' mode (the first letter with its marks). */
  hint: string;
}

const LETTER = /[\p{L}]/u;

/**
 * The words of a text. Waqf signs and other marks that stand alone (ۚ ۖ ۗ ۛ) belong to the word before them, so a
 * hidden word never reveals a lone sign.
 */
export function recallWords(text: string): string[] {
  const words: string[] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    if (!LETTER.test(token) && words.length) words[words.length - 1] += ' ' + token;
    else words.push(token);
  }
  return words;
}

/** The first letter of a word with the marks written on it, e.g. "ٱلْ" → "ٱ" (Arabic marks follow their letter). */
export function firstLetter(word: string): string {
  const chars = [...word];
  const start = chars.findIndex((c) => LETTER.test(c));
  if (start < 0) return '';
  let end = start + 1;
  while (end < chars.length && /\p{M}/u.test(chars[end])) end++;
  return chars.slice(0, end).join('');
}

export function recallUnits(segments: RecallSegment[], mode: RecallMode): RecallUnit[] {
  return segments.flatMap((s, segment) =>
    mode === 'whole'
      ? [{ segment, text: s.text.trim(), hint: '' }]
      : recallWords(s.text).map((text) => ({ segment, text, hint: mode === 'first' ? firstLetter(text) : '' })),
  );
}

/** Reveal state of a test. Units are revealed in reading order; a tapped unit can be revealed out of order. */
export class RecallTest {
  readonly units: RecallUnit[];
  readonly revealed = new Set<number>();
  readonly mistakes = new Set<number>();
  /** The unit revealed last, which "I got it wrong" marks. */
  last: number | null = null;

  constructor(readonly segments: RecallSegment[], readonly mode: RecallMode) {
    this.units = recallUnits(segments, mode);
  }

  /** The first unit still hidden, or -1 when everything is shown. */
  get next(): number {
    for (let i = 0; i < this.units.length; i++) if (!this.revealed.has(i)) return i;
    return -1;
  }

  get done(): boolean {
    return this.revealed.size === this.units.length;
  }

  reveal(i: number): void {
    if (i < 0 || i >= this.units.length) return;
    this.revealed.add(i);
    this.last = i;
  }

  revealNext(): void {
    this.reveal(this.next);
  }

  /** Reveals the rest of the segment the next hidden unit is in (the rest of the ayah). */
  revealSegment(): void {
    const n = this.next;
    if (n < 0) return;
    const segment = this.units[n].segment;
    this.units.forEach((u, i) => u.segment === segment && this.reveal(i));
  }

  revealAll(): void {
    this.units.forEach((_, i) => this.revealed.add(i));
  }

  /** Marks the last revealed unit as a mistake, or unmarks it. */
  toggleMistake(i = this.last ?? -1): void {
    if (!this.revealed.has(i)) return;
    if (this.mistakes.has(i)) this.mistakes.delete(i);
    else this.mistakes.add(i);
  }

  /** The segments (ayat) with at least one mistake, for reviewing them again. */
  get weakSegments(): number[] {
    return [...new Set([...this.mistakes].map((i) => this.units[i].segment))].sort((a, b) => a - b);
  }

  reset(): void {
    this.revealed.clear();
    this.mistakes.clear();
    this.last = null;
  }
}
