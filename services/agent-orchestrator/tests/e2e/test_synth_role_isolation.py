"""Wave 3 — D-17 staff JWT must not access manager routes (implemented in 37-03).

Requires SIM_* + Supabase secrets; marked prod_e2e.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.prod_e2e


@pytest.mark.prod_e2e
def test_staff_jwt_cannot_access_manager_path():
    pytest.skip("Wave 3 — implemented in 37-03")
