import metaJson from '../../../../public/assets/quran/meta.json';
import { QuranMeta, SuraMeta, BASMALA, TOTAL_AYAT, TOTAL_PAGES, globalIndex, refAt, pageOf, juzOf, pageRange, splitBasmala, normalizeArabic, verseOfDayIndex } from './quran-utils';

const meta=metaJson as QuranMeta;
const fake:QuranMeta={...meta,suras:[{...meta.suras[0],index:1,start:0,ayas:3},{...meta.suras[1],index:2,start:3,ayas:2},{...meta.suras[2],index:3,start:5,ayas:4}] as SuraMeta[]};

describe('Quran reference helpers',()=> {
  it('round-trips every ayah in a small metadata fixture, including surah boundaries',()=> {
    for(let index=0;index<9;index++) expect(globalIndex(fake,refAt(fake,index))).toBe(index);
    for(const sura of fake.suras) for(let aya=1;aya<=sura.ayas;aya++) {
      const ref={sura:sura.index,aya}; expect(refAt(fake,globalIndex(fake,ref))).toEqual(ref);
    }
    expect(refAt(fake,3)).toEqual({sura:2,aya:1});
    expect(refAt(fake,8)).toEqual({sura:3,aya:4});
  });
  it('matches the real Madani page and juz boundaries',()=> {
    expect(TOTAL_PAGES).toBe(604);
    expect(meta.pages).toHaveLength(604);
    expect(pageOf(meta,{sura:2,aya:255})).toBe(42);
    expect(juzOf(meta,{sura:2,aya:142})).toBe(2);
    const [from,to]=pageRange(meta,1);
    expect(refAt(meta,from)).toEqual({sura:1,aya:1});
    expect(refAt(meta,to-1)).toEqual({sura:1,aya:7});
    expect(to-from).toBe(7);
  });
});
describe('splitBasmala',()=> {
  const text=BASMALA+' الم';
  it('removes only a prefixed basmala on the first ayah',()=> {
    expect(splitBasmala({sura:2,aya:1},text)).toEqual({basmala:true,basmalaText:BASMALA,text:'الم'});
    expect(splitBasmala({sura:114,aya:1},text)).toEqual({basmala:true,basmalaText:BASMALA,text:'الم'});
    expect(splitBasmala({sura:2,aya:2},text)).toEqual({basmala:false,basmalaText:'',text});
  });
  it('preserves Al-Fatiha, At-Tawbah, unprefixed and standalone basmala text',()=> {
    for(const sura of [1,9]) expect(splitBasmala({sura,aya:1},text)).toEqual({basmala:false,basmalaText:'',text});
    expect(splitBasmala({sura:2,aya:1},'الم')).toEqual({basmala:false,basmalaText:'',text:'الم'});
    expect(splitBasmala({sura:2,aya:1},BASMALA)).toEqual({basmala:false,basmalaText:'',text:BASMALA});
  });
});
describe('Arabic search',()=> {
  it('strips Quranic marks and tatweel',()=> {expect(normalizeArabic('ٱلرَّحْمَـٰنِ')).toBe('الرحمن');});
  it('unifies alef, hamza carriers, yaa and taa marbuta',()=> {
    expect(normalizeArabic('آأإٱ ؤ ئ ى ة')).toBe('اااا و ي ي ه');
    expect(normalizeArabic('  رَحْمَةٌ   ۞  ')).toBe('رحمه');
  });
});
describe('verseOfDayIndex',()=> {
  const texts=Array.from({length:TOTAL_AYAT},()=> 'آية قصيرة');
  it('is stable throughout the local calendar day and changes the next day',()=> {
    const morning=verseOfDayIndex(new Date(2026,9,20,0,1),texts);
    expect(verseOfDayIndex(new Date(2026,9,20,23,59),texts)).toBe(morning);
    expect(verseOfDayIndex(new Date(2026,9,21,0,1),texts)).not.toBe(morning);
    expect(morning).toBeGreaterThanOrEqual(0); expect(morning).toBeLessThan(TOTAL_AYAT);
  });
  it('skips very long verses deterministically',()=> {
    const day=new Date(2026,9,20); const index=verseOfDayIndex(day,texts);
    const long=[...texts]; long[index]='ا'.repeat(261);
    expect(verseOfDayIndex(day,long)).toBe((index+97)%TOTAL_AYAT);
  });
});
