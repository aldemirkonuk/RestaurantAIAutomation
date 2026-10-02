---
type: page
route: /
slug: dashboard
softwares: [dashboard-home]
component: apps/web/src/pages/Dashboard.tsx
audience: owner
tier: core
archetype: canvas # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-09-05
links: ["[[PAGE-CONTRACT]]", "[[reports]]", "[[inventory]]", "[[orders]]", "[[calendar]]", "[[wines]]"]
---

# / — Dashboard

> **Part of** [[08-softwares/dashboard-home|Dashboard Home]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **KPI card: Revenue** → [[reports]] `/reports` (its modal's "Full report" → `/reports?focus=revenue`)
- **KPI card: Inventory** → [[inventory]] `/inventory`
- **KPI card: Orders** → [[orders]] `/orders`
- **KPI card: Low stock** → [[inventory]] `/inventory?filter=low`
- **Reorder / Reorder selected** → [[orders]] `/orders?draft=new&…`
- **Low-stock row** → [[inventory]] `/inventory?highlight=…`
- **Calendar strip day / Add Event / important date** → [[calendar]] `/calendar?date=…` / `?openModal=true`
- **Recent order row / View all** → [[orders]] `/orders?orderId=…`
- **Top wine row** → [[wines]] `/wines?search=…` or `?wineId=…`
- **Reports View all** → [[reports]] `/reports`
- **Quick Actions panel** → user-configured shortcuts (any internal route or external URL)

## Active branch cache correction — 2026-09-13 (pending release)

The month-ledger cache key includes restaurant as well as year/month. Cache hits and unmounts invalidate older in-flight reads, so returning to cached house A cannot later render house B's delayed calendar response. Two hook tests exercise both the same-month branch switch and the late-response race.

## 1. Purpose

The owner/manager landing page: today's KPIs (revenue, stock, orders, alerts), a
reminders list, a calendar strip with important dates, recent activity, and the
One-Tap Action Center for approvals and low-stock reorders. Sidebar tooltip says it
plainly: "Today's KPIs, alerts, and the actions worth doing first"
(`apps/web/src/components/layout/Sidebar.tsx:63`).

## 1a. Features
- See today's KPI tiles: revenue, stock, orders, alerts
- One-Tap Action Center: approve pending orders and low-stock reorders in one tap (with email preview)
- Reminders list and a calendar strip with important dates; add your own important date
- Recent activity feed and sales chart
- Quick-actions panel; right-click context menus on cards
- Switch between restaurants/branches
- Live updates while the page is open (realtime calendar/inventory events)

**Mudavym redesign** (flag `mudavym_design_dashboard`; legacy renders unchanged
while the flag is off — `apps/web/src/pages/dashboard/next/`):

- **Waiting-on-you approves behind a PROVEN seal** (added 2026-09-04, founder's
  call in the ADR 0116 addendum) — the hold mints a one-time challenge bound to
  this manager, this order and that order's own total and vendor, and the write
  carries it back; a mint that fails approves nothing and says so on the
  control. The card renders the same `components/orders/SealedApproveDie.tsx`
  the legacy `/orders` desk does, so there is one mint path, and a 403 from the
  gateway is printed as itself rather than as a claim about the network
- **One-tap actions live on the rail, under *Waiting on you*** (added 2026-09-03 by
  the founder's decision; they were built inside `/notifications` in the p4 first
  pass and moved here). `apps/web/src/pages/dashboard/next/OneTapPanel.tsx` reads
  `GET /one-tap-actions` tenant-keyed, writes through
  `POST /one-tap-actions{,/:id/execute,/:id/cancel}` — all on the class-guarded
  `OneTapActionsController` — and is self-contained: its own types, its own read,
  its own honesty states, nothing imported from another page.
  - An action **the house raised for itself** is told apart from one a person wrote
    *structurally*, not by tone: `createSystemAction` inserts no `user_id`
    (`one-tap-actions.service.ts:366-382`) while `POST /one-tap-actions` stamps the
    caller (`:150-152`), so an absent author is the proof. A house-raised card
    carries the `--calm` dashed edge and can never look carried-out.
  - Committing gets the wax — `HoldToApprove` completing into the seal — because it
    is a durable server write stamped with your identity. Cancelling and navigating
    are plain controls.
  - **The first real action landed 2026-09-05, sealed** (founder: *"extend the seal
    to it when the first real action lands, but RUN the ecosystem to run the first
    real action"*). `triggerWorkflow` — three `// TODO` branches and a default log,
    called AFTER the row was stamped `completed` — is replaced by a census with
    three outcomes (`apps/api-gateway/src/one-tap-actions/one-tap-workflow.ts`,
    mirrored for the browser in `pages/dashboard/next/one-tap-acts.ts`):
    - **`delivery_confirm` is real and is the only control here that carries the
      seal.** The hold mints a one-time challenge bound to this manager, the ORDER
      the card names, the act `deliver` and the stock about to move
      (`POST /one-tap-actions/:id/seal-challenge`); the gateway redeems it BEFORE
      calling `ProcurementService.markDelivered`, and the card then says how many
      bottles were booked, from what the gateway recorded. Proven, then done, then
      recorded — in that order.
    - **A written action is a record. How it CLOSES is being tried both ways**
      (added 2026-09-05 the same day, the founder: *"lets try both, 80 percent
      simple 20 percent signature"*). Eighty per cent of houses get the plain
      button; twenty get the hold. The arm is the gateway's, per house,
      deterministic, and frozen the first time it is asked
      (`GET /ux/experiments/note_close_control` →
      `apps/api-gateway/src/ux-optimizer/experiments.ts`, table
      `ux_experiment_assignments`). The browser never chooses one. ADR 0127.
      - **The die on a note is a GESTURE, not a seal, and the card says so** — no
        `onChallenge` is passed, nothing is minted, nothing is redeemed. The
        original objection is not withdrawn and is what the experiment is for: a
        die meaning "recorded" beside a die meaning "done" is how the seal stops
        meaning anything (§13.10's answer, now under test rather than settled).
        **Measured cost, in the captures:** at rest the two holds are visually
        identical and only the sentence above each tells them apart.
      - **Exposure and outcome go to `neural_footprint_event`** as
        `subject_type: 'operator'` — the first operator rows anything writes;
        until now the model client was the only writer and it writes `'agent'`.
        Three events in both arms — `exposed`, `completed`, `abandoned` — with
        the arm stamped by the SERVER from the stored assignment, never sent by
        the browser. Time-to-complete rides on `duration_ms` and is measured from
        EXPOSURE, because press-to-complete would compare 0ms against `pour.ms`'s
        620 by construction.
      - **When the arm cannot be read, the card draws the plain control, SAYS it
        is a fallback rather than an assignment, and records nothing at all.**
        The server would stamp this house's stored arm, which may be the die, and
        filing a plain exposure under the die is worse than not counting it.
      - **The counts are a floor and the page says so.** A tab closed outright
        records no abandon (the web app may not reach the gateway with a
        keepalive fetch — `__tests__/no-raw-gateway-fetch.test.ts`); both arms
        lose exactly the same cases.
      - **The experiment ENDS one quarter after its first exposure** (added
        2026-09-05, batch 45 — ADR 0127's addendum). The date is DERIVED, never
        typed: the earliest exposure across all houses plus 91 days (13 whole
        weeks), computed once and then frozen in `ux_experiment_state` so that
        editing the constant cannot move the finish line under a running
        experiment. After it, no new exposure is recorded, no new house is
        enrolled, and the assignment rows are kept as the record of what each
        house was shown.
      - **After the end, every house gets the arm the founder NAMES — and until
        then, none.** `POST /ux/experiments/:key/winner` writes the arm once (a
        second, different arm is refused by the service and by a database
        trigger). Until it is called, the report says the experiment has ended
        and that no winner is recorded; it never falls back to `plain` and calls
        that a result. The footer line says which of those two it is.
      - **The founder alone reads BOTH arms.** `GET
        /ux/experiments/:key/both-arms` returns, per arm, houses assigned,
        exposures, completions, abandons and the date of first exposure — counts
        and dates only, with no restaurant id anywhere in the payload, so a
        house's identity is never returned beside its arm. It is gated by the
        platform-admin service key (`X-Admin-Key`, ADR 0099), not by a role:
        `RolesGuard` knows owner, manager and staff, all three of which are roles
        *within* a house. The per-house report is unchanged and still shows one
        house its own arm.
    - **The report line sits in the page's own signature footer**, not on
      `/notifications` and not inside the panel. The day-book is a RECORD, which
      is the argument that moved the desk off it (§1b, [[notifications]] §1b) and
      applies to a running tally just as much; and putting the count under the
      card it counts is the surest way to change what it measures. It prints
      counts and the ratio, never a comparison. **It can only ever show this
      house's own arm** — see §9.
      **[changed 2026-10-01: the report line left this footer for the /logs foot
      (DASH-W5, founder: "Approve"; `logs.md` §1a now lists it; ADR 0127 option 8
      (:120-121) is amended by PR #565). The dashboard footer carries only the
      procurement sentence.]**
    - **Every other act is disabled and says what is not built** — the reorder in
      particular, because placing the order needs a vendor and an agreed price the
      card does not carry and would open a priced negotiation with the vendor. The
      gateway refuses them too and leaves the row `pending`: ADR 0083, a control
      may not claim a write it never makes.
  - **The house half is permanently empty today** — `createSystemAction` has no
    production caller, so the panel truthfully shows "Nothing standing" rather than
    implying the house is idle. See §9. *Measured 2026-09-03 against the local
    gateway:* `GET /one-tap-actions?restaurantId=…` returns
    `{ actions: [], total: 0, pending: 0, completed: 0 }` — a real empty register,
    which is exactly the case the panel must not draw as health.
  - Writing a standing action **persists** on the server against the restaurant, so
    it survives a refresh and every member sees it. (The legacy
    `OneTapActionCenter` rebuilt actions client-side into `localStorage`.)
  - All four states, each real: loading (skeletons), empty (said in words), broken
    read (the failure quoted), refused read (403 told apart from a 500, no pointless
    retry). The pending count is an em dash, never a zero, while the register is
    unread.
  - **A one-tap action of your own is a SHEET** (built 2026-09-06, packet 2 of the
    overlay layer; census 102 · ADR 0112). `pages/dashboard/next/OneTapSheet.tsx`.
    Until this landed the rail could raise an action from a four-field expander and
    nothing else — the two legacy surfaces it replaced could do more, and that gap
    is what the packet calls an *owed act*.
    - **What it does now.** Writes one (`POST /one-tap-actions`,
      `one-tap-actions.controller.ts:146`), CHANGES one already on the rail
      (`PUT /one-tap-actions/:actionId`, `:195`) and TAKES ONE OFF it
      (`DELETE /one-tap-actions/:actionId`, `:333` — a soft delete). Every one
      takes the restaurant and the author from the token; the sheet sends neither.
      Only a person-written card offers *Change it*; a house-raised one never does.
    - **The mark, not a colour.** The legacy icon picker carries over as a closed
      set of eight lucide marks the card actually renders (`markFor`). The legacy
      six-colour theme picker does NOT: ADR 0112 rule 8 gives this house one
      chromatic colour, so the field is dropped rather than re-skinned and the
      gateway's `color` column simply never hears from this sheet.
    - **The href rule is the legacy's own**, restated with its citation
      (`data/quickActions.ts:206`): `/`, `https://` or `http://`, and nothing is
      posted until it holds.
    - **Two of the census drawing's three triggers do not exist and say so.**
      "When I tap it" is the built one; "On a threshold" and "On a schedule" are
      disabled with the sentence that names what is missing — `one_tap_actions`
      carries no trigger column and nothing reads it on a clock (ADR 0083).
    - **Esc tears the sheet, it does not bin it** (sketch 103, 1b — *The Stub*).
      The draft lives on the panel, so leaving a NEW action holds the words on the
      rail and re-opening finds them; leaving an EDIT keeps nothing, because a
      half-typed change to a row that already exists is a confusion, not a stub.
    - **Its accessible name is the contract** (sketch 103, 1e — *Announced*): what
      it asks, what it writes, and that leaving writes nothing.
    - Proved by `OneTapSheet.test.tsx` (17 assertions); 14 of them fail against a
      copy of the pre-packet `OneTapPanel.tsx`.
  - **A tenant switch never leaves the previous house's actions on screen.** The
    reset effect blanks the register the moment `restaurantId` changes
    (`OneTapPanel.tsx:135-139`), and a response that arrives after the switch is
    discarded rather than rendered (`:148,151`). Both halves are pinned by
    `OneTapPanel.test.tsx` ("discards a response that lands after the restaurant was
    switched" and "shows nothing from the previous house while the new one is still
    loading"); with either guard removed, both fail.

- **Decided 2026-09-21, built 2026-09-21 (reduced scope, stated):** sketch 119 direction E's *day line* is a PAGE element on this page's own first line, not chrome (the founder's shell pick, ADR 0160 review trail of that date) — `DayLine.tsx`, mounted above the KPI row, self-gated on the `shell` flag. Ships THREE of the sketch's six registers this session (deliveries that arrived, today's calendar, today's reminders — one shared `GET /house/day` read, `house-day.service.ts`), and draws a wrapping row of tick chips rather than the sketch's pixel-timed band with DOM-measured no-overlap labels. Not built, each its own reason (`house-day.types.ts`'s doc comment has the full one): `deliveryExpected` (the sketch's own README: "capturing the vendor's promised window is new work this sketch has not costed" — a data-capture decision of its own), `shifts` (real schema, but a correct read needs the house's local "today" to pick the right ISO week and a role-based choice between `getWeek`/`getMyWeek` — a bounded follow-up, not a one-line addition), `market` (the standing no-placeholder-row rule, same as the counter's Judge row). Honesty rules built: hours unset says so in words and the ticks still draw; offline holds the last read and marks it stale, never live; a register that did not answer is named with "Read again", never silently shorter; "N of 3", never a bigger denominator for a register this build does not read. The shell itself is D, the counter; its feature list is in `DESIGN-FOUNDATION.md` §3 item 2.

- **[changed 2026-10-01: founder walk-through, §14 rows DASH-W1 to W37, PR #579 on `fix/review-dashboard`]** What the redesign now does:
  - **Figures.**
    - Every figure, "today", the greeting and the calendar are on the house's clock (W2, W20).
    - On the gateway, the four routes the page reads (stats, activity, alerts, calendar-revenue) fail the call when a read fails, instead of answering empty (W3, W6, W11). On the page, a failed read of the figures, approvals, Running low, the month or the week is said with "Try again" (W19). Not yet: Lately and the calendar's alerts have no failure line, and both the shared client (queued) and the page's own hook turn a failed alerts or activity read into an empty list. **[changed 2026-10-01: second PR #579 audit; it said only the shared client, and every read.]**
    - On the dashboard's own routes, staff see counts and never amounts, and the gateway stops sending them the amount fields (W22). Free text, such as an event's description, is not withheld (G6). While the role is unknown the page shows no amounts (G5). Not yet: `/procurement/orders/pending` and `/history`, which the page also reads, still send prices to staff (queued with /orders).
    - Waiting on you offers the hold only to a role that may approve (W21).
  - **Calendar.**
    - A future day with an event opens (W13), and past days fade (W17).
    - The month and the open day live in the address, `?month=` / `?day=` (W29).
    - Each square is named in words, marked open or today (W35).
    - Closing the day panel hands focus back to the square (W34).
  - **Links.** Lately and Running low lines open the order or the item (W14). Order links go to `/orders?order=<id>` (W12 → W16).
  - **Words.**
    - Singular and plural are right (W7).
    - Lately and the event kinds read in words, not codes (W4, W32).
    - No internals or experiment narration (W5, W24, W24b, W25, W28), and the sheet's count agrees with the desk (W27).
    - The page counts "items", never "wines" (W37).
  - **Layout and contrast.**
    - Tile subtitles are whole (W26), and list rows wrap to two lines instead of cutting (W31).
    - The delivery row keeps its vendor at every width (W30).
    - Captions are painted in ink-4, never ink-3 (W33).

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_dashboard`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, ~~the theme menu~~ and the account menu **[2026-10-01: the theme
> menu left the header — founder, page walk-through DASH-W23; the ground is chosen on
> `/profile`]**. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/dashboard/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `open-arrive` | Opening line entrance | the Fraunces "Good evening / before service" header, once on mount |
| `cal-arrive` | Staggered arrival | every real day cell of the sales calendar, per month paint |
| `kpi-tally` | Figures arrive | the five KPIs + "Waiting on you" count; an em dash never counts |
| `day-open` | Settle expansion | the day-detail panel; each Waiting-on-you row into its HoldToApprove |
| `tuck` | The overlay primitive's right slide-in, 300ms | **A one-tap action of your own** — `OneTapSheet`, the rail's own sheet (built 2026-09-06). `prefers-reduced-motion` renders none, from `components/mudavym/Sheet.tsx` and nothing local |
| `day-scrub` | Scrub the day | the tape strip in day detail — un-eased on purpose, per-day samples |
| `hold-pour` / `seal-stamp` | Hold-to-approve → the seal lands | the approvals queue **and** (2026-09-05) the ONE one-tap card whose act is real — a delivery confirmation, whose hold mints the seal the write carries back. The rail's written-note card lost the die that day: it is a record, and the wax is rationed to the act that moves stock. The seal only stays if the server said yes |
| `ink-micro` | Micro-states | hovers/focus, nothing moves more than 2px |
| `skel-sheen` | Honest skeletons | genuinely in-flight fetches only — never for "unknown" |

Deliberate non-motions: unknowns never animate; month navigation does not slide;
scrubbed figures do not tween; the one-tap panel's dashed cards never pulse — an
action the house raised and did not carry out must look inert. A card whose act is
not built has no motion at all: its control is disabled, and a disabled control that
animates is a control that looks pressable.

### Why the one-tap desk is here and not on `/notifications` (2026-09-03)

The founder's call, after the p4 first pass built it into the day-book. The full
three-way argument — here, `/notifications`, or a command-palette-only surface, and
what each costs — is written once in [[notifications]] §1b "Second pass"; the short
version is that `/notifications` is a **record** worked downwards until an account
is ruled off, while a standing action is **work** whose natural end is to go away,
and two opposite lifecycles in one column is what made the first pass need a rail to
hide the contradiction in. On this page the adjacency is right: an order waiting to
be sealed and an action the house raised for itself are the same kind of object.

The cost, stated: this page now carries a **second** `HoldToApprove`. The rationing
rule exists so the seal does not become routine, and two dies on one screen is the
closest this design has come to spending it. It is defensible only because both are
durable, identity-stamped server writes — the moment a third appears for something
reversible, the ceremony should be taken off one of them.

**Resolved 2026-09-05.** The rail's die was on a card that RECORDED a decision while
the queue's die APPROVED an order, and the two looked identical. The wax now sits
only where a write leaves the page: approving an order, and confirming a delivery
that books stock through the ledger. A written note is marked done with a plain
button. The page still carries two dies, and both are now sealed writes proven by
redemption rather than asserted — which is the condition §13.10 asked for.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/`** — Four legacy modals, none of which survives as an overlay: three retire into surfaces the rebuilt page already has, and the figure detail becomes an in-place expansion under the KPI row (decided 2026-09-05, F7 — still to build).

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/` | The working behind a figure | — | Retires · fork F7 | Decided 2026-09-05 (F7): the KPI row expands in place — 'show the working' under the figure, like DayDetail under the sales calendar. Not an overlay; the expansion is still owed on KpiRow.tsx. | `pages/Dashboard.tsx:1109 — the Vendor Spend · Active Inventory · Pending Orders · Low Stock detail modals; nothing on pages/dashboard/next/KpiRow.tsx opens today` |
| `/` | A one-tap action of your own | sheet | Built · fork F4 | A person's own act is one object on the rail; the rail stays producer-defined otherwise. BUILT 2026-09-06 (packet 2): pages/dashboard/next/OneTapSheet.tsx — write, change and take off the rail against POST/PUT/DELETE /one-tap-actions; the mark carries over, the colour theme does not (one chromatic colour), and the two unbuilt triggers say so. | `components/dashboard/QuickActionsPanel.tsx:332 and pages/Notifications.tsx:1705 (legacy); built by the founder's ruling 2026-09-05` |
| `/` | Add an important date | — | Retires | The calendar's entry sheet — the house has one day-book (ADR 0111). | `components/dashboard/AddImportantDateModal.tsx:125` |
| `/` | Edit a quick action | — | Retires · fork F4 | One-tap actions moved to the dashboard rail (OneTapPanel). A person's own action is built as the sheet drawn above (decided 2026-09-05, F4). | `components/dashboard/QuickActionsPanel.tsx:332` |
| `/` | Daily sales report (a day) | — | Retires | DayDetail expands in place under the sales calendar (pages/dashboard/next/SalesCalendar.tsx:217). | `pages/Dashboard.tsx:1414` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

## 2. Entry

Most-linked page after `/login` — in-degree 5 ([PAGE_MAP](../foundation/PAGE_MAP.md):139):
from `/admin`, `/get-started`, `/invite/:code`, `/onboarding`, `/register`. Also:

- Sidebar "Dashboard" (`apps/web/src/components/layout/Sidebar.tsx:60-64`).
- Catch-all `*` redirects here (`apps/web/src/App.tsx:302`), so every bad URL lands on it.
- One of four eagerly-loaded pages — not lazy (`apps/web/src/App.tsx:63`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:254`.
- `apps/web/src/pages/Dashboard.tsx` (1,849 lines) — view.
- `apps/web/src/pages/dashboard/useDashboardPage.ts` + `index.tsx` — page hook (data shaping, calendar revenue).
- Key co-located renders: `components/notifications/OneTapActionCenter.tsx` (Dashboard.tsx:477),
  `components/dashboard/QuickActionsPanel.tsx` (:482), `components/dashboard/AddImportantDateModal.tsx` (:1838),
  `components/ui/ContextMenu.tsx` (six mounts, :1570-1802).
- Data hooks: `hooks/useDashboardData.ts`, `hooks/useInventoryData.ts`, `hooks/useOrdersMetrics.ts`,
  `data/manualImportantDates.ts` (Dashboard.tsx:41-56).
- Mudavym redesign (flag-gated): `apps/web/src/pages/dashboard/next/` —
  `DashboardNext.tsx`, `SalesCalendar.tsx`, `DayDetail.tsx`, `KpiRow.tsx`,
  `WaitingOnYou.tsx`, `RailPanels.tsx`, `CountUp.tsx`, `useDashboardNextData.ts`,
  `format.ts`, `fonts.ts`, `dashboard-next.css`, `MOTIONS.md`, and — added
  2026-09-03 — `OneTapPanel.tsx` with `OneTapPanel.test.tsx` (12 tests,
  `apiClient` mocked). The panel is mounted at `DashboardNext.tsx:141`, directly
  under `<WaitingOnYou/>`.

## 4. Endpoints

All via `apiClient` (base `${VITE_API_GATEWAY_URL}/api/v1`, `services/api/client.ts:51`)
unless noted. Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):197 (`dashboard`, 8 —
atlas's **"all unguarded"** row is stale; guarded at class level since 2026-08-25 (#60),
`apps/api-gateway/src/dashboard/dashboard.controller.ts:51`),
:87 (`calendar`), :249 (`inventory`), :389 (`procurement`), :663 (`wines`).

| Method | Path | Call site |
|---|---|---|
| GET | `/dashboard/stats/:id`, `/dashboard/activity/:id`, `/dashboard/alerts/:id` | `hooks/useDashboardData.ts:74-79` → `services/api/dashboard.ts:23,70,87` |
| GET | `/dashboard/sales-chart/:id` | `hooks/useDashboardData.ts:205` → `services/api/dashboard.ts:109` |
| GET | `/one-tap-actions?restaurantId=` | **Mudavym only** — `pages/dashboard/next/OneTapPanel.tsx` `useOneTapActions` (moved here from `/notifications` on 2026-09-03) |
| POST | `/one-tap-actions`, `/one-tap-actions/:id/execute`, `/one-tap-actions/:id/cancel` | **Mudavym only** — same file; `OneTapActionsController` is `@UseGuards(JwtAuthGuard)` at class level (`one-tap-actions.controller.ts:64`) |
| GET | `/dashboard/calendar-revenue/:id` | `pages/dashboard/useDashboardPage.ts:227` → `services/api/dashboard.ts:227` |
| GET | `/calendar/events` | `useCalendarEvents` (useDashboardPage.ts:7) → `services/api/calendar.ts:221` |
| GET | `/wines` | `useWines` → `services/api/wines.ts:30` |
| GET | `/inventory/:id` + `/low-stock` + `/summary` | `hooks/useInventoryData.ts:15` → `services/api/inventory.ts:66,118,129` |
| GET | `/procurement/orders/pending` (+ list) | OneTapActionCenter.tsx:45 → `services/api/orders.ts:206,217` |
| GET | `/api/v1/calendar/ical-token` | **relative `fetch`**, `pages/Dashboard.tsx:267` — see §9 *[corrected 2026-09-21: calendar links are personal (ADR 0111 review trail) — the legacy dashboard no longer reads it; its button opens `/calendar?connect=1`]* |

## 5. Signals

**None.** No `uxSignals` import anywhere in the tree; the client reporter ships dark
(`VITE_UX_OPTIMIZER` gate, `apps/web/src/lib/uxSignals.ts:15`) and its only consumer,
`hooks/useUxOverrides.ts`, is imported by no page. Guidance's `trackGuidance` pushes
to a `window.dataLayer` that is never bootstrapped (`guidance/analytics.ts:29-39`; no
GTM in `index.html`) — dev-console only.

## 6. Tier cut

**Core** — operate ([TIER-MAP](../03-scenarios/TIER-MAP.md):10). Scenario surface:
S10 (low-stock alerts land here as one-tap reorders) and S15 (the in-app digest panel
is the owner's landing experience). Both are Core rows in the matrix (TIER-MAP:46,51).

## 7. Rebrand surface

Page tree: **0** user-visible strings. Reachable-but-shared:

- One-tap email modal shows "WineOps AI" branding in preview/sent HTML —
  `components/emails/QuickGmailModal.tsx:129,145,153,189,200` (opened from OneTapActionCenter).
- Layout chrome on every DashboardLayout page: "WineOps AI" wordmark
  (`components/layout/Sidebar.tsx:484`), aria-label (`:469`), BrandMark alt (`components/brand/BrandMark.tsx:17`).
- Not visible: localStorage keys `wineops_*` (`OneTapActionCenter.tsx:80-83`).

## 8. State & config

- `VITE_API_GATEWAY_URL` for all API calls; `VITE_UX_OPTIMIZER` (dark, §5).
- One-tap actions, shadow stock, order history, snoozes persist in localStorage
  (`OneTapActionCenter.tsx:80-83`).
- Realtime: `useRealtimeDispatch` calendar-event payloads (`Dashboard.tsx:46`).
- Restaurant switching via `useAuthStore`/`useRestaurantSettingsStore` (`Dashboard.tsx:50`).

## 9. Gaps

**[changed 2026-10-01: founder walk-through (§14).]**
- **Closed in the gateway** (PR #579):
  - The tiles and the calendar counted the same money two ways (W2).
  - A failed read showed as zero (W3, W11), in the gateway's four routes the page reads; a failed alerts or activity read still shows as an empty list on the page (shared client and page hook), and three routes no page reads still answer empty.
  - Lately printed internal codes (W4).
  - The calendar's spend query asked for a column `procurement_orders` does not have (W6).
  - An unused `wine_consumption_log` read ran on every load (W8).
  - The cellar tile read every inventory row (W10).
- **Closed on the page:** see §1a's dated bullet.
- **Still open, owned elsewhere** (queued in `p4-scratch/review-shared-queue.md`, R1b lines):
  - /choose-house's unmasked email (W9) and /orders' one-word note column (W15).
  - ~~The theme control's move to settings (W23).~~ Shipped in PR #576 (the ground is chosen on `/profile`).
  - The /logs half of the experiment line (W5).
  - The shell focus ring at 1.68:1 and no skip link.
  - ink-3 captions on 10 other files, and the DayLine font.
  - `/auth/me` read twice a load against a 10-a-minute auth bucket (429s seen live).
  - TenantGuard log noise; the old brand in the socket greeting; no CORS `maxAge` (production pays a preflight per call).
  - "items" on every other page.
- **Still open, found by the PR #579 audit** (`.planning/tech-debt.d/2026-10-01-fix-review-dashboard.md`):
  - `/procurement/orders/pending` and `/history` still send prices to staff (the server half of W22).
  - A failed alerts or activity read shows as an empty list: the shared client and the page's own hook both empty it, and Lately has no failure line (the web half of W11).
  - Three dashboard routes no page reads (`sales-chart`, `inventory-breakdown`, `summary`) still answer empty on a failed read.
  - Read errors reach the client with table names and PostgREST text.
- **Not verified:**
  - Real touch and the day-tape drag on a phone.
  - A real screen reader, and reduced motion live.
  - Production's page, because Chrome was not connected in P10.
  - The day panel's "Unnamed item", which has no test.

**The hold-to-approve seal read "Hold to approve · $0" over real orders — FIXED
2026-09-05.** `WaitingOnYou.tsx` read `o.totalPrice` and `o.unitPrice` off the shared
`Order` type; `OrderResponseDto` sends `totalCost` and `finalPrice` and has never sent
those two. `formatMoney(undefined)` returns the string `"$0"`, so the money column, the
`60 × $0` working AND the die a person holds to spend the money all read zero. Fixed
here, on `DayDetail.tsx` (`60 × $0 · $0`) and on `useDashboardPage.ts`/`Dashboard.tsx`
(top-wines spend summed from zeroes); `money()` is the em dash for an absent figure and
`approveLabel()` drops the clause entirely rather than putting a dash on the die, where
it reads as a rendering fault. Two new cases in `WaitingOnYou.seal.test.tsx` pin both.
The full consumer audit is `06-pages/orders.md` §13.16; the guard is
`scripts/check_web_reads_gateway_dto_keys.py`.

**~~The vendor name on the queue and the day panel is gone, not fixed.~~ FIXED
2026-09-05, batch 40.** Both had printed the literal word "vendor" off `providerName`,
which the route did not send; the clause was removed rather than faked, and the founder
then chose the gateway join. `/orders/pending` and `/orders/history` now select
`provider:provider_id(name)` in the statement they were already making, and both panels
print the name through `apps/web/src/lib/mudavym/vendor.ts` — `Vendor not named` where
the join answered nothing or the route does not join, never a blank, because a blank in
that slot reads as "there is no vendor". This matters most on **Waiting on you**: it is
the panel a manager approves money from, and it had been naming the wine and the total
and not the payee. `v3.0-TECH-DEBT.md` "The orders wire" item 1 is struck through.
~~*Blocker: founder.*~~

**The delivery card the one-tap desk raises is reachable for the first time (same
batch).** Not a defect of this page's own code but of the component it hosts:
`OneTapActionCenter` fetched PENDING/APPROVAL_NEEDED and CONFIRMED while its filter
accepted `approved` and `in_transit` — disjoint sets, so **zero** API-derived delivery
cards had ever been produced and every one on screen came from `localStorage`. It now
fetches CONFIRMED and IN_TRANSIT and filters on those two. Measured live on
`/dashboard` (Browser-pane network log, 2026-09-05): two calls,
`?status=CONFIRMED` and `?status=IN_TRANSIT`, where before there was one. Both answer
**500 — `column procurement_order_items_1.price_uom does not exist`** against the local
gateway, which reads PRODUCTION where ADR 0119 phase 1's migration is unmerged, so no
card could be rendered live here to photograph; the path is proved by the render tests
instead. That 500 is an ENVIRONMENT blocker, not a defect of this page.

- `pages/Dashboard.tsx:267` fetches `'/api/v1/calendar/ical-token'` **relative to the SPA
  origin**, bypassing `VITE_API_GATEWAY_URL` — works only where the web host proxies the
  gateway; every other page uses the absolute base (e.g. `pages/Settings.tsx:159`).
- All 8 `dashboard` endpoints are guarded since 2026-08-25 (#60) — `@UseGuards(JwtAuthGuard)`
  at class level (`apps/api-gateway/src/dashboard/dashboard.controller.ts:51`); the atlas
  row ([ENDPOINTS](../foundation/ENDPOINTS.md):197) still reads "unguarded" and is stale.
- `v3.0-TECH-DEBT.md:502` — dashboard profile card dead-click claim (L102) is *unverified,
  not confirmed*; the one-tap auth hole it fed is closed (`v3.0-TECH-DEBT.md:409`).

~~**The note-control experiment's report cannot answer the question it exists for
(2026-09-05, stated not hidden).**~~ **ANSWERED THE SAME DAY (batch 45), and the
diagnosis was right about the cause and wrong about the only cure.** Every read on
the `ux` controller is scoped to the caller's restaurant, and assignment is per
HOUSE, so a house is on exactly one arm and `GET /ux/experiments/:key/report`
**can still only ever show that arm's figures** — that route is unchanged, and the
footer line still names what it cannot show. What was wrong was "no role in this
codebase grants a cross-house read, so there is nothing to use". There is still no
founder or platform-admin ROLE — `role` on the JWT is per-restaurant
(`jwt.strategy.ts:56`) and `RolesGuard` knows owner, manager and staff, all three
of them roles within a house — but there is an existing platform-admin
CREDENTIAL: `X-Admin-Key` / `ADMIN_API_KEY`, the gateway↔orchestrator service key
ADR 0099 settled and `ServiceKeyGuard` enforces, which fails closed when the
secret is unset. `GET /ux/experiments/:key/both-arms` sits behind it and serves
per-arm counts and dates with **no restaurant id in the payload at all**, so the
cross-house read is granted without a house's identity ever appearing beside its
arm. Printing `plain: 0` beside a die house's numbers is still refused on the
per-house line, for the same reason as before.
Two floors remain, both stated on the line: an abandon is lost when a tab is
closed outright, and nothing is recorded at all while the arm is unreadable.

**The experiment's die may land on nobody, or on the only tenant that matters.**
Measured 2026-09-05: the one house the local gateway reaches
(`550e8400-e29b-41d4-a716-446655440000`, `GET /auth/me`) hashes to bucket **99 —
the die arm**. Production held ten restaurants and one real tenant at the last
count, so a 20% per-house split over that population is a coin flip about whether
either arm contains real traffic. A ratio is honoured; a sample is not guaranteed.

**Nothing has recorded a single row yet, and the table does not exist in
production.** `GET /ux/experiments/note_close_control/report` against the live
gateway answered **500 — "Could not find the table
'public.ux_experiment_assignments' in the schema cache"** (curl, 2026-09-05), **[CORRECTED 2026-09-12: no longer true -- `to_regclass('public.ux_experiment_assignments')` returns NOT NULL, measured that day. PR #289's 19 blocked migrations were applied through the connector on 2026-09-12 after a defect in `20260906020000` was fixed. The finding above is kept as the dated observation it was; do not infer from it that a missing table is guarding anything.]**
which is the read failing as a failure rather than as an empty report. Both halves
also need §13.13's producer before a real card is ever raised: `custom` notes are
written by people, so the note arm can be exercised today, but the desk is empty.

**Found while moving the one-tap desk here (2026-09-03).** Both are outside this
page's paths; neither was built here, and the rail panel states both in words.

- **`createSystemAction` has no production caller.** *(Re-measured 2026-09-05 and
  still true: `grep -rn createSystemAction apps/api-gateway/src apps/web/src services`
  returns the definition, two references in
  `src/__tests__/one-tap-actions.service.spec.ts:279,305`, and one comment.)*
  `apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts:351` is the only
  way an action is written *without* a human author, and its only references in the
  repo are in `src/__tests__/one-tap-actions.service.spec.ts:279,305`. So the "raised
  by the house" half of the rail panel is structurally correct and permanently empty:
  the producers that should raise one (the low-stock sweep, procurement) write
  notification rows only. **Owner: `notifications/low-stock-alerts.service.ts` and
  `procurement/`** — one `createSystemAction` call per producer.
- **CLOSED 2026-09-05 — executing a one-tap action used to do nothing but record it.**
  `triggerWorkflow` was three `// TODO` branches and a default log, called AFTER the
  row had been stamped `completed`, so the die reported success for a reorder that
  had not happened. Measured against a `git show HEAD:` copy of the service on
  2026-09-05: **22 of 22** cases in
  `apps/api-gateway/src/one-tap-actions/one-tap-execute.spec.ts` fail there, and the
  pre-fix service *resolves* `{"status":"completed","executionResult":{}}` for a
  `low_stock` card rather than refusing it. See §1a for what replaced it.
- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** when `getSalesChartData` rejects, the hook renders `Math.floor(Math.random()*5000)+1000` per day as sales (`hooks/useDashboardData.ts:205-230`; absence 1 — a failed read becomes a healthy business). "Vendor Spend (30d) $0 ↗ +0.0%" draws a green trend over a base with no purchase orders.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the Low Stock Alerts card reads camelCase (`Dashboard.tsx:998,1004,971`, modal `:1315-1320`) from a snake_case payload (`GET /inventory/:id/low-stock` → `v_low_stock_items`, `database.service.ts:57-62`), so all 7 real wines render as "Unknown wine" with blank counts (defect 1). **Fixed 2026-09-03** at the service boundary — `services/api/inventory.ts` (`normalizeInventoryItem` → `getLowStockItems`), the card's reads unchanged and now true, pinned by `inventory.lowstock.test.ts` and browser-verified on the sim tenant (all 7 names, real counts, in card and modal). "Top Performing Wines / This month's best sellers" never reads sales — `topPerformingWines` (`:327-345`) aggregates procurement orders and calendar entries — so it says "no sales performance data" over $2,236 of real sales.

**Closed 2026-09-04 — Waiting-on-you approves behind a proven seal.** ADR 0116's
addendum made an order approval a redeemed seal and left this card calling
`ordersApi.approveOrder(order.id)` with an id alone (`WaitingOnYou.tsx:33`), so
every approval from the dashboard would have been refused the moment that
merged — and the card would have said "the approval didn't reach the server",
a claim about the network that a refusal makes false. The founder chose the
hold gesture over a one-click mint-and-approve. The card now renders
`components/orders/SealedApproveDie.tsx` — the SAME control and the same mint
as the legacy `/orders` desk, so there is one implementation of "exactly once"
outside `pages/orders/next` — which mints when the gesture BEGINS, approves
nothing if the mint fails, prints a 403 as itself and keeps the generic line
only for a failure carrying no decision. Proven by `WaitingOnYou.seal.test.tsx`
(9 cases; 6 of 8 render cases fail against the `git show HEAD:` copy). Not
proven live: the tenant reachable from the local gateway has zero orders
(`GET /procurement/orders` → `total: 0`) and that gateway points at production,
so nothing was approved from here.

**Found and fixed 2026-09-05 — the recording write itself could not succeed.**
`one_tap_actions.executed_by` carried a foreign key to `auth.users(id)`
(`supabase/migrations/20260805000000_baseline_from_production.sql:12814`), and the
value written into it is `user.userId` from the JWT strategy, which is a
`public.users.user_id` (`apps/api-gateway/src/auth/strategies/jwt.strategy.ts:56`).
Those two tables are DISJOINT — measured in production on 2026-09-01 and recorded in
`supabase/migrations/20260901150000_order_line_capture_and_units.sql:220-225`: 5 rows
in `auth.users`, 7 in `public.users`, **zero** shared ids. So every
`POST /one-tap-actions/:id/execute` raised 23503 on the key, and CI could not see it,
because a database migrated from empty has no rows for a foreign key to violate. The
panel's die has therefore never completed an action against production. Repointed at
`public.users(user_id) ON DELETE SET NULL` by
`supabase/migrations/20260905060000_a_one_tap_execution_names_a_real_person.sql`,
which is the same repair `20260901150000` made for `procurement_orders.created_by`.
The author column `one_tap_actions.user_id` is deliberately left with no key at all —
an absent author is the structural proof the house raised the row — and the migration
asserts that it stays that way.

**Still open after 2026-09-05 (outside this pass's paths).**

- **Nothing raises a `delivery_confirm` card.** The sealed path is built and proven by
  spec, and it is reachable — `CreateOneTapActionDto` accepts `actionType` and
  `relatedOrderId`, so `POST /one-tap-actions` can write one — but no producer does.
  The natural owner is procurement, where an order becomes due:
  `apps/api-gateway/src/procurement/procurement.service.ts` (one
  `createSystemAction` call when an approved order reaches its expected delivery
  date). Same owner as §13.7, and it is what turns this from a built path into a
  used one.
- **The happy path has still never been redeemed against a real database.** The local
  gateway points at production and the tenant it reaches holds zero one-tap actions
  (`GET /one-tap-actions` returned `{"actions":[],"total":0,"pending":0,"completed":0}`
  on 2026-09-05, curl), so creating one to exercise it would be a production write.
  What WAS exercised live, read-only, on 2026-09-05: `POST
  /one-tap-actions/<uuid>/seal-challenge` answers 401 unauthenticated and 404 for an
  action this house does not own, and `POST /one-tap-actions/<uuid>/execute` answers
  404 the same way — so the routes exist, are class-guarded, and refuse before any
  write. The 400 refusals and the 403 seal refusals are proven by spec only.
- **`GET /procurement/orders` was answering 500 on this deployment** at 07:31 on
  2026-09-05 (`column procurement_order_items_1.price_uom does not exist`) — another
  builder's in-flight ADR 0119 column, not yet applied to the database the local
  gateway reads. Named here because it is the read a delivery card's order would come
  from.

## 10. Maturity

**hollow.**

**[changed 2026-10-01: founder walk-through. "Hollow" grades the legacy page (`pages/Dashboard.tsx`, `OneTapActionCenter.tsx`); the evidence table below is about that page. The redesign's action side was pressed live in P3 (§14): a note written, changed and marked done through the guarded `one-tap-actions` routes (201/200/201), and the approval hold covered by `WaitingOnYou.seal.test.tsx`. The redesign is not re-graded here; that grade is the founder's.]**

The read side is genuine — every KPI, alert and activity row is a live Supabase query
(`dashboard.service.ts:464-556,654-749,854+`). The *action* side is not, and the action
side is what the page claims to be for ("the actions worth doing first", Sidebar.tsx:63).

| Evidence | `path:line` |
|---|---|
| **One-Tap approve writes nothing to the server.** `handleApprove` is a `switch` over action types whose entire effect is a local event dispatch plus a `localStorage` mutation. `low_stock` fabricates an order id `ORD-${Date.now()}` and pushes it into `localStorage`; `stock_receipt` deletes a `localStorage` shadow key; `price_change`, `inequality`, `vintage_sub` are `console.log` only. Then a 300 ms `setTimeout` supplies "visual feedback" and the card is removed. | `components/notifications/OneTapActionCenter.tsx:541-662` |
| **Reject is entirely `console.log`.** Three cases, three log lines, no call. | `OneTapActionCenter.tsx:664-684` |
| **The real one-tap backend is built and unconsumed.** `one-tap-actions` is a fully guarded NestJS module with audited execution and WebSocket sync; the web client wraps it (`getOneTapActions`, `executeOneTapAction`) and **no component calls either function** — the only references are the barrel re-export. | `apps/api-gateway/src/one-tap-actions/one-tap-actions.controller.ts:36-50`; `services/api/dashboard.ts:161,183`; `services/api/index.ts:84-85` (sole importers) |
| **"Total Revenue" is purchase spend.** `totalRevenue`, `todaySales`, `weekSales`, `monthSales` and the sales chart's `revenue` all sum `procurement_orders.total_cost` of **delivered POs** — money paid *out* to distributors — and render under "Total Revenue" / "Revenue Breakdown". `pos_checks` (real sales) is never read by this service. | service `dashboard.service.ts:285-330,529-533,785-792`; labels `pages/Dashboard.tsx:1125,1155,1456` |
| Guarded, and the §9 note is correct — class-level `JwtAuthGuard` since #60. | `dashboard.controller.ts:51` |

- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** with 53 items / 274 bottles / 205.5 L on the tenant, the inventory tiles matched the rows exactly; Low Stock 7 matched the API. The sales figures were not exercised past the failure path cited above.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** Active Inventory 53, Low Stock 7, Vendor Spend $0, Pending Orders 0 all matched the rows (honest zeros); One-Tap Actions names the 7 wines correctly. The morning-after owner cannot see *which* wines are low from the card that exists for it.

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/dashboard/stats/:rid` | JWT (class) | `dashboard.controller.ts:151` → `dashboard.service.ts:464` | wines, bottles, volume, lowStockItems, pendingOrders, today/week/month "sales" (= PO cost) |
| GET `/dashboard/activity/:rid` | JWT | `:180` → `:557` | merged feed of `procurement_orders`, `events`, `restaurant_inventory` |
| GET `/dashboard/alerts/:rid` | JWT | `:216` → `:654` | rows from `v_low_stock_items`, `procurement_orders`, `restaurant_inventory` |
| GET `/dashboard/sales-chart/:rid` | JWT | `:240` → `:751` | buckets of delivered-PO cost + `wine_consumption_log` glasses |
| GET `/dashboard/calendar-revenue/:rid` | JWT | `:107` → `:380` | per-day join of `calendar_events` × delivered POs |
| GET `/calendar/events`, `/wines`, `/inventory/:id`(+`/low-stock`,`/summary`), `/procurement/orders/pending` | JWT via `apiClient` | see [[inventory]] §11, [[orders]] §11 | overlay data |
| GET `/api/v1/calendar/ical-token` | JWT, **raw `fetch` relative to the SPA origin** *[corrected 2026-09-21: calendar links are personal (ADR 0111 review trail) — no longer called by the dashboard; the answer carries no token, only the reader's own link state]* | `calendar` module | `{ token }`; the copied URL is then built from `window.location.origin`, so on any host that is not the gateway the subscription URL is wrong as well as the request |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Purchase orders (the "revenue" number) | manual entry on [[orders]] + `markDelivered` | `procurement.service.ts:903-1038` |
| `wine_consumption_log` (glasses) | **POS webhook only** — mirrored from a depleting POS sale | `pos-hub/pos-hub.service.ts:685,752` |
| `v_low_stock_items` | view over `restaurant_inventory`; alert side-effects from the 2-min edge sweep | `notifications/low-stock-alerts.service.ts:85` |
| `calendar_events` | manual entry + the calendar agent | `services/agent-orchestrator/agents/calendar_agent.py` |
| One-Tap action feed | **no producer — derived client-side** from wines/inventory/orders and cached in `localStorage` | `OneTapActionCenter.tsx:425-458` |

**Finding:** the One-Tap Action Center's data has no producer and its writes have no
sink. A restaurant with no POS also has no `wine_consumption_log` producer, so the
glasses series is structurally empty until pos-hub is connected.

### Writes

| Write | Lands in | Downstream |
|---|---|---|
| Approve / reject a one-tap action | `localStorage` (`wineops_*`, `OneTapActionCenter.tsx:80-83`) | nothing — per-browser, invisible to teammates, lost on cache clear |
| Add important date | `calendar_events` via the calendar modal | calendar strip, `/calendar` |
| Quick Gmail send | `communications` module | vendor thread on [[orders]] |

## 12. Design intent

**Should be:** the one screen an owner opens first — what happened, what is wrong, and
the two or three actions worth doing before service, each of which actually happens.

| State | Handled? | Evidence |
|---|---|---|
| loading | yes | `useDashboardData` loading flags |
| empty | partial | KPI tiles render `0`/`$0` rather than "no data yet" — indistinguishable from a real zero |
| error | no | no error branch on the KPI path; a failed stats call renders zeros |
| permission-denied | no | single owner-shaped layout; no role gate (contrast [[receiving]], which does this properly) |

**Where the UI misleads**

1. **"Total Revenue" is money spent, not money earned** (§10). An owner reading this
   card is reading their wine *purchasing* and being told it is revenue.
2. **One-tap success is theatrical** — the card disappears after a 300 ms delay with no
   request in flight (`OneTapActionCenter.tsx:652-655`). The user has been told an order
   was placed and a receipt was booked; neither happened.
3. **Fabricated zeros**: a stats failure and a genuinely empty restaurant render
   identically.

## 13. Roadmap

**[changed 2026-10-01: founder walk-through (§14).]**
- **Delivered on `fix/review-dashboard`:** the approved rows W1 to W37, in PR #579.
- **Next for this page:**
  - (a) Rebase onto `origin/main` before the PR. The base is `1c1a676f8`; live is `5a330a88e`, with #563, #568 and #575 in the shell and schedules, none of them on the dashboard.
  - (b) PR #565 rebases on this one; it overlaps `DashboardNext.test.tsx`, `DayDetail.tsx`, `RailPanels.tsx`, `SalesCalendar.tsx` and `useDashboardNextData.ts`.
  - (c) The oldest-first, flagged *Waiting on you* (founder ruling relayed 2026-10-01) is being built on `fix/waiting-on-you-oldest-first-flagged` by the multi-restaurant session; whichever lands second rebases. **[2026-10-02: it landed first as PR #581 (ADR 0256), merged into this branch with main.]**
  - (d) Compare production's page in Chrome once it is connected (P10 was partial).
  - (e) A test for the day panel's "Unnamed item".
- **Owned elsewhere:** see §9's dated note.

1. **Point One-Tap at the server module it already has** — swap `handleApprove`/
   `handleReject` onto `executeOneTapAction` (`services/api/dashboard.ts:183`) and the
   feed onto `getOneTapActions`. Highest value on the page: it converts the flagship
   panel from theatre to fact and deletes three `localStorage` stores. *Blocker: none —
   the controller, DTOs and WebSocket sync all exist.*
2. **Rename or re-source the Revenue KPI.** Either label it "Purchasing" (one-line,
   honest) or read `pos_checks` for actual sales. *Blocker: real revenue needs a POS
   connection; the label fix does not, and should not wait for it.*
3. Add an error state to the KPI row so a failed `/dashboard/stats` stops rendering `$0`.
4. Fix `Dashboard.tsx:267` to use `apiClient` and build the iCal URL from
   `VITE_API_GATEWAY_URL`, not `window.location.origin` (§9, §11). *[corrected 2026-09-21: calendar links are personal (ADR 0111 review trail) — moot: the button opens "Connect my calendar" on `/calendar`, and the address is built by the gateway (`feedOrigin`: `API_PUBLIC_URL`, else the request's own host)]*
5. Distinguish empty-restaurant from zero — "no orders yet" beats `$0`.
6. Turn on the uxSignals reporter for this page (§5) once the actions are real; measuring
   taps on buttons that do nothing measures nothing.

**Added 2026-09-03 — the one-tap desk arrived on the rail.**

7. **Let a producer raise a one-tap action** — call
   `OneTapActionsService.createSystemAction` from the low-stock sweep
   (`notifications/low-stock-alerts.service.ts:312,354`) and/or procurement
   (`procurement/procurement.service.ts:1744,2362`). Until then the rail panel's
   house half is correct and empty (§9). This is the single highest-value item for
   the panel: without it the "autonomy you can see" half of the page is a shape.
8. ~~**Implement `triggerWorkflow`**~~ **DONE 2026-09-05, for one act.** Confirming
   a delivery is real and sealed; a written note is a record and says so; every
   other act is refused in words and the row stays `pending`. The census of what
   each act would have needed is `one-tap-workflow.ts`'s header. The reorder is
   deliberately NOT next: `CreateOrderDto` requires a `providerId` and `createOrder`
   fires `triggerDraftHttp`, which the orchestrator may AUTO_SEND to the vendor
   (`services/agent-orchestrator/agents/provider_communication_agent.py:669-714`) —
   the first real action should not be one that spends money and posts a letter.
9. **Give the command palette an appendable registry** so *One-tap actions* can be
   reached from it — the founder named the palette as a second way in.
   `components/CommandPalette.tsx` builds its items inside the component from route
   and permission context, so no page can contribute one today. Mirrored in
   [[notifications]] §13.14.
10. ~~**Decide whether two `HoldToApprove` dies on one screen is one too many**~~
   **ANSWERED 2026-09-05, then REOPENED AS AN EXPERIMENT the same day.** The first
   answer (§1b) was that the wax sits only where a write leaves the page: the
   rail's die moved off the written note and onto the delivery confirmation. The
   founder then asked for both — *"lets try both, 80 percent simple 20 percent
   signature"* — so in the die arm two `HoldToApprove` controls DO sit on one
   screen, one sealed and one not, told apart only by the sentence above each.
   That is no longer a matter of taste to be settled in a doc: it is
   `note_close_control`. **Its end is now dated** (founder, 2026-09-05 batch 45):
   one quarter — 91 days — after its first exposure, after which the founder reads
   both arms and names the arm every house gets. Until an arm is named, the two
   dies stay on the screen and the report says no winner is recorded (§13.18,
   ADR 0127's addendum).

**Added 2026-09-04 — the seal reached this card.**

11. **Prove a redemption against a database that has the seal table.** Nothing
   anywhere has yet exercised a SUCCESSFUL redeem: the local gateway points at
   production (so no order may be approved from it) and the tenant it reaches
   has zero orders. Every claim about the happy path is a spec, on this page and
   on [[orders]]. *Blocker: a scratch database with `mcp_seal_challenges`
   applied, or a staging tenant with a disposable order.*
12. ~~**Give the one-tap die the same mint.**~~ **DONE 2026-09-05.** It needed no
   new subject kind after all, and that is the design decision worth recording: the
   thing being sealed is the **order**, not the card. A card is a piece of paper
   pointing at an order, and two cards pointing at one order must not be two
   independent permissions to book its stock — so the seal is
   `subject_kind: "procurement_order"`, `subject_id` the order, and the act is
   `deliver`. An order seal minted for `approve` therefore cannot be spent here:
   `SealChallengeService` compares the act and answers *"That seal was issued for a
   different act on this order."* `common/seal/**` was not edited (another builder
   holds it this session); only its service is imported.

**Added 2026-09-05 — after the first real action.**

13. **Raise a `delivery_confirm` card from procurement** so the sealed path is used
   and not merely built (§9). One `createSystemAction` call in
   `apps/api-gateway/src/procurement/procurement.service.ts` when an approved order
   reaches its expected delivery date. This is now the single highest-value item for
   the panel — item 7's general form, narrowed to the one act that works.
14. **Make the reorder real behind a vendor and a price**, when there is a card that
   carries both and a decision about the auto-send gate. Until then it is disabled
   and says why, which is the honest state, not a placeholder.
15. ~~**Decide whether `markDelivered` should refuse an already-delivered order itself.**~~
   **CLOSED 2026-09-05 — founder: "harden it in the procurement service for every
   caller."** `markDelivered` now reads the order's state before any write and refuses a
   second delivery with `409 { reason: "order_already_delivered", orderId, status,
   deliveredAt, message }`; the same rule is the UPDATE's own `status=not.in.(...)` WHERE
   clause, so the loser of two simultaneous confirmations loses at the database rather
   than at the read. The set is `ORDER_GOODS_ARRIVED_STATUSES` (DELIVERED,
   PARTIALLY_RECEIVED, COMPLETED), **imported** from `order-transitions.ts` (ADR 0125) so
   the rule that stops a second delivery and the rule that stops a cancellation cannot
   drift. Sentences and reason codes in `procurement/delivered-once.ts`.
   **The one-tap refusal stays, and stays first**, widened to the same set: the seal is
   minted and redeemed *before* `markDelivered` runs, so a refusal arriving only from the
   service would burn a one-shot seal on an act the house was always going to decline.
   **It answers 409, not 400 — founder, 2026-09-05, batch 46:** *"a second delivery of an
   already-delivered order answers 409 Conflict, not 400 — the request is well-formed, the
   order's state conflicts with it, and the door and the one-tap rail must be able to tell
   'already done' from 'you sent nonsense' and show the earlier delivery instead of an
   error."* **400 was rejected.** The first build kept 400 here because it was the contract
   `be80f8b5` shipped; the founder overruled it, and the measurement says why the rail in
   particular needed it: `OneTapPanel.tsx` printed the gateway's sentence only for a 400 or
   403 and framed everything else as *"Marking it done was refused"*, so the one refusal a
   manager most needs to read plainly was the one this desk dressed up as a failure. Both
   ends now throw `409 { reason, orderId, orderNumber, status, deliveredAt, message,
   earlierDelivery }`, and the rail prints the earlier delivery — *"Delivered on 2026-09-04
   at 14:05 UTC by Ada Lovelace, 72 bottles booked in."* — ahead of the sentence, on the
   mint refusal and on the execute refusal alike. Nothing retries: a 409 says the request
   was fine, so repeating it cannot change the answer.
   **What the double-booking actually was, measured** rather than repeated: a second
   `markDelivered` on the same order did **not** double-book the live ledger —
   `apply_stock_movement` returns the existing transaction for a seen
   `p_idempotency_key` and the key is `order-delivered-live:{orderId}`, one per order.
   What it *did* do every time was overwrite `delivered_at` and `received_by`, reset
   `quantity_received` to the full ordered count, and write `status` backwards (COMPLETED
   and PARTIALLY_RECEIVED both silently became DELIVERED again). The real double-book is
   the neighbouring one and is why PARTIALLY_RECEIVED is refused too: the receiving door
   books under `door-receipt:{eventId}` and this path under
   `order-delivered-live:{orderId}` — different keys, nothing dedupes them, so a door
   count of 3 followed by a tap booked 3 + 12 = 15 on a twelve-bottle order.
   *Owner: `procurement/`. Pinned by `procurement/tests/delivered-once.spec.ts`.*

16. **`WaitingOnYou` still has no Reject.** Measured 2026-09-05 (ADR 0125's census):
   `grep -n -i 'reject\|cancel\|decline\|dismiss'` over `dashboard/next/WaitingOnYou.tsx`
   returns **zero hits** — the card approves and nothing else. Now that a cancellation is
   a checked, sealed transition with a required reason
   (`components/orders/SealedRejectDie.tsx`, one control, already used by the legacy desk
   and available to any surface), giving this card the other half is a small change and a
   real decision: the one-tap desk is where a manager clears a queue, and a queue you can
   only say yes to is not a decision surface. *Blocker: founder — it is a new act on the
   dashboard, not a defect.*

**Added 2026-09-05 — the note's closing control became a measured question.**

17. ~~**Give someone a way to read BOTH arms.**~~ **CLOSED 2026-09-05 (batch 45) —
   founder: the founder alone may read both arms' figures.** Shape (a) of the three,
   the founder-scoped read, with the "invent the first cross-house role" cost paid
   differently than expected: no role was invented. `GET
   /ux/experiments/:key/both-arms` is gated by the platform-admin service key
   (`ServiceKeyGuard`, `X-Admin-Key` / `ADMIN_API_KEY`, ADR 0099) — the credential
   that already means "not a tenant" — because `RolesGuard` knows only owner,
   manager and staff, all three of which are roles *within* a house, and a fourth
   invented to hold one report would be a permission system arriving as a side
   effect of a measurement. It returns per arm: houses assigned, exposures,
   completions, abandons and the date of first exposure. **No restaurant id appears
   anywhere in the payload and no row is ever selected** — every house figure is a
   `head: true` count — so a house's identity is never returned beside its arm,
   which is the property that made a cross-house read grantable at all. `GET
   /ux/experiments/:key/report` is unchanged: still tenant-scoped, still this
   house's own arm. Pinned by `ux-optimizer.admin-routes.spec.ts` (the gate and the
   route census) and by `ux-optimizer.experiments.spec.ts` (the figures and the
   withheld identity).
18. ~~**Decide what ends the experiment.**~~ **CLOSED 2026-09-05 (batch 45) —
   founder: it ends one quarter after its first exposure, and then every house gets
   the arm the founder names.** A DATE, and one that is derived rather than typed:
   the earliest exposure across all houses plus `EXPERIMENT_QUARTER_DAYS` = 91 days,
   which is 13 whole weeks (`experiments.ts`; the arithmetic and why not 90 or 92
   are in ADR 0127's addendum). Derived once and frozen in `ux_experiment_state`
   (migration `20260905235500`), because the interval is a constant in a source file
   and a re-derived finish line would move under a running experiment — the same
   argument that put the assignment in a row rather than in a hash. After the end:
   **no new exposure is recorded, no new house is enrolled, the assignment rows are
   kept as history**, and `POST /ux/experiments/:key/winner` writes the founder's arm
   ONCE (a different arm afterwards is refused by the service and by a write-once
   trigger). **Until the founder names one, the report says the experiment has ended
   and that no winner is recorded** — never a default, and never the first-declared
   arm, which is a rendering fallback and not a result. The spec object is NOT
   deleted when the winner is named, which is a departure from what this item asked
   for: deleting it would leave `ux_experiment_assignments` rows pointing at a key
   nothing declares, and the winner is served from the stored row. Retiring the spec
   is a later, separate act. *Left open by this pass: nothing raises the winner in
   the UI — naming it is a `curl` with the admin key. See item 23.*
19. **Record an abandon when the tab is closed.** Today an abandon is written only on
   unmount, so a tab closed outright counts nothing and every abandon figure is a
   floor. The fix is a `fetch({keepalive})` — which `apps/web/src/lib/uxSignals.ts`
   already has an allowlist entry for — plus a `pagehide` handler. It needs an entry
   in `apps/web/src/__tests__/no-raw-gateway-fetch.test.ts`, which is a shared file
   this pass did not own. Both arms lose the same cases, so the comparison holds and
   only the absolute number is understated.
20. **Turn the client friction reporter on, or retire it.** §5 still reads "None":
   `lib/uxSignals.ts` is gated on `VITE_UX_OPTIMIZER` and its only importer has zero
   call sites. The experiment deliberately does NOT route through it — exposures go
   straight to `neural_footprint_event` — which means the ux-optimizer now has two
   telemetry paths, one live and one dark. That is a fork worth closing in one
   direction or the other rather than leaving.
21. **One-tap's AUTHOR column had the same disease as its executor, and the first migration asserted the opposite.** Found 2026-09-05 by the schema-parity replay of `20260905060000` (P0001 "user_id grew a foreign key"): the baseline points BOTH `one_tap_actions.user_id` (:12854) and `executed_by` (:12814) at `auth.users(id)`, and `one-tap-actions.service.ts` writes the JWT's `public.users` id into both (`:207`, `:524`) — so a human-raised action 23503'd on create exactly as an execution 23503'd on execute, and only the house's own NULL-author rows could ever be written. The first draft read the key off the CREATE TABLE and not the ALTERs that follow it, and asserted `user_id` had no key. The migration now repoints both, keeps SET NULL and nullability on both, and drops the false assertion; proven on PGlite with a pre-fix control (`node p4-scratch/pglite-probe/one-tap-both-keys.mjs`: 12 passed / 0 failed — both writes refused before, both accepted after, an `auth`-only id refused after, a departed person SET NULLs both columns). Guards `check_fk_targets_exist.py` and `check_fk_repoint_by_referenced_column.py` PASS. The one-tap builder's claim in be80f8b5 that "`user_id` carries no foreign key at all" was wrong; recorded here as its correction.
22. **The seal subject for a one-tap delivery is the ORDER, not the action** (founder, 2026-09-05, p4aj Q2). The die on the rail mints a `procurement_order` challenge with act `deliver` and the one-tap row's `executed_by` is written only after the order's seal is redeemed — one seal per real-world act, so a second surface (the door, the legacy desk) cannot confirm the same delivery on a different subject. Recorded here because be80f8b5's message named the decision but no page note did.

**Added 2026-09-05 — the experiment got an end and a reader.**

23. ~~**Nothing in the product raises the winner, and no screen shows both arms.**~~
   **CLOSED 2026-09-05 (batch 53) — founder: "A notification to you when it ends
   unnamed."** A ninth notification producer,
   `notifications/producers/experiment-ended.producer.ts`, writes one durable
   notice when a declared experiment is started, ended and has no winner named —
   both arms' figures, the abandon-floor caveat, and `POST
   /ux/experiments/:key/winner` with a note that it and the both-arms route need
   `X-Admin-Key`. **Deduped on the experiment key** (`experiment:<key>:ended_unnamed`,
   carrying no date and no count) so it fires once, against the same UNIQUE claim
   index the other eight use. **It is not a tenant sweep:** `sweepFounder`, run once
   per fast tick outside `runPerTenant`, into the one house named by
   `DEFAULT_RESTAURANT_ID` — and with that unset it does not run and picks no house.
   It never names or implies a winner (pinned by a case that greps the text for
   leading/winning/ahead/better). Rejected in the same breath: a line on
   `/admin/health`, which is `requiredRole="owner"` and would mean forwarding the
   admin key into a page every house's owner can open; and doing nothing. **Off
   until armed:** `NOTIFICATION_PRODUCERS_ENABLED` is unset on this deployment, so
   it writes nothing yet. The READ staying a `curl` is deliberate and unchanged.
   **And since batch 55 the notice is also EMAILED** (founder, 2026-09-05, against
   the recommendation to keep it an inbox row: *"Inbox row and an email"*). One call
   to the existing `GmailService`, **after** the row and only if the row landed —
   the row is the record, the mail is a copy of it. **One copy per ending, ever:**
   `emit` alone cannot carry that, because quiet hours defer a member and a later
   sweep legitimately writes a second row, so the mail is gated on a new
   `ledger.hasClaimFor` read taken before `emit`; with the UNIQUE claim index that
   is atomic (both instances read false, only one wins the claims, only that one
   sends). An unreadable ledger **holds the copy** rather than risking two. The
   outcome is written back onto the row in words — **sent** (with the message id),
   **refused** (the sender's own reason verbatim, which is where a missing Gmail
   grant surfaces), or **not_attempted** (no address, or already sent with the first
   notice) — and never a silent skip: the insert-time `"pending"` must not survive a
   sweep. The address still never touches the row. All of it stays behind the one
   switch.
24. **`ux_experiment_state` cannot be applied to production from here, and the
   both-arms report is therefore unproven against real data.** **[CORRECTED 2026-09-12: no longer true -- `to_regclass('public.ux_experiment_state')` returns NOT NULL, measured that day. PR #289's 19 blocked migrations were applied through the connector on 2026-09-12 once a defect in `20260906020000` was fixed. The finding above is kept as the dated observation it was; do not infer from it that a missing table is guarding anything.]** Same standing
   blocker as item 11 and as ADR 0127's own: the local gateway points at production,
   so no migration may be applied and no assignment may be created from it. The
   table and its write-once trigger are proven on PGlite
   (`p4-scratch/pglite-probe/p4bd-experiment-state.mjs`, **19 passed / 0 failed**),
   with **six of the migration's seven in-file assertions proven to FIRE** against
   a copy with exactly one thing broken — the seventh is the table-exists guard,
   which cannot be broken without breaking the `CREATE` it checks. The routes are
   proven at the controller seam in jest and the whole `AppModule` graph resolves
   (`check_gateway_boots.sh` PASS). What is NOT proven is a real 200 from either
   route, or a single real figure from any house. *Blocker: a database with the
   migration applied.*

### The one-tap delivery card ships live (founder, 2026-09-05, batch 55)

Asked whether the first reachable one-tap delivery card (the desk now fetches CONFIRMED and
IN_TRANSIT orders and the die confirms against the real endpoint, 7bbc37c9) should be gated
for one release: **"Ship it."** The 409 covers a second press, the seal on the order proves a
person asked, and nothing is booked without a hold. Rejected: a flag for one release.

### The experiment-ended notice is also emailed (founder, 2026-09-05, batch 55)

Against the builder's recommendation to keep it an inbox row first, the founder chose
**"Inbox row and an email"**: when the window closes unnamed, the notice also goes out through
the house's Gmail grant. Being built; producers stay off until armed.

## 14. Founder walk-through — 2026-10-01 (branch fix/review-dashboard)

Session R1 (wt-review-1b, web :5311, gateway :4111 as the founder's own account, house ALDEMIR, production data, timers off). Rows are added when proposed; rulings go to this page's walk-through ADR.

**[changed 2026-10-01: every row below tagged "(uncommitted)" was committed and opened as PR #579; the tag records the state when the row was written.]**

| id | what | evidence | ask | founder's words | status |
|---|---|---|---|---|---|
| DASH-W0a | SELF (setup, before the no-solo rule): moved the old wt-review-1 to main's tip (a docs-only diff), cleared the Sim sign-in token on :5301, and recreated wt-review-1b after the disk cleanup removed it | session transcript | — | — | SELF, shown 2026-10-01 |
| DASH-W1 | P1 purpose and verdict. Who: the owner or manager, first thing in the day. Job: "before service, show me what needs me, what is running low and what came in, and every number is real". Verdict PARTIAL: 7 of 10 parts real; One-tap is hollow, Lately prints raw codes, and two lines are written for us (One-tap's seal paragraph, the footer experiment line). No `mudavym.design.dashboard` override is set | sketch `DASH-W1.html` (3 shots, 10 boxed regions); localStorage read 2026-10-01 | approve | "show me visual", then Approve | approved |
| DASH-W2 | The two paid-to-vendors tiles and the calendar count the same money two ways. Tiles: by `created_at`, on the UTC day, and "month" means the last 30 days. Calendar: by `delivered_at`, by calendar month. An order created Sep 28 and delivered Oct 1 at 8pm Chicago is in neither tile and lands in the Oct 2 cell. Fix (gateway): count both by `delivered_at`, in the house's time zone; "month" is this calendar month | `apps/api-gateway/src/dashboard/dashboard.service.ts:557-583` vs `:439-446`; ALDEMIR is America/Chicago with 0 orders, so this is latent here and proven by a jest spec, not the pane | approve | Approve | approved; built (uncommitted): jest `dashboard.walkthrough.spec.ts` W2 (Chicago evening delivery counts today, this month, and the Oct 1 cell), mutation-tested; pane tiles and calendar both $50 (`DASH-W6-after.jpg`) |
| DASH-W3 | A failed read shows as zero. `getStats` and `getActivity` use `Promise.allSettled` and ignore Supabase's `error` field, so a failed cellar read renders "0 · across 0 wines": absence reads as health. Fix (gateway): a failed core read fails the call, so the page's existing em-dash path shows. Web half: `services/api/dashboard.ts:81` turns a failed activity fetch into `[]`, which is SHARED | `dashboard.service.ts:506-541`, `:608-648`; `useDashboardNextData.ts:16-18` | approve | Approve | approved; built (uncommitted): jest W3, one case per core table (7), mutation-tested; web half queued SHARED |
| DASH-W4 | Lately prints internal codes. The gateway reads `payload.title/description/action`, but only calendar events carry those (production has 153 events of 5 types, queried 2026-10-01), so other rows read "provider_change — provider_change". Inventory rows are the wine's last-edited time with no wine named ("Stock: 1 bottles"). An order can show twice, once as its row and once as its event, as "Order x — Order x". Fix (gateway): one sentence per event type in the house's words, the wine or vendor named, correct plurals, each order once | `dashboard.service.ts:633-676`; production read-only queries 2026-10-01 | approve | Approve | approved; built (uncommitted): jest W4 sentences + `eventSentence` cases, mutation-tested; pane Lately reads the three sentences (`DASH-W4-W5-after.jpg`) |
| DASH-W5 | Fork against ADR 0127 option 8 (:120-121). The footer's experiment line ("Note control — plain 80% / die 20%…") is written for us, on a people page. Options: keep it, move it to /logs (recommended), or show it to owners only | `apps/web/src/pages/dashboard/next/DashboardNext.tsx:183-198`; ADR 0127 :110-121 | approve: move to /logs; /logs half → shared queue; amends ADR 0127 option 8 (:120-121) — the amendment text is appended by PR #565 ("Amendment — 2026-10-01 (page walk-through, DASH-W5)"), not by this branch | Approve | approved; built (uncommitted): vitest dashboard/next 92/92 incl. "keeps the note-control count off the dashboard footer", mutation-tested; pane footer has no experiment line and no report request; /logs half queued SHARED |
| DASH-W6 | Found while building W2. The calendar's spend query asks `procurement_orders` for `wine_name`, a column it doesn't have (production: `42703 column "wine_name" does not exist`). The gateway reads only `data`, so the calendar shows $0 paid on every day for every house. Fix (gateway): drop the unused column; a failed read fails the call, as in W3 | `dashboard.service.ts:439-446`; information_schema plus the failing select, 2026-10-01; pane: cards $50 vs calendar $0 (`$SNAP/sketches/DASH-W6-before.jpg`) | approve, with proof by a test order | "open it on web", then "Test order on ALDEMIR" | approved; built (uncommitted): jest W6 (no `wine_name` in the select; a refused read fails the call), mutation-tested; pane calendar $50 (`DASH-W6-after.jpg`) |
| DASH-W6a | DATA WRITE (approved under W6): inserted test order `TEST-R1-DASH-W6` (id 595018fd…) on ALDEMIR. Delivered 2026-10-01 17:47 UTC; 1 bottle of 1er Cru Montmains from Aldemir Distribution; $50. Checked first that nothing reacts to the insert: the only insert trigger is the house-match check, no gateway timer reads delivered orders, and the agents only listen to bus messages. The row stays (rows are never deleted); cancelling it is the founder's call. Side effect: the agent's price history for this wine and vendor now includes $50 | production insert, `returning` row | — | "Test order on ALDEMIR" | done |
| DASH-W7 | Wrong plurals and raw alert wording: the calendar header said "1 bottles in", the cellar tile "across 1 wines", and the day panel's alert "Low Stock. 1er Cru Montmains has 1 bottles (min: 6)"; a wine with no name printed its internal id. Fix: correct plurals; alerts read "<wine vintage> — 1 bottle left, you keep at least 6" / "<wine vintage> — out of stock", with the wine named as Lately names it and never by id | `SalesCalendar.tsx:138`, `KpiRow.tsx:95`, `dashboard.service.ts` getAlerts; pane day panel 2026-10-01; production: 0 of 183 cellar rows have a house name that differs from the library's | approve | Approve | approved; built (uncommitted): vitest "says one bottle and one wine in the singular" (93/93), jest W7, both mutation-tested; pane "across 1 wine", "1 bottle in", alert "1er Cru Montmains 2023 — 1 bottle left, you keep at least 6" (`DASH-W7-after.jpg`). Alert titles ("Low Stock.") are left for P5 |
| DASH-W8 | `getStats` read `wine_consumption_log` on every load and used none of it. Fix: drop the read | `dashboard.service.ts` getStats | approve | Approve | approved; built (uncommitted): jest W8 (no `wine_consumption_log` read), mutation-tested; gateway jest `src/dashboard` 40/40 |
| DASH-W9 | Not this page: /choose-house prints "Signed in as <email>" with no `data-secret` mark, so screenshot masking (ADR 0135) does not cover it. Recommended leaving it: the mark is for credentials, and this is the person's own address shown to themselves | `apps/web/src/pages/ChooseHouse.tsx:205`; ADR 0135 :262-270 | leave it (recommended) | Leave it (Recommended) | no change |
| DASH-W10 | The cellar tile, the out-of-stock alerts and Lately's cellar rows read every inventory row, but `v_low_stock_items` counts only active, undeleted wines. The other house has 8 inactive wines at 0 bottles: its tile is 8 wines too high and it gets 8 "out of stock" alerts for wines it retired. Fix (gateway): all three reads use the view's rule, `deleted_at is null` and `is_active` | `dashboard.service.ts` getStats / getAlerts / getActivity; production read-only 2026-10-01: other house 182 rows → 174 under the rule, stock-0 rows 21 → 13; ALDEMIR 1 → 1 | approve | Approve | approved; built (uncommitted): jest W10 (`it.each` over the three calls), each of the three filters mutation-tested; pane unchanged for ALDEMIR, stats/alerts/activity 200 |
| DASH-W11 | `getAlerts` ignored read errors, so a failed low-stock or out-of-stock read showed no alerts, which reads as "nothing is wrong" (the W3 defect, on alerts). Fix (gateway): a failed alert read fails the call. Web half (`services/api/dashboard.ts` getAlerts catches to `[]`) is SHARED | `dashboard.service.ts` getAlerts; `apps/web/src/services/api/dashboard.ts:89` | approve | Approve | approved; built (uncommitted): jest W11, one case per read (3), each mutation-tested; gateway jest `src/dashboard` 46/46; web half queued SHARED |
| DASH-W12 | P3. The day panel's delivery link and Waiting on you's "Review" link go to `/orders?highlight=<id>`, which /orders ignores (it reads `?order=`), so you land on the list with nothing open. The "Waiting on you" and "Paid to vendors · today" tiles go to plain /orders. Fix (page files): `?order=<id>`, `?station=pending`, `?station=delivered` | `DayDetail.tsx:200`, `WaitingOnYou.tsx:144`, `KpiRow.tsx:113,122`; `OrdersNext.tsx:132,145`; sketch `DASH-W12.html` (before/after landing) | rework | "needs rework, formatting into orders page when order opens is needed, + look into how the email comunication sidebar handles each action on what extent" | rework → W16; the link edits were approved there and are built (uncommitted) |
| DASH-W13 | P3. A future day with a calendar event shows its dot but is disabled, so it can't be opened. Fix (page file): a future day with events opens the day panel with only "On the calendar"; empty future days stay disabled. Latent: ALDEMIR has no events | `SalesCalendar.tsx` `disabled={isFuture}` | approve | "approved + past days must be lowered in color to show those days past" | approved; built (uncommitted): vitest "opens a future day only when it has an event, and shows only the calendar" (fake date, fixture event; no day-orders fetch for a future day), both halves mutation-tested; future-day disabled cursor scoped to `:disabled`. Not shown live: ALDEMIR has no events; past-day colour → W17 |
| DASH-W14 | P3. Lately and Running low are read-only lines. Fix (page file): a Lately order line opens that order (`/orders?order=<entityId>`, the gateway already sends `entityType: procurement_order`), a Running low line opens /inventory searched for that wine (`?wine=<name>`, `InventoryCommandPage.tsx:440`). Lines with no target stay plain; links underline on hover | `RailPanels.tsx` LowStockPanel / ActivityPanel; sketch `DASH-W12.html` (`DASH-W14-after-panel.jpg`, `DASH-W14-after-landing.jpg`) | approve | Approve (Recommended) | approved; built (uncommitted): vitest "links Lately order lines to the order and Running low lines to the wine", mutation-tested; pane: order line → order opens, wine line → /inventory searched "1er Cru Montmains" |
| DASH-W15 | Not this page: /orders squeezes an opened order's note into a one-word column at 1024px | `DASH-W15-before.jpg` | queue for the /orders session | Queue it (Recommended) | queued SHARED (R1b line, 2026-10-01) |
| DASH-W16 | W12 rework. (a) The opened-order squeeze on /orders: who builds it. (b) "The email communication sidebar", which he named as "the one where you can communicate with the vendor about a certain order": how it handles each action | read of `DraftRail.tsx`, `LedgerRow.tsx:376,435-445,525,533-603`, `OrdersNext.tsx:213-233,500,584`, `HouseCounter.tsx`, `counterRead.ts:185-193` | (a) ask; (b) findings then proposal | (a) "The /orders session"; (b) "the one wehre you can communicate with the vendor about a certain order" | (a) stays W15 (queued); (b) approved 2026-10-01 ("Approve (Recommended)", sketch `DASH-W16.html`): the W12 link edits stay as built (`?order=<id>` on the day-panel delivery line, Waiting on you "Review" and Lately order lines; `?station=pending` / `?station=delivered` on the two tiles), and gaps a–e are queued for the /orders session in `review-shared-queue.md`. Findings (code read 2026-10-01, plus ADMIN ROOM in the pane): per-order vendor talk lives on /orders in two places. "The vendor's answers" (`LedgerRow.tsx:557-579`, `ResponsesSheet`) reads the order's inbound mail and its deal proposal, with confirm, reject-with-reason and step-through, in a sheet. "Drafted by the house" (`DraftRail.tsx`) does approve-and-send (hold plus server seal, `:423-452`), ask a manager (`:399-420`), cancel auto-send (`:307-316`) and discard (`:467-486`, ONE click with no hold or confirm), all in place; it has no edit (`useEditDraft` exists but nothing calls it) and no way to open the vendor's answers. `<DraftRail />` takes no props (`OrdersNext.tsx:584`), so opening `?order=<id>` (`:213-233`) expands the order row but never focuses that order's draft or answers, and no URL opens a sheet. The counter's Reply row goes to bare /communications with no thread (`counterRead.ts:185-193`). In ADMIN ROOM the house's data-and-privacy terms sheet came up; it was not accepted (`DASH-W16-terms-gate.jpg`). [corrected 2026-10-01: the sketch and the ask called this gap (f), "no way out". Wrong: it is `DataTermsSignInGate` (`DashboardLayout.tsx:48`), shown to every owner on every page until accepted, and made non-dismissable on purpose (`DataTermsAcceptSheet.tsx:40-49`, ADR 0207 round 6z, "Every owner, next sign-in"). It appeared because `me` is owner of ADMIN ROOM, not because of the vendor's-answers click. (f) is dropped from the queue; the founder was told] |
| DASH-W17 | Past days lowered in colour (from W13). Variants: A numbers, figure and marks fade to 45% with the ground kept; B the whole cell fades to 50%, full on hover or pick; C a darker sunk ground with numbers at 55%. The cell gets `data-past`; today keeps its teal number and spend days keep their tint | sketch `DASH-W17.html` (before, A, B, C on September 2026, ALDEMIR) | pick one | "A: numbers fade" | approved; built (uncommitted): `data-past` in `SalesCalendar.tsx`, CSS in `dashboard-next.css`; vitest "marks only the days before today as past", mutation-tested; vitest dashboard/next 96/96; pane September faded (`DASH-W17-after.jpg`) |
| DASH-W18 | One-tap "Undo — rule it out" (`OneTapPanel.tsx:608-612`, `POST …/cancel`) has no test on this page; P3 did not press it live (it changes a real note) | P3 line; `grep -n cancel OneTapPanel.test.tsx` finds none | add a vitest that the undo sends one cancel and the row leaves; ask with the P5 items | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W22.html`, Safari beacon n=2). Built (uncommitted): `OneTapPanel.test.tsx` "rules an action out with one cancel…" (exactly one `/cancel` POST, to that id, then the re-read drops the row; the other POST in that test is the note-close experiment's exposure event) and "keeps the action and says so when ruling it out is refused"; 4 mutations (wrong id, no re-read, silent refusal, dead button) all caught. Not pressed live: it rules out a real note for the whole house |
| DASH-W19 | A failed read had no way back but reloading the page, and the opening line said "The gateway is quiet — figures will land as connections return" (internal word). Worse, with the approvals unread and nothing low it said "Nothing is waiting on you." Built: every "couldn't be reached" line ends on a **Try again** word that reads again only what its sentence is about (opening line and Running low → the spine; approvals → the spine; month → that month's ledger; This week → the calendar query), says "Reading…" while it runs; the opening line names what it could not read in the house's words and never says "Nothing is waiting" over an unread half. Wording kept to "couldn't be reached", matching PR #565. Not covered: the day panel's deliveries line (closing and reopening the day reads again); Lately/alerts unread is #565's web half (`services/api/dashboard.ts:81,96`), which then needs the same word | before `DASH-P4-error-top.jpg`, `DASH-P4-error-rail.jpg`; after `DASH-W19-after-top.jpg`, `DASH-W19-after-rail.jpg`; live: block lifted, Try again → opening line "1 low-stock wine is waiting on you.", month figures back, 0 retry words left | approve / deny / rework | approve + remove the system theme from top bar into settings | approved 2026-10-01 (sketch `DASH-W19.html`, Safari beacon n=6); the theme half is DASH-W23. Built (uncommitted); vitest 2 new (`DashboardNext.test.tsx` "names what it could not read…", "offers Try again on a month…") + seal test asserts the word; 4 mutations all caught; This week's word is built but not tested or shown live (the calendar query is cached across the trick) |
| DASH-W20 | The page's "today" was the viewer's device clock while every figure is bucketed in the house's zone (`dashboard.service.ts:168` houseZone): greeting, date line, service word, today's cell, past/future fade, the day panel's deliveries (`deliveredAt.startsWith(date)` put a Chicago delivery after 7pm on the next day) and This week. Built: gateway `getStats` returns `timezone` (DTO field documented); the page reads it (`houseZoneOf`) and uses `dateIn`/`hourIn` everywhere "today" is asked. Edge: a house with no zone recorded reads UTC, same as the figures; while the totals cannot be read the page has no zone and falls back to the device clock | before `DASH-W20-before.jpg` ("Good evening · BEFORE SERVICE" at 15:52 Chicago, device on Eastern); after `DASH-W20-after.jpg` ("Good afternoon · BETWEEN SERVICES"); live `GET /dashboard/stats/05b8c4a5…` → `"timezone": "America/Chicago"` | approve / deny / rework | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W19.html`). Built (uncommitted); vitest "reads today, the greeting and a day's deliveries on the house's clock" (Asia/Tokyo vs runner clock, with a guard that fails if the runner is already in the house's day); 4 mutations all caught; gateway jest `src/dashboard` 4 suites 47/47 incl. "says which zone it bucketed the figures in" and the UTC fallback, mutation (`timezone: "UTC"`) caught |
| DASH-W21 | Waiting on you offered a live hold to every role. `/orders` reads `GET /procurement/order-approval-gate` and shuts the die, with the house's sentence, for an order the caller's role may not seal (`LedgerRow.tsx:605-638`); the dashboard let the approve route refuse after the hold. Built: the card reads the same gate once per queue, only while something waits; a held order shows the die disabled plus "Waiting on a manager. <the rule's sentence>"; a gate that fails, is another house's, or says `readable:false` leaves the die live and says the rules couldn't be read (the approve route still decides). Not shown live: ALDEMIR has nothing waiting | live read-only `GET /api/v1/procurement/order-approval-gate` → 200, same house, `readable:true`, `callerRole:"manager"`, 0 orders; vitest fixtures | approve / deny / rework | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W19.html`). Built (uncommitted); vitest 4 new in `WaitingOnYou.seal.test.tsx` ("who may seal it"); 4 mutations all caught |
| DASH-W22 | FORK. Staff see the house's money here: the two Paid to vendors tiles, the calendar's spend per day and month, the day panel's totals and each waiting order's total. Every `/dashboard/*` route is `JwtAuthGuard` only (`dashboard.controller.ts:51`), `/` has no role gate (`App.tsx:362`), while the rail hides Vendor prices from staff (`shellPalette.test.tsx:141-143`) and on `/ask` the founder said "do not give money or sensitive incentives like sales etc to the staff" (ADR 0145 :484-486). Nothing decides it for the dashboard | code cites; no staff sign-in used | fork: hide amounts for staff (page + gateway) / keep / defer to an OD | A: hide amounts for staff (Recommended) | ruled 2026-10-01 (sketch `DASH-W19.html`): staff see counts, not money, and the gateway stops sending the amounts to staff. **Built result approved 2026-10-01** ("Approve (Recommended)", sketch `DASH-W22.html`, Safari beacon n=2) (uncommitted). Gateway: `dashboard/amounts-for-role.ts` reads the money right from `/ask`'s `ROLE_POLICY` (owner, manager see "money"; staff and a caller with no house role do not); `stats` and `calendar-revenue` null the spend fields for those callers and say `amounts: "withheld"`; `summary`, `sales-chart` and `inventory-breakdown` (money-only) answer 403 "Amounts are for the house's owners and managers." before any read; `stats` gains `todayDeliveries` and `monthBottlesIn` on the house's days. Web: the page follows the gateway's `amounts` (and a staff `activeRole` for a gateway too old to say): the two spend tiles become **Deliveries · today** and **Bottles in · month**, the calendar header drops "paid to vendors", squares carry no figure and shade by deliveries, the day panel drops "Paid to vendors" and line money, the approvals queue shows the quantity and a bare "Hold to approve", the footer's procurement line goes. A month the gateway sends withheld reads as counts whatever the role (a withheld figure is never a $0). Evidence: gateway jest `src/dashboard` 54/54 (W22 describe: staff/null/undefined stripped, owner and manager kept, money-only routes refused before the service is called) + walkthrough count test, 4 mutations caught; vitest 4 new (`DashboardNext.test.tsx` "a staff member": no `$` anywhere on the page with the day panel open, count tiles 3/48, "1 delivery" aria-label; a withheld month header) — 12 mutations all caught; dashboard vitest 6 files 109/109; web and gateway `tsc` 0 errors. Live: owner view unchanged (`amounts: "shown"`, money tiles, footer); the sketch's staff side (`DASH-W22-after-staff.jpg`) is the owner's page with the stats and month responses rewritten in the tab. Then verified for real in P4 with my gateway restarted as the Sim roles: **staff** (Sim Bistro) — `stats` and `calendar-revenue` 200 with `amounts: "withheld"` and every spend field null, `summary` 403 "Amounts are for the house's owners and managers.", the page shows Deliveries · today / Bottles in · month, no `$` anywhere, no footer line, and the page itself calls no money-only route (`DASH-P4-role-staff.jpg`); **manager** — `amounts: "shown"`, money tiles and footer. **Not covered here:** the approvals queue reads `/procurement/orders/pending` and the day panel `/procurement/orders/history`, which still send prices to staff — the page hides them, the server does not; that gateway half is the /orders session's (queued, R1b line 2026-10-01). The seal-gate sentence can name a policy threshold ("Orders over $500 need a manager's seal") to staff — founder: "Keep the limit" (it is the house's rule, not a sale), so it stays. Bar heights and heat for staff are not asserted (withheld spend is 0, so nothing leaks either way) |
| DASH-W23 | Founder ask, given with W19: "remove the system theme from top bar into settings". The control is `ThemeMenu` in the shared top bar (`components/mudavym/HouseHeader.tsx:243`, legacy `components/layout/Header.tsx:143`) | — | — | approve + remove the system theme from top bar into settings | queued SHARED (R1b line, 2026-10-01); not built on this branch (shared parts). **[2026-10-02: shipped in PR #576, merged into this branch with main.]** |
| DASH-W24 | P5 words. The One-tap desk printed the transport and the status ("The one-tap register could not be read (Network Error)", "refused this account (403)", "Ruling it out was refused (Network Error)") and explained itself in our mechanics ("the only control here that carries a SEAL — minted when the hold begins and spent by the write", "The hold mints a seal the write has to carry back", "a gesture rather than a seal — nothing is minted and nothing is redeemed", "a written action has no workflow behind it, and the plain button says so") | live in ALDEMIR with the desk's read cut in the tab (`DASH-W24-before-desk.jpg`); `OneTapPanel.tsx`, `OneTapSheet.tsx` | say each failure as no connection / our side / not accepted, offer Try again on an unreachable desk, and say the card and footnote sentences in the house's words | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W24.html`, Safari beacon n=3, w=800-800-800) (uncommitted). `notDone(what, failure, outcome)` in `OneTapPanel.tsx` gives "… didn’t go through — it couldn’t be reached just now." (no response), "… something went wrong on our side." (5xx) or "… wasn’t accepted." (other), each followed by what did not change; used for seal, mark done, rule out, save, change and take off. A 400/403 the gateway wrote for people (`one-tap-actions.service.ts:364-376`, `common/seal/seal-challenge.service.ts` `refusalWords`) is still printed as itself on seal and mark done. Unreachable desk: "The one-tap desk couldn’t be reached just now. Nothing is listed because nothing could be read — this is not an empty desk." + Try again (re-reads the register); refused: "This account may not read the one-tap desk; an owner or manager can.…". Card promises: delivery "Confirming this books the delivery into stock against the order it names. If the order changed while you held, nothing is booked."; note die "…this stamp is not a seal and approves nothing."; note plain "Marking it done records the decision against your name. Nothing else moves.". Footnote: "…the only control here that moves stock… Any other kind of action shows what it would do but can’t be carried out from here yet — no control here sends a mail or places an order." `MOTIONS.md` quote updated in place. Evidence: dashboard vitest 6 files 112/112; new tests: network and 500 on rule out (no transport or server text), unreachable desk + Try again re-reads, refused desk has no "403", footnote has no seal mechanics; 4 mutations (network branch, 5xx branch, Try again removed, Try again dead) all caught. **Not covered:** the delivery card's promise sentence has no test and was not seen live (ALDEMIR's desk is empty); the note sentences are vitest-only |
| DASH-W24b | The note card narrated the note-close experiment to the house it measures (ADR 0127): "Reading which closing control this house is on." while the arm loads, and on a failed read "Which closing control this house should see could not be read (…), so this is the plain one — a fallback, not an assignment. Nothing about this card is being counted." | `OneTapPanel.tsx` (before: :686, :704-712) | show "Reading…" and no fallback line; keep counting nothing on a failed read; the standing line stays on /logs (DASH-W5) | Remove them (Recommended) | approved 2026-10-01 (sketch `DASH-W24.html`) (uncommitted). `note-close-experiment.test.tsx`: the unread arm shows "Reading…" and no "closing control"; a failed read and an unknown arm draw the plain button, no experiment words, and post **no** exposure event (`eventsPosted()` empty) |
| DASH-W25 | The opening's overline added "· before service" from the hour alone (16:00–23:00 → "before service"), so Sim Bistro, open 12:00–23:00, read "before service" at 16:51 mid-shift, and ALDEMIR, which has no hours set, read it too | `DashboardNext.tsx` `voice()` (before :47-53); `DASH-W24-before-top.jpg` | fork: A drop the guessed phrase (the day line below states the real hours) / B say open-now/before/closed from the house's hours (a second read or a shared change) / keep | A: drop the phrase (Recommended) | ruled and approved 2026-10-01 (sketch `DASH-W24.html`) (uncommitted). `greetingFor()` returns the greeting only, hour bounds unchanged (5–11 morning, 11–16 afternoon, 16–23 evening, else "Still up"); the overline is the date alone ("THURSDAY, OCTOBER 1"). `DashboardNext.test.tsx` asserts the h1 greeting and that no service phrase renders; `fonts.ts` and `MOTIONS.md` mentions updated in place |
| DASH-W26 | The tile subtitles were cut mid-word at desktop width ("below their mini…", "approvals in the …", "delivered purch…", "procurement, n…", "orders received …", "received this mo…") | `KpiRow.tsx:43` `truncate`; `DASH-W24-before-top.jpg` | let the sub wrap (`leading-snug`); tiles are `h-full`, so a row keeps one height | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W24.html`) (uncommitted). Live at 1280: every sub reads whole (`DASH-W24-after.jpg`). **Not unit-tested** — jsdom cannot measure a cut; the evidence is the screenshot |
| DASH-W27 | The "Write a new one" sheet said "1 action stands on this rail, read just now." beside a desk that said 0 and "Nothing standing": it counted every row of the register, and ALDEMIR's one row is the P3 review note, `status: "completed"` (`GET /one-tap-actions` → `total 1, pending 0, completed 1`) | found in P6, live (`DASH-W27-before.jpg`); `OneTapSheet.tsx` `railLine` (before: `register.rows.length`) | count only `status === 'pending'`, the desk's own rule (`OneTapPanel.tsx` `pending`) | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W27.html`, Safari beacon n=2) (uncommitted). Live after: "0 actions stand on this rail, read just now." (`DASH-W27-after.jpg`). Tests: one pending + one completed → "1 action stands"; only completed → "0 actions stand"; mutation back to `rows.length` caught |
| DASH-W28 | P5 leftover, found in P6: the sheet's own sentences still said our internals — "the book of actions holds no trigger and nothing watches it", "the seal still sits on any write it leads to — putting it on the rail buys nothing and sends nothing" | live sheet text; `OneTapSheet.tsx` trigger note and rail line | say the same facts in the house's words | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W27.html`) (uncommitted). Now "Running on a threshold or on a schedule isn’t built yet, so those two are shut rather than saved and ignored." and "An action you write is recorded against your name. Putting it on the rail sends nothing and orders nothing; anything it leads to still needs its own seal." Test: the sheet has no "book of actions", "trigger", "the seal still sits" or "any write"; mutation back to the old sentence caught |
| DASH-W29 | P7: the calendar's month and open day lived in component state, so a reload, a shared link or a phone coming back to the tab opened this month with no day — ADR 0160 asks for state in the address | live at 375/390/1024; `SalesCalendar.tsx` `useState` cursor/selected | `?month=YYYY-MM` (only off this month) and `?day=YYYY-MM-DD` (a day names its month); replace, not push | Approve, replace (Recommended) | approved 2026-10-01 (sketch `DASH-W29.html`, Safari beacon n=5) (uncommitted). `readCalendarParams` reads both, ignoring anything malformed (`?month=2026-13`, `?day=yesterday` open this month); paging, opening a day, scrubbing, closing and Today all write through one `show()` with `{replace: true}`; Today clears both. Paging a month still closes the open day, as before. Live: opening Oct 1 wrote `/?day=2026-10-01`, a reload at 375 reopened it; Previous month wrote `/?month=2026-09` and a reload kept September. Tests (`DashboardNext.test.tsx` "the calendar keeps its place in the address", 3): opens the named day and month; writes, replaces (`useNavigationType` REPLACE) and clears; ignores an unreadable address. 6 mutations caught (push, month kept beside a day, day not implying its month, malformed day or month accepted, day ignored) |
| DASH-W30 | P7: the day panel's delivery row lost its vendor — cut to "1er Cru Montmains · …" at 375; at 1024 the panel split into two ~110px columns on a viewport breakpoint inside a narrow card, showing neither wine nor vendor and spilling "1 bottle × $50 · $50" out of the box | live shots `W29-before-375.jpg`, `W29-before-1024.jpg` | the row wraps; the figures drop to their own line; the panel splits into two columns only when the card has room | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W29.html`) (uncommitted). Row: `flex-wrap`, name and vendor `break-words`, figures `ml-auto`. Panel: `grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]` replaces `md:grid-cols-2` — one column at 375, 390, 1024 and at 1440 with the counter rail open (card ~440px), two when the card is ≥ ~500px. My first build only wrapped the name and, at 1024, squeezed it to a letter a line — caught on the live shot, reworked before the ask. Calendar event rows wrap the same way. No horizontal scroll at 375/390/1024/1440. Layout is not asserted in jsdom; evidence is the live shots |
| DASH-W31 | P7: list rows cut on one line mid-word ("Order TEST-…") — day Activity, Lately, Running low, This week | live shots | two lines, then an ellipsis | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W29.html`) (uncommitted). `truncate` → `line-clamp-2 leading-snug` on the four lists. Layout only: not testable in jsdom; evidence is `W29-after-375.jpg` / `W29-after-1024.jpg` |
| DASH-W32 | P5 miss found in P7: the day panel and This week printed a calendar event's kind as its code ("· delivery_eta", "· provider_unavailable") | code (`DayDetail.tsx` event row, `RailPanels.tsx` This week); ALDEMIR has no calendar events May–Oct 2026 (read-only, `calendar-revenue`) | the kind in words; `custom` and unknown say nothing | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W29.html`) (uncommitted). `format.ts` `eventKindWords` maps the gateway's `CalendarEventType`: inventory → stock, recurring → repeats, delivery_eta → delivery expected, provider_birthday → vendor’s birthday, provider_unavailable → vendor away, inventory_count → stock count, high_volume_expected → busy day expected; the rest name themselves. Tests: day panel ("Rioja truck · delivery expected", custom bare) and This week ("Rioja closed · vendor away"); 4 mutations caught (raw type returned, a word dropped, raw type in the day panel, raw type on the rail). Seen in tests only, not live |
| DASH-W33 | P8: the page painted its captions in ink-3 (39 `text-inkm-3`: tile labels and subtitles, weekday letters, vendor clauses, times) — ADR 0042 / OD-112 says ink-3 is "decorative only; never a caption", and the shared guard reads `color` keys, not Tailwind classes, so it never saw these | live sweep of every text element on the page against its real ground: 11 fail at **4.07:1** (ink-3 on paper-1 tiles) | captions in ink-4 | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W33.html`, Safari beacon n=3) (uncommitted). All 39 in `DayDetail`, `SalesCalendar`, `RailPanels`, `WaitingOnYou`, `KpiRow`, `DashboardNext` → `text-inkm-4`. Live after: 0 of 124 text pieces fail, lowest **5.64:1** on paper, **6.98:1** on charcoal (set on the tab only; no account setting written). Test `DashboardNext.test.tsx` "paints no caption in ink-3" reads the page's own sources (`import.meta.glob`, asserts >5 files read); 2 mutations caught. The other 74 `inkm-3` matches in 10 files are other pages' (queued R1b line) |
| DASH-W34 | P8 keyboard walk: pressing Close on the day panel dropped focus to `<body>`, so the next Tab restarted at the logo, 30 shell stops away | live: `document.activeElement` = BODY after Enter on Close | hand focus back to the day's square | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W33.html`) (uncommitted). `SalesCalendar` onClose focuses `[data-date=…]` in the grid; live after: focus on "Thursday, October 1, today…" with its solid 2px seal ring. Test asserts the square has focus after Close; mutation caught |
| DASH-W35 | P8: each calendar square's accessible name was ISO and terse — "2026-10-01: $50, 0 events" — and nothing said which day was open or which was today | live `aria-label`s | the day in words, what it holds, `aria-pressed` for the open day, `aria-current="date"` for today | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W33.html`) (uncommitted). Now "Thursday, October 1, today: $50 paid to vendors, nothing on the calendar"; staff hear "2 deliveries", never money (W22 test updated to the new name). 11 test name matchers moved from ISO to words; new test; 5 mutations caught (ISO back, no "today", bare money, no `aria-pressed`, no `aria-current`) |
| DASH-W36 | P9: my W29 change exported `readCalendarParams` from `SalesCalendar.tsx`, and Vite then said "Could not Fast Refresh ('readCalendarParams' export is incompatible)" on every save, so the dev page reloaded whole each time (dev only; production unaffected) | Vite log | not exported (it has no importer outside the file) | Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W36.html`) (uncommitted). After: a save logs only `hmr update …SalesCalendar.tsx`, and `/?day=2026-10-01` still opens Thursday, October 1. dashboard vitest 121/121 |
| DASH-W37 | P10 (from the founder's news, relayed 2026-10-01: Mudavym carries every drink, then food): the page counted "wines" — "across 81 wines", "wines below minimum", "N low-stock wines", "No wine is running low.", "Unnamed wine" ×2 — against ADR 0115 (one house item id across all beverages) and ADR 0186 (every drink classified) | `KpiRow.tsx:109,117`, `DashboardNext.tsx:119,128`, `WaitingOnYou.tsx:163`, `DayDetail.tsx:287` | the word: "items" / "drinks" / hold for a product-wide pass | "\"items\" (Recommended)", then built: Approve (Recommended) | approved 2026-10-01 (sketch `DASH-W37.html`, `W37-before/after.jpg`) (uncommitted). Live in ALDEMIR: "1 low-stock item is waiting on you." · "across 1 item". "Bottles" and "In the cellar" kept (the ask said so; to be asked again when food lands). New test "counts items, never wines" plus a W7 assert; 5 mutations, all caught. `DayDetail`'s "Unnamed item" has no test. Left as is: the `/inventory?wine=` link parameter (the /inventory page reads it) and every other page (queued, R1b line). dashboard vitest 122/122 |
| DASH-G1 | PR #579 audit (both reviewers): Lately names vendors to staff ("from <vendor>", vendor-added events) while the /ask role table withholds `suppliers` from staff. No money is shown. | `dashboard.service.ts` eventSentence; `ask-readings/reading-data-classes.ts:182` | keep, or hide vendor names from staff | "Keep (Recommended)" | decided 2026-10-01: staff see vendor names on this page, as on the delivery row (W30) and in Waiting on you; ADR 0257 records the difference from /ask |
| DASH-G2 | PR #579 audit: a house with no time zone is read as UTC (`houseZone`), against the founder's 2026-09-03 rule that an unset value reads as unknown (migration `20260903170000_a_default_is_not_an_answer.sql:4`); a malformed zone answers 500. ALDEMIR has its zone set. | `dashboard.service.ts:175-183` | follow the rule in a follow-up PR / in #579 / keep UTC | "Follow rule, follow-up PR (Recommended)" | decided 2026-10-01: follow-up PR, sketch first; open debt entry and open claim `TD-2026-10-01-DASHBOARD-NO-ZONE-READS-UTC` |
| DASH-G3 | PR #579 audit fix round: `seesHouseAmounts` read the /ask table raw (case-sensitive, no `admin` alias); "added, " for an add with no count; ADR 0257 and §1a claimed more than ships (order routes still send prices to staff; the shared client still empties a failed alerts read) | `amounts-for-role.ts`; `dashboard.service.ts` eventSentence; ADR 0257 synthesis | read through `policyFor`; "added"; qualify the prose; 3 debt entries + 1 open claim | "Approve (Recommended)" | approved 2026-10-01; gateway jest 56/56, both mutants caught; the audit re-runs on the new head |
| DASH-G4 | Second PR #579 audit (on 3a72c2f) returned BLOCK: Running low printed a bare "Unnamed wine" (`RailPanels.tsx:191`) that the W37 claim's quoted-string regex could not see; prose said more than ships on failed reads; three claims passed on a comment, a one-route fix or `return true` | `.planning/07-reference/pr-audits/579-3a72c2f.md` (local), PR comment | "Unnamed item" + a nameless row in the W37 test; the claim matches bare text; prose scoped; W22, order-routes and zone claims tightened; full audit again | "Approve (Recommended)" | approved 2026-10-01; vitest W37 now expects 3 low-stock items and 2 "Unnamed item"; mutation: "Unnamed wine" back fails the test and the claim; claim mutations 11/11 (W22 `return true`, no `!role` guard, no `assertSeesHouseAmounts`; W37 bare text, gateway text; order routes on a comment, one route, both; zone `?? "UTC"`, zone null) |
| DASH-G5 | Second audit: with the role read and the stats read both failed, `activeRole` is null and `statsAmounts` undefined, so the page showed `/pending` prices to staff (no new exposure: `/pending` already sends them) | `DashboardNext.tsx` `seesAmounts` | only a known owner or manager sees amounts | "Hide money, this PR (Recommended)" | approved 2026-10-01; vitest "shows no money while the role is unknown and the stats read failed"; reverting the gate fails it |
| DASH-G6 | Second audit: an event's description (`calendar_events.*`, service:579-581) and Lately's `payload.description` are free text and reach staff; "staff see counts, never money" was broader than the code | ADR 0257, §1a | narrow the sentence to the amount fields | "narrow claim,. + but keep in my mind when we integrate the POS and when system start to work we're going to using floor coverage software we're going save the stats of each waiter, and they'll be able to see table invoices." | approved 2026-10-01; sentences narrowed in ADR 0257 and §1a; no debt entry (the line is to be redrawn with POS and floor coverage, ADR 0257 Consequences) |
| DASH-G7 | Second audit: the gateway alert said "A wine with no name" (`dashboard.service.ts:74`), shown on this page | `dashboard.service.ts` `UNNAMED_ITEM` | "An item with no name" | "Yes, this PR (Recommended)" | approved 2026-10-01; walkthrough spec expects "An item with no name — out of stock"; the W37 claim fails if the old text returns |

**Passes**

- **P1 Purpose** — done: DASH-W1 approved; no design override set.
- **P2 Truth** — done: DASH-W2 to W6 approved and built; every tile and the calendar checked against production (read-only queries plus the approved W6a test order); gateway jest `src/dashboard` 4 suites 38/38.
- **P3 Controls** — done: rows W12 to W17. Pressed live in ALDEMIR: month back / Today / forward (`GET /dashboard/calendar-revenue/05b8c4a5…?year=2026&month=9` 200, scoped to the house), day cells, day-panel links, the five tiles, the Waiting on you and Lately links, Running low. One-tap, on the founder's yes (DASH-P3 ask, "Go, all four"): write a note (`POST /one-tap-actions` 201), change it (`PUT /one-tap-actions/02357764…` 200, twice; my first select-all missed, so the first PUT stored the title twice and the second restored it), mark it done (`POST …/execute` 201; ONE click closed it, because this house is on the click side of the note-close experiment, ADR 0127 D8; the card left the rail). "Undo — rule it out" and "Take it off the rail" were **not clicked live**: once marked done the note left the rail, so neither had anything to act on, and a second note was outside the ask. "Take it off the rail" is covered by `OneTapSheet.test.tsx:187` (DELETE). "Undo — rule it out" (`OneTapPanel.tsx:608-612`, `POST …/cancel`) has **no test on this page**; only the notifications centre's copy is tested (`OneTapActionCenter.test.tsx`), so it stands unverified here → W18. dashboard/next vitest 6 files, 96/96. Waiting on you's seal hold: ALDEMIR has nothing waiting, so it could not be pressed; covered by `WaitingOnYou.seal.test.tsx`.
- **P4 States** — done. Error: the dashboard's reads stubbed in the pane (`DASH-P4-error-*.jpg`; This week's calendar query stayed cached, so its error line is neither tested nor seen live) → DASH-W19 (Try again, the house's words) approved and built. Empty: live empties read as words, never as health — Waiting on you "Nothing is waiting on you. New orders land here…", One-tap "Nothing standing…", This week "Nothing on the calendar this week.", a past day with no deliveries a quiet "·" (the blank-cell exception). Loading: skeletons (`dn-skel`) on tiles and cells, em dash for unknown, never a 0 (CountUp). Role (ADR 0147), gateway restarted per role, `accessToken` cleared and reloaded each time: staff (Sim Bistro) → DASH-W22 verified live (counts, no `$`, money-only routes 403); manager → money shown; back to `me` (ALDEMIR, re-chosen on /choose-house). The approval hold for staff (DASH-W21) is proven in vitest only — the Sim house had 0 waiting orders. Long data: Sim Bistro's 989 bottles across 81 wines fit their tiles; long Running low / Lately lists not exercised live (vitest fixtures only).
- **P5 Words** — done: DASH-W24, W24b, W25, W26 [changed 2026-10-01: and W28 — two sheet sentences my P5 grep missed because they are multi-line JSX text, found by reading the open sheet in P6]. Read every sentence the page's own files can print (`grep` for `message`, `refused`, `could not`, `(${` across `pages/dashboard/next/*`). Found and fixed: raw transport and status text and seal mechanics on the One-tap desk (W24), experiment narration on the note card (W24b), a service phase guessed from the clock (W25), cut subtitles (W26). Checked and kept: "vendors" throughout; procurement never called sales (W22's footer); dates on the house's clock (W20); money via `formatMoney`; plural "order/orders", "delivery/deliveries", "bottle/bottles"; DayDetail alert lines print the gateway's own title and message. **Not this page's, left as found:** `note-close-experiment.ts:263` still prints `(${register.message})` in the /logs line (the /logs session's); `components/orders/SealedApproveDie.tsx:187` "The gateway refused (…)" and the same raw-error pattern in 47 web files are queued as one product-wide fix (R1b line, `review-shared-queue.md`, 2026-10-01).
- **P6 Overlays** — done. The page owns one overlay, the One-tap "Write a new one" sheet (shared `components/mudavym` `Sheet`); the header's menus, bell, Ask and Counter are the shell's. Live in ALDEMIR, opened and left, nothing saved: `role="dialog"`, `aria-modal="true"`, named by its contract sentence (sketch 103 1e); focus lands in "What it does"; Tab ×17 and Shift+Tab ×20 stay inside; Esc closes and focus returns to "Write a new one"; "Leave it" (a word, ADR 0112) closes the same way; body `overflow: hidden` while open, `visible` after; the eight mark buttons carry `aria-label`s. Reduced motion is not emulable in the pane: not checked live (the sheet's motion comes from the shared `Sheet`). Found in passing: DASH-W27 (count) and W28 (words). The day panel is an inline expand, not an overlay.
- **P7 Mobile** — done. 375×812 (mobile preset) and 390×844, reloaded each time, then 1024 and 1440, back to desktop: no horizontal scroll at any width (`scrollWidth` = `innerWidth`). The bottom bar (Counter, Rooms, Search, Ask) is the shell's. Found and fixed: the calendar forgot its place on reload (W29), the delivery row lost its vendor and the day panel split too narrow at 1024 (W30), one-line cuts in four lists (W31), event kinds printed as codes (W32, a P5 miss). Not checked: real touch (the pane's mobile emulation sends mouse clicks); the day tape's scrub by drag on a phone.
- **P8 Brand & accessibility** — done. Ground: the page root is paper-0 (`#FFFDF8`, ADR 0169) and turns to charcoal (`rgb(21,19,15)`) under the person's choice, set on the tab only. Logo 24px. Motion: `CountUp` on the `tally` spring and `DashboardNext`/`SalesCalendar` through `lib/mudavym` `animate`/`settle`; `dashboard-next.css` repeats the `settle` (320ms) and `ink` (160ms) values on the house curve and stills them under reduced motion; the skeleton sheen (1.9s) has no token. Fonts: the page's own text is Fraunces, Plus Jakarta Sans and JetBrains Mono; the shared DayLine sets DM Sans (queued). Contrast: every text element measured against its real ground → DASH-W33. Keyboard-only walk, 60 Tabs: the page's 16 stops run in reading order (tiles, month arrows, days, Close, the day tape slider with `aria-valuetext`, delivery link, Write a new one, rail links), each with a solid 2px seal ring; found DASH-W34 and W35. Future days are `disabled`, so they are skipped. Queued for the shell (R1b lines): the sidebar's focus ring at 1.68:1, no skip link (30 stops before the page), ink-3 captions in 10 other files, and the DayLine font. Not checked: a real screen reader (names read from the accessibility tree only); reduced motion live (not emulable in the pane).
- **P9 Console and network** — done. Baseline: a fresh load of `/` in ALDEMIR, `me` mode. Console: no errors from the page. Network: every call 200, and each of the page's reads fires once — stats, pending orders, low stock, activity, alerts, the month ledger, This week's calendar, one-tap, the note-close experiment. The duplicate month GET noted in the staff run did not come back. Refresh: the page re-reads every 5 min and on the socket's `ws:dashboard-invalidate` nudge (`useDashboardNextData.ts:161-170`); fired by hand, all seven re-reads came back in 227–546 ms (slowest: the month ledger) against production. The token had expired, so each first try was 401, then `/auth/refresh` 437 ms and a clean retry; no sign-out, no error on the page. Nothing slower than 0.6 s. Polling seen over 68 s: only the shell's 60 s reads (house/day, house/counter, unread count). Found: DASH-W36 (Fast Refresh, from my own W29). Queued for the shell and gateway (R1b lines): `/auth/me` read twice a load against a 10-a-minute per-IP auth bucket (429 "Failed to load user", seen live 12 times during P7's reloads); TenantGuard warns on every authenticated request (1,371 lines in this session's log); the socket greets "Connected to WineOps AI"; no CORS `maxAge`, so dev pays a preflight per call. Dev noise left as found: React DevTools hint, `[ErrorTracking] No DSN`, the socket opening twice under StrictMode (the gateway ends on one connection for this tab). Not checked: production's call counts (P10), and a load timed from cold (the 250-entry timing buffer fills with Vite modules first, so first-load timings were not captured).
- **P10 Live** — partly done. **Chrome was not connected** (two tries), so production's page was **not seen**: no visual or data comparison of the live dashboard. Done without it: the live commit is `5a330a88e` (#575), which is `origin/main`'s tip and **not** an ancestor of this branch (`git merge-base --is-ancestor` false). This branch sits on `1c1a676f8` (#560); main has 3 commits since (#563 recurring-schedule house check, #568 counter stays closed, #575 Counter button), and **none touch `pages/dashboard` or `api-gateway/src/dashboard`**. So production's dashboard is this page before W1, and every row here is ours, unmerged (deploy lag, not bugs). The counter and Ask behaviour differs the other way, with production ahead: rebase before the PR. Read from the public bundle (`index-BdYqtq-h.js`): production calls the Railway gateway cross-origin, and a read-only OPTIONS answers with no `Access-Control-Max-Age`, so the P9 preflight cost is production's too (queue row amended). The "$58 vs $50 on Oct 1" seen earlier did not come back: the ledger, the Today tile and the day panel all say $50 (`calendar-revenue` month 10: one day, $50, 1 order); where the $58 came from was not recorded. Data note: that $50 **is** the P2 test order "TEST-R1-DASH-W6" (row DASH-W6a, approved under W6), the only delivery on Oct 1. It also shows in Lately and in Oct 1's activity, and stays as is (rows are never deleted; cancelling it is the founder's call).
- **Preferences writes (R3's warning, 2026-10-01).** On a fresh profile the guidance layer can PATCH `/users/<id>/preferences` with defaults before reading the saved ones (R3's shared-queue row "shell / guidance"). Checked for this session: the surviving gateway logs (`me` from about 5:52 PM, plus the staff and manager runs) hold **no** PATCH or PUT to `/users/*/preferences`; the only write is one `POST /auth/switch-restaurant`. **Not covered:** the `me` runs of P1–P4, whose log was overwritten on restart. R4's log shows two such PATCHes from Browser-pane loads, so those runs may have written defaults too; request bodies are not logged.
