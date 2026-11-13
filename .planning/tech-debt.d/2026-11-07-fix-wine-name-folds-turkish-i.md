## Stored wine keys computed before the dotless-ı fold are stale — PARTLY RESOLVED — 2026-11-07

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

Recompute (stacked `fix/wine-signatures-refold-dotless-i`): the migration
`wine_signatures_refold_dotless_i` moves each live drifting row with an "ı"
to its folded hash, oldest first, together with its submissions, menu_changes
and roster copies. When another row already holds the folded hash it moves
NEITHER row: the later one keeps its old hash and the pair goes to
`public.wine_signature_refold_review` (`held_by` = the holder); a roster row
whose venue already holds the new hash is kept and recorded the same way.
Each review row is a merge decision (`merge_library_wines`), never an UPDATE.
Proven in PGlite 0.5.8 (p4-scratch/pglite-probe/f785-wave3-refold-proof.mjs,
29 checks, second run a no-op); removing the holder check or the roster guard
fails on the UNIQUE index (23505).

Still open: how many rows it moves or holds in production is **not
measured** (no production reads from this lane):
`SELECT count(*) FROM master_wine_library WHERE concat_ws(' ', producer, name,
country, region, grape_variety) LIKE '%ı%';` before, and
`SELECT * FROM wine_signature_refold_review WHERE resolved_at IS NULL;` after.
Provisional (venue-scoped) rows were not seeded in the PGlite proof; the
migration takes their hash from `v_signature_drift`, which applies the venue
formula, but that path is unexercised.

QA round 10c: the body is now `public.refold_wine_signatures_dotless_i()`
(owner only), called once by the migration and run by the behavioural test
`supabase/tests/20270405100000_wine_signatures_refold_dotless_i_test.sql`
(CI does not run supabase/tests; run by hand through pgtest). The Kavaklıdere
/ KAVAKLIDERE Yakut pair stays two rows by design (test T1): the capitals row
already holds the folded hash. The session's call: held for review, not
merged (ADR 0124). The review table's reader is `GET
/wines/library/refold-review` (platform admin only, branch
fix/wine-refold-review-reader); **no screen shows it yet** and nothing
resolves a pair. Still open, F2: a roster row kept on its old hash
joins no live library row once its library row has moved.

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

Vendor matching (fix/vendor-identity-folds-turkish-i, stacked): `normalizeIdentityText`
in `apps/api-gateway/src/vendor-intel/wine-identity.ts` now folds through the
same table. Keys stored under the old rule cannot be recomputed in SQL
(`vendor_price_observations` keeps no producer column; "kavakl dere" in
`beverage_identities` may be a real space), so readers also ask for the
pre-fold key, read-side only: `assertIdentity` (no second row for a bottle
asserted before the fold), the comparison ladder (`loadObservations`), and
both outlier-prior reads (`priorUnitPricesInClass`, the page extractor's
`loadPriorUnitPrices`, which counts a pre-fold sighting under the new hash).
NOT covered: `IdentityService.suggest` blocks on the folded
`producer_normalised` only, so an identity asserted before the fold is not
suggested for a subject with "ı" (its tokens "kavakl"/"dere" would not score
anyway); the stored observation hashes and identity keys stay on the old rule
until a person or a later backfill re-keys them. Two readers group stored rows
by `sig:<signature_hash>` with no bottle in hand, so they cannot ask for a
pre-fold hash (a hash cannot be re-folded, and the row keeps no producer):
the nightly outlier re-judge (`planRejudge` in
`apps/api-gateway/src/vendor-intel/outlier-rejudge.ts`) and the below-average
sweep (`VendorComparisonService.belowTrailingAverage` → `priceBelowAverage` in
`price-below-average.ts`, which `market-price.producer.ts` reads). For an
off-catalogue bottle seen as "Kavaklıdere", sightings stored before the fold
and sightings written after it sit in two groups. The fold itself causes this
split for a bottle that used to be one group. Each half can fall under
`MIN_OUTLIER_SAMPLE`, so the re-judge says nothing about it (silence, not a
false flag). The below-average box can list the bottle twice, or drop it when
a half falls under the minimum history. The market-price producer acts only on
`wine:` keys, so a `sig:` split reaches it only as extra `notOurs` items
competing for the read's ranking cap. The split heals by itself once the
pre-fold sightings leave the 30-day window (`REJUDGE_WINDOW_DAYS`, the sweep's
`windowDays ?? 30`); nothing re-keys them sooner.
`services/agent-orchestrator/services/beverage_ontology.py` `normalize_text`
(token matching only, not an identity key) and the other Python normalisers in
`services/agent-orchestrator` were not changed.

QA round 10c F1: re-asserting a pre-fold "ı" identity in ASCII or capitals
wrote a second row. `assertIdentity` now also takes the oldest row that
`storedRowIsBeforeFold` accepts (LIKE prefilter, 200 cap: past it is a missed
match, never a wrong one); the session's calls: oldest wins, the cap.
