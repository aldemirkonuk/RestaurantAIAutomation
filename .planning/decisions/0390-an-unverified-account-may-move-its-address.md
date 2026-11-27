# 0390 — An unverified account may move its address, and only that

- **Status:** Decided 2026-11-20 by the r104 builder under the founder's standing delegation of every fork; the founder may supersede it
- **Date:** 2026-11-20
- **Keywords:** sign-up, verify-email, typo, change address, auth surface, rate limit
- **Links:** ADR 0229 fork 12 (the link needs a session), PR for r104 onboarding gap 2

## Context

A typo in the sign-up address sent the verification mail to a stranger or to nobody. The check-your-email page offered Resend (to the same wrong address) and "Back to sign in". The person could not finish, and could not register again with the right address while the typo account held the session.

## Decision

`POST /auth/change-unverified-email { email }`, signed in, allowed while unverified:

1. Only an account whose `email_verified` is false. A verified account is refused 409 `EMAIL_ALREADY_VERIFIED`; moving a proved address is the profile's job, with its own proof.
2. The new address is lower-cased and must be free by the lookup sign-up uses (409 `EMAIL_TAKEN`). A unique-index clash at the write answers the same 409.
3. At most 2 changes a minute per account (429), in the process, like the password-reset guard it copies.
4. Every pending `email_verifications` row is deleted FIRST. Verification keys on the token and then verifies the user, never the address, so a link mailed to the old address would otherwise verify the new one. If the delete fails, nothing else is written (503).
5. The write is compare-and-set on the old address and `email_verified = false`.
6. A fresh link goes to the new address, and a new session pair is returned, because the session token carries the address.

## Rejected

- Letting a verified account change address here: no proof of the new address, so it would be an account-takeover step.
- Keeping old links alive until they expire: they verify the new address (point 4).
- Making the person register again: the typo account keeps the name, password and house.
- A database-backed limiter: no shared cache is reachable here; the per-process limit stops the common client retry. Across several instances it is looser; move it to the shared cache when the gateway runs more than one.

## Not covered

- The code path of PR #875 (six digits typed from the mail) must also key on the current address once it lands.
- An invitee whose account was made for an invite's address is not special-cased.
