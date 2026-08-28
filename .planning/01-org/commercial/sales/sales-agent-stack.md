---
type: agent-stack
division: commercial
department: sales
status: designed
updated: 2026-08-27
metrics: [sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.design_partner_touch_streak, sales.qualified_conversation_rate, sales.sending_identity_isolated, nf_b.source_count]
links: ["[[sales-charter]]", "[[sales-schedule]]", "[[sales-loops]]", "[[sales-agenda-board]]", "[[sales-premortem]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[design-partner-operations-agent-stack]]", "[[outbound-engine-agent-stack]]", "[[action-safety-the-human-gate-charter]]", "[[media-brand-charter]]", "[[decision-office-charter]]"]
---

# Sales — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> One customer, no pipeline, no CRM, no price ([[sales-charter]] §Evidence today) — that
> shapes this card more than any mechanism does. Two rules govern every card in this
> department: **no agent may generate, enrich, scrape, or infer a target list**
> (founder-deferred, unassigned) and **no agent sends outbound mail** (FUTURES §8.1,
> `.planning/FUTURES.md:211`). Mechanisms are referenced, never restated: harness →
> [[harness-runtime-charter]] (**OD-03 open**), model → [[model-routing-inference-economics-charter]],
> gate → [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `sales-board-keeper` | Keep the department board true — DEP-06's state, the two team boards, and the requested-vs-landed split on every dollar figure that leaves Sales | NEW |

One row deliberately. One of the two teams is dormant by construction ([[sales-charter]]
§Two teams, honestly), so a department agent that did team work would be manufacturing
exactly the activity [[sales-premortem]] M5 names as the department's fifth failure mode.

## 2. Agent cards

```yaml
agent: sales-board-keeper
unit: sales
triggers:
  - schedule: "weekly (Mon) — connection check"          # [[sales-schedule]]
  - schedule: "monthly — credit reconciliation rollup"    # [[sales-schedule]]
  - schedule: "quarterly — claim audit"                   # [[sales-schedule]]
  - topic: dep06.state_changed        # publisher: NONE (gap — PROJECT.md:101 is a hand-edited checkbox)
consumes:
  - ".planning/PROJECT.md:101 (DEP-06) and :127 (the account) — publisher: the founder, by hand"
  - "[[design-partner-operations-agenda-board]] and [[outbound-engine-agenda-board]] (Dataview output)"
  - "[[sales-loops]] rows sales-connection-countdown … sales-outbound-calibration"
  - "the requested/landed credit split from [[design-partner-operations-agent-stack|dpo-account-steward]]"
  - "nf_b.source_count — publisher: NONE (gap — zero restaurants emit guest events; [[sales-charter]] §Metrics)"
emits:
  - "[[sales-agenda-board]] rollup — requested and landed printed as two numbers, never one"
  - "the claim allowlist input → [[media-brand-charter]] and [[outbound-engine-agent-stack|outbound-sentinel]]"
  - "escalations → [[sales-questions]] (SAL-Q prefix) and [[sales-agenda-full]] §Questions"
  - "nf_a events (task_type: sales_board_rollup)"
routing_class: extraction
quality_bar: "every dollar figure names the invoice its credit landed on, or prints as 'requested, not landed' (`.planning/YC_WEDGE_PLAN.md:31-33`); NONE (gap) — ADR 0017 has no grader for board claims"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm
memory: sales
escalates_to: "[[decision-office-charter]]"    # the 2026-11-24 fold-into-Growth review, and the CM-F3 distributor fork
```

**The card's own hard rules.** It never contacts the design partner (even there the contact
is the founder's), never assembles a list of restaurants for any purpose, never sets or
quotes a price ([[finance-pricing-charter]]), and may not close CM-F3 or the S2 dormancy
fork — it files them; the [[decision-office-charter]] rules.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `claim-provenance-check` | T2 | Any draft, board row, or slide carrying a dollar figure or a customer-outcome claim | Each figure traces to a landed credit on a named invoice, or is removed before the draft leaves review — **pulled, not footnoted** | Provenance rot is measurable in this repo *today*: `.planning/YC_WEDGE_PLAN.md:129` calls `invoice-match.ts` 256 lines (it is 406); the same document's `:233,:265` receiving citations are stale; and `.planning/foundation/teams/commercial.md:365-368` and [[design-partner-operations-charter]] disagree about the same two lines (`:401,:440` vs `:400,:438` — the charters are right, verified 2026-08-27) | NEW |

One row, not four. `design-partner-weekly` has no past instance at all — no cadence has ever
existed to decay — so README §3.3 deletes it rather than parking it. And **duplicate
ownership, named rather than resolved:** [[sales-schedule]] also claims
`credit-memo-reconcile` and `sending-identity-guard`, which
[[design-partner-operations-schedule]] and [[outbound-engine-schedule]] claim as well. Two
owners for one skill is [[skills-charter]]'s call, not this document's.

Consumed, owned elsewhere: `credit-memo-reconcile`, `toast-connection-verify`
([[design-partner-operations-agent-stack]]); `sending-identity-guard`
([[outbound-engine-agent-stack]]); the skill envelope ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skill; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: sales_board_rollup`, plus read access to
  `design_partner_touch`, `credit_reconcile`, `outbound_guard_run`. Needs `context.team` as
  a jsonb key so a per-team slice is one filter, and `context.claim_id` so a pulled claim
  traces back to the audit that pulled it.
- **Semantic** — `memory/` beside this file, index `sales-MEMORY.md`. Its first three files
  are already known: DEP-06's open date (`.planning/PROJECT.md:101`), the requested-vs-landed
  definition (`.planning/YC_WEDGE_PLAN.md:31-33`), and the CM-F3/CM-F6 fork-ID collision
  ([[sales-charter]] §Distributor connectivity). Frontmatter `source` / `confidence` /
  `last_verified` per ADR 0034; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team charters
  and the large planning corpora are retrieval targets by `path:line` (CLAUDE.md §2).

**Consolidation** — quarterly, timed to the claim audit rather than a calendar month,
because that is the only cadence at which this department currently produces facts worth
distilling. **Failures first:** every pulled claim becomes a fact naming the mechanism
("figure X cited a request, not a landing"), never the symptom. Expire facts unverified for
90 days — the citation drift below is exactly what expiry catches. One PR; "no delta" is
stated, never silent. [[sales-schedule]] does not carry this row yet: wave 2 may not edit
the eight existing artifacts (GENERATION_BRIEF §7.3), so the mirror is a named follow-up.

## 5. Async contract

Cross-unit interaction is loops ([[sales-loops]]), NF-A events, vault PRs, and skill
candidates only — never a synchronous call. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `dep06.state_changed` has no publisher | `PROJECT.md:101` is a hand-edited checkbox; the Monday schedule bounds the blind spot at 7 days |
| `nf_b.source_count` has no publisher | Zero restaurants emit guest events, and the only candidate is this department's account — a Sales checkbox blocks [[guest-experience-charter]] ([[sales-charter]] §Metrics) |
| `sales.unprompted_sessions_7d` has no producer | No product analytics key exists anywhere in `env.example` (187 lines); [[analytics-bi-charter]] must ship one event before L3 can close |
| Escalation to the Decision Office is a doc edit | Acceptable async path (a row in [[sales-questions]]), but nothing notifies — their schedule must poll |

## 6. Evidence today

- **NEW — the agent and the skill.** Nothing runs these; the department's roll-up grade is
  `new` and not a line of sales machinery exists in the repo ([[sales-charter]] §Evidence).
- **PARTIAL — the episodic substrate.** NF-A tables exist (ADR 0006/0008); Sales emits
  nothing into them, so the board would today be a table of honest "not emitted" rows —
  which is what ADR 0020 asks for.
- **EXISTS — the facts the board would carry**, all already cited by the charter: the
  account (`.planning/PROJECT.md:127`), the unchecked DEP-06 (`:101`), the connector
  (`apps/api-gateway/src/toast/`), the match (`invoice-match.ts`, 406 lines).
- **EXISTS — provenance rot as a live problem, re-measured 2026-08-27.** Beyond the §3 row,
  three of this department's risk citations have moved: `env.example` `EMAIL_BACKEND` is at
  `:172` (charters say `:165`), `SENDGRID_API_KEY` at `:174` (say `:167`), `settings.py`
  reads it at `:223` (says `:202`). Four more are listed in
  [[outbound-engine-agent-stack]] §6. Flagged, not silently reconciled — the eight existing
  artifacts are not this wave's to edit.
