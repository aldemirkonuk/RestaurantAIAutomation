"""
Tests for temporal analytics endpoints (Phase 11 TEMP-07, TEMP-08)
Covers:
  - GET /api/v1/analytics/trends (TEMP-07)
      - 200 with valid period
      - 400 for invalid period
      - metro param passes through
      - response schema has all required fields including breakdown lists
      - category_shifts / grape_trends / region_shifts aggregation structure
  - GET /api/v1/analytics/wine/{id}/timeline (TEMP-08)
      - 200 with valid wine UUID
      - 404 for unknown wine
      - 422 for non-UUID wine_id
      - wine_name populated from master_wine_library

Note: uses httpx.AsyncClient + ASGITransport (starlette 0.35/httpx 0.28 compatibility).
"""

import pytest
import httpx
from unittest.mock import MagicMock, patch
from fastapi import FastAPI

from api.analytics_routes import router

_app = FastAPI()
_app.include_router(router)

VALID_WINE_ID = "550e8400-e29b-41d4-a716-446655440000"
UNKNOWN_WINE_ID = "550e8400-e29b-41d4-a716-446655440001"


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ---------------------------------------------------------------------------
# GET /api/v1/analytics/trends — TEMP-07
# ---------------------------------------------------------------------------

async def test_trends_returns_200_with_valid_period(client):
    """TEMP-07: GET /trends returns 200 with trending_up / trending_down / breakdown lists."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []
    with patch("api.analytics_routes._get_supabase", return_value=mock_sb):
        response = await client.get("/api/v1/analytics/trends?period=30d")
    assert response.status_code == 200
    data = response.json()
    assert "trending_up" in data
    assert "trending_down" in data
    assert data["period"] == "30d"


async def test_trends_invalid_period_returns_400(client):
    """TEMP-07: invalid period returns 400 with descriptive detail."""
    response = await client.get("/api/v1/analytics/trends?period=7d")
    assert response.status_code == 400
    assert "period must be one of" in response.json()["detail"]


async def test_trends_invalid_period_14d_returns_400(client):
    """TEMP-07: another invalid period variant also returns 400."""
    response = await client.get("/api/v1/analytics/trends?period=14d")
    assert response.status_code == 400


async def test_trends_with_metro_param_returns_200(client):
    """TEMP-07: metro param is accepted; metro=chicago with no restaurants returns empty lists."""
    mock_sb = MagicMock()
    # restaurant_directory ILIKE returns no metro restaurants
    mock_sb.table.return_value.select.return_value.ilike.return_value.execute.return_value.data = []
    # trending_wines query returns empty
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []
    with patch("api.analytics_routes._get_supabase", return_value=mock_sb):
        response = await client.get("/api/v1/analytics/trends?metro=chicago&period=90d")
    assert response.status_code == 200
    data = response.json()
    assert data["metro"] == "chicago"
    assert data["period"] == "90d"


async def test_trends_response_has_all_schema_fields(client):
    """TEMP-07: TrendsResponse contains all required top-level fields."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
        {
            "wine_id": VALID_WINE_ID,
            "trend_score": 15.5,
            "delta": 3,
            "restaurant_count_end": 8,
            "burst_detected_at": None,
        }
    ]
    mock_sb.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [
        {
            "id": VALID_WINE_ID,
            "name": "Barolo Riserva",
            "primary_type": "Red",
            "grape_variety": "Nebbiolo",
            "region": "Piedmont",
        }
    ]
    with patch("api.analytics_routes._get_supabase", return_value=mock_sb):
        response = await client.get("/api/v1/analytics/trends?period=30d")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["trending_up"], list)
    assert isinstance(data["trending_down"], list)
    assert isinstance(data["category_shifts"], list)
    assert isinstance(data["grape_trends"], list)
    assert isinstance(data["region_shifts"], list)


async def test_trends_breakdown_fields_structure(client):
    """TEMP-07: category_shifts / grape_trends / region_shifts each have name/additions/removals/net_delta."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
        {
            "wine_id": VALID_WINE_ID,
            "trend_score": 10.0,
            "delta": 2,
            "restaurant_count_end": 3,
            "burst_detected_at": None,
        }
    ]
    mock_sb.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [
        {
            "id": VALID_WINE_ID,
            "name": "Chablis",
            "primary_type": "White",
            "grape_variety": "Chardonnay",
            "region": "Burgundy",
        }
    ]
    with patch("api.analytics_routes._get_supabase", return_value=mock_sb):
        response = await client.get("/api/v1/analytics/trends?period=90d")
    assert response.status_code == 200
    data = response.json()
    for field in ["category_shifts", "grape_trends", "region_shifts"]:
        assert len(data[field]) > 0, f"{field} should have at least one entry"
        item = data[field][0]
        assert "name" in item
        assert "additions" in item
        assert "removals" in item
        assert "net_delta" in item
        assert item["net_delta"] == item["additions"] - item["removals"]


async def test_trends_default_period_is_90d(client):
    """TEMP-07: omitting period param defaults to 90d — not a 400."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []
    with patch("api.analytics_routes._get_supabase", return_value=mock_sb):
        response = await client.get("/api/v1/analytics/trends")
    assert response.status_code == 200
    assert response.json()["period"] == "90d"


# ---------------------------------------------------------------------------
# GET /api/v1/analytics/wine/{id}/timeline — TEMP-08
# ---------------------------------------------------------------------------

async def test_timeline_returns_200_for_valid_wine(client):
    """TEMP-08: GET /wine/{id}/timeline returns 200 with wine_id and wine_name populated."""
    mock_sb = MagicMock()

    def table_side(name):
        m = MagicMock()
        if name == "master_wine_library":
            m.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
                "id": VALID_WINE_ID,
                "name": "Barolo Riserva",
            }
        elif name == "master_wine_library_submissions":
            m.select.return_value.eq.return_value.execute.return_value.data = []
        elif name == "wine_popularity":
            m.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
        elif name == "restaurant_wine_roster":
            m.select.return_value.in_.return_value.execute.return_value.data = []
        elif name == "menu_changes":
            m.select.return_value.in_.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        return m

    mock_sb.table.side_effect = table_side
    with patch("api.analytics_routes._get_supabase", return_value=mock_sb):
        response = await client.get(f"/api/v1/analytics/wine/{VALID_WINE_ID}/timeline")
    assert response.status_code == 200
    data = response.json()
    assert data["wine_id"] == VALID_WINE_ID
    assert data["wine_name"] == "Barolo Riserva"
    assert "restaurants_currently_carrying" in data
    assert "price_history" in data
    assert "menu_changes" in data


async def test_timeline_returns_404_for_unknown_wine(client):
    """TEMP-08: GET /wine/{id}/timeline returns 404 when wine not in master_wine_library."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
    with patch("api.analytics_routes._get_supabase", return_value=mock_sb):
        response = await client.get(f"/api/v1/analytics/wine/{UNKNOWN_WINE_ID}/timeline")
    assert response.status_code == 404


async def test_timeline_returns_422_for_non_uuid(client):
    """V5 Input Validation: non-UUID wine_id path param returns 422."""
    response = await client.get("/api/v1/analytics/wine/not-a-uuid/timeline")
    assert response.status_code == 422
    assert "must be a UUID" in response.json()["detail"]


async def test_timeline_returns_422_for_short_string(client):
    """V5 Input Validation: partial UUID-like string returns 422."""
    response = await client.get("/api/v1/analytics/wine/12345/timeline")
    assert response.status_code == 422
