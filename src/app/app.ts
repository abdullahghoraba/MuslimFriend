import { Component, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { IonApp, IonRouterOutlet, NavController, Platform, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

/** Window for the second back press that exits from Home. */
const EXIT_WINDOW_MS = 2000;

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  template: `<ion-app><ion-router-outlet /></ion-app>`,
})
export class App {
  private readonly outlet = viewChild(IonRouterOutlet);
  private readonly platform = inject(Platform);
  private readonly router = inject(Router);
  private readonly nav = inject(NavController);
  private readonly toasts = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private lastBackAt = 0;

  constructor() {
    if (!Capacitor.isNativePlatform()) return;
    // Registering a listener stops the native side from walking the WebView history on its own;
    // every back press then goes through the single handler below.
    void CapApp.addListener('backButton', () => {});
    // Priority 10: below modals/action sheets/menus (they close first), above the router outlet.
    this.platform.backButton.subscribeWithPriority(10, () => void this.onBack());
  }

  private async onBack(): Promise<void> {
    const outlet = this.outlet();
    if (outlet?.canGoBack()) {
      void outlet.pop();
      return;
    }
    const path = this.router.url.split('?')[0];
    if (path !== '/home' && path !== '/') {
      // Another tab, or a page opened directly (e.g. from a notification): go Home first.
      void this.nav.navigateRoot('/home', { animationDirection: 'back' });
      return;
    }
    const now = Date.now();
    if (now - this.lastBackAt < EXIT_WINDOW_MS) {
      await CapApp.exitApp();
      return;
    }
    this.lastBackAt = now;
    const toast = await this.toasts.create({
      message: this.translate.instant('common.pressBackAgain'),
      duration: EXIT_WINDOW_MS,
      position: 'bottom',
    });
    await toast.present();
  }
}
