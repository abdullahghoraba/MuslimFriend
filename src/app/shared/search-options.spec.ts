import meta from '../../../public/assets/quran/meta.json';
import { filterOptions, numberOptions, suraSearchOptions, westernDigits } from './search-options';

describe('searching a long list', () => {
  const suras = suraSearchOptions(meta.suras);
  const first = (q: string) => filterOptions(suras, q)[0]?.value;

  it('finds a sura by its name in any spelling, in English, or by its number', () => {
    expect(first('yaseen')).toBe(36);
    expect(first('يس')).toBe(36);
    expect(first('baqara')).toBe(2);
    expect(first('cow')).toBe(2);
    expect(first('البقره')).toBe(2);
    expect(first('kahf')).toBe(18);
    expect(first('36')).toBe(36);
    expect(first('٣٦')).toBe(36);
  });

  it('finds an ayah by the digits it starts with, Arabic digits too', () => {
    const ayat = numberOptions(286);
    expect(filterOptions(ayat, '255')[0].value).toBe(255);
    expect(filterOptions(ayat, '٢٥').map((o) => o.value).slice(0, 3)).toEqual([25, 250, 251]);
    expect(numberOptions(286)).toBe(ayat);
    expect(westernDigits('۱۲٣')).toBe('123');
  });
});
