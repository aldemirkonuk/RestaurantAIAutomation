# Token efficiency and review pipeline: local implementation

Date: 2026-09-16. Branch: codex/token-efficiency-ci-20260916.
Base: 60ed83a7e6d5eb8b8e0e631783a598cd0f562bff (verified GitHub main).
Status: local, uncommitted; not pushed, merged, deployed or exercised with paid APIs.

## What was actually expensive

The earlier local telemetry audit found 96.05% Codex input cache reuse; the supplied
Claude export indicates about 97.94%. The demonstrated problem is repeated large
contexts across many calls and coordinating sessions, not a general cache failure.
In one measured Mudavym coordinator/three-worker group, 1,504 requests carried
207.8M input tokens over about 3h23m. Cache hits reduce processing price, not the
number of repeated tokens. This does not prove that provider allowance rules or
the user's workload were identical to the initial subscription period.

The old PR audit made three sequential Opus calls, plus a fourth Opus challenge
when all approved. It discarded response usage and performed known escalation
checks after paying for reviews. These CI calls use ANTHROPIC_API_KEY: they are
API activity, not proven consumption of the Claude subscription allowance.

## Implemented

- scripts/pr_audit_review.py: Opus plan, two parallel Sonnet reviews, resumed Opus
  final judgment. Three roles, maximum four calls. Independent security/adversarial
  review remains; original evidence goes to every reviewer. Reviewer BLOCK cannot
  be overridden. Incomplete or unparseable responses fail closed.
- scripts/pr_audit_gate.py: early deterministic rejection of self-gate changes,
  unreadable file lists, failed diff fetch and oversized diffs. Existing pinned
  merge and comment-success requirements remain. Pending/missing/failed check
  names are printed only when the state changes.
- pr-audit-gate.yml: no paid audit for drafts; 35-minute job limit; offline routing
  tests; 30-day usage artifacts. Each call has a 180-second timeout and no hidden
  SDK retries. A timeout does not certify zero spend.
- Matching local Claude agent definitions and skill: explicit Opus/Sonnet routing,
  short evidence-focused reports, and exact-head CLI merge matching.
- Existing DECISION-INDEX.md regenerated; existing CI ADR job checks freshness.
  CLAUDE.md routes orientation through this index instead of the huge prose log.
- ADRs 0050 and 0090 amended with dated provenance; original rationale preserved.
  Scripts first, Haiku for checkable discovery, Sonnet for investigation, Opus for
  consequential judgment. Product inference routing is unchanged.
- deploy.yml and e2e-prod.yml use vars.APP_PRODUCTION_URL, with canonical
  https://mudavym.com fallback. Build, health and E2E remain. vercel.json and live
  hosting integrations were not changed. No Vercel required gate was found live.
- AGENTS.md was not changed. No broad archive, repo split or module rewrite.

## Coordination across sessions

Keep one canonical, versioned brief per topic in the existing task note. Assign
subquestions and edit ownership, not duplicate broad assignments. Allow deliberate
overlap for independent review. Workers return findings, citations, revision/file
hashes, verification and blockers; the integrator updates shared decisions/indexes.
Send milestone or changed-evidence messages instead of repeated status polls.
On handoff, read changed dependencies and pivotal evidence, not every prior file.
The copyable brief format and risk-based completion boundaries are in ADR 0050.

Pros: less repeated orientation and rewriting; fewer conflicting edits; research
still expands when evidence requires it. Cons: briefs can become stale, cheap
discovery can miss nuance, and parallel sessions still intentionally duplicate
some review. Revision checks, explicit uncertainty and escalation address those
risks; they do not eliminate the need for judgment.

Haiku is not needed to regenerate the index: a script is cheaper and exact. It can
classify search results with citations. Sonnet should handle behavioral tracing;
Opus checks consequential claims rather than rereading everything by default.

## Why CI takes time

Read-only observations from GitHub Actions on 2026-09-16:

