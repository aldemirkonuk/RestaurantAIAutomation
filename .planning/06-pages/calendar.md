---
type: page
route: /calendar
slug: calendar
softwares: [calendar]
component: apps/web/src/pages/CalendarModular.tsx
audience: owner
tier: core
archetype: calendar # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]"]
---

# /calendar — Calendar (modular)

> **Part of** [[08-softwares/calendar|Calendar]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Click slot / New event** → (EventModal on this page)
- **Drag-move / resize event** → event mutation via `useCalendarEvents`
- **Meeting end** → (MeetingMemoPrompt capture on this page)
- (no outbound navigation — dead-end page)

## 1. Purpose

"Routes the fully-built modular calendar (`pages/calendar/*`) that ships Week/Day
views, drag-move/resize, click-slot-to-create, true event editing, RRULE recurrence,
multi-channel reminders, and meeting-memo capture … Previously built but unrouted"
(`CalendarModular.tsx:1-9`). Deliveries, tastings and vendor meetings for the
operator (`Sidebar.tsx:110`).

## 1a. Features
- See deliveries, tastings and vendor meetings in Month / Week / Day / Agenda views
- Drag to move or resize an event; click an empty slot to create one
- Full event editing with recurring events (RRULE)
- Create and manage custom event types (server-backed)
- Multi-channel reminders per event
- Capture a meeting memo after a meeting
- Link events to vendors
- "Add calendar event" from the command palette deep-links straight into the create modal

**Added by the Mudavym rebuild** (behind `mudavym_design_calendar`; the shipping page is
unchanged with the flag off):

- **The day is the unit of record.** Clicking a day in the month opens that day's ledger
  underneath — deliveries first, then everything else, each line carrying its vendor and
  order link
- **Deliveries are the spine, and an arrived delivery is *ruled off*** with the house double
  rule; a day whose whole delivery account is settled is ruled off as a day, under a
  dry-pressed seal. Ruled off means one of exactly two things: the entry's own status is
  `completed`, or its linked order is one the orders book says arrived
- **Search and type filter over the loaded period**, with a line saying how many entries the
  filter is holding back (they are in the book, just not on this screen)
- **A drafted entry handed over by another page.** `/calendar?new=<url-safe JSON>` opens
  the create sheet on the drafted date with the title, type and note already filled in —
  the link `/recommendations` mints under "Put it on the day-book"
  (`pages/recommendations/next/rec-daybook.ts`). The parameter is treated as untrusted
  input because it is a URL: `readNewParam` (`CalendarNext.tsx:66-106`) cannot throw on a
  malformed link — it opens the sheet empty and says, in words, that the link carried a
  draft this page could not read, because a person clicked something and going quiet
  would report the absence of a draft as health — requires `date` to match `^\d{4}-\d{2}-\d{2}$` and
  otherwise opens on today, caps `title` at 200 and `note` at 2000 characters, and seeds
  `type` only when it is a member of the gateway's own `CalendarEventType`
  (`EventSheet.tsx:43-58`) — anything else falls back to the sheet's default rather than
  entering the form as a value the gateway would 400 on. Every seeded field is a DEFAULT
  the manager edits before saving, and the parameter is stripped on arrival so a refresh
  does not reopen the sheet
- **Four honest states**: loading names the window it is reading; a failed read says which
  register could not be read and offers a retry; a 403 is named as a permission answer, not
  an empty schedule; an empty period says so in words
- **The gateway's paging is surfaced** — when `hasMore` comes back true the page says the
  month it drew is not the whole month, instead of quietly showing the first 100
- **Hold-to-delete**: deleting is the one irreversible act on the page, so it is the one
  place that spends the seal ceremony; deleting a repeating entry says it takes the series
- 🔒 **The job is OFF by default and says so.** It sends nothing until
  `CALENDAR_REMINDERS_ENABLED=true` is set on the gateway, and the page renders "The reminder
  job is built but not switched on" with the flag name rather than implying it is sending.
  Not gated on the Mudavym design flag: a design flag decides what a page looks like, not
  whether a house gets woken up. **Arming it is the founder's call**
- ✅ **Reminders are sent by the server** (2026-09-03, [ADR 0109](../decisions/0109-a-reminder-is-the-houses-job-not-the-browsers.md)).
  A 15-minute per-tenant cron reads `reminder_enabled` / `reminder_days_before`, writes through
  `persistForRestaurant` (inbox row + socket + mobile push) and stamps `reminder_sent` —
  the column that had no writer anywhere in the repo until this build
- ✅ **The reminder rows show the job's own account of itself**: last actual run with its
  counts (`4 due, 3 sent, 1 held for quiet hours`), the next scheduled tick, how many entries
  are still waiting, and — the load-bearing one — **whether the scheduler serves this
  restaurant at all** (it enumerates opted-in tenants, ADR 0022), so a house it does not serve
  is told "No reminder will be sent" instead of being shown a next-run time
- ✅ **Quiet hours are honoured per person**, on the *restaurant's* clock: a member inside
  their window is held until it closes, not dropped, and holding one member never delays or
  duplicates another's — the claim is per (entry, person)
- 🔒 **Offsets are whole days only** — `reminder_days_before` is an INTEGER of days, so the
  sheet offers *On the day / 1 day / 2 days / 1 week* and says why, rather than offering
  minutes and rounding them into a value nobody chose (§13)
- 🔒 **The email channel is still rendered disabled** with the reason — the job writes the
  inbox row and the push; mail needs a recipient policy of its own
- 🔒 **A client-expanded recurring occurrence gets no reminder** — it is not a row, so there
  is nothing to key a dispatch on; materialised occurrences are reminded normally (§13)
- 🔒 **Vendor link and repeat rule are create-time only**, each with one line saying why (the
  update DTO carries neither field, §9)
- 🔒 **A recurring occurrence is not draggable** and its sheet says an edit changes the whole
  series — the gateway has no per-occurrence route
- ⚫ **The meeting-memo prompt is not built** (it collected notes into a void, §10)
- ⚫ **`labels` are not collected** (they were never forwarded to the API, §10)
- ⚫ **The collapsible left sidebar is gone**; its two jobs (type legend, search) are a select
  and an input in the header, so `localStorage['wineops-calendar-sidebar']` is unused here

**Built by the fourth pass** (2026-09-03, ADR 0111 slices 1-3 + the iCal fixes; behind
`mudavym_design_calendar` except where noted):

- **The sky on every day cell, and it names whose it is.** High/low in the issuer's own unit,
  a six-bar chance-of-rain mark, and the issuer + issue time on hover — NOAA/NWS with its
  forecast office and grid (`MTR/91,89` for Palo Alto). This is the line DESIGN-FOUNDATION §6
  drew: a *published, attributed* forecast is a citable observation; our own covers number
  drawn without its error is the guess, and that is slice 9, still unbuilt
- **A cell with no reading says why, and there are six different whys.** No coordinate on the
  house · outside NWS coverage (it is US-only) · the issuer was unreachable, refused, or
  answered something unreadable · the register itself could not be read. Never a blank: a
  silently empty weather column is indistinguishable from a week of clear skies
- **A stale forecast stays on screen with its age.** When the refresh fails the readings are
  kept and the page says "the weather service answered 503 — what is drawn is the last
  forecast read, 143 minutes ago, not the present"
- **Every forecast is KEPT, per issuance.** `weather_readings` is not a cache: a new issuance
  for the same day is a new row beside the old one, which is the only thing that makes "what
  was forecast *before* the day" recoverable later
- **A passed day holds the record.** Covers and sales from `pos_checks` beside the forecast
  that stood before the day began, with its lead time in days
- **A passed day states the forecast's error, from 2026-09-04.** The nearest reporting
  station's observations are recorded beside the forecast, so `prediction_outcomes` now
  receives the **first real `accuracy_score` this product has ever produced**: the absolute
  error of the forecast daily high against the observed daily high, **in °C, lower is
  better**, stated in words in every row and shown on the cell as *"the forecast was out by
  1.1 °C on the high"*. Withheld with a reason when either side is missing, and the two
  absences are distinguished (*no forecast stood before this day* / *no station observed it*)
- 🔒 **The TRADING half is still unscored.** A day can carry a real weather score and no
  claim whatever about covers: the covers model is slice 9, gated on 90 observed service
  days, and the house has 22. The recorded covers travel beside the score, unscored
- **The forecast refreshes on a schedule as well as on read** (hourly, every house with a
  coordinate), so a house nobody opens still accumulates the history slice 9 needs. It does
  not go through the ADR 0022 opt-in — that scheduler serves one house of ten (§9, weather-overlay gap 1) — which
  required a dated amendment to that ADR naming exactly the two NWS reads it permits
- **Covers are an em dash, never a zero, when the POS did not send them**, and a day the
  house was shut is **hatched and labelled "ruled out"** rather than drawn as zero trading —
  a closure counted as a zero is the most damaging input a demand model can be given
- **The coordinate is captured at sign-up** (*outside the flag; `Register.tsx` + the gateway's
  register path*): the point resolves from the Google Places selection in the same call that
  fills the city, and is written with the restaurant. A hand-typed address carries **no**
  point — no default city, no 0,0, no geocode — and a half-pair is refused outright
- **The iCal feed's four subscribe suspects are closed** (*outside the flag; the feed is
  public*): `Content-Disposition: attachment` → `inline`, event times built in the
  **restaurant's** IANA zone instead of the server's clock, `X-PUBLISHED-TTL` +
  `REFRESH-INTERVAL` at one hour, and an absolute + `webcal://` URL. A restaurant with no
  resolvable timezone gets a **floating** time (RFC 5545 form one), never a false UTC
- ⚫ **Advisories are read but not kept.** NWS `/alerts/active` is a live best-effort read; a
  failed advisory feed renders "this page is not saying whether a warning is in force — only
  that it does not know", never "no advisories"

**Researched and designed, not built** (fourth pass, 2026-09-03 —
[[0111-the-calendar-is-the-houses-day-book|ADR 0111]], sketches
`.planning/sketches/098-calendar-quant-overlay/`). Every line below is a design with a
measurement behind it; §1b's *Quant overlay* subsection carries the detail and §13 carries
the slices. Slices 1-3 have since been built and moved to the list above — what remains
below is slices 4-9:

- ⚪ **The three remaining risk marks per cell** — price, delivery and quality. Weather and
  the past half of the month are BUILT (above); these three are not, and each is blocked on
  an empty table rather than on effort
- ⚪ **A deadlines strip** — order-window cutoffs, invoice due dates, expiring certificates,
  recurring orders and ending promotions in one band, each card naming the table it came
  from and whether the term was *stated* or *inferred*
- ⚪ **Notes, daily actions and meetings as first-class day-book kinds** — a `calendar_day_notes`
  table so a memo stops being collected into a void, recommendation/one-tap/proposal rows
  projected onto their date, and Google Meet links on entries that have been pushed
- ⚪ **A ⌘K assistant for the day** — extending the existing propose→confirm allowlist with a
  `calendar` family, split by ADR 0013's test: it may create, move, annotate, remind and note
  alone; anything that **leaves the house** — mailing a vendor, amending an order, pushing to a
  connected external calendar — is a proposal under the hold-to-approve seal
- ⚪ **Four external-calendar directions** — push, pull, two-way with stated conflict rules, and
  the day-book exposed as the Mudavym MCP server's first three tools
