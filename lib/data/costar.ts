/** Pure normalization of the licensed kit. No file, network, or database access. */
export type RawRecord = Record<string, unknown>;
export type EnumLookup = Record<string, Record<string, string>>;
export type CoStarSource = {
  origin: "costar";
  dataset: string;
  recordId: string;
  field: string;
};

function object(value: unknown): RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function rows(value: unknown): RawRecord[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Expected a record array");
  return value.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      throw new Error("Expected a record object");
    return item as RawRecord;
  });
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function id(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  const s = text(value);
  if (s && !/^(0|-[0-9]+)$/.test(s)) return s;
  throw new Error(`Missing or invalid required ID: ${field}`);
}

function decode(
  enums: EnumLookup,
  type: string,
  value: unknown,
): string | null {
  return value == null ? null : (enums[type]?.[String(value)] ?? null);
}

function source(
  dataset: string,
  recordId: string,
  field: string,
): CoStarSource {
  return { origin: "costar", dataset, recordId, field };
}

/** Keep raw fields, a decoded enum view, and exact paths (including array indexes). */
function dataBuilder(
  raw: RawRecord,
  dataset: string,
  recordId: string,
  enums: EnumLookup,
  prefix = "",
) {
  const provenance: Record<string, CoStarSource> = {};
  const decodedEnums: Record<string, string> = {};
  function walk(value: unknown, path: string, key: string) {
    provenance[path] = source(dataset, recordId, path);
    if (Array.isArray(value))
      value.forEach((v, i) => walk(v, `${path}[${i}]`, key));
    else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value))
        walk(v, path ? `${path}.${k}` : k, k);
    } else {
      const type = key.charAt(0).toUpperCase() + key.slice(1);
      const label = decode(enums, type, value);
      if (label !== null) decodedEnums[path] = label;
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    walk(value, prefix + key, key);
    provenance[key] = source(dataset, recordId, prefix + key);
  }
  const data: RawRecord = { ...raw, decodedEnums, provenance };
  function set(
    key: string,
    value: unknown,
    field: string,
    origin = source(dataset, recordId, field),
  ) {
    data[key] = value;
    provenance[key] = origin;
  }
  return { data, set };
}

export function normalizeProperty(record: RawRecord, enums: EnumLookup) {
  const dataset = "commercial-property";
  const recordId = id(record.id, "commercial-property.id");
  const address = object(record.primaryAddress);
  const city = text(address.city);
  const lat = number(address.latitude);
  const lng = number(address.longitude);
  const latitude = lat !== null && Math.abs(lat) <= 90 ? lat : null;
  const longitude = lng !== null && Math.abs(lng) <= 180 ? lng : null;
  const propertyType = decode(enums, "PropertyType", record.propertyType);
  const propertySubtype = decode(
    enums,
    "PropertySubtype",
    record.propertySubtype,
  );
  const retail =
    propertyType === "GeneralRetail" || propertyType === "MixedUse";
  const { data, set } = dataBuilder(record, dataset, recordId, enums);
  for (const [key, value, field] of [
    ["id", recordId, "id"],
    ["city", city, "primaryAddress.city"],
    ["latitude", latitude, "primaryAddress.latitude"],
    ["longitude", longitude, "primaryAddress.longitude"],
    ["propertyType", propertyType, "propertyType"],
    ["propertySubtype", propertySubtype, "propertySubtype"],
    ["retail", retail, "propertyType"],
  ] as const)
    set(key, value, field);
  return {
    id: recordId,
    city,
    latitude,
    longitude,
    propertyType,
    propertySubtype,
    retail,
    data,
    source: source(dataset, recordId, "id"),
  };
}

