-- Guest identity — the minimal slice (register A14, reopened).
--
-- A14 was closed as a scope LIMIT: "no person identity anywhere; the
-- personalisation ladder tops out at server". The product owner reopened it on
-- 2026-08-20 and chose to build real guest identity. An opus premortem was run
-- before any DDL was written (BEVERAGE_CATALOGUE_PLAN.md §10); this migration
-- implements only the part of its recommendation that has one defensible
-- answer, and deliberately stops short of everything it flagged as needing a
-- human or as being ahead of the data.
--
-- WHAT THIS BUILDS, AND WHY ONLY THIS
-- The measured interaction corpus is 47 pos_checks rows, one restaurant, a
-- single 43-minute window on 2026-08-11, 82 item lines, all simulator-produced
-- (source='generic_webhook'). server_name, covers, table_id and total are 0/47.
-- A learned person-level model is two to three orders of magnitude away, and
-- arch §4.3 explicitly refuses "a certain cost now for an uncertain benefit
-- later". So the test applied here is arch §9.4's: build exactly what cannot be
-- backfilled, and nothing that can.
--
--   cannot be backfilled  -> the guest row, its restaurant scope, the hashed
--                            verified identifier, the check<->guest link with
--                            provenance, consent captured at capture time
--   can wait              -> resolution beyond exact keys, a merge queue,
--                            preference aggregates, any model, cross-restaurant
--                            sharing (all deliberately absent)
--
-- THE ONE RULE THAT MAKES THE REST WORK
-- arch §3 is not "here is how to merge bottles". It is: separate generation
-- from decision, decide by exact key, make incompleteness fail toward a SPLIT,
-- and harvest free negative labels from a fact about the world. All four
-- transfer. The asymmetry, however, is worse and differently shaped: a false
-- bottle merge is a data-quality error with a bounded monetary cost, whereas a
-- false guest merge is a DISCLOSURE of one person's history to another, and no
-- un-merge reverses a disclosure. So there is no threshold here at all — not a
-- high one. Exact verified key, a human assertion, or nothing.

-- ---------------------------------------------------------------------------
-- guests
-- ---------------------------------------------------------------------------
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,

  -- Display only. NEVER a match key, in any code path.
  -- The wine analogue misleads here: master_wine_library.name IS part of a
  -- match key, because producer + name + residual tokens identify a product.
  -- A person's name identifies nothing — "John Smith" is a collision class,
  -- and the information that distinguishes two John Smiths is not in the
  -- string at all, so no tokenisation recovers it. Same rule and same reason
  -- as beverages.age_years: a best-effort label, explicitly non-authoritative
  -- for identity. Guarded by scripts/check_no_guest_name_matching.sh.
  display_label text,

  -- Consent is per GUEST and it is a record with a version, not a boolean.
  -- A boolean cannot answer "what was this person told, on what date, and can
  -- we prove it". Kept as columns rather than an event table while there is
  -- exactly one purpose; promote per arch §4.3 the day a second appears.
  consent_purpose text not null default 'service_personalisation',
  consent_notice_version text not null,
  consent_captured_via text not null
    check (consent_captured_via in
           ('reservation_form','in_venue_card','staff_verbal','loyalty_signup')),
  consent_captured_at timestamptz not null,
  consent_withdrawn_at timestamptz,

  -- Non-destructive merge (arch §3.7 / register A5), ported. A merged-away
  -- guest is superseded, never deleted, so historical links stay resolvable.
  superseded_by uuid references public.guests(id),

  -- Erasure is NOT deleted_at, and the reason is mechanical rather than
  -- philosophical: this application connects as service_role
  -- (database.service.ts:15), which holds rolbypassrls, so every
  -- `deleted_at IS NULL` predicate in this schema lives in a policy the
  -- application never evaluates. A soft-deleted guest would still be returned
  -- by every query the app makes. master_wine_library soft-deletes on purpose
  -- (arch §9.3 — the id must survive as a stable ML join key); a guest is not
  -- a bottle, and must stop existing as data while the non-personal check
  -- facts survive under their own retention obligation.
  -- erased_at marks a TOMBSTONE: identifiers hard-deleted, label and consent
  -- nulled. It holds nothing about the person.
  erased_at timestamptz,
  erasure_receipt_id uuid,

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz,
  observed_at   timestamptz not null default now(),   -- arch §9.3 (N3)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_guests_restaurant
  on public.guests (restaurant_id) where erased_at is null;
