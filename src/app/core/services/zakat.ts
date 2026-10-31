/** Everything the reader owns that zakat is due on, in their currency, with today's metal prices they entered. */
export interface ZakatInput {
  cash: number;
  /** Gold in grams of the given karat. */
  gold: number;
  goldKarat: 24 | 22 | 21 | 18;
  silver: number;
  /** Price of one gram of pure (24 karat) gold, and of one gram of silver. */
  goldPrice: number;
  silverPrice: number;
  /** Goods held for trade, at their current selling value. */
  trade: number;
  /** Money owed to the reader that they expect to be paid. */
  receivables: number;
  /** Debts the reader must pay now (deducted). */
  debts: number;
  nisab: 'gold' | 'silver';
}

export interface ZakatResult {
  goldValue: number;
  silverValue: number;
  /** Zakatable wealth after debts (never below zero). */
  total: number;
  /** The nisab in money, or null when the price of its metal is missing. */
  nisabValue: number | null;
  /** Wealth reaches the nisab (null when it can't be told). */
  due: boolean | null;
  /** 2.5% of the total when due, else 0. */
  amount: number;
}

/** Nisab: 20 mithqal of gold (85 g) or 200 dirhams of silver (595 g). */
export const NISAB_GOLD_GRAMS = 85;
export const NISAB_SILVER_GRAMS = 595;
export const ZAKAT_RATE = 0.025;

export const EMPTY_ZAKAT: ZakatInput = {
  cash: 0, gold: 0, goldKarat: 21, silver: 0, goldPrice: 0, silverPrice: 0, trade: 0, receivables: 0, debts: 0, nisab: 'silver',
};

const n = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

export function zakat(i: ZakatInput): ZakatResult {
  const goldValue = n(i.gold) * (i.goldKarat / 24) * n(i.goldPrice);
  const silverValue = n(i.silver) * n(i.silverPrice);
  const total = Math.max(0, n(i.cash) + goldValue + silverValue + n(i.trade) + n(i.receivables) - n(i.debts));
  const price = i.nisab === 'gold' ? n(i.goldPrice) : n(i.silverPrice);
  const nisabValue = price ? (i.nisab === 'gold' ? NISAB_GOLD_GRAMS : NISAB_SILVER_GRAMS) * price : null;
  const due = nisabValue === null ? null : total > 0 && total >= nisabValue;
  return { goldValue, silverValue, total, nisabValue, due, amount: due ? total * ZAKAT_RATE : 0 };
}
