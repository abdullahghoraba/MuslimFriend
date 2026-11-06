import { parseEvents, wavBase64 } from './tajweed.service';

describe('tajweed: sending a phrase', () => {
  it('writes 16 kHz mono 16-bit WAV', () => {
    const samples = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 10) * 0.5);
    const bytes = Uint8Array.from(atob(wavBase64(samples)), (c) => c.charCodeAt(0));
    const v = new DataView(bytes.buffer);
    const text = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(3200);
    expect(bytes.length).toBe(44 + 3200);
    expect(v.getInt16(44 + 2 * 16, true) / 0x7fff).toBeCloseTo(samples[16], 3);
  });

  it('clips samples beyond full scale instead of wrapping around', () => {
    const bytes = Uint8Array.from(atob(wavBase64(Float32Array.from([2, -2]))), (c) => c.charCodeAt(0));
    const v = new DataView(bytes.buffer);
    expect(v.getInt16(44, true)).toBe(0x7fff);
    expect(v.getInt16(46, true)).toBe(-0x7fff);
  });
});

describe('tajweed: reading the server reply', () => {
  it('takes the result of the "complete" event, and fails on "error"', () => {
    const ok = ['event: heartbeat', 'data: null', '', 'event: complete', 'data: [{"results": [{"errors": []}, null]}]', ''].join('\n');
    expect(parseEvents(ok).results?.length).toBe(2);
    expect(() => parseEvents(['event: error', 'data: "quota"', ''].join('\n'))).toThrow();
    expect(() => parseEvents('')).toThrow();
  });
});
