import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  AlertController,
  IonHeader,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonTitle,
  IonContent,
  IonButton,
  IonModal,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonToggle,
  IonProgressBar,
} from '@ionic/angular';
import { HifzPlan, HifzPlanInput, HifzService } from '../../core/quran/hifz.service';
import { MARK_COLORS } from '../../core/quran/marks.service';
import { QuranService } from '../../core/quran/quran.service';
import { AyahRef } from '../../core/quran/quran-utils';
import { PrayerService } from '../../core/prayer/prayer.service';
@Component({
  selector: 'app-hifz',
  standalone: true,
  imports: [
    FormsModule,
    TranslatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonButton,
    IonModal,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonToggle,
    IonProgressBar,
  ],
  templateUrl: './hifz.page.html',
  styleUrl: './hifz.page.scss',
})
export class HifzPage {
  readonly service = inject(HifzService);
  readonly quran = inject(QuranService);
  readonly prayer = inject(PrayerService);
  readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  readonly colors = MARK_COLORS;
  readonly quotas = [1, 3, 5, 10, 15, 20];
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly sheet = signal(false);
  editing: number | null = null;
  draft: HifzPlanInput = {
    name: '',
    color: 'green',
    from: { sura: 1, aya: 1 },
    to: { sura: 114, aya: 6 },
    dailyNew: 5,
    followUp: true,
  };
  async ionViewWillEnter(): Promise<void> {
    await this.run(async () => {
      await this.service.load();
      this.ready.set(true);
    });
  }
  async run(work: () => Promise<unknown>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await work();
    } catch {
      this.error.set('hifz.error');
    } finally {
      this.busy.set(false);
    }
  }
  number(n: number): string {
    return String(n);
  }
  suraName(n: number): string {
    const s = this.quran.sura(n);
    return this.translate.getCurrentLang() === 'ar' ? s.name : s.tname;
  }
  ref(r: AyahRef): string {
    return this.suraName(r.sura) + ' ' + this.number(r.aya);
  }
  range(p: { from: AyahRef; to: AyahRef }): string {
    return this.translate.instant('hifz.range', { from: this.ref(p.from), to: this.ref(p.to) });
  }
  portion(refs: AyahRef[]): string {
    return refs.length
      ? this.range({ from: refs[0], to: refs[refs.length - 1] })
      : this.translate.instant('hifz.none');
  }
  ayas(sura: number): number[] {
    return Array.from({ length: this.quran.sura(sura).ayas }, (_, i) => i + 1);
  }
  color(id: string): string {
    return this.colors.find((c) => c.id === id)?.hex ?? '';
  }
  open(p?: HifzPlan): void {
    this.editing = p?.id ?? null;
    this.draft = p
      ? { ...p, from: { ...p.from }, to: { ...p.to } }
      : {
          name: '',
          color: 'green',
          from: { sura: 1, aya: 1 },
          to: { sura: this.quran.suras.length, aya: this.quran.suras.at(-1)!.ayas },
          dailyNew: 5,
          followUp: true,
        };
    this.sheet.set(true);
  }
  save(): Promise<void> {
    return this.run(async () => {
      if (this.editing === null) await this.service.create(this.draft);
      else await this.service.update(this.editing, this.draft);
      this.sheet.set(false);
    });
  }
  /** Opens today's portion in the mushaf; [repeat] then asks how many times to repeat each ayah. */
  start(p: HifzPlan, repeat = false): void {
    const r = this.service.today(p.id).newPortion[0];
    if (r)
      void this.router.navigate(['/mushaf', this.quran.pageOf(r)], {
        queryParams: { sura: r.sura, aya: r.aya, hifz: p.id, ...(repeat ? { repeat: 1 } : {}) },
      });
  }
  memorize(p: HifzPlan): Promise<void> {
    return this.run(() =>
      this.service.markRange(p.id, this.service.today(p.id).newPortion, 'memorized'),
    );
  }
  review(p: HifzPlan, result: 'good' | 'hard'): Promise<void> {
    return this.run(() => this.service.review(p.id, this.service.today(p.id).due, result));
  }
  async confirm(p: HifzPlan, action: 'archive' | 'delete'): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('hifz.' + action),
      message: this.translate.instant('hifz.confirm', { name: p.name }),
      buttons: [
        { text: this.translate.instant('hifz.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('hifz.' + action),
          role: 'destructive',
          handler: () => {
            void this.run(() =>
              action === 'delete' ? this.service.delete(p.id) : this.service.archive(p.id),
            );
          },
        },
      ],
    });
    await alert.present();
  }
  reminder(enabled: boolean, time = this.prayer.reminders().hifz.time): Promise<void> {
    return this.run(() => this.prayer.updateReminders({ hifz: { enabled, time } }));
  }
}
