import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { TranslateService } from '@ngx-translate/core';
import { vi } from 'vitest';
import {
  ATHAN_PLUGIN,
  ATHAN_PRAYERS,
  AthanService,
  buildAthanEvents,
  defaultAthanSettings,
} from './athan.service';
import { DEFAULT_PRAYER_SETTINGS, PrayerSettings, prayerTimesFor } from './prayer-times';
import { PrayerService } from './prayer.service';

const nativeMock = {
  scheduleAthan: vi.fn(async () => ({ scheduled: 35, exact: true })),
  cancelAthan: vi.fn(async () => {}),
  setWidgetData: vi.fn(
    async (_options: {
      prayers: { name: string; at: number }[];
      nextLabel: string;
      appName: string;
    }) => {},
  ),
  previewAthan: vi.fn(async () => {}),
  stopAthan: vi.fn(async () => {}),
};
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    writeFile: vi.fn(async () => ({ uri: '' })),
    getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: 'file:///data/' + path })),
    deleteFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => ({ data: '' })),
  },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(async () => ({ value: null })), set: vi.fn(async () => {}) },
}));
const cairo: PrayerSettings = {
  ...DEFAULT_PRAYER_SETTINGS,
  location: { latitude: 30.0444, longitude: 31.2357, name: 'Cairo', source: 'manual' },
};
const now = new Date(2026, 9, 21, 0, 0, 0);
const text = (key: string) => (key === 'locale' ? 'en' : key);
describe('athan event planning', () => {
  it('defaults to disabled, the built-in athan for every prayer and volume 0.8', () => {
    const s = defaultAthanSettings();
    expect(s.enabled).toBe(false);
    expect(s.volume).toBe(0.8);
    expect(s.silentMinutes).toBe(20);
    for (const p of ATHAN_PRAYERS)
      expect(s.perPrayer[p]).toEqual({
        mode: 'athan',
        sound: 'athan',
        preMinutes: 0,
        iqamaMinutes: 0,
      });
    expect(s.perPrayer.fajr).not.toBe(s.perPrayer.dhuhr);
  });
  it('builds five prayers per day over seven days with unique, ordered IDs', () => {
    const s = defaultAthanSettings();
    s.enabled = true;
    const events = buildAthanEvents(cairo, s, text, now);
    expect(events).toHaveLength(35);
    expect(new Set(events.map((e) => e.id)).size).toBe(35);
    for (const p of ATHAN_PRAYERS) expect(events.filter((e) => e.prayer === p)).toHaveLength(7);
    expect(events.map((e) => e.at)).toEqual(events.map((e) => e.at).sort((a, b) => a - b));
    expect(events[0].at).toBe(prayerTimesFor(cairo, now)!.times.fajr.getTime());
  });
  it('uses exact pre/iqama offsets and system sounds', () => {
    const s = defaultAthanSettings();
    s.enabled = true;
    s.perPrayer.fajr.preMinutes = 10;
    s.perPrayer.fajr.iqamaMinutes = 20;
    const events = buildAthanEvents(cairo, s, text, now, 1);
    const at = prayerTimesFor(cairo, now)!.times.fajr.getTime();
    expect(events).toHaveLength(7);
    expect(events.find((e) => e.kind === 'pre')).toMatchObject({
      at: at - 600000,
      sound: 'system',
    });
    expect(events.find((e) => e.kind === 'iqama')).toMatchObject({
      at: at + 1200000,
      sound: 'system',
    });
  });
  it('off suppresses all events including reminders and notify uses none', () => {
    const s = defaultAthanSettings();
    s.enabled = true;
    s.perPrayer.fajr = { mode: 'off', sound: 'tone', preMinutes: 10, iqamaMinutes: 20 };
    s.perPrayer.asr.mode = 'notify';
    const events = buildAthanEvents(cairo, s, text, now, 1);
    expect(events).toHaveLength(4);
    expect(events.some((e) => e.prayer === 'fajr')).toBe(false);
    expect(events.find((e) => e.prayer === 'asr')!.sound).toBe('none');
  });
  it('adds silentMinutes only to prayer-time events when enabled', () => {
    const s = defaultAthanSettings();
    s.enabled = true;
    s.perPrayer.fajr.preMinutes = 10;
    s.perPrayer.fajr.iqamaMinutes = 20;
    s.sunrise.notify = true;
    expect(buildAthanEvents(cairo, s, text, now).every((e) => !('silentMinutes' in e))).toBe(true);
    s.silentDuringPrayer = true;
    const events = buildAthanEvents(cairo, s, text, now, 1);
    expect(events.filter((e) => e.silentMinutes === 20)).toHaveLength(5);
    expect(
      events
        .filter((e) => e.kind !== 'athan' || e.prayer === 'sunrise')
        .every((e) => !('silentMinutes' in e)),
    ).toBe(true);
  });
  it('passes the chosen stop gestures to sounded events only', () => {
    const s = defaultAthanSettings();
    s.enabled = true;
    s.perPrayer.dhuhr = { ...s.perPrayer.dhuhr, mode: 'notify' };
    s.stopOn = { flip: true, shake: false, volume: true };
    const events = buildAthanEvents(cairo, s, text, now, 1);
    expect(events.find((e) => e.prayer === 'fajr')!.stopOn).toEqual(['flip', 'volume']);
    expect(events.find((e) => e.prayer === 'dhuhr')!.stopOn).toBeUndefined();
    s.stopOn = { flip: false, shake: false, volume: false };
    expect(buildAthanEvents(cairo, s, text, now, 1).every((e) => !('stopOn' in e))).toBe(true);
  });

  it('respects madhab and manual adjustments', () => {
    const s = defaultAthanSettings();
    s.enabled = true;
    const adjusted = {
      ...cairo,
      madhab: 'hanafi' as const,
      adjustments: { ...cairo.adjustments, fajr: 7 },
    };
    const events = buildAthanEvents(adjusted, s, text, now, 1);
    expect(events.find((e) => e.prayer === 'fajr')!.at).toBe(
      prayerTimesFor(cairo, now)!.times.fajr.getTime() + 420000,
    );
    expect(events.find((e) => e.prayer === 'asr')!.at).toBe(
      prayerTimesFor(adjusted, now)!.times.asr.getTime(),
    );
  });
  it('adds the spoken reminder only when it is on, the chosen minutes before each prayer that is not off', () => {
    const s = defaultAthanSettings();
    s.enabled = true;
    expect(buildAthanEvents(cairo, s, text, now, 1).some((e) => e.kind === 'voice')).toBe(false);
    s.voiceReminder = { enabled: true, minutes: 15 };
    s.perPrayer.isha.mode = 'off';
    const voice = buildAthanEvents(cairo, s, text, now, 2).filter((e) => e.kind === 'voice');
    const asr = voice.find((e) => e.prayer === 'asr')!;
    expect(asr.sound).toBe('voice');
    expect(asr.speech).toBe('voiceTitle');
    expect(asr.at).toBe(prayerTimesFor(cairo, new Date(asr.at))!.times.asr.getTime() - 15 * 60000);
    expect(voice.some((e) => e.prayer === 'isha')).toBe(false);
  });
  it('skips past events, disabled schedules and missing location', () => {
    const s = defaultAthanSettings();
    expect(buildAthanEvents(cairo, s, text, now)).toEqual([]);
    s.enabled = true;
    expect(buildAthanEvents({ ...cairo, location: null }, s, text, now)).toEqual([]);
    const late = new Date(now);
    late.setHours(23, 59);
    expect(buildAthanEvents(cairo, s, text, late, 1)).toEqual([]);
  });
});
describe('AthanService persistence and platform bridge', () => {
  let service: AthanService;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({
      providers: [
        { provide: ATHAN_PLUGIN, useValue: nativeMock },
        { provide: PrayerService, useValue: { prayer: signal(cairo), now: signal(now) } },
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => (key.endsWith('.locale') ? 'en' : key) },
        },
      ],
    });
    service = TestBed.inject(AthanService);
  });
  afterEach(() => vi.restoreAllMocks());
  it('loads preferences, persists changes and schedules enabled events', async () => {
    const saved = defaultAthanSettings();
    saved.enabled = true;
    saved.perPrayer.fajr.sound = 'system';
    vi.mocked(Preferences.get).mockResolvedValue({ value: JSON.stringify(saved) });
    await service.load();
    expect(service.settings().perPrayer.fajr.sound).toBe('system');
    await service.update({ volume: 0.5 });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: 'athanSettings',
      value: expect.stringContaining('"volume":0.5'),
    });
    expect(nativeMock.scheduleAthan).toHaveBeenCalled();
  });
  it('downloads the Madinah athan once and makes it the default, with its own Fajr athan', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetched.push(url);
      return { ok: true, blob: async () => new Blob(['mp3']) };
    }));
    await service.update({ enabled: true });
    await vi.waitFor(() => expect(service.settings().defaultRecordingSet).toBe(true));
    const sounds = service.settings().perPrayer;
    expect(fetched).toHaveLength(2);
    expect(sounds.fajr.sound).toBe('file:/data/athan/rec-madinah-essam-bukhari-fajr.mp3');
    for (const p of ['dhuhr', 'asr', 'maghrib', 'isha'] as const)
      expect(sounds[p].sound).toBe('file:/data/athan/rec-madinah-essam-bukhari.mp3');
    await service.reschedule();
    expect(fetched).toHaveLength(2);
    vi.unstubAllGlobals();
  });
  it('keeps a sound the user picked instead of the Madinah default', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const perPrayer = { ...service.settings().perPrayer, asr: { ...service.settings().perPrayer.asr, sound: 'system' as const } };
    await service.update({ enabled: true, perPrayer });
    await vi.waitFor(() => expect(service.settings().defaultRecordingSet).toBe(true));
    expect(fetch).not.toHaveBeenCalled();
    expect(service.settings().perPrayer.dhuhr.sound).toBe('athan');
    vi.unstubAllGlobals();
  });
  it('updates the 15 widget prayers even when disabled, then cancels alarms', async () => {
    await service.reschedule();
    expect(nativeMock.cancelAthan).toHaveBeenCalled();
    const widget = vi.mocked(nativeMock.setWidgetData).mock.calls.at(-1)![0];
    expect(widget.prayers).toHaveLength(15);
  });
  it('clears the widget and cancels when there is no location', async () => {
    const prayer = TestBed.inject(PrayerService).prayer as ReturnType<
      typeof signal<PrayerSettings>
    >;
    prayer.set({ ...cairo, location: null });
    await service.update({ enabled: true });
    expect(nativeMock.setWidgetData).toHaveBeenCalledWith(expect.objectContaining({ prayers: [] }));
    expect(nativeMock.cancelAthan).toHaveBeenCalled();
  });
  it('never invokes the athan native bridge on web', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    await service.update({ enabled: true });
    await service.preview('tone');
    await service.stopPreview();
    expect(nativeMock.scheduleAthan).not.toHaveBeenCalled();
    expect(nativeMock.setWidgetData).not.toHaveBeenCalled();
    expect(nativeMock.cancelAthan).not.toHaveBeenCalled();
    expect(nativeMock.previewAthan).not.toHaveBeenCalled();
    expect(nativeMock.stopAthan).not.toHaveBeenCalled();
  });
  it('keeps defaults for damaged stored JSON', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: '{' });
    await service.load();
    expect(service.settings()).toEqual(defaultAthanSettings());
  });
});
