"""
Unit tests for MenuDiffService — Phase 11 TEMP-03 / TEMP-04

RED phase: written before menu_diff_service.py exists.
All tests will fail with ImportError until the service is implemented (GREEN).
"""
import pytest
from unittest.mock import MagicMock, call

from services.menu_diff_service import MenuDiffService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_mock_supabase(roster_rows=None):
    """Return a mock supabase client pre-wired with roster_rows for SELECT."""
    mock_supabase = MagicMock()
    # SELECT path: table(...).select(...).eq(...).execute().data
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = (
        roster_rows or []
    )
    # INSERT path: table(...).insert(...).execute()
    mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
    # UPSERT path: table(...).upsert(...).execute()
    mock_supabase.table.return_value.upsert.return_value.execute.return_value = MagicMock()
    return mock_supabase


def _wine(hash_="h1", name="Barolo", producer="Marchesi", vintage=2019, price=45.0):
    """Build a minimal wine dict matching the crawler output shape."""
    return {
        "signature_hash": hash_,
        "wine_name": name,
        "producer": producer,
        "vintage": vintage,
        "price_reference": price,
        "region": "Piedmont",
    }


def _roster_row(hash_="h1", name="Barolo", price=45.0):
    """Build a minimal roster row (as returned by Supabase SELECT)."""
    return {
        "signature_hash": hash_,
        "wine_name": name,
        "price_reference": price,
        "first_seen_at": "2026-01-01T00:00:00+00:00",
        "last_seen_at": "2026-01-01T00:00:00+00:00",
    }


# ---------------------------------------------------------------------------
# 1. Empty crawl guard
# ---------------------------------------------------------------------------

def test_empty_crawl_skipped():
    """run_diff([]) must return skipped=True with reason='empty_crawl' — never mass-remove."""
    mock_sb = make_mock_supabase(roster_rows=[_roster_row()])
    svc = MenuDiffService(mock_sb)

    result = svc.run_diff("rest-001", [])

    assert result["skipped"] is True
    assert result["reason"] == "empty_crawl"
    assert result["added"] == 0
    assert result["removed"] == 0
    assert result["price_changed"] == 0
    # No Supabase writes should happen
    mock_sb.table.return_value.insert.assert_not_called()
    mock_sb.table.return_value.upsert.assert_not_called()


# ---------------------------------------------------------------------------
# 2. Added wine
# ---------------------------------------------------------------------------

def test_added_wine():
    """Empty roster + 1 new wine → 1 'added' event, roster upserted."""
    mock_sb = make_mock_supabase(roster_rows=[])
    svc = MenuDiffService(mock_sb)

    result = svc.run_diff("rest-001", [_wine()])

    assert result["added"] == 1
    assert result["removed"] == 0
    assert result["price_changed"] == 0
    assert result["skipped"] is False
    # insert must be called (for menu_changes)
    mock_sb.table.return_value.insert.assert_called_once()
    # upsert must be called (for restaurant_wine_roster)
    mock_sb.table.return_value.upsert.assert_called_once()


# ---------------------------------------------------------------------------
# 3. Removed wine
# ---------------------------------------------------------------------------

def test_removed_wine():
    """Roster has 2 wines, new crawl has only 1 → 1 'removed' event."""
    mock_sb = make_mock_supabase(roster_rows=[
        _roster_row("h1", "Barolo", 45.0),
        _roster_row("h2", "Brunello", 75.0),
    ])
    svc = MenuDiffService(mock_sb)

    # Only h1 present in new crawl — h2 is gone
    result = svc.run_diff("rest-001", [_wine("h1")])

    assert result["removed"] == 1
    assert result["added"] == 0
    assert result["skipped"] is False

    # Check the insert call contained a "removed" event
    insert_call_args = mock_sb.table.return_value.insert.call_args[0][0]
    removed_events = [e for e in insert_call_args if e["change_type"] == "removed"]
    assert len(removed_events) == 1
    assert removed_events[0]["old_value"] is not None
    assert removed_events[0]["new_value"] is None


# ---------------------------------------------------------------------------
# 4. Price change detected
# ---------------------------------------------------------------------------

def test_price_change_detected():
    """Same signature_hash, price 45→52 → 1 'price_change' event with both snapshots."""
    mock_sb = make_mock_supabase(roster_rows=[_roster_row("h1", price=45.0)])
    svc = MenuDiffService(mock_sb)

    result = svc.run_diff("rest-001", [_wine("h1", price=52.0)])

    assert result["price_changed"] == 1
    assert result["added"] == 0
    assert result["removed"] == 0
    assert result["skipped"] is False

    insert_call_args = mock_sb.table.return_value.insert.call_args[0][0]
    pc_events = [e for e in insert_call_args if e["change_type"] == "price_change"]
    assert len(pc_events) == 1
    assert pc_events[0]["old_value"]["price_reference"] == 45.0
    assert pc_events[0]["new_value"]["price_reference"] == 52.0


