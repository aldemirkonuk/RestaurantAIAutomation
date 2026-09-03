---
type: page
route: /notifications
slug: notifications
softwares: [notifications]
component: apps/web/src/pages/Notifications.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-02
links: ["[[PAGE-CONTRACT]]", "[[orders]]", "[[inventory]]"]
---

# /notifications — Notifications

> **Part of** [[08-softwares/notifications|Notifications]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Notification row / Take Action** → route from the notification's `actionUrl` (varies by type)
- **Review & Approve Draft** (draft_ready detail) → [[orders]] `/orders?draft=<conversationId>`
- **Mark all as read** → API `PATCH /api/v1/notifications/read/all`
- **Settings** → (in-page tab, `/notifications?tab=settings`)
- **One-tap action "Open"** → [[inventory]] `/inventory` or [[orders]] `/orders` by action type; gmail actions point at `/emails` (no such route)
- **Copy link** → clipboard deep link back to this page

## 1. Purpose

"Alerts that need a decision, oldest first" (`components/layout/Sidebar.tsx:146`).
The durable-notification inbox: read/unread/archive/delete, stacked digests that
live-update while the page is open (10s poll, `Notifications.tsx:157-163`), a detail
panel that stays in sync with refreshes (:192-200), the One-Tap Action Center, and a
"create custom one-tap action" modal.

## 1a. Features
- Notification inbox: read / unread / archive / delete, mark-all-read
- Stacked digests that live-update while the page is open
- Detail panel, deep-linkable from the header bell straight to one notification
- One-Tap Action Center embedded (approve orders, low-stock reorders)
- Create a custom one-tap action (🚧 not persisted — gone on refresh)

**Mudavym redesign** (flag `mudavym_design_notifications`; legacy renders unchanged
while the flag is off — `apps/web/src/pages/notifications/next/`):

- **The day-book: three registers in one column, one direction of travel.**
  *Needs a hand* (unread, oldest first) → *What the house did on its own* (`--calm`)
  → *Ruled off* (under the double rule, subdued). Working a line moves it down the
  page; nothing vanishes.
- **The `--calm` band**, discriminated structurally, not by tone: `draft_ready`
  rows (the inbound responder drafted a vendor reply and did **not** send it,
  `inbound-responder.service.ts:1287`) and pending one-tap actions with **no
  author** (`createSystemAction` inserts no `user_id`,
  `one-tap-actions.service.ts:366-382`). Dashed edge, "nothing was sent", a human
  control beside it — hold-to-approve to record, plain *Undo* to cancel.
- **Custom one-tap actions now persist** — `POST /one-tap-actions` through the
  guarded gateway module, creator stamped from the token. Closes §13.2 and the
  §10 "does not survive a refresh" row.
- **One-tap execute / cancel** against `POST /one-tap-actions/:id/{execute,cancel}`
  — the first callers of that module from this page.
- **All four states, each real**: loading (skeletons), empty (said in words),
  error (the register named, the failure quoted), permission-denied (told apart
  from a breakage; no pointless retry offered). Closes §12's Loading/Error/403 rows.
- **The book states its own window** — "Showing N of M lines the register holds",
  with *Read further back* paging at the gateway's `@Max(100)`. The legacy client
  threw the `{ total, hasMore }` envelope away (`services/api/notifications.ts:104-106`).
- **Per-register tally in the rail** (Stock · Orders · Vendor mail · Calendar ·
  Reports · Advice · Payments · System · Other), open/total, on the `tally` spring.
- **Live-read contract stated on the page**: re-read every 10s while open, plus the
  `notification_sent` / `ws:dashboard-invalidate` nudges; "last read HH:MM:SS".
- **Digest stacking preserved** — `lib/notificationStack.ts`, with the folded count
  shown on the surviving line *and* summed in the rail.
- **Set aside** — 🚧 per-browser only (`localStorage`, keyed by restaurant); the page
  says so in words and offers *Put them back*.
- 🚧 **Executing a one-tap action records the decision only.** The gateway's
  `triggerWorkflow` is a set of TODO stubs (`one-tap-actions.service.ts:404-430`),
  so the card says it does not place the order — see §9.
- 🚧 **Not carried over from the legacy page** (deliberate, see §1b): free-text
  search, the priority filter, batch multi-select, the local star, *Copy link*, and
  the in-page `?tab=settings` panel. Rationale in §1b "Design used, and why".

**Second pass, 2026-09-03** (founder review):

- **No emoji anywhere, and the mark is drawn instead.** Every stored title and
  message is normalised through `plainText()` before it is drawn, and the register's
  own lucide icon is rendered from the row's `type` — in ink, sized by the house
  tokens, identical on the line's chip and on the rail's tally so the two can never
  disagree. This is the reader-side half; the producers were cleaned at source
  (below), but rows already written keep their emoji forever.
- **Twelve producers stopped writing emoji into notification rows** (gateway ×10,
  orchestrator ×2 — the list with `file:line` is in §1b), and a scanning spec
  (`apps/api-gateway/src/notifications/notification-text-is-plain.spec.ts`) fails
  CI on the thirteenth, in either runtime.
- **Register mapping widened** — `custom_reminder`, `vendor_reply`, `low_stock`,
  `system_alert`, `overdue_order`, `order_inquiry`, `generated_report`,
  `email_classified_operational`, `email_classified_promo` now land in a named
  register instead of *Other*. Every one of them is a `type` a real producer writes.
- 🚧→**moved: one-tap actions now live on the dashboard rail**, under
  *Waiting on you* (`apps/web/src/pages/dashboard/next/OneTapPanel.tsx`; founder's
  decision of 2026-09-03, argument in §1b). The day-book keeps only lines; the
  `--calm` band names the new home in one sentence rather than going silent. This
  page no longer reads `/one-tap-actions` at all, and the entry above about custom
  one-tap actions persisting is now a *dashboard* capability — see
  [[dashboard]] §1a.
- **Two directions drawn at full density** for the founder's fork:
  `.planning/sketches/089-notifications-directions/` — `three-column-desk.html`
  and `day-strip.html`, with `index.html` as the cover. Example data throughout;
  neither is a working page.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_notifications`)

Canonical copy: `apps/web/src/pages/notifications/next/MOTIONS.md`. Every motion is a
token from `lib/mudavym/motion.ts`; the CSS durations/easings are interpolated **from**
the tokens, so what runs is the token. `prefers-reduced-motion` collapses all of it.

| id | token | curve · ms | fires |
|---|---|---|---|
| `nt-open-arrive` | `settle` | HOUSE · 320ms | the opening line, once on mount — opacity + 6px rise |
| `nt-expand` | `settle` | HOUSE · 320ms | `grid-template-rows: 0fr → 1fr` — a line opening into its facts, and the **Ruled off** register opening under the double rule |
| `nt-chev` | `settle` | HOUSE · 320ms | the line's chevron turning 90°, on the same token as the expansion it belongs to |
| `nt-ink` | `ink` | HOUSE · 160ms | hover/focus micro-states on lines and controls; nothing translates, nothing scales |
| `nt-tally` | `tally` | overdamped spring 120/26 · 840ms | the rail's per-register open counts and "Showing N of …"; an em dash never counts |

**Changed 2026-09-03:** `pour` and `stamp` left this page with the one-tap desk
(they are now in [[dashboard]]'s table). The day-book has no wax at all, which is
the correct reading of the rationing rule: every write it offers is a reversible
bookkeeping entry, and the seal is for commitment.

Deliberate non-motions: a line does **not** travel between bands (the re-read may have
changed it — a smooth slide would assert a continuity the data has not got); nothing
staggers in; unknowns never animate; the `--calm` band never pulses; `turn` is unused
because the ruled-off account is being *consulted*, not revealed.

### Design used, and why

**The verdict, quoted** ([[MAKEOVER-VERDICTS]]:75-82): *"`/notifications` needs
re-transformations. Neither drawn direction is the answer… What survives as
inspiration only: Federation's density — it shows more of what is actually happening —
and Editorial's way of **subduing the already-handled** items so the page quiets down
as it is worked. The handling of the problem was called 'really good'; the execution
was not enough."*

**The structure that enforces it — one book, three registers, one direction of travel.**
The page is the house's day-book. A line is never removed by working it; it moves
*down*: *Needs a hand* → (if the house acted unasked) *What the house did on its own*
→ *Ruled off*, under the double rule that the brand foundation reserves for an account
that is closed. Density is spent where Federation earned it — the **collapsed** line
carries register, title, the row's own message, its folded-duplicate count and its age,
and the rail carries a per-register tally — and quiet is spent where Editorial earned
it: the ruled-off band steps ink-1 → ink-4, drops to weight 400, loses the seal rule
and the hover, and collapses behind one count. That is the whole mechanism: the same
component draws both states, so the page cannot quiet by becoming a different page.

**Honesty rules applied**

1. `error` is branched on — the §12/§13.1 defect. Each register is
   `loading | unreadable | ready`; a 403/401 is told apart from a 500, and the refusal
   copy does not offer a retry that cannot work.
2. An unread book is never an empty one. The opening sentence under a failure says
   *"Nothing below is claimed — an unread page is not a quiet house."*
3. Unknown → em dash. `total: null` renders `—`, never `0`; a below-par wine with no
   stock figure renders `—` on both columns.
4. The window is stated. `GET /notifications` pages at 20 by default and 100 by cap;
   the page asks for 100, says how many of the register's `total` it is showing, and
   pages further back on request rather than implying it holds everything.
5. A control never over-promises its endpoint. Executing a one-tap action records the
   decision and stamps the executor; `triggerWorkflow` is TODO stubs, so the card says
   so in a line above the die.
6. Per-browser state is named as such — *Set aside* says the server was not told and
   another device still shows the line.
7. Optimistic writes roll **back** on refusal and say what did not happen; nothing is
   left looking done that is not.
8. **Mark-all-read names its tenant.** `PATCH /notifications/read/all` carries
   `restaurantId` as well as `userId`. The gateway applies the tenant filter only
   `if (params.restaurantId)` (`notifications.service.ts:943-945`), so omitting it
   marks read every unread row for that user in **every** restaurant they belong to —
   a cross-tenant *write* behind a button naming one book. Caught by the 2026-09-02
   audit; pinned by `useNotificationsNextData.test.tsx` ("names the active restaurant").
   The control is labelled *Rule off every open line*, not "…the page", because its
   real scope is this restaurant's whole book, including pages not on screen.
9. **"Read further back" retires when the book is exhausted.** `hasMore` is taken from
   the **deepest** page actually read, not page 1. The gateway computes it per queried
   page as `count > offset + limit` (`notifications.service.ts:821`), so page 1's answer
   is the constant `total > 100` and could never clear — the rail went on offering more
   after everything had been fetched. Caught by the same audit; pinned by the hook test
   "retires once the last page has actually been read".
10. Contrast measured, not felt: `--ink-3` is 4.37:1 on paper and is therefore unused
   anywhere in the directory; secondary text is `--ink-4` (6.05:1 paper / 7.46:1
   charcoal), the calm chip is `--seal-deep` (7.80:1 / 9.46:1).

**Two directions considered and not built — the founder's fork**
*(drawn at full density on 2026-09-03 at the founder's request:
`.planning/sketches/089-notifications-directions/`)*

- **A · The three-column desk** (Federation taken literally): the three registers side
  by side, each scrolling independently, under a fixed count strip. More on one screen.
  Not built because the bands stop being a *journey* — a line teleports between columns
  instead of moving down, which is precisely the legibility that makes the page quiet
  as it is worked; and three live columns read as a monitoring wall, the "security
  camera" the müdavim story was written against.
- **B · The day-strip** (the day-book taken literally as a diary): a vertical time axis
  with the day's lines hung off it and a scrubber like the dashboard's tape. Not built
  because notification times cluster hard — crons fire on the hour, digests restack —
  so the axis would be long stretches of nothing punctuated by knots, and it spends the
  whole page on the one dimension every row already states in five characters ("3h ago").
  The founder's complaint was that the page does not show enough of *what* is
  happening, not *when*.

**Substituted or left out, and why**

- **Search, priority filter, batch multi-select** — four filter controls over a list the
  gateway caps at 100. The bands and the register tally partition it already. If the
  book grows, the honest fix is the server-side `type` / `status` / `dateFrom` filters
  that `GetNotificationsQueryDto` already exposes → §13.
- **Star** — local-only, invisible to anyone else, and now duplicated by *Set aside*.
  Dropped rather than shipped as a second per-browser fiction.
- **Copy link** — a link back to this page told the reader nothing; the row's own
  `actionUrl` is the address that matters and is on every expanded line.
- **`?tab=settings`** — notification preferences have a home on `/settings` (rebuilt in
  the same wave). Two homes for one truth is how they drift → §13.
- **Snooze → *Set aside*** — the same per-browser mechanism, renamed so it cannot be
  mistaken for a server-side decision, reversible in one click. The server-side move
  stays open → §13.3.
- **The legacy "next steps" block** (`Notifications.tsx:111-134`) — three lines of
  advice generated from the notification's `type`, not read from the row. Dropped under
  the no-fabrication rule; the row's own facts and its own link replace it.
- **`OneTapActionCenter`** — not reused. It rebuilds actions client-side from inventory
  and orders and keeps them in `localStorage` (`:80-83,395-460`); this page reads the
  guarded `one-tap-actions` table instead, which is the register that actually exists.

### Second pass, 2026-09-03

**What the founder asked.** Three things, after reading the first pass: *"show me
two more sketches — the whole picture, a lot of details, full of the details
available to serve — just as screenshots, not as a real page… If that means the
three-column desk and the day-strip, then build them."* · *"remove all emojis,
replace them with real applicable icons."* · *"One-tap actions is a thing — address
that, either inside /notifications or (maybe this is wrong) find another place."*

**1 · The two sketches.** `.planning/sketches/089-notifications-directions/` —
`index.html`, `three-column-desk.html`, `day-strip.html`. Both render at 1440 from
`file://` with no server, both carry the SKETCH banner, both are drawn at a busy
house's density: 20 open lines across all nine registers, 3 drafted-and-unsent
replies, 20 ruled-off lines, folded-duplicate badges, an expanded line with its
facts grid and its below-par table, the rail tallies, the live-read contract, every
filter the gateway actually accepts (`type · status · dateFrom · dateTo · page ·
limit`), and a legend separating what is built from what is proposed. Each one also
carries a panel naming its own cost, so the fork is argued on the page rather than
in a note. Verified in both grounds at 1440 with zero horizontal overflow and zero
console errors.

**2 · The emoji, and where they actually came from.** The page source never had
one; the *data* did. Production titles read `[siren] 50 wines dropped below par`,
`[chart] Weekly report ready`, `[warning] Low-stock digest: …` because the
PRODUCERS wrote them into the row. That is worse than decoration: a picture in a
database row is permanent, renders in whatever colour font the reader's OS ships
(breaking ADR 0042's one-chromatic-colour rule on a page with no way to override
it), and in every case restated something the row already carried structurally —
`priority`, `metadata.severity`, `metadata.criticalCount`, `type`.

Fixed in three layers, because no single one is sufficient:

*(a) At the source.* Twelve call sites, each now plain, each covered:

| file:line | was | now |
|---|---|---|
| `apps/api-gateway/src/notifications/low-stock-alerts.service.ts:304-309` | siren/warning + `N wines dropped below par` | `3 wines dropped below par — 1 critical` (the count the picture could never carry) |
| `apps/api-gateway/src/notifications/low-stock-alerts.service.ts:358` | warning + `Low-stock digest: …` | `Low-stock digest: 17 wines below par` |
| `apps/api-gateway/src/notifications/notifications.service.ts:274-279` | siren/warning severity prefix on the low-stock push + inbox row | `Critical: <wine>` / `Low stock: <wine>` |
| `apps/api-gateway/src/notifications/notifications.service.ts:239,252-253` | wine glass + tick + eye on the order-approval push and its buttons | plain |
| `apps/api-gateway/src/notifications/notifications.service.ts:290-291` | cart + chart on the low-stock push buttons | plain |
| `apps/api-gateway/src/notifications/notifications.service.ts:356,366-367,376` | parcel + tick + eye on the delivery push, buttons and inbox row | plain |
| `apps/api-gateway/src/notifications/notifications.service.ts:407,420-421` | money bag + tick + arrows on the price-offer push and buttons | plain |
| `apps/api-gateway/src/notifications/notifications.service.ts:436-452` | an `emoji` map keyed by severity, prefixed onto BOTH the push title and the stored row | deleted; severity stays in `data.severity`, `metadata.severity`, `priority` and `requireInteraction` |
| `apps/api-gateway/src/notifications/notifications.controller.ts:313` | wine glass + `WineOps AI Test` | `WineOps AI test` |
| `apps/api-gateway/src/communications/scheduled-tasks.service.ts:267,491,582` | chart / repeat / parcel on the weekly report, recurring-order and delivery-ETA rows | plain |
| `apps/api-gateway/src/team/schedule.service.ts:397,631` | calendar + siren on schedule-published and shift-call-out | plain |
| `apps/api-gateway/src/team/team.controller.ts:407` | megaphone on the DEFAULT broadcast title | plain — a manager's own title is passed through untouched |
| `services/agent-orchestrator/agents/email_intel_agent.py:243,588` | envelope + tag on the two rows the Python agent INSERTs directly | plain |

*(b) At the boundary, as a guard rather than a sanitiser.*
`apps/api-gateway/src/notifications/notification-text-is-plain.spec.ts` scans every
gateway file that names a notification funnel (`persistForRestaurant`,
`createNotification`, `persistManagerNotification`, a direct
`from("notifications")`) plus every orchestrator agent that inserts into the table,
and fails naming `file:line`. It refuses to pass vacuously — it asserts it can see
the producers first — and it was proven against the pre-fix tree, where it reports
**28** offences including the two indirect ones held in an `emoji` variable rather
than written on the `title:` line. Log lines are excluded by a paren-balance walk
(operator output is not a reader's), and comments are excluded so a defect can be
described without re-triggering the guard.

*Why a guard and not a strip inside `persistForRestaurant`:* that funnel also
carries human-authored text — a manager's team broadcast, a custom reminder the
user typed. Silently deleting characters out of a person's own message is a house
editing its own records. The rule is for the house's voice, so the house's voice is
what is fixed. `team.controller.broadcast.spec.ts` pins both halves of that
distinction.

*Measured, not assumed (2026-09-03, local gateway on :4000 against the dev
tenant).* `GET /notifications?limit=100&page=1` returned
`{ total: 134, hasMore: true, data: [100] }` and **100 of the 100 rows on page one
carry an emoji in their stored title** — including the founder's exact example,
`[siren] 50 wines dropped below par`, alongside `[warning] Low-stock digest: 50
wines below par` and `[chart] Weekly report ready`. So the reader-side strip is not
a precaution: without it every single line on the first page of this tenant's book
renders a picture. (The same call also confirms the envelope the hook depends on and
the `@Max(100)` page cap.)

*(c) At the reader.* `nt-format.ts` `plainText()` strips the same two ranges the
repo's own emoji grep uses, plus the joiners — and deliberately NOT `©`, `®`, `™`,
which a naive `\p{Extended_Pictographic}` sweep would have deleted out of a wine
name. `iconForType()` then draws the register's mark from `type`. A title that was
*only* a picture comes back empty and falls to "Untitled entry" rather than being
invented.

Each of those claims is pinned separately in
`apps/web/src/pages/notifications/next/nt-format.test.ts` (12 tests): a title that
is only a picture → empty; an emoji mid-string → the words on both sides survive; a
bare `U+FE0F` → removed; `™`/`®`/`©` in a wine name → untouched; and `hasEmoji()`
called three times on the same string → still `true` (the shared `/g` regex's
`lastIndex` is reset, which is how this kind of guard usually rots). Proven
non-vacuous: with `plainText` narrowed back to a leading-only strip, four of them
fail.

**3 · One-tap actions — the founder chose the dashboard rail.** They now live in
`apps/web/src/pages/dashboard/next/OneTapPanel.tsx`, mounted directly under
*Waiting on you*, and are gone from this page: the hook no longer reads
`/one-tap-actions` (pinned by `useNotificationsNextData.test.tsx`), the desk and the
house-raised `ActionCard` are deleted, and the `--calm` band ends with one sentence
linking to the new home. The three homes and what each cost:

- **Here, on `/notifications` (what the first pass built).** Cheapest — the register
  was already being read for the `--calm` band. But it makes the day-book two things
  at once: a *record* worked downwards until the account is ruled off, and a *desk*
  of work with next steps. The page's whole structural argument is that a line never
  leaves, only quiets; a one-tap action's natural end is that it *goes away*. Two
  opposite lifecycles in one column is why the first pass needed a rail to hide the
  contradiction in.
- **The dashboard rail, beside "Waiting on you" (chosen).** Costs one new read on a
  page that already makes five, and it puts a second `HoldToApprove` on a page that
  had one — a real risk of making the seal routine, which the rationing rule exists
  to prevent. It buys the right adjacency: an approval waiting to be sealed and an
  action the house raised for itself are the same kind of object, and an operator
  who opens the dashboard "to see what needs me" now sees both without a second
  page. It also makes the day-book honest again — only lines.
- **A command-palette-only surface.** Cheapest of all to build and the least
  discoverable: an action nobody opens the palette to look for is an action that
  expires. It also has nowhere to put the `triggerWorkflow` caveat, which must be
  visible at the moment of committing, not behind a keystroke. Rejected as a *home*;
  fine as an *entrance* → §13.14.

*Not built here: the command-palette entry.* The palette's registry
(`apps/web/src/components/CommandPalette.tsx`) is not a plain appendable list — its
items are built inside the component from route and permission context — so adding
one means editing a shared component this page does not own. Filed as §13.14.

**What stays open, and why.** (1) `createSystemAction` still has no production
caller (§9.1), so the "raised by the house" half of the panel is structurally
correct and permanently empty wherever it is mounted — moving it did not fix that,
and the panel says "Nothing standing" rather than implying the house is idle.
(2) `triggerWorkflow` is still TODO stubs (§9.2); the panel states it above the die
and cites the line. (3) The two competitive-lens "now" ideas — a line stating its own
rule and 90-day fire count, and subdue-by-settlement — are drawn as *proposed* in
both sketches and filed in §13.15/§13.16; neither has a gateway read behind it and
neither was faked. (4) Three emoji remain in `notifications.service.ts` at
`:478,491,502` — all inside `this.logger.log(...)`, i.e. server console output no
reader ever sees. Out of the rule's scope; named here so the grep's non-empty
result is not mistaken for an oversight.

## 2. Entry

- Sidebar with unread badge (`Sidebar.tsx:144,410`).
- Header bell → `navigate('/notifications')`, optionally carrying a
  `selectedNotificationId` to auto-open the detail panel
  (`components/layout/Header.tsx:191,226`; consumed `Notifications.tsx:184-189`).
- Command palette `g n` (`components/command/commands.ts:65,83`).
- [PAGE_MAP](../foundation/PAGE_MAP.md):119 lists it as no-inbound — the scan missed
  layout components; sidebar + bell are the real entries.

## 3. Files

- Route binding: `apps/web/src/App.tsx:345`, through `PageGate page="notifications"`
  (lazy imports :88 for the redesign).
- `apps/web/src/pages/Notifications.tsx` (1,807 lines).
- Rendered: `components/notifications/OneTapActionCenter.tsx` (:731);
  digest-stacking via `lib/notificationStack.ts` (:41).
- Mudavym redesign (flag-gated): `apps/web/src/pages/notifications/next/` —
  `NotificationsNext.tsx`, `BookRow.tsx`, `HouseBand.tsx`,
  `useNotificationsNextData.ts`, `nt-format.ts`, `NotificationsNext.test.tsx`
  (13 render-contract tests, hook mocked), `useNotificationsNextData.test.tsx`
  (7 hook tests, `apiClient` mocked), `nt-format.test.ts` (12 unit tests for the
  emoji normaliser and the icon map), `MOTIONS.md`. It shares
  `lib/notificationStack.ts` with the legacy page and imports nothing from
  `pages/Notifications.tsx`.
- Moved out 2026-09-03: the one-tap desk, formerly `notifications/next/HouseBand.tsx`
  and briefly `notifications/next/OneTapDesk.tsx`, is now
  `apps/web/src/pages/dashboard/next/OneTapPanel.tsx` with its own read and its own
  test (`OneTapPanel.test.tsx`, 12 tests, including the tenant-switch discard).
  See [[dashboard]] §1a/§1b.
- Producer-side, second pass: `apps/api-gateway/src/notifications/notification-text-is-plain.spec.ts`
  (the emoji guard, both runtimes), plus title assertions added to
  `notifications/low-stock-alerts.service.spec.ts`, `team/schedule.service.spec.ts`,
  `team/team.controller.broadcast.spec.ts`,
  `communications/weekly-report-honesty.spec.ts` and
  `services/agent-orchestrator/tests/test_email_intel_agent.py`.
- Sketches: `.planning/sketches/089-notifications-directions/` — `index.html`,
  `three-column-desk.html`, `day-strip.html` (standalone, `file://`, example data).

## 4. Endpoints

Atlas row: [ENDPOINTS](../foundation/ENDPOINTS.md):300 (`notifications`, 24 — atlas's
**⚠ all unguarded** is stale; guarded at class level since 2026-08-25 (#60),
`apps/api-gateway/src/notifications/notifications.controller.ts:45`), plus :389 for
the action center's order reads.

| Method | Path | Call site |
|---|---|---|
| GET | `/notifications?userId=&status=` | `useNotifications` (Notifications.tsx:157) → `services/api/notifications.ts:101` |
| PATCH | `/notifications/:id/read`, `/:id/unread`, `/:id/archive` | hooks (:165-168) → `notifications.ts:133,141,163` |
| PATCH | `/notifications/read/all?userId=` | `useMarkAllNotificationsAsRead` → `notifications.ts:156` |
| DELETE | `/notifications/:id` | `useDeleteNotification` → `notifications.ts:171` |
| GET | `/procurement/orders/pending` (+ list) | OneTapActionCenter → `services/api/orders.ts:206,217` |

## 5. Signals

**None.** The page *consumes* the notification signal spine (memory:
notifications-batching-sync — edge-instant + batched digests) but emits nothing
about its own use; no `uxSignals` (dark, `lib/uxSignals.ts:15`), no `data-ux-key`.

## 6. Tier cut

**Core** — operate. The durable low-stock notification is the ✅ S10 Core row
([TIER-MAP](../03-scenarios/TIER-MAP.md):46); S02/S03 mismatch alerts also land here.

## 7. Rebrand surface

**0 user-visible strings** in the page tree. Shared: OneTapActionCenter's
`wineops_*` localStorage keys are invisible (`OneTapActionCenter.tsx:80-83`);
its QuickGmailModal shows "WineOps AI" in email previews
(`components/emails/QuickGmailModal.tsx:129,145,153,189,200`). Layout chrome per
dashboard.md §7.

## 8. State & config

- 10-second poll while mounted (`Notifications.tsx:162-163`) — the only page that
  polls notifications rather than waiting for realtime.
- Snoozes/pending one-tap actions persist in localStorage via the shared center
  (`OneTapActionCenter.tsx:80-83`).

**Mudavym redesign gate.**

| Knob | Value |
|---|---|
| Feature flag (per restaurant) | `mudavym_design_notifications` — checked via `settingsApi.checkFeatureFlag`; an unregistered flag is safely OFF (`lib/mudavym/useMudavymDesign.ts`) |
| Per-browser override | `localStorage["mudavym.design.notifications"]` — `1/true/on` forces the redesign, `0/false/off` forces legacy, absent falls through to the flag |
| Ground | paper by default; Warm Charcoal under the app's dark theme, or `<NotificationsNext ground="charcoal"/>` (the `.mudavym` class and `data-ground` sit on the same element — PageGate's header explains why) |
| Poll | 10s while mounted (`useNotificationsNextData.ts` `POLL_MS`), plus the `notification_sent` and `ws:dashboard-invalidate` window events |
| Page size | `limit=100` (the gateway's `@Max(100)`); *Read further back* adds one more page per press |
| Per-browser state | `localStorage["mudavym.notifications.setAside.<restaurantId>"]` — the *Set aside* list, tenant-keyed, and the only client-only state on the page |
| Registers read | `GET /notifications` only, since 2026-09-03. `/one-tap-actions` moved to the dashboard rail with the desk; pinned by `useNotificationsNextData.test.tsx` ("reads the notifications register and nothing else") |

## 9. Gaps

- **Custom one-tap actions do not persist**: created into `useState` only
  (`Notifications.tsx:173,575`), rendered at :693-700, gone on refresh. The
  UX-catalog claim "created quick actions never rendered" is therefore *partly*
  stale — rendering shipped, persistence did not (`v3.0-TECH-DEBT.md:389-390`).
- All 24 notification endpoints are guarded since 2026-08-25 (#60) — `@UseGuards(JwtAuthGuard)`
  at class level (`apps/api-gateway/src/notifications/notifications.controller.ts:45`);
  the atlas row ([ENDPOINTS](../foundation/ENDPOINTS.md):300) still reads "unguarded" and is stale.
- Agent-side notification writes were silently failing until 44.1d's fix — history
  in `v3.0-TECH-DEBT.md:95-131`; worth remembering when interpreting old gaps in
  this inbox.

**Found while building the Mudavym redesign (2026-09-02).** All four are outside the
page's own paths; none was built.

1. 🔴 **`createSystemAction` has no production caller.** `apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts:351`
   is the only way a one-tap action is written *without* a human author, and the only
   references to it in the repo are in `src/__tests__/one-tap-actions.service.spec.ts:279,305`.
   So today the "the house raised this itself" half of the `--calm` band is correct but
   permanently empty: nothing in the gateway raises an action on its own. The producers
   that *should* (the low-stock sweep, the delivery watcher, the price watcher) write
   notification rows only. **Owner: whoever owns `notifications/low-stock-alerts.service.ts`
   and `procurement/`** — one `createSystemAction` call per producer.
2. 🔴 **Executing a one-tap action does nothing but record it.** `triggerWorkflow`
   (`one-tap-actions.service.ts:404-430`) is three `// TODO` branches and a default
   log. The page states this on every card rather than letting the die imply a
   reorder; the fix is a gateway one.
3. 🟠 **The web service drops the notifications envelope.**
   `apps/web/src/services/api/notifications.ts:101-107` returns `raw.data` and throws
   away `{ total, page, limit, hasMore }`, and defaults to the gateway's `limit=20`
   (`notifications.service.ts:783`) — so every caller silently shows the newest 20 with
   no way to know. The redesign calls `apiClient` directly to keep the envelope; the
   shared service should carry it, and the header bell/sidebar badge should say so too.
4. 🟠 **`Notification.status` is typed `'read' | 'unread'`** in
   `apps/web/src/services/api/notifications.ts:27`, but the gateway also writes
   `status: "archived"` (`notifications.service.ts:961`), which is what routes a row
   into *Ruled off*. The page reads it through `String(n.status)` rather than widening
   a shared type it does not own; the shared union should gain `'archived'`.
5. 🟠 **The seeded-defaults guard does not scan this page.**
   `scripts/check_no_seeded_defaults.py` `SCAN_ROOTS` needs
   `Path("apps/web/src/pages/notifications/next")` added. Verified 2026-09-02 by running
   the guard from a copy with that root present: **PASS**, 64 web files, no S1–S4 hit.
   Until the line is added, CI is green over an unexamined surface — exactly the shape
   the guard's own header warns about.

**Found in the second pass (2026-09-03).** Outside this page's paths; the first two
were CLOSED here, the rest were not.

6. ~~🔴 **Producers write emoji into the stored notification title.**~~ **Closed
   2026-09-03** — twelve call sites cleaned (table in §1b), guarded by
   `apps/api-gateway/src/notifications/notification-text-is-plain.spec.ts`, and
   normalised on read by `nt-format.ts` `plainText()` for the rows already written.
7. ~~🟠 **One-tap actions had no home of their own.**~~ **Closed 2026-09-03** — the
   founder placed them on the dashboard rail
   (`apps/web/src/pages/dashboard/next/OneTapPanel.tsx`); this page no longer reads
   `/one-tap-actions`.
8. 🟠 **The command palette's registry is not appendable.**
   `apps/web/src/components/CommandPalette.tsx` builds its items inside the
   component from route and permission context rather than from a list a page can
   contribute to, so no page can add an entrance to its own surface without editing
   a shared component. That is why one-tap actions have no palette entry today
   (§1b). **Owner: whoever owns `components/CommandPalette.tsx`.**
9. 🟠 **A notification carries no record of the rule that fired it.** The row holds
   `metadata.count`/`criticalCount`/`wines[]` but nothing about the threshold that
   was crossed, how often that same rule has fired, or whether the operator thinks
   it is too loud. Both sketches draw the shape as *proposed*; the read does not
   exist. This is DESIGN-FOUNDATION §6's "every item states its rule and its
   history", marked **need it: now**. **Owner:
   `notifications/low-stock-alerts.service.ts` + a new rule-history read.**
10. 🟠 **Nothing subdues a line by SETTLEMENT.** A row quiets when a person reads it,
   never when the credit note lands, the PO goes out, or the price returns to range
   — so a line that has genuinely resolved itself still sits in *Needs a hand*
   asking. DESIGN-FOUNDATION §6 calls this out as the exponential idea for this page
   ("only a ledger can"), **need it: now**. Needs the settlement events wired to the
   notification row (a `resolved_by_event` column and a writer per producer).
11. 🟢 **Three emoji remain in `notifications.service.ts:478,491,502`** — all inside
   `this.logger.log(...)`. Server console output, never a reader's; deliberately out
   of the rule's scope and excluded by the guard's log-detection, recorded here so
   a raw grep's non-empty result is not read as an oversight.

## 10. Maturity

**partial.** The inbox itself is real and has more live producers than any other page
in this cluster. Two named capabilities are absent or fake.

**Real.** `notifications` rows are written by seven distinct producers across the
gateway — team broadcast (`team/team.controller.ts:350`), schedule publish and
acknowledge (`team/schedule.service.ts:254,484`), procurement
(`procurement/procurement.service.ts:1062,1368`), the low-stock engine
(`notifications/low-stock-alerts.service.ts:312,354`), the inbound autonomous
responder (`common/orchestrator/inbound-responder.service.ts:1287`), and the
scheduled-task crons. Read/unread/archive/delete all hit real JWT-guarded endpoints
(`notifications/notifications.controller.ts:45` class-level guard, routes :84-276).
The 10-second poll and the detail-panel resync are implemented as documented.

**Not real:**

| Gap | Evidence |
|---|---|
| Custom one-tap actions do not survive a refresh | Created into `useState` at `Notifications.tsx:173`, appended `:575`, rendered `:693-710`. No storage call, no endpoint. §9's reading is confirmed: rendering shipped, persistence did not |
| The page cannot report a failure | `useNotifications(...)` destructures `isLoading: _isLoading, error: _error` (`Notifications.tsx:157`) — both underscore-discarded. A 500 or a 401 renders as an empty inbox, forever, while the 10s poll keeps retrying silently |
| The gateway's own one-tap module has no caller from this page | `one-tap-actions.controller.ts:64` is now JWT-guarded (44.1a closed) with 8 routes; the only web callers are on the dashboard (`services/api/dashboard.ts:166,191`). `OneTapActionCenter` keeps its state in `localStorage` (`OneTapActionCenter.tsx:80-83,175-180,502`) and rebuilds actions client-side from inventory + orders (`:395-460`) |

**Amendment 2026-09-02 (Mudavym redesign, behind `mudavym_design_notifications`).** All
three rows above are closed *on the rebuilt surface only* — the legacy page is untouched
and every row still describes it with the flag off.

| Row | Closed by |
|---|---|
| Custom one-tap actions do not survive a refresh | `POST /one-tap-actions` from the page's own desk (`useNotificationsNextData.ts` `createAction`); the creator is stamped from the token, not `useState` |
| The page cannot report a failure | `Register<T>` = `loading \| unreadable \| ready` per register; refusal (403/401) told apart from breakage; the copy names which register could not be read |
| The gateway's one-tap module has no caller from this page | `GET /one-tap-actions`, `POST /:id/execute`, `POST /:id/cancel` are all called from this page now |

Still not real, and now *said out loud on the page*: executing an action records the
decision but runs no workflow (§9.2), and no producer raises an action on its own
(§9.1), so the house half of the `--calm` band is honest but empty until a producer
calls `createSystemAction`.

**§0 correction (stale).** "gmail actions point at `/emails` (no such route)" is fixed:
`openRouteForAction` now returns `/communications` for `gmail_send` and
`gmail_contextual`, with a comment explaining that no id can be handed over
(`OneTapActionCenter.tsx:135-141`).

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/notifications?userId=&status=` | JWT (class, `notifications.controller.ts:45`) | `:84-101` | Notification rows for the user |
| PATCH | `/notifications/:id/read`, `/:id/unread`, `/:id/archive` | JWT | `:203`, `:216`, `:229` | Updated row |
| PATCH | `/notifications/read/all?userId=` | JWT | `:189-201` | Count marked |
| DELETE | `/notifications/:id` | JWT | `:263-276` | 204 |
| GET | `/procurement/orders/pending`, `/procurement/orders` | JWT | `procurement.controller.ts` | Orders the action center turns into cards |
| GET | `/inventory/:rid` (low stock) | JWT | `inventory` module | Low-stock actions |

### Fed by

| Notification kind | Producer | Live? |
|---|---|---|
| Low stock | `@Cron("*/2 * * * *")` edge sweep + `@Cron("0 * * * *")` batched digest (`low-stock-alerts.service.ts:85,110`) → `persistForRestaurant` (`:305,347`) | Yes — memory: notifications-batching-sync |
| Vendor reply / draft ready | Gmail push → `email.inbound.received` → `rabbitmq-bridge.service.ts:528` → `InboundResponderService.analyzeAndDraftReply` → notification rows `inbound-responder.service.ts:1287` | Yes (live Gmail watch, OD-78) |
| Schedule published / acknowledged, broadcast | `team/schedule.service.ts:254,484`; `team/team.controller.ts:350` | Yes |
| Order approval, delivery, price | `procurement.service.ts:1062,1368` | Yes |
| Weekly report ready, delivery ETA, audit, event prep, custom reminders | **Seven** tenant-scoped `@Cron`s in `communications/scheduled-tasks.service.ts`, anchored on the decorator's `name:` rather than a line: `daily-sms-summary`, `weekly-email-report`, `recurring-order-reminder`, `delivery-eta-notification`, `inventory-audit-reminder`, `event-prep-check`, `custom-reminders-check` (`:193,228,407,522,625,679,734` — an eighth, `payment-due-reminder`, was deleted 2026-09-02 after [ADR 0077](../decisions/0077-there-is-no-payment-due-reminder.md) found it had never sent one email). Separately, `tenant-isolation-check` (`:159`) is the global tenant-isolation RPC, not a tenant-scoped one. **Count them with `grep -nE '^[[:space:]]*@Cron\('`** — a bare `grep @Cron` also hits `:274`, a `@deprecated` note recording that `sendMiddayLowStockReport`'s schedule was *removed* | **Per-tenant since 2026-08-26** (OD-87 / [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md)) — each iterates `ScheduledTenantsService.runPerTenant`, isolating per-tenant failures. But enumeration is **explicit opt-in** and no restaurant has opted in, so in practice this still serves exactly the `DEFAULT_RESTAURANT_ID` restaurant, which still takes its recipients from `MANAGER_EMAIL`. Whether that stays opt-in is **OD-91** |
| Agent-side writes | Historically silent-failing until 44.1d (`v3.0-TECH-DEBT.md:95-131`) | Fixed |

### Writes

| Write | Downstream reaction |
|---|---|
| read / unread / archive / delete | Unread badge in the sidebar and header bell recompute (`Sidebar.tsx:410`, `Header.tsx:191`) |
| Custom one-tap action | **none** — lives in `useState` until refresh |
| One-tap execute (order approve) | Goes through the orders API and dispatches a realtime inventory/order update (`OneTapActionCenter.tsx` dispatchers) |
| Snooze | `localStorage` only (`OneTapActionCenter.tsx:83,97,111`) — not shared across devices |

## 12. Design intent

**Should be:** the queue of things that need a person, oldest first, each one
resolvable without leaving the row.

| State | Handled? | Evidence |
|---|---|---|
| Loading | **No** | `_isLoading` discarded (`:157`) |
| Empty | Yes | Empty-inbox render |
| Error | **No** | `_error` discarded — the single most consequential omission on the page: this is the surface that is supposed to prove the system is watching |
| Permission-denied | **No** | No 403 branch |

**Where the UI misleads**

1. "Create custom one-tap action" is a full modal with icon/colour/priority/URL
   pickers and a live preview (`:1368-1691`) for an object that is discarded on
   navigate-away.
2. An empty inbox after a failed fetch is indistinguishable from a calm restaurant.
3. Snoozes are per-browser; nothing says so.

**Amendment 2026-09-02 — the redesign's state table** (flag on; the rows above still
describe the legacy page):

| State | Handled? | Evidence |
|---|---|---|
| Loading | **Yes** | `Register.state === 'loading'` → skeleton bars and *"Opening the book…"*; no count is claimed |
| Empty | **Yes** | said in words per band, and distinguished from unreadable |
| Error | **Yes** | `role="alert"` naming the register and quoting the failure; *"The book is unknown, not empty."* |
| Permission-denied | **Yes** | 403/401 → *"refused this account"*, no retry button (retrying cannot help) |

All three "where the UI misleads" items are addressed on the rebuilt surface: the create
modal now writes to the gateway; an empty inbox after a failed fetch is impossible
(the failure has its own state); and the per-browser nature of *Set aside* is printed
next to it and in the footer.

## 13. Roadmap

1. ~~**Branch on `error`**~~ (`Notifications.tsx:157`) — **done on the rebuilt surface
   2026-09-02** (`notifications/next/useNotificationsNextData.ts`). Still open on the
   legacy page, which is what renders with the flag off.
2. ~~**Persist custom one-tap actions**~~ — **done 2026-09-02**, `POST /one-tap-actions`
   from `notifications/next`. Was correctly diagnosed as wiring, not new backend.
3. **Move snoozes server-side** onto the same module (`:246` cancel, `:118` pending).
   Unchanged: the redesign renames snooze to *Set aside* and prints that it is
   per-browser, which makes the gap honest, not closed.
4. ~~**Make the eight scheduled crons per-restaurant**~~ — **done 2026-08-26**
   (OD-87 / [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md)).
   All eight now iterate `ScheduledTenantsService.runPerTenant`, with per-tenant
   failure isolation and a `SCHEDULED_JOB_SUMMARY` line per run. **Still true:
   "the rest get none, with no UI saying so"** — enumeration is explicit opt-in
   via `restaurant_feature_flags(flag_name = 'scheduled_communications')`, there
   are no flag rows, and nothing on this page surfaces which restaurants are
   opted in. That surface is unbuilt; whether it should exist at all depends on
   OD-91.
5. ~~Loading skeleton for the first fetch.~~ — **done on the rebuilt surface 2026-09-02.**
6. Rebrand `QuickGmailModal` previews (§7).

**Added 2026-09-02 by the Mudavym rebuild — all outside `pages/notifications/next/`,
none built here.**

7. **Add `apps/web/src/pages/notifications/next` to `SCAN_ROOTS`** in
   `scripts/check_no_seeded_defaults.py` (§9.5). One line; verified PASS already.
8. **Let a producer raise a one-tap action** — call
   `OneTapActionsService.createSystemAction` from the low-stock sweep
   (`notifications/low-stock-alerts.service.ts:312,354`) and/or procurement
   (`procurement/procurement.service.ts:1062,1368`). Until then the `--calm` band's
   house half is structurally correct and permanently empty (§9.1).
9. **Implement `triggerWorkflow`** (`one-tap-actions.service.ts:404-430`) or rename the
   endpoint to what it does. Today the page has to explain that "done" is a record,
   not a reorder (§9.2).
10. **Carry the `{ total, hasMore }` envelope in the shared service**
    (`services/api/notifications.ts:101-107`) so the header bell and sidebar badge stop
    silently reporting the newest 20 as if it were the whole book (§9.3).
11. **Server-side filters instead of client chrome** — `GetNotificationsQueryDto`
    already accepts `type`, `status`, `dateFrom`, `dateTo`. When the book outgrows one
    page, wire those rather than reinstating the legacy search box (§1b).
12. **One home for notification preferences** — the redesign drops the in-page
    `?tab=settings` panel; `/settings` (rebuilt in the same wave) should carry the
    `GET/PATCH /notifications/preferences` section, and the sidebar/bell should link
    there.

**Added 2026-09-03 by the second pass.**

13. ~~**Stop the producers writing emoji into notification titles**~~ — **done
    2026-09-03**, twelve call sites plus a scanning guard (§1b).
14. **Give the command palette an appendable registry** so a page can contribute an
    entrance to its own surface (§9.8), then add *One-tap actions* to it. The
    founder named the palette as a second way in; today it would require editing
    `components/CommandPalette.tsx`, which no page owns.
15. **Let a line state its own rule and its history** (§9.9) — threshold, observed
    value, 90-day fire count, and a "this rule is too loud" control that retunes the
    par rather than muting the notification. Drawn as *proposed* in both 089
    sketches. DESIGN-FOUNDATION §6, **need it: now**.
16. **Subdue by settlement, not by reading** (§9.10) — grey a line out when the
    credit note lands, the PO goes out, or the price returns to range.
    DESIGN-FOUNDATION §6 names this as the idea only a ledger can have, **need it:
    now**. It is also the honest fix for the biggest remaining lie on the page: a
    resolved line that still asks.
17. **Later, from the same lens** — the service-shaped inbox (grouped before /
    during / after service rather than by timestamp), truck-inbound as a
    self-expiring item promising only the window the vendor actually stated, and
    context-aware batching that does not batch what is already on screen. All three
    are DESIGN-FOUNDATION §6 "later"; none is built.
