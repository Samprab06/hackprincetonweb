/**
 * Jev answer cache. Keyed by a SHA-256 of model version + state + questions (the exact
 * request body), so any change to the persona, site, option order or question text is a
 * miss and an unchanged input is a hit. Values are normalised probabilities, not picks.
 *
 * The production implementation is the Postgres `jev_cache` table (see README.md for the
 * proposed Drizzle definition, to be added to lib/db/schema.ts once HAC-9 lands).
 */
import type { JevAskRequest, JevAskResult } from "./jev-client";

export interface JevCache {
  get(key: string): Promise<JevAskResult | undefined>;
  set(key: string, value: JevAskResult): Promise<void>;
}

export class MemoryJevCache implements JevCache {
  private readonly store = new Map<string, JevAskResult>();
  gets = 0;
  sets = 0;

  async get(key: string): Promise<JevAskResult | undefined> {
    this.gets++;
    const v = this.store.get(key);
    return v === undefined ? undefined : structuredClone(v);
  }

  async set(key: string, value: JevAskResult): Promise<void> {
    this.sets++;
    this.store.set(key, structuredClone(value));
  }

  get size(): number {
    return this.store.size;
  }
}

/** The canonical string that is hashed into the cache key. */
export function cacheKeyMaterial(modelVersion: string, req: JevAskRequest): string {
  return JSON.stringify({ model: modelVersion, state: req.state, questions: req.questions });
}

/** Hex SHA-256 cache key. Uses Web Crypto, available in Node 18+, Vercel functions and edge. */
export async function jevCacheKey(modelVersion: string, req: JevAskRequest): Promise<string> {
  const bytes = new TextEncoder().encode(cacheKeyMaterial(modelVersion, req));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
