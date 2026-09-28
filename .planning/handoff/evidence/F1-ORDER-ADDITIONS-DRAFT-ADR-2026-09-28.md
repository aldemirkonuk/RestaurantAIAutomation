> Draft from workflow wf_e3616b2b-2f9 (4 finders, Opus proposal, Sonnet adversary, Opus draft). Not an ADR yet: the number is assigned and the status locked only after the founder confirms.

# NNNN — An approved order is never edited; a forgotten item is added as a revision

- **Status:** Proposed 2026-09-28. **Not locked.** The founder must confirm the decision and answer the sub-forks under "What is NOT decided" before this ADR is locked and numbered.
- **Date:** 2026-09-28
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** procurement_orders, dedup, silent merge, APPROVED, PARTIALLY_RECEIVED, add to this order, amendment, revision, order group, seal, approval ceiling, vendor confirmation, door count, autoLink, append-only
- **Links:** ADR 0125 (order transition table, `order-transitions.ts`), ADR 0227 (door record is append-only, `20261201120000_the_door_record_is_append_only.sql`), ADR 0054:246 (multi-line PO not built), ADR 0103 (canonical `deliveries`), ADR 0175 (one-tap / shade ceiling and daily cap), ADR 0118 (house letters), ADR 0068 (calendar event per order), ADR 0059 (receiving preserves the pair), `v3.0-TECH-DEBT.md:5714-5723` (dedup-lookup house fence, closed 2026-09-28)
- **Measured at:** `origin/main` 5e876f39d. Every `file:line` below was read there unless it is marked UNVERIFIED.

## Context

### The defect (sweep #14)

The sweep's defect #14: **"New order" silently merges into an existing APPROVED or PARTIALLY_RECEIVED order.** I could not find the sweep's own text for "#14" on `origin/main` (a grep of `.planning/` for "defect #14" and "item 14" finds nothing that fits). The defect is quoted as the task stated it and checked against the code:

- `createOrder`'s dedup guard (`apps/api-gateway/src/procurement/procurement.service.ts:1080-1127`) looks up the newest order with the same restaurant, `inventory_id` and `provider_id` whose status is **not** in `TERMINAL_STATUSES` = {CONFIRMED, IN_TRANSIT, DELIVERED, COMPLETED, CANCELLED, REJECTED, FAILED} (`:1084-1092`). So **APPROVED and PARTIALLY_RECEIVED rows match** (NEGOTIATING, PENDING and APPROVAL_NEEDED match as well).
- On a hit it **UPDATEs** that row in place: `quantity`, `unit_type`, `bottles_total`, prices, `total_cost`, expected date (`:1129-1150`). Then it rewrites the line with `upsertOrderLine` (`:1170-1175`). There is no re-approval, and nothing records that the approved total changed.
- This **replaces** the quantity rather than adding to it. "I forgot 2 more" on an order of 6 becomes an order of 2, and that happens even before approval.
- The lookup **fails open**. On a read error it logs a warning and carries on (`:1119-1124`), so `existing` is undefined and a second order is inserted.
- The lookup is `.order("requested_at", desc).limit(1)` (`:1116-1117`). If a PENDING row and an APPROVED row exist for the same wine and vendor, the newer one wins.
- The seal binds an approval to its total and vendor (`order-seal.ts:1-32`), and the merge rewrites the total underneath it. There is no trace, so **nobody can tell today how often this has already happened**.

### The founder's answer, 2026-09-28, verbatim

> "never merge approved, but they can add to the order by saying add to this order, just like how I forgot to order this. And in order to solve this, we have we have to in order to we have to create a way to add an order, add an item to the certain order. Uh, to receive that whole old order in a whole and see that as a whole. But We don't need to touch the previous order. We just need to upgrade it to the new version and then just double check it. Right? Uh, research for it. I think this is the best option for us. Or just create new order or add order to the existing order?"

How I read it: there should be an explicit "add to this order" action. It never changes the approved version. It creates a new **version** linked to that order, and the version is checked again: it goes through approval and the vendor confirms it. The order is then received and seen **as one whole**. He also asks a direct question: is a plain new order better, or adding to the existing one?

### Facts about the schema that decide the shape

