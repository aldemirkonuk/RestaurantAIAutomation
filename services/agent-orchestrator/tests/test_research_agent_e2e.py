"""
Phase 12: Research Agent E2E Integration Test (RSCH-11)
=======================================================
End-to-end test: wine with 5 NULL priority fields → agent fills ≥3 with
valid citations → metrics endpoint reflects the run.

Strategy:
  - Serper and Gemini HTTP calls are mocked (no live API keys required)
  - All other logic runs for real: eligibility gate, evidence loop,
    field_confidence merges, regression guard, conflict detection, DB writes
  - Real Supabase is required — test is skipped when SUPABASE_URL not set

Run (unit tests only — fast, no mocks needed):
    cd services/agent-orchestrator && pytest tests/test_research_agent_helpers.py

Run E2E (requires Supabase test connection):
    cd services/agent-orchestrator && pytest tests/test_research_agent_e2e.py -m e2e
"""

import asyncio
import logging
import os
import sys
import uuid
from unittest.mock import AsyncMock, patch

import pytest

# Allow running from the agent-orchestrator root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.research_agent_helpers import RESEARCH_ALL_FIELDS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Mock Serper response — returned for every query
# ---------------------------------------------------------------------------

MOCK_SERPER_RESULTS = [
    {
        "title": "Brunello di Montalcino DOCG - Consorzio",
        "link": "https://www.consorziobrunellomontalcino.it/en/the-brunello/",
        "snippet": (
            "Brunello di Montalcino DOCG is produced exclusively from Sangiovese Grosso grapes "
            "in the Montalcino municipality, Tuscany, Italy."
        ),
        "position": 1,
    },
    {
        "title": "Biondi-Santi - Wine-Searcher",
        "link": "https://www.wine-searcher.com/find/biondi+santi",
        "snippet": (
            "Biondi-Santi is the historic producer of Brunello di Montalcino, "
            "estate located in Montalcino, Tuscany, Italy."
        ),
        "position": 2,
    },
]

# Mock Gemini extraction: returns structured candidates per target field.
# Only the 5 NULL fields get data; all others return [] (no candidates).
_MOCK_CANDIDATES: dict[str, list[dict]] = {
    "wine_name": [
        {
            "value": "Brunello di Montalcino",
            "source_url": "https://www.consorziobrunellomontalcino.it/en/the-brunello/",
            "snippet_used": "Brunello di Montalcino DOCG",
            "confidence": 0.95,
        }
    ],
    "producer": [
        {
            "value": "Biondi-Santi",
            "source_url": "https://www.wine-searcher.com/find/biondi+santi",
            "snippet_used": "Biondi-Santi is the historic producer",
            "confidence": 0.90,
        }
    ],
    "region": [
        {
            "value": "Tuscany",
            "source_url": "https://www.wine-searcher.com/find/biondi+santi",
            "snippet_used": "estate located in Montalcino, Tuscany, Italy",
            "confidence": 0.85,
        }
    ],
    "country": [
        {
            "value": "Italy",
            "source_url": "https://www.consorziobrunellomontalcino.it/en/the-brunello/",
            "snippet_used": "Montalcino municipality, Tuscany, Italy",
            "confidence": 0.90,
        }
    ],
    "grape_variety": [
        {
            "value": "Sangiovese",
            "source_url": "https://www.consorziobrunellomontalcino.it/en/the-brunello/",
            "snippet_used": "produced exclusively from Sangiovese Grosso",
            "confidence": 0.90,
        }
    ],
}


def _mock_layer1_inference(fc, wine_name, producer=None, vintage=None):
    """Mock Layer 1: fill country and region deterministically from 'ontology'."""
    fills = {}
    if not fc.get("country"):
        fills["country"] = {
            "value": "Italy", "confidence": 0.99, "source": "ontology_inference"
        }
    if not fc.get("region"):
        fills["region"] = {
            "value": "Tuscany", "confidence": 0.99, "source": "ontology_inference"
        }
    return fills


