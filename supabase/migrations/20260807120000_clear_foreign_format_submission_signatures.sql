-- Clear submission signature hashes that no current code can reproduce.
--
-- What was wrong
-- --------------
-- master_wine_library_submissions.signature_hash was written by four different
-- implementations that never agreed on a key. The 190 rows currently in the
-- table were all written on 2026-04-07 by the Python menu-scan pipeline
-- (services/agent-orchestrator/api/onboarding_routes.py), whose key is
--
--     sha256( f"{wine_name}-{producer}-{vintage}".lower().strip() )
--
-- while the TypeScript library dedup key is a pipe-joined, normalised,
-- eight-field signature. The two never collide, so the exact-match lookup in
-- WineSubmissionsService.processPendingSubmissions could not hit — and on a
-- miss it wrote that Python-format hash straight into
-- master_wine_library.signature_hash, which is UNIQUE and canonical. One run
-- over these rows would have left the master library holding keys in two
-- mutually unrecognisable formats.
--
-- Why these values cannot simply be recomputed in SQL
-- ---------------------------------------------------
-- They are not reproducible at all, from anything. The Python hash was taken
-- from the raw extractor dict, but the row persists `accepted_fields` — the
-- confidence-routed copy — so the strings that were hashed were never stored.
-- Proof in the data: 9 distinct (wine_name, producer, vintage) triples map to
-- two different stored hashes each, and `producer` varies inside groups that
-- share one hash. No function of the persisted payload can produce both.
--
-- Why NULL rather than a backfilled value
-- ---------------------------------------
-- NULL is the honest answer for "we do not know this row's key", and it is
-- already the column's normal state — idx_mwls_signature_hash is partial on
-- NOT NULL, so nothing here depends on the column being populated. The
-- application recomputes the canonical hash from the payload on the next
-- processPendingSubmissions pass (see apps/api-gateway/src/wines/
-- wine-signature.ts), which is the only place the algorithm now lives.
--
-- Nothing is lost. These hashes never matched anything: master_wine_library
-- currently has zero non-NULL signature_hash values, so no lookup keyed on
-- them has ever succeeded.
--
-- Scope note: this does NOT touch restaurant_wine_roster.signature_hash or
-- menu_changes.wine_signature_hash. Those are written by web_crawler.py using
-- md5 over a different key — a separate namespace with its own mismatch (see
-- the roster→submissions join in analytics_routes.py), deliberately left alone
-- here rather than half-fixed.

UPDATE public.master_wine_library_submissions
SET signature_hash = NULL
WHERE signature_hash IS NOT NULL
  AND matched_master_id IS NULL;

COMMENT ON COLUMN public.master_wine_library_submissions.signature_hash IS
  'Canonical master-library dedup key. Written ONLY by hashWineSignature() in '
  'apps/api-gateway/src/wines/wine-signature.ts — sha256 over eight '
  'pipe-joined normalised fields (producer|name|vintage|primary_type|'
  'grape_variety|country|region|appellation), NULL when the payload has no '
  'usable name. Do not populate from any other implementation; a value in a '
  'foreign format cannot be distinguished from a genuine miss.';
