-- Two coordinator calls under the founder's delegation (2026-10-11, S195):
--
--   1. F-704: a removed person's name and position leave the removal's audit
--      row after the same five years their shifts, leave, wages and
--      credentials are kept. The event itself stays.
--   2. F-731: the lines of one cart share a `placement_id`, so the first
--      order to a vendor is held as a whole cart, not line by line.
--
-- ---------------------------------------------------------------------------
-- 1. F-704
-- ---------------------------------------------------------------------------
--
-- WHAT WAS THERE: `TeamService.deleteMember` files one `system_audit_log` row
-- per removal (`action = 'team_member_removed'`), whose `changes` carry the
-- removed person's `display_name` and `position` (team.service.ts, ADR 0088).
-- The nightly job (`WageRecordRetentionService`) deletes everything else kept
-- for that person once `wage_record_retention()` (5 years) has run since the
-- removal (ADR 0215), but nothing ever touched the audit row, so the name and
-- position outlived every other record of them for good.
--
-- THE CALL (coordinator under the founder's delegation, 2026-10-11, S195):
-- at the five-year former-staff purge, the removed person's name and position
-- on that row are replaced by 'Former staff member' and nothing; the row --
-- who removed them, when, the access withdrawn, the shifts released -- stays.
-- This does not touch `actor_id`, the person who ACTED: the founder's rule
-- that "an audit trail that forgets who acted is no longer an audit trail"
-- (20260925120500) is about that column, and it is kept as it was. What goes
-- is the name of the person the event happened to, which KVKK's "no longer
-- than needed" reaches on the same clock as the rest of their record.
--
-- THE CLOCK: the audit row's own `created_at`, which is the removal moment
-- (the row is written by the removal itself). A row whose `entity_id` is
-- still a roster row is never touched; roster ids are fresh uuids, so a
-- removed id does not come back, and the clause is a belt to that.
--
-- WHAT THIS DOES
--   forget_expired_removal_names()
--       Rewrites `changes.display_name` to 'Former staff member' and
--       `changes.position` to null on every `team_member_removed` row older
--       than `wage_record_retention()` that still carries either. Every other
--       key of `changes` is kept. Returns how many rows it rewrote -- 0 is a
--       real answer, never a failure; a second run the same night returns 0.
--       Service role only. Called by the same nightly job, after the wage
--       purge.
--
-- ---------------------------------------------------------------------------
-- 2. F-731
-- ---------------------------------------------------------------------------
-- WHAT WAS THERE: `CreateOrderDto` carries one line, so /orders places a cart
-- as one order per line, and nothing on the rows said which lines were placed
-- together. The approve gate's `new_vendor` rule (`isFirstOrderToVendorAmong`,
-- settings/approval-thresholds.ts) could therefore hold only the earliest line
-- of a first cart; the rest went through unheld.
--
-- THE CALL: approval is per purchase order, and a cart is one, so every line
-- of the first cart to a vendor is held together. `placement_id` is the id
-- the /orders sheet sends with every line of one placement. Nullable, no
-- default and no foreign key: an order placed alone (the agreement sheet, the
-- engine, every order before this column) is its own placement, which is what
-- null means to the rule.
--
-- Additive and idempotent: one function created or replaced, one nullable
-- column added (IF NOT EXISTS), no row written by the migration itself.

SET local statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.forget_expired_removal_names()
RETURNS TABLE (names_forgotten BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_rows BIGINT;
BEGIN
  UPDATE public.system_audit_log a
     SET changes = a.changes || jsonb_build_object(
           'display_name', 'Former staff member',
           'position', NULL)
   WHERE a.action = 'team_member_removed'
     AND a.created_at <= now() - public.wage_record_retention()
     AND jsonb_typeof(a.changes) = 'object'
     AND (
       (a.changes->>'display_name' IS NOT NULL
        AND a.changes->>'display_name' <> 'Former staff member')
       OR a.changes->>'position' IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members m WHERE m.id = a.entity_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows;
END
$function$;

COMMENT ON FUNCTION public.forget_expired_removal_names() IS
  'F-704 (coordinator under founder delegation, 2026-10-11, S195): replaces the removed person''s display_name with ''Former staff member'' and position with null in every system_audit_log team_member_removed row older than wage_record_retention() (5 years), keeping the event and every other key, actor_id included. Called nightly by WageRecordRetentionService after purge_expired_wage_records(). Returns how many rows it rewrote; 0 is a real answer.';

REVOKE ALL ON FUNCTION public.forget_expired_removal_names() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forget_expired_removal_names() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forget_expired_removal_names() TO service_role;

ALTER TABLE public.procurement_orders
  ADD COLUMN IF NOT EXISTS placement_id uuid;

COMMENT ON COLUMN public.procurement_orders.placement_id IS
  'F-731 (coordinator under founder delegation, 2026-10-11, S195): one id shared by every line of one cart placed together on /orders. The new_vendor approval rule treats the lines of one placement as one purchase order, so the first cart to a vendor is held whole. Null = placed alone (and every order before this column).';
