import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  AlertController,
  IonHeader,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonTitle,
  IonContent,
  IonButton,
  IonIcon,
} from '@ionic/angular';
import { KhatmahService } from '../../core/quran/khatmah.service';
import { dateKey } from '../../core/util/date';
@Component({
  selector: 'app-khatmah',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    TranslatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonButton,
    IonIcon,
  ],
  templateUrl: './khatmah.page.html',
  styleUrl: './khatmah.page.scss',
})
export class KhatmahPage {
  readonly service = inject(KhatmahService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly alerts = inject(AlertController);
  readonly days = [7, 10, 15, 20, 30, 60];
  name = '';
  targetDays = 30;
  startPage = 1;
  readonly busy = signal(false);
  readonly ready = signal(false);
  readonly error = signal('');
  readonly chart = signal<{ date: string; pages: number }[]>([]);
  readonly maxPages = computed(() => Math.max(1, ...this.chart().map((d) => d.pages)));
  readonly today = signal(new Date());
  readonly wird = computed(() => this.service.todayWird(this.today()));
  readonly daysLeft = computed(() => {
    const p = this.service.active();
    return p
      ? Math.max(
          0,
          p.targetDays -
            Math.round((Date.parse(dateKey(this.today())) - Date.parse(p.startedOn)) / 86400000),
        )
      : 0;
  });
  readonly completed = computed(() => this.service.history().filter((p) => !!p.completedAt));
  async ionViewWillEnter(): Promise<void> {
    this.today.set(new Date());
    if (!this.name) this.name = this.translate.instant('khatmah.defaultName');
    try {
      await this.service.load();
      await this.refresh();
      this.ready.set(true);
    } catch {
      this.error.set('khatmah.error');
    }
  }
  private async refresh(): Promise<void> {
    this.chart.set(await this.service.pagesReadLastDays(7, this.today()));
  }
  async create(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.service.create(this.name, Number(this.targetDays), Number(this.startPage));
      await this.refresh();
    } catch {
      this.error.set('khatmah.invalid');
    } finally {
      this.busy.set(false);
    }
  }
  read(page: number): void {
    void this.router.navigate(['/mushaf', page]);
  }
  async setPage(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('khatmah.setPage'),
      inputs: [
        {
          name: 'page',
          type: 'number',
          min: this.service.active()?.startPage ?? 1,
          max: 604,
          value: Math.max(1, this.service.active()?.currentPage ?? 1),
        },
      ],
      buttons: [
        { text: this.translate.instant('khatmah.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('khatmah.save'),
          handler: (data: { page: string }) => {
            void this.savePage(Number(data.page));
          },
        },
      ],
    });
    await alert.present();
  }
  private async savePage(page: number): Promise<void> {
    try {
      await this.service.setCurrentPage(page);
      await this.refresh();
    } catch {
      this.error.set('khatmah.invalid');
    }
  }
  async end(): Promise<void> {
    const plan = this.service.active();
    if (!plan) return;
    const alert = await this.alerts.create({
      header: this.translate.instant('khatmah.end'),
      message: this.translate.instant('khatmah.endHint'),
      buttons: [
        { text: this.translate.instant('khatmah.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('khatmah.end'),
          role: 'destructive',
          handler: () => {
            void this.service.abandon(plan.id).catch(() => this.error.set('khatmah.error'));
          },
        },
      ],
    });
    await alert.present();
  }
}
