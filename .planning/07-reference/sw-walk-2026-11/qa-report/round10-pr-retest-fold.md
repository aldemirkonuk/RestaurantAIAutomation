# Round 10 PR re-test: Turkish dotless-ı fold series (2026-11-07)

Target: the PARTIAL in `round5-pr-retest.md` for #785 (existing rows not backfilled; `vendor-intel` `normalizeIdentityText` and SQL `beverage_normalize_text` still split Turkish names).

Read-only on the shared checkout (`gh pr view/diff`, `git fetch pull/N/head` only). All runs in one detached worktree at #832 head `8e597a07e` (the stack: 785 `fb2657833` < 829 `baf3aae29` < 830 `5b61da2e5` < 831 `8f6ccb827` < 832 `8e597a07e`), `/private/tmp/claude-501/qa-wt-fold`, node_modules symlinked, removed afterwards. Probes: `round10-probes-fold/`.

SQL fidelity: PGlite 0.5.8 (PostgreSQL 18.3), superuser, Supabase platform stubbed, `vector`/`postgis` stubbed (harness `p4-scratch/pglite-probe/audit-391-r5-endstate/pgbuild.mjs`). All 302 migrations of the stack head build (`parity.mjs`). Not run against a real Supabase or production data; the production count of affected rows is unmeasured. PGlite's `lower()`/ctype may differ from Supabase's, but the fold uses `translate()`, which does not depend on ctype.

| PR | Verdict | One line |
|---|---|---|
| #829 shared letter fold | **FIXED** | `beverage_normalize_text` now folds; JS, SQL and Python agree on 230 strings; one unpinned part (the `identity_key` refresh `UPDATE`). |
| #830 vendor identity key | **PARTIAL** | The vendor key folds, but "without a second bottle" holds only for the same ı spelling; an ASCII/caps assertion after an ı-asserted bottle still makes a second row. |
| #831 ladder / outlier priors | **FIXED** | Pre-fold sightings stay in the ladder and in both prior reads, for an ı-spelled library wine; spelling-conditional by design, one query-side half not test-pinned. |
| #832 signature refold | **PARTIAL** | Behaviour is correct (merges nothing, idempotent, atomic, tenant-safe), but the headline pair stays split with nothing reading the review table, a roster row can be orphaned, and its spec is a text grep that 6 of 8 behaviour mutations survive. |

