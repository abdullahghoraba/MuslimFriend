import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, IonSpinner, IonSearchbar, IonSegment, IonSegmentButton, IonLabel, IonToggle, AlertController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { QuranService } from '../../core/quran/quran.service';
import { AyahRef, normalizeArabic, TOTAL_PAGES } from '../../core/quran/quran-utils';
import { SettingsService } from '../../core/services/settings.service';
import { EditionId, MushafEditionsService, edition } from '../../core/quran/mushaf-editions.service';

@Component({ selector: 'app-quran-index', imports: [RouterLink, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, IonSpinner, IonSearchbar, IonSegment, IonSegmentButton, IonLabel, IonToggle], templateUrl: './quran-index.page.html', styleUrl: './quran-index.page.scss' })
export class QuranIndexPage {
  readonly quran = inject(QuranService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private readonly editions = inject(MushafEditionsService);
  readonly lang = computed(() => this.settings.settings().language);
  readonly segment = signal('suras');
  readonly filter = signal('');
  readonly failed = signal(false);
  readonly expanded = signal<number | null>(null);
  readonly juz = Array.from({length: 30}, (_, i) => i + 1);
  readonly hizbs = Array.from({length: 60}, (_, i) => i + 1);
  readonly actions = [{key:'search',icon:'search-outline',route:'/quran-search'}, {key:'marks',icon:'bookmark-outline',route:'/quran-marks'}, {key:'khatmah',icon:'flag-outline',route:'/khatmah'}, {key:'hifz',icon:'school-outline',route:'/hifz'}, {key:'editions',icon:'layers-outline',route:'/mushaf-editions'}, {key:'qibla',icon:'compass-outline',route:'/qibla'}];
  readonly suras = computed(() => {
    if (!this.quran.ready()) return [];
    const q = normalizeArabic(this.filter()).toLowerCase();
    return this.quran.suras.filter(s => normalizeArabic(s.name).includes(q) || (s.tname+' '+s.ename).toLowerCase().includes(q));
  });
  /** Opening the Quran tab the first time after the app starts jumps to the last page read. */
  private static resumed = false;
  ionViewWillEnter(): void {
    void this.quran.loadReadingPrefs();
    void this.editions.load();
    this.quran.load().then(async () => {
      await this.quran.loadReadingPrefs();
      if (QuranIndexPage.resumed) return;
      QuranIndexPage.resumed = true;
      if (this.quran.autoResume() && this.quran.lastRead()) this.continue();
    }).catch(() => this.failed.set(true));
  }
  openMark(): void { const m = this.quran.readingMark(); if (m) void this.router.navigate(['/mushaf', m.page], { queryParams: { sura: m.sura, aya: m.aya } }); }
  digits(n: number): string { return String(n); }
  words(ref: AyahRef): string { return this.quran.ayah(ref).text.split(/\s+/).slice(0,6).join(' ') + '…'; }
  /** Opens [ref] in the chosen mushaf: the Madinah reader (also for colour tajweed) or Shamarly / a riwaya. */
  open(ref: AyahRef): void {
    const e = this.otherEdition();
    if (e) void this.router.navigate(['/mushaf-edition', e, 1], {queryParams: ref});
    else void this.router.navigate(['/mushaf', this.quran.pageOf(ref)], {queryParams: ref});
  }
  private otherEdition(): EditionId | null {
    const e = edition(this.editions.current());
    return e && (e.kind === 'images' || e.kind === 'riwaya') && this.editions.isReady(e.id) ? e.id : null;
  }
  continue(): void {
    const e = this.otherEdition();
    if (e) { void this.editions.lastPage(e).then(p => this.router.navigate(['/mushaf-edition', e, p ?? 1])); return; }
    const last=this.quran.lastRead(); void this.router.navigate(['/mushaf', last?.page ?? 1], {queryParams: last ? {sura:last.sura,aya:last.aya} : undefined}); }
  quarters(h: number): number[] { return [0,1,2,3].map(i => (h-1)*4+i+1); }
  async goToPage(): Promise<void> {
    const alert = await this.alerts.create({header:this.translate.instant('quran.goToPage'), message:this.translate.instant('quran.pageHint'), inputs:[{name:'target',type:'text',placeholder:'1–604 / 2:255',attributes:{'aria-label':this.translate.instant('quran.goToPage')}}], buttons:[{text:this.translate.instant('quran.cancel'),role:'cancel'},{text:this.translate.instant('quran.go'),handler:(data: {target:string}) => {
      const value = (data.target ?? '').trim().replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
      const match = /^(\d+):(\d+)$/.exec(value);
      if (match) { const sura=Number(match[1]), aya=Number(match[2]); if (sura>=1 && sura<=114 && aya>=1 && aya<=this.quran.sura(sura).ayas) {this.open({sura,aya}); return true;} }
      else if (/^\d+$/.test(value) && Number(value)>=1 && Number(value)<=TOTAL_PAGES) {void this.router.navigate(['/mushaf',Number(value)]); return true;}
      alert.message=this.translate.instant('quran.invalidTarget'); return false;
    }}]}); await alert.present();
  }
}
