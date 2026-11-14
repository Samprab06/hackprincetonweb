import { describe, expect, it } from "vitest";
import {
  normalizeAttachments,
  normalizeProperty,
  normalizeSpaces,
  normalizeTenancy,
  type EnumLookup,
  type RawRecord,
} from "./costar";

// Entirely invented records: tests never read or redistribute licensed kit data.
const enums: EnumLookup = {
  PropertyType: { "2": "GeneralRetail", "9": "MixedUse", "5": "Multifamily" },
  PropertySubtype: { "12": "GeneralRetail_Bank" },
  SpaceUse: { "3": "OfficeRetail", "5": "Retail", "1": "Office" },
  SpacePosition: { "0": "Unknown", "2": "Inline", "3": "EndCap" },
  RateBasis: { "0": "Unknown", "1": "Monthly", "2": "Yearly" },
  MonetaryUnit: {
    "0": "Unknown",
    "1": "UnitedStatesDollar",
    "2": "CanadianDollar",
  },
  ServiceType: { "13": "TripleNet", "7": "FullService" },
  FloorName: { "1": "Ground" },
  ListingStatus: { "1": "Active", "4": "OffMarket" },
  IndustryType: {
    "17": "AccommodationAndFoodServices",
    "6": "RetailersOrWholesalers",
  },
  ExternalReferenceType3: {
    "36": "MatterportScan",
    "234": "MatterportStreamingKey",
  },
};

function listing(
  space: RawRecord = {},
  summary: RawRecord = {},
  header: RawRecord = {},
): RawRecord {
  return {
    id: 100,
    propertyId: 200,
    listingStatus: 1,
    monetaryUnit: 1,
    forLeaseSummary: {
      askingRateMeasurementType: 1,
      spaces: [
        {
          id: 300,
          propertyId: 201,
          spaceUse: 5,
          squareFeetMin: 800,
          squareFeetMax: 1200,
          rateLow: 2,
          rateHigh: 3,
          rateBasis: 1,
          monetaryUnit: 1,
          serviceType: 13,
          suite: "A",
          floorName: 1,
          propertyFloorId: 501,
          isFullFloor: false,
          dateOffMarket: null,
          isLeasePending: false,
          ...space,
        },
      ],
      ...summary,
    },
    ...header,
  };
}

describe("property normalization", () => {
  it("uses primary address, decodes type and keeps floors and dimensions", () => {
    const p = normalizeProperty(
      {
        id: 200,
        propertyType: 2,
        propertySubtype: 12,
        primaryAddress: {
          city: " Houston ",
          latitude: "29.7",
          longitude: -95.4,
        },
        addresses: [{ latitude: 1 }],
        lotWidthInFeet: 40,
        floors: [{ id: 501, floorName: 1 }],
        propertyRetail: { frontageInFeet: 30 },
      },
      enums,
    );
    expect(p).toMatchObject({
      id: "200",
      city: "Houston",
      latitude: 29.7,
      longitude: -95.4,
      propertyType: "GeneralRetail",
      propertySubtype: "GeneralRetail_Bank",
      retail: true,
    });
    expect(p.data).toMatchObject({
      lotWidthInFeet: 40,
      floors: [{ id: 501, floorName: 1 }],
      propertyRetail: { frontageInFeet: 30 },
      decodedEnums: { "floors[0].floorName": "Ground" },
      provenance: {
        latitude: {
          origin: "costar",
          dataset: "commercial-property",
          recordId: "200",
          field: "primaryAddress.latitude",
        },
      },
    });
  });
  it("includes non-retail properties and leaves unknown coordinates null", () => {
    expect(normalizeProperty({ id: 1, propertyType: 5 }, enums)).toMatchObject({
      retail: false,
      latitude: null,
      longitude: null,
    });
    expect(
      normalizeProperty(
        {
          id: 1,
          propertyType: 9,
          primaryAddress: { latitude: 91, longitude: "" },
        },
        enums,
      ),
    ).toMatchObject({ retail: true, latitude: null, longitude: null });
  });
  it("fails loudly on missing IDs", () => {
    expect(() => normalizeProperty({}, enums)).toThrow(/ID/);
    expect(() => normalizeSpaces({ forLeaseSummary: null }, enums)).toThrow(
      /ID/,
    );
    expect(() => normalizeSpaces(listing({ id: null }), enums)).toThrow(/ID/);
    expect(() =>
      normalizeSpaces(
        listing({ propertyId: null }, {}, { propertyId: null }),
        enums,
      ),
    ).toThrow(/ID/);
  });
});

