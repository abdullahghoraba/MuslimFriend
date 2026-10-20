import { Injectable, inject } from '@angular/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { AthkarPrefsService } from './athkar-prefs.service';
import { SettingsService } from './settings.service';

/** Haptic feedback that respects the user's haptics setting and never throws. */
@Injectable({ providedIn: 'root' })
export class HapticsService {
  private readonly settings = inject(SettingsService);

  private readonly prefs = inject(AthkarPrefsService);
  get strength(): 'off' | 'light' | 'strong' { return this.prefs.prefs().vibration; }

  tap(): void {
    if (this.settings.settings().haptics && this.strength !== 'off')
      Haptics.impact({ style: this.strength === 'strong' ? ImpactStyle.Heavy : ImpactStyle.Light }).catch(() => {});
  }

  complete(): void {
    this.tap();
  }

  /** Long vibration used when a tasbih target is reached; vibrates even if haptics are off. */
  target(): void {
    Haptics.vibrate({ duration: 400 }).catch(() => {});
  }
}
