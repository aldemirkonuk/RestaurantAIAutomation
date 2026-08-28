---
type: agent-stack
division: platform
department: engineering
status: designed
updated: 2026-08-27
metrics: [identity.false_merge_count, inventory.projection_divergence_rows, procurement.order_to_delivery_reconciliation_rate, messaging.duplicate_delivery_rate, surfaces.reachable_route_ratio, platform.endpoints_protected_by_default_pct, integration.verified_signature_coverage, schema.days_since_hand_applied_ddl]
links: ["[[engineering-charter]]", "[[engineering-schedule]]", "[[engineering-loops]]", "[[engineering-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[harness-runtime-charter]]", "[[action-safety-the-human-gate-charter]]", "[[decision-office-charter]]"]
---

# Engineering — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> A department stack orchestrates **the unit itself**, never its teams' work. Engineering's
> eight teams are eight incommensurable ways the product can be wrong ([[engineering-charter]]
> §Boundaries), so this card's whole job is to keep eight numbers side by side without ever
> letting them become one — and to catch the seams between them, which is where
> [[engineering-premortem]] M1 says failure hides. Mechanisms are referenced, never restated:
> harness → [[harness-runtime-charter]] (**OD-03 open**), model choice →
> [[model-routing-inference-economics-charter]], the mutation gate →
> [[action-safety-the-human-gate-charter]], the skill envelope → [[skills-charter]]. The same
> references hold for the eight team stacks below and are not repeated there.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `eng-board-keeper` | Publish the eight wrongness numbers weekly — each measured or explicitly *unreadable*, never summed — and route every seam question to a left-of-seam owner or to `OPEN-DECISIONS.md` | NEW |

One row deliberately. Each of the eight failure modes already has a team agent below it;
a department agent that sampled stock or audited routes would be the duplication
`technology.md:845` warns about.

## 2. Agent cards

```yaml
agent: eng-board-keeper
unit: engineering
triggers:
  - schedule: "weekly — L-ENG-1, L-ENG-2, L-ENG-5"     # mirrored in [[engineering-schedule]]
  - schedule: "monthly — L-ENG-3, L-ENG-4"
  - topic: seam.question_opened                         # publisher: NONE (gap — questions.md entries are hand-authored)
consumes:
  - the eight team agenda-boards (publisher: each team's Dataview query)
  - CI guard results (publisher: .github/workflows/ci.yml:345,526 and schema-parity.yml:79,173,211)
  - "scripts/watch_loops.py --json (publisher: .github/workflows/loop-watcher.yml, Mondays 07:00 UTC)"
  - the eight teams' questions.md files (publisher: humans and advisory passes)
emits:
  - "[[engineering-agenda-board]] — eight rows, never summed (charter §Metrics; consumer: the Platform division roll-up (a division has no charter file — see [[ORG-MAP]]) and the founder board review)"
  - "seam assignments and OPEN-DECISIONS entries (consumer: [[decision-office-charter]])"
  - "nf_a events (task_type: eng_board_rollup) — consumer: NONE (gap, see §5)"
routing_class: extraction        # reading eight boards and counting is not judgment
quality_bar: "L-ENG-1's rule is the grader: every one of the eight rows carries a measured value or the word 'unreadable'. An omitted metric reads as green ([[engineering-loops]] L-ENG-1). No combined number is ever a valid output."
autonomy:
  read: autonomous
  propose: autonomous            # board rows and seam assignments land as PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: engineering
escalates_to: "[[decision-office-charter]]"
```

