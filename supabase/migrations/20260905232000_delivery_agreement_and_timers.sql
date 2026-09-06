-- The delivery's doors: agreement, counters, and durable clocks (ADR 0103 D3/D7/D9/A4/A10).
--
-- WHAT THIS IS
-- ------------
-- Slice 1 built `deliveries`, `document_deliveries`, `delivery_proposals` and
-- `vendor_terms` as SCHEMA ONLY — no route wrote any of them. Slice 3 stop 2
-- opens those doors, and three things the doors need have nowhere to live yet:
--
--   1. WHICH RULE FIRED AT AGREED. ADR 0103 D3 gives two ways to reach `AGREED`:
--      both sides on the record, or a per-vendor `signed_ticket_is_final` with a
--      signed door document. A state column that does not say WHICH cannot be
--      audited — six months later "we agreed" is a claim with no evidence
--      behind it, and the two rules carry very different weight in a dispute.
--
--   2. A COUNTER IS A REPLY TO A SPECIFIC PROPOSAL. Without the link, a thread
--      of six rows is a pile, and "the vendor countered our short-ship claim
--      with a credit" is not reconstructable.
--
--   3. THE CLOCKS ARE DURABLE ROWS. ADR 0103 A10: "D9's timers are `due_at` rows
--      worked by an idempotent poller that catches up after a missed tick (a
--      deploy, a crash); never in-process timers — the scale pass named this as
--      the place the absence-as-health fault would return." An in-process timer
--      that a deploy ate reports a Turkish 7-day window as "not due" for ever.
--
-- WHAT A MISSING CLOCK MEANS, AGAIN. `vendor_terms` has no Turkish
-- response-window or invoice-issuance row and deliberately will not until a YMM
-- answers (ADR 0103 A8). So `delivery_timers` carries `state = 'blocked_unknown'`
-- with a NULL `due_at` for exactly that case: the timer EXISTS, it is visible, it
-- asks — and it never fires. A design that simply wrote no row would have
-- rendered "no deadline", which is D4's named failure.
--
-- NOTHING HERE TOUCHES STOCK. `inventory_lots.cost_state` and
-- `inventory_transactions.delivery_id` were added as columns in slice 1 and,
-- measured on this tree, still have ZERO writers. `VERIFIED` therefore does NOT
-- set `cost_state = final` in this stop — the door path does not write the
-- column, so a verify that set it would be the only writer and would be marking
-- lots final that were never marked provisional. Consolidating
-- `recordDoorReceipt` / `markDelivered` onto the delivery (ADR 0103 A5) is its
-- own stop, and it is named rather than half-done here.
--
-- ACTOR FKs reference `public.users(user_id)`, never `auth.users` — the two are
-- disjoint in this database and a FK to `auth.users` 23503s on every write.

-- ---------------------------------------------------------------------------
-- 1. deliveries — the order it came from, the rule that agreed it, the lapse.
-- ---------------------------------------------------------------------------

alter table public.deliveries
  add column if not exists order_id     uuid references public.procurement_orders(id) on delete set null,
  add column if not exists agreed_rule  text,
  add column if not exists agreed_by    uuid references public.users(user_id) on delete set null,
  add column if not exists lapsed_at    timestamptz,
  add column if not exists lapse_deemed text,
  add column if not exists amended_at   timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deliveries_agreed_rule_check') then
    alter table public.deliveries
      add constraint deliveries_agreed_rule_check
      check (agreed_rule is null or agreed_rule in
             ('both_sides_recorded','signed_ticket_is_final'));
  end if;
end;
$$;

create index if not exists deliveries_order
  on public.deliveries (order_id)
  where order_id is not null;

comment on column public.deliveries.order_id is
  'The purchase order this delivery fulfils, when one preceded it. NULL is the UNORDERED case of ADR 0103 D5 and is why `provenance` is a separate, permanent mark rather than a derived "order_id is null".';
comment on column public.deliveries.agreed_rule is
  'ADR 0103 D3: WHICH rule reached AGREED — `both_sides_recorded` (a position from each side, nothing left open) or `signed_ticket_is_final` (the per-vendor US alcohol norm, with a signed door document). Recorded because the two carry different weight in a dispute and "we agreed" with no rule named is unauditable.';
comment on column public.deliveries.lapse_deemed is
  'ADR 0103 D9: what the LAW now deems, in words, on the date the clock expired — never a claim that the restaurant agreed. Frozen at the lapse; a later document moves the state to LAPSED_AMENDED (A4) and leaves this alone.';

-- ---------------------------------------------------------------------------
-- 2. delivery_proposals — a counter is a reply to one proposal.
-- ---------------------------------------------------------------------------

alter table public.delivery_proposals
  add column if not exists note                 text,
  add column if not exists counters_proposal_id uuid references public.delivery_proposals(id) on delete set null,
  add column if not exists responded_by         uuid references public.users(user_id) on delete set null;

