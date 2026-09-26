# 0229 — A passkey or an emailed code signs you in, and a recent sign-in guards enrolment

- **Status:** Proposed — the founder answered WHAT on 2026-09-25 (item 29, below) and answered forks 1-3 on 2026-09-26 (round 6, item 37, § Open forks); this record is the HOW, and fork 4 is still his
- **Date:** 2026-09-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** passkey sign-in, discoverable credential, user handle, WebAuthn authentication, one-time code, OTP, email code, step-up, re-authentication, auth_time, freshness, enumeration, rate limit, HMAC, session_version, membership, recovery, lost device
- **Links:** [[0222-passkeys-are-verified-by-the-gateway-and-consents-gather-on-one-panel]] (the enrolment half; its fork 1 and fork 2 are answered here), ADR 0024 (identity-first sign-in; `sign-in-methods` enumerates by decision), ADR 0096 (every route says whether it is public), ADR 0164 (sessions follow membership — PR #471, open), ADR 0225 (a password change ends other sessions — PR #477, open), ADR 0134 §7 (SC 3.3.8) **[2026-09-26: §7's "owner and manager only" no longer governs passkey enrolment — the founder's round-6 answer below lets staff enrol; §7 still governs what a passkey may approve, which is nothing until F11]**, PR #479

## Context

The founder, 2026-09-25 (round 5, item 29), confirmed reading, recorded in
memory `founder-answers-2026-09-25-web-rebuild.md` item 29:

> passkey (Face ID/Touch ID) IS a sign-in method; logged-out with no passkey
> → emailed one-time code; enrolling while signed in: signed in within last
> 10 min = direct, else email code first.

That supersedes ADR 0222's as-built "type your current password" proof and
ADR 0134 §7's action-only reading of a passkey. Password and Google sign-in
stay; these are more doors to the same session.

Measured before building (worktree `wt-w2-profile`, branch head `b0a031927`,
merged with `origin/main` `e4f81d748`):

- Every session is minted by `AuthService.generateTokens`
  (`apps/api-gateway/src/auth/auth.service.ts`), a gateway JWT whose `sub` is
  `public.users.user_id` (memory `auth-users-vs-public-users`): 15-minute
  access, 7-day refresh, both carrying the same payload. Refresh re-mints from
  the payload; nothing recorded **when** a person last proved who they are.
- `request-password-reset` is already enumeration-safe and throttled
  (`PasswordResetThrottleGuard`, per-email cooldown). `sign-in-methods`
  enumerates on purpose (ADR 0024). An emailed reset link already gives full
  control of an account, so **control of the mailbox is already this
  product's account-recovery floor**.
- PR #471 (ADR 0164) and PR #477 (ADR 0225) both change `generateTokens`; both
  are open.

## Options considered

### Passkey sign-in

1. **Discoverable-credential ceremony, verified in the gateway** (chosen).
   `generateAuthenticationOptions` with no `allowCredentials`, UV required;
   the browser offers the passkey it holds; the assertion's `userHandle` (the
   opaque `public.users.user_id` the credential was made with, ADR 0222) must
   equal the credential row's owner; `verifyAuthenticationResponse` checks
   signature, origin, RP ID, challenge, UV and counter. The proven id is then
   handed to `AuthService.issueSessionForVerifiedSignIn`, which mints through
   `generateTokens` — so ADR 0164's membership rule and ADR 0225's `sv` apply
   to a passkey exactly as to a password, with no second minting path.
2. **Username-first** (type the email, then `allowCredentials` for that
   account). Rejected: it enumerates which addresses hold passkeys, and adds a
   step the founder's "Face ID" reading does not have.
3. **Conditional UI** (passkeys offered in the email field's autofill,
   `mediation: "conditional"`). Deferred, not rejected: it starts a ceremony —
   and writes a challenge row — on every anonymous page load. Revisit with a
   stateless or rate-shaped challenge store.
4. **Supabase Auth passkeys.** Rejected for ADR 0222's reason: nobody signs in
   through Supabase Auth here.

### Signed out with no passkey: an emailed code

