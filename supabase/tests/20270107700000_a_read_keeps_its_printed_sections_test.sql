-- ADR 0340 rules 12 and 14 (lane 5b): a draft read with its printed
-- sections keeps them nested as printed, with the heading as read and the
-- read's suggestion on the leaf; the house's layout carries over by key, its
-- confirmation does not; new sections follow the inherited ones in reading
-- order; one 'create' row per section; only this menu's listed lines are
-- placed; a path is cut to three levels; foreign, live and already-sectioned
-- menus are refused. Migration a_read_keeps_its_printed_sections.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T1: materialise_read_sections does not exist) and
-- PASS with it. One transaction, rolled back. SYNTHETIC fixtures.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('house2', gen_random_uuid()), ('owner', gen_random_uuid()),
  ('owner2', gen_random_uuid()), ('live', gen_random_uuid()), ('draft', gen_random_uuid()),
  ('deep', gen_random_uuid()), ('live_wines', gen_random_uuid()), ('foreign_menu', gen_random_uuid()),
  ('foreign_line', gen_random_uuid()), ('l1', gen_random_uuid()), ('l2', gen_random_uuid()),
  ('l3', gen_random_uuid()), ('l4', gen_random_uuid()), ('l5', gen_random_uuid()),
  ('d1', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC read sections ' || k, 'syn-rs-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'house2');
insert into public.users (user_id, email, name, restaurant_id, role)
select (select v from t_fx where k = u), 'syn-rs-' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@x.test',
       'SYNTHETIC owner', (select v from t_fx where k = h), 'owner'
  from (values ('owner', 'house'), ('owner2', 'house2')) x(u, h);

-- The live Drinks menu: the house's own "Our wines" at position 3, confirmed.
insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
values ((select v from t_fx where k = 'live'), (select v from t_fx where k = 'house'), 'SYNTHETIC live', 'beverage', 'active');
insert into public.menu_sections (id, restaurant_id, menu_id, parent_id, position, title, key, drink_category,
                                  confirmed_by, confirmed_at)
values ((select v from t_fx where k = 'live_wines'), (select v from t_fx where k = 'house'),
        (select v from t_fx where k = 'live'), null, 3, 'Our wines', 'wines', null,
        (select v from t_fx where k = 'owner'), now());

-- The read's Drinks draft and its five lines.
insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status, read_together_id)
values ((select v from t_fx where k = 'draft'), (select v from t_fx where k = 'house'), 'SYNTHETIC draft',
        'beverage', 'draft', gen_random_uuid()),
       ((select v from t_fx where k = 'deep'), (select v from t_fx where k = 'house'), 'SYNTHETIC deep draft',
        'beverage', 'draft', gen_random_uuid());
insert into public.menu_items (id, menu_id, restaurant_id, name, category, bottle_price, status)
select (select v from t_fx where k = l), (select v from t_fx where k = 'draft'), (select v from t_fx where k = 'house'),
       'SYNTHETIC ' || l, c, 40, 'approved'
  from (values ('l1', 'red'), ('l2', 'red'), ('l3', 'white'), ('l4', 'beer'), ('l5', null)) x(l, c);
insert into public.menu_items (id, menu_id, restaurant_id, name, bottle_price, status)
values ((select v from t_fx where k = 'd1'), (select v from t_fx where k = 'deep'),
        (select v from t_fx where k = 'house'), 'SYNTHETIC deep line', 40, 'approved');

-- A foreign house's draft and line.
insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
values ((select v from t_fx where k = 'foreign_menu'), (select v from t_fx where k = 'house2'), 'SYNTHETIC foreign',
        'beverage', 'draft');
insert into public.menu_items (id, menu_id, restaurant_id, name, bottle_price, status)
values ((select v from t_fx where k = 'foreign_line'), (select v from t_fx where k = 'foreign_menu'),
        (select v from t_fx where k = 'house2'), 'SYNTHETIC foreign line', 40, 'approved');

