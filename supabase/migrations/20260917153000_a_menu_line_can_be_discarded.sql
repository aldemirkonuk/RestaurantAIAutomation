-- menu_items.status gains 'discarded' — ADR 0160 sec110 item 7: "/menu: a
-- person can add and discard items."
--
-- `menu_items_status_check` (baseline_from_production.sql:3805) allows only
-- 'approved', 'flagged', 'in_review' — every one of them a state on the way
-- TO the menu, none of them a way off it. There was no discard state to write
-- because nothing on this table has ever removed a line; `getMenu`
-- (menus.service.ts:272-279) reads every status without filtering any out, so
-- a genuinely discarded row would still be served as a live menu item.
--
-- Additive and idempotent: DROP CONSTRAINT IF EXISTS then re-ADD with the
-- widened list, so re-running this file (or a `supabase db reset`) is a
-- no-op the second time, and no existing row's status is touched — every
-- current value is still in the allowed set.
alter table public.menu_items
  drop constraint if exists menu_items_status_check;

alter table public.menu_items
  add constraint menu_items_status_check
  check (status = any (array['approved', 'flagged', 'in_review', 'discarded']));

comment on column public.menu_items.status is
  'approved/flagged/in_review: review states on the way onto the menu '
  '(unchanged). discarded (added 20260917153000): a person removed the line '
  'from /menu; getMenu filters these out (menus.service.ts) rather than '
  'deleting the row, so what it cost and who added it stays in the record.';
