-- =============================================================================
-- ADR 0104 D12 slice 4 — the line-to-item mapping memory.
--
-- A person links an invoice line to a shelf once; the product remembers the
-- pairing for that vendor and PROPOSES it next time. A proposal is a tick, never
-- a number (ADR 0104: never a confidence to a person) and never a booking
-- (ADR 0103 A12: a line books stock only when a caller supplies the shelf).
--
-- WHY AN EVENT LOG AND NOT A ROW PER PAIRING.
-- The memory must FORGET, not average (the founder's rule for a pairing that was
-- wrong once). A mutable row with a `times_confirmed` counter cannot forget: an
-- un-link either destroys the history that shows the mistake, or leaves a
-- counter that keeps voting for the wrong shelf. So every act is one immutable
-- row — `linked` or `unlinked` — and the memory's CURRENT answer is the latest
-- row for the key. An `unlinked` row is a real answer meaning "there is no
-- memory here"; it is not the absence of one. `times_confirmed` is therefore
-- DERIVED (count of `linked` rows since the last `unlinked`), never stored:
-- a stored counter on an append-only table would be a number nobody can correct.
--
-- The append-only rule is enforced by the same trigger `document_corrections`
-- uses (`refuse_append_only_mutation`, ADR 0104 D5), so a future caller cannot
-- quietly UPDATE the memory into agreement with itself.
--
-- THE KEY. Per (restaurant, provider) — a pairing is one venue's, never global,
-- and never shared between two vendors who print the same words.
--   * `vendor_sku`  — the distributor's own identifier, folded with the printed
--                     vintage. A SKU reused for a new vintage is a DIFFERENT key
--                     and therefore produces NO proposal: silence, not last
--                     year's shelf.
--   * `description` — the normalised description folded with format and vintage,
--                     for the vendors who print no SKU.
-- A vendor that changes a SKU simply has no memory for the new one. That is the
-- honest answer and the safe direction.
-- =============================================================================

create table if not exists public.document_line_mappings (
  id             uuid primary key default gen_random_uuid(),

  restaurant_id  uuid not null
                 references public.restaurants(id) on delete cascade,

  -- The vendor the pairing belongs to. A document with no provider cannot teach
  -- the memory anything (there is nobody to remember it FOR), so the writer
  -- skips it and says so rather than writing a provider-less row that would
  -- later propose one vendor's shelf for another's paper.
  provider_id    uuid not null,

  key_kind       text not null
                 check (key_kind in ('vendor_sku', 'description')),
  -- Normalised. The raw text the person actually saw is kept beside it so the
  -- log can show what was on the paper, not our folded form of it.
  key_value      text not null check (length(key_value) > 0),
  key_display    text,

  action         text not null check (action in ('linked', 'unlinked')),

  -- The shelf. NOT NULL on `linked`, NULL on `unlinked` — an unlink names no
  -- item because it asserts that no item is right.
  inventory_id   uuid references public.restaurant_inventory(id) on delete cascade,

  -- Was this tick a person accepting what the memory proposed, or a person
  -- choosing a shelf themselves? A memory confirmed only by its own proposals
  -- is a different thing from one a person picked each time, and the log has to
  -- be able to tell them apart.
  source         text not null default 'chosen'
                 check (source in ('chosen', 'remembered')),

  -- Where the act happened, so the log can point at the paper.
  document_id    uuid references public.procurement_documents(id) on delete set null,
  line_no        integer,

  -- public.users, never auth.users — the two tables share zero ids and the JWT
  -- carries public.users.user_id.
  linked_by      uuid references public.users(user_id) on delete set null,
  linked_at      timestamptz not null default now(),

  constraint document_line_mappings_item_matches_action
    check ((action = 'linked'   and inventory_id is not null)
        or (action = 'unlinked' and inventory_id is null))
);

-- The read the proposal makes: newest act first, for one key, in one venue.
create index if not exists document_line_mappings_key
  on public.document_line_mappings
     (restaurant_id, provider_id, key_kind, key_value, linked_at desc);

-- The log the page shows for one document.
create index if not exists document_line_mappings_document
  on public.document_line_mappings (document_id, linked_at desc);

comment on table public.document_line_mappings is
  'ADR 0104 D12 slice 4 — the line-to-item mapping memory. One immutable row per act; the current memory for a key is its LATEST row, and an `unlinked` row means the memory forgot. times_confirmed is derived, never stored. A proposal from this table is a tick a person gives, never a booking and never a number.';
comment on column public.document_line_mappings.key_value is
  'Normalised key. `vendor_sku`: upper-cased SKU + ''|'' + printed vintage (empty when none) — a SKU reused for a new vintage is a different key and gets no proposal. `description`: normalised description + ''|'' + format_ml + ''|'' + vintage.';
comment on column public.document_line_mappings.action is
  '`unlinked` is an ANSWER (no memory here), not the absence of one. Reading it as "nothing recorded" is the absence-reported-as-health fault this column exists to prevent.';

drop trigger if exists document_line_mappings_append_only on public.document_line_mappings;
create trigger document_line_mappings_append_only
  before update or delete on public.document_line_mappings
  for each row execute function public.refuse_append_only_mutation();

alter table public.document_line_mappings enable row level security;
drop policy if exists document_line_mappings_service_role on public.document_line_mappings;
create policy document_line_mappings_service_role
  on public.document_line_mappings for all to service_role using (true) with check (true);
