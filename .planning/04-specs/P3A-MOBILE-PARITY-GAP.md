# P3.A — Mobile parity: the measured gap, and the first slice

> **Stage:** P3.A (ADR [0029](../decisions/0029-p3-plan-of-record.md) §1, §2 — runs alongside the
> P3.0 gate, gated on nothing).
> **Status:** measurement complete; one slice built and verified.
> **Base:** `origin/main` @ `190432aa`, measured 2026-08-27 in a clean worktree.
> **Founder calls already made, not re-litigated here:** mobile ships **as-is**,
> without waiting on OD-106 (ADR 0029 §2 and Rejected alternatives).
>
> **Retire-to-write (CLAUDE.md §4):** this is the first spec covering
> `apps/mobile`, so it supersedes nothing. Whether the rule owes a retirement
> anyway is the founder's call — flagged in §6, not defaulted.

---

## 0. The number

`apps/mobile` presents **11 %** of the web feature set the 47 page notes describe
— **after** this session's slice. It was **9 %** before.

| | Before | After |
|---|---:|---:|
| §1a features present (`yes`) | 7 | **11** |
| partially present (`part`) | 25 | **27** |
| absent (`no`) | 187 | **181** |
| total §1a features across 47 notes | 219 | 219 |
| weighted parity (`yes`=1, `part`=½) | 19.5 / 219 = **8.9 %** | 24.5 / 219 = **11.2 %** |
| routes with *any* mobile surface | 15 / 47 | **16 / 47** |

By audience, before the slice — the shape matters more than the headline:

| Audience | features | weighted parity |
|---|---:|---:|
| staff | 24 | 21 % |
| owner | 130 | 10 % |
| public | 31 | 3 % |
| dev | 34 | **0 %** |

Mobile is a **staff/owner operations app** that has never attempted the public
(auth, invites, legal) or dev (studio, simpos, admin, sandbox) surfaces. That is
almost certainly correct and almost certainly deliberate — but it is not written
down anywhere, which makes "parity" undefined. See §6, fork 1.

**Method.** 47 route notes in `.planning/06-pages/`, 219 bullets across their
`## 1a. Features` sections, each judged against `apps/mobile` source read at
`190432aa`. Every `yes`/`part` in §2 is backed by a `file:line`. Three notes
(`/credits`, `/distributors`, `/services`) are redirects with zero features and
contribute nothing to the denominator.

---

## 1. What mobile actually is

Five tabs plus six stack screens — 57 TS/TSX files, 7 076 lines:

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

The architecture is genuinely good where it exists: an offline outbox with
idempotency keys (`apps/mobile/src/state/outbox.ts`), disk-persisted react-query
(`apps/mobile/src/lib/queryClient.ts:51`), a biometric lock gate, and a
design-token system (`apps/mobile/src/design/tokens.ts`). The gap is breadth,
not quality.

---

## 2. The gap, route by route

`§1a` = feature count in the note. Counts are **after** this session's slice.

