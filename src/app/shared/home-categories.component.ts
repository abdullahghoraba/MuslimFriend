import { Component, inject, signal } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonList,
  IonItem,
  IonToggle,
  IonIcon,
  ModalController,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { AthkarRepository } from '../core/services/athkar.repository';
import { SettingsService } from '../core/services/settings.service';
import { Category } from '../core/models';
@Component({
  selector: 'app-home-categories',
  imports: [
    TranslatePipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonToggle,
    IonIcon,
  ],
  template: `
    <ion-header
      ><ion-toolbar
        ><ion-title>{{ 'home.customizeCategories' | translate }}</ion-title
        ><ion-buttons slot="end"
          ><ion-button (click)="close()">{{
            'home.doneCustomizing' | translate
          }}</ion-button></ion-buttons
        ></ion-toolbar
      ></ion-header
    >
    <ion-content
      ><ion-list>
        @for (c of athkar.categories(); track c.id) {
          <ion-item
            ><ion-icon slot="start" [name]="c.icon" aria-hidden="true" /><ion-toggle
              [disabled]="busy()"
              [checked]="c.isUser ? c.showOnHome : !athkar.homeHidden().has(c.id)"
              (ionChange)="setVisible(c.id, $event.detail.checked)"
              >{{ categoryName(c) }}</ion-toggle
            ></ion-item
          >
        }
      </ion-list></ion-content
    >
  `,
})
export class HomeCategoriesComponent {
  readonly athkar = inject(AthkarRepository);
  readonly settings = inject(SettingsService);
  private readonly modalCtrl = inject(ModalController);
  readonly busy = signal(false);
  categoryName(c: Category): string { return this.athkar.nameIn(this.settings.settings().language, c); }
  close(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
  async setVisible(id: string, visible: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await this.athkar.setHomeVisible(id, visible);
    } finally {
      this.busy.set(false);
    }
  }
}
