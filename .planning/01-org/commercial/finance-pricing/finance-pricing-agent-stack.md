---
type: agent-stack
division: commercial
department: finance-pricing
sublayer_of: growth
status: designed
updated: 2026-08-27
metrics: [nf_a.cost_per_completed_task, fin.spend_reconciliation_variance_pct, fin.spend_attribution_coverage_pct, fin.metered_invocation_coverage_pct, fin.cost_to_serve_per_restaurant_month]
links: ["[[finance-pricing-charter]]", "[[finance-pricing-schedule]]", "[[finance-pricing-loops]]", "[[finance-pricing-premortem]]", "[[0034-agent-stack-artifact]]", "[[0016-ledgers-must-express-unknown]]", "[[inference-cost-agent-stack]]", "[[unit-economics-pricing-agent-stack]]", "[[growth-charter]]", "[[skills-charter]]", "[[decision-office-charter]]"]
---

# Finance & Pricing — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> A sub-layer, not a department ([[finance-pricing-charter]]): escalation runs through
> [[growth-charter]], not to a peer seat. Its two halves are graded oppositely — F1
> EXISTS, F2 NEW — so the orchestrating card's whole job is **keeping two numbers
> visibly separate**, never averaging them into one. Mechanisms are referenced, not
> restated: harness → [[harness-runtime-charter]] (**OD-03 open**), model choice →
> [[model-routing-inference-economics-charter]], the mutation gate →
> [[action-safety-the-human-gate-charter]], honesty of the ledger itself → ADR 0016.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `fin-orchestrator` | Publish the two team numbers side by side and never one, and escalate any loop that breaches its close_time, any figure that reads `0` where it means unknown, or any document that fuses a measured F1 figure with an unmeasured F2 figure | NEW |

One row deliberately. Every metric in the sub-layer already has a team owner; a
sub-layer agent that *computed* a finance number would be [[finance-pricing-premortem]]
D1 — one half laundering credibility onto the other — implemented in code.

## 2. Agent cards

```yaml
agent: fin-orchestrator
unit: finance-pricing
triggers:
  - schedule: "monthly, after L-FIN-1 reconciliation closes"   # mirrored in [[finance-pricing-schedule]]
  - schedule: "quarterly, for the CM-F4 placement report"      # mirrored in [[finance-pricing-schedule]]
  - topic: fin.price_quoted_externally    # publisher: NONE (gap — no disclosure mechanism exists; see §5)
consumes:
  - "[[inference-cost-agenda-board]] and [[unit-economics-pricing-agenda-board]] (Dataview output) — publishers: the two teams"
  - "fin.* metric rows emitted by [[inference-cost-agent-stack]] and [[unit-economics-pricing-agent-stack]]"
  - "the outputs_to distribution of [[finance-pricing-loops]] — publisher: the loops file itself (static)"
emits:
  - "[[finance-pricing-agenda-board]] rollup — the two numbers as a pair; no combined 'finance' figure ever (charter §Metrics)"
  - "quarterly CM-F4 placement report → [[decision-office-charter]], or an explicit 'no change'"
  - "escalation notes into [[finance-pricing-agenda-full]] §Questions → consumer [[growth-charter]] (poll-only; see §5)"
  - nf_a events (task_type: fin_board_rollup)
routing_class: extraction        # reading two boards and checking that each figure still carries its caveat
quality_bar: "every board row carries a value, or the words 'not measured' / 'not derivable' / 'unpriced' — never 0 (ADR 0016, ADR 0020). F1 and F2 figures appear together or neither ships. NONE (gap) — ADR 0017 defines no verdict grader for board rollups; the bar is a rerunnable query"
autonomy:
  read: autonomous
  propose: autonomous            # board edits and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant — and load-bearing here, not vacuous: this sub-layer's subject matter is a money ledger and a price
memory: finance-pricing
escalates_to: "[[growth-charter]]"       # sub-layer, no peer seat; >5% reconciliation variance goes on to [[decision-office-charter]]
```

**The card's own hard rules.** `fin-orchestrator` never writes `api_spend`, never
changes a cap threshold, and **never proposes a price, tier or rate** — pricing is
founder-deferred (`commercial.md:296-298`) and the deferral is enforced by grep in
[[unit-economics-pricing-directive]], not by this card's good intentions.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `two-number-separation-check` | T2 | Any board, doc or deck that cites a Finance & Pricing number | Each F1 figure is published with its F2 counterpart's grade attached, and no combined figure exists; a figure whose input is missing reads "not derivable" | The 2026-08-24 charter session had to grade the sub-layer **PARTIAL** because its halves graded EXISTS and NEW — the mismatch was found by hand, and the "two independent numbers and never one" rule was written in response ([[finance-pricing-charter]] §Evidence, §Metrics; [[finance-pricing-premortem]] D1) | NEW |

