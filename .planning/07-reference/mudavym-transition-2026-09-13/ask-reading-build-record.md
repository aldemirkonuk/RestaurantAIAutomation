---
type: execution-analysis
title: Ask named Reading catalogue and source census
status: approved-build-floor-before-implementation
updated: 2026-09-13
source_commit: 60ed83a7e6d5eb8b8e0e631783a598cd0f562bff
links:
  - "[[0145-mudavym-answers-out-of-a-reading]]"
  - "[[0146-asking-costs-money-so-asking-is-bounded]]"
---

# Ask: first named catalogue, before implementation

No Ask runtime line has been written in this tranche. This is the R5 build record and a proposed first **15 house Readings**, with the initial known-row and forced-error fixture floor declared before coding. Root completed the linked read-only Supabase census on 2026-09-13 and approved this fifteen-reading implementation scope. No earlier production counts have been reused as current. Evidence is copied to the existing vault reference bundle alongside this build record.

## Approved initial house Reading floor

All are version 1. Every row below requires both a known-row numerical fixture and a forced-query-error fixture; every forced query failure returns `could_not_read`, never absence. Cross-house distractor rows are included in each fixture. Query pagination, null/zero separation and source traces are shared runner obligations, not left to individual reading authors.

| Reading id / question | Source and scope | Known-row fixture / exact meaning |
|---|---|---|
| `inventory.position` — What stock is recorded for this item? | restaurant_inventory by restaurant_id and exact resolved item; latest `display_name`, `kind`, `uom` from ADR0115, not library-only identity | Two named rows with same partial name must clarify; explicit one-row selection yields that row's stock_live/shadow/in-transit cells and declared ledger unit, with no conversion from a default bottle size. |
| `inventory.low_stock` — Which active items are below their recorded threshold? | Active, nondeleted restaurant_inventory; house threshold configured provenance separately | Stocks 2/9 with thresholds 3/3 yields one item; threshold 3 without affirmative provenance renders an assumption, not a fact the owner stated. Exactly-at-threshold semantics will match the owning Inventory reader. |
| `inventory.in_transit` — Which items have stock recorded in transit? | restaurant_inventory by restaurant_id | Only positive nonnull in_transit_quantity rows; quantities remain per item/unit, never an aggregate across unlike goods. Fixture 12/0/null yields one item and a 12-unit cell; null is unknown. |
| `inventory.locations` — Where is this item's recorded stock held? | inventory_lots by restaurant_id/inventory_id joined to same-house storage_locations | Live/shadow/location lanes remain separate; two live lots 4+6 at one location yield 10, another 3 yields 3; unknown location is labelled unassigned, not a made-up room. |
| `inventory.movements` — What changed this item's stock in the selected period? | inventory_transactions by restaurant_id/inventory_id and transaction_date | +12, -3 and a shadow-only +9 produce live net +9 and a separate shadow movement; source/type/ref and exact window shown, no stock_snapshot inference. |
| `orders.open` — Which orders are still open? | procurement_orders by restaurant_id; current centralized closed-status contract | Draft/pending/confirmed included only as allowed by centralized status family; delivered/cancelled excluded. Counts split by actual status; missing delivery date remains missing. |
| `orders.lines` — What does this order contain? | Procurement order scoped first; procurement_order_items via parent order plus compatible child tenant check | Two cases of six and three bottles remain their printed lines; any derived 15-bottle total requires explicit compatible pack facts. Malformed/unstated pack refuses that conversion. Single-line legacy order fallback stays explicit. |
| `orders.late_deliveries` — Which open deliveries are past their stated date? | procurement_orders scoped to house, expected_delivery_date and centralized state | One dated yesterday, one tomorrow and one missing date yields one past-date entry, plus explicit missing-date coverage. A planned date is not a supplier-confirmed promise. |
| `receipts.verified_line` — What price and quantity did the last verified receipt record for this item? | Verified procurement_documents + procurement_document_lines + scoped document/order links and item resolution | Newer unverified invoice cannot displace older verified receipt; case price/unit is kept with explicit pack. Currency must be stated; no default USD or agreed-order price promoted to landed cost. Freight/tax allocation is NOT invented. |
| `sales.check_activity` — How many recorded closed checks and covers were in this period? | pos_checks by restaurant_id, voided false, closed_at/window; no invented currency | Two eligible checks with covers 2/3 yield two checks/five known covers; open/voided/outside rows excluded, null covers counted as unknown. No revenue sum without per-check currency evidence. |
| `sales.consumption` — What consumption was recorded for this item? | wine_consumption_log by restaurant_id/inventory_id and recorded_at | Two glasses 150 ml each plus one 750 ml bottle yields 1050 ml and separate glass/bottle serving counts; never infer all quantity rows mean bottles or divide by an unstated 750. |
| `calendar.upcoming` — What is in the house book for this period? | calendar_events and, where needed, same-house calendar_recurrence_rules; exceptions through an owned rule | Actual date/time fields and recurrence/exceptions must use owning Calendar semantics; one cancelled occurrence is not counted. No forecast or duplicate parent/instance entry. |
| `vendors.active` — Which vendors are attached and active? | Named house-vendor scope: owned providers plus authorized restaurant_providers junction, no scalar assumption | Owned-without-junction and shared-with-junction both appear once; foreign owned provider and revoked/inactive link do not. No personal contacts/raw notes are sent to the model. |
| `documents.waiting` — Which documents need review? | procurement_documents by restaurant_id and actual intake/review status enum | Received/extracting/needs-review are distinct; verified/rejected/superseded excluded. Three pending documents are three documents, never “three invoices” unless their doc_type says so. |
| `goals.targets` — What goals and targets are posted? | analytics_goals by restaurant_id, active status | Owner-written target/deadline/metric key are quoted as targets; default current_value 0 is NOT progress. Two active targets remain distinct units, with no cross-metric sum. |

