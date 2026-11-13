---
type: adr
id: 0011
title: POS sale-volume contract
status: locked
updated: 2026-11-07
links: []
---

# 0011 — A POS sale removes a volume, not a unit: `sale_volume_ml` and fail-closed depletion

- **Status:** Locked
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder)
- **Keywords:** pos, sale_unit, sale_volume_ml, pos_item_mappings, pos_unresolved_lines, depletion, fail-closed, record_glass_pour, B36, B19, B20
- **Links:** [[0008-nf-column-contract]] (tone/format), `supabase/migrations/20260825120000_pos_sale_volume_contract.sql`, `apps/api-gateway/src/pos-hub/pos-hub.service.ts`

## Context

`pos_item_mappings.sale_unit` has been a two-value enum — `glass` or `bottle` —
since it was migrated off `toast_item_mappings`
(`20260805132000_counting_catalog_and_correlation_columns.sql:33-40`). The POS
depletion path read it as `it.sale_unit ?? "bottle"`
(`pos-hub.service.ts:377`, pre-fix).

On 2026-08-24 we found that `upsertItemMapping` — the **only** writer of the
column — never included it in the row it upserted, so every mapping it ever
created carried `sale_unit = null` and took the fallback. Writing the column
fixed mappings created *from now on*.

**The live exposure today is zero rows, and the first draft of this ADR got that
wrong.** It argued from "92 production mappings would over-deplete." They would
not: all 92 share one `restaurant_id` (`12823c23-…`) that appears in **no** row
of `restaurants`, and all 92 `inventory_id`s resolve to zero
`restaurant_inventory` rows. `loadMappings` filters `.eq("restaurant_id", …)`,
so no live restaurant can select them. They are orphaned rows from a deleted
tenant. The correction is recorded rather than quietly edited out, because an
ADR that argues from a false premise is worse than no ADR — it launders a guess
into a decision.

**The real argument is structural, and it is stronger.** `?? "bottle"` is a
silent 5× guess on *any* mapping that lacks a unit, and `pos_item_mappings` has
**no foreign key constraints at all** — nothing prevented the orphan state and
nothing prevents a live restaurant reaching the same one. This is the same shape
as the three defects fixed earlier the same day: harmless only because the table
is effectively empty, and therefore exactly the right moment to fix it.

Fixing the write exposed the real defect, which is the model. A restaurant does
not sell "a glass" or "a bottle". It sells a 150ml pour, a 60ml taster, a 375ml
half bottle, a 500ml carafe, a 1500ml magnum, five 40ml pours in a flight. The
founder's call, verbatim: *"i don't want to keep bottle default, I want to make
it convertible for each type of bottle measurement and glass per occasion or
other."*

The database layer was already convertible and had been from the beginning:
`record_glass_pour(p_inventory_id, p_pours, p_pour_ml, ...)` takes an arbitrary
pour volume in millilitres
(`20260805000000_baseline_from_production.sql:1132`). Only the application layer
was binary. Note what this does **not** mean: production holds one shape of row
— 750ml bottle, 150ml pour, on every single one — so **the existing data cannot
validate a multi-format design**. The RPC's capability is evidence; the data is
not.

## Options considered

1. **Keep the enum, widen it to a longer list** (`glass | bottle | half_bottle |
   magnum | carafe`). Cheapest diff. Rejected: it moves the cliff rather than
   removing it. Every new format a restaurant invents needs a migration, a code
   change and a deploy, and the arithmetic still lives in a `switch` that has to
   guess a volume for each label. It also does not answer "a 90ml tasting pour",
   which is a volume, not a category.
2. **`sale_volume_ml` as the truth, `sale_unit` as an open reporting label —
   with the `?? "bottle"` default kept** as the last resort. Rejected: the
   default is the bug. Keeping it means any unsized mapping keeps over-depleting
   by 5x after this change lands, and — worse — the queue never fills, so the
   one signal that would tell anyone the model is incomplete never appears.
3. **`sale_volume_ml` as the truth, open label, and fail closed** — an
   unresolvable line is queued in `pos_unresolved_lines` and depletes nothing.
   **Chosen.**
4. **Do nothing.** Costs: the next mapping created without a unit books 750ml
   per glass, silently. Nothing has been corrupted so far for two reasons that
   both expire — `pos_checks` held 0 rows until 2026-08-24, and the only
   mappings that exist belong to a deleted tenant. Neither is a property of the
   design; both are properties of the system being empty.

## Decision

