-- F-1672 / F-1674 (sim-ledger S235/S236): an invoice keeps each payment made
-- on it and the credit note a payment used. Migration
-- an_invoice_keeps_each_payment_and_the_credit_it_used adds
-- public.procurement_invoice_payments, record_invoice_payment and
-- clear_invoice_payments.
--
-- Self-asserting: every block raises on a failure, so the harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids; money in TRY
-- and EUR.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('vendor_a', gen_random_uuid()), ('vendor_b', gen_random_uuid()),
  ('inv', gen_random_uuid()), ('cn', gen_random_uuid()), ('cn_b', gen_random_uuid()),
  ('cn_eur', gen_random_uuid()), ('inv_nototal', gen_random_uuid());

insert into public.restaurants (id, name, slug, timezone)
select v, 'SYNTHETIC invoice-payments house', 'syn-pay-' || left(replace(v::text, '-', ''), 16), 'Europe/Istanbul'
  from t_fx where k = 'house';

insert into public.providers (id, restaurant_id, name, primary_contact)
select v, (select v from t_fx where k = 'house'), 'SYNTHETIC vendor ' || k, '{}'::jsonb
  from t_fx where k in ('vendor_a', 'vendor_b');

insert into public.procurement_documents (id, restaurant_id, provider_id, doc_type, doc_number, status, total, currency, source_channel)
values
  ((select v from t_fx where k = 'inv'),         (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_a'), 'invoice',     'SYN-INV-905', 'verified', 10000, 'TRY', 'manual'),
  ((select v from t_fx where k = 'cn'),          (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_a'), 'credit_memo', 'SYN-CN-88',   'verified', -1200, 'TRY', 'manual'),
  ((select v from t_fx where k = 'cn_b'),        (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_b'), 'credit_memo', 'SYN-CN-B1',   'verified',  3000, 'TRY', 'manual'),
  ((select v from t_fx where k = 'cn_eur'),      (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_a'), 'credit_memo', 'SYN-CN-E1',   'verified',   500, 'EUR', 'manual'),
  ((select v from t_fx where k = 'inv_nototal'), (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_a'), 'invoice',     'SYN-INV-906', 'received',  null, 'TRY', 'manual');

-- T1: the table exists, RLS on, no client grant, and no client runs the writer.
do $$
declare
  rls boolean;
  grants int;
begin
  if to_regclass('public.procurement_invoice_payments') is null then
    raise exception 'T1 FAIL: public.procurement_invoice_payments does not exist';
  end if;
  select relrowsecurity into rls from pg_class where oid = to_regclass('public.procurement_invoice_payments');
  if not rls then raise exception 'T1 FAIL: RLS is off'; end if;
  select count(*) into grants from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'procurement_invoice_payments'
     and grantee in ('anon', 'authenticated');
  if grants > 0 then raise exception 'T1 FAIL: % client grant(s)', grants; end if;
  if has_function_privilege('authenticated', 'public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid)', 'execute') then
    raise exception 'T1 FAIL: a signed-in client can run record_invoice_payment';
  end if;
end $$;

-- T2 (F-1674): a part payment, back-dated, leaves the invoice unpaid with the rest still due.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'inv');
  r jsonb;
  pa timestamptz;
begin
  r := public.record_invoice_payment(h, i, 4000, current_date - 10, 'restaurant', null, null);
  if (r->>'left')::numeric <> 6000 then raise exception 'T2 FAIL: left % after 4000 of 10000', r->>'left'; end if;
  select paid_at into pa from public.procurement_documents where id = i;
  if pa is not null then raise exception 'T2 FAIL: a part payment marked the invoice paid'; end if;
  if (select paid_on from public.procurement_invoice_payments where invoice_id = i) <> current_date - 10 then
    raise exception 'T2 FAIL: the payment day was not kept';
  end if;
end $$;

-- T3 (F-1672): a credit note from ANOTHER vendor, or in ANOTHER currency, cannot pay it.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'inv');
  refused boolean := false;
begin
  begin
    perform public.record_invoice_payment(h, i, 1000, null, 'credit_applied', (select v from t_fx where k = 'cn_b'), null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: another vendor''s credit paid this invoice'; end if;
  refused := false;
  begin
    perform public.record_invoice_payment(h, i, 100, null, 'credit_applied', (select v from t_fx where k = 'cn_eur'), null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: a EUR credit paid a TRY invoice'; end if;
end $$;

-- T4 (F-1672): the vendor's own credit pays part, never past what it holds; the rest covers it.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'inv');
  c uuid := (select v from t_fx where k = 'cn');
  refused boolean := false;
  r jsonb;
  pa timestamptz;
  pb text;
begin
  begin
    perform public.record_invoice_payment(h, i, 1500, null, 'credit_applied', c, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T4 FAIL: a 1200 credit paid 1500'; end if;
  r := public.record_invoice_payment(h, i, null, null, 'credit_applied', c, null);
  if (r->>'paid')::numeric <> 5200 then raise exception 'T4 FAIL: paid % after the credit', r->>'paid'; end if;
  refused := false;
  begin
    perform public.record_invoice_payment(h, i, 9000, null, 'restaurant', null, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T4 FAIL: a payment past what is left was taken'; end if;
  r := public.record_invoice_payment(h, i, null, current_date - 2, 'restaurant', null, null);
  select paid_at, paid_by into pa, pb from public.procurement_documents where id = i;
  if pa is null then raise exception 'T4 FAIL: payments covering the bill did not mark it paid'; end if;
  if (pa at time zone 'Europe/Istanbul')::date <> current_date - 2 then
    raise exception 'T4 FAIL: paid_at % is not the covering payment''s day', pa;
  end if;
  if (select count(*) from public.procurement_invoice_payments where invoice_id = i) <> 3 then
    raise exception 'T4 FAIL: not three payments on file';
  end if;
end $$;

-- T5: a payment dated tomorrow, and a part payment on an invoice with no total, are refused.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  refused boolean := false;
begin
  begin
    perform public.record_invoice_payment(h, (select v from t_fx where k = 'inv_nototal'), 100, null, 'restaurant', null, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T5 FAIL: a part payment on an invoice with no total'; end if;
  refused := false;
  begin
    perform public.record_invoice_payment(h, (select v from t_fx where k = 'inv_nototal'), null, current_date + 3, 'restaurant', null, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T5 FAIL: a payment dated after today'; end if;
end $$;

-- T6: mark not paid removes the payments, returns them, and clears the invoice's facts.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'inv');
  gone jsonb;
begin
  gone := public.clear_invoice_payments(h, i);
  if jsonb_array_length(gone) <> 3 then raise exception 'T6 FAIL: % payments returned', jsonb_array_length(gone); end if;
  if exists (select 1 from public.procurement_invoice_payments where invoice_id = i) then
    raise exception 'T6 FAIL: payments left behind';
  end if;
  if (select paid_at from public.procurement_documents where id = i) is not null then
    raise exception 'T6 FAIL: the invoice still reads paid';
  end if;
end $$;

rollback;
