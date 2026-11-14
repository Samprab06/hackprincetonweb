# HAC-9 verification and remaining acceptance

## Local candidate

The platform scaffold, ten shared contracts, synthetic fixtures, ten database tables, generated first migration and sanitized health endpoint are implemented locally. No GitHub publication, Neon provisioning, hosted migration, Vercel linking or deployment is included in this result. HAC-9 remains In Development until its external acceptance and PR handoff are completed.

## Checks

| Check                            | Result                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Pass, including a clean Git source export without `.env` files or provider keys.                                                                              |
| `pnpm peers check`               | No peer dependency conflicts. Upstream ESLint/Drizzle deprecation warnings are documented in README.                                                          |
| `pnpm lint`                      | Pass with zero warnings.                                                                                                                                      |
| `pnpm typecheck`                 | Pass; generates Next.js route types before TypeScript so a clean checkout needs no prior build.                                                               |
| `pnpm test`                      | 110 passing tests, with `Jev live [live] > answers one persona x site call` skipped. The foundation contributes 16 contract/fixture cases and 4 health cases. |
| `pnpm format:check`              | Pass; existing team instruction files are excluded rather than rewritten.                                                                                     |
| `pnpm build`                     | Pass with no database or model credentials; `/` is static and `/api/health` is dynamic.                                                                       |
| `pnpm db:generate`               | No schema changes after the generated migration snapshot. No hosted database accessed.                                                                        |
| `git diff --check`               | Pass for the candidate.                                                                                                                                       |

The health tests were observed failing before implementation. Independent review reproduced two fixture coherence defects, then six failing regression cases were added before fixing them. Focused re-review confirmed both findings closed: every persona has behavior/stay lookup coverage, and destinations resolve within the current site's candidate/competitor universe.

## Real local database and HTTP checks

A disposable Docker database used PostgreSQL 17/PostGIS 3.5, with the image pinned to `postgis/postgis@sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6` under `linux/amd64` emulation. It was bound only to loopback, used private temporary credentials, and held synthetic test data.

- Applied the generated migration through Drizzle to a fresh database created from `template0`; PostGIS and all ten application tables were present.
- Reran the migration safely without reapplying it.
- PostgreSQL rejected duplicate profile versions, nonpositive versions and a persona set referencing another project's profile. Test inserts were rolled back.
- Started the production Next.js server against controlled local configurations and requested both `/` and `/api/health`. The root page returned 200. Health returned 200 with connected PostGIS, 503 `DATABASE_NOT_CONFIGURED` without a URL, 503 `POSTGIS_UNAVAILABLE` for a reachable database without the extension, and 503 `DATABASE_UNAVAILABLE` for a failed connection. All health responses were `Cache-Control: no-store`; errors did not expose the connection URL or password.
- Local HTTP servers were stopped after the checks. These tests establish local behavior, not a hosted Neon connection or Vercel preview result.

## Integration and ownership

The manager integrated backend commits serially, then reconciled current `origin/main` at `02f59b3`. The foundation's pinned package, TypeScript and Vitest configurations replace the interim scaffold, as requested in the feature PRs. Three narrow `z.record` calls in the merged panel/simulation code now explicitly use string keys for Zod 4 compatibility. All four required checks pass on that combined candidate. The live Jev test remains skipped rather than claiming an external API check.

Yasser's UI commit `9779bce` was checked in a temporary source copy over the reconciled foundation, retaining HAC-9 package/config/lockfile and applying Yasser-owned app, component, client and workspace-preview files. Install, lint, typecheck, build and 109 tests passed, with the same live Jev test skipped. The rebase handoff is: keep foundation tooling, retain Yasser's `app/layout.tsx` and `app/page.tsx` plus his feature/UI files. The final candidate preserves his merged product UI and root layout/page from main. The unfinished intake session uses a partial record under Zod 4, with a regression test; there is no duplicate `/` route.

Akshar deliberately applied the latest upstream `AGENTS.md` in the original HAC-9 worktree; its content matches upstream. That local edit was preserved. Final integration used the already-existing clean specialist worktree so it could incorporate upstream instructions without overwriting the applied file. The user's original checkout and `IDEAS.md` were not modified by this ticket.

## Remaining acceptance

- Complete PR review; merging requires separate approval.
- Select/approve the actual Vercel project and Neon resource, confirm the plan and function limits, pull secrets privately, and apply the reviewed migration to the approved database.
- Verify `pnpm dev` after the bootstrap linking/environment prerequisites, a real hosted database health response, and an approved Vercel preview deployment.
- Apply the verified page-shell rebase handoff and adapt interim feature contracts to the published shared interfaces before integrating those feature branches.

The first-hour foundation merge requested by the ticket cannot be performed without Akshar's explicit approval. The foundation is submitted for review separately from hosted acceptance; no preview is claimed.
