"""Wave H fixtures — the NestJS gateway, read-only (ADR 0135).

Deliberately its own directory with its own conftest: `tests/e2e/conftest.py`
registers a SESSION-SCOPED AUTOUSE teardown (`conftest_prod.teardown_e2e_records`)
that ends by calling `scripts.synth.teardown.teardown_sim(..., apply=True)` —
which resolves every restaurant whose slug starts with `sim-` and deletes it.
All four simulator houses in production carry such slugs. Nothing in this
directory may import that conftest, hold a service-role key, or write.

Environment (mapped from repository secrets by .github/workflows/e2e-prod.yml):
  API_GATEWAY_URL      the deployed gateway, e.g. https://…railway.app
  E2E_TEST_EMAIL       the e2e account
  E2E_TEST_PASSWORD    its password
Without API_GATEWAY_URL the whole module skips at collection with the reason in
the skip message — the nightly's secrets step fails LOUDLY before this runs, so
the skip here only ever fires in the ordinary push-CI `pytest tests/`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
MANIFEST_PATH = REPO_ROOT / "apps" / "web" / "e2e" / "nightly" / "manifest.json"
CANNED_DAY_PATH = (
    REPO_ROOT / "datasets" / "sim" / "fixtures" / "scenario-canned-day.json"
)
CHECKS_PATH = Path(
    os.environ.get("E2E_CHECKS_FILE", "test-results/wave_h_checks.jsonl")
)


def _api_url() -> str:
    return (
        os.environ.get("API_GATEWAY_URL") or os.environ.get("E2E_API_URL") or ""
    ).rstrip("/")


def record_check(check_id: str, state: str, reason: str, **evidence: Any) -> None:
    """Append one four-state record for scripts/e2e/nightly_summary.py.

    states: pass | fail | absent | cannot_check. Never a secret value.
    """
    assert state in {"pass", "fail", "absent", "cannot_check"}, state
    CHECKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CHECKS_PATH.open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "id": check_id,
                    "state": state,
                    "reason": reason,
                    "evidence": evidence or None,
                },
                ensure_ascii=False,
            )
            + "\n"
        )


@pytest.fixture(scope="session")
def api_url() -> str:
    url = _api_url()
    if not url:
        pytest.skip(
            "API_GATEWAY_URL (or E2E_API_URL) not set — Wave H has no gateway to read"
        )
    return url


@pytest.fixture(scope="session")
def manifest() -> dict[str, Any]:
    data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    pages = data.get("pages") or []
    if len(pages) < 10:
        pytest.fail(
            f"CANNOT CHECK — {MANIFEST_PATH} lists {len(pages)} pages; a walk over nothing passes by walking nothing"
        )
    return data


@pytest.fixture(scope="session")
def client(api_url: str) -> httpx.Client:
    with httpx.Client(base_url=api_url + "/api/v1", timeout=60.0) as c:
        yield c


@pytest.fixture(scope="session")
def session(client: httpx.Client) -> dict[str, Any]:
    """POST /auth/login + GET /auth/me — two auth-bucket calls, once per run.

    The token stays in memory. On any refusal the run says CANNOT CHECK rather
    than skipping: an unusable account is a precondition failure, not a pass.
    """
    email = os.environ.get("E2E_TEST_EMAIL", "")
    password = os.environ.get("E2E_TEST_PASSWORD", "")
    if not email or not password:
        record_check(
            "h.precondition.account",
            "cannot_check",
            "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set",
        )
        pytest.fail("CANNOT CHECK — E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set")
    resp = client.post("/auth/login", json={"email": email, "password": password})
    if resp.status_code == 429:
        record_check(
            "h.precondition.account",
            "cannot_check",
            "/auth/login answered 429 — the 10/60 s auth budget is spent; do not retry inside the minute",
        )
        pytest.fail("CANNOT CHECK — /auth/login 429")
    if resp.status_code != 200:
        record_check(
            "h.precondition.account",
            "cannot_check",
            f"/auth/login answered {resp.status_code} for E2E_TEST_EMAIL",
        )
        pytest.fail(f"CANNOT CHECK — /auth/login {resp.status_code}")
    token = resp.json().get("accessToken")
    if not token:
        record_check(
            "h.precondition.account",
            "cannot_check",
            "/auth/login returned no accessToken",
        )
        pytest.fail("CANNOT CHECK — no accessToken")
    me = client.get("/auth/me", headers={"authorization": f"Bearer {token}"})
    if me.status_code != 200:
        record_check(
            "h.precondition.account",
            "cannot_check",
            f"/auth/me answered {me.status_code} with a fresh token",
        )
        pytest.fail(f"CANNOT CHECK — /auth/me {me.status_code}")
    user = me.json().get("user") or {}
    rid = user.get("restaurantId")
    if not rid:
        record_check(
            "h.precondition.house",
            "cannot_check",
            "the account has no restaurant_id — grant it a simulator house",
        )
        pytest.fail("CANNOT CHECK — no house")
    record_check(
        "h.precondition.account",
        "pass",
        f"signed in via /auth/login as role {user.get('role')}",
        emailVerified=user.get("emailVerified"),
    )
    record_check("h.precondition.house", "pass", f"the account belongs to house {rid}")
    return {"token": token, "restaurant_id": rid, "user": user}


@pytest.fixture(scope="session")
def headers(session: dict[str, Any]) -> dict[str, str]:
    return {
        "authorization": f"Bearer {session['token']}",
        "X-Restaurant-Id": session["restaurant_id"],
    }
