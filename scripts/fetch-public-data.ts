import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  ACS_VARIABLES,
  PLACE_CATEGORY_LABELS,
  blockCoordinate,
  normalizeAcs,
  normalizeLodes,
  normalizePlace,
  type PublicSource,
  type RawRow,
} from "../lib/data/public";
import { prepareAcsSummary } from "./acs-summary";
import { publicBlockGroups, publicJobs } from "../lib/db/public-schema";
import {
  downloadCached,
  readCachedManifest,
  saveManifest,
  type DownloadManifest,
} from "./public-cache";

export const VINTAGE = {
  acs: "2024",
  lodes: "2024",
  overture: "2026-10-21.0",
} as const;
export const METROS = [
  {
    id: "houston",
    state: "48",
    abbr: "tx",
    counties: [
      "48015",
      "48039",
      "48071",
      "48157",
      "48167",
      "48201",
      "48291",
      "48339",
      "48407",
      "48473",
    ],
  },
  { id: "los-angeles", state: "06", abbr: "ca", counties: ["06037", "06059"] },
] as const;
const TIGER =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/10/query";
const LODES = "https://lehd.ces.census.gov/data/lodes/LODES8";
const PLACES = `s3://overturemaps-us-west-2/release/${VINTAGE.overture}/theme=places/type=place/*.parquet`;
const exec = promisify(execFile);
type Json = Record<string, unknown>;
type Feature = { properties: { GEOID: string }; geometry: Json };
type GeometryObservation = { geometry: Json; source: PublicSource };
type Bounds = [number, number, number, number];

function observation(
  dataset: string,
  vintage: string,
  manifest: DownloadManifest,
): PublicSource {
  return {
    origin: "public",
    dataset,
    vintage,
    url: manifest.url,
    retrievedAt: manifest.retrievedAt,
  };
}

export function censusUrl(countyFips: string): URL {
  if (!/^\d{5}$/.test(countyFips)) throw new Error("Invalid county FIPS");
  const url = new URL(`https://api.census.gov/data/${VINTAGE.acs}/acs/acs5`);
  url.searchParams.set("get", ["NAME", ...ACS_VARIABLES].join(","));
  url.searchParams.set("for", "block group:*");
  url.searchParams.set(
    "in",
    `state:${countyFips.slice(0, 2)} county:${countyFips.slice(2)} tract:*`,
  );
  return url;
}

export async function* csvRows(path: string): AsyncGenerator<RawRow> {
  const input = createReadStream(path);
  const unzip = createGunzip();
  const parser = parse({ columns: true, bom: true });
  input.on("error", (error) => unzip.destroy(error));
  unzip.on("error", (error) => parser.destroy(error));
  input.pipe(unzip).pipe(parser);
  try {
    for await (const row of parser) yield row as RawRow;
  } finally {
    input.destroy();
    unzip.destroy();
    parser.destroy();
  }
}

function extendBounds(bounds: Bounds, coordinates: unknown): void {
  if (!Array.isArray(coordinates)) return;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    bounds[0] = Math.min(bounds[0], coordinates[0]);
    bounds[1] = Math.min(bounds[1], coordinates[1]);
    bounds[2] = Math.max(bounds[2], coordinates[0]);
    bounds[3] = Math.max(bounds[3], coordinates[1]);
  } else for (const child of coordinates) extendBounds(bounds, child);
}

async function geometryForCounty(county: string, cache: string) {
  const geometries = new Map<string, GeometryObservation>();
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(TIGER);
    for (const [key, value] of Object.entries({
      where: `STATE='${county.slice(0, 2)}' AND COUNTY='${county.slice(2)}'`,
      outFields: "GEOID,STATE,COUNTY,TRACT,BLKGRP",
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
      orderByFields: "GEOID",
      resultOffset: String(offset),
      resultRecordCount: "1000",
    }))
      url.searchParams.set(key, value);
    const path = resolve(
      cache,
      `tiger-${VINTAGE.acs}-${county}-${offset}.geojson`,
    );
    const manifest = await downloadCached(path, url.href, url.href);
    const body = JSON.parse(await readFile(path, "utf8")) as {
      features?: Feature[];
      error?: unknown;
    };
    if (!Array.isArray(body.features) || body.error)
      throw new Error("TIGER geometry response is invalid");
    for (const feature of body.features) {
      const id = feature.properties?.GEOID;
      if (
        !/^\d{12}$/.test(id) ||
        !id.startsWith(county) ||
        !["Polygon", "MultiPolygon"].includes(String(feature.geometry?.type))
      )
        throw new Error("Invalid block-group geometry");
      if (geometries.has(id))
        throw new Error("TIGER pagination repeated a block group");
      geometries.set(id, {
        geometry: feature.geometry,
        source: observation(
          "TIGERweb ACS2024 block groups",
          VINTAGE.acs,
          manifest,
        ),
      });
      extendBounds(bounds, feature.geometry.coordinates);
    }
    if (body.features.length < 1000) break;
  }
  if (!geometries.size || bounds.some((v) => !Number.isFinite(v)))
    throw new Error("No county geometry downloaded");
  return { geometries, bounds };
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function placeCategoryFilter(): string {
  const labels = PLACE_CATEGORY_LABELS.map(literal).join(",");
  return `(coalesce(list_has_any(taxonomy.hierarchy,[${labels}]),false)
    OR coalesce(list_has_any(taxonomy.alternates,[${labels}]),false)
    OR taxonomy.primary IN (${labels}) OR basic_category IN (${labels}))`;
}

