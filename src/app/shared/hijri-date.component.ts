import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SettingsService } from '../core/services/settings.service';

@Component({
  selector:'app-hijri-date', imports:[TranslatePipe],
  template: `<p [attr.dir]="lang() === 'ar' ? 'rtl' : 'ltr'"><time [attr.datetime]="isoDate()" [attr.aria-label]="('hijri.label' | translate) + ': ' + hijri() + ' · ' + gregorian()"><span>{{ hijri() }}</span><span class="separator" aria-hidden="true"> · </span><span class="gregorian">{{ gregorian() }}</span></time></p>`,
  styles:[`:host { display:block; } p { margin:8px 16px; color:var(--app-muted); text-align:center; font-size:.875rem; line-height:1.8; } time { display:inline; } .gregorian { white-space:normal; }`]
})
export class HijriDateComponent {
  private readonly settings=inject(SettingsService);
  readonly lang=computed(()=>this.settings.settings().language);
  readonly today=signal(new Date());
  readonly isoDate=computed(()=> { const d=this.today(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); });
  readonly hijri=computed(()=>new Intl.DateTimeFormat(this.lang()==='ar' ? 'ar-SA-u-ca-islamic-umalqura' : 'en-u-ca-islamic-umalqura',{day:'numeric',month:'long',year:'numeric'}).format(this.today()));
  readonly gregorian=computed(()=>new Intl.DateTimeFormat(this.lang()==='ar' ? 'ar-u-ca-gregory' : 'en-u-ca-gregory',{day:'numeric',month:'long',year:'numeric'}).format(this.today()));
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
