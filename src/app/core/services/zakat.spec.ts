import { EMPTY_ZAKAT, zakat } from './zakat';

describe('zakat calculator', () => {
  it('is 2.5% of wealth after debts once it reaches the silver nisab (595 g)', () => {
    const r = zakat({ ...EMPTY_ZAKAT, cash: 50_000, trade: 10_000, receivables: 5_000, debts: 15_000, silverPrice: 50 });
    expect(r.nisabValue).toBe(29_750);
    expect(r.total).toBe(50_000);
    expect(r.due).toBe(true);
    expect(r.amount).toBe(1_250);
  });

  it('values gold by its karat and can use the gold nisab (85 g of pure gold)', () => {
    const r = zakat({ ...EMPTY_ZAKAT, gold: 100, goldKarat: 21, goldPrice: 4_000, nisab: 'gold' });
    expect(r.goldValue).toBe(350_000);
    expect(r.nisabValue).toBe(340_000);
    expect(r.amount).toBe(8_750);
    expect(zakat({ ...EMPTY_ZAKAT, gold: 90, goldKarat: 21, goldPrice: 4_000, nisab: 'gold' }).due).toBe(false);
  });

  it('cannot tell without the nisab metal\'s price, and never goes below zero', () => {
    expect(zakat({ ...EMPTY_ZAKAT, cash: 1_000_000 }).due).toBeNull();
    const r = zakat({ ...EMPTY_ZAKAT, cash: 100, debts: 500, silverPrice: 1 });
    expect(r.total).toBe(0);
    expect(r.due).toBe(false);
    expect(zakat({ ...EMPTY_ZAKAT, cash: -5, silverPrice: NaN }).total).toBe(0);
  });
});
