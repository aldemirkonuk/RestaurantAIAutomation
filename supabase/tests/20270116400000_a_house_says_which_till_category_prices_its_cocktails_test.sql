-- F-1615 (sim-ledger S230/S232, integ F-1142): a house says which till
-- category prices its cocktails. Migration
-- a_house_says_which_till_category_prices_its_cocktails adds
-- public.restaurants.cocktail_tax_category with a trimmed 1..120 CHECK.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values ('house', gen_random_uuid());

-- T1: the column exists, is text, and carries no default.
do $$
declare
  t text;
  d text;
begin
  select data_type, column_default into t, d from information_schema.columns
   where table_schema = 'public' and table_name = 'restaurants'
     and column_name = 'cocktail_tax_category';
  if t is null then raise exception 'T1 FAIL: restaurants.cocktail_tax_category does not exist'; end if;
  if t <> 'text' then raise exception 'T1 FAIL: cocktail_tax_category is %, not text', t; end if;
  if d is not null then raise exception 'T1 FAIL: cocktail_tax_category carries a default (%)', d; end if;
end $$;

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC cocktail-category house', 'syn-cocktail-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

-- T2: a new house has chosen nothing; a trimmed name is kept and can be taken back.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  c text;
begin
  select cocktail_tax_category into c from public.restaurants where id = h;
  if c is not null then raise exception 'T2 FAIL: a new house reads category %', c; end if;
  update public.restaurants set cocktail_tax_category = 'Alkol' where id = h;
  select cocktail_tax_category into c from public.restaurants where id = h;
  if c is distinct from 'Alkol' then raise exception 'T2 FAIL: read back %', c; end if;
  update public.restaurants set cocktail_tax_category = null where id = h;
  select cocktail_tax_category into c from public.restaurants where id = h;
  if c is not null then raise exception 'T2 FAIL: taking the choice back left %', c; end if;
end $$;

-- T3: an untrimmed, empty or over-long name is refused.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  bad text;
  refused boolean;
begin
  foreach bad in array array[' Alkol', 'Alkol ', '', repeat('x', 121)] loop
    refused := false;
    begin
      update public.restaurants set cocktail_tax_category = bad where id = h;
    exception when check_violation then refused := true;
    end;
    if not refused then raise exception 'T3 FAIL: category % (length %) was recorded', quote_literal(bad), char_length(bad); end if;
  end loop;
end $$;

rollback;
