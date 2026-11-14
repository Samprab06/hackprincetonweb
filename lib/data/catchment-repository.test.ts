import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CatchmentDataUnavailableError,
  CatchmentNotFoundError,
  readCatchment,
} from "./catchment-repository";

const publicSource = {
  origin: "public",
  dataset: "Synthetic test only",
  url: "https://example.test/source",
  retrievedAt: "2026-11-14T00:00:00.000Z",
  vintage: "2024",
};
const costarSource = {
  origin: "costar",
  dataset: "Synthetic test only",
  recordId: "123",
  field: "id",
};
const query = {
  projectId: "demo",
  category: "coffee" as const,
  radiusMeters: 1000,
};
function database(responses: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (statement: SQL) => {
    calls.push(new PgDialect().sqlToQuery(statement));
    return responses.shift() ?? [];
  });
  return { execute, calls };
}
function observations(
  city = "Houston",
  latitude = 29.7,
  longitude = -95.4,
): unknown[] {
  return [
    [{ id: "demo" }],
    [
      {
        id: "123",
        city,
        latitude,
        longitude,
        source: costarSource,
        frontage: [],
      },
    ],
    [{ residents: true, workers: true, places: true }],
    [
      {
        geoid: "482010001001",
        population: 1000,
        households: 400,
        median_household_income: 50000,
        age_bands: { "18-34": 300 },
        area_fraction: 0.5,
        source: publicSource,
        geometry_source: publicSource,
      },
    ],
    [
      {
        geoid: "482010001001001",
        jobs: 100,
        latitude,
        longitude,
        source: publicSource,
      },
    ],
    [
      {
        id: "1",
        name: "Shared Coffee LLC",
        latitude,
        longitude,
        industry: "AccommodationAndFoodServices",
        source: costarSource,
      },
    ],
    [
      {
        id: "other",
        name: "Shared Coffee",
        category: "coffee",
        latitude: latitude + 0.0001,
        longitude,
        source: publicSource,
        provider_sources: [{ dataset: "Synthetic", license: "CC0-1.0" }],
      },
    ],
    [
      {
        id: "2",
        name: "Synthetic Grocery",
        industry: "RetailersOrWholesalers",
        occupied_sq_ft: 30000,
        source: costarSource,
      },
    ],
  ];
}

describe("catchment spatial repository", () => {
  it.each([
    ["Houston", 29.7, -95.4],
    ["Los Angeles", 34.05, -118.25],
  ] as const)(
    "projects all five sourced parts for %s",
    async (city, lat, lon) => {
      const db = database(observations(city, lat, lon));
      const result = await readCatchment(
        db,
        "123",
        query,
        "founder",
        "2026-11-14T00:00:00.000Z",
      );
      expect(result.catchment.siteId).toBe("123");
      expect(result.catchment.residentPopulation.value).toBe(500);
      expect(result.catchment.daytimeWorkers.value).toBe(100);
      expect(result.catchment.competitors).toHaveLength(1);
      const limitations = result.evidence
        .flatMap((e) => e.limitations)
        .join("\n");
      expect(limitations).toContain("Broad industry proxy");
      expect(limitations).toContain("license=CC0-1.0");
      for (const key of [
        "residents",
        "workers",
        "passBy",
        "competitors",
        "coTenants",
        "evidence",
      ])
        expect(result).toHaveProperty(key);
      const radiusQueries = db.calls.filter((call) =>
        call.sql.includes("ST_DWithin"),
      );
      expect(radiusQueries).toHaveLength(4);
      for (const call of radiusQueries) {
        expect(call.sql).toContain("::geography");
        expect(call.params).toContain(1000);
        expect(call.params).toContain(lon);
        expect(call.params).toContain(lat);
      }
      expect(db.calls[3]!.sql).toContain("ST_Intersection");
      expect(db.calls[3]!.sql).not.toContain("propertyApartment");
      expect(db.calls[7]!.sql).toContain("count(occupied)<>count(*)");
      expect(db.calls[7]!.sql).toContain("min(occupied)<0");
      expect(db.calls[7]!.sql).toContain(
        "jsonb_typeof(t.data->'spaces')='array'",
      );
    },
  );
  it("returns unknown-project/site errors without issuing later queries", async () => {
    const missingProject = database([[]]);
    await expect(
      readCatchment(missingProject, "123", query, "default"),
    ).rejects.toBeInstanceOf(CatchmentNotFoundError);
    expect(missingProject.execute).toHaveBeenCalledTimes(1);
    const missingSite = database([[{ id: "demo" }], []]);
    await expect(
      readCatchment(missingSite, "123", query, "default"),
    ).rejects.toBeInstanceOf(CatchmentNotFoundError);
    expect(missingSite.execute).toHaveBeenCalledTimes(2);
  });
  it("does not fabricate coordinates or zero totals for unavailable source coverage", async () => {
    const noCoordinates = observations();
    noCoordinates[1] = [
      {
        id: "123",
        city: "Houston",
        latitude: null,
        longitude: -95.4,
        source: costarSource,
        frontage: [],
      },
    ];
    await expect(
      readCatchment(database(noCoordinates), "123", query, "default"),
    ).rejects.toBeInstanceOf(CatchmentDataUnavailableError);
    const noCoverage = observations();
    noCoverage[2] = [{ residents: false, workers: true, places: true }];
    await expect(
      readCatchment(database(noCoverage), "123", query, "default"),
    ).rejects.toBeInstanceOf(CatchmentDataUnavailableError);
  });
});
