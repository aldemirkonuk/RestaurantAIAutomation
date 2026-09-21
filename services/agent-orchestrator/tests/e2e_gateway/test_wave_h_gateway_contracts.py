"""Wave H — the deployed NestJS gateway, read-only (ADR 0135).

Every request here is a GET, or a POST that reads (`/auth/login`,
`/settings/feature-flags/check`). Nothing is written, nothing is torn down.
Each test records a four-state line (pass | fail | absent | cannot_check) for
scripts/e2e/nightly_summary.py besides its pytest verdict, so a skipped or
absent surface never renders as green.

Run:
  API_GATEWAY_URL=… E2E_TEST_EMAIL=… E2E_TEST_PASSWORD=… \
  pytest tests/e2e_gateway -q --junitxml=test-results/wave_h.xml
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
import pytest

from .conftest import CANNED_DAY_PATH, record_check

pytestmark = pytest.mark.prod_e2e

if not (os.environ.get("API_GATEWAY_URL") or os.environ.get("E2E_API_URL")):
    pytest.skip(
        "API_GATEWAY_URL not set — Wave H reads a deployed gateway and has none to read",
        allow_module_level=True,
    )

SHA40 = re.compile(r"^[0-9a-f]{40}$")


# ---------------------------------------------------------------------------
# Build identity — a 200 proves a process is up, never WHICH build (ADR 0097)
# ---------------------------------------------------------------------------


def test_health_live_names_its_build(client: httpx.Client) -> None:
    resp = client.get("/health/live")
    if resp.status_code != 200:
        record_check(
            "h.build.live", "fail", f"/health/live answered {resp.status_code}"
        )
        pytest.fail(f"/health/live {resp.status_code}")
    body = resp.json()
    commit = body.get("commit")
    if commit is None:
        record_check(
            "h.build.live",
            "fail",
            "/health/live omits `commit` — a field that vanishes on absence is the fault inside its own fix",
        )
        pytest.fail("commit omitted")
    if commit == "unknown":
        record_check(
            "h.build.live",
            "cannot_check",
            "/health/live reports commit=unknown: the build variable is not injected, so WHICH build is serving cannot be said",
            bootedAt=body.get("bootedAt"),
        )
        pytest.fail("commit unknown")
    assert SHA40.match(str(commit)), commit
    record_check(
        "h.build.live",
        "pass",
        f"gateway build {str(commit)[:12]} booted {body.get('bootedAt')}",
        commit=commit,
        bootedAt=body.get("bootedAt"),
        github_sha=os.environ.get("GITHUB_SHA"),
    )


# ---------------------------------------------------------------------------
# Contracts without a session
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/auth/me",
        "/settings/feature-flags/check",
        "/procurement/orders",
        "/procurement/documents",
    ],
)
def test_guarded_routes_refuse_without_a_token(client: httpx.Client, path: str) -> None:
    resp = client.post(path, json={}) if path.endswith("/check") else client.get(path)
    ok = resp.status_code == 401
    record_check(
        f"h.contract.401{path.replace('/', '.')}",
        "pass" if ok else "fail",
        f"{path} without a token answered {resp.status_code} (expected 401)",
    )
    assert ok, f"{path} → {resp.status_code}"


def test_unknown_route_is_404_not_a_page(client: httpx.Client) -> None:
    resp = client.get("/nonexistent-nightly-probe")
    ok = resp.status_code == 404
    record_check(
        "h.contract.404",
        "pass" if ok else "fail",
        f"an unknown route answered {resp.status_code} (expected 404)",
    )
    assert ok


# ---------------------------------------------------------------------------
# The house's flags — the same manifest the browser walks
# ---------------------------------------------------------------------------


def test_every_manifest_flag_answers_for_the_house(
    client: httpx.Client,
    headers: dict[str, str],
    session: dict[str, Any],
    manifest: dict[str, Any],
) -> None:
    rid = session["restaurant_id"]
    expect = (os.environ.get("E2E_EXPECT_FLAGS") or "report").lower()
    on = off = unregistered = 0
    failures: list[str] = []
    for page in manifest["pages"]:
        flag = page["flag"]
        resp = client.post(
            "/settings/feature-flags/check",
            headers=headers,
            json={"restaurant_id": rid, "feature_name": flag},
        )
        if resp.status_code != 200:
            failures.append(f"{flag}: HTTP {resp.status_code}")
            record_check(
                f"h.flag.{page['slug']}",
                "fail",
                f"/settings/feature-flags/check answered {resp.status_code} for {flag}",
            )
            continue
        body = resp.json()
        if not body.get("active"):
            unregistered += 1
            record_check(
                f"h.flag.{page['slug']}",
                "absent",
                f"{flag} is not registered on this gateway build (active=false)",
            )
            continue
        enabled = bool(body.get("enabled"))
        on += enabled
        off += not enabled
        mismatch = (expect == "on" and not enabled) or (expect == "off" and enabled)
        if mismatch:
            failures.append(f"{flag}: {'ON' if enabled else 'OFF'}, expected {expect}")
        record_check(
            f"h.flag.{page['slug']}",
            "fail" if mismatch else "pass",
            f"{flag} is {'ON' if enabled else 'OFF'} for this house"
            + (
                " (reported, not gated)"
                if expect == "report"
                else f" — expected {expect}"
            ),
        )
    record_check(
        "h.flags.tally",
        "pass",
        f"{on} on · {off} off · {unregistered} not registered on this build",
        on=on,
        off=off,
        unregistered=unregistered,
    )
    assert not failures, failures


# ---------------------------------------------------------------------------
# Backtest honesty, read-only
# ---------------------------------------------------------------------------


def test_forecast_reports_accuracy_or_says_it_cannot(
    client: httpx.Client, headers: dict[str, str], session: dict[str, Any]
) -> None:
    """The demand forecast's backtest block must never show a zero standing for
    an unknown: `scoredPoints == 0` ⇒ every metric is null and the basis says
    why; `scoredPoints > 0` ⇒ every metric is a number (ADR 0051 / 0064)."""
    rid = session["restaurant_id"]
    resp = client.get(
        f"/analytics/forecast/{rid}", headers=headers, params={"horizon": "7"}
    )
    if resp.status_code != 200:
        record_check(
            "h.backtest.forecast",
            "fail",
            f"/analytics/forecast answered {resp.status_code}",
        )
        pytest.fail(f"forecast {resp.status_code}")
    body = resp.json()
    acc = body.get("accuracy")
    model = body.get("model")
    if acc is None:
        record_check(
            "h.backtest.forecast",
            "absent",
            f"no model could be fitted (model={model}); accuracy is null, not zero",
            model=model,
        )
        return
    metrics = {k: acc.get(k) for k in ("mae", "rmse", "mape", "maseVsSeasonalNaive")}
    scored = int(acc.get("scoredPoints") or 0)
    basis = acc.get("basis")
    if scored == 0:
        honest = (
            all(v is None for v in metrics.values())
            and basis == "no_observations_in_scored_window"
        )
        record_check(
            "h.backtest.forecast",
            "pass" if honest else "fail",
            "no observations in the scored window"
            + (
                " — every metric null, as it must be"
                if honest
                else f" — but metrics are {metrics} / basis {basis}: a zero standing for an unknown"
            ),
            model=model,
            basis=basis,
        )
        assert honest, (metrics, basis)
        return
    honest = basis == "rolling_one_step_ahead" and all(
        isinstance(v, (int, float)) for v in metrics.values()
    )
    record_check(
        "h.backtest.forecast",
        "pass" if honest else "fail",
        (
            f"{model} scored on {scored} points, basis {basis}; MASE vs seasonal naive {metrics['maseVsSeasonalNaive']}"
            if honest
            else f"scored {scored} points but metrics/basis are not a complete backtest: {metrics} / {basis}"
        ),
        model=model,
        scoredPoints=scored,
        **{k: v for k, v in metrics.items()},
    )
    assert honest, (metrics, basis)


def test_insight_catalog_states_its_honest_split(
    client: httpx.Client, headers: dict[str, str], session: dict[str, Any]
) -> None:
    """`coverage` must separate computable-now from blocked/unbuilt (ADR 0020):
    the catalogue is a roadmap, and a single row must not flip 573 types on."""
    rid = session["restaurant_id"]
    resp = client.get(
        "/analytics/insight-catalog/types",
        headers=headers,
        params={"restaurantId": rid},
    )
    if resp.status_code != 200:
        record_check(
            "h.backtest.insight_catalog",
            "fail",
            f"/analytics/insight-catalog/types answered {resp.status_code}",
        )
        pytest.fail(f"catalog {resp.status_code}")
    body = resp.json()
    coverage = body.get("coverage") or {}
    # The split's key names are the controller's (analytics.controller.ts
    # "coverage is the honest split"); accept the documented spellings and
    # fail loudly on any other shape rather than guessing a number.
    total = None
    computable = None
    for k in ("total", "totalTypes", "candidateTypes"):
        if isinstance(body.get(k), int):
            total = body[k]
            break
    if total is None and isinstance(body.get("candidates"), list):
        total = len(body["candidates"])
    for k in ("computableNow", "computable_now", "computable"):
        if isinstance(coverage.get(k), int):
            computable = coverage[k]
            break
    if not coverage or computable is None or total is None:
        record_check(
            "h.backtest.insight_catalog",
            "fail",
            f"the catalogue response has no readable coverage split (top keys {sorted(body.keys())[:9]}; coverage keys {sorted(coverage.keys())[:9]})",
        )
        pytest.fail("no coverage split")
    ok = 0 <= int(computable) <= int(total)
    record_check(
        "h.backtest.insight_catalog",
        "pass" if ok else "fail",
        f"{computable} of {total} candidate types computable now for this house — an upper bound on reach, never a count of insights received",
        computable=computable,
        total=total,
        coverage=coverage,
    )
    assert ok


def test_scenario_runs_are_absent_in_production_or_match_the_canned_day(
    client: httpx.Client, headers: dict[str, str], session: dict[str, Any]
) -> None:
    """ADR 0093's verifier lives in SimposModule, which production does not load.
    404 there is the documented shape and is recorded as ABSENT — not a pass,
    not a failure. Where the module IS loaded (a local gateway), the recorded
    run for the canned day (bistro, random, seed 7, 2026-09-02) must carry the
    totals the offline engine regenerates — the pinned fixture."""
    rid = session["restaurant_id"]
    resp = client.get(f"/simpos/{rid}/scenarios/runs", headers=headers)
    if resp.status_code == 404:
        record_check(
            "h.backtest.scenario_runs",
            "absent",
            "GET /simpos/:id/scenarios/runs is 404 — SimposModule is not loaded on this gateway (dev-only by construction, ADR 0093)",
        )
        return
    if resp.status_code != 200:
        record_check(
            "h.backtest.scenario_runs",
            "fail",
            f"/simpos/:id/scenarios/runs answered {resp.status_code}",
        )
        pytest.fail(f"runs {resp.status_code}")
    runs = (resp.json() or {}).get("runs") or []
    if not CANNED_DAY_PATH.exists():
        record_check(
            "h.backtest.scenario_runs",
            "cannot_check",
            f"{CANNED_DAY_PATH} missing — regenerate with SCENARIO_CANNED_DAY_WRITE=1 pytest scripts/test_simulate_scenarios.py",
        )
        pytest.fail("canned day fixture missing")
    pinned = json.loads(CANNED_DAY_PATH.read_text(encoding="utf-8"))
    p = pinned["params"]
    match = [
        r
        for r in runs
        if r.get("scenario") == p["scenario"]
        and r.get("seed") == p["seed"]
        and r.get("service_date") == p["service_date"]
    ]
    if not match:
        record_check(
            "h.backtest.scenario_runs",
            "absent",
            f"{len(runs)} run(s) recorded for this house, none for the canned day {p['scenario']}/seed {p['seed']}/{p['service_date']}",
        )
        return
    got = match[-1].get("totals") or {}
    want = pinned["totals"]
    same = all(
        got.get(k) == want.get(k)
        for k in ("checks", "revenue", "wine_lines", "food_lines")
    )
    record_check(
        "h.backtest.scenario_runs",
        "pass" if same else "fail",
        (
            "the recorded run's totals equal the regenerated canned day"
            if same
            else f"drift: recorded {got} vs pinned {want}"
        ),
        recorded=got,
        pinned=want,
    )
    assert same, (got, want)
