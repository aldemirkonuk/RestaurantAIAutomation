# 0225 — A password change ends every other session, by a session version

- **Status:** Accepted. The rule is the founder's and binding (2026-09-19, ADR 0174 D8, batches 5 and 6; restated 2026-09-25, round 4, item 17). The mechanism below was "Proposed" and awaiting his review on the PR; closed 2026-09-26 (R5, audit 3aaaf502e, fix round 1 of 2, PR #477) when he named #477 in his standing pre-approval to merge after audit (`founder-answers-2026-09-25-web-rebuild.md`, round 10, item 59, 2026-09-26).
- **Date:** 2026-09-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** password reset, change password, sign out, sessions, revocation, JWT, refresh token, websocket, session_version, sv
- **Links:** [[0174-email-is-a-paper-sheet-and-the-house-signs-it]] D8 (the reset mail says so), [[0175-one-tap-from-the-notification-is-staged]] decision 2, [[0164-sessions-follow-membership-and-several-houses-choose]] (PR #471), `v3.0-TECH-DEBT.md` "A password reset or change signs no other session out" (2026-09-19), migration `20260929020000_a_password_change_ends_the_other_sessions.sql`, `apps/api-gateway/src/auth/session-version.ts`

## Context

The founder, 2026-09-25 (round 4, item 17), verbatim: "Password reset/change
**signs out every other session**." The same rule was decided on 2026-09-19
(ADR 0174 D8: "a password reset revokes every other session and unenrolls every
enrolled phone, and the reset mail says so"; batch 6: "an in-app password change
revokes the same way; the current device stays") and never built.

The gateway mints its own JWTs in one place (`auth.service.ts`
`generateTokens`): a 15-minute access token and a 7-day refresh token, both
stateless. `resetPassword` said why nothing was revoked: `TokenBlacklistService`
can deny only a token it is handed, and nothing recorded which tokens a person
held. Three places read a token: `JwtStrategy` → `AuthService.validateJwtPayload`
on every HTTP request (it already reads the `users` row with `select("*")`),
`AuthService.refreshAccessToken` (the web's and the phone's refresh), and the
websocket handshake (`websocket.gateway.ts` `extractAuthContext`, signature only).
A fourth, outside the gateway, is the orchestrator's studio verifier
(`services/agent-orchestrator/services/override_service.py`
`_decode_studio_jwt`, signature only).

## Options considered

1. **Wait for expiry (short access tokens only).** Rejected: the refresh token
   lives 7 days and mints new access tokens; nothing ends.
2. **Rotate the signing secret.** Rejected: signs out every person, not one.
3. **Deny-list every issued token (extend `TokenBlacklistService`).** OWASP's
   JWT cheat sheet describes a digest deny-list for logout. To end *all* of a
   person's sessions it needs a registry of every token issued to them, written
   on every mint and refresh and kept until each token expires. Rejected: the
   store is Redis-optional (`common/cache/cache.service.ts` runs with no
   `REDIS_URL`), so a missing or evicted cache silently un-revokes — it fails
   open; and it grows with issuance, not with people.
4. **A server-side session / refresh-token store with rotation and reuse
   detection** (the RFC 9700 shape: a new refresh token on every use, a family
   revoked on replay). The right long-run shape, and ending sessions becomes
   "delete the rows but one". Rejected *for this change*: a new table on the
   hot refresh path, rotation semantics for the web and the phone at once, and
   access tokens still need a per-request check or live out their 15 minutes.
   Recorded as the revisit path below.
5. **A "sessions valid after" timestamp checked against `iat`.** Cheap and
   stateless, but `iat` has one-second resolution and is stamped by whichever
   gateway instance minted the token, while the cutoff comes from another
   clock: a token minted in the same second as the change, or under skew, is
   ambiguous. The session kept by a change is minted in that very second.
   Rejected for the integer below, which is exact.
6. **A per-person session version.** *Chosen.*

## Decision

**Every token carries the session version it was minted under (`sv`);
`users.session_version` goes up by one, in the same write as the new password;
every reader refuses a token below the current version; the session that made
a change is handed a new pair.**

- **One write.** `setPasswordEndingSessions` updates `password_hash` and
  `session_version = v + 1` together, compare-and-set on `v`, retrying up to
  three times if another change moved it. The password and the end of the old
  sessions cannot come apart; two racing changes both land, one version apart.
  A failed write fails the whole change (a password changed while the old
  sessions stay open is the state this exists to prevent).
- **Readers.** `validateJwtPayload` (zero extra queries: it reads the row
  already), `refreshAccessToken`, and the websocket handshake (one `users` read
  per connect; a failed read refuses). The refusal is 401 with code
  `SESSION_ENDED`; the web's existing 401 path refreshes, the refresh is
  refused, and it goes to `/login`; the phone signs out on a failed refresh
  (`apps/mobile/src/api/client.ts:66-71`).
- **Sockets.** `WebsocketGateway.endStaleSessions` closes the person's sockets
  opened under an older version (`session:ended`, then disconnect). The web's
  `WebSocketProvider` reopens with the new token when `lib/sessionRenewed.ts`
  announces the renewed pair (same tab: an event; other tabs: `storage`).
- **Minting.** `generateTokens` uses the version on the `users` row the
  credential was checked against, so a sign-in that verified the old password
  an instant before a change is minted under the old version and dies on its
  first request; a caller that passes anything else gets the database's
  current version, and a failed read mints nothing (503).
- **The kept session.** `POST /auth/me/password` returns `{ accessToken,
  refreshToken }`, same house, same dev-bypass standing; the web stores them at
  once (`profileApi.changePassword`). A reset (made from no session) keeps none.
- **Deploy order.** Tokens with no `sv` and rows with no column read as 0, the
  truth where no version was ever bumped; nobody is signed out by the deploy.
  Until the migration applies, a password change or reset fails closed (its
  write names the column).
- **The reset mail says so** (ADR 0174 D8, in the same change as the
  revocation): "When you choose a new password, every session on Mudavym is
  signed out." The reset and profile success lines say it too. [Narrowed
  2026-09-26 (R2/R3, audit 3aaaf502e): the earlier wording said "every device"
  unconditionally, which the "Given up / not covered" gaps below made untrue
  — the orchestrator's studio verifier and a socket on another gateway
  instance are neither "a session on Mudavym" nor ended by this change, so
  the copy no longer claims they are.]

## Consequences

- **Easier.** Any future "sign out everywhere" (a lost phone, a removed
  account) is one version bump, through the same readers.
- **Given up / not covered, stated:**
  - The orchestrator's studio verifier (`override_service.py`
    `_decode_studio_jwt`) checks the signature only, so a signed-out access
    token still opens studio endpoints until it expires (15 minutes at most).
  - `endStaleSessions` reaches only the sockets held by the instance that ran
    the change; another instance's socket stays open until it reconnects (then
    refused) or idles out. No socket.io adapter is configured
    (`websocket.gateway.ts` `afterInit`).
  - "Unenroll every enrolled phone" (ADR 0175 decision 2): phone enrollment
    does not exist yet, so there is nothing to unenroll; the phone's refresh
    token ends like any other.
  - A changing session's own socket closes and reopens (a moment without live
    updates).
  - **A first password needs no proof beyond the access token.** When
    `users.password_hash` is null (a Google-only account,
    `registerAccountWithGoogle` inserts `password_hash: null`,
    `auth.service.ts:1248`), `changePassword` asks for no `currentPassword`
    (`auth.service.ts:2791`, the check runs only `if (user.password_hash)`);
    `POST /auth/me/password` is guarded by `JwtAuthGuard` alone
    (`auth.controller.ts:311-313`). So anyone holding a live access token
    (15 minutes, `auth.service.ts:943`) can set the first password. That
    predates this ADR. What this ADR adds on top: the same call now also
    moves `session_version`, so it signs the true owner out everywhere
    (`SESSION_ENDED`) and hands the caller a fresh pair with a 7-day refresh
    token (`:948`). No step-up (recent sign-in or an emailed code) guards it,
    and no "your password was changed" mail exists — the only password mail
    is the reset request (`password-reset.template.ts`). The owner can sign
    back in with Google (that mints at the new version) but is told nothing,
    and the password the caller set keeps working until the owner resets it.
    Recorded 2026-09-27 (PR #477 fix round 2, audit `ef6052f78`, both
    reviewers); the remedy — step-up before a first set, a password-changed
    notice, or both — is not decided and is filed OPEN in `v3.0-TECH-DEBT.md`
    ("Setting a first password needs only a live access token", 2026-09-27).
