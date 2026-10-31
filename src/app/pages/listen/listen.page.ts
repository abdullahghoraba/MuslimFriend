import { Component, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonBackButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonLabel, IonSearchbar, IonSegment,
  IonSegmentButton, IonSelect, IonSelectOption, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { SelectTextsDirective } from '../../shared/select-texts.directive';
import { TranslatePipe } from '@ngx-translate/core';
import { AudioCatalogService, FullReciter, Radio } from '../../core/audio/audio-catalog.service';
import { AudioPlayerService } from '../../core/audio/audio-player.service';
import { ListenPlayerComponent } from './listen-player.component';

/** Listen to the Quran: hundreds of reciters (whole suras) and live Quran radios. */
@Component({
  selector: 'app-listen',
  imports: [
    NgTemplateOutlet, TranslatePipe, ListenPlayerComponent, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonFooter,
    IonSegment, IonSegmentButton, IonLabel, IonSearchbar, IonIcon, IonSpinner, IonSelect, SelectTextsDirective, IonSelectOption,
  ],
  templateUrl: './listen.page.html',
  styleUrl: './listen.page.scss',
})
export class ListenPage {
  /** ?tab=riwayat opens the reciters filtered by riwayah (the ten qira'at). */
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });
  readonly catalog = inject(AudioCatalogService);
  readonly player = inject(AudioPlayerService);
  private readonly router = inject(Router);

  readonly tab = signal<'reciters' | 'radio'>('reciters');
  readonly query = signal('');
  readonly failed = signal(false);
  readonly lastReciter = signal<FullReciter | null>(null);
  /** Only reciters with a recording in this riwayah (0 = all). */
  readonly rewaya = signal(0);
  readonly showRiwayat = signal(false);

  readonly reciters = computed(() => {
    const q = this.query();
    const fav = this.player.favorites().reciters;
    const rw = this.rewaya();
    const list = this.catalog
      .reciters()
      .filter((r) => (!rw || r.moshaf.some((m) => m.rewaya === rw)) && this.catalog.matches(q, r.ar, r.en, this.catalog.reciterName(r)));
    return { favorites: list.filter((r) => fav.includes(r.id)), others: list.filter((r) => !fav.includes(r.id)) };
  });

  readonly radios = computed(() => {
    const q = this.query();
    const fav = this.player.favorites().radios;
    const list = this.catalog.radios().filter((r) => this.catalog.matches(q, r.ar, r.en, this.catalog.radioName(r)));
    return { favorites: list.filter((r) => fav.includes(r.id)), others: list.filter((r) => !fav.includes(r.id)) };
  });

  ionViewWillEnter(): void {
    if (this.tabParam() === 'riwayat') {
      this.tab.set('reciters');
      this.showRiwayat.set(true);
    }
    void this.player.init();
    this.catalog.load().then(async () => {
      const last = await this.player.last();
      this.lastReciter.set(last ? (this.catalog.reciter(last.reciter) ?? null) : null);
    }).catch(() => this.failed.set(true));
  }

  setTab(value: unknown): void {
    this.tab.set(value === 'radio' ? 'radio' : 'reciters');
  }

  openReciter(r: FullReciter): void {
    void this.router.navigate(['/listen', r.id], this.rewaya() ? { queryParams: { rewaya: this.rewaya() } } : undefined);
  }

  recordings(r: FullReciter): string {
    const rw = this.rewaya();
    return r.moshaf.filter((m) => !rw || m.rewaya === rw).map((m) => this.catalog.moshafName(m)).join(' · ');
  }

  isOn(r: Radio): boolean {
    const now = this.player.now();
    return now?.kind === 'radio' && now.radio.id === r.id;
  }

  playRadio(r: Radio): void {
    if (this.isOn(r)) this.player.toggle();
    else void this.player.playRadio(r);
  }
}
