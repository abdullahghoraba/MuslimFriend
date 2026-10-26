import { Component, computed, inject, signal } from '@angular/core';
import {
  ActionSheetController,
  IonToggle,
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
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CUSTOM_CATEGORY_ID, Category, Dhikr } from '../../core/models';
import { AthkarRepository } from '../../core/services/athkar.repository';
import { SettingsService } from '../../core/services/settings.service';
import { DhikrEditorComponent } from '../../shared/dhikr-editor.component';

import { CollectionEditorComponent } from '../../shared/collection-editor.component';

interface Group {
  categoryId: string;
  name: string;
  items: Dhikr[];
}

/** Every dhikr the user added, grouped by the list it lives in (My Athkar, Morning athkar, ...). */
@Component({
  selector: 'app-my-athkar',
  imports: [
    IonToggle,
    TranslatePipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonReorderGroup,
    IonReorder,
    IonFab,
    IonFabButton,
  ],
  templateUrl: './my-athkar.page.html',
  styleUrl: './my-athkar.page.scss',
})
export class MyAthkarPage {
  private readonly athkar = inject(AthkarRepository);
  private readonly settings = inject(SettingsService);
  private readonly modals = inject(ModalController);
  private readonly nav = inject(NavController);

  private readonly sheets = inject(ActionSheetController);
  private readonly translate = inject(TranslateService);
  readonly collections = computed(() => this.athkar.categories().filter((c) => c.isUser));
  collectionCount(id: string): number {
    return this.items().filter((d) => d.categoryId === id).length;
  }
  async editCollection(collection?: Category): Promise<void> {
    const modal = await this.modals.create({
      component: CollectionEditorComponent,
      componentProps: { collection },
    });
    await modal.present();
    await modal.onWillDismiss();
    await this.load();
  }
  async toggleCollection(c: Category, visible: boolean): Promise<void> {
    await this.athkar.setHomeVisible(c.id, visible);
  }
  async collectionMenu(c: Category): Promise<void> {
    const sheet = await this.sheets.create({
      header: c.nameAr,
      buttons: [
        {
          text: this.translate.instant('myAthkar.editCollection'),
          handler: () => {
            void this.editCollection(c);
          },
        },
        {
          text: this.translate.instant('common.delete'),
          role: 'destructive',
          handler: () => {
            void this.deleteCollection(c);
          },
        },
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }
  async deleteCollection(c: Category): Promise<void> {
    const remove = async (mode: 'move' | 'delete') => {
      await this.athkar.deleteCollection(c.id, mode);
      await this.load();
    };
    const sheet = await this.sheets.create({
      header: this.translate.instant('myAthkar.deleteCollection'),
      buttons: [
        {
          text: this.translate.instant('myAthkar.deleteCollectionMove'),
          handler: () => {
            void remove('move');
          },
        },
        {
          text: this.translate.instant('myAthkar.deleteCollectionAll'),
          role: 'destructive',
          handler: () => {
            void remove('delete');
          },
        },
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  readonly items = signal<Dhikr[]>([]);
  readonly reordering = signal(false);
  readonly customId = CUSTOM_CATEGORY_ID;

  readonly groups = computed<Group[]>(() => {
    const lang = this.settings.settings().language;
    const byCategory = new Map<string, Dhikr[]>();
    for (const d of this.items())
      byCategory.set(d.categoryId, [...(byCategory.get(d.categoryId) ?? []), d]);
    // My Athkar first, then the built-in categories in their usual order.
    const order = [CUSTOM_CATEGORY_ID, ...this.athkar.categories().map((c) => c.id)];
    return order
      .filter((id) => byCategory.has(id))
      .map((id) => {
        const c = this.athkar.category(id)!;
        return { categoryId: id, name: this.athkar.nameIn(lang, c), items: byCategory.get(id)! };
      });
  });

  readonly customCount = computed(
    () => this.items().filter((d) => d.categoryId === CUSTOM_CATEGORY_ID).length,
  );

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
