# Roadmap — Mudavym

> Rewritten 2026-08-25 under [ADR 0018](decisions/0018-p2-plan-of-record.md); the
> 753-line phase history it replaces is archived verbatim at
> [archive/ROADMAP-pre-P2-20260825.md](archive/ROADMAP-pre-P2-20260825.md).
> Expansion vision stays in [FUTURES.md](FUTURES.md). Where the build is right
> now lives in [STATE.md](STATE.md) — this file is only the order of operations.

The backend-kitchen idea has been the same across v1/v2/v3: an autonomous
restaurant backend so reliable an average operator performs flawlessly. The
versions changed the framing, not the scope. P-milestones are the current
frame; v-numbers reset at publish (ADR 0005).

## Done

| Milestone | What it was | Record |
|---|---|---|
| v1.0 (2026-04-08) | Wine extraction pipeline — Claude Vision + Gemini + YOLO + Haiku, ontology, verification, studio | [archive/v1.0-phases/](archive/) |
| v2.0 (2026-07-28, `gaps_found`) | Agent hardening to Level 4, golden path E2E, deploy | [archive/v2.0-MILESTONE-AUDIT.md](archive/v2.0-MILESTONE-AUDIT.md) |
| Org + register (2026-08-24) | One-entity Mudavym, `.planning` org corpus, ADR log, OPEN-DECISIONS + CI claims | [decisions/](decisions/README.md) |
| P1 (2026-08-25) | Neural Footprint instrumentation: NF-A emitters in both runtimes, readout, doneability verdicts (`nf_verdict`) | ADRs 0006, 0008, 0017; `04-specs/P1-*` |
| P2 (2026-08-25) | Web complete + deploy: spine reset, 47-note page graph, founder-approved build scope, live production verification | ADRs 0018, 0019; `06-pages/` |

## Now — P3: Grade, then scale  ·  [ADR 0029](decisions/0029-p3-plan-of-record.md)

Goal: make the instrument tell the truth about whether AI work *succeeded*, then
scale on top of it — while the two lanes that do not depend on grading run from
day one. One gate, two parallel lanes, two gated stages, one candidate held.

**The gate exists because of a measurement, not a preference:** the gateway emits
**7** task types and exactly **1** carries a real verdict; the other six stamp
`outcome_basis: "call_level_v0"` — *"the HTTP request returned 200"*
(`model-client.service.ts:387`).

- [ ] **P3.0 Doneability coverage** *(gate)* — every emitting task type carries a
      basis better than `call_level_v0`, or is named in the human-rubric exemption
      list. Not open research: `04-specs/OD-59-VERDICT-CENSUS.md` §4 ranks 18 of
      them cheapest-first with each existing check cited at `file:line`
- [ ] **P3.A Mobile parity** *(alongside — gated on nothing)* — `apps/mobile` up to
      the P2-approved web feature set. Founder call: ship as-is, do not wait on
      OD-106; the `archetype:` map was written mobile-aware so it ports
- [ ] **P3.B Backend-kitchen expansion** *(alongside — gated on nothing)* — full
      beverages → bakery → rest of kitchen, wine staying the extraction quality
      bar. Placed alongside deliberately: extraction with an oracle *feeds* P3.0
- [ ] **P3.C Ask AI** *(behind P3.0)* — allowlisted action creation with human
      confirm (FUTURES §8). First feature that creates actions rather than text
- [ ] **P3.D Job → model registry** *(behind P3.0 + traffic)* — OD-04. The query
      already runs; the evidence does not exist yet

**Held, not queued: NF-B guests.** 564 lines of applied migration, three tables,
two CI guards, and **zero** application call sites — because which guest surface
it serves is undecided (OD-05, OD-07). Blocked on a decision, not on work
([ADR 0029](decisions/0029-p3-plan-of-record.md) §3).

**Carried alongside, not staged:** live defects do not wait behind a milestone —
the Toast cluster (OD-64/66/67) and OD-68.

Standing threads through P3 (not gates): decision-register hygiene (every
resolution adds a claim), org loop activation, rebrand strings (~71) once brand
direction lands.

## Later — P4 candidates (uncommitted)

- **NF-B guests** — unblocks the moment OD-05/OD-07 are settled.
- **Design foundation (OD-106)** — one design understanding across surfaces; by P4
  it has two surfaces to reconcile rather than one, which is the accepted cost of
  shipping mobile first.
- **Floor Checker** — still needs a schema decision: `kitchen-ready` is unmodelled
  in `CanonicalCheck`.
- **Pricing** — founder-deferred (OD-23).

---
*Last updated: 2026-08-26 — P2 closed and moved to Done; P3 opened under ADR 0029 (one gate, two parallel lanes, NF-B held).*