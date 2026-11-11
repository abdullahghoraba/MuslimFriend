import { Component, input } from '@angular/core';

/**
 * A sura's title as the Madinah print draws it: an ornamental band with the sura's name in its cartouche, in Arabic
 * whatever the app's language. Takes the mushaf's colours (--m-accent, --m-frame) from the page around it.
 */
@Component({
  selector: 'app-sura-banner',
  template: `
    <div class="sura-banner" role="heading" aria-level="2" [attr.aria-label]="label()">
      <svg viewBox="0 0 400 44" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect class="band" x="1.5" y="3.5" width="397" height="37" rx="5" />
        <rect class="band-inner" x="5.5" y="7.5" width="389" height="29" rx="3" />
        <path class="cartouche" d="M108,22 C120,9.5 132,9 146,9 H254 C268,9 280,9.5 292,22 C280,34.5 268,35 254,35 H146 C132,35 120,34.5 108,22 Z" />
        @for (x of [52, 348]; track x) {
          <circle class="medallion" [attr.cx]="x" cy="22" r="11" />
          <circle class="medallion-inner" [attr.cx]="x" cy="22" r="6" />
          <circle class="dot" [attr.cx]="x" cy="22" r="1.8" />
          <path class="vine" [attr.d]="'M' + (x < 200 ? x + 13 : x - 13) + ',22 H' + (x < 200 ? 104 : 296)" />
          <path class="vine" [attr.d]="'M' + (x < 200 ? x - 13 : x + 13) + ',22 H' + (x < 200 ? 10 : 390)" />
        }
      </svg>
      @if (calligraphy()) {
        <!-- «سورة …» as one calligraphic glyph of the print's surah-name font. -->
        <span class="sura-name callig" aria-hidden="true" [style.font-family]="calligraphy()">{{ glyph() }}</span>
      } @else {
        <span class="sura-name" lang="ar" aria-hidden="true">سورة {{ name() }}</span>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .sura-banner {
      position: relative;
      width: 100%;
      aspect-ratio: 400 / 44;
      max-height: 3.2em;
      display: grid;
      place-items: center;
      container-type: size;
    }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .band { fill: color-mix(in srgb, var(--m-accent) 9%, transparent); stroke: var(--m-frame); stroke-width: 1.4; }
    .band-inner { fill: none; stroke: var(--m-frame); stroke-width: 0.6; opacity: 0.7; }
    .cartouche { fill: color-mix(in srgb, var(--m-accent) 16%, var(--m-bg, transparent)); stroke: var(--m-frame); stroke-width: 1.2; }
    .medallion { fill: color-mix(in srgb, var(--m-accent) 14%, transparent); stroke: var(--m-frame); stroke-width: 1.1; }
    .medallion-inner { fill: none; stroke: var(--m-frame); stroke-width: 0.8; }
    .dot { fill: var(--m-frame); }
    .vine { stroke: var(--m-frame); stroke-width: 0.8; opacity: 0.6; }
    .sura-name {
      position: relative;
      font-family: 'KFGQPC Hafs', 'AmiriQuran', serif;
      font-size: 0.9em;
      line-height: 1;
      color: var(--m-accent);
      white-space: nowrap;
    }
    // The calligraphic name fills the cartouche's height, as in the print.
    .sura-name.callig { font-size: 1.6em; font-size: 74cqh; line-height: 1; color: var(--m-fg); }
  `,
})
export class SuraBannerComponent {
  /** The sura's Arabic name. */
  readonly name = input.required<string>();
  /** What screen readers announce («سورة …» / «Surah …»). */
  readonly label = input.required<string>();
  /** The surah-name font's family, once loaded (else the name is lettered in the KFGQPC font). */
  readonly calligraphy = input('');
  /** The sura's glyph in that font (its number, "003"). */
  readonly glyph = input('');
}
