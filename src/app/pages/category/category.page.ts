import { Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import {
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
  RangeCustomEvent,
  ReorderEndCustomEvent,
  ToastController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Dhikr } from '../../core/models';
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
    TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonButton, IonIcon, IonContent,
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
    const items = await this.athkar.byCategory(this.id());
    this.items.set(items);
    this.counts.set(await this.progress.countsFor(items.map((i) => i.id)));
    const start = Number(this.start());
    if (Number.isInteger(start) && start > 0) setTimeout(() => this.scrollTo(start), 300);
  }

  countOf(d: Dhikr): number {
    return Math.min(this.counts().get(d.id) ?? 0, d.repeatCount);
  }

  isDone(d: Dhikr): boolean {
    return this.countOf(d) >= d.repeatCount;
  }

  async count(d: Dhikr, index: number): Promise<void> {
    if (this.reordering() || this.isDone(d) || this.busy.has(d.id)) return;
    this.busy.add(d.id);
    try {
      const next = this.countOf(d) + 1;
      this.counts.update((m) => new Map(m).set(d.id, next));
      await this.progress.increment(d.id);
      void this.settings.setReaderPosition(this.id(), index);
      if (next >= d.repeatCount) {
        this.haptics.complete();
        const nextUndone = this.items().findIndex((x, i) => i > index && !this.isDone(x));
        if (nextUndone >= 0) setTimeout(() => this.scrollTo(nextUndone), SCROLL_NEXT_MS);
        if (this.allDone()) await this.progress.categoryProgress(this.id(), this.items());
      } else {
        this.haptics.tap();
      }
    } finally {
      this.busy.delete(d.id);
    }
  }

  onCardKey(event: KeyboardEvent, d: Dhikr, index: number): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void this.count(d, index);
    }
  }

  async resetItem(d: Dhikr): Promise<void> {
    await this.progress.resetToday(d.id);
    this.counts.update((m) => {
      const copy = new Map(m);
      copy.delete(d.id);
      return copy;
    });
  }

  async resetAll(): Promise<void> {
    await this.progress.resetCategoryToday(this.items());
    this.counts.set(new Map());
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
