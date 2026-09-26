-- A queued house item is worked by the existing enrich chain, linked by id —
-- the founder's answers of 2026-09-22 (round 6u) on ADR 0192's second
-- amendment, verbatim picks:
--   (1) "Existing enrich chain (Recommended)"
--   (4) "Yes, same rule (Recommended)"
--
-- WHAT (1) MEANS HERE
-- -------------------
-- A `queued` row of house_item_research (20260926141000) is filed as ONE
-- `master_wine_library_submissions` row, whose id is kept on the queue row
-- (`submission_id`), and the submission is handed to the existing chain
-- (`haiku_enrich_task` -> `web_verify_task`, both keyed by the submission's
-- id). The link is the id, never the name. The queue row flips to `matched`
-- when its submission is settled with a `matched_master_id` (the trigger
-- below), and to nothing else.
--
-- WHAT IS RESEARCHED, AND WHAT IS NEVER RESEARCHED
-- ------------------------------------------------
-- `classified_name` is the name the gateway's classifier
-- (`classifyHouseItemName`, apps/api-gateway/src/inventory/house-item-research.ts)
-- judged researchable when it decided the row. The claim below files THAT
-- name and only for a `queued` row, so a placeholder ("wine 1", "house red",
-- a blank — `not_findable`) is never filed, and a name edited after the
-- decision by some path that does not re-decide is never researched in its
-- place. A `queued` row must carry its classified name (CHECK).
--
-- WHO CLAIMS
-- ----------
-- `claim_house_item_research()` (service_role only) takes the oldest queued
-- rows that have not been handed to the chain, under FOR UPDATE SKIP LOCKED
-- and a lease, files each one's submission once (a row that already has a
-- submission keeps it: a retry never files a second one; a unique index
-- holds it), and returns (research id, house, item, submission id, name) for
-- the orchestrator's sweep (`house_item_research.dispatch`,
-- services/agent-orchestrator/jobs/house_item_research_tasks.py) to hand to
-- `haiku_enrich_task`. The sweep stamps `dispatched_at` after the hand-off
-- succeeded, or `last_dispatch_error` when it did not; a failed hand-off is
-- claimed again after the lease, at most `p_max_attempts` times.
--
-- THE FLIP TO `matched`
-- ---------------------
-- A submission settles as `merged` (linked to an existing library wine) or
-- `accepted` (a new library row) in WineSubmissionsService.processPendingSubmissions
-- (apps/api-gateway/src/wines/wine-submissions.service.ts). A NEAR MISS is
-- written `pending_review` WITH the candidate's id in `matched_master_id` —
-- a candidate a human has not confirmed — so it does NOT flip the row: a
-- queue row says `matched` only for a settled link. (Stated to the founder as
-- a question in the lane report.)
--
-- (4) RECEIVING
-- -------------
-- The receiving door now queues research for the items it books
-- (`queued_from = 'receiving'`), once per item id: the unique index on
-- inventory_id from 20260926141000 is the "once".
--
-- No production row exists yet: 20260926141000 lands in the same PR as this
-- file, so the backfill below touches only local databases.
--
-- Additive (nullable columns, a defaulted counter, a widened CHECK, a new
-- function and trigger), idempotent, assertions at the bottom. RLS on
-- house_item_research is unchanged (on, service_role only).

ALTER TABLE public.house_item_research
  ADD COLUMN IF NOT EXISTS classified_name TEXT,
  ADD COLUMN IF NOT EXISTS submission_id UUID REFERENCES public.master_wine_library_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatch_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_dispatch_error TEXT;

-- Local rows written before this file: a queued row takes the item's name as
-- it stands (the gateway classified that name when it queued the row); a
-- queued row whose item has no name left is a blank, which is not findable.
UPDATE public.house_item_research h
   SET classified_name = coalesce(nullif(btrim(ri.wine_name), ''), nullif(btrim(ri.display_name), ''))
  FROM public.restaurant_inventory ri
 WHERE h.status = 'queued'
   AND h.classified_name IS NULL
   AND ri.id = h.inventory_id;
