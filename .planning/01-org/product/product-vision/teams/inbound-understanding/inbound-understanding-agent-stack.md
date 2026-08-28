---
type: agent-stack
division: product
department: product-vision
team: inbound-understanding
status: designed
updated: 2026-08-27
metrics: [inbound.proposal_accept_without_edit_rate, inbound.false_accept_count, nf_a.doneability_verdict, nf_a.outcome]
links: ["[[inbound-understanding-charter]]", "[[inbound-understanding-schedule]]", "[[inbound-understanding-loops]]", "[[inbound-understanding-premortem]]", "[[0034-agent-stack-artifact]]", "[[product-vision-agent-stack]]", "[[action-safety-the-human-gate-agent-stack]]", "[[connector-platform-trust-charter]]", "[[skills-charter]]"]
---

# Inbound Understanding — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team owns the guardrail contract for three modules that already run, so its agent is
> an **auditor of the gate, never a participant in it**: it may not accept, edit, or send a
> proposal. Mechanisms stay elsewhere — the mutation gate →
> [[action-safety-the-human-gate-charter]], harness → [[harness-runtime-charter]]
> (**OD-03 open**), model choice → [[model-routing-inference-economics-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `inbound-gate-auditor` | Make acceptance honest — join downstream corrections back to the proposal that caused them, sample fast-path proposals into full review, and fail any diff that grows a second confidence threshold | NEW; the modules it audits are PARTIAL and running |

One row. The three modules (Email Watcher, Order Watcher, Invoice/Receipt Understanding)
share one failure mode — *a confident wrong extraction a human rubber-stamps* — so they need
one auditor against one contract, not three (charter §Why these three are one team).

## 2. Agent cards

```yaml
agent: inbound-gate-auditor
unit: inbound-understanding
triggers:
  - schedule: "weekly — false-accept sweep, sampling review, latency read, trust restatement"   # mirrored in [[inbound-understanding-schedule]]
  - schedule: "monthly — held-out backtest, corpus census"
  - topic: action_executed          # publisher: EXISTS — one-tap-actions.service.ts:267
  - topic: proposal.corrected       # publisher: NONE (gap — no correction path exists; see §5)
consumes:
  - "one_tap_actions rows incl. executed_at / executed_by (one-tap-actions.service.ts:245-246) — EXISTS"
  - "apps/api-gateway/src/procurement/documents/ — document-extractor.service.ts, line-matcher.ts, credit-ledger.ts, x12/"
  - "apps/api-gateway/src/communications/gmail-watch.service.ts and the Phase 0 triage signals + shadow classification (feat/inbound-email-intelligence-phase0)"
  - "invoice-match.backtest.spec.ts and its held-out extension — the department's only backtest"
  - "nf_a events for the inbound-responder callsite (one of 7 wrapped, model-client.service.ts:413)"
emits:
  - "inbound.false_accept_count + inbound.proposal_accept_without_edit_rate, published together → [[product-vision-agent-stack|pv-orchestrator]]'s board row"
  - "inbound.threshold_constants_outside_contract → the PR check on the diff that introduced them"
  - "integration.verified_signature_coverage restatement (0 of 32) → [[connector-platform-trust-charter]]"
  - "nf_a events (task_type: inbound_gate_audit)"
routing_class: extraction        # joining edits to proposals and counting constants; materiality classification is a rubric, see quality_bar
quality_bar: "acceptance is never published without its paired false-accept count (charter §Metrics); a document type with no correction path reads 'unmeasured', never 0. Verdict basis: NONE (gap) — the doneability half is ungraded for this task type ([[0017-doneability-verdicts-are-sidecar-claims]]), and closing it is P3.0's job (ADR 0029), not this team's"
autonomy:
  read: autonomous
  propose: autonomous            # findings, samples, and escalations land as PRs or review queues
  mutate_stock_money_outbound: confirm   # constant — and see the hard rule below
memory: inbound-understanding
escalates_to: "[[product-vision-charter]]; unauthenticated-input findings additionally to [[connector-platform-trust-charter]]"
```

**The card's own hard rule.** `inbound-gate-auditor` **never accepts, edits, rejects, or
sends a proposal, and never approves a one-tap action.** The house style is already
correct — vendor-reply AI drafts, one-tap approve, **never auto-send**
(`teams/product.md:92`, `:748-749`) — and an auditor that could approve would become the
rubber-stamp it exists to measure ([[inbound-understanding-premortem]] M3).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `inbound-gate-conformance` | T3 | Any diff under `procurement/documents/`, `communications/`, or `procurement/recurring-orders.controller.ts` | Zero confidence constants and zero approval components outside the shared contract; a violation names the file and the contract clause | Three inbound modules shipped independently — Phase 0 email intelligence carries its own *conservative reply gate*, `document-extractor.service.ts` its own extraction confidence — and nothing reconciles them | NEW |
| `false-accept-join` | T2 | Weekly, or on demand after a correction is reported | Every downstream edit in the window is either joined to an originating proposal or explicitly marked human-origin | `credit-ledger.ts` exists, so credit memos are modelled — the case where a wrong extraction is silently compensated is precisely the one nobody currently detects | NEW |
| `document-corpus-census` | T1 | Monthly, or when a new vendor's first document arrives | A table of vendor → format → volume → held-out membership | `invoice-match.backtest.spec.ts` runs against the corpus it was tuned on, and nobody can state how many distinct formats that is ([[inbound-understanding-premortem]] M1) | NEW |
| `proposal-explainer` | T2 | A proposal is generated | The proposal surfaces its three lowest-confidence fields **before** its summary | The one-tap approve pattern already ships (`apps/api-gateway/src/one-tap-actions/`); the missing half is showing the reviewer what to doubt | NEW |

Consumed, owned elsewhere: signature verification ([[connector-platform-trust-charter]]);
the confirm primitive's safety metrics ([[action-safety-the-human-gate-agent-stack]]); the
extraction model itself ([[research-math-charter]] / [[ai-orchestration-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3 gate still applying.
- **Episodic** — nf_a `task_type: inbound_gate_audit`, plus read access to the
  `inbound-responder` and `document_extraction` families. Needs `context.document_type` and
  `context.module` as jsonb keys: per-module, per-document-type acceptance is the charter's
  stated grain, and without those keys every weekly read becomes a join this team invents.
- **Semantic** — `memory/` beside this file, index `inbound-understanding-MEMORY.md`. First
  facts, all already established: the three independent gates and where each threshold lives;
  `procurement_orders` = 1, so weekly sweeps read empty by arithmetic, not by health; 0 of 32
  webhook routes verify signatures. A false accept becomes a fact naming the extraction
  mechanism, never "one bad invoice". `source`, `confidence`, `last_verified` per ADR 0034;
  every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the guardrail contract
  once it exists. The 17 files under `procurement/documents/` are retrieved by `path:line`.

**Consolidation** — monthly, mirrored in [[inbound-understanding-schedule]]: read the audit
slice, **failures first** — every false accept becomes a fact naming the mechanism (a format
the extractor has never seen, a field the reviewer never checks), and an approval latency
shorter than the document takes to read becomes a fact about the *reviewer*, not the model;
expire facts unverified for 90 days; propose candidates. One PR; "no delta" stated when true.

## 5. Async contract

Board rows, PR checks, review queues, NF-A events; loops with close_times in
[[inbound-understanding-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `proposal.corrected` has no publisher | There is **no correction path**, so `inbound.false_accept_count` is unmeasured, never 0 — and building that path is the loop's first turn ([[inbound-understanding-loops]] L2) |
| This team's entire input is unauthenticated | The inbound-email webhook is one of **32** public webhook routes and **0 of 32** verify signatures (`teams/product.md:779-783`). Not ours to fix, ours to keep loud — hence the weekly restatement, which is the whole mitigation for premortem M4 |
| `recurring-orders` has 6 unguarded routes that can place real orders | [[ENDPOINTS]]:428, co-owned with [[security-charter]] under **OD-19 — open, not resolved here**. The auditor reports it; it does not patch it |
| Weekly sweeps will run empty at today's volume | `procurement_orders` = 1. Suspend with the named unblocker (*first restaurant with weekly inbound volume*) rather than run into fiction ([[inbound-understanding-schedule]] anti-sprawl) |

## 6. Evidence today

- **PARTIAL — the modules.** Email Watcher (`gmail-watch.service.ts`,
  `inbound-email.controller.ts`, [[ENDPOINTS]]:120-124) with Phase 0 **shipped** — triage
  signals, shadow classification, durable notifications, conservative reply gate;
  Invoice/Receipt (`procurement/documents/`, 17 files, plus `invoice-match.ts` and its
  backtest spec); Order Watcher (`procurement/`, `recurring-orders.controller.ts`).
- **EXISTS — the human-gate primitive.** `apps/api-gateway/src/one-tap-actions/` (controller,
  service, spec, module, dto) with `executed_at`/`executed_by` at `:245-246` and
  `action_executed` at `:267` — the auditor's one publisher that already fires.
- **NEW — the auditor, all four skills, the shared guardrail contract, the correction path,
  and every per-module acceptance number.** Three modules run; nothing measures them
  against one bar.
