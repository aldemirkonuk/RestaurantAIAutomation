# 0301 — The cellar reads the till's own record, and counts the door-checked price

- **Status:** Locked for the AW14 ruling, and Proposed for the method. The ruling is the founder's: AskUserQuestion, 2026-10-04 ~00:30Z, verbatim pick *"Door-checked, labelled (Recommended)"*: the cellar counts the price checked at the door, marked 'door-checked' until a filed invoice takes over. §1 (AW10) is a defect fix, not a fork: ADR 0160 item 7 (Q9) already ruled that live sales reach the cellar. The methods in §1 and §2 are fix lane `cellarledger`'s proposal, built for his review.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** cellar, house_beverage_ledger, house_till_lines, house_till_names, pos_checks.items, pos_unresolved_lines, Sold, Taken, pour, till book, row record, readTillLines, POS_CHECK_SCAN_LIMIT, keyset paging, First bought, Paid, door-checked, match_verified_at, receipt_verified, price_history, AW10, AW14, A-015, A-016, A-045, Q9, Tuzlu Rüzgar
- **Links:** amends [[0108-a-register-is-the-houses-own-books-first]] (its books table, two rows); [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] item 7 / Q9; [[0115-the-house-item-is-the-ledgers-key]] and OD-113 (food and non-wine identity); ADR 0286 (C02, a sent time is the fact's time for 72 hours; on branch `fix/door-keeps-the-arrival-time`, not on main yet) and ADR 0296 (a sale belongs to the house's day; on branch `fix/sales-belong-to-the-house-day`); OD-125 (a document per door check); migration `the_cellar_reads_the_tills_own_record` and its `supabase/tests` file of the same slug (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); `claims.d/fix-cellar-till-and-door-checked-cost.jsonl`; CLAIMS row `ADR-0160-Q9-NON-ALCOHOLIC-HEATMAP-LIVE-SALES` (corrected in place); the lane brief `p4-scratch/sim-run/fixes/briefs/cellarledger.md` (outside the repo)

## Context

The owner-quarter sim's analytics walk on Tuzlu Rüzgar (2026-10-03, read-only) found two gaps in /cellar's house record. Cites are at `b6531dbd5`, this branch's base: origin/main `28d32de36` with the cellar lane (`fix/cellar-invoice-book-and-menu-copy`, PR #606, `17f991a31`) merged in.

