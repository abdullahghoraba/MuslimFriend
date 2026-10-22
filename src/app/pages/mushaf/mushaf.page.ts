import { Location } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import {
  ActionSheetController,
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonLabel,
  IonRange,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  RangeCustomEvent,
  ToastController,
  NavController,
  createGesture,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { KhatmahService } from '../../core/quran/khatmah.service';
import { MARK_COLORS, MarkColor, MarksService } from '../../core/quran/marks.service';
import { HifzService } from '../../core/quran/hifz.service';
import { AyahRef, TOTAL_PAGES, splitBasmala } from '../../core/quran/quran-utils';
import { Ayah, QuranService } from '../../core/quran/quran.service';
import { RECITERS, RecitationService, RepeatMode } from '../../core/quran/recitation.service';
import { HapticsService } from '../../core/services/haptics.service';
import { SettingsService } from '../../core/services/settings.service';
import { ShareService } from '../../core/services/share.service';
import { TafsirSheetComponent } from './tafsir-sheet.component';

type MushafTheme = 'paper' | 'sepia' | 'night';

interface PageBlock {
  /** Sura heading before this ayah (first ayah of a sura). */
  suraHeader?: { sura: number; name: string; ayas: number; type: string };
  basmala: boolean;
  /** The basmala exactly as written before this ayah in the source text. */
  basmalaText: string;
  ayah: Ayah;
  text: string;
  num: string;
}

const VIEW_PREFS = 'mushafView';
/** A page counts as read for khatmah after being on screen this long. */
const READ_AFTER_MS = 3000;

/**
 * The mushaf: Madani 604-page layout, Tanzil Uthmani text in Amiri Quran.
 * Swipe to turn pages (RTL like a printed mushaf), tap an ayah for tafsir, recitation, bookmarks
 * (coloured), star, highlight, note, copy and share.
 */
@Component({
  selector: 'app-mushaf',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonButton, IonIcon, IonContent,
    IonFooter, IonRange, IonSegment, IonSegmentButton, IonLabel, IonSelect, IonSelectOption, IonSpinner,
  ],
  templateUrl: './mushaf.page.html',
  styleUrl: './mushaf.page.scss',
})
export class MushafPage {
  /** Route param. */
  readonly pageParam = input<string>('1', { alias: 'page' });
  readonly sura = input<string | undefined>();
  readonly aya = input<string | undefined>();
  /** Set when opened from a hifz plan («ابدأ الحفظ»): today's new portion is marked as a range. */
  readonly hifzPlan = input<string | undefined>(undefined, { alias: 'hifz' });
  /** Set by «استمع وكرّر»: ask how many times to repeat, then play the marked portion. */
  readonly repeatParam = input<string | undefined>(undefined, { alias: 'repeat' });

