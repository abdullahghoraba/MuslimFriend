import { Component, computed, inject, input } from '@angular/core';
import { SettingsService } from '../core/services/settings.service';
/** Decorative companion to the adjacent accessible reciter/station name. */
@Component({
  selector: 'app-reciter-avatar',
  host: { 'aria-hidden': 'true', '[style.--avatar-accent]': 'accent()' },
  template: `<svg viewBox="0 0 64 64" focusable="false"><circle cx="32" cy="32" r="30"/><path d="m32 3 9 7 12 1 1 12 7 9-7 9-1 12-12 1-9 7-9-7-12-1-1-12-7-9 7-9 1-12 12-1Z"/><circle cx="32" cy="32" r="24"/></svg><span dir="auto" [attr.lang]="arabic() ? 'ar' : 'en'">{{ initial() }}</span>`,
  styles: `:host { position: relative; display: inline-grid; place-items: center; flex: 0 0 auto; width: var(--reciter-avatar-size, 48px); height: var(--reciter-avatar-size, 48px); border-radius: 50%; background: var(--app-surface); color: var(--ion-text-color); } svg { position: absolute; inset: 0; width: 100%; height: 100%; fill: none; stroke: var(--avatar-accent); stroke-width: 1; } span { font: 700 1.5rem/1 'Amiri', serif; }`,
})
export class ReciterAvatarComponent {
  readonly reciterId = input.required<string | number>();
  readonly nameAr = input.required<string>();
  readonly nameEn = input.required<string>();
  readonly language = input<string>();
  private readonly settings = inject(SettingsService);
  readonly arabic = computed(() => (this.language() ?? this.settings.settings().language) === 'ar');
  readonly initial = computed(() => Array.from((this.arabic() ? this.nameAr() : this.nameEn()).trim())[0]?.toLocaleUpperCase() ?? '');
  readonly accent = computed(() => {
    const palette = ['var(--ion-color-primary)', 'var(--ion-color-secondary)', '#8a7953', '#658b82', '#8b7894'];
    let hash = 0;
    for (const c of String(this.reciterId())) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
    return palette[hash % palette.length];
  });
}
