/**
 * Category and city defaults for the demand model. Every number here has origin "default":
 * a placeholder that the founder or real data can override, and that sensitivity runs vary.
 */
import type { Category, City, DayType, Persona, PriceTier, StayPoint, TimeBlock } from "./contracts";

/** Average weekdays and weekend days in a month (365.25 / 7 * {5, 2} / 12). */
export const WEEKDAYS_PER_MONTH = (365.25 / 7) * (5 / 12);
export const WEEKEND_DAYS_PER_MONTH = (365.25 / 7) * (2 / 12);

/** Straight-line km to travel km, per city. */
export const CITY_DISTANCE_FACTOR: Record<City, number> = {
  houston: 1.3,
  los_angeles: 1.25,
};

/** Huff exponents. */
export const DEFAULT_ALPHA = 1.0;
export const DEFAULT_BETA = 2.0;
/** Distances under this (km) are clamped so d^-beta stays finite. */
export const MIN_DISTANCE_KM = 0.1;

/** A store is "in range" of a persona when its travel distance is at most this (km). */
export const MAX_RANGE_KM: Record<Persona["commuteMode"], number> = {
  walk: 1.5,
  bike: 4,
  transit: 6,
  drive: 10,
};

/** Attractiveness: A = (size / ref)^sizeExp * position * (frontage / ref)^frontExp * (1 + anchor * n). */
export const ATTRACTIVENESS = {
  sizeRefSqft: 1500,
  sizeExponent: 0.5,
  frontageRefFt: 20,
  frontageExponent: 0.3,
  position: { inline: 1.0, corner: 1.15, end_cap: 1.1 } as Record<"inline" | "corner" | "end_cap", number>,
  anchorBonus: 0.1,
};

export interface CategoryDefaults {
  /** Category visits per person per month, by persona kind (all stores of the category). */
  visitsPerMonth: Record<Persona["kind"], number>;
  /** Weekend-day visit rate relative to a weekday. */
  weekendMultiplier: number;
  /** Share of a day's visits in each time block, per day type. */
  timeBlocks: Record<DayType, Record<TimeBlock, number>>;
  serviceMeanMin: number;
  serviceCv: number;
  /** Probability of joining the line, per asked line length (Huff runs only). */
  stayCurve: StayPoint[];
  /** Market-share scale default and the range used for sensitivity. */
  scale: { value: number; low: number; high: number };
}

export const CATEGORY_DEFAULTS: Record<Category, CategoryDefaults> = {
  coffee: {
    visitsPerMonth: { resident: 6, worker: 10, passby: 2 },
    weekendMultiplier: 0.85,
    timeBlocks: {
      weekday: { early_morning: 0.25, morning: 0.35, midday: 0.2, afternoon: 0.15, evening: 0.05 },
      weekend: { early_morning: 0.1, morning: 0.4, midday: 0.25, afternoon: 0.18, evening: 0.07 },
    },
    serviceMeanMin: 2.5,
    serviceCv: 0.5,
    stayCurve: [
      { lineLength: 0, p: 1 },
      { lineLength: 2, p: 0.95 },
      { lineLength: 4, p: 0.8 },
      { lineLength: 6, p: 0.6 },
      { lineLength: 10, p: 0.3 },
    ],
    scale: { value: 1, low: 0.6, high: 1.4 },
  },
  quick_food: {
    visitsPerMonth: { resident: 4, worker: 8, passby: 1.5 },
    weekendMultiplier: 1.0,
    timeBlocks: {
      weekday: { early_morning: 0.03, morning: 0.12, midday: 0.45, afternoon: 0.12, evening: 0.28 },
      weekend: { early_morning: 0.02, morning: 0.13, midday: 0.4, afternoon: 0.15, evening: 0.3 },
    },
    serviceMeanMin: 4,
    serviceCv: 0.6,
    stayCurve: [
      { lineLength: 0, p: 1 },
      { lineLength: 2, p: 0.93 },
      { lineLength: 4, p: 0.78 },
      { lineLength: 6, p: 0.55 },
      { lineLength: 10, p: 0.25 },
    ],
    scale: { value: 1, low: 0.6, high: 1.4 },
  },
  salon: {
    visitsPerMonth: { resident: 0.8, worker: 0.4, passby: 0.05 },
    weekendMultiplier: 1.3,
    timeBlocks: {
      weekday: { early_morning: 0.02, morning: 0.2, midday: 0.25, afternoon: 0.3, evening: 0.23 },
      weekend: { early_morning: 0.02, morning: 0.3, midday: 0.33, afternoon: 0.27, evening: 0.08 },
    },
    serviceMeanMin: 35,
    serviceCv: 0.4,
    stayCurve: [
      { lineLength: 0, p: 1 },
      { lineLength: 2, p: 0.7 },
      { lineLength: 4, p: 0.4 },
      { lineLength: 6, p: 0.2 },
      { lineLength: 10, p: 0.05 },
    ],
    scale: { value: 1, low: 0.6, high: 1.4 },
  },
  fitness: {
    visitsPerMonth: { resident: 3, worker: 2, passby: 0.1 },
    weekendMultiplier: 0.8,
    timeBlocks: {
      weekday: { early_morning: 0.3, morning: 0.12, midday: 0.13, afternoon: 0.1, evening: 0.35 },
      weekend: { early_morning: 0.15, morning: 0.35, midday: 0.25, afternoon: 0.15, evening: 0.1 },
    },
    serviceMeanMin: 50,
    serviceCv: 0.2,
    stayCurve: [
      { lineLength: 0, p: 1 },
      { lineLength: 2, p: 0.9 },
      { lineLength: 4, p: 0.75 },
      { lineLength: 6, p: 0.55 },
      { lineLength: 10, p: 0.3 },
    ],
    scale: { value: 1, low: 0.6, high: 1.4 },
  },
};

/** Household income that best fits each price tier (USD). */
export const PRICE_TIER_TARGET_INCOME: Record<PriceTier, number> = {
  low: 40_000,
  mid: 75_000,
  high: 120_000,
};

/**
 * Income fit with the price tier, a multiplier on visit frequency in [floor, 1]:
 * floor + (1 - floor) * exp(-(ln(income / target))^2 / (2 * width^2)).
 */
export const INCOME_FIT = { floor: 0.5, width: 0.6 };

/**
 * Arrival envelope: the shared candidate stream for a persona has rate
 * weight * ENVELOPE_VISITS_PER_PERSON_HOUR / 60 per minute over the generation window.
 * Any site's target rate is thinned from it, so it must not depend on the site.
 */
export const ENVELOPE_VISITS_PER_PERSON_HOUR = 0.5;
/** Window (minutes since midnight) that the shared candidate stream covers: all time blocks. */
export const GENERATION_WINDOW: readonly [number, number] = [5 * 60, 21 * 60];
