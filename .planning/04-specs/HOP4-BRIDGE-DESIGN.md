# Hop-4 sense→act bridge — implementation-ready design

- **Code anchor:** `origin/main` @ `b70e62d9`, read from a clean detached worktree. Every `file:line` is that tree.
- **Data anchor:** production Supabase `exzueerziesmczwlhomd`, read-only `SELECT`, measured **2026-09-01**. Every number tagged *measured* is from that session; every number tagged *modelled* shows its arithmetic.
- **Builds on:** the ephemeral `hop4-bridge.md` findings pass, which it **supersedes and absorbs** (that scratch file is gone; nothing else retires for it — this is the detailed design [ECOSYSTEM-PLAN.md](ECOSYSTEM-PLAN.md) §6 E1 points at, and the plan's E1 bullet is its index entry). That pass's structural findings hold; **four of its claims are corrected here** — see §0.2.
- **Scope:** design only. No production code was written for it.
- **Commissioned by the founder, 2026-09-01**, in these words: *"everything in detail, proof planned, and designed carefully to mimic real world exactly as is."* That is why §3 (real-world fidelity) and §4 (the proof plan) carry the weight rather than the mechanical tracing, and why the **autonomy posture is left as a runtime parameter rather than resolved** — the founder asked for the design and its proof, not for a posture to be picked on their behalf. (c) is recorded as the standing recommendation in §8 F1 with the shadow metrics that would overturn it.
- **Blocking prerequisite:** slice 0 is closing the ungated `procurement_agent` path (PR #196) and its sibling in `rfq_agent` — **two** ungated par-crossing→vendor paths are known. Shipping this bridge while either is open is a gate beside an open door.

---

## 0. Orientation

### 0.1 What is being built, in one paragraph

The output half of the seam already exists and is in production: `ai_proposed_actions` (`supabase/migrations/20260827140000_ai_proposed_actions.sql`) is a propose→confirm→execute ledger whose confirm gate is a **database CHECK**, whose confirm is a **compare-and-swap** (`apps/api-gateway/src/ask-ai/ask-ai.service.ts:529-554`), and whose `procurement.reorder` executor is `ProcurementService.createOrder` (`ask-ai.service.ts:918-926`). What is missing is a **non-human proposer**. This document designs that proposer — `ParCrossingBridge`, a NestJS gateway service — plus the crossing-episode ledger it needs to not flood, the spend cap that does not exist anywhere in the repo, the notification surface, and the proof plan that must pass before a human sees one card or a vendor sees one order.

### 0.2 Corrections to the prior pass

| Prior claim | Correction | Evidence |
|---|---|---|
| "an approved order self-suppresses: `v_low_stock_items` excludes `IN_TRANSIT`" | **Wrong in the live path.** `inventory_state` is written only by the dormant Python `inventory_engine.py:136,300,433,461`; nothing in the gateway sets `IN_TRANSIT`. `approveOrder` calls `reserveOrderShadowStock` (`procurement.service.ts:854-862` → `:776-817`), which moves `shadow_stock` and `in_transit_quantity` — **neither is in the view's predicate**. `stock_live` rises only at `markDelivered` (`:903-1000`). So a crossing stays crossed for the **whole vendor lead time** (`providers.lead_time_days DEFAULT 7`, `baseline:4864`). Open-order suppression must be an **explicit check**, not an emergent property. | `baseline:6048`; `procurement.service.ts:776-817`, `:854-862`, `:903-1000` |
| "3,242 recorded crossings, replay them as the backtest" | `inventory_alert_state.alert_count` is a **counter, not a time series** — there is no per-crossing history in it (`baseline:3154-3163`). A stock-history replay from `inventory_transactions` is also impossible: **4 rows total, 3 `live`, 2 SKUs** *(measured)*. The only real corpus is the `notifications` instant bursts. See §4.4. | *measured*; `baseline:3223-3251` |
| "quantity = `threshold_min × 2 − stock_live`" | Over-orders by roughly **2×** against a modelled restaurant's actual wine COGS (§3.3 arithmetic). Replaced with a par-restoring rule plus explicit case-pack rounding, and the over-order risk named on the card. | §3.3 |
| "`one_tap_actions` is the wrong base" | Confirmed. `triggerWorkflow` switches on `action.actionType`; `LOW_STOCK` is `// TODO` at `one-tap-actions.service.ts:408`, `custom` falls to `default:` at `:425`. | `one-tap-actions.service.ts:407-428` |

### 0.3 The production picture, measured 2026-09-01

| Quantity | Value |
|---|---|
| Restaurants / with ≥1 active provider | **10 / 2** |
| Active SKUs / of those with no `provider_id` | **64 / 3** |
| SKUs below par right now (`v_low_stock_items`) | **64 of 64** |
| Active providers | 14 (all inside the 2 restaurants) |
| SKUs with *any* usable price (`negotiated_price`/`last_purchase_price`/`custom_price`) | **50 of 64 (78%)** |
| `price_history` rows | **0** |
| `restaurant_feature_flags` rows with `flag_name='restaurant_settings'` | **0** |
| `ai_proposed_actions` rows ever | **0** |
| `procurement_orders` rows ever | **2** |
| Low-stock **instant bursts** (2026-07-17 → 2026-08-31, 46 days) | **159**, across **5** restaurants |
| Crossing **lines** inside those bursts | **1,960** (avg 12.33/burst, max 50) |
| Distinct wines producing those 1,960 lines | **60** → **32.7 re-announcements per wine** |
| Lines where `currentStock = 0` | **1,952 of 1,960 (99.6%)** |
| Worst single day | **317 lines** |

The last three rows are the empirical heart of this design. Sixty wines generated 1,960 "new crossing" events in 46 days while **never leaving zero stock**. A proposer keyed on crossings emits ~33× what it should. A proposer keyed on **episodes** emits ~60.

---

## 1. Data design

### 1.1 New table — `par_crossing_episodes`

The bridge's own ledger. It must **not** reuse `inventory_alert_state`: that table is owned by the notification engine, its reset path (`low-stock-alerts.service.ts:423-451`) is the mechanism that manufactures false crossings, and coupling money to it means a notification refactor silently changes purchasing.

```sql
-- supabase/migrations/<ts>_par_crossing_episodes.sql
create table if not exists public.par_crossing_episodes (
  id                    uuid primary key default gen_random_uuid(),

  restaurant_id         uuid        not null,
  inventory_id          uuid        not null,

  -- WHEN ------------------------------------------------------------------
  opened_at             timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  closed_at             timestamptz,
  close_reason          text,

  -- EVIDENCE AT THE OPEN (immutable; this is what was true when we acted) --
  opened_stock_live     integer     not null,
  opened_threshold_min  integer     not null,
  opened_severity       text        not null,

  -- ADVANCED EVERY SWEEP ---------------------------------------------------
  last_stock_live       integer     not null,
  last_threshold_min    integer     not null,
  worst_stock_live      integer     not null,
  observations          integer     not null default 1,
  suppressed_crossings  integer     not null default 0,

  -- WHAT THE BRIDGE DECIDED ------------------------------------------------
  outcome               text        not null default 'pending',
  outcome_reason        text,
  proposal_id           uuid,
  proposed_quantity     integer,
  proposed_unit_cost    numeric(10,2),
  proposed_total_cost   numeric(10,2),
  rank_score            numeric(14,4),

  -- AUDIT ------------------------------------------------------------------
  decision_log_id       uuid,
  correlation_id        text,
  bridge_mode           text        not null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint par_crossing_episodes_severity_ck
    check (opened_severity in ('low','critical')),

  constraint par_crossing_episodes_close_reason_ck
    check (close_reason is null or close_reason in
      ('recovered','item_deactivated','item_deleted','par_removed',
       'order_delivered','operator_closed','tenant_disabled')),

  -- A closed episode must say WHY. Splitting this from the timestamp keeps the
  -- failure specific about which half is missing (same posture as
  -- ai_proposed_actions_confirmation_is_attributed).
  constraint par_crossing_episodes_close_is_attributed
    check (closed_at is null or close_reason is not null),

  constraint par_crossing_episodes_outcome_ck
    check (outcome in (
      'pending',              -- seen, not yet decided this sweep
      'proposed',             -- a row exists in ai_proposed_actions
      'shadow_would_propose', -- shadow mode: would have proposed
      'suppressed_cap',       -- over the per-window cap; ranked below the line
      'suppressed_ceiling',   -- over the open-proposal ceiling
      'suppressed_novelty',   -- identical to a recently confirmed proposal
      'suppressed_rule',      -- reserved for posture (b); unreachable in v1
      'skipped_no_provider',
      'skipped_no_price',
      'skipped_spend_cap',
      'skipped_open_order',
      'skipped_tenant_off',
      'error')),

  -- A proposal id can only exist on an episode that actually proposed.
  constraint par_crossing_episodes_proposal_implies_proposed
    check (proposal_id is null or outcome = 'proposed'),

  -- Shadow mode can never carry a proposal id. This is the structural half of
  -- "shadow writes nothing to money": application code can forget, a CHECK cannot.
  constraint par_crossing_episodes_shadow_never_proposes
    check (bridge_mode <> 'shadow' or proposal_id is null),

  constraint par_crossing_episodes_quantity_positive
    check (proposed_quantity is null or proposed_quantity >= 1),

  constraint par_crossing_episodes_bridge_mode_ck
    check (bridge_mode in ('shadow','propose','notify'))
);
```

**Nullability rationale, column by column.**

| Column | Type | Null | Why |
|---|---|---|---|
| `restaurant_id`, `inventory_id` | `uuid` | NOT NULL | the episode identity; a row without both is unaddressable |
| `opened_at` | `timestamptz` | NOT NULL | the episode id in time |
| `last_seen_at` | `timestamptz` | NOT NULL | drives the stale-episode close (§1.4) |
| `closed_at` | `timestamptz` | **NULL** | NULL *is* the open state, and the partial unique index below depends on it |
| `close_reason` | `text` | NULL | paired to `closed_at` by CHECK |
| `opened_stock_live`, `opened_threshold_min`, `opened_severity` | | NOT NULL | the evidence a proposal was made on. Written once, never updated. A proposal defended by evidence that has since been overwritten defends nothing. |
| `last_*`, `worst_stock_live` | | NOT NULL | advanced each sweep; `worst_stock_live` feeds the rank |
| `observations` | `integer` | NOT NULL, default 1 | how many sweeps saw this episode |
| `suppressed_crossings` | `integer` | NOT NULL, default 0 | **how many would-be proposals this one episode absorbed.** This is the metric that proves §4.4's 32.7× claim in production. |
| `outcome` | `text` | NOT NULL, default `'pending'` | every episode has a disposition, always |
| `proposal_id` | `uuid` | NULL | no FK, deliberately — see below |
| `proposed_*`, `rank_score` | | NULL | absent when the episode did not propose |
| `decision_log_id`, `correlation_id` | | NULL | best-effort audit; the sweep must not fail because an audit write did |
| `bridge_mode` | `text` | NOT NULL | **which posture produced this row.** Without it the shadow corpus and the live corpus are indistinguishable a month later, and the backtest becomes unfalsifiable. |

**No foreign keys, and why.** `ai_proposed_actions` carries an FK only on `nf_event_id` and none on `restaurant_id`/`created_by` (`20260827140000_ai_proposed_actions.sql`). The bridge follows that precedent for a stronger reason: a hard delete of a `restaurant_inventory` row must not silently erase the record of what was proposed for it. Inventory is soft-deleted here (`deleted_at`, `baseline:3295`), so the real path is `close_reason='item_deleted'`, not a cascade. Table-name honesty is kept by `scripts/check_queried_tables_exist.py` (`ci.yml:357`), not by referential integrity.

### 1.2 Indexes

```sql
-- THE IDEMPOTENCY MECHANISM. At most one open episode per (restaurant, item),
-- enforced by the database, so two concurrent sweeps cannot both open one.
create unique index if not exists par_crossing_episodes_one_open
  on public.par_crossing_episodes (restaurant_id, inventory_id)
  where closed_at is null;

-- The ranking / capping query: "what is open and undecided for this tenant".
create index if not exists par_crossing_episodes_open_ranked
  on public.par_crossing_episodes (restaurant_id, rank_score desc nulls last)
  where closed_at is null;

-- The shadow readout and the post-launch monitors.
create index if not exists par_crossing_episodes_history
  on public.par_crossing_episodes (restaurant_id, opened_at desc);

-- Join back from a proposal to its episode.
create index if not exists par_crossing_episodes_proposal
  on public.par_crossing_episodes (proposal_id)
  where proposal_id is not null;
```

### 1.3 RLS, in the creating migration

```sql
alter table public.par_crossing_episodes enable row level security;

drop policy if exists par_crossing_episodes_service_role on public.par_crossing_episodes;
create policy par_crossing_episodes_service_role on public.par_crossing_episodes
  for all to service_role using (true) with check (true);
```

No `authenticated` policy — the browser reaches this only through the gateway, the posture `ai_proposed_actions` already took. No `REVOKE` needed: `20260825210000_od72_revoke_client_grants.sql:183`'s `alter default privileges` ratchet means a table created after it arrives with no client grants. `scripts/check_new_tables_are_locked_down.py` (`ci.yml:377`) enforces both arms and **will fail the PR** if RLS is in a follow-up migration.

### 1.4 The episode state machine

An episode is a maximal run of "this item is below its par". The state is `(closed_at IS NULL)`; the transitions are what the sweep does.

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
   item appears in  │                                              │
   v_low_stock_items│                                              │
        ──────────► ● OPEN ──────────────────────────────────────► ● CLOSED
                    │  opened_at, evidence frozen                  │  closed_at, close_reason
                    │                                              │
                    │◄── item still in view ──┐                    │
                    │    last_seen_at := now  │                    │
                    │    observations += 1    │                    │
                    │    worst := min(...)    │                    │
                    │    suppressed_crossings │                    │
                    │      += 1 if the alert  │                    │
                    │      ledger says "new"  │                    │
                    └─────────────────────────┘                    │
                                                                   │
   item reappears in view after close ─────────────────────────────┘
        ──────────► NEW episode, new id, new opened_at
```

**Transition table.** The sweep query returns one set: the rows currently in `v_low_stock_items`, grouped by restaurant. Call that set `L`.

| # | Condition | Episode action | Proposal action |
|---|---|---|---|
| T1 | item ∈ `L`, no open episode | `INSERT ... ON CONFLICT (restaurant_id, inventory_id) WHERE closed_at IS NULL DO NOTHING`; freeze `opened_*`; `outcome='pending'` | evaluated this sweep (§2.3) |
| T2 | item ∈ `L`, open episode exists | `last_seen_at=now`, `observations+=1`, `worst_stock_live=LEAST(worst, stock_live)`, `last_*` refreshed | **nothing.** The open episode already holds the disposition. |
| T3 | item ∈ `L`, open episode, `inventory_alert_state` says this was a "new crossing" | as T2, plus `suppressed_crossings+=1` | **nothing** — and this counter is the proof of suppression |
| T4 | item ∉ `L`, open episode, **and the sweep query succeeded and `L` was non-empty for this restaurant** | `closed_at=now`, `close_reason='recovered'` | open proposal → `discarded`, reason `recovered`; §2.6 |
| T5 | item ∉ `L`, open episode, **but the sweep returned an error or an empty set for a restaurant that had rows last tick** | **no change** — the guard | nothing |
| T6 | item row is now `is_active=false` / `deleted_at IS NOT NULL` (checked directly, not via `L`) | `closed_at=now`, `close_reason='item_deactivated'` / `'item_deleted'` | open proposal → `discarded` |
| T7 | `threshold_min` set to 0 or the row leaves tracking | `closed_at=now`, `close_reason='par_removed'` | open proposal → `discarded` |
| T8 | a `procurement_orders` row for `(restaurant, inventory)` reaches `DELIVERED`/`COMPLETED` | `closed_at=now`, `close_reason='order_delivered'` | n/a (the proposal already executed) |
| T9 | `last_seen_at` older than `PAR_BRIDGE_EPISODE_STALE_DAYS` (default **30**) | `closed_at=now`, `close_reason='operator_closed'`, `outcome_reason='stale'` | open proposal → `expired` |
| T10 | tenant flag flipped off | `closed_at=now`, `close_reason='tenant_disabled'` | open proposals → `discarded` |
| T11 | item ∉ `L`, episode already closed | nothing | nothing |
| T12 | item ∈ `L` after a close | **T1 again** — a *new* episode, new id, new `idempotency_key` | a new proposal is legitimate |

**T5 is the whole point.** `getLowStockByRestaurant` returns an **empty map on query error** (`low-stock-alerts.service.ts:463-466`), and `reconcileRecoveries` then treats every ledger row as recovered (`:433-447`) — which is a sufficient mechanism for the measured 32.7 re-announcements per wine. The bridge must not inherit it. The guard is stated precisely:

> A restaurant's episodes may only be closed by a sweep that (a) did not error, and (b) returned a non-empty row set for **some** restaurant. A globally empty result is treated as "the query is broken", never as "everyone restocked".

That last clause matters: with all 10 tenants' items below par, a genuinely empty `v_low_stock_items` is far more likely to be a broken query than a universal restock. If the founder's data ever legitimately empties, T9's 30-day staleness close cleans up; nothing is stranded.

### 1.5 Oscillation around par — the case the machine must survive

A wine at par 6 with stock oscillating `5 → 6 → 5 → 6` across sweeps (a spot count correcting itself, a pour then a return, a manual edit).

| Sweep | stock | In `L`? | Episode | Proposals emitted |
|---|---|---|---|---|
| 1 | 5 | yes | **E1 opens** | 1 |
| 2 | 6 | no | E1 closes `recovered`; the open proposal is **discarded** | 0 |
| 3 | 5 | yes | **E2 opens** | 1 |
| 4 | 6 | no | E2 closes `recovered` | 0 |

Four sweeps, two proposals, both discarded before anyone saw them. That is correct-but-noisy, and at a 2-minute cadence a genuine oscillator could produce 360 episodes/day. **So the machine needs one more rule, and it is not optional:**

> **Reopen damping.** An episode may not open for a `(restaurant, inventory)` whose most recent closed episode has `closed_at` within `PAR_BRIDGE_REOPEN_COOLDOWN_MINUTES` (default **720**, i.e. 12 h) **and** whose close reason was `recovered`. The crossing is recorded on the *previous* episode's `suppressed_crossings` instead.

Twelve hours is chosen against real restaurant physics, not convenience: a par crossing that genuinely reverses inside one service was a counting error, not a purchase. A wine that truly falls below par and is restocked inside 12 hours was restocked from the back bar — no order was needed. And a wine that falls below par, is ordered, and is delivered inside 12 hours does not exist: `providers.lead_time_days` defaults to **7** (`baseline:4864`).

With damping, the oscillator above yields **one** episode per 12 h, not 360/day.

### 1.6 The idempotency key, and why it cannot double-emit

```
idempotency_key = 'parbridge:' || episode.id::text
```

Three **independent** layers, none relying on another:

| Layer | Mechanism | Where enforced |
|---|---|---|
| 1. One open episode per item | partial UNIQUE index `par_crossing_episodes_one_open` | Postgres |
| 2. One proposal per episode | `ai_proposed_actions.idempotency_key text not null unique` (`20260827140000:…`) | Postgres |
| 3. One open PO per (restaurant, item, provider) | `createOrder`'s merge — an existing non-terminal order is **updated**, not duplicated (`procurement.service.ts:247-336`) | application, at the executor |

Layer 1 fails → layer 2 still refuses a second proposal for the same episode id. Layers 1 *and* 2 fail → layer 3 still refuses a second purchase order. The key is derived from the episode row's own primary key, so it is unforgeable and needs no clock, no random suffix, and no read-before-write. Contrast the Ask AI key, `askai:{rid}:{Date.now()}:{random}` (`ask-ai.service.ts:430-432`), which can never collide and therefore de-duplicates nothing — correct for a human who just asked, useless for a sweep.

**Race analysis.** Two gateway instances sweep the same restaurant simultaneously:

1. Both read `L` and see item X with no open episode.
2. Both attempt the T1 insert. Postgres serialises them on the partial unique index; **one wins**, one gets a conflict and takes the `DO NOTHING` path, then re-reads the winner's row and follows T2.
3. Only the winner holds an episode id, so only the winner mints `parbridge:<id>` and inserts the proposal.
4. If the winner crashes between (2) and (3), the episode exists with `outcome='pending'` and no proposal. The **next sweep** finds an open, pending episode and proposes then. Idempotent by construction: `outcome='pending'` is the retry state, and the proposal insert's UNIQUE key makes the retry safe even if the crash happened *after* the insert committed.

### 1.7 Additive columns on `ai_proposed_actions`

All nullable or defaulted; existing rows and the Ask AI path are unaffected; the `ai_proposed_actions_open` index is unchanged.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `proposer_type` | `text` | yes | — | `'human' \| 'service' \| 'agent'`. Today `created_by` is the only attribution and it is NULL for a machine, so "who proposed this" is currently unanswerable for anything but Ask AI. |
| `proposer_name` | `text` | yes | — | `'par_crossing_bridge'`. Free text, because the set of proposers will grow and a CHECK here would be a merge conflict generator. |
| `autonomy_tier` | `text` | yes | `'propose_only'` | CHECK `in ('propose_only','gated_rollout','trusted_auto')`. **Only `propose_only` is reachable in v1**; the CHECK is where widening becomes a deliberate edit, per `ACTION-SCHEMA-SPEC.md` §144-151. |
| `episode_id` | `uuid` | yes | — | join to `par_crossing_episodes` |
| `trigger_ref` | `jsonb` | yes | — | the crossing evidence rendered on the card |
| `expires_at` | `timestamptz` | yes | — | §2.6 |
| `decision_log_id` | `uuid` | yes | — | audit join; `ACTION-SCHEMA-SPEC.md:100-103` invariant #3 |
| `estimated_unit_cost` | `numeric(10,2)` | yes | — | spend-cap input, **frozen at propose time** |
| `estimated_total_cost` | `numeric(10,2)` | yes | — | ditto |

Plus two constraints and one index:

```sql
-- A human proposal must name the human. A machine proposal must name the machine.
-- An anonymous proposal is the defect these columns exist to remove.
alter table public.ai_proposed_actions
  add constraint ai_proposed_actions_proposer_is_attributed check (
    (proposer_type = 'human' and created_by is not null)
    or (proposer_type in ('service','agent') and proposer_name is not null)
    or proposer_type is null            -- pre-existing rows; Ask AI backfills to 'human'
  );

alter table public.ai_proposed_actions
  add constraint ai_proposed_actions_autonomy_tier_ck check (
    autonomy_tier is null or autonomy_tier in ('propose_only','gated_rollout','trusted_auto')
  );

create index if not exists ai_proposed_actions_expiring
  on public.ai_proposed_actions (expires_at)
  where status = 'proposed' and expires_at is not null;
```

### 1.8 The reorder payload must carry money

`createOrder` computes `finalPrice = dto.finalPrice ?? dto.quotedPrice ?? 0` and `totalCost = dto.totalCost ?? finalPrice * quantity` (`procurement.service.ts:243-244`). Ask AI's executor passes **none** of them (`ask-ai.service.ts:919-924`). **Therefore every order created through this spine today records `final_price = 0` and `total_cost = 0`.**

Consequence: a spend cap that reads `procurement_orders.total_cost` measures **zero, forever, silently**. That is precisely this repo's documented failure shape — a Vision cap that never once fired, cited in `ask-ai.controller.ts:20-22`.

So the reorder action schema must widen:

```ts
// apps/api-gateway/src/ask-ai/ask-ai-actions.ts — ReorderAction.payload
{
  inventoryId: string;
  providerId:  string;
  quantity:    number;
  unitType?:   string;
  unitCost?:   number;   // NEW — numeric, >= 0, <= MAX_REORDER_UNIT_COST
  totalCost?:  number;   // NEW — must equal round(unitCost * quantity, 2) or be rejected
}
```

`validateAction` (`ask-ai-actions.ts:121-214`) constructs the payload explicitly key-by-key, so an unvalidated extra key is *dropped*, not passed through — which is why this is a schema edit and not a jsonb convenience. Two new rules, both **reject, never coerce**, matching the file's stated posture (`:9-20`):

- `unitCost` present ⇒ finite, `>= 0`, `<= MAX_REORDER_UNIT_COST` (propose **2,000**; a $2,000/bottle wholesale line is a hand-placed order, not a sweep's).
- `totalCost` present ⇒ must equal `Math.round(unitCost * quantity * 100) / 100` within 1 cent. **An internally inconsistent money payload is rejected**, because the cap is checked against `totalCost` and a divergence between the two is how a cap gets walked around.
- Both absent ⇒ still valid (Ask AI's existing behaviour is preserved), but the **bridge** refuses to propose without them (§5.3).

Then `execute` (`ask-ai.service.ts:918-926`) forwards them into `CreateOrderDto` as `quotedPrice`/`totalCost`, so the PO carries real money for the first time.

### 1.9 Flags and configuration

**Per-restaurant**, on the `restaurant_feature_flags` settings row (`SETTINGS_ROW_FLAG_NAME = 'restaurant_settings'`, `feature-flag-registry.ts:36`):

| Column | Type | Default | Note |
|---|---|---|---|
| `enable_auto_procurement` | `boolean not null` | **false** | the name is **already reserved** in `feature-flag-registry.ts:184-187` as INACTIVE, pointing at the Python reorder path. Promoting it to `ACTIVE_FEATURE_FLAGS` requires a real `readBy` file:line, enforced by `scripts/check_flag_readby_anchors.py` (`ci.yml:291`). |
| `procurement_weekly_cap_usd` | `numeric(10,2)` | NULL | NULL ⇒ fall back to the process default. Never NULL-means-unlimited. |

> ⚠ **The OD-86 trap, measured.** `restaurant_feature_flags` currently holds **zero** rows with `flag_name='restaurant_settings'` *(measured)*. Every reader must therefore treat a **missing row as OFF**, exactly as `isAutonomousSendEnabled` does (`inbound-responder.service.ts:1009`, registry `:64-70`). A reader that `.single()`s and throws, or that falls back to "enabled", reproduces the OD-86 defect on the money path.

**Process-level env**, all read **inside the cron body**, never only at module registration:

| Var | Default | Meaning |
|---|---|---|
| `PAR_BRIDGE_MODE` | `off` | `off` \| `shadow` \| `propose` \| `notify` — the global kill switch and the stage dial in one variable |
| `PAR_BRIDGE_MAX_PROPOSALS_PER_WINDOW` | `5` | posture (c)'s K |
| `PAR_BRIDGE_MAX_OPEN_PROPOSALS` | `15` | the ceiling across all windows |
| `PAR_BRIDGE_WINDOW` | `daily` | `daily` \| `vendor_window` (§3.4) |
| `PAR_BRIDGE_WEEKLY_SPEND_CAP_USD` | `2000` | rolling-7-day fallback when the per-restaurant column is NULL |
| `PAR_BRIDGE_PROPOSAL_TTL_DAYS` | `7` | §2.6 |
| `PAR_BRIDGE_REOPEN_COOLDOWN_MINUTES` | `720` | §1.5 |
| `PAR_BRIDGE_EPISODE_STALE_DAYS` | `30` | T9 |

> **The flag must be on the path it claims to guard.** `ux-optimizer.service.ts:38-40` records this repo's own version of the mistake, verbatim: a `AUTO_APPLY = false` constant "referenced in no conditional and therefore guarded nothing… A guardrail that is not on the path it claims to guard is worse than none: it gets believed." `PAR_BRIDGE_MODE` is therefore read at the top of every `runSweep()` invocation and again immediately before the proposal insert — two reads, because a long sweep must be killable mid-flight.

---

## 2. Control flow

### 2.1 Runtime: the NestJS gateway

Not the Python orchestrator. Three reasons, and one of them is new since the prior pass:

1. The live crossing detector (`low-stock-alerts.service.ts:85`), the gate (`ask-ai.service.ts:521`) and the executor (`procurement.service.ts:213`) are all in the gateway. A Python bridge adds a fourth cross-runtime hop over the RabbitMQ seam.
2. OD-03 (runtime bake-off) is unresolved and `.planning/04-specs/ECOSYSTEM-PLAN.md:91` locks "harden the existing seam, do not migrate either way". A gateway-native bridge is neutral under either outcome.
3. **New:** the spend cap needs the price columns on `restaurant_inventory` and the open-order check on `procurement_orders`, both of which the gateway already reads with tenant-scoped, guard-checked queries (`check_queried_tables_exist.py`). A Python implementation duplicates all of it in `core/database.py`, where `procurement_agent.py:199-201` already reads a key (`reorder_quantity`) that **does not exist on the table** — evidence that the duplicate is the unreliable copy.

`auto_pilot_agent.py` stays `IS_STUB = True` (`:16`). The orchestrator refuses to start a stub (`orchestrator.py:258-264`), which is the property to preserve, not remove.

### 2.2 Trigger

```ts
@Cron("*/15 * * * *", { name: "par-crossing-bridge" })   // every 15 minutes
async runSweep(): Promise<void>
```

**Why 15 minutes and not the alert engine's 2** (`low-stock-alerts.service.ts:85`): the bridge's output is a purchase suggestion, whose actionable resolution is a vendor's next delivery window — days, not minutes. A 2-minute cadence buys nothing and multiplies the blast radius of any bug by 7.5×. Fifteen minutes bounds worst-case propose latency at 15 minutes, which is invisible next to a 7-day lead time.

Plus a manual trigger, copying `low-stock-alerts.service.ts:146-157` and `recurring_order_agent.py:144-145`, so an operator (and the test suite) can force a sweep without waiting:

```ts
async triggerSweep(opts?: { restaurantId?: string; dryRun?: boolean }): Promise<SweepReport>
```

`dryRun` forces `bridge_mode='shadow'` for that invocation regardless of `PAR_BRIDGE_MODE`. It can never force the other direction.

### 2.3 The proposer, step by step

One sweep, in order. Every step names its skip outcome so nothing silently vanishes.

```
 0. mode := env(PAR_BRIDGE_MODE); if 'off' → log a decision_log row saying
    "sweep skipped, mode=off" and return. (An unrun sweep and a sweep that
    found nothing must not look the same — recurring_order_agent.py:243-262.)

 1. L := SELECT * FROM v_low_stock_items          -- one query, all tenants
    if error  → decision_log 'par_bridge_sweep_failed'; DO NOT close anything (T5); return
    if |L| = 0 → decision_log 'par_bridge_sweep_empty'; DO NOT close anything (T5); return

 2. for each restaurant R in L:
    2a. if not enable_auto_procurement(R)  → outcome 'skipped_tenant_off' on
        every open episode for R; do not close them; continue
    2b. advance/open episodes per §1.4 T1–T3
 3. close episodes per T4, T6–T10 (only reached because step 1 succeeded)

 4. candidates := open episodes with outcome IN ('pending','suppressed_cap',
                  'suppressed_ceiling','suppressed_novelty')
    -- previously-suppressed episodes are re-evaluated every sweep, so an
    -- episode that lost a ranking race is not condemned by it forever

 5. for each candidate C:                          -- HARD FILTERS, in order
    5a. provider_id IS NULL                   → 'skipped_no_provider'
    5b. no active provider for R              → 'skipped_no_provider'
        (createOrder would throw no_vendors anyway, procurement.service.ts:235-241)
    5c. an open procurement_orders row exists for (R, inventory)
        with status NOT IN (terminal set)     → 'skipped_open_order'
    5d. unit price unresolvable (§5.3)        → 'skipped_no_price'
    5e. quantity resolves to < 1              → 'skipped_no_price' (reason 'qty_zero')
    5f. rolling-7d proposed spend + this      → 'skipped_spend_cap'
        proposal's totalCost > cap
    5g. an identical proposal for this SKU was
        confirmed within the novelty window   → 'suppressed_novelty'

 6. rank the survivors (§2.4); take the top K for this window
    -- the rest get 'suppressed_cap' with their rank recorded, so the shadow
    -- data answers "what would a bigger K have bought?"

 7. for each selected C:
    if mode = 'shadow'  → outcome 'shadow_would_propose'; record the full
                          payload, idempotency_key, rank and cost in
                          outcome_reason/proposed_* ; WRITE NOTHING ELSE
    else                → INSERT ai_proposed_actions (§2.5); on success
                          outcome 'proposed', proposal_id set
                          on UNIQUE violation → outcome 'proposed' with
                          outcome_reason 'idempotent_replay' (the retry case)

 8. if mode = 'notify' and anything was proposed → ONE grouped notification
    per restaurant per digest window (§2.7)

 9. one decision_log row per restaurant per sweep, ALWAYS, including empty
```

**Step 5c is the correction from §0.2.** Because `stock_live` does not rise until `markDelivered`, a crossing whose order is already placed stays in `v_low_stock_items` for the full lead time. Without 5c the bridge would re-propose the same purchase every sweep for a week — capped, ranked, and completely wrong. The terminal set is exactly `procurement.service.ts:251-259`: `CONFIRMED, IN_TRANSIT, DELIVERED, COMPLETED, CANCELLED, REJECTED, FAILED`. Anything else (`PENDING`, `APPROVAL_NEEDED`, `NEGOTIATING`, `APPROVED`, `PARTIALLY_RECEIVED`) counts as an order in flight.

### 2.4 Ranking

```
rank_score = dollars_at_risk × urgency × staleness

dollars_at_risk = estimated_total_cost                        (the size of the decision)
urgency         = 1 + (threshold_min - stock_live) / max(threshold_min, 1)
                                                              (1.0 at par, 2.0 at zero stock)
staleness       = 1 + min(days_since_opened, 7) / 7           (1.0 fresh, 2.0 at a week)
```

Every input is measurable and stored on the episode, so the ranker is **gradable**: the shadow corpus records the rank of every episode including the ones below the line, which makes "was the ranking wrong?" a query rather than an opinion.

Explicitly **not** in the rank: `sales_velocity_7d`. It is `0.000` for every SKU in production; a rank that multiplies by it collapses to zero everywhere and the sort becomes arbitrary. When velocity becomes real, adding it is a one-term change and a re-run of the backtest — that ordering is deliberate.

`urgency` is bounded at 2.0 rather than unbounded because `threshold_min - stock_live` can be large for a high-par item and would otherwise dominate the dollars term, which is the term the founder actually cares about.

### 2.5 The payload

```jsonc
{
  "restaurant_id":   "<uuid>",
  "created_by":      null,
  "proposer_type":   "service",
  "proposer_name":   "par_crossing_bridge",
  "autonomy_tier":   "propose_only",

  "family":          "procurement",
  "action_type":     "reorder",
  "payload": {
    "inventoryId":   "<uuid>",
    "providerId":    "<uuid>",
    "quantity":      12,
    "unitType":      "bottles",
    "unitCost":      22.00,
    "totalCost":     264.00
  },

  "summary":  "Reorder 12 bottles of Sancerre 2023 from Winebow — 1 on hand, par 6. Est. $264.",
  "utterance": "[par_crossing_bridge] episode 9f2c… opened 2026-09-01T14:10Z: stock_live 1 < threshold_min 6 (severity low), 3 observations, provider Winebow.",

  "trigger_ref": {
    "episode_id":      "<uuid>",
    "inventory_id":    "<uuid>",
    "opened_at":       "2026-09-01T14:10:00Z",
    "stock_live":      1,
    "threshold_min":   6,
    "worst_stock_live":1,
    "severity":        "low",
    "observations":    3,
    "suppressed_crossings": 0,
    "quantity_basis":  "par_restore_case_rounded",
    "price_basis":     "negotiated_price",
    "rank_score":      792.0,
    "rank_position":   2,
    "window":          "2026-09-01"
  },

  "status":            "proposed",
  "idempotency_key":   "parbridge:<episode_id>",
  "episode_id":        "<uuid>",
  "expires_at":        "2026-09-08T14:10:00Z",
  "estimated_unit_cost":  22.00,
  "estimated_total_cost": 264.00,
  "decision_log_id":   "<uuid>",
  "nf_event_id":       null
}
```

**`utterance` is `NOT NULL`** on the table and has no natural meaning for a sweep. Rather than inventing a fake human sentence, the bridge writes a machine-readable provenance line prefixed `[par_crossing_bridge]`. The column's own comment says it exists so a wrong proposal "can only be judged against what was actually said" — for a sweep, what was said *is* the trigger, and this is it verbatim.

**`nf_event_id` is NULL, and the confirm path must survive that.** `gradeResolution` already returns early on a null event id (`ask-ai.service.ts:724`), so a bridge proposal confirms and executes normally and simply contributes no model-quality verdict — correct, since no model was called. This is worth stating because it means the existing `confirmation_v1` grader silently sees *fewer* rows once the bridge ships, and a dashboard reading "confirmations graded" as a health metric would show a decline that is not a regression. Instrument bridge proposals on `par_crossing_episodes.outcome`, not on `nf_verdict`.

### 2.6 The full proposal state machine

The existing statuses are `proposed | confirmed | executed | discarded | failed` (`20260827140000:…`). The bridge adds no status; `expired` is modelled as `discarded` with a reason, so no CHECK widens and no existing reader breaks.

| State | Entered by | Exits to | Notes |
|---|---|---|---|
| `proposed` | bridge insert (§2.3 step 7) | `confirmed`, `discarded` | the only state a human can act on. `listOpen` returns at most **20** (`ask-ai.service.ts:483`) — see §7 A4. |
| `confirmed` | `POST /ask-ai/actions/:id/confirm`, compare-and-swap on `status='proposed'` (`:529-541`) | `executed`, `failed`, or back to `proposed` via `releaseClaim` (`:740-751`) | transient. A double tap loses the CAS and gets 404 "no longer waiting", not a second order (`:547-553`). |
| `executed` | `createOrder` returned an id (`:645-655`) | terminal | the DB CHECK guarantees `confirmed_by`, `confirmed_at`, `executed_at` are all set |
| `failed` | executor threw (`:671-685`) | terminal | `failure_reason` recorded; the episode goes to `outcome_reason='execution_failed'` and **stays open**, so the next sweep re-evaluates it as a fresh candidate |
| `discarded` (operator) | `POST /ask-ai/actions/:id/discard` (`:691-718`) | terminal | episode gets `outcome_reason='operator_discarded'`. **The episode does not close** — the item is still below par. It is marked so the bridge does not re-propose within the episode. |
| `discarded` (recovered) | bridge, T4 | terminal | `failure_reason='episode_recovered'` |
| `discarded` (expired) | bridge, TTL | terminal | `failure_reason='expired_after_7d'` |

**Expiry, precisely.** Each sweep, before proposing:

```sql
UPDATE ai_proposed_actions
   SET status = 'discarded', failure_reason = 'expired_after_7d', updated_at = now()
 WHERE status = 'proposed'
   AND proposer_name = 'par_crossing_bridge'
   AND expires_at IS NOT NULL AND expires_at < now();
```

Scoped to `proposer_name` so the bridge can never expire a human's Ask AI proposal — those have `expires_at IS NULL` and are untouched by the predicate anyway, but the extra clause makes the intent unforgeable by a future index change.

### 2.7 When the human ignores it

On today's data this is the *normal* case, so it is designed, not defaulted.

| Question | Answer |
|---|---|
| Does an ignored proposal become an order? | **No, structurally.** `ai_proposed_actions_execution_requires_confirmation` is a database CHECK. There is no code path, flagged or otherwise, by which time converts a `proposed` row into an `executed` one. |
| Is there a reminder? | **No second notification for the same episode, ever.** The proposal count rides inside the existing daily low-stock digest (`low-stock-alerts.service.ts:338-385`) as a line — "6 reorder proposals waiting" — never as its own push. A reminder is how approval fatigue starts. |
| Does it re-propose? | Only on a **new episode**, i.e. after an observed recovery followed by a re-crossing, past the 12 h reopen damping. An expired proposal inside a still-open episode leaves the episode at `outcome_reason='proposal_expired'` and the bridge stays silent. |
| What if the manager discards it? | Terminal for that episode. The item stays below par and stays in the digest count; the bridge does not argue. |
| What happens at the ceiling? | Above `PAR_BRIDGE_MAX_OPEN_PROPOSALS`, nothing new is proposed and **one** notification says "N items below par, proposals paused until you clear the queue". One, not N. |

### 2.8 The human gate surface

`ai_proposed_actions` is pull-only (`listOpen`, `ask-ai.service.ts:473-491`). Correct for Ask AI — the human just asked. Wrong for a bridge.

**Notification** — reuse the funnel, do not build a second one:

```ts
await this.notifications.persistForRestaurant(restaurantId, {
  type:        "procurement_proposals",
  title:       `${n} reorder proposal${n === 1 ? "" : "s"} ready`,
  message:     summaryLine,                       // "Sancerre, Chablis, +3 more — est. $1,140"
  priority:    "medium",                          // NOT "critical": a proposal is not an emergency
  actionUrl:   "/orders?tab=proposals",
  actionLabel: "Review proposals",
  groupKey:    `par_proposals:${restaurantId}:${yyyy_mm_dd}`,
  metadata:    { count: n, totalEstimatedCost, episodeIds, suppressedCount },
}, {
  dedupeWithinMinutes: 12 * 60,                   // mirrors DIGEST_DEDUPE_MINUTES, :54
  onlyUserIds: managerAndOwnerIds,                // see below
});
```

- **One grouped row per restaurant per window, never one per proposal.** `persistForRestaurant` writes one row *per member* (`notifications.service.ts:662-679`) and pushes to phones at `:717-719`, so N proposals × M members = N×M rows and N×M pushes. The grouping is not cosmetic.
- `priority: "medium"` deliberately. `"critical"` is what the low-stock engine uses for a genuine stockout (`low-stock-alerts.service.ts:294-295`); a purchase suggestion competing at that level devalues the real one.
- **Targeting.** `getRestaurantMemberIds` (`database.service.ts:70-90`) returns **all** active members with **no role filter**. The bridge must supply `onlyUserIds` from a role-scoped query against `user_restaurant_access`, or every line cook gets a phone push about purchasing. Production has 10 restaurants, 6 owner-only (prior pass), so in practice this is often an audience of one — which is an argument for getting the targeting right, not for skipping it.
- **Preferences.** A restaurant that turned low-stock alerts off (`getEffectiveLowStockPrefs`, `:485-528`) has said something about proposals too. The bridge reads the same prefs and stays silent when `enabled === false`. It does **not** stop proposing — the rows still appear for anyone who looks; it stops *interrupting*.

**The card.** `apps/web/src/components/askai/ProposalCard.tsx` already renders a proposal with an editable payload and confirm/discard. Two gaps to close:

1. **Discoverability.** Open proposals are fetched only when the Ask AI bar opens (`AskAiBar.tsx:100-111`), and the bar opens only on ⌘⇧K (`AskAiSurface.tsx`). There is **no badge, no count, no ambient surface.** So "S3 — proposals visible but not pushed" is, today, *invisible*, not merely quiet. Either accept that (S3 becomes a pure database-observation stage the founder reads via SQL) or add a count badge — and a badge **is** a push, so it belongs at S4, not S3. This document takes the first option and says so.
2. **No bulk action.** No route, no UI. Fifteen open proposals is fifteen separate taps through a modal. §3.6.

**Mobile: nothing exists.** Zero `ask-ai` references under `apps/mobile/src` (grepped). The phone push from `persistForRestaurant` (`:717-719`) would land on a device with nowhere to go. Fork F5.

---

## 3. Real-world fidelity

The rest of this design is only worth building if it matches how a restaurant actually buys wine. This section states the model, shows the arithmetic, and then walks eight concrete situations.

### 3.1 The modelled restaurant — stated as a model

Not measured; production has no real demand (`sales_velocity_7d = 0.000` everywhere, `pos_checks` synthetic). This is a **stated model** with its arithmetic exposed so the founder can disagree with a number rather than with a conclusion.

| Parameter | Value | Basis |
|---|---|---|
| Active wine SKUs | 120 | mid-size wine-forward restaurant |
| Covers | 90/night × 6 nights = 540/wk | |
| Wine attachment | 0.6 bottle-equivalents/cover | |
| Bottle-equivalents sold | 540 × 0.6 = **324/wk** | |
| Avg check | $85 → revenue $45,900/wk | |
| Wine share of revenue | 25% → **$11,475/wk wine revenue** | |
| Markup | 3.2× → **wine COGS ≈ $3,586/wk** | this is the anchor everything else is checked against |
| Avg wholesale bottle | $22 | $3,586 ÷ 163 bottles/wk purchased ≈ $22 |
| Distributors | 3, each ordering 1×/week | |

**Pareto split of the 324 bottle-equivalents/week:**

| Tier | SKUs | Share of volume | Bottles/wk | Per SKU/wk | Par (2 wk cover, min 3) | Cycle (wk) | Crossings/wk |
|---|---|---|---|---|---|---|---|
| Fast | 24 (20%) | 60% | 194 | 8.1 | 16 | 16/8.1 = 2.0 | 24/2.0 = **12.0** |
| Mid | 36 (30%) | 30% | 97 | 2.7 | 6 | 6/2.7 = 2.2 | 36/2.2 = **16.4** |
| Tail | 60 (50%) | 10% | 32 | 0.54 | 3 | 3/0.54 = 5.6 | 60/5.6 = **10.7** |
| | **120** | | **324** | | | | **≈ 39/wk ≈ 5.6/day** |

*(Cycle here = par ÷ velocity = how long a full par lasts, which is how often the item crosses if it is reordered back to par each time.)*

**Cross-check.** 39 crossings/wk each reordering back to par: fast 12.0×16=192, mid 16.4×6=98, tail 10.7×3=32 → 322 bottles/wk purchased vs 324 sold. ✅ Consistent within 1%. Dollars: 322 × $22 = **$7,084/wk**, which is **2.0× the $3,586 COGS anchor**. ❌ Inconsistent — and the inconsistency is informative: it means **reordering "back to par" every time an item touches par buys twice what the restaurant consumes.** The resolution is that a real buyer does not restore full par on every crossing; they buy roughly *one cycle of consumption*, which is by definition equal to sales. So:

> **Steady-state truth: purchases must equal consumption. 324 bottles/wk ÷ 39 crossings/wk = 8.3 bottles per order; × $22 = $183 per order.** Any quantity rule whose average proposal materially exceeds ~8 bottles / ~$183 for this restaurant is over-ordering, and over a year the difference is working capital and cellar space.

The prior pass's `threshold_min × 2 − stock_live` rule gives, for a fast mover (par 16, crossing at 15): 32 − 15 = **17 bottles, $374** — **2.0× too big**, exactly the discrepancy above. That rule is rejected. See §3.3.

### 3.2 The timing model — this is what breaks a daily cap

Crossings are not uniform in time, for three reasons that are all physical:

1. **Service depletes in bursts.** A wine crosses par at 9pm on a Saturday, not at 11am on a Tuesday.
2. **Covers are not uniform.** ~70% of covers fall Thursday–Saturday for a restaurant of this shape.
3. **Deliveries reset cohorts.** Everything that arrives Thursday crosses again together, weeks later.

Applying (2): of 39 crossings/wk, ≈ 27 land Thu–Sat (**9/day**) and ≈ 12 land Sun–Wed (**3/day**).

**And the manager sits down on Monday morning.** So the real load case is not "5.6 cards/day". It is:

> **~27 proposals waiting at 9am Monday, and ~3/day for the rest of the week.**

**A daily cap of K=5 fails this in exactly the wrong direction.** It throttles the Monday batch — which is when the buyer is actually working and when the Tuesday-noon order deadline bites — while doing nothing at all Tuesday through Thursday, when 3/day is already under the cap. The cap protects the manager on the days they do not need protection and gets in their way on the day they do.

*Production corroborates the burstiness even without real demand:* the measured instant-alert distribution was **Sun 264.7 lines/day, Sat 317, Mon 184.7, Fri 70.0, Wed 15.0** *(measured, 12 active days of 46)*. Weekend-and-Monday heavy, midweek near-silent — the shape the model predicts, for a different underlying reason.

### 3.3 The quantity rule

**v1 rule, stated fully:**

```
raw          = threshold_min - stock_live                      // restore to par, no further
pack         = case_pack(inventory)                            // see below
quantity     = max(1, ceil(raw / pack) * pack)
quantity     = min(quantity, MAX_REORDER_QUANTITY)             // 500, ask-ai-actions.ts:112
```

`case_pack` resolution, in order: `restaurant_inventory.unit_type = 'CASE'` ⇒ 12; else `providers.minimum_order` if it is a plausible pack (1–24); else **1** (order singles). No invented default of 12 — inventing a case pack turns a 1-bottle need into a $264 proposal, which is precisely the over-order failure.

**Check against the model.** Fast mover, par 16, crosses at 15 → raw 1 → pack 12 → **12 bottles, $264**. Mid, par 6, crosses at 5 → raw 1 → pack 12 → **12 bottles, $264**. Tail, par 3, crosses at 2 → raw 1 → pack 1 → **1 bottle, $28**.

Weighted: (12.0 × 264) + (16.4 × 264) + (10.7 × 28) = 3,168 + 4,330 + 300 = **$7,798/wk** — still **2.2× the $3,586 anchor.** The case-pack rounding re-inflates what restoring-to-par saved.

**This is not a bug in the rule; it is the real world.** A restaurant that crosses par by one bottle and buys a case *is* over-buying relative to that week's consumption — and it is what actually happens, because the vendor sells cases and the truck comes once a week. The over-buy shows up as inventory, not as waste, and it self-corrects: the next crossing for that SKU is a case's worth of consumption later, so the **crossing rate falls** to match. Re-deriving with case-sized cycles: fast mover cycle becomes 12/8.1 = 1.5 wk (crossings 16/wk — higher), mid becomes 12/2.7 = 4.4 wk (crossings 8.2/wk — lower), tail unchanged. New total ≈ 16 + 8.2 + 10.7 = 35/wk, dollars = (16×264)+(8.2×264)+(10.7×28) = 4,224+2,165+300 = **$6,689/wk**. Still 1.9× the anchor.

**The honest conclusion, and it is a finding, not a caveat:** *any* per-SKU, restore-to-par, case-rounded rule over-proposes against a real restaurant's wine COGS by roughly 2×, because par is set for **stockout protection**, not for **turn**, and pars in the wild are usually generous. Three consequences the design must carry:

1. **The spend cap is not a safety net; it is a load-bearing part of the quantity design.** At ~$6,700/wk proposed against ~$3,600/wk of real COGS, a weekly cap set near actual COGS will fire *routinely*, and that firing is the signal that pars are wrong (§3.7), not a malfunction.
2. **The card must show the arithmetic** — "1 below par, 12/case, est. $264" — so a manager can see the pack rounding and edit it down. `ProposalCard.tsx` already supports editing; the edit path re-validates (`ask-ai.service.ts:603-614`).
3. **The edit rate is the primary quality metric for the quantity rule.** `executed_payload` exists precisely to separate "the proposer was right" from "a human made it right" (`20260827170000_ai_proposed_actions_edits.sql:11-19`). If >40% of confirms are edited on quantity, the rule is wrong and the fix is velocity-based sizing (`inventory-science.ts:175-192`), not a bigger cap.

### 3.4 The delivery window — and why the cap should be per-window, not per-day

A real restaurant does not order continuously. It orders when its rep's truck runs: *"order by Tuesday noon for Thursday delivery."* Three distributors × one window each = **three ordering moments per week**, not seven.

So a crossing is not an order trigger. **A crossing is an item added to a list that gets sent on a window day.**

This changes the cap's unit:

| Cap unit | Behaviour on the modelled week | Verdict |
|---|---|---|
| `daily`, K=5 | 27 Monday proposals throttled to 5; 22 pushed to Tue/Wed at 5/day; the Tuesday-noon deadline is missed for most of the weekend's crossings | throttles when it should not, idles when it could |
| `vendor_window`, K=8 per vendor per window | Monday's 27 split ~9 per distributor; each gets its own list before its own cutoff | matches the physical process |

`PAR_BRIDGE_WINDOW = 'vendor_window'` is the right long-run answer and is **not** a v1 requirement, for one concrete schema reason: `procurement_orders` is **one row per SKU** — `inventory_id uuid NOT NULL` and `provider_id uuid NOT NULL` (`baseline:4518-4519`). There is no multi-line order object. A "vendor sheet" is therefore N proposals to one vendor, which is exactly what posture (c) with a per-vendor cap already produces. The window is a **grouping and cap key**, not a new entity — which is why it can be a config value in v1 and a UI concept later, with no migration in between.

**Recommended v1:** ship `daily` as the default because it is simpler to reason about, ship `vendor_window` behind the same env var, and **let the shadow data decide** (§4.6 measures both, since both are computable from the same episode ledger offline).

### 3.5 Eight real situations

| # | Situation | What the bridge does | Correct? |
|---|---|---|---|
| 1 | **Delivery arrives in a batch.** Thursday truck brings 6 SKUs. | `markDelivered` raises `stock_live` (`procurement.service.ts:903-1000`). Next sweep: all 6 leave `v_low_stock_items` → T4 closes 6 episodes → any open proposals discarded `recovered`. | ✅ Yes. And this is the **only** path that closes an ordering episode, since `stock_live` moves nowhere else. |
| 2 | **Partial delivery.** Ordered 12, 7 arrive, 5 backordered (`PARTIALLY_RECEIVED`, `dto:24`). | `stock_live` +7. If 7 ≥ par → T4 closes. If 7 < par → the item stays in `L`, the episode stays open, and 5c still sees a non-terminal order (`PARTIALLY_RECEIVED` is not in the terminal set, `:251-259`) → `skipped_open_order`. No duplicate proposal. | ✅ Yes, and it is load-bearing that `PARTIALLY_RECEIVED` is outside the terminal set. If a future refactor adds it, the bridge double-orders the backorder. **This is a named regression risk → guard, §4.2.** |
| 3 | **The par is wrong (too high).** Someone set par 24 on a wine selling 0.5/wk. | The item sits below par permanently. **Episode 1 opens, proposes once, and then never proposes again** — because the episode never closes (no recovery) and reopen requires a close. The item's `observations` and `suppressed_crossings` climb. | ✅ Yes — **exactly one wrong proposal, not thirty-three.** This is what the measured 32.7×-per-wine number becomes under the episode key. The digest keeps counting it, which is the correct pressure to fix the par. |
| 4 | **The par is wrong (too low).** Par 3 on a wine selling 8/wk. | Crosses, proposes 12 (case), delivered, crosses again in 1.5 wk. Bridge proposes every 1.5 wk forever. Never wrong per-proposal; systematically noisy. | ⚠️ **Partially.** The bridge cannot detect a too-low par without velocity. It is right about each order and blind to the pattern. The `observations`/episode-frequency data it accumulates is exactly the input a par-suggestion feature (hop 10) would need — recorded, not acted on. |
| 5 | **Vendor discontinues the SKU.** Winebow drops the wine; nobody deactivates it in the app. | The bridge proposes; a human confirms; `createOrder` succeeds (it validates the *provider* is active, `procurement.service.ts:219-241`, and the *item* exists, `ask-ai.service.ts:803-822` — neither checks that this vendor still carries this wine); the vendor email goes out and bounces back "discontinued". | ❌ **No, and nothing in the repo can catch it.** There is no vendor-catalogue link: `restaurant_inventory.provider_id` is a single nullable uuid (`baseline:3263`) with no product-availability table behind it. The mitigations are downstream and human: the inbound responder classifies the reply (`inbound-responder.service.ts`), and the order sits `APPROVED` until someone cancels. **Named as a real, unclosed gap — F4.** |
| 6 | **One vendor, many SKUs.** All 24 fast movers come from Southern. | 24 separate proposals, 24 separate `procurement_orders` rows, 24 separate vendor emails via `approve-draft`. | ❌ **No.** This is the schema's one-row-per-SKU shape (`baseline:4518-4519`) meeting reality, and the bridge makes it 24× more visible than it is today (2 orders ever). **Per-vendor capping (§3.4) bounds the count; it does not merge the emails.** Merging requires a multi-line order concept — out of scope, named as F3. |
| 7 | **Bulk Monday approval.** 27 proposals waiting at 9am. | The manager presses ⌘⇧K, gets a modal, and taps confirm **27 times**, each firing its own `POST /ask-ai/actions/:id/confirm`, its own `verifyStoredAction` (2 queries, `:803-822`), and its own `createOrder`. `listOpen` caps at **20** (`:483`), so **7 are invisible until 20 are cleared.** | ❌ **No.** The gate does not scale to the load the bridge creates. **This is the single strongest reason the cap is required rather than advisable**, and it is why S4 must not ship without either a bulk surface or a cap low enough that 20 is never approached. F2. |
| 8 | **An intentional stockout.** A wine is being retired from the list; the manager is running it out. | It falls below par, stays below, never recovers. **One proposal**, then silence for that episode. If the manager discards it, terminal. If they ignore it, it expires in 7 days and never returns while the episode stays open. | ✅ Yes, and the episode key is what makes it so. But the *right* action is deactivating the item (`is_active=false`), which closes the episode (T6) and stops the digest counting it. The card should say so — an inline "retire this wine" affordance is the correct product answer and is cheap. |

### 3.6 What the eight cases add up to

Five ✅, one ⚠️, two ❌. The two failures (5, 6) and case 7 are **not bridge defects** — they are pre-existing shape limits (no vendor catalogue; one-row-per-SKU orders; no bulk confirm) that the bridge is the first feature to load-test. That is worth saying plainly to the founder: **the bridge does not create these problems, it is the first thing that makes them hurt.** Shipping it without a cap makes all three hurt at once, on a Monday.

### 3.7 A note on staffing

Who actually taps confirm? In this repo's production tenants, 6 of 10 restaurants are owner-only. In a real 120-SKU restaurant it is a beverage director or a GM who buys once or twice a week, between 9am and noon, on a phone as often as a laptop. Three design consequences already carried above: the digest window should land **before** the ordering deadline, not after (default the digest to the morning, and `getEffectiveLowStockPrefs` defaults `digestTime` to `12:00` — `low-stock-alerts.service.ts:497`, which is *at or after* a typical Tuesday-noon cutoff and should be reconsidered per tenant); the surface must be reachable in three taps, not behind ⌘⇧K; and the mobile hole (§2.8) is not cosmetic.

---

## 4. The proof plan

The requirement: **every claim the design makes about its own behaviour has a stated way to prove it before it touches a human or a vendor.** Seven layers, in the order they must pass. Each states what it proves, what it *cannot* prove, its pass criterion, and its stop criterion.

### 4.0 The claims being proved

| # | Claim | Proved by |
|---|---|---|
| C1 | The bridge cannot create an order without a human confirmation record. | 4.1 (DB), 4.2 (guard), 4.3 (unit), 4.5 (integration) |
| C2 | The bridge cannot emit two proposals for one crossing episode. | 4.1 (index), 4.3, 4.5, 4.6 (backtest) |
| C3 | Episode keying suppresses ~97% of raw crossing events. | 4.6 backtest, then 4.7 shadow |
| C4 | The bridge never proposes above the spend cap. | 4.3, 4.5, 4.7 |
| C5 | The bridge never proposes for an item with no provider or no price. | 4.3, 4.5, 4.7 |
| C6 | The bridge never re-proposes for an item with an order already in flight. | 4.5, 4.7 |
| C7 | Turning `PAR_BRIDGE_MODE=off` stops it, mid-flight. | 4.3, 4.5, 4.9 |
| C8 | Shadow mode writes nothing to `ai_proposed_actions`. | 4.1 (CHECK), 4.2 (guard), 4.5 |
| C9 | The proposal volume a human sees is bounded by K. | 4.6, 4.7, 4.8 |
| C10 | The quantity rule does not systematically over-order. | 4.6 (offline dollars), 4.8 (edit rate) |

### 4.1 Layer 1 — structural proof (the database)

Not a test; a property. Four constraints must exist and be exercised by a migration test that asserts each **rejects** its violation:

| Constraint | Rejects |
|---|---|
| `ai_proposed_actions_execution_requires_confirmation` (existing) | `status='executed'` without `confirmed_by`/`confirmed_at`/`executed_at` |
| `ai_proposed_actions.idempotency_key … unique` (existing) | a second proposal for the same episode |
| `par_crossing_episodes_one_open` (new, partial unique) | a second open episode for one `(restaurant, inventory)` |
| `par_crossing_episodes_shadow_never_proposes` (new) | a shadow row carrying a `proposal_id` |

**Pass:** four `INSERT`s that must fail, fail with the named constraint. **Cannot prove:** that application code *reaches* the table correctly — only that the table refuses the bad shape.

### 4.2 Layer 2 — CI guards (static, before anything runs)

Per the repo's own rule (solve it once ⇒ add a guard), and per `scripts/check_voice_gate_coverage.py`'s pattern: **a guard must exit 2 when it cannot check**, and must be provable against the pre-fix tree with `--self-test`.

| Guard | Rule | Exit 2 when |
|---|---|---|
| `check_proposal_gate_coverage.py` | No code path outside `AskAiService.confirm` may write `confirmed_by`, `confirmed_at`, `executed_at`, or `status IN ('confirmed','executed')` on `ai_proposed_actions`. Every writer of that table is either `AskAiService` or on an ALLOWLIST with a stated reason. | it cannot statically resolve a `.from("ai_proposed_actions")` call site |
| `check_bridge_shadow_is_inert.py` | In `par-crossing-bridge.service.ts`, every `.from("ai_proposed_actions").insert` and every `notifications.persistForRestaurant` call must be **lexically dominated** by a `mode !== "shadow"` guard. | the file's control flow is not statically analysable |
| `check_terminal_status_set_is_shared.py` | The bridge's open-order check and `procurement.service.ts:251-259` must read the **same** exported constant. Prevents case 2's named regression. | the constant is not found in both |
| `check_flag_readby_anchors.py` (existing, `ci.yml:291`) | `enable_auto_procurement` promoted to ACTIVE must cite a real `readBy` file:line | — |
| `check_new_tables_are_locked_down.py` (existing, `ci.yml:377`) | `par_crossing_episodes` ships RLS in its creating migration | — |
| `check_queried_tables_exist.py` (existing, `ci.yml:357`) | every table the bridge names exists. **Note:** this guard fails when its unresolvable-call-site count *grows* (`ask-ai.service.ts:784-790`), so the bridge must use string literals in `.from()`, never a variable. | — |

**Pass:** all six green, and the three new ones each fail on a deliberately broken fixture (`--self-test`). **Cannot prove:** runtime behaviour, or that the allowlist entries are honest.

### 4.3 Layer 3 — unit tests (pure, no DB)

The whole point of the design's shape is that the decisions are pure functions of an episode row plus config. Extract them and test them exhaustively.

| Function | Cases |
|---|---|
| `classifyTransition(item, episode, sweepHealth)` | all 12 rows of §1.4's table, including T5 (empty sweep) and T12 (reopen after close) |
| `shouldDampReopen(lastClosed, now, cooldown)` | closed 1 min ago / 11 h 59 m / 12 h 01 m; closed with reason ≠ `recovered` (must not damp) |
| `resolveQuantity(stock, par, pack, max)` | par 6 stock 5 pack 1 → 1; pack 12 → 12; stock 0 par 24 pack 12 → 24; par 600 stock 0 pack 1 → **500 (capped)**; par 3 stock 3 → **not a crossing, must not be called** |
| `resolveUnitCost(row)` | precedence `negotiated → last_purchase → custom`; all three NULL → `null`; a `0.00` price → **`null`, not zero** (a zero price defeats the cap) |
| `rankScore(episode)` | monotone in dollars; urgency 1.0 at par, 2.0 at zero; staleness saturates at 7 d; NULL cost → excluded before ranking, never ranked as 0 |
| `applyCaps(ranked, K, ceiling, openCount)` | K=0 → nothing; ceiling reached → nothing + one suppression notice; exactly K survivors, rest tagged `suppressed_cap` **with their rank recorded** |
| `withinSpendCap(rolling7d, thisCost, cap)` | at cap → reject; 1¢ under → accept; cap NULL → uses process default, **never unlimited** |
| `buildPayload(episode, item, provider)` | output passes `validateAction` unmodified; `totalCost === round(unitCost × quantity, 2)`; `idempotency_key === 'parbridge:' + episode.id` |
| `isExpired(proposal, ttl, now)` | boundary at exactly `expires_at` |

**Pass:** 100% branch coverage on these nine functions; every case above green. **Cannot prove:** that the sweep wires them together correctly, or anything about concurrency.

### 4.4 Layer 4 — the backtest, and what it can honestly be

**The prior pass's proposed backtest is not possible.** `inventory_alert_state` is a counter table with no history (`baseline:3154-3163`), and the stock ledger is empty: `inventory_transactions` holds **4 rows, 3 `live`, 2 SKUs** *(measured)*.

**What does exist** is the low-stock instant-alert corpus. `fireInstantAlert` writes one notification per burst carrying `metadata.wines[]` with `{wineId, wineName, currentStock, threshold, severity}` (`low-stock-alerts.service.ts:315-327`) and a timestamped `group_key` (`:315`). Measured:

| | Value |
|---|---|
| Distinct bursts, 2026-07-17 → 2026-08-31 (46 days) | **159** |
| Restaurants | 5 |
| Crossing lines | **1,960** (avg 12.33/burst, max 50) |
| Distinct wines | **60** → **32.7 lines per wine** |
| Lines at `currentStock = 0` | **1,952 (99.6%)** |
| Lines where stock ≥ par (i.e. bad data) | **0** |
| Worst single day | **317** |
| Days with any data | 12 of 46 |

**The backtest, precisely:**

1. Extract the 1,960 lines as `(restaurant_id, wine_id, observed_at, stock, par, severity)`, ordered by `observed_at`.
2. Replay them through `classifyTransition` + `shouldDampReopen` as if each burst were a sweep. Between bursts, treat any wine absent from a burst as **unknown**, not recovered — the corpus records crossings, not the full low-stock set, so absence carries no information. (This is the honest reading, and it is conservative: it can only *under*-count closes, i.e. under-count episodes.)
3. Count episodes opened, and would-be proposals.

**Pass criteria — falsifiable numbers, stated in advance:**

| Metric | Required | Reasoning |
|---|---|---|
| Episodes opened | **≤ 70** | 60 distinct wines; a handful of legitimate reopens |
| Suppression ratio | **≥ 25×** (1,960 → ≤ 78) | the measured 32.7×, with headroom |
| Duplicate `idempotency_key` collisions | **0** | C2 |
| Any wine with > 3 episodes | **0** | 99.6% never left zero stock; more than 3 episodes means the damping is broken |
| Would-be proposals on the worst day (317 lines) | **≤ K** | C9 |

**What the backtest cannot prove, stated plainly:**

- **It is a lower bound on volume.** The 15-minute in-memory cooldown (`low-stock-alerts.service.ts:62`, `:209-219`) suppressed bursts that never became notification rows at all, and the service ran on only 12 of 46 days.
- **It measures the seam's mechanics, not a restaurant's demand.** 99.6% of lines are at zero stock on a catalogue nobody sells from. It answers "does the episode key hold", never "this is the proposal rate".
- **It cannot validate the quantity rule against reality**, because no consumption exists to compare against. It can only compute the **dollar volume the rule would have proposed** over 46 days — worth doing, and worth reading as "this is what the rule does to *this* data", not as a forecast.
- **It cannot test T5** (the empty-sweep guard), because the corpus contains only non-empty bursts. T5 is unit-tested only, which is a stated weakness given that T5 guards the exact mechanism that produced the 32.7×.

### 4.5 Layer 5 — integration tests (real Postgres, no network)

Against a migrated database, with `ProcurementService` and `NotificationsService` real and only the outbound mail/push mocked. The repo's existing pattern is a chainable Supabase stub (`low-stock-alerts.service.spec.ts:1-40`); these tests need more than that — a real database, because half the claims are constraint claims.

| # | Test | Asserts |
|---|---|---|
| I1 | Sweep in `shadow` with 10 crossing items | `par_crossing_episodes` = 10 rows, all `shadow_would_propose`; `ai_proposed_actions` = **0**; `notifications` = 0 (C8) |
| I2 | Same sweep run 20× consecutively | still 10 episodes, `observations = 20`, still 0 proposals (C2) |
| I3 | `propose` mode, 10 items, K=3 | 3 proposals; 7 episodes `suppressed_cap` **with rank recorded**; 0 notifications (C9) |
| I4 | Two sweeps concurrently (`Promise.all`) | 10 episodes total, not 20; 3 proposals, not 6 (C2, the race) |
| I5 | Item with `provider_id = NULL` | `skipped_no_provider`; no proposal; `createOrder` never called (C5) |
| I6 | Restaurant with zero active providers | `skipped_no_provider` for all; no `ForbiddenException` ever thrown (the bridge must not *rely* on `createOrder:235-241` to catch it) |
| I7 | Item with all three price columns NULL | `skipped_no_price`; no proposal (C5) |
| I8 | Item with an existing `PENDING` order | `skipped_open_order` (C6) |
| I9 | Same, order at `PARTIALLY_RECEIVED` | `skipped_open_order` — the §3.5 case-2 regression |
| I10 | Same, order at `DELIVERED` | **proposes** (terminal, so a fresh need is real) |
| I11 | Rolling-7d spend at $1,999 of a $2,000 cap, next proposal $264 | `skipped_spend_cap`; **and the episode stays open** so a later sweep in a new week proposes (C4) |
| I12 | Confirm a bridge proposal end-to-end | `procurement_orders` = 1 row, `status='PENDING'`, `total_cost = 264.00` **not 0** (§1.8), `ai_proposed_actions.status='executed'` with all three confirmation columns set (C1) |
| I13 | Confirm the *same* proposal twice concurrently | one `executed`, one 404; **exactly one** `procurement_orders` row (C1) |
| I14 | `PAR_BRIDGE_MODE=off` set between step 1 and step 7 of a sweep | sweep aborts before any insert; a `decision_log` row records the abort (C7) |
| I15 | Item recovers above par between sweeps | episode `closed_at` set, `close_reason='recovered'`, open proposal `discarded` |
| I16 | Item recovers, then re-crosses 5 minutes later | **no** new episode (damping); `suppressed_crossings` incremented on the closed episode |
| I17 | Same, 13 hours later | new episode, new proposal |
| I18 | `v_low_stock_items` query errors | **nothing closes**; a `decision_log` row records the failure (T5) |
| I19 | `v_low_stock_items` returns zero rows globally | **nothing closes** (T5) |
| I20 | Tenant flag off | `skipped_tenant_off`; episodes advance but never propose |
| I21 | Tenant has no `restaurant_settings` row at all | treated as **off** — the OD-86 trap |
| I22 | 15 open proposals, ceiling 15, a 16th candidate | `suppressed_ceiling`; exactly one "proposals paused" notification |
| I23 | Proposal older than TTL | `discarded`, `failure_reason='expired_after_7d'`; a human Ask AI proposal of the same age is **untouched** |
| I24 | `notify` mode, 5 proposals, 3 members | **one** `group_key`, 3 notification rows (one per member), **not 15** |
| I25 | `notify` mode run twice inside the dedupe window | second run inserts 0 notification rows |

**Pass:** all 25. **Cannot prove:** anything about real data shape, real timing, or human behaviour.

### 4.6 Layer 6 — shadow in production

`PAR_BRIDGE_MODE=shadow`, all tenants, **minimum 21 days** (three full weekly cycles; two is not enough to see a weekly pattern repeat).

**Exactly what it writes:** rows in `par_crossing_episodes` (`bridge_mode='shadow'`, `outcome='shadow_would_propose'` or a `skipped_*`/`suppressed_*` value, with `proposed_quantity`, `proposed_unit_cost`, `proposed_total_cost`, `rank_score` all populated), and one `decision_log` row per restaurant per sweep. **Nothing else.** No `ai_proposed_actions`, no `notifications`, no `procurement_orders`, no email. Enforced by a CHECK (§1.1) and a CI guard (§4.2), not by care.

**The readout — twelve queries, all against `par_crossing_episodes`:**

| # | Question | Metric |
|---|---|---|
| S1 | Does the episode key hold? | `sum(suppressed_crossings) / count(episodes)` — the live suppression ratio |
| S2 | How many proposals per restaurant per day? | `count(*) FILTER (outcome='shadow_would_propose')` by day |
| S3 | How bursty? | the same, by day-of-week; **the Monday : Wednesday ratio** |
| S4 | What K would have been needed? | the daily 95th percentile of would-be proposals |
| S5 | How many dollars? | `sum(proposed_total_cost)` per rolling 7 days per restaurant |
| S6 | Would the cap have fired? | count of `skipped_spend_cap`, and by how much it was exceeded |
| S7 | How much is unproposable? | share of `skipped_no_provider` + `skipped_no_price` |
| S8 | How much would be suppressed by the open-order rule? | `skipped_open_order` share |
| S9 | Does the ledger oscillate? | episodes per `(restaurant, inventory)` per week; **> 2/wk is a red flag** |
| S10 | Are episodes closing? | median `closed_at − opened_at`; the share still open after 30 days |
| S11 | Do the two window modes differ? | recompute `applyCaps` offline over the same episodes with `daily` vs `vendor_window` — **no code change, no second shadow run** |
| S12 | Does the rank agree with intuition? | the founder reads the top 10 by `rank_score` and says whether they are the ten he would buy |

**Pass criteria — all must hold:**

| | Threshold |
|---|---|
| S1 suppression ratio | **≥ 10×** (backtest said 32.7×; a live figure under 10× means the machine differs from the replay and must be explained before proceeding) |
| S2 proposals/restaurant/day | **≤ 25 at the 95th percentile.** Above that, K is doing all the work and the design is wrong upstream |
| S9 episodes per SKU per week | **≤ 2** for ≥ 95% of SKUs |
| S6 | the cap **fires at least once** — a cap that never fires in 21 days is the Vision-cap defect (`ask-ai.controller.ts:20-22`) and must be lowered before S7 |
| S12 | the founder recognises ≥ 7 of the top 10 as reasonable buys |
| Errors | zero `outcome='error'` rows |

**Stop criteria — any one halts the rollout:**

- S1 < 5× → the episode key does not work on live data. Stop; re-derive.
- Any single `(restaurant, inventory)` opens > 10 episodes in a week → damping is broken. Stop.
- S5 exceeds 3× the tenant's actual wine spend → the quantity rule is worse than modelled. Stop; go to velocity-based sizing before proceeding.
- Any row in `ai_proposed_actions` with `proposer_name='par_crossing_bridge'` → shadow leaked. **Stop everything**; the CHECK and the guard both failed and the whole safety argument is void.
- The sweep's own error rate > 1% of invocations.

### 4.7 Layer 7 — canary: real proposals, no notification

`PAR_BRIDGE_MODE=propose`, **one tenant**, minimum 14 days. Real `ai_proposed_actions` rows; **no notification**. The founder reads them by SQL and by opening ⌘⇧K, knowing (§2.8) that nobody else will see them.

| Measured | Why |
|---|---|
| Confirm rate | the first real signal that a proposal is worth making |
| Discard rate + which SKUs | the input a posture-(b) suppression rule would be authored from |
| Expiry rate | ignored ≠ discarded, and the difference matters |
| **Edit rate on quantity**, from `executed_payload` | C10 — the quantity rule's report card |
| Execution failure rate | `createOrder` throwing on a proposal that passed grounding |
| `total_cost` on created orders | must be non-zero (§1.8). **If it is zero, the spend cap is fiction.** |

**Pass:** ≥ 1 confirm; zero executions without a confirmation record; zero duplicate orders; every created order carries a non-zero `total_cost`. **Stop:** any order created without a confirmation row; any duplicate PO for one episode; edit rate on quantity > 60% (the rule is wrong and should be fixed before it is pushed at anyone).

### 4.8 Layer 8 — live, with a fatigue instrument

`PAR_BRIDGE_MODE=notify`, one tenant, founder's explicit go, with §5 fully in place.

**This is the moment the posture stops being a constant and becomes a product.** Before it, everything is reversible by an env var. After it, a manager is being interrupted and a habit is forming.

| Instrument | Alarm |
|---|---|
| **Median confirm latency** (render → confirm) | trending toward zero = rubber-stamping. **This is the fatigue metric and it must be instrumented from the canary, not from launch** — a baseline taken after the habit forms measures nothing. |
| Confirm rate by rank position | if position 1 and position 5 confirm at the same rate, the ranking carries no information |
| Discards per week per SKU | a stable always-discarded set is posture (b)'s rule set, discovered rather than authored |
| Notification → open rate | a digest nobody opens is a digest that should be a count |
| Novelty | share of confirms whose SKU was confirmed in the previous cycle — high means the cards are wallpaper |

### 4.9 Standing production monitors (after launch)

The failure mode this design most fears is **silent success**: the bridge stops working and the absence of proposals looks like a quiet week. Four monitors, each of which fires on *silence*:

| Monitor | Fires when | Why it matters |
|---|---|---|
| **Heartbeat** | no `decision_log` row with `decision_type='par_bridge_sweep'` in 60 minutes | this is why the sweep logs a row **even when it finds nothing** (`recurring_order_agent.py:243-262`'s idea). "Found nothing" and "did not run" must never look the same. |
| **Suppression collapse** | 7-day suppression ratio drops below half its trailing-28-day value | the episode ledger has started churning; a flood is one config change away |
| **Cap silence** | the spend cap has not fired in 30 days **and** proposed dollars are within 20% of it | a cap that stops firing has usually stopped being computed |
| **Zero-cost orders** | any `procurement_orders` row with `total_cost = 0` created from a bridge proposal | §1.8's failure, recurring |

Plus one **assertion at execute time**, not a monitor: `AskAiService.execute` should refuse a `procurement.reorder` whose `proposer_name='par_crossing_bridge'` and whose `estimated_total_cost` is NULL. A cap enforced only at propose time is a cap a UI change removes.

---

## 5. Safety

### 5.1 What already exists and is inherited

| Control | Where |
|---|---|
| Execution requires confirmation — **in the database** | `20260827140000_ai_proposed_actions.sql`, `..._execution_requires_confirmation` |
| Confirmation must be attributed | same migration, `..._confirmation_is_attributed` |
| Exactly-once confirm (compare-and-swap) | `ask-ai.service.ts:529-541` |
| Claim rollback on any failure | `releaseClaim`, `:740-751`, and the catch at `:624-637` |
| Typed allowlist, reject-don't-coerce | `ask-ai-actions.ts:121-214` |
| Unit cap on a reorder line (500) | `ask-ai-actions.ts:112` |
| Re-grounding at confirm time, unconditional | `verifyStoredAction`, `:769-848`, called at `:616-623` |
| Edited payloads re-validated + candidate-grounded | `validateEdit`, `:854-905` |
| Every route JWT-guarded; `restaurantId` from the token, never the body | `ask-ai.controller.ts:27-32` |
| No-vendor guard | `procurement.service.ts:218-241` |
| Open-order merge (PO-level dedupe) | `:247-336` |
| Per-order AI kill switch | `ai_autonomy_paused` + `setOrderAiPaused`, `:2250-2268`, honoured `:1946` |
| Per-tenant AI send switch, default OFF | `enable_ai_autonomous_send`, registry `:63-70` |
| UCC commitment-language guardrail, CI-enforced | `commitment-patterns.ts`, `ci.yml:88-95` |
| RLS + no client grants on new tables | `check_new_tables_are_locked_down.py`, `ci.yml:377` |

### 5.2 The three caps

| Cap | Unit | Default | Enforced at |
|---|---|---|---|
| Per-window proposal cap (K) | proposals | 5 | propose |
| Open-proposal ceiling | proposals | 15 | propose |
| **Rolling-7-day spend cap** | **dollars** | **$2,000** | **propose and execute** |

### 5.3 The spend cap — designed, because none exists

**Verified:** grepping `spend_cap`, `daily_limit`, `max_order_value`, `budget_limit`, `spendCap`, `MAX_ORDER_VALUE`, `monthly_budget`, `dailySpendUsd` across `apps/`, `services/`, `supabase/`, `scripts/` returns **zero hits**. `MAX_REORDER_QUANTITY = 500` caps *units* (`ask-ai-actions.ts:112`) — 500 units of a $400 bottle is $200,000.

**Price resolution, in order** (all three columns are on `restaurant_inventory` and are already exposed by `v_low_stock_items`, so no extra query):

1. `negotiated_price`
2. `last_purchase_price`
3. `custom_price`
4. → **no price. Do not propose.** `outcome='skipped_no_price'`.

`price_history` is not in the chain: it holds **0 rows** *(measured)*. `providers` has no price columns at all (`baseline:4854-4900`).

**A `0.00` price resolves to "no price", not to zero.** A zero unit cost passes any cap and is the single cleanest way to walk one.

**Coverage cost, measured:** 50 of 64 active SKUs have a usable price → **the bridge is silent on 22% of the catalogue.** That is a real cost and it is the right trade: a cap that a missing price defeats is not a cap. The 14 priceless SKUs surface as a `skipped_no_price` count in the shadow readout, which is the correct pressure to fill them in.

**Enforcement at two sites, because one is not a cap:**

- **At propose:** `rolling_7d_proposed_total + this.totalCost > cap` ⇒ skip. `rolling_7d_proposed_total` sums `estimated_total_cost` over `ai_proposed_actions` rows for this restaurant with `proposer_name='par_crossing_bridge'`, `created_at > now() - 7 days`, `status IN ('proposed','confirmed','executed')` — discarded and expired proposals do **not** consume budget.
- **At execute:** `AskAiService.execute`, before calling `createOrder`, re-sums the same window over `status IN ('confirmed','executed')` and refuses if this action would exceed the cap. This catches the case a propose-only cap cannot: **20 proposals each under the cap, confirmed in bulk on Monday.** §3.2 says that is the normal Monday.

**The default is deliberately tight.** $2,000/rolling-7-days is *below* the modelled restaurant's $3,586/wk wine COGS. It will fire. That is the point: a cap that never fires is this repo's documented defect, and its firing in shadow is what forces the founder to set a real per-tenant number instead of inheriting a guess. The per-restaurant column (`procurement_weekly_cap_usd`) is where the real number goes, and the honest way to derive it — median trailing-8-week wine COGS × 1.5 — is not computable today because velocity is zero everywhere. Named in F1.

### 5.4 The kill switches

| Level | Mechanism | Blast radius |
|---|---|---|
| Global | `PAR_BRIDGE_MODE=off`, read **inside** the cron body and again immediately before the insert | every tenant, mid-sweep |
| Per tenant | `enable_auto_procurement` on the settings row, default **false**, missing row = **false** | one tenant |
| Per order | `ai_autonomy_paused` (existing, `:2250-2268`) | one order's downstream AI |
| Per proposal | discard (existing, `:691-718`) | one proposal |
| Degrade, not stop | `PAR_BRIDGE_MODE=propose` drops notifications while keeping proposals | the interruption only |

That last row is the one usually missing from kill-switch designs: **the ability to stop interrupting without stopping working.** Turning the bridge fully off loses the episode ledger's continuity; dropping to `propose` keeps it and silences the human-facing half.

### 5.5 The audit trail

Three joined records per proposal, and one per sweep:

1. `par_crossing_episodes` — the evidence, frozen at the open, with the disposition and the rank.
2. `decision_log` — one row per restaurant per sweep, **always, including empty sweeps**, written the way `inbound-responder.service.ts:1186-1213` writes one from the gateway: `agent_name='ParCrossingBridge'`, `decision_type='par_crossing_sweep'`, `correlation_id` from `getCorrelationId()`, `inputs` = items examined + config in force, `output` = counts by outcome, `reasoning` = the mode and the cap state. Best-effort, wrapped in try/catch — the sweep must never fail because an audit write did.
3. `ai_proposed_actions` — the proposal, with `proposer_type`/`proposer_name`/`autonomy_tier`/`episode_id`/`decision_log_id`/`trigger_ref` and the frozen cost.
4. `procurement_orders` — the order, now with a real `total_cost`.

Every one joins to the next by an id stored on the row, so "why did this restaurant buy 12 bottles of Sancerre on 1 September" is one query, not an archaeology exercise.

### 5.6 🔴 The prerequisite: `procurement_agent`

`procurement_agent` is registered **CORE** (`agent_registry.py:78-82`) — it starts unconditionally. On `stock.threshold.breached` (`procurement_agent.py:118`, `:130-131`) it calls `_initiate_procurement` (`:145`), which creates an order at `status: "NEGOTIATING"` (`:218`) — **not `PENDING`, so it skips the draft state entirely** — and publishes `procurement.conversation_request` to the vendor-contact path (`:231`). No proposal, no `confirmed_by`, no `decision_log`, no human. `_handle_manual_order` reaches the same function through a synthesised message (`:707`, `:728`).

It is inert only because its producer, `buffer_manager` on `pos.sale.completed`, is fed by the dormant Python POS pipeline. **E1's other half — "unify the POS pipeline so automation feeds the live path" (`.planning/04-specs/ECOSYSTEM-PLAN.md:81`) — turns it on as a side effect.**

A separate agent is converting this path to proposals-only on `fix/procurement-agent-proposals-only`. **That work is a hard prerequisite for slice 1 of this build, not a parallel track.** Shipping the bridge while that door is open is building a gate beside an open door, and the bridge's entire safety argument — three DB-enforced layers and a spend cap — says nothing about a path that does not pass through them.

**How this design proves the door is shut:** slice 0's exit criterion is that `check_proposal_gate_coverage.py` (§4.2) covers `services/agent-orchestrator/` as well as the gateway, and that a test mirroring `tests/test_recurring_order_agent.py`'s `RecurringOrderSafetyError` pattern (`recurring_order_agent.py:397-429`) asserts `procurement_agent` cannot produce an order row without a confirmation record.

---

## 6. Build sequence

Seven slices. Each is independently shippable, each is **inert until the next one turns it on**, each states what proves it.

| # | Slice | Ships | Inert because | Proved by | Reversal |
|---|---|---|---|---|---|
| **0** | **Close the door** | `procurement_agent`'s auto-order path removed or routed into a proposal; the gate guard extended to Python | nothing new is added | §4.2 guard + a `RecurringOrderSafetyError`-style test | revert; the path was already dormant |
| **1** | **Schema** | `par_crossing_episodes` (+ RLS, indexes); the 9 additive `ai_proposed_actions` columns + 2 constraints + 1 index; the 2 flag columns | no code reads or writes any of it | §4.1 constraint tests; `check_new_tables_are_locked_down.py` | additive and nullable; drop or leave |
| **2** | **Pure logic** | the nine functions of §4.3, exported, with tests. No service, no cron. | nothing calls them | §4.3 unit suite, 100% branch | delete the file |
| **3** | **Money in the payload** | `unitCost`/`totalCost` on `ReorderAction`; `validateAction` rules; `execute` forwards them to `createOrder` | optional fields; Ask AI's behaviour unchanged when absent | `ask-ai-actions.spec.ts` extension; I12 asserts non-zero `total_cost` | fields become optional-and-ignored |
| **4** | **The sweep, shadow-only** | `ParCrossingBridgeService` + `@Cron` + `triggerSweep`; `PAR_BRIDGE_MODE` defaults `off`; **no insert path to `ai_proposed_actions` exists in the code at all** | mode `off`, and there is literally no proposal insert to reach | §4.5 I1–I2, I14, I18–I21; then §4.6 shadow, 21 days | env var |
| **5** | **The proposal path** | the `ai_proposed_actions` insert, behind `mode='propose'`; caps; spend cap at propose **and** at execute; expiry; the §4.2 shadow-inertness guard | mode is `shadow`; the CHECK forbids a shadow row carrying a proposal | §4.5 I3–I13, I22–I23; then §4.7 canary, 14 days | env var back to `shadow` |
| **6** | **The notification** | the grouped `persistForRestaurant` call behind `mode='notify'`; role-scoped targeting; the digest count line; the fatigue instrument | mode is `propose` | §4.5 I24–I25; then §4.8 live | env var back to `propose` — **proposals keep working, interruptions stop** |

**The gate between 5 and 6 is the important one, and it is cheap.** Everything through slice 5 is reversible by one environment variable, and nothing through slice 5 can cause approval fatigue because nothing through slice 5 interrupts anyone.

**Slice 7 is not scheduled.** Posture (b) as a *suppression* layer — a single `auto_pilot_rules` table with one rule kind (`suppress SKU` / `suppress vendor`) — becomes authorable once §4.8's discard data says which crossings are noise. It is the right second move and the wrong first one.

---

## 7. Adversarial pass

Each attack is steelmanned, then judged. What survives is carried into the design above.

**A1 — "The cap does not prevent approval fatigue, it disguises it."**
K cards/day arrive forever, near-identical: same wines, same vendor, same case quantities. Familiarity, not volume, makes a confirm reflexive. A *capped* queue is more dangerous than a flooded one because it looks curated, so it is trusted more and read less. And the rubber-stamps are written into `confirmed_by`/`confirmed_at` as evidence of informed consent — an audit trail manufacturing a fact.
**Survives, partially, and it changed the design.** Three amendments now carried: confirm-latency instrumented **from the canary** (§4.7/§4.8), novelty suppression as a filter (§2.3 step 5g), and the digest count instead of a card for repeat SKUs. The attack degrades rather than kills because a rubber-stamped proposal is still a `PENDING` draft (`procurement.service.ts:352`) two gates from a vendor.

**A2 — "You will send a wrong order."**
Concretely: a discontinued SKU (§3.5 case 5). The bridge proposes, the manager taps, `createOrder` succeeds (nothing checks vendor–product availability), the email goes out.
**Survives fully. Not fixable inside this design.** There is no vendor-catalogue link in the schema. Recorded as F4. The bridge's honest position is that it makes this pre-existing gap 30× more likely to be exercised, and that the mitigation is downstream and human.

**A3 — "You will emit a flood."**
Four routes tried: (i) per-crossing proposing → killed by the episode key, measured 32.7×; (ii) ledger oscillation → killed by T5's empty-sweep guard plus the episode key; (iii) rapid oscillation around par → killed by the 12 h reopen damping (§1.5), which the prior pass did not have and without which a 2-minute sweep could open 360 episodes/day for one item; (iv) **many tenants at once** — the global sweep is one query across all restaurants, so a 10-tenant flood is 10× a 1-tenant flood and the cap is *per restaurant*, not global.
**(iv) survives.** Added: `PAR_BRIDGE_MAX_OPEN_PROPOSALS` is per-restaurant, but the *notification* fan-out is per-member per-restaurant. Ten tenants × 3 members = 30 pushes from one sweep. Mitigated by the 12-hour `dedupeWithinMinutes` and by staged rollout (one tenant at S4), **not** eliminated. Named.

**A4 — "It will silently stop working and look fine."**
Five routes: (i) the cron dies → **heartbeat monitor** (§4.9), which is why an empty sweep must log; (ii) the spend cap silently computes zero because `total_cost` is 0 on every order → this is real and measured (§1.8), fixed by slice 3 and watched by the zero-cost monitor; (iii) `getEffectiveLowStockPrefs` throws and returns all-on defaults (`low-stock-alerts.service.ts:525-527`) → does not affect proposing, only notifying; (iv) the tenant flag reader hits a missing settings row (**zero exist today**, measured) and a `.single()` throws → I21; (v) **`listOpen` caps at 20** (`ask-ai.service.ts:483`) → at the ceiling of 15 this is invisible, but **if the founder raises the ceiling above 20 the surface silently truncates and proposals become unreachable.** This one is new and was not in the prior pass.
**(v) survives and is a design constraint:** `PAR_BRIDGE_MAX_OPEN_PROPOSALS` must be **< 20** until `listOpen`'s limit is raised, and a guard or a startup assertion should enforce the relationship rather than a comment.

**A5 — "The editable card is an injection hole at bridge scale."**
`validateEdit` grounds an edited payload against the **capped** candidate set: the first **60** inventory rows **alphabetically by `wine_name`** (`ask-ai.service.ts:30`, `:162-174`). Production has 64 active SKUs *(measured)*. On the modelled 120-SKU list, **any bridge proposal for a wine alphabetically past position 60 cannot be edited** — the confirm-untouched path uses a direct lookup and works (`verifyStoredAction:803-822`), but the moment the manager changes the quantity it fails with "I could not find that", which is false.
**Survives fully. This is a real, latent, scale-triggered defect** that the bridge is the first feature to expose, and it hits exactly the interaction §3.3 says is most likely (editing a case-rounded quantity down). Two options: raise `MAX_INVENTORY_CANDIDATES`, or — better — let `validateEdit` ground a **quantity-only** edit by direct lookup, since a quantity change injects no id. Named as F6, and it should be fixed **in slice 5**, not after.

**A6 — "`ai_proposed_actions` is the wrong base; the spec says `one_tap_actions`."**
**Does not survive.** `one_tap_actions`' executor for this family is `// TODO` (`one-tap-actions.service.ts:408-410`) and `custom` falls to `default:` (`:425-428`) — the tap completes the row and buys nothing. `ai_proposed_actions` has the gate in the database and a working executor. The spec predates Ask AI landing on main.

**A7 — "The 32.7× number is an artefact of a broken detector, so the episode key is solving a bug you should just fix."**
Fair. The detector's empty-map-on-error path (`:463-466`) plus `reconcileRecoveries` (`:433-447`) is a sufficient mechanism, and fixing *that* would reduce the 1,960 lines regardless of any bridge.
**Survives as a sequencing argument, not as an objection.** Two answers. First, the episode key is correct even against a perfect detector: a par stays crossed for the whole 7-day lead time (§0.2), so "one crossing = one proposal" is wrong even with zero false crossings. Second, the bridge must not depend on someone else's table being correct — that is precisely why it keeps its own ledger. **Fixing the detector should still happen**; it is out of scope here and is worth an OD of its own.

**A8 — "Shadow mode proves nothing, because production has no real data."**
**Survives, and it is why §4.6's pass criteria are all about mechanics** (suppression ratio, episode churn, error rate) and none about demand. Stated in §4.4's limitations: read S2/S5 as "what this rule does to this data", never as a forecast. The founder should be told this in one sentence, because the temptation to read the shadow numbers as a business forecast is strong and they are not one.

---

## 8. Open forks — the founder's, not defaulted

| # | Fork | Options | Cost of each | Standing recommendation |
|---|---|---|---|---|
| **F1** | **Autonomy posture** (`.planning/04-specs/ECOSYSTEM-PLAN.md:92`; **no OD row exists**, and filing one is its own operation — see §9) | (a) every crossing proposes · (b) rule-matched only · (c) every crossing proposes into a capped, ranked, batched queue | (a) measured 42.6 would-be proposals/day, worst day 317 · (b) 2 tables + a DSL + a UI + customer-authored content that a DSL change breaks · (c) (a) + a rank function + two constants | **(c), and the design makes it a parameter.** K=∞ is posture (a); K=5 is (c); (b) arrives later as a suppression layer. **What would overturn it:** a near-term customer with a 300+ SKU list and a *written* par policy — then (b) is transcription, not invention. |
| **F2** | **The Monday bulk problem** (§3.5 case 7) | (i) keep K low enough that 20 is never approached · (ii) build a bulk-confirm surface · (iii) raise `listOpen`'s limit and accept the modal | (i) throttles the buyer on the one day they are buying · (ii) real UI work + a bulk-confirm route that must preserve the per-row CAS · (iii) cheapest, worst UX | **Not defaulted.** (i) ships with slice 5 as the safe position; (ii) is the right answer and is a separate slice. The founder should say whether S4 waits for it. |
| **F3** | **One vendor, many SKUs** (§3.5 case 6) | (i) N orders, N emails (today's schema) · (ii) per-vendor cap so N stays small · (iii) a multi-line order object | (i) 24 emails to one rep · (ii) config only · (iii) schema change to `procurement_orders`, whose `inventory_id`/`provider_id` are both NOT NULL (`baseline:4518-4519`), plus every reader | **(ii) now, (iii) later.** (iii) is the honest long-run answer and is not a bridge decision. |
| **F4** | **Discontinued SKUs** (§3.5 case 5) | (i) accept, mitigate downstream · (ii) a vendor-catalogue table · (iii) a "last ordered N days ago, confirm still available?" flag on the card | (i) wrong orders reach vendors · (ii) new schema + data the restaurant must maintain · (iii) cheap, honest, and only a nudge | **(iii) now, (ii) never unless a customer asks.** |
| **F5** | **Mobile** | (i) suppress push for bridge proposals until a mobile surface exists · (ii) push and let it deep-link to nothing · (iii) build the surface | (i) the buyer who is on their phone misses it · (ii) a notification that goes nowhere is worse than none · (iii) real work | **(i)**, and say so in the tenant's settings copy. |
| **F6** | **The 60-candidate edit ceiling** (A5) | (i) raise `MAX_INVENTORY_CANDIDATES` · (ii) ground quantity-only edits by direct lookup · (iii) leave it | (i) a bigger prompt for Ask AI, which is what the cap exists to bound (`:573-577`) · (ii) small, targeted, no prompt impact · (iii) editing silently breaks past 60 SKUs | **(ii)**, in slice 5. Recommended strongly enough that shipping without it should be a deliberate call. |
| **F7** | **Window unit** (§3.4) | `daily` · `vendor_window` | none — both are computable from the same shadow data offline (S11) | **Ship `daily`, decide from S11.** This is the one fork the proof plan resolves without a second experiment. |
| **F8** | **The real spend cap number** (§5.3) | (i) the $2,000 process default · (ii) a per-tenant number the founder sets · (iii) derive from trailing wine COGS | (i) will fire often, by design · (ii) needs a number nobody has yet · (iii) not computable — velocity is 0.000 everywhere | **(i) through shadow, then (ii) informed by S5/S6.** (iii) becomes possible only after hop 10. |

---

## 9. What I could not verify

- **Any real par-crossing rate.** `sales_velocity_7d = 0.000` for every SKU; all 64 at zero stock; `inventory_transactions` holds 4 rows *(measured)*. §3.1's 39 crossings/week and every dollar figure derived from it are a **stated model**, arithmetic shown. Only the day-one count (64), the burst corpus (159 bursts / 1,960 lines / 60 wines / 46 days), and the day-of-week shape are measured.
- **The oscillation mechanism.** I traced a *sufficient* cause (`low-stock-alerts.service.ts:463-466` → `:433-447`) and did not prove it is the actual one — that needs the gateway's logs, which I did not read. The measured 32.7 re-announcements per wine at 99.6% zero stock stands regardless of mechanism, and the design does not depend on the diagnosis.
- **Whether the gateway cron ran continuously.** The corpus covers 12 active days of 46. I do not know whether the gaps are deploys, restarts, or a genuinely quiet catalogue. This makes the 317-line worst day a *lower* bound on burstiness, not an upper one.
- **`fix/procurement-agent-proposals-only`.** I did not read that branch. §5.6 is written against `origin/main` as it stands and assumes the conversion lands; if it lands differently, slice 0's exit criterion is what needs re-checking, not the rest of the design.
- **Whether the Python orchestrator runs in production at all.** `decision_log` was 26 rows at the prior pass; I did not re-count it and did not check Railway. §5.6 treats `procurement_agent` as a live hazard on the code, which is the conservative reading.
- **Mobile rendering.** Zero `ask-ai` references under `apps/mobile/src` (grepped); I did not audit what a `procurement_proposals` notification would do on a device.
- **The 12-hour reopen-damping window and the 30-day staleness window** are reasoned from vendor lead time (`providers.lead_time_days DEFAULT 7`) and service physics, not measured. They are the two most arbitrary constants in this design and both should be re-derived from S9/S10 shadow data before S4.
- **I filed no OD.** F1 belongs in `.planning/decisions/OPEN-DECISIONS.md`, and is **deliberately not filed here**. Two reasons. The design pass read the highest id as OD-112; it is actually **OD-117** — ADR 0048 registered OD-113 through OD-117 in the interim, so the next free id is the one immediately after OD-117. (This document deliberately does not write that number: the OD guard treats any id it finds as a citation and fails until a matching row exists, which is correct behaviour and the reason the number gets assigned at filing time, not before.) More importantly, filing it was attempted and reverted: a single new row in the Open table shifts every row in the *Resolved* table below it, and the citation guard measured **41 citations across the org docs** that would need repointing. ADR 0025 recorded that cost as 27; it is 41 now and growing. So filing this fork is a real operation with a sweep attached, not a one-line edit, and it must not ride along inside a design document's PR.
