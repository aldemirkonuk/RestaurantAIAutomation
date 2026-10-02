# 0259 — Receipts: the walk-through rulings of 2026-10-01 (R3)

- **Status:** Locked
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** receipts, walk-through, canonical sheet, review card, tie-out, VAT breakdown, house words, phone width, keyboard, letterhead, despatch number, paste or drop, e-invoice number, papers the house issues
- **Links:** [`06-pages/receipts.md` §14](../06-pages/receipts.md) (every item, its evidence and its test), [[0104-every-incoming-document-renders-as-one-canonical-mudavym-document]] (the sheet; paper stays light in dark mode), [[0112-one-modal-policy-three-shapes-one-primitive]] (the field dialogs as `Panel`), [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] (state in the URL), [[0047-am-interlock-supersedes-rivet-m]] (the mark on the letterhead), [[0169-the-ground-is-white-by-default-and-each-person-chooses]] (the paper ground), [[0207-a-vendor-is-scored-on-what-it-did-from-the-houses-own-records]] (the house data-terms sheet), `p4-scratch/review-shared-queue.md` (R3 rows), `tech-debt.d/2026-10-02-fix-review-receipts.md`

## Context

The founder walked `/receipts` (ReceiptsNext, flag `mudavym_design_receipts`, with the formatted sheet behind `mudavym_design_document`) on 2026-10-01, in session R3 on branch `fix/review-receipts`. A local gateway ran on the production database with timers off, in Sim Meyhouse; from W17 on, the pane was signed in as the founder's own account. Ten passes (P1 Purpose … P10 Live) were run. Each finding was put to the founder as `RECEIPTS-W<n>`. From W7 on, every proposal came with a before/after and a sketch, and nothing was built before the founder saw it (their ruling of 2026-10-01). W6-A to W6-D were built before they were asked, and are marked SELF. W44-SELF and W45c-SELF were built unasked and named in the next approval. W20 came from the coordinator (DASH-W16e, shared batch 2). W42, W43, W45 and W45c came from the founder's own questions mid-walk, with their real invoice as the case, read locally only. This ADR records the rulings. Their evidence lives in §14 of the page doc and is not repeated here.

## Options considered

For each item: build it as sketched (Approve), leave the page as it is (Deny), or change the proposal (Rework or a fork). Those rejected, reworked or forked:

1. **W2, the document drawn twice.** Keep both, the sheet on demand, or the sheet first with the card trimmed to its acts. The founder chose the sheet first. The read and edit copies of the lines remain (OD-TBD-R3-1).
2. **W4, "Approve + show me".** Built. The "show me" half did not happen: the house that would show it was not in the Sim owner's switcher.
3. **W5, the VAT tie-out.** Fix the rule, and decide what to do with the stored verdicts. The founder chose to fix the rule and leave the rows. Rejected: rewriting the stored verdicts.
4. **W6-A, built before asking.** The founder asked for visual diffs and a real-life scenario instead of a ruling. It was re-asked as W7 under the new before/after rule, and approved with W7.
5. **W14, the engine's 30 checks.** Record an open decision, show hand-picked reasons now, or leave it. The founder chose the open decision (OD-TBD-R3-3). Rejected: hand-picked reasons now.
6. **W16, the wrong-year shelf link.** Unlink with "Not this one", or leave it. Left linked, as a live example.
7. **W21, the swipe's motion.** A closing seal motion, then A (the seal lands) or B (the seal lands and the track gives), then a rework. The founder chose A plus a loading sign. Rejected: B.
8. **W26 and W28.** Variant A was built and B drawn. The founder chose A both times.
9. **W32, the field dialogs.** Keep the page's own helper (W31) or move both onto the house `Panel`. The founder chose `Panel`. The helper `useDialogTrap.ts` was deleted, never committed.
10. **W35, line tables on a phone.** Stack on phones, leave them swiping, or record an open decision. The founder chose to stack.
11. **W39, control edges.** Fix the page now and queue the house colour, queue only, or record an open decision. The founder chose fix now and queue. On the built result the founder answered with a new ask instead (see Interpretations).
12. **W40, the 94 Tab stops.** A skip link, actions only after Enter, both, or keep. The founder chose the skip link. Rejected: actions only after Enter.
13. **W41, seven gaps between the paper and the sheet.** Fix three here: (b) the order number, (c) the VAT sentence, (g) the unit beside Billed. Rejected for this branch: (a) the deposit counted twice, (d) the seller's tax number, (e) the VAT rate and base, (f) Ordered / Shipped / Received. Those went to the defect list.
14. **W43, ways an invoice photo comes in.** "Pictures in email text" was offered and not picked.
15. **W45c, framing the sheet.** A letterhead, B stamp, C band. The founder chose A. Rejected: B and C.

