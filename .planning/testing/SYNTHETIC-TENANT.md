# Synthetic Tenant Isolation Convention (TFND-06)

**Status:** Convention locked in Phase 36. Generator + teardown **code** expansion is implemented in **Phase 37** (`scripts/synth/teardown.py`, write-set gate, CLI/API).

**Extends (do not fork):**

- `services/agent-orchestrator/tests/e2e/conftest_prod.py` — JWT (`prod_jwt`), service-role client, `E2E_TABLES` teardown, Sentry orphans; **also calls shared `teardown_sim`**
- `services/agent-orchestrator/scripts/setup_e2e_anchor.py` — permanent anchor upsert
- `scripts/synth/teardown.py` — Phase 37 shared FK-safe sim teardown (imported by CLI + conftest)
- `scripts/synth/write_set.py` — `SYNTH_WRITE_SET == TEARDOWN_TABLES` + handler coverage gate

---

## Purpose

Lock the `sim-*` synthetic restaurant isolation model (D-18..D-21) so Testing Campaign phases (37+) implement generators and expanded teardown against a single documented contract.

Phase 36 delivered **documentation**. Phase 37 implements seed/teardown expansion — this document remains the hard-gate contract (never weaken never-delete-e2e).

---

## Coexistence with Phase 25 anchor

| Constant | Value | Rule |
|----------|-------|------|
| `E2E_ANCHOR` | `e2e-test-restaurant` | **NEVER deleted** — permanent Phase 25 production E2E anchor |
| `SIM_ID_PREFIX` / `SIM_ROW_PREFIX` | `sim-` | Campaign synthetic tenants; coexist with the anchor |

