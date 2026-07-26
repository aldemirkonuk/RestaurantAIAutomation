# WineOps — `/inventory` SOTA Rebuild Plan

> **Status:** Approved for execution (Phase 0 pending)
> **Date:** 2026-07-10
> **Owner:** aldemirkonuk
> **Sources:** two read-only expert audits (Inventory Systems-Engineering ≈2.6/10; Inventory SOTA/Innovation ≈3.9/10) + direct code verification in this repo.

---

## 0. TL;DR

`/inventory` is a **beautiful shell on a broken-but-recoverable foundation**. The UI is polished; the numbers can't be trusted. Both audits, from opposite angles (correctness vs. inventory science), reached the same root cause:

> **There is no single source of truth for stock.** It is written by three uncoordinated actors, valued two contradictory ways, and audited by a ledger nobody writes to.

This plan cures that one disease in three gated phases: **restore trust (NOW) → real inventory science (NEXT) → signature intelligence (BOLD)**, plus a parallel **deal-sourcing** workstream. Intelligence is hard-gated behind trust — *a forecast built on numbers people caught lying is worse than no forecast.*

**North star (one sentence):** *One source of truth per fact — physical **lots** — with every other number (wine total, location count, valuation, status) **derived**, every stock change flowing through **one ledger**, and intelligence gated behind numbers people have learned to trust.*

---

## 1. Root-cause diagnosis: dual bookkeeping

Every P0 is the same disease — *two representations of one fact, allowed to drift:*

| Fact | Representation A | Representation B | Symptom |
|---|---|---|---|
| Stock level | `stock_live` (NestJS PATCH) | `stock_live` (Python engine) + DB triggers | 3 writers, lock honored by none → lost updates, drift |
| Location count | stored `currentCount` | `getLocationsWithActualCounts()` (derived) | manual "Sync" button papers over drift |
| Audit history | immutable ledger (`inventory_transactions`) | direct `stock_live` writes | ledger ≠ shelf; "immutable audit trail" is fiction |
| Value | cost basis (export) | menu price × stock (headline) | headline value inflated ~3× |

**The fix is one principle, applied everywhere:** pick one source of truth per fact; derive the rest. Physical **lots** become that source. ~80% of all findings collapse into this.

---

