"""Gold-set oracle must fail loud, never report a vacuous green.

Regression guard for wave-3 DAT-9: ``BenchmarkManager`` pointed at
``datasets/annotated/menus`` (which ships only ``.gitkeep``), so
``run_benchmark`` iterated an empty corpus and returned
``overall_accuracy == 0.0`` over ``0`` documents — a passing-looking result
that asserted nothing. Per ADR 0025 ("a claim that cannot run is a FAILURE")
and the ``check_*.sh`` "exit 2 when it cannot check" discipline, an empty or
below-threshold gold set must raise, not return a green 0/0.

These tests use a tmp-dir fixture and a stub parser so they never touch the
real ``datasets/`` tree or the real menu parser.
"""

from __future__ import annotations

import json
import sys
import types

import pytest

import services.active_learning_service as als
from services.active_learning_service import (
    BenchmarkCorpusError,
    BenchmarkManager,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EXPECTED_WINE = {
    "wine_name": "Opus One",
    "producer": "Opus One Winery",
    "vintage": 2019,
    "region": "Napa Valley",
    "wine_type": "red",
    "price": 450,
}


def _write_docs(dir_path, n, *, with_fields=True):
    """Write ``n`` benchmark JSON docs into ``dir_path``."""
    dir_path.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        doc = {"benchmark": True}
        if with_fields:
            doc["raw_text"] = f"menu blob {i}"
            doc["expected_wines"] = [dict(_EXPECTED_WINE)]
        (dir_path / f"benchmark_{i:04d}.json").write_text(json.dumps(doc))


@pytest.fixture
def gold_dir(tmp_path, monkeypatch):
    """Point the oracle at an isolated tmp corpus + metrics file."""
    corpus = tmp_path / "annotated" / "menus"
    corpus.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(als, "BENCHMARK_DIR", corpus)
    monkeypatch.setattr(als, "METRICS_FILE", tmp_path / "_metrics.jsonl")
    return corpus


@pytest.fixture
def stub_parser(monkeypatch):
    """Replace the real menu parser with one that echoes the expected wine."""

    class _Parsed:
        wines = [dict(_EXPECTED_WINE)]

    class _Parser:
        def parse_menu(self, raw_text, source_type=None):
            return _Parsed()

    stub_mod = types.ModuleType("services.html_menu_parser")
    stub_mod.get_menu_parser = lambda: _Parser()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "services.html_menu_parser", stub_mod)


# ---------------------------------------------------------------------------
# Fail-loud on an unusable corpus
# ---------------------------------------------------------------------------


def test_empty_gold_set_raises_instead_of_green_zero(gold_dir):
    """An empty corpus must raise, not return overall_accuracy == 0.0."""
    mgr = BenchmarkManager()
    assert mgr.benchmark_size == 0
    with pytest.raises(BenchmarkCorpusError) as exc:
        mgr.run_benchmark()
    msg = str(exc.value)
    assert "gold set is empty" in msg
    assert "0 documents" in msg
    assert str(gold_dir) in msg


def test_gitkeep_only_dir_is_treated_as_empty(gold_dir):
    """The exact production shape: dir exists but holds only .gitkeep."""
    (gold_dir / ".gitkeep").write_text("")
    mgr = BenchmarkManager()
    assert mgr.benchmark_size == 0
    with pytest.raises(BenchmarkCorpusError):
        mgr.run_benchmark()


def test_below_threshold_corpus_raises(gold_dir):
    """A handful of docs (< BENCHMARK_MIN_DOCS) still cannot assert accuracy."""
    _write_docs(gold_dir, BenchmarkManager.BENCHMARK_MIN_DOCS - 1)
    mgr = BenchmarkManager()
    assert 0 < mgr.benchmark_size < BenchmarkManager.BENCHMARK_MIN_DOCS
    with pytest.raises(BenchmarkCorpusError) as exc:
        mgr.run_benchmark()
    assert f">= {BenchmarkManager.BENCHMARK_MIN_DOCS}" in str(exc.value)


def test_present_but_noncomparable_corpus_raises(gold_dir):
    """Enough docs, but none carry raw_text/expected_wines -> nothing compared."""
    _write_docs(gold_dir, BenchmarkManager.BENCHMARK_MIN_DOCS, with_fields=False)
    mgr = BenchmarkManager()
    assert mgr.benchmark_size == BenchmarkManager.BENCHMARK_MIN_DOCS
    with pytest.raises(BenchmarkCorpusError) as exc:
        mgr.run_benchmark()
    assert "no comparable field" in str(exc.value) or "yielded a comparable" in str(
        exc.value
    )


# ---------------------------------------------------------------------------
# Passes on a populated corpus
# ---------------------------------------------------------------------------