**The card's own hard rule:** `eng-board-keeper` never averages, weights, or ranks the eight
numbers. A false merge and a stale bundle do not sum ([[engineering-charter]] §Metrics), and
a helpful "overall Engineering health" score is premortem M1 rendered as a dashboard.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `seam-arbitration-check` | T2 | A `questions.md` entry names two units and neither has answered; or a new charter claims work an Engineering team already owns | Every open seam question is either assigned to the left-of-seam owner from `technology.md:857-865` or filed with an OD/TECH-F id; count and age published | The seven cross-department seams were enumerated by hand in the 2026-08-24 evidence pass (`technology.md:857-865`) precisely so they would not be arbitrated later, and TECH-F2 (schema-migrations / messaging-delivery vs platform-api) is still open | NEW |
| `guard-outcome-reconciliation` | T2 | Monthly (L-ENG-3), and on any new grep-shaped CI guard | Every grep-shaped guard in `.github/workflows/` is listed with its outcome-side twin, or named as having none; the alarm state (green guard ∧ divergent data) is asserted explicitly | `scripts/check_no_direct_stock_writes.sh:10-13` documents its own blind spot — the two functions it was written against type-checked fine while writing nonexistent columns — and its outcome twin, the daily divergence sample, has never run ([[inventory-ledger-charter]] §Evidence) | NEW |

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); the parity
and drift gates ([[state-integrity-invariants-charter|sre-state-integrity]]); gate operation
([[agent-evaluation-gates-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; consolidation emits candidates into
  [[skill-harvesting-charter]]'s queue, where the §3.3 gate still applies to each.
- **Episodic** — nf_a `task_type: eng_board_rollup` and `eng_seam_arbitration`, plus read
  access to the eight team task families. Needs `context.team` and `context.metric` as jsonb
  keys, so "show me every reading of `identity.false_merge_count`" is one filter rather than
  a join this department invents for itself.
- **Semantic** — `memory/` beside this file, `engineering-MEMORY.md` as index. Its founding
  facts are already known and would be its first files: which of the eight metrics have no
  reader today (five, by the teams' own charters), the seam register, and the
  `check_display_name_parity.py` wiring gap in §6. Provenance frontmatter per ADR 0034;
  every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics, and the
  eight-team wrongness table. Team charters and `technology.md` are retrieval targets by
  `path:line`, never preloaded (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[engineering-schedule]]: read this department's
NF-A slice and the eight board histories since the last run; distill durable facts, failures
first — a metric that went from readable to unreadable becomes a fact naming the mechanism
(the job stopped, the owner left, the query broke), never "coverage dipped"; expire facts
unverified for 90 days; propose skill candidates. One PR. A run that changes nothing reports
"no delta", never silence.

## 5. Async contract

This department's agent never calls a team synchronously. Every crossing is a loop in
[[engineering-loops]] with a `close_time`, an NF-A event, a vault PR, or a skill candidate.
Gap rows, stated rather than assumed away — the fleet has already been burned by a subscribed
topic with zero publishers, dead for months and invisible (`core/orchestrator.py:198-206`):

| Gap | Why it is a gap |
|---|---|
| `seam.question_opened` has no publisher | `questions.md` entries are hand-authored; nothing emits on a new one. The weekly L-ENG-2 close_time bounds the blind spot at 7 days |
| Five of the eight board metrics have no producer | `procurement.order_to_delivery_reconciliation_rate`, `integration.verified_signature_coverage`, `messaging.*`, `surfaces.reachable_route_ratio` and `inventory.projection_divergence_rows` are specified with no cited job. The board's honest first output is five `unreadable` rows |
| `eng_board_rollup` NF-A events have no declared consumer | No division-level rollup agent is chartered. Recorded here rather than assumed — an emit with no consumer is the `orchestrator.py:198-206` shape inverted |
| Escalation to the Decision Office is a doc edit | An acceptable async path (vault PR), but nothing notifies; their schedule must poll [[engineering-agenda-full]] §Questions |

## 6. Evidence today

- **NEW — `eng-board-keeper` and both skills.** Nothing performs the rollup or the seam sweep;
  both were done by hand in the 2026-08-24 generation pass, which is the past instance that
  justifies them.
- **EXISTS — parts of the substrate the keeper would read.** The guard set is wired and
  running: `.github/workflows/ci.yml:345,526`, `.github/workflows/schema-parity.yml:79,173,211`.
  `scripts/watch_loops.py` runs weekly via `.github/workflows/loop-watcher.yml` and already
  emits machine output (`watch_loops.py:24-28`) — the only existing scheduled reporter in
  this department's reach.
- **PARTIAL — the metric substrate.** Three of eight numbers are readable today
  (`schema.days_since_hand_applied_ddl`, `identity.*` via the CI gate, and
  `platform.*` via a hand census); five are not. See §5.
- **Finding, filed rather than fixed here:** [[engineering-schedule]] lists
  `scripts/check_display_name_parity.py` as a per-PR CI guard. The script exists on disk but
  a grep over `.github/` finds no workflow that invokes it — the other five guards are all
  wired. This belongs in [[catalogue-identity-charter]]'s queue, not in this doc.
