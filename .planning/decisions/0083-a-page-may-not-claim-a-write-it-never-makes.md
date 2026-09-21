# 0083 — A rebuilt page may not claim a write it never makes, nor call a failure a wait

- **Status:** Locked
  - **2026-09-04 — extended to a SEND, and pointed the other way.** [[0118-the-house-writes-its-own-mail]]
    applies this rule to the house email composer: the queue route answers **202
    and says "queued"**, never "sent", and the ledger chip reads
    "Queued · not yet sent". The same rule read in reverse is what put the undo
    window on the server: **a page may not offer to undo something that has
    already happened**, so a client-side undo (send now, hide it for two minutes)
    was refused and the window became a row with a `scheduled_send_at`. Also of
    note here: the two legacy template builders this ADR wired to
    `POST /restaurants/:rid/templates` are **retired from the rebuilt page** by
    0118 D7 — they are untouched, and the legacy page still mounts them.
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder)
- **Keywords:** communications, templates, persistence, save, no-op, tenant key, query key, cache, failure, latency, em dash, SMS, honesty, page rebuild
- **Links:** [[0051-rebuilt-pages-show-live-data-only]], [[0020-no-fabricated-answers]], [[0045-mudavym-page-rebuild-wave]], `.planning/06-pages/communications.md`, PR — `fix/communications-page`

## Context

The `/communications` rebuild (`apps/web/src/pages/communications/next/`) was
audited against [ADR 0051](0051-rebuilt-pages-show-live-data-only.md) and five
defects were verified. Four are that ADR's clauses violated in a new place. The
first is a class 0051 did not name, because the dashboard that forced 0051 had
no writes at all.

**1. The page asserted a persistence it did not have.** `TemplateSheet.tsx:85`
read *"Saving stores it for later; sending always happens from a conversation."*
Both builders were mounted with `onSave={onClose}` (`:106,108`) — the template
object was handed to a function that ignores its argument. Neither builder
writes: `GmailTemplateBuilder.handleSaveTemplate` (`:482-537`) made no network
call and touched no storage, and `SMSTemplateBuilder` said so in a comment
(`// Simulate save delay`, `:378`). Both then set `saveSuccess` and closed on a
1500 ms timer. Pressing Save showed a green tick and discarded the work.

The legacy page has the same no-op **and does not claim otherwise**, so this was
a regression the rebuild introduced — an untruth in prose laid over an existing
gap. It is also the first defect of its kind found in this wave: 0051's five
clauses all govern what a page *displays*, and every one of them was satisfied
here. A sentence about what a *button* does was outside the rule.

**2 and 3. Two caches were not keyed by tenant, and that matters more here.**
`useProcurementConversationHistory` used the constant key
`['procurement','history']` (`useConversationQueries.ts:284`); the schedules
query used `['report-schedules']` (`useCommsNextData.ts:43`).
`useConversationThreads`, in the same file, gets this right (`:193`) with a
comment explaining why — so the rule was known and applied unevenly.

The aggravating fact: **the gateway never reads the `X-Restaurant-Id` header**
the client stamps (`services/api/client.ts`). A repo-wide grep finds that header
only in test fixtures. `procurement.controller.ts:737` scopes the history from
`user.restaurantId` on the JWT alone. So scoping depends entirely on a re-minted
token — and `AuthContext.tsx:433` catches a **failed** switch and proceeds,
logging that it will continue "with X-Restaurant-Id header only", a fallback the
gateway does not implement. A failed switch plus a constant key renders the
previous tenant's conversation book under the new tenant's name, with no banner.

**4. A permanent failure was rendered as latency.** `schedulesKnown =
schedulesQ.data !== undefined` (`useCommsNextData.ts:94`) cannot tell a failure
from a request in flight, so the rail printed *"The schedule list hasn't
answered yet — —"* (`CommunicationsNext.tsx:366-368`) **forever**:
`public.scheduled_reports` is created by no migration in `supabase/migrations/`,
and a later migration names it as one of five tables that lived outside that
directory and production never saw
(`20260826170000_integration_oauth_tables.sql:26`). The endpoint 500s every
time. The **legacy page got this right and the rebuild deleted it**:
`Communications.tsx:269,293-299` holds a separate `schedulesError` and says
*"Saved schedules could not be loaded, so this list is not a record of what
exists"*, under a 12-line comment citing the same production verification.

