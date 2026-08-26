# 0029 — P3 plan of record: grade before you scale, and parallel only where nothing is assumed

- **Status:** Locked
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** P3, milestone, plan of record, parallelism, doneability, outcome_basis, mobile parity, Ask AI, NF-B, OD-04, OD-59, gating
- **Links:** [[0018-p2-plan-of-record]], [[0017-doneability-verdicts-are-sidecar-claims]], [[0019-p2-build-scope]], `.planning/04-specs/OD-59-VERDICT-CENSUS.md`, `.planning/00-index/PLAN.md`, OD-04, OD-05, OD-07, OD-59

## Context

P2 closed 2026-08-25 through live deploy: all five stages done, both held items
resolved 2026-08-26 (four page retirements, Gmail push enforcement). `ROADMAP.md`
carried five **P3 candidates** explicitly marked *"uncommitted, founder picks
after P2"* — mobile parity, NF-B guests, backend-kitchen expansion, Ask AI, and
the job → model registry (OD-04).

The founder's direction, 2026-08-26 verbatim: *"all of them in parallel only if
you approve, create a right order, unlock tasks as moving on. Create a
bulletproof plan."*

That phrasing asks for a judgment, not a schedule. The judgment is below, and it
is **no — not all five**, for a reason that is not about capacity.

### The thing that decides the shape of this milestone

Every stage after the first multiplies model calls. The instrument that would
tell us whether more calls means more *done* currently cannot:

| Runtime | Measured 2026-08-26 |
|---|---|
| Gateway (TS) | **7** task types emit; **1** carries a real verdict — `document_extraction` on `reconciliation_v1` (`document-extractor.service.ts:169`). The emitter hard-codes `outcome_basis: "call_level_v0"` for every call (`model-client.service.ts:387`) |
| Python | **12 sites** upgraded to `parse_v1` by OD-75; the rest still call level |

`call_level_v0` means *"the HTTP request returned 200."* Six of the gateway's
seven task types therefore report success for a call that produced garbage, and
`nf_a_cost_per_completed_task` counts `tasks` as a bare `count(*)`
(`20260824153600_nf_a_readout.sql:103-108`) — it has always reported cost per
*call*. Two of the P3 candidates make claims that are **meaningless** on that
data: a model roster chosen on cost-per-call, when a cheaper model that retries
more moves cost-per-call down and cost-per-completed-task up, is the exact
inversion [[inference-cost-loops]] carries its *"both numbers or neither"* rule
to prevent.

This is the repo's signature defect stated at milestone scale: **machinery that
structurally cannot report failure.** Shipping two more AI surfaces on top of it
would not be parallelism; it would be volume.

## Options considered

1. **All five in parallel.** Maximum throughput on paper. In practice two of the
   five are blocked on *decisions the founder has not made* rather than on
   effort — NF-B guests has no caller because which guest surface it serves is
   undecided (OD-05 voice-agent audience, OD-07 Beli build-vs-partner), and
   OD-04 is *decidable but unanswered* because the grading volume does not
   exist. Running them "in parallel" means an agent picks the guest product and
   the routing basis by default. Rejected: parallelism that converts an unmade
   decision into an assumption is not speed.
2. **Strict sequence, one stage at a time.** Safest, and wrong for a different
   reason: it stalls two lanes — mobile and kitchen expansion — that do not
   depend on grading to be correct, behind one that they do not need.
3. **Gate the AI lanes only** *(chosen)*. One hard gate in front of the work
   whose correctness depends on grading; everything provably independent of it
   runs alongside from day one.
4. **Do nothing / carry P2 forward.** Costs the milestone: P2's scope is
   finished and deployed, so "carry on" has no content.

## Decision

### §1 — Shape

**Current milestone: `P3 — Grade, then scale`.** One gate, two lanes running
alongside it from day one, two stages behind it, one candidate explicitly held.

