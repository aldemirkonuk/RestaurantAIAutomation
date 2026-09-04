# 0090 — An Opus audit gate reviews every PR before it merges to main, and an approval merges + deploys with no human click

- **Status:** Proposed (founder answered the two forks live via `AskUserQuestion` on
  2026-09-02; formal lock is a separate founder action per this log's convention —
  see Review trail)
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** audit, merge-gate, autonomous-deploy, opus, branch-protection, ci,
  agent-stack, judgment-class, model-dispatch
- **Links:** [[main-is-branch-protected]], [[merge-races-need-sequencing]],
  [[agent-dispatch-hardness-threshold]] (0050 — governs the model correction below),
  [[absence-reported-as-health]], ADR 0072 (schema-parity-sees-what-it-claims), the
  fork-PR precedent it set for secret-gated required checks

## Context

The founder asked for a standing gate: before any PR merges to `main`, an
Opus-based audit (originally asked as "Sonnet max"; corrected same day — see
Decision) reviews the CI reports and diff, and on approval the PR merges and ships to
production with **no human confirming in the moment**. This repo currently has ~90
concurrent branches/worktrees in flight (`git worktree list` at time of writing, ~628
refs seen by the ADR-number guard) — the volume that makes a manual per-PR review step
a real bottleneck, and the reason this is worth building rather than deferring.

Two things made this a decision rather than a build:

1. `main`'s branch protection ([[main-is-branch-protected]]) requires 5 status
   contexts and has `enforce_admins: false`, `required_pull_request_reviews` unset —
   i.e. **no human-review approval is currently required by GitHub itself**, only
   green checks. So "no human click" does not require overriding a review
   requirement — it only has to not use `--admin` and not skip the existing checks.
2. [[merge-races-need-sequencing]] says escalate to the founder, never `--admin`. An
   autonomous-merge gate has to be built to the same rule it would otherwise be
   tempted to break the moment its own audit is slow.

Real past instances this class of gate targets — not speculative (foundation §3.3):

- **Gateway crash-loop** (`.github/workflows/ci.yml:108-149`, `gateway-boot` job
  added 2026-08-24): `PosHubModule`/`AnalyticsModule` guarded controllers with
  `JwtAuthGuard` without importing `AuthModule`. `tsc --noEmit` was clean and 780
  Jest tests passed; nothing caught it until production did. Narrow, per-defect CI
  checks are added *after* the fact — a holistic reviewer reading the diff against
  Nest's actual module graph is the shape of check that could have caught it
  *before* a dedicated script existed for this exact defect.
- **OAuth self-provision hole** ([[oauth-self-provision-hole]], fixed PR #179):
  Google sign-in minted managers of a real tenant. Shipped with green CI; a
  security-focused reading of the auth diff is exactly the angle that class of bug
  needs and no existing CI job independently covers.

Neither instance proves an LLM audit would have caught it — that's not knowable in
reverse. What they show is the same failure shape recurring: checks that pass
individually while the thing they don't individually cover reaches production.

## Options considered

1. **Claude Code skill + hook only.** Cheap, fast, uses the Agent tool's real
   subagent fan-out. Only fires when I (Claude) am the one merging — does nothing
   for a push or a GitHub-UI merge that happens without a Claude Code session
   driving it.
2. **GitHub Actions required check only.** Enforces for every path (any pusher, the
   GitHub UI, another tool) via a real CI job calling the Anthropic API directly.
   Needs `ANTHROPIC_API_KEY` as an Actions secret (does not exist yet — the founder
   has to add it; entering secrets is not something I do) and cannot use the Agent
   tool's subagent framework — it has to re-implement the fan-out as sequential API
   calls.
3. **Both (chosen).** The Claude-side hook is the fast path for sessions like this
   one; the Actions workflow is the backstop that holds regardless of who or what is
   merging. Costs: two implementations of the same audit logic that can drift, and
   the Actions path needs a secret only the founder can provision.
4. *(Doing nothing — keep merges manually reviewed.)* Costs the founder a
   per-PR bottleneck at the current concurrency (dozens of live branches); this is
   exactly the volume the founder asked to remove themselves from.

A related, narrower fork inside option 3: should the Actions check be added to
`main`'s **required** status contexts? That PATCH is a persistent-configuration
change to branch protection, which this session does not make without the founder's
explicit go — see "What this does NOT yet do" below. Until that PATCH runs, the
Actions job is advisory (it still posts findings and still auto-merges on PASS via
its own logic) but not a hard GitHub-level block for a path that bypasses it
entirely (e.g. someone merges manually before the job finishes).

## Decision

Ship both layers, gated on the founder's two live answers ("both" locations, "fully
autonomous" merge), with the autonomy scoped as narrowly as those answers allow:

- **Claude Code side:** `.claude/skills/pr-audit-gate/SKILL.md` orchestrates 3
  auditor subagents (`.claude/agents/pr-merge-auditor.md`, fanned out across
  correctness/regression, CLAUDE.md-and-ADR compliance, and
  security/blast-radius angles) plus a mandatory adversarial pass
  (`.claude/agents/pr-merge-adversary.md`) on any approve-leaning verdict — the
  fan-out-then-adversary shape CLAUDE.md §3 already requires for any decision this
  weighty. A `PreToolUse` hook (`scripts/hooks/require_pr_audit.py`) blocks any
  Bash call shaped like `gh pr merge` or a direct push to `main` unless a passing
  audit report exists for that exact PR head SHA — this is the "you call it, make it
  a constraint" half of the request. Precision on what kind of constraint (fifth
  audit, security angle, note 6): the trusted-author set includes whoever is running
  `gh` locally, so nothing code-level stops a session from posting a marker without
  having actually done the work and then merging — the hook proves *some* marker
  exists for this exact PR+SHA, not that a genuine audit produced it. This is
  procedural, not cryptographic: it holds as long as the session follows this
  skill's actual steps, the same trust basis every other instruction in this repo
  runs on.
