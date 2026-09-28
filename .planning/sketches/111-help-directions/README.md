---
sketch: 111
name: help-directions
question: "ADR 0144 §2 gave /help a job — the FAQ with the house's own state on top, no support desk — and ADR 0143 row 8 gave it an address (support@mudavym.com). What shape does that take, and which of the three open forks does each shape make visible enough for the founder to pick with the sketch?"
winner: null
tags: [help, support, readiness, faq, mudavym, directions, adr-0144, adr-0114, adr-0145, adr-0143, adr-0149, adr-0067, sketch-only]
---

# Sketch 111 · Three directions for `/help`

## Design question

The founder's only words on this page are one line — *"KEEP. New one better."*
(`.planning/06-pages/MAKEOVER-VERDICTS.md:226`) — about the WIP `HelpNext` on
`feat/mudavym-new-pages` (commit `68ed2ebd`; files under
`apps/web/src/pages/help/next/`). ADR 0144 §2 then gave the page its job: *the FAQ with
the house's own state on top — which connections are live, what is waiting on the house,
what last failed — drawn from what the gateway already knows. No invented apparatus.*
The contact address is decided: **support@mudavym.com** everywhere a person is told how
to reach us (ADR 0143 row 8, `0143:305`; carried into ADR 0149 row 8). Still open, and
drawn as visible options inside every direction (fork F08 in the census; DIGEST `help`
§Open forks):

1. **Which queues count as "waiting on the house"** — (a) acts due now: one-tap pending,
   orders `PENDING`/`APPROVAL_NEEDED`, Mudavym proposals; (b) plus the curation queues
   (identity candidates, POS lines that moved no stock); (c) every queue.
2. **What a staff member's line shows** under ADR 0114 G19's role gates — (a) owners and
   managers only; (b) the reads the role already allows, with refused registers named in
   words; (c) loosen G19 — not drawn, it is a gateway change, not a page.
3. **What the WIP base keeps** — (a) all of it (the service probe as Register I, the
   diagnostics block, the Ask AI card); (b) FAQ and support only; (c) the probe as a
   deployment-labelled line, and an Ask entry **gated on `/ask` shipping** — the brief's
   wording. On this tree neither the route nor a flag exists (`App.tsx` has no
   `path="/ask"`; ADR 0145:38: *"Neither the route nor the flag exists here"*, and it
   says not to ship `/ask` until its readings pass). A per-house flag would be the wrong
   gate in any case: ADR 0149 deletes the `mudavym_design_*` registry at cutover. Every
   direction draws the on-state and labels it **hypothetical**.

Slack is **not** decided, so all three directions draw it as the WIP's honest state: a
sentence — *no support channel is configured for this deployment* — never a link to a
default workspace. Composition is client-side from existing reads in every direction
(fork 5a); no direction needs `GET /help/readiness`.

## How to view

```
open .planning/sketches/111-help-directions/direction-a.html
open .planning/sketches/111-help-directions/direction-b.html
open .planning/sketches/111-help-directions/direction-c.html
```

Self-contained, render from `file://`. Each file: the page at 1440 for a US house
(Larkspur & Vine, Oakland, owner, en-US, USD) and a Turkish house (Sim Meyhouse, Kadıköy,
**staff**, tr-TR, TRY), every overlay the page opens drawn open, the three forks as the
row each one changes, a strip of states, and a 390 mobile rendering of the same markup.
A also carries three more sections past the mobile render: the recommendation drawn at
desktop and 390 (§07/07b), the same graft applied to the staff render (§07c), and the
graft under five register states — loading, unread, unreachable, partial, empty (§07d).
See §Recommendation.

