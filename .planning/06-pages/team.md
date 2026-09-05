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
updated: 2026-09-04
links: ["[[PAGE-CONTRACT]]"]
---

# /team — Team Command

> **Part of** [[08-softwares/team-command|Team Command]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Invite member / Add staff** (manager) → (modal — InviteTeamDialog; **house shape: `Popover modal`**, anchored under its button, ADR 0112)
- **Publish week / Re-publish** (manager) → API `POST /restaurants/:rid/team/schedules/:scheduleId/publish`
- **Copy last week** (manager) → API `POST /restaurants/:rid/team/schedules/copy-week`
- **Broadcast crew** (manager) → API `POST /restaurants/:rid/team/broadcast`
- **Import sheet** (manager) → **nothing. The control is DISABLED on both halves** (2026-09-04): `ShiftImportModal`'s apply path was a 1200ms `setTimeout` + `toast.success("Successfully imported N shifts")`, with N computed as `Math.floor(file.size / 80)` — no request, no shift written, a row count derived from a file's byte size. There is no import route in the gateway to call. The picker stays (seeing what a house would hand over was the half that was real) and the modal says the import is not built; held by `components/team/ShiftImportModal.test.tsx` (§13.6)
- **People · N** (manager, Mudavym) → `Sheet` — the roster, one row per member, expanding in place
- **Write a note** (manager, Mudavym) → `Sheet` — the crew note, always targeted, inbox + push only (§1a)
- **Time off** (manager, Mudavym) → `Sheet` — the request file, approve/deny/file
- **What changed here** (manager, Mudavym) → `Sheet` — the trail, read from `GET /settings-audit`
- **Export** (manager, Mudavym) → `Popover` — CSV/Excel/JSON/Markdown/PDF/clipboard/print
- **Right-click a shift chip** (manager, Mudavym) → `Popover` — edit · duplicate · call-out · offer cover · delete
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
- Week-at-a-glance day chips (staffed / open / status) — now the week grid's own column headers

**Parity closed, 2026-09-04.** The desk's operating half was legacy-only, so
flipping the flag handed a manager a page that could not schedule. Every
function below now lives on the Mudavym layer, and each one names the house
overlay shape it uses (ADR 0112: a record arrives from the right, a decision
arrives in the middle, a menu hangs off its own control):

| function | shape | file |
|---|---|---|
| The roster, one row per member, expanding **in place** (the /inventory anatomy: fact strip → cards → action bar) | `Sheet` + row expander | `RosterSheet.tsx` |
| Add / edit a member; remove, guarded, with the sole-owner refusal **in words** rather than a hidden control | `Sheet` | `RosterSheet.tsx` (`MemberSheet`) |
| The week grid: day columns, member rows, shift chips, an open-shift control in every empty cell, open shifts gathered below | — | `WeekGrid.tsx` |
| Four lenses — coverage · labour · fairness · compliance. **The lens changes the chip's words, never its colour**: this house has one chromatic colour and it marks the selected chip | — | `WeekGrid.tsx` |
| Add / edit / delete a shift (member · date · start · end · station · kind · note) | `Sheet` | `ShiftSheet.tsx` |
| Right-click a chip: edit · duplicate · report a call-out · offer cover · delete | `Popover` | `WeekGrid.tsx` |
| The inspector — who, when, station, kind, state, cost, the three real cover candidates, and that member's performance — **as a row expander under the selected shift**, not a rail | row expander | `WeekGrid.tsx` |
| Publish the week (destroys nothing → a plain confirm) | `Panel` | `TeamOverlays.tsx` |
| Re-publish (**deletes every read receipt**) and copy last week (**deletes the whole target week**) — both sealed with `HoldToApprove` and both saying what they destroy, with the receipt count | `Panel` + seal | `TeamOverlays.tsx` |
| Time off: the file, approve, deny, and file a request for someone | `Sheet` | `TeamOverlays.tsx` |
| Export the week (CSV · Excel · JSON · Markdown · PDF · clipboard) and print the floor sheet | `Popover` | `TeamOverlays.tsx` |
| Per-member performance, read-only, in house tokens, with the benchmark's ceiling stated | card | `PerformanceCard.tsx` |
| My Shifts (staff): my week, acknowledge, take a cover, ask for the week off | — | `MyShiftsNext.tsx` |
| **How this desk is configured** — five stated values, each a record with where it is kept, when it was written and why there is no author | section | `TeamRecord.tsx` |
| **What changed here** — the trail, read through `GET /settings-audit` | `Sheet` | `TeamRecord.tsx` |

**Inline comms — the crew note (founder, 2026-09-04).** A crew message on
`/team` is a note ON THE SCHEDULE, not correspondence and not a template:

- A **strip above the week** carries it. Left: the note this page last sent, who
  it went to and through which channels. Right: **who has opened the published
  week, by name**, read from `schedule_receipts` (baseline `:5293-5298`, written
  by `POST …/schedules/:id/acknowledge`) — the one durable read-receipt store on
  this page. The two are never blended: `schedule_receipts` records opening the
  SCHEDULE, not reading a note.
- The composer is a small `Sheet` and is **always targeted** — named members, or
  the published week's active linked crew — never an unnamed fan-out (ADR 0089).
- **A crew message never sends email OR SMS — for EVERY caller, the legacy desk
  included** (founder, 2026-09-04). Neither was broken: both worked, and that
  was the problem. Email left through `GmailService`, the single configured
  `GMAIL_SENDER_EMAIL` (`communications/gmail.service.ts:78-80`) that
  procurement writes to vendors from — a staff member replying to "Saturday
  moved to seven" landed in the vendor thread — and the SMS sender is a shared
  account too, so a text arrived from an unknown shared number. Both return when
  a house has senders of its own, "as long as the third-party connections are
  well built" (founder; §13.7c).
- **The channel set is `['inbox', 'push']`, and that is the most it can be.** An
  omitted `channels` used to mean "every channel this person has an address for"
  — the same absence-read-as-intent shape ADR 0088 T3 removed from the audience.
- **The removal is checked where Nest decides it.** `TeamController` takes
  neither a `GmailService` nor an `SmsService`, and
  `team.controller.broadcast.spec.ts` asserts the controller's own
  `design:paramtypes` — the metadata Nest injects from — names exactly its six
  real dependencies. A spec harness alone would not have held this:
  `CommunicationsModule` still exports `GmailService`
  (`communications.module.ts:95-103`), so re-adding the parameter would have
  resolved silently.
- **Naming a removed channel is REPORTED, never silently dropped.** A caller
  that asks for `email` or `sms` is not rejected; it is told how many people it
  would have reached and why it did not.
- **What was withheld is counted, in three separate fields, per channel.**
  `suppressed` (the recipients opted out) · `withheldByCaller` (this send did
  not ask for the channel) · `withheldByProduct` (the house has no sender of its
  own, with the reason and the count). Folding them would let "the house has no
  mailbox" read as "nobody wanted an email".
- **The opt-out moved onto push.** It used to govern the two legs that are now
  gone, and push is the only outbound channel left — a channel nobody can
  decline is one they will eventually resent.
  `notification_preferences.push_enabled` exists and says exactly that (baseline
  `:3929`). A preference register that cannot be READ skips the push and says so
  (`preferencesUnavailable`), rather than pushing to people who may have said no.
- **A note is a RECORD, since 2026-09-04** (migration `20260904180000`,
  `team_notes` + `team_note_recipients`, `team/notes.service.ts`). It has an
  author, the audience it named at send time, and a per-person `opened_at`, so
  it survives a reload and the strip can say who has read it. The staff view
  shows the note and carries the *Mark as read* that records the receipt. The
  two receipts stay apart: `schedule_receipts` records opening the SCHEDULE,
  `team_note_recipients.opened_at` records reading one note — blending them
  would make "saw the roster" and "read the message" the same fact. A read that
  fails renders as words (`readable: false`), never as a quiet week.
- **A staff member sees only notes addressed to them.** The register carries a
  manager's free text about a week; every member reading every note is the shape
  ADR 0088 closed on time-off reasons.

**Roster names, and why they were all the same.** Every roster row in the demo
tenant read "Team member" (3 of 3, measured 2026-09-04) because the gateway's
identity read asked `public.users` for an `avatar_url` it has never had; the
42703 arrived as `data: null` through a destructure that dropped `error`, so
`linkedUser` was null for everyone AND the backfill wrote the literal into
`display_name`, a NOT NULL column. Those rows are durable. The page now resolves
a name it can stand behind — a stored name, then the linked account, then "No
name on file" with the reason — and never prints the placeholder. The gateway
half is §9; the Edit sheet prefills the account's name so one save repairs a row
for good.

**The crew text (ADR 0121, founder 2026-09-05: *"a crew text exists and build it
next"*).** The note composer now carries a **text leg** with three states and no
switch, because a switch would imply the sender is this composer's choice and it
is not: a note reaches somebody by text when *this house* has a connected sender
**and** *that person* has consented, and neither is the writing manager's to
decide. (1) **No sender** — the control is off and names why, including why a
number shared with other restaurants is not offered as an easy alternative. (2)
**A sender and nobody consented** — still off, and it says whose decision that
is; nobody can consent on another person's behalf. (3) **A sender and consents**
— live, naming how many of the addressed will be texted and stating that the
rest are reached on the inbox and the phone only. A failed read is a fourth
thing and gets its own sentence: "unknown — not no".

**Every note now leaves a receipt per person per channel** (`team_note_deliveries`,
migration `20260905210000`). This is the P0 half of ADR 0121 and it closes a
measured lie: `POST …/broadcast` returned `notified: 11` counted off the roster
while `mobile_devices` held **0 rows**, because `ExpoPushService.sendToUsers`
returned silently on an empty read *and* on a failed one. `notified` is now the
number of registered **devices** the payload was handed to, `addressedForPush`
carries the old number under a name that says what it is, and the four outcomes
are kept apart: `accepted_by_service` is not `delivered` (a push service taking
a ticket is not a handset showing a notification), and `read_failed` is a fact
about this system rather than about the crew.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_team`)

Canonical source with curves: `apps/web/src/pages/team/next/MOTIONS.md` — this
list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `tm-ink` | Ink micro-state | control hover/focus, chip border and background, member-row and roster-row hover — colour only, nothing translates |
| `mdv-sheet-tuck` | Tuck | a `Sheet` opens: the roster, a member, a shift, the crew note, time off, the trail |
| `mdv-panel-settle` | Settle | a `Panel` opens: publish, re-publish, copy last week |
| `mdv-popover-ink` | Ink | a `Popover` opens: the shift menu, export |
| `pour` → `stamp` | Hold, then the seal | `HoldToApprove` on the two acts that DELETE before they write — re-publish and copy-week |

Deliberate non-motions: gap rows never animate in (an unfilled shift is a
standing fact, not an arrival); the labour figure never tallies; "assigned" /
"requested" confirmations are a change of words, in place; **the row expander
does not slide** (a table whose rows change height under the cursor is a table
you lose your place in); and a **first** publish destroys nothing, so it gets a
plain confirm — the die pressed dry, not the wax.

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

### The parity pass, 2026-09-04

**What the founder asked.** Finish the desk's operating half on the same design
— a parity build, not a new design — with the in-place row expander as the house
shape for a ledger table, roster included; then three additions: the three cheap
honesty pieces §13.5 proposed, an import control that does not lie, and a crew
message that is inline comms on the week rather than a composer.

**What was built.** Everything in the §1a table. The structural idea is one
sentence: *the page holds the week, and every act on it opens the house overlay
whose shape says what kind of act it is.* Nothing on the page is a rail of
controls whose consequences you learn by pressing them.

**What was fixed in the gateway** (additive, each with a spec):

- `team.service.ts:158-198` — the roster's identity read asked `public.users`
  for `avatar_url`, a column that table has never had (baseline
  `20260805000000_baseline_from_production.sql:5848-5861`). PostgREST answered
  42703, the destructure dropped `error`, and every member came back
  `linkedUser: null`. `restaurants/members.service.ts:101-117` had the identical
  bug and fixed it; this module had not. Both errors are now bound and a failed
  identity read throws rather than returning anonymous rows.
- `team.service.ts:238-260` — the same 42703 in `ensureRosterFromAccess`, where
  it did not merely blank a field: the name expression fell through and WROTE
  "Team member" into `display_name`. A failed identity read now aborts the
  backfill; `avatar_url` is taken from `team_members`, where avatars live.
- `team/testing/supabase-stub.ts` — the stub now models PostgREST's 42703 for a
  SELECT naming a column a table does not have, against a DECLARED schema
  (opt-in per table, cited to its migration) rather than against the shape of a
  fixture. Without it no spec could have failed on the defect above. Proven
  against the pre-fix tree: **5 of the 6** new assertions go red. (A first
  proof run measured 4; it was taken before the backfill was also made to
  THROW on an unreadable identity read, which is what puts the sixth assertion
  — "creates no roster row it cannot name" — on the failing side too. The
  earlier figure was true of an earlier tree and is wrong about this one.)
- `team/dto/team.dto.ts` + `team.controller.ts` — `BroadcastDto.channels`, an
  optional allow-list. Omitting it is today's behaviour byte for byte (the
  legacy desk names none); `/team`'s crew note names `['inbox', 'push']` so its
  email leg never reaches the house mailbox. What the CALLER declined is
  reported separately from what the RECIPIENTS declined — folding them together
  would let "the manager chose not to email" read as "nobody wanted an email".

**What stays open, and why** — §9.

**The two directions not built.** (1) *A messages register*: a `team_notes`
table so the crew note becomes a record with its own read receipts, rather than
a line that goes when the page reloads. It is the right shape and it needs a
migration, which this branch does not own — §13.7. (2) *The performance panel
whole*: the legacy panel carries a "log a service" form and a CSV import, and
both were left on the legacy desk. Putting a data-entry form inside a schedule
expander would make the manager's fastest path to a performance number "type one
in", which is how a page starts measuring itself — §13.8.

## 2. Entry

- Sidebar "Team" (`components/layout/Sidebar.tsx:114`); command palette `g t`
  (`components/command/commands.ts:64,80`).
- [PAGE_MAP](../foundation/PAGE_MAP.md):128 lists it as no-inbound — the scan missed
  layout components; sidebar and palette are the real entries.

## 3. Files

- Route binding: `apps/web/src/App.tsx:276` (eagerly imported :74).
- Tree (legacy): `pages/team/command/{TeamCommandPage.tsx, ManagerShiftDesk.tsx, MyShifts.tsx, PerformancePanel.tsx, OpsRulesPanel.tsx, editors.tsx, bits.tsx}`.
- Tree (Mudavym): `pages/team/next/{TeamNext.tsx, WeekGrid.tsx, RosterSheet.tsx, ShiftSheet.tsx, TeamOverlays.tsx, TeamRecord.tsx, PerformanceCard.tsx, MyShiftsNext.tsx, tm-bits.tsx, tm-format.ts, useTeamNextData.ts, team-next.css, MOTIONS.md}` + `TeamNext.test.tsx`, `TeamNext.honesty.test.tsx`, `TeamParity.test.tsx`.
- **Retire-to-write.** With the flag on, these legacy components are redundant and nothing renders them: `ManagerShiftDesk.tsx` (whole), `MyShifts.tsx`, `editors.tsx` (`ShiftEditor`, `MemberEditor`), `PerformancePanel.tsx`'s read half, and `bits.tsx`'s `Avatar`/`Pill`/`PulseCell`. **They are not deleted**: the flag is off in production, and `check_windowed_figures.py` still holds all five legacy files as declared renderers. They retire when the flag is removed, not before.
- The eight `pages/team/next/**` renderers are declared in `scripts/check_windowed_figures.py`'s `/team` PageSpec — W6 can only see the files that tuple names, so a query in an unlisted renderer would be a bucket nobody checks while the run still printed "clean".
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
| GET | `/calendar/events` | desk overlays events — `ManagerShiftDesk.tsx:17` → `services/api/calendar.ts:221` (legacy half only; the Mudavym grid does not overlay calendar events — §13.9) |
| GET | `/settings-audit?limit=100` | the trail, read through the ONE reader `/settings` uses (`apps/api-gateway/src/settings-audit/`) — `useTeamNextData.ts` → `TeamRecord.tsx`. No new table and no second reader: `settings-audit.service.ts:80-84` already reads back the two actions `team/access-audit.ts:73` files |

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
- **Flag: `mudavym_design_team`** (registry-gated), with the per-browser
  override `localStorage['mudavym.design.team'] = '1'`
  (`lib/mudavym/useMudavymDesign.ts`). With it off the shipping desk renders
  byte-for-byte; the Mudavym half is behind `PageGate` (`App.tsx:353`).
- The role split holds on BOTH halves: owner/manager get the desk,
  everyone else gets My Shifts (`TeamNext.tsx`, `TeamCommandPage.tsx:36-37`).

## 9. Gaps

- Performance metrics depend on manually ingested sales rows (`team.ts:279-286`)
  until POS depth exists — the S04 ⚠ wine-only depletion caveat applies
  ([TIER-MAP](../03-scenarios/TIER-MAP.md):40).
- No debt-register entries name `/team` (checked `v3.0-TECH-DEBT.md` — no hits).
- **G-TXT1 — the crew text cannot actually send, and the page says so.** The
  three-state control's live state is reachable only when a house has a
  `connected` sender, and no house on this deployment has one; even then
  `TextSenderService.send()` returns `transport_not_built`, because a connected
  row is a record of a registration and not a wired provider client. Filed, not
  hidden: the composer prints the server's own sentence rather than implying a
  send (ADR 0121, "What shipped").
- **G-TXT3 — the note textarea ignores the ground, on BOTH grounds** (found
  2026-09-05 while capturing the crew-text control; **pre-existing**, not caused
  by that change). `.tm-textarea` declares `background: var(--paper-0)`
  (`team-next.css:519-527`) and something with higher specificity beats it.
  Measured inside the open composer by `getComputedStyle`, via
  `$SP/shoot-crew-text.mjs`: on paper `--paper-0` resolves to `#FAF7F1` while
  the element's `background` is `rgb(255, 255, 255)`; on charcoal `--paper-0`
  resolves to `#15130F` and the background is still `rgb(255, 255, 255)`, with
  `color: rgb(31, 41, 55)`. So on the charcoal ground a manager types into a
  white box inside a dark sheet. Filed rather than fixed: the fix is in
  `team-next.css`, which this pass had no brief to touch.
- **G-TXT2 — a receipt is per channel and not per device.** `team_note_deliveries`
  records `accepted_by_service` once per person, not once per handset, so a
  person with two phones has one row. That is the right grain for "was this
  person reached" and the wrong one for "which device failed"; the second
  question is not asked yet and the table is not shaped for it.
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

### Filed by the parity pass, 2026-09-04

- ~~**The three roster rows still read "Team member" in the database.**~~
  Superseded by the repair below: the read was fixed on 2026-09-04 and the rows
  were renamed the same day. The page's own name resolution stays regardless —
  it is what makes a future occurrence visible instead of silent.
- ~~**Nothing records a sent crew note.**~~ **Closed 2026-09-04** — migration
  `20260904180000` adds `team_notes` and `team_note_recipients`, and
  `team/notes.service.ts` writes, reads and receipts them. What is still open on
  it: a note cannot be edited or withdrawn (there is no update route and no
  delete route, deliberately — a note a manager can rewrite after it was read is
  not a record), and the strip shows the newest note in full and counts the rest.
- ~~**The roster rows are still named "Team member".**~~ **Repaired in
  production 2026-09-04.** `scripts/repair_team_member_names.py --apply`
  renamed **eleven rows across eight houses** from their linked accounts, and
  the re-check came back clean: no `team_members` row carries the placeholder
  any more. Each repaired row also carries `repaired from the linked account
  2026-09-04` in `notes`, so the change is legible on the row and not only in
  this note. The demo tenant's three rows were part of that eleven.

  The measurement that made it eleven rather than three is worth keeping: the
  defect was never demo-only. Every house whose roster was backfilled while the
  identity read was broken got the same literal, and nobody could have seen it
  from one tenant. The script stays in the tree — a house restored from an old
  backup, or an access row created before the gateway fix reached it, would
  reproduce exactly one more of these — and the page renders "no name on file"
  rather than the placeholder either way, so a future occurrence is visible
  instead of silent.
- **Nothing records that a renewal was requested**, so *Request renewal* reports
  a moment and never a state (unchanged; §13.2b).
- **Nothing records that cover was offered**, for the same reason — the
  expander says so after an offer rather than latching.
- **Nothing files an audit row for a labour setting or a coverage rule.**
  `recordAccessChange` covers role changes and removals only, so the
  configuration register shows a date and never an author, and says which
  column it checked. §13.10.
- **SMS is still reachable, and nothing on screen offers it.** The channel gate
  keeps `sms` as a named channel that no caller asks for. Left in rather than
  deleted: the reason email went is the shared MAILBOX, which does not apply to
  the SMS sender, and removing a working channel nobody asked to remove would be
  a decision taken by a refactor. Named here so it is a choice, not an oversight.
- **`GET certifications` still requires no role** (`team.service.ts:397`), so
  the client-side split is defence in depth, not access control (§13.2c,
  unchanged).
- **The Mudavym grid does not overlay calendar events.** The legacy desk reads
  `/calendar/events` and prints the day's first event in the column header;
  the rebuilt header carries coverage instead. Deliberate — two different facts
  competing for one line — and filed as §13.9 rather than dropped silently.
- **`WeekPayload` on the web side does not name three fields the gateway
  sends**: `labor.costComplete`, `labor.pricedShifts`, `labor.unpricedShifts`
  (`schedule.service.ts:879-881`) and `settings.configured` /
  `settings.updated_at`. They are read through one narrowing in
  `useTeamNextData.ts`, every one of them nullable, so an older gateway that
  omits them reads as "unknown" rather than "complete". §13.11 asks for the
  shared type to be widened.
- **The import is not built.** See the Surface note and §13.6.
- **The local gateway was down when the browser captures were attempted**
  (2026-09-04, `ReferenceError: Cannot access 'AuthModule' before
  initialization` — a circular import from a concurrent branch's
  `organizations.module.ts`, not from this work). Recorded because a capture
  taken against a dead gateway is a capture of the error banner, not of the
  page.

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
| ~~Broadcast reaches four channels~~ **Broadcast reaches two** | **Corrected 2026-09-04.** It reached four — in-app notification, web push, email and SMS — and the founder removed the two outbound legs that day for every caller: the only senders available are the house's shared mailbox and shared SMS account, the ones vendors are written from. It is now the in-app inbox and web push, it must still name its audience (ADR 0088), and the `notification_preferences` opt-out it honoured on email and SMS now governs **push** (`push_enabled`, baseline `:3929`) — the channel it has left. Held by `team.controller.broadcast.spec.ts`, including an assertion on the controller's DI metadata |
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
| Broadcast | Notification + push. **Corrected 2026-09-04**: the email and SMS legs were removed for every caller (see §10) and the push honours `notification_preferences.push_enabled` |
| Crew note (`POST …/team/notes`) | A `team_notes` row + one `team_note_recipients` row per addressee, then the same notification + push. The note is readable afterwards and carries a per-person `opened_at` |
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

0. **The crew text's transport** — ADR 0121. The states, the consents and the
   receipts exist; the send does not. What is missing is a per-house provider
   credential and, before it, the sealed act that submits a registration. The
   registration playbook per market is ADR 0121's own section; the sender rows
   live on `/connections`, the consent on `/profile`.

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

5a. ~~**Repair the stored placeholders.**~~ **Done 2026-09-04** —
   `scripts/repair_team_member_names.py --apply` against production: eleven rows
   across eight houses renamed from their linked accounts, re-check clean (§9).
   The script is kept rather than deleted, because the condition that produced
   the rows can recur from a restore.

6. **A real shift import.** `components/team/ShiftImportModal.tsx`'s apply path
   was a simulation and is now disabled with the reason on the modal
   (`ShiftImportModal.test.tsx` pins "no success without an import"). Building
   it means a gateway route that takes a CSV/XLSX and returns what it parsed
   BEFORE writing anything, and a house `Sheet` on the parity page that shows
   that parse for confirmation. The picker is already real; only the two ends
   are missing.
7. ~~**A `team_notes` store, so a crew note is a record.**~~ **Built
   2026-09-04** — migration `20260904180000` (`team_notes`,
   `team_note_recipients`), `team/notes.service.ts`, three routes
   (`GET/POST …/team/notes`, `POST …/team/notes/:id/opened`). What is left on
   it: a note cannot be edited or withdrawn, and there is no digest of a week's
   notes for someone joining mid-week.

7a. **Email and SMS return when a house has senders of its own.** Both legs were
   removed for every caller on 2026-09-04: the only senders available are the
   house's shared mailbox and its shared SMS account, the ones vendors are
   written from. Restoring either needs a per-house sender and nothing else —
   the channel vocabulary already carries both values, the gate refuses them in
   one line (`team.controller.ts`, `NO_SENDER`), and a caller that names one is
   told how many people it would have reached under `withheldByProduct`.

7c. **The founder's follow-on, verbatim (2026-09-04):** *"for each individual
   having their phone connected helps us use their connection to message and use
   freely"*, and the condition he set on restoring either leg: *"as long as the
   third-party connections are well built"*.

   Nothing here is built, and this note is a POINTER, not a design. It says: the
   way out of a shared sender is not a better shared sender but a per-person
   connected one — the message leaves through the individual's own channel, so
   there is no house mailbox for a reply to land in and no unknown number for a
   text to arrive from. That reframes the sender question from "buy a per-house
   domain" to "let a person connect their phone", which is a different piece of
   work with different consent, revocation and liability questions.

   **The parent is dispatching messaging-sender research on it.** Do not build
   against this line: the questions it opens — what "connected" means, who may
   send as whom, what happens when a person leaves, and whether a manager
   messaging staff through a staff member's own connection is a thing a house
   should be able to do at all — are exactly what that research is for.

7d. **That research landed: [ADR 0121](../decisions/0121-the-houses-text-sender.md),
   survey in [`07-reference/messaging-senders.md`](../07-reference/messaging-senders.md).**
   Still nothing built. Four findings that bear directly on this page.

   **"Use their connection" is closed by every platform, with one survivor.** iOS
   has no third-party SMS send — the OS opens the composer and the person presses
   send. Google Play restricts the SMS permission group to the device's registered
   default SMS handler, which Mudavym will never be. WhatsApp's terms forbid "any
   non-personal use of our Services" and "bulk messaging, auto-messaging"; Signal's
   forbid the same; Apple Messages for Business and RCS are brand channels behind
   an MSP or partner gate. The survivor is a **hand-off**: the app prefills the
   person's own composer and the person sends it, and the record says
   `HANDED_TO_PERSON` — never a delivery. On Android `expo-sms` returns `unknown`
   in every case, so the product could not honestly claim more than "the composer
   opened". `apps/mobile` has neither `expo-sms` nor `expo-contacts` today.

   **The crew has nothing to text.** Measured on production 2026-09-04: **0 of 11
   `team_members` carry a phone**, 3 of 11 `users` do, and **0 of the 3
   `notification_preferences` rows have `sms_enabled`**. Restoring the SMS leg
   today would reach nobody, so `withheldByProduct.sms` is honestly 0 and the
   removal cost zero messages.

   **But the channel that is still on reports reach it does not have.**
   `mobile_devices` holds **0 rows**, and `ExpoPushService.sendToUsers` returns
   silently on an empty read *and* on a failed one (`push/expo-push.service.ts:83`,
   `if (error || !data?.length) return;`) while this route reports
   `notified: pushIds.length` counted off the roster (`team.controller.ts:521,527`).
   **A broadcast to the active crew reports `notified: 11` and delivers 0.** That
   is [[absence-reported-as-health]] in the one channel §7a left standing, and ADR
   0121 makes fixing it phase 0 — the honest version of "wait for a sender" is
   "say what push actually did, then wait". This is a §9 gap on this page, filed
   and not fixed in the docs pass that found it.

   **Whether a crew text should exist at all is founder question 1 in ADR 0121.**
   ADR 0118 D6 keeps the composer on the vendor book, and a staff text has a
   different legal footing from a vendor one (employees, not businesses; TCPA
   quiet hours of 8 a.m. to 9 p.m. local land squarely on a restaurant's closing
   shift). The ADR proposes WhatsApp as a **vendor** channel first and does not
   assume the SMS leg comes back here at all.

7b. **RETIRE-ON-FLAG — what happens to the legacy desk, decided.** The legacy
   Manager Shift Desk retires **the day the flag turns on for a house**: from
   that moment it is not the surface anybody operates, and a fix belongs on the
   Mudavym half only. It is **deleted in the wave that removes the flags**, not
   before, because until then a flag-off house still renders it byte-for-byte.
   **Nothing is deleted now.** What retires, when that wave comes:
   `pages/team/command/{ManagerShiftDesk,MyShifts,editors,bits,PerformancePanel,OpsRulesPanel,TeamCommandPage}.tsx`,
   the five legacy renderer entries in `scripts/check_windowed_figures.py`'s
   `/team` PageSpec, and `TeamCommand.honesty.test.tsx`. Until then both halves
   are maintained, and the cost of that is real: every `/team` fix is written
   twice, and this note is where that cost is recorded rather than discovered.
8. **Move sales ingest off the schedule.** The legacy `PerformancePanel`'s "log
   a service" form and CSV import were deliberately not carried onto the
   expander (§1b, "the two directions not built"). They need a surface of their
   own before the legacy desk retires.
9. **Calendar events on the Mudavym grid.** The legacy header printed the day's
   first event; the rebuilt one prints coverage. Both are worth having and they
   need two lines, not one.
10. **`record()` calls for labour settings and coverage rules.**
   `TeamService.updateSettings` and the coverage-template writers file nothing
   into `system_audit_log`, so the configuration register shows a date and never
   an author. `SettingsAuditService` is already exported and already read back
   by this page — this is one caller each, no migration.
11. **Widen the shared `WeekPayload` type** (`services/api/team.ts:75-88`) to
   name `labor.costComplete` / `pricedShifts` / `unpricedShifts` and
   `settings.configured` / `updated_at`, which the gateway already sends
   (measured 2026-09-04). Read through a local narrowing today, §9.
12. **Drop `team_settings.labor_target_pct`'s `DEFAULT 28`** so a stored value
   is always a chosen one. The page already reads a defaulted 28 as unknown and
   never measures the week against it, but that is a reading, not a fix. The
   defaults migration belongs to the settings-consequences branch, not this one;
   the table has 0 rows in production, so it is the cheapest it will ever be.

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
