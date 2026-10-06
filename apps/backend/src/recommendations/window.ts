import { yearWindow } from "../analysis/yearly-series";
import { RecommendationWindow } from "./types";

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])/;

/** Calendar month `YYYY-MM` from a Brain `ref_period`, or null when it is not a month. */
export function monthKey(refPeriod: string | null | undefined): string | null {
  if (!refPeriod) return null;
  const match = MONTH_KEY.exec(refPeriod.trim());
  if (!match?.[1] || !match?.[2]) return null;
  return `${match[1]}-${match[2]}`;
}

/** Three calendar years ending at the Brain-adjusted `asOf` year. */
export function threeYearWindow(asOf: Date, availableYears: number[] = []): RecommendationWindow {
  const years = yearWindow(asOf, availableYears);
  return { from: years[0] ?? "", to: years[years.length - 1] ?? "" };
}