export function requireSourceCoverage(
  before: number,
  after: number,
  source: string,
): void {
  if (after <= before)
    throw new Error(`Required public source loaded no observations: ${source}`);
}

async function overtureForMetro(metro: string, bounds: Bounds, cache: string) {
  const path = resolve(cache, `overture-${VINTAGE.overture}-${metro}.ndjson`);
  const sourceUrl = `${PLACES}#bbox=${bounds.join(",")}&serviceCategories=${PLACE_CATEGORY_LABELS.join(",")}`;
  const cached = await readCachedManifest(path, sourceUrl);
  if (cached)
    return {
      path,
      source: observation("Overture Maps places", VINTAGE.overture, cached),
    };
  await mkdir(cache, { recursive: true });
  const partial = `${path}.${process.pid}.part`;
  const query = `INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';
    COPY (SELECT id,names,taxonomy,basic_category,confidence,operating_status,sources,
      ST_AsGeoJSON(geometry)::JSON AS geometry
      FROM read_parquet(${literal(PLACES)},hive_partitioning=true)
      WHERE bbox.xmin BETWEEN ${bounds[0]} AND ${bounds[2]} AND bbox.ymin BETWEEN ${bounds[1]} AND ${bounds[3]}
      AND operating_status IS DISTINCT FROM 'permanently_closed'
      AND ${placeCategoryFilter()})
    TO ${literal(partial)} (FORMAT JSON, ARRAY false);`;
  try {
    await exec(
      process.env.DUCKDB_BIN?.trim() || "duckdb",
      ["-batch", "-c", query],
      {
        timeout: 1_800_000,
        maxBuffer: 1_048_576,
      },
    );
    await rename(partial, path);
    const manifest = await saveManifest(path, sourceUrl);
    return {
      path,
      source: observation("Overture Maps places", VINTAGE.overture, manifest),
    };
  } catch {
    throw new Error(
      "Overture conversion failed. Install DuckDB CLI with spatial/httpfs support or set DUCKDB_BIN; rerun reuses completed downloads.",
    );
  } finally {
    await rm(partial, { force: true });
  }
}

