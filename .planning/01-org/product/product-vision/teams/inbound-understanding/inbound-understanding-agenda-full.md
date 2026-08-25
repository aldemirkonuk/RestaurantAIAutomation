---
type: agenda-full
division: product
department: product-vision
team: inbound-understanding
status: provisional
metrics: [inbound.proposal_accept_without_edit_rate, inbound.false_accept_count]
updated: 2026-08-24
links: ["[[inbound-understanding-charter]]", "[[inbound-understanding-premortem]]", "[[inbound-understanding-agenda-board]]", "[[inbound-understanding-directive]]", "[[inbound-understanding-loops]]", "[[inbound-understanding-schedule]]", "[[product-vision-agenda-full]]", "[[connector-platform-trust-charter]]", "[[ask-ai-charter]]"]
---

# Inbound Understanding — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Turn three separately-shipped modules into one guardrail contract, and get the honest
number readable. Three deliverables, in order:

1. **The guardrail contract v1** — one artifact defining: what confidence means and how it
   is computed, what the gate shows (lowest-confidence fields first), which approval
   primitive is used (`apps/api-gateway/src/one-tap-actions/`), what a proposal derived from
   an *unverified* payload looks like, and what happens on reject.
2. **The correction path** — join a downstream edit back to the proposal that created it.
   This is what makes `inbound.false_accept_count` exist. Without it, acceptance rate is a
   number that only goes up.
3. **Per-module, per-document-type baselines** — three rows, published together, with
   *unmeasured* shown as unmeasured rather than omitted.

| Module | Code today | Metric state |
|---|---|---|
| Email Watcher | `communications/gmail-watch.service.ts`, `common/orchestrator/inbound-email.controller.ts`; Phase 0 triage + shadow classification shipped | Unmeasured |
| Invoice / Receipt | `procurement/documents/` (17 files, `x12/`, `credit-ledger.ts`); `invoice-match.ts` + backtest | Unmeasured; a backtest exists but on tuned corpus |
| Order Watcher | `procurement/` + `recurring-orders.controller.ts` | Unmeasured; ⚠️ 6 unguarded routes ([[ENDPOINTS]]:428) |

## How

**Sequence: contract → correction path → baseline → threshold changes.** Changing a
threshold before the correction path exists is changing a number nobody can grade.

- **The contract is written against the three modules as they are**, not as they should be.
  Its first job is to *describe* the three gates that exist and name where they disagree.
  Disagreements found are the backlog.
- **Held-out vendor set.** The invoice backtest
  (`apps/api-gateway/src/procurement/invoice-match.backtest.spec.ts`) is extended with
  documents no threshold was tuned against. Premortem M1 is otherwise the forecast.
- **Deliberate sampling from day one.** A small random share of high-confidence proposals
  goes to full review regardless. This is the only read on false-accepts available before
  the correction path is mature, and it also measures reviewer rubber-stamping (M3).
- **State the unverified-input dependency in the contract** rather than assuming it away.
  A proposal from an unverified webhook is marked as such and is never eligible for the
  high-confidence fast path. That is enforceable here today and costs nothing.
- **Share the confirm primitive with [[ask-ai-charter]].** Two teams inventing two confirm
  cards is how the product ends up with three approval UXs by a different route.

## Why now

- **Three modules already ship independently with no shared standard.** Every week without
  the contract is another local threshold to reconcile later (premortem M2).
- **Phase 0 inbound-email intelligence has landed** (triage signals, shadow classification,
  durable notifications, conservative reply gate) on
  `feat/inbound-email-intelligence-phase0`. Shadow classification is exactly the phase where
  a gate standard is cheap to impose — before anything is promoted out of shadow.
- **The one-tap primitive already exists** and is already the house style. The contract is
  mostly *naming and enforcing* an existing pattern, not inventing one.
- **The input is unauthenticated right now.** 0 of 32 webhook routes verify signatures. Even
  if this team cannot fix it, an explicit dependency beats a silent assumption.

## Next steps

- [ ] Write guardrail contract v1 — describe the three existing gates, name every
      disagreement · [[inbound-understanding-directive]]
- [ ] Design the correction path (downstream edit → originating proposal) so
      `inbound.false_accept_count` becomes readable · [[inbound-understanding-loops]]
- [ ] Publish three baselines (or three written statements of why they cannot be read) ·
      [[inbound-understanding-agenda-board]]
- [ ] Extend `invoice-match.backtest.spec.ts` with a held-out vendor set
- [ ] Stand up deliberate sampling of high-confidence proposals
- [ ] Add the unverified-payload marking rule to the contract; escalate the 0-of-32
      signature figure at every close-time · [[connector-platform-trust-charter]]
- [ ] Agree one confirm primitive jointly with [[ask-ai-charter]] — one card, two callers
- [ ] Flag `recurring-orders`' 6 unguarded order-placing routes into OD-19 ·
      [[security-charter]]

## Questions for the founder

1. **What is a false accept, exactly?** A price corrected by $0.02 on a $400 invoice and a
   line item matched to the wrong SKU are both "accepted then corrected". If they count
   equally, the metric will be dominated by rounding. Proposal: count corrections that
   change a **quantity, a SKU identity, or a total by more than a stated threshold** — and
   the threshold is a founder call because it defines what we promise.
2. **Is deliberate sampling acceptable friction?** It asks a manager to fully review
   proposals the system was confident about. It is the only honest read on rubber-stamping
   before the correction path exists — but it costs the user time, on a product whose pitch
   is saving time.
3. **May a proposal from an unverified webhook be shown at all?** The strict answer is no,
   and the strict answer disables the email watcher today. The proposed answer is: shown,
   marked, and never fast-pathed. Confirm.
4. **Which module is v0?** All three are unmeasured and none has real volume
   (`procurement_orders` = 1). If the answer is "the one a real restaurant complains about
   first", that is a good answer — but it means this team waits, and the agenda should say
   so honestly rather than defaulting to invoices because invoices are tractable
   (premortem M5).
