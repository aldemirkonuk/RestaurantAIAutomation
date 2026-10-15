-- F-1706 / F-1720 / F-1721 / F-1725 (wave 113, sim-ledger S242-S244).
-- Migration an_invoice_is_paid_once_as_one_bill: a "paid" marking keeps when
-- it was recorded, copies of one invoice are paid as one bill, one payment
-- can be taken back, and a payment sent twice with one key is recorded once.
--
-- Self-asserting: every block raises on a failure, so the harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration and PASS with it. One transaction, rolled
-- back. All fixtures are SYNTHETIC, keyed by fresh uuids; money in TRY.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('vendor', gen_random_uuid()),
  ('nototal', gen_random_uuid()),
  ('copy_a', gen_random_uuid()), ('copy_b', gen_random_uuid()),
  ('old_a', gen_random_uuid()), ('old_b', gen_random_uuid()),
  ('keyed', gen_random_uuid()), ('twice', gen_random_uuid());

insert into public.restaurants (id, name, slug, timezone)
select v, 'SYNTHETIC one-bill house', 'syn-bill-' || left(replace(v::text, '-', ''), 16), 'Europe/Istanbul'
  from t_fx where k = 'house';

insert into public.providers (id, restaurant_id, name, primary_contact)
select v, (select v from t_fx where k = 'house'), 'SYNTHETIC vendor', '{}'::jsonb
  from t_fx where k = 'vendor';

insert into public.procurement_documents (id, restaurant_id, provider_id, doc_type, doc_number, status, total, currency, source_channel, created_at)
select f.v, (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor'), 'invoice', x.num, x.status, x.total, 'TRY', 'manual', now() - x.age
  from (values
    ('nototal', 'SYN-NT-1',  'received', null::numeric, interval '0'),
    ('copy_a',  'SYN-CP-7',  'verified', 1000,          interval '2 days'),
    ('copy_b',  'syn-cp-7 ', 'received', 1000,          interval '1 day'),
    ('old_a',   'SYN-OLD-3', 'verified', 500,           interval '2 days'),
    ('old_b',   'syn-old-3', 'received', 500,           interval '1 day'),
    ('keyed',   'SYN-KEY-1', 'verified', 900,           interval '0'),
    ('twice',   'SYN-TW-1',  'verified', 800,           interval '0')
  ) as x(k, num, status, total, age)
  join t_fx f on f.k = x.k;

-- T1 (F-1706): a no-total invoice marked paid 90 days back keeps when it was SAID.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'nototal');
  pa timestamptz;
  pm timestamptz;
begin
  perform public.record_invoice_payment(h, i, null, current_date - 90, 'restaurant', null, null);
  select paid_at, paid_marked_at into pa, pm from public.procurement_documents where id = i;
  if pa is null or pa > now() - interval '80 days' then
    raise exception 'T1 FAIL: the day it was paid was not kept as said (%)', pa;
  end if;
  if pm is null or pm < now() - interval '1 minute' then
    raise exception 'T1 FAIL: when the marking was recorded was not kept (%)', pm;
  end if;
end $$;

-- T2 (F-1720): a payment on one copy counts for the other; the bill is paid once.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  a uuid := (select v from t_fx where k = 'copy_a');
  b uuid := (select v from t_fx where k = 'copy_b');
  r jsonb;
  refused boolean := false;
begin
  perform public.record_invoice_payment(h, a, 600, current_date, 'restaurant', null, null);
  begin
    perform public.record_invoice_payment(h, b, 600, current_date, 'restaurant', null, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T2 FAIL: the second copy took 600 more on a 1000 bill already paid 600'; end if;
  r := public.record_invoice_payment(h, b, null, current_date, 'restaurant', null, null);
  if (r->>'paid')::numeric <> 1000 or (r->>'left')::numeric <> 0 then
    raise exception 'T2 FAIL: paying what is left on the copy did not settle the bill (%)', r;
  end if;
  if (select count(*) from public.procurement_documents where id in (a, b) and paid_at is not null) <> 2 then
    raise exception 'T2 FAIL: the bill is paid but not every copy reads paid';
  end if;
end $$;

-- T3 (F-1720): a copy marked paid with no payment kept refuses a payment on its twin.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  a uuid := (select v from t_fx where k = 'old_a');
  b uuid := (select v from t_fx where k = 'old_b');
  refused boolean := false;
begin
  update public.procurement_documents set paid_at = now() - interval '5 days', paid_by = 'restaurant' where id = a;
  begin
    perform public.record_invoice_payment(h, b, 200, current_date, 'restaurant', null, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a payment was taken on a copy whose twin is marked paid in full'; end if;
end $$;

-- T4 (F-1725): the same key twice records one payment.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'keyed');
  r jsonb;
begin
  perform public.record_invoice_payment(h, i, 300, current_date, 'restaurant', null, null, 'syn-key-0001');
  r := public.record_invoice_payment(h, i, 300, current_date, 'restaurant', null, null, 'syn-key-0001');
  if (select count(*) from public.procurement_invoice_payments where invoice_id = i) <> 1 then
    raise exception 'T4 FAIL: a retried payment was recorded twice';
  end if;
  if coalesce((r->>'replayed')::boolean, false) is not true or (r->>'left')::numeric <> 600 then
    raise exception 'T4 FAIL: the retry did not say what was recorded (%)', r;
  end if;
end $$;

-- T5 (F-1721): one payment taken back; the other stays and the bill is not paid.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'twice');
  first_id uuid;
  r jsonb;
  refused boolean := false;
begin
  perform public.record_invoice_payment(h, i, 300, current_date - 3, 'restaurant', null, null);
  perform public.record_invoice_payment(h, i, 500, current_date, 'restaurant', null, null);
  if (select paid_at from public.procurement_documents where id = i) is null then
    raise exception 'T5 FAIL: setup, 800 of 800 did not read paid';
  end if;
  select id into first_id from public.procurement_invoice_payments where invoice_id = i and amount = 500;
  r := public.remove_invoice_payment(h, i, first_id);
  if (r->>'left')::numeric <> 500 or (r->'removed'->>'amount')::numeric <> 500 then
    raise exception 'T5 FAIL: taking back 500 did not leave 500 to pay (%)', r;
  end if;
  if (select count(*) from public.procurement_invoice_payments where invoice_id = i) <> 1 then
    raise exception 'T5 FAIL: taking one payment back removed the others too';
  end if;
  if (select paid_at from public.procurement_documents where id = i) is not null then
    raise exception 'T5 FAIL: the bill still reads paid with 500 left';
  end if;
  begin
    perform public.remove_invoice_payment(h, i, first_id);
  exception when no_data_found then refused := true;
  end;
  if not refused then raise exception 'T5 FAIL: the same payment was taken back twice'; end if;
end $$;

-- T6 (F-1720): "mark not paid" on one copy clears the whole bill.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  a uuid := (select v from t_fx where k = 'copy_a');
  b uuid := (select v from t_fx where k = 'copy_b');
  gone jsonb;
begin
  gone := public.clear_invoice_payments(h, b);
  if jsonb_array_length(gone) <> 2 then
    raise exception 'T6 FAIL: mark not paid on one copy returned % payment(s), not the bill''s 2', jsonb_array_length(gone);
  end if;
  if exists (select 1 from public.procurement_documents where id in (a, b) and paid_at is not null) then
    raise exception 'T6 FAIL: a copy still reads paid after the bill was marked not paid';
  end if;
end $$;

rollback;
