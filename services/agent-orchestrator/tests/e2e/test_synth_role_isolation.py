"""D-17 staff JWT must not access manager-gated Nest team routes.

Marked ``prod_e2e``. Requires SIM_* + Supabase + API gateway secrets.
Never logs JWT / passwords.
"""

from __future__ import annotations

import os

import httpx
import pytest

from scripts.synth.ids import sim_restaurant_id

pytestmark = pytest.mark.prod_e2e

_REQUIRED = (
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SIM_STAFF_EMAIL",
    "SIM_STAFF_PASSWORD",
    "SIM_MANAGER_EMAIL",
    "SIM_MANAGER_PASSWORD",
)


def _missing_secrets() -> list[str]:
    missing = [k for k in _REQUIRED if not os.environ.get(k)]
    # Gateway URL: API_GATEWAY_URL or VITE_API_GATEWAY_URL
    if not (
        os.environ.get("API_GATEWAY_URL") or os.environ.get("VITE_API_GATEWAY_URL")
    ):
        missing.append("API_GATEWAY_URL|VITE_API_GATEWAY_URL")
    return missing


async def _password_grant(email: str, password: str) -> str:
    """Return access_token — never log the token."""
    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    anon_key = os.environ["SUPABASE_ANON_KEY"]
    url = f"{supabase_url}/auth/v1/token?grant_type=password"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={"email": email, "password": password},
            headers={
                "apikey": anon_key,
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )
    if resp.status_code >= 400:
        pytest.fail(
            f"password grant failed status={resp.status_code} for role email domain "
            f"(redacted) — check SIM_* credentials"
        )
    token = resp.json().get("access_token")
    if not token:
        pytest.fail("password grant response missing access_token")
    return token


def _gateway_base() -> str:
    return (
        os.environ.get("API_GATEWAY_URL")
        or os.environ.get("VITE_API_GATEWAY_URL")
        or ""
    ).rstrip("/")


@pytest.mark.prod_e2e
@pytest.mark.asyncio
async def test_staff_jwt_cannot_access_manager_path():
    missing = _missing_secrets()
    if missing:
        pytest.skip(
            "Role isolation secrets absent — skip (not pass). Missing: "
            + ", ".join(missing)
        )

    restaurant_id = sim_restaurant_id("bistro")
    path = f"/restaurants/{restaurant_id}/team/members"
    base = _gateway_base()

    staff_token = await _password_grant(
        os.environ["SIM_STAFF_EMAIL"],
        os.environ["SIM_STAFF_PASSWORD"],
    )
    manager_token = await _password_grant(
        os.environ["SIM_MANAGER_EMAIL"],
        os.environ["SIM_MANAGER_PASSWORD"],
    )

    async with httpx.AsyncClient(base_url=base, timeout=30.0) as client:
        staff_resp = await client.get(
            path,
            headers={"Authorization": f"Bearer {staff_token}"},
        )
        manager_resp = await client.get(
            path,
            headers={"Authorization": f"Bearer {manager_token}"},
        )

    assert staff_resp.status_code == 403, (
        f"staff JWT must get 403 on manager-gated listMembers; "
        f"got {staff_resp.status_code}"
    )
    assert manager_resp.status_code != 403, (
        f"manager JWT must not be blocked the same way as staff; "
        f"got {manager_resp.status_code}"
    )
