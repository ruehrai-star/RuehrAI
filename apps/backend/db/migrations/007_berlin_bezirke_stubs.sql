-- Stub rectangles for the 12 Berlin Bezirke so PlaceCatalogService.lookupRegion
-- can fill GET/PUT /target-region when the client sends only grain + geoKey/ags.
--
-- These are the same family as stubPolygon in region-geometry.ts (grain "ags"):
-- a closed GeoJSON Polygon (EPSG:4326, longitude then latitude) of half-size
-- 0.18° longitude and 0.095° latitude around an approximate WGS84 centroid.
-- They are not official boundaries (keine amtlichen Grenzen). Centroids are
-- approximate borough centers at four decimal places, only to place the box.
--
-- Two feature ids per Bezirk, same polygon. properties.ags is the official key.
-- Lookup hits either id (geoKey as-is, ags:<key>, or grain:geoKey):
--   official  ags:11000001 .. ags:11000012     (110000 + n padded to 2 digits)
--   alias     ags:11001001 .. ags:11012012     (11 + n padded to 3 digits, twice)
-- Alias examples seen on STAGE: Steglitz-Zehlendorf 11006006, Tempelhof-Schöneberg 11007007.
--
-- Idempotent: safe to re-run on STAGE. ON CONFLICT refreshes these stub rows.
-- Layer berlin-bezirke is separate from demo-gemeinden (Berlin Land stays a Point).

DROP TABLE IF EXISTS pg_temp.berlin_bezirk_ags_seed;

CREATE TEMP TABLE berlin_bezirk_ags_seed (
  n smallint PRIMARY KEY,
  label text NOT NULL,
  lon numeric(7, 4) NOT NULL,
  lat numeric(7, 4) NOT NULL,
  CONSTRAINT berlin_bezirk_ags_seed_n CHECK (n BETWEEN 1 AND 12)
);

INSERT INTO berlin_bezirk_ags_seed (n, label, lon, lat)
VALUES
  (1, 'Berlin-Mitte', 13.3665, 52.5287),
  (2, 'Berlin-Friedrichshain-Kreuzberg', 13.4332, 52.5024),
  (3, 'Berlin-Pankow', 13.4263, 52.6100),
  (4, 'Berlin-Charlottenburg-Wilmersdorf', 13.2839, 52.5063),
  (5, 'Berlin-Spandau', 13.1868, 52.5369),
  (6, 'Berlin-Steglitz-Zehlendorf', 13.2353, 52.4302),
  (7, 'Berlin-Tempelhof-Schöneberg', 13.3745, 52.4472),
  (8, 'Berlin-Neukölln', 13.4558, 52.4431),
  (9, 'Berlin-Treptow-Köpenick', 13.6135, 52.4253),
  (10, 'Berlin-Marzahn-Hellersdorf', 13.5829, 52.5219),
  (11, 'Berlin-Lichtenberg', 13.5063, 52.5349),
  (12, 'Berlin-Reinickendorf', 13.3177, 52.6085);

INSERT INTO app.map_layers (id, name, description)
VALUES (
  'berlin-bezirke',
  'Berlin-Bezirke',
  'Synthetische Rechtecke um genäherte Schwerpunkte der zwölf Bezirke. Keine amtlichen Grenzen. Halbe Kantenlänge wie stubPolygon, grain ags: 0,18° Länge, 0,095° Breite.'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

WITH src AS (
  SELECT
    n,
    label,
    lon,
    lat,
    ('110000' || lpad(n::text, 2, '0')) AS official_ags,
    ('11' || lpad(n::text, 3, '0') || lpad(n::text, 3, '0')) AS alias_ags
  FROM berlin_bezirk_ags_seed
),
keys AS (
  SELECT official_ags AS feature_ags, official_ags, alias_ags, label, lon, lat, false AS is_alias
  FROM src
  UNION ALL
  SELECT alias_ags, official_ags, alias_ags, label, lon, lat, true
  FROM src
)
INSERT INTO app.map_features (id, layer_id, properties, geometry)
SELECT
  'ags:' || feature_ags,
  'berlin-bezirke',
  jsonb_strip_nulls(jsonb_build_object(
    'label', label,
    'grain', 'ags',
    'ags', official_ags,
    'agsAlias', alias_ags,
    'aliasOf', CASE WHEN is_alias THEN 'ags:' || official_ags END,
    'stub', true
  )),
  jsonb_build_object(
    'type', 'Polygon',
    'coordinates', jsonb_build_array(
      jsonb_build_array(
        jsonb_build_array(round(lon - 0.18, 4), round(lat - 0.095, 4)),
        jsonb_build_array(round(lon + 0.18, 4), round(lat - 0.095, 4)),
        jsonb_build_array(round(lon + 0.18, 4), round(lat + 0.095, 4)),
        jsonb_build_array(round(lon - 0.18, 4), round(lat + 0.095, 4)),
        jsonb_build_array(round(lon - 0.18, 4), round(lat - 0.095, 4))
      )
    )
  )
FROM keys
ON CONFLICT (id) DO UPDATE SET
  layer_id = EXCLUDED.layer_id,
  properties = EXCLUDED.properties,
  geometry = EXCLUDED.geometry;

WITH src AS (
  SELECT
    label,
    lon,
    lat,
    ('110000' || lpad(n::text, 2, '0')) AS official_ags,
    ('11' || lpad(n::text, 3, '0') || lpad(n::text, 3, '0')) AS alias_ags
  FROM berlin_bezirk_ags_seed
),
keys AS (
  SELECT official_ags AS feature_ags, label, lon, lat FROM src
  UNION ALL
  SELECT alias_ags, label, lon, lat FROM src
)
INSERT INTO app.search_places (id, label, grain, ags, plz, address, lon, lat)
SELECT
  'ags:' || feature_ags,
  label,
  'ags',
  feature_ags,
  NULL,
  NULL,
  lon::double precision,
  lat::double precision
FROM keys
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  grain = EXCLUDED.grain,
  ags = EXCLUDED.ags,
  plz = EXCLUDED.plz,
  address = EXCLUDED.address,
  lon = EXCLUDED.lon,
  lat = EXCLUDED.lat;

DROP TABLE IF EXISTS pg_temp.berlin_bezirk_ags_seed;
