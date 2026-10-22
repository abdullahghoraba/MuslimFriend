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
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  NavController,
} from '@ionic/angular';
import { Preferences } from '@capacitor/preferences';
import { TranslatePipe } from '@ngx-translate/core';
import { AyahRef, TAFSIR_IDS, TafsirId, splitBasmala } from '../../core/quran/quran-utils';
import { QuranService } from '../../core/quran/quran.service';
import { TafsirLibraryService } from '../../core/quran/tafsir-library.service';
import { SettingsService } from '../../core/services/settings.service';
import { ShareService } from '../../core/services/share.service';

const TAFSIR_PREF = 'tafsirChoice';
/** Bundled id ('muyassar' | 'jalalayn' | 'sahih') or a downloadable one ('r14', 'r91', ...). */
type Source = TafsirId | `r${number}`;

/** Tafsir / translation for one ayah, with next/previous ayah navigation. Opened as a sheet modal. */
@Component({
  selector: 'app-tafsir-sheet',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonSegment,
    IonSegmentButton, IonLabel, IonSpinner, IonSelect, IonSelectOption,
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
        <ion-segment [value]="isRemote() ? 'more' : source()" (ionChange)="onSegment($event.detail.value)">
          @for (id of ids; track id) {
            <ion-segment-button [value]="id">
              <ion-label>{{ sourceName(id) }}</ion-label>
            </ion-segment-button>
          }
          <ion-segment-button value="more">
            <ion-label>{{ 'tafsirLib.more' | translate }}</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
      @if (isRemote() || showMore()) {
        <ion-toolbar>
          <ion-select [label]="'tafsirLib.choose' | translate" interface="action-sheet" [value]="source()"
                      (ionChange)="setSource($event.detail.value)">
            @for (t of remote(); track t.apiId) {
              <ion-select-option [value]="'r' + t.apiId">{{ lang() === 'ar' ? t.nameAr : t.nameEn }}</ion-select-option>
            }
          </ion-select>
        </ion-toolbar>
      }
    </ion-header>
    <ion-content class="ion-padding">
      <p class="quran-text ayah">{{ ayahText() }} <span class="num">﴿{{ num() }}﴾</span></p>
      @if (loading()) {
        <ion-spinner />
      } @else if (unavailable()) {
        <div class="offline">
          <p>{{ 'tafsirLib.offlineMissing' | translate }}</p>
          <ion-button size="small" (click)="openLibrary()">{{ 'tafsirLib.openLibrary' | translate }}</ion-button>
        </div>
      } @else {
        @if (covered()) {
          <p class="covered">{{ 'tafsirLib.covered' | translate }}</p>
        }
        <p class="tafsir" [attr.dir]="textLang() === 'en' ? 'ltr' : 'rtl'" [attr.lang]="textLang()">{{ text() }}</p>
      }
      <p class="source">{{ sourceBy() }}</p>
      <div class="nav">
        <ion-button fill="clear" (click)="step(-1)" [disabled]="index() === 0">
          <ion-icon slot="start" name="chevron-forward" class="prev" aria-hidden="true" />
          {{ 'mushaf.prevAyah' | translate }}
        </ion-button>
        <ion-button fill="clear" (click)="share()" [disabled]="!text()">
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
    .covered, .source { font-size: 0.8rem; color: var(--app-muted); }
    .offline { text-align: center; color: var(--app-muted); padding: 16px 0; }
    .nav { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
    :host-context([dir='ltr']) .prev, :host-context([dir='ltr']) .next { transform: scaleX(-1); }
  `,
})
export class TafsirSheetComponent implements OnInit {
  readonly ayahRef = input.required<AyahRef>();

  private readonly quran = inject(QuranService);
  private readonly library = inject(TafsirLibraryService);
  private readonly settings = inject(SettingsService);
  private readonly modalCtrl = inject(ModalController);
  private readonly nav = inject(NavController);
  private readonly share$ = inject(ShareService);

  readonly ids = TAFSIR_IDS;
  readonly remote = this.library.all;
  readonly index = signal(0);
  readonly source = signal<Source>('muyassar');
  readonly showMore = signal(false);
  readonly text = signal('');
  readonly covered = signal(false);
  readonly unavailable = signal(false);
  readonly loading = signal(true);

  readonly lang = computed(() => this.settings.settings().language);
  readonly isRemote = computed(() => this.source().startsWith('r'));
  readonly remoteInfo = computed(() => (this.isRemote() ? this.library.find(Number(this.source().slice(1))) : undefined));
  readonly textLang = computed(() => (this.isRemote() ? this.remoteInfo()?.lang : this.source() === 'sahih' ? 'en' : 'ar') ?? 'ar');
  readonly ref = computed(() => this.quran.ayahAt(this.index()));
  readonly ayahText = computed(() => splitBasmala(this.ref(), this.ref().text).text);
  readonly num = computed(() => String(this.ref().aya));
  readonly title = computed(() => {
    const r = this.ref();
    const s = this.quran.sura(r.sura);
    return this.lang() === 'ar' ? `${s.name} · ${r.aya}` : `${s.tname} ${r.sura}:${r.aya}`;
  });
  readonly sourceBy = computed(() => {
    const r = this.remoteInfo();
    if (r?.imported) return `${this.lang() === 'ar' ? r.nameAr : r.nameEn} · ${r.source || (this.lang() === 'ar' ? 'ملف مستورد' : 'Imported file')}`;
    if (r) return `${this.lang() === 'ar' ? r.nameAr : r.nameEn} · ${r.provider === 'spa5k' ? 'QUL (Tarteel)' : 'quran.com'}`;
    return `${this.quran.meta.sources.tafsir[this.source() as TafsirId].by} · tanzil.net`;
  });

  async ngOnInit(): Promise<void> {
    await this.library.loadImported();
    const { value } = await Preferences.get({ key: TAFSIR_PREF });
    if (value && (isBundled(value) || this.library.find(Number(value.slice(1))))) this.source.set(value as Source);
    else if (this.lang() === 'en') this.source.set('sahih');
    this.index.set(this.quran.ayah(this.ayahRef()).index);
    await this.loadText();
  }

  sourceName(id: TafsirId): string {
    const s = this.quran.meta.sources.tafsir[id];
    return this.lang() === 'ar' ? s.nameAr : s.nameEn;
  }

  async onSegment(value: unknown): Promise<void> {
    if (value === 'more') {
      this.showMore.set(true);
      return;
    }
    this.showMore.set(false);
    await this.setSource(value);
  }

  async setSource(value: unknown): Promise<void> {
    if (typeof value !== 'string' || !(isBundled(value) || this.library.find(Number(value.slice(1))))) return;
    this.source.set(value as Source);
    await Preferences.set({ key: TAFSIR_PREF, value });
    await this.loadText();
  }

  async step(delta: number): Promise<void> {
    this.index.update((i) => Math.min(6235, Math.max(0, i + delta)));
    await this.loadText();
  }

  private async loadText(): Promise<void> {
    this.loading.set(true);
    this.unavailable.set(false);
    this.covered.set(false);
    try {
      const src = this.source();
      if (src.startsWith('r')) {
        const r = this.ref();
        const result = await this.library.ayah(Number(src.slice(1)), r.sura, r.aya);
        this.text.set(result.text);
        this.covered.set(result.covered);
      } else {
        this.text.set(await this.quran.tafsir(src as TafsirId, this.ref()));
      }
    } catch {
      this.text.set('');
      this.unavailable.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async openLibrary(): Promise<void> {
    await this.close();
    void this.nav.navigateForward('/tafsir-library');
  }

  async share(): Promise<void> {
    const r = this.ref();
    const name = this.isRemote() ? (this.lang() === 'ar' ? this.remoteInfo()?.nameAr : this.remoteInfo()?.nameEn) : this.sourceName(this.source() as TafsirId);
    const body = `${this.ayahText()} ﴿${this.num()}﴾\n[${this.quran.sura(r.sura).name}: ${r.aya}]\n\n${name}:\n${this.text()}`;
    await this.share$.shareText(this.title(), body);
  }

  close(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
}

function isBundled(v: string): v is TafsirId {
  return (TAFSIR_IDS as string[]).includes(v);
}
