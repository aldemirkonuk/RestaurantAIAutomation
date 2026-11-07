-- A table has a shape and no guessed seats (ADR 0347 D3, D4, D6; migration
-- 20270303140000_a_table_has_a_shape_and_no_guessed_seats.sql).
--
-- Run against a database built from supabase/migrations. Everything is inside
-- one transaction that is ROLLED BACK. One row per test: id, ok, detail.
-- Without the migration the first test errors (no floor_create_table), which
-- is the control.

begin;

create temp table _t (id text primary key, ok boolean, detail text) on commit drop;

do $$
declare h uuid; o uuid; r jsonb; t record;
begin
  insert into public.restaurants (name) values ('Twin house') returning id into h;
  insert into public.restaurants (name) values ('Other house') returning id into o;

  -- T1: a create with nothing but a name stores seats, outdoor, place and shape as NULL.
  r := public.floor_create_table(h, '  12 ');
  select * into t from public.restaurant_tables where id = (r -> 'table' ->> 'id')::uuid;
  insert into _t values ('T1', t.label = '12' and t.seats is null and t.is_outdoor is null
    and t.x_pos is null and t.y_pos is null and t.shape is null and t.learned_at is null,
    format('label=%s seats=%s outdoor=%s', t.label, t.seats, t.is_outdoor));

  -- T2: a plain INSERT that omits seats no longer gets 2 (the DEFAULT is gone).
  insert into public.restaurant_tables (restaurant_id, label) values (h, 'Bare') returning * into t;
  insert into _t values ('T2', t.seats is null and t.is_outdoor is null, format('seats=%s outdoor=%s', t.seats, t.is_outdoor));

  -- T3: the twin guard refuses the same word in another case, and "table N".
  r := public.floor_create_table(h, 'TABLE 12');
  insert into _t values ('T3a', r ->> 'error' = 'twin' and r ->> 'twin_label' = '12', r::text);
  r := public.floor_create_table(h, '12');
  insert into _t values ('T3b', r ->> 'error' = 'twin', r::text);

  -- T4: a till word, a remembered word and a former label all answer.
  update public.restaurant_tables set pos_refs = '{"simpos":"Masa 7"}' where label = 'Bare';
  r := public.floor_create_table(h, 'masa 7');
  insert into _t values ('T4a', r ->> 'error' = 'twin', r::text);
  update public.restaurant_tables set till_words = '{"square":["Patio"]}' where label = 'Bare';
  r := public.floor_create_table(h, 'patio');
  insert into _t values ('T4b', r ->> 'error' = 'twin', r::text);
  update public.restaurant_tables set former_labels = '{"Old 3"}' where label = 'Bare';
  r := public.floor_create_table(h, 'table old 3');
  insert into _t values ('T4c', r ->> 'error' = 'twin', r::text);

  -- T5: hidden and retired tables still answer.
  update public.restaurant_tables set is_active = false, hidden_at = now() where label = 'Bare';
  r := public.floor_create_table(h, 'Bare');
  insert into _t values ('T5', r ->> 'error' = 'twin', r::text);

  -- T6: another house's table is not a twin.
  r := public.floor_create_table(o, '12');
  insert into _t values ('T6', r ? 'table', r::text);

  -- T7: a rename check leaves the renamed table out.
  insert into _t values ('T7', not exists (
    select 1 from public.floor_table_twin(h, '12', (select id from public.restaurant_tables where restaurant_id = h and label = '12'))),
    'self is not a twin');

  -- T8: a blank or over-long name is refused before any write.
  r := public.floor_create_table(h, '   ');
  insert into _t values ('T8a', r ->> 'error' = 'bad_label', r::text);
  r := public.floor_create_table(h, repeat('x', 61));
  insert into _t values ('T8b', r ->> 'error' = 'bad_label', r::text);

  -- T9: shape takes round or rect only.
  begin
    update public.restaurant_tables set shape = 'oval' where restaurant_id = h and label = '12';
    insert into _t values ('T9', false, 'oval accepted');
  exception when check_violation then
    insert into _t values ('T9', true, 'oval refused');
  end;

  -- T10: a given seat count, place and shape are stored as given.
  r := public.floor_create_table(h, '14', 6, true, 10.5, 20, 'rect');
  insert into _t values ('T10', (r -> 'table' ->> 'seats')::int = 6 and (r -> 'table' ->> 'shape') = 'rect'
    and (r -> 'table' ->> 'x_pos')::numeric = 10.5, r::text);
end $$;

select id, ok, detail from _t order by id;

rollback;
