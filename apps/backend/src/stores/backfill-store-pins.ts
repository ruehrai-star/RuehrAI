import { Pool } from "pg";
import { loadLocalEnv } from "../database/load-local-env";
import { queryAddressPin, queryPlzCentroid } from "../geo/address-lookup";
import { nextStoredPin, PinPoint } from "../geo/pin-resolution";

/** STAGE Berlin postal codes called out on KAN-56. */
export const DEFAULT_BACKFILL_PLZ = ["12247", "12169", "12209", "10115"];

interface StoreRow {
  id: string;
  street: string;
  postal_code: string;
  lon: number | null;
  lat: number | null;
}

/**
 * One-shot backfill for Eule. Writes Brain `app.store_locations` only.
 * Data-Scout is read-only. Not a schema migration.
 *
 * From `apps/backend`, with both URLs in the environment or `.env`:
 *   pnpm store-pins:backfill
 *   pnpm store-pins:backfill -- --dry-run
 *   pnpm store-pins:backfill -- --plz 12247,12169,12209,10115
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const dryRun = process.argv.includes("--dry-run");
  const postalCodes = plzArg(process.argv);
  const brainUrl = process.env.DATABASE_URL?.trim();
  const scoutUrl = process.env.DATASCOUT_DATABASE_URL?.trim();
  if (!brainUrl) throw new Error("DATABASE_URL is required");
  if (!scoutUrl) throw new Error("DATASCOUT_DATABASE_URL is required");

  const brain = new Pool({
    connectionString: brainUrl,
    max: 2,
    application_name: "ruehrai-store-pin-backfill",
  });
  const scout = new Pool({
    connectionString: scoutUrl,
    max: 2,
    application_name: "ruehrai-store-pin-backfill",
    options: "-c default_transaction_read_only=on",
  });

  let updated = 0;
  let unchanged = 0;
  try {
    const stores = await brain.query<StoreRow>(
      `SELECT id::text AS id, street, postal_code, lon, lat
       FROM app.store_locations
       WHERE postal_code = ANY($1::text[])
       ORDER BY id`,
      [postalCodes],
    );
    console.log(
      `${dryRun ? "dry-run" : "backfill"} ${stores.rowCount ?? stores.rows.length} store(s) in ${postalCodes.join(", ")}`,
    );
    for (const store of stores.rows) {
      const address = await queryAddressPin(
        (text, params) => scout.query(text, params),
        store.street,
        store.postal_code,
      );
      const geoPlz = await queryPlzCentroid(
        (text, params) => scout.query(text, params),
        store.postal_code,
      );
      const stub = await catalogCentroid(brain, store.postal_code);
      const next = nextStoredPin({
        stored: { lon: toNumber(store.lon), lat: toNumber(store.lat) },
        address,
        plzCentroids: [geoPlz, stub],
      });
      if (!next || next.source !== "address") {
        unchanged += 1;
        console.log(`skip ${store.id} ${store.postal_code} ${store.street}`);
        continue;
      }
      console.log(
        `${dryRun ? "would set" : "set"} ${store.id} ${store.street} ${store.postal_code} -> ${next.point.lon},${next.point.lat}`,
      );
      if (!dryRun) {
        await writePin(brain, store, next.point);
      }
      updated += 1;
    }
  } finally {
    await brain.end();
    await scout.end();
  }
  console.log(`${dryRun ? "would update" : "updated"} ${updated}, skipped ${unchanged}`);
}

function plzArg(argv: string[]): string[] {
  const index = argv.indexOf("--plz");
  const raw = index >= 0 ? argv[index + 1] : undefined;
  const codes = (raw ?? DEFAULT_BACKFILL_PLZ.join(","))
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
  if (codes.length === 0 || codes.some((code) => !/^[0-9]{5}$/.test(code))) {
    throw new Error("--plz expects comma-separated PLZ5 codes");
  }
  return codes;
}

async function catalogCentroid(brain: Pool, postalCode: string): Promise<PinPoint | null> {
  const places = await brain.query<{ lon: number | null; lat: number | null }>(
    `SELECT lon, lat
     FROM app.search_places
     WHERE plz = $1
       AND lon IS NOT NULL
       AND lat IS NOT NULL
     ORDER BY
       CASE grain
         WHEN 'plz5' THEN 0
         WHEN 'plz8' THEN 1
         WHEN 'address' THEN 2
         ELSE 3
       END,
       id
     LIMIT 1`,
    [postalCode],
  );
  const place = pointFrom(places.rows[0]);
  if (place) return place;
  const features = await brain.query<{ lon: number | null; lat: number | null }>(
    `SELECT (geometry->'coordinates'->>0)::float8 AS lon,
            (geometry->'coordinates'->>1)::float8 AS lat
     FROM app.map_features
     WHERE geometry->>'type' = 'Point'
       AND (
         properties->>'plz' = $1
         OR id = ANY($2::text[])
       )
     ORDER BY id
     LIMIT 1`,
    [postalCode, [`plz5:${postalCode}`, `plz8:${postalCode}`]],
  );
  return pointFrom(features.rows[0]);
}

async function writePin(brain: Pool, store: StoreRow, point: PinPoint): Promise<void> {
  const lon = toNumber(store.lon);
  const lat = toNumber(store.lat);
  await brain.query(
    `UPDATE app.store_locations
     SET lon = $2, lat = $3, updated_at = now()
     WHERE id = $1::bigint
       AND (
         lon IS NULL
         OR lat IS NULL
         OR (abs(lon - $4::float8) < 0.0001 AND abs(lat - $5::float8) < 0.0001)
       )`,
    [store.id, point.lon, point.lat, lon, lat],
  );
}

function pointFrom(
  row: { lon: number | null; lat: number | null } | undefined,
): PinPoint | null {
  if (!row) return null;
  const lon = toNumber(row.lon);
  const lat = toNumber(row.lat);
  if (lon === null || lat === null) return null;
  return { lon, lat };
}

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "backfill failed";
  console.error(message);
  process.exitCode = 1;
});
