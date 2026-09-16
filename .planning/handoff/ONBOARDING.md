# Day one — read this first

> The cold-start entry point for a new session, a new account, or a new person.
> Locked by [ADR 0148](../decisions/0148-a-new-account-gets-a-day-one-brief-not-a-cloned-account.md),
> which also retired the standalone migration runbook into §6 below.
>
> **This is an index, not a source of truth.** Every line cites where the truth lives.
> When this file and the tree disagree, the tree wins — and the citation is how you
> catch it. Re-measure before acting on any number here (CLAUDE.md §5b).
>
> Written 2026-09-16. Staleness check: `git log -1 --format=%ad -- .planning/STATE.md`.

---

## 1. What this is

Mudavym — a full autonomous backend for restaurants: inventory, procurement,
communications, POS, and agents. Wine is the first vertical *and* the quality bar for
deep extraction. Expansion order is locked: **wine → full beverages → bakery → rest of
kitchen** (`PROJECT.md:8`).

The core bet, in the founder's words: the system is so reliable that an average operator
performs flawlessly because the infrastructure carries them — a Michelin kitchen, where
systems rather than genius produce consistency (`PROJECT.md`, *Core Value*).

Code still says WineOps in places. Identity migrates gradually; the goal does not change.

## 2. How work happens here — read before touching anything

[`CLAUDE.md`](../../CLAUDE.md) is loaded into every session and overrides convenience.
The six non-negotiables, compressed — the file itself is the contract:

1. Nothing is decided until it is decided **together**; undecided forks go to
   `decisions/OPEN-DECISIONS.md` and get asked, not defaulted.
2. Every decision gets an ADR. A decision made in chat and not written down did not happen.
3. Low output footprint per session.
4. Document as you go, every session. Undocumented work did not happen.
5. No shortcuts — and say so plainly when you take one.
6. Research depth uncapped; delivery brevity is not. **Chat replies are capped at two
   sentences** unless the turn is a question or a decision.

Two rules that bite immediately:

- **Never read a large planning doc whole.** `v3.0-TECH-DEBT.md` is 284KB,
  `OPEN-DECISIONS.md` is 130KB, `UX_PATHS_CATALOG.md` is 154KB. Grep for the section,
  then `Read` with `offset`/`limit`. Reading one whole costs a third of a context window.
- **Retire-to-write.** Adding a document means naming one to retire, merge, or supersede.

## 3. Where the build is

**Milestone: P3 — Grade, then scale** (`STATE.md:10`, [ADR 0029](../decisions/0029-p3-plan-of-record.md)).
P2 closed 2026-08-26, all five stages deployed.

Live in production (`STATE.md:14`): NestJS gateway + Python agent-orchestrator on
Railway, web SPA on Vercel, Supabase Postgres, RabbitMQ on CloudAMQP, Redis on Upstash.
`railway status` after every merge to main — CI cannot see Nest DI failures.

Scale, as of 2026-09-16 — all re-countable, none to be taken on faith:

| | Count | How to re-check |
|---|---|---|
| ADRs | 137 | `ls .planning/decisions/0*.md \| wc -l` |
| Executable claims | 321 resolved, 15 open | `scripts/check_decision_claims.sh` |
| Agent modules | 25 | `/fleet-census` — the honest answer has four different counts |
| Repo skills | 5 | `ls .claude/skills/` |
| Commits, last 30d | 51 | `git log --since=30.days --oneline \| wc -l` |

The stack is **Vite SPA + react-router-dom, not Next.js** — a recurring wrong assumption.

## 4. What is in flight, broken, and open

**In flight.** [`PROGRESS.md`](PROGRESS.md) §0a is the live queue; its priority list still
matched GitHub on 2026-09-16 (`PROGRESS.md:22`):

