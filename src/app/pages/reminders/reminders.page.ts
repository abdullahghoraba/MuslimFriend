import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToggle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { METHOD_IDS, MethodId, PRAYER_NAMES, PrayerName, ReminderSettings } from '../../core/prayer/prayer-times';
import { PrayerService } from '../../core/prayer/prayer.service';
import { City, LocationService, countryName, searchCities } from '../../core/prayer/location.service';
import { SettingsService } from '../../core/services/settings.service';
import { AthkarOverlay } from '../../native/athkar-overlay';

@Component({
  selector: 'app-reminders',
  imports: [
    RouterLink, FormsModule, TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList,
    IonListHeader, IonItem, IonLabel, IonNote, IonToggle, IonSelect, IonSelectOption, IonSegment, IonSegmentButton,
    IonButton, IonIcon, IonModal, IonSearchbar, IonInput,
  ],
  templateUrl: './reminders.page.html',
  styleUrl: './reminders.page.scss',
})
export class RemindersPage {
  private readonly prayerService = inject(PrayerService);
  private readonly locationService = inject(LocationService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastController);
  private readonly translate = inject(TranslateService);

  readonly prayer = this.prayerService.prayer;
  readonly reminders = this.prayerService.reminders;
  readonly today = this.prayerService.today;
  readonly methods = METHOD_IDS;
  readonly prayerNames = PRAYER_NAMES;
  readonly offsets = [0, 5, 10, 15, 20, 30, 45, 60, 90];
  readonly lang = computed(() => this.settings.settings().language);

  readonly cities = signal<City[]>([]);
  readonly cityQuery = signal('');
  readonly cityPickerOpen = signal(false);
  readonly locating = signal(false);
  readonly notificationsGranted = signal(true);
  readonly filteredCities = computed(() => {
    return searchCities(this.cities(), this.cityQuery(), this.lang());
  });

  async ionViewWillEnter(): Promise<void> {
    await this.prayerService.load();
    this.notificationsGranted.set((await AthkarOverlay.checkNotificationPermission()).granted);
    if (!this.cities().length) {
      this.cities.set(await this.locationService.loadCities());
    }
  }

  time(d: Date | undefined): string {
    if (!d) return '—';
    return new Intl.DateTimeFormat(this.lang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { hour: 'numeric', minute: '2-digit' }).format(d);
  }

  cityName(c: City): string {
    return this.lang() === 'ar' ? c.ar : c.en;
  }

  country(c: City): string {
    return countryName(c.country, this.lang());
  }

  async chooseCity(c: City): Promise<void> {
    this.cityPickerOpen.set(false);
    await this.prayerService.updatePrayer({
      location: { latitude: c.lat, longitude: c.lng, name: `${c.ar}|${c.en}`, source: 'manual' },
      method: c.method,
    });
  }

  locationLabel(): string {
    const loc = this.prayer().location;
    if (!loc) return this.translate.instant('reminders.noLocation');
    if (!loc.name) {
      return this.translate.instant('reminders.approxLocation', { lat: loc.latitude.toFixed(2), lng: loc.longitude.toFixed(2) });
    }
    const [ar, en] = loc.name.split('|');
    return this.lang() === 'ar' ? ar : en ?? ar;
  }

  /** "Locate me": the location permission is requested only now, on the user's tap. */
  async useApproximateLocation(): Promise<void> {
    this.locating.set(true);
    try {
      await this.locationService.locateAndSave();
    } finally {
      this.locating.set(false);
    }
  }

  async setMethod(method: MethodId): Promise<void> {
    await this.prayerService.updatePrayer({ method });
  }

  async setMadhab(value: unknown): Promise<void> {
    if (value === 'shafi' || value === 'hanafi') await this.prayerService.updatePrayer({ madhab: value });
  }

  async adjust(name: PrayerName, delta: number): Promise<void> {
    const current = this.prayer().adjustments;
    const next = Math.max(-30, Math.min(30, current[name] + delta));
    await this.prayerService.updatePrayer({ adjustments: { ...current, [name]: next } });
  }

  async patch<K extends keyof ReminderSettings>(key: K, value: Partial<ReminderSettings[K]>): Promise<void> {
    await this.prayerService.updateReminders({ [key]: { ...this.reminders()[key], ...value } } as Partial<ReminderSettings>);
  }

  async enableNotifications(): Promise<void> {
    const { granted } = await AthkarOverlay.requestNotificationPermission();
    this.notificationsGranted.set(granted);
    if (!granted) await AthkarOverlay.openAppSettings();
  }
}

/** Two decimals ≈ 1 km: enough for prayer times, and nothing more precise is ever stored. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
