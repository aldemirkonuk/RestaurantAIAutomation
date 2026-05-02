"""
E2E conftest — auto-loaded by pytest for tests/e2e/ subtree.

Registers the E2EReportGenerator plugin and re-exports all shared
fixtures from conftest_e2e.py so test files can use them without
explicit imports.
"""

import sys
import os

# Ensure the agent-orchestrator root and tests/ are on sys.path so that
# both `import main` and `from e2e.xyz import ...` work during collection.
_AGENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
_TESTS_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../"))
for _p in [_AGENT_ROOT, _TESTS_ROOT]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

import pytest
from e2e.report_generator import E2EReportGenerator

# Re-export all fixtures from conftest_e2e so pytest discovers them
from e2e.conftest_e2e import (  # noqa: F401
    jwt_factory,
    e2e_settings,
    mock_supabase_tables,
    mock_extraction_result,
    E2E_JWT_SECRET,
    DEVELOPER_JWT_PAYLOAD,
    ADMIN_JWT_PAYLOAD,
    CONTRIBUTOR_JWT_PAYLOAD,
)


def pytest_configure(config):
    """Register E2EReportGenerator plugin once per session."""
    if not config.pluginmanager.get_plugin("e2e_report_generator"):
        config.pluginmanager.register(E2EReportGenerator(), "e2e_report_generator")


# Re-export production fixtures from conftest_prod so wave test files can use them.
# conftest_prod.py is NOT auto-loaded by pytest (not named conftest.py).
# This import registers all prod_ fixtures and pytest hooks with the session.
from e2e.conftest_prod import (  # noqa: F401
    prod_base_url,
    prod_frontend_url,
    prod_jwt,
    prod_admin_headers,
    prod_supabase,
    e2e_created_ids,
    teardown_e2e_records,
    # get_with_retry and post_with_retry are helpers, not pytest fixtures;
    # wave files import them directly: from e2e.conftest_prod import get_with_retry
)
# Import conftest_prod module-level code (Sentry init + pytest_runtest_logreport hook)
import e2e.conftest_prod  # noqa: F401
