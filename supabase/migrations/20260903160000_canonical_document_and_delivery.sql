-- The canonical document and the delivery it belongs to (ADR 0104 slice 1; ADR 0103 schema).
--
-- WHAT THIS IS
-- ------------
-- ADR 0103 D1 says a delivery is its own thing with its own states, agreed by
-- both sides before it is verified by the restaurant. ADR 0104 D7 says that
-- delivery — not the invoice — is the unit of record every document attaches to.
-- Today neither exists: `procurement_documents` has a lifecycle
-- (baseline 20260805000000:4464-4466) while the commercial event it describes has
-- none, so "received 10 vs billed 12" has nowhere to be computed and a duplicate
-- is detectable only by invoice number.
--
-- This migration is SCHEMA ONLY. Nothing in this slice writes a delivery, a
-- revision or a proposal; no stock path is touched; no route is exposed. It is
-- additive: every new column is nullable or defaulted, nothing is dropped, and
-- the only constraint that changes is `procurement_documents_doc_type_check`,
-- which is WIDENED (every existing literal survives, so every existing row and
-- every existing `DOC_TYPES` consumer keeps working).
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------
--   * `PAID` is not a delivery state. ADR 0103 A3: under AB 2991 the wholesaler
--     debits on day 30 whether or not the dispute is settled, so payment is a
--     FACT ON THE INVOICE (`paid_at`, `paid_by` below), reachable from any state.
--   * The Turkish e-İrsaliye response window and invoice-issuance clock are NOT
--     seeded. ADR 0103 A8 holds them open for a YMM: a delivery at the
--     restaurant's own premises may carry no 7-day window at all. Seeding 7 days
--     would be this repo's absence-as-health fault with a legal deadline attached.
--     See the comment on `vendor_terms` for what a MISSING row must mean in code.
--   * The escalation poller of ADR 0103 D9/A10 is not here; only the columns it
--     will work (`owner_user_id`, `deputy_user_id`) are.
--
-- ACTOR FKs reference `public.users(user_id)`, never `auth.users`. The two tables
-- are DISJOINT in this database (zero shared ids) and the JWT carries
-- `public.users.user_id`, so an FK to `auth.users` 23503s on every write and CI
-- cannot catch it — a fresh database has no rows to violate.

-- ---------------------------------------------------------------------------
-- 0. Append-only enforcement, shared by the two revision tables.
--
-- ADR 0104 D5: "Corrections are append-only revisions with who/when/
-- what-was-there-before ... the INSERT-only rule is proven by an attempted
-- UPDATE in a test." A trigger, not a convention: the gateway holds the service
-- role, so a policy that only constrains `authenticated` constrains nothing, and
-- an UPDATE issued by a future code path would silently rewrite history that a
-- vendor dispute depends on.
-- ---------------------------------------------------------------------------

create or replace function public.refuse_append_only_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    '% is append-only (ADR 0104 D5): % refused. Record a new revision or correction instead.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.refuse_append_only_mutation is
  'Raises on any UPDATE or DELETE. Attached to document_revisions and document_corrections so the append-only rule of ADR 0104 D5 is enforced by the database rather than by every future caller remembering it.';

-- ---------------------------------------------------------------------------
-- 1. deliveries — the commercial event (ADR 0103 D1, ADR 0104 D7).
-- ---------------------------------------------------------------------------

