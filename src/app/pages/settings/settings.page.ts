import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonIcon,
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
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Language, ThemeMode } from '../../core/models';
import { AppearanceService } from '../../core/services/appearance.service';
import { SettingsService } from '../../core/services/settings.service';
import { ShareService } from '../../core/services/share.service';
import { AthkarOverlay } from '../../native/athkar-overlay';
import packageJson from '../../../../package.json';
import { DataSectionComponent } from './data-section.component';

@Component({
  selector: 'app-settings',
  imports: [
    RouterLink, TranslatePipe, IonHeader, IonIcon, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel,
    IonNote, IonSegment, IonSegmentButton, IonToggle, IonRange, DataSectionComponent,
  ],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  private readonly settingsService = inject(SettingsService);
  private readonly appearance = inject(AppearanceService);
  private readonly share = inject(ShareService);
  private readonly translate = inject(TranslateService);

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

  async rate(): Promise<void> {
    await AthkarOverlay.openStoreListing();
  }

  async shareApp(): Promise<void> {
    const link = 'https://play.google.com/store/apps/details?id=com.muslimathkar.app';
    const text = `${this.translate.instant('settings.shareText')}\n${link}`;
    await this.share.shareText(this.translate.instant('app.name'), text);
  }
}
