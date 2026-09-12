-- =============================================================================
-- ADR 0104 D15 — a document's vendor is resolved by IDENTITY, without a person
-- and without a guess.
--
-- Slice 4 measured that 0 of 15 documents on the sim tenant carry a
-- `provider_id`, because `provider_id` has only ever come from the CALLER and
-- intake never read the seller party printed on the paper. The mapping memory
-- is keyed on (restaurant, provider), so it was being consulted on nothing.
--
-- D15 fills it from the one thing on a document that is a legal identifier
-- rather than a description: the seller's tax id (BT-31 / BT-32). Three rules,
-- first match wins:
--
--   1. the normalised id equals EXACTLY ONE provider of this restaurant  → match
--   2. no provider carries it                                            → CREATE
--      the provider from the printed identity, flagged provisional
--   3. anything weaker — nothing printed, malformed, TWO providers sharing
--      one id, a seller nobody could read                                → UNRESOLVED,
--      with the reason in words, and a notification
--
-- Name similarity is not a rule and never becomes one. Neither is "the only
-- provider we have" nor "the caller's last vendor". A guessed provider row is
-- the unrecoverable mistake here: it is written under every future price, every
-- cost lot and every remembered pairing, and deleting it afterwards requires
-- fingerprinting rows nobody can enumerate.
--
-- WHAT THIS MIGRATION ADDS
--   * `providers`  — the tax identity, and the two columns that record a row
--                    BORN FROM A DOCUMENT rather than entered by a person.
--   * a partial UNIQUE index per restaurant on the normalised value — this is
--     what makes rule 1's "exactly one" a fact the database enforces rather than
--     a claim the service makes, and what makes rule 2's race safe: two
--     documents creating the same vendor at once, one wins on 23505 and the
--     loser re-reads and matches.
--   * `restaurants` — the venue's OWN tax id, so a self-billed or returned
--     document whose seller block is us is recognised and creates nothing.
--   * `document_vendor_resolutions` — the append-only log. Re-extraction (D5
--     corrections touching the seller party) RE-RUNS resolution, and the history
--     of what it answered each time has to survive that; a mutable column would
--     let a later run erase the run that wrote the provider now sitting under a
--     year of cost lots.
-- =============================================================================

-- ---- 1. the identity on a provider -----------------------------------------

alter table public.providers
  add column if not exists tax_id                       text,
  -- `<COUNTRY>:<VALUE>` — country included on purpose: a Turkish VKN and a
  -- Greek VAT id can be the same ten digits and are not the same legal person.
  add column if not exists tax_id_normalized            text,
  add column if not exists tax_country                  text,
  -- The tax office / registration authority, where the document prints one
  -- (`Vergi Dairesi`). Recorded, never matched on.
  add column if not exists tax_office                   text,
  -- A row created by rule 2 is REAL but unconfirmed: nobody has traded with it
  -- through this product yet. The flag is what lets a screen say so, and what
  -- lets a later ordering flow ask for the terms a document does not print.
  add column if not exists provisional_until_first_order boolean not null default false,
  add column if not exists created_from_document_id     uuid
    references public.procurement_documents(id) on delete set null;

comment on column public.providers.tax_id_normalized is
  'ADR 0104 D15 — the seller tax identity folded to <COUNTRY>:<VALUE> (digits and letters only, country prefix resolved). The ONLY value a document is matched on. NULL means this provider carries no identity and can therefore never be matched by D15 rule 1 — which is the honest state, not a defect.';
comment on column public.providers.provisional_until_first_order is
  'TRUE on a provider BORN FROM A DOCUMENT (D15 rule 2): its identity is copied from a legal document, but no person has confirmed it and no order has been placed with it.';
comment on column public.providers.created_from_document_id is
  'The document whose printed seller block this provider was created from (D15 rule 2). NULL on every provider a person entered.';

-- EXACTLY ONE, enforced. Partial on both sides: a provider with no identity is
-- not a duplicate of another with no identity, and a soft-deleted provider must
-- not block a live one from carrying the same id.
--
-- `restaurant_id` is part of the key because providers are per restaurant here
-- (`providers.restaurant_id`, which is what every read in providers.service.ts
-- filters on) — two venues buying from the same distributor hold two rows, and
-- neither may see the other's.
--
-- Rows with `restaurant_id IS NULL` (the shared catalogue) are deliberately NOT
-- covered: NULLs are distinct in a unique index, and D15's read is scoped to
-- one restaurant, so a catalogue row is never a match candidate.
create unique index if not exists providers_tax_identity_per_restaurant
  on public.providers (restaurant_id, tax_id_normalized)
  where tax_id_normalized is not null
    and restaurant_id is not null
    and deleted_at is null;

