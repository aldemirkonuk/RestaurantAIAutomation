-- Vendor Catalogue — duplicate detection at custom-provider entry
--
-- The add-provider flow has two doors into the same list: search the
-- catalogue first (VendorSearchModal), or add a custom vendor directly
-- (AddProviderModal, also reachable via the 'n' shortcut — no detour through
-- search at all). Nothing stopped the second door from creating a private,
-- unverified duplicate of a vendor that already has a curated catalogue
-- entry. That is exactly what happened: Breakthru Beverage Group exists in
-- vendor_catalogue as a verified row, and was then also hand-typed as a
-- custom provider, because nothing checked.
--
-- This function is what the add-provider form calls (debounced, while the
-- user is still typing) to ask "does this look like a vendor we already have
-- verified?" before letting them finish creating a private copy.
--
-- Uses pg_trgm, not ilike. A substring search would miss "Break Thru Beverage"
-- vs "Breakthru Beverage Group" and any typo; trigram similarity catches near
-- matches without requiring an exact substring, and the GIN index this reads
-- (idx_vendor_catalogue_name_trgm) already exists from the geo-foundation
-- migration — added for ingest dedupe, reused here for the same purpose at
-- the UI layer.
--
-- CURATED ONLY. Matching against the tens-of-thousands-row registry tier
-- would surface unverified permit-database noise as if it were "the same
-- vendor we already have" — worse than not matching at all, because it lends
-- false confidence to a row nobody has checked.
--
-- Two independent signals, either can qualify a row:
--   name_similarity    trigram similarity on the name itself
--   address_similarity trigram similarity on the free-text address
-- A vendor can match on a near-identical name with a different address
-- (a franchise, a rebrand) or a matching address with a slightly different
-- name (DBA vs legal name) — requiring both would miss either case.

create or replace function match_vendor_catalogue(
  p_name     text,
  p_address  text    default null,
  p_country  text    default null,
  p_limit    integer default 5
)
returns table (
  id                 uuid,
  name               text,
  type               text,
  country            text,
  state              text,
  city               text,
  address            text,
  phone              text,
  email              text,
  website            text,
  wine_specialties   text,
  listing_tier       text,
  data_confidence    numeric,
  verified_at        timestamptz,
  name_similarity    real,
  address_similarity real
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    v.id, v.name, v.type, v.country, v.state, v.city, v.address,
    v.phone, v.email, v.website, v.wine_specialties, v.listing_tier,
    v.data_confidence, v.verified_at,
    similarity(v.name, p_name)                                        as name_similarity,
    case
      when p_address is not null and v.address is not null
      then similarity(v.address, p_address)
    end                                                               as address_similarity
  from vendor_catalogue v
  where v.is_active = true
    and v.listing_tier = 'curated'
    and (p_country is null or v.country = p_country)
    and (
      similarity(v.name, p_name) > 0.35
      or (
        p_address is not null and v.address is not null
        and similarity(v.address, p_address) > 0.35
      )
    )
  order by
    greatest(
      similarity(v.name, p_name),
      coalesce(similarity(v.address, p_address), 0)
    ) desc
  limit greatest(p_limit, 0);
$$;

comment on function match_vendor_catalogue(text, text, text, integer) is
  'Trigram-similarity duplicate check against curated vendor_catalogue rows, used by the add-provider form to ask "is this already a verified vendor?" before creating a private custom copy. Registry-tier rows are excluded — matching against unverified permit data would lend false confidence. Threshold 0.35 on either name or address similarity mirrors pg_trgm''s own default (0.3) with a small margin against noise.';
