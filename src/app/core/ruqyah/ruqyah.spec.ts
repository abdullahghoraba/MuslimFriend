import { RUQYAH_DUAS, RUQYAH_PASSAGES } from './ruqyah';
import { RUQYAH_RECITERS } from './ruqyah-player.service';

describe('ruqyah', () => {
  it('lists valid passages in mushaf order', () => {
    expect(RUQYAH_PASSAGES.reduce((n, p) => n + p.to - p.from + 1, 0)).toBe(97);
    for (const p of RUQYAH_PASSAGES) expect(p.from).toBeLessThanOrEqual(p.to);
    const keys = RUQYAH_PASSAGES.map((p) => p.sura * 1000 + p.from);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
  });
  it('gives every supplication its source', () => {
    for (const d of RUQYAH_DUAS) expect(d.source).toMatch(/البخاري|مسلم|أبي داود|الترمذي/);
  });
  it('offers only sheikhs with every ruqyah ayah, never Alafasy or As-Sudais', () => {
    const ids = RUQYAH_RECITERS.map((r) => r.id).join(' ');
    expect(ids).not.toMatch(/Mustafa_Ismail|Alafasy|Sudais/i);
    expect(RUQYAH_RECITERS.length).toBeGreaterThan(30);
  });
});
