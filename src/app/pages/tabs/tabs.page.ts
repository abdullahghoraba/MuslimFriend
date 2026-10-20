import { Component } from '@angular/core';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-tabs',
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, TranslatePipe],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="home">
          <ion-icon name="home-outline" aria-hidden="true" />
          <ion-label>{{ 'tabs.home' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="quran">
          <ion-icon name="book-outline" aria-hidden="true" />
          <ion-label>{{ 'tabs.quran' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="tasbih">
          <ion-icon name="ellipse-outline" aria-hidden="true" />
          <ion-label>{{ 'tabs.tasbih' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="my-athkar">
          <ion-icon name="create-outline" aria-hidden="true" />
          <ion-label>{{ 'tabs.myAthkar' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="settings">
          <ion-icon name="settings-outline" aria-hidden="true" />
          <ion-label>{{ 'tabs.settings' | translate }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class TabsPage {}
