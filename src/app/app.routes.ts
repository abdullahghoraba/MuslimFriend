import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { SettingsService } from './core/services/settings.service';

/** First launch goes through onboarding. */
const onboardingDone = () => inject(SettingsService).settings().onboardingDone || inject(Router).parseUrl('/onboarding');

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/tabs/tabs.page').then((m) => m.TabsPage),
    canActivate: [onboardingDone],
    children: [
      { path: 'home', loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage) },
      { path: 'quran', loadComponent: () => import('./pages/quran/quran-index.page').then((m) => m.QuranIndexPage) },
      { path: 'tasbih', loadComponent: () => import('./pages/tasbih/tasbih.page').then((m) => m.TasbihPage) },
      { path: 'my-athkar', loadComponent: () => import('./pages/my-athkar/my-athkar.page').then((m) => m.MyAthkarPage) },
      { path: 'settings', loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage) },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },
  {
    path: 'category/:id',
    loadComponent: () => import('./pages/category/category.page').then((m) => m.CategoryPage),
  },
  {
    path: 'overlay',
    loadComponent: () => import('./pages/overlay/overlay.page').then((m) => m.OverlayPage),
  },
  {
    path: 'reminders',
    loadComponent: () => import('./pages/reminders/reminders.page').then((m) => m.RemindersPage),
  },
  {
    path: 'stats',
    loadComponent: () => import('./pages/stats/stats.page').then((m) => m.StatsPage),
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./pages/onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },
  {
    // Mushaf reader: /mushaf/12 (page), optional ?sura=&aya= to highlight an ayah.
    path: 'mushaf/:page',
    loadComponent: () => import('./pages/mushaf/mushaf.page').then((m) => m.MushafPage),
  },
  {
    path: 'quran-search',
    loadComponent: () => import('./pages/quran-search/quran-search.page').then((m) => m.QuranSearchPage),
  },
  {
    path: 'quran-marks',
    loadComponent: () => import('./pages/quran-marks/quran-marks.page').then((m) => m.QuranMarksPage),
  },
  {
    path: 'khatmah',
    loadComponent: () => import('./pages/khatmah/khatmah.page').then((m) => m.KhatmahPage),
  },
  {
    path: 'tafsir-library',
    loadComponent: () => import('./pages/tafsir-library/tafsir-library.page').then((m) => m.TafsirLibraryPage),
  },
  {
    path: 'qibla',
    loadComponent: () => import('./pages/qibla/qibla.page').then((m) => m.QiblaPage),
  },
  {
    path: 'privacy',
    loadComponent: () => import('./pages/privacy/privacy.page').then((m) => m.PrivacyPage),
  },
  { path: '**', redirectTo: 'home' },
];
