# 0301 — The cellar reads the till's own record, and counts the door-checked price

- **Status:** Locked for the AW14 ruling, and Proposed for the method. The ruling is the founder's: AskUserQuestion, 2026-10-04 ~00:30Z, verbatim pick *"Door-checked, labelled (Recommended)"*: the cellar counts the price checked at the door, marked 'door-checked' until a filed invoice takes over. §1 (AW10) is a defect fix, not a fork: ADR 0160 item 7 (Q9) already ruled that live sales reach the cellar. The methods in §1 and §2 are fix lane `cellarledger`'s proposal, built for his review. **Locked 2026-10-05 for how a till name with a serve size joins its row:** AskUserQuestion, 2026-10-05 ~23:07Z, verbatim pick *"Join by contained name, split Sold (Recommended)"* (the section after *Fork deferred*); the method is fix lane `servesize`'s, built for his review.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** cellar, house_beverage_ledger, house_till_lines, house_till_names, sold_as, poured_bottles, poured_glasses, poured_unit_unknown, tied_lines, till_names, contained name, serve size, bottles · glasses, pos_checks.items, pos_unresolved_lines, Sold, Taken, pour, till book, row record, readTillLines, rawTillName, POS_CHECK_SCAN_LIMIT, keyset paging, First bought, Paid, door-checked, match_verified_at, receipt_verified, price_history, AW10, AW14, A-015, A-016, A-045, Q9, Tuzlu Rüzgar
- **Links:** amends [[0108-a-register-is-the-houses-own-books-first]] (its books table, two rows); [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] item 7 / Q9; [[0115-the-house-item-is-the-ledgers-key]] and OD-113 (food and non-wine identity); ADR 0286 (C02, a sent time is the fact's time for 72 hours; on branch `fix/door-keeps-the-arrival-time`, not on main yet) and ADR 0296 (a sale belongs to the house's day; on branch `fix/sales-belong-to-the-house-day`); OD-125 (a document per door check); migration `the_cellar_reads_the_tills_own_record` and its `supabase/tests` file of the same slug, and migration `a_till_name_with_a_serve_size_joins_its_row` and its test (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); `claims.d/fix-cellar-till-and-door-checked-cost.jsonl`; CLAIMS row `ADR-0160-Q9-NON-ALCOHOLIC-HEATMAP-LIVE-SALES` (corrected in place); the lane brief `p4-scratch/sim-run/fixes/briefs/cellarledger.md` (outside the repo)

## Context

The owner-quarter sim's analytics walk on Tuzlu Rüzgar (2026-10-03, read-only) found two gaps in /cellar's house record. Cites are at `b6531dbd5`, this branch's base: origin/main `28d32de36` with the cellar lane (`fix/cellar-invoice-book-and-menu-copy`, PR #606, `17f991a31`) merged in. [2026-10-05: that holds for this Context. Every cite after it names the revision it was read at, and a file this branch changes is cited by its symbol, not by a line.]

