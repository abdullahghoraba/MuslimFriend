import { Reading, cutsToReread, onlyAdds, readPhrase } from './qasr-split';

const sec = 16000;
/** Audio with voice in the given seconds and near silence elsewhere. */
function audioOf(seconds: number, voice: [number, number][]): Float32Array {
  return Float32Array.from({ length: seconds * sec }, (_, i) => {
    const t = i / sec;
    return (voice.some(([a, b]) => t >= a && t < b) ? 0.3 : 0.001) * Math.sin(i / 5);
  });
}
const span = (a: number, b: number) => ({ start: a * sec, end: b * sec });

describe('qasr: recitation the model left without a word', () => {
  it('finds a stretch of voice after the stop that follows the last word', () => {
    // «...وبئس المصير» then a stop, then «إذا ألقوا فيها» that came back as part of «المصير».
    const audio = audioOf(12, [[0.2, 5], [5, 6.5], [8, 11.8]]);
    const cuts = cutsToReread(audio, [span(0.2, 4.9), span(5, 11.9)]);
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts[0].at / sec).toBeGreaterThan(6.5);
    expect(cuts[0].at / sec).toBeLessThan(8);
  });

  it('finds the ayah before the first word (the basmala before al-Hamd)', () => {
    const audio = audioOf(9, [[0.6, 4], [4.3, 9]]);
    const cuts = cutsToReread(audio, [span(4.3, 5), span(5.2, 9)]);
    expect(cuts[0].at / sec).toBeGreaterThan(3.9);
    expect(cuts[0].at / sec).toBeLessThan(4.3);
  });

  it('leaves a madd fading into a stop, and a phrase read whole, alone', () => {
    // The madd of «الضالين» ends at 6.1 s; the reading stretched the word over the silence after it.
    expect(cutsToReread(audioOf(9, [[0.1, 4.9], [5, 6.1]]), [span(0.1, 4.9), span(5, 9)])).toEqual([]);
    expect(cutsToReread(audioOf(4, [[0.3, 1], [1.3, 3.8]]), [span(0.3, 1), span(1.3, 3.8)])).toEqual([]);
  });
});

describe('qasr: a re-read is taken only when it adds words', () => {
  it('takes words added where there were none, keeping those already read', () => {
    expect(onlyAdds(['للذين', 'وبيس'], [], ['للذين', 'وبيس', 'المصير'], ['اذا', 'القوا', 'فيها'], 'المصر')).toBe(true);
    expect(onlyAdds([], ['الحمد', 'لله'], ['بسم', 'الله', 'الرحمن', 'الرحيم'], ['الحمد', 'لله'])).toBe(true);
  });

  it('refuses words made up from a short piece, which change the words already read', () => {
    // The end of «إذا وقب» read alone came back as «لم يلد ولم يولد», and «إذا» as «الله».
    expect(onlyAdds(['اذا', 'وقب'], [], ['الله', 'وقب'], ['لم', 'يلد', 'ولم', 'يولد'])).toBe(false);
    // Only the word cut in two read again (another spelling and a scrap): nothing added.
    expect(onlyAdds(['اهدنا'], [], ['اهدنا', 'المستقيم'], ['تق'], 'المستقيم')).toBe(false);
  });

  it('joins the two readings with the frames of the second after the first', async () => {
    const audio = audioOf(9, [[0.6, 4], [4.3, 9]]);
    const reading = (words: [string, number, number][], frames: number): Reading => ({
      text: words.map((w) => w[0]).join(' '),
      words: words.map(([text, start, end]) => ({ text, start, end })),
      lp: new Float32Array(frames * 2),
      frames,
      vocab: 2,
    });
    // 25 frames a second: the whole phrase came back as al-Hamd only, each side read alone as its own ayah.
    const read = async (a: Float32Array) => {
      const s = a.length / sec;
      if (s > 8) return reading([['الحمد', 108, 125], ['لله', 130, 225]], Math.round(s * 25));
      if (s < 4.5) return reading([['بسم', 15, 30], ['الله', 35, 100]], Math.round(s * 25));
      return reading([['الحمد', 2, 20], ['لله', 25, 120]], Math.round(s * 25));
    };
    const r = await readPhrase(audio, read);
    expect(r.words.map((w) => w.text)).toEqual(['بسم', 'الله', 'الحمد', 'لله']);
    expect(r.words[2].start).toBeGreaterThan(100);
    expect(r.lp.length).toBe(r.frames * 2);
  });
});

