import { Component, computed, inject, signal } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonProgressBar, IonSpinner,
  IonTitle, IonToolbar,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { HadithMemoService, NawawiHadith } from '../../core/hadith/hadith-memo.service';
import { intlLocale, isRtl } from '../../core/models';
import { SettingsService } from '../../core/services/settings.service';
import { RecallTestComponent } from '../../shared/recall-test.component';

/** Memorise the Forty Hadith of an-Nawawi: learn one, test yourself, and review it on the days that come due. */
@Component({
  selector: 'app-hadith-memorize',
  imports: [
    TranslatePipe, RecallTestComponent, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem,
    IonLabel, IonButton, IonIcon, IonProgressBar, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          @if (open()) {
            <ion-button (click)="close()" [attr.aria-label]="'common.back' | translate"><ion-icon slot="icon-only" [name]="rtl(lang()) ? 'chevron-forward' : 'chevron-back'" aria-hidden="true" /></ion-button>
          } @else {
            <ion-back-button defaultHref="/hadith" [text]="''" [attr.aria-label]="'common.back' | translate" />
          }
        </ion-buttons>
        <ion-title>{{ open() ? ('memo.hadithN' | translate: { n: number(open()!.number) }) : ('memo.title' | translate) }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (failed()) {
        <p role="alert">{{ 'hadith.loadFailed' | translate }}</p>
      } @else if (!memo.hadith().length) {
        <ion-spinner />
      } @else if (open(); as h) {
        @if (testing()) {
          <app-recall-test [segments]="[{ label: '', text: h.arabic }]" (finishedTest)="tested.set(true)" />
          <ion-button fill="clear" (click)="testing.set(false)">{{ 'memo.showText' | translate }}</ion-button>
        } @else {
          <p class="arabic" lang="ar" dir="rtl">{{ h.arabic }}</p>
          @if (lang() !== 'ar') { <p class="translation" [attr.lang]="h.translationLang" [attr.dir]="rtl(h.translationLang) ? 'rtl' : 'ltr'">{{ h.translation }}</p> }
          <ion-button expand="block" fill="outline" (click)="testing.set(true)">{{ 'recall.title' | translate }}</ion-button>
        }
        <section class="review">
          @if (memo.status(h.number) === 'new') {
            <ion-button expand="block" (click)="memo.start(h.number)">{{ 'memo.start' | translate }}</ion-button>
          } @else {
            <p class="state">{{ ('memo.status.' + memo.status(h.number)) | translate }} · {{ 'memo.nextReview' | translate: { date: dueLabel(h.number) } }}</p>
            <div class="row">
              <ion-button (click)="review(h.number, true)">{{ 'memo.remembered' | translate }}</ion-button>
              <ion-button fill="outline" color="danger" (click)="review(h.number, false)">{{ 'memo.forgot' | translate }}</ion-button>
              <ion-button fill="clear" (click)="memo.reset(h.number)">{{ 'memo.reset' | translate }}</ion-button>
            </div>
          }
        </section>
        <p class="source">{{ 'memo.source' | translate }}</p>
      } @else {
        <p class="intro">{{ 'memo.intro' | translate }}</p>
        <ion-progress-bar [value]="memo.memorized() / memo.hadith().length" />
        <p class="summary">{{ 'memo.summary' | translate: { done: number(memo.memorized()), total: number(memo.hadith().length) } }}</p>
        @if (due().length) {
          <h2>{{ 'memo.dueToday' | translate }}</h2>
          <ion-list inset>
            @for (h of due(); track h.number) {
              <ion-item button detail (click)="show(h)"><ion-label>{{ 'memo.hadithN' | translate: { n: number(h.number) } }}<p lang="ar" dir="rtl">{{ excerpt(h) }}</p></ion-label></ion-item>
            }
          </ion-list>
        }
        <h2>{{ 'memo.all' | translate }}</h2>
        <ion-list inset>
          @for (h of memo.hadith(); track h.number) {
            <ion-item button detail (click)="show(h)">
              <span slot="start" class="num">{{ number(h.number) }}</span>
              <ion-label><p lang="ar" dir="rtl">{{ excerpt(h) }}</p></ion-label>
              <span slot="end" class="chip" [class]="'chip ' + memo.status(h.number)">{{ ('memo.status.' + memo.status(h.number)) | translate }}</span>
            </ion-item>
          }
        </ion-list>
      }
    </ion-content>
  `,
  styles: `
    .intro, .summary, .source, .state { color: var(--app-muted); font-size: 0.9rem; }
    h2 { font-size: 1rem; margin: 16px 4px 0; }
    .arabic { font-family: 'Amiri', serif; font-size: calc(1.3rem * var(--dhikr-font-scale, 1)); line-height: 2.1; }
    .translation { line-height: 1.7; }
    .review { margin-top: 16px; }
    .row { display: flex; flex-wrap: wrap; gap: 4px; }
    .num { min-width: 2ch; color: var(--ion-color-primary); font-weight: 700; }
    .chip { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: var(--app-border); color: var(--app-muted); white-space: nowrap; }
    .chip.learning { background: color-mix(in srgb, var(--ion-color-warning) 25%, transparent); color: var(--ion-text-color); }
    .chip.memorized { background: color-mix(in srgb, var(--ion-color-success) 25%, transparent); color: var(--ion-text-color); }
  `,
})
export class HadithMemorizePage {
  readonly memo = inject(HadithMemoService);
  private readonly settings = inject(SettingsService);
  readonly lang = computed(() => this.settings.settings().language);
  readonly open = signal<NawawiHadith | null>(null);
  readonly testing = signal(false);
  readonly tested = signal(false);
  readonly failed = signal(false);
  readonly due = computed(() => this.memo.due().map((n) => this.memo.hadith().find((h) => h.number === n)).filter((h): h is NawawiHadith => !!h));

  async ionViewWillEnter(): Promise<void> {
    try {
      await this.memo.load(this.lang());
    } catch {
      this.failed.set(true);
    }
  }

  show(h: NawawiHadith): void {
    this.open.set(h);
    this.testing.set(false);
    this.tested.set(false);
  }

  close(): void {
    this.open.set(null);
  }

  async review(n: number, remembered: boolean): Promise<void> {
    await this.memo.review(n, remembered);
    this.close();
  }

  dueLabel(n: number): string {
    const due = this.memo.entries()[n]?.due;
    if (!due) return '';
    const [y, m, d] = due.split('-').map(Number);
    return new Intl.DateTimeFormat(intlLocale(this.lang()), { day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
  }

  /** The words of the Prophet ﷺ, without the chain ("On the authority of ... said:"), cut short for the list. */
  excerpt(h: NawawiHadith): string {
    let t = h.arabic;
    // What follows the Prophet's name ﷺ near the start, after "يقول:" / "قال:" when there is one.
    const at = t.lastIndexOf('صلى الله عليه', 300);
    if (at >= 0) {
      t = t.slice(at).replace(/^صلى الله عليه\s*و\s*سلم/, '');
      const colon = t.indexOf(':');
      if (colon >= 0 && colon < 60) t = t.slice(colon + 1);
    }
    t = t.replace(/^[\s"«“-]+/, '').trim();
    return t.length > 90 ? t.slice(0, 90).trim() + '…' : t;
  }

  rtl(lang: string): boolean {
    return isRtl(lang);
  }

  number(n: number): string {
    return new Intl.NumberFormat(intlLocale(this.lang())).format(n);
  }
}
