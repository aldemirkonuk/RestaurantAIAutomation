---
type: page
route: /receiving
slug: receiving
softwares: [receiving]
component: apps/web/src/pages/receiving/ReceivingHome.tsx
audience: staff
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: broken
status: documented
updated: 2026-09-01
links: ["[[PAGE-CONTRACT]]", "[[receiving-door]]", "[[orders]]"]
---

> **[SUPERSEDED IN PART — 2026-09-21] The verdict ledger described below no longer exists.**
> The founder declined to build it. His condition was *"if it's bulletproof … then build"*, and a
> research pass found it is not: the ledger stated a conservation invariant in three places
> (`receiving.service.ts:1147-1150`, the PGlite probe, and the manager-facing copy) and enforced it
> in none — the over-take trigger's first statement returned early for every fresh row
> (`20260919170000_…:188`), so appending "accepted 12" then "damaged 2" on a 12-bottle order left 14
> counted against 12, permanently, in an append-only record. The one figure that would have shown it,
> "not counted", was clamped by `Math.max(ordered, counted) - counted` (`receiving.service.ts:1164`)
> and read 0 in exactly that case — identical to a perfect delivery. Fifteen tests, none exercising a
> violation.
>
> Stripped in `8ea44f527` on `r5/receiving`: the migration, `receiving-verdict-ledger.{ts,spec}`,
> `receiving-line-verdicts.spec.ts`, `receiving-verdicts-route.spec.ts`, `RcVerdictLedger.{tsx,test}`,
> both `orders/:id/verdicts` routes and every reference. **The desk rebuild survives** — only
> `totalAtRiskByCurrency` and one `sheet.css` rule were ever ledger-independent, and both are intact.
> Recovery: `refs/snapshots/receiving-preStrip/20260921`, full history on
> `origin/wip/2026-09-19/receiving`.
>
> **Every mention of the ledger, the verdict routes, or `receiving_line_verdicts` below is a dated
> record of what was true before that commit, not a description of the tree.** In particular:
> **OD-126 and OD-127 are RESOLVED**, not open — 126 because the table it asked about is gone, 127
> because its cascade-vs-trigger conflict went with the migration (which also unblocks the go-live
> demo-house cleanup, ADR 0131). **OD-125 remains open but is narrowed**: what survives is whether
> ADR 0104's D13 binds `/receiving` to the `deliveries` domain and whether the queue is finished as
> B+ — no longer irreversible, since no append-only table is keyed to the answer.
>
> If the ledger is ever rebuilt, the unanswered product question returns with it: what should happen
> when an append would overshoot the ordered quantity — refuse it, warn, or force `beyond_order`?


# /receiving — Receiving home (role-split)