## Decision

The founder's words, verbatim, per item:

| Item | Ruling |
|---|---|
| RECEIPTS-W0 | "Hold to accept" |
| RECEIPTS-W1 | "Approve" |
| RECEIPTS-W2 | "Sheet first, card trimmed (Recommended)" |
| RECEIPTS-W3 | "Approve (Recommended)" |
| RECEIPTS-W4 | "Approve + show me" |
| RECEIPTS-W5 | "Fix rule, leave rows (Recommended)" |
| RECEIPTS-W6-A (SELF) | "show me visual change diffs, and real life scenario"; W7's first question the founder dismissed with "do it per the new rule decided by the orchestrator" |
| RECEIPTS-W6-B, W6-C, W6-D (SELF) | "Approve (Recommended)" |
| RECEIPTS-W7 (with W6-A) | "Approve both (Recommended)" |
| RECEIPTS-W8-A, W8-B, W8-C | "Approve (Recommended)" |
| RECEIPTS-W9 | "qpproved + be aware that every component and detail can be read easily and wholeshouldn't confuse people, clear divisions" |
| RECEIPTS-W10, W11, W12 | "Approve (Recommended)" |
| RECEIPTS-W13, write controls pressed live | "Bring the original, Correct a line, then undo, Swipe to confirm, Shelf ✓ link" |
| RECEIPTS-W14 | "Record as an open decision (Recommended)" |
| RECEIPTS-W15 | "Approve (Recommended)"; on retaking the shots: "Skip the pane" |
| RECEIPTS-W16 | "Leave it linked" |
| RECEIPTS-W17 | "Accept it for me (Recommended)" |
| RECEIPTS-ALERT, two confirms the founder made | "That was me, leave them" |
| RECEIPTS-W18, W19, W20 | "Approve (Recommended)" |
| RECEIPTS-W21 | asked mid-walk: "add a motion signature to use to swipe up to confirm"; the kind: "A closing seal motion (Recommended)"; then "seal lands + a loading sign", then "Approve (Recommended)" |
| RECEIPTS-W22 | "Year once, per 12 bottles, Drop code 7161, Say "A PDF"" |
| RECEIPTS-W23 | "Own-page link, Reading in words, Order sentence, Money name" |
| RECEIPTS-W24 | "Reading…, No answer, Refused, Credits once" |
| RECEIPTS-W25 | "Use ₺ (Recommended)" |
| RECEIPTS-W26 | "A: say it once (Recommended)" |
| RECEIPTS-W27 | "Keep 'adds up' (Recommended)" |
| RECEIPTS-W28 | "A: per item (Recommended)" |
| RECEIPTS-W29 | "Header 'not read', Being chased 'Not read', Mudavym, not gateway, No 'ceremony'" |
| RECEIPTS-W30, W31 | "Approve (Recommended)" |
| RECEIPTS-W32 | "Move both onto Panel (Recommended)", then "Approve (Recommended)" |
| RECEIPTS-W33, W34 | "Approve (Recommended)" |
| RECEIPTS-W35 | "Stack on phones (Recommended)", then "Approve (Recommended)" |
| RECEIPTS-W36, W37, W38 | "Approve (Recommended)" |
| RECEIPTS-W39, the fork | "Fix page now + queue (Recommended)" |
| RECEIPTS-W39, on the built result | "create border giving Mudavym at top right, and what happens if the 'irsaliye' is photo taken and has different Id numbers that we don't understand what do we doi then? + what do we do when we get  final invoice as the pasted photo?" |
| RECEIPTS-W39b | "frame our sheet, and create 3 different visuaks for it" |
| RECEIPTS-W40, the fork | "skip link + show me how we we transform third party vendor incvoices to our formatted with visual one page with the received invoice and  our formatted version" |
| RECEIPTS-W40, built | "Approve (Recommended)" |
| RECEIPTS-W41 | "Order number,VAT sentence,Unit beside Billed,None, list only" |
| RECEIPTS-W41b | "Fix 3, list the rest (Recommended)" |
| RECEIPTS-W41c, built | "Approve (Recommended)" |
| RECEIPTS-W42 | "Despatch number (Recommended),Ask a person,Remember vendor numbers,Record only for now" |
| RECEIPTS-W43 | "Paste or drop on Receipts (Recommended),Keep the e-invoice number,WhatsApp" |
| RECEIPTS-W44 | "Show them (Recommended)" |
| RECEIPTS-W44b, built (names W44-SELF as done) | "Approve (Recommended)" |
| RECEIPTS-W45 | "this is an isletme faturasi" |
| RECEIPTS-W45b | "Both" |
| RECEIPTS-W45c, the pick | "A · Letterhead" |
| RECEIPTS-W45d, built (names W45c-SELF as done) | "Approve (Recommended)" |

