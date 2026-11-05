import { Component, computed, inject, input, signal } from '@angular/core';
import {
  IonButton, IonIcon, IonInput, IonItem, IonLabel, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonTextarea, IonToggle,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Calculation, SCHOOLS, School, Share, compareSchools } from '../../core/mawarith/engine';
import { Frac } from '../../core/mawarith/fraction';
import { Family, HEIR, HEIRS, HeirGroup, HeirKey } from '../../core/mawarith/heirs';
import { parseFamily } from '../../core/mawarith/parse';
import { intlLocale } from '../../core/models';
import { SettingsService } from '../../core/services/settings.service';

const GROUPS: HeirGroup[] = ['spouse', 'descendants', 'ascendants', 'siblings', 'relatives', 'arham'];

/**
 * One inheritance: who the deceased leaves, the estate, and each heir's share by the four schools. An heir who died
 * before the estate was divided opens their own case inside it (المناسخات), with their part as its estate.
 */
@Component({
  selector: 'app-mawarith-case',
  imports: [TranslatePipe, IonButton, IonIcon, IonInput, IonItem, IonLabel, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonTextarea, IonToggle],
  template: `
    <section class="smart">
      <h3>{{ 'mawarith.smartTitle' | translate }}</h3>
      <ion-textarea [value]="text()" (ionInput)="text.set($event.detail.value ?? '')" [autoGrow]="true" rows="2"
        [placeholder]="'mawarith.smartPlaceholder' | translate" [attr.aria-label]="'mawarith.smartTitle' | translate" />
      <ion-button expand="block" (click)="understand()" [disabled]="!text().trim()"><ion-icon slot="start" name="sparkles-outline" />{{ 'mawarith.understand' | translate }}</ion-button>
      @if (understood() !== null) {
        <p class="hint" role="status">{{ (understood() ? 'mawarith.understood' : 'mawarith.notUnderstood') | translate }}</p>
        @if (guessed().length) { <p class="hint warn">{{ 'mawarith.guessed' | translate: { names: names(guessed()) } }}</p> }
      }
    </section>

    @if (!fixedGender()) {
      <ion-segment [value]="deceased()" (ionChange)="setDeceased($event.detail.value)">
        <ion-segment-button value="m"><ion-label>{{ 'mawarith.man' | translate }}</ion-label></ion-segment-button>
        <ion-segment-button value="f"><ion-label>{{ 'mawarith.woman' | translate }}</ion-label></ion-segment-button>
      </ion-segment>
    }

    <section class="estate">
      @if (root()) {
        <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'mawarith.estate' | translate" labelPlacement="stacked"
          [value]="amount() || null" (ionInput)="amount.set(num($event.detail.value))" /></ion-item>
        <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'mawarith.funeral' | translate" labelPlacement="stacked"
          [value]="funeral() || null" (ionInput)="funeral.set(num($event.detail.value))" /></ion-item>
        <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'mawarith.debts' | translate" labelPlacement="stacked"
          [value]="debts() || null" (ionInput)="debts.set(num($event.detail.value))" /></ion-item>
        <ion-item><ion-input type="number" inputmode="decimal" min="0" [label]="'mawarith.will' | translate" labelPlacement="stacked"
          [value]="will() || null" (ionInput)="will.set(num($event.detail.value))" /></ion-item>
        @if (willCapped()) {
          <ion-item lines="none"><ion-toggle [checked]="consent()" (ionChange)="consent.set($event.detail.checked)">{{ 'mawarith.willConsent' | translate }}</ion-toggle></ion-item>
          @if (!consent()) { <p class="hint warn">{{ 'mawarith.willCapped' | translate: { max: money(willMax()) } }}</p> }
        }
        @if (amount() > 0) { <p class="net">{{ 'mawarith.net' | translate: { amount: money(net()) } }}</p> }
      } @else if (inherited() > 0) {
        <p class="net">{{ 'mawarith.inheritedPart' | translate: { amount: money(inherited()) } }}</p>
      }
    </section>

    @for (g of groups; track g) {
      @if (g !== 'arham' || showArham()) {
        <h3 class="group">{{ 'mawarith.group.' + g | translate }}</h3>
        @for (h of heirsOf(g); track h.key) {
          <div class="heir" [class.on]="count(h.key) > 0">
            <span class="name">{{ 'mawarith.heir.' + h.key | translate }}</span>
            <span class="stepper">
              <ion-button fill="clear" size="small" (click)="change(h.key, -1)" [disabled]="!count(h.key)" [attr.aria-label]="('mawarith.less' | translate) + ' ' + ('mawarith.heir.' + h.key | translate)"><ion-icon slot="icon-only" name="remove-outline" /></ion-button>
              <b aria-live="polite">{{ fmt(count(h.key)) }}</b>
              <ion-button fill="clear" size="small" (click)="change(h.key, 1)" [disabled]="count(h.key) >= h.max" [attr.aria-label]="('mawarith.more' | translate) + ' ' + ('mawarith.heir.' + h.key | translate)"><ion-icon slot="icon-only" name="add-outline" /></ion-button>
            </span>
          </div>
        }
      }
    }
    @if (!showArham()) {
      <ion-button fill="clear" expand="block" (click)="arhamOpen.set(true)">{{ 'mawarith.showArham' | translate }}</ion-button>
    }

    <ion-item lines="none" class="school">
      <ion-select [label]="'mawarith.school' | translate" labelPlacement="stacked" interface="action-sheet" [value]="school()" (ionChange)="school.set($event.detail.value)">
        <ion-select-option value="auto">{{ 'mawarith.schools.auto' | translate }}</ion-select-option>
        @for (s of schools; track s) { <ion-select-option [value]="s">{{ 'mawarith.schools.' + s | translate }}</ion-select-option> }
      </ion-select>
    </ion-item>

    @if (hasHeirs()) {
      @if (school() === 'auto') {
        @if (compared().same) { <p class="agree">{{ 'mawarith.agree' | translate }}</p> }
        @else {
          <p class="differ">{{ 'mawarith.differ' | translate }}</p>
          <ion-segment [scrollable]="true" [value]="tab()" (ionChange)="tab.set($any($event.detail.value))">
            @for (s of schools; track s) { <ion-segment-button [value]="s"><ion-label>{{ 'mawarith.schools.' + s | translate }}</ion-label></ion-segment-button> }
          </ion-segment>
        }
      }
      @if (shown(); as r) {
        <section class="result" [attr.aria-label]="'mawarith.result' | translate">
          <div class="summary">
            <span>{{ 'mawarith.asl' | translate }}: <b>{{ fmt(r.asl) }}</b></span>
            @if (r.awl) { <span>{{ 'mawarith.awl' | translate }}: <b>{{ fmt(r.awl) }}</b></span> }
            @if (r.radd) { <span>{{ 'mawarith.radd' | translate }}</span> }
            @if (r.base !== r.asl) { <span>{{ 'mawarith.base' | translate }}: <b>{{ fmt(r.base) }}</b></span> }
          </div>
          @if (r.special) { <p class="special">{{ 'mawarith.special.' + r.special | translate }}</p> }
          @for (s of r.shares; track s.key) {
            <article class="row" [class.out]="s.total.isZero()">
              <header>
                <span class="who">{{ 'mawarith.heir.' + s.key | translate }} @if (s.count > 1) { <small>× {{ fmt(s.count) }}</small> }</span>
                <span [class]="'kind ' + s.kind">{{ 'mawarith.kind.' + s.kind | translate }}</span>
              </header>
              @if (!s.total.isZero()) {
                <div class="nums">
                  <span>{{ 'mawarith.share' | translate }} <b dir="ltr">{{ frac(s.total) }}</b></span>
                  @if (s.count > 1) { <span>{{ 'mawarith.each' | translate }} <b dir="ltr">{{ frac(s.total.div(s.count)) }}</b></span> }
                  <span>{{ 'mawarith.sahm' | translate }} <b>{{ fmt(sahm(r, s)) }}</b>/{{ fmt(r.base) }}</span>
                  @if (estate() > 0) {
                    <span class="money">{{ money(estate() * s.total.toNumber()) }}@if (s.count > 1) { <small> ({{ 'mawarith.each' | translate }} {{ money(estate() * s.total.toNumber() / s.count) }})</small> }</span>
                  }
                </div>
              }
              <p class="reason">{{ reason(s) }}</p>
              @if (!s.total.isZero()) {
                @if (died().has(s.key)) {
                  <div class="nested">
                    <h4>{{ 'mawarith.heirsOf' | translate: { name: ('mawarith.heir.' + s.key | translate) } }}</h4>
                    <app-mawarith-case [fixedGender]="male(s.key) ? 'm' : 'f'" [inherited]="estate() * s.total.toNumber() / s.count" [depth]="depth() + 1" />
                    <ion-button fill="clear" size="small" (click)="toggleDied(s.key)">{{ 'mawarith.undoDied' | translate }}</ion-button>
                  </div>
                } @else if (depth() < 3) {
                  <ion-button fill="clear" size="small" class="died" (click)="toggleDied(s.key)">{{ 'mawarith.died' | translate }}</ion-button>
                }
              }
            </article>
          }
          @if (r.treasury) { <p class="special">{{ 'mawarith.treasury' | translate: { share: frac(r.treasury) } }}</p> }
          @for (n of r.notes; track n) { <p class="note">{{ 'mawarith.note.' + n | translate }}</p> }
        </section>
      }
    }`,
  styles: `
    :host { display: block; }
    ion-segment-button { min-height: 48px; } ion-segment-button ion-label { white-space: normal; line-height: 1.3; }
    h3 { font-size: 1rem; color: var(--ion-color-primary); margin: 18px 4px 6px; }
    .smart, .estate, .result { padding: 12px; border: 1px solid var(--app-border); border-radius: 18px; background: var(--app-surface); margin: 12px 0; }
    .smart h3 { margin-top: 0; }
    ion-textarea { --background: var(--ion-background-color); border-radius: 12px; padding-inline: 8px; margin-bottom: 8px; }
    .hint { font-size: .85rem; color: var(--app-muted); margin: 6px 4px; line-height: 1.6; }
    .warn { color: var(--ion-color-warning-shade); }
    .net { font-weight: 700; margin: 10px 4px 0; }
    .heir { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 10px; border-radius: 12px; }
    .heir.on { background: color-mix(in srgb, var(--ion-color-primary) 9%, transparent); }
    .heir .name { flex: 1; min-width: 0; line-height: 1.5; }
    .stepper { display: inline-flex; align-items: center; } .stepper b { min-width: 24px; text-align: center; }
    .stepper ion-button { min-width: 44px; min-height: 44px; margin: 0; }
    .school { margin-top: 12px; border-radius: 14px; }
    .agree, .differ { padding: 10px 12px; border-radius: 12px; line-height: 1.7; margin: 12px 0 6px; }
    .agree { background: color-mix(in srgb, var(--ion-color-success) 12%, transparent); }
    .differ { background: color-mix(in srgb, var(--ion-color-warning) 16%, transparent); }
    .summary { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .9rem; color: var(--app-muted); }
    .special, .note { line-height: 1.8; font-size: .9rem; margin: 8px 2px; }
    .special { padding: 8px 12px; border-radius: 12px; background: color-mix(in srgb, var(--ion-color-primary) 10%, transparent); }
    .note { color: var(--app-muted); }
    .row { border-top: 1px solid var(--app-border); padding: 10px 2px; }
    .row.out { opacity: .65; }
    .row header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .who { font-weight: 700; } .who small { font-weight: 400; color: var(--app-muted); }
    .kind { font-size: .75rem; padding: 2px 8px; border-radius: 999px; background: var(--ion-color-light); white-space: nowrap; }
    .kind.fard { background: color-mix(in srgb, var(--ion-color-primary) 16%, transparent); }
    .kind.asaba, .kind.fardAsaba { background: color-mix(in srgb, var(--ion-color-tertiary) 18%, transparent); }
    .kind.blocked, .kind.none { background: color-mix(in srgb, var(--ion-color-medium) 18%, transparent); }
    .kind.arham { background: color-mix(in srgb, var(--ion-color-secondary) 18%, transparent); }
    .nums { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: .92rem; }
    .money { font-weight: 700; color: var(--ion-color-primary); }
    .reason { margin: 6px 0 0; color: var(--app-muted); font-size: .88rem; line-height: 1.7; }
    .nested { margin-top: 8px; padding-inline-start: 10px; border-inline-start: 3px solid var(--ion-color-primary); }
    .nested h4 { margin: 6px 0; font-size: .95rem; }
    .died { --color: var(--ion-color-medium); font-size: .8rem; }
  `,
})
export class MawarithCaseComponent {
  /** Set for an heir who died before the division: their gender is known. */
  readonly fixedGender = input<'m' | 'f' | undefined>(undefined);
  /** The part this heir inherited from the first estate (an heir's own case). */
  readonly inherited = input(0);
  readonly depth = input(0);
  private readonly settings = inject(SettingsService);
  private readonly translate = inject(TranslateService);

