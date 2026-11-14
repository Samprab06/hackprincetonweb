/**
 * Demand model (HAC-18): PersonaSet + (Jev BehaviorTable | Huff params) -> ArrivalSchedule.
 *
 * 1. Choice and frequency, per persona:
 *      expected visits / month = weight * visitsPerMonth * share * scale
 *    jev:  visitsPerMonth and share (= where[siteId]) come from the behavior table.
 *    huff: visitsPerMonth = category default for the persona kind * income fit with the price
 *          tier; share = Huff probability over the site and competitors in range.
 * 2. Time of day: monthly visits are split into weekday / weekend days with the category
 *    weekend multiplier, then spread over the persona's time blocks (jev) or the category
 *    profile for the day type (huff). Visits outside opening hours are lost.
 * 3. Arrivals: seeded non-homogeneous Poisson by thinning a shared per-persona stream, so the
 *    same seed gives the same customers at every site in the catchment (see arrivals.ts).
 * 4. Calibration: one market-share scale fitted to a founder-supplied count; otherwise the
 *    category default scale with its range in params for sensitivity runs.
 *
 * Pure TypeScript: no database, HTTP or model calls, and no Math.random.
 */
import {
  ArrivalSchedule as ArrivalScheduleSchema,
  type ArrivalSchedule,
  type CalibrationInput,
  type DayType,
  type DemandInput,
  type Origin,
  type Persona,
  type ScheduleRequest,
  type Sourced,
  type StayPoint,
  type TimeBlock,
} from "./contracts";
import { expectedVisitsByHour, generateArrivals, ratePerMinuteByHour } from "./arrivals";
import {
  CATEGORY_DEFAULTS,
  CITY_DISTANCE_FACTOR,
  DEFAULT_ALPHA,
  DEFAULT_BETA,
  ENVELOPE_VISITS_PER_PERSON_HOUR,
  WEEKDAYS_PER_MONTH,
  WEEKEND_DAYS_PER_MONTH,
} from "./defaults";
import { attractiveness, huffShare, huffVisitsPerMonth } from "./huff";

export interface PersonaDemand {
  personaId: string;
  weight: number;
  /** Category visits per person per month (all options). */
  visitsPerMonth: number;
  /** Share of those visits that go to this site. */
  share: number;
  /** weight * visitsPerMonth * share * scale. */
  expectedVisitsPerMonth: number;
  /** Expected visits per day of each type, before opening hours are applied. */
  dailyVisits: Record<DayType, number>;
  timeBlocks: Record<DayType, Record<TimeBlock, number>>;
  stayCurve: StayPoint[];
}

export interface DemandEstimate {
  siteId: string;
  catchmentId: string;
  demandSource: "jev" | "huff";
  scale: Sourced<number>;
  serviceMeanMin: Sourced<number>;
  serviceCv: Sourced<number>;
  personas: PersonaDemand[];
  /** Personas left out (jev: failed or missing from the behavior table). */
  excludedPersonaIds: string[];
  params: Record<string, Sourced<number>>;
}

const def = (value: number): Sourced<number> => ({ value, origin: "default" });

/** Splits monthly visits into per-day visits for weekdays and weekend days. */
export function dailyFromMonthly(monthly: number, weekendMultiplier: number): Record<DayType, number> {
  const weekday = monthly / (WEEKDAYS_PER_MONTH + WEEKEND_DAYS_PER_MONTH * weekendMultiplier);
  return { weekday, weekend: weekday * weekendMultiplier };
}

/**
 * Origin of numbers derived from the whole model (expected customers, hourly rates): founder
 * once the scale is calibrated; otherwise public for jev (census-built personas answering
 * through Jev) and default for the Huff fallback.
 */
function derivedOrigin(scale: Sourced<number>, source: "jev" | "huff"): Origin {
  if (scale.origin === "founder") return "founder";
  return source === "jev" ? "public" : "default";
}

