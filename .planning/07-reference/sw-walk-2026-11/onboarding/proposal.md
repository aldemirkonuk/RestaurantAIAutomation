# Onboarding: proposal (software walk #3, 2026-11-07)

Everything here was read from `origin/main` at **e26a5152d** with `git show` and `git grep`. Nothing was built, run, clicked or measured live. Inputs: `audit.md` (G1-G18), `sota.md`, and the two-lens verdicts (`verdicts.json`). **Where a verdict narrowed a gap, this file uses the corrected claim, not the audit's wording.** No confidence numbers appear for people anywhere (ADR 0104).

Authority: under the founder's /goal of 2026-11-07 (*"Do not ask me any questions I approve you decide them all"*), every fork in §4 is **the session's call**, not his pick. ADRs are cited as context and are not treated as binding. Where a call departs from a Locked ADR, the row says which one and what record is owed.

Abbreviations: `W` = `apps/web/src`, `GW` = `apps/api-gateway/src`, `MS` = `GW/menus/menus.service.ts`, `AS` = `GW/auth/auth.service.ts`.

---

## §1 Verdict

A new owner who signs up by email today makes about 17 interactions, including a mailbox trip that only works in the same browser, a second click and a 1.5 s wait with a full reload. They also pass a fixed 1.2 s "reading" pause. At the end the house **still has no current menu, no inventory rows and no prices**, while the product counts the menu step as done (G1). After that, the house pages loop between themselves, and the setup nudge asks for a threshold that no screen sets (G2, G8).

The back half (house creation, menu reading, the first proof) is mostly built. What fails is **truth and joining**: which menu is the house's, where progress lives, and what the next screen is. The server pieces exist but are not wired: the six-digit emailed code (`GW/passkeys/sign-in.controller.ts:89-115`), passkey enrolment with no house (`GW/passkeys/passkeys.controller.ts:72-76`), make-current (`GW/menus/menus.controller.ts:243`) and document intake (`GW/procurement/documents/documents.controller.ts:1039`).

So: fix the server's account of progress first, then the waits and the hand-offs, then reach the bar with code-first sign-up, a passkey offer and a first invoice that is actually read. The target is **8 interactions on Google and 11 by email to a current, priced menu**, with zero artificial waits.

---

## §2 Target experience, per screen

People pages stay simple (memory: sketch style). Colours come only from `W/styles/mudavym.css` tokens:
- `--paper-0` (`:169`) for the ground;
- `--ink-1` (`:174`) for text, `--ink-3` (`:176`) for secondary text;
- `--seal` (`:142`) for the one primary action;
- `--alarm` (`:163`) for refusals, `--warn` (`:185`) for pencil.

The charcoal ground has its own values (`:209-244`). Today every onboarding page hard-codes hex values instead (for example `HouseMenu.tsx:81`, `HouseContents.tsx:42`) and so cannot follow a person's ground (ADR 0169).

