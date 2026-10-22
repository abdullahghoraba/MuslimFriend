import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SingleViewComponent } from './single-view.component';
import { nextDhikrCount, visibleItems } from './counting';
import { AthkarPrefsService } from '../../core/services/athkar-prefs.service';
import { Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import {
  ActionSheetController,
  AlertController,
  IonModal,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonProgressBar,
  IonRange,
  IonReorder,
  IonReorderGroup,
  IonTitle,
  IonToolbar,
  ModalController,
  NavController,
  RangeCustomEvent,
  ReorderEndCustomEvent,
  ToastController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Category, CUSTOM_CATEGORY_ID, Dhikr } from '../../core/models';
import { CollectionEditorComponent } from '../../shared/collection-editor.component';
import { DhikrEditorComponent } from '../../shared/dhikr-editor.component';
import { AthkarRepository } from '../../core/services/athkar.repository';
import { HapticsService } from '../../core/services/haptics.service';
import { ProgressService } from '../../core/services/progress.service';
import { SettingsService } from '../../core/services/settings.service';
import { ShareService } from '../../core/services/share.service';

/** Delay before scrolling to the next dhikr once one is completed. */
const SCROLL_NEXT_MS = 350;

/**
 * A whole category on one page: every dhikr in full with its own counter.
 * Tap a card (or its counter) to count; finished cards dim and the page scrolls to the next one.
 */
@Component({
  selector: 'app-category',
  imports: [
    NgTemplateOutlet, RouterLink, SingleViewComponent, IonModal, TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonButton, IonIcon, IonContent,
    IonList, IonItem, IonLabel, IonNote, IonReorderGroup, IonReorder, IonProgressBar, IonRange,
  ],
  templateUrl: './category.page.html',
  styleUrl: './category.page.scss',
})
export class CategoryPage {
  /** Route param (bound by withComponentInputBinding). */
  readonly id = input<string>('');
  /** Optional ?start= index to scroll to ("continue where you left off"). */
  readonly start = input<string | undefined>();

  readonly preferences = inject(AthkarPrefsService);
  readonly prefs = this.preferences.prefs;
  readonly singleIndex = signal(0);
  private advanceTimer?: ReturnType<typeof setTimeout>;

  async toggleMode(): Promise<void> {
    clearTimeout(this.advanceTimer);
    this.reordering.set(false);
    await this.preferences.update({ readingMode: this.prefs().readingMode === 'list' ? 'single' : 'list' });
  }

  digits(n: number): string {
    return String(n);
  }

  readonly showCompleted = signal(false);
  readonly visibleItems = computed(() => visibleItems(this.items(), this.counts(), this.prefs().onComplete, this.showCompleted()));
  readonly visibleSingleIndex = computed(() => {
    const visible = this.visibleItems();
    const current = this.items()[this.singleIndex()];
    const at = visible.findIndex(d => d.id === current?.id);
    if (at >= 0) return at;
    const next = visible.findIndex(d => this.items().indexOf(d) >= this.singleIndex());
    return next >= 0 ? next : Math.max(0, visible.length - 1);
  });

  moveVisibleSingle(index: number): void {
    const item = this.visibleItems()[index];
    if (item) this.moveSingle(this.items().indexOf(item));
  }

  toggleCompleted(): void {
    clearTimeout(this.advanceTimer);
    const current = this.visibleItems()[this.visibleSingleIndex()];
    if (current) this.singleIndex.set(this.items().indexOf(current));
    this.showCompleted.update(value => !value);
  }

  moveSingle(index: number): void {
    clearTimeout(this.advanceTimer);
    this.singleIndex.set(index);
    void this.settings.setReaderPosition(this.id(), index);
  }

  ionViewWillLeave(): void { clearTimeout(this.advanceTimer); this.showCompleted.set(false); }

  /** Less frequent list actions live in one menu to keep the header calm. */
  async openListMenu(): Promise<void> {
    const t = (k: string) => this.translate.instant(k);
    const sheet = await this.sheets.create({
      header: this.title(),
      buttons: [
        { text: t('reader.fontSize'), icon: 'text-outline', handler: () => { this.fontPanelOpen.set(!this.fontPanelOpen()); } },
        { text: t('common.reorder'), icon: 'reorder-three-outline', handler: () => { this.reordering.set(true); } },
        { text: t('category.resetToday'), icon: 'refresh-outline', handler: () => { void this.resetAll(); } },
        { text: t('athkarPrefs.title'), icon: 'settings-outline', handler: () => { void this.nav.navigateForward('/athkar-settings'); } },
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private readonly nav = inject(NavController);

  private readonly athkar = inject(AthkarRepository);
  private readonly progress = inject(ProgressService);
  private readonly settings = inject(SettingsService);
  private readonly haptics = inject(HapticsService);
  private readonly share = inject(ShareService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly content = viewChild(IonContent);
  private readonly modals = inject(ModalController);

  private readonly sheets = inject(ActionSheetController);
  private readonly alerts = inject(AlertController);
  readonly hiddenItems = signal<Dhikr[]>([]);
  readonly hiddenOpen = signal(false);

  readonly items = signal<Dhikr[]>([]);
  readonly counts = signal<Map<string, number>>(new Map());
  readonly reordering = signal(false);
  readonly fontPanelOpen = signal(false);
  readonly openDetails = signal<Set<string>>(new Set());
  readonly sharing = signal<Dhikr | null>(null);
  readonly lang = computed(() => this.settings.settings().language);
  readonly fontScale = computed(() => this.settings.settings().fontScale);
  readonly category = computed(() => this.athkar.category(this.id()));
  readonly title = computed(() => {
    const c = this.category();
    if (!c) return '';
    return this.lang() === 'ar' ? c.nameAr : c.nameEn;
  });
  readonly doneCount = computed(() => this.items().filter((d) => this.countOf(d) >= d.repeatCount).length);
  readonly allDone = computed(() => this.items().length > 0 && this.doneCount() === this.items().length);

  private busy = new Set<string>();

  /** Adds the user's own dhikr to this list (it appears at the end; reorder to move it). */
  async addDhikr(): Promise<void> {
    const saved = await this.openEditor({ categoryId: this.id() });
    if (saved) setTimeout(() => this.scrollTo(this.items().length - 1), 300);
  }

  private name(c: Category): string {
    return this.lang() === 'ar' ? c.nameAr : c.nameEn;
  }

  async more(d: Dhikr): Promise<void> {
    const sheet = await this.sheets.create({ buttons: [
      { text: this.translate.instant('category.changeRepeat'), icon: 'repeat-outline', handler: () => { void this.changeRepeat(d); } },
      { text: this.translate.instant('category.saveTo'), icon: 'bookmark-outline', handler: () => { void this.saveTo(d); } },
      d.isCustom
        ? { text: this.translate.instant('common.delete'), icon: 'trash-outline', role: 'destructive', handler: () => { void this.confirmDelete(d); } }
        : { text: this.translate.instant('category.hide'), icon: 'eye-outline', handler: () => { void this.hide(d); } },
      { text: this.translate.instant('common.cancel'), role: 'cancel' },
    ] });
    await sheet.present();
  }

  async changeRepeat(d: Dhikr): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('category.changeRepeat'),
      message: this.translate.instant('category.repeatRange'),
      inputs: [{ name: 'count', type: 'number', value: d.repeatCount, min: 1, max: 10000, attributes: { step: 1 } }],
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        ...(!d.isCustom ? [{ text: this.translate.instant('category.restoreOriginal'), handler: () => { void this.applyRepeat(d, null); } }] : []),
        { text: this.translate.instant('common.save'), handler: (values: { count: string }) => {
          const count = Number(values.count);
          if (!Number.isInteger(count) || count < 1 || count > 10000) return false;
          void this.applyRepeat(d, count);
          return true;
        } },
      ],
    });
    await alert.present();
  }

  private async applyRepeat(d: Dhikr, count: number | null): Promise<void> {
    clearTimeout(this.advanceTimer);
    await this.athkar.setRepeatOverride(d.id, count);
    const updated = await this.athkar.byId(d.id);
    if (updated) this.items.update(items => items.map(item => item.id === d.id ? updated : item));
  }

  async saveTo(d: Dhikr): Promise<void> {
    const targets = [this.athkar.category(CUSTOM_CATEGORY_ID)!, ...this.athkar.categories().filter(c => c.isUser)]
      .filter(c => c.id !== this.id());
    const sheet = await this.sheets.create({ header: this.translate.instant('category.saveTo'), buttons: [
      ...targets.map(c => ({ text: this.name(c), icon: c.icon, handler: () => { void this.saveInto(d, c); } })),
      { text: this.translate.instant('category.newCollection'), icon: 'add-outline', handler: () => { void this.newCollection(d); } },
      { text: this.translate.instant('common.cancel'), role: 'cancel' },
    ] });
    await sheet.present();
  }

  private async newCollection(d: Dhikr): Promise<void> {
    const modal = await this.modals.create({ component: CollectionEditorComponent });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<Category>();
    if (role === 'saved' && data) await this.saveInto(d, data);
  }

  private async saveInto(d: Dhikr, target: Category): Promise<void> {
    await this.athkar.saveCopy(d.id, target.id);
    const t = await this.toast.create({ message: this.translate.instant('category.savedTo', { name: this.name(target) }), duration: 2500 });
    await t.present();
  }

  private async hide(d: Dhikr): Promise<void> {
    await this.athkar.setHidden(d.id, true);
    await this.load();
    const t = await this.toast.create({ message: this.translate.instant('category.hidden'), duration: 5000,
      buttons: [{ text: this.translate.instant('category.undo'), handler: () => { void this.showAgain(d); } }] });
    await t.present();
  }

  async showAgain(d: Dhikr): Promise<void> {
    await this.athkar.setHidden(d.id, false);
    await this.load();
  }

  private async confirmDelete(d: Dhikr): Promise<void> {
    const alert = await this.alerts.create({ header: this.translate.instant('myAthkar.deleteConfirm'), buttons: [
      { text: this.translate.instant('common.cancel'), role: 'cancel' },
      { text: this.translate.instant('common.delete'), role: 'destructive', handler: () => { void this.deleteDhikr(d); } },
    ] });
    await alert.present();
  }

  private async deleteDhikr(d: Dhikr): Promise<void> {
    await this.athkar.deleteCustom(d.id);
    await this.load();
    const t = await this.toast.create({ message: this.translate.instant('category.deleted'), duration: 2500 });
    await t.present();
  }

  async editDhikr(d: Dhikr): Promise<void> {
    await this.openEditor({ dhikr: d });
  }

  private async openEditor(props: { dhikr?: Dhikr; categoryId?: string }): Promise<boolean> {
    const modal = await this.modals.create({ component: DhikrEditorComponent, componentProps: props });
    await modal.present();
    const { role } = await modal.onWillDismiss();
    if (role === 'saved' || role === 'deleted') {
      await this.load();
      return role === 'saved';
    }
    return false;
  }

  constructor() {
    // Route inputs may bind after the first ionViewWillEnter when the page is opened directly.
    effect(() => {
      if (this.id()) untracked(() => void this.load());
    });
  }

  ionViewWillEnter(): void {
    if (this.id()) void this.load();
  }

  async load(): Promise<void> {
    clearTimeout(this.advanceTimer);
    await this.preferences.ready;
    const items = await this.athkar.byCategory(this.id());
    this.singleIndex.update(i => Math.max(0, Math.min(i, items.length - 1)));
    this.items.set(items);
    this.hiddenItems.set(await this.athkar.hiddenIn(this.id()));
    this.counts.set(await this.progress.countsFor(items.map((i) => i.id)));
    const start = Number(this.start());
    if (Number.isInteger(start) && start > 0) setTimeout(() => this.scrollTo(Math.min(start, items.length - 1)), 300);
  }

  countOf(d: Dhikr): number {
    const raw = this.counts().get(d.id) ?? 0;
    return this.prefs().countPastTarget ? raw : Math.min(raw, d.repeatCount);
  }

  isDone(d: Dhikr): boolean {
    return this.countOf(d) >= d.repeatCount;
  }

  async count(d: Dhikr, index: number): Promise<void> {
    index = this.items().findIndex(item => item.id === d.id);
    if (this.reordering() || (this.isDone(d) && !this.prefs().countPastTarget) || this.busy.has(d.id)) return;
    this.busy.add(d.id);
    try {
      const previous = this.counts().get(d.id) ?? 0;
      const next = nextDhikrCount(previous, d.repeatCount, this.prefs().countPastTarget);
      this.counts.update((m) => new Map(m).set(d.id, next));
      await this.progress.increment(d.id);
      void this.settings.setReaderPosition(this.id(), index);
      if (previous < d.repeatCount && next >= d.repeatCount) {
        this.haptics.complete();
        const ordered = [...this.items().slice(index + 1), ...this.items().slice(0, index)];
        const nextItem = ordered.find(x => !this.isDone(x));
        if (nextItem && this.prefs().autoAdvance) {
          clearTimeout(this.advanceTimer);
          this.advanceTimer = setTimeout(() => {
            const at = this.items().findIndex(x => x.id === nextItem.id);
            if (at >= 0 && this.prefs().autoAdvance && !this.reordering()) this.scrollTo(at);
          }, SCROLL_NEXT_MS);
        }
        if (this.allDone()) await this.progress.categoryProgress(this.id(), this.items());
      } else {
        this.haptics.tap();
      }
    } finally {
      this.busy.delete(d.id);
    }
  }

  onCardKey(event: KeyboardEvent, d: Dhikr, index: number): void {
    if (this.prefs().tapTarget === 'card' && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      void this.count(d, index);
    }
  }

  async resetItem(d: Dhikr): Promise<void> {
    clearTimeout(this.advanceTimer);
    await this.progress.resetToday(d.id);
    this.counts.update((m) => {
      const copy = new Map(m);
      copy.delete(d.id);
      return copy;
    });
  }

  async resetAll(): Promise<void> {
    clearTimeout(this.advanceTimer);
    this.singleIndex.set(0);
    await this.progress.resetCategoryToday(this.items());
    this.counts.set(new Map());
    this.showCompleted.set(false);
    await this.content()?.scrollToTop(300);
  }

  toggleDetails(d: Dhikr): void {
    this.openDetails.update((s) => {
      const copy = new Set(s);
      if (copy.has(d.id)) copy.delete(d.id);
      else copy.add(d.id);
      return copy;
    });
  }

  private scrollTo(index: number): void {
    if (this.prefs().readingMode === 'single') { this.moveSingle(index); return; }
    const el = this.host.nativeElement.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }

  async onReorder(event: ReorderEndCustomEvent): Promise<void> {
    const reordered = event.detail.complete(this.items()) as Dhikr[];
    this.items.set(reordered);
    await this.athkar.reorder(reordered.map((i) => i.id));
  }

  /** − / + buttons beside the text-size slider. */
  async stepFont(delta: number): Promise<void> {
    const next = Math.round(Math.min(2, Math.max(0.8, this.fontScale() + delta)) * 10) / 10;
    await this.settings.update({ fontScale: next });
  }

  async setFontScale(event: RangeCustomEvent): Promise<void> {
    await this.settings.update({ fontScale: Number(event.detail.value) });
  }

  async shareImage(d: Dhikr): Promise<void> {
    this.sharing.set(d);
    // Let the off-screen share layout render before capturing it.
    await new Promise((r) => setTimeout(r, 50));
    const el = this.host.nativeElement.querySelector<HTMLElement>('.share-card');
    try {
      if (el) await this.share.shareElementAsImage(el, this.title());
    } catch {
      const t = await this.toast.create({ message: this.translate.instant('reader.shareFailed'), duration: 2000 });
      await t.present();
    } finally {
      this.sharing.set(null);
    }
  }
}
