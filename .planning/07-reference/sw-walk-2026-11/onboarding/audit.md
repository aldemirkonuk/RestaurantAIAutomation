# Onboarding: audit (software walk, 2026-11-07)

Every claim below is read from `origin/main` at **e26a5152d**, using `git show` and `git grep`. Nothing was built, run or clicked. Performance figures are inferred from the code. The one measured bundle is a **stale** local `apps/web/dist` from 2026-08-10, and section 3 labels it as such. No confidence numbers appear anywhere (ADR 0104).

Open PRs that overlap this area:
- **#656** `fix/the-first-menu-reads-from-the-house`: READY. It carries a prior ADR 0090 BLOCK at 2d81f8a5d, so it needs a fresh gate. It partly closes G3.
- **#691**: Register, the endpaper and the Google button.
- **#717**: EndpaperShell.
- **#732**: Landing.
- **#594**: ThemeToggle.

The menu Phase 1A workflow (`wf_c62a904e-77e`) owns the M1 and M6 fixes (see `p4-scratch/sw-menu-receipts/`). This audit does not duplicate them; it records how they break onboarding.

---

## 1. What it is for, in the restaurant's words

> "I heard about you, I want to try it tonight after close. Let me in with my
> Google account, tell you where my place is, show you my menu, and see
> something true about my own house before I lose interest."

For a restaurant, onboarding is the 10 minutes between "Start free" and the first moment the product knows the house. That moment is the menu read back as a priced list, with stock that can be counted and a supplier who can be ordered from. Everything before it is a toll. Everything after it has to be resumable from any device, because the owner gets interrupted by service.

## 2. Path map

### 2.1 Screens, in order

| # | Screen / route | Component (file:line) | Guard | Calls |
|---|---|---|---|---|
| 0 | `/l/day?for=…` static landing | `apps/web/public/l/day/index.html` | none (static) | none; CTAs go to `/register?type=new&for=…&page=day` |
| 1 | `/` stranger | `App.tsx:201` RootDoor, which lazy-loads `Landing` (`App.tsx:85`) | none | none |
| 2 | `/register?type=new` | `App.tsx:206` RegisterDoor (`pages/landing/RegisterDoor.tsx` `wantsForm()`) renders `Register.tsx` (eager, `App.tsx:69`) | none | `GET /auth/check-email` debounced 400 ms on every pause (`Register.tsx:172-215`, call at :187) |
| 2a | email sign-up submit | `Register.tsx` ~:840-851 | none | `POST /auth/register/account` (`auth.controller.ts:138-147`, `@Public`), then `AuthContext.registerAccount` :869-886, then `establishSession`: `GET /auth/me` (:860-867), then `navigate('/verify-email')` (`Register.tsx:851`) |
| 2b | Google sign-up | `Register.tsx:873-875` GoogleSignInButton mode=register | none | `POST /auth/register/google` (`auth.controller.ts:149-154`), giving `email_verified=true` (`auth.service.ts:1651-1700`; 409 if the email exists), then `navigate('/get-started')` (:875) |
| 2c | passkey sign-up | absent | | passkey exists only at sign-in (`Login.tsx:136-163`) |
| 3 | verification email | `auth.service.ts:2068-2105` `queueEmailVerification` | | fire-and-forget from `registerAccount` (`auth.service.ts:1611-1644`); link only, no code; 24 h expiry; `gmailService.sendEmail` falls back to a mock when OAuth is unconfigured (warn only) |
| 4 | `/verify-email?token=` | `App.tsx:210`, `VerifyEmail.tsx` | needs a signed-in session in this browser (fork 12, `VerifyEmail.tsx:49`) | user must click "Verify My Email" (`:194` / `:312`), then `handleVerify` (:52) does `POST /auth/verify-email` (`auth.controller.ts:574`), then `setTimeout` 1500 ms (:82), then a full reload via `window.location.href` (:83) to `/choose-house` or `/get-started` (:74-81) |
| 4a | resend | `VerifyEmail.tsx:135-143` | 1 per 60 s client-side | `POST /auth/resend-verification` (`auth.controller.ts:596`) |
| 5 | `/choose-house` | `App.tsx:213`, `ChooseHouse.tsx` | redirects to `/login` and `/verify-email` (:136-138) | `GET /auth/houses` (:96; `auth.controller.ts:644`); no houses goes to `/get-started`, and ended access goes to `/no-access` (:150-155) |
| 6 | `/get-started` step `you` | `App.tsx:225-235` (**no ProtectedRoute**), `GetStarted.tsx` (lazy :112) | none | `PATCH /auth/me` name+phone (`GetStarted.tsx:98-113`; `auth.controller.ts:297` `@AllowsNoHouse`); role goes **only** to `sessionStorage['mudavym:arrival-role']` (:106) |
| 7 | step `restaurant` | `GetStarted.tsx:217-340` | | Google Places `PlacesAutocomplete` (:287, `selectPlace` :131-145; fields at `components/ui/PlacesAutocomplete.tsx:245-246`), then `AuthContext.createFirstHouse` (:908-956), which is `POST /auth/register/house` (`auth.controller.ts:156-177`, JwtAuthGuard + `@AllowsNoHouse`) and then `/auth/me`; 409 shows `houseNotOpened` (`GetStarted.tsx:174`) |
| 8 | step `menu` | `GetStarted.tsx:340-390` | | drop zone `ingestDroppedImage` (:186-206) / `MenuScanUpload` / `MenuCsvUpload` / `MenuManualEntry` (:379-381); `POST` menu import, which runs `MenusService.importMenu` (`menus.service.ts:425-486`) |
| 9 | step `reading` | `GetStarted.tsx:89-96, :399` | | `setTimeout` 1200 ms, then `writeProof` (`lib/firstProof.ts:59-70`, sessionStorage), then `navigate('/house/menu')` |
| 10 | `/house/menu` | `App.tsx:244-250`, `HouseMenu.tsx` | ProtectedRoute | reads only `sessionStorage` (`HouseMenu.tsx:53`, `firstProof.ts:45`); an empty proof sends you back to `/get-started` (:85, :100); "Open the house" goes to `/house` (:324) |
| 11 | `/house` | `App.tsx:236-242`, `HouseContents.tsx` | ProtectedRoute | supplier: `POST /providers` (`HouseContents.tsx:25`), then `PATCH /onboarding/progress {vendor_added}` (:26), which duplicates the server write at `providers.service.ts:296-300`; "last invoice" keeps a filename, "We will not read it yet" (:112); exits are **only** `/house/menu` (:58) and `/settings?tab=cellar` (:145) |
| 12 | dashboard `/` | `DashboardLayout` (eager `App.tsx:64`) | ProtectedRoute | `SetupNudgeBanner` (`DashboardLayout.tsx:142`, `HouseShell.tsx:286`), which reads `GET /onboarding/progress` (`hooks/queries/useOnboardingProgress.ts`); while `!activated` it shows "Upload your wine list and set a low-stock threshold" with "Finish setup", which goes to `/get-started` (`SetupNudgeBanner.tsx:52-54`) |

