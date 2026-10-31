import { REVIEW_DAYS, memoStatus, nextEntry } from './hadith-memo.service';

describe('hadith memorisation schedule', () => {
  const day = new Date(2026, 10, 1);

  it('spaces the reviews out after each one remembered: 1, 3, 7, 14, 30, then every 60 days', () => {
    let e = nextEntry(undefined, true, day);
    const gaps: string[] = [e.due];
    for (let i = 0; i < 6; i++) {
      e = nextEntry(e, true, day);
      gaps.push(e.due);
    }
    expect(gaps).toEqual(['2026-11-02', '2026-11-04', '2026-11-08', '2026-11-15', '2026-12-01', '2026-12-31', '2026-12-31']);
    expect(e.level).toBe(REVIEW_DAYS.length - 1);
  });

  it('starts over tomorrow when forgotten, and counts as memorised from the fifth step', () => {
    expect(nextEntry({ level: 4, due: '2026-11-01' }, false, day)).toEqual({ level: 0, due: '2026-11-02' });
    expect(memoStatus(undefined)).toBe('new');
    expect(memoStatus({ level: 3, due: '' })).toBe('learning');
    expect(memoStatus({ level: 4, due: '' })).toBe('memorized');
  });
});
