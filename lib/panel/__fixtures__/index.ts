/**
 * Test fixtures for the panel: a small Houston catchment, a coffee need, a fetch stub that
 * replays recorded Jev responses, and a fake in-process Jev client for scale runs.
 * No network access anywhere in here.
 */
import { createRng, hashString } from "@/lib/sim/random";
import { CatchmentInputSchema, type CandidateSite, type CatchmentInput, type NeedSpec } from "../contracts";
import { createLimiter, JEV_MODEL_VERSION, type JevAskRequest, type JevAskResult, type JevClient } from "../jev-client";
import catchmentJson from "./catchment-houston-montrose.json";
import recordedJson from "./jev-recorded.json";

export const catchment: CatchmentInput = CatchmentInputSchema.parse(catchmentJson);
export const recorded = recordedJson;

export const coffeeNeed: NeedSpec = { businessType: "coffee", priceUsd: 6, serviceMinPerCustomer: 2 };

/** `n` candidate sites spread around the fixture catchment. */
export function makeSites(n: number): CandidateSite[] {
  const frontages: CandidateSite["frontage"][] = ["corner", "inline", "endcap", "pad"];
  return Array.from({ length: n }, (_, i) => ({
    id: `site_${String.fromCharCode(97 + i)}`,
    lat: catchment.site.lat + 0.002 * Math.cos(i),
    lng: catchment.site.lng + 0.002 * Math.sin(i),
    frontage: frontages[i % frontages.length]!,
    opensMin: 360 + 30 * (i % 3),
    hasParking: i % 2 === 0,
  }));
}

interface WireBody {
  model: string;
  questions: { name: string; type: string; options?: { id: string }[] }[];
}

/**
 * A `fetch` stub that replays recorded responses. The variant is chosen from the `where`
 * option order, so each shuffled order gets a stable recorded answer. `statuses` scripts
 * HTTP failures for the first calls (e.g. [503, 429] then success).
 */
export function recordedFetch(opts: { statuses?: number[]; body?: unknown } = {}) {
  const requests: { url: string; body: WireBody; headers: Record<string, string> }[] = [];
  const statuses = [...(opts.statuses ?? [])];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as WireBody;
    requests.push({ url: String(input), body, headers: init?.headers as Record<string, string> });
    const status = statuses.shift();
    if (status !== undefined && status !== 200) {
      return new Response(JSON.stringify({ error: "recorded failure" }), {
        status,
        headers: status === 429 ? { "retry-after": "1" } : {},
      });
    }
    const where = body.questions.find((q) => q.name === "where");
    const order = (where?.options ?? []).map((o) => o.id).join(",");
    const variant = recorded.variants[hashString(order) % recorded.variants.length]!;
    return new Response(JSON.stringify(opts.body ?? variant), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchStub, requests };
}

/**
 * In-process fake Jev for scale tests. Answers are seeded by the request, so they are stable
 * per request, differ between option orders, and favour the first-listed option a little,
 * mimicking Jev's order sensitivity.
 */
export function fakeJevClient(opts: { delayMs?: number; concurrency?: number; fail?: (req: JevAskRequest) => boolean } = {}) {
  const limit = createLimiter(opts.concurrency ?? 16);
  let calls = 0;
  const client: JevClient & { readonly calls: number } = {
    modelVersion: JEV_MODEL_VERSION,
    get calls() {
      return calls;
    },
    ask(req) {
      return limit(async () => {
        calls++;
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (opts.fail?.(req)) throw new Error("fake Jev failure");
        const rng = createRng(hashString(JSON.stringify(req)));
        const answers: JevAskResult["answers"] = {};
        for (const q of req.questions) {
          if (q.type === "noul") {
            const p = 0.2 + 0.75 * rng.next();
            answers[q.name] = { probabilities: { yes: p, no: 1 - p }, confidence: 0.5 + 0.4 * rng.next() };
          } else {
            const ids = q.type === "choice" ? q.options.map((o) => o.id) : q.levels.map((l) => l.id);
            const raw = ids.map((_, i) => (i === 0 ? 1.3 : 1) * (0.2 + rng.next()));
            const total = raw.reduce((a, b) => a + b, 0);
            answers[q.name] = {
              probabilities: Object.fromEntries(ids.map((id, i) => [id, raw[i]! / total])),
              confidence: 0.5 + 0.4 * rng.next(),
            };
          }
        }
        return { modelVersion: JEV_MODEL_VERSION, answers };
      });
    },
  };
  return client;
}
