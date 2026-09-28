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

export function grainLabel(grain: Grain): string {
  return GRAIN_LABELS[grain];
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
