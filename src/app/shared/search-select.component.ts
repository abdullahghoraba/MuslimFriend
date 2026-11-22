import { AfterViewInit, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSearchbar, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { SearchOption, filterOptions, westernDigits } from './search-options';

export { numberOptions, suraSearchOptions } from './search-options';
export type { SearchOption } from './search-options';

/**
 * A long list to choose from, with search (the suras by name or number, an ayah by its number, a country...): in
 * place of a select that has to be scrolled through. Opens full screen with the search field ready to type in, the
 * current choice in sight.
 */
@Component({
  selector: 'app-search-picker',
  imports: [TranslatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonSearchbar, IonIcon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="modal.dismiss()">{{ 'common.cancel' | translate }}</ion-button></ion-buttons>
        <ion-title>{{ heading() }}</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar [value]="query()" (ionInput)="query.set($event.detail.value ?? '')" [placeholder]="'common.search' | translate"
                       [inputmode]="numeric() ? 'numeric' : 'text'" (keydown.enter)="pickFirst()" />
      </ion-toolbar>
    </ion-header>
    <ion-content>
      @if (numeric()) {
        <div class="grid">
          @for (o of shown(); track o.value) {
            <button type="button" class="num" [class.on]="o.value === value()" (click)="modal.dismiss(o.value)" [attr.aria-pressed]="o.value === value()">{{ o.label }}</button>
          }
        </div>
      } @else {
        <div class="list" role="listbox">
          @for (o of shown(); track o.value) {
            <button type="button" class="row" role="option" [class.on]="o.value === value()" [attr.aria-selected]="o.value === value()" (click)="modal.dismiss(o.value)">
              <span class="text"><span class="label">{{ o.label }}</span>@if (o.hint) {<span class="hint">{{ o.hint }}</span>}</span>
              @if (o.value === value()) { <ion-icon name="checkmark" aria-hidden="true" /> }
            </button>
          }
        </div>
      }
      @if (!shown().length) { <p class="none">{{ 'common.noResults' | translate }}</p> }
    </ion-content>
  `,
  styles: `
    ion-content { --background: var(--ion-background-color, #fff); }
    .list { display: flex; flex-direction: column; padding: 4px 0 24px; }
    .row { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 16px; border: 0; border-bottom: 1px solid var(--app-border);
      background: transparent; color: var(--ion-text-color); font: inherit; text-align: start; }
    .row.on { background: color-mix(in srgb, var(--ion-color-primary) 10%, transparent); }
    .row ion-icon { margin-inline-start: auto; color: var(--ion-color-primary); font-size: 1.3rem; }
    .text { display: flex; flex-direction: column; gap: 2px; }
    .label { font-size: 1.05rem; }
    .hint { font-size: 0.8rem; color: var(--app-muted); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); gap: 8px; padding: 12px 12px 24px; }
    .num { height: 48px; border-radius: 12px; border: 1px solid var(--app-border); background: var(--app-surface); color: var(--ion-text-color); font: inherit; font-size: 1.05rem; }
    .num.on { background: var(--ion-color-primary); color: var(--ion-color-primary-contrast, #fff); border-color: var(--ion-color-primary); }
    .none { text-align: center; color: var(--app-muted); padding: 24px; }
  `,
})
export class SearchPickerComponent implements AfterViewInit {
  readonly modal = inject(ModalController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Given by the modal's componentProps (passed as inputs). */
  readonly heading = input('');
  readonly options = input<readonly SearchOption[]>([]);
  readonly value = input<string | number | null>(null);
  readonly query = signal('');
  readonly numeric = computed(() => this.options().length > 0 && this.options().every((o) => /^\d+$/.test(westernDigits(o.label))));
  readonly shown = computed(() => filterOptions(this.options(), this.query()));

  ngAfterViewInit(): void {
    // The current choice in sight, and the field ready to type in.
    setTimeout(() => {
      this.host.nativeElement.querySelector('.on')?.scrollIntoView({ block: 'center' });
      void this.host.nativeElement.querySelector('ion-searchbar')?.setFocus();
    }, 300);
  }

  pickFirst(): void {
    const first = this.shown()[0];
    if (first) void this.modal.dismiss(first.value);
  }
}

/**
 * The field that opens the searchable list: its label and the current choice, as a select shows them.
 * Emits (changed) with the value chosen.
 */
@Component({
  selector: 'app-search-select',
  imports: [IonIcon],
  template: `
    <button type="button" class="ss" [class.stacked]="stacked()" [disabled]="disabled()" (click)="open()"
            [attr.aria-label]="label() + ': ' + (current()?.label ?? '')" aria-haspopup="dialog">
      <span class="ss-label">{{ label() }}</span>
      <span class="ss-value">{{ current()?.label ?? '' }}</span>
      <ion-icon name="chevron-down" aria-hidden="true" />
    </button>
  `,
  styles: `
    :host { display: block; flex: 1; min-width: 0; }
    .ss { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 0; border: 0; background: transparent;
      color: var(--ion-text-color); font: inherit; text-align: start; cursor: pointer; }
    .ss:disabled { opacity: 0.5; }
    .ss-label { flex: 1; }
    .ss-value { color: var(--ion-color-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
    ion-icon { color: var(--app-muted); font-size: 0.9rem; flex: none; }
    .ss.stacked { flex-wrap: wrap; }
    .ss.stacked .ss-label { flex-basis: 100%; font-size: 0.8rem; color: var(--app-muted); }
    .ss.stacked .ss-value { flex: 1; max-width: none; }
  `,
})
export class SearchSelectComponent {
  private readonly modals = inject(ModalController);
  readonly label = input('');
  readonly value = input<string | number | null>(null);
  readonly options = input<readonly SearchOption[]>([]);
  readonly disabled = input(false);
  readonly stacked = input(false);
  readonly changed = output<string | number>();
  readonly current = computed(() => this.options().find((o) => o.value === this.value()));

  async open(): Promise<void> {
    const modal = await this.modals.create({
      component: SearchPickerComponent,
      componentProps: { heading: this.label(), options: this.options(), value: this.value() },
    });
    await modal.present();
    const { data } = await modal.onWillDismiss<string | number>();
    if (data !== undefined && data !== null && data !== this.value()) this.changed.emit(data);
  }
}