## 2. Locked decisions (decision log)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Valuation shows two labeled numbers:** *Cost basis (WAC)* and *Menu potential*. Never a single unlabeled "value." | Headline value was menu×stock (~3× inflated) — the #1 trust killer. |
| D2 | **Per-row 3-price display:** Market · Purchased (WAC) · Menu. | Manager needs all three at a glance. Market already computed (`retail_price_avg`), just discarded. |
| D3 | **Purchased price = Weighted Average Cost (WAC).** `WAC = Σ(qty×unit_cost) / Σ(qty)`. | User's spec: "2 cases @ $20 + 1 case @ $20 → avg per bottle." |
| D4 | **Quarantine the orphaned ledger; make its lying test honestly red/skipped.** Do **not** delete (Phase 2 resurrects a corrected version). | Green-on-a-ghost-column is more dangerous than red. |
| D5 | **Version optimistic lock enforced on the one live writer now**, all writers in Phase 2. | Currently honored by zero live paths. |
| D6 | **One shared status definition** (critical/low/healthy) consumed by all layers + parity test. | Currently defined 3 incompatible ways. |
| D7 | **Shadow stock is system-owned.** No raw shadow-number editor. Stock enters via **orders** only. | Free-editing loses cost, provider, lifecycle, audit. |
| D8 | **Manual order entry + wire the dormant invoice scanner.** Receipt → auto-creates order (line items, costs, provider) → lands in *live* (in hand) or *shadow* (arriving). | Turns one dark feature into the solution for off-app purchases; feeds WAC + ledger. |
| D9 | **Every order carries its receipt.** Orders list → click → detail drawer shows receipt + per-item counts + costs. | Audit backbone + WAC feeder. |
| D10 | **BTG model = superset, selectable.** Canonical storage: sealed `qty` + `open_bottle_ml`. Display/entry mode `{bottle, volume}` selectable, riding on the existing `measurementUnit` setting. | User: "both if wanted (selectable)." One schema serves bottle-centric and ml-centric shops. |
| D11 | **Deal sourcing = official APIs + own crawler only (Tiers 1–3). No gray-area (Tier 4).** | Zero ToS/account-ban risk; the differentiated signal comes from official channels + one-tap draft, not scraping WhatsApp groups. |
| D12 | **Zero-stock location assignment = planned slot at qty 0** (never a phantom bottle). | Fixes the `|| 1` data-integrity bug while supporting layout pre-planning. |
| D13 | **Intelligence (Phase 3) is hard-gated behind Phase 1+2 trust.** Not a parallel track. | Nobody trusts a forecast on numbers they've caught lying. |
| D14 | **Count is truth; perpetual is the audit trail.** The *displayed/trusted* on-hand number is a periodic count re-based against the ledger — not the raw perpetual projection. | Perpetual only stays honest if reconciled by counts; food & bev reality (premortem top-3 killer). |
| D15 | **Lots, `open_bottle_ml`, and forecasting are opt-in per restaurant, off by default.** | They assume data discipline / real-time POS integration many shops lack; false precision erodes trust faster than honest coarseness. |
| D16 | **Genesis-lot backfill + `cost_provenance`.** Cutover creates one opening lot per wine in a reserved `unassigned` location, `cost_provenance ∈ {invoice, estimated, manual}`; estimated costs stay visibly labeled. | A single `stock_live` integer has no location or per-lot cost — the migration was the plan's biggest silent gap. |
| D17 | **Received qty (the receipt) is the quantity of record — not ordered qty.** Delivery reconciles shadow to exactly 0 using *received*, handling partial/over-delivery. | Prevents permanently stranded phantom shadow when 20 of 24 arrive. |
| D18 | **Transfers are a first-class balanced primitive** (`record_inventory_transfer` → linked out/in pair, shared `transfer_group_id`, cost-preserving). | Transfers are ~half of daily movements; delete+create loses cost lineage. |

---

## 3. Verified findings (evidence)

Confirmed against this repo — the audits are ~90% accurate. Severity **re-graded**: the ledger P0s are **latent** (orphaned/unwired), not active outages, which re-sequences the roadmap.

| Finding | Verdict | Evidence |
|---|---|---|
| Ghost `live_stock` column breaks ledger + reconcile | **True (latent)** | `inventory-ledger.service.ts:453,461`; RPC `005:366-368`. Real column is `stock_live` (`20260220110000:59`). |
| Tests mock the wrong column → false green | **True** | `inventory-ledger.service.spec.ts:336,384` mock `{ live_stock: 10 }`. |
| Audit trigger references nonexistent `wine_id` | **True (dormant)** | `006:52`; real FK is `master_wine_id`. |
| "Immutable ledger" is fiction | **True** | Zero web callers of `/inventory-ledger`; reconcile/override PATCH `stock_live` directly. |
| Version optimistic lock unused on live path | **Worse than reported** | `inventory.service.ts` references `version` **zero** times. |
| Total Value = menu price (~3× inflated) + self-contradictory | **True** | Table `Inventory.tsx:1257` (menu×stock) vs export `:555` (cost×stock). |
| Integer-only stock breaks BTG (ml) depletion | **True** | `stock_live INTEGER`; `glassesPerBottle` uses `Math.floor` (remainder lost). |
| Three incompatible status definitions | **True** | Backend view vs `useInventoryPage.ts:272` vs `inventory_engine.py:461`. |
| `\|\| 0` masks unknown as out-of-stock | **True** | `useInventoryPage.ts:143`. |
| Invoice scanner + QR built-but-unwired | **True** | `_showInvoiceScannerModal` unused; QR button is a placeholder. |
| Shrinkage / Ghost Inventory agents are stubs | **True** | `shrinkage_detective_agent.py:34`, `ghost_inventory_agent.py:35`; tables exist, never written. |
| One-wine-one-location constraint blocks multi-location | **True** | `UNIQUE(restaurant_id, wine_id)` — `20260304020000:9`. |
| Two competing migration trees | **True** | `supabase/migrations/` (live) vs `services/database/migrations/005–007`. |

