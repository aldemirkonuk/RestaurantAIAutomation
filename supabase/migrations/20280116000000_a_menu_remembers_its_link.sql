-- DD-r108-66 (r110 menu-r110-2): a menu read from a web link remembers the
-- link it came from, after redirects. POST /menus/import-url writes it; every
-- other read leaves it null. The read itself is a scan read (source_method
-- stays 'scan'): the kept source is the fetched PDF, photo or page text.
ALTER TABLE public.restaurant_menus
  ADD COLUMN IF NOT EXISTS source_url text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_menus_source_url_check') THEN
    ALTER TABLE public.restaurant_menus
      ADD CONSTRAINT restaurant_menus_source_url_check
      CHECK (source_url IS NULL OR (length(source_url) <= 2048 AND source_url ~ '^https://'));
  END IF;
END $$;

COMMENT ON COLUMN public.restaurant_menus.source_url IS
  'The https link a menu was read from (POST /menus/import-url), after redirects; null for an upload, a sheet or typed lines.';
