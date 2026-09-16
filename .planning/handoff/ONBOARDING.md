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

## 7. Artifacts — index only, content still outside the repo

Twelve Mudavym artifacts live on claude.ai under org `1138b209-aed5-4cfe-9199-186b04b76545`.
ADR 0148 chose to **pull their content into the repo as files**. That has not happened —
the URLs below are an index, not a copy.

★ = founder-flagged as current and highest-reference (2026-09-16).

| Artifact | Public link | Internal id |
|---|---|---|
| **Mudavym Wave Four** ★ | [Y21sZP2xKshpbGBsnqQ8M3](https://claude.ai/artifact/Y21sZP2xKshpbGBsnqQ8M3) | `fb2f9455` |
| **The Arrival, Five Ways** ★ | [4cWg73gb6zidey1sVKcao6](https://claude.ai/artifact/4cWg73gb6zidey1sVKcao6) | `1d40bc3d` |
| **Sim Meyhouse, One Friday** ★ | [TNjGu67KRetqdmanZhnatd](https://claude.ai/artifact/TNjGu67KRetqdmanZhnatd) | `d59646d4` |
| **Mudavym Motion Canvas** ★ | [UyFDGQPXVheake4EVkEG8H](https://claude.ai/artifact/UyFDGQPXVheake4EVkEG8H) | `e281272f` |
| Mudavym Go-Live Board | [5hZELUz2SuswDPGm3boWkD](https://claude.ai/artifact/5hZELUz2SuswDPGm3boWkD) | `260e2af7` |
| Mudavym Overlay Census | [5Sbd8DEPctRGpNztw5rez3](https://claude.ai/artifact/5Sbd8DEPctRGpNztw5rez3) | `23f77c68` |
| Mudavym Build Board | [9nuqKGDTVxK7LWqfr912Vk](https://claude.ai/artifact/9nuqKGDTVxK7LWqfr912Vk) | `47322370` |
| Mudavym Atlas | [Lv6S1GgMycyLEZYrFRdPWe](https://claude.ai/artifact/Lv6S1GgMycyLEZYrFRdPWe) | `a14766c1` |
| Mudavym Cluster Map | [S4yACzsFqvBLJVQsv8rE9g](https://claude.ai/artifact/S4yACzsFqvBLJVQsv8rE9g) | `cb024e8e` |
| Mudavym Shortlist | [JvVbe21swPgQE2iKeKhSL7](https://claude.ai/artifact/JvVbe21swPgQE2iKeKhSL7) | `91236693` |
| Mudavym Identity | [KWf4ZygrDXjQQ9NDq2g5KD](https://claude.ai/artifact/KWf4ZygrDXjQQ9NDq2g5KD) | `95e8857e` |
| Documents and Reports Redesign | [D7EJZaPTV2cvSXX9obixAe](https://claude.ai/artifact/D7EJZaPTV2cvSXX9obixAe) | `620c531d` |

**Why the content is not here yet, measured 2026-09-16.** Two access paths were tried
against both link formats, 16 requests in total:

- `claude.ai/code/artifact/<uuid>` (org-scoped), via `WebFetch` and the Artifact read
  tool → *"artifact not found — it may have been deleted, or it has not been shared
  with you"*.
- `claude.ai/artifact/<short>` (public share links, all twelve) → *"this artifact is
  served to you as a public (non-member) reader, and reading public artifacts that way
  is not enabled yet"*.

The second error is the informative one. **All twelve resolved to their internal ids**,
so none is deleted and every link is live — the block is that a non-member reader cannot
read artifact content through this path yet. Sharing them more widely will not help; the
reader has to be a **member** of org `1138b209-aed5-4cfe-9199-186b04b76545`.

**What unblocks it,** in order of cost:

1. **Run the pull from a local Claude Code session** signed into the owning account — it
   reads as a member, not a public reader. The prompt for that is §8.
2. Add the session's account to that org as a member, then re-run the read from anywhere.
3. Export each artifact by hand and drop the files in.

Until one happens the artifacts remain account-bound — the exposure ADR 0148 set out to
remove, still open for the artifacts specifically. The table above at least makes the set
durable: twelve titles, twelve public links and twelve ids that survive in git whatever
happens to any one account.

## 8. The local-session prompt

Paste this into a Claude Code session **running on the Mac, signed into the account that
owns the artifacts**, with the repo as the working directory. It is written to stand
alone — a fresh session has none of this conversation.

```text
You are picking up the Mudavym repo (RestaurantAIAutomation) after an account move.
Read CLAUDE.md first and follow it — especially the two-sentence chat cap, the
grep-don't-read rule for large planning docs, and retire-to-write. Then read
.planning/handoff/ONBOARDING.md, which is the day-one brief and explains the rest.

Work on branch claude/artifact-pull (create it from main). Two jobs.

JOB 1 — confirm the session history survived the account switch.
Run, in order, and paste the real output:
    scripts/claude_state_migrate.sh list
    scripts/claude_state_migrate.sh verify
`list` should show every past session with its first prompt, branch and CLI version;
`verify` should exit 0 and report that every session records this repo's cwd. If either
comes back empty, the history did NOT survive — import the insurance bundle:
    scripts/claude_state_migrate.sh inspect ~/Desktop/claude-state_*.tar.gz
    scripts/claude_state_migrate.sh import  ~/Desktop/claude-state_*.tar.gz
    scripts/claude_state_migrate.sh verify
Report which of the two paths you took. Do not claim success without the command output.

JOB 2 — pull the twelve artifacts into the repo as files (ADR 0148 decided this; it
could not be done from the cloud session because that account is not a member of the
owning org, so it is yours to finish).

The twelve links, ids and titles are in ONBOARDING.md §7. Do these four FIRST — the
founder flagged them as the current ones, and prefer anything modified in the last
three weeks over anything older:
    Mudavym Wave Four        https://claude.ai/artifact/Y21sZP2xKshpbGBsnqQ8M3
    The Arrival, Five Ways   https://claude.ai/artifact/4cWg73gb6zidey1sVKcao6
    Sim Meyhouse, One Friday https://claude.ai/artifact/TNjGu67KRetqdmanZhnatd
    Mudavym Motion Canvas    https://claude.ai/artifact/UyFDGQPXVheake4EVkEG8H

For each artifact:
  - Read it with the Artifact tool (action "read"). If that refuses, try WebFetch on the
    same URL. If BOTH refuse, record the exact error and move on — do not guess at
    content, and do not reconstruct an artifact from memory or from the repo.
  - Write it to .planning/07-reference/artifacts/<kebab-slug>.md with a short frontmatter
    header: title, source URL, internal id, the date you pulled it, and one line on what
    it is. Keep the artifact's own structure; do not summarise it away.
  - If it is an interactive page (a canvas, a board, a map), preserve the underlying
    content and note in the header that the live version is interactive and the file is
    a snapshot.

Then:
  - Add one row per artifact to .planning/07-reference/INDEX.md.
  - Rewrite ONBOARDING.md §7 to point at the local files instead of saying the content is
    missing, keeping the links. Say plainly which artifacts failed, if any.
  - Update ADR 0148's artifacts consequence: it currently records the pull as decided but
    NOT delivered. If you delivered it, say so and cite the files.
  - Run both guards and paste the output:
        python3 scripts/check_onboarding_citations.py
        bash scripts/check_decision_claims.sh
  - Commit (Co-Authored-By trailer per CLAUDE.md §7) and push with
        git push -u origin claude/artifact-pull
    Do not open a pull request unless asked.

Report at the end, in two sentences plus a list: which artifacts landed, which failed and
the exact error for each. If you could not do part of it, say so — a partial result
reported as complete is the one unrecoverable failure here (CLAUDE.md §0.5).
```
