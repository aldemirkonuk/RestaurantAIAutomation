-- F-1612 = F-1623 (wave 53 sim; ADR 0341): a check whose net was not
-- recorded keeps the reason. Migration a_check_keeps_why_its_net_was_not_recorded
-- adds pos_checks.net_not_recorded_reason (one of six codes, only on a check
-- made pre-tax whose net is NULL).
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC net-reason house', 'syn-netwhy-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

-- T1: a check has a column to keep the reason in, with no default.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pos_checks'
       and column_name = 'net_not_recorded_reason' and column_default is null
  ) then
    raise exception 'T1 FAIL: pos_checks has no net_not_recorded_reason column (or it has a default)';
  end if;
end $$;

-- T2: each of the six reasons is kept on a pre-tax check with no net.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  why text;
  n int;
begin
  foreach why in array array['no_rate', 'tax_unread', 'tax_over_subtotal', 'no_zone', 'mixed_rates', 'tax_on_top'] loop
    insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, subtotal, gross_subtotal, tax_basis, net_not_recorded_reason)
    values (h, 'generic', 'zqwhy-' || why, now(), null, 118.00, 'prices_include_tax', why);
  end loop;
  select count(*) into n from public.pos_checks
   where restaurant_id = h and net_not_recorded_reason is not null;
  if n <> 6 then raise exception 'T2 FAIL: % of 6 reasons kept', n; end if;
end $$;

-- T3: a reason the build does not know, one on a check whose net was
-- recorded, and one on a check not made pre-tax are refused.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  refused boolean;
begin
  refused := false;
  begin
    insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, subtotal, gross_subtotal, tax_basis, net_not_recorded_reason)
    values (h, 'generic', 'zqwhy-x1', now(), null, 118.00, 'prices_include_tax', 'something_else');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: an unknown reason was kept'; end if;

  refused := false;
  begin
    insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, subtotal, gross_subtotal, tax_basis, net_not_recorded_reason)
    values (h, 'generic', 'zqwhy-x2', now(), 100.00, 118.00, 'prices_include_tax', 'no_rate');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a reason was kept on a check whose net was recorded'; end if;

  refused := false;
  begin
    insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, subtotal, gross_subtotal, tax_basis, net_not_recorded_reason)
    values (h, 'generic', 'zqwhy-x3', now(), null, 118.00, 'prices_exclude_tax', 'no_rate');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a reason was kept on a check not made pre-tax'; end if;
end $$;

-- T4: a check written as before carries no reason.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  r text;
begin
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, subtotal, total)
  values (h, 'generic', 'zqwhy-plain', now(), 100.00, 108.00);
  select net_not_recorded_reason into r from public.pos_checks
   where restaurant_id = h and external_check_id = 'zqwhy-plain';
  if r is not null then raise exception 'T4 FAIL: a plain check read back reason %', r; end if;
end $$;

rollback;
