/**
 * Jev customer panel: asks every persona about one candidate site and aggregates the answers
 * into a `BehaviorTable`.
 *
 * Each persona x site is asked `orders` times (default 4), each time with the Choice options
 * (`where`, `when`) in a different seeded shuffle; all answers are averaged and the spread of
 * `where` between orders is reported. Every call's answer is written to the cache as soon as it
 * arrives, so a run cut off by a time limit resumes from the cache and an unchanged rerun
 * makes zero Jev calls.
 */
import { createRng } from "@/lib/sim/random";
import {
  ASKED_LINE_LENGTHS,
  BehaviorTableSchema,
  TIME_BLOCKS,
  type BehaviorTable,
  type CandidateSite,
  type Competitor,
  type NeedSpec,
  type PersonaBehavior,
  type PersonaSet,
  type TimeBlock,
} from "./contracts";
import { jevCacheKey, type JevCache } from "./cache";
import type { JevAskRequest, JevAskResult, JevClient } from "./jev-client";
import {
  HOW_OFTEN_LEVELS,
  VISITS_PER_MONTH,
  buildQuestions,
  buildState,
  priceQuestionName,
  pricePoints,
  stayQuestionName,
  whereOptionIds,
  type PanelContext,
} from "./state";

export const DEFAULT_ORDERS = 4;

export interface RunPanelOptions {
  personaSet: PersonaSet;
  site: CandidateSite;
  competitors: Competitor[];
  need: NeedSpec;
  client: JevClient;
  cache: JevCache;
  /** Seed for the option-order shuffles. Default 0. */
  seed?: number | string;
  /** Shuffled orders per persona. Default 4. */
  orders?: number;
  pricePoints?: number[];
  /** Called after each persona finishes (for progress reporting). */
  onPersona?: (personaId: string, ok: boolean) => void;
}

export interface PanelStats {
  /** Jev calls actually sent (cache misses). */
  calls: number;
  cacheHits: number;
  failedCalls: number;
  elapsedMs: number;
}

export interface PanelRun {
  table: BehaviorTable;
  stats: PanelStats;
}

/** One planned Jev call for a persona: the order index, the request and its cache key. */
interface PlannedCall {
  order: number;
  request: JevAskRequest;
}

export function planCalls(personaSet: PersonaSet, ctx: PanelContext, seed: number | string, orders: number) {
  const root = createRng(seed);
  return personaSet.personas.map((persona) => {
    const calls: PlannedCall[] = [];
    for (let order = 0; order < orders; order++) {
      const rng = root.fork(`${persona.id}|${ctx.site.id}|order${order}`);
      const { questions, whereOrder } = buildQuestions(ctx, rng);
      calls.push({ order, request: { state: buildState(persona, ctx, whereOrder), questions } });
    }
    return { persona, calls };
  });
}

export async function runPanel(opts: RunPanelOptions): Promise<PanelRun> {
  const started = performance.now();
  const ctx: PanelContext = {
    site: opts.site,
    competitors: opts.competitors,
    need: opts.need,
    pricePoints: opts.pricePoints,
  };
  const orders = Math.max(1, opts.orders ?? DEFAULT_ORDERS);
  const modelVersion = opts.client.modelVersion;
  const stats: PanelStats = { calls: 0, cacheHits: 0, failedCalls: 0, elapsedMs: 0 };
  const plan = planCalls(opts.personaSet, ctx, opts.seed ?? 0, orders);

  const outcomes = await Promise.all(
    plan.map(async ({ persona, calls }) => {
      const settled = await Promise.allSettled(
        calls.map(async (call) => {
          const key = await jevCacheKey(modelVersion, call.request);
          const hit = await opts.cache.get(key);
          if (hit) {
            stats.cacheHits++;
            return { key, result: hit };
          }
          stats.calls++;
          try {
            const result = await opts.client.ask(call.request);
            await opts.cache.set(key, result); // write as it arrives
            return { key, result };
          } catch (e) {
            stats.failedCalls++;
            throw e;
          }
        }),
      );
      const ok = settled.every((s) => s.status === "fulfilled");
      opts.onPersona?.(persona.id, ok);
      if (!ok) return { personaId: persona.id, behavior: undefined };
      const answers = settled.map((s) => (s as PromiseFulfilledResult<{ key: string; result: JevAskResult }>).value);
      return {
        personaId: persona.id,
        behavior: aggregate(
          persona.id,
          ctx,
          answers.map((a) => a.result),
          answers.map((a) => a.key),
        ),
      };
    }),
  );

  const table: BehaviorTable = {
    siteId: opts.site.id,
    modelVersion,
    personas: outcomes.flatMap((o) => (o.behavior ? [o.behavior] : [])),
    failedPersonaIds: outcomes.filter((o) => !o.behavior).map((o) => o.personaId),
  };
  stats.elapsedMs = performance.now() - started;
  return { table: BehaviorTableSchema.parse(table), stats };
}

