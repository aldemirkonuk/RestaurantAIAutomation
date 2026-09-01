---
type: adr
id: 0054
title: Order capture and unit arithmetic
status: proposed
updated: 2026-09-01
links: [0011-pos-sale-volume-contract, 0015-pos-referential-integrity, 0020-no-fabricated-answers]
---

# 0054 — An order writes down what was ordered: line rows, honest units, and a price series

- **Status:** Proposed — the founder locks it
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** procurement_order_items, price_history, unit_type, bottles_per_unit, pack size, fail-closed, provenance, createOrder, recordDoorReceipt, capture
- **Links:** [[0011-pos-sale-volume-contract]] (the fail-closed rule this applies),
  [[0015-pos-referential-integrity]] (FKs before the first write),
  [[0020-no-fabricated-answers]] (a number nobody can justify is a fabrication),
  `supabase/migrations/20260901150000_order_line_capture_and_units.sql`,
  `apps/api-gateway/src/procurement/order-units.ts`,
  `scripts/check_order_capture_contract.py`

## Context

Measured against production on 2026-09-01: `procurement_orders` 2 rows,
`procurement_order_items` 1, `procurement_documents` 0, `price_history` 0.
There is no legacy data. Every row these tables will ever hold is written by the
code this ADR changes, which is what makes the change cheap and what makes now
the only cheap moment.

Four things were wrong, and three of them share one shape — a gap filled by a
confident guess, or a table the design depended on that nothing wrote.

> **Line anchors below cite the PRE-fix tree — `origin/main` at `9b5d416e`.**
> They are deliberately not repointed at the fixed file: this section describes
> code that no longer exists, and an anchor into the replacement would send a
> reader to the fix while claiming to show them the defect. Anchors into files
> this change did not touch (`document-intake.service.ts`, `mobile.service.ts`,
> `baseline:*`) are current and were re-derived at write time.

**1. Nothing wrote the line table.** `createOrder`
(`procurement.service.ts:215`) inserted a flat header and no
`procurement_order_items` row. `matchDocumentLines` returns `empty` when an order
has no lines (`documents/document-intake.service.ts:449`), so the entire invoice
line-matching engine — vendor SKU, description, quantity/price triangulation, and
the credit claims that come out of it — was unreachable code. No order carried a
`master_wine_id`, which is the only wine identity a vendor's paperwork can be
matched against; `inventory_id` names this restaurant's shelf slot, not the wine.

**2. The unit arithmetic was wrong at both ends, and the two ends fed each
other.** `bottlesTotal = dto.quantity` ignored `unit_type` entirely, so five
CASES booked five bottles. At the receiving door,
`normalizeUom(input.countedUom) ?? "case"` (`receiving.service.ts:109`) fell back
to the one unit that MULTIPLIES: 24 counted against a 12-pack booked 288 bottles
into live stock. The controller re-applied the same default one layer up
(`receiving.controller.ts:136`), where the service could not see it. And
`resolvePackSize` back-derives the pack size from `bottles_total / quantity` —
which, given defect 1, was always 1. The header was teaching the door that a case
holds one bottle.

`procurement_orders.unit_type` had no CHECK constraint while its siblings
`procurement_document_lines.uom` (`baseline:4401`) and
`procurement_receipt_events.counted_uom` (`baseline:4593`) both did. Its DEFAULT
was the PLURAL `'bottles'`; its readers compare against the SINGULAR
(`mobile/mobile.service.ts:296`: `order.unitType === "case"`). That comparison
could never be true and nothing said so.

**3. Provenance did not exist.** A manual order, an Ask-AI order
(`ask-ai/ask-ai.service.ts:919`) and a recurring materialisation
(`recurring-orders.service.ts:343`) produced byte-identical rows. "Did the AI
place this?" — the first question anyone asks of an autonomous ordering system,
and the one a customer asks in a dispute — had no answer anywhere in the schema.

**4. `price_history` had zero writers.** The table (`baseline:4274`) is keyed
exactly right — restaurant, master wine, provider, price, effective date, source,
order — carries `idx_price_history_wine_provider` on
`(master_wine_id, provider_id, effective_date DESC)`, and has foreign keys to all
three parents. Nothing in the repository inserted into it. No price series had
ever existed for any wine from any vendor, so nothing downstream of one could be
built at all.

## Options considered

### On the unit that cannot be resolved

1. **Keep a default, move it to `bottle`.** Cheapest diff, and it removes the
   multiplication. Rejected as the whole answer: it still silently answers a
   question nobody asked. A receiver who counts 24 CASES and whose client drops
   the unit gets 24 bottles booked, and the shortfall shows up months later as
   shrinkage indistinguishable from theft.
