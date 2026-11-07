## Stored wine keys computed before the dotless-ı fold are stale — OPEN — 2026-11-07

Branch `fix/wine-name-folds-turkish-i` (QA round 1, B-1) makes
`public.wine_normalize_text` and its three mirrors fold Turkish dotless "ı"
(U+0131) to "i", so "Kavaklıdere" and "KAVAKLIDERE" now produce one key. The
migration `wine_names_fold_turkish_dotless_i` replaces the function only. It does **not** recompute stored keys, on purpose:

- `master_wine_library.signature_hash` carries a UNIQUE index. A recomputed hash
  can land on another row's hash; that collision is the duplicate this fixes
  and needs a merge decision (`merge_library_wines`), not an `UPDATE`.
- The same hash is copied into `master_wine_library_submissions.signature_hash`,
  `restaurant_wine_roster.signature_hash` and `menu_changes.wine_signature_hash`,
  so a library-only backfill would split those from the library.
- `master_wine_library.normalized_name` / `normalized_producer` and
  `beverages.normalized_name` / `normalized_producer` are trigger-synced and
  refresh only when an identity column is next written.

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

Two other normalisers have the dotless-ı gap and were not changed:
`normalizeIdentityText` in `apps/api-gateway/src/vendor-intel/wine-identity.ts`
(vendor matching, TypeScript only) and `public.beverage_normalize_text`, which
must stay in lockstep with `scripts/eval_merge_policies.py` `norm()` and the
merge-eval corpus (`scripts/check_beverage_identity_parity.py`).
