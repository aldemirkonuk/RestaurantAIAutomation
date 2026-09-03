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
  a constraint" half of the request: I cannot skip it from inside a session.
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
- Both write the same report shape to `.planning/07-reference/pr-audits/`.

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
- Fork-PR precedent (ADR 0072 / `docs/fork-prs-cannot-satisfy-required-checks`,
  merged as of this ADR): a fork PR cannot see repo secrets, so `ANTHROPIC_API_KEY`
  is unavailable to it. Not an issue while this repo has no forks; would need the
  same treatment as the schema-parity checks if that changes.
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

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Aldemir (via `AskUserQuestion`) | Both enforcement layers; fully autonomous merge — answered live, this ADR records it |
| 2026-09-02 | — | Created; status left `Proposed` pending the founder's explicit lock per this log's own convention |
| 2026-09-02 | Aldemir (chat) | Asked "sonnet ultrathink or opus high" — corrected model from "Sonnet max" to **Opus / high** per ADR 0050's own override rule, before merge. Files/branding renamed off "sonnet" to match (`pr-merge-{auditor,adversary}.md`, `pr-audit-gate.yml`, `pr_audit_gate.py`, `require_pr_audit.py`) |
| 2026-09-03 | `PR Audit Gate` (Opus, run 33695630472) | BLOCK — security + correctness, both confirmed real; 4 fixes landed same day, see Correction above |