- 🔴 **Measured blocker, and it decides the order:** of the six inputs the overlay needs, five
  found **nothing** in production on 2026-09-03 — 0 of 14 restaurants carried a coordinate, the
  best-covered tenant had 22 observed service days, `vendor_price_observations` was empty, no
  order carried a promised *or* actual delivery date, and there is no shelf-life column
  anywhere in the migration corpus. **The first of the five is now closed by code rather than
  by data**: sign-up captures the coordinate and `scripts/backfill_restaurant_coordinates.py`
  offers the 13 existing rows the same lookup, keyed on `google_place_id`. The other four are
  unchanged, which is why slices 4 and 9 stay unbuilt

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_calendar`)

Canonical copy lives beside the code in
`apps/web/src/pages/calendar/next/MOTIONS.md`; this table is the mirror.

| id | token | curve · ms | fires |
|---|---|---|---|
| `cn-open` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 420ms | the opening block (wordmark, period line, standing sentence) on mount, once |
| `cn-turn` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | the view stage when the magnification changes — the same book, a page turned |
| `cn-day-settle` | `settle` | HOUSE · 320ms | the day ledger opening under the month grid (`grid-template-rows: 0fr → 1fr`) — the row-expand the founder singled out on board 053 |
| `cn-sheet-tuck` | `tuck` | spring 380/32 · 300ms | the event sheet arriving from the right, 28px + fade — **since 2026-09-04 run by the house primitive** (`components/mudavym/Sheet.tsx`), not by this page's keyframes |
| `cn-drag` | **none, deliberately** | live `pointermove`, un-eased | a block dragged or resized in the Week/Day grid — easing between 15-minute snaps would draw a time the operator never chose |
| `cn-drop-tuck` | `tuck` | spring 380/32 · 300ms | the same block settling into its committed slot after the pointer lifts; suppressed while the finger is down |
| `cn-ink` | `ink` | HOUSE · 160ms | hover/focus micro-states on cells, ribbons, ledger lines, tabs, chips, buttons — nothing moves |
| `cn-hold-pour` | `pour` | `linear` · 620ms | the hold-to-delete fill; an early release retreats on `tuck` and says what did not happen |
| `cn-seal-stamp` | `stamp` | spring 500/26 (~11% overshoot) · 360ms | the seal landing when the delete hold completes — the only overshoot, and the only wax |

**Deliberate non-motions:** the grid does not stagger in (a schedule is a reference you scan,
not a set of figures arriving); nothing tallies (the counts are counts of record, and an em
dash must never animate); ruling off is *drawn*, not animated (the delivery arrived in the
orders book — the page did not do it); the sheet and the day ledger close instantly.
`prefers-reduced-motion` collapses every row above to its end state.

**Modal shape (ADR 0112) — landed 2026-09-04.** The event sheet is the house **`Sheet`**: a
right slide-in, 440px, `tuck`, for one object's detail or edit. The migration is done, not
planned — `EventSheet.tsx` renders `<Sheet open onClose label eyebrow title>` and the page's own
`.cn-scrim`, `.cn-sheet` and `@keyframes cn-sheet-in` are deleted from `calendar-next.css`,
along with the sheet's private Esc handler and its focus-the-Close-button effect. What the page
gains that its copy never had: a focus trap, focus returned to the opener, a counted body-scroll
lock, and no animation at all (rather than a shorter one) under `prefers-reduced-motion`. The
form inside — every `.cn-*` class and every word of the honesty copy — is unchanged.
`CalendarNext.test.tsx` pins it (44 tests).

### Design used, and why

**The verdict.** `/calendar` — **KEEP.** *"I really prefer the new version. That's for
sure."* The one page named in the founder's opening as unreservedly liked
([[MAKEOVER-VERDICTS]]:212).

**The structure that enforces it.** A KEEP is the hardest brief: there is nothing to fix, so
the only honest way to spend the work is to make the page *mean* what the house means. One
idea does that — **the day is the unit of record, and deliveries are the spine.** Month,
Week, Day and Agenda are not four features; they are four magnifications of one book. Every
view sorts deliveries first and gives them the seal rule; everything else gets an ink rule.
And the house's own device does the rest: a delivery that arrived is **ruled off** with the
double rule, and a day whose whole delivery account is settled is ruled off as a day. That
single device replaces what a calendar normally does with colour, and it is the reason the
page can obey ADR 0042's one-chromatic-colour rule without going flat.

**The honesty rules applied.**
- The page does not reuse `useCalendarQueries`: those hooks return `[]` on failure in DEV,
  silently substitute an IndexedDB copy otherwise, and turn a real 4xx on write into a
  fabricated `{ _pending: true }` "saved offline" success. All three make *absence* look like
  *health*. This page reads through `apiClient` directly and says what failed.
- Ruled off has exactly two sources and the page names them; while the orders book is
  unknown, only the entry's own status can rule a line off, and a line says so.
- No control is offered that the gateway cannot honour: the email reminder channel, the
  vendor link on edit and the repeat rule on edit are each rendered disabled or read-only
  with one line of reason.
- A stored value outside the gateway's own enum (production carries `event_type: 'audit'` and
  `status: 'active'`, §9) is **not coerced** — the field is left untouched and the sheet says
  it is holding a value it cannot re-send. Coercing would have rewritten the tenant's record
  under a green save.
- An `all_day` row that still carries a recorded time says both, rather than hiding the time.
- Paging is reported; the first 100 of a busy month is never drawn as the whole month.

**Two directions considered and not built** — the founder decides after seeing the page:

1. **The delivery board.** Demote the grid to a locator and make the primary object a board of
   deliveries by state (expected → in transit → arrived → ruled off). It follows the spine
   argument further than this build does. Not built because a board is not a calendar: you
   cannot answer *"what is Thursday like"* on it, and §1a names the Month/Week/Day/Agenda
   quartet as the thing to keep. Worth a sketch if the founder wants procurement, not time, to
   be the page's subject.
2. **The single-column day book.** Drop the month grid entirely and make the whole page one
   scrolling ledger of days (today's Agenda, promoted), with a month mini-map in the rail.
   Purest expression of "the day is the unit of record", and the most Editorial. Not built
   because planning a week of deliveries needs the 14th and the 21st side by side, which a
   scroll cannot give.

**Substituted, and the fork inside it.** The eight event-type colours are **not** a page
colour system here. ADR 0042 makes the İznik seal the one chromatic colour, and eight hues on
the grid would break it outright. Type colour therefore survives only as a 7px swatch inside
the sheet's type picker — the operator's own record, being edited — while the grid draws
**rank** instead: seal rule for the delivery spine, ink rule for everything else, double rule
for ruled off. The alternative (honour per-type colour on the grid) is more familiar and
would read faster for a tenant with many custom types; it is a real fork and the founder
should judge it against a screenshot rather than a paragraph.

**Left out, and why.** The meeting-memo prompt (collects notes nothing stores, §10); `labels`
(never forwarded to the API, §10); the collapsible sidebar (its two jobs are a select and an
input in the header now). Custom event types are created and deleted here but an event stores
them as `custom` plus the colour — the gateway's `CalendarEventType` enum has no slot for a
custom name, and the sheet says so rather than inventing one.

### Third pass, 2026-09-03 — the reminder becomes the house's job

**What the founder asked.** "Server-side calendar reminders" as one of the four large builds:
a cron under the existing per-tenant scheduler that reads `reminder_enabled` /
`reminder_days_before`, writes through `persistForRestaurant`, stamps `reminder_sent`, honours
quiet hours and never sends twice; the page's reminder rows to stop saying "on this browser"
and show last/next run; the localStorage scheduler retired or demoted with a stated fallback.

**What was built.** [ADR 0109](../decisions/0109-a-reminder-is-the-houses-job-not-the-browsers.md).

| Piece | Where |
|---|---|
| The cron | `apps/api-gateway/src/calendar/calendar-reminders.service.ts` — `@Cron("*/15 * * * *")` → `ScheduledTenantsService.runPerTenant("calendar-reminders", …)` |
| The arithmetic | `apps/api-gateway/src/calendar/reminder-window.ts` — due time and quiet hours in the *restaurant's* zone, DST-correct, pure and separately tested |
| The status read | `GET /calendar/reminders/status` (`calendar.controller.ts`, route `reminders/status`) → `statusFor` |
| The ledger | `supabase/migrations/20260903101500_calendar_reminders_have_a_ledger.sql` — `calendar_reminder_dispatches` + `calendar_reminder_runs`, RLS on, service-role only, in-file assertions |
| The register | `apps/web/src/pages/calendar/next/ReminderRegister.tsx`, rendered by `EventSheet.tsx` |
| The standing line | `CalendarNext.tsx` `reminderLine` — the footer sentence is now drawn from the job's status, not asserted |

**The one structural idea.** *Idempotency is a database index, not a boolean.* Every send is
preceded by an INSERT into `calendar_reminder_dispatches`, whose UNIQUE `(calendar_event_id,
user_id)` index is the key. Two gateway instances cannot both win the insert, so they cannot
both send — and because the claim is per **person**, quiet hours stop being a coordination
problem: a member inside their window simply is not claimed this tick, and the next sweep after
the window closes serves exactly them. `reminder_sent` becomes the roll-up it was named for
(written for the first time in this repo's history) and is never the thing preventing a second
send. The spec proves this the hard way: it unsets `reminder_sent` and sweeps again, and
nothing goes out.

**Honesty applied.** Four sentences the page is now able to say, none computed in the browser:

1. *Whether the job serves this house at all.* The cron enumerates opted-in tenants (ADR 0022),
   so for a restaurant it does not serve there is no next run to promise — `served: false`
   carries the reason (the one INSERT that opts it in), and the sheet says "No reminder will be
   sent."
2. *When it last actually ran*, beside the next scheduled tick. A schedule is not evidence that
   a process is alive.
3. *"Never run" is separated from "the ledger could not be read"* (`ledgerReadable`). Both are
   an empty `lastRun`; only one of them means the job has nothing to report. Measured live: the
   local gateway points at production, where the two new tables do not exist yet, and the
   endpoint correctly returned `ledgerReadable: false` rather than "this job has never run".
4. *A claim that was never confirmed is not a send.* A crash between claim and notification
   leaves `sent_at` NULL, and the status endpoint reports those rows as exactly that. A funnel
   that wrote nothing is a failure, and the claim is released so the next sweep retries.

**The fork the founder has to settle: arming it.** The job is written, tested and wired, and
it is **off**. `CALENDAR_REMINDERS_ENABLED` is an env allow-list (only `true`/`1`), copied from
`RECURRING_ORDER_REMINDERS_ENABLED` (`communications/recurring-order-reminder.ts:20`) for the
same reason: a typo should produce silence, not a live sender. It is deliberately NOT the
Mudavym design flag — turning a page's new look on must not start writing to every member's
phone. What arming it does, measured: `GET /calendar/reminders/status` against production on
2026-09-03 returned `served: true, armed: false, pending: 0`, so flipping it today sends
nothing retroactively and starts sending for entries created from then on.

**The two alternative directions not built** — the founder decides after seeing the page:

- **Sub-day reminders.** The obvious ask is "15 minutes before", and it is not representable:
  `reminder_days_before` is an INTEGER of days. The alternative was a
  `reminder_minutes_before` column plus DTO, service, mapper and UI changes, which is a second
  build. What shipped offers whole days and says why; §13 carries the column.
- **Email as a real channel.** The job could mail as well as write the inbox row, but "who gets
  it" is a decision: `RecipientResolverService` still falls back to a global env address for
  the legacy tenant (`communications/scheduled-tasks.service.ts:120-146`), and mailing the
  wrong house is the defect ADR 0022 spent its length preventing. The tick stays disabled with
  that reason.

**Substituted or left out.** The browser scheduler is **demoted, not deleted**: `main.tsx:20`
still boots it, because `main.tsx` is shared and the shipping page must render byte-for-byte
with the flag off. Nothing in `pages/calendar/next/**` enqueues into it any more, and the sheet
cancels an entry's browser-queued copies whenever it saves that entry
(`EventSheet.tsx` `clearBrowserQueue`), so anything the redesign touches has exactly one
sender. The residue is named in §9: an entry created on the legacy page and never opened here
can still fire twice.


### Fourth pass, 2026-09-03 — the sky, the record, and a feed that can be subscribed to

**What the founder asked.** *"We're going to add weather forecast (basically all Quant
detailed work) to predict weather, pricings, transportation, quality of food and so on"*,
widened the same day to the whole day-book. Then, on the research: **NWS now, behind a
`WeatherProvider` interface**, and **"when google maps API address is being used, take the
geocode as well in sign up"**. Three further forks answered in the same sitting: public
commodity indexes go in a **separate register**, the 90/180-day floors are **per restaurant
and never pooled**, and the Google app **goes for verification now**.

**What was built.** ADR 0111's slices 1-3 and the two-plus-two iCal fixes, in that order.

| Slice | What shipped | Where |
|---|---|---|
| 1 — the coordinate | The Google Places selection's point captured at sign-up and written with the restaurant; a backfill script for the 13 existing rows with a dry run, keyed on `google_place_id` | `apps/web/src/pages/Register.tsx`, `components/ui/PlacesAutocomplete.tsx`, `contexts/AuthContext.tsx`, `apps/api-gateway/src/auth/auth.service.ts` `coordinateColumns`, `auth/dto/register-restaurant.dto.ts`, `scripts/backfill_restaurant_coordinates.py` |
| 2 — the weather overlay | `WeatherProvider` interface + `NwsWeatherProvider` (points → gridpoint → forecast, cached point resolution, descriptive User-Agent, `/alerts/active`), `weather_readings`, `GET /calendar/weather`, and the cell mark | `apps/api-gateway/src/weather/`, `supabase/migrations/20260903162000_a_forecast_names_its_issuer.sql`, `pages/calendar/next/SkyMark.tsx` |
| 3 — the passed day | Covers/sales per day from `pos_checks` with closures hatched, paired with the forecast that stood *before* the day, written to `prediction_outcomes` with a NULL score | `apps/api-gateway/src/calendar/recorded-days.service.ts`, `day-record.service.ts`, `GET /calendar/day-record` |
| — the iCal one-liners | `inline` not `attachment`; the restaurant's IANA zone not the server's; `X-PUBLISHED-TTL`/`REFRESH-INTERVAL`; absolute + `webcal://` URL | `calendar.controller.ts`, `calendar.service.ts`, `calendar/zoned-time.ts` |

**The structural idea, and why it is not the veto DESIGN-FOUNDATION §6 wrote.** §6 forbids
*"weather-driven forecasting on the grid — a guess on a page whose virtue is that everything
is a fact"*. The grid now draws the past and the future in one page and **admits it**: left
of today a cell holds what the ledger recorded, right of today a forecast **that names its
issuer and its issue time**, and when a day passes the cell keeps both. A published
meteorological forecast, attributed, is a citable observation about the future; our covers
number derived from it and drawn without its error is the guess §6 actually forbids — and
that is slice 9, gated on ninety observed service days, still unbuilt. One rule, and it also
satisfies §6's other "need it now" idea for this page, *"the day that already happened"*.

**Four things the build measured that the research pass had not**, each of which changed code:

1. **NWS's issue time is `updateTime`, not `updated` or `generatedAt`.** Live against
   `gridpoints/MTR/91,89` on 2026-09-03: `updateTime 12:26:50Z`, `generatedAt 13:01:51Z` —
   35 minutes apart, and `generatedAt` refreshes on every poll. Keying "how old is this
   forecast" on it would make a twelve-hour-old grid read as new.
2. **The NWS horizon is 7 days, not the 16 an Open-Meteo response carries.** `horizonDays`
   travels on the response so a cell past it says *"beyond NOAA/NWS's 7-day forecast"*
   rather than looking broken.
3. **NWS publishes a probability of precipitation and no quantitative amount at all.** So
   `precipitation_amount_mm` is NULL on every row this issuer produces, the mark is a
   *chance* bar rather than a depth, and a `DEFAULT 0` on that column would have published
   "no rain expected" for every day of every forecast.
4. **`Intl.DateTimeFormat` accepts `PST`, `EST` and `US/Pacific`** — they are resolvable ICU
   aliases, not typos — so the iCal zone resolver lets them through and only refuses
   genuinely unresolvable strings like a human-readable `"Pacific Time"`.

**Where this build overruled the ADR it implements.** ADR 0111 §6 said slice 2's refresh
should run under `ScheduledTenantsService.runPerTenant` (ADR 0022). It does not.
`runPerTenant` enumerates only tenants carrying
`restaurant_feature_flags.flag_name = 'scheduled_communications'` or matching
`DEFAULT_RESTAURANT_ID` (`communications/scheduled-tenants.service.ts:88-125`), and
production has **one such tenant out of ten** (§9, weather-overlay gap 1) — a cron behind that gate would have left
nine houses with a permanently blank weather column and no sentence explaining it, which
is the absence-reported-as-health fault delivered by the mechanism meant to prevent it. The
refresh is **on read, with a 60-minute max age** matching NWS's own republish cadence: fewer
issuer calls than a cron, an 8-second provider timeout so a dead issuer cannot hang the
grid, and stored readings served with their age when the refresh fails. The cost is real and
is filed in §13 rather than hidden: **a house nobody opens accumulates no history**, which
is the input slice 9's ninety-day floor depends on.

**What is deliberately still withheld.** No accuracy figure anywhere. Scoring the weather
forecast needs an *observation* and nothing in this product records one; scoring the day
needs a *covers model* and that is slice 9. So `prediction_outcomes` receives its first rows
ever — the forecast that stood before the day, paired with what the day turned out to be —
with `accuracy_score` **NULL** and a `context.note` saying why. Writing a number there today
would mean inventing the metric it scores.

### Fifth pass, 2026-09-04 — the observation, and the first real score

**What the founder asked**, in two decisions on the same day: *record weather
OBSERVATIONS beside the forecasts so a forecast can be scored*, and *the weather refresh
gains a scheduled prefetch — one refresh per house per hour, only for restaurants with a
coordinate, so a house nobody opens still accumulates history*.

**What that changed, in one sentence:** the fourth pass shipped an overlay that could
never be wrong on the record, because nothing recorded what actually happened; the fifth
gives it a station to be measured against.

| Piece | Where |
|---|---|
| `weather_observations` — the station's own measurements, per local day | `supabase/migrations/20260904140000_an_observation_scores_the_forecast.sql` |
| `/points` → station list → `/stations/{id}/observations`, folded to local days | `weather/nws.provider.ts` `observations`, `foldObservationsToDays`, `localDateInZone`, `usableQuantity` |
| The score | `calendar/day-record.service.ts` `scoreForecast`, written to `prediction_outcomes.accuracy_score` |
| The hourly prefetch | `weather/weather-prefetch.service.ts` |

**Four things the build measured, each of which shaped the code:**

1. **The two sides disagree about units.** NWS publishes its gridpoint forecast in
   **Fahrenheit** and its station observations in **Celsius** (`wmoUnit:degC`). Each side
   stores the unit its own issuer published; the scorer converts the FORECAST, because
   converting the measurement would put our arithmetic on the side that is meant to be
   ground truth.
2. **`/points` carries no station id** — it carries `observationStations`, a URL to the
   ranked station LIST for the grid square (53 stations for MTR/91,89, nearest first). One
   more hop, cached with the rest of the point.
3. **A nearest station can be silent.** The provider walks up to four down the ranked list
   rather than reporting "no observations" for a point with a staffed airport two miles
   away.
4. **KPAO reports no rainfall at all** — 42 of 42 observations carried
   `precipitationLastHour.value = null`. `precipitation_total_mm` is nullable and summed
   only over hours that published a number; a `DEFAULT 0` would have published a dry week.

**The score, stated once so nothing has to infer it.**

> `accuracy_score` = |forecast daily high − observed daily high|, in degrees **Celsius**.
> **Lower is better.** Withheld (NULL) when either side is missing, with `context.withheld`
> naming which side.

That sentence is in `context.metric` on every row, because the column is named
`accuracy_score`, carries an index, and holds an **error** — a reader assuming
higher-is-better would read every row backwards. Both raw sides are kept in
`predicted_value` / `actual_value` so the number can be recomputed rather than trusted, and
the rows sit under their own `agent_name` (`mudavym.calendar.day_record`), separate from
`services/self-evolution/main.py`, the only other writer.

**The first real score, measured live on 2026-09-04:** forecast 75 °F (23.89 °C) for
2026-09-03 against an observed high of 24 °C at KPAO — **out by 0.11 °C**.

**Why the prefetch does not ride ADR 0022.** `runPerTenant` enumerates one restaurant of
ten (§9, weather-overlay gap 1), so a cron behind it would leave nine houses accumulating nothing while slice
28's ninety-day floor counts days of *record*. ADR 0022's opt-in is a consent gate on
**being contacted**, and this contacts nobody: it reads two public NWS endpoints on the
tenant's own behalf and stores the answers against the tenant's own row. That is now a
dated amendment on ADR 0022 naming exactly those two reads — **and nothing else**; anything
that reaches a person still goes through `runPerTenant`.

**Still not built, and still for the same reason:** the covers forecast, and therefore the
scoring of the TRADING half of a day. Slice 28, gated on ninety observed service days; the
house has 22.

### Quant overlay — research 2026-09-03

**Nothing in this subsection is built.** It is the research-and-design pass behind
[[0111-the-calendar-is-the-houses-day-book|ADR 0111]], commissioned by the
founder's fourth-pass note on this page ("weather forecast — basically all Quant detailed
work — to predict weather, pricings, transportation, quality of food"; "keep the customer
inside the app … MCP or API connections is a must") and widened the same day to the whole
program: meetings, notes, daily actions, reminders, Google Meet, a ⌘K assistant, and all
four external-calendar directions. Sketches:
`.planning/sketches/098-calendar-quant-overlay/` (`month-overlay.html`, `connections.html`).

#### The structural idea

A calendar is the only surface in this product that draws the past and the future in one
grid. The design makes that the subject rather than hiding it. **Left of today a cell holds
what the ledger recorded; right of today it holds a forecast that names its issuer and its
issue time; when a day passes the cell keeps both and states the error.** That is what
converts DESIGN-FOUNDATION §6's standing objection — *"Weather-driven forecasting on the
grid — a guess on a page whose virtue is that everything is a fact"* — from a veto into a
constraint: a published meteorological forecast, attributed, is a citable observation
about the future; *our* covers number derived from it and shown without its error is the
thing §6 actually forbids, and it is the last slice, not the first.

#### What each signal is, and what production actually holds

Measured against the live database on 2026-09-03, not inferred.

| Signal | Source + maths | Schema today | Honest state when absent |
|---|---|---|---|
| **Weather** | Open-Meteo `/v1/forecast` (no key, hourly + daily, 16 days, `timezone`, `past_days` — <https://open-meteo.com/en/docs>); NWS `api.weather.gov` as the keyless US fallback, OpenWeather as the keyed global one. **No maths — transcription**, stamped with issuer, issue time and horizon, and kept so a day can be scored later | `restaurants.latitude` / `.longitude` exist (`20260807001252_distributor_geo_foundation.sql:50-51`) and are **populated on 0 of 14 rows**. 13 carry `address`, 14 carry `timezone`, `google_place_id` exists | "No location set for this house" + the control that sets one. Never a default city. Provider down ⇒ the last reading with its age |
| **Covers** | `holtWintersAdditive(series, 7, …)` (`analytics/engine/forecasting.ts:120`, live at `insights/insight-generator.service.ts:699`) for level/trend/weekday, weather as a **ridge regressor on the residual** via `multipleRegression(X, y, {ridgeLambda})` (`analytics/engine/regression.ts:47`). Temperature as deviation-from-norm plus its square, precipitation as `log(1+mm)` — the effect is non-linear and saturating. Selected on pinball loss at τ = the critical ratio, **never MAPE/MASE** (ADR 0048) | `pos_checks.covers integer` (`baseline:4202`). **173 rows, 129 with covers, 26 distinct days — 22 of them one restaurant.** `holtWintersAdditive` refuses below `2 * period` (`:136`), so 22 points *runs* and means nothing; a weather coefficient is not estimable at all | **Withheld below 90 observed service days**, with "22 of 90" on the face of the cell. The weather term withheld separately below 180. A model that cannot beat `seasonalNaive` on RMSSE is not drawn |
| **Price** | Trailing 30-day median per `(item, vendor)`; a move reported only where ≥5 observations back it | `vendor_price_observations` (`20260805154027_…:50`) — table, five indexes, RLS. **0 rows** | A **dashed** mark reading "no quote". Never a calm mark, never "flat" — the difference between *stable* and *unobserved* is the whole ADR 0020 fault |
| **Delivery risk** | p50 / p90 of `delivered_at − expected_delivery_date` over the last 30 completed orders per vendor; a public road/weather advisory for the corridor. **<8 completed runs ⇒ a count, never a percentile** | `procurement_orders.expected_delivery_date` / `.delivered_at` (`baseline:4533-4534`) — **2 orders, 0 with either date**. `providers.lead_time_days` set on 11 of 21, and **4 of those are exactly 7, the column DEFAULT** (`baseline:4864`) | Two states that must never collapse: "stated 7 days — the column default, not measured" and "no completed run". Production is the second, on every vendor |
| **Quality at the door** | **No score.** Three facts side by side: the forecast temperature at the delivery hour, the cold-holding line (FDA Food Code 3-501.16 — TCS at 41 °F/5 °C or below, 4-hour limit without control under 3-501.19, <https://www.fda.gov/media/127796/download>), and this vendor's refusal history | `procurement_receipt_events.outcome` / `.refusal_reason` (`accepted\|short\|refused`, `wrong_wine\|broken_case\|temperature\|other` — `20260901220000_door_facts_are_columns.sql:125`). **No shelf-life column anywhere in 88 migrations**; `storage_locations.temperature_min/max` is a zone spec, not a reading | The mark shows the forecast temperature and the door history and nothing else, and says in one line that a spoilage *score* needs `shelf_life_days` on the item first |
| **Deadlines** | Nothing computed. Every dated row projected onto the day it falls on, carrying the table it came from and whether the term was *stated* or *inferred from N orders* | `calendar_events` 19 rows ✅ · `recurring_orders.next_order_date` exists, **0 rows** · `team_certifications.expires_at` + `idx_team_certs_expiry` exist (`baseline:5609`, `:11390`), **0 rows** · `vendor_promotions` / `provider_promotions` **0 rows** · `procurement_documents` **0 rows and no `due_date` column** · **no vendor cutoff column exists anywhere** | A cutoff nobody stated and no order implies appears as "no order window recorded for this vendor" plus the control that records one — never as a guess |

**Why weather is defensible at all.** Badorf & Hoberg, *The impact of daily weather on
retail sales*, J. Retailing & Consumer Services **52** (2020), 673 stores: weather moves
daily sales **up to 23.1% by store location and 40.7% by sales theme**, the effect is
**non-linear**, and weather forecasts improve sales-forecast accuracy **up to seven days
ahead with the improvement diminishing by horizon**
(<https://www.sciencedirect.com/science/article/abs/pii/S0969698919303236>) — which is why
the forecast's weight decays across the month rather than being drawn identically on day 2
and day 14. Bujisic, Bogicevic & Parsa, *The effect of weather factors on restaurant
sales*, J. Foodservice Business Research **20**(3) (2017) 350-370, tested 17 factors and
found the effect differs by menu item and by daypart, lunch being the most
temperature-sensitive
(<https://www.tandfonline.com/doi/abs/10.1080/15378020.2016.1209723>). The field already
does this: 7shifts shows the local forecast beside projected labour while a manager builds
a schedule (<https://kb.7shifts.com/hc/en-us/articles/14620377028627-7shifts-Sales-Forecast>);
Tenzo says the effect is about *extremes*, with rain saturating past a point
(<https://www.gotenzo.com/resources/insight/how-does-weather-affect-restaurant-sales/>).

**The licence trap, which is the real fork.** Open-Meteo's keyless tier is **CC-BY 4.0 and
explicitly non-commercial** — 300,000 calls/month, and "websites or apps that have
subscriptions" are named as commercial use (<https://open-meteo.com/en/terms>). A
commercial Mudavym needs API Standard, ~$29/month for 1M calls
(<https://open-meteo.com/en/pricing>). At one coordinate per house refreshed hourly, 14
houses is ~10k calls/month, so **cost is never the constraint; the licence is.** The
genuinely free alternative, NWS `api.weather.gov`, is open data for any purpose with no key
(only a descriptive `User-Agent`) and serves `/points/{lat},{lon}` plus `/alerts/active` —
but it is **United States only** (<https://www.weather.gov/documentation/services-web-api>).
Design answer: a `WeatherProvider` interface with three implementations selected by
environment, and the row states which issuer answered.

#### External connections — what exists, and the four directions

**What exists, measured.** `GET /api/v1/integrations/oauth/catalog` against the local
gateway on 2026-09-03 returns both connectors with `"available": false,
"unavailableReason": "Google OAuth is not configured on this deployment."`, and
`integration_oauth_connections` has **0 rows in production** — exactly what
`20260826170000_integration_oauth_tables.sql` predicted. The apparatus itself is complete:
encrypted tokens, a CSRF state row, a scope-disclosure screen at `/authorize/:integrationId`
(`App.tsx:285`), and an `availability()` gate that refuses to offer an unconfigured
connector (`integrations-oauth.service.ts:88-118`). **`provider` is CHECKed to
`('google','microsoft')` but `integration_id` is a free `VARCHAR(64)`, so a
`google_calendar` connector is a row in `INTEGRATION_DEFINITIONS`
(`integrations-oauth.constants.ts:33`) and needs no migration.** The web app has a Google
Sign-In client id (`VITE_GOOGLE_CLIENT_ID`, `lib/googleIdentity.ts:74`); the gateway's
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` pair is unset on this checkout — a different
credential shape, and it needs a registered redirect URI the sign-in flow never needed.

Four directions, in the order ADR 0111 recommends building them:

1. **Push** — Mudavym entries into a Mudavym-owned *secondary* calendar. Scope
   `calendar.app.created`, Google's narrowest
   (<https://developers.google.com/workspace/calendar/api/auth>). One mapping table, one
   write per mutation, no sync token, no webhook. Duplicates closed by an idempotency key
   and by updating the provider's own event id rather than searching. Only we can delete;
   a copy deleted in Google returns on the next push, **and the row says so before the
   operator connects**. This is also the only way a Google Meet link can exist —
   `conferenceData.createRequest` with `conferenceDataVersion=1`
   (<https://developers.google.com/workspace/calendar/api/guides/create-events>).
2. **Pull** — external events into a **read-only lane** of the day, drawn with the account
   they came from and never as a ribbon in the delivery spine. `syncToken` incremental sync;
   deletions arrive explicitly; `410 GONE` ⇒ discard and full-sync
   (<https://developers.google.com/workspace/calendar/api/guides/sync>). Watch channels are
   an optimisation over polling and never the only path: HTTPS with a valid certificate, no
   auto-renewal, and Google states plainly that notifications are not 100% reliable
   (<https://developers.google.com/workspace/calendar/api/guides/push>). Quota is not a
   constraint — 10,000 req/min per project, 600 per user
   (<https://developers.google.com/workspace/calendar/api/guides/quota>).
3. **Two-way** — the only direction that can lose data. **Last writer wins per field**
   (our `updated_at` vs their `etag`), **a delete never wins silently** (delete-vs-edit ⇒
   the delete is refused, the entry is marked disputed and goes to the day's conflict line),
   the loser is kept as a note, and the echo is closed by stamping every outbound write with
   our own request id and ignoring an inbound change whose `etag` we produced.
4. **Expose** — the day-book as the Mudavym MCP server's **first shipped tools**:
   `calendar.read_day`, `calendar.list_deadlines`, `calendar.propose_entry`, per
   `08-softwares/mudavym-mcp.md`'s rule *"it reads freely and it commits nothing"*. No send
   verb is implemented, so there is nothing to refuse at runtime — the same structural
   choice ADR 0107 made by shipping the handshake without `tools/call`. CalDAV (RFC 4791) is
   out of scope: it is a WebDAV server to build, not an API to call
   (<https://datatracker.ietf.org/doc/html/rfc4791>).

#### The ⌘K assistant, and the line it may not cross

The machinery is built and proven: `POST /ask-ai/propose` → a human looks →
`POST /ask-ai/confirm` → execute, with a validated allowlist, grounding against candidate
ids, and a `proposed → confirmed → executed | failed | discarded` lifecycle
(`ask-ai.service.ts:305,525,653,700`). The web client's own header states the rule — *"this
module never executes anything by itself"* (`services/api/askAi.ts`). The allowlist is two
families today, and widening it is stated in the code as a founder decision.

A third family, `calendar`, split by exactly [[0013-one-commitment-guardrail|ADR 0013]]'s
test — *does this leave the house?*

- **May act alone** (reversible, in-house, written to the settings ledger with the utterance
  that asked for it): create · move · resize · annotate an entry; set or clear a reminder;
  write a day note; exclude a day from the baselines; draft an in-house notification.
- **May never act alone**, each a proposal under the hold-to-approve seal: mail or message a
  vendor; place or amend an order; **push an entry to a connected external calendar other
  people read**; invite an outside attendee; create a Meet link that generates invitations.
  The third is the one this research adds to ADR 0013's surface, and it is not obvious: a
  push is a write to someone else's system that other humans see, which is the same class of
  act as sending mail.

MCP's own specification reaches the same place from the other side — clients **SHOULD**
prompt for confirmation on sensitive operations and show tool inputs before the call
(<https://modelcontextprotocol.io/specification/2025-06-18/server/tools>). Mudavym does not
rely on the client for that; the server-side allowlist is the gate.

#### What this research recommends be built first

Nine slices, in [[0111-the-calendar-is-the-houses-day-book|ADR 0111]] §6.
The head of the list: **(1) the coordinate**, **(2) the weather overlay**, **(3) past cells
holding the record and stating the forecast error**. Weather is first because it is the only
signal that needs nothing from the tenant but a location, produces a real number for every
house on day one, and — through slice 3 — is what accumulates the history slice 9's covers
model cannot honestly exist without. The covers overlay is **time-gated, not effort-gated**;
it may sit unbuilt for three months after slice 2 ships, and the page should say which day of
ninety it is on.


### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/calendar`** — The entry sheet is built and says a failed save in words. The meeting-note prompt is owed as a panel; the ⌘K day-book assistant (ADR 0111) is planned as a panel.

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/calendar` | The entry | sheet | Built | One entry is one object; the month stays readable beneath. | `pages/calendar/next/EventSheet.tsx:230` |
| `/calendar` | A note from this meeting? | panel | Owed | A question asked once, after the meeting ends (ADR 0111 unifies meetings, notes and reminders). | `pages/calendar/MeetingMemoPrompt.tsx:109` |
| `/calendar` | Ask the day-book | panel | Target | A question — the palette's shape, scoped to one page. | `sketch 098 · ADR 0111 (planned, not built)` |
| `/calendar` | Event modal | — | Retires | The entry sheet. | `pages/calendar/EventModal.tsx:1511 (1,593 lines)` |
| `/calendar` | Mobile sidebar scrim | — | Not a shape | Paint only — not a shape. | `pages/calendar/CalendarPage.tsx:597` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

### Overlays decided (2026-09-06)

| Overlay | Shape | Contract sentence | Four states, denied included | Ceremony, under the authority rule | Phone form | Motion | Status |
|---|---|---|---|---|---|---|---|
| The entry | sheet 440, scrim off | "One entry in the day-book. Keeping it writes the entry; removing it takes it off the book. Leaving writes nothing." | ***the model refusal in the whole census***, drawn and kept verbatim: "Not saved — The gateway refused the dates: 'Ends' is before 'Starts'. The entry is unchanged." · *denied* "You can see this, but only an owner or a manager may change the day-book. Ask {name}." | delete keeps the seal — see §1c | half detent | `tuck` 300, 28 px | **built** — `pages/calendar/next/EventSheet.tsx:230` |
| A note from this meeting? | panel 620 | "The meeting has ended. Saving files a note under this vendor; Later asks again tomorrow; Skip writes nothing and does not ask again." | *error* "The note was not saved. Nothing was filed." | plain. **Its three answers are right and rare** — most products offer two and silently treat dismissal as "never" | half detent | `settle` 320 | **built** — packet 2 `e0fb3a98` |
| Ask the day-book | panel 620 | "Ask the day-book in words. It proposes; nothing moves until you hold. Leaving does nothing." | *error* "The day-book could not be read. Nothing was proposed and nothing moved." | the hold, on the proposal | half detent | **instant** — it opens from the keyboard and is one of the four always-instant surfaces | target |

**Row 70's `alert` wording is the pattern the other 56 live rows copy** — the thing, the verb that
did not happen, and "It is unchanged", then the server's own sentence. Packet 0's `Refused`
component is that pattern made reusable. **"Ask the day-book" must carry the count** the drawing
lacks: "It would change one entry and draft one letter." A proposal that does not state its blast
radius is asking for a signature on a blank page.

## 1c. Motions decided (2026-09-06)

| Act | Today (`file:line`) | Decided | Rejected, and why it loses | Status |
|---|---|---|---|---|
| Opening line | `{ easing: settle.easing, ms: 420 }` — `pages/calendar/next/CalendarNext.tsx:212` | `settle` **320**. Delete the literal | mint an eighth token — see `/reports` | owed to **packet 3** |
| Magnification change (Month, Week, Day, Agenda) | `cn-turn` `turn` 420, 8 px | keep — the canonical use of `turn` | (a) a horizontal slide — implies adjacent pages; (b) a cross-fade — implies the same view with new data | no change |
| The day ledger opens | `settle` 320 on `0fr to 1fr` | keep | — | no change |
| The event sheet arrives | the primitive's `tuck` 300, 28 px | keep | — | no change |
| Drag or resize a block | **un-eased live `pointermove`**; `transition: none` while the finger is down | keep | (a) ease between 15-minute snaps — would draw a time the operator never chose; (b) a magnetic snap with `tuck` during the drag — the same objection | no change |
| Drop | `cn-drop-tuck` `tuck` 300 into the committed top and height | keep — the founder's own reading: it follows the finger and tucks into place with the weight of a real object | — | no change |
| **Delete an entry** | `pour` 620 to `stamp` 360 | **keep the wax.** Under the mechanical ration rule's second clause — an act that is irreversible in this house and has no server to ask — a deleted day-book entry qualifies today, because nothing puts it back | (a) demote it to a dry emboss on the grounds that deleting commits nothing to another party — that is the *counter-party* rule, which is one of the three rules being retired, and applying the mechanical rule while demoting this act is inconsistent with keeping `/team`'s two destructive acts sealed by the same clause; (b) a plain button — too cheap for something with no undo | no change; **the founder's fork is whether a day-book entry instead joins F10's undo-after list, in which case it drops to a plain control** |
| Month change | instant, no slide, no stagger | keep | copy the dashboard's `cal-arrive` stagger — the dashboard earns it because each cell carries an arriving figure; a schedule does not | no change |
| Weather and covers | drawn, never animated | keep — "a forecast does not arrive" | — | no change |
| Reminder run counts | never tally | keep — counts of record | — | no change |
| Import style | `TimeGrid.tsx:21` imports the token from `'../../../lib/mudavym/motion'` while the rest of the page uses the `@/lib/mudavym` barrel | make it one import path. Not a behavioural bug; it is the kind of inconsistency the motion guard should be able to see | leave it | owed to **packet 3** |
| Reduced motion | 4 CSS mentions, with the intent documented in `calendar/next/MOTIONS.md:45` | keep, and extend to the arriving-surface cross-fade | — | owed to **packet 3** |

## 2. Entry

- Sidebar "Calendar" (`components/layout/Sidebar.tsx:108`).
- From `/` ([PAGE_MAP](../foundation/PAGE_MAP.md):61; in-degree 1, :147).
- Command palette `g c` plus "Add calendar event" which deep-links
  `/calendar?openModal=true` (`components/command/commands.ts:63,79,93`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:274` (lazy import :99).
- `apps/web/src/pages/CalendarModular.tsx` (26-line wrapper: Header + bounded-height
  flex column, :11-12).
- Tree: `pages/calendar/{CalendarPage.tsx, useCalendarPage.ts, CalendarMonth/Week/Day/Agenda.tsx, CalendarSidebar.tsx, EventCard.tsx, EventModal.tsx, MeetingMemoPrompt.tsx, DragDropProvider.tsx, index.tsx}`.

## 4. Endpoints

Atlas row: [ENDPOINTS](../foundation/ENDPOINTS.md):87 (`calendar`, 19); providers
via :461.

| Method | Path | Call site |
|---|---|---|
| GET | `/calendar/events` | `useCalendarEvents` (`pages/calendar/useCalendarPage.ts:68`) → `services/api/calendar.ts:221` |
| POST | `/calendar/events` | `useCreateCalendarEvent` (`CalendarPage.tsx:114`) → `calendar.ts:237` |
| PATCH | `/calendar/events/:id` (+ `/status`, `/recurring`) | `CalendarPage.tsx:115` → `calendar.ts:265,338,381` |
| DELETE | `/calendar/events/:id` (+ `/recurring?fromDate=`) | `CalendarPage.tsx:116` → `calendar.ts:273,398` |
| GET/POST/PATCH/DELETE | `/calendar/event-types` | `useEventTypes` (`useCalendarPage.ts:2`) → `calendar.ts:293-328` |
| GET | `/calendar/reminders/status` | `useCalendarNextData` (`pages/calendar/next/useCalendarNextData.ts` `reminderQ`) → `calendar.controller.ts` route `reminders/status`; built by `calendar-reminders.service.ts` `statusFor` |
| GET | `/providers` | `useProviders` (`useCalendarPage.ts:2`) → `services/api/providers.ts:201` |
| GET | `/calendar/weather?from&to` | `useCalendarNextData` (`weatherQ`) → `calendar.controller.ts` route `weather`; built by `weather/weather.service.ts` `windowFor`. **Added 2026-09-03, ADR 0111 slice 2** |
| GET | `/calendar/day-record?from&to` | `useCalendarNextData` (`recordQ`) → `calendar.controller.ts` route `day-record`; built by `calendar/day-record.service.ts`. **Added 2026-09-03, ADR 0111 slice 3**; from 2026-09-04 each day also carries `observed`, `forecastErrorC` and `scoreWithheld` |
| GET | `/calendar/ical-token` | Settings; now answers `absoluteFeedUrl`, `webcalUrl` and `originSource` beside the relative `feedUrl` |

## 5. Signals

**None.** No tracking or `data-ux-key` in the tree; reporter dark
(`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** — operate. Delivery scheduling is S02 adjacent
([TIER-MAP](../03-scenarios/TIER-MAP.md):38); no scenario names the calendar as its
spine — it is shared operating furniture.

## 7. Rebrand surface

**0 user-visible strings.** The only `wineops` hit is the sidebar-collapse
localStorage key `'wineops-calendar-sidebar'` (`pages/calendar/CalendarPage.tsx:46`)
— invisible. Layout chrome per dashboard.md §7.

## 8. State & config

- Sidebar collapse persists in localStorage (`CalendarPage.tsx:46`).
- `?openModal=true` deep link opens the create modal (`commands.ts:93`).
- Recurrence expanded client-side (`lib/calendar/recurrence.ts`, `useCalendarPage.ts:4`).
- **Server-side reminders have their own switch, and it is not the design flag.**
  `CALENDAR_REMINDERS_ENABLED` (env, allow-list: only `true`/`1` arm it) — off by default,
  so the cron returns before it reads a row. The Mudavym flag gates only the *rendering* of
  the job's status. Once armed, which restaurants it serves is ADR 0022's question: one row
  in `restaurant_feature_flags` (`flag_name = 'scheduled_communications'`, `enabled = true`)
  or being `DEFAULT_RESTAURANT_ID`. **Measured against production on 2026-09-03:**
  `served: true, armed: false, pending: 0` — Meyhouse would be served, nothing is armed, and
  no entry currently qualifies, so arming it today sends nothing retroactively.
- **Mudavym redesign gate:** feature flag `mudavym_design_calendar` (gateway
  `feature-flag-registry.ts`), with the per-browser override
  `localStorage['mudavym.design.calendar']` = `1|true|on` / `0|false|off`
  (`lib/mudavym/useMudavymDesign.ts`). Off ⇒ `CalendarModular` renders byte-for-byte.
- The rebuilt page keeps no sidebar, so `localStorage['wineops-calendar-sidebar']` is read
  only by the legacy tree.
- **The weather overlay has no switch of its own, and that is deliberate.** It reads
  `restaurants.latitude`/`.longitude`; a house without a point gets the sentence rather than
  the overlay, so there is nothing to turn off. The issuer is chosen in code
  (`NwsWeatherProvider`), and `NWS_USER_AGENT` optionally overrides the contact string NWS's
  terms ask callers to send. **No API key exists or is needed** — NWS is open data.
- **The refresh is on read with a 60-minute max age** (`weather/weather.service.ts`). A
  reader who opens the calendar twice in an hour causes one issuer call, not two.
- **From 2026-09-04 it also runs hourly on a schedule**
  (`weather/weather-prefetch.service.ts`, cron `0 * * * *`), for every restaurant carrying a
  coordinate, so a house nobody opens still accumulates history. Switch:
  `WEATHER_PREFETCH_ENABLED` — default **on**, the opposite of
  `CALENDAR_REMINDERS_ENABLED`, because this one sends nothing to anybody. It skips a house
  whose reading is still fresh (delegated to `windowFor`, so the cron and the page cannot
  disagree about what fresh means), walks houses one at a time with a pause, and never lets
  one house's failure stop the sweep.

### §13 slices 20-22, restated as built (2026-09-03)

Items 20, 21 and 22 below are **done**; item 30's two fixes are done and so are the two
further suspects it did not name. What follows them (23-29) is untouched.

## 9. Gaps

**Provenance of the populated captures (added 2026-09-04).** The two `calendar-sky-*.png`
shots in the capture set are **not a live tenant**: no production restaurant carries a
coordinate (0 of 14, measured 2026-09-03), so `GET /calendar/weather` and
`GET /calendar/day-record` were intercepted in the browser and answered from the checked-in
NWS fixture (`apps/api-gateway/src/weather/__fixtures__/nws-forecast-palo-alto.json`, folded
through the real `foldPeriodsToDays`) by `scratchpad/shoot-calendar-sky.mjs:94-106`. They show
what the overlay renders when a house has a point, not what any house renders today. The two
unlabelled captures (`calendar-paper.png`, `calendar-charcoal-charcoal.png`) are live, with no
interception.

- ~~**Two calendars are routed**~~ — **closed 2026-08-26.** `/calendar-classic` is
  retired (route, `pages/Calendar.tsx`, `NewEventTypeModal`, `EntityAutocomplete`
  deleted); this is the only calendar. Its one blocking exclusive — reminders that
  actually fire — was ported here first (§10). ADR 0019 §B-parity records the check.
- **`?new=` seeds three fields, not the whole entry.** The hand-over carries title, type
  and note only. Start and end time, vendor link, repeat rule and reminder days are left
  at the sheet's defaults, because `/recommendations` has no measured value for any of
  them and inventing one is the fault ADR 0020 names. Nothing is written until the
  manager saves (`CalendarNext.tsx:66-106`, `EventSheet.tsx:112-115,134`).
- Phase 30 iCal feed "code scored 10/10 but no external calendar client has ever
  confirmed the feed subscribes" (`v3.0-TECH-DEBT.md:243-245`); the subscribe UI
  lives in Settings and Dashboard, but the untested feed serves this page's data.

### Found while rebuilding the page, 2026-09-02 — all OUTSIDE `pages/calendar/next/**`

Measured against the local gateway running on this branch, pointed at the production
Supabase project (dev-bypass session, `demo@gmail.com`, Meyhouse Palo Alto). Each one is a
one-file change nobody on this page's paths may make:

1. ✅ **CLOSED 2026-09-03 — `?limit=` on `GET /calendar/events` no longer 400s.**
   Was: `GetCalendarEventsQueryDto.page`/`.limit` were `@IsInt()` with **no**
   `@Type(() => Number)`, and the global `ValidationPipe` runs `transform: true`
   **without** `enableImplicitConversion` (`apps/api-gateway/src/main.ts:51-57`), so a
   query string stayed a string and failed the check — every caller was stuck on the
   server's 100-row default (`calendar.service.ts:277`), and the legacy page, which never
   reads `hasMore`, truncated a busy month in silence.
   Fixed at `apps/api-gateway/src/calendar/dto/calendar.dto.ts:328-359`: `@Type(() =>
   Number)` on `page` and `limit`, plus an explicit `@Transform` on the sibling
   `includeRecurring` (`@Type(() => Boolean)` would be wrong — `Boolean("false")` is
   `true`; the transform maps only the two boolean literals and leaves anything else for
   `@IsBoolean()` to reject). Guarded by
   `apps/api-gateway/src/calendar/dto/calendar-query.dto.spec.ts` (10 cases, driving a
   `ValidationPipe` configured exactly as the global one).
   Verified live against the local gateway on :4000, 2026-09-03:
   `?limit=50` → 200 `"limit":50`, `?limit=500` → 200 `"limit":500`, `?limit=abc` → 400
   (`limit must be an integer number`), `?limit=501` → 400 (`must not be greater than
   500`).
   The rebuilt page now requests the page maximum —
   `apps/web/src/pages/calendar/next/useCalendarNextData.ts:108` (`EVENT_WINDOW_LIMIT =
   500`) and `:253` (the query string). Still honest above 500: `@Max(500)` caps the page,
   so the page keeps rendering the server's `hasMore` rather than silently paginating.
2. 🔴 **Production rows carry values the gateway's own enums do not contain** —
   `event_type: 'audit'` and `status: 'active'` were measured on live `calendar_events`
   rows, neither of which is in `CalendarEventType` / `CalendarEventStatus`
   (`calendar.dto.ts:36-59`). `PATCH` validates both with `@IsEnum`, so **any edit that
   echoes the stored value back is refused**, and any UI that coerces it into the enum
   rewrites the tenant's record. The rebuilt sheet refuses to send an untouched
   out-of-enum value; the *fix* is to widen the enums or migrate the rows.
3. 🟠 **`UpdateCalendarEventDto` has no `providerId`, `orderId` or `recurrence`**
   (`calendar.dto.ts:229-296`), and the pipe runs `forbidNonWhitelisted` — so a vendor
   link and a repeat rule can be written at create time and never changed. The legacy page
   hides this by simply dropping the fields (§10); the rebuilt sheet says it.
4. 🟠 **`mapApiEvent` drops half the row** (`services/api/calendar.ts:64-82`): no
   `eventTimeEnd`, `eventDateEnd`, `orderId`, `source`, `reminderEnabled`,
   `reminderDaysBefore`. A calendar that cannot read an end time cannot draw or resize one.
   The rebuilt page carries its own mapper; the shared one still needs fixing for every
   other caller.
5. 🟠 **`getEventTypes` reports absence as health** — when the `calendar_event_types` query
   errors it returns the eight built-ins (`calendar.service.ts:858-885`), so no client can
   tell "this tenant has no custom types" from "the table was unreachable". Exactly the
   ADR 0020 shape.
6. 🟡 **`EventTypeResponseDto` returns `isDefault`; the web type expects `isCustom`**
   (`services/api/calendar.ts:167-174`) — always `undefined`, so every type reads as
   non-custom to the legacy sidebar.
7. 🟡 **`?date=today` becomes an Invalid Date.** `quickActions.ts:81` and
   `Dashboard.tsx:778` link to `/calendar?openModal=true&date=today`;
   `CalendarPage.tsx:236` does `new Date(dateStr)` on it. The rebuilt page handles the
   literal; the legacy one still does not.
8. 🟡 **Four `services/api/calendar.ts` functions call routes that do not exist** —
   `createRecurringEvents` (`POST /calendar/events/recurring`, `:360`),
   `updateRecurringEventOccurrence` (`PATCH /calendar/events/:id/occurrence`, `:376`),
   `fetchEventsByProvider` (`GET /calendar/events/provider/:providerId`, `:347`) and
   `checkEventConflicts` (`GET /calendar/events/conflicts`, `:420` — which the router
   resolves to `events/:eventId`). Compare the controller's route list,
   `calendar.controller.ts:55-629`. Dead on arrival; the missing per-occurrence route is
   why an occurrence is not draggable in the rebuilt page.
9. 🟡 **`scripts/check_no_seeded_defaults.py` does not scan the rebuilt surface.**
   `SCAN_ROOTS` (`:187-197`) has no `apps/web/src/pages/calendar/next` entry, so CI's ADR
   0051 guard is green over this page without looking at it. Verified passing locally by
   running the guard with that root substituted (0 violations); the line still needs adding.

### Found while building the server-side reminder job, 2026-09-03

1. 🟠 **The legacy browser scheduler is still booted for everyone.**
   `apps/web/src/main.tsx:20` calls `startReminderScheduler()`
   unconditionally, so the localStorage poller runs whether or not the Mudavym
   flag is on. It is demoted rather than removed because `main.tsx` is shared and
   the shipping page must render byte-for-byte with the flag off (ADR 0109).
   **The residue:** an entry created on the *legacy* page, never opened in the
   rebuilt sheet, whose reminder is due, can fire twice — once from that browser
   and once from the cron. Every path the redesign touches is closed: nothing in
   `pages/calendar/next/**` enqueues, and `EventSheet.tsx` `clearBrowserQueue`
   cancels an entry's browser-queued copies on save. **Why not yet:** deleting the
   boot is one line, but it belongs to whoever retires the legacy calendar — doing
   it here would change the shipping page's behaviour from inside a flagged build.
2. 🟠 **Quiet hours mean two different things in the two runtimes.** The
   orchestrator's `_is_quiet_hours` compares the window against `datetime.now()`
   — the *process's* local time
   (`services/agent-orchestrator/agents/notification_agent.py:1487-1512`), so a
   22:00–08:00 window means 22:00 wherever the container runs. The new gateway
   job evaluates the same three columns on the *restaurant's* clock
   (`calendar/reminder-window.ts`). The gateway's reading is the correct one for a
   house in Istanbul; the two should be reconciled, and the orchestrator is
   outside this page's paths.
   **They also disagree at the boundary, which was undisclosed until now:** the
   gateway treats the window as half-open `[start, end)` — quiet at `start`, awake
   at `end`, and `start === end` never quiet
   (`calendar/reminder-window.ts` `isWithinQuietHours`); the orchestrator uses a
   closed interval, `start <= now <= end` (`notification_agent.py:1498-1508`), so
   it is quiet at both ends and `start === end` is quiet for that instant. The
   gateway's reading is deliberate for a 15-minute cron — a window ending at a
   round `08:00` lands exactly on a tick, and the closed reading would hold that
   tick's reminders a further quarter-hour — and it is what makes "quiet" and
   "awake" exhaustive, which `deferred === 0` relies on before stamping
   `reminder_sent`. **Why not yet:** reconciling them is a Python change in a
   service this build does not own.
3. 🟡 **`notification_preferences` has no per-user timezone**, so "the reader's
   quiet hours" are necessarily read on the restaurant's clock, not the reader's.
   For a single-site house those are the same; for a manager travelling they are
   not. Stated on the row (the window is shown with the zone beside it) rather
   than silently assumed.
4. 🟡 **`generation_horizon_days: 90` is a gateway-written measurement.**
   `calendar.service.ts:496` writes a literal horizon onto every
   `calendar_recurrence_rules` row that no caller supplied. Measured by running
   `scripts/check_no_seeded_defaults.py` with `apps/api-gateway/src/calendar`
   added to `SERVER_SCAN_ROOTS`: 1 violation, exactly this line. Pre-existing and
   unrelated to reminders. **Why not yet:** changing it changes how far ahead
   recurring occurrences are generated, which is a behaviour decision, not a
   cleanup.
5. 🟡 **`apps/api-gateway/src/calendar` is not in `SERVER_SCAN_ROOTS`**
   (`scripts/check_no_seeded_defaults.py:220-223`), so CI's ADR 0051 guard is
   green over this module without reading it. Verified by hand with the root
   substituted (finding 4 is what it says); the line still needs adding, and
   `scripts/` is outside this build's paths.
6. ✅ **`apps/web/src/pages/calendar/next` IS now in `SCAN_ROOTS`**
   (`check_no_seeded_defaults.py:202`) — the §9.9 gap filed on 2026-09-02 is
   closed, and the guard passes over this directory having actually read it.


### Found while researching the quant overlay and the external connections, 2026-09-03

Measured against the live production database (project `exzueerziesmczwlhomd`) and the
local gateway on :4000. All of these are **outside** `pages/calendar/next/**`; each is the
reason a slice in §13 is where it is. Detail in §1b *Quant overlay* and
[[0111-the-calendar-is-the-houses-day-book|ADR 0111]].

1. ✅ **No restaurant has a coordinate** — **capture closed 2026-09-03; the 13 existing rows
   still need the script run.** `restaurants.latitude` / `.longitude` were added
   in `20260807001252_distributor_geo_foundation.sql:50-51` and are **NULL on all 14 rows**,
   while 13 carry an `address`, 14 carry a `timezone` and `google_place_id` exists. Every
   weather-derived signal on this page is blocked on one field nobody has ever filled.
   **Fixed:** the sign-up form already resolved the point in the same `fetchFields` call that
   fills the city and postcode (`components/ui/PlacesAutocomplete.tsx:248-260`) and dropped
   it; it is now carried through `Register.tsx` → `AuthContext` → `RegisterRestaurantDto` →
   `auth.service.ts` `coordinateColumns`, which writes both axes or neither and never a
   default. **Still open:** the 13 rows that signed up before today.
   `scripts/backfill_restaurant_coordinates.py` asks Google the same question keyed on
   `google_place_id`, with a dry run and a per-row report; it refuses to geocode a free-text
   address, so a row with no place id is *named* rather than filled, and its operator has to
   re-select the address. The parent runs it on the founder's word.
2. 🔴 **The covers series cannot support a weather model.** `pos_checks` holds 173 rows,
   129 with `covers`, across **26 distinct days — and 22 of those belong to one restaurant**
   (2026-08-03 → 2026-09-05). `holtWintersAdditive` refuses below `2 * period`
   (`analytics/engine/forecasting.ts:136`), so a weekly model *runs* on 22 points and means
   nothing, and a weather coefficient is not estimable at all. This is why §13.28 is
   time-gated rather than effort-gated.
3. 🟠 **Three of the six deadline classes have no data and one has no column.**
   `vendor_price_observations` 0 rows · `team_certifications` 0 rows (the table **and**
   `idx_team_certs_expiry` exist, purpose-built, `baseline:5609`, `:11390`) ·
   `recurring_orders` 0 rows · `provider_promotions` / `vendor_promotions` 0 rows ·
   `procurement_documents` **0 rows and no `due_date` column at all** (only `doc_date`) ·
   and **no vendor cutoff column exists anywhere in 88 migrations**.
4. 🟠 **A stated lead time may be a default nobody chose.** `providers.lead_time_days` is
   `integer DEFAULT 7` (`baseline:4864`), set on 11 of 21 providers — **4 of them exactly
   7**. Meanwhile `procurement_orders` has 2 rows with `expected_delivery_date` and
   `delivered_at` **null on both** (`baseline:4533-4534`), so no vendor has a measured
   distribution. Any UI drawing a lead time must say *stated*, *defaulted* or *measured*.
5. 🟠 **There is no shelf-life column and no temperature reading anywhere.** The only
   temperature fact the house records is `procurement_receipt_events.refusal_reason =
   'temperature'` (`20260901220000_door_facts_are_columns.sql:125`) — an outcome, not a
   measurement — and `storage_locations.temperature_min/max` (`baseline:5498-5499`) is a
   zone specification. A spoilage *score* would be invented arithmetic; a door *record* is
   real today.
6. ✅ **Four concrete suspects for the iCal feed nobody has seen subscribe** — **all four
   closed 2026-09-03** (§12 item 1 carries what shipped). They were, all one-line, all in
   this module: `Content-Disposition: attachment` (`calendar.controller.ts:647-650`)
   tells clients to save a file rather than subscribe; every event is built with
   `new Date('YYYY-MM-DDTHH:mm:00')`, which resolves on the **server's** clock rather than
   the restaurant's IANA zone (`calendar.service.ts:1287-1294`); no `X-PUBLISHED-TTL` /
   `REFRESH-INTERVAL` is emitted; and the token endpoint returns a **relative path** with no
   absolute origin and no `webcal://` alternative (`:666`). Settings.md §10 had already
   named the first; the other three are new.
7. 🟡 **The OAuth apparatus is complete and has never been used.**
   `GET /integrations/oauth/catalog` returns both connectors with
   `"available": false, "unavailableReason": "Google OAuth is not configured on this
   deployment."`, and `integration_oauth_connections` has **0 rows in production**. The web
   app has a Google Sign-In client id (`VITE_GOOGLE_CLIENT_ID`,
   `lib/googleIdentity.ts:74`); the gateway's `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   pair is a **different credential shape** and needs a registered redirect URI the sign-in
   flow never needed.
8. ✅ **Adding a calendar connector needs no migration.**
   `integration_oauth_connections.provider` is CHECKed to `('google','microsoft')` but
   `integration_id` is a free `VARCHAR(64)`
   (`20260826170000_integration_oauth_tables.sql`), so `google_calendar` is a row in
   `INTEGRATION_DEFINITIONS` (`integrations-oauth.constants.ts:33`).
9. 🟡 **`analytics_day_exclusions` does not exist in production.** The table that lets a
   manager rule a closure out of every baseline is on this branch only
   (`20260903091000_days_the_engine_must_not_count.sql`); a `select` against it on the live
   database returns `42P01`. The month grid's hatched "closed" cell depends on it.

### Found while building the weather overlay, 2026-09-03

Measured against the live NWS API and the local gateway on :4000. Each is **outside**
`pages/calendar/next/**`.

1. ✅ **The per-tenant scheduler cannot carry a read that every tenant needs** — **closed
   2026-09-04 by a dated amendment to ADR 0022**, which exempts exactly the weather
   prefetch's two NWS reads for coordinate-bearing houses and nothing else. Anything that
   reaches a person still goes through `runPerTenant`. The finding as measured:
   `ScheduledTenantsService.runPerTenant` serves only tenants with
   `restaurant_feature_flags.flag_name = 'scheduled_communications'` or matching
   `DEFAULT_RESTAURANT_ID` (`communications/scheduled-tenants.service.ts:88-125`) — **one of
   TEN in production**. *(Count corrected 2026-09-04. Every earlier statement of this
   finding — here, in calendar.md's §1b and §13, in ADR 0022 and in ADR 0111 — said
   "fourteen" and cited `:88-125` for it. That range is the `list()` query and holds no
   count of anything. The only measured, dated count in the tree is the service's own
   header: `communications/scheduled-tenants.service.ts:80-87`, "Verified against
   production on 2026-08-26: `restaurants` holds 10 rows … only ONE … is a real tenant".
   The finding's shape is unchanged and its force is slightly smaller: nine houses starved,
   not thirteen. Re-measuring against the live database was not done in this pass — the
   number quoted is the repo's own dated measurement, and it is nine days old.)* That is correct for a job that *sends* and wrong for one that
   *reads*, and ADR 0111 §6 had assumed the weather refresh could ride it. **Resolved:** the
   refresh is on-read AND on an hourly prefetch that iterates coordinate-bearing restaurants
   directly (`apps/api-gateway/src/weather/weather-prefetch.service.ts`).
2. 🟠 **`weather_readings` is not in production.** The migration
   `20260903162000_a_forecast_names_its_issuer.sql` is on this branch only; a select against
   the table on the live database will answer `42P01` until it merges. The endpoint never
   reaches it today because the no-coordinate branch fires first — which is honest, but it
   means the register read path is proved by tests and not yet by production.
3. ✅ **No temperature observation is recorded anywhere in the product** — **closed
   2026-09-04.** `weather_observations` (`20260904140000`) records the nearest station's
   measurements, so a forecast's error is now computable and is computed. What remains is
   the other half: no covers model exists, so the TRADING side of a day is still unscored.
   Measured live at KPAO on 2026-09-04: five local days, **precipitation null on all of
   them** — that station does not report rainfall, and `precipitation_total_mm` is nullable
   for exactly that reason.
4. 🟡 **`prediction_outcomes` has no unique constraint but its primary key**
   (`20260805000000_baseline_from_production.sql:7340-7344`). Slice 3's writer is therefore
   idempotent by read-then-insert rather than by upsert: adding a unique index would reach
   across a table `services/self-evolution/main.py` also writes. A concurrent double read of
   the same window can duplicate one pair; that is recoverable, and a unique index on a
   shared table is not.
5. 🟡 **`Intl.DateTimeFormat` resolves `PST`, `EST` and `US/Pacific`.** They are ICU aliases,
   not invalid identifiers, so any code validating an IANA zone by try/catch will accept
   them. Measured on this Node build; only genuinely unresolvable strings such as a
   human-readable `"Pacific Time"` throw.

## 10. Maturity

**partial.**

> *Verified against the working tree on 2026-08-26. A concurrent session on this
> branch changed `CalendarPage.tsx`/`EventModal.tsx` and added
> `lib/reminder-scheduler.ts` while this dossier was being written — the reminder
> findings below describe the **current** code, not the pre-change state.*

The event spine is real: create, read, update, delete, drag-move, resize, RRULE
recurrence and event types all reach JWT-guarded endpoints
(`apps/api-gateway/src/calendar/calendar.controller.ts:44-45`, routes :55-539) and
persist.

**Reminders are sent by the server as of 2026-09-03** ([ADR 0109](../decisions/0109-a-reminder-is-the-houses-job-not-the-browsers.md)).
`CalendarRemindersService` (`apps/api-gateway/src/calendar/calendar-reminders.service.ts`)
runs every 15 minutes under `ScheduledTenantsService.runPerTenant`, reads
`reminder_enabled` / `reminder_days_before`, claims one row per (entry, person) in
`calendar_reminder_dispatches` — whose UNIQUE `(calendar_event_id, user_id)` index is
what makes a double send impossible — writes the durable notification through
`NotificationsService.persistForRestaurant`
(`apps/api-gateway/src/notifications/notifications.service.ts:608-728`), and then stamps
`calendar_events.reminder_sent` / `.reminder_sent_at`. **That column had no writer anywhere
in `apps/` or `services/` until this build**; it was read once, at
`calendar/calendar.service.ts:1118`, and written nowhere.

What the previous paragraph said is still true of the *legacy* page: `syncEventReminders`
(`apps/web/src/pages/calendar/CalendarPage.tsx:64-84`) pushes into the `localStorage` queue
(`lib/reminder-scheduler.ts:9,82`) drained by the poller booted at `main.tsx:20`. That
scheduler is **demoted, not deleted** — see §9 finding 1 for the exact residue and why the
boot was left alone.

Still collected and discarded:

| Collected by | Dropped at | Consequence |
|---|---|---|
| Meeting memo — doc type, notes, labels (`MeetingMemoPrompt.tsx:94`) | `handleMemoSave = useCallback((_memo) => { /* Future: persist to documents API */ setMemoPromptOpen(false) }, [])` (`CalendarPage.tsx:307-310`) | The prompt fires *because* the event was labelled a vendor meeting, asks for notes, and closes. Nothing is stored. **The one remaining hollow surface on this page** |
| `email` reminder channel | The create-mode default is `channels: ['in_app','email']` (`EventModal.tsx:376`), the scheduler sends in-app + browser only (`reminder-scheduler.ts:176-200`), and reading an existing reminder back **hardcodes** `channels: ['in_app']` (`CalendarPage.tsx:335`) | Ticking "email" changes nothing, and the tick disappears on reopen |
| `labels` (`EventModal.tsx:522`) | Not forwarded to `createEvent`/`updateEvent` (`CalendarPage.tsx:252-292`); `buildCreatePayload` has no such field (`services/api/calendar.ts:105-121`) | Labels exist only long enough to trigger the memo prompt |
| `multiDay` / `eventDateEnd`, and `recurring` on **edit** | Absent from the update branch (`CalendarPage.tsx:253-270`); present on create (`:284`) | Editing a multi-day or recurring event silently flattens it |

The `custom_reminders` table that `@Cron("*/15 * * * *")` does fire
(`communications/scheduled-tasks.service.ts`) is a **different** table with
no UI anywhere in the web app — grep finds zero references outside the gateway and
its tests. It is **no longer gated on `DEFAULT_RESTAURANT_ID`**: as of 2026-08-26
(OD-87 / [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md)) it
runs per opted-in tenant and queries `custom_reminders` scoped to that tenant.
That fixed a real cross-tenant defect in passing — the query used to run once,
unfiltered, and then gate every row it found on the *default* restaurant's
inventory and mail the *default* restaurant's manager. The table is empty in
production (verified 2026-08-26), so nothing was ever misdelivered.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/calendar/events?startDate=&endDate=` | JWT (class, `calendar.controller.ts:45`) | `:94-119` | Events for the window |
| POST | `/calendar/events` | JWT | `:55-92` | Created event — **without** reminders/labels/location/attendees (never sent) |
| PATCH | `/calendar/events/:id` (+`/status`, `/recurring`) | JWT | `:152-187`, `:418-455`, `:457-499` | Updated event |
| DELETE | `/calendar/events/:id` (+`/recurring?fromDate=`) | JWT | `:189-229`, `:501-537` | 204 |
| GET/POST/PATCH/DELETE | `/calendar/event-types` | JWT | `:306-416` | Custom types |
| GET | `/providers` | JWT | `providers` module | Vendor picker |
| POST | `/notifications` | JWT (class, `notifications.controller.ts:45`) | `:61-82` | Durable row — the *legacy* browser scheduler's write path (`reminder-scheduler.ts:193`). The server job does not use it; it writes through `persistForRestaurant` directly |
| GET | `/calendar/reminders/status` | JWT (class) | `calendar.controller.ts`, route `reminders/status` | The reminder job's last run, next scheduled tick, whether this restaurant is served, and the reader's quiet window |
| GET | `/calendar/feed/:token.ics` | **`@Public()`** — bearer is the 64-char token in the path (`:586-587`) | `:596-606` | iCal text |

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Manually created events | This page and the command palette (`commands.ts:93`) | Yes |
| Provider/order-linked events | `calendar_agent` (`AgentTier.CORE`, `services/agent-orchestrator/core/agent_registry.py:83-87`); its LLM date extraction was repaired under ADR 0010 / OD-63 | Agent yes — but its output table `provider_important_dates` **does not exist in production** (OD-63 resolution, now **OD-68**), so the extracted dates have nowhere to land |
| Reminder firing | `calendar/calendar-reminders.service.ts` — `@Cron("*/15 * * * *")` under `runPerTenant` (ADR 0109) | **Yes, server-side.** Writes the inbox row via `persistForRestaurant`, stamps `reminder_sent` / `reminder_sent_at`, logs a `calendar_reminder_runs` row per tenant per sweep. `lib/reminder-scheduler.ts` is demoted to draining what the legacy page queued (§9.1) |
| Meeting memos | **none** | No |
| iCal subscribers | External calendar clients | **Never observed to work** (`v3.0-TECH-DEBT.md:243-245`) — see settings.md §10 for the concrete suspect |