/** Local preparation only. Deployed route handlers must query Postgres instead. */
export async function fetchPublicData(options: {
  cache?: string;
  censusKey?: string;
  acsSource?: "api" | "summary";
  censusOnly?: boolean;
  databaseUrl?: string;
}) {
  if (options.censusOnly && options.databaseUrl)
    throw new Error(
      "Census-only preparation cannot replace database source tables",
    );
  const acsSource = options.acsSource ?? "api";
  if (acsSource === "api" && !options.censusKey)
    throw new Error(
      "CENSUS_API_KEY is required for API mode; use --acs-summary for keyless downloads",
    );
  const cache = resolve(options.cache ?? "data/public");
  const summaryRows =
    acsSource === "summary"
      ? await prepareAcsSummary(
          cache,
          VINTAGE.acs,
          METROS.flatMap((m) => [...m.counties]),
        )
      : undefined;
  const countyCounts: Record<
    string,
    { blockGroups: number; geometryBlockGroups: number }
  > = {};
  const acsRows: {
    row: ReturnType<typeof normalizeAcs>[number];
    geometry: GeometryObservation;
  }[] = [];
  const states: {
    abbr: string;
    counties: readonly string[];
    xwalk: string;
    xwalkSource: PublicSource;
    wac: string;
    wacSource: PublicSource;
  }[] = [];
  const placeFiles: { path: string; source: PublicSource }[] = [];
  for (const metro of METROS) {
    const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const county of metro.counties) {
      let rows = summaryRows?.get(county);
      if (!rows) {
        const url = censusUrl(county);
        const sourceUrl = url.href;
        url.searchParams.set("key", options.censusKey!);
        const path = resolve(cache, `acs-${VINTAGE.acs}-${county}.json`);
        const manifest = await downloadCached(path, url.href, sourceUrl);
        rows = normalizeAcs(
          JSON.parse(await readFile(path, "utf8")),
          observation("ACS 5-year detailed tables", VINTAGE.acs, manifest),
        );
      }
      if (!rows.length) throw new Error("ACS returned no block groups");
      const geometry = await geometryForCounty(county, cache);
      countyCounts[county] = {
        blockGroups: rows.length,
        geometryBlockGroups: geometry.geometries.size,
      };
      bounds[0] = Math.min(bounds[0], geometry.bounds[0]);
      bounds[1] = Math.min(bounds[1], geometry.bounds[1]);
      bounds[2] = Math.max(bounds[2], geometry.bounds[2]);
      bounds[3] = Math.max(bounds[3], geometry.bounds[3]);
      for (const row of rows) {
        const shape = geometry.geometries.get(row.geoid);
        if (!shape || row.countyFips !== county)
          throw new Error("ACS/TIGER county or GEOID mismatch");
        acsRows.push({ row, geometry: shape });
      }
    }
    if (options.censusOnly) continue;
    const xwalkUrl = `${LODES}/${metro.abbr}/${metro.abbr}_xwalk.csv.gz`;
    const wacUrl = `${LODES}/${metro.abbr}/wac/${metro.abbr}_wac_S000_JT00_${VINTAGE.lodes}.csv.gz`;
    const xwalk = resolve(cache, `${metro.abbr}_xwalk.csv.gz`);
    const wac = resolve(
      cache,
      `${metro.abbr}_wac_S000_JT00_${VINTAGE.lodes}.csv.gz`,
    );
    const xwalkManifest = await downloadCached(xwalk, xwalkUrl, xwalkUrl);
    const wacManifest = await downloadCached(wac, wacUrl, wacUrl);
    states.push({
      abbr: metro.abbr,
      counties: metro.counties,
      xwalk,
      wac,
      xwalkSource: observation(
        "LODES8 crosswalk",
        "2020 blocks / current county attribution",
        xwalkManifest,
      ),
      wacSource: observation(
        "LODES8 WAC S000 JT00 all jobs",
        VINTAGE.lodes,
        wacManifest,
      ),
    });
    placeFiles.push(await overtureForMetro(metro.id, bounds, cache));
  }
  if (options.censusOnly) {
    const report = {
      mode: "census-download-only",
      acsSource,
      vintage: VINTAGE.acs,
      blockGroups: acsRows.length,
      counties: countyCounts,
      geometryMatched: acsRows.length,
      databaseVerified: false,
    };
    await writeFile(
      resolve(cache, "census-preparation.json"),
      JSON.stringify(report, null, 2),
    );
    return report;
  }
  // Keep notices and license texts beside converted provider data. Filtering and
  // GeoJSON conversion are our modifications, not upstream endorsements.
  for (const [name, url] of Object.entries({
    "overture-attribution.html": "https://docs.overturemaps.org/attribution/",
    "cdla-permissive-2.0.html": "https://cdla.dev/permissive-2-0/",
    "apache-2.0.txt": "https://www.apache.org/licenses/LICENSE-2.0.txt",
    "cc0-1.0.txt":
      "https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt",
    "foursquare-NOTICE.txt":
      "https://opensource.foursquare.com/places-notice-txt/",
  }))
    await downloadCached(resolve(cache, "licenses", name), url, url);

  if (!options.databaseUrl)
    return {
      mode: "download-only",
      blockGroups: acsRows.length,
      states: states.length,
      placeFiles: placeFiles.length,
    };
  const client = postgres(options.databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  const db = drizzle(client);
  const counts = {
    blockGroups: 0,
    jobBlocks: 0,
    places: 0,
    placesOutsideCounties: 0,
  };
  try {
    await client.unsafe(
      await readFile(new URL("./public-schema.sql", import.meta.url), "utf8"),
    );
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(481201)`);
      await tx.execute(
        sql`TRUNCATE public_places, public_jobs, public_block_groups`,
      );
      for (let offset = 0; offset < acsRows.length; offset += 100) {
        const batch = acsRows
          .slice(offset, offset + 100)
          .map(({ row, geometry }) => ({
            ...row,
            geom: sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry.geometry)}),4326))`,
            data: { ...row.data, geometrySource: geometry.source },
          }));
        await tx.insert(publicBlockGroups).values(batch);
        counts.blockGroups += batch.length;
      }
      for (const state of states) {
        const previousJobs = counts.jobBlocks;
        const counties = new Set<string>(state.counties);
        const coordinates = new Map<
          string,
          { countyFips: string; latitude: number; longitude: number }
        >();
        for await (const row of csvRows(state.xwalk)) {
          if (!counties.has(row.cty)) continue;
          const coordinate = blockCoordinate(row);
          if (!coordinate)
            throw new Error(
              "Selected LODES crosswalk row lacks valid coordinates",
            );
          coordinates.set(coordinate.geoid, {
            countyFips: row.cty,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
          });
        }
        if (!coordinates.size)
          throw new Error("LODES crosswalk selected no county blocks");
        const batch: (typeof publicJobs.$inferInsert)[] = [];
        for await (const row of csvRows(state.wac)) {
          const point = coordinates.get(row.w_geocode);
          if (!point) continue; // Membership comes from current crosswalk.cty, never GEOID prefix.
          const jobs = normalizeLodes(row, state.wacSource, point.countyFips);
          batch.push({
            ...jobs,
            countyFips: point.countyFips,
            point: [point.longitude, point.latitude],
            data: {
              ...jobs.data,
              coordinateSource: state.xwalkSource,
              countyAttribution: "LODES crosswalk cty",
            },
          });
          counts.jobBlocks++;
          if (batch.length >= 500) {
            await tx.insert(publicJobs).values(batch);
            batch.length = 0;
          }
        }
        if (batch.length) await tx.insert(publicJobs).values(batch);
        requireSourceCoverage(
          previousJobs,
          counts.jobBlocks,
          `LODES ${state.abbr}`,
        );
      }
      for (const file of placeFiles) {
        const previousPlaces = counts.places;
        const input = createReadStream(file.path, { encoding: "utf8" });
        const lines = createInterface({ input, crlfDelay: Infinity });
        const batch: NonNullable<ReturnType<typeof normalizePlace>>[] = [];
        const flushPlaces = async () => {
          if (!batch.length) return;
          // One round trip per batch; exact spatial membership stays in PostGIS.
          const result = await tx.execute(sql`
            WITH observations AS (
              SELECT * FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
              AS p(id text,name text,category text,longitude double precision,latitude double precision,data jsonb,source jsonb)
            )
            INSERT INTO public_places(id,name,category,county_fips,point,data,source)
            SELECT p.id,p.name,p.category,bg.county_fips,
              ST_SetSRID(ST_MakePoint(p.longitude,p.latitude),4326),p.data,p.source
            FROM observations p CROSS JOIN LATERAL (
              SELECT county_fips FROM public_block_groups
              WHERE ST_Covers(geom,ST_SetSRID(ST_MakePoint(p.longitude,p.latitude),4326))
              ORDER BY geoid LIMIT 1
            ) bg RETURNING id`);
          counts.places += result.length;
          counts.placesOutsideCounties += batch.length - result.length;
          batch.length = 0;
        };
        try {
          for await (const line of lines) {
            if (!line.trim()) continue;
            const place = normalizePlace(JSON.parse(line) as Json, file.source);
            if (!place) continue;
            batch.push(place);
            if (batch.length >= 500) await flushPlaces();
          }
          await flushPlaces();
          requireSourceCoverage(previousPlaces, counts.places, file.path);
        } finally {
          lines.close();
          input.destroy();
        }
      }
    });
    return { mode: "loaded", counts };
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  config({ path: [".env.local", ".env"], quiet: true });
  const downloadOnly = process.argv.includes("--download-only");
  const acsSource = process.argv.includes("--acs-summary") ? "summary" : "api";
  const censusOnly = process.argv.includes("--census-only");
  if (
    (acsSource === "api" && !process.env.CENSUS_API_KEY) ||
    (censusOnly && !downloadOnly) ||
    (!downloadOnly && !process.env.DATABASE_URL)
  ) {
    console.error(
      "API mode requires CENSUS_API_KEY; --acs-summary uses keyless files. An approved DATABASE_URL is required unless --download-only is set. --census-only requires --download-only.",
    );
    process.exitCode = 1;
  } else
    fetchPublicData({
      censusKey: process.env.CENSUS_API_KEY,
      acsSource,
      censusOnly,
      databaseUrl: downloadOnly ? undefined : process.env.DATABASE_URL,
    })
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch(() => {
        console.error(
          "Public data preparation failed; existing database observations were not replaced. Check source credentials, DuckDB CLI and download cache.",
        );
        process.exitCode = 1;
      });
}
