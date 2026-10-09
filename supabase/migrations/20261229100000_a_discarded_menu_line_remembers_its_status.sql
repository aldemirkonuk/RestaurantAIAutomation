-- menu_items.prior_status — a discarded menu line remembers the status it had,
-- so an owner or a manager can put it back (F-268; coordinator's call for the
-- founder, delegated 2026-10-07).
--
-- Discard (a_menu_line_can_be_discarded, ADR 0160 sec110 item 7) overwrites
-- `status` with 'discarded'. Before this column, nothing kept whether the line
-- had been 'approved', 'flagged' or 'in_review', so a restore could only guess.
-- The discard write now copies the old status here; the restore write puts it
-- back and clears it. A line discarded before this column existed has NULL
-- here, and the restore puts it back as 'in_review' (the page says so).
--
-- Additive and idempotent: a nullable column, no default, no backfill, no
-- existing row touched. The CHECK allows only the three states a line can be
-- discarded FROM — never 'discarded' itself, which would restore to nothing.
alter table public.menu_items
  add column if not exists prior_status text;

alter table public.menu_items
  drop constraint if exists menu_items_prior_status_check;

alter table public.menu_items
  add constraint menu_items_prior_status_check
  check (prior_status is null or prior_status = any (array['approved', 'flagged', 'in_review']));

comment on column public.menu_items.prior_status is
  'The status a line had when it was discarded (approved/flagged/in_review). '
  'Set by the discard write, cleared by the restore write; NULL on a live '
  'line and on a line discarded before this column existed (restored as '
  'in_review).';
