-- An invoice is paid once, as one bill, and each payment can be taken back.
-- (Wave 113, F-1706, F-1720, F-1721, F-1725, sim-ledger S242-S244. Additive:
-- one column on procurement_documents, one on procurement_invoice_payments
-- with its unique index, two new functions, the payment writer given a key,
-- and "mark not paid" reaching every copy; nothing dropped, no backfill.)
--
-- WHY
-- ---
--   * F-1706: an invoice with no total marked "paid in full" on a back-dated
--     day kept only `paid_at` = that day. Owed dates itself from the first
--     marking, so a marking back-dated by months pulled months of unmarked
--     invoices into Owed. Payment rows were already dated by when they were
--     recorded; this marking was not.
--   * F-1720: Owed reads copies of one invoice (same vendor, kind and number)
--     as ONE bill, but the writer, "mark not paid" and the screen worked per
--     copy: the second copy read "not marked paid yet" and part payments on
--     the two copies could pay the bill more than once.
--   * F-1721: "mark not paid" took every payment away at once, and no single
--     payment could be taken back.
--   * F-1725: a part payment whose reply was lost was recorded again on retry.
--
-- WHAT
-- ----
-- `procurement_documents.paid_marked_at`: when the "paid" marking was
-- recorded, beside `paid_at` (the day it was paid). Owed dates a marking with
-- no payment kept from it; a marking from before this column reads `paid_at`,
-- which was then always the day it was recorded.
--
-- `invoice_bill_copies`: the copies of one invoice, as Owed counts them — the
-- invoice itself and every live copy (not rejected, not replaced) of the same
-- vendor, kind and number, as corrected. Paper with no number is its own bill.
-- The writer, "mark not paid", the one-payment removal and the payments read
-- all work on the bill: payments on any copy count, what is left is against
-- the copy Owed keeps (the verified one, else the newest), and "paid" is said
-- on every copy at once. A copy already marked paid with no payment kept
-- (before payments were, or with no total) refuses another payment.
--
-- `procurement_invoice_payments.client_key`: the key the screen sends with a
-- payment, unique per house. The same key again returns what was recorded and
-- records nothing (coordinator's call S244, industry standard: a payment write
-- is idempotent). The 7-argument writer stays, calling the keyed one with no
-- key, so every caller and check that names it keeps working.
--
-- `remove_invoice_payment`: takes ONE payment back. The bill reads paid again
-- only if what is left still covers it. The gateway logs the removed payment
-- to the audit log, as "mark not paid" does.
--
-- Read and written only by the gateway (service role). Idempotent and safe to
-- re-run. No explicit BEGIN/COMMIT: the Supabase CLI wraps each migration
-- file in a transaction.

alter table public.procurement_documents
  add column if not exists paid_marked_at timestamptz;

comment on column public.procurement_documents.paid_marked_at is
  'When the "paid" marking was recorded (F-1706); paid_at is the day it was paid, which may be back-dated. Null for markings from before 2027-01-20.';

alter table public.procurement_invoice_payments
  add column if not exists client_key text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'procurement_invoice_payments_client_key_shape') then
    alter table public.procurement_invoice_payments
      add constraint procurement_invoice_payments_client_key_shape
      check (client_key is null or client_key ~ '^[A-Za-z0-9:_-]{8,120}$');
  end if;
end $$;

create unique index if not exists uq_procurement_invoice_payments_client_key
  on public.procurement_invoice_payments (restaurant_id, client_key)
  where client_key is not null;

comment on column public.procurement_invoice_payments.client_key is
  'The key the screen sent with this payment (F-1725): the same key again records nothing and returns this payment. Unique per house.';

-- ---------------------------------------------------------------------------
-- The copies of one invoice, as Owed counts them.
-- ---------------------------------------------------------------------------
create or replace function public.invoice_bill_copies(
  p_restaurant_id uuid,
  p_invoice_id    uuid
) returns uuid[]
language sql
stable
set search_path = public, pg_temp
as $$
  select array_agg(c.id order by c.id)
    from public.procurement_documents i
    join public.procurement_documents c
      on c.restaurant_id = i.restaurant_id
     and (c.id = i.id
          or (nullif(trim(i.effective_doc_number), '') is not null
              and c.doc_type = i.doc_type
              and c.provider_id is not distinct from i.provider_id
              and upper(trim(c.effective_doc_number)) = upper(trim(i.effective_doc_number))
              and coalesce(c.status, '') not in ('rejected', 'superseded')))
   where i.id = p_invoice_id and i.restaurant_id = p_restaurant_id;
