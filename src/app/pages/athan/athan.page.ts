import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonRange,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToggle,
  IonToolbar,
  IonSpinner,
  AlertController,
  ToastController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ATHAN_PRAYERS,
  AthanPrayer,
  AthanService,
  AthanSettings,
  PrayerAthanSettings,
} from '../../core/prayer/athan.service';
import { SettingsService } from '../../core/services/settings.service';
import { AthanNative, AthanSound, AthanStopWay } from '../../native/athan-plugin';
import { AthkarOverlay } from '../../native/athkar-overlay';
import { LocationService } from '../../core/prayer/location.service';
import { ATHAN_RECORDINGS, BUILTIN_ATHAN } from '../../core/prayer/athan-sounds';

@Component({
  selector: 'app-athan',
  imports: [
    RouterLink,
    TranslatePipe,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonRange,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToggle,
    IonToolbar,
    IonSpinner,
  ],
  templateUrl: './athan.page.html',
  styleUrl: './athan.page.scss',
})
export class AthanPage implements OnDestroy {
  readonly athan = inject(AthanService);
  private readonly appSettings = inject(SettingsService);
  private readonly translate = inject(TranslateService);
  private readonly alerts = inject(AlertController);
  private readonly locationService = inject(LocationService);
  private readonly toastCtrl = inject(ToastController);
  readonly recordings = ATHAN_RECORDINGS;
  readonly builtin = BUILTIN_ATHAN;
  readonly locating = signal(false);
  readonly lang = computed(() => this.appSettings.settings().language);

  async locate(): Promise<void> {
    this.locating.set(true);
    try {
      await this.locationService.locateAndSave();
    } finally {
      this.locating.set(false);
    }
  }

  /** Downloaded recordings are named in the app language; files the user added keep their own name. */
  soundName(s: { name: string; recordingId?: string }): string {
    const rec = s.recordingId ? this.recordings.find((r) => r.id === s.recordingId || r.fajr?.id === s.recordingId) : undefined;
    if (!rec || s.name !== rec.nameAr) return s.name; // renamed by the user
    const name = this.lang() === 'ar' ? rec.nameAr : rec.nameEn;
    return rec.id === s.recordingId ? name : `${name} (${this.translate.instant('athan.prayers.fajr')})`;
  }

  usedForAll(sound: AthanSound): boolean {
    const fajr = this.athan.fajrSoundFor(sound);
    return this.prayers.every((p) => this.settings().perPrayer[p].sound === (p === 'fajr' ? fajr : sound));
  }

  useForAll(sound: AthanSound): void {
    void this.run(() => this.athan.useForAll(sound));
  }

