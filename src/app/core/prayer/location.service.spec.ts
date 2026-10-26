import { City, citiesIn, countriesOf, distanceKm, nearestCity, searchCountries } from './location.service';

const cities: City[] = [
  { id: 'cairo', ar: 'القاهرة', en: 'Cairo', country: 'EG', lat: 30.04, lng: 31.24, method: 'Egyptian' },
  { id: 'makkah', ar: 'مكة المكرمة', en: 'Makkah', country: 'SA', lat: 21.39, lng: 39.86, method: 'UmmAlQura' },
];

describe('location helpers', () => {
  it('measures great-circle distance', () => {
    expect(distanceKm(30.04, 31.24, 30.04, 31.24)).toBe(0);
    // Cairo → Makkah is about 1,280 km.
    expect(Math.round(distanceKm(30.04, 31.24, 21.39, 39.86) / 10) * 10).toBeGreaterThan(1200);
    expect(distanceKm(30.04, 31.24, 21.39, 39.86)).toBeLessThan(1350);
  });

  it('finds the nearest listed city', () => {
    const giza = nearestCity(cities, 30.01, 31.21)!;
    expect(giza.city.id).toBe('cairo');
    expect(giza.km).toBeLessThan(10);
    expect(nearestCity([], 0, 0)).toBeNull();
  });
});

describe('country then city', () => {
  it('lists countries by name in the app language and finds them by name or code', () => {
    const countries = countriesOf(cities, 'ar');
    expect(countries.map((c) => c.code).sort()).toEqual(['EG', 'SA']);
    expect(searchCountries(countries, 'مصر').map((c) => c.code)).toEqual(['EG']);
    expect(searchCountries(countriesOf(cities, 'en'), 'sa').map((c) => c.code)).toEqual(['SA']);
  });
  it('lists the cities of one country, matching Arabic without hamza and English in any case', () => {
    expect(citiesIn(cities, 'SA', '').map((c) => c.id)).toEqual(['makkah']);
    expect(citiesIn(cities, 'SA', 'مكه').map((c) => c.id)).toEqual(['makkah']);
    expect(citiesIn(cities, 'EG', 'CAIRO').map((c) => c.id)).toEqual(['cairo']);
    expect(citiesIn(cities, 'EG', 'makkah')).toEqual([]);
  });
});
