# Phase 37: Synthetic Restaurant Engine — Security Audit

**Audited:** 2026-07-28
**ASVS Level:** L1
**Block on:** high
**Threats Closed:** 14/14
**Note:** Verified against current file state (post `1fe72bc` schema-alignment fix), not just original SUMMARY claims.

## Threat Verification

| Threat ID | Category | Disposition | Evidence | Status |
|-----------|----------|-------------|----------|--------|
| T-37-01-01 | Tampering | mitigate | `scripts/synth/snapshots.py::load_snapshot` is pure file read (no httpx/playwright import, no `refresh_snapshot` call). Proven by `tests/test_synth_snapshots.py::test_load_snapshot_reads_frozen_json_only` (poisons `sys.modules["httpx"]`/`playwright`, monkeypatches `refresh_snapshot` to raise `AssertionError` if invoked — 0 calls asserted) and `test_load_snapshot_does_not_invoke_refresh`. | CLOSED |
| T-37-01-02 | Information Disclosure | mitigate | `scripts/synth/snapshots.py::refresh_snapshot` (lines ~438–475) redacts `GOOGLE_API_KEY`/`GEMINI_API_KEY`/`ANTHROPIC_API_KEY` values out of exception messages before `logger.warning`/`raise RuntimeError`. No credential is ever interpolated into a log/print call unredacted. | CLOSED |
| T-37-01-03 | Spoofing | mitigate | `scripts/synth/snapshots.py::_row_to_item` copies `bottle_price`/`by_glass_price` from source fields only, preserves `None`. `tests/test_synth_snapshot_schema.py::test_all_five_snapshots_match_schema` asserts null-or-numeric for all 5 packs; `test_priced_sku_ratio_sets_menu_quality` proves ratio<0.9 ⇒ `partial`. | CLOSED |
| T-37-01-04 | Tampering | mitigate | `scripts/synth/ids.py` — `sim_restaurant_id`/`sim_org_id` are `uuid.uuid5(SIM_NS, ...)` only; no string-PK path exists. `tests/test_synth_recipes.py::test_sim_ids_are_uuid5_and_sim_slugs` asserts `uuid.UUID(rid).version == 5` and `rid != "sim-bistro"`. | CLOSED |
| T-37-02-01 | Spoofing | mitigate | `supabase/migrations/20260727230000_sim_ground_truth.sql`: `ENABLE ROW LEVEL SECURITY` on both oracle tables, zero `CREATE POLICY` grants for anon/authenticated; `seed_sim_restaurant(jsonb)` is `SECURITY DEFINER` with `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO service_role` only. `tests/test_synth_oracle_schema.py::test_migration_file_exists_with_oracle_tables_and_rpc` regex-asserts no anon/authenticated write policy exists. | CLOSED |
| T-37-02-02 | Tampering | mitigate | `scripts/synth/seed.py::execute_atomic_seed` writes all live rows then oracle rows last inside one connection, `except: conn.rollback(); raise` (no partial commit path). `tests/test_synth_atomic_seed.py::test_oracle_failure_rolls_back_no_commit` forces a failure on `sim_ground_truth_facts` insert and asserts `committed is False` / `rolled_back is True` even though `restaurants` insert was already attempted. Cloud primary path (`seed_sim_restaurant` SQL function) mirrors this: single `plpgsql` function body = one implicit transaction. | CLOSED |
| T-37-02-03 | Elevation of Privilege | mitigate | `scripts/synth/auth_personas.py::_load_persona_credentials` raises `PersonaConfigError` unless `len(set(emails)) == 3` (hard-enforces 3 distinct SIM_* addresses). `PERSONA_ROLES` maps 3 keys → owner/manager/staff. `tests/test_synth_auth_personas.py::test_ensure_personas_idempotent_on_422_already_registered` asserts 3 distinct `user_id`s; `tests/test_synth_atomic_seed.py::test_apply_seed_true_uses_rpc_caller_and_personas` asserts URA roles == `{owner,manager,staff}` with 3 distinct ids in the RPC payload. | CLOSED |
| T-37-02-04 | Information Disclosure | mitigate | `ensure_personas` only prints `f"✓ sim persona ensured role={role}"` (no email/password/JWT interpolated). `build_seed_plan` dry-run output (`tables` dict) is row-count-only, no payload dump by default. `tests/test_synth_auth_personas.py::test_ensure_personas_idempotent_on_422_already_registered` explicitly asserts `str(result)` does not contain `"owner-secret"`/`"manager-secret"`/`"staff-secret"`/`"eyj"` (JWT prefix). | CLOSED |
| T-37-02-05 | Tampering | mitigate | `scripts/synth/seed.py::build_seed_plan` sets `menu_items[].bottle_price/by_glass_price` and `restaurant_inventory[].custom_price` directly from `item.get("bottle_price"/"by_glass_price")` (snapshot fields) — no invented value path. `scripts/synth/oracle.py::build_facts` `menu_price` fact type does the same. `tests/test_synth_oracle_schema.py::test_build_facts_emits_all_six_types_with_payload_keys` asserts `mp["payload"]["bottle_price"] == src["bottle_price"]` against the snapshot source item. | CLOSED |
| T-37-03-01 | Tampering / DoS | mitigate | `scripts/synth/teardown.py::resolve_sim_restaurant_ids` filters via `.like("slug", "sim-%")`; `filter_sim_restaurant_ids` additionally excludes any row with id/slug `== E2E_ANCHOR_GUARD` ("e2e-test-restaurant"); `teardown_sim` wraps every resolve/delete call in `try/except` → never propagates, records via `_capture_sim_orphan` (Sentry tag `sim-orphan`). Verified by `tests/test_synth_teardown_safety.py::test_teardown_sim_never_raises_on_delete_failure`, `test_teardown_hard_guards_e2e_anchor`, `test_teardown_records_sim_orphan_on_failure`. | CLOSED |
| T-37-03-02 | Tampering | mitigate | `scripts/synth/teardown.py::refuse_multi_archetype_apply_unless_ready` calls `assert_teardown_coverage()` (write-set↔handler equality) whenever `apply=True`, for single- or multi-archetype; wired into `seed.apply_seed`, `cli._cmd_generate`, and `api/synth_routes.py::synth_generate`. Verified by `tests/test_synth_write_set_gate.py::test_multi_archetype_apply_calls_gate` / `test_single_archetype_apply_still_requires_gate` and `tests/test_synth_cli_defaults.py::test_cli_generate_all_apply_invokes_write_set_gate` (gate failure ⇒ `apply_seed` never called, non-zero exit). | CLOSED |
| T-37-03-03 | Elevation of Privilege | mitigate | `tests/e2e/test_synth_role_isolation.py` (marked `prod_e2e`) asserts staff password-grant JWT → `403` on manager-gated `GET /restaurants/{id}/team/members`, and manager JWT → not `403`. Distinct SIM_* personas enforced upstream by `auth_personas.py` (T-37-02-03). Test explicitly `pytest.skip`s with named missing-env message (never silently "passes") when secrets absent — reran locally: **1 skipped** (`SUPABASE_ANON_KEY`/`SIM_STAFF_*`/`SIM_MANAGER_*`/gateway URL not present in this environment). VERIFICATION.md (2026-07-28, re-verification) records this green against live cloud with SIM_* secrets provisioned. | CLOSED (secrets-gated; code mitigation confirmed, local rerun shows honest skip not false-pass) |
| T-37-03-04 | Information Disclosure | mitigate | `cli.py` dry-run JSON for `generate`/`teardown`/`refresh` emits only `archetype_id`, `slug`, `sku_count`, `dry_run`, `apply`, table row-counts, or `sim_restaurant_ids`/`org_ids`/`wine_ids` — no payload/password/JWT fields. `api/synth_routes.py` responses use the same shape. Secret redaction on the one path that can error with keys present (`refresh_snapshot`) is covered under T-37-01-02. | CLOSED |
| T-37-03-05 | Spoofing | mitigate | `api/synth_routes.py::verify_admin_key` requires `X-Admin-Key` header exactly matching `ADMIN_API_KEY` env (401 on missing/empty/wrong, including when env unset). `SynthRequest.apply: bool = Field(default=False)` on all three routes. Verified by `tests/test_synth_routes.py::test_synth_generate_requires_admin_key`, `test_synth_generate_wrong_key_401`, `test_synth_generate_apply_defaults_false`, `test_synth_teardown_apply_defaults_false`, `test_synth_refresh_requires_admin_key`. | CLOSED |