create index if not exists delivery_proposals_counters
  on public.delivery_proposals (counters_proposal_id)
  where counters_proposal_id is not null;

comment on column public.delivery_proposals.counters_proposal_id is
  'The proposal this one answers. Without it a thread of six rows is a pile, and "the vendor countered our short ship with a credit" cannot be reconstructed.';
-- The column has carried no unit since slice 1, and a unitless quantity is how
-- `rejectedQty` once booked 33 bottles of live stock for a refused delivery. The
-- unit is stated here and in the DTO's field NAME (`qtyProposedBottles`),
-- because JSON carries no comments and a prose declaration crosses no wire.
comment on column public.delivery_proposals.qty_proposed is
  'IN BOTTLE-EQUIVALENTS, always — the unit every quantity comparison in this codebase uses (documents/document-types.ts#toBottles). Never the counted number in the document''s own unit.';
comment on column public.delivery_proposals.note is
  'The human sentence beside the numbers. Distinct from `evidence`, which holds REFERENCES to photos and documents, never prose and never bytes.';

-- ---------------------------------------------------------------------------
-- 3. delivery_timers — the durable clocks of ADR 0103 D9 / A10.
-- ---------------------------------------------------------------------------

create table if not exists public.delivery_timers (
  id             uuid primary key default gen_random_uuid(),

  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  delivery_id    uuid not null references public.deliveries(id) on delete cascade,

  -- The e-İrsaliye response window and the invoice objection window are about a
  -- DOCUMENT; the door-correction window is about the delivery (ADR 0103 A2).
  document_id    uuid references public.procurement_documents(id) on delete cascade,

  clock          text not null
                 check (clock in ('door_correction','response_window',
                                  'invoice_issuance','objection_window','payment')),

  -- The vendor_terms row this was derived from, so a rule that later changes is
  -- traceable to the timers it produced.
  terms_id       uuid references public.vendor_terms(id) on delete set null,

  basis          text not null default 'unknown'
                 check (basis in ('dispatch_date','delivery_date',
                                  'document_issue_date','unknown')),
  -- The date the clock counts FROM. NULL when the basis is unknown or the date
  -- it needs is not on the record.
  basis_at       timestamptz,

  -- NULL means THIS CLOCK CANNOT BE COMPUTED and the timer never fires. It is
  -- never "no deadline" — `state` says which of the two it is.
  due_at         timestamptz,

  --  open            computed, waiting
  --  blocked_unknown the rule is missing or its basis is `unknown` (ADR 0103 D4
  --                  and A8). Visible, asks a human, NEVER fires.
  --  notified_half   the owner was re-notified at 50 % of the window (D9)
  --  escalated       the deputy/owner was escalated to at 80 %, floored at 48 h
  --  fired           the clock expired and the delivery was moved to LAPSED
  --  cancelled       the delivery reached AGREED/VERIFIED or was rejected first
  state          text not null default 'open'
                 check (state in ('open','blocked_unknown','notified_half',
                                  'escalated','fired','cancelled')),

  notified_half_at timestamptz,
  escalated_at     timestamptz,
  fired_at         timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ONE timer per (delivery, document, clock). The poller is idempotent because
-- of this index and the three `*_at` stamps: a catch-up run after a missed tick
-- re-reads the same rows and skips every rung it has already climbed.
-- Expression index because document_id is NULL for delivery-level clocks and
-- NULLs never collide in a plain UNIQUE.
create unique index if not exists delivery_timers_scope_uniq
  on public.delivery_timers (
    delivery_id,
    coalesce(document_id, '00000000-0000-0000-0000-000000000000'::uuid),
    clock
  );

-- The poller's own query: what is due, oldest first.
create index if not exists delivery_timers_due
  on public.delivery_timers (due_at)
  where state in ('open','notified_half','escalated');

comment on table public.delivery_timers is
  'ADR 0103 D9 / A10 — the escalation ladder as DURABLE ROWS. An idempotent poller works `due_at` and catches up after a missed tick; there are no in-process timers, because a deploy eating one would report a legal deadline as "not due" for ever. A clock that cannot be computed is a row in `blocked_unknown` that asks and never fires — never an absent row, which would render as "no deadline" (ADR 0103 D4).';
comment on column public.delivery_timers.due_at is
  'NULL means the clock could NOT be computed. `state = blocked_unknown` says so. It never means "no limit".';
comment on column public.delivery_timers.state is
  'The rung of the ladder this timer has climbed. The three `*_at` stamps beside it are what make the poller idempotent: a catch-up run re-reads the same rows and skips every rung already stamped.';

alter table public.delivery_timers enable row level security;
drop policy if exists delivery_timers_service_role on public.delivery_timers;
create policy delivery_timers_service_role
  on public.delivery_timers for all to service_role using (true) with check (true);
