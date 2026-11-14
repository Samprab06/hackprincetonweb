/**
 * Discrete-event queue engine for one site and one day (HAC-13).
 *
 * Pure TypeScript: no Node-only or database imports, and no randomness of its own. Every
 * random quantity (arrival time, stay draw, service time) is pre-drawn in the ArrivalSchedule,
 * so identical inputs always give identical events and metrics.
 */
import type { ZodError } from "zod";
import {
  ASKED_LINE_LENGTHS,
  ArrivalScheduleSchema,
  SiteConfigSchema,
  type ArrivalSchedule,
  type Customer,
  type DailyMetrics,
  type DayResult,
  type SimEvent,
  type SiteConfig,
  type StayPoint,
} from "./contracts";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Field path (dot separated, prefixed with `schedule` or `config`) -> messages. */
export type FieldErrors = Record<string, string[]>;

export class EngineInputError extends Error {
  readonly fieldErrors: FieldErrors;
  constructor(fieldErrors: FieldErrors) {
    const summary = Object.entries(fieldErrors)
      .map(([path, msgs]) => `${path}: ${msgs.join("; ")}`)
      .join(", ");
    super(`Invalid engine input: ${summary}`);
    this.name = "EngineInputError";
    this.fieldErrors = fieldErrors;
  }
}

function collect(prefix: string, error: ZodError, into: FieldErrors): void {
  for (const issue of error.issues) {
    const path = [prefix, ...issue.path].join(".");
    (into[path] ??= []).push(issue.message);
  }
}

export type EngineInput = { schedule: ArrivalSchedule; config: SiteConfig };

/** Validates both inputs; throws EngineInputError carrying every field error. */
export function parseEngineInput(schedule: unknown, config: unknown): EngineInput {
  const s = ArrivalScheduleSchema.safeParse(schedule);
  const c = SiteConfigSchema.safeParse(config);
  const errors: FieldErrors = {};
  if (!s.success) collect("schedule", s.error, errors);
  if (!c.success) collect("config", c.error, errors);
  if (!s.success || !c.success) throw new EngineInputError(errors);
  return { schedule: s.data, config: c.data };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Station count = min(planned stations, floor(usable SF / SF per station)). */
export function resolveStationCount(config: Pick<SiteConfig, "stations">): number {
  const { planned, usableSf, sfPerStation } = config.stations;
  return Math.min(planned, Math.floor(usableSf / sfPerStation));
}

/**
 * Stay probability at a line length, linearly interpolated between the curve's points
 * (normally the asked lengths 0, 2, 4, 6, 10) and held flat beyond the first and last point.
 * `points` must be ascending by lineLength (the schema enforces it).
 */
export function stayProbabilityAt(points: readonly StayPoint[], lineLength: number): number {
  const first = points[0];
  if (!first) throw new RangeError("stay curve has no points");
  if (lineLength <= first.lineLength) return first.p;
  for (let i = 1; i < points.length; i++) {
    const hi = points[i] as StayPoint;
    if (lineLength <= hi.lineLength) {
      const lo = points[i - 1] as StayPoint;
      const t = (lineLength - lo.lineLength) / (hi.lineLength - lo.lineLength);
      return lo.p + t * (hi.p - lo.p);
    }
  }
  return (points[points.length - 1] as StayPoint).p;
}

/**
 * The next asked line length strictly above `lineLength`. Past the last asked length (10)
 * the asked spacing keeps going in steps of the last gap (4): 11 -> 14, 14 -> 18.
 */
export function nextAskedLineLength(lineLength: number): number {
  for (const asked of ASKED_LINE_LENGTHS) if (asked > lineLength) return asked;
  const last = ASKED_LINE_LENGTHS[ASKED_LINE_LENGTHS.length - 1] as number;
  const step = last - (ASKED_LINE_LENGTHS[ASKED_LINE_LENGTHS.length - 2] as number);
  return last + step * (Math.floor((lineLength - last) / step) + 1);
}

/**
 * Patience of a customer who joined behind `lineLength` people: the wait implied by the next
 * asked line length, i.e. nextAsked x meanServiceMin / stations.
 */
export function patienceMin(lineLength: number, meanServiceMin: number, stations: number): number {
  return (nextAskedLineLength(lineLength) * meanServiceMin) / stations;
}

/** Nearest-rank percentile of an ascending array; null when empty. */
export function percentile(sortedAsc: readonly number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.max(1, Math.ceil(q * sortedAsc.length));
  return sortedAsc[rank - 1] as number;
}

// ---------------------------------------------------------------------------
// Event queue: ordered by time, then event priority, then customer id
// ---------------------------------------------------------------------------

/** Completions before abandonments before arrivals at equal times. */
const PRIORITY = { completion: 0, abandonment: 1, arrival: 2 } as const;
type PendingKind = keyof typeof PRIORITY;
type Pending = { timeMin: number; kind: PendingKind; customerId: string; stationIndex: number };

function before(a: Pending, b: Pending): boolean {
  if (a.timeMin !== b.timeMin) return a.timeMin < b.timeMin;
  if (a.kind !== b.kind) return PRIORITY[a.kind] < PRIORITY[b.kind];
  return a.customerId < b.customerId;
}

class EventHeap {
  private items: Pending[] = [];
  get size(): number {
    return this.items.length;
  }
  peek(): Pending | undefined {
    return this.items[0];
  }
  push(item: Pending): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(a[i] as Pending, a[parent] as Pending)) break;
      [a[i], a[parent]] = [a[parent] as Pending, a[i] as Pending];
      i = parent;
    }
  }
  pop(): Pending | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && before(a[l] as Pending, a[m] as Pending)) m = l;
        if (r < a.length && before(a[r] as Pending, a[m] as Pending)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m] as Pending, a[i] as Pending];
        i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Simulates one day. Validates both inputs (throws EngineInputError with field errors).
 *
 * Opening hours come from `config.hours[schedule.dayType]`. Customers arriving before open or
 * at/after close are counted in `arrivalsOutsideHours` and not simulated. The day stops at
 * close: completions and abandonments at exactly closeMin still happen; anyone still in service
 * or in line after that is reported in `inServiceAtClose` / `waitingAtClose`, earns no revenue
 * and is neither served nor abandoned.
 */
