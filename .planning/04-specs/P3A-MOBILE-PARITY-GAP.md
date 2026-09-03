# P3.A — Mobile parity: the measured gap, and the slices built against it

> **Stage:** P3.A (ADR [0029](../decisions/0029-p3-plan-of-record.md) §1, §2 — runs alongside the
> P3.0 gate, gated on nothing).
> **Status:** measurement complete; **two slices built and verified**, and
> **OD-109 is closed — the app runs on a simulator** (§4c). What is verified,
> and the three things that are still not, are set out there.
> **Base:** `origin/main` @ `190432aa`, measured 2026-08-27 in a clean worktree.
> **Founder calls already made, not re-litigated here:** mobile ships **as-is**,
> without waiting on OD-106 (ADR 0029 §2 and Rejected alternatives); parity
> counts **all 219 features, no audience carve-outs** (OD-108), which settles
> §6 fork 1 — the fork is left below as the record of what was asked, struck
> through.
>
> **Retire-to-write (CLAUDE.md §4):** this is the first spec covering
> `apps/mobile`, so it supersedes nothing. Whether the rule owes a retirement
> anyway is the founder's call — flagged in §6, not defaulted.

---

## 0. The number

`apps/mobile` presents **20 %** of the web feature set the 47 page notes
describe. It was **9 %** when first measured and **11 %** after the first slice.

| | Measured | After slice 1 *(the live layer)* | After slice 2 *(the way in)* |
|---|---:|---:|---:|
| §1a features present (`yes`) | 7 | 11 | **28** |
| partially present (`part`) | 25 | 27 | **33** |
| absent (`no`) | 187 | 181 | **158** |
| total §1a features across 47 notes | 219 | 219 | 219 |
| weighted parity (`yes`=1, `part`=½) | 19.5 / 219 = **8.9 %** | 24.5 / 219 = **11.2 %** | 44.5 / 219 = **20.3 %** |
| routes with *any* mobile surface | 15 / 47 | 16 / 47 | **23 / 47** |

By audience. The **now** column is re-derived from the §2 census table rather
than carried forward (CLAIMS rule: numbers get re-measured, never copied). Slice
1 was owner work; slice 2 was **entirely `audience: public`**, which is why only
those two rows move.

| Audience | features | at measurement | now |
|---|---:|---:|---:|
| staff | 24 | 21 % | 21 % |
| owner | 130 | 10 % | 14 % |
| public | 31 | 3 % | **68 %** |
| dev | 34 | **0 %** | **0 %** |

The original reading was that mobile is a **staff/owner operations app** that
had never attempted the public (auth, invites, legal) or dev (studio, simpos,
admin, sandbox) surfaces. OD-108 then settled that all 219 count. Slice 2 took
the public tier at its word and built it. The dev tier is still untouched, and
at 34 features it is now the largest single block of absent features in the
census — larger than any remaining owner route.

**Method.** 47 route notes in `.planning/06-pages/`, 219 bullets across their
`## 1a. Features` sections, each judged against `apps/mobile` source read at
`190432aa`. Every `yes`/`part` in §2 is backed by a `file:line`. Three notes
(`/credits`, `/distributors`, `/services`) are redirects with zero features and
contribute nothing to the denominator.

---

## 1. What mobile actually is

Five tabs plus a stack — at measurement, 57 TS/TSX files and 7 076 lines:

| Mobile screen | File | Nearest web page |
|---|---|---|
| Today | `apps/mobile/app/(tabs)/index.tsx` | `/` dashboard |
| Cellar list / detail | `apps/mobile/app/(tabs)/cellar/index.tsx`, `[id].tsx` | `/inventory` |
| Receiving | `apps/mobile/app/(tabs)/cellar/receive/[orderId].tsx` | `/receiving/:orderId/door` + `/receipts` |
| Supply list / detail | `apps/mobile/app/(tabs)/supply/index.tsx`, `[id].tsx` | `/orders` |
| Draft approval | `apps/mobile/app/draft/[orderId].tsx` | `/orders` |
| Team | `apps/mobile/app/(tabs)/team.tsx` | `/team` + `/calendar` |
| Insights | `apps/mobile/app/(tabs)/insights.tsx` | `/reports` |
| Notifications *(new)* | `apps/mobile/app/notifications.tsx` | `/notifications` |
| Settings / Help / Get started / Wine Agent | `apps/mobile/app/settings.tsx`, `help.tsx`, `get-started.tsx`, `wine-agent.tsx` | `/settings`, `/help`, `/get-started`, `/sommelier` |
| Login / Lock | `apps/mobile/app/login.tsx`, `lock.tsx` | `/login` |
| Register *(new)* | `apps/mobile/app/register.tsx` | `/register` |
| Forgot / Reset password *(new)* | `apps/mobile/app/forgot-password.tsx`, `reset-password.tsx` | `/forgot-password`, `/reset-password` |
| Verify email *(new)* | `apps/mobile/app/verify-email.tsx` | `/verify-email` |
| Invite landing *(new)* | `apps/mobile/app/invite/[code].tsx` | `/invite/:code` |
| No access *(new)* | `apps/mobile/app/no-access.tsx` | `/no-access` |
| Privacy *(new)* | `apps/mobile/app/privacy.tsx` | `/privacy` |

The architecture is genuinely good where it exists: an offline outbox with
idempotency keys (`apps/mobile/src/state/outbox.ts`), disk-persisted react-query
(`apps/mobile/src/lib/queryClient.ts:51`), a biometric lock gate, and a
design-token system (`apps/mobile/src/design/tokens.ts`). The gap is breadth,
not quality.

---

## 2. The gap, route by route

`§1a` = feature count in the note. Counts are **current** — after both slices.

