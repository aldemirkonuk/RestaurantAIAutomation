-- A house item that is not in the wine library waits for research, by its id —
-- the founder's answer of 2026-09-21 on ADR 0192 (9)'s residual.
--
-- WHAT HE DECIDED (verbatim, in ADR 0192's amendment)
-- ---------------------------------------------------
-- *"book the stock anyway, and if it's not on the maser wine that means that
-- wine needs research treatment with fully in depth analysis to add to the
-- master wine. If its found that it s nowhere to be found, like wine 1 and wine
-- 2 and such, then we skip it and flag it."* And: *"When making a search in the
-- db tho, while not the name but the UUID or the deeper id is being searched"*.
--
-- WHY A TABLE OF ITS OWN
-- ----------------------
-- The two research queues that exist cannot hold such an item:
--   * `master_wine_library_submissions` is consumed by the research agent
--     (`services/agent-orchestrator/jobs/research_tasks.py`,
--     `research.dispatch_batch`) only through
--     `research_eligible_submissions()`, which JOINs a LIBRARY row on
--     `matched_master_id` (20260813170000). An item with no library row has
--     nothing to join.
--   * `enrichment_queue.wine_id` is NOT NULL and names a library wine (baseline).
--   * The submission chain (`haiku_enrich_task` -> `web_verify_task`, by
--     submission id) is dispatched only from onboarding imports
--     (`api/onboarding_routes.py`); a submission is keyed by its payload, a
--     NAME, and nothing sweeps pending submissions on a schedule.
-- So an unmatched house item is queued here, keyed by the HOUSE ITEM'S ID
-- (`restaurant_inventory.id`), never by its name. The name is read from the
-- item, by that id, whenever it is needed.
--
-- WHAT A ROW SAYS
-- ---------------
--   status  queued        waiting for research to find the wine
--           matched       research found it; matched_master_wine_id names it
--           not_findable  the name cannot identify a wine (a placeholder like
--                         "wine 1", a blank, "house red"), or research found
--                         nothing: skipped, and the house is shown a flag
--   reason  why, in words
--   queued_from   delivery | rename — what put it here
--
-- WHAT CONSUMES IT: nothing yet, stated. The gateway writes it (markDelivered
-- after a booking, the item rename) and reads it (the /inventory flag). Wiring
-- the research agent to it is an open founder question in the lane report
-- (ADR 0163, which designs the library's intake, is Proposed).
--
-- Locked down in the same file (RLS on, one service_role policy, anon and
-- authenticated revoked); the actor column keys on public.users(user_id); a
-- trigger refuses a row whose item is not an item of the row's house.
-- Additive, idempotent, assertions at the bottom.

CREATE TABLE IF NOT EXISTS public.house_item_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL REFERENCES public.restaurant_inventory(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  matched_master_wine_id UUID REFERENCES public.master_wine_library(id),
  queued_from TEXT NOT NULL,
  source_order_id UUID REFERENCES public.procurement_orders(id) ON DELETE SET NULL,
  queued_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT house_item_research_status_known CHECK (status IN ('queued', 'matched', 'not_findable')),
  CONSTRAINT house_item_research_from_known CHECK (queued_from IN ('delivery', 'rename')),
  CONSTRAINT house_item_research_says_why CHECK (btrim(reason) <> ''),
  CONSTRAINT house_item_research_match_names_the_wine CHECK ((status = 'matched') = (matched_master_wine_id IS NOT NULL))
);

-- One row per house item: a second delivery of the same item finds its row.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_house_item_research_item
  ON public.house_item_research (inventory_id);

-- What a consumer reads first: the queued rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_house_item_research_queued
  ON public.house_item_research (created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_house_item_research_house
  ON public.house_item_research (restaurant_id, status);

-- The item must be an item of the row's house (ADR 0141's rule, for this
-- table): the id comes off an order or a request path, and the column itself
-- carries no tenant.
CREATE OR REPLACE FUNCTION public.house_item_research_names_its_house()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_inventory
     WHERE id = NEW.inventory_id AND restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION
      'house_item_research: item % is not an item of restaurant %, so nothing was queued.',
      NEW.inventory_id, NEW.restaurant_id
      USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS house_item_research_names_its_house ON public.house_item_research;
CREATE TRIGGER house_item_research_names_its_house
  BEFORE INSERT OR UPDATE ON public.house_item_research
  FOR EACH ROW EXECUTE FUNCTION public.house_item_research_names_its_house();

ALTER TABLE public.house_item_research ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_item_research_service_role ON public.house_item_research;
CREATE POLICY house_item_research_service_role
  ON public.house_item_research
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_item_research FROM anon, authenticated;

COMMENT ON TABLE public.house_item_research IS
  'A house item with no wine-library row, waiting for research by its id (founder, 2026-09-21, ADR 0192 amendment): queued | matched | not_findable, with the reason. Written by the gateway after a delivery books the item and when the house renames it; read by /inventory for the "tell us which wine this is" flag. No research consumer reads it yet. RLS on, service_role only.';

DO $$
DECLARE
  fk_target TEXT;
BEGIN
  IF to_regclass('public.house_item_research') IS NULL THEN
    RAISE EXCEPTION 'house_item_research was not created';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.house_item_research')) THEN
    RAISE EXCEPTION 'house_item_research has RLS off';
  END IF;
  IF has_table_privilege('anon', 'public.house_item_research', 'SELECT')
     OR has_table_privilege('authenticated', 'public.house_item_research', 'SELECT')
     OR has_table_privilege('anon', 'public.house_item_research', 'INSERT')
     OR has_table_privilege('authenticated', 'public.house_item_research', 'INSERT')
  THEN
    RAISE EXCEPTION 'house_item_research is still reachable by anon/authenticated';
  END IF;
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
     AND kcu.table_name = 'house_item_research'
     AND kcu.column_name = 'queued_by'
   LIMIT 1;
  IF fk_target IS DISTINCT FROM 'public.users.user_id' THEN
    RAISE EXCEPTION 'house_item_research.queued_by must reference public.users(user_id), found %', coalesce(fk_target, 'no foreign key');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = to_regclass('public.house_item_research')
       AND tgname = 'house_item_research_names_its_house'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'house_item_research has no tenancy trigger';
  END IF;
  RAISE NOTICE 'house_item_research: created, locked down, keyed by the house item id.';
END
$$;
