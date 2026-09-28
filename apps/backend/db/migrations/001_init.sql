-- App schema for the Dev-Team API slice.
-- Password hashes use pgcrypto crypt()/bf (bcrypt). The seeded user is a
-- local-dev fixture (dev@ruehrai.local / dev-password), not a production account.
-- Geometries below are synthetic stubs so /search and /layers/{id} return data
-- before official boundaries are loaded. They are not amtliche Grenzen.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE app.users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 320),
  CONSTRAINT users_password_hash_present CHECK (char_length(password_hash) BETWEEN 1 AND 200)
);

CREATE TABLE app.search_places (
  id text PRIMARY KEY,
  label text NOT NULL,
  grain text NOT NULL,
  ags text,
  plz text,
  address text,
  lon double precision,
  lat double precision,
  CONSTRAINT search_places_label_present CHECK (char_length(label) > 0),
  CONSTRAINT search_places_grain CHECK (
    grain IN ('address', 'grid100', 'plz8', 'plz5', 'ags', 'ags5', 'other')
  ),
  CONSTRAINT search_places_ags_shape CHECK (ags IS NULL OR ags ~ '^[0-9]{2,8}$'),
  CONSTRAINT search_places_plz_shape CHECK (plz IS NULL OR plz ~ '^[0-9]{5}([0-9]{3})?$'),
  CONSTRAINT search_places_coords CHECK (
    (lon IS NULL AND lat IS NULL)
    OR (lon BETWEEN -180 AND 180 AND lat BETWEEN -90 AND 90)
  )
);

-- Equality filters on ags and plz. Substring search (ILIKE) stays a sequential
-- scan until the catalog is large enough to justify pg_trgm.
CREATE INDEX search_places_ags_idx ON app.search_places (ags);
CREATE INDEX search_places_plz_idx ON app.search_places (plz);

CREATE TABLE app.map_layers (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  CONSTRAINT map_layers_name_present CHECK (char_length(name) > 0)
);

CREATE TABLE app.map_features (
  id text PRIMARY KEY,
  layer_id text NOT NULL REFERENCES app.map_layers (id) ON DELETE CASCADE,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  geometry jsonb NOT NULL,
  CONSTRAINT map_features_geometry_type CHECK (
    geometry->>'type' IN ('Point', 'Polygon', 'MultiPolygon')
  ),
  CONSTRAINT map_features_point_coords CHECK (
    geometry->>'type' <> 'Point'
    OR (
      jsonb_typeof(geometry->'coordinates') = 'array'
      AND jsonb_array_length(geometry->'coordinates') >= 2
    )
  )
);

CREATE INDEX map_features_layer_id_idx ON app.map_features (layer_id);

INSERT INTO app.users (email, password_hash)
VALUES ('dev@ruehrai.local', crypt('dev-password', gen_salt('bf', 10)))
ON CONFLICT (email) DO NOTHING;

INSERT INTO app.search_places (id, label, grain, ags, plz, address, lon, lat)
VALUES
  ('ags:09162000', 'München', 'ags', '09162000', NULL, NULL, 11.5755, 48.1374),
  ('ags:11000000', 'Berlin', 'ags', '11000000', NULL, NULL, 13.4050, 52.5200),
  ('ags:02000000', 'Hamburg', 'ags', '02000000', NULL, NULL, 9.9937, 53.5511),
  ('plz5:80331', '80331 München', 'plz5', '09162000', '80331', NULL, 11.5760, 48.1370),
  ('plz5:10115', '10115 Berlin', 'plz5', '11000000', '10115', NULL, 13.3870, 52.5320),
  (
    'address:demo-marienplatz-1',
    'Marienplatz 1, München',
    'address',
    '09162000',
    '80331',
    'Marienplatz 1, 80331 München',
    11.5754,
    48.1372
  ),
  (
    'grid100:demo-muenchen',
    'Demo-Zelle München',
    'grid100',
    '09162000',
    NULL,
    NULL,
    11.5755,
    48.1374
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.map_layers (id, name, description)
VALUES
  (
    'demo-gemeinden',
    'Demo-Gemeinden',
    'Synthetische Punkte und ein Kasten für den Dev-Slice. Keine amtlichen Grenzen.'
  ),
  (
    'demo-plz',
    'Demo-PLZ',
    'Synthetische PLZ-Punkte für den Dev-Slice.'
  ),
  (
    'demo-grid100',
    'Demo-Gitter 100 m',
    'Eine synthetische 100-m-Zelle. Keine Zensus-Geometrie.'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.map_features (id, layer_id, properties, geometry)
VALUES
  (
    'ags:09162000',
    'demo-gemeinden',
    '{"label":"München","grain":"ags","ags":"09162000","stub":true}'::jsonb,
    '{"type":"Polygon","coordinates":[[[11.36,48.06],[11.72,48.06],[11.72,48.25],[11.36,48.25],[11.36,48.06]]]}'::jsonb
  ),
  (
    'ags:11000000',
    'demo-gemeinden',
    '{"label":"Berlin","grain":"ags","ags":"11000000","stub":true}'::jsonb,
    '{"type":"Point","coordinates":[13.405,52.52]}'::jsonb
  ),
  (
    'ags:02000000',
    'demo-gemeinden',
    '{"label":"Hamburg","grain":"ags","ags":"02000000","stub":true}'::jsonb,
    '{"type":"Point","coordinates":[9.9937,53.5511]}'::jsonb
  ),
  (
    'plz5:80331',
    'demo-plz',
    '{"label":"80331 München","grain":"plz5","plz":"80331","stub":true}'::jsonb,
    '{"type":"Point","coordinates":[11.576,48.137]}'::jsonb
  ),
  (
    'plz5:10115',
    'demo-plz',
    '{"label":"10115 Berlin","grain":"plz5","plz":"10115","stub":true}'::jsonb,
    '{"type":"Point","coordinates":[13.387,52.532]}'::jsonb
  ),
  (
    'grid100:demo-muenchen',
    'demo-grid100',
    '{"label":"Demo-Zelle München","grain":"grid100","stub":true}'::jsonb,
    '{"type":"Point","coordinates":[11.5755,48.1374]}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;
