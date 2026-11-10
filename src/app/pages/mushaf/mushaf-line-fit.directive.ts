import { AfterViewInit, Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';
import { TATWEEL, drawOut, kashidaCounts } from '../../core/quran/madinah-page';

/**
 * Fits the actual rendered font, numbers and badges; never estimates Arabic glyph widths. On the Madinah pages in the
 * King Fahd Complex's font (class "qpc") it then fills each line as the print does: by drawing letters out with
 * tatweel (kashida) rather than by wide gaps between the words.
 */
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
    this.restoreWords();
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
    if (!wraps && el.classList.contains('qpc') && !el.classList.contains('opening-page')) this.drawOutLines(size);
    // Our own text changes are not page changes: drop them so they do not schedule another fit.
    this.mutation?.takeRecords();
  }

  /** The word's own text node (before the ayah number and badges inside the same span). */
  private static textOf(word: HTMLElement): Text | null {
    // Angular's control flow leaves comment anchors before it: the first non-empty text node is the word.
    for (const node of word.childNodes) if (node.nodeType === Node.TEXT_NODE && (node as Text).data.trim()) return node as Text;
    return null;
  }

  /** Puts back the words as written before measuring (unless the page changed them since). */
  private restoreWords(): void {
    for (const word of this.element.querySelectorAll<HTMLElement>('.mushaf-word[data-kashida]')) {
      const text = MushafLineFitDirective.textOf(word);
      if (text && text.data === word.dataset['kashida']) text.data = word.dataset['orig'] ?? text.data;
      delete word.dataset['kashida'];
      delete word.dataset['orig'];
    }
  }

  private drawOutLines(fontSize: number): void {
    const el = this.element;
    const probe = document.createElement('span');
    probe.className = 'mushaf-word';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
    probe.textContent = TATWEEL.repeat(20);
    el.querySelector('.text-line')?.appendChild(probe);
    const tatweel = probe.getBoundingClientRect().width / 20;
    probe.remove();
    if (!tatweel) return;
    const width = el.clientWidth;
    const gap = fontSize * 0.16;
    for (const row of el.querySelectorAll<HTMLElement>('.text-line')) {
      const words = [...row.querySelectorAll<HTMLElement>(':scope > .mushaf-word')];
      const natural = words.reduce((sum, w) => sum + w.getBoundingClientRect().width, 0) + Math.max(0, words.length - 1) * gap;
      const texts = words.map((w) => MushafLineFitDirective.textOf(w)?.data ?? '');
      const counts = kashidaCounts(texts, width - 2 - natural, tatweel);
      words.forEach((w, i) => {
        const text = MushafLineFitDirective.textOf(w);
        if (!text || !counts[i]) return;
        const drawn = drawOut(texts[i], counts[i]);
        if (drawn === texts[i]) return;
        w.dataset['orig'] = texts[i];
        w.dataset['kashida'] = drawn;
        text.data = drawn;
      });
      // Drawing out can overshoot by a little (glyphs join tighter or looser): take tatweels back until it fits.
      for (let guard = 0; row.scrollWidth > row.clientWidth + 1 && guard < 40; guard++) {
        const w = words.filter((x) => x.dataset['kashida']).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
        const text = w && MushafLineFitDirective.textOf(w);
        if (!text) break;
        const i = text.data.lastIndexOf(TATWEEL);
        if (i < 0) break;
        text.data = text.data.slice(0, i) + text.data.slice(i + 1);
        if (text.data === w.dataset['orig']) {
          delete w.dataset['kashida'];
          delete w.dataset['orig'];
        } else w.dataset['kashida'] = text.data;
      }
    }
  }
}
