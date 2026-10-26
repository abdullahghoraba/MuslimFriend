import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SettingsService } from '../core/services/settings.service';
import { PrayerService } from '../core/prayer/prayer.service';
import { daysBetween, formatHijri, upcomingOccasions } from '../core/prayer/islamic-calendar';
import { intlLocale } from '../core/models';

/** How far ahead the Home date line announces an occasion ("Arafah in 3 days"). */
const SOON_DAYS = 10;

@Component({
  selector:'app-hijri-date', imports:[TranslatePipe, RouterLink],
  template: `<a routerLink="/occasions"><time [attr.datetime]="isoDate()" [attr.aria-label]="('hijri.label' | translate) + ': ' + hijri() + ' · ' + gregorian()"><span>{{ hijri() }}</span><span class="separator" aria-hidden="true"> · </span><span class="gregorian">{{ gregorian() }}</span></time>
    @if (soon(); as s) {
      <span class="occasion" [class.today]="s.days === 0">{{ ('calendar.names.' + s.id) | translate }} · {{ s.days === 0 ? ('hijri.today' | translate) : s.days === 1 ? ('hijri.tomorrow' | translate) : ('hijri.inDays' | translate: { count: s.days }) }}</span>
    }</a>`,
  styles:[`:host { display:block; } a { display:block; margin:8px 16px; color:var(--app-muted); text-align:center; font-size:.875rem; line-height:1.8; text-decoration:none; } time { display:inline; } .gregorian { white-space:normal; }
    .occasion { display:block; width:fit-content; margin:4px auto 0; padding:2px 12px; border-radius:999px; background:color-mix(in srgb, var(--ion-color-primary) 12%, transparent); color:var(--ion-color-primary); font-weight:600; }
    .occasion.today { background:var(--ion-color-primary); color:var(--ion-color-primary-contrast); }`]
})
export class HijriDateComponent {
  private readonly settings=inject(SettingsService);
  private readonly prayer=inject(PrayerService);
  readonly lang=computed(()=>this.settings.settings().language);
  readonly offset=computed(()=>this.prayer.prayer().hijriOffset ?? 0);
  readonly today=signal(new Date());
  readonly isoDate=computed(()=> { const d=this.today(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); });
  readonly hijri=computed(()=>formatHijri(this.today(), this.offset(), this.lang()));
  readonly gregorian=computed(()=>new Intl.DateTimeFormat(intlLocale(this.lang()).replace('-u-', '-u-ca-gregory-'),{day:'numeric',month:'long',year:'numeric'}).format(this.today()));
  /** Today's occasion, or the next one within SOON_DAYS. */
  readonly soon=computed(()=> {
    const next=upcomingOccasions(this.today(), this.offset(), SOON_DAYS + 1)[0];
    return next ? { id: next.id, days: daysBetween(this.today(), next.date) } : null;
  });
  private timer?:ReturnType<typeof setTimeout>;
  constructor() {
    const update=()=> { const now=new Date(); this.today.set(now); this.timer=setTimeout(update,new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime()-now.getTime()+50); };
    update();
    // Refresh after the app resumes across midnight while background timers were suspended.
    const resume=()=> { clearTimeout(this.timer); update(); };
    document.addEventListener('visibilitychange',resume);
    inject(DestroyRef).onDestroy(()=> {clearTimeout(this.timer); document.removeEventListener('visibilitychange',resume);});
  }
}
