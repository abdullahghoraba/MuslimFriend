import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonProgressBar, IonSearchbar, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { HadithLibraryService } from '../../core/hadith/hadith-library.service';
import { HadithBookmarksService } from '../../core/hadith/hadith-bookmarks.service';
import { Hadith, HadithPosition, bookmarkHadith, hadithLink, normalizeHadith } from '../../core/hadith/hadith.models';
import { DorarService, dorarHadith } from '../../core/hadith/dorar.service';
import { SettingsService } from '../../core/services/settings.service';
import { HadithCardComponent } from './hadith-card.component';

@Component({
  selector: 'app-hadith',
  imports: [RouterLink, TranslatePipe, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonProgressBar, IonSearchbar, IonSpinner, IonTitle, IonToolbar, HadithCardComponent],
  templateUrl: './hadith.page.html', styleUrl: './hadith.page.scss',
})
export class HadithPage {
  readonly library = inject(HadithLibraryService);
  readonly marks = inject(HadithBookmarksService);
  private readonly dorar = inject(DorarService);
  private readonly settings = inject(SettingsService);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  readonly content = viewChild(IonContent);
  readonly lang = computed(() => this.settings.settings().language);
  readonly id = computed(() => this.params().get('collection') ?? '');
  readonly book = computed(() => this.params().get('book'));
  readonly number = computed(() => this.params().get('number'));
  readonly bookmarksMode = this.route.snapshot.data['bookmarks'] === true;
  readonly collection = computed(() => this.library.find(this.id()));
  readonly rows = signal<Hadith[]>([]);
  readonly page = signal(0);
  readonly pageSize = 12;
  readonly visible = computed(() => this.rows().slice(this.page() * this.pageSize, (this.page() + 1) * this.pageSize));
  readonly pages = computed(() => Math.ceil(this.rows().length / this.pageSize));
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');
  readonly query = signal('');
  readonly searching = signal(false);
  readonly results = signal<Hadith[]>([]);
  readonly searchPage = signal(0);
  readonly searchResults = computed(() => this.results().slice(this.searchPage() * 20, (this.searchPage() + 1) * 20));
  readonly searchPages = computed(() => Math.ceil(this.results().length / 20));
  readonly missingLanguage = signal(false);
  readonly sections = signal<{ id: number; name: string; count: number }[]>([]);
  readonly link = hadithLink;
  /** Saved hadith, searchable by their text, translation, source and note. */
  readonly savedQuery = signal('');
  readonly savedList = computed(() => {
    const words = normalizeHadith(this.savedQuery()).split(' ').filter(Boolean);
    return this.marks
      .bookmarks()
      .filter((b) => { const t = normalizeHadith(`${b.arabic} ${b.translation} ${b.source} ${b.note}`); return words.every((w) => t.includes(w)); })
      .map((b) => bookmarkHadith(b, this.lang()));
  });
  /** The same search in every hadith book of the Dorar encyclopedia (online), with each scholar's ruling. */
  readonly onlineResults = signal<Hadith[] | null>(null);
  readonly onlineSearching = signal(false);
  readonly onlineFailed = signal(false);
  private searchController?: AbortController;
  private generation = 0;

