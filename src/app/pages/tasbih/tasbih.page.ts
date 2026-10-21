import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { LifecycleService } from '../../core/services/lifecycle.service';
import { AlertController, ToastController, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel, IonItem, IonRange } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { TasbihService } from '../../core/services/tasbih.service';
import { TasbihCounter } from '../../core/models';
import { HapticsService } from '../../core/services/haptics.service';
import { FloatingCounterService } from '../../core/services/floating-counter.service';
import { AthkarOverlay } from '../../native/athkar-overlay';

@Component({
  selector: 'app-tasbih',
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel, IonItem, IonRange, TranslatePipe],
  templateUrl: './tasbih.page.html',
  styleUrl: './tasbih.page.scss',
})
export class TasbihPage implements OnDestroy {
  readonly tasbih = inject(TasbihService);
  private readonly haptics = inject(HapticsService);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly translate = inject(TranslateService);
  readonly selectedId = signal<number | null>(null);
  readonly active = computed<TasbihCounter | undefined>(() => this.tasbih.counters().find(c => c.id === this.selectedId()) ?? this.tasbih.counters()[0]);
  readonly targetChoice = computed(() => {
    const target = this.active()?.target;
    return target === 33 || target === 100 || target === 0 ? String(target) : 'custom';
  });
  readonly circumference = 2 * Math.PI * 46;
  readonly offset = computed(() => {
    const counter = this.active();
    if (!counter?.target) return this.circumference;
    const progress = counter.count > 0 && counter.count % counter.target === 0 ? 1 : (counter.count % counter.target) / counter.target;
    return this.circumference * (1 - progress);
  });
  readonly pulse = signal(false);
  private pulseTimer?: ReturnType<typeof setTimeout>;
  private visible = false;

  async ionViewDidEnter(): Promise<void> {
    this.visible = true;
    try {
      await KeepAwake.keepAwake();
      if (!this.visible) await KeepAwake.allowSleep();
    } catch { /* Unsupported on web. */ }
    await this.run(() => this.tasbih.load());
    await this.floating.load();
    await this.onPermissionReturn();
  }

  async ionViewWillLeave(): Promise<void> {
    this.visible = false;
    clearTimeout(this.pulseTimer);
    this.pulse.set(false);
    try { await KeepAwake.allowSleep(); } catch { /* Unsupported on web. */ }
  }

  ngOnDestroy(): void { clearTimeout(this.pulseTimer); }

  // ---- Floating counter over other apps ----
  readonly floating = inject(FloatingCounterService);
  readonly floatingNeedsPermission = signal(false);
  private readonly lifecycle = inject(LifecycleService);

  private readonly followResume = effect(() => {
    this.lifecycle.resumed();
    untracked(() => void this.onPermissionReturn());
  });

  /** The bubble mirrors whichever counter is selected here. */
  private readonly followCounter = effect(() => {
    const id = this.active()?.id;
    untracked(() => {
      const f = this.floating.floating();
      if (id && f.enabled && f.counterId !== id) void this.floating.setCounter(id);
    });
  });

  /** Turning it on is a user action in the foreground, which Android requires to start the service. */
  async toggleFloating(on: boolean): Promise<void> {
    await this.run(async () => {
      if (!on) {
        this.floatingNeedsPermission.set(false);
        await this.floating.disable();
        return;
      }
      const counter = this.active();
      if (!counter) return;
      const result = await this.floating.enable(counter.id);
      this.floatingNeedsPermission.set(result.needsPermission);
      if (result.ok) await this.notify('tasbih.floating.enabled');
      else if (!result.needsPermission) await this.notify('tasbih.floating.failed');
    });
  }

  async grantOverlay(): Promise<void> {
    await AthkarOverlay.requestOverlayPermission();
  }

  /** When the user returns from the permission screen, finish turning the bubble on. */
  async onPermissionReturn(): Promise<void> {
    if (!this.floatingNeedsPermission()) return;
    const { granted } = await AthkarOverlay.checkOverlayPermission();
    if (granted) await this.toggleFloating(true);
  }

  private async notify(key: string): Promise<void> {
    const toast = await this.toasts.create({ message: this.translate.instant(key), duration: 1600, position: 'bottom' });
    await toast.present();
  }

  private async run(work: () => Promise<unknown>): Promise<void> {
    try { await work(); } catch { await this.notify('tasbih.error'); }
  }

  async increment(): Promise<void> {
    const counter = this.active();
    if (!counter) return;
    this.haptics.tap();
    await this.run(async () => {
      const result = await this.tasbih.increment(counter.id);
      if (result.reachedTarget && this.visible) {
        this.haptics.target();
        this.pulse.set(true);
        clearTimeout(this.pulseTimer);
        this.pulseTimer = setTimeout(() => this.pulse.set(false), 450);
        await this.notify('tasbih.completed');
      }
    });
  }

  async editName(add = false): Promise<void> {
    const counter = this.active();
    if (!add && !counter) return;
    const alert = await this.alerts.create({
      header: this.translate.instant(add ? 'tasbih.addCounter' : 'tasbih.rename'),
      inputs: [{ name: 'name', type: 'text', value: add ? '' : counter?.name, placeholder: this.translate.instant('tasbih.counterName'), attributes: { 'aria-label': this.translate.instant('tasbih.counterName') } }],
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        { text: this.translate.instant('common.save'), handler: (data: { name: string }) => {
          void this.run(async () => {
            if (add) this.selectedId.set((await this.tasbih.add(data.name ?? '', 33)).id);
            else await this.tasbih.rename(counter!.id, data.name ?? '');
          });
        } },
      ],
    });
    await alert.present();
  }

  async chooseTarget(value: string | number | undefined, segment?: IonSegment): Promise<void> {
    const counter = this.active();
    if (!counter) return;
    if (value !== 'custom') {
      if (value !== undefined) await this.run(() => this.tasbih.setTarget(counter.id, Number(value)));
      return;
    }
    const alert = await this.alerts.create({
      header: this.translate.instant('tasbih.customTarget'),
      message: this.translate.instant('tasbih.targetRange'),
      inputs: [{ name: 'target', type: 'number', value: counter.target, min: 0, max: 100000, attributes: { step: 1, 'aria-label': this.translate.instant('tasbih.customTarget') } }],
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        { text: this.translate.instant('common.save'), handler: (data: { target: string }) => {
          const target = Number(data.target);
          if (!String(data.target).trim() || !Number.isInteger(target) || target < 0 || target > 100000) return false;
          void this.run(() => this.tasbih.setTarget(counter.id, target));
          return true;
        } },
      ],
    });
    await alert.present();
    await alert.onDidDismiss();
    if (segment) segment.value = this.targetChoice();
  }

  async confirm(action: 'reset' | 'delete'): Promise<void> {
    const counter = this.active();
    if (!counter || (action === 'delete' && this.tasbih.counters().length <= 1)) return;
    const alert = await this.alerts.create({
      header: this.translate.instant('tasbih.' + action),
      message: this.translate.instant('tasbih.' + action + 'Confirm'),
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        { text: this.translate.instant('common.' + action), role: 'destructive', handler: () => {
          void this.run(() => action === 'reset' ? this.tasbih.reset(counter.id) : this.tasbih.remove(counter.id));
        } },
      ],
    });
    await alert.present();
  }
}
