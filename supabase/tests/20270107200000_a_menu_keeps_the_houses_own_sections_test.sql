-- ADR 0340 rules 6, 7, 10: a menu's own sections (at most three levels, no
-- cycle, a parent on the same menu, the printed heading kept), a section moved
-- only between drafts of one upload (its children and lines follow), a change
-- log that is never rewritten, and the exclusive dish/drink prices on a line.
-- Migration a_menu_keeps_the_houses_own_sections.
--
-- The back-fill runs inside the migration on rows that exist at deploy; it
-- is proved by the PGlite harness that seeds rows BEFORE that migration
-- (recorded in ADR 0340's Lane 1 note), not here: this file runs after it.
-- T1 pins the key it groups by.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (no menu_sections) and PASS with it. One
-- transaction, rolled back. SYNTHETIC fixtures only.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('house2', gen_random_uuid()), ('owner', gen_random_uuid()), ('batch', gen_random_uuid()),
  ('a', gen_random_uuid()), ('b', gen_random_uuid()), ('live', gen_random_uuid()), ('other', gen_random_uuid()),
  ('live2', gen_random_uuid()),
  ('wines', gen_random_uuid()), ('red', gen_random_uuid()), ('turkey', gen_random_uuid()), ('deep', gen_random_uuid()),
  ('beers', gen_random_uuid()), ('mains', gen_random_uuid()), ('live_s', gen_random_uuid()),
  ('line_red', gen_random_uuid()), ('line_tr', gen_random_uuid()), ('dish', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC sections ' || k, 'syn-sec-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'house2');
insert into public.users (user_id, email, name, restaurant_id, role)
select (select v from t_fx where k = 'owner'), 'syn-sec-' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@x.test',
       'SYNTHETIC owner', (select v from t_fx where k = 'house'), 'owner';

-- Two drafts read together (Drinks a, Food b), a live Food menu, a draft read
-- on its own, and a Desserts menu of the same upload already made live.
insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status, read_together_id)
select (select v from t_fx where k = m), (select v from t_fx where k = 'house'), 'SYNTHETIC ' || m, t, s,
       case when rt then (select v from t_fx where k = 'batch') end
  from (values ('a', 'beverage', 'draft', true), ('b', 'food', 'draft', true),
               ('live', 'food', 'active', false), ('other', 'desserts', 'draft', false),
               ('live2', 'desserts', 'active', true)) x(m, t, s, rt);

insert into public.menu_sections (id, restaurant_id, menu_id, parent_id, position, title, title_as_read, key)
select (select v from t_fx where k = s), (select v from t_fx where k = 'house'), (select v from t_fx where k = m),
       (select v from t_fx where k = p), pos, title, title, key
  from (values ('wines', 'a', null, 0, 'Wines', 'wines'),
               ('red', 'a', 'wines', 0, 'Red', 'wines/red'),
               ('turkey', 'a', 'red', 0, 'Turkey', 'wines/red/turkey'),
               ('beers', 'a', null, 1, 'Beers', 'beers'),
               ('mains', 'b', null, 0, 'Mains', 'mains'),
               ('live_s', 'live', null, 0, 'Starters', 'starters')) x(s, m, p, pos, title, key);

insert into public.menu_items (id, menu_id, restaurant_id, name, category, bottle_price, section_id, status)
select (select v from t_fx where k = l), (select v from t_fx where k = 'a'), (select v from t_fx where k = 'house'),
       'SYNTHETIC ' || l, 'red', 40, (select v from t_fx where k = s), 'approved'
  from (values ('line_red', 'red'), ('line_tr', 'turkey')) x(l, s);

-- T1 the key: "Red" and "red " are one key; dotted and dotless i agree.
do $$
begin
  if public.menu_section_key_part('Red') <> public.menu_section_key_part('red ') then
    raise exception 'T1 FAIL: "Red" and "red " are different keys';
  end if;
  if public.menu_section_key_part('KIRMIZI') <> public.menu_section_key_part('kırmızı') then
    raise exception 'T1 FAIL: KIRMIZI and kırmızı are different keys (%, %)',
      public.menu_section_key_part('KIRMIZI'), public.menu_section_key_part('kırmızı');
  end if;
  if public.menu_section_key_part(' -- ') <> '' then
    raise exception 'T1 FAIL: a heading with no letter or digit has a key';
  end if;
end $$;

