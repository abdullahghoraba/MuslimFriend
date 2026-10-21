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
import { NowSuggestion, nowSuggestions } from '../../core/prayer/time-windows';
import { QuranService } from '../../core/quran/quran.service';
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
  private readonly quran = inject(QuranService);

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
  /** Time-aware shortcuts: al-Kahf (Thursday Maghrib → Friday Maghrib), morning or evening athkar. */
  readonly suggestions = computed(() =>
    nowSuggestions(this.prayer.now(), this.prayer.today()).map((kind) => ({
      kind,
      icon: kind === 'kahf' ? 'book-outline' : kind === 'morning' ? 'sunny-outline' : 'moon-outline',
      labelKey: kind === 'kahf' ? 'home.fridayLabel' : 'home.nowLabel',
      titleKey: kind === 'kahf' ? 'home.readKahf' : 'home.' + kind,
      progress: kind === 'kahf' ? null : this.daily().find((d) => d.categoryId === kind)?.progress ?? null,
    })),
  );

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
