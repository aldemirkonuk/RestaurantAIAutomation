## The verify mail's code and send result reach no screen yet — OPEN — 2026-11-07

Filed by `fix/verify-mail-carries-a-code` (onboarding OB-3; founder /goal 2026-11-07, "Do not ask me any questions I approve you decide them all", so every fork below was the session's call). Proposal: `p4-scratch/sw-walk/onboarding/proposal.md` §3 Phase 1 row OB-3, §4 F3, §5 I15.

**What is true.** The gateway half is built: the verification mail carries a six-digit `verify_email` code beside its link (`verify-email.template.ts`), `POST /auth/register/account` answers `verificationMail: 'sent' | 'not_sent'`, and `POST /auth/verify-email` takes `{ code }` from a signed-in person (`AuthService.verifyEmailWithCode`). The web app does neither: `/verify-email` has no code box, and sign-up ignores `verificationMail`, so a person whose mail was not sent is still told to check their inbox.

**What closes it.** Onboarding OB-6 (web): a code box on `/verify-email` posting `{ code }`, and sign-up words for `not_sent` that offer the resend.

## Four other paths still say nothing when the verification mail fails — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** OB-3 changed only `registerAccount`. `resendVerification` still answers `{ sent: true }` whatever `queueEmailVerification` returned, and `registerRestaurant` plus one other caller in `auth.service.ts` still fire it with `.catch(...)` and drop the result. `grep -n "queueEmailVerification(" apps/api-gateway/src/auth/auth.service.ts` lists them. Proposal §5 I15 ("A failed send is said to the person") holds on sign-up only.

**What closes it.** Each caller returns the `VerificationMail` it gets, and its screen says it. The resend spec (`resend-verification-lockout.spec.ts`) pins the current `{ sent: true }` and changes with it.

## A verify_email code is a weaker mailbox proof than the link — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** The link's token is a random UUID. The code is six digits, guarded by the same rules as a sign-in code: five tries per code, and 20 wrong tries per address per day across all of its codes (`SignInCodesService`, `MAX_FAILED_PER_EMAIL_PER_DAY`). Someone who pre-registered another person's address holds a session for it, so they can guess. The odds are at most 20 in 1,000,000 a day. A right guess verifies the account and keeps that person's password inside the seven days, exactly as a right link would. A sign-in code has the same odds and gives a whole session, so the code adds no new class of attack. It does add a second door with those odds. Also, that person's wrong `verify_email` guesses count toward the same daily lock that stops the real owner's code sign-in for the day. Anyone can already trip that lock through the public sign-in route.

**What closes it.** Decide whether a `verify_email` code should get a tighter per-address budget than sign-in, or verify only when no password was set by someone else (fork 6's rule). Either way the lane asked for "the same rule as sign-in", and it has that.

## Smaller leftovers from OB-3 — OPEN — 2026-11-07

Filed with the entry above.

- **No per-source limit at sign-up.** `registerAccount` gets no request source, and the lane left the controller's register handler as it was. So a `verify_email` code issued at sign-up counts toward the per-address limit only. The `emailAlreadyRegistered` check already caps sign-up at one per address.
- **The code's address is compared on the read, not in the write.** `verifyEmailProvedByLink` refuses a code when the row it just read no longer carries the address the code proved, but its compare-and-set stays on `email_verified` and `session_version` only, because ADR 0229 fork 8's claim pins that write's text. If the address changed between the read and the write and the session version did not move, a code for the old address could still verify. No route in the gateway changes `users.email` today (`grep -n 'email: normalizedEmail' apps/api-gateway/src/auth/auth.service.ts` finds only inserts), so this cannot happen yet. Whatever adds an email change must bump `session_version`, or this write must also compare on `email` with fork 8's claim amended.
- **A resend spends the address's code budget.** Every path through `queueEmailVerification` (sign-up, resend, and the two other callers) now issues a `verify_email` code, and `MAX_CODES_PER_EMAIL_PER_HOUR` (5) counts it with sign-in and step-up codes for the same address. Resend allows one a minute (`auth.controller.ts`, `resendVerification`), so five resends in an hour leave no sign-in code for that address until the hour passes; the mail still goes, with the link and without a code (`auth.service.ts`, the `issueForEmailVerification` catch). The public sign-in route can already exhaust the same budget, so this adds no new lockout class. What closes it: a separate per-address budget for `verify_email`, decided with the tighter-budget entry above.
- **Messages say "link".** The 503 and 400 answers `verifyEmailProvedByLink` gives (it is shared by both proofs) say "verification link" even when the proof was a code.
- **The opt-in Gmail e2e still sends its own payload.** `communications/tests/register-verification-email.e2e.spec.ts` builds a link-only body by hand instead of rendering `verifyEmailTemplate`. It sends real mail and is opt-in, so it was not touched or run.
- **Production mail is unverified.** Nothing here proves the production sender works. The proposal's §6 already lists this.
- **ADR 0174's paper value.** The sheet uses `--paper-0` (`#fffdf8`, ADR 0104 D9's sheet) on `--paper-1`. ADR 0174 left that value open, and this session chose it under the /goal. The other account mails (reset, invite, step-up code) still use `baseTemplate`'s wine banner.
