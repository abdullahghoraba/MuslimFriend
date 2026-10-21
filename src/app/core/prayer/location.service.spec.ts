import { City, distanceKm, nearestCity } from './location.service';

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
