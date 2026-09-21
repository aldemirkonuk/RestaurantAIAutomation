---
sketch: 115
name: arrival-action-boxes
question: "Inside C's book, what shape does the 'what do I do next' guidance take on each folio, and how does it carry every folio state without ever becoming a percentage?"
winner: null
tags: [get-started, onboarding, arrival, action-boxes, tutorial, folio, next-act, seal, provenance, speech, low-stock-threshold, adr-0143, adr-0144, adr-0113, adr-0112, adr-0138, mudavym]
---

# Sketch 115 · The action boxes inside the arrival book, three ways

## Design question

The arrival is decided: direction C of sketch 104 — a flyleaf and folios, each folio with its
own persisted state, never a percentage ([ADR 0143 §4](../../decisions/0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms.md));
folio 0 is the last invoice and is skippable ([ADR 0144 §1](../../decisions/0144-the-book-opens-on-evidence-and-three-pages-get-a-job.md));
speech is on-device and only the rows are kept; only what Mudavym proposed waits for the one
held seal, and what a person typed posts at once (ADR 0143, founder answers of 12 Sep). Decided
today: the house-wide low-stock threshold is one line on fo. 2 *What we pour* (activation =
menu uploaded + threshold configured, `services/api/menus.ts:63-66`), and `/onboarding`
redirects to `/get-started` (drawn as the caption on frame 01 of each file).

Revised 2026-09-17 after review: the confirm act on fo. 2 now sends what Mudavym read into
the pencil batch (ADR 0143:250-253, ADR 0144:31) instead of posting; the untouched low-stock
line is drawn as *3 · defaulted · not yet confirmed* (the value main really uses,
`menus.service.ts:18`, baseline migration `:3580`) instead of `null`; activation is drawn as
its two facts (menu uploaded, threshold configured); the fo. 5 receipt rests on two refusals
the apply loop really produces; captions moved from `--ink-3` to `--ink-4`; every reopen
popover is rendered outside its clipping box; a read-failed state is drawn in each file.

Revised again 2026-09-17, against a design critic's pass: dropped the anchored *Reopen*
popover everywhere in favour of the inline correcting entry A and B already used (C now
matches — no overlay in any direction, so ADR 0112's placement question does not arise); fixed
C specifically, which had not carried the first revision — its cutoff field no longer
pre-fills a value nobody typed, its skeletons no longer loop, its expanded refused/blocked
rows no longer borrow the seal colour, its per-row state edge no longer clips to nothing, its
header now draws the bell and user menu instead of a name and a Settings link, its hold face
is paper-1, its refusal box drops the invented "400 ·" prefix and the date nothing journals,
and its build notes now hide behind the same off-by-default toggle as A and B; added a fo. 0
(four states) · fo. 1 · fo. 4 frame to C, matching A and B; fixed C's frame-01 timeline (fo. 0
reads as read and matched, not carried forward; fo. 3 and the phone tabs no longer show an
event — Hasan's 14:20 — that has not happened yet at that frame's moment); quoted the
founder's `/get-started` note in full and added a short comparison to leading onboarding
patterns; added a founder question about B's book-level ranking. Every fix above was checked
against the live file, not assumed from the critic's report — several findings the critic
raised (the duplicated act on B's frame 01, B's upward popover, A's Fraunces voice, A and B's
Say-it-aloud renaming) were already fixed by the first revision and are not repeated here.

What the founder asked for, in his words: **"improve the UI for tutorial action boxes"** — the
boxes that tell a new owner what to do next on each folio. His note on C when he picked it
(artifact `the-arrival-five-ways`, verdict `c`, quoted in full — ADR 0149 row 38 flagged the
earlier version of this README for ending the sentence early): *"keep /get-started (just make
sure the lines are rendered to correctly underline the texts) + make sure to add our motions to
the buttons, keep it readable not too much info looking at once, with not tiring the eyes for
looking to find info (check sales department and UI design from human lens is needed)."*

