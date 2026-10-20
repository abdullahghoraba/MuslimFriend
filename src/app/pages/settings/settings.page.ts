import { Component, computed, inject } from '@angular/core';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonRange,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToggle,
  IonToolbar,
  RangeCustomEvent,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Language, ThemeMode } from '../../core/models';
import { AppearanceService } from '../../core/services/appearance.service';
import { SettingsService } from '../../core/services/settings.service';
import packageJson from '../../../../package.json';

@Component({
  selector: 'app-settings',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel,
    IonNote, IonSegment, IonSegmentButton, IonToggle, IonRange,
  ],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  private readonly settingsService = inject(SettingsService);
  private readonly appearance = inject(AppearanceService);

  readonly settings = this.settingsService.settings;
  readonly fontScale = computed(() => this.settings().fontScale);
  readonly version = packageJson.version;

  async setLanguage(value: unknown): Promise<void> {
    if (value === 'ar' || value === 'en') await this.appearance.setLanguage(value as Language);
  }

  async setTheme(value: unknown): Promise<void> {
    if (value === 'system' || value === 'light' || value === 'dark') {
      await this.settingsService.update({ theme: value as ThemeMode });
    }
  }

  async setFontScale(event: RangeCustomEvent): Promise<void> {
    await this.settingsService.update({ fontScale: Number(event.detail.value) });
  }

  async setHaptics(enabled: boolean): Promise<void> {
    await this.settingsService.update({ haptics: enabled });
  }
}
