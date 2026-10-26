import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonSearchbar,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { City, LocationService, citiesIn, countriesOf, searchCountries } from '../core/prayer/location.service';
import { SettingsService } from '../core/services/settings.service';

/**
 * Picks a city in two steps: the country first, then one of its cities. Dismisses with the City as data
 * (or nothing when cancelled).
 */
@Component({
  selector: 'app-city-picker',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonSearchbar, IonList, IonItem, IonLabel, IonSpinner],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          @if (country(); as c) {
            <ion-button (click)="back()">{{ 'location.countries' | translate }}</ion-button>
          } @else {
            <ion-button (click)="close()">{{ 'common.cancel' | translate }}</ion-button>
          }
        </ion-buttons>
        <ion-title>{{ country()?.name ?? ('location.chooseCountry' | translate) }}</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          [placeholder]="(country() ? 'reminders.searchCity' : 'location.searchCountry') | translate"
          [value]="query()"
          (ionInput)="query.set($event.detail.value ?? '')"
        />
      </ion-toolbar>
    </ion-header>
    <ion-content>
      @if (!cities().length) {
        <div class="loading"><ion-spinner /></div>
      } @else if (country(); as c) {
        <ion-list>
          @for (city of cityList(); track city.id) {
            <ion-item button [detail]="false" (click)="close(city)"><ion-label>{{ lang() === 'ar' ? city.ar : city.en }}</ion-label></ion-item>
          } @empty {
            <ion-item><ion-label>{{ 'onboarding.noCities' | translate }}</ion-label></ion-item>
          }
        </ion-list>
      } @else {
        <ion-list>
          @for (c of countryList(); track c.code) {
            <ion-item button (click)="pick(c)"><ion-label>{{ c.name }}</ion-label></ion-item>
          }
        </ion-list>
      }
    </ion-content>
  `,
  styles: [`.loading { display: flex; justify-content: center; padding-top: 30vh; }`],
})
export class CityPickerComponent implements OnInit {
  private readonly modal = inject(ModalController);
  private readonly location = inject(LocationService);
  private readonly settings = inject(SettingsService);

  readonly lang = computed(() => this.settings.settings().language);
  readonly cities = signal<City[]>([]);
  readonly country = signal<{ code: string; name: string } | null>(null);
  readonly query = signal('');
  private readonly countries = computed(() => countriesOf(this.cities(), this.lang()));
  readonly countryList = computed(() => searchCountries(this.countries(), this.query()));
  readonly cityList = computed(() => {
    const c = this.country();
    return c ? citiesIn(this.cities(), c.code, this.query()) : [];
  });

  async ngOnInit(): Promise<void> {
    this.cities.set(await this.location.loadCities());
  }

  pick(country: { code: string; name: string }): void {
    this.country.set(country);
    this.query.set('');
  }

  back(): void {
    this.country.set(null);
    this.query.set('');
  }

  close(city?: City): void {
    void this.modal.dismiss(city);
  }
}

/** Opens the picker and resolves with the chosen city, or undefined when the user cancels. */
export async function pickCity(modals: ModalController): Promise<City | undefined> {
  const modal = await modals.create({ component: CityPickerComponent });
  await modal.present();
  return (await modal.onDidDismiss<City>()).data;
}
