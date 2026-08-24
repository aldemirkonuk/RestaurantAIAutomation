# 0006 — Neural Footprint: split production and research stores

- **Status:** Locked (architecture); column-level schema open under OD-11
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder)
- **Keywords:** neural-footprint, metrics, telemetry, NF-A, NF-B, NF-C, schema, OLTP, OLAP
- **Links:** [foundation §4](../foundation/README.md), [[0001-mudavym-single-entity]], [[0002-documentation-first-operating-mode]]

## Context

"Neural footprint" was named as the project's metric concept, referencing TRIBE and
Sapient's NeuroAGI. **Verification finding:** TRIBE is Meta's fMRI brain-encoding
foundation model; The Sapient Company is a separate brain-decoding company whose
`/neuroagi` page is client-rendered and returned no fetchable content. No external
source defines "neural footprint" as a metric. **The term is ours to define.**

Three subjects were in scope: agents (NF-A), guests (NF-B), and literal
neuro-decoding (NF-C). The founder prioritized A and B, and separately proposed
*"one for customers and real life, and one for research."*

## Definition adopted

> **Neural footprint** = the durable, structured trace a decision-maker leaves
> behind — enough signal to model *why* it chose what it chose, not merely *what*
> it chose.

Recorded shape for every subject: **stimulus → internal state → choice → outcome.**
This is what makes NF-A and NF-B genuinely the same object rather than two
dashboards sharing a name, and it encodes the mechanism-level reasoning demanded in
vision §11 (reason like chemistry, not like tagging).

## Options considered

1. **One polymorphic table** — every event in one table with `subject_type`.
   Trivial cross-subject queries; sparse rows; needs partial indexes per subject.
2. **Table per track** — separate agent/guest/bio tables. No sparsity; cross-subject
   analysis needs joins; adding NF-C later means new infrastructure.
3. **Shared spine + per-track detail** — normalized; every read a join, every write
   a two-table transaction.
4. **Split by workload, not by subject** — the founder's own proposal, generalized.

## Decision

**Option 4.** The production and research workloads want opposite things, so they get
different stores sharing one event vocabulary:

- **Production store** — polymorphic and *narrow* (option 1's shape). `subject_type`
  (`agent` | `guest` | `bio`), partial indexes per subject, only the columns a live
  decision needs. Serves live personalization and agent routing at low latency.
- **Research store** — append-only, deliberately *wide*, never migrated. New fields
  are added; old rows keep their shape. Queried in slow analytical sweeps for
  training and analysis.

**NF-C is a gated research track**, not a v0 participant — the `subject_type` slot
reserves it so it needs no migration later, and an append-only research log has no
schema to break. Entry trigger must be explicit (e.g. a funded study partner or a
consumer biosignal device with an API).

**Rationale for the split over any single-store option:** forcing both workloads
through one schema means production carries research's width as dead weight while
research is throttled by production's latency budget. The separation is also what
lets research get messy and wide without ever slowing a guest's recommendation.

## Consequences

- Two ingestion paths to build and keep consistent — accepted cost.
- Research can add fields freely without a production migration.
- This is also the **structural answer to "should research be a separate company"**
  ([[0001-mudavym-single-entity]]): the separation belongs in the data model, where
  it is cheap, not in corporate structure, where it is expensive.
- **Open (OD-11):** exact production columns, partial-index strategy per
  `subject_type`, and retention/rollup policy for the research log.
- Revisit if: production latency degrades despite partial indexes, or a third
  workload appears that fits neither store.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Claude | Verified TRIBE ≠ Sapient; found no external definition of "neural footprint" |
| 2026-08-24 | Claude | Argued NF-C should be gated rather than a v0 schema participant |
| 2026-08-24 | Aldemir | Accepted gating; proposed the production/research split |
| 2026-08-24 | Aldemir | Locked the split architecture; column detail deferred to OD-11 |
