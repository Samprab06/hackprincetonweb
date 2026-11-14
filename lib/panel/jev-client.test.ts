import { describe, expect, it } from "vitest";
import { createJevClient, createJevClientFromEnv, createLimiter, JevError, JEV_MODEL_VERSION } from "./jev-client";
import { buildPersonas } from "./personas";
import { buildQuestions, buildState, type PanelContext } from "./state";
import { catchment, coffeeNeed, recorded, recordedFetch } from "./__fixtures__";

const ctx: PanelContext = { site: catchment.site, competitors: catchment.competitors, need: coffeeNeed };
const persona = buildPersonas(catchment).personas[0]!;
const request = { state: buildState(persona, ctx), questions: buildQuestions(ctx).questions };

function client(fetchStub: typeof fetch, delays: number[] = [], extra: { maxRetries?: number } = {}) {
  return createJevClient({
    baseUrl: "https://jev.test/",
    apiKey: "test-key",
    fetch: fetchStub,
    sleep: async (ms) => {
      delays.push(ms);
    },
    baseDelayMs: 100,
    ...extra,
  });
}

describe("Jev client against recorded responses (offline)", () => {
  it("sends the assumed wire request and normalises the recorded answer", async () => {
    const rec = recordedFetch();
    const result = await client(rec.fetch).ask(request);

    expect(rec.requests).toHaveLength(1);
    const sent = rec.requests[0]!;
    expect(sent.url).toBe("https://jev.test/v1/decide");
    expect(sent.headers.authorization).toBe("Bearer test-key");
    expect(sent.body.model).toBe(JEV_MODEL_VERSION);
    expect(sent.body.questions.map((q) => q.type)).toEqual([
      "Choice",
      "Score",
      "Choice",
      "Noul",
      "Noul",
      "Noul",
      "Noul",
      "Noul",
      "Noul",
    ]);

    expect(result.modelVersion).toBe("jev-1.14.0");
    expect(Object.keys(result.answers.where!.probabilities).sort()).toEqual(["comp_1", "comp_2", "none", "site_a"]);
    expect(result.answers.stay_at_queue_0!.probabilities.yes).toBeGreaterThan(0.9);
    expect(result.answers.stay_at_queue_0!.probabilities.no).toBeCloseTo(1 - result.answers.stay_at_queue_0!.probabilities.yes!);
    expect(result.answers.how_often!.confidence).toBeGreaterThan(0);
  });

  it("retries 503 and 429 with exponential backoff and Retry-After", async () => {
    const rec = recordedFetch({ statuses: [503, 429, 503] });
    const delays: number[] = [];
    const result = await client(rec.fetch, delays).ask(request);
    expect(result.answers.where).toBeDefined();
    expect(rec.requests).toHaveLength(4);
    expect(delays).toEqual([100, 1000, 400]); // 100*2^0, Retry-After 1s, 100*2^2
  });

  it("gives up after maxRetries", async () => {
    const rec = recordedFetch({ statuses: [503, 503, 503] });
    await expect(client(rec.fetch, [], { maxRetries: 2 }).ask(request)).rejects.toBeInstanceOf(JevError);
    expect(rec.requests).toHaveLength(3);
  });

  it("does not retry client errors", async () => {
    const rec = recordedFetch({ statuses: [400] });
    await expect(client(rec.fetch).ask(request)).rejects.toMatchObject({ status: 400, retryable: false });
    expect(rec.requests).toHaveLength(1);
  });

  it("rejects malformed responses without retrying", async () => {
    const rec = recordedFetch({ body: recorded.malformed });
    await expect(client(rec.fetch).ask(request)).rejects.toThrow(/Malformed|missing/);
    expect(rec.requests).toHaveLength(1);
  });

  it("retries network errors", async () => {
    let n = 0;
    const rec = recordedFetch();
    const flaky = (async (...args: Parameters<typeof fetch>) => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return rec.fetch(...args);
    }) as typeof fetch;
    await expect(client(flaky).ask(request)).resolves.toBeDefined();
    expect(n).toBe(2);
  });

  it("limits requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const rec = recordedFetch();
    const slow = (async (...args: Parameters<typeof fetch>) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return rec.fetch(...args);
    }) as typeof fetch;
    const c = createJevClient({ baseUrl: "https://jev.test", apiKey: "k", fetch: slow, concurrency: 3 });
    await Promise.all(Array.from({ length: 12 }, () => c.ask(request)));
    expect(peak).toBe(3);
  });

  it("limiter keeps FIFO order and propagates errors", async () => {
    const limit = createLimiter(1);
    const order: number[] = [];
    const results = await Promise.allSettled(
      [1, 2, 3].map((i) =>
        limit(async () => {
          order.push(i);
          if (i === 2) throw new Error("boom");
          return i;
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("needs JEV_API_KEY and JEV_BASE_URL from the environment", () => {
    expect(() => createJevClientFromEnv({})).toThrow(/JEV_API_KEY/);
    expect(() => createJevClientFromEnv({ JEV_API_KEY: "k" })).toThrow(/JEV_BASE_URL/);
  });
});

// Live test: only runs with a real key (and JEV_BASE_URL). Never runs in CI by default.
describe.skipIf(!process.env.JEV_API_KEY)("Jev live [live]", () => {
  it("answers one persona x site call", async () => {
    const live = createJevClientFromEnv(process.env, { maxRetries: 1 });
    const result = await live.ask(request);
    expect(result.modelVersion).toBe(JEV_MODEL_VERSION);
    for (const q of request.questions) expect(result.answers[q.name]).toBeDefined();
  }, 60_000);
});
