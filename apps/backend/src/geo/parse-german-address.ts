export interface ParsedStreetAddress {
  street: string;
  houseNumber: string;
}

const HOUSE_NUMBER = String.raw`\d{1,4}\s*[a-zA-Z]?(?:\s*[-–/]\s*\d{0,4}\s*[a-zA-Z]?)?`;

/** Street name, then a house number. German addresses put the number at the end. */
const TRAILING_HOUSE_NUMBER = new RegExp(
  String.raw`^(?<street>.+?)(?:\s*,\s*|\s+)(?:(?:nr|no|hausnummer|hausnr)\.?\s*)?(?<hnr>${HOUSE_NUMBER})\s*$`,
  "i",
);

export function parseGermanStreet(input: string): ParsedStreetAddress | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  const match = TRAILING_HOUSE_NUMBER.exec(trimmed);
  const street = match?.groups?.street?.trim().replace(/[,\s]+$/, "") ?? "";
  const houseNumber = compactHouseNumber(match?.groups?.hnr ?? "");
  if (!street || !houseNumber) return null;
  return { street, houseNumber };
}

/** Comparison keys for `geo_ref_address.strasse` (lower case, abbreviation variants). */
export function streetMatchKeys(street: string): string[] {
  const collapsed = street.trim().replace(/\s+/g, " ");
  const seeds = new Set<string>();
  const consider = (value: string) => {
    const next = value.trim().replace(/\s+/g, " ");
    if (next) seeds.add(next);
  };
  consider(collapsed);
  consider(collapsed.replace(/\bstr\./gi, "straße"));
  consider(collapsed.replace(/str\.?$/i, "straße"));
  consider(collapsed.replace(/\bpl\./gi, "platz"));
  consider(collapsed.replace(/pl\.?$/i, "platz"));
  consider(collapsed.replace(/strasse/gi, "straße"));
  consider(collapsed.replace(/straße/gi, "strasse"));

  const keys = new Set<string>();
  for (const seed of seeds) {
    const lower = seed.toLowerCase();
    keys.add(lower);
    keys.add(lower.replace(/ß/g, "ss"));
  }
  return [...keys];
}

/** Comparison keys for `geo_ref_address.hnr`. The caller's form is first. */
export function houseNumberMatchKeys(houseNumber: string): string[] {
  const compact = compactHouseNumber(houseNumber);
  if (!compact) return [];
  const keys = new Set<string>([compact]);
  keys.add(compact.replace(/\//g, "-"));
  keys.add(compact.replace(/-/g, "/"));
  return [...keys];
}

export function compactHouseNumber(houseNumber: string): string {
  return houseNumber.toLowerCase().replace(/\s+/g, "").replace(/–/g, "-");
}
