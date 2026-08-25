---
type: charter
division: commercial
department: finance-pricing
team: unit-economics-pricing
status: new
metrics: [fin.cost_to_serve_per_restaurant_month, fin.gross_margin_per_restaurant_month, fin.non_design_partner_restaurant_count, fin.external_price_quotes_logged]
updated: 2026-08-24
links: ["[[finance-pricing-charter]]", "[[unit-economics-pricing-premortem]]", "[[unit-economics-pricing-agenda-full]]", "[[unit-economics-pricing-agenda-board]]", "[[unit-economics-pricing-directive]]", "[[unit-economics-pricing-loops]]", "[[unit-economics-pricing-schedule]]", "[[inference-cost-charter]]", "[[strategy-fundraising-charter]]", "[[design-partner-operations-charter]]", "[[outbound-engine-charter]]", "[[conversion-funnel-charter]]", "[[EXTERNAL_CONNECTIONS]]", "[[PAGE_MAP]]", "[[OPEN-DECISIONS]]"]
---

# Unit Economics & Pricing — Charter

Division **Commercial** → Department [[growth-charter]] → Sub-layer
[[finance-pricing-charter]] → Team `unit-economics-pricing` (F2,
`.planning/foundation/teams/commercial.md:294-323`).

> ## ⏸ This team is chartered dormant and proposes no pricing model
>
> **Pricing is founder-deferred** (`commercial.md:296-298`). This charter is written for
> the team that *will* own the decision. It contains **no model, no tier, no rate, and no
> number** — and that is a testable property, not a promise: see
> [[unit-economics-pricing-directive]]'s grep guard.
>
> **Entry trigger** (explicit, matching the pattern used for NF-C at
> `foundation README §4.3`): **the first restaurant that is not the design partner, or the
> founder un-deferring pricing — whichever comes first** (`commercial.md:313-316`).
>
> **Until then this team publishes one number and nothing else**, plus two things that
> cost almost nothing and must exist before the trigger fires: a **trigger watch** and a
> **price-quote register**.

## Mandate

Own **what one restaurant costs to serve, what it is worth, and — when the founder
un-defers it — what it should be charged.** Cost to serve per account; gross margin per
account; acquisition cost attributable to Growth's own content effort; and ownership of
the pricing decision itself.

The mandate is real. The team is dormant. Both statements are true at once, and keeping
them true simultaneously is the entire craft here: a dormant team that quietly starts
producing pricing opinions has broken a founder deferral, and a dormant team that stops
watching its own trigger will not notice when it should have woken
([[unit-economics-pricing-premortem]] M1 and M2).

## Boundaries

Owns outright — **now**:

- **The entry-trigger watch.** A count of restaurants that are not the design partner.
  A trigger nobody queries is a trigger that fires unnoticed.
- **The price-quote register.** Every externally-quoted number, its date, its recipient,
  and whether it was framed as final. This exists *before* the pricing model because the
  anchor arrives before the model (`commercial.md:321-323`).
- **`fin.cost_to_serve_per_restaurant_month`** — the one number, published with its
  coverage fraction inseparably attached.

Owns outright — **after the trigger**:

- Gross margin per restaurant-month.
- Acquisition cost attributable to [[conversion-funnel-charter]]'s funnel and Growth's
  content effort.
- **The pricing decision**: model, tiers, units, and the recommendation the founder rules
  on.

## Distinct from its sibling because

Per-**account** grain rather than per-task, and its consumers are
[[strategy-fundraising-charter]] and Sales rather than the agent harness. The separation
is explicitly defensive: kept apart so that *"we have cost data"* is never mistaken for
*"we have unit economics"* (`commercial.md:302-304`). [[inference-cost-charter]] has live
data; this team has none. Merging them would let the first launder credibility onto the
second — [[finance-pricing-premortem]] D1.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| **Proposing a price, tier, or rate before the trigger** | The founder | Deferred. Enforced by guard, not by memory — [[unit-economics-pricing-directive]] |
| **The revenue target** (OD-23) | The founder | We supply arithmetic; we do not set or resolve the target |
| Cost per task, per model, per provider | [[inference-cost-charter]] | Per-account versus per-task. Different grain, different consumer |
| The fundraising model, the YC path | [[strategy-fundraising-charter]] *(Corporate)* | We supply the inputs; Strategy owns the model (`commercial.md:333`) |
| Billing, invoicing, dunning, collection | **Nobody — no revenue, no processor, no invoices** | Chartering RevOps today would be pure fiction (`commercial.md:331`) |
| The design-partner relationship and its recovery number | [[design-partner-operations-charter]] *(S1)* | They own the account; we own what it costs |
| Qualification and deal mechanics | [[outbound-engine-charter]] *(S2)* | Dormant on their side too, and for a different reason (no target list) |

