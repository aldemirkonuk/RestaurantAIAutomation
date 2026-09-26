-- ADR 0222 (Proposed) + ADR 0229 (Proposed), 2026-09-25: a passkey signs you in,
-- an emailed one-time code signs you in when this device has no passkey, and
-- adding a passkey needs a sign-in in the last ten minutes or an emailed code.
--
-- The founder, 2026-09-25 (round 5, item 29, confirmed reading): "passkey (Face
-- ID/Touch ID) IS a sign-in method; logged-out with no passkey -> emailed
-- one-time code; enrolling while signed in: signed in within last 10 min =
-- direct, else email code first." That replaces the "type your current
-- password" proof built first on this PR.
--
-- Two changes, both additive, both written only by the gateway (service_role):
--
--   1. webauthn_challenges gains a third purpose, 'sign_in'. A sign-in ceremony
--      starts before anyone is known (the passkey itself says whose it is -- a
--      discoverable credential), so its row carries no user_id. The check below
--      makes that exact: a 'sign_in' row has no person, every other row has one.
--
--   2. sign_in_codes -- one row per emailed code. The code itself is never
--      stored: code_hash is HMAC-SHA256 under a key derived from the gateway's
--      JWT secret, so a leaked table cannot be brute-forced offline (a six-digit
--      code under a plain hash falls to a million guesses). A row is written for
--      EVERY request, including an address with no account (user_id null, no
--      mail sent), so the per-address limits behave the same whether or not the
--      address has an account -- that is the enumeration guard. requested_from
--      is a keyed hash of the caller's address, never the raw IP.

-- 1. Sign-in ceremonies --------------------------------------------------------
alter table public.webauthn_challenges
  alter column user_id drop not null;

alter table public.webauthn_challenges
  drop constraint if exists webauthn_challenges_purpose_check;
alter table public.webauthn_challenges
  add constraint webauthn_challenges_purpose_check
  check (purpose in ('registration', 'authentication', 'sign_in'));

alter table public.webauthn_challenges
  drop constraint if exists webauthn_challenges_person_matches_purpose;
alter table public.webauthn_challenges
  add constraint webauthn_challenges_person_matches_purpose
  check ((purpose = 'sign_in') = (user_id is null));

comment on table public.webauthn_challenges is
  'ADR 0222 / ADR 0229 (Proposed): one row per WebAuthn ceremony in flight. purpose registration/authentication belong to a signed-in person; purpose sign_in has no person until the passkey names one. The gateway deletes the row as it reads it (single use) and refuses one past expires_at (five minutes). Expired rows are swept by the gateway when a new ceremony starts.';

-- 2. Emailed one-time codes -------------------------------------------------------
create table if not exists public.sign_in_codes (
  id uuid primary key default gen_random_uuid(),
  -- Lower-cased and trimmed by the gateway; the check keeps it that way.
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  -- public.users.user_id when the address has an account; null when it does not
  -- (no mail is sent, but the row still counts toward the address's limits).
  user_id uuid references public.users(user_id) on delete cascade,
  -- 'sign_in': signed out, no passkey on this device. 'step_up': signed in,
  -- proving it is you before a passkey is added.
  purpose text not null check (purpose in ('sign_in', 'step_up')),
  -- HMAC-SHA256 (hex) of purpose, address and code; never the code.
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  -- Wrong guesses against this code. The gateway refuses a sixth.
  attempts integer not null default 0 check (attempts >= 0),
  -- Keyed hash of the requesting address, for the per-source limit.
  requested_from text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (purpose <> 'step_up' or user_id is not null),
  check (expires_at > created_at)
);
create index if not exists sign_in_codes_email_recent_idx
  on public.sign_in_codes (email, created_at desc);
create index if not exists sign_in_codes_source_recent_idx
  on public.sign_in_codes (requested_from, created_at desc);
create index if not exists sign_in_codes_created_idx
  on public.sign_in_codes (created_at);
alter table public.sign_in_codes enable row level security;
revoke all on public.sign_in_codes from public, anon, authenticated;
grant select, insert, update, delete on public.sign_in_codes to service_role;
drop policy if exists sign_in_codes_service_only on public.sign_in_codes;
create policy sign_in_codes_service_only on public.sign_in_codes
  for all to service_role using (true) with check (true);
comment on table public.sign_in_codes is
  'ADR 0229 (Proposed; founder 2026-09-25 item 29): emailed one-time sign-in and step-up codes. Six digits, ten minutes, five wrong tries per code, five codes per address per hour, twenty per requesting address per hour, twenty wrong tries per address per day. code_hash is keyed HMAC-SHA256, never the code. A row exists for an address with no account too (user_id null, no mail sent) so every limit answers the same either way. Rows older than two days are swept by the gateway.';
