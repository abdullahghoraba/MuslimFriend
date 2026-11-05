import { Calculation, School, calculate, compareSchools } from './engine';
import { Family, HEIR, HEIRS, HeirKey } from './heirs';

/** Each heir's share of the estate as "n/d" (the whole group), "0" when blocked. */
function shares(deceased: 'm' | 'f', family: Family, school: School = 'hanbali'): Record<string, string> {
  const r = calculate({ deceased, family }, school);
  return Object.fromEntries(r.shares.map((s) => [s.key, s.total.toString()]));
}
const calc = (deceased: 'm' | 'f', family: Family, school: School = 'hanbali'): Calculation => calculate({ deceased, family }, school);
const total = (r: Calculation) => r.shares.reduce((n, s) => n + s.total.toNumber(), 0) + (r.treasury?.toNumber() ?? 0);

describe('inheritance (الفرائض)', () => {
  it('a son who leaves his father, mother, a son and a daughter', () => {
    const r = calc('m', { father: 1, mother: 1, son: 1, daughter: 1 });
    expect(shares('m', { father: 1, mother: 1, son: 1, daughter: 1 })).toEqual({ son: '4/9', daughter: '2/9', father: '1/6', mother: '1/6' });
    expect(r.asl).toBe(6);
    expect(r.base).toBe(18);
  });

  it('spouses: half or quarter, quarter or eighth', () => {
    expect(shares('f', { husband: 1, son: 1 })).toEqual({ husband: '1/4', son: '3/4' });
    expect(shares('f', { husband: 1, fullBrother: 1 })).toEqual({ husband: '1/2', fullBrother: '1/2' });
    expect(shares('m', { wife: 2, son: 1 })).toEqual({ wife: '1/8', son: '7/8' });
    expect(calc('m', { wife: 2, son: 1 }).base).toBe(16);
  });

  it('العول: husband, mother and two full sisters (to 8); المنبرية (to 27)', () => {
    const a = calc('f', { husband: 1, mother: 1, fullSister: 2 });
    expect(a.asl).toBe(6);
    expect(a.awl).toBe(8);
    expect(shares('f', { husband: 1, mother: 1, fullSister: 2 })).toEqual({ husband: '3/8', mother: '1/8', fullSister: '1/2' });
    const m = calc('m', { wife: 1, daughter: 2, father: 1, mother: 1 });
    expect(m.asl).toBe(24);
    expect(m.awl).toBe(27);
    expect(shares('m', { wife: 1, daughter: 2, father: 1, mother: 1 })).toEqual({ wife: '1/9', daughter: '16/27', father: '4/27', mother: '4/27' });
  });

  it('العمريتان: the mother takes a third of what the spouse leaves', () => {
    expect(shares('f', { husband: 1, father: 1, mother: 1 })).toEqual({ husband: '1/2', father: '1/3', mother: '1/6' });
    expect(shares('m', { wife: 1, father: 1, mother: 1 })).toEqual({ wife: '1/4', father: '1/2', mother: '1/4' });
  });

  it('the mother: a third, or a sixth with children or two siblings (even siblings the father blocks)', () => {
    expect(shares('m', { mother: 1, father: 1 })).toEqual({ father: '2/3', mother: '1/3' });
    expect(shares('m', { mother: 1, father: 1, fullBrother: 2 })).toEqual({ father: '5/6', mother: '1/6', fullBrother: '0' });
  });

  it('daughters, son\'s daughters and القريب المبارك', () => {
    expect(shares('m', { daughter: 1, sonDaughter: 1, fullBrother: 1 })).toEqual({ daughter: '1/2', sonDaughter: '1/6', fullBrother: '1/3' });
    expect(shares('m', { daughter: 2, sonDaughter: 1, fullBrother: 1 })).toEqual({ daughter: '2/3', sonDaughter: '0', fullBrother: '1/3' });
    expect(shares('m', { daughter: 2, sonDaughter: 1, sonSonSon: 1 })).toEqual({ daughter: '2/3', sonDaughter: '1/9', sonSonSon: '2/9' });
    expect(shares('m', { son: 1, sonSon: 3, sonDaughter: 2 })).toEqual({ son: '1', sonSon: '0', sonDaughter: '0' });
  });

  it('sisters with daughters are residuaries (عصبة مع الغير) and block the paternal siblings', () => {
    expect(shares('m', { daughter: 1, sonDaughter: 1, fullSister: 1 })).toEqual({ daughter: '1/2', sonDaughter: '1/6', fullSister: '1/3' });
    expect(shares('m', { daughter: 1, fullSister: 1, patBrother: 1 })).toEqual({ daughter: '1/2', fullSister: '1/2', patBrother: '0' });
    expect(shares('m', { fullSister: 1, patSister: 2 })).toEqual({ fullSister: '3/4', patSister: '1/4' });
  });

  it('maternal siblings share a third equally and are blocked by any descendant or the father\'s line', () => {
    expect(shares('m', { matBrother: 1, matSister: 1, fullBrother: 1 })).toEqual({ fullBrother: '2/3', matBrother: '1/6', matSister: '1/6' });
    expect(shares('m', { matBrother: 1, daughter: 1, fullBrother: 1 })).toEqual({ daughter: '1/2', fullBrother: '1/2', matBrother: '0' });
  });

  it('الرد: to the heirs by share, never to a spouse while others are there', () => {
    expect(shares('m', { mother: 1, daughter: 1 })).toEqual({ daughter: '3/4', mother: '1/4' });
    expect(shares('m', { wife: 1, daughter: 1 })).toEqual({ wife: '1/8', daughter: '7/8' });
    const r = calc('f', { husband: 1 });
    expect(r.special).toBe('spouseRadd');
    expect(shares('f', { husband: 1 })).toEqual({ husband: '1' });
  });

  it('grandmothers share a sixth; the father blocks his mother except in the Hanbali school', () => {
    expect(shares('m', { grandmotherM: 1, grandmotherF: 1, son: 1 })).toEqual({ son: '5/6', grandmotherM: '1/12', grandmotherF: '1/12' });
    expect(shares('m', { grandmotherM: 1, grandmotherF: 1, father: 1 }, 'shafii')).toEqual({ father: '5/6', grandmotherM: '1/6', grandmotherF: '0' });
    expect(shares('m', { grandmotherM: 1, grandmotherF: 1, father: 1 }, 'hanbali')).toEqual({ father: '5/6', grandmotherM: '1/12', grandmotherF: '1/12' });
  });

  it('the grandfather with the siblings: Abu Hanifa blocks them, the others share (Zayd)', () => {
    expect(shares('m', { grandfather: 1, fullBrother: 1 }, 'hanafi')).toEqual({ grandfather: '1', fullBrother: '0' });
    expect(shares('m', { grandfather: 1, fullBrother: 1 })).toEqual({ grandfather: '1/2', fullBrother: '1/2' });
    expect(shares('m', { grandfather: 1, fullBrother: 3 })).toEqual({ grandfather: '1/3', fullBrother: '2/3' });
    // Husband 1/2, mother 1/3: a sixth is left, the grandfather takes it and the brother gets nothing.
    expect(shares('f', { husband: 1, mother: 1, grandfather: 1, fullBrother: 1 })).toEqual({ husband: '1/2', mother: '1/3', grandfather: '1/6', fullBrother: '0' });
    // Husband 1/2, mother 1/6 (two brothers): a third is left; sharing gives the grandfather 1/9, a sixth is better.
    expect(shares('f', { husband: 1, mother: 1, grandfather: 1, fullBrother: 2 })).toEqual({ husband: '1/2', mother: '1/6', grandfather: '1/6', fullBrother: '1/6' });
    // المعادة: the paternal brother is counted against the grandfather, then the full brother takes his part.
    expect(shares('m', { grandfather: 1, fullBrother: 1, patBrother: 1 })).toEqual({ grandfather: '1/3', fullBrother: '2/3', patBrother: '0' });
  });

  it('الأكدرية: 27 = 9 + 6 + 8 + 4', () => {
    const r = calc('f', { husband: 1, mother: 1, grandfather: 1, fullSister: 1 }, 'shafii');
    expect(r.special).toBe('akdariyya');
    expect(r.base).toBe(27);
    expect(shares('f', { husband: 1, mother: 1, grandfather: 1, fullSister: 1 }, 'shafii')).toEqual({ husband: '1/3', mother: '2/9', grandfather: '8/27', fullSister: '4/27' });
    expect(shares('f', { husband: 1, mother: 1, grandfather: 1, fullSister: 1 }, 'hanafi')).toEqual({ husband: '1/2', mother: '1/3', grandfather: '1/6', fullSister: '0' });
  });

  it('المشتركة: Malik and al-Shafi\'i let the full brother share the maternal siblings\' third', () => {
    const fam: Family = { husband: 1, mother: 1, matBrother: 2, fullBrother: 1 };
    expect(shares('f', fam, 'shafii')).toEqual({ husband: '1/2', mother: '1/6', fullBrother: '1/9', matBrother: '2/9' });
    expect(shares('f', fam, 'hanbali')).toEqual({ husband: '1/2', mother: '1/6', fullBrother: '0', matBrother: '1/3' });
    expect(calc('f', fam, 'maliki').special).toBe('mushtaraka');
  });

  it('the residue goes to the nearest male relative', () => {
    expect(shares('m', { wife: 1, fullNephew: 1, fullUncle: 2 })).toEqual({ wife: '1/4', fullNephew: '3/4', fullUncle: '0' });
    expect(shares('m', { daughter: 1, fullCousin: 2 })).toEqual({ daughter: '1/2', fullCousin: '1/2' });
    expect(shares('m', { patBrother: 1, fullNephew: 1 })).toEqual({ patBrother: '1', fullNephew: '0' });
  });

  it('relatives of the womb: only when no other heir but a spouse is there', () => {
    expect(shares('m', { daughterSon: 1, fullBrother: 1 })).toEqual({ fullBrother: '1', daughterSon: '0' });
    // التنزيل: the daughter's son takes the daughter's place, the aunt the father's.
    expect(shares('m', { daughterSon: 1, patAunt: 1 }, 'hanbali')).toEqual({ daughterSon: '1/2', patAunt: '1/2' });
    // Abu Hanifa's school: the descendants come first.
    expect(shares('m', { daughterSon: 1, patAunt: 1 }, 'hanafi')).toEqual({ daughterSon: '1', patAunt: '0' });
    // With a wife: she takes her quarter, the rest to them.
    expect(shares('m', { wife: 1, daughterSon: 1, daughterDaughter: 1 }, 'shafii')).toEqual({ wife: '1/4', daughterSon: '1/2', daughterDaughter: '1/4' });
    expect(shares('m', { wife: 1, daughterSon: 1, daughterDaughter: 1 }, 'hanbali')).toEqual({ wife: '1/4', daughterSon: '3/8', daughterDaughter: '3/8' });
  });

  it('always gives out the whole estate, in every school', () => {
    const families: [('m' | 'f'), Family][] = [
      ['m', { wife: 4, son: 3, daughter: 5, father: 1, mother: 1 }],
      ['f', { husband: 1, daughter: 1, sonDaughter: 3, grandmotherM: 1, fullSister: 2, patBrother: 1 }],
      ['m', { mother: 1, matSister: 2, fullSister: 1, patSister: 1, grandfather: 1 }],
      ['m', { matUncle: 1, matAunt: 2, fullSisterSon: 1 }],
      ['f', {}],
    ];
    for (const [d, fam] of families) for (const r of compareSchools({ deceased: d, family: fam }).results) expect(total(r)).toBeCloseTo(1, 10);
  });

  it('never loses or invents part of the estate, for 3,000 random families in the four schools', () => {
    let seed = 42;
    const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
    const keys = HEIRS.map((h) => h.key);
    for (let i = 0; i < 3000; i++) {
      const fam: Family = {};
      for (let j = rnd(6) + 1; j > 0; j--) { const k = keys[rnd(keys.length)]; fam[k] = Math.min(HEIR[k].max, rnd(3) + 1); }
      const deceased = rnd(2) ? 'm' : 'f';
      for (const r of compareSchools({ deceased, family: fam }).results) {
        expect(total(r)).toBeCloseTo(1, 9);
        for (const sh of r.shares) {
          expect(sh.total.n >= 0n).toBe(true);
          expect(Number.isInteger(sh.total.mul(r.base).div(sh.count).toNumber() + 0)).toBe(true);
        }
      }
    }
  });

  it('notes when the schools differ', () => {
    expect(compareSchools({ deceased: 'm', family: { son: 1, daughter: 1 } }).same).toBe(true);
    expect(compareSchools({ deceased: 'm', family: { grandfather: 1, fullBrother: 1 } }).same).toBe(false);
  });
});

export type { HeirKey };
