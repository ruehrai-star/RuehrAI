-- KAN-56: move Berlin store pins from PLZ centroids onto geo_ref_address.
--
-- Run on Eule against Brain. Data-Scout is read through dblink (SELECT only).
-- This file is not a schema migration and is not applied by `pnpm db:migrate`.
--
--   export DATABASE_URL='postgres://ruehrai@localhost:5432/Brain'
--   export DATASCOUT_DATABASE_URL='postgres://ruehrai@localhost:5432/Data-Scout'
--   psql "$DATABASE_URL" -v datascout_conn="$DATASCOUT_DATABASE_URL" \
--     -f apps/backend/db/ops/kan-56-backfill-store-pins.sql
--
-- One-time, as a superuser, if dblink is missing:
--   CREATE EXTENSION dblink;
-- Without dblink, from apps/backend:
--   pnpm store-pins:backfill
--   pnpm store-pins:backfill -- --dry-run
--
-- Postal codes: 12247, 12169, 12209, 10115.
-- A row is updated only when street + house number hits geo_ref_address and
-- the stored pin is null or still on a PLZ centroid (geo_ref_plz, within
-- 0.0001 degrees, or the app.search_places / map_features stub).
-- Explicit pins are left alone. Replace COMMIT with ROLLBACK for a dry run.
-- Do not put a password in this file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'dblink') THEN
    RAISE EXCEPTION
      'dblink is not installed. Superuser: CREATE EXTENSION dblink. Or run: pnpm --filter @ruehrai/backend store-pins:backfill';
  END IF;
END $$;

BEGIN;

CREATE TEMP TABLE kan56_address (
  plz text,
  strasse text,
  hnr text,
  lon double precision,
  lat double precision
) ON COMMIT DROP;

INSERT INTO kan56_address
SELECT *
FROM dblink(
  :'datascout_conn',
  $remote$
    SELECT btrim(plz::text), btrim(strasse), btrim(hnr), lon, lat
    FROM public.geo_ref_address
    WHERE plz IN ('12247', '12169', '12209', '10115')
      AND lon IS NOT NULL
      AND lat IS NOT NULL
  $remote$
) AS remote_address(plz text, strasse text, hnr text, lon double precision, lat double precision);

CREATE TEMP TABLE kan56_plz (
  plz text,
  lon double precision,
  lat double precision
) ON COMMIT DROP;

INSERT INTO kan56_plz
SELECT *
FROM dblink(
  :'datascout_conn',
  $remote$
    SELECT btrim(geo_plz5::text), centroid_lon, centroid_lat
    FROM public.geo_ref_plz
    WHERE geo_plz5 IN ('12247', '12169', '12209', '10115')
      AND centroid_lon IS NOT NULL
      AND centroid_lat IS NOT NULL
  $remote$
) AS remote_plz(plz text, lon double precision, lat double precision);

CREATE OR REPLACE FUNCTION pg_temp.kan56_street_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(btrim(coalesce(value, ''))), '[[:space:]]+', ' ', 'g'),
          '\mstr\.',
          'straße',
          'g'
        ),
        'str\.?$',
        'straße'
      ),
      '\mpl\.',
      'platz',
      'g'
    ),
    'ß',
    'ss'
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.kan56_hnr_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(
    replace(
      regexp_replace(lower(btrim(coalesce(value, ''))), '[[:space:]]+', '', 'g'),
      '–',
      '-'
    ),
    '/',
    '-'
  );
$$;

UPDATE app.store_locations AS s
SET lon = hit.lon,
    lat = hit.lat,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (parsed.id)
    parsed.id,
    address.lon,
    address.lat
  FROM (
    SELECT
      store.id,
      store.postal_code,
      pg_temp.kan56_street_key(
        regexp_replace(
          store.street,
          '[, ]+(?:(?:nr|no|hausnummer|hausnr)\.?\s*)?[0-9]{1,4}\s*[a-zA-Z]?(?:\s*[-–/]\s*[0-9]{0,4}\s*[a-zA-Z]?)?\s*$',
          '',
          'i'
        )
      ) AS street_key,
      pg_temp.kan56_hnr_key(
        substring(
          store.street
          from '([0-9]{1,4}\s*[a-zA-Z]?(?:\s*[-–/]\s*[0-9]{0,4}\s*[a-zA-Z]?)?)\s*$'
        )
      ) AS hnr_key
    FROM app.store_locations AS store
    WHERE store.postal_code IN ('12247', '12169', '12209', '10115')
  ) AS parsed
  JOIN kan56_address AS address
    ON address.plz = parsed.postal_code
   AND pg_temp.kan56_street_key(address.strasse) = parsed.street_key
   AND pg_temp.kan56_hnr_key(address.hnr) = parsed.hnr_key
  WHERE parsed.hnr_key <> ''
  ORDER BY parsed.id, address.lon, address.lat
) AS hit
WHERE s.id = hit.id
  AND (
    s.lon IS NULL
    OR s.lat IS NULL
    OR EXISTS (
      SELECT 1
      FROM kan56_plz AS zone
      WHERE zone.plz = s.postal_code
        AND abs(s.lon - zone.lon) < 0.0001
        AND abs(s.lat - zone.lat) < 0.0001
    )
    OR EXISTS (
      SELECT 1
      FROM app.search_places AS place
      WHERE place.plz = s.postal_code
        AND place.lon IS NOT NULL
        AND place.lat IS NOT NULL
        AND abs(s.lon - place.lon) < 0.0001
        AND abs(s.lat - place.lat) < 0.0001
    )
    OR EXISTS (
      SELECT 1
      FROM app.map_features AS feature
      WHERE feature.geometry->>'type' = 'Point'
        AND (
          feature.properties->>'plz' = s.postal_code
          OR feature.id IN ('plz5:' || s.postal_code, 'plz8:' || s.postal_code)
        )
        AND abs(s.lon - (feature.geometry->'coordinates'->>0)::float8) < 0.0001
        AND abs(s.lat - (feature.geometry->'coordinates'->>1)::float8) < 0.0001
    )
  )
  AND (
    s.lon IS NULL
    OR s.lat IS NULL
    OR abs(s.lon - hit.lon) >= 0.0001
    OR abs(s.lat - hit.lat) >= 0.0001
  )
RETURNING s.id::text AS id, s.street, s.postal_code, s.lon, s.lat;

COMMIT;
