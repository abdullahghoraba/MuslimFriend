import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { IonBadge, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { DorarAnswer, DorarService, dorarLink, dorarQuery } from '../../core/hadith/dorar.service';
import { Hadith, gradeColor, gradeKind } from '../../core/hadith/hadith.models';

@Component({
  selector: 'app-hadith-ruling',
  imports: [TranslatePipe, IonBadge, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar],
  template: `
    <ion-header><ion-toolbar><ion-title>{{ 'hadith.rulingTitle' | translate }}</ion-title>
      <ion-buttons slot="end"><ion-button (click)="close()">{{ 'hadith.close' | translate }}</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content><div class="sheet">
      <h2>{{ 'hadith.narrator' | translate }}</h2>
      @if (hadith.narrator || answer()?.rulings?.[0]?.narrator; as narrator) { <p dir="auto">{{ narrator }}</p> }
      @else if (loading()) { <p><ion-spinner name="dots" /></p> }
      @else { <p>{{ 'hadith.notRecorded' | translate }}</p> }
      <h2>{{ 'hadith.reference' | translate }}</h2>
      <p>{{ 'hadith.collections.' + hadith.collection | translate }} · {{ 'hadith.book' | translate }} {{ hadith.book }} · {{ 'hadith.number' | translate }} {{ hadith.number }}</p>
      <p class="muted" dir="auto">{{ hadith.bookName }}</p>
      <p class="muted">{{ 'hadith.numbering' | translate }} {{ hadith.arabicNumber }} · {{ 'hadith.book' | translate }} {{ hadith.book }} / {{ hadith.bookHadith }}</p>
      <h2>{{ 'hadith.offlineGrades' | translate }}</h2>
      @for (g of hadith.grades; track $index) {
        <section class="ruling"><ion-badge [color]="color(g.grade)">{{ 'hadith.grades.' + kind(g.grade) | translate }}</ion-badge>
          <p>{{ 'hadith.scholar' | translate }}: <b dir="auto">{{ g.name }}</b></p>
          <p>{{ 'hadith.rulingText' | translate }}: <span dir="auto">{{ g.grade }}</span></p>
          <p>{{ 'hadith.meanings.' + kind(g.grade) | translate }}</p>
        </section>
      } @empty { <p>{{ 'hadith.notRecorded' | translate }}</p> }
      @if (hadith.authenticitySource) {
        <p>{{ 'hadith.sourceAttribution' | translate }}</p><p lang="ar" dir="rtl">{{ hadith.authenticitySource }}</p>
      }
      <p class="muted">{{ 'hadith.gradeCaution' | translate }}</p>
      <h2>{{ 'hadith.dorar' | translate }}</h2>
      <p>{{ 'hadith.onlineHelp' | translate }}</p>
      <ion-button [disabled]="loading()" (click)="lookup()">{{ 'hadith.lookup' | translate }} @if (loading()) { <ion-spinner name="dots" /> }</ion-button>
      @if (failed()) { <p role="status">{{ 'hadith.onlineUnavailable' | translate }}</p> }
      @if (noMatch()) { <p role="status">{{ 'hadith.noMatch' | translate }}</p> }
      @if (answer(); as a) {
        <p class="muted">{{ 'hadith.cached' | translate }} · {{ date(a.fetchedAt) }}</p>
        <p>{{ 'hadith.matchNotice' | translate }}</p>
        @for (r of a.rulings; track $index) {
          <section class="ruling">
            <ion-badge [color]="color(r.ruling)">{{ 'hadith.grades.' + kind(r.ruling) | translate }}</ion-badge>
            <p class="arabic" lang="ar" dir="rtl">{{ r.text }}</p>
            <p>{{ 'hadith.narrator' | translate }}: <span lang="ar" dir="rtl">{{ r.narrator || ('hadith.notRecorded' | translate) }}</span></p>
            <p>{{ 'hadith.scholar' | translate }}: <b lang="ar" dir="rtl">{{ r.scholar || ('hadith.notRecorded' | translate) }}</b></p>
            <p>{{ 'hadith.reference' | translate }}: <span lang="ar" dir="rtl">{{ r.source }} · {{ r.number }}</span></p>
            <h3>{{ 'hadith.rulingText' | translate }}</h3><p lang="ar" dir="rtl">{{ r.ruling }}</p>
            <p>{{ 'hadith.meanings.' + kind(r.ruling) | translate }}</p>
            <a [href]="r.url" target="_blank" rel="noopener noreferrer">{{ 'hadith.viewSource' | translate }} — {{ 'hadith.dorar' | translate }}</a>
          </section>
        }
      }
      <a [href]="sourceUrl()" target="_blank" rel="noopener noreferrer">{{ 'hadith.dorar' | translate }} — dorar.net</a>
    </div></ion-content>`,
  styles: [`
    .sheet { max-width:760px; margin:auto; padding:18px; padding-bottom:calc(24px + env(safe-area-inset-bottom)); }
    h2 { font-size:1.1rem; margin-block:20px 8px; color:var(--ion-color-primary); } h3 { font-size:1rem; }
    p { line-height:1.8; overflow-wrap:anywhere; } .muted { color:var(--app-muted); font-size:.9rem; }
    .ruling { border:1px solid var(--app-border); border-radius:16px; background:var(--app-surface); padding:16px; margin-block:12px; }
    .arabic { font-family:'Amiri',serif; font-size:calc(1.25rem * var(--dhikr-font-scale,1)); }
    a { display:inline-flex; align-items:center; min-height:44px; } ion-button { min-height:44px; white-space:normal; }
  `],
})
export class HadithRulingComponent implements OnInit {
  @Input({ required: true }) hadith!: Hadith;
  private readonly dorar = inject(DorarService);
  private readonly modals = inject(ModalController);
  readonly answer = signal<DorarAnswer | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly noMatch = signal(false);
  readonly color = gradeColor;
  readonly kind = gradeKind;
  sourceUrl(): string { return dorarLink(dorarQuery(this.hadith.arabic)); }
  date(value: number): string { return new Date(value).toLocaleDateString(document.documentElement.lang || 'ar'); }
  /** The user opened this to know who narrated it and how sound it is: look it up at once unless already saved. */
  async ngOnInit(): Promise<void> {
    this.answer.set(await this.dorar.cached(this.hadith).catch(() => null));
    if (!this.answer()) await this.lookup();
  }
  close(): void { void this.modals.dismiss(); }
  async lookup(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true); this.failed.set(false); this.noMatch.set(false);
    try {
      const answer = await this.dorar.lookup(this.hadith);
      if (answer.rulings.length) this.answer.set(answer); else this.noMatch.set(true);
    } catch { this.failed.set(true); } finally { this.loading.set(false); }
  }
}
