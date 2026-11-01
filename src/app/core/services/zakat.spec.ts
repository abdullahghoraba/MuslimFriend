import { pricesFrom } from './metal-prices.service';
import { TROY_OUNCE_GRAMS, ZakatAsset, currencyOf, zakatOf } from './zakat';

/** One ounce of gold: 124,416 EGP / 3,888 USD; silver: 1,555 EGP / 48.6 USD (round numbers per gram). */
const quotes = {
  date: '2026-11-01',
  gold: { egp: 4000 * TROY_OUNCE_GRAMS, usd: 125 * TROY_OUNCE_GRAMS },
  silver: { egp: 50 * TROY_OUNCE_GRAMS, usd: 1.5625 * TROY_OUNCE_GRAMS },
};
const egp = pricesFrom(quotes, 'EGP')!;
const asset = (kind: ZakatAsset['kind'], amount: number, extra: Partial<ZakatAsset> = {}): ZakatAsset => ({ id: kind + amount, kind, label: '', amount, ...extra });

describe('zakat calculator', () => {
  it('reads gram prices and converts other currencies through the gold price', () => {
    expect(egp.goldGram).toBeCloseTo(4000);
    expect(egp.silverGram).toBeCloseTo(50);
    expect(egp.rate('usd')).toBeCloseTo(32);
    expect(egp.rate('xyz')).toBeUndefined();
    expect(pricesFrom(quotes, 'sar')).toBeNull();
  });

  it('is 2.5% of everything owned after debts, once it reaches the silver nisab (595 g)', () => {
    const r = zakatOf([asset('cash', 20_000), asset('bank', 1_000, { currency: 'usd' }), asset('gold', 10, { karat: 21 }), asset('trade', 5_000), asset('debt', 7_000)], egp, 'silver');
    // 20,000 + 32,000 + 10 g × 21/24 × 4,000 (35,000) + 5,000 − 7,000
    expect(r.total).toBeCloseTo(85_000);
    expect(r.nisabValue).toBeCloseTo(29_750);
    expect(r.due).toBe(true);
    expect(r.amount).toBeCloseTo(2_125);
    expect(r.lines.find((l) => l.id === 'debt7000')!.value).toBeCloseTo(-7_000);
  });

  it('uses the gold nisab (85 g) when chosen, and leaves out money in a currency it has no rate for', () => {
    const assets = [asset('cash', 300_000), asset('other', 50, { currency: 'xyz' })];
    const r = zakatOf(assets, egp, 'gold');
    expect(r.nisabValue).toBeCloseTo(340_000);
    expect(r.due).toBe(false);
    expect(r.lines[1].value).toBeNull();
    expect(zakatOf([asset('cash', 100), asset('debt', 500)], egp, 'silver').total).toBe(0);
  });

  it('knows each country\'s currency', () => {
    expect(currencyOf('EG')).toBe('egp');
    expect(currencyOf('sa')).toBe('sar');
    expect(currencyOf('PS')).toBe('ils');
    expect(currencyOf('DE')).toBe('eur');
    expect(currencyOf('ZZ')).toBeUndefined();
  });
});
