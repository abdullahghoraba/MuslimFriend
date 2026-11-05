// The estate as things (cash, foreign money, gold, silver, a flat, land, a car…), valued in one currency, and its
// division among the heirs in kind: what can be divided (money, grams of gold) is divided exactly; what cannot (a
// flat, a car) goes whole to an heir, and whoever takes more than their share pays the others the difference.

export type EstateKind = 'cash' | 'currency' | 'gold' | 'silver' | 'property' | 'land' | 'shop' | 'car' | 'other';
export const ESTATE_KINDS: EstateKind[] = ['cash', 'currency', 'gold', 'silver', 'property', 'land', 'shop', 'car', 'other'];
export type GoldKarat = 24 | 22 | 21 | 18;

export interface EstateItem {
  id: string;
  kind: EstateKind;
  /** The reader's name for it ("Flat in Nasr City"). */
  label: string;
  /** Money: the amount (in [currency] for 'currency'); gold and silver: grams; a thing: its value, unless area × price. */
  amount: number;
  currency?: string;
  karat?: GoldKarat;
  /** Square metres and the price of one, for a flat or land (value = area × price). */
  area?: number;
  pricePerM2?: number;
  /** A whole thing: 'auto' (given to an heir by the division), 'sell' (its price is divided), or a person's id. */
  to?: string;
}

export interface Prices {
  /** One gram of 24 karat gold and of silver, in the main currency. */
  goldGram: number;
  silverGram: number;
  /** Main-currency value of one unit of [code]. */
  rate(code: string): number | undefined;
}

export const divisible = (i: EstateItem): boolean => ['cash', 'currency', 'gold', 'silver'].includes(i.kind) || i.to === 'sell';

/** The item's value in the main currency (null when a foreign currency has no known rate). */
export function itemValue(i: EstateItem, p: Prices | null, main: string): number | null {
  const n = Math.max(0, Number(i.amount) || 0);
  switch (i.kind) {
    case 'cash': return n;
    case 'currency': {
      if (!i.currency || i.currency === main) return n;
      const r = p?.rate(i.currency);
      return r === undefined ? null : n * r;
    }
    case 'gold': return p ? n * p.goldGram * (i.karat ?? 21) / 24 : null;
    case 'silver': return p ? n * p.silverGram : null;
    default:
      if ((i.area ?? 0) > 0 && (i.pricePerM2 ?? 0) > 0) return i.area! * i.pricePerM2!;
      return n;
  }
}

export interface Person { id: string; label: string; target: number }

/** What one person takes: whole things, parts of the divisible things, and money paid or received. */
export interface Lot {
  person: Person;
  whole: { item: EstateItem; value: number }[];
  /** [item id] → amount in the item's own unit (grams, dollars, money). */
  parts: { item: EstateItem; amount: number; value: number }[];
  /** Positive: receives from the others; negative: pays them (or the creditors, see DEBT). */
  settle: number;
  total: number;
}

export interface Transfer { from: string; to: string; amount: number }
/** The [to] of a payment toward the debts and bequest the money did not cover. */
export const DEBT = '__debt';

export interface Division {
  lots: Lot[];
  transfers: Transfer[];
  /** Debts and bequest the money did not cover: paid by those who took whole things (see DEBT). */
  uncovered: number;
}

/**
 * Divides [items] (worth [values]) among [people] whose targets add up to the net estate. [deduction] (funeral, debts,
 * bequest) is taken first from the money, then the foreign money, silver and gold. Whole things go first to the person
 * they are given to, else each to whoever still lacks the most; then every divisible thing is shared among those still
 * lacking, in proportion; whoever got more than their share pays the difference to the others (the fewest payments).
 */
