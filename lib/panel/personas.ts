/**
 * Persona builder: turns a catchment (Census block groups, LODES workplace jobs, pass-by
 * counters) into 30 to 100 weighted personas. Pure code, seeded by the catchment id, so the
 * same catchment always yields the same personas. No language model is involved.
 *
 * Weights are integers. Resident weights sum to the catchment population, worker weights to
 * its LODES jobs, and pass-by weights to its daily pass-by count.
 */
import { createRng, type Rng } from "@/lib/sim/random";
import {
  CatchmentInputSchema,
  type CatchmentInput,
  type CommuteMode,
  type ModeShares,
  type Persona,
  type PersonaKind,
  type PersonaSet,
} from "./contracts";

export const MIN_PERSONAS = 30;
export const MAX_PERSONAS = 100;
export const DEFAULT_PERSONAS = 50;
/** Minimum personas per kind when that kind has any people. */
const MIN_PER_KIND = 4;
/** Default commute split for workers and fallback when shares are all zero. */
const DEFAULT_WORKER_MODES: ModeShares = { drive: 0.78, transit: 0.08, walk: 0.1, bike: 0.04 };
const WORKER_KIDS_SHARE = 0.35;
const JITTER_DEG = 0.0015;

export interface BuildPersonasOptions {
  /** Target persona count, clamped to [30, 100]. Default 50. */
  count?: number;
}

export interface PersonaTotals {
  resident: number;
  worker: number;
  passby: number;
}

/** People each kind stands for in the catchment; the persona weights per kind sum to these. */
export function catchmentTotals(input: CatchmentInput): PersonaTotals {
  return {
    resident: sum(input.blockGroups.map((b) => b.population)),
    worker: sum(input.workplaces.map((w) => w.jobs)),
    passby: sum(input.passBy.map((p) => p.dailyCount)),
  };
}

/** Sum of persona weights by kind. */
export function weightTotals(set: PersonaSet): PersonaTotals {
  const totals: PersonaTotals = { resident: 0, worker: 0, passby: 0 };
  for (const p of set.personas) totals[p.kind] += p.weight;
  return totals;
}

export function buildPersonas(rawInput: CatchmentInput, options: BuildPersonasOptions = {}): PersonaSet {
  const input = CatchmentInputSchema.parse(rawInput);
  const target = clamp(Math.round(options.count ?? DEFAULT_PERSONAS), MIN_PERSONAS, MAX_PERSONAS);
  const totals = catchmentTotals(input);
  const root = createRng(`personas:${input.catchmentId}`);

  const kinds: PersonaKind[] = ["resident", "worker", "passby"];
  const kindSlots = allocate(
    target,
    kinds.map((k) => totals[k]),
    kinds.map((k) => (totals[k] > 0 ? Math.min(MIN_PER_KIND, totals[k]) : 0)),
  );
  const [residentSlots = 0, workerSlots = 0, passbySlots = 0] = kindSlots;

  const personas: Persona[] = [
    ...buildResidents(input, residentSlots, root.fork("resident")),
    ...buildWorkers(input, workerSlots, root.fork("worker")),
    ...buildPassby(input, passbySlots, root.fork("passby")),
  ];
  return { catchmentId: input.catchmentId, personas };
}

// ---------------------------------------------------------------------------
// Residents (ACS block groups)
// ---------------------------------------------------------------------------

function buildResidents(input: CatchmentInput, slots: number, rng: Rng): Persona[] {
  const units = input.blockGroups.map((bg) => ({ ...bg, people: bg.population }));
  return buildFromUnits(units, slots, (bg, index, weight) => {
    const r = rng.fork(`${bg.geoid}:${index}`);
    const incomeUsd = roundTo(clamp(r.lognormal(bg.medianHouseholdIncomeUsd * 1.15, 0.55), 12_000, 400_000), 1000);
    const age = Math.round(clamp(r.normal(bg.medianAge + 6, 14), 18, 85));
    const hasKids = r.next() < bg.shareHouseholdsWithKids && age < 60;
    const commuteMode = pickMode(bg.commuteShares, r);
    const persona: Persona = {
      id: `${input.catchmentId}-res-bg${bg.geoid}-${pad(index)}`,
      segment: `resident_${incomeBand(incomeUsd)}_income`,
      weight,
      kind: "resident",
      location: jitter(bg, r),
      commuteMode,
      incomeUsd,
      age,
      hasKids,
      description: "",
    };
    persona.description = describePersona(persona);
    return persona;
  });
}