describe("space normalization", () => {
  it("joins by each space's property, keeps asking rates and converts monthly USD per SF", () => {
    const [s] = normalizeSpaces(listing(), enums);
    expect(s).toMatchObject({
      id: "100:300",
      listingId: "100",
      propertyId: "201",
      active: true,
      retail: true,
      sizeSqFt: 1200,
    });
    expect(s!.data).toMatchObject({
      rateLow: 2,
      rateHigh: 3,
      rateBasis: 1,
      monetaryUnit: 1,
      serviceType: 13,
      askingRentUsdPerSfYearLow: 24,
      askingRentUsdPerSfYearHigh: 36,
      serviceTypeName: "TripleNet",
      position: "Unknown",
      suite: "A",
      floor: "Ground",
      propertyFloorId: 501,
      provenance: {
        askingRentUsdPerSfYearLow: {
          dataset: "commercial-listing-summary",
          recordId: "100",
          field: "forLeaseSummary.spaces[0].rateLow",
        },
      },
    });
    expect(s!.source.field).toBe("forLeaseSummary.spaces[0].id");
    expect(s!.data).not.toHaveProperty("opexUsdPerSfYear");
  });
  it("yearly rates are unchanged regardless of service type", () => {
    expect(
      normalizeSpaces(listing({ rateBasis: 2, serviceType: 7 }), enums)[0]!
        .data,
    ).toMatchObject({
      askingRentUsdPerSfYearLow: 2,
      serviceTypeName: "FullService",
    });
  });
  it.each([
    [{ rateLow: 0 }, {}],
    [{ rateLow: null }, {}],
    [{ rateLow: "" }, {}],
    [{ rateBasis: 0 }, {}],
    [{ monetaryUnit: 0 }, {}],
    [{ monetaryUnit: 2 }, {}],
    [{ monetaryUnit: null }, {}],
    [{ askingRateHasValue: false }, {}],
    [{}, { askingRateMeasurementType: 0 }],
    [{}, { askingRateMeasurementType: null }],
  ])("does not invent a rent for unknown inputs %j %j", (space, summary) => {
    expect(
      normalizeSpaces(listing(space, summary), enums)[0]!.data
        .askingRentUsdPerSfYearLow,
    ).toBeNull();
  });
  it("converts documented per-acre and per-m² rates to per SF", () => {
    expect(
      normalizeSpaces(
        listing(
          { rateLow: 43560, rateBasis: 2 },
          { askingRateMeasurementType: 2 },
        ),
        enums,
      )[0]!.data.askingRentUsdPerSfYearLow,
    ).toBe(1);
    expect(
      normalizeSpaces(
        listing(
          { rateLow: 10.7639104167, rateBasis: 2 },
          { askingRateMeasurementType: 3 },
        ),
        enums,
      )[0]!.data.askingRentUsdPerSfYearLow,
    ).toBeCloseTo(1);
  });
  it.each([
    { dateOffMarket: "2025-01-01" },
    { isLeasePending: true },
    { isInventoryOffMarket: true },
  ])("marks unavailable spaces inactive without dropping them %j", (space) => {
    expect(normalizeSpaces(listing(space), enums)[0]!.active).toBe(false);
  });
  it("marks an off-market listing inactive", () => {
    expect(
      normalizeSpaces(listing({}, {}, { listingStatus: 4 }), enums)[0]!.active,
    ).toBe(false);
  });
  it("supports OfficeRetail, explicit positions and parent-property fallback", () => {
    expect(
      normalizeSpaces(
        listing({ propertyId: null, spaceUse: 3, spacePosition: 3 }),
        enums,
      )[0],
    ).toMatchObject({
      propertyId: "200",
      retail: true,
      data: { position: "EndCap" },
    });
    expect(normalizeSpaces(listing({ spaceUse: 1 }), enums)[0]!.retail).toBe(
      false,
    );
    expect(normalizeSpaces({ id: 1, forLeaseSummary: null }, enums)).toEqual(
      [],
    );
  });
});

