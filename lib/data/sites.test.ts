import { describe, expect, it } from "vitest";
import { syntheticHoustonFixture } from "../../fixtures/houston-coffee";
import { CandidateSchema } from "../contracts";
import {
  SiteInventorySchema,
  SiteSearchRequestSchema,
} from "../contracts/sites";
import {
  normalizeProperty,
  normalizeSpaces,
  normalizeTenancy,
  type RawRecord,
} from "./costar";
import { searchSites } from "./sites";

// Invented source records only; never read the licensed kit in tests.
const enums = {
  PropertyType: { "2": "GeneralRetail", "9": "MixedUse" },
  SpaceUse: { "5": "Retail", "3": "OfficeRetail", "1": "Office" },
  SpacePosition: {
    "0": "Unknown",
    "2": "Inline",
    "3": "EndCap",
    "5": "Corner",
  },
  FloorName: {
    "23": "Ground",
    "24": "FirstFloor",
    "2": "Second",
    "0": "Unknown",
    "99": "UnknownFloor",
  },
  ServiceType: { "13": "TripleNet", "7": "FullService" },
};
const profile = () => structuredClone(syntheticHoustonFixture.profile);
function property(id: number, extra: RawRecord = {}) {
  return normalizeProperty(
    {
      id,
      propertyType: 2,
      buildingName: `Invented ${id}`,
      primaryAddress: {
        city: "Houston",
        streetNumber: String(id),
        streetName: "Imaginary",
        streetType: "St",
        latitude: 29.7,
        longitude: -95.4,
      },
      propertyRetail: {
        frontage: [{ frontageInFeet: 30, isPrimaryFrontage: true }],
      },
      parking: [{ totalSpaces: 12 }],
      ...extra,
    },
    enums,
  );
}
function space(
  id: number,
  propertyId: number,
  extra: RawRecord = {},
  header: RawRecord = {},
) {
  return normalizeSpaces(
    {
      id,
      propertyId,
      listingStatus: 1,
      forLeaseSummary: {
        askingRateMeasurementType: 1,
        spaces: [
          {
            id: 1,
            spaceUse: 5,
            squareFeetMax: 1200,
            rateHigh: 24,
            rateLow: 18,
            rateBasis: 2,
            monetaryUnit: 1,
            serviceType: 7,
            floorName: 23,
            spacePosition: 2,
            ...extra,
          },
        ],
      },
      ...header,
    },
    enums,
  )[0]!;
}
function inventory(spaces = [space(10, 1)], properties = [property(1)]) {
  return { spaces, properties, tenancies: [], synthetic: true };
}

