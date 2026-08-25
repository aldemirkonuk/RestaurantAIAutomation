"""Wave 1 — SYNTH-02 snapshot schema + price mapping (D-03 / D-04)."""

from __future__ import annotations

import json
from pathlib import Path


ARCHETYPES = [
    "fine-dining",
    "bistro",
    "high-volume-bar",
    "cafe",
    "turkish-clone",
]

REQUIRED_ENVELOPE = {
    "archetype_id",
    "source_url",
    "source_name",
    "extracted_at",
    "extraction_model",
    "menu_quality",
    "items",
}

REQUIRED_ITEM = {
    "wine_name",
    "producer",
    "vintage",
    "bottle_price",
    "by_glass_price",
    "signature_hash",
    "primary_type",
    "country",
    "region",
    "grape_variety",
}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def test_all_five_snapshots_match_schema():
    root = _repo_root()
    for arch in ARCHETYPES:
        path = root / "datasets" / "sim" / "menus" / f"{arch}.json"
        assert path.is_file(), f"missing snapshot {path}"
        data = json.loads(path.read_text(encoding="utf-8"))
        missing = REQUIRED_ENVELOPE - set(data)
        assert not missing, f"{arch} missing envelope keys: {missing}"
        assert data["archetype_id"] == arch
        assert data["menu_quality"] in ("full", "partial")
        items = data["items"]
        assert isinstance(items, list) and len(items) >= 1, f"{arch} needs ≥1 SKU"
        for item in items:
            missing_item = REQUIRED_ITEM - set(item)
            assert not missing_item, f"{arch} item missing {missing_item}"
            # D-04: never invent prices — null allowed; non-null must be numeric
            for price_key in ("bottle_price", "by_glass_price"):
                val = item[price_key]
                assert val is None or isinstance(val, (int, float))


def test_priced_sku_ratio_sets_menu_quality():
    """When priced_sku_ratio < 0.9, menu_quality must be partial."""
    from scripts.synth.snapshots import compute_menu_quality

    # Synthetic rows: 1 priced / 2 total → ratio 0.5 → partial
    rows = [
        {"wine_name": "A", "price_reference": 10.0, "price_glass": None},
        {"wine_name": "B", "price_reference": None, "price_glass": None},
    ]
    quality = compute_menu_quality(rows)
    assert quality == "partial"

    # All priced → full
    rows_full = [
        {"wine_name": "A", "price_reference": 10.0},
        {"wine_name": "B", "price_reference": 20.0},
    ]
    assert compute_menu_quality(rows_full) == "full"


def test_manifest_lists_sha256_for_each_menu():
    import hashlib

    root = _repo_root()
    manifest_path = root / "datasets" / "sim" / "manifest.json"
    assert manifest_path.is_file()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert "pack_version" in manifest
    assert "archetypes" in manifest or "menus" in manifest
    entries = manifest.get("menus") or manifest.get("archetypes")
    assert entries, "manifest must list menu/archetype hashes"
    for arch in ARCHETYPES:
        menu_path = root / "datasets" / "sim" / "menus" / f"{arch}.json"
        digest = hashlib.sha256(menu_path.read_bytes()).hexdigest()
        # Flexible: list of objects or dict keyed by archetype
        if isinstance(entries, dict):
            entry = entries[arch]
            sha = entry.get("sha256") if isinstance(entry, dict) else entry
        else:
            match = [
                e
                for e in entries
                if (e.get("archetype_id") or e.get("id") or e.get("file", "")).endswith(
                    arch
                )
                or e.get("archetype_id") == arch
                or arch in str(e.get("file", ""))
            ]
            assert match, f"manifest missing entry for {arch}"
            sha = match[0].get("sha256")
        assert sha == digest, f"sha256 mismatch for {arch}"


def test_turkish_clone_has_real_avli_sku():
    root = _repo_root()
    data = json.loads(
        (root / "datasets" / "sim" / "menus" / "turkish-clone.json").read_text(
            encoding="utf-8"
        )
    )
    names = " ".join(i.get("wine_name", "") for i in data["items"]).upper()
    # Real SKU names from Avli Taverna Lincoln Park wine list
    assert any(
        token in names
        for token in ("ASSYRTIKO", "XINOMAVRO", "MALAGOUSIA", "MOSCOFILERO", "RETSINA")
    ), "turkish-clone must include at least one real Avli SKU name"
