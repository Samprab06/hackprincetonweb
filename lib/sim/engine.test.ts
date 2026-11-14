import { describe, expect, it } from "vitest";
import type { ArrivalSchedule, Customer, SiteConfigInput, StayPoint } from "./contracts";
import { ASKED_LINE_LENGTHS } from "./contracts";
import { averageDayOutcome, computeMonthlyEconomics } from "./economics";
import {
  EngineInputError,
  nextAskedLineLength,
  patienceMin,
  resolveStationCount,
  simulateDay,
  stayProbabilityAt,
} from "./engine";
import { createRng } from "./random";

// ---------------------------------------------------------------------------
// Inline fixtures
// ---------------------------------------------------------------------------

const flat = (p: number): StayPoint[] => ASKED_LINE_LENGTHS.map((lineLength) => ({ lineLength, p }));

const CURVE: StayPoint[] = [
  { lineLength: 0, p: 1 },
  { lineLength: 2, p: 0.5 },
  { lineLength: 4, p: 0.5 },
  { lineLength: 6, p: 0.2 },
  { lineLength: 10, p: 0 },
];

function config(overrides: Partial<SiteConfigInput> = {}): SiteConfigInput {
  return {
    hours: { weekday: { openMin: 480, closeMin: 540 }, weekend: { openMin: 480, closeMin: 540 } },
    stations: { planned: 1, usableSf: 100, sfPerStation: 100 },
    service: { meanServiceMin: 10 },
    prices: { avgTicketUsd: 10 },
    staff: { headcount: 2, wageUsdPerHour: 20 },
    costs: { cogsPctOfRevenue: 0.3 },
    lease: {
      sf: 1000,
      askingRentUsdPerSfYear: 24,
      tripleNet: true,
      opexUsdPerSfYear: 6,
      buildoutUsd: 12000,
      leaseTermMonths: 60,
    },
    calendar: { weekdayDaysPerMonth: 20, weekendDaysPerMonth: 8 },
    ...overrides,
  };
}

function schedule(
  customers: Customer[],
  overrides: Partial<ArrivalSchedule> = {},
): ArrivalSchedule {
  return {
    siteId: "site-1",
    seed: 1,
    dayType: "weekday",
    openMin: 480,
    closeMin: 540,
    demandSource: "huff",
    stayCurves: [
      { personaId: "always", points: flat(1) },
      { personaId: "never", points: flat(0) },
      { personaId: "curve", points: CURVE },
    ],
    customers,
    params: {},
    ...overrides,
  };
}

const cust = (
  id: string,
  arrivalMin: number,
  serviceMin: number,
  personaId = "always",
  stayDraw = 0.5,
): Customer => ({ id, personaId, arrivalMin, serviceMin, stayDraw });

/** Hand-checkable day: 1 station, 60 open minutes, mean service 10, $10 ticket. */
const HAND_CUSTOMERS: Customer[] = [
  cust("a", 480, 10), // line 0, served 480-490, wait 0
  cust("b", 485, 10), // line 0 (a in service), patience 2*10=20, served 490-500, wait 5
  cust("c", 486, 10, "never"), // p = 0, balks
  cust("d", 487, 30), // line 1, patience 20, served 500-530, wait 13
  cust("e", 488, 5), // line 2, patience 4*10=40, reneges at 528 after waiting 40
  cust("f", 535, 10), // station free, in service at close (535-545)
  cust("g", 538, 10), // line 0 but station busy, waiting at close (patience ends 558)
  cust("h", 540, 10), // at close: outside hours
  cust("i", 470, 10), // before open: outside hours
];

