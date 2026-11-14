/**
 * Interim Zod contracts for the demand model (HAC-18).
 *
 * Field names follow the shared interim spec used by HAC-13 (queue engine) and HAC-15
 * (Jev panel). When HAC-9 lands `lib/contracts/`, these schemas move there unchanged.
 *
 * Times are minutes since local midnight. Money is USD. Probabilities are in [0, 1].
 */
import { z } from "zod";

// ---- shared primitives ----

export const Origin = z.enum(["costar", "public", "founder", "default"]);
export type Origin = z.infer<typeof Origin>;

export const SourcedNumber = z.object({ value: z.number(), origin: Origin });
export type Sourced<T> = { value: T; origin: Origin };

export const DayType = z.enum(["weekday", "weekend"]);
export type DayType = z.infer<typeof DayType>;

export const TIME_BLOCKS = ["early_morning", "morning", "midday", "afternoon", "evening"] as const;
export const TimeBlock = z.enum(TIME_BLOCKS);
export type TimeBlock = z.infer<typeof TimeBlock>;

/** Hours covered by each time block, as [startHour, endHour). */
export const TIME_BLOCK_HOURS: Record<TimeBlock, readonly [number, number]> = {
  early_morning: [5, 8],
  morning: [8, 11],
  midday: [11, 14],
  afternoon: [14, 17],
  evening: [17, 21],
};

export const ASKED_LINE_LENGTHS = [0, 2, 4, 6, 10] as const;

export const StayPoint = z.object({
  lineLength: z.number().int().nonnegative(),
  p: z.number().min(0).max(1),
});
export type StayPoint = z.infer<typeof StayPoint>;

const Probability = z.number().min(0).max(1);
const LatLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export type LatLng = z.infer<typeof LatLng>;

// ---- personas (HAC-15 produces; HAC-18 consumes) ----

export const Persona = z.object({
  id: z.string().min(1),
  segment: z.string().min(1),
  weight: z.number().nonnegative(),
  kind: z.enum(["resident", "worker", "passby"]),
  location: LatLng,
  commuteMode: z.enum(["walk", "drive", "transit", "bike"]),
  incomeUsd: z.number().nonnegative(),
  age: z.number().nonnegative(),
  hasKids: z.boolean(),
  description: z.string(),
});
export type Persona = z.infer<typeof Persona>;

export const PersonaSet = z.object({
  catchmentId: z.string().min(1),
  personas: z.array(Persona),
});
export type PersonaSet = z.infer<typeof PersonaSet>;

// ---- behavior table (HAC-15 produces; HAC-18 consumes when demandSource = "jev") ----

export const PersonaBehavior = z.object({
  personaId: z.string().min(1),
  where: z.record(z.string(), Probability),
  visitsPerMonth: z.number().nonnegative(),
  timeBlocks: z.object({
    early_morning: Probability,
    morning: Probability,
    midday: Probability,
    afternoon: Probability,
    evening: Probability,
  }),
  stayByLineLength: z.array(StayPoint),
  priceAcceptance: z.array(z.object({ price: z.number().nonnegative(), p: Probability })),
  confidence: z.object({
    where: Probability,
    howOften: Probability,
    when: Probability,
    stay: Probability,
    price: Probability,
  }),
  orderSpread: z.number().nonnegative(),
  cacheKeys: z.array(z.string()),
});
export type PersonaBehavior = z.infer<typeof PersonaBehavior>;

export const BehaviorTable = z.object({
  siteId: z.string().min(1),
  modelVersion: z.string(),
  personas: z.array(PersonaBehavior),
  failedPersonaIds: z.array(z.string()),
});
export type BehaviorTable = z.infer<typeof BehaviorTable>;

// ---- arrival schedule (HAC-18 produces; HAC-13 consumes) ----

