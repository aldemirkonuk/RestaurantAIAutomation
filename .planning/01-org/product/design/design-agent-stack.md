---
type: agent-stack
division: product
department: design
status: designed
updated: 2026-08-27
metrics: [design.paths_closed_per_month, design.deferred_unblocker_ratio, design.token_source_count, design.resolved_question_rate, design.time_to_first_real_action_staff_min]
links: ["[[design-charter]]", "[[design-schedule]]", "[[design-loops]]", "[[design-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[ai-orchestration-charter]]", "[[ux-path-burn-down-agent-stack]]", "[[design-system-motion-substrate-agent-stack]]", "[[exploration-studio-agent-stack]]", "[[activation-in-product-guidance-agent-stack]]", "[[decision-office-charter]]"]
---

# Design — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Department-level stacks orchestrate **the unit itself**, never the teams' work: this card
> reads four boards, keeps five non-commensurable numbers side by side, and keeps one thing
> **off**. Mechanisms are referenced, not restated — harness → [[harness-runtime-charter]]
> (**OD-03 open**), model choice → [[model-routing-inference-economics-charter]], the mutation
> gate → [[action-safety-the-human-gate-charter]], memory + NF-A shape → ADR 0006/0008/0017.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `design-board-steward` | Roll the four teams' metric sets onto one board **without ever summing them**, and keep the optimizer dark-check honest — reporting *unmeasured* out loud where a number has no event behind it | NEW |

One row. The department's own recurring work is exactly two things the teams do not do: the
rollup, and the monthly optimizer dark-check that [[design-charter]] deliberately made
*"a scheduled job, not a team"*. Keeping something off is a monthly grep — it does not need
a team, and it does not need a second agent either.

## 2. Agent cards

```yaml
agent: design-board-steward
unit: design
triggers:
  - schedule: "weekly — ledger-reconciliation and path-close rollup"    # [[design-schedule]]
  - schedule: "monthly — substrate census, activation cohort read, optimizer dark-check"
  - topic: loop.close_time_breached    # publisher: NONE (gap — nothing measures loop age; see §5)
consumes:
  - the four team agenda-boards (Dataview output) and their five loop families (L-DSN-1…5)
  - "row counts in ux_proposals / ux_overrides / ux_learnings and the value of UX_OPTIMIZER_ENABLED (apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts:78)"
  - nf_a events sliced by this department's task types (ADR 0006/0008)
emits:
  - "[[design-agenda-board]] rollup — the five metrics as a SET; a combined 'design velocity' figure is forbidden ([[design-directive]])"
  - "design.ledger_drift_days, design.ux_optimizer_rows (correct value 0)"
  - escalation notes into [[design-agenda-full]] §Questions, addressed by name to the Decision Office
  - nf_a events (task_type: design_board_rollup)
routing_class: extraction        # reading four boards and counting rows is not judgment
quality_bar: "every board row carries a measured value or the word *unmeasured* with the missing event named (L-DSN-4 must report unmeasured monthly, out loud — [[design-loops]]); no averaged or summed figure ever. NONE (gap) — ADR 0017 has no verdict grader for a board rollup"
autonomy:
  read: autonomous
  propose: autonomous            # rollups and escalations land as vault PRs
  mutate_stock_money_outbound: confirm    # constant; this agent has no such surface
memory: design
escalates_to: "[[decision-office-charter]]"
```

**Two hard rules on this card.** (1) It may *count* `design.ux_optimizer_rows`; it may never
propose enabling, extending, or seeding the optimizer — [[AGENT_NATIVE_UI_DECISION]]:78 is a
closed *"don't build"* verdict and it is reversed by a superseding ADR, not by an agent's
proposal. (2) It may *document* design-foundation drift
(OD-106, `decisions/OPEN-DECISIONS.md:66` — deferred by the founder 2026-08-26 to **documentation
only**); it may not pick a direction or a primary. Both forks stay open here by design.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `optimizer-dark-check` | T2 | Monthly, and on any PR touching `apps/api-gateway/src/ux-optimizer/` | Four row counts plus the flag value published; any non-zero count escalated the same day | The module shipped enabled-by-config with four tables and **0 rows** — `ux-optimizer.module.ts:14` (*"Ships DARK by default"*), flag default at `ux-optimizer.service.ts:78`; found by hand in the 2026-08-24 charter pass | NEW |

