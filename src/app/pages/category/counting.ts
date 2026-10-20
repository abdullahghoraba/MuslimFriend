/** Return the persisted next count, preserving any counts already above the target. */
export function nextDhikrCount(current: number, target: number, countPastTarget: boolean): number {
  return current < target || countPastTarget ? current + 1 : current;
}
