"""Wave 1 — SYNTH-02 snapshot replay is offline-only (no network)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def test_load_snapshot_reads_frozen_json_only(monkeypatch):
    from scripts.synth import snapshots

    # Poison common network / crawl entrypoints — load_snapshot must not touch them.
    fake_httpx = MagicMock()
    fake_httpx.get = MagicMock(side_effect=AssertionError("httpx must not be called"))
    fake_httpx.post = MagicMock(side_effect=AssertionError("httpx must not be called"))
    monkeypatch.setitem(sys.modules, "httpx", fake_httpx)

    fake_playwright = MagicMock()
    monkeypatch.setitem(sys.modules, "playwright", fake_playwright)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", MagicMock())
    monkeypatch.setitem(sys.modules, "playwright.async_api", MagicMock())

    crawl_called = {"n": 0}

    def _boom(*_a, **_k):
        crawl_called["n"] += 1
        raise AssertionError("WebCrawlerService must not be called during load_snapshot")

    monkeypatch.setattr(snapshots, "refresh_snapshot", _boom, raising=False)

    snap = snapshots.load_snapshot("bistro")
    assert crawl_called["n"] == 0
    assert snap.get("archetype_id") == "bistro"
    assert isinstance(snap.get("items"), list)
    assert len(snap["items"]) >= 1
    path = _repo_root() / "datasets" / "sim" / "menus" / "bistro.json"
    assert path.is_file()


def test_load_snapshot_does_not_invoke_refresh(monkeypatch):
    from scripts.synth import snapshots

    calls = []

    def _track(*a, **k):
        calls.append((a, k))
        raise AssertionError("refresh_snapshot must not run on generate/replay path")

    monkeypatch.setattr(snapshots, "refresh_snapshot", _track)
    snapshots.load_snapshot("cafe")
    assert calls == []