UPDATE public.house_item_research
   SET status = 'not_findable',
       reason = 'The item has no name, so it cannot be looked up.'
 WHERE status = 'queued'
   AND (classified_name IS NULL OR btrim(classified_name) = '');

ALTER TABLE public.house_item_research
  DROP CONSTRAINT IF EXISTS house_item_research_from_known;
ALTER TABLE public.house_item_research
  ADD CONSTRAINT house_item_research_from_known
  CHECK (queued_from IN ('delivery', 'rename', 'receiving'));

ALTER TABLE public.house_item_research
  DROP CONSTRAINT IF EXISTS house_item_research_queued_names_what_is_researched;
ALTER TABLE public.house_item_research
  ADD CONSTRAINT house_item_research_queued_names_what_is_researched
  CHECK (status <> 'queued' OR (classified_name IS NOT NULL AND btrim(classified_name) <> ''));

ALTER TABLE public.house_item_research
  DROP CONSTRAINT IF EXISTS house_item_research_dispatch_needs_its_submission;
ALTER TABLE public.house_item_research
  ADD CONSTRAINT house_item_research_dispatch_needs_its_submission
  CHECK (dispatched_at IS NULL OR submission_id IS NOT NULL);

ALTER TABLE public.house_item_research
  DROP CONSTRAINT IF EXISTS house_item_research_attempts_counted;
ALTER TABLE public.house_item_research
  ADD CONSTRAINT house_item_research_attempts_counted
  CHECK (dispatch_attempts >= 0);