### 2.2 Server: endpoints, service methods, tables

| Endpoint | Guard | Method (file:line) | Tables written / read |
|---|---|---|---|
| `GET /auth/check-email` | `@Public` (`auth.controller.ts:687`) | availability check | `users` (read); an **email existence oracle** |
| `POST /auth/register/account` | `@Public` (:138-147) | `registerAccount` `auth.service.ts:1611-1644` (lower-cases email) | `users`; verification token |
| `POST /auth/register/google` | `@Public` (:149-154) | `registerAccountWithGoogle` :1651-1700 | `users` (`email_verified=true`) |
| `POST /auth/register/house` | JwtAuthGuard, `@AllowsNoHouse`, **not** `@AllowUnverified` (:156-177) | `createFirstHouse` :1707-1846 | sequential: read `users` (403 unverified, 409 has house :1716-1719), then insert `organizations`, then `restaurants` via `insertHouseRow` (:1576, up to 2 tries), then `user_onboarding_progress` (UNIQUE claim :1784), then `Promise.all` over `organization_members`, `user_restaurant_access` and `users` update, then `generateTokens` (reads `user_roles`, access). Failure is compensated by deleting the restaurant and org; **not one transaction** |
| `POST /auth/register/restaurant` | `@Public` (:502) | `registerRestaurant` :1848 | **unreachable from web**; old one-shot path |
| `POST /auth/register` | returns 410 (:130-136) | | |
| `POST /auth/verify-email` / `resend-verification` | (:574 / :596) | | `users.email_verified` |
| `GET /auth/houses` | (:644) | | `user_restaurant_access`, held memberships |
| `PATCH /auth/me` | `@AllowsNoHouse` (:297) | | `users` name / phone |
| `GET/PATCH /onboarding/progress`, `PATCH /onboarding/threshold`, `GET /onboarding/vendor-email` | JwtAuthGuard; tenant via `assertTenantMatch` (`common/tenant/assert-tenant-match.ts`); **no role check** (`menus.controller.ts:245-285`) | `getOnboardingProgress` `menus.service.ts:2148-2202`; `updateOnboardingProgress` :2224+; `setDefaultThreshold` :2205-2222 | `user_onboarding_progress` (`menu_uploaded`, `vendor_added`, `team_member_invited`, `threshold_configured`, `completed_at`), `restaurant_menus` |
| menu import | upload rate bucket | `importMenu` `menus.service.ts:425-486`: creates a **draft, `current=false`** version, then `markMenuUploaded` (:2103-2146), which updates **every** progress row of the restaurant and sets `completed_at` only when menu, vendor **and** team are all true | `restaurant_menus`, `menu_items` (+ `backfillMenuItemColumn` N+1 :2085-2101), `user_onboarding_progress` |
| `POST /providers` | | `providers.service.ts:296-300` sets `vendor_added` (fire-and-forget) | `providers`, `user_onboarding_progress` |
| invite | | `generateInvite` `auth.service.ts:2347-2350` sets `team_member_invited` | |

