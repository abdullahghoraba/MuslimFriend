import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { toPng } from 'html-to-image';

/** Shares a rendered DOM element as a PNG through the Android share sheet. No network involved. */
@Injectable({ providedIn: 'root' })
export class ShareService {
  async shareElementAsImage(element: HTMLElement, title: string): Promise<void> {
    const background = getComputedStyle(element).getPropertyValue('--share-bg').trim() || '#ffffff';
    // Android WebViews can't draw a canvas much over 16 million pixels: a long dhikr (Ayat al-Kursi in the morning
    // athkar) at 2x came out blank or failed. Keep under 12 MP, and never above 2x.
    const area = Math.max(1, element.offsetWidth * element.offsetHeight);
    const pixelRatio = Math.min(2, Math.sqrt(12_000_000 / area));
    // The card waits off-screen (position: fixed, 10000px past the inline start). The copy that is drawn keeps
    // those styles, so in Arabic the words landed outside the picture and the image came out empty.
    const style = { position: 'static', inset: 'auto', left: 'auto', right: 'auto', top: 'auto', margin: '0' };
    const dataUrl = await toPng(element, { pixelRatio, backgroundColor: background, cacheBust: true, style });
    if (dataUrl.length < 100) throw new Error('empty image');

    if (!Capacitor.isNativePlatform()) {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = 'dhikr.png';
      link.click();
      return;
    }

    const file = await Filesystem.writeFile({
      path: `share/dhikr-${Date.now()}.png`,
      data: dataUrl.split(',')[1],
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({ title, files: [file.uri] });
  }

  /**
   * Shares a passage (an ayah, a hadith) as a picture: the Arabic, an optional translation, the source and the app
   * name on the app's paper colour. Built off-screen from plain text (never HTML). If the picture can't be made on this
   * phone, the words are shared as text instead. A share sheet closed without choosing an app is not an error.
   */
  async sharePassage(p: { title: string; arabic: string; translation?: string; translationLang?: string; source: string; brand: string; quran?: boolean }): Promise<void> {
    const card = document.createElement('div');
    card.className = 'passage-share-card';
    const line = (cls: string, text: string, lang?: string, dir?: string) => {
      if (!text) return;
      const el = document.createElement('p');
      el.className = cls;
      el.textContent = text;
      if (lang) el.lang = lang;
      if (dir) el.dir = dir;
      card.appendChild(el);
    };
    line(p.quran ? 'arabic quran' : 'arabic', p.arabic, 'ar', 'rtl');
    if (p.translation) line('translation', p.translation, p.translationLang, /^(ar|ur|fa)/.test(p.translationLang ?? '') ? 'rtl' : 'auto');
    line('source', p.source);
    line('brand', p.brand);
    document.body.appendChild(card);
    try {
      await document.fonts?.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        await this.shareElementAsImage(card, p.title);
      } catch (e) {
        if (isShareCancel(e)) return;
        console.warn('[share] image failed, sharing text', e);
        await this.shareText(p.title, [p.arabic, p.translation, p.source, p.brand].filter(Boolean).join('\n\n'));
      }
    } catch (e) {
      if (!isShareCancel(e)) throw e;
    } finally {
      card.remove();
    }
  }

  async shareText(title: string, text: string): Promise<void> {
    await Share.share({ title, text });
  }
}

/** Closing the share sheet without picking an app rejects the call; that is not a failure. */
export function isShareCancel(e: unknown): boolean {
  return /cancel/i.test(e instanceof Error ? e.message : String(e));
}
