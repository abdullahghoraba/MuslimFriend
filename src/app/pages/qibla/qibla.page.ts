import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonButton } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Coordinates, Qibla } from 'adhan';
import { PrayerService } from '../../core/prayer/prayer.service';
import { SettingsService } from '../../core/services/settings.service';
import { HapticsService } from '../../core/services/haptics.service';

type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };
@Component({ selector:'app-qibla', imports:[RouterLink, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonButton], templateUrl:'./qibla.page.html', styleUrl:'./qibla.page.scss' })
export class QiblaPage {
  private readonly prayer=inject(PrayerService);
  private readonly settings=inject(SettingsService);
  private readonly haptics=inject(HapticsService);
  readonly lang=computed(()=>this.settings.settings().language);
  readonly location=computed(()=>this.prayer.prayer().location);
  readonly heading=signal<number | null>(null);
  readonly staticMode=signal(false);
  readonly failed=signal(false);
  readonly bearing=computed(()=> {const loc=this.location(); return loc ? Qibla(new Coordinates(loc.latitude,loc.longitude)) : 0;});
  readonly distance=computed(()=> {
    const loc=this.location(); if(!loc) return 0;
    const rad=(n:number)=>n*Math.PI/180;
    const a=Math.sin(rad(21.4225-loc.latitude)/2)**2 + Math.cos(rad(loc.latitude))*Math.cos(rad(21.4225))*Math.sin(rad(39.8262-loc.longitude)/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(Math.min(1,a)),Math.sqrt(Math.max(0,1-a)));
  });
  readonly facing=computed(()=>this.heading()!==null && Math.abs(((this.bearing()-this.heading()!+540)%360)-180)<=5);
  private timer?: ReturnType<typeof setTimeout>;
  private active=false;
  private inRange=false;
  private absoluteSeen=false;
  private readonly orientation=(event:DeviceOrientationEvent):void=> {
    if(!this.active || !this.location()) return;
    const e=event as CompassEvent;
    let heading:number | null=null;
    if(typeof e.webkitCompassHeading==='number' && Number.isFinite(e.webkitCompassHeading) && (e.webkitCompassAccuracy === undefined || e.webkitCompassAccuracy>=0)) heading=e.webkitCompassHeading;
    else if((event.type==='deviceorientationabsolute' || e.absolute) && e.alpha!==null && Number.isFinite(e.alpha)) {
      if(event.type==='deviceorientationabsolute') this.absoluteSeen=true;
      else if(this.absoluteSeen) return;
      heading=360-e.alpha;
    }
    if(heading===null) return;
    this.heading.set((heading+360)%360); this.staticMode.set(false); clearTimeout(this.timer);
    if(this.facing() && !this.inRange) this.haptics.tap();
    this.inRange=this.facing();
  };
  constructor() { inject(DestroyRef).onDestroy(()=>this.ionViewWillLeave()); }
  ionViewWillEnter():void {
    this.ionViewWillLeave(); this.active=true; this.failed.set(false); this.heading.set(null); this.staticMode.set(false); this.absoluteSeen=false;
    void this.prayer.load().catch(()=>this.failed.set(true));
    window.addEventListener('deviceorientationabsolute',this.orientation);
    window.addEventListener('deviceorientation',this.orientation);
    this.timer=setTimeout(()=> {if(this.heading()===null) this.staticMode.set(true);},2000);
  }
  ionViewWillLeave():void {
    this.active=false; clearTimeout(this.timer); this.inRange=false;
    window.removeEventListener('deviceorientationabsolute',this.orientation);
    window.removeEventListener('deviceorientation',this.orientation);
  }
  number(n:number):string { return new Intl.NumberFormat(this.lang() + '-u-nu-latn',{maximumFractionDigits:0}).format(n); }
}
