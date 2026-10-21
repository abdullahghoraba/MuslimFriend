import {
  activityStreak,
  dueAyahs,
  enumerateRange,
  HifzAyah,
  newPortion,
  REVIEW_INTERVALS,
  reviewSchedule,
} from './hifz-utils';
describe('hifz helpers', () => {
  const counts = [3, 4, 2];
  it('enumerates inclusive ranges across suras and the entire Quran', () => {
    expect(enumerateRange(counts, { sura: 1, aya: 3 }, { sura: 3, aya: 1 })).toEqual([
      { sura: 1, aya: 3 },
      { sura: 2, aya: 1 },
      { sura: 2, aya: 2 },
      { sura: 2, aya: 3 },
      { sura: 2, aya: 4 },
      { sura: 3, aya: 1 },
    ]);
    expect(enumerateRange(counts)).toHaveLength(9);
    expect(enumerateRange(counts, { sura: 2, aya: 4 }, { sura: 2, aya: 4 })).toHaveLength(1);
  });
  it('rejects reversed and invalid bounds', () => {
    expect(() => enumerateRange(counts, { sura: 2, aya: 1 }, { sura: 1, aya: 1 })).toThrow();
    expect(() => enumerateRange(counts, { sura: 1, aya: 4 })).toThrow();
    expect(() => enumerateRange(counts, { sura: 0, aya: 1 })).toThrow();
  });
  it('skips both learning and memorized ayahs for the new portion', () => {
    const range = enumerateRange(counts);
    expect(newPortion(range, [range[0], range[2]], 3)).toEqual([range[1], range[3], range[4]]);
    expect(newPortion(range, range, 5)).toEqual([]);
  });
  it('advances, caps, and resets review intervals across month boundaries', () => {
    const day = new Date(2026, 0, 31, 18);
    expect(REVIEW_INTERVALS).toEqual([1, 3, 7, 14, 30, 60]);
    expect(reviewSchedule(0, 'good', day)).toEqual({ step: 1, nextReview: '2026-02-03' });
    expect(reviewSchedule(5, 'good', day)).toEqual({ step: 5, nextReview: '2026-04-01' });
    expect(reviewSchedule(4, 'hard', day)).toEqual({ step: 0, nextReview: '2026-02-01' });
  });
  it('includes overdue and today, excluding learning and future reviews', () => {
    const row: HifzAyah = {
      planId: 1,
      sura: 1,
      aya: 1,
      status: 'memorized',
      memorizedOn: '2026-01-01',
      lastReview: null,
      nextReview: '2026-01-03',
      reviews: 0,
      step: 0,
    };
    expect(
      dueAyahs(
        [
          row,
          { ...row, aya: 2, nextReview: '2026-01-04' },
          { ...row, aya: 3, status: 'learning' },
          { ...row, aya: 4, nextReview: null },
        ],
        '2026-01-03',
      ),
    ).toEqual([{ sura: 1, aya: 1 }]);
  });
  it('counts consecutive active days from today or yesterday', () => {
    const day = new Date(2026, 0, 4);
    expect(activityStreak(['2026-01-03', '2026-01-02', '2026-01-02'], day)).toBe(2);
    expect(activityStreak(['2026-01-01'], day)).toBe(0);
    expect(activityStreak(['2026-01-04', '2026-01-03'], day)).toBe(2);
  });
});
