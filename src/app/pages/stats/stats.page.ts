import { Component, computed, inject, signal } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonLabel, IonProgressBar, IonSegment, IonSegmentButton, IonTitle, IonToolbar, SegmentCustomEvent } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { SettingsService } from '../../core/services/settings.service';
import { DailyTotal, StatsService, Streak, Totals } from '../../core/services/stats.service';
import { isRtl } from '../../core/models';

@Component({
  selector: 'app-stats',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSegment, IonSegmentButton, IonLabel, IonProgressBar],
  templateUrl: './stats.page.html',
  styleUrl: './stats.page.scss',
})
export class StatsPage {
  private readonly stats = inject(StatsService);
  private readonly settings = inject(SettingsService);
  readonly lang = computed(() => this.settings.settings().language);
  readonly days = signal(7);
  readonly daily = signal<DailyTotal[]>([]);
  readonly today = signal<Totals>({ athkar: 0, tasbih: 0 });
  readonly week = signal<Totals>({ athkar: 0, tasbih: 0 });
  readonly morning = signal<Streak>({ current: 0, best: 0 });
  readonly evening = signal<Streak>({ current: 0, best: 0 });
  readonly morningRate = signal(0);
  readonly eveningRate = signal(0);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly chart = computed(() => {
    const rows = this.daily().slice(-this.days());
    return isRtl(this.lang()) ? [...rows].reverse() : rows;
  });
  readonly maximum = computed(() => Math.max(1, ...this.chart().map(d => d.athkar + d.tasbih)));
  readonly chartTotals = computed(() => this.chart().reduce((sum, d) =>
    ({ athkar: sum.athkar + d.athkar, tasbih: sum.tasbih + d.tasbih }), { athkar: 0, tasbih: 0 }));
  private request = 0;

  ionViewWillEnter(): void { void this.load(); }

  async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.failed.set(false);
    const now = new Date();
    try {
      const [daily, today, week, morning, evening, morningRate, eveningRate] = await Promise.all([
        this.stats.dailyTotals(30, now), this.stats.todayTotal(now), this.stats.weekTotal(now),
        this.stats.streak('morning', now), this.stats.streak('evening', now),
        this.stats.completionRate('morning', 30, now), this.stats.completionRate('evening', 30, now),
      ]);
      if (request !== this.request) return;
      this.daily.set(daily); this.today.set(today); this.week.set(week);
      this.morning.set(morning); this.evening.set(evening);
      this.morningRate.set(morningRate); this.eveningRate.set(eveningRate);
    } catch {
      if (request === this.request) this.failed.set(true);
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  setDays(event: SegmentCustomEvent): void {
    const value = Number(event.detail.value);
    if (value === 7 || value === 30) this.days.set(value);
  }

  number(value: number): string { return new Intl.NumberFormat(this.lang() + '-u-nu-latn').format(value); }
  percent(value: number): string {
    return new Intl.NumberFormat(this.lang() + '-u-nu-latn', { style: 'percent', maximumFractionDigits: 0 }).format(value);
  }
  dayLabel(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Intl.DateTimeFormat(this.lang() + '-u-nu-latn', { weekday: 'short' }).format(new Date(y, m - 1, d));
  }
  height(value: number): number { return value / this.maximum() * 140; }
}
