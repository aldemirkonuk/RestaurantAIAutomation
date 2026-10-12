-- ADR 0340 rules 6, 9, 10, 12, 18 (lane 3b): a draft's sections are made
-- from its lines' categories with the house's layout carried over and its
-- confirmation NOT copied; every section edit is one function that logs one
-- menu_section_changes row; every lookup is the house's own (P0002 for a
-- foreign id); a live menu refuses category, kind and line edits and the
-- delete of a section with lines (55000);
-- a nested section moved to another kind lands at the target's top level.
-- Migration a_menu_section_is_edited_and_logged_in_one_step.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T1: materialise_menu_sections does not exist) and
-- PASS with it. One transaction, rolled back. SYNTHETIC fixtures.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('house2', gen_random_uuid()), ('owner', gen_random_uuid()),
  ('owner2', gen_random_uuid()), ('live', gen_random_uuid()), ('draft', gen_random_uuid()),
  ('upload', gen_random_uuid()), ('live_red', gen_random_uuid()), ('live_line', gen_random_uuid()),
  ('foreign_menu', gen_random_uuid()), ('foreign_section', gen_random_uuid()),
  ('foreign_line', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC sections ' || k, 'syn-se-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k in ('house', 'house2');
insert into public.users (user_id, email, name, restaurant_id, role)
select (select v from t_fx where k = u), 'syn-se-' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@x.test',
       'SYNTHETIC owner', (select v from t_fx where k = h), 'owner'
  from (values ('owner', 'house'), ('owner2', 'house2')) x(u, h);

-- The live Drinks menu, with the house's own "Our reds" at position 5,
-- confirmed by the owner, holding one line.
insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
values ((select v from t_fx where k = 'live'), (select v from t_fx where k = 'house'), 'SYNTHETIC live', 'beverage', 'active');
insert into public.menu_sections (id, restaurant_id, menu_id, parent_id, position, title, key, drink_category,
                                  confirmed_by, confirmed_at)
values ((select v from t_fx where k = 'live_red'), (select v from t_fx where k = 'house'),
        (select v from t_fx where k = 'live'), null, 5, 'Our reds', 'red', 'red',
        (select v from t_fx where k = 'owner'), now());
insert into public.menu_items (id, menu_id, restaurant_id, name, producer, vintage, category, bottle_price,
                               status, section_id, line_kind)
values ((select v from t_fx where k = 'live_line'), (select v from t_fx where k = 'live'),
        (select v from t_fx where k = 'house'), 'SYNTHETIC Gone red', 'SYNTHETIC producer', '2019', 'red', 60,
        'approved', (select v from t_fx where k = 'live_red'), 'drink');

-- The upload's Drinks draft: four lines, three distinct categories.
insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status, read_together_id)
values ((select v from t_fx where k = 'draft'), (select v from t_fx where k = 'house'), 'SYNTHETIC draft',
        'beverage', 'draft', (select v from t_fx where k = 'upload'));
insert into public.menu_items (menu_id, restaurant_id, name, category, bottle_price, status)
select (select v from t_fx where k = 'draft'), (select v from t_fx where k = 'house'), 'SYNTHETIC ' || n, c, 40, 'approved'
  from (values ('red one', 'Red'), ('red two', 'red'), ('beer one', 'Beer'), ('starter', 'Starters')) x(n, c);

-- A foreign house's menu, section and line.
insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
values ((select v from t_fx where k = 'foreign_menu'), (select v from t_fx where k = 'house2'), 'SYNTHETIC foreign',
        'beverage', 'draft');
insert into public.menu_sections (id, restaurant_id, menu_id, parent_id, position, title, key)
values ((select v from t_fx where k = 'foreign_section'), (select v from t_fx where k = 'house2'),
        (select v from t_fx where k = 'foreign_menu'), null, 0, 'SYNTHETIC foreign', 'foreign');
insert into public.menu_items (id, menu_id, restaurant_id, name, bottle_price, status)
values ((select v from t_fx where k = 'foreign_line'), (select v from t_fx where k = 'foreign_menu'),
        (select v from t_fx where k = 'house2'), 'SYNTHETIC foreign line', 40, 'approved');

create temporary table t_sec (k text primary key, v uuid) on commit drop;

