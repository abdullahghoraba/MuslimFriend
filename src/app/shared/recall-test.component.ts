import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { IonButton, IonIcon, IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { RecallMode, RecallSegment, RecallTest } from '../core/quran/recall-test';

/** How a test went: mistakes out of the pieces recited, and which passages had them. */
export interface RecallResult {
  units: number;
  mistakes: number;
  weak: number[];
}

/**
 * Hides a passage (ayat or a hadith) for the reader to recite from memory, revealing it piece by piece:
 * the "next" button or a tap on a hidden word. "I got it wrong" marks the piece just revealed.
 */
@Component({
  selector: 'app-recall-test',
  imports: [TranslatePipe, IonSegment, IonSegmentButton, IonLabel, IonButton, IonIcon],
  template: `
    <ion-segment [value]="mode()" (ionChange)="setMode($event.detail.value)">
      <ion-segment-button value="words"><ion-label>{{ 'recall.modeWords' | translate }}</ion-label></ion-segment-button>
      <ion-segment-button value="first"><ion-label>{{ 'recall.modeFirst' | translate }}</ion-label></ion-segment-button>
      <ion-segment-button value="whole"><ion-label>{{ (wholeKey()) | translate }}</ion-label></ion-segment-button>
    </ion-segment>
    @if (only().length) { <p class="note">{{ 'recall.onlyMistakes' | translate }}</p> }

    <div class="passage" lang="ar" dir="rtl" [class.quran]="quran()">
      @for (s of view(); track s.index) {
        <p class="segment">
          @for (u of s.units; track u.i) {
            @if (u.shown) {
              <span class="unit shown" [class.wrong]="u.wrong" [class.last]="u.last"
                    (click)="test().toggleMistake(u.i); bump()">{{ u.text }}</span>
            } @else if (u.hint) {
              <button type="button" class="unit hidden" (click)="reveal(u.i)" [attr.aria-label]="'recall.revealThis' | translate"><span class="hint">{{ u.hint }}&zwj;</span><span class="veil">&zwj;{{ u.rest }}</span></button>
            } @else {
              <button type="button" class="unit hidden" [class.whole]="mode() === 'whole'" (click)="reveal(u.i)"
                      [attr.aria-label]="'recall.revealThis' | translate"><span class="veil">{{ u.text }}</span></button>
            }
            {{ ' ' }}
          }
          @if (s.label) { <span class="label">﴿{{ s.label }}﴾</span> }
        </p>
      }
    </div>

    @if (finished(); as r) {
      <section class="result" role="status">
        <h3>{{ (r.mistakes ? 'recall.resultMistakes' : 'recall.resultPerfect') | translate: { mistakes: r.mistakes, units: r.units } }}</h3>
        <div class="row">
          <ion-button fill="outline" (click)="restart()">{{ 'recall.again' | translate }}</ion-button>
          @if (r.weak.length && r.weak.length < segments().length) {
            <ion-button (click)="retryWeak(r.weak)">{{ 'recall.retryWeak' | translate }}</ion-button>
          }
        </div>
      </section>
    } @else {
      <div class="controls">
        <span class="progress">{{ 'recall.progress' | translate: { shown: progress().shown, total: progress().total, mistakes: progress().mistakes } }}</span>
        <div class="row">
          <ion-button (click)="test().revealNext(); bump()">
            <ion-icon slot="start" name="eye-outline" aria-hidden="true" />{{ (mode() === 'whole' ? 'recall.nextWhole' : 'recall.nextWord') | translate }}
          </ion-button>
          @if (mode() !== 'whole') {
            <ion-button fill="outline" (click)="test().revealSegment(); bump()">{{ (quran() ? 'recall.restOfAyah' : 'recall.restOfText') | translate }}</ion-button>
          }
          <ion-button fill="outline" color="danger" [disabled]="test().last === null" (click)="test().toggleMistake(); bump()">
            <ion-icon slot="start" name="close-circle-outline" aria-hidden="true" />{{ 'recall.wrong' | translate }}
          </ion-button>
          <ion-button fill="clear" (click)="test().revealAll(); bump()">{{ 'recall.showAll' | translate }}</ion-button>
        </div>
        <p class="note">{{ 'recall.hint' | translate }}</p>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .note { font-size: 0.8rem; color: var(--app-muted); margin: 6px 0; }
    .passage { margin: 12px 0; font-family: 'Amiri', serif; font-size: calc(1.35rem * var(--dhikr-font-scale, 1)); line-height: 2.3; }
    .passage.quran { font-family: 'Amiri Quran', 'Amiri', serif; font-size: calc(1.5rem * var(--quran-font-scale, 1)); }
    .segment { margin: 0 0 6px; }
    .unit { font: inherit; color: inherit; background: none; border: 0; padding: 0; }
    .unit.hidden { cursor: pointer; }
    .veil { color: transparent; background: var(--app-border); border-radius: 6px; }
    .unit.whole { display: inline; }
    .hint { color: var(--ion-color-primary); }
    .shown.last { background: color-mix(in srgb, var(--ion-color-primary) 15%, transparent); border-radius: 6px; }
    .shown.wrong { color: var(--ion-color-danger); text-decoration: underline wavy var(--ion-color-danger); }
    .label { color: var(--ion-color-secondary); font-size: 0.85em; }
    .controls, .result { position: sticky; bottom: 0; padding: 8px 0 calc(8px + var(--ion-safe-area-bottom, 0px)); background: var(--ion-background-color); border-top: 1px solid var(--app-border); }
    .progress { font-size: 0.85rem; color: var(--app-muted); }
    .row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .row ion-button { margin: 0; }
    .result h3 { margin: 4px 0; font-size: 1rem; }
  `,
})
export class RecallTestComponent {
  readonly segments = input.required<RecallSegment[]>();
  /** Ayat: the Quran font, and "the whole ayah" wording. */
  readonly quran = input(false);
  readonly finishedTest = output<RecallResult>();

  readonly mode = signal<RecallMode>('words');
  /** Re-testing only these segments (the ones with mistakes). */
  readonly only = signal<number[]>([]);
  private readonly tick = signal(0);
  readonly test = signal(new RecallTest([], 'words'));
  private reported = false;

  readonly wholeKey = computed(() => (this.quran() ? 'recall.modeWholeAyah' : 'recall.modeWholeText'));

  constructor() {
    effect(() => {
      const segs = this.segments(), mode = this.mode(), only = this.only();
      untracked(() => this.build(only.length ? only.map((i) => segs[i]) : segs, mode));
    });
  }

  readonly view = computed(() => {
    this.tick();
    const t = this.test();
    return t.segments.map((s, index) => ({
      index,
      label: s.label,
      units: t.units.flatMap((u, i) => {
        if (u.segment !== index) return [];
        const shown = t.revealed.has(i);
        const at = u.hint ? u.text.indexOf(u.hint) : -1;
        return [{ i, text: u.text, shown, wrong: t.mistakes.has(i), last: t.last === i, hint: u.hint, rest: at >= 0 ? u.text.slice(at + u.hint.length) : '' }];
      }),
    }));
  });

  readonly progress = computed(() => {
    this.tick();
    const t = this.test();
    return { shown: t.revealed.size, total: t.units.length, mistakes: t.mistakes.size };
  });

  readonly finished = computed<RecallResult | null>(() => {
    this.tick();
    const t = this.test();
    if (!t.units.length || !t.done) return null;
    const only = this.only();
    const weak = only.length ? t.weakSegments.map((i) => only[i]) : t.weakSegments;
    return { units: t.units.length, mistakes: t.mistakes.size, weak };
  });

  setMode(value: unknown): void {
    if (value === 'words' || value === 'first' || value === 'whole') this.mode.set(value);
  }

  reveal(i: number): void {
    this.test().reveal(i);
    this.bump();
  }

  bump(): void {
    this.tick.update((n) => n + 1);
    const r = this.finished();
    if (r && !this.reported) {
      this.reported = true;
      this.finishedTest.emit(r);
    }
  }

  restart(): void {
    this.only.set([]);
    this.build(this.segments(), this.mode());
  }

  retryWeak(weak: number[]): void {
    this.only.set(weak);
  }

  private build(segments: RecallSegment[], mode: RecallMode): void {
    this.test.set(new RecallTest(segments, mode));
    this.reported = false;
    this.tick.update((n) => n + 1);
  }
}
