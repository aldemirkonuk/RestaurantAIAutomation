---
type: page
route: /team
slug: team
component: apps/web/src/pages/team/command/TeamCommandPage.tsx
audience: staff
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /team — Team Command

## 1. Purpose

"Role-split surface (sketch 038 production port). Owner/manager get the full
Manager Shift Desk; staff get read-only My Shifts" (`TeamCommandPage.tsx:1-4`).
Manager side: week grid, schedule create/copy/publish, shifts with callouts and
cover offers, certifications, coverage-rule templates, sales ingest, performance
panel, broadcast, shift import/export. Staff side: my week, acknowledge schedule,
take cover, request time off.

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