### Writes

| Write | Downstream reaction |
|---|---|
| Event create/update/delete | `/team`'s ManagerShiftDesk overlays the same events (`ManagerShiftDesk.tsx:17`); `/documents-reports` subscribes to calendar realtime and toasts (`DocumentsPage.tsx:157-170`) |
| Reminder fire (server) | A durable `notifications` row for every intended member + socket emit + Expo push (`persistForRestaurant`), a `calendar_reminder_dispatches` claim row per (entry, person), and `calendar_events.reminder_sent` / `.reminder_sent_at` stamped |
| Event delete | Pending reminders for that event are cancelled first (`CalendarPage.tsx:313-315`) — correct, and easy to have missed |
| Sidebar collapse | `localStorage` `'wineops-calendar-sidebar'` (`CalendarPage.tsx:53`) |
| Labels / memo / email channel | **none** |

## 12. Design intent

**Should be:** the operating week — deliveries, tastings and vendor meetings — with
enough memory attached that the next conversation starts where the last one ended.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Yes | `useCalendarEvents` query state consumed in `useCalendarPage.ts:68` |
| Empty | Yes | Grid renders with no events; a legitimately quiet week |
| Error | **No** | No `isError` branch in the tree |
| Permission-denied | **No** | No 403 branch |

**Where the UI misleads**