**AW10 (A-015, A-016): Sold and Taken read the wrong record.** `pos_checks.items` keeps every line the till rang, with its qty, unit price, `is_wine` and `inventory_id` (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:486-503`). The ledger's `pour` CTE read only `pos_unresolved_lines WHERE resolved = false` (`supabase/migrations/20261219120000_the_ledger_lists_only_the_current_menu.sql:135-143`). That table is the review queue of lines the bridge could not map. A mapped line never enters it, and pos-hub skips every non-wine line before it (`pos-hub.service.ts:753`). The row record's till book read the same queue plus 200 unordered checks (`POS_CHECK_SCAN_LIMIT`, `git show b6531dbd5:apps/api-gateway/src/beverages/beverages.service.ts` `:153`, `:1027`), and it skipped every wine-flagged line (`:1075`). It assumed a wine line already had a path through the queue, but a mapped one does not. So Yeni Rakı's record said the till never rang it, though 436 singles and 67 bottles were rung in July and August. On the six non-wine registers, Sold and Taken were blank on every row. That hid about 2,152 cocktails (about $36.8K) and about 1,090 soft drinks.

**AW14 (A-045): 'First bought' and 'Paid' read only filed invoices.** The ledger's `inv` CTE and the row record's invoice book read only `procurement_document_lines` on documents of type invoice (`20261219120000_…:91-103`; `beverages.service.ts:866-876`). The door check writes the billed price to the order, revalues the lots, and writes a `price_history` row with source `receipt_verified` (`apps/api-gateway/src/procurement/procurement.service.ts:6640-6663`, `:6699-6779`). /inventory, menu engineering and Wine 360 already use that price. A house that files no paper therefore got blank 'First bought' and 'Paid' on every row: 80 of 80 here, at least 50 of which hold a door-checked cost.

## Options considered

### §1, AW10: what Sold and Taken read

1. **The till's own record: every line of every check not voided, plus the queued lines no check holds (chosen).** One SQL function serves both the ledger and the row record, so a register cell and its record cannot disagree about which lines were sold. It counts each line once: a queued line whose check exists is already counted from the check.
2. **Widen the queue read to resolved lines too.** Rejected: a mapped line is never queued, so Yeni Rakı stays blank, and so does every non-wine sale pos-hub skips.
3. **Raise the 200-check (and 400-line) sample limits.** Rejected: it is still a sample, it drifts as volume grows, and an unordered sample is not even the newest checks.
4. **Read inventory consumption instead.** Rejected: consumption sees only mapped stock lines, so cocktails and unmapped soft drinks stay blank. It also counts depletions, not sales: what was poured, not what was charged.
5. **Match row names in SQL with ILIKE.** Rejected: it would be a second matcher next to `row-record.ts` `matchLine`, with a different case fold (the Turkish dotted İ under the C locale), so the record and its cell could disagree.
6. **Do nothing.** Every non-wine register keeps a blank Sold and Taken, and any mapped wine reads as never sold.

### §2, AW14: what 'First bought' and 'Paid' count

1. **The door-checked price, labelled, until a filed invoice takes over (the founder's pick).**
2. **Blank until an invoice is filed.** This is today's state: 80 blank rows on a house that files no paper.
3. **The door price, unlabelled.** Rejected: it cannot be told apart from a filed invoice, and the record is supposed to say which book a fact came from.
4. **The agreed order price.** Rejected: that is a quote, not a checked price, and the order book already shows it.
5. **File a document for each door check.** Rejected: it cuts against OD-125.

## Decision

### §1 (AW10): Sold and Taken are the till's own record

Migration `the_cellar_reads_the_tills_own_record` adds two functions. Both are `LANGUAGE sql STABLE`. Both are revoked from PUBLIC, anon and authenticated, and granted to service_role only, because `p_restaurant_id` is a parameter and EXECUTE is therefore a tenancy boundary.

- **`house_till_lines(p_restaurant_id, p_names text[] DEFAULT NULL)`** returns one row per line, with a unique `id` (check id:ordinal, or `q:` queue id), name, qty, unit price, sold-at, `is_wine`, `from_queue`, source and external check id. It is the union of two parts:
  - **Every item of every `pos_checks` row that is not voided.** Each line is dated `closed_at`, else `opened_at`, the rule the other check readers use. A qty or price that is not a number comes back NULL. It is never a cast error that would take the ledger down, and never 1.
  - **The `pos_unresolved_lines` rows with no check behind them,** resolved or not, anti-joined on the check's unique key `(restaurant_id, source, external_check_id)`. These are the orphans: the Toast direct path queues a line without writing a check. A queued line whose check exists is counted once, from the check. A voided check's queued line goes out with its check. Nothing in the code sets `resolved`, and dropping a resolved orphan would lose a sale.
  - `p_names` narrows the result to exact trimmed names.
- **`house_till_names(p_restaurant_id)`** returns the distinct names, with a count of lines for each.
- **`house_beverage_ledger`'s `pour`** reads `house_till_lines`, grouped by name first. That way `beverage_house_key` runs once per distinct name, not once per line.
  - A till name that no other book names becomes a row only when one of its lines is flagged `is_wine`, or when the queue ever held it. So every name that was a row before stays one. Food the house never queued stays out, which keeps the old boundary; ADR 0115 and OD-113 own food.
  - A product any other book already names gets its till lines either way. That is how a cocktail or a cola on the menu gets its Sold and Taken.
  - Sold is still `sum(coalesce(qty, 0))`, and Taken is still `sum(coalesce(price, 0) × coalesce(qty, 1))`, the old CTE's own rules.
  - The ledger's signature, columns and grants do not change, and the cellar lane's menu CTE is carried verbatim.
- **The row record's till book** (`BeveragesService.readTillLines`) reads in three steps:
  1. It reads `house_till_names`.
  2. It matches names in the gateway with `matchLine`, the record's own matcher.
  3. It reads `house_till_lines` for the matched names only.

  Both reads are keyset-paged on their unique column, 1,000 rows at a time (PostgREST's default response cap), until a short page. Nothing is sampled or capped. A failed read leaves the book unreadable, never zero, and a missing function names this migration.

Measured on a local build (main_tpl at `28d32de36`, plus the cellar lane, with 15,000 synthetic checks, about 59,000 lines, 150 menu drinks and 2,000 queue rows): the ledger took 162-176 ms, against 562-681 ms before. It got faster because the key function now runs per name, not per line. `house_till_names` took about 27 ms, and `house_till_lines` for a few names about 9-36 ms. This was not measured on production.

Two departures from the lane plan:
- **Keyset paging, not `.range` offsets.** An offset page re-runs the whole function and skips or repeats a line if one arrives mid-read. This is the house's `readAll` convention (`providers/vendor-menu-supply.ts`).
- **No `line_total` column.** Each reader keeps its own rule (above). The row record's line total is qty × price only when both are known.

### §2 (AW14): the door-checked price, labelled

His pick, verbatim: *"Door-checked, labelled (Recommended)"*. 'First bought' and 'Paid' count the price checked at the door, marked 'door-checked', until a filed invoice for that order takes over. The method the lane plan proposes is built on the stacked branch `fix/cellar-door-checked-cost`, which records it here as built:
- The door book is one row per order with `match_verified_at` set and no filed invoice.
- Its price is that order's `price_history` row with source `receipt_verified`, unit bottle.
- Its bottles are the accepted count.
- 'First bought' takes `match_verified_at`, a wall-clock stamp of when someone checked the paper. ADR 0286 (C02) dates the door receipt by its fact time; whether a door check's date follows it is for that branch's build to settle.
- The ledger says which dates and lines came from the door.

## Relations

- **Amends ADR 0108's books table** (Proposed), on two rows. *What we actually sold* is now `pos_checks.items`, every line of every check not voided, plus the `pos_unresolved_lines` rows no check holds, through `house_till_lines`. It is no longer `pos_unresolved_lines` alone. 0108's line that the queue "is the sales ledger" for non-wine was never true for a mapped line, and is not true for pos-hub at all, which skips non-wine lines before the queue. *What we were invoiced* also counts the door-checked price, labelled, once §2 is built.
- **Corrects the CLAIMS row for Q9** (`ADR-0160-Q9-NON-ALCOHOLIC-HEATMAP-LIVE-SALES`) in place. Its "is_wine left to the unresolved queue" half was the A-016 defect.

## Deferred

- The row record's door lines, and RowExpander's 'Last paid, each' and its 'invoiced' tag (AW13's lane).
- Sales on the Toast direct path for mapped items. That path writes no `pos_checks` row and queues only unmapped lines, so a mapped Toast sale reaches neither part of `house_till_lines`.
- Mixed currencies inside one row's Taken or Paid. The till's lines carry no currency, and the door price's currency is carried but not converted.
- The house-day date of a sale (ADR 0296) and the fact time of a door check (ADR 0286, C02).
- One stale comment that still names the queue as the sales record: `apps/web/src/pages/cellar/next/CatalogueRegister.tsx:18-19`. It was left out to keep this PR at 14 files. `registerShapes.ts`, `cellar-format.ts` and `row-record.ts` are corrected here.
- Production `price_history` `receipt_verified` rows were never counted, so "at least 50 of 80" is the walk's estimate.

## Consequences

- **Easier.** Every register's Sold and Taken come from the till's own checks, and a row's record and its cell read the same lines. The ledger got faster on the local measure above, not slower.
- **Harder / given up.**
  - Sold and Taken now include a wine's mapped sales, so they rise on every mapped wine. That is the truth, but a reader who compared against the old blank will see a jump.
  - Two more functions sit behind a tenancy boundary, and both stay service_role only.
- **Revisit when:**
  - OD-113 gives non-wine products an identity: the till names could then key by product, not by name.
  - Toast writes `pos_checks`: then its orphans stop and its mapped sales count.
  - A house's till grows past what one name-grouped scan answers in a request: that would show as the ledger's time climbing past a second.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | fix lane `cellarledger` | Created: §1 built on `fix/cellar-till-and-door-checked-cost`; §2 ruling recorded, method to be built on `fix/cellar-door-checked-cost` |