**5. The error banner covered one query of five.** `isError: historyQ.isError`
(`useCommsNextData.ts:96`). `threadsQ`, `activeQ`, `schedulesQ` and `gmailQ` had
no failure surface, so each failure rendered as the em dash 0051 reserves for
"has not answered". "Try again" was reachable only when the history failed, so
it could never retry the other four.

**6. The SMS line described a channel nothing can reach.**
`CommunicationsNext.tsx:333-335` said SMS templates *"stage for the messaging
channel"*. All 27 production `procurement_conversations` rows are
`channel='email'`; `POST /communications/sms` exists in the gateway but a
repo-wide grep over `apps/web` finds **zero** callers.

## Options considered

**For the template claim (defect 1):**

1. **Delete the sentence, leave the no-op.** Cheapest and immediately honest —
   it is what legacy does. Leaves a Save button that silently destroys work,
   which is a worse experience than the sentence was, and leaves the feature
   dead in a page the wave is supposed to be finishing.
2. **Wire Save to the existing server store.** `POST /restaurants/:rid/templates`
   already exists, is JWT-guarded, and `useTemplates.createTemplate`
   (`hooks/useTemplates.ts:22-31`) already calls it. Makes the sentence true.
   Costs a shape decision, because the server's shape is much narrower than the
   builders' (below), and costs touching two shared builder components.
3. **Build a template store that matches the builders.** A migration adding
   panels/thumbnail/category columns, or a JSON document table. Correct in the
   long run; a schema decision the founder has not made, and far outside a
   five-defect page fix.

**For the SMS workshop (defect 6):**

1. **Remove it until a sender exists.** Honest by subtraction; deletes a
   workshop that, once Save works, does something real.
2. **Keep it, and say plainly what it is.** Requires the copy to name the
   absence rather than imply the channel.

**For the failure surface (defect 5):** per-figure failure sentences, versus one
banner that names every failed source with a per-figure mark. Four sentences
inside a strip built to be scanned would bury the distinction they exist to
draw.

## Decision

**A rebuilt page may not claim a write it never makes.** The claim and the
behaviour are fixed together, and where they cannot both be had, the claim goes.
Concretely, extending [ADR 0051](0051-rebuilt-pages-show-live-data-only.md) with
a sixth clause:

> **A statement about what an action does is a claim, and is bound by the same
> rule as a displayed figure.** A page may not say a control persists, sends,
> schedules or deletes unless it does. A confirmation may not precede the
> outcome it confirms: a success state renders only after the write has been
> accepted, and a rejection is said in words and does not close over the work.

Applied to the six defects:

- **P1 — wired, option 2.** `TemplateSheet` now posts through
  `useTemplates().createTemplate`. Both builders `await onSave(...)` inside a
  try/catch and set `saveSuccess` only after it resolves; a rejection leaves the
  builder open with the work intact and the sheet's own banner says why. The
  fake `// Simulate save delay` is gone — the wait is the real request.

  **What is stored, exactly**, because the server's shape is narrow and the
  global pipe is `whitelist: true, forbidNonWhitelisted: true` (`main.ts:52-56`)
  so posting the builder's own object would 400 on every field the DTO does not
  model. `communication_templates` holds `name`, `subject`, `body`, `type` and
  nothing else. So: SMS stores the message text verbatim and lossless; email
  stores the panel structure as JSON in `body`, which keeps the author's work
  rather than discarding it. There is **no re-open round trip** — the builder is
  never handed a stored template back — and the banner does not pretend
  otherwise. The only gateway reader of this table filters
  `type='sender_identity'` (`procurement.service.ts:2697-2703`), so these rows
  cannot reach the outbound send path.

  The sentence *"You are editing a saved template"* also went: the sheet never
  passes `editingTemplate`, so the builder always opens on a new, unsaved one.

- **P2 — both keys carry the tenant**, matching the sibling hook that already
  did. `procurementHistoryKeys.all` survives as an invalidation prefix only.
- **P3 — `schedulesError` restored** as a state distinct from "not yet
  answered", with the legacy page's sentence and its reasoning.
- **P4 — one banner, five sources.** The banner names every failed source in
  words; each figure carries `data-state` and an accessible name distinguishing
  *failed* from *has not answered*; and "Try again" now refetches all five,
  including the Gmail status it previously could not reach.
- **P5 — kept, relabelled (option 2).** Once Save works, the SMS workshop
  genuinely stores a template, so removing it would delete a working feature
  along with a false claim. The copy now states that no SMS sender is reachable
  from this page and that every recorded conversation is email.

