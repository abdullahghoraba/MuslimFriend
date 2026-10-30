import { dailyCandidates, isGoodDaily } from './daily-online';

describe('online hadith of the day', () => {
  it('alternates al-Bukhari and Muslim and never repeats a hadith for decades', () => {
    const seen = new Set<string>();
    const start = 20_000;
    for (let d = start; d < start + 2 * 7563; d++) {
      const { collection, numbers } = dailyCandidates(d);
      expect(collection).toBe(d % 2 === 0 ? 'bukhari' : 'muslim');
      const key = `${collection}:${numbers[0]}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      for (const n of numbers) expect(n >= 1 && n <= 7563).toBe(true);
    }
  });

  it('gives tomorrow a different hadith than today', () => {
    expect(dailyCandidates(20_001)).not.toEqual(dailyCandidates(20_000));
    expect(dailyCandidates(20_002).numbers[0]).not.toBe(dailyCandidates(20_000).numbers[0]);
  });

  it('skips chains without the Prophet\'s words, and very long texts', () => {
    const words = 'عَنْ أَبِي هُرَيْرَةَ ـ رضى الله عنه ـ قَالَ قَالَ رَسُولُ اللَّهِ صلى الله عليه وسلم ' + '«مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ فَلاَ يُؤْذِ جَارَهُ»';
    expect(isGoodDaily('حَدَّثَنَا قُتَيْبَةُ بْنُ سَعِيدٍ، حَدَّثَنَا أَبُو الأَحْوَصِ، عَنْ أَبِي حَصِينٍ، ' + words)).toBe(true);
    expect(isGoodDaily('وَحَدَّثَنَاهُ أَبُو بَكْرِ بْنُ أَبِي شَيْبَةَ، حَدَّثَنَا وَكِيعٌ، عَنْ سُفْيَانَ، بِهَذَا الإِسْنَادِ مِثْلَهُ وَقَالَ رَسُولُ اللَّهِ صلى الله عليه وسلم')).toBe(false);
    expect(isGoodDaily(words.repeat(12))).toBe(false);
  });

});
