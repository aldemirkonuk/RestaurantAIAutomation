---
type: adr
id: 0022
title: Email verification is enforced, and enforced on the server
status: proposed
updated: 2026-08-26
links: ["[[0020-no-fabricated-answers]]", "[[OPEN-DECISIONS]]", "[[OD-77-81-SESSION-PLAN]]"]
---

# 0022 — Email verification is enforced, and enforced on the server

- **Status:** Proposed — closes [OD-79](OPEN-DECISIONS.md)
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — chose *enforce* over *delete the pretence* on 2026-08-26
- **Keywords:** auth, email verification, guard ordering, fail closed, ProtectedRoute, JwtAuthGuard, allowlist
- **Links:** [OD-79](OPEN-DECISIONS.md), [0020](0020-no-fabricated-answers.md)

## Context

The product had an email-verification gate that could not fire, in either layer.

**Layer 1 — the browser.** `ProtectedRoute.tsx:42` reads
`if (user?.emailVerified === false)`. `AuthContext` populates `user` from
`GET /auth/me` and from nowhere else — seven call sites, none of which decode
the JWT. `getProfileForUser` did not select `email_verified` and did not return
`emailVerified`. So the comparison was `undefined === false`, which is `false`,
on every render since the gate was written.

**Layer 2 — the server.** There was none. `JwtStrategy.validate` built
`request.user` from five fields and dropped `email_verified`, so even a
correctly written server-side check would have had nothing to read.

The data was never missing. `generateTokens` has signed `emailVerified` into
every access and refresh token since before this entry was filed
(`auth.service.ts:440`). It was simply never read back out, and `JwtPayload`
did not declare it. The field existed, was correct, travelled with every
request, and was discarded twice on the way out.

Registration path B (`registerRestaurant`) sets `email_verified: false` and
then reaches the dashboard by *skipping* verification, not by passing it.
Invited users are set `true` because the inviting owner vouched for them
(`auth.service.ts:1221`) — that path is deliberate and unchanged.

## The fork

Two honest options, and one that looked reasonable and was not.

**(a) Enforce.** Surface the flag through `/auth/me` and `request.user`, and
gate the routes that matter.

**(b) Delete the pretence.** Remove the dead comparison and the verification
plumbing, per [0020](0020-no-fabricated-answers.md): a check that cannot fail
is a fabrication, and leaving it in place invites someone to trust it.

**(c) Enforce for new accounts only** — backfill `email_verified = true` for
everyone who exists today. Rejected: it permanently blesses four addresses
that were never proven, to avoid a cost that measurement showed to be
negligible.

## Decision

**Enforce.** What decided it was measurement, not preference.

- **10 accounts exist. 4 are unverified.** Three are seed rows sharing a
  2026-02-08 timestamp; one is a personal test address from 2026-07-18. **Zero
  customers are affected.** This is the cheapest this change will ever be, and
  the cost grows monotonically with every account added.
- **The escape hatch already works, end to end.** `/verify-email` is a public
  route (`App.tsx:152`, deliberately outside `ProtectedRoute` — inside it, the
  redirect would loop). It redeems tokens, and it resends, rate-limited to one
  per minute. Enforcement without a working way out would be a trap; this one
  is not.
- The machinery for (b) to delete is fully built and working. Deleting it now
  only to rebuild it before the first real signup is pure waste.

**And enforce it on the server.** A browser-only gate stops a redirect, not a
request: `curl` with a valid token never went near `ProtectedRoute`. Option (a)
done only in the client would have reproduced the defect one layer up.

## Where the check runs, and why that is the whole decision

`assertEmailVerified` is called from inside `JwtAuthGuard`, immediately after
passport populates `request.user` — not from a new global guard.

This is the second time that placement has decided whether a check works at
all. Nest runs guards **global → controller → route**. `JwtAuthGuard` is
applied per-route with `@UseGuards`. A global `APP_GUARD` therefore executes
*before* `request.user` exists. That is exactly how tenant isolation came to be
unenforced across every authenticated route — `TenantGuard` held a correct
comparison it could never reach, and a fix applied to that comparison on
2026-08-25 was inert for the same reason. `assertTenantMatch` was extracted for
this; `assertEmailVerified` sits beside it.

**It fails closed on a missing field.** If `emailVerified` is absent, some
caller populated `request.user` by a path that does not carry it, and the
honest reading of "I cannot tell" is "not verified". The alternative is the
silent always-allow that produced this entry.

**Both readers use the database column, not the token claim.** A token is a
snapshot from issue time; a user who verifies after their last login would
otherwise carry `false` for up to 15 minutes and be locked out of the app they
just unlocked.

## The allowlist, and why it must stay short

Six routes carry `@AllowUnverified`. An unverified session must be able to
learn that it is unverified, fix it, and leave:

| Route | Why |
|---|---|
| `GET /auth/me` | the web client populates `user` from here and nowhere else |
| `GET /auth/me/role` | fetched alongside it on boot |
| `POST /auth/resend-verification` | the escape hatch itself |
| `GET /auth/verify` | answers "is this token live?", not "may you use the app?" |
| `POST /auth/logout` | leaving must never require verifying first |
| `DELETE /auth/me` | deleting an account you cannot verify must stay possible |

Gating `/auth/me` is the subtle one: a blocked session could not then discover
*why* it was blocked, and the resulting redirect loop is indistinguishable from
a broken login. Add to this list only for routes that are part of getting
verified or getting out — never to make a feature work for an unverified
account.

## Consequences

- Four existing accounts are bounced to `/verify-email` until they click
  through. `konukp@hotmail.com` is the only non-seed address among them.
- Any authenticated call to a gated route returns **403** with
  `code: "EMAIL_NOT_VERIFIED"`. The web client routes on the code, not the
  message, because `ProtectedRoute` only catches this on navigation — a
  background refetch from an already-mounted page would otherwise surface a
  bare "Forbidden".
- New third-party integrations calling the gateway with a user token must
  either verify or be added to the allowlist deliberately.

## Evidence

Three reverts, because a test that cannot fail is what produced this entry:

| Reverted | Result |
|---|---|
| the `/auth/me` field | 3 profile assertions failed, the other 4 passed |
| the `JwtStrategy` field | 3 strategy assertions failed |
| the guard's call to `assertEmailVerified` | the wiring suite failed — **and `assert-email-verified.spec.ts` still passed all 6** |
| the token-payload field (pre-existing) | **nothing failed** |

The third row is the one that matters: unit-testing the comparison alone would
not have caught an unwired check, which is precisely what happened to the
tenant guard. The fourth was a live coverage hole — it is why a revert aimed at
the token payload reads as a *passing* revert, and it is what derailed an
earlier attempt at this fix. Both are now covered.

Full gateway suite: **86 suites, 1105 passed, 0 failed.** Web `tsc` and `vite
build` clean.

## Rejected alternatives

- **A new global `EmailVerifiedGuard`.** The obvious shape, and it would have
  been inert for a documented, already-experienced reason. Rejected on the
  evidence of the tenant guard.
- **Reading `payload.emailVerified` in the guard.** One fewer field to plumb,
  but it locks out anyone for the remaining life of their token after they
  verify.
- **Gating everything, with no allowlist.** Produces a redirect loop that reads
  as a broken login, and strands the user with no way to resend.
- **A feature flag.** `restaurant_feature_flags` is a per-restaurant EAV table
  (see OD-86); email verification is per-*user* and applies before a restaurant
  is necessarily known. Wrong axis.
