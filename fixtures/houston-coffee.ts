import type {
  AssumedFlag,
  AssumedValue,
  FixtureBundle,
} from "../lib/contracts";

const evidenceId = "ev-synthetic-default";
const value = (n: number | null, unit: string): AssumedValue => ({
  value: n,
  unit,
  origin: "default",
  evidenceIds: [evidenceId],
  ...(n === null
    ? {
        unknownReason:
          "Not supplied; explicitly unknown in this synthetic fixture",
      }
    : {}),
});
const curve = () => ({
  "0": value(1, "probability"),
  "2": value(0.9, "probability"),
  "4": value(0.7, "probability"),
  "6": value(0.4, "probability"),
  "10": value(0.1, "probability"),
});
const flag = (n: boolean | null): AssumedFlag => ({
  value: n,
  unit: "boolean",
  origin: "default",
  evidenceIds: [evidenceId],
  ...(n === null
    ? { unknownReason: "Not verified in the synthetic fixture" }
    : {}),
});
const unknownFeatures = () => ({
  frontage: flag(null),
  corner: flag(null),
  parking: flag(null),
  groundFloor: flag(null),
});
const base = { projectId: "project-synthetic-houston", synthetic: true };
const candidateIds = [
  "site-synthetic-a",
  "site-synthetic-b",
  "site-synthetic-c",
];
const personaIds = ["persona-commuter", "persona-neighbor"];

export const syntheticHoustonFixture: FixtureBundle = {
  label:
    "Synthetic Houston coffee-shop scenario; not real listings, observed customers, or sponsor findings",
  synthetic: true,
  profile: {
    ...base,
    id: "profile-coffee-v1",
    version: 1,
    businessName: "Synthetic Coffee",
    concept: "Illustrative neighborhood coffee counter",
    category: "coffee",
    city: "Houston",
    preferredAreas: [],
    avoidedAreas: [],
    targetCustomers: ["Synthetic commuters", "Synthetic neighbors"],
    mustHaves: {
      frontage: flag(true),
      corner: flag(false),
      parking: flag(null),
      groundFloor: flag(true),
    },
    objective:
      "Compare illustrative service-business sites under shared assumptions",
    operatingHours: { openMinute: 420, closeMinute: 1080 },
    capacity: {
      servers: value(2, "servers"),
      serviceMinutes: value(4, "minutes/customer"),
    },
    economics: {
      averageTicketCents: value(650, "USD cents/customer"),
      startupBudgetCents: value(10000000, "USD cents"),
      monthlyOperatingBudgetCents: value(null, "USD cents/month"),
      monthlyRentCeilingCents: value(400000, "USD cents/month"),
      buildoutBudgetCents: value(6000000, "USD cents"),
      priceTier: {
        value: "mid",
        unit: "price_tier",
        origin: "default",
        evidenceIds: [evidenceId],
      },
    },
    derivedDefaults: {
      wageRateCentsPerHour: value(null, "USD cents/hour"),
      cogsFraction: value(null, "fraction"),
      travelMinutes: value(null, "minutes"),
      patienceMinutes: value(null, "minutes"),
    },
  },
  candidates: candidateIds.map((id, i) => ({
    ...base,
    id,
    name: `Synthetic candidate ${String.fromCharCode(65 + i)}`,
    address: `Illustrative site ${i + 1}, Houston (not a listing)`,
    city: "Houston",
    latitude: value(29.76 + i * 0.001, "degrees"),
    longitude: value(-95.37 - i * 0.001, "degrees"),
    floorAreaSqFt: value(1200 + i * 200, "ft2"),
    monthlyRentCents: value(300000 + i * 50000, "USD cents/month"),
    availableForLease: flag(null),
    features: unknownFeatures(),
  })),
  catchments: candidateIds.map((siteId, i) => ({
    ...base,
    id: `catchment-${i + 1}`,
    siteId,
    radiusMeters: value(1000, "meters"),
    residentPopulation: value(5000 + i * 500, "people"),
    daytimeWorkers: value(null, "people"),
    competitors: [
      {
        id: `competitor-${i + 1}`,
        name: "Synthetic competitor",
        category: "coffee",
        distanceMeters: value(300, "meters"),
      },
    ],
  })),
  personaSet: {
    ...base,
    id: "personas-v1",
    profileId: "profile-coffee-v1",
    version: 1,
    personas: personaIds.map((id, i) => ({
      id,
      label: i === 0 ? "Synthetic commuter" : "Synthetic neighbor",
      weight: value(i === 0 ? 0.6 : 0.4, "share"),
      budgetCents: value(1000, "USD cents/visit"),
      timePreference: i === 0 ? "morning" : "afternoon",
    })),
  },
  behaviorTable: {
    ...base,
    id: "behavior-a-v1",
    siteId: candidateIds[0],
    personaSetId: "personas-v1",
    demandSource: "huff",
    modelVersion: "synthetic-fixture-v1",
    personas: personaIds.map((personaId, i) => ({
      personaId,
      where: [
        { destinationId: candidateIds[0], share: value(0.5, "share") },
        { destinationId: "competitor-1", share: value(0.3, "share") },
        { destinationId: "none", share: value(0.2, "share") },
      ],
      expectedMonthlyVisits: value(i === 0 ? 12 : 8, "visits/person/month"),
      timeBlockDistribution: {
        earlyMorning: value(0.1, "share"),
        morning: value(0.4, "share"),
        midday: value(0.2, "share"),
        afternoon: value(0.2, "share"),
        evening: value(0.1, "share"),
      },
      stayProbabilityByLineLength: curve(),
      priceAcceptance: value(0.8, "probability"),
      confidence: value(0.2, "probability"),
      jevModelVersion: null,
      cacheKey: null,
    })),
  },
  arrivalSchedule: {
    ...base,
    id: "arrivals-a-weekday-seed1",
    siteId: candidateIds[0],
    behaviorTableId: "behavior-a-v1",
    dayType: "weekday",
    seed: 1,
    modelVersion: "synthetic-fixture-v1",
    demandSource: "huff",
    parameters: {
      arrivalRatePerHour: value(12, "customers/hour"),
      serviceMinutes: value(4, "minutes/customer"),
      ticketCents: value(650, "USD cents/customer"),
    },
    customers: [
      {
        customerId: "customer-1",
        personaId: personaIds[0],
        arrivalMinute: 425,
        stayDraw: 0.2,
        serviceMinutes: 4,
        ticketCents: 650,
      },
      {
        customerId: "customer-2",
        personaId: personaIds[1],
        arrivalMinute: 430,
        stayDraw: 0.7,
        serviceMinutes: 5,
        ticketCents: 700,
      },
    ],
    stayProbabilityByPersona: personaIds.map((personaId) => ({
      personaId,
      curve: curve(),
    })),
  },
  evidence: [
    {
      ...base,
      id: evidenceId,
      origin: "default",
      sourceLabel: "Synthetic fixture assumptions",
      sourceUrl: null,
      description:
        "All figures and identities are illustrative defaults for contract and UI development, not measured demand or actual property information.",
      observedAt: null,
      retrievedAt: "2026-11-14T03:44:00.000Z",
      limitations: [
        "Not a sales forecast",
        "No CoStar, Matterport, Vexcel, Census or Jev observation is claimed",
      ],
    },
  ],
};