-- T1 the printed tree: "Wines" > "Red" and "White", then "Beers"; "Wines"
-- carries over by key (title and position, not the confirmation); "Red"
-- and "White" are new under it in reading order; "Beers" follows the
-- inherited top level; the suggestion sits on the leaf only; four lines
-- placed, the fifth (no section) left Unsorted, the foreign one untouched.
do $$
declare r jsonb; v_w record; v_red record; v_white record; v_beer record;
begin
  r := public.materialise_read_sections(
         (select v from t_fx where k = 'house'), (select v from t_fx where k = 'draft'),
         (select v from t_fx where k = 'owner'),
         jsonb_build_array(
           jsonb_build_object('path', jsonb_build_array('Wines', 'Red'), 'suggested_kind', 'beverage',
                              'suggested_category', 'red', 'suggested_by', 'rules',
                              'lines', jsonb_build_array((select v from t_fx where k = 'l1'),
                                                         (select v from t_fx where k = 'l2'),
                                                         (select v from t_fx where k = 'foreign_line'))),
           jsonb_build_object('path', jsonb_build_array('WINES ', 'White'), 'suggested_kind', 'beverage',
                              'suggested_category', 'not a token', 'suggested_by', 'read',
                              'lines', jsonb_build_array((select v from t_fx where k = 'l3'))),
           jsonb_build_object('path', jsonb_build_array('Beers'), 'suggested_kind', 'unknown',
                              'suggested_by', 'something else',
                              'lines', jsonb_build_array((select v from t_fx where k = 'l4')))));
  if (r->>'sections')::int <> 4 or (r->>'inherited')::int <> 1 or (r->>'lines')::int <> 4
     or (r->>'inherited_from_menu_id')::uuid <> (select v from t_fx where k = 'live') then
    raise exception 'T1 FAIL: %', r;
  end if;
  select * into v_w from public.menu_sections where menu_id = (select v from t_fx where k = 'draft') and key = 'wines';
  select * into v_red from public.menu_sections where menu_id = (select v from t_fx where k = 'draft') and key = 'wines/red';
  select * into v_white from public.menu_sections where menu_id = (select v from t_fx where k = 'draft') and key = 'wines/white';
  select * into v_beer from public.menu_sections where menu_id = (select v from t_fx where k = 'draft') and key = 'beers';
  if v_w.title <> 'Our wines' or v_w.position <> 3 or v_w.title_as_read <> 'Wines'
     or v_w.inherited_from_section_id <> (select v from t_fx where k = 'live_wines')
     or v_w.confirmed_by is not null or v_w.confirmed_at is not null or v_w.suggested_kind is not null then
    raise exception 'T1 FAIL: the inherited parent: %', row_to_json(v_w);
  end if;
  if v_red.parent_id <> v_w.id or v_red.title <> 'Red' or v_red.title_as_read <> 'Red' or v_red.position <> 0
     or v_red.suggested_kind <> 'beverage' or v_red.suggested_category <> 'red' or v_red.suggested_by <> 'rules'
     or v_red.drink_category is not null then
    raise exception 'T1 FAIL: the first child: %', row_to_json(v_red);
  end if;
  if v_white.parent_id <> v_w.id or v_white.position <> 1 or v_white.suggested_category is not null
     or v_white.suggested_by <> 'read' then
    raise exception 'T1 FAIL: the second child: %', row_to_json(v_white);
  end if;
  if v_beer.parent_id is not null or v_beer.position <> 4 or v_beer.suggested_kind <> 'unknown'
     or v_beer.suggested_by is not null then
    raise exception 'T1 FAIL: the new top-level section: %', row_to_json(v_beer);
  end if;
  if (select section_id from public.menu_items where id = (select v from t_fx where k = 'l1')) <> v_red.id
     or (select section_id from public.menu_items where id = (select v from t_fx where k = 'l3')) <> v_white.id
     or (select section_id from public.menu_items where id = (select v from t_fx where k = 'l4')) <> v_beer.id
     or (select section_id from public.menu_items where id = (select v from t_fx where k = 'l5')) is not null
     or (select section_id from public.menu_items where id = (select v from t_fx where k = 'foreign_line')) is not null then
    raise exception 'T1 FAIL: the lines were not placed as listed';
  end if;
  if (select count(*) from public.menu_section_changes
       where menu_id = (select v from t_fx where k = 'draft') and action = 'create'
         and after->>'source' = 'read') <> 4 then
    raise exception 'T1 FAIL: one create per section was not logged';
  end if;
