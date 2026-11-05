import { Component, computed, inject } from '@angular/core';
import {
  ActionSheetController, IonButton, IonIcon, IonInput, IonItem, IonSelect, IonSelectOption, IonSpinner, IonToggle,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ESTATE_KINDS, EstateItem, EstateKind, GoldKarat } from '../../core/mawarith/estate';
import { EstateStore } from '../../core/mawarith/estate-store.service';
import { intlLocale } from '../../core/models';
import { SettingsService } from '../../core/services/settings.service';

const ICONS: Record<EstateKind, string> = {
  cash: 'cash-outline', currency: 'cash-outline', gold: 'diamond-outline', silver: 'diamond-outline', property: 'business-outline',
  land: 'map-outline', shop: 'storefront-outline', car: 'car-outline', other: 'cube-outline',
};
const CURRENCIES = ['usd', 'eur', 'sar', 'aed', 'kwd', 'qar', 'gbp', 'egp', 'try', 'jod', 'omr', 'bhd', 'myr', 'idr', 'pkr', 'inr', 'bdt'];

/** What the deceased left: money, foreign money, gold, silver and things, valued at today's prices in one currency. */
@Component({
  selector: 'app-mawarith-assets',
  imports: [TranslatePipe, IonButton, IonIcon, IonInput, IonItem, IonSelect, IonSelectOption, IonSpinner, IonToggle],
  template: `
    <section class="estate">
      <h3>{{ 'mawarith.assets.title' | translate }}</h3>
      <ion-item lines="none">
        <ion-select [label]="'mawarith.assets.currency' | translate" labelPlacement="stacked" interface="action-sheet" [value]="store.currency()" (ionChange)="store.update({ currency: $event.detail.value })">
          @for (c of currencies(); track c) { <ion-select-option [value]="c">{{ c.toUpperCase() }}</ion-select-option> }
        </ion-select>
      </ion-item>
      <p class="hint">
        @if (store.metals.loading()) { <ion-spinner name="dots" /> }
        @if (store.market(); as m) {
          {{ 'mawarith.assets.goldPrice' | translate: { g24: money(m.goldGram), g21: money(m.goldGram * 21 / 24), cur: store.currency().toUpperCase(), date: store.metals.quotes()?.date } }}
        } @else if (!store.metals.loading()) { {{ 'mawarith.assets.noPrices' | translate }} }
      </p>
      <ion-item lines="none"><ion-input type="number" inputmode="decimal" min="0" [label]="'mawarith.assets.ownGold' | translate" labelPlacement="stacked"
        [value]="store.state().ownGold || null" (ionInput)="store.update({ ownGold: num($event.detail.value) })" /></ion-item>

      @for (i of store.state().items; track i.id) {
        <div class="asset">
          <div class="row">
            <ion-icon [name]="icon(i.kind)" aria-hidden="true" />
            <ion-input class="label" [value]="i.label" [placeholder]="'mawarith.assets.kinds.' + i.kind | translate" (ionInput)="store.editItem(i.id, { label: $event.detail.value ?? '' })"
              [attr.aria-label]="'mawarith.assets.name' | translate" />
            <ion-button fill="clear" size="small" (click)="store.removeItem(i.id)" [attr.aria-label]="'mawarith.assets.remove' | translate"><ion-icon slot="icon-only" name="trash-outline" /></ion-button>
          </div>
          <div class="row fields">
            <ion-input type="number" inputmode="decimal" min="0" [value]="i.amount || null" (ionInput)="store.editItem(i.id, { amount: num($event.detail.value) })"
              [label]="amountLabel(i) | translate" labelPlacement="stacked" />
            @if (i.kind === 'currency') {
              <ion-select [label]="'mawarith.assets.currency' | translate" labelPlacement="stacked" interface="action-sheet" [value]="i.currency" (ionChange)="store.editItem(i.id, { currency: $event.detail.value })">
                @for (c of currencies(); track c) { <ion-select-option [value]="c">{{ c.toUpperCase() }}</ion-select-option> }
              </ion-select>
            }
            @if (i.kind === 'gold') {
              <ion-select [label]="'mawarith.assets.karat' | translate" labelPlacement="stacked" interface="popover" [value]="i.karat ?? 21" (ionChange)="store.editItem(i.id, { karat: $event.detail.value })">
                @for (k of karats; track k) { <ion-select-option [value]="k">{{ k }}</ion-select-option> }
              </ion-select>
            }
          </div>
          @if (i.kind === 'property' || i.kind === 'land' || i.kind === 'shop') {
            <div class="row fields">
              <ion-input type="number" inputmode="decimal" min="0" [value]="i.area || null" (ionInput)="store.editItem(i.id, { area: num($event.detail.value) })" [label]="'mawarith.assets.area' | translate" labelPlacement="stacked" />
              <ion-input type="number" inputmode="decimal" min="0" [value]="i.pricePerM2 || null" (ionInput)="store.editItem(i.id, { pricePerM2: num($event.detail.value) })" [label]="'mawarith.assets.pricePerM2' | translate" labelPlacement="stacked" />
            </div>
          }
          <p class="value">
            @if (value(i.id); as v) { {{ 'mawarith.assets.worth' | translate: { amount: money(v), cur: store.currency().toUpperCase() } }} }
            @else if (value(i.id) === null) { <span class="warn">{{ 'mawarith.assets.unpriced' | translate }}</span> }
          </p>
        </div>
      }
      <ion-button expand="block" fill="outline" (click)="add()"><ion-icon slot="start" name="add-outline" />{{ 'mawarith.assets.add' | translate }}</ion-button>
      <p class="hint">{{ 'mawarith.assets.propertyHint' | translate }}</p>

      <h3>{{ 'mawarith.assets.deductions' | translate }}</h3>
      <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'mawarith.funeral' | translate" labelPlacement="stacked"
        [value]="store.state().funeral || null" (ionInput)="store.update({ funeral: num($event.detail.value) })" /></ion-item>
      <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'mawarith.debts' | translate" labelPlacement="stacked"
        [value]="store.state().debts || null" (ionInput)="store.update({ debts: num($event.detail.value) })" /></ion-item>
      <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'mawarith.will' | translate" labelPlacement="stacked"
        [value]="store.state().will || null" (ionInput)="store.update({ will: num($event.detail.value) })" /></ion-item>
      @if (store.state().will > store.willMax() + 1e-9) {
        <ion-item lines="none"><ion-toggle [checked]="store.state().consent" (ionChange)="store.update({ consent: $event.detail.checked })">{{ 'mawarith.willConsent' | translate }}</ion-toggle></ion-item>
        @if (!store.state().consent) { <p class="hint warn">{{ 'mawarith.willCapped' | translate: { max: money(store.willMax()) } }}</p> }
      }
      <div class="totals">
        <span>{{ 'mawarith.assets.total' | translate }}: <b>{{ money(store.total()) }}</b></span>
        @if (store.deduction() > 0) { <span>{{ 'mawarith.assets.deducted' | translate }}: <b>{{ money(store.deduction()) }}</b></span> }
        <span class="net">{{ 'mawarith.net' | translate: { amount: money(store.net()) + ' ' + store.currency().toUpperCase() } }}</span>
      </div>
    </section>`,
  styles: `
    .estate { padding: 12px; border: 1px solid var(--app-border); border-radius: 18px; background: var(--app-surface); margin: 12px 0; }
    h3 { font-size: 1rem; color: var(--ion-color-primary); margin: 10px 4px 6px; }
    .hint { font-size: .85rem; color: var(--app-muted); margin: 6px 4px; line-height: 1.6; }
    .warn { color: var(--ion-color-warning-shade); }
    .asset { border: 1px solid var(--app-border); border-radius: 14px; padding: 6px 10px; margin: 8px 0; background: var(--ion-background-color); }
    .row { display: flex; align-items: center; gap: 8px; }
    .row ion-icon { color: var(--ion-color-primary); flex: none; }
    .label { font-weight: 700; }
    .fields > * { flex: 1; min-width: 0; }
    .value { margin: 4px 2px; font-size: .9rem; color: var(--ion-color-primary); font-weight: 700; }
    .totals { display: flex; flex-direction: column; gap: 4px; margin: 10px 4px 0; }
    .net { font-weight: 700; font-size: 1.05rem; }
    ion-button { min-height: 44px; }
  `,
})
export class MawarithAssetsComponent {
  readonly store = inject(EstateStore);
  private readonly sheets = inject(ActionSheetController);
  private readonly translate = inject(TranslateService);
  private readonly settings = inject(SettingsService);
  readonly karats: GoldKarat[] = [24, 22, 21, 18];
  readonly currencies = computed(() => {
    const all = this.store.metals.currencies();
    const main = this.store.currency();
    const list = all.length ? all : CURRENCIES;
    return [main, ...CURRENCIES.filter((c) => c !== main && list.includes(c)), ...list.filter((c) => c !== main && !CURRENCIES.includes(c))];
  });