**Self-heal** (`menus.service.ts:2161-2185`) runs inside a **GET**. When the progress row says `menu_uploaded=false`, it looks for a `restaurant_menus` row with `status='active'` (`maybeSingle`) and writes `menu_uploaded=true`. Errors are swallowed. It reads the restaurant from the **progress row**, not from the session's house. The outer read is keyed by `user_id` with `maybeSingle` (:2148-2160), so a person with two houses' rows gets an error, not progress. `activated = menuUploaded && thresholdConfigured` (:2200).

**Rate limit:** `rate-limit.guard.ts:29` sets `auth: 10 per 60 s` for every path containing `/auth/` (:227-229). It is keyed `prefix:ip:<ip>:route:<route>` (:271-297), so the budget is per route per IP. `upload` allows 10 per 300 s.

**Jobs/crons:** none for onboarding. Nothing sweeps unverified accounts, stale `user_onboarding_progress` rows or the abandoned draft menus (`.planning/08-softwares/auth-onboarding.md` §4 says the same, and `git grep` on main finds no new one).

**Dead code in the path** (no importers on main):
- `pages/Onboarding.tsx`: the route is a Navigate (`App.tsx:252`).
- `contexts/OnboardingContext.tsx`.
- Register's restaurant step 2 (`Register.tsx:929-975`, `:994-1370`): only `setPathBStep(1)` exists (:1121).
- `CurrencyStep`, `ThresholdStep`, `StaffWelcome`, `CellarRegistersOnboarding`, `MenuImportCard`, `MenuReviewScreen`, and `components/onboarding/GettingStartedPanel.tsx`.
- `AuthContext.tsx:575-598` still fabricates a `"My Restaurant"` branch (:593).

## 3. How it performs today (by reading code)

### 3.1 Route weight

`App.tsx:57-79` imports **eagerly** into the entry chunk:
- RootDoor, RegisterDoor, DashboardLayout (:64), Login (:68), Register (:69, 75 KB source), ForgotPassword, ResetPassword, VerifyEmail (:72), InviteLanding, NoAccess, ChooseHouse (:75), InventoryCommandPage (:76), InventoryRoute (:77), PageGate.
- RootDoor itself statically imports `DashboardLayout` and `ProtectedRoute`.

A stranger on `/` or `/register` therefore downloads the dashboard shell and the inventory command page before the landing (lazy, :85) even starts.

The `vite.config.ts:46-52` `manualChunks` setting puts `@tremor/react` + `framer-motion` + `lucide-react` into one `ui` chunk. Any page that imports a single lucide icon pulls the whole Tremor charting library, and the landing, register and GetStarted pages all use lucide.

`main.tsx` boot runs `startReminderScheduler` (:23), `registerServiceWorker` (:26) and `offlineStorage.pruneExpiredCache` (:30) for every visitor, strangers included.

**Stale measurement (dist from 2026-08-10, about 3 months old, not origin/main):**

| Chunk | Raw | Gzip |
|---|---|---|
| entry `index-*.js` | 2,023,689 B | 476,164 B |
| `ui` chunk | 1,042,087 B | 283,567 B |
| `vendor` chunk | 164,901 B | 53,842 B |
| CSS | 189,451 B | 26,514 B |
| GetStarted chunk | 34,571 B | 9,153 B |

