import { alignRecitation, bestAlternative, heardWords, score, similarity, wordKey } from './align';

// Al-Fatihah 2-4 as written in the mushaf (Uthmani), and as a recogniser writes what it hears (everyday spelling).
const EXPECTED = 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ مَـٰلِكِ يَوْمِ ٱلدِّينِ'.split(' ');
const statuses = (r: ReturnType<typeof alignRecitation>) => r.map((x) => x.status);

describe('tasmee: comparing the recitation with the ayat', () => {
  it('reads the Uthmani and everyday spellings as the same words', () => {
    expect(wordKey('ٱلْعَـٰلَمِينَ')).toBe(wordKey('العالمين'));
    expect(wordKey('ٱلصَّلَوٰةَ')).toBe(wordKey('الصلاة'));
    expect(similarity(wordKey('مَـٰلِكِ'), wordKey('مالك'))).toBe(1);
    expect(similarity(wordKey('مالك'), wordKey('ملك'))).toBe(1); // the qira'at differ only in the alif
  });

  it('marks a correct recitation correct', () => {
    const r = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين'), true);
    expect(statuses(r).every((s) => s === 'correct')).toBe(true);
    expect(score(r)).toBe(1);
  });

  it('leaves the words not yet recited pending, not skipped', () => {
    const r = alignRecitation(EXPECTED, heardWords('الحمد لله رب'));
    expect(statuses(r)).toEqual(['correct', 'correct', 'correct', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
  });

  it('finds a wrong word and says what was heard', () => {
    const r = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الرحمن الكريم مالك يوم الدين'), true);
    expect(r[5]).toMatchObject({ status: 'wrong', heard: 'الكريم' });
    expect(statuses(r).filter((s) => s !== 'correct')).toEqual(['wrong']);
  });

  it('finds a skipped word', () => {
    const r = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الرحيم مالك يوم الدين'), true);
    expect(r[4].status).toBe('skipped');
    expect(statuses(r).filter((s) => s !== 'correct')).toEqual(['skipped']);
  });

  it('is not thrown off by a repeated word or a recogniser slip', () => {
    const r = alignRecitation(EXPECTED, heardWords('الحمد لله لله رب العلمين الرحمن الرحيم'));
    expect(statuses(r).slice(0, 6).every((s) => s === 'correct')).toBe(true);
  });

  it('settles a mistake only once the reciter has gone on', () => {
    const early = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الرحمن الكريم'));
    expect(early[5].settled).toBe(false);
    const later = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الرحمن الكريم مالك يوم'));
    expect(later[5]).toMatchObject({ status: 'wrong', settled: true });
  });
  it('forgives letters a recogniser confuses, but not another word', () => {
    // ص heard as س, ض as د, ق as ك: still the right word.
    const r = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين'), true);
    expect(score(r)).toBe(1);
    const sirat = 'ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ'.split(' ');
    expect(statuses(alignRecitation(sirat, heardWords('اهدنا السراط المستكيم'), true))).toEqual(['correct', 'correct', 'correct']);
    expect(statuses(alignRecitation(sirat, heardWords('اهدنا الطريق المستقيم'), true))[1]).not.toBe('correct');
  });

  it('takes two heard words for one written word, and one for two', () => {
    const ya = 'يَـٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوا۟'.split(' ');
    expect(statuses(alignRecitation(ya, heardWords('يا أيها الذين آمنوا'), true))).toEqual(['correct', 'correct', 'correct']);
    const two = 'فَإِذَا هُم'.split(' ');
    expect(statuses(alignRecitation(two, heardWords('فاذاهم'), true))).toEqual(['correct', 'correct']);
  });

  it('follows a reciter who goes back to repeat the ayah, and keeps the last reading', () => {
    // Said wrongly («الكريم»), went on a word, then went back to «الرحمن» and said it right, then went on.
    const r = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الرحمن الكريم مالك الرحمن الرحيم مالك يوم الدين'), true);
    expect(statuses(r).every((s) => s === 'correct')).toBe(true);
    expect(r[5].corrected).toBe(true);
    // The whole passage twice (repeating for memorisation): no mistakes, nothing left pending.
    const twice = 'الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين';
    expect(statuses(alignRecitation(EXPECTED, heardWords(twice + ' ' + twice), true)).every((s) => s === 'correct')).toBe(true);
    // Repeating the first ayah while still going: the words not reached yet stay pending.
    const live = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الحمد لله رب العالمين الرحمن'));
    expect(statuses(live)).toEqual(['correct', 'correct', 'correct', 'correct', 'correct', 'pending', 'pending', 'pending', 'pending']);
  });

  it('keeps a word skipped on the way back counted as said, and a real mistake in the last reading as a mistake', () => {
    // Went back over ayah 3 leaving «يوم» out the second time: it was said the first time.
    const r = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين مالك الدين'), true);
    expect(statuses(r).every((s) => s === 'correct')).toBe(true);
    // Said wrongly both times: still wrong.
    const w = alignRecitation(EXPECTED, heardWords('الحمد لله رب العالمين الرحمن الكريم الرحمن الكريم مالك يوم الدين'), true);
    expect(w[5].status).toBe('wrong');
  });

  it("chooses the recogniser's guess that fits the ayat", () => {
    const alts = ['الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين'.replace('مالك يوم', 'ما لك يوما'), 'مالك يوم الدين', 'ملك اليوم'];
    expect(bestAlternative(EXPECTED, 6, ['ما لك يوما الدين', 'مالك يوم الدين'])).toBe('مالك يوم الدين');
    expect(bestAlternative(EXPECTED, 6, ['مالك يوم الدين', 'مالك يوم الدين'])).toBe('مالك يوم الدين');
    expect(bestAlternative(EXPECTED, 0, alts.slice(0, 1))).toBe(alts[0]);
  });
});
