import { Component, computed, inject, signal } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonSearchbar, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { ASMA_UL_HUSNA, AllahName } from '../../core/content/asma-ul-husna';
import { intlLocale } from '../../core/models';
import { normalizeArabic } from '../../core/quran/quran-utils';
import { SettingsService } from '../../core/services/settings.service';

/** The day of the year, so each day has its own name (the 99 names in turn). */
export function nameOfDay(date = new Date()): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - start.getTime()) / 86_400_000);
  return (day - 1) % ASMA_UL_HUSNA.length;
}

/** The Most Beautiful Names of Allah with their meanings, a name for each day, and search. */
@Component({
  selector: 'app-names',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSearchbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/home" [text]="''" [attr.aria-label]="'common.back' | translate" /></ion-buttons>
        <ion-title>{{ 'names.title' | translate }}</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar [value]="query()" (ionInput)="query.set($event.detail.value ?? '')" [placeholder]="'names.search' | translate" />
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (!query()) {
        <section class="today card">
          <span class="label">{{ 'names.ofDay' | translate }}</span>
          <span class="ar" lang="ar">{{ today()[0] }}</span>
          <span class="tr">{{ today()[1] }}</span>
          <span class="meaning" [attr.lang]="lang() === 'ar' ? 'ar' : 'en'" [attr.dir]="lang() === 'ar' ? 'rtl' : 'ltr'">{{ meaning(today()) }}</span>
        </section>
        <p class="hadith">{{ 'names.hadith' | translate }}</p>
      }
      <ol class="grid">
        @for (n of list(); track n.i) {
          <li>
            <button type="button" class="card name" [class.open]="open() === n.i" (click)="open.set(open() === n.i ? null : n.i)"
                    [attr.aria-expanded]="open() === n.i">
              <span class="num">{{ number(n.i + 1) }}</span>
              <span class="ar" lang="ar">{{ n.name[0] }}</span>
              <span class="tr">{{ n.name[1] }}</span>
              @if (open() === n.i) {
                <span class="meaning" [attr.lang]="lang() === 'ar' ? 'ar' : 'en'" [attr.dir]="lang() === 'ar' ? 'rtl' : 'ltr'">{{ meaning(n.name) }}</span>
              }
            </button>
          </li>
        } @empty {
          <p class="empty">{{ 'names.none' | translate }}</p>
        }
      </ol>
      <p class="note">{{ 'names.note' | translate }}</p>
      @if (lang() !== 'ar' && lang() !== 'en') { <p class="note">{{ 'names.englishMeanings' | translate }}</p> }
    </ion-content>
  `,
  styles: `
    .card { border: 1px solid var(--app-border); border-radius: 16px; background: var(--app-surface); color: var(--ion-text-color); }
    .today { display: grid; justify-items: center; gap: 4px; padding: 16px; text-align: center; }
    .today .label { color: var(--ion-color-primary); font-weight: 600; font-size: 0.9rem; }
    .today .ar { font-size: 2.6rem; }
    .hadith, .note { color: var(--app-muted); font-size: 0.8rem; line-height: 1.6; }
    .grid { list-style: none; margin: 8px 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .name { width: 100%; display: grid; justify-items: center; gap: 2px; padding: 10px 8px; font: inherit; cursor: pointer; position: relative; }
    .name.open { grid-column: span 2; border-color: var(--ion-color-primary); }
    .num { position: absolute; inset-inline-start: 8px; top: 6px; font-size: 0.7rem; color: var(--app-muted); }
    .ar { font-family: 'Amiri', serif; font-size: 1.7rem; line-height: 1.6; color: var(--ion-color-primary); }
    .tr { font-size: 0.8rem; color: var(--app-muted); }
    .meaning { font-size: 0.95rem; line-height: 1.5; text-align: center; }
    .meaning[lang='ar'] { font-family: 'Amiri', serif; font-size: 1.1rem; }
  `,
})
export class NamesPage {
  private readonly settings = inject(SettingsService);
  readonly lang = computed(() => this.settings.settings().language);
  readonly query = signal('');
  readonly open = signal<number | null>(null);
  readonly today = signal(ASMA_UL_HUSNA[nameOfDay()]);

  readonly list = computed(() => {
    const q = this.query().trim();
    const nq = normalizeArabic(q);
    const lq = q.toLowerCase();
    return ASMA_UL_HUSNA.map((name, i) => ({ name, i })).filter(({ name }) =>
      !q || normalizeArabic(name[0]).includes(nq) || name[1].toLowerCase().includes(lq) || name[2].toLowerCase().includes(lq) || normalizeArabic(name[3]).includes(nq));
  });

  meaning(name: AllahName): string {
    return this.lang() === 'ar' ? name[3] : name[2];
  }

  number(n: number): string {
    return new Intl.NumberFormat(intlLocale(this.lang())).format(n);
  }
}