create index if not exists idx_guests_superseded
  on public.guests (superseded_by) where superseded_by is not null;

comment on table public.guests is
  'One person, scoped to ONE restaurant. The same human dining at two '
  'restaurants is two rows and that is correct, not a duplicate: consent is '
  'given to a restaurant, so sharing across restaurants is a new disclosure '
  'to a new controller requiring its own legal basis — not a schema '
  'convenience. Note that "global" in this schema is IMPLEMENTED as "no '
  'restaurant predicate in the RLS policy" (master_wine_library is USING '
  '(true) TO anon; beverages is USING (deleted_at IS NULL)), so copying '
  'either shape here would publish the guest list. Holds no contact detail — '
  'identifiers live in guest_identifiers as keyed hashes only. Register A14.';

comment on column public.guests.display_label is
  'Display only — NEVER a match key. Directly analogous to '
  'beverages.age_years: best-effort, explicitly non-authoritative for '
  'identity. Nulled on erasure.';

comment on column public.guests.erased_at is
  'Tombstone marker, NOT a soft delete. On erasure the guest_identifiers rows '
  'are hard-deleted and display_label/consent_* nulled; this row survives only '
  'so historical guest_check_links do not dangle. Do not add a deleted_at to '
  'this table — see the table comment for why the house pattern does not '
  'transfer.';

-- ---------------------------------------------------------------------------
-- guest_identifiers — the guest analogue of arch §3.4's residual-token key
-- ---------------------------------------------------------------------------
create table if not exists public.guest_identifiers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,

  channel_type text not null
    check (channel_type in ('phone_e164','email','card_fingerprint','loyalty_card')),

  -- hmac(canonicalised value, per-restaurant pepper, 'sha256'). The plaintext
  -- is never stored in any column: guest_link_identifier() takes it as an
  -- argument and persists only this. Erasure is then a DELETE with nothing
  -- left to shred, rather than a hunt through pos_checks.raw, events,
  -- notifications, decision_log, event_store and analytics_cache for copies.
  -- None of those holds guest PII today, which is exactly why the rule is
  -- free now and impossible later.
  channel_hash bytea not null,

  -- Which canonicaliser produced the hash. arch §3.4's equivalence relation is
  -- "closed, tiny and versioned"; this is that version. Changing it re-derives
  -- every hash in a migration and re-runs the merge gate, exactly as changing
  -- EQUIV does for beverages.
  canonicaliser_version text not null,

  -- Only a VERIFIED channel is ever a merge key. Verified means proved to
  -- belong to this person at capture time: an OTP, a confirmation click, a
  -- scanned loyalty card, a processor-returned fingerprint on a completed
  -- authorisation. A phone number typed by a host from memory is NOT verified,
  -- and that is exactly where "one booker, twelve executives" lives — a
  -- corporate assistant who books twelve dinners becomes one guest holding
  -- twelve people's histories, and it looks like the system working.
  verified_at timestamptz,

  -- Quarantine, ported from arch §3.5 / beverages.identity_status.
  -- 'shared_instrument' is the dangerous one, because it is the key that looks
  -- best: a card fingerprint is high-quality, machine-produced, and completely
  -- wrong about what it identifies. It identifies a HOUSEHOLD OR COMPANY. A
  -- joint card merges a marriage into one guest. Storable, displayable,
  -- countable — ineligible as a merge key and ineligible as a match target,
  -- exactly like an under-identified wine.
  identity_status text not null default 'unverified'
    check (identity_status in ('normal','unverified','shared_instrument')),

  -- The rule made impossible to disagree with rather than re-derived by three
  -- callers. GENERATED ... STORED rather than a trigger for the reason
  -- established by 20260818030000: a direct write fails immediately (42601)
  -- instead of silently vanishing on the next trigger fire.
  is_merge_eligible boolean
    generated always as (verified_at is not null and identity_status = 'normal') stored,

  observed_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Identity is an EXACT key join, never a similarity score (arch §3.4). This
