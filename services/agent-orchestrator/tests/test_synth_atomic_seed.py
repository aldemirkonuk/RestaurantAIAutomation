"""Wave 2 — D-10 atomic seed fail-closed (37-02)."""

from __future__ import annotations

import os
import re
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.synth.seed import (
    apply_seed,
    build_rpc_payload,
    build_seed_plan,
    execute_atomic_seed,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"


def _function_body(function_name: str) -> str:
    """Return just the CREATE FUNCTION block for `function_name`.

    Two things this deliberately does not do.

    It does not name a file. This test used to hardcode
    20260727230000_sim_ground_truth.sql; the schema baseline in adc4131 folded
    every per-feature migration into a single dump and deleted that file, so the
    test failed on a missing path while the function itself was fine. A filename
    is not the fact under test.

    It does not return the whole migration. The baseline is ~15k lines
    containing the entire schema, so asserting "SECURITY DEFINER" or a table
    name against the full text would pass no matter what this function does —
    the assertions would still be green with the function deleted. Slicing to
    the single definition keeps the test measuring what it claims to measure.
    """
    # pg_dump emits "CREATE FUNCTION public.foo(...)"; hand-written migrations
    # use "CREATE OR REPLACE FUNCTION foo(...)". Accept both spellings.
    start_re = re.compile(
        rf"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?{function_name}\b",
        re.IGNORECASE,
    )
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        match = start_re.search(sql)
        if not match:
            continue
        tail = sql[match.start() :]
        # Function bodies are dollar-quoted ($$ … $$ or $tag$ … $tag$). Take
        # through the closing tag; fall back to the rest of the file if the
        # body is quoted some other way.
        tag = re.match(r".*?(\$[A-Za-z_]*\$)", tail, re.DOTALL)
        if tag:
            delim = tag.group(1)
            close = tail.find(delim, tail.find(delim) + len(delim))
            if close != -1:
                return tail[: close + len(delim)]
        return tail
    raise AssertionError(
        f"No migration in {MIGRATIONS_DIR} defines {function_name}(). "
        "It exists in production, so a migration must create it or a fresh "
        "environment will diverge from prod."
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


# ── ADR 0093 D4: the REST half of the apply path, with no network ───────────
#
# `apply_seed(apply=True)` now does three things after the seed RPC: it PATCHes
# `restaurants.operating_hours`, it materialises the planned `stock_live` as
# real `inventory_lots` through `apply_stock_movement`, and it READS THE STOCK
# BACK and refuses to report success if the database disagrees with the plan.
# This stand-in records every call and answers as PostgREST would.


class FakeRest:
    """A PostgREST stand-in that applies the deltas it is sent, for real.

    A stub that returned a canned readback could not fail the mismatch test —
    it would agree with the plan by construction, which is the shape of an
    assertion that proves nothing.
    """

    def __init__(
        self,
        *,
        existing_keys: set[str] | None = None,
        stock_override: dict[str, int] | None = None,
        drop_inventory_rows: bool = False,
    ) -> None:
        self.calls: list[dict] = []
        self.existing_keys = set(existing_keys or ())
        # What `seed_sim_restaurant` wrote DIRECTLY into stock_live, with no
        # lots behind it — the phantom stock ADR 0093 D4 is about.
        self.direct_stock: dict[str, int] = {}
        # The lots, and therefore what `trg_project_stock_from_lots` will make
        # stock_live once ANY lot exists for the row.
        self.lots: dict[str, int] = {}
        self.stock_override = dict(stock_override or {})
        self.drop_inventory_rows = drop_inventory_rows
        self.patched_hours: object = None

    def prime_inventory(self, rows) -> None:
        """Model the seed RPC's direct stock_live write, lots absent."""
        for row in rows:
            self.direct_stock[str(row["id"])] = int(row["stock_live"] or 0)

    def __call__(self, method, path, *, json_body=None, params=None):
        self.calls.append(
            {
                "method": method,
                "path": path,
                "json": json_body,
                "params": dict(params or {}),
            }
        )
        # ADR 0093 (2026-09-03): the apply path resolves library identities
        # before the RPC and binds the personas after it.
        if method == "POST" and path == "/rest/v1/rpc/wine_signature_hash":
            from scripts.synth.identity import wine_signature_hash

            b = json_body or {}
            return wine_signature_hash(
                b.get("p_producer"),
                b.get("p_name"),
                b.get("p_vintage"),
                b.get("p_country"),
                b.get("p_region"),
                b.get("p_grape_variety"),
            )
        if method == "GET" and path == "/rest/v1/master_wine_library":
            return []
        if method == "PATCH" and path == "/rest/v1/users":
            self.bound_restaurant = (json_body or {}).get("restaurant_id")
            return None
        if method == "GET" and path == "/rest/v1/users":
            ids = (params or {}).get("user_id", "in.()")[len("in.(") : -1].split(",")
            return [
                {"user_id": u, "restaurant_id": getattr(self, "bound_restaurant", None)}
                for u in ids
                if u
            ]
        if method == "PATCH" and path == "/rest/v1/restaurants":
            self.patched_hours = (json_body or {}).get("operating_hours")
            return [{"id": (params or {}).get("id", "").removeprefix("eq.")}]
        if method == "GET" and path == "/rest/v1/inventory_transactions":
            return [{"idempotency_key": k} for k in sorted(self.existing_keys)]
        if method == "POST" and path == "/rest/v1/rpc/apply_stock_movement":
            body = json_body or {}
            key = body["p_idempotency_key"]
            if key not in self.existing_keys:
                self.existing_keys.add(key)
                iid = body["p_inventory_id"]
                self.lots[iid] = self.lots.get(iid, 0) + int(body["p_delta"])
            return "11111111-1111-1111-1111-111111111111"
        if method == "GET" and path == "/rest/v1/restaurant_inventory":
            if self.drop_inventory_rows:
                return []
            out = [
                {
                    "id": iid,
                    # The projection wins the moment a lot exists — otherwise
                    # the row still shows the seed's direct write.
                    "stock_live": self.lots.get(iid, direct),
                }
                for iid, direct in self.direct_stock.items()
            ]
            for iid, qty in self.stock_override.items():
                for row in out:
                    if row["id"] == iid:
                        row["stock_live"] = qty
            return out
        raise AssertionError(f"unexpected REST call: {method} {path}")

    def movements(self) -> list[dict]:
        return [
            c["json"]
            for c in self.calls
            if c["path"] == "/rest/v1/rpc/apply_stock_movement"
        ]


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
    sql = _function_body("seed_sim_restaurant")
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
        op[0] == "execute" and op[1] and "restaurants" in op[1] for op in conn.ops
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
    sql_blob = " ".join(
        str(op[1]) for op in conn.ops if op[0] in ("execute", "executemany")
    )
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
        "owner": {
            "user_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "email": "o@x.test",
            "role": "owner",
        },
        "manager": {
            "user_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "email": "m@x.test",
            "role": "manager",
        },
        "staff": {
            "user_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
            "email": "s@x.test",
            "role": "staff",
        },
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

    # The REST half of the apply path is stubbed, not skipped: ADR 0093 made
    # `apply_seed` do more than call the RPC, and a test that mocked only the
    # RPC would silently reach the network for the rest.
    rest = FakeRest()
    rest.prime_inventory(build_seed_plan("bistro")["payload"]["restaurant_inventory"])

    with patch.dict(os.environ, _persona_env(), clear=False):
        with patch("scripts.synth.seed.ensure_personas", return_value=personas):
            result = apply_seed(
                "bistro", apply=True, rpc_caller=rpc_caller, rest_caller=rest
            )

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


# ── ADR 0093 D4 — opening stock is materialised as lots, and verified ────────
#
# WHY. `seed_sim_restaurant` writes `restaurant_inventory.stock_live` directly
# and creates NO `inventory_lots` (checked with pg_get_functiondef on production
# 2026-09-02: zero mentions of the table). `stock_live` is a PROJECTION
# maintained by `trg_project_stock_from_lots`, and both depletion RPCs read lots
# only — so a freshly seeded sim tenant showed 12 bottles and raised
# `no stock to pour` on the first glass. Every test below fails against the code
# as it stood before this change.

_PERSONAS = {
    "owner": {
        "user_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "email": "o@x.test",
        "role": "owner",
    },
    "manager": {
        "user_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "email": "m@x.test",
        "role": "manager",
    },
    "staff": {
        "user_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "email": "s@x.test",
        "role": "staff",
    },
}


def _apply_with(rest, archetype: str = "bistro") -> dict:
    seen: list[dict] = []
    # `seed_sim_restaurant` has already run by the time the REST half starts, so
    # the inventory rows exist with stock_live written directly and no lots.
    primer = rest if isinstance(rest, FakeRest) else getattr(rest, "rest", None)
    if isinstance(primer, FakeRest):
        primer.prime_inventory(
            build_seed_plan(archetype)["payload"]["restaurant_inventory"]
        )

    def rpc_caller(payload: dict) -> dict:
        seen.append(payload)
        return {"ok": True, "restaurant_id": payload["restaurant"]["id"]}

    with patch.dict(os.environ, _persona_env(), clear=False):
        with patch("scripts.synth.seed.ensure_personas", return_value=_PERSONAS):
            plan = apply_seed(
                archetype, apply=True, rpc_caller=rpc_caller, rest_caller=rest
            )
    plan["_rpc_payloads"] = seen
    return plan


def test_apply_calls_apply_stock_movement_once_per_stocked_row():
    """One lot per stocked SKU, through the same door a real receipt uses."""
    from scripts.synth.seed import opening_stock_idempotency_key

    rest = FakeRest()
    plan = _apply_with(rest)

    stocked = [
        r for r in plan["payload"]["restaurant_inventory"] if int(r["stock_live"]) > 0
    ]
    assert stocked, "the bistro archetype must stock something for this to test"
    movements = rest.movements()
    assert len(movements) == len(stocked)

    by_id = {m["p_inventory_id"]: m for m in movements}
    for row in stocked:
        m = by_id[row["id"]]
        # The exact payload. Every field is load-bearing.
        assert m["p_stock_state"] == "live"
        assert m["p_delta"] == int(row["stock_live"])
        assert m["p_transaction_type"] == "initial"
        assert m["p_source"] == "system"
        assert m["p_reason"] == "sim opening stock (ADR 0093 D4)"
        assert m["p_idempotency_key"] == opening_stock_idempotency_key(row["id"])
        # NO price and NO provenance. The RPC then labels the lot `estimated`,
        # which is the honest label for a quantity nobody has costed. Passing a
        # provenance without a price has raised since ADR 0078, and passing
        # `invoice` over an invented number would be the lie that ADR forbids.
        assert "p_unit_cost" not in m
        assert "p_cost_provenance" not in m

    assert plan["lots_materialised"] == len(stocked)
    assert plan["lots_already_present"] == 0
    assert plan["stock_verified"] == len(plan["payload"]["restaurant_inventory"])


def test_apply_sends_no_movement_for_a_zero_stock_row(monkeypatch):
    """A lot of zero bottles is not a fact, and the RPC no-ops on a zero delta."""
    import scripts.synth.seed as seed_mod

    real = seed_mod.compute_opening_stock
    calls = {"n": 0}

    def every_third_is_zero(item, cfg, *, restaurant_price_tier=None):
        calls["n"] += 1
        if calls["n"] % 3 == 0:
            return 0
        return real(item, cfg, restaurant_price_tier=restaurant_price_tier)

    monkeypatch.setattr(seed_mod, "compute_opening_stock", every_third_is_zero)

    rest = FakeRest()
    plan = _apply_with(rest)

    inventory = plan["payload"]["restaurant_inventory"]
    zero_ids = {r["id"] for r in inventory if int(r["stock_live"]) == 0}
    stocked_ids = {r["id"] for r in inventory if int(r["stock_live"]) > 0}
    assert zero_ids, "the monkeypatch must actually produce zero-stock rows"

    moved = {m["p_inventory_id"] for m in rest.movements()}
    assert moved == stocked_ids
    assert not (moved & zero_ids)


def test_apply_raises_when_the_readback_disagrees_with_the_plan():
    """A seed must not report success over stock the database does not hold.

    This is the whole point of the readback: reporting success over phantom
    stock is the fault being fixed, and reporting success over a FAILED
    materialisation would be the same fault one layer up.
    """
    plan_only = build_seed_plan("bistro")
    victim = plan_only["payload"]["restaurant_inventory"][0]["id"]

    rest = FakeRest(stock_override={victim: 0})
    with pytest.raises(RuntimeError, match="does not match the plan"):
        _apply_with(rest)


def test_apply_raises_when_the_readback_returns_nothing():
    """An empty readback is not agreement — it is the absence of evidence."""
    rest = FakeRest(drop_inventory_rows=True)
    with pytest.raises(RuntimeError, match="does not match the plan"):
        _apply_with(rest)


def test_a_second_apply_materialises_nothing_and_says_so():
    """The idempotency key makes a re-run a no-op, and the counts say which."""
    rest = FakeRest()
    first = _apply_with(rest)
    assert first["lots_materialised"] > 0
    assert first["lots_already_present"] == 0

    # Same FakeRest: the keys and the stock it already holds carry over, exactly
    # as the real database would.
    before = len(rest.movements())
    second = _apply_with(rest)
    assert second["lots_materialised"] == 0
    assert second["lots_already_present"] == first["lots_materialised"]
    # The calls are still made — the RPC is the thing that decides a replay —
    # but nothing new is written.
    assert len(rest.movements()) == before * 2


def test_apply_patches_the_archetype_s_operating_hours():
    """The tenant learns its own hours, from the archetype, not from a default."""
    import json as _json
    from pathlib import Path as _Path

    rest = FakeRest()
    plan = _apply_with(rest)

    archetype = _json.loads(
        (REPO_ROOT / "datasets" / "sim" / "archetypes" / "bistro.json").read_text(
            encoding="utf-8"
        )
    )
    expected = archetype["restaurant"]["operating_hours"]

    patches = [c for c in rest.calls if c["path"] == "/rest/v1/restaurants"]
    assert len(patches) == 1
    assert patches[0]["method"] == "PATCH"
    assert patches[0]["params"] == {"id": f"eq.{plan['restaurant_id']}"}
    assert patches[0]["json"] == {"operating_hours": expected}
    assert rest.patched_hours == expected
    assert plan["operating_hours"] == expected
    assert plan["operating_hours_written"] is True
    assert _Path  # keep the import meaningful under ruff


def test_dry_run_shows_the_hours_and_the_lots_it_would_write():
    """`generate` without --apply must show what --apply would do."""
    plan = build_seed_plan("bistro")
    assert plan["payload"]["restaurant"]["operating_hours"], "hours missing from plan"
    stocked = [
        r for r in plan["payload"]["restaurant_inventory"] if int(r["stock_live"]) > 0
    ]
    assert plan["tables"]["inventory_lots"]["row_count"] == len(stocked)
    assert plan["tables"]["inventory_transactions"]["row_count"] == len(stocked)
    assert len(plan["opening_stock_plan"]) == len(stocked)


def test_a_patch_that_matched_no_restaurant_is_not_a_successful_write():
    """PostgREST answers a no-match PATCH with [], not an error."""
    rest = FakeRest()

    def patched(method, path, *, json_body=None, params=None):
        if method == "PATCH":
            rest.calls.append(
                {
                    "method": method,
                    "path": path,
                    "json": json_body,
                    "params": dict(params or {}),
                }
            )
            return []
        return rest(method, path, json_body=json_body, params=params)

    with pytest.raises(RuntimeError, match="matched no restaurant"):
        _apply_with(patched)  # type: ignore[arg-type]


def test_apply_seed_refuses_the_network_when_only_rpc_caller_is_injected():
    """A unit test must not silently reach the only Supabase project there is."""
    with patch.dict(os.environ, _persona_env(), clear=False):
        with patch("scripts.synth.seed.ensure_personas", return_value=_PERSONAS):
            with pytest.raises(RuntimeError, match="rest_caller"):
                apply_seed("bistro", apply=True, rpc_caller=lambda p: {"ok": True})
