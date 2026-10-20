import { Component, TemplateRef, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { IonIcon } from '@ionic/angular';
import { Dhikr } from '../../core/models';

@Component({
  selector: 'app-single-view',
  imports: [NgTemplateOutlet, TranslatePipe, IonIcon],
  template: `
    <section class="single" (touchstart)="touchStart($event)" (touchend)="touchEnd($event)" (touchcancel)="cancelTouch()">
      <nav [attr.aria-label]="'athkarPrefs.single' | translate">
        <button type="button" [disabled]="index() === 0" (click)="move(-1)" [attr.aria-label]="'category.previousDhikr' | translate">
          <ion-icon [name]="rtl() ? 'chevron-forward' : 'chevron-back'" />
        </button>
        <span aria-live="polite" dir="ltr">{{ index() + 1 }} / {{ items().length }}</span>
        <button type="button" [disabled]="index() >= items().length - 1" (click)="move(1)" [attr.aria-label]="'category.nextDhikr' | translate">
          <ion-icon [name]="rtl() ? 'chevron-back' : 'chevron-forward'" />
        </button>
      </nav>
      <ng-container *ngTemplateOutlet="card(); context: { $implicit: items()[index()], index: index() }" />
    </section>
  `,
  styles: [`
    :host { display: block; }
    .single { min-height: 65dvh; padding: 12px; touch-action: pan-y; }
    nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; color: var(--app-muted); }
    button { min-width: 48px; min-height: 48px; border: 1px solid var(--app-border); border-radius: 12px; background: var(--app-surface-strong); color: var(--ion-color-primary); }
    button:disabled { opacity: .35; }
    ion-icon { font-size: 24px; }
  `],
})
export class SingleViewComponent {
  readonly items = input.required<Dhikr[]>();
  readonly index = input(0);
  readonly rtl = input(false);
  readonly card = input.required<TemplateRef<{ $implicit: Dhikr; index: number }>>();
  readonly moved = output<number>();
  private start: { x: number; y: number } | null = null;
  move(delta: number): void {
    const next = this.index() + delta;
    if (next >= 0 && next < this.items().length) this.moved.emit(next);
  }
  touchStart(event: TouchEvent): void {
    const t = event.touches[0];
    this.start = t ? { x: t.clientX, y: t.clientY } : null;
  }
  touchEnd(event: TouchEvent): void {
    const t = event.changedTouches[0], start = this.start;
    this.start = null;
    if (!t || !start) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    // Swiping left moves forward through the Arabic book as well as the English list.
    if (event.cancelable) event.preventDefault();
    this.move(dx < 0 ? 1 : -1);
  }
  cancelTouch(): void { this.start = null; }
}