- **CI side:** `.github/workflows/pr-audit-gate.yml` runs the same fan-out as
  four Anthropic Messages API calls (`scripts/pr_audit_gate.py`), gated on
  `main`'s required status contexts — read fresh from branch protection on
  every run, never hardcoded, since that list moved from 5 to 3 while this ADR
  was still open — having already gone green (this is a semantic layer on top
  of green CI, never a replacement for it). On approval it runs
  `gh pr merge --auto --squash` — GitHub's native auto-merge, which waits on the
  pre-existing required contexts and never uses `--admin`. On any error (API
  failure, can't reach the reports, ambiguous verdict) it fails closed: no merge,
  and the PR comment says so in words, never a silent green
  ([[absence-reported-as-health]] — a check that can't verify must not read as
  health).
- **Corrected, sixth audit round:** only the Claude-Code path still writes
  `.planning/07-reference/pr-audits/` (a convenience copy, not what's
  checked). The CI path never did once the report-shape design changed
  (see the third Correction) — its full report lives only in the PR
  comment, which is the actual durable record for that path.

**Model corrected from "Sonnet max" to Opus, same day, before merge.** The
original ask specified Sonnet at maximum reasoning effort. [[agent-dispatch-hardness-threshold]]
(ADR 0050, locked) already answers this: it scores model dispatch on judgment +
consequence, ≤3 Sonnet / ≥4 Opus, with an explicit override to Opus for
**auth, production, ADRs, or outward sends** — and "never score effort" as a
substitute for the tier the consequence calls for. This role hits three of
those four overrides at once (it is itself an ADR's implementation, it decides
what reaches production, and its output is an outward send — a merge + deploy).
Sonnet-at-max-effort was not a defensible reading of the repo's own locked
dispatch rule; Opus is. Within Opus, effort is set to **high** rather than
"max": ADR 0050 governs model *tier*, not effort, and a per-PR CI gate calling
this on every push needs a bounded, predictable latency/cost — "high" is the
practical ceiling, not "max" run unboundedly on every merge forever. Both
agent definitions carry `reasoning_effort: high` in frontmatter as a
best-effort signal (harmless if the harness ignores unknown frontmatter keys);
the mapping from "high" to a concrete effort knob is not documented where I
could verify it. The CI-side script requests extended thinking with a bounded
token budget as the closest verifiable equivalent. This is stated as a
limitation, not a verified guarantee.

## Consequences

- What becomes easier: PRs merge without the founder in the loop, at the
  concurrency this repo is actually running.
- What becomes harder / given up: a bad audit call now ships to production
  unattended. The adversarial pass and fail-closed error handling are the
  mitigations; they are not a proof of safety.
- **What this does NOT yet do:** it does not add `PR Audit Gate` to `main`'s
  required status contexts (that PATCH is a persistent-config change needing
  explicit founder permission per this session's operating rules — command is
  ready, not run) and, as of 2026-09-02, it does not yet have an
  `ANTHROPIC_API_KEY` **Actions secret** — the founder has the key in a local,
  gitignored `.env`, which is a different store: GitHub Actions reads only its
  own secret store, never a repo's `.env` file, and I do not read a credential's
  value out of `.env` and enter it anywhere myself (prohibited regardless of
  authorization). The founder still needs to run
  `gh secret set ANTHROPIC_API_KEY` (or the GitHub UI) themselves. Until both
  happen, the CI half posts findings and will still attempt its own
  `gh pr merge --auto`, but nothing stops a merge that bypasses this workflow
  entirely — only the Claude-side hook is a hard constraint, and only inside a
  Claude Code session.
- **Correction, second live audit (2026-09-03):** the line above originally
  claimed fork PRs can't see this secret, true of `pull_request` (ADR 0072's
  precedent) and carried over unchanged when this workflow moved to
  `pull_request_target` for the self-audit fix — which is exactly backwards
  for that trigger. This repo is confirmed **public, 0 forks**
  (`gh repo view`), so `pull_request_target` runs with the full base-repo
  token and secrets for a PR from **any** GitHub account, not only forks.
  Exposure stays bounded (checkout is pinned to base, no external code
  executes, branch protection still blocks an outside merge), but an
  unrelated account could trigger API spend at will — closed with an
  `author_association` gate (OWNER/MEMBER/COLLABORATOR only) in the
  workflow, evaluated from the trusted event payload, not the PR's content.
