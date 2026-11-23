import { TajweedError, leftOut, parseEvents, pauseArtifact, unsureFinding, voicedEdge, weakFinding, quietestIn, silenceIn, silentBetween, splitAtPauses, wavBase64 } from './tajweed.service';

describe('tajweed: sending a phrase', () => {
  it('writes 16 kHz mono 16-bit WAV', () => {
    const samples = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 10) * 0.5);
    const bytes = Uint8Array.from(atob(wavBase64(samples)), (c) => c.charCodeAt(0));
    const v = new DataView(bytes.buffer);
    const text = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(3200);
    expect(bytes.length).toBe(44 + 3200);
    expect(v.getInt16(44 + 2 * 16, true) / 0x7fff).toBeCloseTo(samples[16], 3);
  });

  it('clips samples beyond full scale instead of wrapping around', () => {
    const bytes = Uint8Array.from(atob(wavBase64(Float32Array.from([2, -2]))), (c) => c.charCodeAt(0));
    const v = new DataView(bytes.buffer);
    expect(v.getInt16(44, true)).toBe(0x7fff);
    expect(v.getInt16(46, true)).toBe(-0x7fff);
  });
});

describe('tajweed: reading the server reply', () => {
  it('takes the result of the "complete" event, and fails on "error"', () => {
    const ok = ['event: heartbeat', 'data: null', '', 'event: complete', 'data: [{"results": [{"errors": []}, null]}]', ''].join('\n');
    expect(parseEvents(ok).results?.length).toBe(2);
    expect(() => parseEvents(['event: error', 'data: "quota"', ''].join('\n'))).toThrow();
    expect(() => parseEvents('')).toThrow();
  });
});

// Findings the tajweed server returned on real recitations (Husary and Minshawi in Hafs; al-Dosary in Warsh).
const err = (type: TajweedError['type'], kind: TajweedError['kind'], expected: string, heard: string, rules: string[] = []): TajweedError =>
  ({ aya: 1, word: 0, text: '', type, kind, expected, heard, rules: rules.map((ar) => ({ ar, en: '' })) });

describe('tajweed: pausing in the middle of an ayah is not a mistake', () => {
  it('a stop: the last letter without its vowel, a madd made long, an idgham not made, the next word heard', () => {
    expect(pauseArtifact(err('tashkeel', 'delete', 'تِ', 'ت'), 'تَفَـٰوُتٍۢ ۖ', 'فَٱرْجِعِ')).toBe(true);
    expect(pauseArtifact(err('tashkeel', 'replace', 'بَ', 'بڇ'), 'رَيْبَ ۛ', 'فِيهِ')).toBe(true);
    expect(pauseArtifact(err('tashkeel', 'delete', 'نِ', 'ن'), 'لِّلشَّيَـٰطِينِ ۖ', 'وَأَعْتَدْنَا')).toBe(true);
    expect(pauseArtifact(err('tashkeel', 'delete', 'وووَ', 'وَ'), 'عَمَلًۭا ۚ', 'وَهُوَ')).toBe(true);
    expect(pauseArtifact(err('tashkeel', 'delete', 'ممممَ', 'مَ'), 'مَّا', 'تَرَىٰ')).toBe(true);
    expect(pauseArtifact(err('tashkeel', 'insert', 'هِ', 'ههُ'), 'فِيهِ ۛ', 'هُدًۭى')).toBe(true);
    expect(pauseArtifact(err('tajweed', 'replace', 'ۦۦ', 'ۦۦۦۦ', ['المد الطبيعي']), 'فِيهِ ۛ', 'هُدًۭى')).toBe(true);
  });

  it('real mistakes stay: a vowel added, a madd left out, another vowel, a stop that was not one', () => {
    // Warsh read against Hafs: silat al-mim, «مَلِك» without its madd, naql of the hamza's vowel.
    expect(pauseArtifact(err('tashkeel', 'insert', 'م', 'مُ'), 'لِيَبْلُوَكُمْ', 'أَيُّكُمْ')).toBe(false);
    expect(pauseArtifact(err('tajweed', 'delete', 'اا', ''), 'مَـٰلِكِ', 'يَوْمِ')).toBe(false);
    expect(pauseArtifact(err('tajweed', 'replace', 'بڇ', 'بِ', ['القلقلة']), 'يَنقَلِبْ', 'إِلَيْكَ')).toBe(false);
    // A different vowel on the last letter (an i'rab mistake) is not a pause.
    expect(pauseArtifact(err('tashkeel', 'replace', 'دُ', 'دَ'), 'ٱلْحَمْدُ', 'لِلَّهِ')).toBe(false);
    // A madd made long in the middle of a word is not madd 'arid.
    expect(pauseArtifact(err('tajweed', 'replace', 'اا', 'اااا', ['المد الطبيعي']), 'كِتَـٰبَهُۥ', 'بِيَمِينِهِۦ')).toBe(false);
  });
});

