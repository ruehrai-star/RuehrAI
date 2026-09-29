import type { Grain, MonthlyRevenuePoint, SearchHit, TargetRegionWrite } from "@ruehrai/api-contracts";

export interface StoreDraft {
  label: string;
  street: string;
  postalCode: string;
  city: string;
}

export interface MonthRow {
  year: number;
  month: number;
  monthNumber: string;
  monthName: string;
  revenueEur: number | null;
  missing: boolean;
  invalid: boolean;
}

const REVENUE_YEAR_SPAN = 3;

export function toTargetRegionWrite(hit: SearchHit): TargetRegionWrite {
  const geoKey = typeof hit.geoKey === "string" ? hit.geoKey : null;
  return {
    label: hit.label,
    grain: hit.grain,
    geoKey,
    ags: agsFromHit(hit.grain, geoKey),
    plz: plzFromHit(hit.grain, geoKey),
    lon: typeof hit.lon === "number" ? hit.lon : null,
    lat: typeof hit.lat === "number" ? hit.lat : null,
  };
}

export function validateStoreDraft(draft: StoreDraft): string | null {
  if (!draft.label.trim()) return "Bezeichnung fehlt.";
  if (!draft.street.trim()) return "Straße fehlt.";
  if (!/^[0-9]{5}$/.test(draft.postalCode.trim())) return "PLZ muss fünf Ziffern haben.";
  if (!draft.city.trim()) return "Ort fehlt.";
  return null;
}

export function toStoreWrite(draft: StoreDraft): {
  label: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: "DE";
} {
  return {
    label: draft.label.trim(),
    street: draft.street.trim(),
    postalCode: draft.postalCode.trim(),
    city: draft.city.trim(),
    countryCode: "DE",
  };
}

export function revenueYears(from: Date): number[] {
  const end = from.getUTCFullYear();
  return Array.from({ length: REVENUE_YEAR_SPAN }, (_, index) => end - (REVENUE_YEAR_SPAN - 1 - index));
}

export function formatMonthName(month: number): string {
  const date = new Date(Date.UTC(2020, month - 1, 1));
  return new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: "UTC" }).format(date);
}

export function formatMonthNumber(month: number): string {
  return String(month).padStart(2, "0");
}

export function revenueKey(year: number, month: number): string {
  return `${year}-${formatMonthNumber(month)}`;
}

export function isMissingRevenue(value: number | null | undefined): boolean {
  return value == null || !Number.isFinite(value);
}

export function parseRevenueInput(raw: string): number | null | "invalid" {
  const trimmed = raw.trim().replace(/\s/g, "");
  if (!trimmed) return null;
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return "invalid";
  const value = Number(normalized);
  return Number.isFinite(value) ? value : "invalid";
}

export function formatRevenueInput(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function draftsForPoints(points: MonthlyRevenuePoint[]): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const point of points) {
    drafts[revenueKey(point.year, point.month)] = formatRevenueInput(point.revenueEur);
  }
  return drafts;
}

export function rowsForYear(
  year: number,
  saved: MonthlyRevenuePoint[],
  drafts: Record<string, string> | null,
): MonthRow[] {
  const byKey = new Map(saved.map((point) => [revenueKey(point.year, point.month), point.revenueEur]));
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const key = revenueKey(year, month);
    const draft = drafts?.[key];
    const parsed = drafts === null || draft === undefined ? (byKey.get(key) ?? null) : parseRevenueInput(draft);
    const invalid = parsed === "invalid";
    const revenueEur = invalid ? null : parsed;
    return {
      year,
      month,
      monthNumber: formatMonthNumber(month),
      monthName: formatMonthName(month),
      revenueEur,
      missing: !invalid && isMissingRevenue(revenueEur),
      invalid,
    };
  });
}

function agsFromHit(grain: Grain, geoKey: string | null): string | null {
  if ((grain !== "ags" && grain !== "ags5") || !geoKey || !/^[0-9]{2,8}$/.test(geoKey)) return null;
  return geoKey;
}

function plzFromHit(grain: Grain, geoKey: string | null): string | null {
  if ((grain !== "plz5" && grain !== "plz8") || !geoKey || !/^[0-9]{5}([0-9]{3})?$/.test(geoKey)) return null;
  return geoKey;
}
