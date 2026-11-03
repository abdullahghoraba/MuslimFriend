import { Location } from '@angular/common';
import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import {
  ActionSheetController, IonBackButton, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonSelect,
  IonSelectOption, IonSpinner, IonTitle, IonToolbar, ModalController, NavController, ToastController, createGesture,
} from '@ionic/angular';
import { Preferences } from '@capacitor/preferences';
import { SelectTextsDirective } from '../../shared/select-texts.directive';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  Edition, EditionId, MushafEditionsService, RiwayaAyah, RiwayaMushaf, ShamarlyArea, ShamarlyMap, edition, shamarlyAyahAt,
} from '../../core/quran/mushaf-editions.service';
import { QuranService } from '../../core/quran/quran.service';
import { RecitationService } from '../../core/quran/recitation.service';
import { AyahRef, normalizeArabic, splitBasmala } from '../../core/quran/quran-utils';
import { SettingsService } from '../../core/services/settings.service';
import { ShareService } from '../../core/services/share.service';
import { TafsirSheetComponent } from '../mushaf/tafsir-sheet.component';
import { WordByWordSheetComponent } from '../mushaf/word-by-word-sheet.component';

interface Block {
  /** Sura heading before this ayah. */
  sura?: { index: number; name: string; basmala: boolean };
  ayah: RiwayaAyah;
}

/** A highlighted ayah on a scanned page, in percent of the page. */
interface Mark {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Reads another printed mushaf page by page: the Shamarly mushaf (its scanned pages, each ayah tappable) or a riwaya
 * of the King Fahd Complex (its own text, font and pages). Swipe or use the arrows, choose a sura, the last page is
 * remembered. Tap an ayah for tafsir, its words, recitation, copy and share.
 */
@Component({
  selector: 'app-mushaf-edition',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonButton, IonIcon, IonContent, IonSpinner, IonSelect, SelectTextsDirective, IonSelectOption, IonFooter],
  templateUrl: './mushaf-edition.page.html',
  styleUrl: './mushaf-edition.page.scss',
})
export class MushafEditionPage {
  readonly editionParam = input<string>('warsh', { alias: 'edition' });
  readonly pageParam = input<string>('1', { alias: 'page' });
  readonly sura = input<string | undefined>();
  readonly aya = input<string | undefined>();

