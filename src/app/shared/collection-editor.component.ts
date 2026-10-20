import { Component, OnInit, inject, input, signal } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonInput,
  IonToggle,
  IonIcon,
  ModalController,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Category } from '../core/models';
import { AthkarRepository } from '../core/services/athkar.repository';

@Component({
  selector: 'app-collection-editor',
  imports: [
    TranslatePipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonInput,
    IonToggle,
    IonIcon,
  ],
  template: `
    <ion-header
      ><ion-toolbar>
        <ion-buttons slot="start"
          ><ion-button (click)="close()">{{ 'common.cancel' | translate }}</ion-button></ion-buttons
        >
        <ion-title>{{
          (collection() ? 'myAthkar.editCollection' : 'myAthkar.newCollection') | translate
        }}</ion-title>
        <ion-buttons slot="end"
          ><ion-button [disabled]="busy() || !name().trim()" (click)="save()">{{
            'common.save' | translate
          }}</ion-button></ion-buttons
        >
      </ion-toolbar></ion-header
    >
    <ion-content class="ion-padding">
      <ion-input
        dir="auto"
        [label]="'myAthkar.collectionName' | translate"
        labelPlacement="stacked"
        [value]="name()"
        (ionInput)="name.set($event.detail.value ?? '')"
      />
      <p id="collection-icons">{{ 'myAthkar.collectionIcon' | translate }}</p>
      <div class="icons" role="group" aria-labelledby="collection-icons">
        @for (choice of icons; track choice) {
          <ion-button
            [fill]="icon() === choice ? 'solid' : 'outline'"
            [attr.aria-label]="'myAthkar.collectionIcons.' + choice | translate"
            [attr.aria-pressed]="icon() === choice"
            (click)="icon.set(choice)"
            ><ion-icon slot="icon-only" [name]="choice" aria-hidden="true"
          /></ion-button>
        }
      </div>
      <ion-toggle [checked]="showOnHome()" (ionChange)="showOnHome.set($event.detail.checked)">{{
        'myAthkar.showOnHome' | translate
      }}</ion-toggle>
    </ion-content>
  `,
  styles:
    '.icons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-block-end: 24px; }',
})
export class CollectionEditorComponent implements OnInit {
  readonly collection = input<Category>();
  private readonly athkar = inject(AthkarRepository);
  private readonly modalCtrl = inject(ModalController);
  readonly name = signal('');
  readonly icon = signal('layers-outline');
  readonly showOnHome = signal(true);
  readonly busy = signal(false);
  readonly icons = [
    'heart-outline',
    'star-outline',
    'book-outline',
    'moon-outline',
    'sunny-outline',
    'flag-outline',
    'layers-outline',
    'bookmark-outline',
    'hand-left-outline',
    'cloud-outline',
    'pricetag-outline',
    'list-outline',
  ];
  ngOnInit(): void {
    const c = this.collection();
    if (c) {
      this.name.set(c.nameAr);
      this.icon.set(c.icon);
      this.showOnHome.set(!!c.showOnHome);
    }
  }
  close(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
  async save(): Promise<void> {
    if (this.busy() || !this.name().trim()) return;
    this.busy.set(true);
    try {
      const c = this.collection();
      if (c)
        await this.athkar.updateCollection(c.id, {
          name: this.name(),
          icon: this.icon(),
          showOnHome: this.showOnHome(),
        });
      const saved = c ?? await this.athkar.addCollection(this.name(), this.icon(), this.showOnHome());
      await this.modalCtrl.dismiss(saved, 'saved');
    } finally {
      this.busy.set(false);
    }
  }
}
