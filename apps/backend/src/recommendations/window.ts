const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])/;

/** Calendar month `YYYY-MM` from a Brain `ref_period`, or null when it is not a month. */
export function monthKey(refPeriod: string | null | undefined): string | null {
  if (!refPeriod) return null;
  const match = MONTH_KEY.exec(refPeriod.trim());
  if (!match?.[1] || !match[2]) return null;
  return `${match[1]}-${match[2]}`;
}

/**
 * Six calendar months ending in the UTC month of `asOf`, oldest first.
 * September 2026 is April through September.
 */
export function lastSixMonths(asOf: Date): string[] {
  const keys: string[] = [];
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - offset, 1));
    keys.push(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return keys;
}