| Route | Archetype | Aud | §1a | yes | part | no | Mobile surface |
|---|---|---|---:|---:|---:|---:|---|
| `/` | canvas | owner | 7 | 2 | 3 | 2 | app/(tabs)/index.tsx |
| `/help` | document | owner | 3 | 1 | 1 | 1 | app/help.tsx |
| `/receiving/:orderId/door` | focused | staff | 3 | 1 | 1 | 1 | app/(tabs)/cellar/receive/[orderId].tsx |
| `/orders` | command | owner | 9 | 2 | 4 | 3 | app/(tabs)/supply/index.tsx, app/(tabs)/supply/[id].tsx, app/draft/[orderId].tsx |
| `/notifications` | list+detail | owner | 5 | 1 | 2 | 2 | app/notifications.tsx |
| `/get-started` | form | owner | 6 | 1 | 1 | 4 | app/get-started.tsx |
| `/login` | focused | public | 4 | **3** | 0 | **1** | app/login.tsx |
| `/inventory` | command | staff | 9 | 1 | 2 | 6 | app/(tabs)/cellar/index.tsx, app/(tabs)/cellar/[id].tsx |
| `/wines` | list+detail | owner | 7 | 1 | 1 | 5 | app/(tabs)/cellar/index.tsx (inventory, not the catalogue) |
| `/receipts` | list+detail | owner | 5 | 0 | 2 | 3 | app/(tabs)/cellar/receive/[orderId].tsx (verification only) |
| `/team` | command | staff | 8 | 0 | 3 | 5 | app/(tabs)/team.tsx |
| `/reports` | canvas | owner | 6 | 0 | 2 | 4 | app/(tabs)/insights.tsx |
| `/communications` | list+detail | owner | 5 | 0 | 1 | 4 | app/(tabs)/supply/[id].tsx (order threads only) |
| `/settings` | form | owner | 10 | 0 | 2 | 8 | app/settings.tsx |
| `/sommelier` | chat | owner | 5 | 0 | 1 | 4 | app/wine-agent.tsx (deep-links to web) |
| `/calendar` | calendar | owner | 8 | 0 | 1 | 7 | app/(tabs)/team.tsx (today + upcoming lists) |
| `/admin` | form | owner | 5 | 0 | 0 | 5 | — |
| `/admin/health` | list+detail | dev | 5 | 0 | 0 | 5 | — |
| `/authorize/:integrationId` | focused | owner | 4 | 0 | 0 | 4 | — |
| `/dev-sandbox` | dev | dev | 6 | 0 | 0 | 6 | — |
| `/documents-reports` | list+detail | owner | 3 | 0 | 0 | 3 | — |
| `/forgot-password` | focused | public | 2 | **2** | 0 | **0** | app/forgot-password.tsx |
| `/invite/:code` | focused | public | 4 | **4** | 0 | **0** | app/invite/[code].tsx |
| `/logs` | list+detail | owner | 4 | 0 | 0 | 4 | — |
| `/no-access` | focused | public | 3 | **2** | 0 | **1** | app/no-access.tsx |
| `/onboarding` | focused | owner | 3 | 0 | 0 | 3 | — |
| `/privacy` | document | public | 3 | **1** | **2** | **0** | app/privacy.tsx |
| `/profile` | form | owner | 6 | 0 | 0 | 6 | — |
| `/promotions` | list+detail | owner | 4 | 0 | 0 | 4 | — |
| `/providers` | list+detail | owner | 8 | 0 | 0 | 8 | — |
| `/receiving` | list+detail | staff | 4 | 0 | 0 | 4 | — |
| `/recommendations` | list+detail | owner | 6 | 0 | 0 | 6 | — |
| `/recommendations/catalog` | list+detail | owner | 6 | 0 | 0 | 6 | — |
| `/register` | form | public | 5 | **3** | **1** | **1** | app/register.tsx |
| `/reset-password` | focused | public | 3 | **1** | **2** | **0** | app/reset-password.tsx |
| `/simpos/:restaurantId` | dev | dev | 5 | 0 | 0 | 5 | — |
| `/simpos/:restaurantId/orders` | dev | dev | 2 | 0 | 0 | 2 | — |
| `/studio` | command | dev | 6 | 0 | 0 | 6 | — |
| `/studio/certify` | list+detail | dev | 3 | 0 | 0 | 3 | — |
| `/studio/invite/:token` | focused | dev | 5 | 0 | 0 | 5 | — |
| `/studio/queue` | list+detail | dev | 2 | 0 | 0 | 2 | — |
| `/v/:slug` | list+detail | public | 4 | 0 | 0 | 4 | — |
| `/vendor-prices` | list+detail | owner | 5 | 0 | 0 | 5 | — |
| `/verify-email` | focused | public | 3 | **2** | **1** | **0** | app/verify-email.tsx |
| `/credits` | redirect | owner | 0 | 0 | 0 | 0 | — |
| `/distributors` | redirect | owner | 0 | 0 | 0 | 0 | — |
| `/services` | redirect | owner | 0 | 0 | 0 | 0 | — |

### Per-feature detail for every route that is not fully absent

**`/`** · `PHPPNNH`

- `part` See today's KPI tiles: revenue, stock, orders, alerts
- `yes ` One-Tap Action Center: approve pending orders and low-stock reorders in one tap (with email preview)
- `part` Reminders list and a calendar strip with important dates; add your own important date
- `part` Recent activity feed and sales chart
- `no  ` Quick-actions panel; right-click context menus on cards
- `no  ` Switch between restaurants/branches
- `yes ` Live updates while the page is open (realtime calendar/inventory events)

**`/help`** · `PNH`

- `part` Contact support: email and Slack channel links
- `no  ` FAQ accordion (4 entries today)
- `yes ` Jump-off cards: Learn/tours, the Get Started guide, Services & permissions, the Wine Agent

**`/receiving/:orderId/door`** · `PHN`

- `part` Full-screen, one-handed door flow asking exactly three things: photo of the paper the driver handed over, how many boxes, was anything obviously broken
- `yes ` Works offline — submissions queue in an outbox and sync later, nothing is lost in the walk-in
- `no  ` No prices anywhere by design; the count and match happen later at a desk

**`/orders`** · `PPHNPNNPH`

- `part` See the purchase-order list with filters and per-order status through delivery (draft → approved → delivered)
- `part` Create an order: pick a vendor, build the item list, submit — then approve, edit, or cancel it
- `yes ` Book a delivered order into inventory in one step
- `no  ` AI vendor-email layer: one-tap approve an AI-drafted reply, write a manual reply, pause the AI, cancel a scheduled send
- `part` See active vendor conversation threads and open the chat/message thread drawer per conversation
- `no  ` Deal proposals extracted from vendor mail: confirm or dismiss
- `no  ` View conversation attachments (invoices, price lists)
- `part` Contextual insights rail; table export; pending-order count badge in the sidebar
- `yes ` Live updates while the page is open (realtime order events)

**`/notifications`** · `HPPNN`

- `yes ` Notification inbox: read / unread / archive / delete, mark-all-read
- `part` Stacked digests that live-update while the page is open
- `part` Detail panel, deep-linkable from the header bell straight to one notification
- `no  ` One-Tap Action Center embedded (approve orders, low-stock reorders)
- `no  ` Create a custom one-tap action (🚧 not persisted — gone on refresh)

**`/get-started`** · `PNNHNN`

- `part` **Activate** tab: import your wine list three ways — scan a photo, upload a file, or enter manually
- `no  ` Review screen for the extracted items: edit lines, add missing ones
- `no  ` One-time low-stock threshold step (skipped once configured)
- `yes ` **Use the app** tab: seven guide cards into the main surfaces + a Wine Agent explainer
- `no  ` Staff see a separate read-only welcome (no upload/threshold/invite steps)
- `no  ` Deep links open a specific tab or import method (`?tab=`, `?method=`)

**`/login`** · `HNHH`