The founder's W9 clause stands for the whole page: each region reads on its own and is clearly divided from the next.

### How four answers were read

- **W39, box edges kept by inference.** On the built result the founder answered with a new ask, not a choice. The W39b question said the box edges stay as built unless its last option was picked. It was not, so they stay.
- **W41, three fixes and "None, list only".** The answer ticked both, which contradict. W41b asked again; "Fix 3, list the rest (Recommended)" settled it.
- **W42, "Record only for now" beside the three ways.** Read as: record all three now, and build each on its own branch. That is what the question said.
- **W45b, "Both".** Read as §14 reads it: the house issued the paper, and it is a service with no goods.

### Built as approved

The sheet (the formatted document, `components/documents`):

- W1: embedded on Receipts, the original pane stacks below the sheet, so the sheet is readable at desktop.
- W5: the tie-out uses the printed VAT breakdown when the tax figure is missing. Six of eight Sim invoices now add up. The stored verdicts were left as they are.
- W8-B and W15: when the line's year and the remembered item's year differ, a note says so beside the shelf tick. It stays after the link is made.
- W8-C and W11: "Bring the original" shows only when there is a link to bring. The gateway's reason is the sentence, with "Try again" when it may pass. The closed original sits in a box labelled THE ORIGINAL.
- W26: a document nothing was compared with says "not compared" once.
- W41: the order number is shown; the VAT sentence says what was read and what was not; Billed carries its unit when it equals the printed quantity.
- W45c: the sheet is framed as a letterhead, with the Mudavym mark at top right (24px, in a `paper` tone that stays dark on the light sheet).

The review card ("Check and correct"):

- W2: the sheet comes first. The card keeps only its acts: no second money header and no paper pane. A correction, a pairing or a match refreshes the sheet.
- W4: the card reads the linked orders from the document's links, not from a column that does not exist.
- W6-A: the card shows the sheet's verdict, from the same request.
- W9: a filed currency with nothing held folds to one line; "Change the currency" opens it.
- W10: five named parts, divided by a rule: THE READING, THE ORDER, THE MONEY, THE LINES, CONFIRM. "Check line pairing" sits in THE ORDER.
- W18: the swipe waits until the lines are read, and says so. The pairing button gives its reason.
- W21: the swipe lands the house seal, the track stays at full strength, and after 400ms a seal line breathes under "Confirming…". The label never says "Verified".

The list and the URL:

- W3: below 1536px an open document takes the full width, with "← All receipts". The open document is in the URL as `?doc=` (ADR 0160).
- W7: each listed row's verdict is recomputed on read, as the sheet does it. Nothing is written; a failed read keeps the stored verdicts.
- W8-A: each row leads with its vendor.
- W19: a `?doc=` this house does not hold says so, with "Show the queue".
- W20: `?credit=` opens that claim on the Credits tab; one not in the ledger says so.
- W44: papers that read cleanly are listed after those that need a look, under "Read cleanly · not yet confirmed", counted on their own. The house's own papers are left out.

Words:

- W6-B: unit words, singular only at exactly 1. W6-C: "read automatically", "file fingerprint", the jurisdiction only when set. W6-D: "Order line", and the match method as a sentence.
- W22: the year once; "per 12 bottles"; no bare code 7161; "A PDF".
- W23: "Open this document on its own page →"; the reading in sentences; the order sentence; "Turkish lira (TRY)".
- W24, W28, W29: "Reading the queue…", not "Reaching the gateway…". A failure says, per item, that no answer came back, that it was refused with no reason, or the server's own sentence. "Mudavym", not "gateway". No "ceremony". The header says "not read" when a read fails.
- W25: ₺ for lira; a code stays where no one-character sign exists. W27: the list says "adds up", as the card does.
- W33: the Confirm dialog no longer prints a field's internal key.
- W37 and W38: no database ids; "the item", not "the wine"; "94% sure of the match"; "24 counted", "quantity 2"; an order with no number says so.
- W44-SELF: every paper type in the sheet's own words ("Delivery note", not "delivery_note").

Keyboard, overlays and contrast:

- W12: opening the currency moves focus to the picker; keeping it moves focus back.
- W30: the "where it came from" popover is a disclosure. Focus inside keeps it open, Escape returns to the field, and a mouse can cross to it.
- W31 and W32: both field dialogs are the house `Panel` (ADR 0112). Tab is held, the page's scroll is locked, Escape works from anywhere, focus returns to the field, and Confirm starts on Cancel.
- W39: edit-box edges at 3.6 : 1, from 1.1–1.3 : 1.
- W40: a "Skip to the review card" link. Enter on it, then 15 Tabs, reach the swipe; it took about 94.

