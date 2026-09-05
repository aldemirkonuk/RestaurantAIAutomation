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
updated: 2026-09-03
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
- **Re-read the price register** (*Cheaper than lately*, refresh icon) → in-place re-read of `GET /vendor-intel/below-average`; goes nowhere
- **Re-read the price index** (*Posted price index*, refresh icon) → in-place re-read of `GET /price-index/me`; goes nowhere

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

- Posted-price index box says when a hand-carried price book is **waiting for a
  second pair of eyes**, that nothing is drawn from it until an owner or manager
  admits it, and **how long the hold is** (ADR 0128 Q2, 2026-09-05)
- Posted-price index box prints **on what basis** each hand-carried book that IS
  drawn was let in — and says in words when a lone owner-or-manager admitted
  their own book, with the reason they gave (ADR 0128 Q4, 2026-09-05)
- **Commodity and market index context line** inside the same labelled box: the
  newest observation of every published index series that speaks for this house,
  each carrying its issuer, its own period, the base it is stated against, its
  unit, its licence and whose date it is. Context, never a claim -- it says what
  a publisher printed and never what this house will pay, and it is never placed
  beside or averaged with a vendor quote (`commodity-signals-plan.md` phase 0,
  2026-09-05)
- A house with **no exposure mapped** sees the series and a sentence saying none
  of these numbers is about anything it buys yet. Nothing proposes a mapping:
  a mapping is a person's assertion and is never inferred
- **Published RATES** draw as their own kind — neither an index nor a price —
  each naming its statute and the day it took effect, and each carrying a
  sentence saying whether a per-bottle duty can be derived from it and why not
  when it cannot (2026-09-05)
- A source **waiting on a person's own download** says so, so a parser that has
  never seen real bytes can never look like a working feed
- An **armed** series names who armed it, when, and the calibration it was armed
  on, on the same line as the number it produces

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
  says so in words and offers *Put them back*. **Superseded 2026-09-03** by
  *Put it down for …*, a snooze with a deadline that also wakes on new
  activity; still per-browser, still said out loud (fourth pass, below).
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

**Fourth pass, 2026-09-03** (founder review — KEEP, with doubt):