The model-knowledge answer (allowed by the founder) is an additional lane with an immutable **not from the house's books** label; it is not counted as a database Reading toward this floor. A potential `library.wine_record` can follow the same recording runner, but is not used to pad the house floor. Standing questions are explicitly required by root in this implementation: they will persist a versioned reading, user-configured condition/schedule and measured evaluation outcomes. They are additional behavior, not extra readers padding this floor. Full sales revenue/financial forecasting and mobile Ask remain separately named capabilities.

## Schema/source facts already verified

- The checked baseline creates every listed core relation. The real line table is `procurement_document_lines`; there is no demonstrated `procurement_document_items` or `pos_check_items` relation (POS line items are JSON on checks).
- `providers.restaurant_id` is nullable and `restaurant_providers` is a separate required-house junction. The old Ask candidate loader currently reads only the scalar provider column and cannot be reused as a correct shelf scope.
- `procurement_order_items.restaurant_id` is nullable; first scope the parent order and reject an explicitly foreign child tenant. Do not count null child rows as globally accessible.
- `calendar_recurrence_exceptions` has no restaurant_id; its key goes through a same-house recurrence rule. `price_history.restaurant_id` and `vendor_price_observations.restaurant_id` are nullable; neither earns a scalar house shelf count.
- `inventory_lots` has no expiration date in the verified schema, so “expiring lots” was rejected from the initial catalogue rather than invented from received_at.
- Current house items use the ADR0115 additions `display_name`, `kind`, `uom`, `identity_provenance`; baseline bottle-only assumptions are insufficient. The reader will carry these fields and preserve per-item units.
- Baseline pos_checks has no currency. `voided` was added in `20260824190000_pos_voided_and_consumption_idempotency.sql`. Initial check activity avoids silently borrowing a current house currency for historical money.
- analytics_goals.current_value defaults to 0. Existing goal scoring contains unpaged reads and error/zero fallbacks in some branches; it is not a trustworthy drop-in reader for this new proof contract. Initial goal reading reports posted targets only.
- Both ADR0145 and ADR0146 were read through their appended founder answers; the current file matches the baseline sections read. No later Ask product answers are known according to root.