-- T2 a fourth level is refused; so is a cycle; so is a parent on another menu.
do $$
begin
  begin
    insert into public.menu_sections (id, restaurant_id, menu_id, parent_id, position, title, key)
    select (select v from t_fx where k = 'deep'), (select v from t_fx where k = 'house'), (select v from t_fx where k = 'a'),
           (select v from t_fx where k = 'turkey'), 0, 'Ankara', 'wines/red/turkey/ankara';
    raise exception 'T2 FAIL: a fourth level was accepted' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    update public.menu_sections set parent_id = (select v from t_fx where k = 'red'), position = 5
     where id = (select v from t_fx where k = 'wines');
    raise exception 'T2 FAIL: a section was put inside its own subsection' using errcode = 'P0004';
  exception when check_violation then
    if sqlerrm not like '%inside itself%' then
      raise exception 'T2 FAIL: a cycle was refused for another reason: %', sqlerrm using errcode = 'P0004';
    end if;
  end;
  begin
    -- Wines carries two levels below it; under Beers that makes four.
    update public.menu_sections set parent_id = (select v from t_fx where k = 'beers'), position = 5
     where id = (select v from t_fx where k = 'wines');
    raise exception 'T2 FAIL: a subtree was moved four levels deep' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    insert into public.menu_sections (restaurant_id, menu_id, parent_id, position, title, key)
    select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'b'),
           (select v from t_fx where k = 'wines'), 0, 'Cross', 'wines/cross';
    raise exception 'T2 FAIL: a parent on another menu was accepted' using errcode = 'P0004';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.menu_sections (restaurant_id, menu_id, position, title, key)
    select (select v from t_fx where k = 'house2'), (select v from t_fx where k = 'a'), 9, 'Foreign', 'foreign';
    raise exception 'T2 FAIL: a section on another house''s menu was accepted' using errcode = 'P0004';
  exception when foreign_key_violation then null;
  end;
end $$;

-- T3 the printed heading is never rewritten; one key per menu; one section
-- per place once constraints are checked.
do $$
begin
  begin
    update public.menu_sections set title_as_read = 'Rouge' where id = (select v from t_fx where k = 'red');
    raise exception 'T3 FAIL: title_as_read was rewritten' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  update public.menu_sections set title = 'Reds' where id = (select v from t_fx where k = 'red');
  begin
    insert into public.menu_sections (restaurant_id, menu_id, position, title, key)
    select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'a'), 7, 'Wines again', 'wines';
    raise exception 'T3 FAIL: a second section with one key was accepted' using errcode = 'P0004';
  exception when unique_violation then null;
  end;
  -- A swap passes the deferred position check.
  update public.menu_sections set position = 1 where id = (select v from t_fx where k = 'wines');
  update public.menu_sections set position = 0 where id = (select v from t_fx where k = 'beers');
  set constraints public.menu_sections_one_section_per_place immediate;
  set constraints public.menu_sections_one_section_per_place deferred;
  begin
    update public.menu_sections set position = 0 where id = (select v from t_fx where k = 'wines');
    set constraints public.menu_sections_one_section_per_place immediate;
    raise exception 'T3 FAIL: two top-level sections in one place were accepted' using errcode = 'P0004';
  exception when unique_violation then null;
  end;
end $$;

-- T4 a section moves to another kind only between drafts of one upload.
do $$
begin
  begin
    update public.menu_sections set menu_id = (select v from t_fx where k = 'live')
     where id = (select v from t_fx where k = 'beers');
    raise exception 'T4 FAIL: a section moved onto a live menu' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
  begin
    update public.menu_sections set menu_id = (select v from t_fx where k = 'other')
     where id = (select v from t_fx where k = 'beers');
    raise exception 'T4 FAIL: a section moved to a draft of another upload' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
  begin
    update public.menu_sections set menu_id = (select v from t_fx where k = 'live2')
     where id = (select v from t_fx where k = 'beers');
    raise exception 'T4 FAIL: a section moved onto a live menu of its own upload' using errcode = 'P0004';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- T5 the move: Red (under Wines) goes to the Food draft, at the end of its
-- top level; Turkey and both lines follow; keys follow.
do $$
declare r record;
begin
  update public.menu_sections set menu_id = (select v from t_fx where k = 'b')
   where id = (select v from t_fx where k = 'red');
  select menu_id, parent_id, position, key into r from public.menu_sections where id = (select v from t_fx where k = 'red');
  if r.menu_id <> (select v from t_fx where k = 'b') or r.parent_id is not null or r.position <> 1 or r.key <> 'red' then
    raise exception 'T5 FAIL: the moved section is %', row_to_json(r);
  end if;
  select menu_id, parent_id, position, key into r from public.menu_sections where id = (select v from t_fx where k = 'turkey');
  if r.menu_id <> (select v from t_fx where k = 'b') or r.parent_id <> (select v from t_fx where k = 'red')
     or r.key <> 'red/turkey' then
    raise exception 'T5 FAIL: the child section is %', row_to_json(r);
  end if;
  if exists (select 1 from public.menu_items
              where id in ((select v from t_fx where k = 'line_red'), (select v from t_fx where k = 'line_tr'))
                and menu_id <> (select v from t_fx where k = 'b')) then
    raise exception 'T5 FAIL: a line stayed on the old menu';
  end if;
