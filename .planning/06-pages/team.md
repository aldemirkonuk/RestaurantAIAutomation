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

- **Invite member / Add staff** (manager) → (modal — InviteTeamDialog; **house shape: `Popover modal`**, anchored under its button, ADR 0112)
- **Publish week / Re-publish** (manager) → API `POST /restaurants/:rid/team/schedules/:scheduleId/publish`
- **Copy last week** (manager) → API `POST /restaurants/:rid/team/schedules/copy-week`
- **Broadcast crew** (manager) → API `POST /restaurants/:rid/team/broadcast`
- **Import sheet** (manager) → (modal — ShiftImportModal; **still legacy, deliberately**: it opens only from the legacy desk `pages/team/command/ManagerShiftDesk.tsx:594`, so a house branch could never render, and its apply path is simulated at `ShiftImportModal.tsx:100-101` — ADR 0112)
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
- **The page can start the staffing engine** — with `coverage_templates` empty (which is production) the panel says the engine is idle rather than claiming a staffed week, and carries the role/day/service/min-staff form that creates the first rule (ADR 0089)
- **Role split on the redesigned half too** — a non-manager gets My Shifts, not the manager desk; previously `App.tsx:305` gated the whole route and `GET certifications` has no server-side role requirement (`team.service.ts:397`), so the credential file rendered to any member
- **Labour cost as the week builds** — total vs target with overtime named before publish; withheld in words when tracking is off
- **Credentials as exposure** — an expired card names the member, how many shifts they hold this week, and that *which* shifts require it is not recorded, with a one-tap renewal request (ADR 0089; `team_certifications` has no role or applies-to column, baseline `:5609-5620`, so the old "blocks N shifts / should not be published" line asserted a link the schema does not have)
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

### Modal shape, 2026-09-03 (ADR 0112)

**`InviteTeamDialog` is the wave's one named exception.** It is anchored under its
button like a popover but it is a *form that commits*, not a picker, so it takes
`Popover modal` — the anchored position operators already know, with the focus
trap, scroll lock and dim its Radix dialog had. Copy and behaviour are the legacy
dialog's word for word; only the surface changes, and only while a rebuilt page is
on screen (the Radix branch still renders byte-for-byte otherwise). A **second**
anchored surface needing `modal` is the recorded signal to collapse the policy to
two shapes.

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
| GET/POST/PATCH/DELETE | `…/members` | ManagerShiftDesk + editors → `team.ts:127-141` |
| GET | `…/week`, `…/my-week` | `team.ts:144,148` (ManagerShiftDesk / MyShifts) |
| POST | `…/schedules`, `…/schedules/copy-week`, `…/schedules/:id/publish`, `…/schedules/:id/acknowledge` | `team.ts:152-203` |
| POST/PATCH/DELETE | `…/shifts` (+ `/callout`, `/offer-cover`, `/assign`) | `team.ts:206-228` |
| GET/POST/PATCH/DELETE | `…/certifications` | OpsRulesPanel → `team.ts:231-245` |
| GET/POST/PATCH | `…/time-off` | MyShifts/desk → `team.ts:248-259` |
| GET/POST/DELETE | `…/coverage-templates` | OpsRulesPanel → `team.ts:262-272` |
| GET | `…/members/:id/performance` | PerformancePanel → `team.ts:275` |
| POST | `…/sales`, `…/sales/batch` | PerformancePanel → `team.ts:279-286` |
| POST | `…/broadcast` | ManagerShiftDesk → `team.ts:289-305` |
| GET/PATCH | `…/settings` | `team.ts:308-315` |
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

- Performance metrics depend on manually ingested sales rows (`team.ts:279-286`)
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
- ~~**Three controls need a client half before they work again** (ADR 0088 T3/T7,
  owned by the `/team` page session, not the gateway): "Copy last week" and
  "Re-publish" now answer 409 until the client sends `replaceTarget` /
  `resetReceipts` with a confirmation, and the legacy desk's broadcast answers
  400 until it sends an `audience`.~~ **Closed 2026-09-02** — the client half is
  written. The two halves merged in the wrong order (#257 page-first, then #256
  gateway) and nothing sent the fields in between, so all three controls failed
  on every click for the window between them. Now `copyWeek` and
  `publishSchedule` take the flag as an option and `broadcast`'s signature
  refuses a body naming neither `memberIds` nor an `audience`
  (`services/api/team.ts:156-199,290-304`); the flag is passed **only** from the
  branch that already showed the user what it destroys
  (`ManagerShiftDesk.tsx:246-283,905,921,931`), so the 409 keeps guarding the
  unconfirmed path rather than becoming a formality. Held by
  `services/api/team.destructive.test.ts` on the request body — a component test
  can only prove the module was called, and the fields were what was missing.