## Implementation shape to review

The runner owns the recording client, query trace, source/error/count/as-of fields and opaque cell identities. A reading selects an allowlisted query/computation, never authors those proof fields. A returned figure without an executed trace is rejected. Server reply validation rejects an entire answer if a bound cell ID is not in its own Finding; unknown wire kinds become could_not_read. Source and stated/defaulted/derived provenance stay separate. A new per-user, per-house folio is inserted before either model call and survives client abort. Read again creates a new versioned folio and retains the old result; an unknown/retired version refuses rather than silently changing the question. Haiku selects and Sonnet5 composes under the already-merged first-attempt daily spend gate and person/house limits; model knowledge never binds a house cell.

Draft actions reuse the existing Ask allowlist and ordinary confirm. All fields carry book-cell, exact utterance-span or explicit model-suggestion provenance. The Reading travels with the draft; commitment rechecks it before the existing order/letter seal is redeemed, and changed evidence returns both Findings without committing. Procurement integration must coordinate with overlay2 recovery; no second assistant purchase seal is introduced.

Migration range reserved by root: `20260913190800`–`20260913191100`. Root owns App.tsx, global flag registries/pageNames and central ADR/CLAIMS files. This agent owns the Reading engine/store/API and later Ask UI, with documentation limited to the Ask dossier plus this pre-build record.


## Current live aggregate census — 2026-09-13, before implementation

All four SELECT-only queries completed successfully. Schema output contains 700 column descriptions across the requested sources. These counts prove availability/population, not that every row satisfies a particular reading's requirements, and not every house has those records.

| Source | Rows | Houses with rows | Interpretation for first catalogue |
|---|---:|---:|---|
| restaurant_inventory | 183 | 7 | Live corpus for stock, ambiguity and item-context readers. |
| inventory_lots | 168 | 5 | Location/lot evidence exists; only one storage_locations row exists in one house, so missing/unassigned location remains a real outcome. |
| inventory_transactions | 257 | 5 | Current movement corpus exists; filters and exact unit lanes remain necessary. |
| procurement_orders | 2 | 2 | Small corpus; no claim of broad order history. |
| procurement_order_items | 1 | 1 | Legacy single-line fallback and missing child lines must be truthful. |
| procurement_documents | 33 | 1 | Intake corpus exists. This aggregate does not assert any are verified invoices. |
| procurement_document_lines | 60 | 1 | Lines exist; current exact item linkage must be checked by the reading. |
| procurement_document_links | 0 | 0 | Verified receipt/item reading may lack requirements today. No loose description match promoted to provenance. Its known-row fixture still must produce a genuine answer; live no-link cases report why they cannot. |
| providers | 22 | 3 | Ten owned rows, all without a matching restaurant_providers junction; twelve tenantless providers have no junction. Owned + authorized-junction union is required, and unlinked shared providers must be excluded. |
| restaurant_providers | 0 | 0 | Zero does not mean the houses have no vendors. |
| pos_checks | 145 | 4 | Check/covers corpus exists; void/close/window and missing covers are distinct. |
| wine_consumption_log | 119 | 3 | Consumption corpus exists; volume and serving-type separation required. |
| calendar_events | 7 | 2 | Calendar entry corpus exists. |
| calendar_recurrence_rules / exceptions | 1 / 0 | 1 / parent-scoped | Repeated-event parity must be tested even with no live exceptions. |
| analytics_goals | 0 | 0 | Goal targets are implemented against known-row fixtures; current houses receive an explicit empty result, not fabricated goals/progress. |
| vendor_price_observations / price_history | 0 / 0 | 0 / 0 | Not used to manufacture a helpful populated initial price reader. |
| master_wine_library | 4253 | shared | Library identity exists; it is not house evidence and does not count toward fifteen house readings. |

This live census and the fixture table above fix the nonzero exit floor **before the first Ask runtime edit**. Root approved the restrained semantics, with explicit caution about zero goals, missing receipt links, low-stock parity, parent-child mismatch refusal, recurrence parity and persisted pending folios after browser abort.
