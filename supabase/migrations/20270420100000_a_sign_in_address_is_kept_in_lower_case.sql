-- A sign-in address is kept in lower case (QA round 11, R11-01; QA round 13).
--
-- Until this change `registerRestaurant` (auth.service.ts) stored the address
-- exactly as typed, while every door that looks an account up -- password
-- reset, the emailed sign-in code, Google, /sign-in-methods, registerAccount --
-- lower-cased and trimmed it first. An owner who registered as Chef@Bistro.com
-- therefore had a row no door could find: no reset, no code, no Google, and
-- the house was reachable only until the seven-day refresh token lapsed. The
-- service now folds the address before it checks or writes it; this migration
-- folds the rows that were written before, and gives the gateway an indexed
-- lookup for the rows it must not fold.
--
-- What it changes: public.users.email only, plus three new objects (below).
-- auth.users is not touched -- it is Supabase-managed, this codebase does not
-- populate it for its own accounts, and in production its ids are disjoint
-- from public.users (measured 2026-09-01, see order_line_capture_and_units).
--
-- What it never does: merge, delete or rename an account. users.email is
-- UNIQUE but case-sensitive, so Chef@Bistro.com and chef@bistro.com can both
-- exist today. Two kinds of row are HELD -- left exactly as they are -- and
-- listed in public.sign_in_addresses_held for a person to resolve:
--   * shared_address: its folded address is shared with another row;
--   * non_ascii: its folded address still has a non-ASCII character, where the
--     gateway's fold (JS toLowerCase) and any SQL fold can disagree.
-- A held row stays reachable: the gateway (findUserBySignInAddress) tries the
-- address as typed first, then the folded spelling, then users.email_folded
-- (the fold below, indexed). `select * from public.fold_user_email_case()` re-runs the
-- fold after a person resolves a held row; it is safe to run again and
-- changes nothing already folded.
--
-- The fold is locale-free on purpose. Postgres lower() follows the database's
-- LC_CTYPE: under tr_TR it turns I into dotless ı, so ILKER@x.com became
-- ılker@x.com and two spellings of one address stopped colliding (QA round
-- 13, measured on a tr_TR.UTF-8 database). public.sign_in_address_fold maps
-- A-Z to a-z with translate() and touches nothing else, after trimming the
-- exact set of characters JS String.prototype.trim removes. For an address
-- whose trimmed form is ASCII, that equals the gateway's `normalizeEmail`
-- (`trim().toLowerCase()`) on every locale.

-- No SET search_path, on purpose: a function with one cannot be inlined, and
-- the gateway's filter on users.email_folded reaches the index below only
-- when both functions inline to the indexed expression. Every name in the
-- bodies is schema-qualified instead.
create or replace function public.sign_in_address_fold(p_address text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select pg_catalog.translate(
    pg_catalog.btrim(p_address, E' \t\n\r\f\013\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz')
$$;

comment on function public.sign_in_address_fold(text) is
  'The gateway''s normalizeEmail without the locale: trims what JS trim() trims, maps A-Z to a-z, leaves every other character alone. Immutable, so public.users is indexed on it.';

create index if not exists users_sign_in_address_fold_idx
  on public.users (public.sign_in_address_fold(email));

-- The gateway's third read: a PostgREST computed field, so
-- `.eq("email_folded", ...)` filters on the indexed fold without a new column
-- (select * does not return it). Only the gateway's service role may use it:
-- it answers whether an address has an account.
create or replace function public.email_folded(u public.users)
returns text
language sql
immutable
parallel safe
as $$
  select public.sign_in_address_fold(u.email::text)
$$;

comment on function public.email_folded(public.users) is
  'users.email folded by public.sign_in_address_fold: the computed field findUserBySignInAddress filters on to find an account the fold migration held unfolded.';

-- sign_in_address_fold keeps the default grant: it is pure arithmetic on its
-- argument, and the users index evaluates it for whoever writes a row.
revoke all on function public.email_folded(public.users) from public, anon, authenticated;
grant execute on function public.email_folded(public.users) to service_role;

-- The rows a person must resolve. Rebuilt by every run of the fold.
create table if not exists public.sign_in_addresses_held (
  user_id uuid primary key references public.users (user_id) on delete cascade,
  reason text not null check (reason in ('shared_address', 'non_ascii')),
  shared_with uuid[] not null default '{}',
  noted_at timestamptz not null default now()
);

comment on table public.sign_in_addresses_held is
  'Accounts migration a_sign_in_address_is_kept_in_lower_case did not fold. shared_address: another account holds the same folded address -- a person decides which keeps it. non_ascii: the folded address has a non-ASCII character. Rebuilt by public.fold_user_email_case(); no API role reads it.';

alter table public.sign_in_addresses_held enable row level security;
revoke all on table public.sign_in_addresses_held from public, anon, authenticated, service_role;

create or replace function public.fold_user_email_case()
returns table (folded integer, held_collision integer, held_non_ascii integer)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_folded integer := 0;
  v_collision integer := 0;
  v_non_ascii integer := 0;
begin
  delete from public.sign_in_addresses_held;

  -- Held: an unfolded row whose FOLDED address is not plain ASCII (QA round
  -- 13: look at what the fold returns, so a trailing no-break space is
  -- trimmed and folded, not held).
  insert into public.sign_in_addresses_held (user_id, reason)
  select u.user_id, 'non_ascii'
    from public.users u
   where u.email is distinct from public.sign_in_address_fold(u.email)
     and public.sign_in_address_fold(u.email) !~ '^[\x01-\x7f]*$';
  get diagnostics v_non_ascii = row_count;

  -- Held: an unfolded row whose folded address any other row shares.
  insert into public.sign_in_addresses_held (user_id, reason, shared_with)
  select c.user_id, 'shared_address',
         array_agg(o.user_id order by o.user_id)
    from public.users c
    join public.users o
      on o.user_id <> c.user_id
     and public.sign_in_address_fold(o.email) = public.sign_in_address_fold(c.email)
   where c.email is distinct from public.sign_in_address_fold(c.email)
     and public.sign_in_address_fold(c.email) ~ '^[\x01-\x7f]*$'
   group by c.user_id;
  get diagnostics v_collision = row_count;

  -- Folded: every other unfolded row. Each one's folded address is held by no
  -- other row, before or after, so the UNIQUE (email) constraint cannot fire.
  update public.users u
     set email = public.sign_in_address_fold(u.email)
   where u.email is distinct from public.sign_in_address_fold(u.email)
     and not exists (select 1 from public.sign_in_addresses_held h where h.user_id = u.user_id);
  get diagnostics v_folded = row_count;

  return query select v_folded, v_collision, v_non_ascii;
end;
$$;

comment on function public.fold_user_email_case() is
  'Folds public.users.email with public.sign_in_address_fold (the gateway''s normalizeEmail, locale-free). Never merges or deletes: a row whose folded address another row shares, or whose folded address is not ASCII, is left as is and listed in public.sign_in_addresses_held. Re-runnable.';

-- A maintenance tool, not an API: nobody but the owner runs it.
revoke all on function public.fold_user_email_case() from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  select * into r from public.fold_user_email_case();
  raise notice 'fold_user_email_case: % folded, % held for a shared address, % held for a non-ASCII character; the held rows are in public.sign_in_addresses_held',
    r.folded, r.held_collision, r.held_non_ascii;
end $$;
