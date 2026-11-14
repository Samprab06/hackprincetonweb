# Public data import (HAC-12)

This is a local preparation command, not a live demo dependency:

```sh
pnpm exec tsx scripts/fetch-public-data.ts
```

Prerequisites for the full import: Node 22/24, installed pnpm dependencies, an approved PostGIS
`DATABASE_URL`, and the DuckDB CLI on PATH
(or its absolute path in `DUCKDB_BIN`). DuckDB's signed `spatial` and `httpfs`
extensions must be installable. No Python or DuckDB is deployed with the app.

`--download-only` prepares caches without a database. The default ACS API mode
also requires `CENSUS_API_KEY` in `.env.local`. Use `--acs-summary` for the official
keyless bulk-file alternative. Do not commit keys or key-bearing URLs.

## Keyless Census download (HAC-46)

To download and validate actual Census records for both metros now, without a
Census API key, database, Python or DuckDB:

```sh
pnpm exec tsx scripts/fetch-public-data.ts --acs-summary --census-only --download-only
```

This downloads four official [2024 ACS 5-year Summary Files](https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/)
(B01003, B11001, B19013, B01001; approximately 272 MiB in total), then streams
only full block groups in the 12 counties below. The table-based files contain
all geographies nationwide, so their first download is larger than the selected
county subsets. No API authentication is used. TIGERweb geometry pages are also
cached locally; every selected ACS GEOID must match a county geometry.

The parser joins tables by GEOID, preserves leading zeros, converts Summary File
column names (e.g. `B01003_E001`) to the existing adapter format
(`B01003_001E`), and retains both estimates and margins of error. Missing or
negative sentinel values remain unknown. Missing tables, counties or matching
rows fail validation. Geography names are null because these table files do not
contain labels; no labels are invented. Each normalized row retains all four
input URLs, retrieval timestamps and checksums in `data.summaryFileSources`.

Outputs in ignored `data/public/`:

- `summary/*.dat` and `.source.json`: original tables and verified manifests.
- `acs-summary-2024-<county>.json`: selected rows in adapter-compatible table form,
  with source metadata. These are separate from API caches.
- `tiger-2024-<county>-<offset>.geojson`: original county boundary pages.
- `census-preparation.json`: counts and geometry-match verification.

Reruns reuse checksummed source bytes, reparse them, and regenerate the subsets.
No raw records are included in the PR; another machine runs the same command to
obtain them. See [the download verification report](census-download-verification.json)
for the actual source checksums and county counts from this run.

Once a local or hosted PostGIS database and DuckDB are available, run the full
existing import using the same Census cache:

```sh
pnpm exec tsx scripts/fetch-public-data.ts --acs-summary
```

This also downloads LODES and converts Overture, then replaces all three source
tables transactionally. `--census-only` is deliberately download-only, so a partial
Census run cannot erase existing jobs or places. Runtime code continues to query
Postgres. For local database setup, see [local PostGIS](local-postgis.md).

## Coverage and pinned vintages

- **ACS 2020–2024 5-year detailed tables**, block groups: population
  (`B01003_001E`), households (`B11001_001E`), median household income
  (`B19013_001E`, 2024 dollars), and sex/age estimates (`B01001`). Derived age
  bands require every component; suppression/negative sentinels remain unknown.
- **TIGERweb ACS2024 block groups**, January 1, 2024 geographic vintage,
  layer 10, county-filtered GeoJSON with pagination. Geometry is Polygon or
  MultiPolygon, WGS84. The importer converts to PostGIS MultiPolygon.
- **LODES8 WAC 2024 S000 JT00**: all jobs, not only primary jobs, and not unique
  employed residents. `C000` is total jobs. The state crosswalk joins
  `w_geocode = tabblk2020`; `blklatdd`/`blklondd` are **internal points**, not
  building coordinates or geometric centroids. County selection uses current
  crosswalk `cty`, not a historical block-GEOID prefix.
- **Overture places 2026-10-21.0**, v2 schema: `taxonomy` hierarchy, not removed
  `categories`. Local DuckDB reads remote Parquet, filters service-category
  descendants and metro bounding boxes, and exports NDJSON. The PostGIS import
  then performs exact county membership against block-group polygons. Permanently
  closed places are excluded; missing confidence/status stays unknown. Broad
  restaurant mapping is an explicit competitor category, not proof of quick-food
  business suitability.

Houston coverage is Austin, Brazoria, Chambers, Fort Bend, Galveston, Harris,
Liberty, Montgomery, **San Jacinto**, and Waller counties. Los Angeles metro
coverage is Los Angeles and Orange counties. County FIPS preserve leading zeros.
Metro definitions: [Houston BLS](https://www.bls.gov/regions/southwest/news-release/occupationalemploymentandwages_houston.htm),
[Los Angeles BLS](https://www.bls.gov/regions/west/news-release/occupationalemploymentandwages_losangeles.htm).

## Cache, attribution and persistence

Raw downloads, conversion outputs, source manifests and license notices live in
git-ignored `data/public/`. Each manifest records the original safe source URL,
retrieval timestamp and SHA-256. Reruns reuse matching verified bytes; corrupt or
incomplete caches are downloaded again. Changing a pinned vintage changes cache
filenames. No authentication-bearing URL is saved in a manifest or source row.

Census/LEHD US government data is generally public domain; attribute the U.S.
Census Bureau with product, table/file, vintage and source URL, distinguish our
derived analysis, and do not imply endorsement. See the
[Census citation policy](https://www.census.gov/about/policies/citation.html).

Overture attribution: **Overture Maps Foundation, overturemaps.org; contributing
providers and their original `sources` are retained**. Places is not uniformly
ODbL or CDLA: Foursquare is Apache-2.0 (retain its NOTICE), AllThePlaces is CC0,
and other listed providers use CDLA-Permissive-2.0 according to Overture's
[attribution registry](https://docs.overturemaps.org/attribution/#places).
The command caches registry, license texts and Foursquare NOTICE beside the
converted files. Our transformations are geographic/category filtering and
GeoJSON/relational conversion. Retain these notices when distributing derived
data; a null per-record license is not permission to erase provider attribution.

Three isolated Drizzle tables (`lib/db/public-schema.ts`) retain values, geometry,
source URL, vintage and retrieval dates. Census rows also retain geometry-source
metadata; job rows retain crosswalk attribution. Source DDL is
`scripts/public-schema.sql`, separate from the application migration journal.
One advisory-locked transaction replaces all three source tables; any failed
load rolls back that replacement. Downloads/conversion occur before the database
transaction. Runtime catchment code must query Postgres, never these files or
external sources.

## Verification boundary

Real keyless ACS downloads and TIGER geometry joins were verified for 12,816
block groups across all 12 counties on November 14, 2026. A second run with
network requests disabled verifies cache reuse. Tests cover table alignment,
county selection, missing coverage, duplicate IDs, column conversion, margins of
error, suppressed values, provenance and the Census-only database guard.

PostGIS import/reload/rollback, LODES and Overture downloads, and the Vercel
preview were not verified by this Census-only run. Hosted acceptance remains
HAC-44. Local PostGIS is supported, but this machine has no running Docker daemon.
