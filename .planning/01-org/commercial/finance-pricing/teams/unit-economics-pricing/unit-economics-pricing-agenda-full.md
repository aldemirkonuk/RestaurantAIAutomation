---
type: agenda-full
division: commercial
department: finance-pricing
team: unit-economics-pricing
status: provisional
metrics: [fin.cost_to_serve_per_restaurant_month, fin.non_design_partner_restaurant_count, fin.external_price_quotes_logged, fin.gross_margin_per_restaurant_month]
updated: 2026-08-24
links: ["[[unit-economics-pricing-charter]]", "[[unit-economics-pricing-premortem]]", "[[unit-economics-pricing-agenda-board]]", "[[unit-economics-pricing-directive]]", "[[unit-economics-pricing-loops]]", "[[unit-economics-pricing-schedule]]", "[[finance-pricing-agenda-full]]", "[[inference-cost-charter]]", "[[strategy-fundraising-charter]]", "[[design-partner-operations-charter]]", "[[decision-office-charter]]", "[[OPEN-DECISIONS]]"]
---

# Unit Economics & Pricing — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

> **⏸ Dormant, trigger-gated, and proposing no pricing model.** Everything below either
> runs before the trigger or waits behind it. Nothing below is a price.

## What

Three things pre-trigger. All three are cheap, all three run today, and all three exist
because [[unit-economics-pricing-premortem]] says a dormant team fails by *not doing the
small things* far more often than by getting the analysis wrong.

| # | Pre-trigger work | Counters | Runnable today? |
|---|---|---|---|
| 1 | **The trigger watch** — a weekly count of restaurants that are not the design partner, recorded even when zero | M2 (dormancy became disappearance) | ✅ yes — a count query |
| 2 | **The price-quote register** — every externally-quoted number, date, recipient, framing | M1 (the anchor arrives before the model) | ✅ yes — one file |
| 3 | **The provenance question on `$20–50/mo`** — ADR, or draft? | M1, M4 | ✅ yes — one question to the founder |

And one thing **gated on the sibling team**:

| 4 | **The one number** — `fin.cost_to_serve_per_restaurant_month` | M3 (an undercount presented as a cost) | ⛔ **blocked** on [[inference-cost-charter]]'s callsite census |

### Why the one number is blocked rather than published

It is computable today, which is exactly the risk. It is **systematically low** for three
verified reasons:

1. `api_spend.restaurant_id` is **nullable**, and enrichment tasks pass `None` by design —
   `services/agent-orchestrator/services/spend_logger.py:59`. The restaurant index is
   partial (`WHERE restaurant_id IS NOT NULL`,
   `supabase/migrations/20260805000000_baseline_from_production.sql:8555`).
2. The **NestJS runtime writes no spend rows at all** — 0 grep hits for `api_spend`,
   `cost_usd` or `input_tokens` across `apps/api-gateway/src`. Seven Anthropic callsites
   (`.planning/foundation/teams/intelligence.md:64-73`), none of them attributable to a
   restaurant.
3. **Infrastructure cost is not in the ledger** — `~$10-20/month` across Vercel, Supabase,
   Railway, CloudAMQP and Upstash (`.planning/PROJECT.md:136`) is a real cost to serve and
   appears nowhere in `api_spend`.

So the honest number is not a number; it is a lower bound with a coverage fraction. Until
`fin.metered_invocation_coverage_pct` is known — which requires F1's census — publishing
anything would be M3 happening on day one. **Saying "gated on the census" is more useful
than shipping a clean-looking figure.**

### The denominator problem, stated plainly

There is **one** restaurant — a friend's Turkish restaurant in SF on Toast
(`.planning/PROJECT.md:127`) — and `DEP-06: Toast API credentials configured` is still
**unchecked** (`.planning/PROJECT.md:101`). Cost to serve per restaurant-month, computed
today, would be a figure about an account that is not yet connected. That does not make it
worthless; it makes it a *baseline* rather than a *rate*, and it must be labelled as one.

## How

**Stay dormant deliberately, not passively.** The difference is three running mechanisms.

1. **Arm the trigger as a scheduled query.** Weekly. Record the count even when it is
   zero — a recorded zero proves the check ran, an absent check is indistinguishable from
   a zero until it is too late. Include one written question to the founder each cycle,
   because the *other* half of the trigger — the founder un-deferring pricing — leaves no
   database row.
2. **Open the register before there is anything to register.** It is one file. Its value
   is entirely in existing before the first quote, not after.
3. **Make the deferral structural.** A grep guard over this team's directory, in the shape
   of `scripts/check_no_direct_stock_writes.sh` and
   `scripts/check_no_guest_name_matching.sh`. "We agreed not to" becomes "the check fails"
   ([[unit-economics-pricing-directive]]).
