-- An owner or manager may assign a staff member to set up zones. ADR 0238.
--
-- THE FOUNDER, 2026-09-29, asked "who may create, rename, resize or delete a
-- zone, and who may place wines in zones? Today every house member can do all
-- of it", and answered, verbatim:
--
--   "managers/owners+ the people they assign"
--
-- Zone SETUP (create, rename, resize, any other field of the zone, delete, a
-- rename on the cellar floor) is therefore an owner's, a manager's, or a
-- staff member's whom an owner or manager of the same house assigned. This
-- column is the assignment. Placing and counting wines are not gated by it:
-- the answer does not separate them, so they stay open to every member and
-- the question is OD-200.
--
-- WHY A COLUMN ON THE MEMBERSHIP ROW, NOT A NEW TABLE OR `authority_grants`
-- `authority_grants` (20261116100000) is the vendor-send register: its
-- `scope` CHECK admits only 'vendor_send', and its functions enforce the
-- founder's 2026-09-21 rules for sending money ("only an owner issues", a
-- seal on every act, the grant stops when its owner goes). Zones need a
-- manager to be able to assign, so reusing it means rewriting founder-set
-- rules on a security ledger. The per-person switch on the membership row is
-- the house's other precedent (`team_pay_access`, 20261201110220, ADR 0215):
-- it goes when the membership goes (a removal deletes the row), it never
-- outlives the house, and no client can write it.
--
-- `zone_setup_access` is read by the gateway only for a caller whose role
-- here is `staff`: an owner or manager sets up zones by role. Default
-- `false`: every staff member today loses zone setup until an owner or
-- manager assigns them, which is what the answer says. Written only through
-- `StorageLocationsService.setSetupAccess` (`PUT
-- /storage-locations/:rid/setup-access/:userId`), owner or manager of the
-- same house only, and every change is a `zone_setup_access_changed` row in
-- `system_audit_log` with the person told. No client can write it directly:
-- `user_restaurant_access` has RLS on with SELECT policies only, and
-- anon/authenticated hold no write grant on it (OD-72); the DO block below
-- fails the migration if that ever stops being true.
--
-- Additive and idempotent: one column added with a constant default (no
-- table rewrite), no row written or deleted.

SET local statement_timeout = '120s';

ALTER TABLE public.user_restaurant_access
  ADD COLUMN IF NOT EXISTS zone_setup_access BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_restaurant_access.zone_setup_access IS
  'Whether this STAFF member may set up the house''s storage zones: create, rename, resize, delete (ADR 0238, founder 2026-09-29, verbatim: "managers/owners+ the people they assign"). Read only when role = staff; owners and managers set up zones by role. Written only by an owner or manager of the same house through the gateway, audited as zone_setup_access_changed. Placing and counting wines are not gated by it (OD-200).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_restaurant_access'
       AND column_name = 'zone_setup_access'
       AND is_nullable = 'NO'
       AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'user_restaurant_access.zone_setup_access is missing, nullable, or not defaulted to false';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'user_restaurant_access'
         AND grantee IN ('anon', 'authenticated')
         AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')) > 0 THEN
    RAISE EXCEPTION 'anon/authenticated may write user_restaurant_access, so a staff member could assign themself zone setup';
  END IF;
  RAISE NOTICE 'user_restaurant_access.zone_setup_access is in place, false for every member until an owner or manager assigns it.';
END
$$;
