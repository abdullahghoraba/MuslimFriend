import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonButton } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { QuranService } from '../core/quran/quran.service';
import { SettingsService } from '../core/services/settings.service';
import { ShareService } from '../core/services/share.service';

@Component({
  selector:'app-verse-of-day', imports:[TranslatePipe, IonButton],
  template: `@if (quran.ready()) { @if (verse(); as v) { <section class="card" aria-labelledby="verse-of-day-title"><h2 id="verse-of-day-title">{{ 'quran.verseOfDay' | translate }}</h2><p class="verse" lang="ar" dir="rtl">{{ v.text }}</p><p class="reference"><span lang="ar">{{ quran.sura(v.sura).name }}</span> · {{ 'quran.ayah' | translate }} {{ digits(v.aya) }}</p><div class="actions"><ion-button fill="clear" (click)="read()">{{ 'quran.readMushaf' | translate }}</ion-button><ion-button fill="clear" [disabled]="sharing()" (click)="share()">{{ 'quran.share' | translate }}</ion-button></div>@if (shareFailed()) { <p role="status">{{ 'quran.shareFailed' | translate }}</p> }</section> } }`,
  styles:[`:host { display:block; } .card { margin:12px; padding:18px; border:1px solid var(--app-border); border-radius:18px; background:var(--app-surface); } h2 { font-size:1rem; margin:0; color:var(--ion-color-primary); } .verse { font-family:'AmiriQuran',serif; text-align:center; font-size:1.55rem; line-height:2.3; } .reference { text-align:center; color:var(--app-muted); font-size:.875rem; } .actions { display:flex; flex-wrap:wrap; justify-content:center; }`]
})
export class VerseOfDayComponent {
  readonly quran=inject(QuranService);
  private readonly settings=inject(SettingsService);
  private readonly router=inject(Router);
  private readonly shares=inject(ShareService);
  private readonly translate=inject(TranslateService);
  readonly lang=computed(()=>this.settings.settings().language);
  private readonly today=signal(new Date());
  readonly verse=computed(()=>this.quran.ready() ? this.quran.verseOfDay(this.today()) : null);
  readonly sharing=signal(false);
  readonly shareFailed=signal(false);
  private timer?:ReturnType<typeof setTimeout>;
  constructor() {
    void this.quran.load().catch(()=>{});
    const update=()=> { const now=new Date(); this.today.set(now); this.timer=setTimeout(update,new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime()-now.getTime()+50); };
    update(); const resume=()=> {clearTimeout(this.timer); update();};
    document.addEventListener('visibilitychange',resume);
    inject(DestroyRef).onDestroy(()=> {clearTimeout(this.timer); document.removeEventListener('visibilitychange',resume);});
  }
  digits(n:number):string { return String(n); }
  read():void { const v=this.verse(); if(v) void this.router.navigate(['/mushaf',this.quran.pageOf(v)],{queryParams:{sura:v.sura,aya:v.aya}}); }
  async share():Promise<void> {
    const v=this.verse(); if(!v || this.sharing()) return;
    this.sharing.set(true); this.shareFailed.set(false);
    const app=this.lang()==='ar' ? 'رفيق المسلم' : 'Muslim Friend';
    const ref=this.quran.sura(v.sura).name+' · '+this.translate.instant('quran.ayah')+' '+this.digits(v.aya);
    try { await this.shares.shareText(app,v.text+'\n'+ref+'\n'+app); } catch { this.shareFailed.set(true); } finally { this.sharing.set(false); }
  }
}