-- T1 sections from the upload's categories; the house's layout carries over
-- by key; the confirmation does not; every line with a category is placed;
-- one 'create' row per section.
do $$
declare r jsonb; v_red record;
begin
  r := public.materialise_menu_sections((select v from t_fx where k = 'house'), (select v from t_fx where k = 'draft'),
                                        (select v from t_fx where k = 'owner'));
  if (r->>'sections')::int <> 3 or (r->>'inherited')::int <> 1 or (r->>'lines')::int <> 4 then
    raise exception 'T1 FAIL: %', r;
  end if;
  select * into v_red from public.menu_sections
   where menu_id = (select v from t_fx where k = 'draft') and key = 'red';
  if v_red.title <> 'Our reds' or v_red.position <> 5 or v_red.drink_category <> 'red'
     or v_red.inherited_from_section_id <> (select v from t_fx where k = 'live_red') then
    raise exception 'T1 FAIL: the layout did not carry over: %', row_to_json(v_red);
  end if;
  if v_red.confirmed_by is not null or v_red.confirmed_at is not null then
    raise exception 'T1 FAIL: the previous menu''s confirmation was copied';
  end if;
  if (select title from public.menu_sections
       where menu_id = (select v from t_fx where k = 'draft') and key = 'beer') <> 'Beers'
     or (select position from public.menu_sections
          where menu_id = (select v from t_fx where k = 'draft') and key = 'beer') <> 6 then
    raise exception 'T1 FAIL: a new section is not named from the vocabulary or not placed after the inherited one';
  end if;
  if (select count(*) from public.menu_section_changes
       where menu_id = (select v from t_fx where k = 'draft') and action = 'create') <> 3 then
    raise exception 'T1 FAIL: not one create row per section';
  end if;
  if exists (select 1 from public.menu_items
              where menu_id = (select v from t_fx where k = 'draft') and section_id is null) then
    raise exception 'T1 FAIL: a line with a category is Unsorted';
  end if;
  insert into t_sec select key, id from public.menu_sections where menu_id = (select v from t_fx where k = 'draft');
  -- Run again: nothing new, nothing doubled.
  r := public.materialise_menu_sections((select v from t_fx where k = 'house'), (select v from t_fx where k = 'draft'),
                                        (select v from t_fx where k = 'owner'));
  if (r->>'sections')::int <> 0 or (r->>'lines')::int <> 0 then
    raise exception 'T1 FAIL: a second run made sections again: %', r;
  end if;
end $$;

-- T2 every function answers a foreign id with P0002 and changes nothing.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  o uuid := (select v from t_fx where k = 'owner');
  fs uuid := (select v from t_fx where k = 'foreign_section');
  fm uuid := (select v from t_fx where k = 'foreign_menu');
  fl uuid := (select v from t_fx where k = 'foreign_line');
  n int := 0;
  before_n int := (select count(*) from public.menu_section_changes);
begin
  begin perform public.materialise_menu_sections(h, fm, o); exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.rename_menu_section(h, fs, 'x', o); exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.reparent_menu_section(h, fs, null, o); exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.reparent_menu_section(h, (select v from t_sec where k = 'beer'), fs, o);
  exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.delete_menu_section(h, fs, o); exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.move_menu_section_to_kind(h, fs, 'food', o); exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.set_menu_section_category(h, fs, 'red', o); exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.confirm_menu_section(h, fs, 'drink', null, o); exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.confirm_menu_line(h, fl, 'drink', null, o); exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.assign_menu_lines(h, fm, null, array[fl], o); exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.assign_menu_lines(h, (select v from t_fx where k = 'draft'), null, array[fl], o);
  exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.keep_gone_menu_line(h, fm, (select v from t_fx where k = 'live_line'), o);
  exception when sqlstate 'P0002' then n := n + 1; end;
  begin perform public.keep_gone_menu_line(h, (select v from t_fx where k = 'draft'), fl, o);
  exception when sqlstate 'P0002' then n := n + 1; end;
  if n <> 13 then
    raise exception 'T2 FAIL: % of 13 foreign lookups answered P0002', n;
  end if;
  if (select count(*) from public.menu_section_changes) <> before_n
     or (select title from public.menu_sections where id = fs) <> 'SYNTHETIC foreign' then
    raise exception 'T2 FAIL: a foreign lookup changed something';
  end if;