$$;

comment on function public.invoice_bill_copies(uuid, uuid) is
  'The invoice and every live copy of it (same vendor, kind and number, as corrected), as Owed counts one bill (F-1720). Null when the invoice is not at this house.';

-- ---------------------------------------------------------------------------
-- The one writer, now per bill and keyed. Unchanged otherwise from
-- 20270119000000 (it reads effective_total and effective_currency).
-- ---------------------------------------------------------------------------
create or replace function public.record_invoice_payment(
  p_restaurant_id  uuid,
  p_invoice_id     uuid,
  p_amount         numeric,   -- null = whatever is left on the bill
  p_paid_on        date,      -- null = today, on the house's clock
  p_paid_by        text,
  p_credit_note_id uuid,
  p_recorded_by    uuid,
  p_client_key     text       -- null = no key; the same key again records nothing
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  inv         record;
  bill        record;
  cn          record;
  prior       record;
  copies      uuid[];
  zone        text;
  today       date;
  paid_on     date;
  paid_so_far numeric;
  left_due    numeric;
  credit_left numeric;
  amt         numeric;
  covered     boolean;
  marked_id   uuid;
  marked_at   timestamptz;
  marked_by   text;
  marked_day  date;
  key         text := nullif(trim(p_client_key), '');
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

  select id, doc_type into inv
    from public.procurement_documents
   where id = p_invoice_id and restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'That invoice is not on file at this house.' using errcode = 'no_data_found';
  end if;
  if inv.doc_type <> 'invoice' then
    raise exception 'Only an invoice can be paid.' using errcode = 'check_violation';
  end if;

  -- Every copy of the bill is locked, in one order, before anything is read.
  copies := public.invoice_bill_copies(p_restaurant_id, inv.id);
  perform 1 from public.procurement_documents
   where id = any (copies) order by id for update;
  -- The bill's figures are the copy Owed keeps: the verified one, else the newest.
  select provider_id, upper(trim(effective_currency)) as currency, effective_total as total
    into bill
    from public.procurement_documents
   where id = any (copies)
   order by coalesce(status, '') in ('rejected', 'superseded'),
            coalesce(status, '') = 'verified' desc,
            created_at desc nulls last
   limit 1;

  select coalesce(sum(amount), 0) into paid_so_far
    from public.procurement_invoice_payments where invoice_id = any (copies);
  select id, paid_at, paid_by into marked_id, marked_at, marked_by
    from public.procurement_documents
   where id = any (copies) and paid_at is not null
   order by paid_at limit 1;

  -- The same key again: what was recorded, and nothing recorded twice (F-1725).
  if key is not null then
    select invoice_id into prior
      from public.procurement_invoice_payments
     where restaurant_id = p_restaurant_id and client_key = key;
    if found then
      if not (prior.invoice_id = any (copies)) then
        raise exception 'That payment was already recorded on another invoice.' using errcode = 'check_violation';
      end if;
      return jsonb_build_object(
        'paid_at', marked_at, 'paid_by', marked_by, 'paid', paid_so_far,
        'left', case when bill.total is null then null else greatest(abs(bill.total) - paid_so_far, 0) end,
        'currency', bill.currency, 'replayed', true);
    end if;
  end if;

  -- A copy marked paid in full with no payment kept: it is paid (F-1720).
  if marked_id is not null and paid_so_far = 0 then
    if marked_id = inv.id then
      raise exception 'This invoice is already marked paid in full.' using errcode = 'check_violation';
    end if;
    marked_day := (marked_at at time zone zone)::date;
    raise exception 'Another copy of this invoice is already marked paid in full, on %. Mark that copy not paid first if this is wrong.', marked_day
      using errcode = 'check_violation';
  end if;

  -- No total: only "paid in full" can be said, and it is said on the invoice
  -- alone (no payment row). When it was SAID is kept beside the day it was
  -- paid, so a back-dated marking does not move Owed (F-1706).
  if bill.total is null then
    if p_amount is not null or p_paid_by = 'credit_applied' then
      raise exception 'This invoice has no total yet, so a part payment or a credit cannot be set against it. Mark it paid in full, or wait for its total.'
        using errcode = 'check_violation';
    end if;
    update public.procurement_documents
       set paid_at = (paid_on::timestamp + interval '12 hours') at time zone zone,
           paid_by = p_paid_by,
           paid_marked_at = now()
     where id = any (copies);
    return jsonb_build_object('paid_at', (paid_on::timestamp + interval '12 hours') at time zone zone,
                              'paid_by', p_paid_by, 'paid', null, 'left', null, 'currency', bill.currency);
  end if;

  if bill.currency is null then
    raise exception 'This invoice names no currency, so a payment cannot be recorded against it.'
      using errcode = 'check_violation';
  end if;
  left_due := abs(bill.total) - paid_so_far;
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
    if cn.provider_id is null or bill.provider_id is null or cn.provider_id <> bill.provider_id then
      raise exception 'A credit note can only pay an invoice from the same vendor.' using errcode = 'check_violation';
    end if;
    if cn.currency is distinct from bill.currency then
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
      raise exception 'That credit note has % % left to use.', greatest(credit_left, 0), bill.currency
        using errcode = 'check_violation';
    end if;
  elsif p_credit_note_id is not null then
    raise exception 'Only a payment by credit note names a credit note.' using errcode = 'check_violation';
  end if;

  if amt > left_due + 0.005 then
    raise exception 'This invoice has % % left to pay; a payment cannot be more than that.', left_due, bill.currency
      using errcode = 'check_violation';
  end if;

  insert into public.procurement_invoice_payments
    (restaurant_id, invoice_id, amount, currency, paid_on, paid_by, credit_note_id, recorded_by, client_key)
  values
    (p_restaurant_id, inv.id, round(amt, 2), bill.currency, paid_on, p_paid_by, p_credit_note_id, p_recorded_by, key);

  paid_so_far := paid_so_far + round(amt, 2);
  covered := paid_so_far >= abs(bill.total) - 0.005;
  update public.procurement_documents
     set paid_at = case when covered then (paid_on::timestamp + interval '12 hours') at time zone zone end,
         paid_by = case when covered then p_paid_by end,
         paid_marked_at = case when covered then now() end
   where id = any (copies);

  return jsonb_build_object(
    'paid_at', case when covered then (paid_on::timestamp + interval '12 hours') at time zone zone end,
    'paid_by', case when covered then p_paid_by end,
    'paid', paid_so_far,
    'left', greatest(abs(bill.total) - paid_so_far, 0),
    'currency', bill.currency);
end;
$$;

comment on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid, text) is
  'Records one payment on a vendor invoice, against the whole bill (every copy of it, F-1720): a credit note pays only the same vendor''s invoice in the same currency, never past what is left on either; paid_at is set on every copy once payments cover the total, as corrected (F-1690). The same client key again records nothing (F-1725).';