1. **Six-digit code, HMAC-stored, ten minutes, single use** (chosen). Rules,
   each a constant in `sign-in-codes.service.ts`:
   - `crypto.randomInt`, six digits (NIST SP 800-63B's floor for an
     out-of-band secret; what `autocomplete="one-time-code"` expects);
   - stored as HMAC-SHA256 under a key derived from `JWT_SECRET`
     (`mudavym/sign-in-code/v1`), compared with `timingSafeEqual` — a plain
     hash of six digits falls to a million guesses offline;
   - 10-minute TTL, consumed by a compare-and-set on `consumed_at`; a newer
     code supersedes older live ones;
   - 5 wrong tries kill a code; **20 wrong tries per address per day** lock
     the code path for that address (password, Google and passkeys still
     work) — an online guesser gets 20 in 1,000,000 a day, under NIST's
     100-consecutive-failure ceiling;
   - 5 codes per address per hour; 20 per requesting source per hour; plus
     `@RateLimit` on each public route.
   **Enumeration:** a row is written for an address with no account too
   (`user_id` null, no mail), so every limit trips identically; the mail is
   not awaited, so response time does not say whether one was sent; one
   refusal sentence covers wrong, expired, superseded and accountless codes.
   The code is the mail subject's first word so a phone can fill it; the mail
   carries no link.
2. **Magic link.** Rejected: a link opened on another device signs in *that*
   device (the person at the laptop is left waiting), mail scanners pre-fetch
   links, and a link is easier to phish into a lookalike page than a code
   typed on the page that asked for it.
3. **Eight digits.** Rejected for now: the per-address daily lock already
   holds guessing to 20 a day; six is what phones autofill and people type.
4. **bcrypt instead of HMAC.** Rejected: a slow hash of a six-digit space is
   still searched offline in hours; a keyed hash is not searchable without
   the key.
