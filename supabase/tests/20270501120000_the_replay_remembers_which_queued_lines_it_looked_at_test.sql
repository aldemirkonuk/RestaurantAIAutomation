-- pos_unresolved_lines.replay_tried_at (QA round 15 on PR #866). Asserts the
-- gateway's replay order and stamp (pos-hub.service.ts readAll, sendToTheBack);
-- psql -v ON_ERROR_STOP=1, rolled back. Without the migration it fails at T1.
begin;
do $$ begin
  if current_setting('plpgsql.check_asserts') <> 'on' then raise exception 'asserts are off'; end if;
  assert exists (select 1 from information_schema.columns where table_name = 'pos_unresolved_lines'
    and column_name = 'replay_tried_at' and data_type = 'timestamp with time zone'
    and is_nullable = 'YES' and column_default is null), 'T1: replay_tried_at is missing or not a bare timestamptz';
end $$;
insert into public.restaurants (id, name) values ('c0990000-0000-4000-8000-000000000001', 'replay order test');
insert into public.pos_unresolved_lines
  (restaurant_id, source, external_check_id, external_item_id, item_name, created_at, resolved, replay_tried_at)
select 'c0990000-0000-4000-8000-000000000001', 'rt', c, 'w', 'Wine', t::timestamptz, r, s::timestamptz
from (values ('old-failing', '2026-10-01', false, '2026-11-07 10:00'), ('older-failing', '2026-09-01', false, '2026-11-07 11:00'),
             ('fresh', '2026-11-07 12:00', false, null), ('legacy', '2026-08-01', false, null),
             ('cleared', '2026-08-02', true, null)) v(c, t, r, s);
create temp view replay_order as select string_agg(external_check_id, ',' order by replay_tried_at asc nulls first, created_at, id) as got
  from public.pos_unresolved_lines where restaurant_id = 'c0990000-0000-4000-8000-000000000001' and not resolved;
do $$ begin assert (select got from replay_order) = 'legacy,fresh,old-failing,older-failing', 'T2: order before'; end $$;
update public.pos_unresolved_lines set replay_tried_at = '2026-11-07 13:00'
where restaurant_id = 'c0990000-0000-4000-8000-000000000001' and resolved = false and external_check_id in ('legacy', 'cleared');
do $$ begin
  assert (select got from replay_order) = 'fresh,old-failing,older-failing,legacy', 'T3: order after the stamp';
  assert (select replay_tried_at is null from public.pos_unresolved_lines where external_check_id = 'cleared'
    and restaurant_id = 'c0990000-0000-4000-8000-000000000001'), 'T3: the stamp reached a cleared row';
end $$;
rollback;
