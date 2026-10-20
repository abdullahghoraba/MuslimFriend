import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  PreloadAllModules,
  RouteReuseStrategy,
  provideRouter,
  withComponentInputBinding,
  withPreloading,
} from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { routes } from './app.routes';
import { AppearanceService } from './core/services/appearance.service';
import { AthkarRepository } from './core/services/athkar.repository';
import { SettingsService } from './core/services/settings.service';
import { registerIcons } from './icons';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular({ mode: 'md' }),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    provideTranslateService({
      loader: provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),
      fallbackLang: 'ar',
      lang: 'ar',
    }),
    provideAppInitializer(async () => {
      registerIcons();
      const settings = inject(SettingsService);
      const appearance = inject(AppearanceService);
      const athkar = inject(AthkarRepository);
      await settings.load();
      // Language must be ready before first render; content seeding can run in parallel.
      await Promise.all([appearance.init(), athkar.init()]);
    }),
  ],
};
