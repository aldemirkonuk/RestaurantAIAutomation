---
sketch: 106
name: app-shell
question: "ADR 0149 row 5 decided the app shell is rebuilt as house chrome after a sketch and the founder's review. The header and the nine ADR 0112 overlays are built; the sidebar, the toasts, the error screen, the page loader, the offline banner and a 404 are not. What is the primary navigation once every page is Mudavym, and what does each of the unbuilt pieces look like when it holds the house's honesty rules?"
winner: null
tags: [shell, chrome, sidebar, navigation, toasts, error-boundary, loader, offline, 404, mobile, roles, mudavym, directions, adr-0149, adr-0112, adr-0138, adr-0140, adr-0143, adr-0145, adr-0114, adr-0020, sketch-102, sketch-103, sketch-only]
---

# Sketch 106 · Three shells for every signed-in page

## Design question

Decided before this sketch (ADR 0149, founder answers 2026-09-16): the shell is rebuilt as
house chrome after this review (row 5); the light/dark toggle is retired — charcoal
everywhere, declared paper surfaces only (row 6, ADR 0138); the floating "Wine Agent"
button is removed, so `/ask` and the palette panel are the two doors to the assistant
(row 33, ADR 0145); the contact address is `support@mudavym.com` (row 8, ADR 0143).
Already designed and built, reused here and not redrawn: the house header
(`apps/web/src/components/mudavym/HouseHeader.tsx` + `house-header.css`, mounted by
`PageGate` over every rebuilt page) and the nine ADR 0112 shell overlays (palette, Ask AI
bar, shortcuts, recently viewed, bell, user menu, branch switcher, theme menu, mobile
scrim). One of the nine goes with the toggle: retiring `ThemeMenu` leaves eight, and the
header loses one control (`HouseHeader.tsx:229`).

Not designed anywhere (census: `scratchpad/census/chrome.md`, `codex-audit/shell-design.md`;
re-checked on this tree):

- **The sidebar** — `components/layout/Sidebar.tsx`, 852 lines of legacy Tailwind, a
  260↔72 px collapse, four sections (Main · Workspace · AI · bottom), one role-gated row
  (`/connections`, `minRole` at `Sidebar.tsx:58-64`). ADR 0134 fork 1 (Proposed, on
  `docs/motions-and-overlays-per-page`, not on `main`) proposed leaving its chrome "to die
  with legacy pages"; ADR 0149 row 5 overtakes that. Missing from it today:
  `/recommendations`, `/vendor-prices`, `/cellar` and its registers, `/ask`. Present in
  it and internal: nothing — but `/studio`, `/simpos`, `/dev/truth`, `/dev-sandbox` exist
  as routes and must never reach a house.
- **Toasts** — two systems: `sonner` at `App.tsx:424-441` (56 importers on this tree) and
  the Radix `contexts/ToastContext.tsx` (12 importers). Neither is ground-aware; both say
  "saved" on the client's word.
- **The error boundary** — `components/ErrorBoundary.tsx` (311 lines) wraps the whole app
  above the router (`App.tsx:160,459`): a page crash takes the chrome with it.
- **The page loader** — `components/ui/page-loader.tsx`, a wine-coloured spinner as the
  Suspense fallback for every route (`App.tsx:168`); `loading-skeleton.tsx` follows the
  retired toggle.
- **The offline banner** — `components/ui/SyncStatus.tsx:247-267`, amber, "will sync when
  you're back online" — a promise the device cannot keep (sketch 103 2e, ADR 0140:
  queued is never confirmed).
- **404** — none. `App.tsx:416-417` redirects every unknown address to `/`, silently.
- **The mobile top bar** — `DashboardLayout.tsx:79-92`, legacy, a second sticky bar the
  house header has to yield to (`house-header.css:41-49`).

Each direction draws the whole set — rail or bar, toasts, loader, offline, failure, 404,
390 — for an owner at a US house and a staff member at a Turkish house, expanded and
collapsed, with every overlay the chrome opens drawn open. The page under the chrome is a
stand-in for `/orders` and `/receiving` in the rebuilt pages' own grammar; it is labelled
as such and is not part of this sketch.

## How to view

```
open .planning/sketches/106-app-shell/direction-a.html
open .planning/sketches/106-app-shell/direction-b.html
open .planning/sketches/106-app-shell/direction-c.html
```

Self-contained, inline CSS and JS, render from `file://`. The three files are **generated
by `build.py`** from shared pieces (tokens, the built header, the page stand-in, the toast
anatomy, the failure sheet, the 404, the fit-to-width script) plus each direction's own
shell — edit the script, not the HTML, or the three drift apart. Frames are drawn at 1440
and 390 and scale to fit the window, so the same file reads on a phone.