- Four ADR-number collisions (0012, 0013, 0028, 0049) exist across the ~628 refs
  the numbering guard swept — pre-existing, not caused by this decision, flagged
  separately rather than fixed here (out of this operation's scope).
- Signal that would trigger revisiting this: a BLOCK verdict that a human review
  would have overturned (over-blocking), or one confirmed production incident that
  passed this gate (under-blocking) — either is grounds to reopen the "fully
  autonomous" half of this decision specifically, not the whole gate.

## Correction — 2026-09-03, found by the gate's own first real audit

Run 33695630472 (PR #261's own `PR Audit Gate` check, first run with a working
`ANTHROPIC_API_KEY`) BLOCKed on both correctness and security, having audited
the PR that introduces this exact ADR and its implementation. Real findings,
not hypothetical, fixed same day (see the commit that added this section):

1. **Security BLOCK — the gate audited its own, possibly-modified code.** The
   workflow was `on: pull_request` with default checkout (the PR's own tree)
   and `contents: write` + the live key in env. A same-repo PR editing
   `scripts/pr_audit_gate.py` could make the verdict parser always return
   PASS, self-merge, and exfiltrate the key on the way out — a same-repo
   mirror of the OAuth self-provisioning hole this ADR already cites, one
   layer up in CI. Fixed with `pull_request_target` + a checkout pinned to
   the base commit (the standard GitHub-documented fix for this exact "pwn
   request" class), plus a belt-and-suspenders check inside the now-trusted
   script: any diff touching the gate's own files force-BLOCKs with an
   explicit escalation note regardless of angle verdicts. This ADR's original
   "no migration, no auth FK, no tenant boundary — nothing to burn" framing
   for this class of change was wrong; a CI execution surface with write
   access and a secret is exactly that class of burn, just not a database one.
2. **Correctness BLOCK, livelock.** The skill instructed committing the
   report file, on the PR's own branch, immediately before the gated merge
   call — which changes the head SHA the hook's existence-check is keyed to,
   so the just-written report can never satisfy a check for the SHA it
   produces. Fixed by dropping the committed-file requirement: both
   enforcement paths now post a machine-readable
   `<!-- pr-audit-gate: pr=<n> sha=<sha> verdict=PASS|BLOCK -->` marker as a
   PR comment instead, which has no SHA-changing side effect.
3. **Correctness BLOCK, wrong-PR resolution.** The hook resolved "the PR to
   check" via the *current checkout's branch*, never the PR number in the
   command actually being gated — in this repo's ~90-worktree concurrency, a
   session on branch A could validate branch B's merge against A's own
   report. Fixed: the hook now parses the PR number out of the gated command.
4. **Correctness BLOCK, verdict bypass.** `"PASS" in line and "BLOCK" not in
   line` over the report's first 20 lines is a substring scan a BLOCK
   report's own prose could satisfy ("Upstream required contexts: all
   PASS"), green-lighting a merge the audit explicitly rejected — this
   repo's own `absence-reported-as-health` shape, found inside the guard
   written to prevent it. Fixed: the marker line from (2) is now the only
   thing either path is allowed to parse for a verdict.

None of the four are edge cases speculated into existence — all four are
concrete, traced failure scenarios the audit gave file:line citations for.
This is stated here rather than only in the fix commit because it changes a
claim the Decision section above makes: "fully autonomous merge" was shipped
with a path that could have been silently self-authorized by any same-repo PR
touching the gate's own files, for however long it took someone to notice.
It was noticed by the gate itself, on its own first real run, before this ADR
was locked — which is the argument for keeping the mandatory adversarial-pass
and multi-angle shape even where it is inconvenient, not evidence the shape
worked as designed (a BLOCK on the PR that introduces it is not the intended
happy path).

## Correction — 2026-09-03, found by the gate's own SECOND real audit

Re-running the (now fixed) gate against the fix from the correction above
found two more real defects in the fix itself, not new ground:

1. **The verdict-bypass class from correction #4 above was fixed in the
   wrong function.** `require_pr_audit.py`'s hook-side check got the strict
   marker line; `pr_audit_gate.py`'s own `_verdict_of()` — the function that
   actually decides `overall` and therefore whether `gh pr merge --auto`
   runs — still used the identical unanchored `re.search` (first match,
   case-insensitive substring) it was supposed to have replaced everywhere.
   Concretely: the adversary's prompt includes the three angle reports, each
   ending `VERDICT: APPROVE`; a model arguing against that verdict very
   naturally quotes it before delivering its own ("The three reviewers said
   VERDICT: APPROVE. I disagree... VERDICT: OVERTURNED") — and the old parser
   returned the quoted APPROVE, silently reversing a real OVERTURNED into a
   merge. A second bug rode along: alternation order (`APPROVE` tried before
   `APPROVE WITH NOTES`) matched the shorter alternative as a strict prefix,
   so every APPROVE WITH NOTES verdict was recorded as plain APPROVE. Fixed:
   `_verdict_of()` now requires the verdict on its own line (`(?m)^...$`)
   and takes the LAST match, matching what every prompt actually instructs
   ("end your response with a line exactly...") and the longer alternative
   listed first.
2. **The corrected "fork PRs can't see this secret" claim was never
   corrected for the trigger that made it wrong.** `pull_request_target`
   (the fix in the first correction) runs with the base repo's full token
   and secrets for every triggering event — not only forks, and this repo
   is confirmed public with 0 forks, so in practice **any GitHub account**
   could trigger a job holding `contents: write` + the live key. No code
   execution path exists for that account to exploit (checkout stays pinned
   to base), so this was not re-opening the self-audit hole — but it is a
   real, live cost/attention-griefing surface the ADR's own words denied.
   Closed with an `author_association` gate (OWNER/MEMBER/COLLABORATOR),
   evaluated from the trusted event payload rather than PR content.

Both were found by three fresh Opus subagents run through the actual
Claude-Code-side skill (not the CI path — `pull_request_target` cannot audit
the PR that introduces it, by design, see the workflow file) against PR #261
directly, per ADR 0090's own procedure. The security angle traced (1) with a
concrete constructed input and confirmed it against the live parser before
reporting it; this session verified the same construction independently
before fixing it, rather than fixing on the subagent's word alone.

## Correction — 2026-09-03, found by the gate's own THIRD real audit

A fourth full audit round (all three angles fresh, run against the fixes
above) returned BLOCK on all three. Six defects, four of them the identical
class recurring a third time — a decision made by a deny-list or a scan
looser than the thing it decided:

1. **`overall`'s two decisions were both deny-lists.** `"BLOCK" if
   adv_verdict in ("OVERTURNED", "UNPARSEABLE") else "PASS"` treats the
   adversary literally answering the word `BLOCK` — a real, parseable value,
   and the exact wording `pr-merge-adversary.md` itself models
   ("OVERTURNED — BLOCK") — as anything-other-than-those-two-strings, which
   is PASS. **Confirmed by executing the real function**: `adv_verdict =
   "BLOCK"` produced `overall = "PASS"`. The angle-level check had the mirror
   gap (an angle answering OVERTURNED/HOLDS by mistake wasn't blocked
   either). Both are now allow-lists: only `HOLDS` passes the adversary;
   only `APPROVE`/`APPROVE WITH NOTES` pass an angle.
2. **`_verdict_of()`'s round-2 fix (anchor + last-match) was still a scan.**
   Any trailing quoted/appendix verdict line won on last-match, and a
   decorated line (`**VERDICT: X**`, `` `VERDICT: X` `` — the system prompt
   itself modeled the backtick form) never matched the anchor at all,
   silently falling back to an earlier undecorated match. **Confirmed by
   execution** against constructed inputs matching both shapes. Rewritten to
   inspect ONLY the response's actual last non-blank line (never a text-wide
   scan), with common decoration stripped before matching.
3. **The marker check (require_pr_audit.py) was unauthenticated.**
   **Confirmed by executing the real hook** with a shimmed comment authored
   by an unrelated account: exit 0, merge allowed. This repo is public with
   one collaborator (the founder); anyone could read a PR's head SHA off the
   page and post a forged marker. Now checks comment author against the CI
   bot plus whoever is running `gh` locally, and matches the marker only at
   a comment's own start (`.match()`, not `.search()`/`.finditer()`) — a
   trusted comment's own embedded report can legitimately discuss marker
   syntax with real-looking values without that counting.
4. **`gh pr merge --auto` races an unaudited later commit.** `--auto` arms
   GitHub's auto-merge against the PR, not the SHA that passed audit; a push
   landing after PASS but before the actual merge could go through once the
   *other* required checks are green, with this gate's own re-run for that
   new commit reduced to an advisory red check nobody has to look at. Fixed
   by merging immediately with an exact-`sha`-pinned `gh api .../merge` call
   instead — GitHub refuses (409) if the head has moved, so the failure mode
   is "don't merge, say why," not "silently merge the wrong commit."
5. **`wait_upstream`'s pass/fail split was a deny-list too** — `TIMED_OUT`,
   `ACTION_REQUIRED`, `STARTUP_FAILURE`, `NEUTRAL`, `STALE` are real
   check-run conclusions that were neither "pending" nor "failed" in the old
   lists, falling through to green by default. Now an allow-list: only
   `SUCCESS` is green.
6. **Two smaller, real gaps from the same session, not the fourth audit:**
   `MERGE_PATTERN` only captured a PR number immediately after "merge" —
   `gh pr merge --squash 42` fell back to the current-branch resolver, the
   exact bug correction #1 already fixed once; and `DIRECT_PUSH_PATTERN`'s
   `\s*$` anchor (added to kill a false-positive) meant `git push origin
   main --force` — the single most consequential form — evaded it entirely.
   Both fixed; `gh pr diff --name-only`'s unchecked returncode (silently
   `touches_own_gate = False` on failure) also closed, failing toward
   escalation rather than away from it.

A `--self-test` mode now pins the exact adversarial inputs across all three
audits (`python3 scripts/pr_audit_gate.py --self-test`, wired as a required
step in the workflow before anything else runs) — named directly in the
prior Correction's own text as the gap that let this class survive three
rounds: *"zero tests and zero guard for the single function that has now
decided a merge wrongly twice."* It had decided a merge wrongly a third
time by the point this was written.

## Correction — 2026-09-03, found by the gate's own FOURTH real audit

Correctness and security run fresh a fourth time (compliance skipped this
round — its findings are documentation-severity and the third round's were
already fully addressed). Both returned BLOCK, on two findings neither
prior round reached — one of them the most consequential in this ADR.

1. **The CI-side merge silently removes the post-merge deploy audit.**
   Confirmed against GitHub's own documented behavior, not reasoned about:
   a push made with the built-in Actions `GITHUB_TOKEN` does not trigger a
   *new* workflow run (recursion suppression; the two documented exceptions
   are `workflow_dispatch`/`repository_dispatch`). The CI-side merge step
   uses exactly that token. So `ci.yml`'s `on: push` for a gate-driven merge
   never fires, and `deploy.yml`'s `workflow_run: workflows: ["CI"]`
   trigger — the post-merge health/deploy audit [[production-deploy-verification]]
   and ADR 0085 exist because CI alone can't see a DI failure — never fires
   either. Not skipped, not red: **no run at all**, for a merge this repo
   already built a whole finding ([[absence-reported-as-health]]) around not
   letting happen quietly. Confirmed against this repo's actual history:
   every merge to `main` to date is founder-identity (`web-flow`), so this
   path had never once been exercised before this ADR's own gate. Fixed by
   adding a `workflow_dispatch:` trigger to `ci.yml` (purely additive — does
   not change push/pull_request behavior) and having the CI-side merge step
   explicitly `gh workflow run ci.yml --ref main` right after a successful
   merge, re-entering the chain through the one path GITHUB_TOKEN doesn't
   suppress. Fails LOUD on failure (stderr + PR comment), not closed — there
   is no clean rollback for "the merge already happened but we couldn't
   confirm CI re-ran." **The Claude-Code-side merge path was never affected**
   — it pushes under the session's own `gh auth` identity, not GITHUB_TOKEN,
   which is exactly why the repo's whole merge history to date looks the way
   it does; noted explicitly in SKILL.md so this isn't fixed twice.
2. **The repo-wide hook both over-blocked and under-blocked, confirmed by
   execution.** `DIRECT_PUSH_PATTERN`'s exclusion set didn't exclude
   newlines, so it spanned across separate statements in a multi-line
   command — `git push origin feat/x` followed on a new line by
   `gh pr create --base main --fill` was wrongly BLOCKED because "main"
   appeared on the *second* line. The mirror gap: `\bgit\s+push\b` requires
   "push" immediately after "git", so `git -C <worktree> push origin main`
   — the natural form in this repo's own stated ~90-worktree concurrency —
   was **not** matched at all, letting a real direct push to `main` through
   undetected. Both fixed (newline excluded from the scan; an optional
   `-C <path>` allowed between "git" and "push"). Separately: the CI bot's
   trusted-author entry (round 3) held the REST API spelling
   ("github-actions[bot]"), but this hook calls `gh pr view --json comments`
   (GraphQL-backed), which returns the login *without* the suffix —
   confirmed by execution, the hook trusted **no** comment the CI bot ever
   posted. Fail-closed (safe), but broke the CI half of the gate outright.
   Both spellings now trusted, with the mismatch's own risk named rather
   than assumed permanent.
3. **The diff-truncation gap the third round's correctness angle didn't
   reach.** `bundle` capped the diff at 60,000 chars and asked the model, in
   prose, to note the limitation — `overall` never consulted whether
   truncation happened. Confirmed by harness-executing the real
   `_run_audit_inner` with a synthetic 68,770-char diff carrying a planted
   regression past the cut: the auditor never saw it, dutifully noted the
   truncation, approved what it could see, and the function issued a real
   `gh api .../merge` call. Measured against this repo's actual PRs: 10 of
   the last 20 merged exceed 60,000 chars, including this PR's own two gate
   scripts sitting past the old cut. Fixed two ways: the budget raised to
   300,000 chars (shrinks how often this fires at all), and — for whenever
   it still does — `truncation_occurred` now force-BLOCKs exactly like
   `touches_own_gate`, deterministically, never left as a sentence in a
   prompt. `escalation_note` (round 3's own omission, also closed this
   round) is now written into the archived report as well as the comment,
   so a BLOCK's *reason* survives if the comment thread is ever pruned.
4. **Two smaller closes, same round:** `gh pr comment`'s returncode was
   unchecked before merging — a failed post meant a PASS could ship with no
   durable record at all; now refuses to merge if the comment didn't land.
   `wait_upstream`'s timeout path returned exit 0, so a run that gave up
   waiting (never confirmed upstream either way) looked identical to a run
   that legitimately had nothing to say — now exits 1, distinct from the
   "a required check is genuinely, confirmedly red" case, which correctly
   stays a benign 0.

Every BLOCK above was reproduced against the real functions before being
accepted, not taken from the subagents' prose. `--self-test` grew from 17 to
24 invariants covering all of it.

## Correction — 2026-09-03, found by the gate's own FIFTH real audit

A verification round (correctness + security, fresh Opus subagents) re-tested
round 4's three fixes by trying to defeat them rather than confirming they
exist. Two hold. **The headline fix — the GITHUB_TOKEN deploy-chain
workaround — does not work at all**, found independently by both angles:

1. **The `workflow_dispatch` re-trigger 403s on every single run.**
   `.github/workflows/pr-audit-gate.yml`'s `permissions:` block granted
   `contents: write`, `pull-requests: write`, `checks: read` — no `actions:`
   scope, which `gh workflow run` (and even looking the workflow up) requires.
   GitHub's own rule: specifying a `permissions:` block sets every unlisted
   scope to `none`. This repo already knew the shape — `deploy.yml` declares
   `actions: write` for the identical `gh workflow run` call it makes.
   **Confirmed by execution** (both angles, independently): the dispatch call
   403s every time; the merge (already irreversible) still succeeds; the
   dispatch failure was caught and reported — but the function returned 0,
   so the JOB showed green having merged code with its own safety mechanism
   silently non-functional. Self-caught between rounds 4 and 5, before either
   agent's report arrived: `actions: write` added to the permissions block,
   and the dispatch-failure path now returns 1 (a merge with a confirmed-
   failed post-merge check must not report as a successful job, even though
   the merge itself can't be undone).
2. **Round 4's own `\n`-exclusion fix regressed a real case.** Excluding
   newlines from `DIRECT_PUSH_PATTERN`'s scan fixed the multi-*statement*
   false-positive but broke the multi-*line-same-statement* case — a plain
   backslash line continuation (`git push \` + newline + `  origin main`)
   stopped matching at all. Fixed by normalizing backslash-newline
   continuations to a single space before matching, rather than encoding
   "this newline doesn't end the statement" into the regex itself; bare
   newlines (no preceding backslash) still correctly act as a boundary.
   Also widened the trailing match to accept `;` and a quoted ref
   (`git push origin main;` / `git push origin 'main'` previously fell
   through since neither whitespace nor end-of-string followed "main").
3. **Smaller, real, folded in the same round:** `MAX_TOKENS` raised
   12000 → 16000 — with a large diff and "high" adaptive-thinking effort,
   the model's own reasoning could consume the output budget before
   reaching its final `VERDICT:` line, correctly failing to `UNPARSEABLE` →
   BLOCK (safe direction) but false-blocking a large, genuinely fine PR on
   token exhaustion rather than its content; confirmed the diff budget
   itself (300,000 chars) is safe against `claude-opus-5`'s real 1M-token
   context, well past the 200K this session had assumed. `.github/workflows/ci.yml`
   added to both owned-path lists — it now carries a dependency (the
   `workflow_dispatch:` trigger) the merge step relies on, and neither list
   named it. `_redact` extended to `github_pat_`. The ADR's own "I cannot
   skip it from inside a session" (this section, above) overstated the
   guarantee — corrected in place to say what the hook actually proves
   (a marker exists for this PR+SHA) versus what it can't (that a genuine
   audit produced it) — procedural, not cryptographic, same as this repo's
   [[decision-register-rots]] finding.

`--self-test` grown 24 → 29. Two residual, explicitly non-blocking items
both angles agreed on and left named rather than silently accepted: the
Claude-Code-side merge (`gh pr merge --squash`) stays unpinned to an exact
SHA, unlike the CI side's `gh api` call — same class as round 3's fix, a
far smaller window (seconds inside one live session, not a CI queue); and
`_extract_pr_number` can still mis-resolve a PR number when a `gh pr merge`
flag takes a purely-numeric value ahead of the real positional argument — a
contrived shape, not a realistic `gh pr merge` invocation today, named
rather than engineered around given the "loose regex, known limitation"
design already stated for this whole hook.

## Correction — 2026-09-03, found by the gate's own SIXTH real audit (final)

A closing round, deliberately scoped as one combined correctness+security
pass rather than three separate angles, explicitly asked to try to defeat
the parsers/hook one more time and to say plainly if nothing real turned
up. Its own words: *"Had the workflow-level finding not existed, my honest
answer would have been APPROVE… this surface has genuinely converged."*
17 new adversarial shapes against `_verdict_of`, 20 against
`DIRECT_PUSH_PATTERN`, more against `MARKER_RE` and `_extract_pr_number` —
all held; the 4 `DIRECT_PUSH_PATTERN` misses found are the exact global-git-
flag gap already named in that file's own comment.

One real finding, in a layer no prior round had audited: **the YAML that
*consumes* `wait_upstream`'s return value, not the Python that produces
it.** `wait_upstream` returning 0 on a *confirmed* red required check (kept
that way by round 4, which fixed only the *timeout* branch to exit 1,
reasoning the confirmed-red case was "legitimate, known-good, nothing to
say") meant the "Wait for the existing required checks" step succeeds, the
"Run the PR audit gate" step correctly SKIPS, and every step having
succeeded-or-skipped, **the JOB's own conclusion is `success`** — for a run
that audited nothing at all. Confirmed against this PR's own run
33693914368. Harmless today only because this check is not yet required;
the instant it is (the branch-protection PATCH this ADR has deferred to the
founder throughout), a required context reading SUCCESS while never having
audited anything is exactly the fault class this file's own NEVER VACUOUS
header exists to prevent — round 4's reasoning for the distinction didn't
survive contact with how GitHub actually evaluates a required check (it
asks "is there a successful run of this name for the current SHA," not
"did that run's job actually do the thing its name claims"). Fixed:
`wait_upstream` now exits 1 for a confirmed-red required check too, the
same as the timeout case — every non-SUCCESS path agrees now: don't merge,
and don't let the JOB look like it had something to say when it didn't.

Also closed the same round: this document's own drift after five prior
Corrections — the "both write the same report shape" line (no longer true;
only the Claude-Code path still writes `.planning/07-reference/pr-audits/`,
corrected in place above) and the Review-trail table, which had fallen two
rows behind its own Correction count (fixed by this edit).

## Correction — 2026-09-04, found by PR #291's security audit

Unlike the first six, this correction did not come from a round of the gate
auditing its own introducing PR — it came from the gate auditing an unrelated
PR ([PR #291](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/291),
`fix/deploy-check-path-scoped`, ADR 0097's path-scoped deploy check) whose
security angle noticed, in passing, that the gap it was about to hit itself
generalizes: **`_GATE_OWNED_PATHS` covered `.github/workflows/ci.yml` but not
`.github/workflows/deploy.yml`**, the post-merge production-deploy-verification
workflow ADR 0097 built. A PR that loosened `check_deployed_sha.py`'s
`--expect`, dropped a verification stage, or redefined what counts as
`provenance_verified` would have been evaluated as an ordinary PR and could
self-merge on three APPROVEs, even though it edits the only thing that proves
production actually got what merged — the same class of hole `ci.yml` was
added to close in the fifth Correction, just on the other workflow file. PR
#291's own report named this explicitly rather than silently working around
it or bundling the fix into an unrelated PR (which would itself have needed
this same escalation, for an unrelated reason) — flagged as its own follow-up.

Fixed: `.github/workflows/deploy.yml` added to `_GATE_OWNED_PATHS` in
`scripts/pr_audit_gate.py`, and to the matching list in
`.claude/skills/pr-audit-gate/SKILL.md` step 4 (kept in sync per the third
Correction's own note — they had drifted once before, over `CLAUDE.md`).
`--self-test` was checked for a case enumerating `_GATE_OWNED_PATHS`'s
contents; it has none (the escalation tests exercise the generic
`touches_own_gate` decision against a synthetic reason string, not the tuple
itself), so no test needed growing. This PR, editing `_GATE_OWNED_PATHS`
itself, force-escalates under its own new rule — per ADR 0090's design, it is
not self-merged; the founder reviews and merges it directly, the same path
PR #261 needed.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Aldemir (via `AskUserQuestion`) | Both enforcement layers; fully autonomous merge — answered live, this ADR records it |
| 2026-09-02 | — | Created; status left `Proposed` pending the founder's explicit lock per this log's own convention |
| 2026-09-02 | Aldemir (chat) | Asked "sonnet ultrathink or opus high" — corrected model from "Sonnet max" to **Opus / high** per ADR 0050's own override rule, before merge. Files/branding renamed off "sonnet" to match (`pr-merge-{auditor,adversary}.md`, `pr-audit-gate.yml`, `pr_audit_gate.py`, `require_pr_audit.py`) |
| 2026-09-03 | `PR Audit Gate` (Opus, run 33695630472) | BLOCK — security + correctness, both confirmed real; 4 fixes landed same day, see first Correction above |
| 2026-09-03 | pr-audit-gate skill, security angle (Opus subagent) | BLOCK — the verdict-parser fix from the first correction was incomplete (wrong function) and the fork-secret claim was wrong for the new trigger; both confirmed independently and fixed, see second Correction above |
| 2026-09-03 | pr-audit-gate skill, all 3 angles (fresh Opus subagents) | BLOCK, BLOCK, BLOCK — a deny-list verdict decision in two places (one confirmed by execution to invert a literal adversary "VERDICT: BLOCK" into a merge), an unauthenticated marker check (confirmed by execution against a shimmed outsider comment), an `--auto` merge race, and a deny-list state classifier; 6 fixes landed same day plus a `--self-test`, see third Correction above |
| 2026-09-03 | pr-audit-gate skill, correctness + security (fresh Opus subagents) | BLOCK, BLOCK — a GITHUB_TOKEN merge silently removes the post-merge deploy audit (confirmed against GitHub's documented behavior + this repo's own merge history); a repo-wide hook that both over- and under-blocked real git commands (confirmed by execution); a diff-truncation gap the third round's correctness angle didn't reach (confirmed by harness-executing a planted regression past the old cut); 6 fixes landed same day, `--self-test` grown 17 → 24, see fourth Correction above |
| 2026-09-03 | pr-audit-gate skill, correctness + security (fresh Opus subagents) | BLOCK, BLOCK — round 4's own `workflow_dispatch` fix 403'd on every run (missing `actions: write`, self-caught independently before either report landed) and round 4's own `\n`-exclusion regex fix regressed a real backslash-continuation case; both fixed same day, `--self-test` grown 24 → 29, see fifth Correction above |
| 2026-09-03 | pr-audit-gate skill, combined correctness+security (fresh Opus subagent, final round) | BLOCK — one finding, in the YAML consuming `wait_upstream`'s return value rather than the Python producing it: a confirmed-red required check reported job SUCCESS having audited nothing; fixed same day. Explicitly stated the parsers/hook have converged after five prior rounds' adversarial testing found nothing new, see sixth Correction above |
| 2026-09-03 | pr-audit-gate skill, security angle, auditing PR #291 (unrelated PR) | Noted in passing, not a BLOCK on PR #291 itself: `_GATE_OWNED_PATHS` doesn't cover `deploy.yml`, flagged as its own follow-up PR rather than bundled in; fixed 2026-09-04, see seventh Correction above |
