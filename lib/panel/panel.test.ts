import { describe, expect, it } from "vitest";
import { hashString } from "@/lib/sim/random";
import { BehaviorTableSchema } from "./contracts";
import { MemoryJevCache } from "./cache";
import { createJevClient, fromWireResponse } from "./jev-client";
import { aggregate, planCalls, runPanel, runPanelForSites } from "./panel";
import { buildPersonas } from "./personas";
import type { PanelContext } from "./state";
import { catchment, coffeeNeed, fakeJevClient, makeSites, recorded, recordedFetch } from "./__fixtures__";

const personaSet = buildPersonas(catchment);
const base = { personaSet, site: catchment.site, competitors: catchment.competitors, need: coffeeNeed };
const ctx: PanelContext = { site: catchment.site, competitors: catchment.competitors, need: coffeeNeed };

function recordedClient(statuses?: number[]) {
  const rec = recordedFetch({ statuses });
  const c = createJevClient({ baseUrl: "https://jev.test", apiKey: "k", fetch: rec.fetch, sleep: async () => {} });
  return { client: c, requests: rec.requests };
}

describe("runPanel with recorded Jev responses (offline)", () => {
  it("produces a BehaviorTable matching the shared contract", async () => {
    const { client, requests } = recordedClient();
    const { table, stats } = await runPanel({ ...base, client, cache: new MemoryJevCache() });

    expect(() => BehaviorTableSchema.parse(table)).not.toThrow();
    expect(table.siteId).toBe("site_a");
    expect(table.modelVersion).toBe("jev-1.14.0");
    expect(table.failedPersonaIds).toEqual([]);
    expect(table.personas).toHaveLength(50);
    expect(stats.calls).toBe(50 * 4);
    expect(requests).toHaveLength(50 * 4);

    for (const b of table.personas) {
      const whereSum = Object.values(b.where).reduce((a, x) => a + x, 0);
      const timeSum = Object.values(b.timeBlocks).reduce((a, x) => a + x, 0);
      expect(whereSum).toBeCloseTo(1, 9);
      expect(timeSum).toBeCloseTo(1, 9);
      expect(Object.keys(b.where).sort()).toEqual(["comp_1", "comp_2", "none", "site_a"]);
      expect(b.stayByLineLength.map((s) => s.lineLength)).toEqual([0, 2, 4, 6, 10]);
      expect(b.priceAcceptance).toEqual([{ price: 6, p: expect.any(Number) }]);
      expect(b.visitsPerMonth).toBeGreaterThan(3);
      expect(b.visitsPerMonth).toBeLessThan(10);
      expect(b.cacheKeys).toHaveLength(4);
      expect(new Set(b.cacheKeys).size).toBe(4);
    }
  });

  it("makes zero Jev calls on a second run with unchanged inputs", async () => {
    const cache = new MemoryJevCache();
    const first = recordedClient();
    const run1 = await runPanel({ ...base, client: first.client, cache });
    expect(run1.stats.calls).toBe(200);

    const second = recordedClient();
    const run2 = await runPanel({ ...base, client: second.client, cache });
    expect(second.requests).toHaveLength(0);
    expect(run2.stats).toMatchObject({ calls: 0, cacheHits: 200 });
    expect(run2.table).toEqual(run1.table);
  });

  it("misses the cache when an input changes", async () => {
    const cache = new MemoryJevCache();
    await runPanel({ ...base, client: recordedClient().client, cache });
    const changed = recordedClient();
    const run = await runPanel({ ...base, need: { ...coffeeNeed, priceUsd: 7 }, client: changed.client, cache });
    expect(run.stats.calls).toBe(200);
  });

  it("averages the shuffled orders and reports the spread per persona", async () => {
    const { client } = recordedClient();
    const { table } = await runPanel({ ...base, client, cache: new MemoryJevCache() });
    const plan = planCalls(personaSet, ctx, 0, 4);

    for (const [i, b] of table.personas.entries()) {
      // Recompute from the recorded variant each order received.
      const variants = plan[i]!.calls.map((c) => fromWireResponse(variantFor(c.request), c.request));
      const expected = (id: string) => variants.reduce((a, v) => a + v.answers.where!.probabilities[id]!, 0) / 4;
      for (const id of ["site_a", "comp_1", "comp_2", "none"]) {
        const sumAll = ["site_a", "comp_1", "comp_2", "none"].reduce((a, k) => a + expected(k), 0);
        expect(b.where[id]).toBeCloseTo(expected(id) / sumAll, 9);
      }
      const spread = Math.max(
        ...["site_a", "comp_1", "comp_2", "none"].map((id) => {
          const vals = variants.map((v) => v.answers.where!.probabilities[id]!);
          return Math.max(...vals) - Math.min(...vals);
        }),
      );
      expect(b.orderSpread).toBeCloseTo(spread, 9);
    }
    // The four orders don't all land on the same recorded variant, so spread shows up.
    expect(table.personas.some((b) => b.orderSpread > 0.05)).toBe(true);
  });

  it("aggregate reports zero spread when all orders agree", () => {
    const v = recorded.variants[0]!;
    const plan = planCalls(personaSet, ctx, 0, 4)[0]!;
    const results = plan.calls.map((c) => fromWireResponse(v, c.request));
    const b = aggregate("p", ctx, results, ["a", "b", "c", "d"]);
    expect(b.orderSpread).toBe(0);
    expect(b.where.site_a).toBeCloseTo(0.46);
    expect(b.stayByLineLength[2]).toEqual({ lineLength: 4, p: 0.71 });
    expect(b.visitsPerMonth).toBeCloseTo(0.18 * 1 + 0.41 * 4.3 + 0.27 * 12 + 0.08 * 26);
  });

  it("returns partial results with the failed personas listed, then resumes from the cache", async () => {
    const cache = new MemoryJevCache();
    const failing = new Set(personaSet.personas.slice(0, 3).map((p) => p.id));
    const plan = planCalls(personaSet, ctx, 0, 4);
    const failingRequests = new Set(
      plan.filter((p) => failing.has(p.persona.id)).map((p) => JSON.stringify(p.calls[0]!.request)),
    );
    const flaky = fakeJevClient({ fail: (req) => failingRequests.has(JSON.stringify(req)) });

    const run1 = await runPanel({ ...base, client: flaky, cache });
    expect(new Set(run1.table.failedPersonaIds)).toEqual(failing);
    expect(run1.table.personas).toHaveLength(47);
    expect(run1.stats.failedCalls).toBe(3);
    expect(cache.size).toBe(200 - 3); // every answer that arrived was written

    const healthy = fakeJevClient();
    const run2 = await runPanel({ ...base, client: healthy, cache });
    expect(healthy.calls).toBe(3); // only the cut-off calls are re-asked
    expect(run2.table.failedPersonaIds).toEqual([]);
    expect(run2.table.personas).toHaveLength(50);
  });
});

