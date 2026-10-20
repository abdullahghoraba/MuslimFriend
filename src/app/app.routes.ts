import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      { path: 'home', loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage) },
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
  { path: '**', redirectTo: 'home' },
];