```
        P3.0  Doneability coverage          ← the gate
        (every gateway task type carries a basis, or is named human-rubric)
              │
   ┌──────────┼─────────────────────────────┐
   │          │ unlocks                     │
   │          ▼                             ▼
   │    P3.C  Ask AI                  P3.D  Job → model registry (OD-04)
   │    (allowlisted actions,               (needs P3.0 + traffic volume)
   │     human confirm)
   │
   └─ run alongside, gated on nothing:
        P3.A  Mobile parity
        P3.B  Backend-kitchen expansion (beverages first)

   HELD, not scheduled:  NF-B guests — blocked on OD-05 / OD-07
```

### §2 — The stages

**P3.0 — Doneability coverage *(gate)*.** Not open research: the ranked census
already exists at `.planning/04-specs/OD-59-VERDICT-CENSUS.md` §4, which lists
18 task types cheapest-verdict-first with the existing check cited at
`file:line` for each. Rows 2–9 are all **synchronous** and **Trivial or Low** —
the graders are already running, the results simply never reach the footprint.
Scope: every task type that emits either carries a basis better than
`call_level_v0`, or appears in a named exemption list for genuine human-rubric
work (census §3.11). *Two are already graded better than they are stamped* —
correcting the string costs nothing and stops a later re-grade redoing the work.

**P3.A — Mobile parity *(alongside)*.** Bring `apps/mobile` to the P2-approved
web feature set. Founder call 2026-08-26: **mobile now, as-is**, without waiting
on OD-106. The cost is stated rather than hidden — whatever design foundation is
eventually chosen must reconcile two surfaces instead of one. Mitigated, not
eliminated, by the `archetype:` map: it was written web-first *mobile-aware*, so
the page→archetype mapping ports even when the visual language changes.

**P3.B — Backend-kitchen expansion, beverages first *(alongside)*.** FUTURES
staging: full beverages → bakery → rest of kitchen, wine remaining the
extraction quality bar. It is placed alongside rather than behind P3.0
deliberately: extraction with an oracle is the *best* second source of graded
task types, so this lane feeds the gate instead of competing with it (census
rows 12 and 14).

**P3.C — Ask AI *(behind P3.0)*.** Allowlisted action creation with human
confirm (FUTURES §8). Behind the gate because it is the first feature that
*creates actions* rather than text, and an action-creating agent whose success
signal is "HTTP 200" is this repo's signature defect promoted to product
surface. The human confirm is a guardrail on individual actions; it is not a
substitute for knowing whether the thing works.

**P3.D — Job → model registry (OD-04) *(behind P3.0 + volume)*.** The query
already runs; the evidence does not exist yet. Needs P3.0's verdicts and enough
traffic from P3.B/P3.C for the numbers to mean something.

### §3 — Held, and why that is not the same as deferred

**NF-B guests stays out of P3.** The slice is real and finished:
`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql` is 564
lines creating `guests`, `guest_identifiers` and `guest_check_links`, with two CI
guards (`check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh`) and
an eval already standing over it. Application call sites, measured 2026-08-26:
**zero** — the only repository reference outside migrations and scripts is a
feature-flag registry entry.

It has no caller because *which guest surface it serves* is undecided — OD-05
(voice-agent audience: guest / staff / owner) and OD-07 (Beli: build
independently or partner). Founder call 2026-08-26: **leave it held.** Wiring a
caller now would mean an agent choosing the guest product. This ADR records it
as **blocked on a decision, not queued behind work**, so nothing later mistakes
the silence for backlog.

### §4 — Carried alongside, not staged

Live defects do not wait behind a milestone. Outside the stage structure and
tracked in the register as usual: the Toast cluster (**OD-64** provider-neutral
vs Toast-first, **OD-66** second live depletion path still carrying
`?? "bottle"`, **OD-67** a voided glass returning a whole bottle) and **OD-68**
(`provider_important_dates` absent from production).

### §5 — Exit criteria are claims, not prose