-- unique index is what makes that structural rather than a convention.
create unique index if not exists uq_guest_identifiers_channel
  on public.guest_identifiers (restaurant_id, channel_type, channel_hash);
create index if not exists idx_guest_identifiers_guest
  on public.guest_identifiers (guest_id);

comment on table public.guest_identifiers is
  'The guest equivalent of arch §3.4''s residual-token key: an exact, '
  'versioned, hashed contact channel. Three properties carry over intact — '
  '(1) every digit is identity, nothing is normalised away; (2) '
  'canonicalisation varies SPELLING only, never content; (3) INCOMPLETENESS '
  'FAILS SAFE: an unrecognised format is not canonicalised, so it matches '
  'nothing, so a gap costs a false SPLIT and never a false merge. The '
  'asymmetry is worse than arch §3.9''s ~100:1 and differently shaped — a '
  'false bottle merge is a data-quality error, a false guest merge is a '
  'disclosure of one person''s history to another, and no un-merge reverses a '
  'disclosure. There is therefore no threshold at all: exact verified key, a '
  'human assertion, or nothing.';

comment on column public.guest_identifiers.channel_hash is
  'hmac(canonical value, per-restaurant pepper, sha256). The pepper is derived '
  'per restaurant, so the SAME phone number at two restaurants produces two '
  'different hashes and cannot be joined even by accident. That makes the '
  '"guests are restaurant-scoped" rule cryptographic rather than merely a '
  'policy predicate: cross-restaurant linkage would require a deliberate '
  'migration, which is the point at which the legal question gets asked.';