**Framing correction vs. the audits:** the synthesis implied production is on fire ("the entire ledger path fails at runtime"). It isn't — that code is **orphaned** (nothing calls it; the real path uses the correct column). The ledger bugs are **latent landmines that detonate the moment you wire it up**, not active 500s. So the audits' "Now: route all writes through the ledger RPC" is actually a **Next** (the RPC must first be ported + corrected + wired). The genuinely-live emergencies are narrower and safer: **the valuation trust bug + uncoordinated `stock_live` writes.**

---

## 4. Phase 0 — Verify ground truth *(≈½ day, before any change)*

1. `list_migrations` on the live Supabase project → does `record_inventory_transaction` / the `inventory_change_logger` trigger **exist** in prod, or only in the unapplied tree?
2. Drift snapshot: for N sample wines, compare `stock_live` vs `SUM(ledger deltas)`.
3. Confirm the real `restaurant_inventory` column set against `DATABASE_SCHEMA.sql`.

**Gate:** if the broken trigger *is* applied, `NEW.wine_id` is actively throwing on stock updates → same-hour hotfix. If not, quarantine is safe dead-code disablement. **Measure, don't guess.**

---

## 5. Phase 1 — NOW: Restore trust *(days → 2 weeks, low-risk, live-path only)*

| # | Fix | Files |
|---|---|---|
| 1.1 | **Honest valuation** — Cost basis (WAC) + Menu potential, both labeled. Fix `NaN` health score. | `Inventory.tsx:1257,781` |
| 1.2 | **Surface Market price** — stop discarding `retail_price_avg`/`markup_ratio` in the mapper; add to DTO/types/column with an "as of \<date\>" badge. | `inventory.service.ts:52` |
| 1.3 | **3-price display** — Market · Purchased (WAC) · Menu per row. Interim WAC from order/`price_history`; exact in Phase 2. | `Inventory.tsx`, `useInventoryPage.ts` |
| 1.4 | **Quarantine ledger + fix lying test** — see §9A. | ledger service + spec |
| 1.5 | **Version guard** on the NestJS PATCH (`WHERE version = expected`, bump). | `inventory.service.ts:281` |
| 1.6 | **Unify status** into one shared definition (DB function) + parity test. | `useInventoryPage.ts:272`, `inventory_engine.py:461` |
| 1.7 | **Wire invoice → manual order** (D8); wire-or-hide QR. | `Inventory.tsx:149`, `InvoiceScannerModal.tsx` |
| 1.8 | **Null-safety** — unknown/fetch-failed ≠ out-of-stock. | `useInventoryPage.ts:143` |
| 1.9 | **Sort Location + Type columns A–Z**; **planned-slot at qty 0** (D12). | `Inventory.tsx:1045,1055,1176`, `LocationPickerCell.tsx` |
| 1.10 | **Fix storage double-click** — hoist `setLocations` out of the `setMappings` updater. | `useStorageLocations.ts:220` |

**Exit criteria:** every money number is labeled and cost-based where it claims to be; no green test asserts a ghost column; `stock_live` has exactly one guarded writer; status is identical across cards, badges, and agents.

---

## 6. Phase 2 — NEXT: Real inventory science *(1–2 quarters — detailed solutions)*

### 6a. Lots as the single source of truth *(the linchpin — first)*

Break `UNIQUE(restaurant_id, wine_id)` on `wine_location_mappings`. Introduce:

```sql
inventory_lots(
  id              UUID PRIMARY KEY,
  restaurant_id   UUID NOT NULL,
  master_wine_id  UUID NOT NULL,
  location_id     UUID NOT NULL,
  qty             INTEGER NOT NULL DEFAULT 0,   -- sealed bottles
  open_bottle_ml  INTEGER NOT NULL DEFAULT 0,   -- one partially-poured bottle (D10)
  unit_cost       NUMERIC,                       -- what THIS lot cost → WAC
  vintage         INTEGER,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_order_id UUID
)
```

