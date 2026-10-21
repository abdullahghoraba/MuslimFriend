import { Component, computed, inject, signal } from '@angular/core';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonProgressBar,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { REMOTE_TAFSIRS, RemoteTafsir, TafsirLibraryService } from '../../core/quran/tafsir-library.service';
import { SettingsService } from '../../core/services/settings.service';

/** Download extra tafsirs once and read them offline. Bundled tafsirs are always offline. */
@Component({
  selector: 'app-tafsir-library',
  imports: [
    TranslatePipe, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonListHeader,
    IonItem, IonLabel, IonNote, IonButton, IonIcon, IonProgressBar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/quran" [text]="''" [attr.aria-label]="'common.back' | translate" />
        </ion-buttons>
        <ion-title>{{ 'tafsirLib.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list inset>
        <ion-list-header>{{ 'tafsirLib.bundled' | translate }}</ion-list-header>
        @for (b of bundled(); track b) {
          <ion-item>
            <ion-icon slot="start" name="checkmark-circle" color="success" aria-hidden="true" />
            <ion-label>{{ b }}</ion-label>
            <ion-note slot="end">{{ 'tafsirLib.alwaysOffline' | translate }}</ion-note>
          </ion-item>
        }
      </ion-list>

      <ion-list inset>
        <ion-list-header>{{ 'tafsirLib.downloadable' | translate }}</ion-list-header>
        @for (t of remote; track t.apiId) {
          <ion-item lines="full">
            <ion-label class="ion-text-wrap">
              <h3>{{ name(t) }}</h3>
              <p>
                {{ 'tafsirLib.offlineCount' | translate: { n: count(t), total: 114 } }}
                · ~{{ t.sizeMb }} MB
              </p>
              @if (lib.progress()?.apiId === t.apiId) {
                <ion-progress-bar [value]="(lib.progress()?.done ?? 0) / 114" />
              }
            </ion-label>
            @if (lib.progress()?.apiId === t.apiId) {
              <ion-button slot="end" fill="clear" (click)="lib.cancelDownload()">{{ 'common.cancel' | translate }}</ion-button>
            } @else if (count(t) === 114) {
              <ion-button slot="end" fill="clear" color="danger" (click)="remove(t)" [attr.aria-label]="('common.delete' | translate) + ' ' + name(t)">
                <ion-icon slot="icon-only" name="trash-outline" aria-hidden="true" />
              </ion-button>
            } @else {
              <ion-button slot="end" fill="clear" [disabled]="!!lib.progress()" (click)="download(t)"
                          [attr.aria-label]="('tafsirLib.download' | translate) + ' ' + name(t)">
                <ion-icon slot="icon-only" name="cloud-download-outline" aria-hidden="true" />
              </ion-button>
            }
          </ion-item>
        }
        <!-- Tafsirs built into this copy of the app sit with the others, already saved. -->
        @for (t of builtIn(); track t.apiId) {
          <ion-item lines="full">
            <ion-label class="ion-text-wrap">
              <h3>{{ name(t) }}</h3>
              <p>{{ 'tafsirLib.offlineCount' | translate: { n: 114, total: 114 } }} · ~{{ t.sizeMb }} MB</p>
            </ion-label>
            <ion-button slot="end" fill="clear" color="danger" (click)="remove(t)" [attr.aria-label]="('common.delete' | translate) + ' ' + name(t)">
              <ion-icon slot="icon-only" name="trash-outline" aria-hidden="true" />
            </ion-button>
          </ion-item>
        }
      </ion-list>
      <p class="note">{{ 'tafsirLib.note' | translate }}</p>

      <ion-list inset>
        <ion-list-header>{{ 'tafsirLib.imported' | translate }}</ion-list-header>
        @for (t of fromFiles(); track t.apiId) {
          <ion-item lines="full">
            <ion-icon slot="start" name="checkmark-circle" color="success" aria-hidden="true" />
            <ion-label class="ion-text-wrap">
              <h3>{{ name(t) }}</h3>
              <p>{{ t.source || ('tafsirLib.importedFile' | translate) }} · ~{{ t.sizeMb }} MB</p>
            </ion-label>
            <ion-button slot="end" fill="clear" color="danger" (click)="remove(t)" [attr.aria-label]="('common.delete' | translate) + ' ' + name(t)">
              <ion-icon slot="icon-only" name="trash-outline" aria-hidden="true" />
            </ion-button>
          </ion-item>
        }
        <input #fileInput type="file" accept=".json,application/json" hidden (change)="importPicked($event)" />
        <ion-item button [disabled]="importing()" (click)="fileInput.click()">
          <ion-icon slot="start" name="add-outline" aria-hidden="true" />
          <ion-label>{{ (importing() ? 'tafsirLib.importing' : 'tafsirLib.import') | translate }}</ion-label>
        </ion-item>
      </ion-list>
      <p class="note">{{ 'tafsirLib.importNote' | translate }}</p>
    </ion-content>
  `,
  styles: `
    .note { margin: 4px 20px 24px; font-size: 0.85rem; color: var(--app-muted); line-height: 1.6; }
    ion-progress-bar { margin-top: 6px; }
  `,
})
export class TafsirLibraryPage {
  readonly lib = inject(TafsirLibraryService);
  private readonly settings = inject(SettingsService);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly translate = inject(TranslateService);

  readonly remote = REMOTE_TAFSIRS;
  readonly lang = computed(() => this.settings.settings().language);
  readonly bundled = computed(() =>
    this.lang() === 'ar'
      ? ['التفسير الميسر', 'تفسير الجلالين', 'الترجمة الإنجليزية (صحيح إنترناشونال)']
      : ['Al-Muyassar', 'Al-Jalalayn', 'Saheeh International (English)'],
  );

  ionViewWillEnter(): void {
    void this.lib.refreshCounts();
  }

  name(t: RemoteTafsir): string {
    return this.lang() === 'ar' ? t.nameAr : t.nameEn;
  }

  count(t: RemoteTafsir): number {
    return this.lib.offlineCounts()[t.apiId] ?? 0;
  }

  /** Built into this (personal) build: listed with the downloadable tafsirs. */
  readonly builtIn = computed(() => this.lib.imported().filter((t) => t.bundledFile));
  /** Imported by the user from a file. */
  readonly fromFiles = computed(() => this.lib.imported().filter((t) => !t.bundledFile));
  readonly importing = signal(false);

  async importPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importing.set(true);
    let message: string;
    try {
      const t = await this.lib.importFile(file);
      message = this.translate.instant('tafsirLib.importDone', { name: this.name(t) });
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      message = this.translate.instant(code === 'empty' ? 'tafsirLib.importEmpty' : 'tafsirLib.importBad');
    } finally {
      this.importing.set(false);
    }
    const toast = await this.toasts.create({ message, duration: 2600 });
    await toast.present();
  }

  async download(t: RemoteTafsir): Promise<void> {
    const ok = await this.lib.downloadAll(t.apiId);
    const toast = await this.toasts.create({
      message: this.translate.instant(ok ? 'tafsirLib.done' : 'tafsirLib.failed'),
      duration: 2200,
    });
    await toast.present();
  }

  async remove(t: RemoteTafsir): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('tafsirLib.deleteConfirm', { name: this.name(t) }),
      buttons: [
        { text: this.translate.instant('common.cancel'), role: 'cancel' },
        { text: this.translate.instant('common.delete'), role: 'destructive', handler: () => void this.lib.remove(t.apiId) },
      ],
    });
    await alert.present();
  }
}
