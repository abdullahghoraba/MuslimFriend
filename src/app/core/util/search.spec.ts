import catalog from '../../../../public/assets/audio/catalog.json';
import { foldLatin, prepareQuery, prepareSearch, searchList, searchMatches, searchScore, skeleton } from './search';

describe('forgiving name search', () => {
  it('folds Latin and reduces names to consonants', () => {
    expect(foldLatin('ʿAbd al-ʿAzīz')).toBe('abd al aziz');
    expect(skeleton('minshawi')).toBe(skeleton('menshawy'));
    expect(skeleton('hussary')).toBe(skeleton('husari'));
    expect(skeleton('shuraim')).toBe(skeleton('shuraym'));
  });

  it('matches Arabic regardless of spaces, hamza, tashkeel and a leading al', () => {
    expect(searchMatches('عبد الباسط', 'عبدالباسط عبدالصمد')).toBe(true);
    expect(searchMatches('المنشاوى', 'محمد صديق المنشاوي')).toBe(true);
    expect(searchMatches('منشاوي', 'محمد صديق المنشاوي')).toBe(true);
    expect(searchMatches('الحُصَرِي', 'محمود خليل الحصري')).toBe(true);
    expect(searchMatches('الشريم', 'محمود خليل الحصري')).toBe(false);
  });

  it('matches transliterations that differ from the stored spelling', () => {
    expect(searchMatches('Shuraim', 'Saud Al-Shuraym')).toBe(true);
    expect(searchMatches('menshawy', 'Mohammed Siddiq Al-Minshawi')).toBe(true);
    expect(searchMatches('husari', 'Mahmoud Khalil Al-Hussary')).toBe(true);
    expect(searchMatches('abdel basit', 'Abdulbasit Abdulsamad')).toBe(true);
    expect(searchMatches('muaiqly', 'Maher Al Meaqli')).toBe(true);
    expect(searchMatches('xyz', 'Maher Al Meaqli')).toBe(false);
  });

  it('needs every word, each in any field', () => {
    const fields = [prepareSearch('محمود خليل الحصري', 'Mahmoud Khalil Al-Hussary'), prepareSearch('ورش عن نافع - مرتل', 'Rewayat Warsh')];
    expect(searchScore(prepareQuery('الحصري ورش'), fields)).toBeGreaterThan(0);
    expect(searchScore(prepareQuery('hussary warsh'), fields)).toBeGreaterThan(0);
    expect(searchScore(prepareQuery('الحصري قالون'), fields)).toBe(0);
  });

  it('ranks a name that starts with the query above one that only contains it, and the name above other fields', () => {
    const list = ['Saad Al-Ghamdi', 'Maher Al-Muaiqly', 'Ahmad Saad'];
    expect(searchList(list, 'saad', (x) => [prepareSearch(x)])[0]).toBe('Saad Al-Ghamdi');
    const recs = [{ name: 'A', rec: 'مرتل' }, { name: 'مرتل B', rec: '' }];
    expect(searchList(recs, 'مرتل', (x) => [prepareSearch(x.name), prepareSearch(x.rec)])[0].name).toBe('مرتل B');
  });

  it('matches numbers exactly (sura 2, not 12 or 20)', () => {
    const suras = [{ n: 2, name: 'البقرة' }, { n: 12, name: 'يوسف' }, { n: 20, name: 'طه' }];
    expect(searchList(suras, '2', (s) => [prepareSearch(s.name)], (s) => [s.n]).map((s) => s.n)).toEqual([2]);
    expect(searchList(suras, '٢٠', (s) => [prepareSearch(s.name)], (s) => [s.n]).map((s) => s.n)).toEqual([20]);
  });

  it('finds the well-known reciters in the real catalogue, typed the usual ways', () => {
    const find = (q: string) =>
      searchList(catalog.reciters, q, (r) => [prepareSearch(r.ar, r.en), prepareSearch(...r.moshaf.flatMap((m) => [m.ar, m.en]))]).map((r) => r.ar);
    expect(find('عبد الباسط')).toContain('عبدالباسط عبدالصمد');
    expect(find('abdul basit')).toContain('عبدالباسط عبدالصمد');
    expect(find('المنشاوي المعلم')).toContain('محمد صديق المنشاوي');
    expect(find('Minshawy')).toContain('محمد صديق المنشاوي');
    expect(find('sudais')).toEqual([]);
    expect(find('المعيقلي')).toContain('ماهر المعيقلي');
    expect(find('العفاسي')).toEqual([]);
  });
});