Shared JS gzip before the first screen: about **814 KB**. I did not build at origin/main because of 15 GB free disk (the house rule is to keep at least 30 GB), low RAM and dependency drift in the dirty checkout. A clean-worktree build is owed before quoting a current number.

### 3.2 Request waterfalls

- **Email sign-up**, all sequential: `register/account`, then `GET /auth/me`, then a route change. Separately, 1 to many `check-email` calls while typing.
- **Verify:** a click, then `POST verify-email`, then a **1500 ms artificial wait**, then a **full page reload**, which re-downloads and re-parses the entry plus `ui` (about 814 KB gz from cache, plus a parse of 3 MB raw JS), then `GET /auth/me`, then `GET /auth/houses`, then a redirect, then the lazy GetStarted chunk.
- **createFirstHouse** server side: about 7 round trips to PostgREST in sequence: users read, org insert, restaurant insert (up to 2), progress insert, a parallel trio, then token reads. Then the client clears the entity cache under a timeout race, stores the session, and runs `GET /auth/me` (`AuthContext.tsx:908-956`).
- **Menu:** the import is a synchronous request. The scan path allows a 180 s timeout per chunk and up to 120 pages server side, against the 30 s axios timeout (`services/api/client.ts:67`; menu audit M12). The UI promises "10–20 seconds" (`MenuScanUpload.tsx:32`) and then adds a fixed **1200 ms** "Reading" pause (`GetStarted.tsx:89-96`).
- **Uploads:** an uploaded file is sent as raw base64 with **no client resize** (`CameraCapture.tsx:405`; camera capture alone is resized to 1920/0.9 at :375). The server has no resize (no `sharp`/`resize` in the parser). The limits are 10 MB client (`uploadAccept.ts:93`) and 15 MB body (`api-gateway/src/main.ts:26-49`).

### 3.3 N+1 and slow queries

- `backfillMenuItemColumn` (`menus.service.ts:2085-2101`) updates one row per menu item in a loop on the import path.
- `markMenuUploaded` (:2103-2146) does a read then a write over every progress row of the restaurant; it is cheap at one row.
- `getOnboardingProgress` can **write** on a GET (self-heal) and is polled with a 30 s `staleTime` from every dashboard mount via the nudge banner.
- There is no evidence of slow SQL. Every query is a PK or FK lookup.

### 3.4 Error states

| Where | What the person sees |
|---|---|
| 409 on house create | "house not opened" copy, with no way forward to the house that exists |
| 403 unverified | a Google path cannot hit it, because Google marks the account verified |
| 401 on anonymous `/get-started` | the PATCH fails, because the route is public |
| 429 | generic auth error copy; nothing tells the person to wait |
| scan timeout at 30 s | the client throws while the server may still finish, leaving an orphan draft |
| Google register on an existing email | 409, a dead end on the register screen (no "sign in instead" hand-off) |
| Maps unconfigured | the literal env-var name `VITE_GOOGLE_MAPS_API_KEY` is shown to the person (`GetStarted.tsx:279-283`) |

### 3.5 Step count (best case, email path, desktop)

The best-case path takes **about 17 interactions**:

1. Landing CTA.
2. Name.
3. Email.
4. Password.
5. Confirm password.
6. Submit.
7. Switch to the mailbox.
8. Open the mail.
9. Click the link, which must land in the *same* browser.
10. Click "Verify My Email".
11. Wait 1.5 s and a reload.
12. Re-type or confirm the name, then the phone.
13. Pick a role.
14. Search for the place.
15. Type the restaurant phone.
16. Open the house.
17. Upload the menu.

After those come a 10–20 s wait plus 1.2 s, then a review screen. **The house still has no current menu, no stock and no prices at the end (G1).**

The Google path is about 9 interactions, but lands in the same G1 hole.

## 4. Gaps

### G1 (blocker): the first menu never becomes current, yet setup counts as done
**Evidence:**
- `importMenu` creates a draft with `current=false` (`menus.service.ts:425-486`) and still calls `markMenuUploaded`.
- Nothing in GetStarted (`GetStarted.tsx:340-399`), HouseMenu (`HouseMenu.tsx:324`) or HouseContents calls make-current. The only make-current UI is `/menu` (`MenuPlan.tsx:204`).
- Only make-current seeds inventory and prices (ADR 0193 item 7).
- `activated` and the nudge read `menu_uploaded` (:2200).

