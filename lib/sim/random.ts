/**
 * The one seeded random generator for the whole project. Never use Math.random.
 * Pure TypeScript, no Node-only imports, so it runs in route handlers and the browser.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer uniform in [lo, hi] inclusive. */
  int(lo: number, hi: number): number;
  /** Exponential with the given rate (mean 1 / rate). */
  exponential(rate: number): number;
  /** Standard normal scaled to mean and sd (Box-Muller). */
  normal(mean?: number, sd?: number): number;
  /** Lognormal parameterised by its arithmetic mean and coefficient of variation. */
  lognormal(mean: number, cv: number): number;
  /** In-place Fisher-Yates shuffle; returns the same array. */
  shuffle<T>(items: T[]): T[];
  /** Independent child stream, stable for a given (parent seed, label). */
  fork(label: string): Rng;
}

/** 32-bit FNV-1a hash of a string, used to turn labels and string seeds into numbers. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number | string): Rng {
  const baseSeed = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  const draw = mulberry32(baseSeed);

  const rng: Rng = {
    next: draw,
    int(lo, hi) {
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) {
        throw new RangeError(`int(${lo}, ${hi}) needs integers with lo <= hi`);
      }
      return lo + Math.floor(draw() * (hi - lo + 1));
    },
    exponential(rate) {
      if (!(rate > 0)) throw new RangeError(`exponential rate must be > 0, got ${rate}`);
      return -Math.log(1 - draw()) / rate;
    },
    normal(mean = 0, sd = 1) {
      const u1 = 1 - draw();
      const u2 = draw();
      return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    lognormal(mean, cv) {
      if (!(mean > 0) || !(cv >= 0)) throw new RangeError("lognormal needs mean > 0 and cv >= 0");
      const sigma2 = Math.log(1 + cv * cv);
      const mu = Math.log(mean) - sigma2 / 2;
      return Math.exp(rng.normal(mu, Math.sqrt(sigma2)));
    },
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(draw() * (i + 1));
        const tmp = items[i] as (typeof items)[number];
        items[i] = items[j] as (typeof items)[number];
        items[j] = tmp;
      }
      return items;
    },
    fork(label) {
      return createRng(hashString(`${baseSeed}:${label}`));
    },
  };
  return rng;
}