**The rule is held by a command, not a reviewer.**
`scripts/check_windowed_figures.py` gains `/communications` as its third page
and a new **W7**: a page declares the shared query hooks its cache actually
lives in, by function name, and the guard checks their keys too. W6 reads only
the page's own files, and this page's largest bucket
(`useProcurementConversationHistory`) lives in a shared hooks file W6 can never
see — a green W6 here would have been a tick over the defect.

Extending the guard exposed **two vacuities in its existing rules**, both
measured by deleting the `≥` from the live strip and watching it print *clean*:
the floor-marker test was a substring match, so `MERGE` (in this page's own
header) and `GET` satisfied a marker of `GE`; and once matched as an identifier,
a leftover `import { GE }` satisfied it after every use was gone. Markers are
now matched as identifiers with imports stripped, which hardens `/receipts` too.
The key matcher also learned key factories and shared key constants
(`queryKey: someKeys.forRestaurant(rid)`), which it previously could not see at
all — the same vacuity class as the `useQuery<T>({` bug a prior extension found.

## Consequences

- **Easier:** the honesty rule now covers verbs, not only nouns. "Does this
  button do what the page says it does" becomes the same yes/no test as "is this
  figure measured", and W7 means a page's cache correctness no longer depends on
  where its hooks happen to live.
- **Harder / given up:** an email template's panel layout is stored as JSON and
  is **not re-openable in the builder**. Saving an email template and coming
  back to edit it is not a flow that exists; the row is a record, not a document
  the workshop can reload. That is stated in the sheet and recorded here rather
  than papered over, and it is the honest limit of the store that exists today.
- **Given up:** this page now issues one write. It previously issued none, and
  that property was worth naming — but the write is user-initiated, confined to
  the explicit Save action, and reports its own outcome. Nothing about rendering
  the page writes anything.
- **Not fixed here, and owned elsewhere:** the history endpoint admits six
  statuses of which only `SENT` and `APPROVED` occur, so **15 of 27 production
  conversations are invisible**, including every inbound reply. That is a
  gateway change and belongs to the sibling working `apps/api-gateway/**`; no
  test written here pins the current exclusion.
- **Revisit when:** a founder decision defines what a stored email template is —
  then the choice is whether to give it a real document store with a re-open
  round trip, not whether the current one is honest about its limits.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Aldemir | Locked with the page fix; 0051 extended with a sixth clause covering claims about actions |
| 2026-09-21 | Aldemir (founder), lane E-limits | Three instances of this ADR's own defect, found while auditing the vendor create path, the calendar meeting-notes path and the auction lot path, closed in one pass. See the addendum below |
| 2026-09-21 | lane E-limits last-call review | Four gaps the first pass left, closed before merge: the edit dialog could not show or choose "Not stated"; the rebuilt calendar listed meetings already noted as "without a note" after a reload; an auction lot could be carried with a record the table would refuse; and a record said a refusal was a silent strip. See "Last-call review" at the end of the addendum |
| 2026-09-21 | Aldemir (founder), answers 10, 11 and 12 (relayed in the round-2 lane brief) | A foreign-currency lot records the stated rate AND a per-bottle cost typed in the house's currency; a typed house cost wins, both recorded, nothing inferred. The lot number is optional; the auction house and the sale date stay required. The rebuilt /providers sheet gets an edit path, type first, and cards say "Not stated" |
| 2026-09-21 | Claude (Opus 5), lane E round 2 | Built all three (second addendum below) |

## Addendum — 2026-09-21: three more pages that collected an answer and dropped it

Lane E-limits (`.planning/06-pages/providers.md`, `.planning/06-pages/inventory.md` §9,
[[0111-the-calendar-is-the-houses-day-book]]) went looking for this ADR's fault by name —
"a page may not claim a write it never makes" — and found three live instances, all
pre-existing, none new. The founder answered all three on 2026-09-21, quoted verbatim:

> **(1)** "a vendor added without a business type gets a new 'Not stated' choice instead
> of silently becoming 'Distributor' - nothing assumed, settable later"
>
> **(2)** "Build all now": meeting notes get their own table (not the calendar event
> description), and an auction lot records its hammer price and premium WITH a currency,
> plus auction house, lot number and sale date.

