-- Migration a_menu_line_keeps_its_printed_page (r110 menu-g4).
-- Self-asserting; run with `psql -v ON_ERROR_STOP=1 -f` on a database built
-- from supabase/migrations (pgtest.sh lane). Only the column's check is
-- exercised, against the catalog and a throwaway table of the same shape, so
-- no menu_items fixture (and none of its foreign keys) is needed.

begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'plpgsql.check_asserts is off'; end if;
end $$;

create function pg_temp.sql_refused(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'none';
exception when others then
  return sqlstate;
end $$;

do $$
declare def text; typ text;
begin
  select format_type(a.atttypid, a.atttypmod) into typ
    from pg_attribute a
   where a.attrelid = 'public.menu_items'::regclass and a.attname = 'printed_page' and not a.attisdropped;
  assert typ = 'smallint', format('printed_page is %s, not smallint', typ);

  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.menu_items'::regclass and c.conname = 'menu_items_printed_page_is_a_page';
  assert def is not null, 'the printed_page check is missing';

  -- The same check on a temp table, so 0, 1, 200, 201 and NULL are tried as written.
  execute format('create temp table pp (printed_page smallint, constraint pp_check %s)', def);
  assert pg_temp.sql_refused('insert into pp values (0)') = '23514', 'page 0 must be refused';
  assert pg_temp.sql_refused('insert into pp values (201)') = '23514', 'page 201 must be refused';
  assert pg_temp.sql_refused('insert into pp values (-3)') = '23514', 'a negative page must be refused';
  assert pg_temp.sql_refused('insert into pp values (1)') = 'none', 'page 1 must be kept';
  assert pg_temp.sql_refused('insert into pp values (200)') = 'none', 'page 200 must be kept';
  assert pg_temp.sql_refused('insert into pp values (null)') = 'none', 'no page must be kept';
end $$;

rollback;
