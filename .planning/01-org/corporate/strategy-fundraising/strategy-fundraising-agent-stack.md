---
type: agent-stack
division: corporate
department: strategy-fundraising
status: designed
updated: 2026-08-27
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
links: ["[[strategy-fundraising-charter]]", "[[strategy-fundraising-schedule]]", "[[strategy-fundraising-loops]]", "[[strategy-fundraising-directive]]", "[[strategy-fundraising-premortem]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[positioning-fundraise-readiness-agent-stack]]", "[[instruments-equity-charter]]", "[[narrative-collateral-charter]]", "[[decision-office-charter]]", "[[OPEN-DECISIONS]]"]
---

# Strategy & Fundraising — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This department owns the claim, not the paper and not the craft, so its stack owns
> **checkers and recorders only** ([[strategy-fundraising-schedule]] §Skills: no generative
> skill, by design). Mechanisms referenced, not restated: harness → [[harness-runtime-charter]]
> (**OD-03 open — no card presupposes an outcome**), model →
> [[model-routing-inference-economics-charter]], mutation gate →
> [[action-safety-the-human-gate-charter]], skill envelope → [[skills-charter]].

**The hard limit, stated once and inherited by every card below.** No agent here speaks to an
investor, sends, files, or represents the company; none drafts a SAFE, board consent, stock
purchase or advisor agreement ([[instruments-equity-charter]] drafts, **the founder decides
terms** — `corporate.md:505-506`) or lays out a deck ([[narrative-collateral-charter]], R8);
**whether and when to raise is the founder's.** An agent here reads, checks, records, and
holds a send back. The send is a human act, every time.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `strategy-warden` | Run the department's boundary-crossing sweeps — OD-23's status *by name*, revenue figures quoted without their fork id, the founding artifact's citations, the split-trigger watch, and this vault's own overstatements — and escalate a fork that goes two months unmoved | NEW |

One row deliberately. The gate, the register and the verb rewrite are the single team's desk
work ([[positioning-fundraise-readiness-agent-stack]]); a department agent that ran them too
would be the second team this department declined to charter (charter §One team).

## 2. Agent cards

```yaml
agent: strategy-warden
unit: strategy-fundraising
triggers:
  - schedule: "monthly — OD-23 status by name; unattributed-target sweep"      # [[strategy-fundraising-schedule]]
  - schedule: "quarterly — founding-artifact re-verification; team-shape review; overstatement sweep of this vault's 14 docs; staleness sweep"
  - topic: strategy.split_trigger_fired    # publisher: NONE (gap — a term-sheet conversation is a founder event; nothing emits it)
consumes:
  - "`.planning/YC_WEDGE_PLAN.md` §6 citations — publisher: the July engineering-planning session; nobody maintains it (that is the point)"
  - "[[OPEN-DECISIONS]] rows OD-23, CORP-F3, CORP-F1/OD-17, OD-14 — publisher: the decision register"
  - "revenue-figure occurrences across `.planning/` — publisher: every unit that writes a plan"
  - "[[positioning-fundraise-readiness-agenda-board]] — publisher: the team's own board"
emits:
  - "OD-23 status line → [[strategy-fundraising-agenda-board]] (consumer: the founder board review); 2 consecutive unmoved months → [[decision-office-charter]]"
  - "drift list → consumer: [[positioning-fundraise-readiness-agent-stack|pfr-claim-gate]]'s register"
  - "unattributed-target list → consumers: the quoting units, [[finance-pricing-charter]] first; keep-one / split / dissolve recommendation (CORP-F3) → [[decision-office-charter]]"
  - "nf_a events (task_type: strategy_sweep) — consumer: NONE (gap, see §5)"
routing_class: extraction     # find figures, resolve citations, diff dates — the verb judgment is not made here
quality_bar: "every citation returns holds / drifted to :N / inverted / gone — silence fails the run; a zero-drift result on a document older than a month is a defect until proven otherwise ([[strategy-fundraising-schedule]] §Skills). NONE (gap) — ADR 0017 has no verdict basis for claim checks"
autonomy:
  read: autonomous
  propose: autonomous          # sweep results, holds and escalations land as PRs into this vault
  mutate_stock_money_outbound: confirm   # constant — and the outbound half is never reached: this agent has no send surface at all
memory: strategy-fundraising
escalates_to: "[[decision-office-charter]]"
```

