import { Component, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar,
  ModalController,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { LANGUAGES } from '../../core/models';
import { AyahRef } from '../../core/quran/quran-utils';
import { QuranService } from '../../core/quran/quran.service';
import { QuranWord, WORD_AUDIO, WordByWordService, isWordLang } from '../../core/quran/word-by-word.service';
import { SettingsService } from '../../core/services/settings.service';
import { SelectTextsDirective } from '../../shared/select-texts.directive';

/** The words of one ayah with their meaning and pronunciation; tap a word to hear it. Opened as a sheet modal. */
@Component({
  selector: 'app-word-by-word-sheet',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonSpinner, IonSelect,
    SelectTextsDirective, IonSelectOption,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ title() }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()" [attr.aria-label]="'common.close' | translate">
            <ion-icon slot="icon-only" name="close-outline" aria-hidden="true" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-select [label]="'wbw.meaningsIn' | translate" interface="action-sheet" [value]="wordLang()"
                    (ionChange)="setLang($event.detail.value)">
          @for (l of langs; track l.code) {
            <ion-select-option [value]="l.code">{{ l.name }}</ion-select-option>
          }
        </ion-select>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (fallback()) { <p class="note">{{ 'wbw.englishFallback' | translate }}</p> }
      @if (loading()) {
        <div class="center"><ion-spinner /></div>
      } @else if (failed()) {
        <div class="center">
          <p>{{ 'wbw.offline' | translate }}</p>
          <ion-button fill="outline" size="small" (click)="load()">{{ 'wbw.retry' | translate }}</ion-button>
        </div>
      } @else {
        <p class="hint">{{ 'wbw.tapToHear' | translate }}</p>
        <ol class="words" dir="rtl">
          @for (w of words(); track $index) {
            <li>
              <button type="button" [class.playing]="playing() === $index" (click)="hear(w, $index)"
                      [attr.aria-label]="w.ar + ': ' + w.meaning">
                <span class="ar" lang="ar">{{ w.ar }}</span>
                <span class="meaning" [attr.lang]="wordLang()" [attr.dir]="rtlMeaning() ? 'rtl' : 'ltr'">{{ w.meaning }}</span>
                @if (w.tr) { <span class="tr" lang="en-Latn" dir="ltr">{{ w.tr }}</span> }
              </button>
            </li>
          }
        </ol>
        <p class="source">{{ 'wbw.source' | translate }}</p>
      }
      <div class="nav">
        <ion-button fill="clear" (click)="step(-1)" [disabled]="index() === 0">
          <ion-icon slot="start" name="chevron-back" class="prev" aria-hidden="true" />
          {{ 'mushaf.prevAyah' | translate }}
        </ion-button>
        <ion-button fill="clear" (click)="step(1)" [disabled]="index() === 6235">
          {{ 'mushaf.nextAyah' | translate }}
          <ion-icon slot="end" name="chevron-forward" class="next" aria-hidden="true" />
        </ion-button>
      </div>
    </ion-content>
  `,
  styles: `
    .note, .hint, .source { font-size: 0.8rem; color: var(--app-muted); margin: 0 0 10px; }
    .source { margin-top: 12px; }
    .center { display: grid; justify-items: center; gap: 8px; padding: 24px 0; color: var(--app-muted); text-align: center; }
    .words { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
    .words button {
      width: 100%; height: 100%; display: grid; gap: 4px; align-content: start; justify-items: center; text-align: center;
      padding: 10px 6px; border: 1px solid var(--app-border); border-radius: 14px; background: var(--app-surface);
      color: var(--ion-text-color); font: inherit; cursor: pointer;
    }
    .words button.playing { border-color: var(--ion-color-primary); box-shadow: 0 0 0 1px var(--ion-color-primary) inset; }
    .ar { font-family: 'Amiri Quran', 'Amiri', serif; font-size: calc(1.6rem * var(--quran-font-scale, 1)); line-height: 1.8; }
    .meaning { font-size: calc(0.95rem * var(--dhikr-font-scale, 1)); line-height: 1.4; }
    .tr { font-size: 0.8rem; color: var(--app-muted); font-style: italic; }
    .nav { display: flex; justify-content: space-between; gap: 4px; margin-top: 8px; padding-bottom: var(--ion-safe-area-bottom, 0px); }
    .nav ion-button { margin: 0; height: auto; min-height: 44px; white-space: normal; }
  `,
})
export class WordByWordSheetComponent implements OnInit, OnDestroy {
  readonly ayahRef = input.required<AyahRef>();

  private readonly quran = inject(QuranService);
  private readonly wbw = inject(WordByWordService);
  private readonly settings = inject(SettingsService);
  private readonly modals = inject(ModalController);

  readonly index = signal(0);
  readonly words = signal<QuranWord[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  /** The word being recited. */
  readonly playing = signal<number | null>(null);
  private audio?: HTMLAudioElement;

  readonly langs = LANGUAGES.filter((l) => isWordLang(l.code));
  readonly lang = computed(() => this.settings.settings().language);
  readonly wordLang = computed(() => this.wbw.langFor(this.lang()));
  /** The reader's language has no word meanings, so they read English. */
  readonly fallback = computed(() => !this.wbw.chosen() && !isWordLang(this.lang()));
  readonly rtlMeaning = computed(() => LANGUAGES.some((l) => l.code === this.wordLang() && l.rtl));
  readonly ref = computed(() => this.quran.ayahAt(this.index()));
  readonly title = computed(() => {
    const r = this.ref();
    const s = this.quran.sura(r.sura);
    return this.lang() === 'ar' ? `${s.name} · ${r.aya}` : `${s.tname} ${r.sura}:${r.aya}`;
  });

  async ngOnInit(): Promise<void> {
    await this.wbw.loadChoice();
    this.index.set(this.quran.ayah(this.ayahRef()).index);
    await this.load();
  }

  ngOnDestroy(): void {
    this.stopAudio();
  }

  async load(): Promise<void> {
    const r = this.ref();
    const index = this.index(), lang = this.wordLang();
    this.loading.set(true);
    this.failed.set(false);
    try {
      const words = await this.wbw.ayah(r.sura, r.aya, lang);
      if (index !== this.index() || lang !== this.wordLang()) return;
      this.words.set(words);
    } catch {
      if (index === this.index()) this.failed.set(true);
    } finally {
      if (index === this.index()) this.loading.set(false);
    }
  }

  async setLang(value: unknown): Promise<void> {
    if (!isWordLang(value) || value === this.wordLang()) return;
    await this.wbw.choose(value);
    await this.load();
  }

  async step(delta: number): Promise<void> {
    this.stopAudio();
    this.index.update((i) => Math.min(6235, Math.max(0, i + delta)));
    await this.load();
  }

  hear(w: QuranWord, i: number): void {
    this.stopAudio();
    if (!w.audio) return;
    const audio = new Audio(WORD_AUDIO + w.audio);
    this.audio = audio;
    this.playing.set(i);
    audio.onended = audio.onerror = () => this.audio === audio && this.playing.set(null);
    void audio.play().catch(() => this.audio === audio && this.playing.set(null));
  }

  close(): void {
    void this.modals.dismiss();
  }

  private stopAudio(): void {
    this.audio?.pause();
    this.audio = undefined;
    this.playing.set(null);
  }
}
