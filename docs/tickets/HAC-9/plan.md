# HAC-9 Implementation Plan

**Goal:** Deliver the locally verified platform foundation specified in [spec.md](spec.md).

**Architecture:** One Next.js App Router application, server-only Postgres access through Drizzle, pure shared Zod contracts, and imported synthetic fixture modules. The health route reports dependency readiness without requiring a live database at build time.

**Tech stack:** Strict TypeScript, pnpm, Next.js, React, Tailwind, Zod, Drizzle, Postgres/PostGIS, Vitest and the pinned JavaScript deepagents package.

Execution is authorized by Akshar's overnight implementation request. Local implementation proceeds within the ticket's explicit choices; external provisioning and publishing remain pending approval.

## Tasks

- [x] Establish the app/tooling files and exact dependency lockfile. Verify install compatibility with Node 22.
- [x] Write health behavior tests first, observe the expected failures, then add the pure evaluator, server-only database probe and uncached route. Prove missing dependencies yield a sanitized 503.
- [x] Backend specialist defines contracts and synthetic fixtures, with validation tests for provenance, unknowns, probability bounds and cross-entity references.
- [x] Backend specialist adds foundational Drizzle tables and a reviewable first migration, preserving versioned profiles and project-scoped integrity. Check generated migration consistency.
- [x] Integrate backend changes serially, run all four required commands plus formatting, inspect the actual diff, and perform a read-only merge preview against current origin/main.
- [x] Record setup commands, contract usage, actual verification evidence, and external acceptance blockers. Commit locally and checkpoint the ticket as prepared for review, not delivered or deployed.

See [verification.md](verification.md) for the local evidence and acceptance items that still require hosted setup or publication approval.

## Review focus

Missing configuration must not cause build-time network calls. Health failures must not leak secrets. Unknown business inputs must not become zero. Synthetic fixtures must not be mistaken for sponsor data. Parallel workers must not edit the same shared files, and unpublished foundation work must not be treated as a completed dependency.
