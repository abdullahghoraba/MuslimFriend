import { TajweedError, parseEvents, pauseArtifact, splitAtPauses, wavBase64 } from './tajweed.service';

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

// Findings the tajweed server returned on real recitations (Husary, Minshawi, Alafasy in Hafs; al-Dosary in Warsh).
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
});
