-- A published catalogue says when it changed.
--
-- WHY
-- ---
-- mudavym.com's sitemap lists every published vendor catalogue with a
-- `<lastmod>` (apps/api-gateway/src/seo/seo.service.ts). Google uses lastmod
-- only while a site's values are "consistently and verifiably accurate", and
-- Bing treats it as a key signal; one site-wide pattern of dates that do not
-- move with the content and both stop trusting it.
--
-- `vendor_portal_pages.updated_at` and `vendor_portal_listings.updated_at`
-- were created with `DEFAULT now()` and nothing else
-- (20260805155901_vendor_portal.sql:59,105): no trigger has ever maintained
-- them, so a price edit left the page's date where the insert put it.
--
-- WHAT
-- ----
-- 1. Both tables get the house's standard BEFORE UPDATE trigger
--    (public.update_updated_at_column, baseline :1990, already on 31 tables).
-- 2. A listing that is inserted, changed or removed bumps its page, because
--    the catalogue a crawler reads is the page AND its listings. A listing
--    moved between pages bumps both.
--
-- Rows written before this migration keep the date they have. It is the last
-- date anyone set, which is the most this table can honestly say about them.
--
-- SAFETY
-- ------
-- Triggers only; no data is rewritten and no lock is held beyond the brief
-- ACCESS EXCLUSIVE of CREATE TRIGGER on two small tables. On a page delete the
-- cascade removes its listings, whose trigger then updates zero rows (the page
-- is already gone), which is not an error.

CREATE TRIGGER vendor_portal_pages_updated_at
    BEFORE UPDATE ON public.vendor_portal_pages
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER vendor_portal_listings_updated_at
    BEFORE UPDATE ON public.vendor_portal_listings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.vendor_portal_listing_touches_page()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.vendor_portal_pages SET updated_at = now() WHERE id = NEW.page_id;
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.page_id IS DISTINCT FROM NEW.page_id) THEN
    UPDATE public.vendor_portal_pages SET updated_at = now() WHERE id = OLD.page_id;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.vendor_portal_listing_touches_page() IS
    'Bumps vendor_portal_pages.updated_at when one of its listings changes, so the sitemap lastmod moves with the catalogue a crawler reads.';

CREATE TRIGGER vendor_portal_listings_touch_page
    AFTER INSERT OR UPDATE OR DELETE ON public.vendor_portal_listings
    FOR EACH ROW EXECUTE FUNCTION public.vendor_portal_listing_touches_page();
