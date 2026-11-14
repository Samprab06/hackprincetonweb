# Founder intake (HAC-19)

`createIntakeSession(projectId, state?)` in `intake.ts` interviews the founder in seven
question groups. Its `saveProfile(patch)` method validates and merges answers and
returns a canonical `BusinessProfile` when the draft is complete. Until then,
`profile` is `null`; missing fields and explicit unknowns remain findings. It never
invents founder answers to make the schema pass.

Numeric values, booleans and price tiers use the shared provenance wrappers. Every
value changed through a founder patch becomes `origin: "founder"` with founder
evidence. Category defaults remain `default`, and switching category preserves
founder overrides. Unrecognized categories are stored as `unsupported`, with the
original category retained in `unsupportedCategory`.

The four [category fixtures](../../fixtures/categories/README.md) distinguish BLS
wage proxies from authored, uncalibrated scenario inputs. Supplemental assumptions
(visits, peak hours and floor area) stay in intake state instead of changing the
shared `BusinessProfile` contract.

## API

`POST /api/projects/[projectId]/intake` accepts:

```json
{
  "patch": {
    "businessName": "Morning Cup",
    "concept": "Neighborhood coffee shop",
    "category": "coffee"
  }
}
```

For the next turn, pass the previous response's `draft` and `assumptions` under
`state`, plus another `patch` and/or a natural-language `message`. An empty object
returns the first question. The project ID comes from the path; supplying identity
or version fields in a patch is rejected.

Responses contain `persisted: false`, `draft`, `assumptions`, `profile`,
`missingRequiredFields`, `findings`, `questions`, `nextQuestion`, `defaultSources`,
and `assistantMessage`. This endpoint is **stateless**: the caller must carry the
returned state into the next request. It does not create durable profile snapshots
or update the existing browser intake UI. The later orchestrator can use
`saveProfile` and persist validated snapshots through its own database workflow.

An existing project and a configured `DATABASE_URL` are required for the read-only
project lookup. Unknown projects return 404. Invalid JSON, unsupported fields,
invalid values and bodies over 64 KiB return 422. Database/model failures return
sanitized 503 responses. Errors use `{code, message, field_errors}` and responses
disable caching.

## Conversation runner

`runner.ts` binds `save_profile` to the installed JavaScript `deepagents` graph.
The runner exposes only that tool, with no filesystem or delegation tools.
Natural-language requests require `ANTHROPIC_API_KEY` in private server environment
configuration. Structured patches do not require a model key.

The configured model is [`claude-sonnet-4-6`](https://platform.claude.com/docs/en/models/sonnet-4-6/overview), with a 1,500-token response cap, no
provider retries, at most three save calls and a graph recursion limit of six.
Requests have a 20-second intake deadline; the route allows 30 seconds. No paid
provider fallback is selected. These bounds limit each request's work; they do not
establish a monthly spending limit.

The provider runner is guarded by `server-only`. `next.config.ts` loads
`deepagents`, `@langchain/core` and `@langchain/anthropic` as
[server external packages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).
This keeps optional SDK sandbox imports out of Turbopack's bundle; no sandbox or
WebSocket dependency is needed by this intake tool.

The tests use scripted founder answers and a scripted chat model against the real
compiled deepagents graph. They require no provider calls. Live Anthropic, hosted
Postgres and Vercel preview verification remain separate from these offline tests.