  constructor() {
    effect(() => {
      const lang = this.lang(), id = this.id(), book = this.book(), number = this.number();
      untracked(() => {
        void this.refresh(lang, id, book, number);
        if (!id && this.query().trim().length >= 2) void this.search(this.query());
      });
    });
    inject(DestroyRef).onDestroy(() => { this.generation++; this.searchController?.abort(); });
  }
  ionViewWillEnter(): void { void this.marks.load().catch(() => this.error.set('hadith.loadFailed')); }
  async refresh(lang = this.lang(), id = this.id(), book = this.book(), number = this.number()): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true); this.error.set(''); this.rows.set([]); this.page.set(0);
    try {
      await Promise.all([this.library.init(), this.marks.load()]);
      if (generation !== this.generation) return;
      if (id) {
        if (!this.library.find(id)) throw Error('collection-missing');
        const pack = await this.library.package(id);
        const all = pack ? await this.library.hadiths(id, lang) : [];
        if (generation !== this.generation) return;
        const names = (pack?.editions[lang] ?? pack?.editions['en'] ?? pack?.editions['ar'])?.metadata.sections;
        this.sections.set(this.collection()!.sections.map((section) => ({ ...section, name: names?.[String(section.id)] || section.name })));
        this.missingLanguage.set(!!pack && lang !== 'ar' && !pack.editions[lang] && !!this.collection()?.editions[lang]);
        if (book !== null) {
          const rows = all.filter((h) => String(h.book) === book);
          this.rows.set(rows);
          const index = number ? rows.findIndex((h) => h.number === number) : 0;
          if (pack && (index < 0 || !rows.length)) this.error.set('hadith.notFound');
          this.page.set(Math.max(0, Math.floor(index / this.pageSize)));
          if (rows[Math.max(0, index)]) await this.marks.remember(rows[Math.max(0, index)]);
          this.scrollTo(number);
        }
      }
    } catch { if (generation === this.generation) this.error.set('hadith.loadFailed'); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  private scrollTo(number: string | null): void {
    afterNextRender(() => {
      if (number) this.host.nativeElement.querySelector(`#${CSS.escape(`hadith-${number}`)}`)?.scrollIntoView({ block: 'start' });
      else void this.content()?.scrollToTop(0);
    }, { injector: this.injector });
  }
  async changePage(delta: number): Promise<void> {
    const page = Math.max(0, Math.min(this.pages() - 1, this.page() + delta)); this.page.set(page);
    const first = this.visible()[0];
    if (first) await this.marks.remember(first).catch(() => this.error.set('hadith.actionFailed'));
    void this.content()?.scrollToTop(0);
  }
  rememberVisible(): void {
    const top = this.host.nativeElement.querySelector('ion-header')?.getBoundingClientRect().bottom ?? 0;
    const h = this.visible().find((row) => {
      const bounds = this.host.nativeElement.querySelector(`#${CSS.escape(`hadith-${row.number}`)}`)?.getBoundingClientRect();
      return bounds && bounds.bottom > top + 100 && bounds.top < window.innerHeight;
    });
    if (h) void this.marks.remember(h).catch(() => this.error.set('hadith.actionFailed'));
  }
  async search(value: string): Promise<void> {
    this.query.set(value); this.searchPage.set(0); this.results.set([]); this.onlineResults.set(null); this.onlineFailed.set(false);
    this.searchController?.abort();
    if (value.trim().length < 2) { this.searching.set(false); this.onlineSearching.set(false); return; }
    const controller = new AbortController(); this.searchController = controller;
    this.searching.set(true); this.error.set('');
    try {
      const results = await this.library.search(value, this.lang(), controller.signal);
      if (!controller.signal.aborted) this.results.set(results);
    } catch { if (!controller.signal.aborted) this.error.set('hadith.loadFailed'); }
    finally { if (!controller.signal.aborted) this.searching.set(false); }
  }
  /** Only when the user asks: the search words go to dorar.net (said in the privacy policy). */
  async searchOnline(): Promise<void> {
    const value = this.query();
    const controller = this.searchController;
    if (value.trim().length < 2 || this.onlineSearching()) return;
    this.onlineSearching.set(true); this.onlineFailed.set(false);
    try {
      const found = await this.dorar.search(value);
      if (this.query() === value && !controller?.signal.aborted) this.onlineResults.set(found.map(dorarHadith));
    } catch { if (this.query() === value) this.onlineFailed.set(true); }
    finally { this.onlineSearching.set(false); }
  }
  async download(id: string): Promise<void> {
    this.error.set(''); this.notice.set('');
    try {
      const result = await this.library.download(id, this.lang());
      this.notice.set(result === 'complete' ? 'hadith.downloaded' : 'hadith.cancelled');
      if (this.id() === id) await this.refresh();
    } catch { this.error.set('hadith.downloadFailed'); }
  }
  async remove(id: string): Promise<void> {
    this.error.set('');
    try { await this.library.remove(id); if (this.id() === id) await this.refresh(); }
    catch { this.error.set('hadith.actionFailed'); }
  }
  async unbookmark(h: HadithPosition): Promise<void> {
    try { await this.marks.remove(h); } catch { this.error.set('hadith.actionFailed'); }
  }
  back(): string { return this.book() !== null ? `/hadith/${this.id()}` : this.id() || this.bookmarksMode ? '/hadith' : '/home'; }
}
