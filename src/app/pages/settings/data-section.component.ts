import { Component, inject, signal } from '@angular/core';
import { AlertController, IonIcon, IonItem, IonLabel, IonList, IonListHeader, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BackupError, BackupService } from '../../core/services/backup.service';

@Component({
  selector: 'app-data-section',
  standalone: true,
  imports: [TranslatePipe, IonList, IonListHeader, IonItem, IonIcon, IonLabel],
  template: `
    <ion-list inset>
      <ion-list-header><ion-label>{{ 'backup.title' | translate }}</ion-label></ion-list-header>
      <ion-item button [disabled]="busy()" (click)="exportBackup()">
        <ion-icon slot="start" name="share-social-outline" aria-hidden="true" />
        <ion-label>{{ 'backup.export' | translate }}</ion-label>
      </ion-item>
      <ion-item button [disabled]="busy()" (click)="picker.click()">
        <ion-icon slot="start" name="refresh-outline" aria-hidden="true" />
        <ion-label>{{ 'backup.import' | translate }}</ion-label>
      </ion-item>
      <input #picker type="file" accept="application/json,.json" hidden (change)="importBackup(picker)" />
      <ion-item button color="danger" [disabled]="busy()" (click)="confirmReset()">
        <ion-icon slot="start" name="trash-outline" aria-hidden="true" />
        <ion-label>{{ 'backup.reset' | translate }}</ion-label>
      </ion-item>
    </ion-list>
  `,
})
export class DataSectionComponent {
  private readonly backup = inject(BackupService);
  private readonly translate = inject(TranslateService);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  readonly busy = signal(false);

  private async toast(key: string): Promise<void> {
    const toast = await this.toasts.create({ message: this.translate.instant('backup.' + key), duration: 2500 });
    await toast.present();
    await toast.onDidDismiss();
  }

  private async perform(work: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await work(); }
    catch (error) { await this.toast('error.' + (error instanceof BackupError ? error.code : 'generic')); }
    finally { this.busy.set(false); }
  }

  async exportBackup(): Promise<void> {
    await this.perform(async () => { await this.backup.exportToFile(); await this.toast('exportSuccess'); });
  }

  async importBackup(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.perform(async () => {
      await this.backup.importFromFile(file);
      await this.toast('importSuccess');
      location.reload();
    });
  }

  async confirmReset(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('backup.reset'),
      message: this.translate.instant('backup.resetWarning'),
      buttons: [
        { text: this.translate.instant('backup.cancel'), role: 'cancel' },
        { text: this.translate.instant('backup.reset'), role: 'destructive', handler: () => { void this.perform(() => this.backup.resetAll()); } },
      ],
    });
    await alert.present();
  }
}
