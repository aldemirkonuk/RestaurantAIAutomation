-- A delivery that booked nothing asks an owner or a manager to name its item —
-- the founder's answer of 2026-09-22 (round 6u) on ADR 0192, verbatim pick:
--   (2) "Deliver, flag to name it (Recommended)"
--
-- WHAT HE DECIDED
-- ---------------
-- An order whose delivery names no house item, or resolves to zero bottles,
-- stays delivered with nothing booked (markDelivered already says so in words:
-- "No stock was booked: ...") AND raises a flag asking an owner or a manager
-- to name the item. Naming it books the stock then — once — and the naming is
-- on the record.
--
-- ONE ROW PER ORDER
-- -----------------
--   why               no_item | zero_bottles — what the delivery could not book
--   bottles_resolved  what the order resolved to at delivery (0 for zero_bottles)
--   status            open | named
--   raised_by/at      who marked it delivered, when
--   named_by/at       the owner or manager who named it, when
--   named_inventory_id  the house item named, by id (never a name)
--   bottles_booked    what the naming booked
-- The "once" has three holders: the unique order_id (one flag per order), the
-- open -> named write conditional on `open` (a second naming matches nothing),
-- and the ledger key the booking uses (`order-delivered-live:<order>`, the same
-- key markDelivered books under), which apply_stock_movement applies once.
--
-- Locked down in the same file (RLS on, one service_role policy, anon and
-- authenticated revoked); actor columns on public.users(user_id); a trigger
-- refuses an order or an item of another house. Additive, idempotent,
-- assertions at the bottom.

CREATE TABLE IF NOT EXISTS public.delivery_item_to_name (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.procurement_orders(id) ON DELETE CASCADE,
  why TEXT NOT NULL,
  bottles_resolved INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  raised_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  raised_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  named_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  named_at TIMESTAMPTZ,
  named_inventory_id UUID REFERENCES public.restaurant_inventory(id) ON DELETE SET NULL,
  bottles_booked INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT delivery_item_to_name_why_known CHECK (why IN ('no_item', 'zero_bottles')),
  CONSTRAINT delivery_item_to_name_status_known CHECK (status IN ('open', 'named')),
  CONSTRAINT delivery_item_to_name_bottles_counted CHECK (bottles_resolved >= 0),
  CONSTRAINT delivery_item_to_name_zero_means_zero CHECK (why <> 'zero_bottles' OR bottles_resolved = 0),
  CONSTRAINT delivery_item_to_name_booked_is_positive CHECK (bottles_booked IS NULL OR bottles_booked > 0),
  -- A named row says who, when, which item and how many; an open row says none of it.
  CONSTRAINT delivery_item_to_name_named_on_the_record CHECK (
    (status = 'named') = (named_at IS NOT NULL AND named_inventory_id IS NOT NULL AND bottles_booked IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_delivery_item_to_name_order
  ON public.delivery_item_to_name (order_id);

CREATE INDEX IF NOT EXISTS idx_delivery_item_to_name_open
  ON public.delivery_item_to_name (restaurant_id, raised_at)
  WHERE status = 'open';

-- The order and the named item must be the row's house (ADR 0141's rule):
-- both ids arrive on a request path, and neither column carries a tenant.
CREATE OR REPLACE FUNCTION public.delivery_item_to_name_names_its_house()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.procurement_orders
     WHERE id = NEW.order_id AND restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION
      'delivery_item_to_name: order % is not an order of restaurant %, so nothing was recorded.',
      NEW.order_id, NEW.restaurant_id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.named_inventory_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_inventory
     WHERE id = NEW.named_inventory_id AND restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION
      'delivery_item_to_name: item % is not an item of restaurant %, so it was not named.',
      NEW.named_inventory_id, NEW.restaurant_id
      USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS delivery_item_to_name_names_its_house ON public.delivery_item_to_name;
CREATE TRIGGER delivery_item_to_name_names_its_house
  BEFORE INSERT OR UPDATE ON public.delivery_item_to_name
  FOR EACH ROW EXECUTE FUNCTION public.delivery_item_to_name_names_its_house();

ALTER TABLE public.delivery_item_to_name ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_item_to_name_service_role ON public.delivery_item_to_name;
CREATE POLICY delivery_item_to_name_service_role
  ON public.delivery_item_to_name
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.delivery_item_to_name FROM anon, authenticated;

COMMENT ON TABLE public.delivery_item_to_name IS
  'A delivered order that booked nothing (no house item, or zero bottles) asks an owner or a manager to name its item; naming it books the stock once (founder, 2026-09-22: "Deliver, flag to name it", ADR 0192). One row per order. RLS on, service_role only.';

DO $$
DECLARE
  c TEXT;
  fk_target TEXT;
BEGIN
  IF to_regclass('public.delivery_item_to_name') IS NULL THEN
    RAISE EXCEPTION 'delivery_item_to_name was not created';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.delivery_item_to_name')) THEN
    RAISE EXCEPTION 'delivery_item_to_name has RLS off';
  END IF;
  IF has_table_privilege('anon', 'public.delivery_item_to_name', 'SELECT')
     OR has_table_privilege('authenticated', 'public.delivery_item_to_name', 'SELECT')
     OR has_table_privilege('anon', 'public.delivery_item_to_name', 'INSERT')
     OR has_table_privilege('authenticated', 'public.delivery_item_to_name', 'INSERT')
     OR has_table_privilege('authenticated', 'public.delivery_item_to_name', 'UPDATE')
  THEN
    RAISE EXCEPTION 'delivery_item_to_name is still reachable by anon/authenticated';
  END IF;
  FOREACH c IN ARRAY ARRAY['raised_by', 'named_by'] LOOP
    SELECT ccu.table_schema || '.' || ccu.table_name || '.' || ccu.column_name
      INTO fk_target
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = kcu.constraint_name
       AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = rc.unique_constraint_name
       AND ccu.constraint_schema = rc.unique_constraint_schema
     WHERE kcu.table_schema = 'public'
       AND kcu.table_name = 'delivery_item_to_name'
       AND kcu.column_name = c
     LIMIT 1;
    IF fk_target IS DISTINCT FROM 'public.users.user_id' THEN
      RAISE EXCEPTION 'delivery_item_to_name.% must reference public.users(user_id), found %', c, coalesce(fk_target, 'no foreign key');
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = to_regclass('public.delivery_item_to_name')
       AND tgname = 'delivery_item_to_name_names_its_house'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'delivery_item_to_name has no tenancy trigger';
  END IF;
  RAISE NOTICE 'delivery_item_to_name: created, locked down, one row per order.';
END
$$;