| Evidence | Observation |
|---|---|
| CI run 34835900517 | 9m37s total; lint -> TypeScript tests (5m26s); build -> E2E (3m38s) |
| Same run, Python | Tests took 4m18s after Python lint |
| Same run, E2E steps | Browser installation 54s; Playwright 123s |
| Other recent CI runs | Approximately 7-10 minutes, not endlessly running |
| Schema run 34838564614 | Required parity/identity checks failed; repeated waiting is not a repair |
| Nightly E2E run 35066774844 | Required-secret setup failed before browser tests; later artifact-copy failure followed |

The review gate waits up to 20 minutes for required checks, then makes model calls.
Its old four calls were sequential. The new two-reviewer stage overlaps, but planning
and final judgment are still sequential. The sampled PR audit jobs were skipped;
their CI time must not be blamed on Opus calls that did not run.

Next CI work, not implemented here: determine whether lint dependencies are truly
needed by test jobs; profile slow suites and repeated dependency installation;
investigate actual schema failures and configure missing E2E credentials. Preserve
coverage and fail-closed checks. This branch does not bypass those failures.

## Measuring an evolving website

Group completed work by task type and risk. Record task/brief/source revision,
model/effort, calls, input/cache-read/cache-write/output, time, retries and rework.
Compare distributions and coordination overhead within those groups, not daily
totals or token cost per line of code. Include failed work. No identical future
website is required, but these comparisons cannot establish a perfect causal
savings percentage. Do not spend on duplicate benchmark runs by default.

The CI artifact records actual response usage, role and latency plus a fingerprint
of the review bundle and prompt/model configuration. It contains no prompts or
secrets. API cost estimates use the 2026-09-16 standard rate card; unknown usage or
prices remain null. They are not subscription charges. Cache breakpoints do not
guarantee a hit: two cold parallel Sonnet calls may each write cache. The original
bundle is stable across calls and preserved when the planner resumes.

## Corrections and remaining limitations

The previous report's 139 numbered files included three files under decisions/evidence.
The main-based index has 136 top-level ADRs. The original page-finalization worktree
also has an unrelated new ADR 0142; it was not imported into this branch. Regenerate
the index after integrating that work. Nineteen ADRs have parseable frontmatter;
0016 has malformed YAML links, so the generator warns and reads its legacy header.
No unrelated ADR content was silently repaired or promoted to locked.

There is no measured live savings result yet and no full end-to-end GitHub workflow
run. The SDK shape was checked against current official documentation, not tested
with a paid API call. The CI model-only reviewers receive a diff/policy/check-state
bundle, not arbitrary source-browsing tools; missing pivotal context must block.
Local Claude reviewers can inspect source through their scoped tools. This remains
an advisory workflow under inspected branch protection, not a new hard required gate.

Offline validation: existing 50 gate self-test invariants; 16 new unit tests for
routing/parallelism/cache payloads/telemetry/unknown costs/preflight and index generation;
YAML parsing, index freshness and whitespace checks. No production writes or paid calls.
The refreshed index is 29,035 bytes versus the 299,122-byte decisions log; both are
still search-and-excerpt targets. actionlint was unavailable. A broad status read
in the original worktree was interrupted after stalling; its relevant files were
read directly, and no original CI/security edits were changed.

Integration requires human review because the branch edits gate-owned files.
Preserve pre-existing ci.yml and gate changes in page-finalization; do not replace
those files wholesale. Regenerate the decision index after reconciliation. Rollback
is an inverse patch for these scoped files; no data or schema changes are involved.

Sources: [pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[subagents](https://code.claude.com/docs/en/subagents),
[sample CI run](https://github.com/aldemirkonuk/RestaurantAIAutomation/actions/runs/34835900517),
[schema run](https://github.com/aldemirkonuk/RestaurantAIAutomation/actions/runs/34838564614),
[nightly E2E](https://github.com/aldemirkonuk/RestaurantAIAutomation/actions/runs/35066774844).
