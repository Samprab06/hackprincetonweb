import { describe, expect, it } from "vitest";
import { ArrivalSchedule, Origin, type DemandInput, type ScheduleRequest } from "./contracts";
import {
  COMPETITORS,
  FIXTURE_PERSONAS,
  FIXTURE_PERSONA_SET,
  SITE_A,
  SITE_B,
  huffInput,
  jevInput,
  makeBehaviorTable,
  makePersona,
  makeStore,
} from "./fixtures";
import { travelKm } from "./huff";
import { buildArrivalSchedule, calibrateScale, estimateDemand, expectedDailyCustomers } from "./model";

const REQ: ScheduleRequest = { seed: 42, dayType: "weekday", openMin: 6 * 60, closeMin: 19 * 60 };

function withBeta(beta: number): DemandInput {
  return huffInput(SITE_A, {
    demand: { source: "huff", huff: { competitors: COMPETITORS, beta: { value: beta, origin: "founder" } } },
  });
}

describe("determinism", () => {
  for (const [name, make] of [
    ["jev", () => jevInput()],
    ["huff", () => huffInput()],
  ] as const) {
    it(`same inputs and seed give the same ArrivalSchedule (${name})`, () => {
      const a = buildArrivalSchedule(make(), REQ);
      const b = buildArrivalSchedule(make(), REQ);
      expect(a.customers.length).toBeGreaterThan(0);
      expect(a.demandSource).toBe(name);
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    });

    it(`a different seed gives different customers (${name})`, () => {
      const a = buildArrivalSchedule(make(), REQ);
      const b = buildArrivalSchedule(make(), { ...REQ, seed: 43 });
      expect(b.customers).not.toEqual(a.customers);
    });
  }

  it("weekday and weekend draw different streams", () => {
    const a = buildArrivalSchedule(jevInput(), REQ);
    const b = buildArrivalSchedule(jevInput(), { ...REQ, dayType: "weekend" });
    expect(b.customers).not.toEqual(a.customers);
  });
});

describe("schedule shape", () => {
  it("validates, sorts customers and keeps them inside opening hours", () => {
    const s = buildArrivalSchedule(huffInput(), REQ);
    expect(() => ArrivalSchedule.parse(s)).not.toThrow();
    for (let i = 1; i < s.customers.length; i++) {
      const prev = s.customers[i - 1]!;
      const cur = s.customers[i]!;
      expect(prev.arrivalMin < cur.arrivalMin || (prev.arrivalMin === cur.arrivalMin && prev.id < cur.id)).toBe(true);
    }
    for (const c of s.customers) {
      expect(c.arrivalMin).toBeGreaterThanOrEqual(REQ.openMin);
      expect(c.arrivalMin).toBeLessThan(REQ.closeMin);
      expect(c.stayDraw).toBeGreaterThanOrEqual(0);
      expect(c.stayDraw).toBeLessThan(1);
      expect(c.serviceMin).toBeGreaterThan(0);
    }
    expect(new Set(s.customers.map((c) => c.id)).size).toBe(s.customers.length);
    expect(s.params["arrivals.clippedPersonaHours"]!.value).toBe(0);
  });

  it("gives a stay curve, sorted by line length, for every persona that has customers", () => {
    const s = buildArrivalSchedule(jevInput(), REQ);
    const curves = new Map(s.stayCurves.map((c) => [c.personaId, c.points]));
    for (const c of s.customers) expect(curves.has(c.personaId)).toBe(true);
    for (const points of curves.values()) {
      expect(points.map((p) => p.lineLength)).toEqual([0, 2, 4, 6, 10]);
    }
  });
});