// ---------------------------------------------------------------------------
// Workers (LODES WAC)
// ---------------------------------------------------------------------------

function buildWorkers(input: CatchmentInput, slots: number, rng: Rng): Persona[] {
  const units = input.workplaces.map((w) => ({ ...w, people: w.jobs }));
  return buildFromUnits(units, slots, (w, index, weight) => {
    const r = rng.fork(`${w.geoid}:${index}`);
    const band = pickWeighted(r, [
      ["low", w.earnings.low],
      ["mid", w.earnings.mid],
      ["high", w.earnings.high],
    ] as const);
    // Household income ranges implied by the LODES monthly earnings band.
    const incomeRange = band === "low" ? [18_000, 40_000] : band === "mid" ? [40_000, 85_000] : [85_000, 220_000];
    const incomeUsd = roundTo(incomeRange[0]! + r.next() * (incomeRange[1]! - incomeRange[0]!), 1000);
    const ageBand = pickWeighted(r, [
      ["under30", w.ages.under30],
      ["age30to54", w.ages.age30to54],
      ["over55", w.ages.over55],
    ] as const);
    const age = ageBand === "under30" ? r.int(19, 29) : ageBand === "age30to54" ? r.int(30, 54) : r.int(55, 70);
    const persona: Persona = {
      id: `${input.catchmentId}-wrk-${w.geoid}-${pad(index)}`,
      segment: "worker",
      weight,
      kind: "worker",
      location: jitter(w, r),
      commuteMode: pickMode(DEFAULT_WORKER_MODES, r),
      incomeUsd,
      age,
      hasKids: r.next() < WORKER_KIDS_SHARE && age < 60,
      description: "",
    };
    persona.description = describePersona(persona);
    return persona;
  });
}

// ---------------------------------------------------------------------------
// Pass-by traffic
// ---------------------------------------------------------------------------

function buildPassby(input: CatchmentInput, slots: number, rng: Rng): Persona[] {
  const medianIncome = weightedMedianIncome(input);
  const units = input.passBy.map((c) => ({ ...c, people: c.dailyCount }));
  return buildFromUnits(units, slots, (c, index, weight) => {
    const r = rng.fork(`${c.id}:${index}`);
    const commuteMode: CommuteMode = r.next() < c.walkShare ? "walk" : "drive";
    const incomeUsd = roundTo(clamp(r.lognormal(medianIncome * 1.1, 0.6), 15_000, 400_000), 1000);
    const age = Math.round(clamp(r.normal(40, 14), 18, 80));
    const persona: Persona = {
      id: `${input.catchmentId}-pas-${c.id}-${pad(index)}`,
      segment: "passby",
      weight,
      kind: "passby",
      location: { lat: c.lat, lng: c.lng },
      commuteMode,
      incomeUsd,
      age,
      hasKids: r.next() < 0.3 && age < 60,
      description: "",
    };
    persona.description = describePersona(persona);
    return persona;
  });
}

// ---------------------------------------------------------------------------
// Shared allocation
// ---------------------------------------------------------------------------

interface Unit {
  lat: number;
  lng: number;
  people: number;
}

/**
 * Spreads `slots` personas over units in proportion to their people. Units that get no
 * persona fold their people into the nearest unit that does, so weights still sum to the
 * total. Within a unit, its people are split into integer weights.
 */