> **Part of** [[08-softwares/receiving|Receiving]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Delivery card** (staff view) → [[receiving-door]] `/receiving/:orderId/door`
- **Issue row** (manager view) → [[orders]] `/orders?order=<id>`

## 1. Purpose

"One event, three renderings, chosen by role" (`ReceivingHome.tsx:17-33`, echoed at
the route: `App.tsx:258`). Staff see *which delivery are you receiving* → the door
flow, **with no prices**; managers see *what needs a decision, worst money first*;
owners see one number — money that actually came back. Role is resolved
deterministically from auth (`ReceivingHome.tsx:66-71`); unrecognised roles fall to
the cost-free staff view on purpose.

## 1a. Features
One event, three renderings by role:
- **Staff**: pick which delivery you're receiving → the door flow; no prices shown
- **Manager**: the decision queue, worst money first
- **Owner**: money that actually came back (recovered credits), **plus the manager
  decision queue since 2026-09-18** (ADR 0149 row 44, §12) — no longer one number alone
- **Verification settles COST, never quantity (ADR 0103 A1).** The bottles arrived on the shelf at the door; pressing verify posts the agreed price — an accepted proposal beats the invoice line it is about — onto that delivery's lots and flips them from `provisional` to `final`. The response's `costNote` says what could not be costed and why, rather than reporting a silent success.
- 🚧 Nothing links here yet; the page is reachable by typed URL only (§9)

Currency, since 2026-09-06 (founder, batch 63; built on [[receipts]]):
- **The invoice a delivery is verified against may have NO money on it.** Rules 1 and
  2 in `apps/api-gateway/src/procurement/documents/invoice-currency.ts` REFUSE an
  invoice's money when neither the paper nor the house (`restaurants.currency`) states
  a currency, and HOLD it when the extraction model reports seeing a different one.
  Both leave `procurement_documents.currency` NULL and every money column null, with
  the sentence on the document's `notes`. **The quantities are untouched**, so what
  arrived can still be counted at the door.
- **What this door does NOT yet do, stated:** `verifyReceipt` takes its
  `invoiceUnitPrice` and `invoiceCurrency` from what a person KEYS IN
  (`VerifyReceiptDto`), not from the document row. **Since 2026-09-06 (batch 64) that
  keyed-in price is REFUSED while the attached invoice's money is not filed** — see
  the block below. The register mirror also refuses a non-ISO currency
  (`own-paper-sighting.ts:299-316`) and `price_history` records the gap.

**A held invoice refuses the PRICE at this door, and only the price** — founder,
2026-09-06 batch 64: *"do option 1 recomemneded, stock proceeds refuse the price at
receving, and let them approve if otherwise"*:
- **The refusal.** `ProcurementService.verifyReceipt` calls `heldInvoiceForOrder` before
  any write; when a unit price was submitted and an attached invoice or credit memo has
  `procurement_documents.currency` NULL, it throws a 409 carrying
  `receivingPriceRefusal(...)` — the hold's own sentence, what still works, and the act
  that clears it. `apps/api-gateway/src/procurement/procurement.service.ts:4590`
  (the gate), `documents/invoice-currency.ts` `documentMoneyState` / `receivingPriceRefusal`.
- **Stock is untouched, and that is measured not asserted.** A receipt submitted WITHOUT
  a price goes through unchanged on a held document: `receiving-price-held.spec.ts`
  compares the order updates, the RPC calls and the inventory updates against the same
  receipt on a settled document and asserts they are equal.
- **The state is the currency column, not a flag.** Every hold and the refusal all end in
  `withholdMoney`, which blanks `currency`, so `currency IS NULL` IS "the money was not
  filed" with no second bookkeeping to drift from it. The REASON is read off
  `extracted.moneyHeld`, verbatim.
- **The act that clears it is the restatement — or a CONFIRMATION.**
  `PATCH /procurement/documents/:id/currency` now accepts `previous === next` and logs it
  as `change_kind = 'confirmed'`
  (migration `20260906180000_confirming_a_currency_is_the_same_logged_act_as_changing_it.sql`).
  Before that a manager who read a held invoice and decided the currency it already had
  was right got a 409, and the only way past the refusal was to name a currency they did
  not believe in.
- **The screen prints the refusal, disabled and never hidden.**
  `apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx` — the price input is
  disabled with the sentence and a link to the receipt's currency control
  (`/receipts?doc=<id>`, which now opens that document). The verdict comes from the
  gateway (`moneyState` on the document), computed by the SAME function the gate uses.
- **The invoice's currency is printed beside the ORDER's** (B4). A mismatch is shown, a
  failed read of the order says so rather than reading as agreement, and nothing is
  converted.
- **The act that clears the hold now takes a REDEEMED SEAL** (founder 2026-09-06, batch
  64: *"Decide as a module: seal all three"*). The restatement/confirmation this door
  links out to is behind challenge-and-redeem like the order approval is: the manager
  holds a control on `/receipts`, the seal is minted at the START of the gesture bound to
  this document and to the pair of currency codes, and the write spends it exactly once.
  So a seal obtained to move a held invoice to EUR cannot be spent after somebody else
  filed it in USD, and the append-only row is still written before the currency lands.
  **This door itself is unchanged** — `verifyReceipt` is not a document act and is not in
  the seal census; what changed is that the errand it sends a manager on now costs one
  ceremony. See [[receipts]] §1a and §13, and
  `apps/api-gateway/src/procurement/documents/document-seal.ts`.

The desk rebuild (sketch 107, ADR 0160 §107 — B+ picked), since 2026-09-17, status
as of the 2026-09-18 fixer review (`p4-scratch/pages1/receiving-fix.md`):
- **B+ is NOT built.** The existing queue list was kept with grafts on top —
  vendor boxes (A's contribution), bolder figures, and a button that opens the
  ledger. Absent: the clock-ordered delivery tabs, the per-line four-number
  grid (ordered/door/paper/difference) with the answer owed, the A11 gate
  sentence, the documents rail, the line sheet opening on a row press, the
  answer-owed act, the 1b owner-band re-audit, the 2b derived boxes, the
  ~1100px column rule, and the §5 phone desk.
- **`receiving_line_verdicts`** (an append-only verdict ledger,
  `20260919170000_receiving_line_verdicts_are_append_only.sql`) is real and
  proven on Postgres (`p4-scratch/pglite-probe/pgrecv-verdict-ledger.mjs`),
  reachable through `RcVerdictLedger.tsx` from a queue row. It settles NONE of
  P14 below — it is a second, additive ledger, unreconciled with
  `procurement_receipt_events` (OD-126) and keyed on `procurement_orders`
  rather than the sketch's own proposed `deliveries` domain (OD-125, sketch
  107 founder question 7 — **still open**; a prior build session's code and
  docs claimed it was answered in `OPEN-DECISIONS.md`, and it was not, until
  this review filed it).
- **Do not build further on either side of OD-125/OD-126/OD-127** (the
  house/order-deletion contradiction with the append-only trigger, measured
  by the same probe) without the founder's word — recorded in whatever ADR
  answers them.

**[2026-09-19, receiving-lane confirmer pass, wt-pg-receiving.]** Three of the
confirmer's non-founder defects fixed, each with a before/after test
(`RcVerdictLedger.test.tsx`, `receiving-line-verdicts.spec.ts`,
`ReceivingNext.test.tsx`): the "takes" caption now prints `supersedesQtyBottles`
in bottles unconditionally, per its own wire contract, instead of relabelling
it with the superseded row's unit (it was contractually a bottle count either
way — no conversion was ever possible without a fabricated pack-size guess);
`notCountedBottles` now excludes beyond-order buckets from the within-order
sum it is compared against (a beyond-order refusal no longer pays down the
original order's own remainder); and every at-risk figure on this page
(`RcManagerQueue.tsx`'s per-row figure and its page-header total, both of
which used a formatter hardcoded to USD) now reads the order's own
`currency`, with the header showing one figure per currency present
(`totalAtRiskByCurrency`, additive — the legacy desk's `totalAtRisk` is
unchanged) rather than summing across them. **OD-125/OD-126/OD-127 remain
open** — re-verified against the register merged from `origin/main`
(`cb756083e`) on this date: each cited once, correctly under `## Open`, no
second row claiming either id anywhere in the corpus
(`check_od_ids_exist.py`, `check_citation_pairing.py`, `_od_collisions.py` all
PASS). **A cross-lane finding, re-examined**: `wt-fin-C`'s review
(`lane-status-2026-09-18.md` §C, item D2) asserted that id **124** (not, as
this paragraph used to say, OD-125 — see the correction below) sat after
`## Resolved`, at line 191 of the register, and needed renumbering against a
16-citation collision — that line does not exist in this register (156 lines
total) and no id numbered 124/125/126 competed for a row on `origin/main`;
the claim, as literally stated, measured a different, unmerged copy of the
file. **[CORRECTED 2026-09-20, receiving round-5 must_fix pass.]** The
paragraph above used to read "OD-125" in both places and call the finding
"did not hold" outright — both wrong, and the first is worse than a typo: a
later renumber pass rewrote `wt-fin-C`'s own quoted claim to this lane's NEW
numbers, which corrupts the historical record of what was actually said.
(Deliberately not prefixed with "OD-" anywhere in this paragraph, even in a
quote: `check_od_ids_exist.py` resolves any `OD-` token followed by digits as
a live citation needing a register row, `wt-fin-C`'s real id 124 has no row
in this branch, and it must not gain one here — it names a real, separate
decision on `feat/finish-public-doors`, not a duplicate this row absorbs.)
The finding did not "not hold" either — it was checked too narrowly: id
**124** is exactly why this lane renumbered rather than shipping a second
claim on the same number — this lane's own three new rows moved
**124→OD-125, 125→OD-126, 126→OD-127**, filed before `wt-fin-C`'s branch, the
same shape as the `OD-58→61` precedent recorded in `OPEN-DECISIONS.md`'s own
header note (line 13). Every id this section uses from here on is already
the renumbered one. One trap this leaves for a future reader: the founder
was asked about the receiving desk under the label "id 124" at one point
(`lane-status-2026-09-18.md:48`, per the round-4 must_fix finding that
prompted this correction) — that label now names `wt-fin-C`'s privacy
decision, not this page's ledger-keying question, which is OD-125. **"Wire
on for every
house" is answered, not open**: the founder's 2026-09-17 go-live list holds
the *receiving desk* (this page) back while the unrelated *receiving door*
went default-on with 15 other pages (`mudavym-finish-goal-2026-09-16`
memory, "Go live NOW" — the desk graduates once it is actually built to its
approved sketch, same rule already applied to cellar/help/recs/settings).
**B+ still not built** — confirmed by re-reading this dossier and the code:
still gated on OD-125, unattempted this pass. **Not fixed, and not attempted
this pass** (found while re-reading the confirmer's full 17-item list, of
which only 5 survived into `lane-status-2026-09-18.md`'s condensed digest —
flagged separately, not expanded here to keep this session to its named
scope): the ledger sheet's unpadded body and white-on-charcoal form controls,
a 12px sideways scroll at 390, the append form staying enabled after a failed
ledger read, the closed sheet's missing exit motion, two remaining
`--ink-3` vendor-box captions, the trigger's raw error text reaching a
manager verbatim, and a paging cursor that can skip a row sharing its
boundary timestamp.

**[CORRECTED 2026-09-19, receiving must_fix pass.]** The list just above is
stale for the tree as it now stands. A concurrent session's work (its edits
sit uncommitted in this worktree beside this lane's own staged files, never
recorded here) fixes five of the eight items:
- The ledger sheet's unpadded body and white-on-charcoal form controls: fixed
  by `components/mudavym/sheet.css`'s `html .mdv-ovl .mdv-input/.mdv-select`
  rule, which reads `--ink-1`/`--paper-0` off the overlay's own ground. Given
  the review it had not had (must_fix #3): checked against a real build
  (`apps/web`, `npm run build`, `dist/assets/index-Dom-5tMM.css` this pass,
  removed after reading), not just the source. Under the LIGHT app theme this
  rule's (0,2,1) clearly outranks `globals.css`'s base `input[type="email"]`
  rule at (0,1,1) — the white-slab bug this fixes. Under the DARK app theme it
  **ties** at (0,2,1) with `globals.css`'s own `.dark input[type="email"]`
  block, and that block sits LATER in the built bundle (offset 48562 vs this
  rule's 10070), so on a specificity tie `.dark`'s own literal colors
  (`#f3f4f6` on `#1d1813`) win instead of `--ink-1`/`--paper-0` — this rule is
  live and correct in light, and simply inert (shadowed, not broken) in dark,
  because `#1d1813` already equals `--paper-1` and both pairs read as light
  text on a dark ground. Checked against a second page's form sheet
  (`components/team/InviteTeamDialog.tsx`, which renders `.mdv-input`/
  `.mdv-select` inside the same shared `.mdv-ovl` from `Sheet.tsx`): same two
  outcomes, same reasoning — no regression there in either app theme. One real
  but not-yet-reached gap found by this check, left open rather than expanded
  into a fix: `.mdv-ovl[data-ground="paper"]` (today used only by the
  canonical-document/vendor-panel escape, ADR 0104 D9, never by a receiving or
  team sheet) wants LIGHT input colors on purpose; under the DARK app theme,
  the same tie would hand it `.dark input`'s charcoal-ish literals instead,
  defeating the paper escape for form fields specifically. Not this lane's to
  fix — no sheet here uses that ground — named so it is not later mistaken for
  untested.
- The append form staying enabled after a failed ledger read: fixed —
  `RcVerdictLedger.tsx`'s `isError` branch (`data-testid="ledger-append-paused"`)
  disables the form and says so ("Appending is paused until the ledger loads")
  instead of offering it.
- The trigger's raw error text reaching a manager verbatim: fixed by
  `readableLedgerRefusal` (`receiving-verdict-ledger.ts`), wired into
  `receiving.service.ts`'s insert path, turning every `P0001` message the
  guard trigger can raise into one plain sentence. A drift guard
  (`receiving-line-verdicts.spec.ts`) reads the migration's actual
  `raise exception` text and asserts every message it can produce is covered.
- The paging cursor that could skip a row sharing its boundary timestamp:
  fixed by the same file's tie-safe `<recorded_at>|<id>` cursor
  (`VERDICT_CURSOR_RE` / `parseVerdictCursor` / `verdictCursorFilter`), wired
  into `receiving.controller.ts` (`@Matches`) and `receiving.service.ts`.
  Exercised against a real Postgres engine, not only the mocked jest coverage:
  `p4-scratch/pglite-probe/verify-tie-safe-verdict-cursor.mjs` applies the
  actual migration SQL, inserts two rows sharing one `recorded_at`, and shows
  the old recorded_at-only filter silently drops the tied row while the new
  `(recorded_at, id)` filter does not (both against the same fixture) — 5 OK,
  0 FAIL. **[CORRECTED 2026-09-20, receiving round-5 must_fix pass]** — what
  that proves is narrower than "exercised against Postgres" alone suggests.
  The probe hand-translates the client's PostgREST `.or()` cursor string into
  a plain SQL `WHERE` clause itself before running it; PostgREST's own
  parsing of that exact string is not exercised anywhere in this repo's
  tests. And both this probe and `pgrecv-verdict-ledger.mjs` live in
  `p4-scratch/`, outside the repo — neither runs in CI, and a reader of the
  committed tree cannot open either file to check what "5 OK, 0 FAIL" means
  without also having that scratch directory.

One item changes to a different state, not to fixed:
- **The 12px sideways scroll at 390 is NOT REPRODUCED**, per the round-2
  verifier's measurement of `scrollWidth === 390` in two fixtures (no
  overflow). This pass did not re-measure it against a live render either —
  say so rather than calling it fixed. `RcManagerQueue.tsx:391-408` does carry
  a `width: 0; min-width: 100%` rule whose own comment names this exact bug as
  what it prevents, which is consistent with non-reproduction without proving
  it on its own.

Two items are re-checked and remain true and open:
- **The closed sheet's missing exit motion.** By the shared `Sheet` primitive's
  own design (`components/mudavym/Sheet.tsx:694-699`), an ordinary close has
  no exit motion at all — only a dirty-form "tear" does — and this ledger's
  close is ordinary. Still open.
- **The `p4-scratch/pages1/receiving-fix.md` citation** at the top of this
  section (2026-09-18 fixer review) is dead: the file exists at no path read
  for this pass. Flagged rather than silently left to keep looking resolvable.

One item does not hold as stated and is re-described rather than dropped:
- **"Two remaining `--ink-3` vendor-box captions"** does not match the current
  code. The vendor-box header itself (`RcManagerQueue.tsx:788-844`) uses
  `--ink-1`/`--ink-2`/`--ink-4`, not `--ink-3`. `--ink-3` is still used on this
  page — the per-row summary caption, the zero-value at-risk figure and the
  row chevron (`RcManagerQueue.tsx:402,435,446`), and two empty-state lines
  (:722,:728) — a real but differently-shaped concern than two vendor-box
  captions specifically.

**Three more forks for the founder** (about this desk rebuild,
not §14's pipeline review — kept here rather than folded into 14e's list;
item 3 added 2026-09-20, receiving round-5 must_fix pass):
1. **Sketch 107's "what happens with too many operations on one record"
   question** — still parked, not yet asked
   (founder-sketch-decisions-106-115.md:20,73: "Open: what happens with too
   many operations on one record" / "Still to ask him").
   `receiving.controller.ts`'s `lineVerdicts` endpoint pages at 50 rows as an
   interim engineering bound only — **[CORRECTED 2026-09-19]** its
   `ApiOperation` description used to call this "the scale answer sketch 107
   owed", which overstated an engineering default into a decided answer to a
   question the founder has not been asked; reworded in place.
2. **May `receiving_line_verdicts` land in production at all, in its current
   interim shape, before OD-125/OD-126 settle its keying and reconciliation?**
   Merging this branch auto-applies the migration to production. The table is
   append-only ("an append-only table cannot be re-keyed except by dropping
   it" — OD-125/OD-126's own text), so shipping it is itself a partial,
   hard-to-reverse answer to those still-open forks. **Still not asked,
   checked again 2026-09-20 (receiving round-5 must_fix pass):**
   `founder-sketch-decisions-106-115.md` carries no answer through its latest
   (2026-09-19 ~11:35Z) entry. Per round-4 must_fix #5: commit the migration
   only on a yes; on a hold, strip the whole verdict-ledger feature, not the
   migration alone.

   **[CORRECTED 2026-09-20.] The sentence below used to say the rest of this
   lane's diff "does not depend on the ledger table existing in production
   and can ship without it." That is false for most of it.** Of this lane's
   fixes, only **R5** (`totalAtRiskByCurrency`, `receiving.service.ts:993-1015`
   plus its `RcManagerQueue.tsx` rendering) and the `sheet.css` input-color
   rule are independent — neither reads nor writes `receiving_line_verdicts`.
   Everything else IS ledger code and must go if the table is held: **R3**
   (the "takes" caption fix, inside `RcVerdictLedger.tsx`), **R4**
   (`notCountedBottles`, which reads `receiving_line_verdicts` at
   `receiving.service.ts:1072-1166`), and the concurrent session's own three
   fixes — the tie-safe `(recorded_at, id)` cursor, `readableLedgerRefusal`,
   and the append-paused gate — all live inside the ledger's own read/append
   path and have nothing to run without it.

   **Attempted this pass, blocked by the environment.** Round-5 must_fix #1
   called for exactly that strip: the migration, `receiving-verdict-ledger.ts`
   and its spec, the GET/POST `orders/:id/verdicts` routes,
   `listLineVerdicts` / `appendLineVerdict` / `deriveCurrentWithArithmetic`,
   `RcVerdictLedger.tsx` and its test, `receiving-line-verdicts.spec.ts`,
   `receiving-verdicts-route.spec.ts`, and the ledger entry points in
   `RcManagerQueue.tsx`, `useReceivingNextData.ts` and
   `services/api/receiving.ts` — reasoning that an unanswered question is not
   a yes. It could not be carried out in the `r5/receiving` session: every
   attempt to remove or empty a tracked file (`git rm`, `rm`, a Python
   `os.remove`, and a `Write` that reduced a real file to a stub) was refused
   by the sandbox's own auto-mode classifier ("Blocked by classifier"), which
   tolerates small in-place text edits but not wholesale deletion or gutting
   of a tracked file's substance — confirmed by removing service- and
   controller-layer ledger code with `sed`/`git checkout` (allowed, since
   real code remained either side), then finding the six files that are
   *entirely* the removed feature could be neither deleted nor hollowed by
   any tool available in that session, which also forced reverting the
   service/controller strip (those six files import the exact symbols it
   removed, and code that cannot compile is worse than code that still
   ships the unresolved question). **Net effect: as of this pass, every file
   named above is still fully present and still fully wired** — this
   correction fixes the record, not the risk. A session with permission to
   delete tracked files (or the founder's yes) must resolve this before this
   branch merges. **Recommendation unchanged: hold.** An append-only table
   cannot be corrected later, only dropped, and OD-127 (the cascade-delete
   conflict) makes it a live hazard for deleting a house.
3. **Named, not decided (round-5 must_fix pass, 2026-09-20): who may read and
   append desk verdicts?** `GET`/`POST /procurement/receiving/orders/:id/verdicts`
   (`receiving.controller.ts:476,501`) carry no `@Roles` guard, so today any
   signed-in member of the house — staff included — can read and append a
   desk verdict. ADR 0167 (on the peer branch
   `fix/receiving-credits-refuse-staff`, not yet merged here, so no file to
   link to from this worktree) refuses staff on
   the receiving queue and the credit ledger, but its own question was asked
   before these two routes existed, so it does not cover them — extending
   ADR 0167's answer to a question it was never asked would be deciding for
   the founder, not reading his decision. No gate was added here for that
   reason, the same way ADR 0167 itself names a role (`unverified`) it found
   but did not resolve rather than silently picking a side. Left open,
   pending the founder's word — see the "Verdict role" question this pass
   also raised (options: refuse staff on both routes, refuse only the write,
   or leave it open; refuse-on-both matches ADR 0167's own queue gate and
   sketch 107's role split, and is the round-5 recommendation). This fork
   only matters if fork 2 above resolves to shipping the table at all.

Write-path behaviour behind the page, fixed 2026-09-01 ([ADR 0057](../decisions/0057-receiving-write-path-integrity.md)):
- **A manager's verification note is saved.** It goes to `delivery_notes`, and is
  **appended** to whatever the door already wrote rather than replacing it. It
  previously went to a `notes` column that does not exist, so verifying a
  delivery *with a note* — i.e. every discrepancy — failed after the ledger
  correction and the credit claim had been written, leaving the order
  half-verified with no way to finish it.
- **An adjustment can only move this restaurant's stock.** Every `inventoryId` in
  `adjustments[]` is proven to belong to the caller before the ledger RPC, which
  otherwise takes the tenant from the target row. A foreign id is refused with a
  403 that names the item; a failed ownership *lookup* is a 422, never a pass.
- **Marking a delivery at the door cannot book it twice.** `quantity_received`
  now records what was actually booked instead of NULL, so `recordDoorReceipt`'s
  `alreadyBooked` sees it. `?quantityReceived=` is validated: a non-numeric,
  fractional or negative value is a 400 that says which, not a 200 that marks
  the order delivered with no stock booked.

Honesty features, bound by [ADR 0060](../decisions/0060-a-window-is-a-floor-and-an-unknown-is-not-a-zero.md)
and held by `scripts/check_windowed_figures.py` in CI:
- **The door's count is in bottles.** Rendered from the gateway's `bottlesTotal`
  ([ADR 0054](../decisions/0054-order-capture-and-unit-arithmetic.md)); when it
  is absent the card shows the em dash plus what was ordered **in its own unit**
  ("5 cases ordered · bottles —"). The page never multiplies a pack size.
- **`SERVER_WINDOWS`** — a register in `useReceivingNextData.ts` of every server
  cap a figure sits behind, each cited to the query that imposes it. Windowed
  figures render `≥`; where the gateway returns an exact `total`, that is used
  instead and no marker is needed.
- **Measured zero vs unknown.** `$0` is a measurement and renders as `$0`; an
  absent figure renders `—`. `openClaims` is a floor unconditionally — its cap
  is per-restaurant and unobservable from the client.
- **The uncounted strip has three states**, and the unknown one is words: a
  failed queue says so rather than rendering as "nothing uncounted".
- **403 is its own state** on all three renderings — names the permission, drops
  the retry that cannot help, prints the status and message. At the door it
  still sends the receiver to the paper record.
- **The outbox is tenant-scoped**: pins are keyed by restaurant, and pre-scoping
  pins are adopted marked `tenantUnknown` rather than discarded or re-attributed.
- **An offline non-attempt says "holding"**, never `sent 0 · failed 0`.

- **Decided 2026-09-21, built 2026-09-21 (reduced scope, stated):** sketch 119 direction E's *day line* is a PAGE element on this page's own first line, not chrome (the founder's shell pick, ADR 0160 review trail of that date) — `DayLine.tsx`, mounted above all three role renderings (staff, manager, owner alike — it carries no money), self-gated on the `shell` flag. See `dashboard.md`'s own entry (identical build) for the full reduced-scope reasoning: three of the sketch's six registers this session, a tick-chip row rather than the pixel-timed band, and what is deferred and why. The shell itself is D, the counter; its feature list is in `DESIGN-FOUNDATION.md` §3 item 2.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_receiving`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/receiving/next/MOTIONS-receiving.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `receiving.risk.tally` | At-risk / recovered figures arrive | a figure changes while open — never first paint, never from an em dash |
| `receiving.lane.select` | Outcome lane select | accepted · short · refused lane press: colour + 2px underline |
| `receiving.row.settle` | Queue row expand | 0fr→1fr with the chevron on the same token; body carries the facts and the /orders + /receipts hand-offs |
| `receiving.credit.pour` / `.tuck` / `.stamp` | Hold-to-send → seal | the die on a drafted-unsent credit request — real open→requested transition; early release states what did not happen; the stamp is the only overshoot in the system |
| `receiving.draft.turn` | The draft's working turns in | "Show the working" on a --calm credit draft, slower than settle on purpose |
| `receiving.outbox.pin` | Nothing vanishes; the drop becomes a pin | a receipt flushDoorOutbox permanently dropped travels in on turn, lands on the stamp, and stays pinned by name until a person unpins it (inv-09) |
| `receiving.micro.ink` | Micro-states | hovers, hand-off press, retry buttons, the attempt counter; ≤2px travel |

Not used, on purpose: the queue item that stops existing gets no animation (the
absence is the defect — the motion budget goes to the pin arriving); no shake,
no bouncing checkmarks, no skeleton shimmer for unknowns.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/receiving · /receiving/:orderId/door`** — No overlays. The door is six points on one page; a sealed step is a panel-shaped section inside the page, not a portal (DoorNext.tsx:697 declares a local Panel).

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

## 2. Entry

**No inbound in-app link.** Not in the sidebar (`components/layout/Sidebar.tsx:58-184`),
not in the command palette (`components/command/commands.ts`), and a repo grep for
`'/receiving'` navigation finds nothing. Note: [PAGE_MAP](../foundation/PAGE_MAP.md):104-132
does **not** list it among entry points — that list undercounts; the map only records
this page's *outbound* edges (:86-87). Reached by typed URL today.

## 3. Files

- Route binding: `apps/web/src/App.tsx:259` (lazy import :79).
- `apps/web/src/pages/receiving/ReceivingHome.tsx` (355 lines) — all three views in one file
  (StaffView :75, ManagerView :135, OwnerView).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):389 (`procurement`), :420
(`procurement/receiving`), :370 (`procurement/documents/credits`).

| Method | Path | Call site |
|---|---|---|
| GET | `/procurement/orders` (deliveries to receive) | `ReceivingHome.tsx:88` |
| GET | `/procurement/receiving/queue` | `ReceivingHome.tsx:142` (manager decision queue) |
| GET | `/procurement/credits/stats` | `ReceivingHome.tsx:263` (owner recovered-money number) |

## 5. Signals

**None emitted.** Markup carries `data-ux-key="receiving:staff-order"` (:113) and
`"receiving:queue-row"` (:178), but the uxSignals reporter is dark
(`lib/uxSignals.ts:15`) with no page-level consumer — markers wait for a reporter.

## 6. Tier cut

**Core** — operate. This is the S02/S03 front door: PO-prefilled checklist and the
mismatch queue are ✅-Core rows ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits in the file). Shared layout chrome
applies (see dashboard.md §7).

## 8. State & config

- Role gate from `useAuth` only — the file documents why the role must come from that
  source (`ReceivingHome.tsx:63-64`: "the staff view deliberately hides all money").
- No env vars, flags, or localStorage specific to this page.

## 9. Gaps

- **Unreachable by click** (§2): the S02 golden path starts at a URL nobody is linked
  to. Either a sidebar/palette entry or a dashboard hand-off is missing.
- PAGE_MAP's entry-point list omits this route (see §2) — the atlas undercounts
  orphans; worth a regeneration note there rather than a fix here.
- ~~**`markDelivered` could be run on an order the door had already received.**~~
  **Resolved 2026-09-05** (founder: *"harden it in the procurement service for every
  caller"*). The door and this control book stock under **different idempotency keys** —
  `door-receipt:{eventId}` versus `order-delivered-live:{orderId}` — so nothing
  reconciled them: a door count of 3 on a twelve-bottle order followed by anyone tapping
  "mark delivered" booked 3 + 12 = **15 bottles**, and reset `quantity_received` from the
  door's measured 3 back to the ordered 12. `markDelivered` now refuses before any write
  when the order is DELIVERED, PARTIALLY_RECEIVED or COMPLETED
  (`ORDER_GOODS_ARRIVED_STATUSES`, imported from `order-transitions.ts`, ADR 0125), with
  a 409 whose sentence for the partly-received case names the receiving door as the way
  to finish — because the door adds only the difference and this control does not.
  **The door itself needed no change and got none**: on its FIRST receipt
  `recordDoorReceipt` already subtracts `quantity_received` — whatever the one-shot
  path put on the shelf — from what it books, and on every receipt after that it books
  its own accepted bottles under its own event key, with the running total summed from
  the durable events (`receiving.service.ts:359-372`, ADR 0057 D3). So the two now agree
  by the door reconciling and this path refusing, not by two rules being kept in step.
  What made the 15 reachable was the ORDER of the two: door first, then the tap, where
  the door's reconciliation had already happened and had nothing to subtract.
  `apps/api-gateway/src/procurement/delivered-once.ts`,
  `procurement/tests/delivered-once.spec.ts`.

## 10. Maturity

**broken.** The staff view — the S02 golden path and the only door into
[[receiving-door]] — cannot list a single delivery, for two independent reasons.

| Evidence | `path:line` |
|---|---|
| **1. It filters on a status that does not exist.** `StaffView` requests `/procurement/orders?status=SENT&limit=25`. `ProcurementOrderStatus` has 13 members and **`SENT` is not one of them** (PENDING, APPROVAL_NEEDED, NEGOTIATING, APPROVED, CONFIRMED, IN_TRANSIT, DELIVERED, PARTIALLY_RECEIVED, COMPLETED, CANCELLED, REJECTED, FAILED). `OrderFilterDto.status` is `@IsEnum(ProcurementOrderStatus)` and the app runs a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` → **400 Bad Request**. | call `ReceivingHome.tsx:88-90`; enum `procurement/dto/procurement.dto.ts:15-29`; DTO `:271-275`; pipe `main.ts:69-73` |
| **2. Even on success it unwraps the wrong shape.** It reads `data?.items ?? data ?? []`. `listOrders` returns `{ orders, total, page, limit, hasMore }` — there is no `items`, so `orders` would be bound to the response *object*, `orders.length === 0` is `undefined`, the empty state is skipped, and `orders.map` throws. The shared client helper does this correctly (`response.data?.orders ?? …`) — this view bypasses it. | `ReceivingHome.tsx:91`; server `procurement.service.ts:508-514`; correct unwrap `services/api/orders.ts:56` |
| **The failure is invisible.** `useQuery` is destructured as `{ data: orders = [], isLoading }` with no `isError` branch, so a 400 renders the reassuring empty state: *"Nothing is out for delivery right now."* | `ReceivingHome.tsx:85,102-106` |
| **Manager and owner views are correct.** `/procurement/receiving/queue` and `/procurement/credits/stats` both exist, are JWT-guarded, and return real aggregates. | `receiving.controller.ts:114-153`; `documents/credits.controller.ts:89-123`; `receiving.service.ts:309-370` |
| The role split itself is well built — role comes from `useAuth` (documented as load-bearing), and unknown roles fall to the cost-free view. | `ReceivingHome.tsx:61-72` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/procurement/orders?status=SENT` | JWT (class) | `procurement.controller.ts:65` | **400** — invalid enum (§10) |
| GET `/procurement/receiving/queue` | JWT (class) | `receiving.controller.ts:153` → `receiving.service.ts:309` | `{ items, unverified, totalAtRisk }` — non-`matched` orders joined to open/requested/promised `procurement_credits`, sorted by dollars at risk then by provability |
| GET `/procurement/credits/stats` | JWT (class) | `documents/credits.controller.ts:123` | `{ recovered, outstanding, promised, rejected, openClaims, oldestOpenDays, settlementRate, selfEvidencedOpen }` |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Open deliveries (staff list) | POs created on [[orders]] and the recurring-order cron | `procurement/recurring-orders.service.ts:225,271` |
| `match_status` / `discrepancy_notes` (manager queue) | the four-way match run from [[inventory]]'s `ReceivingWorkspace` | `ReceivingWorkspace.tsx:274` → `procurement.controller.ts:244` → `procurement/invoice-match.ts` |
| `procurement_credits` (both manager and owner numbers) | `openCreditClaim`, opened from a match verdict — never sent, only opened; dedup on `23505` | `procurement.service.ts:1104-1140` |
| `unverified` strip | door receipts with a case count and no bottle count, aged | `receiving.service.ts` `listUnverified`; door writes at `receiving.controller.ts:119` |
| Invoice documents that make the match possible | 5-minute `@Cron` sweep over `conversation_attachments` → `procurement_documents`, content-addressed | `procurement/documents/document-intake.service.ts:581-620` |

**Finding:** the manager and owner views depend entirely on a match that is only
triggerable from a *different page* ([[inventory]]). Nothing on `/receiving` starts the
process it reports on, and nothing links to `/receiving` in the first place (§2).

### Writes

**None.** This page is read-only in all three renderings — every button navigates.

## 12. Design intent

**Should be:** the delivery front door. One event, three renderings by role, with the
staff path deliberately money-free so a porter never argues with a driver.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ all three views | `:100,165,273` |
| empty | ✅ *by text*, ❌ *by truth* — staff's "Nothing is out for delivery right now" is currently a lie (§10); manager's "Nothing to chase" and owner's "No discrepancies found yet" are honest | `:102-106,167-171,318-324` |
| error | ❌ | no `isError` branch anywhere in the file — the reason the 400 is invisible |
| permission-denied | ✅ **best in the repo** — the role split *is* the permission model, and unrecognised roles fail toward showing less | `:61-72` |

The owner view is a model of honest numbers: `recovered` counts only issued credit memos,
money asked for is shown separately and never added in, and the settlement rate supplies
the denominator (`:251-258,298-304`). Keep that discipline when touching this page.

**Where the UI misleads:** the staff empty state (§10) — it reports a healthy quiet
delivery day while the request behind it is rejected.

**2026-09-18 (ADR 0149 row 44):** the decision queue no longer opens for manager alone —
owner gets it too, mounted alongside the recovered-money ledger (`ReceivingNext.tsx`'s
`OwnerBody`).

Measured live against `user_restaurant_access` (Supabase MCP, SELECT only) 2026-09-18,
re-measured 2026-09-19: 10 owner rows across all 10 restaurants, 4 manager rows in 4 of
them (one each), 1 staff row (Sim Bistro, `12823c23-…`, granted 2026-09-03, in a house
that also has a manager); 6 of 10 remain owner-only. So the "permission-denied" row above
was previously leaving that queue unreachable in most houses.

There is still no gateway-level RBAC guard in this tree on `GET /procurement/receiving/queue`,
`GET /procurement/credits`, `GET /procurement/credits/stats` or `POST
/procurement/credits/:id/transition` — until ADR 0167 lands, any authenticated member of the
house, staff included, can call all four today. ADR 0167 (founder: "Refuse staff on all four"
— queue, credits list, stats, transition; peer branch `fix/receiving-credits-refuse-staff`,
Locked 2026-09-19, not yet merged here) owns the gateway 403 for these routes. The role split
above remains a client-side rendering choice only on this page; server-side enforcement lands
with ADR 0167, not here.

## 13. Roadmap

**2026-09-06 — a held invoice and this door.** The founder's currency decision (batch
63), verbatim:

> "take the houses own currency, but AI needs to or otherwise house delibaretly
> chnage it to other currency if the invoice is other than their default"

Built on [[receipts]]. **The founder answered the question that lands HERE the same day,
batch 64, and it is DECIDED:** a held invoice **blocks the PRICE at this door only** —
never the delivery's stock movement — and, verbatim, *"let them approve if otherwise"*:
a person may approve past the hold. He also asked for **a default-currency section on
each vendor's profile**.

**BOTH ARE NOW BUILT (2026-09-06, p4br).** `verifyReceipt` refuses a keyed-in
`invoiceUnitPrice` while an attached invoice's money is not filed, in a sentence naming
the reason and the act that clears it; the stock movement is untouched and that is
measured (`receiving-price-held.spec.ts`). The approve-past is the restatement act
itself: `PATCH :id/currency` now takes a CONFIRMATION as well as a change, logged as
`change_kind = 'confirmed'` with the same author and the same audit row. The vendor
profile's usual currency is §1a on [[providers]].

**A FAILED READ DOES NOT REFUSE, and the cost is stated.** If the document links or the
documents themselves cannot be read, the price is ALLOWED and the failure is logged by
name. An outage that read as "held" would block receipts for a reason nobody could see;
this direction leaves the door exactly as it was before the guard existed, and
`invoiceCurrencyClaim` still refuses to denominate a figure whose currency nobody keyed
in. The guard is best-effort against an outage and deliberately so.

**One limit, stated rather than papered over:** the order's currency is read into the
filing chain only for a document whose intake NAMED an order (`IntakeInput.orderId`). A
document linked to an order LATER — by the auto-matcher or by a person on [[receipts]] —
was already filed by then, and re-filing it is the restatement act, not intake.

**2026-09-06, batch 66 — the two answers that land here, verbatim.**

> **"Keep it open on every invoice"**
> **"Two screens, for now"**

The first: a manager may CONFIRM the currency of any invoice, not only a held one. The
cost, stated — a control anyone can press on any document produces log rows that record
nothing but somebody clicking — is accepted; the benefit is that a house can certify a
currency before a dispute, and that the receiving refusal has one act that clears it
whatever state the document is in.

The second: clearing a held price stays TWO screens. This door refuses the price and
links out to `/receipts?doc=<id>`; the manager decides there and comes back. Putting the
currency control inside the receiving workspace would let a manager clear a hold without
ever looking at the paper, which is the one thing the hold exists to make them do. *"For
now"* is the founder's own hedge and it is recorded as one: if two page loads in the
middle of a delivery prove painful, the control can be embedded with the document image
beside it.

**2026-09-06, batch 64 — the errand costs one ceremony now.** The founder's answer to
whether procurement's write routes should be sealed was **"Decide as a module: seal all
three"**, and the currency restatement is one of the three. Clearing a held price is
therefore: this door refuses and links out; on `/receipts` the manager picks the code and
HOLDS a control; the hold mints a one-time seal over that document and that pair of codes;
the write redeems it. The two-screen cost above is unchanged and the hold is the third
step, not a fourth screen. `verifyReceipt` is not sealed and is not in the census —
sealing the door as well was not asked for and is not assumed here.

**2026-09-06 — a receipt whose order has no LINKED document accepts a typed price with
no cross-check. HALF ANSWERED the same day (batch 67); read to the end of this section.**

Found by the Sonnet audit of `6c0933d3` and reproduced here as shipped tests
(`receiving-price-held.spec.ts`).

`heldInvoiceForOrder` (`apps/api-gateway/src/procurement/procurement.service.ts:2303`) is
gated solely on `procurement_document_links` returning rows for the order. Zero rows and
zero error is indistinguishable from "no invoice exists", so it returns `null` and the
refusal never fires. Meanwhile `hasInvoice`
(`procurement.service.ts:4989`, `invoiceQuantity != null`) depends only on the DESK typing
an invoice-quantity field, and `recordPriceHistory` (`procurement.service.ts:5192`) fires
on `match && hasInvoice`. So a desk that types a price against an order with an UNLINKED
held invoice writes a real `price_history` row: `currency: null` when they typed none, and
whatever three-letter code they DID type when they typed one — `invoiceCurrencyClaim`
(`price-currency.ts`) says outright that `procurement_documents.currency` "is not read by
this path".

The register mirror is not fooled: `vendor_price_observations` refuses a sighting with an
unstated currency, so only `price_history` is reachable this way.

**ANSWERED 2026-09-06, batch 67 — HALF of this is now closed.** The founder chose
*"Refuse a typed price with no currency"*: *"a price without money is not a price: the
receiving screen requires a code (the order's, the house's, or one typed) before a unit
price is accepted; price_history never gains a currency-null row from that door again."*

So `verifyReceipt` refuses `invoiceUnitPrice` with no valid `invoiceCurrency` BEFORE any
read or write, and `VerifyReceiptDto` refuses the same pair on the wire
(`priceStatesItsCurrency`) — one sentence from one function
(`price-currency.ts` `receivingPriceNeedsACurrency`), naming the three ways to state a
code and what still records without one. The receiving workspace carries the code beside
the price field, pre-filled from the order's own currency when it has one, with the
invoice's filed code and the house's reporting currency offered as labelled one-tap
choices — offered, never applied. (Superseded 2026-09-11, batch 69: the invoice's filed
code now pre-fills AHEAD of the order's — see the block below.) Two of the three tests that pinned the old behaviour are
flipped and the typed-code one is kept
(`receiving-price-held.spec.ts`, `dto/verify-receipt-currency.spec.ts`).

**WHAT IS STILL OPEN, and it is the other half.** Nothing cross-checks a typed code against
a document that EXISTS but has not been linked yet: a desk typing `USD` against an order
whose unlinked invoice is in TRY still writes `USD`. The currency-null row is gone from
this door; the wrong-currency row is not. Closing it means running the held-invoice check
when a document is LINKED to an order that already has priced receipts — new behaviour, not
a narrowing of this one, and not built.

**2026-09-11, batch 69 — the price field reads the invoice's own code first.** Asked in
session as "batch 68" by mistake (recorded as batch 69), the founder answered verbatim:

> **"Invoice's filed code first, then the order's"** — *"A reading of the document, like the
> quantities and prices on that screen already are; when the two disagree the comparison
> banner already says so. One line."*

**BUILT (2026-09-11, p4bx).** The receiving workspace pre-fills the price's currency from the
matched invoice's filed code; when the invoice states none, or a code the product cannot
offer (a withdrawn one), from the order's; and otherwise leaves it empty, the house's code
still only a labelled chip. The comparison banner (*"The order was placed in X; this invoice
states Y"*) is unchanged and still prints whenever both are known and differ. With the field
cleared, the chips offer the invoice's, the order's and the house's codes in that order. The
shared refusal sentence (`price-currency.ts` `receivingPriceNeedsACurrency`) said the screen
"offers three" while the invoice's chip had been on screen since batch 67; it now names four.
The batch's other three answers (the twin acts sealed, the 157-code picker kept, withdrawn
codes kept refused) are in [[receipts]] §13. The twins were first chosen by the earlier batch
68 (2026-09-06), which this batch's first answer confirms.

**2026-09-11 — the currency-null `price_history` rows: nothing to count yet.** p4bv asked
whether existing `price_history` rows with `currency: null` should be counted or left. The
parent measured production read-only that day (Supabase connector, project
`exzueerziesmczwlhomd`): `public.price_history` holds **0 rows**, and the production table
has **no `currency` column yet** (its columns are id, restaurant_id, master_wine_id,
provider_id, price, quantity, unit, effective_date, source, order_id, notes, created_at; the
branch's migration adds the column on merge). So there is nothing to backfill and nothing to
count until the branch merges. **The count must be re-taken after the first merge to main.**

**2026-09-11 — two findings from the audit of `b6d2e4b4` closed on this page.** (1) That
commit's message said the DTO, `verifyReceipt` AND this workspace refuse a code-less price
"with one shared sentence naming the three rungs"; the workspace in fact printed its own
wording and named no rung, so in the state with no chip to offer (no order code, no invoice,
an unreadable house) the desk was told a code was needed and not where to find one. The
shared half of the sentence is now one exported constant in `price-currency.ts`
(`RECEIVING_PRICE_CURRENCY_RUNGS`, worded to be true before anything is sent); the refusal
composes from it and this panel IMPORTS it — the first production import from the gateway in
the web app. It builds because Vercel builds the web from the monorepo root, and it stays
current only because `scripts/vercel_should_build.sh` and `turbo.json` now list
`price-currency.ts` and `common/iso-4217.ts` as web-build inputs: without that, a gateway-only
edit to the sentence would skip the preview and hit the web's turbo cache. (2) The second
receipt on an order that already carries a price from an earlier verify, submitted with counts
and no price, is now pinned: no price is written from the stored row and nothing is refused
(`receiving-price-held.spec.ts`).


1. **Fix the staff query.** Use `getOrders({ status: … })` from `services/api/orders.ts`
   (which maps to the backend enum and unwraps `.orders`), with a real status —
   `CONFIRMED` and/or `IN_TRANSIT` are the "out for delivery" states. Two bugs, one fix.
   *Blocker: none, but it needs a decision on which statuses count as "arriving today".*
2. **Add an error branch to all three views** so a failed request never renders as an
   empty one. This is the defect that let #1 hide.
3. **Make the page reachable** — a sidebar entry, a command-palette command, or a
   dashboard hand-off. Today S02 begins at a URL nothing links to (§2, §9), which also
   orphans [[receiving-door]].
4. Link the manager queue's rows to the match workspace on [[inventory]] rather than to
   `/orders?order=` — the decision the row asks for is made there.
5. Turn on the reporter for the two `data-ux-key` markers already placed (§5).
6. **Compare the invoice's OWN allowance and deposit against the agreement's** — the
   other half of ADR 0119 Q3, opened 2026-09-05. What changed on 2026-09-05: the AGREEMENT
   now names its money outside the price (`procurement_order_items.allowance`, `.deposit`,
   `.freight`), and `verifyReceipt` reads it, states it in the verdict's notes, and stops
   reading a billed deposit the agreement provided for as a price variance. What did NOT
   change, measured on this tree: `procurement_document_lines.allowance` and `.deposit`
   (`baseline:4393-4394`) are written by the document parser and read by NOTHING at the
   door — the only charge figure reaching `computeMatch` is the caller-supplied
   `allocatedCharges` scalar, which is folded into landed cost and never compared to
   anything. So the door compares like with like on the UNIT axis and not yet on the
   CHARGES axis. *Blocker: it needs a decision on where the invoice's line-level charges
   come from — the desk typing them like every other invoice figure, or the door reading
   the matched `procurement_document_lines` row — and the second is a new read on a path
   that currently takes all its invoice numbers from the request body.*
7. **The agreed price reaching the door is now the LINE's, converted once** (ADR 0119
   phase 2, 2026-09-05) — recorded here because it changed a verdict this page renders.
   `verifyReceipt` fed `procurement_orders.final_price`, the unit-less header, into
   `computeMatch`'s `poUnitPrice`, which `invoice-match.ts` documents as PER BOTTLE, so a
   case-priced agreement produced `price_variance` — the loudest verdict the module
   reaches — on an order where nothing was wrong. It now converts from the line's stated
   `(price_uom, price_pack_size)`, and for an OPAQUE pair (per keg, per litre) it makes
   NO price comparison at all rather than a wrong one: the check reads as not evaluated,
   which is true, and the reason is logged and written into the discrepancy notes.
8. ~~**Two paths book the same delivery under two idempotency keys.**~~ **DONE
   2026-09-05** — the half that could be closed without a decision. `markDelivered` now
   refuses an order the door has already received (§9), so the 3 + 12 = 15 case cannot
   be reached from any caller. **The refusal is a 409 that carries the earlier delivery**
   (founder, batch 46): *"a second delivery of an already-delivered order answers 409
   Conflict, not 400 — the request is well-formed, the order's state conflicts with it,
   and the door and the one-tap rail must be able to tell 'already done' from 'you sent
   nonsense' and show the earlier delivery instead of an error."* **400 was rejected.**
   The body carries `earlierDelivery` — when, who took it in (named from `users`, and
   saying *"could not look up"* rather than *"nobody"* when the register cannot be read),
   and how much **in the order's own unit** with the bottle count beside it. Measured and
   worth stating plainly: **this page cannot reach that refusal.** `receiving/next` and
   `services/api/receiving.ts` post only to `/procurement/receiving/*` and
   `/procurement/documents`; nothing here calls `/procurement/orders/:id/deliver`, so no
   render path was added here for a call that does not exist. The surfaces that DO reach
   it are the one-tap rail, the Action Center, both Orders desks and the mobile outbox. **What is NOT closed and is still P11:** neither
   `recordDoorReceipt` nor `verifyReceipt` releases shadow stock or `in_transit_quantity`
   — only `markDelivered` and `releaseOrderShadowStock` do — so the door→verify flow, the
   flow the two-stage design exists for, still leaks a reservation for every delivery it
   handles. This pass deliberately did not touch `receiving.service.ts`: the leak is a
   *missing* write on the door's path, not a *duplicate* one on this path, and it needs
   its own decision about where the release belongs. *Blocker: founder / owner of
   `receiving.service.ts`.*

## 14. Pipeline review — 2026-09-01

§1–13 above document the **legacy** `ReceivingHome.tsx`. This section covers the
**pipeline underneath both renderings** and the rebuilt `receiving/next` surface, from a
four-way pass (three extraction agents plus a direct read of `receiving.service.ts`).
Every entry marked ✅ was re-verified by hand against source and, where the claim is
about the database, against **production** — not against the migrations, because CI
builds from migrations onto a fresh database and cannot see a write to a column
production does not have.

### 14a. The framing fact

**The receiving pipeline has never run in production.** Measured 2026-09-01:

| table | rows |
|---|---:|
| `procurement_receipt_events` | **0** |
| `procurement_credits` | **0** |
| `procurement_documents` | **0** |
| `procurement_orders` | 2 (`APPROVED`, `PENDING` — neither delivered) |
| `procurement_order_items` | 1 |
| orders with a `match_status` | **0** |

Nothing below is a salvage job on a live corpus. Every schema decision here is being
taken at the cheapest moment it will ever be taken — the same argument ADR 0054 made for
its CHECK constraints.

### 14b. Verified defects

| # | Defect | `path:line` | Verified |
|---|---|---|---|
| **P1** | `verifyReceipt` writes `notes:` to `procurement_orders`, which **has no `notes` column** in production (it has `delivery_notes`, `manager_notes`, `discrepancy_notes`). `?? undefined` drops the key when absent, so it throws **only when a manager typed a note** — i.e. only on a discrepancy, and only *after* the ledger correction and the credit claim have already been written. Status, `match_status`, `accepted_quantity`, `invoice_*` and `price_history` never land. A retry fails identically. There is **no `verifyReceipt` test in the repo**. | `procurement.service.ts:1653` | ✅ code + prod `information_schema` |
| **P2** | `adjustments[]` can write stock into **another tenant**. `ReceiptAdjustmentDto.inventoryId` is `@IsString()` only, and `VerifyReceiptDto.adjustments` carries `@IsArray() @IsOptional() @Type(...)` with **no `@ValidateNested({each:true})`** — so the nested DTO is never validated at all. `applyReceiptAdjustment` passes the id straight to `apply_stock_movement`, which derives `restaurant_id` from the target row. | `dto/procurement.dto.ts:194-210`; `procurement.service.ts:~1510` | ✅ code |
| **P3** | `markDelivered` writes `quantity_received: quantityReceived ?? null` while booking `order.quantity` into the ledger. The web client sends no quantity. The door's anti-double-book guard reads exactly that column (`alreadyBooked = quantity_received ?? 0` → 0) and books the full count on top. | `procurement.service.ts:1262` vs `receiving.service.ts:194` | ✅ code |
| **P4** | **Nine read sites compare `procurement_orders.status` to lowercase `"delivered"`.** The write path sets the enum value `DELIVERED` (uppercase); production holds `APPROVED`/`PENDING`, both uppercase. So every vendor scorecard, lead-time statistic, on-time rate and procurement-spend figure reads **structurally zero** — not because there is no data, but because of case. Two *backfills* insert lowercase (`providers.service.ts:959`, `provider-intelligence.service.ts:626`), so any repaired history would be mixed-case. **The tests lock in the wrong case** (`dashboard.spend.spec.ts:59,68`; `order-schema-drift.spec.ts:221,234`) — they are green because the fixtures feed the code the case the code expects rather than the case the app writes. | `advanced-analytics.service.ts:290,437`; `dashboard.service.ts:322,438,569,832`; `goals.service.ts:320`; `analytics.service.ts:154`; `insight-generator.service.ts:239` | ✅ code + prod status values |
| **P5** | A door receipt whose `apply_stock_movement` fails is reported as a **success**: the RPC error is `logger.warn`ed, then `quantity_received`, `status` and `delivered_at` are written anyway and the response returns a non-zero `stockDelta`. Same hole when `inventory_id` is null — nothing is booked and a non-zero delta is still reported. | `receiving.service.ts:198-248` | ✅ code · *owned by another session* |
| **P6** | `openCreditClaim` sets **no `provider_id`, `document_id`, `document_line_id` or `claimed_qty`**. So a claim knows which *order* but not which *vendor*, *invoice* or *line*. This kills the `?providerId` filter and the `idx_pc_provider` index that already exist, and it makes the `uq_pc_line_reason` dedupe index (`WHERE document_line_id IS NOT NULL`) **unreachable** — the "23505 = already claimed" branch is dead code, and every re-verify manufactures another open claim, inflating `outstanding` and `totalAtRisk`. | `procurement.service.ts:1461-1477` | ✅ code |
| **P7** | Both door clients **hardcode `countedUom: 'case'`** and send no `packSize`. The fail-closed unit refusal shipped in #208 is therefore unreachable, and the multiplying unit is now *asserted* on every door count. `resolvePackSize` falls back to **1** when the order cannot supply a ratio — so "3 cases" books 3 bottles, an under-count presented as a measured receipt. | `DoorNext.tsx:286`, `DoorReceipt.tsx:124`; `receiving.service.ts:441-453` | ✅ code |
| **P8** | Three of four `stage` values have **no writer anywhere**. Only `case_count` is ever written; `signed_at_door`, `bottle_count` and `reconciled` exist in the CHECK and in tests only. `listUnverified` needs `bottle_count` or `reconciled` to close a delivery, so the only real exit is the order reaching `COMPLETED` — which `verifyReceipt` grants only when an invoice quantity was supplied. **A delivery counted to the bottle against a packing slip ages to `overdue` forever**, and the queue's loudest alarm fires hardest on correctly-handled deliveries. `receiving.spec.ts:449` asserts this works by mocking a row no code path can produce. | `receiving.service.ts:170,297,322-327`; `procurement.service.ts:1645-1649` | ✅ code |
| **P9** | **Two cross-tenant holes on the count path.** `getBalanceAt` accepts `restaurantId` and never uses it; `get_inventory_balance_at` takes no restaurant argument, so any authenticated user can read any inventory item's historical balance by id. `recordSpotCount` calls the stock RPC with a path-supplied `inventoryId` before any ownership check. **Still open, and the scoped write that partly masked it is gone:** [ADR 0078](../decisions/0078-a-count-is-a-record-in-its-own-right.md) replaced `set_stock_absolute` with `record_stock_count`, which likewise derives `restaurant_id` from the target row, and folded the `restaurant_id`-scoped `last_counted_at` touch into that same RPC — so the request no longer contains a single tenant-scoped statement. `reconcileInventory` has the identical shape. | `inventory-ledger.service.ts:334`, `:480`; `inventory.service.ts:363-415` | agent-reported, function signatures confirmed in prod |
| ~~**P10**~~ | ✅ **Resolved 2026-09-02 by [ADR 0079](../decisions/0079-a-price-says-what-kind-of-price-it-is.md) / #244.** Both halves. The price is no longer gated on the quantity delta: `applyReceiptAdjustment` writes the movement only when `delta !== 0` but calls the new `revalue_lot` RPC whenever `unitCost != null`, so a delivery that was counted correctly and priced wrongly — the commonest case, and the one that previously wrote nothing anywhere — now restates the lot. The correction RESTATES rather than adding a rival lot, preserving the prior price in append-only `inventory_lot_revaluations`, because a positive delta used to INSERT a second lot at invoice cost beside the estimate and `inventory_lot_rollup.wac` blended the two permanently under the label "invoiced lot WAC". And `markDelivered` now passes `cost_provenance: 'estimated'` for `final_price`, while `apply_stock_movement` RAISEs on a price with no stated provenance instead of defaulting to `'invoice'`. Found in the same pass and not in this row: `applyReceiptAdjustment` passed `p_source: "receiving"`, which is not a member of `inventory_transaction_source`, so **every** receipt-verification stock correction 422'd — the test was green because it mocks the RPC. | `procurement.service.ts:1667`, `:1928`, `:1956`; `supabase/migrations/20260902150000_lot_cost_truth.sql:134,315` | ✅ code + `scripts/check_lot_cost_provenance.py` |
| **P11** | Reservations leak on the entire new door flow. Shadow stock is released only in `markDelivered` and `releaseOrderShadowStock`; **neither `recordDoorReceipt` nor `verifyReceipt` touches shadow or `in_transit_quantity`** — and door→verify is the flow the two-stage design exists for. `cancelOrder` also releases only from `APPROVED\|CONFIRMED\|IN_TRANSIT`, so cancelling a `PARTIALLY_RECEIVED` order (the status the door always leaves) leaks too. | `procurement.service.ts:1094,1204,1336,1014-1022` | agent-reported |
| **P12** | Every windowed read is rendered as a total. `totalAtRisk` sums a 100-order slice joined to an **unordered** 200-credit slice; `/procurement/credits` returns the **oldest** 200 by `opened_at ASC`, so `creditedThisMonth` on the owner ledger silently reads `$0` past 200 lifetime settlements — and renders `$0`, not `—`, because the array arrived successfully. `recoveryStats` sums an unordered 5000-row slice. `listUnverified` caps at 500 lifetime events, so the oldest — i.e. the `overdue` ones — fall off first. ADR 0051 requires a floor marker (`≥ n`). | `receiving.service.ts:271,383,428`; `credits.controller.ts:112,137`; `useReceivingNextData.ts:308-330`; `RcOwnerLedger.tsx:90-91` | agent-reported |
| **P13** | Dashboard procurement spend returns **hard zeros on query error** — a dead gateway and an empty cellar render identically. `getVendorTrust` likewise returns `{score: 0, eligible: false}` on any exception. This is the literal defect ADR 0051 was written from. | `dashboard.service.ts:326-331`; `procurement.service.ts:2872-2874` | agent-reported |
| **P14** | The discrepancy verdict is a **mutable column set, not a record**. `verifyReceipt` overwrites `match_status`/`discrepancy_notes` on the order row with no re-verify guard, and sets `discrepancy_notes = null` when the verdict lands on `matched` — erasing the prior narrative. Meanwhile the ledger *refuses* to move on a re-verify (idempotency key `receipt-verify:{orderId}:{inventoryId}`), so a second verify changes what the system **says** happened without changing what it **did**. | `procurement.service.ts:1656-1676`, `:1518` | agent-reported |

### 14c. What is genuinely well built — do not "fix"

- The fail-closed unit refusal and its error text (`receiving.service.ts:131-145`) — ADR 0011 applied at the door, with a 400 that names the question a human can answer in two seconds.
- No `p_unit_cost` at the door, so the lot lands `cost_provenance='estimated'` rather than wearing an unverified price (`:216-218`).
- The two-stage model, and provisional-ness **derived** rather than stored as a third stock state (`:29-48`).
- `procurement_credits.evidence` — a full `MatchResult` snapshot frozen at claim time, never overwritten (`procurement.service.ts:1476`).
- The credit **settlement** chain: `credited` requires both a document and an amount, is terminal, counts `creditedAmount` not `claimedAmount`, and the database enforces it independently (`procurement_credits_credited_needs_proof`). Best-built thing in the domain.
- `price_verified` is `NULL`-not-`false` when unverifiable (`procurement.service.ts:1671`).
- Content-addressed documents (`sha256` per restaurant), original bytes retained, original parse kept in `extracted` jsonb.
- The owner view's honest numbers, and the role split as the permission model (§12).

### 14d. Receiving as a label factory

Receiving is the only place in the product where a number is produced by a person
touching an object. Six machine-proposes/human-judges pairs exist, and **four of them
destroy the machine's half at the moment it becomes a label**:

1. Confirming a suggested line match overwrites the model's score (`match_confidence → 1`, `match_method → "manual"`) — `documents.controller.ts:244-245`.
2. Suggested matches are **never persisted at all** — the rejected candidates, i.e. the entire negative class, vanish on the HTTP response (`document-intake.service.ts:497-502`).
3. The door's paper pre-fill never leaves the browser; whether the receiver accepted or overrode the machine's reading of the packing slip is not transmitted (`DoorNext.tsx:236-246`).
4. The verify form's pre-fill overwrite is untracked — a manager correcting a misread `invoiceQty` leaves no trace (`ReceivingWorkspace.tsx:202-223`).
5. `editLine` overwrites the extracted line in place and is deliberately anonymous — no actor, no timestamp, no diff (`document-intake.service.ts:653-656,772-780`).
6. The damage photograph is **never taken**: `damage_photo_path` is a write-only column with no producer and no consumer, and no client sends it, despite three docblocks promising it.

Plus: `extraction_model` has no writer; `procurement_documents` has no `event_id`, so no
extraction can ever be attributed to a model; and **no `operator` Neural Footprint event
is written anywhere in the repo**, though `subject_type` has allowed it since 2026-08-24
for exactly this purpose.

Every one of these is one instance of one missing rule: *a machine proposal shown to a
human is written before the human answers, and the answer is appended, never
substituted.* The corpus is empty today, which is the only moment adopting that rule is
free.

### 14e. Forks for the founder

Open, not decided. See `.planning/decisions/OPEN-DECISIONS.md` once filed.

1. **P4's blast radius.** Fixing the lowercase status is nine read sites, two backfills that write the wrong case, and four test files that lock it in. It is not a receiving fix — it is every procurement number in the product. Sweep now, or file and continue?
2. **How an honest delivery leaves the unverified queue** (P8) — write a `bottle_count` event from `verifyReceipt`, let a manager say "counted, no invoice yet", or both?
3. **Whether a verdict is a record or a column** (P14) — append-only match history, forbid re-verify, or accept overwriting?
4. **Whether to adopt the label-preservation rule now** (14d), while the corpus is empty.

(More forks, about the sketch 107 desk rebuild and `receiving_line_verdicts` rather than this pipeline review, are recorded where that work lives — **[CORRECTED 2026-09-20, receiving round-5 must_fix pass: this used to say "just above §15", which is wrong, and "two", which a third item this same pass added made stale]** — at §1a, "Three more forks for the founder", not renumbered into this list, which is §14's own.)


### 14f. Label preservation — status after ADR 0059

[[0059-receiving-preserves-the-pair]] adopts §14d's rule verbatim:

> A machine proposal shown to a human is written before the human answers, and
> the answer is appended, never substituted.

Held by `scripts/check_proposal_preservation.py`, blocking in CI, proven to exit
1 against pristine `origin/main` at the two pre-fix sites and 0 after. Adopted
while production held **0 documents, 0 document lines, 0 receipt events and 0
credits** — the only moment the rule was free, since the proposal half cannot be
back-filled from the confirmed half.

Against §14d's six destruction points plus its two capture holes:

| # | §14d destruction point | Status |
|---|---|---|
| 1 | Confirming a suggested line match overwrites the model's score | **CLOSED.** `proposed_confidence` / `proposed_method` written at proposal time; confirmation adds `confirmed_by` / `confirmed_at` and never touches the match columns for a previously-proposed row. A pairing no machine proposed still gets `manual` — there is no proposal there to destroy. |
| 2 | Suggested matches are never persisted at all | **CLOSED.** New `procurement_line_match_suggestions` — one row per candidate with confidence, method, substitution and reason, `resolved_as` filled on accept/reject. Losing candidates resolve `superseded`, never `rejected`: no human judged them. |
| 3 | The door's paper pre-fill never leaves the browser | **PARTIAL — still lost.** `DoorNext.tsx` now sends `suggestedQty` / `suggestionAccepted`, `DoorReceiptDto` validates both, and `procurement_receipt_events` has the columns. The insert in `receiving.service.ts` is a marked `TODO(ADR 0059, L3)` — that file was owned by a concurrent session. **The label now reaches the gateway and is dropped there instead of in the browser: a shorter fall, not a fix.** |
| 4 | The verify form's pre-fill overwrite is untracked | **PARTIAL — still lost.** Same shape: `ReceivingWorkspace.tsx` sends four `prefilled*` values frozen at pre-fill time, `VerifyReceiptDto` validates them, `procurement_orders` has the columns; the write in `procurement.service.ts` is a marked `TODO(ADR 0059, L4)`. |
| 5 | `editLine` overwrites the extracted line in place, anonymously | **OPEN.** Not in scope here. Note the guard already covers the tie-out columns `editLine` recomputes, so a future fix inherits enforcement. |
| 6 | The damage photograph is never taken | **OPEN.** Untouched — `damage_photo_path` still has no producer and no consumer. |
| — | `extraction_model` has no writer | **CLOSED.** `ParsedDocument.extractionModel` carries it from the extractor (which always knew it) to the insert. NULL stays honest for EDI and for an unreadable document: no model ran. |
| — | `procurement_documents` has no `event_id` | **CLOSED.** Column added, `ON DELETE SET NULL` (not CASCADE — [[0037-nfb-erasure-is-crypto-shredding]] erasure must cost attribution, never the label), populated from the extractor's `NfEventRef` with a bounded 2s wait so the instrument can never hang the extraction it measures. |

Three failing-by-design `it.skip` tests in
`apps/api-gateway/src/procurement/proposal-preservation-deferred.spec.ts` name
the exact lines that finish rows 3 and 4. §14d's remark that **no `operator`
Neural Footprint event is written anywhere in the repo** is unaddressed and
remains true.


## 15. Page-honesty pass — 2026-09-01 (`fix/receiving-page-honesty`)

Ten defects measured on the rebuilt `receiving/next` surface against
[ADR 0051](../decisions/0051-rebuilt-pages-show-live-data-only.md), the day
after 0051 locked. Decision recorded as
[ADR 0060](../decisions/0060-a-window-is-a-floor-and-an-unknown-is-not-a-zero.md).
Line numbers are pre-fix, against `origin/main` at `5d3dbe7e`.

| # | Defect | Where | Status |
|---|---|---|---|
| F1 | `procurement_orders.quantity` is denominated in `unit_type`, and was rendered as bottles — a five-**case** order told the door five bottles were expected. `mapOrderRow` already emitted `bottlesTotal` (`procurement.service.ts:1913-1914`); it was unused | `useReceivingNextData.ts:111`, `RcStaffLane.tsx:135` | ✅ fixed |
| F2 | `vendor` always null — the hook reads `providerName`, which `mapOrderRow` never emits | `useReceivingNextData.ts:107` | ⚠️ client half done; **gateway TODO** |
| F3 | Outbox not tenant-scoped: one global `localStorage` key, so restaurant A's dropped receipt rendered as a `role="alert"` under restaurant B | `useReceivingNextData.ts:373` | ✅ pins fixed; ⚠️ **queue TODO** |
| F4 | An offline non-attempt stamped as a clean sync — `last sync 14:32 · sent 0 · failed 0` under a header reading "offline — holding" | `doorOutbox.ts:94` → `:491` → `RcOutboxRail.tsx:260-262` | ✅ fixed consumer-side |
| F5 | Six windowed figures rendered as totals; **not one `≥` on the page** | `RcStaffLane.tsx:181`, `RcManagerQueue.tsx:91,121,390`, `RcOwnerLedger.tsx` | ✅ fixed |
| F6 | A measured `$0` and an unknown both rendered as `—`, beside a literal `0` — one row could read `$— · 0 open claims` | `RcManagerQueue.tsx:261,313,314` | ✅ fixed |
| F7 | The uncounted strip rendered only when non-empty and the hook set `[]` on failure — a failed query read as "nothing uncounted" | `RcManagerQueue.tsx:403`, `useReceivingNextData.ts:250` | ✅ fixed |
| F8 | 403 indistinguishable from 500; two of three renderings never printed the message | `RcStaffLane.tsx:37-53`, `RcOwnerLedger.tsx:105-125` | ✅ fixed |
| F9 | The credited-list query had no error branch — honest by accident, indistinguishable from "no credited claims yet" | `useReceivingNextData.ts:349-359` | ✅ fixed |
| F10 | `/receipts` hand-off dropped the order id its sibling passed; `settlementRate` (settled ÷ all resolved) sat under "They refused" | `RcManagerQueue.tsx:342`, `RcOwnerLedger.tsx:152-165` | ✅ fixed; `?order=` inert until `ReceiptsNext.tsx` reads it |

### The server windows this page renders behind

Registered in `useReceivingNextData.ts` as `SERVER_WINDOWS`, cited to the query
that imposes each. CI (`check_windowed_figures.py`) fails when a declared cap no
longer matches its source.

| Window | Cap | Query | Observable from the client? |
|---|---|---|---|
| `QUEUE_ITEMS` | 100 | `receiving.service.ts:375` | **Yes** — a full page proves more may exist, so the floor is conditional |
| `UNVERIFIED` | 500 | `receiving.service.ts:271` (receipt events) | No — the derived list is shorter than the window |
| `LINKED_CREDITS` | 200 | `receiving.service.ts:384`, **no `.order()`**, capped per *restaurant* not per order | No — hence `openClaims` is a floor unconditionally |
| `RECOVERY_STATS` | 5000 | `credits.controller.ts:137`, **no `.order()`** | No — aggregates only, so every owner figure is a floor |
| `CREDITS_LIST` | 200 | `credits.controller.ts:113`, ordered **oldest-first** | No — and the ordering means a busy restaurant's *recent* settlements fall outside the month-on-month trend entirely |

### What was already honest and was preserved verbatim

Named here so a later pass does not "tidy" any of it away: `rc-format.ts:8-44`
(`num()` rejecting NaN/empty/non-finite); `RcStaffLane.tsx:37-53` — *"there may
well be a truck outside. Write the delivery down on paper."*, now the 5xx branch;
`useReceivingNextData.ts:465` + `RcOutboxRail.tsx:179-182` (a thrown IndexedDB
read → `null`, rendered "unknown, not zero"); `RcOutboxRail.tsx:127-132` (the pin
that audits its own inference); `RcTally.tsx:40-41` (a dash→number transition
does not animate — knowledge arriving is not a value changing);
`RcOwnerLedger.tsx:101-103` (`recovered` sums `creditedAmount`, never
`claimedAmount`); `RcCreditDrafts.tsx:34-43,179` (no optimistic state in the
approve path).

### Still open after this pass

1. **`mapOrderRow` maps no provider name** (`procurement.service.ts:1906-1928`).
   Until it does, the door cannot see which distributor is in front of it — the
   card now says so explicitly instead of showing the wine in the vendor slot.
   The client reads `providerName` and `provider.name` defensively, so the fix is
   one join and one mapped field, with no web change.
2. **The door outbox queue carries no restaurant id.** `doorOutbox.ts` writes
   every receipt under the single mutation type `receiving.door` and
   `QueuedDoorReceipt` is `{orderId, orderLabel, body}`, so a queued receipt
   cannot be attributed to a tenant from the consuming side at all. The pinned
   *drops* are scoped; the *queued* list is not. The consuming filter is written
   and inert until the write side stamps the field.
3. **`ReceiptsNext.tsx:447` reads only `?tab`**, so the order id this page now
   passes to `/receipts` does not yet select anything there.
4. **A delivered order can no longer be cancelled away, and the door is where the
   correction now belongs** (2026-09-05, ADR 0125). Cancelling a DELIVERED or
   PARTIALLY_RECEIVED order used to be allowed and reversed nothing — the receipt event
   stood, the stock stayed booked — while taking the order's cost out of every spend and
   delivery figure. `order-transitions.ts` refuses it, and the refusal a person reads
   points here: *"Raise a vendor credit against the delivery instead, or correct the count
   at the receiving door."* That sentence is a promise this page has to keep. The credit
   half exists (`procurement/documents/credit-ledger.ts`); **the count-correction half is
   not verified from this page and is not claimed here** — whether a counted receipt can be
   corrected at the door, and by whom, is the open question the refusal now creates.