The parenthetical is a second, separate ask: check how the sales/growth side would judge this,
and borrow from how leading products shape "what next" guidance — his own words elsewhere in
the same note, on other pages, are "mimic current best performancers." Held against that bar,
the three directions map onto three well-known shapes: A is closest to a **contextual inline
hint** (Notion's slash-page hints, Linear's empty-state copy) — guidance lives beside the thing
it explains and never becomes its own surface; B is closest to a **single next-action banner**
(Stripe's Dashboard "complete your account" card, GitHub's repo setup checklist collapsed to
one row) — one task, one button, advance on completion; C is closest to a **checklist/progress
list** (Linear's onboarding checklist, Asana's project setup list) — every task visible, check
marks accumulate, the whole list is the record. The pattern the leaders share is B's: the
banner shows one task at a time even when a full checklist exists underneath (Stripe keeps the
checklist collapsed behind the single active card; GitHub's setup guide highlights one next
step while listing the rest greyed-out below it). That does not overturn the B recommendation
below — it reinforces it, and suggests the "then" line in B's slip (already present) is doing
the same job as the greyed-out rest of those lists, at lower cost than drawing them.

### What the boxes are today

In Codex's uncommitted build (`codex-rescue-2026-09-16/public-pages/apps/web/src/pages/arrival/`)
the guidance and the status share one shape: `.ar-message` (`arrival.css:214-221`, a paper-2
box with a seal-coloured left border) carries "Carried forward. The skip is recorded", "The
paper is stored. Read its extracted details…", the refusal text, *and* the empty-state hint
("Nothing is in pencil yet. Speak a supported field…"). The folio's purpose is a paragraph
(`.ar-intro`), the only page-level act is "Carry this folio forward" at the foot
(`Arrival.tsx:1065-1078`), and the acts themselves are buttons scattered through the fields.
A new owner has to read the whole page to find the one thing to do, and cannot tell a
tutorial box from an error box by looking. That is the fault all three directions answer.

## The three directions

| Letter | Name | The idea | Optimises | Costs |
|---|---|---|---|---|
| A | **The note in the margin** | The guidance is a gloss, not a box: every act sits in the outer margin beside the very line it concerns, in the keeper's voice, one verb in seal and one quiet alternative. The line is the record; the note tells you what to do to it, and changes its mark (Say it · In pencil · Posted · C/F · Refused · Opens when · Could not be read), never its place. | Reading as a book. The ledger is never interrupted; the note is where a scribe would put it. | A two-column recto at 1440; at 390 the margin folds under the line as a footnote, so the eye travels. Notes are a client rule table keyed on (folio, line, state). The narrow glossed ledger has to let a long provenance wrap. |
| B | **One slip, one act** | Each folio carries one slip at its head holding exactly one act: the one that unblocks the most among the acts still unanswered, its reason, what comes after, and the control that does it. On fo. 2 that is the low-stock line (it finishes activation), then the seven registers, which go in pencil. When the act lands the slip advances (settle in); when both acts are taken the slip says the page waits on the seal, and only once the seal has landed does it *become* the double rule. The contents page carries one book-level slip. The ledger beneath stays fully live — the slip points, it never hides. | Finding the next thing without searching. One fixed place per page, one act, one control. | A "next act" ranking per folio — a client rule over `GET /arrival`'s readout, no model, no endpoint. The rule counts and names only unanswered rows (stated and in-pencil rows are out of both the count and "then"); the ranking is an opinion, so the ledger stays editable out of order. |
| C | **The docket** | The folio opens as a short ruled list of its acts — as many rows as its register has lines (three on fo. 2, six for one vendor on fo. 3) — with an act, a how, and a state column that fills as facts land. One row opens at a time on `settle` (0fr → 1fr) and holds its lines and its control. The docket is the tutorial and the record in one object; the contents count acts (posted · in pencil · c/f · open) as the sum of the folio lines printed under them, never a percentage. | Nothing about "what to do" can go stale — the row that told you is the row that says what was done, by whom, and how. A returning owner sees the whole page's state in one list. | The densest head of the three: every act visible at once. An act table per folio on the client; the counts on the contents need the aggregated read. A row that hosts acts of its own (fo. 5's *Leave out*) cannot be a button, so it is a disclosure with a separate toggle. |

