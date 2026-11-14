import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { CandidateSchema } from "@/lib/contracts";
import { createSitesHandler } from "./handler";

const source = (dataset: string, recordId: string, field: string) => ({
  origin: "costar" as const,
  dataset,
  recordId,
  field,
});
const inventory = () => ({
  synthetic: true,
  properties: [
    {
      id: "p1",
      city: "Houston",
      latitude: 29.75,
      longitude: -95.38,
      retail: true,
      data: {
        buildingName: "Synthetic shop building",
        primaryAddress: {
          streetNumber: "100",
          streetName: "Main",
          streetType: "St",
        },
        propertyRetail: { frontage: [{ frontageInFeet: 30 }] },
        parking: [{ totalSpaces: 12 }],
        privateBrokerContact: "MUST_NOT_LEAK",
      },
      source: source("commercial-property", "p1", "id"),
    },
  ],
  spaces: [
    {
      id: "l1:s1",
      listingId: "l1",
      propertyId: "p1",
      active: true,
      retail: true,
      sizeSqFt: 1200,
      data: {
        spaceUse: "Retail",
        floor: "Ground",
        position: "Corner",
        serviceTypeName: "FullService",
        askingRentUsdPerSfYearLow: 24,
        askingRentUsdPerSfYearHigh: 24,
        privateBrokerContact: "MUST_NOT_LEAK",
      },
      source: source(
        "commercial-listing-summary",
        "l1",
        "forLeaseSummary.spaces[0].id",
      ),
    },
  ],
  tenancies: [],
});
const request = (body: unknown) =>
  new Request("http://localhost/api/sites", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST site search", () => {
  it("returns a canonical shortlist and diagnostics without raw source payloads", async () => {
    const handler = createSitesHandler({
      loadInventory: async () => inventory(),
    });
    const response = await handler(
      request({ profile: syntheticHoustonFixture.profile }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("MUST_NOT_LEAK");
    const body = JSON.parse(text);
    expect(body.candidates).toHaveLength(1);
    expect(
      CandidateSchema.parse(body.candidates[0].candidate).monthlyRentCents
        .value,
    ).toBe(240_000);
    expect(body.filters.length).toBeGreaterThan(0);
  });

  it.each([
    {},
    { profile: { ...syntheticHoustonFixture.profile, city: "Boston" } },
    { profile: syntheticHoustonFixture.profile, limit: 9 },
    {
      profile: syntheticHoustonFixture.profile,
      minSizeSqFt: 2000,
      maxSizeSqFt: 1000,
    },
    { profile: syntheticHoustonFixture.profile, sql: "anything" },
  ])(
    "rejects invalid requests before querying the database: %j",
    async (body) => {
      const loadInventory = vi.fn(async () => inventory());
      const response = await createSitesHandler({ loadInventory })(
        request(body),
      );
      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe("INVALID_SITE_SEARCH");
      expect(loadInventory).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON and oversized bodies", async () => {
    const loadInventory = vi.fn(async () => inventory());
    for (const body of [
      "{broken",
      JSON.stringify({ padding: "x".repeat(70_000) }),
    ]) {
      const response = await createSitesHandler({ loadInventory })(
        new Request("http://localhost", { method: "POST", body }),
      );
      expect(response.status).toBe(422);
    }
    expect(loadInventory).not.toHaveBeenCalled();
  });

  it("returns an empty result rather than fixture data when the database inventory is empty", async () => {
    const response = await createSitesHandler({
      loadInventory: async () => ({
        properties: [],
        spaces: [],
        tenancies: [],
      }),
    })(request({ profile: syntheticHoustonFixture.profile }));
    expect(response.status).toBe(200);
    expect((await response.json()).candidates).toEqual([]);
  });

  it("preserves omitted versus explicit NNN assumptions across request validation", async () => {
    const data = inventory();
    data.spaces[0].data.serviceTypeName = "TripleNet";
    const handler = createSitesHandler({ loadInventory: async () => data });
    const baseline = await handler(
      request({ profile: syntheticHoustonFixture.profile }),
    );
    const override = await handler(
      request({
        profile: syntheticHoustonFixture.profile,
        nnnExpenseUsdPerSfYear: 10,
      }),
    );
    expect((await baseline.json()).candidates[0].opexCents).toMatchObject({
      value: 100_000,
      origin: "default",
    });
    expect((await override.json()).candidates[0].opexCents).toMatchObject({
      value: 100_000,
      origin: "founder",
    });
  });

  it("sanitizes missing database, read failures and invalid stored data", async () => {
    const secret = "PRIVATE_DATABASE_PASSWORD";
    for (const loadInventory of [
      async () => {
        throw new Error(secret);
      },
      async () => ({
        properties: [{ id: "broken" }],
        spaces: [],
        tenancies: [],
      }),
    ]) {
      const response = await createSitesHandler({ loadInventory })(
        request({ profile: syntheticHoustonFixture.profile }),
      );
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).not.toContain(secret);
      expect(JSON.parse(text).code).toBe("SITE_SEARCH_UNAVAILABLE");
    }
  });
});
