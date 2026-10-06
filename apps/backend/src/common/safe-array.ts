/** Iterative min — `Math.min(...arr)` throws RangeError on large arrays. */
export function minNumber(values: Iterable<number>, fallback = Infinity): number {
  let min = fallback;
  let seen = false;
  for (const value of values) {
    if (!seen || value < min) {
      min = value;
      seen = true;
    }
  }
  return min;
}

/** Iterative max — `Math.max(...arr)` throws RangeError on large arrays. */
export function maxNumber(values: Iterable<number>, fallback = -Infinity): number {
  let max = fallback;
  let seen = false;
  for (const value of values) {
    if (!seen || value > max) {
      max = value;
      seen = true;
    }
  }
  return max;
}

/** Iterative concat — `target.push(...arr)` throws RangeError on large arrays. */
export function pushAll<T>(target: T[], items: Iterable<T>): void {
  for (const item of items) target.push(item);
}

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function yieldIfDue(
  lastYieldAt: { ms: number },
  yieldMs = 20,
): Promise<boolean> {
  if (Date.now() - lastYieldAt.ms < yieldMs) return false;
  await yieldEventLoop();
  lastYieldAt.ms = Date.now();
  return true;
}
