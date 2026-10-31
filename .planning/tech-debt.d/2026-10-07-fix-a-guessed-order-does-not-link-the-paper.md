## A reply stored with no `in_reply_to` that opens a new Gmail thread still names its order there — OPEN — 2026-10-07

Found by the adversarial pass on `fix/a-guessed-order-does-not-link-the-paper` (hole H3).

**What.** The mail bridge lets a Gmail thread name an order only when the thread's earliest row is outbound and has no `email_headers.in_reply_to` (`apps/api-gateway/src/common/orchestrator/rabbitmq-bridge.service.ts:798-846`, the test at `:838-842`). A reply that has no `in_reply_to` passes that test. These writers store a reply with no `in_reply_to` when the inbound message they answer had no Message-ID:
- the responder, `inbound-responder.service.ts:571`;
- `requestDraftSend`, `procurement.service.ts:7653`;
- `manualReply`, `procurement.service.ts:8935`;
- regenerate, through the responder (`procurement.service.ts:774`);
- `confirmDeal`, `procurement.service.ts:9823`. It writes the headers only under `letterGmailThreadId && inReplyTo`, so with no Message-ID it stores `{subject}` only.

Deal confirmation rows written before this branch also store `{subject}` only.

**Consequence.** If such a reply opens a new Gmail thread, it is that thread's earliest row, and every invoice the vendor sends into the thread is filed against the reply's order as `link_method` manual, confidence 1 (`document-intake.service.ts:1370`). That order can be the bridge's 2b guess. A reply opens a new thread when the inbound came by the inbound-domain path (no Gmail thread), or, possibly, when it carries a house-mailbox thread id the shared sending mailbox does not own. What Gmail does in that second case was not verified offline. The trigger also needs a vendor mail server that stamps no Message-ID.

**Fix shape, not chosen.** A non-RFC marker (for example `email_headers.answers_conversation_id`) on every reply writer above (five, in `InboundResponderService` and `ProcurementService`), plus a backfill of production rows. The branch narrowed its wording instead of building this.

## Old thread, new order: a later invoice for order Y in order X's thread is filed against X — OPEN — 2026-10-07

Found on `fix/a-guessed-order-does-not-link-the-paper`. Same as on main; the branch does not change it.

**What.** A thread the house opened with its letter for order X names X for every message in it (`rabbitmq-bridge.service.ts:798-846`). The attachment takes that order (`:963-969`), and `linkAndMatch` files a document that arrives with an order as `link_method` manual, confidence 1, without reading its PO number (`document-intake.service.ts:1363-1371`).

**Consequence.** An invoice for a different order Y that the vendor sends by replying in X's thread is linked to X.

**Fix shape (design E), the founder's fork.** Pass the thread's order to intake as a hint and let the document's own PO number win. Recording that link needs a new `link_method` value, which `procurement_document_links_method_check` forbids today (`supabase/migrations/20260805000000_baseline_from_production.sql:4418`), so it needs a migration. ~~Not filed in `OPEN-DECISIONS.md` by this branch.~~ [CORRECTED 2026-10-08: filed as OD-225 in `OPEN-DECISIONS.md`, in the section appended for this branch; see [ADR 0318](../decisions/0318-a-guessed-order-does-not-name-the-thread-or-link-the-paper.md).]

## Ruling on this branch: a reply on a guessed order does not make the thread name that order — RECORDED (coordinator; in [ADR 0318](../decisions/0318-a-guessed-order-does-not-name-the-thread-or-link-the-paper.md) since 2026-10-08) — 2026-10-07

Approving or auto-sending a reply on a guessed order does not make the thread name that order. The coordinator decided this under the founder's 2026-10-07T20:04:10Z delegation. It is not the founder's pick. ~~It is not in an ADR.~~ [CORRECTED 2026-10-08: recorded as ruling 2 of [ADR 0318](../decisions/0318-a-guessed-order-does-not-name-the-thread-or-link-the-paper.md) (Proposed), with design B as ruling 1.]

The bridge holds to it in two ways (`rabbitmq-bridge.service.ts:798-846`). In a thread the vendor opened, a reply is stored after the vendor's own row, so it is never the thread's earliest row. A reply that opens a new thread is that thread's earliest row, and its `in_reply_to` refuses it. So in a thread the vendor opened, an invoice sent after the house replied on the guess carries no order, and intake links it only by an exact PO number (`autoLink`, `po_number` at 0.95). The first entry above is the known exception.

## A failed thread read stores the reply with no order, marked, and nothing reads the mark yet — OPEN — 2026-10-08

Found when CI's read-error guard (`scripts/check_read_errors_not_swallowed.py`) failed on #661 at `64a7e6758`: step 2's thread read discarded its error.

**What.** The read now binds it (`rabbitmq-bridge.service.ts:816-834`). On a failed read the bridge logs it, does not run the 2b fallback (`:856`), and stores the reply with `order_id` null, `thread_id` null, `confidence_score` null and `email_headers.order_match: "thread_read_failed"` (`:929`). The row still joins its thread in the house's view, which groups on `thread_key` (`conversations.service.ts:716-719`), set from `gmail_thread_id` by the insert trigger. Nothing reads `order_match` yet: no page shows it and no sweep re-links marked rows. Until a person links it, the reply joins no order, gets no responder draft, and its notice carries no order link. Any invoice on it reaches intake with no order, so only `autoLink` (exact PO number) can file it.

**Ruling.** Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation. It is not the founder's pick. ~~not in an ADR.~~ [CORRECTED 2026-10-08: recorded as ruling 3 of [ADR 0318](../decisions/0318-a-guessed-order-does-not-name-the-thread-or-link-the-paper.md) (Proposed).] Rejected:
- storing it unlinked with no mark: the row would read the same as a reply nothing matched;
- throwing into the outer catch, or returning early: either loses the mail. It is not redelivered, because the consumer acks before the handler settles (`rabbitmq-bridge.service.ts:368-383`) and the producers advance their cursors once the publish resolves (`house-inbox.service.ts:519-523`);
- letting 2b guess: the responder can stage `AUTO_SEND_SCHEDULED` on the order it is handed (`inbound-responder.service.ts:561`).

Claim: `FIX-2026-10-08-A-FAILED-THREAD-READ-DOES-NOT-BECOME-A-GUESS` in `claims.d/fix-a-guessed-order-does-not-link-the-paper.jsonl`.

**Fix shape, not chosen.** A sweep that re-runs step 2 for rows marked `thread_read_failed` and links them once the read answers, or a "needs linking" view that lists them.
