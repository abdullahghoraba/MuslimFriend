import dataset from '../../../public/assets/data/athkar.json';

describe('bundled athkar dataset', () => {
  it('contains categories and items', () => {
    expect(dataset.categories.length).toBeGreaterThan(0);
    expect(dataset.items.length).toBeGreaterThan(0);
  });

  it.each(dataset.items)('validates content for $id', item => {
    expect(item.id.trim()).not.toBe('');
    expect(dataset.categories.map(category => category.id)).toContain(item.categoryId);
    expect(item.textAr).toMatch(/[\u064B-\u065F\u0670\u06D6-\u06ED]/u);
    expect(Number.isInteger(item.repeatCount)).toBe(true);
    expect(item.repeatCount).toBeGreaterThan(0);
    expect(item.sourceRef.trim()).not.toBe('');
    expect(item.reviewed).toBe(false);
  });

  it('has unique item ids', () => {
    expect(new Set(dataset.items.map(item => item.id)).size).toBe(dataset.items.length);
  });

  it.each(['morning', 'evening'])('has no dhikr twice in %s (the tahlil is said 10 times, once in the list)', category => {
    const plain = (s: string) => s.replace(/[ً-ٰٟۖ-ۭـ]/gu, '').replace(/\s+/g, ' ').trim();
    const texts = dataset.items.filter(item => item.categoryId === category).map(item => plain(item.textAr));
    expect(new Set(texts).size).toBe(texts.length);
    const tahlil = dataset.items.filter(
      item => item.categoryId === category && plain(item.textAr).startsWith('لا إله إلا الله وحده لا شريك له'),
    );
    expect(tahlil.map(item => item.repeatCount)).toEqual([10]);
  });

  it.each(dataset.categories)('has at least one item in $id', category => {
    expect(dataset.items.some(item => item.categoryId === category.id)).toBe(true);
  });

  it('attributes Quran text to Tanzil', () => {
    expect(dataset.quranAttribution).toMatch(/Tanzil/i);
  });
});
