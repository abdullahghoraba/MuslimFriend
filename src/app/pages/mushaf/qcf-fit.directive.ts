import { AfterViewInit, Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';

/** Room kept below the page for the page number and its turn buttons. */
const PAGE_FOOTER = 84;

/**
 * Sizes a printed page («صفحة كالمطبوع») to the screen. Its lines are set in the King Fahd Complex's page font, where
 * every full line of a page measures the same, so the page only has to be scaled: the font size makes the widest line
 * fill the width, and the others (which differ by about 1%) are spread over it. Nothing is drawn out or respaced.
 */
@Directive({ selector: '[appQcfFit]' })
export class QcfFitDirective implements AfterViewInit, OnDestroy {
  /** The page's font family ('' until it has loaded). */
  readonly appQcfFit = input('');
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private resize?: ResizeObserver;
  private mutation?: MutationObserver;
  private frame = 0;
  private active = false;

  constructor() {
    effect(() => {
      this.appQcfFit();
      this.schedule();
    });
  }

  ngAfterViewInit(): void {
    this.active = true;
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(this.element);
    this.mutation = new MutationObserver(this.schedule);
    this.mutation.observe(this.element, { childList: true, subtree: true });
    window.addEventListener('resize', this.schedule);
    this.schedule();
  }

  ngOnDestroy(): void {
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.mutation?.disconnect();
    window.removeEventListener('resize', this.schedule);
  }

  private readonly schedule = (): void => {
    if (!this.active) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.fit());
  };

  private fit(): void {
    const el = this.element;
    const width = el.clientWidth;
    if (!width || !this.appQcfFit()) return;
    const REF = 40;
    // Measure each line's words at a known size, with nothing between them.
    el.classList.add('measuring');
    el.style.setProperty('--qcf-size', `${REF}px`);
    // Quran lines only: the basmala (another page's font) neither sets the size nor counts as a short line.
    const lines = [...el.querySelectorAll<HTMLElement>('.print-line:not(.print-basmala-line)')];
    const widths = lines.map((line) => [...line.children].reduce((w, word) => w + word.getBoundingClientRect().width, 0));
    const widest = Math.max(0, ...widths);
    el.classList.remove('measuring');
    if (!widest) return;
    const size = Math.max(8, (REF * (width - 2)) / widest);
    el.style.setProperty('--qcf-size', `${size}px`);
    // Rows spaced as the print spaces them: the page's rows (15, or 8 on pages 1 and 2) share the screen's height
    // below the toolbar and above the page-turn buttons, within 1.7 and 2.6 times the type size.
    const rows = el.querySelectorAll(':scope > .print-line, :scope > .print-basmala, :scope > .print-title').length;
    const top = el.closest('ion-content')?.getBoundingClientRect().top ?? 0;
    const free = window.innerHeight - top - PAGE_FOOTER;
    if (rows) el.style.setProperty('--qcf-row', `${Math.min(size * 2.6, Math.max(size * 1.7, free / rows))}px`);
    // A sura's short closing line is centred in the print (its glyphs are not drawn to fill the line): every other line
    // is within about 4% of the widest and is spread across the page.
    lines.forEach((line, i) => line.classList.toggle('short', widths[i] < widest * 0.92));
    this.mutation?.takeRecords();
  }
}
