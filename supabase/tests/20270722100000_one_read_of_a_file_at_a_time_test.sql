-- One read of one file at a time (migration one_read_of_a_file_at_a_time,
-- batch review of PR #1062). Self-asserting, one transaction, rolled back.
-- Must FAIL on a build without that migration (T1 inserts twice) and PASS
-- with it.

begin;

insert into public.restaurants (id, name, slug)
values ('a1062000-0000-4000-8000-000000000001', 'One read house', 'one-read-house');

-- A read under way of file "f1", no labels.
insert into public.restaurant_menus (id, restaurant_id, name, status, source_method, source_path, source_sha256, read_state)
values ('a1062000-0000-4000-8000-0000000000a1', 'a1062000-0000-4000-8000-000000000001', 'Wine List', 'draft', 'scan',
        'h/menus/f1.jpg', 'f1', 'reading');

-- T1 the same file, same (absent) labels, while the first is still reading: refused.
do $$
begin
  begin
    insert into public.restaurant_menus (restaurant_id, name, status, source_method, source_path, source_sha256, read_state)
    values ('a1062000-0000-4000-8000-000000000001', 'Wine List', 'draft', 'scan', 'h/menus/f1.jpg', 'f1', 'reading');
  exception when unique_violation then
    return;
  end;
  raise exception 'T1: a second read of the same file was kept while the first was reading';
end
$$;

-- T2 the same file for another day is its own read.
insert into public.restaurant_menus (restaurant_id, name, status, source_method, source_path, source_sha256, read_state, menu_date, menu_date_precision)
values ('a1062000-0000-4000-8000-000000000001', 'Wine List', 'draft', 'scan', 'h/menus/f1.jpg', 'f1', 'reading', date '2026-11-12', 'day');

-- T3 once the first read is done, the same file may be read again (readAgain).
update public.restaurant_menus set read_state = 'done' where id = 'a1062000-0000-4000-8000-0000000000a1';
insert into public.restaurant_menus (restaurant_id, name, status, source_method, source_path, source_sha256, read_state)
values ('a1062000-0000-4000-8000-000000000001', 'Wine List', 'draft', 'scan', 'h/menus/f1.jpg', 'f1', 'reading');

-- T4 another house reading the same bytes is not this house's read.
insert into public.restaurants (id, name, slug)
values ('a1062000-0000-4000-8000-000000000002', 'Other house', 'one-read-other-house');
insert into public.restaurant_menus (restaurant_id, name, status, source_method, source_path, source_sha256, read_state)
values ('a1062000-0000-4000-8000-000000000002', 'Wine List', 'draft', 'scan', 'o/menus/f1.jpg', 'f1', 'reading');

do $$ begin raise notice 'one_read_of_a_file_at_a_time: T1-T4 passed'; end $$;

rollback;