Owned by the teams, not here: `spend-callsite-census`, `spend-reconciliation-pass`,
`spend-meter-liveness-check`, `spend-schema-bridge-review`
([[inference-cost-agent-stack]]); `price-quote-register`, `no-price-proposed-guard`,
`cost-to-serve-report` ([[unit-economics-pricing-agent-stack]]). Registry ownership is
[[skills-charter]]'s.

## 4. Memory

- **Procedural** — the one §3 skill; candidates go to [[skill-harvesting-charter]]'s
  queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: fin_board_rollup`, plus read access to both teams'
  task families. Needs `context.team` so an F1/F2 slice is one filter, and
  `context.cost_basis` (already written by `spend_logger.py:404`) so an unpriced call is
  distinguishable from a free one at rollup time.
- **Semantic** — `memory/` beside this file, index `finance-pricing-MEMORY.md`. Facts of
  the shape "reconciliation has still never been run" or "the `$20–50/mo` figure still
  has no ADR", each with `source` (the query, ADR or dated session), `confidence`,
  `last_verified`. Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team
  charters, `commercial.md` and the baseline migration are retrieval targets by
  `path:line` (CLAUDE.md §2).

**Consolidation** — monthly, alongside L-FIN-1 (the reconciliation month is the month
new facts exist). Read the sub-layer's NF-A slice; write one fact per durable finding,
**failures first** — a variance breach becomes a fact naming the mechanism, never
"spend rose"; expire facts unverified for 90 days; emit skill candidates. One PR; "no
delta" is stated, never silent. [[finance-pricing-schedule]] does not yet carry a
consolidation row — adding it is a schedule edit, not an agent-stack one.

## 5. Async contract

Loops with close_times ([[finance-pricing-loops]]), NF-A events, vault PRs and skill
candidates only. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `fin.price_quoted_externally` has no publisher | Nothing announces an externally quoted number; the register depends on founder/Sales/Media & Brand disclosure ([[unit-economics-pricing-schedule]] §Dependencies), and `fin.unregistered_quote_incidents` only detects after the fact — which is [[finance-pricing-premortem]] D3, the anchor arriving before the model |
| Escalation to [[growth-charter]] is a doc edit; nothing notifies | Exactly [[finance-pricing-premortem]] D4 — the parent consuming nothing this sub-layer produced. Growth's schedule must poll [[finance-pricing-agenda-full]] §Questions |
| `nf_a.cost_per_completed_task` — **resolved 2026-08-27 (founder, ADR 0035)** | [[model-routing-inference-economics-charter]] produces the measurement; [[inference-cost-charter]] consumes it for unit economics. The number has one producer; this division fetches. OD-29's RM-1 half stays open |
| The provider invoice is not a system input | Reconciliation is a human reading the Anthropic and Google consoles; console access is "assumed, **not verified**" ([[inference-cost-schedule]] §Dependencies) |

## 6. Evidence today

- **NEW — `fin-orchestrator` and its skill.** No rollup exists; the board is a Dataview
  that renders and does not escalate.
- **EXISTS — one substrate, and it is the only running job in the sub-layer.** The
  hourly cap check (`jobs/spend_tasks.py:135`, registered `jobs/celery_app.py:80-84`,
  thresholds `:24-27`) and the `public.api_spend` ledger
  (`supabase/migrations/20260805000000_baseline_from_production.sql:2229-2238`).
- **EXISTS — the honesty rule this card's quality_bar leans on.** ADR 0016 is built, not
  designed: one `unpriced` flag drives both ledgers (`spend_logger.py:357-363`), and an
  unpriced call books `NULL` rather than `$0.000000`.
- **PARTIAL — the numbers themselves.** F1 EXISTS, F2 NEW and dormant, so today's rollup
  would be two rows of honest blanks — which is what ADR 0020 wants shown.
- **Citation drift worth flagging.** [[finance-pricing-charter]] cites
  `spend_logger.py:41-49`; after ADR 0016 and P1, `log()` begins at `:260` and the
  dual-ledger write runs `:357-421`. The evidence stands; the line numbers moved.
