import { nextDhikrCount, resumeIndex, visibleItems } from './counting';

describe('resumeIndex', () => {
  const items = [{ id: 'a', repeatCount: 2 }, { id: 'b', repeatCount: 3 }, { id: 'c', repeatCount: 1 }];
  it('resumes a partially counted item', () => {
    expect(resumeIndex(items, new Map([['a', 2], ['b', 1]]), 'b')).toBe(1);
  });
  it('advances after the saved item was completed, including wraparound', () => {
    expect(resumeIndex(items, new Map([['a', 2]]), 'a')).toBe(1);
    expect(resumeIndex(items, new Map([['c', 1]]), 'c')).toBe(0);
  });
  it('falls back to the first unfinished item for old or hidden bookmarks', () => {
    expect(resumeIndex(items, new Map([['a', 2]]), 'removed')).toBe(1);
  });
  it('follows the item after reordering and keeps the finished state position', () => {
    expect(resumeIndex([...items].reverse(), new Map(), 'a')).toBe(2);
    expect(resumeIndex(items, new Map([['a', 2], ['b', 3], ['c', 1]]), 'c')).toBe(2);
  });
  it('starts at the first item with no progress for a new day', () => {
    expect(resumeIndex(items, new Map())).toBe(0);
    expect(resumeIndex([], new Map())).toBe(0);
  });
});
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
