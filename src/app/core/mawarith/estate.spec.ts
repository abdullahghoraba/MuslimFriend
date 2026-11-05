import { DEBT, EstateItem, Person, divide, itemValue } from './estate';

const prices = { goldGram: 4000, silverGram: 50, rate: (c: string) => (c === 'usd' ? 50 : undefined) };
const item = (id: string, kind: EstateItem['kind'], amount: number, extra: Partial<EstateItem> = {}): EstateItem => ({ id, kind, label: id, amount, ...extra });

describe('the estate and its division in kind', () => {
  it('values money, foreign money, gold by karat and things', () => {
    expect(itemValue(item('a', 'cash', 1000), prices, 'egp')).toBe(1000);
    expect(itemValue(item('b', 'currency', 100, { currency: 'usd' }), prices, 'egp')).toBe(5000);
    expect(itemValue(item('c', 'gold', 10, { karat: 21 }), prices, 'egp')).toBe(35000);
    expect(itemValue(item('d', 'property', 0, { area: 100, pricePerM2: 20000 }), prices, 'egp')).toBe(2_000_000);
    expect(itemValue(item('e', 'currency', 1, { currency: 'xyz' }), prices, 'egp')).toBeNull();
  });

  it('gives a flat whole to one heir and evens out with money', () => {
    // A wife (1/4) and a brother (3/4) of 1,200,000: a flat of 1,000,000 and 200,000 in cash.
    const items = [item('flat', 'property', 1_000_000), item('cash', 'cash', 200_000)];
    const values = new Map([['flat', 1_000_000], ['cash', 200_000]]);
    const people: Person[] = [{ id: 'w', label: 'wife', target: 300_000 }, { id: 'b', label: 'brother', target: 900_000 }];
    const d = divide(items, values, people, 0);
    const wife = d.lots.find((l) => l.person.id === 'w')!, brother = d.lots.find((l) => l.person.id === 'b')!;
    // The brother lacks the most: he takes the flat, the wife the cash, and he pays her the 100,000 still owed.
    expect(brother.whole.map((w) => w.item.id)).toEqual(['flat']);
    expect(wife.parts.map((p) => Math.round(p.value))).toEqual([200_000]);
    expect(d.transfers).toEqual([{ from: 'b', to: 'w', amount: 100_000 }]);
    for (const l of d.lots) expect(l.total).toBeCloseTo(l.person.target, 6);
  });

  it('honours a thing given to a chosen heir and pays the debts from the money first', () => {
    const items = [item('car', 'car', 300_000, { to: 'b' }), item('gold', 'gold', 50, { karat: 24 }), item('cash', 'cash', 100_000)];
    const values = new Map([['car', 300_000], ['gold', 200_000], ['cash', 100_000]]);
    // Debts 100,000: the net 500,000 to a son (2/3) and a daughter (1/3).
    const people: Person[] = [{ id: 'a', label: 'son', target: 500_000 * 2 / 3 }, { id: 'b', label: 'daughter', target: 500_000 / 3 }];
    const d = divide(items, values, people, 100_000);
    expect(d.uncovered).toBe(0);
    expect(d.lots[1].whole[0].item.id).toBe('car');
    expect(d.lots[0].parts.find((p) => p.item.id === 'cash')).toBeUndefined();
    expect(d.lots[0].parts.find((p) => p.item.id === 'gold')!.amount).toBeCloseTo(50, 6);
    for (const l of d.lots) expect(l.total).toBeCloseTo(l.person.target, 6);
  });

  it('when the money cannot pay the debts, whoever takes the land pays the rest', () => {
    const items = [item('land', 'land', 900_000), item('cash', 'cash', 50_000)];
    const values = new Map([['land', 900_000], ['cash', 50_000]]);
    const people: Person[] = [{ id: 'a', label: 'son', target: 850_000 }];
    const d = divide(items, values, people, 100_000);
    expect(d.uncovered).toBeCloseTo(50_000, 6);
    expect(d.transfers).toEqual([{ from: 'a', to: DEBT, amount: 50_000 }]);
  });

  it('a thing to be sold is divided as money', () => {
    const items = [item('shop', 'shop', 600_000, { to: 'sell' })];
    const d = divide(items, new Map([['shop', 600_000]]), [{ id: 'a', label: 'a', target: 400_000 }, { id: 'b', label: 'b', target: 200_000 }], 0);
    expect(d.lots.map((l) => Math.round(l.parts[0].value))).toEqual([400_000, 200_000]);
    expect(d.transfers).toEqual([]);
  });

  it('gives everyone exactly their share for 2,000 random estates, and loses nothing', () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
    const kinds: EstateItem['kind'][] = ['cash', 'currency', 'gold', 'silver', 'property', 'land', 'shop', 'car', 'other'];
    for (let t = 0; t < 2000; t++) {
      const items: EstateItem[] = [];
      const values = new Map<string, number>();
      for (let k = rnd(6) + 1; k > 0; k--) {
        const id = 'i' + k, kind = kinds[rnd(kinds.length)], v = (rnd(1000) + 1) * 1000;
        items.push(item(id, kind, v, rnd(4) === 0 && !['cash', 'currency', 'gold', 'silver'].includes(kind) ? { to: rnd(2) ? 'sell' : 'p0' } : {}));
        values.set(id, v);
      }
      const total = [...values.values()].reduce((a, b) => a + b, 0);
      const deduction = rnd(3) === 0 ? rnd(Math.floor(total / 2)) : 0;
      const net = total - deduction;
      const n = rnd(5) + 1;
      const weights = Array.from({ length: n }, () => rnd(9) + 1);
      const wsum = weights.reduce((a, b) => a + b, 0);
      const people: Person[] = weights.map((w, i) => ({ id: 'p' + i, label: 'p' + i, target: net * w / wsum }));
      const d = divide(items, values, people, deduction);
      for (const l of d.lots) expect(Math.abs(l.total - l.person.target)).toBeLessThan(0.02);
      // Every divisible thing (after the deduction) and every whole thing is handed out once.
      const handed = d.lots.reduce((s, l) => s + l.whole.reduce((a, w) => a + w.value, 0) + l.parts.reduce((a, p) => a + p.value, 0), 0);
      expect(Math.abs(handed - (total - deduction + d.uncovered))).toBeLessThan(0.02);
      const paid = d.transfers.reduce((s, x) => s + x.amount, 0);
      expect(paid).toBeGreaterThanOrEqual(0);
      for (const x of d.transfers) expect(x.from).not.toBe(x.to);
    }
  });
});