/** Step 1: per-persona choice and frequency for one site. */
export function estimateDemand(input: DemandInput): DemandEstimate {
  const cat = CATEGORY_DEFAULTS[input.category];
  const scale = input.scale ?? def(cat.scale.value);
  const serviceMeanMin = input.serviceMeanMin ?? def(cat.serviceMeanMin);
  const serviceCv = input.serviceCv ?? def(cat.serviceCv);
  const site = input.site;
  const personaSet = input.personaSet;

  const params: Record<string, Sourced<number>> = {
    scale,
    "scale.low": def(cat.scale.low),
    "scale.high": def(cat.scale.high),
    "service.meanMin": serviceMeanMin,
    "service.cv": serviceCv,
    "day.weekendMultiplier": def(cat.weekendMultiplier),
    "day.weekdaysPerMonth": def(WEEKDAYS_PER_MONTH),
    "day.weekendDaysPerMonth": def(WEEKEND_DAYS_PER_MONTH),
    "arrivals.envelopePerPersonHour": def(ENVELOPE_VISITS_PER_PERSON_HOUR),
    "catchment.personas": { value: personaSet.personas.length, origin: "public" },
    "catchment.weight": {
      value: personaSet.personas.reduce((s, p) => s + p.weight, 0),
      origin: "public",
    },
  };

  const personas: PersonaDemand[] = [];
  const excludedPersonaIds: string[] = [];
  const push = (p: Persona, visitsPerMonth: number, share: number, blocks: PersonaDemand["timeBlocks"], stay: StayPoint[]) => {
    const expectedVisitsPerMonth = p.weight * visitsPerMonth * share * scale.value;
    personas.push({
      personaId: p.id,
      weight: p.weight,
      visitsPerMonth,
      share,
      expectedVisitsPerMonth,
      dailyVisits: dailyFromMonthly(expectedVisitsPerMonth, cat.weekendMultiplier),
      timeBlocks: blocks,
      stayCurve: stay,
    });
  };

  if (input.demand.source === "jev") {
    const table = input.demand.behavior;
    if (table.siteId !== site.id) {
      throw new Error(`behavior table is for site ${table.siteId}, not ${site.id}`);
    }
    const byId = new Map(table.personas.map((b) => [b.personaId, b]));
    const failed = new Set(table.failedPersonaIds);
    for (const p of personaSet.personas) {
      const b = byId.get(p.id);
      if (!b || failed.has(p.id)) {
        excludedPersonaIds.push(p.id);
        continue;
      }
      const stay = [...b.stayByLineLength].sort((x, y) => x.lineLength - y.lineLength);
      push(p, b.visitsPerMonth, b.where[site.id] ?? 0, { weekday: b.timeBlocks, weekend: b.timeBlocks }, stay);
    }
    params["jev.personas"] = { value: personas.length, origin: "public" };
    params["jev.excludedPersonas"] = { value: excludedPersonaIds.length, origin: "public" };
  } else {
    const huff = input.demand.huff;
    const alpha = huff.alpha ?? def(DEFAULT_ALPHA);
    const beta = huff.beta ?? def(DEFAULT_BETA);
    params["huff.alpha"] = alpha;
    params["huff.beta"] = beta;
    params["huff.distanceFactor"] = def(CITY_DISTANCE_FACTOR[input.city]);
    params[`huff.attractiveness.${site.id}`] = { value: attractiveness(site), origin: site.origin };
    for (const c of huff.competitors) {
      params[`huff.attractiveness.${c.id}`] = { value: attractiveness(c), origin: c.origin };
    }
    for (const kind of ["resident", "worker", "passby"] as const) {
      params[`frequency.${kind}.visitsPerMonth`] = def(cat.visitsPerMonth[kind]);
    }
    for (const p of personaSet.personas) {
      const share = huffShare(p, site, huff.competitors, { alpha: alpha.value, beta: beta.value, city: input.city });
      push(p, huffVisitsPerMonth(p, input.category, input.priceTier), share, cat.timeBlocks, cat.stayCurve);
    }
  }

  return {
    siteId: site.id,
    catchmentId: personaSet.catchmentId,
    demandSource: input.demand.source,
    scale,
    serviceMeanMin,
    serviceCv,
    personas,
    excludedPersonaIds,
    params,
  };
}

/** Step 2: expected customers per clock hour (24 entries) within opening hours. */
export function hourlyRates(estimate: DemandEstimate, dayType: DayType, openMin: number, closeMin: number): number[] {
  const total = new Array<number>(24).fill(0);
  for (const p of estimate.personas) {
    const byHour = expectedVisitsByHour(
      ratePerMinuteByHour(p.dailyVisits[dayType], p.timeBlocks[dayType]),
      openMin,
      closeMin,
    );
    for (let h = 0; h < 24; h++) total[h] = (total[h] ?? 0) + (byHour[h] ?? 0);
  }
  return total;
}

