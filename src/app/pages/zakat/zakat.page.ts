import { Component, computed, inject, signal } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonNote,
  IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonTitle, IonToolbar,
} from '@ionic/angular';
import { Preferences } from '@capacitor/preferences';
import { TranslatePipe } from '@ngx-translate/core';
import { intlLocale } from '../../core/models';
import { SettingsService } from '../../core/services/settings.service';
import { EMPTY_ZAKAT, NISAB_GOLD_GRAMS, NISAB_SILVER_GRAMS, ZakatInput, zakat } from '../../core/services/zakat';
import { SelectTextsDirective } from '../../shared/select-texts.directive';

const KEY = 'zakatInputs';
type NumberField = 'cash' | 'gold' | 'silver' | 'goldPrice' | 'silverPrice' | 'trade' | 'receivables' | 'debts';

/** Zakat on money, gold, silver and trade goods. Everything stays on the phone; prices are typed by the reader. */
@Component({
  selector: 'app-zakat',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonListHeader, IonItem,
    IonInput, IonLabel, IonNote, IonSegment, IonSegmentButton, IonSelect, SelectTextsDirective, IonSelectOption, IonButton,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/home" [text]="''" [attr.aria-label]="'common.back' | translate" /></ion-buttons>
        <ion-title>{{ 'zakat.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <section class="result" role="status" aria-live="polite">
        @if (result().due === null) {
          <p>{{ 'zakat.needPrice' | translate }}</p>
        } @else if (result().due) {
          <span class="label">{{ 'zakat.due' | translate }}</span>
          <strong class="amount">{{ money(result().amount) }}</strong>
          <span class="sub">{{ 'zakat.ofTotal' | translate: { total: money(result().total) } }}</span>
        } @else {
          <strong>{{ 'zakat.notDue' | translate }}</strong>
          <span class="sub">{{ 'zakat.belowNisab' | translate: { total: money(result().total), nisab: money(result().nisabValue ?? 0) } }}</span>
        }
      </section>

      <ion-list inset>
        <ion-list-header>{{ 'zakat.nisab' | translate }}</ion-list-header>
        <ion-item>
          <ion-segment [value]="input().nisab" (ionChange)="set('nisab', $event.detail.value === 'gold' ? 'gold' : 'silver')">
            <ion-segment-button value="silver"><ion-label>{{ 'zakat.silverNisab' | translate: { g: number(silverGrams) } }}</ion-label></ion-segment-button>
            <ion-segment-button value="gold"><ion-label>{{ 'zakat.goldNisab' | translate: { g: number(goldGrams) } }}</ion-label></ion-segment-button>
          </ion-segment>
        </ion-item>
        <ion-item><ion-note class="help">{{ 'zakat.nisabHelp' | translate }}</ion-note></ion-item>
        <ion-item><ion-input [label]="'zakat.currency' | translate" labelPlacement="stacked" [value]="currency()" maxlength="8"
                             [placeholder]="'zakat.currencyHint' | translate" (ionInput)="setCurrency($event.detail.value ?? '')" /></ion-item>
      </ion-list>

      <ion-list inset>
        <ion-list-header>{{ 'zakat.prices' | translate }}</ion-list-header>
        @for (f of priceFields; track f) {
          <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'zakat.' + f | translate" labelPlacement="stacked"
                               [value]="input()[f] || null" (ionInput)="setNumber(f, $event.detail.value)" /></ion-item>
        }
      </ion-list>

      <ion-list inset>
        <ion-list-header>{{ 'zakat.wealth' | translate }}</ion-list-header>
        @for (f of wealthFields; track f) {
          <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'zakat.' + f | translate" labelPlacement="stacked"
                               [value]="input()[f] || null" (ionInput)="setNumber(f, $event.detail.value)" /></ion-item>
          @if (f === 'gold') {
            <ion-item>
              <ion-select [label]="'zakat.karat' | translate" interface="popover" [value]="input().goldKarat" (ionChange)="setKarat($event.detail.value)">
                @for (k of karats; track k) { <ion-select-option [value]="k">{{ number(k) }}</ion-select-option> }
              </ion-select>
            </ion-item>
          }
        }
      </ion-list>

      <ion-list inset>
        <ion-list-header>{{ 'zakat.debtsTitle' | translate }}</ion-list-header>
        <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'zakat.debts' | translate" labelPlacement="stacked"
                             [value]="input().debts || null" (ionInput)="setNumber('debts', $event.detail.value)" /></ion-item>
      </ion-list>

      <section class="notes">
        <p>{{ 'zakat.noteHawl' | translate }}</p>
        <p>{{ 'zakat.noteJewellery' | translate }}</p>
        <p>{{ 'zakat.noteScholar' | translate }}</p>
        <ion-button fill="clear" size="small" color="medium" (click)="clear()">{{ 'zakat.clear' | translate }}</ion-button>
      </section>
    </ion-content>
  `,
  styles: `
    .result { margin: 12px 16px; padding: 18px; border-radius: 18px; background: var(--app-surface); border: 1px solid var(--app-border); display: grid; gap: 4px; text-align: center; }
    .result .label, .result .sub { color: var(--app-muted); font-size: 0.9rem; }
    .result .amount { font-size: 2rem; color: var(--ion-color-primary); }
    .help { white-space: normal; font-size: 0.8rem; padding-block: 6px; }
    .notes { padding: 0 20px calc(16px + var(--ion-safe-area-bottom, 0px)); color: var(--app-muted); font-size: 0.85rem; line-height: 1.6; }
    ion-segment { width: 100%; }
  `,
})
export class ZakatPage {
  private readonly settings = inject(SettingsService);
  private readonly lang = computed(() => this.settings.settings().language);
  readonly input = signal<ZakatInput>({ ...EMPTY_ZAKAT });
  readonly currency = signal('');
  readonly result = computed(() => zakat(this.input()));
  readonly priceFields: NumberField[] = ['goldPrice', 'silverPrice'];
  readonly wealthFields: NumberField[] = ['cash', 'gold', 'silver', 'trade', 'receivables'];
  readonly karats = [24, 22, 21, 18] as const;
  readonly goldGrams = NISAB_GOLD_GRAMS;
  readonly silverGrams = NISAB_SILVER_GRAMS;
  private saveTimer?: ReturnType<typeof setTimeout>;

  async ionViewWillEnter(): Promise<void> {
    const { value } = await Preferences.get({ key: KEY });
    try {
      const saved = value ? JSON.parse(value) : null;
      if (saved) {
        this.input.set({ ...EMPTY_ZAKAT, ...saved.input });
        this.currency.set(typeof saved.currency === 'string' ? saved.currency : '');
      }
    } catch {
      /* start empty */
    }
  }

  setNumber(field: NumberField, value: string | number | null | undefined): void {
    const x = Number(String(value ?? '').replace(',', '.'));
    this.set(field, Number.isFinite(x) && x > 0 ? x : 0);
  }

  set<K extends keyof ZakatInput>(field: K, value: ZakatInput[K]): void {
    this.input.update((i) => ({ ...i, [field]: value }));
    this.save();
  }

  setKarat(value: unknown): void {
    const k = Number(value);
    if (k === 24 || k === 22 || k === 21 || k === 18) this.set('goldKarat', k);
  }

  setCurrency(value: string): void {
    this.currency.set(value.trim());
    this.save();
  }

  clear(): void {
    this.input.set({ ...EMPTY_ZAKAT, nisab: this.input().nisab, goldPrice: this.input().goldPrice, silverPrice: this.input().silverPrice });
    this.save();
  }

  money(x: number): string {
    const s = new Intl.NumberFormat(intlLocale(this.lang()), { maximumFractionDigits: 2 }).format(x);
    return this.currency() ? `${s} ${this.currency()}` : s;
  }

  number(x: number): string {
    return new Intl.NumberFormat(intlLocale(this.lang())).format(x);
  }

  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void Preferences.set({ key: KEY, value: JSON.stringify({ input: this.input(), currency: this.currency() }) }), 400);
  }
}