export const Customer = z.object({
  id: z.string().min(1),
  personaId: z.string().min(1),
  arrivalMin: z.number().min(0).max(1440),
  stayDraw: z.number().min(0).lt(1),
  serviceMin: z.number().positive(),
});
export type Customer = z.infer<typeof Customer>;

export const ArrivalSchedule = z.object({
  siteId: z.string().min(1),
  seed: z.number().int(),
  dayType: DayType,
  openMin: z.number().min(0).max(1440),
  closeMin: z.number().min(0).max(1440),
  demandSource: z.enum(["jev", "huff"]),
  stayCurves: z.array(z.object({ personaId: z.string(), points: z.array(StayPoint) })),
  customers: z.array(Customer),
  params: z.record(z.string(), SourcedNumber),
});
export type ArrivalSchedule = z.infer<typeof ArrivalSchedule>;

// ---- demand-model inputs (HAC-18 own; candidates for lib/contracts/ later) ----

export const City = z.enum(["houston", "los_angeles"]);
export type City = z.infer<typeof City>;

export const Category = z.enum(["coffee", "quick_food", "salon", "fitness"]);
export type Category = z.infer<typeof Category>;

export const PriceTier = z.enum(["low", "mid", "high"]);
export type PriceTier = z.infer<typeof PriceTier>;

/** A storefront that can be chosen: the candidate itself or a competitor. */
export const Storefront = z.object({
  id: z.string().min(1),
  location: LatLng,
  sizeSqft: z.number().positive(),
  position: z.enum(["inline", "corner", "end_cap"]),
  frontageFt: z.number().positive(),
  anchorCoTenants: z.number().int().nonnegative(),
  origin: Origin,
});
export type Storefront = z.infer<typeof Storefront>;

/** Inputs used only by the Huff fallback. Unset numbers fall back to defaults. */
export const HuffParams = z.object({
  competitors: z.array(Storefront),
  alpha: SourcedNumber.optional(),
  beta: SourcedNumber.optional(),
});
export type HuffParams = z.infer<typeof HuffParams>;

export const DemandSourceInput = z.discriminatedUnion("source", [
  z.object({ source: z.literal("jev"), behavior: BehaviorTable }),
  z.object({ source: z.literal("huff"), huff: HuffParams }),
]);
export type DemandSourceInput = z.infer<typeof DemandSourceInput>;

export const DemandInput = z.object({
  site: Storefront,
  personaSet: PersonaSet,
  city: City,
  category: Category,
  priceTier: PriceTier,
  demand: DemandSourceInput,
  /** Market-share scale factor. Unset: category default (1.0, range kept in params). */
  scale: SourcedNumber.optional(),
  /** Mean service minutes and its coefficient of variation. Unset: category defaults. */
  serviceMeanMin: SourcedNumber.optional(),
  serviceCv: SourcedNumber.optional(),
});
export type DemandInput = z.infer<typeof DemandInput>;

export const ScheduleRequest = z.object({
  seed: z.number().int(),
  dayType: DayType,
  openMin: z.number().min(0).max(1440),
  closeMin: z.number().min(0).max(1440),
});
export type ScheduleRequest = z.infer<typeof ScheduleRequest>;

/**
 * Founder-supplied numbers from another location, used to fit one market-share scale.
 * Supply either a daily customer count for a day type, or monthly sales with an average ticket.
 */
export const CalibrationInput = z.union([
  z.object({
    kind: z.literal("daily_customers"),
    dailyCustomers: z.number().positive(),
    dayType: DayType,
    openMin: z.number().min(0).max(1440),
    closeMin: z.number().min(0).max(1440),
  }),
  z.object({
    kind: z.literal("monthly_sales"),
    monthlySalesUsd: z.number().positive(),
    avgTicketUsd: z.number().positive(),
    openMin: z.number().min(0).max(1440),
    closeMin: z.number().min(0).max(1440),
  }),
]);
export type CalibrationInput = z.infer<typeof CalibrationInput>;
