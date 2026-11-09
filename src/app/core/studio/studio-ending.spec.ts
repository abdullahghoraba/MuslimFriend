import { HARAM_ECHO, REVERBS, tailSeconds } from './audio-chain';
import { FADE_OUT, fadeAlpha } from './studio-session';

describe('studio endings', () => {
  it('keeps recording after stop long enough for the chain and the reverb tail', () => {
    expect(tailSeconds('none')).toBeGreaterThanOrEqual(FADE_OUT);
    expect(tailSeconds('room')).toBeGreaterThan(tailSeconds('none'));
    expect(tailSeconds('mosque')).toBeGreaterThan(tailSeconds('hall'));
    // Never a long wait, even with the haram reverb.
    expect(tailSeconds('haram')).toBeLessThanOrEqual(3.5);
  });

  it('fades the picture in from black and out to black', () => {
    expect(fadeAlpha('in', 0, 0.35)).toBe(1);
    expect(fadeAlpha('in', 0.35, 0.35)).toBe(0);
    expect(fadeAlpha('out', 0, 0.6)).toBe(0);
    expect(fadeAlpha('out', 0.3, 0.6)).toBeCloseTo(0.5);
    expect(fadeAlpha('out', 5, 0.6)).toBe(1);
  });

  it('gives the haram sound a longer space and a soft, decaying loudspeaker echo', () => {
    expect(REVERBS.haram.seconds).toBeGreaterThan(REVERBS.mosque.seconds);
    expect(HARAM_ECHO.feedback).toBeLessThan(0.5);
    expect(HARAM_ECHO.wet).toBeLessThan(REVERBS.haram.wet);
  });
});
