---
type: page
route: /team
slug: team
softwares: [team-command]
component: apps/web/src/pages/team/command/TeamCommandPage.tsx
audience: staff
tier: core
archetype: command # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: live
status: documented
updated: 2026-09-02
links: ["[[PAGE-CONTRACT]]"]
---

# /team — Team Command

> **Part of** [[08-softwares/team-command|Team Command]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Invite member / Add staff** (manager) → (modal — InviteTeamDialog)
- **Publish week / Re-publish** (manager) → API `POST /restaurants/:rid/team/schedules/:scheduleId/publish`
- **Copy last week** (manager) → API `POST /restaurants/:rid/team/schedules/copy-week`
- **Broadcast crew** (manager) → API `POST /restaurants/:rid/team/broadcast`
- **Import sheet** (manager) → (modal — ShiftImportModal)
- **Print week** (manager) → (new browser window — printable schedule sheet)
- **Got it** (staff, acknowledge schedule) → API `POST /restaurants/:rid/team/schedules/:scheduleId/acknowledge`
- **Claim** (staff, cover offer) → API `POST /restaurants/:rid/team/shifts/:shiftId/assign`
- **Request time off this week** (staff) → API `POST /restaurants/:rid/team/time-off`
- (no page-to-page links — dead-end in the page graph)

## 1. Purpose

"Role-split surface (sketch 038 production port). Owner/manager get the full
Manager Shift Desk; staff get read-only My Shifts" (`TeamCommandPage.tsx:1-4`).
Manager side: week grid, schedule create/copy/publish, shifts with callouts and
cover offers, certifications, coverage-rule templates, sales ingest, performance
panel, broadcast, shift import/export. Staff side: my week, acknowledge schedule,
take cover, request time off.

## 1a. Features
Manager Shift Desk (owner/manager):
- Week grid with schedule create, copy-week, publish
- Shifts with callouts, cover offers, and assignment
- Certifications; coverage-rule templates; time-off management
- Sales ingest + per-member performance panel
- Broadcast a message to the team; shift import/export
- Invite team members; switch branches

My Shifts (staff, read-only):
- See my week; acknowledge the published schedule
- Take an open cover; request time off

Mudavym redesign behind `mudavym_design_team` (OFF):
- **Coverage gaps as the page's first object** — named countable rows ("2 unfilled · Saturday · line") with a real suggested cover and a one-tap Assign
- **Labour cost as the week builds** — total vs target with overtime named before publish; withheld in words when tracking is off
- **Credentials as blockers** — an expired card blocks the shifts it touches, with a one-tap renewal request and a cannot-publish-as-it-stands line
- Week-at-a-glance day chips (staffed / open / status)
- 🚧 Parity gap, deliberate: the full desk (editors, publish, time-off, performance, my-shifts) still lives on the legacy page while the flag is off — flip to judge the new layer, flip back to operate (§9)

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_team`)

Canonical source with curves: `apps/web/src/pages/team/next/MOTIONS.md` — this
list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `tm-ink` | Ink micro-state | day-chip borders and control hover/focus — colour only, nothing translates |

Deliberate non-motions: gap rows never animate in (an unfilled shift is a
standing fact, not an arrival); the labour figure never tallies; "assigned" /
"requested" confirmations are a change of words, in place.

**2026-08-31 wave polish (Sorting Office two-Opus review):** the Assign,
"Request renewal" and error-banner "Try again" controls carried an inline
`background: 'transparent'` (or a ternary resolving to it) that permanently
outranked `.tm-ctl:hover` — dead hovers on every tm-ctl control; fixed by
omitting the inline value instead of adding `!important` (verified via a
static cascade repro, since the route sits behind auth). The week's-labour
figure was resized 26px → 22px to match the page-level-figure convention set
by `documents-reports/next/so-format.ts`'s `Count` component and
CommunicationsNext's glance strip (no wave value had been recorded before
this). `fmtWeekday`/`fmtDayShort` in `tm-format.ts` were checked against the
same-day `so-format.ts` date-parser bug and found already correct — they
append `T00:00:00` before parsing, which JS reads as local time (unlike a
bare date-only string, which reads as UTC), so no backport was needed here.

### Design used, and why (ADR 0045 §5 wave · MAKEOVER-VERDICTS: KEEP + three ideas)

The verdict kept the redesign ("spot on") and asked for three additions; all
three ship as the page's leading objects, each derived from endpoints that
already exist — nothing invented. The suggested cover is a stated derivation
(role-matching member, free that day, fewest scheduled hours this week — fair
rotation), never an AI claim; when no candidate exists the row says why. The
one-tap Assign creates a real cover shift only when the gap's period carries
parseable clock times — otherwise the control is disabled with the reason,
per the honesty rules. The renewal request rides the existing broadcast
channel to exactly that member. Publish-blocking is stated in words on the
page (the publish control itself stays with the desk until parity).

## 2. Entry

- Sidebar "Team" (`components/layout/Sidebar.tsx:114`); command palette `g t`
  (`components/command/commands.ts:64,80`).
- [PAGE_MAP](../foundation/PAGE_MAP.md):128 lists it as no-inbound — the scan missed
  layout components; sidebar and palette are the real entries.

## 3. Files

- Route binding: `apps/web/src/App.tsx:276` (eagerly imported :74).
- Tree: `pages/team/command/{TeamCommandPage.tsx, ManagerShiftDesk.tsx, MyShifts.tsx, PerformancePanel.tsx, OpsRulesPanel.tsx, editors.tsx, bits.tsx}`.
- Shared renders: `components/team/{InviteTeamDialog, ShiftImportModal}.tsx`,
  `components/layout/RestaurantBranchSwitcher.tsx` (ManagerShiftDesk.tsx:16-18).

## 4. Endpoints

Everything under `/restaurants/:rid/team` (`services/api/team.ts:7-11` builds the
base). Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):565 (`team`, 33 at the
time of that scan — the largest module any of these pages consumes; **32 since
ADR 0088 deleted `GET …/swaps`**, which no client called and which read a table
nothing in the repository writes), :516 (`restaurants/members`), :87 (`calendar`).

| Method | Path | Call site |
|---|---|---|
| GET/POST/PATCH/DELETE | `…/members` | ManagerShiftDesk + editors → `team.ts:124-136` |
| GET | `…/week`, `…/my-week` | `team.ts:141,145` (ManagerShiftDesk / MyShifts) |
| POST | `…/schedules`, `…/schedules/copy-week`, `…/schedules/:id/publish`, `…/schedules/:id/acknowledge` | `team.ts:149-161` |
| POST/PATCH/DELETE | `…/shifts` (+ `/callout`, `/offer-cover`, `/assign`) | `team.ts:167-186` |
| GET/POST/PATCH/DELETE | `…/certifications` | OpsRulesPanel → `team.ts:192-204` |
| GET/POST/PATCH | `…/time-off` | MyShifts/desk → `team.ts:209-217` |
| GET/POST/DELETE | `…/coverage-templates` | OpsRulesPanel → `team.ts:223-231` |
| GET | `…/members/:id/performance` | PerformancePanel → `team.ts:236` |
| POST | `…/sales`, `…/sales/batch` | PerformancePanel → `team.ts:240-244` |
| POST | `…/broadcast` | ManagerShiftDesk → `team.ts:250` |
| GET/PATCH | `…/settings` | `team.ts:256-260` |
| GET | `/calendar/events` | desk overlays events — `ManagerShiftDesk.tsx:17` → `services/api/calendar.ts:221` |

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** — operate (scheduling is operating furniture; no S-scenario claims it as
spine). Boundary that binds this page's future: Floor Checker scenarios
(S05/S07/S16) "must never be sold as staff performance analytics"
([TIER-MAP](../03-scenarios/TIER-MAP.md):104-105) — the PerformancePanel here is
sales-ingest based, which is the permitted kind; keep the two apart.

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits in the tree). Layout chrome per
dashboard.md §7.

## 8. State & config

- Role gate: owner/manager → ManagerShiftDesk, everyone else → MyShifts
  (`TeamCommandPage.tsx:1-4`, via `useAuth` :5).
- Multi-branch via RestaurantBranchSwitcher; labor/goal settings edited from
  `/settings` (`components/team/TeamLaborSettings.tsx`, mounted by Settings).

## 9. Gaps

- Performance metrics depend on manually ingested sales rows (`team.ts:240-244`)
  until POS depth exists — the S04 ⚠ wine-only depletion caveat applies
  ([TIER-MAP](../03-scenarios/TIER-MAP.md):40).
- No debt-register entries name `/team` (checked `v3.0-TECH-DEBT.md` — no hits).
- **The whole scheduling domain is empty in production** (measured 2026-09-02):
  `coverage_templates` 0, `schedules` 0, `shifts` 0, `team_certifications` 0,
  `server_sales` 0, `team_settings` 0, `schedule_receipts` 0. Only the 11-row
  roster exists. Nothing on this page below the roster has ever run against real
  data, so a green test here proves the code, never the behaviour.
- **No wage is on file for anyone.** ADR 0088 stopped the server inventing one,
  and the 11 existing rows still carry the invented $32.00/$28.00 literals — they
  are *not* deleted by that change. Until someone enters real wages, the week
  total, the Tonight pulse and the CSV "Labor cost" column read `—`, by design.
- **`team_settings.labor_target_pct` is `numeric(5,2) DEFAULT 28 NOT NULL`**, so
  the first restaurant to toggle `wage_visible` gets a stored 28% target it never
  chose. ADR 0088 fixed the code-side default (no row → `null` + `configured:
  false`); making the column nullable is a separate migration against a table
  with 0 rows.
- **Three controls need a client half before they work again** (ADR 0088 T3/T7,
  owned by the `/team` page session, not the gateway): "Copy last week" and
  "Re-publish" now answer 409 until the client sends `replaceTarget` /
  `resetReceipts` with a confirmation, and the legacy desk's broadcast answers
  400 until it sends an `audience`.

## 10. Maturity

**live.** Corrected from `complete` on 2026-09-02 (ADR 0088). Every advertised
action does reach a real, role-enforced endpoint — but a 2026-09-02 gateway audit
found seven defects, three of the six evidence rows below were false as written,
and "complete" was reading the absence of a bug report as the absence of bugs.

### The three rows that were wrong, and why

| Was claimed | What was true on 2026-09-02 |
|---|---|
| "Role gate is enforced server-side" | `assertAccess` (`team.service.ts:56-64`) fell back to `users.restaurant_id` + `users.role`, and `users.role` is `varchar(20) DEFAULT 'manager' NOT NULL` — so **a user row with a restaurant id and an untouched role was a manager of /team**. `listCertifications` (`:397`) required no role at all and `listTimeOff` (`:477`) exposed every member's dates and free-text reasons to any member. `assertAccess(..., "owner")` was defined at `:71-72` and **called nowhere in the module**. Fixed by ADR 0088 T5 |
| "Every mutation carries an `onError` toast" | **Seven do not.** Not re-verified since 2026-08-26; the six line citations were real, the word "every" was not |
| "Where the UI misleads: nothing found" | The Tonight-labor pulse renders `$${...(s.labor_cost ?? 0)}` (`ManagerShiftDesk.tsx:429`) — an unpriced shift and a free shift print identically — and until ADR 0088 the wage feeding it was invented by the server (`team.service.ts:205-207`): **11 of 11 production rows carried the literal**, so 100% of the labour figures on this page were fiction |

### The rows that still hold

| Check | Evidence |
|---|---|
| Publishing a week is a real event | `schedule.service.ts` sets `status:'published'` and writes a restaurant-wide notification deep-linked back to `/team?schedule=…&week=…`. It also **clears `schedule_receipts`** — which the old row listed as a feature; since ADR 0088 that clearing requires `resetReceipts: true` and reports `receiptsCleared`, because destroying the record of who has seen the schedule is not a side effect a click should have |
| Broadcast reaches four channels | In-app notification + web push + email + SMS (`team.controller.ts`). Since ADR 0088 it must name its audience, and it honours `notification_preferences` opt-outs the scheduled mailer already honoured |
| Performance numbers are not invented | `PerformancePanel.tsx:3` states the rule explicitly — *"'no data yet' state (never mock numbers) until sales are attributed"* — and honours it. Contrast `/reports` (reports.md §10) |
| Debt register | No `v3.0-TECH-DEBT.md` entry names `/team` (§9, re-verified 2026-09-02) |

The one dependency worth naming is not a defect on this page: performance metrics
come from **manually ingested** sales rows (`POST …/sales`, `…/sales/batch`,
`services/api/team.ts:240-244`) until POS depth exists (S04 ⚠, TIER-MAP:40). The panel
says so rather than filling the gap.

## 11. Data flow

### Calls out

All under `/restaurants/:restaurantId/team`, JWT-guarded at class level
(`apps/api-gateway/src/team/team.controller.ts:51-52`), with per-route
`assertAccess` for the manager verbs.

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET/POST/PATCH/DELETE | `…/members` | JWT + role | `team.controller.ts` → `team.service.ts` | Roster |
| GET | `…/week`, `…/my-week` | JWT | `team.controller.ts` | Grid / staff week |
| POST | `…/schedules`, `…/schedules/copy-week` | JWT + manager | `schedule.service.ts` | Draft week; copy-week returns `{copied, deleted, schedule}` and **409**s on a non-empty target unless the body says `replaceTarget: true` (ADR 0088) |
| POST | `…/schedules/:id/publish` | JWT + manager | `schedule.service.ts` | `{schedule, receiptsCleared, republished}` + notification. **409** on a re-publish that would erase read receipts, unless the body says `resetReceipts: true` (ADR 0088) |
| POST | `…/schedules/:id/acknowledge` | JWT | `schedule.service.ts:268-...` | Read receipt |
| POST/PATCH/DELETE | `…/shifts` (+`/callout`, `/offer-cover`, `/assign`) | JWT | `team.controller.ts` | Shift rows |
| GET/POST/PATCH/DELETE | `…/certifications`, `…/coverage-templates` | JWT | `team.controller.ts` | Ops rules |
| GET/POST/PATCH | `…/time-off` | JWT | `team.controller.ts` | Requests |
| GET | `…/members/:id/performance` | JWT | `team/performance.service.ts` | Attributed sales, or an honest empty |
| POST | `…/sales`, `…/sales/batch` | JWT | `performance.service.ts` | Ingested rows |
| POST | `…/broadcast` | JWT + manager | `team.controller.ts` | `{audience, recipients, suppressed, preferencesUnavailable, …}`. **400** unless the body names exactly one of `memberIds` or `audience:"everyone"` (ADR 0088) |
| GET/PATCH | `…/settings` | JWT | `team.controller.ts` | Labor/goal settings (edited from `/settings`) |
| GET | `/calendar/events` | JWT | `calendar.controller.ts:94` | Desk overlay |

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Roster, shifts, schedules, certifications, time-off | Manual entry on this page + `ShiftImportModal` | Yes |
| Sales attribution | **Manual ingest only** (`…/sales`) — no POS producer wires into it today | Manual |
| Calendar overlay | `/calendar` events (calendar.md §11) | Yes |
| Invites | `POST /auth/invite` → `InviteTeamDialog` → `/invite/:code` landing | Yes |

No Python agent writes to any `team_*` table — verified. This page is entirely
human-driven, which is why it has no hollow surfaces: there is no dormant producer to
be hollow about.

### Writes

| Write | Downstream reaction |
|---|---|
| Publish week | Restaurant-wide notification (`/notifications` inbox), receipts cleared, staff `my-week` changes |
| Broadcast | Notification + push + email + SMS (`team.controller.ts:350-380`) |
| Acknowledge | `schedule_receipts` row — the manager's "seen" column |
| Claim cover / callout | Shift assignment changes for both members |
| Sales ingest | `…/members/:id/performance` becomes non-empty |

## 12. Design intent

**Should be:** one surface that answers "who is on, who saw it, who is missing" for
the manager, and "what am I working" for everyone else.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Yes | `TeamCommandPage.tsx:18,32` |
| Empty | Yes | `PerformancePanel.tsx:3` — the deliberate no-data state |
| Error | Partial | Every **write** toasts on failure (`ManagerShiftDesk.tsx:204+`); read queries have no `isError` branch, so a failed roster fetch reads as an empty roster |
| Permission-denied | Yes, structurally | Non-managers get `MyShifts` rather than a denied Manager desk (`TeamCommandPage.tsx:1-4`), backed by server-side `assertAccess` |

**Where the UI misleads:** nothing found. Print-week opens a real window; import is a
real upload; the performance panel refuses to draw numbers it does not have.

The boundary to defend: TIER-MAP:104-105 — Floor Checker scenarios (S05/S07/S16)
"must never be sold as staff performance analytics". `PerformancePanel` is
sales-ingest based, which is the permitted kind. Keep them apart.

## 13. Roadmap

1. **Attribute sales from POS** instead of manual ingest (`services/api/team.ts:240-244`)
   — turns the performance panel from a data-entry chore into a by-product. Blocked
   on POS depth (S04 ⚠, TIER-MAP:40).
2. **`isError` branches on the read queries** so a failed roster does not read as an
   empty restaurant — the one state gap on the page.
3. Instrument this page first when signals land (§5): publish→acknowledge latency and
   cover-claim time are the two numbers a manager would actually act on, and both are
   already in the schema (`schedule_receipts`).
4. Link a broadcast notification back to the specific schedule rather than `/team`
   (`team.controller.ts:355`) — publish already does this (`schedule.service.ts:259`).
