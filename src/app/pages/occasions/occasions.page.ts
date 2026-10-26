import { Component, computed, inject } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonTitle, IonToolbar,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { intlLocale } from '../../core/models';
import { DatedOccasion, daysBetween, formatHijri, upcomingOccasions } from '../../core/prayer/islamic-calendar';
import { PrayerService } from '../../core/prayer/prayer.service';
import { SettingsService } from '../../core/services/settings.service';

/** Occasions of the coming Hijri year, and the adjustment of the Hijri date to the local moon sighting. */
@Component({
  selector: 'app-occasions',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel, IonNote, IonButton, IonIcon],
  templateUrl: './occasions.page.html',
  styleUrl: './occasions.page.scss',
})
export class OccasionsPage {
  private readonly prayer = inject(PrayerService);
  private readonly settings = inject(SettingsService);
  readonly lang = computed(() => this.settings.settings().language);
  readonly offset = computed(() => this.prayer.prayer().hijriOffset ?? 0);
  readonly todayHijri = computed(() => formatHijri(this.prayer.now(), this.offset(), this.lang()));
  readonly occasions = computed(() => upcomingOccasions(this.prayer.now(), this.offset(), 365));

  async setOffset(delta: number): Promise<void> {
    const hijriOffset = Math.max(-2, Math.min(2, this.offset() + delta));
    if (hijriOffset !== this.offset()) await this.prayer.updatePrayer({ hijriOffset });
  }

  offsetLabel(): string {
    const n = this.offset();
    return (n > 0 ? '+' : '') + new Intl.NumberFormat(intlLocale(this.lang())).format(n);
  }

  hijri(o: DatedOccasion): string {
    return formatHijri(o.date, this.offset(), this.lang(), { day: 'numeric', month: 'long' });
  }

  gregorian(o: DatedOccasion): string {
    return new Intl.DateTimeFormat(intlLocale(this.lang()), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(o.date);
  }

  days(o: DatedOccasion): number {
    return daysBetween(this.prayer.now(), o.date);
  }
}