**Result:** the person finishes onboarding with an empty inventory and no prices, and the product treats the menu step as complete. This is menu audit M1, confirmed. Its fix belongs to the menu Phase 1A workflow, and onboarding must call it.

### G2 (blocker): `/house` is a cul-de-sac with no way to the dashboard
**Evidence:**
- `HouseContents.tsx` exits only to `/house/menu` (:58) and `/settings?tab=cellar` (:145).
- `HouseMenu.tsx:324` "Open the house" goes back to `/house`.

A new owner loops between the two pages. Reaching `/` needs the address bar. #656 repoints the exits to `/menu`, but there is still no dashboard exit.

### G3 (major): the first-menu proof lives in sessionStorage, so any new tab or reload is a false "nothing read" that sends the person into a 409
**Evidence:**
- `HouseMenu.tsx:53` reads only `readProof()` from sessionStorage (`firstProof.ts:45`).
- An empty proof shows "No menu has been read yet." with a button to `/get-started` (:85, :100).
- GetStarted always starts at `you` (`GetStarted.tsx:54`), never resuming from server state.
- `createFirstHouse` then returns 409 (`auth.service.ts:1716-1719`), shown as "house not opened" (`GetStarted.tsx:174`).
- The dashboard nudge also sends housed people to `/get-started` (`SetupNudgeBanner.tsx:54`).

#656 adds a server read and an entry check. It is not merged and needs a fresh gate.

### G4 (major): verification is a multi-hop relay that breaks across devices and gives the opening tab nothing to watch
**Evidence:**
- The link needs a signed-in session in that browser (`VerifyEmail.tsx:49`). Opening the mail on a phone strands the person.
- A second click is required (`:194`, `:312`); `handleVerify` does not auto-run.
- Then a 1500 ms timer and a full reload (`:82-83`), then `/choose-house`, then `/get-started`.
- The original tab never polls (no interval or visibility handler in `VerifyEmail.tsx`).
- The mail carries no typeable code (`auth.service.ts:2068-2105`).
- With Gmail OAuth unconfigured, the send silently falls back to a mock and the person waits for a mail that never comes.

### G5 (major): the first-screen drop zone sends an unstripped data URL, so a dropped photo fails to read
**Evidence:** `GetStarted.tsx:186-206` sends the `readAsDataURL` result as is. `detectMediaType` defaults to jpeg (`scan-parser.service.ts:552-562`). This is menu audit M6, confirmed. It is the most natural gesture on the most important screen.

### G6 (major): `/get-started` is public
**Evidence:** `App.tsx:225-235` renders `<GetStarted/>` with no ProtectedRoute. An anonymous visitor fills step `you` and gets a 401 from `PATCH /auth/me` (`auth.controller.ts:297`). A housed person who arrives there (from the nudge or HouseMenu) walks into G3's 409. #656 adds an entry check inside the page; the route stays unguarded.

### G7 (major): the waits are artificial or dishonest
**Evidence:**
- A fixed 1200 ms "Reading" pause with "The facts are settling." (`GetStarted.tsx:89-96`, :399).
- Verify adds 1500 ms plus a reload (G4).
- The scan UI promises "10–20 seconds" (`MenuScanUpload.tsx:32`), while the import is synchronous with a 180 s budget per chunk and up to 120 pages against a 30 s client timeout (`client.ts:67`; M12). A multi-page wine list can time out on the client while the server continues and leaves an orphan draft.

### G8 (major): activation can never complete through the product, so the nudge loops forever into G3
**Evidence:**
- `activated = menuUploaded && thresholdConfigured` (`menus.service.ts:2200`).
- The only web caller of `setDefaultThreshold` (`services/api/menus.ts:243-247`) was `ThresholdStep`, which has no importers on main.
- `SetupNudgeBanner` shows whenever `!activated` (`SetupNudgeBanner.tsx:27-36`) and sends the person to `/get-started` (:54). Its copy asks for a threshold that no onboarding screen sets (:52).
- `completed_at` also needs a team invite (`menus.service.ts:2103-2146`), which onboarding never asks for.

### G9 (major): loading cost on the first three screens
**Evidence:**
- Eager imports of the dashboard shell, inventory command page, Login, Register, VerifyEmail, ChooseHouse and others (`App.tsx:57-79`), and RootDoor imports DashboardLayout statically.
- The `ui` manualChunk binds Tremor to every lucide icon (`vite.config.ts:46-52`).
- Boot runs a reminder scheduler, a service-worker registration and an IndexedDB prune for strangers (`main.tsx:23-30`).
- Stale measure: about 814 KB gz of shared JS before the landing paints (section 3.1). On restaurant Wi-Fi or a phone this is several seconds before "Start free" responds.

