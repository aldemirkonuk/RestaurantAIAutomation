**[2026-10-06 ~04:58Z, coordinator, at `22a192cf2`]**
- **This is the head to audit.** The lane's last call said SHIP at `429c975e3`. The coordinator then renumbered the migration from `20261222200000` to **`20261223010000`**, past main's newest, `20261222230000` (#621). The migration and its test were moved, and the line in `scripts/sql_outside_migrations.txt` updated. The SQL is unchanged, and no other file names the version.
  - Versions in flight: #650 serve-size `20261223000000`, #617 proxies `20261223010000`, #618 booth `20261223020000`, #620 zoneaddr `20261223030000`. No remote ref, local branch or worktree held a `20261223*` migration before these.
  - Re-check at merge: if another migration lands first, move this one again.
- **Guards at `22a192cf2`:** migration order 0, versions unique 0, OD ids 0, conflict markers 0, citation pairing 0. Ownership `[]`. 15 files against origin/main `4528b9689`.
- **Follow-up that merges straight after:** `fix/goal-book-cogs-reads-the-till` @ `1b5d5b89a` (one file, `goal-scenarios.ts`; local, not pushed), per Merge-order notes.
- **Local Postgres, re-run at `22a192cf2`.** The migration now applies after #621's, where the lane's run applied it before. Template `28d32de36`, 7 lane migrations:
  - 7 of 7 [fix] PASS, including `20261223010000_cost_of_goods_reads_what_sold_test.sql` and #621's `tables_learned_from_the_pos_test.sql`.
  - 7 of 7 [ctl] FAIL. This PR's test fails on [ctl] as in the lane's run.
  - Output: `audits/proxies-local-pg-22a192cf2.txt`.
- Sentences below that say the renumber is owed, or that name `20261222200000`, describe the lane's head `429c975e3`. The renumber is done.

**Head `429c975e3` (last call, 2026-10-06 ~04:45Z).** This head has three parts:
- the rework of the audit BLOCK at `847f2470d` (comment 6008862399): `e185b5da1` and `d10e86ed9`;
- `2e72da358`, a clean merge of `origin/main` `4528b9689` (#621 tables);
- `429c975e3`, two ADR sentences corrected, with no code change.

Earlier heads are `847f2470d` (the coordinator's renumber to `20261222200000` plus main `63ce97e62`) and `b34d0ce3f` (main `54f833e4b`). Lines that name an older head describe this PR as it was then.

**Renumber owed at the merge step.** #621 merged at 04:32Z and took migration `20261222230000`. That version is newer than this branch's `20261222200000`, so `check_migration_order.py` now fails, and CI's migration guard will fail until the coordinator renumbers. Renumber the migration and its test (and the `scripts/sql_outside_migrations.txt` line) past `20261222230000` and past every slot still in flight. ADR 0298, the CLAIMS row and this body cite the migration by its slug (`cost_of_goods_reads_what_sold`); the CLAIMS row finds it by glob. The rename therefore needs no other edit.

## What was wrong for the owner

The analytics walk on Tuzlu Rüzgar (2026-10-03, read-only, production) found three figures on /reports and /recommendations standing in for measures the connected POS feed can already give. Cites are at `e2cbe426a`.

- **A-046 (minor), /reports "Figures of record".**
  - "Cost of goods (365d)" read **$39,302.50**. That is the sum of DELIVERED `procurement_orders` over 365 days: what was bought, not what sold (`analytics.service.ts:428`).
  - The ledger's count-based beverage cost of goods for July and August alone is about **$47,914** (procure-summary B17).
  - "Sell-price valuation" ($28,889, menu price × bottles on hand) was carried as `revenue`. Gross margin, the COGS ratio and prime cost divided the on-hand value by it (`:458`), so no ratio described a sale.
- **A-018 (major), /recommendations.**
  - "Revenue rides on very few wines (Gini 0.78)… raise their service level to 98%" fired on a Gini of menu price × bottles on hand over 134 rows, about half of them not wine (`:725-726`, live recompute 0.7775).
  - The walk's truth Gini of POS line sales per imported row (116 rows, Jul 1 to Aug 30) is **0.565** (0.509 on wine).
  - Both are below the rule's 0.6 line, so the stand-in produced the advice.
- **AW16, the metric registry.**
  - `GET /analytics/metrics` marked all 33 entries `computed: true`.
  - Seven have no served field: year-on-year growth, early-payment APR, newsvendor, price elasticity, optimal markup, CUSUM, and a drawdown that is 0 by construction.
  - Others described inputs they do not read: the Gini as "per-SKU revenue", the COGS ratio as "Beverage cost as a share of wine revenue", and turnover, DIO and GMROI as if they used an average inventory.

## What changed and why

### One SQL read: `public.pos_item_sales(house, since)`

Migration `cost_of_goods_reads_what_sold` adds it. It returns ONE jsonb value, so PostgREST's `max_rows` cannot cut it (ADR 0292). It is SECURITY INVOKER and STABLE, and only `service_role` may execute it; a DO block asserts both.

Per stock item it returns:
- **sales**: `price × qty` of the lines naming the item, on closed, non-voided checks;
- **bottles out**: minus the sum of the source `pos` `sale`/`return` ledger rows, so voids net out and glass pours count as the bottles they opened;
- **`mapped`**: a mapping of this house points at the item. A mapped item that neither sold nor moved is listed with zeros.

It also returns these counts: checks, lines, lines naming no stock item and their sales, and unreadable lines (counted, not raised). It returns the window's two clocks as well: `first_check_at`, the first closed check (where sales start), and `first_move_at`, the first POS ledger row (where cost of goods starts). `first_sale_at` is the earlier of the two.

A new partial index `(restaurant_id, closed_at DESC) WHERE closed_at IS NOT NULL` covers the window. The migration adds no table, writes no row and changes no RLS. **It changes no existing rows**, so it needs no dry-run SQL.

### `getFinancialSummary` (ADR 0298 Decisions 1-4 and 6)

**`cogs`** is POS bottles out × `resolveUnitCost`'s recorded unit cost, over 365 days. It is **null** when:
- the read fails;
- the till recorded nothing;
- the till traded but no item moved stock;
- **any** item that sold carries no recorded cost (the founder's ruling).

`cogsCoverage` gives "N of M items that sold carry a recorded cost", plus bottles sold, bottles costed and items net-returned.

**Rework: a deleted item that sold is costed from its own row.** This was the decisive BLOCK finding.
- `loadInventory` reads only active rows. An item deleted on /inventory (`softDeleteItem` sets `is_active=false`) therefore used to withhold cost of goods house-wide, while the page said it had no recorded cost.
- Sold ids missing from the active set are now read once, through the new `loadSoldItemCost`. It reads `restaurant_inventory` plus `inventory_lot_rollup`, for those ids only, and resolves each through the same `resolveUnitCost`. It adds no valuation branch, and OD-100 is untouched.
- Three cases are kept apart:
  - `itemsNoLongerActive`: the row exists and is inactive. The item is costed, and the basis says these rows "read all the same".
  - `itemsNotInBooks`: no `restaurant_inventory` row of this house. The item withholds. The basis, page and export say "no longer in the books (no inventory row)", not "no recorded cost".
  - `itemsCostUnread`: the second read failed. The figure is withheld, and the text says the read failed.
- The second read runs only when an item that moved stock is missing from the active rows.

**`revenue`** is POS line sales of stock items, net of tax and surcharge. It is null on a failed read, on no closed check, or on any unreadable stock line. `salesCoverage` gives the counts, including items that sold without moving stock.

**The margin ratios** divide that cost by those sales. Turns, DIO and GMROI annualise the observed span (at least 28 days, at most 365) against today's inventory at cost. They still need every on-hand row costed (ADR 0053).

**Rework: the two clocks are named.**
- `cogsWindow` carries `firstCheckAt` and `firstMoveAt`.
- When the two are a day or more apart, the basis names both dates and says which side holds nothing for those days.
- How far that moves the ratios is not measured.

**The old figures keep their true names**, `deliveredPurchases` and `shelfValueAtMenuPrice`, and feed no ratio.

### `getRiskProfile` (Decision 5)

`gini` and `hhi` weigh 90 days of POS sales per stock item, over the items the till can sell: every active mapped item (0 when it sold nothing) and every item that sold.
- **An active row no mapping points at is left out.** Weighing it would add a 0 that is not a sales fact. By G' = (nG + k)/(n + k), Tuzlu's 18 unmappable menu rows (A-013) would lift 0.565 to about 0.62 and keep the rule firing.
- **Rework:** an item whose voids outweigh its sales (net below 0) now weighs 0. Before, both the Gini and the HHI dropped it while `itemsWeighed` counted it. Test: 3 weighed, Gini 1/3, HHI 0.5.
- The Gini is null, never "well-distributed", when there is no read, no closed check, or no stock-item sale. The `revenue_concentration` rule (`(gini ?? 0) > 0.6`) does not fire on a null.

### Registry (Decision 7)

- Seven entries are now `computed: false`, and every other description says what its served field reads.
- `cost-honesty.spec.ts` maps every `true` to a field on a real service call. The five entries the test does not call (vendor lead time and price trend, sales correlation, the anomaly z-score and `recommendations`) are mapped to their source lines instead.

### /reports and the export

The ledger register and the export writer print:
- "Sales of stocked items, net (365d)";
- "Cost of goods (365d)" with the new reason;
- "Sell-price valuation" from `shelfValueAtMenuPrice`;
- the "N of M items that sold carry a recorded cost" note. **Rework:** the note now has a "no longer in the books" variant and a "could not be read" variant.
- a note for lines naming no stock item, and a note for items sold without moving stock.

### "Never raises" narrowed (rework)

The migration header, the COMMENT and Decision 8 used to say no line raises. They now say:
- A malformed line is counted, not raised.
- A line the gateway ingest wrote cannot raise, because `pos-adapters.ts` `num`/`cents` coerce to finite numbers. This holds for the generic and CSV adapters too.
- A numeric string past `numeric`'s range, written directly with the service role, raises for the whole call. The gateway reads that as a failed read, so the figures go null (ADR 0067).

### What Tuzlu should see (derived, not measured)

- **Cost of goods.** It and the ratios built on it will likely read a dash, with "N of M items that sold carry a recorded cost", until its uncosted rows carry a cost. That is the stated cost of the founder's pick: a dash where a wrong $39,302.50 stood. Deleted items no longer cause that dash.
- **The Gini.** It should land near 0.55-0.565 (ADR 0298, Consequences). That is below the 0.6 line, so the "very few wines" advice should stop.

## Response to the BLOCK at `847f2470d`

1. **Decisive: a soft-deleted sold item withheld cost of goods and was described as having no recorded cost.** Fixed (above). Six pins are added in `cost-honesty.spec.ts`:
   - a retired row with `last_purchase_price` (cogs 90);
   - a retired row with lot WAC (cogs 110);
   - a retired row with no cost (withholds, says so);
   - no row ("no longer in the books");
   - a failed read ("could not be read");
   - no second read when every sold item is active.

   The page and export specs pin the two new sentences.
2. **"Never raises" too broad.** Narrowed. The SQL test's T11 (the largest finite double as price and qty reads) and T12 (a 140,000-digit price string raises `22003`) pin both halves.
3. **Negative net sales unclamped in the weighed set.** Clamped to 0, with a test.
4. **Window/span mismatch unflagged.** The function returns both clocks. The basis names them when they are 1 day or more apart (SQL T10 plus 3 gateway pins). A sale the ledger refused **in part** cannot be measured from the database: a refusal is counted only in the import's `stock.failed`, and glass pours write one row per opened bottle. It is recorded as open in ADR 0298's Consequences and named in one clause of the cost basis.

## Tests, guards and the local Postgres

### At `429c975e3` (last call, my runs)

**Gateway jest** (`--runInBand --forceExit`):
- `src/analytics src/reports src/mcp-server`: **65 suites, 1047 tests, all passed**.
- The four touched specs (`cost-honesty`, `absent-not-zero`, `report-export-cuttings`, `report-exports.service`) plus #621's `tables-learned-from-the-pos.spec.ts`: 5 suites, **162/162**.

**Web vitest.** `ReportsNext.test.tsx` and #621's `tables-learned-from-the-pos.test.tsx`: 2 files, **95/95**.

**Typecheck.** Gateway `tsc -p tsconfig.spec.json` and web `tsc` are clean apart from the known `@simplewebauthn` errors.

**Lint.** Eslint on the one edited spec: 0 errors and 0 warnings, the same as before the edit.

**Claims.** `env LC_ALL=C bash scripts/check_decision_claims.sh`: **901 checked, 901 holding**.

**Guards.** Each of these exits 0, and so does its `--self-test`:
- adr_numbers_unique, migration_versions_unique (origin/main + 71 open PRs)
- analytics_cost_honesty, read_errors_not_swallowed, read_columns_exist, queried_tables_exist
- web_reads_gateway_dto_keys, windowed_figures, money_states_its_currency
- migration_probe_safety, no_conflict_markers, citation_pairing
- test_scripts_are_real, od_ids_exist, new_tables_are_locked_down, lot_cost_provenance

Two guards need a note:
- `migrations_single_home` exits 0 and has no self-test.
- **`migration_order` FAILS**: main's #621 `20261222230000` is newer. The renumber is owed at the merge step (top of this body).

**Ownership.** `ownership_between(origin/main, HEAD)` is `[]`.

**Size and state.** 15 files changed against `origin/main` (at the cap). The worktree is clean.

**SQL on the local Docker Postgres.** This is from `pgtest.sh lane`, re-run at `429c975e3` and appended to `p4-scratch/sim-run/fixes/audits/proxies-local-pg.txt`:

```
applied 7 migration(s) to proxies_fix
[fix] PASS 20261222200000_cost_of_goods_reads_what_sold_test.sql
[ctl] FAIL 20261222200000_cost_of_goods_reads_what_sold_test.sql: ERROR:  function public.pos_item_sales(uuid, timestamp with time zone) does not exist
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=7 tests=1
```

The rework's builder also ran the new test against a database carrying `847f2470d`'s version of the migration (cloned from the template, then dropped). Quoted from the same file:

```
[847f2470d migration] FAIL: ERROR:  T10 FAIL first_check_at , expected <now()-3 days>
```

The test uses synthetic fixtures in one transaction that is rolled back. Every block RAISEs on failure. Blocks T1-T12 cover:
- per-item sales, units and lines (string numbers read);
- voided, open, pre-window and other-house checks excluded;
- unmapped and unreadable lines counted (a bad qty, a bad id, a non-object line);
- POS sale/return netting, with manual, waste and shadow rows excluded;
- `first_sale_at`;
- the grant (SECURITY INVOKER, service_role only);
- `mapped`, including cross-house mappings flagging nothing;
- the index;
- the two clocks (T10);
- the largest finite double (T11);
- the numeric overflow raise (T12).

Round 1's four one-line SQL mutations each failed the test: no tenant join on mapped items, every item flagged mapped, no mapped items in the id set, and mappings read from any house.

### At `d10e86ed9` (builder and verifier; quoted, not re-run at the last call)

**Fail without the fix, builder.**
- With `847f2470d`'s `analytics.service.ts`, export writer and web register put back, 10 gateway pins fail and pass again at the fix: 5 cost pins, 2 clock pins, 1 Gini/HHI clamp pin and 2 export-note pins.
- 2 web pins behave the same way.

**Fail without the fix, verifier.**
- Against `origin/main`'s sources, 41 of 106 jest tests in the touched specs fail, and 5 web tests fail.
- All pass at the fix.

**Mutations.** Each of the CLAIMS row's 4 new checks fails at `847f2470d`, and one mutation of each fails only that check.

**Verifier's local benchmark.** `pos_item_sales` took about 4 s for 70,000 checks over 365 days (synthetic data, rolled back).

## ADR, CLAIMS and docs touched (15 files, at the cap)

- **ADR 0298** `cost-of-goods-is-what-sold-and-concentration-reads-the-till`, plus its row in `.planning/decisions/README.md` (a row this branch adds; no existing row is edited).
  - Status: Proposed for the method, with the three founder rulings quoted.
  - The rework updated Decisions 1, 4, 5 and 8, the Consequences (partial ledger refusal recorded as open) and the review trail.
  - The last call corrected two sentences in Decisions 7 and 8 and added a review-trail row:
    - Decision 7 said "three lenses"; there are five entries.
    - Decision 8 now names the non-object line.
- **CLAIMS** `claims.d/fix-cost-of-goods-reads-what-sold.jsonl`: one row, status `resolved`, with **13** static checks:
  - rpc, cogs, nomove, skuRevenue, weighed, mapped;
  - invoker, revoke, drawdown;
  - and, from the rework: retired, clamp, clocks, raises.
- `scripts/sql_outside_migrations.txt`: one line for the new test file. The diff also moves one line, the ledger test, below it; the list is unordered.
- Code: the migration and its test, `analytics.service.ts`, `metric-registry.ts`, `report-export-cuttings.ts` and `rp-registers-house.tsx`. Spec and test files: `cost-honesty`, `absent-not-zero`, `report-export-cuttings`, `report-exports.service` and `ReportsNext.test.tsx`.
  - `report-exports.service.spec.ts` changes one pin, `withheld_count` 8 → 9: one more figure is withheld when sold cost is incomplete. The verifier checked that reason against the code.

## Founder answers (verbatim, binding)

- **Cost gaps** (AskUserQuestion, 2026-10-04 ~20:50Z): *"Withhold, say N of M (Recommended)"*.
  - Built as worded. Cost of goods, the COGS ratio, gross margin, prime cost, turns, DIO and GMROI read a dash.
  - The page and the export say "N of M items that sold carry a recorded cost", or name the "no longer in the books" or "could not be read" case.
  - Exact per-sale cost is named as the ADR 0115 D3 follow-up.
- **AW17** (AskUserQuestion, 2026-10-04 ~00:15Z): *"Net sales (Recommended)"*, with the option text 'Use the subtotal before tax and surcharge, as /team already does and as restaurant P&Ls do. The tip rate is on net. Every figure is labelled net.'
  - The sales figure is before tax and surcharge, and it is labelled "net".
  - Per-item sales cannot read the check subtotal, which includes food. So line price × qty is used, and the basis says check discounts are not apportioned.
- **Partial no-move** (AskUserQuestion, 2026-10-05T01:39Z): *"Show it, name the gap (Recommended)"*.
  - When only **some** items sold without moving stock, cost of goods stands over the items that moved stock.
  - The count of the others is named in the basis and in a page note, as built.
  - Recorded in ADR 0298, Status and Consequences.

## Forks deferred (the founder's)

1. **Discount apportioning.**
   - Check-level discounts are not spread over lines, so "Sales of stocked items, net" is before check discounts. It is named in the basis and in ADR 0298's "Revisit when".
   - Options:
     - (a) leave it unapportioned and named (as built);
     - (b) apportion each check's discount over its lines by line value;
     - (c) show the house's total check discounts beside the figure.
   - Recommendation: (a) until netsales' ADR 0295 settles what "net" means for check totals, then (b), so both "net" figures mean the same thing.
2. **Measuring a partial ledger refusal.** This needs a per-line record of a refused stock write: a schema choice the pos-hub owner should make. It is recorded as open in ADR 0298, not decided here.

## Merge-order notes

**Renumber at merge.** See the top of this body: past `20261222230000` (#621), keeping the relative order with booth #618 `20261222210000` and zoneaddr #620 `20261222220000`, which are also behind main now.

**Follow-up that must merge straight after this PR:** `fix/goal-book-cogs-reads-the-till` @ `1b5d5b89a` (local branch, not pushed; one file, `goal-scenarios.ts`).
- Once this PR lands, the goal book's `food_cost_pct` "needs" text says `cogsRatio` runs "over a sell-price valuation of purchased stock". /reports' goals register prints that text, and it becomes false.
- The follow-up corrects it. It is stacked on this branch's first commit, `0c46277cd`.
- After the squash, replay only its own commit: `git rebase --onto origin/main 0c46277cd fix/goal-book-cogs-reads-the-till`.

**Shared files with open PRs.** These are trial `git merge-tree` runs of each PR head against `d10e86ed9`; no refs were touched.

| PR | Shared with this branch | Trial merge result |
|---|---|---|
| **#609 cap** | `analytics.service.ts`, `README.md` | Clean |
| **#615 netsales** | the export writer and its spec, `rp-registers-house.tsx`, `ReportsNext.test.tsx`, `README.md` | Only `README.md` conflicts |
| **#616 tz** | `analytics.service.ts`, the export writer and its spec, `README.md` | Only `README.md` conflicts |
| **#619 stockout** | `analytics.service.ts`, the export writer, `rp-registers-house.tsx`, `ReportsNext.test.tsx`, `README.md` | Only `README.md` conflicts |
| **#618 booth**, **#620 zoneaddr** | `README.md`, `scripts/sql_outside_migrations.txt` | Both conflict (list appends) |
| **#628** | `scripts/sql_outside_migrations.txt` | Conflicts |
| **#624** (stacked on #619) | `README.md`, plus a file outside this PR | Conflicts only on `README.md` and `insight-generator.service.ts`; `insight-generator.service.ts` is not in this PR |
| **#626 units** (stacked on #609) | `analytics.service.ts`, `cost-honesty.spec.ts`, `absent-not-zero.spec.ts`, the export writer, `sql_outside_migrations.txt`, `README.md` | **Real content conflicts** in `analytics.service.ts` and `cost-honesty.spec.ts`, beyond `README.md` and `insight-generator.service.ts` |

- **#626, `analytics.service.ts`.** One hunk in `getRiskProfile`'s daily demand series, beside this PR's concentration block. This PR does not change that series, so take #626's side.
- **#626, `cost-honesty.spec.ts`.** One hunk.
- **List conflicts.** Keep both rows: by number in `README.md`, by version in `sql_outside_migrations.txt`.

**Meaning across lanes.**
- **netsales' ADR 0295** defines "net" from the check subtotal. This PR's "Sales of stocked items, net" is line price × qty, which is *before* check discounts, and its basis says so. Whoever merges second should keep the two bases visibly distinct (fork 1).
- **postime (#603, merged)** dates POS ledger rows at check close. That sharpens this read's `transaction_date >= since` window and the `first_move_at` clock. There is no code dependency.

**No stacking.** This PR needs no other lane's code.

## Not covered (shortcuts, stated per CLAUDE.md §0.5)

**Owner numbers and effects not measured**
- **Tuzlu's new numbers.** No production read was allowed. The Gini of about 0.55-0.565 and the "likely dashes" for cost of goods are derived in ADR 0298, not observed. A read-only check after deploy should confirm both.
- **The effect of the clock gap on margin, turns, DIO and GMROI** is not measured. The gap is only named, per house, when it is 1 day or more.
- **A partial ledger refusal** is not measured (fork 2). It has no tech-debt entry: that would make this PR 16 files. A follow-up should file one.

**SQL proof limits**
- **The pgtest template is `28d32de36`, not main.** Main's newer migrations ran as lane migrations (7). I did not rebuild the template; that is the coordinator's job.
- **T11 and T12 do not fail on the old function.** They pin behaviour that did not change (where the function can and cannot raise). The only SQL pin that fails on `847f2470d`'s migration is T10.
- **Two DB-backed guards could not check:** `check_definer_functions_closed` and `check_migration_ledger` (no DB URL; neither was pointed at production). The migration's own DO block asserts SECURITY INVOKER and the grants.

**Failed reads and wording edge cases**
- **"Could not be read" names a cause it has not confirmed.** When the second read fails, the text says the item's row "is no longer active". The item was missing from the active read, but if it has no row at all, or the active read itself failed (`loadInventory` degrades a failure to `[]`, pre-existing), "no longer active" is unconfirmed. Reaching this needs a failed database read. The figure is withheld either way.
- **A failed inventory read and the Gini (pre-existing loader behaviour).** The Gini still prints over the items that sold. It then leaves out the mapped items that sold nothing, so it reads lower than the truth, with no signal.
- **A non-object line in `pos_checks.items`** is counted as unreadable, which withholds sales. The sales basis then says the line "names a stock item". Ingest writes only objects, so only a direct service-role write reaches this. ADR 0298 Decision 8 names it.
- **The returns-only window.** When a window's only movement is returns, the sales text does not say net sales were at or below 0. It shows the generic sentence.
- **Every POS line unmapped.** Stocked-item sales then read $0, not null. The unmapped-lines note discloses it. Cost of goods and the Gini are null in that case.

**Scale, latency and pins**
- **`loadSoldItemCost` reads with one unchunked `.in('id', ids)`.** A house with a few hundred deleted items that sold in a year could exceed the URL limit. It would then read as "could not be read" (a withheld figure, not a wrong one). That is not reachable at Tuzlu's size, and no chunking was added.
- **`pos_item_sales` is not cached.** `/analytics/overview` calls it twice, once for 365 days and once for 90. The verifier measured about 4 s at 70,000 checks per year on synthetic data. Tuzlu's till holds a few thousand checks: the #621 production dry run linked 3,635 checks across every house. No production latency was measured.
- **Untested filter.** The `bottlesOut > 0` filter (net-returned items kept out of `soldRows`) has no test that kills its mutation.

**Owed outside this PR** (listed in ADR 0298 Consequences)
- the goal-book text, false between this merge and the follow-up's (see Merge-order notes);
- the `days_of_inventory` goal's refusal text (`goals.service.ts`);
- the vendor scorecard's `leadTimeStdev` note;
- the "Revenue rides on very few wines" copy (lane rec, A-063);
- `maxDrawdown` (TECH-DEBT defect 4);
- the "eight figures" comments in `Cutting.tsx` and `rp-catalogue.tsx`;
- the export-render spec fixture's old cogs reason.

**Housekeeping**
- **Lint warnings stay.** The pre-existing prettier warnings in `report-export-cuttings.ts` and the two export specs were left in place. None is new.
- **Commit bodies.** The first commit body (`0c46277cd`) stated the walk's truth Gini 0.5651 as if it were this code's output. ADR 0298 and this body correct that. The squash message should use this body.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
