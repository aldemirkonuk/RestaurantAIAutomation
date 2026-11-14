-- A kept menu can be set aside, and brought back (r36 menu audit N9, r40
-- 2026-11-14).
--
-- Every menu a house reads is kept (20260922230700_a_house_keeps_every_menu_it_reads.sql):
-- a draft is "read and kept, never chosen", and that keeping is on purpose
-- (the ML-data case), so a read is never deleted. But nothing could ever take
-- a kept menu out of the way. A misread photo, a test file or a menu read
-- twice stayed under "Menus kept" for good, each with its own "Make current",
-- and on day 30 the owner chose between ten rows that look alike.
--
-- Setting a menu aside keeps every row and every line as it is. It only
-- says who set it aside and when, so the list can fold it away and the
-- gateway can refuse to make it current until someone brings it back:
--
--   set_aside_at  when an owner or a manager set this menu aside; NULL = it
--                 is not set aside (every row before this file).
--   set_aside_by  who did (public.users, as every other actor column here).
--
-- The current menu is never set aside: a house always has the menu it sells
-- from, and setting it aside would leave none. A CHECK holds it, so a menu
-- set aside cannot be made current by make_menu_current either, even by a
-- caller that skipped the gateway's own refusal: the RPC's UPDATE to
-- 'active' fails and nothing is changed. Bringing it back clears both
-- columns.
--
-- Additive. Writes no row; every existing menu reads as not set aside.

ALTER TABLE public.restaurant_menus
  ADD COLUMN IF NOT EXISTS set_aside_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS set_aside_by UUID REFERENCES public.users(user_id) ON DELETE RESTRICT;

DO $$
BEGIN
  ALTER TABLE public.restaurant_menus DROP CONSTRAINT IF EXISTS restaurant_menus_set_aside_is_not_current;
  ALTER TABLE public.restaurant_menus
    ADD CONSTRAINT restaurant_menus_set_aside_is_not_current
    CHECK (set_aside_at IS NULL OR status IS DISTINCT FROM 'active');
  ALTER TABLE public.restaurant_menus DROP CONSTRAINT IF EXISTS restaurant_menus_set_aside_says_who;
  ALTER TABLE public.restaurant_menus
    ADD CONSTRAINT restaurant_menus_set_aside_says_who
    CHECK ((set_aside_at IS NULL) = (set_aside_by IS NULL));
END
$$;

COMMENT ON COLUMN public.restaurant_menus.set_aside_at IS
  'When an owner or a manager set this kept menu aside (r36 N9): its rows and lines are kept as they are, the menu list folds it away, and it cannot be made current until it is brought back (which clears this). NULL = not set aside. Never set on the current menu (CHECK restaurant_menus_set_aside_is_not_current).';
COMMENT ON COLUMN public.restaurant_menus.set_aside_by IS
  'Who set this kept menu aside (public.users). NULL exactly when set_aside_at is NULL.';