- **One order row is one wine.** `procurement_orders.inventory_id`, `quantity` and `final_price` are NOT NULL (baseline `20260805000000_baseline_from_production.sql:4514+`). `CreateOrderDto` carries a single `inventoryId`, and the writer stamps `line_no: 1`. "A four-line cart is therefore four orders" (`apps/web/src/pages/orders/next/NewOrderSheet.tsx:15-20`). Multi-line orders are unbuilt and undecided (ADR 0054:246).
- The **door record** (`procurement_receipt_events`) is keyed by `order_id`, has no line column, and has been append-only by trigger since ADR 0227. **No compensating or correcting event is defined** in that migration (its header, `:1-25`).
- The door sets **PARTIALLY_RECEIVED on every count** (`receiving.service.ts:560-575`). That status means the truck has come, not that an order was held back.
- **IN_TRANSIT is not written by anything in the order code.** `procurement.service.ts:3296-3298` says it is a state "which nothing in this codebase ever writes". The canonical `deliveries` table (ADR 0103, `20260903160000_canonical_document_and_delivery.sql:68-90`) does have its own `IN_TRANSIT` state. UNVERIFIED: whether anything writes it (for example a despatch advice).
- `order_number` is UNIQUE (baseline:7424). It has the format ORD-YYYY-NNNNN (`procurement.service.ts:7247-7253`).
- `autoLink` links an invoice to exactly one order, and only on an exact `order_number` match (`documents/document-intake.service.ts:2054-2075`). The line matcher already reads lines from every linked order (`:1662-1678`).
- **Vendor replies are routed by thread.** `rabbitmq-bridge.service.ts:674-688` takes the `order_id` of the first `procurement_conversations` row carrying that `gmail_thread_id`, with `.limit(1)` and no ORDER BY. The fallback at `:694-722` takes the newest non-terminal order for the provider. That fallback excludes CONFIRMED but **not** APPROVED.
- There are **101** `.from("procurement_orders")` call sites in the gateway (measured with `git grep -c`), plus direct writers in Python: `procurement_agent.py:682,695,748,801,855` and `email_parsing_agent.py:262,416,493,736`. The Python writers never go through `createOrder`.

## Options considered

Industry practice was read at search-snippet level only. The vendor documentation sites were blocked by the egress proxy, so treat these as pointers, not quotations.

1. **Status quo: silent merge.** Rejected. It rewrites a sealed total with no re-approval and no trace, and it replaces the quantity instead of adding to it. The founder: "never merge approved".

