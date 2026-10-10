-- F-535 (sim wave 15, 2026-10-09): EmailIntelAgent dedupes inbound vendor deals
-- on a hash of (sender, product, day), and vendor_promotions held that hash
-- UNIQUE across every house. One distributor blast that reached two houses on
-- the same day was kept only for whichever house's mail was read first; the
-- second insert hit vendor_promotions_dedup_hash_key and was lost.
--
-- The agent now puts the house in the hash and checks it within the house.
-- The table's unique key follows: a deal is unique per house, not globally.
-- Every existing row already has a distinct dedup_hash (the old constraint),
-- so the new key cannot be violated by data already in the table.

ALTER TABLE public.vendor_promotions
  DROP CONSTRAINT IF EXISTS vendor_promotions_dedup_hash_key;

ALTER TABLE public.vendor_promotions
  ADD CONSTRAINT vendor_promotions_restaurant_dedup_hash_key
  UNIQUE (restaurant_id, dedup_hash);
