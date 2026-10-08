<!-- Redrafted 2026-10-07 23:25Z (date -u read 23:24:55Z) for branch fix/a-guessed-order-does-not-link-the-paper at 0ce4efaf6 (commits 7af3623ef, 170497d53, 0ce4efaf6), base a323cc80b. origin/main is now b30ca260e (#612, #653). Not merged in. Those two commits touch no file in this lane, only two other claims.d fragments. Supersedes the 7af3623ef draft, which described option (i) alone. -->

**[2026-10-08T00:11Z, coordinator] Head `64a7e675888934125f1ad85523a464c0f4877b48`**: merges origin/main `62f8967b4` into `25bfd5428` (no lane file changed by the merge). Re-run here: lane spec + `vendor-doors-are-sealed.spec.ts` **57 passed**; gateway `tsc` shows only the known `@simplewebauthn/server` error; `lanecheck.sh` six guards exit 0, files=6, ownership `[]`; decision claims **943 checked, 943 holding**. The counts below (929/929) were measured at 25bfd5428 on the old base.

**[2026-10-07T23:58Z, coordinator] Head `25bfd5428c6b92294c24ad0bcedc77a767cb421b`** (one new commit on 0ce4efaf6, which is not amended; base still a323cc80b; 6 files vs origin/main). It answers the independent verifier's findings at 0ce4efaf6. No behaviour changes.
- **Narrowed:** the earliest outbound row with no `in_reply_to` is a row the house sent first: a staged letter, or a manual reply or deal confirmation sent with nothing on its order to answer and stored after the send. Changed in the bridge comment, the lane spec header, the CLAIMS text and below.
- **H3 writers:** `confirmDeal` is added to every list, and the count is now five writers.
- **Visible consequence:** the list is now complete.
- **Trigger:** it is `BEFORE INSERT OR UPDATE` and fills `thread_key` only when blank.
- **Citations:** stale ones are fixed, and the CLAIMS text now says merge-base a323cc80b.
- **Registered:** H3 and old-thread-new-order are filed as OPEN, and the ruling is recorded, in `.planning/tech-debt.d/2026-10-07-fix-a-guessed-order-does-not-link-the-paper.md`.
- **CLAIMS verify hardened** against a renamed wrapper (see the CLAIMS row below).
- **Corrections** to the 0ce4efaf6 and 170497d53 commit bodies are the bracketed [CORRECTED] notes below.

Evidence at this head:
- lane spec 17/17 and `vendor-doors-are-sealed.spec.ts` 40/40;
- `tsc` shows only the 2 known `@simplewebauthn/server` errors;
- `eslint --max-warnings 0` on the two touched TS files exits 0;
- `scripts/check_decision_claims.sh`: **929 checked, 929 holding**, PASS;
- `check_od_ids_exist.py`: PASS.

The full gateway suite was **not** re-run at this head. Only comments changed in TS (checked: no non-comment TS line differs from 0ce4efaf6), and the 11278-pass figure below is carried from the 0ce4efaf6 draft, not re-measured.

## What was wrong (verified at merge-base a323cc80b)

`RabbitMqBridgeService.handleInboundEmail` matches a vendor reply to an order in two ways.
- **Step 2** looks up the reply's `gmail_thread_id` in `procurement_conversations`.
- **Step 2b** is the fallback (`rabbitmq-bridge.service.ts:786-815` on main). When step 2 finds no order, it takes the provider's newest `procurement_orders` row whose status is not terminal. Its comment says why: a vendor who replies in a fresh thread should still reach the open negotiation.

Main passed that same `orderId` to `persistAttachments` (main `:885-891`), which writes `conversation_attachments.order_id`. From there:
- `DocumentIntakeService.sweepUningestedAttachments` hands that column to `ingest` (`document-intake.service.ts:2146`).
- `linkAndMatch` files a document that arrives with an order as `link_method 'manual'`, `confidence 1`, and skips `autoLink`'s PO-number check (`:1369-1371`).

So an invoice attached to a fresh-thread reply was filed against whichever order of that vendor was open. That order also supplied the document's currency when the invoice stated none (`:664`, `:832-846`).

**Why 7af3623ef was not enough.** 7af kept the guess off the attachment for the message that triggered the fallback. Its step-2 read was `.eq("gmail_thread_id", …).limit(1)`, with no order and any direction. The guess still lands in the thread in these ways:
- Step 4 stores the inbound row with it.
- The responder's draft copies it onto rows with the same `gmail_thread_id`: `inbound-responder.service.ts:548-575`. The draft is then approved (`procurement.service.ts:7953-7961`) or auto-sent (`:8628-8637`).
- A staff reply copies it: `requestDraftSend` (`:7639-7660`) or `manualReply` (`:8916-8940`).
- A deal confirmation copies it: `confirmDeal`.

When message 2 arrives in that thread, the unordered read can return any of those rows, and the invoice on message 2 is filed manual/1 against the guess. That is the verifier's reproduction.

**Can the fallback cross houses?** No change from the earlier analysis.
- The fallback filters only `provider_id`.
- Provider rows are per house (`uq_providers_restaurant_email`, baseline `:11915`; ADR 0221).
- `createOrder` (`procurement.service.ts:958`) and recurring orders (`recurring-orders.service.ts:673`) refuse a provider row from another house.

Two gaps remain:
- I did not audit every writer of `procurement_orders`.
- The legacy Gmail path's provider lookup, `ilike(contact_email).limit(1)` with no house filter (`rabbitmq-bridge.service.ts:668-678`), can pick either house's row when one address serves two houses.

## The rule (final)

**Step 2** (`rabbitmq-bridge.service.ts:798-824`, its comment at `:768-797`) reads the thread's **earliest** row:
- filter `.eq("gmail_thread_id", …)`;
- order by `created_at` ascending, then `id` ascending;
- `.limit(1)`.

From that row (`origin`), the step sets two variables:
- **`threadOrderId`** takes `origin.order_id` only when `String(origin.direction).toLowerCase() === "outbound"` and `!origin.email_headers?.in_reply_to`. In every other case it is `null`. Only this value goes to `persistAttachments` (`:939-945`).
- **`orderId`** takes `origin.order_id`. When that is null, 2b still guesses. `orderId` still goes to the inbound conversation row (`:885`), the notice (`:965`), `emitConversationUpdated` (`:969`) and the responder. The decided 2b text continuity is unchanged.

**Why the earliest outbound non-reply row is a row the house sent first.** [CORRECTED 2026-10-07T23:52Z: this paragraph and the bridge comment said that row is always the staged letter. It is not. The 0ce4efaf6 commit subject ("only through the letter that opened it") and body ("That is an order letter") say the same and are left as written, since the commit is not amended; this paragraph is the correction.] Two kinds of row can be it:
- **A staged row.** An order letter is staged through `stage_order_letter` (`20261221093000:150-231`) with `email_headers '{}'` and no `gmail_thread_id`; a staff letter held for release (`requestDraftSend` with no inbound to answer) is stored the same way. Each gets its thread id only when it is sent (`approveDraft :7959`, auto-send `:8636`). So it predates every vendor row in the thread it opens, and a house-opened thread still names its order.
- **A reply or confirmation sent first and then stored.** `manualReply` (`procurement.service.ts:8885-8940`) and `confirmDeal` (`:9736-9827`) read the latest inbound row on their order. When there is none, they send with no thread id and no `In-Reply-To`, and the row is inserted afterwards with the thread id the send returned and no `in_reply_to`. That row names its order, which is the order the staff sent on. Nothing makes the insert land before a vendor reply into that thread is stored; in practice the round trip orders them.

**Why the other rows cannot be the origin.** In a vendor-opened thread, the origin is the vendor's own inbound row, and inbound never names an order. Every row that copies the guess in comes later, so none of them can be the origin. That covers the responder draft (scheduled, pending, auto-sent or sent), a staff reply, and a deal confirmation.

**Why the `in_reply_to` condition.** Some replies open a new Gmail thread:
- the inbound-domain path has no Gmail thread;
- for a house-mailbox thread id, the shared sending mailbox may not own it.

Such a reply is that new thread's origin, and `in_reply_to` refuses it. The responder (`inbound-responder.service.ts:571`), `requestDraftSend` (`:7653`) and `manualReply` (`:8935`) already store `in_reply_to`.

**`confirmDeal` (`procurement.service.ts:9789-9827`)** now records `in_reply_to` and `references` in `email_headers`, using the headers it sent with, but **only when the row has a Gmail thread id**:
- With a thread id, `conversation_thread_key` returns `'gm:' || gmail_thread_id` first (baseline `:446-450`). The trigger runs `BEFORE INSERT OR UPDATE` (`:12174`) and fills `thread_key` only when it is blank (`:1671-1680`), so the key is `'gm:'` plus the id at insert and is not recomputed later. `/communications` grouping does not change. [CORRECTED 2026-10-07T23:52Z: this line said the trigger sets `thread_key` only at insert. The 170497d53 commit body says the same and is not amended; this line is the correction. The conclusion holds.]
- Without a thread id, the headers would move the row's `thread_key`, so they are left out. Such a row can never be a step-2 origin anyway.

This closes adversarial hole H2: a confirmation on a guessed order that opened a new thread would otherwise name the guess there.

**Determinism and case.** Rows written in one transaction share `created_at`, so ties break on `id`. Direction is compared in lower case because `stage_order_letter` accepts it in any case and there is no CHECK on the column.

## The decision

**Design B was decided by the coordinator under the founder's 2026-10-07 delegation. It is not the founder's pick.** The founder has not reviewed it. The ruling it rests on is also the coordinator's call:

> Approving or auto-sending a reply on a guessed order does **not** make the thread name that order.

This ruling is recorded in the commit bodies, here, and in `.planning/tech-debt.d/2026-10-07-fix-a-guessed-order-does-not-link-the-paper.md:28`. It is **not in an ADR**.

The design went through an adversarial pass. That pass found three holes:
- **H1: the verify could be bypassed.** Fixed.
- **H2: the confirmDeal residual.** Fixed by the conditional header above.
- **H3: the null-Message-ID residual is wider than first stated.** The wording is narrowed to name every writer: the responder, `requestDraftSend`, `manualReply`, regenerate and `confirmDeal`. The hole is not closed (see Not covered). [CORRECTED 2026-10-07T23:52Z: the earlier list left out `confirmDeal`, which after 170497d53 still writes no `in_reply_to` when the last inbound had no Message-ID (guard `letterGmailThreadId && inReplyTo`, `procurement.service.ts:9823`). The 0ce4efaf6 commit body's list ("The writers are the responder, requestDraftSend, manualReply and regenerate") has the same gap and is not amended.]

The pass also asked for an `id` tie-break and a lower-case direction compare. Both are done.

**A visible consequence.** [CORRECTED 2026-10-07T23:52Z: this paragraph listed only the first case below, as if it were the whole list.] An inbound attachment now carries an order **only** when the thread's earliest row is an outbound row with no `in_reply_to` and an order; every other attachment carries none (the CLAIMS verify pins that only `threadOrderId` reaches the attachment). Compared with main, which gave the attachment the step-2 row's order or the 2b guess, that removes the link in every case below. Some of those links were right, some were the guess:
- **Letters sent with no recorded `gmail_thread_id`**: the SMTP fallback, `SEND_UNCONFIRMED`, and the Python `/conversations/:id/approve` send (`provider_conversation_agent.py:3613-3630`). Step 2 finds no row, or only the vendor's own rows.
- **Inbound-domain webhook mail**, which has no Gmail thread (`gmail_thread_id: null`, `inbound-email.controller.ts:102`). Step 2 never runs.
- **Replies mirrored from a person's mailbox** (`house-inbox.service.ts:498`) whose thread id the shared mailbox never stored. Step 2 finds no row with that id.
- **Every thread the vendor opened**, for message 1 (7af3623ef's fix) and **from message 2 on** (the intended fix here). Its earliest row is the vendor's inbound row.
- **A thread opened by a reply that records `in_reply_to`**, even when the reply's order was the thread's real one.
- **A thread whose earliest row carries no order**, such as a letter on no order, even when a later row in it has one.

Invoices on these paths now go to `autoLink` (exact PO number only). The ruling intends this, and it is consistent with ADR 0103 A12 and ADR 0104 D15 rule 3. Today, a document left unlinked waits for W42 (ADR 0261:186, decided, not built).

**Rejected:**
- **Mark the guess in `email_headers` and skip marked rows.** Retention sets mirrored inbound rows' headers to `{}` (`raw-mail-retention.service.ts:779-786`). Six writers would have to stay in sync. Production rows carry no marker, so this needs a backfill, and a durable marker needs a migration.
- **Keep the guess off the inbound row's `order_id`.** This removes the decided 2b text continuity. Regenerate, `requestDraftSend`, `manualReply` and `confirmDeal` all find the thread through it.
- **Narrow the claim to the first message.** This leaves the verifier's message-2 case broken.
- **Pass the thread's order to intake as a hint and let the document's own PO number win.** This changes intake's decided manual/1 behaviour and the `link_method` CHECK (a migration). It is the founder's fork (see Not covered).
- **Filter step 2 to outbound rows, or to sent rows.** The responder's draft is an outbound `AUTO_SENT`/`SENT` row on the guess.
- **Skip `ai_generated` rows.** Order letters are `ai_generated`, so house-opened threads would stop linking.
- **Identify the letter by `outbound_email_type`.** This couples the bridge to the Python type vocabulary, and the bridge would stop linking without warning when a new type is added. `in_reply_to` is the semantic marker for "this row answered something".
- **Design B without `in_reply_to`.** A reply on the guess that opens a new thread would name the guess there.
- **Require `origin.provider_id === provider.id`.** Provider rows are per house and resolved by sender email. This needs its own look, and it does not bear on the defect.
- **Close H3 with a non-RFC marker** (`email_headers.answers_conversation_id`) on every reply writer. That is five writers (the responder, `requestDraftSend`, `manualReply`, regenerate and `confirmDeal`) in two gateway services, `InboundResponderService` and `ProcurementService`. [CORRECTED 2026-10-07T23:52Z: this said four writers; `confirmDeal` was left out.] The trigger case is a vendor MTA that stamps no Message-ID, which is rare. Rows already in production would still need a backfill. The wording is narrowed instead.
- **From 7af's draft:** (ii) a provenance-labelled proposal link. No reader acts on the label. (iii) Remove the fallback. It is decided. (iv) Make `autoLink` try the attachment's order. That turns a guess into a link.

## Reader census: `conversation_attachments.order_id`

These readers are unchanged from the 7af draft:
- `sweepUningestedAttachments` (`document-intake.service.ts:2096-2160`) passes the column to `ingest`.
- `getOrderAttachments` (`procurement.service.ts:10453-10463`) serves `GET /procurement/orders/:id/attachments`. Its web hook, `useDraftEmailQueries.ts:465`, has **no importer**.

Every other reader is keyed on `conversation_id`. The only writer is `persistAttachments` (`rabbitmq-bridge.service.ts:1008-1057`, insert at `:1039`).

## Tests and mutations

**Lane spec.** `a-guessed-order-does-not-link-the-paper.spec.ts` passes **17/17**. The bridge runs against a fake that keeps `procurement_conversations` as a table. It applies `eq`, `order` and `limit`, and it returns the **newest row first** when the query gives no order, so an unordered lookup fails rather than passing by luck.

New cases:
- message 2 of a fresh thread;
- the responder's draft on the guess, staged into the thread, in each of 4 statuses (`AUTO_SEND_SCHEDULED`, `PENDING_APPROVAL`, `AUTO_SENT`, `SENT`);
- a staff reply and a deal confirmation copied into the thread;
- a reply on the guess that opened a new thread (the text still joins the guess);
- a confirmation that opened a new thread, as `confirmDeal` now records it;
- a house-opened thread, where later invoices carry the letter's order past the responder's own draft;
- a letter stored with an upper-case direction.

All 4 cases from 7af and all 3 intake cases are kept.

**Against the old bridges** (files swapped in from a `cp -p` snapshot, then restored):
- With **7af3623ef's bridge, 8 cases fail**: message 2, all 4 responder statuses, staff plus confirmation, reply-opened thread, and confirmation-opened thread.
- With **main's bridge, 10 cases fail**.
- The house-opened and upper-case cases pass on both by design. They guard against regressions, and the mutants below turn them red.

**Behavioural mutants** (failing cases per mutant):

| Mutant | Cases red |
|---|---|
| upper-case compare | 1 |
| descending order | 2 |
| direction check dropped | 6 |
| fallback dropped | 7 |
| `in_reply_to` check dropped | 2 |
| `.order` dropped | 2 |
| `orderId` passed to `persistAttachments` | 10 |
| read the last row instead of the first | 0, survives |

The last-row mutant survives because `limit(1)` makes it equivalent. The static verify catches it.

**`vendor-doors-are-sealed.spec.ts`** passes **40/40** with two new cases:
- a confirmation row with a Gmail thread id records `subject`, `in_reply_to` and `references`;
- a row with none records `{subject}` only.

The subject-only mutant and the unconditional-header mutant each fail 1 case. The first commit alone (`170497d53`, with 7af's bridge and spec) passes 47/47.

**Full gateway suite.** 11278 passed, 0 failed, 14 skipped. 9 suites fail to load because `@simplewebauthn/server` is not installed in this worktree (passkeys and auth suites, unrelated). `eslint` on the 4 TS files gives 0 errors. The bridge and the lane spec have 0 warnings. `procurement.service.ts` (306) and `vendor-doors-are-sealed.spec.ts` (114) have the same warning counts as at HEAD. `tsc` shows only the same pre-existing `passkeys.service.ts` error.

**CLAIMS row** `.planning/decisions/claims.d/fix-a-guessed-order-does-not-link-the-paper.jsonl:1` (static python, status `resolved`). The verify strips comments outside string literals, then checks:
- the step-2 block, verbatim, once;
- exactly 3 code tokens of `threadOrderId`, which catches `??=`, `||=`, `&&=`, destructuring and array writes;
- 8 tokens of `origin` and 2 of `thread`;
- `persistAttachments` named once, string forms included, and called once with `(inserted.id, threadOrderId, …)`;
- no `conversation_attachments` inside `handleInboundEmail`;
- the inbound insert with `order_id: orderId`, and the fallback assignment;
- the body of `persistAttachments`;
- the three `confirmDeal` statements;
- 9 lane-spec and 2 vendor-doors case names;
- **added at 25bfd5428:** `handleInboundEmail`'s `this.persist…` calls are exactly `this.persistProspectAttachments` then `this.persistAttachments`, with no bracket access on `this`. In the whole bridge file, `persistAttachments` is declared and called once (strings included, the two `persistAttachments:` log prefixes excepted), and `conversation_attachments` is named once.

Results, run with `bash -c` from the row:
- **exit 0** on the branch and on 4 harmless edits (a trailing `//` comment, a block comment, a URL in a template literal, a URL in a string);
- **exit 1** on 7af3623ef's bridge, on main's bridge, and on each of **26 static mutants**. These include H1's shadowed `origin`, `.bind`, bracket call and direct `conversation_attachments` update, plus the `??=`/`||=`/`&&=` family;
- a **missing file** gives a Traceback naming "No such file or directory", which counts as cannot-run.

**Re-measured at 25bfd5428** (2026-10-07T23:58Z). Mutants were written to scratch and passed to the verify by path, so no worktree file was mutated:
- **exit 0** on the branch and the same 4 harmless edits;
- **exit 1** on 7af3623ef's and main's bridge;
- **exit 1** on 10 earlier-style mutants rebuilt from the branch: `orderId` passed, `??=`, the direction check dropped, the `in_reply_to` check dropped, descending order, `.order` dropped, an extra bracket call, an extra `.bind` call, a direct `conversation_attachments` update, and reading the last row;
- **exit 1** on 9 wrapper mutants: `persistAttachmentsAll` beside the pinned call (the verifier's case), and the same wrapper instead of it; a wrapper with another name that delegates, and one that writes `conversation_attachments` itself; and `(this as any)[…]`, `this[…]`, `self = this`, arrow-property and `${…}`-interpolated calls. The previous verify passed 8 of the 9 (all but the one that replaces the pinned call).

Residual: a wrapper in **another file** that writes `conversation_attachments` is outside this verify.

`_claims_parse.py --fragments` accepts the row (rc 0). [2026-10-07T23:58Z] `scripts/check_decision_claims.sh` at 25bfd5428: 929 checked, 929 holding, PASS (also 929/929 at 0ce4efaf6 before the change).

## Not covered

- **H3 residual, open**, filed as `.planning/tech-debt.d/2026-10-07-fix-a-guessed-order-does-not-link-the-paper.md:1`. Some reply rows are stored with **no `in_reply_to`**:
  - a deal confirmation written before this change;
  - a reply to an inbound message that had no Message-ID: the responder (`inbound-responder.service.ts:571`), `requestDraftSend` (`procurement.service.ts:7653`), `manualReply` (`:8935`), regenerate through the responder (`procurement.service.ts:774`), and `confirmDeal` (`:9823`), whose guard `letterGmailThreadId && inReplyTo` leaves the headers out when there is no Message-ID.

  If such a row opens a **new** Gmail thread, it still names its order there. This needs the inbound-domain path or a house-mailbox thread id the shared mailbox does not own.
- **Old thread, new order**, filed as `.planning/tech-debt.d/2026-10-07-fix-a-guessed-order-does-not-link-the-paper.md:18`. A house-opened thread for order X still files a later invoice for order Y as manual/1 against X, the same as on main. The fix is design E: a hint plus a `link_method` CHECK change (`procurement_document_links_method_check`, baseline `:4418`), which needs a migration. That is a founder fork, and it is not filed in OPEN-DECISIONS by this lane.
- **Gmail grouping.** Gmail can group a vendor's new message into a house thread by subject, and a different vendor can write into a house thread. Both behave as on main.
- **`confidence_score`** is still `1.0` whenever `orderId` is set (`rabbitmq-bridge.service.ts:907`), including guessed and inherited rows. No production reader renders it. Separate change.
- **The Python `EmailParsingAgent`** has the same unordered thread lookup (`email_parsing_agent.py:300-360`). It is probably dead because `self.db` is never assigned. Not run, not verified.
- **Gmail's behaviour for a thread id the sending mailbox does not own** is unverified offline. H2 and part of H3 depend on it.
- **Two edge cases:**
  - a legacy letter with a null `created_at` loses its link (PostgREST ascending sorts NULL last);
  - `email_headers` stored as a JSON **string**, as the Python approve send writes it, is read as having no `in_reply_to`, so a reply stored that way would name its order like a letter. [CORRECTED 2026-10-07T23:52Z: this was listed as a way a letter loses its link; it is the opposite.] The approve send never sets the `gmail_thread_id` column, so this does not arise from that path today.
- **Existing rows are untouched.** Attachments already written with a guess, and links already filed from them, stay as they are. Cleaning them up needs production reads and writes, which need the founder's yes.
- **No live drive.** The bridge ran only against the spec's fake client, with no RabbitMQ, gateway or database.
- **The lane log** (`fixes/README.md`) line for this ruling is left to the coordinator, who edits that file concurrently. The ruling is in both commit bodies, in this body and in the tech-debt fragment.
- **Not done here:** no push, no merge of origin/main (now `b30ca260e`), and no re-run of the full gateway suite at 25bfd5428.

## Seen, not changed (separate operations)

- `confidence_score: 1.0` on fallback rows (above).
- The legacy-path provider lookup with no house filter (above).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
