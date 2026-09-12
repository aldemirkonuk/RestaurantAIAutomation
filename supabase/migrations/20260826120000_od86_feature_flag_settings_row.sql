-- OD-86 — make the per-restaurant feature switches storable.
--
-- Settings has rendered 22 switches that wrote to `restaurant_feature_flags`.
-- None of the 22 columns they wrote has ever existed. The wide table defining
-- them (services/database/migrations_archive/011_add_restaurant_feature_flags.sql,
-- with its get_restaurant_feature_flag() RPC) sits in an archived directory
-- outside supabase/migrations/ and was never applied. What production actually
-- has is the EAV table from the 2026-08-05 baseline dump —
--   (id, restaurant_id, flag_name, enabled, metadata, created_at)
-- plus one later-added `enable_ai_autonomous_send boolean NOT NULL DEFAULT false`.
--
-- So the SELECTs returned nothing usable and the UPDATE/INSERTs failed. This
-- migration does the minimum that makes the two flags anything reads honest
-- and storable. It does NOT recreate the other 20 columns: a column with no
-- gate behind it is the defect, not the fix (see feature-flag-registry.ts).

-- ---------------------------------------------------------------------------
-- 1. The gate at inbound-responder.service.ts:175 selects this column. It does
--    not exist, so the query errors and the helper falls back to "enabled" —
--    meaning AI negotiation could never actually be turned off. Default true
--    preserves that existing behaviour for every restaurant; the difference is
--    that OFF now becomes reachable.
-- ---------------------------------------------------------------------------
ALTER TABLE public.restaurant_feature_flags
  ADD COLUMN IF NOT EXISTS enable_ai_negotiation boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. `flag_name` is NOT NULL and UNIQUE per restaurant because the table's
--    original job was one row per named flag (self-evolution still writes rows
--    that way). Per-restaurant settings therefore need one reserved row. The
--    default lets the settings upsert be a plain partial write, and the
--    existing UNIQUE(restaurant_id, flag_name) already guarantees exactly one
--    such row per restaurant — no extra index needed.
-- ---------------------------------------------------------------------------
ALTER TABLE public.restaurant_feature_flags
  ALTER COLUMN flag_name SET DEFAULT 'restaurant_settings';

COMMENT ON COLUMN public.restaurant_feature_flags.flag_name IS
  'One row per named flag (EAV). The reserved value ''restaurant_settings'' marks the single per-restaurant settings row that the boolean columns below belong to; every reader must filter on it.';

COMMENT ON COLUMN public.restaurant_feature_flags.enable_ai_autonomous_send IS
  'On the ''restaurant_settings'' row only. TRUE lets an AI-drafted vendor reply send with no human approval after a 2-minute cancel window. Defaults FALSE and must stay FALSE unless a restaurant deliberately opts in.';

COMMENT ON COLUMN public.restaurant_feature_flags.enable_ai_negotiation IS
  'On the ''restaurant_settings'' row only. FALSE stops the inbound responder analysing or replying to vendor email at all.';