/** Synthetic busy day: ~1 arrival a minute from 6am to 9pm, curved stay probabilities. */
function syntheticSchedule(seed: number): ArrivalSchedule {
  const rng = createRng(seed);
  const arrivals = rng.fork("arrivals");
  const draws = rng.fork("stay");
  const service = rng.fork("service");
  const personas = ["p1", "p2", "p3", "p4"];
  const customers: Customer[] = [];
  let t = 360;
  let n = 0;
  for (;;) {
    t += arrivals.exponential(1);
    if (t >= 1260) break;
    customers.push({
      id: `c${String(n++).padStart(5, "0")}`,
      personaId: personas[n % personas.length] as string,
      arrivalMin: t,
      stayDraw: draws.next(),
      serviceMin: service.lognormal(4, 0.4),
    });
  }
  return {
    siteId: "site-synth",
    seed,
    dayType: "weekday",
    openMin: 360,
    closeMin: 1260,
    demandSource: "jev",
    stayCurves: personas.map((personaId, i) => ({
      personaId,
      points: CURVE.map((pt) => ({ lineLength: pt.lineLength, p: Math.max(0, pt.p - i * 0.05) })),
    })),
    customers,
    params: { meanServiceMin: { value: 4, origin: "default" } },
  };
}

const synthConfig = config({
  hours: { weekday: { openMin: 360, closeMin: 1260 }, weekend: { openMin: 480, closeMin: 1200 } },
  stations: { planned: 3, usableSf: 1200, sfPerStation: 300 },
  service: {},
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hand-checkable day", () => {
  const result = simulateDay(schedule(HAND_CUSTOMERS), config());
  const m = result.metrics;

  it("reconciles arrivals, served, abandoned and close-of-day states", () => {
    expect(m).toMatchObject({
      stations: 1,
      arrivals: 7,
      arrivalsOutsideHours: 2,
      joined: 6,
      served: 3,
      balked: 1,
      reneged: 1,
      abandoned: 2,
      inServiceAtClose: 1,
      waitingAtClose: 1,
      revenueUsd: 30,
    });
    expect(m.served + m.abandoned + m.inServiceAtClose + m.waitingAtClose).toBe(m.arrivals);
    expect(m.meanWaitMin).toBeCloseTo(6); // (0 + 5 + 13) / 3
    expect(m.p90WaitMin).toBe(13);
    expect(m.stationUtilization).toBeCloseTo(55 / 60); // 10 + 10 + 30 + 5 busy minutes
  });

  it("emits the expected event trail", () => {
    const trail = result.events.map((e) => `${e.timeMin}:${e.type}:${e.customerId}`);
    expect(trail).toEqual([
      "480:arrival:a",
      "480:queue_entry:a",
      "480:service_start:a",
      "485:arrival:b",
      "485:queue_entry:b",
      "486:arrival:c",
      "487:arrival:d",
      "487:queue_entry:d",
      "488:arrival:e",
      "488:queue_entry:e",
      "490:completion:a",
      "490:service_start:b",
      "500:completion:b",
      "500:service_start:d",
      "528:abandonment:e",
      "530:completion:d",
      "535:arrival:f",
      "535:queue_entry:f",
      "535:service_start:f",
      "538:arrival:g",
      "538:queue_entry:g",
    ]);
    const arrivalE = result.events.find((e) => e.type === "arrival" && e.customerId === "e");
    expect(arrivalE).toMatchObject({ lineLength: 2, stayProbability: 1, decision: "join" });
    const entryE = result.events.find((e) => e.type === "queue_entry" && e.customerId === "e");
    expect(entryE).toMatchObject({ patienceMin: 40 });
    expect(result.events.find((e) => e.type === "abandonment")).toMatchObject({ waitMin: 40 });
  });

  it("reconciles monthly revenue, costs and contribution", () => {
    const weekend = simulateDay(schedule(HAND_CUSTOMERS, { dayType: "weekend" }), config());
    const econ = computeMonthlyEconomics(config(), {
      weekday: m,
      weekend: weekend.metrics,
    });
    // 28 days x $30, 2 staff x 1h x 28 days x $20, $24 x 1000 SF / 12, NNN $6 x 1000 / 12,
    // $12,000 buildout over 60 months.
    expect(econ.revenueUsd).toBeCloseTo(840);
    expect(econ.servedCustomers).toBe(84);
    expect(econ.costs.cogsUsd).toBeCloseTo(252);
    expect(econ.costs.staffHours).toBeCloseTo(56);
    expect(econ.costs.laborUsd).toBeCloseTo(1120);
    expect(econ.costs.baseRentUsd).toBeCloseTo(2000);
    expect(econ.costs.opexUsd).toBeCloseTo(500);
    expect(econ.costs.buildoutAmortizationUsd).toBeCloseTo(200);
    expect(econ.costs.totalUsd).toBeCloseTo(4072);
    expect(econ.contributionUsd).toBeCloseTo(-3232);
    expect(econ.operatingContributionUsd).toBeCloseTo(-3032);
    expect(econ.buildoutPaybackMonths).toBeNull();
  });
});