What all three share, because the decision demands it: C's book (contents verso, folio
recto; the house header from `components/mudavym/HouseHeader`), the seven motion tokens and
nothing else (`ink` on hover, `settle` on a state arriving, `turn` on a folio entering — applied
to the recto in A; B and C leave the spread's turn to the book itself as sketch 104 C drew it,
`pour` on the hold, `tuck` on an early release, `stamp` on the wax, `tally` on C's changing
contents counts (its only use, since A and B never draw a summed count); the
listening mark is a static seal dot, not a pulse, because no token is a loop; `tuck`, `stamp`
and `tally` are cubic-bezier approximations of `motion.ts`'s sampled `linear()` springs and
the files say so), **no overlay** (reopening a posted line is inline in all three — the value
strikes in place and a field opens beside it; nothing is written until a new value is posted,
so ADR 0112's Popover and Panel are both left alone rather than choosing one and inventing a
new placement for it), Warm
Charcoal as the ground with the paper escape on a toggle (ADR 0138), captions and meta in
`--ink-4` (5.1–6.4:1 on paper, 6.4–7.4:1 on charcoal; `--ink-3` fails AA at these sizes), and
the founder's line fix: **every rule is the line's own bottom border**, never a background
grid, so a rule always underlines text.

Two facts the boxes now carry on every fo. 2, because the decided rules demand them:

- **Confirming the seven registers puts them in pencil.** What Mudavym read off the books
  enters the book only with the one held seal on fo. 5 (ADR 0143:250-253; ADR 0144:31: a
  proposal confirmed in place *still enters the book with the one held seal*). Codex's build
  already says so — *Put the house's inferred registers in pencil* (`Arrival.tsx:880-915`).
  Only a register the owner switches by hand posts at once, source `manual`
  (`cellar-registers.ts:52`). The act reads *Confirm the seven · in pencil* and its box says
  *waits on the seal, fo. 5*; the contents line keeps the fact.
- **Activation is two facts, both drawn.** `menu_uploaded AND threshold_configured`
  (`services/api/menus.ts:63-66`). *Menu uploaded · yes · 42 lines read at the door · posted
  13:52* sits as its own line above the low-stock line, and the caption says the registers
  do not count. The low-stock line untouched reads *3 · defaulted · not yet confirmed*:
  `restaurants.default_threshold_min integer DEFAULT 3` (baseline `:3580`), the service falls
  back to 3 (`menus.service.ts:18`, `:589`), and `threshold_configured` only feeds the
  onboarding-progress read (`:696-704`) — nothing turns notices off. Codex labels the same line
  *Existing default · not yet confirmed* (`Arrival.tsx:917-935`). The box says the line sets
  the default copied onto newly imported rows, not "every line in the cellar".

## Every state, in each direction

