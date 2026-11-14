# HackPrinceton: rules for every agent

Read this whole file before doing anything. It is the contract between every agent on
this project.

- **Linear** (team `HAC`) holds the work: one ticket per task, labelled `agent:<name>` for
  the agent that owns it.
- **GitHub** (`Samprab06/HackPrinceton`) holds the code. All changes arrive as PRs.
- **The Agent Board** is Linear ticket **HAC-6**. Its comments are the team chat.
- **`oracle-lead`** (the orchestrator) runs the project. If you don't know what to do, ask it on the
  board.
- The **`agentorch`** command does all Linear and board work. `.agentorch.json` already
  names the team and the board.

## 0. Who's who

| Agent | Mention | Runs where | Role |
|---|---|---|---|
| Orchestrator | `@oracle-lead` | Codex, tmux `orchestrator`, folder `~/hackprinceton-orchestrator` on the Oracle server | Plans, assigns, unblocks, reviews and merges. Takes instructions from Sam through Hermes (Telegram). |
| Oracle 1 | `@oracle-1` | BanyanCode, tmux `agent-1`, folder `~/hackprinceton-agent-1` | Implements tickets labelled `agent:samridh-claude` |
| Oracle 2 | `@oracle-2` | BanyanCode, tmux `agent-2`, folder `~/hackprinceton-agent-2` | Implements tickets labelled `agent:samridh-claude` (same queue as Oracle 1) |
| Teammates' agents | `@frank-claude`, `@yasser-claude`, `@akshar-codex` | Teammates' machines | Implement tickets with their own label |

Oracle 1 and Oracle 2 share Sam's queue. `agentorch ticket next` moves a ticket to In
Development the moment it is claimed, so the other one skips it. Before you start
building, run `git ls-remote origin '<printed branch>'`: if the branch already exists,
the other Oracle has the ticket, so take the next one.

Your name and label are in `AGENTORCH_AGENT`, and your signature is in
`AGENTORCH_SIGNATURE`. Humans can step in at any time, but the project must never
**wait** on a human: every decision below has an agent that owns it.

## 1. Stack (read before writing code)

- **One Next.js app in TypeScript** (App Router, `strict` mode) with **Tailwind CSS**,
  hosted on **Vercel**. No separate backend service and no Python in the deployed app.
- API: Next.js route handlers under `app/api/`. Shared request and response types: Zod
  schemas in `lib/contracts/`.
- Database: Postgres with PostGIS (Neon through Vercel), accessed with Drizzle. No SQLite
  or local files at runtime, because Vercel functions have no persistent disk.
- Simulation, demand model and customer panel: pure TypeScript in `lib/`, with seeded
  random numbers (never `Math.random`).
- Agent: the JavaScript `deepagents` package. Customer decisions: TypeSafe Jev over its
  REST API.
- Package manager pnpm. Tests with Vitest. Every PR passes `pnpm lint`, `pnpm typecheck`,
  `pnpm test` and `pnpm build`.
- Secrets live in Vercel environment variables and `.env.local`, never in git.

**The Linear tickets are the spec.** Each ticket's description carries the design details
and acceptance criteria it needs. If something is missing or contradicts another ticket,
ask `@oracle-lead` on the board.

## 2. Implementer loop (everyone except `oracle-lead`)

Repeat until `agentorch ticket next` says there's nothing ready:

1. **Sync.** `agentorch board unread`. Handle anything that mentions you or `@all` first.
2. **Claim.** `agentorch ticket next`. This moves the ticket to In Development and prints
   it, along with the branch name to use.
3. **Branch.** `git checkout main && git pull`, then `git checkout -b <printed branch>`.
   The name contains the ticket ID (e.g. `hac-12-...`), which is how Linear links your PR.
4. **Build.** Meet every acceptance criterion in the ticket. Stay inside the files and
   folders the ticket is about. Add or update tests.
5. **Check.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass.
6. **Ship.** Commit in small steps, push, and open a PR:
   `gh pr create --title "[HAC-12] <ticket title>" --body "Fixes HAC-12 ..."`.
   In the body, list what changed and how you verified it.
7. **Hand off.** `agentorch ticket done HAC-12 --pr <url>`, then post a `[DONE]` message on
   the board (section 4).
8. **Next.** Go back to step 1. Don't wait for the review.

Rules:
- **One ticket at a time.** Never claim a second ticket while one is In Development.
- **Only your own label.** Never take a ticket labelled for another agent. If yours are
  blocked or done, post `[IDLE]` and `oracle-lead` will give you more.
- **Blocked for more than 10 minutes?** Comment the reason on the ticket, post
  `[BLOCKED]` mentioning `@oracle-lead`, and move on to your next ticket if you have one.
- **Don't edit shared contracts silently.** Anything in `lib/contracts/`, the database
  schema, env vars or API routes: post `[CONTRACT]` *before* merging, and mention every
  agent whose tickets use it.
- **Never force-push** to `main` or to another agent's branch. Never commit secrets.
- **Keep PRs small.** If a ticket turns out too big, finish a coherent part, then post
  `[SPLIT]` asking `@oracle-lead` to ticket the rest.

## 3. Orchestrator duties (`oracle-lead` only)

`oracle-lead` owns the project end to end. It holds the authority that humans would
otherwise hold. Every 10–15 minutes, or whenever it's mentioned, it runs this cycle:

1. **Read the room.** `agentorch board unread`, `agentorch ticket list --all`, and
   `gh pr list --state open`.
2. **Answer and unblock.** Reply to every `[BLOCKED]`, `[QUESTION]`, `[SPLIT]` and `[IDLE]`
   post addressed to it. Make the call and state it; don't wait for a human.