describe("monthly economics", () => {
  it("skips opex on a gross lease and reports payback separately", () => {
    const cfg = config({
      lease: {
        sf: 1000,
        askingRentUsdPerSfYear: 24,
        tripleNet: false,
        opexUsdPerSfYear: 6,
        buildoutUsd: 12000,
        leaseTermMonths: 60,
      },
    });
    const econ = computeMonthlyEconomics(cfg, {
      weekday: { revenueUsd: 1000, served: 100 },
      weekend: { revenueUsd: 1500, served: 150 },
    });
    expect(econ.revenueUsd).toBeCloseTo(32000);
    expect(econ.costs.opexUsd).toBe(0);
    expect(econ.costs.totalUsd).toBeCloseTo(9600 + 1120 + 2000 + 200);
    expect(econ.contributionUsd).toBeCloseTo(19080);
    expect(econ.operatingContributionUsd).toBeCloseTo(19280);
    expect(econ.buildoutPaybackMonths).toBeCloseTo(12000 / 19280);
  });

  it("averages day outcomes across seeds", () => {
    expect(averageDayOutcome([])).toEqual({ revenueUsd: 0, served: 0 });
    expect(
      averageDayOutcome([
        { revenueUsd: 10, served: 1 },
        { revenueUsd: 30, served: 3 },
      ]),
    ).toEqual({ revenueUsd: 20, served: 2 });
  });
});

describe("stay decision", () => {
  it("always joins with p = 1, however long the line and however high the draw", () => {
    const customers = Array.from({ length: 40 }, (_, i) =>
      cust(`x${String(i).padStart(2, "0")}`, 480 + i * 0.1, 50, "always", 0.999999),
    );
    const r = simulateDay(schedule(customers), config());
    const arrivals = r.events.filter((e) => e.type === "arrival");
    expect(arrivals).toHaveLength(40);
    expect(arrivals.every((e) => e.type === "arrival" && e.decision === "join")).toBe(true);
    expect(r.metrics.balked).toBe(0);
  });

  it("never joins with p = 0, even at an empty line with a zero draw", () => {
    const customers = Array.from({ length: 10 }, (_, i) => cust(`n${i}`, 480 + i, 5, "never", 0));
    const r = simulateDay(schedule(customers), config());
    expect(r.metrics).toMatchObject({ arrivals: 10, joined: 0, balked: 10, served: 0 });
    expect(r.events.every((e) => e.type === "arrival" && e.decision === "leave")).toBe(true);
  });

  it("interpolates between the asked line lengths and holds flat past the ends", () => {
    expect(stayProbabilityAt(CURVE, 0)).toBe(1);
    expect(stayProbabilityAt(CURVE, 1)).toBeCloseTo(0.75);
    expect(stayProbabilityAt(CURVE, 3)).toBeCloseTo(0.5);
    expect(stayProbabilityAt(CURVE, 5)).toBeCloseTo(0.35);
    expect(stayProbabilityAt(CURVE, 8)).toBeCloseTo(0.1);
    expect(stayProbabilityAt(CURVE, 10)).toBe(0);
    expect(stayProbabilityAt(CURVE, 25)).toBe(0);
  });

  it("uses the interpolated probability for the decision", () => {
    // 1 station: s0 in service, s1 waiting, so j and k each see a line of 1 (p = 0.75).
    const base = [cust("s0", 480, 50), cust("s1", 481, 50)];
    const join = simulateDay(schedule([...base, cust("j", 482, 5, "curve", 0.7)]), config());
    const leave = simulateDay(schedule([...base, cust("k", 482, 5, "curve", 0.8)]), config());
    expect(join.events.find((e) => e.customerId === "j")).toMatchObject({
      type: "arrival",
      lineLength: 1,
      stayProbability: 0.75,
      decision: "join",
    });
    expect(leave.events.find((e) => e.customerId === "k")).toMatchObject({
      type: "arrival",
      lineLength: 1,
      stayProbability: 0.75,
      decision: "leave",
    });
  });

  it("sets patience from the next asked line length", () => {
    expect([0, 1, 2, 3, 5, 6, 9, 10, 13, 14].map(nextAskedLineLength)).toEqual([
      2, 2, 4, 4, 6, 10, 10, 14, 14, 18,
    ]);
    expect(patienceMin(3, 6, 2)).toBe(12); // next asked 4, x 6 min / 2 stations
  });
});

