import { Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonProgressBar, IonSpinner, IonTitle,
  IonToolbar, NavController, ToastController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Capacitor } from '@capacitor/core';
import { EDITIONS, Edition, MushafEditionsService } from '../../core/quran/mushaf-editions.service';
import { QuranService } from '../../core/quran/quran.service';
import { SettingsService } from '../../core/services/settings.service';

/** Choose the mushaf the Quran tab opens: Madinah, colour tajweed, Shamarly, or a riwaya (Warsh, Qalun...). */
@Component({
  selector: 'app-mushaf-editions',
  imports: [NgTemplateOutlet, TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonButton, IonIcon, IonSpinner, IonProgressBar],
  templateUrl: './mushaf-editions.page.html',
  styleUrl: './mushaf-editions.page.scss',
})
export class MushafEditionsPage {
  readonly editions = inject(MushafEditionsService);
  private readonly quran = inject(QuranService);
  private readonly settings = inject(SettingsService);
  private readonly nav = inject(NavController);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly translate = inject(TranslateService);

  readonly lang = computed(() => this.settings.settings().language);
  readonly mushafs = EDITIONS.filter((e) => e.kind !== 'riwaya');
  readonly riwayat = EDITIONS.filter((e) => e.kind === 'riwaya');
  /** Saving the Shamarly pages uses the phone's storage; in the browser they always stream. */
  readonly native = Capacitor.isNativePlatform();

  ionViewWillEnter(): void {
    void this.editions.load();
    void this.quran.load().catch(() => {});
  }

  name(e: Edition): string {
    return this.lang() === 'ar' ? e.nameAr : e.nameEn;
  }

  qiraah(e: Edition): string {
    return this.lang() === 'ar' ? e.qiraahAr : e.qiraahEn;
  }

  /** "Use" makes it the Quran tab's mushaf and opens it (downloading it first when needed). */
  async use(e: Edition): Promise<void> {
    if (!this.editions.isReady(e.id) && !(await this.download(e))) return;
    await this.editions.setCurrent(e.id);
    await this.open(e);
  }

  async open(e: Edition): Promise<void> {
    if (e.kind === 'hafs' || e.kind === 'tajweed') {
      const last = this.quran.lastRead();
      await this.nav.navigateForward(['/mushaf', last?.page ?? 1], { queryParams: last ? { sura: last.sura, aya: last.aya } : undefined });
      return;
    }
    const page = (await this.editions.lastPage(e.id)) ?? (await this.editions.pageFor(e.id, this.quran.lastRead() ?? { sura: 1, aya: 1 }).catch(() => 1));
    await this.nav.navigateForward(['/mushaf-edition', e.id, page]);
  }

  async download(e: Edition): Promise<boolean> {
    const ok = await this.editions.download(e.id);
    if (!ok && !this.editions.progress()) {
      const toast = await this.toasts.create({ message: this.translate.instant('editions.downloadFailed'), duration: 2500, position: 'top' });
      await toast.present();
    }
    return ok;
  }

  async remove(e: Edition): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('editions.delete'),
      message: this.name(e),
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        { text: this.translate.instant('common.delete'), role: 'destructive', handler: () => void this.editions.remove(e.id) },
      ],
    });
    await alert.present();
  }

  openListen(): void {
    void this.nav.navigateForward('/listen', { queryParams: { tab: 'riwayat' } });
  }
}
