import { Injectable, inject, signal } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { NavController } from '@ionic/angular';
import { AthkarOverlay } from '../../native/athkar-overlay';
import { AthanService } from '../prayer/athan.service';
import { PrayerService } from '../prayer/prayer.service';
import { FloatingCounterService } from './floating-counter.service';
import { OverlayService } from './overlay.service';
import { ProgressService } from './progress.service';

/**
 * Work done on start and on every resume:
 * - pull "+1" counts taken in the overlay into SQLite,
 * - re-plan the next 30 days of reminders (prayer times shift daily),
 * - refresh the overlay status (and its fallback notice),
 * - open the screen a tapped reminder notification asked for.
 */
@Injectable({ providedIn: 'root' })
export class LifecycleService {
  private readonly overlay = inject(OverlayService);
  private readonly prayer = inject(PrayerService);
  private readonly athan = inject(AthanService);
  private readonly progress = inject(ProgressService);
  private readonly floating = inject(FloatingCounterService);
  private readonly nav = inject(NavController);
  /** Increments after each resume so pages can refresh. */
  readonly resumed = signal(0);

  async init(): Promise<void> {
    await Promise.all([this.overlay.load(), this.prayer.load()]);
    await this.onForeground();
    if (!Capacitor.isNativePlatform()) return;
    await App.addListener('resume', () => void this.onForeground());
    // The floating tasbih counter hides while the app itself is on screen.
    await App.addListener('pause', () => void AthkarOverlay.setAppVisible({ visible: false }));
    await AthkarOverlay.addListener('launchRoute', ({ route }) => this.openRoute(route));
  }

  private async onForeground(): Promise<void> {
    try {
      await AthkarOverlay.setAppVisible({ visible: true });
      await this.floating.sync();
      const synced = await this.overlay.syncCounters();
      if (synced) this.progress.version.update((v) => v + 1);
      await this.overlay.refreshStatus();
      await this.prayer.reschedule();
      await this.athan.reschedule();
      // Content or custom athkar may have changed while the service kept an older pool.
      if (this.overlay.overlay().enabled) await this.overlay.syncPool();
      const { route } = await AthkarOverlay.consumeLaunchRoute();
      if (route) this.openRoute(route);
    } catch (e) {
      console.warn('[lifecycle] foreground sync failed', e);
    }
    this.resumed.update((v) => v + 1);
  }

  private openRoute(route: string): void {
    // Only in-app routes; never anything that looks like a URL.
    if (/^\/[a-z0-9\-/]*$/i.test(route)) void this.nav.navigateRoot(route);
  }
}