2. **Queue the unresolvable count, as ADR 0011 does for POS lines.** Rejected as
   the mechanism, adopted as the rule — see the Decision. A POS webhook arrives
   with no human present, which is why 0011 needs a durable queue. At the door a
   person is standing there holding a hand truck.
3. **Refuse, synchronously, naming the accepted vocabulary. Chosen.**
4. **Do nothing.** Costs: the next door receipt with a dropped unit books
   quantity x pack size into live stock, silently, and `verifyReceipt` then
   reports the phantom overage as a VENDOR discrepancy — a wrong claim against a
   real supplier, which is worse than an internal error.

### On a case order with no stated pack size

1. **Guess 12.** The industry default. Rejected: it books twelve times the
   delivery, and — via `resolvePackSize` — teaches the door the same lie.
2. **Guess 1.** Rejected: books a twelfth of it. Same class of error, opposite
   sign, and it is what the code did before.
3. **Require it, refuse without it. Chosen.** `CreateOrderDto` gains
   `bottlesPerUnit`; `recurring_orders` gains a `bottles_per_unit` column so a
   case-based schedule remains materialisable rather than merely refused.

### On labelling an order whose caller stated no source

1. **Default `'manual'`.** Rejected, and this is the sharp one: it would label
   an unlabelled AGENT path as a human decision. That is precisely the false
   claim the column exists to prevent, and it is the shape ADR 0020 forbids.
2. **NULL. Chosen.** Reads correctly as "placed before anyone recorded this",
   which is true of the two pre-existing production rows.

## Decision

**An order writes down what was ordered, and refuses rather than guessing when it
cannot.** Concretely:

| # | Rule |
|---|---|
| 1 | Every `createOrder` — insert path AND dedup/merge path — writes one `procurement_order_items` row carrying `master_wine_id`, the pack size, and the price tiers. Not best-effort: an order with no line is invisible to the matcher. |
| 2 | One pure function, `resolveOrderUnits` (`order-units.ts`), decides bottles for both ends. Unrecognised unit → refuse. Multiplying unit with no pack size → refuse. **Absent** unit → `bottle`. |
| 3 | `procurement_orders.unit_type` and `procurement_order_items.unit_type` are CHECK-constrained to the same seven singulars as `procurement_document_lines.uom`, and default to `'bottle'`. |
| 4 | The door refuses a unit it cannot read and books nothing. The controller stops injecting `?? "case"`. |
| 5 | `created_by`, `source` (manual\|ask_ai\|recurring\|retroactive\|agent), `recurring_order_id`. `source` is NULL when unstated, never `'manual'`. |
| 6 | `price_history` gets two writers: `order_confirmed` on `confirmDeal`, `receipt_verified` on `verifyReceipt` when an invoice actually existed. |
| 7 | `procurement_order_items` gets the four foreign keys it never had, before it has any rows. |
| 8 | An actor column references `public.users(user_id)`, never `auth.users(id)` — see the section below, which is the one that nearly took ordering down. |

**Rule 2's asymmetry is the load-bearing part and it is a deliberate refinement
of ADR 0011.** An absent unit resolving to `bottle` is not the guess 0011
forbids. `bottle` is the *identity* of this arithmetic: it cannot multiply, it is
the column's own declared default, and it is what every caller that omits the
field already means. The failure 0011 exists to prevent is specifically the
SILENT MULTIPLICATION, and the identity cannot produce one. An unrecognised unit
is different — `"bxs"` could mean anything, every answer is a fabrication, and it
is refused.

**Rule 4 diverges from 0011's mechanism, and the reason is the human.** 0011
queues because a POS webhook has no one to tell. The door has someone standing
there, so a 400 IS the queue: synchronous, and it asks a question a porter
answers in two seconds ("cases or bottles?"). The web door client already treats
4xx as a permanent refusal and surfaces it rather than retrying
(`apps/web/src/lib/doorOutbox.ts:63-67`).

**Rule 6's two sources are not interchangeable.** `order_confirmed` is what a
vendor AGREED to charge; `receipt_verified` is what they actually DID charge once
someone checked the invoice against the delivery, taken from
`match.effectiveUnitCost` — the same landed cost written onto the corrected
inventory lot, so the price series and the cost of goods agree by construction.
Collapsing them would make a vendor who quotes low and bills high look identical
to one who does neither. `receipt_verified` is written only when an invoice
existed: recording the PO price as an observation of what was charged would
manufacture a confirmation that never happened (ADR 0020).

## The trade-off, stated plainly

**Refusing costs something, and it is not nothing.** An order in cases now fails
until someone states the pack size, where before it silently succeeded with the
wrong number. A door receipt whose client drops the unit now fails where before
it booked stock. Both are new ways for a working screen to stop working.

