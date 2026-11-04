import { Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { LocalDatePipe } from '../../shared/local-date.pipe';
import { Preferences } from '@capacitor/preferences';
import { KeepAwake } from '@capacitor-community/keep-awake';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonLabel, IonSegment,
  IonSegmentButton, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToggle, IonToolbar, ToastController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Denoise, Reverb } from '../../core/studio/audio-chain';
import { Caption, Facing, StudioSession } from '../../core/studio/studio-session';
import { Recording, StudioService } from '../../core/studio/studio.service';
import { QuranService } from '../../core/quran/quran.service';
import { splitBasmala } from '../../core/quran/quran-utils';
import { SettingsService } from '../../core/services/settings.service';

interface StudioPrefs {
  kind: 'audio' | 'video';
  facing: Facing;
  denoise: Denoise;
  reverb: Reverb;
  captions: boolean;
}

const PREFS_KEY = 'studioPrefs';

/**
 * The recitation studio: record your own recitation, as sound or as a video with the camera, with the noise taken
 * out and the voice polished (EQ, compressor, optional room / hall / mosque echo), all on the phone. Choose the
 * ayat to read them from the screen (and show them on the video); compare with the untouched sound; share or save
 * to the gallery.
 */
@Component({
  selector: 'app-studio',
  imports: [
    TranslatePipe, LocalDatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonSegment,
    IonSegmentButton, IonLabel, IonIcon, IonSelect, IonSelectOption, IonToggle, IonButton, IonSpinner,
  ],
  templateUrl: './studio.page.html',
  styleUrl: './studio.page.scss',
})
export class StudioPage implements OnDestroy {
  readonly studio = inject(StudioService);
  readonly quran = inject(QuranService);
  private readonly settings = inject(SettingsService);
  private readonly translate = inject(TranslateService);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly previewHost = viewChild<ElementRef<HTMLElement>>('preview');

  readonly lang = computed(() => this.settings.settings().language);
  readonly prefs = signal<StudioPrefs>({ kind: 'audio', facing: 'user', denoise: 'strong', reverb: 'room', captions: true });
  /** Off or the AI (GTCRN). RNNoise («light») removed too little of a real room's noise to offer; it is only the fallback. */
  readonly denoiseLevels: Denoise[] = ['off', 'strong'];
  readonly reverbs: Reverb[] = ['none', 'room', 'hall', 'mosque'];

  /** The ayat to recite (optional): shown on the screen and, in a video, over the picture. */
  readonly sura = signal(0);
  readonly from = signal(1);
  readonly to = signal(1);
  readonly current = signal(1);

  readonly session = signal<StudioSession | null>(null);
  readonly opening = signal(false);
  readonly error = signal<'denied' | 'unsupported' | 'failed' | null>(null);
  readonly state = signal<'idle' | 'recording' | 'paused' | 'saving'>('idle');
  readonly elapsed = signal(0);
  readonly level = signal(0);
  /** Which noise removal really runs (strong falls back to light on phones that cannot run it). */
  readonly activeDenoise = signal<Denoise>('off');

  /** The recording being played back. */
  readonly review = signal<Recording | null>(null);
  readonly reviewSrc = signal('');
  readonly showOriginal = signal(false);

  private pending?: ReturnType<StudioService['begin']>;
  private ticker = 0;

  readonly suraOptions = computed(() => (this.quran.ready() ? this.quran.suras : []));
  readonly ayahNumbers = computed(() => {
    const s = this.sura();
    return s && this.quran.ready() ? Array.from({ length: this.quran.sura(s).ayas }, (_, i) => i + 1) : [];
  });
  readonly caption = computed<Caption | null>(() => {
    const s = this.sura();
    if (!s || !this.quran.ready()) return null;
    const aya = Math.min(Math.max(this.current(), this.from()), this.to());
    const a = this.quran.ayah({ sura: s, aya });
    const digits = new Intl.NumberFormat('ar-EG');
    return { title: `سورة ${this.quran.sura(s).name} · ${digits.format(aya)}`, text: `${splitBasmala(a, a.text).text} ﴿${digits.format(aya)}﴾` };
  });
  readonly time = computed(() => formatTime(this.elapsed()));
  readonly levelPct = computed(() => Math.round(this.level() * 100));

  async ionViewWillEnter(): Promise<void> {
    await Promise.all([this.loadPrefs(), this.studio.load(), this.quran.load().catch(() => undefined)]);
  }

  ionViewWillLeave(): void {
    void this.closeSession();
  }

  ngOnDestroy(): void {
    void this.closeSession();
  }

  // ---- settings ----------------------------------------------------------------------------------

  async setKind(value: unknown): Promise<void> {
    const kind = value === 'video' ? 'video' : 'audio';
    if (kind === this.prefs().kind || this.state() !== 'idle') return;
    await this.savePrefs({ kind });
    if (this.session()) {
      await this.closeSession();
      await this.openSession();
    }
  }

