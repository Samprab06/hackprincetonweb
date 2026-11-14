import { describe, expect, it } from "vitest";
import {
  ACS_VARIABLES,
  blockCoordinate,
  normalizeAcs,
  normalizeLodes,
  normalizePlace,
  type PublicSource,
} from "./public";

const source: PublicSource = {
  origin: "public",
  dataset: "synthetic",
  url: "https://example.test/data",
  retrievedAt: "2026-11-14T00:00:00Z",
  vintage: "2023",
};
const headers = [
  "NAME",
  ...ACS_VARIABLES,
  "state",
  "county",
  "tract",
  "block group",
];
function acs(overrides: Record<string, unknown> = {}) {
  const row = {
    ...Object.fromEntries(ACS_VARIABLES.map((key) => [key, "1"])),
    NAME: "Test block group",
    state: "06",
    county: "037",
    tract: "001001",
    "block group": "2",
    ...overrides,
  };
  return [headers, headers.map((key) => row[key as keyof typeof row])];
}

describe("ACS normalization", () => {
  it("requests exactly 49 unique estimates and forms zero-preserving block-group GEOIDs", () => {
    expect(ACS_VARIABLES).toHaveLength(49);
    expect(new Set(ACS_VARIABLES).size).toBe(49);
    const [row] = normalizeAcs(
      acs({ B01003_001E: "0", B11001_001E: "25", B19013_001E: "52000" }),
      source,
    );
    expect(row).toMatchObject({
      geoid: "060370010012",
      countyFips: "06037",
      population: 0,
      households: 25,
      medianHouseholdIncome: 52000,
      source,
    });
    expect(row!.data.ageBands).toEqual({
      "0-17": 8,
      "18-34": 12,
      "35-54": 8,
      "55-64": 6,
      "65+": 12,
    });
  });
  it.each(["-666666666", "-999999999", "", "NaN", "Infinity", "12junk", null])(
    "keeps missing/suppressed estimates unknown: %s",
    (value) => {
      const [row] = normalizeAcs(
        acs({ B01003_001E: value, B01001_003E: value }),
        source,
      );
      expect(row!.population).toBeNull();
      expect(row!.data.ageBands).toMatchObject({ "0-17": null, "18-34": 12 });
    },
  );
  it("parses optional margins without conflating them with estimates", () => {
    const table = acs();
    table[0]!.push("B19013_001M");
    table[1]!.push("123");
    expect(normalizeAcs(table, source)[0]!.data.estimates).toMatchObject({
      B19013_001M: 123,
    });
  });
  it.each([
    null,
    [],
    {},
    [["state"]],
    [headers, ["bad"]],
    acs({ county: "37" }),
    acs({ tract: "abcdef" }),
    acs({ state: 6 }),
  ])("rejects malformed tables and geography", (table) => {
    expect(() => normalizeAcs(table, source)).toThrow();
  });
  it("allows a valid header-only response", () =>
    expect(normalizeAcs([headers], source)).toEqual([]));
});

describe("LODES normalization", () => {
  it("preserves counts, zero jobs and unknown categories", () => {
    const row = normalizeLodes(
      {
        w_geocode: "060370010012001",
        C000: "0",
        CA01: "3",
        CA02: "",
        CA03: "-1",
        CE01: "5",
        CE02: "not available",
        CS01: "7",
      },
      source,
    );
    expect(row).toMatchObject({
      geoid: "060370010012001",
      countyFips: "06037",
      jobs: 0,
      source,
    });
    expect(row.data.counts).toMatchObject({
      C000: 0,
      CA01: 3,
      CA02: null,
      CA03: null,
      CS01: 7,
    });
    expect(row.data.monthlyEarningsBands).toEqual({
      "1250-or-less": 5,
      "1251-3333": null,
      "over-3333": null,
    });
    expect(normalizeLodes({ w_geocode: row.geoid }, source).jobs).toBeNull();
  });
  it("requires an intact 15-digit workplace GEOID", () =>
    expect(() =>
      normalizeLodes({ w_geocode: "60370010012001" }, source),
    ).toThrow());
  it("uses joined current xwalk county instead of the historical block prefix", () => {
    expect(
      normalizeLodes(
        { w_geocode: "090010001001001", C000: "1" },
        source,
        "09110",
      ).countyFips,
    ).toBe("09110");
    expect(() =>
      normalizeLodes({ w_geocode: "090010001001001" }, source, "9110"),
    ).toThrow();
  });
  it("reads documented LODES8 WAC2024 crosswalk coordinate columns preferentially", () => {
    expect(
      blockCoordinate({
        tabblk2020: "060370010012001",
        cty: "06037",
        blklatdd: "34.05",
        blklondd: "-118.25",
        blklat: "0",
        blklon: "0",
      }),
    ).toEqual({
      geoid: "060370010012001",
      latitude: 34.05,
      longitude: -118.25,
    });
    expect(
      blockCoordinate({
        tabblk2020: "060370010012001",
        blklatdd: "",
        blklondd: "-118.25",
      }),
    ).toBeNull();
  });
  it.each(["tabblk2020", "tabblk2010"])(
    "accepts documented %s xwalk coordinates",
    (field) => {
      expect(
        blockCoordinate({
          [field]: "060370010012001",
          blklat: "34.05",
          blklon: "-118.25",
        }),
      ).toEqual({
        geoid: "060370010012001",
        latitude: 34.05,
        longitude: -118.25,
      });
    },
  );
  it.each([
    { blklat: "", blklon: "0" },
    { blklat: "91", blklon: "0" },
    { blklat: "0", blklon: "Infinity" },
    { blklat: "0", blklon: "181" },
  ])("skips invalid coordinates", (point) => {
    expect(
      blockCoordinate({ tabblk2020: "060370010012001", ...point }),
    ).toBeNull();
  });
});

