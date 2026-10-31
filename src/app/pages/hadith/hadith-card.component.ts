import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActionSheetController, AlertController, IonBadge, IonButton, IonIcon, ModalController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Hadith, gradeColor, gradeKind, hadithLink, sourceGradeKind } from '../../core/hadith/hadith.models';
import { HadithBookmarksService } from '../../core/hadith/hadith-bookmarks.service';
import { SettingsService } from '../../core/services/settings.service';
import { ShareService } from '../../core/services/share.service';

@Component({
  selector: 'app-hadith-card',
  imports: [RouterLink, TranslatePipe, IonBadge, IonButton, IonIcon],
  template: `
    <article class="card" [attr.aria-label]="reference()" [class.focused]="focused()">
      @if (heading()) { <h2>{{ heading() | translate }}</h2> }
      <p class="reference">{{ reference() }}</p>
      <div class="grades">
        @for (g of hadith().grades; track $index) {
          <ion-badge [color]="color(g.grade)" [attr.aria-label]="g.grade + ' · ' + g.name">{{ 'hadith.grades.' + kind(g.grade) | translate }}@if (g.name) { · <bdi>{{ g.name }}</bdi>}</ion-badge>
        } @empty { <ion-badge [color]="sourceColor()">{{ 'hadith.grades.' + sourceKind() | translate }}</ion-badge> }
      </div>
      <p class="arabic" lang="ar" dir="rtl">{{ hadith().arabic }}</p>
      @if (hadith().translation) {
        @if (hadith().translationLang !== lang()) { <p class="muted">{{ 'hadith.fallback' | translate }}</p> }
        <p class="translation" [attr.lang]="hadith().translationLang" dir="auto">{{ hadith().translation }}</p>
      }
      <ion-button class="ruling-button" fill="outline" expand="block" (click)="ruling()">{{ 'hadith.rulingQuestion' | translate }}</ion-button>
      <div class="actions">
        @if (showRead() && hadith().collection !== 'dorar') { <ion-button fill="clear" [routerLink]="link(hadith())">{{ 'hadith.read' | translate }}</ion-button> }
        <ion-button fill="clear" [disabled]="busy()" (click)="copy()" [attr.aria-label]="'hadith.copy' | translate"><ion-icon slot="icon-only" name="copy-outline" /></ion-button>
        <ion-button fill="clear" [disabled]="busy()" (click)="share()" [attr.aria-label]="'hadith.share' | translate"><ion-icon slot="icon-only" name="share-social-outline" /></ion-button>
        <ion-button fill="clear" [disabled]="busy()" (click)="toggleBookmark()" [attr.aria-label]="(saved() ? 'hadith.removeBookmark' : 'hadith.bookmark') | translate" [attr.aria-pressed]="!!saved()"><ion-icon slot="icon-only" [name]="saved() ? 'bookmark' : 'bookmark-outline'" /></ion-button>
        <ion-button fill="clear" [disabled]="busy()" (click)="editNote()" [attr.aria-label]="'hadith.note' | translate"><ion-icon slot="icon-only" name="create-outline" /></ion-button>
        <ion-button fill="clear" (click)="resize(-.1)" [disabled]="settings.settings().fontScale <= .8" [attr.aria-label]="'hadith.smaller' | translate">A−</ion-button>
        <ion-button fill="clear" (click)="resize(.1)" [disabled]="settings.settings().fontScale >= 2" [attr.aria-label]="'hadith.larger' | translate">A+</ion-button>
      </div>
      @if (saved()?.note) { <p class="note" dir="auto">{{ saved()!.note }}</p> }
      @if (status()) { <p role="status">{{ status() | translate }}</p> }
    </article>`,
  styles: [`
    :host { display:block; min-width:0; }
    .card { margin-block:12px; padding:18px; border:1px solid var(--app-border); border-radius:18px; background:var(--app-surface); }
    .focused { border-color:var(--ion-color-primary); box-shadow:0 0 0 2px color-mix(in srgb,var(--ion-color-primary) 18%,transparent); }
    h2 { margin:0 0 12px; font-size:1rem; color:var(--ion-color-primary); }
    .reference,.muted { color:var(--app-muted); font-size:.875rem; line-height:1.7; }
    .arabic { font-family:'Amiri',serif; font-size:calc(1.45rem * var(--dhikr-font-scale,1)); line-height:2.1; white-space:pre-line; }
    .translation { font-size:calc(1rem * var(--dhikr-font-scale,1)); line-height:1.9; white-space:pre-line; }
    p { overflow-wrap:anywhere; } .grades,.actions { display:flex; flex-wrap:wrap; gap:4px; }
    ion-badge { white-space:normal; text-align:start; line-height:1.6; }
    ion-button { min-width:44px; min-height:44px; margin:0; }
    .ruling-button { white-space:normal; height:auto; --padding-top:12px; --padding-bottom:12px; line-height:1.7; margin-block:14px; }
    .note { border-inline-start:3px solid var(--ion-color-primary); padding-inline-start:12px; color:var(--app-muted); }
  `],
})
export class HadithCardComponent {
  readonly hadith = input.required<Hadith>();
  readonly heading = input('');
  readonly showRead = input(false);
  readonly focused = input(false);
  readonly settings = inject(SettingsService);
  private readonly marks = inject(HadithBookmarksService);
  private readonly shares = inject(ShareService);
  private readonly modals = inject(ModalController);
  private readonly alerts = inject(AlertController);
  private readonly sheets = inject(ActionSheetController);
  private readonly translate = inject(TranslateService);
  readonly lang = computed(() => this.settings.settings().language);
  readonly saved = computed(() => this.marks.saved(this.hadith()));
  readonly busy = signal(false);
  readonly status = signal('');
  readonly link = hadithLink;
  readonly color = gradeColor;
  readonly kind = gradeKind;
  /** No graders in the data: the grade its own source line states, never more (see sourceGradeKind). */
  readonly sourceKind = computed(() => sourceGradeKind(this.hadith().authenticitySource ?? ''));
  readonly sourceColor = computed(() => ({ sahih: 'success', hasan: 'tertiary', daif: 'warning', mawdu: 'danger', unknown: 'medium' })[this.sourceKind()]);
  reference(): string {
    const h = this.hadith();
    // Found in the online encyclopedia: its own book and number.
    if (h.collection === 'dorar') return [this.translate.instant('hadith.collections.dorar'), h.bookName].filter(Boolean).join(' · ');
    if (h.collection === 'enc') return [this.translate.instant('hadith.collections.enc'), h.authenticitySource].filter(Boolean).join(' · ');
    return `${this.translate.instant('hadith.collections.' + h.collection)} · ${this.translate.instant('hadith.book')} ${h.book} · ${this.translate.instant('hadith.number')} ${h.number}`;
  }
  private text(): string { const h = this.hadith(); return [h.arabic, h.translation, this.reference(), ...h.grades.map((g) => `${g.grade} — ${g.name}`)].filter(Boolean).join('\n\n'); }
  private async action(work: () => Promise<unknown>, success = ''): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.status.set('');
    try { await work(); this.status.set(success); } catch { this.status.set('hadith.actionFailed'); } finally { this.busy.set(false); }
  }
  copy(): Promise<void> { return this.action(() => navigator.clipboard.writeText(this.text()), 'hadith.copied'); }
  /** Shares the hadith as a picture (Arabic, translation, source, grade) or as text. */
  async share(): Promise<void> {
    const t = (key: string) => this.translate.instant(key);
    const sheet = await this.sheets.create({
      header: t('common.share'),
      buttons: [
        { text: t('share.asImage'), icon: 'image-outline', data: 'image' },
        { text: t('share.asText'), icon: 'document-text-outline', data: 'text' },
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
    const { data } = await sheet.onDidDismiss();
    const h = this.hadith();
    if (data === 'text') await this.action(() => this.shares.shareText(this.reference(), this.text()));
    else if (data === 'image') {
      await this.action(() => this.shares.sharePassage({
        title: this.reference(),
        arabic: h.arabic,
        translation: this.lang() === 'ar' ? '' : h.translation,
        translationLang: h.translationLang,
        source: [this.reference(), ...h.grades.slice(0, 1).map((g) => `${g.grade} — ${g.name}`)].join('\n'),
        brand: t('app.name'),
      }));
    }
  }
  toggleBookmark(): Promise<void> {
    return this.action(() => this.saved() ? this.marks.remove(this.hadith()) : this.marks.save(this.hadith()));
  }
  async editNote(): Promise<void> {
    const alert = await this.alerts.create({ header: this.translate.instant('hadith.note'),
      inputs: [{ name: 'note', type: 'textarea', value: this.saved()?.note ?? '', placeholder: this.translate.instant('hadith.note'), attributes: { maxlength: 4000, 'aria-label': this.translate.instant('hadith.note') } }],
      buttons: [{ text: this.translate.instant('hadith.cancel'), role: 'cancel' }, { text: this.translate.instant('hadith.save'), role: 'confirm' }],
    });
    await alert.present();
    const result = await alert.onDidDismiss<{ values: { note: string } }>();
    if (result.role === 'confirm') await this.action(() => this.marks.save(this.hadith(), result.data?.values.note ?? ''), 'hadith.saved');
  }
  async resize(delta: number): Promise<void> {
    await this.action(() => this.settings.update({ fontScale: Math.max(.8, Math.min(2, Math.round((this.settings.settings().fontScale + delta) * 10) / 10)) }));
  }
  async ruling(): Promise<void> {
    await this.action(async () => {
      const { HadithRulingComponent } = await import('./hadith-ruling.component');
      const modal = await this.modals.create({ component: HadithRulingComponent, componentProps: { hadith: this.hadith() }, breakpoints: [0, .5, 1], initialBreakpoint: 1 });
      await modal.present();
    });
  }
}
