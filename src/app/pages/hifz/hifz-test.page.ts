import { Component, computed, inject, input, signal } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { intlLocale } from '../../core/models';
import { RecallSegment } from '../../core/quran/recall-test';
import { QuranService } from '../../core/quran/quran.service';
import { splitBasmala } from '../../core/quran/quran-utils';
import { SettingsService } from '../../core/services/settings.service';
import { RecallTestComponent } from '../../shared/recall-test.component';
import { SelectTextsDirective } from '../../shared/select-texts.directive';

/** Test your memorisation of a range of ayat: /hifz/test?sura=67&from=1&to=10 (or choose here). */
@Component({
  selector: 'app-hifz-test',
  imports: [
    TranslatePipe, RecallTestComponent, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonButton,
    IonSelect, SelectTextsDirective, IonSelectOption, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/hifz" [text]="''" [attr.aria-label]="'common.back' | translate" /></ion-buttons>
        <ion-title>{{ 'recall.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
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
    </ion-content>
  `,
  styles: `
    .pick { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
    .pick ion-select:first-child { grid-column: 1 / -1; }
    .note { font-size: 0.85rem; color: var(--app-muted); }
  `,
})
export class HifzTestPage {
  /** Query parameters (component input binding). */
  readonly suraParam = input<string | undefined>(undefined, { alias: 'sura' });
  readonly fromParam = input<string | undefined>(undefined, { alias: 'from' });
  readonly toParam = input<string | undefined>(undefined, { alias: 'to' });

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

  async ionViewWillEnter(): Promise<void> {
    await this.quran.load();
    const sura = Number(this.suraParam());
    if (sura >= 1 && sura <= 114) {
      const ayas = this.quran.sura(sura).ayas;
      const from = Math.min(Math.max(1, Number(this.fromParam()) || 1), ayas);
      this.sura.set(sura);
      this.from.set(from);
      this.to.set(Math.min(Math.max(from, Number(this.toParam()) || ayas), ayas));
    }
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
