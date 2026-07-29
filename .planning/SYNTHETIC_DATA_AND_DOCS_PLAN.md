# Synthetic data, the bridge, and the WineOps document

**Date:** 2026-07-29
**Relates to:** `YC_WEDGE_PLAN.md` (reopens the cut Track C, on different grounds), Phase 37 (synthetic restaurant engine, satisfied)
**Status:** in progress

---

## 0. Locked decisions

| # | Decision | Consequence |
|---|---|---|
| D1 | **Closed loop, both directions.** Simulated service depletes stock, depletion triggers reorder, reorder produces a PO, the PO produces a delivery, the delivery produces documents. | Requires *two* ingresses, not one. See §1 — this is the finding that reshapes the work. |
| D2 | **Everything except the restaurant is legit.** Real crawled menus, real vendor records, real wine SKUs and price structure. Only the restaurant is fabricated. | Reuses Phase 37's snapshots and `providers`; the simulator adds traffic and documents, not new master data. |
| D3 | **Real vendor records, fictional brands on rendered documents.** `providers` holds real distributors. Rendered lookalike invoices carry invented houses. | No artifact this repo produces can be mistaken for a real company's paperwork. Every rendered document also carries a `SYNTHETIC` mark — see §4.4. |
| D4 | **Four-way match on the document, ship column collapses.** ordered / shipped / received / billed. No packing slip renders `—` (unknown), never inferred. | Matches `invoice-match.ts` exactly, including `overbilled_vs_ship` and `short_shipped` as distinct outcomes. |
| D5 | **Multi-layout + degradation + injected errors.** 6 house layouts, photographic degradation, discrepancies injected by target verdict. | The dataset can measure extractor accuracy instead of flattering it. |
| D6 | **The WineOps document is a normalizer first.** Any inbound document — photo, emailed PDF, EDI 810, carbon handed over at the door — re-renders into one WineOps format. Outbound (PO, credit claim) is the same renderer with different data. | One template family, four output targets: screen, PDF, CSV, JSON. |

---

## 1. The finding: there is no single bridge

`YC_WEDGE_PLAN.md:251` says `pos-hub.controller.ts:44` is "the way to bridge any POS today," and quotes the controller correctly. But posting service traffic there **cannot** produce a reorder, because that ingress never touches inventory.

There are two independent POS ingresses in this repo and they are not connected to each other.

**Ingress A — NestJS, HTTP, analytics.**

```
POST /pos-hub/webhook/generic_webhook/:restaurantId
  → PosHubService.ingest()                      pos-hub.service.ts:67
  → adapter.normalize() → wine mapping → UPSERT pos_checks
```

Every consumer of `pos_checks` in the repo: `analytics/table-analytics.service.ts`, `analytics/insights/insight-generator.service.ts`, `analytics/insights/insight-catalog.ts`, `analytics/goals.service.ts`. **No inventory write exists on this path.** Idempotent on `(restaurant_id, source, external_check_id)`.

**Ingress B — Python/FastAPI, RabbitMQ, stock.**

```
POST /api/v1/pos/webhook/toast              api/pos_routes.py:34
  → ToastAdapter.verify_webhook()           HMAC-SHA256 hex of raw body, header Toast-Signature
  → POSIntegrationAgent.process_pos_event() agents/pos_integration_agent.py:285
  → publish pos.sale.completed on pos.events
  → BufferManager → stock.evaluated
  → InventoryEngine.process_message()       agents/inventory_engine.py:77   ← stock decrement
  → stock.threshold.breached
  → ProcurementAgent._initiate_procurement()agents/procurement_agent.py:138 ← the reorder
  → draft order → approve → delivery
  → procurement.order.delivered → InventoryEngine                          ← stock increment
```

**So:** Ingress A lights up analytics, insights, recommendations, goals. Ingress B lights up depletion, thresholds, reorder, procurement, and the delivery that documents attach to. D1 requires both. The simulator posts each check to **both** ingresses from one generated event, which is also the honest way to discover whether the two paths ever disagree — they have never run against the same data.

**The signature is real and stays real.** Ingress B verifies `hmac.new(secret, raw_body, sha256).hexdigest()` against the `Toast-Signature` header, and fails *open* when no secret is configured (`toast_adapter.py:26`). The simulator sets a secret and signs correctly rather than relying on the fail-open branch — an unsigned simulator would leave the verification path untested forever, which is exactly the class of gap this work exists to close.

**Provider registry limit.** Ingress B's registry contains only `"toast"` (`pos_routes.py:_get_providers`). The simulator therefore emits Toast-shaped payloads (`eventType`, `restaurantGuid`, `createdDate`, `order.checks[].selections`) for B, and canonical `CanonicalCheck` shape for A. Same underlying event, two encodings — which is precisely what a second real POS would demand later.

---

## 2. What exists and is being reused

Phase 37 (`scripts/synth/`) is a real factory and is **not** being rewritten:

