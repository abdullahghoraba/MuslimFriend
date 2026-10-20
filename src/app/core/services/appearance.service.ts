import { DOCUMENT, Injectable, effect, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { Language, ThemeMode } from '../models';
import { SettingsService } from './settings.service';

/** Applies language/direction, theme and text scale from settings to the document. */
@Injectable({ providedIn: 'root' })
export class AppearanceService {
  private readonly document = inject(DOCUMENT);
  private readonly translate = inject(TranslateService);
  private readonly settings = inject(SettingsService);
  private readonly darkQuery = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    effect(() => this.applyTheme(this.settings.settings().theme));
    effect(() => this.applyFontScale(this.settings.settings().fontScale));
    this.darkQuery?.addEventListener('change', () => this.applyTheme(this.settings.settings().theme));
  }

  async init(): Promise<void> {
    await this.applyLanguage(this.settings.settings().language);
  }

  async setLanguage(language: Language): Promise<void> {
    if (language === this.settings.settings().language) return;
    await this.settings.update({ language });
    // Ionic components (range, toggle, sliding items) resolve RTL/LTR once at render time,
    // so a direction change needs a fresh render. Reloading the local WebView is instant.
    this.document.defaultView?.location.reload();
  }

  private async applyLanguage(language: Language): Promise<void> {
    const html = this.document.documentElement;
    html.lang = language;
    html.dir = language === 'ar' ? 'rtl' : 'ltr';
    await firstValueFrom(this.translate.use(language));
  }

  private applyTheme(mode: ThemeMode): void {
    const dark = mode === 'dark' || (mode === 'system' && !!this.darkQuery?.matches);
    this.document.documentElement.classList.toggle('ion-palette-dark', dark);
  }

  private applyFontScale(scale: number): void {
    this.document.documentElement.style.setProperty('--dhikr-font-scale', String(scale));
  }
}
