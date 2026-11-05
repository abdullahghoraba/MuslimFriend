import { Component, computed, inject, input, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { IonButton, IonIcon, IonInput, IonSelect, IonSelectOption, IonSpinner } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Calculation } from '../../core/mawarith/engine';
import { DEBT, EstateItem, Person, divide, divisible } from '../../core/mawarith/estate';
import { EstateStore } from '../../core/mawarith/estate-store.service';
import { intlLocale } from '../../core/models';
import { SettingsService } from '../../core/services/settings.service';
import { Sheet, xlsx } from '../../core/util/xlsx';

/**
 * The estate divided among the heirs in kind: each person's money, grams of gold and foreign money, the whole things
 * they take, and what they pay or receive so that everyone gets exactly their share; exported as an Excel file.
 */
@Component({
  selector: 'app-mawarith-division',
  imports: [TranslatePipe, IonButton, IonIcon, IonInput, IonSelect, IonSelectOption, IonSpinner],
  template: `
    @if (people().length && store.net() > 0) {
      <section class="division">
        <h3>{{ 'mawarith.division.title' | translate }}</h3>
        <p class="hint">{{ 'mawarith.division.intro' | translate }}</p>
        @if (wholeItems().length) {
          <h4>{{ 'mawarith.division.wholeTitle' | translate }}</h4>
          @for (i of wholeItems(); track i.id) {
            <div class="whole">
              <span>{{ name(i) }} · {{ money(store.values().get(i.id) ?? 0) }}</span>
              <ion-select interface="action-sheet" [value]="i.to ?? 'auto'" (ionChange)="store.editItem(i.id, { to: $event.detail.value })" [attr.aria-label]="'mawarith.division.goesTo' | translate">
                <ion-select-option value="auto">{{ 'mawarith.division.auto' | translate }}</ion-select-option>
                <ion-select-option value="sell">{{ 'mawarith.division.sell' | translate }}</ion-select-option>
                @for (p of people(); track p.id) { <ion-select-option [value]="p.id">{{ p.label }}</ion-select-option> }
              </ion-select>
            </div>
          }
        }
        @if (division(); as d) {
          @for (l of d.lots; track l.person.id) {
            <article class="lot">
              <header>
                <ion-input class="who" [value]="l.person.label" (change)="rename(l.person.id, $event)" [attr.aria-label]="'mawarith.division.name' | translate" />
                <b>{{ money(l.person.target) }}</b>
              </header>
              <ul>
                @for (w of l.whole; track w.item.id) { <li>{{ emoji(w.item) }} {{ name(w.item) }} ({{ money(w.value) }})</li> }
                @for (p of l.parts; track p.item.id) { <li>{{ part(p.item, p.amount) }}@if (p.item.kind !== 'cash' && p.item.to !== 'sell') { <small> ({{ money(p.value) }})</small> }</li> }
                @for (t of paysOf(l.person.id); track $index) { <li class="pay">{{ 'mawarith.division.pays' | translate: { amount: money(t.amount), to: label(t.to) } }}</li> }
                @for (t of receivesOf(l.person.id); track $index) { <li class="get">{{ 'mawarith.division.receives' | translate: { amount: money(t.amount), from: label(t.from) } }}</li> }
              </ul>
            </article>
          }
          @if (d.uncovered > 0.005) { <p class="hint warn">{{ 'mawarith.division.uncovered' | translate: { amount: money(d.uncovered) } }}</p> }
          <p class="hint">{{ 'mawarith.division.fair' | translate }}</p>
        }
        <ion-button expand="block" (click)="export()" [disabled]="busy()"><ion-icon slot="start" name="download-outline" />{{ 'mawarith.division.excel' | translate }} @if (busy()) { <ion-spinner name="dots" /> }</ion-button>
        @if (status()) { <p class="hint" role="status">{{ status() | translate }}</p> }
      </section>
    }`,
  styles: `
    .division { padding: 12px; border: 1px solid var(--app-border); border-radius: 18px; background: var(--app-surface); margin: 12px 0; }
    h3 { font-size: 1rem; color: var(--ion-color-primary); margin: 4px 4px 6px; } h4 { font-size: .95rem; margin: 12px 4px 4px; }
    .hint { font-size: .85rem; color: var(--app-muted); margin: 6px 4px; line-height: 1.6; } .warn { color: var(--ion-color-warning-shade); }
    .whole { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--app-border); }
    .whole span { flex: 1; min-width: 0; } .whole ion-select { max-width: 50%; }
    .lot { border: 1px solid var(--app-border); border-radius: 14px; padding: 8px 12px; margin: 10px 0; background: var(--ion-background-color); }
    .lot header { display: flex; align-items: center; gap: 8px; } .lot header b { color: var(--ion-color-primary); white-space: nowrap; }
    .who { font-weight: 700; }
    ul { margin: 4px 0; padding-inline-start: 18px; } li { line-height: 1.8; }
    .pay { color: var(--ion-color-danger); } .get { color: var(--ion-color-success-shade); }
    ion-button { min-height: 44px; margin-top: 8px; }
  `,
})
export class MawarithDivisionComponent {
  readonly calc = input.required<Calculation>();
  readonly deceased = input<'m' | 'f'>('m');
  /** The four schools agree on this case (the school is then not named). */
  readonly agreed = input(false);
  readonly store = inject(EstateStore);
  private readonly translate = inject(TranslateService);
  private readonly settings = inject(SettingsService);
  readonly busy = signal(false);
  readonly status = signal('');

