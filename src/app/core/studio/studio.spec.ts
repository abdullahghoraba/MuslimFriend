import { REVERBS, extensionFor, makeImpulse, pickMimeType, spaceImpulse } from './audio-chain';
import { wrapText } from './studio-session';
import { fileName } from './studio.service';
import { formatTime } from '../../pages/studio/studio.page';

describe('recitation studio helpers', () => {
  it('builds a reverb tail that starts after the pre-delay and fades out', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const energy = (a: Float32Array) => a.reduce((s, v) => s + v * v, 0);
    for (const name of ['room', 'hall', 'mosque', 'haram'] as const) {
      const r = REVERBS[name];
      const [left, right] = spaceImpulse(48000, r, random);
      expect(left.length).toBe(Math.round(48000 * r.seconds));
      expect(right.length).toBe(left.length);
      const start = Math.round(48000 * r.preDelay);
      expect(Math.max(...left.subarray(0, start).map(Math.abs))).toBe(0);
      const n = left.length;
      const early = Math.min(start + 4800, n);
      expect(energy(left.subarray(start, early))).toBeGreaterThan(energy(left.subarray(n - 4800, n)) * 20);
      // Two sides with their own noise: a wide space, not the same sound in both ears.
      expect(left.subarray(start + 2000, start + 2400)).not.toEqual(right.subarray(start + 2000, start + 2400));
    }
  });

  it('lets a space\'s highs die away before its lows, like carpet and air do (a mosque sounds warm, not hissy)', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const r = REVERBS.mosque;
    const [tail] = spaceImpulse(48000, r, random);
    // Brightness: share of the energy in sample-to-sample changes (high frequencies), early vs late in the tail.
    const brightness = (a: Float32Array) => {
      let diff = 0, all = 0;
      for (let i = 1; i < a.length; i++) { diff += (a[i] - a[i - 1]) ** 2; all += a[i] ** 2; }
      return diff / all;
    };
    const s = Math.round(48000 * (r.preDelay + 0.25));
    const late = Math.round(48000 * (r.preDelay + 2));
    expect(brightness(tail.subarray(late, late + 9600))).toBeLessThan(brightness(tail.subarray(s, s + 9600)) * 0.8);
  });

  it('keeps the Haram\'s original sound', () => {
    let a = 3, b = 3;
    const ra = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    const rb = () => ((b = (b * 16807) % 2147483647) / 2147483647);
    const h = REVERBS.haram;
    expect(spaceImpulse(48000, h, ra)[0]).toEqual(makeImpulse(48000, h.seconds, h.decay!, h.preDelay, rb)[0]);
  });

  it('prefers MP4 so recordings play everywhere, else WebM', () => {
    expect(pickMimeType('video', (t) => t.startsWith('video/mp4'))).toMatch(/^video\/mp4/);
    expect(pickMimeType('video', (t) => t.startsWith('video/webm'))).toMatch(/^video\/webm/);
    expect(pickMimeType('audio', (t) => t === 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
    expect(pickMimeType('audio', () => false)).toBe('');
    expect(extensionFor('audio/mp4;codecs=mp4a.40.2')).toBe('m4a');
    expect(extensionFor('video/mp4')).toBe('mp4');
    expect(extensionFor('video/webm;codecs=vp9,opus')).toBe('webm');
  });

  it('wraps the ayah caption by whole words', () => {
    const lines = wrapText((s) => s.length, 'بسم الله الرحمن الرحيم', 10);
    expect(lines).toEqual(['بسم الله', 'الرحمن', 'الرحيم']);
    expect(wrapText((s) => s.length, 'كلمة', 2)).toEqual(['كلمة']);
  });

  it('formats times and file names', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75.4)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    const name = fileName({
      id: 'x', kind: 'video', created: new Date(2026, 10, 3, 14, 5).getTime(), duration: 10, mime: 'video/mp4', file: 'studio/x.mp4',
      title: 'سورة الملك: 1/30', denoise: 'strong', reverb: 'room',
    });
    expect(name).toBe('سورة الملك 1 30 2026-11-03 14-05.mp4');
  });
});