| State | A · the note | B · the slip | C · the docket row |
|---|---|---|---|
| Untouched (defaulted) | mark *To answer*; the line reads *3 · defaulted · not yet confirmed*; one verb in seal, one quiet alternative | seal ribbon; *Next on this page · 2 left · Confirm the low-stock line*; the control inside the slip with the 3 in it; *then · the seven registers · in pencil* | *3 · defaulted · unconfirmed*; the row opens to its lines and control |
| In pencil, waiting on the seal | mark *In pencil* in ink-1; "It enters the book when you hold the seal on fo. 5 — until then the default of three stays in use"; *Read it on fo. 5 · Leave it out*. The confirmed registers take the same mark | grey ribbon; *Six bottles, spoken at 14:04*; *Turn to fo. 5 · Leave it out*; *the seal lands once · on fo. 5 · never here* | *in pencil · 14:04 · spoken · waits on the seal, fo. 5*; the row's left edge grey |
| Posted | mark *Posted 14:06* with a small double rule; *Reopen this line* → inline, the value strikes in place with a fresh field beside it, nothing written until posted | the slip is the double rule only once the seal has landed: *Ruled off · 6 Sep 14:12 · Defne · low line 6, typed 14:06 · seven registers sealed 14:12*; *Reopen this page* → the same inline correction | double rule under the row; *posted · 14:06 · typed · Defne · PATCH /menus/threshold*; the row still opens, to reopen inline — no overlay in any of the three |
| Carried forward | mark *C/F · 6 Sep 14:02*; the line keeps *3 · defaulted · not yet confirmed*; *Answer it now* | grey ribbon, no fill; *Offered and carried forward. Three stays the default copied onto newly imported rows*; *Answer it now* | *c/f · 6 Sep 14:02 · offered and skipped · Defne · 3 stays the default*; the act in ink-4 |
| Refused | mark *Refused* underlined; the register's words verbatim in a mono box for a typed 1000 — *This is not a supported configuration value. Nothing was recorded.* (Codex `arrival-contract.ts:94-96`, no status code in the words; straight through `PATCH /menus/threshold` it would be class-validator's *thresholdMin must not be greater than 999*, `set-threshold.dto.ts:11`); *Try again · Carry it forward* | ink ribbon; the same words under the act; the field keeps the 1000; *Try again* | *refused* with the words in a bordered small under the state; the row keeps the typed value, undated |
| Blocked | mark *Opens when*; the unblocking act offered instead (*Write a vendor*) | grey ribbon; *A vendor is written in this book.*; *Write a vendor · Read the last invoice* | *opens when · a vendor is written*; the row opens to that act |
| Reading | skeleton lines; no field offered | skeleton slip; no act offered until the read returns | two skeleton rows; no act offered |
| Could not be read | mark *Could not be read*; the source's words verbatim — *The recorded registers could not be read.* (Codex `Arrival.tsx:108`, `SourceFailure`); the line reads *unread · not empty · not 3*; *Read again*; no field | ink ribbon; the same words in the slip; *Read again*; no act | a *could not be read* row with the words under the state; *Read again*; no field |
| Partial (a subtotal) | single rule; *1 of 2*; the note names the vendor still blank | *Next on this page · 1 left*; *Write Marquette Dairy's terms.* | one row posted, one open, the foot *1 of 2 · the page stays at a subtotal* |
| fo. 5, the seal | the note beside the hold reads the batch and then the receipt back; the folio caption becomes *sealed 14:12 · 2 written · 1 refused · 1 unconfirmed* and each row carries its own outcome, never one "sealed" | the slip is the seal's slip and turns into the receipt line; the rows carry their outcomes | the fifth row holds the hold; each row's state becomes its own receipt |

Each file also draws fo. 3 at 390 for Hasan at the phone (Tuna İçecek), where the typed
delivery days posted at once and the spoken "net 30" waits in pencil — the founder's 12 Sep
ruling shown by a mark, not a sentence.

## What it costs to build

Nothing in any direction needs a new server route. Every act posts through a register that
exists on `main`; the book itself is Codex's uncommitted arrival build. Read 2026-09-16 on the
`wt-finish` worktree (`feat/mudavym-finish`) and on `codex-rescue-2026-09-16/public-pages`:

