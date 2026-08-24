---
type: agenda-board
division: platform
department: data
team: synthetic-generation-simulation
status: provisional
metrics: [synthetic.backtest_fidelity_gap, synthetic.degrade_profile_coverage, synthetic.namespace_leak_count, synthetic.archetype_representativeness]
updated: 2026-08-24
links: ["[[synthetic-generation-simulation-charter]]", "[[synthetic-generation-simulation-premortem]]", "[[synthetic-generation-simulation-agenda-full]]", "[[synthetic-generation-simulation-loops]]", "[[synthetic-generation-simulation-schedule]]", "[[data-agenda-board]]"]
---

# Synthetic Generation & Simulation — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Artifact, status AS Status, updated AS Updated
FROM "01-org"
WHERE team = this.team
SORT type ASC
```

## The oracle this team is graded against

```dataview
TABLE WITHOUT ID
  file.link AS Unit, status AS Status, updated AS Updated
FROM "01-org"
WHERE team = "annotation-ground-truth"
SORT type ASC
```

## Stale check — 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
```

## Fidelity — the primary metric

- [ ] `synthetic.backtest_fidelity_gap` — **no baseline has ever been taken** ← item #1
- [ ] `scripts/docgen/backtest.py` exists and has not been run against the real gold set
- [ ] Acceptable-gap policy — not set ([[synthetic-generation-simulation-agenda-full]] Q1)
- [ ] Hard dependency: needs a **fresh** gold set from [[annotation-ground-truth-charter]]

## Degrade realism

- [ ] `synthetic.degrade_profile_coverage` — unmeasured
- [ ] Degrade profiles currently imagined, not derived from `datasets/annotation_inbox/`
- [ ] Known-unmodelled classes: specular blowout · occlusion (thumb) · extreme perspective · fold-loss · night-mode

## Namespace integrity — the one with an external victim

- [ ] `synthetic.namespace_leak_count` — **target zero, permanently**; unmeasured
- [ ] Decision C31 `sim-` prefix — enforced in agent code (`drift_agent.py:4-6`), not at write time
- [ ] Post-`teardown.py` orphan assertion — does not exist
- [ ] Fleet metrics filtering `sim-` explicitly — unverified
- [ ] External auditor ([[state-integrity-invariants-charter]]) — not yet engaged

## Representativeness

- [ ] `synthetic.archetype_representativeness` — unmeasured
- [ ] Sim pack: `pack_version 1.0.0`, `updated_at 2026-07-27`, sha256-pinned per file
- [ ] Archetypes never re-fitted against real customer menus

## Answer-key integrity

- [ ] `truth.py` change protocol — not in force; "model disagreed" must be a forbidden cause
- [ ] Synthetic-share cap for real-accuracy eval sets — **not set**
- [ ] Synthetic `nf_b.*` persona events — no `subject_type` provenance yet

## Built and healthy

- [x] `scripts/synth/` 9 modules · `scripts/docgen/` 11 · `scripts/simulate/` 7
- [x] `datasets/sim/` pack versioned and sha256-pinned
- [x] `apps/api-gateway/src/simpos/` + `20260805134000_simpos_schema.sql`
- [x] `scripts/e2e_crawl_harness.py`, `scripts/e2e_restaurants.json`
