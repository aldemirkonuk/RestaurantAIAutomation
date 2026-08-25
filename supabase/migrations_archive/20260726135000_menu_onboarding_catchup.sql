-- Get Started Overhaul: catch-up migration documenting the live schema for
-- restaurant_menus / menu_items / user_onboarding_progress. These three
-- tables were applied to the Restaurant_Wine_Ops project out of band (no
-- migration file tracked them), which is how the broken column names in
-- menus.service.ts (is_active/type instead of status/menu_type) went
-- unnoticed. Written from a live schema introspection so local dev and prod
-- agree going forward. All statements are idempotent — running this against
-- a database that already has these tables (e.g. prod) is a no-op.
--
-- Ordered before 20260726140000_user_oauth_accounts.sql so the additive
-- ALTER TABLE migrations that follow (20260726150000 adds
-- menu_items.submission_id, 20260726151000 adds
-- restaurants.threshold_configured) layer on top of this base shape exactly
-- as they did on the live database.

CREATE TABLE IF NOT EXISTS restaurant_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL DEFAULT 'Wine List',
  season TEXT NOT NULL DEFAULT 'year_round'
    CHECK (season = ANY (ARRAY['spring', 'summer', 'fall', 'winter', 'year_round', 'event'])),
  year INTEGER,
  menu_type TEXT NOT NULL DEFAULT 'beverage'
    CHECK (menu_type = ANY (ARRAY['beverage', 'food', 'full', 'bar', 'events'])),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status = ANY (ARRAY['active', 'draft', 'archived'])),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE restaurant_menus IS
  'One row per active/draft/archived wine list per restaurant. menus.service.ts upsertMenu() keeps a single status=active row per restaurant.';

-- menu_items intentionally omits submission_id here — it's added by
-- 20260726150000_menu_items_submission_link.sql, matching the order those
-- two changes actually landed on the live database.
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID NOT NULL REFERENCES restaurant_menus(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  producer TEXT,
  category TEXT,
  by_glass_price NUMERIC,
  bottle_price NUMERIC,
  vintage TEXT,
  region TEXT,
  country TEXT,
  grape_variety TEXT,
  wine_library_id UUID REFERENCES master_wine_library(id),
  -- No FK live — inventory_item_id points at restaurant_inventory, which is
  -- keyed by (restaurant_id, master_wine_id) rather than a single id today.
  inventory_item_id UUID,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source = ANY (ARRAY['scan', 'csv', 'manual'])),
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status = ANY (ARRAY['approved', 'flagged', 'in_review'])),
  raw_extracted_text TEXT,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE menu_items IS
  'Extracted/entered wine rows for a restaurant_menus row. wine_library_id links to the matched or provisional master_wine_library row; status=flagged marks manager edits pending /studio review.';

CREATE TABLE IF NOT EXISTS user_onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(user_id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  menu_uploaded BOOLEAN NOT NULL DEFAULT false,
  vendor_added BOOLEAN NOT NULL DEFAULT false,
  team_member_invited BOOLEAN NOT NULL DEFAULT false,
  checklist_dismissed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_onboarding_progress IS
  'Per-user get-started checklist state. menu_uploaded/vendor_added are restaurant-scoped in practice — getOnboardingProgress() self-heals them from restaurant_menus / providers so invitees on an already-set-up restaurant do not see stale pending tasks.';

-- ── Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_restaurant_menus_restaurant ON restaurant_menus(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_menus_status ON restaurant_menus(restaurant_id, status);

CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON menu_items(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_status ON menu_items(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_menu_items_wine_library ON menu_items(wine_library_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_user ON user_onboarding_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_restaurant ON user_onboarding_progress(restaurant_id);

-- ── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE restaurant_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_onboarding_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menus' AND policyname = 'menus_restaurant_isolation'
  ) THEN
    CREATE POLICY "menus_restaurant_isolation" ON restaurant_menus
      FOR ALL USING (
        restaurant_id IN (SELECT users.restaurant_id FROM users WHERE users.user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'menu_items' AND policyname = 'menu_items_restaurant_isolation'
  ) THEN
    CREATE POLICY "menu_items_restaurant_isolation" ON menu_items
      FOR ALL USING (
        restaurant_id IN (SELECT users.restaurant_id FROM users WHERE users.user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_onboarding_progress' AND policyname = 'onboarding_progress_self'
  ) THEN
    CREATE POLICY "onboarding_progress_self" ON user_onboarding_progress
      FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

-- ── updated_at triggers ──────────────────────────────────────────────────
-- update_updated_at_column() is defined by an earlier migration
-- (20260208024921_new-migration.sql); menu_items has no updated_at column
-- live, so it gets no trigger here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'restaurant_menus_updated_at') THEN
    CREATE TRIGGER restaurant_menus_updated_at
      BEFORE UPDATE ON restaurant_menus
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'onboarding_progress_updated_at') THEN
    CREATE TRIGGER onboarding_progress_updated_at
      BEFORE UPDATE ON user_onboarding_progress
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