  readonly groups = GROUPS;
  readonly schools = SCHOOLS;
  readonly text = signal('');
  readonly understood = signal<boolean | null>(null);
  readonly guessed = signal<HeirKey[]>([]);
  private readonly chosenGender = signal<'m' | 'f'>('m');
  readonly deceased = computed(() => this.fixedGender() ?? this.chosenGender());
  readonly family = signal<Family>({});
  readonly school = signal<'auto' | School>('auto');
  readonly tab = signal<School>('hanafi');
  readonly arhamOpen = signal(false);
  readonly died = signal(new Set<HeirKey>());
  readonly amount = signal(0);
  readonly funeral = signal(0);
  readonly debts = signal(0);
  readonly will = signal(0);
  readonly consent = signal(false);

  readonly root = computed(() => this.depth() === 0);
  readonly afterDebts = computed(() => Math.max(0, this.amount() - this.funeral() - this.debts()));
  readonly willMax = computed(() => this.afterDebts() / 3);
  readonly willCapped = computed(() => this.will() > this.willMax() + 1e-9);
  readonly net = computed(() => Math.max(0, this.afterDebts() - (this.consent() ? Math.min(this.will(), this.afterDebts()) : Math.min(this.will(), this.willMax()))));
  /** What is divided: the net estate, or the part an heir inherited. */
  readonly estate = computed(() => (this.root() ? this.net() : this.inherited()));

