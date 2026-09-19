-- A setup-era manager holds their house by an access row, not only by the
-- users row.
--
-- ADR 0162, the founder's answer B of 2026-09-18 ("Give them a manager row"),
-- PR #393; v3.0-TECH-DEBT 44.1h and 44.1i.
--
-- THE ONE ROW THIS WRITES
-- -----------------------
-- Production, read-only, 2026-09-18: of the 8 users whose `users.restaurant_id`
-- names a house, exactly 1 has no `user_restaurant_access` row for that house,
-- active or inactive. They are a manager created 2026-05-09, and the house
-- their users row names (YAREN) was created the same day. They hold active
-- manager rows in two other houses, created 2026-08-05, and belong to YAREN's
-- organisation. They are a member from before every member had an access row,
-- not someone who left: every membership check admits them to YAREN through
-- its `users`-row fallback (`MembersService.assertMembership`,
-- `OrganizationsService.resolveRestaurantRole`, `TeamService.assertAccess` as
-- staff, `AuthService.generateInvite`). This writes the manager row that
-- fallback stands in for. Once it exists in production, the fallback can
-- retire in a follow-up (44.1i). It must not retire before: without this row
-- that manager would lose YAREN.
--
-- WHY NOT A GENERIC BACKFILL
-- --------------------------
-- `AuthService.leaveRestaurant` and `TeamService.deleteMember` delete the
-- access row and leave `users.restaurant_id` naming the house (44.1j). A
-- backfill of "every users row with no access row for its house" would
-- re-admit everyone those two paths ever removed. So this names one person
-- and one house, and matches the WHOLE measured tuple, not the ids alone:
--   * the users row: that id, `restaurant_id` naming that house,
--     `role = 'manager'`, created on 2026-05-09 (UTC);
--   * the house: that id, created on 2026-05-09 (UTC), not soft-deleted;
--   * and no access row for the pair at all, active or inactive.
-- If any part has changed since it was measured, nothing is written.
--
-- AT MOST ONE ROW, AND IT SAYS HOW MANY
-- -------------------------------------
-- The ids are primary keys, so the tuple matches 0 or 1 rows. More than 1
-- raises and writes nothing. The insert is `ON CONFLICT DO NOTHING` on
-- `UNIQUE (user_id, restaurant_id)`, and the rows it wrote are counted:
-- more than 1 raises (rolling the file back), and the count is reported by
-- RAISE NOTICE either way.
--
-- A fresh database (CI, `supabase db reset`) holds none of these rows, and a
-- second run finds the row the first one wrote, so both match 0 and write
-- nothing. Proven on PGlite 2026-09-18 (PR #393's fourth round): 1 row on the
-- seeded tuple, 0 on a second run, 0 on each tuple with one part changed.
--
-- The row: `role = 'manager'` (inside `user_restaurant_access_role_known`),
-- `is_active = true`, `invited_via` NULL (nobody invited them; they predate
-- invitations), `created_at` and `valid_from` from their DEFAULT now(), which
-- is when this row was written. `user_restaurant_access` has no triggers.
--
-- Not filed in `system_audit_log`: that table records who changed a person's
-- access, and nobody did. This row records a membership the house already
-- granted; this file and ADR 0162 are its record.
--
-- No explicit BEGIN/COMMIT: the Supabase CLI wraps each migration file in a
-- transaction.

DO $$
DECLARE
  v_user    constant uuid := 'fb003eaa-b4a3-484f-b0cb-17d7e78d3e1e';
  v_house   constant uuid := 'b603cc30-8654-4cf1-914d-74635038695b';
  v_matches integer;
  v_written integer := 0;
BEGIN
  SELECT count(*) INTO v_matches
    FROM public.users u
    JOIN public.restaurants r ON r.id = u.restaurant_id
   WHERE u.user_id = v_user
     AND u.restaurant_id = v_house
     AND u.role = 'manager'
     AND (u.created_at AT TIME ZONE 'UTC')::date = DATE '2026-05-09'
     AND (r.created_at AT TIME ZONE 'UTC')::date = DATE '2026-05-09'
     AND r.deleted_at IS NULL
     AND NOT EXISTS (
           SELECT 1
             FROM public.user_restaurant_access a
            WHERE a.user_id = u.user_id
              AND a.restaurant_id = u.restaurant_id
         );

  IF v_matches > 1 THEN
    RAISE EXCEPTION
      'setup-era manager row: the measured tuple matched % rows; this writes at most one, so it wrote none',
      v_matches;
  END IF;

  IF v_matches = 1 THEN
    INSERT INTO public.user_restaurant_access
      (user_id, restaurant_id, role, is_active, invited_via)
    VALUES (v_user, v_house, 'manager', true, NULL)
    ON CONFLICT (user_id, restaurant_id) DO NOTHING;
    GET DIAGNOSTICS v_written = ROW_COUNT;
  END IF;

  IF v_written > 1 THEN
    RAISE EXCEPTION
      'setup-era manager row: % rows written; this writes at most one',
      v_written;
  END IF;

  RAISE NOTICE
    'setup-era manager row: the measured tuple matched % row(s); % access row(s) written',
    v_matches, v_written;
END $$;
