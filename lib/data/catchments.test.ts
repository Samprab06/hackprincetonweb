import { describe, expect, it } from "vitest";
import {
  CatchmentRequestSchema,
  CatchmentResponseSchema,
} from "../contracts/catchment";
import { buildCatchment, type CatchmentObservations } from "./catchments";

const source = {
  origin: "public",
  dataset: "Synthetic test source",
  url: "https://example.test/public",
  vintage: "2024",
  retrievedAt: "2026-11-14T00:00:00Z",
};
function observations(
  city: "Houston" | "Los Angeles" = "Houston",
): CatchmentObservations {
  const latitude = city === "Houston" ? 29.76 : 34.05;
  const longitude = city === "Houston" ? -95.37 : -118.24;
  return {
    site: {
      id: "123:456",
      propertyId: "123",
      projectId: "project-test",
      city,
      latitude,
      longitude,
      frontage: [{ trafficCount: 0, primary: true }, { trafficCount: 9000 }],
      source: { brokerEmail: "private@example.test", sourcePayload: "PRIVATE" },
    },
    radiusMeters: 1000,
    radiusOrigin: "default",
    category: "coffee",
    retrievedAt: "2026-11-14T00:00:00Z",
    residents: [
      {
        geoid: "b",
        population: 100,
        households: 40,
        medianHouseholdIncome: 60000,
        ageBands: { "0-17": 20, "18-34": 30 },
        areaFraction: 0.5,
        source,
        geometrySource: source,
      },
      {
        geoid: "a",
        population: 0,
        households: 0,
        medianHouseholdIncome: 0,
        ageBands: { "0-17": 0, "18-34": 0 },
        areaFraction: 1,
        source,
        geometrySource: source,
      },
    ],
    workers: [
      { geoid: "b", jobs: 10, latitude, longitude, source },
      { geoid: "a", jobs: 0, latitude, longitude, source },
    ],
    venues: [
      {
        id: "z",
        name: "Café Test, L.L.C.",
        category: "coffee",
        latitude,
        longitude,
        origin: "costar",
        source: { ...source, brokerEmail: "private@example.test" },
      },
      {
        id: "a",
        name: "Cafe Test Inc.",
        category: "coffee",
        latitude: latitude + 0.0001,
        longitude,
        origin: "public",
        source,
      },
      {
        id: "far",
        name: "Cafe Test",
        category: "coffee",
        latitude: latitude + 0.005,
        longitude,
        origin: "public",
        source,
      },
      {
        id: "other",
        name: "Cafe Test",
        category: "fitness",
        latitude,
        longitude,
        origin: "public",
        source,
      },
    ],
    coTenants: [
      {
        id: "anchor",
        name: "Test Grocery",
        industry: "grocery",
        occupiedSqFt: 20000,
        source: {},
      },
      {
        id: "complement",
        name: "Test Office",
        industry: "office",
        occupiedSqFt: 1000,
        source: {},
      },
      {
        id: "unknown",
        name: null,
        industry: null,
        occupiedSqFt: null,
        source: {},
      },
    ],
  };
}

