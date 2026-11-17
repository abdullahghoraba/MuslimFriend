import { InjectionToken } from '@angular/core';
import { registerPlugin } from '@capacitor/core';

/** Copies an app file into the phone's gallery (video) or music (audio); Android 10+ (see MediaSaverPlugin.kt). */
export interface MediaSaverPlugin {
  save(options: { path: string; name: string; mime: string }): Promise<{ uri: string }>;
  /**
   * Rewrites a finished recording as a standard MP4 (or WebM) with its length in the header, in place: the WebView's
   * recorder leaves it out, and galleries and WhatsApp then see a few seconds, or an empty video. Rejects (leaving the
   * file as it was) when the phone cannot.
   */
  finalize(options: { path: string }): Promise<{ duration: number }>;
}

export const MediaSaver = registerPlugin<MediaSaverPlugin>('MediaSaver');

/** The plugin, injectable (tests give their own). */
export const MEDIA_SAVER = new InjectionToken<MediaSaverPlugin>('MediaSaver', { providedIn: 'root', factory: () => MediaSaver });
