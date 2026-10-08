# 0318 — A guessed order does not name the thread or link the paper

- **Status:** Proposed. Rulings 1–3 below were decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, quoted verbatim below. They are the coordinator's calls, not the founder's picks. The founder can overrule any part. A lock is his. Section 4 records the 2b fallback as built; it decides nothing.
- **Date:** 2026-10-08
- **Decider:** the coordinator, under the delegation below. Built by lane mailguess on `fix/a-guessed-order-does-not-link-the-paper` (PR #661).
- **Keywords:** 2b fallback, guessed order, handleInboundEmail, threadOrderId, orderId, earliest row, in_reply_to, thread_read_failed, order_match, conversation_attachments.order_id, linkAndMatch, manual/1, autoLink, confirmDeal, design B, design E
- **Links:** PR #661; `.planning/tech-debt.d/2026-10-07-fix-a-guessed-order-does-not-link-the-paper.md`; CLAIMS rows `FIX-2026-10-07-A-GUESSED-ORDER-DOES-NOT-LINK-THE-PAPER` and `FIX-2026-10-08-A-FAILED-THREAD-READ-DOES-NOT-BECOME-A-GUESS` in `claims.d/fix-a-guessed-order-does-not-link-the-paper.jsonl`; [[0261-receipts-walk-through-r3-rulings]] W42 (`0261-receipts-walk-through-r3-rulings.md:186`); OD-225 (the design E fork, filed with this ADR); the ADR 0090 audit of PR #661 at `b240df31d` (report under `p4-scratch/sim-run/fixes/audits/661-b240df31d/`, outside the repo)

## Context

Cites are at PR #661's head unless marked.

`RabbitMqBridgeService.handleInboundEmail` matches a vendor's mail to an order in two steps. **Step 2** reads `procurement_conversations` by the message's `gmail_thread_id`. **Step 2b** is a fallback: when step 2 finds no order, it takes the newest `procurement_orders` row (by `requested_at`) on the sender's provider row whose status is not terminal (`apps/api-gateway/src/common/orchestrator/rabbitmq-bridge.service.ts:848-876`; on `origin/main` `:786-812`).

On main, the order step 2 or 2b produced also went to `persistAttachments`, which writes `conversation_attachments.order_id`. `DocumentIntakeService.linkAndMatch` files a document that arrives with an order as `link_method 'manual'`, confidence 1, and skips the PO-number check (`apps/api-gateway/src/procurement/documents/document-intake.service.ts:1369-1371`). So an invoice on a vendor's fresh-thread reply was filed against whichever of that vendor's orders was open. Main's step 2 also read any row in the thread, so a guess copied onto later rows (the inbound row, the responder's draft, a staff reply, a deal confirmation) passed to later messages in the same thread.

PR #661 fixes that. Its ADR 0090 audit at `b240df31d` held the code and blocked on compliance: three behavioural rulings lived only in the tech-debt fragment and the PR body, and the body called the 2b fallback "decided" when no record decides it. This ADR records them.

### The delegation (verbatim)

The founder, 2026-10-07T20:04:10Z: *"Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research."*

## Options considered

Designs A–E were named in the lane's research pass (workflow `wf_2456624f-fb4`, 2026-10-07) and refuted before the build.

