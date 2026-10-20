import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
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

interface DailyStatus {
  categoryId: 'morning' | 'evening';
  labelKey: string;
  icon: string;
  progress: CategoryProgress;
}

@Component({
  selector: 'app-home',
  imports: [
    RouterLink, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent,
    IonIcon, IonList, IonItem, IonLabel, IonProgressBar, IonRippleEffect,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage {
  private readonly athkar = inject(AthkarRepository);
  private readonly progress = inject(ProgressService);
  private readonly settings = inject(SettingsService);
  private readonly nav = inject(NavController);

  readonly categories = this.athkar.categories;
  readonly lang = computed(() => this.settings.settings().language);
  readonly daily = signal<DailyStatus[]>([]);
  readonly position = signal<ReaderPosition | null>(null);

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
      statuses.push({ categoryId, labelKey, icon, progress: await this.progress.categoryProgress(categoryId, items) });
    }
    this.daily.set(statuses);
    this.position.set(await this.settings.getReaderPosition());
  }

  categoryName(c: Category | undefined): string {
    if (!c) return '';
    return this.lang() === 'ar' ? c.nameAr : c.nameEn;
  }

  positionCategory(p: ReaderPosition): Category | undefined {
    return this.athkar.category(p.categoryId);
  }

  openReader(categoryId: string, start = 0): void {
    void this.nav.navigateForward(['/reader', categoryId], { queryParams: { start } });
  }
}
