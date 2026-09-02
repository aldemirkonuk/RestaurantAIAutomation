"""The product's own doors, used by the ADR 0093 scenario runner.

Every write a scenario run makes goes through the API a person would use — log
in, read the venue's hours, upsert the tables the scenario seats guests at, upsert
the item mappings, post the checks as signed webhooks. That is deliberate: a
harness that seeds its preconditions with direct SQL proves the database can hold
the data, not that the product can put it there.

There is exactly ONE exception, and it is marked as such in `persist_run`: the
run's own bookkeeping row in `sim_scenario_runs`, which no product endpoint owns.

Failures are raised, never absorbed. A read that returns `[]` on an HTTP error is
the defect ADR 0067 was written for — a run would then report an empty inventory
as a healthy one, and the expectation built on top of it would be arithmetic over
nothing.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Mapping

API_PREFIX = "/api/v1"
LOGIN_PATH = API_PREFIX + "/auth/login"
HOURS_PATH = API_PREFIX + "/restaurants/{restaurant_id}/operating-hours"
TABLES_PATH = API_PREFIX + "/analytics/tables/{restaurant_id}"

#: Only the columns the expectation needs. A `select=*` here would pull a wine
#: list's worth of columns per row for no gain.
INVENTORY_SELECT = (
    "id,master_wine_id,wine_name,stock_live,threshold_min,"
    "bottle_size_ml,pour_size_ml,sale_type,is_active"
)


class ScenarioApplyError(RuntimeError):
    """A call the run depends on failed. Never downgraded to an empty result."""


def _request(
    url: str,
    *,
    method: str = "GET",
    body: Any = None,
    headers: Mapping[str, str] | None = None,
    timeout: float = 20.0,
) -> Any:
    payload = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=payload, method=method)
    request.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
            if not 200 <= response.status < 300:
                raise ScenarioApplyError(
                    f"{method} {url} -> HTTP {response.status}: {raw[:300]}"
                )
            if not raw.strip():
                return None
            try:
                return json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ScenarioApplyError(
                    f"{method} {url} -> HTTP {response.status} but the body is not JSON: {raw[:200]}"
                ) from exc
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:300]
        except Exception:  # noqa: BLE001 — the status is the finding, not this
            pass
        raise ScenarioApplyError(
            f"{method} {url} -> HTTP {exc.code}: {detail}"
        ) from exc
    except urllib.error.URLError as exc:
        raise ScenarioApplyError(
            f"{method} {url} -> unreachable: {exc.reason}"
        ) from exc


# ---------------------------------------------------------------------------
# The product API
# ---------------------------------------------------------------------------


def login(
    analytics_base: str, email: str, password: str, *, timeout: float = 20.0
) -> str:
    """`POST /api/v1/auth/login` -> the bearer every guarded route needs.

    Shape read from `auth.controller.ts::login`: the body is
    `{ email, password }` (`LoginCredentials`) and the response spreads a
    `TokenPair` — `{ success, accessToken, refreshToken, message }`.
    """
    data = _request(
        analytics_base.rstrip("/") + LOGIN_PATH,
        method="POST",
        body={"email": email, "password": password},
        timeout=timeout,
    )
    token = (data or {}).get("accessToken")
    if not token:
        raise ScenarioApplyError(
            "login returned no accessToken — the response shape changed, or the "
            f"credentials were rejected: {json.dumps(data)[:200]}"
        )
    return str(token)


def fetch_operating_hours(
    analytics_base: str, restaurant_id: str, bearer: str, *, timeout: float = 20.0
) -> tuple[dict[str, Any] | None, str | None]:
    """`GET /restaurants/:id/operating-hours` -> `(operatingHours, timezone)`.

    `None` hours means the venue's hours are UNKNOWN, and the caller must refuse
    to apply rather than pick a plausible day (ADR 0020). This function returns
    the null rather than a default precisely so that decision stays with the
    caller and is visible in the code.
    """
    data = _request(
        analytics_base.rstrip("/") + HOURS_PATH.format(restaurant_id=restaurant_id),
        headers={"Authorization": f"Bearer {bearer}"},
        timeout=timeout,
    )
    if not isinstance(data, Mapping):
        raise ScenarioApplyError(
            f"operating-hours returned {type(data).__name__}, expected an object with "
            "{timezone, operatingHours}"
        )
    hours = data.get("operatingHours", data.get("operating_hours"))
    tz = data.get("timezone")
    return (dict(hours) if isinstance(hours, Mapping) else None, tz)


def upsert_tables(
    analytics_base: str,
    restaurant_id: str,
    bearer: str,
    tables: list[Mapping[str, Any]],
    *,
    timeout: float = 20.0,
) -> int:
    """`POST /analytics/tables/:id` per table — `upsertTable`'s own door.

    The scenarios seat guests at labelled tables and the hub resolves
    `tableRef` against `restaurant_tables`; a check whose table does not exist
    still ingests, but lands with `table_id: null` and drops out of every
    table-level analytic. Upserting first is what makes the table half of the
    expectation checkable at all.
    """
    url = analytics_base.rstrip("/") + TABLES_PATH.format(restaurant_id=restaurant_id)
    headers = {"Authorization": f"Bearer {bearer}"}
    count = 0
    for table in tables:
        _request(
            url,
            method="POST",
            body={"label": table["label"], "seats": table["seats"]},
            headers=headers,
            timeout=timeout,
        )
        count += 1
    return count


# ---------------------------------------------------------------------------
# Supabase, read-only — plus the one write no endpoint owns
# ---------------------------------------------------------------------------


def _service_headers(service_key: str) -> dict[str, str]:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }


def fetch_inventory(
    supabase_url: str,
    service_key: str,
    restaurant_id: str,
    *,
    timeout: float = 30.0,
) -> list[dict[str, Any]]:
    """Read `restaurant_inventory` for the tenant. READ ONLY.

    The expectation needs `stock_live`, `threshold_min` and the two volume
    columns to say what a sale removes; there is no product endpoint that returns
    them all, and inventing them would make every depletion figure a fiction.
    A non-2xx raises — an empty list here would be read as "this tenant has no
    wine", which is a sentence about the restaurant, not about the request.
    """
    query = urllib.parse.urlencode(
        {
            "restaurant_id": f"eq.{restaurant_id}",
            "select": INVENTORY_SELECT,
            "deleted_at": "is.null",
        }
    )
    url = f"{supabase_url.rstrip('/')}/rest/v1/restaurant_inventory?{query}"
    data = _request(url, headers=_service_headers(service_key), timeout=timeout)
    if not isinstance(data, list):
        raise ScenarioApplyError(
            f"restaurant_inventory returned {type(data).__name__}, expected a list"
        )
    return data


def persist_run(
    supabase_url: str,
    service_key: str,
    row: Mapping[str, Any],
    *,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """Insert the run into `sim_scenario_runs` (ADR 0093 D2).

    THIS IS THE ONLY WRITE IN THE HARNESS THAT BYPASSES THE PRODUCT API, and it
    does so because no product endpoint owns this table: it is the harness's own
    bookkeeping — the expectation a later verify call compares the database
    against. Everything a *restaurant* would do (tables, mappings, checks) goes
    through the gateway, exactly as ADR 0093 requires.

    Same idiom as `scripts/synth/seed.py::_call_seed_rpc_http`: service-role key
    in both `apikey` and `Authorization`. `Prefer: return=representation` so the
    run id comes back and the caller can print it instead of guessing.
    """
    url = f"{supabase_url.rstrip('/')}/rest/v1/sim_scenario_runs"
    headers = {
        **_service_headers(service_key),
        "Prefer": "return=representation",
    }
    data = _request(
        url, method="POST", body=dict(row), headers=headers, timeout=timeout
    )
    if isinstance(data, list):
        if not data:
            raise ScenarioApplyError(
                "sim_scenario_runs insert returned an empty representation — the row "
                "was not returned, so the run id is unknown"
            )
        return dict(data[0])
    if isinstance(data, Mapping):
        return dict(data)
    raise ScenarioApplyError(
        f"sim_scenario_runs insert returned {type(data).__name__}, expected a row"
    )


__all__ = [
    "INVENTORY_SELECT",
    "ScenarioApplyError",
    "fetch_inventory",
    "fetch_operating_hours",
    "login",
    "persist_run",
    "upsert_tables",
]
