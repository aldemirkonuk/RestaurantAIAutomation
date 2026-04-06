"""
Tests for analytics_routes.py (CRIT-07)
Covers: GET /api/v1/analytics/wine/{id}/scores
  - 200 with full data
  - 404 for unknown wine
  - 200 with null fields when scores not yet populated
  - 422 for invalid UUID format
  - 200 with empty per_restaurant_markup when wine not in any inventory
"""

import pytest
import httpx
from unittest.mock import patch, MagicMock

from main import app

VALID_UUID = "12345678-1234-5678-1234-567812345678"
UNKNOWN_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _make_supabase_mock(wine_data=None, inventory_data=None):
    """Create a mock Supabase client that returns provided data."""
    mock = MagicMock()

    wine_resp = MagicMock()
    wine_resp.data = wine_data

    inv_resp = MagicMock()
    inv_resp.data = inventory_data or []

    def table_side_effect(table_name):
        mock_table = MagicMock()
        if table_name == "master_wine_library":
            mock_table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = wine_resp
        elif table_name == "restaurant_inventory":
            mock_table.select.return_value.eq.return_value.execute.return_value = inv_resp
        return mock_table

    mock.table.side_effect = table_side_effect
    return mock


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class TestGetWineScores:

    async def test_returns_200_with_critic_scores(self, client):
        """CRIT-07: 200 with full critic_scores and markup data."""
        wine_data = {
            "id": VALID_UUID,
            "name": "Barolo Riserva",
            "critic_scores": {
                "wine_advocate": {"raw_score": 93, "normalized_score": 93.0},
                "composite": 91.5,
            },
            "retail_price_avg": 45.99,
            "scores_last_updated_at": "2026-04-06T03:00:00+00:00",
        }
        inventory_data = [
            {"restaurant_id": "rest-uuid-1", "markup_ratio": 2.4, "markup_classification": "standard"}
        ]

        mock_supabase = _make_supabase_mock(wine_data, inventory_data)

        with patch("api.analytics_routes._get_supabase", return_value=mock_supabase):
            resp = await client.get(f"/api/v1/analytics/wine/{VALID_UUID}/scores")

        assert resp.status_code == 200
        data = resp.json()
        assert data["wine_id"] == VALID_UUID
        assert data["wine_name"] == "Barolo Riserva"
        assert data["critic_scores"] is not None
        assert data["retail_price_avg"] == pytest.approx(45.99)
        assert len(data["per_restaurant_markup"]) == 1
        assert data["per_restaurant_markup"][0]["markup_ratio"] == pytest.approx(2.4)
        assert data["per_restaurant_markup"][0]["markup_classification"] == "standard"

    async def test_returns_404_for_unknown_wine(self, client):
        """CRIT-07: 404 when wine_id not in master_wine_library."""
        mock_supabase = _make_supabase_mock(wine_data=None)

        with patch("api.analytics_routes._get_supabase", return_value=mock_supabase):
            resp = await client.get(f"/api/v1/analytics/wine/{UNKNOWN_UUID}/scores")

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    async def test_returns_200_with_null_fields_when_not_yet_scored(self, client):
        """CRIT-07: 200 with null critic_scores/retail_price_avg when not yet populated."""
        wine_data = {
            "id": VALID_UUID,
            "name": "Mystery Wine",
            "critic_scores": {},   # empty — not yet scored
            "retail_price_avg": None,
            "scores_last_updated_at": None,
        }

        mock_supabase = _make_supabase_mock(wine_data, [])

        with patch("api.analytics_routes._get_supabase", return_value=mock_supabase):
            resp = await client.get(f"/api/v1/analytics/wine/{VALID_UUID}/scores")

        assert resp.status_code == 200
        data = resp.json()
        assert data["wine_id"] == VALID_UUID
        assert data["critic_scores"] is None  # empty dict → None in response
        assert data["retail_price_avg"] is None
        assert data["per_restaurant_markup"] == []

    async def test_returns_422_for_invalid_uuid(self, client):
        """V5 Input Validation: non-UUID path param returns 422."""
        with patch("api.analytics_routes._get_supabase", return_value=MagicMock()):
            resp = await client.get("/api/v1/analytics/wine/not-a-valid-uuid/scores")

        assert resp.status_code == 422

    async def test_returns_200_with_empty_markup_list(self, client):
        """Wine exists but not in any restaurant inventory yet → empty per_restaurant_markup."""
        wine_data = {
            "id": VALID_UUID,
            "name": "Wine Not On Any Menu",
            "critic_scores": {"wine_advocate": {"normalized_score": 90.0}},
            "retail_price_avg": 25.00,
            "scores_last_updated_at": None,
        }

        mock_supabase = _make_supabase_mock(wine_data, [])

        with patch("api.analytics_routes._get_supabase", return_value=mock_supabase):
            resp = await client.get(f"/api/v1/analytics/wine/{VALID_UUID}/scores")

        assert resp.status_code == 200
        data = resp.json()
        assert data["per_restaurant_markup"] == []
