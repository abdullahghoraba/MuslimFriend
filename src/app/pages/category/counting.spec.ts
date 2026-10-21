import { nextDhikrCount, visibleItems } from './counting';
describe('nextDhikrCount', () => {
  it.each([[0, 3, false, 1], [2, 3, false, 3], [3, 3, false, 3], [7, 3, false, 7], [3, 3, true, 4], [7, 3, true, 8]])('counts %s toward %s with overflow %s', (count, target, past, expected) => {
    expect(nextDhikrCount(count as number, target as number, past as boolean)).toBe(expected);
  });
});

describe('visibleItems', () => {
  const items = [{ id: 'a', repeatCount: 2 }, { id: 'b', repeatCount: 1 }, { id: 'c', repeatCount: 3 }, { id: 'd', repeatCount: 1 }];
  const counts = new Map([['a', 2], ['c', 4]]);
  it('keeps all items in dim mode', () => expect(visibleItems(items, counts, 'dim', false)).toEqual(items));
  it('hides completed items and preserves order', () => expect(visibleItems(items, counts, 'hide', false)).toEqual([items[1], items[3]]));
  it('reveals completed items in their original order', () => expect(visibleItems(items, counts, 'hide', true)).toEqual(items));
  it('restores all items after resetting counts', () => expect(visibleItems(items, new Map(), 'hide', false)).toEqual(items));
});