1. ~~Reminders read as a property of the event; they are a property of the browser.~~
   **Fixed 2026-09-03** on the rebuilt page (ADR 0109): a reminder is now a property of the
   event, sent by a server cron, and the sheet shows the job's last run, next run and whether
   this restaurant is served. Still true of the legacy page.
2. The `email` channel toggle has no effect and does not survive a reopen
   (`CalendarPage.tsx:335`).
3. The meeting-memo prompt asks for notes it discards.
4. Editing a multi-day or recurring event quietly loses those properties.
5. The iCal copy in Settings promises Outlook/Apple/Google (`Settings.tsx:207`) for a
   feed nobody has seen subscribe.

### The remaining "honest abouts", and what a profound fix costs (2026-09-03)

The founder's fourth-pass note on this page: *"Fix all the issues in honest about,
bulletproof, profound SOTA is a must have quality."* An em dash is honest, not finished.
Every 🔒 and ⚫ still standing in §1a is listed here with **the fix that removes the reason
for the em dash**, not the one that hides it, and what that fix costs. Ordered by
cost-to-value, cheapest and most valuable first.

| # | Honest about | Why it is honest today | The profound fix | Cost |
|---|---|---|---|---|
| 1 | ~~**The iCal feed has never been seen to subscribe**~~ — **all four suspects closed 2026-09-03** | Nobody had ever tested it (`v3.0-TECH-DEBT.md:243-245`) | **Done.** `Content-Disposition` is now `inline` (a saved .ics imports once and never updates, which is the reported symptom exactly); every timed event is built in the **restaurant's** IANA zone via `calendar/zoned-time.ts` and published as an absolute instant, with a **floating** time — never a false UTC — where the zone is unresolvable; `X-PUBLISHED-TTL` + `REFRESH-INTERVAL` are emitted at one hour, on the empty answer too; and `/calendar/ical-token` returns `absoluteFeedUrl`, `webcalUrl` and `originSource` (`config` \| `request` \| `none`) so a caller can tell a configured origin from one inferred from its own Host header, and gets **null rather than an invented origin** when there is neither. 20 gateway tests. **What is still not proved: no human has yet subscribed a real Outlook/Apple/Google client** — the four format defects are closed, the human UAT is not | **XS, spent.** The single cheapest item on this page, and it is now the settings surface's turn to offer the `webcal://` link |
| 2 | **Vendor link and repeat rule are create-time only** | `UpdateCalendarEventDto` carries neither field and the pipe runs `forbidNonWhitelisted` (`calendar.dto.ts:229-296`) | Add `providerId`, `orderId` and `recurrence` to the update DTO, the mapper and one spec | **XS.** Mechanical; the sheet already renders the disabled state and would just stop needing it |
| 3 | **`getEventTypes` reports absence as health** | An errored `calendar_event_types` query returns the eight built-ins (`calendar.service.ts:858-885`), so "no custom types" and "the table was unreachable" are the same answer | Return a discriminated result — `{types, source: 'tenant' \| 'builtin', readable: boolean}` — and let the page say which. The rebuilt page already renders the honest branch if the shape appears | **S.** One service function, one DTO field, callers unchanged |
| 4 | **Production rows carry values the enums do not contain** | `event_type: 'audit'` and `status: 'active'` are live on `calendar_events`; `PATCH` validates both with `@IsEnum` (`calendar.dto.ts:36-59`), so any edit echoing the stored value is refused | Widen the enums to the values production actually holds, **then** migrate — measure first, because coercing into the enum rewrites the tenant's record | **S.** One DTO change plus a measured backfill. Blocked on nothing |
| 5 | **Reminder offsets are whole days only** | `reminder_days_before` is an `INTEGER` of days (`baseline:2358`), so the sheet offers *On the day / 1 / 2 / 7* and says why | Add `reminder_minutes_before`, the Create/Update DTO fields, the mapper, and one branch in `reminder-window.ts` `reminderDueAt`. The 15-minute cron then bounds the resolution honestly — "15 minutes before" is representable, "3 minutes before" is not, and the sheet should say the tick length rather than offer a granularity the scheduler cannot keep | **S.** One migration, four touch points, and a sentence about the tick |
| 6 | **A client-expanded recurring occurrence gets no reminder** | A series is one row; occurrences expanded in `lib/calendar/recurrence.ts` carry no id to key a dispatch on | Two paths, and they are not equivalent. **Cheaper:** add an occurrence key to `calendar_reminder_dispatches`' unique index so an occurrence can be claimed without existing as a row. **More honest:** materialise occurrences server-side at create time, which also gives the per-occurrence edit route §9.8 says is missing and makes an occurrence draggable | **M** cheap / **L** honest. The honest one closes three separate 🔒s at once and is the better buy |
| 7 | **A recurring occurrence is not draggable** | There is no per-occurrence route; `updateRecurringEventOccurrence` calls `PATCH /calendar/events/:id/occurrence`, which the controller does not serve (§9.8) | Falls out of #6's honest path. On its own it is the same server-side materialisation with a smaller payoff | **L**, or **free** after #6 |
| 8 | **The email reminder channel is rendered disabled** | The cron writes the inbox row and the push; mail needs a recipient policy, and `RecipientResolverService` still falls back to a global env address for the legacy tenant (`communications/scheduled-tasks.service.ts:120-146`) | Not a calendar fix. Give the resolver a per-restaurant recipient set with an explicit "no recipient" state, and let every sender read it. Mailing the wrong house is the defect ADR 0022 spent its length preventing | **M**, and it belongs to communications, not here |
| 9 | **The meeting-memo prompt is not built** | It asked for notes and discarded them (`CalendarPage.tsx:307-310`); `/documents-reports` has no upload path to persist them to | **Stop waiting on documents.** A note is a day's marginalia, not a document: give it `calendar_day_notes(restaurant_id, business_date, body, author, created_at)`. Conflating the two is what left the prompt writing into a void for a year | **S.** One migration, one panel. ADR 0111 slice 5 |
| 10 | **`labels` are collected and dropped** | Never forwarded to `createEvent`/`updateEvent`; `buildCreatePayload` has no such field (`services/api/calendar.ts:105-121`) | Either add the column and the DTO field, or **remove the input**. Both are honest; a field that looks like it saves is not. Recommend removal until something reads a label | **XS** either way |
| 11 | **The month above 500 entries reports `hasMore` instead of paginating** | `@Max(500)` caps the page; the rebuilt page surfaces `hasMore` rather than showing the first 100 silently | Real cursor pagination on `(start_date, id)`. Worth doing when a house exceeds 500 entries in a month, and no house is close | **M**, and correctly deferred |
| 12 | **Quiet hours are read on the restaurant's clock, not the reader's** | `notification_preferences` has no per-user timezone (§9.3) | Add one, defaulting to the restaurant's. Then reconcile the two runtimes: the orchestrator compares against the *process's* `datetime.now()` (`notification_agent.py:1487-1512`) on a **closed** interval, the gateway against the restaurant's clock on a **half-open** one | **M**, and half of it is a Python change this page does not own |
| 13 | **The legacy browser scheduler is still booted for everyone** | `main.tsx:20` calls `startReminderScheduler()` unconditionally; `main.tsx` is shared and the shipping page must render byte-for-byte with the flag off | Delete the boot when the legacy calendar is retired. Until then the residue is real: an entry created on the legacy page, never opened in the rebuilt sheet, can fire twice | **XS** to do, **blocked** on retiring the legacy page |
| 14 | **The reminder job is off, and says so** | `CALENDAR_REMINDERS_ENABLED` is unset; the page renders "built but not switched on" with the flag name | Not a defect and not an em dash to remove — it is a switch, and arming it is the founder's. Live status on production, 2026-09-03: `served: true, armed: false, pending: 0` | **Zero.** One environment variable |
| 15 | **`generation_horizon_days: 90` is a gateway-written measurement** | `calendar.service.ts:496` writes a literal horizon onto every recurrence rule no caller supplied (§9.4) | Take it from the caller, or from a restaurant setting, with the current value as the documented default rather than an invisible one. Also add `apps/api-gateway/src/calendar` to `SERVER_SCAN_ROOTS` so the ADR 0051 guard reads this module at all | **S**, plus one line in `scripts/` this build does not own |

