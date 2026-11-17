import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { Recording, StudioService } from './studio.service';
import { MEDIA_SAVER } from '../../native/media-saver';

// On the phone, a recording made by the WebView's recorder has no length in its header: the gallery then showed
// 3 seconds of it and WhatsApp an empty video. Each recording is rewritten as a standard file (MediaSaver.finalize)
// before it is kept, and older ones before they are shared or saved.

const native = vi.hoisted(() => ({
  finalize: vi.fn(async (_o: { path: string }) => ({ duration: 63.4 })),
  save: vi.fn(async (_o: unknown) => ({ uri: 'content://media/1' })),
  share: vi.fn(async (_o: unknown) => ({})),
  prefs: new Map<string, string>(),
}));
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: { getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: 'file:///data/files/' + path })) },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: native.prefs.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => void native.prefs.set(key, value)),
  },
}));

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: 'r1', kind: 'video', created: 0, duration: 60, mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  file: 'studio/r1.mp4', title: 'الفاتحة', denoise: 'light', reverb: 'mosque', ...over,
});

describe('studio recordings on the phone', () => {
  let studio: StudioService;
  beforeEach(() => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    native.finalize.mockClear(); native.save.mockClear(); native.share.mockClear(); native.prefs.clear();
    TestBed.configureTestingModule({ providers: [{ provide: MEDIA_SAVER, useValue: { finalize: native.finalize, save: native.save } }] });
    studio = TestBed.inject(StudioService);
  });

  it('rewrites a new recording as a standard file, with its exact length', async () => {
    const out = await studio.finalize(rec());
    expect(native.finalize).toHaveBeenCalledWith({ path: 'file:///data/files/studio/r1.mp4' });
    expect(out.fixed).toBe(true);
    expect(out.duration).toBeCloseTo(63.4);
  });

  it('keeps the recording as it is when the phone cannot rewrite it', async () => {
    native.finalize.mockRejectedValueOnce(new Error('codec'));
    const out = await studio.finalize(rec());
    expect(out.fixed).toBeUndefined();
    expect(out.duration).toBe(60);
  });

  it('fixes an older recording before sharing it, once, and shares the file', async () => {
    native.prefs.set('studioRecordings', JSON.stringify([rec()]));
    await studio.load();
    await studio.share(studio.recordings()[0], 'Studio');
    expect(native.finalize).toHaveBeenCalledTimes(1);
    expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///data/files/studio/r1.mp4'] }));
    expect(studio.recordings()[0].fixed).toBe(true);
    expect(JSON.parse(native.prefs.get('studioRecordings')!)[0].fixed).toBe(true);
    await studio.saveToDevice(studio.recordings()[0]);
    expect(native.finalize).toHaveBeenCalledTimes(1);
    expect(native.save).toHaveBeenCalledWith(expect.objectContaining({ mime: 'video/mp4' }));
  });

  it('lets a failed share reach the page (which says so), instead of nothing happening', async () => {
    native.share.mockRejectedValueOnce(new Error('Failed to find configured root'));
    await expect(studio.share(rec({ fixed: true }), 'Studio')).rejects.toThrow();
  });
});
