-- purchase_reasons — the "why" that has to be captured at ORDERING or not at all.
--
-- Dashboard rebuild spec §3.2. The chef's constraint decided the design twice
-- over, and both halves are enforced here rather than left to the UI:
--
--   1. "Paragraphs are dead on arrival."  So the reason is a CODE from a closed
--      set of five, not prose. `note` exists for the later voice-note addition
--      and is never required, never parsed, and never the thing a read renders.
--
--   2. "It appears at ORDERING, not receiving. Ordering is the one moment I
--      already have intent in my head... Ask me then or you've lost the window."
--      Receiving is chaos and a weeks-later flag cannot recover the reason.
--
-- Enforcing (2) is the interesting part. A `captured_stage text default
-- 'ordering'` column would have been a lie waiting to happen: it records what
-- the writer CLAIMS, so a reason typed in three weeks late would still read
-- "captured at ordering". Instead this table stores
-- `order_status_at_capture` — the status the order was actually in at the
-- moment the row was written, read from procurement_orders inside the write
-- path. That is a measured fact. A reader can then say "recorded while the
-- order was still PENDING" and be right, or say "recorded after delivery" and
-- be right, without either being inferred. ADR 0051: a surface shows live data
-- or says it does not know.
--
-- Grain
-- -----
-- `procurement_orders` is one row per inventory item (it carries
-- `inventory_id NOT NULL` and a single `quantity`), so one order IS one
-- purchased line. One reason per order is therefore one reason per purchase,
-- which is exactly the tap the chef described. `unique (order_id)` makes a
-- second tap an update, not a duplicate — re-tapping a different chip corrects
-- the reason rather than appending a contradictory one.
--
-- `inventory_id` is denormalised off the order deliberately: the read that
-- needs this is the dead/idle-stock strip (spec §2.5), which is keyed by
-- inventory item, not by order. Denormalising turns that read from a join
-- across procurement into a single indexed lookup, and the FK below keeps it
-- honest.
--
-- What this table is NOT
-- ----------------------
-- It is not an approval, not an audit trail, and not an input to any stock or
-- money figure. Nothing computes from it. Its entire job is to let a surface
-- that is about to call an item "dead stock" say WHY it is sitting there — and,
-- where no row exists, to say "no reason recorded" rather than guess one.

create table if not exists public.purchase_reasons (
  id            uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null,

  -- The purchase this reason explains. Cascade: if the order is gone the
  -- reason explains nothing.
  order_id      uuid not null
                references public.procurement_orders(id) on delete cascade,

  -- Denormalised from the order so the dead-stock read is one lookup.
  inventory_id  uuid not null
                references public.restaurant_inventory(id) on delete cascade,

  -- The five chips, exactly as the spec names them. A closed set, because an
  -- open text field is the paragraph the chef said would be dead on arrival.
  -- Adding a sixth is a decision with an ADR, not a string a caller invents.
  reason_code   text not null check (reason_code in (
                  'event_hold',
                  'seasonal_trial',
                  'slow_mover',
                  'bought_wrong',
                  'aging_on_purpose'
                )),

  -- Optional, and optional forever. Reserved for the voice note the spec
  -- describes as "a later addition, never a requirement". No read renders it
  -- as the reason.
  note          text,

  -- Measured, not claimed: the order's real status when this row was written.
  -- This is what lets a reader distinguish a reason captured in the moment
  -- from one backfilled later, without either side being inferred.
  order_status_at_capture text not null,

  captured_at   timestamptz not null default now(),
  captured_by   uuid,

  updated_at    timestamptz not null default now(),

  -- One reason per purchase. A second tap corrects; it does not accumulate.
  unique (order_id)
);

-- The dead/idle-stock read: latest reason for a set of inventory items in one
-- restaurant. restaurant_id leads because every read on this table is
-- tenant-scoped (spec §6) and no aggregate may assume a single tenant.
create index if not exists purchase_reasons_by_item
  on public.purchase_reasons (restaurant_id, inventory_id, captured_at desc);

comment on table public.purchase_reasons is
  'Why a purchase was made, captured at ORDERING (dashboard rebuild spec §3.2). One row per procurement order. Nothing computes from it; it exists so a surface calling stock "dead" can say why it is sitting there, and say "no reason recorded" when it cannot.';

comment on column public.purchase_reasons.reason_code is
  'One of five preset chips. Closed set on purpose — free text was rejected as "dead on arrival". A sixth chip is an ADR, not a new string.';

comment on column public.purchase_reasons.order_status_at_capture is
  'The procurement order status READ AT WRITE TIME, not a claim by the writer. A `captured_stage` column would record intent; this records fact, so "recorded at ordering" is verifiable rather than inferred (ADR 0051).';

comment on column public.purchase_reasons.note is
  'Optional free text, reserved for the later voice-note addition. Never required and never rendered as the reason.';

-- ---------------------------------------------------------------------------
-- RLS in the SAME migration that creates the table.
--
-- House rule out of OD-73: a table arrives locked or it does not arrive. This
-- one carries restaurant_id and FKs into two tenant tables, so it is tenant
-- data.
--
-- RLS-enabled-WITH-a-service-role-policy, not RLS-with-no-policy: no-policy is
-- closed only by ABSENCE, and the next person to add one silently opens the
-- whole table.
alter table public.purchase_reasons enable row level security;

drop policy if exists purchase_reasons_service_role on public.purchase_reasons;
create policy purchase_reasons_service_role
  on public.purchase_reasons
  for all to service_role using (true) with check (true);

-- No `authenticated` policy: the gateway is the only reader and it holds the
-- service role. When a client-side surface needs direct PostgREST access that
-- is a decision with an ADR and a restaurant-isolation policy, not a bare
-- `using (true)`.
--
-- No REVOKE line: OD-72's `alter default privileges ... revoke all ... from
-- anon, authenticated` (20260825210000:183) means anything created after it
-- arrives with no client grant already.
