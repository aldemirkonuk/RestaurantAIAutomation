-- ADR 0044 p4 wave — the eighth page flag, for a route that did not exist before.
--
-- Same shape as 20260831090000_mudavym_design_flags.sql and
-- 20260902230000_mudavym_design_flags_p4.sql: one boolean on the reserved
-- 'restaurant_settings' row, NOT NULL DEFAULT false. Those files are separate
-- rather than widened in place because a migration that has been applied must
-- not be edited (a version mismatch makes an applied file look ownerless).
--
-- `/connections` differs from the other seventeen flags in one way worth
-- stating: it does not gate a REDESIGN of a shipping page, it gates a NEW route
-- (ADR 0114). With the flag off the route renders a redirect to `/profile`, the
-- sidebar entry is absent, and nothing else in the product changes — so OFF is
-- not "the old design", it is "this surface does not exist here yet".
--
-- settings.service.ts joins every ACTIVE registry key into its .select(), so a
-- key promoted to ACTIVE without a column 42703s the whole Settings read. The
-- registry entry and this file land together for that reason.

ALTER TABLE public.restaurant_feature_flags
  ADD COLUMN IF NOT EXISTS mudavym_design_connections boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurant_feature_flags.mudavym_design_connections IS
  'On the ''restaurant_settings'' row only. TRUE routes `/connections` — the house-scoped list of everything that can act in this restaurant''s name (ADR 0114; the till, the payment provider, the sender identity, the calendar feed, the public page, model-context servers and the personal grants that act here). FALSE (default) makes the route redirect to `/profile` and hides the nav entry.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_feature_flags'
      AND column_name = 'mudavym_design_connections'
  ) THEN
    RAISE EXCEPTION 'mudavym_design_connections was not added — the Settings read would 42703 on the registry key';
  END IF;
  RAISE NOTICE 'mudavym_design_connections present on restaurant_feature_flags.';
END
$$;
