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
    const dataUrl = await toPng(element, { pixelRatio: 2, backgroundColor: background, cacheBust: true });

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