- **Revisit when:** refresh-token theft or replay becomes a concern in its own
  right (then option 4, which subsumes this); a second gateway instance serves
  websockets (then an adapter, so `endStaleSessions` reaches every socket); the
  studio verifier gains a database read for another reason (then add the
  version check there).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | Build session (workflow subagent, lane W2-fix-auth) | Created with the build on `fix/password-change-revokes-sessions`. Gateway `password-change-ends-sessions.spec.ts` 18/18 (8 mutants each red: guard check, refresh check, handshake check, socket eviction, CAS filter, `sv` claim, version not bumped); `password-reset.spec.ts` 12/12 after its mock learned the one-write shape; web `profile.sessions.test.ts` 5/5 and `websocket.sessionRenewed.test.tsx` 1/1 (each mutation-checked red); PGlite full-corpus probe of the migration 8/8. CLAIMS `ADR-0225-PASSWORD-CHANGE-ENDS-OTHER-SESSIONS` (2 mutants red); `ADR-0162-ROLE-IN-TOKEN-HOUSE`'s pin of `validateJwtPayload` extended by the new refusal, bracketed in its claim text. |
| 2026-09-26 | PR Audit Gate (ADR 0090), planner Opus, correctness + security Sonnet | BLOCK at `3aaaf502e` — R1 CONFIRMED CRITICAL: `changePassword` verified `currentPassword` against one read of `password_hash` (`auth.service.ts:2746-2764`), then `setPasswordEndingSessions` compare-and-set only on `session_version` (`:783-826`), never re-checking the hash; someone who still knew the OLD password could race the account owner's own `resetPassword` and win, overwriting the owner's just-reset password and minting themselves fresh tokens — untested by `password-change-ends-sessions.spec.ts:317-350`. R4 CONFIRMED REGRESSION RISK: `session.restaurantId ?? row.restaurant_id ?? null` (`:2775`) was an eighth, untracked site of the fallback `ADR-0162-USERS-ROW-FALLBACK-RETIRED` tracks; mitigated at mint time by `generateTokens`' membership re-check, but contrary to ADR 0164's "houseless stays houseless" and uncovered by any test. R5: this ADR was "Proposed" with no recorded founder sign-off in the PR. R2/R3 confirmed live and disclosed (orchestrator signature-only verify, no socket.io adapter) but the reset-mail/toast copy claimed "every device … is signed out" unconditionally. Full report: `477-3aaaf502e.md`. |
| 2026-09-26 | Fix round 1 of 2 (workflow subagent) | R1 closed: `setPasswordEndingSessions` takes the caller's already-verified `password_hash` as `expectedCurrentHash` and refuses (`ConflictException`) the moment a fresh read shows it moved, and the compare-and-set write itself now also filters on it (`.eq("password_hash", …)` / `.is("password_hash", null)`), so a write can land only on the exact row state the caller proved knowledge of. `resetPassword` omits the argument — it authenticates by token, not a compared password — and keeps the plain `session_version` CAS. R4 closed: the fallback is gone; `changePassword`'s kept house is `session.restaurantId ?? null`, full stop. R2/R3: the reset-mail and toast copy narrowed from "every device … is signed out" to "every session on Mudavym … is signed out" (`ResetPassword.tsx`, `Profile.tsx`, `SecurityRegister.tsx`, `password-reset.template.ts`), which the orchestrator and cross-instance-socket gaps no longer contradict. R5 closed by founder pre-approval (see Status). Two new specs (R1, R4) added to `password-change-ends-sessions.spec.ts` (20/20); both fail against the pre-fix code and against 4 further targeted mutants (guard removed, CAS filter removed, `expectedCurrentHash` argument dropped, house fallback restored) — see `ADR-0225-PASSWORD-CHANGE-ENDS-OTHER-SESSIONS` in CLAIMS.jsonl, rewritten and mutation-tested the same way, `check_decision_claims.sh` 544/544 holding. `apps/api-gateway/src/auth` suite 334/334; `tsc --noEmit` clean; web `Profile.test.tsx` + `ProfileNext.test.tsx` 73/73. |
| 2026-09-27 | Fix round 2 of 2 (workflow subagent), audit `ef6052f78` OVERTURNED | Documentation only, no code change. (a) ADR 0174 D8's 2026-09-25 bracket still quoted the withdrawn draft "every device signed in to your account is signed out"; corrected in place to the shipped sentence (`password-reset.template.ts:30`) and pinned by the new CLAIMS row `ADR-0174-D8-RESET-MAIL-QUOTE-MATCHES-TEMPLATE` (mutation-tested: the template sentence changed, and the ADR quote reverted, each turn it red). (b) The first-set gap both reviewers found (`changePassword` asks no `currentPassword` when `password_hash` is null, `auth.service.ts:2791`; this ADR stacks sign-out and a fresh 7-day pair on it; no step-up, no password-changed mail) added to "Given up / not covered" above and filed OPEN in `v3.0-TECH-DEBT.md` (2026-09-27); the remedy is the founder's call. (c) PR body: the migration is `20260929020000`, not `20260926120500`; stale #471 notes dropped. |