**Everything derives** (dual-bookkeeping dies):
- Wine total = `SUM(qty)` (+ open bottles) — no more competing writers.
- Location count = `SUM(qty WHERE location_id=…)` — Sync button removed.
- **WAC (purchased price)** = `Σ(qty×unit_cost) / Σ(qty)`.
- FIFO/FEFO depletion = consume oldest/earliest lot first (vintage-aware).

### 6b. Ledger port + delta writes + optimistic lock + idempotency

| Mechanism | Solution |
|---|---|
| **Delta writes** | `qty = qty + Δ` inside a row-locked RPC. Never compute new stock in app code. |
| **Optimistic lock** | Every write carries `expected_version`; RPC does `WHERE version = expected`, bumps on success. Mismatch → bounded retry w/ fresh read → **fail-loud + enqueue** (kill the silent "retry-3×-then-drop" at `core/database.py:930`). |
| **Idempotency** | Every mutation carries a key (`pos_transaction_id`, `order_id:line`, client UUID). Ledger `UNIQUE(idempotency_key)`; duplicate = no-op returning prior result. Kills webhook double-decrement + double-count. |
| **Port** | New migration in the **live** `supabase/migrations/` tree: corrected `record_inventory_transaction` (`stock_live`+`master_wine_id`, delta, version CAS, idempotent, negative-stock guard). Refactor NestJS `updateInventoryItem`, Python `update_stock`, delivery + buffer paths to call it; forbid direct `UPDATE stock_live`. Nightly **rebase job** asserts `SUM(ledger deltas) == derived stock` and alerts on drift. |

### 6c. Fractional ml / BTG *(D10 — superset, selectable)*

- **Canonical:** sealed `qty` (INTEGER) + `open_bottle_ml` (INTEGER) per lot. Total ml = `qty × bottle_size_ml + open_bottle_ml`.
- **Depletion:** a glass pour subtracts `pour_size_ml` from `open_bottle_ml`; if it can't cover a pour, auto-open a sealed bottle (`qty--`, `open_bottle_ml += bottle_size_ml`). Ledger records pours in ml; waste/spillage in ml.
- **Selectable mode** `stock_display_mode ∈ {bottle, volume}` (per restaurant, overridable per wine), riding on existing `measurementUnit` (ml/oz):
  - `bottle`: "5 btl + 320 ml open"; entry in bottles + optional open.
  - `volume`: total ml/oz (derived); entry in volume, converted back to `qty` + `open_bottle_ml` on write.
- Depletion always operates on canonical fields regardless of display mode.

### 6d. Safety-stock / dynamic reorder point *(replaces static `threshold_min`)*

```
reorder_point = demand_over_lead_time + safety_stock
safety_stock  = z · σ_demand · √(lead_time_days)      # z = 1.65 → 95% service level
order_up_to   = par level   (EOQ = √(2·D·S / H) as refinement)
```
- Demand from a **velocity distribution**, not the flat 7-day mean (`sales_velocity_7d`).
- Lead time from provider data (`leadTimeDays`).
- `threshold_min` demoted to a manual floor; alerts fire off the computed reorder point. (Replaces `reorder_qty = threshold_min × 3` at `procurement_agent.py:176`.)

### 6e. ABC/XYZ + dead-stock *(cheap, high trust-payoff — read-side)*

- **ABC** by annual $ volume (A ≈ top 80%, B ≈ 15%, C ≈ 5%). **XYZ** by demand CV (X steady, Y variable, Z erratic). 9-box → **count frequency** (A weekly, C quarterly) + **forecast method** (Z → Croston/SBA).
- **Dead-stock:** surface existing `last_sold_at` → aging buckets (30/60/90/180d) + capital-tied-up $ (via WAC) → actions (markdown/feature/return).

---

## 7. Phase 3 — BOLD: Signature intelligence *(2–3 quarters, hard-gated on Phase 1+2)*