describe('qasr: a phrase cut for its length', () => {
  it('its last word, begun in the stretch the next phrase starts with, is left to the next phrase', async () => {
    const { trimCut } = await import('./quran-speech');
    // 12 s, 25 frames a second; the next phrase starts with the last 3 s (from 9 s, frame 225).
    const words = [{ text: 'واما', start: 10, end: 40 }, { text: 'الذين', start: 200, end: 230 }, { text: 'ا', start: 290, end: 299 }];
    const d = { text: 'واما الذين ا', words, lp: new Float32Array(300 * 2), frames: 300, vocab: 2 };
    const t = trimCut(d, 12 * 16000);
    expect(t.data.words!.map((w) => w.text)).toEqual(['واما', 'الذين']);
    expect(t.data.frames).toBeGreaterThan(230);
    expect(t.data.frames).toBeLessThan(290);
    expect(t.data.lp!.length).toBe(t.data.frames! * 2);
    expect(t.keep).toBe(Math.round(t.data.frames! * 640));
    expect(t.skip).toBe(t.keep - 9 * 16000);
  });

  it('takes off every word begun in that stretch: a word cut in two is often written as several pieces', async () => {
    const { trimCut } = await import('./quran-speech');
    // «يعلم ما بين ايدي ي ه»: the cut fell in «أيديهم», written «ايدي ي ه».
    const words = [{ text: 'يعلم', start: 150, end: 170 }, { text: 'ايدي', start: 240, end: 262 }, { text: 'ي', start: 268, end: 272 }, { text: 'ه', start: 290, end: 299 }];
    const t = trimCut({ text: '', words, lp: new Float32Array(600), frames: 300, vocab: 2 }, 12 * 16000);
    expect(t.data.words!.map((w) => w.text)).toEqual(['يعلم']);
    expect(t.data.frames).toBeGreaterThanOrEqual(225);
    expect(t.data.frames).toBeLessThan(240);
    expect(t.skip).toBe(t.keep - 9 * 16000);
  });

  it('the phrase after a cut, read with the words before it as context, keeps only its own words', async () => {
    const { trimLead } = await import('./quran-speech');
    // 6 s read (150 frames), of which the first 2 s (50 frames) are the end of the cut phrase: «لدنه» there.
    const words = [{ text: 'لدنه', start: 20, end: 45 }, { text: 'ويبشر', start: 55, end: 80 }, { text: 'المؤمنين', start: 90, end: 140 }];
    const d = trimLead({ text: '', words, lp: new Float32Array(150 * 2), frames: 150, vocab: 2 }, 2 * 16000, 6 * 16000);
    expect(d.words!.map((w) => w.text)).toEqual(['ويبشر', 'المؤمنين']);
    expect(d.words![0].start).toBe(5);
    expect(d.frames).toBe(100);
    expect(d.lp!.length).toBe(200);
    expect(d.text).toBe('ويبشر المؤمنين');
  });

  it('a last word begun before that stretch stays (the next phrase does not have its start)', async () => {
    const { trimCut } = await import('./quran-speech');
    const words = [{ text: 'واما', start: 10, end: 40 }, { text: 'الضالين', start: 150, end: 299 }];
    const t = trimCut({ text: '', words, lp: new Float32Array(600), frames: 300, vocab: 2 }, 12 * 16000);
    expect(t.data.words!.length).toBe(2);
    expect(t.skip).toBe(3 * 16000);
  });
});