  /** Downloads a recording (once); the first one becomes the athan for every prayer. */
  downloadRecording(id: string, useForAll = false): void {
    void this.run(async () => {
      try {
        await this.athan.downloadRecording(id, useForAll);
      } catch {
        const t = await this.toastCtrl.create({ message: this.translate.instant('athan.downloadFailed'), duration: 3000 });
        await t.present();
      }
    });
  }
  readonly settings = this.athan.settings;
  readonly prayers = ATHAN_PRAYERS;
  readonly before = [0, 5, 10, 15, 20, 30];
  readonly after = [0, 10, 15, 20, 25, 30];
  readonly silentOptions = [10, 15, 20, 30, 45];
  readonly native = Capacitor.isNativePlatform();
  readonly exactGranted = signal(true);
  readonly notificationsGranted = signal(true);
  readonly dndGranted = signal(true);
  readonly error = signal('');
  readonly importing = signal(false);
  private resume?: PluginListenerHandle;
  private active = false;
  private destroyed = false;
  private importPrayer?: AthanPrayer;
  async ionViewWillEnter(): Promise<void> {
    this.active = true;
    await this.run(async () => {
      await this.athan.load();
      await this.athan.reschedule();
      await this.refreshPermissions();
      if (this.native && !this.resume) {
        const handle = await App.addListener('resume', () => {
          if (this.active) void this.run(() => this.refreshPermissions());
        });
        if (this.destroyed) await handle.remove();
        else this.resume = handle;
      }
    });
  }
  ionViewWillLeave(): void {
    this.active = false;
    void this.run(() => this.athan.stopPreview());
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    void this.resume?.remove();
    void this.athan.stopPreview().catch(() => {});
  }
  async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set('');
    try {
      await action();
    } catch (e) {
      console.warn('[athan settings]', e);
      this.error.set(this.translate.instant('athan.error'));
    }
  }
  async refreshPermissions(): Promise<void> {
    if (!this.native) return;
    const [exact, dnd, notifications] = await Promise.all([
      AthanNative.canScheduleExactAlarms(),
      AthanNative.hasDndAccess(),
      AthkarOverlay.checkNotificationPermission(),
    ]);
    this.exactGranted.set(exact.granted);
    this.dndGranted.set(dnd.granted);
    this.notificationsGranted.set(notifications.granted);
  }
  exactSettings(): void {
    if (this.native) void this.run(() => AthanNative.openExactAlarmSettings());
  }
  dndSettings(): void {
    if (this.native) void this.run(() => AthanNative.openDndAccessSettings());
  }
  notifications(): void {
    if (this.native)
      void this.run(async () => {
        const r = await AthkarOverlay.requestNotificationPermission();
        this.notificationsGranted.set(r.granted);
        if (!r.granted) await AthkarOverlay.openAppSettings();
      });
  }
  update(patch: Partial<AthanSettings>): void {
    void this.run(() => this.athan.update(patch));
  }
  patch(prayer: AthanPrayer, patch: Partial<PrayerAthanSettings>): void {
    this.update({
      perPrayer: {
        ...this.settings().perPrayer,
        [prayer]: { ...this.settings().perPrayer[prayer], ...patch },
      },
    });
  }
  mode(prayer: AthanPrayer, value: unknown): void {
    if (value === 'athan' || value === 'notify' || value === 'off')
      this.patch(prayer, { mode: value });
  }
  sound(prayer: AthanPrayer, value: unknown, input: HTMLInputElement, select: IonSelect): void {
    if (value === 'add') {
      select.value = this.settings().perPrayer[prayer].sound;
      this.importPrayer = prayer;
      input.click();
      return;
    }
    if (
      typeof value === 'string' &&
      (value === 'athan' ||
        value === 'tone' ||
        value === 'system' ||
        value === 'none' ||
        this.settings().customSounds.some((s) => 'file:' + s.path === value))
    )
      this.patch(prayer, { sound: value as AthanSound });
  }
  async filePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importing.set(true);
    await this.run(async () => {
      const sound = await this.athan.importSound(file);
      if (this.importPrayer)
        await this.athan.update({
          perPrayer: {
            ...this.settings().perPrayer,
            [this.importPrayer]: { ...this.settings().perPrayer[this.importPrayer], sound },
          },
        });
    });
    this.importing.set(false);
  }
  /** The shared mode when every prayer uses the same one, otherwise undefined (no segment selected). */
  readonly allMode = computed(() => {
    const modes = new Set(this.prayers.map((p) => this.settings().perPrayer[p].mode));
    return modes.size === 1 ? [...modes][0] : undefined;
  });
  setAllModes(value: unknown): void {
    if (value !== 'athan' && value !== 'notify' && value !== 'off') return;
    if (this.allMode() === value) return;
    this.update({
      perPrayer: Object.fromEntries(
        this.prayers.map((p) => [p, { ...this.settings().perPrayer[p], mode: value }]),
      ) as AthanSettings['perPrayer'],
    });
  }
  stopOn(way: AthanStopWay, on: boolean): void {
    this.update({ stopOn: { ...this.settings().stopOn, [way]: on } });
  }
  async rename(path: string, current: string): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('athan.rename'),
      inputs: [{ name: 'name', value: current, attributes: { maxlength: 60 } }],
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        { text: this.translate.instant('common.save'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: { name: string } }>();
    const name = data?.values?.name?.trim();
    if (role !== 'confirm' || !name) return;
    this.update({ customSounds: this.settings().customSounds.map((s) => (s.path === path ? { ...s, name } : s)) });
  }
  applyAll(): void {
    const source = this.settings().perPrayer.fajr;
    this.update({
      perPrayer: Object.fromEntries(
        this.prayers.map((p) => [p, { ...source }]),
      ) as AthanSettings['perPrayer'],
    });
  }
  preview(sound: AthanSound): void {
    void this.run(() => this.athan.preview(sound));
  }
  stop(): void {
    void this.run(() => this.athan.stopPreview());
  }
  remove(path: string): void {
    void this.run(() => this.athan.removeSound(path));
  }
  minutes(value: number): string {
    return value === 0
      ? this.translate.instant('athan.off')
      : this.translate.instant(value >= 3 && value <= 10 ? 'athan.minutesFew' : 'athan.minutes', {
          count: new Intl.NumberFormat(this.appSettings.settings().language + '-u-nu-latn').format(value),
        });
  }
  time(at: Date): string {
    return new Intl.DateTimeFormat(this.appSettings.settings().language + '-u-nu-latn', {
      hour: 'numeric',
      minute: '2-digit',
      weekday: 'short',
    }).format(at);
  }
}