**AW10 (A-015, A-016): Sold and Taken read the wrong record.** `pos_checks.items` keeps every line the till rang, with its qty, unit price, `is_wine` and `inventory_id` (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:486-503`). The ledger's `pour` CTE read only `pos_unresolved_lines WHERE resolved = false` (migration `the_ledger_lists_only_the_current_menu`, lines 135-143). That table is the review queue of lines the bridge could not map. A mapped line never enters it, and pos-hub skips every non-wine line before it (`pos-hub.service.ts:753`). [CORRECTED 2026-10-05: too broad. The queue also holds mapped lines the bridge could not book against this house's stock. pos-hub queues a mapped wine line whose mapping names another house's item, or whose read of the house's items failed (`:778-779`), and one whose sale volume does not resolve (reason `no_sale_volume`, `:804-805`). A mapped line whose sale volume resolves against this house's own item never enters it, and Yeni Rakı's lines had not: this house's queue was empty. At origin/main `155960b59` the same lines are `:1215`, `:1240-1241` and `:1266-1267`.] The row record's till book read the same queue plus 200 unordered checks (`POS_CHECK_SCAN_LIMIT`, `git show b6531dbd5:apps/api-gateway/src/beverages/beverages.service.ts` `:153`, `:1027`), and it skipped every wine-flagged line (`:1075`). It assumed a wine line already had a path through the queue, but a mapped one does not. [CORRECTED 2026-10-05: a mapped one whose sale volume resolves against this house's own item does not; see the correction above.] So Yeni Rakı's record said the till never rang it, though 436 singles and 67 bottles were rung in July and August. On the six non-wine registers, Sold and Taken were blank on every row. That hid about 2,152 cocktails (about $36.8K) and about 1,090 soft drinks.

**AW14 (A-045): 'First bought' and 'Paid' read only filed invoices.** The ledger's `inv` CTE and the row record's invoice book read only `procurement_document_lines` on documents of type invoice (the same migration, lines 91-103; `beverages.service.ts:858-876`). The door check writes the billed price to the order, revalues the lots, and writes a `price_history` row with source `receipt_verified` (`apps/api-gateway/src/procurement/procurement.service.ts:6640-6663`, `:6699-6779`). /inventory, menu engineering and Wine 360 already use that price. A house that files no paper therefore got blank 'First bought' and 'Paid' on every row: 80 of 80 here, at least 50 of which hold a door-checked cost.

## Options considered

### §1, AW10: what Sold and Taken read

1. **The till's own record: every line of every check not voided, plus the queued lines no check holds (chosen).** One SQL function serves both the ledger and the row record, so a register cell and its record cannot disagree about which lines were sold. [CORRECTED 2026-10-05: too broad. The record and its cell read the same till record, but they group names by different rules (`matchLine` against `beverage_house_key`, as `ROW_RECORD_MATCH_RULE` in `row-record.ts` says), so a row's lines can differ; see *Stated behaviours* under §1.] It counts each line once: a queued line whose check exists is already counted from the check.
2. **Widen the queue read to resolved lines too.** Rejected: a mapped line is never queued, so Yeni Rakı stays blank, and so does every non-wine sale pos-hub skips. [CORRECTED 2026-10-05: a mapped line whose sale volume resolves against this house's own item is never queued (Context's correction); Yeni Rakı's were not.]
3. **Raise the 200-check (and 400-line) sample limits.** Rejected: it is still a sample, it drifts as volume grows, and an unordered sample is not even the newest checks.
4. **Read inventory consumption instead.** Rejected: consumption sees only mapped stock lines, so cocktails and unmapped soft drinks stay blank. It also counts depletions, not sales: what was poured, not what was charged.
5. **Match row names in SQL with ILIKE.** Rejected: it would be a second matcher next to `row-record.ts` `matchLine`, with a different case fold (the Turkish dotted İ under the C locale), so the record and its cell could disagree. [CORRECTED 2026-10-05: that reason assumed the record and its cell share one matcher today, and they do not (option 1's correction). The reason that stands: every book of the row record (menu, invoice, order, quote and till) picks its lines with `matchLine` in the gateway, so an ILIKE for the till book alone would give one book of the same record a different case fold from the other four.]
6. **Do nothing.** Every non-wine register keeps a blank Sold and Taken, and any mapped wine reads as never sold. [CORRECTED 2026-10-05: any mapped wine whose lines were never queued; a mapped line pos-hub queued was read from the open queue.]

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
  - **Every item of every `pos_checks` row that is not voided.** Each line is dated `closed_at`, else `opened_at`, the rule the other check readers use. A qty or price that is not a number comes back NULL. It is never a cast error that would take the ledger down, and never 1. [CORRECTED 2026-10-05: "never 1" holds for `house_till_lines`' own output only. The ledger's Taken then counts a NULL qty as 1; see *Stated behaviours* below.]
  - **The `pos_unresolved_lines` rows with no check behind them,** resolved or not, anti-joined on the check's unique key `(restaurant_id, source, external_check_id)`. These are the orphans: the Toast direct path queues a line without writing a check. A queued line whose check exists is counted once, from the check. A voided check's queued line goes out with its check. Nothing in the code sets `resolved`, and dropping a resolved orphan would lose a sale.
  - `p_names` narrows the result to exact trimmed names.
- **`house_till_names(p_restaurant_id)`** returns the distinct names, with a count of lines for each.
- **`house_beverage_ledger`'s `pour`** reads `house_till_lines`, grouped by name first. That way `beverage_house_key` runs once per distinct name, not once per line.
  - A till name that no other book names becomes a row only when one of its lines is flagged `is_wine`, or when the queue ever held it. So every name that was a row before stays one. [CORRECTED 2026-10-05: too broad. A name the open queue held, and no other book names, stays a row only while the till's record still holds a line of it: a line on a check that is not voided, or a queued line with no check behind it. A name whose every line sat on voided checks leaves with them, because a voided check is not a sale. See *Stated behaviours* below; the test's T2 pins it.] [CHANGED 2026-10-05, round 2: the `is_wine` half is dropped. A till name that no other book names becomes a row only when the queue ever held it, resolved or not, and only while the till's record holds a line of that name (main: when the open queue held it; nothing in the code sets `resolved`). Tuzlu Rüzgar's mappings flag every mapped name `is_wine` (152 of 152 in the 2026-10-03 walk's read), so that half made a row of each mapped till name with a serve size in it: 'Yeni Rakı (single 50ml)', 'Yeni Rakı 70cl bottle' and 'Efes Pilsen (draft 400ml)' beside the menu's 'Yeni Rakı' and 'Efes Pilsen'. That was a choice of what the register shows, made without asking. The migration's test, T15, pins the change, and fails on the first build.] Food the house never queued stays out, which keeps the old boundary; ADR 0115 and OD-113 own food.
  - A product any other book already names gets its till lines either way. That is how a cocktail or a cola on the menu gets its Sold and Taken. [CORRECTED 2026-10-05, round 2: it gets the till lines whose name has the same `beverage_house_key`, the same words in any order. A till name with a serve size in it has a key of its own; see *Fork deferred* below.] [CHANGED 2026-10-05, the founder's ruling: it gets the till lines whose name contains its words, when it is the most specific row that name contains; see *The ruling of 2026-10-05* below.]
  - Sold is still `sum(coalesce(qty, 0))`, and Taken is still `sum(coalesce(price, 0) × coalesce(qty, 1))`, the old CTE's own rules.
  - The ledger's signature, columns and grants do not change, and the cellar lane's menu CTE is carried verbatim.
- **The row record's till book** (`BeveragesService.readTillLines`) reads in three steps:
  1. It reads `house_till_names`.
  2. It matches names in the gateway with `matchLine`, the record's own matcher.
  3. It reads `house_till_lines` for the matched names only.

  Both reads are keyset-paged on their unique column, 1,000 rows at a time (PostgREST's default response cap), until a short page. Nothing is sampled or capped. [CORRECTED 2026-10-05: 1,000 is the API's `max_rows` in `supabase/config.toml`, the house's `readAll` convention, not a PostgREST default. A page shorter than 1,000 ends the read, so a smaller `max_rows` would end it early. Production's setting was not read.] A failed read leaves the book unreadable, never zero, and a missing function names this migration.

  **Step 3 sends each name back exactly as step 1 returned it (added 2026-10-05).** `house_till_lines` returns a name as `btrim(name)` and keeps a line only when `btrim(name) = ANY (p_names)`: the same expression on both sides, so a name passed back as listed always finds its own lines. SQL `btrim` strips spaces only. The first build keyed the match and `p_names` by the name after the gateway's `str()` (`row-record.ts`), whose JS `trim()` also strips a tab, a newline and a no-break space. A till name with one of those at its edge, such as `'Zqtl Cola'` plus a tab, was listed and matched, then sent back as `'Zqtl Cola'`, and none of its lines came back: the A-016 symptom again, and the read it replaced had not had it. `readTillLines` now keys the match and `p_names` by the untrimmed name (`rawTillName`) and trims only to show it. `matchLine` folds whitespace itself, so what matches does not change. Pinned by `beverages.service.spec.ts` (a tab and a no-break space) and by the migration's test, T14 (every listed name, passed back as listed, returns its own lines).
  - Rejected: making both sides trim the same set, a regexp in SQL to mirror JS `trim()`'s Unicode whitespace or a `btrim`-only trim in the gateway. That is two definitions of whitespace in two languages to keep equal, and the SQL side would also change the names `house_till_names` lists and the ledger's `till` CTE groups by. The round trip needs neither to agree.

**Stated behaviours (added 2026-10-05).** Each follows from the code above; none of them changes it.

- **A voided check is not a sale, so a name whose every line sat on voided checks leaves with them.** Main's `pour` read every open queue line whether or not its check was voided (migration `the_ledger_lists_only_the_current_menu`, lines 135-143, the same at origin/main `155960b59` and at `b6531dbd5`). `house_till_lines` drops a queued line whose check exists, and drops every line of a voided check. So a name the open queue held, and no other book names, stays a row only while the till's record still holds a line of it: a line on a check that is not voided (pos-hub queues each line from the items it has already written to its check, as its comment at `pos-hub.service.ts:1208-1210` at origin/main `155960b59` says, so a queued line's check normally lists it), or a queued line with no check behind it. A name whose every line sat on voided checks has no line left there, and stops being a row. The migration's test pins this (T2, 'Zqtl Voided Wine').
- **"Stays a row" means stays one of the ledger's keys.** The `p_limit` cut is unchanged, but it orders rows by their line counts, which now include till lines, so a row's place in that order can move. The register says when the cut is reached (`ledgerTruncated` in `BeveragesService.readRegister`, shown as the house-truncated note at `CatalogueRegister.tsx:180-182` at origin/main `155960b59`).
- **The record and its cell group names by different rules.** Both read `house_till_lines`. The cell groups lines by `beverage_house_key` in SQL. The record picks names with `matchLine` in the gateway (the same words, or, for a label of four characters or more, the label inside a longer name), the weaker rule `ROW_RECORD_MATCH_RULE` in `row-record.ts` states. So a row's lines can differ between the two: 'Cola Zqtl' has the same key as 'Zqtl Cola' (both `cola zqtl`), so its lines count in that cell but are not in that row's record; 'Zqtl Cola Zero' has a key of its own (`cola zero zqtl`), so its lines never count in the 'Zqtl Cola' cell, yet appear as 'contains' in that row's record. Neither matcher changed here: main's record already used `matchLine`, and main's cell `beverage_house_key`. [CHANGED 2026-10-05, the founder's ruling: the till book now has one rule for both. The record's till book reads the names the ledger counted on the row (`house_till_names(p_restaurant_id, p_label)`), and only the other four books still pick lines with `matchLine`; see *The ruling of 2026-10-05* below.]
- **A qty that is not a number.** `house_till_lines` returns it NULL. Sold counts it as 0 (`coalesce(qty, 0)`) and Taken as qty 1 (`coalesce(price, 0) × coalesce(qty, 1)`), while the row record shows that line's qty and total as null (the line total in `BeveragesService.readTillLines`). These rules are main's, unchanged, and main already split a queue line with a NULL qty this way; what this PR adds is that the ledger now reads check lines, so a check line whose qty is not a number reaches them too. It is inherited, not a regression. T13 pins the ledger's side: three cola lines, one with qty 'abc', read Sold 3 and Taken 16.

Measured on a local build (main_tpl at `28d32de36`, plus the cellar lane, with 15,000 synthetic checks, about 59,000 lines, 150 menu drinks and 2,000 queue rows): the ledger took 162-176 ms, against 562-681 ms before. It got faster because the key function now runs per name, not per line. [CORRECTED 2026-10-05, last call: faster on that fixture, whose queue held 2,000 rows. With an empty queue, as at Tuzlu Rüzgar, the old `pour` had nothing to read and the new one reads every check, so the ledger is slower: a verifier's local build with 20,000 checks (about 120,000 lines) and no queue took about 35 ms before and about 175 ms after. Neither was measured on production.] `house_till_names` took about 27 ms, and `house_till_lines` for a few names about 9-36 ms. This was not measured on production.

Two departures from the lane plan:
- **Keyset paging, not `.range` offsets.** An offset page re-runs the whole function and skips or repeats a line if one arrives mid-read. This is the house's `readAll` convention (`providers/vendor-menu-supply.ts`).
- **No `line_total` column.** Each reader keeps its own rule (above). The row record's line total is qty × price only when both are known.

### Fork deferred (added 2026-10-05): how a till name with a serve size joins its row

[ANSWERED 2026-10-05 ~23:07Z: option 2, containment, with Sold split; see the next section. This section is kept as the record of what was asked.]

This is the founder's call, not made here. Tuzlu Rüzgar's till adds a serve size to the menu's name. The ledger joins a till name to a row only when their `beverage_house_key`s are equal, so such a name reaches its row's record (`matchLine` finds it as 'contains') but not its Sold and Taken cell.

Measured on the sim's own files, not on production. The till names come from `p4-scratch/sim-run/rebuild/run/feed/pos-*.json` (92 day files, 2026-07-01 to 2026-09-30) and the menu names from `rebuild/venue/menu-beverage.json`. Both were keyed with `beverage_house_key` on a local build.

| The feed's category | Till names | Lines | Reach their menu row's cell on this branch |
|---|---|---|---|
| Cocktails | 11 | 3,410 | 10 names, 3,367 lines |
| Non-alcoholic | 20 | 4,269 | 18 names, 4,265 lines |
| Beer | 12 | 4,189 | the 8 bottled names, 1,393 lines; none of the 4 draft names ('Efes Pilsen (draft 400ml)'), 2,796 lines |
| Rakı | 24 | 2,175 | none ('Yeni Rakı (single 50ml)', 'Yeni Rakı 70cl bottle') |
| Spirits | 25 | 1,211 | none ('Fords Gin (50ml)') |
| Wine | 81 | 5,727 | none ('Kavaklıdere Çankaya (glass)') |

So this branch fixes A-015 on the cocktail and soft-drink rows, and on beer only for the bottles: 'Efes Pilsen' reads its bottles and not its drafts. The rakı, spirit and wine-by-the-glass cells stay blank. A-016's record half is fixed.

The options:
1. **Equal keys (built, and main's rule).** It costs the gaps in the table above.
2. **Containment, the record's own rule.** A till name joins the most specific row whose key words it contains, and a tie joins none. On the same files it joins all of the beer, rakı and spirit lines, and 5,510 of the 5,727 wine lines (2 wine names tie). What it costs:
   - A row's Sold would add singles, bottles and glasses into one count, unless Sold is split by the mapping's `sale_unit` or `sale_volume_ml`, which `pos_checks.items` carries for a mapped line.
   - A cocktail named after a spirit that no book names would join the spirit's row.
3. **Strip serve-size words before keying** ('single', 'bottle', 'glass', 'draft', '50ml', '70cl' and so on). That is a word list to keep in SQL, and it has the same Sold-units cost as option 2.
4. **Join by the POS mapping's stock item** (`inventory_id`). This joins by identity, not by name, as ADR 0115 does. Only mapped lines are covered, so cocktails stay on equal keys.
5. **A row of its own for each sized name** (this branch's first build). It shows the truth, but split, and beside a blank menu row.

**Recommendation: option 2.** Taken is summed. Sold is split by the mapping's sale unit, as bottles and pours, which follows his units pick for /communications (*"Bottles · glasses (Recommended)"*, 2026-10-04). This migration's test, T15, pins today's answer, and an answer that joins these names changes it.

### The ruling of 2026-10-05: a till name joins the most specific row it contains, and Sold is split

His pick (AskUserQuestion, 2026-10-05 ~23:07Z), verbatim: *"Join by contained name, split Sold (Recommended)"*. The option's text, verbatim: *"A till name joins the most specific row whose words it contains (a tie joins none). Sold is split into bottles and pours by the till's sale unit; Taken is summed. Fills rakı, spirits, draft beer and most wine on the sim feed. Risk: a cocktail named after a spirit with no row of its own joins that spirit."* Rejected: *"Strip size words first"*, *"Join by the POS mapping"* and *"Keep exact names only"*. The split's units follow his earlier units pick, *"Bottles · glasses (Recommended)"* (2026-10-04), whose option (a) reads 'N bottles · M glasses'.

Built by migration `a_till_name_with_a_serve_size_joins_its_row`, on branch `fix/cellar-till-names-with-a-serve-size`, which is stacked on §1's branch:

- **`house_till_lines` gains `sold_as`**: what one of the line is, 'bottle', 'glass', or NULL for an unknown unit. Its return shape grows, so it is dropped and created again with the same grants.
- **`house_beverage_ledger` joins each till name to one row** and grows five columns at the end:
  - `poured_bottles`, `poured_glasses` and `poured_unit_unknown`, which sum to `poured_qty`;
  - `tied_lines`;
  - `till_names`, the names counted on the row, each with how it joined.
  Its signature and grants do not change.
- **`house_till_names(p_restaurant_id, p_label)`, a new overload**, lists the till names the ledger counted on the row whose key is `p_label`'s key. The row record's till book (`BeveragesService.readTillLines`) reads it, then `house_till_lines` for those names. So the record's till book and the Sold cell share one rule. `house_till_names(p_restaurant_id)` is unchanged.
- **The gateway** carries the split on the record's `poured` (`bottles`, `glasses`, `unitUnknown`, `tiedLines`; `house-record.ts`). **/cellar's Sold cell** reads, for example, '9 bottles · 4 glasses', then a dimmed '· 2 unknown unit' and '· 3 lines tied' (`registerCells.tsx`). The sort stays on the total.

**Stated behaviours (2026-10-05 ruling).** Each follows from the code. The migration's test pins the join (S1 to S5, S8) and the unit rules (S6, S7); where a point is pinned elsewhere, or not at all, it says so.

- **Words are the distinct tokens of `beverage_house_key`**, the one normalisation every book's key already goes through. They are distinct, not counted, because a menu row that repeats its producer in its own name keys with the producer twice: producer 'Château Musar' with name 'Château Musar Rouge' keys `chateau chateau musar musar rouge`. A counted rule would never let the till's 'Château Musar Rouge (glass)' join it.
- **The join, in order:**
  1. The row whose key equals the name's key wins (exact).
  2. Else, of the rows whose every word the name holds, the one with the most distinct words wins (contains).
  3. Rows level at the top tie, and the name joins none of them. Each tied row counts the name's lines in `tied_lines`, never in its Sold or Taken.
  4. A name that joins no row keeps its own key. It is a row only when the queue ever held it, as before (§1).
- **The rows a till name can join** are the keys the menu, invoice, order and quote books name. A till-only row is never joined by another till name.
- **A line's unit follows ADR 0011's order for the POS bridge** (`PosHubService` `resolveSaleVolume`), line by line:
  - A line gets a unit only when its `inventory_id` is, as a string, the id of an item of this house, as the bridge's own check is. An unmapped line, a line mapped to another house's item, and a queued line with no check behind it are unknown.
  - A sale volume, when the line has one, outranks its label:
    - under 10 ml, not a number, or over the item's bottle (750 ml when it has none) is unknown;
    - exactly the item's bottle is a bottle;
    - anything else is a glass.
  - Else the label: 'bottle' is a bottle, and 'glass' is a glass when the item has a pour size, else unknown.
  - Else the unit is unknown.
- **Not gated on `is_wine`.** The bridge books stock only for a line flagged wine. The unit is a fact about the sale, so a line not flagged wine that names this house's item still gets one; S6's lines carry no flag. On the sim's feed every line that names a house item is flagged wine (25,050 of 25,050 on the local build), so nothing there turns on it. It is listed as a fork in the PR.
- **Sizes are the item's as they are now**, not as they were at the sale. No test pins this.
- **Each part of Sold uses Sold's own `coalesce(qty, 0)`**, so the three parts always sum to Sold (S7). Taken is summed as before.
- **The cell stays honest where units are unknown.** A row none of whose lines has a known unit shows the plain count, as before: a cocktail, an unmapped draft, or a gateway from before the split. A row that only tied shows the dash and its tied lines. `CellarNext.test.tsx` pins both.
- **A catalogue-only row's record has no till lines now.** The till book lists only names the ledger counted on a house row whose key is the label's key, and a catalogue-only row is not one. Before, `matchLine` could show it the lines of a till name that contains its label. No test pins this.

**Measured** on a local build of the sim's feed (92 days, 11,158 checks, 111,020 lines over two houses), not on production. House A is the v2 drinks menu with its producer column; house B is the same menu with names only, the shape the *Fork deferred* table was keyed in.

| The feed's category | Reach a row's cell, before (equal keys) | After, house B | After, house A |
|---|---|---|---|
| Rakı | 0 of 24 names | 24 of 24 (2,175 lines) | the same |
| Spirits | 0 of 25 | 25 of 25 (1,211) | the same |
| Beer | 8 of 12 (B), 0 of 12 (A) | 12 of 12 (8 exact, 4 drafts by contains) | 0 of 12 |
| Wine | 0 of 81 | 79 of 81 (5,510; 2 names, 217 lines, tie) | 81 of 81 (5,727) |
| Cocktails | 10 of 11 | 10 of 11 | the same |
| Non-alcoholic | 18 of 20 | 19 of 20 | the same |

The ledger's time did not move: 135-142 ms before and 134-142 ms after for house A, and 133-136 ms before and 133-134 ms after for house B, three runs each. `house_till_names` for one label took 133-138 ms, because it reads the whole ledger. `house_till_lines` for two names took 31 ms.

### §2 (AW14): the door-checked price, labelled

His pick, verbatim: *"Door-checked, labelled (Recommended)"*. 'First bought' and 'Paid' count the price checked at the door, marked 'door-checked', until a filed invoice for that order takes over. The method the lane plan proposes is built on the stacked branch `fix/cellar-door-checked-cost`, which records it here as built: [CORRECTED 2026-10-05, round 2: "built" holds only once that branch (PR #628) merges. It is not merged, and nothing in this branch reads the door. Until it merges, 'First bought' and 'Paid' still read filed invoice documents only, and A-045 stays open. That branch has to be brought up to this one and its migration renumbered past `the_cellar_reads_the_tills_own_record` before it can land.]
- The door book is one row per order with `match_verified_at` set and no filed invoice.
- Its price is that order's `price_history` row with source `receipt_verified`, unit bottle.
- Its bottles are the accepted count.
- 'First bought' takes `match_verified_at`, a wall-clock stamp of when someone checked the paper. ADR 0286 (C02) dates the door receipt by its fact time; whether a door check's date follows it is for that branch's build to settle.
- The ledger says which dates and lines came from the door.

## Relations

- **Amends ADR 0108's books table** (Proposed), on two rows. *What we actually sold* is now `pos_checks.items`, every line of every check not voided, plus the `pos_unresolved_lines` rows no check holds, through `house_till_lines`. It is no longer `pos_unresolved_lines` alone. 0108's line that the queue "is the sales ledger" for non-wine was never true for a mapped line, and is not true for pos-hub at all, which skips non-wine lines before the queue. [CORRECTED 2026-10-05: never true for a mapped line whose sale volume resolves against this house's own item, which is never queued; pos-hub queues the other mapped wine lines (Context's correction).] *What we were invoiced* also counts the door-checked price, labelled, once §2 is built.
- **Corrects the CLAIMS row for Q9** (`ADR-0160-Q9-NON-ALCOHOLIC-HEATMAP-LIVE-SALES`) in place. Its "is_wine left to the unresolved queue" half was the A-016 defect.

## Deferred

- The row record's door lines, and RowExpander's 'Last paid, each' and its 'invoiced' tag (AW13's lane).
- Sales on the Toast direct path for mapped items. That path writes no `pos_checks` row and queues only unmapped lines, so a mapped Toast sale reaches neither part of `house_till_lines`. [CORRECTED 2026-10-05: too broad. It also queues a line whose mapping names another house's item (`toast.service.ts:609-635` at origin/main `155960b59`), and that line reaches `house_till_lines` from the queue when no check is behind it. A mapped Toast sale against this house's own item, or one whose ownership read failed (`:602-608`, logged and neither queued nor poured), reaches neither part.]
- Mixed currencies inside one row's Taken or Paid. The till's lines carry no currency, and the door price's currency is carried but not converted.
- The house-day date of a sale (ADR 0296) and the fact time of a door check (ADR 0286, C02).
- One stale comment that still names the queue as the sales record: `apps/web/src/pages/cellar/next/CatalogueRegister.tsx:18-19` at origin/main `155960b59`. It was left out to keep this PR at 14 files. `registerShapes.ts`, `cellar-format.ts` and `row-record.ts` are corrected here. [CHANGED 2026-10-05, round 2: corrected here too; it is no longer deferred.]
- Production `price_history` `receipt_verified` rows were never counted, so "at least 50 of 80" is the walk's estimate.

## Consequences

- **Easier.** Every register's Sold and Taken come from the till's own checks, and a row's record and its cell read the same lines. [CORRECTED 2026-10-05: the same till record, not always the same lines: they group names by different rules (*Stated behaviours* under §1).] The ledger got faster on the local measure above, not slower. [CORRECTED 2026-10-05, last call: on that fixture only. With an empty queue, as at Tuzlu Rüzgar, it is slower, about 35 ms to about 175 ms on 20,000 local checks (the measurement paragraph under §1).]
- **Harder / given up.**
  - Sold and Taken now include a wine's mapped sales, so they rise on every mapped wine. That is the truth, but a reader who compared against the old blank will see a jump. [CORRECTED 2026-10-05: they rise on a wine's row when a till name keys to that row and sold lines the open queue did not hold. A till name that keys to no other book becomes a row of its own (the next point).] [CORRECTED 2026-10-05, round 2: it does not; see the next point's correction. Sold and Taken rise on a row only by the lines of till names that key to it.]
  - **A mapped wine whose till name keys to no other book becomes its own row (stated 2026-10-05; a behaviour of the admit rule, not a fix).** The admit rule (§1) makes a till name a row when a line of it is flagged `is_wine`. So a mapped wine's till name whose `beverage_house_key` matches no menu, invoice, order or quote line now becomes a ledger row of its own. Before this branch it was a row only while the open queue held it. That row may fall in no register; then `unregistered()` (`house-record.ts:509` at origin/main `155960b59`) counts it in the note that "N lines in this house's books belong to no register this build knows" (`CatalogueRegister.tsx:186-192`, same revision). Its Sold and Taken stay on that row: they do not reach the Sold cell of the menu row the wine is sold as, whose key differs. Its lines reach that menu row's record only when the till name is the menu label's words or contains it (`matchLine`). An identity for till names (OD-113) is what would join them. [CORRECTED 2026-10-05, round 2: no longer true. The `is_wine` half of the admit rule is dropped (§1), so such a name is a row only when the queue ever held it (on origin/main, when the open queue held it; nothing in the code sets `resolved`). Its lines reach the menu row's record the same way, and no cell; that is the fork under *Fork deferred*, above §2.]
  - Till names that carry a serve size reach no row's Sold or Taken (stated 2026-10-05, round 2). On the sim's feed that is every rakı, spirit, draft beer and wine line (the table under *Fork deferred*). Their rows' record shows them; their cells stay blank until the founder picks how they join. [CHANGED 2026-10-05, the founder's ruling: they join the most specific row whose words they contain. On a local build of the sim's feed, every rakı and spirit name now reaches a row on both menus. The four draft-beer names reach their rows on the names-only menu (house B), and no beer name does on the menu that carries producers (house A; see *A menu that carries producers* below). 79 of the 81 wine names reach a row on the names-only menu, and all 81 on the other. See the table under *The ruling of 2026-10-05*.]
  - Two more functions sit behind a tenancy boundary, and both stay service_role only. [CHANGED 2026-10-05: three, with the `house_till_names(p_restaurant_id, p_label)` overload, service_role only too.]
  - **The ruling's own risk (2026-10-05).** A cocktail named after a spirit that has no row of its own joins that spirit; the migration's test pins it with 'Fords Gin Fizz' on 'Fords Gin' (S4). A variant joins its base the same way: 'Cola Zero' on 'Cola' when no row names 'Cola Zero' (§1's test, T13). On the sim's feed no cocktail joins a spirit; the containment joins outside rakı, spirits, beer and wine are 'Booth Ayran' on 'Ayran' and 'Booth Şalgam' on 'Şalgam', in both houses.
  - **A menu that carries producers keeps some till names apart.** On house A, all twelve beer names reach no row, because the menu row's words include its producer ('Anadolu Efes') and the till's name leaves it out. Containment needs every word of the row.
  - **A tie joins neither row**, and a tie's lines show only as a count. On house B's names-only menu, 'Château Musar Musar Jeune Rouge' (bottle and glass) ties between 'Château Musar Rouge' and 'Musar Jeune Rouge', 217 lines. Neither row's record lists them.
- **Revisit when:**
  - OD-113 gives non-wine products an identity: the till names could then key by product, not by name.
  - Toast writes `pos_checks`: then its orphans stop and its mapped sales count.
  - A house's till grows past what one name-grouped scan answers in a request: that would show as the ledger's time climbing past a second.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | fix lane `cellarledger` | Created: §1 built on `fix/cellar-till-and-door-checked-cost`; §2 ruling recorded, method to be built on `fix/cellar-door-checked-cost` |
| 2026-10-05 | fix lane `cellarledger` | §1 wording narrowed in place, no code changed: "every name that was a row before stays one" and "record and cell cannot disagree" were broader than the code; *Stated behaviours* added (voided checks, the two matchers, a qty that is not a number) |
| 2026-10-05 | fix lane `cellarledger` | Code fix: `readTillLines` sends matched names back untrimmed (*Step 3*, above), after a verifier found a name with a tab or a no-break space at its edge lost its lines; jest case and SQL test T14 added. Wording narrowed in place: the queue does hold some mapped lines (pos-hub: another house's item, a failed house read, an unresolved sale volume; Toast: another house's item); `max_rows` named. Cites now name their revision, migrations by slug. Consequences: a mapped wine whose till name keys to no other book becomes its own row |
| 2026-10-05 | fix lane `cellarledger` | Round 2, after a verifier read the sim's own till names: the `is_wine` half of the admit rule is dropped (an unasked display choice that made every mapped name a row); SQL test T15 pins it with serve-size names. *Fork deferred* added: a till name with a serve size reaches no cell, measured on the sim's feed, with five options and a recommendation, not built. §2's "built" narrowed to PR #628 merging. `CatalogueRegister.tsx`'s stale comment corrected |
| 2026-10-05 | fix lane `cellarledger`, last call | Wording narrowed in place, no code changed: the admit rule's "as on main" (main read the open queue only; nothing in the code sets `resolved`), and the speed claim (slower with an empty queue, as at Tuzlu Rüzgar, on a verifier's local build) |
| 2026-10-05 | fix lane `servesize` | The founder's ruling on *Fork deferred* recorded verbatim, and built on `fix/cellar-till-names-with-a-serve-size` (stacked on §1's branch): a till name joins the most specific row whose words it contains, exact first, and a tie joins none; Sold is split into bottles, glasses and unknown unit by ADR 0011's unit order; the record's till book reads the ledger's names. *Stated behaviours*, the measure and the consequences are added in place |
