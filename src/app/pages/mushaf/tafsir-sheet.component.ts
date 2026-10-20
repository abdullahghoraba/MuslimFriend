import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { Preferences } from '@capacitor/preferences';
import { TranslatePipe } from '@ngx-translate/core';
import { AyahRef, TAFSIR_IDS, TafsirId, arabicDigits, splitBasmala } from '../../core/quran/quran-utils';
import { QuranService } from '../../core/quran/quran.service';
import { SettingsService } from '../../core/services/settings.service';
import { ShareService } from '../../core/services/share.service';

const TAFSIR_PREF = 'tafsirChoice';

/** Tafsir / translation for one ayah, with next/previous ayah navigation. Opened as a sheet modal. */
@Component({
  selector: 'app-tafsir-sheet',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonSegment,
    IonSegmentButton, IonLabel, IonSpinner,
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
        <ion-segment [value]="source()" (ionChange)="setSource($event.detail.value)">
          @for (id of ids; track id) {
            <ion-segment-button [value]="id">
              <ion-label>{{ sourceName(id) }}</ion-label>
            </ion-segment-button>
          }
        </ion-segment>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p class="quran-text ayah">{{ ayahText() }} <span class="num">﴿{{ num() }}﴾</span></p>
      @if (loading()) {
        <ion-spinner />
      } @else {
        <p class="tafsir" [attr.dir]="source() === 'sahih' ? 'ltr' : 'rtl'" [attr.lang]="source() === 'sahih' ? 'en' : 'ar'">
          {{ text() }}
        </p>
      }
      <p class="source">{{ sourceBy() }} · tanzil.net</p>
      <div class="nav">
        <ion-button fill="clear" (click)="step(-1)" [disabled]="index() === 0">
          <ion-icon slot="start" name="chevron-forward" class="prev" aria-hidden="true" />
          {{ 'mushaf.prevAyah' | translate }}
        </ion-button>
        <ion-button fill="clear" (click)="share()">
          <ion-icon slot="icon-only" name="share-social-outline" [attr.aria-label]="'common.share' | translate" />
        </ion-button>
        <ion-button fill="clear" (click)="step(1)" [disabled]="index() === 6235">
          {{ 'mushaf.nextAyah' | translate }}
          <ion-icon slot="end" name="chevron-back" class="next" aria-hidden="true" />
        </ion-button>
      </div>
    </ion-content>
  `,
  styles: `
    .ayah { font-size: calc(1.5rem * var(--quran-font-scale, 1)); text-align: center; margin: 4px 0 12px; }
    .num { color: var(--ion-color-secondary); }
    .tafsir { font-size: calc(1.05rem * var(--dhikr-font-scale, 1)); line-height: 1.9; white-space: pre-line; }
    .tafsir[dir='rtl'] { font-family: 'Amiri', serif; font-size: calc(1.2rem * var(--dhikr-font-scale, 1)); }
    .source { font-size: 0.8rem; color: var(--app-muted); }
    .nav { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
    :host-context([dir='ltr']) .prev, :host-context([dir='ltr']) .next { transform: scaleX(-1); }
  `,
})
export class TafsirSheetComponent implements OnInit {
  readonly ayahRef = input.required<AyahRef>();

  private readonly quran = inject(QuranService);
  private readonly settings = inject(SettingsService);
  private readonly modalCtrl = inject(ModalController);
  private readonly share$ = inject(ShareService);

  readonly ids = TAFSIR_IDS;
  readonly index = signal(0);
  readonly source = signal<TafsirId>('muyassar');
  readonly text = signal('');
  readonly loading = signal(true);

  readonly ref = computed(() => this.quran.ayahAt(this.index()));
  readonly ayahText = computed(() => splitBasmala(this.ref(), this.ref().text).text);
  readonly num = computed(() => arabicDigits(this.ref().aya));
  readonly title = computed(() => {
    const r = this.ref();
    const s = this.quran.sura(r.sura);
    return this.settings.settings().language === 'ar' ? `${s.name} · ${arabicDigits(r.aya)}` : `${s.tname} ${r.sura}:${r.aya}`;
  });
  readonly sourceBy = computed(() => this.quran.meta.sources.tafsir[this.source()].by);

  async ngOnInit(): Promise<void> {
    const { value } = await Preferences.get({ key: TAFSIR_PREF });
    if (value && (TAFSIR_IDS as string[]).includes(value)) this.source.set(value as TafsirId);
    else if (this.settings.settings().language === 'en') this.source.set('sahih');
    this.index.set(this.quran.ayah(this.ayahRef()).index);
    await this.loadText();
  }

  sourceName(id: TafsirId): string {
    const s = this.quran.meta.sources.tafsir[id];
    return this.settings.settings().language === 'ar' ? s.nameAr : s.nameEn;
  }

  async setSource(value: unknown): Promise<void> {
    if (!(TAFSIR_IDS as unknown[]).includes(value)) return;
    this.source.set(value as TafsirId);
    await Preferences.set({ key: TAFSIR_PREF, value: value as string });
    await this.loadText();
  }

  async step(delta: number): Promise<void> {
    this.index.update((i) => Math.min(6235, Math.max(0, i + delta)));
    await this.loadText();
  }

  private async loadText(): Promise<void> {
    this.loading.set(true);
    try {
      this.text.set(await this.quran.tafsir(this.source(), this.ref()));
    } finally {
      this.loading.set(false);
    }
  }

  async share(): Promise<void> {
    const r = this.ref();
    const body = `${this.ayahText()} ﴿${this.num()}﴾\n[${this.quran.sura(r.sura).name}: ${r.aya}]\n\n${this.sourceName(this.source())}:\n${this.text()}`;
    await this.share$.shareText(this.title(), body);
  }

  close(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
}
