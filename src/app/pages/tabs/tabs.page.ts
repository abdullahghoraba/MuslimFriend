import { Component, signal } from '@angular/core';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

/** The bottom tabs: the selected one shows its filled icon in a pill (styles.scss, «ion-tab-bar»). */
@Component({
  selector: 'app-tabs',
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, TranslatePipe],
  template: `
    <ion-tabs (ionTabsDidChange)="selected.set($event.tab)">
      <ion-tab-bar slot="bottom">
        @for (t of tabs; track t.tab) {
          <ion-tab-button [tab]="t.tab" [attr.tab]="t.tab">
            <ion-icon [name]="selected() === t.tab ? t.icon : t.icon + '-outline'" aria-hidden="true" />
            <ion-label>{{ t.label | translate }}</ion-label>
          </ion-tab-button>
        }
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class TabsPage {
  readonly selected = signal('home');
  readonly tabs = [
    { tab: 'home', icon: 'home', label: 'tabs.home' },
    { tab: 'quran', icon: 'book', label: 'tabs.quran' },
    { tab: 'tasbih', icon: 'ellipse', label: 'tabs.tasbih' },
    { tab: 'more', icon: 'grid', label: 'tabs.more' },
    { tab: 'settings', icon: 'settings', label: 'tabs.settings' },
  ];
}
