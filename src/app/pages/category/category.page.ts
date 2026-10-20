import { Component, computed, inject, input, signal } from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonReorder,
  IonReorderGroup,
  IonTitle,
  IonToolbar,
  NavController,
  ReorderEndCustomEvent,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Dhikr } from '../../core/models';
import { AthkarRepository } from '../../core/services/athkar.repository';
import { ProgressService } from '../../core/services/progress.service';
import { SettingsService } from '../../core/services/settings.service';

@Component({
  selector: 'app-category',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonButton, IonIcon, IonContent,
    IonList, IonItem, IonLabel, IonNote, IonReorderGroup, IonReorder, IonFooter,
  ],
  templateUrl: './category.page.html',
  styleUrl: './category.page.scss',
})
export class CategoryPage {
  /** Route param (bound by withComponentInputBinding). */
  readonly id = input<string>('');

  private readonly athkar = inject(AthkarRepository);
  private readonly progress = inject(ProgressService);
  private readonly settings = inject(SettingsService);
  private readonly nav = inject(NavController);

  readonly items = signal<Dhikr[]>([]);
  readonly counts = signal<Map<string, number>>(new Map());
  readonly reordering = signal(false);
  readonly category = computed(() => this.athkar.category(this.id()));
  readonly title = computed(() => {
    const c = this.category();
    if (!c) return '';
    return this.settings.settings().language === 'ar' ? c.nameAr : c.nameEn;
  });

  ionViewWillEnter(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const items = await this.athkar.byCategory(this.id());
    this.items.set(items);
    this.counts.set(await this.progress.countsFor(items.map((i) => i.id)));
  }

  preview(d: Dhikr): string {
    const words = d.textAr.split(/\s+/);
    return words.length > 14 ? `${words.slice(0, 14).join(' ')}…` : d.textAr;
  }

  countOf(d: Dhikr): number {
    return Math.min(this.counts().get(d.id) ?? 0, d.repeatCount);
  }

  open(index: number): void {
    if (this.reordering()) return;
    void this.nav.navigateForward(['/reader', this.id()], { queryParams: { start: index } });
  }

  async onReorder(event: ReorderEndCustomEvent): Promise<void> {
    const reordered = event.detail.complete(this.items()) as Dhikr[];
    this.items.set(reordered);
    await this.athkar.reorder(reordered.map((i) => i.id));
  }

  async resetToday(): Promise<void> {
    await this.progress.resetCategoryToday(this.items());
    await this.load();
  }
}
