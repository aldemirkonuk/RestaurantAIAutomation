---
type: charter
division: product
department: partnerships-integrations
team: partner-alliance-development
status: new
metrics: [pi.unblocking_agreements, pi.time_to_first_response]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-charter]]"
  - "[[partner-alliance-development-premortem]]"
  - "[[partner-alliance-development-directive]]"
  - "[[partner-alliance-development-loops]]"
  - "[[pos-bridge-charter]]"
  - "[[consumer-app-points-economy-charter]]"
  - "[[design-partner-operations-charter]]"
  - "[[strategy-fundraising-charter]]"
  - "[[decision-office-charter]]"
  - "[[OPEN-DECISIONS]]"
---

# Partner & Alliance Development — Charter

## Mandate

Own the counterparties **engineering cannot unblock**: POS partner agreements, and the Beli
question. Where [[pos-bridge-charter]]'s constraint is a foreign API's semantics, this team's
constraint is a foreign organization's willingness. No normalizer, no matter how good, moves
a provider whose `authModel` is `partner_agreement`.

## Why this team is distinct

**Nine providers in the registry are blocked on a signature, not on code.** That is the
strongest distinctness argument anywhere in the Product division's team layer, and it is
enumerable rather than asserted:

`authModel: "partner_agreement"` — 9 occurrences in
`apps/api-gateway/src/pos-hub/pos-provider.registry.ts`:

| Line | Provider |
|---|---|
| `:119` | TouchBistro |
| `:171` | NCR Voyix Aloha |
| `:192` | PAR Brink |
| `:222` | HungerRush |
| `:232` | Qu Beyond |
| `:242` | POSitouch |
| `:254` | Focus POS |
| `:264` | Givex / Vexilor |
| `:298` | Vectron Omni |

The registry's own sequencing says it out loud: *"Tier 2+ — only when selling into chains
(**partner agreements needed**)"* (`:10`).

This is a different job, on a different clock, requiring a different skill, from every other
team in [[partnerships-integrations-charter]]. Merging it into POS Bridge would put a
signature-shaped problem in front of a team whose only tool is code.

## Boundaries — owned outright

- **POS partner agreements** — outreach, negotiation, and the signed artifact, for the nine
  blocked providers and any that join them.
- **The Beli exploration** — what a collaboration would and would not buy, at what cost, with
  what commitments. **The exploration, not the decision, and not the build.**
- **The Türkiye market motion** as a *partnership* problem — Protel/Simpra, ElektraWeb,
  Vectron, AKINSOFT Wolvox, SambaPOS (`pos-provider.registry.ts:268-322`). The registry
  itself notes for Wolvox: *"start with file export → csv_import bridge"* — i.e. some of these
  need a conversation, not an agreement.
- **The blocker ledger** — which provider is blocked on what, since when, and what was
  attempted.

## Explicit non-goals

1. **We do not decide OD-07.** *"Build the guest consumer experience independently vs explore
   collaboration"* is the founder's call (`OD-07, OPEN-DECISIONS.md:31`, unblocked by *"Founder call
   after guest MVP scope exists (FUTURES.md §7.5)"*). This team owns the exploration that
   makes the call **answerable**; [[consumer-app-points-economy-charter]] owns the build. Both
   are gated on the same call, and neither should be advanced as a way of pre-empting it.
2. **We do not name the first outbound targets.** Founder-deferred. This charter proposes no
   target list and no outreach sequence, deliberately.
3. **We do not set pricing or commercial terms.** Founder-deferred, with
   [[unit-economics-pricing-charter]] where it eventually lands.
4. **We do not write adapters.** A signed agreement hands off to [[pos-bridge-charter]].
5. **We do not sell to restaurants.** [[design-partner-operations-charter]] (Sales) owns the
   restaurant relationship. Our counterparties are POS vendors and platform partners.
6. **We do not own distributor relationships.** That is
   [[supplier-distributor-network-charter]] — and its Sales boundary is itself contested
   (CM-F3, `commercial.md:631`).

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `pi.unblocking_agreements` | Signed agreements that move a `partner_agreement` provider off blocked | **0** of 9 blocked |
| `pi.time_to_first_response` | Median days from first outreach to any human reply | **no data — no outreach has occurred** |

**Zero is an acceptable v0 result for the first metric. Pretending outreach happened is not.**
The second metric exists precisely so that a zero on the first can be read correctly: zero
agreements with 12 attempts and a 40-day median response is a market signal; zero agreements
with zero attempts is a staffing fact. The loop reports both together for that reason —
see [[partner-alliance-development-loops]].

## Evidence today — NEW (function) / EXISTS (blocker list)

**This grade differs from the evidence source, and the divergence is deliberate.**
`.planning/foundation/teams/product.md:695` grades this team **EXISTS** on the strength of the
blocker list. The list is real and verified — all nine `path:line` citations above were
grepped this session. But the list is evidence that the *problem* exists, not that the
*function* does.

Per the generation brief's honesty rule — *"If a team is NEW, say NEW plainly rather than
dressing it up"* — the honest grade is:

| Thing | Grade | Basis |
|---|---|---|
| The blocker list | **EXISTS** | 9 verified `authModel: "partner_agreement"` entries; registry sequencing at `:10` |
| The Türkiye motion as an enumerated set | **EXISTS** | `pos-provider.registry.ts:268-322`, 5 named providers |
| OD-07 as a live, documented fork | **EXISTS** | `OPEN-DECISIONS.md:31` |
| **The partnership function itself** | **NEW** | **Zero outreach. Zero agreements. Zero recorded contact with any counterparty. Nothing in the repo backs this activity.** |

Searched and not found this session: any partner agreement artifact, any outreach log, any
counterparty contact record, any partnership CRM surface. `procurement_conversations` exists
but threads *vendor* email, which is a different counterparty class owned by
[[supplier-distributor-network-charter]].

**Why this matters for planning.** Graded EXISTS, this team looks like it has momentum and
its zero metrics look like early-days noise. Graded NEW, its zero metrics are the expected
starting value and its first deliverable is obvious: **a written option memo on OD-07, and a
blocker ledger that makes "we did not try" distinguishable from "we tried and they said no."**

## Entry conditions

Not trigger-gated — this team can start today, and its first deliverable needs nobody's
permission. But two of its three workstreams are constrained:

- **Beli:** the exploration starts now; it produces an option memo, not a conversation
  commitment. Whether to *open* a conversation is OD-07 and is the founder's.
- **POS partner agreements:** unblocked, but the sequence is founder-deferred. This team can
  build the ledger and the outreach *machinery* without naming a first target.
- **Türkiye:** in-or-out is a scope question for the founder
  ([[partnerships-integrations-agenda-full]] Q5).
