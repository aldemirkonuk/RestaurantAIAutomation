---
type: premortem
division: commercial
department: finance-pricing
team: unit-economics-pricing
status: provisional
metrics: [fin.external_price_quotes_logged, fin.non_design_partner_restaurant_count, fin.cost_to_serve_per_restaurant_month]
updated: 2026-08-24
links: ["[[unit-economics-pricing-charter]]", "[[unit-economics-pricing-loops]]", "[[unit-economics-pricing-directive]]", "[[unit-economics-pricing-agenda-full]]", "[[finance-pricing-premortem]]", "[[inference-cost-charter]]", "[[design-partner-operations-charter]]", "[[strategy-fundraising-charter]]", "[[narrative-collateral-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[OPEN-DECISIONS]]"]
---

# Unit Economics & Pricing — Premortem

> Written at founding, before success is assumed.

A premortem for a **dormant** team is not a formality. A dormant team has two failure
modes a working team does not have — it can wake up too late, and it can wake up early by
accident — and both are more likely than any failure of analysis, because neither requires
anyone to do anything wrong.

## It is 2027-08. This team has failed. What happened?

Five mechanisms, most likely first.

---

### M1 — The anchor arrived before the model

`.planning/foundation/teams/commercial.md:321-323` names it: pricing gets set implicitly
by the first invoice the founder sends a friend, and that number anchors the company
before this team writes its first document. **Deferring the decision is not the same as
deferring the anchor.**

The 2027 version is worse than a friendly invoice, because a number is already loose.
OD-23's own text ([[OPEN-DECISIONS]]:27) describes `$20–50/mo` self-serve pricing as
**locked** — and no ADR records it. Seven ADRs exist in `.planning/decisions/` (0001–0007);
none concerns pricing (verified 2026-08-24). Under CLAUDE.md §0.1, a choice not written in
`.planning/decisions/` is open. So a price is simultaneously cited as settled and unrecorded
as a decision.

By 2027 that range has appeared in a deck ([[narrative-collateral-charter]]), in a YC
application ([[strategy-fundraising-charter]]), and on a landing page. When this team
finally wakes and finds that the unit economics do not support it, the number is not a
hypothesis any more — it is a commitment the company has made in public, several times,
without ever deciding it.

**Earliest observable signal.** The **first** document outside `OPEN-DECISIONS.md` citing
`$20–50` — or any monthly figure — with no link to a decision record. Also: any dollar
amount in an email to the design-partner restaurant.

**Counter-pressure.** The **price-quote register**, opened today, before there is a
pricing model. One file: every externally-quoted number, its date, its recipient, whether
it was framed as final. Metric `fin.external_price_quotes_logged`, swept weekly by L-UEP-2.
This does not stop anchoring — nothing does — but it converts an invisible process into a
list somebody can read, which is the difference between discovering the anchor and
inheriting it. And the team's first act on waking is to demand provenance: **either an ADR
exists, or the range is a draft and this team says so in writing.**

---

### M2 — Dormancy became disappearance

The team is chartered `new` with an explicit trigger — *the first restaurant that is not
the design partner, or the founder un-deferring pricing* (`commercial.md:313-316`). Nobody
argues with that. Nobody watches it either, because watching a trigger is nobody's default
behaviour and the team that would watch is the one that does not exist yet.

Fourteen months later a second restaurant has been onboarded for a quarter. Nobody
computed its cost to serve, nobody noticed the trigger fired, and the first person to ask
"what does an account cost us?" is an investor. The charter was correct the entire time
and did nothing, which is the specific way a trigger-gated unit fails.

**Earliest observable signal.** A restaurant row in the database that is not the design
partner, with no artifact under this team updated within one close-time. That is a query,
not a judgement.

**Counter-pressure.** **The trigger is a query, not a memory.** L-UEP-1 runs weekly:
count restaurants excluding the design partner; record the number *even when it is zero*.
A recorded zero proves the check ran; an absent check is indistinguishable from a zero
until it is far too late. The counter is `fin.non_design_partner_restaurant_count`, and it
appears on [[unit-economics-pricing-agenda-board]] whether or not anything happened.

Second-order: this loop also fires on the *other* half of the trigger. A founder
un-deferring pricing in conversation leaves no database row, so the weekly check includes
one question asked of the founder in writing.

---

### M3 — The one number was an undercount presented as a cost