describe('tajweed: a phrase is cut where the reciter paused', () => {
  it('cuts at a long enough gap between two words, in the middle of the gap', () => {
    // 100 output frames for 4 s of audio (640 samples a frame): words at 0-10, 12-20 | 45-60, 62-90.
    const parts = splitAtPauses([{ start: 0, end: 10 }, { start: 12, end: 20 }, { start: 45, end: 60 }, { start: 62, end: 90 }], 100, 64000);
    expect(parts).toEqual([
      { from: 0, to: Math.round(32.5 * 640), first: 0, last: 1 },
      { from: Math.round(32.5 * 640), to: 64000, first: 2, last: 3 },
    ]);
  });

  it('keeps a phrase read in one breath whole', () => {
    expect(splitAtPauses([{ start: 0, end: 10 }, { start: 13, end: 20 }], 50, 32000)).toEqual([{ from: 0, to: 32000, first: 0, last: 1 }]);
    expect(splitAtPauses([], 50, 32000)).toEqual([]);
  });

  it('cuts a long ayah read in one breath at its widest gaps until every part fits the server (20 s)', () => {
    // 41 s, one frame a sample: ten 3.9 s words 0.1 s apart (no pause), the widest gap (0.25 s) after the fourth.
    const sec = 16000;
    const words = Array.from({ length: 10 }, (_, i) => {
      const start = i * 4 * sec + (i >= 4 ? 0.15 * sec : 0);
      return { start, end: start + 3.9 * sec };
    });
    const parts = splitAtPauses(words, 41 * sec, 41 * sec, 0.3, 18 * sec);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.to - p.from).toBeLessThanOrEqual(18 * sec);
    // Every word in exactly one part, in order, and the parts cover the audio end to end.
    expect(parts.map((p) => [p.first, p.last]).flat()).toEqual(parts.flatMap((p, i) => [i ? parts[i - 1].last + 1 : 0, p.last]));
    expect(parts[parts.length - 1].last).toBe(9);
    parts.forEach((p, i) => i && expect(p.from).toBe(parts[i - 1].to));
    // The first cut is at the widest gap (between the fourth and fifth word).
    expect(parts[0].last).toBe(3);
  });
});