/** Expected customers in one day of the given type within opening hours. */
export function expectedDailyCustomers(
  estimate: DemandEstimate,
  dayType: DayType,
  openMin: number,
  closeMin: number,
): number {
  return hourlyRates(estimate, dayType, openMin, closeMin).reduce((s, v) => s + v, 0);
}

/** Steps 1-3: the seeded arrival schedule for one site and one day. */
export function buildArrivalSchedule(input: DemandInput, req: ScheduleRequest): ArrivalSchedule {
  if (!(req.closeMin > req.openMin)) throw new Error("closeMin must be after openMin");
  const estimate = estimateDemand(input);
  const { customers, clippedPersonaHours } = generateArrivals(
    estimate.personas.map((p) => ({
      personaId: p.personaId,
      weight: p.weight,
      ratesByHour: ratePerMinuteByHour(p.dailyVisits[req.dayType], p.timeBlocks[req.dayType]),
    })),
    {
      seed: req.seed,
      catchmentId: estimate.catchmentId,
      dayType: req.dayType,
      openMin: req.openMin,
      closeMin: req.closeMin,
      serviceMeanMin: estimate.serviceMeanMin.value,
      serviceCv: estimate.serviceCv.value,
    },
  );

  const origin = derivedOrigin(estimate.scale, estimate.demandSource);
  const params: Record<string, Sourced<number>> = { ...estimate.params };
  const hourly = hourlyRates(estimate, req.dayType, req.openMin, req.closeMin);
  hourly.forEach((v, h) => {
    if (h * 60 < req.closeMin && (h + 1) * 60 > req.openMin) {
      params[`rate.h${String(h).padStart(2, "0")}`] = { value: v, origin };
    }
  });
  params["expected.dailyCustomers"] = { value: hourly.reduce((s, v) => s + v, 0), origin };
  params["arrivals.clippedPersonaHours"] = { value: clippedPersonaHours, origin: "default" };

  const schedule: ArrivalSchedule = {
    siteId: estimate.siteId,
    seed: req.seed,
    dayType: req.dayType,
    openMin: req.openMin,
    closeMin: req.closeMin,
    demandSource: estimate.demandSource,
    stayCurves: estimate.personas
      .filter((p) => p.expectedVisitsPerMonth > 0)
      .map((p) => ({ personaId: p.personaId, points: p.stayCurve })),
    customers,
    params,
  };
  return ArrivalScheduleSchema.parse(schedule);
}

export interface CalibrationResult {
  /** Fitted market-share scale, origin "founder". Pass it as `scale` for candidate sites. */
  scale: Sourced<number>;
  /** What the model predicts for the calibration site at scale 1, in the observed unit. */
  modelledAtUnitScale: number;
  /** The founder's count, in the same unit (customers per day, or per month). */
  observed: number;
}

/**
 * Step 4: fit one market-share scale so the calibration site (the founder's other location)
 * reproduces the founder's count. `input` describes that site; its own `scale` is ignored.
 */
export function calibrateScale(input: DemandInput, calibration: CalibrationInput): CalibrationResult {
  const estimate = estimateDemand({ ...input, scale: { value: 1, origin: "default" } });
  const { openMin, closeMin } = calibration;
  let modelled: number;
  let observed: number;
  if (calibration.kind === "daily_customers") {
    modelled = expectedDailyCustomers(estimate, calibration.dayType, openMin, closeMin);
    observed = calibration.dailyCustomers;
  } else {
    modelled =
      WEEKDAYS_PER_MONTH * expectedDailyCustomers(estimate, "weekday", openMin, closeMin) +
      WEEKEND_DAYS_PER_MONTH * expectedDailyCustomers(estimate, "weekend", openMin, closeMin);
    observed = calibration.monthlySalesUsd / calibration.avgTicketUsd;
  }
  if (!(modelled > 0)) throw new Error("calibration site has no modelled demand; cannot fit a scale");
  return { scale: { value: observed / modelled, origin: "founder" }, modelledAtUnitScale: modelled, observed };
}
