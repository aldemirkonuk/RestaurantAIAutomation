# QA round 4: adversarial re-test of draft PRs #770 #779 #780 #781 #782 #783

Date 2026-11-07. Base `origin/main` c93d6115c. Method: `gh pr diff`; each PR head in a throwaway worktree `/private/tmp/claude-501/qa-wt-<n>` (node_modules symlinked), the PR's own specs run, specs re-run with the fix reverted to see them fail, probe specs written then deleted. For SQL I built all 300 migrations in PGlite (PostgreSQL 18, WASM; harness copied from `p4-scratch/pglite-probe/audit-391-r5-endstate/pgbuild.mjs`, scripts in the session scratchpad `pg/`), then ran real calls against the PR's migrations. Nothing was checked out, merged, pushed or commented in the shared checkout; the worktrees and the temporary `refs/qa/*` refs are removed. Fidelity limit for SQL: PGlite runs as superuser with no Supabase platform and no RLS roles in play, so tenancy and grant claims are catalog-level only. Round-2 ids (U-, H-, B-, I-) are from `round2-inventory-recipes.md`; round-3 ids from `round3-orders-vendors.md`.

## Verdicts

| PR | Target | Verdict | One line |
|---|---|---|---|
| #770 | onboarding self-heal drops its read error (menu M20) | PARTIAL | Target fixed and tested; a narrow flow regresses (typed lines on a 0-line read); no round-2/3 id maps here |
| #779 | orphan `POST /arrival/menu-evidence` | FIXED | Route, service method and DTO gone, no client anywhere, tsc clean, both new specs fail without the change |
| #780 | one landed-cost rule, pure and unwired | PARTIAL | Rule is sound under probes, but unwired so no cost changes; one false sentence under a KDV-inclusive basis |
| #781 | an uncounted wine is not low stock (OD-161 rule half) | PARTIAL | Alert, view, dashboard and summary fixed and proven in a built DB; the page still says Out, and a received-but-never-counted wine can never alert |
| #782 | docs half of #781 | FIXED | Citations check out; claims 1062/1062 and OD ids PASS; only true once #781 lands |
| #783 | keep a used-up lot at zero (R6) | FIXED | Behaviour proven in PGlite (FIFO draw, split, whole-lot transfer, glass pour, refill); no new harm found |

Counts: FIXED 3, PARTIAL 3, NOT FIXED 0, REGRESSION 0.

## Round-2/3 findings no PR here touches (still open on these heads)