describe('tajweed: a pause is a real silence', () => {
  // 3 s: voice, then 0.4 s of near silence at 1.0-1.4 s, then a quiet madd (a fifth of the voice) at 2.0-2.4 s.
  const audio = Float32Array.from({ length: 48000 }, (_, i) => {
    const t = i / 16000;
    const amp = t >= 1 && t < 1.4 ? 0.001 : t >= 2 && t < 2.4 ? 0.06 : 0.3;
    return amp * Math.sin(i / 5);
  });

  it('finds the silence, and not a soft sound the recogniser left between two words', () => {
    expect(silentBetween(audio, 0.9 * 16000, 1.5 * 16000)).toBe(true);
    expect(silentBetween(audio, 1.9 * 16000, 2.5 * 16000)).toBe(false);
    expect(silentBetween(audio, 0.2 * 16000, 0.8 * 16000)).toBe(false);
  });

  it('cuts a phrase only where the gap between two words is silent', () => {
    const sec = 16000;
    const words = [{ start: 0, end: 0.9 * sec }, { start: 1.5 * sec, end: 1.9 * sec }, { start: 2.5 * sec, end: 3 * sec }];
    const parts = splitAtPauses(words, 3 * sec, 3 * sec, 0.3, Infinity, (a, b) => silentBetween(audio, a, b));
    expect(parts.map((p) => [p.first, p.last])).toEqual([[0, 0], [1, 2]]);
  });

  it('cuts in the silence, not in the middle of the gap the recogniser left (a word sounds on after its last letter)', () => {
    const sec = 16000;
    // The first word's last letter was marked at 0.5 s, but its sound goes on to 1.0 s; silence at 1.0-1.4 s.
    const at = silenceIn(audio, 0.5 * sec, 1.5 * sec);
    expect(at / sec).toBeGreaterThan(1.1);
    expect(at / sec).toBeLessThan(1.3);
    expect(silenceIn(audio, 1.9 * sec, 2.5 * sec)).toBe(-1);
    const words = [{ start: 0, end: 0.5 * sec }, { start: 1.5 * sec, end: 1.9 * sec }];
    const parts = splitAtPauses(words, 3 * sec, 3 * sec, 0.3, Infinity, (a, b) => silenceIn(audio, a, b));
    expect(parts[0].to).toBe(at);
    expect(quietestIn(audio, 0.5 * sec, 1.5 * sec) / sec).toBeGreaterThan(1);
    expect(quietestIn(audio, 0.5 * sec, 1.5 * sec) / sec).toBeLessThan(1.4);
  });
});

describe('tajweed: a word left out, which the offline recogniser wrote anyway', () => {
  // What the server found missing in Husary's al-Fatihah 7 with words cut out of it.
  it('every sounded letter of the word missing', () => {
    expect(leftOut('غَيْرِ', ['غَ', 'ي', 'رِ'])).toBe(true);
    expect(leftOut('وَلَا', ['وَ', 'لَ'])).toBe(true);
    expect(leftOut('ٱلضَّآلِّينَ', ['ضضَ', 'اااااا', 'للِ', 'ۦۦۦۦ', 'ن'])).toBe(true);
    expect(leftOut('ٱلَّذِينَ', ['للَ', 'ذِ', 'ۦۦ', 'نَ'])).toBe(true);
  });

  it('a letter or a vowel lost (a stop, a quick reading) is not a word left out', () => {
    expect(leftOut('قُلْ', ['قُ'])).toBe(false);
    expect(leftOut('وَمِن', ['وَ'])).toBe(false);
    expect(leftOut('إِلَّا', ['ءِ'])).toBe(false);
    expect(leftOut('أَنتُمْ', ['ءَ'])).toBe(false);
    expect(leftOut('خَزَنَتُهَآ', ['تُ', 'اااا'])).toBe(false);
    expect(leftOut('و', ['وَ'])).toBe(false);
  });
});

describe('tajweed: what the model is not sure of is not shown', () => {
  const madd = (expectedLen: number, heardLen: number): TajweedError => ({ ...err('tajweed', 'replace', 'ۥۥ', 'ۥ', ['المد الطبيعي']), expectedLen, heardLen });
  // A reader reciting al-Baqarah 26-29 at a normal pace.
  it('the vowel of the first letter of a word, a natural madd one count short', () => {
    expect(unsureFinding(err('tashkeel', 'delete', 'عَ', 'ع'), 'عَهْدَ')).toBe(true);
    expect(unsureFinding(err('tashkeel', 'delete', 'ءَ', 'ء'), 'أَن')).toBe(true);
    expect(unsureFinding(err('tashkeel', 'delete', 'يُ', 'ي'), 'يُضِلُّ')).toBe(true);
    expect(unsureFinding(madd(2, 1), 'وَيَقْطَعُونَ')).toBe(true);
  });
  it('real mistakes stay: another vowel, a madd not made, a vowel lost inside the word', () => {
    expect(unsureFinding(err('tashkeel', 'replace', 'دُ', 'دَ'), 'ٱلْحَمْدُ')).toBe(false);
    expect(unsureFinding(madd(2, 0), 'مَـٰلِكِ')).toBe(false);
    expect(unsureFinding({ ...err('tajweed', 'replace', 'اااا', 'اا', ['المد المتصل']), expectedLen: 4, heardLen: 2 }, 'أُو۟لَـٰٓئِكَ')).toBe(false);
    expect(unsureFinding(err('tashkeel', 'delete', 'تُ', 'ت'), 'خَزَنَتُهَآ')).toBe(false);
  });
});

