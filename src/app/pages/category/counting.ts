/** Return the persisted next count, preserving any counts already above the target. */
export function nextDhikrCount(current: number, target: number, countPastTarget: boolean): number {
  return current < target || countPastTarget ? current + 1 : current;
}

/** Keep source order while optionally excluding completed items. */
export function visibleItems<T extends { id: string; repeatCount: number }>(
  items: T[], counts: ReadonlyMap<string, number>, onComplete: 'dim' | 'hide', showCompleted: boolean,
): T[] {
  return onComplete === 'dim' || showCompleted
    ? items
    : items.filter(item => (counts.get(item.id) ?? 0) < item.repeatCount);
}
