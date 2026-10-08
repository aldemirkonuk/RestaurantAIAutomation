**Title:** fix: the first menu reads from the house, splits by its kitchen_line, and a tab's reading is its reader's

> **New head `7f4576516`** (branch `fix/the-first-menu-reads-from-the-house`; on top of the blocked head, `786464155` merges origin/main `be9a16ccf` cleanly, then `7f4576516` is the rework). **15 files** vs origin/main, web and `.planning` only: no gateway file, no migration, no production read or write. Local only: not pushed.
>
> The ADR 0090 audit **BLOCKed this PR at `2d81f8a5d`** (`p4-scratch/sim-run/fixes/audits/656-2d81f8a5d/report.md`; both reviewers approved with notes, and the final adjudication overturned them). That BLOCK is permanent. This head is new work and needs a fresh full audit; nothing here claims it has passed one. Each blocker, and each refute hole that touches this PR, is answered in the table at the end of "Decision".
>
> **Merge order: #655 first** (`fix/a-menu-line-carries-its-raw-line`, head `18c2de14e`). Then this branch merges main and is re-verified. Neither PR may merge at its old head: `220e3747d` plus `2d81f8a5d` together send a CSV's whole row to staff and draw it on `/house/menu`.

## Why

The scenario walk of 2026-10-07 found three P1s and one P2 on a new house's first menu (cites in this list are at `ca3582988`, as in ADR 0309's Context):

- **MENU-07 (P1), `/house/menu` and `/house`.** The first proof lived only in this tab's `sessionStorage` (`firstProof.ts:45`, `readProof()`), though the menu itself is kept on the server as a draft (ADR 0193). A new tab, a reload or another device showed *"No menu has been read yet."* for a house that has a menu. The reading carried no house either: after a house switch in the same tab, the page showed the other house's lines, and *Add it.* posted to the other house's menu id (`HouseMenu.tsx:135`).
- **SETUP-01 (P1).** That false empty state had a button to `/get-started` (`HouseMenu.tsx:85`, `:100`). `/get-started` had no entry check, so the person started sign-up again, and creating the house failed with 409 *"This account already has a house"* (`auth.service.ts:1662`).
- **SETUP-11 (P1).** The setup nudge's *Finish setup* sent every owner and manager to `/get-started` (`SetupNudgeBanner.tsx:54`).
- **MENU-08 (P2).** Placing a pencilled line and adding a missing line had `try … finally` with no `catch`, so a refused save said nothing.

**Why this head exists.** The audit at `2d81f8a5d` found that ADR 0309 option 1c said *"One menu then gives one pencilled count in every tab"*, and claims row 12 encoded it, while `matched` and `needsReview` come only from the tab's own reading. The audit of #655 then found that the raw line option 1c relied on is, for a CSV, the whole row: every column, cost, supplier and margin included (`csv-parser.service.ts:55`; `HEADER_MAP`, `:5-29`, maps none of them). Sending it to every member broke ADR 0145's ROLE_POLICY staff row (`reading-data-classes.ts:182`).

**What the server's raw line adds, on reachable states** (refute A5). The first-proof wizard writes only scan readings (`GetStarted.tsx:251`), and a scan keeps no raw line since 548cc9aea, 2026-08-13 (`scan-parser.service.ts:35`). So no tab today holds a CSV reading. What #655 and this PR add is the raw-text half of the decided kitchen test for lines read back from the server: a CSV text import through `/menu`, and scans read before 2026-08-13. A holder also gets the raw-line quote. A workbook (XLSX) import keeps no raw line (`parseExcel`, `csv-parser.service.ts:70-110`), so its lines split by section alone.

## What changes

**`apps/web/src/lib/firstProof.ts`**
- `useHouseProof(restaurantId, userId)` (`:238`) reads `GET /menu-versions`, picks one menu, and reads `GET /menu-versions/:menuId`. It answers `loading`, `failed(reason)`, `none` or `ready`. Its effect depends on `[restaurantId, userId, attempt]` (`:284`).
- `pickHouseMenu` (`:168`) picks the current menu, else the newest draft whose `linesExtracted` is not `0` (null counts as unknown), else the newest kept menu.
- `proofFromServer` (`:186`) takes name, section and prices from the stored line, and:
  - `rawText: line.raw_extracted_text ?? read?.rawText ?? null` (`:201`);
  - `kitchenLine` from the gateway's `kitchen_line` when it is a boolean, else null (`:202`);
  - `rawLineWithheld: line.raw_line_withheld === true` (`:203`);
  - `matched` and `needsReview` only from the tab's own reading (`:204-205`), unchanged.
