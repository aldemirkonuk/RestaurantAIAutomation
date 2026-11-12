# Round 2: new-customer onboarding, adversarial QA (2026-11-07)

Scope: register -> verify email -> create house -> menu -> first dashboard. Judged as a first-time owner.

## Method and honest limits

- Code audited at `origin/main` 4e4399c05, read via `git archive` into a scratch copy (`.../scratchpad/onb-qa`). The working tree is `main` at 059169a59, 204 commits behind, with 1230 staged-but-unrelated entries. No repo edits, no dev server, no production, no mail, no passwords.
- Git check against HEAD: the GetStarted findings hold on both trees (GetStarted.tsx differs by only 20 lines). VerifyEmail.tsx differs by 118 lines, so its findings are origin/main only. Line numbers below are origin/main.
- Not done: nothing was clicked or run in a browser, so mobile width, real slow-network timing, dark mode and keyboard order are unverified. Findings are from code reading plus the tests below.
- Tests run in a partial copy:
  - web vitest on Register.currencyStep and GetStarted.cellarRegisters: 13 passed.
  - wider web run: 771 of 786 passed. The 15 failures are `security-headers.test.ts` (repo-root `vercel.json` absent from my partial copy). Seven files (Login.*, authPages.publicDesign, publicPages.recovery and others) would not load because `@wineops/ui` is not linked in the local `node_modules`. Both are environment faults, not product findings.
  - gateway jest: `verify-email-and-invite-read-errors.spec` and `house-opening` passed (57 tests). `unproven-address.spec` would not load (`@simplewebauthn/server` is missing locally).
  - No test at all covers the GetStarted step flow, VerifyEmail, HouseContents, HouseMenu or SetupNudgeBanner. That is why the BLOCKERs below were never caught.
- `.planning/08-softwares/auth-onboarding.md` is stale in places. Email lower-casing is fixed in `registerAccount` (auth.service.ts:1612) but not in `registerRestaurant` (see B-10). The "My Restaurant" synthetic branch is still present (AuthContext.tsx:593).

## Scenarios walked (22)

| # | Scenario | Result |
|---|---|---|
| 1 | Back button mid-GetStarted | steps are `useState` only, no history: Back leaves the flow and typed data is lost (I-1) |
| 2 | Reload on the restaurant or reading step | restarts at "Welcome"; then "This account already has a house" (BL-1) |
| 3 | Expired verify link | only the same Verify button; no resend (B-4) |
| 4 | Verify link opened on the phone, not the registering browser | forced password sign-in; works, but costly (I-6) |
| 5 | Same email registered twice (password, Google, different case) | password and Google: good wording. API `register/restaurant` with a different case slips through (B-10) |
| 6 | Turkish / non-Latin / very long house name | works; slugs ugly or empty (I-3); over 249 characters gets a misleading message (I-11) |
| 7 | Multi-location owner | no way to open a second house (B-13) |
| 8 | Abandoned after register, returns days later | unverified under 7 days: fine. Over 7 days: told "password did not match" (B-6) |
| 9 | Abandoned after house, before menu | the finish-setup nudge dead-ends (BL-1) |
| 10 | New person clicks Google on /login | link-from-profile wording (B-7) |
| 11 | Google OAuth self-provision | closed: auth.service.ts:3632-3647 only resolves existing accounts; /register/google 409 wording good |
| 12 | Mobile 375 px | code-only: GetStarted layout wraps. Not seen live; round 1 F-01 already covers the invite "x" overlap |
| 13 | Slow network on the menu read | 30 s client timeout (B-2); a dropped-photo failure is invisible (B-1) |
| 14 | No POS | nothing blocks, but nothing offers POS either (I-5) |
| 15 | Wrong role: invited staff or manager verifies email | sent to owner onboarding (B-12) |
| 16 | Double submit: Create account | not guarded (B-9) |
| 17 | Double submit: Open the house | guarded by `saving`, plus a server claim row. Good (S-2) |
| 18 | Verify click twice or in two tabs | handled, "already verified" (S-5) |
| 19 | Lost resend mail, mail provider down | UI says sent (B-5) |
| 20 | Signed-in person opens /register?type=new | form shown again (I-7) |
| 21 | Anonymous visitor on /get-started | renders; first save 401s (I-12) |
| 22 | Closing the tab after the first read, reopening | "No menu has been read yet" (B-3, BL-1) |

## BLOCKER (2)