- **The Living Cellar** — 2.5D isometric twin from real topology (location→rack→row→slot); bins glow by temp drift, fill %, velocity heat, dead-stock "frost." Requires lots (6a).
- **Ambient forecast ribbon** — per-wine days-of-cover sparkline + confidence band (Croston/SBA + seasonality + reservation covers); rows show *reorder-by date*, not a red dot.
- **Cellar Copilot** — activate `GhostInventoryAgent` (POS-vs-physical diff → `inventory_discrepancies` + per-wine trust badge) and `ShrinkageDetectiveAgent`; ABC-driven count routes; **"explain this number"** ledger drill-down.

**Gate:** ships only after honest valuation + ledger-as-truth + unified status are live and verified.

---

## 8. Workstream D — Deal sourcing & fast ordering *(parallel; D11)*

**Principle:** forwarding loses timing — a manager reads/understands/orders faster than a round-trip. The system is **not** in the critical path. Its job: **detect → price → alert → one-tap draft.** The manager still acts in one tap; the system guarantees the deal is captured, priced against market, and turned into an auditable order.

**Tiered sourcing (official only — D11):**

| Tier | Source | Use for | Posture |
|---|---|---|---|
| 1 | **Serper/API** (have it) | Major/public web deals, distributor sites | ✅ Safe |
| 2 | **Own targeted crawler** | Local/exclusive vendor pages Serper indexes poorly; scheduled, low-volume, robots-aware | ✅ Mostly safe |
| 3 | **Official platform APIs** | Telegram Bot (reads channels the bot joins), Meta Graph (public business pages), WhatsApp Business Platform (inbound to *your* number) | ✅ ToS-safe |
| ~~4~~ | ~~Unofficial WhatsApp/IG group reading~~ | — | ❌ Excluded (ban risk) |

All tiers → **Deals Inbox**: LLM extraction (reuse email-intel pipeline) → price against `retail_price_avg` → **instant push notification** → **one-tap "Create draft order."** That one tap *is* the shortcut.

**Note on "business APIs for promo deals":** you don't get an API that reads *other people's* WhatsApp groups. What's ToS-safe: a Telegram bot in vendor channels, Meta Graph for public vendor pages, and your *own* WhatsApp Business number vendors blast. Reading third-party WhatsApp groups needs unofficial clients (excluded per D11).

---

## 9. Detailed solutions

### 9A. Quarantine the ledger + fix the lying test *(D4)*

Quarantine ≠ delete (Phase 2 resurrects a corrected version — keep the design intent):

1. **Disable the reachable-but-broken surface.** Gate `InventoryLedgerController` routes behind `LEDGER_V1_ENABLED=false` (return 501). Nothing can hit the `live_stock` path in prod.
2. **Make the lying test tell the truth.** Convert the `{ live_stock: 10 }` mocks to `.skip` with a reason comment ("quarantined: references ghost column `live_stock`; see Phase 2 port"). CI reads "known-quarantined," not "passing."
3. **Add a schema-guard contract test.** Assert every column the ledger references exists in the real schema (generated types / `information_schema`). *This is the test that would have caught `live_stock`.* Prevents the whole bug class from recurring.
4. **Leave a tombstone.** `LEDGER_V1_DEPRECATED.md` + code comment pointing to the Phase-2 corrected migration.

### 9B. The unifying data flow *(D8 + D9 + valuation + ledger in one line)*

```
Deal (Serper / crawler / official API)  ──► one-tap draft order
Receipt (scan / photo / manual)         ──► InvoiceScannerModal parses line items + costs
        │
        ▼
   ORDER  (attached receipt image + parsed lines: item × count × unit_cost)
        │   "in hand" → live      |     "arriving" → shadow
        ▼
   inventory_LOTS  (qty, unit_cost, location, vintage)   ← single source of truth
        │
        ▼
   LEDGER transaction  (idempotent, versioned, delta)
        │
        ▼
   derives:  wine total · location count · WAC (purchased price) · valuation · status
```

**Orders → click → detail drawer** shows the attached receipt + per-item counts + costs (D9). One flow records off-app purchases, captures true purchased price, populates lots, writes the audit ledger, and files the receipt. One dark feature (invoice scanner) solves four problems.

---

## 10. Real-life example — "Tuesday, 4:47 PM at Bar Vino"

