import { Component, inject } from '@angular/core';
import { IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem, IonToggle, IonSelect, IonSelectOption } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { AthkarPrefs, AthkarPrefsService } from '../../core/services/athkar-prefs.service';
@Component({
  selector: 'app-athkar-settings',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem, IonToggle, IonSelect, IonSelectOption],
  templateUrl: './athkar-settings.page.html',
  styleUrl: './athkar-settings.page.scss',
})
export class AthkarSettingsPage {
  readonly service = inject(AthkarPrefsService);
  readonly prefs = this.service.prefs;
  readonly toggles = ['autoAdvance', 'countPastTarget', 'showSource', 'showTransliteration', 'showMeaning'] as const;
  update<K extends keyof AthkarPrefs>(key: K, value: AthkarPrefs[K]): void { void this.service.update({ [key]: value }); }
}
