## fix(cellar): First bought and Paid count the door-checked price, labelled (AW14, ADR 0301 §2)

Lane `cellarledger`, PR-2 of 2. Branch `fix/cellar-door-checked-cost` @ `f8dde42e6`.

**Stacking:** this branch is stacked on PR-1 (`fix/cellar-till-and-door-checked-cost` @ `767c79ae6`, AW10), which is stacked on #606 (`17f991a31`). Open it after PR-1. It merges third, after #606 and PR-1.

**Files:** 15 of this lane's own (`git diff --stat 767c79ae6 f8dde42e6`).

### What was wrong for the owner (Tuzlu Rüzgar)

**A-045 (minor).** /cellar's 'First bought' and 'Paid' read only lines of filed invoice documents.

- **What the owner saw.** `house.bought` was non-null on 0 house rows: 14 beer, 34 spirits, 6 whiskey, 19 non-alcoholic, 7 soft and 11 cocktails. The walk counted 80 rows that carry these figures. At least 50 of them already hold a door-checked cost (Fords Gin $26, Tito's $24).
- **What the app already holds.** Tuzlu files no paper, but every delivery's bill was checked at the door. That gives 470 verified invoice prices on the Anise, Kumdere and Sarnelia dockets. /inventory already costs those lots at the checked price.
- **What the cellar read instead.** It read none of those prices. The billed price showed only as 'Last quote', on 9 products.

### What changed and why

The founder's pick, AskUserQuestion 2026-10-04 ~00:30Z, verbatim: *"Door-checked, labelled (Recommended)"*. The cellar counts the door-checked price, marked 'door-checked', until a filed invoice takes over.

**Migration `the_cellar_counts_the_door_checked_price`** (version `20261221091500`; reads only, changes no row):

- **`public.house_door_checked(p_restaurant_id)`** returns one row per door-checked order (`LANGUAGE sql STABLE`, service_role only). An order counts only when all of these hold:
  - `match_verified_at` is set.
  - It has exactly one order line, with a name.
  - It has a `price_history` row with source `receipt_verified` and unit `bottle`. `verifyReceipt` writes that row only when the bill was in hand. The latest row is used.
  - The latest `reconciled` receipt event that carries `invoice_qty_bottles` accepted more than 0 bottles.
  - No invoice document is linked to the order, and no invoice line is paired with its line.

  The figures:
  - **Paid** is price × accepted bottles, which is what the bill charged. This was cross-read against `computeMatch` and `effectiveUnitCost`.
  - **Date** is `match_verified_at::date`.
  - **Currency** is carried, not converted.
- **`house_beverage_ledger`'s bought block** folds the door rows in next to the invoice lines, for first and last bought, bottles, paid, last unit price and last vendor. The invoice side keeps its own meaning:
  - `invoice_lines`, the 'invoice' book and the label stay the paper's alone, so a door check never lights "invoiced".
  - On the same day, an invoice line wins the mark.
- **Three columns are appended:** `door_checked_lines`, `first_bought_door_checked` and `last_bought_door_checked`.
  - The first 31 columns keep their places.
  - The function is dropped and recreated in one transaction, with its grants and COMMENT re-applied.
  - The PR-1 and #606 SQL tests now pin "the first 31 columns" instead of "exactly 31". Those corrections are bracketed in place.

**Gateway** (`house-record.ts` `toHouseRecord`):

- A bought block can now be filled only by door checks.
- The block carries `doorChecked`, `firstDoorChecked` and `lastDoorChecked`. They are optional, so a ledger read from before the migration still parses.
- The register's scope note now names the prices checked at the door.

**Web:**

- The register marks 'First bought' and 'Paid' with 'door-checked', with the reason on hover.
- On the record's stand, a block with invoice lines keeps its 'invoiced' heading and marks each figure a door check filled. A block only the door fills is headed 'door-checked'. Either way, the block names both tables it was read from.
- The column help for First bought and Paid now says what each counts.

**Speed (local only):** the PR-1 seed plus 400 door orders, 100 of them invoiced:

| Read | PR-1 | This PR |
|---|---|---|
| Ledger | 262-296 ms | 330-434 ms (about 1.27× by median) |
| `house_door_checked` alone | n/a | 36-48 ms |

### Tests, guards, harness (at `f8dde42e6`)

**Unit and component tests:**
- Gateway jest (`src/beverages src/cellar`, `--forceExit`): 150/150, re-run at last call. 4 house-record.spec cases fail on PR-1's `house-record.ts`.
- Web vitest (`src/pages/cellar`): 294/294, re-run at last call. 3 new CellarNext cases fail before the change.

**Static checks:**
- Typecheck shows only the known simplewebauthn errors.
- eslint: 0 errors.
- All `scripts/check_*.py` that can run locally exit 0, as on PR-1. That includes `check_migration_order` (3 lane migrations after `28d32de36`) and `check_adr_numbers_unique`.
- `check_decision_claims.sh`: 865/865 hold.
- Claims mutations: 24/24 caught.

**SQL mutations of the migration:** 21 run, 20 caught. The one survivor is the `stage = 'reconciled'` filter. It is an equivalent mutant: `procurement_receipt_events_invoice_qty_bottles_check` already forbids `invoice_qty_bottles` unless the stage is `reconciled`.

**Local Postgres:** last call re-ran `pgtest.sh lane` at `f8dde42e6`. Output appended to `p4-scratch/sim-run/fixes/audits/cellarledger-local-pg.txt`:
```
[fix] PASS 20261219120000_the_ledger_lists_only_the_current_menu_test.sql
[fix] PASS 20261221090000_the_cellar_reads_the_tills_own_record_test.sql
[fix] PASS 20261221091500_the_cellar_counts_the_door_checked_price_test.sql
[ctl] FAIL 20261219120000_the_ledger_lists_only_the_current_menu_test.sql: ERROR:  T1 FAIL the current menu's line reads menu_lines = 2, expected 1 (the archived copy is still counted)
[ctl] FAIL 20261221090000_the_cellar_reads_the_tills_own_record_test.sql: ERROR:  T1 FAIL the rakı reads pos_lines = 0, expected 1 (the till rang it once)
[ctl] FAIL 20261221091500_the_cellar_counts_the_door_checked_price_test.sql: ERROR:  T1 FAIL first_bought = , expected 2026-08-03 (the door check)
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=3 tests=3
harness exit 0
```
The new test also fails in all 13 blocks on the PR-1 state.

**What the 13 blocks cover:**

| Blocks | What they pin |
|---|---|
| T1-T2 | A door-only order fills the bought block; Paid uses the accepted bottles. |
| T3 | The latest bottle price is used. |
| T4-T5 | A linked invoice, or a paired invoice line, takes over. |
| T6-T8 | No door check, no checked price, or two lines means no door row. |
| T9-T10 | Invoice and door together; the invoice wins a same-day tie. |
| T11 | The browser roles cannot execute the functions. |
| T12 | The signature and the first 31 columns are unchanged. |
| T13 | Another house's door check never reaches this one. |

### ADR and CLAIMS touched

- ADR 0301 §2 is now marked built. Its review trail has a 2026-10-05 row.
- `claims.d/fix-cellar-door-checked-cost.jsonl` adds 3 new rows.
- No README row is touched; the 0301 row came with PR-1.

### Forks deferred (the founder's call)

1. **A door check that saw no bill.** It has no checked price, so today it does not count as bought.
   - **Options:** (a) keep it out; (b) count its bottles with no price, marked.
   - **Recommendation:** (a). A price nobody checked is not a purchase price, and the order book already shows the order.
2. **Whether a door check lifts a row in the ledger's order** ("most books first") the way an invoice does.
   - **Options:** (a) no, a door check is not a book; (b) count it as one.
   - **Recommendation:** (b). It is cheap and it only re-orders rows, but it was not asked.

### Merge order

- **Merge order:** #606, then PR-1, then this PR. After each squash, merge `origin/main` in and resolve by later truth. If #606 or PR-1 changes the ledger body, carry its current body into `20261221091500`.
- **#606's SQL test:** this PR edits `supabase/tests/20261219120000_the_ledger_lists_only_the_current_menu_test.sql` (bracketed, pinning the first 31 columns). If #606 edits that test again before merging, this PR conflicts there.
- **Migration version:** `20261221091500` sorts before #591 (`20261221093000`) and #620 (`20261221100000`). If either merges first, the version moves past theirs at merge.
- **Shared files:** `scripts/sql_outside_migrations.txt` is append-only.
- **Deploy window:** between this migration and the gateway that reads the new columns, door figures show without their 'door-checked' mark. No row changes.

### Not covered (CLAUDE.md §0.5)

**Production was never read**, so how many Tuzlu rows gain a door-checked First bought and Paid is not counted. "At least 50 of 80" is the walk's estimate. Production rows written by an older `verifyReceipt` (no `receipt_verified` bottle row, or no bill-bearing reconciled event) are not counted. Read-only upper-bound SQL the coordinator may ask the founder about (not run):
```sql
SELECT count(*) FROM public.procurement_orders o
WHERE o.restaurant_id = '<tuzlu id>' AND o.match_verified_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.price_history h WHERE h.restaurant_id = o.restaurant_id AND h.order_id = o.id
              AND h.source = 'receipt_verified' AND h.unit = 'bottle')
  AND EXISTS (SELECT 1 FROM public.procurement_receipt_events e WHERE e.restaurant_id = o.restaurant_id AND e.order_id = o.id
              AND e.stage = 'reconciled' AND e.invoice_qty_bottles IS NOT NULL AND e.counted_qty_bottles > 0);
```

**Gaps in what this PR does:**
- **An invoice filed but neither linked to the order nor paired with its line does not take over.** Its bottles and money count alongside the door row, so that delivery is counted twice. Tests T9 and T10 pin this behaviour. ADR 0301 states the take-over rule (linked or paired) but does not name this limit. Tuzlu files no paper, so this does not arise there.
- **The opened Paid ledger and RowExpander still list invoice lines only.** That covers 'Last paid, each', Markup and the 'invoiced' tag (AW13's lane). The Paid column's help says so.
- **The row order ignores door checks** (fork 2).
- **Dates and currencies:** door checks are dated `match_verified_at::date`, not by fact time (ADR 0286, #612) or the house's day (ADR 0296, #616). Currencies are carried, not converted.

**Process shortcuts:**
- The second migration version is `…091500`, not the brief's "+1-59 on the last four digits" (`…090001-090059`). It is unique and sorts correctly, and it sits below #591 exactly as `…090000` does.
- There was no Browser-pane check of the marks. The vitest DOM tests stand in for it.
- The DB-backed guards (`check_definer_functions_closed` and seven others) cannot run locally. `house_door_checked` is not SECURITY DEFINER.
- Speed was measured on a local synthetic seed only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
