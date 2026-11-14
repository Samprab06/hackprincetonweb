/**
 * Fixture catchment, sites and behavior tables for HAC-18 tests, until HAC-9 ships shared
 * fixtures and HAC-15 produces real PersonaSets and BehaviorTables. Houston, Montrose area.
 */
import type {
  BehaviorTable,
  DemandInput,
  LatLng,
  Persona,
  PersonaBehavior,
  PersonaSet,
  Storefront,
} from "./contracts";
import { ASKED_LINE_LENGTHS } from "./contracts";

export const CENTER: LatLng = { lat: 29.7425, lng: -95.39 };

/** Point `eastKm` east and `northKm` north of `from`. */
export function offsetKm(from: LatLng, eastKm: number, northKm: number): LatLng {
  return {
    lat: from.lat + northKm / 110.574,
    lng: from.lng + eastKm / (111.32 * Math.cos((from.lat * Math.PI) / 180)),
  };
}

export function makePersona(
  id: string,
  kind: Persona["kind"],
  eastKm: number,
  northKm: number,
  overrides: Partial<Persona> = {},
): Persona {
  return {
    id,
    segment: kind === "resident" ? "resident_mid_income" : kind,
    weight: 400,
    kind,
    location: offsetKm(CENTER, eastKm, northKm),
    commuteMode: "drive",
    incomeUsd: 75_000,
    age: 35,
    hasKids: false,
    description: `${kind} ${eastKm.toFixed(1)}km E ${northKm.toFixed(1)}km N`,
    ...overrides,
  };
}

export const FIXTURE_PERSONAS: Persona[] = [
  makePersona("c1-res-01", "resident", 0.3, 0.2, { weight: 600, commuteMode: "walk" }),
  makePersona("c1-res-02", "resident", -0.8, 0.5, { weight: 500, incomeUsd: 52_000, hasKids: true }),
  makePersona("c1-res-03", "resident", 1.5, -1.0, { weight: 800, incomeUsd: 110_000 }),
  makePersona("c1-res-04", "resident", -2.5, -1.5, { weight: 700, incomeUsd: 64_000 }),
  makePersona("c1-res-05", "resident", 3.5, 2.5, { weight: 900, incomeUsd: 88_000 }),
  makePersona("c1-res-06", "resident", -4.5, 3.0, { weight: 650, incomeUsd: 41_000 }),
  makePersona("c1-wrk-01", "worker", 0.5, -0.4, { weight: 450, commuteMode: "walk", incomeUsd: 70_000 }),
  makePersona("c1-wrk-02", "worker", 2.0, 0.8, { weight: 350, incomeUsd: 95_000 }),
  makePersona("c1-pby-01", "passby", 0.1, 0.0, { weight: 300, incomeUsd: 60_000 }),
  makePersona("c1-pby-02", "passby", 1.0, 1.2, { weight: 250, commuteMode: "bike", incomeUsd: 58_000 }),
];

export const FIXTURE_PERSONA_SET: PersonaSet = { catchmentId: "c1", personas: FIXTURE_PERSONAS };

export function makeStore(id: string, eastKm: number, northKm: number, overrides: Partial<Storefront> = {}): Storefront {
  return {
    id,
    location: offsetKm(CENTER, eastKm, northKm),
    sizeSqft: 1500,
    position: "inline",
    frontageFt: 20,
    anchorCoTenants: 0,
    origin: "costar",
    ...overrides,
  };
}

export const SITE_A = makeStore("site-a", 0, 0, { sizeSqft: 1800, position: "corner", frontageFt: 28, anchorCoTenants: 1 });
export const SITE_B = makeStore("site-b", 0.8, 0.3, { sizeSqft: 1300 });
export const COMPETITORS: Storefront[] = [
  makeStore("comp-x", 0.4, 1.6, { sizeSqft: 2000, position: "end_cap" }),
  makeStore("comp-y", -2.2, -0.6),
  makeStore("comp-z", 3.0, 1.8, { sizeSqft: 2500, anchorCoTenants: 2 }),
];

const STAY = ASKED_LINE_LENGTHS.map((lineLength) => ({ lineLength, p: Math.max(0, 1 - lineLength * 0.07) }));

/** Deterministic fixture behavior: closer personas give the site a larger share. */
export function makeBehaviorTable(siteId: string, personas: Persona[] = FIXTURE_PERSONAS, failed: string[] = []): BehaviorTable {
  const rows: PersonaBehavior[] = personas.map((p, i) => {
    const siteShare = siteId === "site-a" ? 0.1 + 0.03 * (i % 5) : 0.06 + 0.02 * (i % 4);
    const compShare = 0.25;
    return {
      personaId: p.id,
      where: { [siteId]: siteShare, "comp-x": compShare, none: 1 - siteShare - compShare },
      visitsPerMonth: p.kind === "worker" ? 9 : p.kind === "passby" ? 2 : 5 + (i % 3),
      timeBlocks:
        p.kind === "worker"
          ? { early_morning: 0.3, morning: 0.4, midday: 0.2, afternoon: 0.1, evening: 0 }
          : { early_morning: 0.1, morning: 0.35, midday: 0.25, afternoon: 0.2, evening: 0.1 },
      // Deliberately unsorted for the model to sort.
      stayByLineLength: [...STAY].reverse(),
      priceAcceptance: [
        { price: 4, p: 0.9 },
        { price: 6, p: 0.6 },
      ],
      confidence: { where: 0.8, howOften: 0.7, when: 0.75, stay: 0.7, price: 0.6 },
      orderSpread: 0.03,
      cacheKeys: [`fixture:${siteId}:${p.id}`],
    };
  });
  return { siteId, modelVersion: "jev-1.14.0", personas: rows.filter((r) => !failed.includes(r.personaId)), failedPersonaIds: failed };
}

export function jevInput(site: Storefront = SITE_A, overrides: Partial<DemandInput> = {}): DemandInput {
  return {
    site,
    personaSet: FIXTURE_PERSONA_SET,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    demand: { source: "jev", behavior: makeBehaviorTable(site.id) },
    ...overrides,
  };
}

export function huffInput(site: Storefront = SITE_A, overrides: Partial<DemandInput> = {}): DemandInput {
  return {
    site,
    personaSet: FIXTURE_PERSONA_SET,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    demand: { source: "huff", huff: { competitors: COMPETITORS } },
    ...overrides,
  };
}
