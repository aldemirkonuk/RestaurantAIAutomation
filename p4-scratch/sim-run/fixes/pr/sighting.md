## What was wrong for the owner (Tuzlu Rüzgar, analytics walk 2026-10-03, read-only)

This is lane `sighting`: finding **AW05** (a defect), seen as **A-038** (minor, menu-cellar-prices:8).

**A-038.** The below-average price box on /vendor-prices counted the **same 25 sightings in its 30-, 95- and 365-day windows**.
- The five calls `vp-below-default` (30d), `vp-below-95`, `vp-below-365`, `nt-below-30` and `nt-below-95` all returned `scanned.observations: 25`.
- The house's events run Jul 1 – Sep 1. A 30-day window taken from Sep 3 should hold almost nothing.
- The page sends no window, so the gateway's 30-day default applies (`vendor-intel.controller.ts:126`).

**AW05, the cause on the writer side.** A verified receipt dated its own-paper sighting at the moment a person checked the paper.
- The code was `observedAt: update.match_verified_at` (`procurement.service.ts:6909` at `fb862aa57`).
- `own-paper-sighting.ts:515` then wrote `effective_date` from that same instant.
- The comment above it (`:6906`) said `procurement_documents` "carries no issued-date column this path can read". That is false. `doc_date` is a `date` column (`20260805000000_baseline_from_production.sql:4433`), and intake writes it (`document-intake.service.ts:1031`, `:1102`, `:1541`).
- As a result, a July invoice checked in September counted as September's price in every `observed_at` window. The two `price_history` windows did the same through `effective_date`, which was written as the day of the write (`new Date()`).

**This PR fixes the writer. It does NOT move Tuzlu's A-038 numbers, and A-038 stays open.**
- The house holds no filed document (`GET /procurement/documents` returned `items: []`, `raw/docs-paper.json`). With no filed invoice, a door check falls back to the check time, which is what this lane's scope says to do (fork F1).
- The 25 rows already written are not re-dated (fork F2).
- The 25 rows were never split by source, so it is not shown that any of them came through `verifyReceipt`.

