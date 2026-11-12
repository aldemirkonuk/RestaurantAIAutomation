# Brief: the code mail carries a sign-in link the daily lock cannot close (QA r23, #953 item 1)

Branch `fix/code-mail-carries-a-sign-in-link`, stacked on `fix/new-device-signs-in-with-the-emailed-code` (#953 head cf9135151). DRAFT PR, 30K or less (`git diff cf9135151 HEAD | wc -c`). It is not done in place because #953 is at 19077 bytes and this build will push it past 30K.

## The problem
A stranger asks for 4 codes for the owner's address and burns 20 wrong guesses. `assertNotLockedForTheDay` (`apps/api-gateway/src/passkeys/sign-in-codes.service.ts` ~505, called from `store` ~245 and `verify` ~358) then refuses the address until tomorrow. Meanwhile the password door is flooded too, so the owner on a new device has no way in. Source: `/Users/aldemirkonuk/Projects/p4-scratch/sw-walk/qa-report/round23-pr-retest-signin-mailtab.md` lines 21-26.

## The session's call (already decided; do not reopen it)
Every code mail also carries a 128-bit single-use sign-in link. A link cannot be guessed, so no guess budget applies to it. The address-level caps stay exactly as they are:
- 5 codes per address per hour;
- 20 failed tries per address per day;
- 5 attempts per code.

They remain the anti-spam and brute-force bound for the 6-digit path. A stranger's requests now deliver keys that only the mailbox holder can use.

## Build
1. **Token.** Use `rowId + "." + base64url(HMAC_SHA256(linkKey, "sign-in-link.v1." + rowId + "." + code_hash))`. Derive `linkKey` from the JWT secret the same way the code-hash key is derived, but with a distinct label, e.g. `"sign-in-link"`. Compare with `timingSafeEqual` after a length check, and cap the token length at 200.
2. **Mail.** In the code mail (`sign-in-codes.service.ts` ~314, `gmail.sendEmail`), add one line under the code: a link to `${WEB_URL}/login/code#t=<token>`. Put the token in the URL fragment, never the query, so it stays out of server logs and Referer headers. Find how the web base URL is configured: grep `WEB_URL|FRONTEND_URL|APP_URL` in `apps/api-gateway/src`. Rows with `user_id null` send no mail today; keep that.
3. **Service method `verifyLink(token)`.**
   - Parse the token.
   - Read the row by `id` with purpose `sign_in`.
   - Recompute the HMAC from the row's `code_hash`.
   - Refuse with one 400 sentence for every failure: bad shape, bad HMAC, missing row, `user_id` null, expired (`expires_at`), already consumed, or superseded. Sentence: `That sign-in link has expired or was already used. Ask for a new code.`
   - Consume with a compare-and-set: `update({consumed_at}).eq("id").is("consumed_at", null).select()`. Zero rows means the refusal.
   - Do NOT call `assertNotLockedForTheDay`. Do NOT count attempts.
   - Fail closed: a read or update error is a 503, never a session.
   - Return `{ userId, email: row.email }`.
4. **Controller.** Add `POST /auth/email-code/link` in `sign-in.controller.ts`.
   - `@Public()`, `@RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "email-code-link" })`.
   - DTO `EmailCodeLinkDto`: `token` (IsString, MaxLength 200); `signInDevice` and `lastHouses` declared exactly as in `EmailCodeVerifyDto`. `forbidNonWhitelisted` is on.
   - Call `auth.issueSessionForVerifiedSignIn(userId, "email_code", row.email, dto.lastHouses)`.
   - Issue the known-device token exactly as `emailCodeVerify` does, using `foldAccount(row.email)`.
5. **Web.**
   - Add a route `/login/code` (find the router with grep `path="/login"` or `"/login"` in `apps/web/src`).
   - The page reads `t` from `location.hash`, then immediately calls `history.replaceState` to drop the hash.
   - It shows one button, "Sign in", which POSTs, then calls `signInWithSession` and keeps the `signInDevice` (reuse `rememberSignInDevice` from `lib/houseMemory`; the email comes from the response if you return it, or skip remembering).
   - Never auto-POST on load. Mail scanners open links, and a GET or auto-POST would spend the token.
   - On refusal, show the sentence and a link back to `/login`.
   - Add an API function next to `signInWithEmailCode` in `apps/web/src/services/api/passkeys.ts`.
6. **Claim.** Add one to `.planning/decisions/claims.d/fix-code-mail-carries-a-sign-in-link.jsonl`, with keys `id`, `status`, `claim`, `verify`, `verified`. `verify` must be static grep and must fail when the feature is removed: mutate it and see rc=1.

## Specs that must fail without the code (prove each with a revert or mutant)
- **The round-23 scenario.** 4 codes, then 20 wrong 6-digit tries, so `verify` is a 429 with the daily lock. The link from the newest row still signs in and returns a `signInDevice`.
- The link works once; a second use is refused.
- These are refused, each with the same sentence: a tampered HMAC; another row's HMAC on this row's id; an expired row; a row whose `user_id` is null.
- A consumed or superseded row is refused.
- A read error is a 503 (`makeStubDb(..., {"sign_in_codes:select": {message}})`).
- The link path never calls the daily lock: spy on it, or seed 20 failures today.
- The DTO accepts `token` and `signInDevice`, and refuses unknown fields.
- Web: the page does not POST on mount; clicking POSTs once; the hash is cleared.

## Rules
- Use a worktree only, with node_modules symlinks as in `/Users/aldemirkonuk/Projects/p4-scratch/sw-walk/wt/new-device-code`. Use explicit `git add`.
- Run heavy commands through `bash /Users/aldemirkonuk/Projects/p4-scratch/sim-run/heavy.sh` (exit 75 means busy: retry after 60s).
- Gateway tsc: `apps/api-gateway/node_modules/.bin/tsc --noEmit -p apps/api-gateway/tsconfig.json`. The only acceptable error is TS2307 `@simplewebauthn/server`.
- Run the guards: `scripts/check_decision_claims.sh`, `check_flag_readby_anchors.py`, `check_read_errors_not_swallowed.py`, `check_migration_versions_unique.py`. A new read must not swallow its error.
- No migration is needed: `code_hash` and `id` exist. If you find one is needed, stop and escalate.
- Never query production.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The PR body ends with the Claude Code line and records the session's call and its rejected alternatives (copy them from #953's body).