| PR | What | Blocker |
|---|---|---|
| [#368](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/368) | WhatsApp dispatch, ADR 0121 P0/P1 | 5 CLAIMS rows pass locally, regress in CI — suspect env-dependent `verify` commands |
| [#362](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/362) | Security gate can fail loudly | PyYAML guard needs a rewrite |
| [#349](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/349) | Nightly prod E2E, ADR 0135 | mid-merge in `wt-e2e`, 6 conflicts |
| [#374](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/374) | Overlays + action receipts | draft |

Plus ~16 open Dependabot PRs. Per CLAUDE.md §5b, that queue has burned a session before:
15 Dependabot PRs once had **zero** package overlap with the CVEs they were assumed to
fix. Verify overlap before merging any of them.

**Broken.** [`v3.0-TECH-DEBT.md`](../v3.0-TECH-DEBT.md) is the live defect register,
62 sections in four tracks — Track A is live defects (`v3.0-TECH-DEBT.md:65`). Check it
before claiming anything is broken or fixed.

**Open.** [`OPEN-DECISIONS.md`](../decisions/OPEN-DECISIONS.md) holds forks waiting on the
founder. **Verify an entry before acting on it.** On 2026-08-25 five entries were acted on
and all five were wrong in ways that changed the priority — two already fixed, one
overstated, one pointing at the wrong packages, one describing rows in a table that does
not exist in production. That incident is why claims are executable now.

## 5. Reading order

`PROJECT.md` (identity, milestone) → `decisions/README.md` (what is locked, what is open)
→ `STATE.md` (where the build is) → `handoff/PROGRESS.md` (what is mid-flight) →
`ROADMAP.md`. Then `.planning/00-index/DESIGN-MAP.html` in a browser for the design map —
generated, never hand-edited.

## 6. Arriving from another Claude account

Tooling: [`scripts/claude_state_migrate.sh`](../../scripts/claude_state_migrate.sh)
(`--help`, and a 30-line header explaining why each rule exists).

**What moves:** session transcripts, project memory, user-level config — plain files
under `~/.claude`. The repo, `.planning/`, all 137 ADRs travel by `git clone`.

**What cannot:** claude.ai conversations, Claude Code *web* sessions, Routines, the
GitHub App connection. Server-side and account-bound; export exists, import does not.
Reconnect GitHub at <https://claude.ai/connect-github>.

**Same Mac, different account** — the current plan. Transcripts live in
`~/.claude/projects/<key>/`, credentials in `~/.claude/.credentials.json` (macOS:
Keychain, *Claude Code-credentials*). Logging out clears credentials and has no reason to
touch `projects/`, so the history should simply still be there afterwards.
**That is reasoned, not tested.** Take the bundle first, then log out:

```bash
cd /path/to/restaurant-ai-automation
scripts/claude_state_migrate.sh list            # confirm it sees your sessions
scripts/claude_state_migrate.sh export --out ~/Desktop --with-user-config
claude logout && claude login                   # the new account
scripts/claude_state_migrate.sh verify          # should still pass, untouched
claude --resume                                 # your sessions, by name
```

If `verify` comes back empty, the history did not survive — import the bundle:
`scripts/claude_state_migrate.sh import ~/Desktop/claude-state_*.tar.gz`.

**Different machine instead?** The trap is that Claude Code keys its session store on the
repo's absolute path with every non-alphanumeric dashed, so a clone at a new path makes
`--resume` show an empty list beside an intact history. `import` detects that and
rewrites; `verify` exits non-zero and names the sessions if any are still stale.

**Credentials are never bundled** — not behind a flag. Copying the old token would
authenticate the new machine as the old account. `inspect` separately scans transcripts
for secret-shaped strings and reports counts only, never values; it cannot tell a real key
from an example one, so treat a hit as "go look", not "you leaked something".

## 7. Artifacts — open thread

The Mudavym artifacts live on a claude.ai account and are not in this repo. Per ADR 0148
they are to be **pulled in as files** so they survive any account move.

**Blocked on:** the artifact URLs. `WebFetch` can open `claude.ai/artifact/...` links
directly, so Safari is not needed — but this session's artifact listing came back empty,
meaning they sit under a different account, and whether this login can open them is
untested. Paste one link to find out; the rest follows automatically.
