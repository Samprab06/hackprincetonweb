import { sql, type SQL } from "drizzle-orm";
import { CatchmentQuerySchema } from "../contracts/catchment";
import { buildCatchment, type CatchmentObservations } from "./catchments";

export type CatchmentQuery = {
  projectId: string;
  category: "coffee" | "quick_food" | "salon_barber" | "fitness";
  radiusMeters: number;
  roadType?: "local" | "collector" | "arterial" | "unknown";
};
export type CatchmentExecutor = { execute(query: SQL): PromiseLike<unknown> };
type Row = Record<string, unknown>;

export class CatchmentNotFoundError extends Error {}
export class CatchmentDataUnavailableError extends Error {}

function rows(value: unknown): Row[] {
  if (!Array.isArray(value))
    throw new CatchmentDataUnavailableError("Invalid source response");
  return value as Row[];
}
function object(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}
function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new CatchmentDataUnavailableError("Invalid source number");
  return parsed;
}
function requiredNumber(value: unknown): number {
  const parsed = nullableNumber(value);
  if (parsed === null)
    throw new CatchmentDataUnavailableError("Missing source coordinates");
  return parsed;
}

/** Read projections only: no broker/contact payloads or runtime source requests. */
export async function readCatchment(
  db: CatchmentExecutor,
  siteId: string,
  query: CatchmentQuery,
  radiusOrigin: "founder" | "default",
  retrievedAt = new Date().toISOString(),
) {
  query = CatchmentQuerySchema.parse(query);
  if (!/^\d+(?::\d+)?$/.test(siteId) || siteId.length > 100)
    throw new CatchmentNotFoundError("Unknown site identifier");
  const project = rows(
    await db.execute(
      sql`SELECT id FROM projects WHERE id=${query.projectId} LIMIT 1`,
    ),
  );
  if (!project.length) throw new CatchmentNotFoundError("Project not found");
  const siteRows = rows(
    await db.execute(sql`
    SELECT p.id,p.city,p.latitude,p.longitude,p.source,
      coalesce(p.data->'propertyRetail'->'frontage',p.data->'frontage','[]'::jsonb) AS frontage
    FROM costar_properties p
    WHERE p.id=${siteId} OR p.id=(SELECT property_id FROM costar_spaces WHERE id=${siteId} LIMIT 1)
    ORDER BY p.id LIMIT 1`),
  );
  const site = siteRows[0];
  if (!site) throw new CatchmentNotFoundError("Site not found");
  const latitude = requiredNumber(site.latitude);
  const longitude = requiredNumber(site.longitude);
  const city =
    String(site.city).toLowerCase() === "houston"
      ? "Houston"
      : String(site.city).toLowerCase() === "los angeles"
        ? "Los Angeles"
        : null;
  if (!city || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new CatchmentDataUnavailableError("Site geography is unavailable");
  const point = sql`ST_SetSRID(ST_MakePoint(${longitude},${latitude}),4326)`;
  const radius = query.radiusMeters;
  const coverage = rows(
    await db.execute(sql`
    SELECT EXISTS(SELECT 1 FROM public_block_groups WHERE ST_Covers(geom,${point})) AS residents,
      EXISTS(SELECT 1 FROM public_jobs LIMIT 1) AS workers,
      EXISTS(SELECT 1 FROM public_places LIMIT 1) AS places`),
  )[0];
  if (
    !coverage ||
    coverage.residents !== true ||
    coverage.workers !== true ||
    coverage.places !== true
  ) {
    throw new CatchmentDataUnavailableError(
      "Prepared public data is unavailable for this site",
    );
  }
  const residents = rows(
    await db.execute(sql`
    WITH travel_area AS (SELECT ST_Buffer(${point}::geography,${radius})::geometry AS geom),
    selected AS (
      SELECT bg.geoid,bg.population,bg.households,bg.median_household_income,
        bg.data->'ageBands' AS age_bands,bg.source,bg.data->'geometrySource' AS geometry_source,
        least(1.0,greatest(0.0,ST_Area(ST_Intersection(bg.geom,a.geom)::geography)
          /nullif(ST_Area(bg.geom::geography),0))) AS area_fraction
      FROM public_block_groups bg CROSS JOIN travel_area a
      WHERE ST_DWithin(bg.geom::geography,${point}::geography,${radius})
    ) SELECT * FROM selected WHERE area_fraction>0 ORDER BY geoid`),
  );
  const workers = rows(
    await db.execute(sql`
    SELECT geoid,jobs,ST_X(point) AS longitude,ST_Y(point) AS latitude,source
    FROM public_jobs WHERE ST_DWithin(point::geography,${point}::geography,${radius}) ORDER BY geoid`),
  );
  // CoStar's broad industry is a candidate competitor proxy, not verified coffee,
  // salon or gym classification. The evidence preserves that limitation.
  const industry =
    query.category === "salon_barber"
      ? "PersonalServices"
      : query.category === "fitness"
        ? "ArtsEntertainmentAndRecreation"
        : "AccommodationAndFoodServices";
  const tenants = rows(
    await db.execute(sql`
    SELECT t.id,t.data->>'tenantName' AS name,p.longitude,p.latitude,t.source,
      t.data->>'industry' AS industry
    FROM costar_properties p JOIN costar_tenancies t ON t.property_id=p.id
    WHERE ST_DWithin(p.point::geography,${point}::geography,${radius})
      AND t.data->>'industry'=${industry} ORDER BY t.id`),
  );
  const placeCategory =
    query.category === "salon_barber" ? "salon" : query.category;
  const places = rows(
    await db.execute(sql`
    SELECT id,name,category,ST_X(point) AS longitude,ST_Y(point) AS latitude,source,
      data->'sources' AS provider_sources
    FROM public_places WHERE category=${placeCategory}
      AND ST_DWithin(point::geography,${point}::geography,${radius}) ORDER BY id`),
  );
  const coTenants = rows(
    await db.execute(sql`
    SELECT t.id,t.data->>'tenantName' AS name,t.data->>'industry' AS industry,t.source,
      (SELECT CASE WHEN count(*)=0 OR count(occupied)<>count(*) OR min(occupied)<0
        THEN NULL ELSE sum(occupied) END FROM (
          SELECT CASE WHEN jsonb_typeof(s->'squareFeetOccupied')='number'
            THEN (s->>'squareFeetOccupied')::double precision ELSE NULL END AS occupied
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.data->'spaces')='array'
            THEN t.data->'spaces' ELSE '[]'::jsonb END) s
        ) measurements) AS occupied_sq_ft
    FROM costar_tenancies t WHERE t.property_id=${String(site.id)} ORDER BY t.id`),
  );
  const input: CatchmentObservations = {
    site: {
      id: siteId,
      propertyId: String(site.id),
      projectId: query.projectId,
      city,
      latitude,
      longitude,
      frontage: Array.isArray(site.frontage) ? site.frontage.map(object) : [],
      source: object(site.source),
    },
    radiusMeters: radius,
    radiusOrigin,
    category: query.category,
    roadType: query.roadType,
    retrievedAt,
    residents: residents.map((r) => ({
      geoid: String(r.geoid),
      population: nullableNumber(r.population),
      households: nullableNumber(r.households),
      medianHouseholdIncome: nullableNumber(r.median_household_income),
      ageBands: Object.fromEntries(
        Object.entries(object(r.age_bands)).map(([key, value]) => [
          key,
          nullableNumber(value),
        ]),
      ),
      areaFraction: requiredNumber(r.area_fraction),
      source: object(r.source),
      geometrySource: object(r.geometry_source),
    })),
    workers: workers.map((r) => ({
      geoid: String(r.geoid),
      jobs: nullableNumber(r.jobs),
      longitude: requiredNumber(r.longitude),
      latitude: requiredNumber(r.latitude),
      source: object(r.source),
    })),
    venues: [
      ...tenants.map((r) => ({
        id: `costar_tenant_${String(r.id)}`,
        name: typeof r.name === "string" ? r.name : null,
        category: query.category,
        longitude: requiredNumber(r.longitude),
        latitude: requiredNumber(r.latitude),
        origin: "costar" as const,
        source: {
          ...object(r.source),
          extra: {
            industry: r.industry,
            classification: "broad_industry_proxy",
          },
        },
      })),
      ...places.map((r) => ({
        id: `overture_${String(r.id)}`,
        name: typeof r.name === "string" ? r.name : null,
        category: query.category,
        longitude: requiredNumber(r.longitude),
        latitude: requiredNumber(r.latitude),
        origin: "public" as const,
        source: {
          ...object(r.source),
          extra: { providerSources: r.provider_sources },
        },
      })),
    ],
    coTenants: coTenants.map((r) => ({
      id: String(r.id),
      name: typeof r.name === "string" ? r.name : null,
      industry: typeof r.industry === "string" ? r.industry : null,
      occupiedSqFt: nullableNumber(r.occupied_sq_ft),
      source: object(r.source),
    })),
  };
  return buildCatchment(input);
}

/** Orchestrator entry point; all parts share one consistent read-only snapshot. */
export async function getCatchment(
  siteId: string,
  query: CatchmentQuery,
  radiusOrigin: "founder" | "default",
) {
  const { getDb } = await import("../db/client");
  return getDb().transaction(
    (tx) => readCatchment(tx, siteId, query, radiusOrigin),
    {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    },
  );
}