Screenshots in `shots/` (`*-1440.png`, `*-390.png`), rendered with
`p4-scratch/render-sketch.mjs`, which bands and stitches anything past Chrome's 16384px
single-shot capture limit (fixed 2026-09-17, see git history for that story). Re-rendered
after this pass's edits and checked for zero console errors and no horizontal overflow at
both widths (A 30948 · 50713, B 22208 · 39726, C 16238 · 27384 — C's 1440 render no longer
needs banding). Fonts load from Google here; the product loads the same faces from Google
today too (`apps/web/index.html:24`). ADR 0149 row 9 decides to self-host fonts on
**public** pages (`0149:` founder answers table, row 9 — its own text says "Fonts on
public pages"); `/help` is signed-in, so row 9 does not reach it and this sketch makes no
claim about it either way. Warm Charcoal is the ground (ADR 0138); one cell per file is
pinned `data-ground="paper"` to prove the tokens hold on the declared exception. Folds are
clickable in A and B (settle, 320 ms); reduced motion collapses every transition. C's
narrowing list is rendered static, one frame per query — no fold is drawn or claimed for it.

## The three directions

### A — The line above the answers (`direction-a.html`)

**Idea.** ADR 0144 §2 taken literally, in the WIP's own document shape. Register I is
one ruled line in four rows — *Live* (each connection with a state word: ingesting,
failed, recorded, probed, never probed, expired, refused), *Waiting* (the queue with a
**Counting** chip that is fork 1), *Last failed* (three registers, three clocks, "not
ordered across them", and the two registers no route can read marked **no reader**), and
*The service* on a tinted band labelled *this deployment, not this house* (fork 3c).
Then Questions, then one address, then the Ask entry gated on the route, then Ways back
in. Overlays: the Counting chip opens an **anchored popover** (a choice) showing the
three scopes with their counts side by side — placed from the chip and clamped to the
frame the way the product's `Popover` does (`Sheet.tsx:246-248`, `useAnchoredPosition`),
so at 390 it sits under the chip, full width less the margins; a connection row opens a
**right sheet at 440** (one object) with what its last error proves and does not.

**Optimises for:** fidelity to the record and to the page the founder already rated
better; the cheapest honest fix; reads as the sibling of `ProfileNext` and
`SettingsNext`.

**Costs.** Keep `hp-support.ts` (its no-fallback rule now reads the decided address from
`VITE_SUPPORT_EMAIL` at build), `hp-service.ts` (becomes row four) and
`useHelpNextData.ts` (grows from one request to eleven for an owner, twelve for staff,
each with its own state). `hp-faq.ts`: add the reconnect entry and a `managerOnly`
field, and **drop `reach-the-team`** — the page has an address section, so that entry
would answer a question the page already answers two sections down; `hp-faq.test.ts`
asserts `findFaq('reach-the-team')` is not null, so the assertion changes with it (or
the entry stays — a small fork, named here so it is not found by a red test). New: a
pure `hp-readiness.ts` that turns each answer into a sentence and a state word (DIGEST
task 6), and the two overlays on the existing `Sheet.tsx` primitive (`Popover`,
`Sheet`). The FAQ footnote says what the test proves: *each destination route checked
against App.tsx by test; the prose is checked by no test*. The graft (§07) needs one more
thing built than the plain page: a loading/unread/unreachable-cascade/empty branch in
`hp-readiness.ts`'s four functions, not just the happy path — §07c and §07d (the staff
render and the five register states) are what that costs when drawn, not a new primitive.

### B — Is it me, the house, or the service (`direction-b.html`)

**Idea.** The same reads arranged as a **triage ladder**: four numbered rungs on a
spine — the service (deployment), the house's connections *and what last failed*, what
is waiting, you — each carrying a state **word**, never a colour. The rule is one
sentence and lives in one function (`bState`) that the ladder, the rail and the mail
body all read, so they cannot disagree: **a rung is clear only when every row answered
for itself (live, or probed ok); otherwise it carries the word for its worst row, in the
order fault · unread · refused · unproven · open; the first rung that is not clear is
where the rail starts.** A recorded row is *unproven*, never clear — a calendar grant
never writes a failure, a declared MCP server is a row until probed, an expired grant
is expiry. Registers with no reader are disclosed inside rung 2, never counted toward
its word. *Not shown* (fork 2a) and *from the session* (rung 4 under the cascade) are
neither clear nor a start. So on the staff page rung 2 is REFUSED and the rail starts
there — the house working as declared, ask Kerem — and rung 4 (the person) is CLEAR:
the refusal is on the read, not on the person. When the gateway is unreachable the
rungs beneath it cascade to *unread*, never *clear*. The FAQ is grouped by rung (the
queue has no written question; *who can change settings* belongs to rung 4). One
support act, one message body: the rail's button, the 620 panel and the "What the
message carries" fold all show the same four-rung text. Overlay: a **centred panel at
620** (a question) — *Write to support with these readings?* — shows it before the mail
app opens. At narrow widths the rail lands under all four rungs, so its start line is
repeated under the masthead with a jump to the rail.

**Optimises for:** the stuck person's first question, answered in the first screen;
the most honest treatment of the cascade and of *recorded is not proven*; one next act,
always.

**Costs.** Everything in A, plus `bState()` in `hp-readiness.ts` (the rule above), a
`rung` field on each FAQ entry, a two-column layout with a sticky rail and the mobile
start line, and the `Panel` shape for the preview. Twelve routes for an owner, thirteen
for staff (`GET /auth/me` on top of A; `/billing/provider` and `/payment-methods` for
staff). The largest departure from the WIP's document: the FAQ is third, not second —
and on a phone the rail is a screen and a half down, which is why the start line is
repeated.

### C — Questions are the index (`direction-c.html`)

**Idea.** One field ("What is wrong?") and one list. Every answer is a row of the same
shape but one of two **kinds**, tagged and never dressed alike: **read now** is a route
the page asked at this minute with its source and its clock; **written** is prose with
a date, whose destination route a test checks against `App.tsx` — the prose itself is
checked by no test, and the tag says exactly that (`hp-faq.test.ts` checks that each
`goes.to` path is mounted, plus slug, brand and emoji rules; it never reads the prose).
The house's state comes first, as questions — *Is the till connected? Is Mudavym
reading our inbox? Is anything waiting on the house? What last failed? Is the service
up? Who am I here?* — which is ADR 0144's "state on top" in the reader's grammar.
Typing narrows the list; the person row keeps the word. Refused and unread are answers
too; *not available* is the Ask row until `/ask` ships; *not shown* is fork 2a. No model
answers anything here: the field is a filter. Overlay: one answer opened gets a **right
sheet at 440** — "The seven waiting on the house" for the owner, "The three" for staff,
"At least 25" when a page is full; the title is built from the count, never typed.

**Optimises for:** the reader who arrives with a question rather than a symptom;
provenance per answer (every row names what kind of thing it is); the FAQ and the
readiness line become one surface with one row shape.

**Costs.** Everything in A, plus a client-side substring matcher over question and
answer text (no endpoint, no model), a `kind` tag on FAQ entries, and the `Sheet` shape
for one answer. Twelve routes for an owner, ten for staff. Risks: six read-now rows
push the written ones below the fold for a person with a written question (they type,
or scroll); and a big question field can be mistaken for `/ask` — the tag and the copy
say "fixed questions", the Ask row names the difference.

## What every direction reads, and where it comes from

All existing, all token-scoped unless noted; composed on the client, each failing on
its own (fork 5a). Line numbers measured on `wt-finish` (`feat/mudavym-finish`):

- Connections: `GET /pos-hub/status/:restaurantId` (`pos-hub.controller.ts:71` — a
  30-day `pos_checks` count: ingestion evidence, not webhook health);
  `GET /mcp-connections` (`mcp-connections.controller.ts:130` — `last_probe_at` is a
  dated probe, never live); `GET /integrations/oauth/connections`
  (`integrations-oauth.controller.ts:99` — since 2026-09-12 a failed read there
  **throws** `ServiceUnavailableException`, `integrations-oauth.service.ts` in
  `listConnections`: "an empty list on failure is the most confident possible lie", so
  the page gets a 503 in words and draws *unread*, never "nothing connected");
  `GET /integrations/oauth/house-grants` (`:120` — staff 403, printed);
  `GET /billing/provider` (`billing/billing.controller.ts:128`, G19 since 2026-09-03 —
  the second refused register on the staff line); `GET /communications/letters/sender`
  (`communications/letters/house-letters.controller.ts:54` — `reader.lastReadAt` and
  `lastError` from `house-inbox.service.ts:805` `statusFor`, dated by `last_read_at`,
  which is written on both paths at `:737`/`:765`/`:788`).
- Waiting: `GET /one-tap-actions/pending` (`one-tap-actions.controller.ts:119`);
  `GET /procurement/orders/pending` (`procurement.controller.ts:191`) — **never**
  `orders/pending/count` (`:169`), which answers `{count: 0}` on a failed read;
  `GET /ask-ai/actions` (`ask-ai.controller.ts:124` — `.limit(20)`, a full page is a
  floor). Fork 1(b) adds `GET /vendor-intel/identity/candidates`
  (`vendor-intel.controller.ts:460` — read its `complete` flag) and
  `GET /pos-hub/unresolved/:restaurantId` (`pos-hub.controller.ts:360`); fork 1(c) adds
  `GET /procurement/credits` (`procurement/documents/credits.controller.ts:90`,
  `.limit(200)` at `:113`, no completeness flag), `GET /pos-hub/mappings/:restaurantId/sale-unit-review` (`pos-hub.controller.ts:183`)
  and the catalogue-match proposals, `GET /pos-hub/catalog-match/:restaurantId/proposals`
  (`pos-hub.controller.ts:280` — verified this pass; the "not verified" note carried in
  the earlier passes was stale and is corrected in every fork 1(c) cell).
- Last failed: `house_inbox_cursors.last_error` via the sender route; letters
  `HOUSE_FAILED` via `GET /conversations/threads` with its `status` query
  (`conversations.controller.ts:145`; the service-side filter is not verified — DIGEST).
  **No route lists failed Mudavym executions** and **the dispatcher's last run is in
  memory** (`communications/letters/house-letters.cron.ts:51`); every direction prints
  both as **no reader**, not as clean and not as unread — *unread* is kept for a read
  that failed. No house-wide failure register exists and none is invented (DIGEST
  missing #1).
- The service: `GET /health/ready` (`readiness.controller.ts:128-129`, `@Public()`,
  memoised 5 s) — one answer for the deployment, labelled as such.
- You: `GET /auth/me/role` (`auth.controller.ts:341`), `GET /auth/me` (B and C).

**Plumbing, against ADR 0149 (locked 2026-09-16).** That record lists sketch 111 as a
gated stop (`0149:123-125`) and, at cutover, deletes `PageGate`, `useMudavymDesign`,
their call sites, and the twenty `mudavym_design_*` registry entries (`0149:66-73`).
So none of the earlier per-house plumbing applies: **no `'help'` in `MUDAVYM_PAGES`,
no `ACTIVE` registry entry, no `mudavym_design_help` migration, no `PageGate` around
`App.tsx:397`.** What is left is one small fork the founder rules on with this sketch:

- **Swap now (recommended):** mount `HelpNext` at `/help` in the same PR — a route
  swap, not a deletion; `Help.tsx` stays on disk until the deletion manifest. The
  reason to swap early is that the legacy page prints an address the project does not
  own (`support@wineops.ai`, five sites measured at `0143:305-308`; ADR 0143 row 8 says
  `support@mudavym.com` everywhere), which is a defect in production, and `/help`
  carries no house data that a swap could put at risk.
- **Strict reading of 0149:** nothing swaps before cutover; the page lands unmounted and
  is mounted at the cutover merge with the rest.

Either way the page reads its two addresses from build variables with no fallback
(`hp-support.ts`). Not drawn: the three dead `trackGuidance` emitters the WIP still
carries (dossier §5, fork F3) — replace with `reportUxSignal` or delete; do not migrate
as-is.

## Honesty traps the sketch handles

- **A failed read is never an empty one** (ADR 0067): a dash and a sentence in the row
  that failed; the rest of the page still answers. The count route's `0` on failure is
  the named reason the list route is used; the connections route's 503 is printed as
  the reason the row is *unread*, and the gateway's own rule for it is quoted in the
  error copy of A and B.
- **Recorded is not proven, and clear is a rule**: a register (A's graft) or a rung (B)
  is *clear* only when every row answered for itself — live, or probed ok. A calendar
  grant, a never-probed MCP server and an expired grant make the word *unproven*, never
  clear; B draws that as its own state cell beside *All clear*, whose rows are all live.
- **The honesty words are kept apart**: *failed* is a recorded failure; *unread* is a
  read that failed; *no reader* is a register no route can list; *not shown* is a
  register the page skips for the reader's role by design (fork 2a); *not available* is
  a door that does not exist yet (the Ask row). None is used for another.
- **Refused is printed, not hidden**: staff see the 403 in words and who to ask; a
  manager-only destination is a disabled control with its reason.
- **A floor is not a total**: when any row is a full page (the route's limit), the
  headline reads *at least 25*, and so do the support block (A), the mail body (B) and
  the sheet's title and link (C) — never the bare sum. The floor chip is drawn only when
  the page is actually full.
- **The deployment is not the house**: the readiness probe is labelled on every
  direction; a ready service clears nothing beneath it (B makes this a rule).
- **Three clocks, not one list**: what last failed is never ordered across registers;
  B carries it inside rung 2 so the ladder shows the same content as A and C.
- **Generated text is not evidence**: nothing on any direction is model output; the Ask
  entry is a gated door drawn as hypothetical, and C's field is a filter.
- **Nothing is sealed, nothing is sent**: no `HoldToApprove`; the mail is previewed
  (B) or carried as a copyable block (A, C); the page stores nothing.
- **No address the project does not own**: `support@mudavym.com` from the build
  variable with no fallback; Slack is a sentence until decided.
- **Captions meet AA on both grounds**: board captions and paper-ground captions use
  `#665d50` / `--ink-4` (the first pass had `--ink-3` at 3.58:1 on the board and 4.59:1
  on paper).

## Founder questions embodied

1. Fork 1 — which count is on the line: 7 (acts due now), 30 (plus curation), 40
   (every queue), drawn as three cells in every file. Recommended (a): a queue a person
   cannot act on from `/help` is noise on a page they opened because they are stuck.
2. Fork 2 — the staff line: (a) a sentence naming who can see it (*not shown*, nothing
   read, nothing refused), or (b) the role's own reads with refusals printed.
   Recommended (b): a refusal in words is more useful to a staff member than an
   absence, and it is what the gateway already does.
3. Fork 3 — the WIP base: (a) whole, (b) FAQ and support only, (c) probe as a
   deployment-labelled line plus the Ask entry gated on `/ask` shipping, off and on
   (hypothetical) drawn in every file. Recommended (c).
4. **Swap `/help` now or at cutover** (the ADR 0149 plumbing fork above). Recommended:
   swap now, because the legacy page prints a wrong address.
5. **Does Slack exist as a support channel at all?** Every direction says "not
   configured" until the founder names a workspace or retires the card.
6. **A history register's word.** A's graft gives *Last failed* the word *fault* while
   a dated failure stands; B gives rung 2 its word from the connections (the present)
   and draws the failures as dated rows beneath. Both are drawn; the founder picks
   which reading of "what last failed" the word should carry.
7. Not embodied: whether `/help` is reachable signed out (dossier F2). All three assume
   a signed-in reader; a signed-out `/help` would carry no house data and is a different
   page.

## Recommendation

**Build A as drawn in its section 07.** A is ADR 0144 §2 as written, on the WIP the
founder already rated better, with the house's two existing overlay shapes and no
layout the record would have to be re-decided for. Section 07 (`direction-a.html`,
desktop and 390) draws the one graft from B that is worth carrying: a state word on
each of the four registers under the rule above (Live FAULT · Waiting OPEN · Last
failed FAULT · The service CLEAR for the US house), and a lead that names the
worst-ranked register across Live and Last failed together, not just Live alone —
*"Start with the Gmail read grant — refused, last attempt 2:02 PM today. What is
waiting is a queue, not a fault; the service is up."* §07c draws the same graft for a
staff account, where it earns its keep: Live reads REFUSED (two registers gated) but
Last failed reads FAULT (a real, readable failure), and the lead correctly starts
there — *"Start with what last failed — Inbox read · Gmail grant..."* — never letting
the refusal hide the fault beneath it. §07d draws the graft under five register states
(loading, unread, unreachable, partial, empty) so the founder can see it is not a
happy-path-only device. It needs no second column. The graft from C is already in A's
FAQ footnote: the written kind names its date and what its test proves.

Pick **B** instead only if the founder wants `/help` to be a diagnostic rather than a
document — it is the stronger customer story and the most honest about the cascade and
about unproven rows, but it moves the FAQ to third place, adds a rail that is a screen
and a half down on a phone, and is a change to the record's shape, not just its
rendering. **C** is the most novel and the one to keep in mind for when `/ask` ships:
at that point a question field on `/help` competes with a page named Mudavym, and the
two should be one surface or clearly two.

## Shortcuts, stated

Example data throughout; nothing was read from the gateway or the database. Route paths
were verified by grep on this tree, catalogue-match included as of this pass (see below);
the `status` filter on the threads service stays unverified — the service-side filter
logic, not the route. The `served: null` third state on producers/reminders status
(DIGEST faults 21–22) is a build note, not drawn. No skill was loaded for craft in any
pass. The style pass this session (below) was defect-driven — removing the hatch, the
live-looking scope control and the printed sketch-rationale — not a section-by-section
word-count rewrite of the FAQ or the ways-back-in list; a founder who wants those shorter
too should say so as its own round.

Audit pass, 2026-09-17 (a second session over the 2026-09-16 draft): every cited
`file:line` was re-read on `wt-finish`. Three corrections were made rather than copied
forward — (1) the oauth connections route no longer returns `[]` on a DB error, it
refuses with a 503 since 2026-09-12; (2) the product does **not** self-host its fonts
yet (`apps/web/index.html:24` loads them from Google; ADR 0149 row 9 decides to);
(3) three cites carried a flattened path and are now the real ones. Two layout defects
were found by measuring the DOM: C's 440 sheet wrapped its source path at every hyphen
(`.c-sheet-q li { display: grid }` inherited by the nested list, now `> li`); A's
narrow fork cells overlapped the FAILED chip with the row's name (`minmax(44px, auto)`
beside an `fr` collapses to min-content, now `max-content` and `minmax(0, 1fr)`). One
deliberate deviation from the seven motion tokens: the loading skeleton's sheen uses
the built pages' own `cubic-bezier(0.45, 0, 0.55, 1)` at 1.9 s (`dashboard-next.css:44`,
`reports-next.css:391`) rather than a `motion.ts` token, because that is what the
product's loading rows already do. **That pass's screenshot claim was wrong**: it said
"six renders re-measured", but five of the six images repeated the top of the page
past 16384px and nobody had looked at the pixels — see §How to view for the fix.

Critique pass, 2026-09-17 (a third session, twenty-one findings from a critic who
measured rather than read): all applied. The false `/ask` claim removed and the Ask
entry gated on the route; the plumbing and costs rewritten against ADR 0149; the
floor carried into every headline; C's "Show the seven" and sheet title built from the
count; B's rung rule written once and drawn the same everywhere (staff starts at rung
2; *All clear* has only live rows; a new *Unproven* cell; rung 4 under the cascade is
*from the session*); B's Fork 3·a cell added and 3·c drawn off and on; what last failed
put on B's ladder inside rung 2; C's written tag reduced to what `hp-faq.test.ts`
proves; A's popover placed from the chip and clamped; board and paper captions to
`--ink-4`; the recommendation drawn (A §07); the honesty words separated (*no reader*,
*not shown*, *not available*); the `PAGE OF 20` chip shown only when full; B given one
support act and one message body, its FAQ regrouped, its routes recounted per role,
and a mobile start line; the shared "the line above says when" copy varied per
direction; the font comment corrected; C's fold claim withdrawn; the long mono tokens
allowed to break, the deployment chip on its own line, the decided date in a nowrap
span; and `p4-scratch/render-sketch.mjs` fixed to band past 16384px. Not re-verified
by this pass: the `file:line` cites in §What every direction reads (carried from the
audit pass, on the same tree, one day later).

Fixes pass, 2026-09-17 (a fourth session, fifteen findings from a second critic — seven
major, eight minor — plus the founder's style bar). All fifteen applied, across all three
files:

- **Staff sees what staff can read (majors 1–2).** `GET /communications/letters/sender`
  and `GET /conversations/threads` carry no role check, so the staff render (§02, and
  every fork/state cell that used to say "not shown for your role" or "nothing recorded")
  now shows the real inbox-read and letter failures, with the execution register alone
  marked *no reader* — for anyone, not by role. G19 is cited only on billing and
  payment-methods now; house-grants is "manager-only" in its own words.
- **An absent grant is its own kind, not `unproven` (major 3).** New chip kind `absent`
  (a dashed, uncoloured pill) — the staff Live headline no longer counts "no grant
  recorded for you" as a recorded-not-proven connection.
- **The hatch now means one thing (major 4).** It never meant trouble anywhere in this
  sketch's data (every hatch use was `unread`/`failed`/`refused`/`unproven`/a floor
  marker) — all of those now draw a solid marker or a left rule instead; `--hatch` and
  every `hp-status--hatch`/`.a-word`/`.b-word` hatch rule are gone. This is also most of
  the founder's "honesty states kept but quiet" ask: a diagonal-line chip reads louder
  than a plain bordered word.
- **A fabricated reading, removed (major 5).** B's owner rung 4 no longer claims "signed
  in with Google this session · seal step-up not yet asked" — no route gives that. It now
  reads `linked sign-ins: Google` from `GET /auth/me`'s real `linkedProviders`.
- **Real destinations (major 6).** Proposals open the Ask AI surface ("Open in Ask AI"),
  never `/ask`; one-tap acts open `/` (the dashboard's real path), never `/dashboard`;
  credits open `/receipts?tab=credits`, never `/documents`. C's sheet prints these, not
  the old wrong paths.
- **The graft covers more than the happy path (major 7).** §07 gained a staff frame
  (§07c) and a five-state strip (§07d — loading, unread, unreachable, partial, empty);
  `regWords()` now returns `reading` while loading instead of stale data, cascades every
  register to `unread` when the gateway itself is down, and — the one that actually
  changes the founder-facing sentence — `hybridLead()` now ranks Live against Last failed
  and leads with whichever is worse, so a refused connections register can never hide a
  real recorded failure sitting right below it (visible on §07c: Live REFUSED, Last
  failed FAULT, the lead starts with the fault). The identical gap existed in B's
  `bState()` — a rung 2 word computed only from connections, never checking whether last
  failed held a real failure — and is fixed there too, with the same fold-in rule.
- **No sketch device inside the product frame (major 8).** The "Counting: X ▾" control
  read as a live, clickable switch on every render, when fork 1 is a build-time choice,
  not a reader-facing toggle; it is now static text (`counting: acts due now`) everywhere
  except the one frame built to test the anchored-popover mechanics (§03a in A, now
  labelled hypothetical on the board, not in the page). The popover's own printed aside
  ("the chip is drawn so the sketch can show...") and B's panel footer aside ("closes
  with a word, not an X") both moved to their board labels.
- **Eight minor fixes**: the reconnect-gmail FAQ answer is conditional (refused token vs.
  house-revoked) instead of naming only one cause, demonstrated by giving the Turkish
  house a `house_revoked` failure where the US house has `invalid_grant`; every "last
  read" became "last attempt" with a note that a refused attempt writes `last_read_at`
  too; B's "recorded is not proven" note prints only when the rung word actually is
  `unproven`, and the CLEAR_CONN demo's live chip is `read ok`, not `reading` (which now
  means the loading state only); A's and C's connections error-state renders list every
  row that answered and mark unread only the two that came from the two down routes,
  instead of blanking the whole register; every Fork 3·b/3·c cell says whether the
  diagnostics block and mail body stay; the citations above are corrected; the CSS
  comment about `--ink-3`'s contrast now says what was actually measured (3.58:1 on the
  board, under AA; 4.59:1 on paper, meets AA's 4.5 but thinly) instead of calling the
  paper number a failure it wasn't.

**Style bar (founder, 2026-09-17).** Read for the look, not copied for content, since
none of the three referenced pieces are a `/help`-shaped page: `mudavym-wave-four.md` and
`the-arrival-five-ways.md` are sketch-gallery index pages (a nav of named directions, an
`.idea` paragraph per one, technical detail pushed into a footer table); sketch 104
direction C is a dense, heavily-cited onboarding flow whose density lives in visually
separate `.note`/`.route` blocks below terse `field: value` rows, not in the headline
copy. `documents-and-reports-redesign.md` is a Claude Design canvas artifact (React,
`om-*` design tokens, copy built from JS template calls at runtime) — its saved source has
no static markup to grep for a look; opened and confirmed live, not analysed for style, a
shortcut stated rather than a claim about its density I could not check. This sketch's
architecture already matches the two I could read — a headline sentence, a chip, a
one-line detail as the primary read, with citations in small `.hp-sources` footnotes — so
the style pass here was the defect-driven one above (quieter honesty states, no
live-looking controls, no rationale printed as product copy), not a rewrite of section
count or prose length. Screenshots re-rendered and checked by pixel after every fix in
this pass (A 30948 · 50713, B 22208 · 39726, C 16238 · 27384 — see §How to view).

## Related

- ADR 0144 §2 (the page's job) · ADR 0143 row 8 (the address) · ADR 0149 (build all,
  one cutover; deletes the gate machinery; sketch 111 is a gated stop) · ADR 0114 G19
  (the role gates) · ADR 0145 (`/ask` — not until its readings pass) · ADR 0112 (three
  shapes) · ADR 0067 (a failed read is never an empty one) · ADR 0138 (the ground)
- Dossier `p4-scratch/ux/help.md`; DIGEST `p4-scratch/wave/DIGEST.md` §help; census
  fork F08; page note `.planning/06-pages/help.md`
- WIP: `origin/feat/mudavym-new-pages:apps/web/src/pages/help/next/`
