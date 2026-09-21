-- An auction lot keeps its own details — auction house, lot number, sale
-- date, and its hammer price and premium WITH a currency.
--
-- THE FOUNDER, 2026-09-21, answer (2), "Build all now":
--   an auction lot records its hammer price and premium WITH a currency,
--   plus auction house, lot number and sale date.
--
-- ---------------------------------------------------------------------------
-- THE GAP THIS CLOSES
-- ---------------------------------------------------------------------------
-- `AuctionLotStart.tsx` (built 2026-09-06) already says exactly what was
-- missing, in its own header and in `inventory.md` §9 ("An auction lot's own
-- details have nowhere to live"): `inventory_lots` carries `unit_cost` and
-- `cost_provenance` and nothing else about where a bottle came from, so the
-- sheet takes the auction house, the lot number and the sale date, uses them
-- only to compute `(hammer + premium) / bottles`, prints them back "to be
-- copied somewhere that keeps them", and says in words that the book does
-- not. That control cites ADR 0083 ("a control may not claim a write it
-- never makes") for why it does not pretend otherwise.
--
-- This migration is that "somewhere". The gateway and web fixes that write
-- and read it — replacing the printed-and-discarded working with a saved
-- record — are in the same commit.
--
-- ---------------------------------------------------------------------------
-- WHY A NEW TABLE, NOT COLUMNS ON `inventory_lots`
-- ---------------------------------------------------------------------------
-- `inventory_lots.unit_cost` carries NO currency anywhere in this schema —
-- every lot's cost is implicitly the house's own currency, for every
-- acquisition method, not only auctions. Giving currency to auction lots
-- alone on that table would say one lot's cost is stated in a currency and
-- every other lot's is not, which is not the fact of this schema today and
-- is a far larger, un-additive change (the WAC rollup, every unit_cost
-- reader) that nobody asked for here. The auction's OWN facts — what was bid,
-- what premium was added, in what currency, at which house, lot and date —
-- are a different, smaller record: a receipt about the acquisition, kept
-- beside the stock it produced rather than folded into the stock row itself.
-- Same shape as `calendar_day_notes` this same batch and
-- `distributor_price_code_mappings` before it: a typed fact gets its own row
-- with its own author, not a column bolted onto a table that was never about
-- it.
--
-- `inventory_id` links to `restaurant_inventory`, not to a specific
-- `inventory_lots` row: `InventoryService.createInventoryItem` books the
-- stock through `apply_stock_movement`, a Postgres function that creates the
-- `inventory_lots` row internally and does not hand its id back to the
-- caller. `restaurant_inventory.id` is what the web client actually holds
-- after the carry (`POST /inventory/:restaurantId/items` returns it), and it
-- is a real, stable join target — reassigning `apply_stock_movement` to
-- surface a lot id is a change to a function every acquisition path calls,
-- which this migration does not touch.
--
-- ---------------------------------------------------------------------------
-- WHY CURRENCY HAS NO DEFAULT
-- ---------------------------------------------------------------------------
-- Same rule as `usual_currency` (20260906170000) and every other typed
-- currency in this schema: the founder's own words are "currency is an
-- ISO-4217 code, never inferred". NOT NULL here (unlike usual_currency,
-- which is optional because a vendor may never have been asked) — a hammer
-- price and premium with no stated currency is not a complete auction
-- record, so the sheet refuses to carry the lot until one is chosen. The
-- CHECK enforces SHAPE only (`^[A-Z]{3}$`); real ISO-4217 MEMBERSHIP is
-- enforced in the gateway by `isIso4217()` (`common/iso-4217.ts`), same split
-- as every other currency column in this schema.
--
-- ADDITIVE. One table, RLS, one index, comments. No existing table altered.

SET local statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.auction_lot_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The inventory item this lot carried stock into. See header for why this
  -- is `restaurant_inventory`, never a specific `inventory_lots` row.
  inventory_id UUID NOT NULL
    REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE,

  auction_house TEXT NOT NULL CHECK (btrim(auction_house) <> ''),
  lot_number TEXT NOT NULL CHECK (btrim(lot_number) <> ''),
  sale_date DATE NOT NULL,

  hammer_price NUMERIC(10,2) NOT NULL CHECK (hammer_price >= 0),
  -- Never NULL and never a silent 0: `AuctionLotStart.tsx`'s own `lotCost`
  -- already refuses to compute a cost when the premium was not typed ("an
  -- auction with no premium and an auction whose premium nobody typed are
  -- different facts") — a lot only reaches this INSERT once that refusal has
  -- passed, so a real 0 typed by a person and an unstated premium are never
  -- confused here either.
  buyers_premium NUMERIC(10,2) NOT NULL CHECK (buyers_premium >= 0),
  -- ISO-4217, shape-checked here, membership-checked in the gateway. NEVER
  -- inferred (founder, 2026-09-21) — there is no DEFAULT and the gateway
  -- passes through exactly what the sheet's currency picker held.
  currency CHARACTER VARYING(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  bottles INTEGER NOT NULL CHECK (bottles >= 1),

  -- WHO recorded it and WHEN. `public.users`, never `auth.users` — disjoint
  -- on this deployment (see `20260905240000` for the same note).
  recorded_by UUID NOT NULL
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  recorded_by_name VARCHAR(200) NOT NULL CHECK (btrim(recorded_by_name) <> ''),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The inventory page's own read: every auction record for this wine's entry,
-- newest first.
CREATE INDEX IF NOT EXISTS idx_auction_lot_records_inventory
  ON public.auction_lot_records (inventory_id, created_at DESC);

ALTER TABLE public.auction_lot_records ENABLE ROW LEVEL SECURITY;

-- Same shape as every other gateway-owned table in this schema (see
-- calendar_day_notes, this same batch, for the fuller note): the gateway
-- holds the service_role key and scopes every query by the restaurant_id in
-- the caller's JWT at the application layer.
DROP POLICY IF EXISTS auction_lot_records_service_role
  ON public.auction_lot_records;
CREATE POLICY auction_lot_records_service_role
  ON public.auction_lot_records
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.auction_lot_records FROM anon, authenticated;

COMMENT ON TABLE public.auction_lot_records IS
  'An auction lot''s own details, kept — auction house, lot number, sale date, hammer price and buyer''s premium WITH an ISO-4217 currency (founder, 2026-09-21). Closes the "nowhere to live" gap AuctionLotStart.tsx and inventory.md §9 named 2026-09-06 (ADR 0083). Linked to restaurant_inventory, never to a specific inventory_lots row — see the migration header for why. The stock itself is unchanged: inventory_lots.unit_cost still carries no currency of its own; this is the auction''s own receipt, kept beside the stock it produced.';
COMMENT ON COLUMN public.auction_lot_records.currency IS
  'ISO-4217, shape-checked here (^[A-Z]{3}$), membership-checked by isIso4217() in the gateway. Never inferred, never defaulted — the founder''s own words, 2026-09-21.';
