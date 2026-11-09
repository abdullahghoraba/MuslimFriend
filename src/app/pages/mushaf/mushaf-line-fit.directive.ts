import { AfterViewInit, Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';

/** Fits the actual rendered font, numbers and badges; never estimates Arabic glyph widths. */
@Directive({ selector: '[appMushafLineFit]' })
export class MushafLineFitDirective implements AfterViewInit, OnDestroy {
  readonly appMushafLineFit = input(1);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private resize?: ResizeObserver;
  private mutation?: MutationObserver;
  private frame = 0;
  private active = false;

  constructor() {
    effect(() => {
      this.appMushafLineFit();
      this.schedule();
    });
  }

  ngAfterViewInit(): void {
    this.active = true;
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(this.element);
    this.mutation = new MutationObserver(this.schedule);
    this.mutation.observe(this.element, { childList: true, subtree: true, characterData: true });
    document.fonts.addEventListener('loadingdone', this.schedule);
    void document.fonts.ready.then(this.schedule);
    this.schedule();
  }

  ngOnDestroy(): void {
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.mutation?.disconnect();
    document.fonts.removeEventListener('loadingdone', this.schedule);
  }

  private readonly schedule = (): void => {
    if (!this.active) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.fit());
  };

  private fit(): void {
    const el = this.element;
    if (!el.clientWidth || !el.clientHeight) return; // Ionic caches hidden pages.
    const width = el.clientWidth;
    const rowHeight = el.clientHeight / 15;
    // All measurements and the final style write happen before paint. The measuring class also
    // removes wrapping from an enlarged page, so shrinking it again cannot retain a stale fit.
    el.classList.add('measuring');
    el.style.setProperty('--line-font-size', '32px');
    let widest = 0;
    for (const row of el.querySelectorAll<HTMLElement>('.text-line, .basmala-line')) {
      const cells = [...row.children] as HTMLElement[];
      const natural = cells.reduce((sum, cell) => sum + cell.getBoundingClientRect().width, 0);
      widest = Math.max(widest, natural + Math.max(0, cells.length - 1) * 32 * 0.16);
    }
    // Leave subpixel room at both edges and enough height for Amiri Quran's stacked marks.
    const base = Math.min(32 * (width - 2) / Math.max(1, widest), rowHeight / 2.15);
    const size = base * this.appMushafLineFit();
    const wraps = widest * size / 32 > width || size * 2.15 > rowHeight + 0.5;
    el.style.setProperty('--line-font-size', `${size}px`);
    el.style.setProperty('--printed-row-height', `${rowHeight}px`);
    el.classList.toggle('wrap-lines', wraps);
    el.classList.remove('measuring');
  }
}
