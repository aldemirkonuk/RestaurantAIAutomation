# Round 13: adversarial re-test of draft PRs #853, #849, #854 (2026-11-07)

Heads tested (all draft): #853 `32e406a54` (base `259feea3f` = origin/main), #849 `2464f5843` (base `259feea3f`), #854 `e7a94486f` (stacked on #827 `98c8ade0f`, which is stacked on main; the paging commit `ba95955cb` is #827's, not #854's).
Method: read-only `gh pr view/diff`; detached worktrees `/private/tmp/claude-501/qa-wt-r13-{853,849,854}` (removed afterwards, as are my temporary `refs/qa/pr*` refs); node_modules symlinked, never written. Probes in `/Users/aldemirkonuk/Projects/p4-scratch/sw-walk/qa-report/round13-probes-auth/`.

Limits, said plainly:
- `@simplewebauthn/server` is not installed. Mapped to a throwaway stub (`swa-stub.js`, via `jest.cjs`, outside the repo) so the auth suites load. With the stub, 3 passkey suites (`founder-round-six`, `passkeys.service`, `passkeys.sign-in`; 42 tests) fail; they need the real library and are unrelated to these PRs. On #849, `src/auth` + `src/passkeys`: 38 suites pass, 3 fail (those), 556 tests pass.
- SQL ran on a throwaway PG 17.11 container (local image `mudavym-pg17-postgis`, DBs created `C.utf8`, `en_US.utf8`, `tr_TR.UTF-8`) against a minimal `public.users` (same column type and UNIQUE constraint as the baseline migration), not the full migration corpus and not production. Container removed.
- Nothing was run against Supabase/PostgREST, a real mailbox, or a browser. Web checks are vitest/jsdom. No `tsc`/lint run on any PR. #854's "retry" behaviour is read from #827's code, not clicked.

## Verdicts

| PR | Targets | Verdict | Fails without the fix? |
|---|---|---|---|
| #853 register folds email case | R11-01 BLOCKER | **PARTIAL**, with a **REGRESSION** on password sign-in | Yes, 4/4 of its spec; SQL test passes on C and en_US, fails on tr_TR |
| #849 bounded verification send | #789 / OB-6 gateway half | **PARTIAL** (gateway FIXED; web says "sent" for the new outcome) | Yes, 9/9 of its two specs (note: partly because the new export is missing on main) |
| #854 say cost/value/open bottle/zone unread | #827 residual | **PARTIAL** (command page + `/inventory` cells FIXED; `/inventory` CSV and the unpaged base list read remain) | Yes, 8 tests fail with the 9 source files reverted to #827's head |

