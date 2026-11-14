-- HAC-11. Idempotent, run by load-costar.ts before its atomic data replacement.
-- HAC-9 owns the application migrations; this standalone source import does not
-- touch application/project tables or their migration history.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS costar_properties (
  id text PRIMARY KEY, city text, property_type text, property_subtype text,
  retail boolean NOT NULL, latitude double precision, longitude double precision,
  point geometry(Point,4326), data jsonb NOT NULL, source jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS costar_properties_point_idx ON costar_properties USING gist(point);
CREATE INDEX IF NOT EXISTS costar_properties_geog_idx ON costar_properties USING gist((point::geography));
CREATE INDEX IF NOT EXISTS costar_properties_city_idx ON costar_properties(city);
CREATE TABLE IF NOT EXISTS costar_spaces (
  id text PRIMARY KEY, listing_id text NOT NULL,
  property_id text NOT NULL,
  active boolean NOT NULL, retail boolean NOT NULL, size_sq_ft double precision,
  data jsonb NOT NULL, source jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS costar_spaces_property_idx ON costar_spaces(property_id);
CREATE TABLE IF NOT EXISTS costar_tenancies (
  id text PRIMARY KEY, property_id text NOT NULL REFERENCES costar_properties(id),
  tenant_location_id text, data jsonb NOT NULL, source jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS costar_tenancies_property_idx ON costar_tenancies(property_id);
CREATE TABLE IF NOT EXISTS costar_attachments (
  id text PRIMARY KEY, property_id text,
  data jsonb NOT NULL, source jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS costar_attachments_property_idx ON costar_attachments(property_id);
