/** Return the persisted next count, preserving any counts already above the target. */
export function nextDhikrCount(current: number, target: number, countPastTarget: boolean): number {
  return current < target || countPastTarget ? current + 1 : current;
}

/** Resume the saved unfinished item, or the next unfinished one after a completed item. */
export function resumeIndex(
  items: { id: string; repeatCount: number }[], counts: ReadonlyMap<string, number>, savedId?: string,
): number {
  const saved = Math.max(0, items.findIndex(item => item.id === savedId));
  for (let offset = 0; offset < items.length; offset++) {
    const index = (saved + offset) % items.length;
    if ((counts.get(items[index].id) ?? 0) < items[index].repeatCount) return index;
  }
  return saved;
}

/** Keep source order while optionally excluding completed items. */
export function visibleItems<T extends { id: string; repeatCount: number }>(
  items: T[], counts: ReadonlyMap<string, number>, onComplete: 'dim' | 'hide', showCompleted: boolean,
): T[] {
  return onComplete === 'dim' || showCompleted
    ? items
    : items.filter(item => (counts.get(item.id) ?? 0) < item.repeatCount);
}