1. **A — mark the guess in `email_headers` and skip marked rows (A1) or marked threads (A2) in step 2.** Rejected. Retention sets mirrored inbound rows' `email_headers` to `{}` (`raw-mail-retention.service.ts:779-786`), so the marker vanishes. A1 must keep six copying writers in sync. Production rows carry no marker, so it needs a backfill, and a durable marker needs a column, which is a migration.
2. **B — a thread names an order only through its earliest stored row, when that row is outbound and not a reply.** Chosen (ruling 1).
3. **C — keep the guess off the inbound row's `order_id`.** Rejected. Regenerate, `requestDraftSend`, `manualReply` and `confirmDeal` find the thread through the order's latest inbound row, so they would lose it. It does not fix the drafts either, because `approveDraft` picks by `order_id`.
4. **D — narrow the fix to a fresh thread's first message and file the rest as open.** Rejected. It leaves the reproduced case broken: an invoice on message 2 or later in a vendor-opened thread is still filed manual/1 against the guess.
5. **E — pass the thread's order to intake as a hint and let the document's own PO number win.** Not built, and not rejected on its merits. It changes intake's manual/1 behaviour, and recording the link needs a new `link_method` value that `procurement_document_links_method_check` forbids today (`supabase/migrations/20260805000000_baseline_from_production.sql:4418`), so it needs a migration. It is filed as **OD-225** for the founder.
6. **Also rejected inside B:** filtering step 2 to outbound or sent rows (the responder's draft becomes an outbound `AUTO_SENT`/`SENT` row on the guess); skipping `ai_generated` rows (order letters are `ai_generated`, so house-opened threads would stop linking); identifying the letter by `outbound_email_type` (couples the bridge to the Python type vocabulary, and stops linking without warning when a type is added); B without the `in_reply_to` condition (a reply on the guess that opens a new thread would name the guess there); requiring `origin.provider_id === provider.id` (needs its own look and does not bear on the defect).
7. **Doing nothing.** An invoice on a guessed order stays filed manual/1 against an order the vendor may never have meant.

## Decision

### 1. Design B (coordinator, under the delegation)

Step 2 reads the thread's **earliest** row: `.eq("gmail_thread_id", …)`, ordered by `created_at` then `id` ascending, `.limit(1)` (`rabbitmq-bridge.service.ts:816-846`). From it the bridge sets two values:

- **`threadOrderId`** is that row's `order_id` only when its direction, lower-cased, is `outbound` and it has no `email_headers.in_reply_to` (`:838-840`). Otherwise it is null. Only this value goes to `persistAttachments` (`:963-965`).
- **`orderId`** is that row's `order_id`; when that is null, 2b may still set it (section 4). It goes to the inbound row, the notice, `emitConversationUpdated` and the responder, as before.

`confirmDeal` now records `in_reply_to` and `references` in `email_headers` when its row has a Gmail thread id, so a confirmation that opens a new thread cannot become a thread's origin (`procurement.service.ts`, guard `letterGmailThreadId && inReplyTo`). The research pass had rejected storing `in_reply_to` on every `confirmDeal` row, because without a Gmail thread id it would move the row's `thread_key`; the condition keeps that case out.

**Why.** It needs no migration, no production reads or writes, and no marker that retention can erase. It keeps the 2b reply text going where it went. A row the house sent first predates every vendor row in the thread it opens, so a house-opened thread still names its order.

**What it gives up.** An attachment now carries an order only when the thread's earliest row is an outbound non-reply row with an order. Every other attachment carries none, including some links main made correctly: letters sent with no recorded `gmail_thread_id` (the SMTP fallback, `SEND_UNCONFIRMED`, the Python approve send), inbound-domain webhook mail, replies mirrored from a person's mailbox under a thread id the shared mailbox never stored, every vendor-opened thread, and a thread whose earliest row has no order. Those invoices go to `autoLink`, which links only on an exact PO number. A document left unlinked waits for W42 (ADR 0261, decided, not built).

### 2. A reply on a guessed order does not make the thread name that order (coordinator, under the delegation)

Approving or auto-sending a reply on a guessed order does not make the thread name that order. In a vendor-opened thread, the reply is stored after the vendor's own row, so it is never the earliest row. A reply that opens a new thread is that thread's earliest row, and its `in_reply_to` refuses it.

**Known exception (open, not closed here).** A reply stored with **no** `in_reply_to` that opens a new thread still names its order there. That happens when the inbound it answers had no Message-ID, through the responder (`inbound-responder.service.ts:571`), `requestDraftSend`, `manualReply`, regenerate, or `confirmDeal`, and for deal confirmations written before this branch. The fix shape (a non-RFC marker on all five writers plus a backfill) is not chosen; see the tech-debt fragment.

**The alternative not taken:** letting an approved or auto-sent reply make its (guessed) order the thread's order. The coordinator's reason, recorded here: an approval says the words may go; it does not check which order the vendor meant, and an auto-send has no person in it at all.

### 3. A failed thread read stores the reply with no order, and marks it (coordinator, under the delegation)

When step 2's read returns an error, the bridge logs it, does **not** run 2b (`:856`), and stores the reply with `order_id` null, `thread_id` null, `confidence_score` null and `email_headers.order_match: "thread_read_failed"` (`:929`). The row still joins its thread in the house's view, which groups on `thread_key`.

**Rejected:**
- storing it unlinked with no mark: the row would read the same as a reply nothing matched;
- throwing into the outer catch, or returning early: either loses the mail, which is not redelivered (the consumer acks before the handler settles, `rabbitmq-bridge.service.ts:368-383`; the producers advance their cursors once the publish resolves, `house-inbox.service.ts:519-523`);
- letting 2b guess: the responder can stage `AUTO_SEND_SCHEDULED` on the order it is handed (`inbound-responder.service.ts:561`).

**Residual.** Nothing reads `order_match` yet: no page shows it and no sweep re-links marked rows.

### 4. The 2b fallback, recorded as built — not previously decided

2b came in with commit `4de692709` (2026-07-09, *"fix(procurement): stop price changes from spawning duplicate orders"*). When step 2 finds no order, it takes the newest `procurement_orders` row (by `requested_at`) on the sender's provider row whose status is not terminal, and uses it as `orderId`. It filters on `provider_id` only; provider rows are per house (ADR 0221). The commit's reason: vendors often reply in a new thread or subject, the exact thread match missed, and the price change had nowhere to attach. The inbound row on a guessed order is written with `confidence_score` 1.0 (`:931`).

No ADR, no `PROJECT.md` key decision and no founder ruling records 2b. PR #661's body called it "decided", and that was wrong. This ADR records what it does; it decides nothing about it. This branch narrows it in two ways only: its guess no longer reaches the attachment (ruling 1), and it does not run after a failed thread read (ruling 3). Whether 2b should stay, and whether its row should say confidence 1.0, are open.

## Consequences

- An invoice is no longer filed manual/1 against an order the bridge guessed, in a fresh thread or later in it.
- Some correct links main made are gone (ruling 1's list); those invoices link only on an exact PO number until W42 is built.
- Two holes stay open and are disclosed: the null-`in_reply_to` reply that opens a new thread (ruling 2), and **old thread, new order** — an invoice for order Y sent in order X's house-opened thread is filed against X, the same as on main (OD-225).
- Revisit when: OD-225 is answered; the founder rules on 2b; a page or sweep starts reading `order_match`; or W42 lands.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-07 | lane mailguess research and refutation pass (`wf_2456624f-fb4`) | Design B chosen; A, C, D rejected; E left to the founder |
| 2026-10-08 | ADR 0090 audit of PR #661 at `b240df31d` | BLOCK: rulings not in an ADR, 2b called "decided", design E not in the register |
| 2026-10-08 | — | Created (Proposed) |
