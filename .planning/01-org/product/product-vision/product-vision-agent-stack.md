---
type: agent-stack
division: product
department: product-vision
status: designed
updated: 2026-08-27
metrics: [inbound.proposal_accept_without_edit_rate, inbound.false_accept_count, floor.kitchen_ready_to_waiter_p95_seconds, floor.misroute_rate, supply.sku_dual_price_coverage_pct, supply.price_freshness_p50_days, surface.unowned_surface_count, askai.confirm_without_edit_rate, askai.refusal_correctness, nf_a.doneability_verdict]
links: ["[[product-vision-charter]]", "[[product-vision-schedule]]", "[[product-vision-loops]]", "[[product-vision-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[ai-orchestration-agent-stack]]", "[[decision-office-charter]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[FORK-REGISTRY]]"]
---

# Product & Vision — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> A department stack orchestrates **the unit itself**, never its teams' work: this card
> reads five team boards, runs the daily open-decision digest assigned here by name
> (foundation [[README]] §6), and watches one settled decision for erosion. The mechanisms
> stay owned elsewhere — harness → [[harness-runtime-charter]] (**OD-03 open, no card may
> presuppose an outcome**), model choice → [[model-routing-inference-economics-charter]],
> the mutation gate → [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `pv-orchestrator` | Publish the five team metrics as a **set** on one board, run the daily open-decision digest, and escalate any department fork or settled-decision drift — without answering a single team's question for it | NEW |

One row deliberately. The daily digest is a **scheduled trigger on this agent, not a second
agent**: a "Decision & Roadmap Ops" team was considered and rejected in the division pass
because it would duplicate [[decision-office-charter]] (`teams/product.md:819`), and giving
the digest its own agent would re-create that duplication one layer down.

## 2. Agent cards

```yaml
agent: pv-orchestrator
unit: product-vision
triggers:
  - schedule: "daily — open-decision digest"        # mirrored in [[product-vision-schedule]]
  - schedule: "monthly — agenda sync + provisional decay (L7)"
  - schedule: "quarterly — settled-decision integrity check"
  - topic: decision.register_changed                # publisher: NONE (gap — OPEN-DECISIONS.md is a file; nothing emits on edit)
consumes:
  - "the five team agenda-boards (Dataview output) — publisher: the team artifacts, EXIST"
  - "OPEN-DECISIONS.md + [[FORK-REGISTRY]] — publisher: [[decision-office-charter]], EXISTS"
  - "nf_a events sliced by this department's task types (ADR 0006/0008); emission EXISTS since P1, verdict coverage ~0 (ADR 0017)"
emits:
  - "[[product-vision-agenda-board]] rollup — the metric SET, five numbers, never an average (charter §Metrics)"
  - "the daily digest → consumers: [[decision-office-charter]] and the founder (loops L6 outputs_to)"
  - "supersede-ADR requests when a settled decision drifts → [[decision-office-charter]]"
  - "nf_a events (task_type: product_board_rollup)"
routing_class: extraction        # reading boards, counting ages, diffing a register
quality_bar: "every board row carries a value, the word 'unmeasured', or the word 'undefined' — ADR 0020. `supply.sku_dual_price_coverage_pct` has no denominator and is *undefined*, never 0%; four of five metric pairs are unmeasured and must read so"
autonomy:
  read: autonomous
  propose: autonomous            # digests, board rows, escalations — all PRs or vault notes
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: product-vision
escalates_to: "[[decision-office-charter]] for forks (PROD-F1, PROD-F2, PROD-F5 stay open); the founder for the board"
```

**The card's own hard rule.** `pv-orchestrator` **answers no fork.** PROD-F1 (team layer),
PROD-F2 (Vendor Finder boundary), PROD-F5 (Design's commissioning authority) are the
founder's calls; the agent's only permitted output on any of them is an aged register row.
The same rule covers [[AGENT_NATIVE_UI_DECISION]] §3: drift toward the rejected chat-surface
rewrite is **filed as a supersede request**, never adjudicated here.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `open-decision-digest` | T2 | Daily | Every open decision carries an owner, an age, and a named unblocker; ones missing any of the three are listed first | `teams/product.md` §6 minted five forks under IDs the register already held (OD-20…OD-23), and the collision survived until [[FORK-REGISTRY]] renumbered them to `PROD-Fn` — nothing was reading the register daily | NEW |
| `settled-decision-integrity-check` | T2 | Quarterly, or any charter/agenda edit naming a chat surface or adaptive layout | A verdict per settled decision: unchanged / drifted-with-diff-lines → supersede request. Never a silent pass | The 2026-08-24 division pass rejected a Self-Learning UX Optimizer team *because staffing it would relitigate [[AGENT_NATIVE_UI_DECISION]] §3 by staffing rather than by ADR* (`teams/product.md` §5.1) — caught by a human reading, not by a check | NEW |

Consumed, owned elsewhere: the four team-level skills delegated in
[[product-vision-schedule]] (`route-portfolio-verdict`, `action-allowlist-review`,
`inbound-gate-conformance`, `pos-input-audit`) live on the team stacks; the envelope and
registry are [[skills-charter]]'s.

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3 gate still applying.
- **Episodic** — nf_a `task_type: product_board_rollup`, plus read access to the five team
  task families. Needs `context.team` as a jsonb key so a per-team slice is one filter
  rather than a join this department invents for itself.
- **Semantic** — `memory/` beside this file, index `product-vision-MEMORY.md`. First facts
  are already known: the 24+13 overlap is 26 distinct routes, not 37
  ([[surface-portfolio-charter]] §Evidence); `askai.entry_point_count` = 4, not 3
  (`teams/product.md:226` miscited the Reports pill). `source`, `confidence`,
  `last_verified` per ADR 0034; every write lands as a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team charters
  and the 53KB `teams/product.md` are retrieval targets by `path:line`, never preloaded
  (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[product-vision-schedule]]: read the department's
NF-A slice and the five boards since the last run; write one fact per durable finding,
**failures first** — a metric that went from measured to unmeasured gets a fact naming the
mechanism, not "coverage dipped"; expire facts unverified for 90 days; propose skill
candidates. One PR; a run that changes nothing reports "no delta", never silence.

## 5. Async contract

Board rows, digests, supersede requests, memory PRs, NF-A events; loops with close_times in
[[product-vision-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `decision.register_changed` has no publisher | OPEN-DECISIONS.md is a file nothing emits on; the daily schedule bounds the blind spot at 24h |
| The digest's consumers are polled, not notified | Delivery is a vault PR; [[decision-office-charter]]'s own schedule must read it. Naming this beats pretending the digest pages anyone |
| Three of five team loops are `blocked` on named inputs | L3, L4, L5 ([[product-vision-loops]]) — the board must print their blockers beside the blanks, or it reports four green rows and one absence |

## 6. Evidence today

- **NEW — the orchestrator and both skills.** Nothing rolls these five metrics onto one
  board today; the agenda-board Dataview renders, it does not escalate.
- **PARTIAL — the episodic substrate.** NF-A emits since P1 (`model-client.service.ts:413`,
  charter correction 2026-08-25); verdict coverage is the open P3.0 gate (ADR 0029), so the
  rollup would today be mostly honest "unmeasured" rows — which is what ADR 0020 wants shown.
- **EXISTS — exactly one input.** `surface.unowned_surface_count` (24 + 13, [[PAGE_MAP]]:5,
  :104-132, :151-167) is the only measured metric in the department, which
  [[surface-portfolio-premortem]] M2 names as the trap, not the win.