**BL-1. An owner who has a house can never get back to the menu step.**
- Everything that says "finish setup" sends them to `/get-started`: SetupNudgeBanner.tsx:54, LearnPanel.tsx:74 ("Upload Now"), HouseMenu.tsx:85 and :100.
- `/get-started` always opens at step `'you'` (GetStarted.tsx:54), with no check for an existing house. Welcome -> Continue -> restaurant -> "This is us" calls `createFirstHouse`.
- The server refuses with 409 (auth.service.ts:1723), and the page says "This account already has a house, so no second one was opened." (houseOpeningWords.ts, `alreadyOpen`). There is no link onward.
- Repro: register, verify, open a house, skip the menu or close the tab, then click "Finish setup" on the desk. A reload at any step triggers the same loop.
- Workaround: the menu page (`MenuVersions.tsx`) is a separate upload route, but nothing in onboarding points to it.
- This is proposal G1, still open on main.

**BL-2. The end of the flow never reaches the dashboard.**
- `/house` (HouseContents.tsx) has no link to `/`. Its only exits are `/house/menu` and `/settings?tab=cellar`.
- `BrandMark` is not a link (BrandMark.tsx: no href, Link or onClick). `/house/menu` "Open the house" only goes back to `/house` (HouseMenu.tsx:324).
- Repro: finish the first read, land on "Your house.", look for the desk. There is nothing to click. Typing `/` works, and so does signing in again.

## BUG (15)

- **B-1. The menu step shows no error.** `ingestDroppedImage` calls `setError` (GetStarted.tsx:200-205), but the menu-step JSX (:339-394) never renders `error`. A dropped photo that fails to read just stops saying "Reading…" with no reason. Only the click-to-open panels show their own errors.
- **B-2. A menu read dies at 30 s on the client.** `timeout: 30000` (client.ts:67) and `importMenu` sets no longer timeout (menus.ts:136). A multi-page AI read can exceed it. The person sees a raw "timeout of 30000ms exceeded" while the server may finish, and a retry may import twice. I did not check whether imports de-duplicate.
- **B-3. The first proof is stored only in `sessionStorage`** (firstProof.ts:60). A new tab, another device or a closed tab shows "No menu has been read yet" (HouseMenu.tsx:80-90) even though the import was saved. Its button leads to BL-1.
- **B-4. An expired or used verify link has no resend.** The error shows (server: "Verification token expired. Please resend.", auth.service.ts:3367) but the token branch of VerifyEmail renders only the same Verify button (:190-199). The Resend button exists only in the no-token branch.
- **B-5. "Verification email requested" is said even when no mail left.** `queueEmailVerification` swallows every failure (auth.service.ts:2068-2106). `resendVerification` always returns `{ sent: true }` (:3567, :3587), and the toast says "Check your inbox" (VerifyEmail.tsx:145). This is absence reported as health.
- **B-6. A lapsed unverified owner is told their password is wrong.** After 7 days the correct password is refused as "Invalid credentials" (auth.service.ts:465). Login shows "That password did not match. Check it and try again, or reset it below." (Login.tsx:70-71). The emailed code is offered elsewhere on the page, but this message never mentions it.
- **B-7. A new person who taps Google on /login gets account-linking text.** "…If you already have an account, sign in another way and link Google from your profile first." (auth.service.ts:296). They have no account and no profile.
- **B-8. Any failure of the invite-code lookup reads "Code not found, expired, or already used"** (Register.tsx:250, a bare `catch`). A 429, 503 or offline state blames the code.
- **B-9. Create account is not double-submit-safe.** `disabled` omits `loading` (Register.tsx:818-822), unlike the house button. Two clicks send two POSTs. The loser can return `Registration failed: duplicate key value violates unique constraint "users_email_key"` (auth.service.ts:1632, the message is passed through). That puts a constraint name on screen, which houseOpeningWords.ts says must never happen.
- **B-10. `POST /auth/register/restaurant` is case-blind.** It checks `emailAlreadyRegistered(dto.email)` (auth.service.ts:1849) and stores raw (:1959). The DB constraint `users_email_key` is a case-sensitive UNIQUE(email) (baseline migration :8176). Repro by API: register `foo@bar.com`, then `Foo@Bar.com`, and you get two accounts. The web form never reaches this route (no `setPathBStep(2)`), so it is API-only today.
- **B-11. The house timezone is the browser's, while the copy says the address sets it.** Copy at GetStarted.tsx:277, code at :87. The value is shown but cannot be edited, so an owner signing up from another country gets the wrong day boundary.
- **B-12. Invited staff and managers are sent to owner onboarding after verifying.** VerifyEmail.tsx:76-81 routes to `/get-started` whenever the house has no uploaded menu, and never looks at the role. That ends in BL-1's dead end.
- **B-13. A second location is impossible.** `createFirstHouse` refuses any account with `restaurant_id` (auth.service.ts:1723). There is no other house-creating endpoint. The web comment at AuthContext.tsx (createFirstHouse) assumes "a person who already had a house moves into the new one". An owner of two restaurants needs two emails.
- **B-14. The name prefill is lost on a fresh load.** `useState(user?.name ?? '')` (GetStarted.tsx:55) never syncs, and `user` is null on the first render (AuthContext.tsx:361-362, no gate). The standard path (verify -> hard reload at VerifyEmail.tsx:83 -> /get-started) therefore shows "Welcome, there." and an empty name field that must be retyped.
- **B-15. A whitespace-only name registers.** `@MinLength(2)` runs before `.trim()` (register-account.dto.ts, auth.service.ts:1619), and the client only tests `!createName`. The stored name can be empty.

