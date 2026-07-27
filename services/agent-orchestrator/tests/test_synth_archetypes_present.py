"""Wave 1 — SYNTH-05 ≥5 named archetypes present."""

from __future__ import annotations

from pathlib import Path

EXPECTED = [
    "fine-dining",
    "bistro",
    "high-volume-bar",
    "cafe",
    "turkish-clone",
]


def _repo_root() -> Path:
    # tests/ → agent-orchestrator → services → repo root
    return Path(__file__).resolve().parents[3]


def test_list_archetypes_returns_five_named_ids():
    from scripts.synth.recipes import list_archetypes

    ids = list(list_archetypes())
    assert ids == EXPECTED


def test_archetype_json_files_exist_with_opening_stock():
    import json

    root = _repo_root()
    for arch in EXPECTED:
        path = root / "datasets" / "sim" / "archetypes" / f"{arch}.json"
        assert path.is_file(), f"missing archetype recipe: {path}"
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data.get("archetype_id") == arch
        opening = data.get("opening_stock") or {}
        assert opening, f"{arch} opening_stock empty (D-07)"
        assert "default_bottles" in opening
        snap = data.get("snapshot") or ""
        assert snap.endswith(f"{arch}.json") or arch in snap
