---
type: schedule
division: platform
department: engineering
team: procurement-vendor-network
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[procurement-vendor-network-charter]]", "[[procurement-vendor-network-loops]]", "[[engineering-schedule]]", "[[action-safety-the-human-gate-charter|action-safety-the-human-gate]]", "[[skills-charter]]"]
---

# Procurement & Vendor Network — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Daily** | Money-path exposure watch — L-PV-2 | Unguarded money-moving route count; unauthenticated write alerts |
| Daily | Recurring-order execution audit — every order `recurring_order_agent.py` placed, with its caller | Placed-order log with principal, or the absence of one |
| Weekly | Order-to-delivery reconciliation — L-PV-1 | Raw rate **and** no-touch rate, side by side |
| Weekly | Price-contract integrity — L-PV-3 | Lines missing a price snapshot; price changes between order and delivery |
| Weekly | Open credits and disputes review | Vendor disagreements with evidence attached, unresolved |
| Monthly | Spend-authority boundary — L-PV-4 | Enumerated spend-capable paths; threshold register |
| Monthly | Vendor portal surface review — L-PV-5 | Route count, auth coverage |
| Monthly | Vendor catalogue match quality — `supabase/migrations/20260811010000_vendor_catalogue_match.sql` | Match rate, unmatched line backlog |
| Quarterly | Distributor graph refresh — `supabase/migrations/20260807001452_search_distributors_rpc.sql`, `distributor-discovery` | Graph coverage and staleness |

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**None built yet.** Proposed, each tied to a scheduled job above:

| Proposed skill | Fires on | Why a skill rather than a script |
|---|---|---|
| `reconciliation-exception-triage` | An order line that fails to reconcile | Needs to reason about partial deliveries, substitutions, and unit conversions — then hand a human a decision, not make one |
| `vendor-price-dispute-packet` | Price mismatch between order line and receipt | Assembles order line, price observation history, and receipt into evidence; explicitly does not decide who is right |
| `spend-path-audit` | Monthly, or any PR touching `procurement/**` agents | Traces which code paths can reach an order placement, including through agent tool calls |

**Constraint on all three:** **no skill in this team may place, approve, or amend an
order.** A skill may prepare, evidence, and recommend. Committing spend is
[[action-safety-the-human-gate-charter|action-safety-the-human-gate]]'s to gate, and a skill that quietly acquires commit
authority is premortem M4 arriving through the side door — the same shape as the
`negotiation_playbook` agent that today only logs (`technology.md:41-42`).

Registry governance sits with [[skills-charter]] (Applied AI); this team authors and
retires its own skills within that registry.
