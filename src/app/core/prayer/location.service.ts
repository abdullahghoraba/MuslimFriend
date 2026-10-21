import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { AthkarOverlay } from '../../native/athkar-overlay';
import { MethodId } from './prayer-times';
import { PrayerService } from './prayer.service';

export interface City { id: string; ar: string; en: string; country: string; lat: number; lng: number; method: MethodId }

/** Within this distance the nearest listed city names the place ("near Cairo") and sets the method. */
const NEAR_KM = 150;
/** The calculation method of the nearest listed city is still a good regional guess up to this distance. */
const REGION_KM = 1500;

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function nearestCity(cities: City[], lat: number, lng: number): { city: City; km: number } | null {
  let best: { city: City; km: number } | null = null;
  for (const city of cities) {
    const km = distanceKm(lat, lng, city.lat, city.lng);
    if (!best || km < best.km) best = { city, km };
  }
  return best;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * "Locate me": reads the phone's position (works anywhere in the world, no city list needed), then uses the
 * nearest listed city only to name the place and choose the usual calculation method for the region.
 */
@Injectable({ providedIn: 'root' })
export class LocationService {
  private readonly http = inject(HttpClient);
  private readonly prayer = inject(PrayerService);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private cities?: City[];

  async loadCities(): Promise<City[]> {
    this.cities ??= await firstValueFrom(this.http.get<City[]>('assets/data/cities.json'));
    return this.cities;
  }

  /** Locates the phone and saves it as the prayer-time location. Returns false (after telling the user) on failure. */
  async locateAndSave(): Promise<boolean> {
    let pos: { latitude: number; longitude: number };
    try {
      pos = await AthkarOverlay.getApproximateLocation();
    } catch (e) {
      await this.explainFailure(e);
      return false;
    }
    const near = nearestCity(await this.loadCities().catch(() => []), pos.latitude, pos.longitude);
    const name = near && near.km <= NEAR_KM
      ? `${this.translate.instant('location.nearAr', { city: near.city.ar })}|${this.translate.instant('location.nearEn', { city: near.city.en })}`
      : '';
    await this.prayer.updatePrayer({
      location: { latitude: round2(pos.latitude), longitude: round2(pos.longitude), name, source: 'auto' },
      ...(near && near.km <= REGION_KM ? { method: near.city.method } : {}),
    });
    return true;
  }

  private async explainFailure(e: unknown): Promise<void> {
    const code = (e as { code?: string })?.code ?? (e instanceof Error ? e.message : '');
    const off = code === 'OFF';
    const alert = await this.alerts.create({
      header: this.translate.instant(off ? 'location.offTitle' : 'location.failedTitle'),
      message: this.translate.instant(code === 'DENIED' ? 'location.denied' : off ? 'location.off' : 'location.failed'),
      buttons: [
        { text: this.translate.instant('common.close'), role: 'cancel' },
        ...(off ? [{ text: this.translate.instant('location.openSettings'), handler: () => void AthkarOverlay.openLocationSettings() }] : []),
      ],
    });
    await alert.present();
  }
}
