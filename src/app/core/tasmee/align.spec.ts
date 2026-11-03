import { alignRecitation, heardWords, score, similarity, wordKey } from './align';

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
});
