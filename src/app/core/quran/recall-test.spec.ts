import { RecallTest, firstLetter, recallUnits, recallWords } from './recall-test';

describe('recall test (memorisation)', () => {
  it('splits an ayah into words, keeping a waqf sign with the word before it', () => {
    expect(recallWords('ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ')).toEqual([
      'ذَٰلِكَ', 'ٱلْكِتَٰبُ', 'لَا', 'رَيْبَ ۛ', 'فِيهِ ۛ', 'هُدًى', 'لِّلْمُتَّقِينَ',
    ]);
  });

  it('gives the first letter of a word with its marks as the hint', () => {
    expect(firstLetter('لِّلْمُتَّقِينَ')).toBe('لِّ');
    expect(firstLetter('ٱلْكِتَٰبُ')).toBe('ٱ');
    expect(firstLetter('ۛ')).toBe('');
  });

  it('hides words, first-letter hints or whole ayat', () => {
    const segs = [{ label: '1', text: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ' }, { label: '2', text: 'ٱللَّهُ ٱلصَّمَدُ' }];
    expect(recallUnits(segs, 'words').map((u) => u.segment)).toEqual([0, 0, 0, 0, 1, 1]);
    expect(recallUnits(segs, 'first')[0].hint).toBe('قُ');
    expect(recallUnits(segs, 'whole').map((u) => u.text)).toEqual(['قُلْ هُوَ ٱللَّهُ أَحَدٌ', 'ٱللَّهُ ٱلصَّمَدُ']);
  });

  it('reveals in order, marks the last revealed word wrong, and lists the ayat to review', () => {
    const t = new RecallTest([{ label: '1', text: 'a b c' }, { label: '2', text: 'd e' }, { label: '3', text: 'f' }], 'words');
    t.revealNext();
    t.revealNext();
    t.toggleMistake();
    expect([...t.mistakes]).toEqual([1]);
    t.revealSegment();
    expect(t.next).toBe(3);
    t.reveal(5);
    t.toggleMistake();
    expect(t.next).toBe(3);
    t.revealAll();
    expect(t.done).toBe(true);
    expect(t.weakSegments).toEqual([0, 2]);
    t.toggleMistake(1);
    expect(t.weakSegments).toEqual([2]);
    t.reset();
    expect(t.next).toBe(0);
  });
});