end $$;

-- T3 the live menu: a rename is presentation and is allowed (logged, key
-- kept); a category, a kind, a line move, a line kind and deleting a
-- section that holds lines are refused (55000).
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  o uuid := (select v from t_fx where k = 'owner');
  lr uuid := (select v from t_fx where k = 'live_red');
  n int := 0;
begin
  perform public.rename_menu_section(h, lr, 'Reds of the house', o);
  if (select title || '|' || key from public.menu_sections where id = lr) <> 'Reds of the house|red' then
    raise exception 'T3 FAIL: the live rename did not keep the key';
  end if;
  if not exists (select 1 from public.menu_section_changes
                  where section_id = lr and action = 'rename' and after->>'title' = 'Reds of the house') then
    raise exception 'T3 FAIL: the rename was not logged';
  end if;
  begin perform public.set_menu_section_category(h, lr, 'white', o); exception when sqlstate '55000' then n := n + 1; end;
  begin perform public.move_menu_section_to_kind(h, lr, 'food', o); exception when sqlstate '55000' then n := n + 1; end;
  begin perform public.confirm_menu_section(h, lr, 'dish', null, o); exception when sqlstate '55000' then n := n + 1; end;
  begin perform public.confirm_menu_line(h, (select v from t_fx where k = 'live_line'), 'dish', null, o);
  exception when sqlstate '55000' then n := n + 1; end;
  begin perform public.assign_menu_lines(h, (select v from t_fx where k = 'live'), null,
                                         array[(select v from t_fx where k = 'live_line')], o);
  exception when sqlstate '55000' then n := n + 1; end;
  begin perform public.delete_menu_section(h, lr, o); exception when sqlstate '55000' then n := n + 1; end;
  if n <> 6 then
    raise exception 'T3 FAIL: % of 6 live edits were refused', n;
  end if;
  if (select drink_category from public.menu_sections where id = lr) <> 'red'
     or (select section_id from public.menu_items where id = (select v from t_fx where k = 'live_line')) <> lr then
    raise exception 'T3 FAIL: a refused live edit changed something';
  end if;
end $$;

-- T4 reparent re-keys the subtree; a nested section moved to another kind
-- lands at the new draft's top level (parent NULL), the draft is made in the
-- same step, the lines follow, and the move is logged.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  o uuid := (select v from t_fx where k = 'owner');
  d uuid := (select v from t_fx where k = 'draft');
  wines jsonb; r jsonb; v_food uuid;
begin
  wines := public.add_menu_section(h, d, null, 'Wines', o);
  insert into t_sec values ('wines', (wines->>'id')::uuid);
  r := public.reparent_menu_section(h, (select v from t_sec where k = 'starters'), (wines->>'id')::uuid, o);
  if r->>'key' <> 'wines/starters' or (r->>'position')::int <> 0 then
    raise exception 'T4 FAIL: reparent: %', r;
  end if;
  r := public.move_menu_section_to_kind(h, (select v from t_sec where k = 'starters'), 'food', o);
  v_food := (r->>'menu_id')::uuid;
  if not (r->>'created_menu')::boolean or jsonb_array_length(r->'line_ids') <> 1 then
    raise exception 'T4 FAIL: move: %', r;
  end if;
  if (select menu_type || '|' || status || '|' || read_together_id::text from public.restaurant_menus where id = v_food)
     <> 'food|draft|' || (select v from t_fx where k = 'upload')::text then
    raise exception 'T4 FAIL: the target draft is not the upload''s Food draft';
  end if;
  if (select parent_id from public.menu_sections where id = (select v from t_sec where k = 'starters')) is not null
     or (select key from public.menu_sections where id = (select v from t_sec where k = 'starters')) <> 'starters' then
    raise exception 'T4 FAIL: the nested section kept its parent after the move';
  end if;
  if (select menu_id from public.menu_items where name = 'SYNTHETIC starter' and restaurant_id = h) <> v_food then
    raise exception 'T4 FAIL: the section''s line did not follow it';
  end if;
  if not exists (select 1 from public.menu_section_changes
                  where section_id = (select v from t_sec where k = 'starters') and action = 'move'
                    and menu_id = v_food) then
    raise exception 'T4 FAIL: the move was not logged';
  end if;
