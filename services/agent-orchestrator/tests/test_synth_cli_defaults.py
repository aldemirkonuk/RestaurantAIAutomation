"""Wave 3 — D-16 CLI default dry-run + FastAPI admin synth routes."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest


def test_cli_generate_without_apply_is_dry_run(monkeypatch):
    from scripts.synth import cli

    calls = []

    def fake_apply(archetype_id, *, apply=False, **kwargs):
        calls.append({"archetype_id": archetype_id, "apply": apply})
        return {
            "archetype_id": archetype_id,
            "dry_run": not apply,
            "apply": apply,
            "slug": f"sim-{archetype_id}",
            "sku_count": 1,
            "tables": {},
        }

    monkeypatch.setattr(cli, "apply_seed", fake_apply)
    monkeypatch.setattr(
        cli, "list_archetypes", lambda: ["bistro", "cafe", "fine-dining", "high-volume-bar", "turkish-clone"]
    )
    code = cli.main(["generate", "--archetype", "bistro"])
    assert code == 0
    assert calls == [{"archetype_id": "bistro", "apply": False}]


def test_cli_generate_all_without_apply_does_not_mutate(monkeypatch):
    from scripts.synth import cli

    calls = []

    def fake_apply(archetype_id, *, apply=False, **kwargs):
        calls.append(apply)
        return {
            "archetype_id": archetype_id,
            "dry_run": True,
            "apply": False,
            "slug": f"sim-{archetype_id}",
            "sku_count": 0,
            "tables": {},
        }

    monkeypatch.setattr(cli, "apply_seed", fake_apply)
    monkeypatch.setattr(cli, "list_archetypes", lambda: ["bistro", "cafe"])
    code = cli.main(["generate", "--archetype", "all"])
    assert code == 0
    assert calls == [False, False]


def test_cli_generate_all_apply_invokes_write_set_gate(monkeypatch):
    from scripts.synth import cli
    from scripts.synth.teardown import WriteSetTeardownCoverageError

    def boom():
        raise WriteSetTeardownCoverageError("gate red")

    monkeypatch.setattr(cli, "assert_teardown_coverage", boom)
    monkeypatch.setattr(cli, "list_archetypes", lambda: ["bistro", "cafe"])
    apply_mock = MagicMock()
    monkeypatch.setattr(cli, "apply_seed", apply_mock)
    code = cli.main(["generate", "--archetype", "all", "--apply"])
    assert code != 0
    apply_mock.assert_not_called()


def test_cli_teardown_without_apply_is_dry_run(monkeypatch):
    from scripts.synth import cli

    called = {}

    def fake_teardown(*, apply=False, **kwargs):
        called["apply"] = apply
        return {"ok": True, "dry_run": not apply, "sim_restaurant_ids": []}

    monkeypatch.setattr(cli, "teardown_sim", fake_teardown)
    code = cli.main(["teardown"])
    assert code == 0
    assert called["apply"] is False


def test_cli_refresh_without_apply_does_not_mutate(monkeypatch):
    from scripts.synth import cli

    called = {}

    def fake_refresh(archetype_id, *, use_crawler=True):
        called["id"] = archetype_id
        return {"archetype_id": archetype_id, "item_count": 0}

    monkeypatch.setattr(cli, "refresh_snapshot", fake_refresh)
    # refresh also needs --apply for network mutate per D-16
    code = cli.main(["refresh", "--archetype", "bistro"])
    assert code == 0
    # dry-run refresh should not call mutate path
    assert "id" not in called or called.get("dry_run") is True


def test_package_json_has_synth_scripts():
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    pkg = json.loads((root / "package.json").read_text())
    scripts = pkg["scripts"]
    assert scripts["synth:refresh"] == "python3 -m scripts.synth refresh"
    assert scripts["synth:generate"] == "python3 -m scripts.synth generate"
    assert scripts["synth:teardown"] == "python3 -m scripts.synth teardown"
