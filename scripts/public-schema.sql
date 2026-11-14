CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS public_block_groups (
  geoid text PRIMARY KEY, county_fips text NOT NULL,
  population double precision, households double precision,
  median_household_income double precision, geom geometry(MultiPolygon,4326) NOT NULL,
  data jsonb NOT NULL, source jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS public_block_groups_geom_idx ON public_block_groups USING gist(geom);
CREATE INDEX IF NOT EXISTS public_block_groups_geog_idx ON public_block_groups USING gist((geom::geography));
CREATE INDEX IF NOT EXISTS public_block_groups_county_idx ON public_block_groups(county_fips);
CREATE TABLE IF NOT EXISTS public_jobs (
  geoid text PRIMARY KEY, county_fips text NOT NULL, jobs double precision,
  point geometry(Point,4326) NOT NULL, data jsonb NOT NULL, source jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS public_jobs_point_idx ON public_jobs USING gist(point);
CREATE INDEX IF NOT EXISTS public_jobs_geog_idx ON public_jobs USING gist((point::geography));
CREATE INDEX IF NOT EXISTS public_jobs_county_idx ON public_jobs(county_fips);
CREATE TABLE IF NOT EXISTS public_places (
  id text PRIMARY KEY, name text, category text, county_fips text NOT NULL,
  point geometry(Point,4326) NOT NULL, data jsonb NOT NULL, source jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS public_places_point_idx ON public_places USING gist(point);
CREATE INDEX IF NOT EXISTS public_places_geog_idx ON public_places USING gist((point::geography));
CREATE INDEX IF NOT EXISTS public_places_category_idx ON public_places(category);