  readonly hasHeirs = computed(() => Object.values(this.family()).some((n) => (n ?? 0) > 0));
  readonly showArham = computed(() => this.arhamOpen() || HEIRS.some((h) => h.group === 'arham' && (this.family()[h.key] ?? 0) > 0));
  readonly compared = computed(() => compareSchools({ deceased: this.deceased(), family: this.family() }));
  readonly shown = computed<Calculation | null>(() => {
    if (!this.hasHeirs()) return null;
    const { results, same } = this.compared();
    const s = this.school();
    if (s !== 'auto') return results.find((r) => r.school === s)!;
    return same ? results[0] : results.find((r) => r.school === this.tab())!;
  });

  heirsOf(g: HeirGroup) { return HEIRS.filter((h) => h.group === g && (!h.only || h.only === this.deceased())); }
  count(k: HeirKey): number { return this.family()[k] ?? 0; }
  male(k: HeirKey): boolean { return HEIR[k].male; }
  change(k: HeirKey, d: number): void {
    this.family.update((f) => ({ ...f, [k]: Math.max(0, Math.min(HEIR[k].max, (f[k] ?? 0) + d)) }));
  }
  setDeceased(v: unknown): void {
    if (v !== 'm' && v !== 'f') return;
    this.chosenGender.set(v);
    // A husband for a man or a wife for a woman cannot be.
    this.family.update((f) => ({ ...f, husband: v === 'f' ? f.husband : 0, wife: v === 'm' ? f.wife : 0 }));
  }
  understand(): void {
    const p = parseFamily(this.text());
    const found = Object.keys(p.family).length > 0;
    this.understood.set(found);
    this.guessed.set(p.guessed);
    if (!found) return;
    if (p.deceased && !this.fixedGender()) this.chosenGender.set(p.deceased);
    this.family.set(p.family);
    if (HEIRS.some((h) => h.group === 'arham' && p.family[h.key])) this.arhamOpen.set(true);
  }
  toggleDied(k: HeirKey): void {
    this.died.update((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }

  num(v: unknown): number { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
  fmt(n: number): string { return n.toLocaleString(intlLocale(this.settings.settings().language)); }
  money(n: number): string { return n.toLocaleString(intlLocale(this.settings.settings().language), { maximumFractionDigits: 2 }); }
  frac(x: Frac): string { return x.d === 1n ? this.fmt(Number(x.n)) : `${this.fmt(Number(x.n))}/${this.fmt(Number(x.d))}`; }
  sahm(r: Calculation, s: Share): number { return s.total.mul(r.base).div(s.count).toNumber(); }
  names(keys: HeirKey[]): string { return keys.map((k) => this.translate.instant('mawarith.heir.' + k)).join('، '); }
  reason(s: Share): string {
    return this.translate.instant('mawarith.reason.' + s.reason, { by: s.by?.length ? this.names(s.by) : '' });
  }
}