describe("pure catchment aggregation (synthetic observations only)", () => {
  it("recognizes CoStar isPrimaryFrontage instead of choosing a larger side-road count", () => {
    const input = observations();
    input.site.frontage = [
      { isPrimaryFrontage: true, trafficCount: 100 },
      { trafficCount: 5000 },
    ];
    expect(buildCatchment(input).passBy.vehiclesPerDay.value).toBe(100);
  });
  it("separates category and road assumption snapshot identities", () => {
    const input = observations();
    const first = buildCatchment(input).catchment.id;
    expect(
      buildCatchment({ ...input, category: "fitness" }).catchment.id,
    ).not.toBe(first);
    expect(
      buildCatchment({ ...input, roadType: "arterial" }).catchment.id,
    ).not.toBe(first);
    expect(
      buildCatchment({ ...input, roadType: undefined }).catchment.id,
    ).not.toBe(buildCatchment({ ...input, roadType: "unknown" }).catchment.id);
  });
  it("retains an official public Overture S3 source URL and actual industry-label complements", () => {
    const input = observations();
    const venue = input.venues.find((v) => v.origin === "public")!;
    venue.source = {
      ...venue.source,
      url: "s3://overturemaps-us-west-2/release/synthetic/theme=places/type=place/*.parquet",
    };
    input.coTenants = [
      {
        id: "retail",
        name: "Synthetic shop",
        industry: "RetailersOrWholesalers",
        occupiedSqFt: 1000,
        source: {},
      },
    ];
    const result = buildCatchment(input);
    expect(result.coTenants[0]!.role).toBe("complement");
    expect(
      result.evidence.some((e) =>
        e.sourceUrl?.startsWith("s3://overturemaps-us-west-2/"),
      ),
    ).toBe(true);
  });
  it.each(["Houston", "Los Angeles"] as const)(
    "assembles all five components in %s without leaking source payloads",
    (city) => {
      const result = buildCatchment(observations(city));
      expect(CatchmentResponseSchema.safeParse(result).success).toBe(true);
      expect(result.residents.population).toMatchObject({
        value: 50,
        origin: "default",
      });
      expect(result.residents.households.value).toBe(20);
      expect(result.residents.ageBands["0-17"].value).toBe(10);
      expect(result.residents.blockGroups[1].population).toMatchObject({
        value: 100,
        origin: "public",
      });
      expect(
        result.residents.blockGroups[1].medianHouseholdIncome,
      ).toMatchObject({ value: 60000, origin: "public" });
      expect(result.workers.jobs).toMatchObject({
        value: 10,
        unit: "jobs",
        origin: "public",
      });
      expect(result.catchment.daytimeWorkers).toEqual(result.workers.jobs);
      expect(result.passBy.vehiclesPerDay).toMatchObject({
        value: 0,
        origin: "costar",
        unit: "vehicles/day",
      });
      expect(result.passBy.missingTrafficCount.value).toBe(false);
      expect(result.passBy.selection).toContain(
        "site.frontage[0].trafficCount",
      );
      expect(result.competitors).toHaveLength(2);
      expect(result.competitors[0].sourceIds).toEqual(["costar:z", "public:a"]);
      expect(result.catchment.competitors.map((c) => c.id)).toEqual(
        result.competitors.map((c) => c.id),
      );
      expect(result.coTenants.map((c) => c.role)).toEqual([
        "anchor",
        "complement",
        "other",
      ]);
      expect(result.coTenants[2].industry).toBeNull();
      expect(result.coTenants[2].occupiedSqFt.value).toBeNull();
      expect(
        result.evidence.every(
          (e) =>
            e.projectId === "project-test" &&
            e.synthetic === false &&
            e.observedAt === null,
        ),
      ).toBe(true);
      expect(
        result.evidence
          .filter((e) => e.origin === "costar")
          .every((e) => e.sourceUrl === null),
      ).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(
        /brokerEmail|private@example|sourcePayload|PRIVATE/,
      );
      expect(result.limitations.join(" ")).toMatch(/not people, pedestrians/);
    },
  );
  it("propagates unknown values without hiding them behind partial totals; retains genuine zeros", () => {
    const input = observations();
    input.residents[0].population = null;
    input.residents[0].households = null;
    input.residents[0].ageBands["0-17"] = null;
    input.workers[0].jobs = null;
    const result = buildCatchment(input);
    expect(result.residents.population.value).toBeNull();
    expect(result.residents.population.unknownReason).toBeTruthy();
    expect(result.residents.households.value).toBeNull();
    expect(result.residents.ageBands["0-17"].value).toBeNull();
    expect(result.residents.ageBands["18-34"].value).toBe(15);
    expect(result.workers.jobs.value).toBeNull();
    expect(result.workers.blocks[0].jobs.value).toBe(0);
    input.residents = [];
    input.workers = [];
    expect(buildCatchment(input).residents.population.value).toBeNull();
    expect(buildCatchment(input).workers.jobs.value).toBeNull();
  });
  it.each([
    ["local", 3000],
    ["collector", 10000],
    ["arterial", 25000],
    ["unknown", 10000],
  ] as const)("flags uncalibrated %s defaults", (roadType, value) => {
    const input = observations();
    input.roadType = roadType;
    input.site.frontage = [{ trafficCount: null }, { averageDailyTraffic: -1 }];
    const result = buildCatchment(input);
    expect(result.passBy.vehiclesPerDay).toMatchObject({
      value,
      origin: "default",
      unit: "vehicles/day",
    });
    expect(result.passBy.missingTrafficCount.value).toBe(true);
    expect(result.passBy.roadTypeOrigin).toBe("founder");
    expect(result.limitations.join(" ")).toMatch(/Missing traffic count/);
  });
  it("defaults an unspecified road type to unknown and selects a single maximum frontage", () => {
    const input = observations();
    input.site.frontage = [];
    expect(buildCatchment(input).passBy).toMatchObject({
      roadType: "unknown",
      roadTypeOrigin: "default",
      vehiclesPerDay: { value: 10000 },
    });
    input.site.frontage = [
      { trafficCountPerDay: 400 },
      { averageDailyTraffic: 400 },
      { trafficCount: 200 },
    ];
    expect(buildCatchment(input).passBy.vehiclesPerDay.value).toBe(400);
  });
  it("is repeatable and stable under reordered observation rows, retaining both dedup source evidence", () => {
    const input = observations();
    const first = buildCatchment(input);
    expect(buildCatchment(input)).toEqual(first);
    input.residents.reverse();
    input.workers.reverse();
    input.venues.reverse();
    input.coTenants.reverse();
    expect(buildCatchment(input)).toEqual(first);
    const evidence = first.competitors[0].evidenceIds.map((id) =>
      first.evidence.find((e) => e.id === id)!,
    );
    expect(evidence.map((e) => e.origin)).toEqual(
      expect.arrayContaining(["public", "costar"]),
    );
    expect(
      CatchmentResponseSchema.safeParse({ ...first, evidence: [] }).success,
    ).toBe(false);
  });
  it("does not deduplicate unnamed places and does not invent observed dates", () => {
    const input = observations();
    input.venues = input.venues.slice(0, 2).map((v) => ({ ...v, name: null }));
    const result = buildCatchment(input);
    expect(result.competitors).toHaveLength(2);
    expect(result.competitors.every((c) => c.name === null)).toBe(true);
    expect(result.evidence.every((e) => e.observedAt === null)).toBe(true);
  });
  it("flags broad industry proxies and retains provider attribution without raw source data", () => {
    const input = observations();
    input.venues[0].source = {
      extra: {
        industry: "Eating places",
        classification: "broad_industry_proxy",
        brokerEmail: "private@example.test",
      },
    };
    input.venues[1].source = {
      ...source,
      extra: {
        providerSources: [
          {
            dataset: "Foursquare",
            license: "Apache-2.0",
            record_id: "PRIVATE",
          },
        ],
      },
    };
    const result = buildCatchment(input);
    const notes = result.evidence.flatMap((e) => e.limitations).join(" ");
    expect(notes).toContain("not a verified direct competitor");
    expect(notes).toContain("dataset=Foursquare");
    expect(notes).toContain("license=Apache-2.0");
    expect(JSON.stringify(result)).not.toMatch(
      /brokerEmail|private@example|record_id|PRIVATE/,
    );
  });
  it("rejects invalid area fractions as unknown rather than allocating an impossible count", () => {
    const input = observations();
    input.residents[0].areaFraction = 2;
    expect(buildCatchment(input).residents.population.value).toBeNull();
  });
  it("validates URL query options with bounded radius and required project/category", () => {
    expect(
      CatchmentRequestSchema.parse({ projectId: "p", category: "coffee" })
        .radiusMeters,
    ).toBe(1000);
    expect(
      CatchmentRequestSchema.parse({
        projectId: "p",
        category: "fitness",
        radiusMeters: "100",
      }).radiusMeters,
    ).toBe(100);
    for (const radiusMeters of ["", 0, 99, 20001, "bad", Infinity])
      expect(
        CatchmentRequestSchema.safeParse({
          projectId: "p",
          category: "coffee",
          radiusMeters,
        }).success,
      ).toBe(false);
    expect(
      CatchmentRequestSchema.safeParse({ category: "coffee" }).success,
    ).toBe(false);
    expect(
      CatchmentRequestSchema.safeParse({
        projectId: "p",
        category: "unsupported",
      }).success,
    ).toBe(false);
  });
});
