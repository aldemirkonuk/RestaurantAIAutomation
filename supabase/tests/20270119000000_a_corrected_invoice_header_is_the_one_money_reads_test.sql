-- Wave 111 (F-1690, sim-ledger S239/S240): a correction of an invoice's total,
-- issue date, number or currency reached document_revisions and
-- document_corrections only; Spend by vendor, Owed and record_invoice_payment
-- read the columns as read. Migration a_corrected_invoice_header_is_the_one_money_reads
-- adds corrected_* / effective_* on procurement_documents, the trigger that
-- carries a correction onto them, and has the payment writers read them.
--
-- Self-asserting: every block raises on a failure, so the harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration and PASS with it. One transaction, rolled
-- back. All fixtures are SYNTHETIC, keyed by fresh uuids; money in TRY and EUR.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('vendor', gen_random_uuid()),
  ('misread', gen_random_uuid()), ('part', gen_random_uuid()), ('eur', gen_random_uuid());

insert into public.restaurants (id, name, slug, timezone)
select v, 'SYNTHETIC corrected-header house', 'syn-chd-' || left(replace(v::text, '-', ''), 16), 'Europe/Istanbul'
  from t_fx where k = 'house';

insert into public.providers (id, restaurant_id, name, primary_contact)
select v, (select v from t_fx where k = 'house'), 'SYNTHETIC vendor', '{}'::jsonb
  from t_fx where k = 'vendor';