describe("ordering and determinism", () => {
  it("processes a completion before an arrival at the same minute", () => {
    const r = simulateDay(schedule([cust("a", 480, 10), cust("b", 490, 10)]), config());
    const at490 = r.events.filter((e) => e.timeMin === 490).map((e) => `${e.type}:${e.customerId}`);
    expect(at490).toEqual(["completion:a", "arrival:b", "queue_entry:b", "service_start:b"]);
    expect(r.events.find((e) => e.type === "arrival" && e.customerId === "b")).toMatchObject({
      lineLength: 0,
    });
  });

  it("assigns the lowest free station deterministically", () => {
    const cfg = config({ stations: { planned: 3, usableSf: 900, sfPerStation: 300 } });
    const r = simulateDay(
      schedule([cust("a", 480, 30), cust("b", 481, 5), cust("c", 482, 30), cust("d", 490, 5)]),
      cfg,
    );
    const starts = r.events.filter((e) => e.type === "service_start");
    expect(starts.map((e) => (e.type === "service_start" ? e.stationIndex : -1))).toEqual([
      0, 1, 2, 1,
    ]);
  });

  it("gives identical events and metrics for identical inputs, whatever the input order", () => {
    const s = syntheticSchedule(42);
    const a = simulateDay(s, synthConfig);
    const b = simulateDay(structuredClone(s), synthConfig);
    const shuffled = { ...s, customers: createRng(7).shuffle([...s.customers]) };
    const c = simulateDay(shuffled, synthConfig);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.metrics.served).toBeGreaterThan(0);
  });
});

describe("explicit edge outcomes", () => {
  it("zero demand", () => {
    const r = simulateDay(schedule([]), config());
    expect(r.events).toEqual([]);
    expect(r.metrics).toMatchObject({
      arrivals: 0,
      served: 0,
      abandoned: 0,
      inServiceAtClose: 0,
      waitingAtClose: 0,
      meanWaitMin: null,
      p90WaitMin: null,
      stationUtilization: 0,
      revenueUsd: 0,
    });
    const econ = computeMonthlyEconomics(config(), { weekday: r.metrics, weekend: r.metrics });
    expect(econ.revenueUsd).toBe(0);
    expect(econ.contributionUsd).toBeCloseTo(-econ.costs.totalUsd);
    expect(econ.buildoutPaybackMonths).toBeNull();
  });

  it("full capacity: stations never idle, the line overflows into reneging", () => {
    const cfg = config({ stations: { planned: 2, usableSf: 1000, sfPerStation: 100 } });
    const customers = Array.from({ length: 60 }, (_, i) =>
      // Two at open, then one a minute: both stations busy from the first minute.
      cust(`q${String(i).padStart(2, "0")}`, 480 + Math.max(0, i - 1), 15),
    );
    const m = simulateDay(schedule(customers), cfg).metrics;
    expect(m.stations).toBe(2); // min(planned 2, 1000 / 100 = 10)
    expect(m.stationUtilization).toBe(1);
    expect(m.reneged).toBeGreaterThan(0);
    expect(m.waitingAtClose).toBeGreaterThan(0);
    expect(m.inServiceAtClose).toBe(2);
    expect(m.served + m.abandoned + m.inServiceAtClose + m.waitingAtClose).toBe(m.arrivals);
  });

  it("customers still in service at close earn nothing and are reported separately", () => {
    const r = simulateDay(schedule([cust("late", 530, 30)]), config());
    expect(r.metrics).toMatchObject({
      served: 0,
      inServiceAtClose: 1,
      waitingAtClose: 0,
      revenueUsd: 0,
      meanWaitMin: null,
    });
    expect(r.metrics.stationUtilization).toBeCloseTo(10 / 60);
    expect(r.events.some((e) => e.type === "completion")).toBe(false);
  });

  it("a completion at exactly closing time counts as served", () => {
    const r = simulateDay(schedule([cust("edge", 530, 10)]), config());
    expect(r.metrics).toMatchObject({ served: 1, inServiceAtClose: 0, revenueUsd: 10 });
  });

  it("station count is capped by usable SF", () => {
    expect(resolveStationCount({ stations: { planned: 6, usableSf: 1000, sfPerStation: 300 } })).toBe(
      3,
    );
    expect(resolveStationCount({ stations: { planned: 2, usableSf: 1000, sfPerStation: 300 } })).toBe(
      2,
    );
  });
});

