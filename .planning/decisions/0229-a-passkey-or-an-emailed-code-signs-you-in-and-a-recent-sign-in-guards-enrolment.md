# 0229 — A passkey or an emailed code signs you in, and a recent sign-in guards enrolment

- **Status:** Locked **[2026-09-27, the founder, round 11, item 63, verbatim: "Lock both as built (Recommended)" — ADR 0222 and ADR 0229 locked as built on PR #479. Fork 6 below was found by the ADR 0090 audit and was not in front of him when he answered, so it is recorded open rather than folded into the lock]** **[Amended 2026-09-27, the founder, item 67, verbatim: "option 1 + do what industry do for these, for security ops do what the industry leaders do" (the label he chose: "Drop pwd + (b) interim (Recommended)") — fork 6 RESOLVED as path (a), built on PR #479 with the industry-leader defences in § Fork 6; (b) is moot because #477 (ADR 0225) merged first. Two new forks (7, 8) found by that research are open. The ADR stays Locked]** **[Amended 2026-09-27, the founder, items 72 and 73, verbatim labels "Bind invite to address (Recommended)" and "Expire the password, 7 days (Recommended)" — forks 7 and 8 RESOLVED and built on PR #479 (§ Forks 7 and 8). Building them found two more, forks 9 and 10, open. The ADR stays Locked]** **[Amended 2026-09-27, the founder, items 77 and 78, verbatim labels "Email invite + (c) interim (Recommended)" and "Refresh refuses lapsed (Recommended)" — forks 9 and 10 RESOLVED and built on PR #479 (§ Forks 9 and 10). Building them found fork 11 (the invite-mail limit is per house), open. The ADR stays Locked]** **[Amended 2026-09-28, the founder, round 15, items 81, 82 and 83, verbatim labels "Link needs sign-in (Recommended)" (fork 12), "Hold until accepted (Recommended)" (fork 13) and "Per address + per sender" (fork 11) — forks 11, 12 and 13 RESOLVED and built on PR #479 (§ Forks 11, 12 and 13). No new fork was found. The ADR stays Locked]** — the founder answered WHAT on 2026-09-25 (item 29, below), answered forks 1-3 on 2026-09-26 (round 6, item 37, § Open forks), and the same day (round 7, item 44) ordered industry practice for a reset AND a change — which **supersedes round 6's "reset RETIRES every passkey"** and answers forks 4 and 5 (§ Round 7); this record is the HOW
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
     100-consecutive-failure ceiling; **[2026-09-27, PR #479 audit-fix round
     2: each try is now claimed by a compare-and-set on `attempts` BEFORE the
     code is compared (`SignInCodesService.claimTry`), so a burst of parallel
     guesses gets at most 5 comparisons per code — fix round 1 counted every
     wrong guess but still compared first, so N parallel guesses got N
     comparisons. The day check reads before the claim, so a burst on the
     day's last code can pass 20 by up to 4: the ceiling is 24 comparisons per
     address per day, assuming only one code is live — the per-hour issue cap
     is a read-then-insert and was not re-measured under concurrency. A right
     guess spends a try but is not counted as a wrong one.]**
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

**[2026-09-26, round 7 — part 1 below is SUPERSEDED by § Round 7: a reset no
longer retires passkeys. It was built on this PR (commit `d313e046b`) and
removed again before merge; `retire-passkeys.ts` is deleted. Parts 2-4 stand,
part 3 widened to people with no house, part 2's "Not you?" advice changed.]**

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
   (reset — which retires every passkey — then check `/profile`) **[round 7:
   now "remove this passkey on your profile, then reset your password — a new
   password does not remove passkeys"]**. Awaited;
   the receipt gains `mailed`, and `/profile` says when it was not sent. A
   failed mail never undoes the enrolment. Rejected: fire-and-forget (the
   receipt would claim nothing); a link in the mail (phishable, and the
   sign-in-code mail already set the no-link rule); mailing removals too (not
   asked; the in-app notice stays).
3. **Staff may enrol.** `PasskeysService.eligibility` accepts any role in the
   token's house; only no role (not a member, or unreadable) refuses. The
   house requirement stays (a houseless session still cannot enrol — not
   asked; reported below). Rejected: owner/manager only (ADR 0134 §7 as first
   recorded). **[round 7, item 44: no house and no role gates a passkey any
   more — see § Round 7, part 3.]**
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
0225). **[round 7: rewritten — there is no retirement block any more.]**
Whichever of #477 and #479 merges second resolves `resetPassword` as: #477's
`setPasswordEndingSessions(...)` call, then the `password_resets` consume,
then this PR's `mailPasswordChangedNotice(reset.user_id, "reset")`; and
`changePassword` as #477's session-ending write and new pair, with
`mailPasswordChangedNotice(userId, "change")` after the write and before the
pair is returned. Keep both edits to `auth/password-reset.spec.ts` (#477's
session-version fake and this PR's read-only `user_passkeys` fake). Once #477
is on `main`, the notice mail may also say "every other device was signed
out" — not written here, because on this branch it is not yet true.

### Round 7 (the founder, 2026-09-26): follow industry practice for a reset and a change

**[2026-09-26, founder, round 7, item 44.]** Verbatim as recorded in memory
`founder-answers-2026-09-25-web-rebuild.md` item 44:

> Passkeys vs password: his words "do industry mimic both for password RESET
> retires every passkey, and password CHANGE while signed in do same" →
> follow INDUSTRY PRACTICE for both reset and change (research it; this may
> supersede item 37's "reset retires"). No-house enrolment: passkey belongs to
> the person (industry) → allowed.

**What industry does** (researched 2026-09-26 with WebSearch/WebFetch; each
row cites the page read. "Kept" is stated outright by some sources and is
otherwise the absence of any removal in pages that describe exactly what a
reset or change does — that is marked "by omission"):

| Who | Passkeys on a RESET (email recovery) | Passkeys on a CHANGE (signed in) | Other sessions | Notification |
|---|---|---|---|---|
| Google Account | Kept — "If you add a passkey … it doesn't change or remove any authentication or recovery factors"; removal is manual on a device you can reach ([13548313](https://support.google.com/accounts/answer/13548313?hl=en)); reset page lists no passkey removal ([41078](https://support.google.com/accounts/answer/41078?hl=en)) | Kept (same pages, by omission) | Change **or** reset: "signed out everywhere except" devices used to verify it's you ([41078](https://support.google.com/accounts/answer/41078?hl=en)) | Security alert mail; Google disables *suspicious* passkeys and notifies (13548313) |
| Apple Account | Kept (by omission) | Kept (by omission) ([101567](https://support.apple.com/en-us/101567)) | The person chooses "Remove Other Devices" or "Keep All Devices Signed In" (101567) | — (not stated on the page read) |
| Microsoft account | Kept (by omission); passkeys removed only by the person on the security dashboard ([manage your saved passkeys](https://support.microsoft.com/en-us/accounts-billing/security/manage-your-saved-passkeys)) | Kept (by omission) | A change does not sign out; "Sign out everywhere" is a separate action (Microsoft Q&A community answers [3945683](https://learn.microsoft.com/en-us/answers/questions/3945683/changed-password-of-my-microsoft-account-does-it-l), [5806685](https://learn.microsoft.com/en-us/answers/questions/5806685/if-i-sign-out-of-my-microsoft-accounts-everywhere) — community, weaker evidence) | — |
| GitHub | Kept — a passkey even satisfies the password + 2FA during recovery ([recovering your account](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/recovering-your-account-if-you-lose-your-2fa-credentials)); deleting one is manual ([managing your passkeys](https://docs.github.com/en/authentication/authenticating-with-a-passkey/managing-your-passkeys)) | Kept (by omission) ([updating your access credentials](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/updating-your-github-access-credentials)) | Signing out GitHub Mobile after a reset is a separate, optional step (same page) | — |
| Okta (workforce) | Kept — resetting authenticators is a separate admin action ([reset MFA](https://support.okta.com/help/s/article/How-to-reset-MFA-for-end-users?language=en_US)) | Kept (same) | Optional "Sign me out of all other devices" checkbox on reset and change ([end-user settings](https://help.okta.com/eu/en-us/content/topics/end-user/end-user-settings-v2.htm)) | — |
| Auth0 | Kept (by omission — the articles on password change revoke tokens, never authenticators) | Kept (by omission) | Tenant-configured: revoke refresh tokens / back-channel logout on password change ([support article](https://support.auth0.com/center/s/article/Revoke-all-the-refresh-tokens-in-a-Family-when-a-user-change-reset-password-after-an-account-compromise)) | — |
| 1Password | n/a (no emailed reset — the Secret Key model) | Account password change: every device asks for the new password ([change account password](https://support.1password.com/change-account-password/)) | Lost device → deauthorize **that** device; a password change is not needed ([lost device](https://support.1password.com/lost-device/)) | — |
| Dashlane | **Not found** — no public page states what a master-password reset does to passkeys or sessions; not counted | — | — | — |
| NIST SP 800-63B-4 ([events](https://pages.nist.gov/800-63-4/sp800-63b/events/)) | No requirement to invalidate every authenticator on recovery; §4.3: compromised authenticators SHALL be suspended/invalidated — **the one that is compromised**, not all | same | Not addressed | §4.1.2.1: adding an authenticator SHALL notify via a mechanism independent of the transaction; §4.2: a recovery event always notifies |
| FIDO Alliance ([Recommended Account Recovery Practices](https://fidoalliance.org/wp-content/uploads/2019/02/FIDO_Account_Recovery_Best_Practices-1.pdf)) | Revoke a lost authenticator "in response to users' requests after confirming this request is true"; keep several authenticators so recovery is rare | same | — | — |
| OWASP ([Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)) | Silent on other authenticators | — | "invalidate all of their existing sessions, or … automatically" | Email the user that the password was reset |

**Reading.** Of the seven services with a stated or observable behaviour,
**none** removes passkeys on a reset or a change; the standards require a
notification (NIST SHALL on binding, recovery always notifies) and targeted
removal of a compromised authenticator, never a blanket one. Sessions are
ended on a reset/change by Google (automatic), Apple and Okta (offered), and
OWASP (automatic or ask) — the founder already ruled that part (item 17,
ADR 0225, PR #477).

**Built (PR #479):**

1. **A reset and a change keep every passkey.** `AuthService.resetPassword`
   no longer calls `retireEveryPasskey`; `passkeys/retire-passkeys.ts` is
   deleted (it never reached `main`). No row is written to `user_passkeys`
   by either path.
2. **Both tell the account, and the mail is the "review your passkeys"
   prompt.** `AuthService.mailPasswordChangedNotice(userId, "reset" |
   "change")` — called after the reset link is consumed, and after a change's
   write — mails "Your Mudavym password was reset/changed"
   (`communications/email-templates/password-changed.template.ts`) to the
   address read from `users` (never the request), listing every passkey that
   **still** signs the account in (name escaped, kind, the day it was added;
   removed ones and other people's never listed). When the passkeys cannot be
   read the mail says so instead of "no passkeys" (absence is not reported as
   health). No secret, no link (the rule the other account mails follow).
   Never throws: the password is already written, so a failed mail is logged
   and the reset/change still reports done.
3. **A passkey is the person's.** `PasskeysService.eligibility` no longer
   reads a house or a role (`OrganizationsService` is no longer injected);
   anyone with a session — with or without a house — may enrol, check, list
   and revoke. The ten-minute rule / emailed code (item 29) and the enrolment
   mail are what guard enrolment. With no house, the audit row is filed with
   `restaurant_id` null and **no in-app notice** is filed
   (`notifications.restaurant_id` is NOT NULL in the baseline schema), so the
   receipt says `notified: false`; the enrolment mail still goes.

**Adversarial pass on "keep" (the threat round 6 answered).** Someone with a
stolen password signs in and, within ten minutes, adds a passkey; the owner
resets. Under "keep", that passkey still signs the intruder in. What stands
against it: (a) the moment it is added, the account's mailbox gets "A passkey
was added" (NIST §4.1.2.1's independent channel), naming it; (b) the reset/
change mail lists it by name and date as a passkey that still signs in; (c)
the owner removes it on `/profile` (reachable by emailed code if the password
is gone); (d) #477 ends the intruder's sessions, so only the passkey remains.
Residual risk: an owner who ignores both mails keeps the intruder's passkey —
the same residual Google, GitHub and Microsoft accept. Why not revoke on a
reset anyway: a reset proves the mailbox, not which authenticator was
compromised; most resets are a forgotten password, and wiping the person's
passkeys then pushes them back onto the weaker door; and here mailbox control
already signs a person in by emailed code, so blanket revocation adds nothing
against a mailbox attacker. **Rejected:** round 6's reset-retires (no
surveyed service does it; superseded by his round-7 words); retiring on a
change only or on a reset only (same evidence); an optional "also remove my
passkeys" checkbox on the reset page (Okta-style; not asked — reported as a
candidate); a "review your passkeys" banner on `/profile` after a change
(needs a password-changed-at column; the mail carries the prompt now —
reported as a gap).


### Fork 6 (the founder, 2026-09-27, item 67): drop the unproven password, and what industry leaders do

**[2026-09-27, the founder, item 67.]** Verbatim: *"option 1 + do what
industry do for these, for security ops do what the industry leaders do"*;
label chosen: *"Drop pwd + (b) interim (Recommended)"*. Recorded in memory
`founder-answers-2026-09-25-web-rebuild.md` item 67. Option 1 is fork 6's
path (a); the interim (b) is moot because #477 (ADR 0225, `sv`) merged to
`main` (`f84db4147`) before this was built.

**Research (one agent's pass, 2026-09-27; sources below).** The attack is the
Unexpired Session class of Sudhodanan & Paverd, *"Pre-hijacked Accounts"*
(USENIX Security 2022, §4.2), with this codebase's emailed code as the
victim's recovery action. The paper's root cause (§6.2.1) is a service that
lets an account be used before its identifier is verified; its defence in
depth (§6.2.2) is: on a reset, sign out every other session, cancel pending
email changes and review linked identities; on a merge, make the user prove
control of both; keep email-change capabilities short-lived and capped; prune
unverified accounts; notify on security changes. The five classes against
this codebase's routes:

| Class | Here | Held by |
|---|---|---|
| Classic-Federated Merge | not open: OAuth sign-in never resolves an account by address alone | `findOrCreateOAuthUser` requires a subject-bound link (`oauthAccountIsLinked`, ADR 0024; `oauth-provider-binding.spec.ts`) |
| Unexpired Session | **was open through the code** (fork 6); through a reset, closed by #477 | **built here**, below |
| Trojan Identifier | not open: a second sign-in method cannot be attached before the address is proved | OAuth linking and passkey enrolment need a verified session; only six `AuthController` routes are `@AllowUnverified` (CLAIMS `ADR-0229-FORK-6-UNVERIFIED-REACHES-ONLY-THE-ESCAPE-HATCHES`) **[2026-09-28, fork 12: seven — `POST /auth/verify-email` left `@Public` for `JwtAuthGuard` + `@AllowUnverified`; it attaches no sign-in method]** |
| Unexpired Email Change | not applicable: there is no email-change flow (`updateProfile` writes name and phone only) | — |
| Non-verifying IdP | Google refuses an unverified `email_verified`; Microsoft needs a subject link. **The invitation door is a non-verifying source** | **fork 7, open** |

What the providers do when a mailbox is first proved on an account that
already holds an unproven credential: **Firebase** — "any previous unverified
mechanism of sign-in will be removed from the user and any existing sessions
will be invalidated … the user's password will be removed" (email-link
sign-in docs); **Supabase Auth** — "will remove any other unconfirmed
identities linked to an existing user" when a verified identity links
(identity-linking docs); **Clerk** — "will prompt the user to change their
password before linking" because it "cannot confirm the original ownership of
the account" (account-linking docs); **Auth0** — does not auto-link on an
unverified address, and a completed password reset sets `email_verified` true
(support article "Resetting Password sets Email Verified to True");
**Okta** — with verification Required, a self-registered user cannot sign in
until the activation email is followed; **Google** — a Google Account on a
non-Google address is not created until a code sent to it is entered.
**OWASP ASVS 5.0**: 6.3.7 (L3) "users are notified after updates to
authentication details"; 7.4.3 (L2) terminate other sessions "after a
successful change or removal of any authentication factor". **OWASP
Forgot-Password cheat sheet**: invalidate existing sessions and "send the user
an email informing them that their password has been reset". Consensus: the
first proof of the mailbox removes what was set up before it and ends every
earlier session, and the owner is told.

**Adopted and built** (`apps/api-gateway/src/auth/auth.service.ts`):

1. **The first emailed code removes the unproven password and ends every
   earlier session.** `verifyEmailProvedByCode` now writes, in ONE
   compare-and-set (`user_id`, the same address, `email_verified = false`, the
   `session_version` read just before): `email_verified = true`,
   `password_hash = null`, `session_version + 1`. Every access and refresh
   token minted before the proof is refused with `SESSION_ENDED` (ADR 0225's
   readers), `endStaleSessions` closes the old sockets, and the code's session
   is minted from the returned row so it alone survives. An account with no
   password is verified and its earlier sessions end the same way (Firebase:
   "any existing sessions will be invalidated"). A miss re-reads and retries
   (three tries); an already-verified or moved row is left untouched; a failed
   write mints an unverified session and removes nothing — fails closed.
2. **The address is told** (ASVS 6.3.7): `unprovenPasswordRemovedEmailTemplate`
   — no link, no secret, and no greeting by name, because the account's name
   was typed by the same unproven registrant. A failed send never fails the
   sign-in.
3. **A reset link verifies the address it was mailed to** (Auth0's behaviour):
   `resetPassword` reads `password_resets.email` and `setPasswordEndingSessions`
   adds `email_verified = true` (compare-and-set on that address) when it is
   still the account's. Without this, an owner who recovered by reset would
   lose their own, mailbox-proven password to the next emailed code — the
   founder's words are "a password it never proved", and a reset proves it.
4. **An unverified session reaches only the escape hatches** — already true
   (six routes); pinned now as a CLAIMS row so a future `@AllowUnverified` on
   linking or enrolment fails CI (the Trojan Identifier defence).

**Considered, not adopted:** ending the registrant's sessions when the
emailed *link* verifies (the link is how the registrant proves the address;
Firebase and Auth0 keep the password there too — the residual, a victim
clicking a link for an account they did not create, is what pruning, fork 8,
narrows **[Corrected 2026-09-27, ADR 0090 audit of PR #479 at `09b712d29`:
"narrows" overstated it. Fork 8 bounds only WHEN such a click can land: the
stranger can ask for a link only while they hold a session (`POST
/auth/resend-verification` is `@AllowUnverified`, so it needs one), fork 10
ends that session at the lapse, and a link lives 24 h (`email_verifications.expires_at`,
`20260805000000_baseline_from_production.sql:2738`), so the last link expires
at most 7 d + 15 min + 24 h after registration. At `09b712d29` a click inside
that bound verified the account, and `holdsUnprovenPassword` and
`unprovenPasswordHasLapsed` key on `email_verified` alone, so the stranger's
password and every refresh token fork 10 had refused came back, permanently
and with no notice. A click after the lapse now removes the password and ends
every session (§ Forks 8 and 10 after a link); a click inside the seven days
still keeps both, which is fork 12, open]** **[Corrected again 2026-09-28,
PR #479, building fork 12: the bracket above still read as if fork 8 did
some narrowing. It did not. Fork 8 contributes only the seven days of that
bound; a click INSIDE them verified the stranger's password and made their
sessions verified in full, so the residual was time-limited, never narrowed
in effect, and nothing before fork 12 closed it. It is closed now, not
narrowed: the founder's item 81, "Link needs sign-in (Recommended)", makes the
link verify only for a session of its own account (`verifyEmail`: 401
`SIGN_IN_TO_VERIFY` signed out, 403 `LINK_FOR_ANOTHER_ACCOUNT` for another
account), so an owner holding only the mailbox is sent to the emailed code and
fork 6 removes the stranger's password and sessions. What the founder adopted
is neither of the options this paragraph weighed (ending sessions at the
link, as Firebase and Auth0 do not; pruning): it is § Open forks 12 path (b).
§ Forks 11, 12 and 13]**); a "this wasn't me" link in the verification mail (Instagram does it;
the paper calls it "some services", not consensus; it would be a new flow);
a cap on verification-link resends (the paper states it for email-change
capabilities, which this codebase has no flow for; the resend has a 60 s
cooldown and the victim's code door now closes the account — a candidate if
fork 8 is declined). **Tension recorded, not reopened:** ASVS 5.0 6.3.6 (L3
only) says email should not be an authentication factor; the emailed code is
a locked decision of this ADR (item 29) and ASVS L3 is not this product's
target — named so a future level change sees it.

**Tests** — `apps/api-gateway/src/passkeys/pre-hijack.spec.ts`: the whole
attack end to end (public registration → the stranger signs in → the owner
asks for a code, types it from the real mail through the real
`SignInController` route → the stranger's password, both access tokens (real
`JwtStrategy`) and both refresh tokens are refused, the sockets are closed,
the owner's session is verified); the notice (address, content, no secret or
link); a failed notice; a second code; an already-verified account untouched;
a passwordless unverified account; passkey and moved-address sign-ins untouched;
a reset that verifies, then a code that keeps the owner's password; a reset to
a left address; four races (a link verification first, a reset first, a
version move, an address change) and a failed write. **Mutation check**: 11
source mutants (password kept, no version bump, no notice, each of the three
compare-and-set conditions dropped, no socket close, no retry, reset does not
verify, reset's address CAS dropped, reset's address match forced) — 11 red,
source restored byte-identical.

**Sources.** Sudhodanan & Paverd, "Pre-hijacked accounts: An Empirical Study
of Security Failures in User Account Creation on the Web", USENIX Security
2022 (usenix.org/system/files/sec22-sudhodanan.pdf), §4, §6.2; Firebase,
"Authenticate with Firebase Using Email Link in JavaScript"
(firebase.google.com/docs/auth/web/email-link-auth); Supabase, "Identity
Linking" (supabase.com/docs/guides/auth/auth-identity-linking); Clerk, "Account
linking for OAuth" (clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking);
Auth0 support, "Reseting Password sets Email Verified to True"
(support.auth0.com); Okta, "Plan self-service registration flows"
(developer.okta.com/docs/concepts/self-service-registration/); Google Account
Help 63950, "Verify your Google Account"; OWASP ASVS 5.0 V6 and V7
(github.com/OWASP/ASVS, 5.0/en/0x15-V6, 0x16-V7); OWASP Forgot Password and
Authentication cheat sheets. No independent Workflow fan-out ran (a builder
subagent has no Workflow tool); the adversarial pass was the mutation run
and the per-class table above, which is how forks 7 and 8 were found.


### Forks 7 and 8 (the founder, 2026-09-27, items 72 and 73): an invite verifies only its address, and an unproven password lapses

**[2026-09-27, the founder, item 72.]** Verbatim label: *"Bind invite to
address (Recommended)"* — an invite verifies only when the address matches the
one it was sent to; otherwise unverified until proven once via /verify-email.
**[2026-09-27, the founder, item 73.]** Verbatim label: *"Expire the password,
7 days (Recommended)"* — keep the row; after 7 days unverified the unproven
password cannot sign in (code sign-in still works, fork 6 handles it); no
`users` rows deleted. Both recorded in memory
`founder-answers-2026-09-25-web-rebuild.md` items 72-73.

**Built** (`apps/api-gateway/src/auth/unproven-address.ts`, `auth.service.ts`,
migration `20261125100200_an_invite_remembers_the_address_it_was_made_for.sql`):

1. **An invite remembers its address.** `organization_invites.target_email`
   (new, nullable); `generateInvite` writes `normalizeEmail(targetEmail)`
   (trimmed, lower-cased) or NULL. Invites minted before this carry NULL.
2. **A join verifies only on a match.** `joinViaInvite` normalises the typed
   address once and uses that spelling for every read and write (the spelling
   `registerAccount` stores and the emailed code looks up — production had 0
   mixed-case addresses of 8 on 2026-09-27, read-only). A new account's
   `email_verified` is `inviteVerifiesAddress(invite.target_email, email)`:
   true only for a non-empty invite address equal to the typed one. Otherwise
   the account is unverified and the verification link is mailed to the typed
   address (`queueEmailVerification`, as `registerAccount` does); the person
   passes /verify-email once, and an unproven password there meets fork 6 on
   the owner's first emailed code. The existing-account branch still costs the
   account's own password.
3. **An unproven password lapses after seven days.** `unprovenPasswordHasLapsed`:
   not `email_verified`, and `users.created_at` more than 7 days ago
   (exclusive) — or unreadable, which fails closed. `validateUser` runs the
   bcrypt compare first and then refuses with the wrong-password
   `UnauthorizedException("Invalid credentials")`, so the status, the body and
   the work done match a wrong password and an unknown address (no
   enumeration). `joinViaInvite`'s existing-account password check applies the
   same rule (another password door). The row, its password hash and its
   sessions are untouched; the emailed code still signs in and fork 6 then
   removes the password; a reset link also still works and verifies.

**Tests** — `apps/api-gateway/src/auth/unproven-address.spec.ts`, 15 cases,
through the real `generateInvite`, `joinViaInvite`, `registerAccount`, `login`,
`refreshAccessToken`, `SignInCodesService`, `SignInController` and
`JwtStrategy` over the passkey harness's `FakeDb` (given `upsert` and `ilike`;
invite reads projected to their select list, as PostgREST returns them):
the address stored normalised; a matching join verified with no mail; no
address and a different address both unverified with the link mailed to the
typed address; a pre-migration invite verifies nobody; **the fork 7 attack end
to end** (an address-less invite, the victim's address, the attacker's
password → unverified; the victim's code removes the password and ends both
of the attacker's tokens); inside the window the password works; past it the
right password's refusal equals a wrong password's and an unknown address's,
and the row is kept; a verified account never lapses; **the fork 8 attack end
to end** (a 60-day-old pre-registration: password dead, the owner's code signs
in, verifies and removes it); the invite door honours the lapse and, inside
the window, still admits; the helpers' edges. `join-via-invite.spec.ts`'s
legitimate-owner fixture now says the owner is verified. **Mutation check**: 15
source mutants (7 of fork 8: login ignores the lapse, a distinct lapse
message, the join door ignores it, `>=` at the boundary, missing `created_at`
fails open, verified accounts lapse, an 8-day window; 8 of fork 7: always
verified, un-normalised match, an empty address matching, the address not
written, no verification mail, the raw email stored, the email not normalised,
`target_email` not selected) — 15 red, sources restored byte-identical. The
last one was green until the harness projected invite reads to their select
list. CLAIMS rows `ADR-0229-FORK-7-AN-INVITE-VERIFIES-ONLY-ITS-ADDRESS` and
`ADR-0229-FORK-8-AN-UNPROVEN-PASSWORD-LAPSES-AFTER-SEVEN-DAYS` (7 mutants red,
a comment-only control green) and the open
`ADR-0229-FORK-10-A-LAPSED-ACCOUNT-STILL-REFRESHES`.

**Found while building, open:** fork 9 (the bound address is the minter's
word: the invite is never mailed) and fork 10 (a refresh outlives the lapsed
password). **[Both answered 2026-09-27, items 77 and 78, and built: § Forks 9
and 10.]** No independent Workflow fan-out ran (a builder subagent has no
Workflow tool); the adversarial pass was the mutation run and walking each
attack's sequence against the code, which is how forks 9 and 10 were found.


### Forks 9 and 10 (the founder, 2026-09-27, items 77 and 78): only a join from the mail verifies, and a refresh ends with the password

**[2026-09-27, the founder, item 77.]** Verbatim label: *"Email invite + (c)
interim (Recommended)"* — the gateway itself emails the invite to
`target_email` with a second secret that exists only in that email; a join is
verified only when it carries that secret and the address matches; the
minter's copied link still works but joins unverified; until then no invite
join verifies. **[2026-09-27, the founder, item 78.]** Verbatim label:
*"Refresh refuses lapsed (Recommended)"* — `refreshAccessToken` refuses an
account whose unproven password has lapsed (`unprovenPasswordHasLapsed`). Both
recorded in memory `founder-answers-2026-09-25-web-rebuild.md` items 77-78.

**Built** (`apps/api-gateway/src/auth/unproven-address.ts`, `auth.service.ts`,
`communications/email-templates/team-invite.template.ts`,
`dto/join-via-invite.dto.ts`; web `lib/inviteMailSecret.ts`, `InviteLanding`,
`Register`, `InviteTeamDialog`; migration
`20261125100300_an_invite_is_mailed_with_a_secret_only_the_mail_carries.sql`):

1. **The invite is mailed with a secret only the mail carries (fork 9).**
   `generateInvite`, when the invite names an address, makes a 256-bit random
   secret (`newInviteEmailSecret`, base64url), stores only its SHA-256 hex
   (`organization_invites.email_secret_hash`, checked to that shape) with
   `emailed_at`, and mails the address `/invite/<code>#k=<secret>`
   (`teamInviteEmailTemplate`). The secret rides the URL fragment, which the
   browser never sends to a server (and `scrubUrl` cuts at `#` before Sentry).
   The mail carries only the link, the role in fixed words and the expiry:
   no house name, no inviter name, no address — those are typed by whoever
   opens a house, and the mail can reach an address that never asked for it.
   The response's `inviteUrl` carries no secret and reports
   `invitationEmail`: `sent`, `not_sent`, `rate_limited` or `no_address`, which
   the invite dialog says in one sentence.
2. **Only a join from the mail verifies (fork 9; the "(c) interim" is
   inherent).** `inviteVerifiesAddress` now needs all three: the invite named
   an address, the typed address equals it (normalised), and the join's
   `emailSecret` hashes, compared in constant time, to the stored hash. A
   copied link (no secret), a wrong secret, another invite's secret, a
   different address, or an invite with no stored hash (never mailed, refused
   by the allowance, or minted before this) all join unverified, and the
   verification link is mailed to the typed address as before. The web
   carries the fragment from `/invite/<code>` to `/register` and sends it as
   `emailSecret`. The existing-account branch is unchanged: it still costs
   that account's own password and verifies nothing.
3. **Invite mails are rate-limited per house (fork 9).** At most
   `INVITE_EMAILS_PER_HOUSE` = 20 in any `INVITE_EMAIL_WINDOW_MS` = 24 hours.
   The number is the builder's (item 77 says "per house", not how many); a
   restaurant onboarding a whole team in a day stays under it. The invite's
   own `emailed_at` is written with the row and the count is read after it,
   so parallel mints over the limit see each other and none squeezes past
   (the conservative direction: two at the edge may both be refused). A
   count that cannot be read, or a house over the limit, sends nothing,
   releases the claim and clears the hash, so that invite can never verify.
   A send that fails keeps its claim (a mailer that is down does not refill
   the allowance). Over the limit the invite is still made and its copied
   link still joins, unverified.
4. **A refresh ends with the password (fork 10).** `refreshAccessToken`,
   after the session-version check and before any token is signed, throws 401
   `SESSION_ENDED` ("This session was signed out because its password was
   never confirmed. Sign in with a code emailed to you.") when
   `holdsUnprovenPassword` (not `email_verified`, and a non-empty
   `password_hash`) and fork 8's `unprovenPasswordHasLapsed` both hold. An
   account with no password has no unproven password to lapse. A dev-bypass
   session is exempt only where `devBypassEnvEnabled()` holds (never in
   production): the bypass account's row is unverified by design
   (`devBypassLogin`) and its session is not the password's, so without the
   exemption the local bypass would end at its first refresh.

**Tests** — `unproven-address.spec.ts`, now 36 cases (the fork 7 case that
joined verified by address alone now joins from the mail): the mail goes once
to the address with a 43-character secret stored only as its hash and absent
from the response and every table; the mail carries no word anyone typed (a
house named `Evil <b>House</b> Pay Here`, an inviter `Mallory Phisher`, the
address); no address, no mail; the copied link joins unverified; another
address, a wrong secret or another invite's secret all join unverified; an
invite with no stored hash verifies nobody; **the fork 9 attack end to end**
(a minter types the victim's address, joins with it from the copied link and
their own password → unverified; the victim's code removes that password and
ends the attacker's refresh token); the addressed person joining from the
mail is verified with their own password; 20 mails then `rate_limited`, the
21st invite's hash cleared and its link joining unverified, another house
unaffected, no-address invites not refused; mails past the window do not
count; 30 parallel mints send at most 20; an unreadable count fails closed; a
failed send keeps its claim; the template's role words; **the fork 10 attack
end to end** (a pre-registrant signed in on day one refreshes on day six; on
day eight both refresh tokens are refused while the owner's emailed code
signs in and refreshes); inside the window it refreshes; a verified account
and a passwordless one are not refused; dev bypass only where it is on. Web:
`inviteMailSecret.test.ts` (4), `publicPages.recovery.test.tsx` (the fragment
reaches the register link, and only when the link had one),
`authPages.publicDesign.test.tsx` (a join from the mail sends the secret, a
copied link sends none), `InviteTeamDialog.test.tsx` (the mail outcome on
both branches). **Mutation check**: 21 gateway source mutants, 21 red (5 of
fork 10: the lapse ignored, the dev-bypass exemption dropped, the exemption
ignoring the environment, passwordless accounts refused, verified accounts
treated as unproven; 16 of fork 9: the secret ignored, compared raw, not
stored, missing from the mail, leaked in the response, `>=` at the limit, the
limit not per house, the window ignored, the release keeping the hash, a
failed count failing open, the hash not selected, the secret not passed, no
mail sent, the address in the subject, a raw role printed, an empty hash
accepted); 4 web mutants, 4 red (the secret's shape unchecked, the landing
dropping it, the register not sending it, the dialog hiding the outcome); the
legacy (house-design-off) branch of `InviteLanding` is not driven by a test.
Sources restored byte-identical. CLAIMS: new
`ADR-0229-FORK-9-ONLY-A-JOIN-FROM-THE-MAIL-VERIFIES`;
`ADR-0229-FORK-10-A-LAPSED-ACCOUNT-STILL-REFRESHES` flipped to resolved with a
verify that pins the refusal; `ADR-0229-FORK-7-...` and
`ADR-0164-SESSIONS-FOLLOW-MEMBERSHIP` re-pinned to the changed code; 10 claim
mutants red, a comment-only control green on all four rows.

**Found while building, open:** fork 11 (the limit is per house, as item 77
says, and anyone can open a house). **[Resolved 2026-09-28, item 83, "Per
address + per sender"; § Forks 11, 12 and 13]** No independent Workflow fan-out ran (a
builder subagent has no Workflow tool); the adversarial pass was the mutation
run and walking each attack against the code.

### Forks 8 and 10 after a link (ADR 0090 audit of PR #479 at `09b712d29`): a link cannot bring a lapsed password back

**What was wrong.** `verifyEmail` (the `/verify-email` link) wrote
`email_verified = true` and nothing else. Both gates of forks 8 and 10
(`unproven-address.ts`, `holdsUnprovenPassword`, `unprovenPasswordHasLapsed`)
return "not unproven" for a verified row, so a link clicked after the lapse
un-lapsed the stranger's password and un-refused every refresh token fork 10
had refused (a refresh token lives 7 days). The audit's walk: the stranger
registers the victim's address, keeps a session to day 7 and asks for a
fresh link; the owner clicks it on day 7.5.

**Built (not a new decision).** Item 73's words are "after 7 days unverified
the unproven password cannot sign in (code sign-in still works, fork 6
handles it)", and item 78's refusal exists so "the session ends with the
password". A link proves the mailbox, not who chose the password, so
`AuthService.verifyEmailProvedByLink` now does what fork 6 does for a code
when, on the row it just read, the password is unproven and lapsed: ONE
compare-and-set (`email_verified = false` and the session version read) sets
the account verified, `password_hash` null and `session_version + 1`, closes
the stale sockets and mails the notice (`unprovenPasswordRemovedEmailTemplate`,
`by: "link"`). A miss re-reads (three tries); a failed write is a 503 and the
link is not spent. Inside the seven days the link keeps the password and every
session, as before. This is narrower than fork 10's rejected (c) (every link
click ends every session); it only makes items 73 and 78 hold after a click.

**The rest of the surface, walked at this head.** Every write that verifies
an address: the code (`verifyEmailProvedByCode`, fork 6: drops the password,
bumps `sv`), a reset link (`setPasswordEndingSessions`: new password, bumps
`sv`), a new invite account (`joinViaInvite` insert, fork 9: verified only
with the mailed secret), and now the link. Google and Microsoft sign-in never
attach to an account by address (`findOrCreateOAuthUser` accepts only an
account already linked to that provider, `oauthAccountIsLinked`; linking is
not an `@AllowUnverified` route), and the existing-account
invite branch verifies nothing and honours the lapse. So after the lapse no
door verifies without ending the sessions and the password. The six
`@AllowUnverified` routes are unchanged (CLAIMS
`ADR-0229-FORK-6-UNVERIFIED-REACHES-ONLY-THE-ESCAPE-HATCHES`). `resendVerification`
has no lapse check; it needs a session, which fork 10 ends at the lapse, and a
late click now removes the password, so no cap was added. **[2026-09-28, fork
12 (item 81, whose build order includes "resendVerification must honour the
fork 8 lapse"): it now has one -- a lapsed unproven password's session is
refused a resend with the refresh's own `SESSION_ENDED` refusal; and the
`@AllowUnverified` routes are seven, `POST /auth/verify-email` being the
seventh. § Forks 11, 12 and 13]**

**Tests** -- `unproven-address.spec.ts`, block "forks 8 and 10 hold after a
verification link" (6 cases: the attack end to end through the real
`verifyEmail`, `refreshAccessToken`, `login` and `JwtStrategy`; inside the
seven days the link keeps both; a passwordless account; an account a code
verified first; a failed write; a row moving between read and write), and the
mock-level `verify-email-and-invite-read-errors.spec.ts` live-link case (read
first, then the compare-and-set). **Mutation check**: 14 source mutants, 14
red (the lapse ignored, the password kept, the version not moved, a
passwordless account counted, sockets not closed, no notice, the notice
worded for a code, the template ignoring `by`, a failed write verifying
anyway, a miss not re-read, a verified row rewritten, either compare-and-set
filter dropped -- those two are killed by the mock case pinning the filter,
since the behavioural race moves both -- and the link spent before the
write). CLAIMS `ADR-0229-FORK-8-A-LINK-CANNOT-REVIVE-A-LAPSED-PASSWORD`.

**Found, open:** forks 12 and 13 (§ Open forks). **[Resolved 2026-09-28,
items 81 and 82; § Forks 11, 12 and 13]** No independent Workflow
fan-out ran (a builder subagent has no Workflow tool); the adversarial pass
was the audit's own walk plus the mutation run.

### Forks 11, 12 and 13 (the founder, 2026-09-28, round 15, items 81, 82 and 83)

Answered together: item 81, fork 12, "Link needs sign-in (Recommended)"; item
82, fork 13, "Hold until accepted (Recommended)"; item 83, fork 11, "Per
address + per sender". Built on PR #479 after merging `origin/main`
(`20838c551`). One additive migration,
`an_unproven_join_waits_and_invite_mail_is_capped_per_address_and_sender`
(cited by slug: its version is assigned at merge, founder item 79).

**Fork 12 -- the link needs a session of its own account.**
`POST /auth/verify-email` was `@Public` ("the one-time token in the body is the
credential", ADR 0096). It now runs under `JwtAuthGuard` with
`@AllowUnverified` (it is how an unverified session verifies) and
`@AllowsNoHouse` (a held joiner's session names no house, fork 13), and hands
the session's user and house to `AuthService.verifyEmail`:

- no session: 401 `SIGN_IN_TO_VERIFY`, before any read (the guard answers 401
  first in production; the service refuses again for any other caller);
- a session of another account: 403 `LINK_FOR_ANOTHER_ACCOUNT`, before the
  link's state (used, expired) is said and before anything is written;
- neither spends the link.

So the link verifies only for someone holding the account's password (its
session) and its mailbox. The owner of an address a stranger registered holds
only the mailbox: the web page (`VerifyEmail`) shows "Sign in to verify" with
the link as `redirect`, and names the sign-in page's "Email me a sign-in
code"; the code verifies the address and fork 6 removes the stranger's
password and ends their sessions. A real registrant clicking on the device
they registered on is signed in, and nothing changes for them; on another
device they sign in first (the cost § Open forks 12 named). The mobile screen
says the same in words (no screen test covers it). The verification mail now
says to open it where you are signed in, or to use an emailed code if you did
not choose the password. The new pair names the session's house, else the
`users` row's, through `generateTokens`' membership check as before. The
after-the-lapse removal (§ Forks 8 and 10 after a link) stays: after fork 12
it is reached only by an access token minted in the last minutes before the
lapse, and it still removes that password.

`resendVerification` now reads the account first and refuses a lapsed
unproven password with the refresh's own refusal (`SESSION_ENDED`, "This
session was signed out because its password was never confirmed. Sign in
with a code emailed to you."), exempting a dev-bypass session exactly where a
refresh does; a row that cannot be read is a 503, never a mail.

**Fork 13 -- an unproven join is held.** `joinViaInvite` decides
`membershipIsHeld` from whether the joining account's address is proved at
the join: a new account only by the mailed secret (fork 9), an existing
account only by `email_verified`. A held join writes its
`user_restaurant_access` row `is_active = false` with `held_since` (the new
column; the check `user_restaurant_access_held_is_never_active` keeps a row
from being both), leaves a new account's `users.restaurant_id` NULL (so the
legacy users-row fallbacks in `assertMembership`, `assertAccess`,
`resolveRestaurantRole` and `generateInvite` admit nothing), writes no
`organization_members` row and no team claim, and mints a pair naming no
house (`membershipHeld: true`). Every gateway read that admits someone to a
house filters `is_active` (walked: the four reads that do not are "is there
already a row?" checks, which should see a held row); the orchestrator's
notification recipients (`core/notifications.py`) did not, and now do, so a
held or former member is not sent a house's notifications. The baseline's
older client RLS policies join `auth.uid()` without `is_active`, but
`auth.uid()` is an `auth.users` id, disjoint from `public.users`. Inserting
an inactive row fires neither membership-ended trigger, so a held row never
reads as a removal. No row is deleted, ever.

`GET /auth/houses` answers `held` (`AuthService.heldMemberships`: inactive
and `held_since` set, with the house's name and city and the role in fixed
words). `POST /auth/held-memberships/accept` takes the held row's id -- not a
house id, so ADR 0019's single `@AllowsTenantChange` route stays single; it
acts on the person's own row the way `POST /auth/invite/:code/accept` acts on
an invite -- needs a verified account (the guard, and the row re-read),
re-checks the issuer's standing through the invite (ADR 0162's ceiling at
acceptance, as `acceptInviteAsExistingUser` does; an invite that can no longer
be read refuses), and activates in ONE compare-and-set on `is_active = false`
AND `held_since` set; then writes the organisation row (insert-only), the team
claim, and `users.restaurant_id` when it names none. A refusal leaves the row
held. The web chooser shows held rows under "Waiting for you" with "Join
<house>" and stays on the page while any are held, instead of sending a
person with no house to /get-started.

**Fork 11 -- invite mail per address and per sender.** `sendInviteEmail`
counts three allowances in one loop, each after the invite's own claim, house
first: the house (20 per 24 h, unchanged, `rate_limited`), the minting person
across their houses (`INVITE_EMAILS_PER_SENDER`, `rate_limited_sender`) and
the address across all houses (`INVITE_EMAILS_PER_ADDRESS` = 3, his number,
`rate_limited_address`). Past any, the invite is made, its claim released and
its hash cleared (it can never verify anyone, and a released claim counts
against none of the three), and the minter is told which (the web dialog's
sentence names it). Two partial indexes serve the new counts.

The per-person number, chosen as industry leaders choose it (item 67): the
two published caps of this shape are GitHub's, 50 organization invitations
per 24 hours for an organization under a month old or on the free plan (500
after; GitHub Docs, "Inviting users to join your organization"), and Google
Groups', 500 external invitations per user per day across all their groups
(Google Workspace Admin Help, "Understand groups policies and limits"). An
account opening houses to mail a victim is new by construction, so the
stricter, new-account figure is taken: **50 a day, changeable** -- it is a
constant, not a rule. A person running three houses can mail 50 of their 60
house allowances.

**Stated, not decided (no new fork):** telling the minter
`rate_limited_address` discloses that this address already received three
invite mails today; the minter typed the address, and the founder's answer
says the minter is told. A held house's name is shown in-app as its minter
typed it (text, never markup), as the chooser shows every house name; the
invite mail still carries none. There is no decline control: not accepting
leaves the row held and granting nothing. A person who already has an active
house is not sent to the chooser at sign-in, so they see a held membership
only by opening it (a sign-in nudge is not built). Existing memberships were
not re-examined: a row an unverified existing account joined before this
deploys stays active (not measured in production).

**Tests** -- `unproven-address.spec.ts` blocks "fork 12 (item 81)" (5 cases:
the attack end to end, the owner signed out then by code; the registrant
signed in keeps their password; another account refused; the resend lapse
with the dev-bypass exemption; an unreadable account), "fork 11 (item 83)"
(6: the address cap across four houses and people; the window and released
claims; the person cap across three houses while a house has room; the house
cap still first; unreadable address and person counts fail closed; the
minter told through the controller) and "fork 13 (item 82)" (10: the held
write; a held row grants nothing -- `memberHouses`, `switchRestaurant`,
`generateTokens`, `assertMembership`, `assertAccess`, `getUserRoleAtRestaurant`
-- even after the owner's code; the attack end to end on the chooser, with a
former membership never offered and another person's row not acceptable;
acceptance through the controller; an unproven account cannot accept; the
issuer re-check; a race answered in between; both compare-and-set filters
pinned; a mailed-secret join active at once; an existing unverified account
held, a verified one active); `verify-email-and-invite-read-errors.spec.ts`
(3 mock cases), `verify-email-dto.spec.ts`, `no-house-session.spec.ts`,
`join-via-invite.spec.ts`, `invite-issuer-must-still-stand.spec.ts`,
`sessions-follow-membership.spec.ts`, `resend-verification-lockout.spec.ts`
updated; web `ChooseHouse.test.tsx` (4), `publicPages.recovery.test.tsx` (2),
`inviteMailSecret.test.ts`; orchestrator `test_agent_notifications.py` (1).
PGlite full corpus 252/252 plus 13 checks on the migration (superuser,
platform stubbed). **Mutation check**: 27 gateway source mutants, 27 red
(three first survived -- the two compare-and-set filters and the held list's
database filter -- and were killed by a filter-pinning case and by removing a
redundant in-memory filter); 7 web mutants and 1 orchestrator mutant, all red;
sources restored from snapshots. CLAIMS
`ADR-0229-FORK-11-INVITE-MAIL-CAPPED-PER-ADDRESS-AND-SENDER`,
`ADR-0229-FORK-12-THE-LINK-NEEDS-A-SESSION-OF-ITS-ACCOUNT`,
`ADR-0229-FORK-13-AN-UNPROVEN-JOIN-IS-HELD` (12 claim mutants red, 3
comment-only controls green); eight existing rows re-pinned with dated
brackets. No independent Workflow fan-out ran (a builder subagent has no
Workflow tool); the adversarial pass was the mutation run and walking each
admission path for a held row.

## Decision

A passkey signs you in through a discoverable-credential ceremony whose user
handle must match the credential's owner; an emailed six-digit code signs you
in when this device has none; both mint only through
`AuthService.issueSessionForVerifiedSignIn`. Adding a passkey needs an
`auth_time` within ten minutes or an emailed code. Built in
`apps/api-gateway/src/passkeys/` (`sign-in.controller.ts`,
`sign-in-codes.service.ts`, `passkeys.service.ts`), migration
`20261125100100_passkey_sign_in_and_email_codes.sql` (`sign_in` challenge
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
   § Round 6, parts 1-2.] [SUPERSEDED the same day, round 7, item 44: (b)
   stands, (c) is withdrawn — industry keeps passkeys; the reset mail lists
   them instead. § Round 7.]** **A passkey outlives a password reset.** Someone who signs in with a
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

4. **[ANSWERED 2026-09-26, founder, round 7, item 44: "follow industry
   practice for both" → neither a change nor a reset retires passkeys; both
   mail the account the passkeys that still sign in. The recommendation (b)
   below is rejected by his answer and the evidence table. § Round 7.]**
   **Does a password CHANGE retire passkeys too?** His
   answer names the reset; a change is not built to retire anything. PR #477
   (ADR 0225) treats a change like a reset — both go through
   `setPasswordEndingSessions` and end every other session. Paths: (a) change
   leaves passkeys alone (as built; the person just typed their current
   password, and a passkey is theirs to remove on `/profile`); (b) a change
   retires every passkey too, like a reset. **Recommendation: (b)**, because
   #477 already treats a change like a reset and a person changing their
   password after a scare expects every other door closed; cost: the owner
   re-adds their own passkeys after every change. Not built until he answers.
5. **[ANSWERED 2026-09-26, founder, round 7, item 44: "passkey belongs to
   the person (industry) → allowed". Built: § Round 7, part 3.]** **A session
   with no house cannot enrol.** A
   passkey is per person, not per house, but eligibility still needs a role in
   the token's house, so an account on `/get-started` cannot add one. Not
   asked in round 6; left as built.

6. **[RESOLVED 2026-09-27, the founder, item 67, verbatim: "option 1 + do
   what industry do for these, for security ops do what the industry leaders
   do" (label "Drop pwd + (b) interim (Recommended)") → path (a), built with
   the industry-leader defences; (b) moot, #477 merged. § Fork 6. Rejected:
   (b) as the end state, (c).] [Found 2026-09-27 by the ADR 0090 audit of PR
   #479 (reports at `b88c27053` and `c1acfeabc`).]** **A code
   sign-in can verify an account someone else registered, and keep their
   password.** Round 6 part 4 (item 37, "emailed-code sign-in marks email
   verified") is built in `AuthService.verifyEmailProvedByCode`
   (`apps/api-gateway/src/auth/auth.service.ts:814-839`): it sets
   `email_verified = true` (`:826`) and leaves `password_hash` as it is. The
   sequence: someone registers the victim's address with a password of their
   own (`POST /auth/register/account`, `@Public()`, `auth.controller.ts:137-139`;
   `registerAccount` writes `email_verified: false`, `auth.service.ts:1160`);
   the victim, told the address is taken, uses "Email me a sign-in code";
   the code proves the victim's mailbox and flips the flag; the registrant's
   password now opens a verified session. Their already-issued tokens do too:
   `JwtStrategy.validate` reads `email_verified` from the row on every request
   (`strategies/jwt.strategy.ts:39,76`), a refresh token lives 7 days
   (`auth.service.ts:923`), and this branch has no per-person session cut-off
   (ADR 0225's `sv` is PR #477, still open). The emailed verification link
   (`auth.service.ts:2369`) has the same shape and predates this PR; the code
   path is the new and likelier door, because the victim starts it.
   Paths: (a) **drop the unproven password and end every other session when a
   code first verifies the address** — the shape of the mitigations in
   Sudhodanan & Paverd, "Pre-hijacked accounts" (USENIX Security 2022; not
   re-researched this round); needs #477's `sv` (or a new
   cut-off column) to end the registrant's sessions; cost: a person who
   registered with a password, never clicked the link, then used a code must
   set a password again on `/profile`; (b) **do not verify by code when the
   account holds a password it never proved** — narrows item 37; the person
   lands on `/verify-email` as before; no dependency on #477; (c) refuse a code
   sign-in into such an account and send the person to a password reset —
   narrows item 37 and adds a dead end for the legitimate registrant.
   **Recommendation: (a), landing after #477 so `sv` ends the sessions; (b)
   as the interim if #479 must merge first.** Not built: every path changes
   what item 37 does or who keeps a password, which is his call (CLAUDE.md
   §0.1).

7. **[RESOLVED 2026-09-27, the founder, item 72, verbatim label "Bind invite
   to address (Recommended)" → path (b) with (a) as its fallback: an invite
   verifies only when the joiner's address matches the one it was made for;
   otherwise the account is unverified until proven once via /verify-email.
   Rejected: (a) alone, (c). Built: § Forks 7 and 8. What it does not close
   is fork 9.] [Found 2026-09-27 by the fork 6 research (the Non-verifying IdP
   class).]** **An invitation code creates a
   VERIFIED account for any address typed with it.** `joinViaInvite`
   (`POST /auth/join`, `@Public`) inserts a new `users` row with
   `email_verified: true` for `dto.email` (`auth.service.ts`, the new-user
   branch); an invite code is not bound to an address (`generateInvite`
   stores `targetEmail` only on the roster row, and `joinViaInvite` never
   compares it). So anyone who can mint an invite — any owner or manager of any
   house, and anyone can open a house — can create a verified account for
   someone else's address with a password of their own. Fork 6's defence does
   not fire: the address is already "verified", so the owner's later emailed
   code keeps the stranger's password. Paths: (a) a new account made through
   an invite is unverified until its address is proved (link or code; the
   invited person then passes /verify-email once); (b) bind an invite to the
   address it was sent to and verify only on a match (an invite sent with no
   address stays (a)); (c) leave it (the invite holder is a named house
   member, so it is attributable). **Recommendation: (b) with (a) as its
   fallback** — it keeps the one-step join for the person the invite was
   addressed to, and it is what the paper asks of an identity source.
   Not built: it changes the invited person's join flow, beyond fork 6.
8. **[RESOLVED 2026-09-27, the founder, item 73, verbatim label "Expire the
   password, 7 days (Recommended)" → path (b), N = 7: keep the row; after 7
   days unverified the unproven password cannot sign in (code sign-in still
   works, fork 6 handles it); no `users` row is deleted. Rejected: (a), (c).
   Built: § Forks 7 and 8. What it does not close is fork 10.] [Found
   2026-09-27 by the fork 6 research.]** **Unverified registrations do not expire.** The paper's
   defence in depth (§6.2.2, "Unverified-Account Pruning") deletes accounts
   still unverified after a short window, so a pre-registration cannot wait
   months for its victim to click a verification link (the one door fork 6
   leaves: the link verifies the registrant's password, as it must for a real
   registrant). Paths: (a) delete unverified accounts older than N days (the
   paper; it deletes `users` rows, and the founder's ADR 0149 answer 2
   (2026-09-16) keeps "the current restaurants or users" out of every
   deletion, so it is his call); (b) keep the row but stop the
   unproven password signing in after N days (the owner then uses a code,
   which fork 6 already handles); (c) leave it. **Recommendation: (b) with N
   = 7** — it closes the window without deleting a user, and a real
   registrant loses nothing but the password they never confirmed. Not built.
9. **[RESOLVED 2026-09-27, the founder, item 77, verbatim label "Email
   invite + (c) interim (Recommended)" → path (b), with (c) inherent: every
   join that does not carry the mailed secret is unverified. Rejected: (a)
   as built. Built: § Forks 9 and 10. What it does not close is fork 11.]
   [Found 2026-09-27 building item 72.]** **The address an invite is bound to is typed by whoever mints
   it, and the gateway never mails the invite.** Item 72's words are "the
   address it was sent to", but nothing sends it: `generateInvite` returns the
   code and link to the minter (`InviteTeamDialog` copies it to the
   clipboard), and `targetEmail` is only what the minter typed. So a match
   proves the minter's word, not the joiner's mailbox. Fork 7's attacker IS a
   minter ("anyone can open a house"): they type the victim's address as the
   invite's address, join with it, and get a verified account with their own
   password; fork 6 then cannot fire. What item 72 as built does close: every
   invite made with no address, and a leaked or forwarded code used with any
   address other than the one the minter typed. Paths: (a) as built (the
   minter is a named house member and the address sits on their invite, so it
   is attributable); (b) the gateway mails the invite link to the address, and
   a join verifies only when it carries a second secret sent only in that mail
   (the minter's copied link still works but joins unverified); (c) no join
   verifies (fork 7's path (a)): the invited person passes /verify-email once.
   **Recommendation: (b)** — it is what "sent to" assumed and keeps the one-step
   join for the addressed person; **(c) as the interim** until (b) is built.
   Cost of (b): one more mail type and a second secret column on the invite.
10. **[RESOLVED 2026-09-27, the founder, item 78, verbatim label "Refresh
   refuses lapsed (Recommended)" → path (b): `refreshAccessToken` refuses an
   account whose unproven password has lapsed, reusing
   `unprovenPasswordHasLapsed`. Rejected: (a), (c). Built: § Forks 9 and 10;
   the CLAIMS row below is flipped to resolved.] [Found 2026-09-27 building
   item 73.]** **A session outlives its lapsed password.** Item 73 stops the
   unproven password signing in; a refresh is not a sign-in
   (`refreshAccessToken` reads no password and carries `auth_time`), and every
   refresh mints a new 7-day refresh token. So a registrant who signed in
   inside the seven days keeps an unverified session for as long as they keep
   refreshing. While unverified it reaches only the six escape hatches; if the
   real owner later follows a verification link, `JwtStrategy` reads the flag
   per request and that session is verified (the link residual fork 6 named).
   **[2026-09-27, ADR 0090 audit of PR #479 at `09b712d29`: path (b) as first
   built did not survive a later link click -- once the flag flipped, the
   refused tokens and the lapsed password were accepted again. Completed
   without reopening the rejected (c): only a link clicked AFTER the lapse
   ends every session and removes the password (§ Forks 8 and 10 after a
   link). The inside-the-seven-days half is fork 12.]**
   The owner's emailed code still ends it (fork 6). Paths: (a) as built; (b)
   `refreshAccessToken` refuses an account whose unproven password has lapsed
   (the same `unprovenPasswordHasLapsed`), so the session ends with the
   password and the person signs in by code; (c) (b) plus ending every session
   when the link verifies. **Recommendation: (b)** — it is what the paper's
   pruning achieves without deleting a row. Tracked by the open CLAIMS row
   `ADR-0229-FORK-10-A-LAPSED-ACCOUNT-STILL-REFRESHES`, which fails the build
   the day it is built so the fork is struck. Not built: item 73 names the
   password, not the session.
11. **[RESOLVED 2026-09-28, the founder, round 15, item 83, verbatim label
   "Per address + per sender" → path (c): (b) plus a cap per minting person;
   his number for the address (3 a day), the person's number chosen as
   industry leaders choose it (50 a day, § Forks 11, 12 and 13). Rejected:
   (a) as built; (b) alone, which was the recommendation. Built.]** **[OPEN —
   found 2026-09-27 building item 77; not yet put to the founder.]** **The invite-mail limit is per house, and anyone can open a
   house.** Item 77 says "rate-limit invite emails per house", built as 20 a
   day per house. One person who opens several houses can send one address
   20 invite mails a day per house. This is mail volume at a victim, not
   account access: no mail lets anyone but its reader join verified, and the
   mail carries no word the sender typed. Paths: (a) as built; (b) also cap
   invite mails per target address across all houses (for example 3 a day),
   past which the invite is made but not mailed, like the house limit; (c)
   (b) plus a cap per minting person. **Recommendation: (b)** — it bounds
   what one address can receive whoever sends, at the cost of one more count
   on the same index shape. Not built: a cap across houses is beyond "per
   house".

12. **[RESOLVED 2026-09-28, the founder, round 15, item 81, verbatim label
   "Link needs sign-in (Recommended)" → path (b); with it, `resendVerification`
   honours the fork 8 lapse. Rejected: (a), (c), (d). Built: § Forks 11, 12
   and 13.]** **[OPEN -- found 2026-09-27 by the ADR 0090 audit of PR #479 at
   `09b712d29`; not yet put to the founder.]** **A verification link clicked
   inside the seven days keeps a stranger's password and sessions.** Someone
   registers the owner's address with their own password
   (`POST /auth/register/account`, public); the owner, getting the mail,
   clicks its link before the lapse. The account is verified with the
   stranger's password, and the stranger's sessions become verified sessions
   (`JwtStrategy` reads the flag per request). Fork 6 and fork 8 do not fire:
   the address is now proved. The bound is the link's life: at most 7 d +
   15 min + 24 h after registration. Paths: (a) as built (Firebase and Auth0
   keep the password at a link, § Fork 6 "Considered, not adopted"); (b) the
   link verifies only for someone signed in to that account, so it needs
   both the password and the mailbox; someone with only the mailbox is sent to
   the emailed code, and fork 6 then removes the stranger's password and
   sessions; (c) every link click ends every other session (fork 10's (c),
   rejected 2026-09-27) -- closes the sessions, not the password; (d) a
   "this wasn't me" control in the verification mail (the paper: "some
   services"; a new flow). **Recommendation: (b)** -- the only path that
   closes the password half without taking a real registrant's password
   away. Cost: a registrant who opens the link signed out (another device)
   signs in first. Not re-researched this round; not built: it changes the
   link flow every registrant uses.
13. **[RESOLVED 2026-09-28, the founder, round 15, item 82, verbatim label
   "Hold until accepted (Recommended)" → path (b). Rejected: (a), (c). No row
   is deleted. Built: § Forks 11, 12 and 13.]** **[OPEN -- found 2026-09-27
   walking the invite join for the same audit; not yet put to the
   founder.]** **A join from a copied invite link plants
   a house membership on an address nobody has proved.** Since fork 9 such a
   join creates an unverified account, but `joinViaInvite` still inserts its
   `user_restaurant_access` row in the minter's house. When the address's
   owner later signs in by code, fork 6 removes the minter's password and
   sessions but keeps the membership, and `signIn` picks from
   `memberHouses`, so an owner with no other house lands in the minter's
   house. No account access for the minter; the owner arrives inside a house
   a stranger runs. Paths: (a) as built (a copied-link join is also how a
   real invitee joins, and they keep the house); (b) a membership granted
   before the address was proved waits until the person, once proven,
   accepts it; (c) fork 6 removes such memberships. **Recommendation: (b)**.
   Cost: one more step for a real invitee who joined from a copied link. Not
   built: it changes the invite join.

## Consequences

- Every session minted before this deploy has no `auth_time`, so the first
  passkey anyone adds after it needs an emailed code (or a new sign-in).
- One more mail type through `GmailService`; if mail is down, code sign-in
  and stale-session enrolment fail with a sentence, while password, Google
  and passkey sign-in do not depend on it.
- The per-source limit reads `x-forwarded-for`'s first entry like the
  gateway's other limiters; it slows a script, the per-address and per-code
  limits (in the database, multi-instance safe) are the ones that hold.
- ~~**[2026-09-26]** A reset now takes every passkey with it: someone who
  resets on purpose re-adds their own passkeys afterwards. `/profile` lists
  them as removed on the reset's date.~~ **[Withdrawn, round 7: a reset and a
  change keep every passkey and mail the list; nobody re-adds anything.]**
- **[2026-09-26, round 7]** One more account mail ("your password was
  reset/changed") on every reset and change. A person with no house gets no
  in-app notice for a passkey change (the table needs a house) — the mail is
  their record.
- **[2026-09-26]** One more account mail ("a passkey was added"), through the
  same `GmailService`; when mail is down the passkey is still added and
  `/profile` says the mail was not sent.
- **[2026-09-27, fork 6, item 67]** A person who registered with a
  password, never followed the verification link, then signed in by emailed
  code, has no password afterwards and is mailed why; they set one on
  /profile (a first password needs no current one) or by "Forgot password?".
  A reset of an unverified account now also verifies it, so that person no
  longer passes /verify-email after a reset. One more account mail type.
- **[2026-09-27, forks 7 and 8, items 72-73]** An invited person whose
  invite named no address, or another address, passes /verify-email once
  (as every registrant does). A password on an account unverified for more
  than seven days stops signing in, with the wrong-password answer: in
  production on 2026-09-27 (read-only) that is 2 of 8 accounts, both
  unverified with a password and older than seven days, the moment this
  deploys; they sign in by emailed code (which verifies and, fork 6, removes
  that password) or by "Forgot password?".
- **[2026-09-27, forks 9 and 10, items 77-78]** One more mail type through
  `GmailService` (the invite), sent while the minter waits; when mail is
  down the invite is still made and the dialog says it was not emailed. An
  invited person who joins from a copied link, not the mail, passes
  /verify-email once. A house may mail 20 invites a day. A registrant whose
  unproven password has lapsed is signed out at their next refresh (within
  15 minutes) and signs in by emailed code. Migration `20261125100300` adds
  two nullable columns and a partial index; the PR's three earlier
  migrations were renumbered past main's new ceiling (`20261116000220`):
  `20261102100000/100100/100200` → `20261125100000/100100/100200`.
- **[2026-09-27, forks 8 and 10 after a link, audit of `09b712d29`]** A
  registrant who clicks the verification link more than seven days after
  registering loses the password they never confirmed (it had already stopped
  signing in), every other session ends, and the address is mailed why; the
  link's own session is verified, and they set a password on /profile. Only
  a link asked for within the last 24 h can do this, and asking needs a
  session; for the 2 production accounts above none can be asked for (their
  password no longer signs in and fork 10 refuses their refresh), and a code
  sign-in verifies them first (fork 6).
- **[2026-09-28, forks 11-13, items 81-83]** A verification link opened
  signed out, or on a device signed in to another account, asks the person to
  sign in first (or to use an emailed code); every registrant who opens the
  mail on another device pays that step. An invited person who joins from a
  copied link, or with an account not yet verified, is in no house until they
  verify and choose "Join" on the chooser. One address receives at most 3
  invite mails a day and one person sends at most 50; past either the invite
  is made and not mailed. Migration
  `an_unproven_join_waits_and_invite_mail_is_capped_per_address_and_sender`:
  one nullable column, one check, two partial indexes.
- Revisit when: #471 or #477 merges (the merge notes above); F11 lands (a
  passkey at the point of action); conditional UI is wanted; ~~fork 4 is
  answered~~ **[answered, round 7]**; a surveyed provider starts revoking
  passkeys on recovery.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | lane W3-passkeys (agent) | Created, Proposed. Gateway: `passkeys.sign-in.spec.ts` 22, `sign-in-codes.service.spec.ts` 18, `auth-time.spec.ts` 7 (real `@simplewebauthn/server` against a software authenticator; real `JwtService`). 23 gateway mutants of the checks: 20 red, 3 green — each green one a check guarded twice (the revoked filter, the code's single use, the challenge's purpose binding); the compound mutants removing both guards of the first two, and both UV guards, went red (the purpose binding is backed by the table's `(purpose = 'sign_in') = (user_id is null)` check, so it is not reachable alone). Web: 5 mutants, 5 red. PGlite full-corpus probe of the migration 16/16. No independent adversarial fan-out ran (no Workflow tool in this lane); the forks above are this lane's own adversarial pass |
| 2026-09-26 | lane W4-passkeys (agent) | Founder round 6 item 37 recorded (forks 1-3 answered) and built: reset retires passkeys, enrolment mail, staff enrolment, code sign-in verifies email. New `founder-round-six.spec.ts` 12 cases (real `AuthService.resetPassword` + real passkey ceremonies: a retired passkey cannot sign in). 8 source mutants of the new checks, 8 red (one initially green — the session minted from the pre-write row — killed by moving that case onto the copy-returning fake). Two new CLAIMS rows, 7 mutants, 7 red. Fork 4 (password change) opened, not built. No independent adversarial fan-out ran |
| 2026-09-26 | lane W5-passkeys (agent) | Founder round 7 item 44: researched Google, Apple, Microsoft, GitHub, Okta, Auth0, 1Password, Dashlane (not found), NIST SP 800-63B-4, FIDO, OWASP (§ Round 7 table). Industry keeps passkeys on reset and change → round 6 part 1 un-built (`retire-passkeys.ts` deleted), password reset/change notice mail listing live passkeys added, houseless enrolment allowed (no house/role read). `founder-round-six.spec.ts` rewritten (round-7 cases: reset and change keep and still sign in; the mail lists only live own passkeys, escaped, no secret/link; unreadable ≠ none; a failed mail never fails the reset; houseless enrol end to end). 7 source mutants, 7 red (incl. re-adding a reset-time revoke). Gateway `src/auth src/passkeys src/communications/email-templates` 31 suites / 386 tests green; boot check PASS. Research was one agent's WebSearch/WebFetch pass plus its own adversarial paragraph — no independent Workflow fan-out ran; several "kept" rows rest on omission, marked so |
| 2026-09-27 | the founder (round 11, item 63) + PR #479 audit-fix round 2 (agent) | **Locked as built**, verbatim "Lock both as built (Recommended)"; Status line and this ADR's own index row changed. The same round recorded fork 6 (a code sign-in verifies an account someone else registered and keeps their password), found by the audit and not in front of the founder when he answered; not built, open for him. Code: `claimTry` replaces `recordWrongGuess` (claim a try before comparing); `sign-in-codes.service.spec.ts` 21/21 with two new cases (3×5 parallel guesses with the right code last: none signs in, `hashCode` runs 5 times; a right guess is not a wrong one for the day). Mutants: compare-first restored → both new cases red; the consumed-row adjustment removed → the day case red. `src/passkeys src/auth` 32 suites / 406 tests green; gateway `tsc --noEmit` clean |
| 2026-09-27 | the founder (item 67) + PR #479 builder (Opus agent) | Fork 6 **resolved**, verbatim "option 1 + do what industry do for these, for security ops do what the industry leaders do" (label "Drop pwd + (b) interim (Recommended)"). Built path (a) plus the adopted industry defences (§ Fork 6): first code → verify + drop unproven password + `session_version + 1` in one CAS, sockets closed, notice mailed; a reset link verifies the address it was mailed to. Merged `origin/main` (#477, #441, #475, #489) first: kept both `auth_time` and `sv`, `changePassword` now carries `auth_time`; the PR's two migrations renumbered to 20261020000000 / 20261020000100 (past the #441 ceiling). `pre-hijack.spec.ts` 16/16; 11 source mutants 11 red; `src/auth src/passkeys src/communications/email-templates src/websocket` green; CLAIMS: two new rows, three amended, duplicate rows from the merge collapsed; 6 claim mutants red. Forks 7 (invite door verifies any address) and 8 (no expiry of unverified registrations) opened, not built |
| 2026-09-27 | the founder (items 72, 73) + PR #479 builder (Opus agent) | Forks 7 and 8 **resolved**, verbatim labels "Bind invite to address (Recommended)" and "Expire the password, 7 days (Recommended)"; built as § Forks 7 and 8 (new `unproven-address.ts`, migration `20261102100200` adding `organization_invites.target_email`). Merged `origin/main` at `ef8ecdf30` (#435) first; the PR's two migrations renumbered again, `20261020000000`/`20261020000100` → `20261102100000`/`20261102100100`, because main's ceiling moved to `20261021150000` (`check_migration_order.py`); `@simplewebauthn/server` classified LOCAL for ADR 0224's host guard (its CRL fetch is filed in v3.0-TECH-DEBT). `unproven-address.spec.ts` 15/15; gateway `src/auth src/passkeys src/communications/email-templates src/restaurants src/team` 51 suites / 721 tests green; 15 source mutants 15 red; CLAIMS 627/627. Forks 9 and 10 found and left open for the founder. No independent Workflow fan-out ran |
| 2026-09-27 | the founder (items 77, 78) + PR #479 builder (Opus agent) | Forks 9 and 10 **resolved**, verbatim labels "Email invite + (c) interim (Recommended)" and "Refresh refuses lapsed (Recommended)"; built as § Forks 9 and 10 (invite mail with a secret only it carries, `team-invite.template.ts`, migration `20261125100300`; the refresh refusal). Merged `origin/main` at `bc7121ccf` first (CLAIMS conflict: ADR-0164-SIGN-IN-HOUSE-RULE kept this branch's authTime amendment, ADR-0164-ROLES-EXACT-MANAGERS-KEPT took main's 191); the PR's migrations renumbered `20261102100000/100100/100200` → `20261125100000/100100/100200` (`check_migration_order.py`: main's ceiling `20261116000220`). `unproven-address.spec.ts` 36/36; gateway `src/auth src/passkeys src/communications/email-templates src/restaurants src/team src/websocket` 52 suites green; web touched suites green; PGlite full corpus 249/249 plus 10 checks on `20261125100300` (a raw secret or upper-case hex refused by the shape check, the partial index present, re-run idempotent; superuser, platform stubbed); `check_gateway_boots.sh` PASS; 21 gateway + 4 web source mutants red; CLAIMS 647/647 with 10 claim mutants red. Fork 11 (per-house limit, anyone can open houses) found and left open for the founder. No independent Workflow fan-out ran |
| 2026-09-27 | PR #479 audit-fix round (Opus agent; ADR 0090 BLOCK at `09b712d29`, fix round 1 of 2) | The link path completed (§ Forks 8 and 10 after a link): `verifyEmailProvedByLink` removes a lapsed unproven password and bumps `sv` in one compare-and-set; the "fork 8 narrows" sentence corrected in place; fork 10 bracketed. Forks 12 (a link inside the seven days keeps a stranger's password and sessions) and 13 (a copied-link join plants a membership) filed open, with v3.0-TECH-DEBT rows. `unproven-address.spec.ts` + `verify-email-and-invite-read-errors.spec.ts` + `sessions-follow-membership.spec.ts` + `pre-hijack.spec.ts` green; 14 source mutants 14 red; CLAIMS `ADR-0229-FORK-8-A-LINK-CANNOT-REVIVE-A-LAPSED-PASSWORD` added: 4 claim mutants red, a comment-only control green; `check_decision_claims.sh` all holding. No independent Workflow fan-out ran |
| 2026-09-28 | the founder (items 81, 82, 83) + PR #479 builder (Opus agent) | Forks 12, 13 and 11 **resolved**, verbatim labels "Link needs sign-in (Recommended)", "Hold until accepted (Recommended)" and "Per address + per sender"; built as § Forks 11, 12 and 13 (the link needs a session of its account and the resend honours the lapse; an unproven join is held until accepted, accepted by membership id; 3 invite mails per address and 50 per person a day, GitHub's new-organization figure). Merged `origin/main` at `20838c551` first (CLAIMS conflict: both sides kept, the ADR-0225 row from this branch). The 389-397 "narrows" characterisation corrected again in place (bracket). Gateway `src/auth src/passkeys src/restaurants src/team src/communications src/websocket src/organizations` 99 suites green; web 347 files green; mobile auth green; orchestrator notifications green; PGlite 252/252 + 13 checks; `check_gateway_boots.sh` PASS; 27 gateway + 7 web + 1 orchestrator source mutants red; three new CLAIMS rows, eight re-pinned. No new fork. No independent Workflow fan-out ran |
