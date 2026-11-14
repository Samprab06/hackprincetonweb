/**
 * Jev state and question builder. Every string here is assembled by code from numbers and
 * enums: no founder free text, listing description or brand name ever reaches Jev.
 * Distances are pre-computed into travel minutes ("6-minute walk") because Jev is weak at
 * arithmetic, and the state is kept small because extra state distracts it.
 */
import type { Rng } from "@/lib/sim/random";
import {
  ASKED_LINE_LENGTHS,
  CandidateSiteSchema,
  CompetitorSchema,
  NeedSpecSchema,
  TIME_BLOCKS,
  type BusinessType,
  type CandidateSite,
  type CommuteMode,
  type Competitor,
  type NeedSpec,
  type Persona,
  type TimeBlock,
} from "./contracts";
import { formatIncome, modeVerb } from "./personas";
import type { JevQuestion, JevState } from "./jev-client";

export const NONE_OPTION = "none";

export const HOW_OFTEN_LEVELS = ["never", "monthly", "weekly", "several_a_week", "daily"] as const;
export type HowOftenLevel = (typeof HOW_OFTEN_LEVELS)[number];
/** Visits per month implied by each `how_often` level. */
export const VISITS_PER_MONTH: Record<HowOftenLevel, number> = {
  never: 0,
  monthly: 1,
  weekly: 4.3,
  several_a_week: 12,
  daily: 26,
};
const HOW_OFTEN_LABELS: Record<HowOftenLevel, string> = {
  never: "never",
  monthly: "about once a month",
  weekly: "about once a week",
  several_a_week: "several times a week",
  daily: "almost every day",
};

const TIME_BLOCK_LABELS: Record<TimeBlock, string> = {
  early_morning: "early morning (5-8am)",
  morning: "morning (8-11am)",
  midday: "midday (11am-2pm)",
  afternoon: "afternoon (2-5pm)",
  evening: "evening (5-9pm)",
};

const NEED_LABELS: Record<BusinessType, string> = {
  coffee: "specialty coffee",
  quick_food: "a quick meal",
  salon_barber: "a haircut",
  fitness_studio: "a fitness class",
};

const BUSINESS_NOUN: Record<BusinessType, string> = {
  coffee: "coffee shop",
  quick_food: "quick-service restaurant",
  salon_barber: "salon",
  fitness_studio: "fitness studio",
};

const FRONTAGE_LABELS: Record<CandidateSite["frontage"], string> = {
  corner: "corner storefront",
  inline: "inline storefront",
  endcap: "end-cap storefront",
  pad: "standalone pad building",
  in_line_mall: "storefront inside a mall",
};

/** Average door-to-door speeds in miles per hour, plus fixed overhead minutes. */
const SPEED_MPH: Record<CommuteMode, number> = { walk: 3, bike: 10, drive: 22, transit: 10 };
const OVERHEAD_MIN: Record<CommuteMode, number> = { walk: 0, bike: 1, drive: 3, transit: 8 };
const MODE_NOUN: Record<CommuteMode, string> = { walk: "walk", bike: "bike ride", drive: "drive", transit: "transit ride" };
/** Short trips are walked whatever the usual mode. */
const ALWAYS_WALK_MI = 0.25;

export interface PanelContext {
  site: CandidateSite;
  competitors: Competitor[];
  need: NeedSpec;
  /** Prices to ask `price_ok` at. The first is the base `price_ok`; default [need.priceUsd]. */
  pricePoints?: number[];
}

// ---------------------------------------------------------------------------
// Text pieces
// ---------------------------------------------------------------------------

export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function travelText(miles: number, mode: CommuteMode): string {
  const m = miles <= ALWAYS_WALK_MI ? "walk" : mode;
  const minutes = Math.max(1, Math.round((miles / SPEED_MPH[m]) * 60 + OVERHEAD_MIN[m]));
  return `${minutes}-minute ${MODE_NOUN[m]}`;
}

