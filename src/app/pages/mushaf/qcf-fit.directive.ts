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
    // The whole page on the screen, as a printed page (and as Quran for Android and Ayah show it): the type is as
    // large as both the width and the height allow, so the page never scrolls and every ayah keeps its place. The
    // page's rows (15, or 8 on pages 1 and 2) share the height between the toolbar and the page number.
    const rows = el.querySelectorAll(':scope > .print-line, :scope > .print-basmala, :scope > .print-title').length;
    const content = el.closest('ion-content') as HTMLElement | null;
    const footer = el.parentElement?.querySelector<HTMLElement>(':scope > .page-footer');
    const surface = el.parentElement;
    const pad = surface ? parseFloat(getComputedStyle(surface).paddingTop) + parseFloat(getComputedStyle(surface).paddingBottom) : 0;
    const free = (content?.clientHeight || window.innerHeight) - (footer?.offsetHeight ?? PAGE_FOOTER) - pad - 8;
    const byWidth = (REF * (width - 2)) / widest;
    // Rows at least 1.7 times the type size (the print's spacing; less and the marks of two lines touch).
    const byHeight = rows ? free / rows / 1.7 : byWidth;
    const size = Math.max(8, Math.min(byWidth, byHeight));
    el.style.setProperty('--qcf-size', `${size}px`);
    if (rows) el.style.setProperty('--qcf-row', `${Math.min(size * 2.6, free / rows)}px`);
    // Held by the height: a narrower page, centred, its lines as wide as the widest line at this size.
    if (size < byWidth) el.style.setProperty('--qcf-width', `${Math.ceil((widest * size) / REF) + 2}px`);
    else el.style.removeProperty('--qcf-width');
    // A sura's short closing line is centred in the print (its glyphs are not drawn to fill the line): every other line
    // is within about 4% of the widest and is spread across the page.
    lines.forEach((line, i) => line.classList.toggle('short', widths[i] < widest * 0.92));
    this.mutation?.takeRecords();
  }
}
