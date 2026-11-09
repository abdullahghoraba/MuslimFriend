import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

interface Entry {
  link: string;
  icon: string;
  label: string;
}

/** Everything beyond the daily screens, grouped: hadith, Quran, athkar and tools. New features are added here. */
@Component({
  selector: 'app-more',
  imports: [RouterLink, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonIcon, IonLabel],
  template: `
    <ion-header>
      <ion-toolbar><ion-title><ion-icon name="grid-outline" aria-hidden="true" /> {{ 'more.title' | translate }}</ion-title></ion-toolbar>
    </ion-header>
    <ion-content>
      @for (g of groups; track g.title) {
        <ion-list inset>
          <ion-list-header>{{ g.title | translate }}</ion-list-header>
          @for (e of g.entries; track e.link) {
            <ion-item button detail [routerLink]="e.link">
              <ion-icon slot="start" [name]="e.icon" aria-hidden="true" />
              <ion-label>{{ e.label | translate }}</ion-label>
            </ion-item>
          }
        </ion-list>
      }
    </ion-content>
  `,
  styles: `ion-icon[slot='start'] { color: var(--ion-color-primary); font-size: 22px; }`,
})
export class MorePage {
  readonly groups: { title: string; entries: Entry[] }[] = [
    {
      title: 'more.hadith',
      entries: [
        { link: '/hadith', icon: 'book-outline', label: 'hadith.title' },
        { link: '/hadith/topics', icon: 'layers-outline', label: 'hadith.topics' },
        { link: '/hadith/memorize', icon: 'ribbon-outline', label: 'memo.title' },
        { link: '/hadith/bookmarks', icon: 'bookmark-outline', label: 'hadith.bookmarks' },
      ],
    },
    {
      title: 'more.quran',
      entries: [
        { link: '/listen', icon: 'headset-outline', label: 'listen.title' },
        { link: '/ruqyah', icon: 'shield-checkmark-outline', label: 'ruqyah.title' },
        { link: '/hifz', icon: 'school-outline', label: 'hifz.title' },
        { link: '/studio', icon: 'mic-outline', label: 'studio.title' },
        { link: '/khatmah', icon: 'repeat-outline', label: 'khatmah.title' },
        { link: '/mushaf-editions', icon: 'library-outline', label: 'editions.title' },
        { link: '/tafsir-library', icon: 'albums-outline', label: 'tafsirLib.title' },
      ],
    },
    {
      title: 'more.athkar',
      entries: [
        { link: '/my-athkar', icon: 'create-outline', label: 'tabs.myAthkar' },
        { link: '/stats', icon: 'stats-chart-outline', label: 'stats.title' },
      ],
    },
    {
      title: 'more.tools',
      entries: [
        { link: '/zakat', icon: 'calculator-outline', label: 'zakat.title' },
        { link: '/mawarith', icon: 'git-network-outline', label: 'mawarith.title' },
        { link: '/names', icon: 'sparkles-outline', label: 'names.title' },
        { link: '/qibla', icon: 'kaaba-outline', label: 'qibla.title' },
        { link: '/qada', icon: 'time-outline', label: 'qada.title' },
        { link: '/occasions', icon: 'calendar-outline', label: 'calendar.title' },
      ],
    },
  ];
}