-- One queue row per submission: a submission is never shared by two items.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_house_item_research_submission
  ON public.house_item_research (submission_id)
  WHERE submission_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The claim: file each queued row's submission once, hand back what to send.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_house_item_research(
  p_limit INTEGER DEFAULT 10,
  p_lease_minutes INTEGER DEFAULT 30,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS TABLE (
  research_id UUID,
  house_id UUID,
  item_id UUID,
  library_submission_id UUID,
  name_to_research TEXT
)
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  r public.house_item_research%ROWTYPE;
  v_master UUID;
  v_sub UUID;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'claim_house_item_research: p_limit must be 1 to 100, got %', p_limit
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_minutes IS NULL OR p_lease_minutes < 1 THEN
    RAISE EXCEPTION 'claim_house_item_research: p_lease_minutes must be at least 1, got %', p_lease_minutes
      USING ERRCODE = '22023';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'claim_house_item_research: p_max_attempts must be at least 1, got %', p_max_attempts
      USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT h.*
      FROM public.house_item_research h
     WHERE h.status = 'queued'
       AND h.dispatched_at IS NULL
       AND h.dispatch_attempts < p_max_attempts
       AND (h.dispatch_claimed_at IS NULL
            OR h.dispatch_claimed_at < now() - make_interval(mins => p_lease_minutes))
     ORDER BY h.created_at, h.id
     LIMIT p_limit
     FOR UPDATE OF h SKIP LOCKED
  LOOP
    -- The item, by its id and its house. An item the library now holds needs
    -- no research: the row is matched to that wine, by id.
    SELECT ri.master_wine_id
      INTO v_master
      FROM public.restaurant_inventory ri
     WHERE ri.id = r.inventory_id
       AND ri.restaurant_id = r.restaurant_id;
    IF v_master IS NOT NULL THEN
      UPDATE public.house_item_research
         SET status = 'matched',
             matched_master_wine_id = v_master,
             reason = 'The item is linked to a wine-library row now, so it needs no research.'
       WHERE id = r.id;
      CONTINUE;
    END IF;

    v_sub := r.submission_id;
    IF v_sub IS NULL THEN
      INSERT INTO public.master_wine_library_submissions
        (restaurant_id, submitted_by, payload, status, decision_reason)
      VALUES (
        r.restaurant_id,
        'house_item_research',
        jsonb_build_object(
          'name', r.classified_name,
          'wine_name', r.classified_name,
          'source', 'house_item_research',
          'house_item_id', r.inventory_id,
          'house_item_research_id', r.id
        ),
        'pending',
        'house item the wine library lacks, researched by its id (house_item_research)'
      )
      RETURNING id INTO v_sub;
    END IF;

    UPDATE public.house_item_research
       SET submission_id = v_sub,
           dispatch_claimed_at = now(),
           dispatch_attempts = dispatch_attempts + 1
     WHERE id = r.id;

    research_id := r.id;
    house_id := r.restaurant_id;
    item_id := r.inventory_id;
    library_submission_id := v_sub;
    name_to_research := r.classified_name;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_house_item_research(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_house_item_research(INTEGER, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_house_item_research(INTEGER, INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_house_item_research(INTEGER, INTEGER, INTEGER) IS
  'Founder, 2026-09-22: "Existing enrich chain (Recommended)". Takes the oldest queued house_item_research rows not yet handed to the enrich chain (lease, SKIP LOCKED), files each one master_wine_library_submissions row once (by id; the classified name only), and returns what the orchestrator sweep hands to haiku_enrich_task. service_role only.';

-- ---------------------------------------------------------------------------
-- The flip: a settled submission matches its queue row, by the submission id.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because a submission may be settled by a caller that holds
-- no privilege on house_item_research (the table is service_role only); the
-- function writes exactly one statement, keyed by the submission's own id.
-- EXECUTE is closed to every client role (ADR 0159).
CREATE OR REPLACE FUNCTION public.house_item_research_follows_its_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.matched_master_id IS NOT NULL AND NEW.status IN ('merged', 'accepted') THEN
    UPDATE public.house_item_research h
       SET status = 'matched',
           matched_master_wine_id = NEW.matched_master_id,
           reason = 'Research found this wine: the wine library holds it now.'
     WHERE h.submission_id = NEW.id
       AND h.status = 'queued';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.house_item_research_follows_its_submission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.house_item_research_follows_its_submission() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_item_research_follows_its_submission() TO service_role;

DROP TRIGGER IF EXISTS house_item_research_follows_its_submission ON public.master_wine_library_submissions;
CREATE TRIGGER house_item_research_follows_its_submission
  AFTER INSERT OR UPDATE OF matched_master_id, status ON public.master_wine_library_submissions
  FOR EACH ROW EXECUTE FUNCTION public.house_item_research_follows_its_submission();

COMMENT ON COLUMN public.house_item_research.classified_name IS
  'The name the gateway classifier judged researchable when it decided the row; the only name ever filed for research (founder, 2026-09-21: placeholders are skipped and flagged, never researched).';
COMMENT ON COLUMN public.house_item_research.submission_id IS
  'The master_wine_library_submissions row the enrich chain works for this item (founder, 2026-09-22: "Existing enrich chain"). The link is this id, never the name.';

DO $$
DECLARE
  c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['classified_name', 'submission_id', 'dispatch_claimed_at', 'dispatched_at', 'dispatch_attempts', 'last_dispatch_error'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'house_item_research' AND column_name = c
    ) THEN
      RAISE EXCEPTION 'house_item_research.% was not added', c;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = to_regclass('public.master_wine_library_submissions')
       AND tgname = 'house_item_research_follows_its_submission'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'master_wine_library_submissions has no house_item_research_follows_its_submission trigger';
  END IF;
  IF has_function_privilege('anon', 'public.claim_house_item_research(integer, integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_house_item_research(integer, integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.house_item_research_follows_its_submission()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.house_item_research_follows_its_submission()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a house_item_research function is still callable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_house_item_research(integer, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot call claim_house_item_research';
  END IF;
  RAISE NOTICE 'house_item_research: worked by the enrich chain, linked by the submission id; receiving queues too.';
END
$$;