**1. The vendor create path asked for a business type and threw it away, twice over.**
`services/api/providers.ts#mapProviderToApiPayload` never included `primaryBusinessType`
in the request body at all — the field the create sheet's picker held was local
component state, chosen and discarded on submit. Underneath that, `providers` carried no
column for it: `ProviderRow.vendor_type` had been declared in `providers.service.ts` for
years against a column no migration ever created (`match_restaurant_providers.sql:87-89`
already said so), and `UpdateProviderDto` never declared `primaryBusinessType`, so the
app's global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
(`main.ts:52-56`) refused any update carrying it with a 400 before the controller ran. Both create sheets (`NewVendorSheet.tsx`,
`AddProviderModal.tsx`) additionally defaulted their local state to `'Distributor'`, so a
vendor added by clicking straight through read back, on screen, as a distributor nobody
said it was — the exact fault this ADR names, one layer up from the database.
Closed: migration `20260921113700_a_vendors_business_type_is_stated_or_not_stated.sql`
adds `providers.primary_business_type` (nullable, no default — same rule as
[[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]]'s `payment_terms`
fix on the same table). `CreateProviderDto`/`UpdateProviderDto` now carry
`primaryBusinessType`; `ProvidersService` reads and writes it on create (both the
catalogue and the custom-vendor paths — a catalogue vendor's own stated type is carried
over, never discarded) and on update, through a `normalizeBusinessType` helper that also
folds an empty string to `NULL` rather than storing a meaningless blank next to a real
`NULL`. Both create forms default to `''` and offer an explicit **"Not stated"** tile/option
— `AddProviderModal.tsx` gained one (`HelpCircle` icon, matching its existing
tile picker); `NewVendorSheet.tsx`'s select already had the identical pattern for
`paymentTerms` to copy. `TypeBadge` on `/providers` already rendered a missing type
honestly (`label: type ?? '—'`); its em dash is now the word **"Not stated"** to match.
"Settable later" is the edit dialog (`EditProviderModal.tsx`, legacy `/providers`; the
rebuilt page has no vendor edit path at all yet): it offers "Not stated" in both its
pickers, and `Providers.tsx` sends the type only when the person changed it — `''` when
they changed it TO "Not stated", which the gateway folds to `NULL`, so that choice clears
a type set earlier instead of being a choice the dialog shows and never writes.

