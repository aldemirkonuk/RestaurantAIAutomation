-- Two more branches of the settled-submission flip — the founder's answers
-- of 2026-09-22 (round 6z) on ADR 0192's residual, verbatim picks:
--   (7) "Yes, link it (Recommended)"
--   (6) "Rejected after research (Recommended)"
--   (5) "Only settled flips (Recommended)" — as built; no change, recorded
--       below and in the ADR.
--
-- (7) A MATCHED ITEM IS LINKED
-- -----------------------------
-- `house_item_research_follows_its_submission()` (20260926141200) already
-- flips the queue row to `matched` when its submission settles `merged` or
-- `accepted` with a `matched_master_id`. It never wrote that id anywhere the
-- item itself: `restaurant_inventory.master_wine_id` stayed null, so menus,
-- POS matching and valuation still read the item as unlinked even after
-- research found its wine. This file adds ONE more write in the same
-- branch, by the same ids the flip already resolved (the just-flipped row's
-- `inventory_id`/`restaurant_id`, captured off the UPDATE's own RETURNING —
-- no second lookup, no name involved) — and only when the item is still
-- unlinked (`master_wine_id IS NULL`), so a manual link made by some other
-- path in between is never overwritten.
--
-- (6) A REJECTED SUBMISSION IS NOT_FINDABLE
-- ------------------------------------------
-- `master_wine_library_submissions.status = 'rejected'` is a real, existing
-- terminal value — written today by the orchestrator's operator route
-- (`POST /admin/submissions/:id/reject`, services/agent-orchestrator/
-- api/admin_routes.py) when a human declines a `pending_review` candidate.
-- `WineSubmissionsService.processPendingSubmissions`
-- (apps/api-gateway/src/wines/wine-submissions.service.ts) has no distinct
-- "no wine found" terminal of its own today: a submission with no library
-- candidate at all is not left unmatched, it is turned INTO a new library
-- row (`accepted`) — stated here as a residual, not assumed to be what the
-- founder meant by "no match after research"; the reachable case this file
-- wires is the reject route's `rejected`. The queue row (by `submission_id`,
-- only while still `queued` — a `matched` row is never moved back) becomes
-- `not_findable`, the same terminal a placeholder name gets, so the house
-- sees the identical flag (`NAME_THIS_WINE_FLAG`,
-- apps/api-gateway/src/inventory/house-item-research.ts) and can rename the
-- item to try again.
--
-- (5) ONLY A SETTLED SUBMISSION FLIPS ANYTHING — AS BUILT
-- ---------------------------------------------------------
-- The trigger's condition was, and stays, `NEW.status IN ('merged',
-- 'accepted')` for the link and (new) `NEW.status = 'rejected'` for the
-- not_findable branch — never `pending_review` (a near miss with a
-- candidate id a human has not confirmed) and never a bare
-- `field_confidence`/`web_verified_at` write from `web_verify_task`, which
-- touches neither `status` nor `matched_master_id` and so never fires the
-- trigger's `UPDATE OF` columns at all. The founder confirmed this is
-- correct as built; nothing here changes it. Recorded per CLAUDE.md §0.2 so
-- the confirmation is not lost to the transcript.
--
-- Additive (CREATE OR REPLACE FUNCTION only, same signature, same trigger),
-- idempotent, assertions at the bottom. No table, column or RLS change.

CREATE OR REPLACE FUNCTION public.house_item_research_follows_its_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_item UUID;
  v_house UUID;
BEGIN
  IF NEW.matched_master_id IS NOT NULL AND NEW.status IN ('merged', 'accepted') THEN
    UPDATE public.house_item_research h
       SET status = 'matched',
           matched_master_wine_id = NEW.matched_master_id,
           reason = 'Research found this wine: the wine library holds it now.'
     WHERE h.submission_id = NEW.id
       AND h.status = 'queued'
    RETURNING h.inventory_id, h.restaurant_id INTO v_item, v_house;

    -- (7) Founder, 2026-09-22: "Yes, link it (Recommended)". Only the item
    -- this exact flip just matched, by id; never touches a row this
    -- statement did not flip (v_item is null when nothing flipped, e.g. a
    -- re-settle of an already-matched row), and never overwrites a link
    -- some other path made first.
    IF v_item IS NOT NULL THEN
      UPDATE public.restaurant_inventory
         SET master_wine_id = NEW.matched_master_id
       WHERE id = v_item
         AND restaurant_id = v_house
         AND master_wine_id IS NULL;
    END IF;

  ELSIF NEW.status = 'rejected' THEN
    -- (6) Founder, 2026-09-22: "Rejected after research (Recommended)".
    -- Only a still-queued row; a row already matched is never moved back
    -- (the same guarantee the merged/accepted branch has always had).
    UPDATE public.house_item_research h
       SET status = 'not_findable',
           reason = 'Research looked and could not confirm this wine; rename the item on Inventory to try again.'
     WHERE h.submission_id = NEW.id
       AND h.status = 'queued';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.house_item_research_follows_its_submission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.house_item_research_follows_its_submission() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.house_item_research_follows_its_submission() TO service_role;

COMMENT ON FUNCTION public.house_item_research_follows_its_submission() IS
  'Founder, 2026-09-22 (round 6z): a settled submission (merged/accepted with a matched_master_id) flips its queue row to matched AND links restaurant_inventory.master_wine_id by id ("Yes, link it"); a rejected submission flips its still-queued row to not_findable ("Rejected after research"). A near miss (pending_review) flips nothing ("Only settled flips", as built). service_role only.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = to_regclass('public.master_wine_library_submissions')
       AND tgname = 'house_item_research_follows_its_submission'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'master_wine_library_submissions has no house_item_research_follows_its_submission trigger';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.house_item_research_follows_its_submission()'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION 'house_item_research_follows_its_submission must stay SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.house_item_research_follows_its_submission()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.house_item_research_follows_its_submission()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'house_item_research_follows_its_submission is still callable by anon/authenticated';
  END IF;
  RAISE NOTICE 'house_item_research_follows_its_submission: links a matched item, marks a rejected one not_findable.';
END
$$;