describe("jev behavior table", () => {
  it("expected visits per persona = weight x visits per month x where share", () => {
    const input = jevInput();
    const table = input.demand.source === "jev" ? input.demand.behavior : undefined;
    const est = estimateDemand(input);
    expect(est.personas).toHaveLength(FIXTURE_PERSONAS.length);
    for (const pd of est.personas) {
      const persona = FIXTURE_PERSONAS.find((p) => p.id === pd.personaId)!;
      const row = table!.personas.find((r) => r.personaId === pd.personaId)!;
      const expected = persona.weight * row.visitsPerMonth * row.where[SITE_A.id]!;
      expect(pd.expectedVisitsPerMonth).toBeCloseTo(expected, 9);
    }
  });

  it("applies the market-share scale on top", () => {
    const base = estimateDemand(jevInput());
    const scaled = estimateDemand(jevInput(SITE_A, { scale: { value: 1.3, origin: "founder" } }));
    scaled.personas.forEach((p, i) => {
      expect(p.expectedVisitsPerMonth).toBeCloseTo(base.personas[i]!.expectedVisitsPerMonth * 1.3, 9);
    });
  });

  it("leaves out failed personas and rejects a table for another site", () => {
    const failed = ["c1-res-02", "c1-wrk-01"];
    const est = estimateDemand(
      jevInput(SITE_A, { demand: { source: "jev", behavior: makeBehaviorTable(SITE_A.id, FIXTURE_PERSONAS, failed) } }),
    );
    expect(est.excludedPersonaIds).toEqual(failed);
    expect(est.personas.map((p) => p.personaId)).not.toContain("c1-res-02");
    expect(est.params["jev.excludedPersonas"]).toEqual({ value: 2, origin: "public" });
    expect(() =>
      estimateDemand(jevInput(SITE_A, { demand: { source: "jev", behavior: makeBehaviorTable(SITE_B.id) } })),
    ).toThrow(/behavior table/);
  });
});

describe("huff fallback", () => {
  const daily = (input: DemandInput) => expectedDailyCustomers(estimateDemand(input), "weekday", REQ.openMin, REQ.closeMin);

  it("more nearby residents raises visits", () => {
    const base = daily(huffInput());
    const more = daily(
      huffInput(SITE_A, {
        personaSet: {
          ...FIXTURE_PERSONA_SET,
          personas: [...FIXTURE_PERSONAS, makePersona("c1-res-new", "resident", 0.2, -0.3, { weight: 800 })],
        },
      }),
    );
    expect(more).toBeGreaterThan(base);
  });

  it("a closer competitor lowers visits", () => {
    const base = daily(huffInput());
    const moved = COMPETITORS.map((c) => (c.id === "comp-x" ? { ...c, location: makeStore("tmp", 0.2, 0.3).location } : c));
    const closer = daily(huffInput(SITE_A, { demand: { source: "huff", huff: { competitors: moved } } }));
    expect(closer).toBeLessThan(base);
  });

  it("a higher beta shrinks the catchment", () => {
    // Visit-weighted mean travel distance of the site's customers.
    const meanDistance = (input: DemandInput) => {
      const est = estimateDemand(input);
      let num = 0;
      let den = 0;
      for (const pd of est.personas) {
        const p = FIXTURE_PERSONAS.find((x) => x.id === pd.personaId)!;
        num += pd.expectedVisitsPerMonth * travelKm(p.location, SITE_A.location, "houston");
        den += pd.expectedVisitsPerMonth;
      }
      return num / den;
    };
    const low = meanDistance(withBeta(1));
    const mid = meanDistance(withBeta(2));
    const high = meanDistance(withBeta(3));
    expect(mid).toBeLessThan(low);
    expect(high).toBeLessThan(mid);
  });

  it("ignores stores out of range and gives zero share when the site is out of range", () => {
    const far = makePersona("c1-far", "resident", 0, 30, { commuteMode: "walk" });
    const est = estimateDemand(huffInput(SITE_A, { personaSet: { catchmentId: "c1", personas: [far] } }));
    expect(est.personas[0]!.share).toBe(0);
  });
});

