import { parseFamily } from './parse';

describe('reading a family from a sentence', () => {
  it('Arabic: counts, duals, possessives and kinds of siblings', () => {
    expect(parseFamily('توفي رجل وترك زوجتين وأبًا وأمًا وابنًا وبنتين')).toEqual({ deceased: 'm', family: { wife: 2, father: 1, mother: 1, son: 1, daughter: 2 }, guessed: [] });
    expect(parseFamily('ماتت امرأة عن زوجها وأمها و3 أبناء وبنت').family).toEqual({ husband: 1, mother: 1, son: 3, daughter: 1 });
    expect(parseFamily('توفي وترك أخًا شقيقًا وأختين لأب وأخ لأم وابن ابن وبنت ابن').family)
      .toEqual({ fullBrother: 1, patSister: 2, matBrother: 1, sonSon: 1, sonDaughter: 1 });
    expect(parseFamily('ترك جدة لأم وجدة لأب وثلاثة أعمام وابن عم').family).toEqual({ grandmotherM: 1, grandmotherF: 1, fullUncle: 3, fullCousin: 1 });
    expect(parseFamily('توفي ابني وترك أباه وأمه وزوجته وابنه وابنته').family).toEqual({ father: 1, mother: 1, wife: 1, son: 1, daughter: 1 });
    expect(parseFamily('ترك بنات وخالة وابن بنت').guessed).toEqual(['daughter']);
  });
  it('English: numbers, possessives, "of" and modifiers', () => {
    expect(parseFamily('A woman died leaving her husband, 2 sons and a daughter')).toEqual({ deceased: 'f', family: { husband: 1, son: 2, daughter: 1 }, guessed: [] });
    expect(parseFamily("a man left his mother, his son's daughter, two paternal sisters and a maternal uncle").family)
      .toEqual({ mother: 1, sonDaughter: 1, patSister: 2, matUncle: 1 });
    expect(parseFamily('wife, 3 daughters, daughter of the son and full brothers')).toEqual({ deceased: 'm', family: { wife: 1, daughter: 3, sonDaughter: 1, fullBrother: 2 }, guessed: ['fullBrother'] });
  });
});
