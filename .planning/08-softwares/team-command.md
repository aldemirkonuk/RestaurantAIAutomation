---
type: software
slug: team-command
name: Team Command
division: platform-admin
status: live
tier: core
routes: ["/team"]
pages: [team]
api_modules: [team, organizations]
agents: []
owner_unit: platform-api
updated: 2026-09-01
links: ["[[team]]", "[[platform-api-charter]]", "[[settings-integrations]]", "[[SOFTWARE-MAP]]"]
---

# Team Command

## §0 What it is

The staff side of the restaurant: who works when, who is qualified to do what, and who
has been told. A manager builds next week's grid, publishes it, and the people on it see
their own shifts and acknowledge them; time off, cover swaps and certification expiry all
run through the same surface. It is the one place in the product where a manager's action
reaches a specific person's phone.

## §1 Features today

- See my week, read-only, as a staff member
- Acknowledge the schedule my manager published
- Request time off; take an open shift someone offered for cover
- Build a week grid — create, copy last week, publish
- Call out of a shift, offer cover, or be assigned to one
- Track certifications and their expiry
- Manage time-off requests and coverage-rule templates
- Ingest sales rows and read a per-member performance panel — **manual ingest today**;
  the POS depth that would fill it does not exist yet (`team.md` §10)
- Broadcast one message to the team across four channels — in-app, web push, email, SMS
- Invite a team member; switch between branches

The redesigned layer behind flag `mudavym_design_team` (OFF) adds coverage gaps as the
page's first object, labour cost against target as the week builds, and expired
credentials as publish blockers — with a deliberate parity gap: the full desk still lives
on the legacy page while the flag is off (`team.md` §1a).

## §2 Screens

- [[team]] — the whole software, one route. `apps/web/src/App.tsx:305`:
  `<PageGate page="team" legacy={<TeamCommandPage />} next={<TeamNext />} />`. The gate is
  a straight either/or (`apps/web/src/components/mudavym/PageGate.tsx:41-44`), so a
  screenshot is only evidence once you know which side of the flag it came from.

Component tree: `apps/web/src/pages/team/command/` — `TeamCommandPage.tsx`,
`ManagerShiftDesk.tsx`, `MyShifts.tsx`, `OpsRulesPanel.tsx`, `PerformancePanel.tsx`,
`editors.tsx`, `bits.tsx`; the redesign in `apps/web/src/pages/team/next/`.

## §3 Backend

`apps/api-gateway/src/team/` — **33 endpoints**, all under one class-level guard.
`@Controller("restaurants/:restaurantId/team")` at `team/team.controller.ts:51`,
`@UseGuards(JwtAuthGuard)` at `:52`. Grouped: members (4), schedules (6), shifts (6),
certifications (4), time off (3), swaps (1), coverage templates (3), performance (1),
sales (2), broadcast (1), settings (2). Service layer splits three ways —
`team.service.ts`, `schedule.service.ts`, `performance.service.ts`.

`apps/api-gateway/src/organizations/` — **8 endpoints**, `@Controller("organizations")` at
`organizations/organizations.controller.ts:32`, guard at `:33`. **This module is a shared
seam, not this software's own**: branches and chains are read here for the branch switcher
and written from [[settings-integrations]]'s Locations tab.

Role enforcement is server-side rather than a client convenience —
`assertAccess(userId, rid, "manager")` guards publish (`team/schedule.service.ts:232`) and
broadcast (`team/team.controller.ts:346`).

## §4 Automation

`none (every action is human-initiated)` — no `@Cron` in `team/` or `organizations/`, and
no agent subscribes to team events. Publishing a week fans out immediately and
synchronously (`team.controller.ts:335-380`); nothing sweeps for uncovered shifts or
expiring certifications on a schedule, which is the shape the redesign's "coverage gaps
first" framing is trying to work around in the UI instead.

## §5 Data

Read from `.from(...)` in `apps/api-gateway/src/team/`: `team_members`, `schedules`,
`schedule_receipts`, `shifts`, `swap_requests`, `time_off_requests`,
`team_certifications`, `coverage_templates`, `team_settings`, `server_sales` — plus
`users` and `user_restaurant_access` for identity, which it does not own.

`organizations/` touches `organizations`, `organization_members`, `restaurant_chains`,
`restaurants`, `user_restaurant_access`, `users` — shared with [[auth-onboarding]] and
[[settings-integrations]], owned by none of the three.

## §6 Owner

[[platform-api-charter]] — team `platform-api`, department `engineering`, division
Platform (`01-org/platform/engineering/teams/platform-api/`). The charter claims these
modules by name and by count: *"Identity and org surfaces — `apps/api-gateway/src/auth/`
(28 endpoints), `team/` (33), `organizations/` (8)…"* (`platform-api-charter.md:32-35`).

**Read that ownership narrowly.** The same charter's non-goals table assigns *"Domain
logic behind any endpoint"* to *"The owning domain team"* (`:56`). No `01-org` charter
claims **human staff scheduling as a domain** — `roster-lifecycle` is the *agent* roster
(Corporate → people-agent-ops, `roster-lifecycle-charter.md:22-26`), and `service-floor`
is a new, code-less team about waiters checking tables
(`service-floor-charter.md:20-25`). So the request path has an owner and the product does
not. Gap row for [[SOFTWARE-MAP]].

## §7 Maturity & seams

**live.** The page note's verdict is `complete` and it is the strongest in this division:
every advertised action reaches a real, role-enforced endpoint and produces a downstream
effect — publishing clears `schedule_receipts` so "seen" tracks the new version and writes
a deep-linked notification (`schedule.service.ts:231-265`); the performance panel refuses
to invent numbers (`PerformancePanel.tsx:3`); every mutation has an `onError` toast
(`team.md` §10).

Seams:
1. **`organizations` belongs to nobody.** Eight endpoints serving a branch switcher here
   and a Locations tab in [[settings-integrations]]. Neither software can be extracted
   without deciding who keeps it.
2. **Performance is fed by hand.** `POST …/sales` and `…/sales/batch` are manual ingest
   until POS depth exists. The panel says so rather than filling the gap — a dependency,
   not a defect.
3. **Two live layouts.** The redesign ships behind `mudavym_design_team` with a declared
   parity gap; the operable desk is the legacy one. Any claim about this page has to name
   the flag state.
4. **No scheduled sweep.** See §4.

## §8 Where it's going

- ADR 0049 §3a puts `team` and `organizations` under **Platform/Admin**, phase **E0**
  (auth census + map true-up) — `.planning/04-specs/ECOSYSTEM-PLAN.md:59`.
- OD-106 (design foundation) governs whether the Mudavym layer becomes the default; the
  parity gap is the gate.
- The unowned-domain finding in §6 is the durable one: a scheduling product with a
  platform owner and no product owner will keep getting request-path fixes and no roadmap.