- **The day rail — since 2026-09-04, the HOUSE day strip.** A row of cells above
  the book, each showing that day's lines and how many are still open. Picking a
  day sends `dateFrom`/`dateTo` to the register, so the count beside it is the
  **register's own** total for that day, not this screen's. Verified live: a
  click on 3 September issued
  `GET /notifications?…&dateFrom=2026-09-03T04:00:00.000Z&dateTo=2026-09-04T03:59:59.999Z`
  and the rail read "the register holds 6 lines for that day", matching a
  direct curl of the same window. The founder's call of 2026-09-04 replaced this
  page's own `DayRail.tsx` with the shared `components/mudavym/DayStrip.tsx`
  (this page's slots are `NoteDays.tsx`), which changed three things here:
  the window is a **full calendar month** with previous/next controls instead of
  the last fortnight; the page gained a **keyboard map** (arrows · ↑↓ a week ·
  Home/End · Enter/Space selects · Escape clears) and a visible focus ring,
  neither of which the rail had; and a blank day now says *which kind* of blank
  it is — hatched for "the loaded pages cover this day and the register wrote
  nothing", plain for "these pages do not reach it", empty for a day that has
  not happened. See §1b, fifth pass.
- **The register's own filters, on the page** — `type` and `status` as pills,
  each a `GetNotificationsQueryDto` field applied server-side
  (`notifications.service.ts:811-817`). The bar states which controls are the
  register's and which are this screen's, because a filtered count means two
  different things either side of that line.
- **Quick search** over the lines on screen (title · message · register ·
  type), searching the text that is **drawn**, so a query never has to contain
  the emoji a producer once stored in a title. Labelled as screen-side: there
  is no full-text index on this table.
- **Hide what is ruled off** — a fold, not a filter: the count stays visible
  and nothing is deleted or told to the server.
- **Snooze that wakes by itself.** *Put it down for* an hour / after service /
  tomorrow / next week. It comes back on its deadline **or** the moment the
  register writes about the same thing again — a newer stamp or one more folded
  repeat (Linear's rule; `nt-snooze.ts` carries the citation). It replaces
  *Set aside*, and it is still 🚧 per-browser: `notifications` has no snooze
  column, and the page says so on the band, on the row and in the footer.
- **Keyboard: `j` `k` `e` `s`**, plus `Enter` to open and `/` to search.
  Nothing destructive is bound — archiving and deleting stay on the line, where
  they have to be aimed at — and no key fires while the reader is typing.
- **A folded line now says which of its repeats is the newest.** The shared
  stacker keeps the below-par burst with the highest wine count regardless of
  date (`lib/notificationStack.ts:59-65`); measured on the production book for
  restaurant `550e8400…` on 2026-09-03, that made the surviving line "50 wines
  dropped below par" (11:24) while the newest burst in the same fold was 16:44
  — **5h 20m** of news inside the fold with no stamp of its own. The line now
  prints the fold's newest age above its own and says why they differ.
- **The market-price register** — *Cheaper than lately*: products whose newest
  sighting is below the mean of their earlier sightings in the last 30 days,
  read from a gateway endpoint built in this pass. 🚧 The price register is
  **empty** (measured: `vendor_price_observations` holds zero rows), so the box
  says "the register holds no sightings at all", which is deliberately not the
  same sentence as "nothing is cheap". A price drop does **not** write a line in
  the book; the producer that would is specified in §13.
- **A tier-4 public-site price is shown, and shown apart.** Since 2026-09-04 the
  endpoint partitions each product's sightings by class before comparing, and
  the box draws the quoted comparisons and the public-vendor-site ones as two
  separate lists under two headings, with the rule ("a sighting is only ever
  compared with another of its own class") printed on the box. A sighting whose
  source has no class is COUNTED on the box rather than folded in silently.
- **The posted-price index register** — *Posted price index*: the state posted
  list or control-state shelf line for this house's own jurisdiction, read from
  `GET /price-index/me` and drawn as its **own box below the market box**, on a
  different ground, never beside a vendor quote (the founder, 2026-09-04: *"Run
  it, labelled tier 4, never beside a quote"*, *"Show as a labelled index line,
  own register"*; ADR 0117). Each line carries its class, issuer, issue date,
  posted unit and basis, and is printed as posted — never reduced to a 750ml
  bottle. 🚧 Measured 2026-09-04 against the project this gateway reads: the
  demo house has **no `state_province`**, so the box prints the endpoint's own
  sentence; and `price_index_postings` is **not present on that project** (the
  migration exists on this branch, unapplied), so every recognised state
  currently answers *"The index register could not be read. This is unknown, not
  empty."* A withheld publisher (Michigan's 403) is named on the box even while
  the register is silent for some other reason.
- **Three directions drawn** for the founder's fork, with a recommendation and
  its strongest counter-argument argued on the page:
  `.planning/sketches/093-notifications-directions-2/` — `index.html`,
  `day-rail-ledger.html`, `two-rooms.html`, `standing-accounts.html`.
- **The four registers the founder named now have a home on the page.**
  *Deliveries* (`order_delivered`, `delivery_scheduled`), *Invoices*
  (`invoice_received`), *Sales* (`service_closed`), *Goals* (`goal_reached`)
  and *Market* (`price_change`) are registers of their own in `KIND_BY_TYPE`,
  each with its own lucide mark, its own rail tally and its own filter pill —
  rather than falling into *Other*, which is how a new register goes invisible.
  The `type` values are read off the producers landing in the same wave
  (`apps/api-gateway/src/notifications/producers/{delivery-recorded,
  invoice-confirmed,sale-record,goal-reached,market-price}.producer.ts` —
  `goal_reached`, `order_delivered`, `invoice_received`, `service_closed`,
  `price_change`), which are a **sibling builder's** work, not this page's, and
  are therefore cited by file and symbol rather than by line: they were being
  edited in this shared worktree while this page was written, and two of the
  line numbers had already moved by the time they were re-checked. Pinned by `nt-format.test.ts`
  and by `nt-book.test.ts` ("cannot disagree with the register a line lands in").
- **A sixth register, 2026-09-04: *Connections* (`grant_suspended`).** The
  seventh producer (`notifications/producers/grant-suspended.producer.ts`,
  committed `5962901a`) writes a line when a model-context server changed or
  withdrew a tool a manager had granted, so the grant is suspended until someone
  re-consents. Its rows were landing under *Other* until this row existed —
  the same absence-as-health shape the five above were added to fix — so it now
  has its own `KIND_BY_TYPE` entry and its own lucide mark (`Plug`) in
  `ICON_BY_KIND`, both pinned in `nt-format.test.ts`. **Not yet in
  `TYPE_CHOICES`:** the filter pills were left alone this pass (the coordinator's
  instruction was the register line only), so a *Connections* row is drawn and
  tallied correctly but cannot be filtered for. Filed, not built.
- **A ninth producer, 2026-09-05: `experiment_ended_unnamed`** — the only one that
  is NOT a tenant sweep. It writes one notice when a UX experiment's window closes
  with no winner named (ADR 0127's second addendum; founder, batch 53: *"A
  notification to you when it ends unnamed"*), carrying both arms' figures and the
  route that names the winner. Three things make it the odd one out and all three
  are deliberate: it runs **once per fast tick, outside `runPerTenant`**, because
  its figures are cross-house and running it per tenant would put them in every
  house's inbox; it writes into **one house only**, named by
  `DEFAULT_RESTAURANT_ID`, and with that unset it does not run and picks no house;
  and its `willWrite`/`silentReason` on
  `GET /notifications/producers/status` is computed **ahead of the `served`
  branch**, because the opt-in register does not gate it and printing the
  scheduler's sentence over it would be a true sentence rendered where it is
  false. **It needs no new register row**: it writes `type: "system_alert"`, which
  `KIND_BY_TYPE` already maps to *System* and `nt-format.test.ts` already pins —
  checked rather than assumed, precisely because the seventh producer's rows fell
  to *Other* until somebody noticed. **It is also the only producer that SENDS
  MAIL** (founder, batch 55: *"Inbox row and an email"*): one call to the
  existing `GmailService`, **after** the inbox row and only if the row landed,
  gated on a new `ProducerLedgerService.hasClaimFor` read so a deferred member's
  later row does not trigger a second copy — the claim index settles the
  same-tick tie, the read suppresses later sweeps, and an unreadable ledger holds
  the copy rather than risking two. The send outcome is written back onto the row
  in words by a new `ledger.annotate` (`sent` / `refused` with the sender's own
  reason / `not_attempted` with its reason), never a silent skip. The address
  goes to the sender and the log, never the row. Still behind the one switch.
- **The filter offers no control that can only return nothing.** Every entry in
  `TYPE_CHOICES` was checked against a real write site on 2026-09-03 and each is
  cited in `nt-book.ts`. `ai_suggestion` is deliberately absent: it is a member
  of `NotificationType` (`notifications.dto.ts:29`) and **nothing writes it** —
  an enum member is not a producer. A priority filter is absent for the same
  class of reason: 631 of 663 rows are `critical`. Both absences are pinned by
  tests, so neither can be quietly re-added.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_notifications`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

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

**Fourth pass, 2026-09-03 — no new motion.** The day rail, the filter pills, the
search box, the hide-read fold and the keyboard cursor all use `nt-ink` (the
`ink` token) for their state changes and nothing else; the sleeping band and the
market-price register reuse `nt-expand`/`nt-ink`. A rail cell does not animate
its bar: the bar is a figure, and this page does not animate figures it did not
measure. Nothing was added to the table because nothing new was needed, which is
the rationing rule working rather than an omission.

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
6. Per-browser state is named as such — *Set aside* (from 2026-09-03, *Put it
   down for …*) says the server was not told and another device still shows the
   line.
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
  that `GetNotificationsQueryDto` already exposes → §13. **Reversed 2026-09-03
  (fourth pass):** those server-side filters were built, and a quick search was
  added beside them and labelled screen-side. The **priority** filter was NOT
  built and will not be: 631 of 663 rows are `critical`, so it would sort by a
  constant (§9.12).
- **Star** — local-only, invisible to anyone else, and now duplicated by *Set aside*
  (since 2026-09-03, by snooze). Dropped rather than shipped as a second
  per-browser fiction.
- **Copy link** — a link back to this page told the reader nothing; the row's own
  `actionUrl` is the address that matters and is on every expanded line.
- **`?tab=settings`** — notification preferences have a home on `/settings` (rebuilt in
  the same wave). Two homes for one truth is how they drift → §13.
- **Snooze → *Set aside*** — the same per-browser mechanism, renamed so it cannot be
  mistaken for a server-side decision, reversible in one click. The server-side move
  stays open → §13.3. **Revised 2026-09-03:** the name went back to what it is —
  *Put it down for an hour / after service / tomorrow / next week* — because the
  behaviour is now a real snooze with a deadline and two wake edges, and calling
  a snooze something else was costing more in comprehension than it bought in
  honesty. It is still per-browser and still says so in three places.
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

### Fourth pass, 2026-09-03

**The verdict, quoted** (the founder, on the gallery, 2026-09-03):

> **`/notifications` — KEEP (with doubt).**
> · *"add competitor lens features that leaves us behind."*
> · *"Notifications is also huge that it will send the real alerts and warnings
>   + the success we own, eg. when the goal is reached (take time of event, how
>   early was it, who were at shift — meta descriptions), delivery
>   notifications, invoice confirmations, sale records and so on."*
> · *"Add a section (maybe a box) that will endpoint to market price
>   notifications eg. Prod X is now selling lower than 30 day avg. (buy it now
>   sth like that)."*
> · *"I need your help (I said keep new design but not sure), what would you
>   select I also liked the day strip a lot. But I need your expertise maybe
>   create 2-3 more sketch to understand behaviour and what would work the
>   best."*

**What was measured before anything was drawn** (live register, 2026-09-03; the
counts are exact-count reads, not estimates). These reshaped the answer, so they
are recorded before the answer:

| Measurement | Number | What it settles |
|---|---|---|
| One producer writes the book | 641 of 663 rows are `inventory_low_stock`; 57 distinct titles across 663 rows; `Low-stock digest: 50 wines below par` written 147 times | The page's problem is content, not layout |
| Severity is a constant | 631 of 663 rows are `critical`; 611 are `unread` | Any design that sorts or splits by priority sorts by a constant |
| The register is already keyed by day | `group_key` populated on 662 of 663; its 237 distinct values are `low_stock_digest:2026-08-16`, `…:2026-08-17`, one key per calendar day, eight rows apiece, across 50 days | The founder's day-strip instinct is the data's own shape |
| The whole book draws as three lines | page 1 of 100 rows for restaurant `550e8400…` collapses to **3** after `collapseStackedNotifications` | Four layouts were being compared for a page that renders three rows |
| The surviving line is stale | the kept burst was 11:24; the newest in its fold was 16:44 | Fixed this pass (§1a) |
| No row carries a subject | `related_entity_type`, `related_entity_id`, `notification_group`, `actions` are NULL on **663 of 663** | Direction C is unbuildable honestly; §13.21 |
| The price register is empty | `vendor_price_observations` holds **0 rows** | The market box's honest first screen; §13.22 |

**The three directions, and the recommendation.**
`.planning/sketches/093-notifications-directions-2/` (screenshots only, example
data throughout, both grounds verified at 1440 with zero horizontal overflow and
zero console errors):

- **A · the day rail over the ledger** — the founder's day-strip turned from a
  layout into a **selector**: one column, one direction of travel, unchanged,
  with the fortnight as a rail above it. **Built this pass.**
- **B · two rooms** — Linear Triage's shape in the house idiom: *Needs a
  decision* with four resolutions, split from *The house is telling you*,
  grouped by register, with the rule that assigns a room **printed on the page**
  (the one thing Gmail's Priority Inbox cannot offer, since it splits on "past
  actions" nobody can restate).
- **C · standing accounts** — fold by subject, close by settlement: not lines
  but accounts, each with a state, the rule that keeps writing about it, how
  loudly that rule fires and how it will close. Sentry's fingerprint and
  Opsgenie's alias applied to a restaurant's books.

**The recommendation: keep the day-book, take A now, B when the new registers
exist, C when the producers say what a row is about.** A is the only one of the
three buildable today without either a fabrication or a bet: the day rail is the
shape the data already has, and picking a day is a server-side read. B is the
right answer to the volume the founder's own new registers will create — a goal
reached, every delivery, every invoice confirmation and every service record are
*reports*, and they will outnumber decisions by two orders of magnitude — but on
today's register 641 of 663 rows are low stock and 631 are critical, so room one
would be the whole page and room two would hold four rows. C attacks what is
actually wrong (the same sentence written 147 times, and nothing closing except
by being read) and is blocked on three columns that exist and are NULL on every
row.

**The strongest counter-argument, and why it loses.** *"A is the status quo with
a widget on it. The founder said he was **not sure** about keeping; 'keep it,
plus a date picker' is the answer that takes the least courage and leaves his
actual complaint where it was. Build B now and let the near-empty right-hand
room be the visible argument for building the producers."* It nearly wins, and
it loses on one thing: **an empty room is not an argument, it is a claim.** A
page with *Needs a decision* full and *The house is telling you* holding four
rows does not read as "we have not built the producers yet"; it reads as "the
house has nothing to report" — a statement about the business made by a gap in
our own instrumentation, which is the one fault this repo has a standing rule
against (memory: absence-reported-as-health). A rail over one ledger makes no
such claim: an empty day is visibly an empty day and the register's own total is
printed beside it.

**What was built in the gateway.** `GET /vendor-intel/below-average`
(`apps/api-gateway/src/vendor-intel/vendor-intel.controller.ts`, service method
`VendorComparisonService.belowTrailingAverage`, arithmetic in
`price-below-average.ts`, 11 jest cases in `price-below-average.spec.ts`).
Measured first: no endpoint answered "latest versus trailing 30-day average, per
product, for this tenant" — `GET /vendor-intel/compare` needs a product id the
caller already has and compares a window against the **prior window**, not the
latest against a mean (`analytics/engine/vendor-price-consensus.ts:386-402`).
Five honesty rules are in the pure function and each has its own test: the mean
excludes the latest sighting (a mean containing the value it is compared against
damps its own signal); fewer than three earlier sightings is not an average;
currencies are never converted; an unnormalisable row leaves the comparison
rather than entering it at its raw price; and `is_outlier` is obeyed rather than
re-decided. Everything dropped is counted and returned, so a short list can be
read. Verified live: `200` authenticated, `401` without a token, `windowDays`
and `minObservations` clamped (`99999` → `365`, `0` → `2`), garbage → the
default, and `scanned.observations: 0` — which is the true answer.

**Honesty rules applied this pass**

1. **The rail's little figures are screen-side and say so.** They can only count
   rows already loaded. Selecting a day replaces the estimate with the
   register's own count. The alternative — fourteen requests to fill the rail —
   costs more than it tells.
2. **A cleared filter is omitted, not sent empty.** `status=''` fails the DTO's
   `@IsEnum(NotificationStatus)` and would turn a cleared control into a 400.
3. **Narrowing the book restarts the paging**, or *Read further back* would ask
   for page 3 of a two-page answer.
4. **Snooze is per browser and never pretends otherwise** — on the band, on the
   row and in the footer, with the reason (`notifications` has no such column).
5. **A snooze cannot bury a worsening situation.** It wakes on new activity as
   well as on its deadline. PagerDuty makes the same argument from the other
   end: an acknowledgement halts escalation, but "when the acknowledgement
   timeout is reached, the incident returns to triggered status".
6. **No key does anything irreversible**, and no key fires while the reader is
   typing — an inbox that starts archiving because someone searched for
   "sancerre" is the classic version of this bug.
7. **The market box has three different empty states and never collapses them**:
   the sweep could not be read / the register holds no sightings at all /
   sightings exist and none is below its mean.
8. **The box states its own rule in full** — window, minimum history, unit, whose
   prices, and that the latest is not folded into its own average — and states
   what it cannot do: nothing notifies you when this changes while you are
   elsewhere.

**Where the behaviour came from** (read before drawing; each claim checkable):
Linear Inbox (`J`/`K`, `H` to snooze, "Show read", Cmd-F quick search) —
https://linear.app/docs/inbox · Linear's 2021 snooze changelog, for the
wake-on-activity rule quoted in `nt-snooze.ts` —
https://linear.app/changelog/2021-06-17-inbox-snooze-and-easier-issue-merge ·
Linear Triage's four resolutions and its rota-driven responsibility —
https://linear.app/docs/triage · PagerDuty's triggered/acknowledged/resolved and
the acknowledgement timeout — https://support.pagerduty.com/main/docs/incidents ·
Opsgenie's alias de-duplication ("at most one open alert with the same alias at
any time") —
https://support.atlassian.com/opsgenie/docs/what-is-alert-de-duplication/ ·
Sentry's fingerprint grouping —
https://docs.sentry.io/product/issues/grouping-and-fingerprints/ · Superhuman's
Split Inbox —
https://help.superhuman.com/hc/en-us/articles/38458392810643-Default-Split-Inboxes ·
HEY's Screener, Imbox, Feed and Paper Trail (the precedent for treating
deliveries, invoice confirmations and sale records as a paper trail) —
https://www.hey.com/how-it-works/ · Notion's inbox filters and "Archive read" —
https://www.notion.com/help/updates-and-notifications · Gmail's Priority Inbox,
named as the split **not** to copy —
https://support.google.com/mail/answer/18522 · Datadog's monitor status events,
where a time axis belongs to one subject rather than to the whole alert list —
https://docs.datadoghq.com/monitors/status/events/.

**What stays open, and why.** (1) The four registers the founder named are
producer work and are filed in §13.17–§13.20 with the exact call sites; nothing
was faked on the page to stand in for them. (2) Snooze cannot go server-side
without a migration, which this pass was not allowed to write — §13.3, now with
the exact column and the working precedent. (3) The market-price box reads a
real endpoint over an empty table; the producer that would write a notification
from a drop is §13.22 and is outside these paths. (4) Direction C stays a sketch
until `related_entity_type`/`related_entity_id` are written — §13.21.

### Fifth pass, 2026-09-04 — the rail becomes the house day strip

The founder's third decision of the day: **one shared day strip**, per-page slots for
what a day carries. `apps/web/src/pages/notifications/next/DayRail.tsx` is **deleted**
(152 lines); this page now renders `components/mudavym/DayStrip.tsx` through its own
slot file `NoteDays.tsx`.

**The measured cause.** `/recommendations` and this page had each grown a day strip and
the two had already drifted. That page's carried four record states, the hatched-not-a-
zero rule, and a full keyboard map; this rail carried none of the three — no record
states at all, no keyboard, and a bar whose height was a proportion of the busiest day
on screen. Same object, two contracts, one of them missing the rule the other exists to
enforce. `DESIGN-FOUNDATION.md` §3 item 4 now carries the dated amendment.

**What this page kept.** The rail's original argument, which was right and is worth
keeping written down: this book IS keyed by day, by its own producer — 237 distinct
`group_key` values on the production register (2026-09-03), the twenty commonest being
`low_stock_digest:2026-08-16`, `…:2026-08-17` and so on, eight rows apiece, one key per
calendar day. The house writes a page a day. And the honesty that came with it: the
figure in a cell counts the lines **on this screen**, never the register's total; the
register's own figure appears only once a day is selected and read back.

**What this page gained.** The month window, the month controls, the whole keyboard map,
a visible focus ring, and one negative claim it could not make before.

**The hatch, and exactly how far it is entitled to go** (`nt-book.ts` `dayCells`). The
gateway returns notifications `order("created_at", { ascending: false })`
(`notifications.service.ts:824`) and this page reads pages 1..N contiguously, so the rows
on screen are a newest-first **prefix** of the register. That makes one negative claim
safe: for any day strictly newer than the oldest loaded row's day, "no rows on screen"
means "no rows in the register" — the register cannot be hiding a line between two lines
this screen already holds. Those days hatch. Everything else is drawn plain and says
nothing:

- days at or older than the oldest loaded row's day — the page boundary can fall inside
  a day, so even the oldest day is only safe because it HAS a row;
- every day but one while a **day filter** is applied (the register was asked about one
  day; nothing is known about the rest) — the strip's note says so on screen;
- every day when nothing has been loaded at all.

A **type or status** filter does *not* force plain: "no line of this kind that day" is a
true statement about a narrower thing, and the note names the narrowing. Calling that
"unknown" would be the opposite error — an absence the page can prove, reported as
ignorance.

**And the future half is empty, never hatched.** A day that has not happened is neither
a record nor an absence; the cell's own title says exactly that, and the strip enforces
it — a page cannot claim otherwise about a day after `today`.

**Verified in the live browser, 2026-09-04** (web :5274, gateway :4000, tenant
*Meyhouse Palo Alto*, captures in `$SP/shots-daystrip/`, both grounds): 30 cells for
September 2026; month label and previous/next controls live; four days carried a record,
26 drawn as future; the 1st selected read *"Tuesday 1 September — 1 line on this screen,
1 still open — a record landed on this day"*; the note under the strip read *"Every other
day is drawn blank while this filter is on: the register was asked about one day, so
nothing is known about the rest."* Cell width measured off the rendered DOM: **35.4px at
1440**, **30.1px at 1280**, no horizontal scroll at either, day number 11.5px throughout.
The floor is `--mdv-ds-min: 30px`; below it the strip scrolls rather than shrinking the
number.

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
  `NotificationsNext.tsx`, `BookRow.tsx`, `HouseBand.tsx`, `NoteDays.tsx`
  (`DayRail.tsx` **deleted** 2026-09-04 — the strip is the house's now),
  `BookFilterBar.tsx`, `MarketPricePanel.tsx`, `MarketIndexPanel.tsx`
  (added 2026-09-04), `useNotificationsNextData.ts`,
  `useMarketPrice.ts`, `useHouseIndex.ts` (added 2026-09-04), `nt-format.ts`, `nt-book.ts`, `nt-snooze.ts`, and six
  test files — `NotificationsNext.test.tsx` (31 render-contract tests, all three
  data hooks mocked), `MarketIndexPanel.test.tsx` (16, the index box's own hook
  mocked), `useNotificationsNextData.test.tsx` (11 hook tests, `apiClient`
  mocked), `nt-format.test.ts` (12), `nt-book.test.ts` (12, including the
  measured stale-fold case and the filter-map invariants), `nt-snooze.test.ts`
  (8) — plus `MOTIONS.md`. **96 tests in the directory** (measured
  2026-09-04 by `vitest run src/pages/notifications/next`). It shares `lib/notificationStack.ts` with the
  legacy page (and, in `nt-book.ts`, asks that library rather than
  re-implementing its keys) and imports nothing from `pages/Notifications.tsx`.
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
- Gateway, fourth pass: `apps/api-gateway/src/vendor-intel/price-below-average.ts`
  (the pure arithmetic), the `belowTrailingAverage` method on
  `vendor-intel/vendor-comparison.service.ts`, the `GET below-average` route on
  `vendor-intel/vendor-intel.controller.ts`, and
  `vendor-intel/price-below-average.spec.ts` (11 jest cases: 8 for the
  arithmetic, 3 for the service's tenant scope and its refusal to render a
  failed sweep as an empty market).
- Sketches: `.planning/sketches/089-notifications-directions/` — `index.html`,
  `three-column-desk.html`, `day-strip.html` (standalone, `file://`, example
  data); and `.planning/sketches/093-notifications-directions-2/` —
  `index.html` (the measured facts, the three directions, the recommendation and
  its strongest counter-argument), `day-rail-ledger.html`, `two-rooms.html`,
  `standing-accounts.html`.

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
| GET | `/notifications?userId=&restaurantId=&type=&status=&dateFrom=&dateTo=&page=&limit=` | the rebuild's own read — all four narrowings are `GetNotificationsQueryDto` fields (`notifications/dto/notifications.dto.ts:63-80`) applied as `eq`/`eq`/`gte`/`lte` (`notifications.service.ts:811-821`); `notifications/next/useNotificationsNextData.ts` |
| GET | `/vendor-intel/below-average?windowDays=&minObservations=&limit=` | **new 2026-09-03**, built for the market-price box — `vendor-intel/vendor-intel.controller.ts`, `VendorComparisonService.belowTrailingAverage`, arithmetic in `vendor-intel/price-below-average.ts`; owner/manager only, read by `notifications/next/useMarketPrice.ts`. Since 2026-09-04 it also returns `publicSiteItems` (tier-4, its own list), `scanned.comparisons`, `byClass`, `classesRanked` and `skipped.unrecognisedClass` (`vendor-intel/price-below-average.ts:166-192`) |
| GET | `/price-index/me` | **new 2026-09-04**, the posted-price index box — `price-index/price-index.controller.ts:57-82` resolves `restaurants.state_province` server-side and returns `{ requested, state, lines[], sources[], silence }`; owner/manager only, read by `notifications/next/useHouseIndex.ts`. Verified live on :4000 (dev-bypass owner session): `me` → `state: null` + the "no state recorded" sentence; `Michigan`/`Illinois`/`California` → `lines: []` + "could not be read"; `Turkey` → "not a jurisdiction this register recognises" |
| GET | `/price-index/uploads` | **new 2026-09-05** (ADR 0128), the books this house's jurisdiction is holding — `price-index/price-index.controller.ts`, declared BEFORE `GET :state` or "uploads" would be captured as a jurisdiction. Returns `{ state, pending[], recent[], othersWhoCouldAdmit, note }`; `othersWhoCouldAdmit` is `null` when the pool could not be read, which is not zero. Verified live on :4000 (dev-bypass): the demo house records no jurisdiction, so it answers the "Set the address in Settings" sentence with empty lists |
| POST | `/price-index/uploads/:reviewId/challenge` | **new 2026-09-05** — mints the one-time seal (`subject_kind = price_index_upload`) that admitting a held book must carry back. NOT called by the web yet |
| POST | `/price-index/uploads/:reviewId/confirm` | **new 2026-09-05** — admits a held book. Optional `fileBase64`: the confirmer's own copy is hashed and must match, recorded `byte_match`; without it, `attested`; by the uploader where the jurisdiction has nobody else (or after the escalation), `same_person` with a required reason. NOT called by the web yet |
| POST | `/price-index/uploads/:reviewId/refuse` | **new 2026-09-05** — the book is never admitted; its rows stay written and stay out of the market. Deliberately not sealed (the seal guards the direction that puts numbers on screens), but a reason is required. NOT called by the web yet |
| POST | `/price-index/uploads/:reviewId/reopen-challenge` | **new 2026-09-05** (ADR 0128 Q3) — mints the seal for reopening a refusal. Its OWN act (`price_index_upload.reopen`), never `.admit`: a token minted to put a book back in front of people must not be spendable to put its numbers on their screens. `@Roles("owner")`. NOT called by the web yet |
| POST | `/price-index/uploads/:reviewId/reopen` | **new 2026-09-05** (ADR 0128 Q3, the founder: *"Owner reopens with a stated reason"*) — an owner, never the refuser, once per set of bytes, with a required reason. The book returns to `pending` under the tier it was already in, the refusal moves into `decision_history`, and `escalated_at` is cleared so the 24-hour hold restarts. NOT called by the web yet |

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
| Per-browser state | `localStorage["mudavym.notifications.snooze.<restaurantId>"]` — the sleeping list, tenant-keyed, `{ id, until, seenAt, seenFolded }` per record, and the only client-only state on the page. It **replaced** `mudavym.notifications.setAside.<restaurantId>` on 2026-09-03; an old key is simply ignored, so nobody's lines come back marked wrongly |
| Snooze durations | an hour · after service (8h) · tomorrow (24h) · next week (7d), from `nt-snooze.ts` `DURATIONS`. A record is dropped the moment its deadline passes, so the store cannot grow without bound |
| Wake edges | the deadline, a newer `timestamp` on the row, one more folded repeat, or the row leaving `unread` — `nt-snooze.ts` `resolveSnoozes`, evaluated on every read rather than on a timer |
| Keyboard | `j`/`k` move · `e` rule off / reopen · `s` put down for an hour · `Enter` open · `/` search. Nothing destructive is bound; no key fires while an input, textarea, select or contenteditable has focus |
| Register narrowing | `type` and `status` pills and the day strip all send query params; the search box and the hide-read fold are screen-side and the bar says which is which |
| Registers read | `GET /notifications` and `GET /vendor-intel/below-average`, since 2026-09-03. `/one-tap-actions` moved to the dashboard rail with the desk; pinned by `useNotificationsNextData.test.tsx` ("reads the notifications register and nothing else" — the market-price read lives in its own hook and its own test) |
| Market-price poll | 60s (`useMarketPrice.ts` `MARKET_POLL_MS`), window 30 days, minimum 3 earlier sightings |
| Price-index poll | 300s (`useHouseIndex.ts` `INDEX_POLL_MS`) — a posted list moves on a weekly-to-monthly cadence, so a faster poll would only cost requests |

## 9. Gaps

- **A held price book has no way to be admitted, refused or reopened from the
  product** (ADR 0128, 2026-09-05). `GET /price-index/uploads`, `POST
  …/challenge`, `…/confirm`, `…/refuse`, `…/reopen-challenge` and `…/reopen` are
  built, guarded, sealed and tested, and **no web call site exists**. `MarketIndexPanel` tells a manager a book is waiting and gives them
  nothing to press. Until that is drawn, admitting a book is a curl. The seal
  ceremony to reuse is `HoldToApprove` with `onChallenge` (ADR 0112).

**Filed 2026-09-04, with the fifth pass (§1b), and why each is not yet closed:**

- **The strip can only hatch what the loaded pages cover.** There is no per-day count
  route: `GET /notifications` returns a page of rows and a total for the *current*
  narrowing, never a histogram. So a day older than the oldest loaded row is drawn plain,
  and while a day filter is on every other day is. *Why not yet:* closing it needs a
  `GET /notifications/counts?from=&to=` on the gateway, which is outside a page pass —
  and the honest half is already built, on the page, in words.
- **The counts in a cell are still "on this screen".** Unchanged by the merge, and still
  labelled. The register's own figure appears only for the selected day.
- **A month older than the loaded pages is entirely plain.** Walking the strip back does
  not fetch that month; the page reads pages 1..N of the register newest-first and the
  strip reports what those rows say. *Why not yet:* the fix is either the counts route
  above, or reading with `dateFrom`/`dateTo` for the whole month on every month change —
  the second is a real extra read per click and was not taken without the founder.


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
- **The per-channel switches on this page did not reach the router until
  2026-09-02** ([ADR 0098](../decisions/0098-a-preference-is-read-from-the-column-it-lives-in.md)).
  `notifications.service.ts:1051-1053` read `email_enabled`/`push_enabled`/
  `sms_enabled` correctly, so the page rendered a user's choice faithfully — but
  `RecipientResolverService.checkChannelPreference`, which actually decides who
  gets sent to, never read those columns at all, and the two category arrays it
  *did* name (`order_channels`, `report_channels`) have never existed in any
  migration. Because the row is fetched with `.select("*")`, that produced no
  error — just `undefined`. On the stock row it inverted both channels at once:
  **email refused to users who had switched it on, SMS delivered to users who had
  switched it off**. Anyone reading old reports of "I turned SMS off and still get
  texts" should treat them as real, not as user error.
- **Routing is still not category-aware** — the resolver takes a union across
  three of the six per-category channel arrays and ignores the other three, so
  enabling email for financial reports also enables it for low stock. Tracked as
  **OD-121**; it needs a founder call on which category each of the seven
  `resolveRecipients` call sites belongs to.

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

**Added 2026-09-03 by the fourth pass — each one measured, not inferred.**

11. **The book has one producer.** 641 of 663 rows are `inventory_low_stock`,
    the other 22 are 21 weekly reports and one drafted reply; 57 distinct titles
    across 663 rows. Every layout question about this page is currently a
    question about three rendered lines. **Why not closed here:** the fix is
    producers (§13.17–§13.20), all of which write from modules this page does
    not own.
12. **Priority is a constant.** 631 of 663 rows are `critical`. The column is
    real and is set by `persistForRestaurant`, but every caller that matters
    passes `critical`, so it carries no information. Nothing on the rebuilt page
    sorts, groups or colours by it — a deliberate omission, recorded here so it
    is not mistaken for an oversight. **Why not closed here:** re-grading a
    producer's severity is a producer decision.
13. **`notifications` has no snooze column.** The table is
    `id, restaurant_id, recipient_id, notification_type, title, message,
    priority, channels, sent_at, delivered_at, read_at, delivery_status,
    actions, responded_at, response_action, response_data,
    related_entity_type, related_entity_id, notification_group, batch_id,
    created_at, user_id, type, status, action_url, action_label, metadata,
    archived_at, group_key`
    (`supabase/migrations/20260805000000_baseline_from_production.sql`). So
    snooze is per-browser and says so. **Why not closed here:** a migration, and
    this pass was not allowed to write one → §13.3.
14. **Four columns exist and are never written.** `related_entity_type`,
    `related_entity_id`, `notification_group` and `actions` are NULL on **663 of
    663** rows. The first two are what an account-shaped page (sketch 093 C)
    would fold on; the fourth is what a two-room split would use to tell a
    decision from a record without a hard-coded type list. **Why not closed
    here:** every write site is in a producer module → §13.21.
15. **`vendor_price_observations` is empty** — zero rows, for this tenant and
    for the market. The market-price box therefore reads a real endpoint over an
    empty table and says exactly that. **Why not closed here:** filling it means
    running the vendor page extractor or recording a quote by hand; both exist
    (`vendor-intel/vendor-page-extractor.service.ts`,
    `POST /vendor-intel/observations`) and neither is this page's to trigger →
    §13.22.
16. **The shared stacker can surface a stale line.** `pickStackWinner` keeps the
    below-par burst with the highest wine count regardless of date
    (`lib/notificationStack.ts:59-65`). The rebuilt page now prints the fold's
    newest stamp beside the winner's, but the sidebar badge, the header bell and
    the legacy page still show only the winner's age. **Why not closed here:**
    `lib/notificationStack.ts` is shared and outside these paths → §13.23.
- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** ~~`inventory_alert_state` was advanced for 7 wines while `notifications` holds 2 rows covering 3 — `low-stock-alerts.service.ts:200-215` stamps the ledger before the 15-minute cooldown at `:225-235`, so a suppressed crossing reads as alerted and the four silent wines wait for the once-daily digest (`:127-143`; absence 8). Raising a par through PATCH raises no alert (`inventory.service.ts` hooks only at `:330`, `:451`; defect 8).~~ **Absence 8 closed (#313):** `last_alerted_at`/`alert_count` are stamped only after an inbox row exists, and a crossing HELD by the cooldown or by prefs now has its own record (`last_held_at`, `last_held_reason`), its own read (`GET /notifications/low-stock/held/:rid`) and a banner on this page naming the wines — "the digest will cover it tonight" and "nothing is wrong" no longer render the same. Pre-2026-09-06 timestamps are NOT backfilled and are unreliable; the column comment says so. **Defect 8 closed separately (#312).** Also closed here: the inbox no longer folds two low-stock alerts about different wines into one row (intel finding 3). The page's "7 Wines Need Restocking" recovers the truth by live read; the stream does not.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** `lib/notificationStack.ts:36-37` keys every `metadata.mode === 'instant'` notification to one stack regardless of the wines it concerns; `pickStackWinner` keeps the higher count and the Alvear Solera 1927 alert (unread, high) never renders — "TODAY (1)" over 2 rows (defect 3). "Unread 3" over 2 rows is unexplained (`Notifications.tsx:307` counts before the fold).

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
(`notifications/notifications.controller.ts:47` class-level guard, routes :84-276).
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

- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** both notifications that did land carry `delivery_status.email = {ok:false, error:"no_recipients"}` — absence recorded as absence, which is the shape this page is supposed to have. **2026-09-05 (#313):** that shape now reaches the alert ledger too. Email delivery is deliberately NOT the test of whether an owner was told — the inbox row is — which is why those two `ok:false` outcomes were correct and are still recorded as failures.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** tiles and the TODAY section were read against the rows: 2 real notifications, 1 visible. A manager reading this page the morning after does not see one of the two alerts the night produced.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/notifications?userId=&status=` | JWT (class, `notifications.controller.ts:47`) | `:84-101` | Notification rows for the user |
| PATCH | `/notifications/:id/read`, `/:id/unread`, `/:id/archive` | JWT | `:203`, `:216`, `:229` | Updated row |
| PATCH | `/notifications/read/all?userId=` | JWT | `:189-201` | Count marked |
| DELETE | `/notifications/:id` | JWT | `:263-276` | 204 |
| GET | `/procurement/orders/pending`, `/procurement/orders` | JWT | `procurement.controller.ts` | Orders the action center turns into cards |
| GET | `/inventory/:rid` (low stock) | JWT | `inventory` module | Low-stock actions |
| GET | `/notifications/producers/status` | JWT (class) | `notifications.controller.ts:453` | The **nine** producers' own account of themselves (this row said "seven" while there were eight, and is corrected here rather than re-counted silently; the ninth landed 2026-09-05): `armed` (env `NOTIFICATION_PRODUCERS_ENABLED`), `served` (does `runPerTenant` enumerate this house), `timeZone`, `armingNote`, and per producer `{cron, intervalMinutes, nextTickAt, lastRun, lastRunUnreadable, willWrite, silentReason}`. `willWrite` is three-state: `false` with a reason (disarmed / not served / the market register is empty / nothing is suspended), `null` when a source read failed, `true` otherwise. Tenant from the token, never a query. Verified live 2026-09-03: 200 with a session, **401 without one**. Re-verified live 2026-09-04 against the local gateway on :4000: **seven** producers, `armed: false`, `served: true`, `armingNote` reading "arms all 7 producers". `lastRun: null` (never run) and `lastRunUnreadable: "<why>"` (the ledger could not be read) are separate fields on purpose. **The ninth row (`experiment_ended_unnamed`) does not obey `served`** — it runs outside `runPerTenant`, so its `silentReason` names `DEFAULT_RESTAURANT_ID` instead of the opt-in flag |
| GET | `/vendor-intel/below-average?windowDays=30` | JWT | `vendor-intel.controller.ts:95` | The market box's read, built in this same pass. **The market-price producer calls the same `VendorComparisonService.belowTrailingAverage`**, so the box and the book cannot disagree about the same bottle. A second `GET /notifications/market-signals/:rid` was specified in the brief and deliberately NOT built |

### Fed by

| Notification kind | Producer | Live? |
|---|---|---|
| Low stock | `@Cron("*/2 * * * *")` edge sweep + `@Cron("0 * * * *")` batched digest (`low-stock-alerts.service.ts:85,110`) → `persistForRestaurant` (`:305,347`) | Yes — memory: notifications-batching-sync |
| Vendor reply / draft ready | Gmail push → `email.inbound.received` → `rabbitmq-bridge.service.ts:528` → `InboundResponderService.analyzeAndDraftReply` → notification rows `inbound-responder.service.ts:1287` | Yes (live Gmail watch, OD-78) |
| Schedule published / acknowledged, broadcast | `team/schedule.service.ts:254,484`; `team/team.controller.ts:350` | Yes |
| Order approval, delivery, price | `procurement.service.ts:1062,1368` | Yes |
| Weekly report ready, delivery ETA, audit, event prep, custom reminders | **Seven** tenant-scoped `@Cron`s in `communications/scheduled-tasks.service.ts`, anchored on the decorator's `name:` rather than a line: `daily-sms-summary`, `weekly-email-report`, `recurring-order-reminder`, `delivery-eta-notification`, `inventory-audit-reminder`, `event-prep-check`, `custom-reminders-check` (`:193,228,407,522,625,679,734` — an eighth, `payment-due-reminder`, was deleted 2026-09-02 after [ADR 0077](../decisions/0077-there-is-no-payment-due-reminder.md) found it had never sent one email). Separately, `tenant-isolation-check` (`:159`) is the global tenant-isolation RPC, not a tenant-scoped one. **Count them with `grep -nE '^[[:space:]]*@Cron\('`** — a bare `grep @Cron` also hits `:274`, a `@deprecated` note recording that `sendMiddayLowStockReport`'s schedule was *removed* | **Per-tenant since 2026-08-26** (OD-87 / [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md)) — each iterates `ScheduledTenantsService.runPerTenant`, isolating per-tenant failures. But enumeration is **explicit opt-in** and no restaurant has opted in, so in practice this still serves exactly the `DEFAULT_RESTAURANT_ID` restaurant, which still takes its recipients from `MANAGER_EMAIL`. Whether that stays opt-in is **OD-91** |
| Agent-side writes | Historically silent-failing until 44.1d (`v3.0-TECH-DEBT.md:95-131`) | Fixed |
| **Goal reached** (`type: goal_reached`) | `notifications/producers/goal-reached.producer.ts` — reads `analytics_goals` (status `active`, `direction` `at_least`) and asks `GoalsService.getGoalProgress` for the number rather than re-summing the metric. Metadata carries `crossedAt` (the latest contributing source row, NOT the sweep time), `detectedAt`, `earlyByDays`/`earlinessPhrase` against `deadline`, and `onShift` from `public.shifts` via the new `shift-window.ts` | **Built, NOT armed.** Sweep `*/15 * * * *` under `runPerTenant`; writes nothing until `NOTIFICATION_PRODUCERS_ENABLED=true`. `at_most` ceilings are deliberately not reported — crossing a ceiling is not a success — and the run row says so |
| **Ceiling held** (`type: goal_reached`, producer `ceiling_held`) | `ceiling-held.producer.ts` — the founder's 2026-09-03 answer to the first pass reporting `at_most` goals as "not a success this producer reports on". A ceiling has no crossing: the success is a period that ran out with the house still under. Fires at **local midnight ending `analytics_goals.deadline`** on the house's own clock, carrying `periodEndedAt`, `headroom`, `headroomFraction` and the same roster/provenance keys the crossing producer uses. A ceiling that closed OVER is counted and named, never reported as a success | **Built, NOT armed.** `*/15 * * * *`, so a period closing at midnight is not reported a day late. Dedupe `goal:<goalId>:<periodEnd>`, so rolling a ceiling to a new month is a new line and re-reading a closed period never is. **Measured on production 2026-09-03: all 4 `analytics_goals` rows are `at_least` (3 active, 1 archived) — there is no ceiling goal in the house yet, so this producer has nothing to report until someone sets one** |
| **Delivery at the door** (`type: order_delivered`) | `delivery-recorded.producer.ts` — `procurement_receipt_events` where `stage = 'case_count'` (the only stage `recordDoorReceipt` writes, `receiving.service.ts:267`). States the receiver's own `outcome` first and the bottle arithmetic second; `expected_qty_bottles` NULL ⇒ `shortBottles: null`, never 0. A refusal is `priority: high` | **Built, NOT armed.** `*/15 * * * *`. Distinct from the verify/discrepancy rows `procurement.service.ts:1744,2362` already write — this one fires hours earlier, at the door |
| **Invoice certified** (`type: invoice_received`) | `invoice-confirmed.producer.ts` — `procurement_documents` where `status = 'verified'`, with amount, vendor and the tie-out. Never says approved, accepted or paid: verify "asserts only that the transcription is right" (`documents.controller.ts:305-310`), and a spec pins that vocabulary | **Built, NOT armed.** `*/15 * * * *`. This is §13.19's matching-good case; the two existing `invoice_received` producers still fire only on a discrepancy |
| **Sale record** (`type: service_closed`) | `sale-record.producer.ts` — one line per settled service day from `pos_checks` (`voided = false`), with checks, revenue, covers and the best seller by revenue. **No POS ⇒ no row**, asked of `GoalsService.getPosRevenueWindow` whose `posConnected` is the one place that decides it (`analytics/goals.service.ts`, `getPosRevenueWindow` over `hasPosHistory` — **no line number on purpose: that file moved twice during the 2026-09-03 session, so grep the function names**). A connected POS with zero checks also writes nothing — a closed Monday and a failed import look identical | **Built, NOT armed.** Checked hourly (`0 * * * *`); a day is summarised once `service-day.ts` says it has settled. **Measured on production `exzueerziesmczwlhomd` 2026-09-03: `pos_checks` holds 173 rows and `restaurants.operating_hours` is now non-NULL on 2 of them** — so both settle rules can fire, and the row names which one decided. (The migration header's "every existing row keeps NULL" was true on 2026-09-02 and is not any more.) |
| **Market price** (`type: price_change`) | `market-price.producer.ts` — calls `VendorComparisonService.belowTrailingAverage` (the box's own read), narrows to products **this house buys** (distinct `master_wine_id` on this restaurant's order items), and applies a 10% floor (`MARKET_SIGNAL_DROP_PCT`) and a 60% implausibility ceiling. One line per product per week | **Built, NOT armed, and MUTE if it were.** Once a day on the tenant's wall clock (`MARKET_SIGNAL_LOCAL_HOUR`, default 10). Measured on production 2026-09-03: `vendor_price_observations` holds **0 rows**, so nothing can fire regardless of arming — `GET /notifications/producers/status` says exactly that per producer (`willWrite: false`, `silentReason`), and the run row's `withheld_reason` distinguishes "nothing has been observed" from "nothing is cheap" |
| **Tool grant suspended** (`type: grant_suspended`) | `grant-suspended.producer.ts` — sweeps `mcp_tool_grants` where `needs_reconsent_at IS NOT NULL`, scoped to this house through `restaurant_mcp_connections.restaurant_id` (the grants table carries no `restaurant_id` of its own). The stamp is `McpConnectionsService.reconcileGrants` (`mcp-connections.service.ts:720-798`), which runs from `writeProbe` (`:1582`) alone. The sentence names the server, the tool, what changed in the server's own words (`needs_reconsent_reason`, e.g. "the server changed readOnlyHint true to false"), when the change was SEEN, and that only a manager re-consenting on `/connections` clears it. Metadata carries `connectionId`, `tool`, `previousHash` (the grant's `tool_list_hash`), `currentHash` (hashed from the connection's current `probe_tools`), `changedAt` and `changedAtSource`. **The only producer that narrows its own audience**: owners and managers only, resolved through `user_restaurant_access` (`role IN ('owner','manager')`, `is_active = true`) and intersected with the sweep's audience so quiet hours still decide delivery. A failed role read THROWS — neither "tell everybody" nor "tell nobody" is honest | **Built, NOT armed.** `*/15 * * * *` — a permission the house did not change is already being refused. Dedupe `grant:<grantId>:<toolListHash>`, so a standing suspension is written once however many times it is swept, and a re-consent (revoke-then-insert, `mcp-connections.service.ts:648-651`) followed by a fresh change is a new row with a new id and a new hash, and is said again. A tool WITHDRAWN by the server is reported as a revocation, not a suspension; a tool ADDED is now the **eighth** producer's line, not this one's, because it suspends nothing (`tool-classification.ts:172-176`). **Extended 2026-09-04 (founder): a suspension still standing is RE-SAID once a week, to OWNERS only** — key `grant:<grantId>:<hash>:week<N>`, audience narrowed a second time through `role IN ('owner')`, each line carrying `daysElapsed` and `weekOfSuspension` in its title and metadata. Week 0 is unchanged byte for byte, so a suspension already reported stays reported. Bounded at `MAX_REPEATS = 12` — a quarter — after which the run row keeps naming it and the inbox stops repeating it |
| **A tool was added** (`type: mcp_tool_added`, producer `added_tool`) | `added-tool.producer.ts` — the founder's 2026-09-04 answer to §13.30. An addition is an **information line, not a suspension**: the gate does not refuse it and no grant moves, which is exactly why the seventh producer is right not to speak about it (`tool-classification.ts:181-190`). Names the server, the tool and its declared classification; `unknown` is rendered as a **write**, never as read-only (`declaredClassification`, `tool-classification.ts:61-72`). Owners and managers only, same resolution and same THROW-on-failure as the seventh. Metadata carries `grantTouched: false` and says in words that nothing was granted | **Built, NOT armed.** `*/15 * * * *`. Dedupe `server:<connectionId>:tool:<name>:<firstSeenHash>`. **Needed a durable memory and there was none**: `user_mcp_connections.probe_tools` is overwritten by every probe (`probe_tools: outcome.tools`, `mcp-connections.service.ts:1666`), so nothing could tell an added tool from an old one. `notification_mcp_tool_sightings` (migration `20260904230000`) is the producer's own ledger — a table here rather than a column on `user_mcp_connections` so that **no hunk is needed in `mcp-connections/`**, which is under another builder's edit. The first sweep of a server SEEDS a baseline and announces nothing; a removed tool closes its run silently; a re-added tool opens a new run, so it is a new event and is said again. A probe that did not ANSWER closes nothing — a failed probe says nothing about what a server offers |
| *(all eight)* | `notification-producers.service.ts` holds the two crons; `producer-ledger.service.ts` is the only thing that writes. Every emission claims a row in `notification_producer_claims` (UNIQUE `(restaurant_id, producer, dedupe_key, user_id)`, migration `20260903143000`) BEFORE it writes, so two gateway instances cannot both speak. Each producer opens and closes a `notification_producer_runs` row per tenant per sweep, carrying `withheld_reason` — the producer's own sentence for a legitimate no-op, so a zero is never reported as health | The claim is **per person**, not per event, so quiet hours DEFER a reader instead of losing them the record. The row's `created_at` is then the delivery time, which is why every producer carries `metadata.occurredAt` and says the real time in words |

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
(the failure has its own state); and the per-browser nature of the snooze (until 2026-09-03, *Set aside*) is printed
next to it and in the footer.

## 13. Roadmap

1. ~~**Branch on `error`**~~ (`Notifications.tsx:157`) — **done on the rebuilt surface
   2026-09-02** (`notifications/next/useNotificationsNextData.ts`). Still open on the
   legacy page, which is what renders with the flag off.
2. ~~**Persist custom one-tap actions**~~ — **done 2026-09-02**, `POST /one-tap-actions`
   from `notifications/next`. Was correctly diagnosed as wiring, not new backend.
3. **Move snooze server-side.** Updated 2026-09-03: the shape is now known and
   the client half is built. Add `snoozed_until timestamptz` (and, to make
   wake-on-activity server-side, `snoozed_at timestamptz` plus the folded count
   seen at that moment) to `public.notifications`, then have
   `getNotifications` treat an expired `snoozed_until` as cleared on read — the
   exact pattern `analytics/recommendation-actions.service.ts:107-116` already
   uses for `/recommendations`, which is where this page's per-browser version
   is a downgrade rather than a design. Until then the page keeps the local
   record and says on the band, the row and the footer that the server was not
   told (§9.13).
3a. **Arm the price index, and give the houses a state.** The index box
   (`MarketIndexPanel.tsx`) is built and honest, but it can draw a LINE only
   when three things are true and today none of them is: the
   `price_index_postings` migration
   (`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql`) is
   applied to the project the gateway reads; `PRICE_INDEX_FETCH_ENABLED` names
   at least one source so a row is ever written; and the house has a
   `state_province` recorded (the demo tenant has none, and 2 of 14 tenants had
   none when ADR 0117 measured them). Until then the box's true first screen is
   the endpoint's sentence, which is the point — but it is not the founder's
   picture of the feature. **Michigan stays withheld** and no parser will be
   written for it until an honest sample exists; Türkiye and the UK are not
   jurisdictions the register recognises at all (`normalizeJurisdiction`
   returns null for both), which is ADR 0117 Q4, still the founder's call.

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
11. ~~**Server-side filters instead of client chrome**~~ — **done 2026-09-03**
    (fourth pass): `type` and `status` as pills, `dateFrom`/`dateTo` as the day
    rail, all four verified live against :4000. The quick search sits beside
    them and is labelled screen-side, because this table has no full-text index.
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

**Added 2026-09-03 by the fourth pass. Items 17–20 are the four registers the
founder named; each is a PRODUCER, and none of them is page work.**

*Status at the time of writing:* a sibling builder is landing all five producers
in this same wave, under `apps/api-gateway/src/notifications/producers/` —
`goal-reached`, `delivery-recorded`, `invoice-confirmed`, `sale-record` and
`market-price`, writing `goal_reached`, `order_delivered`, `invoice_received`,
`service_closed` and `price_change` respectively; the last of them calls this
pass's `VendorComparisonService.belowTrailingAverage` rather than repeating its
arithmetic, which is the seam working as intended. **This page's half is done
either way**: each of those five `type` values already maps to a named register
with its own mark, its own rail tally and its own filter pill, so the first line
a producer writes lands in the right register instead of in *Other*. The
specifications below are what this page needed from them, kept because they
record the reasoning and the two cautions (the shift roster, and the
one-line-per-service cadence) that a reader of this note will want. Where the
sibling's implementation differs, the sibling's file is the truth.

17. **A goal reached should write a line** — *being built, see the status note
    above.* `analytics_goals` and `GoalsService` exist (`analytics/goals.service.ts`, six supported metrics:
    `wine_revenue`, `bottles_sold`, `purchase_spend`, `checks`, `avg_check`,
    `wine_attach_rate`), and nothing writes a notification when a goal is met.
    The shape this page asked for: on the goal-progress pass, when
    `measure >= target` for the first time, call
    `persistForRestaurant(restaurantId, { type: 'goal_reached', title: '<Metric>
    goal reached — N days early', message: '<target> by <deadline>. Crossed at
    <HH:MM> on <date>.', priority: 'medium', actionUrl: '/reports?goal=<id>',
    groupKey: 'goal_reached:<goalId>', metadata: { goalId, metricKey, target,
    reachedAt, daysEarly, hoursEarly, onShift: [...] } }, { dedupeWithinMinutes: 1440 })`.
    The founder asked for **who was on shift** in the metadata: the roster lives
    in the `team` module, and note before promising it that production has no
    `staff` role and six of ten restaurants are owner-only (memory:
    production-tenant-shape) — an honest first version names whoever the roster
    actually holds and renders an em dash when it holds nobody, rather than
    inventing a crew. Add `goal_reached` to `NotificationType` and to
    `KIND_BY_TYPE` in `nt-format.ts` (register **Goals**, lucide `target`).

    **BUILT 2026-09-03** behind `NOTIFICATION_PRODUCERS_ENABLED` (off by default).
    The producer, its dedupe key and its schedule are in §11 Fed by; where the
    build diverges from the specification above, §13.25 says how and why.

18. **Delivery notifications** — *being built, see the status note above.* They
    already have a producer
    (`notifications.service.ts:374`, `type: 'order_delivered'`) — it is reached
    only through the push path. Route the receiving/stock-in completion in
    `procurement.service.ts` through `persistForRestaurant` with
    `type: 'order_delivered'`, `groupKey: 'delivery:<orderId>'` and metadata
    `{ orderId, providerName, invoicedQty, receivedQty, signedBy, signedAt,
    palletRef }` so the line can state what arrived and who took it.
    ~~Register **Deliveries** needs adding to `nt-format.ts`~~ — **done
    2026-09-03** (lucide `truck`).

    **BUILT 2026-09-03** behind `NOTIFICATION_PRODUCERS_ENABLED` (off by default).
    The producer, its dedupe key and its schedule are in §11 Fed by; where the
    build diverges from the specification above, §13.25 says how and why.

19. **Invoice confirmations** — *being built, see the status note above.* They
    have two producers already
    (`procurement.service.ts:1747` and `:2365`, both `type: 'invoice_received'`)
    and they fire only on a *discrepancy*. Add the matching-good case — "N of N
    lines matched, nothing outstanding" — so the register records the successes
    the founder asked for and not only the failures. Register **Invoices**
    (lucide `receipt`).

    **BUILT 2026-09-03** behind `NOTIFICATION_PRODUCERS_ENABLED` (off by default).
    The producer, its dedupe key and its schedule are in §11 Fed by; where the
    build diverges from the specification above, §13.25 says how and why.

20. **Sale records** — *being built, see the status note above.* `pos_checks`
    is the source and there was no producer at all when this was written. The shape that does not drown the book: **one line per service close**,
    not per check —
    `type: 'service_closed'`, `groupKey: 'service:<YYYY-MM-DD>:<service>'`,
    metadata `{ checks, bottlesPoured, wineRevenue, attachRate, avgCheck }`.
    Decide the cadence with the founder before building: per check would be
    ~100 rows a day and would make the split of sketch 093 B mandatory
    immediately.

    **BUILT 2026-09-03** behind `NOTIFICATION_PRODUCERS_ENABLED` (off by default).
    The producer, its dedupe key and its schedule are in §11 Fed by; where the
    build diverges from the specification above, §13.25 says how and why.

21. **Write a subject on every notification** — `related_entity_type` and
    `related_entity_id` are NULL on 663 of 663 rows (§9.14). One line at each
    `persistForRestaurant` call site: the wine id for a low-stock line, the
    order id for a delivery, the invoice id for an invoice line, the goal id for
    a goal. This is the single change that unblocks sketch 093 C (standing
    accounts), subdue-by-settlement (§13.16) and per-line rule history (§13.15)
    — three "need it: now" ideas behind one column.
22. **A price drop should write a line, and this is its exact shape.** The read
    exists as of this pass (`GET /vendor-intel/below-average`); the producer is
    being built by the sibling and calls that read. The specification this page
    handed over, kept for the record:
    a per-tenant scheduled pass under `ScheduledTenantsService.runPerTenant`
    (ADR 0022) that calls `belowTrailingAverage({ restaurantId, windowDays: 30,
    minObservations: 3 })` once a day, and for each item whose `fractionBelow`
    clears a stated threshold writes
    `persistForRestaurant(restaurantId, { type: 'price_change', title: '<product>
    is being quoted N% below its 30-day average', message: '<latest> now,
    against <average> across the N earlier sightings in the window. <vendor> ·
    <sourceType> · <observedAt>.', priority: 'medium', actionUrl:
    '/vendor-prices?product=<productKey>', groupKey:
    'price_below_avg:<productKey>:<YYYY-MM-DD>', metadata: { productKey,
    currency, latestPrice, averagePrice, observations, fractionBelow, vendorName,
    sourceType, observedAt } }, { dedupeWithinMinutes: 1440 })`. Three rules the
    producer must keep or it will become the second `low_stock_digest`: **(a)**
    one line per product per day, enforced by the `groupKey` and
    `dedupeWithinMinutes`; **(b)** a threshold the reader can restate — the page
    already prints the rule, so the producer must print the same one; **(c)** it
    must not fire again while the same drop is still open, which needs §13.21's
    subject key to do properly. **Blocked in practice until
    `vendor_price_observations` has rows at all** (§9.15).

    **BUILT 2026-09-03** behind `NOTIFICATION_PRODUCERS_ENABLED` (off by default).
    The producer, its dedupe key and its schedule are in §11 Fed by; where the
    build diverges from the specification above, §13.25 says how and why.

23. **Fix the stale fold at source** — `pickStackWinner`'s `max_count` mode
    (`lib/notificationStack.ts:59-65`) should keep the newest and carry the
    highest count as a figure, rather than keeping the oldest-and-biggest row.
    The rebuilt page works around it by printing both stamps; the sidebar badge,
    the header bell and the legacy page still cannot (§9.16).
24. **Then, and only then, sketch 093 B.** Once §13.17–§13.20 are writing, the
    record registers will outnumber the decisions by two orders of magnitude and
    the two-room split becomes the right layout rather than an empty promise.
    The rule that assigns a room should be `actions`-driven (§13.21) rather than
    a hard-coded type list, so a new producer cannot land silently in the wrong
    room.

25. **What the six producers still need, and none of it is theirs to take.**
    The producers landed 2026-09-03 (`apps/api-gateway/src/notifications/producers/`,
    migration `20260903143000_a_producer_claims_before_it_writes.sql`). Five things
    were measured and deliberately NOT built, each outside the producers' own paths:

    a. ~~**Two lines in `nt-format.ts`.**~~ **CLOSED the same day, by the page
       owner.** `KIND_BY_TYPE` (`nt-format.ts:95-125`) now carries all five of
       the types these six producers write (the ceiling producer reuses
       `goal_reached`; a distinct `goal_held: 'Goals'` would read better and is
       the page owner's one-line call), each in a register of its own:
       `order_delivered: 'Deliveries'`, `invoice_received: 'Invoices'`,
       `service_closed: 'Sales'`, `goal_reached: 'Goals'`,
       `price_change: 'Market'`. The producers deliberately did NOT invent new
       type words for the three that already had one — a type the map does not
       carry files the row under **Other**, and which register a row belongs to
       is a page decision, not a producer's.

    b. **`is_outlier` has no writer, anywhere.** Grepped 2026-09-03 across `apps/`,
       `services/`, `scripts/` and `supabase/migrations/`: the column is
       `DEFAULT false NOT NULL`
       (`20260805154027_vendor_price_observations.sql:99`) and nothing ever sets
       it. So `belowTrailingAverage`'s `.eq("is_outlier", false)`
       (`vendor-comparison.service.ts:340`) excludes nothing, and the engine's own
       list of what scraped prices carry — "a decimal lost, a case price read as a
       bottle price, a '$1,200' that is really $12.00"
       (`vendor-price-consensus.ts:11-19`) — describes exactly the rows that look
       most like a bargain. The market producer compensates with a stated
       implausibility ceiling (60%, `market-signal.ts`), which is a bound and not a
       dispersion test. **The real fix belongs to `vendor-intel/`:** run the
       consensus pass (`flagOutliers`, `vendor-price-consensus.ts:180-192`) and
       persist its verdict, or drop the filter and say the box is unscreened.

       **DECIDED (proposed) 2026-09-04 —
       [ADR 0117](../decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md).**
       The writer is the MAD test this note names, run **over the group after a batch
       lands** — never at write time, and never as a bound on the incoming value,
       because outlier-ness is a property of the group and the column's own comment
       already says so. A flagged row stays in the ladder so a bad parse is visible
       and fixable at source. Still unbuilt; the ADR is Proposed.

       **BUILT 2026-09-04, and the founder moved it to write time.** `is_outlier`
       now has a writer: `recordOwnPaperSighting`
       (`apps/api-gateway/src/procurement/procurement.service.ts`) calls
       `isOutlierAgainstPriors`
       (`apps/api-gateway/src/procurement/own-paper-sighting.ts`), which is
       `flagOutliers` (`vendor-price-consensus.ts:188`) run over this product's
       existing sightings plus the candidate, at the moment the sighting is
       written rather than as a later pass over the group. That is a deliberate
       divergence from the ADR's own wording, recorded in its Status line; it is
       still the MAD test and still never a bound — nothing is clamped, nothing
       is rejected for being extreme, and a flagged row is written and stays
       visible. It carries a five-value sample floor, because `flagOutliers`'
       MAD-is-zero branch flags BOTH values of a two-row group and
       `belowTrailingAverage` filters flagged rows out — a house's second-ever
       invoice would otherwise erase its first.

       **Scope, stated plainly:** this covers rows the OWN-PAPER mirror writes.
       The other two writers — the website scrape
       (`vendor-page-extractor.service.ts:331`) and the manual observation
       (`vendor-comparison.service.ts:260`) — still write `is_outlier` at its
       `false` default and are still unscreened. The scrape is the writer whose
       parses this note names as the dangerous ones, so the gap that matters
       most is the one still open.

       **The scrape half is now CLOSED too, 2026-09-04, and the box gained a
       second line.** The founder answered ADR 0117's Q1 — *"Run it, labelled
       tier 4, never beside a quote"* — and three things followed, all on
       `feat/mudavym-design-p4`:

       * `apps/api-gateway/src/vendor-intel/vendor-site-sweep.service.ts` is a
         daily sweep of every active provider with a website, per restaurant,
         **OFF by default** behind `VENDOR_SITE_SWEEP_ENABLED`, honouring
         robots.txt and each host's own `Crawl-delay` above a stated 10-second
         floor. One vendor's failure never ends it.
       * The scrape writer now judges `is_outlier` with the **same**
         `isOutlierAgainstPriors` at the **same** five-value floor as the
         own-paper mirror, imported rather than reimplemented
         (`vendor-site-sighting.ts`). It also refuses what it cannot name: no
         bottle volume is a refusal, not a 750, and every refusal is counted by
         reason. Expect most scraped rows to be refused — shop pages rarely
         print a size beside the price — and the count says so rather than
         letting a thin register look like a quiet market.
       * **This box's endpoint changed shape.** `priceBelowAverage` now
         partitions each product's sightings by class before comparing
         (`comparisonClassOf`), so a tier-4 page price is never averaged
         against, or ranked beside, a quote. `items` carries only quoted
         comparisons; the new **`publicSiteItems`** carries the tier-4 ones, and
         `scanned.comparisons`, `byClass` and `skipped.unrecognisedClass` are new
         alongside it. Measured against a copy of HEAD's file, the pre-fix
         function reported a $50 scrape as a **50% saving** against a $100
         invoice average. **The UI was not changed in that pass** —
         `MarketPricePanel.tsx` and `useMarketPrice.ts` were off-limits then and
         a ready patch sat in the build report. **That patch is now APPLIED
         (2026-09-04):** `useMarketPrice.ts` carries `sourceClass` and
         `publicSiteItems` (plus `scanned.comparisons` and
         `skipped.unrecognisedClass`, added beyond the patch so a new source type
         is loud on the box rather than silently dropped), and
         `MarketPricePanel.tsx` draws the tier-4 list under its own heading with
         both empty states gated on it. What the patch proposed and this build
         did NOT keep: its wording *"this house's own quotes plus public list
         prices"* in the rule paragraph, which became false the moment the two
         were separated — the paragraph now says the ladder is built from quoted
         prices and that public-site prices are ranked separately below.
       * The remaining unscreened writer is the **manual observation**
         (`vendor-comparison.service.ts:260`), which still writes `is_outlier`
         at its `false` default.

       **The third writer is now screened too, and the batch pass exists,
       2026-09-04 (later the same day).** ADR 0117's Q7 — *should the batch
       outlier pass still be built alongside the write-time one?* — was answered
       **BOTH**, and both halves are on `feat/mudavym-design-p4`:

       * **The manual observation is no longer exempt.**
         `VendorComparisonService.recordManualObservation` now runs the SAME
         `isOutlierAgainstPriors` at the SAME five-value floor as the other two
         writers, over sightings of the same product **in the same comparison
         class** (`comparisonClassOf`), so five scraped page prices can never
         make a quoted one look deviant. It is never a bound: the typed number
         is stored exactly as entered, and the verdict is returned to the caller
         so the person who typed it is told the row was set aside rather than
         discovering later that it never reached the ladder. Measured against a
         copy of HEAD's file, the pre-fix writer put a $2175 typed price — four
         priors near $20 on the register — in with **no verdict on it at all**.
       * **The nightly re-judge**
         (`apps/api-gateway/src/vendor-intel/outlier-rejudge.ts` and
         `outlier-rejudge.service.ts`), **OFF by default** behind
         `PRICE_OUTLIER_REJUDGE_ENABLED`. It re-runs the MAD test over exactly
         the window the readers use — `belowTrailingAverage`'s trailing
         `windowDays ?? 30` — grouped by `(tenant scope, product identity,
         comparison class)`, and sets or clears `is_outlier`. It never touches a
         group below the five-value floor, never touches a mixed-currency or
         unrecognised-class group, and one product's failed write never stops
         another's. Why both: **write time protects** (it is the only judge that
         exists in the hours between a bad parse landing and any batch running),
         **the re-judge corrects** (a row flagged against four neighbours stays
         flagged forever once forty more arrive that prove it ordinary — only a
         pass over the group can clear it).
       * **The verdict is now legible.** Migration
         `20260905000000_an_outlier_verdict_names_its_reason.sql` adds
         `outlier_reason`, `outlier_judged_at` and `outlier_basis`
         (`write_time` | `rejudge`), all **nullable**, because a NULL is the
         honest value for the rows written before any judge existed — and it is
         what finally separates "judged clean" from the column DEFAULT of a row
         nobody has ever looked at. `is_outlier` itself is unchanged, so this
         box's `.eq("is_outlier", false)` filter behaves exactly as before.
       * **`GET /vendor-intel/outlier-rejudge/status`** (owner-only) carries
         armed-or-not, the last run, rows judged, flags set and cleared, groups
         left alone by reason, and a SENTENCE saying why it is quiet. Verified
         live on :4000: `armed: false`, `lastRun: null`, and the sentence *"No
         stored outlier verdict has been revisited, so every flag on the
         register is the one its writer set when the row landed."* An empty flip
         count from a switched-off job must never read as agreement.
       * **The readers are UNCHANGED.** They still filter `is_outlier` and
         nothing else; the proof that a flip actually reaches this box is
         `outlier-rejudge.spec.ts` — *"the cleared row then reaches the reader,
         which is the point"* — which applies a flip and re-runs
         `priceBelowAverage` through the same filter.
       * **Still open, deliberately:** the re-judge groups market rows
         (`restaurant_id IS NULL`) **on their own**, which is narrower than the
         reader's `restaurant_id.is.null OR restaurant_id.eq.<tenant>` union.
         `is_outlier` is one boolean on one row and cannot carry a different
         verdict per house; judging a market row inside one tenant's union would
         let that house's invoices decide what every other house may see. Filed
         as a founder-visible consequence in ADR 0117 rather than hidden.

    b3. **The register's first fill is BUILT, 2026-09-04.** The mirror b2 below
       calls "the whole of step one" now exists. Both `price_history` writers
       (`procurement.service.ts` receipt verification and order confirmation)
       write a tenant-scoped row into `vendor_price_observations` beside the
       `price_history` row: `invoice`/trust tier 1 for a verified receipt, in the
       INVOICE's own unit and pack as `toBottleOperands` already resolved them,
       and `quote`/trust tier 2 for a confirmed order. `restaurant_id` is never
       null. Idempotent on the table's existing UNIQUE `(source_ref,
       content_hash)` index, so no migration was added and RLS is unchanged.
       Every leg of ADR 0117's five is a REFUSAL when absent, logged as a
       sentence rather than defaulted — in particular a missing
       `restaurant_inventory.bottle_size_ml` writes nothing rather than assuming
       750ml. Proof: `apps/api-gateway/src/procurement/own-paper-sighting.spec.ts`
       (14 tests, including the real `priceBelowAverage` run over the rows the
       real writer produces).

       **This does not light the market box, and was never going to.** The bar
       is four sightings for one product inside thirty days (b2 below); own paper
       produces one per confirmation and one per verification. Measured locally
       2026-09-04 after the build, `GET /vendor-intel/below-average` answers 200
       with `scanned.observations` **0** — this environment's register is empty
       and nothing has been received or confirmed in it. The honest sentence on
       the page stands; what changed is that receiving a delivery now moves it.

       Two things stayed unbuilt and are the founder's call, filed as ADR 0117
       Q6 and Q7. **Q6, stated exactly:** an `order_confirmed` sighting is
       written **only when the order's resolved pack is exactly one bottle**.
       Every other pack is refused with a logged sentence — a **known** pack of
       12 just as firmly as an unreadable unit, because knowing the pack does not
       tell us which unit the PRICE is in, and nothing on `procurement_orders`
       states the unit of `final_price` separately from `unit_type`. So the
       register currently takes the receipt path in full and the confirmation
       path only for bottle-priced orders. **Q7:** whether a batch outlier pass
       should still be built alongside the write-time one.

    b2. **What would fill the register first — decided in
       [ADR 0117](../decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md),
       2026-09-04.** The market box's honest sentence ("the register holds no
       sighting this restaurant can see") stands, and the note can now say what
       would end it. Re-measured on production **2026-09-04**:
       `vendor_price_observations` **0**, and so is every table that could feed it —
       `price_history` **0**, `procurement_documents` **0**,
       `procurement_document_lines` **0**.

       The first fill is **the house's own paper, and it needs no vendor and no
       fetch.** `price_history` now has a writer (`procurement.service.ts:900`,
       called at `:2902` when a receipt is verified and `:4393` when an order is
       confirmed) — but it writes a **different table**, so the best-provenanced
       price this house will ever have, a checked invoice line at trust tier 1,
       never reaches the box. Mirroring those two writes into
       `vendor_price_observations` as tier-1/2 tenant-scoped rows is the whole of
       step one.

       Three things measured the same day say why nothing else comes first:

       - **A monthly published list can never light this box.** `MARKET_WINDOW_DAYS`
         30 with `MIN_BASELINE_OBSERVATIONS` 3 *earlier* sightings needs **four
         sightings inside thirty days**; the `(source_ref, content_hash)` dedup index
         correctly discards a re-read of an unchanged price, so a monthly file yields
         **one**. Loading 13,762 rows would leave this box exactly as silent as it is
         now, while making the register look full.
       - **Jurisdiction is not optional and has no column.** The estate is 3 Michigan,
         3 Illinois, 3 California, 2 Türkiye, 1 UK, 2 unstated. The two sources that
         parsed perfectly today (Iowa, Oregon) serve **zero** of them and are retail
         shelf prices — Iowa's is its own cost × **exactly 1.50** at the median. Under
         the founder's index rule they are a separate line, never a vendor quote.
       - **A 200 is not freshness.** `https://www.ams.usda.gov/mnreports/bh_fv020.txt`
         answered **200 with a price report dated 03-JAN-2024** on 2026-09-04 — 975
         days stale. Any fetcher this page's data comes from has to refuse on the
         **issuer's** date, not on the status code.

       Full registry of 27 sources with the result of today's fetch against each:
       [`.planning/07-reference/price-sources.md`](../07-reference/price-sources.md).
       Dry-run proof (writes nothing; `--apply` refused with its three blockers):
       `scripts/fetch_price_sightings.py`.

       **Update 2026-09-04 — steps 2 and 3 are BUILT, as a SEPARATE register.**
       The migration ADR 0117 called a precondition now exists
       (`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql`,
       `price_index_postings`, keyed by state not restaurant), and the gateway
       `price-index/` module parses **California live** (class B beer posting, the
       app's own anonymous JWT path) plus **Iowa/Oregon** control-state shelf lines
       (class D); **Michigan is withheld** (403, no honest sample, no parser). This
       is the index line the founder asked for — *"show control-state shelf prices as
       a labelled index line in their own register, state-scoped"* — and it is
       **not** the market box: `GET /price-index/:state?product=` returns it for a
       house's own state, each line carrying its class/issuer/date so it draws as its
       own line and never beside a vendor quote (ADR 0111). The market box
       (`MarketPricePanel.tsx`) stays exactly as it is (own-paper class-A only); the
       index line is a NEW panel beside it, and the ready patch to add it lives in
       ADR 0117's build report — it is **not applied here** because this file's owner
       is editing `notifications/next/` concurrently. The scheduled fetch defaults
       **OFF** (`PRICE_INDEX_FETCH_ENABLED`); `GET /price-index/status` says per
       source when it last fetched, how many rows, and why it is silent.

       **Update 2026-09-05 — the retail row of that same index line.** The founder's
       call — *"point it at merchant shops, as their own class"* — adds a second kind
       of class-D source beside the control states: a **merchant shop's shelf price**,
       read off the shop's own markup and filed in the SAME register with
       `source_class = 'retail_reference'`, so the panel draws it exactly as it draws
       Iowa and Oregon: **"retail reference, <shop>, <date>"**, its own line, never
       beside a quote. Nothing on this page changes and no new endpoint is needed —
       `GET /price-index/:state` already returns `sourceClass`, `issuer` and
       `issuedAt` per line, and a shop row fills those with the shop's name and the
       date the shop itself states the price applies from. The instrument is
       `apps/api-gateway/src/vendor-intel/shop-reference-sweep.service.ts`, OFF behind
       **two** flags (`PRICE_REFERENCE_SHOP_SWEEP_ENABLED` to run at all,
       `PRICE_REFERENCE_SHOPS_ARMED` to name which shops), with
       `GET /vendor-intel/shop-sweep/status` returning every registered shop including
       the ones deliberately not fetched and the reason for each.

       **The panel's date wording changed with it (2026-09-05, ADR 0117 Q27).** A
       shop publishes no date, so its row carries the day WE read the page under
       `issued_at` with `issued_at_basis = 'fetch_date'`, and the line now prints
       **"read on <date>"** for such a row — **"issued <date>"** is reserved for a
       date a publisher actually stamped, and a row whose basis is NULL (written
       before the column existed) gets the weaker wording too. The class label
       moved with it: `retail_reference` reads **"Retail reference"** rather than
       "Control-state shelf price", which stopped being true the moment a merchant
       shop joined the class. `MarketIndexPanel.tsx` + `useHouseIndex.ts`; three new
       cases in `MarketIndexPanel.test.tsx`, proved against a `git show HEAD:` probe
       that rendered a Berry Bros line as "Control-state shelf price … issued".

       **What the panel will actually have to say for a while, measured 2026-09-05.**
       Of six recorded merchant pages, **four** are admitted (three of them dated by
       our read, one by the shop); one publishes structured data about a different
       product, and one serves USD on a London shop. Of the estate's markets, only **GB-ENG (1 house)** and **US-CA (3
       houses)** have a shop that may be fetched today: Illinois' candidate answers
       403 at its own sitemap, Michigan's declares no content signal, and Türkiye
       publishes no shelf price at all. So the honest empty state for a house here is
       not "no prices" but the sentence naming which of those it is — which
       `silenceFor` (`price-index.service.ts`) already carries for the fetch and which
       the shop status endpoint carries per shop. Filed as a gap only in the sense
       that the panel itself is still the unapplied patch above; the sentences exist.

    c. **A subject on every row (§13.21) is what the producers want next.** All
       five write rich `metadata` (`goalId`, `receiptEventId`, `documentId`,
       `serviceDate`, `productKey`) but leave `related_entity_type` /
       `related_entity_id` NULL, because `persistForRestaurant` has no parameter
       for them (`notifications.service.ts:613-637`). One optional field on that
       payload and one line per producer closes it.

    d. **Nothing sets `analytics_goals.status = 'achieved'`.** The goal producer
       reports the crossing and does not touch the goal's lifecycle — that is a
       write into the analytics module, and which of `achieved` / `active` a
       crossed-but-continuing goal should hold is a product question nobody has
       answered.

    e. **The threshold and the two schedule hours are stated defaults, not
       measurements.** `MARKET_SIGNAL_DROP_PCT` = 10% (the box's own floor is 2%,
       `price-below-average.ts:120` — a box may show a small movement where a
       notification should not interrupt anyone), `MARKET_SIGNAL_LOCAL_HOUR` = 10
       on the tenant's clock, and the service day settles 6 hours past local
       midnight while `restaurants.operating_hours` is NULL on every row
       (`20260902210000`, its own header). All three are env-overridable and all
       three travel in the notification's metadata so a reader can check the
       sentence against the number that produced it — Stripe's shape, where
       `usage_threshold[gte]` is a field an operator sets rather than a constant
       hidden in code
       (<https://docs.stripe.com/billing/subscriptions/usage-based/alerts>).
       **They are the founder's to move.**

26. ~~**Arming these producers is a founder decision**~~ — **DECIDED 2026-09-03:
    the founder said arm all of them.** `NOTIFICATION_PRODUCERS_ENABLED=true` on
    the gateway is the ONE switch and it arms all eight for the deployment; there
    is deliberately no per-producer switch, because six env vars is six ways to
    have half a house watched and no way to see which half. The status route
    states this in `armingNote` and, per producer, in `willWrite` +
    `silentReason`. Off by default and
    deliberately not wired to `mudavym_design_notifications`: a design flag decides
    what a page looks like, never whether a house gets woken up. Same shape and
    same reasoning as `CALENDAR_REMINDERS_ENABLED`
    (`calendar/reminder-window.ts:283-300`). Note that
    `ScheduledTenantsService.runPerTenant` serves only opted-in restaurants
    (ADR 0022, OD-91), so arming alone reaches exactly the
    `DEFAULT_RESTAURANT_ID` house until a `scheduled_communications` flag row
    exists — `GET /notifications/producers/status` reports both facts separately
    and never infers one from the other.

27. **Which producers the house needs next — researched, measured, none built.**
    The founder's "if more is needed research them" (2026-09-03). Sources were
    counted on **production `exzueerziesmczwlhomd`, 2026-09-03**, because a
    producer whose source table is empty is a feature that cannot fire, and that
    is a fact about the build rather than about the restaurant. The six that
    exist are marked ✅ for contrast.

    | Producer | Source table it would read | Rows in prod today | Verdict |
    |---|---|---|---|
    | ✅ goal reached / ceiling held | `analytics_goals` | **4** (all `at_least`; 3 active, 1 archived) | built; the ceiling half has no candidate row until someone sets an `at_most` goal |
    | ✅ sale record | `pos_checks` | **173** | built; the only producer with a populated source and a populated clock |
    | ✅ delivery at the door | `procurement_receipt_events` | **0** | built; silent until a door receipt is taken |
    | ✅ invoice certified | `procurement_documents` | **0** | built; silent until a document is verified |
    | ✅ market price | `vendor_price_observations` | **0** | built; silent, and says so per producer on the status route |
    | **Stock ran out** | `restaurant_inventory` **206**, `inventory_transactions` **215**, `inventory_lots` **138** | **populated** | **the strongest candidate.** Low stock is already produced; *ran out* is not, and it is the one stock fact nobody can act on late. `LowStockAlertsService` has the read; it needs a zero-crossing and the claim ledger, not a new sweep |
    | **A pour that emptied the last bottle** | `pour_events` **72**, `wine_consumption_log` **107** | **populated** | second strongest, and the same event seen from the other side. Decide which of the two is the subject before building either, or the house gets two lines for one bottle |
    | **A POS line nobody has mapped** | `pos_unresolved_lines` | **130** | real, and quietly expensive: 130 unmapped lines are 130 sales the ledger cannot attribute. One digest per week, not per line — the volume is exactly the shape §13.24 warns about |
    | **A menu item that outlived its stock** | `menu_items` **342** × `pos_item_mappings` **254** | **populated** | the join exists and is unread. "You are still selling something you cannot pour" is a sentence only this product can write; it needs `beverage_house_key`, not a new table |
    | **Vendor cutoff closing** | `providers.lead_time_days` + vendor terms | **terms table is new and empty** | DESIGN-FOUNDATION §6 names it twice — `/calendar`'s "order-by windows as calendar objects" and `/notifications`' "truck-inbound as a self-expiring item". **Blocked**: the cutoff has no home until the vendor-terms tab lands (§6, `/settings` row) |
    | **Subdue-by-settlement** (§13.16) | `procurement_credits` **0**, `procurement_orders` **2** | **effectively empty** | the competitor lens's "need it: now" idea, and the one nobody else does. It is not a producer that WRITES a line — it is a producer that RETIRES one, so it needs §13.21's subject key first |
    | **A conversation that went quiet** | `procurement_conversations` | **27** | a vendor thread with no reply in N days is a real fact with a real reader. Overlaps `InboundResponderService`; check before building that it is not already said |
    | **An insight nobody read** | `analytics_insights` **6**, `recommendation_actions` **1** | thin | **do not build.** Six insights and one action is not enough signal to notify over, and a producer that fires on our own unread output is queue-clearing wearing the clothes of health — the exact thing `/recommendations`' lens says not to copy |
    | **A shift nobody covered** | `shifts` **0**, `time_off_requests` **0** | **empty** | **do not build yet.** Production has no `staff` role and six of ten restaurants are owner-only (memory: production-tenant-shape); the roster is empty, which is also why every notification this wave writes says "the schedule names nobody on shift at that hour" rather than naming a crew |

    **The through-line.** Four of the six producers built this wave are correct and
    mute, because their sources are empty; the two candidates worth building next
    (**stock ran out**, **the last bottle poured**) are the ones whose sources
    already hold hundreds of rows. Build toward the data that exists, not toward
    the table that sounds most important.

28. **Give the register a per-day count route.** `GET /notifications/counts?from=&to=`
    (or a histogram on the existing route) is the one thing that would let the day strip
    speak about a day the loaded pages do not reach. Today the strip is honest about
    exactly that limit and no more: it hatches only days strictly newer than the oldest
    row on screen, where the newest-first contiguous read makes "no rows on screen" mean
    "no rows in the register" (§1b fifth pass, §9). Gateway work, filed 2026-09-04.
29. **Decide which other pages take the house day strip.** ADR-adjacent: the strip is now
    `components/mudavym/DayStrip.tsx`, shared by this page and `/recommendations`
    (`DayRail.tsx` deleted 2026-09-04, `DESIGN-FOUNDATION.md` §3 item 4 amended).
    Nothing decides whether `/calendar`, `/reports` or `/logs` should adopt it, and
    nothing stops a fourth page growing its own again — a guard is the shape that would,
    and is not built.

30. ~~**A tool being ADDED to a connected server is reported nowhere.**~~
    **CLOSED 2026-09-04 by the founder's call and the eighth producer**
    (`notifications/producers/added-tool.producer.ts`, §11). The decision this
    item said was needed first was made: an addition is an **information line,
    not a suspension** — no grant is created, changed or suspended, and the row
    says so in `metadata.grantTouched: false`. The durable comparison it also
    asked for is `notification_mcp_tool_sightings` (migration
    `20260904230000`), built as the producer's OWN table rather than a column on
    `user_mcp_connections`, so nothing in `mcp-connections/` — under another
    builder's edit — had to change. Measured before deciding:
    `user_mcp_connections.probe_tools` already holds a tools/list result
    (`20260903104500:89-92`) but every probe OVERWRITES it
    (`mcp-connections.service.ts:1666`), so no previous list existed anywhere in
    the schema. Fourteen tests, including the founder's two by name — a tool is
    written once and never again for the same first sighting, and a
    removed-then-re-added tool is written again.

31. **`grant_suspended` has no register on the rebuilt page yet.** `KIND_BY_TYPE`
    in `notifications/next/nt-format.ts` does not carry the type, so these rows
    fall to *Other* — the exact way a new register goes invisible that the map's
    own comment warns about. The one-line patch is written out in the pass
    report; it was not applied because that file is under concurrent edit by the
    day-strip builder. Web-only, blocking nothing in the gateway.

32. ~~**A suspension is said once and then never again.**~~ **CLOSED 2026-09-04
    (founder): a suspension still standing is re-said weekly, to owners only.**
    `grant-suspended.producer.ts`, key `grant:<grantId>:<hash>:week<N>`, seven
    tests. Two properties worth naming because they are easy to get wrong: the
    week arithmetic is on `needs_reconsent_at`, NOT on when this producer first
    spoke, so a house that arms the producer late hears the true age of the
    suspension rather than the age of our knowledge of it; and the repeats
    escalate to `role IN ('owner')` rather than re-pinging every manager weekly,
    which is the founder's call and is stated in each row's
    `metadata.audience`. Bounded at twelve weeks — the run row and
    `/connections` keep carrying it after that, the day book stops.
33. **`mcp_tool_added` has no register on the rebuilt page yet**, exactly as
    `grant_suspended` does not (§13.31). Same one-line patch, same file under
    the same concurrent edit, same reason it was not applied here. Both types
    fall to *Other* until the page owner adds them; the producers deliberately
    did not invent a type the map already carries.
34. **An added tool's classification is the server's word, and nobody checks
    it.** `declaredClassification` reads `readOnlyHint` and treats anything else
    as a write, which is the right default and is not verification: a server may
    declare `readOnlyHint: true` on a tool that writes. Nothing in this product
    can tell. The line says what was DECLARED and by whom, never what the tool
    does — and `confirmClassification` (`tool-classification.ts:128`) is where a
    human's verdict would land if the founder ever wants one.
35. **Correction to `29e439c4`'s commit message — the two-clock test's clocks
    are not three years apart.** A commit message cannot be edited once pushed,
    so the correction is filed here, where that commit's producers live. The
    message says the hermetic-clock proof runs *"a three-sweep sequence under
    two clocks three years apart"*. The clocks are `2025-01-15T09:00:00Z` and
    `2027-11-02T22:30:00Z` (`notifications/producers/market-price.producer.spec.ts:203-204`, `:200-201` before this pass added three comment lines above them):
    **1,021 days — two years, nine months and eighteen days.** The same test's
    own comment said something different and also wrong — *"two clocks a year
    apart"* — so the two statements about this test disagreed with each other
    and neither matched the code. The comment is corrected in place
    (`market-price.producer.spec.ts:182-187`, the 16 tests in that file still
    pass); the message stands as written and is corrected only here. Nothing
    about the proof changes: what makes it hermetic is that BOTH runs execute
    the whole three-sweep sequence and assert identical tallies, not the size of
    the gap between them.

### 13.30 The produce index draws in its own box (ADR 0117 Q24, 2026-09-05)

The founder, shown that the only public UK source found is Defra's wholesale
fruit and vegetable prices: **"Show it, labelled as produce, in its own box"** —
an honest index of a market the house also buys from, never beside a wine quote,
with the label saying what it is.

`MarketIndexPanel.tsx` now splits the register's lines on whether their SOURCE
carries a `display` block in the gateway registry, not on the class — the rule
lives where the evidence is, so the panel only draws what the registry decides.
A labelled source gets its own titled `<section>` **below** the drinks list and
never beside it:

> **Wholesale produce · Defra · England and Wales · read on 5 Sep 2026**
> *A market this house also buys from. It is not a drinks price and is never
> compared with one.*

The date on that title is **ours** — `fetched_at`, "read on" — because it is the
one date the box can always stand behind; the rows inside keep §13.29's
`issuedAtBasis` rule and say "issued" only where a publisher stamped a date. The
main heading still names the DRINKS class held, so a box holding only produce is
never announced as a drinks list. A source with no `display` renders exactly as
it did, which a test asserts.

**Nothing is showing yet, and the box says why.** `price_index_postings` is
absent from the project this deployment reaches, and the Defra fetch is off
until **`PRICE_INDEX_FETCH_ENABLED`** is set on the deployment — a switch the
founder flips, not a code change and not a toggle in the product. Until then the
box prints the endpoint's own sentence naming the produce list and that variable
by name, because a reader who cannot find the switch assumes the product is
broken.

Captures (STUB-labelled, real components and real values from the 31/08/2026
edition, no request leaving the browser): `p4-scratch/shots-defra-line/`.

### 13.31 The market box says which key it grouped on (ADR 0124, 2026-09-05)

`priceBelowAverage` — the pure half of this page's "cheaper than usual" box — now
prefers a **confirmed bottle identity** as its group key (`identity:<uuid>`),
falling back to `wine:<uuid>` then `sig:<hash>` exactly as before, and it
**reports which per item** (`keyedBy`) and in one sentence (`groupingNote`).

**Why the box has to say it.** `normalizeUnitPrice`
(`analytics/engine/vendor-price-consensus.ts:132`) scales every sighting to a
price per 750 ml, so a 375 ml half bottle and a 750 ml bottle of one wine reduce
to the same number — and until now they landed in the same group, because the
group key was the wine. ADR 0119 Q7 named that: *volumetrically right,
commercially wrong.* Grouping by identity fixes it where an identity exists;
where none does, the old behaviour is unchanged and the box now **says so** rather
than presenting two different questions under one heading. The sentence for the
current state is *"No sighting carries a confirmed identity yet, so every
comparison is grouped the old way — by wine and name — and a 375ml and a 750ml of
the same wine still land in one group."*

**That is the state today, and it is a real zero, not a read failure.** Measured
read-only on production 2026-09-05: `vendor_price_observations` holds **0 rows**,
`price_history` **0 rows**, and no identity column anywhere in the estate carries
a value (`master_wine_library` 0 of 4,226 with a upc/ean/barcode; `beverages` 0 of
608; `restaurant_inventory` has no such column). `GET /vendor-intel/identity/status`
answers with those counts and the reason, and distinguishes "0 identities" from
"the register could not be read" in words.

### 13.32 The Michigan FOIA source, and why no class-C line joins the index box (ADR 0126, 2026-09-05)

**One new source appears in the index box for the three Michigan houses, and it
draws itself with no change to `MarketIndexPanel.tsx`.** The panel already
renders every withheld source with its own reason
(`withheld.map((s) => <Withheld …>)`), so
`michigan-lcc-filed-beer-wine-schedules` — the beer and wine schedules
wholesalers *file* with the Commission rather than publish — shows up beside the
spirits price book, carrying the sentence that matters: **MCL 436.1609a exempts
each filing from disclosure under the Freedom of Information Act until one year
after it was filed.** A request reaches them; it can never reach one less than
twelve months old.

`GET /price-index/US-MI`'s `silence` gained one clause for the same reason. It
used to end *"A manager can download the quarterly book from the issuer and
upload it, and these lines will fill"* — true, and read by a **wine** house as a
promise the spirits book cannot keep. It now adds that a second list here is
filed rather than published, reachable only by a written request, and held back
365 days by statute.

**And the class-C line the brief asked for is deliberately NOT here.** A licensed
distributor's price is the price ONE licence pays. It is tenant-keyed and lives
on `vendor_price_observations` with `restaurant_id` set, because
`price_index_postings` has no restaurant column at all and
`belowTrailingAverage` reads `restaurant_id.is.null` as *every house on the
deployment* — a licensee price drawn into this box would be one house's buying
terms shown to its competitors. ADR 0117's own class table says class C compares
to "class A and B **for that house**", and class A is the market box's register:
so a class-C line belongs beside the market box, not beside the postings.
`comparisonClassOf` already maps `api_catalog` into the `quoted` class and its
docblock already calls that class "ADR 0117 classes A and C" — the placement was
answered in code before it was asked. `MarketIndexPanel.tsx` was not edited by
this pass; two other builders were live in it.

Nothing is connectable today in any case: no Illinois distributor publishes a
feed, and two forbid an automated reader in their own terms (ADR 0126,
`.planning/07-reference/price-sources.md` §"Class C re-measured 2026-09-05").

### 13.33 A carried price book waits, and the box says so (ADR 0128, 2026-09-05)

**What changed here.** `MarketIndexPanel` gains one label: when the house's
jurisdiction is holding a hand-carried price book that nobody has admitted, the
box says so — in the singular or with a count — and says that nothing is drawn
from it until an owner or manager admits it. It is drawn **whether or not there
are lines**, because a jurisdiction can hold a new book while an older admitted
edition is still on screen, and a label that appeared only on an empty panel
would hide the waiting book at exactly the moment the panel looked healthy.

`heldBooks === null` means the gateway could not answer. Nothing is drawn then:
null is not zero, and "no book is waiting" is a claim.

**Why the box could go empty now, when it did not before.** Until 2026-09-05 an
uploaded book was the index line the instant it was written — measured against a
same-depth `git show HEAD:` probe of `price-index.service.ts`, run and then
deleted (the measurement is recorded in `price-index-held-book.spec.ts`'s
header). A book that trips any band in `upload-tier.ts`, and **every first book
of a source**, is now written and held: `price_index_postings.admitted_at` is
null, and one exported predicate — `MARKET_VISIBILITY` — keeps it out of the
lines and out of the row counts. So the first time a Michigan manager carries a
book in, this box will be EMPTY until somebody admits it, and this label is the
only thing standing between that and the panel reading as "nothing is posted for
Michigan".

**What is NOT built here.** No web surface admits a book. The three POST routes
exist, are guarded and are sealed, and nothing in `apps/web` calls them — a
manager cannot yet confirm or refuse from the product, and the label says a book
is waiting without offering the gesture that would clear it. That is the
honest gap; it is filed as a defect below rather than described as done.

### 13.34 The commodity context line, and one alert built dark (commodity-signals-plan.md phase 0, 2026-09-05)

**The founder's call, verbatim: *"Both: the line now, the alert behind a
flag"*.** Both halves are built. This section records the line; the alert is at
the end, because it is the part that reaches nobody.

**Why a third register in one box, rather than a third box.** The founder's
batch-37 call was *"a seperate table for index series"*, and it is structurally
required rather than a preference: measured against
`20260904200000_a_posted_price_names_its_state.sql`, **five separate columns of
`price_index_postings` each refuse an index series on their own** --
`price NUMERIC(12,2) NOT NULL` (an FAO index of 133.3 is not a price, and two
decimals round away precision an issuer published), `currency CHAR(3) NOT NULL
DEFAULT 'USD'` (an index number has no currency, and the default would stamp
one), `price_unit VARCHAR(24)` (ONS's own unit string is **26 characters**),
`product_name NOT NULL` (a series names a commodity class, not a product), and
`state ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'` (the FAO index is global and there is no
ISO code for everywhere). So: three new tables and a second endpoint. But it is
the same KIND of thing a reader is looking at -- a published reference, not a
quote -- so it draws as another labelled section of the index box rather than as
a fourth box on the page.

**The two series, and why these two.** Not the two most useful; the two that
pass this repository's own politeness rules.

| Series | Measured 2026-09-05 | Why it is here |
|---|---|---|
| **FAO Food Price Index** | `robots.txt` **200**, 1,056 B, seven `Disallow` lines, **no crawl-delay, nothing matching the `/media/docs/` path**. CSV **200, 48,006 B**, sha256 `746104cf...c62f`, 444 lines, base `2014-2016=100`, last row **`2026-08,133.3`** | Keyless, monthly, dated by period, and it serves **every** house rather than one jurisdiction |
| **ONS `d7bu`** | `robots.txt` **404** (unrestricted per RFC 9309, the reading already applied to `ilcc.illinois.gov`). JSON **200, 125,504 B**, sha256 `e8fba154...f1b`, 463 months, `2026 JUL = 144.0` | OGL v3.0, keyless, and an `updateDate` on **every** observation |

Both robots readings were re-read independently by the plan's author at
14:12-14:15Z after an audit found that log incomplete (`p4as-fetch-log.md`
rows 75-76) and **the two sets of measurements agree in every particular**.
This task's own log is `p4-scratch/p4bb-fetch-log.md`.

**The measured difference that decides a column, and it is not symmetry.**
**The FAO CSV states no date of any kind** -- no release date, no revision date,
no "generated on" line; line 1 is the title, line 2 is the base, line 3 is the
header. **ONS states two**, a series `releaseDate` and a per-observation
`updateDate`. So under ADR 0117 Q27 the FAO line prints **"read on"** and the
ONS line prints **"issued"**, and both are pinned by a test. Stamping our read
date and calling it the issuer's would manufacture provenance in the one place a
reader looks for it.

**Three gates, catching three different failures.** Collapsing them into one
"is this file OK" boolean is how a live 200 gets read as freshness.

1. **The base**, read back out of the file and compared with the register's.
   FAO serves a **second live CSV path** returning HTTP 200, well-formed, 14,225
   bytes, on base **2002-2004=100**, whose last row is **`Mar-18`**. Neither path
   is disallowed by robots. **A base change is a new series, not a new
   observation** -- the same index on two bases differs by roughly fifty percent,
   which a step guard reads as a crash.
2. **Staleness**, aged from the **newest observation's own period**, never from
   the HTTP status and -- on ONS above all -- never from the issuer's release
   date: four ONS RPI series return 200 with a fresh `releaseDate` and a last
   observation of **2025 JAN**. The arithmetic is `price-index/staleness.ts`'s
   `refuseStale`, imported rather than rewritten.
3. **The admission**, which is where the best source in the plan is refused.

**The source that is registered and never fetched.** The USDA AMS Daily National
Shell Egg Index is the series the founder's own example is about. Its host's
`robots.txt` returned **HTTP 403** on 2026-09-04 and again on 2026-09-05, and
this repository's own rule -- recorded in `price-sources.md` for K&L Wine
Merchants, Majestic and Tesco -- is that a host whose crawl rules cannot be READ
may not be fetched. **This task did not contact that host at all.** So the
series is registered with `admission = 'upload_only'`, the 403 as its
`withheld_reason`, and no parser: building one would have required bytes it may
not go and get. The panel names the 403 rather than hiding the series. Wiring it
to the Michigan upload path is phase 1's work and is filed below, not claimed.

**What is NOT built here, stated so the absence reads as a decision.** No route
creates an exposure mapping. The controller has **no POST at all**: asserting a
mapping puts a person's name on a join that a rule later fires on, and phase 0
ships the register and the line, not the act. So `noExposureRecorded` is true on
every house today and the panel says so in words.

**The alert, dark.** `commodity_exposure_rising` is built and **cannot reach a
person**, and the guarantee is structural rather than conditional:
`CommodityModule` does not import `NotificationsModule`, so there is no service
to notify with, and a test asserts that. Behind `COMMODITY_ALERT_DARK` (off; an
allow-list, so a typo leaves it off) it evaluates the rule and writes ONE row per
evaluation to `neural_footprint_event` -- verdict in `choice`, working in
`internal_state`, `dark: true` and `reached_a_person: false` in `context`, and
**`outcome` NULL on every row**, because NULL means unknown in that table and
whether a fire was RIGHT needs a numerator of confirmed invoice rises that does
not exist (`vendor_price_observations` and `price_history` each held 0 rows in
production on 2026-09-04).

**The threshold is derived, and copying `market-signal.ts` would have been wrong
by a factor of eight.** That producer uses one global `DEFAULT_DROP_THRESHOLD =
0.1`. Re-measured here on the full 440-row FAO series through the shipped code:
the rise that produces **about twice a year is 8.5 %** on FAO, against 35.7 % on
retail eggs and 67.8 % on wholesale eggs. So the operator sets a **budget** and
the code reads the percentage off the series' own history at that quantile.
**The shipped implementation reproduces the plan's §9b table exactly** -- FAO
3.7 % / 8.5 % / 15.4 % for four, two and one fire a year, and the flat-threshold
firing counts 63 / 38 / 27 / 9 at 10 / 15 / 20 / 30 % -- which is an independent
confirmation of that table, computed by different code from re-fetched bytes.

**One number was corrected by that re-measurement.** The plan states FAO's step
guard (p99 month-on-month) as **7.8 %**; an interpolated quantile gives
**7.49 %**, which sits BETWEEN two real observed steps (6.98 % and 7.80 %) and
would refuse a 7.80 % month the market actually printed. The guard therefore
uses **nearest rank**, which lands on 7.80 % -- the plan's own figure -- while
the rise threshold keeps interpolation, which is what lands on the budget. The
asymmetry is deliberate and is documented at `quantileCeilingRank`.

**Two of the rule's nine conditions are NOT evaluated, and every decision says
so by name.** Coverage (the house's days of inventory for the mapped item) and
storability (how long the item keeps). Measured: **zero shelf-life columns
across every migration in this repository.** A rule that silently skipped an
unevaluable condition would be reporting absence as health -- a condition nobody
could check, rendered as one that passed -- so `unevaluated` rides on every
decision, on every ledger row and in the report line. Where shelf life comes
from is the plan's Q3 and it is the founder's.

### 13.35 The hold is printed and the basis is printed (ADR 0128 Q2/Q4, 2026-09-05)

**Two founder answers landed on this box.**

*Q2 — 24 hours stands, printed where the waiting book is shown.* The waiting
label now ends with the length of the hold and what happens at the end of it:
after 24 hours the people who could act are told again, and the person who
brought the book in may admit it themselves with a stated reason. The number
comes from the wire (`heldBookHoldHours`), never from a constant in the panel —
`ESCALATION_HOURS` is imported into the read service so the number a reader is
promised and the number the escalation sweep waits out cannot drift apart. When
the gateway sends no number the sentence is omitted rather than guessed: a hold
of unknown length is not a hold of no length.

*Q4 — a lone person's admission is acceptable with reason + record, and the
record has to be visible.* `GET /price-index/:state` now returns `carriedBooks`
(sha256, file name, edition, basis, reason), and beneath the lines the box names
each hand-carried book that is actually drawn and how it got in:

- `routine` — stood on one person's upload, every check inside its band
- `byte_match` — a second owner or manager fetched the same file and matched it
  byte for byte
- `attested` — a second owner or manager vouched for the summary
- `same_person` — **"admitted by the same person who brought it in, because this
  jurisdiction has no second owner or manager — this is not a second pair of
  eyes"**, with the reason they gave printed beneath it

The last one is the whole point of the answer. The founder allowed it *because*
it is recorded; a basis that read like a second pair of eyes when it was not one
would be the control evaporating at the last step. Only books whose lines are on
the screen are annotated, and `carriedBooks === null` (the gateway could not
answer) draws no basis rather than a guessed one.

**Still not built:** no web call site admits, refuses or reopens a book — see the
gap in §9. The reopen route added for Q3 is a fourth thing a manager cannot do
from the product.

### 13.z Two corrections to fb7248ec's message (audit a3fd525b, 2026-09-05)

The commit message of fb7248ec said `check_new_tables_are_locked_down: OK (268 CREATE TABLE / 268 live)`. Measured on an isolated archive of that commit: **258 / 258**. The 268 was the number the guard printed on the SHARED worktree, which carried other builders' uncommitted migrations — the parent pasted the tree's number rather than the archive's, the exact habit p4-rules.md forbids. The verdict (every table locked down) was right; the count was not. Also: the two `nt-book.test.ts` failures that message called "not this commit's" were confirmed pre-existing on the parent 59e25f92 and fixed in d35d27e2.

### 13.35 What the founder's answers changed on this box (2026-09-05, batches 50-51)

Five answers, and three of them are visible here.

**Rates draw as a third kind.** `value_kind` had `rate` from the first migration
and no occupant; the founder's batch-51 answer filled it with HMRC alcohol duty,
the Illinois gallonage tax and the GİB ÖTV schedule. They are labelled
**"Published rate"** — not "Public index" and not "Public price series" —
because a duty rendered as a price is a number the house pays *on top of* the
one it is reading. Each line names its instrument and its effective date: a rate
without its statute is a rumour.

**Nothing was fetched for any of the three.** All were measured on 2026-09-05 by
the market-research builder with `robots.txt` read first, and are cited from
`price-sources.md` lines 269, 295, 471 and 565. This pass made **zero outbound
requests**.

**A per-bottle duty line, and why the box prints a sentence rather than a
number.** `duty.ts` implements all three denominators and is tested to the
penny. It then refuses every real bottle in this product, for two measured
reasons:

* **There is no alcohol-by-volume column anywhere in `master_wine_library`** —
  grepped against the baseline, it has `ml_derived_features` and
  `bottle_size_ml` and nothing else. HMRC's rate is per litre of PURE alcohol,
  so no UK figure is computable for any bottle here.
* **`bottle_size_ml integer DEFAULT 750 NOT NULL`.** A duty computed off that
  column is a number nobody chose printed as this bottle's tax — the
  `restaurants.currency DEFAULT 'USD'` defect with a figure attached. So the
  derivation takes an explicit SOURCE for the size and the strength and refuses
  `column_default`.

And GİB is refused for a third reason nobody can type their way out of: **the
issuer does not state what the figure is per** (`price-sources.md:269`). It
draws with *"Held as published, and not derived from: …"*, which is the
read-but-unusable silence rather than the unreadable one.

**A source waiting on a human download says so.** `www.ams.usda.gov/robots.txt`
is 403, so nothing here fetches it; the founder's answer was a one-off human
read, logged. The parser exists, has never seen real bytes, and the line reads
*"Waiting on a person's own download. Nothing here fetches this source, and
nothing is claimed about where it stands until the file arrives."*

**An armed series names who armed it and on which numbers**, on the same line as
the number it produces. Arming is a Mudavym admin's act behind `X-Admin-Key`
(ADR 0099), it carries back a hash of the calibration proposal that was shown,
and the gateway recomputes that proposal before comparing — so a threshold that
moved since it was read cannot be armed.

**And the dark rule's unevaluated list shrank from two to one, by measurement.**
`restaurant_inventory.shelf_life_days` now exists — person-typed, nullable, no
default, no category inference — so condition 8 is evaluated. A typed shelf life
can only ever REMOVE an item from the firing set: an item nobody has typed one
for is skipped with `no_shelf_life_typed`, and an item that does not keep as
long as the lag is skipped with a different sentence again. **Condition 7,
coverage, is still unevaluated and still named on every decision and every
ledger row.**