-- The 7-argument writer every earlier caller names: the keyed one, with no key.
create or replace function public.record_invoice_payment(
  p_restaurant_id  uuid,
  p_invoice_id     uuid,
  p_amount         numeric,
  p_paid_on        date,
  p_paid_by        text,
  p_credit_note_id uuid,
  p_recorded_by    uuid
) returns jsonb
language sql
set search_path = public, pg_temp
as $$
  select public.record_invoice_payment(p_restaurant_id, p_invoice_id, p_amount, p_paid_on,
                                       p_paid_by, p_credit_note_id, p_recorded_by, null::text);
$$;

comment on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) is
  'record_invoice_payment with no client key (F-1725 kept every earlier caller).';

-- ---------------------------------------------------------------------------
-- "Mark not paid": every copy's payments go, and come back to the caller.
-- ---------------------------------------------------------------------------
create or replace function public.clear_invoice_payments(
  p_restaurant_id uuid,
  p_invoice_id    uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  copies uuid[];
  gone   jsonb;
begin
  copies := public.invoice_bill_copies(p_restaurant_id, p_invoice_id);
  if copies is null then
    raise exception 'That invoice is not on file at this house.' using errcode = 'no_data_found';
  end if;
  perform 1 from public.procurement_documents
   where id = any (copies) order by id for update;
  with d as (
    delete from public.procurement_invoice_payments
     where invoice_id = any (copies) and restaurant_id = p_restaurant_id
    returning id, invoice_id, amount, currency, paid_on, paid_by, credit_note_id
  )
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into gone from d;
  update public.procurement_documents
     set paid_at = null, paid_by = null, paid_marked_at = null
   where id = any (copies);
  return gone;
end;
$$;

-- ---------------------------------------------------------------------------
-- One payment taken back (F-1721).
-- ---------------------------------------------------------------------------
create or replace function public.remove_invoice_payment(
  p_restaurant_id uuid,
  p_invoice_id    uuid,
  p_payment_id    uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  copies      uuid[];
  zone        text;
  gone        record;
  bill        record;
  last_pay    record;
  paid_so_far numeric;
  covered     boolean;
begin
  copies := public.invoice_bill_copies(p_restaurant_id, p_invoice_id);
  if copies is null then
    raise exception 'That invoice is not on file at this house.' using errcode = 'no_data_found';
  end if;
  perform 1 from public.procurement_documents
   where id = any (copies) order by id for update;
  delete from public.procurement_invoice_payments
   where id = p_payment_id and restaurant_id = p_restaurant_id and invoice_id = any (copies)
  returning id, invoice_id, amount, currency, paid_on, paid_by, credit_note_id, recorded_at
    into gone;
  if not found then
    raise exception 'That payment is not on this invoice. It may have been taken back already.'
      using errcode = 'no_data_found';
  end if;

  select effective_total as total, upper(trim(effective_currency)) as currency
    into bill
    from public.procurement_documents
   where id = any (copies)
   order by coalesce(status, '') in ('rejected', 'superseded'),
            coalesce(status, '') = 'verified' desc,
            created_at desc nulls last
   limit 1;
  select coalesce(sum(amount), 0) into paid_so_far
    from public.procurement_invoice_payments where invoice_id = any (copies);
  select paid_on, paid_by into last_pay
    from public.procurement_invoice_payments where invoice_id = any (copies)
   order by paid_on desc, recorded_at desc limit 1;
  covered := bill.total is not null and paid_so_far > 0
             and paid_so_far >= abs(bill.total) - 0.005;
  select timezone into zone from public.restaurants where id = p_restaurant_id;
  if zone is null or not exists (select 1 from pg_timezone_names where name = zone) then
    zone := 'UTC';
  end if;
  update public.procurement_documents
     set paid_at = case when covered then (last_pay.paid_on::timestamp + interval '12 hours') at time zone zone end,
         paid_by = case when covered then last_pay.paid_by end,
         paid_marked_at = case when covered then paid_marked_at end
   where id = any (copies);

  return jsonb_build_object(
    'removed', to_jsonb(gone),
    'paid_at', case when covered then (last_pay.paid_on::timestamp + interval '12 hours') at time zone zone end,
    'paid', paid_so_far,
    'left', case when bill.total is null then null else greatest(abs(bill.total) - paid_so_far, 0) end,
    'currency', bill.currency);
end;
$$;

comment on function public.remove_invoice_payment(uuid, uuid, uuid) is
  'Takes one payment on an invoice''s bill back (F-1721) and returns it, so the caller can log it; the bill reads paid only while what is left covers it.';

revoke all on function public.invoice_bill_copies(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.clear_invoice_payments(uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_invoice_payment(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.invoice_bill_copies(uuid, uuid) to service_role;
grant execute on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid, text) to service_role;
grant execute on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) to service_role;
grant execute on function public.clear_invoice_payments(uuid, uuid) to service_role;
grant execute on function public.remove_invoice_payment(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'uq_procurement_invoice_payments_client_key') THEN
    RAISE EXCEPTION 'the unique index on a payment''s client key is missing';
  END IF;
  IF has_function_privilege('anon', 'public.remove_invoice_payment(uuid, uuid, uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.remove_invoice_payment(uuid, uuid, uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid, text)', 'execute')
     OR has_function_privilege('authenticated', 'public.invoice_bill_copies(uuid, uuid)', 'execute') THEN
    RAISE EXCEPTION 'a client role can run an invoice payment function';
  END IF;
END $$;
