## A credit memo the vendor sent unasked could not settle its claim — CLOSED on `fix/settle-an-unasked-memo` — 2026-10-08

F-159 (owner-quarter sim, `p4-scratch/sim-findings-share-out-2026-10-02.md:198`).
Founder ruling W55, ADR 0267 item 9 (on PR #664 at the time of writing): settle
from open plus mark memo. ADR 0230 carries the amendment.

**What the stack did (base e7ef518aa).** `TRANSITIONS` let `open` reach only
`requested`, `written_off` and `rejected` (`credit-ledger.ts`), so settling a
claim meant pressing "Ask the vendor" first. That stamped `requested_at` /
`requested_by` and drafted a letter for an ask nobody made. The settle form
listed only `doc_type = credit_memo` papers, and nothing but the classifier or
an X12 parser ever sets that type. Without AI (F-013) no paper became a memo.

**Fixed.** `open → credited` is legal, with the same proof (memo id plus amount
allowed, app and DB CHECK). Settling from `open` stamps no ask and drafts no
letter. `POST /procurement/credits/mark-memo/:documentId` (owner or manager)
marks an `unknown` paper as `credit_memo`. The write is conditional on the
type that was read, and it is audited in `system_audit_log`. The settle form
lists unread papers with a "This is the credit memo" button. The settle also
refuses a memo id that is not this house's credit memo. Claims:
`claims.d/fix-settle-an-unasked-memo.jsonl`.

## Left open from F-159 — OPEN — 2026-10-08

Forks below were **decided under the 2026-10-07 delegation, overridable** by the
founder. Each was decided as the most conservative option.

1. **Only `unknown` can be marked.** An `invoice` is what claims are raised on.
   It is also what invoice-match reads and what "paper owed" (W53) counts.
   Packing slips, delivery receipts, delivery notes and receiving advice are
   legs of the three-way match. Purchase orders are ours, statements tie out a
   period, and price lists feed prices. A real credit memo that the AI misread
   as one of those cannot be retyped here. That is a reclassification with
   consequences, and it would need its own ruling. `informal_note` and
   `portal_export` are refused too, even though their roles are weaker.
2. **A superseded or rejected paper, and one the house issued
   (`direction = issued_by_us`), cannot be marked.**
3. **No unmark.** A mistaken mark stays a credit memo. The audit row
   (`document_marked_credit_memo`, with `from`/`to`) shows who made it and
   when. No route puts the type back. Adding one would be another write on a
   paper's role.
4. **Who and when go to `system_audit_log`, not to a column.**
   `procurement_documents` has no "classified by / at" column, and
   `document_corrections` needs a layer-1 revision a retype does not produce.
   A failed audit row does not undo the mark. The answer says
   `audited: false` and gives the reason, as the house-currency write does.
   Missing: a column or event on the document itself. Nothing reads these
   audit rows back yet.
5. **The settle now checks the memo.** `POST :id/transition` to `credited`
   refuses (422) a `creditDocumentId` that is not in the caller's house or not
   filed as `credit_memo`. Before this, the foreign key admitted any id, from
   any house.

Deferred, not built:

6. **A stale draft letter after settling from `requested` or `promised`.**
   Settling closes the claim, but its `HOUSE_DRAFT` letter (ADR 0230) stays in
   /communications' drafts and can still be sent. A claim settled from `open`
   has no draft, because drafts are only made on `requested`. Discarding the
   draft on settle is a product choice: someone may still want to send a
   thank-you or a correction. So it is noted here, not built.
   `HouseLettersService.discardDraft` exists.
7. **A marked memo cannot be read by the extraction door any more.** That door
   fills only `unknown` papers (`document-intake.service.ts:1453-1456`,
   `ALREADY_READ`). A marked memo keeps whatever it had, usually no total and
   no lines. The person types the amount allowed at settle, so the claim is
   whole, but the memo document itself stays unread.
8. **Docs not updated (file cap).** `.planning/foundation/ENDPOINTS.md` does
   not list `mark-memo` (nor `request-letter`; no guard reads that file).
   `.planning/06-pages/receipts.md` §1c still describes ask-then-settle.
