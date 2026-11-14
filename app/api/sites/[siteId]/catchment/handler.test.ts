import { describe, expect, it, vi } from "vitest";
import {
  CatchmentDataUnavailableError,
  CatchmentNotFoundError,
  getCatchment,
} from "@/lib/data/catchment-repository";
import { createCatchmentHandler } from "./handler";
import { buildCatchment } from "@/lib/data/catchments";

const context = (siteId = "123") => ({ params: Promise.resolve({ siteId }) });
const request = (query = "projectId=demo&category=coffee") =>
  new Request(`http://localhost/api/sites/123/catchment?${query}`);

describe("catchment route boundary", () => {
  it.each([
    ["Houston", 29.7, -95.4],
    ["Los Angeles", 34.05, -118.25],
  ] as const)(
    "returns all five sourced components for a synthetic %s site",
    async (city, latitude, longitude) => {
      const getter: typeof getCatchment = async (siteId, query, radiusOrigin) =>
        buildCatchment({
          site: {
            id: siteId,
            propertyId: "123",
            projectId: query.projectId,
            city,
            latitude,
            longitude,
            frontage: [],
            source: {},
          },
          radiusMeters: query.radiusMeters,
          radiusOrigin,
          category: query.category,
          retrievedAt: "2026-11-14T00:00:00.000Z",
          residents: [
            {
              geoid: "synthetic-bg",
              population: 100,
              households: 40,
              medianHouseholdIncome: 50000,
              ageBands: { "18-34": 30 },
              areaFraction: 0.5,
              source: {},
            },
          ],
          workers: [
            {
              geoid: "synthetic-block",
              jobs: 10,
              latitude,
              longitude,
              source: {},
            },
          ],
          venues: [
            {
              id: "synthetic-place",
              name: "Synthetic coffee",
              category: "coffee",
              latitude,
              longitude,
              origin: "public",
              source: {},
            },
          ],
          coTenants: [
            {
              id: "synthetic-tenant",
              name: "Synthetic shop",
              industry: "RetailersOrWholesalers",
              occupiedSqFt: 1000,
              source: {},
            },
          ],
        });
      const response = await createCatchmentHandler(getter)(
        request(),
        context(),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      for (const part of [
        "residents",
        "workers",
        "passBy",
        "competitors",
        "coTenants",
        "evidence",
      ])
        expect(body).toHaveProperty(part);
      expect(body.catchment.residentPopulation).toMatchObject({
        value: 50,
        origin: "default",
        evidenceIds: expect.any(Array),
      });
      expect(body.passBy.missingTrafficCount.value).toBe(true);
      expect(body.competitors[0].id).toMatch(/^comp_[a-f0-9]+$/);
    },
  );
  it.each([
    "",
    "projectId=demo",
    "projectId=demo&category=unknown",
    "projectId=demo&category=coffee&radiusMeters=0",
    "projectId=demo&category=coffee&radiusMeters=500000",
    "projectId=demo&category=coffee&category=fitness",
  ])("rejects invalid queries before touching data (%s)", async (query) => {
    const getter = vi.fn();
    const response = await createCatchmentHandler(getter)(
      request(query),
      context(),
    );
    expect(response.status).toBe(400);
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects malformed site IDs before touching data", async () => {
    const getter = vi.fn();
    expect(
      (await createCatchmentHandler(getter)(request(), context("123;DROP")))
        .status,
    ).toBe(400);
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([
    [new CatchmentNotFoundError("private identifier"), 404],
    [new CatchmentDataUnavailableError("private source details"), 503],
    [new Error("postgres://username:secret@host/db"), 503],
  ] as const)(
    "sanitizes failures and disables caching",
    async (error, status) => {
      const getter = vi.fn(async () => {
        throw error;
      }) as unknown as typeof getCatchment;
      const response = await createCatchmentHandler(getter)(
        request(),
        context(),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toMatch(/secret|private|postgres/);
    },
  );
  it("passes the bounded default radius as a default assumption", async () => {
    const getter = vi.fn(async () => {
      throw new CatchmentNotFoundError();
    }) as unknown as typeof getCatchment;
    await createCatchmentHandler(getter)(request(), context("12:34"));
    expect(getter).toHaveBeenCalledWith(
      "12:34",
      expect.objectContaining({ radiusMeters: 1000 }),
      "default",
    );
  });
  it("marks an explicit radius as founder input", async () => {
    const getter = vi.fn(async () => {
      throw new CatchmentNotFoundError();
    }) as unknown as typeof getCatchment;
    await createCatchmentHandler(getter)(
      request("projectId=demo&category=coffee&radiusMeters=1500"),
      context(),
    );
    expect(getter).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ radiusMeters: 1500 }),
      "founder",
    );
  });
});
