import { toCoord } from "../customer/values";
import {
  houseNumberMatchKeys,
  parseGermanStreet,
  streetMatchKeys,
} from "./parse-german-address";
import { PinPoint } from "./pin-resolution";

export interface GeoQuery {
  (
    text: string,
    params: unknown[],
  ): Promise<{ rows: Array<{ lon?: unknown; lat?: unknown }> } | null>;
}

/**
 * `plz = $1` matches `geo_ref_address_plz_idx`. Street and house number are
 * filtered on that PLZ slice. Read-only.
 */
export const ADDRESS_LOOKUP_SQL = `
  SELECT lon, lat
  FROM public.geo_ref_address
  WHERE plz = $1
    AND lower(btrim(strasse)) = ANY($2::text[])
    AND lower(regexp_replace(replace(btrim(hnr), '–', '-'), '[[:space:]]+', '', 'g')) = ANY($3::text[])
    AND lon IS NOT NULL
    AND lat IS NOT NULL
  ORDER BY
    CASE
      WHEN lower(regexp_replace(replace(btrim(hnr), '–', '-'), '[[:space:]]+', '', 'g')) = $4 THEN 0
      ELSE 1
    END
  LIMIT 1
`;

/** WGS84 centroid. `geo_plz8` mirrors `geo_plz5` in the loaded table. */
export const PLZ_CENTROID_SQL = `
  SELECT centroid_lon AS lon, centroid_lat AS lat
  FROM public.geo_ref_plz
  WHERE geo_plz5 = $1
     OR geo_plz8 = $1
  LIMIT 1
`;

export async function queryAddressPin(
  query: GeoQuery,
  street: string,
  postalCode: string,
): Promise<PinPoint | null> {
  const parsed = parseGermanStreet(street);
  if (!parsed || !/^[0-9]{5}$/.test(postalCode)) return null;
  const streets = streetMatchKeys(parsed.street);
  const numbers = houseNumberMatchKeys(parsed.houseNumber);
  if (streets.length === 0 || numbers.length === 0) return null;
  const result = await query(ADDRESS_LOOKUP_SQL, [
    postalCode,
    streets,
    numbers,
    numbers[0],
  ]);
  return pointFrom(result?.rows[0]);
}

export async function queryPlzCentroid(
  query: GeoQuery,
  postalCode: string,
): Promise<PinPoint | null> {
  if (!/^[0-9]{5}$/.test(postalCode)) return null;
  const result = await query(PLZ_CENTROID_SQL, [postalCode]);
  return pointFrom(result?.rows[0]);
}

function pointFrom(row: { lon?: unknown; lat?: unknown } | undefined): PinPoint | null {
  if (!row) return null;
  const lon = toCoord(row.lon as number | string | null | undefined);
  const lat = toCoord(row.lat as number | string | null | undefined);
  if (lon === null || lat === null) return null;
  return { lon, lat };
}