| Route | Archetype | Aud | §1a | yes | part | no | Mobile surface |
|---|---|---|---:|---:|---:|---:|---|
| `/` | canvas | owner | 7 | 2 | 3 | 2 | app/(tabs)/index.tsx |
| `/help` | document | owner | 3 | 1 | 1 | 1 | app/help.tsx |
| `/receiving/:orderId/door` | focused | staff | 3 | 1 | 1 | 1 | app/(tabs)/cellar/receive/[orderId].tsx |
| `/orders` | command | owner | 9 | 2 | 4 | 3 | app/(tabs)/supply/index.tsx, app/(tabs)/supply/[id].tsx, app/draft/[orderId].tsx |
| `/notifications` | list+detail | owner | 5 | 1 | 2 | 2 | app/notifications.tsx |
| `/get-started` | form | owner | 6 | 1 | 1 | 4 | app/get-started.tsx |
| `/login` | focused | public | 4 | 1 | 0 | 3 | app/login.tsx |
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
| `/forgot-password` | focused | public | 2 | 0 | 0 | 2 | — |
| `/invite/:code` | focused | public | 4 | 0 | 0 | 4 | — |
| `/logs` | list+detail | owner | 4 | 0 | 0 | 4 | — |
| `/no-access` | focused | public | 3 | 0 | 0 | 3 | — |
| `/onboarding` | focused | owner | 3 | 0 | 0 | 3 | — |
| `/privacy` | document | public | 3 | 0 | 0 | 3 | — |
| `/profile` | form | owner | 6 | 0 | 0 | 6 | — |
| `/promotions` | list+detail | owner | 4 | 0 | 0 | 4 | — |
| `/providers` | list+detail | owner | 8 | 0 | 0 | 8 | — |
| `/receiving` | list+detail | staff | 4 | 0 | 0 | 4 | — |
| `/recommendations` | list+detail | owner | 6 | 0 | 0 | 6 | — |
| `/recommendations/catalog` | list+detail | owner | 6 | 0 | 0 | 6 | — |
| `/register` | form | public | 5 | 0 | 0 | 5 | — |
| `/reset-password` | focused | public | 3 | 0 | 0 | 3 | — |
| `/simpos/:restaurantId` | dev | dev | 5 | 0 | 0 | 5 | — |
| `/simpos/:restaurantId/orders` | dev | dev | 2 | 0 | 0 | 2 | — |
| `/studio` | command | dev | 6 | 0 | 0 | 6 | — |
| `/studio/certify` | list+detail | dev | 3 | 0 | 0 | 3 | — |
| `/studio/invite/:token` | focused | dev | 5 | 0 | 0 | 5 | — |
| `/studio/queue` | list+detail | dev | 2 | 0 | 0 | 2 | — |
| `/v/:slug` | list+detail | public | 4 | 0 | 0 | 4 | — |
| `/vendor-prices` | list+detail | owner | 5 | 0 | 0 | 5 | — |
| `/verify-email` | focused | public | 3 | 0 | 0 | 3 | — |
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

**`/login`** · `HNNN`

- `yes ` Sign in with email/password
- `no  ` Sign in with Google (Gmail addresses are auto-routed to Google's chooser; 🚧 no Microsoft button though the backend supports it)
- `no  ` Return-to-where-you-were after signing in (`?redirect=`)
- `no  ` Links out: forgot password, create account

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

---

## 4. What was built, and how it was verified

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

### Not verified: the iOS simulator

**I did not run this on a simulator, and nothing below implies I did.** ADR 0029
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

---

## 6. Forks for the founder — surfaced, not defaulted

Per CLAUDE.md §0.1 these are **not** decided here. None has a register row yet;
filing them would collide with the session that owns `OPEN-DECISIONS.md`.

1. **What does "parity" mean for the dev and public tiers?** 34 of the 219
   features are `audience: dev` (studio, simpos, admin, dev-sandbox) and 31 are
   `audience: public` (register, password reset, privacy, vendor public page).
   Mobile has 0 % of the first and 3 % of the second. If those are out of scope,
   the real denominator is **154 features**, and parity today is **16 %**, not
   11 %. That single call changes the milestone's size by a third. Recommend:
   scope P3.A to `audience` ∈ {owner, staff} and say so in the ADR.
2. **Is a web deep-link a legitimate parity answer?** Mobile already does this
   in four places (`apps/mobile/src/config.ts:48` + four call sites) for the
   Wine Agent, Reports and menu import. If yes, ~20 low-frequency owner routes
   close cheaply and honestly. If no, they need native screens.
3. **Does retire-to-write owe a retirement for this document?** It is the first
   `apps/mobile` spec, so there is nothing to supersede.

---

## 7. Reproducing the numbers

The census is mechanical: parse `## 1a. Features` bullets out of the 47 notes,
pair each with a verdict, sum. The verdict strings are the judgment and live in
§2 of this file — one character per feature, in note order, `yes`/`part`/`no`.
Anyone re-measuring should re-derive them against the code rather than trusting
this file, per CLAUDE.md §5b: *numbers get re-measured, never copied forward.*
