import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { IonSelect, IonSelectOption, IonSpinner } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { intlLocale } from '../../core/models';
import { RecallSegment } from '../../core/quran/recall-test';
import { QuranService } from '../../core/quran/quran.service';
import { splitBasmala } from '../../core/quran/quran-utils';
import { SettingsService } from '../../core/services/settings.service';
import { RecallTestComponent } from '../../shared/recall-test.component';
import { SelectTextsDirective } from '../../shared/select-texts.directive';

/**
 * «Test yourself» (اختبر حفظك), the Hifz page's third tab: the ayat hidden, recite from memory and reveal them to
 * check. The host gives the ayat (a plan's portion, /hifz?tab=test&sura=67&from=1&to=10); the reader can change them.
 */
@Component({
  selector: 'app-hifz-test',
  imports: [TranslatePipe, RecallTestComponent, IonSelect, SelectTextsDirective, IonSelectOption, IonSpinner],
  template: `
    <div class="ion-padding">
      @if (!quran.ready()) {
        <ion-spinner />
      } @else {
        <div class="pick">
          <ion-select [label]="'hifz.fromSura' | translate" interface="action-sheet" [value]="sura()" (ionChange)="setSura(+$event.detail.value)">
            @for (s of quran.suras; track s.index) { <ion-select-option [value]="s.index">{{ suraName(s.index) }}</ion-select-option> }
          </ion-select>
          <ion-select [label]="'hifz.fromAya' | translate" interface="popover" [value]="from()" (ionChange)="setFrom(+$event.detail.value)">
            @for (a of ayat(); track a) { <ion-select-option [value]="a">{{ number(a) }}</ion-select-option> }
          </ion-select>
          <ion-select [label]="'hifz.toAya' | translate" interface="popover" [value]="to()" (ionChange)="to.set(+$event.detail.value)">
            @for (a of ayat(); track a) { @if (a >= from()) { <ion-select-option [value]="a">{{ number(a) }}</ion-select-option> } }
          </ion-select>
        </div>
        <p class="note">{{ 'recall.intro' | translate }}</p>
        <app-recall-test [segments]="segments()" [quran]="true" />
      }
    </div>
  `,
  styles: `
    .pick { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
    .pick ion-select:first-child { grid-column: 1 / -1; }
    .note { font-size: 0.85rem; color: var(--app-muted); }
  `,
})
export class HifzTestComponent {
  /** The ayat to test (from the host). */
  readonly startSura = input<number | undefined>(undefined);
  readonly startFrom = input<number | undefined>(undefined);
  readonly startTo = input<number | undefined>(undefined);

  readonly quran = inject(QuranService);
  private readonly settings = inject(SettingsService);
  private readonly lang = computed(() => this.settings.settings().language);

  readonly sura = signal(67);
  readonly from = signal(1);
  readonly to = signal(5);
  readonly ayat = computed(() => (this.quran.ready() ? Array.from({ length: this.quran.sura(this.sura()).ayas }, (_, i) => i + 1) : []));

  readonly segments = computed<RecallSegment[]>(() => {
    if (!this.quran.ready()) return [];
    const start = this.quran.ayah({ sura: this.sura(), aya: this.from() }).index;
    const out: RecallSegment[] = [];
    for (let aya = this.from(); aya <= this.to(); aya++) {
      const ref = { sura: this.sura(), aya };
      out.push({ label: new Intl.NumberFormat('ar-EG').format(aya), text: splitBasmala(ref, this.quran.ayahAt(start + aya - this.from()).text).text });
    }
    return out;
  });

  constructor() {
    void this.quran.load();
    // A new range from the host (another plan's portion).
    effect(() => {
      const sura = Number(this.startSura());
      const f = Number(this.startFrom());
      const t = Number(this.startTo());
      if (!this.quran.ready() || !(sura >= 1 && sura <= 114)) return;
      untracked(() => {
        const ayas = this.quran.sura(sura).ayas;
        const from = Math.min(Math.max(1, f || 1), ayas);
        this.sura.set(sura);
        this.from.set(from);
        this.to.set(Math.min(Math.max(from, t || ayas), ayas));
      });
    });
  }

  setSura(sura: number): void {
    this.sura.set(sura);
    this.from.set(1);
    this.to.set(Math.min(this.quran.sura(sura).ayas, 10));
  }

  setFrom(from: number): void {
    this.from.set(from);
    if (this.to() < from) this.to.set(from);
  }

  suraName(n: number): string {
    const s = this.quran.sura(n);
    return `${this.number(n)}. ${this.lang() === 'ar' ? s.name : s.tname}`;
  }

  number(n: number): string {
    return new Intl.NumberFormat(intlLocale(this.lang())).format(n);
  }
}