  readonly editions = inject(MushafEditionsService);
  private readonly quran = inject(QuranService);
  private readonly settings = inject(SettingsService);
  private readonly location = inject(Location);
  readonly nav = inject(NavController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly recitation = inject(RecitationService);
  private readonly modals = inject(ModalController);
  private readonly sheets = inject(ActionSheetController);
  private readonly toasts = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private readonly share = inject(ShareService);

  readonly info = computed<Edition | undefined>(() => edition(this.editionParam()));
  readonly page = signal(1);
  readonly failed = signal(false);
  readonly imageLoading = signal(true);
  readonly imageSrc = signal('');
  readonly font = signal('');
  readonly riwaya = signal<RiwayaMushaf | null>(null);
  readonly map = signal<ShamarlyMap | null>(null);
  readonly lang = computed(() => this.settings.settings().language);
  readonly theme = signal<'paper' | 'sepia' | 'night'>('paper');
  readonly scale = signal(1);
  /** Shamarly: the scanned page (the default) instead of the text laid out on its pages. */
  readonly scanned = signal(false);
  /** Where each ayah sits on each Shamarly page. */
  readonly areas = signal<ShamarlyArea[][] | null>(null);
  /** The tapped ayah. */
  readonly selected = signal<AyahRef | null>(null);
  /** The page image came from archive.org's storage server; on failure it is tried once through the redirect. */
  private viaRedirect = false;

  /**
   * Ayah numbers follow Hafs (so tafsir, word meanings and the reciters match) in Shamarly and in Shu'bah, which
   * counts the ayat like Hafs (al-Kufi). The other riwayat count some ayat differently, so they only copy and share.
   */
  readonly hafsNumbering = computed(() => this.info()?.kind === 'images' || this.info()?.id === 'shouba');

  /** Highlight on the scanned page: the tapped ayah, else the one being recited. */
  readonly marks = computed<Mark[]>(() => {
    const ref = this.selected() ?? (this.hafsNumbering() ? this.recitation.current() : null);
    const page = this.areas()?.[this.page() - 1];
    if (!ref || !page || !this.scanned()) return [];
    const out: Mark[] = [];
    for (const [s, a, r] of page) {
      if (s !== ref.sura || a !== ref.aya) continue;
      for (let i = 0; i < r.length; i += 4) {
        out.push({ left: r[i] / 10, top: r[i + 1] / 10, width: (r[i + 2] - r[i]) / 10, height: (r[i + 3] - r[i + 1]) / 10 });
      }
    }
    return out;
  });

  /** "Al-Baqarah · 255" for the action bar. */
  readonly selectedLabel = computed(() => {
    const s = this.selected();
    if (!s || !this.quran.ready()) return '';
    const name = this.riwaya()?.suraNames[s.sura - 1] || this.quran.sura(s.sura).name;
    return `${name} · ${new Intl.NumberFormat(this.lang() === 'ar' ? 'ar-EG' : undefined).format(s.aya)}`;
  });

  readonly pageCount = computed(() => this.map()?.pages ?? this.riwaya()?.pages.length ?? 604);
  readonly title = computed(() => {
    const e = this.info();
    return e ? (this.lang() === 'ar' ? e.nameAr : e.nameEn) : '';
  });

  readonly blocks = computed<Block[]>(() => {
    const m = this.riwaya();
    if (!m) return [];
    return (m.pages[this.page() - 1] ?? []).map((ayah) => {
      const [s, a, text] = ayah;
      if (a !== 1) return { ayah };
      // al-Fatihah: the basmala is its first ayah in the riwayat that count it (Hafs, Shu'bah).
      const basmala = s !== 9 && !(s === 1 && normalizeArabic(text).startsWith('بسم'));
      return { sura: { index: s, name: m.suraNames[s - 1] || this.quranSuraName(s), basmala }, ayah };
    });
  });

  /** Sura of the page, for the header and the sura list. */
  readonly pageSura = computed(() => {
    const p = this.page();
    const m = this.riwaya();
    if (m) {
      for (let i = p - 1; i >= 0; i--) if (m.pages[i]?.length) return m.pages[i][0][0];
      return 1;
    }
    const map = this.map();
    if (map) {
      for (let i = p - 1; i >= 0; i--) if (map.first[i]) return map.first[i]![0];
    }
    return 1;
  });

  readonly suraOptions = computed(() => (this.quran.ready() ? this.quran.suras.map((s) => ({ index: s.index, name: s.name })) : []));

  async ionViewWillEnter(): Promise<void> {
    const e = this.info();
    if (!e || e.kind === 'hafs' || e.kind === 'tajweed') {
      void this.nav.navigateRoot('/mushaf-editions');
      return;
    }
    try {
      await Promise.all([this.editions.load(), this.quran.load(), this.loadTheme()]);
      if (e.kind === 'images') {
        // The scanned Shamarly pages, each ayah tappable; the Hafs text laid out on the same pages on request.
        const [map, areas] = await Promise.all([this.editions.shamarlyMap(), this.editions.shamarlyAyat().catch(() => null)]);
        this.map.set(map);
        this.areas.set(areas);
        this.riwaya.set(this.shamarlyText(map));
        this.font.set('AmiriQuran');
        this.scanned.set(true);
      } else {
        const [m, family] = await Promise.all([this.editions.riwaya(e.id), this.editions.font(e.id)]);
        this.riwaya.set(m);
        this.font.set(family);
      }
      let p = Number(this.pageParam()) || 1;
      const sura = Number(this.sura());
      if (sura) p = await this.editions.pageFor(e.id, { sura, aya: Number(this.aya()) || 1 });
      await this.goTo(p);
      if (sura && this.hafsNumbering()) this.selected.set({ sura, aya: Number(this.aya()) || 1 });
    } catch {
      this.failed.set(true);
    }
  }

  ionViewDidEnter(): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>('ion-content');
    if (!el) return;
    createGesture({
      el,
      gestureName: 'edition-swipe',
      threshold: 15,
      direction: 'x',
      onEnd: (d) => {
        if (Math.abs(d.deltaX) < 60 || Math.abs(d.deltaY) > Math.abs(d.deltaX)) return;
        // Like a printed mushaf: drag right to reach the next page.
        void (d.deltaX > 0 ? this.next() : this.prev());
      },
    }).enable(true);
  }

