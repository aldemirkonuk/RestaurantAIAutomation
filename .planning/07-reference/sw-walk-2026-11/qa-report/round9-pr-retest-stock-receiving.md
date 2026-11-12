# Round 9 PR re-test: stock and receiving (#813 #814 #820 #821), 2026-11-07

Read-only on the shared checkout (`gh pr view/diff`, `git fetch` only). Tests ran in detached worktrees `/private/tmp/claude-501/qa-wt-814` (head `b0f224a40`, which contains #781 and #813) and `/private/tmp/claude-501/qa-wt-821` (head `3dc23b0f5`, which contains #787 and #820), node_modules symlinked, both removed afterwards. Heads: #813 `12a8aa3fb`, #814 `b0f224a40`, #820 `b1c94c58e`, #821 `3dc23b0f5`. The stacks are #781 <- #813 <- #814 and #787 <- #820 <- #821; none of #781, #787 or these four is merged. Compared with `round4-pr-retest.md` (#781 PARTIAL) and `round5-pr-retest.md` (#787 PARTIAL).

SQL: PGlite 0.5.8 (PostgreSQL 18.3), all 301 migrations of the #814 tree and all migrations of the #821 tree, via the round-4 harness (stub vector/postgis, superuser, no Supabase platform; `service_role` has no SELECT on the view in this build, so grants are catalog-level only). **PGlite is one session, so a real two-connection race cannot be run.** The race is covered by (a) the SQL lease function exercised in serialised order and (b) 40 jittered interleavings of the real `verifyReceipt` code against a stub whose lease RPC is an atomic check-and-set (as `INSERT ... ON CONFLICT DO UPDATE ... WHERE` is). The row-lock behaviour of Postgres itself is argued, not run.

| PR | Verdict | One line |
|---|---|---|
| #813 | **FIXED** | A received-then-sold wine never counted now alerts; the round-4 hole is closed and my edge cases hold. |
| #814 | **PARTIAL** | Alert, digest and row now say "not counted yet", but the page then stops calling the wine low at all, and the dashboard and /inventory summaries disagree on the same wine. |
| #820 | **FIXED** | Racing verifies write once under the lease (40/40 seeds); the same harness without the lease fails 40/40. |
| #821 | **PARTIAL** | Closed orders are refused and an up/down correction restates the claim, but a correction to a clean count leaves the old claim open, and a correction that changes the verdict opens a second claim beside the first. |

Counts: FIXED 2, PARTIAL 2, NOT FIXED 0, REGRESSION 0.

---

## #813 FIXED

Target: round-4 break 1 on #781. A wine received through `apply_stock_movement` and then sold, never counted, par 3, stock 2, was out of `v_low_stock_items` and could never alert.

**Does the test fail without the fix?** Yes, both halves.
- `an-uncounted-wine-is-not-low-stock.spec.ts` with `inventory.service.ts` reverted to the base: the new test `counts a received, never-counted wine below par as low` fails (1 failed, 3 passed).
- The PR's SQL test `supabase/tests/20270325100000_..._test.sql` run in PGlite on a build that stops at `20270310110000`: fails (`column "last_counted_at" does not exist`). On the full build it passes (T0 to T9).

**Probes in the built DB (`round9-tests/stock-receiving/p813b.mjs`).**
- Received 10, sold 8, par 3, uncounted: in the view, `stock_live 2`, `last_counted_at null`. This is the round-4 case and it now alerts.
- Sale of a never-stocked wine: `apply_stock_movement` raises `stock would go negative: 0 + -1`, writes no transaction, wine stays out of the view. So the "any live movement" test cannot be tripped by a phantom sale.
- Zero-delta movement writes no transaction row: stays out.
- Shadow-only movement stays out (T6); `IN_TRANSIT` and inactive rows stay out.
- Par 0: received 5 and sold 5 gives stock 0, not in the view (0 < 0 is false). Good.
- Wine counted after the alert fired:
  - count that agrees (2 of 2): stays in the view with `last_counted_at` now set;
  - count up to 20: leaves the view, so the existing recovery path (`low-stock-alerts.service.ts:750-763`) clears the alert state silently;
  - then sold down to 1: back in the view, counted;
  - counted at 0 after being received and sold: in the view, counted.
- View shape: 41 columns, `last_counted_at` last, `security_invoker=true` kept, no SELECT for anon/authenticated, no dependent views or functions (nothing breaks on the new column). `idx_inv_txn_inventory` exists, so the new `EXISTS` is indexed.
- Migration version `20270325100000` is unique.

**Notes, not defects.**
- Received 10 then manually adjusted away (`-10 adjustment`) is in the view at 0, uncounted. That is "received minus adjusted", consistent with the rule, but it will raise a critical-looking alert for a wine nobody ever stocked if the receipt was a mistake.
- The CLAIMS row's verify is a regex over the migration text and the PR says so ("this verify checks the SQL text only"). Behaviour is held by a SQL test that CI does not run (`scripts/sql_outside_migrations.txt`).
- Still open from round 4 and outside this PR: other readers that treat an uncounted wine as zero (`reading-runner.ts:75-80`, `pending-order-priority.ts:115-130`, Python `get_low_stock`).

## #814 PARTIAL

Target: round-4 break 2 (the page says Out for an uncounted wine) plus the alert wording.

**Fixed.**
- Alert text: single wine `2 bottles by receipts and sales, not counted yet (par: 3)`, burst `Received Red (2/3, not counted yet)`, metadata, digest email and dashboard alert all carry it; only a strict `last_counted_at === null` says so (`low-stock-alerts.service.ts` `mapRow`, `dashboard.service.ts` alert message, `low-stock-digest.template.ts`). Probe with a Turkish name (`Öküzgözü ıİ`) renders intact in the digest.
- Page: `toRow` gives `standing: 'uncounted'` (`useInventoryNextData.ts:262`), the row reads `Not counted yet`, the map tile goes neutral. A counted 0 is still Out. A row that carries no `lastCountedAt` field keeps its old standing. Round-4 U-8 is closed.
- Tests fail without the fix: gateway specs with the three services and the template reverted: 6 failed, 27 passed; web with `useInventoryNextData.ts` and `InventoryTable.tsx` reverted: 4 failed, 101 passed.
- At the PR head the wider suites pass: gateway `inventory notifications dashboard communications` 98 suites, 1831 tests; web `pages/inventory pages/cellar` 34 files, 728 tests.

**Why PARTIAL (run, probe in `round9-tests/stock-receiving/pr814-web.qa.test.ts`).**
1. **The page now says the opposite of the alert.** A wine received 10 and sold 8 (2 of par 3) is in the alert view and has fired an alert, but on `/inventory` its standing is `uncounted`:
   - the `Below par` chip does not match it (`chipMatch` checks `standing === 'below'`, `:413-414`);
   - the one-line read sentence for a house holding only that wine says "Nothing is out or below par." (`readSentence`, `:535-546`);
   - `severity()` ranks it 2 (everything else) in "Needs you first" (`:277-281`).
   Before the PR the same wine read "Below par" (stock 2, par 3). So the PR trades the false Out for a hidden Below par on exactly the wines #813 now alerts on. The alert says low, the page says nothing is low.
2. **Dashboard and /inventory summaries disagree on the same wine.** Received 5, sold 5, par 3, uncounted, in the view: `/inventory` summary gives `criticalCount 1`, the dashboard summary gives `criticalCount 0` (it counts only counted rows, `dashboard.service.ts:631-639`), and the alert is critical. Probe output: `inv.criticalCount 1`, `dash.criticalCount 0`, `alertSeverity critical`, `lowStockCount 1` on both.
3. **Stored inbox wording goes stale.** Once the alert row says "not counted yet" and someone then counts the wine and it is still below par, the alert stays at the same level (no new alert is raised for an unchanged level), so the inbox keeps "not counted yet" for a wine that has been counted. Read from the dedupe on `last_alert_level`; not run end to end.
4. The alert's `actionUrl` is `/inventory?filter=low-stock`, a parameter the page does not read (it uses `?chip=`). Pre-existing, but it means the alert link opens the unfiltered page where the wine shows as "Not counted yet".

## #820 FIXED

Target: round-5 #787 break 1 (two racing verifies wrote duplicate events and price history), and round 5 note 6 (the guard is read-then-write).

**Does the test fail without the fix?** Yes. With `procurement.service.ts` reverted to the #787 base: 3 failed (`two verifications racing on a never-verified order write once`, `a verification that cannot get the order's lease is refused in words and writes nothing`, `a lease that cannot be checked refuses rather than verifying unguarded`).

**Race probes** (`round9-tests/stock-receiving/pr820-821-verify.qa.spec.ts`, real `verifyReceipt`, every query and rpc delayed by a random 0 to 3 ms so the verifications truly interleave):
- 3 identical concurrent verifies, 40 seeds: 0 violations (always exactly 1 reconciled event, 1 price row, 1 claim insert, 1 order update, ledger delta -2, lease row gone). The same harness with the lease RPC forced to always answer "taken": 40 of 40 seeds violate. So the harness can see the race and the lease closes it.
- 2 different concurrent verifies (8/2 and 7/3), 40 seeds: no lost update; the booked total always ends at 7 (the later submit), never the 5 an interleaved read would give.
- A lease held by someone else past the wait: 409 `receipt_verification_in_progress`, nothing written.

**SQL lease function in PGlite** (`p820.mjs`, serialised order): first take `taken`; second token `busy`; wrong-token delete leaves the holder; lapsed lease is taken over and the stale holder's late release by its own old token deletes nothing; another house's order gives `no_order`; seconds 0, 601 and NULL are refused; the row cascades with the order; RLS on, anon and authenticated have no EXECUTE and no table SELECT, service_role has EXECUTE.

**Remaining, not defects of the claim.**
- A genuinely concurrent two-connection run of `take_receipt_verification_lease` was not possible here. The argument: each RPC is its own committed transaction, a racing second insert waits on the first's row and then fails the `WHERE l.held_until < now()` test, so it answers `busy`.
- A verification that outlives its 90 s lease lets a second one in (the lapse is the crash recovery). Verification is about twenty round trips, so this needs a stalled gateway.
- The mobile outbox treats any 4xx except 429 as permanent (`apps/mobile/src/state/outbox.ts:232-236`), so a queued verify that meets the 409 "someone else is verifying" after the 6 s wait is marked failed with the message and is not retried. The message tells the person to refresh, so it is honest, but it is not self-healing.

## #821 PARTIAL

Targets: round-5 break 2 (a correction leaves the first claim), break 3 (currency-only change swallowed), break 5 (cancelled order verifiable).

**Does the test fail without the fix?** Yes. With `procurement.service.ts` reverted to #820's head: 5 failed (`a correction restates the open claim...`, `a claim already with the vendor is not restated...`, and the CANCELLED, REJECTED, FAILED refusals). `procurement` suite at the PR head: 98 suites, 2072 tests pass.

**Fixed (run).**
- Correction up then down: 8/2 then 7/3 then 9/1 restates the open claim to 80, 120, 40 (the unique index refuses the insert, the guarded `UPDATE` rewrites it). Against the real table in PGlite the restate updates the open row and updates 0 rows once the claim is `requested`, and the duplicate insert fails 23505 (`uq_pc_order_match_reason`).
- Currency-only change: USD to TRY after an identical verification writes 1 event, 1 price row (currency TRY) and 1 order update, and moves no stock. Not swallowed. (The guard already compared currency from the #787 branch's later commits; #820/#821 did not regress it.)
- Closed orders: CANCELLED, REJECTED, FAILED refuse with `receipt_verification_order_closed` (422) before any read or write, for the full payload and for the legacy `{adjustments}` payload. COMPLETED, DELIVERED and PARTIALLY_RECEIVED still verify, as intended.

**Why PARTIAL.**
1. **A correction to a clean count leaves the old claim open at the old amount.** 8/2 (claim 80) then 10/0: `draftClaimFromMatch` returns null (`credit-ledger.ts:184-199`), `openCreditClaim` returns at `if (!claim) return;` (`procurement.service.ts:5763`), so nothing updates or withdraws the claim. Probe: after the clean correction, 0 credit updates; the 40 or 80 stays open and the house keeps chasing money the verification now says is not owed. This is the "correction to zero" case and it is the stale-claim defect of round 5 in its plainest form.
2. **A correction that changes the verdict opens a second open claim beside the first.** The unique index is on `(order_id, reason)` and the reason follows the verdict (`reasonForVerdict`: `rejected` gives `damaged`, short count gives `qty_short`). 8 accepted / 2 refused (`damaged`, 80) then 8 accepted / 0 refused (`qty_short`, 80): the stub records two inserts, `[damaged 80], [qty_short 80]`, and in the real table two open claims for one order coexist (`two_reasons_one_order = 2`). The same two bottles are claimed twice, which is the double-count H-1 was about.
3. A claim already `requested` is left at the old figure, by design and logged; there is no person-facing note that the corrected count no longer matches it. Acceptable, but it means a downward correction after the vendor was asked still overstates.
4. Status guard is a three-value allow-list on the exact uppercase string. Probe: `cancelled`, `Cancelled`, `null` and an unknown `CLOSED` all verify. The DB enum is uppercase so lowercase is unlikely, but a null status is accepted. PENDING, APPROVAL_NEEDED, NEGOTIATING, APPROVED, CONFIRMED and IN_TRANSIT orders (nothing arrived) are still verifiable; not claimed by the PR, noted because round 1 H-1 spoke of "a closed order".
5. Turkish text: a note identical but a rejection reason that differs only in case and dotted/dotless i (`kırık ıİ` vs `KIRIK Iİ`) counts as a different verification and writes again (1 extra event). Harmless, but the repeat check compares strings exactly.

---

Not done: no run against Docker/PostgREST or a second real connection; production counts (how many wines are received-and-uncounted, how many orders hold duplicate open claims) were not read.

Probe files: `/Users/aldemirkonuk/Projects/p4-scratch/sw-walk/qa-report/round9-tests/stock-receiving/` (`pr820-821-verify.qa.spec.ts`, `pr814-web.qa.test.ts`, `p813b.mjs`, `p813c.mjs`, `p820.mjs`, `build.mjs`). I overwrote nothing of the other round-9 files by name except that a `build.mjs` may have existed in `round9-tests/` before I copied mine there (I moved mine into the `stock-receiving/` subfolder; if another session's `build.mjs` was at the top level it is gone). The `qa9-814` gateway cross-surface probe (inventory summary vs dashboard summary vs alert severity) was deleted with its worktree and is described above rather than saved.