| Act | Route | Where | Status |
|---|---|---|---|
| the book's readout (every folio's state, the batches, `canManage`) | `GET /arrival` | `arrival.controller.ts:31`, `arrival-api.ts:130` | Codex, uncommitted. On `main` the book's memory has no single row: five reads |
| carry a folio forward | `POST /arrival/skip` → `arrival_folios` | `arrival.controller.ts:34`; migration `20260913190500_arrival_configuration_book.sql:4` | Codex, uncommitted. `configuration_step_skipped` does not exist on `main` (grep of `apps/api-gateway/src`: 0 hits) |
| a typed line, posted at once | `POST /arrival/typed` | `arrival.controller.ts:40` | Codex; fans out to the registers below |
| currency | `PUT /settings/currency` | `settings/settings.controller.ts:227` | main |
| the seven registers | `PUT /cellar/:restaurantId/registers` | `cellar/cellar.controller.ts:115`; ids `cellar-registers.ts:13-21` | main |
| the low-stock line | `PATCH /menus/threshold` | `menus/menus.controller.ts:91`; `thresholdMin` `@Min(0) @Max(999)` `set-threshold.dto.ts:9-11` | main; default 3 `menus.service.ts:18`; activation flag `services/api/menus.ts:63-66` |
| a vendor's terms · usual currency | `PUT /vendor-terms/:providerId` · `PATCH /providers/:id/usual-currency` | `vendor-terms.controller.ts:71` · `providers.controller.ts:326` | main; a vendor is written by `POST /providers` · `providers.controller.ts:245` |
| the person's ears | `PATCH /notifications/preferences` | `notifications.controller.ts:351` | main; per person, not per house |
| a spoken or inferred line, in pencil | `POST /arrival/config/propose_batch` | `arrival.controller.ts:46` | Codex |
| the one seal · leave out · undo | `POST /arrival/batches/:id/apply` · `…/rows/:rowId/discard` · `…/undo` | `arrival.controller.ts:83, 90, 98` | Codex; undo migration `20260913190600`. The apply loop reports each row as `written`, `refused` (with the writer's message, or *This field changed after the proposal. It was left as it stands.* when a person stated the field after the proposal, `arrival.service.ts:708-710`) or `unconfirmed` (*The writer did not return a confirmed receipt…*, `:755-761`); it does not produce a "not attempted" |
| the voice | browser `SpeechRecognition` with `processLocally` | `local-speech.ts:6, 25, 31-80` | Codex; Chrome and Edge; the control says when it is unavailable |
| the register's words on a refusal | `arrivalError()` · `validateConfiguration()` | `arrival-api.ts:186-195` · `arrival-contract.ts:90-96` | Codex; returns the server's message verbatim; a typed value outside the closed vocabulary is refused with *This is not a supported configuration value. Nothing was recorded.* |
| a read that fails | `SourceFailure` | `Arrival.tsx:180-192`, reasons at `:69, :83, :102, :108, :127` | Codex; the reason is the source's, *Read again* re-reads, nothing is substituted |

Per direction, the client work is the whole cost. Reopening a posted line costs the same
everywhere — an inline strike-and-refield, no overlay component, no new ADR 0112 placement —
so it is not itemised per direction below. Each direction also now draws fo. 0 in its own four
states (untouched, reading, proposals in pencil, carried forward) plus one card each for fo. 1
and fo. 4, at no cost beyond the state work already listed in the table above:

- **A** — a two-column gloss layout on the recto (and a mirrored one on the verso), a note
  component with eight marks, and a rule table: for each (folio, line, state) the sentence,
  the verb and the alternative. The footnote fold at 390. About the same code as today's
  `.ar-message` and `.ar-note` put together, but with a state.
- **B** — a slip component with nine states, a book-level slip on the contents, and a
  ranking rule per folio ("the act that unblocks the most, among the unanswered"): for fo. 2
  that is the low-stock line (activation) then the seven registers (pencil); for fo. 3 the
  vendor with the most blank columns, and within a vendor only the columns still unanswered
  (the phone frame reads *2 left · then minimum order*, with the stated currency and the
  in-pencil net 30 left out of both); for fo. 5 the seal. The ranking is a pure function of
  `GET /arrival`'s readout.
- **C** — an act table per folio (as many rows as the register has lines, static), the
  expandable row on `settle` (the founder's named favourite, `dashboard-next.css:10-19`), and
  the counts on the contents, which are the sum of the per-folio lines. The counts need
  nothing the readout does not already carry. Two row shapes, not one: a row with no acts of
  its own is a `<button>`; a row that hosts acts (fo. 5's *Leave out*, which is ADR 0113's
  per-row discard `POST …/rows/:rowId/discard`) is a `<div>` with a separate toggle button
  and real sibling buttons, because interactive content inside a button is invalid HTML.

Two build tasks are common to all three and are not the box: the skip writer (Codex's
`/arrival/skip`, or `configuration_step_skipped` under ADR 0113) so that "offered and
skipped" can be told from "never opened"; and surfacing `query.error` so the reading state
can become the refusing state instead of a blank (`get-started.md` §12, item 3).

## Honesty traps the sketches handle

- **A default is not an answer.** The low-stock line reads *3 · defaulted · not yet
  confirmed* — the value main really uses (`DEFAULT 3`, `menus.service.ts:18`) — with
  `threshold_configured` false. It is neither hidden as `null` nor shown as if somebody had
  said it, and no claim is made that notices are off.
- **A draft is not a setting.** A spoken six sits in pencil; the default of three stays in
  use and `threshold_configured` stays false until the seal lands on fo. 5. The contents say
  *in pencil*, not *done*.
- **Confirmed is not posted.** The seven registers confirmed on fo. 2 go in pencil and fo. 5
  lists them; only a register switched by hand posts at once. The contents line keeps both
  facts.
- **Typed posts at once; proposed waits.** Shown by the provenance mark on the line
  (*typed · 14:06 · Defne* under a double rule, versus *spoken · 14:04 · in pencil* in grey),
  never by a sentence the owner has to read.
- **A skip is a fact with a date.** *Offered 6 Sep 14:02 · c/f* on the line, the contents
  and the note; drawn against Codex's `arrival_folios` row, and the README says the writer
  does not exist on `main`.
- **A refusal is not a value.** The register's words verbatim, in mono, *nothing written*,
  and the field keeps what was typed. No red: the one chromatic colour stays the seal.
- **A reading is not evidence.** Every register count ("31 lines on the list · 0 in the
  cellar") is a link to the lines it was read from; the batch lines name the invoice they
  were read off.
- **The receipt is per line.** Bereket Gıda is in the vendor book (matched on fo. 0); the
  batch holds the spoken six, two lines read off its invoice, and the confirmed registers.
  Two are written; the usual currency is refused because Hasan stated it by hand at 14:10,
  after the proposal (*This field changed after the proposal. It was left as it stands.*,
  the apply loop's own words); the delivery days come back *unconfirmed* (*The writer did not
  return a confirmed receipt. Read the setting before another attempt.*) — never one "Done"
  (ADR 0113 rule 4). Each row carries its own outcome; the folio caption becomes *sealed
  14:12 · 2 written · 1 refused · 1 unconfirmed*; the undo window is dated.
- **Unread is not empty.** The reading state offers no field and no act; the could-not-be-read
  state quotes the source (*The recorded registers could not be read.*), shows *unread · not
  3* on the line, and offers *Read again* and nothing else.
- **The example clock only moves forward.** Every live flow stamps acts from one ticking
  clock, so a page is never ruled off before the line it contains.
- **The transcript is not kept.** The listening state says it in one line; the "Say it
  aloud" control says it is unavailable rather than doing nothing (Safari).

## Founder questions these embody

1. **Where does the guidance live** — beside the line (A), in one place at the head (B), or
   as the page's own list of acts (C)? This is the pick.
2. **Does the slip carry the act's control, or only point at the ledger row?** B is drawn
   carrying it, so a manager at the phone does the act where he reads it; the row beneath
   stays live for anything out of order.
3. **Counts on the contents.** C's *posted 1 · in pencil 1 · c/f 0 · open 6* is the sum of
   the folio lines printed under it (posted = fo. 1; in pencil = fo. 3's Bereket line,
   confirmed in place from fo. 0; open = fo. 2 (2) + fo. 3 (1) + fo. 4 (3); fo. 0 itself is
   read and matched, not a countable act, like the opening stock below it), a count of facts
   and never a percentage — is that inside the rule, or too close to a progress bar?
4. **The ground of the page.** Drawn on Warm Charcoal (ADR 0138) with the paper escape on a
   toggle. A ledger page is arguably "a sheet of paper by decision" (ADR 0104 D9's precedent);
   the founder saw sketch 104 on paper. Which one does the book get?
5. **Skip granularity.** Codex's writer skips a folio; A draws *Carry it forward* per line as
   well as per page. Per line needs a row per line, not per folio.
6. **Is a refusal journaled?** All three show it; nothing records it. If the assistant
   should later say "the register refused this once", it needs a row.
7. **B's book slip ranks across the whole book, not just one page.** On frame 01 it points at
   fo. 2 ("next in the book") while fo. 0 sits above it in the contents reading *Read*, already
   answered. That is right here because fo. 0 truly is done first. But the rule that produces
   it — the act that unblocks the most, among every unanswered row in the book, not just the
   open page — is untested against a state where fo. 0 itself is still open: does the book
   slip then point at fo. 0 before fo. 2, even though fo. 2 is the page the owner has open?
   Frame 02 draws fo. 0 untouched, but only as a state card, not as the book slip's target.
   Is book-level ranking one rule with page-level ranking, or does the book slip defer to
   "whichever page is open" the way the fo. 2 slip already defers to nothing?

## Recommendation

**B, with A's voice and C's counts.** The founder's note asked for three things — readable,
not too much at once, no searching to find the thing to do — and B is the only shape that
gives "what next" one fixed place on every page with one act and one control in it. A is the
most bookish and the least tiring to read, but at 390 the margin folds into footnotes and the
eye has to travel to the outer edge at 1440; C is the most honest record and the right
contents page, but its head shows every act at once — six rows for one vendor in the phone
frame, five on fo. 5 — which is the "too much info looking at once" he named. Graft: keep B's
slip, write its reason line in A's voice (a sentence in the keeper's register, one verb, one
alternative), and put C's counts on the contents verso in place of B's book-level slip if the
founder prefers a count to a pointer. The risk in B is that "next" is Mudavym's opinion; it
is held in check because the rule ranks only unanswered rows and says so in its count, the
slip names what comes after, the ledger stays editable out of order (no wizard), and nothing
is ever a percentage.

## Files

- `direction-a.html` — The note in the margin
- `direction-b.html` — One slip, one act
- `direction-c.html` — The docket
- `shots/direction-{a,b,c}-1440.png` and `shots/direction-{a,b,c}-390.png` — the same file
  rendered at both widths; `shots/direction-b-paper-1440.png` — the recommended direction on
  the paper escape

Each file: the book at 1440 with the boxes live (Lokanta Meyhane, İstanbul, TRY), a frame for
fo. 0 in its four states plus fo. 1 and fo. 4, a strip of every state (fo. 2, and fo. 3 for The
Old Mill, Michigan, USD), fo. 5 with the seal live (hold 620 ms; Enter arms, Enter again seals;
an early release says how far it got), and a 390 frame for Hasan at the phone. `?ground=paper`
on the URL renders the paper escape (`?notes=on` shows the build notes, off by default). Fonts
come from Google here; the product self-hosts. Example houses only; nothing under `apps/` was touched.
The typed-post verb is *Post* (not *Record*, which reads as audio beside *Say it aloud*), and
A's minimum-order placeholder is *amount in ₺*, not a number that could read as a proposal.
The seal's face cites `HoldToApprove.tsx:233-254` (the track style).

Drawn 2026-09-16 on branch `feat/mudavym-finish`; revised 2026-09-17 after review (all seven
renders re-shot; no console errors, no horizontal overflow at 1440 or 390); revised again
2026-09-17 against the design critic's pass, direction C carrying almost all of the second
round of fixes (all seven renders re-shot again; no console errors, no horizontal overflow at
1440 or 390).