  async goTo(page: number): Promise<void> {
    const e = this.info();
    if (!e) return;
    const p = Math.min(this.pageCount(), Math.max(1, Math.round(page)));
    if (p !== this.page()) this.selected.set(null);
    this.page.set(p);
    this.location.replaceState(`/mushaf-edition/${e.id}/${p}`);
    void this.host.nativeElement.querySelector('ion-content')?.scrollToTop(0);
    void this.editions.saveLastPage(e.id as EditionId, p);
    if (e.kind === 'images' && this.scanned()) await this.loadImage(p);
  }

  /** Shows the scanned Shamarly page (streamed from archive.org, or saved on the phone), or the text again. */
  async toggleScanned(): Promise<void> {
    this.scanned.update((v) => !v);
    this.failed.set(false);
    if (this.scanned()) await this.loadImage(this.page());
  }

  private async loadImage(p: number): Promise<void> {
    this.imageLoading.set(true);
    this.viaRedirect = false;
    const src = await this.editions.shamarlySrc(p);
    if (this.page() !== p) return; // turned again meanwhile
    this.imageSrc.set(src);
  }

  /** The page is shown: fetch the pages either side so turning is instant. */
  imageLoaded(): void {
    this.imageLoading.set(false);
    const p = this.page();
    void this.editions.prefetchShamarly(p + 1).then(() => this.editions.prefetchShamarly(p - 1));
  }

  // ---- ayah actions ------------------------------------------------------------------------------

  /** A tap on the scanned page selects the ayah under it (a second tap on it clears the selection). */
  tapPage(ev: MouseEvent): void {
    const page = this.areas()?.[this.page() - 1];
    const img = ev.currentTarget as HTMLElement;
    if (!page) return;
    const box = img.getBoundingClientRect();
    this.toggle(shamarlyAyahAt(page, ((ev.clientX - box.left) / box.width) * 1000, ((ev.clientY - box.top) / box.height) * 1000));
  }

  /** A tap on an ayah of the text pages. */
  tapAyah(ayah: RiwayaAyah): void {
    this.toggle({ sura: ayah[0], aya: ayah[1] });
  }

  isSelected(ayah: RiwayaAyah): boolean {
    const s = this.selected();
    return !!s && s.sura === ayah[0] && s.aya === ayah[1];
  }

  private toggle(ref: AyahRef | null): void {
    const s = this.selected();
    this.selected.set(!ref || (s && s.sura === ref.sura && s.aya === ref.aya) ? null : ref);
  }

  async openTafsir(): Promise<void> {
    const ref = this.selected();
    if (!ref) return;
    const modal = await this.modals.create({ component: TafsirSheetComponent, componentProps: { ayahRef: ref }, breakpoints: [0, 0.5, 1], initialBreakpoint: 0.5 });
    await modal.present();
  }

  async openWords(): Promise<void> {
    const ref = this.selected();
    if (!ref) return;
    const modal = await this.modals.create({ component: WordByWordSheetComponent, componentProps: { ayahRef: ref }, breakpoints: [0, 0.5, 1], initialBreakpoint: 0.5 });
    await modal.present();
  }

  /** Recites from the selected ayah on; the page highlights each ayah as it is recited. */
  async play(): Promise<void> {
    const ref = this.selected();
    if (!ref) return;
    this.selected.set(null);
    await this.recitation.play(ref);
    if (this.recitation.error()) await this.toast('mushaf.audioError');
  }

  /** The Madinah mushaf at this ayah, for bookmarks, notes, highlights and memorisation. */
  openInMushaf(): void {
    const ref = this.selected();
    if (!ref) return;
    void this.nav.navigateForward(['/mushaf', this.quran.pageOf(ref)], { queryParams: { sura: ref.sura, aya: ref.aya } });
  }

