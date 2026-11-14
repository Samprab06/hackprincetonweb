import { createHash } from "node:crypto";
import {
  CatchmentResponseSchema,
  type CatchmentResponse,
} from "../contracts/catchment";
import type { AssumedValue, Evidence } from "../contracts";

type Source = Record<string, unknown>;
export type CatchmentObservations = {
  site: {
    id: string;
    propertyId: string;
    projectId: string;
    city: "Houston" | "Los Angeles";
    latitude: number;
    longitude: number;
    frontage: Source[];
    source: Source;
  };
  radiusMeters: number;
  radiusOrigin: "founder" | "default";
  category: "coffee" | "quick_food" | "salon_barber" | "fitness";
  roadType?: "local" | "collector" | "arterial" | "unknown";
  residents: Array<{
    geoid: string;
    population: number | null;
    households: number | null;
    medianHouseholdIncome: number | null;
    ageBands: Record<string, number | null>;
    areaFraction: number;
    source: Source;
    geometrySource?: Source;
  }>;
  workers: Array<{
    geoid: string;
    jobs: number | null;
    longitude: number;
    latitude: number;
    source: Source;
  }>;
  venues: Array<{
    id: string;
    name: string | null;
    category: string;
    latitude: number;
    longitude: number;
    origin: "costar" | "public";
    source: Source;
  }>;
  coTenants: Array<{
    id: string;
    name: string | null;
    industry: string | null;
    occupiedSqFt: number | null;
    source: Source;
  }>;
  retrievedAt: string;
};
export type ResidentObservation = CatchmentObservations["residents"][number];
export type WorkerObservation = CatchmentObservations["workers"][number];
export type VenueObservation = CatchmentObservations["venues"][number];
export type CoTenantObservation = CatchmentObservations["coTenants"][number];

const allocationNote =
  "Uniform-area allocation of ACS block-group estimates; not observed residents inside the circle. No catchment median income is inferred from block-group medians.";
const trafficNote =
  "Road vehicle counts are not people, pedestrians, visits, or unique customers; no conversion is calibrated.";
const roleNote =
  "Uncalibrated default heuristic: anchor at >=20000 occupied ft2; complement by explicit industry keywords, not measured cross-shopping.";
const dedupNote =
  "Competitors require the same canonical category; merge normalized equal names only within 75 meters of the representative. Coverage is incomplete; separate distant chain locations remain distinct.";
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const sum = (values: (number | null)[]) =>
  values.length === 0 || values.some((v) => v === null)
    ? null
    : count(values.reduce<number>((a, b) => a + (b ?? 0), 0));
