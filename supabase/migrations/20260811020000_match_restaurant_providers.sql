-- Duplicate detection, second half: the restaurant's OWN provider list
--
-- 20260811010000 added match_vendor_catalogue, which answers "is this vendor
-- already in the shared curated catalogue?". That misses the other way a
-- duplicate gets made, which is entirely local: a restaurant already has
-- "Breakthru Bev" in its own list and adds (or renames something to)
-- "Breakthru Beverage Group". No catalogue row is involved, so the catalogue
-- matcher stays silent while the operator ends up with the same supplier
-- twice in the list they actually work from.
--
-- Same trigram approach, deliberately: a second similarity implementation in
-- TypeScript would drift from this one, and "why did the add screen warn but
-- the edit screen not?" is a worse bug than either screen missing a match.
--
-- p_exclude_id exists for the edit case. Editing a provider re-runs this
-- check against the very row being edited, which matches itself at
-- similarity 1.0 — without the exclusion, renaming anything would always
-- report a duplicate of itself.

-- providers.address is jsonb and has held two shapes over time (a plain JSON
-- string, and a legacy { line1, city, ... } object — see the normalizeAddress
-- comment in providers.service.ts). similarity() needs text, so unwrap it the
-- same way the API does rather than comparing against a JSON blob's
-- punctuation.
create or replace function provider_address_text(p jsonb)
returns text
language sql
immutable
as $$
  select case
    when p is null then null
    when jsonb_typeof(p) = 'string' then p #>> '{}'
    when jsonb_typeof(p) = 'object' then coalesce(
      p ->> 'line1',
      p ->> 'formatted_address',
      p ->> 'formattedAddress',
      nullif(
        concat_ws(', ',
          nullif(p ->> 'street', ''),
          nullif(p ->> 'city', ''),
          nullif(p ->> 'state', ''),
          nullif(p ->> 'postalCode', '')
        ), ''
      )
    )
  end;
$$;

comment on function provider_address_text(jsonb) is
  'Unwraps providers.address (jsonb, historically either a JSON string or a legacy {line1,...} object) to plain text. Mirrors ProvidersService.normalizeAddress so SQL-side matching sees the same address string the API returns.';

-- Fuzzy name matching over a restaurant's own providers.
create index if not exists idx_providers_name_trgm
  on providers using gin (name gin_trgm_ops);

create or replace function match_restaurant_providers(
  p_restaurant_id uuid,
  p_name          text,
  p_address       text    default null,
  p_exclude_id    uuid    default null,
  p_limit         integer default 5
)
returns table (
  id                 uuid,
  name               text,
  address            text,
  phone              text,
  email              text,
  website            text,
  catalogue_vendor_id uuid,
  is_custom          boolean,
  name_similarity    real,
  address_similarity real
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.name,
    provider_address_text(p.address)                      as address,
    p.contact_phone                                       as phone,
    p.contact_email                                       as email,
    p.website,
    -- No business-type column is selected on purpose: providers has no
    -- vendor_type / primary_business_type column at all (ProviderRow in
    -- providers.service.ts declares one, but no migration ever created it —
    -- which is why provider cards render an empty type). Selecting a column
    -- that does not exist would fail this whole function; the match modal
    -- does not need a type to identify a duplicate.
    p.catalogue_vendor_id,
    coalesce(p.is_custom, true)                           as is_custom,
    similarity(p.name, p_name)                            as name_similarity,
    case
      when p_address is not null and provider_address_text(p.address) is not null
      then similarity(provider_address_text(p.address), p_address)
    end                                                   as address_similarity
  from providers p
  where p.restaurant_id = p_restaurant_id
    and p.deleted_at is null
    and (p_exclude_id is null or p.id <> p_exclude_id)
    and (
      similarity(p.name, p_name) > 0.35
      or (
        p_address is not null
        and provider_address_text(p.address) is not null
        and similarity(provider_address_text(p.address), p_address) > 0.35
      )
    )
  order by
    greatest(
      similarity(p.name, p_name),
      coalesce(similarity(provider_address_text(p.address), p_address), 0)
    ) desc
  limit greatest(p_limit, 0);
$$;

comment on function match_restaurant_providers(uuid, text, text, uuid, integer) is
  'Trigram-similarity duplicate check against a restaurant''s own providers, the local counterpart to match_vendor_catalogue. p_exclude_id skips the row being edited, which would otherwise always match itself at 1.0. Same 0.35 threshold as the catalogue matcher so the two screens agree on what counts as a candidate.';