async def _mock_extract_candidates(
    field_name: str,
    wine_name: str,
    vintage,
    snippets: list,
    spend_logger,
    model_tier: str = "flash",
) -> list[dict]:
    """Return pre-defined candidates for known target fields; [] for all others."""
    return _MOCK_CANDIDATES.get(field_name, [])


async def _mock_fetch_verify(
    proposed_value: str,
    source_url: str,
    source_tier: str,
    field_name: str,
    supabase,
) -> bool:
    """Fetch-verify always passes in tests — no live HTTP calls."""
    return True


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def research_submission():
    """
    Create a test submission with 5 NULL target fields, yield (submission_id, supabase),
    then always teardown (T-12-13: yield + finally cleanup to prevent DB pollution).

    Pre-fills 26 of 31 RESEARCH_ALL_FIELDS with confidence=0.95 so the agent
    only targets wine_name / producer / region / country / grape_variety.
    """
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
    if not supabase_url or not supabase_key:
        pytest.skip("SUPABASE_URL / SUPABASE_KEY not configured — E2E test skipped")

    from supabase import create_client

    sb = create_client(supabase_url, supabase_key)
    sid = str(uuid.uuid4())

    # Pre-fill all but 5 fields so only those 5 are targeted
    _null_fields = {"wine_name", "producer", "region", "country", "grape_variety"}
    pre_filled_fc = {
        f: {"value": "placeholder", "confidence": 0.95, "source": "visible"}
        for f in RESEARCH_ALL_FIELDS
        if f not in _null_fields
    }

    try:
        sb.table("master_wine_library_submissions").insert({
            "id": sid,
            "wine_name": "Brunello di Montalcino",
            "producer": "Biondi-Santi",
            "vintage": 2018,
            "field_confidence": pre_filled_fc,
            "last_research_run_at": None,
            "auto_blocked": False,
        }).execute()
    except Exception as exc:
        pytest.skip(f"Could not insert test submission: {exc}")

    yield sid, sb

    # Teardown: always run even on test failure (T-12-13)
    try:
        sb.table("evidence_citations").delete().eq("wine_id", sid).execute()
        sb.table("field_review_queue").delete().eq("submission_id", sid).execute()
        # Collect run_ids before deleting stats rows
        stats_resp = (
            sb.table("research_run_stats").select("run_id").eq("wine_id", sid).execute()
        )
        run_ids = [
            row.get("run_id")
            for row in (stats_resp.data or [])
            if row.get("run_id") and row["run_id"] != "unknown"
        ]
        sb.table("research_run_stats").delete().eq("wine_id", sid).execute()
        for rid in run_ids:
            try:
                sb.table("research_runs").delete().eq("id", rid).execute()
            except Exception:
                pass
        sb.table("master_wine_library_submissions").delete().eq("id", sid).execute()
    except Exception as cleanup_err:
        logger.warning("E2E test teardown failed (non-fatal): %s", cleanup_err)


# ---------------------------------------------------------------------------
# E2E test
# ---------------------------------------------------------------------------


