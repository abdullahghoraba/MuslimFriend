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
