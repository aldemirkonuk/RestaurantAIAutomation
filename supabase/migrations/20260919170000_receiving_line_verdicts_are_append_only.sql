-- ---------------------------------------------------------------------------
-- A RECEIVING VERDICT IS AN APPEND-ONLY RECORD (ADR 0149 row 23; sketch
-- 107-receiving-structure, "The derivation rule").
--
-- WHAT THIS IS
-- ------------
-- [CORRECTED 2026-09-20, receiving round-5 must_fix pass: this header used
-- to claim this migration "closes the P14 fork ... in favour of the
-- record". OD-126 and `06-pages/receiving.md:115` both say it settles NONE
-- of P14, and a migration cannot be edited after it is applied — so this
-- note corrects the record rather than the SQL below.] The /receiving desk
-- rebuild (sketch 107, direction B+) does NOT close the P14 fork left open
-- in `06-pages/receiving.md` §14e.3 ("whether a verdict is a record or a
-- column") — that is OD-126's own fork
-- (`.planning/decisions/OPEN-DECISIONS.md`), and it is still open.
-- `verifyReceipt` today OVERWRITES `procurement_orders.match_status` /
-- `discrepancy_notes` with no re-verify guard, and sets `discrepancy_notes =
-- null` on a `matched` verdict — erasing the prior narrative. This table is
-- a second, additive ledger a manager appends to at the desk, ALONGSIDE
-- that still-open question rather than answering it: it does not change
-- what `verifyReceipt` writes today and does not touch
-- `procurement_receipt_events` (the door's own typed outcome, ADR 0062) —
-- see the note at the foot of this file for why, and OD-126 for the fork
-- this leaves open. NOT YET ANSWERED — do not build further on either side
-- of it without the founder's word (fixer review, 2026-09-18).
--
-- WHY IT KEYS ON `procurement_orders`, NOT `deliveries`
-- ------------------------------------------------------
-- Sketch 107's own proposed shape keys this table on the newer canonical
-- `deliveries` domain (ADR 0103/0104). This migration deliberately does not:
-- adopting that domain for `/receiving` is sketch 107's founder question 7
-- ("Does ADR 0104 D13 bind /receiving?"), filed as OD-125 — undecided. `/receiving`'s
-- manager queue reads `procurement_orders` today (receiving.service.ts
-- `managerQueue`), and every `procurement_orders` row is already one
-- vendor/item pairing — the smallest unit this page has authority over
-- without pre-empting that decision. `line_no` is kept (default 1) so a
-- later migration to genuine multi-line deliveries is additive, not a
-- rename.
--
-- WHY EVERY ROW ALSO CARRIES `qty_bottles`
-- -----------------------------------------
-- ADR 0070 (Locked) keeps quantities integer and makes each row state its
-- own unit — "5 cases" is never silently multiplied into "60 bottles" for
-- display. But the append-only invariant (no row may take more than its
-- target has left) has to compare quantities in ONE unit, and two rows on
-- the same line are routinely counted in different units (the sketch's own
-- fixture: v3 "accepted 1 case" is taken from by v4 "damaged 2 btl"). The
-- precedent is `procurement_receipt_events`, which already carries
-- `rejected_qty` in `counted_uom` AND `rejected_qty_bottles`
-- (`20260901220000_door_facts_are_columns`). This table does the same: `qty`
-- + `uom` is what the person actually counted in and is what renders;
-- `qty_bottles` is computed ONCE, server-side, via the same `toBottles()`
-- helper the door already uses, and is never re-derived in the client.
--
-- WHY APPEND-ONLY IS A TRIGGER, NOT AN RLS POLICY
-- -------------------------------------------------
-- The gateway holds the service-role key, which bypasses RLS — every table
-- in this schema is tenant-isolated by the gateway's own `.eq('restaurant_id',
-- …)` filter, not by a row policy (see `delivery-spine.service.ts`'s header).
-- An RLS policy restricting UPDATE/DELETE would therefore enforce nothing
-- against the one connection that matters. A `BEFORE UPDATE OR DELETE`
-- trigger runs for every role, service_role included, so that is the actual
-- enforcement here; RLS is still enabled with the repo's standard
-- service-role policy for consistency with every other procurement table.
--
-- WHY THE OVER-TAKE GUARD IS A TRIGGER, NOT A CHECK
-- ----------------------------------------------------
-- A CHECK constraint cannot read another row, and a per-row check would not
-- be enough either — two later rows can each take part of the same row and
-- together over-take it. This BEFORE INSERT trigger locks the named row
-- (`FOR UPDATE`), serialising concurrent appends against it, and raises
-- unless the sum of everything already taken from it plus this insert's
-- taking is within its own `qty_bottles`.
-- ---------------------------------------------------------------------------

create table if not exists public.receiving_line_verdicts (
  id                      uuid primary key default gen_random_uuid(),

  restaurant_id           uuid not null
                          references public.restaurants(id) on delete cascade,
  order_id                uuid not null
                          references public.procurement_orders(id) on delete cascade,
  -- Kept for forward-compatibility with a genuine multi-line delivery. Every
  -- `procurement_orders` row is one line today, so every write defaults this
  -- to 1; nothing currently reads a different value.
  line_no                 integer not null default 1,

  -- One verdict word, one quantity, one unit — never abbreviated, never
  -- blended (sketch 107, "The derivation rule").
  verdict                 text not null
                          check (verdict in ('accepted', 'short', 'refused', 'damaged')),
  qty                     integer not null check (qty > 0),
  uom                     text not null check (btrim(uom) <> ''),
  -- Computed once at write time via toBottles(qty, uom, order pack size).
  -- The comparison currency for the over-take guard and the derived view;
  -- never shown on its own as if it were what the person counted.
  qty_bottles             integer not null check (qty_bottles > 0),

  -- The person's own statement that this portion is over-delivery (more
  -- arrived than was ordered). Never derived — a person says so, or it is
  -- assumed within the order.
  beyond_order            boolean not null default false,

  reason                  text not null check (btrim(reason) <> ''),
  -- References, not blobs — mirrors `delivery_proposals.evidence`.
  evidence                jsonb,

  -- A row may take from an earlier row on the SAME order and line. The named
  -- row is never edited or deleted; it is drawn struck through and kept.
  -- NULL `supersedes_qty_bottles` means "all of it", evaluated against the
  -- named row's OWN qty_bottles (fixed forever, since rows are immutable).
  supersedes              uuid references public.receiving_line_verdicts(id),
  supersedes_qty_bottles  integer check (supersedes_qty_bottles is null or supersedes_qty_bottles > 0),

  recorded_by             uuid not null references public.users(user_id) on delete restrict,
  recorded_at             timestamptz not null default now(),
  -- When the tap happened, which may be long before it reached the server —
  -- same field name and purpose as `procurement_receipt_events.client_captured_at`.
  client_captured_at      timestamptz,
  -- Stable across retries, scoped per restaurant like the door's own receipts.
  idempotency_key         text,

  constraint receiving_line_verdicts_taking_names_its_source
    check (supersedes_qty_bottles is null or supersedes is not null)
);

create unique index if not exists receiving_line_verdicts_idempotency
  on public.receiving_line_verdicts (restaurant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists receiving_line_verdicts_by_order
  on public.receiving_line_verdicts (order_id, line_no, recorded_at);

create index if not exists receiving_line_verdicts_supersedes
  on public.receiving_line_verdicts (supersedes)
  where supersedes is not null;

comment on table public.receiving_line_verdicts is
  'Append-only receiving verdict ledger (ADR 0149 row 23). One row per portion of an order-line in one verdict; the current state is DERIVED (see receiving_line_verdict_current), never stored or overwritten. No UPDATE or DELETE — enforced by a trigger, since the gateway''s service-role connection bypasses RLS.';
comment on column public.receiving_line_verdicts.qty is
  'What was counted, in the unit the person actually counted in. Never re-multiplied for display — see qty_bottles for the comparison unit.';
comment on column public.receiving_line_verdicts.qty_bottles is
  'qty converted through the order''s own pack size at write time (toBottles()). The over-take guard and the derived view compare in this unit; the UI never re-derives it.';
comment on column public.receiving_line_verdicts.supersedes_qty_bottles is
  'Portion of the named row''s qty_bottles this row takes. NULL means all of it.';
comment on column public.receiving_line_verdicts.beyond_order is
  'The person''s statement that this portion is over-delivery (arrived beyond what was ordered). Never derived.';

alter table public.receiving_line_verdicts enable row level security;
drop policy if exists receiving_line_verdicts_service_role on public.receiving_line_verdicts;
create policy receiving_line_verdicts_service_role
  on public.receiving_line_verdicts for all to service_role using (true) with check (true);

-- ── append-only: no UPDATE, no DELETE, from any role ────────────────────────

create or replace function public.receiving_line_verdicts_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'receiving_line_verdicts is append-only: % is not permitted (row %). Append a new row that supersedes it instead.',
    tg_op, coalesce(old.id, new.id);
end;
$$;

drop trigger if exists receiving_line_verdicts_no_update on public.receiving_line_verdicts;
create trigger receiving_line_verdicts_no_update
  before update on public.receiving_line_verdicts
  for each row execute function public.receiving_line_verdicts_immutable();

drop trigger if exists receiving_line_verdicts_no_delete on public.receiving_line_verdicts;
create trigger receiving_line_verdicts_no_delete
  before delete on public.receiving_line_verdicts
  for each row execute function public.receiving_line_verdicts_immutable();

-- ── the over-take guard ──────────────────────────────────────────────────

create or replace function public.receiving_line_verdicts_guard_supersedes()
returns trigger
language plpgsql
as $$
declare
  target       public.receiving_line_verdicts%rowtype;
  taking       integer;
  already      integer;
begin
  if new.supersedes is null then
    return new;
  end if;

  if new.supersedes = new.id then
    raise exception 'a verdict row cannot supersede itself';
  end if;

  select * into target
    from public.receiving_line_verdicts
    where id = new.supersedes
    for update;

  if not found then
    raise exception 'supersedes % does not name an existing verdict row', new.supersedes;
  end if;

  if target.order_id <> new.order_id or target.line_no <> new.line_no then
    raise exception 'supersedes must name a row on the same order and line (target order %, line %; this row order %, line %)',
      target.order_id, target.line_no, new.order_id, new.line_no;
  end if;

  if target.restaurant_id <> new.restaurant_id then
    raise exception 'supersedes must name a row in the same restaurant';
  end if;

  taking := coalesce(new.supersedes_qty_bottles, target.qty_bottles);
  if taking > target.qty_bottles then
    raise exception 'cannot take % bottles from a row of % bottles (%)',
      taking, target.qty_bottles, target.id;
  end if;

  select coalesce(sum(
           case when v.supersedes_qty_bottles is null then target.qty_bottles
                else v.supersedes_qty_bottles end
         ), 0)
    into already
    from public.receiving_line_verdicts v
    where v.supersedes = new.supersedes;

  if already + taking > target.qty_bottles then
    raise exception 'over-take on row %: % already taken + % now = % bottles, more than its % bottles',
      target.id, already, taking, already + taking, target.qty_bottles;
  end if;

  -- Units honesty (fixer review, 2026-09-18): `keg` and `liter` deliberately
  -- do not convert to bottles (document-types.ts `toBottles`/`comparableUnits`)
  -- — a keg is not a number of bottles in any way a receiver would accept.
  -- `qty_bottles` is nonetheless numeric for both, so without this check a
  -- "damaged 2 bottle" row could take from a "accepted 2 keg" row and the
  -- over-take guard above would wave it through. This is the same rule the
  -- application layer enforces before it ever reaches this trigger
  -- (`comparableUnits` in receiving.service.ts `appendLineVerdict`) — kept
  -- here too because the trigger, not the app, is this table's actual
  -- enforcement (see the file header, "WHY APPEND-ONLY IS A TRIGGER").
  if new.uom <> target.uom
     and (new.uom in ('keg', 'liter') or target.uom in ('keg', 'liter')) then
    raise exception 'cannot take a % portion from a row counted in % — keg and liter never convert to another unit (row %)',
      new.uom, target.uom, target.id;
  end if;

  return new;
end;
$$;

drop trigger if exists receiving_line_verdicts_guard_supersedes on public.receiving_line_verdicts;
create trigger receiving_line_verdicts_guard_supersedes
  before insert on public.receiving_line_verdicts
  for each row execute function public.receiving_line_verdicts_guard_supersedes();

-- ── the derivation, not the latest row ──────────────────────────────────
--
-- Per (order, line, verdict, beyond_order, unit): sum(qty_bottles) of every
-- row carrying that verdict, minus what later rows took from each of them. A
-- row fully taken drops out (`remaining_bottles > 0`). Derived on read,
-- never stored — "current state = per verdict, the sum of quantities in
-- rows carrying that verdict, minus what later rows took from them."
--
-- `unit` (fixer review, 2026-09-18): `keg` and `liter` rows bucket under
-- their own literal unit rather than the shared `bottle` bucket every other
-- unit converts into — mixing a "damaged 2 keg" and a "damaged 2 bottle"
-- into one "damaged 4" figure would invent a conversion that never happened.
-- `qty_bottles` for a keg/liter row already just IS the counted quantity
-- (`toBottles` returns it unconverted), so no other column changes.
--
-- WITH (security_invoker = true) + the REVOKE/GRANT below: the repo's own
-- convention for a view over an RLS table (20260903171000, house_items) —
-- without it the view runs as its owner and its tenant isolation depends on
-- default-privilege ordering rather than a control (OD-94).

create or replace view public.receiving_line_verdict_current
with (security_invoker = true)
as
select
  v.restaurant_id,
  v.order_id,
  v.line_no,
  v.verdict,
  v.beyond_order,
  case when v.uom in ('keg', 'liter') then v.uom else 'bottle' end as unit,
  sum(v.qty_bottles - coalesce(
    (select sum(case when t.supersedes_qty_bottles is null then v.qty_bottles
                      else t.supersedes_qty_bottles end)
       from public.receiving_line_verdicts t
       where t.supersedes = v.id),
    0
  )) as current_qty,
  count(*) as entry_count,
  max(v.recorded_at) as last_recorded_at
from public.receiving_line_verdicts v
group by v.restaurant_id, v.order_id, v.line_no, v.verdict, v.beyond_order,
  (case when v.uom in ('keg', 'liter') then v.uom else 'bottle' end)
having sum(v.qty_bottles - coalesce(
  (select sum(case when t.supersedes_qty_bottles is null then v.qty_bottles
                    else t.supersedes_qty_bottles end)
     from public.receiving_line_verdicts t
     where t.supersedes = v.id),
  0
)) > 0;

comment on view public.receiving_line_verdict_current is
  'The derivation rule (sketch 107), not "latest row per line": current state per (order, line, verdict, beyond_order, unit) = sum(qty_bottles) minus what later rows took from each row. keg/liter bucket under their own unit, never merged into "bottle". Rows fully taken drop out. Never stored.';

revoke all on public.receiving_line_verdict_current from public, anon, authenticated;
grant select on public.receiving_line_verdict_current to service_role;

-- ---------------------------------------------------------------------------
-- LEFT OPEN, NAMED HERE SO IT IS NOT MISTAKEN FOR CLOSED (sketch 107
-- founder question 2): whether this ledger SUPERSEDES the door's own
-- `procurement_receipt_events.outcome` (ADR 0062), is DERIVED from it as v1,
-- or both are written under a reconciling guard. This migration writes only
-- what a person appends at the desk; `recordDoorReceipt` and
-- `procurement_receipt_events` are untouched, so a delivery today can carry
-- a door outcome and no desk verdict, and the two are not yet reconciled.
-- Filed as OD-126 (`.planning/decisions/OPEN-DECISIONS.md`) — unanswered as
-- of this migration; also carries the deliveries-vs-procurement_orders
-- keying question (OD-125).
--
-- ALSO LEFT OPEN (found by the fixer review, 2026-09-18, filed as OD-127):
-- `restaurant_id`/`order_id` are declared `on delete cascade` above, but the
-- append-only trigger refuses every DELETE unconditionally, including one
-- arriving via that cascade — measured on PGlite
-- (`p4-scratch/pglite-probe/pgrecv-verdict-ledger.mjs`). Deleting a house or
-- an order that holds one verdict row fails today; the declared FK behaviour
-- is not what the database actually does.
-- ---------------------------------------------------------------------------
