import { Component, computed, inject, signal } from '@angular/core';
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
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonButton,
  IonIcon,
} from '@ionic/angular';
import {
  AyahMark,
  MARK_COLORS,
  MarkColor,
  MarksService,
  QuranBookmark,
} from '../../core/quran/marks.service';
import { QuranService } from '../../core/quran/quran.service';
import { AyahRef } from '../../core/quran/quran-utils';
@Component({
  selector: 'app-quran-marks',
  standalone: true,
  imports: [
    TranslatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonButton,
    IonIcon,
  ],
  templateUrl: './quran-marks.page.html',
  styleUrl: './quran-marks.page.scss',
})
export class QuranMarksPage {
  readonly service = inject(MarksService);
  readonly quran = inject(QuranService);
  readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  readonly ready = signal(false);
  readonly error = signal('');
  readonly segment = signal('bookmarks');
  readonly color = signal<MarkColor | null>(null);
  readonly tag = signal<string | null>(null);
  readonly colors = MARK_COLORS;
  readonly segments = ['bookmarks', 'starred', 'highlights', 'notes'];
  readonly visible = computed(() =>
    this.service
      .marks()
      .filter(
        (m) =>
          m.kind ===
            ({ starred: 'star', highlights: 'highlight', notes: 'note' } as Record<string, string>)[
              this.segment()
            ] &&
          (m.kind !== 'highlight' ||
            ((!this.color() || m.color === this.color()) && (!this.tag() || m.tag === this.tag()))),
      ),
  );
  async ionViewWillEnter(): Promise<void> {
    try {
      await Promise.all([this.service.load(), this.quran.load()]);
      this.ready.set(true);
    } catch {
      this.error.set('marks.error');
    }
  }
  sura(ref: AyahRef): string {
    const s = this.quran.sura(ref.sura);
    return this.translate.getCurrentLang() === 'ar' ? s.name : s.ename;
  }
  hex(color?: MarkColor): string {
    return this.colors.find((c) => c.id === color)?.hex ?? 'var(--ion-color-primary)';
  }
  open(ref: AyahRef, page = this.quran.pageOf(ref)): void {
    void this.router.navigate(['/mushaf', page], { queryParams: { sura: ref.sura, aya: ref.aya } });
  }
  async removeBookmark(b: QuranBookmark): Promise<void> {
    try {
      await this.service.deleteBookmark(b.id);
    } catch {
      this.error.set('marks.error');
    }
  }
  async removeMark(m: AyahMark): Promise<void> {
    try {
      if (m.kind === 'star') await this.service.toggleStar(m);
      else if (m.kind === 'highlight') await this.service.setHighlight(m, null);
      else await this.service.setNote(m, null);
    } catch {
      this.error.set('marks.error');
    }
  }
  async edit(b: QuranBookmark): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('marks.edit'),
      inputs: [
        {
          name: 'name',
          type: 'text',
          value: b.name,
          placeholder: this.translate.instant('marks.name'),
        },
      ],
      buttons: [
        { text: this.translate.instant('marks.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('marks.save'),
          handler: (data: { name: string }) => {
            void this.saveName(b, data.name);
          },
        },
        {
          text: this.translate.instant('marks.colour'),
          handler: () => {
            void this.editColor(b);
          },
        },
      ],
    });
    await alert.present();
  }
  private async saveName(b: QuranBookmark, name: string): Promise<void> {
    try {
      await this.service.updateBookmark(b.id, { name: name.trim() || b.name });
    } catch {
      this.error.set('marks.error');
    }
  }
  private async editColor(b: QuranBookmark): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('marks.colour'),
      inputs: this.colors.map((c) => ({
        type: 'radio' as const,
        label: this.translate.instant('marks.' + c.id),
        value: c.id,
        checked: c.id === b.color,
      })),
      buttons: [
        { text: this.translate.instant('marks.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('marks.save'),
          handler: (color: MarkColor) => {
            void this.service
              .updateBookmark(b.id, { color })
              .catch(() => this.error.set('marks.error'));
          },
        },
      ],
    });
    await alert.present();
  }
}
