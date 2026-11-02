# 0355 — The CI audit gate runs Sonnet, only on PRs marked ready, and skips docs-only PRs

- **Status:** Locked
- **Date:** 2026-11-02
- **Decider:** Aldemir (founder) — "change model to sonnet 5.5, run it only when a PR is marked ready, not on every push; skip PRs that change only docs" (chat, 2026-11-02)
- **Keywords:** pr-audit-gate, ci, cost, anthropic-credits, sonnet, ready_for_review, docs-only
- **Links:** amends [[0090-pr-audit-gate-autonomous-merge]] (CI half) and [[0231-opus-as-much-as-the-work-needs-sonnet-where-it-is-fast-and-direct]] (model choice for the CI path); [[0237-effort-per-task-medium-by-default-high-where-costly]] (effort, unchanged)

## Context

`.github/workflows/pr-audit-gate.yml` ran on `opened, synchronize, reopened, ready_for_review`, so every push to an
open PR started a fresh three-angle audit on `claude-opus-5` at `effort: high` (`scripts/pr_audit_gate.py:83`).
On 2026-11-01..02 it ran 100 times (14 success, 48 failure, 38 cancelled by a newer push), and the founder's
Anthropic credits dropped by about $120 in those two days. Cancelled runs still paid for any angle already in flight.

## Options considered

1. **Keep Opus, keep every push** — strongest review; the cost above, repeated every busy day.
2. **Sonnet, every push** — cheaper per run, but still pays for every intermediate commit nobody intends to merge.
3. **Sonnet, only on `ready_for_review`, docs-only skipped** — one audit per PR at the moment the author says it is done; re-audit is explicit (draft → ready). Chosen.
4. **Turn the CI gate off** — zero cost, but loses the backstop ADR 0090 exists for.

## Decision

The CI gate calls `claude-sonnet-5-5`, triggers only on `pull_request_target: ready_for_review`, and makes no API call
when every changed path is plain documentation (`*.md`, `docs/`, `.planning/`) — except `CLAUDE.md`, `AGENTS.md`,
`SKILL.md`, anything under `.claude/` or `.github/`, and `.planning/decisions/`, which instruct agents or bind
decisions and are still audited.

## Consequences

- Open PRs as drafts; mark ready once to audit. To re-audit after more pushes, convert to draft and mark ready again.
  A PR opened directly as ready fires `opened`, which no longer triggers — mark it draft then ready, or it is never audited.
- A docs-only PR gets a green job with a notice, not a PASS: the gate does not merge it; the founder merges by hand.
- The local Claude Code three-role audit (pr-audit-gate skill, Opus planner) is unchanged — this ADR is the CI path only.
- Revisit if a merged Sonnet-PASS PR ships a defect Opus would plausibly have caught, or if docs-only PRs are found
  carrying instructions outside the excluded paths.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-11-02 | — | Created on the founder's instruction |