- `isKitchenLine` (`:79-83`) returns the house's `kitchenLine` first. With none (a gateway without #655) it falls back to the section and the raw line this viewer has, with `KITCHEN` (`:58`) unchanged.
- **The tab's reading is its reader's** (A6):
  - `readProof(restaurantId, userId)` returns nothing when either id is missing (`:100`), or when the stored reading has no person or another person (`:106`).
  - `writeProof(result, restaurantId, userId, image)` writes nothing without both ids (`:123`), and stamps both (`:124`).
  - `markProofLine` has the same two guards (`:143`, `:149`).
- `ProofLine.matched` is `boolean | null`. `lineNeedsPencil` pencils only `matched === false`, so an unknown match is pencilled by its section alone.

**`apps/web/src/services/api/menus.ts`**
- `getMenuVersion(menuId)` wraps `GET /menu-versions/:menuId`.
- `MenuLine` adds `raw_extracted_text?: string | null` (`:192`), `kitchen_line?: boolean` (`:194`) and `raw_line_withheld?: boolean` (`:196`). Its doc says the raw line is sent only on that route to an owner or a manager, null when none was kept, and absent otherwise or from an older gateway. `MenuVersionDetail` adds `rawLineWithheld?: boolean` (`:420`).

**`apps/web/src/lib/houseLater.ts`** (A6, refute H10)
- `readLastInvoiceLater(restaurantId, userId)` and `writeLastInvoiceLater(restaurantId, userId, name)` stamp the noted file name with the house and the person. With either id missing, nothing is written or read. The words stay *Last invoice · noted — <name>*, with *"Only its name is noted, in this tab: the file is not sent, read or kept yet."*

**`apps/web/src/pages/HouseMenu.tsx`**
- Reads through `useHouseProof(activeRestaurantId, userId)`, with `userId = user?.userId ?? null` (`:76-77`). The web `User` has `userId` and no `id` (refute H6).
- A failed read shows `role=alert` with the reason and *Try again*. No kept menu shows *Read a menu*, which leads to `/menu`.
- It says where the menu stands: current, *"Kept as a draft — not the house's current menu, and none of its prices are the house's yet. …"*, or retired.
- When any line's match is unknown, it says pencils follow the section alone.
- A line's quote shows its raw line when this viewer was sent one. Under a line that says `raw_line_withheld` (`:346`), it says *"The whole line as it was read is shown only to an owner or a manager: a file's row can carry its costs and suppliers."* (A1). A line with no raw line kept gets no such sentence.
- *Add it.* posts to the server's menu id. A refused place shows *"This line was not placed: …"*; a refused add shows *"The line was not added: …"* (MENU-08). A placement is kept in the reader's reading (`:198`).

**`apps/web/src/pages/HouseContents.tsx`**
- The Menu row reads the same hook with the same person (`:15-16`) and shows loading, a failure with *Try again*, *No menu read yet* (→ `/menu`), or the pencilled count. The invoice note is read and written with the person (`:25`, `:45`).

**`apps/web/src/pages/GetStarted.tsx`**
- Decides once on arrival: a session with a house → `/house`; a listed house or held membership → `/choose-house`; unverified → `/verify-email`; a failed check → an alert with *Try again*, never the wizard; otherwise the wizard.
- The reading it keeps is written with `writeProof(pendingResult, activeRestaurantId, user?.userId, sourceImage)` (`:146`).

**`apps/web/src/guidance/components/SetupNudgeBanner.tsx`**
- *Finish setup* → `/house`.