describe('tajweed: what the model gets wrong on a phone is not shown', () => {
  const madd = (rule: string, expected: string, heard: string, expectedLen: number, heardLen: number): TajweedError =>
    ({ ...err('tajweed', 'replace', expected, heard, [rule]), expectedLen, heardLen });
  // Findings on a reader reciting al-Baqarah correctly into a phone.
  it('a vowel not heard or added, qalqalah, a length heard at least half, a natural madd not made', () => {
    expect(weakFinding(err('tashkeel', 'delete', 'هِ', 'ه'), 'رَّبِّهِمْ')).toBe(true);
    expect(weakFinding(err('tashkeel', 'insert', 'م', 'مُ'), 'إِنَّهُمْ')).toBe(true);
    expect(weakFinding(err('tashkeel', 'delete', 'ممممَ', 'مممَ'), 'ثُمَّ')).toBe(true);
    expect(weakFinding(err('tajweed', 'replace', 'بڇ', 'ب', ['القلقلة']), 'سَبْعَ')).toBe(true);
    expect(weakFinding(madd('المد المنفصل', 'اااا', 'اا', 4, 2), 'مَاذَآ')).toBe(true);
    expect(weakFinding(err('tajweed', 'delete', 'ۦۦ', ''), 'ٱلَّذِينَ')).toBe(true);
    expect(weakFinding(err('tajweed', 'delete', 'ممممَ', 'مممَ'), 'ءَامَنَّا')).toBe(true);
    expect(weakFinding(err('tajweed', 'insert', 'وَ', 'ووَ'), 'وَعَلَىٰٓ')).toBe(true);
    // The hamzat al-wasl's vowel depends on where the reader started.
    expect(weakFinding(err('tashkeel', 'replace', 'ءَ', 'ءِ'), 'ٱللَّهَ')).toBe(true);
  });
  it('real mistakes stay: another vowel, a madd cut to less than half, a long madd not made', () => {
    expect(weakFinding(err('tashkeel', 'replace', 'دُ', 'دَ'), 'ٱلْحَمْدُ')).toBe(false);
    expect(weakFinding(err('tashkeel', 'replace', 'نِ', 'نَ'), 'ٱلرَّحْمَـٰنِ')).toBe(false);
    expect(weakFinding(madd('المد اللازم', 'اااااا', 'اا', 6, 2), 'ٱلضَّآلِّينَ')).toBe(false);
    expect(weakFinding(madd('المد المتصل', 'اااا', 'ا', 4, 1), 'ٱلسَّمَآءِ')).toBe(false);
    expect(weakFinding(madd('المد الطبيعي', 'اا', '', 2, 0), 'مَـٰلِكِ')).toBe(false);
    expect(weakFinding(err('tajweed', 'delete', 'اااا', ''), 'كُلَّمَآ')).toBe(false);
  });
});

describe('tajweed: a phrase cut while the voice goes on', () => {
  const tone = (n: number) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i / 3));
  it('is found at the edge where the voice is still sounding, not where it was quiet', () => {
    const a = new Float32Array(16000);
    a.set(tone(12000), 4000); // quiet first quarter, voice to the end
    expect(voicedEdge(a, 'start')).toBe(false);
    expect(voicedEdge(a, 'end')).toBe(true);
  });
});
