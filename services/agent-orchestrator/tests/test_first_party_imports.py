"""
First-Party Import Resolution
=============================
General guard for a bug class that hides at runtime: a module imports a
name its target never defined, the ImportError is caught by a broad
`except Exception`, and the code silently takes a degraded path forever.

Two instances shipped in this service before this check existed —
`core.database.get_supabase_client` (17 call sites, all swallowed) and
`services.training_data_store.get_training_store` (dropped every VLM
extraction's training pair). Both logged something that read like an
absent optional dependency.

This asserts every first-party `from X import Y` in the service actually
resolves, so the next one fails a test instead of a silent degrade.
"""

from import_scan_util import unresolved_first_party_imports

# Known-dead imports that predate this check and are tracked separately.
# api/templates_routes.py is orphaned — it is not registered in main.py — and
# `get_db_connection` would need a new async accessor designed for it.
# Entries here are debt, not exemptions: delete the entry when the site is fixed.
KNOWN_UNRESOLVED = {
    ("api/templates_routes.py", "core.database", "get_db_connection"),
}


def test_no_new_unresolvable_first_party_imports():
    """A `from X import Y` that cannot resolve is a wiring bug, not a warning."""
    new = unresolved_first_party_imports() - KNOWN_UNRESOLVED
    assert not new, (
        "unresolvable first-party imports (these raise ImportError at the "
        f"call site): {sorted(new)}"
    )


def test_known_unresolved_allowlist_is_not_stale():
    """Delete allowlist entries once fixed, so the list stays honest."""
    stale = KNOWN_UNRESOLVED - unresolved_first_party_imports()
    assert not stale, f"fixed — remove from KNOWN_UNRESOLVED: {sorted(stale)}"
