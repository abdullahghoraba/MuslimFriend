import { REVERBS, extensionFor, makeImpulse, pickMimeType } from './audio-chain';
import { wrapText } from './studio-session';
import { fileName } from './studio.service';
import { formatTime } from '../../pages/studio/studio.page';

describe('recitation studio helpers', () => {
  it('builds a reverb tail that starts after the pre-delay and fades out', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const r = REVERBS.mosque;
    const [left, right] = makeImpulse(48000, r.seconds, r.decay, r.preDelay, random);
    expect(left.length).toBe(Math.round(48000 * r.seconds));
    expect(right.length).toBe(left.length);
    const start = Math.round(48000 * r.preDelay);
    expect(Math.max(...left.subarray(0, start).map(Math.abs))).toBe(0);
    const energy = (a: Float32Array) => a.reduce((s, v) => s + v * v, 0);
    const n = left.length;
    expect(energy(left.subarray(start, start + 4800))).toBeGreaterThan(energy(left.subarray(n - 4800, n)) * 20);
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
