import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  ModalController,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonProgressBar,
  IonRippleEffect,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Category, ReaderPosition } from '../../core/models';
import { AthkarRepository } from '../../core/services/athkar.repository';
import { CategoryProgress, ProgressService } from '../../core/services/progress.service';
import { SettingsService } from '../../core/services/settings.service';
import { PrayerService } from '../../core/prayer/prayer.service';
import { OverlayService } from '../../core/services/overlay.service';
import { NowSuggestion, nowSuggestions, recentPrayer } from '../../core/prayer/time-windows';
import { prayerTimesFor } from '../../core/prayer/prayer-times';
import { QuranService } from '../../core/quran/quran.service';
import { arabicDigits } from '../../core/quran/quran-utils';
import { HijriDateComponent } from '../../shared/hijri-date.component';
import { HomeCategoriesComponent } from '../../shared/home-categories.component';
import { VerseOfDayComponent } from '../../shared/verse-of-day.component';

interface DailyStatus {
  categoryId: 'morning' | 'evening';
  labelKey: string;
  icon: string;
  progress: CategoryProgress;
}

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    TranslatePipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    HijriDateComponent,
    VerseOfDayComponent,
    IonButton,
    IonIcon,
    IonList,
    IonItem,
    IonLabel,
    IonProgressBar,
    IonRippleEffect,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage {
  private readonly athkar = inject(AthkarRepository);
  private readonly progress = inject(ProgressService);
  private readonly settings = inject(SettingsService);
  private readonly nav = inject(NavController);
  private readonly prayer = inject(PrayerService);
  private readonly overlay = inject(OverlayService);
  readonly quran = inject(QuranService);

  readonly categories = this.athkar.homeCategories;
  private readonly modals = inject(ModalController);

  async customizeCategories(): Promise<void> {
    const modal = await this.modals.create({ component: HomeCategoriesComponent });
    await modal.present();
  }
  readonly lang = computed(() => this.settings.settings().language);
  readonly daily = signal<DailyStatus[]>([]);
  readonly position = signal<ReaderPosition | null>(null);
  readonly next = this.prayer.next;
  /** For a while after a prayer time (default 40 min), the card shows the time since it, like Salatuk. */
  readonly recent = computed(() => {
    const now = this.prayer.now();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return recentPrayer(now, this.prayer.today(), prayerTimesFor(this.prayer.prayer(), yesterday),
      this.prayer.reminders().homeCards.afterPrayerMinutes ?? 40);
  });

  minutesLabel(n: number): string {
    const fmt = new Intl.NumberFormat(this.lang() === 'ar' ? 'ar-EG' : 'en').format(n);
    if (this.lang() !== 'ar') return n === 1 ? '1 minute' : fmt + ' minutes';
    if (n === 0) return 'الآن';
    if (n === 1) return 'دقيقة';
    if (n === 2) return 'دقيقتان';
    return fmt + (n >= 3 && n <= 10 ? ' دقائق' : ' دقيقة');
  }
  /** Time-aware shortcuts: al-Kahf (Thursday Maghrib → Friday Maghrib), morning or evening athkar. */
  readonly suggestions = computed(() =>
    nowSuggestions(this.prayer.now(), this.prayer.today(), this.prayer.reminders().homeCards).map((kind) => ({
      kind,
      icon: kind === 'kahf' ? 'book-outline' : kind === 'morning' ? 'sunny-outline' : 'moon-outline',
      labelKey: kind === 'kahf' ? 'home.fridayLabel' : 'home.nowLabel',
      titleKey: kind === 'kahf' ? 'home.readKahf' : 'home.' + kind,
      progress: kind === 'kahf' ? null : this.daily().find((d) => d.categoryId === kind)?.progress ?? null,
    })),
  );

  readonly quranReady = this.quran.ready;

  /** Opens the mushaf at a saved place (last page read or the reading mark). */
  openMushaf(p: { page: number; sura: number; aya: number }): void {
    void this.nav.navigateForward(['/mushaf', p.page], { queryParams: { sura: p.sura, aya: p.aya } });
  }

  digits(n: number): string {
    return this.lang() === 'ar' ? arabicDigits(n) : String(n);
  }

  async openSuggestion(kind: NowSuggestion): Promise<void> {
    if (kind !== 'kahf') return this.openReader(kind);
    await this.quran.load();
    await this.nav.navigateForward(['/mushaf', this.quran.suraPage(18)], { queryParams: { sura: 18, aya: 1 } });
  }

  readonly overlayFallback = computed(
    () => this.overlay.overlay().enabled && !!this.overlay.fallbackReason(),
  );

  ionViewWillEnter(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    // Sura names for the reading cards (the Quran text is loaded once and cached).
    void this.quran.load().then(() => this.quran.loadReadingPrefs()).catch(() => {});
    const statuses: DailyStatus[] = [];
    for (const [categoryId, labelKey, icon] of [
      ['morning', 'home.morning', 'sunny-outline'],
      ['evening', 'home.evening', 'moon-outline'],
    ] as const) {
      const items = await this.athkar.byCategory(categoryId);
      statuses.push({
        categoryId,
        labelKey,
        icon,
        progress: await this.progress.categoryProgress(categoryId, items),
      });
    }
    this.daily.set(statuses);
    this.position.set(await this.settings.getReaderPosition());
  }

  time(d: Date): string {
    return new Intl.DateTimeFormat(this.lang() === 'ar' ? 'ar-EG' : 'en-GB', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  }

  /** Hours and minutes until [d], relative to the prayer service's minute tick. */
  countdown(d: Date): string {
    const mins = Math.max(0, Math.round((d.getTime() - this.prayer.now().getTime()) / 60_000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const fmt = new Intl.NumberFormat(this.lang() === 'ar' ? 'ar-EG' : 'en');
    if (h) return `${fmt.format(h)}:${String(m).padStart(2, '0')}`;
    return this.lang() === 'ar' ? `${fmt.format(m)} د` : `${m} min`;
  }

  categoryName(c: Category | undefined): string {
    if (!c) return '';
    return this.lang() === 'ar' ? c.nameAr : c.nameEn;
  }

  positionCategory(p: ReaderPosition): Category | undefined {
    return this.athkar.category(p.categoryId);
  }

  openReader(categoryId: string, start = 0): void {
    void this.nav.navigateForward(['/category', categoryId], { queryParams: { start } });
  }
}
