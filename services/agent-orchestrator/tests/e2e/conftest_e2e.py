"""
E2E Shared Fixtures
====================
Reusable pytest fixtures for all E2E tests in this package.

Design principles:
- All mocks; zero live Supabase/Anthropic dependency (D-02).
- JWT factory uses "e2e-secret" — never production JWT secret (T-14-02).
- Report hook registered via report_generator plugin (D-04).
"""

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

# ---------------------------------------------------------------------------
# JWT constants — test-only credentials (T-14-02: never production secrets)
# ---------------------------------------------------------------------------
E2E_JWT_SECRET = "e2e-secret"

DEVELOPER_JWT_PAYLOAD: Dict[str, Any] = {
    "sub": "dev-e2e-001",
    "email": "developer@e2e-test.com",
    "app_metadata": {"roles": ["developer"]},
}

ADMIN_JWT_PAYLOAD: Dict[str, Any] = {
    "sub": "admin-e2e-001",
    "email": "admin@e2e-test.com",
    "app_metadata": {"roles": ["review_admin"]},
}

CONTRIBUTOR_JWT_PAYLOAD: Dict[str, Any] = {
    "sub": "contributor-e2e-001",
    "email": "contributor@e2e-test.com",
    "app_metadata": {"roles": ["contributor"]},
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def jwt_factory():
    """
    Return a factory function make_jwt(payload, secret) → encoded JWT string.

    Pre-built payloads are available as module-level constants:
        DEVELOPER_JWT_PAYLOAD, ADMIN_JWT_PAYLOAD, CONTRIBUTOR_JWT_PAYLOAD
    """

    def make_jwt(payload: Dict[str, Any], secret: str = E2E_JWT_SECRET) -> str:
        import jwt as pyjwt

        return pyjwt.encode(payload, secret, algorithm="HS256")

    return make_jwt


@pytest.fixture
def e2e_settings():
    """
    Mock settings object with all required attributes set to safe test values.
    Patches config.settings.get_settings with this object.
    """
    settings = type(
        "E2ESettings",
        (),
        {
            "supabase_jwt_secret": E2E_JWT_SECRET,
            "supabase_url": "https://fake.supabase.co",
            "supabase_key": "fake-supabase-key",
            "trust_level_threshold": 5,
            "manager_email": "manager@e2e-test.com",
            "gmail_user": "smtp@e2e-test.com",
            "gmail_password": "e2e-smtp-password",
        },
    )()
    return settings


@pytest.fixture
def mock_supabase_tables():
    """
    Factory fixture: call with a dict of {table_name: MagicMock} and receive a
    configured Supabase MagicMock whose .table(name) dispatches to the right mock.

    Usage::

        def test_foo(mock_supabase_tables):
            submissions = MagicMock()
            submissions.insert.return_value.execute.return_value.data = [{"id": "s1"}]
            supabase = mock_supabase_tables({"master_wine_library_submissions": submissions})

    Any table name not in the mapping returns a plain MagicMock().
    """

    def _factory(table_map: Dict[str, MagicMock]) -> MagicMock:
        client = MagicMock()

        def _table_side_effect(name: str) -> MagicMock:
            return table_map.get(name, MagicMock())

        client.table.side_effect = _table_side_effect
        return client

    return _factory


@pytest.fixture
def mock_extraction_result():
    """
    Mock ClaudeExtractionResult with 3 wines, each having field_confidence JSONB.

    Confidence distribution:
      - wine_name:  0.95 (accepted — above 0.80)
      - vintage:    0.88 (accepted — above 0.80)
      - region:     0.65 (review queue — 0.50–0.80)
      - country:    0.45 (rejected — below 0.50)
    """
    import uuid

    wines = []
    for i in range(3):
        wine = {
            "wine_name": f"Barolo Riserva {i + 1}",
            "producer": "Giacomo Conterno",
            "vintage": 2019,
            "region": "Piedmont",
            "country": None,  # rejected field — omitted from accepted_fields
            "grape_variety": "Nebbiolo",
            "field_confidence": {
                "wine_name": {
                    "value": f"Barolo Riserva {i + 1}",
                    "confidence": 0.95,
                    "source": "visible",
                },
                "vintage": {
                    "value": "2019",
                    "confidence": 0.88,
                    "source": "visible",
                },
                "region": {
                    "value": "Piedmont",
                    "confidence": 0.65,
                    "source": "inferred",
                },
                "country": {
                    "value": None,
                    "confidence": 0.45,
                    "source": "inferred",
                },
            },
            "completeness_score": 0.75,
            "needs_review": True,
        }
        wines.append(wine)

    result = MagicMock()
    result.wines = wines
    result.total_wines = len(wines)
    result.total_cost_usd = 0.009
    result.scan_session_id = str(uuid.uuid4())
    result.pages_processed = 1
    result.needs_review_count = 3
    result.page_errors = []
    return result
