-- Make the signature_hash upsert target actually usable.
--
-- THE BUG
--
-- resolveOrCreateLibraryWine creates a provisional wine with:
--
--     .upsert(payload, { onConflict: "signature_hash" })
--
-- which PostgREST turns into `INSERT ... ON CONFLICT (signature_hash) ...`.
-- The only unique index on that column was PARTIAL:
--
--     CREATE UNIQUE INDEX idx_master_wine_library_signature_hash
--       ON master_wine_library (signature_hash)
--       WHERE (signature_hash IS NOT NULL);
--
-- Postgres will not infer a partial index as an ON CONFLICT target unless the
-- statement repeats the index predicate, and PostgREST cannot emit one. So
-- every such insert failed with:
--
--     42P10: there is no unique or exclusion constraint matching the
--            ON CONFLICT specification
--
-- Verified by POSTing that exact payload shape to PostgREST: HTTP 400, 42P10.
--
-- WHY IT WAS INVISIBLE
--
-- menus.service.ts catches resolution failures as non-fatal and falls back to
-- `masterWineId: null`, so the import "succeeded" while every wine landed with
-- no library link — and therefore no inventory row and no analytics. The
-- library confirms it: across 293 rows there is not one with
-- source = 'menu_import'. This path has never once worked in production.
--
-- THE FIX
--
-- A plain unique index. It is not weaker: Postgres treats NULLs as distinct in
-- a unique index by default, so any number of rows may still carry a NULL
-- signature_hash — exactly what the partial predicate was protecting — while
-- the index becomes inferrable as an ON CONFLICT target.
--
-- The 11 rows the backfill left NULL (genuine duplicates awaiting a merge
-- decision) are unaffected and remain insertable.

DROP INDEX IF EXISTS public.idx_master_wine_library_signature_hash;

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_wine_library_signature_hash
  ON public.master_wine_library (signature_hash);

COMMENT ON INDEX public.idx_master_wine_library_signature_hash IS
  'Deliberately NOT partial. A partial unique index cannot be inferred as an '
  'ON CONFLICT target by PostgREST, which broke every menu-import wine '
  'creation with 42P10. NULLs are distinct in a unique index, so rows without '
  'a signature are still permitted.';
