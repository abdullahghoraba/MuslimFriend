import { dropOpenings } from './tasmee.service';
import { PhraseSplitter } from './whisper-speech';

describe('tasmee helpers', () => {
  it("drops the isti'adha and basmala said before the ayat, but not al-Fatihah's own basmala", () => {
    const heard = 'أعوذ بالله من الشيطان الرجيم بسم الله الرحمن الرحيم قل هو الله أحد'.split(' ');
    expect(dropOpenings(heard, 'قُلْ هُوَ ٱللَّهُ أَحَدٌ'.split(' '))).toEqual('قل هو الله أحد'.split(' '));
    const fatihah = 'بسم الله الرحمن الرحيم الحمد لله'.split(' ');
    expect(dropOpenings(fatihah, 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ'.split(' '))).toEqual(fatihah);
  });

  it('cuts the microphone into phrases at the pauses between ayat', () => {
    const rate = 16000;
    const frame = (loud: boolean) => Float32Array.from({ length: 1600 }, (_, i) => (loud ? 0.2 * Math.sin(i / 3) : 0.0005));
    const phrases: number[] = [];
    const split = new PhraseSplitter((a) => phrases.push(a.length / rate), rate);
    const play = (loud: boolean, seconds: number) => {
      for (let i = 0; i < seconds * 10; i++) split.push(frame(loud));
    };
    play(false, 1);
    play(true, 3); // first ayah
    play(false, 1.2);
    play(true, 2); // second ayah
    play(false, 0.3); // a short breath inside it does not cut
    play(true, 1);
    play(false, 1.2);
    expect(phrases).toHaveLength(2);
    expect(phrases[0]).toBeGreaterThan(3);
    expect(phrases[0]).toBeLessThan(4.5);
    expect(phrases[1]).toBeGreaterThan(3.2);
  });
});
