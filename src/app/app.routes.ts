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
    path: 'hifz/test',
    loadComponent: () => import('./pages/hifz/hifz-test.page').then((m) => m.HifzTestPage),
  },
  {
    path: 'hifz',
    loadComponent: () => import('./pages/hifz/hifz.page').then((m) => m.HifzPage),
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
  { path: 'athkar-settings', loadComponent: () => import('./pages/athkar-settings/athkar-settings.page').then((m) => m.AthkarSettingsPage) },
  { path: 'occasions', loadComponent: () => import('./pages/occasions/occasions.page').then((m) => m.OccasionsPage) },
  { path: 'names', loadComponent: () => import('./pages/names/names.page').then((m) => m.NamesPage) },
  { path: 'zakat', loadComponent: () => import('./pages/zakat/zakat.page').then((m) => m.ZakatPage) },
  { path: 'qada', loadComponent: () => import('./pages/qada/qada.page').then((m) => m.QadaPage) },
  { path: 'athan', loadComponent: () => import('./pages/athan/athan.page').then(m => m.AthanPage) },
  // Listen to the Quran: full-sura reciters and live radios (mp3quran.net).
  { path: 'listen', loadComponent: () => import('./pages/listen/listen.page').then((m) => m.ListenPage) },
  // Other printed mushafs (Shamarly page images) and the riwayat (Warsh, Qalun...): /mushaf-edition/warsh/1
  { path: 'mushaf-edition/:edition/:page', loadComponent: () => import('./pages/mushaf-edition/mushaf-edition.page').then((m) => m.MushafEditionPage) },
  { path: 'mushaf-editions', loadComponent: () => import('./pages/mushaf-edition/mushaf-editions.page').then((m) => m.MushafEditionsPage) },
  { path: 'listen/:id', loadComponent: () => import('./pages/listen/listen-reciter.page').then((m) => m.ListenReciterPage) },
  { path: 'hadith', loadComponent: () => import('./pages/hadith/hadith.page').then((m) => m.HadithPage) },
  { path: 'hadith/bookmarks', data: { bookmarks: true }, loadComponent: () => import('./pages/hadith/hadith.page').then((m) => m.HadithPage) },
  // Topics and explanations (HadeethEnc.com), before the collection routes that would take 'topics' for a book.
  { path: 'hadith/memorize', loadComponent: () => import('./pages/hadith/hadith-memorize.page').then((m) => m.HadithMemorizePage) },
  { path: 'hadith/topics', loadComponent: () => import('./pages/hadith/hadith-topics.page').then((m) => m.HadithTopicsPage) },
  { path: 'hadith/topics/:category', loadComponent: () => import('./pages/hadith/hadith-topics.page').then((m) => m.HadithTopicsPage) },
  { path: 'hadith/enc/:id', loadComponent: () => import('./pages/hadith/hadith-enc.page').then((m) => m.HadithEncPage) },
  { path: 'hadith/:collection', loadComponent: () => import('./pages/hadith/hadith.page').then((m) => m.HadithPage) },
  { path: 'hadith/:collection/:book', loadComponent: () => import('./pages/hadith/hadith.page').then((m) => m.HadithPage) },
  { path: 'hadith/:collection/:book/:number', loadComponent: () => import('./pages/hadith/hadith.page').then((m) => m.HadithPage) },
  { path: '**', redirectTo: 'home' },
];
