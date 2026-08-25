-- POS item mappings — the multiPOS foundation's identity table.
--
-- Maps a POS-side item (by external id and/or display name) to WineOps'
-- master wine / inventory identity, and flags wine items so basket, attach-
-- rate, and wine-revenue analytics stay exact instead of keyword-guessed.
-- source '*' = applies to every provider.
--
-- Convention: service-role only, RLS on, no anon policies.

create table if not exists pos_item_mappings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  source text not null default '*',            -- provider key or '*'
  -- '' (not null) so the plain unique index works with PostgREST upserts
  external_item_id text not null default '',   -- catalog/item id in the POS
  item_name text not null default '',          -- display-name match (case-insensitive in app)
  category text,
  is_wine boolean not null default false,
  master_wine_id uuid,
  inventory_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_pos_item_mappings_identity
  on pos_item_mappings (restaurant_id, source, external_item_id, item_name);
create index if not exists idx_pos_item_mappings_restaurant
  on pos_item_mappings (restaurant_id, source);

alter table pos_item_mappings enable row level security;
