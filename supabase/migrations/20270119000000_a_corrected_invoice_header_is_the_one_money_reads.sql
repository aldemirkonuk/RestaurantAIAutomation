-- A corrected invoice header is the one money reads.
-- (Wave 111, F-1690, sim-ledger S239/S240. Additive: nine new columns on
-- procurement_documents, one function and its trigger, and the two invoice
-- money writers replaced so they read the corrected figures; nothing dropped.
-- The corrections already on file are replayed once, so an invoice corrected
-- before today reads as corrected.)
--
-- WHY
-- ---
-- A correction on /documents/:id (ADR 0104 D5) appends a document_revisions
-- row and a document_corrections row and never edits the document in place.
-- Nothing carried it further: Spend by vendor, Owed and record_invoice_payment
-- read procurement_documents.total, doc_date, doc_number and currency, so a
-- total misread as 123.456 for 1.234,56, or 31 Dec read as 3 Jan, stayed
-- wrong in every month and year an accountant pulled, and "pay what is left"
-- paid the misread figure.
--
-- WHAT
-- ----
-- The columns as read stay exactly as they were: they are the history. Beside
-- them, `corrected_*` holds the latest correction of each header field and
-- `corrected_fields` names which ones a person corrected (so "the paper states
-- no total", a correction to null, is told apart from "never corrected").
-- `effective_*` is generated from the two: the corrected value where there is
-- one, the value as read where there is not. Money and period readers read
-- `effective_*`.
--
-- The write-through is a trigger on document_corrections, so it lands in the
-- same statement as the correction's audit row and the gateway's correction
-- door still issues no UPDATE. A verification tick moves nothing.
--
-- A correction of the total keeps every payment recorded against the old one:
-- the invoice reads paid in full when its payments cover the corrected total,
-- dated by the payment that covered it, and not paid when they no longer do.
-- (A currency correction on paper with money already recorded in another
-- currency is refused at the gateway, before anything is written.)
--
-- Read and written only by the gateway (service role). Idempotent and safe to
-- re-run. No explicit BEGIN/COMMIT: the Supabase CLI wraps each migration
-- file in a transaction.

alter table public.procurement_documents
  add column if not exists corrected_fields     text[] not null default '{}'::text[],
  add column if not exists corrected_total      numeric,
  add column if not exists corrected_doc_date   date,
  add column if not exists corrected_doc_number text,
  add column if not exists corrected_currency   text;

alter table public.procurement_documents
  add column if not exists effective_total numeric
    generated always as (case when 'total' = any (corrected_fields) then corrected_total else total end) stored,
  add column if not exists effective_doc_date date
    generated always as (case when 'doc_date' = any (corrected_fields) then corrected_doc_date else doc_date end) stored,
  add column if not exists effective_doc_number text
    generated always as (case when 'doc_number' = any (corrected_fields) then corrected_doc_number else doc_number::text end) stored,
  add column if not exists effective_currency text
    generated always as (case when 'currency' = any (corrected_fields) then corrected_currency else currency::text end) stored;

comment on column public.procurement_documents.corrected_fields is
  'Which header fields a person corrected on the document (total, doc_date, doc_number, currency), written by apply_document_header_correction (F-1690). The as-read columns are never changed by a correction.';
comment on column public.procurement_documents.effective_total is
  'The total money reads: the latest correction of it, else the total as read (F-1690).';
comment on column public.procurement_documents.effective_doc_date is
  'The issue date periods are cut on: the latest correction of it, else the date as read (F-1690).';
comment on column public.procurement_documents.effective_doc_number is
  'The document number: the latest correction of it, else the number as read (F-1690).';
comment on column public.procurement_documents.effective_currency is
  'The currency money is in: the latest correction of it, else the currency as read (F-1690).';

-- Spend by vendor cuts its period on this.
create index if not exists idx_pd_effective_doc_date
  on public.procurement_documents (restaurant_id, effective_doc_date);

-- ---------------------------------------------------------------------------
-- One correction of one header field, carried onto the document.
-- ---------------------------------------------------------------------------
create or replace function public.apply_document_header_correction(
  p_document_id uuid,
  p_field_path  text,
  p_after       jsonb
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  field     text;
  v         jsonb := p_after -> 'value';
  said      text;
  day       date;
  doc       record;
  zone      text;
  paid      numeric;
  covered   boolean;
  last_pay  record;
begin
  field := case p_field_path
             when 'totals.taxInclusiveAmount' then 'total'
             when 'issueDate'                 then 'doc_date'
             when 'documentNumber'            then 'doc_number'
             when 'currency'                  then 'currency'
           end;
  if field is null then
    return;
  end if;
  said := case when v is null or jsonb_typeof(v) = 'null' then null else v #>> '{}' end;

  if field = 'total' then
    update public.procurement_documents
       set corrected_total  = case when jsonb_typeof(v) = 'number' then said::numeric end,
           corrected_fields = array_append(array_remove(corrected_fields, 'total'), 'total')
     where id = p_document_id;
  elsif field = 'doc_date' then
    -- The gateway refuses anything but YYYY-MM-DD; a value it let through
    -- before that rule, and cannot be read as a day, is left as read.
    if said is not null then
      if said !~ '^\d{4}-\d{2}-\d{2}$' then
        return;
      end if;
      begin
        day := to_date(said, 'YYYY-MM-DD');
      exception when others then
        return;
      end;
      if to_char(day, 'YYYY-MM-DD') <> said then
        return;  -- 2026-02-30 is not a day
      end if;
    end if;
    update public.procurement_documents
       set corrected_doc_date = day,
           corrected_fields   = array_append(array_remove(corrected_fields, 'doc_date'), 'doc_date')
     where id = p_document_id;
  elsif field = 'doc_number' then
    update public.procurement_documents
       set corrected_doc_number = nullif(trim(said), ''),
           corrected_fields     = array_append(array_remove(corrected_fields, 'doc_number'), 'doc_number')
     where id = p_document_id;
  else
    -- "States no currency" keeps the one on file, as the canonical sheet does.
    if said is null or trim(said) = '' then
      update public.procurement_documents
         set corrected_currency = null,
             corrected_fields   = array_remove(corrected_fields, 'currency')
       where id = p_document_id;
    elsif upper(trim(said)) ~ '^[A-Z]{3}$' then
      update public.procurement_documents
         set corrected_currency = upper(trim(said)),
             corrected_fields   = array_append(array_remove(corrected_fields, 'currency'), 'currency')
       where id = p_document_id;
    end if;
    return;
  end if;

  if field <> 'total' then
    return;
  end if;

  -- The payments keep their money; whether they cover the bill is asked again.
  select id, restaurant_id, doc_type, effective_total, paid_at
    into doc
    from public.procurement_documents where id = p_document_id;
  if not found or doc.doc_type <> 'invoice' or doc.effective_total is null then
    return;
  end if;
  select coalesce(sum(amount), 0) into paid
    from public.procurement_invoice_payments where invoice_id = doc.id;
  select paid_on, paid_by into last_pay
    from public.procurement_invoice_payments where invoice_id = doc.id
   order by paid_on desc, recorded_at desc limit 1;
  if not found then
    return;  -- marked paid with no payment rows (no total then): left as said
  end if;
  covered := paid >= abs(doc.effective_total) - 0.005;
  select timezone into zone from public.restaurants where id = doc.restaurant_id;
  if zone is null or not exists (select 1 from pg_timezone_names where name = zone) then
    zone := 'UTC';
  end if;
  update public.procurement_documents
     set paid_at = case when covered
                        then coalesce(paid_at, (last_pay.paid_on::timestamp + interval '12 hours') at time zone zone) end,
         paid_by = case when covered then coalesce(paid_by, last_pay.paid_by) end
   where id = doc.id;
end;
$$;

comment on function public.apply_document_header_correction(uuid, text, jsonb) is
  'Carries one correction of an invoice header field (total, issue date, number, currency) onto procurement_documents.corrected_* (F-1690); the as-read columns are never changed. After a total correction the invoice reads paid only while its payments cover the corrected total.';

create or replace function public.document_correction_reaches_the_document()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.kind, 'correction') <> 'verification' then
    perform public.apply_document_header_correction(new.document_id, new.field_path, new.after);
  end if;
  return null;
end;
$$;

drop trigger if exists document_correction_reaches_the_document on public.document_corrections;
create trigger document_correction_reaches_the_document
  after insert on public.document_corrections
  for each row execute function public.document_correction_reaches_the_document();

revoke all on function public.apply_document_header_correction(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.document_correction_reaches_the_document() from public, anon, authenticated;

-- The corrections already on file, oldest first, so the latest of each wins.
-- A currency correction on paper with money already recorded in another
-- currency is not replayed: that money stays in the currency it was paid in.
do $$
declare
  c record;
begin
  for c in
    select dc.document_id, dc.field_path, dc.after
      from public.document_corrections dc
     where coalesce(dc.kind, 'correction') <> 'verification'
       and dc.field_path in ('totals.taxInclusiveAmount', 'issueDate', 'documentNumber', 'currency')
       and not (
         dc.field_path = 'currency'
         and (exists (select 1 from public.procurement_invoice_payments p
                       where (p.invoice_id = dc.document_id or p.credit_note_id = dc.document_id)
                         and p.currency is distinct from upper(trim(dc.after ->> 'value')))
              or exists (select 1 from public.procurement_credit_taken_on_invoice t
                          where (t.invoice_id = dc.document_id or t.credit_note_id = dc.document_id)
                            and t.currency is distinct from upper(trim(dc.after ->> 'value'))))
       )
     order by dc.document_id, dc.revision, dc.corrected_at
  loop
    perform public.apply_document_header_correction(c.document_id, c.field_path, c.after);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- record_credit_taken_on_invoice and record_invoice_payment (20270118000000),
-- unchanged but for one thing: they read the invoice's and the credit note's
-- corrected total and currency (effective_total, effective_currency).
-- ---------------------------------------------------------------------------

create or replace function public.record_credit_taken_on_invoice(
  p_restaurant_id  uuid,
  p_invoice_id     uuid,
  p_credit_note_id uuid,
  p_amount         numeric,   -- null = all the credit the note has left
  p_recorded_by    uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  inv         record;
  cn          record;
  credit_left numeric;
  amt         numeric;
begin
  -- The invoice first, then the credit note: the order record_invoice_payment locks them in.
  select id, doc_type, provider_id, upper(trim(effective_currency)) as currency
    into inv
    from public.procurement_documents
   where id = p_invoice_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'That invoice is not on file at this house.' using errcode = 'no_data_found';
  end if;
  if inv.doc_type <> 'invoice' then
    raise exception 'A credit can only be taken off an invoice.' using errcode = 'check_violation';
  end if;
  select id, doc_type, provider_id, upper(trim(effective_currency)) as currency, effective_total as total, status
    into cn
    from public.procurement_documents
   where id = p_credit_note_id and restaurant_id = p_restaurant_id
   for update;
  if not found or cn.doc_type <> 'credit_memo' or cn.status in ('rejected','superseded') then
    raise exception 'That credit note is not on file at this house.' using errcode = 'check_violation';
  end if;
  if cn.provider_id is null or inv.provider_id is null or cn.provider_id <> inv.provider_id then
    raise exception 'A credit note can only be taken off an invoice from the same vendor.' using errcode = 'check_violation';
  end if;
  if inv.currency is null or cn.currency is distinct from inv.currency then
    raise exception 'A credit note can only be taken off an invoice in the same currency.' using errcode = 'check_violation';
  end if;
  if cn.total is null then
    raise exception 'That credit note has no total yet.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.procurement_credit_taken_on_invoice
              where credit_note_id = cn.id and invoice_id = inv.id) then
    raise exception 'That credit note is already said to be taken off this invoice.' using errcode = 'check_violation';
  end if;
  credit_left := abs(cn.total)
    - coalesce((select sum(amount) from public.procurement_invoice_payments where credit_note_id = cn.id), 0)
    - coalesce((select sum(amount) from public.procurement_credit_taken_on_invoice where credit_note_id = cn.id), 0);
  amt := coalesce(p_amount, credit_left);
  if p_amount is not null and p_amount <= 0 then
    raise exception 'The credit taken off must be more than zero.' using errcode = 'check_violation';
  end if;
  if credit_left <= 0 or amt > credit_left + 0.005 then
    raise exception 'That credit note has % % left to use.', greatest(credit_left, 0), inv.currency
      using errcode = 'check_violation';
  end if;

  insert into public.procurement_credit_taken_on_invoice
    (restaurant_id, credit_note_id, invoice_id, amount, currency, recorded_by)
  values
    (p_restaurant_id, cn.id, inv.id, round(amt, 2), inv.currency, p_recorded_by);

  return jsonb_build_object(
    'amount', round(amt, 2),
    'currency', inv.currency,
    'credit_left', greatest(credit_left - round(amt, 2), 0));
end;
$$;

comment on function public.record_credit_taken_on_invoice(uuid, uuid, uuid, numeric, uuid) is
  'Says a credit note was already taken off an invoice''s printed total (wave 109, S237): same vendor, same currency, never past the credit it has left. Uses the credit up; does not pay the invoice.';


create or replace function public.record_invoice_payment(
  p_restaurant_id  uuid,
  p_invoice_id     uuid,
  p_amount         numeric,   -- null = whatever is left on the invoice
  p_paid_on        date,      -- null = today, on the house's clock
  p_paid_by        text,
  p_credit_note_id uuid,
  p_recorded_by    uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  inv        record;
  cn         record;
  zone       text;
  today      date;
  paid_on    date;
  paid_so_far numeric;
  left_due   numeric;
  credit_left numeric;
  amt        numeric;
  covered    boolean;
begin
  select timezone into zone from public.restaurants where id = p_restaurant_id;
  if zone is null or not exists (select 1 from pg_timezone_names where name = zone) then
    zone := 'UTC';
  end if;
  today := (now() at time zone zone)::date;
  paid_on := coalesce(p_paid_on, today);
  if paid_on > today then
    raise exception 'A payment cannot be dated after today (%).', today
      using errcode = 'check_violation';
  end if;
  if p_paid_by is null or p_paid_by not in ('eft_wholesaler_initiated','restaurant','credit_applied','other') then
    raise exception 'That is not a way an invoice can be paid here.'
      using errcode = 'check_violation';
  end if;

  select id, doc_type, provider_id, upper(trim(effective_currency)) as currency, effective_total as total, status
    into inv
    from public.procurement_documents
   where id = p_invoice_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'That invoice is not on file at this house.' using errcode = 'no_data_found';
  end if;
  if inv.doc_type <> 'invoice' then
    raise exception 'Only an invoice can be paid.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount), 0) into paid_so_far
    from public.procurement_invoice_payments where invoice_id = inv.id;

  -- No printed total: only "paid in full" can be said, and it is said on the
  -- invoice alone (no payment row), as before this table existed.
  if inv.total is null then
    if p_amount is not null or p_paid_by = 'credit_applied' then
      raise exception 'This invoice has no total yet, so a part payment or a credit cannot be set against it. Mark it paid in full, or wait for its total.'
        using errcode = 'check_violation';
    end if;
    update public.procurement_documents
       set paid_at = (paid_on::timestamp + interval '12 hours') at time zone zone,
           paid_by = p_paid_by
     where id = inv.id;
    return jsonb_build_object('paid_at', (paid_on::timestamp + interval '12 hours') at time zone zone,
                              'paid_by', p_paid_by, 'paid', null, 'left', null, 'currency', inv.currency);
  end if;

  if inv.currency is null then
    raise exception 'This invoice names no currency, so a payment cannot be recorded against it.'
      using errcode = 'check_violation';
  end if;
  left_due := abs(inv.total) - paid_so_far;
  if left_due <= 0 then
    raise exception 'This invoice is already paid in full.' using errcode = 'check_violation';
  end if;
  amt := coalesce(p_amount, left_due);
  if amt <= 0 then
    raise exception 'A payment must be more than zero.' using errcode = 'check_violation';
  end if;

  if p_paid_by = 'credit_applied' then
    if p_credit_note_id is null then
      raise exception 'Say which credit note paid it.' using errcode = 'check_violation';
    end if;
    select id, doc_type, provider_id, upper(trim(effective_currency)) as currency, effective_total as total, status
      into cn
      from public.procurement_documents
     where id = p_credit_note_id and restaurant_id = p_restaurant_id
     for update;
    if not found or cn.doc_type <> 'credit_memo' or cn.status in ('rejected','superseded') then
      raise exception 'That credit note is not on file at this house.' using errcode = 'check_violation';
    end if;
    if cn.provider_id is null or inv.provider_id is null or cn.provider_id <> inv.provider_id then
      raise exception 'A credit note can only pay an invoice from the same vendor.' using errcode = 'check_violation';
    end if;
    if cn.currency is distinct from inv.currency then
      raise exception 'A credit note can only pay an invoice in the same currency.' using errcode = 'check_violation';
    end if;
    if cn.total is null then
      raise exception 'That credit note has no total yet.' using errcode = 'check_violation';
    end if;
    select abs(cn.total) - coalesce(sum(amount), 0) into credit_left
      from public.procurement_invoice_payments where credit_note_id = cn.id;
    -- Credit the vendor already took off an invoice's printed total is used too.
    credit_left := credit_left - coalesce((
      select sum(amount) from public.procurement_credit_taken_on_invoice
       where credit_note_id = cn.id), 0);
    if p_amount is null then amt := least(amt, credit_left); end if;
    if credit_left <= 0 or amt > credit_left + 0.005 then
      raise exception 'That credit note has % % left to use.', greatest(credit_left, 0), inv.currency
        using errcode = 'check_violation';
    end if;
  elsif p_credit_note_id is not null then
    raise exception 'Only a payment by credit note names a credit note.' using errcode = 'check_violation';
  end if;

  if amt > left_due + 0.005 then
    raise exception 'This invoice has % % left to pay; a payment cannot be more than that.', left_due, inv.currency
      using errcode = 'check_violation';
  end if;

  insert into public.procurement_invoice_payments
    (restaurant_id, invoice_id, amount, currency, paid_on, paid_by, credit_note_id, recorded_by)
  values
    (p_restaurant_id, inv.id, round(amt, 2), inv.currency, paid_on, p_paid_by, p_credit_note_id, p_recorded_by);

  paid_so_far := paid_so_far + round(amt, 2);
  covered := paid_so_far >= abs(inv.total) - 0.005;
  update public.procurement_documents
     set paid_at = case when covered then (paid_on::timestamp + interval '12 hours') at time zone zone end,
         paid_by = case when covered then p_paid_by end
   where id = inv.id;

  return jsonb_build_object(
    'paid_at', case when covered then (paid_on::timestamp + interval '12 hours') at time zone zone end,
    'paid_by', case when covered then p_paid_by end,
    'paid', paid_so_far,
    'left', greatest(abs(inv.total) - paid_so_far, 0),
    'currency', inv.currency);
end;
$$;

comment on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) is
  'Records one payment on a vendor invoice (F-1672, F-1674): a credit note pays only the same vendor''s invoice in the same currency, never past what is left on either; paid_at is set once payments cover the total, as corrected (F-1690).';

revoke all on function public.record_credit_taken_on_invoice(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_credit_taken_on_invoice(uuid, uuid, uuid, numeric, uuid) to service_role;
grant execute on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'procurement_documents'
                    AND column_name = 'effective_total' AND is_generated = 'ALWAYS') THEN
    RAISE EXCEPTION 'procurement_documents.effective_total was not created as a generated column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'document_correction_reaches_the_document'
                    AND tgrelid = 'public.document_corrections'::regclass) THEN
    RAISE EXCEPTION 'the trigger carrying a correction onto the document is missing';
  END IF;
  IF has_function_privilege('anon', 'public.apply_document_header_correction(uuid, text, jsonb)', 'execute')
     OR has_function_privilege('authenticated', 'public.apply_document_header_correction(uuid, text, jsonb)', 'execute')
     OR has_function_privilege('authenticated', 'public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid)', 'execute')
     OR has_function_privilege('anon', 'public.record_credit_taken_on_invoice(uuid, uuid, uuid, numeric, uuid)', 'execute') THEN
    RAISE EXCEPTION 'a client role can run a correction or invoice payment function';
  END IF;
END $$;
