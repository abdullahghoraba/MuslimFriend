import { Component, computed, inject, input, signal } from '@angular/core';
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { EncHadith, HadeethEncService, encHadith } from '../../core/hadith/hadeethenc.service';
import { HadithBookmarksService } from '../../core/hadith/hadith-bookmarks.service';
import { SettingsService } from '../../core/services/settings.service';
import { HadithCardComponent } from './hadith-card.component';

/** One hadith of the encyclopedia in the reader's language: text, grade, source, explanation and lessons. */
@Component({
  selector: 'app-hadith-enc',
  imports: [TranslatePipe, HadithCardComponent, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonButton, IonSpinner],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/hadith/topics" [text]="''" [attr.aria-label]="'common.back' | translate" /></ion-buttons>
      <ion-title>{{ 'hadith.collections.enc' | translate }}</ion-title>
    </ion-toolbar></ion-header>
    <ion-content><main>
      @if (failed()) {
        <div class="state" role="alert"><p>{{ 'hadith.onlineUnavailable' | translate }}</p>
          <ion-button fill="outline" (click)="load()">{{ 'hadith.retry' | translate }}</ion-button></div>
      } @else if (hadith(); as h) {
        <p class="title" [attr.dir]="rtl() ? 'rtl' : 'ltr'">{{ h.title }}</p>
        <app-hadith-card [hadith]="card()!" />
        @if (h.grade && lang() !== 'ar') {
          <p class="meta">{{ h.grade }} · {{ h.attribution }}</p>
        }
        @if (h.explanation) {
          <section><h2>{{ 'hadith.explanation' | translate }}</h2><p [attr.dir]="rtl() ? 'rtl' : 'ltr'" class="text">{{ h.explanation }}</p></section>
        }
        @if (h.hints.length) {
          <section><h2>{{ 'hadith.benefits' | translate }}</h2>
            <ul [attr.dir]="rtl() ? 'rtl' : 'ltr'">@for (b of h.hints; track $index) { <li class="text">{{ b }}</li> }</ul>
          </section>
        }
        @if (h.wordMeanings.length) {
          <section><h2>{{ 'hadith.wordMeanings' | translate }}</h2>
            <dl [attr.dir]="rtl() ? 'rtl' : 'ltr'">@for (w of h.wordMeanings; track $index) { <dt>{{ w.word }}</dt><dd class="text">{{ w.meaning }}</dd> }</dl>
          </section>
        }
        <p class="credit">{{ 'hadith.encCredit' | translate }}</p>
      } @else {
        <div class="state"><ion-spinner /></div>
      }
    </main></ion-content>`,
  styles: `
    main { max-width: 760px; margin-inline: auto; padding: 8px 12px calc(24px + var(--ion-safe-area-bottom, 0px)); }
    .title { margin: 12px 4px 0; font-weight: 700; color: var(--ion-color-primary); line-height: 1.7; }
    .meta { color: var(--app-muted); font-size: 0.85rem; margin: 0 4px; }
    section { margin: 12px 0; padding: 16px; border: 1px solid var(--app-border); border-radius: 18px; background: var(--app-surface); }
    h2 { margin: 0 0 8px; font-size: 1rem; color: var(--ion-color-primary); }
    .text { font-size: calc(1rem * var(--dhikr-font-scale, 1)); line-height: 1.9; white-space: pre-line; overflow-wrap: anywhere; }
    ul { margin: 0; padding-inline-start: 20px; } li { margin-block: 6px; }
    dt { font-weight: 700; margin-top: 8px; } dd { margin-inline-start: 0; }
    .credit { text-align: center; color: var(--app-muted); font-size: 0.75rem; margin-top: 20px; }
    .state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 25vh 16px; text-align: center; }
  `,
})
export class HadithEncPage {
  /** Route parameter. */
  readonly id = input.required<string>();

  private readonly enc = inject(HadeethEncService);
  private readonly settings = inject(SettingsService);
  private readonly marks = inject(HadithBookmarksService);
  readonly lang = computed(() => this.settings.settings().language);
  readonly rtl = computed(() => ['ar', 'ur', 'fa'].includes(this.lang()));
  readonly hadith = signal<EncHadith | null>(null);
  readonly card = computed(() => (this.hadith() ? encHadith(this.hadith()!) : null));
  readonly failed = signal(false);

  ionViewWillEnter(): void {
    void this.marks.load().catch(() => {});
    void this.load();
  }

  async load(): Promise<void> {
    this.failed.set(false);
    try {
      this.hadith.set(await this.enc.one(this.lang(), this.id()));
    } catch {
      this.failed.set(true);
    }
  }
}
