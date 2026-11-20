# Round 8 re-test: Wine Studio B-1 series (#807 1/4, #808 2/4, #810 3/4, #811 4/4)

Date 2026-11-07. Read with `gh pr view/diff` and `git fetch origin pull/N/head` into private refs. Nothing was checked out, merged, pushed or commented in the shared checkout. Work was done in one detached worktree (`/private/tmp/claude-501/qa-wt-all` = origin/main + octopus merge of the four PR heads; merged cleanly, including 808+810 both editing `studio_routes.py`). Worktree and refs removed afterwards.

## What was actually run

- PGlite 0.5.8 (PostgreSQL 18.3), all 299 migrations of the merged tree applied with the round-4 harness (`p4-scratch/pglite-probe/audit-391-r5-endstate/pgbuild.mjs`; stub vector/postgis; migrations run as superuser, no Supabase platform). Probe: `/private/tmp/claude-501/qa8/probe.mjs`, `probe2.mjs`.
- The rows `build_library_row` really produces (dumped from the Python) were inserted into the real `master_wine_library`.
- Python: venv from `requirements.txt`; PR test files, then each fix reverted to origin/main with the tests kept (mutation), then the full orchestrator suite. Web: vitest for `src/pages/studio`, one mutation, `tsc --noEmit`.
- Claims guard `scripts/check_decision_claims.sh` on the merged tree: 1063 checked, 1063 holding.
- NOT run: a real Supabase/PostgREST stack (so PostgREST-side error shapes such as `code` on `APIError` are the PRs' assumption, not measured), a browser, production. RLS result below is the PGlite role grant, not Supabase's.

## Round 5 blocker, answered directly

Every key `build_library_row` emits exists as a writable column of the migrated `master_wine_library` (script printed `builder keys missing from real table: []`), and real inserts succeeded for a plain red, an NV Champagne and a Turkish-character wine. The `submissions` update keys (`status`, `auto_blocked`, `matched_master_id`) exist too, with FK `fk_mwls_master ... ON DELETE SET NULL`. The old 15-column payload is gone. The PRs' own test replays migrations with regexes (not a database), and it agrees with the real build, so the replay is sound for this table today.

## Verdicts

| PR | Verdict | Fails without the fix? |
|---|---|---|
| #807 1/4 review-queue path + shared builder | FIXED | yes (1 failed / 13 passed with `quality_routes.py` reverted; `TestReviewQueuePath`) |
| #808 2/4 manual Promote | PARTIAL | yes (3 failed with `studio_routes.py` reverted) |
| #810 3/4 auto path says the outcome | FIXED (one half-state noted, F-3) | yes (7 failed with `override_service.py` reverted) |
| #811 4/4 Studio says it | FIXED (one test gap, F-8) | yes (3 failed with `FieldCell.tsx` reverted) |

Counts: FIXED 3, PARTIAL 1, NOT FIXED 0, REGRESSION 0.

Full orchestrator suite on the merged tree: 1741 passed, 55 skipped, 0 failed. Web studio: 9 passed, `tsc --noEmit` clean.

## Findings

**F-1 (#808, PARTIAL) NV and generic wines are refused by the manual path's name pre-check, which sits in front of the unique index.**
`api/studio_routes.py` merged tree `:1010-1032` (unchanged lines, but unreachable before this series, so they were never exercised). The pre-check ignores vintage when vintage is NULL, ignores producer when producer is empty, and passes the name to `ilike` unescaped. Run against an in-memory library holding Krug Brut Reserve 2016 and Muga Reserva 2015 (`/private/tmp/claude-501/qa8/probe_precheck.py`):
- NV Krug Brut Reserve (a different wine) -> 409 "Wine already exists in library".
- 2019 Krug -> promoted (correct). Reserva with producer omitted -> 409 against Muga's wine. Name `Br_t Réserve` and name `%` -> 409 (wildcards).
The PR comment says "NV is NULL, never a 500"; true, but the NV wine is then refused while any vintage of it exists. The UI shows this as the quiet "duplicate" state (`WineRecordsTable.tsx:57-60`), so a sommelier is told the wine is already there when it is not. The unique index (producer, name, vintage-or-NV, country, region, grape) would have decided correctly; the pre-check is stricter than the index. Fix direction: drop the pre-check or make it use the same six-field key. No test covers it (`test_library_promotion_manual.py` double returns no match for every pre-check).

**F-2 (#807/#808/#810, design gap, shared builder) A name-only submission becomes a shared library row keyed on the name.**
Real DB: `{name:'Red', primary_type:'unknown'}` inserts as `identity_status='normal'` (not quarantined; the quarantine trigger only fires when normalized producer = normalized name), and a second house's different "Red" is then `23505` -> reported as "already in the wine library". The manual path demands only `wine_name` (`studio_routes.py:1000`). `producer` and `country` are nullable now (baseline had them NOT NULL; a later migration relaxed them), so nothing in the database stops it. ADR 0130's remedy for generic names is `provisional_for_restaurant_id`; the builder does not use it. The auto path is somewhat protected by the `should_auto_block` field-ratio gate; the manual path is not. Not a regression (the old code could not insert at all), but it is the first moment the hazard is live.

**F-3 (#810, half-state, FIXED with a note) Wine already in the library: the submission is left unlinked and `pending_review`.**
`override_service.py:431-436` returns `ALREADY_IN_LIBRARY` before the `status`/`matched_master_id` update; the manual path (`studio_routes` 409) and the review queue (`quality_routes` 409, raised after the corrections and `field_confidence` were already committed) do the same. Run: `auto, wine already in library -> already_in_library | submission updates: []`. Effect: the second contributor of the same wine is told "already in the library" on every later override and the submission never reaches approved and never points at the existing row. Honest wording, but the link the rest of the product reads (`matched_master_id`) is never written for the duplicate. Suggest returning the existing row id from the unique-violation and linking it.

**F-4 (#807, wording) Misclassified or untrue sentences at the edges.**
- `_is_unique_violation` matches any `23505`: a `wine_id` collision (constraint `master_wine_library_wine_id_key`, probe 'wine_id-collision' on a real DB) is reported as ALREADY_IN_LIBRARY. The wine_id is `WINE_` + 8 base36 time chars + 6 random chars, so the odds are about 5e-10 per same-millisecond pair; negligible but the label is wrong.
- A client timeout after the server committed reads `FAILED` ("Nothing was added") although the row may be there. Run: `auto, timeout after server commit -> failed`. A retry then meets the unique index and says "already in the library", which self-corrects. Row-written-but-UI-says-failed is possible only in this window.
- The reverse (UI says added, row absent) was not found: PROMOTED is returned only after the insert call returns without raising; the link-write failure after a good insert correctly stays PROMOTED (`override_service.py:445-452`, covered by reading, not by a test).

**F-5 (#807) Over-length values fail the whole promotion with no field named.**
Real DB: a 300-char name (`varchar(255)`), a 150-char region (`varchar(100)`) and a 60-char primary_type (`varchar(50)`) each raise `22001`. The builder does not truncate or validate; the contributor reads "could not be added ... Nothing was added" and cannot tell which field. Honest, not silent; low likelihood from real menus.

**F-6 (#808/#810) Magnum vs 750 ml.**
`bottle_size_ml` is not in the signature, and the builder never sends it, so every promoted row is 750. A magnum of a wine whose 750 is already in the library is `23505` -> "already in the library" (probe: both 'magnum-same-identity' and 'magnum-explicit-1500'); a magnum promoted first is stored as 750. This is the old code's behaviour too (it hard-coded 750) and the PR names it as QA BG-13's open question, so it is open, not a regression.

**F-7 Turkish characters (pre-existing, outside the diffs, but the PRs now rely on the index).**
`wine_normalize_text` strips every non-ASCII letter rather than folding it: `Öküzgözü Şirince Çalkarası İstanbul ığ` -> `okuzgozu sirince calkaras istanbul g`. In the real DB the same Turkish wine written `Öküzgözü Reserve / Şirince Şarapçılık`, `Okuzgozu Reserve / Sirince Sarapcilik` and `ÖKÜZGÖZÜ RESERVE / ŞİRİNCE ŞARAPÇILIK` produced three separate library rows (probe 'turkish', 'turkish-ascii-variant', 'turkish-upper-I'), so duplicate protection does not hold across Turkish spellings; conversely two names differing only in a stripped letter would collide. The PRs store the Turkish text intact (no mangling in `name`/`producer`; `Türkiye` and `Elazığ` stored as typed). Owned by the signature function, not this series.

**F-8 (#811) Gaps, not defects.** `StudioApprovalQueue.tsx` (reviewer approval -> `library` notice) has no component test; only `FieldCell` and `libraryNotice` are covered. `WineRecordsTable.tsx` (the manual Promote button) was not touched: 409 stays a silent "duplicate" pill, 503 now shows the new sentence. `FieldCell` can show two toasts for one save ("Override saved" success, then a library error); acceptable, both true.

## Duplicate / concurrency / RLS results (real DB)

- Promotion twice, case variants of one identity, NV twice: first insert OK, second `23505` on `idx_master_wine_library_signature_hash` (trigger `trg_sync_signature_hash` computes the hash on insert, so the index genuinely decides). No duplicate rows. This is what protects two contributors promoting the same wine at once: the unique index serialises them and the loser gets ALREADY_IN_LIBRARY (see F-3 for the loser's leftover state).
- Duplicate across vendors: vendor is not part of the row or the signature; same producer/name/vintage/country/region/grape is one wine. Correct for a shared library.
- RLS/tenant: as `authenticated` an insert into `master_wine_library` is `42501 permission denied`, as `anon` even select is denied in this PGlite (grants differ from Supabase's `anon_read_master_wine_library` policy, so treat as role-grant evidence only). Writes therefore depend on the orchestrator's service-role client. The row now carries no `restaurant_id`, price, bin or section (QA H-4 closed); the submission is fetched by id only (`studio_routes.py:~973`) with the Studio role gate as the only guard, as before.
- Partial failure: library insert refused -> nothing written, FAILED, submission untouched (test + code). Insert good, link write refused -> row exists, PROMOTED, submission left unmarked (F-3 variant). Review queue: 409/503 raised after corrections were committed, so the response is an error while earlier edits persisted; the 503 text says "Nothing was added" which is true of the library but omits that the edits were saved (the auto path's FAILED text does say it).

## Merge order and intermediate states

Stack: 808 and 810 both target 807's branch; 811 targets main. Octopus merge of all four is clean; 808 then 810 or 810 then 808 both auto-merge (distinct hunks).
- 807 alone: review-queue path honest and working; Studio auto path still writes the 15 ghost columns and still answers "auto_promoted" with nothing in the library; manual Promote still 503. The library row builder exists but two of three callers do not use it. Not a broken state, but the headline lie persists.
- 807+808: manual works; auto path lie persists until 810.
- 807+810 (no 808): auto honest; manual 503 "Failed to insert" with the old payload.
- 811 anywhere: harmless against an old orchestrator (no `library` key -> no notice, same as today); it also fixes `logged_apply_failed` being toasted as "Override saved", independent of the backend.
- 808's claim row `ADR-0163-STUDIO-PROMOTE-DIRECT-INSERT` flips to resolved and holds on the merged tree; the two sibling claim rows (`...OVERRIDE-AUTOPROMOTE-SELECT`, `...QUALITY-PATCH-SELECT`) stay `open` and still hold, which is correct because `jsonb_cols` selects remain (they select the JSONB keys from `master_wine_library_submissions`; the columns do exist in the migrated database, see Not verified).

## Not verified

- RESOLVED after the first draft: on the migrated PGlite, `master_wine_library_submissions` has all seven JSONB enrichment columns the auto path and review queue SELECT (grape_family, wine_structure, sensory_profile, practical_attributes, region_hierarchy, critic_scores, winemaking_details) plus `ai_enriched`, `enrichment_source`, `matched_master_id`. So the two sibling claim rows hold as open only in the grep sense; the SELECTs themselves are valid (probe3.mjs).
- PostgREST's real error object (does it expose `.code == "23505"`?). The classifier also matches on text, which works either way.
