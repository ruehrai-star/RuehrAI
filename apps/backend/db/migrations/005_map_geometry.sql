-- KAN-52 / KAN-53: target-region extent and overlay for the map MVP.
-- bounds_* is west, south, east, north in WGS84 degrees.
-- geometry is a GeoJSON Polygon or MultiPolygon (EPSG:4326, longitude then latitude).
-- Store pin coordinates stay on app.store_locations.lon/lat (KAN-49). This
-- migration does not geocode existing rows; GET /stores fills a missing pair
-- from the PLZ catalog, and PUT /target-region persists bounds and geometry.

ALTER TABLE app.target_regions
  ADD COLUMN bounds_west double precision,
  ADD COLUMN bounds_south double precision,
  ADD COLUMN bounds_east double precision,
  ADD COLUMN bounds_north double precision,
  ADD COLUMN geometry jsonb;

ALTER TABLE app.target_regions
  ADD CONSTRAINT target_regions_bounds CHECK (
    (
      bounds_west IS NULL
      AND bounds_south IS NULL
      AND bounds_east IS NULL
      AND bounds_north IS NULL
    )
    OR (
      bounds_west BETWEEN -180 AND 180
      AND bounds_east BETWEEN -180 AND 180
      AND bounds_west <= bounds_east
      AND bounds_south BETWEEN -90 AND 90
      AND bounds_north BETWEEN -90 AND 90
      AND bounds_south <= bounds_north
    )
  );

ALTER TABLE app.target_regions
  ADD CONSTRAINT target_regions_geometry_type CHECK (
    geometry IS NULL
    OR (
      jsonb_typeof(geometry) = 'object'
      AND geometry->>'type' IN ('Polygon', 'MultiPolygon')
      AND jsonb_typeof(geometry->'coordinates') = 'array'
    )
  );