The other "shown" items in A-038 belong to other lanes:
- x-vsc 90 = 365 comes from the scorecard windowing on `match_verified_at` (ADR 0207:51, the AW03 door half).
- `rp-menu` holding every sale is POS (`postime`, #603).
- `x-cmp-*` reading "No observations" is AW15.

## What changed and why

Rule (ADR 0273): a verified receipt's price is dated by the issue date of **the one live invoice `pickReceiptPaper` already names**. That date is `doc_date` with the latest `kind='correction'` row on `issueDate` laid over it (ADR 0104 D5). The check time is used only as a fallback, and the row says why.

- **`own-paper-sighting.ts`**
  - **New pure function `dateReceiptSighting`**:
    - `observed_at` = min(issue day at 12:00Z, check time). `effective_date` = the issue day exactly.
    - Basis `invoice_issue_date` | `invoice_issue_date_corrected` | `verified_at`.
  - **The fallback is used, each case with its own sentence, when:**
    - no invoice is named, or several are attached;
    - the invoice states no date, or a person corrected it to none;
    - the date is not a strict `YYYY-MM-DD`;
    - the date is more than 1 day after the check's UTC day;
    - the read failed, which is said as a failed read and never as "no date".
  - **`pickReceiptPaper`** also returns the named invoice's header (`docDate`, `status`) and `liveInvoices`, so the date can only come from paper the row names, or a correction on that paper.
  - **`decideOwnPaperSighting`** takes `dating`:
    - It writes `observed_at` and `effective_date` from it.
    - It keys the content hash on the dated day. A re-check of the same paper at the same numbers on a later day writes no second row while the issue date it reads is unchanged. A re-check whose dated day differs writes a second row and supersedes nothing: after the issue date was corrected, on a row written before this change (hashed on its check day), or when one check fell back and the other did not.
    - It stores `raw.dateBasis`, `raw.dateSentence`, `raw.verifiedAt` and `raw.issueDate`.
    - With no `dating` (a confirmed order), nothing changes.
- **`procurement.service.ts`**
  - **`receiptPaperFor`** selects `doc_date`. When exactly one invoice is named, `withIssueDateCorrection` makes one bounded read: `document_corrections`, filtered on `field_path='issueDate'` and `kind='correction'`, ordered by revision desc, `limit(1)`. Its error is checked.
  - **A failed read** stores only *what* failed on the row. The database error text stays in `logger.warn`.
  - **`verifyReceipt`** passes the dated result. The false comment is replaced.
  - **`recordPriceHistory`**: `price_history.effective_date` takes the sighting's `effective_date` (it was `new Date()`), so the two rows written for one check name the same day. A confirmed order keeps today.
    - **This alignment is the lane's pick, not the founder's, and it moves two readers** (no reader's code changes). `vendor-menu-supply.ts:250-253` drops a receipt whose invoice was issued more than 180 days before the read, however recently it was checked. `promotions.service.ts:452-456` feeds `offer-grade.ts`, which withholds the worth when the best price elsewhere is more than 180 days old by that date (`:509`), or, under the one-day tolerance, is "dated … after today" until the UTC day catches up (`:506-507`). ADR 0273's Consequences has the detail.
- **`vendor-comparison.service.ts`**: `observationDating(r.raw)` maps the basis, sentence and both dates onto `observations[]`.
  - `raw` was already selected, so no new query is made.
  - A basis value this build does not know maps to null.
- **Web**
  - `vendorIntel.ts` gains optional DTO fields.
  - `vp-register.ts` gains `whenWords`, and the sighting sheet's "Seen" row now says which date it shows:
    - an issue-dated row reads *"dated 15 Jul 2026, the invoice's issue date (checked 3 Sept 2026)"*;
    - a fallback row reads *"dated when it was checked, 3 Sept 2026: \<reason\>"*;
    - a row with no basis (every row written before this change) keeps *"seen …"*.

Why this option: the column exists, and the code's own class-A rule already required it (`own-paper-sighting.ts:40`, "the event's own date, never `now()`"; ADR 0117:264-265). It changes none of the four `vendor_price_observations` readers' code, only the dates they read (the ADR's options 4 and 5 are variants of it). The `price_history` alignment moves two more readers, as above.

## Audit fix (BLOCK at 8cd5dca36)

The ADR 0090 audit at `8cd5dca36` was overturned on prose; it found no code defect. This head changes prose and one code comment only:
1. ADR 0273's Context no longer says every price window reads `observed_at`. It names the four `vendor_price_observations` windows and the two `price_history` windows that read `effective_date`.
2. ADR 0273's Consequences name both `price_history` readers and what the lane-picked alignment does to them: the 180-day supply window, and `offer-grade.ts` withholding the worth as too old (`:509`) or as dated after today (`:506-507`). It says plainly that this is the lane's pick.
3. The `price_history` cite moves from `procurement.service.ts:1866` to `:1879-1881`, where `effective_date` is written.
4. The `recordPriceHistory` comment (`procurement.service.ts:1873-1878`) drops the "agree by construction" quote. That sentence (`:6794-6796`) is about price and lot cost, not dates. Same line count, so no cite below it moves.
5. ADR 0273's content-hash sentence now says when a re-check writes a second row: after a correction, on a row written before this change, or whenever the dated day differs.

[2026-10-05: two commits follow that head. `bad5c62d9` merges `origin/main` at `8fdb819b4` (#591, #595, #603, #605, #606). `3f17bc311` rewords ADR 0273's 2026-10-04 trail row as *"Review at `8cd5dca36`: held on prose (no code defect)"*, since the ownership classifier read the old row as a gate-rule change. The ADR 0090 audit at `3f17bc311` is PASS (planner READY, both reviews APPROVE WITH NOTES, final HOLDS), report at `p4-scratch/sim-run/fixes/audits/608-3f17bc311/report.md`.]

## Tests and guards

**Re-run at this head:**
- Gateway jest `src/procurement` (`--runInBand --forceExit`): **97 suites pass and 1 is skipped; 1974 tests pass and 3 are skipped**, including `own-paper-sighting.spec.ts`.
- Gateway `tsc --noEmit -p tsconfig.spec.json`: 2 errors, both the missing `@simplewebauthn/server` module in `passkeys.service.ts`.
- `check_adr_numbers_unique` (0273 unique across 1685 refs), `check_od_ids_exist`, and `check_decision_claims.sh` (**853 checked, 853 holding**): all exit 0. The `AW05-OWN-PAPER-PRICE-DATED-BY-ITS-INVOICE` verify exits 0 on its own.
- CI at `8cd5dca36` (run 37239311762) passed every check, Supabase Preview skipped, per the audit report. CI has not run at this head yet. [2026-10-05: CI at `3f17bc311` is green on every required context; the jest and tsc numbers above were measured at `e5bc99b4d`, before the main merge, and were not re-run by hand at `3f17bc311` (CI ran them green). Re-run by hand at `3f17bc311`: `check_adr_numbers_unique` and `check_od_ids_exist` exit 0, and `check_decision_claims.sh` holds **873 of 873**.]

**Measured earlier, at branch head `464be180b`** ("re-run here" means re-run at that head):

**Gateway jest** (`--runInBand --forceExit`):
- `own-paper-sighting.spec.ts` + `vendor-comparison.provenance.spec.ts`: **82/82 pass** (re-run here).
- The new cases cover:
  - an issue-dated row at noon UTC;
  - the latest correction winning;
  - two invoices;
  - a future date refused;
  - a non-date correction refused;
  - `price_history.effective_date` matching;
  - no second sighting when the same receipt is re-checked a day later with the same issue date;
  - pure `dateReceiptSighting` and hash cases;
  - the compare DTO mapping.
- The **A-038 mechanism** case runs the real `VendorComparisonService.belowTrailingAverage` over the writer's own row: an invoice issued 2026-07-05 and checked 2026-09-03 is outside the 30-day box and inside the 95-day box.
- Verifier's wider run: `src/procurement src/vendor-intel src/promotions src/providers src/notifications/producers`, **155 suites pass and 1 is skipped; 3144 tests pass and 3 are skipped.**

**Web vitest:**
- `vp-register.test.ts` + `SightingSheet.test.tsx`: **47/47 pass** (re-run here).
- Verifier's wider run: `src/pages/vendor-prices src/services/api src/pages/notifications`, **27 files, 336 tests pass.**

**Fail-without-fix mutations** (verifier; each file overwritten with `git show origin/main:<path>`, then restored and `cmp`-checked; no stash):
- base `procurement.service.ts`: 11 failures in `own-paper-sighting.spec.ts`;
- base `vp-register.ts`: 6 web failures, including both new "Seen" render cases;
- base `vendor-comparison.service.ts`: 2 provenance failures.

**Typecheck** (re-run here): the gateway (`tsconfig.spec.json`) has 2 errors and the web has 1. All three are missing `@simplewebauthn/*` modules in the shared `node_modules`, and none is in a changed file.

**ESLint:**
- Gateway, 5 changed files: 0 errors.
- Web `--quiet`, 4 changed files: exit 0.

**Guards:**
- Re-run here, all exit 0:
  - `check_adr_numbers_unique` (0273 unique across 1668 refs);
  - `check_decision_claims.sh` (**842 checked, 842 holding**);
  - `check_no_conflict_markers`, `check_read_errors_not_swallowed`, `check_web_reads_gateway_dto_keys`;
  - `check_read_columns_exist`, `check_queried_tables_exist`;
  - `check_price_history_reads_group_by_unit`, `check_price_register_reads_are_scoped`;
  - `check_citation_pairing`, `check_od_ids_exist`, `check_a_count_is_recorded`;
  - `check_money_states_its_currency`, `check_windowed_figures`, `check_verified_at_is_not_a_boolean`.
- Verifier: all 44 `scripts/check_*.py` invoked from `ci.yml` exit 0, and the 11 that have a `--self-test` pass it.

**Local Postgres** (`pgtest.sh lane … sighting`, saved at `p4-scratch/sim-run/fixes/audits/sighting-local-pg.txt`). The run is vacuous: the lane has no SQL.

```
applied 0 migration(s) to sighting_fix
template=fb862aa574f710d4e1faf06df0ea50f1a5ce18cf lane_migrations=0 tests=0
```

## ADR / CLAIMS touched

- **New: ADR 0273**, *An own-paper price is dated by the invoice it was read from* (Proposed). The build lane picked three things, and the ADR names them as picks, not founder answers:
  - the noon-UTC placement;
  - the 1-day future tolerance;
  - the `price_history` alignment, which moves two `price_history` readers (named in its Consequences).
- **`.planning/decisions/README.md`**: one Proposed row, 0273, in number order.
- **`claims.d/fix-price-sighting-dated-by-issue.jsonl:1`**, `AW05-OWN-PAPER-PRICE-DATED-BY-ITS-INVOICE`, status `resolved`.
  - It covers **the writer's dating only**, and its text says A-038 stays open.
  - It is a static verify with 11 required needles plus 1 that must be gone. Each was mutated singly and failed every time, and the verify also fails against the base copies.
- No CLAIMS.jsonl edit (frozen, ADR 0240). No migration. The `20261219130000` slot is unused.

## Founder answers

The lane brief (`briefs/sighting.md`) has **no FOUNDER ANSWERS section**, so no answer governs this lane directly. Relevant picks from the 2026-10-04 AskUserQuestion round (verbatim, recorded in session memory, not yet in an ADR):
- C02: *"72 h; older needs a manager (Recommended)"*. This makes F1(b) below buildable as a follow-up. It is not built here.
- Merging: *"Merge when audited (Recommended)"*. This PR merges only after the ADR 0090 audit passes and CI is green.

The coordinator's fork register (`fixes/forks.md`) proceeds on the plan's recommendation for forks without a founder pick, so this lane built option (a) of F1–F3. ADR 0273 keeps all three open for the founder.

## Forks deferred (founder's call, not made here)

- **F1: date a paperless door check by something other than the check time?**
  - Built: (a), the check time, with the reason on the row.
  - (b) `client_captured_at` within the C02 72 h limit is now buildable on ADR 0286 (`doortime`).
  - (c) `delivered_at` waits on the AW03 door half.
  - Only F1 or filed paper can move a door-check house's windows.
- **F2: re-date own-paper rows already written?**
  - Built: (a), forward only.
  - (b) would be a migration that writes production data on merge, which needs his word.
  - It would not change Tuzlu, which names no paper.
- **F3: does a class-A row's `observed_at` hold the paper's date (a), or follow the class-C pattern (b)?**
  - Built: (a), Proposed.
  - The strongest evidence for (b) is quoted in the ADR: the column comment, and ADR 0117:419/:130.

## Merge-order notes

- **`origin/main` (`e2cbe426a`, #601 `logs`) is merged in** at `850a6a4ef`, and later `origin/main` `1aa4dcb8c` (#602, #604) at `8cd5dca36`. This head adds no merge. The only conflict was in `.planning/decisions/README.md`'s Proposed table, resolved by keeping both rows in number order. Re-run after that merge: `check_adr_numbers_unique`, `check_od_ids_exist` and `check_decision_claims`.
- **The same README-row-only conflict** showed in trial merges, taken before `8cd5dca36`, with #602 (`sig`), #603 (`postime`), #604 (`events`), #605 and #598. #602 and #604 have since merged and are in this branch. The others were not re-tried at this head; whichever merges second re-orders the rows.
- **#604 (`events`) also edited `procurement.service.ts`,** in the calendar-event closers. It is merged in at `8cd5dca36`, and that file merged without a conflict.
- **#577, #561 and #558** trial-merged clean before `8cd5dca36`; not re-tried at this head.
- **Hold these lines in later merges.** `CLAIMS.jsonl:684` greps the literal `provenance: receiptPaper,`, which is kept. This lane's claim greps `observedAt: receiptDate.observedAt`, `dating: receiptDate` and `args.sighting?.dating?.effectiveDate`. A later merge that rewrites those lines must keep them, or the claim fails CI on purpose.

## Not covered (CLAUDE.md §0.5)

- **A-038 is not fixed for Tuzlu.** Its 30, 95 and 365-day counts stay at 25. The reasons:
  - the house files no paper (F1);
  - existing rows are not re-dated (F2);
  - the source split of the 25 rows was never measured.

  Nobody should report A-038 as closed on the strength of this PR.
- **The AW05 fix text names "the invoice *or delivery* date".** Only the invoice half is built. The delivery half is F1(b) and (c).
- **The first commit `f7aba1e20`'s body is stale in two places.** It says the sim house's numbers "do not move until F1 is answered", which the ADR narrows, and that `logs` holds ADR 0271, which is now 0277. Squash-merge drops that body.
- **Behaviour disclosed in the ADR, not changed:**
  - An issue date one day after the check's UTC day is admitted. `observed_at` is then held at the check, but `effective_date`, `price_history.effective_date` and the hash day carry the later date. Until the UTC day catches up, `offer-grade.ts:506-507` withholds a worth against that price as "dated … after today".
  - A backdated invoice can fall out of the 180-day supply window (`vendor-menu-supply.ts:253`) and past `COMPARISON_MAX_AGE_DAYS` in `offer-grade.ts:509`.
  - There is no lower bound on an old issue date. A misread year dates the row into that past, and the remedy is the correction door.
  - A receipt checked before this change and re-checked after it at the same numbers writes a second row, unless the re-check dates to the first check's UTC day. A re-check after the issue date was corrected also writes a second row. Nothing supersedes the first.
  - A correction made after the check does not re-date the row.
  - The `order_confirmed` sighting is still dated at confirmation.
- **`check_gateway_boots.sh` was not run successfully, and was not re-run at this head.** `@simplewebauthn/server` is missing from the shared `node_modules`; CI must confirm the boot.
- **The sheet wording was not viewed in the Browser pane.** It needs a gateway with data, and production is off limits. Only the vitest render cases cover it.
- **The new web tests assert the exact `"3 Sept 2026"`.** That depends on en-GB ICU data. Main's own tests use a tolerant `Sept?` pattern. It passed on local Node 22, and on Node 20.x in CI at `8cd5dca36` (per the audit report). A later ICU change could still break it.
- **One old prettier warning** sits on a changed line (`procurement.service.ts:2853`, an indentation-only warning on the `.select` line that gained `doc_date`). The file's other 305 warnings are on lines this PR does not change.
- **The Postgres proof is vacuous** (0 migrations, 0 tests), because the change touches no SQL.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
