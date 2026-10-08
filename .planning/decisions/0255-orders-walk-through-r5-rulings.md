# 0255 — Orders: the walk-through rulings of 2026-10-01 (R5)

- **Status:** Locked
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** orders, walk-through, draft rail, template blanks, send authority, house words, phone width, all beverages
- **Links:** [`06-pages/orders.md` §14](../06-pages/orders.md) (every item, its evidence and its test), [[0112-one-modal-policy-three-shapes-one-primitive]] (sheets), [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] (state in the URL), [[0175-one-tap-from-the-notification-is-staged]] ("Staff ask, manager sends" amendment), ADR 0254 (peer branch fix/order-patch-cannot-approve, not on main at writing), `p4-scratch/review-shared-queue.md` (DASH-W15, DASH-W16, R5 rows)

## Context

The founder walked `/orders` (OrdersNext, flag `mudavym_design_orders`) on 2026-10-01, on real houses, in session R5 on branch `fix/review-orders`. Ten passes (P1 purpose … P10 live) were run. Each finding was put to him as `ORD-W<n>`, with a sketch, and given Approve, Deny or Rework. Two items came from the dashboard walk-through (DASH-W15, DASH-W16, session R1b). One direction came from another session: on 2026-10-01 the founder told it that Mudavym will carry all beverages, then food, and that session relayed it. This ADR records the rulings. Their evidence lives in §14 of the page doc and is not repeated here.

## Options considered

For each item: build it as sketched (Approve), leave the page as it is (Deny), or change the proposal (Rework). Those rejected or reworked:

