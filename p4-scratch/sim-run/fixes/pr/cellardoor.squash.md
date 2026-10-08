The cellar's First bought and Paid now count the price checked at the door, labelled 'door-checked' (A-045, ADR 0301 §2).

**What was wrong.** /cellar read First bought and Paid only from filed invoice documents. Tuzlu files no paper, but every delivery's bill is checked at the door. So the cellar showed none of those prices, though /inventory already costs the same lots at the checked price.

**What changed**
- **Migration `the_cellar_counts_the_door_checked_price`.** It reads only and changes no row.
  - It adds `public.house_door_checked(p_restaurant_id)`, one row per door-checked order, service_role only.
  - An order counts only when its match is verified, it has one named line, a `receipt_verified` bottle price exists, and the door accepted more than 0 bottles.
  - It drops out once an invoice is linked to the order or its line is paired with the order's line. An invoice filed with neither counts alongside it (ADR 0301 amendment 1).
  - `house_beverage_ledger`'s bought block folds those rows in next to the invoice lines. Three columns are appended (`door_checked_lines`, `first_bought_door_checked`, `last_bought_door_checked`), so the first 31 keep their places.
  - The invoice book and its label stay the paper's alone.
- **Gateway `house-record.ts`** maps the three new columns into the house record's bought block (`doorChecked`, `firstDoorChecked`, `lastDoorChecked`). A row bought only at the door now has a bought record.
- **Web** (`registerCells.tsx`, `HouseRecordLeaf.tsx`, `cellar-format.ts`, `cellar-columns.ts`, `useCellarNextData.ts`):
  - A door-checked figure is marked 'door-checked'.
  - A Paid that adds both books reads 'door-checked + invoiced'.
- **Record.** ADR 0301 records the founder's pick, verbatim *"Door-checked, labelled (Recommended)"* (AskUserQuestion, 2026-10-04). Its amendments 1–4 are the coordinator's, under the founder's 2026-10-07T20:04:10Z delegation.
  - Amendment 4's cross-house pairing was fixed on main by #653.
  - The decision index row's correction is its own PR, #658, which waits for the founder's word. Until it merges, ADR 0301 point 1, not the index row, says what §2 counts.

**Evidence**
- **Local Postgres** (`pgtest.sh lane`, template `214779a76`; main `b30ca260e` adds no migration):
  - [fix]: the door, till and menu tests PASS.
  - [ctl]: the door test FAILS at T1, and the till and menu tests PASS, because they pin kept behaviour.
- **Web vitest** `src/pages/cellar` + `src/pages/beverages`: 15 files, 304 passed.
- **Decision claims:** 942/942.
- **ADR 0090 audit:** BLOCK at `0c5e3b55e`, on the record. A fresh full audit PASSED at `c21caa2c9` (comment 6049332419).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
