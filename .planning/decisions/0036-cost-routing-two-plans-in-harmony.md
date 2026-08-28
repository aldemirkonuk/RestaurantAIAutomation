# 0036 — Cost routing runs as two plans in parallel, in harmony (OD-29 closed)

- **Status:** Locked — founder, in-session 2026-08-28 (AskUserQuestion).
- **Date:** 2026-08-28
- **Decider:** Aldemir (founder) — phrasing: *"everything in different detailed plans executed in parallel working in harmony"*
- **Keywords:** od-29, model-routing, research-math, methodology, operations, cost-per-task, wrapper
- **Links:** [[0035-wave2-seam-reconciliation]] (the Finance half), `OPEN-DECISIONS.md` OD-29 row, [[harness-model-routing-agent-stack]], [[model-routing-inference-economics-charter]]

## Context

OD-29 recorded that `aio-model-routing` (Applied AI) carries RM-1 Harness & Model
Routing's (Research & Math) exact mandate *and* its primary metric, NF-A cost per
task. ADR 0035 settled the Finance edge; the RM-1 half — the original conflict —
remained. The proposed interim, "one shared wrapper," has meanwhile become real:
P1 consolidated every gateway model call behind `common/model-client`.

## Options considered

1. **Methodology/operations split** *(chosen — it is the only arrangement in which
   both teams keep distinct detailed plans executed in parallel, which is the
   founder's stated criterion)* — RM-1 owns the methodology: benchmark design,
   what cost-per-task *means*, the rules a substitution study must satisfy.
   `aio-model-routing` owns the operation: the shared wrapper and the production
   routing policy. The same line TECH-F3 draws for evaluation, one seam over, with
   the same escalation: **if the line fails, merge — never duplicate.** The
   concrete failure test transfers too: the same benchmark defined twice, or a
   routing rule shipped that RM-1's methodology cannot account for, twice running.
2. **Merge into `aio-model-routing`** — one owner, but it dissolves the
   independence Research & Math was promised at division-promotion (ADR 0007 note)
   and makes cost measurement self-reported by the team that spends.
3. **Route to Architecture Review first** — defers a fork that has been open since
   2026-08-24 and whose interim already shipped; a findings pass would re-derive
   what P1 already proved.

## Decision

RM-1 and `aio-model-routing` both stand, with **methodology (RM-1) / operation
(aio)** as the line, the P1 wrapper as the shared mechanism, and merge-never-
duplicate as the escalation. OD-29 is resolved in place on its register row.

## Consequences

- Easier: benchmarks get an owner that does not spend; the wrapper gets an owner
  that does not grade itself; both charters' §Non-goals become binding text.
- Harder: two teams must coordinate every substitution study across a division
  boundary — the async contract (agenda questions, NF-A events) is the only path.
- Revisit when the TECH-F3-style failure test fires twice running — then the fix
  is the merge, per this record, not a third owner.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-28 | Founder (AskUserQuestion, in-session) | Locked — criterion stated, option 1 is its unique satisfier |
| 2026-08-28 | — | Created |
