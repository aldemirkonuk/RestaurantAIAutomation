-- A DRINK CAN BE 86'D, AND THE STOCK-OUT IS KEPT. F-145 (sim ledger).
--
-- WHAT BROKE. The owner-quarter sim had three stock-outs (W09-E01 a
-- Moscofilero by the glass at ~17:30, W10-E02 a Xinomavro by the glass,
-- W10-E05 Tito's after a breakage) with nowhere to go: no page could mark a
-- drink sold out, and nothing recorded a stock-out (when, what, why), so "par
-- too thin for the week" could never be learned. No 86, sold-out or
-- availability column exists on restaurant_inventory or menu_items
-- (baseline_from_production.sql; 20260922230100_a_menu_line_can_be_discarded
-- only adds 'discarded').
--
-- THE SHAPE (coordinator decision D1, sim-run/bulletproof/reconcile/
-- schema-decisions-decisions.md). One row per stock-out of one house item
-- (restaurant_inventory.id, the ledger's key per ADR 0115). The item is 86'd
-- exactly while it has an open row (ended_at IS NULL); the flag and the record
-- are the same row, so they cannot disagree. One open row per item (partial
-- unique). A stock-out is availability, not a count: nothing here moves
-- stock. Covers lost is not recorded: nobody in service knows it, and a typed
-- guess would read later as evidence.
--
-- TENANCY. restaurant_id is the item's house; the gateway checks the item
-- belongs to the path's house before it writes
-- (assertInventoryBelongsToRestaurant). Clients get no grant and RLS is on
-- with no policy: only the gateway's service role reads or writes, and it
-- holds no DELETE or TRUNCATE (check_new_tables_are_locked_down.py).
--
-- NEW TABLE, so no lock on a live table beyond the FK checks' brief SHARE ROW
-- EXCLUSIVE on restaurant_inventory, restaurants and users. Re-runnable: IF NOT
-- EXISTS throughout.

CREATE TABLE IF NOT EXISTS public.stock_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_id uuid NOT NULL
    REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  cause text NOT NULL
    CONSTRAINT stock_outs_cause_known
    CHECK (cause IN ('ran_out', 'broken', 'pulled', 'other')),
  note text
    CONSTRAINT stock_outs_note_short CHECK (note IS NULL OR char_length(note) <= 500),
  started_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  ended_at timestamptz,
  ended_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_outs_ends_after_it_starts
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

COMMENT ON TABLE public.stock_outs IS
  'F-145: a house item sold out (86''d). Open while ended_at IS NULL, one open row per item. Records when, why (ran_out, broken, pulled, other), who marked it and who brought it back. Moves no stock.';

CREATE UNIQUE INDEX IF NOT EXISTS stock_outs_one_open_per_item
  ON public.stock_outs (inventory_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS stock_outs_item_started
  ON public.stock_outs (inventory_id, started_at DESC);

CREATE INDEX IF NOT EXISTS stock_outs_house_started
  ON public.stock_outs (restaurant_id, started_at DESC);

ALTER TABLE public.stock_outs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_outs FROM PUBLIC, anon, authenticated;
-- The gateway reads, opens and ends stock-outs; it never deletes one. The
-- explicit REVOKE matters: Supabase's default privileges grant service_role
-- ALL on a new public table (the house_price_locks precedent,
-- 20260922230800_a_house_can_hold_a_price.sql).
GRANT SELECT, INSERT, UPDATE ON public.stock_outs TO service_role;
REVOKE DELETE, TRUNCATE ON public.stock_outs FROM service_role;