# ---------------------------------------------------------------------------
# 5–7. Price gate unit tests (static method, no Supabase needed)
# ---------------------------------------------------------------------------

def test_price_gate_passes_combined_gate():
    """abs=7, rel=15.6% — both thresholds met → True."""
    assert MenuDiffService._price_gate(
        {"price_reference": 52.0}, {"price_reference": 45.0}
    ) is True


def test_price_gate_fails_absolute():
    """abs=0.50 < $1 threshold → False even if rel >= 3%."""
    assert MenuDiffService._price_gate(
        {"price_reference": 45.50}, {"price_reference": 45.0}
    ) is False


def test_price_gate_fails_relative():
    """abs=1.0 >= $1 BUT rel=1% < 3% → False."""
    assert MenuDiffService._price_gate(
        {"price_reference": 101.0}, {"price_reference": 100.0}
    ) is False


def test_price_gate_null_new_price():
    """new_wine has price_reference=None → False (null guard)."""
    assert MenuDiffService._price_gate(
        {"price_reference": None}, {"price_reference": 45.0}
    ) is False


# ---------------------------------------------------------------------------
# 8. First crawl — all wines added (empty roster)
# ---------------------------------------------------------------------------

def test_first_crawl_all_added():
    """Empty roster + 5 new wines → 5 'added' events (first crawl behavior, intentional)."""
    mock_sb = make_mock_supabase(roster_rows=[])
    svc = MenuDiffService(mock_sb)

    wines = [_wine(f"h{i}", f"Wine {i}") for i in range(5)]
    result = svc.run_diff("rest-001", wines)

    assert result["added"] == 5
    assert result["removed"] == 0
    assert result["price_changed"] == 0
    assert result["skipped"] is False

    insert_call_args = mock_sb.table.return_value.insert.call_args[0][0]
    added_events = [e for e in insert_call_args if e["change_type"] == "added"]
    assert len(added_events) == 5


# ---------------------------------------------------------------------------
# 9. JSONB snapshot shape (D-03 verification)
# ---------------------------------------------------------------------------

def test_change_event_jsonb_shape():
    """'added' event: old_value=None, new_value has all 5 required snapshot fields."""
    mock_sb = make_mock_supabase(roster_rows=[])
    svc = MenuDiffService(mock_sb)

    new_wine = {
        "signature_hash": "abc123",
        "wine_name": "Barolo Riserva",
        "producer": "Marchesi di Barolo",
        "vintage": 2019,
        "price_reference": 95.0,
        "region": "Piedmont",
    }
    result = svc.run_diff("rest-001", [new_wine])
    assert result["added"] == 1
    assert result["skipped"] is False

    insert_call_args = mock_sb.table.return_value.insert.call_args[0][0]
    assert len(insert_call_args) == 1
    event = insert_call_args[0]

    assert event["change_type"] == "added"
    assert event["old_value"] is None

    snapshot = event["new_value"]
    assert snapshot is not None
    # D-03: all 5 required snapshot fields must be present
    for field in ("wine_name", "producer", "vintage", "price_reference", "signature_hash"):
        assert field in snapshot, f"Missing snapshot field: {field}"
    assert snapshot["wine_name"] == "Barolo Riserva"
    assert snapshot["producer"] == "Marchesi di Barolo"
    assert snapshot["vintage"] == 2019
    assert snapshot["price_reference"] == 95.0
    assert snapshot["signature_hash"] == "abc123"


# ---------------------------------------------------------------------------
# 10. No-change crawl — no events written when nothing changed
# ---------------------------------------------------------------------------

def test_no_events_when_no_changes():
    """Roster matches new crawl exactly (same hash, same price) → 0 events, still upserts roster."""
    mock_sb = make_mock_supabase(roster_rows=[_roster_row("h1", price=45.0)])
    svc = MenuDiffService(mock_sb)

    result = svc.run_diff("rest-001", [_wine("h1", price=45.0)])

    assert result["added"] == 0
    assert result["removed"] == 0
    assert result["price_changed"] == 0
    assert result["skipped"] is False
    # No insert for menu_changes since no events
    mock_sb.table.return_value.insert.assert_not_called()
    # Upsert still happens to refresh last_seen_at
    mock_sb.table.return_value.upsert.assert_called_once()