| # | Screen | What the person sees and does | Waits | Errors, in words | Loading |
|---|---|---|---|---|---|
| 0 | `/l/<page>` (static) | Unchanged. The CTA keeps `?for=&page=`. | none | none | static HTML |
| 1 | `/register` | **Continue with Google** first. Below it: name, email and **Send my code**. No password, no confirm, no live "is this email taken" probe. *(Phase 2 interim: password stays, confirm goes, show/hide toggle.)* | none | 429: "Too many tries from this network. Try again in N seconds." (from `Retry-After`) | Only the door: no dashboard shell, no inventory page, no Tremor (OB-10) |
| 2 | Code | "We sent a code to a@b.com." Six boxes with `autocomplete="one-time-code"`; it continues by itself at the sixth digit. The mail also carries the link. If the send failed: "The mail did not leave. Send it again." | the mailbox only | wrong code: "That code is not the one we sent." Expired: "That code has expired; here is a new one." | in the entry already |
| 3 | Your restaurant | "Welcome, Aldemir." (prefilled; a *change* link) and one search box: **Find your place**. After a pick, one ruled line shows address · phone · clock · currency, all derived. **Open the house**. Under it, an optional line: *Add a passkey for next time*. | the house-open round trip, as one transaction (OB-2) | Search off: "Search is off here; type the address." (never an env-var name). Already open: goes into the house that exists (F8) | lazy chunk |
| 4 | Your menu | Drop zone and **Take a photo** / **Choose a file** / **Type it**. One sentence: "Any menu: drinks, food or both." | none | refused file type, in words (menu 1a) | same chunk |
| 5 | Reading | Real progress: "Reading page 2 of 4". "You can leave; we will tell you when it is read." No fixed timer. | the read itself (background job, menu 2c) | partial read names the unread pages (menu 1c). Empty read: "Read nothing from this file." | none |
| 6 | Proof `/house/menu` | The typeset menu (ADR 0213 #5). Two buttons, **neither preselected**: *Make this the house's menu* / *Keep it, not current* (menu 1e). Owner and manager only; staff see the proof. | make-current round trip | refused price lock, in words (menu 1e ports `MenuReviewScreen.choice.test.tsx`) | lazy |
| 7 | The house `/house` | Menu ✓ with counts ("48 on the menu, 31 priced, 17 to pencil"). **One** next ask: **Count the shelf**. Two quiet "later" lines: *Your supplier* (name, or drop the last invoice, which gets read, OB-14) and *Cellar registers*. The header mark and **Go to the desk** lead to `/`. | none | none | lazy |
| 8 | Desk `/` | The nudge shows only while the menu is not current. It says "Make your menu the house's menu" and leads to `/house/menu`. It never mentions a threshold or a "wine list". | none | none | dashboard chunk, loaded only now |

**Counts.**
- **Google:** CTA, Google, account pick, search, pick, Open the house, drop the menu, make it current. That is **8**.
- **Email:** CTA, name, email, Send, the mailbox trip, the code, search, pick, Open the house, drop the menu, make it current. That is **11**.
- **Today:** about 17 by email and about 9 by Google, and neither ends in a current menu. The waits today are 1.5 s for verify (`VerifyEmail.tsx:82-84`), a full reload (`:83`) and 1.2 s for reading (`GetStarted.tsx:89-96`). After this plan they are 0 s artificial.

---

## §3 Phased build plan

Rules for every lane:
- At most 15 files and 30K of diff per PR.
- DRAFT until gated (ADR 0090; memory: a CI PASS auto-merges).
- Each lane carries a `claims.d` row and a `tech-debt.d` entry.
- The tests named must **fail on origin/main and pass on the branch**. A no-op mutation counts as a failed test.
- Migrations take their version at merge and are cited by slug.

### Phase 0: owned by other lanes (onboarding depends on them; not rebuilt here)

| Item | Owner | Closes |
|---|---|---|
| **#656** `fix/the-first-menu-reads-from-the-house` | open; prior BLOCK at `2d81f8a5d`, so it needs a fresh full gate | G3 (proof read from the server), G6 entry check inside the page, nudge to `/house`, honest invoice words. #655 merged 2026-10-09. |
| menu **1a**: #762 (gateway) plus the GetStarted strip (web half) | menu wf `wf_c62a904e-77e` | G5 |
| menu **1c** partial and empty reads, **1d** no orphan version plus no "10-20 seconds" copy | menu wf | G7 (copy), G18 (orphan half) |
| menu **1e** onboarding make-current on `/house/menu` | menu proposal; needs 1l, the MU-1 look, and #656 | **G1** (the M1 bug) |
| menu **1g** self-heal reads its error, rule "≥1 line" | menu wf (`selfheal`) | G11 (partly) |
| menu **1l** never-counted is unknown | menu wf | prerequisite of G1 |
| menu **2c** background reading (MU-5 = background, the founder's pick 2026-11-07) | menu Phase 2 | G7 (scan wait) |

### Phase 1: server correctness (gateway first)

| Lane | Branch | Files (≤15) | Tests that fail on main and pass after | Depends on |
|---|---|---|---|---|
| **OB-1** Progress is read from the session's house; a GET writes nothing; activated = a current menu | `fix/onboarding-progress-reads-the-house` | `MS` (`getOnboardingProgress` :2148-2203, `updateOnboardingProgress` :2224-2258); `GW/menus/menus.controller.ts` (:256-281, pass `restaurantId` from the token; owner/manager on `PATCH threshold`); the DTO; new `GW/menus/onboarding-progress.spec.ts`; claims row; tech-debt entry | (t1) A person whose row names house A while the token is in house B gets B's facts. On main the facts come from the row (`MS:2170`, `:2191`). (t2) GET makes **zero** `.update` calls. On main it writes (`MS:2176-2179`). (t3) An active menu with `threshold_configured=false` gives `activated: true`. On main it is false (`MS:2201`). (t4) `PATCH {menu_uploaded:true}` on a house with no menu leaves GET false. On main it sets true (`MS:2229-2230`). (t5) `PATCH /onboarding/threshold` as staff gets 403. On main it gets 200: the tenant is checked (`GW/auth/guards/jwt-auth.guard.ts:74`) but no role is. (t6) An invitee with **no** progress row gets facts, not a 404 (`MS:2156-2159`). | menu 1g merged (same function) |
| **OB-2** The first house opens in one transaction | `fix/first-house-opens-in-one-transaction` | migration (an `open_first_house(...)` RPC that takes the values TS already computed: slug, place id, currency, zone); `AS` `createFirstHouse` (:1707-1846); auth house spec; PGlite test; claims row | (t1) A forced failure on the access-row insert **with the compensating delete also failing** leaves zero `organizations` and `restaurants` rows. On main both stay, because the delete errors go unchecked (verdict G16). (t2) A retry after (t1) opens the house and does not answer 409. | none |
| **OB-3** The verify mail carries a code, and the send result is said | `fix/verify-mail-carries-a-code` | `GW/passkeys/sign-in-codes.service.ts` (`CodePurpose` :61 gains `verify_email`; same HMAC, 10 min, single use); `AS` `queueEmailVerification` (:2068-2106; returns sent or not); `AS` `registerAccount` (returns `verificationMail: 'sent' \| 'not_sent'`); `GW/auth/auth.controller.ts` (`POST verify-email` :574 also takes `{code}` for the signed-in person); new template in `GW/communications/email-templates/` (Mudavym paper, ADR 0174, replacing the `#7c2d12` sheet at `AS:2114`); specs; claims row | (t1) The right code from the signed-in person marks them verified and returns a session. (t2) A code issued for another address is refused. (t3) Five wrong codes lock it, the same rule as sign-in. (t4) `register/account` says `not_sent` when `sendEmail` returns `success:false`. On main that is only logged (`AS:2094-2097`). | none |
| **OB-4** Sign-up keeps its landing page | `feat/signup-carries-its-landing-page` | ADR (the onboarding half of OD-251, as the session's call); migration `signup_attributions` (user_id, page, audience, created_at; insert-only, no update or delete grant); register account and Google DTOs plus `AS`; spec; PGlite; claims row. The README row goes in its own PR. | (t1) A register with `page=day&for=…` stores one row. (t2) A page outside the allow-list (`apps/web/public/l/*`) stores nothing and does not fail sign-up. (t3) PGlite: `UPDATE` and `DELETE` are refused. On main the parameters are dropped (G14, `l/day/index.html:2128`). | ADR 0354 decision 5 says counting needs its own ADR; this lane writes it |
| **OB-3b** The rate limit keys the address the proxy saw | `fix/rate-limit-keys-the-proxy-seen-address` | `GW/common/rate-limit/rate-limit.guard.ts` (:305 trusts the **first** `x-forwarded-for` entry); `GW/main.ts` (`trust proxy` with a measured hop count); spec | (t1) A request with a forged leading XFF entry lands in the same bucket as one without it. On main it gets a fresh bucket. | **Measure** Railway's hop count first; the lane says what was measured |

### Phase 2: the web (stacked on #656 and menu 1e; every file below is touched by #656 unless noted)

| Lane | Branch | Files | Tests that fail on main and pass after | Depends on |
|---|---|---|---|---|
| **OB-5** `/get-started` is guarded, waits for nothing, and steps into an existing house | `fix/get-started-guarded-no-timers` | `W/App.tsx` (:231-236); `W/components/ProtectedRoute.tsx` (new `allowNoHouse`, because today a no-house session is sent to `/choose-house` at `:59-60`, which would loop); `W/pages/GetStarted.tsx` (drop the timer at `:89-96`; on 409 refresh `/auth/me` and route by #656's entry rule); `W/lib/houseOpeningWords.ts`; new `W/pages/__tests__/GetStarted.entry.test.tsx` | (t1) Anonymous `/get-started` goes to `/login`. On main it renders (G6). (t2) A menu result navigates with fake timers at 0 ms. On main it needs 1200 ms. (t3) A 409, then `/auth/me` showing a house, lands on `/house`. On main it shows the sentence (`GetStarted.tsx:171-174`). (t4) The Maps-off copy contains no `VITE_` (`:281`). | #656 |
| **OB-6** Verify in the tab you signed up in | `fix/verify-in-the-tab-you-signed-up-in` | `W/pages/VerifyEmail.tsx` (auto-run `handleVerify` when signed in with a token; a code box; no `setTimeout`, no `window.location`, see `:82-84`; recheck `/auth/me` on `visibilitychange`); `W/contexts/AuthContext.tsx` (one exported session-refresh, the same path `createFirstHouse` uses at `:908-956`); `W/pages/Register.tsx` (pass `verificationMail` in navigation state); `W/services/api/auth.ts`; new `VerifyEmail.test.tsx` | (t1) Token plus session posts verify with no click. On main it needs the button (`:194`). (t2) Six typed digits post `{code}`. (t3) Success navigates through the router and never assigns `window.location.href`. (t4) `visibilitychange` with `emailVerified:true` moves on. (t5) `not_sent` shows "The mail did not leave". | OB-3; **#691** (Register.tsx) |
| **OB-7** The place fills the house; the You step and the role go | `fix/the-place-fills-the-house` | `W/components/ui/PlacesAutocomplete.tsx` (`fetchFields` `:245-247` adds `internationalPhoneNumber`, `utcOffsetMinutes`); new `W/lib/zoneForPlace.ts` and its test; `W/pages/GetStarted.tsx` (fold You into the restaurant step; no `mudavym:arrival-role`, see `:106`; mobile number asked when the first phone alert is turned on); `PlacesAutocomplete.test.tsx` | (t1) A pick with a phone fills the phone. On main it must be typed (`:314-315`). (t2) Country TR gives `Europe/Istanbul` whatever the browser zone is. (t3) A multi-zone country whose offset disagrees with the browser shows a one-line pick. (t4) No `sessionStorage` write of the role. (t5) No step `you`. | #656; OB-5 (same file, so sequence them) |
| **OB-8** The house leads to the desk, and the nudge tells the truth | `fix/house-leads-to-the-desk` | `W/pages/HouseContents.tsx` (the header mark links `/`; **Go to the desk**; drop the duplicate `vendor_added` write at `:26`; one next ask, *Count the shelf*); `W/guidance/components/SetupNudgeBanner.tsx` (+test; copy `:52` loses "wine list" and "threshold"; it shows while `!activated` from OB-1); `W/hooks/queries/useOnboardingProgress.ts` (types) | (t1) `/house` has a link to `/`. On main it has none (verdict G2). (t2) The nudge text has neither "threshold" nor "wine list". (t3) Saving a supplier makes one request. On main it makes two (`:25-26`). | OB-1; #656; menu 1e (HouseMenu) |
| **OB-11** Sign-up says "wait" and stops probing | `fix/register-says-wait-and-stops-probing` | `W/pages/Register.tsx` (worded 429 with `Retry-After`; no `check-email` while typing, see `:172-215`; confirm-password goes, `:799-813`, and a show/hide toggle comes); `W/lib/authWords.ts` (new); `Register.test.tsx` | (t1) A 429 renders seconds from `Retry-After`. On main it shows `err.message` (verdict G10). (t2) Typing an email makes **0** `check-email` calls. (t3) There is no confirm field. | **#691** |
| **OB-10** Strangers load only the door | `perf/strangers-load-only-the-door` | `W/App.tsx` (:64, :69-77 become lazy, except what `/` and `/register` need); `W/pages/landing/RootDoor.tsx` (:20 lazy `DashboardLayout`); `apps/web/vite.config.ts` (:48-51 drop the `ui` group); `W/main.tsx` (:23-30 start after a session exists); new `scripts/check_entry_chunk.mjs`; a manifest test | (t1) The build manifest's entry imports neither `DashboardLayout` nor `InventoryCommandPage`. (t2) No `startReminderScheduler` call without a session. (t3) A gzip budget is set from the **measured** post-lane number, not a guess. | Measure first in a clean worktree (≥30G free disk). Coordinate with #695 (Vite bump). After OB-5 (App.tsx). |
| **OB-9** The onboarding pages wear the house tokens | `fix/onboarding-wears-the-house-tokens` | GetStarted, HouseContents, HouseMenu, VerifyEmail, ChooseHouse, the `ProtectedRoute` loader (slate and brand classes at `:29-37`), `MenuScanUpload`, `MenuCsvUpload`, `MenuManualEntry`; one static test | (t1) There is no `#[0-9a-f]{6}` and no `slate-`/`gray-` class in these files. (t2) Each page renders under `.mudavym[data-ground="charcoal"]`. Browser-pane check at 390 px and 1440 px. | last web lane |

### Phase 3: reach the bar

| Lane | Branch | Files | Tests | Depends on |
|---|---|---|---|---|
| **OB-12** Sign up with a code (identity-first; one door for new and returning) | `feat/sign-up-with-a-code` (gateway PR, then web PR) | `AS` `registerAccount` (no password; for an existing address, send the sign-in code and give the same 202); `GW/auth/auth.controller.ts` (delete `check-email` at `:687-695`); `GW/passkeys/sign-in.controller.ts` (code verify creates the pending account); Register.tsx; specs | (t1) A new and an existing address get byte-identical answers. (t2) The code creates the account and marks it verified. (t3) `GET /auth/check-email` is 404. | OB-3, OB-6, OB-11 |
| **OB-13** Offer a passkey after sign-up | `feat/offer-a-passkey-after-sign-up` | GetStarted restaurant step, one optional line through `POST /passkeys/registration/options` (no house needed, `passkeys.controller.ts:76`); test | (t1) The offer shows within the ten-minute freshness window and is never preselected. (t2) Declining changes nothing. | OB-7 |
| **OB-14** The first invoice is read, not "kept" | `feat/first-invoice-is-read` | HouseContents (the invoice line posts to `POST /procurement/documents`); delete `W/lib/houseLater.ts`; `W/services/api/documents.ts`; test | (t1) The drop posts the file. On main only the filename is kept (`HouseContents.tsx:35-38`). (t2) Words lead to `/receipts`. | receipts **2.2** and Decision **7d** (spend gate) |
| **OB-15a/b/c** Delete the dead onboarding code (3 PRs, about 1.6k lines) | `chore/delete-dead-onboarding-{a,b,c}` | (a) `pages/Onboarding.tsx`, `contexts/OnboardingContext.tsx`, `GettingStartedPanel`, `StaffWelcome`, `CellarRegistersOnboarding`. (b) Register Path B step 2 (`Register.tsx:929-975`, `:994-1370`) plus `CurrencyStep`. (c) `ThresholdStep`, and the `"My Restaurant"` branch (`AuthContext.tsx:593`), keeping `/no-access` correct. `MenuReviewScreen`/`MenuImportCard` belong to menu 1e. | (t) Claims: each file is absent; `tsc` plus jest are green; mutation-proven. | (b) after #691 and OB-11 |

**Lane count: 18** (OB-1, OB-2, OB-3, OB-3b, OB-4, OB-5 to OB-11, OB-12 to OB-14, and OB-15 a/b/c), which is about 20 PRs. It runs at most 3 at a time (memory: reboot from RAM).

---

## §4 Forks, each decided by this session

Each fork gets the call, what was rejected, and one honest attempt to kill the call.

**F1. What is "activated", meaning first value?** **Call:** the house has a **current** menu with at least one line. The threshold, a vendor and a team invite are not required.
- Rejected:
  - (a) Today's menu-read plus threshold (`MS:2201`). No screen sets the threshold (verdict G8), and ADR 0213 #13 (Locked) already moved the threshold out of onboarding.
  - (b) Menu read but not current. That is G1: no inventory and no prices.
  - (c) Requiring a counted shelf. A count is a separate software (#7) and would add a second gate.
- *Kill attempt:* an owner who picks *Keep it, not current* is told forever that setup is unfinished. **Survives.** That is true, the nudge is snoozable and dismissible (verdict G8), and its one action leads straight to the choice.

**F2. Where does onboarding progress live?** **Call:** derive the house facts (menu read, menu current, a provider exists, an invite was sent) from the **session's** house at read time. The user row keeps only per-person flags (`checklist_dismissed`). A GET never writes.
- Rejected:
  - (a) Keep the stored flags and the self-heal. Menu 1g makes them more correct, but the flags still name one house per user (`user_id` UNIQUE, baseline `:8119-8120`) and can be PATCHed true by any client (`MS:2229-2233`).
  - (b) Move the row to one per (user, house). That is a migration plus a backfill of facts the house tables already hold.
- *Kill attempt:* deriving costs about 4 reads per GET, polled from every dashboard mount. **Survives.** They are four indexed reads on `restaurant_id`, against today's three reads plus a possible write. Measure p95 in the lane.

**F3. How is the email proven?** **Call:** the mail carries a **six-digit code and the link**. The tab that signed up takes the code. The link runs by itself when it opens where the person is signed in. Verification stays **before** the house.
- Rejected:
  - (a) Link only. It breaks across devices (verdict G4).
  - (b) Verify later, after the menu. Every menu read is a paid model call, so an unproven mailbox would buy free reads. ADR 0229's lapse rule assumes proof comes early.
  - (c) A magic link that signs in the device that opens it. ADR 0229 option 2 rejected it.
- *Kill attempt:* auto-running the link lets a mail scanner verify. **Survives.** Verifying needs this browser's session (fork 12, `VerifyEmail.tsx:49`), and a scanner holds none.

**F4. Is there a password at sign-up?** **Call:** no. Phase 3 brings code-first, identity-first sign-up: one door, and the same answer for new and existing addresses. In the meantime the confirm field goes and a show/hide toggle comes (OB-11).
- Rejected:
  - (a) Keep password plus confirm. It adds two fields and still needs the mailbox trip.
  - (b) Password with no confirm, kept for good. It stays an enumeration surface.
- *Kill attempt:* returning on a shared bar iPad means a mailbox trip every time. **Survives**, on three counts: sessions refresh; Google and the passkey offer (F5) cover the repeat case; and a password can still be set later. Whether reset works for an account that has no password is **unverified (§6)** and blocks OB-12.

**F5. Passkey at sign-up?** **Call:** offer it **after** the code, on the restaurant step, as one optional line. This uses the existing enrolment, which needs no house.
- Rejected:
  - (a) Passkey-first account creation. It needs a new ceremony with no proven mailbox for recovery.
  - (b) Conditional Create. Per the sota note, it does not run after a code or Google sign-in.
  - (c) None. FIDO's sign-in-success gap is the one cross-industry figure (sota).
- *Kill attempt:* it is one more thing on the busiest screen. **Survives**, because it is a single quiet line, never preselected, and declining changes nothing.

**F6. The You step and the role.** **Call:** fold You into Your restaurant (greet by name, with a *change* link). The role question goes. The mobile number is asked when a phone alert is first turned on.
- Rejected:
  - (a) Keep ADR 0213 #12's sequence (Locked). The step only re-shows a prefilled name (verdict G12).
  - (b) Store the role in `users`. Nothing reads it, and KVKK data minimisation says do not collect it.
- *Kill attempt:* ADR 0213 #12 is Locked, and the welcome moment would go. **Survives.** The welcome moves into the restaurant headline. A bracketed amendment to 0213 #9 and #12 is owed in OB-7.

**F7. What do we infer from the place?** **Call:** ask Places for the phone and `utcOffsetMinutes`.
- The zone comes from the country when the country has one zone.
- Otherwise it is the browser zone if its offset matches the place.
- Otherwise it is a one-line pick.
- The currency stays derived and shown (ADR 0213 #8).
- Rejected:
  - (a) Browser zone only, as today (`GetStarted.tsx:87`). It is wrong for an owner setting up from abroad.
  - (b) The Time Zone API. It is an extra SKU and an extra call.
- *Kill attempt:* the phone is an Enterprise-tier field, so every pick costs more. **Survives:** it is one Place Details call per house opened. The SKU price is **unverified (§6)**.

**F8. A 409 on opening the house.** **Call:** refresh the session and route by #656's entry rule: a house goes to `/house`, listed houses go to `/choose-house`.
- Rejected: ADR 0265 OPEN-2, a lane call that says the 409 is "said, not stepped past". Its option (c) was rejected only because the chooser file did not exist yet. It exists now (`App.tsx:213`).
- *Kill attempt:* staff whose `users.restaurant_id` came from an invite meet the 409 too. **Survives.** The entry rule routes by membership, not by name, which is the reason 0265 rejected (a). A bracket on 0265 is owed in OB-5.

**F9. First provider and inventory.** **Call:** the house page has **one** next ask, *Count the shelf* (the phone count was ruled on 2026-10-12, and CV counting is queued). The supplier line accepts a name **or the last invoice, which is read** through `POST /procurement/documents`. That seeds a vendor and costs the MarketMan way (sota), and it lands on `/receipts`.
- Rejected:
  - (a) "Kept for later": a filename in a tab that keeps nothing (G15).
  - (b) Make the invoice a required step. It is a paid read before any value.
  - (c) A supplier form with email and phone. It asks for what the invoice already prints.
- *Kill attempt:* ADR 0213 #10 (Locked) puts the last invoice under "Later", and a read of an unmatched paper may make a provisional vendor from the printed tax ID. **Survives.** It stays optional and under "later", and only *reading* it is new. It is gated on receipts 2.2 and the 7d spend rule.

**F10. Waiting for the menu read in onboarding.** **Call:** real progress plus "you can leave", riding menu 2c. The house page shows *Reading…* until the read is done.
- Rejected:
  - (a) Synchronous with a page cap. The founder picked background reading (MU-5).
  - (b) Keep the 1.2 s settle. It is a fixed timer that says nothing.
- *Kill attempt:* a person who leaves never comes back. **Survives.** The bell or toast (ADR 0262, own acts) and the nudge both lead back to the proof.

**F11. Landing attribution.** **Call:** an insert-only `signup_attributions` row written by the two register endpoints, with the page checked against the static `/l/*` list. Counting page views stays with OD-251's landing lane.
- Rejected:
  - (a) Third-party analytics. The founder chose a first-party table on 2026-10-31.
  - (b) A column on `users`. It is mutable and mixes concerns.
- *Kill attempt:* is it personal data? **Survives.** It records only the page and audience slugs against the person's own account, which is first-party and minimal.

**F12. The `check-email` oracle.** **Call:** stop calling it while typing (OB-11) and delete it with code-first sign-up (OB-12). Rejected: keep it with a tighter limit, which leaves the oracle in place. *Kill attempt:* people lose the early "this email already has an account" hint. **Survives.** Under OB-12 an existing address just signs in.

**F13. Auth rate limit.** **Call:** keep 10 per 60 s per route (`rate-limit.guard.ts:29`), word the 429, and fix the spoofable key (OB-3b). Rejected: loosening it for a shared NAT, since that risk is inferred and has not been observed. *Kill attempt:* staff signing up together behind one router. **Survives**, because sign-up per route needs one call per person.

**F14. House creation atomicity.** **Call:** one RPC that takes values TS computed.
- Rejected:
  - (a) Check the compensating deletes' errors. The process-death window stays open.
  - (b) A repair-on-409 heuristic. It is a guess.
- *Kill attempt:* SQL and TS drift on the slug or place-id rules (ADR 0265). **Survives**, because TS still computes every value and the SQL only inserts.

**F15. Cleanup jobs.** **Call:** no job that deletes users or rows (memory: never delete users). Stuck reads are swept to *failed* by menu 2c, and OB-1 logs counts of unverified accounts and progress rows. Rejected: a sweep that deletes unverified accounts after N days, which is prod data deletion and needs his word. *Kill attempt:* the table grows without bound. **Survives** at today's scale (one real tenant, memory).

**F16. Mobile `POST /auth/register/restaurant`** (`@Public`, live from the app, verdict G17). **Call:** leave it mounted until the mobile walk, and list it in §5. Rejected: delete it now, which breaks the app. *Kill attempt:* it opens houses without the verified-first rule. **Survives as a known gap**: a house alone buys no model spend, and every read sits behind auth.

**F17. Dead code.** **Call:** delete it in three PRs (OB-15). Rejected: delete it in one PR, which breaks the 30K limit. **Survives.**

**F18. Loading.** **Call:** lazy-load everything a stranger does not need, ungroup `ui`, and defer boot jobs. The budget comes from measurement. Rejected: guessing a KB target, since §1 rules out unmeasured numbers. *Kill attempt:* lazy auth pages add one request on `/login`. **Survives**, because those are small chunks while the dashboard is not.

**F19. Design.** **Call:** tokens only, simple people pages, ADR 0149's Mudavym-only rule. Rejected: re-sketch the flow, since #656 and menu 1e already carry the approved first-proof look. **Survives.**

**F20. The nudge.** **Call:** show it only while `!activated` (F1), lead to `/house/menu`, and keep snooze and dismiss. Rejected: delete it, because the owner who chose *Keep it, not current* needs one way back. **Survives.**

**Records owed** (written in the lanes, numbers from the guard):
- One ADR for F1, F2, F3 and F4 together, "first value is a current menu".
- One ADR for F11.
- Brackets on ADR 0213 (#9, #10, #12 and #13 as they relate to the nudge).
- A bracket on ADR 0265 (OPEN-2).

---

## §5 Integration contract with neighbouring softwares

| Neighbour | What onboarding gives it | What onboarding takes | Invariants (each a spec or a claim) |
|---|---|---|---|
| **Menu** (wf `wf_c62a904e-77e`) | A house and a person; the first read through `/menus/import` | `restaurant_menus` state; make-current through the plan fingerprint (`menus.controller.ts:243`) | I1 Onboarding never sets a menu current by itself; only the person's choice does (1e). I2 "Menu read" means ≥1 line (1c, 1g); "activated" means current (OB-1). I3 A dropped photo reaches the parser as bare base64 (1a). |
| **Inventory** | none directly | The rows make-current creates; never-counted is unknown (1l) | I4 Onboarding writes no `inventory_*` row. I5 *Count the shelf* opens the existing count flow and never a new one. |
| **Receipts / procurement** | The first invoice (OB-14) | `POST /procurement/documents` as is | I6 Onboarding never creates a vendor itself; D15 does. I7 No read happens before the spend rule 7d. |
| **Providers** | A supplier name (`addCustomProvider`) | nothing | I8 `vendor_added` is derived from `providers` rows (OB-1); the web never PATCHes it. |
| **Auth / passkeys** (ADR 0229, 0164) | none | Code issuance and verify; passkey enrolment | I9 A code verifies only the address it was mailed to. I10 Enrolment requires `auth_time` within 10 min. I11 A session with no house reaches only `/get-started`, `/choose-house` and the escape hatches. |
| **Landing** (ADR 0354, OD-251) | `signup_attributions` rows | `for` and `page` from `/l/*` | I12 Insert-only; an unknown page is dropped, never an error. |
| **Guidance / dashboard** | `activated` | none | I13 The nudge reads only `GET /onboarding/progress`; staff never see it (`SetupNudgeBanner.tsx:26`). |
| **Team** | none | `generateInvite` | I14 An invite is never required to be activated. |
| **Communications mail** | The verify and code mails | The Gmail send with SMTP fallback (`gmail.service.ts:252-270`) | I15 A failed send is said to the person (OB-3, OB-6). |
| **Mobile app** | none | `POST /auth/register/restaurant` (still mounted) | I16 Untouched until the mobile walk (F16). |

---

## §6 What stays unverified

- **Bundle and route sizes on origin/main.** The only measurement is a stale dist from 2026-08-10. OB-10 must build in a clean worktree, and disk was 13-15G free against the ≥30G rule.
- **All timings.** Step times, the house-open latency and the derive-progress p95 were read from code and never measured.
- **Production mail.** Whether Gmail OAuth or SMTP is configured in production; the prod rule forbids looking. OB-3's `not_sent` path is what makes this visible.
- **Places costs.** The Places (New) SKU price for `internationalPhoneNumber` and `utcOffsetMinutes`, and whether the web key's API restrictions allow those fields.
- **Railway's proxy hop count**, which OB-3b needs.
- **Reset for a passwordless account.** Whether password reset sets a password on an account with no password hash. This **blocks OB-12**.
- **Mail scanners.** That no scanner runs JS with a session cookie. It is reasoned from fork 12, not tested.
- **The NAT risk** (G10) is inferred.
- **The open PRs.** #656's new head still needs a fresh full gate; its content was read from its PR body, not re-audited here. Menu 1e's shape on `/house/menu` waits on MU-1 (the look). The receipts 2.2 and 7d status was taken from `proposal-receipt.md` as written.
- **The mobile register path** was not traced beyond the verdict's citations.
- **The open-PR overlap** comes from `gh pr list` at the time of writing:
  - #656 touches every onboarding web file;
  - #691 touches Register;
  - #762 and #761 touch `MS`;
  - #695 touches Vite;
  - #717 and #732 touch the landing and endpaper but none of these lanes' files.
