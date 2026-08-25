"""
Supabase Client Wiring
======================
Seventeen call sites did `from core.database import get_supabase_client`,
but that module never defined the name — every one raised ImportError.
Each import sat inside a swallowing `except Exception`, so `supabase` was
silently left as None: the eight admin review endpoints returned a blanket
503, Tier-2 wines were never queued to enrichment_queue, and researched
wines were never written to master_wine_library_submissions.

Covers the behaviour of the now-real accessor, plus a static check that no
dead `get_supabase_client` import creeps back in.
"""

from unittest.mock import patch

import pytest

import core.database as core_db
from import_scan_util import unresolved_first_party_imports

# NOTE: `get_supabase_client` is imported inside each test rather than at module
# scope on purpose. When the symbol is missing, a module-level import fails at
# collection and takes the static check below down with it — exactly when its
# report of which call sites are dead is most useful.


@pytest.fixture(autouse=True)
def reset_db_singleton():
    """The facade is a module-level singleton; isolate each test from it."""
    original = core_db._db_client_instance
    core_db._db_client_instance = None
    yield
    core_db._db_client_instance = original


# =============================================================================
# BEHAVIOUR
# =============================================================================


def test_returns_none_when_nothing_is_configured():
    """No database is a legitimate state — None, not an exception."""
    from core.database import get_supabase_client

    with patch("config.settings.get_settings") as mock_settings:
        mock_settings.return_value.supabase_client = None
        assert get_supabase_client() is None


def test_prefers_the_connected_facade():
    """Callers should share the client the repositories already use."""
    from core.database import get_supabase_client

    class _Facade:
        supabase = object()

    facade = _Facade()
    core_db._db_client_instance = facade

    assert get_supabase_client() is facade.supabase


def test_falls_back_to_settings_when_facade_is_unconnected():
    """A facade that exists but never connected must not shadow settings."""
    from core.database import get_supabase_client

    class _Unconnected:
        supabase = None

    core_db._db_client_instance = _Unconnected()
    sentinel = object()

    with patch("config.settings.get_settings") as mock_settings:
        mock_settings.return_value.supabase_client = sentinel
        assert get_supabase_client() is sentinel


def test_settings_failure_degrades_to_none_rather_than_raising():
    from core.database import get_supabase_client

    with patch("config.settings.get_settings", side_effect=RuntimeError("boom")):
        assert get_supabase_client() is None


# =============================================================================
# STATIC RESOLUTION
# =============================================================================


def test_accessor_resolves_at_every_call_site():
    """The regression itself: the name every call site imports must exist."""
    offenders = {
        u for u in unresolved_first_party_imports() if u[2] == "get_supabase_client"
    }
    assert not offenders, f"dead get_supabase_client imports: {sorted(offenders)}"