4. **Answer requests with a refusal and a log entry.** The refusal is the deliverable
   (M4). Every request for a price is registered and escalated, never answered.
5. **Contribute arithmetic to OD-23, never advocacy.** The line is drawable and
   [[unit-economics-pricing-directive]] draws it.

## OD-23 — what this team contributes, and what it will not

**[[finance-pricing-agenda-full]] holds the full record.** This team's role in it is
narrow by design ([[unit-economics-pricing-premortem]] M5): supply arithmetic, refuse to
recommend.

**Arithmetic this team may state:**

- $20,000 ÷ $50 = **400** paying restaurants; ÷ $20 = **1,000**. In 30 days that is
  ~13 or ~33 net new paying accounts per day.
- The current denominator is **one**, and it is **not connected** (`DEP-06` unchecked).
- There is **no payment processor** among the 50 runtime hosts ([[EXTERNAL_CONNECTIONS]]),
  **no `/pricing` route** among the 51 web pages ([[PAGE_MAP]]), and no billing code.
- `.planning/PROJECT.md:135` states **"No revenue pressure: Build right, not fast"** and
  `:134` states the founder's capacity as **2-3 focused things per week**. Both are
  currently operative in writing alongside a 30-day revenue sprint.
- The provider caps — `$40` Anthropic / `$16` Google at `spend_tasks.py:24-27`, 80% of
  $50 / $20 hard caps, against a `~$10-20/month` deployment budget — were sized for a
  single-design-partner repo. At 400 accounts they would trip within hours, and **nobody
  has computed what 400 accounts cost**, because the one number that would say is blocked
  (above).
- **The `$20–50/mo` range has no decision record.** Seven ADRs exist (0001–0007); none
  concerns pricing.

**What this team will not state:** whether $20k in 30 days is the right target; whether
higher-ACV founder-led sales is better than self-serve; whether committed deals should be
counted instead of collected cash. Those are pricing and target decisions, both deferred.

> **This does not resolve OD-23.**

## Why now — for a team that is not starting work

- **The anchor is already moving.** `$20–50/mo` is being cited as locked. Every week it
  circulates unchallenged, un-deferring pricing becomes more ceremonial and less real.
- **The register is worth nothing retroactively.** Its entire value is being open before
  the first quote.
- **The trigger has one plausible near-term firing.** [[design-partner-operations-charter]]
  is working on connecting the first account; a second is not far behind if that works.
- **The sibling's first assignment gates this team's only number**, so saying so now puts
  the dependency in writing rather than discovering it when someone asks.

## Next steps

- [ ] **Ask the founder for the provenance of `$20–50/mo`** — ADR, or draft? (Q1)
- [ ] **Open the price-quote register** — one file, before any pricing model exists
- [ ] **Arm the entry-trigger query** as a weekly scheduled check; record zero as a value
- [ ] **Add the written founder question** to each weekly cycle, for the non-database half
      of the trigger
- [ ] **Propose the `no-price-proposed-guard`** to CI, modelled on the repo's existing
      grep guards
- [ ] **Record the blocking dependency** on [[inference-cost-charter]]'s callsite census
      in [[unit-economics-pricing-agenda-board]]
- [ ] **Publish the OD-23 arithmetic** to [[decision-office-charter]] with the
      no-resolution sentence attached
- [ ] **Flag the missing source document** — `MASTER-PLAN-30-DAY-SPRINT-2026-08-24.md` is
      cited by OD-23 and is **not present in the repo**

## Questions for the founder

1. **Is `$20–50/mo` a decision or a draft?** [[OPEN-DECISIONS]]:27 calls it locked; no ADR
   records it; CLAUDE.md §0.1 says an unwritten choice is open. This determines whether
   OD-23 is a question about a target or about both a target and a price.
2. **What wakes this team, precisely?** The charter says *first non-design-partner
   restaurant, or the founder un-deferring pricing*. Is a **signed but unbilled** account a
   trigger? A paid pilot? Ambiguity here is how M2 happens.
3. **Who may quote a number externally?** The register logs quotes, it does not authorize
   them. If the founder quotes a price in a sales conversation, should that be a logged
   event, a decision, or both?
4. **Which is stale — "No revenue pressure: Build right, not fast" (`PROJECT.md:135`), or
   the 30-day revenue sprint?** Both are currently written.
5. **Should the cap-raise rule stand?** [[inference-cost-loops]] L-IC-5 proposes that a
   provider cap raise requires a cost-to-serve figure from this team. That makes a dormant
   team's single number load-bearing. Accept, or let caps simply track spend?