1. **ORD-W2, the "die, at rest" rehearsal card.** The options were (A) remove it or (B) replace it with one quiet line (sketch `ORD-W2.html`, after-A and after-B), or deny. The founder chose A. [corrected 2026-10-01: this line first listed three options the sketch never showed; the pr-audit of #578 caught it.]
2. **ORD-W7, unfilled template blanks.** The options were a UI-only refusal or the UI plus a gateway refusal. The founder chose "+ gateway". With a UI-only refusal, any other caller of the send routes could still mail `[Your Name]`.
   **Reworked the same day.** The #578 pr-audit found the premise wrong: the send already fills the signature blanks ([Your Name], [Manager Name], [Name], [Signature], [Manager]) with the house's sender name, and fills the greeting with the vendor's first name (`applyEmailPlaceholders`, `personalizeGreeting`). It also found that the automatic send sweep and the hand-written reply checked nothing. The founder then ruled "Only unfillable (Rec.)" and "Add sweep + manual (Rec.)". A blank is now refused only when it would still stand in the letter as sent; the gateway renders the letter the way the send does (`blanksAtSend`). Rejected: refusing every blank (it blocks letters that send correctly), and warning without refusing (an unfillable blank reaches the vendor). Rejected for the routes: narrowing the wording instead of checking the sweep and the hand-written reply.
3. **ORD-W8 add-on, "let AI draft for you".** The options were to build it with W8 or to park it. The founder parked it. `generate-ai-reply` has no who-may-send check, and it stages `AUTO_SEND_SCHEDULED` under full autonomy (`common/orchestrator/inbound-responder.service.ts:561`) [corrected 2026-10-01: was cited as :543]. The fix belongs in `common/`, which a page branch may not commit.
4. **ORD-W9, a hold for Discard.** Denied. Discard stays a plain link.
5. **P3 write controls.** The options were to press nothing live, or to press writes against a test order. The founder chose to press nothing live; the vitest suite covers the writes.

## Decision

The founder's words, verbatim, per item:

| Item | Ruling |
|---|---|
| ORD-W1 (DASH-W15) | "approved" (DASH-W15); ORD-W1: "Approve" |
| ORD-W2 | "A: remove it" |
| ORD-W3, W4, W5, W6 | "Approve" |
| ORD-W7 | "Approve + gateway (Recommended)" |
| ORD-W7 rework: what to refuse | "Only unfillable (Rec.)" |
| ORD-W7 rework: which routes | "Add sweep + manual (Rec.)" |
| ORD-W8 (DASH-W16a) | "approved + a let AI draft for you button or similar"; then, on the AI fork: "W8 now, park AI (Rec.)" |
| ORD-W9 (DASH-W16b) | "Deny" |
| ORD-W10, W11 (DASH-W16c, d) | "Approve" |
| ORD-W12 – W20 | "Approve" |
| P3, write controls pressed live | "None (Recommended)" |

These were built as approved:

- The draft card serves the order that is open. W8 marks the open order's card, W10 lets its words be edited, and W11 opens the vendor's answers from it.
- A `[Bracketed Blank]` the send cannot fill is refused by six procurement routes (W7, reworked): the seal, a staff request, approveDraft, the automatic send sweep (it holds the letter unsent and tells the house), and the hand-written reply's seal and send. Senders outside procurement are not checked: the communications service's house letters, the relay, and `confirmDeal`, whose words are built in code (tech-debt). A hand-written reply's send fills nothing, so every blank there is refused. The card shows what the send will fill, and with what. The check only sees one to four Capitalised ASCII words in brackets: see the tech-debt fragment for what it misses and what it wrongly refuses. [corrected 2026-10-08, PR #672: when the sender name is empty, the check also refuses a signature blank in any spelling the signature pattern (`SIGNATURE_SLOT_SOURCE`) matches, such as `[your name]`, because the send would erase it to an empty signature. The two hand-written-reply routes always send with no sender name, so there every such spelling is refused. Other blanks are still seen only in the one Capitalised shape.]
- The page says only what it knows:
  - W4: the vendor name is read from the order.
  - W15: a failed re-read is no longer called "unknown" over rows that are still drawn.
  - W16: staff are no longer told a send waits on their approval.
- The page uses the house's words, not the engineer's:
  - W13: "Close", unless there is still a decision to leave open.
  - W14: grouped money.
  - W17: "the order book" and "Mudavym" instead of "gateway"; "vendor"; counts in words.
  - W20: words that hold for any item, not only wine.
- It fits the reader's screen:
  - W1 and W6: the 1024px squeeze.
  - W3: names wrap.
  - W12: the sheet has an inset.
  - W18: the station strip fits a phone.
  - W19: the discard target is 24px.
- State lives in the URL (W5, ADR 0160).

## Consequences

- Easier: the open order's letter, its words and its answers sit together on one card. A letter with a blank the send cannot fill is refused by the six procurement routes that seal, ask for, approve, auto-send or hand-write an order letter to a vendor: issueDraftSendSeal, requestDraftSend, approveDraft, processScheduledAutoSends, issueManualReplySeal and manualReply. Other senders are not checked: the communications service's house letters, the relay and `confirmDeal`, whose words are built in code. Blanks the send fills itself are shown on the card with their values. [corrected 2026-10-01: this line first said every route that sends a house letter, which the second #578 pr-audit refuted.]
- Given up: the rehearsal die (W2). Discard keeps no hold (W9).
- Left open, recorded elsewhere:
  - OD-TBD (filed from this branch): may staff discard or rewrite a letter they may not send?
  - The AI-draft button, parked on an authority check in `common/`.
  - "gateway" on 17 other pages, in the shared queue.
  - The 50-order list cap, and the senders outside procurement that do not check for blanks, in tech-debt. [corrected 2026-10-01: this line first listed `issueManualReplySeal` as unchecked; the W7 rework made it refuse blanks.]
- Revisit when: the AI-draft authority check lands in `common/` (unparks W8's add-on), or the founder answers the OD.

## Addendum 2026-10-08 — the PR #672 follow-ups, and three forks left open

PR #672 (fix/orders-send-blank-followups) built follow-ups 1-4 of the #578 pr-audit (`.planning/07-reference/pr-audits/578-a2275b4.md`, "Owed follow-ups"; that file is on PR #663, unmerged on 2026-10-08):

- `blanksAtSend` refuses a signature blank in any spelling `SIGNATURE_SLOT_SOURCE` matches when the sender name is empty (bracket on the W7 bullet above).
- `approveDraft` reads the sender name once and checks and sends that one value (`procurement.service.ts:7784-7786`, `:7899`).
- `getPendingDraft` compares the vendor's `providers.restaurant_id` with the house (`:10012`).

Three forks came out of that work. Each is built one way, the most conservative reading the fixer found. **None is decided: each is open, pending the coordinator's ruling.**

1. **A vendor of another house on the draft read.** Built: `getPendingDraft` reads the draft as having no vendor (`:10012-10015`). The card still loads and gets no vendor name, address or first name. If the letter has a greeting blank such as `[Provider First Name]`, `at_send` reports it as unfillable; a letter without one is unaffected by the missing first name. The alternative is to refuse the whole read, as `approveDraft` refuses the send (`:7821`, 403). Open, pending the coordinator's ruling.
2. **What a refused signature blank says.** Built: the refusal reuses `unfilledSlotsRefusal`'s existing sentence, quoting the blank as written ("…did not fill: [your name]. Nothing was sent."). It does not say that the house has no sender name, or where one is set. Open, pending the coordinator's ruling.
3. **A vendor with no house (`providers.restaurant_id` null).** Built: `getPendingDraft` treats it as another house's vendor. That agrees with the seal (`:7427`) and `approveDraft` (`:7821`), which also compare with a strict `!==` and so refuse a null house. Among the routes that compare at all, only `manualReply` (`:8875`) lets a null house through. `confirmDeal` (`:9534`) does too, but it is not one of the six W7 routes. `requestDraftSend`, the sweep and `issueManualReplySeal` do not compare at all: filed as OD-TBD of 2026-10-08 in `OPEN-DECISIONS.md` ("filed 2026-10-08 from fix/orders-send-blank-followups"), CLAIMS `ORD-2026-10-08-DRAFT-VENDOR-HOUSE-UNCHECKED`. The fork: should `manualReply` refuse a null house too, or should a null house be allowed everywhere? Open, pending the coordinator's ruling.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created, session R5, branch fix/review-orders |
| 2026-10-08 | PR #672 (fix/orders-send-blank-followups) | Brackets on W7 (line 45); addendum recording three open forks |