## Unregistered Flags

None. `37-02-SUMMARY.md` and `37-03-SUMMARY.md` both explicitly state `## Threat Flags: None beyond plan threat model`. `37-01-SUMMARY.md` carries no new-attack-surface flags. No new entry points were found in the implementation files that lack a threat-register mapping.

## Regression Check (post `1fe72bc`)

`1fe72bc` ("fix(37): align sim seed with live schema and seed cloud tenants") touched `scripts/synth/auth_personas.py`, `scripts/synth/seed.py`, `scripts/synth/teardown.py`, and the migration file. Re-read all four post-commit:
- `auth_personas.py`: 3-distinct-email enforcement (T-37-02-03) and no-log-secret print statement (T-37-02-04) unchanged.
- `seed.py`: oracle-last-in-TX ordering (T-37-02-02) and snapshot-only price copy (T-37-02-05) unchanged; only column/table mapping adjusted (`wine_id`, `primary_type`, `source`, `stock_live`) to match live schema.
- `teardown.py`: `DELETE_ORDER`/`TEARDOWN_HANDLERS`/e2e-anchor guard (T-37-03-01/02) unchanged structurally.
- Migration: RLS + no-anon-policy + `SECURITY DEFINER` + `GRANT ... TO service_role` (T-37-02-01) unchanged; only column mappings inside the function body adjusted.

Full local unit suite reconfirmed green after this audit: `pytest tests/test_synth_*.py -q` → **54 passed**.

## Full Suite Evidence

```
$ pytest tests/test_synth_*.py -q --tb=line
54 passed in 0.63s

$ pytest tests/e2e/test_synth_role_isolation.py -m prod_e2e -q --tb=line
1 skipped   (secrets absent in this environment — explicit named skip, not a pass claim)
```

SECURITY.md: `.planning/phases/37-synthetic-restaurant-engine/SECURITY.md`
