---
type: scenario
id: S02
slug: vendor-delivery-arrives
class: happy-path
actors: [vendor-driver, receiver, manager, inventory-system, invoice-pipeline]
modules: ["[[inbound-understanding]]", "[[inventory-ledger]]", "[[procurement-vendor-network]]"]
signals: [delivery-photo, invoice-document, receiving-count, email, nf_a]
insights_class: [vendor-reliability, cogs-drift, price-variance, stockout-avoidance]
tier: undecided
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[inbound-understanding-charter]]", "[[inventory-ledger-charter]]"]
---

# S02 — Vendor delivery arrives

## 1. Trigger
A vendor truck arrives with an order. Bounded: from door-knock to stock updated and
invoice filed. Prior art is real: the receiving workspace exists
(`ReceivingWorkspace.tsx` — invoice quantity entry at `:401,440`), `/receiving/:orderId/door`
is a live route, and the invoice pipeline is partially built.

## 2. Actors
Driver (external, no account) · receiver (staff, often mid-service, phone in one hand) ·
manager (approves exceptions) · the invoice-understanding pipeline · inventory ledger.

## 3. Signals
- Receiving counts per line (accepted vs invoiced vs ordered)
- Invoice document (photo or PDF → parse; the AnyDoc bake-off OD-06 lives here)
- Delivery photo (damage/quality evidence)
- Timestamps: promised vs actual arrival → vendor-reliability series
- NF-A events from every agent touching the parse (cost, verdict — currently **not emitted**, the known L4 gap)

## 4. Queries the product must answer
- "Did we get what we ordered, at the price we agreed?" (three-way match: PO ↔ invoice ↔ received)
- "Is this vendor's price for X drifting?" — vs `vendor_price_observations`
- "What does this delivery do to today's stockout risk?"
- "Which lines are short, and do we chase credit?" — *dollars recovered means we **asked**, until a credit memo lands* (YC_WEDGE truth rule)

## 5. Outputs (in the moment)
- Receiving checklist pre-filled from the PO; discrepancy lines highlighted
- One-tap: accept / short / damaged per line — receiver has one thumb free
- On mismatch: a **drafted** credit-request email (never auto-sent; manager approves)

## 6. Insights the owner sees (the payoff)
- Vendor scorecard: on-time %, fill rate, price variance vs market
- COGS drift traced to specific deliveries — "your flour is up 9% in 6 weeks, here are the three invoices"
- Recovered-credit ledger: asked vs received, honestly labelled
- Stockout-risk delta: "this delivery cleared 4 of 6 weekend risk items"

## 7. Decisions
Human: accept/reject lines, approve credit chase, switch vendor.
System **proposes** (ask→propose→confirm→execute): credit-request draft, reorder of
shorted items, par-level adjustment after repeated shorts.

## 8. Failure modes
- Invoice parsed wrong → stock wrong → every downstream insight wrong (silent, compounding)
- Receiver skips counting under pressure → garbage signals honestly recorded
- Vendor substitutes a product → identity mismatch → duplicate catalogue entry (feeds [[catalogue-identity]])
- Credit chased, never reconciled → "recovered" overstates forever

## 9. Simulation & deploy gate
Synthetic engine generates: clean delivery · short delivery · substitution · price-jump ·
damaged-goods, against a synthetic PO book. Gate: invoice-pipeline changes ship only when
the five synthetic variants parse to correct ledger deltas.

## 10. Tier cut (proposed — OD-48)
Core: receiving checklist + basic mismatch flag. Plus: vendor scorecards + credit drafts.
Pro: price-variance intelligence across vendors + par-level proposals.

## 11. Evolution feedback
Where receivers override the parse tells us where the parser is weak; which insights the
owner opens after a delivery tells us which §6 stories earn the subscription.

**Flex points:** counting unit (case vs each), who receives (chef vs manager), credit
policy (chase always vs threshold), invoice timing (with truck vs emailed later).