**Option 3.** `pos_item_mappings.sale_volume_ml numeric` is the truth: the
millilitres one sale of this POS item removes. `sale_unit` becomes an open human
label (`glass`, `bottle`, `half_bottle`, `magnum`, `carafe`, `taster`,
`flight`, …) for reporting and UI, never for arithmetic.

Resolution order in `applyStockEffects`, in full:

| # | Condition | Result |
|---|---|---|
| 1 | `sale_volume_ml` present and plausible | that volume |
| 1a | …and it equals the row's `bottle_size_ml` | **whole-bottle move** (`apply_stock_movement`) |
| 1b | …and it exceeds the container it pours from | **queue** — see below |
| 2 | `sale_unit` = `bottle` | whole-bottle move; the inventory row is not consulted |
| 3 | `sale_unit` = `glass` and the row has `pour_size_ml` | that pour size, via `p_pour_ml` |
| 4 | anything else | **queue the line, deplete nothing** |

Volume-based depletion routes through `record_glass_pour`'s existing
`p_pour_ml`, passed **explicitly** rather than as `null`, so the millilitres
that move stock and the millilitres written to `wine_consumption_log` are the
same number, decided in one place. Whole-bottle sales stay on
`apply_stock_movement`, because that is what such a sale actually is.

Two guards were added beyond the brief, and both are load-bearing:

- **1b, a pour larger than its container.** `record_glass_pour` opens a bottle
  and subtracts the pour from it (`baseline:1170`). A 1500ml pour against a
  750ml row sets `inventory_lots.open_bottle_ml` to **−750** — it does not
  raise. That is silent lot corruption, a different and worse failure than
  under-depletion, so it queues rather than fails closed *into* the RPC.
  **[Corrected 2026-10-04, in place, by [[0285-a-short-pour-opens-the-next-bottle]].**
  It did raise. The CHECK `inventory_lots_open_bottle_ml_check`
  (`open_bottle_ml >= 0`, `baseline:3189`) refused the write as 23514. That
  was measured on a PGlite build of every migration at `8c673db4b`: a 1000ml
  pour against two 750ml bottles failed, and nothing moved. Wherever that
  CHECK held, the CHECK would have refused such a write; no production rows
  were read to confirm it. The queue still stands, because such a line
  usually means the mapping points at the wrong row. Since migration
  `a_short_pour_opens_the_next_bottle`, the RPC opens as many bottles as a
  larger pour needs. The POS hub queues such a line, so it reaches the RPC
  from the manual route, or from Toast only when an item's `pour_size_ml`
  exceeds its `bottle_size_ml`.**]**
- **A plausibility band of 10–30 000 ml on `sale_volume_ml`.** A bare `> 0`
  check accepts `1.5` from someone who meant 1.5 **litres**, and the item then
  pours 1.5ml per sale forever — the same silent-wrong-number failure this ADR
  exists to end, pointed the other way.

`sale_unit` still rejects malformed input — non-string, empty, whitespace-only,
over 32 characters. A blank label is a caller bug, not a word anyone chose, and
it would render as "mapped" in the review UI while meaning nothing.

### `pos_unresolved_lines` gets a `reason`, and it is not optional

The brief asked whether queueing an already-mapped line fits that table's
contract. **It does not, as the table stood.** The queue now receives two
populations that need different questions asked of a human:

- `unmapped` — no mapping row resolves this line to stock. *"What wine is this?"*
- `no_sale_volume` — mapped, inventory row known, but nothing says how much one
  sale removes. *"How much does one of these pour?"*

Without the discriminator the reviewer gets one undifferentiated pile, and the
second population reads as a mapping failure it is not — at precisely the moment
the queue fills with every unsized mapping at once. So the migration adds `reason` (NOT NULL
DEFAULT `'unmapped'`, which is correct for every row written before today, that
having been the only reason then) and `mapped_inventory_id` (what the pipeline
already **knew**, as distinct from `resolved_inventory_id`, which is what a
human **decided**).

The partial unique dedupe index gains `reason`. Otherwise a line still open as
`unmapped` would swallow the `no_sale_volume` insert that follows once someone
maps it but sets no volume — the newer, more actionable problem suppressed by
the older one, and silently, since the service treats `23505` here as "already
queued".

### No backfill

No backfill. Existing rows stay null. Backfilling `bottle` is the defect; backfilling `glass`
is the same guess pointed the other way. They queue.

### The name parser is deliberately not used

