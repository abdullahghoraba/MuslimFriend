import { Component, computed, inject, signal } from '@angular/core';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel, IonToggle, IonButton, IonSelect, IonSelectOption, IonRange, IonSegment, IonSegmentButton, IonCheckbox } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { OverlayService, OverlaySettings, FREQUENCY_OPTIONS, MAX_OVERLAY_TEXT_LENGTH } from '../../core/services/overlay.service';
import { AthkarRepository } from '../../core/services/athkar.repository';
import { SettingsService } from '../../core/services/settings.service';
import { AthkarOverlay } from '../../native/athkar-overlay';
import { SelectTextsDirective } from '../../shared/select-texts.directive';
import { Category } from '../../core/models';

@Component({
  selector: 'app-overlay',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel, IonToggle, IonButton, IonSelect, SelectTextsDirective, IonSelectOption, IonRange, IonSegment, IonSegmentButton, IonCheckbox],
  templateUrl: './overlay.page.html',
  styleUrl: './overlay.page.scss',
})
export class OverlayPage {
  readonly service = inject(OverlayService);
  private readonly repository = inject(AthkarRepository);
  private readonly settings = inject(SettingsService);
  readonly config = this.service.overlay;
  readonly language = computed(() => this.settings.settings().language);
  readonly categories = computed(() => {
    const builtIn = this.repository.categories().filter(c => c.id !== 'custom');
    const custom = this.repository.category('custom');
    return custom ? [...builtIn, custom] : builtIn;
  });
  categoryName(c: Category): string { return this.repository.nameIn(this.language(), c); }
  readonly frequencies = FREQUENCY_OPTIONS;
  readonly maxLength = MAX_OVERLAY_TEXT_LENGTH;
  readonly positions = ['top', 'center', 'bottom'] as const;
  readonly sizes = ['small', 'medium', 'large'] as const;
  readonly styles = ['system', 'light', 'dark'] as const;
  readonly busy = signal(false);
  readonly ready = signal(false);
  readonly needsPermission = signal(false);
  readonly notificationMissing = signal(false);
  readonly ignoringBattery = signal(false);
  readonly batteryTip = signal('generic');
  readonly error = signal('');
  readonly startFailed = signal(false);
  readonly now = signal(Date.now());
  readonly paused = computed(() => this.service.pausedUntil() > this.now());
  readonly pauseTime = computed(() => new Intl.DateTimeFormat(this.language() + '-u-nu-latn', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(this.service.pausedUntil()));
  private listener?: PluginListenerHandle;
  private active = false;
  private timer?: ReturnType<typeof setInterval>;

  async ionViewWillEnter(): Promise<void> {
    this.active = true;
    this.ready.set(false);
    await this.run(async () => {
      const listener = await App.addListener('resume', () => { void this.onResume(); });
      if (!this.active) { await listener.remove(); return; }
      this.listener = listener;
      await this.service.load();
      await this.refreshPermissions();
      this.ready.set(true);
    });
    if (this.active) this.timer = setInterval(() => this.now.set(Date.now()), 1000);
  }

  async ionViewWillLeave(): Promise<void> {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    await this.listener?.remove();
    this.listener = undefined;
  }

  private async refreshPermissions(): Promise<void> {
    const [overlay, notification, battery, device] = await Promise.all([
      AthkarOverlay.checkOverlayPermission(), AthkarOverlay.checkNotificationPermission(),
      AthkarOverlay.isIgnoringBatteryOptimizations(), AthkarOverlay.getDeviceInfo(),
    ]);
    this.needsPermission.set(!overlay.granted);
    this.notificationMissing.set(device.sdkInt >= 33 && !notification.granted);
    this.ignoringBattery.set(battery.ignoring);
    const maker = device.manufacturer.toLowerCase();
    this.batteryTip.set(/xiaomi|redmi|poco/.test(maker) ? 'xiaomi' : /samsung/.test(maker) ? 'samsung' : /oppo|realme|oneplus/.test(maker) ? 'oppo' : /huawei|honor/.test(maker) ? 'huawei' : 'generic');
  }

  private async onResume(): Promise<void> {
    if (!this.active) return;
    await this.run(async () => {
      await this.refreshPermissions();
      await this.service.refreshStatus();
      this.now.set(Date.now());
      // Starting a foreground service remains an explicit foreground button action.
    });
  }

  async toggle(enabled: boolean): Promise<void> {
    if (enabled) await this.enable();
    else await this.run(async () => { this.startFailed.set(false); await this.service.disable(); });
  }

  async enable(): Promise<void> {
    await this.run(async () => {
      await this.refreshPermissions();
      if (this.needsPermission()) return;
      if (this.notificationMissing()) {
        const result = await AthkarOverlay.requestNotificationPermission();
        this.notificationMissing.set(!result.granted);
      }
      const result = await this.service.enable();
      this.startFailed.set(!result.started);
    });
  }

  requestPermission(): Promise<void> { return this.run(() => AthkarOverlay.requestOverlayPermission()); }
  update(patch: Partial<OverlaySettings>): Promise<void> { return this.run(() => this.service.update(patch)); }
  select(field: 'position' | 'size' | 'style', value: unknown): void {
    const allowed = field === 'position' ? this.positions : field === 'size' ? this.sizes : this.styles;
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) void this.update({ [field]: value });
  }
  range(field: 'displaySeconds' | 'opacity', value: unknown): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    void this.update(field === 'opacity' ? { opacity: Math.min(100, Math.max(30, value)) / 100 } : { displaySeconds: Math.min(30, Math.max(3, Math.round(value))) });
  }
  category(id: string, checked: boolean): void {
    const ids = new Set(this.config().categories);
    if (checked) ids.add(id); else ids.delete(id);
    void this.update({ categories: [...ids] });
  }
  time(minutes: number): string { return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0'); }
  setTime(field: 'quietStart' | 'quietEnd', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return;
    const [hours, minutes] = value.split(':').map(Number);
    void this.update({ [field]: hours * 60 + minutes });
  }
  pauseHour(): Promise<void> { return this.run(() => this.service.pauseFor(3600000)); }
  pauseTomorrow(): Promise<void> { return this.run(() => this.service.pauseUntilTomorrow()); }
  resume(): Promise<void> { return this.run(() => this.service.resume()); }
  preview(): Promise<void> { return this.run(() => AthkarOverlay.preview()); }
  dismiss(): Promise<void> { return this.run(async () => { await this.service.acknowledgeFallback(); this.startFailed.set(false); }); }
  batterySettings(): Promise<void> { return this.run(async () => { const result = await AthkarOverlay.openBatteryOptimizationSettings(); if (!result.opened) this.error.set('overlay.settingsUnavailable'); }); }
  private async run(action: () => Promise<unknown>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try { await action(); } catch { this.error.set('overlay.error'); }
    finally { this.now.set(Date.now()); this.busy.set(false); }
  }
}
