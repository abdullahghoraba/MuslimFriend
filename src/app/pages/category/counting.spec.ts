import { nextDhikrCount } from './counting';
describe('nextDhikrCount', () => {
  it.each([[0, 3, false, 1], [2, 3, false, 3], [3, 3, false, 3], [7, 3, false, 7], [3, 3, true, 4], [7, 3, true, 8]])('counts %s toward %s with overflow %s', (count, target, past, expected) => {
    expect(nextDhikrCount(count as number, target as number, past as boolean)).toBe(expected);
  });
});
