# CI and deployment

**CI** runs on pull requests and pushes to main. The **App checks** job uses Node 22 and the pnpm version pinned in package.json. It installs from the frozen lockfile and runs lint, typecheck, Vitest, and the production build without application credentials. The optional live Jev test stays skipped.

The env-file guard rejects tracked .env files except for the root .env.example and checks that credential assignments in the template are empty. The public env guard rejects credential-like names and values and reuse of configured server secrets in NEXT_PUBLIC_ variables. The bundle guard scans .next/static for server-only env names. **Secret scan** runs Gitleaks over incoming PR commits and the reachable history of main on pushes. Findings redact matched values.

The Playwright workflow is tracked in HAC-29 and runs separately. Vercel's GitHub integration handles preview and production builds. [Vercel environments](https://vercel.com/docs/environment-variables)

| Variable | Production | Preview | Development |
| --- | --- | --- | --- |
| DATABASE_URL | Production Neon | Isolated preview Neon | Local or development Neon |
| ANTHROPIC_API_KEY or OPENAI_API_KEY | Runtime provider if enabled | Scoped test provider if enabled | Optional developer credential |
| JEV_API_KEY and JEV_BASE_URL | Runtime panel if enabled | Scoped test panel if enabled | Optional for live panel tests |
| CENSUS_API_KEY | Omit from app runtime | Omit from app runtime | Optional for data preparation |

Keep application secrets in the relevant Vercel environment or in local .env.local. Use separate preview and production credentials and keep credentials out of NEXT_PUBLIC_ variables.

## Required checks for main

- **App checks**
- **Secret scan**

Select these job names from a successful CI run when configuring branch protection.