describe("cross-candidate customer stability", () => {
  it("sites sharing a catchment see the same customer draws for the same seed", () => {
    const a = buildArrivalSchedule(jevInput(SITE_A), REQ);
    const b = buildArrivalSchedule(jevInput(SITE_B), REQ);
    const byId = new Map(b.customers.map((c) => [c.id, c]));
    const shared = a.customers.filter((c) => byId.has(c.id));
    expect(shared.length).toBeGreaterThan(10);
    for (const c of shared) expect(byId.get(c.id)).toEqual(c);
  });

  it("a site with a lower rate everywhere gets a subset of the customers", () => {
    const full = buildArrivalSchedule(huffInput(), REQ);
    const half = buildArrivalSchedule(huffInput(SITE_A, { scale: { value: 0.5, origin: "founder" } }), REQ);
    const fullById = new Map(full.customers.map((c) => [c.id, c]));
    expect(half.customers.length).toBeLessThan(full.customers.length);
    for (const c of half.customers) expect(fullById.get(c.id)).toEqual(c);
  });

  it("the same customers appear under Huff for every candidate (common stream)", () => {
    const a = buildArrivalSchedule(huffInput(SITE_A), REQ);
    const b = buildArrivalSchedule(huffInput(SITE_B), REQ);
    const byId = new Map(b.customers.map((c) => [c.id, c]));
    let shared = 0;
    for (const c of a.customers) {
      const other = byId.get(c.id);
      if (other) {
        shared++;
        expect(other).toEqual(c);
      }
    }
    expect(shared).toBeGreaterThan(0);
  });
});

describe("calibration", () => {
  it("reproduces a supplied daily customer count within 5% for the calibration site", () => {
    const site = huffInput();
    const observed = 180;
    const fit = calibrateScale(site, { kind: "daily_customers", dailyCustomers: observed, ...REQ });
    expect(fit.scale.origin).toBe("founder");

    const calibrated = { ...site, scale: fit.scale };
    const s = buildArrivalSchedule(calibrated, REQ);
    expect(Math.abs(s.params["expected.dailyCustomers"]!.value - observed) / observed).toBeLessThan(0.05);
    expect(s.params["expected.dailyCustomers"]!.origin).toBe("founder");

    // Realized arrivals, averaged over seeds, also land within 5%.
    let total = 0;
    const seeds = 40;
    for (let seed = 0; seed < seeds; seed++) {
      total += buildArrivalSchedule(calibrated, { ...REQ, seed }).customers.length;
    }
    expect(Math.abs(total / seeds - observed) / observed).toBeLessThan(0.05);
  });

  it("fits a scale from monthly sales and average ticket (jev)", () => {
    const site = jevInput();
    const fit = calibrateScale(site, {
      kind: "monthly_sales",
      monthlySalesUsd: 60_000,
      avgTicketUsd: 6,
      openMin: REQ.openMin,
      closeMin: REQ.closeMin,
    });
    const est = estimateDemand({ ...site, scale: fit.scale });
    const monthly =
      (365.25 / 7 / 12) *
      (5 * expectedDailyCustomers(est, "weekday", REQ.openMin, REQ.closeMin) +
        2 * expectedDailyCustomers(est, "weekend", REQ.openMin, REQ.closeMin));
    expect(Math.abs(monthly - 10_000) / 10_000).toBeLessThan(0.05);
  });

  it("without calibration, keeps the default scale and its sensitivity range", () => {
    const s = buildArrivalSchedule(huffInput(), REQ);
    expect(s.params["scale"]).toEqual({ value: 1, origin: "default" });
    expect(s.params["scale.low"]!.value).toBeLessThan(1);
    expect(s.params["scale.high"]!.value).toBeGreaterThan(1);
  });
});

describe("origins", () => {
  for (const [name, make] of [
    ["jev", () => jevInput()],
    ["huff", () => huffInput()],
  ] as const) {
    it(`every parameter in the output carries an origin (${name})`, () => {
      const s = buildArrivalSchedule(make(), REQ);
      const entries = Object.entries(s.params);
      expect(entries.length).toBeGreaterThan(10);
      for (const [key, v] of entries) {
        expect(Origin.safeParse(v.origin).success, key).toBe(true);
        expect(Number.isFinite(v.value), key).toBe(true);
      }
      expect(s.params["rate.h07"]).toBeDefined();
      expect(s.params["expected.dailyCustomers"]).toBeDefined();
    });
  }

  it("Huff attractiveness takes the storefront's origin and founder overrides keep theirs", () => {
    const s = buildArrivalSchedule(withBeta(2.5), REQ);
    expect(s.params[`huff.attractiveness.${SITE_A.id}`]!.origin).toBe("costar");
    expect(s.params["huff.beta"]).toEqual({ value: 2.5, origin: "founder" });
    expect(s.params["huff.alpha"]!.origin).toBe("default");
  });
});
