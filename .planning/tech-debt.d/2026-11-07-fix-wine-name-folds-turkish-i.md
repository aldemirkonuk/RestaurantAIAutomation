## Stored wine keys computed before the dotless-ı fold are stale — OPEN — 2026-11-07

Branch `fix/wine-name-folds-turkish-i` (QA round 1, B-1) makes
`public.wine_normalize_text` and its three mirrors fold Turkish dotless "ı"
(U+0131) to "i", so "Kavaklıdere" and "KAVAKLIDERE" now produce one key. The
migration `wine_names_fold_turkish_dotless_i` replaces the function and
refreshes `normalized_name` / `normalized_producer` on `master_wine_library`
and `beverages` for every row whose name or producer holds an "ı" (non-unique
columns; the UPDATE does not fire `trg_sync_signature_hash`). Without that
refresh a re-import of a stored Turkish wine would match nothing and create a
duplicate (PGlite: "Yakut / Kavaklıdere" returned no candidate: producer
similarity under the 0.70 floor, 0.6 by the audit's measure; with it, confidence 100). It does **not**
recompute `signature_hash`, on purpose:

- `master_wine_library.signature_hash` carries a UNIQUE index. A recomputed hash
  can land on another row's hash; that collision is the duplicate this fixes
  and needs a merge decision (`merge_library_wines`), not an `UPDATE`.
- The same hash is copied into `master_wine_library_submissions.signature_hash`,
  `restaurant_wine_roster.signature_hash` and `menu_changes.wine_signature_hash`,
  so a library-only backfill would split those from the library.
- Until the hash is repaired, an exact re-import reaches the stored row
  through the normalized-name leg of `match_library_wine`, not the signature
  leg, so it still links; what stays stale is the hash itself.

How many rows this touches is **not measured** (this branch may not query
production). The next step, by whoever is allowed to read production:
`SELECT count(*) FROM master_wine_library WHERE concat_ws(' ', producer, name,
country, region, grape_variety) LIKE '%ı%';`, then
`SELECT * FROM fn_repair_signature_hashes(false);` (reports only, skips
collisions) once the migration is live; rows needing a merge show as
`SKIPPED_COLLISION`. Every row with an "ı" also shows in `v_signature_drift`
until it is repaired or merged.

## Other letters NFD cannot fold are still split — OPEN — 2026-11-07

Same class as the dotless ı, deliberately left out of that branch: ß, ø, ł, đ,
æ, œ (and their capitals) have no decomposition either, so `wine_normalize_text`
still turns them into a space ("Weißburgunder" keys as "wei burgunder", the
capitals as "weissburgunder"). Not fixed with ı because the right fold is a
choice (ß → "ss" or "s", ø → "o" or "oe", æ → "ae" or "a") and each moves more
stored keys; it needs its own probe of the library before it is picked.

Wave 3 (2026-11-07): the fold is now one table, `UNDECOMPOSABLE_LETTERS` in
`apps/api-gateway/src/common/fold-letters.ts`, with an SQL twin
`public.fold_undecomposable_letters()` (migration `names_share_one_letter_fold`,
separate so `wine_names_fold_turkish_dotless_i` can ship alone) that both
`wine_normalize_text` and
`public.beverage_normalize_text` call (so beverage `identity_key` folds "ı" too,
and the refresh UPDATE recomputes it through `trg_beverage_identity`), and
Python copies in `scripts/synth/identity.py`, `scripts/load_enriched_wines.py`
and `scripts/eval_merge_policies.py` `norm()` (byte parity with
`beverage_normalize_text`; the merge-eval corpus has no "ı", and the 0a gate
output is identical before and after). `fold-letters.spec.ts` and
`scripts/test_fold_letters_mirrors.py` fail when any copy drifts.

Still open on this branch: `normalizeIdentityText` in
`apps/api-gateway/src/vendor-intel/wine-identity.ts` (vendor matching) keeps the
gap here; it moves to the shared fold in the stacked PR that follows, together
with a read of the pre-fold key so stored price observations are not orphaned.
`services/agent-orchestrator/services/beverage_ontology.py` `normalize_text`
(token matching only, not an identity key) and the other Python normalisers in
`services/agent-orchestrator` were not changed.