export function divide(items: EstateItem[], values: Map<string, number>, people: Person[], deduction: number): Division {
  const order: EstateKind[] = ['cash', 'currency', 'silver', 'gold', 'property', 'land', 'shop', 'car', 'other'];
  // Divisible pool after the deduction.
  let toDeduct = Math.max(0, deduction);
  const pool: { item: EstateItem; value: number; amount: number }[] = [];
  for (const i of [...items].filter(divisible).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    const value = values.get(i.id) ?? 0;
    if (value <= 0) continue;
    const used = Math.min(value, toDeduct);
    toDeduct -= used;
    const left = value - used;
    const unitAmount = i.to === 'sell' ? value : (Number(i.amount) || 0);
    if (left > 1e-9) pool.push({ item: i, value: left, amount: unitAmount * left / value });
  }
  const uncovered = toDeduct;
  const lots: Lot[] = people.map((person) => ({ person, whole: [], parts: [], settle: 0, total: 0 }));
  const byId = new Map(lots.map((l) => [l.person.id, l]));
  const got = new Map(people.map((p) => [p.id, 0]));
  const target = new Map(people.map((p) => [p.id, p.target]));
  // Whole things.
  const whole = items.filter((i) => !divisible(i)).map((item) => ({ item, value: values.get(item.id) ?? 0 })).filter((w) => w.value > 0);
  for (const w of whole.filter((x) => x.item.to && x.item.to !== 'auto' && byId.has(x.item.to))) {
    byId.get(w.item.to!)!.whole.push(w);
    got.set(w.item.to!, got.get(w.item.to!)! + w.value);
  }
  for (const w of whole.filter((x) => !x.item.to || x.item.to === 'auto' || !byId.has(x.item.to)).sort((a, b) => b.value - a.value)) {
    // Prefer someone it fits; else whoever lacks the most.
    const need = (id: string) => target.get(id)! - got.get(id)!;
    const fits = people.filter((p) => need(p.id) >= w.value - 1e-6).sort((a, b) => need(a.id) - need(b.id));
    const chosen = fits[0] ?? [...people].sort((a, b) => need(b.id) - need(a.id))[0];
    if (!chosen) continue;
    byId.get(chosen.id)!.whole.push(w);
    got.set(chosen.id, got.get(chosen.id)! + w.value);
  }
  // Divisible things, to those still lacking, in proportion.
  const needs = people.map((p) => ({ id: p.id, need: target.get(p.id)! - got.get(p.id)! }));
  const positive = needs.filter((n) => n.need > 1e-9);
  const P = positive.reduce((s, n) => s + n.need, 0);
  const D = pool.reduce((s, x) => s + x.value, 0);
  for (const n of positive) {
    const share = P > 0 ? n.need / P : 0;
    for (const x of pool) {
      byId.get(n.id)!.parts.push({ item: x.item, amount: x.amount * share, value: x.value * share });
    }
    got.set(n.id, got.get(n.id)! + D * share);
  }
  // Settle what is still over or under.
  const debtors = people.map((p) => ({ id: p.id, v: got.get(p.id)! - target.get(p.id)! })).filter((x) => x.v > 0.005).sort((a, b) => b.v - a.v);
  const creditors = people.map((p) => ({ id: p.id, v: target.get(p.id)! - got.get(p.id)! })).filter((x) => x.v > 0.005).sort((a, b) => b.v - a.v);
  // What the money could not pay is owed to the creditors (or the bequest) by whoever took more than their share.
  if (uncovered > 0.005) creditors.unshift({ id: DEBT, v: uncovered });
  const transfers: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].v, creditors[j].v);
    if (amount > 0.005) transfers.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].v -= amount; creditors[j].v -= amount;
    if (debtors[i].v <= 0.005) i++;
    if (creditors[j].v <= 0.005) j++;
  }
  for (const t of transfers) { byId.get(t.from)!.settle -= t.amount; const r = byId.get(t.to); if (r) r.settle += t.amount; }
  for (const l of lots) l.total = l.whole.reduce((s, w) => s + w.value, 0) + l.parts.reduce((s, p) => s + p.value, 0) + l.settle;
  return { lots, transfers, uncovered };
}