end $$;

-- T2 refusals: no actor and a non-list are 22023; another house's menu is
-- P0002; a draft that already has sections and a live menu are 55000.
do $$
declare v_state text;
begin
  begin
    perform public.materialise_read_sections((select v from t_fx where k = 'house'),
      (select v from t_fx where k = 'deep'), null, '[]'::jsonb);
    raise exception 'T2 FAIL: no actor was accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '22023' then raise exception 'T2 FAIL: no actor gave %', v_state; end if;
  end;
  begin
    perform public.materialise_read_sections((select v from t_fx where k = 'house'),
      (select v from t_fx where k = 'deep'), (select v from t_fx where k = 'owner'), '{}'::jsonb);
    raise exception 'T2 FAIL: a non-list was accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '22023' then raise exception 'T2 FAIL: a non-list gave %', v_state; end if;
  end;
  begin
    perform public.materialise_read_sections((select v from t_fx where k = 'house'),
      (select v from t_fx where k = 'foreign_menu'), (select v from t_fx where k = 'owner'), '[]'::jsonb);
    raise exception 'T2 FAIL: a foreign menu was accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> 'P0002' then raise exception 'T2 FAIL: a foreign menu gave %', v_state; end if;
  end;
  begin
    perform public.materialise_read_sections((select v from t_fx where k = 'house'),
      (select v from t_fx where k = 'draft'), (select v from t_fx where k = 'owner'), '[]'::jsonb);
    raise exception 'T2 FAIL: a second materialise was accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '55000' then raise exception 'T2 FAIL: a second materialise gave %', v_state; end if;
  end;
  begin
    perform public.materialise_read_sections((select v from t_fx where k = 'house'),
      (select v from t_fx where k = 'live'), (select v from t_fx where k = 'owner'), '[]'::jsonb);
    raise exception 'T2 FAIL: a live menu was accepted';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '55000' then raise exception 'T2 FAIL: a live menu gave %', v_state; end if;
  end;
end $$;

-- T3 a four-level path is cut to three; a heading with no letter or digit
-- is skipped; the line lands on the third level.
do $$
declare r jsonb;
begin
  r := public.materialise_read_sections(
         (select v from t_fx where k = 'house'), (select v from t_fx where k = 'deep'),
         (select v from t_fx where k = 'owner'),
         jsonb_build_array(jsonb_build_object(
           'path', jsonb_build_array('Şaraplar', '—', 'Kırmızı', 'Türkiye', 'Trakya'),
           'lines', jsonb_build_array((select v from t_fx where k = 'd1')))));
  if (r->>'sections')::int <> 3 or (r->>'lines')::int <> 1 then
    raise exception 'T3 FAIL: %', r;
  end if;
  if (select s.key from public.menu_items mi join public.menu_sections s on s.id = mi.section_id
       where mi.id = (select v from t_fx where k = 'd1'))
     <> public.menu_section_key_part('Şaraplar') || '/' || public.menu_section_key_part('Kırmızı')
        || '/' || public.menu_section_key_part('Türkiye') then
    raise exception 'T3 FAIL: the line is not on the third level';
  end if;
end $$;

-- T4 the caller's rights; no client role may call it.
do $$
declare v_fn text := 'public.materialise_read_sections(uuid, uuid, uuid, jsonb)';
begin
  if (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
    raise exception 'T4 FAIL: % is SECURITY DEFINER', v_fn;
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'T4 FAIL: % is callable by a client role', v_fn;
  end if;
end $$;

rollback;
