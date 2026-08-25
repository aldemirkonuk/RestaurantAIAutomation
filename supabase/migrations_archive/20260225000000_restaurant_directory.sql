-- =============================================================================
-- Restaurant Directory + Crawl Log
-- =============================================================================
-- Consolidated restaurant metadata from multiple discovery sources
-- and per-URL crawl tracking for visited links.

-- =============================================================================
-- restaurant_directory
-- =============================================================================
CREATE TABLE IF NOT EXISTS restaurant_directory (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_name     text NOT NULL,
  city                text NOT NULL,
  state               text,
  neighborhood        text,
  cuisine_type        text,
  price_range         text,                -- $, $$, $$$, $$$$
  rating              numeric(3,1),
  website_url         text,
  opentable_url       text,
  yelp_url            text,
  google_place_id     text,
  discovery_sources   text[] DEFAULT '{}', -- e.g. {"google_maps", "opentable"}
  crawl_status        text NOT NULL DEFAULT 'pending'
                        CHECK (crawl_status IN ('pending','crawled','failed','no_menu','skipped')),
  last_crawled_at     timestamptz,
  content_hash        text,
  menu_type           text,                -- html_menu, pdf_link, image_only, no_menu
  wine_count_estimate integer,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),

  CONSTRAINT uq_restaurant_city UNIQUE (restaurant_name, city)
);

CREATE INDEX IF NOT EXISTS idx_rd_city_status   ON restaurant_directory (city, crawl_status);
CREATE INDEX IF NOT EXISTS idx_rd_crawl_status  ON restaurant_directory (crawl_status);
CREATE INDEX IF NOT EXISTS idx_rd_sources       ON restaurant_directory USING GIN (discovery_sources);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_rd_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rd_updated_at ON restaurant_directory;
CREATE TRIGGER trg_rd_updated_at
  BEFORE UPDATE ON restaurant_directory
  FOR EACH ROW EXECUTE FUNCTION update_rd_updated_at();

-- =============================================================================
-- crawl_log  (one row per visited URL — link tracking)
-- =============================================================================
CREATE TABLE IF NOT EXISTS crawl_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id         uuid REFERENCES restaurant_directory(id) ON DELETE CASCADE,
  url                   text NOT NULL,
  visited_at            timestamptz DEFAULT now(),
  result_type           text CHECK (result_type IN (
                          'html_menu','pdf_link','screenshot','image_only',
                          'no_menu','invalid','error'
                        )),
  content_hash          text,
  extracted_text_length integer,
  pdf_downloaded        boolean DEFAULT false,
  error_message         text
);

CREATE INDEX IF NOT EXISTS idx_cl_restaurant ON crawl_log (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_cl_visited_at ON crawl_log (visited_at);

-- Enable RLS (permissive for service role)
ALTER TABLE restaurant_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'restaurant_directory' AND policyname = 'service_role_full_access_rd') THEN
    CREATE POLICY "service_role_full_access_rd" ON restaurant_directory FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crawl_log' AND policyname = 'service_role_full_access_cl') THEN
    CREATE POLICY "service_role_full_access_cl" ON crawl_log FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
