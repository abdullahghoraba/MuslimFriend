import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonSelect, IonSelectOption,
  IonSpinner, IonTitle, IonToggle, IonToolbar,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { QuranService } from '../../core/quran/quran.service';
import { RUQYAH_DUAS, RUQYAH_PASSAGES } from '../../core/ruqyah/ruqyah';
import { RUQYAH_RECITERS, RuqyahPlayerService } from '../../core/ruqyah/ruqyah-player.service';
import { SettingsService } from '../../core/services/settings.service';

/** الرقية الشرعية: the ruqyah verses in the sheikh's voice the reader chooses, and the Prophet's ruqyah ﷺ. */
@Component({
  selector: 'app-ruqyah',
  imports: [RouterLink, TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonButton, IonIcon,
    IonItem, IonLabel, IonSelect, IonSelectOption, IonSpinner, IonToggle],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/more" [text]="''" [attr.aria-label]="'common.back' | translate" /></ion-buttons>
      <ion-title>{{ 'ruqyah.title' | translate }}</ion-title>
    </ion-toolbar></ion-header>
    <ion-content><main>
      <p class="intro">{{ 'ruqyah.intro' | translate }}</p>
      <section class="player">
        <ion-item lines="none">
          <ion-select [label]="'ruqyah.sheikh' | translate" labelPlacement="stacked" interface="action-sheet"
            [value]="player.reciterId()" (ionChange)="player.setReciter($event.detail.value)">
            @for (r of reciters; track r.id) { <ion-select-option [value]="r.id">{{ lang() === 'ar' ? r.nameAr : r.nameEn }}</ion-select-option> }
          </ion-select>
        </ion-item>
        <div class="controls">
          <ion-button size="large" (click)="player.toggle()" [attr.aria-label]="(player.playing() ? 'ruqyah.pause' : 'ruqyah.play') | translate">
            <ion-icon slot="start" [name]="player.playing() ? 'pause' : 'play'" />{{ (player.playing() ? 'ruqyah.pause' : (player.current() ? 'ruqyah.resume' : 'ruqyah.play')) | translate }}
          </ion-button>
          @if (player.current()) {
            <ion-button fill="outline" size="large" (click)="player.stop()" [attr.aria-label]="'ruqyah.stop' | translate"><ion-icon slot="icon-only" name="stop" /></ion-button>
          }
          @if (player.loading()) { <ion-spinner name="dots" /> }
        </div>
        <ion-item lines="none"><ion-toggle [checked]="player.loop()" (ionChange)="player.setLoop($event.detail.checked)">{{ 'ruqyah.loop' | translate }}</ion-toggle></ion-item>
        @if (player.error()) { <p class="warn" role="alert">{{ 'ruqyah.offline' | translate }}</p> }
        <p class="muted">{{ 'ruqyah.length' | translate: { count: ayahCount } }}</p>
      </section>

      <h2>{{ 'ruqyah.verses' | translate }}</h2>
      @for (p of passages(); track $index) {
        <article class="passage" [class.now]="player.current()?.passage === $index" [id]="'passage-' + $index">
          <header>
            <span>{{ p.name }} · {{ p.range }}</span>
            <ion-button fill="clear" size="small" (click)="player.play($index)" [attr.aria-label]="('ruqyah.playFrom' | translate) + ' ' + p.name">
              <ion-icon slot="icon-only" name="play-circle-outline" />
            </ion-button>
          </header>
          <p class="quran" lang="ar" dir="rtl">
            @for (a of p.ayat; track a.aya) {
              <span [class.sounding]="player.current()?.sura === p.sura && player.current()?.aya === a.aya">{{ a.text }} ﴿{{ a.number }}﴾ </span>
            }
          </p>
        </article>
      }

      <h2>{{ 'ruqyah.duas' | translate }}</h2>
      <p class="muted">{{ 'ruqyah.duasHint' | translate }}</p>
      @for (d of duas; track $index) {
        <article class="dua">
          <p class="arabic" lang="ar" dir="rtl">{{ d.text }}</p>
          @if (d.how) { <p class="how" lang="ar" dir="rtl">{{ d.how }}</p> }
          <p class="source" lang="ar" dir="rtl">{{ d.source }}</p>
        </article>
      }

      <ion-item button detail routerLink="/listen" class="radio">
        <ion-icon slot="start" name="radio-outline" aria-hidden="true" />
        <ion-label>{{ 'ruqyah.radio' | translate }}</ion-label>
      </ion-item>
      <p class="credit">{{ 'ruqyah.credit' | translate }}</p>
    </main></ion-content>`,
  styles: `
    main { max-width: 760px; margin-inline: auto; padding: 8px 12px calc(96px + var(--ion-safe-area-bottom, 0px)); }
    .intro { line-height: 1.8; margin: 12px 4px; }
    .player { position: sticky; top: 0; z-index: 2; padding: 8px; border: 1px solid var(--app-border); border-radius: 18px; background: var(--app-surface); }
    .controls { display: flex; align-items: center; gap: 8px; padding: 4px 12px; flex-wrap: wrap; }
    h2 { font-size: 1.05rem; color: var(--ion-color-primary); margin: 22px 4px 8px; }
    .passage, .dua { margin: 10px 0; padding: 14px; border: 1px solid var(--app-border); border-radius: 18px; background: var(--app-surface); }
    .passage.now { border-color: var(--ion-color-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ion-color-primary) 18%, transparent); }
    .passage header { display: flex; align-items: center; justify-content: space-between; color: var(--ion-color-primary); font-weight: 700; }
    .quran, .arabic { font-family: 'Amiri', serif; font-size: calc(1.4rem * var(--dhikr-font-scale, 1)); line-height: 2.1; margin: 6px 0 0; }
    .sounding { background: color-mix(in srgb, var(--ion-color-primary) 16%, transparent); border-radius: 6px; }
    .how { color: var(--app-muted); line-height: 1.8; margin: 6px 0 0; }
    .source { font-size: .85rem; color: var(--ion-color-primary); margin: 4px 0 0; }
    .muted, .credit { color: var(--app-muted); font-size: .85rem; line-height: 1.7; margin: 6px 4px; }
    .warn { color: var(--ion-color-danger); margin: 6px 12px; }
    .credit { text-align: center; margin-top: 20px; }
    .radio { margin-top: 16px; border-radius: 14px; }
    ion-button { min-height: 44px; }
  `,
})
export class RuqyahPage {
  readonly player = inject(RuqyahPlayerService);
  private readonly quran = inject(QuranService);
  private readonly settings = inject(SettingsService);
  readonly lang = computed(() => this.settings.settings().language);
  readonly reciters = RUQYAH_RECITERS;
  readonly duas = RUQYAH_DUAS;
  readonly ayahCount = RUQYAH_PASSAGES.reduce((n, p) => n + p.to - p.from + 1, 0);
  private readonly ready = signal(false);
  readonly passages = computed(() => {
    if (!this.ready()) return [];
    const digits = (n: number) => n.toLocaleString('ar-EG');
    return RUQYAH_PASSAGES.map((p) => ({
      sura: p.sura,
      name: this.quran.sura(p.sura).name,
      range: p.from === p.to ? digits(p.from) : `${digits(p.from)}–${digits(p.to)}`,
      ayat: Array.from({ length: p.to - p.from + 1 }, (_, k) => {
        const aya = p.from + k;
        return { aya, number: digits(aya), text: this.quran.ayah({ sura: p.sura, aya }).text };
      }),
    }));
  });

  constructor() {
    void this.quran.load().then(() => this.ready.set(true));
    // Keep the passage being recited in view.
    effect(() => {
      const cur = this.player.current();
      if (cur) document.getElementById('passage-' + cur.passage)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}
