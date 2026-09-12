-- /promotions rebuild (ADR 0133 new-pages wave, 2026-09-11): an offer a manager
-- dismisses is dismissed FOR THE HOUSE, not for one browser.
--
-- What was there: `pages/Promotions.tsx:101-138` kept dismissed offer ids in
-- `localStorage['wineops.promos.dismissed']`. Two managers saw two different
-- offer lists and neither knew why (promotions.md §12, "Where the UI
-- misleads"). The page note's roadmap item 2 named the fix as "one column and
-- one route"; this file is the column, `promotions/promotions.controller.ts`
-- the route.
--
-- Why a timestamp and not a boolean: a boolean cannot say WHEN, and a
-- dismissal with no date cannot be reviewed or expired. `dismissed_at IS NULL`
-- is the single fact "on the table"; there is no second column to disagree
-- with it.
--
-- Why NOT `is_active`: `is_active` is the D3 lane's own lifecycle bit. The
-- extractor's dedup (`promotion-extractor.service.ts:52-60`) looks for an
-- ACTIVE promo with the same `conditions.signature` before inserting, so a
-- dismissal expressed as `is_active = false` would let the next identical mail
-- re-insert the offer the manager just put away -- the dismissal would undo
-- itself on the vendor's next send. A separate column keeps the dedup true and
-- the dismissal durable.
--
-- Why `dismissed_by` references `public.users(user_id)` and never
-- `auth.users`: the JWT carries `public.users.user_id`, and the two tables are
-- disjoint in production (memory `auth-users-and-public-users-are-disjoint`); an
-- actor FK to `auth.users` 23503s on every write and a fresh CI database cannot
-- catch it. Same shape as `20260904150000_the_house_writes_its_own_mail.sql:114`.
--
-- No backfill: nothing in the database ever recorded a dismissal, so there is
-- nothing to carry over. The per-browser list stays where it is; the rebuilt
-- page does not read it and says so.

do $$
begin
  if to_regclass('public.provider_promotions') is null then
    raise exception 'provider_promotions does not exist; this migration has nothing to alter and would report success over nothing';
  end if;
  if to_regclass('public.users') is null then
    raise exception 'public.users does not exist; dismissed_by cannot reference it';
  end if;
end $$;

alter table public.provider_promotions
  add column if not exists dismissed_at timestamp with time zone;

alter table public.provider_promotions
  add column if not exists dismissed_by uuid
    references public.users(user_id) on delete set null;

comment on column public.provider_promotions.dismissed_at is
  'When a manager put this offer away for the whole house (POST /promotions/:id/dismiss). NULL means the offer is on the table. Restoring clears it. Never a substitute for is_active, which is the extraction lane''s own lifecycle bit and drives its dedup.';

comment on column public.provider_promotions.dismissed_by is
  'public.users.user_id of the person who dismissed it -- the id the JWT carries -- or NULL once that account is deleted. Never auth.users: the two tables are disjoint in production.';

-- The page reads one house's offers on the table; this is the shape it asks for.
create index if not exists idx_provider_promotions_house_on_table
  on public.provider_promotions (restaurant_id, end_date)
  where dismissed_at is null and is_active = true;