Houses: **Larkspur & Vine**, Oakland (owner Maya Ferrante, en-US, USD) and **Sim
Meyhouse**, Kadıköy (staff Ayşe Demir, manager Kerem, tr-TR, TRY — `₺12.480,00`,
`17.09.2026`). Warm Charcoal is the ground (ADR 0138); one cell per file is pinned
`data-ground="paper"` to prove the tokens hold on the declared exception, and captions on
that ground use `--ink-4` (5.64:1), never `--ink-3` (4.07:1, below AA) — ADR 0149 row 30.
Fonts load from Google for the drawing; the product self-hosts them (ADR 0149 row 9).
Motion is tokens for every act a person takes — `ink` 160 for chrome micro-states,
`settle` 320 for folds, `tuck` 300 for the pass and the toast stack, `tally` 840 for a
count that changes (C), and the undo drain is `linear` for `pour`'s reason (the reader is
timing it, though the drain itself runs 8 s, not `pour`'s 620 ms — the token names the
curve, not the duration). Two ambient loops are **stated exceptions, not tokens**: the
header's loading hairline (`loadbar`, 1.4 s) and the skeleton's sheen (1.9 s, inherited
from `dashboard-next.css:44`) — both pause under `prefers-reduced-motion`. Reduced motion
collapses every other transition. No emoji.

Screenshots in `shots/` (`*-1440.png`, `*-390.png`), rendered with
`p4-scratch/render-sketch.mjs`, zero console errors, no horizontal overflow at either
width. Checked by pixel: each PNG is exactly `document.documentElement.scrollHeight` tall
(A 13453 · 12266, B 11315 · 9993, C 8691 · 7712), all under Chrome's 16384 px capture
line, so no banding was involved — re-measured after the 2026-09-17 revision below (see
"Revision — the critic pass" for what grew and why).

## Revision — the critic pass (2026-09-17)

A design critic ran adversarial checks against this sketch and returned 24 findings (14
major, 10 minor) in `sketch-critic/106-app-shell.json`. Every one is fixed in `build.py`;
this section is the record, grouped, with the file line the fix now lives at.

**Contradictions fixed.**
- The offline frame (all three directions) had a record dismissed at 14:06 shown as
  **sent** (`rung 2 of 4`) four minutes after the house went offline at 14:02 — queued
  can never be confirmed, so that record now stays at `rung 1 of 4` (`build.py:681, 737,
  931, 980, 1229`), and the masthead, the strip and the popover all read the same
  timestamp, `14:01:48` (`build.py:717, 962, 1262` pass a clock override).
- C's staff bell (3) disagreed with its own rail (12, the owner's number copied
  verbatim). The rail now reads its own tallies per house (`c_rooms_data`,
  `build.py:1090-1130`); staff and owner no longer share a single hard-coded count set.
- C's toast said `Recommendations 4 → 3` beside a rail still printing 4. Frame 01 now
  renders the rail with the post-move count (`overrides={'reco': '3'}`, `build.py:1239`).
- C's "still reading" state was pixel-identical to "the read failed" (both the same
  dashed ring). A new `tally--loading` mark (a static hairline, `build.py:980, 1150`)
  reads distinctly from the ring Vendor prices keeps for its own, genuinely failed read.

**Design rationale that was printed as product copy is now product copy.** Toast second
lines (`toast_set`, `build.py:392-419`), the loader's 3 s / 12 s states
(`loader_strip`, `build.py:472-492`), the error id's copy affordance
(`build.py:433` — a real Copy button, not a parenthetical explaining one), and the paper
cell's caption (moved to an `sk-note` outside the frame, `build.py:757`) all now say
what a house would actually read; the "why" moved into `sk-label` captions or code
comments.

**Real defects, not just wording.**
- `/sommelier` was dropped from the navigation with no fork. It doesn't need one — ADR
  0145 fork 5 already answers it (locked, 2026-09-12): *"`/sommelier` redirects into
  `/ask`"* — so the 404 room list now says so (`build.py:455`).
- A's `THE DESK` group (Team, Communications) collided with `The desk` in the foot
  (`/admin`). Renamed to **The people**, matching B's book of the same name
  (`build.py:615`); A's band text and the README below are corrected to match.
- The rail's group-eyebrow padding was scoped to `.rail`/`.railC` only, so the tucked
  pass, the phone drawers, and (in C) the narrow drawer's own class all lost it —
  `WAITING ON YOU` sat flush left with its `W` clipped. Fixed by extending the selector
  to `.pass`, `.sheetL`, `.railC-m` (`build.py:559, 1020`).
