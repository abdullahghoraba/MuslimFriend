import { Component } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

/** In-app summary of the privacy policy (the full text is hosted on GitHub Pages, see docs/). */
@Component({
  selector: 'app-privacy',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/settings" [text]="''" [attr.aria-label]="'common.back' | translate" />
        </ion-buttons>
        <ion-title>{{ 'privacy.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p class="lead">{{ 'privacy.lead' | translate }}</p>
      @for (k of sections; track k) {
        <h2>{{ 'privacy.' + k + 'Title' | translate }}</h2>
        <p>{{ 'privacy.' + k + 'Text' | translate }}</p>
      }
    </ion-content>
  `,
  styles: `
    .lead { font-size: 1.05rem; font-weight: 600; line-height: 1.6; }
    h2 { font-size: 1rem; color: var(--ion-color-primary); margin-top: 20px; }
    p { line-height: 1.7; }
  `,
})
export class PrivacyPage {
  readonly sections = ['collect', 'device', 'permissions', 'location', 'backup'];
}