  /** Every heir who inherits, one by one («الابن ١», «الابن ٢»), with the name the reader gave them. */
  readonly people = computed<Person[]>(() => {
    const net = this.store.net();
    const names = this.store.state().names;
    const fmt = (n: number) => n.toLocaleString(intlLocale(this.settings.settings().language));
    return this.calc().shares.filter((s) => !s.total.isZero()).flatMap((s) =>
      Array.from({ length: s.count }, (_, k) => {
        const id = `${s.key}-${k + 1}`;
        const base = this.translate.instant('mawarith.heir.' + s.key) + (s.count > 1 ? ` ${fmt(k + 1)}` : '');
        return { id, label: names[id]?.trim() || base, target: net * s.total.toNumber() / s.count };
      }));
  });
  readonly wholeItems = computed(() => this.store.state().items.filter((i) => !divisible(i) || i.to === 'sell').filter((i) => ['property', 'land', 'shop', 'car', 'other'].includes(i.kind)));
  readonly division = computed(() => {
    const values = new Map<string, number>();
    for (const [k, v] of this.store.values()) values.set(k, v ?? 0);
    return divide(this.store.state().items, values, this.people(), this.store.deduction());
  });

  money(n: number): string {
    return `${n.toLocaleString(intlLocale(this.settings.settings().language), { maximumFractionDigits: 2 })} ${this.store.currency().toUpperCase()}`;
  }
  name(i: EstateItem): string { return i.label?.trim() || this.translate.instant('mawarith.assets.kinds.' + i.kind); }
  label(id: string): string {
    return id === DEBT ? this.translate.instant('mawarith.division.creditors') : this.people().find((p) => p.id === id)?.label ?? id;
  }
  part(i: EstateItem, amount: number): string {
    const n = (x: number, d = 2) => x.toLocaleString(intlLocale(this.settings.settings().language), { maximumFractionDigits: d });
    if (i.kind === 'gold') return this.translate.instant('mawarith.division.gold', { g: n(amount, 2), k: i.karat ?? 21, name: this.name(i) });
    if (i.kind === 'silver') return this.translate.instant('mawarith.division.silver', { g: n(amount, 2), name: this.name(i) });
    if (i.kind === 'currency') return `${n(amount)} ${(i.currency ?? '').toUpperCase()} — ${this.name(i)}`;
    if (i.to === 'sell') return this.translate.instant('mawarith.division.fromSale', { amount: this.money(amount), name: this.name(i) });
    return `${this.money(amount)} — ${this.name(i)}`;
  }
  emoji(i: EstateItem): string { return ({ property: '🏠', land: '🌾', shop: '🏪', car: '🚗' } as Record<string, string>)[i.kind] ?? '📦'; }
  paysOf(id: string) { return this.division().transfers.filter((t) => t.from === id); }
  receivesOf(id: string) { return this.division().transfers.filter((t) => t.to === id); }
  rename(id: string, e: Event): void { this.store.rename(id, String((e.target as HTMLInputElement | null)?.value ?? '')); }