- A's phone nav (frame 10) always marked **Orders** current, even on the Receiving
  screenshot. `a_phone` now takes an `active` route (`build.py:655, 730`).
- C's source popover printed a query that doesn't exist
  (`GET /api/v1/orders?…&status=pending`). The real call is
  `ordersApi.getPendingOrdersCount` → `GET /procurement/orders/pending/count`
  (`apps/web/src/services/api/orders.ts:18,529-533`, re-verified this session) —
  corrected (`build.py:1212`).
- C's staff caption cited ADR 0114's G19 gate for Receipts & Credits and Vendor prices.
  Re-checked this session: G19 gates `GET /payment-methods` and `GET /billing/provider`
  only (`0114-…md:29,108`); `credits.controller.ts` carries only `JwtAuthGuard`, no role
  check. The caption now says so and names the gap as this direction's real cost — a new
  staff gate on both reads (`build.py:1241`).
- B's `.entry` truncated a live entry's text at 150 px, cutting off money figures even
  with ~430 px of empty bar beside it. Widened to `max-width:360px`
  (`.entry .txt`) inside a 520 px entry (`build.py:783-785`). Separately, the Cellar
  book (8 rooms) — not the Door book the README claimed — is the tightest case at 1440;
  a new frame draws it (`build_b` frame 03, `build.py:940-941`), the strip gets an
  edge-fade, and a `+N rooms` chip is now a **sibling of the scrolling track**, not
  appended inside it — the first version scrolled the chip out of view along with the
  rooms it was announcing, defeating the whole fix (caught on re-screenshot; fixed in
  `b_bar`, `build.py:821-856`).
- No direction drew the failure sheet, the stale-chunk reload, the 404, or the 12 s
  loader at 390 — exactly where a phone would overflow. A now draws all four at 390
  (frame 11, `build.py:745-752`).
- "Ask the house" (C's assistant entry) didn't match ADR 0133 §3's fixed word. Now
  **Ask Mudavym.** (`build.py:1157`).
- A's cellar-fold label swapped to "Soft drinks" on the `staff` render flag, not on the
  house's own alcohol-free setting (ADR 0149 row 24) — so a Turkish meyhane (which
  pours) would have read as alcohol-free whenever a staff member was signed in. Both
  houses now carry `alcohol_free: bool` (`build.py:46, 53`) and the room keys off the
  house, not the viewer (`build.py:615`); neither sample house is alcohol-free, so both
  now correctly read "Non-alcoholic".
- The owner's own toast/session-log specimens told Maya to "ask Maya" when a shift
  removal was refused — self-referential, because `house['manager']` for the US house
  is literally the owner's own name. Generalized to role language with no name
  (`build.py:411, 919, 1256`) rather than removed, so the refusal state still reads.

**Minor fixes.** Contrast: toast/kbd/entry captions on the paper ground now use
`--ink-4` (`build.py:93`). The 404's `HTTP 404` claim is dropped — `vercel.json`
rewrites every path to `index.html`, which returns 200 (`build.py:462`). Undo: the
8 s drain now pauses on hover/focus (`build.py:197, 790`, WCAG 2.2.1), and the
chord is scoped to `⌘Z`, not a bare `Z` (`build.py:402, 495, 1253` and every inline use).
B's session log gained the held/note entry it was missing, with its own Undo (F10 allows
it) and a count that now matches the log (`+5`, not `+2` beside a "4 entries" header —
`build.py:900, 914`). Two decided answers (theme menu retired, `WineAgentFab`
removed) are now named in every direction's own band, not only here
(`build.py:691 A, 938 B, 1236 C`); B's phone gained the `More` sheet it referenced
but never drew, open for owner and for staff, with **Ask Mudavym.** in it
(`build_b` frame 11, `build.py:970-985`). Popover widths: `.pop`, `.bookpop` and
`.srcpop` now use ADR 0112's 320 px (`build.py:212, 794, 1042`); `.entries` (420,
a session log, not a popover) and `.sheetL`/`.pass` (264-312, they replace the rail
itself) carry a code comment explaining why they still differ, rather than a silent
deviation (`build.py:259, 795`).

**Re-measured, not copied forward** (CLAUDE.md §5b) — every number below was run against
this tree this session, not carried from an earlier draft:
- `ThemeContext` importers: **9**, not the README's stale 13 (`grep -rl` for an actual
  `import … from … ThemeContext` line across `apps/web/src`, excluding the definition
  file itself — the earlier count conflated files that merely mention the string).
- Sidebar role-gated entries: **two**, not one — `minRole: 'manager'` on `/connections`
  (`Sidebar.tsx:213`) *and* a separately-conditioned Admin section
  (`Sidebar.tsx:647-661`) that the `minRole` filter never touches.
