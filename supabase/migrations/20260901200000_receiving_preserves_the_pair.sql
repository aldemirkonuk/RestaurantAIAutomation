-- Receiving preserves the pair (ADR 0059).
--
-- THE RULE
-- --------
--   A machine proposal shown to a human is written before the human answers,
--   and the answer is appended, never substituted.
--
-- Receiving is the only place in this product where a number is produced by a
-- person touching an object. Six machine-proposes / human-judges pairs exist on
-- the receiving path, and four of them destroyed the machine's half at the exact
-- instant it became a label (`.planning/06-pages/receiving.md` §14d).
--
-- WHY NOW, AND ONLY NOW
-- ---------------------
-- Measured against production on 2026-09-01:
--
--   procurement_documents        0 rows
--   procurement_document_lines   0 rows
--   procurement_receipt_events   0 rows
--   procurement_credits          0 rows
--   procurement_orders           2 rows
--   procurement_order_items      1 row
--
-- Nothing needs migrating and nothing needs back-filling, because there is
-- nothing there. Every pair these tables will ever hold is written by the code
-- this migration serves. The same change against a year of rows is a back-fill
-- that cannot be done at all — the proposal half is not recoverable from the
-- confirmed half, by construction.
--
-- WHAT THIS IS NOT
-- ----------------
-- It is not an audit trail and it is not a second source of truth. Nothing in
-- the product reads these columns to decide anything: `match_confidence` /
-- `match_method` remain the live pairing state, `procurement_orders` remains the
-- order of record, and `restaurant_inventory` remains the only place a quantity
-- means anything. These columns exist so a model's answer and the human's answer
-- can be compared later, which today is impossible because only one of them
-- survives.
--
-- ADDITIVE ONLY. Every column is nullable; every table arrives with RLS.

-- ---------------------------------------------------------------------------
-- L1 — confirming a suggestion must not overwrite the model's score.
--
-- `documents.controller.ts` wrote `match_confidence: 1, match_method: "manual"`
-- on confirmation. That is not wrong as live state — a person did confirm it —
-- but it is written OVER the model's estimate, in the same two columns, at the
-- one moment the pair becomes a training label. Both halves now have a home.
-- ---------------------------------------------------------------------------

alter table public.procurement_document_lines
  add column if not exists proposed_confidence numeric(4,3),
  add column if not exists proposed_method     character varying(30),
  add column if not exists confirmed_by        uuid,
  add column if not exists confirmed_at        timestamp with time zone;

-- The actor FK targets public.users(user_id). NOT auth.users: the two tables are
-- DISJOINT in this database (zero shared ids) and the JWT carries
-- public.users.user_id, so an auth.users FK 23503s on every write — and CI
-- cannot catch it, because a fresh database has no rows to violate.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'procurement_document_lines_confirmed_by_fkey'
  ) then
    alter table public.procurement_document_lines
      add constraint procurement_document_lines_confirmed_by_fkey
      foreign key (confirmed_by) references public.users(user_id) on delete set null;
  end if;
end $$;

-- Same vocabulary as match_method, so a proposal and a confirmation can never
-- disagree about what a method name means.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'procurement_document_lines_proposed_method_check'
  ) then
    alter table public.procurement_document_lines
      add constraint procurement_document_lines_proposed_method_check
      check (
        proposed_method is null
        or proposed_method in
           ('vendor_sku','description','qty_price','manual','edi_reference')
      );
  end if;
end $$;

comment on column public.procurement_document_lines.proposed_confidence is
  'The model''s own score for this pairing, written when the pairing was PROPOSED and never touched again. match_confidence is live state and a human confirmation legitimately sets it to 1; this column is the half that used to be destroyed at that moment (ADR 0059).';

comment on column public.procurement_document_lines.proposed_method is
  'How the matcher arrived at this pairing, written at proposal time. Preserved separately from match_method for the same reason as proposed_confidence.';

comment on column public.procurement_document_lines.confirmed_by is
  'Who accepted or corrected the pairing. FK to public.users(user_id) — NOT auth.users, which is a disjoint table in this database.';

-- ---------------------------------------------------------------------------
-- L2 — the suggestions themselves.
--
-- `matchDocumentLines` writes only pairings above AUTO_MATCH_THRESHOLD. Every
-- other candidate came back on the HTTP response and was forgotten. Those are
-- the near-misses and the rejected pairs: the entire negative class of an
-- entity-resolution dataset, which is the half that teaches a matcher where its
-- boundary is. A corpus of accepted matches alone cannot.
--
-- Shape and posture copied from `photo_count_suggestions`
-- (20260827100000_photo_count_suggestions.sql), which solved the same problem
-- for photo counts: the model's answer and the truth existed at different times
-- and were never joined.
-- ---------------------------------------------------------------------------

