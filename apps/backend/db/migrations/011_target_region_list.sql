-- Target regions are a list per user, not one overwrite slot.
-- Previous primary key was user_id, so PUT could only replace the single row.
-- Existing rows stay. Geo reference data is not touched.

ALTER TABLE app.target_regions
  DROP CONSTRAINT target_regions_pkey;

ALTER TABLE app.target_regions
  ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN level text,
  ADD COLUMN parent_label text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE app.target_regions
  ADD PRIMARY KEY (id);

ALTER TABLE app.target_regions
  ADD CONSTRAINT target_regions_level CHECK (
    level IS NULL
    OR level IN ('plz', 'bezirk', 'stadtbezirk', 'stadtteil', 'ortsteil')
  );

CREATE UNIQUE INDEX target_regions_user_geo_key_uidx
  ON app.target_regions (user_id, geo_key)
  WHERE geo_key IS NOT NULL;

CREATE INDEX target_regions_user_created_idx
  ON app.target_regions (user_id, created_at DESC, id DESC);