  icon(k: EstateKind): string { return ICONS[k]; }
  value(id: string): number | null | undefined { return this.store.values().get(id); }
  num(v: unknown): number { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
  money(n: number): string { return n.toLocaleString(intlLocale(this.settings.settings().language), { maximumFractionDigits: 2 }); }
  amountLabel(i: EstateItem): string {
    if (i.kind === 'gold' || i.kind === 'silver') return 'mawarith.assets.grams';
    if (i.kind === 'currency') return 'mawarith.assets.amount';
    if (i.kind === 'cash') return 'mawarith.assets.amountMain';
    return 'mawarith.assets.value';
  }

  async add(): Promise<void> {
    const t = (k: string) => this.translate.instant(k);
    const sheet = await this.sheets.create({
      header: t('mawarith.assets.add'),
      buttons: [...ESTATE_KINDS.map((k) => ({ text: t('mawarith.assets.kinds.' + k), icon: ICONS[k], data: k })), { text: t('common.cancel'), role: 'cancel' }],
    });
    await sheet.present();
    const { data } = await sheet.onDidDismiss();
    if (!ESTATE_KINDS.includes(data)) return;
    const kind = data as EstateKind;
    this.store.addItem({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind, label: '', amount: 0,
      ...(kind === 'gold' ? { karat: 21 as GoldKarat } : {}), ...(kind === 'currency' ? { currency: 'usd' } : {}),
    });
  }
}
