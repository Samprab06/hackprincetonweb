import type { AssumedFlag, AssumedValue, Candidate } from "../contracts";
import { CandidateSchema } from "../contracts";
import {
  CoStarSourceSchema,
  SiteInventorySchema,
  SiteSearchRequestSchema,
  SiteSearchResultSchema,
  type SiteInventory,
  type SiteSearchRequest,
  type SiteSearchResult,
} from "../contracts/sites";
import type { CoStarSource, RawRecord } from "./costar";

type Property = ReturnType<
  typeof SiteInventorySchema.parse
>["properties"][number];
type Space = ReturnType<typeof SiteInventorySchema.parse>["spaces"][number];
const record = (v: unknown): RawRecord =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as RawRecord)
    : {};
const number = (v: unknown): number | null => {
  if (typeof v !== "number" && (typeof v !== "string" || !v.trim()))
    return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const sourceId = (s: CoStarSource) =>
  `costar:${s.dataset}:${s.recordId}:${s.field}`;
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure deterministic shortlist over normalized HAC-11 rows. No database/provider calls.
 * Size-unknown rows survive bounds with a flag; required unknown features do not.
 * Pass the original request (after validation), so omitted NNN assumptions retain
 * default provenance rather than becoming caller overrides.
 * Rent ceiling applies to base rent. FullService includes opex; other non-NNN
 * service arrangements leave additional opex unknown, rather than implying zero.
 */
export function searchSites(
  requestInput: SiteSearchRequest,
  inventoryInput: SiteInventory,
): SiteSearchResult {
  const request = SiteSearchRequestSchema.parse(requestInput);
  const inventory = SiteInventorySchema.parse(inventoryInput);
  const properties = new Map(inventory.properties.map((p) => [p.id, p]));
  const evidence = new Map<string, SiteSearchResult["evidence"][number]>();
  const scoreEvidenceId = "default-site-prescore-v1";
  evidence.set(scoreEvidenceId, {
    id: scoreEvidenceId,
    origin: "default",
    description:
      "Illustrative deterministic pre-score: rent fit 40, size fit 20, position 15, building frontage 15, anchor cotenants reserved maximum 10 (currently unknown, no credit); not a sales forecast or calibrated demand model.",
    sources: [],
    limitations: [
      "Known monthly base rent sorts ahead of unknown rent, then score descending and stable site ID.",
      "Unknown observations earn no feature or rent bonus.",
    ],
  });
  function ref(
    row:
      | Property
      | Space
      | ReturnType<typeof SiteInventorySchema.parse>["tenancies"][number],
    key: string,
    fallback = key,
  ): string {
    const parsed = CoStarSourceSchema.safeParse(
      record(row.data.provenance)[key],
    );
    // Missing values still reference the source record and expected field, never raw payload.
    const source: CoStarSource = parsed.success
      ? parsed.data
      : { ...row.source, field: fallback };
    const id = sourceId(source);
    evidence.set(id, {
      id,
      origin: "costar",
      description: `Normalized CoStar field ${source.field}; absence remains explicitly unknown.`,
      sources: [source],
      limitations: key.startsWith("propertyRetail.frontage")
        ? [
            "Building-level street frontage does not verify the marketed suite's frontage.",
          ]
        : key.startsWith("parking")
          ? [
              "Building-level parking does not guarantee dedicated spaces for the marketed suite.",
            ]
          : [],
    });
    return id;
  }
  function assumed(
    value: number | null,
    unit: string,
    evidenceIds: string[],
    reason: string,
    origin: AssumedValue["origin"] = "costar",
  ): AssumedValue {
    return {
      value,
      unit,
      origin,
      evidenceIds,
      ...(value === null ? { unknownReason: reason } : {}),
    };
  }
  function flag(
    value: boolean | null,
    evidenceIds: string[],
    reason: string,
  ): AssumedFlag {
    return {
      value,
      unit: "boolean",
      origin: "costar",
      evidenceIds,
      ...(value === null ? { unknownReason: reason } : {}),
    };
  }
  function describe(space: Space, property: Property) {
    const prefix = space.source.field.replace(/id$/, "");
    const sfRef = ref(space, "sizeSqFt", prefix + "squareFeetMax");
    const positionRef = ref(space, "position", prefix + "spacePosition");
    const floorRef = ref(space, "floor", prefix + "floorName");
    const frontageRows = Array.isArray(
      record(property.data.propertyRetail).frontage,
    )
      ? (record(property.data.propertyRetail).frontage as unknown[])
      : [];
    const frontageRefs = frontageRows.map((_, index) =>
      ref(property, `propertyRetail.frontage[${index}].frontageInFeet`),
    );
    if (!frontageRefs.length)
      frontageRefs.push(ref(property, "propertyRetail.frontage"));
    const frontageValues = frontageRows.map((row) =>
      number(record(row).frontageInFeet),
    );
    // Positive observation is sufficient; missing entries cannot establish absence.
    const frontage = frontageValues.some((n) => n !== null && n > 0)
      ? true
      : frontageValues.length > 0 && frontageValues.every((n) => n === 0)
        ? false
        : null;
    const parkingRows = Array.isArray(property.data.parking)
      ? property.data.parking
      : [];
    const parkingRefs = parkingRows.map((_, index) =>
      ref(property, `parking[${index}].totalSpaces`),
    );
    const parkingValues = parkingRows.map((row) =>
      number(record(row).totalSpaces),
    );
    const ratio = number(property.data.parkingRatio);
    parkingRefs.push(ref(property, "parkingRatio"));
    const parking =
      parkingValues.some((n) => n !== null && n > 0) ||
      (ratio !== null && ratio > 0)
        ? true
        : parkingValues.length > 0 &&
            parkingValues.every((n) => n === 0) &&
            (ratio === null || ratio === 0)
          ? false
          : null;
    const position = text(space.data.position);
    const floor = text(space.data.floor);
    const features: Candidate["features"] = {
      groundFloor: flag(
        floor === "Ground"
          ? true
          : !floor ||
              floor === "Unknown" ||
              floor === "UnknownFloor" ||
              floor === "FirstFloor"
            ? null
            : false,
        [floorRef],
        "Marketed space floor is missing or ambiguous; only decoded Ground verifies ground floor and suite is not floor evidence",
      ),
      corner: flag(
        position === "Corner"
          ? true
          : !position || position === "Unknown"
            ? null
            : false,
        [positionRef],
        "Marketed space position is unknown; no suite, floor or lot-width inference",
      ),
      frontage: flag(
        frontage,
        frontageRefs,
        "Building frontage is unknown; property lot width is not frontage evidence",
      ),
      parking: flag(
        parking,
        parkingRefs,
        "Parking count and ratio are unknown",
      ),
    };
    const low = number(space.data.askingRentUsdPerSfYearLow);
    const high = number(space.data.askingRentUsdPerSfYearHigh);
    const rate =
      high !== null && high > 0
        ? Math.max(high, low ?? 0)
        : low !== null && low > 0
          ? low
          : null;
    const rentRefs = [
      ref(space, "askingRentUsdPerSfYearLow", prefix + "rateLow"),
      ref(space, "askingRentUsdPerSfYearHigh", prefix + "rateHigh"),
      sfRef,
      ref(space, "rentNormalizationInputs", prefix + "rateBasis"),
      ref(space, "currency", prefix + "monetaryUnit"),
      ref(
        space,
        "askingRateMeasurementType",
        "forLeaseSummary.askingRateMeasurementType",
      ),
    ];
    const base =
      rate !== null && space.sizeSqFt !== null
        ? Math.round((rate * space.sizeSqFt * 100) / 12)
        : null;
    const flags: string[] = [];
    if (space.sizeSqFt === null) flags.push("size_unknown");
    if (base === null) flags.push("rent_unknown");
    if ((low === null) !== (high === null)) flags.push("rent_single_endpoint");
    if (frontage !== null) flags.push("frontage_building_level");
    if (position === "EndCap") flags.push("endcap_position");
    flags.push("anchor_cotenants_unknown");
    if (features.corner.value === null) flags.push("position_unknown");
    if (features.groundFloor.value === null) flags.push("ground_floor_unknown");
    if (features.frontage.value === null) flags.push("frontage_unknown");
    if (features.parking.value === null) flags.push("parking_unknown");
    const baseRentCents = assumed(
      base,
      "USD cents/month",
      rentRefs,
      "Known USD/SF/year asking rent and floor area are both required",
    );
    const serviceRef = ref(space, "serviceTypeName", prefix + "serviceType");
    const service = text(space.data.serviceTypeName);
    let opexCents: AssumedValue;
    if (service === "TripleNet") {
      const overridden = requestInput.nnnExpenseUsdPerSfYear !== undefined;
      const id = overridden ? "founder-nnn-opex-v1" : "default-nnn-opex-v1";
      evidence.set(id, {
        id,
        origin: overridden ? "founder" : "default",
        description: overridden
          ? `Caller-authored NNN operating expense assumption of $${request.nnnExpenseUsdPerSfYear}/SF/year.`
          : "Illustrative authored NNN operating expense default of $10/SF/year; not CoStar sourced or calibrated.",
        sources: [],
        limitations: [
          "Operating expenses are estimates; actual taxes, insurance and maintenance require verification.",
          "This assumption affects estimated total monthly cost, not canonical base rent.",
        ],
      });
      opexCents = assumed(
        space.sizeSqFt === null
          ? null
          : Math.round(
              (request.nnnExpenseUsdPerSfYear * space.sizeSqFt * 100) / 12,
            ),
        "USD cents/month",
        [id, sfRef, serviceRef],
        "Floor area is required for the NNN operating expense estimate",
        overridden ? "founder" : "default",
      );
      flags.push("nnn_opex_estimated");
      if (overridden) flags.push("nnn_opex_override");
    } else {
      opexCents = assumed(
        service === "FullService" ? 0 : null,
        "USD cents/month",
        [serviceRef],
        "Additional operating expenses are unknown for this lease service arrangement",
      );
      if (opexCents.value === null) flags.push("opex_unknown");
    }
    const totalMonthlyCostCents = assumed(
      base !== null && opexCents.value !== null ? base + opexCents.value : null,
      "USD cents/month",
      [...new Set([...rentRefs, ...opexCents.evidenceIds])],
      "Known base rent and operating expense component are both required",
      service === "TripleNet" ? opexCents.origin : "costar",
    );
    const candidate = CandidateSchema.parse({
      id: space.id,
      projectId: request.profile.projectId,
      synthetic: inventory.synthetic,
      name: text(property.data.buildingName) ?? `CoStar space ${space.id}`,
      address:
        [
          "streetNumber",
          "streetDirection",
          "streetName",
          "streetType",
          "streetSuffix",
        ]
          .map((key) => text(record(property.data.primaryAddress)[key]))
          .filter(Boolean)
          .join(" ") ||
        `Address unavailable — CoStar property ${property.id}, ${property.city}`,
      city: request.profile.city,
      latitude: assumed(
        property.latitude,
        "degrees",
        [ref(property, "latitude", "primaryAddress.latitude")],
        "Latitude is not supplied",
      ),
      longitude: assumed(
        property.longitude,
        "degrees",
        [ref(property, "longitude", "primaryAddress.longitude")],
        "Longitude is not supplied",
      ),
      floorAreaSqFt: assumed(
        space.sizeSqFt,
        "ft2",
        [sfRef],
        "Marketed space floor area is not supplied",
      ),
      monthlyRentCents: baseRentCents,
      availableForLease: flag(
        space.active,
        [
          ref(space, "active", prefix + "dateOffMarket"),
          ref(space, "availabilityInputs", "listingStatus"),
          ref(space, "dateOffMarket", prefix + "dateOffMarket"),
          ref(space, "isLeasePending", prefix + "isLeasePending"),
          ref(space, "isInventoryOffMarket", prefix + "isInventoryOffMarket"),
        ],
        "Availability is unknown",
      ),
      features,
    });
    const ceiling = request.profile.economics.monthlyRentCeilingCents.value;
    const midpoint =
      request.minSizeSqFt !== undefined && request.maxSizeSqFt !== undefined
        ? (request.minSizeSqFt + request.maxSizeSqFt) / 2
        : (request.minSizeSqFt ?? request.maxSizeSqFt);
    const scoreComponents = {
      rentFit:
        base !== null && ceiling !== null && ceiling > 0
          ? 40 * Math.max(0, 1 - base / ceiling)
          : 0,
      sizeFit:
        space.sizeSqFt !== null && midpoint !== undefined
          ? 20 * Math.max(0, 1 - Math.abs(space.sizeSqFt - midpoint) / midpoint)
          : 0,
      position: position === "Corner" || position === "EndCap" ? 15 : 0,
      frontage: features.frontage.value === true ? 15 : 0,
      anchorCotenants: 0, // The licensed schemas do not identify anchors; no inference from names or size.
    };
    const refs = new Set<string>([
      ...rentRefs,
      ...opexCents.evidenceIds,
      ...candidate.latitude.evidenceIds,
      ...candidate.longitude.evidenceIds,
      ...candidate.availableForLease.evidenceIds,
      ...Object.values(features).flatMap((f) => f.evidenceIds),
      ref(property, "buildingName"),
      ...[
        "streetNumber",
        "streetDirection",
        "streetName",
        "streetType",
        "streetSuffix",
      ].map((key) => ref(property, `primaryAddress.${key}`)),
      ref(property, "city", "primaryAddress.city"),
      ref(space, "spaceUse", prefix + "spaceUse"),
      scoreEvidenceId,
    ]);
    const evidenceIds = [...refs].sort(compareId);
    return {
      candidate,
      position,
      propertyId: property.id,
      listingId: space.listingId,
      score:
        Math.round(
          Object.values(scoreComponents).reduce((a, b) => a + b, 0) * 1000,
        ) / 1000,
      scoreComponents,
      scoreEvidenceId,
      baseRentCents,
      opexCents,
      totalMonthlyCostCents,
      flags,
      evidenceIds,
      sources: evidenceIds.flatMap((id) => evidence.get(id)?.sources ?? []),
    };
  }
  const filters: SiteSearchResult["filters"] = [];
  let rows = inventory.spaces;
  function filter(name: string, predicate: (row: Space) => boolean) {
    const before = rows.length;
    rows = rows.filter(predicate);
    filters.push({
      name,
      before,
      removed: before - rows.length,
      after: rows.length,
    });
  }
  filter(
    "city",
    (s) =>
      properties.get(s.propertyId)?.city?.trim().toLowerCase() ===
      request.profile.city.toLowerCase(),
  );
  filter("activeForLease", (s) => s.active);
  filter(
    "retailUse",
    (s) => s.data.spaceUse === "Retail" || s.data.spaceUse === "OfficeRetail",
  );
  filter(
    "size",
    (s) =>
      s.sizeSqFt === null ||
      ((request.minSizeSqFt === undefined ||
        s.sizeSqFt >= request.minSizeSqFt) &&
        (request.maxSizeSqFt === undefined ||
          s.sizeSqFt <= request.maxSizeSqFt)),
  );
  const described = new Map(
    rows.map((s) => [s.id, describe(s, properties.get(s.propertyId)!)]),
  );
  const ceiling = request.profile.economics.monthlyRentCeilingCents.value;
  filter(
    "rentCeiling",
    (s) =>
      ceiling === null ||
      described.get(s.id)!.baseRentCents.value === null ||
      described.get(s.id)!.baseRentCents.value! <= ceiling,
  );
  for (const feature of [
    "groundFloor",
    "corner",
    "frontage",
    "parking",
  ] as const)
    if (request.profile.mustHaves[feature].value === true)
      filter(
        `mustHave.${feature}`,
        (s) =>
          (feature === "corner" &&
            described.get(s.id)!.position === "EndCap") ||
          described.get(s.id)!.candidate.features[feature].value === true,
      );
  const candidates = rows
    .map((s) => described.get(s.id)!)
    .sort(
      (a, b) =>
        Number(b.baseRentCents.value !== null) -
          Number(a.baseRentCents.value !== null) ||
        b.score - a.score ||
        compareId(a.candidate.id, b.candidate.id),
    )
    .slice(0, request.limit);
  const mostRestrictiveFilter =
    filters.reduce<SiteSearchResult["filters"][number] | null>(
      (best, f) => (f.removed > (best?.removed ?? 0) ? f : best),
      null,
    )?.name ?? null;
  // Only return evidence used by returned candidates. Filtering never returns source rows.
  const used = new Set(candidates.flatMap((c) => c.evidenceIds));
  return SiteSearchResultSchema.parse({
    candidates,
    filters,
    mostRestrictiveFilter,
    emptyReason: rows.length
      ? null
      : inventory.spaces.length === 0
        ? "No spaces in inventory"
        : `No sites remain; most restrictive filter: ${mostRestrictiveFilter ?? "inventory"}`,
    totalMatched: rows.length,
    evidence: [...evidence.values()]
      .filter((e) => used.has(e.id))
      .sort((a, b) => compareId(a.id, b.id)),
    modelVersion: "site-prescore-v1",
  });
}