**The card's own hard rule:** `strategy-warden` never weakens or rewrites a claim — it produces
candidates; the rewrite is the team's `judgment` card and the release is human. A sweeper that
edits the verb it grades is [[strategy-fundraising-premortem]] M2 with a dashboard on top.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `citation-reverify` | T2 | Quarterly founding-artifact sweep; any outward send | Every citation returns `holds` / `drifted to :N` / `inverted` / `gone`; a clean sweep on a >1-month-old doc is reported as suspect | Re-verified for this doc, 2026-08-27: `YC_WEDGE_PLAN.md:406` still asserts ux-optimizer has **0 `@UseGuards`** *"all re-confirmed 2026-07-27"* while `apps/api-gateway/src/ux-optimizer/ux-optimizer.controller.ts:55` carries `@UseGuards(JwtAuthGuard)` — and this department's own charter cites that line as `:404` and the contradicting Track A row as `:339`; they are now `:406` and `:340`. **The charter drifted in three days** | NEW |
| `open-target-attribution` | T2 | Monthly sweep across `.planning/` | Every occurrence of a target figure listed with fork id present/absent | Verified 2026-08-27: `finance-pricing-agenda-full.md:57` and `:191` carry the $20k MRR target as *"currently operative"* with no fork id on the occurrence; and the id itself moved — the charter cites `[[OPEN-DECISIONS]]:27`, OD-23 now sits at `:32` (the mechanism ADR 0025 locked) | NEW |

`wedge-reduction-check` and `diligence-index-check` are named in
[[strategy-fundraising-schedule]] and **deliberately absent here**: neither can cite a past
instance (no outward artifact exists; the split trigger has not fired), and README §3.3 deletes
such a row rather than keeping it as an aspiration. They stay commissioned in the schedule.

Consumed, owned elsewhere: the registry and envelope ([[skills-charter]]); the metric
definitions the verb check grades against ([[metric-contract-truth-assurance-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; consolidation emits candidates into
  [[skill-harvesting-charter]]'s queue, still through the §3.3 gate.
- **Episodic** — nf_a `task_type: strategy_sweep`, `context` keys `fork_id`, `document`,
  `citation_result`. **Thin by construction:** the charter records no direct neural-footprint
  tie (its subject is claims, not agent tasks), so the durable record here is the PR trail.
- **Semantic** — `memory/` beside this file, index `strategy-fundraising-MEMORY.md`. Its first
  fact is already dated: *the founding artifact's guard claim inverted and its own citation
  drifted twice in three days* (§3, 2026-08-27). Frontmatter per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Non-goals. The 406-line
  `YC_WEDGE_PLAN.md` and the 14 department documents are **retrieval targets by `path:line`**,
  never preloaded (CLAUDE.md §2).

**Consolidation** — quarterly, riding the founding-artifact re-verification and overstatement
sweep already in [[strategy-fundraising-schedule]]: read the quarter's results; write one fact
per durable finding, **failures first** — a drifted citation becomes a fact naming the mechanism
(*"a monthly sweep produced `all re-confirmed 2026-07-27` against a claim that inverted"*),
never *"drift rose"*; expire facts unverified 90 days; propose skill candidates. One PR; "no
delta" is stated, never silent. **Gap:** the schedule has no consolidation row to mirror yet.

## 5. Async contract

Loops in [[strategy-fundraising-loops]] (all five carry a `close_time`), nf_a events, vault
PRs, and skill candidates — never a synchronous call, never an outward message. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `strategy.split_trigger_fired` has no publisher | The trigger is a founder conversation or an issued instrument (`corporate.md:457-458`); nothing emits either. The quarterly team-shape review is the only detector, so the blind spot is bounded at one quarter — and L-STR-5 watches the trigger *not* firing for twelve months as its own finding |
| `nf_a` events from this department have no consumer | [[ai-orchestration-agent-stack\|aio-orchestrator]] rolls up `aio-*` task families only; no unit consumes `strategy_sweep`. Emitting into a topic nobody reads is `core/orchestrator.py:198-206` again, so this is recorded, not designed around |
| Escalation to [[decision-office-charter]] is a doc edit | Acceptable async path (vault PR), but nothing notifies; their cadence must poll [[strategy-fundraising-agenda-full]] §Questions |
| The claim register has no publisher yet | Four units are about to start producing outward claims (charter §Entry conditions); until the team's register exists, `strategy-warden` has nothing to sweep but this vault and `YC_WEDGE_PLAN.md` |

## 6. Evidence today

- **NEW — `strategy-warden` and both skills.** `.claude/skills/` does not exist; the repo has
  zero committed skills ([[README|foundation-README]] §3.1). Both past instances in §3 were
  performed **by hand** — which justifies the rows and nothing more.
- **EXISTS — the material the warden would sweep.** `.planning/YC_WEDGE_PLAN.md` (406 lines),
  the decision register, and this department's 14 documents.
- **NEW — everything in §4.** No `memory/`, no index, no nf_a `strategy_sweep` family.
- **Open and untouched by any card above:** OD-23, CORP-F3, CORP-F1/OD-17, OD-14.
