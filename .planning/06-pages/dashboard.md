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
  - **A tenant switch never leaves the previous house's actions on screen.** The
    reset effect blanks the register the moment `restaurantId` changes
    (`OneTapPanel.tsx:135-139`), and a response that arrives after the switch is
    discarded rather than rendered (`:148,151`). Both halves are pinned by
    `OneTapPanel.test.tsx` ("discards a response that lands after the restaurant was
    switched" and "shows nothing from the previous house while the new one is still
    loading"); with either guard removed, both fail.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_dashboard`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
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
| `day-open` | Settle expansion | the day-detail panel; each Waiting-on-you row into its HoldToApprove; the "write a new one-tap action" form on the rail |
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
| `/` | A one-tap action of your own | sheet | Owed · fork F4 | A person's own act is one object on the rail; the rail stays producer-defined otherwise. | `components/dashboard/QuickActionsPanel.tsx:332 and pages/Notifications.tsx:1705 (legacy); built by the founder's ruling 2026-09-05` |
| `/` | Add an important date | — | Retires | The calendar's entry sheet — the house has one day-book (ADR 0111). | `components/dashboard/AddImportantDateModal.tsx:125` |
| `/` | Edit a quick action | — | Retires · fork F4 | One-tap actions moved to the dashboard rail (OneTapPanel). A person's own action is built as the sheet drawn above (decided 2026-09-05, F4). | `components/dashboard/QuickActionsPanel.tsx:332` |
| `/` | Daily sales report (a day) | — | Retires | DayDetail expands in place under the sales calendar (pages/dashboard/next/SalesCalendar.tsx:217). | `pages/Dashboard.tsx:1414` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

### Overlays decided (2026-09-06)

> The table above is generated from `census.py`. This one is the **decision** — finder B's
> per-row spec judged against the adversary's verdicts and against what packets 0-2 built after
> the finders read the tree. House contract, shapes and the authority rule are
> [ADR 0112](../decisions/0112-one-modal-policy-three-shapes-one-primitive.md); the cross-page
> rules are [ADR 0133](../decisions/0133-one-motion-per-act-across-every-page.md).

| Overlay | Shape | Contract sentence | Four states, denied included | Ceremony, under the authority rule | Phone form | Motion | Status |
|---|---|---|---|---|---|---|---|
| A one-tap action of your own | sheet 440, scrim off (packet 0's new default) | "Write one act you want on your rail. Saving puts the tile there; it does not run it, and any write it later makes still asks for the seal. Leaving writes nothing." | *empty* n/a (a new object) · *loading* the dry run reads "Working out what this would do today…" · *error* "The action was not put on the rail. Your rail is unchanged." · *denied* "You can see this, but only an owner or a manager may put an action on the rail. Ask {name} to grant it." (`Denied`, packet 0) | **none.** Saving a definition is not a commitment; the seal sits on the act's own write, later | half detent, the trigger chips at peek, `repositionInputs` on | `tuck` 300, 28 px | **built** — packet 2 `0dce57ba` |

Three additions finder B made to this row and the adversary kept: (a) **the dry run** — the sheet
states what the action *would do today*, computed now, because an action with no dry run is a
promise; (b) **the authorship mark** — `one-tap-actions.service.ts` already distinguishes a
house-raised action from a person's, and the rail mixes both; (c) **the permission state at write
time**, not at run time. Rejected: a **panel** (what is written is a six-field object that will be
edited again) and **the palette with one argument** (a threshold and a schedule are two, which the
census's own cap forbids).

## 1c. Motions decided (2026-09-06)

> One motion answers one act, and every page answers with the same motion
> ([ADR 0133](../decisions/0133-one-motion-per-act-across-every-page.md)). `Today` is measured on
> `feat/mudavym-design-p4`. Owner packets: **packet 3** is the motion pass, **packet 4** the states
> owed, **packet 5** the gestures.

| Act | Today (`file:line`) | Decided | Rejected, and why it loses | Status |
|---|---|---|---|---|
| Opening line, once on mount | `{ easing: settle.easing, ms: 420 }` — `pages/dashboard/next/DashboardNext.tsx:68` | `settle` **320**, opacity 0 to 1 + 6 px rise. Delete the literal | (a) keep 420 and mint an eighth token — a masthead does not earn a token two pages already answer at 320 (`NotificationsNext.tsx:190-197`, `ProfileNext.tsx:220-227`); (b) no entrance — the serif line is the house speaking once | owed to **packet 3** |
| Month grid first paint | `cal-arrive`, house curve at **420** with a 16 ms delay decaying x0.94 — `pages/dashboard/next/SalesCalendar.tsx:75` | `settle` **320** per cell; the 16 ms x 0.94 delay decay is unchanged. The stagger's identity is its decay, not its per-cell duration | (a) rename it "`turn` 420" — `turn`'s curve is `cubic-bezier(0.32,0.72,0,1)` and this runs the house curve, so the rename would silently change the shape (adversary, against finder A); (b) uniform 34 ms interval — 35 cells x 34 ms is 1.19 s of arrival | owed to **packet 3** |
| KPI figures arrive | `tally` 840 off `springs.tally.samples`; an em dash never counts | keep exactly. `tally` is `motion.ts:129`, spring 120/26, overdamped, settles at 852 ms | (a) odometer roll — implies a meter that has been running; (b) instant — a figure that arrives is the house's stated tally trigger | no change |
| Day cell opens the day detail | `settle` 320 on `grid-template-rows: 0fr to 1fr`, chevron on the same token | keep — this is the house's canonical row expand, and nine pages agree | (a) a sheet — the month must stay visible; (b) `turn` — the day was already on screen | no change |
| Scrub the day | un-eased live `pointermove`, no interpolation between samples | keep, **and add the ghost read-out**: a mono label tracks the needle showing the sample's own day, appearing at 0 ms and gone on pointer-up. No easing anywhere in the path | (a) ease between samples — fabricates data; (b) snap with `tuck` — implies the value moved | owed to a page pass |
| Approve, from "Waiting on you" | `HoldToApprove` `pour` 620 to `stamp` 360 | keep, and add **consequence-scaled press**: depth `1.5 + 2.5 x weight` px over 70 ms, weight taken from the house's own approval threshold (ADR 0116). **When the threshold is not known client-side, there is no depth variation and the label says the amount is not weighed** | (a) uniform depth — the same POST for a EUR 212 and a EUR 1,860 order; (b) a full-depth or a shallow fallback when the threshold is unknown — an invented figure either way, at the door, on a phone with no signal | owed to **packet 5** |
| The one-tap "die" arm (`note_close_control`, ADR 0127) | `pour` to `stamp` landing **over no seal at all** | **a plain button.** The wax appears where a server redeems a seal, plus an irreversible act with no server to ask; a written note redeems nothing and destroys nothing, so it takes neither the wax nor a second stamp | (a) keep the die — the file already records the cost, and the two arms are visually identical at rest; (b) the dry emboss — promoting it to a second ceremony makes the wax stand against a smaller stamp rather than against nothing, and rationing collapses the other way | owed to **packet 3** |
| Loading | `skel-sheen` / `dn-sheen`, `cubic-bezier(.45,0,.55,1)` **1.9 s infinite** — `pages/dashboard/next/dashboard-next.css:44` | **two cycles, then still, then the wait in words.** 3.8 s is under SC 2.2.2's five-second trigger, so the criterion is met with no control at all, and the still skeleton plus a sentence is the house's own anti-spinner idiom | (a) keep the infinite loop — SC **2.2.2 Pause, Stop, Hide is Level A**, it applies to content that starts automatically, runs past five seconds and sits in parallel with interactive content, and its preload exception needs "interaction cannot occur", which is false here (the header, the rail and the other tiles are live); (b) rely on `prefers-reduced-motion` — that is a 2.3.3 **AAA** technique, and 2.2.2 wants a mechanism, not an OS preference | owed to **packet 3** |
| A live figure changes under a reader | `lib/websocket.tsx:489-491` blanket-invalidates `inventory`, `dashboard` and `wines` | the `sys-08` rail: hold the deltas behind a fixed rail reading `new: N`, `N` counting on `tally` 840, and **apply on an explicit act only — click, key, scroll or blur, never on idle.** The applied row flashes once on `ink` 160 and nothing translates | (a) apply immediately — the measured defect; (b) apply after 4 s of no movement, as the demo specifies — a person reading a line is definitionally not moving, so the heuristic fires into the fault it was written to prevent | owed to **packet 5** |
| Error, empty, offline | no page-specific motion | leave still | a shake, a toast — refusals are sentences | no change |

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
| GET | `/api/v1/calendar/ical-token` | **relative `fetch`**, `pages/Dashboard.tsx:267` — see §9 |

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
'public.ux_experiment_assignments' in the schema cache"** (curl, 2026-09-05),
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

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the Low Stock Alerts card reads camelCase (`Dashboard.tsx:998,1004,971`, modal `:1315-1320`) from a snake_case payload (`GET /inventory/:id/low-stock` → `v_low_stock_items`, `database.service.ts:57-62`), so all 7 real wines render as "Unknown wine" with blank counts (defect 1). "Top Performing Wines / This month's best sellers" never reads sales — `topPerformingWines` (`:327-345`) aggregates procurement orders and calendar entries — so it says "no sales performance data" over $2,236 of real sales.

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
| GET `/api/v1/calendar/ical-token` | JWT, **raw `fetch` relative to the SPA origin** | `calendar` module | `{ token }`; the copied URL is then built from `window.location.origin`, so on any host that is not the gateway the subscription URL is wrong as well as the request |

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

### Motions and overlays — the rows this pass owes (2026-09-06)

From the decisions in §1c. Owner packets: **packet 3** the motion pass, **packet 4** the
states owed, **packet 5** the gestures; a *page pass* is this page's own next opening.
The reasoning is in §1c and in [ADR 0133](../decisions/0133-one-motion-per-act-across-every-page.md);
these are the rows.

1. `pages/dashboard/next/DashboardNext.tsx:68` — delete `{ easing: settle.easing, ms: 420 }`, use the `settle` token (320). **packet 3**
2. `pages/dashboard/next/SalesCalendar.tsx:75` — same literal on the month stagger; `settle` (320), the 16 ms x 0.94 delay decay unchanged. **packet 3**
3. `pages/dashboard/next/dashboard-next.css:44` — bound `dn-sheen` at two cycles (3.8 s), then still, then the wait in words. SC 2.2.2 Level A. **packet 3**
4. `pages/dashboard/next/OneTapPanel.tsx` — the un-sealed `die` arm of `note_close_control` (ADR 0127) loses the `stamp` it lands over no seal; a plain button. **packet 3**
5. `components/mudavym/HoldToApprove.tsx` — optional `weight?: number`, depth `1.5 + 2.5 x weight` px over 70 ms from ADR 0116's threshold, and **no depth variation with the label saying so when the threshold is unknown**. **packet 5**
6. `lib/websocket.tsx:489-491` — the `sys-08` rail: hold the deltas, `new: N` on `tally` 840, apply on an explicit act, one `ink` 160 flash, nothing translates. **packet 5**
7. The day tape gains the ghost read-out (mono label on the needle, 0 ms in, gone on pointer-up). *page pass*

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
   `VITE_API_GATEWAY_URL`, not `window.location.origin` (§9, §11).
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
   both-arms report is therefore unproven against real data.** Same standing
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