**`.planning/decisions/`**
- **ADR 0309**, bracket-corrected in place (`[Corrected 2026-10-08, coordinator: …]`): Context (a CSV's raw line is the whole row; XLSX keeps none); option 1c (what was false, the amended 1c, what it delivers, the options rejected); option 1d (the person stamp, as hardening); option 5 (the arrival check does not read `accessEnded`, `NoAccess.tsx:56`); the Decision bullets; the staff-and-money paragraph; owed 5, and new owed 7 (dessert) and 8 (the kept source file); the evidence counts; and three review-trail rows.
- **README row 0309**: a bracket correction after the raw-line sentence.
- **`claims.d/fix-the-first-menu-reads-from-the-house.jsonl`**: rows 1, 2, 11 and 12 are bracket-corrected and their verify strings updated. Four rows are new (16 in all), listed under Evidence.

## Decision

**Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, not by the founder.** The founder, verbatim:

> "Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research."

The two BLOCKs led the coordinator to amend ADR 0309 option 1c under the same delegation. A research workflow (`wf_4b1156ad-fce`) chose **option (h)**: every member gets a server-computed `kitchen_line`; the raw line goes only to a holder (a role whose ROLE_POLICY row sees both money and suppliers: owner, manager, and admin through the owner alias); reads withhold it by default. An adversarial refute found eleven holes (H1-H11) and nine amendments (A1-A9). This PR and #655 build all nine between them. The amendment applies rules that are already locked (ADR 0145's staff row), so it adds no new ADR.

Coordinator choices inside (h), recorded as the coordinator's, not the founder's:

- **A4:** the `/source` refusal stays out of #655, as its register entry (i). Every "Staff get no raw CSV row" and "fails closed" wording is struck. ADR 0309's staff paragraph says instead that this read withholds the raw line, and that the kept file still reaches any member (register entry (i)) until its lane lands.
- **A8:** `GET /menus/:restaurantId` and the arrival bootstrap pass `{ rawLine: false }` for everyone (on #655). Only `MenuVersionsController.one` uses `seesRawLine(role)`.
- **A1:** the sentence is per line, on `raw_line_withheld`, not on a missing `rawText`. The root marker stays `rawLineWithheld`, not `amountsWithheld`. These replies still carry the sale prices to every member until MENU-02, so `amountsWithheld: true` would be false. #655 writes why at `menu-line-view.ts:18-23`.
- **A6:** stamp with `user?.userId`; fail closed on any missing id (read, write and mark); stamp the invoice note (houseLater) with the person too, rather than dropping the shared-tab argument. Sign-out clears no `sessionStorage` key (`logout`, `AuthContext.tsx:997`, through `endSession`, `:958`), so the stamp is hardening for a shared tab, not a closed leak: the wizard keeps only scan readings, which carry no raw line.

**Rejected options** (detail in ADR 0309's 1c bracket and the workflow's decision):

- **(e) Everyone gets the raw line, prose corrected:** staff would read cost, supplier and margin for every CSV menu imported since 2026-05-11, against ADR 0145's staff row. Superseding a locked rule is the founder's call, not the delegation's.
- **(b) Strip the raw line for non-holders, with no kitchen flag:** the kitchen split would differ by role.
- **(d) A kitchen flag and no raw line for anyone:** it takes the raw-line quote away from holders too, which is more than the locked rule needs.
- **(g) A web-only kitchen test on mapped fields:** it changes the decided kitchen test and turns section-only food rows (Tiramisu) into "Needs a place" pencils.
- **(f) Close #655 and leave the raw line owed:** the raw-text half of the kitchen test stays missing for every line read back from the server.
- **Key the sentence on `!item.rawText`** (the first design): it would say "held back" under a line that never kept a raw line (a scan, an XLSX line, a line added by hand).
- **Drop the shared-tab argument instead of stamping houseLater:** an invoice's file name usually names the supplier, which is the suppliers class.

**How each blocker and hole is answered on this PR**

| Item | Answer |
|---|---|
| BLOCK 1: ADR 0309 1c *"one pencilled count in every tab"* is false (`firstProof.ts:164-165` at `2d81f8a5d`) | 1c is bracket-corrected. A line's match stays with the reading (`firstProof.ts:204-205` at this head), so the pencilled count differs for anyone but the person who read it, in that tab (owed 1). The rejection that rested on that sentence is restated. What 1c gives is **one kitchen split** in every tab and for every role. Test: *"still counts pencils differently in the tab that read the menu (owed 1)"*. |
| BLOCK 2: claims row 12 encodes the same claim | `ADR-0309-THE-ROWS-RAW-LINE-COMES-FIRST` is bracket-corrected. Its verify now slices `proofFromServer`'s body and also pins the tab-local `matched` and `needsReview` lines and the optional `raw_extracted_text` type. Three mutants turn it red. |
| BLOCK 3: the PR body describes older heads | Replaced by this body, measured at `7f4576516`. |
| Audit (#655): #656 draws the raw row on `/house/menu` for any member | The web shows what the gateway sends. With #655, a non-holder's line has no `raw_extracted_text` key. Test: *"splits by the house's kitchen_line and says a held-back raw line is an owner's or a manager's"* (a staff reply whose kept reading belongs to another person). No 38.50, Vini Ltd or 68% appears. |
| The web must fall back cleanly when `kitchen_line` is absent | `isKitchenLine` falls back to the section and the raw line. Tests: *"falls back to the section and the raw line when the gateway sends no kitchen_line"* (firstProof) and *"falls back to the raw line when the gateway sends no kitchen_line"* (ArrivalFlow). |
| A9: XLSX keeps no raw line | Stated in Context and in 1c: XLSX lines split by section alone. |
| A5: a defect no flow can reach | "What the server's raw line adds" above; the ADR drops the claim that staff would read the owner's CSV rows from the tab. |
| H6: the stamp, as designed, used `user.id` and failed open | `user?.userId`; `!restaurantId \|\| !userId` and `!proof.userId \|\| proof.userId !== userId` on read and mark; no write without both; `userId` in the deps. Mutants W3-W7 and W11-W12 below. |
| H8: two people in the same tab see different counts | Said in 1c ("for anyone but the person who read it, in that tab"). |
| H10: the invoice note was stamped with the house only | Stamped with the person too; mutants W13 and W14. |
| A1: per-line sentence | On `raw_line_withheld`; mutants W8-W10. |
| Audit note: `/get-started` ignores `accessEnded` | Option 5 now says so, citing ADR 0164's `/no-access` link (`NoAccess.tsx:56`). |

## Evidence

Measured in `/Users/aldemirkonuk/Projects/wt-fix-firstmenu` after merging origin/main `be9a16ccf`. Everything below was run on the contents committed as `7f4576516`. The only edits after the mutation runs were two ADR citations (`GetStarted.tsx:249` → `:251`, and a bracket after an old `firstProof.ts:58-60` cite); the claims check and lanecheck ran after them.

- `cd apps/web && npx vitest run src/lib src/pages/ArrivalFlow.test.tsx src/guidance src/pages/__tests__/GetStarted.cellarRegisters.test.tsx src/pages/menu` → **57 files, 830 passed**, 0 failed. Touched tests: `firstProof.test.ts` 24 cases, `houseLater.test.ts` 6, `ArrivalFlow.test.tsx` 41. No other test file imports the house pages, `firstProof` or `houseLater` (`browserTimezone.test.ts` matches only by name and is in the run).
- `npx tsc --noEmit -p apps/web` → one error, `src/services/api/passkeys.ts(14,81)`: *Cannot find module '@simplewebauthn/browser'* (the known absent package; the file is untouched).
- `PATH=/usr/local/bin:$PATH bash scripts/check_decision_claims.sh` → **961 checked, 961 holding**.
- `bash p4-scratch/sim-run/fixes/tools/lanecheck.sh wt-fix-firstmenu` → six guards rc=0 (`check_adr_numbers_unique` included), files=15, ownership rc=0 `[]`.
- **Vitest mutants**, 15, each applied in the worktree after a `cp -p` snapshot, then run against `firstProof.test.ts`, `houseLater.test.ts` and `ArrivalFlow.test.tsx`, restored and `cmp`-identical. **Every one is red:**
  - W1 `isKitchenLine` ignores `kitchenLine` (3 failed);
  - W2 `kitchen_line` mapped to null (3);
  - W3 `readProof` without the person check (5);
  - W4 `readProof` failing open, the H6 shape (1);
  - W5 `writeProof` without the person guard (1);
  - W6 `markProofLine` without the person check (1);
  - W7 `userId` dropped from `useHouseProof`'s deps (1);
  - W8 `rawLineWithheld` always false (2);
  - W9 the held-back sentence dropped (1);
  - W10 the sentence keyed on `!item.rawText` (1);
  - W11 HouseMenu stamped with `user?.id` (5);
  - W12 GetStarted stamped with `user?.id` (1);
  - W13 houseLater read without the person check (3);
  - W14 houseLater write without the person guard (1);
  - W15 the row's raw line dropped from `proofFromServer` (4).
- **CLAIMS mutants**, 24, each on a scratch mirror (`scratchpad/firstmenu-build/claims_mut.py`); the worktree was untouched. Baseline: all 16 rows exit 0.
  - Row 1 `THE-FIRST-PROOF-READS-THE-HOUSES-MENU`: `useHouseProof` without the person → exit 1.
  - Row 2 `A-TABS-READING-IS-STAMPED-WITH-ITS-HOUSE`: GetStarted with `user?.id`; the stamp without `userId` → exit 1 each.
  - Row 11 `THE-INVOICE-NOTE-IS-STAMPED-WITH-ITS-HOUSE`: the note without `userId`; HouseContents writes without the person → exit 1 each.
  - Row 12 `THE-ROWS-RAW-LINE-COMES-FIRST`: the tab's raw line first; `matched` defaulting to false; `raw_extracted_text` made required → exit 1 each.
  - Row 13 `THE-HOUSE-SAYS-WHICH-LINES-ARE-KITCHEN` (new): the `kitchenLine` preference dropped; `kitchenLine: null`; the `kitchen_line` type renamed → exit 1 each.
  - Row 14 `A-TABS-READING-IS-ITS-READERS` (new): 7 mutants (the read and mark person checks, the write guard, the deps, `user?.id` on either page, marking with null) → exit 1 each.
  - Row 15 `THE-INVOICE-NOTE-IS-ITS-NOTERS` (new): the read check and the write guard → exit 1 each.
  - Row 16 `A-HELD-BACK-RAW-LINE-SAYS-SO` (new): `rawLineWithheld: false`; the sentence on `!item.rawText`; the sentence dropped; the type renamed → exit 1 each.
  - Rows 1, 2, 11-16 each exit 1 against the origin/main web tree.
- **#655's claim rows**, run on a mirror of #655's gateway (`wt-fix-rawline`, `18c2de14e`) with this head's web files: the three resolved rows exit 0. The open row 5, `A-KNOWN-DRINK-SECTION-WINS-OVER-A-KITCHEN-HINT`, stays exit 1, so this web change neither satisfies it nor breaks row 2's `KITCHEN` pin. The open row 4 (`/source`) stays exit 1.

## Not done

- **This head has had no ADR 0090 audit.** The BLOCK at `2d81f8a5d` stands; `7f4576516` needs a fresh full audit, and so does #655's new head.
- **Not verified in a browser or against a gateway.** No local gateway served `/menu-versions`, and production was not read. The web was tested against fixtures shaped like #655's replies, not against #655 running.
- **The design probe was not re-run** on reachable states (refute A5). The reachable states are covered by component tests instead.
- **The pencilled count still differs outside the reading tab** (owed 1: the gateway does not return each line's match).
- **The stamp is not a security boundary.** Sign-out clears no `sessionStorage` key. Forged storage changes only what that tab displays, as the audit found.
- **Open elsewhere, recorded in ADR 0309:** the kept source file reaches any member through *Open file* (owed 8; #655 register entry (i)); sale prices still reach staff (MENU-02); the import reply returns each CSV row to its uploader (#655 entry (iii)); 'dessert' is both a drink section and a kitchen hint (owed 7; #655 entry (ii)); LearnPanel's *Upload Now* still points at `/get-started` (`LearnPanel.tsx:74`); no mounted screen sets the low-stock threshold; `createFirstHouse` checks only `users.restaurant_id` (`auth.service.ts:1661`, `:2626`).
- **Older cites in ADR 0309's Context** are marked as being at `ca3582988`, and the 2026-10-07 brackets as being at their own heads. The 2026-10-08 brackets were checked at this head. Context and those older brackets were not all re-checked line by line.
- Web eslint was not re-run at this head.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