export function simulateDay(schedule: unknown, config: unknown): DayResult {
  const input = parseEngineInput(schedule, config);
  return simulateParsedDay(input.schedule, input.config);
}

/** simulateDay without validation, for inputs already parsed with the schemas. */
export function simulateParsedDay(schedule: ArrivalSchedule, config: SiteConfig): DayResult {
  const { openMin, closeMin } = config.hours[schedule.dayType];
  const stations = resolveStationCount(config);
  const price = config.prices.avgTicketUsd;

  const curves = new Map<string, StayPoint[]>();
  for (const c of schedule.stayCurves) curves.set(c.personaId, c.points);

  const customers = new Map<string, Customer>();
  const heap = new EventHeap();
  let arrivalsOutsideHours = 0;
  let serviceSum = 0;
  // Canonical order (arrivalMin, then id) so float sums do not depend on input order.
  const sorted = [...schedule.customers].sort((a, b) =>
    a.arrivalMin !== b.arrivalMin ? a.arrivalMin - b.arrivalMin : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const c of sorted) {
    serviceSum += c.serviceMin;
    if (c.arrivalMin < openMin || c.arrivalMin >= closeMin) {
      arrivalsOutsideHours++;
      continue;
    }
    customers.set(c.id, c);
    heap.push({ timeMin: c.arrivalMin, kind: "arrival", customerId: c.id, stationIndex: -1 });
  }
  const meanServiceMin =
    config.service.meanServiceMin ??
    (schedule.customers.length > 0 ? serviceSum / schedule.customers.length : 0);

  const events: SimEvent[] = [];
  const stationBusy: boolean[] = new Array<boolean>(stations).fill(false);
  /** Customer ids waiting in line, in arrival order. */
  const line: string[] = [];
  const queuedAt = new Map<string, number>();
  /** Waits of customers whose service completed (served customers only). */
  const servedWaits: number[] = [];
  type InService = { customerId: string; startMin: number; waitMin: number };
  const inService = new Map<number, InService>();
  let busyMinutes = 0;
  let arrivals = 0;
  let joined = 0;
  let served = 0;
  let balked = 0;
  let reneged = 0;
  let revenueUsd = 0;

  const startService = (customerId: string, stationIndex: number, timeMin: number): void => {
    const c = customers.get(customerId) as Customer;
    const waitMin = timeMin - (queuedAt.get(customerId) as number);
    queuedAt.delete(customerId);
    stationBusy[stationIndex] = true;
    inService.set(stationIndex, { customerId, startMin: timeMin, waitMin });
    events.push({ type: "service_start", timeMin, customerId, stationIndex, waitMin });
    heap.push({ timeMin: timeMin + c.serviceMin, kind: "completion", customerId, stationIndex });
  };

  while (heap.size > 0) {
    const next = heap.peek() as Pending;
    if (next.timeMin > closeMin) break;
    heap.pop();
    const t = next.timeMin;

    if (next.kind === "completion") {
      const s = inService.get(next.stationIndex) as InService;
      inService.delete(next.stationIndex);
      stationBusy[next.stationIndex] = false;
      busyMinutes += t - s.startMin;
      served++;
      servedWaits.push(s.waitMin);
      revenueUsd += price;
      events.push({
        type: "completion",
        timeMin: t,
        customerId: next.customerId,
        stationIndex: next.stationIndex,
        revenueUsd: price,
      });
      const head = line.shift();
      if (head !== undefined) startService(head, next.stationIndex, t);
      continue;
    }

    if (next.kind === "abandonment") {
      // Stale if the customer already started service.
      const idx = line.indexOf(next.customerId);
      if (idx === -1) continue;
      line.splice(idx, 1);
      const waitMin = t - (queuedAt.get(next.customerId) as number);
      queuedAt.delete(next.customerId);
      reneged++;
      events.push({ type: "abandonment", timeMin: t, customerId: next.customerId, waitMin });
      continue;
    }

    // Arrival: look at the line, then join or leave.
    const c = customers.get(next.customerId) as Customer;
    arrivals++;
    const lineLength = line.length;
    const stayProbability = stayProbabilityAt(curves.get(c.personaId) as StayPoint[], lineLength);
    const decision = c.stayDraw < stayProbability ? "join" : "leave";
    events.push({
      type: "arrival",
      timeMin: t,
      customerId: c.id,
      personaId: c.personaId,
      lineLength,
      stayProbability,
      decision,
    });
    if (decision === "leave") {
      balked++;
      continue;
    }
    joined++;
    const patience = patienceMin(lineLength, meanServiceMin, stations);
    queuedAt.set(c.id, t);
    events.push({ type: "queue_entry", timeMin: t, customerId: c.id, patienceMin: patience });
    const free = stationBusy.indexOf(false);
    if (free !== -1) {
      startService(c.id, free, t);
    } else {
      line.push(c.id);
      heap.push({ timeMin: t + patience, kind: "abandonment", customerId: c.id, stationIndex: -1 });
    }
  }

  for (const s of inService.values()) busyMinutes += closeMin - s.startMin;
  servedWaits.sort((a, b) => a - b);
  const meanWaitMin =
    servedWaits.length > 0 ? servedWaits.reduce((a, b) => a + b, 0) / servedWaits.length : null;

  const metrics: DailyMetrics = {
    dayType: schedule.dayType,
    openMin,
    closeMin,
    stations,
    arrivals,
    arrivalsOutsideHours,
    joined,
    served,
    balked,
    reneged,
    abandoned: balked + reneged,
    inServiceAtClose: inService.size,
    waitingAtClose: line.length,
    meanWaitMin,
    p90WaitMin: percentile(servedWaits, 0.9),
    stationUtilization: busyMinutes / (stations * (closeMin - openMin)),
    revenueUsd,
  };
  return { siteId: schedule.siteId, seed: schedule.seed, events, metrics };
}
