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
    const dataUrl = await toPng(element, { pixelRatio, backgroundColor: background, cacheBust: true });
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

  async shareText(title: string, text: string): Promise<void> {
    await Share.share({ title, text });
  }
}