Phone width:

- W34: the open document fits a 375px screen; the Correct dialog is centred.
- W35: below 640px both line tables stack each row. Print keeps the table.
- W36: the "where it came from" box moves and narrows to stay inside its scroll box, on every screen.
- W45c-SELF: the document number never breaks.

Done, not built: Sim Meyhouse's data terms were accepted, once per account (W0, W17, ADR 0207). Four writes were pressed live on synthetic invoices (W13). The wrong-year link was left (W16), and so were two confirms the founder made (ALERT).

### Decided, not built on this branch

Each is built later, on its own branch.

- **W42, how an invoice finds its delivery.** Three ways, all decided: match on a despatch number we already hold from the same vendor; ask a person to pick the delivery when nothing matches; remember a vendor's numbers once a person links one. Today an invoice joins an order only when its printed order number equals ours exactly; the despatch reference is shown but never used; nothing links by hand. (proposed) Build the person's pick before the memory, since the memory learns from the picks.
- **W43, how a paper comes in.** Paste or drop on Receipts. Keep the e-invoice number, so the same invoice arriving twice is kept once and a photo is marked as a copy. WhatsApp. "Pictures in email text" was offered and not picked; it stays a gap. Today there is no paste or drop, the e-invoice number is kept nowhere, and duplicates are caught by file hash only.
- **W45, papers the house issues.** They need to be recognised and given their own place, not the vendor queue. A running-cost or service invoice with no goods needs its own kind, with no delivery or order to match. Today the reader does not detect direction, so a house with no tax number on file could be filed as its own provisional vendor. (proposed) The direction check runs before the vendor step.

### Shared work, queued, not built here

- The `--line-control` colour token (W39, SHARED): light `#8F8674`, dark `#736B61`. Until it lands, this page's control edges differ from other pages'. Shared-queue row (filed 2026-10-02; it was missing when §14's W39 row first said it was queued).
- `Panel` does not bring back focus that something else moved out (W32, `components/mudavym/Sheet.tsx:834`). Shared-queue row.
- A fresh browser writes guidance defaults over the account before reading it (P6, `contexts/GuidanceProvider.tsx`). Shared-queue row.
- "Receipts & Credits" names the page for staff, who have no Credits tab (P5). Shared-queue row.
- A repeating motion token for the swipe's wait sign (W21): `lib/mudavym/motion.ts` has none, so the page writes its own 1.6s pulse. Shared-queue row; the founder approved W21, not the token.
- "gateway" and raw client text on other pages: /receipts is done for both (W24, W28, W29), recorded on R5's and R1b's rows.

## Open

Deferred forks, as §14 writes them. None is in `OPEN-DECISIONS.md` yet; this ADR does not file them.

- **OD-TBD-R3-1** (W2): "Lines still appear twice (read vs edit)".
- **OD-TBD-R3-2** (W4): "No route links a document to an order after intake (`link()` is called only from intake, `document-intake.service.ts:1369,2072`) while the card says "pair it"". W23 has since changed the card's sentence. (proposed) W42's "Ask a person" may answer part of this; the founder has not said so.
- **OD-TBD-R3-3** (W14): "which engine checks a person sees, and in which words".

## Consequences

- Easier: the list, the card and the sheet give one verdict for a document. A paper that read cleanly now reaches a person's swipe. The card reads as five named parts. The page fits a phone, and a keyboard reaches the swipe through a skip link and 15 Tabs.
- Also on Documents & Reports and in print: the sheet's parts are shared, so W11, W15, W22, W26, W30–W33, W35, W36, W41 and W45c also change `/documents/:id`. W39's edge reaches its correction form. W45c's letterhead also prints. W35 changes the screen only: print keeps the table.
- Given up: rewriting the stored verdicts (W5); unlinking the wrong-year item (W16); hand-picked engine reasons until OD-TBD-R3-3 is answered (W14); pictures inside an email's text (W43); the page's own dialog helper (W31).
- Left open, recorded elsewhere:
  - The three OD-TBD forks above.
  - W42, W43 and W45, each on its own branch.
  - In `tech-debt.d/2026-10-02-fix-review-receipts.md`: W41's (a), (d), (e), (f); the order name read from `wineName` (W37); the stored verdicts left as they were (W5); the deposit counted twice and the 360 check it brings back on papers read before line kinds existed (W14); about twelve earlier test papers now under "Read cleanly" (W44); the sheet going pale under a stray "Dark" (P8).
  - The shared-queue rows above.
- Revisit when: the founder answers an OD-TBD fork; a W42, W43 or W45 branch lands; or the `--line-control` token lands in the house colours.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-02 | — | Created, session R3, branch fix/review-receipts (rulings of 2026-10-01) |
