import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonRange,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToggle,
  IonToolbar,
  RangeCustomEvent,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LANGUAGES, ThemeMode, isLanguage } from '../../core/models';
import { AppearanceService, COLOR_STYLES, ColorStyle, STYLE_SWATCHES } from '../../core/services/appearance.service';
import { SettingsService } from '../../core/services/settings.service';
import { ShareService } from '../../core/services/share.service';
import { AthkarOverlay } from '../../native/athkar-overlay';
import packageJson from '../../../../package.json';
import { DataSectionComponent } from './data-section.component';
import { SelectTextsDirective } from '../../shared/select-texts.directive';

@Component({
  selector: 'app-settings',
  imports: [
    RouterLink, TranslatePipe, IonHeader, IonButton, IonIcon, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel,
    IonNote, IonSegment, IonSegmentButton, IonSelect, SelectTextsDirective, IonSelectOption, IonToggle, IonRange, DataSectionComponent,
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
  readonly styles = COLOR_STYLES;
  readonly swatches = STYLE_SWATCHES;
  readonly colorStyle = this.appearance.colorStyle;
  readonly languages = LANGUAGES;

  styleName(s: ColorStyle): string {
    return { calm: 'settings.styleCalm', night: 'settings.styleNight', rose: 'settings.styleRose', classic: 'settings.styleClassic' }[s];
  }

  async setStyle(s: ColorStyle): Promise<void> {
    await this.appearance.setColorStyle(s);
  }

  async setLanguage(value: unknown): Promise<void> {
    if (isLanguage(value)) await this.appearance.setLanguage(value);
  }

  async setTheme(value: unknown): Promise<void> {
    if (value === 'system' || value === 'light' || value === 'dark') {
      await this.settingsService.update({ theme: value as ThemeMode });
    }
  }

  /** − / + buttons beside the text-size slider. */
  async stepFont(delta: number): Promise<void> {
    const next = Math.round(Math.min(2, Math.max(0.8, this.fontScale() + delta)) * 10) / 10;
    await this.settingsService.update({ fontScale: next });
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
    const link = 'https://play.google.com/store/apps/details?id=com.abdullahghoraba.muslimfriend';
    const text = `${this.translate.instant('settings.shareText')}\n${link}`;
    await this.share.shareText(this.translate.instant('app.name'), text);
  }
}
