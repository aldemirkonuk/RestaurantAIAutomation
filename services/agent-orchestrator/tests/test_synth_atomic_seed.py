"""Wave 2 — D-10 atomic seed fail-closed (37-02)."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.synth.seed import apply_seed, build_rpc_payload, build_seed_plan, execute_atomic_seed

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATION = (
    REPO_ROOT
    / "supabase"
    / "migrations"
    / "20260727230000_sim_ground_truth.sql"
)


class _FakeCursor:
    def __init__(self, conn: "_FakeConn") -> None:
        self.conn = conn

    def execute(self, sql: str, params=None) -> None:  # noqa: ANN001
        self.conn.ops.append(("execute", sql, params))
        needle = self.conn.fail_on
        if needle and needle in sql:
            raise RuntimeError(f"forced failure on: {needle}")

    def executemany(self, sql: str, seq_of_params) -> None:  # noqa: ANN001
        self.conn.ops.append(("executemany", sql, list(seq_of_params)))
        needle = self.conn.fail_on
        if needle and needle in sql:
            raise RuntimeError(f"forced failure on: {needle}")

    def close(self) -> None:
        return None

    def __enter__(self) -> "_FakeCursor":
        return self

    def __exit__(self, *args) -> None:  # noqa: ANN002
        return None


class _FakeConn:
    def __init__(self, fail_on: str | None = None) -> None:
        self.fail_on = fail_on
        self.ops: list[tuple] = []
        self.committed = False
        self.rolled_back = False

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self)

    def commit(self) -> None:
        self.committed = True
        self.ops.append(("commit", None, None))

    def rollback(self) -> None:
        self.rolled_back = True
        self.committed = False
        self.ops.append(("rollback", None, None))


def _persona_env() -> dict[str, str]:
    return {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
        "SIM_OWNER_EMAIL": "sim-owner@wineops.internal",
        "SIM_OWNER_PASSWORD": "owner-secret",
        "SIM_MANAGER_EMAIL": "sim-manager@wineops.internal",
        "SIM_MANAGER_PASSWORD": "manager-secret",
        "SIM_STAFF_EMAIL": "sim-staff@wineops.internal",
        "SIM_STAFF_PASSWORD": "staff-secret",
    }


def test_migration_seed_sim_restaurant_is_security_definer_callable():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "CREATE OR REPLACE FUNCTION seed_sim_restaurant" in sql
    assert "SECURITY DEFINER" in sql
    assert "not implemented" not in sql.lower()
    # Live write targets
    for table in (
        "organizations",
        "restaurants",
        "user_restaurant_access",
        "menu_items",
        "restaurant_inventory",
        "sim_ground_truth_runs",
        "sim_ground_truth_facts",
        "master_wine_library",
    ):
        assert table in sql
    assert "stock_live" in sql
    # No INSERT/UPDATE targeting a nonexistent inventory_stock table
    assert "INTO inventory_stock" not in sql
    assert "UPDATE inventory_stock" not in sql


def test_apply_false_returns_dry_run_plan_only():
    plan = apply_seed("bistro", apply=False)
    assert plan["dry_run"] is True
    assert plan["apply"] is False
    assert "payload" in plan


def test_oracle_failure_rolls_back_no_commit():
    plan = build_seed_plan("bistro")
    payload = build_rpc_payload(plan)
    conn = _FakeConn(fail_on="sim_ground_truth_facts")

    with pytest.raises(RuntimeError, match="forced failure"):
        execute_atomic_seed(payload, conn)

    assert conn.committed is False
    assert conn.rolled_back is True
    # Restaurant insert was attempted before oracle — but rolled back
    assert any(
        op[0] == "execute" and op[1] and "restaurants" in op[1]
        for op in conn.ops
    )


def test_successful_atomic_seed_commits_live_and_oracle():
    plan = build_seed_plan("bistro")
    payload = build_rpc_payload(plan)
    conn = _FakeConn(fail_on=None)

    result = execute_atomic_seed(payload, conn)

    assert conn.committed is True
    assert conn.rolled_back is False
    assert result["restaurant_id"] == plan["restaurant_id"]
    assert result["ok"] is True
    sql_blob = " ".join(str(op[1]) for op in conn.ops if op[0] in ("execute", "executemany"))
    assert "restaurant_inventory" in sql_blob
    assert "stock_live" in sql_blob
    assert "sim_ground_truth_runs" in sql_blob
    assert "sim_ground_truth_facts" in sql_blob
    assert "inventory_stock" not in sql_blob
    # Menu prices from snapshot path present in bind params somewhere
    assert any(
        isinstance(op[2], (list, tuple, dict))
        for op in conn.ops
        if op[0] in ("execute", "executemany")
    )


def test_apply_seed_true_uses_rpc_caller_and_personas():
    personas = {
        "owner": {"user_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "email": "o@x.test", "role": "owner"},
        "manager": {"user_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "email": "m@x.test", "role": "manager"},
        "staff": {"user_id": "cccccccc-cccc-cccc-cccc-cccccccccccc", "email": "s@x.test", "role": "staff"},
    }
    rpc_calls: list[dict] = []

    def rpc_caller(payload: dict) -> dict:
        rpc_calls.append(payload)
        # Simulate success
        assert "oracle_run" in payload
        assert "oracle_facts" in payload
        assert payload["restaurant"]["slug"].startswith("sim-")
        for inv in payload["restaurant_inventory"]:
            assert "stock_live" in inv
            assert "inventory_stock" not in inv
        return {"ok": True, "restaurant_id": payload["restaurant"]["id"]}

    with patch.dict(os.environ, _persona_env(), clear=False):
        with patch("scripts.synth.seed.ensure_personas", return_value=personas):
            result = apply_seed("bistro", apply=True, rpc_caller=rpc_caller)

    assert result["apply"] is True
    assert len(rpc_calls) == 1
    ura_roles = {r["role"] for r in rpc_calls[0]["user_restaurant_access"]}
    assert ura_roles == {"owner", "manager", "staff"}
    ids = {r["user_id"] for r in rpc_calls[0]["user_restaurant_access"]}
    assert ids == {
        personas["owner"]["user_id"],
        personas["manager"]["user_id"],
        personas["staff"]["user_id"],
    }


def test_reseed_payload_is_idempotent_same_restaurant_id():
    p1 = build_rpc_payload(build_seed_plan("bistro"))
    p2 = build_rpc_payload(build_seed_plan("bistro"))
    assert p1["restaurant"]["id"] == p2["restaurant"]["id"]
    assert p1["oracle_run"]["restaurant_id"] == p2["oracle_run"]["restaurant_id"]
    assert p1["oracle_run"]["id"] == p2["oracle_run"]["id"]
