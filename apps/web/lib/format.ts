import type { Grain } from "./api/types";

const GRAIN_LABELS: Record<Grain, string> = {
  address: "Adresse",
  grid100: "100-m-Gitter",
  plz8: "PLZ8",
  plz5: "PLZ",
  ags: "Gemeinde",
  ags5: "Kreis",
  other: "Sonstiges",
};

/**
 * German badge for a contract grain.
 *
 * Berlin Bezirke stay `ags` in the API. Their canonical 8-digit AGS is
 * `11000001`–`11000012` (search ids `ags:11000001` … `ags:11000012`).
 * Those badges say „Bezirk“. Every other `ags` stays „Gemeinde“, including
 * Berlin `11000000`. Pass `geoKey`, `ags`, or a search id.
 */
export function grainLabel(grain: Grain, geoKey?: string | null): string {
  if (grain === "ags" && isBerlinBezirkAgs(geoKey)) return "Bezirk";
  return GRAIN_LABELS[grain];
}

function isBerlinBezirkAgs(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  let code = value.trim();
  if (code.startsWith("ags:")) code = code.slice(4);
  if (!/^[0-9]{8}$/.test(code)) return false;
  const ags = Number(code);
  return ags >= 11000001 && ags <= 11000012;
}

export function zoomForGrain(grain: Grain): number {
  switch (grain) {
    case "address":
      return 16;
    case "grid100":
      return 15.5;
    case "plz8":
      return 14;
    case "plz5":
      return 13;
    case "ags":
    case "ags5":
      return 11;
    default:
      return 12;
  }
}
