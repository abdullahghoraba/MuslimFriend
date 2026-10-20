import { Component, computed, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonReorder,
  IonReorderGroup,
  IonTitle,
  IonToolbar,
  ModalController,
  NavController,
  ReorderEndCustomEvent,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { CUSTOM_CATEGORY_ID, Dhikr } from '../../core/models';
import { AthkarRepository } from '../../core/services/athkar.repository';
import { SettingsService } from '../../core/services/settings.service';
import { DhikrEditorComponent } from '../../shared/dhikr-editor.component';

interface Group {
  categoryId: string;
  name: string;
  items: Dhikr[];
}

/** Every dhikr the user added, grouped by the list it lives in (My Athkar, Morning athkar, ...). */
@Component({
  selector: 'app-my-athkar',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonList,
    IonListHeader, IonItem, IonLabel, IonNote, IonReorderGroup, IonReorder, IonFab, IonFabButton,
  ],
  templateUrl: './my-athkar.page.html',
  styleUrl: './my-athkar.page.scss',
})
export class MyAthkarPage {
  private readonly athkar = inject(AthkarRepository);
  private readonly settings = inject(SettingsService);
  private readonly modals = inject(ModalController);
  private readonly nav = inject(NavController);

  readonly items = signal<Dhikr[]>([]);
  readonly reordering = signal(false);
  readonly customId = CUSTOM_CATEGORY_ID;

  readonly groups = computed<Group[]>(() => {
    const ar = this.settings.settings().language === 'ar';
    const byCategory = new Map<string, Dhikr[]>();
    for (const d of this.items()) byCategory.set(d.categoryId, [...(byCategory.get(d.categoryId) ?? []), d]);
    // My Athkar first, then the built-in categories in their usual order.
    const order = [CUSTOM_CATEGORY_ID, ...this.athkar.categories().map((c) => c.id)];
    return order
      .filter((id) => byCategory.has(id))
      .map((id) => {
        const c = this.athkar.category(id)!;
        return { categoryId: id, name: ar ? c.nameAr : c.nameEn, items: byCategory.get(id)! };
      });
  });

  readonly customCount = computed(() => this.items().filter((d) => d.categoryId === CUSTOM_CATEGORY_ID).length);

  ionViewWillEnter(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.items.set(await this.athkar.listCustom());
  }

  async open(d?: Dhikr): Promise<void> {
    const modal = await this.modals.create({
      component: DhikrEditorComponent,
      componentProps: d ? { dhikr: d } : { categoryId: CUSTOM_CATEGORY_ID },
    });
    await modal.present();
    const { role } = await modal.onWillDismiss();
    if (role === 'saved' || role === 'deleted') await this.load();
  }

  /** Only the My Athkar list is reordered here; other lists are reordered on their own page. */
  async onReorder(event: ReorderEndCustomEvent, group: Group): Promise<void> {
    const reordered = event.detail.complete(group.items) as Dhikr[];
    await this.athkar.reorder(reordered.map((i) => i.id));
    await this.load();
  }

  openList(categoryId: string): void {
    void this.nav.navigateForward(['/category', categoryId]);
  }

  read(): void {
    void this.nav.navigateForward(['/category', CUSTOM_CATEGORY_ID]);
  }
}
