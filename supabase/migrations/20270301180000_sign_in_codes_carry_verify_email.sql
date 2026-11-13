-- Onboarding OB-3 (founder /goal 2026-11-07; proposal §3 Phase 1 row OB-3,
-- §4 F3 "the mail carries a six-digit code and the link"): the verification
-- mail carries a six-digit code beside its link, stored in sign_in_codes with
-- purpose 'verify_email'. Same row shape, same HMAC, same ten minutes, same
-- five tries -- the gateway's SignInCodesService applies every rule; this only
-- widens what the purpose column admits.
--
-- The purpose check was declared inline in migration
-- passkey_sign_in_and_email_codes (`check (purpose in ('sign_in', 'step_up'))`),
-- so Postgres named it sign_in_codes_purpose_check. It is dropped by that name
-- and re-added under the same name with the third purpose.
--
-- A verify_email code always belongs to an account (it is issued at sign-up
-- and on resend, to the account's own address), so like step_up it must name
-- one: a second, named check says so.

alter table public.sign_in_codes
  drop constraint if exists sign_in_codes_purpose_check;

alter table public.sign_in_codes
  add constraint sign_in_codes_purpose_check
  check (purpose in ('sign_in', 'step_up', 'verify_email'));

alter table public.sign_in_codes
  drop constraint if exists sign_in_codes_verify_email_names_a_person;

alter table public.sign_in_codes
  add constraint sign_in_codes_verify_email_names_a_person
  check (purpose <> 'verify_email' or user_id is not null);

comment on column public.sign_in_codes.purpose is
  'sign_in: signed out, no passkey on this device. step_up: signed in, proving it is you before a passkey is added. verify_email: the code the verification mail carries beside its link (onboarding OB-3), checked only for a signed-in caller against the account''s own address.';
