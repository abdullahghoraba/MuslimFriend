import { Injectable, inject } from '@angular/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { SettingsService } from './settings.service';

/** Haptic feedback that respects the user's haptics setting and never throws. */
@Injectable({ providedIn: 'root' })
export class HapticsService {
  private readonly settings = inject(SettingsService);

  tap(): void {
    if (this.settings.settings().haptics) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }

  complete(): void {
    if (this.settings.settings().haptics) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  }

  /** Long vibration used when a tasbih target is reached; vibrates even if haptics are off. */
  target(): void {
    Haptics.vibrate({ duration: 400 }).catch(() => {});
  }
}