  /** An Excel file with the shares, the estate and the division, shared (or downloaded in a browser). */
  async export(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.status.set('');
    try {
      const t = (k: string, p?: object) => this.translate.instant(k, p);
      const lang = this.settings.settings().language;
      const rtl = ['ar', 'ur', 'fa'].includes(lang);
      const cur = this.store.currency().toUpperCase();
      const r = this.calc();
      const net = this.store.net();
      const shares: Sheet = {
        name: t('mawarith.excel.shares'), rtl, bold: [0, 5], widths: [34, 8, 12, 12, 18, 18, 70],
        rows: [
          [t('mawarith.title')],
          [t(this.deceased() === 'm' ? 'mawarith.man' : 'mawarith.woman')],
          [t('mawarith.school'), this.agreed() ? t('mawarith.agree') : t('mawarith.schools.' + r.school)],
          [t('mawarith.asl'), r.asl, ...(r.awl ? [t('mawarith.awl'), r.awl] : []), t('mawarith.base'), r.base],
          [t('mawarith.excel.net'), round(net), cur],
          [t('mawarith.excel.heir'), t('mawarith.excel.count'), t('mawarith.share'), t('mawarith.each'), t('mawarith.excel.amountEach'), t('mawarith.excel.amountAll'), t('mawarith.excel.reason')],
          ...r.shares.map((s) => [
            t('mawarith.heir.' + s.key), s.count, s.total.toString(), s.total.div(s.count).toString(),
            round(net * s.total.toNumber() / s.count), round(net * s.total.toNumber()),
            t('mawarith.reason.' + s.reason, { by: (s.by ?? []).map((b) => t('mawarith.heir.' + b)).join('، ') }),
          ]),
          ...r.notes.map((n) => [t('mawarith.note.' + n)]),
        ],
      };
      const items = this.store.state().items.filter((i) => (this.store.values().get(i.id) ?? 0) > 0);
      const estate: Sheet = {
        name: t('mawarith.excel.estate'), rtl, bold: [0], widths: [30, 18, 16, 20],
        rows: [
          [t('mawarith.excel.item'), t('mawarith.excel.kind'), t('mawarith.excel.quantity'), `${t('mawarith.excel.value')} (${cur})`],
          ...items.map((i) => [this.name(i), t('mawarith.assets.kinds.' + i.kind),
            i.kind === 'gold' ? `${i.amount} g · ${i.karat ?? 21}K` : i.kind === 'silver' ? `${i.amount} g` : i.kind === 'currency' ? `${i.amount} ${(i.currency ?? '').toUpperCase()}` : i.area ? `${i.area} m²` : '',
            round(this.store.values().get(i.id) ?? 0)]),
          [t('mawarith.assets.total'), '', '', round(this.store.total())],
          [t('mawarith.funeral'), '', '', -round(this.store.state().funeral)],
          [t('mawarith.debts'), '', '', -round(this.store.state().debts)],
          [t('mawarith.will'), '', '', -round(this.store.willUsed())],
          [t('mawarith.excel.net'), '', '', round(net)],
          [t('mawarith.excel.prices', { date: this.store.metals.quotes()?.date ?? '' })],
        ],
      };
      const d = this.division();
      const division: Sheet = {
        name: t('mawarith.excel.division'), rtl, bold: [0], widths: [24, 18, 60, 18, 18],
        rows: [
          [t('mawarith.excel.person'), `${t('mawarith.excel.due')} (${cur})`, t('mawarith.excel.takes'), `${t('mawarith.excel.settle')} (${cur})`, `${t('mawarith.excel.total')} (${cur})`],
          ...d.lots.map((l) => [l.person.label, round(l.person.target),
            [...l.whole.map((w) => this.name(w.item)), ...l.parts.map((p) => this.part(p.item, p.amount))].join(' + '), round(l.settle), round(l.total)]),
          [],
          [t('mawarith.excel.transfers')],
          ...d.transfers.map((x) => [this.label(x.from), '→', this.label(x.to), round(x.amount)]),
        ],
      };
      const bytes = xlsx([shares, estate, division]);
      const fileName = `${t('mawarith.excel.file')}-${new Date().toISOString().slice(0, 10)}.xlsx`.replace(/[\\/:*?"<>|\s]+/g, '-');
      if (!Capacitor.isNativePlatform()) {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } else {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const file = await Filesystem.writeFile({ path: `share/${fileName}`, data: btoa(bin), directory: Directory.Cache, recursive: true });
        await Share.share({ title: t('mawarith.title'), files: [file.uri] }).catch((e: unknown) => { if (!/cancel/i.test(String(e))) throw e; });
      }
      this.status.set('mawarith.division.exported');
    } catch {
      this.status.set('mawarith.division.exportFailed');
    } finally {
      this.busy.set(false);
    }
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
