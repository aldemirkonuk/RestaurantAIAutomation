-- Mobile app (Phase M1): device push-token registry + API idempotency keys.
--
-- mobile_devices: one row per installed app instance. The Expo push token is
-- the device identity; a user reinstalling gets a fresh token and the old row
-- is pruned when Expo reports DeviceNotRegistered.
--
-- api_idempotency_keys: dedupe store for the mobile outbox. Every mutating
-- request from the app carries an Idempotency-Key header; replays (offline
-- queue re-delivery, flaky networks) return the stored response instead of
-- double-firing vendor-visible actions like order approval.

create table if not exists mobile_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  restaurant_id uuid,
  expo_push_token text not null unique,
  platform text not null default 'unknown',
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_mobile_devices_user
  on mobile_devices (user_id);
create index if not exists idx_mobile_devices_restaurant
  on mobile_devices (restaurant_id);

create table if not exists api_idempotency_keys (
  key text primary key,
  user_id uuid,
  method text not null,
  path text not null,
  status_code int not null,
  response jsonb,
  created_at timestamptz not null default now()
);

-- Replays only matter within hours; a cron/manual sweep can prune by this index.
create index if not exists idx_api_idempotency_created
  on api_idempotency_keys (created_at);

-- Service-role only (the API gateway). No anon/authenticated policies on purpose.
alter table mobile_devices enable row level security;
alter table api_idempotency_keys enable row level security;