export function normalizeSpaces(listing: RawRecord, enums: EnumLookup) {
  const dataset = "commercial-listing-summary";
  const listingId = id(listing.id, "commercial-listing-summary.id");
  const summary = object(listing.forLeaseSummary);
  return rows(summary.spaces).map((space, index) => {
    const spaceId = id(space.id, `forLeaseSummary.spaces[${index}].id`);
    const prefix = `forLeaseSummary.spaces[${index}].`;
    const propertyField =
      space.propertyId == null ? "propertyId" : prefix + "propertyId";
    const propertyId = id(
      space.propertyId ?? listing.propertyId,
      propertyField,
    );
    const active =
      Number(listing.listingStatus) === 1 &&
      space.dateOffMarket == null &&
      space.isLeasePending !== true &&
      space.isInventoryOffMarket !== true;
    const spaceUse = decode(enums, "SpaceUse", space.spaceUse);
    const retail = spaceUse === "Retail" || spaceUse === "OfficeRetail";
    const sf = number(space.squareFeetMax);
    const sizeSqFt = sf !== null && sf > 0 ? sf : null;
    // The kit has no position on marketed spaces: never infer inline from suite/floor.
    const position =
      decode(enums, "SpacePosition", space.spacePosition) ?? "Unknown";
    const { data, set } = dataBuilder(space, dataset, listingId, enums, prefix);
    set("id", `${listingId}:${spaceId}`, prefix + "id");
    set("listingId", listingId, "id");
    set("propertyId", propertyId, propertyField);
    set("active", active, prefix + "dateOffMarket");
    set(
      "listingStatus",
      decode(enums, "ListingStatus", listing.listingStatus),
      "listingStatus",
    );
    set("retail", retail, prefix + "spaceUse");
    set("spaceUse", spaceUse, prefix + "spaceUse");
    set("sizeSqFt", sizeSqFt, prefix + "squareFeetMax");
    set("position", position, prefix + "spacePosition");
    set(
      "floor",
      decode(enums, "FloorName", space.floorName),
      prefix + "floorName",
    );
    set(
      "serviceTypeName",
      decode(enums, "ServiceType", space.serviceType),
      prefix + "serviceType",
    );
    set(
      "rateBasisName",
      decode(enums, "RateBasis", space.rateBasis),
      prefix + "rateBasis",
    );
    set(
      "currency",
      decode(enums, "MonetaryUnit", space.monetaryUnit),
      prefix + "monetaryUnit",
    );
    set(
      "askingRateMeasurementType",
      summary.askingRateMeasurementType ?? null,
      "forLeaseSummary.askingRateMeasurementType",
    );
    const measurement = Number(summary.askingRateMeasurementType);
    // Per-acre and per-m² rates convert to per-SF; never treat an unknown unit as SF.
    const divisor =
      measurement === 1
        ? 1
        : measurement === 2
          ? 43560
          : measurement === 3
            ? 10.7639104167
            : null;
    const basis = Number(space.rateBasis);
    const multiplier = basis === 1 ? 12 : basis === 2 ? 1 : null;
    for (const end of ["Low", "High"] as const) {
      const rate = number(space[`rate${end}`]);
      const annual =
        rate !== null &&
        rate > 0 &&
        Number(space.monetaryUnit) === 1 &&
        divisor !== null &&
        multiplier !== null &&
        space.askingRateHasValue !== false
          ? (rate * multiplier) / divisor
          : null;
      set(`askingRentUsdPerSfYear${end}`, annual, prefix + `rate${end}`);
    }
    // Record all inputs to derived decisions, not just the rate/date itself.
    set(
      "rentNormalizationInputs",
      {
        rateBasis: space.rateBasis ?? null,
        monetaryUnit: space.monetaryUnit ?? null,
        askingRateMeasurementType: summary.askingRateMeasurementType ?? null,
      },
      prefix + "rateBasis",
    );
    set(
      "availabilityInputs",
      {
        listingStatus: listing.listingStatus ?? null,
        dateOffMarket: space.dateOffMarket ?? null,
        isLeasePending: space.isLeasePending ?? null,
        isInventoryOffMarket: space.isInventoryOffMarket ?? null,
      },
      "listingStatus",
    );
    return {
      id: `${listingId}:${spaceId}`,
      listingId,
      propertyId,
      active,
      retail,
      sizeSqFt,
      data,
      source: source(dataset, listingId, prefix + "id"),
    };
  });
}