@pytest.mark.e2e
def test_research_agent_fills_null_fields(research_submission):
    """
    RSCH-11 (updated for Phase 12.1 three-layer architecture):
    Wine record with 5 NULL fields → Layer 1 fills 2 deterministically →
    Layer 2/3 fills remaining ≥1 via mocked Serper+Gemini → metrics endpoint
    returns all 5 metric categories.

    Mocked I/O boundary:
      - jobs.research_tasks.serper_search         → MOCK_SERPER_RESULTS (2 results/query)
      - jobs.research_tasks._extract_field_candidates → _MOCK_CANDIDATES per field
      - jobs.research_tasks._fetch_verify_value   → always True
      - jobs.research_tasks.run_layer1_inference  → fills country + region (Layer 1)

    Real I/O:
      - Supabase reads: submission load, eligibility check, budget check
      - Supabase writes: research_runs, evidence_citations, field_confidence,
        research_run_stats, last_research_run_at
    """
    submission_id, sb = research_submission

    # Import the async implementation directly (equivalent to research_agent_task call)
    from jobs.research_tasks import _research_async

    # Run the agent with all HTTP calls mocked at the I/O boundary
    with (
        patch("jobs.research_tasks.serper_search", new=AsyncMock(return_value=MOCK_SERPER_RESULTS)),
        patch("jobs.research_tasks._extract_field_candidates", new=_mock_extract_candidates),
        patch("jobs.research_tasks._fetch_verify_value", new=_mock_fetch_verify),
        patch("jobs.research_tasks.run_layer1_inference", new=_mock_layer1_inference),
    ):
        asyncio.run(_research_async(submission_id, dry_run=False))

    # ------------------------------------------------------------------
    # Assertion 1: ≥3 evidence_citations rows with required fields
    # ------------------------------------------------------------------
    citations_resp = (
        sb.table("evidence_citations")
        .select("*")
        .eq("wine_id", submission_id)
        .execute()
    )
    rows = citations_resp.data or []
    assert len(rows) >= 3, (
        f"Expected ≥3 evidence_citation rows, got {len(rows)}"
    )
    for row in rows:
        assert row.get("source_url"), f"Citation row missing source_url: {row}"
        assert row.get("snippet"), f"Citation row missing snippet: {row}"
        assert row.get("retrieved_at"), f"Citation row missing retrieved_at: {row}"

    # ------------------------------------------------------------------
    # Assertion 2: field_confidence updated with ≥3 research-filled fields
    # ------------------------------------------------------------------
    sub_resp = (
        sb.table("master_wine_library_submissions")
        .select("field_confidence")
        .eq("id", submission_id)
        .maybe_single()
        .execute()
    )
    fc = (sub_resp.data or {}).get("field_confidence") or {}
    research_filled = [
        f for f, entry in fc.items()
        if entry.get("source") in ("research_agent", "ontology_inference")
        and entry.get("confidence", 0) > 0.5
    ]
    assert len(research_filled) >= 3, (
        f"Expected ≥3 research-agent-filled fields (confidence > 0.5), got: {research_filled}"
    )

    # ------------------------------------------------------------------
    # Assertion 3: null_rate_after < null_rate_before in research_run_stats
    # ------------------------------------------------------------------
    stats_resp = (
        sb.table("research_run_stats")
        .select("null_rate_before,null_rate_after")
        .eq("wine_id", submission_id)
        .execute()
    )
    stats_rows = stats_resp.data or []
    assert len(stats_rows) >= 1, "research_run_stats row missing — agent did not write stats"
    stat = stats_rows[0]
    assert stat["null_rate_after"] < stat["null_rate_before"], (
        f"null_rate not improved: before={stat['null_rate_before']}, "
        f"after={stat['null_rate_after']}"
    )

    # ------------------------------------------------------------------
    # Assertion 4: GET /api/v1/research/metrics returns all 5 categories
    # ------------------------------------------------------------------
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.research_routes import research_router

    # Create a minimal test app (avoids pulling in YOLO / all production routers)
    test_app = FastAPI()
    test_app.include_router(research_router)
    client = TestClient(test_app)

    response = client.get("/api/v1/research/metrics")
    assert response.status_code == 200, (
        f"Metrics endpoint returned {response.status_code}: {response.text}"
    )
    body = response.json()

    assert "gap_closure" in body, "Metrics missing 'gap_closure' category"
    assert "quality" in body, "Metrics missing 'quality' category"
    assert "evidence_hygiene" in body, "Metrics missing 'evidence_hygiene' category"
    assert "throughput_cost" in body, "Metrics missing 'throughput_cost' category"
    assert "safety" in body, "Metrics missing 'safety' category"

    # After our test run, at least one citation exists → citation_completeness > 0
    assert body["evidence_hygiene"]["citation_completeness"] > 0, (
        "citation_completeness should be > 0 after evidence_citations were written"
    )