const normalizeName = (name: string | null) =>
  (name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(
      /(?:\s+(?:llc|l l c|inc|i n c|incorporated|corp|corporation|ltd|limited))+$/u,
      "",
    )
    .trim();
function distance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
function publicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      (!/^https?:$/.test(url.protocol) &&
        !(
          url.protocol === "s3:" && url.hostname === "overturemaps-us-west-2"
        )) ||
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((k) => /key|token|secret/i.test(k))
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}
function observed(source: Source): string | null {
  const value = source.observedAt;
  return typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT/.test(value) &&
    Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function sourceLimitations(source: Source): string[] {
  const extra =
    source.extra &&
    typeof source.extra === "object" &&
    !Array.isArray(source.extra)
      ? (source.extra as Source)
      : {};
  const notes: string[] = [];
  if (extra.classification === "broad_industry_proxy")
    notes.push(
      "Broad industry proxy only; not a verified direct competitor in the requested coffee, food, salon/barber, or fitness category.",
    );
  if (typeof source.dataset === "string")
    notes.push(`Dataset attribution: ${source.dataset}`);
  if (typeof source.vintage === "string")
    notes.push(`Dataset vintage: ${source.vintage}`);
  if (typeof source.recordId === "string")
    notes.push(`Source record: ${source.recordId}`);
  if (typeof source.field === "string")
    notes.push(`Source field: ${source.field}`);
  if (Array.isArray(extra.providerSources)) {
    for (const provider of extra.providerSources) {
      if (!provider || typeof provider !== "object" || Array.isArray(provider))
        continue;
      const fields = Object.entries(provider)
        .filter(
          ([key, value]) =>
            [
              "dataset",
              "provider",
              "license",
              "license_name",
              "license_url",
            ].includes(key) && typeof value === "string",
        )
        .sort(([a], [b]) => compare(a, b));
      if (fields.length)
        notes.push(
          `Overture upstream attribution: ${fields.map(([key, value]) => `${key}=${value}`).join("; ")}`,
        );
    }
  }
  return [...new Set(notes)].sort(compare);
}

/** Pure aggregation: spatial intersections/filtering belong to the repository. */
export function buildCatchment(
  input: CatchmentObservations,
): CatchmentResponse {
  const evidence: Evidence[] = [];
  const prefix = `catchment:${encodeURIComponent(input.site.projectId)}:${encodeURIComponent(input.site.id)}:${input.radiusMeters}:${input.category}:${input.roadType ?? "unknown"}:${input.roadType === undefined ? "road-default" : "road-founder"}:${input.radiusOrigin}`;
  function ev(
    key: string,
    origin: Evidence["origin"],
    label: string,
    description: string,
    source: Source = {},
    limitations: string[] = [],
  ) {
    const id = `${prefix}:ev:${key}`;
    const retrievedAt =
      typeof source.retrievedAt === "string" &&
      Number.isFinite(Date.parse(source.retrievedAt))
        ? new Date(source.retrievedAt).toISOString()
        : input.retrievedAt;
    evidence.push({
      id,
      projectId: input.site.projectId,
      synthetic: false,
      origin,
      sourceLabel: label,
      sourceUrl: origin === "public" ? publicUrl(source.url) : null,
      description,
      observedAt: observed(source),
      retrievedAt,
      limitations: [...limitations, ...sourceLimitations(source)],
    });
    return id;
  }
  function metric(
    value: number | null,
    unit: string,
    origin: AssumedValue["origin"],
    evidenceIds: string[],
  ): AssumedValue {
    const n = count(value);
    return {
      value: n,
      unit,
      origin,
      evidenceIds: [...new Set(evidenceIds)].sort(compare),
      ...(n === null
        ? {
            unknownReason:
              "Required observations are absent, suppressed, or invalid; no partial total is presented as complete.",
          }
        : {}),
    };
  }
  const allocation = ev(
    "allocation",
    "default",
    "Area allocation assumption",
    allocationNote,
    {},
    [allocationNote],
  );
  const coverage = ev(
    "coverage",
    "default",
    "Coverage limitation",
    "Empty source selections do not establish a true zero; inventories may be incomplete.",
  );
  const radius = ev(
    "radius",
    input.radiusOrigin,
    "Catchment radius",
    "Circular geographic radius in meters; not a travel-time boundary.",
  );
  const blockGroups = [...input.residents]
    .sort((a, b) => compare(a.geoid, b.geoid))
    .map((row) => {
      const source = ev(
        `acs:${row.geoid}`,
        "public",
        "Census ACS block group",
        `ACS estimates for block group ${row.geoid}; income is the original block-group median.`,
        row.source,
      );
      const geo = row.geometrySource
        ? ev(
            `geometry:${row.geoid}`,
            "public",
            "Census block-group geometry",
            `Geometry used for block-group ${row.geoid} intersection.`,
            row.geometrySource,
          )
        : coverage;
      const fraction =
        Number.isFinite(row.areaFraction) &&
        row.areaFraction >= 0 &&
        row.areaFraction <= 1
          ? row.areaFraction
          : null;
      const raw = (v: number | null, unit = "people") =>
        metric(v, unit, "public", [source]);
      const allocate = (v: number | null, unit = "people") =>
        metric(
          count(v) === null || fraction === null ? null : v! * fraction,
          unit,
          "default",
          [source, geo, allocation],
        );
      return {
        geoid: row.geoid,
        areaFraction: metric(fraction, "fraction", "default", [
          geo,
          allocation,
        ]),
        population: raw(row.population),
        households: raw(row.households, "households"),
        medianHouseholdIncome: raw(row.medianHouseholdIncome, "USD/year"),
        ageBands: Object.fromEntries(
          Object.entries(row.ageBands)
            .sort(([a], [b]) => compare(a, b))
            .map(([key, v]) => [key, raw(v)]),
        ),
        allocatedPopulation: allocate(row.population),
        allocatedHouseholds: allocate(row.households, "households"),
        allocatedAgeBands: Object.fromEntries(
          Object.entries(row.ageBands)
            .sort(([a], [b]) => compare(a, b))
            .map(([key, v]) => [key, allocate(v)]),
        ),
      };
    });
  const allResidentIds = [
    allocation,
    ...blockGroups.flatMap((b) => b.allocatedPopulation.evidenceIds),
  ];
  const population = metric(
    sum(blockGroups.map((b) => b.allocatedPopulation.value)),
    "people",
    "default",
    allResidentIds,
  );
  const households = metric(
    sum(blockGroups.map((b) => b.allocatedHouseholds.value)),
    "households",
    "default",
    allResidentIds,
  );
  const ageKeys = [
    ...new Set([
      "0-17",
      "18-34",
      "35-54",
      "55-64",
      "65+",
      ...blockGroups.flatMap((b) => Object.keys(b.ageBands)),
    ]),
  ].sort(compare);
  const ageBands = Object.fromEntries(
    ageKeys.map((key) => [
      key,
      metric(
        sum(blockGroups.map((b) => b.allocatedAgeBands[key]?.value ?? null)),
        "people",
        "default",
        allResidentIds,
      ),
    ]),
  );
  const blocks = [...input.workers]
    .sort((a, b) => compare(a.geoid, b.geoid))
    .map((row) => {
      const id = ev(
        `lodes:${row.geoid}`,
        "public",
        "Census LEHD LODES workplace jobs",
        `Workplace block ${row.geoid} point-in-circle jobs; jobs are not unique people.`,
        row.source,
      );
      return {
        geoid: row.geoid,
        jobs: metric(row.jobs, "jobs", "public", [id]),
      };
    });
  const jobs = metric(
    sum(blocks.map((b) => b.jobs.value)),
    "jobs",
    "public",
    blocks.length ? blocks.flatMap((b) => b.jobs.evidenceIds) : [coverage],
  );
  const trafficFields = [
    "trafficCount",
    "trafficCountPerDay",
    "averageDailyTraffic",
  ] as const;
  const traffic = input.site.frontage
    .flatMap((frontage, i) =>
      trafficFields.flatMap((field) => {
        const value = count(frontage[field]);
        return value === null
          ? []
          : [
              {
                value,
                field,
                index: i,
                primary:
                  frontage.isPrimaryFrontage === true ||
                  frontage.primary === true ||
                  frontage.isPrimary === true,
              },
            ];
      }),
    )
    .sort(
      (a, b) =>
        Number(b.primary) - Number(a.primary) ||
        b.value - a.value ||
        a.index - b.index ||
        compare(a.field, b.field),
    );
  const selected = traffic[0];
  const roadType = input.roadType ?? "unknown";
  const roadEvidence = ev(
    "road-type",
    input.roadType === undefined ? "default" : "founder",
    "Road classification",
    input.roadType === undefined
      ? "Road type is unknown; no classification was inferred."
      : `Caller supplied road classification: ${roadType}.`,
  );
  const selection = selected
    ? `Selected ${selected.primary ? "primary frontage then maximum" : "maximum frontage"} count, site.frontage[${selected.index}].${selected.field}; never summed repeated roads.`
    : "No usable frontage traffic field; explicit uncalibrated road-type default.";
  const trafficEvidence = ev(
    "traffic",
    selected ? "costar" : "default",
    selected ? "CoStar frontage traffic" : "Uncalibrated road traffic default",
    selection,
    selected ? input.site.source : {},
    [
      trafficNote,
      ...(!selected
        ? [
            "Defaults: local 3000, collector 10000, arterial 25000, unknown 10000 vehicles/day; not measured traffic.",
          ]
        : []),
    ],
  );
  const vehiclesPerDay = metric(
    selected?.value ??
      { local: 3000, collector: 10000, arterial: 25000, unknown: 10000 }[
        roadType
      ],
    "vehicles/day",
    selected ? "costar" : "default",
    [trafficEvidence, roadEvidence],
  );
  const dedup = ev(
    "competitor-rule",
    "default",
    "Competitor deduplication",
    dedupNote,
    {},
    [dedupNote],
  );
  const groups: Array<{
    representative: VenueObservation;
    members: VenueObservation[];
  }> = [];
  for (const venue of [...input.venues]
    .filter((v) => v.category === input.category)
    .sort((a, b) => compare(`${a.origin}:${a.id}`, `${b.origin}:${b.id}`))) {
    const name = normalizeName(venue.name);
    const group = groups.find(
      (g) =>
        name !== "" &&
        normalizeName(g.representative.name) === name &&
        distance(g.representative, venue) <= 75,
    );
    if (group) group.members.push(venue);
    else groups.push({ representative: venue, members: [venue] });
  }
  const competitors = groups.map(({ representative: v, members }) => {
    const ids = members.map((m) =>
      ev(
        `venue:${m.origin}:${encodeURIComponent(m.id)}`,
        m.origin,
        m.origin === "costar"
          ? "CoStar competitor location"
          : "Overture public place",
        `Location evidence for competitor ${m.id}; name/category from source.`,
        m.source,
      ),
    );
    return {
      id: `comp_${createHash("sha256")
        .update(
          members
            .map((m) => `${m.origin}:${m.id}`)
            .sort(compare)
            .join("\n"),
        )
        .digest("hex")
        .slice(0, 24)}`,
      name: v.name,
      category: input.category,
      distanceMeters: metric(distance(input.site, v), "meters", "default", [
        ...ids,
        dedup,
      ]),
      evidenceIds: [...ids, dedup].sort(compare),
      sourceIds: members.map((m) => `${m.origin}:${m.id}`).sort(compare),
    };
  });
  const roleEvidence = ev(
    "co-tenant-rule",
    "default",
    "Co-tenant role heuristic",
    roleNote,
    {},
    [roleNote],
  );
  const coTenants = [...input.coTenants]
    .sort((a, b) => compare(a.id, b.id))
    .map((row) => {
      const id = ev(
        `cotenant:${encodeURIComponent(row.id)}`,
        "costar",
        "CoStar co-tenant",
        `Co-tenant ${row.id}; missing industry remains unknown.`,
        row.source,
      );
      const area = count(row.occupiedSqFt);
      const ownIndustry =
        input.category === "salon_barber"
          ? "PersonalServices"
          : input.category === "fitness"
            ? "ArtsEntertainmentAndRecreation"
            : "AccommodationAndFoodServices";
      const complementaryIndustries = [
        "RetailersOrWholesalers",
        "AccommodationAndFoodServices",
        "PersonalServices",
        "ArtsEntertainmentAndRecreation",
        "FinancialInstitutions",
        "HealthCareAndSocialAssistance",
      ];
      const complement =
        row.industry !== null &&
        row.industry !== ownIndustry &&
        (complementaryIndustries.includes(row.industry) ||
          /\b(grocery|supermarket|office|retail|restaurant|food|fitness|gym|salon|barber)\b/i.test(
            row.industry,
          ));
      const role: "anchor" | "complement" | "other" =
        area !== null && area >= 20000
          ? "anchor"
          : complement
            ? "complement"
            : "other";
      return {
        id: row.id,
        name: row.name,
        industry: row.industry,
        occupiedSqFt: metric(area, "ft2", "costar", [id]),
        role,
        roleOrigin: "default" as const,
        evidenceIds: [id, roleEvidence].sort(compare),
      };
    });
  return CatchmentResponseSchema.parse({
    catchment: {
      id: prefix,
      projectId: input.site.projectId,
      synthetic: false,
      siteId: input.site.id,
      radiusMeters: metric(input.radiusMeters, "meters", input.radiusOrigin, [
        radius,
      ]),
      residentPopulation: population,
      daytimeWorkers: jobs,
      competitors: competitors.map((c) => ({
        id: c.id,
        name: c.name?.trim() || "Unknown competitor name",
        category: c.category,
        distanceMeters: c.distanceMeters,
      })),
    },
    residents: { population, households, ageBands, blockGroups },
    workers: { jobs, blocks },
    passBy: {
      vehiclesPerDay,
      missingTrafficCount: {
        value: !selected,
        unit: "boolean",
        origin: selected ? "costar" : "default",
        evidenceIds: [trafficEvidence],
      },
      roadType,
      roadTypeOrigin: input.roadType === undefined ? "default" : "founder",
      selection,
    },
    competitors,
    coTenants,
    evidence: evidence.sort((a, b) => compare(a.id, b.id)),
    limitations: [
      allocationNote,
      "LODES job points approximate workplaces; jobs are not unique daytime workers. Empty or incomplete inputs do not prove zero.",
      trafficNote,
      dedupNote,
      roleNote,
      ...(!selected
        ? ["Missing traffic count: uncalibrated road-type default used."]
        : []),
    ],
  });
}