describe("site search", () => {
  it("ranks a synthetic shortlist with transparent sequential filter counts", () => {
    const p = profile();
    const data = inventory(
      [
        space(10, 1),
        space(11, 2, { rateHigh: 30 }),
        space(12, 3),
        space(13, 1, {}, { listingStatus: 4 }),
        space(14, 1, { spaceUse: 1 }),
        space(15, 1, { squareFeetMax: 500 }),
        space(16, 1, { rateHigh: 80 }),
        space(17, 1, { floorName: 2 }),
        space(18, 4),
      ],
      [
        property(1),
        property(2),
        property(3, { primaryAddress: { city: "Los Angeles" } }),
        property(4, { propertyRetail: { frontage: [{ frontageInFeet: 0 }] } }),
      ],
    );
    const result = searchSites(
      { profile: p, minSizeSqFt: 800, maxSizeSqFt: 1800 },
      data,
    );
    expect(result.candidates.map((v) => v.candidate.id)).toEqual([
      "10:1",
      "11:1",
    ]);
    expect(result.filters.map((v) => [v.name, v.removed])).toEqual([
      ["city", 1],
      ["activeForLease", 1],
      ["retailUse", 1],
      ["size", 1],
      ["rentCeiling", 1],
      ["mustHave.groundFloor", 1],
      ["mustHave.frontage", 1],
    ]);
    expect(result.totalMatched).toBe(2);
    result.candidates.forEach((v) =>
      expect(CandidateSchema.safeParse(v.candidate).success).toBe(true),
    );
  });

  it("keeps unknown rent behind known rent and does not reward it as cheap", () => {
    const data = inventory([
      space(10, 1, { rateHigh: null, rateLow: null, spacePosition: 5 }),
      space(11, 1),
    ]);
    const result = searchSites({ profile: profile() }, data);
    expect(result.candidates[0].candidate.id).toBe("11:1");
    const unknown = result.candidates[1];
    expect(unknown.candidate.monthlyRentCents.value).toBeNull();
    expect(unknown.baseRentCents.unknownReason).toBeTruthy();
    expect(unknown.flags).toContain("rent_unknown");
    expect(unknown.scoreComponents.rentFit).toBe(0);
  });

  it("selects the upper range, uses a single known endpoint with a flag, and converts cents", () => {
    const data = inventory([
      space(10, 1),
      space(11, 1, { rateHigh: null, rateLow: 24 }),
    ]);
    const result = searchSites({ profile: profile() }, data);
    expect(result.candidates.map((v) => v.baseRentCents.value)).toEqual([
      240000, 240000,
    ]);
    expect(result.candidates[1].flags).toContain("rent_single_endpoint");
    const p = profile();
    p.economics.monthlyRentCeilingCents.value = 220000;
    expect(searchSites({ profile: p }, inventory()).candidates).toEqual([]);
  });

  it("separates explicitly estimated NNN costs from canonical base rent, including overrides", () => {
    const data = inventory([space(10, 1, { serviceType: 13 })]);
    const result = searchSites({ profile: profile() }, data);
    expect(result.candidates[0]).toMatchObject({
      baseRentCents: { value: 240000 },
      opexCents: {
        value: 100000,
        origin: "default",
        evidenceIds: expect.arrayContaining(["default-nnn-opex-v1"]),
      },
      totalMonthlyCostCents: { value: 340000 },
      flags: expect.arrayContaining(["nnn_opex_estimated"]),
    });
    expect(result.candidates[0].candidate.monthlyRentCents.value).toBe(240000);
    const custom = searchSites(
      { profile: profile(), nnnExpenseUsdPerSfYear: 15 },
      data,
    );
    expect(custom.candidates[0].opexCents).toMatchObject({
      value: 150000,
      origin: "founder",
    });
    expect(custom.candidates[0].flags).toContain("nnn_opex_override");
    expect(
      result.evidence.find((e) => e.id === "default-nnn-opex-v1")?.description,
    ).toMatch(/illustrative/i);
  });

  it("includes mixed-use OfficeRetail by space use and never infers corner from floor/suite", () => {
    const p = profile();
    p.mustHaves.corner.value = true;
    const data = inventory(
      [
        space(10, 1, {
          spacePosition: undefined,
          suite: "Corner ground endcap",
          spaceUse: 3,
        }),
        space(11, 1, { spacePosition: 3, spaceUse: 3 }),
      ],
      [property(1, { propertyType: 9 })],
    );
    const result = searchSites({ profile: p }, data);
    expect(result.candidates.map((v) => v.candidate.id)).toEqual(["11:1"]);
    expect(
      result.filters.find((f) => f.name === "mustHave.corner")?.removed,
    ).toBe(1);
    expect(result.candidates[0].candidate.features.corner.value).toBe(false);
    expect(result.candidates[0].position).toBe("EndCap");
  });

  it("treats unknown required ground floor, frontage and parking as unsatisfied", () => {
    for (const feature of ["groundFloor", "frontage", "parking"] as const) {
      const p = profile();
      for (const flag of Object.values(p.mustHaves)) flag.value = false;
      p.mustHaves[feature].value = true;
      const result = searchSites(
        { profile: p },
        inventory(
          [space(10, 1, { floorName: undefined })],
          [
            property(1, {
              propertyRetail: {},
              parking: undefined,
              lotWidthInFeet: 60,
            }),
          ],
        ),
      );
      expect(result.candidates).toEqual([]);
      expect(result.mostRestrictiveFilter).toBe(`mustHave.${feature}`);
      expect(result.emptyReason).toContain(`mustHave.${feature}`);
    }
  });

  it("keeps unknown size explicit and cannot calculate rent or NNN total from it", () => {
    const result = searchSites(
      { profile: profile(), minSizeSqFt: 800 },
      inventory([space(10, 1, { squareFeetMax: null, serviceType: 13 })]),
    );
    expect(result.candidates[0]).toMatchObject({
      candidate: {
        floorAreaSqFt: { value: null },
        monthlyRentCents: { value: null },
      },
      opexCents: { value: null },
      totalMonthlyCostCents: { value: null },
      flags: expect.arrayContaining(["size_unknown", "nnn_opex_estimated"]),
    });
  });

  it("exposes only whitelisted product fields, exact source paths and resolvable evidence", () => {
    const data = inventory(
      [space(10, 1, { secretLicensePayload: "never serialize this" })],
      [
        property(1, {
          propertyRetail: {
            frontage: [{ frontageInFeet: 30, isPrimaryFrontage: true }],
          },
          proprietaryNotes: "never serialize this",
        }),
      ],
    );
    const result = searchSites({ profile: profile() }, data);
    const entry = result.candidates[0];
    expect(entry.flags).toContain("frontage_building_level");
    expect(entry.sources).toContainEqual({
      origin: "costar",
      dataset: "commercial-listing-summary",
      recordId: "10",
      field: "forLeaseSummary.spaces[0].rateHigh",
    });
    expect(entry.sources).toContainEqual({
      origin: "costar",
      dataset: "commercial-property",
      recordId: "1",
      field: "propertyRetail.frontage[0].frontageInFeet",
    });
    expect(JSON.stringify(result)).not.toContain("never serialize this");
    const ids = new Set(result.evidence.map((e) => e.id));
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const value = node as Record<string, unknown>;
      if (Array.isArray(value.evidenceIds))
        value.evidenceIds.forEach((id) =>
          expect(ids.has(String(id))).toBe(true),
        );
      Object.values(value).forEach(walk);
    };
    walk(result);
  });

  it("leaves anchors unknown, scores size/frontage/position deterministically, capped at eight", () => {
    const spaces = Array.from({ length: 10 }, (_, i) =>
      space(10 + i, i + 1, i === 7 ? { spacePosition: 5 } : {}),
    );
    const data = {
      ...inventory(
        spaces,
        spaces.map((_, i) => property(i + 1)),
      ),
      tenancies: [
        normalizeTenancy(
          { id: 88, propertyId: 8, isAnchor: true },
          null,
          enums,
        )!,
      ],
    };
    const result = searchSites(
      { profile: profile(), minSizeSqFt: 1000, maxSizeSqFt: 1400 },
      data,
    );
    expect(result.candidates).toHaveLength(8);
    expect(result.candidates[0].candidate.id).toBe("17:1");
    expect(result.totalMatched).toBe(10);
    expect(result.candidates[0].scoreComponents.anchorCotenants).toBe(0);
    expect(result.candidates[0].flags).toContain("anchor_cotenants_unknown");
    expect(
      searchSites(
        { profile: profile(), minSizeSqFt: 1000, maxSizeSqFt: 1400 },
        {
          ...data,
          spaces: [...data.spaces].reverse(),
          properties: [...data.properties].reverse(),
        },
      ),
    ).toEqual(result);
  });

  it("uses actual Ground and Corner enums without conflating EndCap", () => {
    const p = profile();
    p.mustHaves.corner.value = true;
    p.mustHaves.parking.value = true;
    const result = searchSites(
      { profile: p },
      inventory([space(10, 1, { floorName: 23, spacePosition: 5 })]),
    );
    expect(result.candidates[0]).toMatchObject({
      candidate: {
        name: "Invented 1",
        address: "1 Imaginary St",
        features: {
          corner: { value: true },
          groundFloor: { value: true },
          parking: { value: true },
        },
      },
      position: "Corner",
    });
  });

  it.each([24, 99, 0, undefined])(
    "keeps ambiguous floor %s explicitly unknown and excludes it when ground floor is required",
    (floorName) => {
      const data = inventory([space(10, 1, { floorName })]);
      const p = profile();
      p.mustHaves.groundFloor.value = false;
      const result = searchSites({ profile: p }, data);
      expect(result.candidates[0].candidate.features.groundFloor).toMatchObject(
        { value: null, unknownReason: expect.any(String) },
      );
      expect(result.candidates[0].flags).toContain("ground_floor_unknown");
      p.mustHaves.groundFloor.value = true;
      const required = searchSites({ profile: p }, data);
      expect(required.candidates).toEqual([]);
      expect(
        required.filters.find(
          (filter) => filter.name === "mustHave.groundFloor",
        )?.removed,
      ).toBe(1);
    },
  );

  it("uses nested frontage and parking/ratio, preserves partial unknowns and labels building scope", () => {
    const p = profile();
    p.mustHaves.parking.value = true;
    const data = inventory(
      [space(10, 1)],
      [
        property(1, {
          propertyRetail: {
            frontage: [{ frontageInFeet: null }, { frontageInFeet: 15 }],
          },
          parking: [{ totalSpaces: null }],
          parkingRatio: 2,
        }),
      ],
    );
    const result = searchSites({ profile: p }, data);
    expect(result.candidates[0].candidate.features).toMatchObject({
      frontage: { value: true },
      parking: { value: true },
    });
    expect(
      result.evidence.find(
        (e) =>
          e.sources[0]?.field === "propertyRetail.frontage[1].frontageInFeet",
      )?.limitations[0],
    ).toMatch(/Building-level/);
    expect(result.candidates[0].sources).toContainEqual({
      origin: "costar",
      dataset: "commercial-property",
      recordId: "1",
      field: "parkingRatio",
    });
    data.properties[0] = property(1, {
      propertyRetail: {
        frontage: [{ frontageInFeet: 0 }, { frontageInFeet: null }],
      },
      parking: [],
    });
    expect(searchSites({ profile: p }, data).candidates).toEqual([]);
  });

  it("does not invent additional operating costs for unknown/non-NNN service types", () => {
    const result = searchSites(
      { profile: profile() },
      inventory([space(10, 1, { serviceType: 99 })]),
    );
    expect(result.candidates[0]).toMatchObject({
      baseRentCents: { value: 240000 },
      opexCents: { value: null, unknownReason: expect.any(String) },
      totalMonthlyCostCents: { value: null },
      flags: expect.arrayContaining(["opex_unknown"]),
    });
    const overrideZero = searchSites(
      { profile: profile(), nnnExpenseUsdPerSfYear: 0 },
      inventory([space(10, 1, { serviceType: 13 })]),
    );
    expect(overrideZero.candidates[0].opexCents).toMatchObject({
      value: 0,
      origin: "founder",
    });
  });

  it("filters missing property joins, returns stable IDs and honors a smaller limit", () => {
    const data = inventory([space(10, 99), space(11, 1), space(12, 1)]);
    const result = searchSites({ profile: profile(), limit: 1 }, data);
    expect(result.filters[0]).toEqual({
      name: "city",
      before: 3,
      removed: 1,
      after: 2,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.totalMatched).toBe(2);
    expect(result.candidates[0].candidate.id).toBe(data.spaces[1].id);
    expect(result.candidates[0].candidate).toMatchObject({
      id: "11:1",
      projectId: profile().projectId,
      synthetic: true,
    });
  });

  it("validates requests and normalized inventory, including source JSON and duplicate IDs", () => {
    expect(
      SiteSearchRequestSchema.safeParse({ profile: profile(), limit: 9 })
        .success,
    ).toBe(false);
    expect(
      SiteSearchRequestSchema.safeParse({
        profile: profile(),
        minSizeSqFt: 2000,
        maxSizeSqFt: 1000,
      }).success,
    ).toBe(false);
    expect(
      SiteSearchRequestSchema.safeParse({
        profile: profile(),
        nnnExpenseUsdPerSfYear: -1,
      }).success,
    ).toBe(false);
    expect(
      SiteSearchRequestSchema.safeParse({ profile: profile(), anything: true })
        .success,
    ).toBe(false);
    expect(
      SiteInventorySchema.safeParse({
        ...inventory(),
        spaces: [{ ...space(10, 1), source: { surprise: "no" } }],
      }).success,
    ).toBe(false);
    expect(
      SiteInventorySchema.safeParse(inventory([space(10, 1), space(10, 1)]))
        .success,
    ).toBe(false);
    expect(() =>
      searchSites({ profile: profile() }, inventory([], [])),
    ).not.toThrow();
    expect(
      searchSites({ profile: profile() }, inventory([], [])).emptyReason,
    ).toContain("inventory");
  });
});
