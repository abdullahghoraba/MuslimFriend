import { Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonRange,
  IonTitle,
  IonToolbar,
  NavController,
  RangeCustomEvent,
  ToastController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Dhikr } from '../../core/models';
import { AthkarRepository } from '../../core/services/athkar.repository';
import { HapticsService } from '../../core/services/haptics.service';
import { ProgressService } from '../../core/services/progress.service';
import { SettingsService } from '../../core/services/settings.service';
import { ShareService } from '../../core/services/share.service';

/** Delay before moving to the next dhikr once the count is reached. */
const AUTO_ADVANCE_MS = 450;

@Component({
  selector: 'app-reader',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonButton, IonIcon,
    IonContent, IonFooter, IonRange,
  ],
  templateUrl: './reader.page.html',
  styleUrl: './reader.page.scss',
})
export class ReaderPage {
  readonly categoryId = input<string>('');
  /** Query param ?start= (bound by withComponentInputBinding). */
  readonly start = input<string | undefined>();

  private readonly athkar = inject(AthkarRepository);
  private readonly progress = inject(ProgressService);
  private readonly settings = inject(SettingsService);
  private readonly haptics = inject(HapticsService);
  private readonly share = inject(ShareService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastController);
  private readonly nav = inject(NavController);

  private readonly shareCard = viewChild<ElementRef<HTMLElement>>('shareCard');

  readonly items = signal<Dhikr[]>([]);
  readonly index = signal(0);
  readonly counts = signal<Map<string, number>>(new Map());
  readonly detailsOpen = signal(false);
  readonly fontPanelOpen = signal(false);
  readonly finished = signal(false);
  readonly lang = computed(() => this.settings.settings().language);
  readonly fontScale = computed(() => this.settings.settings().fontScale);

  readonly current = computed(() => this.items()[this.index()]);
  readonly currentCount = computed(() => {
    const d = this.current();
    return d ? Math.min(this.counts().get(d.id) ?? 0, d.repeatCount) : 0;
  });
  readonly remaining = computed(() => (this.current()?.repeatCount ?? 0) - this.currentCount());
  readonly title = computed(() => {
    const c = this.athkar.category(this.categoryId());
    return c ? (this.lang() === 'ar' ? c.nameAr : c.nameEn) : '';
  });

  private advanceTimer?: ReturnType<typeof setTimeout>;
  private busy = false;

  ionViewWillEnter(): void {
    void this.load();
  }

  ionViewWillLeave(): void {
    clearTimeout(this.advanceTimer);
  }

  private async load(): Promise<void> {
    const items = await this.athkar.byCategory(this.categoryId());
    this.items.set(items);
    this.counts.set(await this.progress.countsFor(items.map((i) => i.id)));
    const start = Number(this.start() ?? 0);
    this.goTo(Number.isInteger(start) && start >= 0 && start < items.length ? start : 0);
  }

  goTo(index: number): void {
    clearTimeout(this.advanceTimer);
    if (index < 0 || index >= this.items().length) return;
    this.index.set(index);
    this.detailsOpen.set(false);
    this.finished.set(false);
    void this.settings.setReaderPosition(this.categoryId(), index);
  }

  /** Called for a tap anywhere on the card. */
  async count(): Promise<void> {
    const d = this.current();
    if (!d || this.busy || this.currentCount() >= d.repeatCount) return;
    this.busy = true;
    try {
      const next = this.currentCount() + 1;
      this.counts.update((m) => new Map(m).set(d.id, next));
      await this.progress.increment(d.id);
      if (next >= d.repeatCount) {
        this.haptics.complete();
        this.advanceTimer = setTimeout(() => void this.afterItemDone(), AUTO_ADVANCE_MS);
      } else {
        this.haptics.tap();
      }
    } finally {
      this.busy = false;
    }
  }

  private async afterItemDone(): Promise<void> {
    const nextUndone = this.items().findIndex(
      (d, i) => i > this.index() && (this.counts().get(d.id) ?? 0) < d.repeatCount,
    );
    if (nextUndone >= 0) {
      this.goTo(nextUndone);
      return;
    }
    const result = await this.progress.categoryProgress(this.categoryId(), this.items());
    if (result.completed) this.finished.set(true);
    else if (this.index() < this.items().length - 1) this.goTo(this.index() + 1);
  }

  onCardKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void this.count();
    }
  }

  async resetItem(): Promise<void> {
    const d = this.current();
    if (!d) return;
    await this.progress.resetToday(d.id);
    this.counts.update((m) => {
      const copy = new Map(m);
      copy.delete(d.id);
      return copy;
    });
  }

  async readAgain(): Promise<void> {
    await this.progress.resetCategoryToday(this.items());
    this.counts.set(new Map());
    this.goTo(0);
  }

  backToList(): void {
    void this.nav.navigateBack(['/category', this.categoryId()]);
  }

  async setFontScale(event: RangeCustomEvent): Promise<void> {
    await this.settings.update({ fontScale: Number(event.detail.value) });
  }

  async shareImage(): Promise<void> {
    const el = this.shareCard()?.nativeElement;
    if (!el) return;
    try {
      await this.share.shareElementAsImage(el, this.title());
    } catch {
      const t = await this.toast.create({ message: this.translate.instant('reader.shareFailed'), duration: 2000 });
      await t.present();
    }
  }
}
