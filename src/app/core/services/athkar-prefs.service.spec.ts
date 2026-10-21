import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { SettingsService } from './settings.service';
import { AthkarPrefsService } from './athkar-prefs.service';
vi.mock('@capacitor/preferences', () => {
  const values = new Map<string, string>();
  return { Preferences: {
    get: async ({ key }: { key: string }) => ({ value: values.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { values.set(key, value); },
    clear: async () => { values.clear(); },
  } };
});
describe('AthkarPrefsService', () => {
  beforeEach(async () => { await Preferences.clear(); TestBed.configureTestingModule({}); });
  it('defaults to Arabic visibility and follows language until explicitly changed', async () => {
    const service = TestBed.inject(AthkarPrefsService);
    await service.ready;
    expect(service.prefs()).toEqual({ onComplete: 'dim', readingMode: 'list', tapTarget: 'card', autoAdvance: true, countPastTarget: false, vibration: 'light', showSource: true, showTransliteration: false, showMeaning: false });
    await TestBed.inject(SettingsService).update({ language: 'en' });
    expect(service.prefs().showMeaning).toBe(true);
    expect(service.prefs().showTransliteration).toBe(true);
    await service.update({ showMeaning: false, tapTarget: 'button' });
    await TestBed.inject(SettingsService).update({ language: 'ar' });
    await TestBed.inject(SettingsService).update({ language: 'en' });
    expect(service.prefs().showMeaning).toBe(false);
    expect(JSON.parse((await Preferences.get({ key: 'athkarPrefs' })).value!)).not.toHaveProperty('showTransliteration');
  });
  it('persists all explicit preferences and reloads them', async () => {
    const service = TestBed.inject(AthkarPrefsService);
    const patch = { onComplete: 'hide', readingMode: 'single', tapTarget: 'button', autoAdvance: false, countPastTarget: true, vibration: 'strong', showSource: false, showTransliteration: true, showMeaning: true } as const;
    await service.update(patch);
    const reloaded = TestBed.runInInjectionContext(() => new AthkarPrefsService());
    await reloaded.ready;
    expect(reloaded.prefs()).toEqual(patch);
  });
  it('ignores invalid stored values and malformed JSON', async () => {
    await Preferences.set({ key: 'athkarPrefs', value: '{"onComplete":"bad","readingMode":"bad","autoAdvance":"no","showMeaning":true}' });
    const service = TestBed.inject(AthkarPrefsService); await service.ready;
    expect(service.prefs().onComplete).toBe('dim'); expect(service.prefs().readingMode).toBe('list'); expect(service.prefs().autoAdvance).toBe(true); expect(service.prefs().showMeaning).toBe(true);
    await Preferences.set({ key: 'athkarPrefs', value: '{' }); await service.load();
    expect(service.prefs().showMeaning).toBe(false);
  });
});