export function normalizeTenancy(
  record: RawRecord,
  company: RawRecord | null,
  enums: EnumLookup,
) {
  const dataset = "location-occupancy";
  const recordId = id(record.id, "location-occupancy.id");
  const propertyId = id(record.propertyId, "location-occupancy.propertyId");
  if (record.toDate != null) return null;
  const tenantLocationId =
    record.tenantLocationId == null
      ? null
      : id(record.tenantLocationId, "tenantLocationId");
  if (company && id(company.id, "company-detail.id") !== tenantLocationId)
    throw new Error("Company does not match tenantLocationId");
  const { data, set } = dataBuilder(record, dataset, recordId, enums);
  set("id", recordId, "id");
  set("propertyId", propertyId, "propertyId");
  set("tenantLocationId", tenantLocationId, "tenantLocationId");
  set("current", true, "toDate");
  const industry = company
    ? object(company.profile).industryType
    : tenantLocationId === null
      ? record.industryType
      : null;
  set(
    "industry",
    decode(enums, "IndustryType", industry),
    "industryType",
    company
      ? source("company-detail", tenantLocationId!, "profile.industryType")
      : source(dataset, recordId, "industryType"),
  );
  if (company) {
    set(
      "company",
      dataBuilder(company, "company-detail", tenantLocationId!, enums).data,
      "tenantLocationId",
      source("company-detail", tenantLocationId!, "id"),
    );
    set(
      "tenantName",
      text(company.name) ?? text(object(company.profile).companyName),
      "name",
      source(
        "company-detail",
        tenantLocationId!,
        text(company.name) ? "name" : "profile.companyName",
      ),
    );
  } else set("tenantName", null, "tenantLocationId");
  return {
    id: recordId,
    propertyId,
    tenantLocationId,
    data,
    source: source(dataset, recordId, "id"),
  };
}

export function normalizeAttachments(
  record: RawRecord,
  dataset: "commercial-property" | "commercial-listing-summary",
  enums: EnumLookup,
) {
  const recordId = id(record.id, `${dataset}.id`);
  const propertyId =
    dataset === "commercial-property"
      ? recordId
      : record.propertyId == null
        ? null
        : id(record.propertyId, "propertyId");
  const result: {
    id: string;
    propertyId: string | null;
    data: RawRecord;
    source: CoStarSource;
  }[] = [];
  function visit(value: unknown, path: string, owner: string | null) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`, owner));
      return;
    }
    if (value === null || typeof value !== "object") return;
    const obj = value as RawRecord;
    if (obj.propertyId != null)
      owner = id(obj.propertyId, path + ".propertyId");
    if (/^forLeaseSummary\.properties\[\d+\]$/.test(path))
      owner = id(obj.id, path + ".id");
    if (/(attachments\[\d+\]|floorPlan|primaryPhoto)$/.test(path)) {
      const attachmentId = id(
        obj.attachmentMasterId ?? obj.id,
        path + ".attachmentMasterId",
      );
      const { data, set } = dataBuilder(
        obj,
        dataset,
        recordId,
        enums,
        path + ".",
      );
      const matterport =
        Number(obj.videoExternalReferenceType) === 36 ||
        Number(obj.videoExternalReferenceType) === 234;
      set(
        "attachmentId",
        attachmentId,
        path + (obj.attachmentMasterId != null ? ".attachmentMasterId" : ".id"),
      );
      set("uri", text(obj.attachmentUri), path + ".attachmentUri");
      set(
        "matterportModelId",
        matterport ? text(obj.videoKey) : null,
        path + ".videoKey",
      );
      set(
        "externalReferenceType",
        decode(enums, "ExternalReferenceType3", obj.videoExternalReferenceType),
        path + ".videoExternalReferenceType",
      );
      result.push({
        id: `${dataset}:${recordId}:${path}:${attachmentId}`,
        propertyId: owner,
        data,
        source: source(dataset, recordId, path),
      });
      return;
    }
    for (const [key, child] of Object.entries(obj))
      visit(child, path ? `${path}.${key}` : key, owner);
  }
  visit(record, "", propertyId);
  return result;
}
