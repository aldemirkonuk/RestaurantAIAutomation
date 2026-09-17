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
| Executable claims | 321 resolved, 16 open | `scripts/check_decision_claims.sh` |
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

**Measured on this Mac, 2026-09-16** (branch `claude/artifact-pull`): `list` found 71
sessions, 582.7 MB. `verify` **exited 1, and that was a false alarm** — read it before
importing anything. It compares each session's recorded cwd to the repo root by exact
string (`scripts/_claude_state.py:247`), so six sessions opened in `apps/web`,
`apps/api-gateway`, `.planning` or a worktree were called stale, with a message saying
their paths do not exist; all six exist. It also names only the first five. Import only
if the cwds it lists are outside the repo or missing. Nor does that run test the
same-Mac reasoning above. No bundle existed at `~/Desktop/claude-state_*.tar.gz`. Two
logins now share this store — the desktop app's session runs as org
`03017808-9f02-4503-8679-8b71c4f82859`, while the terminal CLI's profile in
`~/.claude.json` still names org `1138b209-aed5-4cfe-9199-186b04b76545` — and `list`
reads the files whichever is signed in. Whether `claude --resume` under the new org
offers the sessions made under the old one was not tested.

**Different machine instead?** The trap is that Claude Code keys its session store on the
repo's absolute path with every non-alphanumeric dashed, so a clone at a new path makes
`--resume` show an empty list beside an intact history. `import` detects that and
rewrites; `verify` exits non-zero and names the sessions if any are still stale.

**Credentials are never bundled** — not behind a flag. Copying the old token would
authenticate the new machine as the old account. `inspect` separately scans transcripts
for secret-shaped strings and reports counts only, never values; it cannot tell a real key
from an example one, so treat a hit as "go look", not "you leaked something".

## 7. Artifacts — pulled 2026-09-16, all twelve

ADR 0148 chose to **pull the twelve Mudavym artifacts on claude.ai into the repo as
files**. **All twelve are now in the repo**, under `.planning/07-reference/artifacts/`
as raw HTML snapshots with a frontmatter header (title, source URL, internal id, pull
date, one-line note). Two earlier attempts on 2026-09-16 — a cloud session, then a local
desktop session on branch `claude/artifact-pull` — could not read any of them (§7's
prior text below the table records exactly what failed and why); a third session, run
from a terminal `claude` confirmed to be in the owning org `1138b209-…`, read all twelve
successfully via the Artifact tool and committed them. Nothing was reconstructed from
memory or from the repo — every file is what the Artifact tool returned.

★ = founder-flagged as current and highest-reference (2026-09-16). Full ids are as the
Artifact tool resolved each public link on the second attempt.

