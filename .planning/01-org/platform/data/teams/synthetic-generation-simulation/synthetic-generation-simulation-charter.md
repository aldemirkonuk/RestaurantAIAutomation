---
type: charter
division: platform
department: data
team: synthetic-generation-simulation
status: exists
metrics: [synthetic.backtest_fidelity_gap, synthetic.degrade_profile_coverage, synthetic.namespace_leak_count, synthetic.archetype_representativeness]
updated: 2026-08-24
links: ["[[synthetic-generation-simulation-premortem]]", "[[synthetic-generation-simulation-agenda-full]]", "[[synthetic-generation-simulation-agenda-board]]", "[[synthetic-generation-simulation-directive]]", "[[synthetic-generation-simulation-loops]]", "[[synthetic-generation-simulation-schedule]]", "[[data-charter]]", "[[annotation-ground-truth-charter]]", "[[corpora-enrichment-charter]]", "[[pos-operational-telemetry-ingest-charter]]", "[[substrate-quality-coverage-charter]]", "[[state-integrity-invariants-charter]]", "[[technology]]", "[[README]]"]
---

# Synthetic Generation & Simulation — Charter

Parent: **Data** ([[data-charter]]), division **Platform**. Team §5.3 in
`.planning/foundation/teams/technology.md:621`.

## Mandate

This team owns data that is **true by construction**: synthetic restaurants, invoices,
menus, personas, and simulated POS traffic — **each generated alongside its own ground
truth** (`technology.md:623-625`). It writes the answer key first and the document second.

## Why it is distinct from its siblings

The truth guarantee is categorically different. [[corpora-enrichment-charter]] *guesses*,
[[annotation-ground-truth-charter]] *verifies by hand*, this team **knows — because it wrote
the answer key first** (`technology.md:627-631`).

That gives it two properties nothing else in the department has, and they are the same
property seen from two sides:

- It is **the only source that can produce unlimited eval data**.
- It is **the only source that can be systematically unrepresentative** — and be so while
  every internal number looks excellent, because the answer key and the document were
  written by the same process.

## Boundaries

Owns outright:

- **Entity generation** — `scripts/synth/`: `recipes.py`, `oracle.py`, `auth_personas.py`,
  `seed.py`, `snapshots.py`, `write_set.py`, `teardown.py`, `ids.py` (+ `cli.py`, `__main__.py`).
- **Document generation and its answer key** — `scripts/docgen/`: `compose.py`,
  `degrade.py` (realistic scan artefacts), **`truth.py` (the answer key)**, `backtest.py`,
  `houses.py`, `render.py`, `errors.py`, `wineops_doc.py`, `templates/`, `fixtures/`.
- **POS traffic simulation** — `scripts/simulate/`: `bridge.py`, `payloads.py`,
  `detection.py`, `mappings.py`, `service.py`.
- **The published sim pack** — `datasets/sim/{archetypes,documents,menus}` +
  `manifest.json` (versioned and sha256-pinned per file: `pack_version 1.0.0`,
  `updated_at 2026-07-27`).
- **End-to-end harnesses** — `scripts/e2e_crawl_harness.py`, `scripts/e2e_restaurants.json`.
- **The product-side counterpart** — `apps/api-gateway/src/simpos/` (11 routes) and
  `supabase/migrations/20260805134000_simpos_schema.sql`.
- **The namespace guard** — decision **C31**: sim restaurants' slugs must start with
  `sim-`, cited in code at `services/agent-orchestrator/agents/drift_agent.py:4-6`. This
  team owns that the guard holds. It is the only thing standing between "unlimited free
  test data" and "fabricated rows in a customer's account".

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Being the oracle for real-world accuracy claims | [[annotation-ground-truth-charter]] | Our labels are *constructed*; theirs are *observed*. Capped share in any real-accuracy set ([[annotation-ground-truth-premortem]] M5) |
| Facts about real bottles, producers, restaurants | [[corpora-enrichment-charter]] | We invent; they research |
| Real POS traffic and its resolution | [[pos-operational-telemetry-ingest-charter]] | Simulated checks are not observed checks, ever |
| Grading data rows for publication | [[substrate-quality-coverage-charter]] | Author ≠ auditor |
| Runtime invariants and drift gates in production | [[state-integrity-invariants-charter]] *(SRE)* | We generate the fixtures; they run the gates |
| Model training on synthetic sets | Research & Math *(Intelligence)* | (`technology.md:613-616`) |
| Load and performance testing | [[runtime-resilience-charter]] *(SRE)* | Simulation here is about *correctness of content*, not throughput |

## Metrics it moves

**Primary: `synthetic.backtest_fidelity_gap`** — agreement between model performance on
synthetic documents and on the real annotated gold set (`technology.md:645-648`).
*Synthetic data whose scores do not track reality is worse than none, because it
manufactures confidence.* Measured by `scripts/docgen/backtest.py`.

The metric has a hard dependency worth stating on the charter rather than burying: **it
cannot be computed without a live gold set from [[annotation-ground-truth-charter]]**. A
fidelity number computed against a stale oracle is not a weak signal, it is a wrong one.

Secondary:

- `synthetic.degrade_profile_coverage` — how many *real* failure modes `degrade.py` models,
  measured against real degraded documents, not against a list we wrote
  ([[synthetic-generation-simulation-premortem]] M1).
- `synthetic.namespace_leak_count` — **target zero, permanently**. Any sim-namespace row
  reachable from a non-sim tenant, or any non-`sim-` slug in a sim write set.
- `synthetic.archetype_representativeness` — distance between the archetype mix in
  `datasets/sim/archetypes` and the real customer mix.

**Neural-footprint tie.** Synthetic personas (`scripts/synth/auth_personas.py`) are the only
way to exercise `nf_b.*` guest-signal paths before there are enough real guests. That is
genuinely useful and genuinely dangerous: a personalization model tuned on invented
preference distributions will look excellent and generalize to nobody. Synthetic NF-B events
must carry `subject_type` provenance ([[README]] §4.4) and never be pooled with real ones.

## Evidence today

**EXISTS — and unusually complete** (`technology.md:633-643`), re-verified 2026-08-24. This
is the most built-out team in the department relative to its mandate.

- `scripts/synth/` — 9 modules present, including `oracle.py` and `write_set.py`
- `scripts/docgen/` — 11 modules present, including `truth.py`, `degrade.py`, `backtest.py`
- `scripts/simulate/` — 7 modules present
- `datasets/sim/` — `archetypes/`, `documents/`, `menus/`, `manifest.json`
  (sha256-pinned per file, `pack_version 1.0.0`)
- `apps/api-gateway/src/simpos/` — controller, module, service, service spec
- `supabase/migrations/20260805134000_simpos_schema.sql`
- Namespace guard cited in production code: `agents/drift_agent.py:4-6` (decision C31)
- E2E: `scripts/e2e_crawl_harness.py`, `scripts/e2e_restaurants.json`
- Plan: `.planning/SYNTHETIC_DATA_AND_DOCS_PLAN.md`

**The one thing missing is the thing that matters most:** there is **no recorded fidelity
baseline**. `backtest.py` exists; a published gap between synthetic and real scores does not.
Until that number exists, every claim this team's output supports is unfalsifiable — which is
a stronger statement than "unverified", and is why it is the first item on
[[synthetic-generation-simulation-agenda-full]].