  async copy(): Promise<void> {
    const text = this.selectedText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      await this.toast('mushaf.copied');
    } catch {
      await this.share.shareText(this.translate.instant('app.name'), text);
    }
  }

  async shareAyah(): Promise<void> {
    const ref = this.selected();
    const text = this.selectedText();
    if (!ref || !text) return;
    const t = (key: string) => this.translate.instant(key);
    const sheet = await this.sheets.create({
      header: t('common.share'),
      buttons: [
        { text: t('share.asImage'), icon: 'image-outline', data: 'image' },
        { text: t('share.asText'), icon: 'document-text-outline', data: 'text' },
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
    const { data } = await sheet.onDidDismiss();
    if (data === 'text') await this.share.shareText(t('app.name'), text);
    else if (data === 'image') {
      await this.share
        .sharePassage({ title: t('app.name'), arabic: this.ayahText(ref), source: this.selectedLabel(), brand: t('app.name'), quran: true })
        .catch(() => void this.toast('reader.shareFailed'));
    }
  }

  /** The ayah in this mushaf's own wording (a riwaya differs from Hafs), with its number. */
  private ayahText(ref: AyahRef): string {
    if (this.info()?.kind === 'riwaya') {
      const own = this.riwaya()?.pages.flat().find(([s, a]) => s === ref.sura && a === ref.aya);
      if (own) return own[2];
    }
    const a = this.quran.ayah(ref);
    return `${splitBasmala(a, a.text).text} ﴿${ref.aya}﴾`;
  }

  private selectedText(): string {
    const ref = this.selected();
    return ref ? `${this.ayahText(ref)}\n[${this.selectedLabel()}]` : '';
  }

  private async toast(key: string): Promise<void> {
    const t = await this.toasts.create({ message: this.translate.instant(key), duration: 1600, position: 'bottom' });
    await t.present();
  }

  /** Larger or smaller text; shared with the mushaf's own size setting. */
  async stepScale(delta: number): Promise<void> {
    const next = Math.round(Math.min(2, Math.max(0.8, this.scale() + delta)) * 100) / 100;
    this.scale.set(next);
    const { value } = await Preferences.get({ key: 'mushafView' });
    let view: Record<string, unknown> = {};
    try {
      view = value ? JSON.parse(value) : {};
    } catch {
      /* replace */
    }
    await Preferences.set({ key: 'mushafView', value: JSON.stringify({ ...view, scale: next }) });
  }

  /** Pages of the Shamarly mushaf filled with the Tanzil (Hafs) text: page p holds the ayat that start on it. */
  private shamarlyText(map: ShamarlyMap): RiwayaMushaf {
    const starts = map.first.map((f) => (f ? this.quran.ayah({ sura: f[0], aya: f[1] }).index : -1));
    const digits = new Intl.NumberFormat('ar-EG');
    const pages: RiwayaAyah[][] = starts.map((start, i) => {
      if (start < 0) return [];
      const nextStart = starts.slice(i + 1).find((x) => x >= 0) ?? 6236;
      const out: RiwayaAyah[] = [];
      for (let g = start; g < nextStart; g++) {
        const a = this.quran.ayahAt(g);
        out.push([a.sura, a.aya, `${splitBasmala(a, a.text).text} ﴿${digits.format(a.aya)}﴾`]);
      }
      return out;
    });
    return { pages, suraNames: this.quran.suras.map((x) => x.name) };
  }

  next(): Promise<void> {
    return this.goTo(this.page() + 1);
  }

  prev(): Promise<void> {
    return this.goTo(this.page() - 1);
  }

  async goToSura(sura: number): Promise<void> {
    const e = this.info();
    if (e) await this.goTo(await this.editions.pageFor(e.id, { sura, aya: 1 }));
  }

  async imageFailed(): Promise<void> {
    // The storage server may have moved: forget it and try once through archive.org's redirect.
    if (!this.viaRedirect) {
      this.viaRedirect = true;
      await this.editions.forgetShamarlyServer();
      this.imageSrc.set(await this.editions.shamarlySrc(this.page(), true));
      return;
    }
    this.imageLoading.set(false);
    this.failed.set(true);
  }

  retry(): void {
    this.failed.set(false);
    void this.goTo(this.page());
  }

  private quranSuraName(s: number): string {
    return this.quran.ready() ? this.quran.sura(s).name : '';
  }

  /** The mushaf's paper / sepia / night choice and text size apply here too. */
  private async loadTheme(): Promise<void> {
    const { value } = await Preferences.get({ key: 'mushafView' });
    try {
      const v = value ? (JSON.parse(value) as { theme?: string; scale?: number }) : {};
      const t = v.theme;
      if (v.scale) this.scale.set(v.scale);
      if (t === 'paper' || t === 'sepia' || t === 'night') this.theme.set(t);
      else if (document.documentElement.classList.contains('ion-palette-dark')) this.theme.set('night');
    } catch {
      /* default */
    }
  }
}
