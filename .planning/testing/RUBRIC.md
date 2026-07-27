# Testing Campaign Rubric (T0–T4)

**Requirements:** TFND-02 · Decisions D-12..D-16  
**Owners:** Testing Campaign Phases 36–43  
**Related:** [FUNCTIONALITY-REGISTRY.md](./FUNCTIONALITY-REGISTRY.md) · (future) [TESTING-SCORECARD.md](./TESTING-SCORECARD.md) · (future) [EXISTING-TEST-INVENTORY.md](./EXISTING-TEST-INVENTORY.md)

## Purpose

This file is the scoring contract for the Testing Campaign (Phases 36–43). Every functionality-group score on the scorecard must be justified against these T0–T4 definitions and evidence standards. Later phases promote scores only by citing inventory paths and CI job names — never by file-count alone. Use this document as the link target whenever asking “how tested is X?” at the maturity layer (registry answers *which group*; this rubric answers *how mature*).

## T0–T4 definitions

Locked strings (D-12..D-16 / ROADMAP Phase 36 success criterion #2):

- **T0:** untested
- **T1:** smoke (happy path runs)
- **T2:** contract (happy + key errors + assertions on outputs)
- **T3:** resilient (idempotency / concurrency / failure modes)
- **T4:** ground-truth verified (asserted against simulator oracle or golden dataset)

Do not rename T-levels. Do not invent intermediate maturity labels for scorecard rows (provisional `T1?` is allowed only as a scorecard baseline marker when `passes?=unknown` — see Evidence standards).

## Agent Level mirror table

Explanatory analogy to agent maturity vocabulary in `.planning/PROJECT.md` (Level 0–4). **Agent Level ≠ automatic T-level.**

| Test maturity | Meaning | Agent Level analogue |
|---------------|---------|----------------------|
| T0 | Untested | Level 0 — prototype / absent proof |
| T1 | Smoke — happy path runs | Level 1 — basic path works |
| T2 | Contract — happy + key errors + output assertions | Level 2 — behavioral correctness |
| T3 | Resilient — idempotency / concurrency / failure modes | Level 3–4 infra guarantees (BaseAgent Level 3 patterns: circuit breaker, retry, backpressure, metrics, health; Level 4 resilient target) |
| T4 | Ground-truth / golden-set verified | Beyond agent Level — Phase 37+ simulator oracle or Phase 42 golden datasets |

## Evidence standards

- **Promotion requires citing** inventory paths **and** CI job names (`test-typescript`, `test-python`, `test-e2e`, `e2e-prod`).
- **Never promote on file-count alone** — presence of `*.spec.ts` / `test_*.py` / Playwright files is not maturity.
- **T1 baseline rules live in the scorecard** — provisional `T1?` when inventory `passes?=unknown`. Do **not** award clean T1 from file existence alone.
- **Do not promote past T1** in later phases until inventory `passes?=yes` or an explicit **waiver** is recorded in Gaps (C3).
- **Agent Level ≠ automatic T-level** — the Level mirror is explanatory only; a holistic group score still needs multi-tier evidence for T2+.
- **T4** requires a simulator oracle (Phase 37+) or golden datasets (Phase 42) — **not reachable in Phase 36 baselines**.

## How to promote a score

1. Update **EXISTING-TEST-INVENTORY** evidence for the group (paths, `runs?`, `passes?`, CI job membership, notes).
2. Apply **this rubric** — confirm the claimed T-level matches the locked definition and evidence standards above.
3. Edit the **TESTING-SCORECARD** row for that group: set Score, Evidence links, Gaps, and the update date.
4. Link the **owning next phase** (e.g. Phase 39–43) that owns residual Gaps or the next promotion target.
