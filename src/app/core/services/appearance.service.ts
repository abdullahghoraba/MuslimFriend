import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { Language, ThemeMode } from '../models';
import { SettingsService } from './settings.service';

export type ColorStyle = 'calm' | 'night' | 'rose' | 'classic';
export const COLOR_STYLES: ColorStyle[] = ['calm', 'night', 'rose', 'classic'];
/** Swatch colours for the style picker (light primary, secondary). */
export const STYLE_SWATCHES: Record<ColorStyle, [string, string]> = {
  calm: ['#2e7d61', '#e5c38a'],
  night: ['#24426f', '#d9b25e'],
  rose: ['#94435a', '#e9c7cf'],
  classic: ['#0f6b5c', '#9a6b1f'],
};
const STYLE_KEY = 'colorStyle';

/** Applies language/direction, light/dark, colour style and text scale to the document. */
@Injectable({ providedIn: 'root' })
export class AppearanceService {
  private readonly document = inject(DOCUMENT);
  private readonly translate = inject(TranslateService);
  private readonly settings = inject(SettingsService);
  private readonly darkQuery = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');

  readonly colorStyle = signal<ColorStyle>('calm');

  constructor() {
    effect(() => this.applyTheme(this.settings.settings().theme));
    effect(() => this.applyFontScale(this.settings.settings().fontScale));
    effect(() => this.applyStyle(this.colorStyle()));
    this.darkQuery?.addEventListener('change', () => this.applyTheme(this.settings.settings().theme));
  }

  async init(): Promise<void> {
    const { value } = await Preferences.get({ key: STYLE_KEY });
    if (value && (COLOR_STYLES as string[]).includes(value)) this.colorStyle.set(value as ColorStyle);
    await this.applyLanguage(this.settings.settings().language);
  }

  async setColorStyle(style: ColorStyle): Promise<void> {
    this.colorStyle.set(style);
    await Preferences.set({ key: STYLE_KEY, value: style });
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

  private applyStyle(style: ColorStyle): void {
    const cl = this.document.documentElement.classList;
    for (const s of COLOR_STYLES) cl.toggle(`theme-${s}`, s === style);
  }

  private applyFontScale(scale: number): void {
    this.document.documentElement.style.setProperty('--dhikr-font-scale', String(scale));
  }
}
