/**
 * Jev REST client.
 *
 * The REST endpoint is not confirmed yet (HAC-14). Everything that depends on the wire
 * format lives in the "Wire format" section below (`toWireRequest`, `WireResponseSchema`,
 * `fromWireResponse`, `JEV_PATH`). The rest of the panel only sees `JevAskRequest` and
 * `JevAskResult`, so a change to the real API touches this section alone.
 */
import { z } from "zod";

export const JEV_MODEL_VERSION = "jev-1.14.0";

// ---------------------------------------------------------------------------
// Panel-facing types (stable)
// ---------------------------------------------------------------------------

export interface JevState {
  person: string;
  need: string;
  options: Record<string, string>;
}

export type JevQuestion =
  | { name: string; type: "choice"; prompt: string; options: { id: string; label: string }[] }
  | { name: string; type: "score"; prompt: string; levels: { id: string; label: string }[] }
  | { name: string; type: "noul"; prompt: string };

export interface JevAskRequest {
  state: JevState;
  questions: JevQuestion[];
}

/**
 * One answer, normalised. Choice and Score: a probability for every option id. Noul:
 * `{ yes: p, no: 1 - p }`. Probabilities are stored, never only the pick.
 */
export interface JevAnswer {
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevAskResult {
  modelVersion: string;
  answers: Record<string, JevAnswer>;
}

export interface JevClient {
  readonly modelVersion: string;
  ask(request: JevAskRequest): Promise<JevAskResult>;
}

// ---------------------------------------------------------------------------
// Wire format (assumed; replace when HAC-14 confirms the API)
// ---------------------------------------------------------------------------
//
// POST {baseUrl}/v1/decide
// Authorization: Bearer <JEV_API_KEY>
// {
//   "model": "jev-1.14.0",
//   "state": { ... },
//   "questions": [
//     { "name": "where", "type": "Choice", "prompt": "...", "options": [{ "id": "site_a", "label": "site_a" }, ...] },
//     { "name": "how_often", "type": "Score", "prompt": "...", "rubric": [{ "id": "never", "label": "never" }, ...] },
//     { "name": "stay_at_queue_4", "type": "Noul", "prompt": "..." }
//   ]
// }
// 200 ->
// {
//   "model": "jev-1.14.0",
//   "answers": [
//     { "name": "where", "type": "Choice", "choice": "site_a", "probabilities": { "site_a": 0.6, ... }, "confidence": 0.82 },
//     { "name": "how_often", "type": "Score", "level": "weekly", "probabilities": { "never": 0.05, ... }, "confidence": 0.7 },
//     { "name": "stay_at_queue_4", "type": "Noul", "p_yes": 0.64, "confidence": 0.6 }
//   ]
// }

export const JEV_PATH = "/v1/decide";

export function toWireRequest(modelVersion: string, req: JevAskRequest): unknown {
  return {
    model: modelVersion,
    state: req.state,
    questions: req.questions.map((q) => {
      if (q.type === "choice") return { name: q.name, type: "Choice", prompt: q.prompt, options: q.options };
      if (q.type === "score") return { name: q.name, type: "Score", prompt: q.prompt, rubric: q.levels };
      return { name: q.name, type: "Noul", prompt: q.prompt };
    }),
  };
}

const ProbabilityMap = z.record(z.string(), z.number().min(0).max(1));
const WireAnswerSchema = z.discriminatedUnion("type", [
  z.object({
    name: z.string(),
    type: z.literal("Choice"),
    choice: z.string(),
    probabilities: ProbabilityMap,
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    name: z.string(),
    type: z.literal("Score"),
    level: z.string(),
    probabilities: ProbabilityMap,
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    name: z.string(),
    type: z.literal("Noul"),
    p_yes: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
  }),
]);
export const WireResponseSchema = z.object({
  model: z.string(),
  answers: z.array(WireAnswerSchema),
});
export type WireResponse = z.infer<typeof WireResponseSchema>;

export function fromWireResponse(raw: unknown, req: JevAskRequest): JevAskResult {
  const parsed = WireResponseSchema.parse(raw);
  const answers: Record<string, JevAnswer> = {};
  for (const a of parsed.answers) {
    answers[a.name] =
      a.type === "Noul"
        ? { probabilities: { yes: a.p_yes, no: 1 - a.p_yes }, confidence: a.confidence }
        : { probabilities: a.probabilities, confidence: a.confidence };
  }
  for (const q of req.questions) {
    if (!answers[q.name]) throw new JevError(`Jev response is missing question "${q.name}"`, false);
  }
  return { modelVersion: parsed.model, answers };
}

// ---------------------------------------------------------------------------
// HTTP client: concurrency limit, timeout, retry with exponential backoff
// ---------------------------------------------------------------------------

export class JevError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export interface JevHttpClientOptions {
  baseUrl: string;
  apiKey: string;
  modelVersion?: string;
  /** Max requests in flight. Default 8. */
  concurrency?: number;
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number;
  /** Backoff base; attempt n waits base * 2^n (or Retry-After). Default 500 ms. */
  baseDelayMs?: number;
  /** Per-attempt timeout. Default 20 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createJevClient(opts: JevHttpClientOptions): JevClient {
  const modelVersion = opts.modelVersion ?? JEV_MODEL_VERSION;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const limit = createLimiter(opts.concurrency ?? 8);
  const url = opts.baseUrl.replace(/\/+$/, "") + JEV_PATH;

  async function attempt(req: JevAskRequest): Promise<{ ok: true; value: JevAskResult } | { ok: false; error: JevError; retryAfterMs?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify(toWireRequest(modelVersion, req)),
        signal: controller.signal,
      });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        const retryAfter = Number(res.headers.get("retry-after"));
        return {
          ok: false,
          error: new JevError(`Jev HTTP ${res.status}`, retryable, res.status),
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        };
      }
      const body: unknown = await res.json();
      try {
        return { ok: true, value: fromWireResponse(body, req) };
      } catch (e) {
        if (e instanceof JevError) return { ok: false, error: e };
        return { ok: false, error: new JevError(`Malformed Jev response: ${(e as Error).message}`, false) };
      }
    } catch (e) {
      // Network failure or timeout.
      return { ok: false, error: new JevError(`Jev request failed: ${(e as Error).message}`, true) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    modelVersion,
    ask(req) {
      return limit(async () => {
        let last: JevError | undefined;
        for (let n = 0; n <= maxRetries; n++) {
          const r = await attempt(req);
          if (r.ok) return r.value;
          last = r.error;
          if (!r.error.retryable || n === maxRetries) break;
          await sleep(r.retryAfterMs ?? baseDelayMs * 2 ** n);
        }
        throw last ?? new JevError("Jev request failed", false);
      });
    },
  };
}

/** Client from environment: JEV_API_KEY and JEV_BASE_URL. */
export function createJevClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<JevHttpClientOptions> = {},
): JevClient {
  const apiKey = env.JEV_API_KEY;
  const baseUrl = env.JEV_BASE_URL;
  if (!apiKey) throw new Error("JEV_API_KEY is not set");
  if (!baseUrl) throw new Error("JEV_BASE_URL is not set (endpoint to be confirmed in HAC-14)");
  return createJevClient({ baseUrl, apiKey, ...overrides });
}

/** Simple FIFO concurrency limiter. */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  if (!(max >= 1)) throw new RangeError("concurrency must be >= 1");
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(resolve, reject).finally(next);
      };
      if (active < max) run();
      else queue.push(run);
    });
}