- **Par 0 saved as 6 (round-2 U-3): NOT FIXED by any of the six.** `apps/api-gateway/src/inventory/inventory.service.ts:1054-1055` is still `dto.thresholdMin || 6` and `dto.thresholdMax || 24` on all five code worktrees.
- Round-2 U-8 (page chip `Out` for stock 0 before it looks at par): untouched. `useInventoryNextData.ts:133-139` `standingOf` still returns `out` at `stock <= 0`, and nothing in the web reads `last_counted_at` for standing (#781 and #782 both say so).
- Round-3 H3 (soft-deleted or inactive vendor can still be ordered), B1 (negative price accepted on order create), B5 (Turkish search folding): no PR here touches procurement orders or search. #780 rejects negative figures inside its own module only, which does not reach the order DTO.
- Round-2 H-2 (a failed lot read looks like no cost): #783 changes what the views return, not how `fetchLotRollup` treats a failed read.

---

## #770 PARTIAL

Target: `getOnboardingProgress` took a failed read (or two active rows, PGRST116 from `.maybeSingle()`) for "menu not uploaded". Now `houseHasAReadMenu` (`menus.service.ts:2208`) uses `.limit(1)`, counts any non-archived version with `lines_extracted > 0` (`:2214`), counts an active NULL-count version as before, and throws on a failed read.

What I ran
- PR block: 77/77 in `menus.service.spec.ts`. With `menus.service.ts` swapped to base: 4 fail (two active rows, draft-only house with lines, failed first read, failed second read), 73 pass. So the specs do fail without the fix.
- Status domain: `restaurant_menus_status_check` allows only `active`, `draft`, `archived` (baseline:5140), so `neq archived` cannot admit an unexpected state.
- `user_onboarding_progress.restaurant_id` is NOT NULL (baseline:5782), so the new `.eq("restaurant_id", ...)` cannot receive null and turn into a thrown 400.
- The new throw is survivable in the web: `VerifyEmail.tsx:76` catches to null and routes to `/get-started`, the same place the swallowed error led; the react-query hooks just see an error.

Breaks and harm found (code-read, not run against PostgREST)
1. **NEW, low-medium. Typed lines on a 0-line read leave an invitee on "Upload your wine menu".** `lines_extracted` is written once, in `createVersion` (`menus.service.ts:612`, `items.length`) and never updated: `addMenuItem` (`:646`) adds `menu_items` rows to an existing version without touching it. A scan that reads 0 lines, followed by the owner typing the lines in review, leaves a published active version with `lines_extracted = 0` and real items. Before the PR the active version counted; now neither query matches (`0 > 0` false, `IS NULL` false), so a later invitee reads "not uploaded". The owner is unaffected (`markMenuUploaded`). The PR's own tech-debt names the 0-line mismatch but not this route to it.
2. **Draft counts as uploaded, and the flag is written permanently.** A draft the owner never reviews (or later archives) with lines read now sets `menu_uploaded = true` on the invitee's row and `activated = menuUploaded && thresholdConfigured` can be true with no live menu. The healing write is not undone if the draft is archived. The founder approved "all 8", so I treat this as a recorded choice, not a bug; flagging the consequence.
3. The `restaurants.threshold_configured` read a few lines below still drops its error (PR files it).
4. Not testable here: real PostgREST behaviour of `.neq().gt().limit(1)`; the specs use the PR's own fake.

Test would fail without the fix: yes (4 of 8). Zero/negative/Turkish/mixed-unit/soft-deleted-vendor: not applicable to this code path.

## #779 FIXED

Target: delete the route with no client. `POST /arrival/menu-evidence`, `ArrivalService.menuEvidence` and `MenuEvidenceDto` are gone (`arrival.controller.ts`, `arrival.service.ts`, `arrival.dto.ts`).

What I ran
- Repo-wide grep (excluding node_modules and `.planning`) for `menu-evidence|menuEvidence|MenuEvidenceDto|Menu proposals must come`: only the new controller spec matches. `GetStarted.tsx` uses `importMenu` from `services/api/menus`, not the arrival API. No mobile, Python or edge-function caller.
- `tsc --noEmit -p apps/api-gateway/tsconfig.json`: clean (the only error class I filtered was the known `passkeys` import). This matters because gateway jest does not typecheck.
- `src/arrival` specs: 36/36. Reverting only `arrival.controller.ts` to base fails `mounts no menu-evidence door` (`arrival.controller.spec.ts:31`); reverting only `arrival.service.ts` fails `refuses a proposed menu line` (`arrival.service.spec.ts:503`). Both tests fail without the change.
- Message change at `arrival.service.ts:523` ("Menu lines cannot be proposed here. Type them, or upload the menu.") has no consumer string-matching it.

Harm checked: none. It also removes a 14 MB body limit door and its rate-limit pair. `previewArrivalMenu` (`menus.service.ts:499`) is now caller-less; the PR files it. `Provenance` still lists `"menu"` for batches already written; the PR says so.

## #780 PARTIAL

Target: one landed-cost rule, pure, unwired (`procurement/landed-cost.ts`, 448 lines, no imports). It cannot change any lot cost on any house today: `grep landed-cost` finds only its own spec. So the production defect (receipt and delivery paths cost bottles their own way) is untouched until lanes 1.3 and 1.4 wire it. The module itself, probed with a throwaway spec (13/13 PR specs pass):

Held
- zero: 0 qty with total 0 costs 0; 0 qty with total 50 is unresolved with a sentence; a free line (price 0, total 0) costs 0 and dilutes its item (8.57 a bottle from 12 paid at 10 plus 2 free).
- negative qty, negative price, NaN, Infinity, price base 0: unresolved, no number.
- null: line total only (no qty, no price) is taken as printed; `{line_no}` only is unresolved; `accepted_bottles` null is unresolved.
- allowance: total net of allowance (100) and gross with allowance (120) both give 100, never taken twice.
- shares: three awkward lines with freight 10, fuel 3.33 and discount 7.77 sum exactly to goods + charges - discount (202.50).
- mixed units: a case line and a bottle line of one `item_key` pool correctly (342.00 / 30 = 11.40).
- short delivery (9 of 12) divides landed value by listed: 10.83 a bottle; accepted > listed is unresolved; discount larger than goods is unresolved.
- input is not mutated; deposit_total alone is "not cost".
- Concurrent edit: pure function, nothing shared.

Breaks and harm
1. **False sentence under a KDV-inclusive basis (`landed-cost.ts:442`).** With `tax_basis: "prices_include_kdv"`, a line of 118.00 (10 at 11.80) with `tax: 18` costs 11.80 a bottle, which includes the KDV, yet `left_out` reads "Not cost: tax of 18.00." The same sentence appears for `prices_exclude_kdv`, where it is true. The tax basis is only passed through (lane 3.5a), so for the Antalya house the explanation contradicts the number. Fails safe only because it is unwired.
2. **No rounding rule.** Per-bottle results are raw floats (13.747461). `inventory_lots.unit_cost` is `numeric(10,2)`; a caller that stores the rounded per-bottle times quantity drifts by cents. "One rule" stops before the last step.
3. **A rejected line keeps its share of freight.** Two lines of 100, freight 20, the second line fully rejected: accepted cost is 110 and the other 10 of freight vanishes into the rejected line. This follows F2 literally; whether the freight on returned goods is the house's cost is a founder-level call that is not recorded.
4. Strings fail safe, not wrong: `"12"` / `"10.00"` (numeric as text) make the line unresolved with "negative or not a number". Any wiring must coerce first (`rowNum` exists in `from-document-rows.ts:288`).
5. A negative charge or a discount printed negative (a credit on `other_charges`) makes every line of the paper unresolved. Intake adds charges and subtracts a positive discount (`parsed-document.ts:507-515`), so the positive discount convention matches; a credit on `other_charges` would still block the paper. The PR files the sign question.
6. `header: null` throws a TypeError; `item_key` is exact-string, so "İstanbul Öküzgözü" and "istanbul okuzgozu" pool as two items (the caller supplies the key). A unit mistake (price per case read as per bottle with the total agreeing) cannot be seen here; that lives with the caller (#666).

Test would fail without the fix: yes by construction (module absent); the PR's mutation (reconcile step dropped) turns 3 specs red.

## #781 PARTIAL

Target (round-2 U-8 family, OD-161): `v_low_stock_items` keeps only rows with `last_counted_at IS NOT NULL` (`supabase/migrations/20270310110000_an_uncounted_wine_is_not_low_stock.sql:67`); the dashboard out-of-stock read adds `.not("last_counted_at","is",null)` (`dashboard.service.ts:1447`); the dashboard summary counts counted rows only (`:634`); `getInventorySummary` classes a never-counted row `unknown` (`inventory.service.ts:1520`).

What I ran
- Jest: 76/76 across the four relevant suites. With `dashboard.service.ts` and `inventory.service.ts` reverted to base, exactly the 4 new tests fail (35 pass). Tests do fail without the fix.
- SQL, built in PGlite from all migrations plus this one: the PR's own SQL test (T0-T5) PASSES. Beyond it: the view's 40 columns equal the baseline's (diffed), `security_invoker=true` survives, `anon`/`authenticated` still have no SELECT, soft-deleted and `IN_TRANSIT` rows stay out, a counted-at-0 wine under par 3 is in the view, a counted-at-0 wine with par 0 is not.
- Migration version `20270310110000` does not collide with any open PR (`20270302090000`, `20270302100000`, `20270303100000`, `20270304100000`).
- Low-stock alert recovery is silent and reconciles items that leave the view (`low-stock-alerts.service.ts:1129-1160`), so already-raised alerts for uncounted wines clear without spam.

Breaks and harm
1. **CONFIRMED in the built DB: a received-and-sold wine that was never counted can never alert.** I received 10 bottles through `apply_stock_movement` and sold 8: stock 2, par 3, `last_counted_at` null. It is not in `v_low_stock_items`. Only `record_stock_count()` stamps `last_counted_at` (`20260902190000_a_count_is_a_record.sql:311`), and the add-wine path inserts `stock_live: 0` and applies initial stock as a lot (`inventory.service.ts:1050-1056`) without a count. This is the open founder question both PRs name, but it is a live silent-failure path for any house that adds a wine with opening stock, so the PR ships a smaller hole than the one it closes only if the founder answers it before merge.
2. **The page still disagrees.** `/inventory` `standingOf` (`useInventoryNextData.ts:133-139`) says `out` for stock 0 and `below` for 2 against par 3, while the gateway summary says `unknown` and the digest says nothing. After this PR the same wine reads three ways. (Documented as MU-1.)
3. `criticalCount` and `healthyCount` in the dashboard summary can both count a counted wine at 0 with par 0 (critical on `stock_live === 0`, healthy because it is not in the view). Pre-existing shape, not caused by the PR.
4. Other readers still read an uncounted wine as zero (ask-readings `reading-runner.ts:75-80`, `pending-order-priority.ts:115-130`, Python `get_low_stock`); #782 lists them with correct citations.

Zero, negative, null: null `stock_live` with a count stamp stays out of the view (SQL null compare); negative stock cannot be stored (round-2 S-4). Par 0 on create is not touched (see top).

## #782 FIXED

Docs only: OD-161 row marked in place and a tech-debt entry. I re-checked every `file:line` it cites against the tree: `reading-runner.ts:75-80`, `pending-order-priority.ts:115-130`, `core/database.py:1017-1043` and `:1921`, `inventory_engine.py:461-487`, `useInventoryNextData.ts:133-139`, `inventoryStatus.ts:93` all land on the code described. `scripts/check_decision_claims.sh` on the #782 head: 1062 checked, 1062 holding; `check_od_ids_exist.py`: PASS.

Caveat (real, stated by the PR): it describes #781. If #782 merges first, `OPEN-DECISIONS.md` says "RULE HALF BUILT" while main has no such migration, and the CLAIMS row for OD-161 (flipped to resolved only in #781) still reads open. Merge #781 first.

## #783 FIXED

Target (round-2 H-style cost loss; R6): a sale that takes a lot to zero no longer deletes it; `transfer_stock` moves a whole lot by changing `location_id`.

What I ran (PGlite, all 300 migrations including this one)
- Receive 6 at 20 and 4 at 30; sell 6: the 20-cost lot stays at qty 0, `status = depleted`, `depleted_at` set, `unit_cost` 20 kept, `stock_live` projects to 4. Sell 4 more: both lots at 0, `stock_live` 0, `inventory_lot_rollup` and `inventory_location_breakdown` return no row (same as a deleted lot). Selling past stock raises `stock would go negative` as before.
- Receive again after emptying: a new lot is created; partial transfer of 2 splits correctly; whole transfer of 3 keeps the original lot id and `received_at` (no delete-and-copy).
- Glass pours: a lot at qty 0 with open ml stays `active` and counts in `open_ml`; at the last pour it flips to `depleted`; the rollup row disappears. Direct `UPDATE qty = 0` marks depleted; refilling a zero lot flips it back to `active` and clears `depleted_at`.
- The re-created `apply_stock_movement` body is identical to the 20261222100000 version except the one DELETE line (diffed); `transfer_stock` differs from baseline only in the whole-lot branch. Single 19-argument overload, ACL and comment kept (same signature).
- Other deleters: only those two functions deleted lots (grep over all migrations); the gateway and Python never read `inventory_lots` for rows except the views, `scenario-verify` (sums qty) and `ask-readings`. The ask-readings reader is fixed with `.or("qty.gt.0,open_bottle_ml.gt.0")` (`reading-sources.ts:32`) and its spec fails when the source file is reverted (1 red).
- The migration spec (`a-used-up-lot-is-kept.spec.ts`) is a text pin over replayed migrations; with the migration file removed all 5 tests fail. It does not run SQL, which is why I ran it myself.

Harm and residuals (none new)
- The one-time `UPDATE ... SET depleted_at, status` touches every empty lot; each row fires `trg_project_stock_from_lots` (an AFTER UPDATE per row that rewrites `restaurant_inventory.stock_live`). Cost on a large production table is unmeasured.
- A part transfer still inserts the destination copy without `received_at`, `delivery_id` or `cost_state` (PR files this). Both lot views still have no `security_invoker`: `reloptions` is null on both in the base build too (`20260902150000_lot_cost_truth.sql` replaced them without it, after od72 had set it). The PR re-creates them with `CREATE OR REPLACE VIEW` and does not name `WITH (security_invoker = true)`, which #781 correctly does for its view. `anon` and `authenticated` have no SELECT on them, so no client exposure, and this is not caused by #783; it is a free fix it passed up.
- A lot with status `reserved` that reaches zero becomes `depleted`.
- Table growth: one zero row per emptied lot, never purged. Small per item; flagging for a later retention rule.

## Not run / limits

- No real PostgREST, RLS role or Supabase platform; SQL evidence is PGlite superuser (catalog-level for grants).
- #770 is verified against the PR's fake, not live PostgREST.
- Browser-level checks were not made; the web claims are code reads.
- Production counts (rows affected by #781, NULL-count versions for #770, empty-lot volume for #783) were not read.
