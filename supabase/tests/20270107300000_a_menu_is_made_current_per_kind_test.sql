-- ADR 0340 rules 2, 3, 4, 6, 13: making a menu current archives only the
-- live menu of ITS kind; already_current is per kind; a legacy kind is never
-- made live; the drafts of one upload go live together or not at all; a
-- carry that did not finish is never read as done; a section is added and
-- reordered by the server. Migration a_menu_is_made_current_per_kind.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T1: making Drinks current archives the live Food
-- menu) and PASS with it. One transaction, rolled back. SYNTHETIC fixtures.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('house2', gen_random_uuid()), ('owner', gen_random_uuid()),
  ('d1', gen_random_uuid()), ('f1', gen_random_uuid()), ('d2', gen_random_uuid()), ('f2', gen_random_uuid()),
  ('f3', gen_random_uuid()), ('s1', gen_random_uuid()), ('bar', gen_random_uuid()), ('d3', gen_random_uuid()),
  ('foreign', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC per-kind ' || k, 'syn-pk-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'house2');
insert into public.users (user_id, email, name, restaurant_id, role)
select (select v from t_fx where k = 'owner'), 'syn-pk-' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@x.test',
       'SYNTHETIC owner', (select v from t_fx where k = 'house'), 'owner';

-- Live Drinks d1 and live Food f1; drafts d2 (Drinks), f2 (Food, empty),
-- f3 (Food), s1 (Desserts), d3 (Drinks) and a legacy 'bar' draft.
insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
select (select v from t_fx where k = m), (select v from t_fx where k = h), 'SYNTHETIC ' || m, t, s
  from (values ('d1', 'house', 'beverage', 'active'), ('f1', 'house', 'food', 'active'),
               ('d2', 'house', 'beverage', 'draft'), ('f2', 'house', 'food', 'draft'),
               ('f3', 'house', 'food', 'draft'), ('s1', 'house', 'desserts', 'draft'),
               ('d3', 'house', 'beverage', 'draft'), ('bar', 'house', 'bar', 'draft'),
               ('foreign', 'house2', 'desserts', 'draft')) x(m, h, t, s);

insert into public.menu_items (menu_id, restaurant_id, name, bottle_price, status)
select (select v from t_fx where k = m), (select v from t_fx where k = h), 'SYNTHETIC line ' || m, 40, 'approved'
  from (values ('d1', 'house'), ('f1', 'house'), ('d2', 'house'), ('f3', 'house'), ('s1', 'house'),
               ('d3', 'house'), ('bar', 'house'), ('foreign', 'house2')) x(m, h);

-- T1 making Drinks current archives only the live Drinks menu.
do $$
declare r jsonb;
begin
  r := public.make_menu_current((select v from t_fx where k = 'house'), (select v from t_fx where k = 'd2'),
                                (select v from t_fx where k = 'owner'));
  if r->>'outcome' <> 'made_current' or r->'carried_at' <> 'null'::jsonb
     or r->'previous_menu_ids' <> to_jsonb(array[(select v from t_fx where k = 'd1')]) then
    raise exception 'T1 FAIL: %', r;
  end if;
  if (select status from public.restaurant_menus where id = (select v from t_fx where k = 'f1')) <> 'active' then
    raise exception 'T1 FAIL: making Drinks current archived the live Food menu';
  end if;
  if (select status from public.restaurant_menus where id = (select v from t_fx where k = 'd1')) <> 'archived' then
    raise exception 'T1 FAIL: the old Drinks menu is still live';
  end if;
end $$;

-- T2 already_current is per kind: the live Food menu, beside a live Drinks
-- menu, is already current. A carry that did not finish (carried_at NULL)
-- is answered as such, so a retry may run it.
do $$
declare r jsonb;
begin
  r := public.make_menu_current((select v from t_fx where k = 'house'), (select v from t_fx where k = 'f1'),
                                (select v from t_fx where k = 'owner'));
  if r->>'outcome' <> 'already_current' or r->'carried_at' <> 'null'::jsonb then
    raise exception 'T2 FAIL: %', r;
  end if;
  if (select status from public.restaurant_menus where id = (select v from t_fx where k = 'd2')) <> 'active' then
    raise exception 'T2 FAIL: re-choosing Food archived the live Drinks menu';
  end if;
end $$;

