# 0035 — Wave-2 seam reconciliation: one owner per question, and the roster is 76

- **Status:** Locked — the founder answered each fork in-session (2026-08-27, via
  AskUserQuestion), same session that locked ADR 0034.
- **Date:** 2026-08-27
- **Decider:** Aldemir (founder) — every call below was picked or its criteria named in-session
- **Keywords:** seams, double-ownership, nf-a-coverage, substrate-report, fleet-census, cost-per-task, OD-29, nf-b-erasability, pos-bridge, allowlist, backtests, 76-teams
- **Links:** [[0034-agent-stack-artifact]], `foundation/GENERATION_BRIEF.md` §7.4, [[0029-p3-plan-of-record]], [[0007-org-structure]]

## Context

Wave 2 (ADR 0034) put an agent card on all 100 units, and declaring `consumes`/`emits`
explicitly surfaced seven places where two units owned one job, one metric, or one
number — recorded in `GENERATION_BRIEF.md` §7.4 and routed here rather than resolved
by any unit doc. It also confirmed the vault holds 76 teams against the locked
75-team prose. The founder took all of these in one sitting; recording them as one
reconciliation set follows the ADR 0028/0032 precedent for batched same-shape calls.

## Decisions (options per item were presented in-session; the unpicked option is noted)

1. **`nf-a-coverage-report` — split by question.** Applied AI's `aio-orchestrator`
   owns the name and the verdict-coverage question; observability's job is renamed
   `nf-emission-liveness-report` and answers whether each NF-A field emits at all.
   *(Rejected: either side owning both questions — it re-creates the seam one level up.)*
2. **Daily substrate report — the team runs it, the department consumes.**
   `substrate-progress-report` (substrate-quality-coverage) is the sole producer;
   `data-substrate-daily-report` is the department's rollup over it. *(Rejected:
   department-owned production — leaves a team's primary output owned above it.)*
3. **Fleet census — one computer.** `fleet-census-agent` (Agent Fleet) computes the
   four counts; `roster-registrar` (People & Agent Ops) consumes them and publishes
   only the HR overlay, `roster.headcount_claim_variance` (declared rosters in
   agent-stack docs vs the computed census). *(Rejected: deliberate double-entry —
   cadence skew manufactures variance; and HR-owned counting — puts a disk census in
   Corporate.)*
4. **`nf_a.cost_per_task` — the most-covering unit produces, the other fetches**
   (the founder's own phrasing). `aio-model-routing` owns the measurement at the
   model boundary; `fin-inference-cost` consumes it for unit economics — both
   charters' non-goal lines, now binding. The measured ledger-grain divergence
   (`api_spend` lacks `task_type`; the NF row carries it) is filed as evidence under
   OD-29, fix direction extend-`api_spend`, unscheduled. **OD-29's RM-1 half stays
   open** — this settles only the Finance edge.
5. **NF-B research-store erasability — privacy-engineering owns the loop.** Owner
   set in `privacy-engineering-loops` and `loops.json` (was `UNASSIGNED — escalated`).
   NF-B stays HELD (ADR 0029); the *mechanism* fork (crypto-shredding vs subject
   partitions vs aggregate-only retention) stays open and is that team's to bring
   back with costs.
6. **POS-bridge weekly throughput — fixed.** The read now excludes the 66
   `P3PROOF-*` proof rows alongside SimPOS `generic_webhook`
   (`POS-BRIDGE-AUDIT.md:622-628`); as written it read 66 and meant 0.
7. **AI-surface-security's allowlist line — narrowed.** The charter now claims
   *allowlist coverage audit*; enforcement is action-safety-the-human-gate's.
   Security classifies, the gate gates.
8. **The roster is 76 teams / 100 units.** `backtests` (Research & Math), chartered
   after the team-layer docs froze at RM-1/2/3 and trigger-gated, is accepted;
   ORG_STRUCTURE §2 carries the dated correction, `teams/intelligence.md`'s
   `team_count: 9` is superseded by that note. *(Rejected: filing the team as an
   open fork, and retiring it — its own entry trigger now reads as met.)*

## Consequences

- Every §7.4 seam now has exactly one owner per question; the affected agent-stack,
  schedule, loops, and charter lines were amended the same day with `ADR 0035` cites,
  so no doc still states the conflict as open.
- Loops YAML ids/owners were left untouched except the one UNASSIGNED owner (synced
  in both the md and `loops.json`); the substrate producer/consumer split is recorded
  as prose pending a loops regeneration — regenerating `loops.json` picks it up then.
- Revisit when: OD-29's RM-1 half resolves (item 4 may then fold into it); or
  backtests' entry trigger is confirmed and the team staffs (item 8's note asks the
  team to confirm the `STATE.md:98-105` reading).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-27 | Founder (AskUserQuestion, in-session) | All eight items picked; item 4 by stated criterion ("the most covering department owns it, the other fetches") |
| 2026-08-27 | — | Created |