end $$;

-- T6 deleting a section sends its lines to Unsorted on the same menu; a
-- section with subsections cannot be deleted out from under them.
do $$
begin
  begin
    delete from public.menu_sections where id = (select v from t_fx where k = 'red');
    raise exception 'T6 FAIL: a section with a subsection was deleted' using errcode = 'P0004';
  exception when foreign_key_violation then null;
  end;
  delete from public.menu_sections where id = (select v from t_fx where k = 'turkey');
  if (select section_id is not null or menu_id <> (select v from t_fx where k = 'b')
        from public.menu_items where id = (select v from t_fx where k = 'line_tr')) then
    raise exception 'T6 FAIL: the line of a deleted section did not go to Unsorted on its menu';
  end if;
end $$;

-- T7 the change log is never rewritten; a house delete may still clear it.
do $$
declare v_id uuid;
begin
  insert into public.menu_section_changes (restaurant_id, menu_id, section_id, actor, action, after)
  select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'a'), (select v from t_fx where k = 'wines'),
         (select v from t_fx where k = 'owner'), 'rename', '{"title":"Wines"}'::jsonb
  returning id into v_id;
  begin
    update public.menu_section_changes set action = 'delete' where id = v_id;
    raise exception 'T7 FAIL: a change row was rewritten' using errcode = 'P0004';
  exception when restrict_violation then null;
  end;
  begin
    insert into public.menu_section_changes (restaurant_id, menu_id, actor, action)
    select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'a'), (select v from t_fx where k = 'owner'), 'tidy';
    raise exception 'T7 FAIL: an unknown action was logged' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  delete from public.menu_section_changes where id = v_id;
end $$;

-- T8 a dish has a price and no drink price or category; a drink no dish price.
do $$
begin
  insert into public.menu_items (id, menu_id, restaurant_id, name, line_kind, price, section_id, status)
  select (select v from t_fx where k = 'dish'), (select v from t_fx where k = 'b'), (select v from t_fx where k = 'house'),
         'SYNTHETIC Lamb', 'dish', 18.50, (select v from t_fx where k = 'mains'), 'approved';
  begin
    update public.menu_items set bottle_price = 30 where id = (select v from t_fx where k = 'dish');
    raise exception 'T8 FAIL: a dish took a bottle price' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    update public.menu_items set drink_category = 'red' where id = (select v from t_fx where k = 'dish');
    raise exception 'T8 FAIL: a dish took a drink category' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    update public.menu_items set price = 12 where id = (select v from t_fx where k = 'line_red');
    raise exception 'T8 FAIL: a drink line took a dish price' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    update public.menu_items set price = -1 where id = (select v from t_fx where k = 'dish');
    raise exception 'T8 FAIL: a negative dish price was accepted' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    update public.menu_items set line_kind = 'food' where id = (select v from t_fx where k = 'dish');
    raise exception 'T8 FAIL: an unknown line kind was accepted' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    update public.menu_items set drink_category = 'claret' where id = (select v from t_fx where k = 'line_red');
    raise exception 'T8 FAIL: a category outside the vocabulary was accepted' using errcode = 'P0004';
  exception when check_violation then null;
  end;
  begin
    update public.menu_items set section_id = (select v from t_fx where k = 'live_s')
     where id = (select v from t_fx where k = 'dish');
    raise exception 'T8 FAIL: a line joined a section of another menu' using errcode = 'P0004';
  exception when foreign_key_violation then null;
  end;
end $$;

-- T9 a client role holds nothing on either table.
do $$
begin
  if has_table_privilege('authenticated', 'public.menu_sections', 'SELECT')
     or has_table_privilege('authenticated', 'public.menu_section_changes', 'INSERT')
     or has_table_privilege('anon', 'public.menu_sections', 'SELECT') then
    raise exception 'T9 FAIL: a client role can reach a sections table';
  end if;
end $$;

-- T10 deleting a menu takes its sections and lines with it.
do $$
begin
  delete from public.restaurant_menus where id = (select v from t_fx where k = 'b');
  if exists (select 1 from public.menu_sections where menu_id = (select v from t_fx where k = 'b')) then
    raise exception 'T10 FAIL: a deleted menu left sections behind';
  end if;
end $$;

rollback;