- `pageNames.ts` does not name `Vendor prices`, `Promotions`, `Help`, `The desk`, or
  `Mudavym` (confirmed absent by grep) — A and C's room names for these come from this
  sketch, not the built map, until `pageNames.ts` is extended.
- No direction actually draws the palette, the bell, or the account menu open — all
  three are cited in captions as built-elsewhere, none is rendered. Listed correctly
  under "Not drawn, and why" below; a claim that they were drawn open has been removed.

**Style bar (founder, 2026-09-17):** for people-facing pages, simpler and easier to
read, in the register of the Wave Four gallery, *The Arrival, Five Ways*, and the
Documents and Reports redesign artifacts — fewer words on the surface, one clear primary
act per view, generous spacing, honesty states kept but quiet, no rationale prose printed
as product copy. Applied throughout the defect fixes above (the toast/loader/error-id
rewrites are the visible result); technical pages (this sketch's own failure sheet, 404,
and the receiving/vendor-prices internals it stands in for) stay dense, per the same
ruling. Every direction is still a distinct idea — the simplification cut words, not
differences.

## The three directions

### A — The rooms (`direction-a.html`)

**Idea.** A quiet left rail of words, grouped by where the work happens in the house and
named in the house's voice: **The floor** (Dashboard, Notifications, Calendar,
Recommendations) · **The door** (Orders, Receiving, Providers, Promotions, Vendor prices)
· **The cellar** (Inventory; Cellar, a fold holding Wines · Beer · Whiskey · Cocktails ·
Spirits · Non-alcoholic — *Soft drinks* in an alcohol-free house, keyed on the house's own
`alcohol_free` setting, ADR 0149 row 24, not on who is signed in) · **The books**
(Receipts & Credits, Documents & Reports, Reports, Logs) · **The people** (Team,
Communications — named to match B's book of the same name, and so that "The desk" only
ever means `/admin`, in the foot). Room names are the ones the built header already prints
(`lib/mudavym/pageNames.ts`), so nav and chrome agree word for word and nothing in the
header changes. *Ask Mudavym.* is the first row — the nav entry says Mudavym, never
"agent" or "AI" (ADR 0133:92) — with the panel's chord beside it. The foot holds
Settings, Connections (manager), The desk (`/admin`, owner) and Help; Profile lives in
the built account menu. While the arrival is incomplete, one dashed card at the foot says
which folios are blank (owner only). No icons: this direction has no glyph set to draw or
maintain. No counts: the bell is the one count in the chrome. The rail is **expanded or
tucked, never iconified** — `⌘\` tucks it to a 28 px strip and the page takes the width;
the strip's one word opens the rooms as a non-modal pass over the page (sketch 103, 1a),
closing when you leave it or choose a room. The persisted key is today's
`ui-storage.sidebarCollapsed`, read as tucked.

Toasts are **the margin note**: docked at the page's left edge, above the fold, an
eyebrow that says what the house did and when, one sentence, and a second line that says
what is *not* claimed. Undo drains an 8 s hairline that pauses on hover and focus (WCAG
2.2.1), and only where F10 allows (dismiss, archive, a removed shift, a note); the chord
is scoped to `⌘Z`, not a bare `Z`. Money, sends and ledger rows keep the seal before, and
their toast after is a receipt line with the wax. Five states, on both grounds. The
failure sheet sits under the shell, so the rooms, the bell and the search survive a page
crash; it names the error id, the build, the route and the house, and offers Try again ·
Go to Dashboard · write to support@mudavym.com with these readings; the stale-chunk case
reloads once and says so. The loader has three moments — nothing under 400 ms, the page's
own skeleton (the dashboard's `.dn-skel` sheen) to 3 s with a mono line after it, and at
12 s a sentence and two acts, never a spinner and never a fake row. Offline is a strip
under the header — *offline since 14:02 · 3 records written here, none sent · the bell
and the counts are from 14:01:48, the house's last answer* — and a popover (the anchored
shape) that names each record's rung on the ADR 0140 ladder: written here · sent ·
received · sealed by the house; every record stays on *written here* until the house
answers, so a page under the strip never claims a send it hasn't made. The 404 keeps the
address, names the nearest room, lists the rooms including `/sommelier redirects here`
under Mudavym (ADR 0145 fork 5), and says that a room you may not enter is a different
door (`/no-access`). At 390 the header gains the rooms toggle (the legacy mobile bar is
deleted), the rooms open as a left sheet with the house and role at its head, and the
ladder is a bottom sheet with detents (F9); the failure sheet, the stale-chunk reload,
the 404 and the 12 s loader are also drawn at 390 (frame 11), since the chrome around
them is shared across all three directions.

**Optimises for:** the cheapest honest rebuild; a chrome that makes no claim it has to
keep re-proving; reading like the pages under it (Fraunces for the house's words, DM Sans
for the rooms, mono for the record). Nothing in it polls.

**Costs.** New: `HouseRail.tsx` + `house-rail.css` (rooms table shared with the palette,
one source next to `pageNames.ts`); a left, non-modal variant of `Sheet.tsx` for the
pass (the primitive is right-side and modal today, `Sheet.tsx:198`); the cellar fold on
the dashboard's `.dn-expand` idiom. Shared with B and C (see below): one toast, the
boundary under the shell, the loader ladder, the offline strip and ladder, the 404, the
header's rooms toggle. Honest limit: with the fold closed the expanded rail is about
930 px tall; on a 900 px window it scrolls, as today's does, and the foot pins only on
taller screens.

### B — The ledger bar (`direction-b.html`)

**Idea.** No rail. The built header keeps line one; a second line carries the **six books
of the house** as tabs — Floor · Door · Cellar · Books · People · House — with the open
book's rooms inline beside them, the current room marked by the seal. One click inside a
book, two across books, the palette for anything; number keys reach a book (1–6) and then
a room (1–8), so "2 1" is Orders. Hovering or pressing a book's number opens its index
(the anchored popover) with a line per room. *Ask Mudavym.* sits at the bar's right end.
The page gets all 1440 px, which `/reports`, `/inventory` and the orders ledger want.
The house speaks **in the bar**: a toast is a ledger entry at the right end of line two —
an eyebrow (Dismissed · Written here · Sealed · Refused), the sentence, Undo where F10
allows, a 36 px drain — and after 8 s it folds into a `+N` count that opens the session's
entries (what the house said, newest first; the bell's book is the house's record, this is
yours). Nothing floats over the work on a desktop. Loader, offline strip, failure sheet
and 404 as in A, all under the bar. At 390 the books become a **bottom tab bar** and the
open book's rooms a chip row under the header; there is no drawer at all. A sixth tab,
`More`, opens a bottom sheet holding Settings, the two role-gated rooms, Help and *Ask
Mudavym.* — the phone's only door to the assistant, since ⌘⇧K has no phone equivalent.
The bar has no room for an entry on a phone, so the five toast states are cards above the
tabs — the same anatomy as A's margin note.

**Optimises for:** width for the pages; a real information architecture (six books a
manager can hold in the head) instead of a 21-row list; the best one-handed mobile
navigation of the three; chrome that is looked past (`ink` 160 is its only motion).

**Costs.** New: `LedgerBar.tsx`; number-key chords in `CommandProvider` (it already
captures ⌘K); a session entry log; the phone tab bar, the chip row, and the `More` sheet
(Settings, the two role-gated rooms, Help, *Ask Mudavym.* — drawn open for owner and for
staff, frame 11). Two things it gives up, drawn plainly: two clicks across books, and a
toast that is subtle by design — an owner sealing an order will not see a card land. At
1440 the **Cellar** book (8 rooms) is the tightest case, not the Door book (5) this
README claimed before it was measured — the strip scrolls under an edge fade, and past
6 rooms a `+N rooms` chip says so, always visible outside the scrolling track (frame 03).
The desktop and the phone speak from different places, which is one toast system with two
docks.

### C — The tally rail (`direction-c.html`)

**Idea.** A rail that keeps score, sectioned by who acts: **Waiting on you** (Dashboard;
Notifications 12 unread; Orders 3 awaiting seal; Receipts & Credits 2 to verify;
Recommendations 4 open cases; Communications 2 replies waiting; Team 1 invitation) and
**The house** (Receiving 1 expected; Inventory 7 below par; Cellar; Providers;
Promotions 3 new; Vendor prices; Documents & Reports; Reports; Calendar 2 today; Logs),
then Mudavym, then the foot. Every count is a door: it opens to the query that produced
it, the time it was read, its latency, the first rows behind it, and *Open, filtered*.
The rule is the header badge's (`house-header.css:246-274`): **a count is printed only
when the register answered** — a failed read is a hollow ring, never a zero (ADR 0020); a
room with nothing waiting prints nothing. For a staff member, Receipts & Credits and
Vendor prices say *refused* in words — but no route refuses that read today
(`credits.controller.ts` carries only `JwtAuthGuard`; ADR 0114's G19 gates
`/payment-methods` and `/billing/provider`, not these two), so a real staff gate on both
reads is this direction's own cost, drawn as if it already existed. Every other tally is
read per house, not copied between the owner and staff renders — the staff bell and the
staff rail now agree with each other and disagree, correctly, with the owner's numbers.
The cadence is written at the foot — read 14:02:11 · again in 60 s · and on focus — the
bell's staircase (`useBellBook.ts` `BELL_POLL_MS`), with *Read now*. The rail collapses
to 72 px and the numbers survive the collapse, because here the number is the room's
identity; the hover hint carries the count and its time. Toasts dock at the rail's foot
and their second line **names the tally that moved** — *Recommendations 4 → 3 · Dashboard
unchanged*; *Communications replies waiting 2 — unchanged; a draft is not a send* — so a
dismissal cannot pretend to have cleared a queue, and the count runs on `tally` (840 ms,
overdamped, never past). Offline, the tallies freeze and turn dashed, the foot says when
they were read, and the queue appears as a tally of its own at the top of the rail —
*Written here, not sent · 3* — opening the ladder; every queued record stays at rung 1
until the house answers. While the registers are read, the rail shows a static hairline
mark, not the dashed ring — that ring is reserved for a read that has actually failed
(Vendor prices, drawn beside it for contrast), so "still reading" and "did not answer"
are never the same mark. At 390 the rooms toggle carries a dot, never a sum across
registers; the drawer keeps every tally.

**Optimises for:** the house's own idiom in the chrome — a figure opens to its sources;
provenance over arrangement; the most honest treatment of a failed read anywhere in the
product; the operator who runs the day from the rail.

**Costs.** Three of the ten counts exist today: unread
(`GET /notifications/unread/count`, `services/api/notifications.ts:145`), pending orders
(`ordersApi.getPendingOrdersCount` → `GET /procurement/orders/pending/count`,
`apps/web/src/services/api/orders.ts:18,529-533`), low stock (`GET
/inventory/:id/low-stock`, rows counted client-side, `useInventoryQueries.ts:99`). The
pending-orders read already has the absence-reported-as-health bug this direction exists
to refuse: `dashboard.ts:29` calls it `.catch(() => 0)`, so a failed read and a real zero
already render the same — the one-read endpoint below must retire that catch, not repeat
it. Seven need a count read each — to verify, open cases, replies waiting, invitations,
expected today, new offers, today's events — and the source popover needs the first rows
of each. Ten polls on every page is the traffic the bell's staircase was written to
avoid; the honest build is **one read**, `GET /house/tallies`, returning per register
`{count | refused | failed, readAt, query, first: [...]}` so each register answers for
itself and a failed one cannot pass for empty. And a standing burden: DESIGN-FOUNDATION
§6 names the count-as-health pattern as the one to refuse (Slack's 47, Google's score);
C carries it into the chrome and has to disprove it every 60 s. Icons here are stand-ins
for lucide-react's; a build keeps lucide.

## What every direction holds — the shared pieces

Built once, docked three ways:

- **One toast.** Replaces `sonner` (`App.tsx:424-441`, 56 importers) and
  `ToastContext.tsx` (12). Anatomy: eyebrow (what the house did · when) · one sentence ·
  what is not claimed · Undo or Open · a drain. The eyebrow's first word is the house's:
  *Dismissed · the house confirmed*, *Written here · not on the house*, *Sealed ·
  receipt*, *Refused by the house*, *Draft kept · not sent*. Non-modal (F8): no scrim, no
  focus trap, never a form, never the seal. At most three; the oldest tucks behind.
- **The boundary under the shell.** A second `ErrorBoundary` around `<Outlet/>` inside
  the layout; the outer one at `App.tsx:160` stays for the shell itself. Keeps the
  stale-chunk reload (`App.tsx:1-40` duplicates `ErrorBoundary`'s string match — one
  copy after this), the Sentry id, the copy-to-clipboard. Tokens replace `bg-gray-50` /
  `border-rose-200` / `bg-wine-600`.
- **The loader ladder.** 0–400 ms nothing (the hairline under the header moves);
  400 ms–3 s the page's own skeleton; after 3 s a mono line under it; at 12 s a sentence
  with Try again · Go to Dashboard. `PageLoader` and `SectionLoader` go; `Skeleton` takes
  the tokens.
- **Offline.** The strip says what was written here and when the house last answered;
  the ladder names each record's rung. `useSyncManager` exposes `pendingCount` only
  (`offline-storage.ts:32`); a per-record rung is the ADR 0140 door outbox generalised —
  that is the real cost of this piece. A seal is never queued.
- **404.** A `NotFound` page at the catch-all; the address kept, the nearest room by edit
  distance over the rooms table, the rooms listed (including `/sommelier redirects here`
  under Mudavym, ADR 0145 fork 5); refused is `/no-access`, not 404; a stranger's 404 is
  the public shell's (ADR 0143 §1), not drawn. No status-code claim is printed — this
  page never returns HTTP 404 (`vercel.json` rewrites every path to `index.html`, 200).
- **Popover width.** The ADR 0112 anchored popover is 320 px; the ladder, the book index
  and the source popover all use it. `.entries` (420) is a session log, not a popover —
  a full sentence at 320 would wrap mid-word — and `.sheetL`/`.pass` (264–312) replace
  the rail itself rather than float over it, so neither is held to the popover width.
- **The header at 390.** The rooms toggle joins the built header; `DashboardLayout`'s
  mobile bar (`:79-92`) is deleted with `WineAgentFab`, and `house-header.css:41-49` no
  longer needs to give up its sticky. `ThemeMenu` and `ThemeContext` go — **9 importers**,
  measured this session (`grep -rl` for an actual import line across `apps/web/src`,
  excluding `ThemeContext.tsx` itself; an earlier draft's "13" was never re-measured).
- **Roles.** Rooms carry `minRole` the way `Sidebar.tsx:58-64` does for Connections
  (manager). The desk (`/admin`, owner, `App.tsx:400`) is gated separately — the Sidebar
  has **two** role-gated entries, not one: `minRole` on `/connections`, and a second,
  independently-conditioned Admin section (`Sidebar.tsx:647-661`) that the `minRole`
  filter never touches. Hiding a row is not the boundary either way; the gateway refuses
  the URL regardless. Studio, SimPOS, `/dev/truth`, `/dev-sandbox` are in no rail; the
  operator reaches them by URL and palette.

## Honesty traps it handles

| Rule | Where it is drawn |
|---|---|
| Missing is not zero | the bell's hollow ring reused for every count (C), the spine's em dash, C's *refused* in words, rings while loading |
| A draft is not sent | toast 5 — *Draft kept · not sent*; C adds *a draft is not a send* to the tally line |
| Read is not completed | the toast eyebrow names what the house confirmed; a written-here note carries no Undo and no "saved" |
| Received stock is not verified invoice cost | the receiving stand-in's row copy; the toast never says "received" for a count on the device |
| Promised credit is not recovered money | the receiving stand-in's *Claims promised 0 · Credits recovered —* |
| Generated text is not evidence | C's source popover prints the query and its rows, not a sentence about them |
| A figure opens to its sources | C's tally popover; A and B leave it to the pages' figures, on purpose |
| Queued is never confirmed | the offline strip and the four-rung ladder in all three; *a seal is never queued* |
| A page may not claim a write it never makes | *Written here · not on the house* is a distinct toast kind, dashed |
| Absence reported as health | offline turns every count dashed and dates it; the loading rail shows rings; the failed page says what is kept and what is lost |

## The forks these directions put in front of the founder

1. **Counts in the chrome.** None but the bell (A, B) · a scoreboard whose every number
   opens to its source (C). This is the fork that decides the traffic and the standing
   honesty burden.
2. **Rail or bar.** The rooms keep a permanent place (A, C) · the page gets the width and
   the rooms become six books (B).
3. **Grouping.** Where the work happens — floor · door · cellar · books · people (A, B) ·
   who acts — waiting on you · the house (C) · today's flat Main / Workspace (not drawn).
4. **Room names.** All three keep `pageNames.ts` names so the header needs no edit. The
   house-voice alternative (*Today* for Dashboard, *The door* for Receiving) costs
   `pageNames.ts` and sixteen mastheads; only the group names take the voice here.
5. **Where `/recommendations` lives.** The floor, daily (A, B) · the waiting-on-you queue
   with a count of open cases (C) · the books (not drawn). Sketch 108 is open on the page's
   identity; the shell should not decide it, so each direction places it and says so.
6. **The `/ask` entry.** *Ask Mudavym.* first in the rail (A) · a room at the bar's end
   (B) · a section of its own (C). ADR 0133 fixes the word, not the place.
7. **What staff see.** All three hide only gateway-refused rooms (Connections, The desk)
   and let the page name a refused register in words (sketch 111, fork 2b). A fixed
   staff floor of six rooms is not drawn.
8. **Collapse.** Tuck to 28 px and open as a pass (A) · icons with their tallies at 72
   (C) · nothing to collapse (B). A retires the 260↔72 animation ADR 0134 fork 1 wanted
   to leave to die.
9. **Where the toast docks.** The page's left edge (A) · a line in the bar, then a count
   (B) · the rail's foot, naming the tally that moved (C).
10. **The boundary under the shell** — all three; a change to `App.tsx:160`.
11. **The arrival in the rail** while incomplete (A draws it, owner only). This touches the
    guidance layer — `SetupNudgeBanner`, `PageTipStrip`, `GuidanceLiveRegion`, `LearnPanel`
    (`DashboardLayout.tsx:94-96`) — which no direction redraws; it is a separate call.
12. **Internal rooms for the operator.** Never in a house rail (all three). A ruled-off
    *Operator* item in the built account menu is the alternative, one edit to
    `HouseUserMenu.tsx`.
13. **The offline ladder's home.** A popover from the strip (A, B) · the queue as a tally
    row in the rail (C). Both need the per-record rung from `useSyncManager`.

## Recommendation

**A, with B's phone.** A as the shell on a desktop: it is the cheapest honest rebuild,
it depends on nothing unbuilt except a left variant of the sheet, it obeys the product's
own rule that counts belong to their pages and the bell — the chrome makes no claim it
must re-prove on every page every minute — and its groups are the house's voice without
renaming a room. Tucking gives A the width B is built for, as a state the founder keeps.
On the phone, B's bottom tab bar is better than A's drawer for the one-handed case the
door is designed around. This is now genuinely drawable at no second cost: A's five
groups (Floor, Door, Cellar, Books, People) already carry B's book names one for one
after this revision — "The desk" was renamed to "The people" for exactly this reason —
and A's foot (Settings, Connections, The desk, Help) is what B's sixth book, House, holds.
B's phone frame is that hybrid already, concretely: a tab bar in A's own words, plus the
`More` sheet (frame 11) drawn open for owner and for staff, with *Ask Mudavym.* inside it
— nothing here is asserted without being on screen. C's best idea — a figure opens to
its sources — already lives on the pages' figures (the KPI row expands in place, F7);
keeping it there, and not in the chrome, is what DESIGN-FOUNDATION §6 point 2 asks for.
If the founder wants C anyway, the condition is the one read (`GET /house/tallies`) with
per-register outcomes, not ten polls — and closing `dashboard.ts:29`'s `.catch(() => 0)`
on the one count C already inherits live, so C does not ship the absence-reported-as-
health bug it exists to refuse.

## Not drawn, and why

- The guidance layer (nudge banner, page tips, learn panel) — fork 11; a separate call.
- The palette, the bell's own popover, and the account menu, open — all three are built
  already and are cited in captions as reused as-is; none is rendered open in any frame
  here. The palette's contents specifically should read the same rooms table as the rail
  when it is drawn.
- A signed-out 404 — the public shell's, ADR 0143 §1.
- The phone's sheet stacking and detents beyond the ladder — F9, decided.
- `Vendor prices`, `Promotions`, `Help`, `The desk` and `Mudavym` in `pageNames.ts` — the
  built map doesn't name these rooms yet (confirmed by grep); A and C's names for them
  are this sketch's own, pending that file being extended.
- Live data — every figure here is example data for two houses; the shell's own reads
  (the bell, C's tallies) are named with their endpoints where they exist and marked new
  where they do not.

## Sources

- `apps/web/src/components/mudavym/HouseHeader.tsx`, `house-header.css` — the built header
- `apps/web/src/components/mudavym/Sheet.tsx`, `sheet.css`, `MOTIONS.md` — the three shapes and their motion
- `apps/web/src/components/layout/Sidebar.tsx`, `DashboardLayout.tsx` — today's shell
- `apps/web/src/components/ErrorBoundary.tsx`, `ui/page-loader.tsx`, `ui/loading-skeleton.tsx`, `ui/SyncStatus.tsx` — today's pieces
- `apps/web/src/App.tsx` at `origin/main` — routes, the catch-all, the toaster, the boundary
- `apps/web/src/lib/mudavym/pageNames.ts`, `motion.ts`, `styles/mudavym.css` — names, tokens, motion
- `apps/web/src/services/api/orders.ts`, `dashboard.ts` — the one real count C draws from, and its catch-to-zero
- `apps/api-gateway/src/procurement/documents/credits.controller.ts` — the staff read C's refusal draws as a cost, not yet a real gate
- `.planning/decisions/0149`, `0143`, `0145` (fork 5, `/sommelier` → `/ask`), `0140`, `0138`, `0134` (branch), `0114`, `0112`, `0020`
- `.planning/sketches/102-modal-census/README.md` (F8, F9, F10), `103-overlay-experience/README.md` (1a, 2e), `111-help-directions` (house names, fork 2b)
- `.planning/06-pages/DESIGN-FOUNDATION.md` §6, `PAGES-MAP.md`, `MAKEOVER-VERDICTS.md`
- `scratchpad/census/chrome.md`, `scratchpad/codex-audit/shell-design.md` — the census this answers
