import { describe, expect, it } from "vitest";
import { PersonaSetSchema } from "./contracts";
import { allocate, buildPersonas, catchmentTotals, weightTotals } from "./personas";
import { catchment } from "./__fixtures__";

describe("buildPersonas", () => {
  it("yields the same personas for the same catchment", () => {
    const a = buildPersonas(catchment);
    const b = buildPersonas(structuredClone(catchment));
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("matches the shared PersonaSet contract with unique ids", () => {
    const set = buildPersonas(catchment);
    expect(() => PersonaSetSchema.parse(set)).not.toThrow();
    const ids = set.personas.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^c1-res-bg\d+-\d{2}$/);
  });

  it("builds the requested count, clamped to 30..100", () => {
    expect(buildPersonas(catchment).personas).toHaveLength(50);
    expect(buildPersonas(catchment, { count: 10 }).personas).toHaveLength(30);
    expect(buildPersonas(catchment, { count: 75 }).personas).toHaveLength(75);
    expect(buildPersonas(catchment, { count: 500 }).personas).toHaveLength(100);
  });

  it.each([30, 50, 64, 100])("weights sum to population, workers and pass-by exactly (%i personas)", (count) => {
    const set = buildPersonas(catchment, { count });
    const totals = catchmentTotals(catchment);
    expect(weightTotals(set)).toEqual(totals);
    expect(totals).toEqual({ resident: 7300, worker: 3105, passby: 5750 });
    for (const p of set.personas) {
      expect(Number.isInteger(p.weight)).toBe(true);
      expect(p.weight).toBeGreaterThan(0);
    }
  });

  it("covers every kind and builds segments, modes and descriptions by code", () => {
    const set = buildPersonas(catchment);
    const kinds = new Set(set.personas.map((p) => p.kind));
    expect(kinds).toEqual(new Set(["resident", "worker", "passby"]));
    for (const p of set.personas) {
      expect(p.description).toMatch(/^\d+, household income \$\d+k, (lives nearby|works nearby|passes by), /);
      if (p.kind === "resident") expect(p.segment).toMatch(/^resident_(low|mid|high)_income$/);
      else expect(p.segment).toBe(p.kind);
      expect(p.age).toBeGreaterThanOrEqual(18);
    }
  });

  it("changes when the catchment changes", () => {
    const other = buildPersonas({ ...catchment, catchmentId: "c2" });
    const base = buildPersonas(catchment);
    expect(other.personas.map((p) => p.incomeUsd)).not.toEqual(base.personas.map((p) => p.incomeUsd));
    expect(weightTotals(other)).toEqual(weightTotals(base));
  });

  it("folds block groups without a persona into a neighbour so no one is dropped", () => {
    const many = {
      ...catchment,
      blockGroups: Array.from({ length: 60 }, (_, i) => ({
        ...catchment.blockGroups[i % catchment.blockGroups.length]!,
        geoid: `48201990${String(i).padStart(4, "0")}`,
        lat: 29.74 + i * 0.0005,
      })),
    };
    const set = buildPersonas(many, { count: 30 });
    expect(weightTotals(set).resident).toBe(catchmentTotals(many).resident);
    expect(set.personas).toHaveLength(30);
  });
});

describe("allocate", () => {
  it("distributes integer slots proportionally with minimums", () => {
    expect(allocate(10, [1, 1])).toEqual([5, 5]);
    expect(allocate(10, [100, 1, 0], [0, 4, 0])).toEqual([10 - 4, 4, 0]);
    const r = allocate(7, [3, 3, 3]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(7);
  });
});