-- T3 a legacy kind is never made live, by either function.
do $$
begin
  begin
    perform public.make_menu_current((select v from t_fx where k = 'house'), (select v from t_fx where k = 'bar'),
                                     (select v from t_fx where k = 'owner'));
    raise exception 'T3 FAIL: a legacy bar menu was made current' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.make_menus_current((select v from t_fx where k = 'house'),
                                      array[(select v from t_fx where k = 'bar')], (select v from t_fx where k = 'owner'));
    raise exception 'T3 FAIL: a legacy bar menu was made current in a batch' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- T4 the batch is all or nothing: an empty Food draft stops the Desserts one.
do $$
begin
  begin
    perform public.make_menus_current((select v from t_fx where k = 'house'),
      array[(select v from t_fx where k = 's1'), (select v from t_fx where k = 'f2')], (select v from t_fx where k = 'owner'));
    raise exception 'T4 FAIL: a batch with an empty menu went live' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
  if (select status from public.restaurant_menus where id = (select v from t_fx where k = 's1')) <> 'draft' then
    raise exception 'T4 FAIL: half the batch went live';
  end if;
end $$;

-- T5 a batch naming one kind twice, an empty list, a NULL id, a menu of
-- another house: refused.
do $$
begin
  begin
    perform public.make_menus_current((select v from t_fx where k = 'house'),
      array[(select v from t_fx where k = 'd3'), (select v from t_fx where k = 'd1')], (select v from t_fx where k = 'owner'));
    raise exception 'T5 FAIL: two Drinks menus went live together' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.make_menus_current((select v from t_fx where k = 'house'), array[]::uuid[], (select v from t_fx where k = 'owner'));
    raise exception 'T5 FAIL: an empty batch was accepted' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.make_menus_current((select v from t_fx where k = 'house'),
      array[(select v from t_fx where k = 's1'), null], (select v from t_fx where k = 'owner'));
    raise exception 'T5 FAIL: a NULL id was accepted' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.make_menus_current((select v from t_fx where k = 'house'),
      array[(select v from t_fx where k = 'foreign')], (select v from t_fx where k = 'owner'));
    raise exception 'T5 FAIL: another house''s menu went live' using errcode = 'P0004';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

-- T6 Desserts and Food go live together with one moment; Drinks stays.
do $$
declare r jsonb;
begin
  r := public.make_menus_current((select v from t_fx where k = 'house'),
    array[(select v from t_fx where k = 's1'), (select v from t_fx where k = 'f3')], (select v from t_fx where k = 'owner'));
  if jsonb_array_length(r->'menus') <> 2
     or exists (select 1 from jsonb_array_elements(r->'menus') e where e->>'outcome' <> 'made_current') then
    raise exception 'T6 FAIL: %', r;
  end if;
  if (select count(DISTINCT made_current_at) from public.restaurant_menus
       where id in ((select v from t_fx where k = 's1'), (select v from t_fx where k = 'f3'))) <> 1 then
    raise exception 'T6 FAIL: the batch went live at two moments';
  end if;
  if (select status from public.restaurant_menus where id = (select v from t_fx where k = 'f1')) <> 'archived'
     or (select status from public.restaurant_menus where id = (select v from t_fx where k = 'd2')) <> 'active' then
    raise exception 'T6 FAIL: the batch archived the wrong menus';
  end if;
end $$;

-- T7 a finished carry is cleared when a menu is made current again.
do $$
begin
  update public.restaurant_menus set carried_at = now() where id = (select v from t_fx where k = 'd2');
  perform public.make_menu_current((select v from t_fx where k = 'house'), (select v from t_fx where k = 'd1'),
                                   (select v from t_fx where k = 'owner'));
  perform public.make_menu_current((select v from t_fx where k = 'house'), (select v from t_fx where k = 'd2'),
                                   (select v from t_fx where k = 'owner'));
  if (select carried_at from public.restaurant_menus where id = (select v from t_fx where k = 'd2')) is not null then
    raise exception 'T7 FAIL: a new activation kept the old carry''s date';
  end if;
end $$;

-- T8 add_menu_section: the server keys and places the section, logs it,
-- and refuses a duplicate, an empty heading and a fourth level.
do $$
declare
  w jsonb; r jsonb; t jsonb;
  m uuid := (select v from t_fx where k = 'd3');
  h uuid := (select v from t_fx where k = 'house');
  o uuid := (select v from t_fx where k = 'owner');