## Metrics it moves

**Before the trigger — one number, and it is published with a caveat that cannot be
detached from it:**

`fin.cost_to_serve_per_restaurant_month`, computed from `api_spend.restaurant_id`. It is
**computable today and a systematic undercount**, for three verified reasons:

1. `restaurant_id` is **nullable** and enrichment tasks pass `None` by design —
   `services/agent-orchestrator/services/spend_logger.py:59` says so in the docstring.
   The restaurant+timestamp index is partial (`WHERE restaurant_id IS NOT NULL`,
   `supabase/migrations/20260805000000_baseline_from_production.sql:8555`), which is
   correct and also a reminder that the null population is real.
2. The **NestJS runtime writes nothing** — 0 grep hits for `api_spend` / `cost_usd` /
   `input_tokens` in `apps/api-gateway/src`. Any restaurant-attributable spend from those
   seven callsites is missing entirely.
3. **Infrastructure cost is not in the ledger at all** — `~$10-20/month` across Vercel,
   Supabase, Railway, CloudAMQP, Upstash (`.planning/PROJECT.md:136`) is a real cost to
   serve and appears nowhere in `api_spend`.

So the number is published as *cost-to-serve ≥ $X, covering Y% of known model
invocations, excluding infrastructure* — one string, never split
([[unit-economics-pricing-directive]]).

**After the trigger:** `fin.gross_margin_per_restaurant_month`.

**Always:** `fin.non_design_partner_restaurant_count` (currently **0**) and
`fin.external_price_quotes_logged` (currently **no register exists**).

## Evidence today

**NEW — deliberately dormant.** There is nothing to grade, and dressing that up would be
the failure this charter is written to prevent.

| What would be needed | State, verified 2026-08-24 |
|---|---|
| Revenue | **None** |
| A payment processor | **None** among the 50 runtime hosts ([[EXTERNAL_CONNECTIONS]]) |
| Billing code | **None** anywhere in the repo |
| A pricing surface | **No `/pricing` route** among the 51 web pages ([[PAGE_MAP]]) |
| More than one restaurant | **One** — a friend's Turkish restaurant in SF on Toast (`.planning/PROJECT.md:127`) — and it is **not connected**: `DEP-06` unchecked (`.planning/PROJECT.md:101`) |
| Per-restaurant cost attribution | **The one real ingredient** — `api_spend.restaurant_id` (`baseline:2236`), indexed at `:8555` |

**One inherited complication, stated because it bears directly on the mandate.** OD-23
([[OPEN-DECISIONS]]:27) describes `$20–50/mo` self-serve pricing as **locked**. There is
**no ADR in `.planning/decisions/` recording it** — seven ADRs exist (0001–0007) and none
concerns pricing. Under CLAUDE.md §0.1, a choice not written in `.planning/decisions/` is
open. This team therefore inherits a price with no provenance, cited as settled. **This
charter neither adopts nor rejects that range**; establishing its provenance is the first
item on [[unit-economics-pricing-agenda-full]].

## Entry trigger — restated, because it is the only thing that changes this document

> **The first restaurant that is not the design partner, or the founder un-deferring
> pricing, whichever comes first** (`commercial.md:313-316`).

When it fires: `status` moves from `new`, L-UEP-3 in [[unit-economics-pricing-loops]]
un-gates, and the first act is to demand the provenance of any price already circulating —
**not** to propose one.

Same treatment NF-C receives at `foundation README §4.3`: preserved as ambition, not
carried as weight.

## Open forks touching this team

- **OD-23** — $20k MRR in 30 days against $20–50/mo. Central question in
  [[finance-pricing-agenda-full]]. **Open. Not this team's to resolve.**
- **The premise of OD-23** — the `$20–50` range has no decision record, and its cited
  source document (`MASTER-PLAN-30-DAY-SPRINT-2026-08-24.md`) is **not present in the
  repo**.
- **CM-F4** — is Growth the right parent? This team's consumers are Strategy &
  Fundraising and Sales (`commercial.md:632`). Locked; instrumented, not argued.
