import text from '../../../../public/assets/quran/text.json';
import meta from '../../../../public/assets/quran/meta.json';
import { BASMALA, splitBasmala } from './quran-utils';

describe('basmala against the Tanzil text', () => {
  it('equals Al-Fatiha 1:1 exactly', () => {
    expect((text as string[])[0]).toBe(BASMALA);
  });

  it('is split off the first ayah of every sura except 1 and 9', () => {
    const suras = (meta as { suras: { index: number; start: number }[] }).suras;
    for (const s of suras) {
      const first = (text as string[])[s.start];
      const split = splitBasmala({ sura: s.index, aya: 1 }, first);
      expect(split.basmala).toBe(s.index !== 1 && s.index !== 9);
      // Display only: the two parts rejoin to exactly the Tanzil text.
      if (split.basmala) expect(`${split.basmalaText} ${split.text}`).toBe(first);
    }
  });
});
