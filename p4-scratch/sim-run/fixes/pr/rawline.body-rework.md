**Title:** fix: a menu line read back says whether it is a kitchen line, and only a holder gets its raw line

> **New head `18c2de14e`** (two commits: the fix `987d471d5`, then `18c2de14e`, a one-line comment fix pointing `menu-line-view.ts` at the register fragment's real file name) (branch `fix/a-menu-line-carries-its-raw-line`, merge-base origin/main `62f8967b4`; origin/main has since moved one commit to `be9a16ccf`, not merged here). The ADR 0090 audit **BLOCKed this PR at `220e3747d`** (`p4-scratch/sim-run/fixes/audits/655-220e3747d/report.md`). That BLOCK is permanent: this head is new work and needs a fresh full audit; nothing here claims it has passed one. How each audit blocker and each refute hole that touches this PR is answered is in the table at the end of "Decision".

**9 files** vs origin/main, gateway and `.planning` only: no web file, no migration, no production read or write.

## Why

The menu import keeps each line as the reading saw it, in `menu_items.raw_extracted_text` (insert at `apps/api-gateway/src/menus/menus.service.ts:1717`). The web's `/house` and `/house/menu` read the first proof back from the house (ADR 0309, on #656), and without the raw line a line read back from the server loses the raw-text half of the decided kitchen test (`isKitchenLine`, origin/main `apps/web/src/lib/firstProof.ts:36-39`).

The first head of this PR added the column to `LINE_SELECT` for every reader. The audit found that wrong: **a CSV's raw line is the whole row.** The CSV reader stores `lines[i].trim()` (`parsers/csv-parser.service.ts:55`), and `HEADER_MAP` (`:5-29`) maps only name, producer, vintage, region, grape, category and the two sale prices. A cost, supplier, margin or notes column rides along in the stored row, and no header is kept with it, so no reader can tell which cell is a cost. Rows have been stored this way since 2026-05-11. Under ADR 0145's ROLE_POLICY, staff see neither `money` nor `suppliers` (`apps/api-gateway/src/ask-readings/reading-data-classes.ts:182`), and an unknown or missing role reads the staff row (`:243-250`).

**What this PR actually delivers** (refute A5, restated on reachable states). No flow puts a CSV reading in a tab: the reading tab's only writer is GetStarted, and it only scans (`apps/web/src/pages/GetStarted.tsx:195`); scans carry no raw line (`parsers/scan-parser.service.ts:35`). So what the server's raw line adds is the raw-text half of the kitchen test for lines read back from the server: a CSV text import through `/menu` (`apps/web/src/pages/menu/next/MenuVersions.tsx:153`) and scans stored before 2026-08-13. This PR computes that half in the gateway, as `kitchen_line`, for every member, and keeps the raw line itself for a holder.

**Where a line has no raw line.** A scan since 548cc9aea, a workbook import (`parseExcel` never sets `raw_text`, `csv-parser.service.ts:96-105`) and a line added by hand store none. The web's forms send none on a manual import; a manual import stores `raw_text` only if a client sends it (`dto/import-menu.dto.ts:13-18`; register entry (iv)). Such a line's `kitchen_line` comes from its section alone.

## What changes

- **NEW `apps/api-gateway/src/menus/menu-line-view.ts`** (pure module):
  - `KITCHEN_HINTS` (`:33`): the web's nine hints, unchanged. 'dessert' stays for now so both lists match (register entry (ii)).
  - `isKitchenLine(category, raw)`: the web's test, a hint in the section or the raw line.
  - `seesRawLine(role)` (`:79`): `policyFor(role).sees` must include both `money` and `suppliers`. owner, manager and `admin` (alias of owner) are true; staff, an unknown role and no role are false.
  - `MEMBER_LINE_KEYS` (`:42`): an allowlist of the keys any member is sent. It does not name the raw line.
  - `lineForViewer(row, view)` (`:92`): copies only the allowlisted keys the row has, adds `kitchen_line` for everyone (`:98`), puts the raw line back only inside `if (view.rawLine)` (`:99`), and otherwise sets `raw_line_withheld: true` (`:102`) only when a stored raw line (a non-empty string) is held back. A withheld raw line is a missing key, never a null: null already means "no raw line kept".
- **`menus.service.ts`**:
  - `LINE_SELECT` (`:261`) keeps asking for `raw_extracted_text`, because `kitchen_line` needs it; it is now exported for the spec, and its doc says the raw line leaves this read only when the caller's view allows it, and that the import reply and the kept file still carry the same text (register entries (i), (iii)).
  - `getMenu` (`:957`), `readLines` (`:1046`) and `getVersion` (`:1133`) each take `view: LineView = { rawLine: false }`. `readLines` maps every row through `lineForViewer` (`:1070`). A reply without the raw line says `rawLineWithheld: true` (`:973`, `:1148`), the no-menu reply of `getMenu` included.
  - The internal readers (`readCurrentMenus`, `planFor`, `makeCurrent`) pass no view, so they get no raw line. The import, its reply and `previewArrivalMenu` are unchanged.
- **`menus.controller.ts`**:
  - `GET /menus/:restaurantId` passes `{ rawLine: false }` for every viewer, owner included (`:52`; refute A8): no page reads the raw line from this route (`MenuNext.tsx` does not), so owners stop receiving costed rows on `/menu` too.
  - `GET /menu-versions/:menuId` (`MenuVersionsController.one`) takes `@CurrentUser("role")` and passes `{ rawLine: seesRawLine(role) }` (`:194`). The role is the token's role in the token's house, re-derived from the access row on every request (`auth/strategies/jwt.strategy.ts:68`); there is no second `resolveRestaurantRole` read.
  - `GET /menu-versions/:menuId/source` is **unchanged** (register entry (i), its own lane next).
- **`apps/api-gateway/src/arrival/arrival.service.ts:170`**: the opening menu passes `{ rawLine: false }` for everyone (refute A8). `canManage` still gates vendor terms only.
- **Specs**: `menus.service.spec.ts` (the old pass-through case replaced by a describe of 9 cases on rows built by the real `CsvParserService`), **NEW** `menu-line-view.spec.ts` (helpers and controller wiring), `arrival.service.spec.ts` (an owner/staff pair on the opening menu).
- **`.planning/decisions/claims.d/fix-a-menu-line-carries-its-raw-line.jsonl`**: the old row `A-MENU-LINE-READ-BACK-CARRIES-ITS-RAW-LINE` is replaced; it was false twice (the plan and make-current never sent the raw line, and staff must not get it). Five rows, listed under Evidence.
- **NEW `.planning/tech-debt.d/2026-10-08-fix-a-menu-line-carries-its-raw-line.md`**: register entries (i)-(iv), all OPEN.

**Staff and money.** A CSV line's raw line can carry cost, supplier and margin cells. `GET /menu-versions/:menuId` sends it only to a role whose ROLE_POLICY row sees money and suppliers (owner, manager, admin by alias); `GET /menus/:restaurantId` and the arrival bootstrap send it to no one. Everyone else gets `kitchen_line`, `raw_line_withheld` on a line that keeps a raw line, `rawLineWithheld: true` on the reply, and no `raw_extracted_text` key. **This read withholds the raw line; the kept file still reaches any member (register entry (i)) until its lane lands.** Not closed here either: menu sale prices still reach staff, as on main (MENU-02 in the money-policy synthesis); and the import's reply returns each CSV row to whoever uploaded the file (register entry (iii)).

**Merge order.** This PR merges first; #656 then merges main and is re-verified. Neither PR may merge at its old head: `220e3747d` plus `2d81f8a5d` together send the whole CSV row to staff and draw it on `/house/menu`. This PR alone changes nothing a page shows: main's `/house/menu` reads only the tab, and no page on main reads `kitchen_line` or the raw line. Until #656 merges, the code comments here cite ADR 0309, which lands with #656 (the audit's sequencing note).

## Decision

**Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, not by the founder.** The founder, verbatim:

> "Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research."

The audit BLOCK led the coordinator to amend ADR 0309 option 1c under the same delegation (the ADR text changes on #656). A research workflow (`wf_4b1156ad-fce`) chose option (h): every member gets a server-computed `kitchen_line`; the raw line goes only to a holder; reads withhold by default. An adversarial refute found eleven holes in its details and said the main rule survives every kill attempt on money; all nine of its amendments (A1-A9) are built here or on #656. It applies rules that are already locked (ADR 0145's staff row, ADR 0167), so it adds no new ADR.

Coordinator choices inside (h), recorded as the coordinator's, not the founder's:

- **A4:** the `/source` refusal stays out of this PR, as register entry (i) with its rule decided now: refuse every kept source to a non-holder (the gateway cannot tell a printed menu PDF from a costed list) and hide "Open file" when `!canManage`. Every "staff get no raw CSV row" and "fails closed" wording is struck.
- **A8:** `GET /menus/:restaurantId` and the arrival bootstrap pass `{ rawLine: false }` unconditionally; only `MenuVersionsController.one` uses `seesRawLine(role)`.
- **A1, the root marker:** it stays `rawLineWithheld`, not the money-policy synthesis's one root marker `amountsWithheld` (`p4-scratch/sim-run/fixes/audits/money-policy-2026-10-07.md:17`). These replies still carry the sale prices (`by_glass_price`, `bottle_price`) to every member until MENU-02 withholds them, so `amountsWithheld: true` would tell a reader that amounts are gone when they are not. Moving these replies to `amountsWithheld` belongs with MENU-02. The reason is written at `menu-line-view.ts:18-23` and goes into ADR 0309's text on #656.
- **A6** (stamp with `user?.userId`, fail closed, houseLater) is #656's half.

**Rejected options** (detail in the workflow's decision):

- **(e) Everyone gets the raw line, prose corrected:** staff would read cost, supplier and margin for every CSV menu imported since 2026-05-11, against ROLE_POLICY's staff row (ADR 0145) and ADR 0167. Superseding a locked rule is the founder's call, not the delegation's.
- **(b) Strip for non-holders with no kitchen flag:** the kitchen split would differ by role.
- **(d) Kitchen flag and no raw line for anyone:** withdraws option 1c's raw-line quote from holders too, narrower than the locked rule needs. (h) is (d) with the quote restored for holders on the one route that reads it.
- **(g) A web-only kitchen test on mapped fields:** changes the decided kitchen test and turns section-only food rows (Tiramisu) into "Needs a place" pencils.
- **(a) Trim the row at import:** leaves every row stored since 2026-05-11 as it is; only a forbidden production UPDATE could reach them.
- **(c) Send a derived "safe" raw line:** no header is kept for older rows; for newer ones it needs a storage read per request or a migration.
- **(f) Close this PR and leave the raw line owed:** keeps the raw-text half of the kitchen test missing for every line read back from the server.
- **Fold the `/source` gate in here:** a separate leak already live on main that also needs a web change; filed as entry (i) with an open CLAIMS row instead (A4, above).
- **Read the role with `resolveRestaurantRole`:** a second answer to who holds money, rejected on #659; the token role is already re-derived per request.
- **Withhold sale prices here:** that is half of MENU-02, scheduled in M2.

**How each blocker and hole is answered on this PR**

| Item | Answer |
|---|---|
| Audit: "Staff and money" sentence false; raw row reaches staff via every line read | Line reads withhold by default; only `GET /menu-versions/:menuId` sends it, to a holder. The sentence is rewritten above, no broader than the code. |
| Audit: older menus (2026-05-11 to 2026-09-22) have no kept file, so the inline row was new exposure | Those rows now leave no line read to a non-holder (`readLines` default; spec "a call that names no view withholds"). |
| Audit: #656 draws the raw row on `/house/menu` for any member | The gateway half: a non-holder's `GET /menu-versions/:menuId` has no `raw_extracted_text` key. The web half is on #656. |
| Audit: add a spec with an unmapped cost column asserting the staff read | `menus.service.spec.ts`, describe "a line's raw line is a holder's": real CSV reader, exact staff key sets, plus a check that none of 38.50, 3.10, Vini Ltd, Metro, 68%, 74% appears. |
| Audit: ADR 0309 not on main | Sequencing stated under Merge order; the cite resolves when #656 lands. |
| H1 per-line sentence on lines with no raw line | `raw_line_withheld: true` only on a line whose stored raw line is a non-empty string and is held back (`menu-line-view.ts:101-103`); spec: Soave (manual, none kept) has no such key. The web reads it on #656. |
| H2 resolved rows green with the leak back | Row 1 now checks logic (the `&&` with no `true`/`||`, the assignment only inside `if (view.rawLine)`, the allowlist, the three defaults, the exact controller and arrival arguments). Row 3 also pins `raw_text`, `rawText` (src/menus, src/arrival), `select("*")` on menu_items (two allowlisted readers) and no select of `extraction`. Every mutant listed by the refute turns its row red (Evidence). |
| H3 open rows never flip | Row 4 also counts `assertCanManageRestaurant(` and `@Roles(` from the route's `@Get` down; row 5 is retitled to the proposed fix ("a known drink section wins") and checks both lists. Each turns to exit 0 on a scratch build of its fix. |
| H4 `/source` still serves the whole file | A4 above; register entry (i); open row 4. |
| H5 a defect no flow can reach | "What this PR actually delivers", above. |
| H7 denylist tests, a sixth marker shape | Exact key sets per line and per reply; the string check is a second assertion. Marker reason under A1. |
| H8 XLSX keeps no raw line | Register entry (ii) notes it; the pencilled-count prose is ADR 0309's, on #656. |
| H9 prose broader than the code | `LINE_SELECT` doc says "leaves this read only when the caller's view allows it" and names the other paths; no "any reader added later" claim; this PR is 9 files; ADR 0180 is not cited as a read rule. |
| H11 owners sent costed rows where nothing reads them | A8 above. |
| H6, H10 | #656 only. |

## Evidence

Measured in this worktree after merging origin/main `62f8967b4`. Jest (menus + arrival) and the decision claims were re-run on `18c2de14e`'s contents; the rest was measured at `987d471d5`, and `18c2de14e` changes only one comment line.

- `cd apps/api-gateway && npx jest src/menus src/arrival` → 11 suites, **186 passed**. Touched specs: `menus.service.spec.ts` 69, `menu-line-view.spec.ts` 12, `arrival.service.spec.ts` 33.
- `npx jest src/toast src/promotions` (other `MenusService` users) → 8 suites, **178 passed**.
- Gateway `npx tsc --noEmit` → 2 errors, both `src/passkeys/passkeys.service.ts` *Cannot find module '@simplewebauthn/server'* (the known absent package).
- `PATH=/usr/local/bin:$PATH bash scripts/check_decision_claims.sh` → **947 checked, 947 holding**.
- `lanecheck.sh wt-fix-rawline` → the six guards rc=0, files=9, ownership `[]`.
- **Jest mutants**, each in the worktree with a `cp -p` snapshot first and `cmp` identical after restore; every one turns the three touched specs red: lineForViewer always sends the raw line (11 failed); seesRawLine returns true (11); readLines default true (1); getMenu default true (2); `one` passes a constant true (3); the `/menus` route passes true (1); arrival passes true (2) or no view (2); `kitchen_line` dropped (4); the whole row copied instead of the allowlist (4); `raw_line_withheld` on every withheld line (2); the root marker dropped (8); readLines skips lineForViewer (11).
- **CLAIMS mutants**, each on a scratch mirror (`scratchpad/rawline-build/claims_mut.py`), worktree untouched. Baseline: rows 1-3 exit 0, rows 4-5 exit 1.
  - Row 1 `A-MENU-LINE-RAW-LINE-GOES-ONLY-TO-A-HOLDER`: 16 mutants, all exit 1 (refute M-b, M-c, M-d and M-e among them).
  - Row 2 `A-MENU-LINE-SAYS-IF-IT-IS-A-KITCHEN-LINE`: a hint changed on either side, or `kitchen_line` dropped → exit 1.
  - Row 3 `A-MENU-RAW-LINE-IS-NAMED-ONLY-WHERE-IT-IS-GATED`: refute M-h (a new `select("*")` on menu_items), the column named in another file or a new service line, `extraction` selected, `rawText` or `raw_text` in arrival → exit 1.
  - Row 4 `A-MENU-SOURCE-FILE-IS-A-HOLDERS` (open): a gate by `assertCanManageRestaurant`, by `@Roles` or by `seesRawLine` → exit 0 (so it fails the build as stale); a gate on another route → stays exit 1.
  - Row 5 `A-KNOWN-DRINK-SECTION-WINS-OVER-A-KITCHEN-HINT` (open): the fix on both sides (own list, or the gateway's `MENU_CATEGORY_VOCABULARY`) → exit 0; the web side only, or 'dessert' dropped from the hints → stays exit 1.

## Not done

- **The kept source file still reaches any member** (register entry (i), its own lane next, rule decided above).
- **Not verified against a database or in a browser.** No local gateway served a menu, production was not read, and I cannot say how many real CSV rows carry cost columns. Direct PostgREST grants on `menu_items` were not re-checked.
- **Web vitest not run**: this PR touches no web file. The web half (reading `kitchen_line`, the per-line sentence on `raw_line_withheld`, the person stamp, ADR 0309's text) is #656.
- **The design probe was not re-run.** The reachable state (a CSV text import) is exercised by the spec's rows from the real CSV reader instead.
- **Not merged with origin/main `be9a16ccf`** (one commit, #652, landed after this build's merge).
- Sale prices to staff (MENU-02), the import reply (entry (iii)), manual `raw_text` (entry (iv)) and the dessert collision (entry (ii)) stay open.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
