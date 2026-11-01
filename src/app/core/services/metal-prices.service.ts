import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { TROY_OUNCE_GRAMS, ZakatPrices } from './zakat';

/** Price of one troy ounce of gold and of silver in each currency (lower-case ISO 4217), for one day. */
export interface MetalQuotes {
  /** The day the prices are from (YYYY-MM-DD), as published. */
  date: string;
  gold: Record<string, number>;
  silver: Record<string, number>;
}

/** The free daily exchange-rate dataset (github.com/fawazahmed0/exchange-api): XAU / XAG in 300+ currencies. */
const SOURCES = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies',
  'https://latest.currency-api.pages.dev/v1/currencies',
];
const KEY = 'metalQuotes';
/** Refetched when older than this. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Today's prices from [q] in [currency], with conversion between currencies through the gold price. */
export function pricesFrom(q: MetalQuotes, currency: string): ZakatPrices | null {
  const c = currency.toLowerCase();
  const gold = q.gold[c], silver = q.silver[c];
  if (!gold || !silver) return null;
  return {
    currency: c,
    goldGram: gold / TROY_OUNCE_GRAMS,
    silverGram: silver / TROY_OUNCE_GRAMS,
    // 1 ounce costs gold[c] in the main currency and q.gold[x] in currency x, so 1 x = gold[c] / q.gold[x].
    rate: (x) => (q.gold[x.toLowerCase()] ? gold / q.gold[x.toLowerCase()] : undefined),
  };
}

/**
 * Gold and silver prices for the zakat calculator, fetched once in a while (the request names only the metal) and kept
 * for offline use with their date.
 */
@Injectable({ providedIn: 'root' })
export class MetalPricesService {
  readonly quotes = signal<MetalQuotes | null>(null);
  readonly loading = signal(false);
  /** The last fetch failed (offline): the saved prices, if any, are shown with their date. */
  readonly failed = signal(false);
  private fetchedAt = 0;

  async load(force = false): Promise<void> {
    if (!this.quotes()) {
      const { value } = await Preferences.get({ key: KEY });
      try {
        const saved = value ? JSON.parse(value) : null;
        if (saved?.quotes?.gold) {
          this.quotes.set(saved.quotes);
          this.fetchedAt = saved.at ?? 0;
        }
      } catch {
        /* fetch below */
      }
    }
    if (!force && this.quotes() && Date.now() - this.fetchedAt < MAX_AGE_MS) return;
    this.loading.set(true);
    this.failed.set(false);
    try {
      const quotes = await this.fetchQuotes();
      this.quotes.set(quotes);
      this.fetchedAt = Date.now();
      await Preferences.set({ key: KEY, value: JSON.stringify({ quotes, at: this.fetchedAt }) });
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Currencies the prices cover (lower case). */
  currencies(): string[] {
    const q = this.quotes();
    return q ? Object.keys(q.gold).filter((c) => q.silver[c] && /^[a-z]{3}$/.test(c)).sort() : [];
  }

  private async fetchQuotes(): Promise<MetalQuotes> {
    let last: unknown;
    for (const base of SOURCES) {
      try {
        const [xau, xag] = await Promise.all(['xau', 'xag'].map(async (m) => {
          const res = await fetch(`${base}/${m}.json`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        }));
        if (!xau?.xau?.usd || !xag?.xag?.usd) throw new Error('no prices');
        return { date: String(xau.date ?? ''), gold: xau.xau, silver: xag.xag };
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }
}
