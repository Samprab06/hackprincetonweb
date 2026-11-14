/**
 * Census ACS / LEHD: US government public-domain data; attribution is retained,
 * and use does not imply Census endorsement. Overture Places licensing varies:
 * Foursquare Apache-2.0, AllThePlaces CC0, other sources per the CDLA registry.
 * Original upstream dataset/license attribution is retained verbatim in `data`.
 * These pure adapters perform no downloads and never invent missing counts.
 */
export type PublicSource = {
  origin: "public";
  dataset: string;
  url: string;
  retrievedAt: string;
  vintage: string;
};

export type RawRow = Record<string, string>;

const ageVariable = (index: number) =>
  `B01001_${String(index).padStart(3, "0")}E`;
const range = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);

/** 49 estimates; adding NAME keeps a Census API request at its 50-field limit. */
export const ACS_VARIABLES: readonly string[] = Object.freeze([
  "B01003_001E",
  "B11001_001E",
  "B19013_001E",
  ...range(3, 25).map(ageVariable),
  ...range(27, 49).map(ageVariable),
]);

function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (
    typeof value === "string" &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
  )
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function count(value: unknown): number | null {
  const n = numeric(value);
  return n !== null && n >= 0 ? n : null;
}

function geoid(value: unknown, length: number): string {
  if (
    typeof value !== "string" ||
    !new RegExp(`^\\d{${length}}$`).test(value)
  ) {
    throw new Error(`Expected a ${length}-digit Census GEOID`);
  }
  return value;
}

function completeSum(values: (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null;
  const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return Number.isFinite(sum) ? sum : null;
}

export function normalizeAcs(table: unknown, source: PublicSource) {
  if (!Array.isArray(table) || !Array.isArray(table[0]))
    throw new Error("Malformed ACS table: missing header");
  const headers: unknown[] = table[0];
  if (
    !headers.every((h): h is string => typeof h === "string") ||
    new Set(headers).size !== headers.length
  ) {
    throw new Error("Malformed ACS table: invalid headers");
  }
  for (const field of [
    "state",
    "county",
    "tract",
    "block group",
    "B01003_001E",
    "B11001_001E",
    "B19013_001E",
  ]) {
    if (!headers.includes(field))
      throw new Error(`Malformed ACS table: missing ${field}`);
  }
  return table.slice(1).map((values: unknown) => {
    if (
      !Array.isArray(values) ||
      values.length !== headers.length ||
      !values.every((v) => v === null || typeof v === "string")
    ) {
      throw new Error("Malformed ACS table: invalid row");
    }
    const row: Record<string, unknown> = Object.fromEntries(
      headers.map((h, i) => [h, values[i]]),
    );
    const id = [
      geoid(row.state, 2),
      geoid(row.county, 3),
      geoid(row.tract, 6),
      geoid(row["block group"], 1),
    ].join("");
    const estimates = Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => /^B\d{5}_\d{3}[EM]$/.test(key))
        .map(([key, value]) => [key, count(value)]),
    );
    const bands = [
      ["0-17", 3, 6, 27, 30],
      ["18-34", 7, 12, 31, 36],
      ["35-54", 13, 16, 37, 40],
      ["55-64", 17, 19, 41, 43],
      ["65+", 20, 25, 44, 49],
    ] as const;
    const ageBands = Object.fromEntries(
      bands.map(([label, m0, m1, f0, f1]) => [
        label,
        completeSum(
          [...range(m0, m1), ...range(f0, f1)].map((i) =>
            count(row[ageVariable(i)]),
          ),
        ),
      ]),
    );
    const data: Record<string, unknown> = {
      name: row.NAME ?? null,
      estimates,
      ageBands,
    };
    return {
      geoid: id,
      countyFips: id.slice(0, 5),
      population: count(row.B01003_001E),
      households: count(row.B11001_001E),
      medianHouseholdIncome: count(row.B19013_001E),
      data,
      source,
    };
  });
}

