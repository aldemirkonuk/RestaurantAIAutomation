-- F-1624 remainder (wave 53 sim; ADR 0341): migration
-- a_house_keeps_each_tax_basis_answer keeps every answer a house gives to
-- whether its till prices include tax, append-only, written by the same
-- statement that changes restaurants.tax_basis.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid()), ('owner', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC answer-history house', 'syn-taxhist-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';
insert into public.users (user_id, email, name, role, restaurant_id)
select o.v, 'syn-taxhist-' || left(replace(o.v::text, '-', ''), 12) || '@example.invalid',
       'SYNTHETIC owner', 'owner', h.v
  from t_fx o, t_fx h where o.k = 'owner' and h.k = 'house';

-- T1: the history table exists, locked down (RLS on, no client grant).
do $$
begin
  if to_regclass('public.house_tax_basis_answers') is null then
    raise exception 'T1 FAIL: there is no house_tax_basis_answers table';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.house_tax_basis_answers'::regclass) then
    raise exception 'T1 FAIL: house_tax_basis_answers has RLS off';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_table_privilege('anon', 'public.house_tax_basis_answers', 'SELECT') then
    raise exception 'T1 FAIL: anon can read house_tax_basis_answers';
  end if;
end $$;

-- T2: include -> exclude -> include keeps three rows, in order, each with its
-- own moment; a repeat of the answer in force appends nothing.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  o uuid := (select v from t_fx where k = 'owner');
  got text[];
  n int;
begin
  update public.restaurants set tax_basis = 'prices_include_tax', tax_basis_confirmed_by = o,
         tax_basis_confirmed_at = '2026-10-03T09:00:00Z' where id = h;
  update public.restaurants set tax_basis = 'prices_exclude_tax', tax_basis_confirmed_by = o,
         tax_basis_confirmed_at = '2026-10-10T09:00:00Z' where id = h;
  update public.restaurants set tax_basis = 'prices_include_tax', tax_basis_confirmed_by = o,
         tax_basis_confirmed_at = '2026-10-20T09:00:00Z' where id = h;
  -- Not a change: another column on the row, and the same answer again.
  update public.restaurants set name = name where id = h;
  update public.restaurants set tax_basis = 'prices_include_tax' where id = h;

  select array_agg(basis || '@' || to_char(answered_at at time zone 'UTC', 'YYYY-MM-DD') order by answered_at)
    into got from public.house_tax_basis_answers where restaurant_id = h;
  if got is distinct from array['prices_include_tax@2026-10-03', 'prices_exclude_tax@2026-10-10', 'prices_include_tax@2026-10-20'] then
    raise exception 'T2 FAIL: the answers kept are %', got;
  end if;
  select count(*) into n from public.house_tax_basis_answers where restaurant_id = h and answered_by <> o;
  if n <> 0 then raise exception 'T2 FAIL: % answers name someone else', n; end if;
end $$;

-- T3: append-only: an answer kept cannot be edited or deleted.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  refused boolean;
begin
  refused := false;
  begin
    update public.house_tax_basis_answers set basis = 'not_vat_charging' where restaurant_id = h;
  exception when raise_exception then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: an answer kept was edited'; end if;

  refused := false;
  begin
    delete from public.house_tax_basis_answers where restaurant_id = h;
  exception when raise_exception then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: an answer kept was deleted'; end if;
end $$;

-- T4: only an answer is kept: a basis outside the three is refused.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  o uuid := (select v from t_fx where k = 'owner');
  refused boolean := false;
begin
  begin
    insert into public.house_tax_basis_answers (restaurant_id, basis, answered_by, answered_at)
    values (h, 'unset', o, now());
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T4 FAIL: "unset" was kept as an answer'; end if;
end $$;

rollback;
