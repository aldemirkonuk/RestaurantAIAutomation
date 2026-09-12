---
type: agent-stack
division: platform
department: data
team: synthetic-generation-simulation
status: designed
updated: 2026-08-27
metrics: [synthetic.backtest_fidelity_gap, synthetic.degrade_profile_coverage, synthetic.namespace_leak_count, synthetic.archetype_representativeness]
links: ["[[synthetic-generation-simulation-charter]]", "[[synthetic-generation-simulation-schedule]]", "[[synthetic-generation-simulation-loops]]", "[[synthetic-generation-simulation-directive]]", "[[synthetic-generation-simulation-premortem]]", "[[0034-agent-stack-artifact]]", "[[data-agent-stack]]", "[[state-integrity-invariants-charter]]", "[[annotation-ground-truth-agent-stack]]", "[[skills-charter]]"]
---

# Synthetic Generation & Simulation — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The most built-out team in the department relative to its mandate, and the one whose card must
> fence off the most. It writes the answer key first: the only source of unlimited eval data
> **and** the only one that can be systematically unrepresentative while every internal number
> looks excellent. Its auditor is external by design.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `synth-forge` | Generate synthetic restaurants, documents and POS traffic **with** their answer key, inside the `sim-` namespace, and hand every verdict about their fidelity to someone else | PARTIAL `scripts/synth/` (9 modules), `scripts/docgen/` (11 incl. `truth.py`), `scripts/simulate/` (7) — the generators exist and produced `datasets/sim/`; the card does not |

## 2. Agent cards

```yaml
agent: synth-forge
unit: synthetic-generation-simulation
triggers:
  - schedule: "weekly — E2E harness run across the synthetic restaurants"   # mirrored in [[synthetic-generation-simulation-schedule]]
  - schedule: "quarterly — archetype re-fit and sim pack integrity (sha256 pins)"
  - topic: eval.fixture_requested            # publisher: NONE (gap — requests arrive as sessions, not events)
consumes:
  - "`datasets/sim/{archetypes,documents,menus}` + `manifest.json` (self-published, sha256-pinned, pack_version 1.0.0)"
  - "the real annotated gold set — publisher: [[annotation-ground-truth-agent-stack|gold-set-steward]]; **stale (`pilot_test_v2.json`), so fidelity computed against it is wrong rather than weak**"
  - "the real customer mix for archetype re-fit — publisher: [[pos-operational-telemetry-ingest-agent-stack|pos-fitness-monitor]] (PARTIAL — sales corpus thin)"
  - "real degraded documents for the degrade catalogue — from `datasets/annotation_inbox/` (publisher: NONE, gap)"
emits:
  - "synthetic entities and documents with `source_guarantee = synthetic` and their `truth.py` answer key — consumers: Research & Math (scanner regression), [[agent-evaluation-gates-charter]] (fixtures)"
  - "sim write sets + teardown references — consumer: [[state-integrity-invariants-charter]], who asserts the namespace daily"
  - "`synthetic.backtest_fidelity_gap` — consumer: [[data-agent-stack|data-l0-rollup]]; **no baseline has ever been published**"
  - nf_a events (task_type: synth_generation)
routing_class: mechanical        # generation from recipes and templates, answer key first — deterministic by construction
quality_bar: "`synthetic.backtest_fidelity_gap` measured by `scripts/docgen/backtest.py` against the REAL gold set — declared, and NONE (gap) today: the script exists, a published gap does not. Namespace integrity is graded externally by [[state-integrity-invariants-charter]], never here"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: synthetic-generation-simulation
escalates_to: "[[data-charter]]"
```

**The card's three hard rules.** (1) Every sim restaurant slug starts with `sim-` (decision C31,
cited in production code at `agents/drift_agent.py:4-6`); the namespace guard is the only thing
between "unlimited free test data" and fabricated rows in a customer's account
([[synthetic-generation-simulation-premortem]] M2). (2) It may **never** promote a synthetic row
into a gold set or an accuracy claim — that path stays inconvenient on purpose
([[annotation-ground-truth-premortem]] M5). (3) It may **never** edit `truth.py` to make a score
improve; the answer key changes only for a stated cause, audited monthly (M5 here).

**Deliberately off this card:** the weekly degrade-catalogue pass. Classifying which *real*
failure modes are worth modelling is judgment-shaped, and a generator that also decides what
reality looks like grades its own imagination — [[synthetic-generation-simulation-premortem]] M1
in one step. It stays a human pass feeding this agent, not a second routing class on it.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `synth-restaurant-seed` | T1 | A test, demo or eval run needs a populated restaurant | Restaurant created with a `sim-` slug, write set recorded by `write_set.py`, teardown reference returned in the same call | `scripts/synth/{recipes,seed,write_set,teardown,ids}.py` built the committed artifacts `datasets/sim/archetypes` and `scripts/e2e_restaurants.json` | NEW |
| `docgen-batch` | T1 | A scanner needs regression or rare-case document volume | Documents emitted **with** their `truth.py` answer key and a degrade profile drawn from the real catalogue; `source_guarantee = synthetic` on every row | `scripts/docgen/{compose,degrade,truth,render,houses}.py` produced `datasets/sim/documents`, pinned per file in `manifest.json` (`pack_version 1.0.0`, `updated_at 2026-07-27`) | NEW |