**4:47 PM.** A distributor posts in a Telegram channel the manager, Dana, follows: *"Flash deal — Produttori Barbaresco 2019, $22/btl by the case, tonight only."* The Tier-3 Telegram bot catches it, the LLM extracts `{wine, $22, case}`, prices it against market (`retail_price_avg $41`) → headroom flagged. Dana's phone buzzes: *"Deal: Barbaresco '19 @ $22 (mkt $41). Create order?"*

**4:47:30.** Dana taps **once** → draft PO for 2 cases. No laptop, no lost timing. She confirms with the rep on the same channel.

**Friday.** The cases arrive. Dana photographs the receipt into the **invoice scanner** → parses `24 btl × $22` → creates an **order marked delivered** with the receipt attached → spawns two **lots** (12 → Cellar, 12 → Bar), each `unit_cost $22`. The **ledger** records `+24` (idempotent, versioned). Nothing typed by hand.

**Honest numbers.** Barbaresco now shows **Market $41 · Purchased (WAC) $22 · Menu $58**. Because she'd bought 1 case last month at $26, WAC = `(12×26 + 24×22)/36 = $23.33` — the real blended cost. "Cost basis" rose by exactly `24 × $22 = $528`; "Menu potential" rose separately and is labeled as such. Nobody's off by 3×.

**Saturday service.** A glass is ordered → POS decrements the Bar lot's `open_bottle_ml` by 150; four more glasses and the bottle's empty → a sealed one auto-opens (`qty 12→11`). BTG depletion is finally visible.

**Sunday.** The forecast ribbon tags Barbaresco **A/X** (high value, steady), ~5 btl/week, 4-day lead → reorder point 8, current 30 → "reorder by Nov 2." A Muscadet hasn't poured in 96 days → dead-stock frost, $340 flagged. Dana clicks the cellar value → **"explain this number"** → reads the exact ledger rows. She trusts it — because last time she checked, it was right.

---

## 11. Sequencing, dependencies & risks

**Dependency order:** Phase 0 → 1.1–1.8 (any order) → 6a (lots) unblocks 6b/6c/6e and exact WAC → 6b before Phase 3 → Phase 3. Workstream D runs parallel after 1.7 (order/receipt path).

| Risk | Mitigation |
|---|---|
| Lots migration corrupts live stock | Phase 0 snapshot + backfill lots from current `stock_live` in a transaction; rebase job verifies parity before cutover. |
| "Two migration trees" reapplied out of order | Reconcile to a single tree in Phase 2; delete/neutralize the broken one. |
| Quarantine hides a *live* prod dependency | Phase 0 confirms zero callers before disabling. |
| BTG selectable mode confuses counts | Canonical fields are mode-independent; mode is display/entry only. |
| Deal crawler breakage / ToS creep | Tier 2 stays low-volume + robots-aware; Tiers 1&3 are the backbone; Tier 4 excluded. |

---

## 12. Gaps & Counter-Design (two-lens review synthesis)

Two review lenses — an architecture "edge-finder" and a brutal traditionalist "premortem" — were run against this plan. Both respected the good bones (immutable ledger for audit, honest cost valuation) and converged on **one crux decision**, now adopted as **D14**:

> **Count is truth; perpetual is the audit trail.** Build the lot/ledger model so it *can* be exact, but make the number people *see and trust* a periodic count re-based against the ledger. Ship `open_bottle_ml` + forecasting as opt-in (D15), off by default. This single change defuses the top-3 premortem failures (BTG ml always wrong → distrust; WAC rots; counts never done) without giving up the architecture.

