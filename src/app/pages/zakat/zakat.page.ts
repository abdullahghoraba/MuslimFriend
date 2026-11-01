import { Component, computed, inject, signal } from '@angular/core';
import {
  ActionSheetController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel,
  IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { Preferences } from '@capacitor/preferences';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { intlLocale } from '../../core/models';
import { countryName, nearestCity } from '../../core/prayer/location.service';
import { LocationService } from '../../core/prayer/location.service';
import { PrayerService } from '../../core/prayer/prayer.service';
import { MetalPricesService, pricesFrom } from '../../core/services/metal-prices.service';
import { SettingsService } from '../../core/services/settings.service';
import {
  ASSET_KINDS, AssetKind, KARATS, Karat, NISAB_GOLD_GRAMS, NISAB_SILVER_GRAMS, TROY_OUNCE_GRAMS, ZakatAsset, ZakatPrices,
  currencyOf, zakatOf,
} from '../../core/services/zakat';
import { SelectTextsDirective } from '../../shared/select-texts.directive';

const KEY = 'zakatV2';
const OLD_KEY = 'zakatInputs';
const ICONS: Record<AssetKind, string> = {
  cash: 'cash-outline', bank: 'business-outline', gold: 'diamond-outline', silver: 'diamond-outline', trade: 'cube-outline',
  receivable: 'arrow-down-circle-outline', stocks: 'trending-up-outline', other: 'wallet-outline', debt: 'arrow-up-circle-outline',
};

interface Saved {
  country: string;
  currency: string;
  nisab: 'gold' | 'silver';
  assets: ZakatAsset[];
  /** The reader's own prices per gram (a local jeweller's), instead of the market price. */
  own: { on: boolean; gold: number; silver: number };
}

/**
 * Zakat calculator: the reader lists what they own (money in any currency, gold by karat, silver, trade goods, money
 * owed to them, shares) and their debts; gold and silver are valued at today's price in their country's currency,
 * fetched online, and the zakat is worked out at once. Everything is kept on the phone.
 */
@Component({
  selector: 'app-zakat',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonInput,
    IonLabel, IonNote, IonSegment, IonSegmentButton, IonSelect, SelectTextsDirective, IonSelectOption, IonButton, IonIcon, IonSpinner,
    IonToggle,
  ],
  templateUrl: './zakat.page.html',
  styleUrl: './zakat.page.scss',
})
export class ZakatPage {
  private readonly settings = inject(SettingsService);
  private readonly prayer = inject(PrayerService);
  private readonly locations = inject(LocationService);
  private readonly sheets = inject(ActionSheetController);
  private readonly translate = inject(TranslateService);
  readonly metals = inject(MetalPricesService);

  readonly lang = computed(() => this.settings.settings().language);
  readonly state = signal<Saved>({ country: '', currency: 'usd', nisab: 'silver', assets: [], own: { on: false, gold: 0, silver: 0 } });
  readonly countries = signal<{ code: string; name: string }[]>([]);
  readonly karats = KARATS;
  readonly goldGrams = NISAB_GOLD_GRAMS;
  readonly silverGrams = NISAB_SILVER_GRAMS;
  private saveTimer?: ReturnType<typeof setTimeout>;

  /** The market prices in the chosen currency, or the reader's own prices when they set them. */
  readonly prices = computed<ZakatPrices | null>(() => {
    const q = this.metals.quotes();
    const s = this.state();
    const market = q ? pricesFrom(q, s.currency) : null;
    if (!s.own.on || !(s.own.gold > 0) || !(s.own.silver > 0)) return market;
    // Own prices: per gram of 24 karat gold and of silver; other currencies still convert at the market rate.
    return { currency: s.currency, goldGram: s.own.gold, silverGram: s.own.silver, rate: market?.rate ?? (() => undefined) };
  });
  readonly result = computed(() => {
    const p = this.prices();
    return p ? zakatOf(this.state().assets, p, this.state().nisab) : null;
  });
  readonly currencies = computed(() => {
    const list = this.metals.currencies();
    return list.length ? list : [this.state().currency];
  });

  async ionViewWillEnter(): Promise<void> {
    await this.restore();
    void this.metals.load();
    const cities = await this.locations.loadCities().catch(() => []);
    const codes = [...new Set(cities.map((c) => c.country))];
    this.countries.set(codes.map((code) => ({ code, name: countryName(code, this.lang()) })).sort((a, b) => a.name.localeCompare(b.name, this.lang())));
    if (!this.state().country) {
      // The country of the prayer-times city, else the phone's region.
      const loc = this.prayer.prayer().location;
      const near = loc ? nearestCity(cities, loc.latitude, loc.longitude)?.city.country : undefined;
      const region = near ?? new Intl.Locale(navigator.language || 'en').maximize().region ?? 'SA';
      this.setCountry(region);
    }
  }

  // ---- edits ----

  setCountry(code: string): void {
    this.update({ country: code, currency: currencyOf(code) ?? this.state().currency });
  }