2. **In-place edit that resets approval** (NetSuite "reset approval status", Restaurant365 "unsubmit": https://community.oracle.com/netsuite/english/discussion/4226633/resetting-approval-status, https://docs.restaurant365.com/docs/purchase-orders-cancel-or-unsubmit-an-order). Cheapest to build. **Rejected by the founder** ("We don't need to touch the previous order"). It also rewrites what the vendor already confirmed, and it blocks receiving while the edit waits for approval.

3. **Plain new order only**, with the merge narrowed to states before approval. Not chosen as the whole answer, but its merge-narrowing ships first (Decision §1). Failure modes if it stands alone:
   - The vendor gets two letters and sends two confirmations for one truck.
   - An invoice citing one number links one order (`document-intake.service.ts:2054-2075`). The other order then looks unbilled and this one looks overbilled.
   - The door has no whole-order view.
   - It fails the founder's "receive that whole old order in a whole".

4. **Same-row revision: the ERP change-order pattern.**
   - How the ERPs do it: SAP version management with the release strategy re-triggered (https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/version-management-in-purchase-order-po/ba-p/13940409, https://help.sap.com/docs/SUPPORT_CONTENT/spmm/3362168090.html); Oracle change orders plus supplier acknowledgment (https://docs.oracle.com/en/cloud/saas/procurement/26b/oaprc/supplier-acknowledgment-of-purchasing-documents.html); Dynamics 365 change management with reapproval after confirmation (https://learn.microsoft.com/en-us/dynamics365/supply-chain/procurement/purchase-order-changes-after-confirmation); Coupa PO revisions (https://docs.coupa.com/en/developer-documentation/the-coupa-core-api/resources/transactional-resources/purchase-orders-api-purchase_orders/purchase-order-revisions-api-example-calls); EDI 860/865 (https://www.spscommerce.com/edi-document/edi-860-purchase-order-change/).
   - It is the norm, and it also covers reductions and changes. **Rejected as the first step**, for four reasons:
     - It needs real multi-line orders first: UNIQUE(order_id, line_no), a nullable header, and receipts at line level. Those are unbuilt and undecided (ADR 0054:246).
     - Copying the revision onto the header when it takes force is itself a write to an approved row, which is exactly what the seal guards.
     - Receipts booked before the split carry no line id.
     - Spend must skip superseded revisions or it double-counts.
   - It stays the **destination if multi-line orders are ever decided**. The group root below becomes the natural header for it.

5. **Linked addition rows, one revision number per row** (the first draft of this ADR). Rejected after the adversarial pass:
   - The forgotten item is usually a **different** wine. Three forgotten wines would become revisions 2, 3 and 4, with three approvals, three seals and three vendor letters for **one** human act. That contradicts "upgrade it to the new version".
   - Its vendor letter went into the root's Gmail thread. Because of `rabbitmq-bridge.service.ts:680-688`, the reply lands on an arbitrary member:
     - a "confirmed rev 2" reply landing on the already-CONFIRMED root never advances the addition;
     - a reply landing on the addition compares the whole-order quantity against the addition's own quantity (`inbound-responder.service.ts` syncOrderState, around `:1195-1279`), so the addition stays APPROVED for ever;
     - a decline landing on the root moves the whole root CONFIRMED → NEGOTIATING.
   - The door split it proposed ("root first, then additions") guessed at what was on the truck, and an append-only record cannot un-guess it.

6. **Chosen: a linked amendment.** "Add to this order" creates **one amendment (revision N) carrying one or more new order rows**. The approved rows are never touched. The root plus its amendments form **one order group**, which is approved, confirmed, received and shown as one versioned order.

## Decision (recommended; founder to confirm)

### 1. First, on its own fix branch: stop the silent merge

This holds whatever else is chosen.

- `createOrder` must **never UPDATE** a row whose status is APPROVED, CONFIRMED, PARTIALLY_RECEIVED or later.
  - It runs a **separate query** for approved-or-later rows with the same wine and vendor. It does not just lengthen the exclusion list on the newest-first `.limit(1)`.
  - When that query hits, it answers **409** with `{code: "order_exists", orderId, orderNumber, status, choices: ["add_to_order", "separate_order"]}` and writes nothing.
- The lookup **fails closed**. A read error is a 5xx refusal, not "no match, insert".
- For a pre-approval same-wine hit, the replace/add/ask behaviour is sub-fork F4. Until the founder answers, the branch asks: it returns the same 409 with `choices: ["add_quantity", "replace_quantity", "separate_order"]`. It stops silently replacing. This is a proposed default, flagged as such, not a decision.
- File an OD entry and a `CLAIMS.jsonl` line (status `open` until no lookup in `createOrder` can match APPROVED or later), per CLAUDE.md §5b.

### 2. The answer to "new order, or add to the existing one?"

**Both, chosen explicitly every time; never silently.**

- **"Add to this order"** is the path for a forgotten item while the vendor has not shipped. It is offered from the order itself, and from the new-order cart as "add these lines to ORD-x".
- **"Separate order"** is the path for anything that ships, is confirmed or is invoiced on its own. It is the only path once the cut-off (F1) has passed.
- The cost the founder should see: **each amendment is one more approval check and one more vendor confirmation.** It is one per amendment, not one per line.

### 3. The amendment is the unit

- One act of "add to this order" is **one amendment**: one revision number, N rows, **one** approval act, **one** seal, **one** vendor letter and **one** vendor confirmation.
- The rows inside it are ordinary `procurement_orders` rows (one wine each). Each still walks the ADR 0125 table. No new status and no new edge are added. The amendment moves its rows together in one transaction.
- Revision 1 is the root. Rows added **before** the root is approved join revision 1: there is nothing approved yet to preserve, so they are approved with the root as one act. This is sub-fork F9.

### 4. The vendor thread is per amendment

- Each amendment's letter opens its **own Gmail thread**, with a fresh subject that carries the amendment reference ("ORD-2026-01234 rev 2: addition").
- The letter lists the whole order for context, with the new lines marked NEW, and asks the vendor to "confirm revision 2".
- The conversation row names its amendment. Following ADR 0230's precedent, this goes in `email_headers.amendment_id`, so no migration is needed.
- The bridge resolves thread → amendment → member rows.
- The provider fallback (`rabbitmq-bridge.service.ts:694-722`) **refuses to guess** when the provider has more than one open group member. The mail goes to the person instead.
- `syncOrderState` compares the vendor's quantities and prices against the **amendment's rows**, never against a single row's `orderedQty`.
- A decline of an amendment moves only that amendment's rows. It **cannot** move the root off CONFIRMED.

### 5. The cut-off is not a status check

IN_TRANSIT is not a state this code writes, and PARTIALLY_RECEIVED means the goods have arrived. So the proposed rule is:

"Add to this order" is allowed only while **both** of these hold:
- the root is PENDING, APPROVAL_NEEDED, NEGOTIATING, APPROVED or CONFIRMED;
- **no door count exists for any member of the group**.

From PARTIALLY_RECEIVED onward, only "separate order" is offered. Whether a vendor's despatch advice, or a person saying "the vendor has shipped", also closes the window is sub-fork F1.

### 6. Money gates see the group

- Creating an amendment runs as a **plpgsql RPC**. It locks the root row, takes `max(revision_no)+1` and inserts the rows, all in one transaction. PostgREST calls through supabase-js cannot hold `SELECT … FOR UPDATE` across calls. The repo already uses `.rpc`, for example in `receiving.service.ts` around `:536`.
- Approving an amendment is also an RPC.
  - It takes the root lock and computes the group's committed total (live members already approved or later, plus this amendment) in the **same transaction** as the APPROVED write.
  - This closes the race where two amendments are approved at the same moment and each sees the other as uncommitted.
- `assertApprovalAllowed` (`procurement.service.ts:4386-4490`):
  - `manager_ceiling` is tested against the group total;
  - `price_jump` is tested per row;
  - `new_vendor` is false by construction.
- The same group total must reach every other money door:
  - `requireSendAuthority` at `confirmDeal` (around `:9245`);
  - the ADR 0175 per-order ceiling and daily cap;
  - the autonomy path that moves a vendor-accepted order to APPROVED (`inbound-responder.service.ts` around `:1259-1264`);
  - `approvalGate()` (around `:4500`).
- The seal act is reused. The subject is the amendment id. The args are the amendment total, the vendor, the revision number and the group committed total.
- **Stated plainly:** "separate order" is still one click and still gets around the group ceiling. The group ceiling is a nudge, not a control, unless the founder wants a same-vendor rolling-window rule (F2).

### 7. Nothing changes an approved row's terms

A DB trigger (Trigger B) refuses UPDATE of `inventory_id`, `provider_id`, `quantity`, `bottles_total`, `unit_type`, `quoted_price`, `negotiated_price`, `final_price` and `total_cost` when `OLD.status` is APPROVED, CONFIRMED, IN_TRANSIT, PARTIALLY_RECEIVED, DELIVERED or COMPLETED.

- It raises a **distinct SQLSTATE**, so the failure is legible.
- A price change after approval first moves the order to NEGOTIATING, which ADR 0125 already allows.
- It ships **only after a writer census** proves that none of these break:
  - `trg_procurement_line_price_echoes_to_header` (`20260905072000_the_header_price_echoes_the_line.sql`);
  - `confirmDeal` (`:9289-9330`) from every allowed OLD.status;
  - `syncOrderState`'s `negotiated_price = vendorPrice` (around `:1195-1198`);
  - the Python writers listed in Context.

  If any of them breaks, the fix is part of that branch.

### 8. The door is explicit

The door opens the group as one delivery.

- For every counted line, the receiver **assigns** the member row it belongs to. The system suggests a default but never assigns silently.
- Each assignment is its own idempotent door event on the existing per-row path.
- The second-delivery refusal (`procurement.service.ts:4960-5000`) applies per member, and the group door reports partial results line by line, the way NewOrderSheet reports a partial cart.
- A wrong assignment needs a compensating event, and ADR 0227 defines none (sub-fork F6).
- One `deliveries` row per group, keyed to the root's `order_id` (ADR 0103).

### 9. Invoice and match

- `autoLink` keeps exact matching. An exact hit on the root number, or on any member's number, links **all live members** of the group.
- `invoice-match` runs per member as it does today, and a group verdict rolls the members up.

### 10. Reporting has one choke point

- One SQL view or function keys the group as `coalesce(root_order_id, id)`, together with **one shared group-status derivation** (in TypeScript, mirrored in SQL).
- Every "orders" count, on-time figure and fill-rate reader moves to it. Start with `vendor-scorecard.service.ts`, `dashboard.service.ts` and ask-ai.
- A `CLAIMS.jsonl` check fails the build when a reader counts raw `procurement_orders` rows as orders.
- Amendment rows inherit the root's promised date for on-time metrics.
- A declined or withdrawn amendment is never scored as a vendor failure.
- Spend sums the members. Amendments only add, so nothing is superseded and nothing is counted twice.

### 11. Everything else

- **Recurrence:** the next occurrence clones the root only, never its amendments (`order-recurrence.service.ts:209`).
- **Audit:** every amendment's create, approve, decline and cancel row in `system_audit_log` carries the root id as its group key.
- **Calendar:** one ADR 0068 calendar event per group.
- **Surfaces:** the web, the letter, the door, the invoice view and the reports all say **"ORD-x rev N"**. No surface shows an amendment's rows as sibling orders.

## Data model

There is one migration. Its version must be **later than `20261201120000`**, the latest on `main` (CLAUDE.md §5b: never reuse a migration version).

```
procurement_order_amendments
  id               uuid pk
  restaurant_id    uuid not null  -> restaurants
  root_order_id    uuid not null  -> procurement_orders(id) ON DELETE RESTRICT
  revision_no      int  not null  CHECK (revision_no >= 2)
  status           text not null  CHECK (status in
                     ('draft','awaiting_approval','approved','sent',
                      'confirmed','declined','withdrawn'))
  total_cost       numeric not null         -- sum of its rows at approval, frozen
  approved_at, approved_by, sent_at, vendor_confirmed_at, declined_at
  created_by, created_at
  UNIQUE (root_order_id, revision_no)

procurement_orders
  + root_order_id  uuid NULL -> procurement_orders(id) ON DELETE RESTRICT   -- NULL on the root
  + amendment_id   uuid NULL -> procurement_order_amendments(id) ON DELETE RESTRICT
  + revision_no    int  NOT NULL DEFAULT 1
  CHECK ((amendment_id IS NULL) = (revision_no = 1))
  CHECK (root_order_id IS NULL OR root_order_id <> id)
```

- **Trigger A (lineage).**
  - The root must have `root_order_id IS NULL`, so amendments are never chained.
  - Every member has the root's `restaurant_id` and `provider_id`.
  - A member's `revision_no` equals its amendment's.
  - Revision-1 members (rows added before approval) have `root_order_id` set and `amendment_id` NULL.
- **Trigger B:** as in §7, gated on the census.
- **Numbering.**
  - A member's `order_number` is `root.order_number || '-R' || revision_no || '.' || n`, e.g. `ORD-2026-01234-R2.1`. This keeps the UNIQUE constraint intact and cannot collide with the random 5-digit suffix.
  - What the vendor sees is F7.
- **Group key:** `coalesce(root_order_id, id)`. Version k is the set of live members with `revision_no <= k`. Version 1 can always be rebuilt exactly, because Trigger B freezes the root's terms.
- **Views and functions:** `procurement_order_groups` (the view), `create_order_amendment(...)` and `approve_order_amendment(...)` (the RPCs), and `order_group_status(group_id)`.
- **Not touched:** `procurement_receipt_events` (ADR 0227 stands), the document tables, the ADR 0125 transition table, the seal act definitions.
- **Precedent:** the lineage column plus partial-UNIQUE pattern already exists for `recurrence_parent_order_id` (`20260905235800_an_order_that_repeats_says_so_on_itself.sql:119-132, :267`).
- **Tests to update:** `order-schema-drift.spec.ts:310` and `verify-receipt.spec.ts:64` list the columns and will fail on the new ones.
- **Risk:** low. `NOT NULL DEFAULT 1` is metadata-only on current Postgres, and both CHECKs hold for every existing row.

## State machine

**Member rows** walk the ADR 0125 table unchanged.

**The amendment:**

```
draft ──submit──▶ awaiting_approval ──approve (RPC, group ceiling)──▶ approved
approved ──letter sent (own thread)──▶ sent ──vendor confirms rev N──▶ confirmed
awaiting_approval / approved / sent ──person withdraws──▶ withdrawn
sent ──vendor declines rev N──▶ declined      (member rows → NEGOTIATING or REJECTED; root unchanged)
```

Member rows move with the amendment in the same transaction:
- awaiting_approval ↔ APPROVAL_NEEDED;
- approved ↔ APPROVED;
- confirmed ↔ CONFIRMED;
- withdrawn ↔ CANCELLED, via the sealed cancel act with its reason category.

If the vendor accepts only some lines of an amendment, that is F8.

**Group status** comes from one shared function over the **live** members (CANCELLED or REJECTED amendment members are left out, and shown struck through). The rules are applied in order:

1. The root is CANCELLED, REJECTED or FAILED and no amendment is live: the group shows the root's status.
2. Some live members have arrived (PARTIALLY_RECEIVED, DELIVERED or COMPLETED) and some have not: **partly received**.
3. Every live member has arrived: COMPLETED if all are COMPLETED; otherwise DELIVERED if all are DELIVERED or later; otherwise PARTIALLY_RECEIVED.
4. Any live member is PENDING, APPROVAL_NEEDED or NEGOTIATING: **"Revision N awaiting approval"** (N is the lowest such revision). The base status stays the status of the latest confirmed version.
5. Any live member is APPROVED but not CONFIRMED: **"Revision N sent, awaiting vendor"**.
6. Every live member is CONFIRMED: **confirmed (rev N)**.

**"Add to this order" is offered** when the root is PENDING, APPROVAL_NEEDED, NEGOTIATING, APPROVED or CONFIRMED **and** no door count exists for the group, plus whatever F1 adds. Otherwise only "separate order" is offered.

**If the root is cancelled while an amendment is live,** the person is prompted. The system never cascades (F5).

## Consequences

- **What the founder asked for:**
  - "add to this order" exists;
  - the approved order is never touched (Trigger B plus the narrowed dedup);
  - each new version is checked again (a group-total approval plus the vendor confirming revision N);
  - the order is received and seen as a whole (the group door, the group view, one delivery, one calendar event).
- **It fits the schema rather than fighting it.** It works with one wine per row and with the append-only door. The seal, thresholds, shadow stock (`procurement.service.ts:4192-4197`) and invoice match keep working per row.
- **New surface to hold honest:**
  - the group view has to be the only way orders are counted, or reports over-count;
  - one vendor thread per amendment changes how the bridge routes mail;
  - Trigger B turns every unlisted writer of an approved row into a hard failure. That is the point of it, and the reason the census comes first.
- **Cost per amendment:** one approval check and one vendor confirmation.
- **What it does not close:** the "separate order" way around the ceiling (F2). It covers **additions only**. Reductions and changes to confirmed lines still go through NEGOTIATING. The full change-order model (option 4) is deferred behind multi-line orders.
- **Build size:** most of this ADR. §1 alone ends the silent merge and can ship this week.

## What is NOT decided (sub-forks for the founder)

1. **F1, the cut-off.** Proposed: allowed until the first door count. Should a vendor despatch advice, or a person marking "vendor has shipped", also close it? Note that no order state represents "shipped" today.
2. **F2, the ceiling.** Proposed: test the whole group, not only the amendment. Should a same-vendor rolling-window rule close the "separate order" way around it, or is that dodge acceptable?
3. **F3, commitment.** Does an amendment count as committed spend at approval (as orders do today) or only at the vendor's confirmation? Proposed: committed at approval, and shown as "awaiting vendor" until confirmed.
4. **F4, pre-approval same-wine collision.** Replace, add, or ask? Proposed: ask. The silent replace loses the "+2".
5. **F5, cancelling the root while an amendment is live.** Proposed: prompt the person, never cascade.
6. **F6, correcting a wrong door assignment.** ADR 0227 defines no compensating event. Should the group door require an explicit choice for every line, or accept suggested defaults? And what event corrects a wrong one?
7. **F7, what the vendor and the invoice see.** "ORD-x rev 2" (proposed), a fresh order number, or the member numbers?
8. **F8, partial vendor acceptance of an amendment.** Settle it row by row inside the amendment (proposed), or treat the whole amendment as declined?
9. **F9, rows added before approval.** Join revision 1 and are approved with the root (proposed), or always form a new revision?
10. **F10, the letter.** Whole order with NEW marked (proposed), or the delta only?

## Build plan

Each branch touches at most 15 files. The ADR and the `.planning/` changes travel with the code they describe (CLAUDE.md §7).

1. **`fix/order-merge-never-touches-approved`** (about 8 files). Ships first and independently.
   - `procurement.service.ts` (fail closed; a separate approved-or-later query; the 409; pre-approval asks) and its spec;
   - `dto/procurement.dto.ts` (the 409 shape);
   - `NewOrderSheet.tsx` plus its data hook (the chooser);
   - `OPEN-DECISIONS.md`, `CLAIMS.jsonl`, `v3.0-TECH-DEBT.md`.
2. **`data/approved-order-writer-census`** (about 6 files). No behaviour change.
   - Census every writer of the Trigger B columns in APPROVED or later states: gateway, Python and SQL triggers.
   - Tests: the echo trigger, `confirmDeal` from each OLD.status, `syncOrderState` on APPROVED.
   - Record the results in this ADR.
3. **`data/order-amendments-schema`** (about 9 files).
   - The migration: the amendments table, the columns, Trigger A, the group view, `order_group_status`, and the two RPCs.
   - Trigger B, only if branch 2 is clean.
   - Update `order-schema-drift.spec.ts` and `verify-receipt.spec.ts`; regenerate the `packages/database` types; add a CLAIMS line.
4. **`feat/order-amendment-create-approve`** (about 12 files).
   - `order-amendments.service.ts` plus controller: `POST /procurement/orders/:id/amendments` and approve/withdraw.
   - Wiring in `procurement.module.ts`; the group-aware `assertApprovalAllowed`; the seal args; audit rows keyed to the group; recurrence skips amendments; specs.
5. **`feat/order-group-money-gates`** (about 8 files). The group total at `requireSendAuthority`/`confirmDeal`, in the ADR 0175 ceiling and daily cap, on the autonomy accept-to-APPROVED path, and in `approvalGate()`. Specs for each door.
6. **`feat/order-amendment-vendor-thread`** (about 10 files).
   - The amendment letter in its own thread;
   - `rabbitmq-bridge.service.ts` routing (by amendment id; the fallback refuses to guess);
   - `syncOrderState` compares against the amendment, and a decline stays isolated;
   - the Python `email_composer_service.py` subject and reference footer; specs.
7. **`feat/order-group-door-and-match`** (about 11 files).
   - `receiving.service.ts` group door with explicit assignment;
   - the second-delivery rule per member;
   - `delivery.service.ts` group delivery;
   - `document-intake.service.ts` `autoLink` group linking;
   - the `invoice-match.ts` roll-up; `ReceiptSheet`; specs.
8. **`feat/order-group-reporting`** (about 10 files).
   - `vendor-scorecard.service.ts`, `dashboard.service.ts`, ask-ai and the other count readers move to the group view;
   - the promised date is inherited; a declined amendment is not a vendor failure;
   - the CLAIMS check script for raw-row counts; specs.
9. **`feat/orders-next-add-to-order`** (about 10 files).
   - `LedgerRow` / `AgreementSheet` action;
   - the "add these lines to ORD-x" cart in `NewOrderSheet`;
   - `useOrdersNextData` folds a group into one row with "rev N";
   - `ApprovalGate` for the amendment; the group-status copy; tests; a browser check.

Branches 4 to 9 depend on 3. Branch 3 depends on 2 for Trigger B only.

## Not verified (state before acting)

- The source text of "sweep defect #14". It is not found on `origin/main`.
- Whether anything writes `deliveries.state = 'IN_TRANSIT'` (for example from a despatch advice).
- Whether `confirmDeal` can run on an APPROVED row, and whether any writer outside those listed touches the Trigger B columns (branch 2 settles both).
- Whether `services/agent-orchestrator` ever creates orders by any path other than a direct insert.
- The 409 shape the web already handles.
- The `rabbitmq-bridge.service.ts:694-722` fallback lacks a restaurant filter. It is probably moot, because `provider.id` is per restaurant (`provider.restaurant_id`, `:678`), but check it.
- All external ERP and restaurant-tool evidence is at search-snippet level: SAP, Oracle, Dynamics, Coupa, NetSuite, Restaurant365, Apicbase (https://support.apicbase.com/help/how-can-i-register-orders-with-multiple-deliveries), Choco (https://help.choco.com/en/articles/6853398-how-to-edit-orders), Precoro (https://help.precoro.com/how-to-edit-the-purchase-order-after-it-was-approved).
- The ADR number. Check the next free number against the decisions README before locking; the highest file on `main` is 0237.
