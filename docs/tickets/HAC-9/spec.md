# HAC-9 Platform bootstrap specification

Source: Linear HAC-9, assigned to Akshar and `agent:akshar-codex`. This ticket's explicit TypeScript stack supersedes the earlier Python-oriented research context for this implementation.

## Objective

Provide the shared Next.js foundation, versioned Postgres schema, provenance-aware contracts, and clearly synthetic Houston coffee-shop fixtures so independently owned feature tickets can build on a stable interface.

## Scope and ownership

- Manager: package/config files, bare root layout and placeholder page, health endpoint and server-only database client, setup docs, integration and final verification.
- Backend specialist: `lib/contracts/**`, `fixtures/**`, `lib/db/schema.ts`, `drizzle/**`, and contract/fixture tests. No edits to shared package/config files without manager coordination.
- Preserve repository instructions and existing files. Product page design remains with HAC-10; no simulation, provider calls, authentication policy, or feature implementation is included.

## Required behavior

- Strict TypeScript App Router with Tailwind, ESLint, Prettier, Vitest, pnpm, and exact dependency versions including JavaScript `deepagents`.
- Zod schemas for all ten ticket entities. Assumed values carry `value`, `unit`, `origin`, and `evidenceIds`; unknowns are explicit. Fixtures are synthetic, not sponsor findings or real customer data.
- Ten foundational tables, versioned profile snapshots, JSONB event storage, appropriate project relationships and indexes, plus a reviewable PostGIS-enabling first migration. Callers append snapshots rather than updating prior versions; this bootstrap does not introduce an immutability trigger. Sponsor data tables remain owned by later tickets.
- `GET /api/health` is uncached: return 200 for a reachable database with PostGIS, or a sanitized 503 JSON error when missing/unavailable. Do not expose URLs, credentials, raw provider errors, or imply unavailable data is healthy.
- No persistent runtime files. Database configuration is server-only; missing credentials must not prevent an offline build.

## Verification

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and formatting validation. Exercise success, missing configuration, connection failure, and missing PostGIS health behavior. Contract tests validate fixtures and reject malformed provenance, impossible probabilities, and broken fixture references. Verify migration/schema consistency locally without applying remote changes.

## External acceptance pending approval

No matching Vercel project was returned by the read-only project lookup, and DATABASE_URL is absent. Creating/linking hosted resources, enabling PostGIS remotely, applying remote migrations, deploying previews, pushing and merging require Akshar's explicit approval. Document those acceptance items as pending; do not fabricate a project, plan limit, connection test, or deployment result.
