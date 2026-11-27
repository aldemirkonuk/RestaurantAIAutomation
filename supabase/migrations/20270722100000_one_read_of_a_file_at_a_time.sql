-- One read of one file at a time (batch review of PR #1062, 2026-11-11).
--
-- POST /menus/import reopens the read the same bytes already made instead of
-- paying for a second one (MenusService.sameFileRead). That look-up is a
-- check before an insert: two requests with the same file, sent together (a
-- retrying client, or two phones in one house), both found nothing, both
-- kept a version and both were read and billed.
--
-- This index makes the second insert fail while the first read is still
-- `reading`; the gateway then answers with the read already under way. The
-- key is the house, the file and the labels the version carries, so the same
-- file read for another day or another cadence is its own version, as before.
-- A version whose source could not be kept has no sha and is not covered.
-- COALESCE keeps two absent labels equal (NULLs are distinct in a unique
-- index); a date is coalesced to a date, never cast to text, so the
-- expression stays immutable.

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_menus_one_read_of_a_file_at_a_time
  ON public.restaurant_menus (
    restaurant_id,
    source_sha256,
    COALESCE(cadence, ''),
    COALESCE(menu_date, DATE '0001-01-01'),
    COALESCE(menu_date_precision, '')
  )
  WHERE read_state = 'reading' AND source_sha256 IS NOT NULL;

COMMENT ON INDEX public.uq_restaurant_menus_one_read_of_a_file_at_a_time IS
  'At most one read under way per house, file and labels: a second import of the same bytes joins the first (MenusService.beginScan).';