Only the department's own job appears here; the other five proposals in [[design-schedule]]
are team-owned and live in the four team stacks.

**Two corrections this stack carries.** `.claude/skills/` now exists with a `README.md` and
**zero committed skills** — [[design-schedule]] (2026-08-24) says it does not exist at all;
the row above is still NEW either way. And the optimizer flag has moved from `:69` to `:78`
since the charter was written — a line-shift of exactly the kind ADR 0025 was written about.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); gate
operation ([[agent-evaluation-gates-charter]]).

## 4. Memory

- **Procedural** — the §3 skill; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: design_board_rollup`, plus read access to the four team
  families (`ledger_reconcile`, `substrate_census`, `sketch_sweep`, `activation_read`).
  Needs `context.team` so a per-team slice is one filter, and `context.role`
  (owner/manager/staff) so the activation numbers can never be silently averaged into one.
- **Semantic** — `memory/` beside this file, `design-MEMORY.md` as index, one fact per file
  with `source` / `confidence` / `last_verified`. Its first four files are already known: the
  Seating Density ledger drift, the 910-not-760 denominator, `token_source_count = 2`, and
  `ux_optimizer_rows = 0`. Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. The 157,641-byte
  catalogue and the 53-directory sketch corpus are **grep targets by `path:line`**, never
  preloaded (CLAUDE.md §2).

**Consolidation** — monthly, alongside the monthly reads in [[design-schedule]]: read the
department's NF-A slice and the four boards since the last run; write one fact per durable
finding, **failures first** — a drift event becomes a fact naming the mechanism (*"log and
banner are two places a human must update, `UX_PATHS_CATALOG.md:15`"*), never the symptom
(*"row 49 was stale"*); expire facts unverified for 90 days; propose skill candidates. One
PR. A run that changes nothing reports "no delta", never silence.

## 5. Async contract

Cross-unit interaction is loops ([[design-loops]]), NF-A events, vault PRs, and skill
candidates only. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `loop.close_time_breached` has no publisher | Nothing measures loop age; the weekly and monthly schedules bound the blind spot at one cycle |
| `design.time_to_first_real_action_*` has no producing event | The event does not exist and [[analytics-bi-charter]] has not agreed one; L-DSN-4 reports **unmeasured** every month until it does — that is the loop working, not failing |
| Escalation to [[decision-office-charter]] is a doc edit, not an event | An acceptable async path (vault PR), but nothing notifies; their schedule must poll [[design-agenda-full]] §Questions |
| `design.blocked_on_endpoint_count` is emitted with no committed consumer | **PROD-F5** ([[FORK-REGISTRY]]) is open — whether Design may commission endpoints is undecided, so the number is published monthly to make the cost of the open fork visible rather than absorbed |

## 6. Evidence today

- **NEW — the steward, the skill, and all four §4 layers** except the NF-A tables themselves
  (ADR 0006/0008; verdicts sidecar per [[0017-doneability-verdicts-are-sidecar-claims]]).
- **EXISTS — everything it would read.** The 910-row catalogue and its Deferred Decisions Log
  (`UX_PATHS_CATALOG.md:10-67`), the 53-directory sketch corpus and `MANIFEST.md`,
  `packages/ui/src/`, `apps/web/src/components/onboarding/`, and the dark optimizer module —
  re-verified on disk this session, including the two burgundies OD-106 names
  (`apps/web/tailwind.config.js:31` `#9E4249` vs `sketches/themes/default.css:6` `#CD2D5B`).
- **PARTIAL — the episodic substrate.** `nf_a.*` emits since P1
  (`model-client.service.ts:413`, charter correction 2026-08-25) but **no Design task family
  emits anything**; `nf_b.*` is still unemitted, which is why the charter's guest-surface tie
  is a design-side claim rather than a reading.
- **NEW — measurement, all of it.** Not one of the five primary metrics has a first reading,
  so the steward's first board is honestly a table of *unmeasured* rows — which is what
  ADR 0020 wants shown.