/** Runs the panel for several candidate sites on the same personas, one table per site. */
export async function runPanelForSites(
  opts: Omit<RunPanelOptions, "site"> & { sites: CandidateSite[] },
): Promise<{ tables: BehaviorTable[]; stats: PanelStats }> {
  const started = performance.now();
  const { sites, ...rest } = opts;
  const runs = await Promise.all(sites.map((site) => runPanel({ ...rest, site })));
  const stats: PanelStats = {
    calls: sum(runs.map((r) => r.stats.calls)),
    cacheHits: sum(runs.map((r) => r.stats.cacheHits)),
    failedCalls: sum(runs.map((r) => r.stats.failedCalls)),
    elapsedMs: performance.now() - started,
  };
  return { tables: runs.map((r) => r.table), stats };
}

// ---------------------------------------------------------------------------
// Aggregation across orders
// ---------------------------------------------------------------------------

export function aggregate(personaId: string, ctx: PanelContext, results: JevAskResult[], cacheKeys: string[]): PersonaBehavior {
  const whereIds = whereOptionIds(ctx);
  const perOrderWhere = results.map((r) => normalize(pick(r, "where").probabilities, whereIds));
  const where = normalize(meanMaps(perOrderWhere, whereIds), whereIds);
  let orderSpread = 0;
  for (const id of whereIds) {
    const vals = perOrderWhere.map((m) => m[id] ?? 0);
    orderSpread = Math.max(orderSpread, Math.max(...vals) - Math.min(...vals));
  }

  const howOften = normalize(
    meanMaps(
      results.map((r) => pick(r, "how_often").probabilities),
      HOW_OFTEN_LEVELS,
    ),
    HOW_OFTEN_LEVELS,
  );
  const visitsPerMonth = HOW_OFTEN_LEVELS.reduce((acc, lvl) => acc + (howOften[lvl] ?? 0) * VISITS_PER_MONTH[lvl], 0);

  const whenMap = normalize(
    meanMaps(
      results.map((r) => pick(r, "when").probabilities),
      TIME_BLOCKS,
    ),
    TIME_BLOCKS,
  );
  const timeBlocks = Object.fromEntries(TIME_BLOCKS.map((b) => [b, whenMap[b] ?? 0])) as Record<TimeBlock, number>;

  const stayNames = ASKED_LINE_LENGTHS.map(stayQuestionName);
  const stayByLineLength = ASKED_LINE_LENGTHS.map((lineLength, i) => ({
    lineLength,
    p: clamp01(mean(results.map((r) => pick(r, stayNames[i]!).probabilities.yes ?? 0))),
  }));

  const prices = pricePoints(ctx);
  const priceNames = prices.map(priceQuestionName);
  const priceAcceptance = prices.map((price, i) => ({
    price,
    p: clamp01(mean(results.map((r) => pick(r, priceNames[i]!).probabilities.yes ?? 0))),
  }));

  const conf = (names: string[]) => mean(results.flatMap((r) => names.map((n) => pick(r, n).confidence)));
  return {
    personaId,
    where,
    visitsPerMonth,
    timeBlocks,
    stayByLineLength,
    priceAcceptance,
    confidence: {
      where: conf(["where"]),
      howOften: conf(["how_often"]),
      when: conf(["when"]),
      stay: conf(stayNames),
      price: conf(priceNames),
    },
    orderSpread: clamp01(orderSpread),
    cacheKeys,
  };
}

function pick(r: JevAskResult, name: string) {
  const a = r.answers[name];
  if (!a) throw new Error(`Jev result missing answer "${name}"`);
  return a;
}

/** Restricts to `ids` (missing -> 0) and rescales to sum 1; uniform if all zero. */
function normalize(m: Record<string, number>, ids: readonly string[]): Record<string, number> {
  const total = ids.reduce((acc, id) => acc + Math.max(0, m[id] ?? 0), 0);
  return Object.fromEntries(ids.map((id) => [id, total > 0 ? Math.max(0, m[id] ?? 0) / total : 1 / ids.length]));
}

function meanMaps(maps: Record<string, number>[], ids: readonly string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, mean(maps.map((m) => m[id] ?? 0))]));
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
