# CoStar import (HAC-11)

The licensed kit is ignored by git. Keep it outside `public/`, do not import it
from a client component, and expose observations only through server route
handlers. No sponsor records or screenshots belong in tests or fixtures.

## Commands

With Node 22+, install dependencies (`pnpm install`), put `DATABASE_URL` in
`.env.local`, and run:

```sh
pnpm exec tsx scripts/load-costar.ts /path/to/costar-hackathon-kit
```

This creates the four source tables and spatial indexes, then streams JSON Lines
into one transaction. A rerun replaces all four source tables, not application
tables. Concurrent runs serialize using a transaction-scoped advisory lock.
Invalid records, duplicate source IDs, or missing current-tenancy property references roll back
the data replacement. Do not run this against an unapproved database.

For a database-free supply inventory:

```sh
pnpm exec tsx scripts/load-costar.ts /path/to/costar-hackathon-kit --report-only
```

Only aggregate counts are printed. Reports distinguish active listings from
off-market observations, retail/office-retail **space use** from retail/mixed-use
**building type**, and size bands based on the advertised space size
(`squareFeetMax`); minimum divisible SF remains in the source payload.
An off-market lease observation is not proof of current availability.

## Storage and interpretation

- Drizzle definitions: `lib/db/costar-schema.ts`, re-exported by `lib/db/schema.ts`.
- Idempotent source-import DDL: `scripts/costar-schema.sql`. It is separate from
  HAC-9 application migrations and does not alter their journal.
- All properties are retained so retail spaces inside office or apartment
  buildings can be joined, without pretending the parent building is retail.
- Group listings also name buildings outside the property dataset. Their space
  and attachment source IDs remain intact, without a fabricated property row or
  a false foreign-key guarantee. `spacesOutsidePropertyDataset` reports these;
  city/building type comes only from the listing's matching embedded property
  when available. Candidate search must verify a complete property join.
- Points use WGS84/SRID 4326 and longitude first; missing coordinates stay null.
- Original asking rates, period, currency and service type remain available.
  Normalized rent is not an all-in occupancy cost: TripleNet still needs a
  separately labelled operating expense assumption. Unknown rates are not zero.
- Lease listing spaces in this kit omit `spacePosition`. It stays unknown;
  occupancy position is not a reliable listing-space join and is not substituted.
- Current tenancies have no `toDate`. Industry joins use tenant-location IDs and
  retain the company source reference. CoStar tenants undercount all nearby jobs.
- Source references include dataset, record ID and field paths. Normalization
  does not convert licensed observations into public data.

Hosted imports and Vercel previews require configured project credentials;
offline checks do not demonstrate a successful hosted load or deployment.

## Offline inventory, 2026-11-14

The complete kit passed `--report-only`: 3,339 properties, 3,955 lease-space
observations, 11,179 current tenancies and 242,934 attachment references.
236 space observations reference group-listing buildings outside the full
property dataset. Attachment references preserve their source locations rather
than claiming every reference is a distinct image/model.

Active Retail/OfficeRetail-use observations (advertised space SF):

| City        | <1,000 | 1,000–2,499 | 2,500–4,999 | 5,000–9,999 | ≥10,000 | Total |
| ----------- | -----: | ----------: | ----------: | ----------: | ------: | ----: |
| Houston     |     14 |          68 |          41 |          19 |      14 |   156 |
| Los Angeles |     33 |         177 |          77 |          54 |      12 |   353 |

There are two additional off-market retail-use observations per city. Active
spaces in retail/mixed-use-classified buildings number 68 in Houston and 17 in
Los Angeles. These are supply observations, not confirmed business suitability
or unique independently available suites (a space may appear in multiple listings).
The counts and the recommendation to permit verified retail use in other
building types were posted on HAC-6.

No approved database connection was available during this implementation.
Actual PostGIS load/reload/rollback and hosted preview acceptance remain pending.
