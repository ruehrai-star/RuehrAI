/**
 * Berlin Bezirk keys.
 *
 * Official AGS is `11000001` … `11000012` (`110000` + n padded to 2 digits).
 * Older clients sent `11` + n padded to 3 digits, twice: `11001001` …
 * `11012012`, including Steglitz-Zehlendorf `11006006` and
 * Tempelhof-Schöneberg `11007007`. Location-Guide stores only the official
 * ids. `11000000` is Berlin as a whole and is not an alias.
 */

const ALIAS = /^11(\d{3})\1$/;
const OFFICIAL = /^110000(0[1-9]|1[0-2])$/;

export function isOfficialBerlinBezirkAgs(value: string): boolean {
  return OFFICIAL.test(value);
}

/** Map a doubled Bezirk alias onto `1100000N`. Any other string is unchanged. */
export function canonicalBerlinBezirkAgs(value: string): string {
  const match = ALIAS.exec(value);
  if (!match?.[1]) return value;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n < 1 || n > 12) return value;
  return `11000${match[1]}`;
}

/** Rewrite a bare AGS or an `ags:` feature id. Null stays null. */
export function canonicalizePlaceKey(value: string | null): string | null {
  if (!value) return null;
  const prefixed = /^ags:(.+)$/.exec(value);
  if (prefixed?.[1]) return `ags:${canonicalBerlinBezirkAgs(prefixed[1])}`;
  return canonicalBerlinBezirkAgs(value);
}

/**
 * Keys persisted on `app.target_regions` and used for catalog lookup.
 * A Berlin Bezirk alias in `geoKey` with an empty `ags` also fills `ags`.
 */
export function canonicalRegionKeys(input: {
  geoKey: string | null;
  ags: string | null;
}): { geoKey: string | null; ags: string | null } {
  const geoKey = canonicalizePlaceKey(input.geoKey);
  let ags = input.ags ? canonicalBerlinBezirkAgs(input.ags) : null;
  if (!ags) {
    const bare = bareAgs(geoKey);
    if (bare && isOfficialBerlinBezirkAgs(bare)) ags = bare;
  }
  return { geoKey, ags };
}

function bareAgs(geoKey: string | null): string | null {
  if (!geoKey) return null;
  const bare = geoKey.startsWith("ags:") ? geoKey.slice(4) : geoKey;
  return /^[0-9]{2,8}$/.test(bare) ? bare : null;
}
