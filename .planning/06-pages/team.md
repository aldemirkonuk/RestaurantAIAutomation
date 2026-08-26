---
type: page
route: /team
slug: team
component: apps/web/src/pages/team/command/TeamCommandPage.tsx
audience: staff
tier: core
archetype: command # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: complete
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]"]
---

# /team — Team Command

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
base). Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):565 (`team`, 33 — the
largest module any of these pages consumes), :516 (`restaurants/members`), :87
(`calendar`).

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

## 10. Maturity

**complete.** The only page in this cluster where every advertised action reaches a
real, role-enforced endpoint and produces a downstream effect.

| Check | Evidence |
|---|---|
| Role gate is enforced server-side, not just in the UI | `assertAccess(userId, rid, "manager")` guards every manager action — publish (`team/schedule.service.ts:232`), broadcast (`team/team.controller.ts:346`), etc. The client split (`TeamCommandPage.tsx:1-4`) is convenience on top, not the control |
| Publishing a week is a real event | `schedule.service.ts:231-265` sets `status:'published'`, **clears `schedule_receipts`** so "seen" reflects the new version (`:247-251`), and writes a restaurant-wide notification deep-linked back to `/team?schedule=…&week=…` (`:254-263`) |
| Broadcast reaches four channels | In-app notification + web push + email + SMS, targeted at active linked members, best-effort per channel (`team.controller.ts:335-380`) |
| Performance numbers are not invented | `PerformancePanel.tsx:3` states the rule explicitly — *"'no data yet' state (never mock numbers) until sales are attributed"* — and honours it. Contrast `/reports` (reports.md §10) |
| Mutations report failure | Every mutation carries an `onError` toast (`ManagerShiftDesk.tsx:204,209,295,300,329,344`) |
| Debt register | No `v3.0-TECH-DEBT.md` entry names `/team` (§9, re-verified) |

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
| POST | `…/schedules`, `…/schedules/copy-week` | JWT + manager | `schedule.service.ts` | Draft week |
| POST | `…/schedules/:id/publish` | JWT + manager | `schedule.service.ts:231-265` | Published schedule + notification |
| POST | `…/schedules/:id/acknowledge` | JWT | `schedule.service.ts:268-...` | Read receipt |
| POST/PATCH/DELETE | `…/shifts` (+`/callout`, `/offer-cover`, `/assign`) | JWT | `team.controller.ts` | Shift rows |
| GET/POST/PATCH/DELETE | `…/certifications`, `…/coverage-templates` | JWT | `team.controller.ts` | Ops rules |
| GET/POST/PATCH | `…/time-off` | JWT | `team.controller.ts` | Requests |
| GET | `…/members/:id/performance` | JWT | `team/performance.service.ts` | Attributed sales, or an honest empty |
| POST | `…/sales`, `…/sales/batch` | JWT | `performance.service.ts` | Ingested rows |
| POST | `…/broadcast` | JWT + manager | `team.controller.ts:335-380` | Fan-out result |
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