/**
 * Current county membership comes from the joined LODES xwalk `cty`, NOT the
 * 2020 block prefix. Supply it here, or override countyFips before persistence.
 * Without it countyFips is only the historical GEOID prefix.
 */
export function normalizeLodes(
  row: RawRow,
  source: PublicSource,
  currentCountyFips?: string,
) {
  const id = geoid(row.w_geocode, 15);
  const counts = Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => /^C[A-Z0-9]+$/.test(key))
      .map(([key, value]) => [key, count(value)]),
  );
  const data: Record<string, unknown> = {
    counts,
    ageBands: {
      "29-and-under": count(row.CA01),
      "30-54": count(row.CA02),
      "55+": count(row.CA03),
    },
    monthlyEarningsBands: {
      "1250-or-less": count(row.CE01),
      "1251-3333": count(row.CE02),
      "over-3333": count(row.CE03),
    },
  };
  return {
    geoid: id,
    countyFips:
      currentCountyFips === undefined
        ? id.slice(0, 5)
        : geoid(currentCountyFips, 5),
    jobs: count(row.C000),
    data,
    source,
  };
}

export function blockCoordinate(
  row: RawRow,
): { geoid: string; latitude: number; longitude: number } | null {
  const id = row.tabblk2020 ?? row.tabblk2010;
  const latitude = numeric(row.blklatdd ?? row.blklat);
  const longitude = numeric(row.blklondd ?? row.blklon);
  if (
    !id ||
    !/^\d{15}$/.test(id) ||
    latitude === null ||
    longitude === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  return { geoid: id, latitude, longitude };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const categoryMap: Readonly<Record<string, string>> = {
  coffee_shop: "coffee",
  cafe: "coffee",
  restaurant: "quick_food",
  casual_eatery: "quick_food",
  fast_food: "quick_food",
  fast_food_restaurant: "quick_food",
  pizza: "quick_food",
  pizza_restaurant: "quick_food",
  sandwich_shop: "quick_food",
  burger_restaurant: "quick_food",
  hair_salon: "salon",
  barber: "salon",
  barber_shop: "salon",
  beauty_salon: "salon",
  nail_salon: "salon",
  fitness_center: "fitness",
  gym: "fitness",
  yoga_studio: "fitness",
  fitness_studio: "fitness",
  boxing_gym: "fitness",
  rock_climbing_gym: "fitness",
};

/** Shared with the one-off Parquet extractor so supported labels are not lost. */
export const PLACE_CATEGORY_LABELS: readonly string[] = Object.freeze(
  Object.keys(categoryMap),
);

export function normalizePlace(
  record: Record<string, unknown>,
  source: PublicSource,
) {
  if (record.operating_status === "permanently_closed") return null;
  const geometry = object(record.geometry);
  const coordinates = geometry.coordinates;
  if (
    geometry.type !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2
  )
    return null;
  const [longitude, latitude] = coordinates;
  if (
    typeof longitude !== "number" ||
    typeof latitude !== "number" ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  )
    return null;
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  const categories = object(record.categories);
  const taxonomy = object(record.taxonomy);
  // v2 hierarchy identifies descendants of supported categories without fuzzy
  // substring matches. Keep pre-v2 aliases for older cached imports.
  const labels = [
    taxonomy.primary,
    ...(Array.isArray(taxonomy.hierarchy) ? taxonomy.hierarchy : []),
    ...(Array.isArray(taxonomy.alternates) ? taxonomy.alternates : []),
    record.basic_category,
    categories.primary,
    categories.main,
    ...(Array.isArray(categories.alternate) ? categories.alternate : []),
  ];
  const mapped = labels.flatMap((label) =>
    typeof label === "string" && Object.hasOwn(categoryMap, label)
      ? [categoryMap[label]!]
      : [],
  );
  const category = mapped.includes("coffee") ? "coffee" : mapped[0];
  if (!category) return null;
  const primaryName = object(record.names).primary;
  const data: Record<string, unknown> = { ...record };
  return {
    id: record.id,
    name: typeof primaryName === "string" ? primaryName : null,
    category,
    longitude,
    latitude,
    data,
    source,
  };
}
