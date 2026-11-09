import { signal } from '@angular/core';
import { intlLocale } from '../../core/models';

/** Round up so a future target never displays zero before it is reached. */
export function formatCountdown(target: Date, now: Date, language: string): string {
  const seconds = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1000));
  // Same digits as the prayer times beside it (intlLocale uses Latin digits in every language).
  const options = { useGrouping: false };
  const plain = new Intl.NumberFormat(intlLocale(language), options);
  const padded = new Intl.NumberFormat(intlLocale(language), { ...options, minimumIntegerDigits: 2 });
  return `${plain.format(Math.floor(seconds / 3600))}:${padded.format(Math.floor(seconds / 60) % 60)}:${padded.format(seconds % 60)}`;
}

/** Owned by Home, never by the application-wide prayer service. */
export class HomeClock {
  readonly now = signal(new Date());
  private timer?: ReturnType<typeof setInterval>;

  setActive(active: boolean): void {
    if (!active) {
      clearInterval(this.timer);
      this.timer = undefined;
    } else if (this.timer === undefined) {
      this.now.set(new Date());
      this.timer = setInterval(() => this.now.set(new Date()), 1000);
    }
  }
}
