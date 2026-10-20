import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonSearchbar, IonSpinner, IonButton } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { QuranService } from '../../core/quran/quran.service';
import { AyahRef, arabicDigits, normalizeArabic } from '../../core/quran/quran-utils';
import { SettingsService } from '../../core/services/settings.service';

@Component({ selector:'app-quran-search', imports:[TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonSearchbar, IonSpinner, IonButton], templateUrl:'./quran-search.page.html', styleUrl:'./quran-search.page.scss' })
export class QuranSearchPage {
  readonly quran=inject(QuranService);
  private readonly settings=inject(SettingsService);
  private readonly router=inject(Router);
  readonly searchbar=viewChild(IonSearchbar);
  readonly lang=computed(() => this.settings.settings().language);
  readonly query=signal('');
  readonly failed=signal(false);
  readonly direct=computed<AyahRef | null>(() => {
    if (!this.quran.ready()) return null;
    const value=this.query().trim().replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const match=/^(\d+)\s*:\s*(\d+)$/.exec(value);
    if (!match) return null;
    const sura=Number(match[1]), aya=Number(match[2]);
    return sura>=1 && sura<=114 && aya>=1 && aya<=this.quran.sura(sura).ayas ? {sura,aya} : null;
  });
  readonly hits=computed(() => this.quran.ready() && !this.direct() ? this.quran.search(this.query(),300).map(hit=>({...hit,parts:this.highlight(hit.text,this.query())})) : []);
  readonly count=computed(() => this.quran.ready() && !this.direct() ? this.quran.countMatches(this.query()) : 0);
  readonly searching=computed(() => normalizeArabic(this.query()).length>=2);
  ionViewWillEnter(): void { this.quran.load().catch(()=>this.failed.set(true)); }
  ionViewDidEnter(): void { void this.searchbar()?.setFocus(); }
  digits(n:number):string { return this.lang()==='ar' ? arabicDigits(n) : String(n); }
  open(ref:AyahRef):void { void this.router.navigate(['/mushaf',this.quran.pageOf(ref)],{queryParams:ref}); }
  submit():void { const ref=this.direct(); if(ref) this.open(ref); }
  // Prefix lengths map normalised offsets back to original Unicode without inserting HTML.
  private highlight(text:string,query:string): {text:string;match:boolean}[] {
    const q=normalizeArabic(query), normalized=normalizeArabic(text);
    if (!q) return [{text,match:false}];
    const positions:number[]=[];
    for(let at=normalized.indexOf(q);at!==-1;at=normalized.indexOf(q,at+q.length)) positions.push(at);
    if(!positions.length) return [{text,match:false}];
    const lengths=Array.from({length:text.length+1},(_,i)=>normalizeArabic(text.slice(0,i)).length);
    const parts:{text:string;match:boolean}[]=[]; let cursor=0;
    for(const at of positions) {
      let start=lengths.findIndex(n=>n>at)-1;
      let end=lengths.findIndex(n=>n>=at+q.length);
      if(start<0) start=0; if(end<0) end=text.length;
      // Include trailing vocalisation marks belonging to the last matched letter.
      while(end<text.length && normalizeArabic(text[end])==='') end++;
      start=Math.max(cursor,start);
      if(start>cursor) parts.push({text:text.slice(cursor,start),match:false});
      if(end>start) parts.push({text:text.slice(start,end),match:true});
      cursor=end;
    }
    if(cursor<text.length) parts.push({text:text.slice(cursor),match:false});
    return parts;
  }
}