create table if not exists public.procurement_line_match_suggestions (
  id                 uuid primary key default gen_random_uuid(),

  -- The footprint row this suggestion came from. NULLABLE on purpose: emission
  -- is fire-and-forget and can be dropped, and a dropped emit must not cost us
  -- the suggestion — it costs only the ability to attribute that one to a model.
  --
  -- DELIBERATE DEVIATION from photo_count_suggestions, which uses ON DELETE
  -- CASCADE. NF-B erasure is crypto-shredding (ADR 0037) and footprint rows are
  -- prunable; under CASCADE, erasing a model's footprint would silently delete
  -- the labels it produced. Losing attribution is the correct cost; losing the
  -- label is not.
  event_id           uuid references public.neural_footprint_event(id) on delete set null,

  restaurant_id      uuid not null,
  document_id        uuid not null
                     references public.procurement_documents(id) on delete cascade,
  document_line_id   uuid not null
                     references public.procurement_document_lines(id) on delete cascade,
  order_line_id      uuid not null
                     references public.procurement_order_items(id) on delete cascade,

  confidence         numeric(4,3),
  method             character varying(30),

  -- Same wine, different vintage or format. The single clearest thing that
  -- separates beverage from generic food-cost software, and the field a future
  -- matcher most needs supervision on: a substitution is neither a match nor a
  -- miss (line-matcher.ts, header comment).
  substitution       boolean not null default false,

  -- The plain-language sentence shown to whoever confirms. Kept because the
  -- explanation a human accepted or rejected is part of what they judged.
  reason             text,

  created_at         timestamptz not null default now(),

  -- Filled when a human answers. NULL is the work queue AND the honest measure
  -- of suggestions nobody ever acted on, which is itself a label: it is what
  -- `graded_at` is on the sibling table, named for what resolves it here.
  resolved_as        character varying(20),
  resolved_at        timestamptz,
  resolved_by        uuid,

  constraint procurement_line_match_suggestions_method_check
    check (method is null
           or method in ('vendor_sku','description','qty_price','manual','edi_reference')),
  constraint procurement_line_match_suggestions_resolved_as_check
    check (resolved_as is null or resolved_as in ('accepted','rejected','superseded')),
  -- resolved_as and resolved_at arrive together or not at all. Half a
  -- resolution reads as an unresolved row in one query and a resolved one in
  -- the next, which is exactly the ambiguity this table exists to remove.
  constraint procurement_line_match_suggestions_resolution_complete
    check ((resolved_as is null) = (resolved_at is null))
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'procurement_line_match_suggestions_resolved_by_fkey'
  ) then
    alter table public.procurement_line_match_suggestions
      add constraint procurement_line_match_suggestions_resolved_by_fkey
      foreign key (resolved_by) references public.users(user_id) on delete set null;
  end if;
end $$;

-- One document line paired with one order line is ONE proposal. Re-running the
-- matcher restates it; it does not make a new one. Without this, the five-minute
-- intake sweep turns every unresolved suggestion into a pile.
create unique index if not exists procurement_line_match_suggestions_pair
  on public.procurement_line_match_suggestions (document_line_id, order_line_id);

-- The work queue: unresolved suggestions for one document. Partial, because
-- resolved rows are history and are never scanned this way.
create index if not exists procurement_line_match_suggestions_pending
  on public.procurement_line_match_suggestions (document_id, created_at desc)
  where resolved_at is null;

comment on table public.procurement_line_match_suggestions is
  'Every pairing the line matcher considered plausible but did not write, plus what a human later did with it. The negative class of the line-matching dataset, which used to vanish on the HTTP response (ADR 0059). Not read by the product: procurement_document_lines.order_line_id remains the only place a pairing means anything.';

comment on column public.procurement_line_match_suggestions.resolved_as is
  'NULL = nobody has answered yet. That is the queue, and it is also the honest count of suggestions nobody acted on. ''superseded'' is a suggestion invalidated by a different pairing being confirmed for the same line — not a human rejection, and it must not be scored as one.';

comment on column public.procurement_line_match_suggestions.event_id is
  'Nullable, ON DELETE SET NULL. A dropped or erased footprint costs attribution, never the label.';

alter table public.procurement_line_match_suggestions enable row level security;

