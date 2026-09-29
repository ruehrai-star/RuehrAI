import type { Grain, SearchHit } from "@ruehrai/api-contracts";

export interface RegionDraft {
  label: string;
  grain: Grain;
  geoKey: string | null;
  lon: number | null;
  lat: number | null;
}

export interface TargetRegion extends RegionDraft {
  id: string;
}

export interface StoreDraft {
  name: string;
  street: string;
  postalCode: string;
  city: string;
}

export interface StoreAddress extends StoreDraft {
  id: string;
}

export interface MonthlyRevenue {
  month: string;
  revenueEur: number | null;
}

export interface MonthRow {
  month: string;
  label: string;
  revenueEur: number | null;
  missing: boolean;
  invalid: boolean;
}

export function regionDraftFromHit(hit: SearchHit): RegionDraft {
  return {
    label: hit.label,
    grain: hit.grain,
    geoKey: typeof hit.geoKey === "string" ? hit.geoKey : null,
    lon: typeof hit.lon === "number" ? hit.lon : null,
    lat: typeof hit.lat === "number" ? hit.lat : null,
  };
}

export function validateStoreDraft(draft: StoreDraft): string | null {
  if (!draft.name.trim()) return "Bezeichnung fehlt.";
  if (!draft.street.trim()) return "Straße fehlt.";
  if (!/^[0-9]{5}$/.test(draft.postalCode.trim())) return "PLZ muss fünf Ziffern haben.";
  if (!draft.city.trim()) return "Ort fehlt.";
  return null;
}

export function normalizeStoreDraft(draft: StoreDraft): StoreDraft {
  return {
    name: draft.name.trim(),
    street: draft.street.trim(),
    postalCode: draft.postalCode.trim(),
    city: draft.city.trim(),
  };
}

export function monthKeys(count: number, from: Date): string[] {
  if (count < 1) return [];
  const anchor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(anchor);
    date.setUTCMonth(anchor.getUTCMonth() - i);
    keys.push(monthKey(date));
  }
  return keys;
}

export function formatMonthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
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

export function formatEuro(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

export function rowsForMonths(months: string[], saved: MonthlyRevenue[], drafts: Record<string, string>): MonthRow[] {
  const byMonth = new Map(saved.map((row) => [row.month, row.revenueEur]));
  return months.map((month) => {
    const draft = drafts[month];
    const parsed = draft === undefined ? (byMonth.get(month) ?? null) : parseRevenueInput(draft);
    const invalid = parsed === "invalid";
    const revenueEur = invalid ? null : parsed;
    return {
      month,
      label: formatMonthLabel(month),
      revenueEur,
      missing: !invalid && isMissingRevenue(revenueEur),
      invalid,
    };
  });
}

export function draftsFromSaved(months: string[], saved: MonthlyRevenue[]): Record<string, string> {
  const byMonth = new Map(saved.map((row) => [row.month, row.revenueEur]));
  const drafts: Record<string, string> = {};
  for (const month of months) {
    const value = byMonth.get(month);
    drafts[month] = formatRevenueInput(value ?? null);
  }
  return drafts;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
