import { Location } from '@angular/common';
import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSelect, IonSelectOption, IonSpinner, IonTitle,
  IonToolbar, NavController, createGesture,
} from '@ionic/angular';
import { Preferences } from '@capacitor/preferences';
import { SelectTextsDirective } from '../../shared/select-texts.directive';
import { TranslatePipe } from '@ngx-translate/core';
import {
  Edition, EditionId, MushafEditionsService, RiwayaAyah, RiwayaMushaf, ShamarlyMap, edition,
} from '../../core/quran/mushaf-editions.service';
import { QuranService } from '../../core/quran/quran.service';
import { normalizeArabic, splitBasmala } from '../../core/quran/quran-utils';
import { SettingsService } from '../../core/services/settings.service';

interface Block {
  /** Sura heading before this ayah. */
  sura?: { index: number; name: string; basmala: boolean };
  ayah: RiwayaAyah;
}

/**
 * Reads another printed mushaf page by page: the Shamarly mushaf (page images) or a riwaya of the King Fahd Complex
 * (its own text, font and pages). Swipe or use the arrows, choose a sura, the last page is remembered.
 */
@Component({
  selector: 'app-mushaf-edition',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonButton, IonIcon, IonContent, IonSpinner, IonSelect, SelectTextsDirective, IonSelectOption],
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
  /** Shamarly: the scanned page image instead of the text laid out on its pages. */
  readonly scanned = signal(false);

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
        // The Hafs text on the Shamarly mushaf's own pages: each ayah separate, any text size, nothing to download.
        const map = await this.editions.shamarlyMap();
        this.map.set(map);
        this.riwaya.set(this.shamarlyText(map));
        this.font.set('AmiriQuran');
      } else {
        const [m, family] = await Promise.all([this.editions.riwaya(e.id), this.editions.font(e.id)]);
        this.riwaya.set(m);
        this.font.set(family);
      }
      let p = Number(this.pageParam()) || 1;
      const sura = Number(this.sura());
      if (sura) p = await this.editions.pageFor(e.id, { sura, aya: Number(this.aya()) || 1 });
      await this.goTo(p);
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
    this.imageSrc.set(await this.editions.shamarlySrc(p));
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

  imageFailed(): void {
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