| Artifact | Public link | Internal id | In repo |
|---|---|---|---|
| **Mudavym Wave Four** ★ | [Y21sZP2xKshpbGBsnqQ8M3](https://claude.ai/artifact/Y21sZP2xKshpbGBsnqQ8M3) | `fb2f9455-8d35-411c-85c9-cfb0dbbf7abe` | [artifacts/mudavym-wave-four.md](../07-reference/artifacts/mudavym-wave-four.md) |
| **The Arrival, Five Ways** ★ | [4cWg73gb6zidey1sVKcao6](https://claude.ai/artifact/4cWg73gb6zidey1sVKcao6) | `1d40bc3d-6ddd-49c6-b894-e626fc7f72ad` | [artifacts/the-arrival-five-ways.md](../07-reference/artifacts/the-arrival-five-ways.md) |
| **Sim Meyhouse, One Friday** ★ | [TNjGu67KRetqdmanZhnatd](https://claude.ai/artifact/TNjGu67KRetqdmanZhnatd) | `d59646d4-0021-43dd-87e9-9fc70135849e` | [artifacts/sim-meyhouse-one-friday.md](../07-reference/artifacts/sim-meyhouse-one-friday.md) |
| **Mudavym Motion Canvas** ★ | [UyFDGQPXVheake4EVkEG8H](https://claude.ai/artifact/UyFDGQPXVheake4EVkEG8H) | `e281272f-c403-4780-a675-0e9a0a4289ba` | [artifacts/mudavym-motion-canvas.md](../07-reference/artifacts/mudavym-motion-canvas.md) |
| Mudavym Go-Live Board | [5hZELUz2SuswDPGm3boWkD](https://claude.ai/artifact/5hZELUz2SuswDPGm3boWkD) | `260e2af7-8a3c-4bd0-8ff8-4fd1618007ee` | [artifacts/mudavym-go-live-board.md](../07-reference/artifacts/mudavym-go-live-board.md) |
| Mudavym Overlay Census | [5Sbd8DEPctRGpNztw5rez3](https://claude.ai/artifact/5Sbd8DEPctRGpNztw5rez3) | `23f77c68-7766-40c8-934a-cfa7148c7508` | [artifacts/mudavym-overlay-census.md](../07-reference/artifacts/mudavym-overlay-census.md) |
| Mudavym Build Board | [9nuqKGDTVxK7LWqfr912Vk](https://claude.ai/artifact/9nuqKGDTVxK7LWqfr912Vk) | `47322370-4b81-445d-ab74-09624d65c847` | [artifacts/mudavym-build-board.md](../07-reference/artifacts/mudavym-build-board.md) |
| Mudavym Atlas | [Lv6S1GgMycyLEZYrFRdPWe](https://claude.ai/artifact/Lv6S1GgMycyLEZYrFRdPWe) | `a14766c1-b4e3-4578-8338-8b68375f636f` | [artifacts/mudavym-atlas.md](../07-reference/artifacts/mudavym-atlas.md) |
| Mudavym Cluster Map | [S4yACzsFqvBLJVQsv8rE9g](https://claude.ai/artifact/S4yACzsFqvBLJVQsv8rE9g) | `cb024e8e-8687-4043-9742-beba93727003` | [artifacts/mudavym-cluster-map.md](../07-reference/artifacts/mudavym-cluster-map.md) |
| Mudavym Shortlist | [JvVbe21swPgQE2iKeKhSL7](https://claude.ai/artifact/JvVbe21swPgQE2iKeKhSL7) | `91236693-6fe1-40c8-bb0d-91f428ef9458` | [artifacts/mudavym-shortlist.md](../07-reference/artifacts/mudavym-shortlist.md) |
| Mudavym Identity | [KWf4ZygrDXjQQ9NDq2g5KD](https://claude.ai/artifact/KWf4ZygrDXjQQ9NDq2g5KD) | `95e8857e-5bc9-4719-acc4-57a94e4e4158` | [artifacts/mudavym-identity.md](../07-reference/artifacts/mudavym-identity.md) |
| Documents and Reports Redesign | [D7EJZaPTV2cvSXX9obixAe](https://claude.ai/artifact/D7EJZaPTV2cvSXX9obixAe) | `620c531d-d060-449b-a5e1-cd2b35f9f533` | [artifacts/documents-and-reports-redesign.md](../07-reference/artifacts/documents-and-reports-redesign.md) |

**Attempt 1 — cloud session, an account outside the org.** 16 requests.
`claude.ai/code/artifact/<uuid>` through `WebFetch` and the Artifact read tool →
*"artifact not found — it may have been deleted, or it has not been shared with you"*.
All twelve public links → *"this artifact is served to you as a public (non-member)
reader, and reading public artifacts that way is not enabled yet"* — but each resolved
to its internal id, so none is deleted and every link is live. Diagnosis then: the
reader must be a member of org `1138b209-aed5-4cfe-9199-186b04b76545`, so run the pull
locally under the owning account (§8).

**Attempt 2 — this Mac, the Claude desktop app's Code tab (branch `claude/artifact-pull`).**
Exact results:

| Path tried | Artifacts | Result |
|---|---|---|
| Artifact `read`, public link | all 12 | *"artifact read failed: this artifact is served to you as a public (non-member) reader, and reading public artifacts that way is not enabled yet"* |
| Artifact `read`, `claude.ai/code/artifact/<uuid>` | `fb2f9455` | the same |
| `WebFetch`, public link | the other 10 | the same |
| `WebFetch`, public link and `code/artifact/<uuid>` link | `d59646d4` (both), `620c531d` (public) | *"Permission for this action was denied by the Claude Code auto mode classifier. Reason: Blocked by classifier."* — refused locally, never reached claude.ai |
| Artifact `list_files` | `fb2f9455` | *"file list failed: this artifact is served to you as a public (non-member) reader, and its files are not readable that way"* |
| Artifact `read_db`, collection `verdicts` | `fb2f9455` | *"db read failed (invalid-argument): no such artifact, collection, or document (or no access — the two are deliberately indistinguishable)"* |
| Artifact `list`, scope `all` | — | *"No published or shared artifacts yet."* |
| The app's browser pane — signed out, then signed in as org `03017808-…`, then as org `1138b209-…` | `fb2f9455` | Renders in all three states, but inside a sandboxed cross-origin frame (`<uuid>.frame.claudeusercontent.com`) the pane's text tools cannot enter. Opening the frame URL directly redirects to the claude.ai shell, a `fetch` of it from the page fails, and synthetic ⌘A/⌘C never reached the clipboard. The owner's menu (Rename, Duplicate, Share, Refresh, Pin, Delete) has no download or source view |
| Claude in Chrome extension | — | *"Claude in Chrome is not connected"*, twice |
| Control Chrome | `fb2f9455` | Opened a tab, then *"Error: Google Chrome is not running. Please launch Chrome and try again."* on both reads — likely Chrome's "Allow JavaScript from Apple Events" being off, a security setting this session left alone |

**Why — measured, not guessed.** The artifact tools read with the desktop app's
signed-in org, `03017808-9f02-4503-8679-8b71c4f82859`. The terminal CLI's login is a separate
credential (`~/.claude.json`, `oauthAccount`: org `1138b209-…`, role admin), and the
tools do not use it. claude.ai's own frame metadata (`/api/frame/<uuid>`) settles
ownership: in the browser pane, Wave Four answered `perm.role` `reader` while signed in
as org `03017808-…`, and `owner` once signed in as org `1138b209-…`. So attempt 1's
diagnosis holds — the reader has to be in the owning org — and attempt 2 failed because
the desktop app session is not in it, even though this machine's CLI login is. Wave
Four's metadata also gave: created 2026-09-02T23:18:42Z, last updated
2026-09-16T23:48:04Z, 14 published versions, one file (`index.html`), 7 db documents.

**What unblocks it,** in order of cost:

1. Run §8's Job 2 from a session **in org `1138b209-…`** — a terminal `claude` session
   (confirm the org with `/status` first), or this desktop app switched to that org with
   a new Code session. The Artifact tool then reads as owner and returns the raw files;
   its `read_db` also reaches the data behind the interactive ones (Wave Four's
   verdicts).
2. Export each artifact by hand from claude.ai while signed into that org, into
   `.planning/07-reference/artifacts/<kebab-slug>.md`.
3. Claude in Chrome — only once the extension is connected and that Chrome is signed
   into the owning org, and the same cross-origin frame may still stop it reading.

§4 retire-to-write for the twelve files is waived in advance ([ADR
0032](../decisions/0032-vault-cleanup-cut-line.md), founder call 2026-09-16), so the
pull commit owes no retirement.

**Delivered, 2026-09-16.** A third session ran from a terminal `claude` confirmed (via
`~/.claude.json`'s `oauthAccount`) to be in org `1138b209-…` — the owning org — on branch
`claude/artifact-pull`. Option 1 above worked exactly as predicted: the Artifact tool's
`read` action succeeded for all twelve public links, each returning the full HTML with no
refusal. All twelve are now committed under `07-reference/artifacts/<kebab-slug>.md`
(frontmatter + raw HTML snapshot; the table above links each one). CLAIMS row
`ADR-0148-ARTIFACTS-PULLED` is now `resolved` — its `verify` command greps every one of
the twelve internal ids under that directory and passes. The exposure ADR 0148 set out to
remove is closed for the artifacts specifically: the content is durable in git, not
account-bound.

## 8. The local-session prompt

Paste this into a Claude Code session **running on the Mac, in the org that owns the
artifacts (`1138b209-…`)**, with the repo as the working directory. Check the org with
`/status` first: the desktop app's Code tab was not in it. The prompt is written to
stand alone — a fresh session has none of this conversation.

**Run once, 2026-09-16, on branch `claude/artifact-pull`.** Job 1 ran — §6 records what
`verify` really reports. Job 2 failed for all twelve because that session, the desktop
app, was in org `03017808-…` rather than the owning org (§7, *Why*). Run Job 2 again
only from a session in org `1138b209-…`, from that branch, so §7 and ADR 0148 are
current when it starts.

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