-- ---------------------------------------------------------------------------
-- guest_check_links — many-to-many on purpose, and the negative-label source
-- ---------------------------------------------------------------------------
create table if not exists public.guest_check_links (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  -- NOTE: pos_checks has no FK to restaurants (verified 2026-08-20; its only
  -- FK is table_id -> restaurant_tables) while 59 other tables cascade from
  -- it. This is the first FK into pos_checks.
  pos_check_id uuid not null references public.pos_checks(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,

  -- A check has `covers` people, not one. One-guest-per-check bakes in a
  -- falsehood on day one, and it is the specific falsehood that HIDES the
  -- joint-card and corporate-card merges: they stop looking like errors and
  -- start looking like one guest with a rich history.
  role text not null default 'diner'
    check (role in ('diner','payer','host','booker')),

  -- The link is an ASSERTION with provenance, not an attribute of the check.
  -- 'inferred_reservation' may never be treated as evidence that two guests
  -- are the same (arch §3.6: generation and decision stay separate).
  link_source text not null
    check (link_source in
           ('verified_identifier','loyalty_scan','staff_assertion','inferred_reservation')),
  asserted_by uuid,
  observed_at timestamptz not null default now(),   -- arch §9.3 (N3)
  created_at  timestamptz not null default now()
);

create unique index if not exists uq_guest_check_links
  on public.guest_check_links (pos_check_id, guest_id);
create index if not exists idx_guest_check_links_guest
  on public.guest_check_links (guest_id, observed_at desc);
create index if not exists idx_guest_check_links_restaurant
  on public.guest_check_links (restaurant_id, observed_at desc);

comment on table public.guest_check_links is
  'Check <-> person, many-to-many, with provenance. Separate from pos_checks '
  'for three reasons: a check has `covers` people, not one; a check is a '
  'financial record with its own retention while a link is personal data '
  'subject to erasure, so erasure must not mean UPDATE-ing a financial row; '
  'and a link carries source/actor/observed_at that a bare uuid column cannot. '
  'AND — the load-bearing one — this table IS the free-negative-label set. '
  'arch §3.1 harvests 732,874 free negatives from "two entries on the same '
  'menu are different products". The guest equivalent is "two guests linked to '
  'the same check are different people": every check with n>=2 links emits '
  'C(n,2) negatives at zero labelling cost, growing with every service. That '
  'is what makes a zero-false-merge CI gate possible here at all, and it is '
  'why this table is many-to-many.';

-- ---------------------------------------------------------------------------
-- Canonicalisation and hashing. One home, in the database, so two call sites
-- cannot compute identity differently — the same reason
-- beverage_identity_key() is a database function and not TypeScript.
-- ---------------------------------------------------------------------------
create or replace function public.guest_canonicaliser_version()
returns text language sql immutable as $$ select 'v1'::text $$;

comment on function public.guest_canonicaliser_version is
  'Version of the closed, tiny equivalence relation in '
  'guest_channel_canonicalise(). Stamped on every guest_identifiers row. '
  'Bumping it is a migration that re-derives every hash and re-runs the '
  'merge-eval gate — exactly what changing EQUIV does for beverages.';

create or replace function public.guest_channel_canonicalise(
  p_channel_type text,
  p_raw          text
) returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  if p_raw is null or btrim(p_raw) = '' then
    return null;
  end if;
  v := btrim(p_raw);

  if p_channel_type = 'phone_e164' then
    -- Spelling only: drop the separators humans type. Everything else is
    -- content. In particular a number WITHOUT a leading '+' is refused rather
    -- than guessed at, because inferring a country code is inventing identity,
    -- not normalising spelling — and '+90 532 111 22 33' vs '+90 533 111 22
    -- 33' are two different people, so no "close enough" rule may ever exist.
    -- Refusing costs a false split. That is the correct direction to fail.
    v := regexp_replace(v, '[\s().\-]', '', 'g');
    if v !~ '^\+[1-9][0-9]{7,14}$' then
      return null;
    end if;
    return v;

  elsif p_channel_type = 'email' then
    -- Lowercase only. Deliberately NOT stripping dots or plus-tags: those are
    -- provider-specific content rules (Gmail treats them as equivalent, most
    -- providers do not), and applying them universally would merge two real
    -- mailboxes. Keeping them costs a false split for one provider's users.
    v := lower(v);
    if v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return null;
    end if;
    return v;

  elsif p_channel_type = 'card_fingerprint' then
    -- Machine-produced by the processor; only whitespace is spelling.
    v := lower(regexp_replace(v, '\s', '', 'g'));
    if length(v) < 8 or length(v) > 128 then
      return null;
    end if;
    return v;

  elsif p_channel_type = 'loyalty_card' then
    -- Printed with spaces and hyphens; those are spelling. Case is not
    -- meaningful on a printed card number.
    v := upper(regexp_replace(v, '[\s\-]', '', 'g'));
    if v !~ '^[A-Z0-9]{4,64}$' then
      return null;
    end if;
    return v;
  end if;

  -- Unknown channel type: refuse. Fails to a split, by design.
  return null;
end;
$$;

comment on function public.guest_channel_canonicalise is
  'Spelling-only canonicalisation, closed and versioned. Returns NULL for '
  'anything it does not recognise, which is the arch §3.4 fail-safe property '
  'made concrete: an unrecognised value is not canonicalised, so it hashes to '
  'nothing, so it matches nothing, so the cost is a false SPLIT. A phone '
  'without a country code is refused rather than guessed — inferring the '
  'country is inventing identity, not normalising spelling.';

create or replace function public.guest_pepper(p_restaurant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
declare
  v_master text;
begin
  select decrypted_secret into v_master
  from vault.decrypted_secrets
  where name = 'guest_identifier_pepper'
  limit 1;

  if v_master is null then
    raise exception
      'vault secret "guest_identifier_pepper" is missing; refusing to hash a '
      'guest identifier with a predictable key. Provision it before enabling '
      'guest capture.'
      using errcode = 'no_data_found';
  end if;

  -- Derived per restaurant, so the same phone number at two restaurants
  -- produces two different hashes. The scope rule stops being a policy
  -- predicate someone can copy wrongly and becomes arithmetic.
  return encode(
    extensions.hmac(p_restaurant_id::text, v_master, 'sha256'), 'hex');
end;
$$;

comment on function public.guest_pepper is
  'Per-restaurant HMAC key, derived from one vault secret. Raises rather than '
  'falling back to a constant if the secret is absent: a predictable pepper on '
  'a phone-number hash is a rainbow table, and failing loudly is the only '
  'honest behaviour.';

create or replace function public.guest_link_identifier(
  p_restaurant_id uuid,
  p_guest_id      uuid,
  p_channel_type  text,
  p_raw_value     text,
  p_verified      boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_canon text;
  v_hash  bytea;
  v_id    uuid;
begin
  if not exists (select 1 from public.guests g
                 where g.id = p_guest_id and g.restaurant_id = p_restaurant_id) then
    raise exception 'guest % does not belong to restaurant %',
      p_guest_id, p_restaurant_id;
  end if;

  v_canon := public.guest_channel_canonicalise(p_channel_type, p_raw_value);
  if v_canon is null then
    raise exception
      'unrecognised % format; refusing to link (this fails to a split, by design)',
      p_channel_type
      using errcode = 'invalid_parameter_value';
  end if;

  v_hash := extensions.hmac(v_canon, public.guest_pepper(p_restaurant_id), 'sha256');

  insert into public.guest_identifiers (
    restaurant_id, guest_id, channel_type, channel_hash,
    canonicaliser_version, verified_at, identity_status
  ) values (
    p_restaurant_id, p_guest_id, p_channel_type, v_hash,
    public.guest_canonicaliser_version(),
    case when p_verified then now() end,
    case
      -- A card fingerprint is quarantined REGARDLESS of verification. It is
      -- perfectly verified and still identifies the wrong kind of entity.
      when p_channel_type = 'card_fingerprint' then 'shared_instrument'
      when p_verified then 'normal'
      else 'unverified'
    end
  )
  on conflict (restaurant_id, channel_type, channel_hash) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.guest_link_identifier is
  'The ONLY write path for a contact channel. Plaintext enters as an argument '
  'and never becomes a column value, a log line or a jsonb payload — so '
  'erasure is a DELETE with nothing left to shred, rather than a hunt through '
  'pos_checks.raw, events, notifications, decision_log, event_store and '
  'analytics_cache for copies. Enforced at the code layer by '
  'scripts/check_no_raw_guest_channels.sh.';

-- ---------------------------------------------------------------------------
-- RLS. Modelled on the cocktails policy (20260818000000) — the only policy in
-- this repo written after a security review — plus a valid_until check that
-- none of the existing policies have.
--
-- Do NOT model on beverages_authenticated_read (USING (deleted_at IS NULL)) or
-- anon_read_master_wine_library (USING (true) TO anon): both are correct for a
-- globally-shared bottle and both would publish the guest list, and the policy
-- text looks identical at review time.
-- Do NOT model on menu_items_restaurant_isolation, which filters on
-- users.restaurant_id (single-valued): three users in this database hold
-- user_restaurant_access to 2-3 restaurants while users.restaurant_id names
-- one, so the two idioms already disagree in live data.
-- Do NOT model on restaurant_inventory's policy, which omits is_active — all
-- 14 live user_restaurant_access rows are is_active=true with valid_until
-- NULL, so the deactivation path has NEVER executed in this database. For
-- inventory that is an annoyance; for a guest list it is an ex-employee
-- retaining the customer database.
-- ---------------------------------------------------------------------------
alter table public.guests            enable row level security;
alter table public.guest_identifiers enable row level security;
alter table public.guest_check_links enable row level security;

drop policy if exists guests_service_role on public.guests;
create policy guests_service_role on public.guests
  for all to service_role using (true) with check (true);

drop policy if exists guests_restaurant_isolation on public.guests;
create policy guests_restaurant_isolation on public.guests
  for select to authenticated
  using (
    erased_at is null
    and restaurant_id in (
      select ura.restaurant_id from public.user_restaurant_access ura
      where ura.user_id = auth.uid()
        and ura.is_active
        and (ura.valid_until is null or ura.valid_until > now())
    )
  );

-- guest_identifiers gets NO authenticated policy at all. Contact channels are
-- never read by a client; they are matched inside guest_link_identifier(),
-- which is SECURITY DEFINER. Grants are revoked as well as policies withheld,
-- because RLS-enabled-with-no-policy is closed only by ABSENCE, and the next
-- person to add a policy would silently open the whole table.
drop policy if exists guest_identifiers_service_role on public.guest_identifiers;
create policy guest_identifiers_service_role on public.guest_identifiers
  for all to service_role using (true) with check (true);
revoke all on public.guest_identifiers from authenticated, anon;

drop policy if exists guest_check_links_service_role on public.guest_check_links;
create policy guest_check_links_service_role on public.guest_check_links
  for all to service_role using (true) with check (true);

drop policy if exists guest_check_links_restaurant_isolation on public.guest_check_links;
create policy guest_check_links_restaurant_isolation on public.guest_check_links
  for select to authenticated
  using (
    restaurant_id in (
      select ura.restaurant_id from public.user_restaurant_access ura
      where ura.user_id = auth.uid()
        and ura.is_active
        and (ura.valid_until is null or ura.valid_until > now())
    )
  );

revoke all on function public.guest_pepper(uuid) from public, anon, authenticated;
revoke all on function public.guest_link_identifier(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.guest_link_identifier(uuid, uuid, text, text, boolean)
  to service_role;
grant execute on function public.guest_channel_canonicalise(text, text)
  to authenticated, service_role;
grant execute on function public.guest_canonicaliser_version()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The co-presence negative-label view. Ships EMPTY, before there is data —
-- which is the point. Register A6 records that the wine merge policy was
-- self-graded against probes its author imagined, and §3.8's gate exists so
-- that can never recur. Building the gate after the data would repeat it.
-- ---------------------------------------------------------------------------
create or replace view public.guest_copresence_negatives
with (security_invoker = true) as
  select
    a.restaurant_id,
    least(a.guest_id, b.guest_id)    as guest_a,
    greatest(a.guest_id, b.guest_id) as guest_b,
    count(*)                          as shared_checks
  from public.guest_check_links a
  join public.guest_check_links b
    on a.pos_check_id = b.pos_check_id
   and a.guest_id < b.guest_id
  group by 1, 2, 3;

comment on view public.guest_copresence_negatives is
  'Free negative labels: two guests linked to the same check are different '
  'people. The direct analogue of arch §3.1''s "two entries on the same menu '
  'are different products", which yielded 732,874 free negatives for bottles. '
  'Consumed by scripts/eval_guest_merge_policies.py, which fails CI on a '
  'single false merge. Empty today, deliberately — the gate ships before the '
  'data, because register A6 is what happens when it does not.';

grant select on public.guest_copresence_negatives to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Provision the pepper. Generated inside the database by gen_random_bytes so
-- the value never passes through a human, a shell history or a transcript.
-- Wrapped so that a vault that is unavailable at migration time does not fail
-- the migration — guest_pepper() then raises loudly at first use, which is the
-- honest failure mode.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets
                 where name = 'guest_identifier_pepper') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'guest_identifier_pepper',
      'HMAC master key for guest_identifiers.channel_hash. Per-restaurant '
      'peppers are derived from it by guest_pepper(). Rotating it invalidates '
      'every existing hash and requires re-collection, not a re-derivation.'
    );
  end if;
exception when others then
  raise notice 'could not provision guest_identifier_pepper (%): guest_pepper() '
               'will raise until it is provisioned manually', sqlerrm;
end $$;