describe("fixture run: 50 personas x 8 sites", () => {
  it("reports the call count and run time", async () => {
    const sites = makeSites(8);
    const client = fakeJevClient({ delayMs: 1, concurrency: 32 });
    const cache = new MemoryJevCache();
    const opts = { personaSet, competitors: catchment.competitors, need: coffeeNeed, client, cache, sites };

    const cold = await runPanelForSites(opts);
    const warm = await runPanelForSites(opts);

    console.info(
      `[HAC-15] 50 personas x 8 sites x 4 orders: cold ${cold.stats.calls} Jev calls in ${cold.stats.elapsedMs.toFixed(0)} ms ` +
        `(mock, 1 ms latency, concurrency 32); warm ${warm.stats.calls} calls, ${warm.stats.cacheHits} cache hits in ${warm.stats.elapsedMs.toFixed(0)} ms`,
    );
    expect(personaSet.personas).toHaveLength(50);
    expect(cold.tables).toHaveLength(8);
    expect(cold.stats.calls).toBe(50 * 8 * 4);
    expect(client.calls).toBe(1600);
    expect(cold.stats.elapsedMs).toBeGreaterThan(0);
    expect(warm.stats).toMatchObject({ calls: 0, cacheHits: 1600 });
    expect(warm.tables).toEqual(cold.tables);
    for (const t of cold.tables) {
      expect(t.personas).toHaveLength(50);
      expect(Object.keys(t.personas[0]!.where).sort()).toEqual(["comp_1", "comp_2", "none", t.siteId].sort());
    }
  });
});

function variantFor(req: { questions: { name: string }[] }) {
  // Mirror recordedFetch's variant choice: hash of the where option order.
  const where = req.questions.find((q) => q.name === "where") as unknown as { options: { id: string }[] };
  const order = where.options.map((o) => o.id).join(",");
  return recorded.variants[hashString(order) % recorded.variants.length]!;
}
