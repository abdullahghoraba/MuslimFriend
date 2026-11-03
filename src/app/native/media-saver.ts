import { registerPlugin } from '@capacitor/core';

/** Copies an app file into the phone's gallery (video) or music (audio); Android 10+ (see MediaSaverPlugin.kt). */
export interface MediaSaverPlugin {
  save(options: { path: string; name: string; mime: string }): Promise<{ uri: string }>;
}

export const MediaSaver = registerPlugin<MediaSaverPlugin>('MediaSaver');
