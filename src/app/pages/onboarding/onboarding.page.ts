import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { App } from '@capacitor/app';
import { PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { IonContent, IonIcon, NavController } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { PrayerService } from '../../core/prayer/prayer.service';
import { City, LocationService, countryName, searchCities } from '../../core/prayer/location.service';
import { AppearanceService } from '../../core/services/appearance.service';
import { OverlayService } from '../../core/services/overlay.service';
import { SettingsService } from '../../core/services/settings.service';
import { AthkarOverlay } from '../../native/athkar-overlay';

type Permission = 'notifications' | 'overlay' | 'battery' | 'location';
type Feature = 'overlay' | 'daily' | 'sleep' | 'friday';

@Component({
  selector: 'app-onboarding',
  imports: [TranslatePipe, IonContent, IonIcon],
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
})
export class OnboardingPage implements OnInit, OnDestroy {
  readonly settings = inject(SettingsService);
  private readonly appearance = inject(AppearanceService);
  private readonly overlayService = inject(OverlayService);
  private readonly prayerService = inject(PrayerService);
  private readonly locationService = inject(LocationService);
  private readonly nav = inject(NavController);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  readonly step = signal(1);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly features = signal({ overlay: false, daily: false, sleep: false, friday: false });
  readonly featureKeys: Feature[] = ['overlay', 'daily', 'sleep', 'friday'];
  readonly completed = signal<Permission[]>([]);
  readonly sdk = signal(0);
  readonly manufacturer = signal('');
  readonly notifications = signal(false);
  readonly overlayGranted = signal(false);
  readonly battery = signal(false);
  readonly picker = signal(false);
  readonly cities = signal<City[]>([]);
  readonly query = signal('');
  readonly filteredCities = computed(() => {
    return searchCities(this.cities(), this.query(), this.settings.settings().language);
  });
  readonly permission = computed<Permission | undefined>(() => {
    const f = this.features();
    const queue: Permission[] = [];
    if (this.sdk() >= 33) queue.push('notifications');
    if (f.overlay) queue.push('overlay');
    if (f.overlay || f.daily || f.sleep || f.friday) queue.push('battery');
    if (f.daily) queue.push('location');
    return queue.find(p => !this.completed().includes(p));
  });
  readonly manufacturerTip = computed(() => {
    const m = this.manufacturer().toLowerCase();
    return /xiaomi|redmi|poco/.test(m) ? 'xiaomi' : /samsung/.test(m) ? 'samsung' : /oppo|realme|oneplus/.test(m) ? 'oppo' : 'other';
  });
  private listener?: PluginListenerHandle;
  private destroyed = false;
  private pendingOverlay = false;

  async ngOnInit(): Promise<void> {
    await this.run(async () => {
      const stored = await Preferences.get({ key: 'onboardingStep' });
      const step = Number(stored.value);
      if (step >= 1 && step <= 3 && Number.isInteger(step)) this.step.set(step);
      const r = this.prayerService.reminders();
      this.features.set({ overlay: this.overlayService.overlay().enabled, daily: r.morning.enabled || r.evening.enabled,
        sleep: r.sleep.enabled, friday: r.fridayKahf.enabled || r.fridaySalawat.enabled });
      const info = await AthkarOverlay.getDeviceInfo();
      this.sdk.set(info.sdkInt);
      this.manufacturer.set(info.manufacturer);
      await this.refreshPermissions();
      const listener = await App.addListener('resume', () => { void this.run(async () => {
        await this.refreshPermissions();
        if (this.pendingOverlay && this.overlayGranted()) {
          this.pendingOverlay = false;
          await this.enableOverlay();
        }
      }); });
      if (this.destroyed) await listener.remove(); else this.listener = listener;
    });
    this.ready.set(true);
    this.focusHeading();
  }

  ngOnDestroy(): void { this.destroyed = true; void this.listener?.remove(); }

  private async refreshPermissions(): Promise<void> {
    const [n, o, b] = await Promise.all([AthkarOverlay.checkNotificationPermission(),
      AthkarOverlay.checkOverlayPermission(), AthkarOverlay.isIgnoringBatteryOptimizations()]);
    this.notifications.set(n.granted); this.overlayGranted.set(o.granted); this.battery.set(b.ignoring);
  }

  async language(lang: 'ar' | 'en'): Promise<void> {
    await this.run(async () => {
      await Preferences.set({ key: 'onboardingStep', value: String(this.step()) });
      await this.appearance.setLanguage(lang);
    });
  }

  toggle(key: Feature, event: Event): void {
    this.features.update(f => ({ ...f, [key]: (event.target as HTMLInputElement).checked }));
  }

  private async saveFeatures(): Promise<void> {
    const f = this.features();
    const r = this.prayerService.reminders();
    await this.prayerService.updateReminders({
      morning: { ...r.morning, enabled: f.daily }, evening: { ...r.evening, enabled: f.daily },
      sleep: { ...r.sleep, enabled: f.sleep }, fridayKahf: { ...r.fridayKahf, enabled: f.friday },
      fridaySalawat: { ...r.fridaySalawat, enabled: f.friday },
    });
    if (!f.overlay && this.overlayService.overlay().enabled) await this.overlayService.disable();
  }

  async move(step: number): Promise<void> {
    await Preferences.set({ key: 'onboardingStep', value: String(step) });
    this.step.set(step); this.error.set(false); this.picker.set(false); this.focusHeading();
  }

  async next(): Promise<void> {
    await this.run(async () => {
      if (this.step() === 1) await this.move(2);
      else if (this.step() === 2) { await this.saveFeatures(); this.completed.set([]); await this.move(3); }
      else if (this.permission()) this.advancePermission();
      else await this.finish();
    });
  }

  async back(): Promise<void> {
    await this.run(async () => { this.pendingOverlay = false; await this.move(this.step() - 1); });
  }

  async skip(): Promise<void> {
    await this.run(async () => { await this.saveFeatures(); await this.finish(); });
  }

  private advancePermission(): void {
    const p = this.permission();
    if (p) this.completed.update(list => [...list, p]);
    this.pendingOverlay = false; this.picker.set(false); this.focusHeading();
  }

  async allow(): Promise<void> {
    await this.run(async () => {
      switch (this.permission()) {
        case 'notifications':
          this.notifications.set((await AthkarOverlay.requestNotificationPermission()).granted);
          if (this.notifications()) this.advancePermission();
          break;
        case 'overlay':
          if ((await AthkarOverlay.checkOverlayPermission()).granted) await this.enableOverlay();
          else { this.pendingOverlay = true; await AthkarOverlay.requestOverlayPermission(); }
          break;
        case 'battery':
          if (this.battery()) this.advancePermission();
          else await AthkarOverlay.openBatteryOptimizationSettings();
          break;
        case 'location': {
          if (await this.locationService.locateAndSave()) this.advancePermission();
          break;
        }
      }
    });
  }

  private async enableOverlay(): Promise<void> {
    const result = await this.overlayService.enable();
    if (!result.started) throw new Error('Overlay did not start');
    if (this.permission() === 'overlay') this.advancePermission();
  }

  async chooseCity(): Promise<void> {
    await this.run(async () => {
      if (!this.cities().length) this.cities.set(await this.locationService.loadCities());
      this.picker.set(true);
    });
  }

  country(city: City): string {
    return countryName(city.country, this.settings.settings().language);
  }

  async selectCity(city: City): Promise<void> {
    await this.run(async () => {
      await this.prayerService.updatePrayer({ location: { latitude: round2(city.lat), longitude: round2(city.lng), name: city.ar + '|' + city.en, source: 'manual' }, method: city.method });
      this.advancePermission();
    });
  }

  private async finish(): Promise<void> {
    await this.prayerService.reschedule();
    await this.settings.update({ onboardingDone: true });
    await Preferences.remove({ key: 'onboardingStep' });
    await this.nav.navigateRoot('/home');
  }

  private focusHeading(): void {
    setTimeout(() => { if (!this.destroyed) this.heading()?.nativeElement.focus(); });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(false);
    try { await action(); } catch { this.error.set(true); } finally { this.busy.set(false); }
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
