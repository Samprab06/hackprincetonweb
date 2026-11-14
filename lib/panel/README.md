# lib/panel: persona builder and Jev customer panel (HAC-15)

Catchment → `buildPersonas` → `PersonaSet` → `runPanel` / `runPanelForSites` (Jev, 4 shuffled
option orders per persona × site, cached) → one `BehaviorTable` per site, consumed by the demand
model (HAC-18).

| File | What it does |
|---|---|
| `contracts.ts` | Interim Zod schemas (`Persona`, `PersonaSet`, `PersonaBehavior`, `BehaviorTable`, catchment input). Move to `lib/contracts/` when HAC-9 lands. |
| `personas.ts` | 30–100 personas by code from block groups, LODES jobs and pass-by counts. Seeded by catchment id. Integer weights that sum exactly to population, jobs and pass-by per kind. |
| `state.ts` | Code-built Jev state and questions. Only structured fields are read; ids must be snake_case. |
| `jev-client.ts` | REST client: concurrency limit, timeout, retry with backoff. The **assumed wire format is isolated in one section** of this file. |
| `cache.ts` | `JevCache` interface, `MemoryJevCache`, SHA-256 cache key over model + state + questions. |
| `panel.ts` | Runs the panel, writes each answer to the cache as it arrives, averages orders, reports spread and failed personas. |

Env: `JEV_API_KEY`, `JEV_BASE_URL` (endpoint to be confirmed in HAC-14). The live test in
`jev-client.test.ts` runs only when `JEV_API_KEY` is set.

## Proposed `jev_cache` table (for `lib/db/schema.ts`, HAC-9)

Not wired yet; add this once HAC-9's Drizzle schema exists, then implement `JevCache` over it
(`get` = select by key, `set` = insert ... on conflict do nothing).

```ts
// import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
//
// export const jevCache = pgTable("jev_cache", {
//   /** hex SHA-256 of JSON.stringify({ model, state, questions }) — see lib/panel/cache.ts */
//   key: text("key").primaryKey(),
//   modelVersion: text("model_version").notNull(),          // "jev-1.14.0"
//   /** JevAskResult: { modelVersion, answers: { [question]: { probabilities, confidence } } } */
//   result: jsonb("result").notNull(),
//   createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
// });
```