**The pattern across all fifteen**, worth naming because it is the same one every time: the
cheap fixes (#1, #2, #10) are cheap because the honesty was doing the work of a missing
line of code, and the expensive ones (#6, #7, #12) are expensive because the honesty was
doing the work of a missing *model*. Only the second kind needed the em dash. The first
kind should not survive another pass.

## 13. Roadmap

### Motions and overlays — the rows this pass owes (2026-09-06)

From the decisions in §1c. Owner packets: **packet 3** the motion pass, **packet 4** the
states owed, **packet 5** the gestures; a *page pass* is this page's own next opening.
The reasoning is in §1c and in [ADR 0133](../decisions/0133-one-motion-per-act-across-every-page.md);
these are the rows.

1. `pages/calendar/next/CalendarNext.tsx:212` — delete `{ easing: settle.easing, ms: 420 }`, use the `settle` token (320). **packet 3**
2. `pages/calendar/next/TimeGrid.tsx:21` imports the token by relative path while the rest of the page uses the `@/lib/mudavym` barrel; one import path. **packet 3**
3. "Ask the day-book" must state its blast radius — "It would change one entry and draft one letter" — before the hold. *target*
4. **Founder fork:** the entry's delete keeps the wax under the ration rule's second clause. If a day-book entry instead joins F10's undo-after list it becomes reversible and drops to a plain control. See ADR 0133.

1. ~~**Move reminders server-side.**~~ — **done 2026-09-03**
   ([ADR 0109](../decisions/0109-a-reminder-is-the-houses-job-not-the-browsers.md)); see §1b
   third pass and §10. What remains of it is items 14-16 below.
2. **Honour or remove the `email` channel** (`EventModal.tsx:376`, `CalendarPage.tsx:335`).
   Now unblocked on the honour path — the cron exists — but it needs a recipient policy:
   `RecipientResolverService` still falls back to a global env address for the legacy tenant
   (`communications/scheduled-tasks.service.ts:120-146`), and mailing the wrong house is what
   ADR 0022 exists to prevent. The rebuilt sheet renders the tick disabled with that reason.
3. **Persist meeting memos** to the documents surface the handler names
   (`CalendarPage.tsx:308`). Blocked: `/documents-reports` has no upload path at all
   (documents-reports.md §10). Until then, remove the prompt rather than keep
   collecting.
4. **Stop dropping `recurring`, `eventDateEnd` and `labels` on edit**
   (`CalendarPage.tsx:253-270`) — mechanical, and it is a data-loss path today.
5. ~~**Retire `/calendar-classic`**~~ — **done 2026-08-26** (§9).
6. Add an `isError` branch.
7. Diagnose the iCal feed against a real client — settings.md §13 item 3 names the
   first thing to try. Blocked on `v3.0-TECH-DEBT.md:243-245`.
8. `provider_important_dates` missing in production — **OD-68**.
9. ~~**Fix the `limit` 400** (§9.1)~~ — **done 2026-09-03**; see §9.1 for the fix, the spec
   and the live verification. What remains is only the >500-event month, which `@Max(500)`
   caps: it would need real pagination, and the page reports `hasMore` instead.
10. **Reconcile the event-type / status enums with the rows that exist** (§9.2). Until then
    no client can safely round-trip an `audit` or `active` row.
11. **Add `providerId` / `orderId` / `recurrence` to `UpdateCalendarEventDto`** (§9.3) so the
    vendor link and the repeat rule stop being write-once.
12. ~~**Add `apps/web/src/pages/calendar/next` to `SCAN_ROOTS`**~~ — **done**;
    `Path("apps/web/src/pages/calendar/next")` is present at
    `scripts/check_no_seeded_defaults.py:202`, so the ADR 0051 guard reads this
    directory rather than being green over it (§9.6).
13. **Give `getEventTypes` a way to say "unreachable"** rather than returning the built-ins
    over an error (§9.5) — the page already renders the honest branch if the shape appears.
14. **Add `reminder_minutes_before` to `calendar_events`** so "15 minutes before" is
    representable. `reminder_days_before` is an INTEGER of days
    (`20260805000000_baseline_from_production.sql:2358`), so the rebuilt sheet offers whole
    days only and says why. Needs the column, `Create`/`Update` DTO fields, the mapper, and one
    branch in `reminder-window.ts` `reminderDueAt`.
15. **Remind materialised recurring occurrences only, or materialise on write.** A series
    expanded client-side (`lib/calendar/recurrence.ts`) is one row, so its occurrences carry no
    id to key a dispatch on and get no reminder. Either generate occurrences server-side at
    create time, or add an occurrence key to `calendar_reminder_dispatches` — the second is
    cheaper and the first is more honest.
16. **Delete `startReminderScheduler()` from `apps/web/src/main.tsx:20`** when the legacy
    calendar is retired (§9.1). Until then an entry created on the legacy page and never opened
    in the rebuilt sheet can be reminded twice.
17. **Add `apps/api-gateway/src/calendar` to `SERVER_SCAN_ROOTS`** in
    `scripts/check_no_seeded_defaults.py:220` (§9.5), and fix the one thing it finds
    (`generation_horizon_days: 90`, §9.4).
18. **Reconcile quiet hours between the two runtimes** (§9.2) — the orchestrator reads them on
    the process's clock, the gateway on the restaurant's.
19. **Arm the job.** `CALENDAR_REMINDERS_ENABLED=true` on the gateway. Everything else is
    built and tested; this is the founder's switch. Before flipping it, check
    `GET /calendar/reminders/status` on the target deployment: `served` says whether ADR 0022
    enumerates that restaurant, and `pending` says how many entries would come due.

### The calendar program — slices from ADR 0111 (added 2026-09-03)

Items 20-30 are the build order recorded in
[[0111-the-calendar-is-the-houses-day-book|ADR 0111]] §6, which is where the
rationale, the alternatives and the measurements live. Nothing here is built. Sizes are the
ADR's; the order is not preference — each slice earns the trust the next one spends.

20. ~~**The coordinate** (**S**)~~ — **done 2026-09-03.** Captured at sign-up from the Google
    Places selection; `scripts/backfill_restaurant_coordinates.py` covers the 13 existing
    rows and has **not been run** — it needs `GOOGLE_MAPS_API_KEY` and the founder's word.
    Original text: A location field on the restaurant — a map pin, or a geocode
    of the `address` / `google_place_id` already stored — written to
    `restaurants.latitude` / `.longitude`. The columns exist; **0 of 14 rows carry a value**,
    and nothing in items 21-24 exists without one. *Outside this page: it is a `/settings`
    or onboarding field.*
21. ~~**The weather overlay** (**M**)~~ — **done 2026-09-03**, with two departures from the
    text below: the issuer is **NWS** (the founder's call — the keyless Open-Meteo tier is
    non-commercial), and the refresh is **on read with a 60-minute max age** rather than
    under `runPerTenant`, because that scheduler serves one tenant in ten (§9, weather-overlay gap 1). Original
    text: A `WeatherProvider` interface with an Open-Meteo
    implementation (and NWS / OpenWeather behind the same interface), refreshed under
    `ScheduledTenantsService.runPerTenant`, into a `weather_readings` table that **keeps**
    each reading with its issuer and issue time. Gated on fork A — the keyless Open-Meteo
    tier is non-commercial.
22. ~~**Past cells hold the record**~~ — **done 2026-09-03**, with one deliberate omission:
    a passed day does **not** state a forecast error, because no observation and no covers
    model exist to compute one. It keeps the pair and says so. Original text: No
    new data; it is the reconciliation line. This is also DESIGN-FOUNDATION §6's own
    "need it now" idea for this page, and the first thing in the product that would write
    `prediction_outcomes` — a forecast-accuracy ledger migrated long ago and **written by
    nothing** (ADR 0048 Lane A).
23. **The deadlines strip** (**M**). Over what exists first (`calendar_events`,
    `recurring_orders`), then `vendor_terms(restaurant_id, provider_id, weekday,
    cutoff_time, delivery_weekday, minimum_order, provenance)` and
    `procurement_documents.due_date`. `vendor_terms` is already named as `/settings`'
    "need it now" in DESIGN-FOUNDATION §6 — *"Vendor terms as a tab … each with provenance
    … Unblocks the calendar and notification ideas."* **Coordinate with the settings owner;
    do not build it twice.**
24. **Notes and daily actions on the day** (**M**). `calendar_day_notes`, plus
    `recommendation_actions` / `one_tap_actions` / `ai_proposed_actions` rows projected onto
    their date and linking back. Closes §12 item 9 — the memo-into-a-void fault — without
    waiting on the documents upload path.
25. **The ⌘K calendar family** (**M**). Extends `ask-ai`'s propose→confirm allowlist with
    `calendar.create/move/annotate/remind/note`, split by
    [[0013-one-commitment-guardrail|ADR 0013]]'s leaves-the-house test. The
    dispatcher already fails loudly when the allowlist and its switch disagree
    (`ask-ai.service.ts:955-959`), so the widening is safe by construction.
26. **Google Calendar connector — push** (**M**). A `google_calendar` row in
    `INTEGRATION_DEFINITIONS`, scope `calendar.app.created`, one mapping table. **No
    migration for the connector itself.** Requires the gateway's `GOOGLE_CLIENT_ID` /
    `GOOGLE_CLIENT_SECRET` and a registered redirect URI, neither of which this deployment
    has. Also the only way a Google Meet link can exist on an entry.
27. **Pull, then two-way** on the same connector (**L**). Sync tokens, watch-channel renewal,
    an external-event read-only lane, and the conflict rules stated in ADR 0111 §5 —
    last-writer-wins **per field**, a delete that never wins silently, the loser kept as a
    note, and the echo closed by request-id stamping. Ship the conflict line and exercise a
    delete refusal in a test before calling it done.
28. **The covers overlay** (**M**, but **time-gated not effort-gated**). Withheld below 90
    observed service days; the weather regressor withheld below 180. Item 21 is what
    accumulates the history. The page should say which day of ninety it is on.
29. **The Mudavym MCP server's first three tools** — `calendar.read_day`,
    `calendar.list_deadlines`, `calendar.propose_entry` (**M**). Per
    `08-softwares/mudavym-mcp.md`; the propose verb lands in item 25's proposal queue so
    there is one approval surface, not two. No send verb is implemented, so there is nothing
    to refuse at runtime.
30. ~~**Two fixes that belong to no slice and should ship immediately**~~ — **done
    2026-09-03, and all four rather than two**: `Content-Disposition` is `inline`, the
    zone-less `new Date()` is gone, `X-PUBLISHED-TTL`/`REFRESH-INTERVAL` are emitted, and the
    token endpoint returns an absolute + `webcal://` URL. See §12 item 1. **What remains is
    not code**: no human has yet subscribed a real Outlook/Apple/Google client to the feed,
    which is the only thing that can close `v3.0-TECH-DEBT.md:243-245`.

31. **Offer the `webcal://` link on the settings surface.** `/calendar/ical-token` now returns
    `absoluteFeedUrl`, `webcalUrl` and `originSource`; nothing reads them yet. The settings
    subscribe panel still shows the relative path, which no calendar client can use. *Outside
    this page — `pages/settings/**`; the exact patch is in the p4h builder's report.*

32. ~~**Prefetch the forecast for houses nobody opens**~~ — **done 2026-09-04.** Hourly,
    every restaurant with a coordinate, iterating them directly rather than through
    `ScheduledTenantsService.runPerTenant` (which serves one house of ten — §9, weather-overlay gap 1). It required
    a dated amendment to ADR 0022 naming exactly the two NWS reads it permits — the forecast
    and the observations — and nothing else; anything that reaches a person is unchanged.
    Switch: `WEATHER_PREFETCH_ENABLED`, default **on**, because it sends nothing and an
    unarmed prefetch accumulates nothing.

33. ~~**Record a temperature observation, so a forecast can be scored**~~ — **done
    2026-09-04.** `weather_observations` (`20260904140000`), fed from
    `/gridpoints/{office}/{x},{y}/stations` → `/stations/{id}/observations`. The station list
    is ranked nearest-first and the provider walks past a silent station to the next one, up
    to four, because a grid square's nearest unit can be an amateur station that reports
    nothing for days.

34. **Score the covers forecast** — the half that is still unscored, and the reason a day
    can carry a real weather error and no claim about trading. Blocked on slice 28 (90
    observed service days; the house has 22), not on anything buildable.

35. **Surface the score on the page.** `GET /calendar/day-record` returns `forecastErrorC`,
    `scoreWithheld` and the `observed` block per day, and the cell's line already carries the
    sentence. A register showing the house's forecast accuracy *over time* — the thing ninety
    days of this data is actually for — is not built.

36. **Give the prefetch a status surface.** `WeatherPrefetchService.status()` returns
    `{ armed, cron, lastRun }` and no endpoint exposes it, so an operator cannot see whether
    the sweep is running without reading the logs. The reminder job's
    `GET /calendar/reminders/status` is the shape to copy.

- **Correction to a commit message (recorded 2026-09-05).** Commit `bf6d57e9` (`?new=` opens the sheet prefilled) said "4 of 6 new tests fail" against the pre-fix code; its audit rebuilt the pre-fix copies and measured 6 of 6 failing. The real number is stronger evidence than claimed; the claim itself was wrong.