- `sim-*` restaurants **coexist** with `e2e-test-restaurant` in the same cloud stack (D-07).
- Do **not** fork a second harness — extend `conftest_prod.py` / `setup_e2e_anchor.py` patterns by reference in Phase 37+.
- Teardown must never delete the `e2e-test-restaurant` anchor row (same rule as today's `teardown_e2e_records`).

---

## ID strategy (Phase 37 implemented)

Live cloud `restaurants.id` is **UUID**. Phase 37 uses:

| Field | Strategy |
|-------|----------|
| `restaurants.id` | Deterministic **UUID5** (`sim.restaurant.{archetype}`) |
| `restaurants.slug` | `sim-{archetype}` — teardown filter: `slug LIKE 'sim-%'` |
| Provisional wines | UUID5 `sim.wine.*` + `enrichment_source=sim` (sim-filtered library teardown only) |

Do **not** use string PKs like `sim-bistro` in `restaurants.id`. Conceptual `sim-*` id text in older notes maps to **slug** + UUID5.

---

## ID prefixes

```text
SIM_ID_PREFIX  = "sim-"   # restaurants.slug (and conceptual restaurant_id prefix)
SIM_ROW_PREFIX = "sim-"   # deterministic row namespaces (uuid5 sim.*)
E2E_ANCHOR     = "e2e-test-restaurant"  # NEVER deleted; coexistence OK
```

Rules:

- Every synthetic tenant restaurant **slug** matches `sim-*` (e.g. `sim-bistro`).
- Deterministic child rows use uuid5 under `sim.*` namespaces.
- **Never** reuse production restaurant UUIDs for sim tenants.
- Teardown resolves IDs via `SELECT id FROM restaurants WHERE slug LIKE 'sim-%'` then deletes children by those UUIDs.

---

## RLS-safe seeding (D-19) — mandatory seed checklist (H3)

Before any JWT / user-path assertion against a sim tenant, **all** of the following must be true:

- [ ] `restaurants` row with slug matching `sim-*` (UUID5 id)
- [ ] `user_restaurant_access` (URA) membership row linking Auth user ↔ sim restaurant
- [ ] Auth user used for `prod_jwt`-style password grant (`POST /auth/v1/token?grant_type=password`)
- [ ] Service-role allowed for **seed/teardown only** (never for claiming user-path RLS proof)

**Explicit:** service-role tests ≠ user-path RLS proof.

**One-line:** Group 1 T2+ later phases must include JWT path.

Service-role seed/teardown runs only from CI secrets / server scripts — **never** from the web client.

---

## Idempotent teardown (D-20) + Phase 37 expansion

### Contract

- Idempotent: re-running teardown is safe; missing rows are not failures.
- Failures → Sentry tag `sim-orphan` / `e2e-orphan` — **NEVER raise** in teardown.
- Never delete `e2e-test-restaurant` anchor.
- Never delete SIM_* Auth users (durable fixtures).
- Never wholesale-wipe `master_wine_library` — sim-filtered only (`enrichment_source=sim` / uuid5 `sim.wine.*`).
- Extend (do not replace) the registry + tag-based sweep pattern in `conftest_prod.py`.
- Shared module: `scripts/synth/teardown.py` (`teardown_sim`, `TEARDOWN_HANDLERS`, `DELETE_ORDER`).

### Current `E2E_TABLES` (verbatim from `conftest_prod.py` e2e sweep)

These eight tables remain the **e2e-% tag-based** sweep (Phase 25):

```python
E2E_TABLES = [
    "inventory_stock",
    "notification_deliveries",
    "notification_logs",
    "order_interactions",
    "calendar_events",
    "pos_webhook_logs",
    "system_audit_log",
    "master_wine_library_submissions",
]
```

Phase 25 sweep filter (anchor): `restaurant_id = 'e2e-test-restaurant' AND id LIKE 'e2e-%'`.

### Phase 37 `SYNTH_WRITE_SET` / shared teardown

Generator write-set equals teardown tables **and** handlers (D-11/D-12). See `scripts/synth/write_set.py` + `scripts/synth/teardown.py`. Hard gate: refuse multi-archetype `--apply` until `assert_teardown_coverage()` is green (verified by `test_synth_write_set_gate.py`).

FK-safe order includes `restaurant_menus` (never shorthand `menus`) and sim-filtered `master_wine_library*`.

### Gap vs FUNCTIONALITY-REGISTRY Table D (C2)

Registry Table D domain buckets beyond the generator write-set remain **out of sim teardown** until a later phase widens the seed surface. Phase 37 closes the **generator write-set** gap (orgs, restaurants, URA, menus, inventory, oracle, provisional library) — not every registry domain.

**Phase 37 hard gate (satisfied when write-set tests green):** expand teardown before multi-archetype seed. Incomplete coverage → orphan risk; do not widen seed surface until the table registry catches up.

---

## Auth / secrets

- Reuse Supabase Auth REST password grant pattern from `prod_jwt` in `conftest_prod.py` (session-scoped JWT; never function-scoped for multi-wave suites).
- Credentials live in GitHub Actions secrets / server env (`E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, service-role key for seed/teardown).
- **Never** log JWT; never write JWT to disk, JUnit XML, or logs.
- Do not embed secret values in this document (names only when referencing ops status elsewhere).

---

## CI capability note (C1)

Nightly `.github/workflows/e2e-prod.yml` may lack required secrets. Live seed/teardown of sim (or e2e) tenants requires secrets restored by ops.

**Phase 36 does not change job behavior** — annotations and this convention only. Treat TFND-05 as schedule wiring documented, not as proven healthy nightly capability, until a wave XML lands with secrets present.

---

## Anti-patterns (Phase 25 — still in force)

- **NEVER** set `PYTEST_RUNNING` in prod E2E CI (disables Sentry in the FastAPI app).
- **NEVER** write JWT to disk / JUnit / logs.
- **NEVER raise** in teardown — Sentry tags `e2e-orphan` / `sim-orphan` instead.
- **NEVER** use staging-only as the Testing Campaign default stack (D-07: cloud production paradigm).
- **NEVER** claim user-path RLS proof from service-role-only calls.
- **NEVER** delete `e2e-test-restaurant`.
- **NEVER** invent a second production E2E workflow file for this campaign.