- `yes ` Sign in with email/password
- `no  ` Sign in with Google (Gmail addresses are auto-routed to Google's chooser; 🚧 no Microsoft button though the backend supports it)
  — **the note is stale on its first half.** ADR 0024 *removed* the Gmail
  shortcut: the only `gmail` string left in `apps/web/src/pages/Login.tsx` is
  the comment at `:38-41` explaining why it went (two of ten production
  accounts were gmail addresses holding a real password and no linked Google
  account). Mobile implements what the code does — `POST /auth/sign-in-methods`
  is asked what the identity can actually use, and a provider this screen
  cannot drive is named as such instead of failing the password attempt with
  "wrong password". It has **no Google button**, which needs a native
  ID-token SDK and a new dependency. Graded `no`, not `part`: the feature as
  written is signing in with Google, and you cannot.
- `yes ` Return-to-where-you-were after signing in (`?redirect=`)
  — `safeRedirectTarget` (`apps/mobile/src/auth/deepLink.ts:196`) drops absolute
  and protocol-relative targets, so an emailed link cannot bounce a
  freshly-authenticated session off-origin
- `yes ` Links out: forgot password, create account

**`/register`** · `HPHHN`

- `yes ` **Path A "Join Your Team"**: enter an 8-character invite code (validated live as you type) and create a staff/manager account — lands straight on the dashboard
- `part` **Path B "Open a Restaurant"**: the owner account and the restaurant record are created together and it ends at email verification, but the 3-section rail, address autocomplete, phone input and cuisine picker are **not** ported — mobile collects the seven fields `RegisterRestaurantDto` actually requires and stops. Autocomplete needs a places provider mobile has no key for.
- `yes ` Live "email already in use" check while typing (debounced 500 ms against `GET /auth/check-email`)
- `yes ` Deep links pre-route the path: `?invite=CODE`, `?type=join|new`
- `no  ` 🚧 No Google sign-*up* — OAuth exists on `/login` only

**`/forgot-password`** · `HH`

- `yes ` Request a password-reset email (always answers success — deliberately enumeration-resistant)
- `yes ` Rate-limit (429) and server-error states; everything else looks like success by design
  — the rule is `forgotPasswordOutcome` (`apps/mobile/src/auth/outcomes.ts:35`),
  which also treats *no response at all* as a server error rather than a
  success: telling someone to check their mail when the request never left the
  phone sends them off to wait for nothing

**`/reset-password`** · `PHP`

- `part` Set a new password from the emailed link (min 8 chars, confirm match) — the password half is complete; **"from the emailed link" is where mobile cannot follow.** The link is minted against the web origin (`auth.service.ts:1596`). The screen takes the token from a `wineops://` deep link, or from a paste box that accepts the whole URL or the bare token. See §5 blocker 6.
- `yes ` Invalid/missing link state with "request a new link"
- `part` Success auto-redirects to sign-in — mobile shows a success card with a
  "Sign in" button instead. Navigating out from under a confirmation is a worse
  trade on a phone than in a browser tab that stays put.

**`/verify-email`** · `HPH`

- `yes ` "Check Your Email" instructions with a resend button (rate-limited to 1/min) — the cooldown is mirrored client-side rather than waiting for the 429, because a button that looks live and answers "too many requests" teaches people to mash it
- `part` With an emailed `?token`: a "Verify My Email" button that redeems it and signs you in verified — works from a `wineops://` link (redeemed without a tap: the user already tapped, in their mail client) and from the paste box. The emailed web link cannot be caught — §5 blocker 6.
- `yes ` Routes onward smartly: to Get Started, or straight to the dashboard when a menu already exists (`routeAfterVerification`, mirroring `VerifyEmail.tsx:41-43`)

**`/invite/:code`** · `HHHH`

- `yes ` Preview the invite before committing: which restaurant, which role
- `yes ` Signed out: "Sign in to accept" or "Create account to accept" (both return here — via `?redirect=/invite/CODE` and `?invite=CODE`)
- `yes ` Signed in: one-tap "Add {restaurant}" accept ("already a member" counts as success — a 409 renders as the success state, because telling a member of the restaurant they are not one would be false)
- `yes ` Expired/invalid code: a clear dead-end card pointing back to sign-in

  Reachable exactly as web is — `invite-landing.md` §2 calls it a **cold URL**
  with no in-app navigation to it. On the phone the cold URL is
  `wineops://invite/CODE`; the emailed web link (`auth.service.ts:893`) still
  opens the browser. The typed-code route into the same flow is
  `/register?type=join`, which `/no-access` links to.

**`/no-access`** · `HHN`

- `yes ` Shows your signed-in email and explains you need an owner's invite link
- `yes ` Sign out; back to sign in
- `no  ` 🚧 Nothing actually routes users here today (see §9)
  — **graded `no` because mobile deliberately does not reproduce this.**
  The bullet records a web *defect*: the route exists and nothing navigates to
  it. Mobile gives it the caller web never had — `app/(tabs)/index.tsx` sends a
  signed-in session with no `restaurantId` here instead of rendering a Today tab
  whose every query is scoped to a restaurant that does not exist. Counting
  "mobile orphans it too" as parity would be scoring a defect as a feature.

**`/privacy`** · `PPH`

- `part` Plain-language privacy notice matching what the code does: cookies, Google sign-in, connected integrations, product analytics, partner sharing
  — **rewritten against the mobile code, not ported, and that is the finding.**
  Web's notice opens by saying it matches what the code does, and it does: it
  describes cookies, `localStorage`, and what leaves *the browser*. None of
  those exist on a phone. Tokens are in the iOS Keychain / Android Keystore
  (`apps/mobile/src/state/session.ts:5-6`), the offline cache is MMKV
  (`apps/mobile/src/lib/mmkv.ts`), and there is a push token the browser never
  has (`apps/mobile/src/lib/push.ts:56`). Shipping the browser's copy would
  have been faster and would have been a false statement about where a user's
  session is stored. Mobile's version covers Google sign-in, partner sharing
  and analytics; it has no cookies or connected-integrations sections because
  the phone has neither.
- `part` "Your controls" block linking Settings and Profile — Settings is linked; there is no mobile profile screen, so the notice says where those actions live rather than linking a route that does not exist
- `yes ` Readable without an account — and readable **behind the biometric lock**, the one route `resolveAuthRedirect` lets a locked phone sit on. A legal notice that becomes unreadable behind a Face ID prompt is not a notice.

**`/inventory`** · `PPNHNNNNN`

- `part` 9-column live stock table; expand a row for detail: live vs shadow stock, par/reorder bar, velocity, busy-hours heatmap, order history, manual entry (🚧 market-price columns render "—" until price enrichment exists)
- `part` Attention rail surfacing low stock first
- `no  ` Spot counts with an offline-safe outbox (counts queue and sync when back online)
- `yes ` Receiving verification as a pinned task, not a popup — verify a delivery against its documents
- `no  ` Cellar map view of storage zones
- `no  ` Scan a menu/wine list photo to add wines
- `no  ` Add and remove wines; manage storage locations
- `no  ` Switch branches and see another branch's stock
- `no  ` Contextual insights rail (analytics engine)

**`/wines`** · `NPNNNNH`

- `no  ` Browse the master wine catalogue as your restaurant sees it: search, 9 filters, sort cycle, view modes (~500 wines)
- `part` Stock overlay from inventory; list price vs market price (🚧 market price renders "—" until enrichment data exists)
- `no  ` Add a catalogue wine into inventory
- `no  ` Vendor recommendations for the selected wine
- `no  ` Scan a menu photo to add wines; manual add modals
- `no  ` Bulk selection and column sorting
- `yes ` Live wine updates over WebSocket

**`/receipts`** · `NPPNN`

- `no  ` **Documents** tab, two lanes: needs review / verified
- `part` Select a document → its stored image beside the extracted lines for side-by-side verification; unknown values render as "—", never as a pass
- `part` Verify a document
- `no  ` **Credits** tab: the vendor credit-claim ledger with stats; move a claim through its states
- `no  ` Deep-linkable tab (`?tab=credits` — where `/credits` lands)

**`/team`** · `PPNNNNPN`

- `part` Week grid with schedule create, copy-week, publish
- `part` Shifts with callouts, cover offers, and assignment
- `no  ` Certifications; coverage-rule templates; time-off management
- `no  ` Sales ingest + per-member performance panel
- `no  ` Broadcast a message to the team; shift import/export
- `no  ` Invite team members; switch branches
- `part` See my week; acknowledge the published schedule
- `no  ` Take an open cover; request time off

**`/reports`** · `NPPNNN`

- `no  ` Notion-style dashboard canvas: drag/resize blocks with inline configuration; your layout persists per user
- `part` KPI spotlight and headline insights bar
- `part` Engine insights panel (analytics-engine output) with act / hide / pin and goals
- `no  ` Seating density panel; monthly reconciliation; period compare
- `no  ` Data tables section; AI command palette
- `no  ` Generate and export a report (lands in the `/documents-reports` archive)

**`/communications`** · `NPNNN`

- `no  ` **Templates** tab: build Gmail and SMS templates; save and reuse them (🚧 saved client-side, not cross-device)
- `part` **Send History** tab: browse classified vendor conversation threads; regenerate a thread's AI summary
- `no  ` **Scheduled Reports** tab: create, list and delete recurring report schedules (🚧 the send itself is feature-flagged off server-side — no mailer)
- `no  ` **Procurement History** tab: audit trail of outbound procurement emails, labelled by type
- `no  ` Filter by channel: all / email / SMS

**`/settings`** · `NPNPNNNNNN`

- `no  ` **Team**: members and invites — change roles, remove members, revoke invites, invite dialog; labor & goals settings
- `part` **Services**: service permissions / access grants (email, web, privacy)
- `no  ` **Email**: sender identity settings
- `part` **Notifications**: channel and batching preferences
- `no  ` **Locations**: multi-location chains — create, assign, edit
- `no  ` **Measurement**: units
- `no  ` **Map**: storage map
- `no  ` **Features**: per-restaurant feature flags
- `no  ` **POS**: connect a POS provider, see connection status
- `no  ` **Calendar**: iCal subscribe URL + regenerate token

**`/sommelier`** · `PNNNN`

- `part` Chat about pairings, pricing, reorders and staff coaching
- `no  ` Three personas: Sommelier / Buyer / Floor training (persisted per device)
- `no  ` Answers are wine-context aware (your first 50 wines are sent along)
- `no  ` Conversations persist per user; "Ask AI" from other pages prefills a prompt here
- `no  ` 🚧 The chat backend route is unregistered — today every message falls back to a local rules answer (§9)

**`/calendar`** · `PNNNNNNN`

- `part` See deliveries, tastings and vendor meetings in Month / Week / Day / Agenda views
- `no  ` Drag to move or resize an event; click an empty slot to create one
- `no  ` Full event editing with recurring events (RRULE)
- `no  ` Create and manage custom event types (server-backed)
- `no  ` Multi-channel reminders per event
- `no  ` Capture a meeting memo after a meeting
- `no  ` Link events to vendors
- `no  ` "Add calendar event" from the command palette deep-links straight into the create modal

---

## 3. Four defects found by measuring (all pre-existing, all in `apps/mobile`)

These were not in the plan. They were found because the docs claimed live
updates and the code did not deliver them.

1. **The whole realtime layer was dead code.** `connectSocket`
   (`apps/mobile/src/lib/socket.ts:15` at `190432aa`) had **no caller anywhere
   in the app**. `socket.io-client` shipped as a dependency, the client was
   fully written, and nothing ever invoked it. Mobile ran entirely on
   react-query polling — 60 s for the feed, 5 min for the pulse — plus an
   invalidate-everything on foreground.
2. **It also had the wrong namespace.** It connected to `io(SOCKET_URL)`, the
   bare origin. The gateway declares `namespace: "/ws"`
   (`apps/api-gateway/src/websocket/websocket.gateway.ts:161`); the web client
   gets this right at `apps/web/src/lib/websocket.tsx:394`. So even if it had
   been called, it would have joined the default `/` namespace, where nothing is
   ever emitted.
3. **Two of its three event subscriptions named events that do not exist.** It
   listened for `order:updated` and `order_change`. The gateway's only emit
   sites are `websocket.gateway.ts:366-519`, and the real names are
   `order:created` and `order:status_changed`. Only `notification:new` was
   correct — and it was on a socket that was never opened, in a namespace that
   emits nothing.
4. **Push notification taps went nowhere.** `attachPushListeners`
   (`apps/mobile/src/lib/push.ts:89`) and `routeForNotification`
   (`:78`) had no callers either — `push.ts` was imported only by
   `app/settings.tsx`, purely for the register/unregister toggle. Tapping a push
   banner opened the app to wherever it had been left. Cold-start taps
   (`getLastNotificationResponseAsync`) were not handled at all.

**One more, and the first version of this paragraph was wrong — corrected
2026-08-27.** It said `apps/mobile` appears nowhere in
`.github/workflows/ci.yml` and that nothing typechecks it on a PR. The first
half is literally true and the conclusion is not: the package name does not
appear in the workflow, but **turbo reaches it anyway.** `turbo run typecheck
--dry=json` lists `@wineops/mobile`, and CI's *Lint TypeScript* job runs
`pnpm run type-check` → `turbo run typecheck`. Mobile has been typechecked on
every PR.

**The real defect is narrower and worse.** `apps/mobile`'s test script was

    "test": "echo \"(no mobile unit tests configured)\" && exit 0"

turbo ran it on every CI run and it reported success **by construction**. The
package was not missing from the board — it was on the board, green, and
exercising nothing. That is the repo's signature shape again: machinery that
cannot report failure. Three of the four defects above are an export with no
importer, which a typecheck genuinely cannot catch and only a test would have.

Closed by `scripts/check_test_scripts_are_real.py`, which fails any declared
`test` script that only echoes and exits — proven against this branch's parent,
where it names `apps/mobile` and exits 1.

**A fifth, found the same way in slice 2 and recorded in §4b:** the router
bounced every signed-out session that was not literally on `login`, so any new
public screen would have mounted and been replaced on the same frame. Same
shape as the first four — something that exists and is never reached — and,
like them, invisible to a typecheck. It is now a pure function with 29 tests,
and one of those tests reads `app/_layout.tsx` to check the old inline version
has not grown back.

---

## 4. Slice 1 — the live layer: what was built, and how it was verified

The slice: **make the live layer real, and give a notification somewhere to land.**

Chosen over adding more screens because it is the one change that makes the
*existing* feature set behave as the page notes already claim, needs no new
gateway endpoint, and is small enough to finish and prove.

| Change | File |
|---|---|
| Event contract extracted, pure and testable | `apps/mobile/src/lib/socketEvents.ts` *(new)* |
| Socket connects to `/ws`, subscribes to all 10 real gateway events, maps each to the caches it invalidates, exposes connection state | `apps/mobile/src/lib/socket.ts` |
| Socket opens on `signedIn` + token, closes on lock/sign-out, re-handshakes on token refresh | `apps/mobile/app/_layout.tsx` (`useLiveChannel`) |
| Push taps deep-link, including cold start | `apps/mobile/app/_layout.tsx` (`usePushRouting`), `apps/mobile/src/lib/push.ts` |
| One route resolver shared by the push banner and the inbox | `apps/mobile/src/lib/notificationRoute.ts` *(new)* |
| Notification inbox: unread/read/archived tabs, expand-to-detail, open / mark read / mark unread / archive / delete / mark-all-read | `apps/mobile/app/notifications.tsx` *(new)* |
| Inbox queries + mutations against the existing gateway controller | `apps/mobile/src/api/queries.ts`, `src/api/types.ts` |
| Bell with unread badge in the Today header | `apps/mobile/app/(tabs)/index.tsx` |
| Real test runner — `"test"` was `echo … && exit 0`, which turbo counted as a pass | `apps/mobile/jest.config.js` *(new)*, `package.json` |

No gateway, web, service, package or migration file was touched. Every endpoint
the inbox uses already existed:
`apps/api-gateway/src/notifications/notifications.controller.ts:84, 117, 189, 203, 216, 229, 263`.

**One hazard worth naming for the next person touching mobile's deps.** The test
runner needs `@types/node`, and installing it *unpinned* (`^26.4.0`) re-resolved
`@types/node` across the whole workspace: 291 lines of `pnpm-lock.yaml` churn
moving `apps/web`, `packages/ui`, turbo, vite, vitest and storybook from
`20.19.27` to `26.4.0` — packages this session is not allowed to affect. Pinning
it to `20.19.27`, the version already in the tree, reduces the lockfile diff to
**12 lines, entirely inside the `apps/mobile` importer block**. `pnpm add -D` in
one workspace package is not a local operation in this repo.

### Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` in `apps/mobile` | clean (also clean at baseline, so this is a no-regression check) |
| `npx jest` | **37 tests, 2 suites, all pass** |
| Guard proven against the pre-fix code | re-introduced the phantom `order:updated` name and the missing `/ws` suffix → **5 of 9 socket tests fail**, naming both defects. Restored; green again. |
| `npx expo export --platform ios` | succeeds — 5.67 MB Hermes bundle, every new module resolves and compiles through Metro |
| New code reaches the shipped bundle | `strings` on the `.hbc` finds `Nothing needs you`, `Mark all read`, `order:status_changed`, `conversation:summary_updated`, `calendar:event_updated`, `stock:low`, `/cellar/receive/` |

The socket test is not a unit test of a constant — it **reads
`websocket.gateway.ts` and parses its `emitToRoom` call sites**, so the next
server-side rename fails the mobile build instead of silently muting the phone,
which is precisely how `order:updated` survived.

### Not verified by slice 1: the iOS simulator

> **Superseded by §4c**, where the app is finally run. The record below is kept
> because the *reasoning* — that a build is not a render — is the standard this
> document holds itself to, and because three of the four obstacles it names
> turned out to be wrong while the one that actually blocked it is not listed
> here at all.

**Slice 1 did not run this on a simulator, and nothing below implies it did.** ADR 0029
§5 says P3.A closes when the app is *"verified on a simulator, not asserted"* —
that criterion is **not met by this session**, and the reason is environmental:

- `apps/mobile` is a managed Expo project with no `ios/` directory, so
  `xcodebuild` has no project to build.
- Generating one needs `npx expo prebuild`, which needs CocoaPods. `pod` is not
  installed on this machine and the system Ruby is 2.6.10 — below CocoaPods'
  minimum.
- Expo Go is not a substitute: the app depends on `react-native-mmkv`,
  `@shopify/react-native-skia` and Reanimated 4 with `newArchEnabled`, none of
  which Expo Go carries.
- `expo prebuild` would also write an untracked `ios/` tree into the repo —
  `apps/mobile/.gitignore` does not exclude it — which is well outside this
  session's brief.

The `expo export` bundle is the strongest evidence available without that
toolchain: it proves the app *builds*, not that it *renders*. Whoever next picks
up P3.A should install CocoaPods and take the screenshot.

---

## 4b. Slice 2 — the way in: what was built, and how it was verified

The slice: **everything that happens before you are inside the app.** Eight
routes, all `audience: public` — `/register`, `/forgot-password`,
`/reset-password`, `/verify-email`, `/invite/:code`, `/no-access`, `/privacy`,
and the three missing quarters of `/login`.

### Why this slice and not an operational one

31 routes had no mobile surface at all. The candidates worth arguing about were
`/receiving` (staff, 4 features), `/recommendations` (owner, 6) and
`/providers` (owner, 8) — all more obviously "the product" than a password
reset. The public cluster won on four counts:

1. **It is a functional hole, not an accounting one.** Before this, the phone
   could sign you in and nothing else. Forget your password and the app was a
   dead end — there was no route to `/forgot-password` because the screen did
   not exist, and no way to reach it if it had. Get invited to a restaurant and
   there was no way to accept on the device the invite arrived on. For an app
   whose §1a-heaviest audience is *staff*, who are invited rather than
   self-serve, that is the first mile missing.
2. **Every endpoint already existed.** `join`, `register/restaurant`,
   `request-password-reset`, `reset-password`, `verify-email`,
   `resend-verification`, `invite/:code`, `invite/:code/accept`,
   `check-email`, `sign-in-methods` — all of them, already shipped. This slice
   needed **no** gateway change, which matters when the gateway is out of
   bounds.
3. **It is provable without a device.** Auth is mostly rules — what a valid
   invite code is, which statuses may not change the answer, which redirect
   targets are safe, which screen a session may sit on. Those are pure
   functions, and pure functions can be made to fail on demand (see the
   mutation table below). A `/providers` list is mostly rendering, which is
   exactly what this environment could not prove until the last hour.
4. **It touches nothing another session is holding.** Seven of the eight files
   are new, and the three edits are additive. `apps/mobile` was the only tree
   opened.

### The defect this uncovered before anything was built

`app/_layout.tsx` said:

    if (status === "signedOut" && segments[0] !== "login")
      router.replace("/login");

Every route except `login` was **unreachable while signed out**. A new
`/register` screen would have mounted and been replaced on the same frame,
forever, and nothing in the build could have said so — it typechecks, it
renders, it is simply never seen. That is the same shape as three of the four
defects §3 found by measuring: a thing that exists and is never reached.

The rule now lives in `apps/mobile/src/auth/routes.ts` as
`resolveAuthRedirect(status, segments)`, a pure function with 29 tests, and
`routes.test.ts` reads `_layout.tsx` itself to check the hand-rolled version has
not grown back.

### What was built

| Change | File |
|---|---|
| Public-route policy and the redirect state machine | `apps/mobile/src/auth/routes.ts` *(new)* |
| Invite-code charset, normalisation and error copy, mirrored from the mint | `apps/mobile/src/auth/inviteCode.ts` *(new)* |
| Email / password / confirmation / reset-token validation, mirrored from the DTOs | `apps/mobile/src/auth/credentials.ts` *(new)* |
| Link parsing for the paste boxes, path-matched not host-matched; `?redirect=` sanitised against open redirects | `apps/mobile/src/auth/deepLink.ts` *(new)* |
| Enumeration-safe outcomes, offline-aware error copy, post-auth routing | `apps/mobile/src/auth/outcomes.ts` *(new)* |
| The `/auth` endpoint table, import-free so a guard can read it | `apps/mobile/src/api/authEndpoints.ts` *(new)* |
| The `/auth` call wrappers | `apps/mobile/src/api/auth.ts` *(new)* |
| Shared auth chrome — shell, field, button, link, notice | `apps/mobile/src/components/auth/AuthShell.tsx` *(new)* |
| A guard against the repo's signature defect: no runtime export in the auth modules may go uncalled | `apps/mobile/src/auth/__tests__/noOrphanExports.test.ts` *(new)* |
| Post-auth landing target, handed from the screen to the layout so the two cannot race for the same transition | `apps/mobile/src/auth/pendingRoute.ts` *(new)* |
| Register: Path A join-by-code with live preview, Path B open-a-restaurant, live email check, `?invite=`/`?type=` deep links | `apps/mobile/app/register.tsx` *(new)* |
| Forgot password: enumeration-safe request, 429 and server-error states | `apps/mobile/app/forgot-password.tsx` *(new)* |
| Reset password: token from deep link or paste, strength hint, single-use warning, "request a new link" | `apps/mobile/app/reset-password.tsx` *(new)* |
| Verify email: auto-redeem from a link, paste box, resend with a mirrored 60 s cooldown, smart onward routing | `apps/mobile/app/verify-email.tsx` *(new)* |
| Invite landing: preview, signed-out and signed-in accept paths, dead-end card | `apps/mobile/app/invite/[code].tsx` *(new)* |
| No access: the orphan web never routed to, given a caller | `apps/mobile/app/no-access.tsx` *(new)* |
| Privacy: rewritten against the mobile code, readable behind the lock | `apps/mobile/app/privacy.tsx` *(new)* |
| Login: `?redirect=` return-to, links out, identity-first resolve | `apps/mobile/app/login.tsx` |
| Router delegates to the tested policy; the eight routes registered; a note on why deep links are *not* handled here | `apps/mobile/app/_layout.tsx` |
| `adoptTokens` / `refreshUser` / `emailVerified` — the phone could sign in but never sign *up*, because nothing could accept a token pair it did not fetch from `/auth/login` | `apps/mobile/src/state/session.ts` |
| A session with no restaurant lands on `/no-access` instead of an empty Today tab | `apps/mobile/app/(tabs)/index.tsx` |
| `ios/` and `android/` ignored — this is a CNG project and native trees are build output | `apps/mobile/.gitignore` |

No gateway, web, service, package, migration, script or CI file was touched.

### Verification

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` in `apps/mobile` | clean |
| Unit tests | `npx jest` in `apps/mobile` | **221 tests, 9 suites, all pass** — 184 of them new |
| Every guard fails on its own defect | mutation run, 13 mutations, table below | **13/13 caught**, tree restored green |
| §0 re-derived from §2 | census table re-summed and cross-checked | 47 rows, 23 detail blocks, all agreeing |
| Metro can bundle all of it | `npx expo export --platform ios` | succeeds — 5.73 MB Hermes bundle |
| The new screens reach that bundle | strings scan of the `.hbc` | 22/22 found |
| Every new screen renders on a device | built, installed and screenshotted on an iPhone 17 Pro simulator (iOS 26.5) | **8/8 render** — see §4c |

Per-suite: `authContract` 44, `routes` 41, `outcomes` 31, `deepLink` 22,
`credentials` 18, `inviteCode` 17, `noOrphanExports` 11 — plus the 37 from
slice 1.

The bundle scan is worth one note for whoever repeats it: Hermes stores a string
literal as UTF-8 only while it is pure ASCII, and switches to UTF-16 the moment
it contains anything else. `strings` on the `.hbc` therefore *cannot* find any
copy containing an em dash — which looks exactly like a missing screen. The
check searches for both encodings.

**The mutation run is the part that matters.** A test written alongside the code
it tests has never been observed failing. Each of these reintroduces one real
defect, runs the suite, and restores:

| Defect reintroduced | Caught by |
|---|---|
| the hand-rolled `segments[0] !== "login"` check | `routes › has no hand-rolled segment check left in the layout` |
| `app/register.tsx` deleted — a public route with no screen | `every public route has a screen › /register resolves to a file` |
| `/privacy` no longer registered as a `Stack.Screen` | `routes › registers every public route as a Stack.Screen` |
| `/login` navigating on success again, racing the layout | `routes › is the only thing that navigates on a successful sign-in` |
| `POST /auth/join` mis-named `POST /auth/register/join` | `every /auth endpoint the phone calls exists on the gateway › join`, plus both table-drift tests |
| invite charset widened to include `I O 0 1` | four `inviteCodeError › explains that X is never in a code` tests |
| client password minimum drifted to 6 | `passwordError › mirrors the server minimum`, `validation constants › keeps the password minimum in step with every auth DTO` |
| `/forgot-password` leaks account existence (404 renders differently) | `forgotPasswordOutcome › shows success for 404 so the screen cannot leak whether the account exists` |
| `?redirect=//evil.example` accepted | `safeRedirectTarget › drops a protocol-relative URL` |
| reset token no longer shape-checked before being spent | three `reset token` / `resetTokenFromPaste` tests |
| the landing target ignored, so `?redirect=` silently lands on the dashboard | `landing somewhere other than home › honours the target a screen left behind` |
| an exported helper re-added with no caller | `no orphan exports › src/auth/deepLink.ts` |
| an allowlist entry excusing a name that no longer exists | `no orphan exports › every allowlisted name still exists somewhere it is allowed` |

Two guards are worth keeping past this slice.

**`authContract.test.ts`** reads `apps/api-gateway/src/auth/auth.controller.ts`,
`auth.service.ts` and three DTOs and asserts: every path the phone calls is
declared there; every path the wrappers request is declared in the table (so the
table cannot become decoration); the seven pre-sign-in endpoints still carry no
`JwtAuthGuard`; `resend-verification` still carries `@AllowUnverified`; and the
invite charset, the code length, the password minimum and the reset-token UUID
rule all still match. A server-side rename now fails the mobile build instead of
404-ing account recovery for someone who is locked out — which is precisely how
`order:updated` survived.

**`noOrphanExports.test.ts`** is §3's defect class made mechanical. Every
runtime export from the seven auth modules must be called from outside its own
module, or be named in one of two allowlists — *pinned by a guard* (constants a
test compares against the gateway) or *internal but tested* — each entry
carrying a written reason, with a further test that fails when an allowlist
entry outlives the thing it excuses. It is scoped to this milestone's modules
rather than the whole app on purpose: a repo-wide version needs a real dead-code
tool, and a guard nobody can keep green gets deleted. **It caught something
real in this session** — see below.

### The dead code this session wrote, and deleted

`routeForAuthLink` was written, tested fifteen ways, and wired into a `Linking`
listener in `app/_layout.tsx` to handle `wineops://` deep links.

It was redundant. expo-router installs its own `getInitialURL` and URL
subscription into the navigation container's linking config
(`expo-router/build/getLinkingConfig.js:52-68`) and resolves incoming URLs
against the file route tree — so a second handler pushed every screen twice.
Removing the duplicate left the function with no caller anywhere, at which point
it was the fourth instance of the exact defect §3 is about, written by the
session that was documenting §3.

It came out. `parseLink` and the three paste helpers that use it stayed,
because those have real callers. The guard that would have caught it went in.

**And one race, closed the same way.** `/login` honoured `?redirect=` by
navigating on success — while `useAuthRouting` was firing on the *same* session
transition and sending a signed-in session off the sign-in screen to `/`.
Whichever ran second won. React 18's automatic batching probably makes the
screen win, and "probably" is not a thing to ship a return-to-where-you-were
feature on: the failure is silent, and lands you on the dashboard instead of
the order you were opening. The screens now leave a target in
`pendingRoute.ts` and the layout — the one thing that moves the app between
auth states — reads it. `routes.test.ts` reads both screens to check neither
navigates in its success path.

### What was deliberately left out

Named, not smuggled:

- **The Google button.** `POST /auth/oauth/google` wants a Google ID token,
  which on a device means a native sign-in SDK and a new dependency with a
  native surface this environment could not have verified. `/login` bullet 2
  stays `no`.
- **Path B's rail form.** Address autocomplete needs a places provider mobile
  has no key for; the phone input and cuisine picker are optional DTO fields.
  Mobile collects the seven required fields. `/register` bullet 2 is `part`.
- **A `/profile` screen**, which `/privacy`'s "Your controls" block wants to
  link. `/profile` is a separate 6-feature route and belongs to its own slice.
- **Universal Links.** See §5 blocker 6 — the server half is out of bounds.
- **Everything operational.** `/receiving`, `/recommendations`, `/providers`,
  `/promotions`, `/logs`, `/vendor-prices` and the whole `dev` tier are
  untouched. The dev tier — 34 features at 0 % — is now the largest single
  block of absent features in the census.


---

## 4c. The simulator — OD-109 is closed

ADR 0029 §5 says P3.A closes when the app is *"verified on a simulator, not
asserted."* OD-109 recorded that the app **had never been run**. It has now.

**It runs.** Built from the generated Xcode project, installed on an iPhone 17
Pro simulator (iOS 26.5), launched, and screenshotted — the login screen renders
with the three things this slice added to it: *Forgot password?*, *No account
yet? / Create one now*, and *Privacy*.

All eight new screens were captured individually: `/register` (both paths),
`/forgot-password`, `/reset-password`, `/verify-email`, `/invite/:code`,
`/no-access`, `/privacy`. Every one mounts and renders its real content, not a
skeleton.

One of those screenshots is better evidence than the rest. `/invite/ABCD2345`
was captured with no gateway running locally, and it shows the **offline** copy:
*"Couldn't reach WineOps. Check your connection and try again."* That is
`describeAuthFailure(null)` (`src/auth/outcomes.ts:60`) — the branch that
distinguishes "no response at all" from "the server said no" — firing on a real
device against a real dead socket, not in a unit test.

### What slice 1 got wrong, and what actually blocked it

| Slice 1 said | What happened |
|---|---|
| "`pod` is not installed and the system Ruby is 2.6.10 — below CocoaPods' minimum" | True about the *system* Ruby, and irrelevant. `brew install cocoapods` brings its own Ruby: CocoaPods **1.17.0** installed cleanly and never touched Ruby 2.6.10. |
| "`apps/mobile` is a managed Expo project with no `ios/`, so `xcodebuild` has no project to build" | `npx expo prebuild --platform ios` generated one and `pod install` completed. Slow — CocoaPods git-clones `ZXingObjC` for `expo-camera`, which stalled once and needed a retry — but not an obstacle. |
| "`expo prebuild` would write an untracked `ios/` tree — `.gitignore` does not exclude it" | True, and a two-line fix rather than an obstacle. `ios/` and `android/` are now ignored with a comment saying why: this is a CNG project and the native trees are **build output**, regenerated from `app.json`. Committing them would create a second source of truth that silently drifts. |
| "Expo Go is not a substitute (MMKV, Skia, Reanimated 4, `newArchEnabled`)" | Still true, and now moot — a prebuilt project does not need Expo Go. |

**The real blocker was somewhere nobody had looked: the SDK and the simulator
runtime were different versions.** Xcode 26.6 ships iOS SDK **26.5**; the only
installed runtime was **26.2**. `xcodebuild -showdestinations` answered with *no
eligible destinations at all* — not "wrong version", none — plus one ineligible
line reading `iOS 26.5 is not installed`. Three destination spellings failed
identically (`name:iPhone 17 Pro` where `OS:latest` resolves to 26.5, the booted
device's UDID, and `generic/platform=iOS Simulator`), and so did pinning
`OS=26.2`. `xcodebuild -downloadPlatform iOS` — about 40 minutes and ~9 GB —
fixed it, and the 26.5 simulators appeared immediately.

### Reproducing it

```
brew install cocoapods                       # brings its own Ruby
cd apps/mobile && npx expo prebuild --platform ios
xcodebuild -downloadPlatform iOS             # only if -showdestinations is empty
xcrun simctl boot 'iPhone 17 Pro'            # pick the newest-runtime one
cd ios && xcodebuild -workspace WineOps.xcworkspace -scheme WineOps \
  -configuration Debug -destination 'id=<UDID>' -derivedDataPath ./build/DD build
xcrun simctl install <UDID> ios/build/DD/Build/Products/Debug-iphonesimulator/WineOps.app
cd .. && npx expo start                      # a Debug build fetches JS from Metro
xcrun simctl launch <UDID> ai.wineops.mobile
xcrun simctl io <UDID> screenshot shot.png
```

### Three things worth knowing before anyone repeats it

1. **`expo start` edits `tsconfig.json` behind you, and the edit breaks the
   build.** It appends `"extends": "expo/tsconfig.base"`, whose `module` value
   this repo's pinned TypeScript **5.3.3** rejects outright:

       expo/tsconfig.base.json(10,15): error TS6046: Argument for '--module'
       option must be: 'none', 'commonjs', ... 'node16', 'nodenext'.

   `npx tsc --noEmit` goes from clean to failing, and CI's *Lint TypeScript* job
   runs exactly that through turbo. Anyone who runs the app locally and commits
   without checking `git status` breaks the build for everyone. It was reverted
   here; the tree is clean.

2. **`simctl openurl` is not a way to test deep links unattended.** iOS shows an
   *"Open in WineOps?"* confirmation for a custom scheme with no source app, and
   nothing in `simctl` can tap it. Worse, the alert survives
   `terminate`+`launch` and silently blocks every later screenshot — it took an
   `erase` to clear. The alert does prove the OS routes the scheme to the app;
   it does not prove what the app does next.

3. **The screens were reached by pointing the router at them, not by tapping.**
   The iOS-Simulator MCP tool needs `sudo xcode-select -s
   /Applications/Xcode.app/Contents/Developer`, which this session could not
   run. So each capture temporarily changed the signed-out redirect target in
   `src/auth/routes.ts`, relaunched the app to re-fetch the bundle from Metro,
   and shot the screen; the file was restored byte-for-byte and re-verified at
   the end. **This proves each screen mounts and renders. It does not prove the
   taps between them** — that a *user* going login → "Forgot password?" →
   "I have the code" lands where intended. That is the next honest increment.

### What is still not proven

- **Any flow that needs a live gateway.** Nothing was signed in, registered,
  reset or verified end-to-end; the local API was not running. Every screen's
  *shape* is verified and every screen's *rules* are unit-tested, but no request
  in this slice has been observed getting a 2xx.
- **Universal Links**, which cannot be tested at all until the server-side file
  exists (§5.6).
- **Android**, which was never built.


---

## 5. Blockers found — things mobile parity needs that do not exist

Recorded, **not** built (they are outside `apps/mobile/**`).

1. **Digest stacking has no wire field.** `/notifications` §1a asks for "stacked
   digests". The gateway writes `group_key`
   (`apps/api-gateway/src/notifications/notifications.service.ts:660`) but
   `mapNotificationRow` (`:731`) does not return it, so no client can group. Web
   has the same limitation. One line in the mapper; a gateway change.
2. **Mobile's receiving screen contradicts the door-flow spec.**
   `/receiving/:orderId/door` §1a says *"No prices anywhere by design; the count
   and match happen later at a desk."* `apps/mobile/app/(tabs)/cellar/receive/[orderId].tsx`
   shows unit prices, invoice-vs-PO price deltas and a price-override reason
   (`:41, :60-67, :88-91, :409`). Mobile built the **desk** flow and routed the
   staff door flow to it. Either the note or the screen is wrong; it is a
   product call, not a bug fix.
3. **No branch switching anywhere in mobile.** `/`, `/inventory`, `/team`,
   `/promotions` all list multi-branch switching. `useSession`
   (`apps/mobile/src/state/session.ts:50`) holds exactly one `restaurantId`, set
   from `/auth/me`. Every multi-location feature is blocked on this.
4. **`/sommelier` cannot be ported.** Its own note records the chat backend
   route as unregistered — mobile deep-links to the web page
   (`apps/mobile/app/wine-agent.tsx:74`) because there is nothing to call. This
   is P3.C territory, behind the P3.0 gate.
5. ~~**`apps/mobile` is absent from CI.**~~ **Corrected 2026-08-27 — it is
   not.** turbo covers it for both `typecheck` and `test`. What was absent was a
   test script that could fail; see §3. Guarded now.

6. **Every auth link the gateway mints points at the web app, and the phone
   cannot catch it.** `auth.service.ts` builds the verification link, the
   password-reset link and the invite link against `FRONTEND_URL` (`:705`,
   `:1596`, `:893`). Tapping one on a phone opens a browser, not WineOps.
   Fixing it needs **both** halves of Universal Links: an `associatedDomains`
   entry in `apps/mobile/app.json` — inside this session's bounds — and an
   `apple-app-site-association` file served from the web origin, which is not.
   Half of a Universal Link is worse than none: the entitlement without the
   server file makes iOS silently fall back to the browser while the app
   *claims* the domain.

   Recorded, not built. Every affected screen has a paste box in the meantime,
   which is why `/reset-password` bullet 1 and `/verify-email` bullet 2 are
   `part` rather than `yes`. The three routes are otherwise complete, so this
   single server-side file is worth **two `part`→`yes` upgrades** and is the
   cheapest remaining parity point in the census.

7. **Mobile has a telemetry surface that does nothing.** `trackGuidance`
   (`apps/mobile/src/guidance/analytics.ts:15-21`) types twelve event names and
   then `console.debug`s them in development and discards them otherwise. It is
   called from four places. This is *not* a defect — shipping no telemetry is a
   defensible default and `/privacy` now states it as fact — but it is an
   export with a body that cannot fail, which is the shape §3 is about. Whoever
   turns analytics on should notice that the call sites already exist.

8. **`switch-restaurant` exists, so blocker 3 is narrower than it reads.**
   `POST /auth/switch-restaurant` (`auth.controller.ts:444`) re-issues a JWT
   scoped to another restaurant and validates organisation membership. Branch
   switching on mobile is therefore **not** blocked on a missing endpoint — it
   is blocked on `useSession` holding a single `restaurantId`
   (`apps/mobile/src/state/session.ts`) and on there being no restaurant list to
   choose from. That is mobile-side work, not a gateway blocker. Blocker 3
   above should be read as "unbuilt", not "impossible".

9. **`main` is red, and it is not this branch.** Found while watching this
   PR's checks. `f05a7ddc` (PR #137) committed
   **`apps/api-gateway/node_modules` as a symlink**, mode `120000`, pointing at
   an absolute path on one laptop:

       /Users/aldemirkonuk/Projects/restaurant-ai-automation/apps/api-gateway/node_modules

   On a runner that path does not exist, so the symlink is dangling and
   `pnpm install --frozen-lockfile` dies:

       ENOENT: no such file or directory,
       mkdir '.../apps/api-gateway/node_modules'

   Two jobs are down — **Lint TypeScript** and **Gateway dependency graph
   resolves** — on `main` itself (run `33073240417`, job `98520646221`) and on
   every branch that merges with it, including this one. Reproduced identically
   on a re-run, so it is not a flake.

   **Why `.gitignore` did not stop it:** the root pattern is `node_modules/`,
   with a trailing slash, which matches **directories only**. A *symlink* named
   `node_modules` is not a directory, so the pattern never applied — and once
   the path is tracked, `.gitignore` is irrelevant anyway.

   The fix is two lines and lives in `apps/api-gateway/**` and the root
   `.gitignore`, both outside this session's bounds, so it is recorded rather
   than made:

       git rm --cached apps/api-gateway/node_modules
       # and drop the trailing slash in .gitignore so a symlink is caught too:
       #   node_modules/   ->   node_modules

   This is the shared-checkout hazard landing for real: a session staged a path
   in the main working copy while `node_modules` happened to be a symlink
   there. Committing with explicit paths would not have saved it either — the
   path *was* explicit. Only the `.gitignore` shape would have.

10. **`expo start` edits `apps/mobile/tsconfig.json` and the edit breaks the
    build.** Running the app locally — which is now the *recommended* thing to
    do — appends `"extends": "expo/tsconfig.base"`. That base config sets a
    `module` value this repo's pinned TypeScript **5.3.3** rejects:

        expo/tsconfig.base.json(10,15): error TS6046: Argument for '--module'
        option must be: 'none', 'commonjs', ... 'node16', 'nodenext'.

    `npx tsc --noEmit` goes from clean to failing, and CI's *Lint TypeScript*
    job runs exactly that through turbo. So the first person to follow §4c's
    reproduction steps and commit without reading `git status` breaks the build
    for everyone, with a diff that looks like housekeeping.

    Reverted in this session; the tree is clean. The durable fixes are to raise
    `apps/mobile`'s TypeScript past 5.3.3 so the extends is harmless, or to make
    the file read-only to Expo's config writer. Both are `apps/mobile` work and
    would fit a later slice — this is recorded rather than done because it is a
    dependency bump, not a parity feature, and bumping TypeScript in one
    workspace package is not a local operation in this repo (see §4's `@types/node`
    note for the same lesson learned the expensive way).

---

## 6. Forks for the founder — surfaced, not defaulted

Per CLAUDE.md §0.1 these are **not** decided here. None has a register row yet;
filing them would collide with the session that owns `OPEN-DECISIONS.md`.

**Fork 1 has since been answered: OD-108, all 219 features, no carve-outs.** It
is struck through rather than deleted, because the recommendation it made was
*rejected* and that is worth keeping visible. Fork 2 is still open, and slice 2
took the conservative side of it without deciding it — no feature below is
graded `yes` on the strength of a web deep-link.

1. ~~**What does "parity" mean for the dev and public tiers?**~~ **Answered by
   OD-108: all 219 count.** The recommendation below — scope P3.A to
   `audience` ∈ {owner, staff} — was not taken. Keeping the public tier in
   scope is what made slice 2 the right slice, and the tier went from 3 % to
   68 % in one pass, so the rejected recommendation would have written off the
   cheapest third of the census. Original text:

   > **What does "parity" mean for the dev and public tiers?** 34 of the 219
   > features are `audience: dev` (studio, simpos, admin, dev-sandbox) and 31 are
   > `audience: public` (register, password reset, privacy, vendor public page).
   > Mobile has 0 % of the first and 3 % of the second. If those are out of scope,
   > the real denominator is **154 features**, and parity today is **16 %**, not
   > 11 %. That single call changes the milestone's size by a third. Recommend:
   > scope P3.A to `audience` ∈ {owner, staff} and say so in the ADR.
2. **Is a web deep-link a legitimate parity answer?** *(still open)* Mobile
   already does this in four places (`apps/mobile/src/config.ts:48` + four call
   sites) for the Wine Agent, Reports and menu import. If yes, ~20
   low-frequency owner routes close cheaply and honestly. If no, they need
   native screens.

   Slice 2 assumed **no** without deciding it: nothing it built is graded on a
   deep-link out, `/privacy` was written natively rather than linked, and the
   two `part` grades caused by web-only email links (§5 blocker 6) were *not*
   argued up to `yes` on the grounds that tapping the link works in a browser.
   That is the conservative reading. If the founder answers "yes", those two
   upgrade immediately and roughly twenty owner routes become cheap.
3. **Does retire-to-write owe a retirement for this document?** It is the first
   `apps/mobile` spec, so there is nothing to supersede.

---

## 7. Reproducing the numbers

The census is mechanical: parse `## 1a. Features` bullets out of the 47 notes,
pair each with a verdict, sum. The verdict strings are the judgment and live in
§2 of this file — one character per feature, in note order, `yes`/`part`/`no`.
Anyone re-measuring should re-derive them against the code rather than trusting
this file, per CLAUDE.md §5b: *numbers get re-measured, never copied forward.*

**§0 is derived from §2, not asserted alongside it.** The headline table, the
audience table and the surface count were all recomputed from the census rows
after slice 2, and the three representations of each route — the table row, the
per-feature verdict string, and the bullet list — were cross-checked against
one another (47 rows, 23 detail blocks, all agreeing). Two things that check is
worth stating plainly:

- A row whose `yes + part + no` does not equal its `§1a` count is an arithmetic
  error, and there are none.
- A verdict string whose `H`/`P`/`N` counts disagree with its own bullets is a
  transcription error, and there are none.

That is a mechanical check on a document whose whole subject is claims that
went unchecked. It does **not** check the judgments themselves — whether a
given feature really is `part` rather than `no` is a reading of the code, and
the only defence there is that every one of them cites a file.