end $$;

-- T5 a dish confirmed on the Food draft takes its one price as `price`;
-- a section with subsections is not deleted; a deleted section's lines go
-- to Unsorted.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  o uuid := (select v from t_fx where k = 'owner');
  r jsonb; v_line record;
begin
  r := public.confirm_menu_section(h, (select v from t_sec where k = 'starters'), 'dish', null, o);
  if jsonb_array_length(r->'applied_line_ids') <> 1 or jsonb_array_length(r->'left_line_ids') <> 0 then
    raise exception 'T5 FAIL: confirm: %', r;
  end if;
  select * into v_line from public.menu_items where name = 'SYNTHETIC starter' and restaurant_id = h;
  if v_line.line_kind <> 'dish' or v_line.price <> 40 or v_line.bottle_price is not null or v_line.category is not null then
    raise exception 'T5 FAIL: the dish line: %', row_to_json(v_line);
  end if;
  begin
    perform public.add_menu_section(h, (select v from t_fx where k = 'draft'),
                                    (select v from t_sec where k = 'wines'), 'Turkey', o);
    perform public.delete_menu_section(h, (select v from t_sec where k = 'wines'), o);
    raise exception 'T5 FAIL: a section with subsections was deleted' using errcode = 'P0004';
  exception when sqlstate '55000' then null;
  end;
  r := public.delete_menu_section(h, (select v from t_sec where k = 'beer'), o);
  if (r->>'lines_to_unsorted')::int <> 1
     or (select section_id from public.menu_items where name = 'SYNTHETIC beer one' and restaurant_id = h) is not null then
    raise exception 'T5 FAIL: delete: %', r;
  end if;
end $$;

-- T6 keep a Gone line: the live line is copied into the draft into the
-- draft's section with the same key; keeping it twice is 23505.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  o uuid := (select v from t_fx where k = 'owner');
  d uuid := (select v from t_fx where k = 'draft');
  r jsonb;
begin
  r := public.keep_gone_menu_line(h, d, (select v from t_fx where k = 'live_line'), o);
  if (r->>'section_id')::uuid <> (select v from t_sec where k = 'red')
     or (select menu_id from public.menu_items where id = (r->>'line_id')::uuid) <> d
     or (select bottle_price from public.menu_items where id = (r->>'line_id')::uuid) <> 60 then
    raise exception 'T6 FAIL: keep: %', r;
  end if;
  if (select menu_id from public.menu_items where id = (select v from t_fx where k = 'live_line'))
     <> (select v from t_fx where k = 'live') then
    raise exception 'T6 FAIL: the live line moved';
  end if;
  begin
    perform public.keep_gone_menu_line(h, d, (select v from t_fx where k = 'live_line'), o);
    raise exception 'T6 FAIL: a line was kept twice' using errcode = 'P0004';
  exception when sqlstate '23505' then null;
  end;
end $$;

-- T7 every new function runs with the caller's rights and only the service
-- role may call it; the log takes the two new actions.
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.materialise_menu_sections(uuid, uuid, uuid)',
    'public.rename_menu_section(uuid, uuid, text, uuid)',
    'public.reparent_menu_section(uuid, uuid, uuid, uuid)',
    'public.delete_menu_section(uuid, uuid, uuid)',
    'public.move_menu_section_to_kind(uuid, uuid, text, uuid)',
    'public.set_menu_section_category(uuid, uuid, text, uuid)',
    'public.confirm_menu_section(uuid, uuid, text, text, uuid)',
    'public.confirm_menu_line(uuid, uuid, text, text, uuid)',
    'public.assign_menu_lines(uuid, uuid, uuid, uuid[], uuid)',
    'public.keep_gone_menu_line(uuid, uuid, uuid, uuid)'] loop
    if (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
      raise exception 'T7 FAIL: % is SECURITY DEFINER', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'T7 FAIL: % is callable by a client role', v_fn;
    end if;
  end loop;
  if not exists (select 1 from public.menu_section_changes
                  where restaurant_id = (select v from t_fx where k = 'house') and action = 'keep') then
    raise exception 'T7 FAIL: the keep was not logged';
  end if;
end $$;

rollback;