- dry-run default, `--apply` gate for cloud mutation
- deterministic `uuid5` ids under `SIM_NS` (`ids.py`)
- **write-set ↔ teardown equality gate** (`write_set.py`) — `assert_write_set_equals_teardown` fails if a table is written but not torn down
- ground-truth oracle (`oracle.py#build_facts` → `sim_ground_truth_facts` / `sim_ground_truth_runs`)
- 5 archetypes from real crawled menus (`datasets/sim/`)

It seeds **static state only**: org, restaurant, personas, menu, opening inventory. No traffic, no documents.

**Hard constraint inherited:** every new table this work writes must be added to *both* `SYNTH_WRITE_SET` and `TEARDOWN_TABLES`, or the gate fails on `--apply`. New tables in scope: `pos_checks`, `procurement_orders`, `procurement_order_items`, `procurement_documents`, `procurement_document_lines`, `vendor_credits`. This gate is a feature — a simulator that cannot be fully torn down poisons the tenant it runs in.

---

## 3. Layout

```
scripts/simulate/          service traffic + the bridge
  calendar.py              demand model: two dinner peaks, weekday/weekend amplitude, seasonal drift
  service.py               menu + archetype → checks (BTG vs bottle mix, sell-outs)
  bridge.py                one event → both ingresses (canonical + Toast-signed)
  procurement.py           depletion → threshold → PO → delivery timeline

scripts/docgen/            the document factory
  houses.py                6 fictional distributor brands, each with layout quirks
  errors.py                discrepancy injection keyed to MatchVerdict
  compose.py               PO + packing slip + delivery receipt + invoice (+ credit memo)
  render.py                Jinja2 → headless Chrome → PDF/PNG
  degrade.py               skew, shadow, JPEG, crumple, rotate, fold, thermal fade
  truth.py                 ground-truth JSON paired to every rendered artifact
  templates/house_*.html   distributor lookalikes
  templates/wineops_*.html THE normalized WineOps document  ← §5
```

**Renderer choice.** `weasyprint>=60.0` is declared in `services/agent-orchestrator/requirements.txt:170` but its native libraries do not load on this machine. Headless Chrome is present and needs no install, and the HTML/CSS it consumes is the *same* template family the product will use for the on-screen document. Choosing Chrome means the design work and the dataset work share one toolchain instead of two.

---

## 4. Ground truth

### 4.1 The contract

Every rendered artifact is emitted with a sibling `.truth.json` holding the exact values used to render it — before degradation, before layout, before any model sees it. Extraction accuracy is then a diff, not a judgement call.

### 4.2 Error injection is keyed to verdicts, not to noise

Discrepancies are generated by naming the verdict we want `invoice-match.ts` to return, then working backwards to the document values that produce it. The nine verdicts: `matched`, `overbilled_vs_ship`, `price_variance`, `qty_over`, `qty_short`, `short_shipped`, `rejected`, `partial`, `unmatched`.

Two cases exist specifically to catch **false alarms**, and a run that fires on either is a failing run:

- **split case** — order 2 cases, invoice 24 bottles, count 2 cases. Must be `matched`. Naive bare-number comparison reports a 22-unit overage; this is called out in `document-types.ts#normalizeUom` as the most common false alarm in beverage receiving.
- **free goods** — 11 delivered for the price of 10. Must be `matched` with `effectiveUnitCost` reduced, not `qty_over`. `invoice-match.spec.ts:168` currently asserts `qty_over` on exactly this input; the wedge plan lists it as a defect.

### 4.3 What this dataset can and cannot prove

It proves the pipeline does not crash, that the two ingresses agree, that extraction accuracy is measurable, and that the match engine returns the intended verdict on a known input. **It proves nothing about whether the product is worth paying for**, and no product decision should cite it. The unmeasured assumption in `YC_WEDGE_PLAN.md:98` — how often real beverage invoices are actually wrong, and by how much — is not answerable with data we generated ourselves, by construction.

### 4.4 Provenance marking

Every rendered document carries, non-optionally: a visible `SYNTHETIC — NOT A GENUINE COMMERCIAL DOCUMENT` mark, a fictional vendor house (D3), PDF metadata naming this generator, and a `synthetic: true` flag in its truth file. These artifacts are test fixtures. They stay in the repo — never emailed, never published, never presented as a record of a real transaction.

---

## 5. The WineOps document

Design work is gated on the manager-pain research (`.planning/INVOICE_DOC_UX_RESEARCH.md`) so the field list is derived from what actually hurts rather than from what is convenient to render.

Fixed regardless of research outcome:

- **Four-way columns** (D4), ship collapsing to `—` when no packing slip arrived.
- **Never infer agreement from silence.** No invoice means `unmatched`, never a value copied from the PO. This is defect #2 in the wedge plan and the document must not reintroduce it visually.
- **Landed cost, not sticker price.** Freight, fuel surcharge and split-case fees allocated to the line, per `effectiveUnitCost`.
- **What only we know** goes on the document and is the reason to read ours instead of theirs: last price paid, price trend, landed cost, the verdict, dollars at risk, credit claim state.
- **One glance, one action.** Role-scoped per Track D — staff see no prices at the door.
