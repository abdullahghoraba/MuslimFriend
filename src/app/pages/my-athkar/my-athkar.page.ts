import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonReorder,
  IonReorderGroup,
  IonTextarea,
  IonTitle,
  IonToggle,
  IonToolbar,
  NavController,
  ReorderEndCustomEvent,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CUSTOM_CATEGORY_ID, CustomDhikrInput, Dhikr } from '../../core/models';
import { AthkarRepository } from '../../core/services/athkar.repository';

interface DraftForm extends CustomDhikrInput {
  id?: string;
}

const emptyDraft = (): DraftForm => ({ textAr: '', meaningEn: '', repeatCount: 1, includeInOverlay: true });

@Component({
  selector: 'app-my-athkar',
  imports: [
    FormsModule, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent,
    IonList, IonItem, IonLabel, IonNote, IonToggle, IonReorderGroup, IonReorder, IonItemSliding, IonItemOptions,
    IonItemOption, IonFab, IonFabButton, IonModal, IonTextarea, IonInput,
  ],
  templateUrl: './my-athkar.page.html',
  styleUrl: './my-athkar.page.scss',
})
export class MyAthkarPage {
  private readonly athkar = inject(AthkarRepository);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private readonly nav = inject(NavController);

  readonly items = signal<Dhikr[]>([]);
  readonly reordering = signal(false);
  readonly editorOpen = signal(false);
  readonly draft = signal<DraftForm>(emptyDraft());
  readonly showError = signal(false);

  ionViewWillEnter(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.items.set(await this.athkar.byCategory(CUSTOM_CATEGORY_ID));
  }

  openEditor(d?: Dhikr): void {
    this.draft.set(
      d
        ? { id: d.id, textAr: d.textAr, meaningEn: d.meaningEn, repeatCount: d.repeatCount, includeInOverlay: d.includeInOverlay }
        : emptyDraft(),
    );
    this.showError.set(false);
    this.editorOpen.set(true);
  }

  patchDraft(patch: Partial<DraftForm>): void {
    this.draft.update((d) => ({ ...d, ...patch }));
  }

  async save(): Promise<void> {
    const draft = this.draft();
    if (!draft.textAr.trim()) {
      this.showError.set(true);
      return;
    }
    if (draft.id) await this.athkar.updateCustom(draft.id, draft);
    else await this.athkar.addCustom(draft);
    this.editorOpen.set(false);
    await this.load();
  }

  async confirmDelete(id: string, sliding?: IonItemSliding): Promise<void> {
    await sliding?.close();
    const alert = await this.alerts.create({
      header: this.translate.instant('myAthkar.deleteConfirm'),
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('common.delete'),
          role: 'destructive',
          handler: async () => {
            await this.athkar.deleteCustom(id);
            await this.load();
          },
        },
      ],
    });
    await alert.present();
  }

  async onReorder(event: ReorderEndCustomEvent): Promise<void> {
    const reordered = event.detail.complete(this.items()) as Dhikr[];
    this.items.set(reordered);
    await this.athkar.reorder(reordered.map((i) => i.id));
  }

  read(): void {
    void this.nav.navigateForward(['/category', CUSTOM_CATEGORY_ID]);
  }
}