## 10. Maturity

**live.** Every advertised action reaches a real, role-enforced endpoint and produces a
downstream effect — which is not the same as complete, and the frontmatter said
`complete` until 2026-09-02. ADR 0089 measured eight defects on this page in one pass,
seven of them sentences that were false over the tenant the page actually runs in
(`coverage_templates` 0 rows, `team_certifications` 0, `schedule_receipts` 0, no `staff`
role). A page whose every button works can still say untrue things about what it found.
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
| Mutations report failure | Every mutation says so — an `onError` toast on the legacy half, an on-screen `role="alert"` line on the redesigned half, which mounts no toaster (`TeamNext.tsx` `CoverageRuleForm`/`GapRow`/`CertRow`). **True since ADR 0089, false when this row was first written.** Seven had none: call-out (`ManagerShiftDesk.tsx:303-306`), assign cover (`:331-334`), delete shift (`editors.tsx:84-87`), remove member (`:202-205`), delete rule (`OpsRulesPanel.tsx:97-104`), delete cert (`:212-218`), acknowledge (`MyShifts.tsx:38-44`). A failed delete showed the user nothing at all |
| Reads report failure | Since ADR 0089. The four legacy desk queries and `MyShifts`'s `my-week` had no `isError` branch, so a dead gateway rendered *"No team members yet"*, `0 active`, an empty task rail under a green tick, *"Publish readiness: Clear"* on all three `?? 0` rows, and seven days of *"Off"*. Both halves now carry the two-sentence banner |
| A message addressed to one person reaches one person | Since ADR 0089. *"Message {firstName}"* called `doBroadcast` with **no `memberIds`** (`ManagerShiftDesk.tsx:335-345`), so `team.controller.ts:345-347` fell through to every active linked member across four channels. Replaced by a composer that lists recipients before the send control and counts them on it |
| Destructive actions confirm | Since ADR 0089. Copy-week DELETEs the whole target week (`schedule.service.ts:202-207`) and re-publish wipes every `schedule_receipts` row (`:248-251`); both were one click |
| Every read is tenant-keyed | Since ADR 0089, and held by `scripts/check_windowed_figures.py` (W6/W7, `/team` is its fourth page, both halves). Five keys carried no restaurant id — all on the REDESIGNED half plus `PerformancePanel.tsx:22`; the legacy desk had it right |
| Debt register | No `v3.0-TECH-DEBT.md` entry names `/team` (§9, re-verified) |
| Debt register | No `v3.0-TECH-DEBT.md` entry names `/team` (§9, re-verified 2026-09-02) |

The one dependency worth naming is not a defect on this page: performance metrics
come from **manually ingested** sales rows (`POST …/sales`, `…/sales/batch`,
`services/api/team.ts:279-286`) until POS depth exists (S04 ⚠, TIER-MAP:40). The panel
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
| Error | Yes, since ADR 0089 | Both halves carry the two-sentence banner that separates *"could not be refreshed — this is the last answer"* from *"nothing below is claimed"*, and every derived figure can say `—`. Was **Partial**: reads had no `isError` branch at all, so a failed roster fetch read as an empty roster |
| Permission-denied | Yes, structurally | Non-managers get `MyShifts` rather than a denied Manager desk (`TeamCommandPage.tsx:1-4`), backed by server-side `assertAccess` |

**Where the UI misleads:** *"nothing found" was wrong* — it was written against the
surface, not against the tenant. ADR 0089 found eight, and the page is the fix; they are
recorded here because a page note that only ever records the current state teaches
nothing about how it got wrong:

1. *"Every required slot this week is staffed"* over **zero coverage rules** — an idle
   engine reported as a result (`TeamNext.tsx:296-299`).
2. *"Every credential on file is valid through this week"* over an **empty file**
   (`:377-380`).
3. *"N shifts are held by an expired credential — should not be published"* over a table
   with no role and no applies-to column (`:394-397`, `useTeamNextData.ts:186`).
4. *"Message {firstName}"* sending to the entire crew (`ManagerShiftDesk.tsx:710-718`).
5. A dead gateway drawn as a healthy, empty restaurant — four all-clears and a green tick
   (`ManagerShiftDesk.tsx:519-521, 376, 613-617, 640-644`; `MyShifts.tsx:122`).
6. *"Rule removed"* after a delete that no-opped against the previous tenant's id
   (`OpsRulesPanel.tsx:97-104` with an untenanted key at `:70-73`).
7. *"covered"* on a day whose own coverage status was `gap` (`TeamNext.tsx:434-436`).
8. A whole week's urgent count printed under a heading that said *"Tonight's board"*
   (`ManagerShiftDesk.tsx:436`), and `sum(labor_cost ?? 0)` rendering an unpriced night
   as a measured **$0** (`:429`).