begin
  w := public.add_menu_section(h, m, null, 'Wines', o);
  r := public.add_menu_section(h, m, (w->>'id')::uuid, 'Red', o, 'red', 'KIRMIZI');
  if r->>'key' <> 'wines/kirmizi' or (r->>'position')::int <> 0 then
    raise exception 'T8 FAIL: %', r;
  end if;
  if (public.add_menu_section(h, m, null, 'Beers', o)->>'position')::int <> 1 then
    raise exception 'T8 FAIL: a second top-level section was not placed last';
  end if;
  begin
    perform public.add_menu_section(h, m, (w->>'id')::uuid, 'Red', o, null, 'kırmızı ');
    raise exception 'T8 FAIL: a duplicate heading was added' using errcode = 'P0004';
  exception when unique_violation then null;
  end;
  begin
    perform public.add_menu_section(h, m, null, ' -- ', o);
    raise exception 'T8 FAIL: an empty heading was added' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
  t := public.add_menu_section(h, m, (r->>'id')::uuid, 'Turkey', o);
  begin
    perform public.add_menu_section(h, m, (t->>'id')::uuid, 'Ankara', o);
    raise exception 'T8 FAIL: a fourth level was added' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    perform public.add_menu_section(h, (select v from t_fx where k = 'foreign'), null, 'Cakes', o);
    raise exception 'T8 FAIL: a section was added to another house''s menu' using errcode = 'P0004';
  exception when sqlstate 'P0002' then null;
  end;
  if (select count(*) from public.menu_section_changes where menu_id = m and action = 'create') <> 4 then
    raise exception 'T8 FAIL: the adds were not each logged';
  end if;
end $$;

-- T9 reorder_menu_sections: exactly the siblings, or 409; a foreign id, 404.
do $$
declare
  m uuid := (select v from t_fx where k = 'd3');
  h uuid := (select v from t_fx where k = 'house');
  o uuid := (select v from t_fx where k = 'owner');
  w uuid := (select id from public.menu_sections where menu_id = (select v from t_fx where k = 'd3') and key = 'wines');
  b uuid := (select id from public.menu_sections where menu_id = (select v from t_fx where k = 'd3') and key = 'beers');
  x uuid;
begin
  perform public.reorder_menu_sections(h, m, null, array[b, w], o);
  if (select position from public.menu_sections where id = b) <> 0
     or (select position from public.menu_sections where id = w) <> 1 then
    raise exception 'T9 FAIL: the order was not applied';
  end if;
  set constraints public.menu_sections_one_section_per_place immediate;
  set constraints public.menu_sections_one_section_per_place deferred;
  begin
    perform public.reorder_menu_sections(h, m, null, array[b], o);
    raise exception 'T9 FAIL: an order missing a sibling was applied' using errcode = 'P0004';
  exception when sqlstate '40001' then null;
  end;
  begin
    perform public.reorder_menu_sections(h, m, null, array[b, w, b], o);
    raise exception 'T9 FAIL: an order naming a section twice was applied' using errcode = 'P0004';
  exception when sqlstate '40001' then null;
  end;
  insert into public.menu_sections (restaurant_id, menu_id, position, title, key)
  values ((select v from t_fx where k = 'house2'), (select v from t_fx where k = 'foreign'), 0, 'Cakes', 'cakes')
  returning id into x;
  begin
    perform public.reorder_menu_sections(h, m, null, array[b, w, x], o);
    raise exception 'T9 FAIL: another house''s section was ordered' using errcode = 'P0004';
  exception when sqlstate 'P0002' then null;
  end;
  if (select count(*) from public.menu_section_changes where menu_id = m and action = 'reorder') <> 1 then
    raise exception 'T9 FAIL: the reorder was not logged once';
  end if;
end $$;

-- T10 no client role may run any of the four.
do $$
begin
  if has_function_privilege('authenticated', 'public.make_menus_current(uuid, uuid[], uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.add_menu_section(uuid, uuid, uuid, text, uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reorder_menu_sections(uuid, uuid, uuid, uuid[], uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.make_menu_current(uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'T10 FAIL: a client role can run a menu act';
  end if;
end $$;

rollback;