Counts: FIXED 0, PARTIAL 3, NOT FIXED 0, REGRESSION 0 as a whole-PR verdict (one real regression is inside #853, below).

## #853: register folds the owner's email to lower case

Is R11-01 closed for already-registered owners? **Only partly, and only after the migration runs.** The code change (auth.service.ts:1852 `const email = normalizeEmail(dto.email)`, :1962 `email,` in the insert, :2022 verification mail, :2030 onboarding mail) helps new sign-ups. Already-registered owners are helped only by migration `20270420100000_a_sign_in_address_is_kept_in_lower_case.sql`, and it deliberately skips two kinds of row (below). Version `20270420100000` collides with no other open PR's migration and sorts after main's latest (`20270301170000`).

What works (real `AuthService`, in-memory stub; `qa-r13-853.spec.ts`, plus the PR's own spec which fails 4/4 when `auth.service.ts` is reverted to main):
- Register `Chef@Bistro.com` stores `chef@bistro.com`.
- Reset: `requestPasswordReset("CHEF@bistro.com")` writes a reset row (1).
- Emailed sign-in code (`issueForSignIn("Chef@Bistro.com")`): issued (PR spec).
- `/sign-in-methods` and `checkEmailExists` with the capitalised address: found (`['password']`, `true`).
- Google: unlinked account refuses with the one shared sentence; a linked `sub` signs in as `chef@bistro.com`. (So "Google refuses" for a password-only owner is now by design, not a lookup miss.)
- Register twice with a different case: second is refused, 400 `Email already registered` (`BadRequestException`, auth.service.ts:1854), not 409. Exact repeat is also 400. Only one row exists afterwards. The 409 you asked about is not what this code uses; 400 is the pre-existing status here.
- Plus addresses: `chef+a@bistro.com` and `chef@bistro.com` are two different accounts (no plus-aliasing); `Chef+A@Bistro.com` collides with `chef+a@`. Unchanged and arguably right.
- JS fold of Turkish letters: `İLKER@x.com` -> `i̇lker@x.com` (i + U+0307), `ILKER@x.com` -> `ilker@x.com`, `ılker` stays. These are three different accounts. Locale-independent (JS `toLowerCase`), so Turkish vs C locale does not change the gateway side.

### Findings

1. **REGRESSION (new, High): password sign-in typed the way the owner registered is now refused.** `validateUser` still does `.eq("email", email)` on the raw body (auth.service.ts:389-393; R11-02, untouched), and `Login.tsx:234` sends the raw typed text (`login(email, password)`; `identity.email` is lower-cased but is not what is sent). Probe B, same service, two heads:
   - main: row `Chef@Bistro.com`; `validateUser("Chef@Bistro.com")` OK, `"chef@bistro.com"` refused.
   - #853: row `chef@bistro.com`; `validateUser("Chef@Bistro.com")` **refused "Invalid credentials"**, `" chef@bistro.com"` and `"CHEF@BISTRO.COM"` refused, only exact lower case works.
   So an owner who types `Chef@Bistro.com` at sign-up and again at /login (the common case) can no longer sign in by password, and gets "Invalid credentials" with no hint. Same for every existing mixed-case owner the migration folds. Reset and emailed code do work now, so they are not stranded, but the primary door breaks. The PR trades R11-01 for R11-02 on the password path. Fix direction: `normalizeEmail` in `validateUser` (and the dev-bypass lookup at :638) in the same PR, or the web sending the normalised address.
2. **Already-registered owners stay stranded in two cases, and the migration only logs a WARNING.** On the throwaway DB (`853-backfill-probe.sql` / `.out`):
   - A mixed-case row whose lower-case twin already exists (`Victim@Gmail.com` + `<redacted-email>`) is held. If the mixed-case row is the real owner, they are still unreachable by reset/code. A `RAISE WARNING` in a migration is not a notice anyone reads; no table, no alert, no `lower(email)` unique index added, so the squat window the report described stays open for the held pairs.
   - Any non-ASCII address is held (`İLKER@X.com`, and an address ending in NBSP). Both stranded.
   - Folded correctly: `Chef@Bistro.com`, ` Padded@X.com ` (trimmed), `ILKER@Example.com` -> `ilker@example.com`. Idempotent (re-run folds 0).
3. **Turkish-locale database corrupts the fold (Low, conditional).** On `tr_TR.UTF-8`, `lower('I')` is `ı`: `ILKER@Example.com` becomes `ılker@example.com`, `TWIN@x.com` becomes `twın@x.com`, and the collision check misses `Twin@X.com` vs `TWIN@x.com`. The PR's own SQL test **fails on tr_TR** ("folded 4 rows, expected 2") and passes on C.utf8 and en_US.utf8. The migration's non-ASCII hold looks at the original string, not at what `lower()` returns. The local Supabase container here reports `en_US.UTF-8`, so production is very likely not affected; I did not query production. Cheap fix: fold with an ASCII-only translate (`translate(x, 'ABC...Z', 'abc...z')`) instead of locale `lower()`.
4. Not a defect, noted: the migration needs no lock handling (single UPDATE, UNIQUE guards the rest) and `service_role`/`anon`/`authenticated` cannot execute it (SQL test asserts).

Verdict #853: **PARTIAL.** R11-01's three failing doors (reset, code, Google lookup) are fixed for new sign-ups and for foldable existing rows; not closed for held rows; and the password door regresses (finding 1).

## #849: a verification send that hangs no longer holds sign-up open (OB-6, 1/3)

Gateway behaviour (real `AuthService` + `AuthController` over `FakeDb`, `sendEmail` mocked; `qa-r13-849.spec.ts`):
- **Hang forever:** `registerAccount` returns after **8096 ms** with `verificationMail: "unconfirmed"`, tokens issued, account exists (P1, real timers). Bound `VERIFICATION_SEND_BOUND_MS = 8_000` (auth.service.ts ~:276). Fits the web client's 20 s axios timeout (AuthContext.tsx:91). It is a guess (PR says so; open entry filed). 8 s is sane for a button; the PR itself notes the lazy googleapis load can block the event loop for a long time on a cold start, in which case no JS timer fires on time. Not exercised.
- **Rejects fast:** `not_sent` (outer catch). **Throws synchronously:** `not_sent`. **Refuses `{success:false}` in time:** `not_sent` (PR spec).
- **Rejects 8+ s later (ETIMEDOUT):** response already `unconfirmed`; late error logged ("failed after the bound"); **0 unhandled rejections** (process listener). **Resolves late with `{success:false}`:** logged as "refused after the bound". Resolves late with success: logged "left after the bound" (PR spec).
- Timer is cleared in `finally`; no leaked handle seen.
- **Duplicate mail / superseded code (P3):** after an `unconfirmed` sign-up the first resend is allowed immediately (no `last_resent_at` on the fresh row), so two mails are sent. The first (late) mail's code is then refused (`400 CODE_REFUSED`, message says "Check the newest email from Mudavym"), the second's code is accepted, because a newer code supersedes older ones (sign-in-codes.service.ts:305). Acceptable and the refusal copy covers it, but the person can receive two mails and the first code is dead.
- **`resendVerification` with the provider down: FIXED on this base.** `{sent:false, verificationMail:"not_sent"}` for both a refused send and a rejecting send (controller P4); a hung resend answers `{sent:false, verificationMail:"unconfirmed"}` (PR spec t3). This closes the PARTIAL left by #789 in round 6 (auth.service.ts resend now ends `return resendAnswer(await this.queueEmailVerification(...))`, two sites, ~:3737 and :3759 on this head).
- Verify-code refusal codes (`CODE_REFUSED` / `CODE_SPENT` / `CODE_LOCKED_FOR_THE_DAY`): PR's second spec passes; wrong code returns 400 with `code`.

### Findings

1. **PARTIAL: the web page misreads the new outcome.** `apps/web/src/lib/verificationMail.ts:11` still types `'sent' | 'not_sent'`; `resendOutcome({sent:false, verificationMail:'unconfirmed'})` returns `'unconfirmed'`; `VerifyEmail.tsx:154-159` only branches on `=== 'not_sent'`, so an unconfirmed resend falls through to the success toast **"We sent a new verification email to ... Check your inbox."** and starts the cooldown. `verificationMailSentence('unconfirmed')` would say "Nothing was sent", also false. Probe: `qa-r13-849-web.test.ts`. Before the PR a hung send hung the request; after it, the page can assert a send that is unconfirmed. This is the false "sent" claim #789 was meant to remove, now reachable only on a hang. The PR is labelled 1/3 and the web half is not in it, but #849 should not merge without it or the type being widened.
2. Sign-up screen still ignores `verificationMail` (`Register.tsx` never reads it; PR's tech-debt entry says so). So "user told whether the mail left" is true of the API, not yet of sign-up.
3. Verification of the fix: both new specs fail 9/9 against main's `auth.service.ts`, but a share of that is the missing `VERIFICATION_SEND_BOUND_MS` export, so P1 (real 8 s wall clock, hang returns) is the cleaner behavioural proof; main would never return.
4. Unbounded parts remain before the send: the `email_verifications` insert and `issueForEmailVerification` DB calls are outside the bound (a hung DB still holds sign-up). Minor.

Verdict #849: **PARTIAL.** Hang handling is FIXED at the gateway; resend-with-provider-down is FIXED; the web half says "sent" for an unconfirmed resend.

## #854: inventory says cost, value, open bottle and zone could not be read

Reads: cost, value, WAC, margin and open bottle all ride on **one** read (`inventory_lot_rollup`); zones ride on the other (`inventory_location_breakdown`). So "separately" means rollup-only, locations-only, both. Command page probe (real hooks, `apiClient` mocked, one failing row + one good row, `qa-r13-854-command.test.tsx`):
- **Rollup only:** row Value cell `could not be read`; Value-on-hand KPI `could not be read`; good row still `$72`. Zones still read.
- **Locations only:** row location cell `could not be read` (was "Assign"); value `$180` and KPI `$252` still shown (correct, the cost read worked).
- **Both:** both cells and the KPI say it.
- Expansion, remove modal, CSV on the command page, `/inventory` (next) table Value cell, row dropdown WAC and margin, read sentence and notice line: PR tests pass (21 files, 440 tests) and 8 fail with the 9 source files reverted to #827's head. Gateway `inventory.service.spec.ts` 43/43.
- Cost no longer falls back to the menu price when the rollup failed (`bits.tsx` `paidPer`, also used for sort and market delta).
- **1000-row cap:** per-row rollup and location reads are now paged (`inventory.service.ts:186-230`, `readEveryPage`, PAGE 1000, `.order(...)` for stable paging; `supabase/config.toml` `max_rows = 1000`); a failed later page fails the whole read. That is #827's commit, tested by its 1200-row spec, not by #854. Not run against PostgREST.
- Turkish text: nothing in the inventory pages is localised (no i18n), the new strings are English like their neighbours; nothing to test.

### Findings

1. **`/inventory` (the default `next` page) CSV export still writes blank for a failed read.** `valuationColumns` (`next/iv-export.ts:61,64`) and the count sheet (`InventoryNext.tsx:548-549`) use `blank(r.wac)` / `r.value === null ? ''`. Probe `qa-r13-854-csv.test.ts`: failed-rollup row exports `WAC ""`, `Value at cost ""`, identical to a row that genuinely has no cost. The PR changed only the legacy command page's CSV. This is the "blank cost/value" complaint, still true in the exported file.
2. **The primary list read and the analytics read are still unpaged.** `database.service.ts:42-49` (`restaurant_inventory`, no `.range`, no `.order`) and `fetchAnalytics` (`inventory.service.ts` ~:265) have no paging. A house with more than 1000 active titles silently loses the rest of the list at PostgREST's cap, with no flag. #827's paging protects only the two side reads, so "1000-row cap still silent?" is **yes for the base list**. Code-read only, not run against PostgREST; not in #854's diff.
3. Command page raises no page-level notice and no retry when these reads fail (ALERTS empty in all three probes); only per-cell text and the KPI. The `next` page has the notice with a refetch (from #827). Legacy page, lower priority.
4. Small: `InventoryCommandPage.tsx:859` (`kpis.valueOnHand`) and :1392 (row `value`) still compute with `wac ?? price`; the KPI card and row cell mask them with the unread text, but the number is still computed (and any other consumer of `kpis.valueOnHand` would see a price-as-cost figure). Market delta and sort treat an unread row as null/0 without saying so.

Verdict #854: **PARTIAL.** The command page and the `/inventory` cells are FIXED and tested; the default page's export and the unpaged base list are not.

## Probe files (round13-probes-auth/)
`jest.cjs`, `swa-stub.js` (stub config), `qa-r13-853.spec.ts`, `qa-r13-849.spec.ts`, `qa-r13-849-web.test.ts`, `qa-r13-854-command.test.tsx`, `qa-r13-854-csv.test.ts`, `min-users.sql`, `853-backfill-probe.sql` + `.out` (en_US and tr_TR results), `849-suite.out`, `854-web-suite.out`. To re-run, copy a spec into a fresh worktree's `src/auth/` (or `apps/web/src/...`) and run jest with `JEST_WT=<worktree> npx jest -c jest.cjs <path>`.
