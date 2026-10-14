-- An invoice keeps each payment made on it, and the credit note a payment used.
-- (F-1672, F-1674, sim-ledger S235/S236. Additive: one new table and two
-- functions; nothing altered, nothing dropped, no backfill.)
--
-- WHY
-- ---
-- An invoice could only be marked paid in full, today, by "the restaurant"
-- (`procurement_documents.paid_at`/`paid_by`, ADR 0103 A3). So:
--   * a payment in two instalments could not be recorded: unmarked, Owed kept
--     the whole bill; marked, the rest of it left Owed (F-1674);
--   * a payment made last week was dated today (F-1674);
--   * nothing could say an invoice was settled with a credit note, so Owed took
--     that credit note off the vendor's other bills as well (F-1672).
--
-- WHAT
-- ----
-- `procurement_invoice_payments`: one row per payment on one invoice — the
-- amount, in the invoice's own currency, the day it was paid, how it was paid,
-- and, when a credit note paid it, which one. Coordinator's call, S235
-- (industry standard): a credit note pays only an invoice of the SAME vendor
-- in the SAME currency, and never for more than is left on either.
--
-- `record_invoice_payment` is the one writer. It locks the invoice (and the
-- credit note), checks the above, writes the row, and keeps ADR 0103 A3's
-- facts on the invoice: `paid_at` is set — to the day of the payment that
-- covered the bill — once the payments cover the printed total, and cleared
-- while they do not. `clear_invoice_payments` is "mark not paid": it removes
-- the invoice's payments and returns them, so the caller can log what went.
--
-- An invoice with no printed total yet can still be marked paid in full
-- (no amount): that sets `paid_at` with no payment row, as before. A part
-- payment on it is refused, since nothing says what is left.
--
-- Invoices marked paid before this migration keep `paid_at`/`paid_by` and have
-- no payment rows (no backfill): their payment is "the whole bill".
--
-- Read and written only by the gateway (service role), scoped to the house on
-- the token. Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the
-- Supabase CLI wraps each migration file in a transaction.

create table if not exists public.procurement_invoice_payments (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null
                  references public.restaurants(id) on delete cascade,
  -- NO ACTION, not cascade: an invoice that money was paid on is not removed
  -- quietly. (A house's removal still cascades through both.)
  invoice_id      uuid not null
                  references public.procurement_documents(id),
  amount          numeric(12,2) not null check (amount > 0),
  -- Always the invoice's own currency; the writer refuses anything else.
  currency        varchar(3) not null,
  paid_on         date not null,
  paid_by         text not null check (paid_by in
                  ('eft_wholesaler_initiated','restaurant','credit_applied','other')),
  credit_note_id  uuid references public.procurement_documents(id),
  recorded_by     uuid,
  recorded_at     timestamptz not null default now(),
  -- A payment by credit names its credit note, and only such a payment does.
  constraint procurement_invoice_payments_credit_named
    check ((paid_by = 'credit_applied') = (credit_note_id is not null))
);

comment on table public.procurement_invoice_payments is
  'One row per payment on a vendor invoice (F-1672, F-1674): amount in the invoice''s currency, the day paid, how, and the credit note it used. '
  'Written only by record_invoice_payment; removed only by clear_invoice_payments. No rows before 2027-01-17.';

create index if not exists idx_procurement_invoice_payments_invoice
  on public.procurement_invoice_payments (invoice_id);
create index if not exists idx_procurement_invoice_payments_credit_note
  on public.procurement_invoice_payments (credit_note_id)
  where credit_note_id is not null;
create index if not exists idx_procurement_invoice_payments_house
  on public.procurement_invoice_payments (restaurant_id);

-- ---------------------------------------------------------------------------
-- Locked down in the SAME migration that creates it (OD-72 / OD-73 house rule).
-- ---------------------------------------------------------------------------
alter table public.procurement_invoice_payments enable row level security;

drop policy if exists procurement_invoice_payments_service_role on public.procurement_invoice_payments;
create policy procurement_invoice_payments_service_role
  on public.procurement_invoice_payments
  for all to service_role using (true) with check (true);

revoke all on public.procurement_invoice_payments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The one writer.
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
  'Records one payment on a vendor invoice (F-1672, F-1674): a credit note pays only the same vendor''s invoice in the same currency, never past what is left on either; paid_at is set once payments cover the printed total.';

-- "Mark not paid": the invoice's payments go, and come back to the caller.
create or replace function public.clear_invoice_payments(
  p_restaurant_id uuid,
  p_invoice_id    uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  gone jsonb;
begin
  perform 1 from public.procurement_documents
   where id = p_invoice_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'That invoice is not on file at this house.' using errcode = 'no_data_found';
  end if;
  with d as (
    delete from public.procurement_invoice_payments
     where invoice_id = p_invoice_id and restaurant_id = p_restaurant_id
    returning amount, currency, paid_on, paid_by, credit_note_id
  )
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into gone from d;
  update public.procurement_documents
     set paid_at = null, paid_by = null
   where id = p_invoice_id and restaurant_id = p_restaurant_id;
  return gone;
end;
$$;

revoke all on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.clear_invoice_payments(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid) to service_role;
grant execute on function public.clear_invoice_payments(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls     boolean;
  grants  int;
BEGIN
  IF to_regclass('public.procurement_invoice_payments') IS NULL THEN
    RAISE EXCEPTION 'procurement_invoice_payments was not created';
  END IF;
  SELECT relrowsecurity INTO rls
    FROM pg_class WHERE oid = to_regclass('public.procurement_invoice_payments');
  IF NOT rls THEN
    RAISE EXCEPTION 'procurement_invoice_payments has row level security OFF';
  END IF;
  SELECT count(*) INTO grants FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'procurement_invoice_payments'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION 'procurement_invoice_payments: % client grant(s) remain', grants;
  END IF;
  IF has_function_privilege('anon', 'public.record_invoice_payment(uuid, uuid, numeric, date, text, uuid, uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.clear_invoice_payments(uuid, uuid)', 'execute') THEN
    RAISE EXCEPTION 'a client role can run the invoice payment functions';
  END IF;
END $$;