  async setDenoise(value: unknown): Promise<void> {
    const denoise = this.denoiseLevels.includes(value as Denoise) ? (value as Denoise) : 'strong';
    await this.savePrefs({ denoise });
    const s = this.session();
    if (s) {
      await s.chain.setDenoise(denoise);
      this.activeDenoise.set(s.chain.denoise);
    }
  }

  async setReverb(value: unknown): Promise<void> {
    const reverb = this.reverbs.includes(value as Reverb) ? (value as Reverb) : 'none';
    await this.savePrefs({ reverb });
    this.session()?.chain.setReverb(reverb);
  }

  async setCaptions(on: boolean): Promise<void> {
    await this.savePrefs({ captions: on });
  }

  setSura(value: unknown): void {
    const s = Number(value) || 0;
    this.sura.set(s);
    this.from.set(1);
    this.to.set(s ? this.quran.sura(s).ayas : 1);
    this.current.set(1);
  }

  setFrom(value: unknown): void {
    const n = Number(value) || 1;
    this.from.set(n);
    if (this.to() < n) this.to.set(n);
    this.current.set(n);
  }

  setTo(value: unknown): void {
    const n = Number(value) || 1;
    this.to.set(Math.max(n, this.from()));
  }

  nextAyah(): void {
    if (this.sura()) this.current.update((n) => Math.min(this.to(), Math.max(n, this.from()) + 1));
  }

  prevAyah(): void {
    if (this.sura()) this.current.update((n) => Math.max(this.from(), n - 1));
  }

  // ---- recording ---------------------------------------------------------------------------------

  /** Turns on the microphone (and camera): the preview and meter run before recording starts. */
  async openSession(): Promise<void> {
    if (this.session() || this.opening()) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.error.set('unsupported');
      return;
    }
    this.opening.set(true);
    this.error.set(null);
    try {
      const p = this.prefs();
      const session = await StudioSession.open(
        { kind: p.kind, facing: p.facing, denoise: p.denoise, reverb: p.reverb, brand: this.translate.instant('app.name') },
        () => (this.prefs().captions ? this.caption() : null),
      );
      this.session.set(session);
      this.activeDenoise.set(session.chain.denoise);
      this.mountPreview();
      this.startTicker();
    } catch (e) {
      const name = (e as DOMException)?.name;
      this.error.set(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed');
    } finally {
      this.opening.set(false);
    }
  }

  async flipCamera(): Promise<void> {
    const s = this.session();
    if (!s || s.kind !== 'video') return;
    await s.switchCamera();
    await this.savePrefs({ facing: s.facing });
  }

  async record(): Promise<void> {
    if (!this.session()) await this.openSession();
    const s = this.session();
    if (!s) return;
    this.closeReview();
    this.pending = this.studio.begin(s.kind, s.mime, s.kind === 'audio' ? s.mime : undefined);
    s.start(this.pending.sink, this.pending.rawSink);
    this.current.set(this.from());
    this.state.set('recording');
    await KeepAwake.keepAwake().catch(() => undefined);
  }

  togglePause(): void {
    const s = this.session();
    if (!s) return;
    if (this.state() === 'recording') {
      s.pause();
      this.state.set('paused');
    } else if (this.state() === 'paused') {
      s.resume();
      this.state.set('recording');
    }
  }

  async stop(): Promise<void> {
    const s = this.session();
    const pending = this.pending;
    if (!s || !pending || (this.state() !== 'recording' && this.state() !== 'paused')) return;
    this.state.set('saving');
    try {
      const duration = await s.stop();
      await pending.sink.close();
      await pending.rawSink?.close();
      const p = this.prefs();
      const rec: Recording = {
        id: pending.id,
        kind: s.kind,
        created: Date.now(),
        duration,
        mime: s.mime || (s.kind === 'audio' ? 'audio/webm' : 'video/webm'),
        file: pending.file,
        raw: pending.raw,
        rawMime: pending.raw ? s.rawMime || s.mime : undefined,
        title: this.defaultTitle(),
        sura: this.sura() || undefined,
        from: this.sura() ? this.from() : undefined,
        to: this.sura() ? this.to() : undefined,
        denoise: s.chain.denoise,
        reverb: p.reverb,
      };
      await this.studio.commit(rec);
      await this.openReview(rec);
    } catch {
      await this.studio.discard([pending.file, pending.raw]);
      await this.toast('studio.saveFailed');
    } finally {
      this.pending = undefined;
      this.state.set('idle');
      await KeepAwake.allowSleep().catch(() => undefined);
    }
  }

  // ---- playback and sharing ----------------------------------------------------------------------