-- ---- 2. the venue's own identity -------------------------------------------
-- Without this the self-billed case can only be caught when the document prints
-- BOTH parties' ids. With it, a document whose seller block is this restaurant
-- is recognised from the seller alone and creates nothing.

alter table public.restaurants
  add column if not exists tax_id            text,
  add column if not exists tax_id_normalized text,
  add column if not exists tax_country       text;

comment on column public.restaurants.tax_id_normalized is
  'ADR 0104 D15 — this venue''s own tax identity, in the same <COUNTRY>:<VALUE> form. A document whose SELLER carries this value is self-billed or returned: it never creates a provider.';

-- ---- 3. the append-only resolution log --------------------------------------

create table if not exists public.document_vendor_resolutions (
  id             uuid primary key default gen_random_uuid(),

  document_id    uuid not null
                 references public.procurement_documents(id) on delete cascade,
  restaurant_id  uuid not null
                 references public.restaurants(id) on delete cascade,

  -- The four states, and they are four on purpose.
  --   matched     — rule 1
  --   created     — rule 2
  --   unresolved  — rule 3: we LOOKED and the document does not name an
  --                 identity we can verify
  --   unavailable — we could NOT look (the providers read failed, ADR 0067).
  -- `unavailable` is not a kind of `unresolved`: one says the paper is weak,
  -- the other says our own read is broken, and collapsing them is the
  -- absence-reported-as-health fault in the place it would be invisible.
  state          text not null
                 check (state in ('matched', 'created', 'unresolved', 'unavailable')),

  -- How, when a provider came out of it. NULL on unresolved/unavailable.
  source         text
                 check (source in ('matched_tax_id', 'created_from_document')),

  provider_id    uuid references public.providers(id) on delete set null,

  -- What we matched on, or would have. Kept for both outcomes: on a refusal it
  -- is the evidence that the value we read was not the value on file.
  matched_tax_id_normalized text,
  matched_tax_id_printed    text,
  tax_id_scheme             text,

  -- A sentence, always. Never a code, never null on a refusal.
  reason         text not null check (length(reason) > 0),

  -- Which revision of layer 1 this ran against, so a re-extraction's answer is
  -- distinguishable from the first one rather than overwriting it.
  document_revision integer,

  -- public.users, never auth.users — the two tables share zero ids and the JWT
  -- carries public.users.user_id.
  resolved_by    uuid references public.users(user_id) on delete set null,
  resolved_at    timestamptz not null default now(),

  constraint document_vendor_resolutions_provider_matches_state
    check ((state in ('matched', 'created') and provider_id is not null and source is not null)
        or (state in ('unresolved', 'unavailable') and provider_id is null and source is null))
);

-- The read the page makes: the LATEST answer for one document.
create index if not exists document_vendor_resolutions_document
  on public.document_vendor_resolutions (document_id, resolved_at desc);

-- The read an audit makes: every document a given identity resolved.
create index if not exists document_vendor_resolutions_identity
  on public.document_vendor_resolutions
     (restaurant_id, matched_tax_id_normalized, resolved_at desc);

comment on table public.document_vendor_resolutions is
  'ADR 0104 D15 — one immutable row per RUN of vendor resolution on a document. Re-extraction and a D5 correction to the seller party both re-run it and append; the current answer is the latest row. Never updated: a later run must not be able to erase the run that wrote the provider a year of cost lots now sits under.';
comment on column public.document_vendor_resolutions.state is
  '`unavailable` (our read failed) is NOT a kind of `unresolved` (the paper names no verifiable identity). Rendering them the same teaches a reader to ignore both.';

drop trigger if exists document_vendor_resolutions_append_only
  on public.document_vendor_resolutions;
create trigger document_vendor_resolutions_append_only
  before update or delete on public.document_vendor_resolutions
  for each row execute function public.refuse_append_only_mutation();

alter table public.document_vendor_resolutions enable row level security;
drop policy if exists document_vendor_resolutions_service_role
  on public.document_vendor_resolutions;
create policy document_vendor_resolutions_service_role
  on public.document_vendor_resolutions for all to service_role
  using (true) with check (true);