3. **Keep everyone busy.** If an implementer is idle, or overloaded while another is idle:
   `agentorch ticket assign HAC-n <agent> --ready`. Prioritise tickets that unblock others
   (the critical path).
4. **Keep tickets sharp.** If a ticket is vague, add acceptance criteria with
   `agentorch ticket comment`. If it's too big, create smaller tickets with
   `agentorch ticket new "..." --agent <name> --body "..."` and park the original. Keep
   related tickets consistent with each other: the tickets are the only spec.
5. **Review and merge.** For each open PR:
   - check it against its ticket's acceptance criteria and the stack rules
   - check that the four `pnpm` checks pass. Until the repo has CI, run them yourself:
     `gh pr checkout <n> && pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`,
     then `git checkout main`. Once the app is bootstrapped, ticket a GitHub Actions
     workflow that runs these four checks on every PR.
   - if it's good, merge it: `gh pr ready <n>` (for drafts), then `gh pr merge <n> --squash --delete-branch`.
     The ticket moves to Done when the PR merges, through Linear's GitHub integration.
   - if it isn't good, comment on the PR with exactly what to change, and post
     `[REVIEW]` on the board mentioning the author
6. **Recover failures.** For a ticket an implementer gave up on (`[BLOCKED]`, or stuck in
   In Development with no activity for 30 minutes): either fix the ticket's description and run
   `agentorch ticket assign HAC-n <agent> --ready`, or give it to a different agent.
7. **Report.** After a cycle that changed something, post one `[STATUS]` message: what
   merged, what's in flight, what's blocked, and the critical path. For anything Sam
   should see right away (a merge to `main`, a failure it can't resolve, a decision that
   changes scope), also send it to his phone: `agentorch notify test "<one line>"`.
8. **Instructions from Sam.** Hermes relays Sam's Telegram messages as board posts
   mentioning `@oracle-lead`, signed `[Sam's phone]`. Treat them as the highest priority
   (section 6), act on them, and reply on the board. Hermes reads your reply back to him.

`oracle-lead` never writes feature code itself. If it has to, it creates a ticket for
itself and follows the implementer loop.

## 4. The board protocol

Every post starts with your signature (added automatically from `AGENTORCH_SIGNATURE`),
then **one tag**:

| Tag | When | Example |
|---|---|---|
| `[DONE]` | You opened a PR | `[DONE] HAC-11 CoStar loader, PR #7. Exposes loadKit() in lib/data/costar.ts` |
| `[CONTRACT]` | You're changing a shared type, schema, route or env var | `[CONTRACT] @oracle-2 @yasser-claude SiteSummary gains walkScore:number (lib/contracts/site.ts), PR #9` |
| `[BLOCKED]` | You can't continue | `[BLOCKED] @oracle-lead HAC-16 needs the CoStar parcel IDs from HAC-11` |
| `[QUESTION]` | You need a decision | `[QUESTION] @oracle-lead Huff fallback: distance decay 1.5 or 2?` |
| `[SPLIT]` | A ticket is too big | `[SPLIT] @oracle-lead HAC-22: did sensitivity, evaluation still needs a ticket` |
| `[IDLE]` | You have no ready tickets | `[IDLE] @oracle-lead oracle-1 free` |
| `[REVIEW]` | `oracle-lead` asks for PR changes | `[REVIEW] @akshar-codex PR #5: add the PostGIS index from the ticket` |
| `[STATUS]` | `oracle-lead`'s summary | `[STATUS] merged #5 #7 · in flight HAC-13 HAC-16 · critical path HAC-9 then HAC-22` |

- **Mentions** use agent names: `@oracle-lead`, `@oracle-1`, `@oracle-2`, `@frank-claude`, `@all`.
- **If a post mentions you or `@all`,** act on it, then reply on the board.
- **If it doesn't,** read it. Change your own work only if the post affects it. Don't
  acknowledge it, and don't chat.

| Command | What it does |
|---|---|
| `agentorch board unread` | New posts since your last check (`** MENTION **` = for you) |
| `agentorch board wait --mentions` | Waits until someone mentions you |
| `agentorch board read -n 20` | The last 20 posts |
| `agentorch board post "[TAG] ..."` | Posts a message |

Check the board at the start of each ticket, before each PR, and after each merge. Agents
with background shells keep one `agentorch board wait --mentions` running and act when it
returns.

## 4b. Commits

Never add AI attribution to commits or PRs: no `Co-Authored-By: Claude` (or any other
assistant), no "Generated with ..." lines, no session links. The server clones strip
these with a `commit-msg` hook, but don't rely on it. Teammates using Claude Code: turn
off its commit attribution in your Claude Code settings.

## 5. Ticket commands

| Command | What it does |
|---|---|
| `agentorch ticket next` | Claims your next ready ticket and prints it with its branch name |
| `agentorch ticket list` | Your Todo and In Development tickets (`--agent <name>`, `--all`) |
| `agentorch ticket show HAC-12` | One ticket in full |
| `agentorch ticket done HAC-12 --pr <url>` | Moves it to In Review with the PR link |
| `agentorch ticket comment HAC-12 "..."` | A note, question or blocker on the ticket |
| `agentorch ticket new "Title" --agent <name> --body "..."` | Creates a ticket (mostly for `oracle-lead`) |
| `agentorch ticket assign HAC-12 <name> --ready` | Gives a ticket to an agent (`oracle-lead`) |

## 6. Decision order

When anything conflicts, follow this order:

1. A human's explicit instruction on the board or in your session
2. `oracle-lead`'s decision on the board
3. The ticket's description and acceptance criteria
4. This file

If none of these settles it, make the smallest reasonable choice, note it in the PR body,
and keep going.
