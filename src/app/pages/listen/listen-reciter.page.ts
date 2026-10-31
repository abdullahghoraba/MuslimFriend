import { Component, computed, inject, input, signal } from '@angular/core';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonProgressBar, IonSearchbar,
  IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar, ToastController,
} from '@ionic/angular';
import { SelectTextsDirective } from '../../shared/select-texts.directive';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AudioCatalogService, Moshaf } from '../../core/audio/audio-catalog.service';
import { AudioPlayerService } from '../../core/audio/audio-player.service';
import { QuranService } from '../../core/quran/quran.service';
import { normalizeArabic } from '../../core/quran/quran-utils';
import { intlLocale } from '../../core/models';
import { ListenPlayerComponent } from './listen-player.component';

/** One reciter: choose the recording (riwayah), then play or download any sura. */
@Component({
  selector: 'app-listen-reciter',
  imports: [
    TranslatePipe, ListenPlayerComponent, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton, IonContent,
    IonFooter, IonIcon, IonProgressBar, IonSearchbar, IonSelect, SelectTextsDirective, IonSelectOption, IonSpinner,
  ],
  templateUrl: './listen-reciter.page.html',
  styleUrl: './listen.page.scss',
})
export class ListenReciterPage {
  /** Route parameter. */
  readonly id = input.required<string>();
  /** From the riwayah filter: open that riwayah's recording. */
  readonly rewaya = input<string | undefined>();

  readonly catalog = inject(AudioCatalogService);
  readonly player = inject(AudioPlayerService);
  readonly quran = inject(QuranService);
  private readonly toasts = inject(ToastController);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);

  readonly failed = signal(false);
  readonly query = signal('');
  /** Asking the server for the sizes before a whole-recording download. */
  readonly checking = signal(false);
  private readonly moshafId = signal<number | null>(null);

  readonly reciter = computed(() => (this.catalog.ready() ? this.catalog.reciter(Number(this.id())) : undefined));
  readonly moshaf = computed<Moshaf | undefined>(() => {
    const r = this.reciter();
    return r?.moshaf.find((m) => m.id === this.moshafId()) ?? r?.moshaf[0];
  });
  readonly savedCount = computed(() => {
    const m = this.moshaf();
    return m ? (this.player.downloaded()[m.id]?.length ?? 0) : 0;
  });
  readonly suras = computed(() => {
    const m = this.moshaf();
    if (!m || !this.quran.ready()) return [];
    const q = this.query().trim();
    const nq = normalizeArabic(q);
    return this.catalog
      .suras(m)
      .map((n) => this.quran.sura(n))
      .filter((s) => !q || String(s.index) === q || normalizeArabic(s.name).includes(nq) || `${s.tname} ${s.ename}`.toLowerCase().includes(q.toLowerCase()));
  });

  ionViewWillEnter(): void {
    void this.player.init();
    Promise.all([this.catalog.load(), this.quran.load()])
      .then(async () => {
        const last = await this.player.last();
        const r = this.reciter();
        const rw = Number(this.rewaya());
        const ofRiwayah = rw ? r?.moshaf.find((m) => m.rewaya === rw) : undefined;
        if (ofRiwayah) this.moshafId.set(ofRiwayah.id);
        else if (last && r && last.reciter === r.id && !this.moshafId()) this.moshafId.set(last.moshaf);
        const m = this.moshaf();
        if (m) await this.player.refreshDownloaded(m);
      })
      .catch(() => this.failed.set(true));
  }

  setMoshaf(id: number): void {
    this.moshafId.set(id);
    const m = this.moshaf();
    if (m) void this.player.refreshDownloaded(m);
  }

  isOn(sura: number): boolean {
    const now = this.player.now();
    return now?.kind === 'sura' && now.moshaf.id === this.moshaf()?.id && now.sura === sura;
  }

  play(sura: number): void {
    const r = this.reciter(), m = this.moshaf();
    if (!r || !m) return;
    if (this.isOn(sura)) this.player.toggle();
    else void this.player.playSura(r, m, sura);
  }

  playAll(): void {
    const first = this.suras()[0];
    if (first) this.play(first.index);
  }

  suraLabel(index: number): string {
    const s = this.quran.sura(index);
    return this.catalog.lang() === 'ar' ? s.name : s.tname;
  }

  async download(sura: number): Promise<void> {
    const m = this.moshaf();
    if (!m) return;
    const ok = await this.player.downloadSura(m, sura);
    const toast = await this.toasts.create({
      message: this.translate.instant(ok ? 'listen.downloaded' : 'listen.downloadFailed'),
      duration: 2000,
      position: 'top',
    });
    await toast.present();
  }

  /** Checks what is missing and its size, asks, then downloads the whole recording one sura after another. */
  async downloadAll(): Promise<void> {
    const m = this.moshaf();
    if (!m || this.checking()) return;
    this.checking.set(true);
    const { suras, bytes } = await this.player.missing(m).finally(() => this.checking.set(false));
    if (!suras.length) return;
    const t = (key: string, params?: object) => this.translate.instant(key, params);
    const count = this.number(suras.length);
    const alert = await this.alerts.create({
      header: t('listen.downloadAllTitle'),
      message: bytes ? t('listen.downloadAllText', { count, size: this.size(bytes) }) : t('listen.downloadAllTextNoSize', { count }),
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('listen.download'), role: 'confirm' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'confirm') return;
    const result = await this.player.downloadAll(m, suras);
    const message =
      result.stopped === 'failing' ? 'listen.downloadsStopped'
      : result.stopped ? null
      : result.failed ? 'listen.someFailed'
      : 'listen.allDownloaded';
    if (!message) return;
    const toast = await this.toasts.create({ message: t(message, { count: this.number(result.failed) }), duration: 3500, position: 'top' });
    await toast.present();
  }

  async deleteAll(): Promise<void> {
    const m = this.moshaf();
    if (!m) return;
    const alert = await this.alerts.create({
      header: this.translate.instant('listen.deleteAll'),
      message: this.translate.instant('listen.deleteAllText', { count: this.number(this.savedCount()) }),
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        { text: this.translate.instant('common.delete'), role: 'destructive', handler: () => void this.player.deleteAll(m) },
      ],
    });
    await alert.present();
  }

  private number(n: number): string {
    return new Intl.NumberFormat(intlLocale(this.catalog.lang())).format(n);
  }

  /** 340 MB, 1.2 GB. */
  private size(bytes: number): string {
    const gb = bytes >= 1e9;
    return new Intl.NumberFormat(intlLocale(this.catalog.lang()), {
      style: 'unit', unit: gb ? 'gigabyte' : 'megabyte', maximumFractionDigits: gb ? 1 : 0,
    }).format(gb ? bytes / 1e9 : Math.max(1, bytes / 1e6));
  }

  async remove(sura: number): Promise<void> {
    const m = this.moshaf();
    if (!m) return;
    const alert = await this.alerts.create({
      header: this.translate.instant('listen.deleteDownload'),
      message: this.suraLabel(sura),
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        { text: this.translate.instant('common.delete'), role: 'destructive', handler: () => void this.player.deleteSura(m, sura) },
      ],
    });
    await alert.present();
  }
}