  async openReview(rec: Recording): Promise<void> {
    this.review.set(rec);
    this.showOriginal.set(false);
    this.reviewSrc.set(await this.studio.src(rec.file));
  }

  closeReview(): void {
    this.review.set(null);
    this.reviewSrc.set('');
  }

  /** Before / after: the untouched microphone sound or the enhanced recording. */
  async toggleOriginal(): Promise<void> {
    const rec = this.review();
    if (!rec?.raw) return;
    this.showOriginal.update((v) => !v);
    this.reviewSrc.set(await this.studio.src(this.showOriginal() ? rec.raw : rec.file));
  }

  async share(rec: Recording): Promise<void> {
    await this.studio.share(rec, this.translate.instant('studio.title')).catch(() => undefined);
  }

  async saveToDevice(rec: Recording): Promise<void> {
    const result = await this.studio.saveToDevice(rec);
    if (result === 'saved') await this.toast(rec.kind === 'video' ? 'studio.savedGallery' : 'studio.savedMusic');
    else if (result === 'unsupported') await this.share(rec);
    else await this.toast('studio.saveFailed');
  }

  async rename(rec: Recording): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('studio.rename'),
      inputs: [{ name: 'title', type: 'text', value: rec.title }],
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('common.save'),
          handler: (v: { title: string }) => {
            void this.studio.rename(rec.id, v.title).then(() => {
              if (this.review()?.id === rec.id) this.review.set(this.studio.recordings().find((r) => r.id === rec.id) ?? null);
            });
          },
        },
      ],
    });
    await alert.present();
  }

  async remove(rec: Recording): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('studio.deleteConfirm'),
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('common.delete'),
          role: 'destructive',
          handler: () => {
            if (this.review()?.id === rec.id) this.closeReview();
            void this.studio.remove(rec.id);
          },
        },
      ],
    });
    await alert.present();
  }

  async dropOriginal(rec: Recording): Promise<void> {
    await this.studio.dropOriginal(rec.id);
    const updated = this.studio.recordings().find((r) => r.id === rec.id) ?? null;
    if (updated) await this.openReview(updated);
  }

  formatTime(seconds: number): string {
    return formatTime(seconds);
  }

  // ---- internals ---------------------------------------------------------------------------------

  private defaultTitle(): string {
    const s = this.sura();
    if (!s) return this.translate.instant('studio.myRecitation');
    const name = this.quran.sura(s).name;
    return this.from() === 1 && this.to() === this.quran.sura(s).ayas ? `سورة ${name}` : `${name} ${this.from()}–${this.to()}`;
  }

  /** The video preview is the very canvas that is recorded, so what you see is what you get. */
  private mountPreview(): void {
    const host = this.previewHost()?.nativeElement;
    const canvas = this.session()?.canvas;
    if (!host) return;
    host.replaceChildren();
    if (canvas) {
      // Added from code, so the component's (scoped) styles do not reach it: sized here to fill the stage.
      Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', objectFit: 'contain' });
      host.appendChild(canvas);
    }
  }

  private startTicker(): void {
    clearInterval(this.ticker);
    this.ticker = window.setInterval(() => {
      const s = this.session();
      if (!s) return;
      this.level.set(s.chain.level());
      this.elapsed.set(s.elapsed());
    }, 100);
  }

  private async closeSession(): Promise<void> {
    clearInterval(this.ticker);
    const s = this.session();
    if (!s) return;
    if (this.state() === 'recording' || this.state() === 'paused') await this.stop();
    s.close();
    this.session.set(null);
    this.previewHost()?.nativeElement.replaceChildren();
    this.level.set(0);
  }

  private async loadPrefs(): Promise<void> {
    const { value } = await Preferences.get({ key: PREFS_KEY });
    try {
      const v = value ? (JSON.parse(value) as Partial<StudioPrefs>) : {};
      this.prefs.update((p) => ({
        kind: v.kind === 'video' ? 'video' : p.kind,
        facing: v.facing === 'environment' ? 'environment' : p.facing,
        denoise: this.denoiseLevels.includes(v.denoise as Denoise) ? (v.denoise as Denoise) : p.denoise,
        reverb: this.reverbs.includes(v.reverb as Reverb) ? (v.reverb as Reverb) : p.reverb,
        captions: typeof v.captions === 'boolean' ? v.captions : p.captions,
      }));
    } catch {
      /* defaults */
    }
  }

  private async savePrefs(patch: Partial<StudioPrefs>): Promise<void> {
    this.prefs.update((p) => ({ ...p, ...patch }));
    await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(this.prefs()) });
  }

  private async toast(key: string): Promise<void> {
    const t = await this.toasts.create({ message: this.translate.instant(key), duration: 2000, position: 'bottom' });
    await t.present();
  }
}

/** 75.4 -> "1:15". */
export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
