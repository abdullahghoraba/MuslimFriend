import { Component } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { MawarithCaseComponent } from './mawarith-case.component';

/** حاسبة المواريث: the shares of the heirs by the Quran and the Sunnah, in the four schools. */
@Component({
  selector: 'app-mawarith',
  imports: [TranslatePipe, MawarithCaseComponent, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/more" [text]="''" [attr.aria-label]="'common.back' | translate" /></ion-buttons>
      <ion-title>{{ 'mawarith.title' | translate }}</ion-title>
    </ion-toolbar></ion-header>
    <ion-content><main>
      <p class="intro">{{ 'mawarith.intro' | translate }}</p>
      <app-mawarith-case />
      <p class="disclaimer">{{ 'mawarith.impediments' | translate }}</p>
      <p class="disclaimer">{{ 'mawarith.disclaimer' | translate }}</p>
    </main></ion-content>`,
  styles: `
    main { max-width: 760px; margin-inline: auto; padding: 8px 12px calc(32px + var(--ion-safe-area-bottom, 0px)); }
    .intro { line-height: 1.8; margin: 12px 4px; }
    .disclaimer { color: var(--app-muted); font-size: .82rem; line-height: 1.7; margin: 12px 4px; }
  `,
})
export class MawarithPage {}
