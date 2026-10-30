import { Component, computed, inject, input, signal } from '@angular/core';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonSearchbar, IonTitle, IonToolbar,
  ModalController, NavController,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { RECITERS, Reciter } from '../../core/quran/recitation.service';
import { normalizeArabic } from '../../core/quran/quran-utils';

/** Choose the verse-by-verse reciter (searchable). Dismisses with the chosen id. */
@Component({
  selector: 'app-reciter-picker',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonSearchbar, IonList, IonItem, IonLabel, IonIcon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'mushaf.reciter' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="modals.dismiss()">{{ 'common.close' | translate }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar [value]="query()" (ionInput)="query.set($event.detail.value ?? '')"
                       [placeholder]="'listen.search' | translate" [attr.aria-label]="'listen.search' | translate" />
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <p class="hint">{{ 'mushaf.reciterHint' | translate: { n: total } }}</p>
      <ion-list>
        @for (r of list(); track r.id) {
          <ion-item button [detail]="false" (click)="modals.dismiss(r.id)" [class.current]="r.id === current()">
            <ion-label>
              <h3>{{ name(r) }}</h3>
              @if (lang() !== 'ar') { <p lang="ar" dir="rtl">{{ r.nameAr }}</p> }
            </ion-label>
            @if (r.id === current()) {
              <ion-icon slot="end" name="checkmark-circle" color="primary" aria-hidden="true" />
            }
          </ion-item>
        }
      </ion-list>
      <ion-button class="more" expand="block" fill="outline" (click)="openListen()">
        <ion-icon slot="start" name="headset-outline" aria-hidden="true" />{{ 'mushaf.moreReciters' | translate }}
      </ion-button>
    </ion-content>
  `,
  styles: `
    .hint { margin: 12px 16px 0; color: var(--app-muted); font-size: 0.85rem; }
    ion-item.current { --background: color-mix(in srgb, var(--ion-color-primary) 10%, transparent); }
    .more { margin: 12px 16px calc(16px + var(--ion-safe-area-bottom, 0px)); }
  `,
})
export class ReciterPickerComponent {
  readonly current = input<string>('');
  readonly lang = input<string>('ar');

  readonly modals = inject(ModalController);
  private readonly nav = inject(NavController);
  readonly total = RECITERS.length;
  readonly query = signal('');

  readonly list = computed(() => {
    const q = this.query().trim();
    const nq = normalizeArabic(q);
    const lang = this.lang();
    return RECITERS.filter((r) => !q || normalizeArabic(r.nameAr).includes(nq) || r.nameEn.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => this.name(a).localeCompare(this.name(b), lang));
  });

  name(r: Reciter): string {
    return this.lang() === 'ar' ? r.nameAr : r.nameEn;
  }

  async openListen(): Promise<void> {
    await this.modals.dismiss();
    await this.nav.navigateForward('/listen');
  }
}