describe("input validation", () => {
  function fieldErrors(fn: () => unknown): Record<string, string[]> {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(EngineInputError);
      return (e as EngineInputError).fieldErrors;
    }
    throw new Error("expected EngineInputError");
  }

  it("rejects negative durations", () => {
    const errs = fieldErrors(() => simulateDay(schedule([cust("a", 480, -5)]), config()));
    expect(Object.keys(errs)).toEqual(["schedule.customers.0.serviceMin"]);
  });

  it("rejects non-integer stations", () => {
    const errs = fieldErrors(() =>
      simulateDay(schedule([]), config({ stations: { planned: 2.5, usableSf: 100, sfPerStation: 50 } })),
    );
    expect(errs).toHaveProperty(["config.stations.planned"]);
  });

  it("rejects missing or inverted hours", () => {
    const missing = config();
    delete (missing.hours as Partial<SiteConfigInput["hours"]>).weekend;
    expect(fieldErrors(() => simulateDay(schedule([]), missing))).toHaveProperty([
      "config.hours.weekend",
    ]);
    const inverted = config({
      hours: { weekday: { openMin: 600, closeMin: 500 }, weekend: { openMin: 480, closeMin: 540 } },
    });
    expect(fieldErrors(() => simulateDay(schedule([]), inverted))).toHaveProperty([
      "config.hours.weekday.closeMin",
    ]);
  });

  it("rejects a space too small for one station and an unknown persona together", () => {
    const errs = fieldErrors(() =>
      simulateDay(
        schedule([cust("a", 480, 5, "ghost")]),
        config({ stations: { planned: 1, usableSf: 50, sfPerStation: 100 } }),
      ),
    );
    expect(errs).toHaveProperty(["schedule.customers.0.personaId"]);
    expect(errs).toHaveProperty(["config.stations.usableSf"]);
  });

  it("rejects bad economics config with field errors", () => {
    const bad = config({ costs: { cogsPctOfRevenue: 1.5 } });
    const errs = fieldErrors(() =>
      computeMonthlyEconomics(bad, {
        weekday: { revenueUsd: 0, served: 0 },
        weekend: { revenueUsd: 0, served: 0 },
      }),
    );
    expect(errs).toHaveProperty(["config.costs.cogsPctOfRevenue"]);
  });
});

describe("performance", () => {
  it("runs 30 seeds for one site in under 2 seconds", () => {
    const schedules = Array.from({ length: 30 }, (_, i) => syntheticSchedule(i + 1));
    const start = performance.now();
    const results = schedules.map((s) => simulateDay(s, synthConfig));
    const elapsed = performance.now() - start;
    console.log(
      `30 seeds, ${schedules.reduce((n, s) => n + s.customers.length, 0)} customers: ${elapsed.toFixed(0)} ms`,
    );
    expect(results).toHaveLength(30);
    expect(elapsed).toBeLessThan(2000);
  });
});