**2. The calendar meeting-notes path asked twice, and the second answer was the wrong
kind of write.** `MeetingMemoPrompt.tsx` (legacy `/calendar`) is `handleMemoSave` in
`CalendarPage.tsx:325` — literally `// Future: persist to documents API` — collecting a
note and dropping it, unchanged since the prompt shipped. The rebuilt page's
`MeetingNotePanel.tsx` (`/calendar` next) is NOT the same gap: it had a real write, and
the write was the fault its own header now corrects — `PATCH /calendar/events/:eventId`,
appending the note into `calendar_events.description` under a dated heading. [[0111-the-calendar-is-the-houses-day-book]]
§1 had already named this exact design and its own replacement ("the note gets its own
table … rather than waiting on documents") before today; the founder's answer today
locks that design in against the shipped code that had gone the other way. Closed:
migration `20260921113800_a_meeting_note_gets_its_own_table.sql` creates
`calendar_day_notes` (`restaurant_id, business_date, doc_type, event_title, body,
author, author_name, created_at`) — `event_title` a plain display snapshot, never a
foreign key, so editing or deleting the event a note was written against cannot destroy
the note. `CalendarDayNotesService` + `POST`/`GET /calendar/day-notes` back both pages;
`handleMemoSave` and `MeetingNotePanel.save()` both now call it, and neither PATCHes an
event's `description` for a note any more. The rebuilt page's "Meetings without a note"
list used to learn which meetings were noted from `event.description`; with nothing
written there any more it would have listed every noted meeting again after a reload,
saying "without a note" of a meeting that has one. `GET /calendar/day-notes` therefore
also takes an inclusive `from`/`to` range (`CalendarDayNotesService.listForRange`,
house-scoped from the token, at most 400 days, a failed read an error), and
`CalendarNext.tsx` keeps a meeting off that list when a note carries its day and its
title (`withoutNotedMeetings` — the `event_title` snapshot is the only link a note has
to its meeting, so a meeting renamed after it was noted is asked about again: the safe
direction). While that read has not answered nothing is listed; if it fails, the
meetings are listed under a line saying their notes could not be read — never as if
there were none. A description written before 2026-09-21 still counts.

**3. The auction lot path said, in three places, that it could not keep what it
collected.** `AuctionLotStart.tsx`'s own header, `inventory.md` §9 and the sheet's
"not kept" paragraph all said the auction house, lot number and sale date had no column,
were used only to compute `(hammer + premium) / bottles`, and were printed back "to be
copied somewhere that keeps them" — this ADR's own second sentence, "nor call a failure
a wait," applies in spirit: the honesty was real, but the gap it was honest about was
still a gap. Closed: migration `20260921113900_an_auction_lot_keeps_its_own_details.sql`
creates `auction_lot_records`, linked to `restaurant_inventory` (never to a specific
`inventory_lots` row — `apply_stock_movement` creates that row internally and hands the
caller no id for it). Currency is `NOT NULL`, shape-checked in Postgres and
membership-checked by `isIso4217`/`currencyCode` in the gateway — the same split every
other currency column in this schema uses — and **never inferred**: the sheet's own
`canCarry` now refuses to carry the lot at all without a chosen currency, exactly as it
already refused an unstated premium — and, because the record holds them `NOT NULL`
too, without the auction house, the lot number and the sale date
(`lotDetailsMissing`, which names what is missing on the sheet). Carrying first and then
failing the record would put the stock in the book with its receipt missing, the one
outcome the sheet cannot undo; the gateway refuses a blank house or lot number with a
400 as well. `inventory_lots.unit_cost` itself still carries no
currency of its own for ANY acquisition method — this is the auction's own receipt, kept
beside the stock it produced, not a redesign of cost storage generally (see the
migration's own header for why that would have been a far larger, un-additive change).
**Stated limit, not decided here:** the per-bottle figure the sheet carries into
`unit_cost` is `(hammer + premium) / bottles` in the LOT's currency, while `unit_cost` is
read everywhere as the house's own (`restaurants.currency`). A lot bought in a currency
other than the house's therefore books a unit cost in the wrong unit. Converting would
need an exchange rate — an inference the founder's "never inferred" rules out without a
stated rate — and refusing such lots would stop the carry; this was true before the
currency was recorded (it simply could not be seen), and it is put to the founder rather
than chosen here.
Shown on `/inventory`'s row-expand detail (`RowExpansion.tsx`, "Auction lots" card,
rendered only for a wine that actually has one).

**Verified** (re-measured at the last-call review, 2026-09-21, on the staged tree —
the numbers the first pass wrote here predated its own two spec files and are replaced,
not bracketed, because this addendum had never been committed): gateway `tsc --noEmit`
(main + spec configs) clean; web `tsc --noEmit` clean; `eslint --quiet` clean on every
touched gateway and web file; `scripts/check_gateway_boots.sh` PASS (the DI graph
resolves — this is what caught two test files instantiating `CalendarController` by
hand without the new `CalendarDayNotesService` provider, `ical-subscription.spec.ts`
and `calendar.controller.spec.ts`, fixed in the same commit); gateway `jest`, full,
in the worktree: **429/431 suites (2 skipped, pre-existing), 6562/6576 tests (14
skipped, pre-existing), 0 failed**; web `vitest run`, full, in the worktree: **210/210
files, 3035/3049 tests (14 skipped, pre-existing), 0 failed**. (Run against an archive
of the index instead, `openapi-export.spec.ts` and `locationDialogs.test.tsx` fail
because they `git show` a commit the archive cannot reach; both pass in the worktree.)
`scripts/check_decision_claims.sh` 390/390. The three migrations were applied for real,
in order, on top of the full 191-file corpus in PGlite (PG 18 WASM, Supabase platform
stubbed — `p4-scratch/pglite-probe/E-limits-migrations.mjs`, 39/39): the column is
nullable with no default and a vendor added without a type reads back NULL; both tables
refuse every blank or missing required field, a lower-case or four-letter currency, a
missing currency even when the column is omitted, an author or recorder who is not a
`public.users` row, and an inventory row that does not exist; a premium of a real 0 is
accepted; RLS is on and `anon`/`authenticated` can neither read nor write; re-running
each file is a no-op that keeps every row. Three `CLAIMS.jsonl` rows
(`ADR-0083-VENDOR-TYPE-NOT-STATED`, `ADR-0111-MEETING-NOTE-OWN-TABLE`,
`ADR-0083-AUCTION-LOT-CURRENCY-KEPT`), each mutation-tested against a real revert of its
load-bearing line before being recorded resolved, and again after the last-call
extension. Not run: an apply against a real Supabase Postgres — migrations auto-apply on
merge per the standing rule.

**Last-call review (2026-09-21).** Read end to end before merge, it found four gaps the
first pass left, all closed in this commit and folded into items 1-3 above: (a) the edit
dialog could neither show nor choose "Not stated", and `Providers.tsx` turned that choice
into "send nothing", so it could never clear a type; (b) the rebuilt calendar would have
listed every noted meeting as "without a note" after a reload — the first pass stated
this as a shortcut, but it was a regression against the description write it replaced
and a page saying something false, so the ranged read was built instead; (c) an auction
lot could be carried with its house, lot number or sale date blank, which the record
refuses only AFTER the stock is in the book; (d) the auction spec's query double ignored
its filter arguments, so deleting both `restaurant_id` filters left it green (measured:
9/9) — it now records them, and each deletion turns one test red. Records corrected in
the same pass: the ValidationPipe "stripped" the field (it refused it with a 400); the
`calendar.md` dossier still described the description write; `inventory.md` implied the
two dead auction routes were gone. Every new gate was mutation-tested — 4 gateway vendor
mutations, 5 web (vendor sheet, edit dialog, the notes list twice, the matcher), 4
auction (both tenant filters, the blank-detail refusal, the sheet's detail gate), 2
ranged-read (its tenant filter, a reversed range) and the 3 extended `CLAIMS` rows —
each red, each restored byte-identical.

## Second addendum — 2026-09-21: the founder's answers on the three limits the first addendum left

**Source.** The founder's answers (10), (11) and (12) of 2026-09-21, relayed in the
lane brief (round 2); the wording is the relay's, not a verbatim quotation.

1. **A lot in a foreign currency states its cost in the house's money** (answer 10):
   *record the exchange rate the person states AND let them type the per-bottle cost in
   the house currency (people round); a typed house cost wins, both are recorded,
   nothing inferred.* This closes the stated limit of the first addendum (the lot's
   per-bottle cost landed in `inventory_lots.unit_cost`, which every reader takes as the
   house's own money). Built: one rule on both sides (`AuctionLotStart`'s
   `auctionLotCost.ts` and the gateway's `inventory/auction-lot-cost.ts`) — a typed house
   cost is booked; otherwise a lot already in the house's currency books its own
   per-bottle cost; otherwise a foreign lot books its per-bottle cost times the rate the
   person stated; otherwise nothing is booked and the sheet says what to state. The
   sheet asks for the rate and the typed cost only when the lot's currency is not the
   house's, carries the stock at the booked cost, and the record keeps
   `house_currency`, `exchange_rate`, `house_unit_cost` and `booked_unit_cost`
   (`20260921114960`, with a CHECK that a foreign lot states one of the two). The
   gateway reads the house's currency itself and refuses a record whose booked cost is
   not the rule's. **A consequence, stated:** a house that has not stated its currency
   (or whose currency could not be read) cannot book an auction lot until it does — the
   sheet cannot tell a foreign lot from a home one without it, and nothing is inferred.
   The item's card shows what was booked and how.
2. **The lot number is optional; the auction house and the sale date stay required**
   (answer 11). `20260921114960` drops its NOT NULL (the non-blank CHECK stays, so a blank
   is refused and NULL is "not stated") and asserts the other two are still required; the
   gateway records a blank as NULL; the sheet no longer holds the carry for it, and the
   item's card says "lot number not stated".
3. **The rebuilt `/providers` vendor sheet has an edit path, the type first, and cards
   say "Not stated" when unset** (answer 12). `VendorRecordEdit` sits at the top of the
   sheet: the business type (the three offered, "Not stated", and a type outside the
   three listed as itself), then the name; only what changed is sent, "Not stated" is
   sent as `''` so the gateway clears the column. The cards and the sheet's eyebrow say
   "Not stated" instead of blank. Contacts, terms and the usual currency keep their own
   sections in the same sheet.

**Evidence.** Gateway `auction-lot-cost.spec.ts` and `auction-lot-records.service.spec.ts`
(rate, typed cost, refusals, the house read, the optional lot number); web
`auctionLotCost.test.ts`, `AuctionLot.test.tsx`, `VendorRecordEdit.test.tsx`,
`ProvidersNext.test.tsx`; the PGlite probe for the migration (a foreign lot with
neither refused, a zero rate refused, a blank lot number still refused, a missing one
accepted). CLAIMS rows `ADR-0083-AUCTION-HOUSE-COST`, `ADR-0083-LOT-NUMBER-OPTIONAL`,
`ADR-0083-VENDOR-SHEET-EDIT`; `ADR-0083-AUCTION-LOT-CURRENCY-KEPT` re-pinned with a
dated bracket. Also fixed while there: the auction sheet is now mounted only while open,
because a closed sheet mounted on `/inventory` broke that page's tests once main's #421
restored every mock between cases.
