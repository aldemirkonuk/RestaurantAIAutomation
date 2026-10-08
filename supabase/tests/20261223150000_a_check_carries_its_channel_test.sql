-- AW24 / A-050 (analytics walk on Tuzlu Rüzgar, 2026-10-03): the street-fair
-- booth's checks were scored as Kerem's table service, because pos_checks had
-- nowhere to say how a check was rung up. Migration
-- a_check_carries_its_channel adds pos_checks.channel: text, null, bounded by
-- the CHECK pos_checks_channel_known to 'table' and 'booth_event' (ADR 0302).
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run
-- it on a database built from supabase/migrations. It must FAIL on a build
-- without that migration (T1: there is no channel column) and PASS with it.
-- One transaction, rolled back: it leaves nothing behind.

begin;

-- T1 the column exists, is text, and is nullable.
do $$
declare
  t text;
  nn boolean;
begin
  select format_type(a.atttypid, a.atttypmod), a.attnotnull into t, nn
    from pg_attribute a
   where a.attrelid = 'public.pos_checks'::regclass
     and a.attname = 'channel' and not a.attisdropped;
  assert t = 'text', format('T1 FAIL pos_checks.channel is %s, expected text', coalesce(t, 'absent'));
  assert nn = false, 'T1 FAIL pos_checks.channel is NOT NULL; null must mean table service';
end $$;

-- T2 the bound is a validated CHECK naming exactly the two channels, and the
-- column says what it is for.
do $$
declare
  def text;
  cmt text;
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.pos_checks'::regclass
     and c.conname = 'pos_checks_channel_known'
     and c.contype = 'c' and c.convalidated;
  assert def is not null, 'T2 FAIL pos_checks_channel_known is missing or not validated';
  assert def ~ '''table''' and def ~ '''booth_event''',
    format('T2 FAIL the bound does not name table and booth_event: %s', def);
  select col_description('public.pos_checks'::regclass, a.attnum) into cmt
    from pg_attribute a
   where a.attrelid = 'public.pos_checks'::regclass and a.attname = 'channel';
  assert cmt ~ 'ADR 0302', format('T2 FAIL the column comment does not cite ADR 0302: %s', coalesce(cmt, 'none'));
end $$;

-- A house for the checks below. Ids are fixed and rolled back with the rest.
insert into public.restaurants (id, name, slug)
values ('a0240000-0000-4000-8000-000000000001', 'AW24 house', 'aw24-house-channel-test');

-- T3 the measured case: a booth check is stored with its channel, a table
-- check with 'table', and a check that names none with null.
do $$
declare
  n integer;
begin
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, server_name, total, tip, channel)
  values
    ('a0240000-0000-4000-8000-000000000001', 'csv_import', 'TR-2026-08-22-BOOTH', '2026-08-22 16:00+00', 'Kerem', 4201.10, 0, 'booth_event'),
    ('a0240000-0000-4000-8000-000000000001', 'csv_import', 'TR-T1', '2026-08-22 19:00+00', 'Kerem', 180.00, 24, 'table'),
    ('a0240000-0000-4000-8000-000000000001', 'csv_import', 'TR-T2', '2026-08-22 19:30+00', 'Kerem', 150.00, 20, null);
  select count(*) into n from public.pos_checks
   where restaurant_id = 'a0240000-0000-4000-8000-000000000001'
     and (  (external_check_id = 'TR-2026-08-22-BOOTH' and channel = 'booth_event')
         or (external_check_id = 'TR-T1' and channel = 'table')
         or (external_check_id = 'TR-T2' and channel is null));
  assert n = 3, format('T3 FAIL expected 3 checks stored with their channel, found %s', n);
end $$;

-- T4 a row written without naming the column reads null (table service): an
-- old gateway, or a feed that names no channel, still writes.
do $$
declare
  ch text;
begin
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at)
  values ('a0240000-0000-4000-8000-000000000001', 'clover', 'CL-1', '2026-08-23 12:00+00');
  select channel into ch from public.pos_checks
   where restaurant_id = 'a0240000-0000-4000-8000-000000000001' and external_check_id = 'CL-1';
  assert ch is null, format('T4 FAIL a row that named no channel reads %s, expected null', ch);
end $$;

-- T5 a channel outside the vocabulary is refused by the CHECK (23514): an
-- unmapped POS order type, and a spelling the gateway should have normalised.
do $$
declare
  v text;
  con text;
begin
  foreach v in array array['catering', 'Booth_Event', 'booth', ''] loop
    begin
      insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, channel)
      values ('a0240000-0000-4000-8000-000000000001', 'csv_import', 'TR-BAD-' || md5(v), '2026-08-23 12:00+00', v);
      raise exception 'T5 FAIL channel % was stored', quote_literal(v);
    exception when check_violation then
      get stacked diagnostics con = constraint_name;
      assert con = 'pos_checks_channel_known',
        format('T5 FAIL channel %s refused by %s, expected pos_checks_channel_known', quote_literal(v), con);
    end;
  end loop;
end $$;

-- T6 a re-post that names the channel corrects a stored check in place: the
-- ingest upserts on (restaurant_id, source, external_check_id).
do $$
declare
  ch text;
begin
  insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, channel)
  values ('a0240000-0000-4000-8000-000000000001', 'csv_import', 'TR-T2', '2026-08-22 19:30+00', 'booth_event')
  on conflict (restaurant_id, source, external_check_id) do update set channel = excluded.channel;
  select channel into ch from public.pos_checks
   where restaurant_id = 'a0240000-0000-4000-8000-000000000001' and external_check_id = 'TR-T2';
  assert ch = 'booth_event', format('T6 FAIL a re-post left channel %s, expected booth_event', coalesce(ch, 'null'));
end $$;

rollback;
