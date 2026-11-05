import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { dorarLink, dorarQuery } from '../../core/hadith/dorar.service';
import { ExplainResult, HadithExplainService } from '../../core/hadith/hadith-explain.service';
import { Hadith } from '../../core/hadith/hadith.models';

/** The simple explanation of a hadith: its meaning, lessons and hard words, from HadeethEnc or Dorar. */
@Component({
  selector: 'app-hadith-explain',
  imports: [TranslatePipe, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar],
  template: `
    <ion-header><ion-toolbar><ion-title>{{ 'hadith.explainTitle' | translate }}</ion-title>
      <ion-buttons slot="end"><ion-button (click)="close()">{{ 'hadith.close' | translate }}</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content><div class="sheet">
      @if (loading()) {
        <div class="state" role="status"><ion-spinner /><p>{{ 'hadith.explainLoading' | translate }}</p></div>
      } @else if (result(); as r) {
        @if (r.earlier) { <p class="note">{{ 'hadith.explainEarlier' | translate }}</p> }
        @if (r.similar) {
          <p class="note">{{ 'hadith.explainSimilar' | translate }}</p>
          <p class="arabic" lang="ar" dir="rtl">{{ r.hadith }}</p>
        }
        @if (r.lang !== lang) { <p class="muted">{{ 'hadith.explainArabicOnly' | translate }}</p> }
        <section>
          <h2>{{ 'hadith.explanation' | translate }}</h2>
          @for (p of paragraphs(r.explanation); track $index) { <p class="text" [attr.lang]="r.lang" dir="auto">{{ p }}</p> }
        </section>
        @if (r.benefits.length) {
          <section><h2>{{ 'hadith.benefits' | translate }}</h2>
            <ul [attr.lang]="r.lang" dir="auto">@for (b of r.benefits; track $index) { <li class="text">{{ b }}</li> }</ul>
          </section>
        }
        @if (r.words.length) {
          <section><h2>{{ 'hadith.wordMeanings' | translate }}</h2>
            <dl [attr.lang]="r.lang" dir="auto">@for (w of r.words; track $index) { <dt>{{ w.word }}</dt><dd class="text">{{ w.meaning }}</dd> }</dl>
          </section>
        }
        @if (r.reference) { <p class="muted" lang="ar" dir="rtl">{{ r.reference }}</p> }
        <p class="credit">{{ (r.source === 'enc' ? 'hadith.encCredit' : 'hadith.explainDorarCredit') | translate }}</p>
        <a [href]="r.url" target="_blank" rel="noopener noreferrer">{{ 'hadith.viewSource' | translate }}</a>
      } @else if (failed()) {
        <div class="state" role="alert"><p>{{ 'hadith.explainOffline' | translate }}</p>
          <ion-button fill="outline" (click)="load()">{{ 'hadith.retry' | translate }}</ion-button></div>
      } @else {
        <div class="state" role="status"><p>{{ 'hadith.explainNone' | translate }}</p>
          <a [href]="searchUrl()" target="_blank" rel="noopener noreferrer">{{ 'hadith.dorar' | translate }} — dorar.net</a></div>
      }
    </div></ion-content>`,
  styles: [`
    .sheet { max-width:760px; margin:auto; padding:16px; padding-bottom:calc(24px + env(safe-area-inset-bottom)); }
    section { margin:12px 0; padding:16px; border:1px solid var(--app-border); border-radius:18px; background:var(--app-surface); }
    h2 { margin:0 0 8px; font-size:1rem; color:var(--ion-color-primary); }
    .text { font-size:calc(1.05rem * var(--dhikr-font-scale,1)); line-height:2; overflow-wrap:anywhere; margin:0 0 10px; }
    .arabic { font-family:'Amiri',serif; font-size:calc(1.25rem * var(--dhikr-font-scale,1)); line-height:2; }
    .note { padding:10px 14px; border-radius:12px; background:color-mix(in srgb,var(--ion-color-primary) 10%,transparent); line-height:1.8; }
    .muted,.credit { color:var(--app-muted); font-size:.85rem; line-height:1.7; }
    .credit { text-align:center; margin-top:16px; }
    ul { margin:0; padding-inline-start:20px; } li { margin-block:6px; }
    dt { font-weight:700; margin-top:8px; } dd { margin-inline-start:0; }
    a { display:flex; align-items:center; justify-content:center; min-height:44px; }
    .state { display:flex; flex-direction:column; align-items:center; gap:12px; padding:18vh 16px; text-align:center; line-height:1.8; }
  `],
})
export class HadithExplainComponent implements OnInit {
  @Input({ required: true }) hadith!: Hadith;
  @Input() lang = 'ar';
  private readonly explainer = inject(HadithExplainService);
  private readonly modals = inject(ModalController);
  readonly result = signal<ExplainResult | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  ngOnInit(): void { void this.load(); }
  close(): void { void this.modals.dismiss(); }
  paragraphs(text: string): string[] { return text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean); }
  searchUrl(): string { return dorarLink(dorarQuery(this.hadith.arabic)); }

  async load(): Promise<void> {
    this.loading.set(true); this.failed.set(false);
    try {
      this.result.set(await this.explainer.explain(this.hadith, this.lang));
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