export function clockText(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

function priceText(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

function milesText(mi: number): string {
  return `${mi < 1 ? mi.toFixed(1) : Math.round(mi * 2) / 2} mi`;
}

function fromWhere(p: Persona): string {
  return p.kind === "resident" ? "from home" : p.kind === "worker" ? "from work" : "off your route";
}

export function personText(p: Persona, site: CandidateSite): string {
  const mi = milesText(haversineMiles(p.location, site));
  const rel = p.kind === "resident" ? `lives ${mi} away` : p.kind === "worker" ? `works ${mi} away` : `passing ${mi} away`;
  return `${p.age}, household income ${formatIncome(p.incomeUsd)}, ${rel}, ${modeVerb(p.commuteMode)}, ${
    p.hasKids ? "has kids" : "no kids"
  }`;
}

export function siteText(p: Persona, site: CandidateSite): string {
  const travel = travelText(haversineMiles(p.location, site), p.commuteMode);
  const parking = site.hasParking ? ", parking" : "";
  return `${travel} ${fromWhere(p)}, ${FRONTAGE_LABELS[site.frontage]}${parking}, opens ${clockText(site.opensMin)}`;
}

export function competitorText(p: Persona, c: Competitor): string {
  const cls = c.brandClass === "chain" ? "Chain" : "Independent";
  const travel = travelText(haversineMiles(p.location, c), p.commuteMode);
  return `${cls} ${BUSINESS_NOUN[c.businessType]}, ${travel}, ${priceText(c.priceUsd)}`;
}

// ---------------------------------------------------------------------------
// State and questions
// ---------------------------------------------------------------------------

/** Canonical option ids for `where`: site, competitors (input order), then "none". */
export function whereOptionIds(ctx: PanelContext): string[] {
  return [ctx.site.id, ...ctx.competitors.map((c) => c.id), NONE_OPTION];
}

/**
 * Builds the state for one persona x site. `optionOrder` (ids without "none") sets the order
 * of `options`, which follows the shuffled `where` order so Jev sees one consistent order.
 */
export function buildState(persona: Persona, rawCtx: PanelContext, optionOrder?: string[]): JevState {
  const ctx = sanitizeContext(rawCtx);
  const text = new Map<string, string>();
  text.set(ctx.site.id, siteText(persona, ctx.site));
  for (const c of ctx.competitors) text.set(c.id, competitorText(persona, c));
  const order = (optionOrder ?? [...text.keys()]).filter((id) => text.has(id));
  const options: Record<string, string> = {};
  for (const id of order) options[id] = text.get(id)!;
  return {
    person: personText(persona, ctx.site),
    need: `${NEED_LABELS[ctx.need.businessType]}, about ${priceText(ctx.need.priceUsd)}`,
    options,
  };
}

export function estimatedWaitMin(lineLength: number, need: NeedSpec): number {
  return Math.round(lineLength * need.serviceMinPerCustomer);
}

export function stayQuestionName(n: number): string {
  return `stay_at_queue_${n}`;
}

export function priceQuestionName(price: number, index: number): string {
  return index === 0 ? "price_ok" : `price_ok_at_${Math.round(price * 100)}c`;
}

/**
 * All questions for one call. `rng` shuffles the Choice options (`where`, `when`); pass
 * none for canonical order.
 */
export function buildQuestions(rawCtx: PanelContext, rng?: Rng): { questions: JevQuestion[]; whereOrder: string[] } {
  const ctx = sanitizeContext(rawCtx);
  const whereOrder = whereOptionIds(ctx);
  const whenOrder: TimeBlock[] = [...TIME_BLOCKS];
  if (rng) {
    rng.shuffle(whereOrder);
    rng.shuffle(whenOrder);
  }
  const questions: JevQuestion[] = [
    {
      name: "where",
      type: "choice",
      prompt: "Where would this person usually go for this?",
      options: whereOrder.map((id) => ({ id, label: id === NONE_OPTION ? "None of these" : id })),
    },
    {
      name: "how_often",
      type: "score",
      prompt: "How often would this person visit the place they chose?",
      levels: HOW_OFTEN_LEVELS.map((id) => ({ id, label: HOW_OFTEN_LABELS[id] })),
    },
    {
      name: "when",
      type: "choice",
      prompt: "When in the day would this person usually go?",
      options: whenOrder.map((id) => ({ id, label: TIME_BLOCK_LABELS[id] })),
    },
    ...ASKED_LINE_LENGTHS.map(
      (n): JevQuestion => ({
        name: stayQuestionName(n),
        type: "noul",
        prompt:
          n === 0
            ? `At ${ctx.site.id}, there is no line. Would this person stay and order?`
            : `At ${ctx.site.id}, ${n} people are in line, an estimated ${estimatedWaitMin(n, ctx.need)}-minute wait. Would this person stay?`,
      }),
    ),
    ...pricePoints(ctx).map(
      (price, i): JevQuestion => ({
        name: priceQuestionName(price, i),
        type: "noul",
        prompt: `Is ${priceText(price)} an acceptable price for this person at ${ctx.site.id}?`,
      }),
    ),
  ];
  return { questions, whereOrder: whereOrder.filter((id) => id !== NONE_OPTION) };
}

export function pricePoints(ctx: PanelContext): number[] {
  return ctx.pricePoints && ctx.pricePoints.length > 0 ? ctx.pricePoints : [ctx.need.priceUsd];
}

/** Re-parses the context so only whitelisted structured fields survive. */
function sanitizeContext(ctx: PanelContext): PanelContext {
  return {
    site: CandidateSiteSchema.parse(ctx.site),
    competitors: ctx.competitors.map((c) => CompetitorSchema.parse(c)),
    need: NeedSpecSchema.parse(ctx.need),
    pricePoints: ctx.pricePoints,
  };
}