def test_populated_gold_set_asserts_accuracy(gold_dir, stub_parser):
    """A populated corpus returns a real, non-vacuous accuracy number."""
    _write_docs(gold_dir, BenchmarkManager.BENCHMARK_MIN_DOCS)
    mgr = BenchmarkManager()
    assert mgr.benchmark_size == BenchmarkManager.BENCHMARK_MIN_DOCS
    result = mgr.run_benchmark()
    assert result.total_documents == BenchmarkManager.BENCHMARK_MIN_DOCS
    # Stub parser echoes the expected wine, so every field matches -> 1.0,
    # computed over a real comparison set (not the vacuous 0.0 / 0 fields).
    assert result.overall_accuracy == pytest.approx(1.0)
    assert result.field_accuracies  # non-empty: fields were actually compared


def test_improvement_cycle_reports_skip_reason_when_below_threshold(gold_dir):
    """run_improvement_cycle must say WHY it skipped, not silently return None."""
    from services.active_learning_service import ActiveLearningService

    svc = ActiveLearningService()  # gold set empty
    out = svc.run_improvement_cycle()
    assert out["benchmark_result"] is None
    assert out["benchmark_skipped_reason"]
    assert "not validated" in out["benchmark_skipped_reason"]


def test_improvement_cycle_reports_skip_reason_when_noncomparable(gold_dir):
    """Docs present but nothing comparable must be REPORTED, not raised.

    Before the fix only the below-threshold shape was pre-checked, so this one
    escaped run_improvement_cycle as an uncaught BenchmarkCorpusError.
    """
    from services.active_learning_service import ActiveLearningService

    _write_docs(gold_dir, BenchmarkManager.BENCHMARK_MIN_DOCS, with_fields=False)
    svc = ActiveLearningService()
    assert svc.benchmark.benchmark_size == BenchmarkManager.BENCHMARK_MIN_DOCS
    out = svc.run_improvement_cycle()  # must not raise
    assert out["benchmark_result"] is None
    assert "not validated" in out["benchmark_skipped_reason"]
    assert "comparable field" in out["benchmark_skipped_reason"]


# ---------------------------------------------------------------------------
# Consumer boundary: the HTTP endpoint fails loud (503), never 200 with 0.0
# ---------------------------------------------------------------------------


async def test_benchmark_endpoint_returns_503_on_empty_gold_set(gold_dir, monkeypatch):
    """The /learning/benchmark route must surface the empty corpus as an error."""
    from fastapi import HTTPException
    from api import scan_routes

    # Force a fresh service that reads the patched (empty) BENCHMARK_DIR.
    monkeypatch.setattr(als, "_service_instance", None)

    with pytest.raises(HTTPException) as exc:
        await scan_routes.run_benchmark()
    assert exc.value.status_code == 503
    assert "accuracy cannot be asserted" in str(exc.value.detail)


async def test_run_cycle_endpoint_returns_503_on_empty_gold_set(gold_dir, monkeypatch):
    """/learning/run-cycle must not answer 200 for a benchmark that never ran.

    It previously returned 200 with a benchmark_skipped_reason body field:
    loud in the body, green in the status code.
    """
    from fastapi import HTTPException
    from api import scan_routes

    monkeypatch.setattr(als, "_service_instance", None)

    with pytest.raises(HTTPException) as exc:
        await scan_routes.run_learning_cycle()
    assert exc.value.status_code == 503
    # The non-benchmark half really ran, so the 503 carries its payload rather
    # than pretending nothing happened.
    detail = exc.value.detail
    assert isinstance(detail, dict)
    assert detail["benchmark_result"] is None
    assert "not validated" in detail["benchmark_skipped_reason"]
    assert detail["new_rules_proposed"] == 0
    assert detail["rules"] == []


async def test_run_cycle_endpoint_returns_503_on_noncomparable_gold_set(
    gold_dir, monkeypatch
):
    """Docs present (>= MIN_DOCS) but none comparable gets the SAME 503, not a 500.

    This path used to escape run_improvement_cycle uncaught, so FastAPI turned
    it into a 500 — asymmetric with the benchmark route's graceful 503.
    """
    from fastapi import HTTPException
    from api import scan_routes

    _write_docs(gold_dir, BenchmarkManager.BENCHMARK_MIN_DOCS, with_fields=False)
    monkeypatch.setattr(als, "_service_instance", None)

    with pytest.raises(HTTPException) as exc:
        await scan_routes.run_learning_cycle()
    assert exc.value.status_code == 503
    assert "comparable field" in exc.value.detail["benchmark_skipped_reason"]


async def test_run_cycle_endpoint_returns_200_on_populated_gold_set(
    gold_dir, stub_parser, monkeypatch
):
    """The happy path is untouched: a usable gold set still returns a payload."""
    from api import scan_routes

    _write_docs(gold_dir, BenchmarkManager.BENCHMARK_MIN_DOCS)
    monkeypatch.setattr(als, "_service_instance", None)

    out = await scan_routes.run_learning_cycle()  # no HTTPException -> 200
    assert out["benchmark_skipped_reason"] is None
    assert out["benchmark_result"]["overall_accuracy"] == pytest.approx(1.0)
    assert out["benchmark_result"]["field_accuracies"]
