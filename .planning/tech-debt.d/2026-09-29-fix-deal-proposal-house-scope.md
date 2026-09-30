## The deal and reply paths read and wrote another house's vendor messages on the same order id — CLOSED 2026-09-28 (fix/deal-proposal-house-scope) — 2026-09-28

Carried from preserved snapshot `a34b28aee` (wt-sec-procurement; `PRESERVE-TRIAGE-2026-09-28.md` §3 item 4, hunks 3–7), re-verified on `origin/main` at `46c3fdb5d`, and widened to every order-keyed conversation query in the same file. Filed and closed in one PR, so it can be checked again.

**What.** `procurement_conversations.order_id` is a plain FK to `procurement_orders(id)` (baseline `20260805000000_baseline_from_production.sql:12974`). Nothing ties a message's `restaurant_id` to its order's house, and the gateway reads with the service role (ADR 0171 option 3), so the service's filters are the only fence (ADR 0147). Each method below checked that the ORDER was the caller's. It then read or wrote the conversation rows by `order_id` alone. On `46c3fdb5d`, 10 of the 24 order-keyed `procurement_conversations` queries in `procurement.service.ts` had no house filter:
- `getDealProposal` (the deal modal) could show another house's vendor terms and quote.
- `resolveLatestDealProposal` (called by `dismissDeal` and `confirmDeal`) could mark another house's proposal resolved. `dealMessageFor`, which must pick the same row, was already house-scoped, so a confirmed price could name one message while another was marked.
- `confirmDeal` and `manualReply` threaded the letter onto the newest inbound message on the order id. The vendor's copy could therefore carry another house's subject, Message-ID, References and Gmail thread. Both methods also discarded every house's waiting drafts on the order id.
- `generateAiReply` could hand the responder another house's vendor message, its thread and its vendor (`providerId: row.provider_id`).
- `newerReplyStillAnalyzing` (the approve and confirm gates) and `newerInboundSince` (the auto-send stale guard) let another house's reply hold this house's approval, confirmation or scheduled send.

**How a foreign row gets there (partly traced).** A house letter stores the `orderId` its request names, with no house check (next entry). The mail bridge files a vendor's reply under the order and the house of the outbound row whose `gmail_thread_id` it matches (`rabbitmq-bridge.service.ts:679-690`; the thread match reads every house's rows). Whether a sent house letter's row gets a `gmail_thread_id` was not traced. Production has one real tenant (`production-tenant-shape`), so no mismatched row is expected there today. Production was not queried.

**Fix.** All 24 order-keyed `procurement_conversations` queries in the file now also filter `restaurant_id`. `newerReplyStillAnalyzing`, `newerInboundSince` and `resolveLatestDealProposal` take the house as their first argument. The resolve's update by id also filters the house. No route, status or response shape changed. For this house's own rows, every path behaves as it did before.

**Evidence.**
- `vendor-doors-are-sealed.spec.ts` has 10 new cases: 3 carried from the snapshot and 7 added. All 10 are red on `46c3fdb5d`, and the spec passes 37/37 after the fix. Each case also carries this house's own row, so a path that did nothing would fail.
- Mutation testing: the spec kills 9 of the 10 added filters one at a time. The tenth is the resolve's update by id, a defence in depth behind its house-scoped read, and only the claim kills it.
- Gateway suites `src/procurement`, `src/providers` and `src/common/orchestrator`: 2504 passed, 3 skipped. The 7 other specs that build the service: 93 passed.
- CLAIMS `SEC-2026-09-28-DEAL-AND-REPLY-PATHS-HOUSE-SCOPED` (resolved, static) fails on `46c3fdb5d`.
- Re-measured on `0d7af2975` (#493 touched only `apps/web`) by a second session: with main's `procurement.service.ts` under the branch's spec, the same 10 cases are red and the claim fails (8 of its 10 checks); on the branch the spec is 37/37 and the claim holds. Dropping `getDealProposal`'s house filter alone turns its two cases red. Gateway `src/procurement`, `src/providers`, `src/common/orchestrator` and `src/communications/letters`: 2665 passed, 3 skipped; the 6 other specs that build the service: 161 passed; gateway `tsc` on `tsconfig.json` and `tsconfig.spec.json`: clean.

**Not carried from the snapshot:** its `assert-provider-belongs-to-restaurant.ts` helper and its `createOrder` hunks (#491 landed a count-based fence; see the `POST /procurement/orders` entry above), and its mock tweaks to five specs (superseded; triage §2).

**Not audited:** order-keyed `procurement_conversations` reads outside `procurement.service.ts`. One is `HouseLettersService.countOutboundOnOrder`, which filters `order_id` alone (see the next entry).

**Severity:** high at a second tenant. It is a cross-house read of vendor terms, and of message headers that went into another house's outbound mail. It is also a cross-house write of deal resolution and draft status. It cannot be reached with one tenant.

## A house letter stores the order id its request names without checking the order is this house's — OPEN — 2026-09-28

Found by the deal-proposal house-scope lane (entry above).

**What.**
- `QueueLetterDto.orderId` is validated only as `@IsOptional() @IsUUID()` (`house-letters.dto.ts:70`).
- `HouseLettersService.checkLetter`, which `ask` and `queue` share, checks the vendor and the address against the house's book. It never reads the order.
- `queue` inserts `order_id: dto.orderId ?? draft?.orderId ?? null` next to `restaurant_id: restaurantId` (`house-letters.service.ts:773`).
- So a session for house A can file a letter row on house B's order.
- `countOutboundOnOrder` filters `order_id` alone, so it counts every house's letters on that order id toward the guardrail's round count.

Since the entry above, `ProcurementService` ignores such rows for house B. Other readers of `procurement_conversations` by order id were not audited.

**Fix shape (ADR 0147):** `checkLetter` reads the order by `id` AND `restaurant_id`. A missing or foreign id is a 404 identical to a missing one, and a failed read is refused with a fixed sentence. `countOutboundOnOrder` takes the house.

**Tracked by** CLAIMS `TD-2026-09-28-HOUSE-LETTER-FOREIGN-ORDER` (open, static). It holds, and so fails the build until this entry is struck, once `checkLetter` reads `procurement_orders` by `dto.orderId` and `restaurant_id`, or calls an `assert*Order*` helper on `dto.orderId`. It stays open for an id-only read and for a commented-out check. A renamed `checkLetter` makes it unable to run. All five shapes were measured.

**Severity:** medium at a second tenant. The caller needs the other house's order UUID, and what they gain is a row on it plus a skewed round count, not a read. It cannot be reached with one tenant.