  readonly quran = inject(QuranService);
  readonly marks = inject(MarksService);
  readonly recitation = inject(RecitationService);
  readonly hifz = inject(HifzService);
  private readonly khatmah = inject(KhatmahService);
  private readonly settings = inject(SettingsService);
  private readonly haptics = inject(HapticsService);
  private readonly share = inject(ShareService);
  private readonly translate = inject(TranslateService);
  private readonly location = inject(Location);
  private readonly modals = inject(ModalController);
  private readonly sheets = inject(ActionSheetController);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly nav = inject(NavController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly reciters = RECITERS;
  readonly colors = MARK_COLORS;
  readonly repeatOptions: RepeatMode[] = [1, 2, 3, 5, 7, 10, 15, 20, 0];
  readonly speeds = [0.75, 1, 1.25, 1.5];

  readonly page = signal(1);
  readonly selected = signal<AyahRef | null>(null);
  readonly settingsOpen = signal(false);
  readonly theme = signal<MushafTheme>('paper');
  readonly quranScale = signal(1);
  readonly slide = signal<'none' | 'next' | 'prev'>('none');
  readonly lang = computed(() => this.settings.settings().language);

  readonly blocks = computed<PageBlock[]>(() => {
    if (!this.quran.ready()) return [];
    return this.quran.pageAyahs(this.page()).map((ayah) => {
      const split = splitBasmala(ayah, ayah.text);
      const s = this.quran.sura(ayah.sura);
      return {
        suraHeader: ayah.aya === 1 ? { sura: s.index, name: s.name, ayas: s.ayas, type: s.type } : undefined,
        basmala: split.basmala,
        basmalaText: split.basmalaText,
        ayah,
        text: split.text,
        num: String(ayah.aya),
      };
    });
  });

  readonly header = computed(() => {
    const first = this.blocks()[0]?.ayah;
    if (!first) return { sura: '', juz: '', hizb: '' };
    const q = this.quran.quarterOf(first);
    const ar = this.lang() === 'ar';
    const hizb = Math.ceil(q / 4);
    const rub = ((q - 1) % 4) + 1;
    return {
      sura: ar ? `سورة ${this.quran.sura(first.sura).name}` : this.quran.sura(first.sura).tname,
      juz: ar ? `الجزء ${this.quran.juzOf(first)}` : `Juz ${this.quran.juzOf(first)}`,
      hizb: ar
        ? `الحزب ${hizb}${rub > 1 ? ` · ${['', '', 'ربع', 'نصف', 'ثلاثة أرباع'][rub]}` : ''}`
        : `Hizb ${hizb}${rub > 1 ? ` · ${['', '', '¼', '½', '¾'][rub]}` : ''}`,
    };
  });

  readonly pageLabel = computed(() => String(this.page()));
  /** Bookmarks placed on this page (shown as coloured ribbons). */
  readonly pageBookmarks = computed(() => this.marks.bookmarks().filter((b) => b.page === this.page()));

  private readTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Follow the recitation onto the next page.
    effect(() => {
      const cur = this.recitation.current();
      if (!cur || !this.quran.ready()) return;
      const p = this.quran.pageOf(cur);
      untracked(() => {
        if (p !== this.page()) this.goTo(p, p > this.page() ? 'next' : 'prev');
        queueMicrotask(() => this.scrollToAyah(cur));
      });
    });
  }

  async ionViewWillEnter(): Promise<void> {
    await Promise.all([this.quran.load(), this.marks.load(), this.khatmah.load(), this.recitation.loadPrefs(), this.loadView(), this.hifz.load()]);
    const p = clampPage(Number(this.pageParam()));
    this.goTo(p, 'none');
    const sura = Number(this.sura());
    const aya = Number(this.aya());
    if (sura && aya) {
      const ref = { sura, aya };
      this.selected.set(ref);
      // From a hifz plan: mark today's portion (within this sura) as a range.
      const planId = Number(this.hifzPlan());
      if (planId) {
        const portion = this.hifz.today(planId).newPortion.filter((r) => r.sura === sura);
        const last = portion[portion.length - 1];
        if (last && last.aya > aya) {
          this.rangeTo.set(last.aya);
          this.rangeMode.set(true);
        }
      }
      setTimeout(() => this.scrollToAyah(ref), 250);
      if (this.repeatParam()) void this.repeatSelected();
    }
  }

  /** Memorised/learning marker colour for an ayah (hifz plans). */
  hifzColor(a: AyahRef): string | null {
    const m = this.hifz.memorizedIndex().get(this.key(a));
    return m ? (MARK_COLORS.find((c) => c.id === m.color)?.hex ?? null) : null;
  }

