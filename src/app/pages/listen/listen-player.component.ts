import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActionSheetController, IonButton, IonIcon, IonRange, IonSpinner } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AudioCatalogService } from '../../core/audio/audio-catalog.service';
import { AudioPlayerService } from '../../core/audio/audio-player.service';
import { QuranService } from '../../core/quran/quran.service';

/** The Listen pages' player: a sura with its position and next / previous, or a live radio. */
@Component({
  selector: 'app-listen-player',
  imports: [TranslatePipe, IonButton, IonIcon, IonRange, IonSpinner],
  template: `
    @if (player.now(); as now) {
      <div class="player" role="group" [attr.aria-label]="'listen.player' | translate">
        <div class="now">
          <span class="text">
            <strong>{{ title() }}</strong>
            <small>{{ subtitle() }}</small>
          </span>
          @if (now.kind === 'radio') {
            <span class="live" [class.on]="player.playing()">{{ 'listen.live' | translate }}</span>
          }
        </div>
        @if (player.error()) {
          <p class="error" role="alert">{{ 'listen.error' | translate }}</p>
        }
        @if (now.kind === 'sura' && player.duration() > 0) {
          <div class="seek" dir="ltr">
            <small>{{ clock(player.position()) }}</small>
            <ion-range [min]="0" [max]="player.duration()" [step]="1" [value]="player.position()"
                       (ionChange)="player.seek(+$event.detail.value)" [attr.aria-label]="'listen.seek' | translate" />
            <small>{{ clock(player.duration()) }}</small>
          </div>
        }
        <div class="controls">
          <ion-button fill="clear" (click)="sleep()" [class.active]="player.sleepAt() !== null"
                      [attr.aria-label]="'listen.sleep' | translate">
            <ion-icon slot="icon-only" name="moon-outline" aria-hidden="true" />
          </ion-button>
          @if (now.kind === 'sura') {
            <ion-button fill="clear" (click)="player.step(-1)" [disabled]="!player.hasStep(-1)" [attr.aria-label]="'listen.prevSura' | translate">
              <ion-icon slot="icon-only" [name]="rtl() ? 'play-skip-forward' : 'play-skip-back'" aria-hidden="true" />
            </ion-button>
          }
          <ion-button class="main" (click)="player.error() ? retry() : player.toggle()"
                      [attr.aria-label]="(player.error() ? 'listen.retry' : player.playing() ? 'listen.pause' : 'listen.play') | translate">
            @if (player.loading() && !player.error()) {
              <ion-spinner name="crescent" />
            } @else {
              <ion-icon slot="icon-only" [name]="player.error() ? 'refresh-outline' : player.playing() ? 'pause' : 'play'" aria-hidden="true" />
            }
          </ion-button>
          @if (now.kind === 'sura') {
            <ion-button fill="clear" (click)="player.step(1)" [disabled]="!player.hasStep(1)" [attr.aria-label]="'listen.nextSura' | translate">
              <ion-icon slot="icon-only" [name]="rtl() ? 'play-skip-back' : 'play-skip-forward'" aria-hidden="true" />
            </ion-button>
            <ion-button fill="clear" (click)="player.repeatSura.set(!player.repeatSura())" [class.active]="player.repeatSura()"
                        [attr.aria-pressed]="player.repeatSura()" [attr.aria-label]="'listen.repeatSura' | translate">
              <ion-icon slot="icon-only" name="repeat-outline" aria-hidden="true" />
            </ion-button>
          }
          <ion-button fill="clear" (click)="player.stop()" [attr.aria-label]="'listen.stop' | translate">
            <ion-icon slot="icon-only" name="stop" aria-hidden="true" />
          </ion-button>
        </div>
        @if (player.sleepAt(); as at) {
          <small class="sleep-left">{{ 'listen.sleepLeft' | translate: { n: minutesLeft(at) } }}</small>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .player { padding: 6px 8px calc(6px + var(--ion-safe-area-bottom, 0px)); border-top: 1px solid var(--app-border); background: var(--app-surface); }
    .now { display: flex; align-items: center; gap: 8px; padding: 2px 8px; min-width: 0; }
    .text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .text strong, .text small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .text small { color: var(--app-muted); font-size: 0.8rem; }
    .live { font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--app-border); color: var(--app-muted); }
    .live.on { background: #c62828; border-color: #c62828; color: #fff; }
    .error { margin: 4px 8px; color: var(--ion-color-danger); font-size: 0.85rem; }
    .seek { display: flex; align-items: center; gap: 8px; padding: 0 8px; }
    .seek ion-range { flex: 1; --bar-height: 4px; padding: 0; }
    .seek small { font-variant-numeric: tabular-nums; color: var(--app-muted); font-size: 0.75rem; min-width: 3.2em; text-align: center; }
    .controls { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px; }
    .controls ion-button { margin: 0; min-height: 44px; }
    .controls ion-button.active { --color: var(--ion-color-primary); }
    .controls ion-button:not(.active):not(.main) { --color: var(--ion-text-color); }
    .controls .main { --border-radius: 50%; width: 52px; height: 52px; --padding-start: 0; --padding-end: 0; }
    .sleep-left { display: block; text-align: center; color: var(--app-muted); font-size: 0.75rem; }
  `,
})
export class ListenPlayerComponent {
  readonly player = inject(AudioPlayerService);
  private readonly catalog = inject(AudioCatalogService);
  private readonly quran = inject(QuranService);
  private readonly sheets = inject(ActionSheetController);
  private readonly translate = inject(TranslateService);

  readonly rtl = computed(() => ['ar', 'ur', 'fa'].includes(this.catalog.lang()));
  readonly title = computed(() => {
    const now = this.player.now();
    if (!now) return '';
    if (now.kind === 'radio') return this.catalog.radioName(now.radio);
    if (!this.quran.ready()) return String(now.sura);
    const s = this.quran.sura(now.sura);
    return this.catalog.lang() === 'ar' ? 'سورة ' + s.name : `${now.sura}. ${s.tname}`;
  });
  readonly subtitle = computed(() => {
    const now = this.player.now();
    if (!now) return '';
    if (now.kind === 'radio') return 'mp3quran.net';
    return `${this.catalog.reciterName(now.reciter)} · ${this.catalog.moshafName(now.moshaf)}`;
  });

  /** Ticks every 20 s so the sleep timer's minutes left stay current. */
  private readonly clockNow = signal(Date.now());

  constructor() {
    void this.quran.load().catch(() => {});
    const timer = setInterval(() => this.clockNow.set(Date.now()), 20_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  retry(): void {
    const now = this.player.now();
    if (now?.kind === 'radio') void this.player.playRadio(now.radio);
    else if (now?.kind === 'sura') void this.player.playSura(now.reciter, now.moshaf, now.sura);
  }

  clock(seconds: number): string {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
  }

  minutesLeft(at: number): number {
    return Math.max(1, Math.ceil((at - this.clockNow()) / 60_000));
  }

  async sleep(): Promise<void> {
    const t = (k: string, p?: object) => this.translate.instant(k, p);
    const sheet = await this.sheets.create({
      header: t('listen.sleep'),
      buttons: [
        ...[15, 30, 45, 60, 90].map((n) => ({ text: t('listen.sleepMinutes', { n }), handler: () => this.player.setSleep(n) })),
        ...(this.player.sleepAt() !== null ? [{ text: t('listen.sleepOff'), role: 'destructive', handler: () => this.player.setSleep(0) }] : []),
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }
}
