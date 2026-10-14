-- Wave 109 (sim-ledger S236/S237 owed item 1): a vendor prints an invoice
-- with its credit note already taken off (INV-905 at 8.800, not 10.000 less
-- CN-88's 1.200). Migration a_credit_note_already_taken_off_an_invoice_total_is_used
-- adds public.procurement_credit_taken_on_invoice, record_credit_taken_on_invoice
-- and clear_credit_taken_on_invoice, and has record_invoice_payment count that
-- credit as used.
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
  ('inv', gen_random_uuid()), ('inv2', gen_random_uuid()), ('cn', gen_random_uuid()),
  ('cn_b', gen_random_uuid()), ('cn_eur', gen_random_uuid());

insert into public.restaurants (id, name, slug, timezone)
select v, 'SYNTHETIC credit-taken house', 'syn-ctk-' || left(replace(v::text, '-', ''), 16), 'Europe/Istanbul'
  from t_fx where k = 'house';

insert into public.providers (id, restaurant_id, name, primary_contact)
select v, (select v from t_fx where k = 'house'), 'SYNTHETIC vendor ' || k, '{}'::jsonb
  from t_fx where k in ('vendor_a', 'vendor_b');

insert into public.procurement_documents (id, restaurant_id, provider_id, doc_type, doc_number, status, total, currency, source_channel)
values
  ((select v from t_fx where k = 'inv'),    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_a'), 'invoice',     'SYN-INV-905', 'verified',  8800, 'TRY', 'manual'),
  ((select v from t_fx where k = 'inv2'),   (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_a'), 'invoice',     'SYN-INV-906', 'verified',  5000, 'TRY', 'manual'),
  ((select v from t_fx where k = 'cn'),     (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_a'), 'credit_memo', 'SYN-CN-88',   'verified', -1200, 'TRY', 'manual'),
  ((select v from t_fx where k = 'cn_b'),   (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_b'), 'credit_memo', 'SYN-CN-B1',   'verified',  3000, 'TRY', 'manual'),
  ((select v from t_fx where k = 'cn_eur'), (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor_a'), 'credit_memo', 'SYN-CN-E1',   'verified',   500, 'EUR', 'manual');

-- T1: the table exists, RLS on, no client grant, and no client runs the writer.
do $$
declare
  rls boolean;
  grants int;
begin
  if to_regclass('public.procurement_credit_taken_on_invoice') is null then
    raise exception 'T1 FAIL: public.procurement_credit_taken_on_invoice does not exist';
  end if;
  select relrowsecurity into rls from pg_class where oid = to_regclass('public.procurement_credit_taken_on_invoice');
  if not rls then raise exception 'T1 FAIL: RLS is off'; end if;
  select count(*) into grants from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'procurement_credit_taken_on_invoice'
     and grantee in ('anon', 'authenticated');
  if grants > 0 then raise exception 'T1 FAIL: % client grant(s)', grants; end if;
  if has_function_privilege('authenticated', 'public.record_credit_taken_on_invoice(uuid, uuid, uuid, numeric, uuid)', 'execute') then
    raise exception 'T1 FAIL: a signed-in client can run record_credit_taken_on_invoice';
  end if;
end $$;

-- T2: another vendor's credit note, or one in another currency, cannot be said taken off it.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'inv');
  refused boolean := false;
begin
  begin
    perform public.record_credit_taken_on_invoice(h, i, (select v from t_fx where k = 'cn_b'), null, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T2 FAIL: another vendor''s credit was taken off this invoice'; end if;
  refused := false;
  begin
    perform public.record_credit_taken_on_invoice(h, i, (select v from t_fx where k = 'cn_eur'), null, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T2 FAIL: a EUR credit was taken off a TRY invoice'; end if;
  if exists (select 1 from public.procurement_credit_taken_on_invoice where invoice_id = i) then
    raise exception 'T2 FAIL: a refused credit left a row';
  end if;
end $$;

-- T3: never more than the credit note holds; empty = all of it; the invoice's own total is untouched.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'inv');
  c uuid := (select v from t_fx where k = 'cn');
  refused boolean := false;
  r jsonb;
begin
  begin
    perform public.record_credit_taken_on_invoice(h, i, c, 1500, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T3 FAIL: 1500 of a 1200 credit note was taken'; end if;
  r := public.record_credit_taken_on_invoice(h, i, c, null, null);
  if (r->>'amount')::numeric <> 1200 or (r->>'credit_left')::numeric <> 0 then
    raise exception 'T3 FAIL: took % with % left', r->>'amount', r->>'credit_left';
  end if;
  if (select paid_at from public.procurement_documents where id = i) is not null then
    raise exception 'T3 FAIL: taking a credit off the printed total marked the invoice paid';
  end if;
  -- The invoice still owes its whole printed 8800: paying "what is left" pays 8800.
  r := public.record_invoice_payment(h, i, null, null, 'restaurant', null, null);
  if (r->>'paid')::numeric <> 8800 then raise exception 'T3 FAIL: the invoice''s printed total became %', r->>'paid'; end if;
end $$;

-- T4: credit taken off one invoice's total cannot also pay another invoice.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  c uuid := (select v from t_fx where k = 'cn');
  refused boolean := false;
begin
  begin
    perform public.record_invoice_payment(h, (select v from t_fx where k = 'inv2'), 500, null, 'credit_applied', c, null);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'T4 FAIL: a credit already taken off INV-905 paid INV-906 too'; end if;
end $$;

-- T5: "mark not paid" leaves it; undoing it frees the credit again.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  i uuid := (select v from t_fx where k = 'inv');
  c uuid := (select v from t_fx where k = 'cn');
  gone jsonb;
  r jsonb;
begin
  perform public.clear_invoice_payments(h, i);
  if not exists (select 1 from public.procurement_credit_taken_on_invoice where invoice_id = i and credit_note_id = c) then
    raise exception 'T5 FAIL: mark not paid removed the credit taken off the total';
  end if;
  gone := public.clear_credit_taken_on_invoice(h, i, c);
  if (gone->>'amount')::numeric <> 1200 then raise exception 'T5 FAIL: undo returned %', gone; end if;
  r := public.record_invoice_payment(h, (select v from t_fx where k = 'inv2'), 500, null, 'credit_applied', c, null);
  if (r->>'paid')::numeric <> 500 then raise exception 'T5 FAIL: the freed credit did not pay'; end if;
end $$;

rollback;