describe("current tenancy", () => {
  const tenancy = {
    id: 10,
    propertyId: 200,
    tenantLocationId: 20,
    industryType: 6,
    toDate: null,
    spaces: [{ id: 1, suite: "B", spacePosition: 2 }],
  };
  it("filters closed windows and takes known tenant industry only from company", () => {
    expect(
      normalizeTenancy({ ...tenancy, toDate: "2025-01-01" }, null, enums),
    ).toBeNull();
    const t = normalizeTenancy(
      tenancy,
      { id: 20, name: "Invented Cafe", profile: { industryType: 17 } },
      enums,
    );
    expect(t).toMatchObject({
      id: "10",
      propertyId: "200",
      tenantLocationId: "20",
      data: {
        industry: "AccommodationAndFoodServices",
        tenantName: "Invented Cafe",
        provenance: {
          industry: {
            dataset: "company-detail",
            recordId: "20",
            field: "profile.industryType",
          },
        },
      },
    });
    expect(normalizeTenancy(tenancy, null, enums)!.data.industry).toBeNull();
    expect(
      normalizeTenancy({ ...tenancy, tenantLocationId: null }, null, enums)!
        .data.industry,
    ).toBe("RetailersOrWholesalers");
  });
  it("rejects bad company joins and missing IDs", () => {
    expect(() => normalizeTenancy(tenancy, { id: 21 }, enums)).toThrow(/match/);
    expect(() =>
      normalizeTenancy({ ...tenancy, propertyId: null }, null, enums),
    ).toThrow(/ID/);
  });
});

describe("attachments", () => {
  it("keeps URIs, nested model/unit paths and both Matterport ref types", () => {
    const a = normalizeAttachments(
      {
        id: 200,
        attachments: [
          {
            attachmentMasterId: 1,
            attachmentUri: "https://example.com/photo",
            videoExternalReferenceType: 0,
            videoKey: "not-a-tour",
            dimensions: { width: 100 },
          },
          {
            attachmentMasterId: 2,
            videoExternalReferenceType: 36,
            videoKey: "invented-model",
          },
        ],
        propertyApartment: {
          models: [
            {
              units: [
                {
                  attachments: [
                    {
                      attachmentMasterId: 3,
                      videoExternalReferenceType: 234,
                      videoKey: "invented-stream",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      "commercial-property",
      enums,
    );
    expect(a).toHaveLength(3);
    expect(a[0]).toMatchObject({
      propertyId: "200",
      data: {
        uri: "https://example.com/photo",
        matterportModelId: null,
        dimensions: { width: 100 },
      },
    });
    expect(a[1]!.data.matterportModelId).toBe("invented-model");
    expect(a[2]).toMatchObject({
      data: {
        matterportModelId: "invented-stream",
        provenance: {
          matterportModelId: {
            field:
              "propertyApartment.models[0].units[0].attachments[0].videoKey",
          },
        },
      },
    });
    expect(new Set(a.map((item) => item.id)).size).toBe(3);
  });
  it("keeps listing source and space-level property ownership", () => {
    const a = normalizeAttachments(
      listing({
        floorPlan: {
          attachmentMasterId: 9,
          attachmentUri: "https://example.com/plan",
        },
      }),
      "commercial-listing-summary",
      enums,
    );
    expect(a[0]).toMatchObject({
      propertyId: "201",
      source: {
        dataset: "commercial-listing-summary",
        recordId: "100",
        field: "forLeaseSummary.spaces[0].floorPlan",
      },
    });
    expect(() =>
      normalizeAttachments(
        { id: 1, attachments: [{}] },
        "commercial-property",
        enums,
      ),
    ).toThrow(/ID/);
  });
});
