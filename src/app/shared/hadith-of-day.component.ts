import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { HadithLibraryService } from '../core/hadith/hadith-library.service';
import { HadeethEncService, encHadith } from '../core/hadith/hadeethenc.service';
import { HadithBookmarksService } from '../core/hadith/hadith-bookmarks.service';
import { Hadith, hadithText } from '../core/hadith/hadith.models';
import { SettingsService } from '../core/services/settings.service';
import { HadithCardComponent } from '../pages/hadith/hadith-card.component';

@Component({
  selector: 'app-hadith-of-day', imports: [HadithCardComponent],
  template: `@if (hadith(); as h) { <app-hadith-card [hadith]="h" heading="hadith.ofDay" [showRead]="true" /> }`,
  styles: [':host { display:block; margin-inline:12px; }'],
})
export class HadithOfDayComponent {
  private readonly library = inject(HadithLibraryService);
  private readonly enc = inject(HadeethEncService);
  private readonly settings = inject(SettingsService);
  private readonly today = signal(new Date());
  /**
   * Today's hadith, online and kept for the day: from the encyclopedia in the reader's language (with its
   * explanation), else from al-Bukhari / Muslim; the bundled ones while offline.
   */
  private readonly online = signal<{ day: string; lang: string; hadith: Hadith } | null>(null);
  readonly hadith = computed<Hadith | null>(() => {
    const o = this.online();
    if (o && o.day === this.today().toDateString() && o.lang === this.settings.settings().language) return o.hadith;
    return this.bundled();
  });
  private readonly bundled = computed<Hadith | null>(() => {
    const h = this.library.today(this.today());
    if (!h) return null;
    const lang = this.settings.settings().language;
    const translationLang = h.texts[lang] ? lang : 'en';
    return { ...h, arabic: hadithText(h.texts['ar']), translation: lang === 'ar' ? '' : hadithText(h.texts[translationLang] ?? ''),
      translationLang, grades: [], bookName: '', bookHadith: Number(h.number), arabicNumber: h.number };
  });
  private timer?: ReturnType<typeof setTimeout>;
  constructor() {
    void this.library.init().catch(() => {});
    void inject(HadithBookmarksService).load().catch(() => {});
    // Fetch again when the day or the language changes.
    effect(() => {
      const date = this.today(), lang = this.settings.settings().language;
      void this.enc
        .daily(date, lang)
        .then((h) => encHadith(h))
        .catch(() => this.library.onlineDaily(date, lang))
        .then((hadith) => {
          if (hadith && date === this.today()) this.online.set({ day: date.toDateString(), lang, hadith });
        });
    });
    const update = () => {
      const now = new Date(); this.today.set(now);
      this.timer = setTimeout(update, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 50);
    };
    update();
    const resume = () => { clearTimeout(this.timer); update(); };
    document.addEventListener('visibilitychange', resume);
    // Offline in the morning, online later: the day's hadith from the two Sahihs replaces the bundled one.
    window.addEventListener('online', resume);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    });
  }
}
