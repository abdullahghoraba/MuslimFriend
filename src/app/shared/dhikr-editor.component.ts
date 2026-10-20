import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonList,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CUSTOM_CATEGORY_ID, Dhikr } from '../core/models';
import { AthkarRepository } from '../core/services/athkar.repository';
import { SettingsService } from '../core/services/settings.service';

export type EditorResult = 'saved' | 'deleted' | 'cancel';

/**
 * Add or edit the user's own dhikr, in any list (e.g. Morning athkar).
 * Open with ModalController: componentProps { dhikr?: Dhikr, categoryId?: string }.
 * Dismisses with role 'saved' | 'deleted' | 'cancel' and data = the dhikr id.
 */
@Component({
  selector: 'app-dhikr-editor',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonList, IonItem,
    IonTextarea, IonInput, IonToggle, IonSelect, IonSelectOption, IonIcon,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="close('cancel')">{{ 'common.cancel' | translate }}</ion-button>
        </ion-buttons>
        <ion-title>{{ (dhikr() ? 'myAthkar.edit' : 'myAthkar.add') | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button strong (click)="save()" [disabled]="busy()">{{ 'common.save' | translate }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-list lines="full">
        <ion-item>
          <ion-textarea class="dhikr-input" dir="auto" [autoGrow]="true" [rows]="4"
                        labelPlacement="stacked" [label]="'myAthkar.text' | translate"
                        [placeholder]="'myAthkar.textPlaceholder' | translate"
                        [value]="text()" (ionInput)="text.set($event.detail.value ?? '')"
                        [errorText]="'myAthkar.required' | translate"
                        [class.ion-invalid]="showError()" [class.ion-touched]="showError()" />
        </ion-item>
        <ion-item>
          <ion-textarea dir="auto" [autoGrow]="true" labelPlacement="stacked" [label]="'myAthkar.meaning' | translate"
                        [value]="meaning()" (ionInput)="meaning.set($event.detail.value ?? '')" />
        </ion-item>
        <ion-item>
          <ion-input type="number" inputmode="numeric" [min]="1" [max]="10000" labelPlacement="stacked"
                     [label]="'myAthkar.repeat' | translate" [value]="repeat()"
                     (ionInput)="repeat.set(+($event.detail.value ?? 1))" />
        </ion-item>
        <ion-item>
          <ion-select [label]="'myAthkar.list' | translate" labelPlacement="stacked" interface="action-sheet"
                      [value]="category()" (ionChange)="category.set($event.detail.value)">
            @for (c of categoryOptions(); track c.id) {
              <ion-select-option [value]="c.id">{{ c.name }}</ion-select-option>
            }
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-toggle [checked]="overlay()" (ionChange)="overlay.set($event.detail.checked)">
            {{ 'myAthkar.includeInOverlay' | translate }}
          </ion-toggle>
        </ion-item>
      </ion-list>
      <p class="hint">{{ 'myAthkar.positionHint' | translate }}</p>
      @if (dhikr()) {
        <ion-button expand="block" color="danger" fill="clear" class="ion-margin-top" (click)="confirmDelete()">
          <ion-icon slot="start" name="trash-outline" aria-hidden="true" />
          {{ 'common.delete' | translate }}
        </ion-button>
      }
    </ion-content>
  `,
  styles: `
    .dhikr-input { font-family: 'Amiri', serif; font-size: 1.2rem; }
    .hint { margin: 12px 4px; font-size: 0.85rem; color: var(--app-muted); }
  `,
})
export class DhikrEditorComponent implements OnInit {
  /** Existing custom dhikr to edit; omit to add a new one. */
  readonly dhikr = input<Dhikr | undefined>(undefined);
  /** List to add to (defaults to My Athkar). */
  readonly categoryId = input<string>(CUSTOM_CATEGORY_ID);

  private readonly athkar = inject(AthkarRepository);
  private readonly settings = inject(SettingsService);
  // Not named "modal": that property name is reserved inside Ionic modal components.
  private readonly modalCtrl = inject(ModalController);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);

  readonly text = signal('');
  readonly meaning = signal('');
  readonly repeat = signal(1);
  readonly overlay = signal(true);
  readonly category = signal<string>(CUSTOM_CATEGORY_ID);
  readonly showError = signal(false);
  readonly busy = signal(false);

  readonly categoryOptions = computed(() => {
    const ar = this.settings.settings().language === 'ar';
    const mine = this.athkar.category(CUSTOM_CATEGORY_ID)!;
    return [mine, ...this.athkar.categories()].map((c) => ({ id: c.id, name: ar ? c.nameAr : c.nameEn }));
  });

  ngOnInit(): void {
    const d = this.dhikr();
    if (d) {
      this.text.set(d.textAr);
      this.meaning.set(d.meaningEn);
      this.repeat.set(d.repeatCount);
      this.overlay.set(d.includeInOverlay);
      this.category.set(d.categoryId);
    } else {
      this.category.set(this.categoryId());
    }
  }

  async save(): Promise<void> {
    if (!this.text().trim()) {
      this.showError.set(true);
      return;
    }
    this.busy.set(true);
    try {
      const input = {
        textAr: this.text(), meaningEn: this.meaning(), repeatCount: this.repeat(), includeInOverlay: this.overlay(),
      };
      const existing = this.dhikr();
      let id: string;
      if (existing) {
        await this.athkar.updateCustom(existing.id, input, this.category());
        id = existing.id;
      } else {
        id = (await this.athkar.addCustom(input, this.category())).id;
      }
      await this.close('saved', id);
    } finally {
      this.busy.set(false);
    }
  }

  async confirmDelete(): Promise<void> {
    const d = this.dhikr();
    if (!d) return;
    const alert = await this.alerts.create({
      header: this.translate.instant('myAthkar.deleteConfirm'),
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('common.delete'),
          role: 'destructive',
          handler: () => {
            void this.athkar.deleteCustom(d.id).then(() => this.close('deleted', d.id));
          },
        },
      ],
    });
    await alert.present();
  }

  close(role: EditorResult, id?: string): Promise<boolean> {
    return this.modalCtrl.dismiss(id, role);
  }
}