insert into public.procurement_documents (id, restaurant_id, provider_id, doc_type, doc_number, doc_date, status, total, currency, source_channel)
values
  -- 1.234,56 read as 123.456, and 31 Dec read as 3 Jan.
  ((select v from t_fx where k = 'misread'), (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor'), 'invoice', 'SYN-1O9', '2027-01-03', 'verified', 123456, 'TRY', 'manual'),
  ((select v from t_fx where k = 'part'),    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor'), 'invoice', 'SYN-200', '2026-12-10', 'verified',   2000, 'TRY', 'manual'),
  ((select v from t_fx where k = 'eur'),     (select v from t_fx where k = 'house'), (select v from t_fx where k = 'vendor'), 'invoice', 'SYN-300', '2026-12-11', 'verified',    900, 'TRY', 'manual');

-- T1: a corrected total, date and number are what is read; the paper as read stays.
do $$
declare
  d uuid := (select v from t_fx where k = 'misread');
  j jsonb;
begin
  insert into public.document_corrections (document_id, revision, field_path, before, after, kind) values
    (d, 2, 'totals.taxInclusiveAmount', '{"value": 123456}', '{"value": 1234.56, "source": "human_corrected"}', 'correction'),
    (d, 3, 'issueDate',                 '{"value": "2027-01-03"}', '{"value": "2026-12-31", "source": "human_corrected"}', 'correction'),
    (d, 4, 'documentNumber',            '{"value": "SYN-1O9"}', '{"value": "SYN-109", "source": "human_corrected"}', 'correction');
  -- Read as a whole row, so a build without the columns fails on the value.
  select to_jsonb(p) into j from public.procurement_documents p where p.id = d;
  if (j->>'effective_total')::numeric is distinct from 1234.56 then
    raise exception 'T1 FAIL: the corrected total reads %, not 1234.56', j->>'effective_total';
  end if;
  if j->>'effective_doc_date' is distinct from '2026-12-31' then
    raise exception 'T1 FAIL: the corrected date reads %, not 2026-12-31', j->>'effective_doc_date';
  end if;
  if j->>'effective_doc_number' is distinct from 'SYN-109' then
    raise exception 'T1 FAIL: the corrected number reads %', j->>'effective_doc_number';
  end if;
  if (j->>'total')::numeric <> 123456 or j->>'doc_date' <> '2027-01-03' or j->>'doc_number' <> 'SYN-1O9' then
    raise exception 'T1 FAIL: the paper as read was edited in place';
  end if;
end $$;

-- T2: a verification tick moves nothing; a later correction wins.
do $$
declare
  d uuid := (select v from t_fx where k = 'misread');
  t numeric;
begin
  insert into public.document_corrections (document_id, revision, field_path, before, after, kind) values
    (d, 5, 'totals.taxInclusiveAmount', '{"value": 1234.56}', '{"value": 999, "source": "human_corrected"}', 'verification');
  select (to_jsonb(p)->>'effective_total')::numeric into t from public.procurement_documents p where p.id = d;
  if t is distinct from 1234.56 then raise exception 'T2 FAIL: a tick moved the total to %', t; end if;
  insert into public.document_corrections (document_id, revision, field_path, before, after, kind) values
    (d, 6, 'totals.taxInclusiveAmount', '{"value": 1234.56}', '{"value": 1234.5, "source": "human_corrected"}', 'correction');
  select (to_jsonb(p)->>'effective_total')::numeric into t from public.procurement_documents p where p.id = d;
  if t is distinct from 1234.5 then raise exception 'T2 FAIL: the latest correction did not win (%)', t; end if;
end $$;

-- T3: "pay what is left" pays the corrected total, not the misread one.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  d uuid := (select v from t_fx where k = 'misread');
  r jsonb;
begin
  r := public.record_invoice_payment(h, d, null, null, 'restaurant', null, null);
  if (r->>'paid')::numeric <> 1234.5 then
    raise exception 'T3 FAIL: paying what is left paid %, not the corrected 1234.50', r->>'paid';
  end if;
  if r->>'paid_at' is null then raise exception 'T3 FAIL: paid in full did not read paid'; end if;
end $$;

-- T4: a payment against the old total keeps its money; paid follows the corrected total.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  d uuid := (select v from t_fx where k = 'part');
  r jsonb;
  pa timestamptz;
begin
  r := public.record_invoice_payment(h, d, 500, date '2026-10-01', 'restaurant', null, null);
  if r->>'paid_at' is not null then raise exception 'T4 FAIL: a part payment read paid in full'; end if;
  -- The total was really 450: the 500 already paid covers it.
  insert into public.document_corrections (document_id, revision, field_path, before, after, kind) values
    (d, 2, 'totals.taxInclusiveAmount', '{"value": 2000}', '{"value": 450}', 'correction');
  select paid_at into pa from public.procurement_documents where id = d;
  if pa is null then raise exception 'T4 FAIL: payments covering the corrected total did not read paid'; end if;
  if (select sum(amount) from public.procurement_invoice_payments where invoice_id = d) <> 500 then
    raise exception 'T4 FAIL: the payment lost its money';
  end if;
  -- No, it was 3000: 2500 is left, and it is not paid.
  insert into public.document_corrections (document_id, revision, field_path, before, after, kind) values
    (d, 3, 'totals.taxInclusiveAmount', '{"value": 450}', '{"value": 3000}', 'correction');
  select paid_at into pa from public.procurement_documents where id = d;
  if pa is not null then raise exception 'T4 FAIL: a bill with 2500 left still read paid'; end if;
  r := public.record_invoice_payment(h, d, null, null, 'restaurant', null, null);
  if (r->>'paid')::numeric <> 3000 or (r->>'left')::numeric <> 0 then
    raise exception 'T4 FAIL: paying what is left gave paid % left %', r->>'paid', r->>'left';
  end if;
end $$;

-- T5: a corrected currency is the one a payment is recorded in.
do $$
declare
  h uuid := (select v from t_fx where k = 'house');
  d uuid := (select v from t_fx where k = 'eur');
  r jsonb;
begin
  insert into public.document_corrections (document_id, revision, field_path, before, after, kind) values
    (d, 2, 'currency', '{"value": "TRY"}', '{"value": "eur"}', 'correction');
  if (select to_jsonb(p)->>'effective_currency' from public.procurement_documents p where p.id = d) is distinct from 'EUR' then
    raise exception 'T5 FAIL: the corrected currency is not read';
  end if;
  if (select currency from public.procurement_documents where id = d) <> 'TRY' then
    raise exception 'T5 FAIL: the currency as read was edited in place';
  end if;
  r := public.record_invoice_payment(h, d, 100, null, 'restaurant', null, null);
  if r->>'currency' <> 'EUR' then raise exception 'T5 FAIL: the payment was recorded in %', r->>'currency'; end if;
  -- A day that does not exist is not carried onto the document.
  insert into public.document_corrections (document_id, revision, field_path, before, after, kind) values
    (d, 3, 'issueDate', '{"value": "2026-12-11"}', '{"value": "2026-02-30"}', 'correction');
  if (select to_jsonb(p)->>'effective_doc_date' from public.procurement_documents p where p.id = d) is distinct from '2026-12-11' then
    raise exception 'T5 FAIL: a day that does not exist moved the date';
  end if;
end $$;

rollback;
