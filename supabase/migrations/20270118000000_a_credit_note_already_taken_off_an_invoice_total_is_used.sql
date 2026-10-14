-- A credit note the vendor already took off an invoice's printed total.
-- (Wave 109, sim-ledger S236/S237 owed item 1. Additive: one new table, two
-- new functions, and record_invoice_payment replaced with one more line; nothing
-- dropped, no backfill.)
--
-- WHY
-- ---
-- A vendor often prints the invoice with its credit already taken off: INV-905
-- for 10.000 less credit note CN-88's 1.200 is printed at 8.800. The credit
-- note is then used, but nothing could say so. Recording it as a payment by
-- credit (20270117100000) would take 1.200 off the 8.800 a second time; leaving
-- it unrecorded kept CN-88 coming off what the vendor is owed.
--
-- WHAT
-- ----
-- `procurement_credit_taken_on_invoice`: one row per credit note per invoice
-- whose printed total already has (part of) that credit taken off. It is NOT a
-- payment: it does not change what is left on the invoice, and "mark not paid"
-- (clear_invoice_payments) leaves it alone. It only uses up the credit note.
--
-- `record_credit_taken_on_invoice` is the one writer, with the same rules a
-- payment by credit has (coordinator's call S235/S237, industry standard): the
-- SAME vendor, the SAME currency, never more than the credit note has left.
-- Amount absent = all the credit it has left. `clear_credit_taken_on_invoice`
-- removes one such row and returns it, so the caller can log what went.
--
-- `record_invoice_payment` now counts credit taken this way as used, so the
-- same credit cannot also pay another invoice.
--
-- Read and written only by the gateway (service role), scoped to the house on
-- the token. Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the
-- Supabase CLI wraps each migration file in a transaction.

create table if not exists public.procurement_credit_taken_on_invoice (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null
                  references public.restaurants(id) on delete cascade,
  -- NO ACTION, not cascade: paper money was settled against is not removed
  -- quietly. (A house's removal still cascades through all three.)
  credit_note_id  uuid not null
                  references public.procurement_documents(id),
  invoice_id      uuid not null
                  references public.procurement_documents(id),
  amount          numeric(12,2) not null check (amount > 0),
  -- Always the invoice's (and so the credit note's) currency; the writer refuses anything else.
  currency        varchar(3) not null,
  recorded_by     uuid,
  recorded_at     timestamptz not null default now(),
  -- Said once per credit note per invoice; to change it, remove it and say it again.
  constraint procurement_credit_taken_on_invoice_once unique (credit_note_id, invoice_id)
);

comment on table public.procurement_credit_taken_on_invoice is
  'A credit note the vendor already took off an invoice''s printed total (wave 109, S237): uses the credit up without paying the invoice. '
  'Written only by record_credit_taken_on_invoice; removed only by clear_credit_taken_on_invoice. No rows before 2027-01-18.';

create index if not exists idx_procurement_credit_taken_on_invoice_invoice
  on public.procurement_credit_taken_on_invoice (invoice_id);
create index if not exists idx_procurement_credit_taken_on_invoice_house
  on public.procurement_credit_taken_on_invoice (restaurant_id);

-- ---------------------------------------------------------------------------
-- Locked down in the SAME migration that creates it (OD-72 / OD-73 house rule).
-- ---------------------------------------------------------------------------
alter table public.procurement_credit_taken_on_invoice enable row level security;

drop policy if exists procurement_credit_taken_on_invoice_service_role on public.procurement_credit_taken_on_invoice;
create policy procurement_credit_taken_on_invoice_service_role
  on public.procurement_credit_taken_on_invoice
  for all to service_role using (true) with check (true);

revoke all on public.procurement_credit_taken_on_invoice from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The one writer.
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
  select id, doc_type, provider_id, upper(trim(currency)) as currency
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
  select id, doc_type, provider_id, upper(trim(currency)) as currency, total, status
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

-- Undo it: the row goes, and comes back to the caller.
create or replace function public.clear_credit_taken_on_invoice(
  p_restaurant_id  uuid,
  p_invoice_id     uuid,
  p_credit_note_id uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  gone jsonb;
begin
  with d as (
    delete from public.procurement_credit_taken_on_invoice
     where invoice_id = p_invoice_id and credit_note_id = p_credit_note_id
       and restaurant_id = p_restaurant_id
    returning amount, currency, credit_note_id, invoice_id
  )
  select to_jsonb(d) into gone from d;
  if gone is null then
    raise exception 'That credit note is not said to be taken off this invoice.' using errcode = 'no_data_found';
  end if;
  return gone;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_invoice_payment (20270117100000), unchanged but for one thing: credit
-- taken off an invoice's printed total is used, so it cannot pay a bill too.
-- ---------------------------------------------------------------------------
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

  select id, doc_type, provider_id, upper(trim(currency)) as currency, total, status
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
    select id, doc_type, provider_id, upper(trim(currency)) as currency, total, status
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

revoke all on function public.record_credit_taken_on_invoice(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public.clear_credit_taken_on_invoice(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_credit_taken_on_invoice(uuid, uuid, uuid, numeric, uuid) to service_role;
grant execute on function public.clear_credit_taken_on_invoice(uuid, uuid, uuid) to service_role;
grant execute on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls     boolean;
  grants  int;
BEGIN
  IF to_regclass('public.procurement_credit_taken_on_invoice') IS NULL THEN
    RAISE EXCEPTION 'procurement_credit_taken_on_invoice was not created';
  END IF;
  SELECT relrowsecurity INTO rls
    FROM pg_class WHERE oid = to_regclass('public.procurement_credit_taken_on_invoice');
  IF NOT rls THEN
    RAISE EXCEPTION 'procurement_credit_taken_on_invoice has row level security OFF';
  END IF;
  SELECT count(*) INTO grants FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'procurement_credit_taken_on_invoice'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION 'procurement_credit_taken_on_invoice: % client grant(s) remain', grants;
  END IF;
  IF has_function_privilege('anon', 'public.record_credit_taken_on_invoice(uuid, uuid, uuid, numeric, uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.clear_credit_taken_on_invoice(uuid, uuid, uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid)', 'execute') THEN
    RAISE EXCEPTION 'a client role can run the credit-taken or invoice payment functions';
  END IF;
END $$;
