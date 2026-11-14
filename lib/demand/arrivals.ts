/**
 * Time of day and seeded arrivals.
 *
 * Cross-candidate stability (common random numbers):
 *   For each persona we build one shared *candidate stream* that does not depend on the site.
 *   Its RNG is `createRng(seed).fork("demand:<catchmentId>:<dayType>:<personaId>")`, and it is a
 *   homogeneous Poisson process with rate weight * ENVELOPE_VISITS_PER_PERSON_HOUR / 60 per
 *   minute over GENERATION_WINDOW (05:00-21:00). Every candidate k in the stream always draws,
 *   in order: its gap (exponential), a thinning uniform u, a stayDraw uniform and a service time
 *   (lognormal, two uniforms). A site keeps candidate k iff u < rate_site(t) / envelope(t).
 *   The customer id is "<personaId>#<k>".
 *
 *   So for the same seed, every site sharing a catchment sees customers drawn from the same
 *   stream: a person who would visit both A and B has the same id, arrival minute, stayDraw and
 *   service time at both, and a site whose rate is higher everywhere gets a superset of
 *   customers. Thinning a Poisson process by rate(t) / envelope gives a non-homogeneous Poisson
 *   process with rate(t), so arrivals per site are still exact.
 *
 *   If a site's rate ever exceeds the envelope, it is clipped to the envelope and the number of
 *   clipped persona-hours is reported in params as "arrivals.clippedPersonaHours".
 */
import { createRng } from "../sim/random";
import type { Customer, DayType, TimeBlock } from "./contracts";
import { TIME_BLOCKS, TIME_BLOCK_HOURS } from "./contracts";
import { ENVELOPE_VISITS_PER_PERSON_HOUR, GENERATION_WINDOW } from "./defaults";

/**
 * Per-minute arrival rate for each hour of the day (24 entries), given expected visits per
 * day if the site were open through every time block. Block shares are spread evenly over the
 * block's hours. Opening hours are applied later by rateAt / expectedVisitsByHour: visits that
 * fall outside [openMin, closeMin) are lost (the customer finds the site closed).
 */
export function ratePerMinuteByHour(
  dailyVisits: number,
  timeBlocks: Record<TimeBlock, number>,
): number[] {
  const rates = new Array<number>(24).fill(0);
  const total = TIME_BLOCKS.reduce((s, b) => s + timeBlocks[b], 0);
  if (!(total > 0) || !(dailyVisits > 0)) return rates;
  for (const block of TIME_BLOCKS) {
    const [h0, h1] = TIME_BLOCK_HOURS[block];
    const perHour = (dailyVisits * (timeBlocks[block] / total)) / (h1 - h0);
    for (let h = h0; h < h1; h++) rates[h] = perHour / 60;
  }
  return rates;
}

/** Rate (per minute) at minute t, honouring opening hours. */
export function rateAt(ratesByHour: readonly number[], t: number, openMin: number, closeMin: number): number {
  if (t < openMin || t >= closeMin) return 0;
  return ratesByHour[Math.floor(t / 60)] ?? 0;
}

/** Expected visits in each clock hour (24 entries) within opening hours. */
export function expectedVisitsByHour(
  ratesByHour: readonly number[],
  openMin: number,
  closeMin: number,
): number[] {
  const out = new Array<number>(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const lo = Math.max(h * 60, openMin);
    const hi = Math.min((h + 1) * 60, closeMin);
    if (hi > lo) out[h] = (ratesByHour[h] ?? 0) * (hi - lo);
  }
  return out;
}

export interface PersonaRate {
  personaId: string;
  weight: number;
  /** Per-minute rate for each clock hour, from ratePerMinuteByHour. */
  ratesByHour: readonly number[];
}

export interface ArrivalOptions {
  seed: number;
  catchmentId: string;
  dayType: DayType;
  openMin: number;
  closeMin: number;
  serviceMeanMin: number;
  serviceCv: number;
}

export interface ArrivalResult {
  customers: Customer[];
  clippedPersonaHours: number;
}

/** Label of the shared per-persona candidate stream. */
export function streamLabel(catchmentId: string, dayType: DayType, personaId: string): string {
  return `demand:${catchmentId}:${dayType}:${personaId}`;
}

/** Seeded non-homogeneous Poisson arrivals by thinning a site-independent shared stream. */
export function generateArrivals(personas: readonly PersonaRate[], opts: ArrivalOptions): ArrivalResult {
  const root = createRng(opts.seed);
  const [w0, w1] = GENERATION_WINDOW;
  const customers: Customer[] = [];
  let clippedPersonaHours = 0;

  for (const p of personas) {
    if (!(p.weight > 0)) continue;
    const envelope = (p.weight * ENVELOPE_VISITS_PER_PERSON_HOUR) / 60;
    for (let h = 0; h < 24; h++) {
      if ((p.ratesByHour[h] ?? 0) > envelope) clippedPersonaHours++;
    }
    const rng = root.fork(streamLabel(opts.catchmentId, opts.dayType, p.personaId));
    let t = w0;
    for (let k = 0; ; k++) {
      t += rng.exponential(envelope);
      if (t >= w1) break;
      const u = rng.next();
      const stayDraw = rng.next();
      const serviceMin = rng.lognormal(opts.serviceMeanMin, opts.serviceCv);
      const rate = Math.min(envelope, rateAt(p.ratesByHour, t, opts.openMin, opts.closeMin));
      if (u < rate / envelope) {
        customers.push({ id: `${p.personaId}#${k}`, personaId: p.personaId, arrivalMin: t, stayDraw, serviceMin });
      }
    }
  }

  customers.sort((a, b) => a.arrivalMin - b.arrivalMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { customers, clippedPersonaHours };
}