create table if not exists public.deliveries (
  id              uuid primary key default gen_random_uuid(),

  restaurant_id   uuid not null
                  references public.restaurants(id) on delete cascade,

  -- NULL is honest: an UNORDERED delivery from a vendor we have no row for is
  -- exactly the case ADR 0103 D5 exists to represent, and inventing a provider
  -- to satisfy a NOT NULL would manufacture the evidence the match tests.
  provider_id     uuid references public.providers(id) on delete set null,

  -- ADR 0103 D1. ACKNOWLEDGED and IN_TRANSIT may be skipped; RECONCILING may
  -- loop; AGREED and VERIFIED are never collapsed — agreement is about the
  -- document, verification is about the goods and the books.
  -- LAPSED (D9) records what the law deems when a clock expires with no human
  -- action; LAPSED_AMENDED (A4) is where a late credit memo or corrected invoice
  -- lands, without overwriting what was deemed on the lapse date.
  state           text not null
                  check (state in (
                    'ORDERED','ACKNOWLEDGED','IN_TRANSIT','DELIVERED',
                    'RECONCILING','AGREED','VERIFIED','INVOICE_FILED',
                    'LAPSED','LAPSED_AMENDED','CANCELLED','REJECTED')),

  -- ADR 0103 D5. A permanent mark, not a workflow step: reporting must be able
  -- to answer "what share of spend was never ordered", and the retroactive
  -- purchase order this replaces made that unanswerable by construction.
  provenance      text not null default 'ORDERED'
                  check (provenance in ('ORDERED','UNORDERED')),

  delivered_at    timestamptz,
  agreed_at       timestamptz,
  verified_at     timestamptz,
  verified_by     uuid references public.users(user_id) on delete set null,

  -- ADR 0103 D9: every open delivery has an owner and a deputy so the queue can
  -- never fall back into an unowned backlog. Columns only in this slice — the
  -- durable `due_at` poller (A10) is not built here.
  owner_user_id   uuid references public.users(user_id) on delete set null,
  deputy_user_id  uuid references public.users(user_id) on delete set null,

  -- ADR 0104 D8: an unknown jurisdiction blocks ingest rather than defaulting,
  -- because retention floors and every clock in vendor_terms key off it.
  jurisdiction    text check (jurisdiction in ('TR','US-CA','unknown')),

  -- ADR 0104 S2: sha256 over restaurant_id | provider_id | delivery date |
  -- content hash of the primary document. restaurant_id is INSIDE the key on
  -- purpose — without it, a shared vendor delivering to two sibling locations
  -- the same morning merges as a duplicate.
  dedupe_key      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Partial, so the many deliveries with no primary document yet (ORDERED, before
-- anything arrives) do not collide with each other on NULL.
create unique index if not exists deliveries_restaurant_dedupe_key
  on public.deliveries (restaurant_id, dedupe_key)
  where dedupe_key is not null;

-- "What is open at this restaurant" — the receiving queue and the escalation
-- ladder both read this shape.
create index if not exists deliveries_restaurant_state
  on public.deliveries (restaurant_id, state);

comment on table public.deliveries is
  'One physical delivery — the commercial event of ADR 0103 D1 and the unit of record of ADR 0104 D7. The PO, the door document, the door count, the invoice and the credit memo all attach to it through document_deliveries. Duplicate detection is by event, not by invoice number.';
comment on column public.deliveries.state is
  'ADR 0103 D1. AGREED (both sides on the record) and VERIFIED (the restaurant asserted receipt) are never collapsed. PAID is deliberately absent — see procurement_documents.paid_at (A3).';
comment on column public.deliveries.provenance is
  'ADR 0103 D5. UNORDERED is permanent provenance for a delivery no order preceded; the retroactive-order endpoint that used to manufacture one is retired.';
comment on column public.deliveries.dedupe_key is
  'ADR 0104 S2: sha256 of restaurant_id | provider_id | delivery date | primary document content hash. NULL until a primary document exists; the unique index is partial for that reason.';
comment on column public.deliveries.jurisdiction is
  'ADR 0104 D8. ''unknown'' is a real value that BLOCKS, never a synonym for "no rule applies".';
comment on column public.deliveries.owner_user_id is
  'ADR 0103 D9. public.users(user_id), not auth.users — the two are disjoint here. NULL until the delivery is claimed; the escalation poller (A10) is not built in this slice.';

alter table public.deliveries enable row level security;
drop policy if exists deliveries_service_role on public.deliveries;
create policy deliveries_service_role
  on public.deliveries for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. document_deliveries — the many-to-many join (ADR 0104 S5, ADR 0103 A2).
--
-- Not a `procurement_documents.delivery_id` FK. Cardinality is many-to-many in
-- BOTH directions and both directions are real: produce, dairy and imported-goods
-- distributors send consolidated weekly invoices (N deliveries per document), a
-- split shipment carries several partial invoices, and one truck can be invoiced
-- by two legal entities.
-- ---------------------------------------------------------------------------

create table if not exists public.document_deliveries (
  document_id  uuid not null
               references public.procurement_documents(id) on delete cascade,
  delivery_id  uuid not null
               references public.deliveries(id) on delete cascade,

  -- What this document IS to this delivery. Distinct from procurement_documents.
  -- doc_type: the same physical paper can be a `despatch_advice` on one delivery
  -- and an `invoice` on another when a consolidated invoice covers several.
  role         text not null
               check (role in ('purchase_order','despatch_advice','door_count',
                               'invoice','credit_memo','statement','other')),

  created_at   timestamptz not null default now(),

  primary key (document_id, delivery_id)
);

create index if not exists document_deliveries_delivery
  on public.document_deliveries (delivery_id);

comment on table public.document_deliveries is
  'ADR 0104 S5 / ADR 0103 A2. N documents per delivery AND N deliveries per document. The "received 10 vs billed 12" column is computed per (document line, delivery) pair, which is only expressible because this is a join and not a foreign key on the document.';
comment on column public.document_deliveries.role is
  'The document''s role IN THIS delivery, which is not the same question as its doc_type: a consolidated invoice is the `invoice` of several deliveries at once.';

alter table public.document_deliveries enable row level security;
drop policy if exists document_deliveries_service_role on public.document_deliveries;
create policy document_deliveries_service_role
  on public.document_deliveries for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. delivery_proposals — every contradiction, kept (ADR 0103 D7, A5).
--
-- This is what replaces `syncOrderState`'s silent drop
-- (common/orchestrator/inbound-responder.service.ts:1088), which puts a vendor
-- reply that CONTRADICTS the order into free-text negotiation metadata and moves
-- on. A contradiction is a first-class row here, with a reason class, a side, a
-- number and evidence.
-- ---------------------------------------------------------------------------

create table if not exists public.delivery_proposals (
  id                   uuid primary key default gen_random_uuid(),

  delivery_id          uuid not null
                       references public.deliveries(id) on delete cascade,

  -- Which document (and which line of it) the proposal is about. NULL when the
  -- proposal is about the delivery as a whole — a short ship of a line that
  -- appears on no document at all is exactly the case ADR 0104 D13 says the
  -- event-first model must be able to state.
  document_id          uuid references public.procurement_documents(id) on delete set null,
  line_no              integer,

  -- ADR 0103 D3: AGREED requires both positions ON THE RECORD. `side` is what
  -- makes "the vendor never answered" a readable fact rather than an inference.
  side                 text not null check (side in ('restaurant','vendor')),

  -- ADR 0103 D7. WRONG_VENUE never enters RECONCILING — it is a rejection.
  -- FREE_GOODS is kept out of COGS and price history and tagged as a compliance
  -- record. VINTAGE_CHANGE is a substitution, not a tolerance (A9).
  reason               text not null
                       check (reason in ('SHORT_SHIP','OVER_SHIP','SUBSTITUTION',
                                         'VINTAGE_CHANGE','PRICE_VARIANCE','DAMAGED',
                                         'WRONG_VENUE','DUPLICATE_DOCUMENT',
                                         'FREE_GOODS','DEPOSIT_OR_FEE')),

  qty_proposed         numeric(12,3),
  unit_price_proposed  numeric(12,4),
  money_at_risk        numeric(12,2),

  -- REFERENCES, not blobs: storage paths, signature ids, note ids. A photo in a
  -- jsonb column would be read on every proposal list.
  evidence             jsonb not null default '[]'::jsonb,

  status               text not null default 'open'
                       check (status in ('open','accepted','countered','withdrawn')),

  proposed_by          uuid references public.users(user_id) on delete set null,
  proposed_at          timestamptz not null default now(),
  responded_at         timestamptz
);

create index if not exists delivery_proposals_delivery_open
  on public.delivery_proposals (delivery_id, status);

comment on table public.delivery_proposals is
  'Every position either side put on the record about a delivery (ADR 0103 D7). Replaces the silent-drop branch in syncOrderState (A5): a vendor reply that contradicts the order becomes a row with a reason class, not free text in negotiation metadata.';
comment on column public.delivery_proposals.evidence is
  'References to photos, signatures and notes — never the bytes themselves.';
comment on column public.delivery_proposals.money_at_risk is
  'What this proposal is worth if it is wrong. Drives routing and the notification thresholds of ADR 0103 D8; never auto-accepts anything.';

alter table public.delivery_proposals enable row level security;
drop policy if exists delivery_proposals_service_role on public.delivery_proposals;
create policy delivery_proposals_service_role
  on public.delivery_proposals for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. vendor_terms — clocks are data (ADR 0103 D4, A8).
--
-- READ THIS BEFORE WRITING THE READER. A MISSING ROW IS NOT "NO DEADLINE".
-- ADR 0103 D4: "Every clock has an explicit `unknown` value that blocks and
-- asks — a jurisdiction with no rule row never renders as 'no deadline'." The
-- Turkish e-İrsaliye response window and invoice-issuance clock are deliberately
-- NOT seeded here (A8: whether a delivery at the restaurant's own premises has a
-- 7-day window at all is a question for a YMM, and the founder chose on
-- 2026-09-03 to keep it open). So the first code that reads this table must
-- treat "no row" the same way it treats basis='unknown': block and ask. If it
-- instead returns null and the screen renders no chip, this repo's
-- absence-reported-as-health fault will have acquired a legal deadline.
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_terms (
  id                     uuid primary key default gen_random_uuid(),

  -- NULL restaurant_id = a PLATFORM DEFAULT row; NULL provider_id = applies to
  -- every vendor in that scope. A tenant or vendor override is the same table
  -- with the id filled in, so precedence is a query, not a second table.
  restaurant_id          uuid references public.restaurants(id) on delete cascade,
  provider_id            uuid references public.providers(id) on delete cascade,

  jurisdiction           text not null check (jurisdiction in ('TR','US-CA','unknown')),

  -- California's 30-day EFT clock is an ALCOHOL rule (BPC 25509, AB 2991); the
  -- produce delivery on the same truck is not subject to it.
  beverage_class         text not null default 'any'
                         check (beverage_class in ('any','alcohol','non_alcohol')),

  -- Free text, not a CHECK: it must be able to name a document type that
  -- procurement_documents.doc_type does not yet carry (an e-İrsaliye Yanıtı, an
  -- EDI 855) without a migration, and a wrong value here fails to match a clock
  -- rather than corrupting one.
  document_type          text not null,

  clock                  text not null
                         check (clock in ('door_correction','response_window',
                                          'invoice_issuance','objection_window','payment')),

  -- NULL means the number is NOT KNOWN, which under D4 blocks. It never means
  -- "no limit".
  days                   integer,

  -- ADR 0103 A8. The basis is the half that the Turkish research could not close:
  -- dispatch date and delivery date are different days for the same goods.
  basis                  text not null default 'unknown'
                         check (basis in ('dispatch_date','delivery_date',
                                          'document_issue_date','unknown')),

  initiator              text check (initiator in ('wholesaler_eft','restaurant','cod','net_terms')),

  -- ADR 0103 D3: the US alcohol norm is that the signed door ticket is final.
  -- Per-vendor, defaulting to false — assuming it would turn a signature into an
  -- agreement the restaurant never gave.
  signed_ticket_is_final boolean not null default false,

  -- WHO OR WHAT SET THIS, with a date. A8 requires the YMM's answer and their
  -- name to land here when the Turkish rows are finally seeded.
  source                 text,

  created_at             timestamptz not null default now()
);

-- One clock per scope. Expression index because NULL means "applies to all" here
-- and a plain UNIQUE would let two platform rows for the same clock coexist —
-- NULLs never collide in a b-tree unique constraint.
create unique index if not exists vendor_terms_scope_clock_uniq
  on public.vendor_terms (
    coalesce(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(provider_id,   '00000000-0000-0000-0000-000000000000'::uuid),
    jurisdiction, beverage_class, document_type, clock
  );

comment on table public.vendor_terms is
  'Clocks as data (ADR 0103 D4). A MISSING ROW MEANS UNKNOWN AND MUST BLOCK — never "no deadline". The Turkish response-window and invoice-issuance rows are intentionally absent pending a YMM answer (A8); only clocks the ADRs state as fact are seeded.';
comment on column public.vendor_terms.restaurant_id is
  'NULL = platform default. A tenant override is the same shape with an id, so precedence is one ORDER BY rather than a second table.';
comment on column public.vendor_terms.days is
  'NULL = the number is not known, which blocks under D4. It is never "unlimited".';
comment on column public.vendor_terms.basis is
  'ADR 0103 A8: which date the clock counts from. ''unknown'' is the seeded value wherever the research could not close it.';
comment on column public.vendor_terms.source is
  'Who or what set this row, with a date — the YMM''s name and answer date go here when the Turkish rows are seeded (A8).';

alter table public.vendor_terms enable row level security;
drop policy if exists vendor_terms_service_role on public.vendor_terms;
create policy vendor_terms_service_role
  on public.vendor_terms for all to service_role using (true) with check (true);

-- Two platform rows, and only two. Each is a value an ADR states as FACT with a
-- statute behind it; every other clock stays absent so that reading it is
-- forced to say "unknown" rather than "none".
--
--   US-CA alcohol invoice payment  30 days from DELIVERY, wholesaler-initiated
--                                  EFT — 27 CFR 6.65 / BPC 25509 (operative
--                                  2026-01-01) / AB 2991, quoted in ADR 0103
--                                  Context and D4.
--   TR    any     invoice objection 8 days from the invoice's issue/receipt —
--                                  TTK 21/2, quoted in ADR 0103 Context and D4.
--
-- Guarded by NOT EXISTS rather than ON CONFLICT because the uniqueness is an
-- expression index over coalesced NULLs.
insert into public.vendor_terms
  (restaurant_id, provider_id, jurisdiction, beverage_class, document_type, clock,
   days, basis, initiator, signed_ticket_is_final, source)
-- signed_ticket_is_final stays FALSE even here. ADR 0103 D3 makes it a
-- PER-VENDOR setting ("a door signature where a per-vendor setting says the
-- signed delivery ticket is final"); asserting it platform-wide would turn every
-- Californian signature into an agreement the restaurant never gave.
select null, null, 'US-CA', 'alcohol', 'invoice', 'payment',
       30, 'delivery_date', 'wholesaler_eft', false,
       'Platform default seeded 2026-09-03 from ADR 0103 D4 (27 CFR 6.65; BPC 25509 operative 2026-01-01; AB 2991 wholesaler-initiated EFT).'
where not exists (
  select 1 from public.vendor_terms
   where restaurant_id is null and provider_id is null
     and jurisdiction = 'US-CA' and beverage_class = 'alcohol'
     and document_type = 'invoice' and clock = 'payment');

insert into public.vendor_terms
  (restaurant_id, provider_id, jurisdiction, beverage_class, document_type, clock,
   days, basis, initiator, signed_ticket_is_final, source)
select null, null, 'TR', 'any', 'invoice', 'objection_window',
       8, 'document_issue_date', null, false,
       'Platform default seeded 2026-09-03 from ADR 0103 D4 (TTK 21/2 — an invoice may be objected to within 8 days, after which it is deemed accepted).'
where not exists (
  select 1 from public.vendor_terms
   where restaurant_id is null and provider_id is null
     and jurisdiction = 'TR' and beverage_class = 'any'
     and document_type = 'invoice' and clock = 'objection_window');

-- ---------------------------------------------------------------------------
-- 5. document_revisions — layer 1 as ONE JSONB document per revision
--    (ADR 0104 D1 + S1).
--
-- D1 as first written modelled the per-field envelope as one ROW per field per
-- revision. The scale pass measured that at ~9M rows a year for a single
-- 30-location tenant before anyone corrects anything, so S1 changed the storage
-- shape and kept the semantics: the whole EXTRACTED layer is one JSONB document,
-- and the append-only table below holds only the corrections.
-- ---------------------------------------------------------------------------

create table if not exists public.document_revisions (
  id           uuid primary key default gen_random_uuid(),

  document_id  uuid not null
               references public.procurement_documents(id) on delete cascade,

  revision     integer not null,

  -- The canonical EXTRACTED document: every field as
  -- { value, unit?, currency?, source, confidence, page?, bbox?, as_printed?, revision }.
  -- Shape and invariants live in apps/api-gateway/src/procurement/canonical/.
  layer1       jsonb not null,

  -- ADR 0104 D1. `learned_from_vendor` is load-bearing: a value recalled from
  -- correction history must never masquerade as one read off the page.
  source       text not null
               check (source in ('extracted','embedded_xml','edi','portal',
                                 'learned_from_vendor','carried_from_po',
                                 'human_entered','human_corrected','computed')),

  created_by   uuid references public.users(user_id) on delete set null,
  created_at   timestamptz not null default now(),

  unique (document_id, revision)
);

create index if not exists document_revisions_document_latest
  on public.document_revisions (document_id, revision desc);

comment on table public.document_revisions is
  'Layer 1 (EXTRACTED) of the canonical document, one JSONB document per revision (ADR 0104 D1 as amended by S1). APPEND-ONLY: the trigger below refuses UPDATE and DELETE. A correction is a new revision, never an edit.';
comment on column public.document_revisions.layer1 is
  'Every field as a per-field envelope carrying value, source, confidence, page/bbox and as_printed. as_printed keeps the literal glyphs so the screen can always show what the paper said next to what we concluded.';
comment on column public.document_revisions.source is
  'Where THIS revision came from. `learned_from_vendor` marks a value recalled from correction history so it can never be mistaken for one read from the document.';

drop trigger if exists document_revisions_append_only on public.document_revisions;
create trigger document_revisions_append_only
  before update or delete on public.document_revisions
  for each row execute function public.refuse_append_only_mutation();

alter table public.document_revisions enable row level security;
drop policy if exists document_revisions_service_role on public.document_revisions;
create policy document_revisions_service_role
  on public.document_revisions for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 6. document_corrections — who changed what, and what was there before
--    (ADR 0104 D5).
-- ---------------------------------------------------------------------------

create table if not exists public.document_corrections (
  id            uuid primary key default gen_random_uuid(),

  document_id   uuid not null
                references public.procurement_documents(id) on delete cascade,

  -- The revision this correction PRODUCED, so the before/after can always be
  -- replayed against the layer1 document it applies to.
  revision      integer not null,

  -- Dotted path into layer1, e.g. `lines[3].BT-129` or `header.BT-2`.
  field_path    text not null,

  before        jsonb,
  after         jsonb,

  corrected_by  uuid references public.users(user_id) on delete set null,
  corrected_at  timestamptz not null default now()
);

create index if not exists document_corrections_document
  on public.document_corrections (document_id, corrected_at desc);

comment on table public.document_corrections is
  'The audit half of ADR 0104 D5: who corrected which field, when, and what was there before. APPEND-ONLY by trigger. This is also the input to the slice-4 mapping memory (S8: the latest human-confirmed correction wins).';
comment on column public.document_corrections.before is
  'The envelope as it stood. NULL means the field did not exist in the prior revision — distinct from a field whose value was null.';

drop trigger if exists document_corrections_append_only on public.document_corrections;
create trigger document_corrections_append_only
  before update or delete on public.document_corrections
  for each row execute function public.refuse_append_only_mutation();

alter table public.document_corrections enable row level security;
drop policy if exists document_corrections_service_role on public.document_corrections;
create policy document_corrections_service_role
  on public.document_corrections for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 7. procurement_documents — direction, retention, payment fact, intake verdict,
--    and five more document types.
-- ---------------------------------------------------------------------------

alter table public.procurement_documents
  add column if not exists direction      text not null default 'issued_by_vendor',
  add column if not exists jurisdiction   text,
  add column if not exists retain_until   date,
  add column if not exists legal_hold     boolean not null default false,
  add column if not exists paid_at        timestamptz,
  add column if not exists paid_by        text,
  add column if not exists intake_verdict text,
  add column if not exists intake_reason  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'procurement_documents_direction_check') then
    alter table public.procurement_documents
      add constraint procurement_documents_direction_check
      check (direction in ('issued_by_vendor','issued_by_us'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'procurement_documents_jurisdiction_check') then
    alter table public.procurement_documents
      add constraint procurement_documents_jurisdiction_check
      check (jurisdiction is null or jurisdiction in ('TR','US-CA','unknown'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'procurement_documents_paid_by_check') then
    alter table public.procurement_documents
      add constraint procurement_documents_paid_by_check
      check (paid_by is null or paid_by in
             ('eft_wholesaler_initiated','restaurant','credit_applied','other'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'procurement_documents_intake_verdict_check') then
    alter table public.procurement_documents
      add constraint procurement_documents_intake_verdict_check
      check (intake_verdict is null or intake_verdict in
             ('ok','blank_page','duplicate','bundle','low_resolution','unreadable'));
  end if;
end;
$$;

comment on column public.procurement_documents.direction is
  'ADR 0104 S6. A Turkish `iade faturası` is OURS — the reverse of a vendor credit memo — and reads as a broken vendor document unless direction is a field. Defaults to issued_by_vendor because every existing row is one.';
comment on column public.procurement_documents.jurisdiction is
  'ADR 0104 D8. Drives the retention floor (TTK 82: ten years for TR; the US/California floor is seven) and every clock lookup in vendor_terms. NULL on rows written before this migration; not backfilled, because a guessed jurisdiction is a guessed legal deadline.';
comment on column public.procurement_documents.retain_until is
  'The date this document may be deleted, computed from (jurisdiction, doc_type) by the retention rule of ADR 0104 D8. NULL = not yet computed, which must block deletion rather than permit it.';
comment on column public.procurement_documents.legal_hold is
  'Blocks deletion regardless of retain_until, including through churn (ADR 0104 D8: the tenant gets a signed export and we hold our copy to the floor).';
comment on column public.procurement_documents.paid_at is
  'ADR 0103 A3: payment is a FACT ON THE INVOICE, not a state on the pipeline. Under AB 2991 the wholesaler debits on day 30 whether or not the dispute is settled, so this can be set in any delivery state — "paid while disputed" is a named condition, not an impossible one.';
comment on column public.procurement_documents.intake_verdict is
  'ADR 0104 D6, SHAPE ONLY in this slice — no gate computes it yet. A document that fails intake carries its reason on the record instead of aging silently in needs_review.';
comment on column public.procurement_documents.intake_reason is
  'The human sentence behind intake_verdict ("page 2 of 3 is blank"), shown to the uploader at once.';

-- doc_type is WIDENED, never narrowed: every literal in the shipped constraint
-- survives, so existing rows and the `DOC_TYPES` const in
-- apps/api-gateway/src/procurement/documents/document-types.ts (mirrored in the
-- same PR) keep working.
--
--   receiving_advice  OUR door count (ADR 0104 D2/D11) — the document that makes
--                     "received" a fact rather than an inference.
--   delivery_note     irsaliye / e-İrsaliye / despatch advice (ADR 0103 D2).
--   informal_note     ADR 0104 S6 — the farmer's handwritten slip. A legally
--                     normal transaction must not read like a broken intake.
--   price_list        a vendor price sheet (ADR 0104 D2).
--   portal_export     a CSV/PDF pulled from a distributor portal (D2).
alter table public.procurement_documents
  drop constraint if exists procurement_documents_doc_type_check;
alter table public.procurement_documents
  add constraint procurement_documents_doc_type_check
  check (doc_type::text in (
    'purchase_order','packing_slip','delivery_receipt','invoice','credit_memo',
    'statement','unknown',
    'receiving_advice','price_list','portal_export','delivery_note','informal_note'));

-- ---------------------------------------------------------------------------
-- 8. Deliveries and stock (ADR 0103 A1/A2) — COLUMNS ONLY.
--
-- A1 reconciles D1 with the shipped door: on-hand moves at DELIVERED from the
-- door count with the lot marked `provisional`; COGS, vendor spend and price
-- history post at VERIFIED. A delivery stuck in RECONCILING is pourable and
-- absent from cost reports.
--
-- NOTHING IN THIS SLICE WRITES EITHER COLUMN, and `apply_stock_movement` is not
-- touched — the stock write path stays exactly as it is
-- (scripts/check_no_direct_stock_writes.sh).
-- ---------------------------------------------------------------------------

alter table public.inventory_transactions
  add column if not exists delivery_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_transactions_delivery_id_fkey') then
    alter table public.inventory_transactions
      add constraint inventory_transactions_delivery_id_fkey
      foreign key (delivery_id) references public.deliveries(id) on delete set null;
  end if;
end;
$$;

create index if not exists inventory_transactions_delivery
  on public.inventory_transactions (delivery_id)
  where delivery_id is not null;

alter table public.inventory_lots
  add column if not exists cost_state text not null default 'final';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_cost_state_check') then
    alter table public.inventory_lots
      add constraint inventory_lots_cost_state_check
      check (cost_state in ('provisional','final'));
  end if;
end;
$$;

comment on column public.inventory_transactions.delivery_id is
  'ADR 0103 A2: stock idempotency is keyed to the DELIVERY, not the order. Today''s `order-delivered:${orderId}` key silently drops the second truck of a split shipment. Column only in this slice — no writer yet.';
comment on column public.inventory_lots.cost_state is
  'ADR 0103 A1. `provisional` = stock booked at the door before the invoice was agreed; `final` = cost posted at VERIFIED. Defaults to `final` because every existing lot predates the door/verification split and marking them provisional would be a retroactive claim that their cost is unsettled. Column only in this slice — no writer yet.';