5. **Twilio Verify / a hosted OTP service.** Rejected: a new subprocessor
   (ADR 0207's list) for a mail the gateway already sends.
6. **SMS.** Out of scope — not what he said, and NIST 800-63B-4 restricts it.

**Stated plainly:** NIST SP 800-63B does not accept email as an out-of-band
authenticator. This design does not claim an assurance level; it claims no
*new* trust root — a mailbox that can receive a reset link can already take
the account. The founder's rule stands on that floor, not above it.

### Enrolling while signed in: "within the last 10 minutes"

1. **An `auth_time` claim** (OIDC's name, seconds) (chosen). Stamped only by
   an interactive sign-in — password, Google, Microsoft, passkey, emailed
   code, and the sign-ups/invite join that just typed a password — and
   **carried unchanged** by refresh, house switch and first-house creation.
   `generateTokens`' new parameter defaults to `null`, so a call site that
   forgets it mints a session that is *not* recent (fails closed);
   `verifyEmail` passes nothing on purpose. `JwtStrategy` hands it to routes
   as `authTime`, accepting only a number. `isFreshSignIn`: `now − auth_time
   ≤ 600 s`, 60 s of future clock slack, missing = stale.
   Stale → `403 { code: "STEP_UP_REQUIRED" }` (never 401: the web client
   would refresh and retry). The web then calls `POST /passkeys/step-up/code`,
   which mails the account's **own** address (read from the row, never the
   body) and is awaited and reported; the code comes back as `emailCode` on
   `registration/options` and is checked before any challenge exists. A fresh
   session never burns a code. Works for a Google-only account.
2. **`iat` of the token.** Rejected: refresh re-mints `iat` every 15 minutes,
   so a week-old sign-in would look fresh forever.
3. **A per-user `last_authenticated_at` column.** Rejected: it is per person,
   not per session — a stolen token would borrow the owner's fresh sign-in on
   another device.
4. **Re-mint a fresh pair after the code** (OIDC-style step-up). Rejected for
   now: it touches session storage on the web and `generateTokens` callers
   that PRs #471/#477 are also rewriting; checking the code inline at
   `registration/options` binds the proof to the one ceremony it unlocks.
5. **Keep "type your password".** Superseded by his answer; it also locked
   out Google-only accounts.

### Round 6 (the founder, 2026-09-26): what a reset, an enrolment and a code do

**[2026-09-26, founder, round 6, item 37 — all four on the recommended
option.]** Verbatim as recorded in memory
`founder-answers-2026-09-25-web-rebuild.md` item 37 (the only written record;
the question's exact option labels were not captured there):

> Passkeys (ADR 0229): password reset RETIRES every passkey (kept as revoked,
> not deleted) + every new passkey emails the account; staff may enrol
> passkeys too; emailed-code sign-in marks email verified.

Built on PR #479 (the HOW is this lane's; each part has a rejected
alternative):

1. **A reset retires every passkey.** `AuthService.resetPassword` calls
   `retireEveryPasskey` (`apps/api-gateway/src/passkeys/retire-passkeys.ts`)
   after the password write and **before** the link is consumed. Every live
   row of the account gets `revoked_at` = now and `revoked_by` = the account
   (a reset is made from no session; the emailed link is the proof, so the
   account is the actor), in one compare-and-set on `revoked_at is null`, so
   a passkey removed earlier on `/profile` keeps its own time and actor. Rows
   are never deleted. Each retired row gets a `system_audit_log` row
   (`passkey_revoked`, `reason` = `password_reset`) — that is where "why" is
   read back. A failed retirement answers 503 ("Your new password is saved,
   but your passkeys could not be removed. Open the same reset link again to
   finish.") and leaves the link live. Rejected: retire *before* the password
   write (a failed write would leave passkeys gone and the password
   unchanged, while "nothing was changed" would be untrue); a new
   `revoked_reason` column (a migration for what the audit row already
   holds); deleting rows (his words: kept as revoked); retiring
   best-effort and still reporting the reset done (the state this exists to
   prevent).
2. **Every new passkey emails the account.** `finishRegistration` sends
   "A passkey was added to your Mudavym account"
   (`communications/email-templates/passkey-added.template.ts`) through
   `GmailService`, to the address read from `users` by the token's id — never
   from the request. The mail names the passkey (escaped), its kind, the
   address it was added on and the time in UTC; it carries no credential id,
   no public key, no code and no link, and says what to do if it was not you
   (reset — which retires every passkey — then check `/profile`). Awaited;
   the receipt gains `mailed`, and `/profile` says when it was not sent. A
   failed mail never undoes the enrolment. Rejected: fire-and-forget (the
   receipt would claim nothing); a link in the mail (phishable, and the
   sign-in-code mail already set the no-link rule); mailing removals too (not
   asked; the in-app notice stays).
3. **Staff may enrol.** `PasskeysService.eligibility` accepts any role in the
   token's house; only no role (not a member, or unreadable) refuses. The
   house requirement stays (a houseless session still cannot enrol — not
   asked; reported below). Rejected: owner/manager only (ADR 0134 §7 as first
   recorded).
4. **An emailed-code sign-in verifies the email.**
   `AuthService.issueSessionForVerifiedSignIn(userId, "email_code",
   provedEmail)` — reached only after `SignInCodesService.verify` succeeded —
   writes `users.email_verified = true` when the address the code was checked
   against is still the account's address (compare-and-set on `email`), and
   mints the session from the written row, so the new session is verified at
   once. A passkey sign-in verifies nothing (it proves the device, not the
   mailbox). A failed write is logged and the session is minted unverified,
   which is the state the person was already in. Rejected: verifying on the
   passkey path too; writing without the address match (a code mailed to an
   address the account moved away from within its ten minutes proves the old
   mailbox).

**Merge order with #477** (`fix/password-change-revokes-sessions`, ADR
0225). The reset path is on `main` and #477 rewrites it; the passkey hook is
built here, on `main`'s `resetPassword`. Whichever of #477 and #479 merges
second resolves `resetPassword` as: #477's `setPasswordEndingSessions(...)`
call, then this `retireEveryPasskey` block, then the `password_resets`
consume — and keeps both edits to `auth/password-reset.spec.ts` (#477's
session-version fake and this `user_passkeys` fake). Neither order loses
anything; #477 first is simpler (its rewrite is the bigger one).

## Decision

A passkey signs you in through a discoverable-credential ceremony whose user
handle must match the credential's owner; an emailed six-digit code signs you
in when this device has none; both mint only through
`AuthService.issueSessionForVerifiedSignIn`. Adding a passkey needs an
`auth_time` within ten minutes or an emailed code. Built in
`apps/api-gateway/src/passkeys/` (`sign-in.controller.ts`,
`sign-in-codes.service.ts`, `passkeys.service.ts`), migration
`20260927110000_passkey_sign_in_and_email_codes.sql` (`sign_in` challenge
purpose with no person; `sign_in_codes`), and on `/login` and `/profile`.

**Recovery when a device is lost.** A passkey is never the only door:
password, Google and the emailed code remain, and a synced passkey
(iCloud Keychain, Google Password Manager) survives the device. Lost device →
sign in with the emailed code → remove it on `/profile`. No recovery codes
while the emailed code exists.

**With #471 and #477.** Both sign-in doors reach `generateTokens`, so a
passkey session carries ADR 0164's membership check and ADR 0225's `sv` the
moment those merge; a password change ends passkey and code sessions too.
Merge notes (also in the PR): #471's house parameter and this `authTime`
parameter both extend `generateTokens` — keep both; `signInWithSession` must
go through #471's `storeSession` and its chooser; #477's `changePassword`
mint should stamp `signedInNow()` (the password was just typed).

## Open forks (the founder's; reported, not locked)

1. **[ANSWERED 2026-09-26, founder, round 6: (b) AND (c) — "password reset
   RETIRES every passkey (kept as revoked, not deleted) + every new passkey
   emails the account". Rejected: (a) as built; (b) alone; (c) alone. Built:
   § Round 6, parts 1-2.]** **A passkey outlives a password reset.** Someone who signs in with a
   stolen password can, within ten minutes, add a passkey; #477 ends their
   sessions on reset, but the passkey still signs them in until the owner
   removes it on `/profile`. Built: audit row, in-app notice, the list on
   `/profile`, and the step-up mail's "remove any passkey you do not
   recognise". Paths: (a) as built; (b) email the owner on every enrolment
   (ADR 0222 fork 5); (c) a reset also removes every passkey. **Recommendation:
   (b) now; (c) only if (b) is not enough.**
2. **[ANSWERED 2026-09-26, founder, round 6: "staff may enrol passkeys
   too". Rejected: owner/manager only. Built: § Round 6, part 3.]** **Staff
   and passkeys.** Enrolment stays owner/manager (ADR 0134 §7). Now
   that a passkey is a sign-in method, staff might want one too.
3. **[ANSWERED 2026-09-26, founder, round 6: "emailed-code sign-in marks
   email verified". Rejected: leave `email_verified` unwritten. Built: § Round
   6, part 4.]** **Does a code sign-in verify the email?** It proves the mailbox, but
   `email_verified` is not written; an unverified account signed in by code
   still lands on `/verify-email`.

4. **[OPEN, 2026-09-26] Does a password CHANGE retire passkeys too?** His
   answer names the reset; a change is not built to retire anything. PR #477
   (ADR 0225) treats a change like a reset — both go through
   `setPasswordEndingSessions` and end every other session. Paths: (a) change
   leaves passkeys alone (as built; the person just typed their current
   password, and a passkey is theirs to remove on `/profile`); (b) a change
   retires every passkey too, like a reset. **Recommendation: (b)**, because
   #477 already treats a change like a reset and a person changing their
   password after a scare expects every other door closed; cost: the owner
   re-adds their own passkeys after every change. Not built until he answers.
5. **[OPEN, 2026-09-26, reported] A session with no house cannot enrol.** A
   passkey is per person, not per house, but eligibility still needs a role in
   the token's house, so an account on `/get-started` cannot add one. Not
   asked in round 6; left as built.

## Consequences

- Every session minted before this deploy has no `auth_time`, so the first
  passkey anyone adds after it needs an emailed code (or a new sign-in).
- One more mail type through `GmailService`; if mail is down, code sign-in
  and stale-session enrolment fail with a sentence, while password, Google
  and passkey sign-in do not depend on it.
- The per-source limit reads `x-forwarded-for`'s first entry like the
  gateway's other limiters; it slows a script, the per-address and per-code
  limits (in the database, multi-instance safe) are the ones that hold.
- **[2026-09-26]** A reset now takes every passkey with it: someone who
  resets on purpose re-adds their own passkeys afterwards. `/profile` lists
  them as removed on the reset's date.
- **[2026-09-26]** One more account mail ("a passkey was added"), through the
  same `GmailService`; when mail is down the passkey is still added and
  `/profile` says the mail was not sent.
- Revisit when: #471 or #477 merges (the merge notes above); F11 lands (a
  passkey at the point of action); conditional UI is wanted; fork 4 is
  answered.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | lane W3-passkeys (agent) | Created, Proposed. Gateway: `passkeys.sign-in.spec.ts` 22, `sign-in-codes.service.spec.ts` 18, `auth-time.spec.ts` 7 (real `@simplewebauthn/server` against a software authenticator; real `JwtService`). 23 gateway mutants of the checks: 20 red, 3 green — each green one a check guarded twice (the revoked filter, the code's single use, the challenge's purpose binding); the compound mutants removing both guards of the first two, and both UV guards, went red (the purpose binding is backed by the table's `(purpose = 'sign_in') = (user_id is null)` check, so it is not reachable alone). Web: 5 mutants, 5 red. PGlite full-corpus probe of the migration 16/16. No independent adversarial fan-out ran (no Workflow tool in this lane); the forks above are this lane's own adversarial pass |
| 2026-09-26 | lane W4-passkeys (agent) | Founder round 6 item 37 recorded (forks 1-3 answered) and built: reset retires passkeys, enrolment mail, staff enrolment, code sign-in verifies email. New `founder-round-six.spec.ts` 12 cases (real `AuthService.resetPassword` + real passkey ceremonies: a retired passkey cannot sign in). 8 source mutants of the new checks, 8 red (one initially green — the session minted from the pre-write row — killed by moving that case onto the copy-returning fake). Two new CLAIMS rows, 7 mutants, 7 red. Fork 4 (password change) opened, not built. No independent adversarial fan-out ran |
