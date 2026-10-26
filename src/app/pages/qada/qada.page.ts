import { Component, computed, inject } from '@angular/core';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonListHeader,
  IonTitle, IonToggle, IonToolbar,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { intlLocale } from '../../core/models';
import { PrayerService } from '../../core/prayer/prayer.service';
import { QADA_MAX, QADA_PRAYERS, QadaPrayer, QadaService } from '../../core/prayer/qada.service';
import { ReminderSettings } from '../../core/prayer/prayer-times';
import { SettingsService } from '../../core/services/settings.service';

/** Missed (qada) prayers: how many of each are owed, ticked off one by one, with an optional daily reminder. */
@Component({
  selector: 'app-qada',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel, IonButton, IonIcon, IonToggle, IonInput],
  templateUrl: './qada.page.html',
  styleUrl: './qada.page.scss',
})
export class QadaPage {
  readonly qada = inject(QadaService);
  private readonly prayer = inject(PrayerService);
  private readonly settings = inject(SettingsService);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);
  readonly prayers = QADA_PRAYERS;
  readonly reminder = computed(() => this.prayer.reminders().qada);
  private readonly fmt = computed(() => new Intl.NumberFormat(intlLocale(this.settings.settings().language)));

  number(n: number): string {
    return this.fmt().format(n);
  }

  async change(p: QadaPrayer, delta: number): Promise<void> {
    const before = this.qada.total();
    await this.qada.add(p, delta);
    // The daily reminder is only planned while prayers are owed, so re-plan when the total reaches or leaves 0.
    if ((before === 0) !== (this.qada.total() === 0)) await this.prayer.reschedule();
  }

  /** Types an exact count for one prayer. */
  async edit(p: QadaPrayer): Promise<void> {
    const t = (k: string, params?: Record<string, unknown>) => this.translate.instant(k, params);
    const alert = await this.alerts.create({
      header: t('prayer.' + p),
      inputs: [{ name: 'count', type: 'number', min: 0, max: QADA_MAX, value: this.qada.counts()[p] }],
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('common.save'), handler: (v: { count: string }) => { void this.setCount(p, Number(v.count)); } },
      ],
    });
    await alert.present();
  }

  /** Adds a number of whole days (all five prayers each), e.g. a period that was missed. */
  async addDays(): Promise<void> {
    const t = (k: string) => this.translate.instant(k);
    const alert = await this.alerts.create({
      header: t('qada.addDays'),
      message: t('qada.addDaysHint'),
      inputs: [{ name: 'days', type: 'number', min: 1, max: 3650, placeholder: t('qada.days') }],
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('common.add'), handler: (v: { days: string }) => { void this.addWholeDays(Number(v.days)); } },
      ],
    });
    await alert.present();
  }

  async patchReminder(patch: Partial<ReminderSettings['qada']>): Promise<void> {
    await this.prayer.updateReminders({ qada: { ...this.reminder(), ...patch } });
  }

  private async setCount(p: QadaPrayer, count: number): Promise<void> {
    if (!Number.isFinite(count)) return;
    await this.qada.set(p, count);
    await this.prayer.reschedule();
  }

  private async addWholeDays(days: number): Promise<void> {
    if (!Number.isFinite(days) || days <= 0) return;
    await this.qada.addDays(Math.min(3650, days));
    await this.prayer.reschedule();
  }
}