Pre-trigger, this team publishes exactly one figure:
`fin.cost_to_serve_per_restaurant_month`, from `api_spend.restaurant_id`. It is computable
today, which is precisely the danger, because it is **systematically low** for three
verified reasons: `restaurant_id` is nullable and enrichment passes `None` by design
(`spend_logger.py:59`); the NestJS runtime writes no spend rows at all (0 grep hits in
`apps/api-gateway/src`); and infrastructure cost — `~$10-20/month`
(`.planning/PROJECT.md:136`) — is not in the ledger.

Somebody asks "what does a restaurant cost us?", receives a clean dollar figure, and puts
it in a margin calculation. The undercount is now a margin, the margin is now in a deck,
and nothing in the chain ever said "approximately".

**Earliest observable signal.** The cost-to-serve figure appearing anywhere **without its
coverage fraction attached** — a slide, a spreadsheet cell, a sentence in an email. Also:
the figure being used as a denominator or subtrahend by anyone at all.

**Counter-pressure.** **The number is one inseparable string**, never a bare figure:
*cost-to-serve ≥ $X, covering Y% of known model invocations, excluding infrastructure.*
And it is not published at all while `fin.metered_invocation_coverage_pct` is unknown —
which it is today, because [[inference-cost-charter]]'s callsite census has not been run.
This team's single pre-trigger number is therefore **gated on its sibling's first
assignment**, and saying so is more useful than publishing something early.

---

### M4 — The team wrote a pricing model anyway

The charter says propose nothing. Then somebody needs a slide for a fundraising
conversation, and the ask is reasonable and small: *just a rough tier table, purely
illustrative, obviously not final.* It gets built. It gets screenshotted. Six weeks later
it is the pricing page, and nobody can point to when it was decided — because it never
was.

This is not a hypothetical failure mode for this repo. It is exactly how `$20–50/mo`
became "locked" in OD-23 with no ADR behind it.

**Earliest observable signal.** Any tier, any rate, any per-seat or per-location unit
appearing in an artifact under
`01-org/commercial/finance-pricing/teams/unit-economics-pricing/`. First occurrence, not
the third.

**Counter-pressure.** Make the founder deferral **structural rather than polite**: a grep
guard over this team's directory, in the shape of the repo's existing invariant guards —
`scripts/check_no_direct_stock_writes.sh` and `scripts/check_no_guest_name_matching.sh`.
Cheap, mechanical, and it turns "we agreed not to" into "the check fails". Requests for a
price are **logged in the register and escalated to the founder**, never answered
([[unit-economics-pricing-directive]]). The refusal is the deliverable.

---

### M5 — The revenue target was answered instead of informed

OD-23 is open and it is loud: $20k MRR in 30 days, rated under 10% likely, with two
proposed alternatives. This team owns the pricing slot, so the pressure to have a view is
constant and it will feel like helpfulness rather than overreach. It writes a memo. The
memo is careful, well-reasoned, and takes a side. Because it is the only quantitative
document in the room, it becomes the decision — and a founder deferral has been resolved
by a team that was chartered not to resolve it.

The tell is that it would not feel like a violation at any point.

**Earliest observable signal.** Any artifact from this team containing a recommendation on
the target, the price range, or the choice between higher-ACV founder-led sales and
committed-deal counting. Not a fact about them — a **recommendation**.

**Counter-pressure.** The line is between **arithmetic** and **advocacy**, and it is
drawable. This team may state that $20k ÷ $50 = 400 restaurants; that the current
denominator is one, unconnected; that `$20–50` has no ADR; that `.planning/PROJECT.md:135`
says "No revenue pressure: Build right, not fast"; and that the caps at
`spend_tasks.py:24-27` would trip within hours at 400 accounts. It may not state which
option is better. Every OD-23 artifact ends with the sentence *this does not resolve
OD-23* — and [[decision-office-charter]], not this team, owns whether it closes.

---

## Cross-cutting counter-pressure

- **Three of five mechanisms are countered by things that cost nothing and can start
  today**: the register (M1), the weekly trigger query (M2), the grep guard (M4). A
  dormant team with three live counter-pressures is dormant on purpose; one with none is
  just absent.
- **M3 is gated on [[inference-cost-charter]]**, not on this team. The honest position is
  to say so rather than publish early.
- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] should attack
  the `$20–50` provenance gap hardest — it is a decision, which is its remit, and it is
  currently unattributed.
- **Anti-sprawl applies to this document.** Nothing revisited in 60 days is fiction
  (`foundation README §3.3, §6`) — and for a dormant team, a stale premortem is the most
  likely artifact in the vault.