function buildFromUnits<U extends Unit>(
  units: U[],
  slots: number,
  make: (unit: U, index: number, weight: number) => Persona,
): Persona[] {
  const total = sum(units.map((u) => u.people));
  if (slots <= 0 || total <= 0) return [];
  const perUnit = allocate(
    Math.min(slots, total),
    units.map((u) => u.people),
  );
  const pooled = units.map((u, i) => ((perUnit[i] ?? 0) > 0 ? u.people : 0));
  units.forEach((u, i) => {
    if ((perUnit[i] ?? 0) > 0 || u.people === 0) return;
    let best = -1;
    let bestD = Infinity;
    units.forEach((v, j) => {
      if ((perUnit[j] ?? 0) === 0) return;
      const d = (u.lat - v.lat) ** 2 + (u.lng - v.lng) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    if (best >= 0) pooled[best] = (pooled[best] ?? 0) + u.people;
  });

  const out: Persona[] = [];
  units.forEach((u, i) => {
    const k = Math.min(perUnit[i] ?? 0, pooled[i] ?? 0);
    if (k <= 0) return;
    const weights = splitInteger(pooled[i] ?? 0, k);
    weights.forEach((w, index) => out.push(make(u, index, w)));
  });
  return out;
}

/**
 * Largest-remainder allocation of `total` integer slots in proportion to `weights`,
 * honouring per-entry minimums. Deterministic: ties go to the lower index.
 */
export function allocate(total: number, weights: number[], mins: number[] = []): number[] {
  const result = weights.map((_, i) => mins[i] ?? 0);
  let remaining = total - sum(result);
  const wSum = sum(weights);
  if (remaining <= 0 || wSum <= 0) return result;
  const quotas = weights.map((w) => (w / wSum) * remaining);
  const floors = quotas.map(Math.floor);
  floors.forEach((f, i) => (result[i] = (result[i] ?? 0) + f));
  remaining -= sum(floors);
  const order = quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q) }))
    .filter(({ i }) => (weights[i] ?? 0) > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let n = 0; n < remaining && order.length > 0; n++) {
    const { i } = order[n % order.length]!;
    result[i] = (result[i] ?? 0) + 1;
  }
  return result;
}

/** Splits an integer into k near-equal positive integer parts that sum to it. */
function splitInteger(total: number, k: number): number[] {
  const base = Math.floor(total / k);
  const extra = total - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Short, code-built persona description (no distances; those depend on the site). */
export function describePersona(p: Persona): string {
  const role = p.kind === "resident" ? "lives nearby" : p.kind === "worker" ? "works nearby" : "passes by";
  return `${p.age}, household income ${formatIncome(p.incomeUsd)}, ${role}, ${modeVerb(p.commuteMode)}, ${
    p.hasKids ? "has kids" : "no kids"
  }`;
}

export function formatIncome(usd: number): string {
  return `$${Math.round(usd / 5000) * 5}k`;
}

export function modeVerb(mode: CommuteMode): string {
  return mode === "walk" ? "walks" : mode === "drive" ? "drives" : mode === "bike" ? "bikes" : "takes transit";
}

function incomeBand(usd: number): "low" | "mid" | "high" {
  return usd < 45_000 ? "low" : usd < 100_000 ? "mid" : "high";
}

function pickMode(shares: ModeShares, rng: Rng): CommuteMode {
  const entries: [CommuteMode, number][] = [
    ["drive", shares.drive],
    ["transit", shares.transit],
    ["walk", shares.walk],
    ["bike", shares.bike],
  ];
  if (sum(entries.map(([, w]) => w)) <= 0) return pickMode(DEFAULT_WORKER_MODES, rng);
  return pickWeighted(rng, entries);
}

function pickWeighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  const total = sum(entries.map(([, w]) => w));
  if (total <= 0) return entries[0]![0];
  let u = rng.next() * total;
  for (const [value, w] of entries) {
    u -= w;
    if (u < 0) return value;
  }
  return entries[entries.length - 1]![0];
}

function weightedMedianIncome(input: CatchmentInput): number {
  const pop = sum(input.blockGroups.map((b) => b.population));
  if (pop <= 0) return 60_000;
  return sum(input.blockGroups.map((b) => b.medianHouseholdIncomeUsd * b.population)) / pop;
}

function jitter(at: { lat: number; lng: number }, rng: Rng): { lat: number; lng: number } {
  return {
    lat: round6(at.lat + (rng.next() - 0.5) * 2 * JITTER_DEG),
    lng: round6(at.lng + (rng.next() - 0.5) * 2 * JITTER_DEG),
  };
}

function pad(i: number): string {
  return String(i + 1).padStart(2, "0");
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