What was *already* honest and is preserved: print-week opens a real window; import is a
real upload; the performance panel refuses to draw numbers it does not have and prints
the rule (`PerformancePanel.tsx:200-207`); `TeamNext`'s error banner, its `— ` for an
unanswered count, and its *"a withheld number, not a zero"* labour copy.

The boundary to defend: TIER-MAP:104-105 — Floor Checker scenarios (S05/S07/S16)
"must never be sold as staff performance analytics". `PerformancePanel` is
sales-ingest based, which is the permitted kind. Keep them apart.

## 13. Roadmap

1. **Attribute sales from POS** instead of manual ingest (`services/api/team.ts:279-286`)
   — turns the performance panel from a data-entry chore into a by-product. Blocked
   on POS depth (S04 ⚠, TIER-MAP:40).
2. ~~**`isError` branches on the read queries**~~ — **done**, ADR 0089. Both halves now
   distinguish a stale answer from no answer.
2a. **A credential that knows what it certifies.** `team_certifications` has no role or
   applies-to column, so the strongest true sentence about an expired card is "this
   person works N shifts this week". Add the column and the blocker claim becomes
   available again (ADR 0089, "revisit when").
2b. **Record that a renewal was requested.** The redesign's *Request renewal* has no
   server-side trace, so it can only report what it just did, never a state. Gateway
   work, marked `TODO` in `TeamNext.tsx`.
2c. **A role requirement on `GET certifications`.** `team.service.ts:397` calls
   `assertAccess` with no required role, so the client-side split ADR 0089 added is
   defence in depth, not access control. Gateway work.
3. Instrument this page first when signals land (§5): publish→acknowledge latency and
   cover-claim time are the two numbers a manager would actually act on, and both are
   already in the schema (`schedule_receipts`).
4. Link a broadcast notification back to the specific schedule rather than `/team`
   (`team.controller.ts:355`) — publish already does this (`schedule.service.ts:259`).

---

**Added 2026-09-03 — the founder's fourth-pass note on `/settings`**, verbatim:
*"The more Vendor terms, thresholds, audit trail -> this looks super detailed and
I like it a lot, the more insights functionality the better, we could actually
put these type of detailed 'more's into other pages like /teams design and
configuration."*

Nothing below is built. This is the proposal and its cost, written by the
`/settings` session so `/team`'s own session inherits the measurement rather than
re-deriving it.

