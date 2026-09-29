-- Customer inputs for the Dev-Team API slice. All of these tables stay in
-- schema app (backend read/write). Do not add them to schema features.
--
-- KAN-17: revoked access tokens (jti denylist until the JWT exp).
-- KAN-19: one target region per user.
-- KAN-21: store addresses owned by a user.
-- KAN-23: monthly revenue per store. NULL revenue_eur means the month was
-- marked missing. A month with no row was not entered. At most 36 rows per
-- store is enforced by the API, not by a trigger.

CREATE TABLE app.revoked_tokens (
  jti uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX revoked_tokens_user_id_idx ON app.revoked_tokens (user_id);
CREATE INDEX revoked_tokens_expires_at_idx ON app.revoked_tokens (expires_at);

CREATE TABLE app.target_regions (
  user_id bigint PRIMARY KEY REFERENCES app.users (id) ON DELETE CASCADE,
  label text NOT NULL,
  grain text,
  geo_key text,
  ags text,
  plz text,
  lon double precision,
  lat double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT target_regions_label_present CHECK (char_length(label) BETWEEN 1 AND 200),
  CONSTRAINT target_regions_grain CHECK (
    grain IS NULL OR grain IN ('address', 'grid100', 'plz8', 'plz5', 'ags', 'ags5', 'other')
  ),
  CONSTRAINT target_regions_geo_key_length CHECK (
    geo_key IS NULL OR char_length(geo_key) BETWEEN 1 AND 200
  ),
  CONSTRAINT target_regions_ags_shape CHECK (ags IS NULL OR ags ~ '^[0-9]{2,8}$'),
  CONSTRAINT target_regions_plz_shape CHECK (plz IS NULL OR plz ~ '^[0-9]{5}([0-9]{3})?$'),
  CONSTRAINT target_regions_coords CHECK (
    (lon IS NULL AND lat IS NULL)
    OR (lon BETWEEN -180 AND 180 AND lat BETWEEN -90 AND 90)
  )
);

CREATE TABLE app.store_locations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  label text,
  street text NOT NULL,
  postal_code text NOT NULL,
  city text NOT NULL,
  country_code text NOT NULL DEFAULT 'DE',
  lon double precision,
  lat double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_locations_label_present CHECK (
    label IS NULL OR char_length(label) BETWEEN 1 AND 120
  ),
  CONSTRAINT store_locations_street_present CHECK (char_length(street) BETWEEN 1 AND 200),
  CONSTRAINT store_locations_postal_code_shape CHECK (postal_code ~ '^[0-9]{5}$'),
  CONSTRAINT store_locations_city_present CHECK (char_length(city) BETWEEN 1 AND 120),
  CONSTRAINT store_locations_country_code CHECK (country_code = 'DE'),
  CONSTRAINT store_locations_coords CHECK (
    (lon IS NULL AND lat IS NULL)
    OR (lon BETWEEN -180 AND 180 AND lat BETWEEN -90 AND 90)
  )
);

CREATE INDEX store_locations_user_id_idx ON app.store_locations (user_id);

CREATE TABLE app.store_monthly_revenue (
  store_location_id bigint NOT NULL REFERENCES app.store_locations (id) ON DELETE CASCADE,
  year smallint NOT NULL,
  month smallint NOT NULL,
  revenue_eur numeric(12, 2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_location_id, year, month),
  CONSTRAINT store_monthly_revenue_year CHECK (year BETWEEN 1990 AND 2100),
  CONSTRAINT store_monthly_revenue_month CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT store_monthly_revenue_amount CHECK (
    revenue_eur IS NULL OR revenue_eur >= 0
  )
);
