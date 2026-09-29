-- Map pins for Berlin stores whose postal code is not in 001_init.sql.
-- 12247 (Lankwitz), 12169 (Steglitz) and 12209 (Lichterfelde) had no
-- plz5 row, so Create stored lon/lat NULL and GET /stores could not
-- fill a pin. plz5:10115 is re-asserted with the same centroid as 001.
--
-- Points are synthetic WGS84 PLZ5 centroids at four decimal places
-- (same style as plz5:10115 = 13.3870, 52.5320). They are not official
-- boundaries and do not come from an external geocoder.
-- An existing row keeps its coordinates. A stub that is present with a
-- null pair receives these values. Stores with a null pair then copy
-- the matching plz5 centroid.

INSERT INTO app.search_places (id, label, grain, ags, plz, address, lon, lat)
VALUES
  ('plz5:12247', '12247 Berlin', 'plz5', '11000000', '12247', NULL, 13.3457, 52.4403),
  ('plz5:12169', '12169 Berlin', 'plz5', '11000000', '12169', NULL, 13.3417, 52.4543),
  ('plz5:12209', '12209 Berlin', 'plz5', '11000000', '12209', NULL, 13.3316, 52.4186),
  ('plz5:10115', '10115 Berlin', 'plz5', '11000000', '10115', NULL, 13.3870, 52.5320)
ON CONFLICT (id) DO UPDATE
SET lon = EXCLUDED.lon,
    lat = EXCLUDED.lat
WHERE search_places.lon IS NULL
  AND search_places.lat IS NULL;

INSERT INTO app.map_features (id, layer_id, properties, geometry)
VALUES
  (
    'plz5:12247',
    'demo-plz',
    '{"label":"12247 Berlin","grain":"plz5","plz":"12247","stub":true}'::jsonb,
    '{"type":"Point","coordinates":[13.3457,52.4403]}'::jsonb
  ),
  (
    'plz5:12169',
    'demo-plz',
    '{"label":"12169 Berlin","grain":"plz5","plz":"12169","stub":true}'::jsonb,
    '{"type":"Point","coordinates":[13.3417,52.4543]}'::jsonb
  ),
  (
    'plz5:12209',
    'demo-plz',
    '{"label":"12209 Berlin","grain":"plz5","plz":"12209","stub":true}'::jsonb,
    '{"type":"Point","coordinates":[13.3316,52.4186]}'::jsonb
  ),
  (
    'plz5:10115',
    'demo-plz',
    '{"label":"10115 Berlin","grain":"plz5","plz":"10115","stub":true}'::jsonb,
    '{"type":"Point","coordinates":[13.387,52.532]}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

UPDATE app.store_locations AS s
SET lon = p.lon,
    lat = p.lat,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (plz) plz, lon, lat
  FROM app.search_places
  WHERE grain = 'plz5'
    AND plz IS NOT NULL
    AND lon IS NOT NULL
    AND lat IS NOT NULL
  ORDER BY plz, id
) AS p
WHERE s.postal_code = p.plz
  AND s.lon IS NULL
  AND s.lat IS NULL;