`normalizeDescription()` (`procurement/documents/line-matcher.ts:108`) already
parses `"1.5L magnum"` → `formatMl: 1500`, and `catalog-matcher.service.ts`
already imports it, so auto-filling `sale_volume_ml` from the item name or the
POS catalog's `size_ml` looks free. It is not. **A by-the-glass SKU carries the
size of the bottle it is poured FROM** — a "Glass of Barolo" line in a POS
catalog is `size_ml: 750`. Auto-filling from it would rebuild the bottle default
under a new name, and this time it would look deliberate. The parser's correct
home is the review surface, as a *suggestion shown to a human*, never an
automatic write. This is decision B36 ("sale unit is never inferred from the
item name") extended to volume.

## The trade-off, stated plainly

**Fail-closed under-depletes. That is not free.**

Before: every unresolved glass sale removed 750ml when it should have removed
150 — **over-depletion by 5x, silent**, with stock reading low, par alerts
firing on phantom shortfalls, and reorder points, XYZ classification and the
Holt-Winters forecast all fed a demand series inflated fivefold. Nothing in the
product says this is happening. There is no artifact to inspect and no way to
reconstruct the truth after the fact.

After: an unresolved sale removes **nothing**. Stock reads **high** — the
restaurant believes it has wine it has already sold — until someone works the
queue. Every skipped line leaves a row naming the check, the item, the quantity
and the reason, so the error is bounded, attributable and reversible. But the
queue is not self-clearing, and a restaurant that ignores it accumulates
invisible shrinkage exactly as if the depletion had never been wired up.

The reason this is the right side of the trade is not that under-depletion is
harmless. It is that **one failure mode is visible and the other is not.**
A wrong number that nobody can see is worse than a missing number that everybody
can, and 5x is not a rounding error.

## Consequences

- **The queue will spike on the first real POS connection.** All 92 mappings
  land in it. That is the design working, not a regression, and the review
  surface being built alongside this change is what drains it. Anyone reading
  the queue depth as a health metric needs to know this first.
- `sale_unit` is no longer safe to `switch` on. Two labels carry a derivation;
  every other value is a word. Code that assumes otherwise is wrong.
- `wine_consumption_log.consumption_type` stays `'bottle' | 'glass'` — it is
  `varchar(10)` with a CHECK on exactly those (`baseline:6394`) and
  `wine_consumption_summary` branches on it. It now records the **depletion
  mode**, not the label: a 500ml carafe is a `glass` row of `volume_ml: 500`.
  Volume readers sum `volume_ml` and are exact; the two count columns
  (`bottles_consumed` / `glasses_consumed`) become mode counts. Widening that
  CHECK is a separate decision with a view rewrite attached.
- **The Toast door is not fixed** and still carries `saleUnit ?? "bottle"`
  (`toast.service.ts:502`). It is a second live depletion path with the same
  defect. Not touched here because closing it changes behaviour for a live
  integration, which is the founder's call — raised as **OD-66**.
  `resolveSaleVolume()` is exported and pure so that door can adopt this
  contract in one line rather than growing a second implementation of it.
- **B19 is left in place and it is wrong.** A partial-volume void returns `qty`
  **whole bottles**, because `record_glass_pour` has no reversal mode — voiding
  5 glasses returns 5 bottles, the same 5x error as the bottle default, in the
  opposite direction. It is a recorded decision, so superseding it is the
  founder's call, not this change's. Flagged in code at the call site.
- **`pos_unresolved_lines.external_item_id` is nullable**, and a UNIQUE index
  treats NULLs as distinct — so a POS that sends no item id piles up one queue
  row per replay. Pre-existing; fixing it means deciding what identity a
  name-only line has.
- One batched inventory read per check replaces the per-line `maybeSingle()` the
  consumption mirror used to issue on its own — a 20-line check costs one query
  rather than twenty.
- **Revisit if:** the queue is not being worked (under-depletion then compounds
  and the trade above stops holding), or a restaurant needs a sale that spans
  more than one container — 2×750ml as a single 1500ml line — which this design
  queues rather than serves.

## Amended 2026-11-07: a saved mapping replays its item's queue (POS-2)

The session's call under the founder's 2026-11-07 /goal ("Do not ask me any questions I approve you decide them all"); not put to the founder. Built on PR #804 (`fix/pos-unresolved-lines-replay-on-mapping`) and PR #806 (the catalog approve and the sale-unit review return it). Entry: `../tech-debt.d/2026-11-07-fix-pos-unresolved-lines-replay-on-mapping.md`.

**What was true.** *The trade-off, stated plainly* above rests on the queue being worked, and the queue could not heal stock. On origin/main at `259feea3f` nothing writes `pos_unresolved_lines.resolved`: `git grep` over `apps`, `services` and `supabase/functions` for a `resolved: true` or `resolved_at` write returns nothing. Mapping an item fixed the checks after it and moved none of the stock its earlier sales should have, so "reversible" held for the record and not for the stock. QA round 5 filed it as POS-2.

**Decision.** `upsertItemMapping` writes every mapping (POST /pos-hub/mappings, the catalog matcher's approve, the sale-unit review). After its upsert it replays the item's open queue rows through the live depletion path. Its reply carries `past_sales`: a count per outcome and one sentence in the house's words. The calls, each with what it beat:

1. **Replay from the stored check, not the queue row.** The line is rebuilt from `pos_checks.items` at its own position, so it carries the live key `pos:{source}:{check}:{item}:{lineNo}`, and a replayed line, a second save and a till re-sending the check all deplete once. *Rejected:* the queue row's `qty`. The dedupe index keeps one row per (check, item, reason), so two lines of one wine on a check share a row, and a row has no line position to key on.
2. **Only the rows the live path would now book under this mapping.** A fetched row is kept only when the lookup `resolveWine` uses (`findMapping`) sends its name and item id to the mapping just saved. *Rejected:* every row sharing the item id or the name. Tills often give the glass SKU and the bottle SKU one name; the other SKU's row answers to its own mapping. PR #804's audit reproduced the cost: stock moved while the reply said nothing applied.
3. **An outcome per line, then per row.** Each queued line is replayed on its own. A line that moved counts as applied whatever its neighbours did. A row is cleared only when its own lines moved, had moved already, or need no stock. A row asking the question its line still waits on stays open. A row whose question was answered (`unmapped`, now waiting as `no_sale_volume`) is cleared beside the narrower row the replay queues. *Rejected:* one outcome per check. That reported every line on a check as waiting when one line was queued again, and left a settled row open, so someone settling it by hand would take the stock twice.
4. **Toast-door rows are replayed under that door's key** (revised 2026-11-07 after QA round 8c; first call: they stayed open). That door stores no `pos_checks` row and books once per (order, menu item) under `toast_sale_{order}_{menuGuid}`. The replay books under that key with the door's RPCs, matches by item id only and reads a missing sale unit as a bottle, as the door does (B36). The order's `events` rows stand in for the stored check: a `pos_order_voided` order is cleared with no stock, a sale is dated by its `toast_closed_at` (ADR 0281), and an order with no readable close stays queued. *Rejected:* leaving them for a person, because a Toast house runs on that door, so POS-2 stayed true for it (QA 8c). *Rejected:* the hub's key, which could book a sale twice.
5. **A voided check's row is cleared and moves nothing.** The sale did not happen, and its void moved nothing either.
6. **At most 500 lines booked per save, rows in turn; at most 2,000 tried and 5,000 rows read** (revised 2026-11-07, QA rounds 8c, 11b, 15; first call: 500 rows per lookup). The item's open rows are read in turn, in pages of 500, until a short page or 5,000 rows: rows no save has looked at, oldest first, then those looked at longest ago (`replay_tried_at`, stamped on each open row a save looked at). The 500 counts only lines whose stock moved or had already moved. A line the save tries and cannot book (a failed stock write, a sale requeued for a missing pour size) uses one of 2,000 tries and no slot. A row that cannot replay (no stored check, no such line, no readable close) costs a read and neither. Every id list (`pos_checks`, Toast `events`) is read 100 ids at a time (PR #803's size for `GET /wines?ids=`). If a limit stopped it, the reply says so and the next save takes the rest. A row waits only until every never-looked-at row queued before it has been looked at once; a failed row never delays another again (QA round 15). Stamped rows stay open and listed. A check is tried whole, so a save can pass 2,000 tries by less than one check. *Rejected (QA round 11b):* counting every tried line against the 500, which let 500 failing writes or pour-size waits hide every newer row. *Rejected:* a fixed window of the oldest 500 rows: 500 rows that cannot replay hid every newer one, and a 500-id `.in()` made a 17 KB URL, past the 16 KB limit (QA round 2's U-1). *Rejected (QA round 15; supersedes rejecting a new column):* the `id` keyset, which lasted one save; parking after N failures, which needs an unpark path and still an order; an attempts counter (read-modify-write). *Rejected:* no cap, since one save could then run for minutes in a request.
7. **Synchronous, inside the save.** *Rejected:* a background job. The person saving is the one who needs to know what moved (ADR 0281: the import says what it did), and a job would need a second place to say it. The cap bounds the wait.
8. **A failed read says so.** If the queue, mapping or check read fails, the reply says `status: "unavailable"` with null counts, never zeros (ADR 0020). The mapping is saved either way, and saving it again finishes the replay without moving any sale twice.
9. **A `*` in a name is not a wildcard.** PostgREST reads every `*` in a like pattern as `%`, and no escape survives that. The name read sends it as `_`, then keeps only rows equal to the name, ignoring case, which is the equality `resolveWine` uses.

**Consequences.** `resolved` now has a writer, so an "open" row and an "ever held" row differ. ADR 0301's admit rule already says "resolved or not", and its sentences that said nothing sets `resolved` are corrected in place. The cellar's counts do not move: the replay settles only rows whose check it read, and `house_till_lines` counts those lines from the check. `resolved_by` stays null, because the mapping routes carry no user id. The web does not show `past_sales.message` yet. Claims: `POS-2-A-SAVED-MAPPING-REPLAYS-ITS-QUEUE`, `POS-2-REPLAY-IS-PER-LINE-AND-ONLY-ITS-OWN-ITEM` and `POS-2-REPLAY-REACHES-EVERY-ROW` (`claims.d/fix-pos-unresolved-lines-replay-on-mapping.jsonl`).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | Aldemir | Set the direction: no bottle default, convertible per format, fail closed like every other path in this pipeline |
| 2026-08-25 | Claude | Design implemented as specified. Added two guards the brief did not name — the pour-exceeds-container check (silent negative `open_bottle_ml`, not an under-depletion) and the 10–30 000ml plausibility band (litres-into-an-ml-field). Answered the queue-contract question as **yes, it needs a distinct `reason`**, with the dedupe index widened to match |
| 2026-08-25 | Claude | Declined to auto-fill `sale_volume_ml` from `normalizeDescription()` despite the pointer: a by-the-glass SKU carries the size of the bottle it is poured from, so parsing it rebuilds the bottle default under a new name |
| 2026-08-25 | Claude | Left B19 (glass voids return whole bottles) and the Toast door untouched and raised both rather than fixing them silently — both change recorded/live behaviour and are the founder's call. OD-64 |
| 2026-10-04 | Claude | Corrected 1b in place ([[0285-a-short-pour-opens-the-next-bottle]]): the over-container pour never wrote a negative `open_bottle_ml`. The CHECK refused it as 23514, measured on PGlite at `8c673db4b`. The queue guard is unchanged |
| 2026-11-07 | Claude | Amended under the founder's 2026-11-07 /goal: a saved mapping replays its item's queue (POS-2), with the nine calls and their rejected alternatives above. The per-line outcome, the own-mapping filter and the `*` rule came from PR #804's audit |
| 2026-11-07 | Claude | Revised calls 4 and 6 after QA round 8c, the session's call under the 2026-11-07 /goal: Toast-door rows replay under that door's key, every open row is read in pages, and id lists go 100 at a time |

## Amendment — 2026-11-07: a volume void gives back the ml its sale poured (B19 superseded)

**Authority.** The founder's /goal of 2026-11-07 ("I approve you decide them
all"), after the founder's pick "voids return volume" (#589 group 5); G11,
proposal F9. Fixes OD-67's defect for new voids; the OD-67 row is still
listed open. Striking it and old voids are leftovers in
`../tech-debt.d/2026-11-07-fix-a-void-gives-back-what-was-poured.md`.

**What changes.** Both doors call `public.return_glass_pour` (migration
`a_void_gives_back_the_pour`), not `apply_stock_movement(+qty)`. It gives
back `least(voided, sale.pours) × sale.pour_ml` from the sale's own
`pour_events` row, folds full bottles back (never more than the sale opened),
and names more than one bottle in the container as `overflow_ml`. The void
key (ADR 0093 D5), the tenant refusal (ADR 0141) and the dating (ADR 0281)
are unchanged.

**QA 8c (same day).** Every void, at both doors, goes to `return_glass_pour`,
which follows the unit the sale was **booked** in (its `pour_events` row, else
its `sale` ledger row: bottles back), not today's mapping. All voids of one
sale together give back at most what it booked (`pour_events.returns_sale_key`,
the ledger's `metadata.sale_key`), whatever key each carries. No booked sale
raises P0002; it never returns 0 quietly. Rejected: keying the return on the
sale line alone (a second partial void could never land); routing by today's
mapping (QA 8c's two failures).

**Rejected:** waiting for ADR 0115 D3; today's pour size (drifts from the
sale's). **Revisit when** ADR 0115 D3 (R49) replaces the body.
