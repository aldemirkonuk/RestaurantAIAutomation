# Synthetic Tenant Isolation Convention (TFND-06)

**Status:** Convention locked in Phase 36. Generator + teardown **code** expansion is implemented in **Phase 37** — this document does not ship seed/teardown scripts.

**Extends (do not fork):**

- `services/agent-orchestrator/tests/e2e/conftest_prod.py` — JWT (`prod_jwt`), service-role client, `E2E_TABLES` teardown, Sentry orphans
- `services/agent-orchestrator/scripts/setup_e2e_anchor.py` — permanent anchor upsert

---

## Purpose

Lock the `sim-*` synthetic restaurant isolation model (D-18..D-21) so later Testing Campaign phases (37+) implement generators and expanded teardown against a single documented contract.

Phase 36 delivers **documentation only**. Do not treat this file as permission to invent a second production E2E harness.

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

## ID prefixes

```text
SIM_ID_PREFIX  = "sim-"   # restaurants.id / restaurant_id
SIM_ROW_PREFIX = "sim-"   # deterministic row ids (parallel to e2e-%)
E2E_ANCHOR     = "e2e-test-restaurant"  # NEVER deleted; coexistence OK
```

Rules:

- Every synthetic tenant restaurant id matches `sim-*` (e.g. `sim-bistro-001`).
- Deterministic child rows use `sim-` prefixes (parallel to Phase 25 `e2e-%` tags).
- **Never** reuse production restaurant UUIDs for sim tenants.
- Conceptual teardown sweep: `DELETE WHERE restaurant_id LIKE 'sim-%' AND id LIKE 'sim-%'` (and/or per-restaurant after a run).

---

## RLS-safe seeding (D-19) — mandatory seed checklist (H3)

Before any JWT / user-path assertion against a sim tenant, **all** of the following must be true:

- [ ] `restaurants` row with `id` matching `sim-*`
- [ ] `user_restaurant_access` (URA) membership row linking Auth user ↔ sim restaurant
- [ ] Auth user used for `prod_jwt`-style password grant (`POST /auth/v1/token?grant_type=password`)
- [ ] Service-role allowed for **seed/teardown only** (never for claiming user-path RLS proof)

**Explicit:** service-role tests ≠ user-path RLS proof.

**One-line:** Group 1 T2+ later phases must include JWT path.

Service-role seed/teardown runs only from CI secrets / server scripts — **never** from the web client.

---

## Idempotent teardown (D-20) + gap vs registry

### Contract

- Idempotent: re-running teardown is safe; missing rows are not failures.
- Failures → Sentry tag `sim-orphan` / `e2e-orphan` — **NEVER raise** in teardown.
- Never delete `e2e-test-restaurant` anchor.
- Extend (do not replace) the registry + tag-based sweep pattern in `conftest_prod.py`.

### Current `E2E_TABLES` (verbatim from `conftest_prod.py:251-260`)

These eight tables are the **only** tables in the current production E2E tag-based sweep today:

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
Sim extension (conceptual): `restaurant_id LIKE 'sim-%' AND id LIKE 'sim-%'` on the same (and later expanded) table list.

### Gap vs FUNCTIONALITY-REGISTRY Table D (C2)

Registry Table D domain buckets beyond these 8 tables are **out of current teardown**. Phase 37 **must** expand teardown table registry **before** first multi-archetype seed.

| Registry Table D domain | Example tables (from registry) | Teardown coverage |
|-------------------------|--------------------------------|-------------------|
| Identity / tenancy | `users`, `user_roles`, `user_restaurant_access`, … | none (seed/teardown of auth+URA is separate checklist; not in `E2E_TABLES`) |
| Catalog / wine / studio | `master_wine_library`, `menu_items`, … | partial (`master_wine_library_submissions` only) |
| Inventory | `restaurant_inventory`, `inventory_*`, … | partial (`inventory_stock` only) |
| POS / sales | `sales_events`, `toast_item_mappings`, … | partial (`pos_webhook_logs` only) |
| Procurement / vendors | `providers`, `procurement_*`, `rfq_requests`, … | none |
| Communications | `email_prospects`, `restaurant_inbound_addresses`, … | partial (`order_interactions` only) |
| Calendar | `calendar_*`, `events`, … | partial (`calendar_events` only) |
| Analytics / reports | `generated_reports`, `analytics_cache`, … | none |
| Notifications | `notifications`, `push_subscriptions`, … | partial (`notification_deliveries`, `notification_logs`) |
| AI assistants | `sommelier_conversations`, … | none |
| Platform | `idempotency_keys`, `outbox`, `saga_state`, … | partial (`system_audit_log` only) |

**Phase 37 hard gate:** Phase 37 must expand teardown before multi-archetype seed. Incomplete coverage → orphan risk in production; do not widen seed surface until the table registry catches up.

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
