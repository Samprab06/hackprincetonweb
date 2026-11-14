# HAC-9 contracts and persistence

## Public imports

Import each `<Entity>Schema` and its inferred `<Entity>` TypeScript type from `lib/contracts/index.ts`: BusinessProfile, Candidate, Catchment, PersonaSet, BehaviorTable, ArrivalSchedule, SiteRun, SiteComparison, LocationPlan, and Evidence. `FixtureBundleSchema` additionally validates the references among the supplied fixtures. Import `syntheticHoustonFixture` from `fixtures/houston-coffee.ts`; it is a static module and requires no runtime filesystem access.

## Provenance and explicit unknowns

Numeric assumptions use `{ value: number | null, unit, origin, evidenceIds, unknownReason? }`. Origins are exactly `costar`, `public`, `founder`, or `default`. Evidence references are required. A null value requires a reason and is distinct from a genuine zero. Nullable sourced flags and price tiers use the same envelope. The fixture labels every entity synthetic, uses `default` origin throughout, and cites a synthetic-default evidence record; it does not pretend to contain sponsor observations, owner consultation, or Jev responses.

Plain numbers are reserved for structural indices (versions, seed, ranks, minute offsets), generated customer draws, and explicitly tagged simulated outputs. ArrivalSchedule provenance-bearing `parameters` document the input assumptions; customers contain realized `arrivalMinute`, `stayDraw`, `serviceMinutes`, and integer `ticketCents` values, linked to their persona and source behavior table. These draws are not measured people or independent forecasts. Simulation metrics are computed outputs tagged `outputKind: simulated`, with contribution validated as revenue less included costs.

## Initial shapes and names

- BusinessProfile: `concept`, supported `category` (or `unsupported` with `unsupportedCategory`), city, preferred/avoided areas, target customers, objective, operating hours, capacity, economics, must-haves and optional-to-use derived defaults. `capacity.servers` represents staff/service capacity. Economics keeps startup and buildout budgets distinct and exposes `monthlyRentCeilingCents`, `monthlyOperatingBudgetCents`, `averageTicketCents` and sourced `priceTier`. Wage, COGS, travel and patience defaults remain explicit unknowns in the fixture.
- Candidate: `floorAreaSqFt`, `monthlyRentCents`, sourced coordinates, sourced `availableForLease`, and `features.frontage`, `corner`, `parking`, `groundFloor`. Unknown availability or features are `{ value: null, ... }`, never missing-as-false. Property observations and for-lease verification are owned by later data tickets.
- Catchment: site reference, sourced radius/population/daytime workers, and competitor identities/distances. It does not claim population equals demand.
- BehaviorTable: one site, persona-set reference, `jev`/`huff` source, model version, and per-persona destination shares, monthly visits, five time-block shares, stay curves at line lengths 0/2/4/6/10, price acceptance, confidence, Jev version and cache key. Share distributions sum to one. Fixture demand source is `huff`, with null Jev metadata; no Jev execution is claimed.
- ArrivalSchedule: site and behavior-table references, day type, seed/model version, sourced parameters, time-ordered customer draws and per-persona stay curves.
- SiteRun: simulated metrics and events with profile/schedule/site references. SiteComparison: run references, site ranks, ordered contribution ranges and sourced sensitivity inputs. LocationPlan: comparison reference, conditional recommendation, practical next steps and evidence; `notSalesForecast` must be true.

These are initial shared interfaces for downstream tickets, not completed simulation or agent behavior. APIs must parse incoming/outgoing values and validate persisted references against their project before database writes. A fixture bundle validates its own references; an individual schema cannot verify an external database reference.

Fixture bundles require a behavior row and a schedule stay curve for every PersonaSet member, including personas without a realized arrival in that schedule. Implicit partial persona models are not supported. Each scheduled customer therefore has both executable lookups. Behavior destinations are limited to the behavior table's current site, competitor IDs recorded in that site's catchment, and the literal `none`; another candidate or another site's competitor is not automatically an available choice. A candidate could be a competitor only if the current catchment explicitly records that identity as one.

## Database

`lib/db/schema.ts` exports all ten named Drizzle tables. Identifiers are application-supplied text, allowing stable fixture and source identifiers without an additional ID-generation dependency. Child rows reference a project; profile, persona and comparison links additionally use composite project-scoped foreign keys so a row cannot reference another project's snapshot. Referencing columns are indexed. Profiles have a positive version and a unique `(project_id, version)` key; callers create new versioned snapshots instead of updating a prior version. No trigger or user/auth policy is introduced here.

JSONB payloads are typed with the contracts, but TypeScript types are not database runtime validation. Later write APIs must parse schemas and keep payload IDs/version fields consistent with relational columns. Site-run representative events are stored separately as JSONB. Jev cache keys are unique within a project; a null expiry explicitly means no expiry has been supplied, not a chosen provider caching policy. `updated_at` columns require the write path to set them on update.

`drizzle/0000_platform.sql` and its metadata were generated offline with:

```sh
pnpm exec drizzle-kit generate --dialect=postgresql --schema=./lib/db/schema.ts --out=./drizzle --name=platform
```

The initial SQL has an explicit leading `CREATE EXTENSION IF NOT EXISTS postgis` step, which is not represented by a geometry column or generated schema diff. Data-specific spatial tables remain with the data tickets. Regenerating a migration must retain this extension step. Enabling it on a hosted database and applying remote migrations require approval; this worker did neither.

## Verification

The contract tests cover all ten entity schemas, fixture parsing, explicit unknowns, malformed provenance, invalid probabilities/distributions, impossible schedule draws, broken site/persona/evidence references, unsupported categories, unknown lease status, simulated arithmetic, comparison ranges and forecast labeling. Drizzle generation after the first snapshot reports no schema changes. Manager performs real migration and FK checks against a disposable local PostgreSQL/PostGIS container before integration; no hosted connection is claimed by this worker.

Official references: [Drizzle schema declaration](https://orm.drizzle.team/docs/sql-schema-declaration) and [Drizzle indexes and constraints](https://orm.drizzle.team/docs/indexes-constraints).
