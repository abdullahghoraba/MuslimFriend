import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonSearchbar, IonSpinner, IonButton, IonIcon } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { AudioCatalogService, FullReciter } from '../../core/audio/audio-catalog.service';
import { QuranService } from '../../core/quran/quran.service';
import { AyahRef, TOTAL_PAGES, normalizeArabic, quranSearchKey } from '../../core/quran/quran-utils';
import { SettingsService } from '../../core/services/settings.service';

/**
 * One search for the Quran: ayat (the exact words, or else all the words in any order), surahs by name or number,
 * reciters by name (any spelling), a page number, or a reference like 2:255.
 */
@Component({ selector:'app-quran-search', imports:[TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonSearchbar, IonSpinner, IonButton, IonIcon], templateUrl:'./quran-search.page.html', styleUrl:'./quran-search.page.scss' })
export class QuranSearchPage {
  readonly quran=inject(QuranService);
  readonly catalog=inject(AudioCatalogService);
  private readonly settings=inject(SettingsService);
  private readonly router=inject(Router);
  readonly searchbar=viewChild(IonSearchbar);
  readonly lang=computed(() => this.settings.settings().language);
  readonly query=signal('');
  readonly failed=signal(false);
  private readonly latinDigits=computed(() => this.query().trim().replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  readonly direct=computed<AyahRef | null>(() => {
    if (!this.quran.ready()) return null;
    const match=/^(\d+)\s*[:：]\s*(\d+)$/.exec(this.latinDigits());
    if (!match) return null;
    const sura=Number(match[1]), aya=Number(match[2]);
    return sura>=1 && sura<=114 && aya>=1 && aya<=this.quran.sura(sura).ayas ? {sura,aya} : null;
  });
  /** A bare number: that page of the mushaf (and the sura with that number, below). */
  readonly pageNumber=computed(() => {
    const value=this.latinDigits();
    return /^\d{1,3}$/.test(value) && Number(value)>=1 && Number(value)<=TOTAL_PAGES ? Number(value) : null;
  });
  readonly suraHits=computed(() => this.quran.ready() && !this.direct() && this.query().trim() ? this.quran.searchSuras(this.query()).slice(0,6) : []);
  /** Reciters only for names (two letters or more), not for numbers. */
  readonly reciterHits=computed<FullReciter[]>(() => this.catalog.ready() && !this.direct() && !this.pageNumber() && this.query().trim().length>=2
    ? this.catalog.searchReciters(this.query()).slice(0,5) : []);
  private readonly phraseHits=computed(() => this.quran.ready() && !this.direct() && this.searching() ? this.quran.search(this.query(),300) : []);
  readonly count=computed(() => this.quran.ready() && !this.direct() && this.searching() ? this.quran.countMatches(this.query()) : 0);
  /** No ayah has the exact words: ayat with all of them, in any order. */
  readonly anyOrder=computed(() => this.count()===0 && normalizeArabic(this.query()).includes(' '));
  readonly hits=computed(() => {
    const words=this.anyOrder() ? normalizeArabic(this.query()).split(' ').filter(w=>w.length>=2).map(quranSearchKey) : [quranSearchKey(this.query())];
    const list=this.anyOrder() ? this.quran.searchWords(this.query(),300) : this.phraseHits();
    return list.map(hit=>({...hit,parts:highlight(hit.text,words)}));
  });
  readonly searching=computed(() => normalizeArabic(this.query()).length>=2 && /[؀-ۿ]/.test(this.query()));
  readonly anything=computed(() => !!this.query().trim());
  ionViewWillEnter(): void {
    this.quran.load().catch(()=>this.failed.set(true));
    // The reciters' names are a small file in the app; a failure only hides the reciter results.
    this.catalog.load().catch(()=>undefined);
  }
  ionViewDidEnter(): void { void this.searchbar()?.setFocus(); }
  digits(n:number):string { return new Intl.NumberFormat(this.lang()==='ar' ? 'ar-EG' : undefined).format(n); }
  open(ref:AyahRef):void { void this.router.navigate(['/mushaf',this.quran.pageOf(ref)],{queryParams:ref}); }
  openSura(index:number):void { this.open({sura:index,aya:1}); }
  openPage(page:number):void { void this.router.navigate(['/mushaf',page]); }
  openReciter(r:FullReciter):void { void this.router.navigate(['/listen',r.id]); }
  submit():void {
    const ref=this.direct();
    if(ref) this.open(ref);
    else if(this.suraHits().length===1 && !this.searching()) this.openSura(this.suraHits()[0].index);
  }
}

/** Splits [text] into plain and highlighted parts where any of the search-key [words] occur (no HTML inserted). */
export function highlight(text:string, words:string[]): {text:string;match:boolean}[] {
  const normalized=quranSearchKey(text);
  const spans:[number,number][]=[];
  for (const q of words.filter(Boolean)) {
    for(let at=normalized.indexOf(q);at!==-1;at=normalized.indexOf(q,at+q.length)) spans.push([at,at+q.length]);
  }
  if(!spans.length) return [{text,match:false}];
  spans.sort((a,b)=>a[0]-b[0]);
  // Prefix lengths map normalised offsets back to the original text (with its tashkeel).
  // The و-for-alif rule looks one letter ahead, so it is applied to the whole ayah first (same length).
  const pre=text.replace(/و(?=ٰ)/g,'ا');
  const lengths=Array.from({length:text.length+1},(_,i)=>quranSearchKey(pre.slice(0,i)).length);
  const parts:{text:string;match:boolean}[]=[]; let cursor=0;
  for(const [from,to] of spans) {
    let start=lengths.findIndex(n=>n>from)-1;
    let end=lengths.findIndex(n=>n>=to);
    if(start<0) start=0; if(end<0) end=text.length;
    // Include trailing vocalisation marks belonging to the last matched letter.
    while(end<text.length && /[ً-ٰٟ]/.test(text[end])) end++;
    start=Math.max(cursor,start);
    if(start>cursor) parts.push({text:text.slice(cursor,start),match:false});
    if(end>start) parts.push({text:text.slice(start,end),match:true});
    cursor=Math.max(cursor,end);
  }
  if(cursor<text.length) parts.push({text:text.slice(cursor),match:false});
  return parts;
}
