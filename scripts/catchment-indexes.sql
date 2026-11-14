-- Run once on an approved database after both source table sets exist.
-- No runtime request creates indexes or changes the database schema.
CREATE INDEX IF NOT EXISTS costar_properties_geog_idx ON costar_properties USING gist((point::geography));
CREATE INDEX IF NOT EXISTS public_block_groups_geog_idx ON public_block_groups USING gist((geom::geography));
CREATE INDEX IF NOT EXISTS public_jobs_geog_idx ON public_jobs USING gist((point::geography));
CREATE INDEX IF NOT EXISTS public_places_geog_idx ON public_places USING gist((point::geography));