## HARM (1)

- **H-1. "Last invoice · kept for later" keeps nothing.** HouseContents.tsx:36-38 stores only the file name in `sessionStorage` (houseLater.ts). The file is never uploaded, yet the page says "kept for later" (:108) and "Drop a file when you want." A supplier invoice the owner thinks is saved is gone when the tab closes.

## SMOOTH (what works, 7)

- S-1. `registerAccount` lower-cases and trims the email (auth.service.ts:1612).
- S-2. Opening the house: `saving` disables the button, a server claim row stops a concurrent second house, and failures roll back (auth.service.ts:1790+). Words come from status only.
- S-3. Google register on an existing address gives a clear 409: "An account already uses this email. Sign in instead." (auth.service.ts:1654).
- S-4. The verify link is a POST button, so mail scanners cannot burn it. Unverified users are held at `/verify-email` by ProtectedRoute, and an account with no house goes to the chooser, then `/get-started`.
- S-5. A spent link shows "already verified" and does not error (VerifyEmail.tsx:50, :125).
- S-6. The emailed sign-in code is always offered on Login (Login.tsx:605-620).
- S-7. The OAuth self-provision hole is closed (auth.service.ts:3608+), and create-house errors say what to try without leaking internals.

## IMPROVE (12)

- I-1. GetStarted has no per-step history and no resume. Persist the step server-side (the `user_onboarding_progress` row already exists) and skip finished steps.
- I-2. A fixed 1.2 s "reading" pause (GetStarted.tsx:89-96) and a 1.5 s verify wait plus full reload (VerifyEmail.tsx:82-84).
- I-3. House slugs for non-ASCII names: "Çiçek Lokantası" gives `i-ek-lokantas-…`. An all-non-Latin name gives `-ab12cd` with a leading hyphen (house-opening.ts:115-121, auth.service.ts:1748).
- I-4. The "Role" chips (GetStarted.tsx:106) go to `sessionStorage` only and are never sent. They are decoration.
- I-5. No POS prompt anywhere in onboarding (no mention in GetStarted, HouseContents or HouseMenu).
- I-6. The verification mail is English only. The link is useless on a second device without a password.
- I-7. A signed-in person on `/register?type=new` sees the sign-up form again (RegisterDoor.tsx ignores auth).
- I-8. The live "is this email taken" probe is a GET with the email in the query string (auth.controller.ts:687), plus "Email already registered". It is an enumeration oracle. ADR 0024 accepts this knowingly, but it also puts addresses in access logs.
- I-9. Dropping a PDF on the photo target silently opens the file panel and discards the dropped file (GetStarted.tsx:187-190).
- I-10. Passwords: min 8, no show/hide toggle, no maximum (bcrypt truncates at 72 bytes).
- I-11. A house name over 249 characters (the server cap) returns the generic "Check the name, the address and the phone number" sentence. The client has no `maxLength`.
- I-12. `/get-started` and `/onboarding` are public (App.tsx:232, :253). An anonymous visitor can fill the Welcome step, and the first save 401s. I did not trace what the 401 handler shows.

## Counts

BLOCKER 2, BUG 15, HARM 1, SMOOTH 7, IMPROVE 12.