Per [[0018-p2-plan-of-record]]'s finding — *entries with a CI job survived;
prose decayed* — each stage closes on an executable claim in `CLAIMS.jsonl`
under id `ADR-0029`, added **when the stage lands**, not before. A claim that
cannot pass yet is a to-do wearing a guard's clothes.

| Stage | Closes when |
|---|---|
| P3.0 | no emit site stamps `call_level_v0` without an entry in the named human-rubric exemption list, and `nf_a_verdict_coverage` reports > 0 for every non-exempt gateway task type |
| P3.A | the mobile app renders the P2-approved feature set, verified on a simulator, not asserted |
| P3.B | beverage extraction runs on the same graded basis as wine, with the verdict reaching the footprint |
| P3.C | no Ask AI action can execute without a recorded human confirm — a guard, not a code-review habit |
| P3.D | the roster choice cites `nf_a_cost_per_verified_task`, and the loop refuses to close on cost-per-call alone |

### §6 — How this plan fails

Named now so it is recognisable later:

1. **P3.0 is declared done on the cheap rows.** Census rows 2–9 are trivial; 12–16
   are the ones with real domain truth. Stopping at trivial produces a coverage
   number that looks like grading and is still mostly shape-checking.
2. **P3.A and P3.B drift into each other's review queue.** They are parallel
   because they share nothing — `apps/mobile` and the extraction/dataset tree. If
   a change needs both, it is not one of these two lanes.
3. **The gate is quietly walked around** by starting P3.C "just to scaffold." The
   gate exists precisely because the scaffolding is what accumulates calls.
4. **NF-B gets wired "minimally" by someone being helpful.** §3 is the record
   that this was decided, not overlooked.

## Consequences

- `ROADMAP.md` gains a **Now — P3** section; P2 moves to Done. `STATE.md` and
  `00-index/AGENDA.md` follow the same milestone name.
- Two of the five ROADMAP P3 candidates are scheduled, two are gated behind
  P3.0, one is held. The candidate list stops being a menu.
- `00-index/PLAN.md`'s Push 4 (NF-B) is superseded by §3 of this ADR: it is not
  next, and the reason is a decision rather than an ordering.
- OD-59 is closed and stays closed; **P3.0 is coverage growth, not a re-opening**
  of the definition question that ADR 0017 answered.
- **Found while writing this plan, and fixed here:** the design-foundation fork
  had been circulating as **OD-79** in 58 references across 52 files — but OD-79
  is the *resolved* email-verification decision ([0023](0023-email-verification-is-enforced.md)),
  so every one of them named a different, closed decision, and the fork itself had
  no register row. Filed as **OD-106** and repointed. `check_citation_pairing.py`
  could not have caught it: [ADR 0025](0025-citations-must-disagree-loudly.md) §6
  governs citations carrying an id *and* a `file:line`, and a bare `(OD-79)` in
  frontmatter is not one. `scripts/check_od_ids_exist.py` now blocks the
  *names-nothing* half in CI; the *names-the-wrong-thing* half is only caught by
  filing the row first, which is when a collision surfaces. Stated as a limit in
  the guard's own docstring rather than papered over.

## Rejected alternatives

- **All five in parallel** — rejected in Options §1. Two of the five would be
  built on assumptions the founder has not made.
- **Strict single-file sequence** — rejected in Options §2. Stalls two provably
  independent lanes.
- **OD-106 (design foundation) before mobile** — put to the founder 2026-08-26
  and rejected by him: mobile ships as-is. The cost (reconciling two surfaces
  later) is recorded in §2 rather than argued away.
- **Wiring NF-B a minimal internal caller** — offered and rejected: it proves the
  slice works at the price of building the wrong shape, and the shape is exactly
  what OD-05/OD-07 decide.
- **Making P3.0 a hard gate on everything** — rejected by the founder in favour
  of gating the AI lanes only. Mobile and kitchen expansion are correct or
  incorrect on their own terms; grading does not change that.
