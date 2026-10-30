import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList, IonSearchbar, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { EncCategory, HadeethEncService } from '../../core/hadith/hadeethenc.service';
import { normalizeHadith } from '../../core/hadith/hadith.models';
import { SettingsService } from '../../core/services/settings.service';

/** Hadith by topic in the reader's language (HadeethEnc.com): the topic tree, then a topic's hadith. */
@Component({
  selector: 'app-hadith-topics',
  imports: [RouterLink, TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem, IonLabel, IonButton, IonSpinner, IonSearchbar],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button [defaultHref]="category() ? '/hadith/topics' : '/hadith'" [text]="''" [attr.aria-label]="'common.back' | translate" /></ion-buttons>
      <ion-title>{{ current()?.title || ('hadith.topics' | translate) }}</ion-title>
    </ion-toolbar></ion-header>
    <ion-content><main>
      @if (!category()) {
        <p class="muted">{{ 'hadith.topicsHint' | translate }}</p>
        <ion-searchbar [value]="filter()" (ionInput)="filter.set($event.detail.value ?? '')" [placeholder]="'hadith.searchTopics' | translate"
                       [attr.aria-label]="'hadith.searchTopics' | translate" />
      }
      @if (failed()) {
        <div class="state" role="alert"><p>{{ 'hadith.onlineUnavailable' | translate }}</p>
          <ion-button fill="outline" (click)="load()">{{ 'hadith.retry' | translate }}</ion-button></div>
      } @else if (loading()) {
        <div class="state"><ion-spinner /></div>
      } @else {
        @if (subtopics().length) {
          <ion-list lines="full">
            @for (c of subtopics(); track c.id) {
              <ion-item button detail [routerLink]="['/hadith/topics', c.id]">
                <ion-label><h2>{{ c.title }}</h2><p>{{ 'hadith.count' | translate: { count: c.count } }}</p></ion-label>
              </ion-item>
            }
          </ion-list>
        }
        @if (category()) {
          <ion-list lines="full">
            @for (h of items(); track h.id) {
              <ion-item button detail [routerLink]="['/hadith/enc', h.id]"><ion-label class="title">{{ h.title }}</ion-label></ion-item>
            }
          </ion-list>
          @if (page() < lastPage()) {
            <ion-button expand="block" fill="outline" [disabled]="more()" (click)="loadMore()">
              @if (more()) { <ion-spinner name="dots" /> } @else { {{ 'hadith.more' | translate }} }
            </ion-button>
          }
        }
      }
      <p class="credit">{{ 'hadith.encCredit' | translate }}</p>
    </main></ion-content>`,
  styles: `
    main { max-width: 760px; margin-inline: auto; padding: 8px 12px calc(24px + var(--ion-safe-area-bottom, 0px)); }
    .muted, .credit { color: var(--app-muted); font-size: 0.85rem; line-height: 1.6; margin: 8px 4px; }
    .credit { text-align: center; font-size: 0.75rem; margin-top: 20px; }
    .state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20vh 16px; text-align: center; }
    ion-searchbar { padding-inline: 0; }
    ion-item h2 { white-space: normal; }
    .title { white-space: normal; line-height: 1.7; }
    ion-button { margin-top: 12px; }
  `,
})
export class HadithTopicsPage {
  /** Route parameter: the topic, or none for the top of the tree. */
  readonly category = input<string | undefined>();

  private readonly enc = inject(HadeethEncService);
  private readonly settings = inject(SettingsService);
  readonly lang = computed(() => this.settings.settings().language);
  readonly categories = signal<EncCategory[]>([]);
  readonly items = signal<{ id: string; title: string }[]>([]);
  readonly page = signal(1);
  readonly lastPage = signal(1);
  readonly loading = signal(true);
  readonly more = signal(false);
  readonly failed = signal(false);
  readonly filter = signal('');

  readonly current = computed(() => this.categories().find((c) => c.id === this.category()));
  /** Topics under this one (the top topics at the root; every topic matching the filter while searching). */
  readonly subtopics = computed(() => {
    const all = this.categories().filter((c) => c.count > 0);
    const q = normalizeHadith(this.filter());
    if (!this.category() && q) return all.filter((c) => normalizeHadith(c.title).includes(q));
    return all.filter((c) => c.parent === (this.category() ?? null));
  });

  ionViewWillEnter(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      const lang = this.lang();
      this.categories.set(await this.enc.allCategories(lang));
      const id = this.category();
      if (id) {
        const first = await this.enc.list(lang, id, 1);
        this.items.set(first.items);
        this.page.set(1);
        this.lastPage.set(first.lastPage);
      }
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const id = this.category();
    if (!id || this.more()) return;
    this.more.set(true);
    try {
      const next = await this.enc.list(this.lang(), id, this.page() + 1);
      this.items.update((list) => [...list, ...next.items]);
      this.page.update((p) => p + 1);
      this.lastPage.set(next.lastPage);
    } catch {
      this.failed.set(true);
    } finally {
      this.more.set(false);
    }
  }
}