const place = {
  id: "place-1",
  names: { primary: "Local cafe" },
  categories: { primary: "coffee_shop" },
  geometry: { type: "Point", coordinates: [-118.25, 34.05] },
  sources: [
    {
      dataset: "upstream",
      license: "retained-license",
      record_id: "123",
      url: "https://example.test/original",
    },
  ],
};
describe("Overture Places normalization", () => {
  it("normalizes pinned 2026-10-21.0 v2 taxonomy while retaining unknown upstream licensing", () => {
    const current = {
      id: "v2",
      names: { primary: "Current cafe" },
      taxonomy: {
        primary: "specialty_cafe",
        hierarchy: ["restaurant", "casual_eatery", "coffee_shop"],
        alternates: [],
      },
      basic_category: "restaurant",
      confidence: 0.9,
      operating_status: "open",
      geometry: place.geometry,
      sources: [
        {
          dataset: "unknown-upstream",
          license: "unknown-license-label",
          record_id: "abc",
          update_time: "2026-10-01T00:00:00Z",
        },
      ],
    };
    expect(normalizePlace(current, source)).toMatchObject({
      category: "coffee",
      name: "Current cafe",
      data: current,
    });
    expect(normalizePlace(current, source)!.data.sources).toEqual(
      current.sources,
    );
  });
  it.each([
    ["casual_eatery", "quick_food"],
    ["nail_salon", "salon"],
    ["fitness_studio", "fitness"],
    ["boxing_gym", "fitness"],
    ["rock_climbing_gym", "fitness"],
  ])("maps v2 hierarchy descendant %s", (label, expected) => {
    expect(
      normalizePlace(
        {
          ...place,
          categories: undefined,
          taxonomy: {
            primary: "specific_descendant",
            hierarchy: ["business", label],
            alternates: [],
          },
        },
        source,
      )?.category,
    ).toBe(expected);
  });
  it("supports v2 alternates and basic category fallback", () => {
    expect(
      normalizePlace(
        {
          ...place,
          categories: undefined,
          taxonomy: { alternates: ["barber"] },
        },
        source,
      )?.category,
    ).toBe("salon");
    expect(
      normalizePlace(
        { ...place, categories: undefined, basic_category: "gym" },
        source,
      )?.category,
    ).toBe("fitness");
  });
  it("rejects permanently closed places, retaining unknown status without fabrication", () => {
    expect(
      normalizePlace(
        { ...place, operating_status: "permanently_closed" },
        source,
      ),
    ).toBeNull();
    expect(
      normalizePlace({ ...place, operating_status: "unknown" }, source)!.data
        .operating_status,
    ).toBe("unknown");
    expect(normalizePlace(place, source)!.data).not.toHaveProperty(
      "operating_status",
    );
  });
  it("retains original names, categories and source licenses/URLs", () => {
    const result = normalizePlace(place, source);
    expect(result).toMatchObject({
      id: "place-1",
      name: "Local cafe",
      category: "coffee",
      latitude: 34.05,
      longitude: -118.25,
      source,
    });
    expect(result!.data).toEqual(place);
  });
  it.each([
    ["cafe", "coffee"],
    ["fast_food", "quick_food"],
    ["pizza_restaurant", "quick_food"],
    ["barber", "salon"],
    ["beauty_salon", "salon"],
    ["gym", "fitness"],
    ["yoga_studio", "fitness"],
  ])("maps exact category %s", (primary, expected) => {
    expect(
      normalizePlace({ ...place, categories: { primary } }, source)?.category,
    ).toBe(expected);
  });
  it("supports main and alternate labels and unnamed records", () => {
    expect(
      normalizePlace(
        {
          ...place,
          names: null,
          categories: { main: "office", alternate: ["hair_salon"] },
        },
        source,
      ),
    ).toMatchObject({ name: null, category: "salon" });
  });
  it.each([
    "office",
    "coffee_office",
    "salon_supply_wholesaler",
    "__proto__",
    "constructor",
  ])("does not guess from category %s", (primary) =>
    expect(
      normalizePlace({ ...place, categories: { primary } }, source),
    ).toBeNull(),
  );
  it.each([
    null,
    { type: "Polygon", coordinates: [] },
    { type: "Point", coordinates: ["-118", 34] },
    { type: "Point", coordinates: [181, 0] },
    { type: "Point", coordinates: [0, NaN] },
  ])("skips malformed/non-point geometry", (geometry) =>
    expect(normalizePlace({ ...place, geometry }, source)).toBeNull(),
  );
  it("requires a nonempty source ID", () =>
    expect(normalizePlace({ ...place, id: "" }, source)).toBeNull());
});
