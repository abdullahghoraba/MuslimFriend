import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { TranslateService } from '@ngx-translate/core';
import { DailyWidgetText, AthanNative } from '../../native/athan-plugin';
import { HadithLibraryService } from '../hadith/hadith-library.service';
import { Hadith, hadithText } from '../hadith/hadith.models';
import { QuranService } from '../quran/quran.service';
import { splitBasmala } from '../quran/quran-utils';
import { addDays, dateKey } from '../util/date';

const DAYS = 7;

/**
 * Sends the home-screen widgets a week of verses and hadith, so they turn to the next day at midnight without the app.
 * Today's hadith is the one Home shows (online in the reader's language when it could be fetched); the following days
 * use the bundled set.
 */
@Injectable({ providedIn: 'root' })
export class DailyWidgetService {
  private readonly quran = inject(QuranService);
  private readonly library = inject(HadithLibraryService);
  private readonly translate = inject(TranslateService);
  private last = '';

  async publish(today: Hadith | null, now = new Date()): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Promise.all([this.quran.load(), this.library.init()]);
      const days = Array.from({ length: DAYS }, (_, i) => {
        const date = addDays(now, i);
        return { date: dateKey(date), verse: this.verse(date), hadith: (i === 0 && today ? this.fromHadith(today) : this.bundled(date)) };
      });
      const t = (key: string) => this.translate.instant(key);
      const payload = { days, titles: { verse: t('quran.verseOfDay'), hadith: t('hadith.ofDay') }, appName: t('app.name') };
      const json = JSON.stringify(payload);
      if (json === this.last) return;
      this.last = json;
      await AthanNative.setDailyWidgets(payload);
    } catch (e) {
      console.warn('[widgets] could not update the daily widgets', e);
    }
  }

  private verse(date: Date): DailyWidgetText {
    const v = this.quran.verseOfDay(date);
    return {
      text: splitBasmala(v, v.text).text,
      ref: `${this.quran.sura(v.sura).name} · ${v.aya}`,
      route: `/mushaf/${this.quran.pageOf(v)}`,
    };
  }

  private fromHadith(h: Hadith): DailyWidgetText {
    return { text: hadithText(h.arabic), ref: h.authenticitySource || h.narrator || h.bookName || '', route: '/home' };
  }

  private bundled(date: Date): DailyWidgetText {
    const h = this.library.today(date);
    return { text: h ? hadithText(h.texts['ar'] ?? '') : '', ref: h ? h.authenticitySource || h.narrator : '', route: '/home' };
  }
}