**Two proposals held back, and the first is this team's headline gap.** `synthetic-backtest`
cites `scripts/docgen/backtest.py`, which [[synthetic-generation-simulation-charter]] records as
*existing and never run to a published baseline* — the tool is real, the procedure has no
instance, and until it does every claim this team's output supports is unfalsifiable rather than
merely unverified. `sim-teardown-verify` has no recorded residue check either; when it is
authored, its **assertion is consumed by [[state-integrity-invariants-charter]]** — this team
writes the check, another unit owns the verdict ([[synthetic-generation-simulation-loops]] loop 3).

**Deliberately never proposed: `promote-synthetic-to-gold`, in any form.** The department's
provenance invariant depends on that path staying inconvenient.

Consumed, owned elsewhere: [[skills-charter]]; the namespace assertion
([[state-integrity-invariants-charter]]); the grade on published rows
([[substrate-quality-coverage-charter]]).

## 4. Memory

- **Procedural** — the two §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: synth_generation`. Needs `context.pack_version`,
  `context.sim_slug` and `context.answer_key_hash` as jsonb keys — the last makes a drifted answer
  key detectable after the fact rather than arguable. Synthetic `nf_b.*` events from
  `auth_personas.py` carry `subject_type` provenance ([[README]] §4.4) and are **never pooled with
  real guest events**: a model tuned on invented preferences looks excellent and generalises to
  nobody.
- **Semantic** — `memory/` beside this file, `synthetic-generation-simulation-MEMORY.md` as
  index. Founding facts: the absent fidelity baseline (the most important thing this team knows
  about itself), each modelled degrade profile with the real document class that justified it,
  and the archetype mix with the date it was last compared to reality. Provenance frontmatter;
  every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the current pack manifest.
  Generated corpora are retrieval targets by manifest key, never preloaded.

**Consolidation** — monthly, mirrored in [[synthetic-generation-simulation-schedule]]'s
`truth.py` change-audit slot: read the month's generation slice; **failures first**, with this
unit's specialisation — every answer-key change is consolidated **by stated cause**, and one whose
cause is "a model disagreed" is a finding against the team, not maintenance (M5). Expire at 90
days; propose skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Loops ([[synthetic-generation-simulation-loops]]: `backtest-fidelity`,
`degrade-profile-catalogue`, `sim-namespace-integrity` — **owner: [[state-integrity-invariants-charter]],
not this team** — `archetype-refit`, `truth-change-audit`), NF-A events, vault PRs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| The fidelity number's input is stale | `backtest.py` needs a live gold set; the newest gold artifact is `pilot_test_v2.json`. A fidelity gap computed against a stale oracle is not a weak signal, it is a wrong one ([[synthetic-generation-simulation-charter]] §Metrics) |
| Archetype re-fit has a thin publisher | The real customer mix comes from a sales corpus [[README]] §1 names as thin, so `synthetic.archetype_representativeness` is measurable only against data that barely exists — M4's mechanism |
| The degrade catalogue's source has no publisher | Real degraded documents arrive in `datasets/annotation_inbox/`, which no unit owns filling (same gap as [[annotation-ground-truth-agent-stack]] §5) |
| `eval.fixture_requested` has no publisher | Fixture requests arrive as sessions, not events; the weekly harness run is the only scheduled floor |

## 6. Evidence today

- **EXISTS — unusually complete.** `scripts/synth/` (9 modules incl. `oracle.py`, `write_set.py`),
  `scripts/docgen/` (11 incl. `truth.py`, `degrade.py`, `backtest.py`), `scripts/simulate/`
  (7 modules), `datasets/sim/{archetypes,documents,menus}` + sha256-pinned `manifest.json`,
  `apps/api-gateway/src/simpos/` (11 routes), `…20260805134000_simpos_schema.sql`,
  `scripts/e2e_crawl_harness.py`, `scripts/e2e_restaurants.json`, C31 at `agents/drift_agent.py:4-6`.
- **NEW — the missing thing that matters most:** no recorded fidelity baseline. That absence is
  why `synthetic-backtest` is held out of §3, and why it is the first item on
  [[synthetic-generation-simulation-agenda-full]].
- **NEW — the card, both skills, and all four memory layers.**
