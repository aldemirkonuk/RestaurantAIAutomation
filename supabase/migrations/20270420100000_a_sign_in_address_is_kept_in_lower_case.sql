-- A sign-in address is kept in lower case (QA round 11, R11-01).
--
-- Until this change `registerRestaurant` (auth.service.ts) stored the address
-- exactly as typed, while every door that looks an account up -- password
-- reset, the emailed sign-in code, Google, /sign-in-methods, registerAccount --
-- lower-cases and trims it first. An owner who registered as Chef@Bistro.com
-- therefore had a row no door could find: no reset, no code, no Google, and
-- the house was reachable only until the seven-day refresh token lapsed. The
-- service now folds the address before it checks or writes it; this migration
-- folds the rows that were written before.
--
-- What it changes: public.users.email only. auth.users is not touched -- it is
-- Supabase-managed, this codebase does not populate it for its own accounts,
-- and in production its ids are disjoint from public.users (measured
-- 2026-09-01, see order_line_capture_and_units).
--
-- What it never does: merge accounts. users.email is UNIQUE but case-sensitive,
-- so Chef@Bistro.com and chef@bistro.com can both exist today. A row whose
-- folded address is shared with any other row is left exactly as it is and
-- named in a WARNING (by user_id, never by address), for a person to resolve.
-- After that, `select * from public.fold_user_email_case()` folds what is left;
-- it is safe to run again and changes nothing that is already folded.
--
-- The fold is the gateway's: `normalizeEmail` is `trim().toLowerCase()`. Postgres
-- lower() agrees with that only for ASCII (a capital dotted I, for one, lowers
-- differently in JS), so an address with any non-ASCII character is also held
-- and named, not guessed at.

create or replace function public.fold_user_email_case()
returns table (folded integer, held_collision integer, held_non_ascii integer)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r record;
  v_folded integer := 0;
  v_collision integer := 0;
  v_non_ascii integer := 0;
begin
  -- Held: an unfolded address with a character outside printable ASCII.
  for r in
    select u.user_id from public.users u
     where u.email is distinct from lower(btrim(u.email, E' \t\n\r\f\013'))
       and u.email !~ '^[\x20-\x7e\t\n\r\f\v]*$'
     order by u.user_id
  loop
    v_non_ascii := v_non_ascii + 1;
    raise warning 'users.email not folded for user %: the address has a non-ASCII character; fold it by hand', r.user_id;
  end loop;

  -- Held: an unfolded address whose folded form any other row shares.
  for r in
    select c.user_id,
           string_agg(o.user_id::text, ', ' order by o.user_id) as others
      from public.users c
      join public.users o
        on o.user_id <> c.user_id
       and lower(btrim(o.email, E' \t\n\r\f\013')) = lower(btrim(c.email, E' \t\n\r\f\013'))
     where c.email is distinct from lower(btrim(c.email, E' \t\n\r\f\013'))
       and c.email ~ '^[\x20-\x7e\t\n\r\f\v]*$'
     group by c.user_id
     order by c.user_id
  loop
    v_collision := v_collision + 1;
    raise warning 'users.email not folded for user %: its lower-case address is shared with user(s) %; a person must decide which account keeps it', r.user_id, r.others;
  end loop;

  -- Folded: every other unfolded row. Each one's folded address is held by no
  -- other row, before or after, so the UNIQUE (email) constraint cannot fire.
  update public.users u
     set email = lower(btrim(u.email, E' \t\n\r\f\013'))
   where u.email is distinct from lower(btrim(u.email, E' \t\n\r\f\013'))
     and u.email ~ '^[\x20-\x7e\t\n\r\f\v]*$'
     and not exists (
       select 1 from public.users o
        where o.user_id <> u.user_id
          and lower(btrim(o.email, E' \t\n\r\f\013')) = lower(btrim(u.email, E' \t\n\r\f\013')));
  get diagnostics v_folded = row_count;

  return query select v_folded, v_collision, v_non_ascii;
end;
$$;

comment on function public.fold_user_email_case() is
  'Folds public.users.email to trim + lower case (the gateway''s normalizeEmail). Never merges: a row whose folded address another row shares, or that has a non-ASCII character, is left as is and named in a WARNING. Re-runnable.';

-- A maintenance tool, not an API: nobody but the owner runs it.
revoke all on function public.fold_user_email_case() from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  select * into r from public.fold_user_email_case();
  raise notice 'fold_user_email_case: % folded, % held for a shared address, % held for a non-ASCII character',
    r.folded, r.held_collision, r.held_non_ascii;
end $$;