### G10 (minor): the auth rate limit can bite at sign-up
**Evidence:** 10 per 60 s per IP per route for `/auth/*` (`rate-limit.guard.ts:29`, :227-229, :271-297). `check-email` fires on every 400 ms typing pause (`Register.tsx:172-215`). Staff signing up together behind one restaurant NAT share the budget for `register/account` and `verify-email`. A 429 shows generic copy. This risk is inferred and has not been observed.

### G11 (minor): the self-heal is fragile and writes on a read
**Evidence (`menus.service.ts:2148-2202`):**
- A GET writes `menu_uploaded`.
- `maybeSingle` keyed by `user_id` errors for a person with rows in two houses.
- Only `status='active'` menus heal, so the onboarding draft (G1) never self-heals.
- Errors are swallowed.
- The restaurant comes from the row, not the session's house.

Separately, the client can PATCH any flag true (`menus.controller.ts:245-285`; there is no role check, only a tenant match), so progress is not evidence of anything.

### G12 (minor): fields that could be inferred are asked for, or collected and thrown away
**Evidence:**
- The name is asked at register and again at step `you` (`GetStarted.tsx:55`, :217-225).
- The role is picked and stored only in sessionStorage, which nothing reads (`GetStarted.tsx:106`).
- The restaurant phone is typed (:314) although Places can return it, but `fetchFields` asks only for address and location (`PlacesAutocomplete.tsx:245-246`).
- The timezone comes from the browser, not the place (:87).
- The currency is set silently from the country, with no confirmation (:83, :328).
- There is a confirm-password field.
- With Maps unconfigured, the developer env-var name is shown (:279-283).

### G13 (minor): sign-up methods are uneven
**Evidence:**
- There is no passkey at sign-up (`Register.tsx` has none; passkey is sign-in only, `Login.tsx:136-163`).
- Google register on an existing email returns 409 (`auth.service.ts:1651-1700`) with no "sign in instead" hand-off.
- `check-email` is a public existence oracle (`auth.controller.ts:687`).

### G14 (minor): campaign attribution is dropped at the door
**Evidence:** the `/l/*` CTAs carry `?for=` and `&page=`, but nothing in `apps/web/src` reads either (`git grep` is empty). The Google path discards the query. The first-party click/sign-up table the founder chose on 2026-10-31 does not exist.

### G15 (minor): "Last invoice, kept for later" keeps nothing, and the supplier step double-writes
**Evidence:**
- HouseContents keeps only a filename in sessionStorage and says "We will not read it yet" (`HouseContents.tsx:112`). The file is gone at tab close, which is a truthfulness gap.
- `addCustomProvider` then `updateOnboardingProgress({vendor_added})` (:25-26) duplicates the server write at `providers.service.ts:296-300`.

### G16 (minor): house creation is a non-transactional chain of about 7 round trips
**Evidence:** `auth.service.ts:1707-1846` makes sequential inserts with compensating deletes. A crash between the progress insert and the access rows leaves an org and restaurant the person cannot reach, and the retry gets a 409 (:1716-1719). The client then waits for `/auth/me` before advancing (`AuthContext.tsx:908-956`).

### G17 (minor): dead onboarding code, about 2k lines, plus a live unreachable public endpoint
**Evidence:**
- Register step 2 (`Register.tsx:929-975`, :994-1370).
- `OnboardingContext`, `Onboarding.tsx`, `ThresholdStep`, `CurrencyStep`, `StaffWelcome`, `CellarRegistersOnboarding`, `MenuImportCard`, `MenuReviewScreen`, `GettingStartedPanel`.
- `@Public POST /auth/register/restaurant` (`auth.controller.ts:502`) is still mounted and creates houses without the verified-first rule.
- The synthetic "My Restaurant" fallback remains (`AuthContext.tsx:593`).

### G18 (minor): no cleanup jobs
**Evidence:** no cron for unverified accounts, abandoned progress rows or orphan draft menus from timed-out imports (section 2.2 "Jobs").

---

## Limits of this audit

- **No build or run.** The bundle numbers are from a stale August dist. The waits are read from code timers, not measured.
- **Not checked live:** whether Gmail OAuth is configured in production. The prod rule forbids looking.
- G10 is inferred.
