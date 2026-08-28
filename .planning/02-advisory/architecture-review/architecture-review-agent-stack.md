---
type: agent-stack
division: advisory
department: architecture-review
status: designed
updated: 2026-08-27
metrics: [arch.layer_violations_open, arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.duplicated_invariants, arch.diverged_invariant_count, arch.direct_provider_callsites, arch.layer_bypass_callsites]
links: ["[[architecture-review-charter]]", "[[architecture-review-schedule]]", "[[architecture-review-loops]]", "[[architecture-review-questions]]", "[[architecture-review-premortem]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[security-charter]]"]
---

# Architecture Review — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Advisory sits **outside the line**, **findings-only, locked** ([[ORG_STRUCTURE]] §3,
> OD-16): this agent reads anything and proposes findings; it owns no line work and fixes
> nothing, ever. Mechanisms referenced only — harness → [[harness-runtime-charter]]
> (**OD-03 open**), model choice → [[model-routing-inference-economics-charter]], mutation
> gate → [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `arch-census-scout` | Keep the seven `arch.*` numbers true — bypass statements, provider callsites, invariant enforcement points, finding ages — and hand the counts to a human who does the judging | NEW |

One row, deliberately. [[architecture-review-schedule]] names the skill this function must
**not** write: one that emits a well-formatted sweep regardless of whether anything was
reviewed. The sweep is a job with a human judgement in it; this agent is the mechanics
around it.

## 2. Agent cards

```yaml
agent: arch-census-scout
unit: architecture-review
triggers:
  - schedule: "fortnightly (1st, 15th), before the layer sweep"   # [[architecture-review-schedule]]
  - schedule: "monthly — callsite count"                          # same
  - topic: commit.touches_layer_boundary   # publisher: NONE (gap — no layer map, no CI check)
consumes:
  - apps/web · apps/api-gateway/src · services/agent-orchestrator (grep targets by path:line, never preloaded — CLAUDE.md §2)
  - "[[architecture-review-questions]] — the finding log (publisher: scripts/build_questions_files.py, OD-41)"
  - "scripts/check_schema_parity.sh verdict (publisher: [[schema-migrations-charter]]; we read it, we do not run it)"
  - "[[README|foundation-README]] §1 — the L0–L6 rule; no directory→layer map exists (gap)"
emits:
  - "findings into the reviewed unit's <slug>-questions.md (consumer: that unit)"
  - "the seven arch.* counts onto [[architecture-review-agenda-board]] (consumer: founder board review)"
  - "42-day escalations as OPEN-DECISIONS rows (consumer: [[decision-office-charter]])"
  - "nf_a events (task_type: arch_census)"
routing_class: mechanical      # grep, count, diff, age — every judgement step is outside this card
quality_bar: "reproducible: a rerun on the same commit yields the same counts, and arch.finding_age_days_max is recomputed from the log, never asserted. NONE (gap) — ADR 0017 has no verdict basis for an architecture census"
autonomy:
  read: autonomous
  propose: autonomous          # findings and counts land as vault PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: architecture-review
escalates_to: "[[decision-office-charter]]"
```

**Two hard rules on the card.** (1) It writes only inside `.planning/` — a patch against
`apps/` or `services/` violates the charter's first non-goal, and build capacity here would
create an incentive to review what it wants to build. (2) It assigns no severity and does
not decide whether two enforcement points are *the same invariant*; the ladder and the
pairing stay the unit's judgement.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `invariant-census` | T2 | A sweep starts, or a comment claims code was "ported"/"mirrored"/"kept in sync" | Every enforcement point of one invariant listed and compared; divergence stated as a count, not an impression | **AR-2.** `inbound-responder.service.ts:44-48` claims "ported verbatim"; the guardrail is **19** patterns in TS (`:49-70`) and **8** in Python (`provider_conversation_agent.py:120-129`) | NEW |
| `layer-boundary-check` | T3 | Any commit touching `apps/web`, `apps/api-gateway/src`, `services/agent-orchestrator` | Every L6→L0 statement named with `path:line`, or zero with the grep shown | **AR-1.** `useSommelierQueries.ts:25-26,42-43,56` and `useReportQueries.ts:25-26,36-37` reach Postgres from the browser while `reports.service.ts:54,72,100` owns the same table at L2 | NEW |
| `metering-census` | T3 | A commit adds a call to an external model provider | Callsites split into routed-through-`common/model-client` vs hand-rolled, with each hand-rolled one's timeout and retry | **AR-3.** Seven callsites, seven endpoint constants; one of seven retries, three of seven have no timeout | NEW |
| `layer-assignment` | T2 | A new top-level directory, service, or app appears | Every directory carries exactly one layer, or is listed as unassigned | **AR-4** (2026-08-24 session): L4 had no directory — `decision_log` (`baseline…sql:2687-2698`) and `api_spend` (`:2231-2240`) with no join key is what an unassigned layer looks like from inside | NEW |

**`finding-age-report` is deliberately absent.** [[architecture-review-schedule]] cites it
as the one candidate with **no past instance** — the log did not exist when it was written
— so under [[README|foundation-README]] §3.3 rule 3 it gets no row here, and stays a
scheduled job until the log has aged something. Consumed, owned elsewhere: the `SKILL.md`
contract and registry ([[skills-charter]]); the 30-day staleness review
([[skill-lifecycle-anti-sprawl-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; consolidation candidates go to
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: arch_census`, one event per sweep or census run. Needs
  `context.finding_id` and `context.division_under_review` as jsonb keys, so "every touch
  of AR-2" and "the Product rotation's history" are each one filter, not a join.
- **Semantic** — `memory/` beside this file, `architecture-review-MEMORY.md` as index, one
  fact per file with `source` / `confidence` / `last_verified`. Founding facts are known:
  the AR-2 divergence and its two counts; the seven-callsite split; and that
  `check_schema_parity.sh:6-11` is the repo's only self-closing boundary loop, and so the
  shape every proposed check copies. Every write lands as a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and the severity ladder.
  Source files are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly, mirrored in [[architecture-review-schedule]]: read the census
slice since the last run; write one fact per durable finding, **failures first** — a
finding aged past 42 days without closing becomes a fact naming *why* (no owner, contested
severity, nobody read the questions file), never "still open"; expire facts unverified 90
days; propose skill candidates. One PR; "no delta" is stated aloud.

## 5. Async contract

Cross-unit interaction is loops ([[architecture-review-loops]] — five, fortnightly through
quarterly, all `proposed`), NF-A events, vault PRs, and skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `commit.touches_layer_boundary` has no publisher | No layer map and no import-boundary check exist; the fortnightly sweep bounds the blind spot at 14 days |
| A finding landing in another unit's `questions.md` notifies nobody | The file exists (OD-41) but nothing pushes; the Dataview on `open_questions > 0` only fires for someone already in the vault |
| The mandate's scope is contradicted by its own source | Charter §Mandate says [[ORG_STRUCTURE]] §3 reads *"All of Technology + Product"*; §3 today reads **"All divisions"** with a correction note. Two documents disagree about this function's scope. **Routed to [[decision-office-charter]]'s contradiction register, not resolved here** |

## 6. Evidence today

- **NEW — the scout and all four skills.** No census runs today; each cited instance was
  done by hand in the 2026-08-24 generation session, which is what justifies the row.
- **EXISTS — the destination, since the charter was written.** AR-0 graded "a finding has
  nowhere to land" Sev-1; `architecture-review-questions.md` now exists, created 2026-08-24
  by `scripts/build_questions_files.py` under OD-41, carrying the 42-day escalation rule
  (`:38-41`). The charter §Evidence is stale on this point.
- **EXISTS — the surface it measures.** AR-1, AR-2, AR-3, AR-5, AR-6 carry live `path:line`
  citations in [[architecture-review-charter]].
- **PARTIAL — AR-4, closed 2026-08-25.** Emission ships from `model-client.service.ts:413`,
  the Python side carries join keys (`spend_logger.py:269,276,406`); verdict coverage is
  what remains open ([[0017-doneability-verdicts-are-sidecar-claims]]).
- **NEW — the log's contents.** `architecture-review-questions.md:21` holds zero open rows,
  so `arch.finding_age_days_max` is 0 for the honest reason, not the flattering one.