  /** «حفظ»: mark the selected ayah(s) as memorised / being learnt in a plan, or remove them. */
  async hifzAction(): Promise<void> {
    const refs = this.selectedRefs();
    if (!refs.length) return;
    const plans = this.hifz.list();
    if (!plans.length) {
      await this.toast('mushaf.hifzNoPlan');
      void this.nav.navigateForward('/hifz');
      return;
    }
    const choosePlan = async (status: 'learning' | 'memorized' | null) => {
      const apply = (planId: number) => void this.hifz.markRange(planId, refs, status).then(() => this.toast(status ? 'mushaf.hifzSaved' : 'mushaf.hifzRemoved'));
      if (plans.length === 1) return apply(plans[0].id);
      const sheet = await this.sheets.create({
        header: this.translate.instant('mushaf.hifzChoosePlan'),
        buttons: [
          ...plans.map((p) => ({ text: p.name, handler: () => apply(p.id) })),
          { text: this.translate.instant('common.cancel'), role: 'cancel' },
        ],
      });
      await sheet.present();
    };
    const sheet = await this.sheets.create({
      header: this.translate.instant('mushaf.hifz'),
      buttons: [
        { text: this.translate.instant('mushaf.hifzMemorized'), handler: () => void choosePlan('memorized') },
        { text: this.translate.instant('mushaf.hifzLearning'), handler: () => void choosePlan('learning') },
        { text: this.translate.instant('mushaf.hifzRemove'), role: 'destructive', handler: () => void choosePlan(null) },
        { text: this.translate.instant('mushaf.hifzPlans'), handler: () => void this.nav.navigateForward('/hifz') },
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  ionViewDidEnter(): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>('.page-surface');
    if (!el) return;
    const gesture = createGesture({
      el,
      gestureName: 'mushaf-swipe',
      threshold: 15,
      direction: 'x',
      onEnd: (d) => {
        if (Math.abs(d.deltaX) < 60 || Math.abs(d.deltaY) > Math.abs(d.deltaX)) return;
        // Like a printed mushaf: drag right to reach the next page.
        if (d.deltaX > 0) this.next();
        else this.prev();
      },
    });
    gesture.enable(true);
  }

  ionViewWillLeave(): void {
    clearTimeout(this.readTimer);
  }

  next(): void {
    if (this.page() < TOTAL_PAGES) this.goTo(this.page() + 1, 'next');
  }

  prev(): void {
    if (this.page() > 1) this.goTo(this.page() - 1, 'prev');
  }

  goTo(page: number, slide: 'none' | 'next' | 'prev'): void {
    const p = clampPage(page);
    this.slide.set(slide);
    this.page.set(p);
    this.selected.set(null);
    this.location.replaceState(`/mushaf/${p}`);
    this.host.nativeElement.querySelector('ion-content')?.scrollToTop(0);
    const first = this.quran.ready() ? this.quran.pageAyahs(p)[0] : undefined;
    if (first) void this.quran.setLastRead(p, first);
    clearTimeout(this.readTimer);
    this.readTimer = setTimeout(() => void this.khatmah.recordPageRead(p), READ_AFTER_MS);
    setTimeout(() => this.slide.set('none'), 260);
  }

  // ---- ayah state -----------------------------------------------------------------------

  key(a: AyahRef): string {
    return `${a.sura}:${a.aya}`;
  }

  highlightColor(a: AyahRef): string | null {
    const m = this.marks.markIndex().get(this.key(a))?.find((x) => x.kind === 'highlight');
    return m?.color ? (MARK_COLORS.find((c) => c.id === m.color)?.hex ?? null) : null;
  }

  isStarred(a: AyahRef): boolean {
    return !!this.marks.markIndex().get(this.key(a))?.some((x) => x.kind === 'star');
  }

  hasNote(a: AyahRef): boolean {
    return !!this.marks.markIndex().get(this.key(a))?.some((x) => x.kind === 'note');
  }

  isPlaying(a: AyahRef): boolean {
    const c = this.recitation.current();
    return !!c && c.sura === a.sura && c.aya === a.aya;
  }

  isSelected(a: AyahRef): boolean {
    const r = this.range();
    return !!r && a.sura === r.sura && a.aya >= r.from && a.aya <= r.to;
  }

  /** Tap: select one ayah (or, while marking a range, move the range's end to it). */
  select(a: AyahRef, event: Event): void {
    event.stopPropagation();
    if (this.longPressed) {
      this.longPressed = false;
      return;
    }
    this.haptics.tap();
    const s = this.selected();
    if (this.rangeMode() && s && s.sura === a.sura) {
      this.rangeTo.set(a.aya);
      return;
    }
    const same = this.isSelected(a) && !this.isRange();
    this.rangeMode.set(false);
    this.rangeTo.set(null);
    this.selected.set(same ? null : { sura: a.sura, aya: a.aya });
  }

  // ---- range selection: long-press an ayah, then tap another (or use the From/To lists) ----

  /** End of the marked range (an ayah number in the selected ayah's sura); null = single ayah. */
  readonly rangeTo = signal<number | null>(null);
  readonly rangeMode = signal(false);
  readonly range = computed(() => {
    const s = this.selected();
    if (!s) return null;
    const t = this.rangeTo() ?? s.aya;
    return { sura: s.sura, from: Math.min(s.aya, t), to: Math.max(s.aya, t) };
  });
  readonly isRange = computed(() => {
    const r = this.range();
    return !!r && r.to > r.from;
  });
  /** Ayah numbers of the selected sura, for the From/To lists. */
  readonly suraAyat = computed(() => {
    const r = this.range();
    return r && this.quran.ready() ? Array.from({ length: this.quran.sura(r.sura).ayas }, (_, i) => i + 1) : [];
  });
  private pressTimer?: ReturnType<typeof setTimeout>;
  private pressAt = { x: 0, y: 0 };
  private longPressed = false;
  private readonly resetRange = effect(() => {
    if (!this.selected()) {
      untracked(() => {
        this.rangeTo.set(null);
        this.rangeMode.set(false);
      });
    }
  });

  pressStart(a: AyahRef, e: PointerEvent): void {
    this.longPressed = false;
    this.pressAt = { x: e.clientX, y: e.clientY };
    clearTimeout(this.pressTimer);
    this.pressTimer = setTimeout(() => {
      this.longPressed = true;
      this.haptics.tap();
      const s = this.selected();
      if (this.rangeMode() && s && s.sura === a.sura) {
        this.rangeTo.set(a.aya);
      } else {
        this.selected.set({ sura: a.sura, aya: a.aya });
        this.rangeTo.set(a.aya);
        this.rangeMode.set(true);
      }
    }, 450);
  }

  pressMove(e: PointerEvent): void {
    if (Math.hypot(e.clientX - this.pressAt.x, e.clientY - this.pressAt.y) > 10) clearTimeout(this.pressTimer);
  }

  pressEnd(): void {
    clearTimeout(this.pressTimer);
  }

  setRangeFrom(value: unknown): void {
    const r = this.range();
    const n = Number(value);
    if (!r || !n) return;
    this.selected.set({ sura: r.sura, aya: Math.min(n, r.to) });
    this.rangeTo.set(Math.max(n, r.to));
    this.rangeMode.set(true);
  }

  setRangeTo(value: unknown): void {
    const r = this.range();
    const n = Number(value);
    if (!r || !n) return;
    this.selected.set({ sura: r.sura, aya: Math.min(r.from, n) });
    this.rangeTo.set(Math.max(r.from, n));
    this.rangeMode.set(true);
  }

  /** Every ayah in the current selection, in order. */
  private selectedRefs(): AyahRef[] {
    const r = this.range();
    if (!r) return [];
    return Array.from({ length: r.to - r.from + 1 }, (_, i) => ({ sura: r.sura, aya: r.from + i }));
  }

  ayahNumber(n: number): string {
    return String(n);
  }

  private scrollToAyah(a: AyahRef): void {
    this.host.nativeElement.querySelector(`[data-ayah="${this.key(a)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ---- actions --------------------------------------------------------------------------

  async openTafsir(): Promise<void> {
    const ref = this.selected();
    if (!ref) return;
    const modal = await this.modals.create({
      component: TafsirSheetComponent,
      componentProps: { ayahRef: ref },
      breakpoints: [0, 0.5, 0.9],
      initialBreakpoint: 0.5,
    });
    await modal.present();
  }

  async playFromSelected(): Promise<void> {
    const r = this.range();
    if (r && this.isRange()) {
      await this.recitation.play({ sura: r.sura, aya: r.from }, { sura: r.sura, aya: r.to });
      if (this.recitation.error()) await this.toast('mushaf.audioError');
      return;
    }
    const ref = this.selected() ?? this.blocks()[0]?.ayah;
    if (!ref) return;
    await this.recitation.play(ref);
    if (this.recitation.error()) await this.toast('mushaf.audioError');
  }

  /** Memorisation: choose how many times each ayah repeats, then play the selected ayah or range. */
  async repeatSelected(): Promise<void> {
    const t = (key: string, params?: object) => this.translate.instant(key, params);
    const sheet = await this.sheets.create({
      header: t('mushaf.repeatHow'),
      buttons: [
        ...this.repeatOptions
          .filter((r) => r !== 1)
          .map((r) => ({
            text: r === 0 ? t('mushaf.repeatEndless') : t('mushaf.repeatTimes', { n: r }),
            handler: () => void this.playRepeated(r),
          })),
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async playRepeated(times: RepeatMode): Promise<void> {
    const r = this.range();
    if (!r) return;
    await this.recitation.setPrefs({ repeatEach: times });
    await this.recitation.play({ sura: r.sura, aya: r.from }, { sura: r.sura, aya: r.to });
    if (this.recitation.error()) await this.toast('mushaf.audioError');
  }

  /** Plays the whole page (repeat settings apply). */
  async playPage(): Promise<void> {
    const b = this.blocks();
    if (!b.length) return;
    await this.recitation.play(b[0].ayah, b[b.length - 1].ayah);
    if (this.recitation.error()) await this.toast('mushaf.audioError');
  }

  /** "علامة القراءة": remember this ayah to come back to (shown on the Quran tab). */
  async markReading(): Promise<void> {
    const ref = this.selected();
    if (!ref) return;
    await this.quran.setReadingMark(this.quran.pageOf(ref), ref);
    await this.toast('mushaf.readingMarkSet');
  }

  async toggleStar(): Promise<void> {
    const ref = this.selected();
    if (!ref) return;
    const on = await this.marks.toggleStar(ref);
    await this.toast(on ? 'mushaf.starred' : 'mushaf.unstarred');
  }

  /** Colours every ayah in the selection (one ayah or a marked range). */
  async highlight(color: MarkColor | null): Promise<void> {
    const refs = this.selectedRefs();
    if (!refs.length) return;
    const apply = async (c: MarkColor | null, tag?: string) => {
      for (const ref of refs) await this.marks.setHighlight(ref, c, tag);
    };
    if (color === null) {
      await apply(null);
      return;
    }
    const tags = this.marks.tags();
    const alert = await this.alerts.create({
      header: this.translate.instant('mushaf.tagTitle'),
      message: this.translate.instant('mushaf.tagHint'),
      inputs: [{ name: 'tag', type: 'text', placeholder: tags.slice(0, 3).join('، ') || this.translate.instant('mushaf.tagExample') }],
      buttons: [
        { text: this.translate.instant('mushaf.noTag'), handler: () => void apply(color) },
        { text: this.translate.instant('common.save'), handler: (d: { tag?: string }) => void apply(color, d.tag?.trim() || undefined) },
      ],
    });
    await alert.present();
  }

  async editNote(): Promise<void> {
    const ref = this.selected();
    if (!ref) return;
    const existing = this.marks.markIndex().get(this.key(ref))?.find((m) => m.kind === 'note')?.note ?? '';
    const alert = await this.alerts.create({
      header: this.translate.instant('mushaf.note'),
      inputs: [{ name: 'note', type: 'textarea', value: existing, placeholder: this.translate.instant('mushaf.notePlaceholder') }],
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        ...(existing ? [{ text: this.translate.instant('common.delete'), role: 'destructive', handler: () => void this.marks.setNote(ref, null) }] : []),
        { text: this.translate.instant('common.save'), handler: (d: { note?: string }) => void this.marks.setNote(ref, d.note ?? '') },
      ],
    });
    await alert.present();
  }

  /** Coloured bookmarks: move an existing one here, or create a new one. */
  async bookmark(): Promise<void> {
    const ref = this.selected() ?? this.blocks()[0]?.ayah;
    if (!ref) return;
    const sheet = await this.sheets.create({
      header: this.translate.instant('mushaf.bookmarkHere'),
      buttons: [
        ...this.marks.bookmarks().map((b) => ({
          text: `${this.translate.instant('mushaf.moveBookmark')}: ${b.name}`,
          cssClass: `bm-${b.color}`,
          handler: () => void this.marks.moveBookmark(b.id, ref, this.page()).then(() => this.toast('mushaf.bookmarkMoved')),
        })),
        { text: this.translate.instant('mushaf.newBookmark'), handler: () => void this.newBookmark(ref) },
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async newBookmark(ref: AyahRef): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('mushaf.newBookmark'),
      inputs: [
        { name: 'name', type: 'text', placeholder: this.translate.instant('mushaf.bookmarkName') },
        ...MARK_COLORS.map((c, i) => ({
          name: 'color', type: 'radio' as const, label: this.translate.instant(`mushaf.colors.${c.id}`), value: c.id, checked: i === 0,
        })),
      ],
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('common.save'),
          handler: (data: string | { name?: string }) => {
            // Ionic returns the radio value when radios are present.
            const color = (typeof data === 'string' ? data : 'green') as MarkColor;
            const name = this.translate.instant(`mushaf.colors.${color}`);
            void this.marks.addBookmark(name, color, ref, this.page()).then(() => this.toast('mushaf.bookmarkAdded'));
          },
        },
      ],
    });
    await alert.present();
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
    const text = this.selectedText();
    if (text) await this.share.shareText(this.translate.instant('app.name'), text);
  }

  /** The selected ayah(s) with their numbers, then the reference, e.g. "[البقرة: 255–257]". */
  private selectedText(): string {
    const r = this.range();
    if (!r) return '';
    const s = this.quran.sura(r.sura);
    const body = this.selectedRefs()
      .map((ref) => `${splitBasmala(ref, this.quran.ayah(ref).text).text} ﴿${ref.aya}﴾`)
      .join(' ');
    const where = r.to > r.from ? `${r.from}–${r.to}` : String(r.from);
    return `${body}\n[${s.name}: ${where}]`;
  }

  async goToPrompt(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('mushaf.goTo'),
      inputs: [{ name: 'q', type: 'text', placeholder: this.translate.instant('mushaf.goToHint') }],
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('common.done'),
          handler: (d: { q?: string }) => {
            const q = (d.q ?? '').trim().replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
            const m = q.match(/^(\d{1,3})\s*[:：]\s*(\d{1,3})$/);
            if (m) {
              const sura = Math.min(114, Math.max(1, +m[1]));
              const aya = Math.min(this.quran.sura(sura).ayas, Math.max(1, +m[2]));
              const ref = { sura, aya };
              this.goTo(this.quran.pageOf(ref), 'none');
              this.selected.set(ref);
              setTimeout(() => this.scrollToAyah(ref), 200);
            } else if (/^\d+$/.test(q)) {
              this.goTo(+q, 'none');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ---- view settings ---------------------------------------------------------------------

  private async loadView(): Promise<void> {
    const { value } = await Preferences.get({ key: VIEW_PREFS });
    if (!value) {
      this.theme.set(document.documentElement.classList.contains('ion-palette-dark') ? 'night' : 'paper');
      return;
    }
    try {
      const v = JSON.parse(value) as { theme?: MushafTheme; scale?: number };
      if (v.theme) this.theme.set(v.theme);
      if (v.scale) this.quranScale.set(v.scale);
    } catch {
      /* defaults */
    }
  }

  async setTheme(value: unknown): Promise<void> {
    if (value !== 'paper' && value !== 'sepia' && value !== 'night') return;
    this.theme.set(value);
    await this.saveView();
  }

  /** − / + buttons beside the text-size slider. */
  async stepScale(delta: number): Promise<void> {
    this.quranScale.set(Math.round(Math.min(1.8, Math.max(0.8, this.quranScale() + delta)) * 100) / 100);
    await this.saveView();
  }

  async setScale(e: RangeCustomEvent): Promise<void> {
    this.quranScale.set(Number(e.detail.value));
    await this.saveView();
  }

  private saveView(): Promise<void> {
    return Preferences.set({ key: VIEW_PREFS, value: JSON.stringify({ theme: this.theme(), scale: this.quranScale() }) });
  }

  reciterName(id: string): string {
    const r = RECITERS.find((x) => x.id === id);
    return r ? (this.lang() === 'ar' ? r.nameAr : r.nameEn) : '';
  }

  repeatLabel(r: RepeatMode): string {
    if (r === 0) return '∞';
    return `×${r}`;
  }

  async download(): Promise<void> {
    const sura = this.blocks()[0]?.ayah.sura;
    if (!sura) return;
    const ok = await this.recitation.downloadSura(sura);
    await this.toast(ok ? 'mushaf.downloaded' : 'mushaf.downloadFailed');
  }

  private async toast(key: string): Promise<void> {
    const t = await this.toasts.create({ message: this.translate.instant(key), duration: 1600, position: 'bottom' });
    await t.present();
  }
}

function clampPage(p: number): number {
  return Number.isFinite(p) ? Math.min(TOTAL_PAGES, Math.max(1, Math.round(p))) : 1;
}