5. **A team-configuration register set, in the `/settings` idiom.**

   **What transferred, and why it is the shape.** Three ideas carried the
   `/settings` rebuild, and all three are about the same thing — a configuration
   page earns trust by being checkable:

   1. **Every setting is a RECORD.** It states the consequence of changing it,
      *where the value is kept*, and *when it was last written* — or an em dash
      naming the file that was checked. Enforced by the component, not by
      discipline: `Row` in `settings/next/SectionKit.tsx` cannot be used without a
      provenance line.
   2. **Every value carries its SOURCE.** *Stated by the house* (with the name of
      whoever wrote it down) · *on the record* (with the column named) ·
      *inferred from N receipts* (with a confidence) · *unknown* (with the
      reason). And the rule that made it worth building: **a value
      indistinguishable from its column default is UNKNOWN, not a term.**
   3. **The record ends at a name.** `system_audit_log` already existed and
      already had two team writers; the settings register is one caller and one
      read route, with no new table.

   **What `/team`'s configuration actually is today, measured.**

   | store | what it holds | provenance available today |
   |---|---|---|
   | `team_settings` (`baseline:5653-5658`) | `labor_tracking_enabled`, `wage_visible`, `labor_target_pct`, `updated_at` | a date, no author. **0 rows in production** (§9) |
   | `coverage_templates` | the staffing rules the engine runs on | **0 rows in production** — the engine is idle, and the redesign already says so |
   | `team_certifications` (`baseline:5609-5620`) | credentials per member | no role and no applies-to column (§13.2a) |
   | `user_restaurant_access` | who may do what | `created_at`, `valid_from`, no update column — a role change moves nothing on the row |
   | `team_members.hourly_wage` | pay | 11 rows still carry ADR 0088's invented `$32.00`/`$28.00` literals |

   **The defaulted-column fault is already here, and it is the same one.**
   `team_settings.labor_target_pct` is `numeric(5,2) DEFAULT 28 NOT NULL`
   (`baseline:5656`) — exactly the shape of `providers.lead_time_days DEFAULT 7`
   and `providers.payment_terms DEFAULT 'Net 30'` that the vendor-terms register
   exists to catch (`06-pages/settings.md` §9.12). The first house to toggle
   `wage_visible` acquires a 28% labour target it never chose, and nothing on the
   page can tell that apart from a target somebody set. ADR 0088 fixed the
   *code-side* default (no row → `null` + `configured: false`); the column is
   still `NOT NULL DEFAULT 28`. A `/team` configuration register must read it the
   way `leadTimeCell` reads seven days: **unknown, with the default named**, and
   it should say so on a page where a manager is about to be measured against it.

   **The registers proposed, and what each would infer.**

   - **Labour policy** — the three `team_settings` switches plus the target.
     *Insight:* the same retrospective the approval-threshold register carries.
     A target of 28% means nothing until the page can say *"your last twelve
     weeks ran at 31.4%, and 28% would have been missed in nine of them"* —
     computable from `server_sales` and `shifts` once real wages exist, and
     honestly refusable until they do (`hourly_wage` is currently three invented
     literals, §9). Provenance: `updated_at` is real; `updated_by` does not exist.
   - **Coverage rules** — `coverage_templates` (role · day · service · min-staff).
     *This is the vendor-terms shape almost exactly.* A stated rule is what the
     house says it wants; an INFERRED one is what the house has actually done —
     the median number of people on the line on a Saturday dinner across the last
     N published weeks, with the week count and a confidence. Today the engine is
     idle because the table is empty; a register that showed the inference beside
     an empty rule would give the first rule a number to start from instead of a
     blank form. Same hard rule as vendor terms: **the inference is computed at
     read time and never written back**, so a habit cannot harden into a policy
     by sitting in a table.
   - **Credentials** — `team_certifications`. *This is the `payment_terms` case:*
     **not inferable, and the register must say so with the missing column
     named.** Without a role or applies-to column there is no honest sentence
     about which shifts an expired card blocks (§13.2a), and the redesign already
     refuses to write one. A register makes the gap visible where somebody can
     decide to close it.
   - **Who may do what** — one row per capability, measured from the guards
     rather than described in prose. This is the Features-register
     "blast radius" idea (`06-pages/settings.md` §13.20) pointed at people, and
     `/team` has a live example to open with: `team.service.ts:397` calls
     `assertAccess` with **no required role**, so the client-side split ADR 0089
     added is defence in depth and not access control (§13.2c). A register that
     printed "certifications · read · **any member** · not enforced server-side"
     would have made that visible without an audit.
   - **What changed here** — and this one is nearly free. `recordAccessChange`
     (`apps/api-gateway/src/team/access-audit.ts:73`) ALREADY files
     `member_role_changed` and `team_member_removed` into `system_audit_log`, and
     `SettingsAuditService.list` (added 2026-09-03) already reads both back — it
     understands the flat `{field: {from,to}}` shape that writer uses as well as
     its own nested one. So `/team` gets a trail by rendering
     `GET /settings-audit` and nothing else; only `team_settings` and the
     coverage rules would need new `record()` calls.

   **What it would take, concretely.**

   | piece | cost | notes |
   |---|---|---|
   | The audit trail on `/team` | ~half a day, **0 migrations** | `GET /settings-audit` exists and already returns the two team actions. `SettingsAuditService` is exported from `SettingsAuditModule`; `TeamModule` imports it and `TeamService.updateSettings` files a diff |
   | Provenance lines on the existing panels | ~1 day, 0 migrations | port `Row`/`Provenance`/`Dead` out of `settings/next/SectionKit.tsx` into a shared place. **Do this once**, not twice — a second copy is how two pages start disagreeing about what "kept" means |
   | Reading `labor_target_pct` honestly | ~2 hours, 0 migrations | treat `28` with no row as unknown, exactly as `leadTimeCell` treats `7` |
   | Making the column nullable | 1 migration, low risk | the table has **0 rows** in production, so this is the cheapest it will ever be (§9) |
   | The coverage-rule inference | ~2 days | needs `shifts` and `schedules` to have data; both are empty in production, so it is untestable against reality today and would ship as code with a green test and no evidence — the same warning §9 already carries for this whole domain |
   | The labour retrospective | blocked | needs real `hourly_wage` values. ADR 0088 deliberately stopped inventing them; the 11 existing rows still carry the literals |

   **The honest counter-argument, and it is strong.** Every scheduling table on
   this page is EMPTY in production (§9: `coverage_templates` 0, `schedules` 0,
   `shifts` 0, `team_certifications` 0, `server_sales` 0, `team_settings` 0). The
   `/settings` registers were worth building because their data exists — feature
   flags, providers and orders are all live — and an inference over an empty
   table is a component with a green test and no evidence, which is precisely the
   thing this project keeps having to unwind. **So the split is: build the three
   that cost nothing and need no data — the audit trail, the provenance lines,
   and reading `labor_target_pct` as unknown — and hold the two inferences until
   a real house has published a real week.** The first three are all honesty
   work, they are what the founder actually praised, and none of them can be
   wrong about a house that has no data.