  setCurrency(code: unknown): void {
    if (typeof code === 'string' && code) this.update({ currency: code });
  }

  setNisab(value: unknown): void {
    this.update({ nisab: value === 'gold' ? 'gold' : 'silver' });
  }

  async add(): Promise<void> {
    const t = (k: string) => this.translate.instant(k);
    const sheet = await this.sheets.create({
      header: t('zakat.add'),
      buttons: [
        ...ASSET_KINDS.map((kind) => ({ text: t('zakat.kinds.' + kind), icon: ICONS[kind], data: kind })),
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
    const { data } = await sheet.onDidDismiss();
    if (!ASSET_KINDS.includes(data)) return;
    const kind = data as AssetKind;
    const asset: ZakatAsset = { id: Date.now().toString(36), kind, label: '', amount: 0, ...(kind === 'gold' ? { karat: 21 as Karat } : {}) };
    this.update({ assets: [...this.state().assets, asset] });
  }

  edit(id: string, patch: Partial<ZakatAsset>): void {
    this.update({ assets: this.state().assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }

  setAmount(id: string, value: unknown): void {
    this.edit(id, { amount: toNumber(value) });
  }

  setKarat(id: string, value: unknown): void {
    const k = Number(value) as Karat;
    if (KARATS.includes(k)) this.edit(id, { karat: k });
  }

  remove(id: string): void {
    this.update({ assets: this.state().assets.filter((a) => a.id !== id) });
  }

  setOwn(patch: Partial<Saved['own']>): void {
    const own = { ...this.state().own, ...patch };
    // Start from today's market prices so the reader only adjusts them.
    const market = this.metals.quotes() ? pricesFrom(this.metals.quotes()!, this.state().currency) : null;
    if (patch.on && market) {
      if (!(own.gold > 0)) own.gold = round(market.goldGram);
      if (!(own.silver > 0)) own.silver = round(market.silverGram, 2);
    }
    this.update({ own });
  }

  setOwnPrice(metal: 'gold' | 'silver', value: unknown): void {
    this.setOwn({ [metal]: toNumber(value) });
  }

  // ---- display ----

  icon(kind: AssetKind): string {
    return ICONS[kind];
  }

  isMetal(a: ZakatAsset): boolean {
    return a.kind === 'gold' || a.kind === 'silver';
  }

  lineValue(id: string): number | null | undefined {
    return this.result()?.lines.find((l) => l.id === id)?.value;
  }

  money(x: number, currency = this.state().currency): string {
    try {
      return new Intl.NumberFormat(intlLocale(this.lang()), { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: x >= 100 ? 0 : 2 }).format(x);
    } catch {
      return `${this.number(x)} ${currency.toUpperCase()}`;
    }
  }

  number(x: number, digits = 2): string {
    return new Intl.NumberFormat(intlLocale(this.lang()), { maximumFractionDigits: digits }).format(x);
  }

  /** Price of one gram of [karat] gold. */
  goldPrice(karat: number): string {
    const p = this.prices();
    return p ? this.money((p.goldGram * karat) / 24) : '';
  }

  ounce(): number {
    return TROY_OUNCE_GRAMS;
  }

  dateLabel(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    if (!y) return date;
    return new Intl.DateTimeFormat(intlLocale(this.lang()), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
  }

  clearAll(): void {
    this.update({ assets: [] });
  }

  // ---- storage ----

  private update(patch: Partial<Saved>): void {
    this.state.update((s) => ({ ...s, ...patch }));
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void Preferences.set({ key: KEY, value: JSON.stringify(this.state()) }), 300);
  }

  private async restore(): Promise<void> {
    const { value } = await Preferences.get({ key: KEY });
    try {
      if (value) {
        const saved = JSON.parse(value) as Partial<Saved>;
        this.state.update((s) => ({ ...s, ...saved, own: { ...s.own, ...saved.own }, assets: Array.isArray(saved.assets) ? saved.assets : [] }));
        return;
      }
    } catch {
      /* start fresh */
    }
    // The first calculator kept one number per kind: carry them over as properties.
    const old = await Preferences.get({ key: OLD_KEY });
    try {
      const i = old.value ? JSON.parse(old.value).input : null;
      if (!i) return;
      const assets: ZakatAsset[] = [];
      const add = (kind: AssetKind, amount: number, extra: Partial<ZakatAsset> = {}) => amount > 0 && assets.push({ id: kind, kind, label: '', amount, ...extra });
      add('cash', i.cash);
      add('gold', i.gold, { karat: i.goldKarat });
      add('silver', i.silver);
      add('trade', i.trade);
      add('receivable', i.receivables);
      add('debt', i.debts);
      this.state.update((s) => ({ ...s, assets, nisab: i.nisab === 'gold' ? 'gold' : 'silver' }));
    } catch {
      /* nothing to carry over */
    }
  }
}

function toNumber(value: unknown): number {
  const x = Number(String(value ?? '').replace(/[,\s]/g, (c) => (c === ',' ? '.' : '')));
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function round(x: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