-- RLS in the SAME migration that creates the table, WITH a policy rather than
-- policy-less: a no-policy table is closed only by ABSENCE, and the next person
-- to add one silently opens the whole table (OD-73, 2026-08-26).
drop policy if exists procurement_line_match_suggestions_service_role
  on public.procurement_line_match_suggestions;
create policy procurement_line_match_suggestions_service_role
  on public.procurement_line_match_suggestions
  for all to service_role using (true) with check (true);

-- No `authenticated` policy, deliberately: nothing client-side reads this. When
-- a product surface needs it, that is a decision with an ADR and a
-- restaurant-isolation policy, not a bare `using (true)`.
--
-- No REVOKE line: OD-72's `alter default privileges ... revoke all ... from
-- anon, authenticated` means anything created after it arrives with no client
-- grant already.

-- ---------------------------------------------------------------------------
-- L3 — what the door's paper actually said.
--
-- `DoorNext.tsx` pre-fills the box count from the packing-slip parse and then
-- sends only the final number. Whether the receiver ACCEPTED the machine's
-- reading or OVERRODE it is the highest-value wine-specific label the door can
-- produce — it is a human, holding the physical cases, grading a vision model on
-- a photograph of the paper next to them — and it was thrown away in the
-- browser.
-- ---------------------------------------------------------------------------

alter table public.procurement_receipt_events
  add column if not exists suggested_qty        numeric(12,3),
  add column if not exists suggestion_accepted  boolean;

comment on column public.procurement_receipt_events.suggested_qty is
  'What the machine read off the photographed paper, in counted_uom, at the moment the count screen was pre-filled. NULL = no suggestion was offered (offline, unreadable, or no photo) — which is different from a suggestion of zero.';

comment on column public.procurement_receipt_events.suggestion_accepted is
  'TRUE = the receiver sealed the number the machine proposed. FALSE = they overrode it. NULL = there was no proposal to accept, so there is nothing to grade. Absence is not agreement (ADR 0059).';

-- ---------------------------------------------------------------------------
-- L4 — what the verify form proposed before the manager corrected it.
--
-- `ReceivingWorkspace.tsx` fills four fields from the extraction and submits
-- whatever survived. A manager correcting a misread invoice quantity from 22 to
-- 24 is the cleanest possible extraction label, and it left no trace: the final
-- 24 is indistinguishable from a 24 the model read correctly.
--
-- These are the PROPOSED values. The confirmed ones stay where they are
-- (invoice_quantity, invoice_unit_price, ...), unchanged and still the record.
-- ---------------------------------------------------------------------------

alter table public.procurement_orders
  add column if not exists prefilled_invoice_quantity    integer,
  add column if not exists prefilled_invoice_unit_price  numeric(10,2),
  add column if not exists prefilled_shipped_quantity    integer,
  add column if not exists prefilled_free_goods_quantity integer;

comment on column public.procurement_orders.prefilled_invoice_quantity is
  'What the extraction proposed in the verify form, before the human answered. NULL = the form was not pre-filled from a document, so the final value is not a correction of anything (ADR 0059).';

comment on column public.procurement_orders.prefilled_invoice_unit_price is
  'As prefilled_invoice_quantity, for the unit price.';

comment on column public.procurement_orders.prefilled_shipped_quantity is
  'As prefilled_invoice_quantity, for the packing-slip shipped quantity.';

comment on column public.procurement_orders.prefilled_free_goods_quantity is
  'As prefilled_invoice_quantity, for free goods.';

-- ---------------------------------------------------------------------------
-- L6 — an extraction that can be attributed to a model.
--
-- `extraction_model` has existed since the document spine and has never had a
-- writer (L5, fixed in the gateway). Even with it written, there is no way to
-- reach the footprint row for the call that produced the document — so no
-- extraction can be tied to a model version, a latency, or a cost.
-- ---------------------------------------------------------------------------

alter table public.procurement_documents
  add column if not exists event_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'procurement_documents_event_id_fkey'
  ) then
    alter table public.procurement_documents
      add constraint procurement_documents_event_id_fkey
      foreign key (event_id) references public.neural_footprint_event(id)
      on delete set null;
  end if;
end $$;

comment on column public.procurement_documents.event_id is
  'The neural-footprint row for the extraction call that produced this document. Nullable and ON DELETE SET NULL: emission is fire-and-forget and footprints are erasable (ADR 0037), so a missing event costs attribution and never the document.';

comment on column public.procurement_documents.extraction_model is
  'The model that read this document. Had no writer at all until ADR 0059 — every row said NULL, which read as "no model was involved" rather than "nobody recorded which one".';
