import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { NativeAudio, QuranAudioState } from '../../native/quran-audio';
import { AudioPlayerService } from './audio-player.service';
import { AudioCatalogService, FullReciter, Moshaf } from './audio-catalog.service';
import { RecitationService } from '../quran/recitation.service';
import { QuranService } from '../quran/quran.service';

const native = vi.hoisted(() => {
  const listeners: ((s: unknown) => void)[] = [];
  return {
    listeners,
    plugin: {
      play: vi.fn(async (_o: unknown) => {}),
      stop: vi.fn(async () => {}),
      toggle: vi.fn(async () => {}),
      next: vi.fn(async () => {}),
      previous: vi.fn(async () => {}),
      seek: vi.fn(async () => {}),
      setRepeat: vi.fn(async (_o: unknown) => {}),
      setSpeed: vi.fn(async () => {}),
      setSleep: vi.fn(async () => {}),
      addListener: vi.fn(async (_e: string, fn: (s: unknown) => void) => {
        listeners.push(fn);
        return { remove: async () => {} };
      }),
    },
  };
});
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    readdir: vi.fn(async ({ path }: { path: string }) => {
      if (path === 'listen/7') return { files: [{ name: '002.mp3' }] };
      if (path.startsWith('audio/')) return { files: [{ name: '002002.mp3' }] };
      throw new Error('none');
    }),
    getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: 'file:///data/' + path })),
  },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(async () => ({ value: null })), set: vi.fn(async () => {}) },
}));

const state = (s: Partial<QuranAudioState>): QuranAudioState => ({
  session: 'listen', index: 0, group: '', playing: true, buffering: false, ended: false, error: false,
  position: 0, duration: 0, sleepAt: 0, ...s,
});
const emit = (s: Partial<QuranAudioState>) => native.listeners.forEach((fn) => fn(state(s)));

/** Al-Fatiha (7 ayat) then al-Baqarah. */
const quran = {
  load: async () => {},
  ready: signal(true),
  sura: (n: number) => ({ name: 'S' + n, start: n === 1 ? 0 : 7, ayas: n === 1 ? 7 : 286 }),
  ayah: (r: { sura: number; aya: number }) => ({ index: (r.sura === 1 ? 0 : 7) + r.aya - 1 }),
  ayahAt: (i: number) => (i < 7 ? { sura: 1, aya: i + 1 } : { sura: 2, aya: i - 6 }),
};
const catalog = { suras: () => [1, 2, 3], reciterName: () => 'R', moshafName: () => 'M', radioName: () => 'Radio' };
const moshaf = { id: 7, server: 'https://server8.mp3quran.net/x/' } as Moshaf;
const reciter = { id: 1 } as FullReciter;

describe('native Quran player (Android)', () => {
  let nativePlatform: { mockRestore(): void };
  afterEach(() => nativePlatform.mockRestore());
  beforeEach(() => {
    native.listeners.length = 0;
    nativePlatform = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    Object.values(native.plugin).forEach((f) => f.mockClear());
    TestBed.configureTestingModule({
      providers: [
        { provide: QuranService, useValue: quran },
        { provide: AudioCatalogService, useValue: catalog },
        { provide: NativeAudio, useValue: { enabled: true, player: native.plugin } },
      ],
    });
  });

  it('Listen queues the whole recording, downloaded suras from the phone, and follows it to the next sura', async () => {
    const player = TestBed.inject(AudioPlayerService);
    await player.playSura(reciter, moshaf, 2);
    expect(native.plugin.play).toHaveBeenCalledWith(expect.objectContaining({ session: 'listen', index: 1, repeat: 'off', live: false }));
    const items = (native.plugin.play.mock.calls[0][0] as { items: { url: string; group: string }[] }).items;
    expect(items.map((i) => i.url)).toEqual([
      'https://server8.mp3quran.net/x/001.mp3', 'file:///data/listen/7/002.mp3', 'https://server8.mp3quran.net/x/003.mp3',
    ]);
    emit({ group: '1', index: 0 }); // the previous queue, still on its way
    expect(player.now()).toMatchObject({ sura: 2 });
    emit({ group: '2', index: 1, position: 12, duration: 300 });
    expect(player.position()).toBe(12);
    emit({ group: '3', index: 2 });
    expect(player.now()).toMatchObject({ sura: 3 });
    emit({ index: -1 }); // stopped from the notification
    expect(player.now()).toBeNull();
    expect(native.plugin.stop).not.toHaveBeenCalled();
  });

  it('Listen stops when the queue ends, and ignores the mushaf\'s playback', async () => {
    const player = TestBed.inject(AudioPlayerService);
    await player.playSura(reciter, moshaf, 3);
    emit({ session: 'mushaf', index: -1 });
    expect(player.now()).not.toBeNull();
    emit({ group: '3', index: 2, ended: true, playing: false });
    expect(player.now()).toBeNull();
    expect(native.plugin.stop).toHaveBeenCalled();
  });

  it('the mushaf queues each ayah as many times as it repeats and highlights the one sounding', async () => {
    const recitation = TestBed.inject(RecitationService);
    await recitation.loadPrefs();
    recitation.prefs.update((p) => ({ ...p, repeatEach: 3 }));
    await recitation.play({ sura: 2, aya: 1 }, { sura: 2, aya: 3 });
    const call = native.plugin.play.mock.calls[0][0] as { items: { url: string; group: string }[]; index: number; repeat: string; session: string };
    expect(call).toMatchObject({ session: 'mushaf', index: 0, repeat: 'off' });
    expect(call.items.map((i) => i.group)).toEqual(['7', '7', '7', '8', '8', '8', '9', '9', '9']);
    expect(call.items[3].url).toMatch(/^file:\/\/\/data\/audio\/.+\/002002\.mp3$/);
    expect(call.items[0].url).toMatch(/^https:\/\/everyayah\.com\/data\/.+\/002001\.mp3$/);
    emit({ session: 'mushaf', group: '7', index: 0 });
    emit({ session: 'mushaf', group: '8', index: 3 });
    expect(recitation.current()).toEqual({ sura: 2, aya: 2 });
    recitation.setLoop(true);
    expect(native.plugin.setRepeat).toHaveBeenCalledWith({ repeat: 'all' });
    emit({ session: 'mushaf', index: -1 });
    expect(recitation.current()).toBeNull();
  });
});