Counts: FIXED 2, PARTIAL 2, NOT FIXED 0, REGRESSION 0. (#785 itself is context: its migration refreshes only `normalized_*`; the stored `signature_hash` is untouched, confirmed in PGlite, which is the gap #832 targets.)

---

## Execution matrix

### Spellings (JS, SQL, Python on the SAME 230 strings, `parity.mjs`, `js-out.json`)

230 strings: Kavaklıdere / KAVAKLIDERE / Kavaklidere, İstanbul / ISTANBUL / istanbul / ıstanbul, ı / i / İ / I, `ıİiI`, NFC and NFD of every word, `toLocaleUpperCase("tr")` / `toLocaleLowerCase("tr")` of every word, ß, ẞ, Ł, Ø, fullwidth `ＩＩ`, Ⅰ, `i`+U+0307, ZWSP/NBSP/tab/empty, 100 seeded random mixes of `aeiıİIoöuüsşcçgğ .'-`.

1,610 comparisons (fold, library normaliser vs `wine_normalize_text`, `hashWineSignature` vs `wine_signature_hash`, SQL `beverage_normalize_text` vs Python `norm()`, vendor normaliser vs both).

- **Fold mismatches: 0.** JS `foldUndecomposableLetters` = SQL `fold_undecomposable_letters` on all 230. `normalizeSignatureText` = `wine_normalize_text` on all 230. `hashWineSignature` = `wine_signature_hash` on all 230. SQL `beverage_normalize_text` = Python `norm()` on all 230.
- 32 mismatches, every one a trade-abbreviation string (`Ch.`, `St.`, `Dom.`, `Mt.`; six of them also contain ı, e.g. `dom. ı`). These are the library normaliser expanding abbreviations while the vendor-identity and beverage normalisers deliberately do not. Not a fold defect (`parity-mismatches.json`; filtering abbreviation strings leaves 0).
- Spelling table (library key, vendor key, pre-fold vendor key):
  - `Kavaklıdere` / `Kavaklıdere` NFD / `kavaklıdere` -> `kavaklidere` / `kavaklidere` / `kavakl dere`
  - `KAVAKLIDERE`, `Kavaklidere` -> `kavaklidere` in all three
  - `İstanbul`, `ISTANBUL`, `istanbul`, `İstanbul` NFD, `ıstanbul` -> `istanbul` (pre-fold `ıstanbul` was `stanbul`)
  - `ı` -> `i`; `İ`, `I`, `i` -> `i`; `ıİiI` -> `iiii`
  - sig hash and identity hash are equal across the 7 Kavaklıdere spellings (NFC, NFD, tr-upper, tr-lower, caps, ASCII).
- Same class, still unfolded and disclosed: `Weißburgunder` -> `wei burgunder`, `Łódź` -> `odz`, `Ⅰ` and `ＩＩ` -> empty string.
- **Other code that hand-rolls its own ı fold, off the shared table:** `inventory/house-item-research.ts:116` and `promotions/offer-grade.ts:319` (both correct for ı today, drift risk only). **Same defect class, not folded:** `providers/vendor-wine-search.ts:115` `fold()` keeps `ı` as a letter, so a search for "kavaklidere" cannot match a "Kavaklıdere" title. Outside these four PRs; flagged for a later one.

### Stateful scenarios (`scenarios.mjs`, output `scenarios.out.txt`)

Build every migration before 785, seed old-rule data, apply 785 and 829, run "deploy window" traffic, apply 832. Seed: 17 library rows (ı pairs, an all-caps twin, a soft-deleted all-caps hash holder, a soft-deleted ı row, a NULL-hash ı row, ı only in `region`, a non-ı corrupted hash, two venue-scoped provisional ı rows), roster, menu_changes, submissions, two colliding beverages.

Result: 31 checks, 30 PASS, 1 FAIL (the orphan finding below).

- 829 applies over two beverages that collide after the fold: no unique violation (`idx_beverages_signature_hash` is on `signature_hash`, which the trigger does not recompute; `identity_key` is non-unique). Both survive and now share `kavaklidere||kalecik karasi`. The duplicate is exposed, not merged.
- **Two stored rows colliding after the fold: keep, never merge.** Row count 17 -> 17, same ids, no new soft-deletes. Oldest ı-row takes the hash (B1); the younger is held back and reviewed (B2, held_by B1). An older ı-row facing an already-correct all-caps row is held back whatever the ages (C1 vs C2 older-ı, D2 vs D1 younger-caps). A soft-deleted holder also blocks (J2, held_by J1).
- The headline pair itself: library row A1 (`Kavaklıdere / Yakut`, stored pre-fold) and K1 (`KAVAKLIDERE / YAKUT`, inserted after 829 shipped) stay two rows after 832. A1 is held back, `held_by` K1. The migration does what it says; the B-1 wine is still two library rows until someone calls `merge_library_wines`.
- Untouched as promised: soft-deleted ı row, NULL-hash ı row, non-ı drift row. Moved: ı-only-in-region row, the plain ı row, both provisional venue rows (to different hashes, each venue's roster copy followed its own row only).
- Copies follow a row that moves: submission, 2 menu_changes and the other venue's roster copy of B1 all moved to the folded hash. Copies of a held row stay with it.
- **Run twice and three times:** snapshot of library, copies, review rows and beverages is byte-identical after the 2nd and 3rd run (the review table has `UNIQUE (table_name,row_id,folded_hash)` + `ON CONFLICT DO NOTHING`).
- **Interrupted halfway** (trigger injected to raise when the loop reaches a late roster update): the whole file rolls back (review table not created, no hash moved). After the fault is removed, the re-run ends in the same end state as an uninterrupted run on an identical build. The `DO` block is one statement, so it is atomic even if pasted alone; the file is atomic under the CLI's one-transaction-per-file.
- **Unique-index violations:** none on window data (including a roster collision and a submission already under the folded hash; submissions and menu_changes have no unique hash index, roster has `uq_roster_restaurant_hash` and is guarded). Removing the `CONTINUE WHEN v_holder IS NOT NULL` guard produces `idx_master_wine_library_signature_hash` duplicate-key at once, so the guard is load-bearing and the PGlite scenario proves it.
- **Tenant scope:** shared-row hashes are global, so copies of a moved shared row move for every tenant; a venue-scoped (provisional) row's hash embeds the venue id, so its copies are only that venue's. The roster move is per-venue guarded. Review table: `SET ROLE authenticated` and `anon` both get `permission denied`; service_role only.
- **FAIL (finding F2):** after 832, roster row `Karasi Ozel (old key)` in venue A keeps the old hash (its venue already held the folded hash, so the guarded roster `UPDATE` skipped it and wrote a review row), but the library row it pointed to has moved. It now joins no live library row. Recorded in the review table, but it is a dangling roster reference until a person resolves it.

### Price-ladder continuity (`ladder.probe.spec.ts`, `ladder-out.json`)

Service `VendorComparisonService.compare`, fake store that evaluates the `signature_hash.eq.` clauses. Rows: one stored under the pre-fold hash, one folded, one caps, one unrelated wine.

- Library wine spelled `Kavaklıdere` (NFC or NFD): ladder = pre-fold + folded + caps vendors; the unrelated wine is excluded; a row matching both keys is returned once.
- Library wine spelled `KAVAKLIDERE` or `Kavaklidere`: ladder = folded + caps only; the pre-fold sighting is **not** there. `hashWineIdentityBeforeFold` returns null when the library spelling has no ı. This is not a regression (that sighting never matched an ASCII-spelled wine) but the continuity is spelling-conditional.
- `signatureHash`-only query (controller path, `vendor-intel.controller.ts:57`, no library wine): folded rows only; no pre-fold key can be derived from a hash.
- Tenant scope: the added key rides in the same product `.or()` clause (`master_wine_id.eq.<uuid>,signature_hash.eq.<hex>,signature_hash.eq.<hex>`), separate from the visibility and `restaurant_id` clauses, which stay separate AND-ed `.or()` calls. Only hex hashes and a uuid are interpolated.
- Not covered by the PR: `outlier-rejudge.ts:211` groups no-master-id rows as `sig:<signature_hash>`, so pre-fold and folded sightings of one bottle sit in two groups there. Transient: the rejudge window is 30 days (`outlier-rejudge.ts:99`), the ladder window defaults to 365 (`vendor-comparison.service.ts:283`).

### Vendor identity register (`identity-keys.probe.spec.ts`, `identity-keys-out.json`)

Bottle asserted before the fold with producer `Kavaklıdere` holds `kavakl dere|yakut|unstated|750|1`-style pre-fold key. A re-assertion can find it only if the new subject also has ı (`Kavaklıdere`, `kavaklıdere`: `findsStoredRow: true`). `KAVAKLIDERE`, `Kavaklidere`: `identityKeyBeforeFold` is null, only the folded key is looked up, the stored row is not found, a second bottle is created. `suggest()` blocks on exact `producer_normalised` (`identity.service.ts:326`), so it cannot offer the pre-fold row either (the PR lists this as NOT covered).

---

## Per-PR verdicts

### #829 FIXED
Claim: one fold table; `beverage_normalize_text` gains the fold; Python mirror gains it; beverage `identity_key` refreshed.
- Code: `common/fold-letters.ts` (table), `wines/wine-signature.ts:145`, migration `20270404100000_names_share_one_letter_fold.sql:45` (function), `:86` (`wine_normalize_text`), `:134` (`beverage_normalize_text`), `:155` (`UPDATE public.beverages`), `scripts/eval_merge_policies.py:44`.
- Run: 230-string parity above (0 fold mismatches); beverage collision case applies and exposes the duplicate; `jest src/common src/wines ...` 964 passed at the stack head; `pytest scripts/test_fold_letters_mirrors.py scripts/test_synth_identity.py` 22 passed; `tsc --noEmit` only reports the unrelated missing `@simplewebauthn/server` in the symlinked tree.
- **Fails without the fix?** Yes for two of three parts, by mutation (`mutations-first-run.json`):
  - drop the fold from `beverage_normalize_text`: 1 jest test fails (`fold-letters.spec.ts`, "is called by the latest public.beverage_normalize_text", a text pin on the migration, not an execution);
  - drop the fold from `wine_normalize_text`: 1 jest fails (same kind);
  - drop it from `eval_merge_policies.py norm()`: 3 pytest fail;
  - **drop the `UPDATE public.beverages` refresh (`WHERE false`): nothing fails** (jest 777 pass, pytest 22 pass). Behaviour is right in PGlite, but no committed test protects the backfill half.
- Residual (not this PR's claim): `services/agent-orchestrator` normalisers unchanged, disclosed.

### #830 PARTIAL
Claim: fold `normalizeIdentityText` in the vendor identity key, "without a second bottle".
- Fixed: `wine-identity.ts:53` / `:71` (fold applied; the pre-fold normaliser kept read-side only), `beverage-identity.ts:242` `identityKeyBeforeFold`, `identity.service.ts:395-402` second lookup. Page `Kavaklıdere` and price list `KAVAKLIDERE` now hash equal (probe).
- Not fixed: a bottle asserted pre-fold with ı is found again only by an ı-spelled re-assertion; an ASCII or caps spelling of the same bottle creates a second `beverage_identities` row (probe above), and `suggest()` (`identity.service.ts:326`) will not offer the old row. The PR documents both as NOT covered; there is no backfill of identity keys (it cannot tell `kavakl dere` from a real space).
- **Fails without the fix?** Yes: normaliser fold off -> 3 jest fail (`wine-identity.spec`, `fold-letters.spec`); second lookup off -> 1 jest fails (`identity-curation.spec`, "finds the row under its old key rather than asserting it twice").

### #831 FIXED
Claim: pre-fold vendor sightings stay in the price ladder and both outlier-prior reads.
- Code: `vendor-comparison.service.ts:322-325` (ladder), `:637-641` (`priorUnitPricesInClass`), `vendor-page-extractor.service.ts:604-608,636` (page extractor priors). Writes only the new hash (`vendor-comparison.service.ts:537`).
- Run: ladder probe above; full spec set passes at stack head.
- **Fails without the fix?** Yes for the ladder (1 jest), the manual-observation priors (1 jest) and the extractor's bucketing (`counts priors stored under the pre-fold hash`, 1 jest). **No** for the extractor's query side: removing the pre-fold hashes from the `.in("signature_hash", unique)` read (`:608`) leaves all 18 `vendor-site-writer` tests green, because the mock returns priors regardless of the query. Verified correct by reading, not by a test.
- Caveats for the record: continuity needs the library wine itself spelled with ı (probe); the `signatureHash`-only path gets no pre-fold key; the rejudge job groups the two hashes apart for up to 30 days.

### #832 PARTIAL
Claim: recompute wine signatures the fold changed, merging nothing.
- Code: `20270405100000_wine_signatures_refold_dotless_i.sql:104` (oldest first), `:111` (`CONTINUE WHEN v_holder`), `:119,:123,:138` (copies), `:148` (repeat until nothing moves), `:136,:165` (review rows), RLS on the review table.
- Run: everything in the scenario section above; all behaviours the PR claims hold in PGlite.
- Why not FIXED:
  1. **The headline pair is still two rows, and nothing reads the queue.** `wine_signature_refold_review` is referenced only by the migration, its spec and the tech-debt note (grep over `apps scripts .github .planning supabase`). So a held ı-row, including the original `Kavaklıdere` / `KAVAKLIDERE` pair, sits unresolved with no UI or job to surface it.
  2. **Dangling roster row** (F2): a roster copy kept on the old hash after its library row moved joins no live library row.
  3. **The committed test cannot protect behaviour.** `wine-signature-refold.migration.spec.ts` greps the SQL text. Mutations that survive it (all caught by my PGlite scenarios): order oldest-first -> newest-first, single pass instead of repeat-until-stable (no difference on my data), skip the submissions update, skip the menu_changes update, drop the `ı` filter (moves non-ı drift, caught as "X1 touched"), drop the NULL filter (G1 caught). Only removing the holder guard fails the spec. The PR's real proof (`f785-wave3-refold-proof.mjs`, 29 checks) lives in `p4-scratch`, outside the repo and CI. Re-run of the two copy mutations against my improved scenario: both caught (`mutations-832-rerun.json`).
- **Fails without the fix?** Trivially yes (spec reads a file that would not exist), meaningfully only for the holder guard.

---

## Findings to track

| # | Where | Finding |
|---|---|---|
| F1 | `identity.service.ts:395`, `:326` | Identity register: cross-spelling assertion after a pre-fold ı assertion still makes a second bottle; `suggest` cannot see it. (#830) |
| F2 | refold migration `:138` | Roster row kept on old hash joins no live library row after its library row moves. Review row exists, no resolver. (#832) |
| F3 | refold review table | No reader: held pairs (incl. Yakut) are recorded but never surfaced. (#832) |
| F4 | `wine-signature-refold.migration.spec.ts` | Text-grep spec; 6 of 8 behaviour mutations survive; real proof is outside the repo. (#832) |
| F5 | `20270404100000...sql:155` | The beverage `identity_key` refresh `UPDATE` has no test (mutation survives). (#829) |
| F6 | `vendor-page-extractor.service.ts:608` | The pre-fold hashes being added to the priors query is not pinned by any test. (#831) |
| F7 | `outlier-rejudge.ts:211` | `sig:<hash>` groups split pre/post-fold for up to 30 days. (#831, transient) |
| F8 | `vendor-comparison.service.ts:741` | Pre-fold key exists only when the library wine is ı-spelled; ASCII-spelled wines never regain old sightings (no backfill possible; no producer column). |
| F9 | `providers/vendor-wine-search.ts:115` | Search `fold()` keeps `ı`; "kavaklidere" does not find "Kavaklıdere". Same defect class, outside the series. |
| F10 | `house-item-research.ts:116`, `offer-grade.ts:319` | Two more hand-rolled ı folds off the shared table (consistent today). |

Not run / not verified: real Supabase (ctype, `supabase db reset`), production row counts, the browser UI, #785's own specs (included in the 964-pass run, not separately mutated), the Python orchestrator normalisers.
