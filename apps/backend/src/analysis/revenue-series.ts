import {
  AnalysisRevenueChange,
  AnalysisRevenuePoint,
  RevenueDirection,
} from "./types";

/** Product window: about three years of monthly figures. */
export const ANALYSIS_MONTH_WINDOW = 36;

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function latestPoints(points: AnalysisRevenuePoint[]): AnalysisRevenuePoint[] {
  const ordered = [...points].sort(compareYearMonth);
  if (ordered.length <= ANALYSIS_MONTH_WINDOW) return ordered;
  return ordered.slice(ordered.length - ANALYSIS_MONTH_WINDOW);
}

/**
 * Month-to-month changes between successive calendar months that both have
 * a revenue. A missing month breaks the chain; it is not filled in.
 */
export function monthChanges(points: AnalysisRevenuePoint[]): AnalysisRevenueChange[] {
  const known = new Map<string, number>();
  for (const point of points) {
    if (point.revenueEur === null) continue;
    known.set(monthKey(point.year, point.month), point.revenueEur);
  }

  const changes: AnalysisRevenueChange[] = [];
  for (const point of points) {
    if (point.revenueEur === null) continue;
    const next = nextMonth(point.year, point.month);
    const following = known.get(monthKey(next.year, next.month));
    if (following === undefined) continue;
    changes.push({
      fromYear: point.year,
      fromMonth: point.month,
      toYear: next.year,
      toMonth: next.month,
      fromRevenueEur: point.revenueEur,
      toRevenueEur: following,
      changeEur: roundMoney(following - point.revenueEur),
    });
  }
  return changes;
}

export function revenueDirection(changes: AnalysisRevenueChange[]): RevenueDirection {
  const sum = roundMoney(changes.reduce((total, change) => total + change.changeEur, 0));
  if (sum > 0) return "up";
  if (sum < 0) return "down";
  return "flat";
}

export function hasAdjacentRevenue(points: AnalysisRevenuePoint[]): boolean {
  return monthChanges(points).length > 0;
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

function compareYearMonth(
  left: { year: number; month: number },
  right: { year: number; month: number },
): number {
  if (left.year !== right.year) return left.year - right.year;
  return left.month - right.month;
}
