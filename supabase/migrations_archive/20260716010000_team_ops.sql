-- Team Ops (Manager Shift Desk — production port of sketch 038).
--
-- Everything the /team surface needs beyond the existing membership roster
-- (user_restaurant_access + users + organization_invites): an operational
-- staff profile, weekly schedules, shifts + breaks, publish read-receipts,
-- certifications, recurring availability, time-off + swap requests (modelled
-- now, workflow lands in a later wave), coverage rules, per-server sales
-- ingestion, and a per-restaurant team settings row (labor toggle + target).
--
-- Convention matches 20260715120000_mobile_devices_and_idempotency.sql:
-- service-role only (API gateway holds the key), RLS on, no anon policies.

-- ===========================================================================
-- WAVE 1 — roster: operational staff profile
-- A member can exist WITHOUT a user account (manager adds staff before they
-- sign up). user_id is back-filled when the person claims their account
-- (matched by email); invite_id points at the pending organization invite.
-- ===========================================================================
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  user_id uuid,
  invite_id uuid,
  display_name text not null,
  email text,
  phone text,
  avatar_url text,
  position text,                              -- server, bartender, sommelier, manager, owner
  employment_type text not null default 'full_time', -- full_time | part_time | trial | borrowed
  home_location text,
  hourly_wage numeric(10, 2),                 -- manager-entered, owner/manager only
  skills text[] not null default '{}',        -- bar_trained, somm_l3, keyholder, closer, ...
  hire_date date,
  status text not null default 'active',      -- active | inactive | trial
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_team_members_user
  on team_members (restaurant_id, user_id) where user_id is not null;
create index if not exists idx_team_members_restaurant
  on team_members (restaurant_id);
create index if not exists idx_team_members_email
  on team_members (lower(email));

-- ===========================================================================
-- WAVE 2 — schedules + shifts + breaks + publish receipts
-- ===========================================================================
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  week_start date not null,                   -- Monday of the week
  status text not null default 'draft',       -- draft | published
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_schedules_week
  on schedules (restaurant_id, week_start);

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  schedule_id uuid references schedules (id) on delete set null,
  member_id uuid references team_members (id) on delete cascade,  -- null = open shift
  shift_date date not null,
  start_time text not null,                   -- HH:MM (24h)
  end_time text not null,
  role text,                                  -- MOD, Main bar, Floor 2, Wine floor, ...
  shift_type text not null default 'pm',      -- am | pm | double | split | training | borrowed | open
  state text not null default 'scheduled',    -- scheduled | callout | covered | open
  note text,
  labor_cost numeric(10, 2),                  -- snapshot at save (hours * wage)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shifts_restaurant_date
  on shifts (restaurant_id, shift_date);
create index if not exists idx_shifts_schedule on shifts (schedule_id);
create index if not exists idx_shifts_member on shifts (member_id);

create table if not exists shift_breaks (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts (id) on delete cascade,
  start_time text not null,
  duration_min int not null default 30,
  covered_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_shift_breaks_shift on shift_breaks (shift_id);

create table if not exists schedule_receipts (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules (id) on delete cascade,
  member_id uuid not null references team_members (id) on delete cascade,
  seen_at timestamptz not null default now()
);

create unique index if not exists uq_schedule_receipts
  on schedule_receipts (schedule_id, member_id);

-- ===========================================================================
-- WAVE 3 — certifications, availability, coverage rules
-- ===========================================================================
create table if not exists team_certifications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  member_id uuid not null references team_members (id) on delete cascade,
  cert_type text not null,                    -- alcohol_service, food_handler, allergen, ...
  issued_at date,
  expires_at date,
  doc_url text,
  status text not null default 'valid',       -- valid | expiring | expired | submitted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_team_certs_member on team_certifications (member_id);
create index if not exists idx_team_certs_expiry
  on team_certifications (restaurant_id, expires_at);

create table if not exists team_availability (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references team_members (id) on delete cascade,
  day_of_week int not null,                   -- 0=Sun .. 6=Sat
  start_time text,
  end_time text,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_team_availability_member on team_availability (member_id);

create table if not exists coverage_templates (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  day_of_week int,                            -- null = applies to all days
  shift_period text not null default 'pm',    -- am | pm
  role text not null,
  min_staff int not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_coverage_templates_restaurant
  on coverage_templates (restaurant_id);

-- ===========================================================================
-- WAVE 4/5 — time-off + swaps (workflow later), per-server sales ingestion
-- ===========================================================================
create table if not exists time_off_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  member_id uuid not null references team_members (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending',     -- pending | approved | denied
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_time_off_restaurant on time_off_requests (restaurant_id);

create table if not exists swap_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  shift_id uuid references shifts (id) on delete cascade,
  from_member_id uuid references team_members (id) on delete set null,
  to_member_id uuid references team_members (id) on delete set null,
  status text not null default 'pending',     -- pending | accepted | approved | denied
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_swap_requests_restaurant on swap_requests (restaurant_id);

-- Per-server sales attribution. There is no POS/guest-check source in the
-- product today, so this is populated manually / by CSV / by a future POS
-- webhook. The Performance panel reads from here and shows an explicit
-- "no data yet" empty state until rows exist — never mock numbers.
create table if not exists server_sales (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  member_id uuid not null references team_members (id) on delete cascade,
  service_date date not null,
  covers int not null default 0,
  net_sales numeric(12, 2) not null default 0,
  wine_sales numeric(12, 2) not null default 0,
  checks int not null default 0,
  source text not null default 'manual',      -- manual | csv | pos
  created_at timestamptz not null default now()
);

create unique index if not exists uq_server_sales
  on server_sales (restaurant_id, member_id, service_date);
create index if not exists idx_server_sales_restaurant_date
  on server_sales (restaurant_id, service_date);

-- ===========================================================================
-- Team settings (labor toggle + target). One row per restaurant.
-- ===========================================================================
create table if not exists team_settings (
  restaurant_id uuid primary key,
  labor_tracking_enabled boolean not null default true,
  wage_visible boolean not null default true,
  labor_target_pct numeric(5, 2) not null default 28,
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- RLS — service-role only (API gateway). No anon/authenticated policies.
-- ===========================================================================
alter table team_members enable row level security;
alter table schedules enable row level security;
alter table shifts enable row level security;
alter table shift_breaks enable row level security;
alter table schedule_receipts enable row level security;
alter table team_certifications enable row level security;
alter table team_availability enable row level security;
alter table coverage_templates enable row level security;
alter table time_off_requests enable row level security;
alter table swap_requests enable row level security;
alter table server_sales enable row level security;
alter table team_settings enable row level security;
