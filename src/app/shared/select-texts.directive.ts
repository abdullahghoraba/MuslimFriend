import { Directive, ElementRef, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/**
 * Ionic draws the OK / Cancel buttons of every select's popup in English unless told otherwise; this gives each
 * ion-select it is imported next to the buttons in the app language. The language only changes with a reload.
 */
@Directive({ selector: 'ion-select' })
export class SelectTextsDirective {
  constructor() {
    const translate = inject(TranslateService);
    const select = inject<ElementRef<HTMLIonSelectElement>>(ElementRef).nativeElement;
    select.okText = translate.instant('common.ok');
    select.cancelText = translate.instant('common.cancel');
  }
}