The reason this is the right side is the same as 0011's: one failure mode is
visible and the other is not. A refusal happens in front of the person who can
fix it, in the second it happens. A twelvefold booking happens silently, is
indistinguishable from theft two months later, and cannot be claimed from the
vendor by then.

## `auth.users` vs `public.users` — a live footgun, recorded because it nearly shipped

**The first draft of this migration pointed `procurement_orders.created_by` at
`auth.users(id)`. It would have raised 23503 on every order creation the moment
it applied — a total outage of ordering, caused by the fix.**

The two tables are disjoint. Measured in production 2026-09-01: `auth.users` 5
rows, `public.users` 7 rows, **zero** `public.users` ids present in `auth.users`.
`auth.users` is Supabase-managed and this codebase does not populate it for its
own accounts. `public.users` has PK `user_id` (`users_pkey`, `baseline:8184`),
and that is what the JWT carries — `auth/strategies/jwt.strategy.ts:38` returns
`userId: user.user_id` after looking the row up, which is also why a correctly
targeted FK here can never fire spuriously.

**The precedent is schema-wide and it points the other way.** Counted across
`supabase/migrations`:

| target | FKs | includes |
|---|---|---|
| `public.users(user_id)` | **11** | every actor-attribution column on the app's own tables — `organization_invites.invited_by`, `organizations.owner_id`, `user_restaurant_access.deactivated_by` |
| `auth.users(id)` | 5 | `one_tap_actions` (×2), and the two `resolved_by` columns ADR 0015/OD-71 added |

The draft cited OD-71's census, `-> auth.users : SET NULL 2 of 2`. That figure is
**accurate for the tables that migration touched and is a biased sample of the
schema** — it counted only the FKs OD-71 itself was adding. Reusing a census
without re-deriving its scope is the failure, not the number.

Two things made it hard to catch and both are worth knowing:

- **The sibling actor columns on this very table — `approved_by`, `received_by`,
  `match_verified_by` — carry no foreign key at all**, so there was no in-table
  precedent to copy and an out-of-table one got reached for.
- **CI could not see it.** `Fresh database equals remote` applied the migration
  successfully, because a fresh database has no rows to violate a foreign key.
  Every guard was green. It was found by a human pre-flighting the migration
  against production before applying it.

Now held by the fourth check in `scripts/check_order_capture_contract.py`: any
FK to `auth.users` outside a shrink-only grandfather list fails the build, and a
grandfather entry that no longer matches a migration fails too — an exemption
that outlives what it excuses is a hole, not a record.

## Consequences

- **The migration must reach production before the code does.** `createOrder`
  writes `created_by`, `source` and `recurring_order_id`; until
  `20260901150000` is applied, PostgREST rejects the insert with PGRST204 and
  every order creation fails. Loudly — the controller now surfaces the real
  error rather than flattening it to a 500 — but it fails. `main` auto-deploys to
  Railway, so this is a real ordering hazard and not a theoretical one
  (`memory/production-deploy-verification`).
- The invoice line-matching engine becomes reachable for the first time. It has
  never run against a real order, so its first contact with production is ahead
  of us, not behind.
- `mobile.service.ts:296`'s `unitType === "case"` starts being able to be true.
  Anything else comparing against the plural `'bottles'` starts being able to be
  false. Both were previously constant.
- `createRetroactiveOrder` (`providers/providers.service.ts:951`,
  `providers/provider-intelligence.service.ts:617`) writes `source:
  'retroactive'` into a column that until now did not exist. This ADR makes one
  of the four things those two paths assume actually true. **They remain
  broken:** both also write `wine_name` and `actual_delivery`, which
  `procurement_orders` does not have, and omit NOT NULL columns. Out of scope
  here; raised separately.
- `recurring_orders` is missing `inventory_id`, `provider_id`, `wine_name`,
  `target_price` and `created_by` — every one of which `RecurringOrdersService`
  reads. That service cannot work against the real table. Pre-existing, unrelated
  to this change, and named here because this change touched the file and would
  otherwise look like it had reviewed it.
- `scripts/check_order_capture_contract.py` blocks all three regressions in CI
  and exits 2 when it cannot check. Proven: it exits 1 against pristine
  `origin/main`, naming five sites.
- **Revisit when** an order needs more than one line. `CreateOrderDto` carries
  exactly one `inventoryId`, so `upsertOrderLine` writes `line_no: 1` and clears
  any previous line. A multi-line PO is a real requirement and this is the
  structure it will grow out of, not a structure that will accommodate it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-01 | — | Created; awaiting founder lock |
