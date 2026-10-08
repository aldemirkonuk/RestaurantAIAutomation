## A vendor-letter draft can carry the house's ceiling price: the whole procurement intent goes into the drafting prompt — OPEN — 2026-10-08

**Found** by the F-106 production dry run (ADR 0266 PR-3, `scripts/f106_reconcile_dry_run.sql` query 4), 2026-10-08. One waiting approval-time `order_inquiry` draft stated the house's target price and its maximum acceptable price in its text. It still held the `[Your Name]` / "Wine Buyer" placeholders. The row ids are kept out of the repo, in the session's local dry-run report.

**It was never sent.** The draft stayed in PENDING_APPROVAL until the clean-up discarded it on the founder's word. Its `sent_at` and `send_requested_at` read back NULL, so no ceiling reached a vendor through that row. The risk is the next such draft: a single approval would mail it.

**Why.** `provider_conversation_agent.py:2272` fills `RESPONSE_SYSTEM_PROMPT`'s `{intent_description}` with `json.dumps(intent)`. That is the whole intent, `max_acceptable_price` included (set at `procurement_agent.py:389`, `procurement.service.ts:4201` and `communications.controller.ts:895`). `RESPONSE_SYSTEM_PROMPT` (`provider_conversation_agent.py:88`) says nothing about keeping it from the vendor. The ceiling is meant only for the agent's own accept test (`:4026`).

**What does not close it.** ADR 0313's renderer (PR-4a-i, #674) has no price or figure token, and it takes a price only from the order line. That renderer writes only the *order-request* letter. This writer is the LLM conversation path, which stays live for every non-order intent. PR-4b retires only the approval-time `ORDER_CONFIRMATION` writer for orders (ADR 0313, Consequences).

**Fix owed, on its own branch:**
- Remove `max_acceptable_price`, and any other field meant only for the house, from the intent before it is formatted into the prompt.
- Refuse at staging any draft whose text contains the intent's ceiling figure.
- Pin both with a test that fails if the key reaches the prompt string.

**Severity:** high while open. A negotiation disclosure is one approval away, and approving is the normal act on that page.