### 12.1 Architecture gaps to close (from the artist lens)
1. **Lots backfill (D16)** — the migration from one `stock_live` int to per-location, per-cost lots was unspecified. Genesis lot + `cost_provenance` labeling fixes it.
2. **Transfers as a balanced primitive (D18)** — two linked ledger rows in one txn, cost-preserving.
3. **Point-in-time balance must aggregate lots** — redesign `get_inventory_balance_at()` to sum over lots and accept a `location_id`/`lot_id` filter ("what was in the bar at 6pm Saturday").
4. **Deal→wine-not-in-library** — one-tap draft must provision a `master_wine_library` row before creating the lot (lot's `master_wine_id` is NOT NULL).
5. **Shadow only accrues on confirmed/ordered state, never on draft** — abandoned deal drafts must not inflate shadow.

### 12.2 Edge-case catalog (must be handled, not discovered in prod)
| Scenario | Required behavior |
|---|---|
| Backfill: N bottles, no location/cost | Genesis lot, `unassigned` loc, `cost_provenance='estimated'` |
| Lot →0 then restocked | New lot; WAC recomputes from live lots; old COGS preserved in ledger |
| Free goods ("11 for the price of 10") | Blended `unit_cost` = paid/received, labeled |
| Same wine, two vintages | WAC per (wine, vintage); roll up for display only |
| Corked/returned bottle | Ledger `waste`/`return` reason against the specific lot |
| Two bartenders, one open bottle | Version/lock on the *lot*, not just the wine row |
| Move open bottle between locations | Transfer carries `open_bottle_ml`, not just `qty` |
| Count while POS pours | Count writes a reconciliation delta vs. a snapshot, never an absolute |
| Delete a location holding lots | Block, or force-reassign to `unassigned` |
| Late POS webhook → negative on-hand | Clamp at 0 + emit `discrepancy` event (never silently absorb) |
| Partial/over delivery | Received qty is truth (D17); reconcile shadow to exactly 0 |
| Deal price below WAC | Auto-flag "your cost is above market" (buying-intelligence moment) |

### 12.3 Invariants to assert + monitor (nightly rebase job)
- `Σ(lots.qty) == displayed on-hand == opening + Σ(ledger deltas)` per wine → page on drift.
- `0 ≤ open_bottle_ml < bottle_size_ml`; `qty ≥ 0`; every lot has a `location_id` (or explicit `unassigned`).
- Every transaction has an `idempotency_key`; every transfer is a balanced pair.
- `markup_ratio` recomputes when *either* WAC or menu price changes (not only on Serper refresh).

### 12.4 Creative edges worth adopting
- **Bottle biographies** — ledger links lot→order→receipt→deal, so any pour answers "where did this glass come from?" (deal date, received date, WAC). Free once lots+ledger exist; no competitor has it.
- **Temperature excursions as ledger events** — a fridge failure logs a `quality_event` against that location's lots ("40 bottles saw 68°F for 6h"). Turns a dead free-text field into risk intelligence.
- **Reserved lots** — model the D12 qty-0 planned slot as `lot.status='reserved'`; pre-planning and real stock share one model.

### 12.5 Premortem-driven MVP — "the 20% that actually gets used"
Ship in this order; everything else is opt-in, triggered by a felt need:
1. **Honest cost-based valuation + 3 prices** (Market / Purchased / Menu), every number labeled. ← *first build slice*
2. **One correct on-hand number**, re-based by a **simple periodic count sheet** (by location, printable).
3. **Manual order + receipt attach** (D8/D9) — captures off-app buys and *real invoice cost*. Highest ROI; the WAC feeder.
4. **Human-set par + low-stock alert.** Computed reorder point is a quiet *suggestion*, never the driver.
5. **One deal channel + one-tap draft.**

**Defer until earned:** per-location lots, `open_bottle_ml`, forecast ribbon, ABC/XYZ automation, the crawler mesh, the Living Cellar. Each is a Phase-2+ option, not a foundation.

### 12.6 Data-reality red flags (label, don't silently trust)
- `safety_stock = z·σ·√LT` has neither a real σ (intermittent demand) nor a real lead-time distribution today → confident garbage. Ship as suggestion beside the human par.
- WAC quality is capped by receiving discipline; today's "purchased price" is the *library* price, not invoice cost. Until receipts reliably capture cost, WAC is data-entry-quality — **label its provenance** (D16).

---

## 13. Future plans — Mudavym expansion *(post–wine trust, not scheduled)*

> Canonical vision: [`.planning/FUTURES.md`](./FUTURES.md). Ultimate goal remains a **full autonomous restaurant backend**. Sequencing: **wine → full beverages → bakery → rest of kitchen**.

Inventory implications when the product expands under **Mudavym**:

| Stage | Inventory / UX work | UX anchor |
|---|---|---|
| **1 — Beverages** | Catalog + filters: `domain=beverage` → subsection (`wine`, `beer`, `cocktail`, `hard_alcohol`, `na`) → subtype (e.g. wine/red, spirits/gin). Each leaf item: fine-grained attributes + photos (wine depth as the bar). | Inventory command table filters + detail |
| **1 — Cocktail recipes** | Composed SKUs get a **Recipes** section — build sheet, linked ingredient SKUs, pour specs, method, garnish, optional cost roll-up from lot WAC. | `RowExpansion` on `/inventory` (`apps/web/src/pages/inventory/command/RowExpansion.tsx`) |
| **2 — Bakery (first food)** | `domain=food` → `bakery`: ingredients, intermediates, finished goods. MVP: catalog+photos, pars/alerts, manual recipes, manual waste, simple POS finished-good decrement. North star adds full BOM explosion + spoilage intelligence. | Same inventory surfaces + recipe panel |
| **3 — Rest of kitchen** | Broader food subsections after bakery proves the model. | — |

**Notes:**
- Wine bottle rows stay as-is (vintage, par, cellar location); recipes apply to **composed** items (cocktails, bakery finished goods) only.
- Ingredient lines should deplete linked inventory SKUs (pour-through / recipe costing), gated on Phase 2 lots + ledger trust.
- Schema early: `domain ∈ {beverage, food, supply}`, `subsection`, `subtype`, plus type-specific attribute packs — so UI can branch without a later rewrite.
- Do not invent a thinner product row model; extraction + photos must match wine’s finest-feature standard (see FUTURES §4).

**Trigger:** Promote from ROADMAP backlog 999.x when wine inventory trust (this plan’s Phase 1–2) is earned.

---

## Appendix A — File reference index

- Page: `apps/web/src/pages/Inventory.tsx` (Total Value `:1257`, health `:781`, Type th `:1045`, Location th `:1055`, qty `||1` `:1176`, dead invoice state `:149`)
- Page hook: `apps/web/src/pages/inventory/useInventoryPage.ts` (stats `:269`, status `:272`, `||0` `:143`)
- Storage: `apps/web/src/hooks/useStorageLocations.ts` (nested setState `:220`); `components/inventory/LocationPickerCell.tsx`, `StorageLocationManager.tsx`
- Orders: `apps/web/src/pages/orders/CreateOrderModal.tsx`; `pages/Orders.tsx` (shadow on place `:576`, deliver `:629`)
- Invoice: `apps/web/src/components/inventory/InvoiceScannerModal.tsx`
- Backend: `apps/api-gateway/src/inventory/inventory.service.ts` (mapper strips wine row `:52`, PATCH `:281`); `inventory-ledger/inventory-ledger.service.ts` (`live_stock` `:453,461`)
- Tests: `apps/api-gateway/src/__tests__/inventory-ledger.service.spec.ts` (`live_stock` mocks `:336,384`)
- Migrations (live): `supabase/migrations/20260410000000_phase10_pricing.sql` (`retail_price_avg`), `20260220110000_volume_refinements.sql` (`stock_live`), `20260304020000_wine_location_mappings.sql` (UNIQUE constraint), `20260415000000_inventory_stock_version.sql` (`version`)
- Migrations (orphaned): `services/database/migrations/005_calendar_recurrence_and_inventory_ledger.sql` (RPC `live_stock` `:366`), `006_inventory_auto_logging_triggers.sql` (`NEW.wine_id` `:52`)
- Python: `services/agent-orchestrator/core/database.py` (`update_stock` CAS `:867`, drop-on-retry `:930`); `agents/inventory_engine.py` (`:461`); `agents/buffer_manager.py`; `agents/procurement_agent.py` (`:176`); `agents/{shrinkage_detective,ghost_inventory}_agent.py` (stubs)
- Pricing pipeline: `services/agent-orchestrator/jobs/score_tasks.py` (Serper→Wine-Searcher, `:210`); `config/settings.py` (`serper_cost_per_query` `:59`)
