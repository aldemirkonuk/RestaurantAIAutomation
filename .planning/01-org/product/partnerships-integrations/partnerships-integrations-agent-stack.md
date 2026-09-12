---
type: agent-stack
division: product
department: partnerships-integrations
status: designed
updated: 2026-08-27
metrics: [pi.merchant_backed_providers, pi.verified_ingress_ratio, pi.live_counterparties, nf_a.task_success_rate]
links: ["[[partnerships-integrations-charter]]", "[[partnerships-integrations-schedule]]", "[[partnerships-integrations-loops]]", "[[partnerships-integrations-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[harness-runtime-charter]]", "[[action-safety-the-human-gate-charter]]"]
---

# Partnerships & Integrations — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> A department stack orchestrates **the unit**, not its teams' work. This one has an unusual
> job: three of its four counterparty classes are blocked on something no agent can produce —
> a merchant token, a signature, a distributor saying yes — so the department agent's whole
> value is keeping four zeroes *readable* rather than making them move. Mechanisms are
> referenced, never restated: harness → [[harness-runtime-charter]] (**OD-03 open**), model
> choice → [[model-routing-inference-economics-charter]], the mutation gate →
> [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `pi-bridge-board` | Roll the four teams' metrics onto one board as a **set**, re-verify every `path:line` this department has cited, and report days-since-touched for the four open forks that cut through it | NEW |

One row deliberately. The department owns no counterparty of its own; an agent here that
normalized a payload or drafted an outreach mail would be the duplication
[[partnerships-integrations-charter]] §"Honest note on the team count" warns about.

## 2. Agent cards

```yaml
agent: pi-bridge-board
unit: partnerships-integrations
triggers:
  - schedule: "weekly — bridge review + doc-drift sweep"        # [[partnerships-integrations-schedule]]
  - schedule: "monthly — open-fork staleness (OD-07, PROD-F2, PROD-F4, CM-F3)"
  - topic: registry.provider_status_changed                     # publisher: NONE (gap — the registry is a source file; nothing emits on merge)
consumes:
  - the four team agenda-boards (Dataview output)
  - "pos-provider.registry.ts — 27 entries, registrySummary() at :328 (read-only census)"
  - "[[OPEN-DECISIONS]] rows for OD-07, PROD-F2, PROD-F4, CM-F3 (commercial.md:631)"
  - "nf_a events for the one agent surface this department owns: catalogue-match proposals at the human gate"
emits:
  - "[[partnerships-integrations-agenda-board]] rollup — four metrics as a SET, never an average"
  - "doc-drift corrections as vault PRs against foundation/teams/product.md and [[ENDPOINTS]]"
  - "escalations into [[partnerships-integrations-questions]]"
  - "nf_a events (task_type: pi_board_rollup)"
routing_class: extraction        # reading boards, re-grepping citations, counting days
quality_bar: "every board cell carries a measured value or the words 'not emitted' (ADR 0020); pi.merchant_backed_providers is reported with the second half of its phrase intact — merchant-backed, not scaffolded"
autonomy:
  read: autonomous
  propose: autonomous            # board edits, corrections and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant; and this department names no outbound target — founder-deferred (charter §Non-goals 5)
memory: partnerships-integrations
escalates_to: "[[decision-office-charter]]"   # PROD-F2, PROD-F4 and CM-F3 are boundary disputes, not sibling arguments
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `doc-code-drift-check` | T3 | Weekly, and whenever a foundation doc is cited in a plan | Every `path:line` in the cited section is re-verified against the tree; failures are carried back to source in the same week (`pi.doc_corrections_carried`) | Three corrections, 2026-08-24: 27 providers not 30 (`product.md:658`); *"0 of 32 verify signatures"* false — 3 of 32 routes are ingress, 1 correct (`product.md:783`); vendor-portal already reclassified (`product.md:733-735` vs `ENDPOINTS.md:656`). All three are in [[partnerships-integrations-charter]] §Evidence | NEW |

Consumed, owned elsewhere: `ingress-route-audit` and `connector-trust-contract`
([[connector-platform-trust-schedule]]), `pos-registry-audit` ([[pos-bridge-schedule]]),
the envelope and registry ([[skills-charter]]).

**One row deleted rather than kept.** `canonical-shape-review` sits on
[[partnerships-integrations-schedule]] with *"Not yet fired"* against it. Under
[[skills-charter]] §3.3 a premortem is a trigger, not an instance, so it has no row here.
It stays on the schedule as a proposal; this stack does not claim it as a skill.

## 4. Memory

- **Procedural** — the §3 skill. Candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: pi_board_rollup` and `doc_drift_sweep`, plus read access
  to the four team task families. Needs `context.team` as a jsonb key so a per-team slice is
  one filter; **nothing in this department emits nf_a today** (§6).
- **Semantic** — `memory/` beside this file, index `partnerships-integrations-MEMORY.md`.
  Its founding facts are already known: the three doc corrections above; that the
  distributor-connectivity fork is **CM-F3**, not the CM-F6 the assignment brief named
  (`commercial.md:631` vs `:634`); and that `pi.merchant_backed_providers` has been 0 since
  the registry was written. Provenance frontmatter per ADR 0034; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team charters
  and the 27-entry registry are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly, mirrored in [[partnerships-integrations-schedule]]: read the
department's nf_a slice and the four boards since the last run; write one fact per durable
finding, **failures first** — a citation that stopped resolving becomes a fact naming the
mechanism ("the registry was edited without the doc"), not "a link broke"; expire facts
unverified for 90 days; emit skill candidates. One PR, and "no delta" is a stated outcome.

## 5. Async contract

Loops ([[partnerships-integrations-loops]] — `pi-merchant-pull`, `pi-ingress-verification`,
`pi-counterparty-unblocking`, `pi-open-fork-staleness`, `pi-canonical-shape-neutrality`,
`pi-doc-drift-repair`), nf_a events, vault PRs, skill candidates. Never a synchronous call.

| Gap | Why it is a gap |
|---|---|
| `registry.provider_status_changed` has no publisher | `pos-provider.registry.ts` is a TypeScript source file; a status change is a diff nobody announces. The monthly registry audit bounds the blind spot at 30 days |
| Escalation into [[partnerships-integrations-questions]] notifies nobody | An acceptable async path (vault PR), but [[decision-office-charter]] must poll it. Same shape as the fleet's dead subscription (`core/orchestrator.py:198-206`) |
| `nf_a.task_success_rate` has a publisher and no data | The catalogue-match gate exists and is guarded (`pos-hub.controller.ts:36, :178, :199`) but has never graded a real venue's proposal — the 2026-08-24 proof run left all 39 wine lines unresolved because the venue had no mappings (`POS-BRIDGE-AUDIT.md:558-568`) |
| Three of four metrics are moved by counterparties, not by us | `pi.merchant_backed_providers`, `pi.unblocking_agreements`, `pi.live_counterparties` all require someone outside the company to act. The board must therefore report attempts beside outcomes or the zeroes are unreadable — [[partner-alliance-development-charter]] §Metrics |

## 6. Evidence today

- **NEW — `pi-bridge-board` and its skill.** Nothing rolls these four metrics up today; the
  three doc corrections that justify the skill were produced by hand on 2026-08-24.
- **EXISTS — most of what it would measure.** The POS bridge is built and proven end to end:
  66 signed canonical checks through the live webhook moved satisfiable insight types from
  **8 (1.4%) to 386 (67.4%)** (`.planning/04-specs/POS-BRIDGE-AUDIT.md:535`, Appendix A
  `:522-568`), and referential integrity is now enforced in the database
  ([[0030-pos-mapping-inventory-integrity]], [[0015-pos-referential-integrity]]). The
  connector substrate is real and guarded (`ENDPOINTS.md:226-234`). See the team stacks.
- **NEW — the partnership function.** Zero outreach, zero agreements, zero recorded contact
  ([[partner-alliance-development-charter]] §Evidence). Graded NEW here too, deliberately.
- **PARTIAL — the episodic substrate.** The nf_a tables exist (ADR 0006/0008); no module in
  this department emits into them, so today the rollup would be a table of honest
  "not emitted" rows, which is what ADR 0020 wants shown.
