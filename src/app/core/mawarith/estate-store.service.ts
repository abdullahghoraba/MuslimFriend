import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { LocationService, nearestCity } from '../prayer/location.service';
import { PrayerService } from '../prayer/prayer.service';
import { MetalPricesService, pricesFrom } from '../services/metal-prices.service';
import { currencyOf } from '../services/zakat';
import { EstateItem, Prices, itemValue } from './estate';
import { School } from './engine';
import { Family } from './heirs';

const KEY = 'mawarithV1';

interface Saved {
  currency: string;
  items: EstateItem[];
  funeral: number;
  debts: number;
  will: number;
  consent: boolean;
  /** The reader's own price of a gram of 24 karat gold (a local jeweller's), 0 for today's market price. */
  ownGold: number;
  names: Record<string, string>;
  deceased: 'm' | 'f';
  family: Family;
  school: 'auto' | School;
  text: string;
}

/** The inheritance being worked on: the family, the estate's things and their prices; kept on the phone. */
@Injectable({ providedIn: 'root' })
export class EstateStore {
  readonly metals = inject(MetalPricesService);
  private readonly prayer = inject(PrayerService);
  private readonly locations = inject(LocationService);
  readonly state = signal<Saved>({
    currency: '', items: [], funeral: 0, debts: 0, will: 0, consent: false, ownGold: 0, names: {}, deceased: 'm', family: {}, school: 'auto', text: '',
  });
  readonly loaded = signal(false);
  private timer?: ReturnType<typeof setTimeout>;

  readonly currency = computed(() => this.state().currency || 'usd');
  readonly market = computed(() => {
    const q = this.metals.quotes();
    return q ? pricesFrom(q, this.currency()) : null;
  });
  readonly prices = computed<Prices | null>(() => {
    const m = this.market();
    const own = this.state().ownGold;
    if (!m) return own > 0 ? { goldGram: own, silverGram: 0, rate: () => undefined } : null;
    return { goldGram: own > 0 ? own : m.goldGram, silverGram: m.silverGram, rate: m.rate };
  });
  readonly values = computed(() => {
    const p = this.prices(), cur = this.currency();
    return new Map(this.state().items.map((i) => [i.id, itemValue(i, p, cur)]));
  });
  /** Items that cannot be valued yet (gold before the prices load, an unknown currency). */
  readonly unpriced = computed(() => [...this.values().values()].filter((v) => v === null).length);
  readonly total = computed(() => [...this.values().values()].reduce<number>((s, v) => s + (v ?? 0), 0));
  readonly afterDebts = computed(() => Math.max(0, this.total() - this.state().funeral - this.state().debts));
  readonly willMax = computed(() => this.afterDebts() / 3);
  readonly willUsed = computed(() => Math.min(this.state().will, this.state().consent ? this.afterDebts() : this.willMax()));
  readonly deduction = computed(() => Math.min(this.total(), this.state().funeral + this.state().debts) + this.willUsed());
  readonly net = computed(() => Math.max(0, this.total() - this.deduction()));

  constructor() {
    effect(() => {
      const s = this.state();
      if (!this.loaded()) return;
      untracked(() => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void Preferences.set({ key: KEY, value: JSON.stringify(s) }).catch(() => {}), 400);
      });
    });
  }

  async load(): Promise<void> {
    if (this.loaded()) return;
    try {
      const { value } = await Preferences.get({ key: KEY });
      if (value) this.state.update((s) => ({ ...s, ...(JSON.parse(value) as Partial<Saved>) }));
    } catch { /* a fresh start */ }
    if (!this.state().currency) {
      // The country of the prayer-times city, else the phone's region.
      const cities = await this.locations.loadCities().catch(() => []);
      const loc = this.prayer.prayer().location;
      const near = loc ? nearestCity(cities, loc.latitude, loc.longitude)?.city.country : undefined;
      let region: string | undefined = near;
      try { region ??= new Intl.Locale(navigator.language || 'en').maximize().region; } catch { /* below */ }
      this.state.update((s) => ({ ...s, currency: currencyOf(region) ?? 'usd' }));
    }
    this.loaded.set(true);
    void this.metals.load();
  }

  update(patch: Partial<Saved>): void { this.state.update((s) => ({ ...s, ...patch })); }
  addItem(item: EstateItem): void { this.update({ items: [...this.state().items, item] }); }
  editItem(id: string, patch: Partial<EstateItem>): void {
    this.update({ items: this.state().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }
  removeItem(id: string): void { this.update({ items: this.state().items.filter((i) => i.id !== id) }); }
  rename(person: string, name: string): void { this.update({ names: { ...this.state().names, [person]: name } }); }
  clear(): void {
    this.update({ items: [], funeral: 0, debts: 0, will: 0, consent: false, names: {}, family: {}, text: '' });
  }
}
