---
type: agent-stack
division: platform
department: data
status: designed
updated: 2026-08-27
metrics: [corpora.demand_weighted_coverage, annotation.gold_set_freshness_days, synthetic.backtest_fidelity_gap, pos.line_resolution_rate, substrate.quarantine_rate, nf_a.task_success_rate, nf_a.cost_per_task]
links: ["[[data-charter]]", "[[data-schedule]]", "[[data-loops]]", "[[data-directive]]", "[[data-premortem]]", "[[data-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[substrate-quality-coverage-agent-stack]]", "[[corpora-enrichment-agent-stack]]", "[[annotation-ground-truth-agent-stack]]", "[[synthetic-generation-simulation-agent-stack]]", "[[pos-operational-telemetry-ingest-agent-stack]]"]
---

# Data — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The department-level card orchestrates **the unit itself**, never the teams' work: four
> producers with four incompatible truth guarantees, one auditor, and a standing refusal to
> average them. Mechanisms are referenced, not restated — harness → [[harness-runtime-charter]]
> (**OD-03 open**), model choice → [[model-routing-inference-economics-charter]], the mutation
> gate → [[action-safety-the-human-gate-charter]], skill envelope → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `data-l0-rollup` | Publish the department's metric **set** — five owners, five denominators, never one L0 number — and escalate any team loop that breaches its `close_time` or any row whose provenance is unstated | NEW |

One row deliberately. Each of the four truth guarantees has its own producing team and its own
agent; a department agent that *produced* anything would be the author≠auditor failure this
department is built around ([[data-charter]] §Boundaries).

## 2. Agent cards

```yaml
agent: data-l0-rollup
unit: data
triggers:
  - schedule: "daily, before the substrate report lands"   # mirrored in [[data-schedule]]
  - schedule: "monthly agenda sync — full vs. board drift across all 5 teams"
  - topic: loop.close_time_breached                        # publisher: NONE (gap — loops.json is a static census)
consumes:
  - the five team agenda-boards (Dataview output) — publishers: the five team agents in §5
  - 'nf_a events sliced by this department''s task types (ADR 0006/0008) — publisher: [[corpora-enrichment-agent-stack|enrichment-runner]] today, the rest on paper'
  - "[[data-loops]] rows: data-substrate-daily-report, provenance-integrity-audit, threshold-change-review"
emits:
  - "[[data-agenda-board]] rollup — the metric SET with named denominators ([[data-charter]] §Metrics)"
  - escalation notes into [[data-agenda-full]] §Questions — consumer: [[decision-office-charter]]
  - nf_a events (task_type: l0_board_rollup)
routing_class: extraction        # read five boards, carry each number with its denominator
quality_bar: "every board row shows a value AND its denominator, or the words 'not measured'; a run that emits a single L0 scalar fails ([[data-premortem]] M1, M3)"
autonomy:
  read: autonomous
  propose: autonomous            # board edits and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: data
escalates_to: "[[decision-office-charter]]"
```

**The card's own hard rule:** `data-l0-rollup` may never compute an average across the four
truth guarantees, and may never fill a missing number. A rollup that estimates the gap it
found is how [[data-premortem]] M2 (four guarantees blended) starts.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `l0-three-number-readout` | T2 | Daily, and **before any external claim about L0** | Wine · dish · sales emitted separately, each with its denominator and tier mix; zeros stated, never omitted; a single-scalar run fails | The 2026-08-24 department charter session had to establish all three by hand: 144/1,448 wine (`ef19b81`), dish identity deferred (`b728d25`), sales PARTIAL ([[README]] §1) | NEW |

**Dropped from the [[data-schedule]] proposal list, not quietly kept:** `wine-enrichment`,
`menu-extraction`, `producer-research`, `pos-line-resolution-repair`, `synthetic-backtest`
belong to teams, not here; `provenance-audit` and `quarantine-triage` sit on
[[substrate-quality-coverage-agent-stack]]. `substrate-progress-report` appears in **both**
this department's schedule and the auditor's — see the seam row in §5.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]],
[[skill-registry-authoring-charter]]); lifecycle review ([[skill-lifecycle-anti-sprawl-charter]]).

## 4. Memory

- **Procedural** — the §3 skill; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: l0_board_rollup`, plus read access to all five team task
  families. Needs `context.team` and `context.denominator` as jsonb keys: a coverage number
  stored without its denominator is unusable to this department by construction.
- **Semantic** — `memory/` beside this file, `data-MEMORY.md` as index. Its founding facts are
  already known: the demand-weighted vs. library denominator split
  (`…enrichment_demand_priority.sql:28-31`), and the two-owner substrate report seam (§5).
  Provenance frontmatter (`source`, `confidence`, `last_verified`); every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. The five team
  charters are retrieval targets, never preloaded (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[data-schedule]]'s agenda-sync slot: read the
department's NF-A slice; write one fact per durable finding, **failures first** — a team whose
metric stopped moving gets a fact naming the mechanism, not "coverage dipped"; expire facts
unverified for 90 days; emit skill candidates. One PR; "no delta" is stated, never silent.

## 5. Async contract

Cross-unit interaction is loops ([[data-loops]]), NF-A events, vault PRs, and skill candidates
only — never a synchronous call into a team. Gap and seam rows, stated rather than assumed away:

| Gap / seam | Why it is a gap |
|---|---|
| `source_guarantee` has no intake contract | The department's load-bearing invariant ([[data-charter]] §Boundaries, [[data-premortem]] M2) is designed, not built — [[data-schedule]] closes on exactly this: no skill should be authored "before the intake contract (`source_guarantee`) exists". Until then `substrate.rows_without_source_guarantee` has no denominator and no source |
| The daily substrate report — **resolved 2026-08-27 (founder, ADR 0035)** | The team **runs** it ([[substrate-quality-coverage-loops]] `substrate-progress-report` is the producer); [[data-loops]] `data-substrate-daily-report` is the department's daily **consumption** — the board rollup over that report and the other four teams' feeds. One producer, one consumer |
| `loop.close_time_breached` has no publisher | Nothing measures loop age; the daily and monthly schedules bound the blind spot |
| Escalation to [[decision-office-charter]] is a doc edit, not an event | Acceptable async path (vault PR), but nothing notifies — their schedule must poll [[data-agenda-full]] §Questions |

## 6. Evidence today

- **NEW — the rollup agent and its skill.** Nothing publishes the metric set today; the
  2026-08-24 generation session assembled it by hand, which is the past instance justifying it.
- **PARTIAL — the episodic substrate.** Enrichment is a real NF-A emitter
  (`haiku_enrichment_service.py`, in-session runs `ef19b81`/`8bbcde6`); the other four families
  emit nothing, so today's rollup would be one live row and four honest "not measured" rows.
- **EXISTS — everything the rollup would read**, per [[data-charter]] §Evidence: enrichment
  scripts and services, the annotation corpus and tooling, `scripts/{synth,docgen,simulate}/`,
  the POS unresolved tables and ingest routes, and the quality/governance migrations.
- **Open forks untouched here:** TECH-F1 (25 teams for one division) and TECH-F5 (7 artifacts
  at team level) both name this department and both stay open (`technology.md:843,847`).
